"""Local official art for plugin references outside our roster (DESIGN §34.28).
The official client's sprite packs and defaultskin prefab supply the pictures and Front/Back models.
No downloads, plugin imports, skin packs or changes to gameplay data. Partial/missing installs keep fallbacks.
"""
import json
import re
import subprocess
from pathlib import Path

SUB = 'plugin-art'
CHAR = re.compile(r'^char_[0-9]+_[a-z0-9]+$')
# [ASSUMED] Defence in depth for the bounded table-backed JS discovery (artReferences.js).
MAX_OPERATORS = 256
PICTURES = {'avatar': ('spritepack/ui_char_avatar_*.ab', ''),
            'portrait': ('spritepack/char_portrait_*.ab', '_1')}


def references(root):
    reader = Path(__file__).with_name('plugin-art.mjs')
    # Fail visibly rather than silently turning a discovery failure into an empty successful extraction.
    return json.loads(subprocess.check_output(['node', str(reader), str(root)], timeout=30))


def plan(ids):
    """Bound table-backed discovery ids before planning base/E2 sprites and default battle models."""
    selected = sorted({cid for cid in ids if isinstance(cid, str) and CHAR.fullmatch(cid)})[:MAX_OPERATORS]
    return [{'id': cid, 'bundle': f'chararts/{cid}.ab', 'prefab': f'/{cid}/defaultskin.prefab',
             'pictures': {kind: {'bundles': glob, 'names': {kind: cid + suffix, kind + 'E2': cid + '_2'}}
                          for kind, (glob, suffix) in PICTURES.items()},
             'spines': {face: f'spine/char/{cid}/{face}' for face in ('front', 'back')}}
            for cid in selected]


def merge_chars(old, new):
    """[ASSUMED] Keep earlier successful slots when a partial game install cannot re-extract them."""
    out = dict(old or {})
    for cid, art in new.items():
        prev = out.get(cid) or {}
        out[cid] = {**prev, **art}
        if prev.get('spine') or art.get('spine'):
            out[cid]['spine'] = {**prev.get('spine', {}), **art.get('spine', {})}
    return dict(sorted(out.items()))


def export(ab_root, out_root, groups, log, ids):
    import aklz4  # noqa: F401 (the existing local-client decoder)
    import UnityPy
    from extract import prefab_spine_nodes, write_spine

    jobs, chars, count = plan(ids), {}, 0
    if not jobs:
        return chars, count
    for kind, (glob, _suffix) in PICTURES.items():
        wanted = {name: (job['id'], slot) for job in jobs for slot, name in job['pictures'][kind]['names'].items()}
        for bundle in sorted(Path(ab_root).glob(glob)):
            if not wanted:
                break
            try:
                env = UnityPy.load(str(bundle))
            except Exception as err:
                log(f'warn {bundle.name}: {err}')
                continue
            for obj in env.objects:
                try:
                    if obj.type.name != 'Sprite':
                        continue
                    sprite = obj.read()
                    if sprite.m_Name not in wanted:
                        continue
                    cid, slot = wanted[sprite.m_Name]
                    img = sprite.image
                    sub, name = f'char/{kind}/{cid}', sprite.m_Name
                    target = Path(out_root) / sub / (name + '.png')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    img.save(target)
                    url = f'/assets/local/{sub}/{name}.png'
                    groups.setdefault(sub, {})[name] = {'path': url, 'w': img.width, 'h': img.height, 'kind': 'Sprite'}
                    chars.setdefault(cid, {})[slot] = url
                    del wanted[name]
                    count += 1
                    log(f'{bundle.name}: {name} -> {sub}/{name}.png')
                except Exception as err:
                    # One unreadable sprite must not hide later valid sprites in this bundle.
                    log(f'warn {bundle.name} sprite: {err}')
        for name in sorted(wanted):
            log(f'skip (not found) {kind} {name}')
    for job in jobs:
        cid, bundle = job['id'], Path(ab_root) / job['bundle']
        if not bundle.is_file():
            log(f'skip (not found) {job["bundle"]}')
            continue
        try:
            env = UnityPy.load(str(bundle))
            objects = {o.path_id: o for o in env.objects}
            ref = next((v for k, v in env.container.items() if k.endswith(job['prefab'])), None)
            nodes = prefab_spine_nodes(ref.read_typetree(), objects) if ref else []
            for face, sub in job['spines'].items():
                node = next((n for n in nodes if n[0].lower() == face), None)
                sda = objects.get(node[2]['m_PathID']) if node and not node[2].get('m_FileID') else None
                if sda is None:
                    log(f'skip (not found) {cid} {face}')
                    continue
                n = write_spine(objects, sda.read_typetree(), sub, cid, out_root, groups, log)
                if not n:
                    continue
                count += n
                files = groups[sub]
                skel = next(k for k in files if k.endswith('.skel'))
                reader = Path(__file__).with_name('plugin-art.mjs')
                meta = json.loads(subprocess.check_output(['node', str(reader), '--spine', str(Path(out_root) / sub / skel)], timeout=30))
                chars.setdefault(cid, {}).setdefault('spine', {})[face] = {
                    **meta, 'skel': files[skel]['path'], 'atlas': files[skel[:-5] + '.atlas']['path'],
                    'textures': [files[k]['path'] for k in sorted(files) if k.endswith('.png')]}
                log(f'{job["bundle"]}: {face} -> {sub} ({n} files)')
        except Exception as err:
            log(f'warn {cid}: {err}')
    return chars, count
