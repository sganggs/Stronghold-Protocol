"""The official 规程 in-match shop card as one data file: `themes/<id>/card.json`.

`prefabs.json` already carries every prefab's tree for the HUD pass, but a card face needs more than a tree: the
materials' shader parameters, the animation clips' channels (including the material texture offset), the particle
systems, and the fact that some Images take their sprite from the theme at runtime. This module builds that one
document per theme, from the same bundle the theme packs come from:

    card.json
      root, materials, clips, particles      the `shop/autochess_shop_card_item` prefab
      sub.<name>                             chess_level_5_obj / _6, frame_lv1_obj … _lv3_obj

Every file path is relative to the theme group (`themes/<id>/`), so the client's URL is
`/assets/local/themes/<id>/<path>`; the document repeats the group as `group`.

Two things only a cross-file read can fill, and `unity_deps.py` supplies them: a sprite or a texture that lives in
another bundle (the effect atlas, another theme), and the MonoScript class names (one CAB away from every prefab).
Without that index the same document is still written, with `unresolved` listing what could not be named.

Node shape: a PNode, exactly as `prefabs.json` writes it (rect / scale / image / raw / text / mask / layout / fit /
element / status / tweens / scripts / fx / clips / children), plus `depth` and `path` (the GameObject path from the
prefab root, the same form a clip's curve paths use below the node that owns the Animation component). `image.sprite`
is the Sprite's name, `image.file` its exported picture, `image.mat` the key into `materials`.
"""
import json
import math
import re
from pathlib import Path

import autochess_themes as themes
import card_shader
import ui_components as uic

CARD_PREFAB = 'prefabs/shop/autochess_shop_card_item.prefab'
# The card draws its frame and tier plate from these prefabs; 可露希尔's level-five/six frames carry their own TV and
# footer, which is why the card itself has no such node.
SUB_PREFABS = (
    ('frame_lv1_obj', 'prefabs/shop/frame_lv1_obj.prefab'),
    ('frame_lv2_obj', 'prefabs/shop/frame_lv2_obj.prefab'),
    ('frame_lv3_obj', 'prefabs/shop/frame_lv3_obj.prefab'),
    ('chess_level_5_obj', 'prefabs/shop/chess_level_5_obj.prefab'),
    ('chess_level_6_obj', 'prefabs/shop/chess_level_6_obj.prefab'),
)
# Prefabs the card instantiates from another bundle (card.json `sub` key, the `prefabRefs` field it comes from, the
# document key, the prefab path): the controller's cost view and the bond list's row template (CONTENT-SPEC §4.4/§5.4).
SUB_PREFAB_DOCS = (
    ('cost_view', 'costView', 'AutoChessBattleShopCostView', 'shop/autochess_shop_cost'),
    ('bond_item', 'bondItem', 'AutoChessBattleShopBondView', 'shop/autochess_shop_bond'),
)
SP_CARD = 1
# What fills a sprite-less Image, by the controller field that assigns it. `source` names the supplier:
# theme-slot (a theme.json image slot), game-art (operator / item / profession art this client draws itself),
# material (the picture is the node's own material), flat (a colour over the node rect).
RUNTIME_SOURCE = {
    '_imgFrame': ('theme-slot', ['chess_frame_normal', 'chess_frame_level_five', 'chess_frame_level_six']),
    '_imgTier': ('theme-slot', ['chess_level_icon_1', 'chess_level_icon_2', 'chess_level_icon_3',
                                'chess_level_icon_4', 'chess_level_icon_5', 'chess_level_icon_6']),
    '_equipIcon': ('game-art', []),
    '_profIcon': ('game-art', []),
    '_garrisonIcon': ('game-art', []),
    '_charIcon': ('game-art', []),
    '_diffTag': ('game-art', []),
    '_imgDeco': ('flat', []),
}
# The same, by node name, when no controller field points at the node.
RUNTIME_BY_NAME = {
    'frame': RUNTIME_SOURCE['_imgFrame'],
    'img_chess_level': RUNTIME_SOURCE['_imgTier'],
    'equip': RUNTIME_SOURCE['_equipIcon'],
    'prof_icon': RUNTIME_SOURCE['_profIcon'],
    'garrison_icon': RUNTIME_SOURCE['_garrisonIcon'],
    'char_portrait': ('game-art', []),
    'doublecheck_mid_bg': ('flat', []),
    'able_matte': ('material', []),
    'smoke': ('material', []),
    'bkg': ('game-art', []),
}
TEX_PROPERTY = re.compile(r'^_textureProperty\d*\.offset\.([xy])$')
EXTERNAL_SPRITE_PREFIX = 'sprites/ext_'
TEXTURE_PREFIX = 'sprites/tex_'
# The card's portrait mask: `root_char`'s SoftMask samples the shared `mask_char` sprite, which lives in
# `[uc]ac_n_initial.ab` (another theme's bundle) rather than this theme's. The theme pack stores that 155×187 picture
# under the name the reference page already draws (`sprites/mask_char_portrait.png`), so the document points at the
# pack file instead of adding an `ext_` copy of the same bytes. A sprite not listed here is exported the usual way.
SOFT_MASK_PICTURES = {'mask_char': 'sprites/mask_char_portrait.png'}
# A sub-prefab walked from its own bundle (the shop's cost view and bond row resolve their Images against that bundle)
# puts its sprites in the theme's own namespace — `sprites/cost_bg_1.webp` (CONTENT-SPEC §4.4-C) — instead of the
# `ext_` prefix a single foreign sprite gets.
SUB_SPRITE_PREFIX = 'sprites/'
# Serialized component fields that name a prefab in another bundle, and the `sub` entry each one produces: the
# controller's `_costPrefab` and the bond list's `SimpleLayoutContent._viewPrefab`.
SUB_PREFAB_REFS = {'_costPrefab': 'costView', '_viewPrefab': 'bondItem'}


def _round(value, digits=4):
    """Whole numbers stay ints, so the document does not write 1.0 for a count.

    A serialized float can be ±inf / NaN (a tween duration the component never initialised, resolved only once the
    script bundle is indexed); keep it as `None` so the document stays JSON-clean and a reader sees "unset".
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    if not math.isfinite(float(value)):
        return None
    out = round(float(value), digits)
    return int(out) if out == int(out) else out


def _color(value):
    """[r, g, b, a] as stored."""
    if not isinstance(value, dict):
        return None
    return [_round(value.get(key, 0)) for key in ('r', 'g', 'b', 'a')]


def _pointer(pointer, ctx):
    """A typetree PPtr → a UnityPy PPtr bound to this bundle, or None when it points nowhere."""
    file_id, path_id = themes._pptr(pointer)
    if not path_id:
        return None
    from UnityPy.classes import PPtr
    return PPtr(m_FileID=file_id, m_PathID=path_id, assetsfile=ctx['serialized'])


def _cab_of(pointer, ctx):
    """The CAB a foreign pointer names (the file name truth), or None for this bundle."""
    if pointer is None or not pointer.m_FileID:
        return None
    externals = getattr(ctx['serialized'], 'externals', None) or []
    index = pointer.m_FileID - 1
    if 0 <= index < len(externals):
        return str(externals[index].path).rstrip('/').rsplit('/', 1)[-1]
    return f'external#{pointer.m_FileID}'


def _deref(pointer, ctx):
    """The object a pointer names, across bundle boundaries; None (recorded) when it cannot be reached."""
    p = _pointer(pointer, ctx)
    if p is None:
        return None
    try:
        return p.deref()
    except Exception as err:  # noqa: BLE001  an unresolved external is reported, not raised
        entry = {'fileId': p.m_FileID, 'pathId': p.m_PathID, 'cab': _cab_of(p, ctx), 'reason': str(err)}
        if entry not in ctx['unresolved']:
            ctx['unresolved'].append(entry)
        return None


def _typetree(obj):
    try:
        return obj.read_typetree()
    except Exception:  # noqa: BLE001
        return None


def _name_of(ctx):
    """ui_components' name_of hook: an object's name, resolved across files."""
    def resolve(pointer):
        obj = _deref(pointer, ctx)
        return (_typetree(obj) or {}).get('m_Name') if obj is not None else None

    return resolve


def _texture_sampling(sprite_object, ctx):
    """The sampler state of the Texture2D a Sprite draws, read without recording an `unresolved` entry.

    The sprite's `m_RD.texture` pointer is relative to the sprite's own file, which is not the theme bundle when
    the sprite is external (`spriteExternal`), so the pointer is bound to that file.

    Sampling is optional data: a picture whose atlas cannot be reached leaves the five keys None rather than
    adding a pointer the document never had to its `unresolved` list.
    """
    tree = _typetree(sprite_object) or {}
    file_id, path_id = themes._pptr((tree.get('m_RD') or {}).get('texture'))
    if not path_id:
        return dict.fromkeys(themes.SAMPLING_KEYS)
    from UnityPy.classes import PPtr
    serialized = getattr(sprite_object, 'assets_file', None) or ctx['serialized']
    try:
        obj = PPtr(m_FileID=file_id, m_PathID=path_id, assetsfile=serialized).deref()
    except Exception:  # noqa: BLE001  an unreachable atlas leaves the fields unset
        return dict.fromkeys(themes.SAMPLING_KEYS)
    return themes.texture_sampling(obj)


def _sprite(pointer, ctx, export=True):
    """A Sprite pointer → {name, w, h, slice, file, external, wrapU, wrapV, filter, texW, texH}; None when it
    names no Sprite.

    `w`/`h` are the sprite's `m_Rect` (the visible crop); `texW`/`texH` are the atlas texture's own size.
    `export=False` stops at the name and the pack's own file: a caller that resolves the picture another way (a
    SoftMask, SOFT_MASK_PICTURES) must not leave a second copy of it in the pack.
    """
    if not pointer:
        return None
    p = _pointer(pointer, ctx)
    sprite_object = _deref(pointer, ctx)
    if sprite_object is None or sprite_object.type.name != 'Sprite':
        return None
    try:
        sprite = sprite_object.read()
    except Exception:  # noqa: BLE001
        return None
    name = getattr(sprite, 'm_Name', None)
    if not name:
        return None
    rect = getattr(sprite, 'm_Rect', None)
    border = getattr(sprite, 'm_Border', None)
    width = _round(rect.width) if rect is not None else None
    height = _round(rect.height) if rect is not None else None
    out = {'name': name, 'w': width, 'h': height}
    out.update(_texture_sampling(sprite_object, ctx))
    sliced = themes.border_slice((border.x, border.y, border.z, border.w)) if border is not None else None
    if sliced:
        out['slice'] = sliced
    info = ctx['book'].resolve(name, (width, height)) if ctx['book'] is not None else None
    if info and info.get('file'):
        out['file'] = info['file']
    elif export and (p.m_FileID or ctx.get('export_local_sprites')):
        # a foreign pointer, or a sub-prefab's own bundle: the theme pack should carry the picture
        rel = _export_sprite(sprite_object, name, ctx)
        if rel:
            out['file'] = rel
    if out.get('file'):
        ctx['files'].add(out['file'])
    if p.m_FileID:
        out['external'] = True
        out['cab'] = _cab_of(p, ctx)
    return out


def _sprite_key(sprite_object, name):
    """The exported-picture cache key of a sprite: its name is not unique (an atlas repeats names), its path id is."""
    path_id = getattr(sprite_object, 'path_id', None)
    return name, path_id if path_id is not None else id(sprite_object)


def _same_raster(image, path):
    """Whether `path` already holds exactly this picture, pixel for pixel.

    A client hot-update changes a picture without changing its name, so an output root from an earlier run used to
    keep the old bytes when the producer only checked that the file existed. Decoding the file is format-agnostic
    (the writer uses lossless WebP, or PNG when WebP fails); an unreadable or other-sized file counts as different,
    and a same-sized file is compared after converting to the extracted image's mode.

    The comparison is the decoded bytes of every band: a channel box from `getbbox()` would look only at the
    premultiplied difference (an opaque WebP is read back as RGB and the alpha band of the diff is 0), and a
    colour-only change would compare equal.
    """
    try:
        from PIL import Image
        with Image.open(path) as old:
            old.load()
            if old.size != image.size:
                return False
            same = old if old.mode == image.mode else old.convert(image.mode)
            return same.tobytes() == image.tobytes()
    except Exception:  # noqa: BLE001
        return False


def _existing_picture(dest, image):
    """The file under `dest` — or its `.png` sibling — that already holds `image`, else None.

    The sibling is the writer's fallback (`_save_raster` writes PNG where Pillow has no WebP): comparing only the
    `.webp` name would rewrite that PNG on every re-run of the same client.
    """
    for path in (dest, dest.with_suffix('.png')):
        if path.exists() and _same_raster(image, path):
            return path
    return None


def _export_sprite(sprite_object, name, ctx):
    """Write a sprite that lives in another bundle into this theme's sprites/, under a name of its own.

    The name is derived from the sprite's, so a second run reuses the file it wrote before instead of adding a numbered
    copy; the cache is keyed by the sprite's own path id, so a second *different* sprite of the same name gets the next
    number instead of silently showing the first one's picture.
    """
    key = _sprite_key(sprite_object, name)
    if key in ctx['ext_sprites']:
        return ctx['ext_sprites'][key]
    try:
        image = themes._sprite_raster(sprite_object.read())
    except Exception:  # noqa: BLE001
        image = None
    if image is None:
        ctx['ext_sprites'][key] = None
        return None
    stem = themes.safe_stem(name)
    prefix = ctx.get('sprite_prefix') or EXTERNAL_SPRITE_PREFIX
    rel = f'{prefix}{stem}.webp'
    number = 2
    while rel in ctx['ext_used']:
        rel = f'{prefix}{stem}_{number}.webp'
        number += 1
    dest = Path(ctx['dest']) / rel
    # Compare, not `exists`: a client hot-update keeps the name and changes the pixels, so a second run must
    # rewrite a changed picture while an unchanged one keeps its file (and its mtime).
    kept = _existing_picture(dest, image)
    if kept is None:
        written = themes._save_raster(image, dest)
        # `_save_raster` returns the file name it wrote (the prefix's stem included); every prefix lives under sprites/
        rel = f'sprites/{written}'
    else:
        # A PNG left by the writer's fallback: the record must name the file that exists.
        rel = f'sprites/{kept.name}'
    ctx['ext_used'].add(rel)
    ctx['files'].add(rel)
    ctx['ext_sprites'][key] = rel
    return rel


def _soft_mask(fields, ctx):
    """A SoftMask component's data form: the mask picture and the channel weights the shader mixes.

    `buildRecords` collects this as `mask.soft` and samples the picture's R/G/B/A through `weights` for the node's
    whole subtree, so a real SoftMask has to reach the document or the renderer falls back to a solid quad. A component
    whose picture cannot be resolved emits nothing at all.
    """
    file = _soft_mask_file(fields, ctx)
    if not file:
        return None
    weights = fields.get('_channelWeights') or {}
    return {'file': file, 'weights': {key: _round(weights.get(key, 0)) for key in ('r', 'g', 'b', 'a')}}


def _soft_mask_file(fields, ctx):
    """The pack file a SoftMask samples, from its `_sprite` (else `_texture`) pointer.

    The mask sprite may live in another bundle, and the pack may already store it under a name of its own
    (SOFT_MASK_PICTURES); both are resolved to the file the document names.
    """
    if (themes._pptr(fields.get('_sprite')) or (0, 0))[1]:
        sprite = _sprite(fields.get('_sprite'), ctx, export=False)
        if sprite and sprite.get('file'):
            return sprite['file']
        if sprite:
            rel = SOFT_MASK_PICTURES.get(sprite['name'])
            if rel:
                return _mask_picture(fields.get('_sprite'), rel, ctx)
            return (_sprite(fields.get('_sprite'), ctx) or {}).get('file')
    texture = _texture(fields.get('_texture'), ctx)
    return texture.get('file') if texture else None


def _mask_picture(pointer, rel, ctx):
    """The pack file of a SoftMask picture: written from the sprite under `rel` when the pack does not carry it yet."""
    if not (Path(ctx['dest']) / rel).exists():
        sprite_object = _deref(pointer, ctx)
        try:
            image = themes._sprite_raster(sprite_object.read()) if sprite_object is not None else None
        except Exception:  # noqa: BLE001
            image = None
        if image is None:
            return (_sprite(pointer, ctx) or {}).get('file')
        path = Path(ctx['dest']) / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        image.convert('RGBA').save(path, 'PNG')
    ctx['files'].add(rel)
    return rel


def _texture(pointer, ctx):
    """A Texture2D pointer → {texture, w, h, file, wrapU, wrapV, filter, texW, texH}; None when it names no
    texture (an empty `_MainTex`).

    `w`/`h` stay the texture's own size (`m_Width`/`m_Height`) as before; `texW`/`texH` repeat it so a reader
    can tell a texture record from a sprite record, whose `w`/`h` are the sprite rect.
    """
    if not pointer:
        return None
    texture_object = _deref(pointer, ctx)
    if texture_object is None or texture_object.type.name != 'Texture2D':
        return None
    try:
        texture = texture_object.read()
    except Exception:  # noqa: BLE001
        return None
    name = getattr(texture, 'm_Name', None)
    if not name:
        return None
    out = {
        'texture': name,
        'w': _round(getattr(texture, 'm_Width', None)),
        'h': _round(getattr(texture, 'm_Height', None)),
        'file': _texture_file(texture_object, name, ctx),
    }
    out.update(themes.texture_sampling(texture_object))
    return out


def _texture_file(texture_object, name, ctx):
    """An exported picture of a texture: a sprite of the same name, else sprites/tex_<name>.webp.

    Keyed by the texture's own path id: a different texture of the same name gets the next number instead of the
    first one's file (the same rule as `_export_sprite`).
    """
    info = ctx['book'].resolve(name) if ctx['book'] is not None else None
    if info and info.get('file'):
        ctx['files'].add(info['file'])
        return info['file']
    key = _sprite_key(texture_object, name)
    if key in ctx['tex_files']:
        return ctx['tex_files'][key]
    stem = themes.safe_stem(name)
    rel = f'{TEXTURE_PREFIX}{stem}.webp'
    used = ctx.setdefault('tex_used', set())
    number = 2
    while rel in used:
        rel = f'{TEXTURE_PREFIX}{stem}_{number}.webp'
        number += 1
    used.add(rel)
    try:
        image = texture_object.read().image
    except Exception:  # noqa: BLE001
        image = None
    if image is None:
        ctx['tex_files'][key] = None
        return None
    dest = Path(ctx['dest']) / rel
    # The same compare as `_export_sprite`: an existing `tex_*` file (either format) must not hide a hot-updated
    # texture.
    kept = _existing_picture(dest, image)
    if kept is None:
        written = themes._save_raster(image, dest)
        rel = f'sprites/{written}'
    else:
        rel = f'sprites/{kept.name}'
    ctx['files'].add(rel)
    ctx['tex_files'][key] = rel
    return rel


def _script_class(pointer, ctx):
    """The MonoScript behind a component's `m_Script`: {class, namespace, assembly}, cached by script path id.

    The class names live in the script bundle, one CAB away from every prefab; without the index the node keeps its
    script id and no name.
    """
    p = _pointer(pointer, ctx)
    if p is None:
        return None
    key = str(p.m_PathID)
    if key in ctx['scripts']:
        return key
    record = None
    obj = _deref(pointer, ctx)
    if obj is not None:
        try:
            mono = obj.read()
            name = getattr(mono, 'm_ClassName', None)
            if name:
                record = {'class': name}
                for field, source in (('namespace', 'm_Namespace'), ('assembly', 'm_AssemblyName')):
                    value = getattr(mono, source, None)
                    if value:
                        record[field] = value
        except Exception:  # noqa: BLE001
            record = None
    ctx['scripts'][key] = record
    return key


def _shader(pointer, ctx):
    """(name, cab) of a shader. The name is inside m_ParsedForm, which this build exposes through read().

    The resolved Shader object is kept in `ctx['shader_objects']` so the document can carry one full record per
    shader (never one per material).
    """
    if not pointer:
        return None, None
    p = _pointer(pointer, ctx)
    obj = _deref(pointer, ctx)
    cab = _cab_of(p, ctx) if p is not None else None
    if obj is None:
        return None, cab
    name = None
    try:
        form = getattr(obj.read(), 'm_ParsedForm', None)
        name = getattr(form, 'm_Name', None) if form is not None else None
    except Exception:  # noqa: BLE001
        name = None
    if not name:
        name = ((_typetree(obj) or {}).get('m_ParsedForm') or {}).get('m_Name') or None
    if name:
        ctx['shader_objects'].setdefault(name, (obj, cab))
    return name, cab


def _material(pointer, ctx):
    """The material key (`<name>#<path id>`), registering the full record once per instance."""
    if not pointer:
        return None
    p = _pointer(pointer, ctx)
    if p is None:
        return None
    material_object = _deref(pointer, ctx)
    if material_object is None:
        return None
    tree = _typetree(material_object)
    if not isinstance(tree, dict):
        return None
    name = tree.get('m_Name') or None
    key = f'{name}#{p.m_PathID}'
    if key in ctx['materials']:
        return key
    textures = []
    for slot, env in uic._saved(tree, 'm_TexEnvs').items():
        env = env or {}
        record = {'slot': slot, 'texture': None}
        texture = _texture(env.get('m_Texture'), ctx)
        if texture:
            record.update({'texture': texture['texture'], 'file': texture.get('file'),
                           'w': texture.get('w'), 'h': texture.get('h')})
            # The slot's texture wrap/filter: the slot's own sampling mode, which the shader leaves to the
            # texture (`dcl_sampler mode_default` declares no wrap).
            record.update({key: texture.get(key) for key in themes.SAMPLING_KEYS})
        scale = [_round((env.get('m_Scale') or {}).get('x', 1)), _round((env.get('m_Scale') or {}).get('y', 1))]
        offset = [_round((env.get('m_Offset') or {}).get('x', 0)), _round((env.get('m_Offset') or {}).get('y', 0))]
        record['scale'] = scale
        record['offset'] = offset
        textures.append(record)
    shader_name, shader_cab = _shader(tree.get('m_Shader'), ctx)
    record = {
        'key': key,
        'name': name,
        'asset': ctx['asset_path'].get((id(getattr(material_object, 'assets_file', None)), p.m_PathID)),
        'shader': shader_name,
        'keywords': [str(word) for word in (tree.get('m_ValidKeywords') or [])],
        'renderQueue': _round(tree.get('m_CustomRenderQueue')),
        'textures': textures,
        'floats': {slot: _round(value) for slot, value in uic._saved(tree, 'm_Floats').items()},
        'colors': {slot: _color(value) for slot, value in uic._saved(tree, 'm_Colors').items()},
    }
    if shader_cab:
        record['shaderCab'] = shader_cab
    record['draw'] = _draw(record)
    ctx['materials'][key] = record
    return key


def _dst_factor(shader, floats):
    """The destination blend factor the pass binds, from the material's own float (card_shader.py records the binding:
    `_DstBlend` for the AlphaBlend family, `_Dst` for UI-Fx-Common / UI-DoubleDissolve-Tex). 1 = ONE (additive light),
    10 = ONE_MINUS_SRC_ALPHA (ordinary alpha)."""
    shader = shader or ''
    if 'AlphaBlend' in shader:
        value = floats.get('_DstBlend')
    else:
        value = floats.get('_Dst')
        if value is None:
            value = floats.get('_DstBlend')
    return None if value is None else int(round(value))


def _slot_st(slot):
    """A texture slot's scale/offset pair, or (None, None) when the material has no such slot.

    `_material` writes both on every slot it records, so the fallback only covers a record built by hand.
    """
    if not slot:
        return None, None
    return slot.get('scale') or [1, 1], slot.get('offset') or [0, 0]


def _dissolve(record, slot, shader):
    """The dissolve block the shader declares, with the mask picture when the material binds one.

    Two families, each with its own property names: `UI-DoubleDissolve-Tex` (`_Dissolve1Clip` / `_Dissolve1Smooth` /
    `_Revert1` and no UV speed at all) and `UI-Fx-Common` (`_Dissolve1_Threshold` / `_Dissolve1_Smoothness` /
    `_Dissolve1_Invert`, plus the `_Dissolve_Speed` colour as texture-1 UV per second). Everything else gets no
    dissolve — the particle materials serialize a full set of `_Dissolve1_*` left over from a previous shader, and
    reading those would put a dissolve on a plain AlphaBlend quad.

    The block is emitted whenever the material's own shader declares the family, even with an unbound `_Dissolve1_Tex`
    slot: the threshold / smoothness / invert are the shader's values either way, and a reader that resolves the mask
    picture another way must not have to guess them. `tile`/`offset` come with the picture, so they are written only
    when the slot binds one.
    """
    floats = record['floats']
    colors = record['colors']
    if 'DoubleDissolve' in shader:
        # the `_Dissolve1_Threshold 0.08 / _Dissolve1_Smoothness 1 / _Dissolve_Speed (0.1,-0.3)` left on the frozen
        # materials belong to UI-Fx-Common and kept the close-out sweep scrolling (FROZEN-SPEC §7.5)
        threshold = _round(floats.get('_Dissolve1Clip', 0))
        smoothness = _round(floats.get('_Dissolve1Smooth', 1))
        invert = int(_round(floats.get('_Revert1', 0)) or 0)
        speed = [0, 0]
    elif 'UI-Fx-Common' in shader:
        if '_Dissolve_Speed' not in colors and not any(
                name in floats for name in ('_Dissolve1_Threshold', '_Dissolve1_Smoothness', '_Dissolve1_Invert')):
            return None
        threshold = _round(floats.get('_Dissolve1_Threshold', floats.get('_Dissolve', 0)))
        smoothness = _round(floats.get('_Dissolve1_Smoothness', 0))
        invert = int(_round(floats.get('_Dissolve1_Invert', 0)) or 0)
        speed_color = colors.get('_Dissolve_Speed') or [0, 0, 0, 0]
        speed = [_round(speed_color[0]), _round(speed_color[1])]
    else:
        return None
    out = {
        'threshold': threshold,
        'smoothness': smoothness,
        'invert': invert,
        'speed': speed,
    }
    if slot.get('texture'):
        tile, offset = _slot_st(slot)
        out = {
            'texture': slot['texture'],
            'file': slot.get('file'),
            **out,
            'tile': tile,
            'offset': offset,
        }
    return out


def _draw(record):
    """The material's look as the card renderer needs it: base × tint × mask, blend, scroll, dissolve.

    Every slot the shader samples writes its own scale/offset (`tile` / `offset`, `maskTile` / `maskOffset`,
    `dissolveTile` / `dissolveOffset`) even when it is the identity: the renderer's UV maths is the shader's, and the
    dissolve sweep's tiling (`tier_lv6_sweep` is `_Dissolve1_Tex` at [1, 0.3]) only ever reaches the page through
    `dissolveTile` — a document that drops it renders the VI sweep with an untile'd mask.
    """
    slots = {slot['slot']: slot for slot in record['textures']}
    floats = record['floats']
    colors = record['colors']
    shader = record.get('shader') or ''
    base = slots.get('_BaseTex') or slots.get('_MainTex') or {}
    mask = slots.get('_Mask_Tex') or {}
    dissolve = slots.get('_DissolveTex1') or slots.get('_Dissolve1_Tex') or slots.get('_DissolveTex') or {}
    base_st = _slot_st(base)
    mask_st = _slot_st(mask)
    dissolve_st = _slot_st(dissolve)
    # `_Dst` is the source of truth where the shader binds it: `m_card_frozen_closure` is `_Dst = 10` (alpha) even
    # though it also carries a leftover `_DstBlend = 1`, which used to be read first and painted it additively
    # (FROZEN-SPEC §7.4). A factor of 10 is ordinary alpha blending, so the look is no longer `add` for it.
    dst = _dst_factor(shader, floats)
    out = {
        'tint': _rgba_hex(colors.get('_Color')),
        'blend': None if dst is None else ('add' if dst == 1 else 'alpha'),
        'base': base.get('texture'),
        'baseFile': base.get('file'),
        'tile': base_st[0],
        'offset': base_st[1],
        'speed': [_round(floats.get('_BaseTex_SpeedU', 0)), _round(floats.get('_BaseTex_SpeedV', 0))],
        'mask': mask.get('texture'),
        'maskFile': mask.get('file'),
        'maskTile': mask_st[0],
        'maskOffset': mask_st[1],
        'maskInvert': int(_round(floats.get('_Mask_Invert', 0)) or 0),
        'intensity': _round(floats.get('_Intensity', 1)),
        'alphaClip': int(_round(floats.get('_UseUIAlphaClip', 0)) or 0),
        # `_BaseTex_Channel` (UI-Fx-Common only): 0 = RGBA, 1 = the red channel as coverage (`tv_glow1` samples the
        # grey sweep's R as its alpha). Emitted only where the shader declares it, so a stale serialized value cannot
        # leak into another family.
        'channel': (int(_round(floats.get('_BaseTex_Channel', 0)) or 0)
                    if 'UI-Fx-Common' in shader and '_BaseTex_Channel' in floats else None),
        # `_RgbCtrl = 1`: the shader takes its RGB from the material's `_Color` instead of the Image colour (the smoke
        # node's Image colour is #00970000, and drawing that straight through paints the fog green)
        'rgbCtrl': (1 if floats.get('_RgbCtrl') else 0) if '_RgbCtrl' in floats else None,
        # `_ColIntensity` (UI-DoubleDissolve-Tex, "brightness multiplier applied to the tint"); serialized materials
        # keep leftovers from a previous shader, so only the family that declares it reads it
        'colIntensity': (_round(floats.get('_ColIntensity', 1))
                         if 'DoubleDissolve' in shader and '_ColIntensity' in floats else None),
        'srcBlend': _round(floats.get('_SrcBlend')),
        'dst': dst,
    }
    dissolve_block = _dissolve(record, dissolve, shader)
    if dissolve_block:
        out['dissolve'] = dissolve_block
        # the mask ST sits on the draw record, not inside the dissolve block: that is the key the renderer binds to
        # `uDissTile` / `uDissOffset`, and it is the slot's value even when the picture itself is unbound
        out['dissolveTile'] = dissolve_st[0]
        out['dissolveOffset'] = dissolve_st[1]
    return {key: value for key, value in out.items() if value is not None and value != []}


def _rgba_hex(color):
    if not isinstance(color, list) or len(color) < 4:
        return None
    return uic._hex({'r': color[0], 'g': color[1], 'b': color[2], 'a': color[3]})


def _compact_material(pointer, ctx):
    """The compact record prefabs.json carries, so a reader that only knows that shape still works."""
    if not pointer:
        return None
    p = _pointer(pointer, ctx)
    obj = _deref(pointer, ctx)
    if obj is None:
        return {'name': None, 'external': 1, 'cab': _cab_of(p, ctx) if p is not None else None}
    tree = _typetree(obj)
    record = None
    try:
        record = uic.material_info(tree, _name_of(ctx))
    except Exception:  # noqa: BLE001
        record = None
    return record or {'name': (tree or {}).get('m_Name')}


def _image(tree, ctx):
    """`UnityEngine.UI.Image` serialized as a MonoBehaviour: its sprite, colour, fill and material."""
    if not isinstance(tree, dict) or 'm_Sprite' not in tree or 'm_Type' not in tree:
        return None
    try:
        kind = themes.IMAGE_TYPES.get(int(tree.get('m_Type') or 0), 'simple')
    except (TypeError, ValueError):
        kind = 'simple'
    out = {'type': kind, 'color': themes.color_hex(tree.get('m_Color'))}
    if kind == 'filled':
        out['fillAmount'] = _round(tree.get('m_FillAmount'))
        out['fillMethod'] = tree.get('m_FillMethod')
    out.update(uic.image_extras(tree))
    sprite = _sprite(tree.get('m_Sprite'), ctx)
    if sprite:
        out.update({'sprite': sprite['name'], 'w': sprite.get('w'), 'h': sprite.get('h')})
        for key in ('slice', 'file'):
            if sprite.get(key):
                out[key] = sprite[key]
        # the atlas texture's wrap/filter/own size: `w`/`h` above are the sprite rect
        out.update({key: sprite.get(key) for key in themes.SAMPLING_KEYS})
        if sprite.get('external'):
            out['spriteExternal'] = True
            out['spriteCab'] = sprite.get('cab')
    else:
        out['sprite'] = None
    key = _material(tree.get('m_Material'), ctx)
    if key:
        out['mat'] = key
        out['material'] = _compact_material(tree.get('m_Material'), ctx)
    return out


def _raw(tree, ctx):
    """`UnityEngine.UI.RawImage`: its rect texture, colour, UV window, and the material that draws it."""
    if not isinstance(tree, dict) or 'm_Texture' not in tree or 'm_UVRect' not in tree:
        return None
    out = uic.raw_image(tree, _name_of(ctx)) or {}
    texture = _texture(tree.get('m_Texture'), ctx)
    out['tex'] = (texture or {}).get('texture')
    if texture and texture.get('file'):
        out['file'] = texture['file']
    if texture:
        # a RawImage's own UV window is the place a tiled read needs the texture's wrap
        out.update({key: texture.get(key) for key in themes.SAMPLING_KEYS})
    key = _material(tree.get('m_Material'), ctx)
    if key:
        out['mat'] = key
        out['material'] = (ctx['materials'].get(key) or {}).get('name')
    return out


def _minmax(curve):
    """A MinMaxCurve as stored, without reordering the ends (Unity's min may exceed its max).

    A two-curves value (`minMaxState == 2`) keeps both curves, as `_minmax_tree` does: a reader that only got the max
    curve would draw one curve where the system animates between two.
    """

    def rows(holder):
        try:
            keys = getattr(holder, 'm_Curve', None) or []
        except Exception:  # noqa: BLE001
            keys = []
        return [[_round(getattr(key, 'time', 0)), _round(getattr(key, 'value', 0))] for key in keys]

    if curve is None:
        return None
    state = int(getattr(curve, 'minMaxState', 0) or 0)
    if state == 0:
        return {'mode': 'constant', 'value': _round(getattr(curve, 'scalar', 0))}
    if state == 3:
        return {'mode': 'range', 'min': _round(getattr(curve, 'minScalar', 0)), 'max': _round(getattr(curve, 'scalar', 0)),
                'raw': {'scalar': _round(getattr(curve, 'scalar', 0)),
                        'minScalar': _round(getattr(curve, 'minScalar', 0))}}
    keys = rows(getattr(curve, 'maxCurve', None))
    if state == 2:
        return {'mode': 'twoCurves', 'keys': keys, 'minKeys': rows(getattr(curve, 'minCurve', None))}
    return {'mode': 'curve', 'keys': keys}


def _minmax_tree(curve):
    """The typetree form of a MinMaxCurve, with the key slopes the over-lifetime modules need."""
    if not isinstance(curve, dict):
        return None
    state = int(curve.get('minMaxState') or 0)
    keys = []
    for key in ((curve.get('maxCurve') or {}).get('m_Curve') or []):
        keys.append([_round(key.get('time')), _round(key.get('value')),
                     _round(key.get('inSlope')), _round(key.get('outSlope'))])
    raw = {'scalar': _round(curve.get('scalar')), 'minScalar': _round(curve.get('minScalar'))}
    if state == 0:
        return {'mode': 'constant', 'value': raw['scalar']}
    if state == 3 or (state == 2 and not keys):
        return {'mode': 'range', 'min': raw['minScalar'], 'max': raw['scalar'], 'raw': raw}
    if keys:
        out = {'mode': 'curve', 'keys': keys}
        if state == 2:
            out['mode'] = 'twoCurves'
            out['minKeys'] = [[_round(key.get('time')), _round(key.get('value'))]
                              for key in ((curve.get('minCurve') or {}).get('m_Curve') or [])]
        out['raw'] = raw
        return out
    return {'mode': 'constant', 'value': raw['scalar'], 'raw': raw}


def _gradient_tree(gradient):
    """A Gradient / MinMaxGradient as stored: one colour, a keyed gradient, or a random pair of either.

    Unity's mode: 0 one colour, 1 one gradient, 2 two colours (random between them), 3 two gradients. The single
    colour of mode 0 is `maxColor`, which is where the inspector's swatch is serialised.
    """
    if not isinstance(gradient, dict):
        return None
    state = int(gradient.get('minMaxState') or 0)
    out = {}
    if state in (0, 2):
        out['mode'] = 'color' if state == 0 else 'twoColors'
        out['min'] = uic._hex(gradient.get('minColor'))
        out['max'] = uic._hex(gradient.get('maxColor'))
        if state == 0:
            out['color'] = out['max']
        return out
    out['mode'] = 'gradient' if state == 1 else 'twoGradients'
    body = gradient.get('maxGradient') or {}
    out['blend'] = {0: 'blend', 1: 'fixed'}.get(int(body.get('m_Mode') or 0), 'blend')
    out['colorKeys'] = []
    for index in range(min(8, int(body.get('m_NumColorKeys') or 0))):
        out['colorKeys'].append([_round(int(body.get(f'ctime{index}') or 0) / 65535), _color(body.get(f'key{index}'))])
    out['alphaKeys'] = []
    for index in range(min(8, int(body.get('m_NumAlphaKeys') or 0))):
        out['alphaKeys'].append([_round(int(body.get(f'atime{index}') or 0) / 65535),
                                 _round((body.get(f'key{index}') or {}).get('a'))])
    if state == 3 and isinstance(gradient.get('minGradient'), dict):
        low = gradient['minGradient']
        out['minColorKeys'] = [[_round(int(low.get(f'ctime{index}') or 0) / 65535), _color(low.get(f'key{index}'))]
                               for index in range(min(8, int(low.get('m_NumColorKeys') or 0)))]
        out['minAlphaKeys'] = [[_round(int(low.get(f'atime{index}') or 0) / 65535),
                                _round((low.get(f'key{index}') or {}).get('a'))]
                               for index in range(min(8, int(low.get('m_NumAlphaKeys') or 0)))]
    return out


# The modules a particle renderer needs, the record key each becomes, and the fields worth keeping. A module whose
# `enabled` is false is left out entirely, so a missing key means "off".
PARTICLE_MODULES = (
    ('ShapeModule', 'shape', ('type', 'angle', 'arc', 'length', 'radius', 'radiusThickness', 'donutRadius',
                              'boxThickness', 'm_Scale', 'm_Position', 'm_Rotation', 'placementMode',
                              'randomDirectionAmount', 'sphericalDirectionAmount', 'randomPositionAmount',
                              'alignToDirection', 'm_TextureClipChannel')),
    ('VelocityModule', 'velocity', ('x', 'y', 'z', 'orbitalX', 'orbitalY', 'orbitalZ', 'orbitalOffsetX',
                                    'orbitalOffsetY', 'orbitalOffsetZ', 'radial', 'speedModifier', 'inWorldSpace')),
    ('ColorModule', 'color', ('gradient',)),
    ('SizeModule', 'size', ('curve', 'y', 'z', 'separateAxes')),
    ('RotationModule', 'rotation', ('curve', 'x', 'y', 'separateAxes')),
    ('ForceModule', 'force', ('x', 'y', 'z', 'inWorldSpace', 'randomizePerFrame')),
    ('ClampVelocityModule', 'limitVelocity', ('separateAxis', 'x', 'y', 'z', 'magnitude', 'dampen', 'drag',
                                              'multiplyDragByParticleSize', 'multiplyDragByParticleVelocity',
                                              'inWorldSpace')),
    ('InheritVelocityModule', 'inheritVelocity', ('m_Mode', 'm_Curve')),
    ('NoiseModule', 'noise', ('strength', 'strengthY', 'strengthZ', 'frequency', 'scrollSpeed', 'damping',
                              'octaves', 'octaveMultiplier', 'octaveScale', 'quality', 'positionAmount',
                              'rotationAmount', 'sizeAmount', 'separateAxes', 'remapEnabled', 'remap', 'remapY',
                              'remapZ')),
    ('SizeBySpeedModule', 'sizeBySpeed', ('curve', 'y', 'z', 'separateAxes', 'range')),
    ('ColorBySpeedModule', 'colorBySpeed', ('gradient', 'range')),
    ('RotationBySpeedModule', 'rotationBySpeed', ('curve', 'x', 'y', 'separateAxes', 'range')),
    ('SubModule', 'subEmitters', ('subEmitters',)),
    ('UVModule', 'textureSheet', ('mode', 'timeMode', 'fps', 'tilesX', 'tilesY', 'animationType', 'rowMode',
                                  'rowIndex', 'frameOverTime', 'startFrame', 'cycles', 'flipU', 'flipV',
                                  'speedRange', 'uvChannelMask')),
    ('TrailModule', 'trail', ('mode', 'ratio', 'lifetime', 'minVertexDistance', 'ribbonCount', 'dieWithParticles',
                              'sizeAffectsWidth', 'sizeAffectsLifetime', 'inheritParticleColor', 'colorOverLifetime',
                              'colorOverTrail', 'widthOverTrail', 'worldSpace')),
    ('LightsModule', 'lights', ('ratio', 'randomDistribution', 'light', 'maxLights', 'intensity', 'intensityCurve',
                                'range', 'color')),
    ('CollisionModule', 'collision', ('collisionMode', 'collidesWithDynamic', 'interiorCollisions', 'm_Bounce',
                                      'm_Dampen', 'm_EnergyLossOnCollision')),
    ('ExternalForcesModule', 'externalForces', ('influenceFilter', 'influenceBias', 'multiplier', 'multiplierCurve')),
    ('LifetimeByEmitterSpeedModule', 'lifetimeByEmitterSpeed', ('range', 'curve')),
    ('CustomDataModule', 'customData', ('mode', 'vectorComponentCount', 'color', 'vector')),
    ('TriggerModule', 'trigger', ('inside', 'outside', 'enter', 'exit', 'radiusScale')),
)


def _plain(value, depth=0):
    """A typetree value as JSON: MinMaxCurves, gradients, vectors and colours become compact records."""
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return _round(value)
    if isinstance(value, list):
        return [_plain(item, depth + 1) for item in value]
    if not isinstance(value, dict):
        return None
    if 'maxGradient' in value or 'm_NumColorKeys' in value:
        return _gradient_tree(value)
    if 'minMaxState' in value:
        return _minmax_tree(value)
    if 'm_FileID' in value and 'm_PathID' in value:
        return None if not value.get('m_PathID') else {'ref': value['m_PathID']}
    if any(str(key).startswith('bytes[') for key in value):
        return None
    if 'value' in value and 'mode' in value and 'speed' in value:
        return {'value': _round(value.get('value')), 'mode': _plain(value.get('mode')),
                'spread': _round(value.get('spread')), 'speed': _plain(value.get('speed'))}
    if len(value) == 3 and {'x', 'y', 'z'} <= set(value):
        return [_round(value['x']), _round(value['y']), _round(value['z'])]
    if len(value) == 2 and {'x', 'y'} <= set(value):
        return [_round(value['x']), _round(value['y'])]
    if len(value) == 4 and {'r', 'g', 'b', 'a'} <= set(value):
        return _color(value)
    if depth > 5:
        return None
    return {str(key): _plain(item, depth + 1) for key, item in value.items()
            if not str(key).startswith(('m_EditorDataHash', 'bytes['))}


def _particle_modules(tree):
    """The particle modules the renderer needs: emitters, curves over lifetime, colour, sheet animation, forces."""
    out = {}
    for module_key, out_key, fields in PARTICLE_MODULES:
        module = tree.get(module_key)
        if not isinstance(module, dict):
            continue
        if 'enabled' in module and not module.get('enabled'):
            continue
        record = {}
        for field in fields:
            if field not in module:
                continue
            value = _plain(module[field])
            if value not in (None, [], {}):
                record[field] = value
        if out_key == 'shape' and isinstance(record.get('type'), int):
            record['typeName'] = card_shader.SHAPE_TYPES.get(record['type'])
        if out_key == 'subEmitters':
            record = {'subEmitters': [_plain(entry) for entry in module.get('subEmitters') or []]}
        if record:
            out[out_key] = record
    return out


def _particle(component_object, ctx, path):
    """A ParticleSystem under a prefab: timing, start curves, every over-lifetime module, and its renderer."""
    try:
        system = component_object.read()
    except Exception:  # noqa: BLE001
        return None
    tree = _typetree(component_object) or {}
    initial = getattr(system, 'InitialModule', None)
    emission = getattr(system, 'EmissionModule', None)
    initial_tree = tree.get('InitialModule') or {}
    record = {
        'path': path,
        'length': _round(getattr(system, 'lengthInSec', None)),
        'looping': bool(getattr(system, 'looping', False)),
        'playOnAwake': bool(getattr(system, 'playOnAwake', False)),
        'prewarm': bool(getattr(system, 'prewarm', False)),
        'simulationSpeed': _round(getattr(system, 'simulationSpeed', 1)),
        'startLifetime': _minmax(getattr(initial, 'startLifetime', None)),
        'startSize': _minmax(getattr(initial, 'startSize', None)),
        'startSpeed': _minmax(getattr(initial, 'startSpeed', None)),
        'startRotation': _minmax(getattr(initial, 'startRotation', None)),
        'gravityModifier': _minmax(getattr(initial, 'gravityModifier', None)),
        'maxParticles': _round(getattr(initial, 'maxNumParticles', None)),
        'rate': _minmax(getattr(emission, 'rateOverTime', None)),
    }
    bursts = []
    for burst in getattr(emission, 'bursts', None) or []:
        bursts.append({'time': _round(getattr(burst, 'time', 0)),
                       'count': _minmax(getattr(burst, 'count', None)),
                       'cycles': _round(getattr(burst, 'cycleCount', 1)),
                       'interval': _round(getattr(burst, 'repeatInterval', 0))})
    if bursts:
        record['bursts'] = bursts
    # The typetree keeps what the typed object hides: the start colour, the over-lifetime modules and the emitter.
    start_color = _gradient_tree(initial_tree.get('startColor'))
    if start_color:
        record['startColor'] = start_color
    if tree.get('startDelay') is not None:
        record['startDelay'] = _minmax_tree(tree.get('startDelay'))
    record['simulationSpace'] = {0: 'local', 1: 'world'}.get(int(tree.get('moveWithTransform') or 0), 'local')
    record['settings'] = {
        'scalingMode': _round(tree.get('scalingMode')),
        'stopAction': _round(tree.get('stopAction')),
        'cullingMode': _round(tree.get('cullingMode')),
        'ringBufferMode': _round(tree.get('ringBufferMode')),
        'emitterVelocityMode': _round(tree.get('emitterVelocityMode')),
        'useUnscaledTime': bool(tree.get('useUnscaledTime')),
        'autoRandomSeed': bool(tree.get('autoRandomSeed')),
        'randomSeed': _round(tree.get('randomSeed')),
    }
    modules = _particle_modules(tree)
    if modules:
        record['modules'] = modules
    renderer_pointer = None
    try:
        for entry in system.m_GameObject.read().m_Component:
            pointer = entry.component
            if pointer and pointer.m_PathID and pointer.deref().type.name == 'ParticleSystemRenderer':
                renderer_pointer = pointer
                break
    except Exception:  # noqa: BLE001
        renderer_pointer = None
    if renderer_pointer is not None:
        drawn = renderer_pointer.deref().read()
        record['renderMode'] = int(getattr(drawn, 'm_RenderMode', 0) or 0)
        drawn_tree = _typetree(renderer_pointer.deref()) or {}
        renderer = {}
        for field, name in (('m_MinParticleSize', 'minParticleSize'), ('m_MaxParticleSize', 'maxParticleSize'),
                            ('m_SortingFudge', 'sortingFudge'), ('m_Pivot', 'pivot'), ('m_Flip', 'flip'),
                            ('m_NormalDirection', 'normalDirection'), ('m_RenderAlignment', 'alignment'),
                            ('m_Mesh', 'mesh')):
            if field not in drawn_tree:
                continue
            value = _plain(drawn_tree.get(field))
            if value not in (None, [], {}):
                renderer[name] = value
        if renderer:
            record['renderer'] = renderer
        keys = [key for key in (_material(material, ctx) for material in (getattr(drawn, 'm_Materials', None) or [])
                                if material) if key]
        if keys:
            record['materials'] = keys
            record['material'] = (ctx['materials'][keys[0]] or {}).get('name')
            main = next((slot for slot in ctx['materials'][keys[0]]['textures']
                         if slot['slot'] == '_MainTex' and slot.get('texture')), None)
            if main is None:
                main = next((slot for slot in ctx['materials'][keys[0]]['textures'] if slot.get('texture')), None)
            if main is not None:
                record.update({'texture': main['texture'], 'file': main.get('file'),
                               'size': [main.get('w'), main.get('h')]})
    return record


def _clip_curves(tree):
    """A legacy clip's channels, with the material texture offset the card's sweep clips animate.

    Props are ui_components' tokens (active, alpha, ax / ay, sw / sh, rz, img.r…a, txt.r…a, raw.r…a, maxw, scale,
    lpos, rot, euler) plus `tex.u` / `tex.v` for `_textureProperty*.offset.x|y` (the RawImage material wrapper).
    """
    curves = []
    length = 0.0
    for curve in tree.get('m_FloatCurves') or []:
        class_id = int(curve.get('classID') or 0)
        attribute = curve.get('attribute') or ''
        prop = uic.CLIP_FLOAT_ATTRS.get((class_id, attribute))
        if prop is None and class_id == 114:
            script_id = int((curve.get('script') or {}).get('m_PathID', 0))
            target = uic.CLIP_SCRIPT_TARGET.get(script_id)
            match = TEX_PROPERTY.match(attribute)
            if target and attribute.startswith('m_Color.'):
                prop = f'{target}.{attribute[-1]}'
            elif attribute == 'maxWidth':
                prop = 'maxw'
            elif match:
                prop = f'tex.{match.group(1)}'
        if prop is None:
            continue
        keys = uic._scalar_keys(curve.get('curve'))
        if keys:
            curves.append([curve.get('path') or '', prop, keys])
            length = max(length, keys[-1][0])
    for field, prop, axes in (('m_ScaleCurves', 'scale', ('x', 'y', 'z')),
                              ('m_PositionCurves', 'lpos', ('x', 'y', 'z')),
                              ('m_RotationCurves', 'rot', ('x', 'y', 'z', 'w')),
                              ('m_EulerCurves', 'euler', ('x', 'y', 'z'))):
        for curve in tree.get(field) or []:
            keys = uic._vector_keys(curve.get('curve'), axes)
            if keys:
                curves.append([curve.get('path') or '', prop, keys])
                length = max(length, keys[-1][0])
    return curves, length


def _clip(tree):
    """A card clip: channels, keyframe end, muscle-clip stop time, and the length the renderer should play."""
    curves, key_end = _clip_curves(tree)
    muscle = tree.get('m_MuscleClip') or {}
    start = float(muscle.get('m_StartTime', 0) or 0)
    stop = float(muscle.get('m_StopTime', 0) or 0)
    span = max(0.0, stop - start)
    # Both card clips are legacy with a 1 s stop time, even where the keys reach past it (loop_triple: 2.5 s) or stop
    # well short of it (single_card_refresh: 0.233 s of keys). Play the longer of the two, as the official Animation
    # does; `len` keeps the keyframe end that prefabs.json reports.
    return {
        'len': _round(key_end),
        'duration': _round(max(key_end, span)),
        'stopTime': _round(stop),
        'startTime': _round(start),
        'wrap': int(tree.get('m_WrapMode') or 0),
        'loop': bool(muscle.get('m_LoopTime')),
        'curves': curves,
    }


def _clip_names(node, found):
    """Every clip a subtree refers to: attached clips, the auto clip, controller anims and status-driver ops."""
    for name in node.get('clips') or []:
        found.setdefault(name, None)
    if node.get('autoClip'):
        found.setdefault(node['autoClip'], None)
    for entry in node.get('scripts') or []:
        for ref in (entry.get('anims') or {}).values():
            if isinstance(ref, dict) and ref.get('clip'):
                found.setdefault(ref['clip'], None)
    for status in node.get('status') or []:
        for op in status.get('ops') or []:
            for key in ('anim', 'animOut'):
                if isinstance(op.get(key), dict) and op[key].get('clip'):
                    found.setdefault(op[key]['clip'], None)
    for child in node.get('children') or []:
        _clip_names(child, found)


def _material_keys(node, keys):
    """Every material a subtree draws with: the graphics' own, and the particle systems'."""
    for holder in (node.get('image'), node.get('raw')):
        if isinstance(holder, dict) and holder.get('mat'):
            keys.add(holder['mat'])
    for particle in node.get('particles') or []:
        for key in particle.get('materials') or []:
            keys.add(key)
    for child in node.get('children') or []:
        _material_keys(child, keys)


def _flatten(node, found):
    """Every node of a tree, in draw order."""
    found.append(node)
    for child in node.get('children') or []:
        _flatten(child, found)


def _roles(node, out, classes=None):
    """Controller field → node id (or ids), for every script on the prefab; `classes` maps field → script class."""
    for entry in node.get('scripts') or []:
        for field, value in (entry.get('refs') or {}).items():
            if isinstance(value, list):
                if value:
                    out.setdefault(field, value if len(value) > 1 else value[0])
            elif value is not None:
                out.setdefault(field, value)
            if classes is not None and entry.get('class'):
                classes.setdefault(field, entry['class'])
    for child in node.get('children') or []:
        _roles(child, out, classes)
    return out


def _paths(node, out):
    """node id → GameObject path."""
    if node.get('id') is not None:
        out[node['id']] = node.get('path')
    for child in node.get('children') or []:
        _paths(child, out)
    return out


def _runtime_notes(root, roles, classes=None):
    """Sprite-less Images: the controller field that assigns the sprite, its script class, and who supplies it."""
    by_id = {}
    for field, value in roles.items():
        for node_id in (value if isinstance(value, list) else [value]):
            if isinstance(node_id, int):
                by_id.setdefault(node_id, field)
    classes = classes or {}
    notes = {}
    nodes = []
    _flatten(root, nodes)
    for node in nodes:
        image = node.get('image')
        if not isinstance(image, dict) or image.get('sprite'):
            continue
        path = node.get('path') or node.get('name')
        node_id = node.get('id')
        entry = {'path': path, 'name': node.get('name')}
        if node_id is not None:
            entry['node'] = node_id
        field = by_id.get(node_id) if node_id is not None else None
        if field:
            entry['field'] = field
            if classes.get(field):
                entry['script'] = classes[field]
        source = RUNTIME_SOURCE.get(field) or RUNTIME_BY_NAME.get(node.get('name'))
        if source:
            entry['source'] = source[0]
            if source[1]:
                entry['slots'] = list(source[1])
        else:
            entry['source'] = 'unknown'
        notes[str(node_id if node_id is not None else path)] = entry
    return notes


def _classify(tree, ctx):
    """Put each script's class name on its node entry, from the per-document script cache `ctx['scripts']`."""
    nodes = []
    _flatten(tree, nodes)
    for node in nodes:
        for entry in node.get('scripts') or []:
            record = ctx['scripts'].get(str(entry.get('script')))
            if record and record.get('class'):
                entry['class'] = record['class']
                if record.get('namespace'):
                    entry['namespace'] = record['namespace']


# The controller's three-value ChessLevelState (AutoChessBattleShopCardView + AutoChessBattleShopCardViewModel, read from
# the decompile): a card's frame / tier objects are chosen per state, not per tier, and `_imgFrame` is the matching
# `chess_frame_<state>` slot while `_imgTier` is `chess_level_icon_<level>` at every level.
# [INFERRED, fallback only] Which frame object each state instantiates when the pack's serialized
# `_chessLevelStyles[]` table is not readable: the three states are mapped onto the three sub-prefabs in their natural
# order (frame_lv2_obj carries the TV and the colour band, frame_lv3_obj adds the sweep and the glows). A pack that
# carries the table — see `_driver`, `source: "prefab"` — uses the real mapping instead.
# table below maps the three states onto the three sub-prefabs this pack ships in their natural order (frame_lv2_obj
# carries the TV and the colour band, frame_lv3_obj adds the sweep and the glows, i.e. the richer 5 / 6-star decks).
LEVEL_STATES = ('NORMAL', 'LEVEL_FIVE', 'LEVEL_SIX')
FRAME_STATE_SLUG = {'NORMAL': 'normal', 'LEVEL_FIVE': 'level_five', 'LEVEL_SIX': 'level_six'}
LEVEL_STATE_TIERS = {'NORMAL': [1, 2, 3, 4], 'LEVEL_FIVE': [5], 'LEVEL_SIX': [6]}
LEVEL_FRAME_PREFAB = {'NORMAL': 'frame_lv1_obj', 'LEVEL_FIVE': 'frame_lv2_obj', 'LEVEL_SIX': 'frame_lv3_obj'}
LEVEL_TIER_PREFAB = {'LEVEL_FIVE': 'chess_level_5_obj', 'LEVEL_SIX': 'chess_level_6_obj'}


def _driver(root, subs):
    """The runtime rules the client's controller applies, recorded as data beside the prefab.

    Three parts, all from the decompiled `AutoChessBattleShopCardView`:
    - `status`: the prefab's own status entries (node → statusName → ops), i.e. the state-driven side of the card;
    - `levels`: the `ChessLevelState` table (which frame / tier object, which frame sprite slug) restricted to the
      sub-prefabs this pack actually ships;
    - `textures` / `rules`: the sprite keys each controller field loads and the `_RenderState` predicates, so a renderer
      reads them instead of re-deriving them.
    """
    nodes = []
    _flatten(root, nodes)
    status = []
    for node in nodes:
        for entry in node.get('status') or []:
            status.append({
                'node': node.get('id'),
                'path': node.get('path'),
                'name': entry.get('name'),
                'ops': entry.get('ops') or [],
            })
    levels = []
    # The serialized `_chessLevelStyles[]` table (state → frameObj / tierObj / decoColor) is the real mapping; only a
    # pack that does not carry it falls back to the three-states-three-prefabs inference below.
    extracted = next((node.get('levelStyles') for node in nodes if node.get('levelStyles')), None)
    if extracted:
        for row in extracted:
            index = int(row.get('levelState') or 0)
            state = LEVEL_STATES[index] if 0 <= index < len(LEVEL_STATES) else f'STATE_{index}'
            levels.append({
                'state': state,
                'tiers': list(LEVEL_STATE_TIERS.get(state, [])),
                'frameKey': FRAME_STATE_SLUG.get(state, 'normal'),
                'frame': row.get('frameObj'),
                'tierObj': row.get('tierObj'),
                'decoColor': row.get('decoColor'),
                'source': 'prefab',
            })
    for state in LEVEL_STATES:
        if extracted:
            break
        frame = LEVEL_FRAME_PREFAB.get(state)
        tier = LEVEL_TIER_PREFAB.get(state)
        frame_key = frame if frame in subs else None
        tier_key = tier if tier in subs else None
        if frame_key is None and tier_key is None:
            continue
        levels.append({
            'state': state,
            'tiers': list(LEVEL_STATE_TIERS[state]),
            'frameKey': FRAME_STATE_SLUG[state],
            'frame': frame_key,
            'tierObj': tier_key,
            'decoColor': None,
            'source': 'inferred',
        })
    return {
        'evidence': 'IL2CPP decompile of Torappu.UI.AutoChess.Battle.AutoChessBattleShopCardView '
                    '(RenderView / _RenderState / _ApplyChessLevelStyle / _RenderFrozen / PlayRefreshAnim)',
        'status': status,
        'levels': levels,
        'textures': {
            '_imgFrame': {'source': 'theme-slot', 'when': 'the level state or skin changes',
                          'key': 'chess_frame_{state}', 'states': dict(FRAME_STATE_SLUG)},
            '_imgTier': {'source': 'theme-slot', 'when': 'every render (1-6)', 'key': 'chess_level_icon_{level}',
                         'count': 6},
            '_garrisonIcon': {'source': 'game-art', 'when': 'a character card whose model has one',
                              'key': '{garrisonTypeIcon}'},
            '_equipIcon': {'source': 'game-art', 'when': 'an equipment card', 'key': '{icon}'},
        },
        'rules': {
            'able': 'currCoin >= price ? !isHandFull : false',
            'notEnoughNode': '!able',
            'enoughToggle': 'able',
            'charToggle': 'isChar',
            'repeatedFxNode': '(canComb && hasSame) || hasFusePartner',
            'frozen': 'isFrozen; a re-render while the layer already matches does nothing, and the first render '
                      'samples the clip at its end instead of playing it',
            'levelStyle': 'ChessLevelState -> ClearAllChildren + Instantiate(frameObj / tierObj)',
            'refresh': 'PlayRefreshAnim after the shop panel renders slots; the clip moves the card content root',
        },
    }


def _prefab_doc(go, ctx, key, prefab_path, clips_by_name):
    """One prefab as a card document piece: tree, materials, clips, particles, roles, runtime notes."""
    ctx['seen'] = None
    ctx['nodes'] = {}
    ctx['refs'] = set()
    ctx['node_count'] = 0
    ctx['particles'] = []
    tree = _walk_gameobject(go, ctx, 0, '')
    themes._resolve_refs(tree, ctx)
    _classify(tree, ctx)
    ids = _paths(tree, {})
    path_of_id = {path: node_id for node_id, path in ids.items()}
    for particle in ctx['particles']:
        node_id = path_of_id.get(particle.get('path'))
        if node_id is not None:
            particle['id'] = node_id
    keys = set()
    _material_keys(tree, keys)
    for particle in ctx['particles']:
        keys.update(particle.get('materials') or [])
    names = {}
    _clip_names(tree, names)
    clips = {}
    for name in names:
        clip_tree = clips_by_name.get(name)
        if clip_tree is not None:
            clips[name] = _clip(clip_tree)
    classes = {}
    roles = _roles(tree, {}, classes)
    doc = {
        'key': key,
        'prefab': prefab_path,
        'nodeCount': ctx['node_count'],
        'size': (tree.get('rect') or {}).get('sizeDelta'),
        'root': tree,
        'ids': ids,
        'roles': dict(sorted(roles.items())),
        'runtime': _runtime_notes(tree, roles, classes),
        'materials': {name: ctx['materials'][name] for name in sorted(keys) if name in ctx['materials']},
        'clips': dict(sorted(clips.items())),
        'particles': ctx['particles'],
    }
    return doc


_SKIP_FIELDS = frozenset((
    'm_ObjectHideFlags', 'm_CorrespondingSourceObject', 'm_PrefabInstance', 'm_PrefabAsset', 'm_GameObject',
    'm_Script', 'm_PrefabParentObject', 'm_PrefabInternal',
))


def _digest(ctree, ref, ctx, depth=0):
    """A component's serialized fields, compactly: primitives kept, PPtrs resolved to node ids, structs flattened.

    This is how the fields the model does not consume surface at all — e.g. which wrapper drives a TV's flicker, or
    what a `UIRawImageMatAnimWrapper` put in slot 3. A reference to a GameObject *outside* this prefab is kept as
    `{'prefabRef': <path id>}` so a caller can pull that prefab in.
    """
    if not isinstance(ctree, dict) or depth > 3:
        return None
    out = {}
    for key, value in ctree.items():
        if key in _SKIP_FIELDS:
            continue
        name = key[2:] if key.startswith('m_') else key
        if isinstance(value, bool) or isinstance(value, (int, float)):
            out[name] = value
        elif isinstance(value, str):
            out[name] = value if len(value) <= 120 else value[:120] + '…'
        elif isinstance(value, dict):
            if 'm_PathID' in value:
                hit = ref(value)
                if hit is not None:
                    if isinstance(hit, themes._Ref):
                        # keep the file id too: a pointer into another bundle (`m_FileID != 0`) cannot be pulled in
                        # from a bare path id, and the sell views / main prefab are exactly that
                        file_id, pid = themes._pptr(value)
                        out[name] = {'pid': pid} if not file_id else {'file': file_id, 'pid': pid}
                    else:
                        out[name] = int(hit)
                else:
                    pid = (themes._pptr(value) or (0, 0))[1]
                    out[name] = {'prefabRef': pid} if pid else None
            else:
                inner = _digest(value, ref, ctx, depth + 1)
                if inner:
                    out[name] = inner
        elif isinstance(value, list):
            if not value:
                continue
            if all(isinstance(v, (bool, int, float, str)) for v in value):
                out[name] = value[:64]
            else:
                items = [v for v in (item_ref(v, ref, ctx, depth) for v in value[:16]) if v is not None]
                if items:
                    out[name] = items
    return out or None


def item_ref(value, ref, ctx, depth):
    """One element of a serialized array: a PPtr → node id, a struct → its digest."""
    if isinstance(value, dict):
        if 'm_PathID' in value:
            hit = ref(value)
            if hit is not None:
                return int(hit) if not isinstance(hit, themes._Ref) else {'pid': hit.pid}
            pid = (themes._pptr(value) or (0, 0))[1]
            return {'prefabRef': pid} if pid else None
        return _digest(value, ref, ctx, depth + 1)
    if isinstance(value, (bool, int, float, str)):
        return value
    return None


def _gameobject_name_of(pointer, ctx):
    """A PPtr to a GameObject *outside* the walked prefab (a sub-prefab root) → its name, else None."""
    pid = (themes._pptr(pointer) if isinstance(pointer, dict) else (0, 0))[1]
    if not pid:
        return None
    obj = ctx['objects'].get(pid)
    if obj is None:
        return None
    try:
        tree = _typetree(obj)
    except Exception:
        return None
    return (tree or {}).get('m_Name') if isinstance(tree, dict) else None


def _prefab_refs_of(ctree):
    """The cross-bundle prefab references a component carries: `{sub key: raw PPtr}`, e.g. `_viewPrefab` → `bondItem`.

    A PPtr to a GameObject outside this prefab is kept raw (its `m_FileID` picks the bundle) so the caller can walk that
    prefab's own tree; `_digest` only keeps the path id, which is not enough to resolve it across files.
    """
    out = {}
    if not isinstance(ctree, dict):
        return out
    for field, key in SUB_PREFAB_REFS.items():
        pointer = ctree.get(field)
        if isinstance(pointer, dict) and (themes._pptr(pointer) or (0, 0))[1]:
            out[key] = pointer
    return out


def _sub_bundle_ctx(ctx, go):
    """The walk context for a sub-prefab whose objects live in another bundle (the shop's cost view and bond row).

    The prefab's children, Images and materials are all pointers inside *that* file, so they must be read against its
    own object table, not the theme pack's (`ctx['objects']`) — otherwise every child resolves to nothing and the
    sub-prefab comes out as a one-node shell. The accumulators (`materials` / `files` / `ext_sprites` / `dest` / `book`)
    stay shared, so what the walk writes still lands in the theme pack.
    """
    owner = getattr(go, 'assets_file', None)
    if owner is None:
        return ctx
    return {
        **ctx,
        'serialized': owner,
        'objects': dict(getattr(owner, 'objects', None) or {}),
        # this file's own sprites are foreign to the theme bundle, but they are content of the theme's card
        'export_local_sprites': True,
        'sprite_prefix': SUB_SPRITE_PREFIX,
    }


def _gameobject_of(pointer, ctx):
    """A PPtr to either a GameObject or a component on one → the GameObject object.

    A component reached across bundles (`m_FileID != 0`, e.g. the controller's `_costPrefab`) carries a `m_GameObject`
    with file id 0 that belongs to *its own* SerializedFile, not to the card's — so it is read from that file's object
    table instead of the card's, which would miss it and record a false unresolved pointer.
    """
    obj = _deref(pointer, ctx)
    if obj is None:
        return None
    if obj.type.name == 'GameObject':
        return obj
    try:
        tree = obj.read_typetree()
    except Exception:
        return None
    inner = tree.get('m_GameObject') if isinstance(tree, dict) else None
    if not isinstance(inner, dict):
        return None
    file_id, path_id = themes._pptr(inner)
    if not path_id:
        return None
    if file_id == 0:
        assets = getattr(obj, 'assets_file', None)
        local = getattr(assets, 'objects', None) or {}
        target = local.get(path_id)
        if target is not None and target.type.name == 'GameObject':
            return target
    return _deref(inner, ctx)


def _unity_events(ctree, ref, ctx):
    """`m_PersistentCalls` of every UnityEvent field on a component: what the prefab wires to which method."""
    events = []
    for key, value in ctree.items():
        if not isinstance(value, dict) or 'm_PersistentCalls' not in value:
            continue
        calls = value['m_PersistentCalls']
        targets = (calls or {}).get('m_Calls') if isinstance(calls, dict) else None
        target = key[2:] if key.startswith('m_') else key
        entries = []
        for call in targets or []:
            if not isinstance(call, dict):
                continue
            hit = ref(call.get('m_Target'))
            args = call.get('m_Arguments') if isinstance(call.get('m_Arguments'), dict) else {}
            entries.append({
                'target': hit,
                'method': call.get('m_MethodName'),
                'mode': call.get('m_Mode'),
                'intArg': args.get('m_IntArgument'),
                'stringArg': args.get('m_StringArgument'),
            })
        if entries:
            events.append({'event': target, 'calls': entries})
    return events


def _walk_gameobject(go, ctx, depth, parent_path):
    """GameObject → PNode. Same shape as prefabs.json plus depth and path.

    This build serializes `UnityEngine.UI.Image` / `RawImage` / `Text` as MonoBehaviours, so a graphic is recognised
    by its fields, not by its type name.
    """
    if go is None:
        return None
    if ctx.get('seen') is None:
        ctx['seen'] = set()
    if go.path_id in ctx['seen']:
        return None
    tree = _typetree(go)
    if not isinstance(tree, dict):
        return None
    ctx['seen'].add(go.path_id)
    ctx['node_count'] += 1
    name = tree.get('m_Name') or ''
    path = f'{parent_path}/{name}' if parent_path else name
    node = {'name': name, 'path': path, 'depth': depth}
    if not tree.get('m_IsActive', True):
        node['active'] = False
    ctx['nodes'][go.path_id] = node

    def ref(pointer):
        return themes._ref_to(pointer, ctx['objects'], ctx)

    name_of = _name_of(ctx)

    transform = None
    for kind, component_tree, component_object in themes._components(tree, ctx['objects']):
        if kind in ('RectTransform', 'Transform') and transform is None:
            transform = component_tree
            continue
        if themes._is_canvas_group(kind, component_tree) and 'alpha' not in node:
            node['alpha'] = themes.num(component_tree.get('m_Alpha'))
            continue
        if kind == 'Animation' or (isinstance(component_tree, dict) and 'm_Animations' in component_tree
                                   and kind != 'MonoBehaviour'):
            clips = themes._clip_names(component_tree, ctx['objects'])
            if clips:
                node['clips'] = clips
                if component_tree.get('m_PlayAutomatically'):
                    auto = name_of(component_tree.get('m_Animation'))
                    if auto:
                        node['autoClip'] = auto
            continue
        if kind == 'Animator':
            controller = _deref(component_tree.get('m_Controller'), ctx)
            if controller is not None:
                node['animator'] = (_typetree(controller) or {}).get('m_Name')
            continue
        if kind == 'ParticleSystem':
            record = _particle(component_object, ctx, path)
            if record is not None:
                node['fx'] = 1
                node['fxId'] = len(ctx['particles'])
                ctx['particles'].append(record)
            continue
        if kind == 'ParticleSystemRenderer':
            node['fx'] = 1
            continue
        if 'image' not in node and 'raw' not in node:
            image = _image(component_tree, ctx)
            if image:
                node['image'] = image
                continue
            raw = _raw(component_tree, ctx)
            if raw:
                node['raw'] = raw
                continue
        if 'text' not in node:
            text = themes._text_info(component_tree, ctx['objects'])
            if text:
                node['text'] = text
                continue
        if kind == 'MonoBehaviour' and isinstance(component_tree, dict):
            script_id = _script_class(component_tree.get('m_Script'), ctx)
            themes._ui_component(node, component_tree, themes._pptr(component_tree.get('m_Script'))[1], ref, name_of)
            # everything the model above did NOT turn into a first-class field: the serialized fields themselves, the
            # UnityEvent wiring, and the two things the controller reads out of the prefab (its level-style table and the
            # cost view prefab). Without these a renderer has to guess what drives a layer.
            cls = (ctx['scripts'].get(str(script_id)) or {}).get('class') if script_id else None
            fields = _digest(component_tree, ref, ctx)
            if cls and fields:
                node.setdefault('components', []).append({'class': cls, 'fields': fields})
            # A SoftMask is a draw-time effect, not a script field the model consumes: its picture and channel
            # weights become the `mask.soft` record `buildRecords` samples for this node's whole subtree.
            if cls == 'SoftMask':
                soft = _soft_mask(component_tree, ctx)
                if soft:
                    node['mask'] = {**(node.get('mask') or {}), 'soft': soft}
            events = _unity_events(component_tree, ref, ctx)
            if events:
                node.setdefault('events', []).extend(events)
            if isinstance(component_tree.get('_chessLevelStyles'), list):
                rows = []
                for item in component_tree['_chessLevelStyles']:
                    if not isinstance(item, dict):
                        continue
                    color = _color(item.get('decoColor'))
                    tier, frame = ref(item.get('tierObj')), ref(item.get('frameObj'))
                    rows.append({
                        'levelState': int(item.get('levelState') or 0),
                        # the sub-prefab roots live outside this prefab tree, so they are named, not id-ed
                        'tierObj': _gameobject_name_of(item.get('tierObj'), ctx),
                        'frameObj': _gameobject_name_of(item.get('frameObj'), ctx),
                        'tierObjNode': tier,
                        'frameObjNode': frame,
                        'decoColor': _rgba_hex(color) if color else None,
                    })
                if rows:
                    node['levelStyles'] = rows
            # the controller's `_costPrefab` and the bond list's `_viewPrefab`: prefabs instantiated into this card but
            # serialized in `[uc]autochessbattle.ab` (walked in `build` against that file's own object table)
            for key, pointer in _prefab_refs_of(component_tree).items():
                node.setdefault('prefabRefs', {})[key] = pointer
    if transform is not None:
        if 'm_SizeDelta' in transform or 'm_AnchorMin' in transform:
            node['rect'] = {
                'anchors': {'min': themes._vec2(transform.get('m_AnchorMin')),
                            'max': themes._vec2(transform.get('m_AnchorMax'))},
                'pivot': themes._vec2(transform.get('m_Pivot')),
                'sizeDelta': themes._vec2(transform.get('m_SizeDelta')),
                'anchoredPosition': themes._vec2(transform.get('m_AnchoredPosition')),
            }
        scale = transform.get('m_LocalScale')
        if isinstance(scale, dict):
            node['scale'] = [themes.num(scale.get(axis, 1)) for axis in ('x', 'y', 'z')]
        rotation = uic.rotation_z(transform.get('m_LocalRotation'))
        if rotation:
            node['rot'] = rotation
        children = []
        for child in themes._child_gameobjects(transform, ctx['objects']):
            built = _walk_gameobject(child, ctx, depth + 1, path)
            if built:
                children.append(built)
        if children:
            node['children'] = children
    font = node.pop('_font', None)
    if font and 'text' in node and not node['text'].get('font'):
        node['text']['font'] = font
    if 'layout' in node and not node['layout'].get('axis'):
        node['layout']['axis'] = uic.guess_axis([child.get('rect') for child in node.get('children') or []])
    return node


def _shaders(ctx):
    """One record per shader the card's materials use; each material links to its record.

    The record is per shader, never per material: ten materials share three shaders, and the property table, the
    pass state and the uniform list are identical for every material that uses one. The record (compiled / properties
    / subShaders) is kept in card.json for reference; the client draws from the material records instead
    (public/js/ui/shop/prefab.js), and no code reads `card.shaders`. No porting page is written into the theme pack,
    so no `shaders/*.md` is listed in data/local-assets.json or ships in the packages.
    """
    shaders = {}
    for name, (obj, cab) in sorted(ctx['shader_objects'].items()):
        tree = _typetree(obj)
        if not isinstance(tree, dict):
            continue
        record = card_shader.record(tree, name=name, cab=cab)
        shaders[name] = record
    return shaders


def _local_clips(serialized):
    """name → typetree for this bundle's own AnimationClips (an injected dependency is not this theme)."""
    out = {}
    for obj in (getattr(serialized, 'objects', None) or {}).values():
        if getattr(obj, 'type', None) is None or obj.type.name != 'AnimationClip':
            continue
        tree = _typetree(obj)
        clip_name = (tree or {}).get('m_Name')
        if clip_name and clip_name not in out:
            out[clip_name] = tree
    return out


def _prefab_index(containers, objects):
    """stem (lower) → [(key, gameobject, container path)], from the container paths captured before injection."""
    found = {}
    for path, pointer in containers.items():
        if not str(path).lower().endswith('.prefab'):
            continue
        try:
            go = pointer.deref()
        except Exception:  # noqa: BLE001
            continue
        if go is None:
            continue
        if go.type.name != 'GameObject':
            tree = _typetree(go) or {}
            root_file, root_id = themes._pptr(tree.get('m_RootGameObject'))
            if root_file or not root_id:
                continue
            go = objects.get(root_id)
            if go is None:
                continue
        key = themes.prefab_key(path)
        found.setdefault(key.split('/')[-1].lower(), []).append((key, go, str(path)))
    return found


def build(bundle, group, dest, book, index=None, version=None, log=print):
    """Write `<dest>/card.json` and the pictures it names. Returns (document, written files)."""
    import unity_deps

    dest = Path(dest)
    deps = unity_deps.Deps(index or {}, log=log)
    env, _bundle_file, serialized = deps.load(bundle, attach=False)
    if serialized is None:
        raise RuntimeError(f'no SerializedFile in {Path(bundle).name}')
    containers = dict(env.container)
    objects = dict(getattr(serialized, 'objects', None) or {})
    asset_path = {(id(serialized), pointer.m_PathID): path for path, pointer in containers.items()}
    deps.attach(env)
    ctx = {
        'serialized': serialized, 'objects': objects, 'book': book, 'dest': dest, 'asset_path': asset_path,
        'materials': {}, 'particles': [], 'files': set(), 'unresolved': [], 'scripts': {}, 'shader_objects': {},
        'nodes': {}, 'refs': set(), 'node_count': 0, 'seen': None, 'ext_sprites': {}, 'ext_used': set(),
        'tex_files': {},
    }
    prefabs = _prefab_index(containers, objects)
    clips_by_name = _local_clips(serialized)

    hit = themes.match_prefab(prefabs, CARD_PREFAB)
    if hit is None:
        raise RuntimeError(f'no {CARD_PREFAB} in {Path(bundle).name}')
    card = _prefab_doc(hit[1], ctx, hit[0], hit[2], clips_by_name)
    subs = {}
    for name, prefab_path in SUB_PREFABS:
        sub_hit = themes.match_prefab(prefabs, prefab_path)
        if sub_hit is None:
            continue
        subs[name] = _prefab_doc(sub_hit[1], ctx, sub_hit[0], sub_hit[2], clips_by_name)
        log(f'  card: {name}: {subs[name]["nodeCount"]} nodes, {len(subs[name]["clips"])} clips, '
            f'{len(subs[name]["materials"])} materials, {len(subs[name]["particles"])} particles')

    # The prefabs the card instantiates from another bundle: the controller's `_costPrefab` (into `_costHolder`) and the
    # bond list's `SimpleLayoutContent._viewPrefab` (one row per bond). Their objects live in
    # `StreamingAssets/AB/Windows/ui/autochess/[uc]autochessbattle.ab`, so each is walked against that file's own object
    # table (`_sub_bundle_ctx`); without it every child pointer resolves to nothing and the sub-prefab is a one-node
    # shell.
    prefab_refs = {}
    def _find_prefab_ref(node):
        for key, pointer in (node.get('prefabRefs') or {}).items():
            if isinstance(pointer, dict):
                prefab_refs.setdefault(key, pointer)
        for child in node.get('children') or []:
            _find_prefab_ref(child)
    _find_prefab_ref(card['root'])
    for sub_key, ref_key, key, prefab_path in SUB_PREFAB_DOCS:
        pointer = prefab_refs.get(ref_key)
        if pointer is None:
            continue
        go = _gameobject_of(pointer, ctx)
        if go is None or go.type.name != 'GameObject':
            log(f'  card: the {sub_key} prefab could not be reached (kept out of `sub`)')
            continue
        subs[sub_key] = _prefab_doc(go, _sub_bundle_ctx(ctx, go), key, prefab_path, clips_by_name)
        log(f'  card: {sub_key}: {subs[sub_key]["nodeCount"]} nodes, '
            f'{len(subs[sub_key]["materials"])} materials')
    document = {
        'spCard': SP_CARD,
        'id': group.rsplit('/', 1)[-1],
        'group': group,
        'version': version,
        'prefab': hit[2],
        'nodeCount': card['nodeCount'],
        'size': card.get('size'),
        'root': card['root'],
        'ids': card['ids'],
        'roles': card['roles'],
        'runtime': card['runtime'],
        'scripts': {key: record for key, record in sorted(ctx['scripts'].items(), key=lambda pair: int(pair[0]))
                    if record},
        'materials': card['materials'],
        'clips': card['clips'],
        'particles': card['particles'],
        'sub': subs,
        'driver': _driver(card['root'], subs),
        'shaders': _shaders(ctx),
        'assets': sorted(ctx['files']),
        'unresolved': ctx['unresolved'] + deps.unresolved,
    }
    dest.mkdir(parents=True, exist_ok=True)
    (dest / 'card.json').write_text(json.dumps(document, ensure_ascii=False, separators=(',', ':')) + '\n',
                                    encoding='utf-8')
    log(f'  card.json: {document["nodeCount"]} nodes, {len(document["materials"])} materials, '
        f'{len(document["clips"])} clips, {len(document["particles"])} particles, {len(subs)} sub-prefabs')
    return document, sorted(ctx['files'])
