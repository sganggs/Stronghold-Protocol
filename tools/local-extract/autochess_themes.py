"""Official 卫戍协议 in-match UI themes (AUTOCHESS_SKIN) → spTheme 1 packs.

Opt-in, like the battle effects: a plain extract.py run does not touch them, and themes/ is not in
expected_local_groups. Run:

  extract.py --only theme --themes <backup-or-ab-root> --out <scratch> --manifest <scratch>/local-assets.json
  extract.py --only theme/<id>     one of ac_n_initial, ac_n_iron, ac_s_closur

Reads the theme bundles, the outer thumbnails and the voice packs from --themes. --game is only for a
dependency the backup does not carry. Writes <out>/themes/<id>/{theme.json,layout.json,sprites,voice,spine}.

theme.json is the pack the interface-theme reader loads. layout.json is the prefab tree (RectTransform,
Image, Text, CanvasGroup, animation clip names) plus the chess-frame / level-icon / shop-level hubs, so a
later HUD pass can rebuild the shop, countdown, ready button and banners without opening Unity files.

[ASSUMED] A prefab slot's image is the main background or frame sprite (pick_main_sprite), not every
sprite in the prefab. [ASSUMED] ac_s_closur has no skinSoundPreviewDict; its CN clip names match
ac_n_iron, so the same voiceId → placeType rows are used. [ASSUMED] Voice files are MP3 quality 4, the
same local choice as versions.export_audio, not the ogg name in the pack example. Japanese clips are
extracted under voice/jp/ and are not listed in theme.json, so one trigger does not play both languages.
[ASSUMED] When UnityPy returns only the tight mesh, the raster is padded back to the sprite rect
using textureRectOffset (bottom-left), so a button file matches the rect the prefab displays.
[ASSUMED] shop_main is omitted unless the shop prefab has a plate at least 480×150 that is not a
shadow, a deco strip, or the end-card character: the named shop sprites are that ~200px card.
[ASSUMED] The funds-card portrait is the unfolded shop image named char / avater_img / avatar_img,
else the first UI Spine in the theme bundle (not the board trap).
"""
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

THEME_IDS = ('ac_n_initial', 'ac_n_iron', 'ac_s_closur')
DEFAULT_THEME = 'ac_n_initial'
THEME_SUB = 'themes'
DATA_VERSION = '79.2.0'
AUTHOR = 'Hypergryph (official)'
SP_THEME = 1

COLOR_KEYS = (
    'garrisonIconColor1', 'garrisonIconColor2', 'garrisonIconColor3',
    'bondColor', 'bondIconColor', 'chessNameColor',
    'saleColor1', 'saleColor2', 'destroyColor1', 'destroyColor2',
    'countdownHintColor', 'obIconColor', 'skinDarkColor', 'skinLightColor',
)

# skinEffectPreviewDict effect number → theme.json banners key.
EFFECT_BANNER = {
    9: 'gameStart', 4: 'rest', 5: 'perfect', 1: 'coop', 2: 'effectChoose',
    3: 'battleEnd', 7: 'perfectStreak', 6: 'finalAssault', 8: 'bossDamage',
}
BANNER_KEYS = (
    'gameStart', 'rest', 'perfect', 'coop', 'effectChoose', 'battleEnd',
    'perfectStreak', 'finalAssault', 'bossDamage',
)
# Banner → (skin_config slot, child name to search, or None for the whole prefab).
BANNER_SLOT = {
    'gameStart': ('game_start', None),
    'rest': ('round_start', None),
    'perfect': ('round_result', 'panel_perfect'),
    'coop': ('help_battle', None),
    'effectChoose': ('effect_choose_self_select', None),
    'battleEnd': ('round_result', 'panel_miss'),
    'perfectStreak': ('win_streak', None),
    'finalAssault': ('hud_player_info', 'group_boss'),
    'bossDamage': ('boss_damage', None),
}

# Sprite-name hints, earliest first. A match is a substring of the sprite name (not the node
# name: iron's digit plate is a node named img_back). An earlier hint outranks a later one.
# Bare "countdown" is not a hint: it is the word label, and it is also a substring of the
# round-start plate round_countdown_bg.
SLOT_SPRITE_HINTS = {
    'countdown': ('img_back', 'img_bg', 'img_single'),
    'countdown_effectchoose': ('img_back', 'img_bg', 'img_single'),
    'countdown_outer': ('img_back', 'img_bg', 'img_single'),
    'prep_ready': ('ready_bg', 'ready_frame', 'btn_ready'),
    'shop_main': ('bg_open', 'btn_big_close', 'bg_shop'),
    'game_start': ('goal_bg',),
    'gameStart': ('goal_bg',),
    'help_battle': ('round_bg',),
    'coop': ('round_bg',),
    'round_start': ('round_bg',),
    'rest': ('round_bg',),
    'round_result': ('bg_all', 'round_bg'),
    'perfect': ('bg_all',),
    'battleEnd': ('bg_miss', 'round_bg'),
    'finalAssault': ('frame_mid_boss', 'boss_window_back_expand', 'boss_bg'),
    'bossDamage': ('player_damage_frame01', 'damage_fx_frame', 'player_damage_frame'),
    'perfectStreak': ('win_streak',),
    'win_streak': ('win_streak',),
    'effectChoose': ('bg_circle',),
    'effect_choose_self_select': ('bg_circle',),
    'hud_player_info': ('board_main', 'bg_board', 'bg_1', 'player_bg'),
    'boss_damage': ('player_damage_frame01', 'damage_fx_frame', 'player_damage_frame'),
}

DECO_TOKENS = frozenset({
    'trans', 'glow', 'line', 'shadow', 'blank', 'arrow', 'tile', 'light',
    'emoji', 'dec', 'matte', 'lock', 'icon',
})
FRAME_TOKENS = frozenset({'bg', 'frame', 'base'})
IMAGE_TYPES = {0: 'simple', 1: 'sliced', 2: 'tiled', 3: 'filled'}
THEME_KEYS = (
    'spTheme', 'id', 'name', 'author', 'version', 'description',
    'thumbnail', 'preview', 'colors', 'images', 'banners', 'voice',
)
TRIGGER_ORDER = (
    'AUTOCHESS_GAME_START', 'AUTOCHESS_REST_NO_HP_LOSS', 'AUTOCHESS_REST_HP_LOSS',
    'AUTOCHESS_REST_BOSS', 'AUTOCHESS_REST_HIDDEN_BOSS', 'AUTOCHESS_SAME_OPERATOR',
    'AUTOCHESS_BUY_OPERATOR_LOW', 'AUTOCHESS_BUY_OPERATOR_HIGH', 'AUTOCHESS_SHOP_UPGRADE',
    'AUTOCHESS_COUNTDOWN', 'AUTOCHESS_MERGE_TRIPLE', 'AUTOCHESS_ALLIANCE_LEVEL',
    'AUTOCHESS_FREEZE',
)
HEX_COLOR = re.compile(r'^#[0-9A-F]{6}([0-9A-F]{2})?$')
PIN_RE = re.compile(r"default:\s*'([0-9a-f]{40})'")
VERSION_RE = re.compile(r'CN data (\d+\.\d+\.\d+)')
SAFE = re.compile(r'[^A-Za-z0-9_.\-\[\]]+')


def num(value):
    """3 decimal places; whole numbers stay ints so layout JSON does not write 132.0."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    rounded = round(float(value), 3)
    if abs(rounded - round(rounded)) < 1e-9:
        return int(round(rounded))
    return rounded


def safe_stem(name):
    return SAFE.sub('_', str(name)).strip('._')[:120] or 'unnamed'


def _tokens(text):
    return set(re.split(r'[^a-z0-9]+', (text or '').lower())) - {''}


def border_slice(border):
    """Unity sprite border (x=left, y=bottom, z=right, w=top) → CSS 9-slice [top, right, bottom, left].

    None when every side is ~0 (the sprite is not a 9-slice).
    """
    if border is None:
        return None
    if isinstance(border, dict):
        left, bottom, right, top = (border.get('x', 0), border.get('y', 0), border.get('z', 0), border.get('w', 0))
    else:
        left, bottom, right, top = border[0], border[1], border[2], border[3]
    parts = [float(top or 0), float(right or 0), float(bottom or 0), float(left or 0)]
    if all(abs(part) < 0.001 for part in parts):
        return None
    return [num(part) for part in parts]


def asset_theme(path):
    """Theme id named by an official asset path, else None."""
    if not path:
        return None
    low = str(path).replace('\\', '/').lower()
    for theme_id in THEME_IDS:
        if theme_id in low:
            return theme_id
    return None


def normalize_hex(value):
    """#RRGGBB or #RRGGBBAA, uppercased. None when it is not a hex colour."""
    if not isinstance(value, str):
        return None
    text = value.strip().upper()
    if not HEX_COLOR.fullmatch(text):
        return None
    return text


def color_hex(color):
    """Unity 0–1 RGBA → #RRGGBB, or #RRGGBBAA when alpha is not opaque."""
    if not isinstance(color, dict):
        return None

    def channel(key, default):
        try:
            value = float(color.get(key, default))
        except (TypeError, ValueError):
            value = default
        if value < 0:
            value = 0.0
        if value > 1:
            value = 1.0
        return int(round(value * 255))

    red, green, blue, alpha = channel('r', 0), channel('g', 0), channel('b', 0), channel('a', 1)
    if alpha >= 255:
        return f'#{red:02X}{green:02X}{blue:02X}'
    return f'#{red:02X}{green:02X}{blue:02X}{alpha:02X}'


def colors_of(row):
    """The 14 skinColorDataDict keys, in pack order. Drops autochessSkinId and unknown keys."""
    out = {}
    for key in COLOR_KEYS:
        hexed = normalize_hex((row or {}).get(key))
        if hexed:
            out[key] = hexed
    return out


def parse_skin_config(doc):
    """skin_config JSON → {slot: entry}. Accepts a dict or a JSON string."""
    if isinstance(doc, str):
        doc = json.loads(doc)
    if not isinstance(doc, dict):
        raise ValueError('skin_config must be an object')
    out = {}
    for key, val in doc.items():
        if isinstance(val, dict):
            out[str(key)] = val
    return out


def slot_signature(slot):
    """Comparable payload of a text-only slot (size, pos, colour, fontSize). None when it names an asset."""
    if not isinstance(slot, dict) or slot.get('prefab') or slot.get('sprite'):
        return None
    sig = {}
    for key in ('size', 'pos', 'color', 'fontSize'):
        if key not in slot:
            continue
        val = slot[key]
        if key == 'color':
            sig[key] = normalize_hex(val) or val
        elif isinstance(val, dict):
            sig[key] = {part: num(val[part]) for part in sorted(val)}
        else:
            sig[key] = num(val) if isinstance(val, (int, float)) and not isinstance(val, bool) else val
    return sig


def slot_restyled(theme_id, slot, baseline_slot=None):
    """True when this theme supplies the slot's look.

    An asset path that names another theme is borrowed and left out of theme.json. A path that names
    no theme is this bundle's [ASSUMED]. A text-only slot (count colour, group tip) is a restyle when
    it differs from the default theme; the default theme's own text-only slots are restyles.
    """
    if not isinstance(slot, dict):
        return False
    path = slot.get('prefab') or slot.get('sprite')
    if path:
        owner = asset_theme(path)
        if owner is None:
            return True
        return owner == theme_id
    if theme_id == DEFAULT_THEME:
        return True
    if baseline_slot is None:
        return True
    return slot_signature(slot) != slot_signature(baseline_slot)


def banner_key(effect_id):
    """effct_initial_9 → gameStart. None when the effect number is not one of the nine banners."""
    match = re.search(r'(\d+)$', str(effect_id or ''))
    if not match:
        return None
    return EFFECT_BANNER.get(int(match.group(1)))


def _hint_rank(node, hints):
    """Index of the earliest hint found in the sprite name. len(hints) when none match.

    The node name is ignored. A child can be named after a plate (img_back) while showing a
    different sprite (count_num_back).
    """
    sprite = (node.get('sprite') or '').lower()
    for index, hint in enumerate(hints):
        if hint and hint in sprite:
            return index
    return len(hints)


def pick_main_sprite(nodes, hints=()):
    """The sprite that carries a prefab's look.

    [ASSUMED] Skip external and empty sprites. When a hint is a substring of a sprite name, stay
    in that pool, and an earlier hint outranks a later one (the named plate beats a larger sibling
    state). Then prefer
    a node named bg/frame/base, then a sliced sprite, then the largest node, then the largest
    texture. Decorative tokens (glow, arrow, light, …) lose to a plain frame.
    """
    pool = []
    for node in nodes or []:
        if not node or node.get('external') or not node.get('sprite'):
            continue
        pool.append(node)
    if not pool:
        return None
    hinted = [node for node in pool if hints and _hint_rank(node, hints) < len(hints)]
    use = hinted or pool

    def score(node):
        name = node.get('name') or ''
        sprite = node.get('sprite') or ''
        tokens = _tokens(name) | _tokens(sprite)
        deco = 1 if tokens & DECO_TOKENS else 0
        rank = _hint_rank(node, hints) if hinted else 0
        exact = 0 if name.lower() in FRAME_TOKENS else 1
        frame = 0 if tokens & FRAME_TOKENS else 1
        sliced = 0 if node.get('sliced') else 1
        area = (node.get('nodeW') or 0) * (node.get('nodeH') or 0)
        pixels = (node.get('w') or 0) * (node.get('h') or 0)
        return (deco, rank, exact, frame, sliced, -area, -pixels, sprite.lower())

    return min(use, key=score)


def slot_image_nodes(slot_name, tree):
    """Images considered for a skin_config slot.

    [ASSUMED] hud_player_info is the normal bar. Boss-state chrome lives under group_boss and is
    the finalAssault banner, so those nodes are not candidates for the player-info slot.
    """
    nodes = image_nodes(tree)
    if slot_name != 'hud_player_info':
        return nodes
    return [node for node in nodes if 'group_boss' not in (node.get('path') or '').lower().split('/')]


def image_nodes(node, path=''):
    """Flat local images of a layout tree: name, path, sprite, pixel size, node size, slice."""
    if not isinstance(node, dict):
        return []
    here = f"{path}/{node.get('name') or ''}" if path else (node.get('name') or '')
    out = []
    image = node.get('image')
    if isinstance(image, dict) and image.get('sprite') and not image.get('external'):
        size = ((node.get('rect') or {}).get('sizeDelta') or [0, 0])
        out.append({
            'name': node.get('name') or '',
            'path': here,
            'sprite': image.get('sprite'),
            'w': image.get('w') or 0,
            'h': image.get('h') or 0,
            'nodeW': size[0] or 0,
            'nodeH': size[1] or 0,
            'sliced': image.get('type') == 'sliced',
            'slice': image.get('slice'),
            'external': False,
        })
    for child in node.get('children') or []:
        out.extend(image_nodes(child, here))
    return out


def find_named(node, name):
    """First descendant (or the node itself) whose GameObject name matches, case-insensitively."""
    if not isinstance(node, dict):
        return None
    if (node.get('name') or '').lower() == (name or '').lower():
        return node
    for child in node.get('children') or []:
        found = find_named(child, name)
        if found is not None:
            return found
    return None


def image_ref(rel, slice_):
    """'sprites/x.webp', or {src, slice} when the sprite border is a 9-slice."""
    if not rel:
        return None
    if slice_:
        return {'src': rel, 'slice': list(slice_)}
    return rel


FRAME_HUB_SLOTS = ('chess_frame_normal', 'chess_frame_level_five', 'chess_frame_level_six')
LEVEL_ICON_SLOTS = tuple(f'chess_level_icon_{i}' for i in range(1, 7))
SHOP_LEVEL_SLOTS = tuple(f'shop_level_{i}' for i in range(1, 7))
# chess_level_icon_0 exists on ac_n_initial. Our chips are tiers 1–6, so 0 is not a slot.
# shop_level_text_hub (lv_1, upgrade_lv_*) is the upgrade caption, not the level card.
HUB_SLOTS = {
    'chess_frame_hub': FRAME_HUB_SLOTS,
    'chess_level_icon_hub': LEVEL_ICON_SLOTS,
    'player_detail_shop_level_hub': SHOP_LEVEL_SLOTS,
}
CHAR_NODE_NAMES = frozenset({'char', 'avater_img', 'avatar_img'})
# A plate this small is the folded end card or a deco strip, not the shop row.
SHOP_PLATE_MIN = (480, 150)
SHOP_PLATE_SKIP = ('shadow', 'deco', 'char', 'particle', 'lightning', 'fold')


def hub_image_map(hubs, resolve):
    """Hub row key → image slot, when resolve(sprite) returns a theme image ref.

    resolve(sprite_name) → ref or None. Icon 0 and the shop-level text hub are not copied.
    """
    out = {}
    for hub_name, slots in HUB_SLOTS.items():
        rows = (hubs or {}).get(hub_name) or []
        by_key = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            key = str(row.get('key') or '')
            sprite = row.get('sprite') or key
            if key and sprite:
                by_key[key] = sprite
        for slot in slots:
            sprite = by_key.get(slot)
            if not sprite:
                continue
            ref = resolve(sprite)
            if ref:
                out[slot] = ref
    return out


def shop_row_plate(tree):
    """The shop-row background, or None.

    [ASSUMED] bg_open / btn_big_close are the folded end card (~200px). A row plate is at least
    480×150 and is not a shadow, deco strip, character, or particle.
    """
    best = None
    best_area = 0
    for node in image_nodes(tree):
        blob = ' '.join((
            str(node.get('path') or ''),
            str(node.get('sprite') or ''),
            str(node.get('name') or ''),
        )).lower()
        if any(token in blob for token in SHOP_PLATE_SKIP):
            continue
        width = node.get('nodeW') or 0
        height = node.get('nodeH') or 0
        if width < SHOP_PLATE_MIN[0] or height < SHOP_PLATE_MIN[1]:
            continue
        area = width * height
        if area > best_area:
            best = node
            best_area = area
    return best


def settle_shop_main(images, shop_tree, resolve):
    """Keep shop_main only when a real row plate exists. Returns that node, or None."""
    plate = shop_row_plate(shop_tree)
    if plate is None:
        images.pop('shop_main', None)
        return None
    ref = resolve(plate.get('sprite'), (plate.get('w'), plate.get('h')))
    if ref:
        images['shop_main'] = ref
    else:
        images.pop('shop_main', None)
    return plate


def shop_character(shop_tree, ui_spines, resolve, voice_anims=None):
    """theme.json character: the funds-card portrait, or the UI Spine when there is no portrait.

    Banner avater_img nodes are not considered: pass the shop prefab only. A voice animation that
    the skeleton does not contain is dropped.
    """
    named = []
    for node in image_nodes(shop_tree):
        if (node.get('name') or '').lower() not in CHAR_NODE_NAMES:
            continue
        sprite = (node.get('sprite') or '').lower()
        if any(token in sprite for token in ('grey', 'deco', 'shadow')):
            continue
        named.append(node)

    def rank(node):
        path = (node.get('path') or '').lower()
        unfolded = 0 if ('state_unfold' in path or 'group_bg' in path) else 1
        area = (node.get('w') or 0) * (node.get('h') or 0)
        return (unfolded, -area)

    if named:
        best = min(named, key=rank)
        ref = resolve(best.get('sprite'), (best.get('w'), best.get('h')))
        if ref:
            return {'image': ref}

    for item in ui_spines or []:
        files = item.get('files') or []
        skel = next((rel for rel in files if str(rel).endswith(('.skel', '.json'))), None)
        atlas = next((rel for rel in files if str(rel).endswith('.atlas')), None)
        textures = [rel for rel in files if str(rel).endswith('.png')]
        if not skel or not atlas or not textures:
            continue
        anim_list = list(item.get('animations') or [])
        if 'Idle' in anim_list:
            idle = 'Idle'
        elif 'Default' in anim_list:
            idle = 'Default'
        elif anim_list:
            idle = anim_list[0]
        else:
            idle = None
        out = {'spine': {'skel': skel, 'atlas': atlas, 'textures': textures}}
        anims = {}
        if idle:
            anims['idle'] = idle
        raw = voice_anims if voice_anims is not None else item.get('voiceAnims')
        voice = {}
        known = set(anim_list)
        if isinstance(raw, dict):
            for key, name in raw.items():
                if not isinstance(key, str) or not isinstance(name, str):
                    continue
                if known and name not in known:
                    continue
                voice[key.lower()] = name
        if voice:
            anims['voice'] = voice
        if anims:
            out['anims'] = anims
        return out
    return None


def character_ok(value):
    """True when an optional character object is an image or a spine, not both."""
    if not isinstance(value, dict):
        return False
    keys = set(value) - {'anims'}
    anims = value.get('anims', None)
    if anims is not None and not isinstance(anims, dict):
        return False
    if keys == {'image'}:
        image = value['image']
        if isinstance(image, str) and image:
            return True
        return (
            isinstance(image, dict)
            and isinstance(image.get('src'), str)
            and image['src']
            and set(image) <= {'src', 'slice'}
        )
    if keys != {'spine'}:
        return False
    spine = value['spine']
    if not isinstance(spine, dict):
        return False
    textures = spine.get('textures')
    return (
        isinstance(spine.get('skel'), str) and spine['skel'].endswith(('.skel', '.json'))
        and isinstance(spine.get('atlas'), str) and spine['atlas'].endswith('.atlas')
        and isinstance(textures, list) and bool(textures)
        and all(isinstance(tex, str) and tex for tex in textures)
    )


def voice_rows_for(theme_id, sound_dict):
    """(rows, assumed). closur borrows iron's voiceId → placeType when it has no preview rows.

    [ASSUMED] The clip names match (CN_001–CN_014, CN_017–CN_021) and closur publishes no
    skinSoundPreviewDict of its own.
    """
    rows = list((sound_dict or {}).get(theme_id) or [])
    if rows:
        return rows, False
    if theme_id == 'ac_s_closur':
        borrowed = list((sound_dict or {}).get('ac_n_iron') or [])
        return borrowed, bool(borrowed)
    return [], False


def voice_groups(rows, present_clips=None):
    """placeType → ['voice/cn_001.mp3', …] in sortId order. A clip not in present_clips is skipped.

    present_clips is a set of lower-case voice ids, or None to keep every row.
    """
    grouped = {}
    ordered = sorted(rows or [], key=lambda row: ((row or {}).get('sortId') or 0, (row or {}).get('voiceId') or ''))
    for row in ordered:
        if not isinstance(row, dict):
            continue
        voice_id = str(row.get('voiceId') or '')
        place = row.get('placeType')
        if not voice_id or not place:
            continue
        if present_clips is not None and voice_id.lower() not in present_clips:
            continue
        rel = f'voice/{voice_id.lower()}.mp3'
        bucket = grouped.setdefault(place, [])
        if rel not in bucket:
            bucket.append(rel)
    ranked = [key for key in TRIGGER_ORDER if key in grouped]
    ranked.extend(key for key in grouped if key not in ranked)
    return {key: grouped[key] for key in ranked}


def build_theme(meta, colors, images, banners, voice):
    """spTheme 1 object. Keys are exactly the pack's, in the documented order."""
    banner_out = {}
    for key in BANNER_KEYS:
        if key in (banners or {}):
            banner_out[key] = banners[key]
    return {
        'spTheme': SP_THEME,
        'id': meta['id'],
        'name': meta.get('name') or meta['id'],
        'author': AUTHOR,
        'version': meta.get('version') or DATA_VERSION,
        'description': meta.get('description') or '',
        'thumbnail': 'thumb.webp',
        'preview': 'preview.webp',
        'colors': {key: (colors or {})[key] for key in COLOR_KEYS if key in (colors or {})},
        'images': images or {},
        'banners': banner_out,
        'voice': voice or {},
    }


def theme_errors(doc):
    """Schema problems. Empty when the pack matches spTheme 1. Extra keys fail."""
    errors = []
    if not isinstance(doc, dict):
        return ['not an object']
    extra = set(doc) - set(THEME_KEYS) - {'character'}
    missing = set(THEME_KEYS) - set(doc)
    if extra:
        errors.append('extra keys: ' + ','.join(sorted(extra)))
    if 'character' in doc and not character_ok(doc.get('character')):
        errors.append('character')
    if missing:
        errors.append('missing keys: ' + ','.join(sorted(missing)))
    if doc.get('spTheme') != SP_THEME:
        errors.append('spTheme')
    colors = doc.get('colors')
    if not isinstance(colors, dict) or set(colors) != set(COLOR_KEYS) or any(not isinstance(v, str) or not HEX_COLOR.fullmatch(v) for v in colors.values()):
        errors.append('colors')
    images = doc.get('images')
    if not isinstance(images, dict):
        errors.append('images')
    else:
        for value in images.values():
            if isinstance(value, str):
                continue
            if not isinstance(value, dict) or set(value) != {'src', 'slice'}:
                errors.append('image ref')
                continue
            if not isinstance(value.get('slice'), list) or len(value['slice']) != 4:
                errors.append('slice')
    banners = doc.get('banners')
    if not isinstance(banners, dict) or any(key not in BANNER_KEYS for key in banners):
        errors.append('banners')
    elif isinstance(banners, dict):
        for value in banners.values():
            if isinstance(value, str):
                continue
            if not isinstance(value, dict) or set(value) != {'src', 'slice'}:
                errors.append('banner ref')
    if not isinstance(doc.get('voice'), dict):
        errors.append('voice')
    return errors


def selected_ids(only):
    """Theme ids for --only. A full extract (no prefix) returns none.

    'theme' and 'themes' select all three. 'theme/<id>' or 'themes/<id>' selects one. Any other
    prefix selects none, so --only ui/common does not extract themes.
    """
    if not only:
        return []
    chosen = []
    for raw in only:
        prefix = str(raw).strip().strip('/').lower()
        if prefix in ('theme', 'themes'):
            return list(THEME_IDS)
        for head in ('theme/', 'themes/'):
            if prefix.startswith(head):
                theme_id = prefix[len(head):].split('/')[0]
                if theme_id in THEME_IDS and theme_id not in chosen:
                    chosen.append(theme_id)
    return chosen


def client_data_version(repo_root):
    """Data version named by the 规程 profile comment, else DATA_VERSION."""
    path = Path(repo_root) / 'tools/versions/act3autochess-v3_1.mjs'
    try:
        text = path.read_text(encoding='utf-8')
    except OSError:
        return DATA_VERSION
    match = VERSION_RE.search(text)
    return match.group(1) if match else DATA_VERSION


def regulation_pin(repo_root):
    path = Path(repo_root) / 'tools/versions/act3autochess-v3_1.mjs'
    text = path.read_text(encoding='utf-8')
    match = PIN_RE.search(text)
    if not match:
        raise RuntimeError('regulation data pin missing from act3autochess-v3_1.mjs')
    return match.group(1)


def load_autochess_data(repo_root):
    """autoChessData of the pinned activity table, or (None, reason)."""
    try:
        pin = regulation_pin(repo_root)
    except (OSError, RuntimeError) as err:
        return None, str(err)
    path = Path(repo_root) / '.cache' / f'gamedata@{pin}' / 'excel' / 'activity_table.json'
    if not path.is_file():
        return None, f'missing activity table for pin {pin}'
    try:
        doc = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as err:
        return None, f'activity table unreadable: {err}'
    data = doc.get('autoChessData') if isinstance(doc, dict) else None
    if not isinstance(data, dict) or 'skinDataDict' not in data:
        return None, 'autoChessData.skinDataDict missing'
    return data, None


# --- Unity export (imported only when a theme run executes) ---------------------------------------------------------

def _pptr(value):
    if isinstance(value, dict):
        return int(value.get('m_FileID') or 0), int(value.get('m_PathID') or 0)
    if value is None:
        return 0, 0
    file_id = int(getattr(value, 'm_FileID', 0) or 0)
    path_id = int(getattr(value, 'path_id', 0) or getattr(value, 'm_PathID', 0) or 0)
    return file_id, path_id


def _vec2(value):
    if not isinstance(value, dict):
        return [0, 0]
    return [num(value.get('x', 0)), num(value.get('y', 0))]


def _components(go_tree, objects):
    out = []
    for entry in go_tree.get('m_Component') or []:
        pointer = entry.get('component') if isinstance(entry, dict) and 'component' in entry else entry
        file_id, path_id = _pptr(pointer)
        if file_id or not path_id:
            continue
        obj = objects.get(path_id)
        if obj is None:
            continue
        try:
            tree = obj.read_typetree()
        except Exception:
            continue
        out.append((obj.type.name, tree, obj))
    return out


def _child_gameobjects(transform_tree, objects):
    kids = []
    for child in transform_tree.get('m_Children') or []:
        file_id, path_id = _pptr(child)
        if file_id or not path_id:
            continue
        obj = objects.get(path_id)
        if obj is None:
            continue
        try:
            tree = obj.read_typetree()
        except Exception:
            continue
        gfile, gpath = _pptr(tree.get('m_GameObject'))
        if gfile or not gpath:
            continue
        go = objects.get(gpath)
        if go is not None:
            kids.append(go)
    return kids


def _sprite_fields(obj):
    sprite = obj.read()
    border = getattr(sprite, 'm_Border', None)
    rect = getattr(sprite, 'm_Rect', None)
    info = {'sprite': sprite.m_Name, 'external': False}
    if border is not None:
        sliced = border_slice((border.x, border.y, border.z, border.w))
        if sliced:
            info['slice'] = sliced
    if rect is not None:
        info['w'] = num(rect.width)
        info['h'] = num(rect.height)
    return info


def _image_info(tree, objects):
    if not isinstance(tree, dict) or 'm_Sprite' not in tree or 'm_Type' not in tree:
        return None
    try:
        kind = IMAGE_TYPES.get(int(tree.get('m_Type') or 0), 'simple')
    except (TypeError, ValueError):
        kind = 'simple'
    info = {'type': kind, 'color': color_hex(tree.get('m_Color'))}
    if kind == 'filled':
        info['fillAmount'] = num(tree.get('m_FillAmount'))
        info['fillMethod'] = tree.get('m_FillMethod')
    file_id, path_id = _pptr(tree.get('m_Sprite'))
    if file_id:
        info['external'] = True
        info['sprite'] = None
        return info
    if not path_id:
        info['sprite'] = None
        return info
    obj = objects.get(path_id)
    if obj is None or obj.type.name != 'Sprite':
        info['sprite'] = None
        return info
    try:
        info.update(_sprite_fields(obj))
    except Exception:
        info['sprite'] = None
    return info


def _text_info(tree):
    if not isinstance(tree, dict):
        return None
    font = tree.get('m_FontData')
    if isinstance(font, dict) and 'm_FontSize' in font and 'm_Text' in tree:
        info = {'fontSize': num(font.get('m_FontSize')), 'color': color_hex(tree.get('m_Color'))}
        if font.get('m_BestFit'):
            info['bestFit'] = True
            info['minSize'] = num(font.get('m_MinSize'))
            info['maxSize'] = num(font.get('m_MaxSize'))
        text = tree.get('m_Text')
        if isinstance(text, str) and text and len(text) <= 80:
            info['text'] = text
        if tree.get('m_TextId'):
            info['textId'] = tree.get('m_TextId')
        return info
    if 'm_text' in tree and ('m_fontSize' in tree or 'm_fontAsset' in tree):
        info = {
            'fontSize': num(tree.get('m_fontSize')),
            'color': color_hex(tree.get('m_fontColor') or tree.get('m_color')),
            'tmp': True,
        }
        text = tree.get('m_text')
        if isinstance(text, str) and text and len(text) <= 80:
            info['text'] = text
        return info
    return None


def _clip_names(tree, objects):
    names = []
    for pointer in tree.get('m_Animations') or []:
        file_id, path_id = _pptr(pointer)
        if file_id or not path_id:
            continue
        obj = objects.get(path_id)
        if obj is None:
            continue
        try:
            name = obj.read().m_Name
        except Exception:
            try:
                name = obj.read_typetree().get('m_Name')
            except Exception:
                name = None
        if name and name not in names:
            names.append(name)
    return names


def _is_canvas_group(typ, tree):
    if typ == 'CanvasGroup':
        return True
    return isinstance(tree, dict) and 'm_Alpha' in tree and 'm_Interactable' in tree and 'm_BlocksRaycasts' in tree and 'm_Sprite' not in tree


def walk_gameobject(obj, objects, seen=None, depth=0):
    """GameObject → layout node. RectTransform children resolve through m_GameObject."""
    if seen is None:
        seen = set()
    if obj is None or depth > 48 or obj.path_id in seen:
        return None
    seen.add(obj.path_id)
    try:
        tree = obj.read_typetree()
    except Exception as err:
        return {'name': '?', 'error': str(err)}
    node = {'name': tree.get('m_Name') or ''}
    if not tree.get('m_IsActive', True):
        node['active'] = False
    transform = None
    for typ, ctree, cobj in _components(tree, objects):
        if typ in ('RectTransform', 'Transform') and transform is None:
            transform = ctree
            continue
        if _is_canvas_group(typ, ctree) and 'alpha' not in node:
            node['alpha'] = num(ctree.get('m_Alpha'))
            continue
        if typ == 'Animation' or (isinstance(ctree, dict) and 'm_Animations' in ctree and typ != 'MonoBehaviour'):
            clips = _clip_names(ctree, objects)
            if clips:
                node['clips'] = clips
            continue
        if typ == 'Animator':
            file_id, path_id = _pptr(ctree.get('m_Controller'))
            if path_id and not file_id:
                ctrl = objects.get(path_id)
                if ctrl is not None:
                    try:
                        node['animator'] = ctrl.read().m_Name
                    except Exception:
                        pass
            continue
        if 'image' not in node:
            image = _image_info(ctree, objects)
            if image:
                node['image'] = image
                continue
        if 'text' not in node:
            text = _text_info(ctree)
            if text:
                node['text'] = text
    kids = []
    if transform is not None:
        if 'm_SizeDelta' in transform or 'm_AnchorMin' in transform:
            node['rect'] = {
                'anchors': {'min': _vec2(transform.get('m_AnchorMin')), 'max': _vec2(transform.get('m_AnchorMax'))},
                'pivot': _vec2(transform.get('m_Pivot')),
                'sizeDelta': _vec2(transform.get('m_SizeDelta')),
                'anchoredPosition': _vec2(transform.get('m_AnchoredPosition')),
            }
        scale = transform.get('m_LocalScale')
        if isinstance(scale, dict) and any(abs(float(scale.get(axis, 1)) - 1) > 0.001 for axis in ('x', 'y', 'z')):
            node['scale'] = [num(scale.get('x', 1)), num(scale.get('y', 1)), num(scale.get('z', 1))]
        kids = _child_gameobjects(transform, objects)
    children = []
    for kid in kids:
        child = walk_gameobject(kid, objects, seen, depth + 1)
        if child:
            children.append(child)
    if children:
        node['children'] = children
    return node


def _text_asset(obj):
    raw = obj.read().m_Script
    if isinstance(raw, str):
        return raw.encode('utf-8', 'surrogateescape')
    return bytes(raw)


def text_named(env, name):
    wanted = {name, name + '.json'}
    for obj in env.objects:
        if obj.type.name != 'TextAsset':
            continue
        try:
            asset = obj.read()
        except Exception:
            continue
        if asset.m_Name in wanted:
            blob = _text_asset(obj)
            return blob.decode('utf-8', 'replace')
    return None


def _index_bundles(roots):
    """Lower-case relative path → file. The first root wins. Filename keys are stored only when unique."""
    found, names = {}, {}
    for root in roots:
        root = Path(root)
        if not root.exists():
            continue
        if root.is_file():
            found.setdefault(root.name.lower(), root)
            continue
        for dirpath, _dirnames, filenames in os.walk(root):
            for filename in filenames:
                if not filename.lower().endswith('.ab'):
                    continue
                path = Path(dirpath) / filename
                rel = path.relative_to(root).as_posix().lower()
                if rel not in found:
                    found[rel] = path
                    names.setdefault(filename.lower(), []).append(path)
    for filename, paths in names.items():
        if len(paths) == 1:
            found.setdefault(filename, paths[0])
    return found


def _find_ending(index, suffix):
    suffix = suffix.lower().lstrip('/')
    hits = sorted(rel for rel in index if '/' in rel and rel.endswith(suffix))
    return index[hits[0]] if hits else index.get(suffix)


def _load_env(path):
    import aklz4  # noqa: F401  (registers the LZ4AK decoder before UnityPy opens the bundle)
    import UnityPy
    env = UnityPy.load(str(path))
    return env, {obj.path_id: obj for obj in env.objects}


def _save_raster(image, dest_webp):
    """Lossless WebP. PNG only when WebP fails. Returns the file name written."""
    if image.mode != 'RGBA':
        image = image.convert('RGBA')
    dest_webp.parent.mkdir(parents=True, exist_ok=True)
    try:
        image.save(dest_webp, 'WEBP', lossless=True, quality=100, method=4, exact=True)
        return dest_webp.name
    except Exception:
        png = dest_webp.with_suffix('.png')
        image.save(png, 'PNG')
        return png.name


class SpriteBook:
    """Sprite name → extracted file, pixel size and 9-slice. Colliding names are all kept."""

    def __init__(self):
        self.by_name = {}

    def add(self, info):
        self.by_name.setdefault(info['name'].lower(), []).append(info)

    def resolve(self, official_or_name, size=None):
        if not official_or_name:
            return None
        stem = str(official_or_name).replace('\\', '/').split('/')[-1]
        stem = stem.lower().removesuffix('.png').removesuffix('.webp')
        hits = self.by_name.get(stem) or []
        if not hits:
            return None
        # Two different textures can share a name (iron has two bg_1 sprites). The prefab
        # node's rect picks the one the slot actually shows.
        if size is not None:
            width, height = size
            sized = [info for info in hits if info.get('w') == width and info.get('h') == height]
            if sized:
                hits = sized
        if len(hits) == 1:
            return hits[0]
        needle = str(official_or_name).replace('\\', '/').lower()
        for info in hits:
            container = info.get('container')
            if container and needle in str(container).lower():
                return info
        return hits[0]


def tight_origin(rect_w, rect_h, image_w, image_h, offset_x, offset_y):
    """Top-left of a tight sprite image inside its full rect. None when it does not fit.

    Unity's textureRectOffset is measured from the bottom-left of m_Rect. The decoded
    image is the tight mesh; the HUD sizes the node by m_Rect.
    """
    try:
        width, height = int(round(float(rect_w))), int(round(float(rect_h)))
        ox, oy = int(round(float(offset_x))), int(round(float(offset_y)))
        iw, ih = int(image_w), int(image_h)
    except (TypeError, ValueError):
        return None
    if width <= 0 or height <= 0 or iw <= 0 or ih <= 0:
        return None
    top = height - oy - ih
    if ox < 0 or top < 0 or ox + iw > width or top + ih > height:
        return None
    return width, height, ox, top


def _sprite_raster(sprite):
    """sprite.image padded back to m_Rect when UnityPy returned only the tight mesh."""
    image = sprite.image
    rect = getattr(sprite, 'm_Rect', None)
    if image is None or rect is None:
        return image
    if image.size == (int(round(rect.width)), int(round(rect.height))):
        return image
    offset = getattr(getattr(sprite, 'm_RD', None), 'textureRectOffset', None)
    if offset is None:
        return image
    placed = tight_origin(rect.width, rect.height, image.size[0], image.size[1], offset.x, offset.y)
    if placed is None:
        return image
    from PIL import Image
    width, height, ox, top = placed
    canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    canvas.paste(image.convert('RGBA'), (ox, top))
    return canvas


def export_sprites(env, dest_dir):
    """Every Sprite in the bundle → sprites/<name>.webp. Returns a SpriteBook."""
    book = SpriteBook()
    used = set()
    dest_dir.mkdir(parents=True, exist_ok=True)
    for obj in env.objects:
        if obj.type.name != 'Sprite':
            continue
        try:
            sprite = obj.read()
            image = _sprite_raster(sprite)
        except Exception:
            continue
        if image is None or not sprite.m_Name:
            continue
        stem = safe_stem(sprite.m_Name)
        name = stem
        number = 2
        while name.lower() in used:
            name = f'{stem}_{number}'
            number += 1
        used.add(name.lower())
        written = _save_raster(image, dest_dir / f'{name}.webp')
        border = getattr(sprite, 'm_Border', None)
        rect = getattr(sprite, 'm_Rect', None)
        info = {
            'name': sprite.m_Name,
            'file': f'sprites/{written}',
            'slice': border_slice((border.x, border.y, border.z, border.w)) if border is not None else None,
            'w': num(rect.width) if rect is not None else None,
            'h': num(rect.height) if rect is not None else None,
        }
        book.add(info)
    return book


def index_sprite_facts(env):
    """Sprite names and borders without writing files (borrowed themes looked up for the report)."""
    book = SpriteBook()
    for obj in env.objects:
        if obj.type.name != 'Sprite':
            continue
        try:
            sprite = obj.read()
        except Exception:
            continue
        if not sprite.m_Name:
            continue
        border = getattr(sprite, 'm_Border', None)
        rect = getattr(sprite, 'm_Rect', None)
        book.add({
            'name': sprite.m_Name,
            'file': None,
            'slice': border_slice((border.x, border.y, border.z, border.w)) if border is not None else None,
            'w': num(rect.width) if rect is not None else None,
            'h': num(rect.height) if rect is not None else None,
        })
    return book


def _container_gameobject(ref, objects):
    path_id = getattr(ref, 'path_id', None)
    obj = objects.get(path_id) if path_id is not None else None
    if obj is not None and obj.type.name == 'GameObject':
        return obj
    try:
        tree = obj.read_typetree() if obj is not None else None
    except Exception:
        tree = None
    if isinstance(tree, dict) and 'm_RootGameObject' in tree:
        _file, root_id = _pptr(tree.get('m_RootGameObject'))
        root = objects.get(root_id)
        if root is not None and root.type.name == 'GameObject':
            return root
    if obj is not None and isinstance(tree, dict) and 'm_Component' in tree:
        return obj
    return None


def prefab_key(container_path):
    low = str(container_path).replace('\\', '/')
    marker = low.lower().rfind('/prefabs/')
    rel = low[marker + len('/prefabs/'):] if marker >= 0 else low.split('/')[-1]
    if rel.lower().endswith('.prefab'):
        rel = rel[:-len('.prefab')]
    return rel


def index_prefabs(env, objects):
    """stem → [(key, gameobject, container path)]."""
    found = {}
    for path, ref in env.container.items():
        if not str(path).lower().endswith('.prefab'):
            continue
        go = _container_gameobject(ref, objects)
        if go is None:
            continue
        key = prefab_key(path)
        found.setdefault(key.split('/')[-1].lower(), []).append((key, go, str(path)))
    return found


def match_prefab(index, official_path):
    stem = str(official_path or '').replace('\\', '/').split('/')[-1].lower()
    stem = stem.removesuffix('.prefab')
    hits = index.get(stem) or []
    if not hits:
        return None
    if len(hits) == 1:
        return hits[0]
    needle = str(official_path).replace('\\', '/').lower()
    parent = needle.split('/')[-2] if '/' in needle else ''
    for hit in hits:
        if parent and parent in hit[2].lower():
            return hit
    return hits[0]


def read_hubs(env):
    hubs = {}
    for obj in env.objects:
        if obj.type.name != 'MonoBehaviour':
            continue
        try:
            tree = obj.read_typetree()
        except Exception:
            continue
        name = tree.get('m_Name')
        keys, values = tree.get('_keys'), tree.get('_values')
        if not name or 'hub' not in str(name).lower():
            continue
        if not isinstance(keys, list) or not isinstance(values, list):
            continue
        rows = []
        for key, val in zip(keys, values):
            row = {'key': key}
            if isinstance(val, str):
                row['sprite'] = val.replace('\\', '/').split('/')[-1]
                row['path'] = val
            rows.append(row)
        if rows:
            hubs[name] = rows
    return hubs


def read_fonts(env):
    fonts = []
    for obj in env.objects:
        if obj.type.name != 'Font':
            continue
        try:
            tree = obj.read_typetree()
        except Exception:
            continue
        _file, path_id = _pptr(tree.get('m_Texture'))
        rects = tree.get('m_CharacterRects') or []
        fonts.append({
            'name': tree.get('m_Name'),
            'characters': len(rects) if isinstance(rects, list) else 0,
            'embedded': bool(path_id) and not _file,
        })
    return fonts


def export_text_spines(env, dest_dir):
    """Plain skeleton JSON + atlas + page PNG already handled by this extractor's Spine writer shape.

    The page stays PNG because the atlas names it. Returns records; writes nothing when the pair is
    not a text skeleton (a mesh-only trap is left for the report).
    """
    texts, textures = {}, {}
    for obj in env.objects:
        try:
            if obj.type.name == 'TextAsset':
                asset = obj.read()
                texts.setdefault(asset.m_Name, _text_asset(obj))
            elif obj.type.name == 'Texture2D':
                tex = obj.read()
                textures[tex.m_Name.lower()] = tex
        except Exception:
            continue
    by_stem = {}
    for name, blob in texts.items():
        low = name.lower()
        if low.endswith('.atlas'):
            by_stem.setdefault(low[:-len('.atlas')], {})['atlas'] = blob
        else:
            by_stem.setdefault(low, {})['skel'] = blob
    written = []
    for stem, parts in sorted(by_stem.items()):
        skel, atlas_blob = parts.get('skel'), parts.get('atlas')
        if not skel or not atlas_blob or not skel.lstrip().startswith(b'{'):
            continue
        try:
            doc = json.loads(skel.decode('utf-8-sig'))
        except (UnicodeDecodeError, ValueError):
            continue
        if not isinstance(doc, dict) or 'skeleton' not in doc or 'animations' not in doc:
            continue
        atlas = atlas_blob.decode('utf-8', 'replace')
        pages = [line.strip() for line in atlas.splitlines() if line.endswith('.png') and not line[:1].isspace()]
        if not pages:
            continue
        page_tex = []
        missing = False
        for page in pages:
            tex = textures.get(page.lower().removesuffix('.png')) or textures.get(Path(page).stem.lower())
            if tex is None:
                missing = True
                break
            page_tex.append((page, tex))
        if missing:
            continue
        dest_dir.mkdir(parents=True, exist_ok=True)
        # The skeleton is Spine JSON (a TextAsset): name it .json so pixi-spine parses it as JSON (a .skel is read as
        # binary and fails with "Unsupported version of spine model").
        (dest_dir / f'{stem}.json').write_bytes(skel)
        (dest_dir / f'{stem}.atlas').write_bytes(atlas_blob)
        for page, tex in page_tex:
            tex.image.save(dest_dir / page)
        written.append({
            'name': stem,
            'spine': (doc.get('skeleton') or {}).get('spine'),
            'animations': sorted((doc.get('animations') or {}).keys()),
            'pages': pages,
            'files': [f'spine/{stem}.json', f'spine/{stem}.atlas', *[f'spine/{page}' for page in pages]],
        })
    return written


def export_voice(bundle, dest_dir, rel_prefix):
    """AudioClips → <rel_prefix><clip>.mp3. Returns {clip_lower: relative path}."""
    import aklz4  # noqa: F401
    import UnityPy
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise RuntimeError('ffmpeg is not installed')
    env = UnityPy.load(str(bundle))
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = {}
    for obj in env.objects:
        if obj.type.name != 'AudioClip':
            continue
        clip = obj.read()
        samples = clip.samples
        if len(samples) != 1:
            continue
        stem = safe_stem(clip.m_Name).lower()
        target = dest_dir / f'{stem}.mp3'
        # [ASSUMED] MP3 quality 4 matches versions.export_audio; the pack example writes .ogg.
        subprocess.run(
            [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', 'pipe:0',
             '-codec:a', 'libmp3lame', '-q:a', '4', str(target)],
            input=next(iter(samples.values())), check=True, timeout=60,
        )
        out[clip.m_Name.lower()] = f'{rel_prefix}{stem}.mp3'
    return out


def _save_named_sprite(env, sprite_name, dest_webp):
    if env is None or not sprite_name:
        return False
    for obj in env.objects:
        if obj.type.name != 'Sprite':
            continue
        try:
            sprite = obj.read()
        except Exception:
            continue
        if sprite.m_Name != sprite_name:
            continue
        try:
            _save_raster(sprite.image, dest_webp)
        except Exception:
            return False
        return True
    return False


def _list_file(manifest, group, rel, **extra):
    entry = {'path': f'/assets/local/{group}/{rel}'}
    entry.update(extra)
    manifest.setdefault(group, {})[rel] = entry


def _slot_meta(slot):
    meta = {}
    for key in ('prefab', 'sprite', 'color', 'fontSize'):
        if key in slot and slot[key] not in (None, ''):
            meta[key] = normalize_hex(slot[key]) if key == 'color' else slot[key]
    for key in ('size', 'pos'):
        if isinstance(slot.get(key), dict):
            meta[key] = {part: num(slot[key].get(part, 0)) for part in ('x', 'y')}
    return meta


def _ref_for(book, sprite_name, size=None):
    info = book.resolve(sprite_name, size) if book else None
    if not info or not info.get('file'):
        return None, info
    return image_ref(info['file'], info.get('slice')), info


def export_themes(themes_dirs, out_root, manifest, log, ids, repo_root, game_root=None):
    """Write the selected theme packs under out_root/themes. Returns the file count."""
    roots = [Path(p) for p in (themes_dirs or [])]
    index = _index_bundles(roots)
    tables, table_err = load_autochess_data(repo_root)
    if table_err:
        log(f'warn themes: {table_err}')
        tables = {}
    version = client_data_version(repo_root)
    skins = (tables or {}).get('skinDataDict') or {}
    colors = (tables or {}).get('skinColorDataDict') or {}
    sounds = (tables or {}).get('skinSoundPreviewDict') or {}
    anims = (tables or {}).get('skinVoiceAnimDict') or {}

    loaded = {}
    for theme_id in THEME_IDS:
        bundle = _find_ending(index, f'autochessvariantskin/[uc]{theme_id}.ab')
        if bundle is None:
            log(f'warn theme {theme_id}: bundle not under --themes')
            continue
        try:
            env, objects = _load_env(bundle)
        except Exception as err:
            log(f'FAIL load theme {theme_id}: {err}')
            continue
        raw = text_named(env, 'skin_config')
        if not raw:
            log(f'FAIL theme {theme_id}: skin_config missing')
            continue
        loaded[theme_id] = {
            'env': env, 'objects': objects, 'bundle': bundle,
            'config': parse_skin_config(raw),
            'effects': text_named(env, 'effect_preview_config'),
        }
    outer_path = _find_ending(index, 'ui/autochess/[uc]autochessouter.ab')
    outer_env = None
    if outer_path is not None:
        try:
            outer_env, _outer_objects = _load_env(outer_path)
        except Exception as err:
            log(f'warn outer thumbnails: {err}')

    out_root = Path(out_root)
    books = {}
    total = 0
    records = []
    for theme_id in ids:
        if theme_id not in loaded:
            log(f'skip theme {theme_id}: not loaded')
            continue
        try:
            count, record = _export_one(
                theme_id, loaded, books, outer_env, index, out_root, manifest, log,
                skins.get(theme_id) or {}, colors.get(theme_id) or {}, sounds, anims.get(theme_id) or {},
                version,
            )
        except Exception as err:
            log(f'FAIL theme {theme_id}: {err}')
            continue
        total += count
        records.append(record)
        log(f'theme {theme_id}: {count} files, {record["restyled"]} restyled slots, voice {record["voiceClips"]}')
    summary_dir = out_root / THEME_SUB
    summary_dir.mkdir(parents=True, exist_ok=True)
    (summary_dir / 'summary.json').write_text(
        json.dumps({'version': version, 'themes': records}, ensure_ascii=False, indent=2), encoding='utf-8')
    return total


def _owner_book(owner, loaded, books):
    if owner in books:
        return books[owner]
    if owner not in loaded:
        return None
    books[owner] = index_sprite_facts(loaded[owner]['env'])
    return books[owner]


def _export_one(theme_id, loaded, books, outer_env, index, out_root, manifest, log, skin, color_row, sounds, voice_anims, version):
    src = loaded[theme_id]
    env, objects, config = src['env'], src['objects'], src['config']
    group = f'{THEME_SUB}/{theme_id}'
    dest = out_root / THEME_SUB / theme_id
    book = export_sprites(env, dest / 'sprites')
    books[theme_id] = book
    for info in [hit for hits in book.by_name.values() for hit in hits]:
        if info.get('file'):
            _list_file(manifest, group, info['file'], kind='Sprite', w=info.get('w'), h=info.get('h'))

    baseline = (loaded.get(DEFAULT_THEME) or {}).get('config') or {}
    prefabs_index = index_prefabs(env, objects)
    prefab_trees = {}
    seen_walks = set()
    for _stem, hits in sorted(prefabs_index.items()):
        for key, go, _path in hits:
            if key in seen_walks:
                continue
            seen_walks.add(key)
            tree = walk_gameobject(go, objects)
            if tree:
                prefab_trees[key] = tree

    images, banners = {}, {}
    slot_rows = []
    slot_layout = {}
    for slot_name, slot in config.items():
        restyled = slot_restyled(theme_id, slot, baseline.get(slot_name))
        owner = asset_theme(slot.get('prefab') or slot.get('sprite'))
        borrowed = owner if owner and owner != theme_id else None
        meta = _slot_meta(slot)
        meta['restyled'] = restyled
        if borrowed:
            meta['borrowedFrom'] = borrowed
        main_info = None
        if slot.get('sprite'):
            look_book = book if restyled else _owner_book(owner, loaded, books)
            ref, main_info = _ref_for(look_book, slot.get('sprite'))
            if restyled and ref:
                images[slot_name] = ref
                meta['main'] = ref
        elif slot.get('prefab') and restyled:
            hit = match_prefab(prefabs_index, slot['prefab'])
            tree = prefab_trees.get(hit[0]) if hit else None
            if tree is not None:
                chosen = pick_main_sprite(slot_image_nodes(slot_name, tree), SLOT_SPRITE_HINTS.get(slot_name, ()))
                if chosen:
                    ref, main_info = _ref_for(book, chosen.get('sprite'), (chosen.get('w'), chosen.get('h')))
                    if ref:
                        images[slot_name] = ref
                        meta['main'] = ref
                        meta['mainSprite'] = chosen.get('sprite')
        elif slot.get('prefab') and borrowed:
            owner_src = loaded.get(borrowed)
            if owner_src:
                hit = match_prefab(index_prefabs(owner_src['env'], owner_src['objects']), slot['prefab'])
                tree = walk_gameobject(hit[1], owner_src['objects']) if hit else None
                chosen = pick_main_sprite(slot_image_nodes(slot_name, tree), SLOT_SPRITE_HINTS.get(slot_name, ())) if tree else None
                if chosen:
                    _ref, main_info = _ref_for(_owner_book(borrowed, loaded, books), chosen.get('sprite'), (chosen.get('w'), chosen.get('h')))
                    meta['mainSprite'] = chosen.get('sprite')
        slot_layout[slot_name] = meta
        slot_rows.append({
            'slot': slot_name,
            'restyled': restyled,
            'borrowedFrom': borrowed,
            'sprite': (main_info or {}).get('name') or meta.get('mainSprite') or (Path(slot['sprite']).name if slot.get('sprite') else None),
            'w': (main_info or {}).get('w'),
            'h': (main_info or {}).get('h'),
            'slice': (main_info or {}).get('slice'),
            'file': (main_info or {}).get('file') if restyled else None,
        })

    for banner, (slot_name, child_name) in BANNER_SLOT.items():
        slot = config.get(slot_name) or {}
        if not slot_restyled(theme_id, slot, baseline.get(slot_name)):
            continue
        hit = match_prefab(prefabs_index, slot.get('prefab') or '')
        tree = prefab_trees.get(hit[0]) if hit else None
        if tree is None:
            continue
        scope = find_named(tree, child_name) if child_name else tree
        if scope is None:
            log(f'  warn {theme_id} {banner}: no node {child_name}')
            continue
        chosen = pick_main_sprite(image_nodes(scope), SLOT_SPRITE_HINTS.get(banner, ()))
        if not chosen:
            continue
        ref, info = _ref_for(book, chosen.get('sprite'), (chosen.get('w'), chosen.get('h')))
        if ref:
            banners[banner] = ref
            slot_rows.append({
                'slot': f'banner:{banner}', 'restyled': True, 'borrowedFrom': None,
                'sprite': chosen.get('sprite'), 'w': (info or {}).get('w'), 'h': (info or {}).get('h'),
                'slice': (info or {}).get('slice'), 'file': (info or {}).get('file'),
            })

    rows, voice_assumed = voice_rows_for(theme_id, sounds)
    voice_files = {}
    if rows:
        voice_bundle = _find_ending(index, f'audio/autochess_skin_se/{theme_id}.ab')
        cn_bundle = _find_ending(index, f'voice_cn/{theme_id}.ab')
        jp_bundle = _find_ending(index, f'voice/{theme_id}.ab')
        # voice/ must not match voice_cn/. _find_ending requires the suffix at the end, and
        # voice_cn/… does not end with voice/….
        target = cn_bundle or voice_bundle
        if target is not None:
            try:
                voice_files = export_voice(target, dest / 'voice', 'voice/')
            except Exception as err:
                log(f'  warn {theme_id} voice: {err}')
        if jp_bundle is not None and jp_bundle != target:
            try:
                export_voice(jp_bundle, dest / 'voice' / 'jp', 'voice/jp/')
            except Exception as err:
                log(f'  warn {theme_id} jp voice: {err}')
    present = set(voice_files)
    voice = voice_groups(rows, present) if rows else {}
    for rel in voice_files.values():
        _list_file(manifest, group, rel, kind='AudioClip')
    jp_dir = dest / 'voice' / 'jp'
    if jp_dir.is_dir():
        for path in sorted(jp_dir.glob('*.mp3')):
            _list_file(manifest, group, f'voice/jp/{path.name}', kind='AudioClip')

    hubs = read_hubs(env)

    def resolve_ref(sprite, size=None):
        ref, _info = _ref_for(book, sprite, size)
        return ref

    images.update(hub_image_map(hubs, lambda sprite: resolve_ref(sprite)))
    shop_slot = config.get('shop_main') or {}
    shop_hit = match_prefab(prefabs_index, shop_slot.get('prefab') or '')
    shop_tree = prefab_trees.get(shop_hit[0]) if shop_hit else None
    plate = settle_shop_main(images, shop_tree, resolve_ref)
    if 'shop_main' not in images:
        for row in slot_rows:
            if row.get('slot') == 'shop_main':
                row['file'] = None
                row['omitted'] = 'no row plate'
        log(f'  {theme_id} shop_main omitted: no row plate')

    spines = export_text_spines(env, dest / 'spine')
    for spine in spines:
        if voice_anims:
            spine['voiceAnims'] = voice_anims
        for rel in spine['files']:
            kind = 'Texture2D' if rel.endswith('.png') else 'TextAsset'
            _list_file(manifest, group, rel, kind=kind)
    character = shop_character(shop_tree, spines, resolve_ref, voice_anims or None)

    skin_meta = {
        'id': theme_id,
        'name': skin.get('name') or theme_id,
        'description': skin.get('skinDesc') or '',
        'version': version,
    }
    theme = build_theme(skin_meta, colors_of(color_row), images, banners, voice)
    if character:
        theme['character'] = character
    problems = theme_errors(theme)
    if problems:
        log(f'  warn {theme_id} theme.json: {", ".join(problems)}')
    (dest / 'theme.json').write_text(json.dumps(theme, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    _list_file(manifest, group, 'theme.json', kind='TextAsset')

    files = {}
    thumb_id = skin.get('thumbnailPicId')
    preview_id = skin.get('previewPicId')
    background_id = skin.get('backgroundPreviewPicId')
    if _save_named_sprite(outer_env, thumb_id, dest / 'thumb.webp'):
        files['thumbnail'] = 'thumb.webp'
        _list_file(manifest, group, 'thumb.webp', kind='Sprite')
    else:
        log(f'  warn {theme_id}: thumbnail {thumb_id} missing')
    if _save_named_sprite(outer_env, preview_id, dest / 'preview.webp'):
        files['preview'] = 'preview.webp'
        _list_file(manifest, group, 'preview.webp', kind='Sprite')
    else:
        log(f'  warn {theme_id}: preview {preview_id} missing')
    if _save_named_sprite(outer_env, background_id, dest / 'background.webp'):
        files['background'] = 'background.webp'
        _list_file(manifest, group, 'background.webp', kind='Sprite')

    trap_id = skin.get('skinTrapId')
    board = None
    if trap_id:
        mentioned = [path for path in env.container if trap_id.lower() in path.lower()]
        board = {
            'id': trap_id,
            'extracted': False,
            'inThemeBundle': bool(mentioned),
            'clientChecked': False,
            'note': 'skinTrapId. The theme bundle does not contain this id. battleSkin.overwritePrefab is false and skinOrPrefabId is null in skin_table, and no bundle file in the theme backup is named for it. It is not a plain Spine beside the UI skeleton, so it is not extracted.',
        }

    effects = None
    if src.get('effects'):
        try:
            effects = json.loads(src['effects'])
        except ValueError:
            effects = None
    layout = {
        'spLayout': 1,
        'id': theme_id,
        'name': skin_meta['name'],
        'version': version,
        'voiceAssumed': voice_assumed,
        'slots': slot_layout,
        'prefabs': prefab_trees,
        'hubs': hubs,
        'fonts': read_fonts(env),
        'files': files,
        'spine': {'ui': [{k: v for k, v in spine.items() if k != 'files'} for spine in spines], 'board': board},
    }
    if effects is not None:
        layout['effectPreview'] = effects
    (dest / 'layout.json').write_text(json.dumps(layout, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    _list_file(manifest, group, 'layout.json', kind='TextAsset')

    file_count = 0
    byte_count = 0
    for dirpath, _dirs, filenames in os.walk(dest):
        for filename in filenames:
            file_count += 1
            byte_count += (Path(dirpath) / filename).stat().st_size
    record = {
        'id': theme_id,
        'name': skin_meta['name'],
        'description': skin_meta['description'],
        'bytes': byte_count,
        'files': file_count,
        'restyled': sum(1 for row in slot_rows if row['restyled'] and not str(row['slot']).startswith('banner:')),
        'colors': colors_of(color_row),
        'slots': slot_rows,
        'banners': {key: banners[key] for key in BANNER_KEYS if key in banners},
        'character': 'image' if isinstance(character, dict) and 'image' in character else ('spine' if character else None),
        'shopMain': 'shop_main' in theme.get('images', {}),
        'voice': {key: len(files) for key, files in voice.items()},
        'voiceAssumed': voice_assumed,
        'voiceClips': sum(len(files) for files in voice.values()),
        'spine': layout['spine'],
        'fonts': layout['fonts'],
        'hubs': {name: len(rows) for name, rows in layout['hubs'].items()},
        'hud': _hud_interest(prefab_trees),
    }
    return file_count, record


def _hud_interest(prefabs):
    """Nodes the HUD pass asked about: shop, level, funds, freeze/refresh, sell, countdown, ready."""
    needles = ('money', 'fund', 'frozen', 'freeze', 'refresh', 'level', 'ready', 'countdown', 'sell', 'shop')
    hits = []

    def walk(node, path):
        name = node.get('name') or ''
        here = f'{path}/{name}' if path else name
        low = name.lower()
        if any(needle in low for needle in needles):
            rect = node.get('rect') or {}
            image = node.get('image') or {}
            text = node.get('text') or {}
            hits.append({
                'path': here,
                'size': rect.get('sizeDelta'),
                'pos': rect.get('anchoredPosition'),
                'sprite': image.get('sprite'),
                'imageType': image.get('type'),
                'slice': image.get('slice'),
                'fontSize': text.get('fontSize'),
                'color': text.get('color') or image.get('color'),
                'clips': node.get('clips'),
            })
        for child in node.get('children') or []:
            walk(child, here)

    for key, node in prefabs.items():
        walk(node, key)
    return hits
