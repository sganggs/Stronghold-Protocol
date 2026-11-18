"""Offline PC cursor composition from the official prefab, sprites and press/release clips."""
import gc
import hashlib
import math
from pathlib import Path

SUB = 'ui/cursor'
NAME = 'prts_hand'
# Intermediate finger poses; browser timing follows the source clips' Hermite curves.
POSES = 11
PREFAB = 'init/mouse/pc_mouse_mgr.ab'
KNOWN_BUNDLE = 'f7bcd64480c4566f25d65d642f5fba95.bin'


def client_data(ab_root):
    root = Path(ab_root).resolve()
    return root.parents[2] if root.parts[-3:] == ('StreamingAssets', 'AB', 'Windows') else None


def find_prefab(root, unity):
    """Initial PC resources are anonymous bundles, outside the gameplay hot-update list.

    Prefer the installed current-client location, then discover by the embedded bundle identity.
    The known hash is only a fast path, never the resource's identity or a silent tutorial fallback.
    """
    dirs = [root / 'PersistentData/Bundles/anon', root / 'StreamingAssets/AB/Windows/anon']
    for directory in dirs:
        paths = sorted(directory.glob('*.bin'))
        known = directory / KNOWN_BUNDLE
        if known in paths:
            paths.remove(known)
            paths.insert(0, known)
        for src in paths:
            env = unity.load(str(src))
            if any(o.type.name == 'AssetBundle' and o.read_typetree().get('m_Name') == PREFAB for o in env.objects):
                return src, env
            del env
            gc.collect()
    return None, None


def export(root, out_root, manifest, log):
    if root is None:
        log('skip PC cursor (no Windows client)')
        return 0
    import aklz4  # noqa: F401
    import UnityPy
    from PIL import Image
    src, env = find_prefab(Path(root), UnityPy)
    if src is None:
        log('skip PC cursor (original PC prefab not installed)')
        return 0
    objects = {o.path_id: o for o in env.objects}
    records = {i: o.read_typetree() for i, o in objects.items()
               if o.type.name in ('GameObject', 'RectTransform', 'MonoBehaviour', 'AnimationClip')}
    manager = next(d for d in records.values() if '_defaultConfig' in d)
    handler = records[manager['_defaultConfig']['mouseHandler']['m_PathID']]
    item_go = records[handler['m_GameObject']['m_PathID']]
    item = next(records[p['component']['m_PathID']] for p in item_go['m_Component']
                if 'm_Children' in records[p['component']['m_PathID']])
    root_tr = records[item['m_Children'][0]['m_PathID']]
    scaler = next(d for d in records.values() if 'm_ReferenceResolution' in d)
    clips = {d['m_Name']: d for d in records.values() if d.get('m_Name') in ('mouse_click_in', 'mouse_click_out')}
    down, up = clips['mouse_click_in'], clips['mouse_click_out']
    # Read every animated endpoint from the official clip, rather than inventing a squash/rotation.
    scale_keys = down['m_ScaleCurves']
    if len(scale_keys) != 1 or scale_keys[0]['path'] != 'root':
        raise ValueError('Unexpected PC cursor scale animation')
    end_scale = scale_keys[0]['curve']['m_Curve'][-1]['value']['x']
    rotations = {c['path']: c['curve']['m_Curve'][-1]['value']['z'] for c in down['m_EulerCurves']}
    def duration(clip):
        keys = [k for field in ('m_ScaleCurves', 'm_EulerCurves') for c in clip[field] for k in c['curve']['m_Curve']]
        if any(any(abs(v) > 1e-6 for v in k[s].values()) for k in keys for s in ('inSlope', 'outSlope')):
            raise ValueError('PC cursor needs a new curve sampler')
        return max(k['time'] for k in keys) * 1000
    press_ms, release_ms = duration(down), duration(up)
    if up['m_ScaleCurves'][0]['curve']['m_Curve'][0]['value']['x'] != end_scale:
        raise ValueError('Unexpected PC cursor release scale')
    for c in up['m_EulerCurves']:
        keys = c['curve']['m_Curve']
        if keys[0]['value']['z'] != rotations.get(c['path']) or keys[-1]['value']['z'] != 0:
            raise ValueError('Unexpected PC cursor release rotation')
    parts = []
    source_sprites = []
    for ref in root_tr['m_Children']:
        tr = records[ref['m_PathID']]
        go = records[tr['m_GameObject']['m_PathID']]
        if not go['m_IsActive']:
            continue
        image_data = next((records[p['component']['m_PathID']] for p in go['m_Component']
                           if 'm_Sprite' in records.get(p['component']['m_PathID'], {})), None)
        if image_data is None:
            continue
        sprite_obj = objects[image_data['m_Sprite']['m_PathID']]
        image = sprite_obj.read().image.convert('RGBA')
        source_sprites.append({'name': sprite_obj.read_typetree()['m_Name'],
                               'pixelSha256': hashlib.sha256(image.tobytes()).hexdigest()})
        parts.append((tr, image, rotations.get('root/' + go['m_Name'], 0)))
    if len(parts) != 6:
        raise ValueError('Incomplete PC cursor: expected six hand parts')
    # Supersample once offline; no Unity or scene graph is shipped to the page.
    origin, side, aa = 48, 256, 3
    frames = []
    for pose in range(POSES):
        p = pose / (POSES - 1)
        scale = 1 + (end_scale - 1) * p
        frame = Image.new('RGBA', (side * aa, side * aa))
        for tr, image, rotation in parts:
            w, h = tr['m_SizeDelta']['x'], tr['m_SizeDelta']['y']
            px, py = tr['m_Pivot']['x'] * w, (1 - tr['m_Pivot']['y']) * h
            x, y = tr['m_AnchoredPosition']['x'], -tr['m_AnchoredPosition']['y']
            angle = math.radians(rotation * p)
            c, s = math.cos(angle), math.sin(angle)
            # PIL maps screen pixels back through the Unity rotation about each finger's pivot.
            inv = 1 / (scale * aa)
            coeffs = (c * inv, -s * inv, px - c * (origin + x * scale) / scale + s * (origin + y * scale) / scale,
                      s * inv, c * inv, py - s * (origin + x * scale) / scale - c * (origin + y * scale) / scale)
            layer = image.transform(frame.size, Image.Transform.AFFINE, coeffs, Image.Resampling.BICUBIC)
            frame.alpha_composite(layer)
        frames.append(frame.resize((side, side), Image.Resampling.LANCZOS))
    bounds = [im.getbbox() for im in frames]
    crop = (max(0, min(b[0] for b in bounds) - 1), max(0, min(b[1] for b in bounds) - 1),
            min(side, max(b[2] for b in bounds) + 1), min(side, max(b[3] for b in bounds) + 1))
    fw, fh = crop[2] - crop[0], crop[3] - crop[1]
    hotspot = [origin - crop[0], origin - crop[1]]
    if not (0 <= hotspot[0] < fw and 0 <= hotspot[1] < fh):
        raise ValueError('PC cursor origin outside the composed image')
    atlas = Image.new('RGBA', (fw * POSES, fh))
    for i, frame in enumerate(frames):
        atlas.paste(frame.crop(crop), (fw * i, 0))
    dst = Path(out_root) / SUB / (NAME + '.png')
    dst.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(dst)
    manifest[SUB] = {NAME: {
        'path': f'/assets/local/{SUB}/{NAME}.png', 'kind': 'Sprite', 'w': atlas.width, 'h': atlas.height,
        'frameWidth': fw, 'frameHeight': fh, 'frames': POSES, 'hotspot': hotspot,
        'referenceWidth': scaler['m_ReferenceResolution']['x'], 'defaultScale': item['m_LocalScale']['x'],
        'pressMs': press_ms, 'releaseMs': release_ms, 'extractVersion': 2,
        'sourceFile': src.name, 'sourceBundle': PREFAB, 'sourceSprites': source_sprites,
        'sourceAnimations': ['mouse_click_in', 'mouse_click_out'],
        'sourceSha256': hashlib.sha256(src.read_bytes()).hexdigest(),
        'sha256': hashlib.sha256(dst.read_bytes()).hexdigest(),
    }}
    log(f'{src.name}: original PC cursor -> {POSES} poses ({fw}x{fh}); press {press_ms:.1f} / release {release_ms:.1f} ms')
    return 1
