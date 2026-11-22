#!/usr/bin/env python3
"""Particle enrichment for the shop/card theme documents (W60/W62-compatible).

Wraps the lab's validated current-bundle particle walker and merges the
missing fields into the generated shop.json/card.json:

  pathId, modules.emission (with bursts), renderer/materials

It runs after the base producer and before path_ids.enrich_theme.  Missing
systems (notably the card sub `frame_lv2/3 tv_particle`) stay untouched.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Below Arknights_Data. PersistentData holds the hot-updated bundles, StreamingAssets/AB/Windows the packaged ones
# (an install that has never downloaded the theme uses only the latter). A caller may also hand us an AssetBundle
# root itself — PlayCover's Documents/Bundles, or the hot-update root client_bundles links — which holds
# ui/autochess/… directly, so it is the last candidate.
BUNDLE_REL = ('ui/autochess/autochessvariantskin/[uc]ac_s_closur.ab',
              'ui/autochess/[uc]autochessbattle.ab')


def bundle_paths(data):
    """(theme, battle) bundle under `data`: PersistentData first, then StreamingAssets/AB/Windows, then `data` itself.

    Each bundle is looked up on its own: a hot-updated client commonly has the theme only in PersistentData and
    the unchanged battle bundle only in StreamingAssets, and requiring both under the same root skipped every
    enrichment step on such an install.
    """
    roots = (Path(data) / 'PersistentData' / 'Bundles',
             Path(data) / 'StreamingAssets' / 'AB' / 'Windows',
             Path(data))
    theme, battle = (next((path for path in (root / rel for root in roots) if path.is_file()), None)
                     for rel in BUNDLE_REL)
    if theme is not None and battle is not None:
        return theme, battle
    theme = theme or roots[0] / BUNDLE_REL[0]
    battle = battle or roots[0] / BUNDLE_REL[1]
    raise RuntimeError(f'missing current bundles: {theme} / {battle} (also looked in '
                       + ', '.join(str(root) for root in roots[1:]) + ')')


def enrich_theme(theme_dir, game, log=print):
    theme_dir = Path(theme_dir)
    if not game:
        raise RuntimeError('missing current bundles: no game root was given')
    data = Path(game)
    if data.name != 'Arknights_Data':
        child = data / 'Arknights_Data'
        if child.is_dir():
            data = child
        else:
            for parent in data.parents:
                if parent.name == 'Arknights_Data':
                    data = parent
                    break
    theme, battle = bundle_paths(data)

    sys.path.insert(0, str(HERE))
    import theme_particles_impl as impl

    impl.BUNDLES = {'theme': str(theme), 'battle': str(battle)}
    impl.THEME = str(theme_dir)
    impl.OUT_JSON = str(theme_dir / '_particles.json')
    impl.BACKUP = str(theme_dir / '.particle-backup')
    impl.main()

    systems = json.loads((theme_dir / '_particles.json').read_text(encoding='utf-8'))['prefabs']
    by_path = {}
    for rec in systems.values():
        for s in rec.get('systems') or []:
            by_path[s['path']] = s
    stats = {'entries': 0, 'pathId': 0, 'emission': 0, 'renderer': 0, 'unresolved': 0}

    def merge(entry):
        s = by_path.get(entry.get('path'))
        if not s:
            stats['unresolved'] += 1
            return
        stats['entries'] += 1
        if entry.get('pathId') is None:
            entry['pathId'] = s.get('pathId')
            stats['pathId'] += 1
        mods = entry.setdefault('modules', {})
        if 'emission' not in mods:
            mods['emission'] = s.get('emission') or {}
            stats['emission'] += 1
        r = entry.setdefault('renderer', {})
        lab_r = s.get('renderer') or {}
        for key in ('pathId', 'materials', 'renderMode'):
            if key not in r and key in lab_r:
                r[key] = lab_r[key]
                stats['renderer'] += 1
        if 'materials' not in entry and lab_r.get('materials'):
            entry['materials'] = lab_r['materials']
        if 'material' not in entry and lab_r.get('materials'):
            entry['material'] = lab_r['materials'][0].get('name')
        if 'texture' not in entry and lab_r.get('materials'):
            entry['texture'] = lab_r['materials'][0].get('mainTexture')

    def walk(node):
        if isinstance(node, dict):
            if isinstance(node.get('particles'), list):
                for e in node['particles']:
                    merge(e)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    for name in ('shop.json', 'card.json'):
        p = theme_dir / name
        doc = json.loads(p.read_text(encoding='utf-8'))
        walk(doc)
        p.write_bytes(json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode())
        log(f'  particles {name}: {stats}')
    (theme_dir / '_particles.json').unlink(missing_ok=True)
    import shutil
    shutil.rmtree(theme_dir / '.particle-backup', ignore_errors=True)
    return stats


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--game', required=True, help='install directory or Arknights_Data with the current bundles')
    ap.add_argument('--theme-dir', required=True, help='an extracted theme pack holding shop.json / card.json')
    args = ap.parse_args()
    try:
        enrich_theme(args.theme_dir, args.game)
    except RuntimeError as err:
        print(f'FAIL: {err}', file=sys.stderr)
        raise SystemExit(1)
    raise SystemExit(0)
