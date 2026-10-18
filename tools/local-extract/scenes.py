"""The official battlefield scenes of 卫戍协议 (DESIGN §15): every battlefield is a prebuilt Unity scene
(scenes/activities/<season>/level_<stage>/level_<stage>.ab, with …/lightingdata.ab beside it) whose tile models are
baked into "Combined Mesh (root: scene)" objects, plus loose meshes for the parts the game shows and hides.

The scene bundles ship only while the season runs (the hot-update list of an off-season client has none), so they are
read from the client's AB root when it has them and else from a directory of bundles kept from an in-season version
(extract.py --scenes <dir>, default .cache/official-scenes/*; tools/local-extract/fetch_scenes.py fills it). Materials
and their textures come from the theme bundles of the local client (SCENES lists each scene's, as the official asset
index records them: the scene bundle's dependencies).

Output per stage, under <out>/scene/<stageId>/ (manifest group scene/<stageId>):
  scene.json   { version, stage, light, lightmaps, lightRange, lightEncoding, env: { size, mips, range }, materials
                 (each with the names of its textures: map, normalMap, glossMap, and emissionMap when the
                 material's _EMISSION keyword is on), groups, chunks: [{ material, lightmap, group, verts, tris,
                 offset, index32, bounds }] }
  env.png      the scene's default reflection cubemap, decoded (env_atlas: 6 faces × the mip chain in one atlas)
  scene.bin    the chunks' vertex data in board space (x = column, y = row, z = height: Unity's anchor-local
               (x, y, −z)); per chunk: position f32×3, uv f32×2, lightmap uv f32×2 (scale / offset applied),
               normal i8×4, colour u8×4, indices u16|u32 (padded to 4 bytes)
  lm<i>.png    lightmap page i (+ a WebP copy, the one the manifest lists): RGB = the baked indirect light (Lightmap-<i>_comp_light, stored RGBM: decode_rgbm),
               A = the key light's baked shadow (Lightmap-<i>_comp_shadowmask, R)
and the materials' albedo, normal (normal_rgb), metallic-gloss and (only with the _EMISSION keyword) emission textures under
<out>/scene/tex/ (manifest group scene/tex, shared by the scenes). Normal, metallic-gloss and emission are lossless WebP;
albedo and lightmaps stay lossy. The manifest scene record's version (SCENE_EXTRACT_VERSION) is what
setup treats as fresh; scene.json version stays the mesh layout (SCENE_VERSION).
A chunk's `group` is '' for what the scene shows at rest and the sub-graphic name (HIDDEN@1 …, MapSubGraphicHolder)
for the meshes the game switches on later.
"""
import json
import re
import struct
from pathlib import Path

SAND = ['arts/maps/map_autochesssand/res.ab', 'arts/maps/map_survivaloasis_city/res.ab', 'arts/maps/map_yumen/res.ab']
SHORE = ['arts/maps/map_doss_shore/res.ab']
# (stage id, theme bundles of the local client that hold the scene's materials / textures / shared meshes): the
# dependencies of each scene bundle in the official asset index (Android 25-11-21-15-21-44_ee1197 for 盟约·上半,
# 26-03-13-06-11-47_14fb99 and 26-04-13-12-31-42_e9b560 for 盟约·下半 — the same in all three).
SCENES = [
    ('act1autochess_m01', SAND),
    ('act1autochess_m02', SAND),
    ('act1autochess_m03', SAND),
    ('act1autochess_m04', SAND),
    ('act1autochess_m05', SAND + SHORE),
    ('act1autochess_m06', SAND),
    ('act1autochess_m07', SAND),
    ('act2autochess_m01', ['arts/maps/map_lakegarden/res.ab', 'arts/maps/map_syracuse_metro/res.ab',
                           'arts/maps/common/meshes/s_background_common.ab']),
    ('act2autochess_m02', SAND),
    ('act2autochess_m03', ['arts/maps/map_kxmr/res.ab', 'arts/maps/map_kxmr/background_mesh/bg_kxmr.ab',
                           'arts/maps/map_lm_center/res.ab']),
    ('act2autochess_m04', SAND + SHORE),
]
# bundles every scene may reference besides its theme (shared water / noise textures)
COMMON_DEPS = ['arts/maps/effect.ab']
SCENE_SUB = 'scene'
TEX_SUB = 'scene/tex'
SCENE_VERSION = 1
# Manifest `scene` record (kind Scene) of each scene/<stageId> group. scene.json `version` stays SCENE_VERSION so a
# scene extracted before this still loads. setup / doctor compare this with expected.mjs and ask once when an
# existing record is older (DESIGN §34.12). 3: emission maps are lossless too, so a version-2 extract (normal and
# gloss only) is stale and that same prompt asks again. 4: remove exact redundant renderers (#684, §34.24).
SCENE_EXTRACT_VERSION = 4
# display-space light value that a lightmap page's 1.0 stands for (decode_rgbm; scene.json lightRange, with
# lightEncoding 'gamma'). The pages of the eleven scenes stay below 2.8.
LIGHT_RANGE = 3.0
LIGHT_ENCODING = 'gamma'
# material texture slots written to scene/tex: slot → key of the texture's name in scene.json materials[name].
# emissionMap is exported only when the _EMISSION keyword is on (map_exports): the Syracuse floor assigns
# _EmissionMap without the keyword, and the program does not sample it.
TEX_SLOTS = (('_MainTex', 'map'), ('_BumpMap', 'normalMap'), ('_MetallicGlossMap', 'glossMap'), ('_EmissionMap', 'emissionMap'))
# Data maps: channels are independent values. Lossy WebP's 4:2:0 chroma mixes them (extract.py WEBP 'lossless').
# Emission is a colour map, and the same 4:2:0 pass turns a saturated light grey
# (TX_KXMR_E (173,165,12) → (149,152,133) at quality 95), so it is lossless too, like the board's TX_autochessi_E.
# Albedo and lightmaps stay lossy.
LOSSLESS_MAPS = frozenset({'normalMap', 'glossMap', 'emissionMap'})
# RGBM range of a reflection cubemap in gamma colour space (the same 5 as the lightmap pages)
ENV_RGBM = 5.0
# bytes of one 4 × 4 block of the cubemap formats the scenes use
ENV_BLOCK_BYTES = {'ETC2_RGBA8': 16}
HIDDEN_NAME = re.compile(r'^[A-Z_]+@\d+$')
WATER_SHADERS = ('StylizedWater', 'StandardWater', 'DynamicWaterTile')
# [ASSUMED] Maintainer decision, 2026-10-17 (#684, DESIGN §34.24): correct exact source-scene duplicates,
# keeping the normal bake. This is an art correction, not an official visibility rule. In the official Android
# 26-04-13-12-31-42_e9b560 m03 scene, renderers 2048 / 2193 are the same rock, one statically batched and one loose;
# their world matrices are equal and baked/loose positions differ by at most 5.61e-7 tile. 1e-6 absolute (no relative
# tolerance) admits that float32 bake error, not the investigation's much looser 0.001 triangle-overlap tolerance.
DUPLICATE_EPSILON = 1e-6
RENDERER_BAKE_FIELDS = frozenset({
    'm_GameObject', 'm_StaticBatchInfo', 'm_StaticBatchRoot',
    'm_LightmapIndex', 'm_LightmapIndexDynamic', 'm_LightmapTilingOffset', 'm_LightmapTilingOffsetDynamic',
})


def renderer_state(tree, layer):
    """All serialized draw state, including material/texture identities, except object identity and bake metadata.
    PPtrs are file/path pairs in the same scene, so equal material references mean the same material and textures.
    Keep unknown fields: an unhandled renderer feature must prevent a deletion rather than broaden the rule.
    """
    return {'layer': layer, 'renderer': {k: v for k, v in tree.items() if k not in RENDERER_BAKE_FIELDS}}


def near_rows(a, b):
    """Equal shaped numeric rows within the absolute static-bake epsilon (NaN also fails)."""
    return len(a) == len(b) and all(len(x) == len(y) and all(abs(u - v) <= DUPLICATE_EPSILON for u, v in zip(x, y))
                                    for x, y in zip(a, b))


def same_renderer(a, b):
    """Full mesh equality after static batching: submeshes, oriented triangles and all surface vertex attributes.
    Compare world matrices too: differently transformed objects that happen to overlap are not duplicates.
    UV1 and lightmap assignments are deliberately excluded; those are what the surviving bake supplies.
    Triangle order is kept; ambiguity (including a different tessellation) conservatively keeps both renderers.
    """
    if a['state'] is None or a['state'] != b['state'] or not near_rows(a['world'], b['world']):
        return False
    if len(a['parts']) != len(b['parts']) or not a['parts']:
        return False
    for x, y in zip(a['parts'], b['parts']):
        if x['material'] != y['material'] or len(x['idx']) != len(y['idx']):
            return False
        xt, yt = x.get('tangent', []), y.get('tangent', [])
        xu, yu = x.get('extraUV', {}), y.get('extraUV', {})
        if bool(xt) != bool(yt) or xu.keys() != yu.keys():
            return False
        for i, j in zip(x['idx'], y['idx']):
            if x['uv'][i] != y['uv'][j] or x['col'][i] != y['col'][j]:
                return False
            if not near_rows([x['pos'][i], x['nrm'][i]], [y['pos'][j], y['nrm'][j]]):
                return False
            if xt and not near_rows([xt[i]], [yt[j]]):
                return False
            if any(xu[channel][i] != yu[channel][j] for channel in xu):
                return False
    return True


def renderer_bake_rank(r):
    """[ASSUMED] Prefer a non-collapsed lightmapped bake, then base visibility, then static baking; id breaks ties.
    The m03 loose copy has constant UV1. On m04 both UV1s have area, so the always-visible static bake wins.
    """
    baked = False
    for part in r['parts']:
        if part['lightmap'] < 0:
            continue
        uv, idx = part['uv1'], part['idx']
        for at in range(0, len(idx), 3):
            a, b, c = (uv[i] for i in idx[at:at + 3])
            if abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-12:
                baked = True
                break
    return (not baked, bool(r['group']), not r['static'], r['id'])


def drop_duplicate_renderers(renderers, log):
    """Filter complete normalized renderers, returning survivors in source order; log every dropped owner.
    [ASSUMED] A keeper must cover the removed copy's visibility: the same group, or an always-visible base.
    Separate hidden groups are not interchangeable, and an inactive base is not an always-visible keeper.
    """
    buckets, dropped = {}, set()
    for r in sorted(renderers, key=renderer_bake_rank):
        if r['state'] is None or not r['parts']:
            continue
        key = (json.dumps(r['state'], sort_keys=True), tuple((p['material'], len(p['idx'])) for p in r['parts']))
        bucket = buckets.setdefault(key, [])
        keeper = next((k for k in bucket if (k['group'] == r['group'] or k['group'] == '') and same_renderer(k, r)), None)
        if keeper is None:
            bucket.append(r)
            continue
        dropped.add(r['id'])
        triangles = sum(len(p['idx']) // 3 for p in r['parts'])
        log(f"  drop renderer #{r['id']} {r['path']} [{r['group'] or 'base'}]: exact duplicate of "
            f"#{keeper['id']} {keeper['path']} [{keeper['group'] or 'base'}], {triangles} triangles; keep normal bake")
    return [r for r in renderers if r['id'] not in dropped]


def scene_bundle(stage_id):
    """Bundle path of a stage's scene, relative to an AB root (act1autochess_m01 → scenes/activities/act1autochess/…)."""
    season = stage_id.rsplit('_', 1)[0]
    return f'scenes/activities/{season}/level_{stage_id}/level_{stage_id}.ab'


def find_scene(stage_id, roots):
    """The first existing scene bundle of `stage_id` under `roots` (AB roots), or None."""
    rel = scene_bundle(stage_id)
    for root in roots:
        p = Path(root) / rel
        if p.is_file():
            return p
    return None


# ---- small pure-Python linear algebra (row-major 3×4 affine matrices: [r0, r1, r2], each [a, b, c, t]) -----------

def trs(pos, rot, scale):
    """Affine matrix of a Unity local transform (position, quaternion xyzw, scale)."""
    x, y, z, w = rot
    r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[r[i][0] * scale[0], r[i][1] * scale[1], r[i][2] * scale[2], pos[i]] for i in range(3)]


def mul(a, b):
    """a · b of two affine matrices."""
    return [[a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j] + (a[i][3] if j == 3 else 0.0) for j in range(4)]
            for i in range(3)]


def det3(m):
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


IDENTITY = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]]


def to_board(p, anchor):
    """Unity world position → board space (x = column, y = row, z = height above the low ground)."""
    return (p[0] - anchor[0], p[1] - anchor[1], -(p[2] - anchor[2]))


def pack_chunk(ch):
    """Binary record of a chunk (see the module docstring); returns (bytes, index32)."""
    n = len(ch['pos'])
    flat = lambda rows: [v for row in rows for v in row]  # noqa: E731
    out = bytearray()
    out += struct.pack(f'<{n * 3}f', *flat(ch['pos']))
    out += struct.pack(f'<{n * 2}f', *flat(ch['uv']))
    out += struct.pack(f'<{n * 2}f', *flat(ch['uv1']))
    out += struct.pack(f'<{n * 4}b', *flat([(*(max(-127, min(127, int(round(c * 127)))) for c in nr), 0) for nr in ch['nrm']]))
    out += struct.pack(f'<{n * 4}B', *flat([tuple(max(0, min(255, int(round(c * 255)))) for c in col) for col in ch['col']]))
    idx32 = n > 65535
    out += struct.pack(f'<{len(ch["idx"])}{"I" if idx32 else "H"}', *ch['idx'])
    while len(out) % 4:  # // loop-cap: at most 3 padding bytes
        out.append(0)
    return bytes(out), idx32


def decode_rgbm(img):
    """RGB image of a baked lightmap page stored RGBM (texture usage BakedLightmapRGBM). The client renders in gamma
    colour space (PlayerSettings m_ActiveColorSpace 0), where Unity reads the page as light = 5 · A · RGB and adds it
    to the key light in display values: the page keeps that value / LIGHT_RANGE per channel, clamped to 1 (the
    renderer reads light = value · LIGHT_RANGE). A page without alpha is taken as plain RGB."""
    from PIL import Image
    if img.mode != 'RGBA':
        return img.convert('RGB')
    k = 5.0 / LIGHT_RANGE / 255
    rows = [bytes(min(255, int(a * c * k + 0.5)) for c in range(256)) for a in range(256)]
    r, g, b, a = img.split()
    alpha = a.tobytes()
    return Image.merge('RGB', tuple(Image.frombytes('L', img.size, bytes(rows[m][c] for m, c in zip(alpha, ch.tobytes())))
                                    for ch in (r, g, b)))


def normal_rgb(img):
    """RGB tangent-space normal map (the layout the official GLES program reads: xyz · 2 − 1) from the client's
    two-channel one, Z rebuilt per pixel. X and Y are read the way Unity unpacks them (x = R · A, y = G), which covers
    BC5 (R = X, G = Y, no alpha) and DXT5nm (R = 1, G = Y, A = X)."""
    from PIL import Image, ImageChops
    r, g, _b, a = img.convert('RGBA').split()
    x = ImageChops.multiply(r, a)  # exact when either factor is 255
    axis = [v / 127.5 - 1.0 for v in range(256)]
    rows = [bytes(int(round((max(0.0, 1.0 - nx * nx - ny * ny) ** 0.5 * 0.5 + 0.5) * 255)) for ny in axis) for nx in axis]
    z = bytes(rows[xb][yb] for xb, yb in zip(x.tobytes(), g.tobytes()))
    return Image.merge('RGB', (x, g, Image.frombytes('L', img.size, z)))


def env_atlas(data, size, mips, fmt, version, platform, intensity):
    """Atlas of a reflection cubemap stored RGBM (6 faces, each with its mip chain): mip m in the row at
    y = Σ sizes of the mips before it, face f (+X −X +Y −Y +Z −Z) at x = f · (size >> m), rows in stored order (the
    order the client uploads). A texel keeps the display-space light Unity's gamma-space decode gives
    (unity_SpecCube0_HDR.x · A · RGB, with .x = 5 · the scene's reflection intensity) / range. Returns (image, range),
    range being the brightest channel value of the cubemap."""
    from PIL import Image
    from UnityPy.enums import TextureFormat
    from UnityPy.export.Texture2DConverter import parse_image_data
    fmt = TextureFormat(fmt)
    block = ENV_BLOCK_BYTES[fmt.name]
    sizes = [max(1, size >> m) for m in range(mips)]
    lengths = [((s + 3) // 4) ** 2 * block for s in sizes]
    faces, at = [], 0
    for _f in range(6):
        row = []
        for s, ln in zip(sizes, lengths):
            row.append(parse_image_data(data[at:at + ln], s, s, fmt, version, platform, flip=False).convert('RGBA'))
            at += ln
        faces.append(row)
    k = ENV_RGBM * intensity / 255.0 / 255.0   # stored bytes → light
    top = max((max(px[0], px[1], px[2]) * px[3] for row in faces for im in row for px in im.getdata()), default=0) * k
    rng = max(0.01, round(top + 0.005, 2))
    scale = k / rng * 255.0
    rows = [bytes(min(255, int(a * c * scale + 0.5)) for c in range(256)) for a in range(256)]
    atlas = Image.new('RGB', (6 * size, sum(sizes)))
    y = 0
    for m, s in enumerate(sizes):
        for f in range(6):
            r, g, b, a = faces[f][m].split()
            alpha = a.tobytes()
            atlas.paste(Image.merge('RGB', tuple(Image.frombytes('L', (s, s), bytes(rows[q][c] for q, c in zip(alpha, ch.tobytes())))
                                                for ch in (r, g, b))), (f * s, y))
        y += s
    return atlas, rng


def map_exports(kind, keywords):
    """(unity slot, scene.json key) written when that texture is assigned. Gloss needs `_METALLICGLOSSMAP`.
    Emission needs `_EMISSION`. Anything but albedo is only for a lit material."""
    kw = keywords or ()
    lit = kind == 'lit'
    out = []
    for slot, key in TEX_SLOTS:
        if key != 'map' and not lit:
            continue
        if key == 'glossMap' and '_METALLICGLOSSMAP' not in kw:
            continue
        if key == 'emissionMap' and '_EMISSION' not in kw:
            continue
        out.append((slot, key))
    return out


def save_image(img, out_dir, stem, sub, lossless=False):
    """Write `img` as <stem>.png and a WebP copy beside it. `lossless` uses extract.py WEBP_OPTIONS['lossless']
    (normal, metallic-gloss and emission). Albedo and lightmaps stay lossy at quality 95 with the alpha lossless
    and the RGB under transparent texels kept. Returns the manifest entry, which lists the copy (the PNG when
    Pillow has no WebP)."""
    img.save(Path(out_dir) / f'{stem}.png')
    entry = {'path': f'/assets/local/{sub}/{stem}.png', 'w': img.width, 'h': img.height}
    try:
        if lossless:
            img.save(Path(out_dir) / f'{stem}.webp', 'WEBP', lossless=True, quality=100, method=6, exact=True)
            mode = 'lossless'
        else:
            img.save(Path(out_dir) / f'{stem}.webp', 'WEBP', quality=95, method=6, alpha_quality=100, exact=True)
            mode = 'lossy'
        entry.update(path=f'/assets/local/{sub}/{stem}.webp', webp=mode)
    except Exception:
        pass
    return entry


def hidden_groups(raw, objects):
    """{GameObject path id: sub-graphic name} of a MapSubGraphicHolder's raw data: after each name (HIDDEN@n) come the
    GameObjects and MeshTileGraphics of that group as PPtrs of this file. The script has no type tree in the bundle,
    so the fields are walked as 4-byte words: a length-prefixed name, or a (file 0, path id) pointer to an object."""
    out, group, i = {}, None, 0
    body = raw
    while i + 4 <= len(body):  # // loop-cap: len(body) / 4; each branch advances at least 4 bytes
        v = struct.unpack_from('<i', body, i)[0]
        if 0 < v < 64 and i + 4 + v <= len(body):
            text = body[i + 4:i + 4 + v]
            if all(32 <= b < 127 for b in text):
                s = text.decode('ascii')
                if HIDDEN_NAME.match(s):
                    group = s
                i += 4 + ((v + 3) & ~3)
                continue
        if v == 0 and i + 12 <= len(body) and group:
            pid = struct.unpack_from('<q', body, i + 4)[0]
            target = objects.get(pid)
            if target is not None:
                out[pid] = group
                i += 12
                continue
        i += 4
    return out


def export_scene(stage_id, deps, scene_path, ab_root, out_root, manifest, log, material_info, shader_deps=()):
    """Write one stage's scene (see the module docstring). Returns the number of files written (0 on failure)."""
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    from UnityPy.helpers.MeshHelper import MeshHandler
    from PIL import Image

    try:
        env = UnityPy.load(str(scene_path))
    except Exception as e:  # corrupt or unsupported bundle
        log(f'FAIL load {scene_path}: {e}')
        return 0
    objects = {o.path_id: o for o in env.objects}
    scene_objs = list(objects.values())
    light_bundle = scene_path.with_suffix('') / 'lightingdata.ab'
    extra = [light_bundle] if light_bundle.is_file() else []
    for dep in [*(Path(ab_root) / d for d in [*deps, *COMMON_DEPS]), *shader_deps]:
        if Path(dep).is_file():
            extra.append(Path(dep))
        else:
            log(f'  warn {stage_id}: dependency {dep} missing (its materials are skipped)')
    for dep in extra:
        try:
            env.load_file(str(dep))
        except Exception as e:
            log(f'  warn {stage_id}: dependency {Path(dep).name}: {e}')

    # ---- hierarchy: world matrices, active flags, hidden groups ---------------------------------------------------
    tf = {}  # transform path id → (local matrix, father id, game object)
    for o in scene_objs:
        if o.type.name != 'Transform':
            continue
        t = o.read()
        p, r, s = t.m_LocalPosition, t.m_LocalRotation, t.m_LocalScale
        tf[o.path_id] = (trs((p.x, p.y, p.z), (r.x, r.y, r.z, r.w), (s.x, s.y, s.z)), t.m_Father.m_PathID, t.m_GameObject)
    world_cache = {}

    def world(tid):
        if tid not in tf:
            return IDENTITY
        if tid not in world_cache:
            local, father, _ = tf[tid]
            world_cache[tid] = mul(world(father), local) if father else local
        return world_cache[tid]

    go_of_tf = {tid: rec[2].m_PathID for tid, rec in tf.items()}
    tf_of_go = {gid: tid for tid, gid in go_of_tf.items()}
    go_info = {}  # game object path id → (name, active)
    go_layers = {}
    for o in scene_objs:
        if o.type.name == 'GameObject':
            g = o.read()
            go_info[o.path_id] = (g.m_Name, bool(g.m_IsActive))
            go_layers[o.path_id] = g.m_Layer
    hidden = {}
    for o in scene_objs:
        if o.type.name != 'MonoBehaviour':
            continue
        raw = o.get_raw_data()
        if b'@' not in raw:
            continue
        for pid, group in hidden_groups(raw, objects).items():
            target = objects[pid]
            if target.type.name == 'GameObject':
                hidden[pid] = group
            elif target.type.name == 'MonoBehaviour':
                try:
                    hidden[target.read().m_GameObject.m_PathID] = group
                except Exception:
                    pass

    def state(gid):
        """(active in the hierarchy, hidden group of the object or its nearest grouped ancestor)."""
        active, group, tid = True, None, tf_of_go.get(gid)
        while tid in tf:  # // loop-cap: scene hierarchy depth (one parent per transform)
            g = go_of_tf[tid]
            active = active and go_info.get(g, ('', True))[1]
            if group is None and g in hidden:
                group = hidden[g]
            tid = tf[tid][1]
        return active, group

    def object_path(gid):
        names, tid = [], tf_of_go.get(gid)
        for _ in range(len(tf)):
            if tid not in tf:
                break
            names.append(go_info.get(go_of_tf[tid], ('?', True))[0])
            tid = tf[tid][1]
        return '/'.join(reversed(names))

    anchor = (0.0, 0.0, 0.0)
    for gid, (name, _) in go_info.items():
        if name == 'Anchor' and gid in tf_of_go:
            m = world(tf_of_go[gid])
            anchor = (m[0][3], m[1][3], m[2][3])
            break

    # ---- light ----------------------------------------------------------------------------------------------------
    light = None
    for o in scene_objs:
        if o.type.name != 'Light':
            continue
        d = o.read_typetree()
        if d.get('m_Type') != 1:  # directional
            continue
        m = world(tf_of_go.get(d['m_GameObject']['m_PathID']))
        fwd = (m[0][2], m[1][2], m[2][2])  # the light shines along its +z
        n = (fwd[0] ** 2 + fwd[1] ** 2 + fwd[2] ** 2) ** 0.5 or 1.0
        c = d.get('m_Color', {})
        light = {'dir': [round(-fwd[0] / n, 5), round(-fwd[1] / n, 5), round(fwd[2] / n, 5)],
                 'color': [round(c.get(k, 1.0), 5) for k in 'rgb'], 'intensity': round(d.get('m_Intensity', 1.0), 5)}
        break

    # ---- renderers → chunks -----------------------------------------------------------------------------------------
    mesh_cache, materials, mat_tex = {}, {}, {}
    renderers = []  # complete, per-renderer geometry before merging material/lightmap/group chunks

    def mesh_data(pptr):
        key = (getattr(pptr, 'm_FileID', 0), pptr.m_PathID)
        if key not in mesh_cache:
            try:
                h = MeshHandler(pptr.read())
                h.process()
                mesh_cache[key] = (h.m_Vertices, h.m_Normals, h.m_UV0, h.m_UV1, h.m_Colors, h.get_triangles(),
                                   getattr(h, 'm_Tangents', None),
                                   {i: getattr(h, f'm_UV{i}') for i in range(2, 8) if getattr(h, f'm_UV{i}', None)})
            except Exception as e:
                log(f'  warn {stage_id}: mesh #{pptr.m_PathID}: {e}')
                mesh_cache[key] = None
        return mesh_cache[key]

    def material_name(pptr):
        if not pptr.m_PathID:
            return None
        try:
            mat = pptr.read()
        except Exception:  # its bundle is not in the client
            return None
        name = mat.m_Name
        if name not in materials:
            info = material_info(mat)
            shader = info.get('shader') or ''
            info['kind'] = 'water' if any(w in shader for w in WATER_SHADERS) else 'lit'
            materials[name] = info
            try:
                for slot, env_ in mat.m_SavedProperties.m_TexEnvs:
                    if slot in dict(TEX_SLOTS) and env_.m_Texture.m_PathID:
                        mat_tex.setdefault(name, {})[slot] = env_.m_Texture
            except Exception:
                pass
        return name

    skipped = 0
    for o in scene_objs:
        if o.type.name != 'MeshRenderer':
            continue
        r = o.read()
        gid = r.m_GameObject.m_PathID
        mf = None
        for c in r.m_GameObject.read().m_Component:
            if c.component.type.name == 'MeshFilter':
                mf = c.component.read()
        if mf is None or not mf.m_Mesh.m_PathID:
            continue
        data = mesh_data(mf.m_Mesh)
        if not data:
            continue
        verts, normals, uv0, uv1, colors, tris, tangents, extra_uv = data
        active, group = state(gid)
        if not active and group is None:
            group = 'inactive'
        sb = r.m_StaticBatchInfo
        static = sb.subMeshCount > 0
        first = sb.firstSubMesh if static else 0
        m = IDENTITY if static else world(tf_of_go.get(gid))
        # board space mirrors Unity's z: the triangle order is reversed to stay counter-clockwise (three.js front
        # faces), unless the object's own transform already mirrors it
        flip = det3(m) > 0
        so = r.m_LightmapTilingOffset
        st = (1.0, 1.0, 0.0, 0.0) if static else (so.x, so.y, so.z, so.w)
        lm = r.m_LightmapIndex if r.m_LightmapIndex < 65534 else -1
        luv = uv1 if uv1 else uv0
        try:
            draw_state = renderer_state(o.read_typetree(), go_layers[gid])
        except Exception as e:
            log(f'  warn {stage_id}: renderer #{o.path_id} state unavailable; kept without deduplication: {e}')
            draw_state = None
        renderer = {'id': o.path_id, 'path': object_path(gid), 'group': group or '',
                    'world': world(tf_of_go.get(gid)), 'state': draw_state, 'static': static, 'parts': []}
        renderers.append(renderer)
        for k, mref in enumerate(r.m_Materials):
            sub = first + k
            if sub >= len(tris):
                renderer['state'] = None  # incomplete geometry cannot prove a full renderer duplicate
                break
            name = material_name(mref)
            if not name:
                skipped += 1
                renderer['state'] = None
                continue
            ch = {'material': name, 'lightmap': lm, 'pos': [], 'uv': [], 'uv1': [], 'nrm': [], 'col': [], 'idx': [],
                  'tangent': [], 'extraUV': {channel: [] for channel in extra_uv}}
            renderer['parts'].append(ch)
            remap = {}
            for tri in tris[sub]:
                tri = (tri[0], tri[2], tri[1]) if flip else tri
                for vi in tri:
                    j = remap.get(vi)
                    if j is None:
                        j = remap[vi] = len(ch['pos'])
                        v = verts[vi]
                        p = (m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2] + m[0][3],
                             m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2] + m[1][3],
                             m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2] + m[2][3])
                        ch['pos'].append(to_board(p, anchor))
                        nv = normals[vi] if normals else (0.0, 0.0, -1.0)
                        nw = (m[0][0] * nv[0] + m[0][1] * nv[1] + m[0][2] * nv[2],
                              m[1][0] * nv[0] + m[1][1] * nv[1] + m[1][2] * nv[2],
                              m[2][0] * nv[0] + m[2][1] * nv[1] + m[2][2] * nv[2])
                        ln = (nw[0] ** 2 + nw[1] ** 2 + nw[2] ** 2) ** 0.5 or 1.0
                        ch['nrm'].append((nw[0] / ln, nw[1] / ln, -nw[2] / ln))
                        # These attributes are not written to scene.bin, but differing source values still forbid
                        # deletion. Tangent handedness follows the world transform and the board's z reflection.
                        if tangents:
                            tv = tangents[vi]
                            tw = [sum(m[axis][j] * tv[j] for j in range(3)) for axis in range(3)]
                            tl = sum(c * c for c in tw) ** 0.5 or 1.0
                            ch['tangent'].append((tw[0] / tl, tw[1] / tl, -tw[2] / tl, -tv[3] if flip else tv[3]))
                        for channel, values in extra_uv.items():
                            ch['extraUV'][channel].append(tuple(values[vi]))
                        t0 = uv0[vi] if uv0 else (0.0, 0.0)
                        ch['uv'].append((t0[0], t0[1]))
                        t1 = luv[vi] if luv else (0.0, 0.0)
                        ch['uv1'].append((t1[0] * st[0] + st[2], t1[1] * st[1] + st[3]))
                        col = colors[vi] if colors else (1.0, 1.0, 1.0, 1.0)
                        ch['col'].append(tuple(col[:4]) if len(col) >= 4 else (*col[:3], 1.0))
                    ch['idx'].append(j)
    kept = drop_duplicate_renderers(renderers, lambda message: log(f'{stage_id}: {message}'))
    log(f'{stage_id}: dropped {len(renderers) - len(kept)} exact duplicate renderer(s); kept {len(kept)}')
    chunks = {}  # (material, lightmap, group) → {'pos': [], …}
    for renderer in kept:
        for part in renderer['parts']:
            key = (part['material'], part['lightmap'], renderer['group'])
            ch = chunks.setdefault(key, {'pos': [], 'uv': [], 'uv1': [], 'nrm': [], 'col': [], 'idx': []})
            offset = len(ch['pos'])
            for attr in ('pos', 'uv', 'uv1', 'nrm', 'col'):
                ch[attr].extend(part[attr])
            ch['idx'].extend(i + offset for i in part['idx'])
    if not chunks:
        log(f'  warn {stage_id}: no drawable mesh in {scene_path.name}')
        return 0

    # ---- write ------------------------------------------------------------------------------------------------------
    out_dir = Path(out_root) / SCENE_SUB / stage_id
    out_dir.mkdir(parents=True, exist_ok=True)
    sub = f'{SCENE_SUB}/{stage_id}'
    blob, records = bytearray(), []
    for (name, lm, group), ch in sorted(chunks.items(), key=lambda kv: (kv[0][2], kv[0][0], kv[0][1])):
        data, idx32 = pack_chunk(ch)
        xs, ys, zs = zip(*ch['pos'])
        records.append({'material': name, 'lightmap': lm, 'group': group, 'verts': len(ch['pos']), 'tris': len(ch['idx']) // 3,
                        'offset': len(blob), 'index32': idx32,
                        'bounds': [round(v, 3) for v in (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))]})
        blob += data
    n = 0
    (out_dir / 'scene.bin').write_bytes(bytes(blob))
    manifest.setdefault(sub, {})['bin'] = {'path': f'/assets/local/{sub}/scene.bin', 'kind': 'SceneData', 'bytes': len(blob)}
    n += 1

    # lightmap pages: light RGB + the shadow mask's R as alpha
    pages = {}
    for o in env.objects:
        if o.type.name != 'Texture2D':
            continue
        try:
            t = o.read()
        except Exception:
            continue
        mm = re.match(r'^Lightmap-(\d+)_comp_(light|shadowmask)$', t.m_Name or '')
        if mm:
            pages.setdefault(int(mm.group(1)), {})[mm.group(2)] = t
    used_pages = sorted({rec['lightmap'] for rec in records if rec['lightmap'] >= 0})
    lightmaps = 0
    for i in used_pages:
        page = pages.get(i, {})
        if 'light' not in page:
            log(f'  warn {stage_id}: lightmap {i} missing (drawn unlit)')
            continue
        try:
            rgb = decode_rgbm(page['light'].image)
            mask = page['shadowmask'].image.convert('RGB').getchannel('R').resize(rgb.size) if 'shadowmask' in page else Image.new('L', rgb.size, 255)
            img = Image.merge('RGBA', (*rgb.split(), mask))
            entry = save_image(img, out_dir, f'lm{i}', sub)
        except Exception as e:
            log(f'  warn {stage_id}: lightmap {i}: {e}')
            continue
        manifest[sub][f'lm{i}'] = {**entry, 'kind': 'Lightmap'}
        lightmaps = max(lightmaps, i + 1)
        n += 1

    # the reflection every surface shows (unity_SpecCube0): the baked cubemap of the ReflectionProbe whose box holds
    # the board (act2autochess_m01 / m03: one probe, box 40 / 50 units, every renderer set to blend probes), at the
    # probe's intensity; else the scene's default reflection cubemap (RenderSettings) at the scene's reflection
    # intensity. Unity picks by importance, then the smaller box.
    # [ASSUMED] one cubemap for the whole scene, chosen at the board's anchor: a renderer outside the probe's box (far
    # background) would show the default reflection in the client, and probes are not blended at the box's edge
    env_doc = None
    try:
        rs = next(o.read_typetree() for o in scene_objs if o.type.name == 'RenderSettings')
        want = rs['m_GeneratedSkyboxReflection']['m_PathID'] if rs.get('m_DefaultReflectionMode', 0) == 0 else rs['m_CustomReflection']['m_PathID']
        intensity = rs.get('m_ReflectionIntensity', 1.0)
        probes = []
        for o in scene_objs:
            if o.type.name != 'ReflectionProbe':
                continue
            d = o.read_typetree()
            gid = d['m_GameObject']['m_PathID']
            baked = (d.get('m_CustomBakedTexture') or {}).get('m_PathID') or (d.get('m_BakedTexture') or {}).get('m_PathID')
            if not d.get('m_Enabled', 1) or not baked or gid not in tf_of_go or not state(gid)[0]:
                continue
            m = world(tf_of_go[gid])
            size, off = d.get('m_BoxSize', {}), d.get('m_BoxOffset', {})
            half = [abs(size.get(k, 0.0)) / 2 for k in 'xyz']
            centre = [m[i][3] + off.get(k, 0.0) for i, k in enumerate('xyz')]
            if all(abs(anchor[i] - centre[i]) <= half[i] for i in range(3)):
                probes.append((-d.get('m_Importance', 1), half[0] * half[1] * half[2], baked, d.get('m_IntensityMultiplier', 1.0)))
        if probes:
            _, _, want, intensity = min(probes)
        cubes = [o for o in env.objects if o.type.name == 'Cubemap']
        cube = next((o for o in cubes if o.path_id == want), None)
        if cube is not None:
            t = cube.read()
            atlas, rng = env_atlas(bytes(t.get_image_data()), t.m_Width, t.m_MipCount, t.m_TextureFormat, cube.assets_file.version,
                                   cube.assets_file.target_platform, intensity)
            atlas.save(out_dir / 'env.png')   # PNG only: a lossy copy would bleed between the atlas cells
            manifest[sub]['env'] = {'path': f'/assets/local/{sub}/env.png', 'w': atlas.width, 'h': atlas.height, 'kind': 'Reflection'}
            env_doc = {'size': t.m_Width, 'mips': t.m_MipCount, 'range': rng, 'source': 'probe' if probes else 'default'}
            n += 1
    except Exception as e:
        log(f'  warn {stage_id}: reflection cubemap: {e}')

    # textures of the materials (shared by the scenes): albedo, and the normal / metallic-gloss / emission maps
    tex_dir = Path(out_root) / TEX_SUB
    tex_dir.mkdir(parents=True, exist_ok=True)
    for name, slots in sorted(mat_tex.items()):
        info = materials[name]
        for slot, key in map_exports(info.get('kind'), info.get('keywords')):
            pptr = slots.get(slot)
            if pptr is None:
                continue
            try:
                tex = pptr.read()
                tname = re.sub(r'[^A-Za-z0-9_.\-\[\]]+', '_', tex.m_Name or f'tex_{pptr.m_PathID}')
                materials[name][key] = tname
                if tname in manifest.get(TEX_SUB, {}):
                    continue
                img = normal_rgb(tex.image) if key == 'normalMap' else tex.image
                manifest.setdefault(TEX_SUB, {})[tname] = {**save_image(img, tex_dir, tname, TEX_SUB, key in LOSSLESS_MAPS), 'kind': 'Texture2D'}
                n += 1
            except Exception as e:
                log(f'  warn {stage_id}: texture {slot} of {name}: {e}')

    doc = {'version': SCENE_VERSION, 'stage': stage_id, 'bundle': scene_bundle(stage_id), 'light': light, 'lightmaps': lightmaps,
           'lightRange': LIGHT_RANGE, 'lightEncoding': LIGHT_ENCODING, **({'env': env_doc} if env_doc else {}),
           'materials': dict(sorted(materials.items())), 'groups': sorted({rec['group'] for rec in records}),
           'chunks': records, 'binBytes': len(blob)}
    (out_dir / 'scene.json').write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    manifest[sub]['scene'] = {'path': f'/assets/local/{sub}/scene.json', 'kind': 'Scene', 'chunks': len(records),
                              'version': SCENE_EXTRACT_VERSION}
    n += 1
    verts = sum(rec['verts'] for rec in records)
    log(f'{scene_path.name}: {len(records)} chunks, {verts} vertices, {lightmaps} lightmaps -> {sub}'
        + (f' ({skipped} sub-meshes without a material)' if skipped else ''))
    return n
