"""Read a Windows client's active hot update over its packaged bundles, without modifying either tree."""
import json
import os
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path, PurePosixPath


def resource_index(path):
    doc = json.loads(path.read_text(encoding='utf-8'))
    records = {}
    for rec in doc['abInfos']:
        name = rec['name']
        rel = PurePosixPath(name)
        if rel.is_absolute() or '..' in rel.parts or '\\' in name or ':' in name:
            raise ValueError(f'unsafe bundle path: {name}')
        records[name] = rec
    return doc, records


@contextmanager
def client_bundles(base, log=print):
    """The active indexes, not mtimes, select downloaded replacements. Missing updates never use stale base art.

    A temporary linked tree lets every existing job (including multiprocessing FX dependency scans) see one root.
    PlayCover, archived bundles and base-only installs retain their original paths.
    """
    base = Path(base).resolve()
    if base.parts[-3:] != ('StreamingAssets', 'AB', 'Windows'):
        yield base
        return
    hot = base.parents[2] / 'PersistentData' / 'Bundles'
    if not (hot / 'hot_update_list.json').is_file() or not (hot / 'persistent_res_list.json').is_file():
        yield base
        return
    current, active = resource_index(hot / 'hot_update_list.json')
    packaged, original = resource_index(base / 'hot_update_list.json')
    downloaded, installed = resource_index(hot / 'persistent_res_list.json')
    # The client's timestamp-prefixed version ids order releases; an old download cache cannot override a new base.
    if current['versionId'][:17] < packaged['versionId'][:17]:
        yield base
        return
    if (downloaded.get('manifestName'), downloaded.get('manifestVersion')) != (
            current.get('manifestName'), current.get('manifestVersion')):
        raise ValueError('hot update and installed resource indexes disagree')
    selected, updated, missing = {}, 0, 0
    for name, rec in active.items():
        src = None
        if installed.get(name, {}).get('hash') == rec['hash'] and (hot / name).is_file():
            src = hot / name
            updated += 1
        elif original.get(name, {}).get('hash') == rec['hash'] and (base / name).is_file():
            src = base / name
        if src is not None:
            selected[name] = src
        else:
            missing += 1
    selected['hot_update_list.json'] = hot / 'hot_update_list.json'
    log(f'client bundles: {packaged["versionId"]} + {current["versionId"]}; '
        f'{updated} downloaded, {len(selected) - 1 - updated} packaged, {missing} unavailable')
    with tempfile.TemporaryDirectory(prefix='sp-client-bundles-') as tmp:
        root = Path(tmp) / 'Windows'
        root.mkdir()
        for name, src in selected.items():
            dst = root / name
            dst.parent.mkdir(parents=True, exist_ok=True)
            try:
                dst.symlink_to(src)
            except OSError:  # Windows may disallow symlinks; a hard link or temporary copy is read identically.
                try:
                    os.link(src, dst)
                except OSError:
                    shutil.copy2(src, dst)
        yield root
