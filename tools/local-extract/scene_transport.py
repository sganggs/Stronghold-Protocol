"""Scene transport policy; binParts is an ordered, variable-length array of byte lengths.

By default a scene's mesh data stays one scene.bin, as before PR #979: the release packages allow 256 MiB per file and
one request is cheaper. A deployment whose resource packs have a small per-file limit (PR #979: 16,000,000-byte ZIPs)
sets SP_SCENE_PART_BYTES (e.g. 15000000) when it extracts, or a caller passes part_bytes; the scene is then written as
scene.bin, scene1.bin, … and scene.json lists binParts. The browser reads either form (render/board3d/load.js).
"""
import os
import re

# Leave room for ZIP headers and the manifest within a 16,000,000-byte resource pack; also the browser's per-part limit
# (render/board3d/sceneTransport.js SCENE_BIN_PART_BYTES).
SCENE_BIN_PART_BYTES = 15_000_000
SCENE_BIN_MAX_BYTES = 60_000_000
SCENE_BIN_MAX_PARTS = 256
PART_BYTES_ENV = 'SP_SCENE_PART_BYTES'


def env_part_bytes():
    """The part size a deployment asks for through SP_SCENE_PART_BYTES, or None (one scene.bin)."""
    raw = os.environ.get(PART_BYTES_ENV, '').strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        raise ValueError(f'{PART_BYTES_ENV} must be a whole number of bytes') from None


def write_scene_bins(folder, blob, *, part_bytes=None, max_bytes=None, max_parts=SCENE_BIN_MAX_PARTS):
    """Write the mesh bytes as one scene.bin, or as parts when part_bytes (or SP_SCENE_PART_BYTES) is given.

    Every mesh byte and offset is preserved; the budgets are exporter policy, not a format limit. max_bytes defaults to
    SCENE_BIN_MAX_BYTES for a split scene (the browser's budget for binParts) and to no limit for one scene.bin. Part files
    a longer earlier export left behind (sceneN.bin beyond this count) are removed. Returns [{key, bytes, name}].
    """
    if part_bytes is None:
        part_bytes = env_part_bytes()
    split = part_bytes is not None
    if max_bytes is None and split:
        max_bytes = SCENE_BIN_MAX_BYTES
    if ((split and (type(part_bytes) is not int or not 0 < part_bytes <= SCENE_BIN_PART_BYTES))
            or (max_bytes is not None and (type(max_bytes) is not int or max_bytes <= 0))
            or type(max_parts) is not int or max_parts <= 0
            or not len(blob) > 0 or (max_bytes is not None and len(blob) > max_bytes)):
        raise ValueError('invalid scene transport size or budget')
    size = part_bytes if split else len(blob)
    count = (len(blob) + size - 1) // size
    if count > max_parts:
        raise ValueError('scene transport exceeds the part-count budget')
    parts = []
    for i, offset in enumerate(range(0, len(blob), size)):
        key = 'bin' if i == 0 else f'bin{i}'
        name = 'scene.bin' if i == 0 else f'scene{i}.bin'
        data = memoryview(blob)[offset:offset + size]
        (folder / name).write_bytes(data)
        parts.append({'key': key, 'bytes': len(data), 'name': name})
    stale = len(parts)
    while (folder / f'scene{stale}.bin').exists():
        (folder / f'scene{stale}.bin').unlink()
        stale += 1
    return parts


def record_scene_bins(entry, sub, parts):
    """Put the part keys of one scene into its manifest entry; drop the binN keys a longer earlier export recorded."""
    for part in parts:
        entry[part['key']] = {'path': f'/assets/local/{sub}/{part["name"]}', 'kind': 'SceneData', 'bytes': part['bytes']}
    for key in [k for k in entry if re.fullmatch(r'bin[1-9]\d*', k) and int(k[3:]) >= len(parts)]:
        del entry[key]
    return len(parts)
