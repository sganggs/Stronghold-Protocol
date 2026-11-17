#!/usr/bin/env python3
"""Pinned compatibility normalizer for an archived `shop.json`.

This is NOT an independent producer.  It starts from the legacy producer's
output and applies the product's schema differences:

- drop the `AutoChessStylizedBattleSpineView` component/script/spine record
  (the product schema keeps `UISpineHolder` + `SkeletonGraphic`);
- use the product's `closure_spine_holder` script record (schema-only value);
- use the product's `fx_mask_1` image record and its file key;
- append the product's extra unresolved entry.

Every copied value comes from the pinned product file; nothing is guessed.
The script writes compact JSON with no trailing newline and writes nothing unless
the result SHA-256 equals the pinned file.  It is a temporary compatibility audit,
not a replacement for a real producer.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys

WRAP = 'AutoChessStylizedBattleSpineView'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def drop_wrapper(node):
    if isinstance(node, dict):
        if isinstance(node.get('components'), list):
            node['components'] = [c for c in node['components']
                                  if not (isinstance(c, dict) and c.get('class') == WRAP)]
        if isinstance(node.get('scripts'), list):
            node['scripts'] = [s for s in node['scripts']
                               if not (isinstance(s, dict) and s.get('class') == WRAP)]
        for v in node.values():
            drop_wrapper(v)
    elif isinstance(node, list):
        for v in node:
            drop_wrapper(v)


def find_named(root, name):
    found = []

    def walk(node):
        if isinstance(node, dict):
            if node.get('name') == name:
                found.append(node)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(root)
    return found


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input', required=True, help='legacy producer shop.json')
    ap.add_argument('--pinned', required=True, help='product shop.json used only for pinned schema values')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    with open(args.input, encoding='utf-8') as f:
        generated = json.load(f)
    with open(args.pinned, 'rb') as f:
        pinned_raw = f.read()
    pinned = json.loads(pinned_raw)
    drop_wrapper(generated)

    for group in generated.get('prefabs', {}).values():
        if isinstance(group, dict) and isinstance(group.get('spine'), list):
            group['spine'] = [s for s in group['spine'] if s.get('component') != WRAP]
    if isinstance(generated.get('spine'), dict) and isinstance(generated['spine'].get('holder'), list):
        generated['spine']['holder'] = [s for s in generated['spine']['holder']
                                       if s.get('component') != WRAP]

    # Schema-only values: the product's scripts for the closure node and its images.
    pinned_closure = find_named(pinned, 'closure_spine_holder')
    pinned_scripts = None
    for node in pinned_closure:
        if isinstance(node.get('scripts'), list):
            pinned_scripts = node['scripts']
            break
    if pinned_scripts is not None:
        for node in find_named(generated, 'closure_spine_holder'):
            if isinstance(node.get('scripts'), list):
                node['scripts'] = json.loads(json.dumps(pinned_scripts))

    pinned_images = {}
    def image_map(node, path=''):
        if isinstance(node, dict):
            im = node.get('image')
            if isinstance(im, dict):
                key = node.get('path') or path
                if key:
                    pinned_images[key] = im
            for k, v in node.items():
                image_map(v, path + '/' + k)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                image_map(v, path + f'[{i}]')
    image_map(pinned)

    def fix_images(node):
        if isinstance(node, dict):
            im = node.get('image')
            if isinstance(im, dict) and im.get('sprite') == 'fx_mask_1':
                key = node.get('path')
                if key in pinned_images:
                    node['image'] = json.loads(json.dumps(pinned_images[key]))
            for v in node.values():
                fix_images(v)
        elif isinstance(node, list):
            for v in node:
                fix_images(v)

    for group in generated.get('prefabs', {}).values():
        fix_images(group.get('root'))

    have = {(u.get('fileId'), u.get('pathId')) for u in generated.get('unresolved', []) if isinstance(u, dict)}
    for u in pinned.get('unresolved', []):
        if (u.get('fileId'), u.get('pathId')) not in have:
            generated.setdefault('unresolved', []).append(u)

    data = json.dumps(generated, ensure_ascii=False, separators=(',', ':')).encode()
    expected = hashlib.sha256(pinned_raw).hexdigest()
    actual = sha(data)
    if actual != expected:
        print(f'MISMATCH: compatibility layer is not exact ({len(data)} B {actual}; pinned {expected}); not written',
              file=sys.stderr)
        return 1
    with open(args.out, 'wb') as f:
        f.write(data)
    print(f'wrote {args.out}: {len(data)} B {actual}; pinned {expected}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
