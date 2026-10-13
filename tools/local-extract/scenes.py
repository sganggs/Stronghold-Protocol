"""The official battlefield scenes of 卫戍协议 (DESIGN §15): every battlefield is a prebuilt Unity scene
(scenes/activities/<season>/level_<stage>/level_<stage>.ab, with …/lightingdata.ab beside it) whose tile models are
baked into "Combined Mesh (root: scene)" objects, plus loose meshes for the parts the game shows and hides.

The scene bundles ship only while the season runs (the hot-update list of an off-season client has none), so they are
read from the client's AB root when it has them and else from a directory of bundles kept from an in-season version
(extract.py --scenes <dir>, default .cache/official-scenes/*; tools/local-extract/fetch_scenes.py fills it). Materials
and their textures come from the theme bundles of the local client (SCENES lists each scene's, as the official asset
index records them: the scene bundle's dependencies).

Output per stage, under <out>/scene/<stageId>/ (manifest group scene/<stageId>):
  scene.json   { version, stage, light, lightmaps, materials, groups, chunks: [{ material, lightmap, group, verts,
                 tris, offset, index32, bounds }] }
  scene.bin    the chunks' vertex data in board space (x = column, y = row, z = height: Unity's anchor-local
               (x, y, −z)); per chunk: position f32×3, uv f32×2, lightmap uv f32×2 (scale / offset applied),
               normal i8×4, colour u8×4, indices u16|u32 (padded to 4 bytes)
  lm<i>.png    lightmap page i (+ a WebP copy, the one the manifest lists): RGB = the baked indirect light (Lightmap-<i>_comp_light, stored RGBM: decode_rgbm),
               A = the key light's baked shadow (Lightmap-<i>_comp_shadowmask, R)
  env.png      the scene's ReflectionProbe-0 cubemap (lightingdata.ab beside the scene bundle) as an equirectangular
               page in board space (+ a WebP copy), the indirect specular the official pixel shader adds to the baked
               light and the key light (#549); absent when the version has no probe
and the materials' albedo textures under <out>/scene/tex/ (manifest group scene/tex, shared by the scenes).
A chunk's `group` is '' for what the scene shows at rest and the sub-graphic name (HIDDEN@1 …, MapSubGraphicHolder)
for the meshes the game switches on later.

The probe alone can be re-extracted without a client and without touching the meshes, lightmaps or textures:

  python tools/local-extract/scenes.py --stage act2autochess_m04 [--scene-dir <AB root>] [--out …] [--manifest …]
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
# linear light value that a lightmap page's 1.0 stands for (decode_rgbm; scene.json lightRange)
LIGHT_RANGE = 8.0
HIDDEN_NAME = re.compile(r'^[A-Z_]+@\d+$')
WATER_SHADERS = ('StylizedWater', 'StandardWater', 'DynamicWaterTile')
# the scene's reflection probe (ReflectionProbe-0), written as an equirectangular page (`env`): 1024×512 = 2:1, the
# size the reference export used (cubemap_equirect documents the frame)
EQUIRECT_W, EQUIRECT_H = 1024, 512
# Unity's CubemapFace order and each face's "up" axis, i.e. how Unity samples a cubemap (a probe baked with no local
# rotation stores world +X, −X, +Y, −Y, +Z, −Z in that order)
FACE_NORMALS = ((1.0, 0.0, 0.0), (-1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, -1.0, 0.0), (0.0, 0.0, 1.0), (0.0, 0.0, -1.0))
FACE_UP = ((0.0, 1.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, -1.0), (0.0, 0.0, 1.0), (0.0, 1.0, 0.0), (0.0, 1.0, 0.0))


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
    while len(out) % 4:
        out.append(0)
    return bytes(out), idx32


def decode_rgbm(img):
    """RGB image of a baked lightmap page stored RGBM (Unity, linear colour space: light = 5^2.2 · A^2.2 · RGB):
    the linear light L as (L / LIGHT_RANGE)^(1/2.2) per channel — = (5^2.2 / LIGHT_RANGE)^(1/2.2) · A · RGB^(1/2.2),
    clamped to 1 (the renderer reads L = value^2.2 · LIGHT_RANGE). A page without alpha is taken as plain RGB."""
    from PIL import Image, ImageChops
    if img.mode != 'RGBA':
        return img.convert('RGB')
    k = (5.0 ** 2.2 / LIGHT_RANGE) ** (1 / 2.2)
    r, g, b, a = img.split()
    m = a.point([min(255, int(round(v * k))) for v in range(256)])
    gamma = [int(round(255 * (v / 255) ** (1 / 2.2))) for v in range(256)]
    return Image.merge('RGB', tuple(ImageChops.multiply(ch.point(gamma), m) for ch in (r, g, b)))


def save_image(img, out_dir, stem, sub):
    """Write `img` as <stem>.png and a WebP copy beside it (lossy at quality 95 with the alpha lossless and the RGB
    under transparent texels kept, like extract.py WEBP: every player downloads these with the scene); returns the
    manifest entry, which lists the copy (the PNG with a Pillow that has no WebP)."""
    img.save(Path(out_dir) / f'{stem}.png')
    entry = {'path': f'/assets/local/{sub}/{stem}.png', 'w': img.width, 'h': img.height}
    try:
        img.save(Path(out_dir) / f'{stem}.webp', 'WEBP', quality=95, method=6, alpha_quality=100, exact=True)
        entry.update(path=f'/assets/local/{sub}/{stem}.webp', webp='lossy')
    except Exception:
        pass
    return entry


def _face_uv(i, d):
    """(face index, u, v) of a direction in the cubemap's own frame: the face is the axis nearest `d`, (u, v) its
    projection (−1…1, v along the face's up axis); None for the degenerate corner where no face wins. The stored faces
    are (+X, −X, +Y, −Y, +Z, −Z), each with FACE_UP below, and Unity samples them with a left-handed basis:
    u = d·(n × up) / d·n, v = d·up / d·n."""
    best, k = -1.0, 0
    for f, n in enumerate(FACE_NORMALS):
        t = d[0] * n[0] + d[1] * n[1] + d[2] * n[2]
        if t > best:
            best, k = t, f
    n = FACE_NORMALS[k]
    up = FACE_UP[k]
    right = (n[1] * up[2] - n[2] * up[1], n[2] * up[0] - n[0] * up[2], n[0] * up[1] - n[1] * up[0])  # n × up
    if best < 1e-9:
        return None
    return k, (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / best, (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / best


def _probe_xy(w, h, u, v):
    """Texel (x, y) of a `w`×`h` stored face image that the direction (u, v) reads — see `probe_rows`."""
    clamp = lambda q, n: 0 if q < 0 else (n - 1 if q > n - 1 else int(q))  # noqa: E731
    return clamp(round((u + 1) * 0.5 * (w - 1)), w), clamp(round((1 + v) * 0.5 * (h - 1)), h)


def probe_rows(size, k, u, v):
    """(x, y) of the `size` (width, height) stored face image texel that direction (k, u, v) of `_face_uv` reads.

    Unity's cubemap images are stored bottom-up (as a GL texture is), so the face's v = +1 side is the LAST image row:
    row 0 is the face's −up side. Everything downstream (the equirect page, the pole test) depends on this, and it is
    what makes the page agree with the six faces that Unity itself would sample."""
    return _probe_xy(size[0], size[1], u, v)


def cubemap_equirect(faces, width=EQUIRECT_W, height=EQUIRECT_H):
    """Equirectangular page of a reflection probe cubemap (list of PIL images, the stored +X,−X,+Y,−Y,+Z,−Z order).

    BOARD SPACE, the frame the renderer draws in and the one its procedural fallback uses: row 0 = board +z (up),
    column 0 = board +x, and the column index grows toward board +y. Board space is Unity world with z negated — which
    is what `environmentRotation` (0, 0, 0) / `THREE.EquirectangularReflectionMapping` expects. `probe_rows` documents
    how a face image is read. width must be 2 × height (the grid is lon/lat: every pixel covers exactly 180/height
    degrees of latitude, so it is a plain 2× resize of any other size).

    The probe is 128² per face, so this is 0.5 M texel reads in plain Python (≈ 1 s with Pillow's own loops); the
    pixel it reads for a direction is exactly what `_face_uv` + `probe_rows` name, and the result is pixel-identical
    to the reference export in official-refprobe.md (§9)."""
    import math
    from PIL import Image
    if width % 2 or height != width // 2:
        raise ValueError(f'equirectangular size must be 2:1, got {width}x{height}')
    cube = [f.convert('RGB') for f in faces]
    cw, ch = cube[0].size
    out = Image.new('RGB', (width, height))
    # one full image's worth of (x, y) per face: build the index list, read it in one getdata round-trip
    plan = [[] for _ in range(6)]
    for j in range(height):
        theta = (j + 0.5) / height * math.pi                     # 0 = board +z (up), π = board −z
        sin_t, cos_t = math.sin(theta), math.cos(theta)
        for i in range(width):
            phi = (i + 0.5) / width * 2 * math.pi                # 0 = board +x, growing toward +y
            b = (sin_t * math.cos(phi), sin_t * math.sin(phi), cos_t)
            found = _face_uv(0, (b[0], b[1], -b[2]))             # board → Unity world (z negated)
            if found is None:
                continue
            k, u, v = found
            plan[k].append((i, j, *_probe_xy(cw, ch, u, v)))
    for k in range(6):
        if not plan[k]:
            continue
        data = cube[k].load()
        px = out.load()
        for i, j, x, y in plan[k]:
            px[i, j] = data[x, y]
    return out


def save_env_probe(stage_id, lighting, out_root, manifest, log):
    """Decode the stage's ReflectionProbe-0 (see probe_page) and write it as scene/<stageId>/env.png (+ a WebP copy),
    listing it as the manifest's `env`. Safe to call anywhere: a missing lightingdata.ab, a bundle without a Cubemap, an
    unexpected byte layout or any decode error only logs and leaves the renderer's procedural environment in place.
    Returns the number of files written (0 when skipped)."""
    return save_env_page(stage_id, probe_page(stage_id, lighting, log), out_root, manifest, log)


def save_env_page(stage_id, page, out_root, manifest, log):
    """save_env_probe's write half, for a `page` that probe_page decoded earlier (None writes nothing)."""
    if page is None:
        return 0
    out_dir = Path(out_root) / SCENE_SUB / stage_id
    out_dir.mkdir(parents=True, exist_ok=True)
    sub = f'{SCENE_SUB}/{stage_id}'
    manifest.setdefault(sub, {})['env'] = {**save_image(page, out_dir, 'env', sub), 'kind': 'EnvEquirect'}
    log(f'  {stage_id}: ReflectionProbe-0 -> {sub}/env.png {page.width}x{page.height} (board space, row 0 = +z)')
    return 2 if manifest[sub]['env'].get('webp') else 1


def probe_page(stage_id, lighting, log):
    """The stage's ReflectionProbe-0 cubemap as an equirectangular PIL page in board space, or None.

    The probe lives in lightingdata.ab beside the scene bundle: a 128², 6-face, 8-mip ETC2_RGBA8 `Cubemap` whose
    stream is mip-major (every face's mip0, then every face's mip1 …, so `Σ mip bytes × 6` must equal the stream
    length — a face-major read decodes the same bytes into two identical faces)."""
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    from UnityPy.enums import TextureFormat
    from UnityPy.export.Texture2DConverter import get_compressed_image_size, parse_image_data

    path = Path(lighting)
    if not path.is_file():
        log(f'  skip {stage_id}: no lighting data ({path.name}) — the probe stays the procedural environment')
        return None
    try:
        env = UnityPy.load(str(path))
        cubes = [o for o in env.objects if o.type.name == 'Cubemap']
        if not cubes:
            log(f'  skip {stage_id}: no Cubemap object in {path.name}')
            return None
        # a battlefield can hold more than one baked probe (act2autochess_m03 has ReflectionProbe-0 and -1);
        # ReflectionProbe-0 is the one Unity binds to unity_SpecCube0
        obj = next((o for o in cubes if o.read_typetree().get('m_Name') == 'ReflectionProbe-0'), cubes[0])
        d = obj.read_typetree()
        fmt = TextureFormat(d['m_TextureFormat'])
        w, h, nf, mips = d['m_Width'], d['m_Height'], d['m_ImageCount'], d['m_MipCount']
        if nf != 6:
            log(f'  skip {stage_id}: Cubemap {d.get("m_Name")} has {nf} faces (expected 6)')
            return None
        sizes = [get_compressed_image_size(max(1, w >> m), max(1, h >> m), fmt)[0]
                 * get_compressed_image_size(max(1, w >> m), max(1, h >> m), fmt)[1] for m in range(mips)]
        tex = obj.read()
        raw = tex.get_image_data()
        if sum(sizes) * nf != len(raw):
            log(f'  warn {stage_id}: Cubemap {d.get("m_Name")}: {len(raw)} streamed bytes != {sum(sizes) * nf} '
                f'({w}x{h} {fmt.name} {mips} mips) — layout unknown, skipped')
            return None
        version, platform, blob = obj.assets_file.version, obj.assets_file.target_platform, tex.m_PlatformBlob
        faces = [parse_image_data(raw[i * sizes[0]:(i + 1) * sizes[0]], w, h, fmt, version, platform, blob, True).convert('RGB')
                 for i in range(nf)]                     # mip 0 is the first six blocks
        log(f'  {stage_id}: ReflectionProbe-0 {w}x{h} {fmt.name} {mips} mips')
        return cubemap_equirect(faces)
    except Exception as e:
        log(f'  warn {stage_id}: probe {path.name}: {e}')
        return None


def hidden_groups(raw, objects):
    """{GameObject path id: sub-graphic name} of a MapSubGraphicHolder's raw data: after each name (HIDDEN@n) come the
    GameObjects and MeshTileGraphics of that group as PPtrs of this file. The script has no type tree in the bundle,
    so the fields are walked as 4-byte words: a length-prefixed name, or a (file 0, path id) pointer to an object."""
    out, group, i = {}, None, 0
    body = raw
    while i + 4 <= len(body):
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
    for o in scene_objs:
        if o.type.name == 'GameObject':
            g = o.read()
            go_info[o.path_id] = (g.m_Name, bool(g.m_IsActive))
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
        while tid in tf:
            g = go_of_tf[tid]
            active = active and go_info.get(g, ('', True))[1]
            if group is None and g in hidden:
                group = hidden[g]
            tid = tf[tid][1]
        return active, group

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

    # ---- reflection probe (indirect specular; #549) -----------------------------------------------------------------
    # decoded here, written with the scene so a stage whose meshes fail does not leave a stray env.png behind
    env_page = probe_page(stage_id, light_bundle, log)

    # ---- renderers → chunks -----------------------------------------------------------------------------------------
    mesh_cache, materials, mat_tex = {}, {}, {}
    chunks = {}  # (material, lightmap, group) → {'pos': [], …}

    def mesh_data(pptr):
        key = (getattr(pptr, 'm_FileID', 0), pptr.m_PathID)
        if key not in mesh_cache:
            try:
                h = MeshHandler(pptr.read())
                h.process()
                mesh_cache[key] = (h.m_Vertices, h.m_Normals, h.m_UV0, h.m_UV1, h.m_Colors, h.get_triangles())
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
                    if slot == '_MainTex' and env_.m_Texture.m_PathID:
                        mat_tex[name] = env_.m_Texture
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
        verts, normals, uv0, uv1, colors, tris = data
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
        for k, mref in enumerate(r.m_Materials):
            sub = first + k
            if sub >= len(tris):
                break
            name = material_name(mref)
            if not name:
                skipped += 1
                continue
            ch = chunks.setdefault((name, lm, group or ''), {'pos': [], 'uv': [], 'uv1': [], 'nrm': [], 'col': [], 'idx': [], 'map': None})
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
                        t0 = uv0[vi] if uv0 else (0.0, 0.0)
                        ch['uv'].append((t0[0], t0[1]))
                        t1 = luv[vi] if luv else (0.0, 0.0)
                        ch['uv1'].append((t1[0] * st[0] + st[2], t1[1] * st[1] + st[3]))
                        col = colors[vi] if colors else (1.0, 1.0, 1.0, 1.0)
                        ch['col'].append(tuple(col[:4]) if len(col) >= 4 else (*col[:3], 1.0))
                    ch['idx'].append(j)
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
    n += save_env_page(stage_id, env_page, out_root, manifest, log)

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

    # albedo textures of the materials (shared by the scenes)
    tex_dir = Path(out_root) / TEX_SUB
    tex_dir.mkdir(parents=True, exist_ok=True)
    for name, pptr in sorted(mat_tex.items()):
        try:
            tex = pptr.read()
            tname = re.sub(r'[^A-Za-z0-9_.\-\[\]]+', '_', tex.m_Name or f'tex_{pptr.m_PathID}')
            materials[name]['map'] = tname
            if tname in manifest.get(TEX_SUB, {}):
                continue
            manifest.setdefault(TEX_SUB, {})[tname] = {**save_image(tex.image, tex_dir, tname, TEX_SUB), 'kind': 'Texture2D'}
            n += 1
        except Exception as e:
            log(f'  warn {stage_id}: texture of {name}: {e}')

    doc = {'version': SCENE_VERSION, 'stage': stage_id, 'bundle': scene_bundle(stage_id), 'light': light, 'lightmaps': lightmaps,
           'lightRange': LIGHT_RANGE, 'materials': dict(sorted(materials.items())), 'groups': sorted({rec['group'] for rec in records}),
           'chunks': records, 'binBytes': len(blob)}
    (out_dir / 'scene.json').write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    manifest[sub]['scene'] = {'path': f'/assets/local/{sub}/scene.json', 'kind': 'Scene', 'chunks': len(records)}
    n += 1
    verts = sum(rec['verts'] for rec in records)
    log(f'{scene_path.name}: {len(records)} chunks, {verts} vertices, {lightmaps} lightmaps -> {sub}'
        + (f' ({skipped} sub-meshes without a material)' if skipped else ''))
    return n


# ---- probe-only re-extraction (no client, no meshes touched) --------------------------------------------------------

def env_only(stage_id, roots, out_root, manifest_path, log):
    """Add just `stage_id`'s `env` to an extraction that is already on disk: decode the probe of the stage's
    lightingdata.ab, write scene/<stageId>/env.png (+ WebP) and list it in `manifest_path` — the groups the manifest
    already has are kept as they are (extract.py owns everything else). Returns the number of files written."""
    lighting = None
    src = find_scene(stage_id, roots)
    if src is not None:
        cand = src.with_suffix('') / 'lightingdata.ab'
        if cand.is_file():
            lighting = cand
    if lighting is None:  # no scene bundle at hand (an off-season client): any lightingdata.ab of the stage will do
        for root in roots:
            hit = next(iter(sorted(Path(root).glob(f'scenes/activities/*/level_{stage_id}/level_{stage_id}/lightingdata.ab'))), None)
            if hit is not None:
                lighting = hit
                break
    if lighting is None:
        log(f'{stage_id}: skip (no lightingdata.ab under {", ".join(str(r) for r in roots)})')
        return 0
    manifest = {}
    path = Path(manifest_path)
    if path.exists():
        try:
            manifest = json.loads(path.read_text(encoding='utf-8')).get('groups') or {}
        except (OSError, ValueError) as e:
            log(f'warn: previous manifest unreadable ({e}); writing only the stage\'s group')
    n = save_env_probe(stage_id, lighting, out_root, manifest, log)
    if not n:
        return 0
    groups = dict(sorted(manifest.items()))
    count = sum(len(v) for v in groups.values())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'version': 1, 'source': 'local-client', 'count': count, 'groups': groups},
                               ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    log(f'manifest {path} ({count} entries)')
    return n


def main(argv=None):
    """`python scenes.py --stage <id>`: re-extract the reflection probe of each --stage into an existing extraction."""
    import argparse
    import sys
    ap = argparse.ArgumentParser(description='Re-extract the official battlefields\' reflection probes (env.png) '
                                            'without a client and without touching the meshes, lightmaps or textures.')
    ap.add_argument('--stage', action='append', default=[], metavar='ID',
                    help=f'a battlefield to re-extract (repeatable); default: every stage of SCENES')
    ap.add_argument('--scene-dir', action='append', default=[], metavar='DIR',
                    help='an AB root holding the scene bundles (repeatable), e.g. .cache/official-scenes/<version>')
    ap.add_argument('--out', default='public/assets/local', help='the extraction root the manifest lists')
    ap.add_argument('--manifest', default='data/local-assets.json', help='the manifest to add the env entries to')
    args = ap.parse_args(argv)

    ids = args.stage or [sid for sid, _deps in SCENES]
    unknown = [sid for sid in ids if sid not in dict(SCENES)]
    if unknown:
        print(f'unknown stage(s): {", ".join(unknown)}', file=sys.stderr)
        return 2
    roots = [*args.scene_dir, '.', '.cache']
    n = 0
    for sid in ids:
        try:
            n += env_only(sid, roots, args.out, args.manifest, print)
        except Exception as e:  # one broken probe must not stop the others
            print(f'FAIL env {sid}: {e}', file=sys.stderr)
    return 0 if n else 1


if __name__ == '__main__':
    import sys
    sys.exit(main())