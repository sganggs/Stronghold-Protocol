#!/usr/bin/env python3
"""Official per-model model placement, read from a locally installed Arknights client (optional, host-side).

Answers "does the client move a model relative to its unit position, and does it scale it?" — the two questions the
remake's renderer needs (public/js/render/units.js FLY_HOVER / enemyModelScale).

It reads the battle prefabs (`dyn/battle/prefabs/enemies/<prefab>.prefab`, bundles `battle/enm_pfb_*.ab`) and reports,
per enemy:

  * `Graphic` — the node that carries the Spine model — its **local position and scale relative to the prefab root**.
    The *root's* own local position is an editor leftover (妖怪 (0,0,0), 帝国炮火先兆者 (4.23,2.11,−1.2), 源石虫 (3,3,0),
    掠海漂移体 (2.21,5.23,0)) and is overwritten with the unit's world position at instantiation, so it means nothing;
    only the `Graphic` node is a real placement.
  * the comparison `sy / sx`: ≠1 means the client stretches the model vertically (measured for 帝国炮火先兆者 /
    帝国炮火中枢先兆者: Graphic scale (0.19, 0.24, 0.24) — the model is drawn 1.263× taller than its uniform scale, while
    `enemies.json modelScale` only carries the horizontal 0.19/0.27).

Findings for this mode's 28 flying units (2026-10-05): the `Graphic` vertical offset is **0** for all of them — 10 at
local (0,0,0) and 17 at the same (0,−0.2,−0.06) that ground units such as 源石虫 share (a prefab-family convention, not a
per-model correction) — i.e. the client applies **no per-model vertical correction**, which is why
`units.js FLY_HOVER` is a flat constant and why a model whose art hangs below its pivot keeps that hang.

Usage:
  python tools/local-extract/enemy_model_offsets.py [--game <AB root>] [--keys k1,k2,...] [--only-fly]
Needs UnityPy + lz4 (tools/local-extract/requirements.txt).
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract import CANDIDATES, ROOT  # noqa: E402

import aklz4  # noqa: F401
import UnityPy


def graphic_of(root_god, by_id):
    """The prefab root's `Graphic` child → ((x, y, z), (sx, sy, sz)), or (None, None) when absent."""
    for c in root_god['m_Component']:
        r = by_id.get(c['component']['m_PathID'])
        if r is None or r.type.name != 'Transform':
            continue
        tr = r.read_typetree()
        for ch in tr['m_Children']:
            cr = by_id.get(ch['m_PathID'])
            if cr is None:
                continue
            ctr = cr.read_typetree()
            g = by_id.get(ctr['m_GameObject']['m_PathID'])
            if g is None:
                continue
            if g.read_typetree().get('m_Name') == 'Graphic':
                p = ctr['m_LocalPosition']
                s = ctr['m_LocalScale']
                return (p['x'], p['y'], p['z']), (s['x'], s['y'], s['z'])
    return None, None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--game', help='AB root of the local client (default: the known install locations)')
    ap.add_argument('--keys', help='comma-separated enemies.json keys (default: every enemy)')
    ap.add_argument('--only-fly', action='store_true', help='just the units whose stats.motion is FLY')
    ap.add_argument('--json', action='store_true', help='print the raw {prefab: {pos, scale}} JSON instead of a table')
    args = ap.parse_args()
    ab_root = Path(args.game) if args.game else next((p for p in CANDIDATES if p.exists()), None)
    if not ab_root or not (ab_root / 'battle').exists():
        sys.exit('enemy_model_offsets: no local client found (pass --game <AB root>)')

    enemies = json.loads((ROOT / 'data' / 'enemies.json').read_text('utf8'))
    if args.keys:
        keys = [k.strip() for k in args.keys.split(',') if k.strip()]
    else:
        keys = [k for k, v in enemies.items() if not args.only_fly or v.get('stats', {}).get('motion') == 'FLY']
    wanted = {enemies[k].get('spine') or k: k for k in keys if k in enemies}

    rows = {}
    for f in sorted((ab_root / 'battle').glob('enm_pfb*.ab')):
        env = UnityPy.load(str(f))
        by_id = {o.path_id: o for o in env.objects}
        for name, obj in env.container.items():
            m = re.search(r'/enemies/(.+)\.prefab$', name)
            if m and m.group(1) in wanted:
                rows[m.group(1)] = graphic_of(obj.read_typetree(), by_id)

    if args.json:
        out = {}
        for prefab, key in wanted.items():
            e = enemies[key]
            if prefab not in rows or rows[prefab][0] is None:
                out[key] = None
                continue
            p, s = rows[prefab]
            out[key] = {'prefab': prefab, 'name': e.get('name'), 'motion': e.get('stats', {}).get('motion'),
                        'pos': list(p), 'scale': list(s), 'modelScale': e.get('modelScale')}
        print(json.dumps(out, indent=1, sort_keys=True, ensure_ascii=False))
        return

    print(f"{'key':<24}{'name':<18}{'Graphic pos (x,y,z)':<28}{'scale (sx,sy,sz)':<28}{'sy/sx':<8}{'modelScale'}")
    for prefab, key in wanted.items():
        e = enemies[key]
        ms = e.get('modelScale')
        if prefab not in rows or rows[prefab][0] is None:
            print(f'{key:<24}{str(e.get("name"))[:16]:<18}— no Graphic node —')
            continue
        p, s = rows[prefab]
        ratio = (s[1] / s[0]) if s[0] else float('nan')
        print(f'{key:<24}{str(e.get("name"))[:16]:<18}'
              f'({p[0]:.3f}, {p[1]:.3f}, {p[2]:.3f})'.ljust(28)
              + f'({s[0]:.4f}, {s[1]:.4f}, {s[2]:.4f})'.ljust(28)
              + f'{ratio:<8.3f}{ms if ms is not None else 1}')


if __name__ == '__main__':
    main()
