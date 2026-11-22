#!/usr/bin/env python3
"""Add the real prefab GameObject `pathID` to each shop/card theme node.

The product theme documents already carry node ids 1..N and full
`colorGroup.nodes` / `_statusEntries`; the missing piece for the Stage B
adapter is the real prefab pathID used by status GAME_OBJECT targets and
`pathid_map`.  This tool reads the current client prefabs (theme + battle
bundles) and writes `pathID` on every node whose `path` matches the prefab
tree.  It also reports the full `colorGroup` counts and status targets.

Output defaults to the same theme directory, but the caller should pass a tmp
`--out` in the normal workflow.  The theme JSON is gitignored setup data.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOTS = {
    'panel_shop_main': 7432215050684510296,
    'autochess_shop': 8128090833685279333,
    'autochess_main_money_item': -1588087679666565701,
    'autochess_shop_card_item': 1483944088778644771,
    'frame_lv1_obj': None,
    'frame_lv2_obj': None,
    'frame_lv3_obj': None,
    'chess_level_5_obj': None,
    'chess_level_6_obj': None,
    'autochess_shop_cost_item': None,
    'autochess_shop_bond_item': None,
}


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


def game_data(raw):
    """Arknights_Data of an install directory or its Arknights_Data path; an AssetBundle root is returned as is."""
    p = Path(raw)
    if p.name == 'Arknights_Data':
        return p
    child = p / 'Arknights_Data'
    if child.is_dir():
        return child
    for parent in p.parents:
        if parent.name == 'Arknights_Data':
            return parent
    return p



def enrich_theme(theme_dir, game, log=print):
    """Write pathID on every shop/card node; return per-document stats.

    Call after the shop/card producer (and particle enrichment).  It never
    removes fields; it only adds the real prefab pathID.
    """
    theme_dir = Path(theme_dir)
    if not game:
        raise RuntimeError('missing current bundles: no game root was given')
    data = game_data(game)
    theme, battle = bundle_paths(data)

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import aklz4  # noqa: F401
    import UnityPy

    by_id = {}
    for path in (theme, battle):
        env = UnityPy.load(str(path))
        for obj in env.objects:
            by_id[obj.path_id] = obj

    def name_of(go):
        try:
            return str(go.read_typetree().get('m_Name') or '')
        except Exception:
            return ''

    def children(go):
        tree = go.read_typetree()
        for comp in tree.get('m_Component') or []:
            cid = (comp.get('component') or comp).get('m_PathID')
            co = by_id.get(cid)
            if not co or co.type.name not in ('RectTransform', 'Transform'):
                continue
            ct = co.read_typetree()
            for child in ct.get('m_Children') or []:
                tr = by_id.get(child.get('m_PathID'))
                if not tr:
                    continue
                gid = (tr.read_typetree().get('m_GameObject') or {}).get('m_PathID')
                g = by_id.get(gid)
                if g and g.type.name == 'GameObject':
                    yield g
            return

    def collect(go):
        table = {}
        stack = [(go, name_of(go))]
        while stack:
            obj, path = stack.pop()
            if path in table:
                continue
            table[path] = obj.path_id
            for child in children(obj):
                stack.append((child, path + '/' + name_of(child)))
        return table

    roots = dict(ROOTS)
    for name, pid in list(roots.items()):
        if pid is None:
            hits = [o for o in by_id.values() if o.type.name == 'GameObject' and name_of(o) == name]
            if not hits:
                raise RuntimeError(f'no prefab GameObject {name!r}')
            roots[name] = hits[0].path_id
    maps = {name: collect(by_id[pid]) for name, pid in roots.items()}
    log('  pathIDs roots: ' + ', '.join(f'{name}={len(table)}' for name, table in maps.items()))

    result = {}
    for doc_name in ('shop.json', 'card.json'):
        doc = json.loads((theme_dir / doc_name).read_text(encoding='utf-8'))
        counts = {'nodes': 0, 'pathID': 0, 'colorGroups': 0, 'statusGameObjects': 0, 'colorGroupNodes': 0}

        def walk(node, table):
            if isinstance(node, dict):
                path = node.get('path')
                if isinstance(path, str):
                    counts['nodes'] += 1
                    pid = table.get(path)
                    if pid is not None:
                        node['pathID'] = pid
                        counts['pathID'] += 1
                cg = node.get('colorGroup')
                if isinstance(cg, dict) and isinstance(cg.get('nodes'), list):
                    counts['colorGroups'] += 1
                    counts['colorGroupNodes'] += len(cg['nodes'])
                for comp in node.get('components') or []:
                    for entry in ((comp.get('fields') or {}).get('_statusEntries') or []):
                        for desc in entry.get('descriptions') or []:
                            if (desc.get('gameObject') or {}).get('pid') is not None:
                                counts['statusGameObjects'] += 1
                for value in node.values():
                    walk(value, table)
            elif isinstance(node, list):
                for value in node:
                    walk(value, table)

        if doc_name == 'shop.json':
            for key, pref in doc['prefabs'].items():
                walk(pref.get('root'), maps[key])
        else:
            walk(doc.get('root'), maps['autochess_shop_card_item'])
            for key, pref in doc.get('sub', {}).items():
                root = pref.get('root') or {}
                table = maps.get(key) or maps.get(root.get('path') or key)
                if table:
                    walk(root, table)
                else:
                    log(f'  skip sub prefab {key}')
        target = theme_dir / doc_name
        target.write_bytes(json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode())
        result[doc_name] = counts
        log(f'  {doc_name}: {target.stat().st_size} B {counts}')
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--game', required=True, help='install root or Arknights_Data')
    ap.add_argument('--theme-dir', required=True, help='theme pack with shop.json/card.json')
    ap.add_argument('--out', default='', help='write patched JSON here (default: theme-dir)')
    args = ap.parse_args()
    dest = Path(args.out) if args.out else Path(args.theme_dir)
    if dest != Path(args.theme_dir):
        import shutil
        dest.mkdir(parents=True, exist_ok=True)
        for name in ('shop.json', 'card.json'):
            shutil.copyfile(Path(args.theme_dir) / name, dest / name)
    enrich_theme(dest, args.game, print)


if __name__ == '__main__':
    main()
