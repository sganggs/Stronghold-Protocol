"""Scene transport policy; binParts is an ordered, variable-length list of manifest keys and byte lengths."""
# Leave room for ZIP headers and the manifest within a 16,000,000-byte resource pack.
SCENE_BIN_PART_BYTES = 15_000_000
SCENE_BIN_MAX_BYTES = 60_000_000
SCENE_BIN_MAX_PARTS = 256


def write_scene_bins(folder, blob, *, part_bytes=SCENE_BIN_PART_BYTES,
                     max_bytes=SCENE_BIN_MAX_BYTES, max_parts=SCENE_BIN_MAX_PARTS):
    """Preserve every mesh byte and offset; budgets are exporter policy, not a four-part format limit."""
    if (type(part_bytes) is not int or not 0 < part_bytes <= SCENE_BIN_PART_BYTES
            or type(max_bytes) is not int or max_bytes <= 0
            or type(max_parts) is not int or max_parts <= 0
            or not 0 < len(blob) <= max_bytes):
        raise ValueError('invalid scene transport size or budget')
    count = (len(blob) + part_bytes - 1) // part_bytes
    if count > max_parts:
        raise ValueError('scene transport exceeds the part-count budget')
    parts = []
    for i, offset in enumerate(range(0, len(blob), part_bytes)):
        key = 'bin' if i == 0 else f'bin{i}'
        name = 'scene.bin' if i == 0 else f'scene{i}.bin'
        data = memoryview(blob)[offset:offset + part_bytes]
        (folder / name).write_bytes(data)
        parts.append({'key': key, 'bytes': len(data), 'name': name})
    return parts
