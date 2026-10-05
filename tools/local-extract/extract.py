#!/usr/bin/env python3
"""Extract autochess art from a locally installed Arknights client (optional, host-side).

The official CN client ships Unity AssetBundles compressed with a custom LZ4 variant ("LZ4AK");
aklz4.py registers a decoder for it. This script pulls the art the web sources lack:
  - map_autochess / map_autochesssand textures (the real board tile atlas)
  - every Sprite of the three autochess UI bundles (HUD frames, badges, banners, icons)
  - the 6 in-match emoticon themes of 盟约 (activity_table autoChessData.enabledEmoticonThemeIdList; only the
    *_battle sprites, keyed by display_meta_table picId: emoticon/<dir>/<picId>.png, see data/emotes.json)
  - the autochess guidebook pages, battle projectile sprites and a few token/skin Spine models missing upstream
  (the emotes and the guidebook pages are on the public mirror too: tools/fetch-assets.mjs downloads them, and the
  client uses these local copies first — GitHub issue #42)
  - the enemy battle Spine models no community dump carries (ENEMY_SPINES: 灼热源石虫 / 炽焰源石虫), from the enemy art
    bundles (refs/arts/enm_art_*.ab) → spine/enemy/<enemyId>/<stem>.skel|.atlas + page PNGs with the [alpha] texture
    merged in (premultiplied RGB + A, the Ark-Models format; the atlas gets `size:` / `pma: true` like the fetched
    enemies); the client draws them instead of the web alias once this manifest lists them (data/assets.json
    enemies[id].spineLocal, docs/ASSETS.md "Enemy aliases")
  - for the official 3D board (DESIGN §15): the map theme's Material parameters (map/<theme>/materials.json; shader
    names resolved through the shaders/*.ab bundles), the background / device meshes as Wavefront OBJ
    (mesh/<bundle>/<mesh>.obj; UnityPy's exporter, X mirrored into a right-handed frame) and their GameObject
    placement (mesh/<bundle>/prefab.json)
  - the standard gate / objective effects of every battle map (arts/effects/[pack]map.ab → map/fx: the [opt]start_box /
    [opt]end_box / [opt]start_fly meshes, their merged additive textures, materials and prefab), the blower's texture
    (arts/maps/common/res.ab → map/common: TX_wind_device of the s_wind_device mesh) and the shared water / noise
    textures (arts/maps/effect.ab → map/water) used for deep-sea / mire / smog tiles
  - derived PBR maps for three.js (DERIVED): Unity stores the theme's normal map as two channels (BC5: RG = XY, B = 0)
    and metallic/gloss with the smoothness in A; the board renderer needs an RGB normal map (Z rebuilt) and a
    roughness map in G (1 − smoothness; metalness B = 0), written next to the source as <name>_rgb.png / _rough.png
  - WebP copies of the board textures every player downloads with the 3D board (WEBP), written next to their PNGs;
    the manifest lists the copy

Usage:
  python3 -m venv .venv && .venv/bin/pip install -r tools/local-extract/requirements.txt
  .venv/bin/python tools/local-extract/extract.py [--game <AB root>] [--out public/assets/local] [--only <subdir prefix>]
  python3 tools/local-extract/extract.py --print-jobs     (the job table as JSON; needs no dependencies)
  python3 tools/local-extract/extract.py --webp           (only the WebP copies, from the PNGs already extracted —
                                                          e.g. the local art copied from a release bundle; needs Pillow)

Writes <out>/**.png|.webp|.skel|.atlas and data/local-assets.json (manifest of what was extracted). With --only, just
the jobs whose output subdir starts with one of the prefixes run, and their groups replace those of the existing
manifest (every other group is kept as is).
Everything is (c) Hypergryph; for private, non-commercial fan use only.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parents[2]
HOME = Path.home()
CANDIDATES = [
    HOME / 'Library/Application Support/CrossOver/Bottles/Arknights/drive_c/Program Files/Hypergryph Launcher/games/Arknights/Arknights_Data/StreamingAssets/AB/Windows',
    HOME / 'Library/Containers/com.hypergryph.arknights/Data/Documents/Bundles',
    # native Windows installs of the official launcher (default and x86 locations)
    Path('C:/Program Files/Hypergryph Launcher/games/Arknights/Arknights_Data/StreamingAssets/AB/Windows'),
    Path('C:/Program Files (x86)/Hypergryph Launcher/games/Arknights/Arknights_Data/StreamingAssets/AB/Windows'),
]

# In-match emote themes (display_meta_table emoticonData, scene AUTOCHESS_BATTLE), in the order of
# activity_table autoChessData.enabledEmoticonThemeIdList: (themeId, output dir under emoticon/). The dirs are the
# ones of shared/constants.js EMOTE_THEMES / data/emotes.json. Only the *_battle sprites are exported: the bundles also
# hold room / pick pics of other modes (and the autochess room pics are not in the local client at all).
EMOTE_THEMES = [
    ('emoticon_autochess_basic', 'basic'),
    ('emoticon_originium_slug', 'slug'),
    ('emoticon_autochess_basic_2', 'basic_2'),
    ('emoticon_foolsday_doctor', 'fooldoctor'),
    ('emoticon_foolsday_amiya', 'foolamiya'),
    ('emoticon_foolsday_wisdel', 'foolwisdel'),
]
BATTLE_EMOTE = r'^pic_.+_battle$'

# Meshes of the official board scene (DESIGN §15): (bundle, output name under mesh/).
MESH_BUNDLES = [
    ('arts/maps/map_autochess/bkg_mesh.ab', 'map_autochess_bkg'),
    ('arts/maps/common/meshes/s_background_common.ab', 's_background_common'),
    ('arts/maps/common/meshes/s_common_box_01.ab', 's_common_box_01'),
    ('arts/maps/common/meshes/s_wind_device.ab', 's_wind_device'),
]

# (bundle path relative to the AB root, output subdir, which object types to export[, name regex to keep])
JOBS = [
    ('arts/maps/map_autochess/res.ab', 'map/autochess', {'Texture2D', 'Material'}),
    ('arts/maps/map_autochesssand/res.ab', 'map/autochesssand', {'Texture2D', 'Material'}),
    ('ui/autochess/[uc]autochesscommon.ab', 'ui/common', {'Sprite'}),
    ('ui/autochess/[uc]autochessbattle.ab', 'ui/battle', {'Sprite', 'TextAsset'}),
    ('ui/autochess/[uc]autochessouter.ab', 'ui/outer', {'Sprite'}),
    *[(f'ui/emoticon/theme/[uc]{theme}.ab', f'emoticon/{sub}', {'Sprite'}, BATTLE_EMOTE) for theme, sub in EMOTE_THEMES],
    ('arts/guidebookpages/[pack]autochess.ab', 'guide', {'Sprite', 'Texture2D'}),
    ('battle/prefabs/[uc]projectiles.ab', 'projectiles', {'Sprite', 'Texture2D'}),
    # official module (uniequip) type icons, keyed by lower-case type name (e.g. 'mar-x')
    ('spritepack/ui_equip_type_hub_h2_0.ab', 'module', {'Sprite'}),
    ('skinpack/token_10039_ulpia_block.ab', 'spine/token_10039_ulpia_block', {'TextAsset', 'Texture2D'}),
    *[(rel, f'mesh/{sub}', {'Mesh', 'GameObject', 'Material', 'Texture2D'}) for rel, sub in MESH_BUNDLES],
    ('arts/effects/[pack]map.ab', 'map/fx', {'Mesh', 'GameObject', 'Material', 'Texture2D'}),
    ('arts/maps/common/res.ab', 'map/common', {'Material', 'Texture2D'}, r'^(TX|MT)_wind_device$'),
    ('arts/maps/effect.ab', 'map/water', {'Texture2D'}, r'water_normal|Caustics|WaterNoise|noise_clouds|Water_Foam|SmoothWaves'),
]

# Enemy battle Spine models that no community dump carries (isHarryh/Ark-Models lists them with an empty assetList, so
# tools/fetch-assets.mjs aliases them to another enemy's skeleton — the web model): every enemy of data/enemies.json whose
# official battle prefab draws a skeleton of its own that is missing upstream (audited against the client's prefabs, user
# feedback after 0.1.0 report D3: 灼热源石虫 / 炽焰源石虫 — the ELEMENT faction's slugs — were drawn as the plain 源石虫).
# Read from the enemy art bundles: Assets/Torappu/Arts/Enemies/Spines/<…>/<id>_SkeletonData.asset → its skeleton
# TextAsset, the atlas TextAsset of its atlas asset and every page texture of the atlas materials (_MainTex, with its
# _AlphaTex merged in as A). Output: spine/enemy/<id>/ (manifest group spine/enemy/<id>); the client draws the model
# when the group lists every file of data/assets.json enemies[id].spineLocal (whose metadata
# tools/assets/local-enemy-spines.json keeps: `node tools/fetch-assets.mjs --local-spines` after a game update).
ENEMY_SPINES = ['enemy_1305_mhslim', 'enemy_1305_mhslim_2']
ENEMY_ART = 'refs/arts/enm_art_*.ab'
ENEMY_SPINE_SUB = 'spine/enemy'

# Derived three.js maps: (output subdir, source texture, kind, output name). 'normal_rg' rebuilds Z of a two-channel
# (BC5) normal map into an RGB tangent-space map; 'rough_from_gloss' turns Unity's metallic/gloss map (smoothness in
# A) into a roughness (G) / metalness (B) map. Written after the job that exported the source texture.
DERIVED = [
    ('map/autochess', 'TX_autochessi_N', 'normal_rg', 'TX_autochessi_N_rgb'),
    ('map/autochess', 'TX_autochessi_M', 'rough_from_gloss', 'TX_autochessi_M_rough'),
]

# The board textures every player downloads when a match shows the 3D board (public/js/render/board3d/load.js
# PACK_IMAGES; D / common_D / BG also feed the 2D board art, render/boardArt.js): (output subdir, name, mode). A WebP
# copy is written next to the PNG and the manifest lists the copy instead (≈ 6.7 MB → 2.0 MB per cold start); the PNG
# stays for tools/crop-board-atlas.mjs and setup's check. 'lossy' = colour maps at quality 95 with the alpha lossless
# and the RGB under transparent texels kept (`exact`: the board material is opaque and samples it); 'lossless' =
# normal and data maps, whose channels hold independent values that lossy WebP's chroma subsampling would mix (a
# normal map ends up tens of degrees off). A Pillow without WebP support keeps the PNG.
WEBP = [
    ('map/autochess', 'TX_autochessi_D', 'lossy'),
    ('map/autochess', 'TX_autochessi_BG', 'lossy'),
    ('map/autochess', 'TX_autochessi_common_D', 'lossy'),
    ('map/autochess', 'TX_autochessi_N_rgb', 'lossless'),
    ('map/autochess', 'TX_autochessi_M_rough', 'lossless'),
    ('map/autochess', 'TX_autochessi_E', 'lossless'),
    ('map/autochess', 'TX_autochessi_common_E', 'lossless'),
    ('map/common', 'TX_wind_device', 'lossy'),
    ('map/fx', '[opt]merged_textures', 'lossless'),
    ('map/water', '[ucp]TX_water_normal', 'lossless'),
    ('map/water', 'TX_Caustics256', 'lossy'),
    ('map/water', 'T_noise_clouds_01', 'lossless'),
]
WEBP_OPTIONS = {
    'lossy': {'quality': 95, 'method': 6, 'alpha_quality': 100, 'exact': True},
    'lossless': {'lossless': True, 'quality': 100, 'method': 6, 'exact': True},
}

# Shader bundles loaded beside every job that exports Materials, only so that the materials' shader references
# (external CABs) resolve to a name in materials.json (e.g. Torappu/Scene/StandardDirectional); nothing is exported
# from them.
SHADER_DEPS = 'shaders/*.ab'
# the root shader bundle ([uc]shaders.ab) holds the Torappu particle shaders of the map effects (map/fx)
SHADER_DEPS_ROOT = '[uc]shaders.ab'

SAFE = re.compile(r'[^A-Za-z0-9_.\-\[\]]+')


def safe_name(name):
    name = SAFE.sub('_', name).strip('._') or 'unnamed'
    return name[:120]


def job_parts(job):
    """(rel, sub, kinds, keep) of a JOBS entry; keep is a compiled name filter or None."""
    rel, sub, kinds = job[:3]
    keep = re.compile(job[3]) if len(job) > 3 and job[3] else None
    return rel, sub, kinds, keep


def wants_sub(only, sub):
    """Whether output subdir `sub` runs under --only: no prefixes, or one prefix is `sub`, a parent of it or below it."""
    if not only:
        return True
    return any(sub == p.rstrip('/') or sub.startswith(p.rstrip('/') + '/') or p.rstrip('/').startswith(sub + '/')
               for p in only)


def select_jobs(only):
    """The jobs whose output subdir starts with one of the `only` prefixes (all jobs when `only` is empty)."""
    if not only:
        return list(JOBS)
    return [j for j in JOBS if any(j[1] == p.rstrip('/') or j[1].startswith(p.rstrip('/') + '/') for p in only)]


def enemy_spine_id(container, wanted):
    """The enemy id of an enemy SkeletonData container path (Assets/Torappu/Arts/Enemies/Spines/<dir>[/<n>]/<id>_
    SkeletonData.asset) when it is one of `wanted`, else None."""
    m = re.search(r'/Enemies/Spines/(?:[^/]+/)+([^/]+)_SkeletonData\.asset$', container or '', re.I)
    return m.group(1) if m and m.group(1) in wanted else None


def _num(v, nd=6):
    """JSON-safe rounded float (NaN / inf → 0)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0
    return round(f, nd) + 0.0 if f == f and abs(f) != float('inf') else 0  # + 0.0: no '-0.0'


def vec(v, keys='xyz'):
    """[x, y, z(, w)] of a UnityPy vector / quaternion (missing components → 0)."""
    return [_num(getattr(v, k, 0)) for k in keys]


def _pptr_name(pptr):
    """Name of the object a PPtr points to, or None (null pointer or an unloaded external bundle)."""
    try:
        if not getattr(pptr, 'm_PathID', 0):
            return None
        return getattr(pptr.read(), 'm_Name', None) or None
    except Exception:  # external dependency not loaded, unsupported type, …
        return None


def material_info(mat):
    """JSON summary of a Material: shader, keywords, textures (by name, with tiling), floats and colours."""
    shader = None
    try:
        sh = mat.m_Shader.read()
        shader = getattr(getattr(sh, 'm_ParsedForm', None), 'm_Name', None) or getattr(sh, 'm_Name', None)
    except Exception:
        shader = None
    props = getattr(mat, 'm_SavedProperties', None)
    textures, floats, colors = {}, {}, {}
    for k, env in (getattr(props, 'm_TexEnvs', None) or []):
        name = _pptr_name(env.m_Texture)
        if name:
            textures[k] = {'texture': name, 'scale': vec(env.m_Scale, 'xy'), 'offset': vec(env.m_Offset, 'xy')}
    for k, v in (getattr(props, 'm_Floats', None) or []):
        floats[k] = _num(v)
    for k, c in (getattr(props, 'm_Colors', None) or []):
        colors[k] = vec(c, 'rgba')
    kw = getattr(mat, 'm_ValidKeywords', None) or getattr(mat, 'm_ShaderKeywords', None) or []
    if isinstance(kw, str):
        kw = kw.split()
    return {'shader': shader, 'keywords': sorted(kw), 'textures': dict(sorted(textures.items())),
            'floats': dict(sorted(floats.items())), 'colors': dict(sorted(colors.items()))}


def prefab_node(go, mesh_keys=None):
    """JSON summary of a GameObject: local transform (Unity space), parent, mesh and material names. `mesh_keys`
    ({mesh path id: manifest key}) names the exported OBJ when two meshes of a bundle share a name."""
    node = {'name': getattr(go, 'm_Name', '') or '', 'parent': None, 'pos': [0, 0, 0], 'rot': [0, 0, 0, 1],
            'scale': [1, 1, 1], 'mesh': None, 'materials': []}
    for c in getattr(go, 'm_Component', None) or []:
        pptr = getattr(c, 'component', c)
        try:
            comp = pptr.read()
        except Exception:
            continue
        kind = type(comp).__name__
        if kind in ('Transform', 'RectTransform'):
            node['pos'] = vec(comp.m_LocalPosition)
            node['rot'] = vec(comp.m_LocalRotation, 'xyzw')
            node['scale'] = vec(comp.m_LocalScale)
            try:
                father = comp.m_Father.read() if getattr(comp.m_Father, 'm_PathID', 0) else None
                node['parent'] = father.m_GameObject.read().m_Name if father else None
            except Exception:
                node['parent'] = None
        elif kind == 'MeshFilter':
            node['mesh'] = _pptr_name(comp.m_Mesh)
            pid = getattr(comp.m_Mesh, 'm_PathID', 0)
            if mesh_keys and pid in mesh_keys and not getattr(comp.m_Mesh, 'm_FileID', 0):
                node['mesh'] = mesh_keys[pid]
        elif kind in ('MeshRenderer', 'SkinnedMeshRenderer'):
            node['materials'] = [_pptr_name(m) for m in getattr(comp, 'm_Materials', None) or []]
    return node


def dep_bundles(ab_root, kinds):
    """Bundles to load next to a job so its references resolve: the shader bundles when it exports Materials."""
    if 'Material' not in kinds:
        return []
    root = Path(ab_root)
    extra = [root / SHADER_DEPS_ROOT] if (root / SHADER_DEPS_ROOT).is_file() else []
    return sorted(p for p in root.glob(SHADER_DEPS) if p.is_file()) + extra


_NORMAL_Z = None


def _normal_z_table():
    """Z byte of a unit normal for every (x byte, y byte) pair: 128 + 127·sqrt(max(0, 1 − x² − y²))."""
    global _NORMAL_Z
    if _NORMAL_Z is None:
        t = bytearray(65536)
        for xb in range(256):
            x = xb / 127.5 - 1.0
            for yb in range(256):
                y = yb / 127.5 - 1.0
                z = max(0.0, 1.0 - x * x - y * y) ** 0.5
                t[(xb << 8) | yb] = min(255, int(round(127.5 + 127.5 * z)))
        _NORMAL_Z = bytes(t)
    return _NORMAL_Z


def derive_normal_rg(img):
    """RGB tangent-space normal map from a two-channel (BC5: R = X, G = Y, B unused) one: Z rebuilt per pixel."""
    from PIL import Image
    rgb = img.convert('RGB')
    r, g, _ = rgb.split()
    table = _normal_z_table()
    z = bytes(table[(x << 8) | y] for x, y in zip(r.tobytes(), g.tobytes()))
    return Image.merge('RGB', (r, g, Image.frombytes('L', rgb.size, z)))


def derive_rough_from_gloss(img):
    """three.js roughness / metalness map (G = 1 − smoothness from Unity's A, B = metalness 0, R = 1) from a
    Unity metallic/gloss map."""
    from PIL import Image
    rgba = img.convert('RGBA')
    rough = rgba.getchannel('A').point(lambda v: 255 - v)
    return Image.merge('RGB', (Image.new('L', rgba.size, 255), rough, Image.new('L', rgba.size, 0)))


DERIVERS = {'normal_rg': derive_normal_rg, 'rough_from_gloss': derive_rough_from_gloss}


def run_derived(out_root, sub, manifest, log):
    """Write the DERIVED maps of output subdir `sub` (from its exported PNGs) and record them in the manifest."""
    from PIL import Image
    n = 0
    for dsub, src, kind, name in DERIVED:
        if dsub != sub:
            continue
        path = Path(out_root) / sub / f'{src}.png'
        if not path.exists():
            log(f'  derived {name}: source {src} missing')
            continue
        try:
            img = DERIVERS[kind](Image.open(path))
            img.save(Path(out_root) / sub / f'{name}.png')
        except Exception as e:  # a broken source only drops the derived map (the renderer falls back)
            log(f'  warn derived {name}: {e}')
            continue
        manifest.setdefault(sub, {})[name] = {'path': f'/assets/local/{sub}/{name}.png', 'w': img.width, 'h': img.height,
                                              'kind': 'Derived', 'from': src, 'derive': kind}
        n += 1
    return n


def run_webp(out_root, sub, manifest, log):
    """Write the WEBP copies of output subdir `sub` from its PNGs and point their manifest entries at them."""
    n = 0
    for wsub, name, mode in WEBP:
        entry = manifest.get(sub, {}).get(name) if wsub == sub else None
        png = Path(out_root) / sub / f'{name}.png'
        if not entry or not png.exists():
            continue
        dst = png.with_name(f'{name}.webp')
        try:
            from PIL import Image
            with Image.open(png) as img:
                img.save(dst, 'WEBP', **WEBP_OPTIONS[mode])
        except Exception as e:  # no WebP support in this Pillow, or a broken PNG: the entry keeps the PNG
            log(f'  warn webp {name}: {e}')
            continue
        entry.update(path=f'/assets/local/{sub}/{dst.name}', webp=mode)
        n += 1
    return n


def webp_only(out_root, manifest_path, log):
    """--webp: the WEBP copies of an existing extraction (e.g. the local art copied from a release bundle)."""
    try:
        doc = json.loads(Path(manifest_path).read_text(encoding='utf-8'))
    except (OSError, ValueError) as e:
        print(f'No readable manifest at {manifest_path} ({e}). Extract the local art first.', file=sys.stderr)
        return 2
    groups = doc.get('groups') if isinstance(doc, dict) else None
    if not isinstance(groups, dict):
        print(f'{manifest_path} has no groups. Extract the local art first.', file=sys.stderr)
        return 2
    n = sum(run_webp(out_root, sub, groups, log) for sub in dict.fromkeys(s for s, _, _ in WEBP))
    Path(manifest_path).write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    log(f'done: {n} WebP copies, manifest {manifest_path}')
    return 0 if n else 1


def merge_manifest(old_groups, new_groups, ran_subs):
    """Groups of the previous manifest minus the subdirs that were re-extracted, plus the new ones (sorted keys)."""
    out = {g: v for g, v in (old_groups or {}).items() if g not in ran_subs}
    out.update(new_groups)
    return {g: dict(sorted(out[g].items())) for g in sorted(out)}


def export_bundle(ab_root, job, out_root, manifest, log):
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    rel, sub, kinds, keep = job_parts(job)
    src = ab_root / rel
    if not src.exists():
        log(f'skip (missing) {rel}')
        return 0
    try:
        env = UnityPy.load(str(src))
    except Exception as e:  # corrupt or unsupported bundle: report and continue
        log(f'FAIL load {rel}: {e}')
        return 0
    objects = list(env.objects)  # the job's own objects, listed before any dependency joins the environment
    for dep in dep_bundles(ab_root, kinds):
        try:
            env.load_file(str(dep))
        except Exception as e:  # a missing shader only leaves that material's shader name null
            log(f'  warn dependency {dep.name}: {e}')
    out_dir = out_root / sub
    out_dir.mkdir(parents=True, exist_ok=True)
    seen, n = set(), 0
    materials, prefab, gos, mesh_keys = {}, [], [], {}
    for obj in objects:
        t = obj.type.name
        if t not in kinds:
            continue
        try:
            data = obj.read()
            raw_name = getattr(data, 'm_Name', '') or ''
            if keep is not None and not keep.search(raw_name):
                continue
            name = safe_name(raw_name or f'obj_{obj.path_id}')
            if t in ('Sprite', 'Texture2D'):
                img = data.image
                if img is None or img.width < 2 or img.height < 2:
                    continue
                fname = name + '.png'
                if fname in seen:  # same name twice: a Sprite (true aspect) beats its padded Texture2D
                    if t == 'Texture2D' or manifest.get(sub, {}).get(name, {}).get('kind') == 'Sprite':
                        continue
                img.save(out_dir / fname)
                seen.add(fname)
                manifest.setdefault(sub, {})[name] = {
                    'path': f'/assets/local/{sub}/{fname}', 'w': img.width, 'h': img.height, 'kind': t}
                n += 1
            elif t == 'TextAsset':
                raw = data.m_Script
                blob = raw.encode('utf-8', 'surrogateescape') if isinstance(raw, str) else bytes(raw)
                if name.endswith('.atlas') or name.endswith('.skel'):
                    fname = name
                elif blob[:1] in (b'\n', b'') or b'size:' in blob[:200]:
                    fname = name + '.atlas'
                else:
                    fname = name + '.skel'
                (out_dir / fname).write_bytes(blob)
                manifest.setdefault(sub, {})[fname] = {'path': f'/assets/local/{sub}/{fname}', 'kind': t}
                n += 1
            elif t == 'Mesh':
                text = data.export()
                if not text or 'v ' not in text:
                    continue
                fname = name + '.obj'
                if fname in seen:
                    name, fname = f'{name}_{obj.path_id}', f'{name}_{obj.path_id}.obj'
                (out_dir / fname).write_text(text, encoding='utf-8')
                seen.add(fname)
                verts = sum(1 for line in text.splitlines() if line.startswith('v '))
                manifest.setdefault(sub, {})[name] = {'path': f'/assets/local/{sub}/{fname}', 'kind': 'Mesh', 'verts': verts}
                mesh_keys[obj.path_id] = name
                n += 1
            elif t == 'Material':
                materials[raw_name or name] = material_info(data)
            elif t == 'GameObject':
                gos.append(data)  # summarised after every mesh got its manifest key
        except Exception as e:
            log(f'  warn {rel} #{obj.path_id}: {e}')
    for go in gos:
        try:
            prefab.append(prefab_node(go, mesh_keys))
        except Exception as e:
            log(f'  warn {rel} GameObject: {e}')
    for key, fname, payload in (('materials', 'materials.json', materials), ('prefab', 'prefab.json', prefab)):
        if not payload:
            continue
        if isinstance(payload, list):
            payload = sorted(payload, key=lambda nd: (nd['parent'] or '', nd['name']))
        else:
            payload = dict(sorted(payload.items()))
        (out_dir / fname).write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        manifest.setdefault(sub, {})[key] = {'path': f'/assets/local/{sub}/{fname}', 'kind': key.capitalize(), 'count': len(payload)}
        n += 1
    n += run_derived(out_root, sub, manifest, log)
    log(f'{rel}: {n} files -> {sub}')
    k = run_webp(out_root, sub, manifest, log)
    if k:
        log(f'  {k} WebP copies -> {sub}')
    return n


def _text_bytes(text_asset):
    raw = text_asset.m_Script
    return raw.encode('utf-8', 'surrogateescape') if isinstance(raw, str) else bytes(raw)


def merge_alpha(rgb, alpha):
    """RGBA page of a split texture: RGB of the main texture (premultiplied: the client's Spine material has
    _StraightAlphaInput 0) and A from its [alpha] texture; RGB is clamped to A (block-compression bleed)."""
    from PIL import Image, ImageChops
    r, g, b = rgb.convert('RGB').split()
    a = alpha.convert('L').resize(rgb.size) if alpha is not None else Image.new('L', rgb.size, 255)
    return Image.merge('RGBA', tuple(ImageChops.darker(ch, a) for ch in (r, g, b)) + (a,))


def normalize_atlas(text, sizes):
    """Spine atlas text with every page header carrying its real `size: w,h` (`sizes`: page name → (w, h)) and
    `pma: true` (the pages are premultiplied: merge_alpha) — what tools/assets/atlas.mjs normalizeAtlas gives the fetched
    enemy atlases, so the client loads the extracted model as it is. Page fields are the unindented `key: value` lines
    right after a page name (a line after a blank line, or the first line); everything else is kept."""
    lines = text.replace('\r\n', '\n').replace('\r', '\n').lstrip('\ufeff').split('\n')
    out, i, n = [], 0, len(lines)
    while i < n:
        line = lines[i]
        starts_page = line.strip() and ':' not in line and not line[:1].isspace() and (i == 0 or not lines[i - 1].strip())
        if not starts_page:
            out.append(line)
            i += 1
            continue
        name = line.strip()
        fields, j = [], i + 1
        while j < n and lines[j].strip() and not lines[j][:1].isspace() and ':' in lines[j]:
            fields.append(lines[j])
            j += 1
        keys = [f.split(':', 1)[0].strip() for f in fields]
        size = sizes.get(name)
        if size:
            sz = f'size: {size[0]},{size[1]}'
            if 'size' in keys:
                fields[keys.index('size')] = sz
            else:
                fields.insert(0, sz)
        if 'pma' not in keys:
            fields.append('pma: true')
        out.append(line)
        out.extend(fields)
        i = j
    return '\n'.join(out)


def write_enemy_spine(objects, sda, eid, out_root, manifest, log):
    """Write one enemy model (skeleton, atlas, merged pages) of a SkeletonDataAsset typetree; returns the file count."""
    get = lambda pptr: objects.get(pptr['m_PathID']) if pptr and not pptr.get('m_FileID') else None  # noqa: E731
    sub = f'{ENEMY_SPINE_SUB}/{eid}'
    out_dir = Path(out_root) / sub
    out_dir.mkdir(parents=True, exist_ok=True)
    files = {}
    skel = get(sda.get('skeletonJSON'))
    if skel is None:
        log(f'  warn {eid}: skeleton TextAsset not in this bundle')
        return 0
    ta = skel.read()
    stem = safe_name(getattr(ta, 'm_Name', '') or eid).removesuffix('.skel')
    files[f'{stem}.skel'] = _text_bytes(ta)
    pages = {}
    for aref in sda.get('atlasAssets') or []:
        aa = get(aref)
        if aa is None:
            continue
        at = aa.read_typetree()
        af = get(at.get('atlasFile'))
        if af is not None:
            files[f'{stem}.atlas'] = _text_bytes(af.read())
        for mref in at.get('materials') or []:
            mo = get(mref)
            if mo is None:
                continue
            texs = dict(mo.read_typetree()['m_SavedProperties']['m_TexEnvs'])
            main, alpha = get(texs.get('_MainTex', {}).get('m_Texture')), get(texs.get('_AlphaTex', {}).get('m_Texture'))
            if main is None:
                continue
            mt = main.read()
            pages[safe_name(mt.m_Name) + '.png'] = merge_alpha(mt.image, alpha.read().image if alpha is not None else None)
    if f'{stem}.atlas' not in files or not pages:
        log(f'  warn {eid}: atlas or page textures missing')
        return 0
    sizes = {name: img.size for name, img in pages.items()}
    files[f'{stem}.atlas'] = normalize_atlas(files[f'{stem}.atlas'].decode('utf-8'), sizes).encode('utf-8')
    for fname, blob in files.items():
        (out_dir / fname).write_bytes(blob)
        manifest.setdefault(sub, {})[fname] = {'path': f'/assets/local/{sub}/{fname}', 'kind': 'TextAsset'}
    for fname, img in pages.items():
        img.save(out_dir / fname)
        manifest.setdefault(sub, {})[fname] = {'path': f'/assets/local/{sub}/{fname}', 'w': img.width, 'h': img.height,
                                               'kind': 'Texture2D'}
    return len(files) + len(pages)


def export_enemy_spines(ab_root, out_root, manifest, log, ids=None):
    """ENEMY_SPINES from the enemy art bundles (each bundle loaded on its own; stops once every model was found)."""
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    wanted, n = set(ids or ENEMY_SPINES), 0
    for f in sorted(Path(ab_root).glob(ENEMY_ART)):
        if not wanted:
            break
        try:
            env = UnityPy.load(str(f))
        except Exception as e:  # corrupt or unsupported bundle: report and continue
            log(f'FAIL load {f.name}: {e}')
            continue
        objects = {o.path_id: o for o in env.objects}
        for name, ref in env.container.items():
            eid = enemy_spine_id(name, wanted)
            if not eid:
                continue
            try:
                k = write_enemy_spine(objects, ref.read_typetree(), eid, out_root, manifest, log)
            except Exception as e:
                log(f'  warn {eid}: {e}')
                continue
            if k:
                wanted.discard(eid)
                n += k
                log(f'{f.relative_to(ab_root).as_posix()}: {eid} -> {ENEMY_SPINE_SUB}/{eid} ({k} files)')
    for eid in sorted(wanted):
        log(f'skip (not found) enemy Spine {eid}')
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--game', help='AssetBundle root (…/StreamingAssets/AB/Windows or …/Documents/Bundles)')
    ap.add_argument('--out', default=str(ROOT / 'public/assets/local'))
    ap.add_argument('--manifest', default=str(ROOT / 'data/local-assets.json'))
    ap.add_argument('--only', action='append', default=[], metavar='SUBDIR',
                    help='only run the jobs whose output subdir starts with this prefix (repeatable), e.g. emoticon')
    ap.add_argument('--print-jobs', action='store_true', help='print the job table as JSON and exit')
    ap.add_argument('--webp', action='store_true',
                    help='only write the WebP copies of the board textures from the PNGs already under --out and list '
                         'them in the manifest (needs Pillow, not the client)')
    args = ap.parse_args()

    if args.print_jobs:
        jobs = [{'bundle': rel, 'sub': sub, 'kinds': sorted(kinds), 'keep': keep.pattern if keep else None}
                for rel, sub, kinds, keep in map(job_parts, JOBS)]
        derived = [{'sub': sub, 'from': src, 'derive': kind, 'name': name} for sub, src, kind, name in DERIVED]
        webp = [{'sub': sub, 'name': name, 'mode': mode} for sub, name, mode in WEBP]
        print(json.dumps({'emoteThemes': [{'themeId': t, 'dir': d} for t, d in EMOTE_THEMES], 'jobs': jobs,
                          'derived': derived, 'webp': webp, 'enemySpines': {'bundles': ENEMY_ART, 'sub': ENEMY_SPINE_SUB,
                                                                            'ids': ENEMY_SPINES}}, ensure_ascii=False))
        return 0
    if args.webp:
        return webp_only(Path(args.out), Path(args.manifest), print)

    ab_root = Path(args.game) if args.game else next((p for p in CANDIDATES if p.exists()), None)
    if not ab_root or not ab_root.exists():
        print('No Arknights install found. Pass --game <AssetBundle root>.', file=sys.stderr)
        return 2
    jobs = select_jobs(args.only)
    enemy_spines = wants_sub(args.only, ENEMY_SPINE_SUB)
    if not jobs and not enemy_spines:
        print(f'--only {args.only}: no job matches', file=sys.stderr)
        return 2
    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)
    manifest, total = {}, 0
    print(f'AB root: {ab_root}')
    for job in jobs:
        total += export_bundle(ab_root, job, out_root, manifest, print)
    if enemy_spines:
        total += export_enemy_spines(ab_root, out_root, manifest, print)
    old = {}
    if args.only and Path(args.manifest).exists():
        try:
            old = json.loads(Path(args.manifest).read_text(encoding='utf-8')).get('groups') or {}
        except (OSError, ValueError) as e:
            print(f'warn: previous manifest unreadable ({e}); writing only the re-extracted groups', file=sys.stderr)
    groups = merge_manifest(old, manifest, set(manifest))  # a missing bundle keeps its previous group
    count = sum(len(v) for v in groups.values())
    doc = {'version': 1, 'source': 'local-client', 'count': count, 'groups': groups}
    Path(args.manifest).write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'done: {total} files extracted, manifest {args.manifest} ({count} entries)')
    return 0 if total else 1


if __name__ == '__main__':
    sys.exit(main())
