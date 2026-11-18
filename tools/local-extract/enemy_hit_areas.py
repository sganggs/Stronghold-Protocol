#!/usr/bin/env python3
"""Audit every shipped Boss prefab's root hit collider against a locally installed official client.

Run with the UnityPy environment used by extract.py:
  python tools/local-extract/enemy_hit_areas.py --out <snapshot.json> [--game <install or AB root>]
Reads one bundle at a time, including active Windows hot updates; never writes game files or generated data.
Skill selectors and ColliderHolder blocking colliders are deliberately excluded from the root hit body.
"""
import argparse
import gc
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bundles import client_bundles  # noqa: E402
from extract import ROOT, locate_client  # noqa: E402


def boss_records():
    prefabs = {}
    files = [ROOT / 'data/enemies.json', *sorted((ROOT / 'data/versions').glob('*/enemies.json'))]
    for file in files:
        for key, enemy in json.loads(file.read_text(encoding='utf-8')).items():
            if enemy.get('rank') != 'BOSS':
                continue
            prefab = enemy.get('spine') or key
            row = prefabs.setdefault(prefab, {'enemies': set(), 'names': set(), 'dataFiles': set()})
            row['enemies'].add(key)
            row['names'].add(enemy['name'])
            row['dataFiles'].add(str(file.relative_to(ROOT)))
    return {key: {k: sorted(v) for k, v in row.items()} for key, row in sorted(prefabs.items())}


def probe(ab_root, records):
    import aklz4  # noqa: F401 (register the client's LZ4 decoder before loading Unity bundles)
    import UnityPy

    rows = []
    missing = set(records)
    for bundle in sorted((ab_root / 'battle').glob('enm_pfb*.ab')):
        env = UnityPy.load(str(bundle))
        digest = None
        for key, ptr in env.container.items():
            prefab = key.rsplit('/', 1)[-1]
            if prefab.endswith('.prefab'):
                prefab = prefab[:-len('.prefab')]
            if prefab not in missing:
                continue
            ref = ptr.deref()
            objects = ref.assets_file.objects
            root = ref.read_typetree()
            colliders = []
            transform = None
            for component in root['m_Component']:
                obj = objects.get(component['component']['m_PathID'])
                if obj is None:
                    continue
                if obj.type.name == 'Transform':
                    tree = obj.read_typetree()
                    transform = {k: tree[k] for k in ['m_LocalPosition', 'm_LocalScale', 'm_LocalRotation']}
                elif 'Collider' in obj.type.name:
                    tree = obj.read_typetree()
                    colliders.append({'pathId': obj.path_id, 'type': obj.type.name,
                                      **{k: tree[k] for k in ['m_Enabled', 'm_IsTrigger', 'm_Offset',
                                                              'm_Size', 'm_Radius'] if k in tree}})
            if root['m_Layer'] != 9 or len(colliders) != 1 or not colliders[0]['m_Enabled']:
                raise ValueError(f'{prefab}: unexpected root collider layout; inspect manually')
            collider = colliders[0]
            if (not collider['m_IsTrigger'] or transform['m_LocalScale'] != {'x': 1, 'y': 1, 'z': 1}
                    or transform['m_LocalRotation'] != {'x': 0, 'y': 0, 'z': 0, 'w': 1}):
                raise ValueError(f'{prefab}: unexpected hit body transform; inspect manually')
            if collider['type'] == 'BoxCollider2D':
                size, offset = collider['m_Size'], collider['m_Offset']
                hit_area = {k: round(v, 5) for k, v in {
                    'w': size['x'], 'h': size['y'], 'dx': offset['x'], 'dy': offset['y']}.items()}
            elif collider['type'] == 'CircleCollider2D' and abs(collider['m_Radius'] - 0.1) < 1e-6:
                if collider['m_Offset'] != {'x': 0, 'y': 0}:
                    raise ValueError(f'{prefab}: offset circle needs manual review')
                hit_area = None
            else:
                raise ValueError(f'{prefab}: unsupported root collider; inspect manually')
            if digest is None:
                with bundle.open('rb') as stream:
                    hasher = hashlib.sha256()
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        hasher.update(chunk)
                    digest = hasher.hexdigest()
            rows.append({'prefab': prefab, **records[prefab], 'bundle': str(bundle.relative_to(ab_root)),
                         'bundleSha256': digest, 'rootPathId': ref.path_id, 'layer': root['m_Layer'],
                         'transform': transform, 'collider': collider, 'hitArea': hit_area})
            missing.remove(prefab)
            print(f'{prefab}: {hit_area}', file=sys.stderr, flush=True)
        del env
        gc.collect()
        if not missing:
            break
    if missing:
        raise ValueError(f'Boss prefabs unavailable in active client: {sorted(missing)}')
    version = json.loads((ab_root / 'hot_update_list.json').read_text(encoding='utf-8'))['versionId']
    return {'clientVersion': version, 'scope': 'root hit colliders of all shipped rank=BOSS records',
            'prefabs': sorted(rows, key=lambda row: row['prefab'])}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--game')
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    base = locate_client(args.game)
    if not base:
        raise SystemExit('No official client found; pass --game')
    with client_bundles(base, log=lambda msg: print(msg, file=sys.stderr)) as root:
        result = probe(root, boss_records())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
