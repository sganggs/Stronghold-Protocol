"""规程·序列Ⅰ's opening for the title screen (public/js/ui/regulationFilm.js, DESIGN §37.147).

When a player enters the 规程 season, the client plays its season screen's entry: the activity bundle
activity/[uc]act3autochess.ab, prefab panel_act3autochess_on_entry, legacy clip autochess_entry_season_on (3.17 s on the
panel: a black cover lifts, a red "loading" screen with ID cards, a map and a percent counter, the season emblem between
expanding rings, then the season ground zooms in under the title art) and the PlayAutomatically loop
autochess_season_on_entry_loop on entry_anim_season_on (the cards' flicker while that layer shows).

The export: ui/season/act3autochess/entry/prefabs.json (the prefabs.json format of the theme packs, spPrefabs 1: the
panel's node tree, those two clips, the effect textures) with the sprites it draws under sprites/. The activity's own
controls (achievements, guide, missions, team info, operator pool, mode choice, invite, milestone, themes) are left
out: the title screen keeps its own login box. Particle holders stay in the tree undrawn (fx), as in the theme packs.
"""

import json
from pathlib import Path

import autochess_themes as at
import ui_components as uic

SUB = 'ui/season/act3autochess/entry'
BUNDLE = 'activity/[uc]act3autochess.ab'
PREFAB = 'panel_act3autochess_on_entry'
CLIPS = ('autochess_entry_season_on', 'autochess_season_on_entry_loop')
# the season screen's controls, not part of the opening (the clip's curves on them resolve to nothing)
DROP = ('canvas_center', 'bottom_view', 'top_menu', 'non_drawing_graphic')
FORMAT = 1


def prune(node, drop=DROP):
    """The tree without the named nodes (anywhere below the root). Returns the same dict."""
    kids = node.get('children') or []
    keep = [child for child in kids if child.get('name') not in drop]
    for child in keep:
        prune(child, drop)
    if kids:
        node['children'] = keep
    return node


def sprite_refs(node, out=None):
    """{sprite name: {(w, h), …}} of the Images under node."""
    out = {} if out is None else out
    image = node.get('image')
    if isinstance(image, dict) and image.get('sprite'):
        out.setdefault(image['sprite'], set()).add((image.get('w'), image.get('h')))
    for child in node.get('children') or []:
        sprite_refs(child, out)
    return out


def texture_refs(node, out=None):
    """Names of the textures the Images' effect materials sample (base, mask, addition map, sheet)."""
    out = set() if out is None else out
    material = (node.get('image') or {}).get('material') or {}
    for key in ('base', 'mask', 'add'):
        if material.get(key):
            out.add(material[key])
    if (material.get('sheet') or {}).get('tex'):
        out.add(material['sheet']['tex'])
    for child in node.get('children') or []:
        texture_refs(child, out)
    return out


def _export_sprites(env, wanted, dest_dir):
    """The wanted Sprites → dest_dir/<name>.webp (a same-name sprite gets _2 …). Returns an autochess_themes.SpriteBook."""
    book = at.SpriteBook()
    used = set()
    for obj in env.objects:
        if obj.type.name != 'Sprite':
            continue
        try:
            sprite = obj.read()
        except Exception:
            continue
        if sprite.m_Name not in wanted:
            continue
        try:
            image = at._sprite_raster(sprite)
        except Exception:
            continue
        if image is None:
            continue
        stem = at.safe_stem(sprite.m_Name)
        name, number = stem, 2
        while name.lower() in used:
            name, number = f'{stem}_{number}', number + 1
        used.add(name.lower())
        written = at._save_raster(image, dest_dir / f'{name}.webp')
        border = getattr(sprite, 'm_Border', None)
        rect = getattr(sprite, 'm_Rect', None)
        book.add({
            'name': sprite.m_Name,
            'file': f'sprites/{written}',
            'slice': at.border_slice((border.x, border.y, border.z, border.w)) if border is not None else None,
            'w': at.num(rect.width) if rect is not None else None,
            'h': at.num(rect.height) if rect is not None else None,
        })
    return book


def _export_textures(env, wanted, dest_dir):
    """The wanted Texture2Ds → dest_dir/tex_<name>.webp. Returns name → {file, w, h}."""
    out = {}
    for obj in env.objects:
        if obj.type.name != 'Texture2D':
            continue
        try:
            data = obj.read()
        except Exception:
            continue
        name = getattr(data, 'm_Name', None)
        if name not in wanted or name in out:
            continue
        try:
            image = data.image
        except Exception:
            image = None
        if image is None:
            continue
        written = at._save_raster(image, dest_dir / f'tex_{at.safe_stem(name)}.webp')
        out[name] = {'file': f'sprites/{written}', 'w': image.size[0], 'h': image.size[1]}
    return out


def build(env, objects, dest, version):
    """Write dest/prefabs.json and dest/sprites/*. Returns (doc, files: [(rel, extra)]) or (None, reason)."""
    hits = at.index_prefabs(env, objects).get(PREFAB.lower()) or []
    if not hits:
        return None, f'no prefab {PREFAB}'
    tree = at.walk_gameobject(hits[0][1], objects)
    if not tree:
        return None, f'{PREFAB} is empty'
    prune(tree)
    sprites_dir = dest / 'sprites'
    sprites_dir.mkdir(parents=True, exist_ok=True)
    book = _export_sprites(env, set(sprite_refs(tree)), sprites_dir)
    at._image_files(tree, book)
    textures = _export_textures(env, texture_refs(tree), sprites_dir)
    clips = {}
    for obj in env.objects:
        if obj.type.name != 'AnimationClip':
            continue
        try:
            clip_tree = obj.read_typetree()
        except Exception:
            continue
        name = clip_tree.get('m_Name')
        if name in CLIPS:
            info = uic.clip_info(clip_tree)
            if info:
                clips[name] = info
    missing = [name for name in CLIPS if name not in clips]
    if missing:
        return None, f'clips missing: {", ".join(missing)}'
    doc = {'spPrefabs': 1, 'id': 'act3autochess', 'entry': FORMAT, 'version': version, 'fonts': [],
           'clips': clips, 'textures': textures, 'prefabs': {PREFAB: tree}}
    (dest / 'prefabs.json').write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    files = [('prefabs.json', {'kind': 'TextAsset'})]
    for hits_ in book.by_name.values():
        for info in hits_:
            files.append((info['file'], {'kind': 'Sprite', 'w': info.get('w'), 'h': info.get('h')}))
    for rec in textures.values():
        files.append((rec['file'], {'kind': 'Texture2D', 'w': rec.get('w'), 'h': rec.get('h')}))
    return doc, files


def export(ab_root, out_root, manifest, log, repo_root):
    """The opening's files under out_root/SUB, listed in manifest[SUB]. Returns the file count."""
    src = Path(ab_root) / BUNDLE
    if not src.exists():
        log(f'skip (missing) {BUNDLE} for {SUB}')
        return 0
    try:
        env, objects = at._load_env(src)
    except Exception as err:
        log(f'FAIL load {BUNDLE}: {err}')
        return 0
    dest = Path(out_root) / SUB
    dest.mkdir(parents=True, exist_ok=True)
    doc, files = build(env, objects, dest, at.client_data_version(repo_root))
    if doc is None:
        log(f'FAIL {SUB}: {files}')
        return 0
    for rel, extra in files:
        at._list_file(manifest, SUB, rel, **extra)
    size = sum((dest / rel).stat().st_size for rel, _ in files if (dest / rel).exists())
    log(f'{SUB}: {len(files)} files, {size // 1024} KiB, clips {", ".join(sorted(doc["clips"]))}')
    return len(files)


if __name__ == '__main__':  # a look at the pruned tree: python3 season_entry.py <bundle>
    import sys
    env_, objects_ = at._load_env(sys.argv[1])
    hits_ = at.index_prefabs(env_, objects_).get(PREFAB.lower()) or []
    tree_ = prune(at.walk_gameobject(hits_[0][1], objects_)) if hits_ else {}
    print(json.dumps({'sprites': sorted(sprite_refs(tree_)), 'textures': sorted(texture_refs(tree_))}, ensure_ascii=False))
