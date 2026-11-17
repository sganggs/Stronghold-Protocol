#!/usr/bin/env python3
"""Export the official card portrait soft-mask into the local theme pack.

Source: `[uc]ac_n_initial.ab` (not ac_s_closur), Sprite `mask_char` path_id
-8520018118241708430, 155x187.  The extracted PNG is 9,695 B and must match
SHA-256 53da8cc903e1f5360efd2d3335094ee19fd6b75db9199ccf10ff5fba91b74194.
The image is official art and local-only: `public/assets` is gitignored; this
script never commits it and never edits UI code.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import sys
from pathlib import Path

EXPECTED_SIZE = 9695
EXPECTED_SHA = '53da8cc903e1f5360efd2d3335094ee19fd6b75db9199ccf10ff5fba91b74194'
SPRITE_NAME = 'mask_char'
SPRITE_PATH_ID = -8520018118241708430


def _game_data(raw):
    p = Path(raw)
    if p.name == 'Arknights_Data':
        return p
    child = p / 'Arknights_Data'
    if child.is_dir():
        return child
    for parent in p.parents:
        if parent.name == 'Arknights_Data':
            return parent
    raise SystemExit(f'not an Arknights_Data install: {raw}')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--game', required=True, help='install root or Arknights_Data')
    ap.add_argument('--out', default='public/assets/local/themes/ac_s_closur/sprites/mask_char_portrait.png')
    args = ap.parse_args()
    game = _game_data(args.game)
    bundle = game / 'StreamingAssets/AB/Windows/ui/autochess/autochessvariantskin/[uc]ac_n_initial.ab'
    if not bundle.is_file():
        raise SystemExit(f'missing bundle: {bundle}')

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import aklz4  # noqa: F401
    import UnityPy
    from PIL import Image

    env = UnityPy.load(str(bundle))
    hit = None
    for obj in env.objects:
        if obj.type.name != 'Sprite':
            continue
        try:
            data = obj.read()
            if data.m_Name == SPRITE_NAME:
                hit = (obj, data)
                break
        except Exception:
            continue
    if hit is None:
        raise SystemExit(f'no Sprite {SPRITE_NAME!r} in {bundle.name}')
    obj, sprite = hit
    if obj.path_id != SPRITE_PATH_ID:
        print(f'warn: Sprite path_id {obj.path_id} != expected {SPRITE_PATH_ID}', file=sys.stderr)
    image = sprite.image
    if image.size != (155, 187):
        raise SystemExit(f'unexpected sprite size {image.size}')
    buf = io.BytesIO()
    image.save(buf, 'PNG')
    png = buf.getvalue()
    sha = hashlib.sha256(png).hexdigest()
    if len(png) != EXPECTED_SIZE or sha != EXPECTED_SHA:
        raise SystemExit(f'PNG mismatch: {len(png)} B {sha}; expected {EXPECTED_SIZE} B {EXPECTED_SHA}')
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.is_file():
        old = hashlib.sha256(out.read_bytes()).hexdigest()
        if old == EXPECTED_SHA:
            print(f'keep {out}: already {EXPECTED_SIZE} B {EXPECTED_SHA}')
            return 0
        print(f'conflict {out}: existing {out.stat().st_size} B {old}; not overwritten', file=sys.stderr)
        return 1
    out.write_bytes(png)
    print(f'wrote {out} ({len(png)} B {sha})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
