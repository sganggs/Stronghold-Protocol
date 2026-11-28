#!/usr/bin/env python3
"""Extract the 规程 shop chrome prefabs into one `<theme>/shop.json` (stage M0).

`card_prefab.py` is built around one card prefab; this module reuses its tree walker (`_prefab_doc`) for any prefab and
writes a document with the same node shape, so the WebGL card renderer can draw the panels unchanged. It extracts:

- theme `prefabs/shop/panel_shop_main.prefab` (185 nodes incl. fold/unfold states, ctrl buttons, upgrade, card row holder)
- battle `ui/autochess/shop/autochess_shop.prefab` (28: holders + sell views)
- battle `ui/autochess/shop/autochess_main_money_item.prefab` (11: money + gain FX/particles)

Output is local art data (the theme pack is git-ignored): `<out>/shop.json`. Spine is recorded by reference only (M0 does
not render it); cross-bundle template references (`group_upgrade` cost view, `group_slots` card, money view) are kept in
`refs` for later milestones.

Usage:
  .venv-extract/Scripts/python.exe tools/local-extract/shop_prefab.py \\
      --themes "<AB root with the theme bundles>" --theme ac_s_closur \\
      --out "<scratch>/themes/ac_s_closur"
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import aklz4  # noqa: F401  (registers the LZ4AK decoder)
import autochess_themes as themes  # noqa: E402
import card_prefab as cp  # noqa: E402
import unity_deps  # noqa: E402

THEME_PANEL = 'prefabs/shop/panel_shop_main.prefab'
BATTLE_SHOP = 'shop/autochess_shop.prefab'
BATTLE_MONEY = 'shop/autochess_main_money_item.prefab'
SPINE_NODE = 'closure_spine_holder'
STENCIL_NODE = 'stencil_cleaner'

# The CAB index cache lives under this checkout's .cache/ (unity_deps.cache_path), never under the caller's CWD:
# the producer's other entry point (autochess_themes.py) and the extractor run from the repository root.
REPO_ROOT = Path(__file__).resolve().parents[2]


# Snapshot of sprites/ taken before the shop walk. The class lives in card_prefab so a re-run test can
# import it without UnityPy; bind_resolved_sprites fills Images that snapshot could not see yet.
DirBook = cp.DirBook


def _load(bundle, index):
    deps = unity_deps.Deps(index, log=lambda *a: None)
    env, bundle_file, serialized = deps.load(str(bundle), attach=False)
    if serialized is None:
        raise RuntimeError(f'no SerializedFile in {bundle}')
    objects = dict(getattr(serialized, 'objects', None) or {})
    deps.attach(env)
    return deps, env, serialized, objects


def _find(env, suffix):
    for path, pointer in env.container.items():
        if str(path).lower().endswith(suffix.lower()):
            return path, pointer
    return None, None


def _ctx(env, serialized, objects, book, dest):
    return {
        'serialized': serialized, 'objects': objects, 'book': book, 'dest': Path(dest), 'asset_path': {},
        'materials': {}, 'particles': [], 'files': set(), 'unresolved': [], 'scripts': {}, 'shader_objects': {},
        'nodes': {}, 'refs': set(), 'node_count': 0, 'seen': None, 'ext_sprites': {}, 'ext_used': set(),
        'tex_files': {},
    }


def _walk_all(node, visit):
    visit(node)
    for child in node.get('children') or []:
        _walk_all(child, visit)


def _spine_refs(doc):
    found = []
    def visit(node):
        spine = node.get('spine')
        if spine:
            found.append({'path': node.get('path'), 'name': node.get('name'), 'spine': spine})
        for comp in node.get('components') or []:
            cls = str(comp.get('class') or '')
            if 'Spine' in cls or 'Skeleton' in cls:
                found.append({'path': node.get('path'), 'name': node.get('name'), 'component': cls,
                              'fields': comp.get('fields')})
    _walk_all(doc['root'], visit)
    return found


def _clip_names(doc):
    names = set()
    def visit(node):
        for name in node.get('clips') or []:
            names.add(name)
    _walk_all(doc['root'], visit)
    return sorted(names)


def _refs(doc):
    refs = {}
    def visit(node):
        for key, pointer in (node.get('prefabRefs') or {}).items():
            refs[f"{node.get('path')}#{key}"] = pointer
        for comp in node.get('components') or []:
            for key, value in (comp.get('fields') or {}).items():
                if isinstance(value, dict) and 'prefabRef' in value:
                    refs[f"{node.get('path')}#{comp.get('class')}.{key}"] = value
    _walk_all(doc['root'], visit)
    return refs


def _panel(panel_path, pointer, ctx, key, clips_by_name):
    doc = cp._prefab_doc(pointer.deref(), ctx, key, panel_path, clips_by_name)
    return {
        'key': key,
        'container': panel_path,
        'pathID': pointer.m_PathID,
        'nodeCount': doc['nodeCount'],
        'size': doc.get('size'),
        'root': doc['root'],
        'ids': doc['ids'],
        'roles': doc['roles'],
        'runtime': doc['runtime'],
        'materials': doc['materials'],
        'clips': doc['clips'],
        'particles': doc['particles'],
        'refs': _refs(doc),
        'spine': _spine_refs(doc),
    }


def _item_card(env_theme, ctx_theme, clips_by_name):
    """The equipment (item) card: the battle bundle has no item prefab (its shop folder holds only the chrome,
    the cost item, the bond item and the money item), so the card template is the theme's
    `prefabs/shop/autochess_shop_card_item.prefab` and its `group_equip` subtree — the view fills the item icon,
    name and price at runtime (`AutoChessBattleShopCardView._RenderEquip`). The subtree is kept as `sub.item_card`
    so W3/W4 can draw an item card without re-reading card.json."""
    path, pointer = _find(env_theme, sp_card_prefab())
    if pointer is None:
        return None
    doc = cp._prefab_doc(pointer.deref(), ctx_theme, 'autochess_shop_card_item', path, clips_by_name)
    found = None
    def walk(node):
        nonlocal found
        if found is None and node.get('name') == 'group_equip':
            found = node
        for child in node.get('children') or []:
            walk(child)
    walk(doc['root'])
    if found is None:
        return {'prefab': path, 'pathID': pointer.m_PathID, 'nodeCount': 0, 'root': None}
    count = 0
    def count_nodes(node):
        nonlocal count
        count += 1
        for child in node.get('children') or []:
            count_nodes(child)
    count_nodes(found)
    return {
        'prefab': path,
        'pathID': pointer.m_PathID,
        'path': found.get('path'),
        'nodeCount': count,
        'root': found,
        'source': 'theme card prefab, group_equip subtree (official _RenderEquip fills icon/name/price at runtime)',
    }


def sp_card_prefab():
    """The card prefab path the card extractor uses (`autochess_shop_card_item`), shared so both documents agree."""
    return cp.CARD_PREFAB



def export_shop(theme_bundle, battle_bundle, out, theme='ac_s_closur', version=None, index=None, log=print):
    """Build <out>/shop.json from explicit theme/battle bundles.

    ``index`` is the CAB index (unity_deps.index_bundles); when omitted a small
    local index is built from the two bundle directories.  This is the entry
    point called by autochess_themes after card.json; the CLI below only
    resolves paths and calls it.
    """
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    theme_bundle = Path(theme_bundle)
    battle_bundle = Path(battle_bundle)
    if index is None:
        index = unity_deps.index_bundles([theme_bundle.parent, battle_bundle.parent], cache=unity_deps.cache_path(REPO_ROOT), log=log)
    dep_theme, env_theme, ser_theme, objects_theme = _load(theme_bundle, index)
    book = DirBook(out / 'sprites')
    ctx_theme = _ctx(env_theme, ser_theme, objects_theme, book, out)
    panel_path, panel_ptr = _find(env_theme, THEME_PANEL)
    if panel_ptr is None:
        raise RuntimeError(f'{THEME_PANEL} not found in {theme_bundle}')
    dep_battle, env_battle, ser_battle, objects_battle = _load(battle_bundle, index)
    ctx_battle = _ctx(env_battle, ser_battle, objects_battle, book, out)
    shop_path, shop_ptr = _find(env_battle, BATTLE_SHOP)
    money_path, money_ptr = _find(env_battle, BATTLE_MONEY)
    if shop_ptr is None or money_ptr is None:
        raise RuntimeError('autochess_shop / autochess_main_money_item not found')
    clips_by_name = cp._local_clips(ser_theme)
    clips_by_name.update(cp._local_clips(ser_battle))
    panel = _panel(panel_path, panel_ptr, ctx_theme, 'panel_shop_main', clips_by_name)
    shop = _panel(shop_path, shop_ptr, ctx_battle, 'autochess_shop', clips_by_name)
    money = _panel(money_path, money_ptr, ctx_battle, 'autochess_main_money_item', clips_by_name)
    item_card = _item_card(env_theme, ctx_theme, clips_by_name)
    # The walk above exports material textures after some Images have already been resolved against the
    # snapshot in `book`. Bind those Images to the pictures now on disk so a fresh directory matches a re-run.
    late_files = set()
    cp.bind_resolved_sprites(
        [panel.get('root'), shop.get('root'), money.get('root'), (item_card or {}).get('root')],
        out, late_files)

    spine_files = sorted(str(p.relative_to(out)).replace('\\', '/') for p in (out / 'spine').glob('*')) if (out / 'spine').is_dir() else []
    for item in (panel, shop, money):
        item['clipNames'] = _clip_names({'root': item['root']})
    spine = {
        'node': f'panel_shop_main/fold_mask_spine/{SPINE_NODE}',
        'stencilCleaner': f'panel_shop_main/fold_mask_spine/{STENCIL_NODE}',
        'holder': panel['spine'],
        'assets': spine_files,
        'skel': next((f for f in spine_files if f.endswith(('.skel', '.json'))), None),
        'atlas': next((f for f in spine_files if f.endswith('.atlas')), None),
        'texture': next((f for f in spine_files if f.endswith('.png')), None),
    }
    if version is None:
        version = themes.client_data_version(Path(__file__).resolve().parents[2])
    doc = {
        'spVersion': 1,
        'theme': theme,
        'version': version,
        'prefabs': {
            'panel_shop_main': panel,
            'autochess_shop': shop,
            'autochess_main_money_item': money,
        },
        'spine': spine,
        'spineAssets': spine_files,
        'sub': {'item_card': item_card} if item_card else {},
        'assets': sorted(set(ctx_theme['files']) | set(ctx_battle['files']) | late_files),
        'unresolved': (ctx_theme['unresolved'] or []) + (ctx_battle['unresolved'] or []),
        'notes': {
            'spine': f'{SPINE_NODE} is a UISpineHolder (recorded in prefabs[*].spine); M0 does not render it',
            'stencilCleaner': STENCIL_NODE,
            'cardRowTemplate': 'group_slots._viewPrefab -> theme shop/autochess_shop_card_item',
            'costView': 'group_upgrade._costPrefab -> battle shop/autochess_shop_cost_item',
        },
    }
    target = out / 'shop.json'
    target.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    log(f'  shop.json: {panel["nodeCount"]} + {shop["nodeCount"]} + {money["nodeCount"]} nodes, '
        f'{len(doc["assets"])} assets, {len(doc["unresolved"])} unresolved')
    return doc


def main():
    parser = argparse.ArgumentParser(description='Extract shop chrome prefabs into <theme>/shop.json')
    parser.add_argument('--themes', required=True, help='AB root holding the theme bundle and ui/autochess battle bundle')
    parser.add_argument('--theme', default='ac_s_closur')
    parser.add_argument('--out', required=True, help='theme pack directory (writes shop.json)')
    parser.add_argument('--battle', default=None, help='explicit [uc]autochessbattle.ab path')
    parser.add_argument('--game', default=None,
                        help='client AB root (…/StreamingAssets/AB/Windows) whose MonoScripts name the panel components')
    args = parser.parse_args()

    themes_root = Path(args.themes)
    out = Path(args.out)
    theme_bundle = next(iter(themes_root.glob(f'ui/autochess/autochessvariantskin/[[]uc]{args.theme}.ab')), None)
    if theme_bundle is None:
        raise SystemExit(f'theme bundle not under {themes_root}')
    battle_bundle = Path(args.battle) if args.battle else themes_root / 'ui/autochess/[uc]autochessbattle.ab'
    if not battle_bundle.exists():
        raise SystemExit(f'battle bundle not found: {battle_bundle}')
    scanned = [themes_root] + ([Path(args.game)] if args.game else [])
    index = unity_deps.index_bundles(scanned, cache=unity_deps.cache_path(REPO_ROOT), log=print)
    export_shop(theme_bundle, battle_bundle, out, theme=args.theme, index=index, log=print)


if __name__ == '__main__':
    main()
