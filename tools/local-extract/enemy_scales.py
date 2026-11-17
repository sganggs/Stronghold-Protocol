#!/usr/bin/env python3
"""Official drawn size of the enemy models, read from a locally installed Arknights client (optional, host-side).

The client scales every enemy Spine model in its battle prefab (dyn/battle/prefabs/enemies/<prefab>.prefab, bundles
battle/enm_pfb_*.ab): world size = skeleton units x SkeletonDataAsset.scale (0.01 for every enemy skeleton) x the
product of the transform scales from the prefab root down to the GameObject that carries the Spine MeshRenderer
(Graphic / FaceSwitcher / Spine). That product is 0.27 for most prefabs (the standard the remake's UNIT.modelScale
stands for) and differs for the rest (威龙 0.16, 妖怪 0.20, 青铜镜 0.6 ...).

This script prints the product of every prefab named by data/enemies.json (`spine` = enemy_database prefabKey) that is
not the standard, grouped by value, as the MODEL_SCALES table of tools/build-data.mjs (user playtest #6 item 9).

Usage:
  .venv/bin/python tools/local-extract/enemy_scales.py [--game <AB root>] [--json]
Needs UnityPy + lz4 (tools/local-extract/requirements.txt); --json prints {prefab: product} for every prefab found.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract import ROOT, locate_client  # noqa: E402

STANDARD = 0.27


def group_table(scales, standard=STANDARD):
    """{prefab: product} -> the build-data MODEL_SCALES lines ([value, ['1005_yokai_3', ...]] sorted by value)."""
    groups = {}
    for prefab, v in scales.items():
        if v is None or abs(v - standard) < 1e-6:
            continue
        groups.setdefault(round(abs(v), 4), []).append(re.sub(r'^enemy_', '', prefab))
    lines = []
    for v in sorted(groups):
        names = ', '.join("'%s'" % n for n in sorted(groups[v]))
        lines.append('  [%s, [%s]],' % (('%g' % v), names))
    return lines


def renderer_scale(root_go, by_id):
    """Product of the transform scales from a prefab root to its (active) Spine MeshRenderer; None when not exactly one."""
    found = []

    def walk(god, cum, depth):
        tr = None
        has_mr = False
        for c in god['m_Component']:
            r = by_id.get(c['component']['m_PathID'])
            if r is None:
                continue
            if r.type.name == 'Transform':
                tr = r.read_typetree()
            elif r.type.name == 'MeshRenderer':
                has_mr = True
        if tr is None:
            return
        s = tr['m_LocalScale']
        cum = (cum[0] * s['x'], cum[1] * s['y'])
        if has_mr and god.get('m_IsActive', True):
            found.append(abs(cum[0]))
        if depth > 6:
            return
        for ch in tr['m_Children']:
            cr = by_id.get(ch['m_PathID'])
            if cr is None:
                continue
            g = by_id.get(cr.read_typetree()['m_GameObject']['m_PathID'])
            if g is not None:
                walk(g.read_typetree(), cum, depth + 1)

    walk(root_go, (1.0, 1.0), 0)
    return round(found[0], 5) if len(found) == 1 else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--game', help='install directory or AB root (default: the known install locations)')
    ap.add_argument('--json', action='store_true', help='print {prefab: product} instead of the table')
    args = ap.parse_args()
    ab_root = locate_client(args.game)
    if not ab_root or not (ab_root / 'battle').exists():
        sys.exit('enemy_scales: no local client found (pass --game <install directory or AB root>)')
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    enemies = json.loads((ROOT / 'data' / 'enemies.json').read_text('utf8'))
    wanted = {e.get('spine') or k for k, e in enemies.items()}
    scales = {}
    for f in sorted((ab_root / 'battle').glob('enm_pfb*.ab')):
        env = UnityPy.load(str(f))
        by_id = {o.path_id: o for o in env.objects}
        for name, obj in env.container.items():
            m = re.search(r'/enemies/(.+)\.prefab$', name)
            if m and m.group(1) in wanted:
                scales[m.group(1)] = renderer_scale(obj.read_typetree(), by_id)
    missing = sorted(wanted - set(scales))
    if missing:
        print('// no prefab found: ' + ', '.join(missing), file=sys.stderr)
    if args.json:
        print(json.dumps(scales, indent=1, sort_keys=True))
    else:
        print('\n'.join(group_table(scales)))


if __name__ == '__main__':
    main()
