"""规程 (act3autochess) battlefield art, in the same scene/<stageId>/ format as scenes.py.

The season's level_<stage>.ab is the logic scene (tile names, colliders). The meshes live in three prefabs,
level_<stage>_sub_01 / _02 / _03, which the client instantiates onto that scene: sub_01 four times (one block per
player), sub_02 once (the 联防 board), sub_03 twice (the two boss fields with their pens). Each prefab is in piece-local
board space already: after the hierarchy's world matrix, x is the column and y the row counted from the bottom of
that piece, z the Unity height (to_board negates it). There is no Anchor to subtract — the prefab root is the origin.
[ASSUMED] confirmed on act3autochess_m01's sub_01 and sub_03 corners (a ground tile at grid (row 0, col 0) sits on
(0, 0, −0.4)); the same frame is used for every stage.

Each piece is written whole, in its own frame, as one group named after it (PIECE_GROUPS: 'sub_01', 'sub_02',
'sub_03'), and scene.json says so (`layout: 'pieces'`, `pieceGrid`: each group's rows × cols). Nothing is cut or
moved here: the client draws the one piece a view shows at the place the stage's `arena` gives it in the 19×21 grid
(data/stages.json arena.regions[].field, tools/versions/layouts.mjs PIECE_FIELD; board3d/scene.js), so the own
board is sub_01 with its pen beside the road, 联防 is sub_02 and the boss round sub_03, each with its own water,
background and props as the client draws them.

Lightmaps. The three pieces each bake Lightmap-0. _atlas packs them into one 2×2 page. Pillow's LANCZOS
resamples RGBA in premultiplied RGBa, so a texel whose shadowmask alpha is 0 loses the indirect RGB that
decode_rgbm stored there. The client adds those channels separately (sceneMaterial: lm.rgb * uLmScale, shade
= lm.a), and the riverbed then reads black. resize_straight resizes RGB and A apart. lightmap_black_share
prints, per chunk, the fraction of vertices whose lightmap texel is near black before that fix and after.

Lightmaps are baked, but not on MeshRenderer.m_LightmapIndex (that field is 65535). The prefab root's
m_RendererInfo stores lightmapIndex and lightmapOffsetScale per renderer, and the prefab embeds
Lightmap-0_comp_light plus a shadowmask. Many ground tiles have UV0 and no UV1; the lightmap scale on those
is about ten times a tile that does have UV1, which is what you get when the baker's only UV island is the
albedo UV. [ASSUMED] UV1 is the lightmap channel when present, otherwise UV0, then the offset/scale — the
same fallback scenes.py uses. There is no reflection probe in the prefab, so scene.json has no env and the
client uses its no-cubemap formula. The key light is the prefab's directional Mainlight (the first piece's).

Materials are not all in the sand theme. STAGE_DEPS is the bundle each stage's material fileID names
(m01–m04 and m06 sand, m05 Syracuse metro, m09/m11 icewild, m10/m12 ltny2) plus the one external mesh.
"""
import json
import math
import re
from pathlib import Path

import scenes

# m01–m06 and m09–m12. m07 / m08 are not in the season's levelprefab list.
REGULATION_IDS = (
    'act3autochess_m01', 'act3autochess_m02', 'act3autochess_m03',
    'act3autochess_m04', 'act3autochess_m05', 'act3autochess_m06',
    'act3autochess_m09', 'act3autochess_m10', 'act3autochess_m11', 'act3autochess_m12',
)
# Material bundle of each stage: the CAB its MeshRenderer materials point at, named from that bundle's
# UnityFS directory. m01–m04 and m06 are the sand theme (plus two effect materials). m05 is Syracuse metro,
# m09 and m11 are icewild, m10 and m12 are ltny2. The second path is the one external mesh that is not
# "unity default resources" (fog, which is not exported).
STAGE_DEPS = {
    'act3autochess_m01': ('arts/maps/map_autochesssand/res.ab', 'arts/maps/effect.ab'),
    'act3autochess_m02': ('arts/maps/map_autochesssand/res.ab', 'arts/maps/effect.ab'),
    'act3autochess_m03': ('arts/maps/map_autochesssand/res.ab', 'arts/maps/effect.ab'),
    'act3autochess_m04': ('arts/maps/map_autochesssand/res.ab', 'arts/maps/effect.ab'),
    'act3autochess_m05': ('arts/maps/map_syracuse_metro/res.ab', 'arts/maps/common/meshes/s_background_common.ab'),
    'act3autochess_m06': ('arts/maps/map_autochesssand/res.ab', 'arts/maps/effect.ab'),
    'act3autochess_m09': ('arts/maps/map_icewild/res.ab', 'arts/maps/map_icewild/background_mesh/s_background_icewild.ab'),
    'act3autochess_m10': ('arts/maps/map_ltny2/res.ab', 'arts/maps/map_ltny2/background_mesh/bg_church_tower.ab'),
    'act3autochess_m11': ('arts/maps/map_icewild/res.ab', 'arts/maps/map_icewild/background_mesh/s_background_icewild.ab'),
    'act3autochess_m12': ('arts/maps/map_ltny2/res.ab', 'arts/maps/map_ltny2/background_mesh/bg_church_tower.ab'),
}

# piece → its group in scene.json, and its size (rows × cols): sub_01 7×20, sub_02 6×21, sub_03 13×21.
PIECE_GROUPS = {1: 'sub_01', 2: 'sub_02', 3: 'sub_03'}
PIECE_ROWS = {1: 7, 2: 6, 3: 13}
PIECE_COLS = {1: 20, 2: 21, 3: 21}
BLACK_THRESHOLD = 8
WATER_NAME = re.compile(r'_water\d*$', re.I)
LIGHTMAP_NAME = re.compile(r'^Lightmap-(\d+)_comp_(light|shadowmask)$')


def resize_straight(image, size, resample):
    """Resize an RGBA image without premultiplying RGB by alpha.

    Pillow converts RGBA to premultiplied RGBa before a filtered resize, so a texel whose
    alpha is 0 comes back as RGB 0. A regulation lightmap stores indirect light in RGB and
    the shadowmask in A (scenes.decode_rgbm, then the shadowmask's R). The client adds
    those channels separately (sceneMaterial: lm.rgb * uLmScale, shade = lm.a), so the
    premultiply turns a lit, unshadowed texel black. RGB and A are resized apart and merged.
    `size` is (width, height). `resample` is a PIL filter (LANCZOS for the page, NEAREST
    for the gutter).
    """
    from PIL import Image
    image = image.convert('RGBA')
    red, green, blue, alpha = image.split()
    rgb = Image.merge('RGB', (red, green, blue)).resize(size, resample)
    mask = alpha.resize(size, resample)
    return Image.merge('RGBA', (*rgb.split(), mask))


def lightmap_black_share(image, uvs, threshold=BLACK_THRESHOLD, indices=None):
    """Fraction of lightmap samples whose texel is near black.

    The client uploads lightmaps with flipY, so v = 0 is the image's bottom row
    (board3d/scene.js makeTexture). A UV outside [0, 1] counts as black: that sample
    misses the baked page. `uvs` is one (u, v) per stored vertex. Pass `indices` to
    count each triangle corner once (a shared vertex is sampled once per use); without
    it each stored vertex counts once. Returns 0 when there is nothing to sample.
    Near black is max(R, G, B) <= threshold (BLACK_THRESHOLD).
    """
    samples = uvs if indices is None else [uvs[i] for i in indices]
    if not samples:
        return 0.0
    if image.mode != 'RGBA':
        image = image.convert('RGBA')
    width, height = image.size
    pixels = image.load()
    black = 0
    for u, v in samples:
        if u < 0.0 or v < 0.0 or u > 1.0 or v > 1.0 or width < 1 or height < 1:
            black += 1
            continue
        x = int(u * (width - 1) + 0.5)
        y = int((1.0 - v) * (height - 1) + 0.5)
        if x < 0:
            x = 0
        elif x >= width:
            x = width - 1
        if y < 0:
            y = 0
        elif y >= height:
            y = height - 1
        red, green, blue, _alpha = pixels[x, y]
        if max(red, green, blue) <= threshold:
            black += 1
    return black / len(samples)


def prefab_rel(stage_id, piece):
    """Bundle path of one piece, relative to an AB root or a --scenes backup."""
    season = stage_id.rsplit('_', 1)[0]
    name = f'level_{stage_id}_sub_0{piece}'
    return f'battle/prefabs/levelprefabs/activities/{season}/level_{stage_id}/{name}/{name}.ab'


def find_prefab(stage_id, piece, roots):
    rel = prefab_rel(stage_id, piece)
    for root in roots:
        path = Path(root) / rel
        if path.is_file():
            return path
    return None


def _kind(name, info):
    shader = info.get('shader') or ''
    if 'DynamicWaterTile' in shader:
        return 'water'
    if any(w in shader for w in scenes.WATER_SHADERS) or WATER_NAME.search(name or ''):
        return 'water'
    return 'lit'


def _vec4(st):
    if not isinstance(st, dict):
        return (1.0, 1.0, 0.0, 0.0)
    return (float(st.get('x', 1.0)), float(st.get('y', 1.0)), float(st.get('z', 0.0)), float(st.get('w', 0.0)))


def _renderer_light(objects):
    """{renderer path id: (lightmap index or -1, (scale.xy, offset.xy))} from m_RendererInfo."""
    out = {}
    for obj in objects:
        if obj.type.name != 'MonoBehaviour':
            continue
        try:
            tree = obj.read_typetree()
        except Exception:
            continue
        infos = tree.get('m_RendererInfo')
        if not infos:
            continue
        for rec in infos:
            ptr = rec.get('renderer') or {}
            pid = ptr.get('m_PathID') if isinstance(ptr, dict) else None
            if not pid:
                continue
            index = rec.get('lightmapIndex', -1)
            if not isinstance(index, int) or index >= 65534 or index < 0:
                index = -1
            out[pid] = (index, _vec4(rec.get('lightmapOffsetScale')))
    return out


def _active(tf, go_info, go_of_tf, tf_of_go, gid):
    tid = tf_of_go.get(gid)
    while tid in tf:
        owner = go_of_tf[tid]
        if not go_info.get(owner, ('', True))[1]:
            return False
        tid = tf[tid][1]
    return tid is None or tid not in tf


def _light_doc(objects, tf, tf_of_go):
    for obj in objects:
        if obj.type.name != 'Light':
            continue
        data = obj.read_typetree()
        if data.get('m_Type') != 1:
            continue
        gid = data['m_GameObject']['m_PathID']
        matrix = _world(tf, tf_of_go.get(gid))
        fwd = (matrix[0][2], matrix[1][2], matrix[2][2])
        length = (fwd[0] ** 2 + fwd[1] ** 2 + fwd[2] ** 2) ** 0.5 or 1.0
        color = data.get('m_Color') or {}
        return {'dir': [round(-fwd[0] / length, 5), round(-fwd[1] / length, 5), round(fwd[2] / length, 5)],
                'color': [round(color.get(k, 1.0), 5) for k in 'rgb'],
                'intensity': round(data.get('m_Intensity', 1.0), 5)}
    return None


def _world(tf, tid, cache=None):
    if cache is None:
        cache = {}
    if tid not in tf:
        return scenes.IDENTITY
    if tid not in cache:
        local, father, _gid = tf[tid]
        cache[tid] = scenes.mul(_world(tf, father, cache), local) if father else local
    return cache[tid]


def _hierarchy(objects):
    tf, go_info = {}, {}
    for obj in objects:
        if obj.type.name == 'Transform':
            transform = obj.read()
            pos, rot, scale = transform.m_LocalPosition, transform.m_LocalRotation, transform.m_LocalScale
            father = transform.m_Father.m_PathID if transform.m_Father else 0
            tf[obj.path_id] = (scenes.trs((pos.x, pos.y, pos.z), (rot.x, rot.y, rot.z, rot.w), (scale.x, scale.y, scale.z)),
                               father, transform.m_GameObject.m_PathID)
        elif obj.type.name == 'GameObject':
            game = obj.read()
            go_info[obj.path_id] = (game.m_Name, bool(game.m_IsActive))
    go_of_tf = {tid: rec[2] for tid, rec in tf.items()}
    tf_of_go = {gid: tid for tid, gid in go_of_tf.items()}
    return tf, go_info, go_of_tf, tf_of_go


def _apply(matrix, point):
    x, y, z = point
    return (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z + matrix[0][3],
            matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z + matrix[1][3],
            matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z + matrix[2][3])


def _load_pieces(paths, deps, log, stage_id):
    """Load the three prefabs, then the shared material bundles, once.

    Objects are split by the assets file they had before the dependencies were loaded, so a MeshRenderer
    that lives in effect.ab is not exported as part of the board.
    """
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    env = UnityPy.load(str(paths[0]))
    filesets = [{obj.assets_file for obj in env.objects}]
    for path in paths[1:]:
        before = {obj.assets_file for obj in env.objects}
        env.load_file(str(path))
        filesets.append({obj.assets_file for obj in env.objects} - before)
    for dep in deps:
        if not Path(dep).is_file():
            log(f'  warn {stage_id}: dependency {dep} missing (its materials are skipped)')
            continue
        try:
            env.load_file(str(dep))
        except Exception as e:
            log(f'  warn {stage_id}: dependency {Path(dep).name}: {e}')
    grouped = [[] for _ in filesets]
    for obj in env.objects:
        for i, files in enumerate(filesets):
            if obj.assets_file in files:
                grouped[i].append(obj)
                break
    return grouped


def _mesh(pptr, cache, log, stage_id):
    from UnityPy.helpers.MeshHelper import MeshHandler
    key = (getattr(pptr, 'm_FileID', 0), pptr.m_PathID)
    if key not in cache:
        try:
            handler = MeshHandler(pptr.read())
            handler.process()
            cache[key] = (handler.m_Vertices, handler.m_Normals, handler.m_UV0, handler.m_UV1, handler.m_Colors, handler.get_triangles())
        except Exception as e:
            log(f'  warn {stage_id}: mesh #{pptr.m_PathID}: {e}')
            cache[key] = None
    return cache[key]


def _chunks_of_piece(piece, objects, log, stage_id, material_info, device=False):
    """Every triangle of one prefab, in its own frame, keyed by (material, the prefab's own lightmap index, group)."""
    tf, go_info, go_of_tf, tf_of_go = _hierarchy(objects)
    lights = _renderer_light(objects)
    cache, materials, mat_tex = {}, {}, {}
    chunks = {}
    group = 'device:trap_196_cnnon' if device else PIECE_GROUPS[piece]
    stats = {'tris': 0, 'inactive': 0, 'nomat': 0, 'static': 0}
    world_cache = {}

    def material_name(pptr):
        if not pptr or not pptr.m_PathID:
            return None
        try:
            mat = pptr.read()
        except Exception:
            return None
        name = mat.m_Name
        if name not in materials:
            info = material_info(mat)
            info['kind'] = _kind(name, info)
            materials[name] = info
            try:
                for slot, env_ in mat.m_SavedProperties.m_TexEnvs:
                    if slot in dict(scenes.TEX_SLOTS) and env_.m_Texture.m_PathID:
                        mat_tex.setdefault(name, {})[slot] = env_.m_Texture
            except Exception:
                pass
        return name

    for obj in objects:
        if obj.type.name != 'MeshRenderer':
            continue
        renderer = obj.read()
        gid = renderer.m_GameObject.m_PathID
        if gid not in tf_of_go:
            continue
        if device:
            tid, names = tf_of_go[gid], []
            while tid in tf:
                names.append(go_info.get(go_of_tf[tid], ('', True))[0])
                tid = tf[tid][1]
            if not '/'.join(reversed(names)).startswith('trap_196_cnnon/Graphic/'):
                continue
        if not _active(tf, go_info, go_of_tf, tf_of_go, gid):
            stats['inactive'] += 1
            continue
        mesh_filter = None
        try:
            components = renderer.m_GameObject.read().m_Component
        except Exception:
            continue
        for comp in components:
            try:
                if comp.component.type.name == 'MeshFilter':
                    mesh_filter = comp.component.read()
            except Exception:
                continue
        if mesh_filter is None or not mesh_filter.m_Mesh or not mesh_filter.m_Mesh.m_PathID:
            continue
        data = _mesh(mesh_filter.m_Mesh, cache, log, stage_id)
        if not data:
            continue
        verts, normals, uv0, uv1, colors, tris = data
        batch = renderer.m_StaticBatchInfo
        static = bool(batch and batch.subMeshCount > 0)
        if static:
            stats['static'] += 1
        matrix = scenes.IDENTITY if static else _world(tf, tf_of_go.get(gid), world_cache)
        if device:
            # The stage faces DOWN; the token graphic's authored frame faces UP.
            matrix = scenes.mul(scenes.trs((0,0,0), (0,0,1,0), (1,1,1)), matrix)
        flip = scenes.det3(matrix) > 0
        index, scale = lights.get(obj.path_id, (-1, (1.0, 1.0, 0.0, 0.0)))
        luv = uv1 if uv1 else uv0
        first = batch.firstSubMesh if static else 0
        for sub, mref in enumerate(renderer.m_Materials or []):
            slot = first + sub
            if slot >= len(tris):
                break
            name = material_name(mref)
            if not name:
                stats['nomat'] += 1
                continue
            chunk = chunks.setdefault((name, index, group), {'pos': [], 'uv': [], 'uv1': [], 'nrm': [], 'col': [], 'idx': []})
            for tri in tris[slot]:
                stats['tris'] += 1
                order = (tri[0], tri[2], tri[1]) if flip else tri
                base = len(chunk['pos'])
                for vi in order:
                    chunk['pos'].append(scenes.to_board(_apply(matrix, verts[vi]), (0.0, 0.0, 0.0)))
                    src = normals[vi] if normals else (0.0, 0.0, -1.0)
                    nw = (matrix[0][0] * src[0] + matrix[0][1] * src[1] + matrix[0][2] * src[2],
                          matrix[1][0] * src[0] + matrix[1][1] * src[1] + matrix[1][2] * src[2],
                          matrix[2][0] * src[0] + matrix[2][1] * src[1] + matrix[2][2] * src[2])
                    length = (nw[0] ** 2 + nw[1] ** 2 + nw[2] ** 2) ** 0.5 or 1.0
                    chunk['nrm'].append((nw[0] / length, nw[1] / length, -nw[2] / length))
                    tex = uv0[vi] if uv0 else (0.0, 0.0)
                    chunk['uv'].append((tex[0], tex[1]))
                    lm = luv[vi] if luv else (0.0, 0.0)
                    chunk['uv1'].append((lm[0] * scale[0] + scale[2], lm[1] * scale[1] + scale[3]))
                    col = colors[vi] if colors else (1.0, 1.0, 1.0, 1.0)
                    chunk['col'].append(tuple(col[:4]) if len(col) >= 4 else (*col[:3], 1.0))
                chunk['idx'].extend((base, base + 1, base + 2))
    return chunks, materials, mat_tex, _light_doc(objects, tf, tf_of_go), _pages(objects), stats


def _pages(objects):
    pages = {}
    for obj in objects:
        if obj.type.name != 'Texture2D':
            continue
        try:
            tex = obj.read()
        except Exception:
            continue
        match = LIGHTMAP_NAME.match(tex.m_Name or '')
        if match:
            pages.setdefault(int(match.group(1)), {})[match.group(2)] = tex
    return pages


def _shift_pages(chunks, page_of):
    """Replace each chunk's prefab-local lightmap index with the stage page, or -1 when that page is absent."""
    out = {}
    for (name, local, group), chunk in chunks.items():
        page = page_of.get(local, -1) if local >= 0 else -1
        key = (name, page, group)
        dest = out.setdefault(key, {'pos': [], 'uv': [], 'uv1': [], 'nrm': [], 'col': [], 'idx': []})
        base = len(dest['pos'])
        for attr in ('pos', 'uv', 'uv1', 'nrm', 'col'):
            dest[attr].extend(chunk[attr])
        dest['idx'].extend(i + base for i in chunk['idx'])
    return out


def _write(stage_id, chunks, materials, mat_tex, light, images, out_root, manifest, log, tile_depth=None):
    from PIL import Image
    out_dir = Path(out_root) / scenes.SCENE_SUB / stage_id
    out_dir.mkdir(parents=True, exist_ok=True)
    sub = f'{scenes.SCENE_SUB}/{stage_id}'
    blob, records = bytearray(), []
    for (name, page, group), chunk in sorted(chunks.items(), key=lambda kv: (kv[0][2], kv[0][0], kv[0][1])):
        if not chunk['pos']:
            continue
        data, idx32 = scenes.pack_chunk(chunk)
        xs, ys, zs = zip(*chunk['pos'])
        records.append({'material': name, 'lightmap': page, 'group': group, 'verts': len(chunk['pos']),
                        'tris': len(chunk['idx']) // 3, 'offset': len(blob), 'index32': idx32,
                        'bounds': [round(v, 3) for v in (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))]})
        blob += data
    if not records:
        log(f'  warn {stage_id}: no regulation triangle')
        return 0
    bin_parts = scenes.write_scene_bins(out_dir, blob)
    written = scenes.record_scene_bins(manifest.setdefault(sub, {}), sub, bin_parts)
    lightmaps = 0
    for index, image in enumerate(images):
        try:
            entry = scenes.save_image(image, out_dir, f'lm{index}', sub)
        except Exception as e:
            log(f'  warn {stage_id}: lightmap {index}: {e}')
            continue
        manifest[sub][f'lm{index}'] = {**entry, 'kind': 'Lightmap'}
        lightmaps = index + 1
        written += 1
    tex_dir = Path(out_root) / scenes.TEX_SUB
    tex_dir.mkdir(parents=True, exist_ok=True)
    for name, slots in sorted(mat_tex.items()):
        info = materials[name]
        for slot, key in scenes.map_exports(info.get('kind'), info.get('keywords')):
            pptr = slots.get(slot)
            if pptr is None:
                continue
            try:
                tex = pptr.read()
                tname = re.sub(r'[^A-Za-z0-9_.\-\[\]]+', '_', tex.m_Name or f'tex_{pptr.m_PathID}')
                materials[name][key] = tname
                if tname not in manifest.get(scenes.TEX_SUB, {}):
                    img = scenes.normal_rgb(tex.image) if key == 'normalMap' else tex.image
                    manifest.setdefault(scenes.TEX_SUB, {})[tname] = {
                        **scenes.save_image(img, tex_dir, tname, scenes.TEX_SUB, key in scenes.LOSSLESS_MAPS), 'kind': 'Texture2D'}
                    written += 1
                if key == 'map':
                    written += scenes.export_opaque_albedo(info, out_root, manifest)
            except Exception as e:
                log(f'  warn {stage_id}: texture {slot} of {name}: {e}')
    doc = {'version': scenes.SCENE_VERSION, 'stage': stage_id,
           'bundle': prefab_rel(stage_id, 1),
           'pieces': [prefab_rel(stage_id, i) for i in (1, 2, 3)],
           'light': light, 'lightmaps': lightmaps, 'lightRange': scenes.LIGHT_RANGE, 'lightEncoding': scenes.LIGHT_ENCODING,
           'layout': 'pieces', 'pieceGrid': {PIECE_GROUPS[i]: [PIECE_ROWS[i], PIECE_COLS[i]] for i in (1, 2, 3)},
           'materials': dict(sorted(materials.items())), 'groups': sorted({rec['group'] for rec in records}),
           'chunks': records, 'binBytes': len(blob)}
    if len(bin_parts) > 1:
        doc['binParts'] = [part['bytes'] for part in bin_parts]
    if any(rec['group'] == 'device:trap_196_cnnon' for rec in records):
        doc['deviceModels'] = {'trap_196_cnnon': 'device:trap_196_cnnon'}
    if tile_depth:
        doc['tileDepthHeights'] = tile_depth
    (out_dir / 'scene.json').write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    manifest[sub]['scene'] = {'path': f'/assets/local/{sub}/scene.json', 'kind': 'Scene', 'chunks': len(records),
                              'version': scenes.SCENE_EXTRACT_VERSION}
    written += 1
    verts = sum(rec['verts'] for rec in records)
    log(f'{stage_id}: {len(records)} chunks, {verts} vertices, {lightmaps} lightmaps -> {sub}')
    return written


def _decode_page(page, log, stage_id, index):
    from PIL import Image
    if 'light' not in page:
        log(f'  warn {stage_id}: lightmap {index} missing (those triangles use the ambient key light)')
        return None
    try:
        rgb = scenes.decode_rgbm(page['light'].image)
        mask = page['shadowmask'].image.convert('RGB').getchannel('R').resize(rgb.size) if 'shadowmask' in page else Image.new('L', rgb.size, 255)
        return Image.merge('RGBA', (*rgb.split(), mask))
    except Exception as e:
        log(f'  warn {stage_id}: lightmap {index}: {e}')
        return None


ATLAS_GUTTER = 8


def atlas_slot(index, slot, gutter=ATLAS_GUTTER):
    """Where lightmap page `index` lands in the 2 × 2 atlas of `slot`-sized cells: (column, row from the bottom,
    inner size, atlas size). Row 0 is the bottom half because the client uploads lightmaps with flipY (v = 0 is the
    image's bottom row, board3d/scene.js makeTexture)."""
    return index % 2, index // 2, slot - 2 * gutter, 2 * slot


def atlas_uv(u, v, index, slot, gutter=ATLAS_GUTTER):
    """A page-local lightmap UV moved into the atlas (atlas_slot)."""
    col, row, inner, size = atlas_slot(index, slot, gutter)
    return (col * slot + gutter + u * inner) / size, (row * slot + gutter + v * inner) / size


def _compose_atlas(images, gutter, straight):
    """One 2 × 2 atlas. `straight` resizes RGB and A apart (resize_straight); otherwise Pillow's RGBA resize, which
    premultiplies and is kept only so lightmap_black_share can print the before number."""
    from PIL import Image
    slot = max(max(im.width, im.height) for im in images)
    _, _, inner, size = atlas_slot(0, slot, gutter)
    atlas = Image.new('RGBA', (size, size), (0, 0, 0, 255))
    for index, image in enumerate(images):
        col, row, _, _ = atlas_slot(index, slot, gutter)
        if straight:
            page = resize_straight(image, (inner, inner), Image.LANCZOS)
            cell = resize_straight(page, (slot, slot), Image.NEAREST)
        else:
            page = image.convert('RGBA').resize((inner, inner), Image.LANCZOS)
            cell = page.resize((slot, slot), Image.NEAREST)
        x0, y0 = col * slot, (1 - row) * slot   # image rows run top-down; row 0 is the bottom half
        atlas.paste(cell, (x0, y0))             # the gutter: the page's own border texels, repeated
        atlas.paste(page, (x0 + gutter, y0 + gutter))
    return atlas, slot


def _remap_chunks(chunks, slot, gutter):
    """Move every lit chunk into atlas page 0. An unlit chunk (page < 0) keeps its UVs."""
    out = {}
    for (name, page, group), chunk in chunks.items():
        key = (name, 0 if page >= 0 else -1, group)
        dest = out.setdefault(key, {'pos': [], 'uv': [], 'uv1': [], 'nrm': [], 'col': [], 'idx': []})
        base = len(dest['pos'])
        for attr in ('pos', 'uv', 'nrm', 'col'):
            dest[attr].extend(chunk[attr])
        dest['uv1'].extend(atlas_uv(u, v, page, slot, gutter) if page >= 0 else (u, v) for u, v in chunk['uv1'])
        dest['idx'].extend(i + base for i in chunk['idx'])
    return out


def _black_report(stage_id, images, chunks, log, before_images=None):
    """Print the near-black share of each lit chunk, and of the stage.

    `images` is the atlas (or the raw pages) the chunks' uv1 addresses. `before_images` is the same layout built
    with Pillow's premultiplied resize; None means nothing was resized, so before and after are the same texels.
    Water and any other unlit chunk (lightmap < 0) is not sampled. Each triangle corner is one sample.
    """
    def shares(pages):
        per, total, black = [], 0, 0.0
        for (name, page, group), chunk in sorted(chunks.items(), key=lambda kv: (kv[0][2], kv[0][0], kv[0][1])):
            if page < 0 or page >= len(pages) or not chunk['idx']:
                continue
            share = lightmap_black_share(pages[page], chunk['uv1'], indices=chunk['idx'])
            n = len(chunk['idx'])
            per.append((name, page, group, n, share))
            total += n
            black += share * n
        return (black / total if total else 0.0), total, per

    after, verts, per = shares(images)
    if before_images is None:
        before, _bverts, before_per = after, verts, per
    else:
        before, _bverts, before_per = shares(before_images)
    before_of = {(name, page, group): share for name, page, group, _n, share in before_per}
    log('STAT ' + json.dumps({
        'stage': stage_id, 'kind': 'lightmap',
        'black_before': round(before, 4), 'black_after': round(after, 4), 'corners': verts,
    }, ensure_ascii=False))
    for name, page, group, n, share in per:
        log('STAT ' + json.dumps({
            'stage': stage_id, 'kind': 'chunk', 'group': group, 'material': name, 'lightmap': page,
            'corners': n, 'black_before': round(before_of.get((name, page, group), share), 4),
            'black_after': round(share, 4),
        }, ensure_ascii=False))


def _atlas(images, chunks, log, stage_id, gutter=ATLAS_GUTTER):
    """Pack 2–4 lightmap pages into one 2 × 2 atlas and merge the chunks that only differed by page, so a view needs one
    draw per material and piece (the three pieces each bring their own page). Each page is shrunk into its cell with a `gutter` of repeated edge texels against bleeding.
    [ASSUMED] the 1.6 % shrink of a 1024 page is invisible on a lightmap.

    The page that is written is resize_straight. A second atlas, identical except Pillow's premultiplied resize, is
    built only to print lightmap_black_share before and after (it is not saved)."""
    if len(images) < 2 or len(images) > 4:
        _black_report(stage_id, images, chunks, log, None)
        return images, chunks
    _before, slot = _compose_atlas(images, gutter, straight=False)
    atlas, slot = _compose_atlas(images, gutter, straight=True)
    out = _remap_chunks(chunks, slot, gutter)
    _black_report(stage_id, [atlas], out, log, [_before])
    _, _, _, size = atlas_slot(0, slot, gutter)
    log(f'  {stage_id}: {len(images)} lightmap pages -> one {size}x{size} atlas, {len(chunks)} -> {len(out)} chunks')
    return [atlas], out


def tile_depth_height(objects):
    """MapSettings.highlandHeight in this piece, for terrain FX depth only (not unit positions)."""
    for obj in objects:
        if obj.type.name != 'MonoBehaviour':
            continue
        try:
            value = obj.read_typetree().get('_mapSettings', {}).get('highlandHeight')
        except Exception:
            continue
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 4:
            return round(value, 5)
    return None


def export_stage(stage_id, paths, dep_paths, out_root, manifest, log, material_info):
    """Write three board pieces and, for MAP10, an optional independent cannon graphic."""
    images = []
    merged = {}
    materials, mat_tex = {}, {}
    light = None
    tile_depth = {}
    log(f'{stage_id}: loading {", ".join(Path(p).name for p in paths)}')
    owns = _load_pieces(paths, dep_paths, log, stage_id)
    for piece, own in zip((1, 2, 3, 0), owns):
        height = tile_depth_height(own) if piece else None
        if height is not None:
            tile_depth[PIECE_GROUPS[piece]] = height
        chunks, mats, texs, piece_light, pages, stats = _chunks_of_piece(piece, own, log, stage_id, material_info, device=piece == 0)
        log(f'  sub_0{piece}: {stats["tris"]} triangles'
            f' ({stats["inactive"]} inactive, {stats["nomat"]} without a material, {stats["static"]} static)')
        page_of = {}
        for local in sorted(pages):
            image = _decode_page(pages[local], log, stage_id, local)
            if image is None:
                continue
            page_of[local] = len(images)
            images.append(image)
        part = _shift_pages(chunks, page_of)
        for key, chunk in part.items():
            dest = merged.setdefault(key, {'pos': [], 'uv': [], 'uv1': [], 'nrm': [], 'col': [], 'idx': []})
            base = len(dest['pos'])
            for attr in ('pos', 'uv', 'uv1', 'nrm', 'col'):
                dest[attr].extend(chunk[attr])
            dest['idx'].extend(i + base for i in chunk['idx'])
        materials.update(mats)
        for name, slots in texs.items():
            mat_tex.setdefault(name, {}).update(slots)
        if light is None and piece_light is not None:
            light = piece_light
    images, merged = _atlas(images, merged, log, stage_id)
    return _write(stage_id, merged, materials, mat_tex, light, images, out_root, manifest, log, tile_depth=tile_depth)


def export_regulation(ab_root, out_root, manifest, log, ids, roots, material_info, shader_deps=()):
    """REGULATION_IDS (those in `ids`) → scene/<stageId>/. A stage with no prefab in `roots` is skipped.

    `roots` is the same list as the covenant scenes (the client, then --scenes, then .cache/official-scenes).
    Materials are read from `ab_root` (the installed client), not from the backup.
    """
    root = Path(ab_root)
    shaders = [Path(p) for p in shader_deps]
    written = 0
    for stage_id in REGULATION_IDS:
        if stage_id not in ids:
            continue
        deps = [root / rel for rel in STAGE_DEPS[stage_id]] + shaders
        paths = []
        missing = None
        for piece in (1, 2, 3):
            found = find_prefab(stage_id, piece, roots)
            if found is None:
                missing = prefab_rel(stage_id, piece)
                break
            paths.append(found)
        if not missing and stage_id == 'act3autochess_m10':
            # The native frame is a token prefab, not a renderer in any of the three board pieces.
            from fx import container_index
            cache = Path(__file__).resolve().parents[2] / '.cache/fx/tokens.json'
            tokens = container_index(root, ('pkgrps/btl_pfb_tokens_*.ab',), cache, 1, log)
            token = root / tokens['trap_196_cnnon'] if 'trap_196_cnnon' in tokens else None
            if token and token.is_file():
                paths.append(token)
                deps.append(root / 'arts/maps/common/trap/trap_19.ab')
            else:
                log(f'  warn {stage_id}: no cannon prefab; keep the procedural device')
        if missing:
            log(f'skip (no regulation prefab: off-season client, see --scenes) {missing}')
            continue
        try:
            written += export_stage(stage_id, paths, deps, out_root, manifest, log, material_info)
        except Exception as e:
            log(f'FAIL regulation scene {stage_id}: {e}')
    return written
