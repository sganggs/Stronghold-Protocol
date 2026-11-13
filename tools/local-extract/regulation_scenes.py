"""规程 (act3autochess) battlefield art, in the same scene/<stageId>/ format as scenes.py.

The season's level_<stage>.ab is the logic scene (tile names, colliders). The meshes live in three prefabs,
level_<stage>_sub_01 / _02 / _03, which the client instantiates onto that scene. Each prefab is in piece-local
board space already: after the hierarchy's world matrix, x is the column and y the row counted from the bottom
of that piece, z the Unity height (to_board negates it). There is no Anchor to subtract — the prefab root is
the origin. [ASSUMED] confirmed on act3autochess_m01's sub_01 and sub_03 corners (a ground tile at grid
(row 0, col 0) sits on (0, 0, −0.4)); the same frame is used for every stage.

tools/versions/layouts.mjs STAGE_ROWS says which piece rows the 19×21 sim grid borrows. This module moves
those triangles by the same deltas and drops the rest:

  sub_03 rows 0–6  → board rows 0–6   (delta 0)   boss field, benches, separator
  sub_01 row  0    → board row  7     (delta +7)  hand
  sub_01 row  1    → board row  8     (delta +7)  equipment; cols 12–19 are the pen beside it, kept
  sub_02 rows 1–5  → board rows 9–13  (delta +8)  both road halves and the separator
  sub_03 rows 7–11 → board rows 14–18 (delta +7)  preview pen

Dropped on purpose: sub_01 rows 2–6 (its left road; sub_02 supplies the road), sub_02 row 0 (a hand row the
sim does not borrow), sub_03 row 12. Decoration whose centre sits within MARGIN of a borrowed outer edge is
kept when the shifted triangle does not cover a cell another piece owns; anything farther out is left out.
A triangle that only sticks about half a cell into the next row stays with its centre cell. [ASSUMED]

Groups follow the board's area switch (scene.js sceneGroupVisible; empty group is always drawn):

  HIDDEN@3  boss rows 0–5          (shown in the boss view)
  ''        row 6, hand, equipment, the side pen, the preview pen
  HIDDEN@1  road rows 9–13, x < 10.5   (left half: normal and 联防)
  HIDDEN@2  road rows 9–13, x ≥ 10.5   (right half: 联防)

A triangle that would stick out of its region goes to '' so it cannot pull that region's centre out of the area.

Lightmaps are baked, but not on MeshRenderer.m_LightmapIndex (that field is 65535). The prefab root's
m_RendererInfo stores lightmapIndex and lightmapOffsetScale per renderer, and the prefab embeds
Lightmap-0_comp_light plus a shadowmask. Many ground tiles have UV0 and no UV1; the lightmap scale on those
is about ten times a tile that does have UV1, which is what you get when the baker's only UV island is the
albedo UV. [ASSUMED] UV1 is the lightmap channel when present, otherwise UV0, then the offset/scale — the
same fallback scenes.py uses. There is no reflection probe in the prefab, so scene.json has no env and the
client uses its no-cubemap formula. The key light is the prefab's directional Mainlight.

Materials are not all in the sand theme. STAGE_DEPS is the bundle each stage's material fileID names
(m01–m04 and m06 sand, m05 Syracuse metro, m09/m11 icewild, m10/m12 ltny2) plus the one external mesh.
"""
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

# piece → {piece row from the bottom: board_y − piece_y}. Same numbers as layouts.mjs STAGE_ROWS.
PIECE_SHIFT = {
    1: {0: 7, 1: 7},
    2: {1: 8, 2: 8, 3: 8, 4: 8, 5: 8},
    3: {0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 7, 8: 7, 9: 7, 10: 7, 11: 7},
}
PIECE_ROWS = {1: 7, 2: 6, 3: 13}   # sub_01 7×20, sub_02 6×21, sub_03 13×21
PIECE_COLS = {1: 20, 2: 21, 3: 21}
BOARD_ROWS = 19
BOARD_COLS = 21
# [ASSUMED] decoration this close to a borrowed outer edge still belongs to that edge.
MARGIN = 1.25
# A tile is about one cell. Larger triangles are checked cell by cell; a sheet bigger than the piece is dropped.
TILE_SPAN = 1.15
DROP_SPAN = 24.0
GROUP_LEFT = 'HIDDEN@1'
GROUP_RIGHT = 'HIDDEN@2'
GROUP_BOSS = 'HIDDEN@3'
WATER_NAME = re.compile(r'_water\d*$', re.I)
LIGHTMAP_NAME = re.compile(r'^Lightmap-(\d+)_comp_(light|shadowmask)$')


def cell_index(v):
    """Row or column of a point. Tile meshes are centred on the integer, so .5 belongs to the next cell."""
    return math.floor(v + 0.5)


def stage_row_table():
    """(board row, piece, piece row, delta) for every borrowed row, board row 0 first."""
    out = [(src + delta, piece, src, delta) for piece, shifts in PIECE_SHIFT.items() for src, delta in shifts.items()]
    return tuple(sorted(out))


def owner_of(board_row, board_col):
    """Which piece's borrowed cells cover this board cell, or None.

    Row 8 cols 12–19 are sub_01's side pen. The sim fills them with the void tile; no other piece owns
    them, so the art stays. sub_01 is 20 columns wide, so board column 20 of rows 7–8 is empty.
    """
    if board_col < 0 or board_col >= BOARD_COLS or board_row < 0 or board_row >= BOARD_ROWS:
        return None
    if board_row <= 6 or board_row >= 14:
        return 3
    if board_row in (7, 8):
        return 1 if board_col < PIECE_COLS[1] else None
    if 9 <= board_row <= 13:
        return 2
    return None


def _outer_row(piece, y):
    """Borrowed row a point outside the piece rectangle attaches to, or None."""
    shifts = PIECE_SHIFT[piece]
    lo, hi = min(shifts), max(shifts)
    if y < lo - 0.5 and (lo - 0.5 - y) <= MARGIN:
        return lo
    if y > hi + 0.5 and (y - (hi + 0.5)) <= MARGIN:
        return hi
    return None


def regulation_delta(piece, x, y):
    """Board-y shift for a piece-local point, or None when that point is not drawn.

    `x` / `y` are board-space coordinates inside the piece (column, row from the bottom).
    """
    row, col = cell_index(y), cell_index(x)
    shifts = PIECE_SHIFT[piece]
    inside_row = 0 <= row < PIECE_ROWS[piece]
    inside_col = 0 <= col < PIECE_COLS[piece]
    if row in shifts and inside_col:
        return _accept(piece, x, y, shifts[row])
    if row in shifts and not inside_col:
        return _accept(piece, x, y, shifts[row])
    if inside_row:
        return None  # the piece's own row that the sim does not borrow
    edge = _outer_row(piece, y)
    if edge is None:
        return None
    return _accept(piece, x, y, shifts[edge])


def _accept(piece, x, y, delta):
    owner = owner_of(cell_index(y + delta), cell_index(x))
    if owner is None or owner == piece:
        return delta
    return None


def group_of(x, y):
    """Switch group of a board-space point. '' is drawn in every view."""
    if y < 5.5:
        return GROUP_BOSS
    if 8.5 <= y < 13.5:
        return GROUP_LEFT if x < 10.5 else GROUP_RIGHT
    return ''


def _overlaps_foreign(piece, xs, ys):
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    spanx, spany = x1 - x0, y1 - y0
    if spanx <= TILE_SPAN and spany <= TILE_SPAN:
        return False
    if spanx > DROP_SPAN or spany > DROP_SPAN:
        return True
    inset = 0.4
    xa, xb = (x0 + inset, x1 - inset) if spanx > 0.8 else ((x0 + x1) / 2, (x0 + x1) / 2)
    ya, yb = (y0 + inset, y1 - inset) if spany > 0.8 else ((y0 + y1) / 2, (y0 + y1) / 2)
    if xa > xb:
        xa = xb = (x0 + x1) / 2
    if ya > yb:
        ya = yb = (y0 + y1) / 2
    for row in range(cell_index(ya), cell_index(yb) + 1):
        for col in range(cell_index(xa), cell_index(xb) + 1):
            owner = owner_of(row, col)
            if owner is not None and owner != piece:
                return True
    return False


def _group_for(xs, ys):
    cx, cy = sum(xs) / 3, sum(ys) / 3
    group = group_of(cx, cy)
    if group == GROUP_BOSS and min(ys) >= -1.0 and max(ys) <= 6.5:
        return group
    if group == GROUP_LEFT and min(xs) >= -1.5 and max(xs) <= 11.2 and min(ys) >= 8.0 and max(ys) <= 14.2:
        return group
    if group == GROUP_RIGHT and min(xs) >= 10.0 and max(xs) <= 22.0 and min(ys) >= 8.0 and max(ys) <= 14.2:
        return group
    if group == '':
        return ''
    return ''


def place_triangle(piece, xs, ys):
    """(delta, group) for one piece-local triangle, or None to drop it.

    `xs` and `ys` are the three vertices. The shift is chosen from the centroid; the whole triangle is
    dropped when it covers another piece's cell.
    """
    if len(xs) != 3 or len(ys) != 3:
        raise ValueError('a triangle has three vertices')
    delta = regulation_delta(piece, sum(xs) / 3, sum(ys) / 3)
    if delta is None:
        return None
    bys = [y + delta for y in ys]
    if _overlaps_foreign(piece, xs, bys):
        return None
    return delta, _group_for(xs, bys)


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


def _chunks_of_piece(piece, objects, log, stage_id, material_info):
    """Triangles of one prefab, still keyed by the prefab's own lightmap index."""
    tf, go_info, go_of_tf, tf_of_go = _hierarchy(objects)
    lights = _renderer_light(objects)
    cache, materials, mat_tex = {}, {}, {}
    chunks = {}
    stats = {'tris': 0, 'kept': 0, 'inactive': 0, 'nomat': 0, 'static': 0}
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
            for tri in tris[slot]:
                stats['tris'] += 1
                order = (tri[0], tri[2], tri[1]) if flip else tri
                pts, uvs, lms, nrms, cols = [], [], [], [], []
                for vi in order:
                    point = scenes.to_board(_apply(matrix, verts[vi]), (0.0, 0.0, 0.0))
                    pts.append(point)
                    src = normals[vi] if normals else (0.0, 0.0, -1.0)
                    nw = (matrix[0][0] * src[0] + matrix[0][1] * src[1] + matrix[0][2] * src[2],
                          matrix[1][0] * src[0] + matrix[1][1] * src[1] + matrix[1][2] * src[2],
                          matrix[2][0] * src[0] + matrix[2][1] * src[1] + matrix[2][2] * src[2])
                    length = (nw[0] ** 2 + nw[1] ** 2 + nw[2] ** 2) ** 0.5 or 1.0
                    nrms.append((nw[0] / length, nw[1] / length, -nw[2] / length))
                    tex = uv0[vi] if uv0 else (0.0, 0.0)
                    uvs.append((tex[0], tex[1]))
                    lm = luv[vi] if luv else (0.0, 0.0)
                    lms.append((lm[0] * scale[0] + scale[2], lm[1] * scale[1] + scale[3]))
                    col = colors[vi] if colors else (1.0, 1.0, 1.0, 1.0)
                    cols.append(tuple(col[:4]) if len(col) >= 4 else (*col[:3], 1.0))
                placed = place_triangle(piece, [p[0] for p in pts], [p[1] for p in pts])
                if placed is None:
                    continue
                delta, group = placed
                stats['kept'] += 1
                key = (name, index, group)
                chunk = chunks.setdefault(key, {'pos': [], 'uv': [], 'uv1': [], 'nrm': [], 'col': [], 'idx': []})
                base = len(chunk['pos'])
                for i in range(3):
                    x, y, z = pts[i]
                    chunk['pos'].append((x, y + delta, z))
                    chunk['uv'].append(uvs[i])
                    chunk['uv1'].append(lms[i])
                    chunk['nrm'].append(nrms[i])
                    chunk['col'].append(cols[i])
                    chunk['idx'].append(base + i)
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


def _write(stage_id, chunks, materials, mat_tex, light, images, out_root, manifest, log):
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
        log(f'  warn {stage_id}: no regulation triangle kept')
        return 0
    (out_dir / 'scene.bin').write_bytes(bytes(blob))
    manifest.setdefault(sub, {})['bin'] = {'path': f'/assets/local/{sub}/scene.bin', 'kind': 'SceneData', 'bytes': len(blob)}
    written = 1
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
                if tname in manifest.get(scenes.TEX_SUB, {}):
                    continue
                img = scenes.normal_rgb(tex.image) if key == 'normalMap' else tex.image
                manifest.setdefault(scenes.TEX_SUB, {})[tname] = {
                    **scenes.save_image(img, tex_dir, tname, scenes.TEX_SUB, key in scenes.LOSSLESS_MAPS), 'kind': 'Texture2D'}
                written += 1
            except Exception as e:
                log(f'  warn {stage_id}: texture {slot} of {name}: {e}')
    doc = {'version': scenes.SCENE_VERSION, 'stage': stage_id,
           'bundle': prefab_rel(stage_id, 1),
           'pieces': [prefab_rel(stage_id, i) for i in (1, 2, 3)],
           'light': light, 'lightmaps': lightmaps, 'lightRange': scenes.LIGHT_RANGE, 'lightEncoding': scenes.LIGHT_ENCODING,
           'materials': dict(sorted(materials.items())), 'groups': sorted({rec['group'] for rec in records}),
           'chunks': records, 'binBytes': len(blob)}
    (out_dir / 'scene.json').write_text(__import__('json').dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
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


def _atlas(images, chunks, log, stage_id, gutter=ATLAS_GUTTER):
    """Pack 2–4 lightmap pages into one 2 × 2 atlas and merge the chunks that only differed by page, so a view needs one
    draw per material (the three pieces each bring their own page: 18 meshes for m01's normal view against the 16 the
    board budgets). Each page is shrunk into its cell with a `gutter` of repeated edge texels against bleeding.
    [ASSUMED] the 1.6 % shrink of a 1024 page is invisible on a lightmap."""
    if len(images) < 2 or len(images) > 4:
        return images, chunks
    from PIL import Image
    slot = max(max(im.width, im.height) for im in images)
    _, _, inner, size = atlas_slot(0, slot, gutter)
    atlas = Image.new('RGBA', (size, size), (0, 0, 0, 255))
    for index, image in enumerate(images):
        col, row, _, _ = atlas_slot(index, slot, gutter)
        page = image.convert('RGBA').resize((inner, inner), Image.LANCZOS)
        x0, y0 = col * slot, (1 - row) * slot   # image rows run top-down
        cell = page.resize((slot, slot), Image.NEAREST)  # the gutter: the page's own border texels, repeated
        atlas.paste(cell, (x0, y0))
        atlas.paste(page, (x0 + gutter, y0 + gutter))
    out = {}
    for (name, page, group), chunk in chunks.items():
        key = (name, 0 if page >= 0 else -1, group)
        dest = out.setdefault(key, {'pos': [], 'uv': [], 'uv1': [], 'nrm': [], 'col': [], 'idx': []})
        base = len(dest['pos'])
        for attr in ('pos', 'uv', 'nrm', 'col'):
            dest[attr].extend(chunk[attr])
        dest['uv1'].extend(atlas_uv(u, v, page, slot, gutter) if page >= 0 else (u, v) for u, v in chunk['uv1'])
        dest['idx'].extend(i + base for i in chunk['idx'])
    log(f'  {stage_id}: {len(images)} lightmap pages -> one {size}x{size} atlas, {len(chunks)} -> {len(out)} chunks')
    return [atlas], out


def export_stage(stage_id, paths, dep_paths, out_root, manifest, log, material_info):
    """Write one 规程 stage from its three prefab bundles. `paths` is (sub_01, sub_02, sub_03)."""
    images = []
    merged = {}
    materials, mat_tex = {}, {}
    light = None
    log(f'{stage_id}: loading {", ".join(Path(p).name for p in paths)}')
    owns = _load_pieces(paths, dep_paths, log, stage_id)
    for piece, own in zip((1, 2, 3), owns):
        chunks, mats, texs, piece_light, pages, stats = _chunks_of_piece(piece, own, log, stage_id, material_info)
        log(f'  sub_0{piece}: kept {stats["kept"]}/{stats["tris"]} triangles'
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
    return _write(stage_id, merged, materials, mat_tex, light, images, out_root, manifest, log)


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
        if missing:
            log(f'skip (no regulation prefab: off-season client, see --scenes) {missing}')
            continue
        try:
            written += export_stage(stage_id, paths, deps, out_root, manifest, log, material_info)
        except Exception as e:
            log(f'FAIL regulation scene {stage_id}: {e}')
    return written
