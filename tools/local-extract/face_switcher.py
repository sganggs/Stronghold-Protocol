#!/usr/bin/env python3
"""The official turn time of an operator's model, read from a locally installed Arknights client (optional, host-side).

Every operator's art bundle (`chararts/char_*.ab`) carries a `FaceSwitcher` GameObject whose MonoBehaviour body is two
fields after the standard header: a float and an int — `_switchTime` (the Front/Back + mirror turn, game seconds) and
`_defaultLOrR` (the default side, 3 = left), the names from @Seals-awa's metadata reading (PR #730,
docs/research/10-face-logic.md §6). The remake's attack turn takes `_switchTime` (render/facing.js FACING_TURN_S,
DESIGN §37.329). Run on the Windows client of 2026-11-21: 471 of 471 bundles hold (0.15, 3).

The MonoBehaviour has no type tree in the bundle, so the body is read raw: PPtr m_GameObject (12 bytes), m_Enabled
(4), PPtr m_Script (12), m_Name (length + bytes, 4-aligned), then the fields.

Usage:
  .venv-extract/bin/python tools/local-extract/face_switcher.py [--game <AB root>] [--only char_102_texas,...] [--json]
Needs UnityPy + lz4 (tools/local-extract/requirements.txt).
"""
import argparse
import collections
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract import locate_client  # noqa: E402


def face_switcher_fields(env):
    """[(switchTime, defaultLOrR)] of every FaceSwitcher GameObject's two-field MonoBehaviour in a loaded bundle."""
    objects = list(env.objects)
    out = []
    for go in objects:
        if go.type.name != 'GameObject':
            continue
        try:
            if go.read().m_Name != 'FaceSwitcher':
                continue
        except Exception:  # an object UnityPy cannot read is not ours
            continue
        for mb in objects:
            if mb.type.name != 'MonoBehaviour':
                continue
            raw = mb.get_raw_data()
            if len(raw) < 32:
                continue
            file_id, path_id = struct.unpack_from('<iq', raw, 0)
            if file_id != 0 or path_id != go.path_id:
                continue
            name_len = struct.unpack_from('<i', raw, 28)[0]
            body = 32 + ((name_len + 3) & ~3)
            if len(raw) != body + 8:
                continue
            out.append((round(struct.unpack_from('<f', raw, body)[0], 6), struct.unpack_from('<i', raw, body + 4)[0]))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--game', help='install directory or AB root (default: the known install locations)')
    ap.add_argument('--only', help='comma-separated charIds (default: every chararts/char_*.ab)')
    ap.add_argument('--json', action='store_true', help='print {charId: [[switchTime, defaultLOrR], ...]}')
    args = ap.parse_args()
    ab_root = locate_client(args.game)
    if not ab_root or not (ab_root / 'chararts').exists():
        sys.exit('face_switcher: no local client found (pass --game <install directory or AB root>)')

    import aklz4  # noqa: F401  (registers the client's block compression)
    import UnityPy

    if args.only:
        files = [ab_root / 'chararts' / f'{c.strip()}.ab' for c in args.only.split(',') if c.strip()]
    else:
        files = sorted((ab_root / 'chararts').glob('char_*.ab'))
    found = {}
    for f in files:
        if not f.exists():
            print(f'missing: {f.name}', file=sys.stderr)
            continue
        found[f.stem] = face_switcher_fields(UnityPy.load(str(f)))
    if args.json:
        print(json.dumps(found, indent=1, sort_keys=True))
        return
    tally = collections.Counter(v for vals in found.values() for v in vals)
    without = sorted(k for k, v in found.items() if not v)
    print(f'{len(found)} bundles; (switchTime, defaultLOrR): ' + ', '.join(f'{k} x{n}' for k, n in tally.most_common()))
    if without:
        print(f'no FaceSwitcher: {len(without)}: ' + ', '.join(without[:20]))


if __name__ == '__main__':
    main()
