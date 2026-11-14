// Official in-match theme packs: pure rules only. No Unity bundle and no official art.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TOOL = path.join(ROOT, 'tools/local-extract');
const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);

function py(code) {
  const src = `import sys, json
sys.path.insert(0, ${JSON.stringify(TOOL)})
import autochess_themes as t
${code}`;
  const r = spawnSync(PY, ['-I', '-B', '-c', src], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const COLORS = {
  garrisonIconColor1: '#FFFFFF33', garrisonIconColor2: '#FFFFFF33', garrisonIconColor3: '#FFFFFF33',
  bondColor: '#B7B7B7', bondIconColor: '#031712', chessNameColor: '#FFFFFF',
  saleColor1: '#FFBA00', saleColor2: '#3A2D0A', destroyColor1: '#DC3B3B', destroyColor2: '#290808',
  countdownHintColor: '#FF0000', obIconColor: '#00FFC4', skinDarkColor: '#00FFC4', skinLightColor: '#00FFC4',
};

describe('autochess theme pack rules (no UnityPy)', { skip: !PY && 'no python3' }, () => {
  test('Unity border (left, bottom, right, top) becomes a 9-slice [top, right, bottom, left]', () => {
    const out = py(`print(json.dumps({
      'countdown': t.border_slice((132, 0, 40, 0)),
      'dict': t.border_slice({'x': 132, 'y': 0, 'z': 40, 'w': 0}),
      'zero': t.border_slice((0, 0, 0, 0)),
      'near': t.border_slice((0.0001, 0, 0, 0)),
      'frame': t.border_slice((20, 20, 20, 20)),
    }))`);
    assert.deepEqual(out.countdown, [0, 40, 0, 132]);
    assert.deepEqual(out.dict, [0, 40, 0, 132]);
    assert.equal(out.zero, null);
    assert.equal(out.near, null);
    assert.deepEqual(out.frame, [20, 20, 20, 20]);
  });

  test('a slot is restyled only when its asset belongs to that theme', () => {
    const out = py(`base = {'color': '#02140FFF', 'fontSize': 19, 'size': {'x': 23.708, 'y': 31.821}, 'pos': {'x': 11.854, 'y': 2.5894}}
same = {'color': '#02140fff', 'fontSize': 19, 'size': {'y': 31.821, 'x': 23.708}, 'pos': {'x': 11.854, 'y': 2.589}}
moved = {'size': {'x': 580, 'y': 97}, 'pos': {'x': -116, 'y': 0}}
origin = {'size': {'x': 580, 'y': 97}, 'pos': {'x': 0, 'y': 0}}
own = {'prefab': 'UI/AutoChess/AutoChessVariantSkin/[UC]ac_n_iron/Prefabs/panel_countdown'}
borrowed = {'prefab': 'UI/AutoChess/AutoChessVariantSkin/[UC]ac_n_initial/Prefabs/panel_countdown'}
print(json.dumps({
  'ironOwn': t.slot_restyled('ac_n_iron', own, borrowed),
  'ironBorrowed': t.slot_restyled('ac_n_iron', borrowed, borrowed),
  'initialOwn': t.slot_restyled('ac_n_initial', borrowed, None),
  'sameText': t.slot_restyled('ac_n_iron', same, base),
  'changedText': t.slot_restyled('ac_s_closur', {'color': '#000000FF', 'fontSize': 19}, base),
  'defaultText': t.slot_restyled('ac_n_initial', base, None),
  'movedTip': t.slot_restyled('ac_n_iron', moved, origin),
}))`);
    assert.equal(out.ironOwn, true);
    assert.equal(out.ironBorrowed, false);
    assert.equal(out.initialOwn, true);
    assert.equal(out.sameText, false);
    assert.equal(out.changedText, true);
    assert.equal(out.defaultText, true);
    assert.equal(out.movedTip, true);
  });

  test('banner numbers and voice triggers follow the official tables', () => {
    const out = py(`rows = [
  {'sortId': 2, 'voiceId': 'CN_002', 'placeType': 'AUTOCHESS_GAME_START'},
  {'sortId': 1, 'voiceId': 'CN_001', 'placeType': 'AUTOCHESS_GAME_START'},
  {'sortId': 16, 'voiceId': 'CN_018', 'placeType': 'AUTOCHESS_COUNTDOWN'},
  {'sortId': 19, 'voiceId': 'CN_099', 'placeType': 'AUTOCHESS_FREEZE'},
]
print(json.dumps({
  'start': t.banner_key('effct_initial_9'),
  'rest': t.banner_key('effct_iron_4'),
  'boss': t.banner_key('effct_closur_8'),
  'unknown': t.banner_key('effct_initial'),
  'empty': t.banner_key(''),
  'voice': t.voice_groups(rows, {'cn_001', 'cn_002', 'cn_018'}),
  'closur': t.voice_rows_for('ac_s_closur', {'ac_n_iron': rows})[1],
  'closurN': len(t.voice_rows_for('ac_s_closur', {'ac_n_iron': rows})[0]),
  'iron': t.voice_rows_for('ac_n_iron', {'ac_n_iron': rows})[1],
  'initial': t.voice_rows_for('ac_n_initial', {'ac_n_iron': rows}),
}))`);
    assert.equal(out.start, 'gameStart');
    assert.equal(out.rest, 'rest');
    assert.equal(out.boss, 'bossDamage');
    assert.equal(out.unknown, null);
    assert.equal(out.empty, null);
    assert.deepEqual(out.voice.AUTOCHESS_GAME_START, ['voice/cn_001.mp3', 'voice/cn_002.mp3']);
    assert.deepEqual(out.voice.AUTOCHESS_COUNTDOWN, ['voice/cn_018.mp3']);
    assert.equal(out.voice.AUTOCHESS_FREEZE, undefined);
    assert.equal(out.closur, true);
    assert.equal(out.closurN, 4);
    assert.equal(out.iron, false);
    assert.deepEqual(out.initial, [[], false]);
  });

  test('the main sprite is the background or frame, not a larger decoration', () => {
    const out = py(`nodes = [
  {'name': 'tile', 'sprite': 'goal_round_tile', 'nodeW': 800, 'nodeH': 400, 'w': 800, 'h': 400, 'sliced': False},
  {'name': 'bg', 'sprite': 'goal_bg', 'nodeW': 200, 'nodeH': 80, 'w': 1048, 'h': 296, 'sliced': False},
  {'name': 'glow', 'sprite': 'bg_glow', 'nodeW': 900, 'nodeH': 400, 'w': 900, 'h': 400, 'sliced': True},
]
shop = [
  {'name': 'lock', 'sprite': 'bg_lock', 'nodeW': 400, 'nodeH': 300, 'w': 400, 'h': 300, 'sliced': False},
  {'name': 'open', 'sprite': 'bg_open', 'nodeW': 380, 'nodeH': 280, 'w': 380, 'h': 280, 'sliced': True},
]
count = [
  {'name': 'desc', 'sprite': 'countdown', 'nodeW': 70, 'nodeH': 21, 'w': 70, 'h': 21, 'sliced': False},
  {'name': 'arrow', 'sprite': 'countdown_arrow', 'nodeW': 40, 'nodeH': 20, 'w': 40, 'h': 20, 'sliced': False},
  {'name': 'img_single', 'sprite': 'img_single', 'nodeW': 216, 'nodeH': 87, 'w': 216, 'h': 87, 'sliced': False},
  {'name': 'bg', 'sprite': 'round_countdown_bg', 'nodeW': 322, 'nodeH': 64, 'w': 322, 'h': 64, 'sliced': True, 'slice': [0, 40, 0, 132]},
]
print(json.dumps({
  'start': t.pick_main_sprite(nodes, t.SLOT_SPRITE_HINTS['game_start'])['sprite'],
  'shop': t.pick_main_sprite(shop, t.SLOT_SPRITE_HINTS['shop_main'])['sprite'],
  'count': t.pick_main_sprite(count, t.SLOT_SPRITE_HINTS['countdown'])['sprite'],
  'banner': t.pick_main_sprite(count, ('round_countdown',))['sprite'],
  'ref': t.image_ref('sprites/round_countdown_bg.webp', [0, 40, 0, 132]),
  'plain': t.image_ref('sprites/goal_bg.webp', None),
  'cfg': list(t.parse_skin_config('{"shop_main": {"prefab": "a"}, "skip": 1}').keys()),
}))`);
    assert.equal(out.start, 'goal_bg');
    assert.equal(out.shop, 'bg_open');
    assert.equal(out.count, 'img_single');
    assert.equal(out.banner, 'round_countdown_bg');
    assert.deepEqual(out.ref, { src: 'sprites/round_countdown_bg.webp', slice: [0, 40, 0, 132] });
    assert.equal(out.plain, 'sprites/goal_bg.webp');
    assert.deepEqual(out.cfg, ['shop_main']);
  });

  test('an earlier hint beats a larger sibling, and the HUD plate ignores the boss group', () => {
    const out = py(`ready = [
  {'name': 'bg', 'sprite': 'ready_bg', 'nodeW': 152, 'nodeH': 49, 'w': 48, 'h': 49, 'sliced': True},
  {'name': 'frame', 'sprite': 'ready_frame', 'nodeW': 161, 'nodeH': 57, 'w': 23, 'h': 20, 'sliced': True},
]
iron_ready = [
  {'name': 'bg', 'sprite': 'btn_ready', 'nodeW': 123, 'nodeH': 45, 'w': 123, 'h': 45, 'sliced': False},
  {'name': 'light', 'sprite': 'btn_ready_light', 'nodeW': 133, 'nodeH': 51, 'w': 133, 'h': 51, 'sliced': False},
  {'name': 'bg', 'sprite': 'btn_cancel', 'nodeW': 164, 'nodeH': 77, 'w': 164, 'h': 77, 'sliced': False},
  {'name': 'bg', 'sprite': 'player_bg', 'nodeW': 163, 'nodeH': 41, 'w': 163, 'h': 41, 'sliced': True},
]
iron_shop = [
  {'name': 'bg', 'sprite': 'btn_big_disable', 'nodeW': 226, 'nodeH': 207, 'w': 226, 'h': 207, 'sliced': False},
  {'name': 'bg', 'sprite': 'btn_big_close', 'nodeW': 186, 'nodeH': 207, 'w': 186, 'h': 207, 'sliced': False},
  {'name': 'deco_left', 'sprite': 'back_left', 'nodeW': 863, 'nodeH': 112, 'w': 863, 'h': 112, 'sliced': False},
]
iron_count = [
  {'name': 'bg_back', 'sprite': 'img_back', 'nodeW': 694, 'nodeH': 134, 'w': 694, 'h': 134, 'sliced': False},
  {'name': 'bg_1', 'sprite': 'img_bg_1', 'nodeW': 277, 'nodeH': 151, 'w': 277, 'h': 151, 'sliced': False},
  {'name': 'img_back', 'sprite': 'count_num_back', 'nodeW': 107, 'nodeH': 61, 'w': 107, 'h': 61, 'sliced': False},
  {'name': 'light_last', 'sprite': 'img_light_last', 'nodeW': 353, 'nodeH': 198, 'w': 349, 'h': 194, 'sliced': False},
]
closur_count = [
  {'name': 'bg', 'sprite': 'img_bg', 'nodeW': 240, 'nodeH': 178, 'w': 240, 'h': 178, 'sliced': False},
  {'name': 'img_single', 'sprite': 'img_tv_single', 'nodeW': 71, 'nodeH': 65, 'w': 71, 'h': 65, 'sliced': False},
]
effect = [node for node in iron_count if node['sprite'] != 'img_back']
iron_hud = {'name': 'group_hud', 'children': [
  {'name': 'bg_1', 'rect': {'sizeDelta': [446, 52]}, 'image': {'sprite': 'bg_1', 'w': 446, 'h': 52, 'type': 'simple'}},
  {'name': 'group_boss', 'children': [
    {'name': 'bg', 'rect': {'sizeDelta': [255, 53]}, 'image': {'sprite': 'boss_bg', 'w': 59, 'h': 53, 'type': 'sliced'}},
  ]},
]}
closur_hud = {'name': 'group_hud', 'children': [
  {'name': 'board', 'rect': {'sizeDelta': [656, 84]}, 'image': {'sprite': 'board_main', 'w': 656, 'h': 84, 'type': 'simple'}},
  {'name': 'shadow', 'rect': {'sizeDelta': [1156, 145]}, 'image': {'sprite': 'board_shadow', 'w': 636, 'h': 104, 'type': 'simple'}},
  {'name': 'group_boss', 'children': [
    {'name': 'bg', 'rect': {'sizeDelta': [0, 0]}, 'image': {'sprite': 'boss_window_back_expand', 'w': 332, 'h': 60, 'type': 'sliced'}},
  ]},
]}
book = t.SpriteBook()
book.add({'name': 'bg_1', 'file': 'sprites/bg_1.webp', 'w': 576, 'h': 305})
book.add({'name': 'bg_1', 'file': 'sprites/bg_1_2.webp', 'w': 446, 'h': 52})
print(json.dumps({
  'ready': t.pick_main_sprite(ready, t.SLOT_SPRITE_HINTS['prep_ready'])['sprite'],
  'ironReady': t.pick_main_sprite(iron_ready, t.SLOT_SPRITE_HINTS['prep_ready'])['sprite'],
  'ironShop': t.pick_main_sprite(iron_shop, t.SLOT_SPRITE_HINTS['shop_main'])['sprite'],
  'ironCount': t.pick_main_sprite(iron_count, t.SLOT_SPRITE_HINTS['countdown'])['sprite'],
  'effect': t.pick_main_sprite(effect, t.SLOT_SPRITE_HINTS['countdown_effectchoose'])['sprite'],
  'closurCount': t.pick_main_sprite(closur_count, t.SLOT_SPRITE_HINTS['countdown'])['sprite'],
  'ironHud': t.pick_main_sprite(t.slot_image_nodes('hud_player_info', iron_hud), t.SLOT_SPRITE_HINTS['hud_player_info'])['sprite'],
  'closurHud': t.pick_main_sprite(t.slot_image_nodes('hud_player_info', closur_hud), t.SLOT_SPRITE_HINTS['hud_player_info'])['sprite'],
  'bossKept': t.pick_main_sprite(t.image_nodes(closur_hud), t.SLOT_SPRITE_HINTS['finalAssault'])['sprite'],
  'dup': book.resolve('bg_1', (446, 52))['file'],
  'first': book.resolve('bg_1')['file'],
}))`)
    assert.equal(out.ready, 'ready_bg');
    assert.equal(out.ironReady, 'btn_ready');
    assert.equal(out.ironShop, 'btn_big_close');
    assert.equal(out.ironCount, 'img_back');
    assert.equal(out.effect, 'img_bg_1');
    assert.equal(out.closurCount, 'img_bg');
    assert.equal(out.ironHud, 'bg_1');
    assert.equal(out.closurHud, 'board_main');
    assert.equal(out.bossKept, 'boss_window_back_expand');
    assert.equal(out.dup, 'sprites/bg_1_2.webp');
    assert.equal(out.first, 'sprites/bg_1.webp');
  });

  test('a tight mesh is placed back inside the sprite rect from the bottom-left offset', () => {
    const out = py(`print(json.dumps({
  'ready': t.tight_origin(164, 77, 148, 59, 8.076, 11.076),
  'same': t.tight_origin(48, 49, 48, 49, 0, 0),
  'overflow': t.tight_origin(10, 10, 8, 8, 4, 1),
  'bad': t.tight_origin(None, 10, 1, 1, 0, 0),
}))`);
    assert.deepEqual(out.ready, [164, 77, 8, 7]);
    assert.deepEqual(out.same, [48, 49, 0, 0]);
    assert.equal(out.overflow, null);
    assert.equal(out.bad, null);
  });

  test('theme.json has exactly the spTheme 1 keys, 14 colours, and image refs', () => {
    const out = py(`colors = ${JSON.stringify(COLORS)}
doc = t.build_theme({'id': 'ac_n_iron', 'name': '乌萨斯齐心团', 'description': 'desc', 'version': '79.2.0'}, colors, {
  'shop_main': 'sprites/bg_open.webp',
  'countdown': {'src': 'sprites/round_countdown_bg.webp', 'slice': [0, 40, 0, 132]},
}, {'gameStart': 'sprites/goal_bg.webp'}, {'AUTOCHESS_GAME_START': ['voice/cn_001.mp3']})
extra = dict(doc)
extra['note'] = 'no'
short = dict(doc)
short['colors'] = {'bondColor': '#FFFFFF'}
print(json.dumps({
  'errors': t.theme_errors(doc),
  'keys': list(doc.keys()),
  'extra': t.theme_errors(extra),
  'short': t.theme_errors(short),
  'sp': doc['spTheme'],
  'author': doc['author'],
  'nColors': len(doc['colors']),
}))`);
    assert.deepEqual(out.errors, []);
    assert.deepEqual(out.keys, [
      'spTheme', 'id', 'name', 'author', 'version', 'description',
      'thumbnail', 'preview', 'colors', 'images', 'banners', 'voice',
    ]);
    assert.equal(out.sp, 1);
    assert.equal(out.author, 'Hypergryph (official)');
    assert.equal(out.nColors, 14);
    assert.ok(out.extra.some((line) => line.startsWith('extra keys')));
    assert.ok(out.short.includes('colors'));
  });

  test('hub slots, the funds character, and a shop row that is not the end card', () => {
    const out = py(`
def node(name, sprite, w, h, path):
    return {'name': name, 'path': path, 'sprite': sprite, 'w': w, 'h': h, 'nodeW': w, 'nodeH': h, 'sliced': False}
shop = {'name': 'panel_shop_main', 'children': [
    {'name': 'state_able', 'children': [
        {'name': 'btn_open', 'children': [
            {'name': 'bg', 'rect': {'sizeDelta': [195, 212]}, 'image': {'sprite': 'bg_open', 'w': 195, 'h': 212, 'type': 'simple'}},
            {'name': 'char', 'rect': {'sizeDelta': [127, 157]}, 'image': {'sprite': 'char', 'w': 127, 'h': 157, 'type': 'simple'}},
        ]},
    ]},
    {'name': 'state_unfold', 'children': [
        {'name': 'group_bg', 'children': [
            {'name': 'bg', 'rect': {'sizeDelta': [192, 213]}, 'image': {'sprite': 'bg_close', 'w': 192, 'h': 213, 'type': 'simple'}},
            {'name': 'char', 'rect': {'sizeDelta': [127, 157]}, 'image': {'sprite': 'char', 'w': 127, 'h': 157, 'type': 'simple'}},
            {'name': 'deco_left', 'rect': {'sizeDelta': [863, 112]}, 'image': {'sprite': 'back_left', 'w': 863, 'h': 112, 'type': 'simple'}},
            {'name': 'bg_shadow', 'rect': {'sizeDelta': [24, 351]}, 'image': {'sprite': 'shadow_total', 'w': 24, 'h': 351, 'type': 'simple'}},
        ]},
    ]},
]}
wide = {'name': 'panel', 'children': [
    {'name': 'plate', 'rect': {'sizeDelta': [900, 180]}, 'image': {'sprite': 'shop_plate', 'w': 900, 'h': 180, 'type': 'simple'}},
]}
hubs = {
    'chess_frame_hub': [
        {'key': 'chess_frame_normal', 'sprite': 'chess_frame_normal'},
        {'key': 'chess_frame_level_five', 'sprite': 'chess_frame_level_five'},
        {'key': 'chess_frame_level_six', 'sprite': 'chess_frame_level_six'},
    ],
    'chess_level_icon_hub': [{'key': f'chess_level_icon_{i}', 'sprite': f'chess_level_icon_{i}'} for i in range(0, 7)],
    'player_detail_shop_level_hub': [{'key': f'shop_level_{i}', 'sprite': f'shop_level_{i}'} for i in range(1, 7)],
    'shop_level_text_hub': [{'key': 'lv_1', 'sprite': 'lv_1'}],
}
def resolve(sprite, size=None):
    return f'sprites/{sprite}.webp'
images = {'shop_main': 'sprites/bg_open.webp'}
plate = t.settle_shop_main(images, shop, resolve)
images_wide = {}
wide_plate = t.settle_shop_main(images_wide, wide, resolve)
portrait = t.shop_character(shop, [], resolve)
spine = t.shop_character(None, [{
    'files': ['spine/trap.skel', 'spine/trap.atlas', 'spine/trap.png'],
    'animations': ['Default', 'Idle', 'Interact'],
    'voiceAnims': {'CN_001': 'Interact', 'CN_099': 'Missing'},
}], resolve, {'CN_001': 'Interact', 'CN_099': 'Missing'})
mapped = t.hub_image_map(hubs, lambda sprite: resolve(sprite))
char_doc = dict(t.build_theme({'id': 'ac_n_iron', 'name': 'n', 'description': 'd', 'version': '79.2.0'}, ${JSON.stringify(COLORS)}, {}, {}, {}))
char_doc['character'] = portrait
bad = dict(char_doc)
bad['character'] = {'image': 'a.webp', 'spine': {'skel': 's.skel'}}
print(json.dumps({
    'plate': plate,
    'shop': images.get('shop_main'),
    'wide': images_wide.get('shop_main'),
    'wideName': None if wide_plate is None else wide_plate.get('sprite'),
    'portrait': portrait,
    'spine': spine,
    'icon0': 'chess_level_icon_0' in mapped,
    'icon1': mapped.get('chess_level_icon_1'),
    'frame': mapped.get('chess_frame_level_five'),
    'level': mapped.get('shop_level_6'),
    'text': 'lv_1' in mapped or 'shop_level_text_hub' in mapped,
    'ok': t.theme_errors(char_doc),
    'bad': t.theme_errors(bad),
    'keys': 'character' in t.build_theme({'id': 'ac_n_iron', 'name': 'n', 'description': '', 'version': '1'}, ${JSON.stringify(COLORS)}, {}, {}, {}),
}))`);
    assert.equal(out.plate, null);
    assert.equal(out.shop, null);
    assert.equal(out.wide, 'sprites/shop_plate.webp');
    assert.equal(out.wideName, 'shop_plate');
    assert.equal(out.portrait.image, 'sprites/char.webp');
    assert.equal(out.spine.spine.skel, 'spine/trap.skel');
    assert.equal(out.spine.anims.idle, 'Idle');
    assert.deepEqual(out.spine.anims.voice, { cn_001: 'Interact' });
    assert.equal(out.icon0, false);
    assert.equal(out.icon1, 'sprites/chess_level_icon_1.webp');
    assert.equal(out.frame, 'sprites/chess_frame_level_five.webp');
    assert.equal(out.level, 'sprites/shop_level_6.webp');
    assert.equal(out.text, false);
    assert.deepEqual(out.ok, []);
    assert.ok(out.bad.includes('character'));
    assert.equal(out.keys, false);
  });

  test('--only theme is opt-in and does not join the expected local groups', () => {
    const out = py(`print(json.dumps({
  'full': t.selected_ids([]),
  'none': t.selected_ids(None),
  'all': t.selected_ids(['theme']),
  'plural': t.selected_ids(['themes']),
  'one': t.selected_ids(['theme/ac_n_iron']),
  'two': t.selected_ids(['themes/ac_n_initial', 'theme/ac_s_closur']),
  'other': t.selected_ids(['ui/common']),
  'miss': t.selected_ids(['theme/nope']),
}))`);
    assert.deepEqual(out.full, []);
    assert.deepEqual(out.none, []);
    assert.deepEqual(out.all, ['ac_n_initial', 'ac_n_iron', 'ac_s_closur']);
    assert.deepEqual(out.plural, ['ac_n_initial', 'ac_n_iron', 'ac_s_closur']);
    assert.deepEqual(out.one, ['ac_n_iron']);
    assert.deepEqual(out.two, ['ac_n_initial', 'ac_s_closur']);
    assert.deepEqual(out.other, []);
    assert.deepEqual(out.miss, []);

    const jobs = spawnSync(PY, ['-I', '-B', path.join(TOOL, 'extract.py'), '--print-jobs'], { encoding: 'utf8' });
    assert.equal(jobs.status, 0, jobs.stderr);
    const table = JSON.parse(jobs.stdout);
    assert.equal(table.themes.optIn, true);
    assert.equal(table.themes.spTheme, 1);
    assert.deepEqual(table.themes.ids, ['ac_n_initial', 'ac_n_iron', 'ac_s_closur']);
    assert.ok(!table.expectedGroups.some((group) => group === 'themes' || group.startsWith('themes/')));
  });
});

// ui_components.py: the Unity UI components past Image / Text, as prefabs.json fields (no UnityPy, typetree dicts only)
function pyUi(code) {
  const src = `import sys, json
sys.path.insert(0, ${JSON.stringify(TOOL)})
import ui_components as u
REF = lambda p: (('#%d' % p['m_PathID']) if isinstance(p, dict) and p.get('m_PathID') and not p.get('m_FileID') else None)
${code}`;
  const r = spawnSync(PY, ['-I', '-B', '-c', src], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

describe('theme prefab components (ui_components.py)', { skip: !PY && 'no python3' }, () => {
  test('layout groups: the axis from the script id, else from the children; fitters and layout elements', () => {
    const out = pyUi(`
g = {'m_Padding': {'m_Left': 0, 'm_Right': 0, 'm_Top': 0, 'm_Bottom': 0}, 'm_ChildAlignment': 4, 'm_Spacing': 2.0,
     'm_ChildForceExpandWidth': 0, 'm_ChildForceExpandHeight': 0, 'm_ChildControlWidth': 1, 'm_ChildControlHeight': 0,
     'm_ChildScaleWidth': 0, 'm_ChildScaleHeight': 0, 'm_ReverseArrangement': 0}
print(json.dumps({
  'h': u.layout_group(g, -3229211799126679632),
  'v': u.layout_group(g, -4621643977240678714)['axis'],
  'unknown': u.layout_group(g, 1)['axis'],
  'guessV': u.guess_axis([{'anchoredPosition': [0, 0]}, {'anchoredPosition': [1, -40]}]),
  'guessH': u.guess_axis([{'anchoredPosition': [0, 0]}, {'anchoredPosition': [30, 1]}]),
  'fit': u.size_fitter({'m_HorizontalFit': 2, 'm_VerticalFit': 0}),
  'el': u.layout_element({'m_IgnoreLayout': 0, 'm_MinWidth': 40.0, 'm_MinHeight': -1.0, 'm_PreferredWidth': 40.0,
    'm_PreferredHeight': -1.0, 'm_FlexibleWidth': -1.0, 'm_FlexibleHeight': -1.0, 'm_LayoutPriority': 1}),
  'ignore': u.layout_element({'m_IgnoreLayout': 1, 'm_PreferredWidth': -1, 'm_MinWidth': -1}),
  'max': u.layout_element({'m_IgnoreLayout': 0, 'm_PreferredWidth': -1, 'useMaxWidth': 1, 'maxWidth': 90.0, 'useMaxHeight': 0, 'maxHeight': 0}),
  'mask': u.rect_mask({'m_Padding': {'x': 0, 'y': 0, 'z': 0, 'w': 0}, 'm_Softness': {'x': 32, 'y': 0}}),
}))`);
    assert.deepEqual(out.h, { axis: 'h', align: 4, spacing: 2, control: [1, 0], expand: [0, 0] });
    assert.equal(out.v, 'v');
    assert.equal(out.unknown, null, 'an unknown script id leaves the axis to the walker');
    assert.equal(out.guessV, 'v');
    assert.equal(out.guessH, 'h');
    assert.deepEqual(out.fit, [2, 0]);
    assert.deepEqual(out.el, { min: [40, -1], pref: [40, -1] });
    assert.deepEqual(out.ignore, { ignore: 1 });
    assert.deepEqual(out.max, { max: [90, -1] });
    assert.deepEqual(out.mask, { rect: 1, soft: [32, 0] });
  });

  test('tweens, sliders, status drivers and script references', () => {
    const out = pyUi(`
print(json.dumps({
  'alpha': u.tween({'_from': 0.0, '_to': 1.0, '_startByFrom': 1, '_duration': 2.0, '_delay': 0.0, '_easeType': 4, '_loop': -1,
    '_loopType': 1, '_playWhenStart': 1, '_ignoreTimeScale': 0}, -7396670433381408218),
  'rot': u.tween({'_from': {'x': 0, 'y': 0, 'z': 0}, '_to': {'x': 0, 'y': 0, 'z': 360}, '_startByFrom': 1, '_duration': 8.0,
    '_easeType': 1, '_loop': -1, '_loopType': 2, '_playWhenStart': 1}, 6318307027612266610),
  'pos': u.tween({'_from': {'_position': {'x': -97.3, 'y': 2}}, '_to': {'_position': {'x': -97.3, 'y': -5}}, '_startByFrom': 1,
    '_duration': 1.0, '_easeType': 4, '_loop': -1, '_loopType': 1, '_playWhenStart': 1}, 999),
  'slider': u.slider({'m_FillRect': {'m_FileID': 0, 'm_PathID': 7}, 'm_HandleRect': {'m_FileID': 0, 'm_PathID': 0},
    'm_Direction': 0, 'm_MinValue': 0.0, 'm_MaxValue': 1.0, 'm_Value': 1.0, 'm_WholeNumbers': 0}, REF),
  'status': u.status_driver({'_statusEntries': [
    {'statusName': 'hud_rest', 'descriptions': [
      {'descriptionType': 2, '_animationLocation': {'animationWrapper': {'m_FileID': 0, 'm_PathID': 1}, 'animationName': 'trans_rest'},
       '_animationLocationOut': {'animationWrapper': None, 'animationName': ''}, 'isFastMode': 1, 'gameObject': None},
      {'descriptionType': 1, 'gameObject': {'m_FileID': 0, 'm_PathID': 5}, 'active': 1},
      {'descriptionType': 1, 'gameObject': None, 'active': 0}]}]}, REF),
  'ctl': u.controller({'_roundText': {'m_FileID': 0, 'm_PathID': 3}, '_outside': {'m_FileID': 2, 'm_PathID': 9},
    '_loseHpAnim': {'animationWrapper': {'m_FileID': 0, 'm_PathID': 4}, 'animationName': 'hud_lose_hp'}, 'm_Enabled': 1}, REF, 42),
  'none': u.controller({'_fontName': 'x'}, REF, 1),
}))`);
    assert.deepEqual(out.alpha, { kind: 'alpha', from: 0, to: 1, dur: 2, ease: 4, loop: -1, loopType: 1, auto: 1 });
    assert.deepEqual(out.rot, { kind: 'rot', from: [0, 0, 0], to: [0, 0, 360], dur: 8, ease: 1, loop: -1, loopType: 2, auto: 1 });
    assert.equal(out.pos.kind, 'pos', 'an unknown script id: the value shape tells');
    assert.deepEqual(out.pos.to, [-97.3, -5]);
    assert.deepEqual(out.slider, { dir: 0, min: 0, max: 1, value: 1, fill: '#7' });
    assert.deepEqual(out.status, [{ name: 'hud_rest', ops: [{ t: 2, anim: { clip: 'trans_rest', on: '#1' }, fast: 1 }, { t: 1, node: '#5', on: 1 }] }]);
    assert.deepEqual(out.ctl, { script: '42', refs: { _roundText: '#3' }, anims: { _loseHpAnim: { clip: 'hud_lose_hp', on: '#4' } } });
    assert.equal(out.none, null);
  });

  test('legacy clips keep the drawn properties; bitmap fonts keep their glyphs; materials say when they are effects', () => {
    const out = pyUi(`
key = lambda t, v: {'time': t, 'value': v, 'inSlope': 0.0, 'outSlope': float('inf') if t == 0 else 0.0, 'weightedMode': 0}
clip = u.clip_info({'m_Legacy': 1, 'm_WrapMode': 2, 'm_FloatCurves': [
    {'curve': {'m_Curve': [key(0, 0.0), key(1.5, 1.0)]}, 'attribute': 'm_Alpha', 'path': 'a', 'classID': 225},
    {'curve': {'m_Curve': [key(0, 1.0)]}, 'attribute': 'm_Color.a', 'path': 'a/b', 'classID': 114, 'script': {'m_FileID': 1, 'm_PathID': 350208831926335389}},
    {'curve': {'m_Curve': [key(0, 1.0)]}, 'attribute': 'm_Enabled', 'path': '', 'classID': 114, 'script': {'m_FileID': 1, 'm_PathID': 5350083703478588915}},
  ], 'm_ScaleCurves': [{'curve': {'m_Curve': [{'time': 2.0, 'value': {'x': 1, 'y': 0.5, 'z': 1}, 'inSlope': {'x': 0, 'y': 0, 'z': 0}, 'outSlope': {'x': 0, 'y': 0, 'z': 0}}]}, 'path': 'c'}]})
print(json.dumps({
  'clip': clip,
  'mecanim': u.clip_info({'m_Legacy': 0}),
  'glyphs': u.font_glyphs({'m_CharacterRects': [{'index': 48, 'uv': {'x': 0, 'y': 0, 'width': 0.25, 'height': 0.5},
    'vert': {'x': 0, 'y': 18, 'width': 32, 'height': -36}, 'advance': 32.0, 'flipped': False}]}),
  'fx': u.material_info({'m_Name': 'wireline_red', 'm_SavedProperties': {'m_TexEnvs': [['_BaseTex', {'m_Texture': {'m_FileID': 0, 'm_PathID': 12}}]]}}, None),
  'effect': u.material_info({'m_Name': 'm_streak_glow', 'm_SavedProperties': {
    'm_TexEnvs': [['_BaseTex', {'m_Texture': {'m_FileID': 0, 'm_PathID': 12}, 'm_Scale': {'x': 0.6, 'y': 1}, 'm_Offset': {'x': 0, 'y': 0}}],
                  ['_Mask_Tex', {'m_Texture': {'m_FileID': 0, 'm_PathID': 13}, 'm_Scale': {'x': 1, 'y': 1}, 'm_Offset': {'x': 0, 'y': 0}}],
                  ['_Dissolve1_Tex', {'m_Texture': {'m_FileID': 0, 'm_PathID': 0}}]],
    'm_Floats': [['_BaseTex_SpeedU', -1.0], ['_BaseTex_SpeedV', 0.0]],
    'm_Colors': [['_Color', {'r': 1, 'g': 0, 'b': 0, 'a': 1}]]}}, lambda p: {12: 'm_mask_flow', 13: 'img_streak_base'}.get(p['m_PathID'])),
  'plain': u.material_info({'m_Name': 'm_add', 'm_SavedProperties': {'m_TexEnvs': [['_MainTex', {'m_Texture': {'m_FileID': 0, 'm_PathID': 0}}]]}}, None),
}))`);
    assert.equal(out.clip.len, 2);
    assert.equal(out.clip.wrap, 2);
    assert.deepEqual(out.clip.curves.map((c) => [c[0], c[1]]), [['a', 'alpha'], ['a/b', 'img.a'], ['c', 'scale']], 'the wrapper\'s m_Enabled is not drawn');
    assert.deepEqual(out.clip.curves[0][2][0], [0, 0, 0, 1e9], 'an infinite slope is stored as 1e9');
    assert.equal(out.mecanim, null);
    assert.deepEqual(out.glyphs, [{ char: 48, uv: [0, 0, 0.25, 0.5], vert: [0, 18, 32, -36], advance: 32 }]);
    assert.deepEqual(out.fx, { name: 'wireline_red', fx: 1 });
    assert.deepEqual(out.effect, { name: 'm_streak_glow', fx: 1, base: 'm_mask_flow', tile: [0.6, 1], speed: [-1, 0], mask: 'img_streak_base', tint: '#FF0000' });
    assert.deepEqual(out.plain, { name: 'm_add' });
  });
});

describe('规程\'s opening (season_entry.py) and its effect materials', { skip: !PY && 'no python3' }, () => {
  test('materials: a texture-less ring, a particle sheet, a tiled addition map / mask, _RgbCtrl, additive blending', () => {
    const out = pyUi(`
names = {12: 'entry_num_sheet', 13: 'img_screen_line_hori', 14: 'entry_anim_map'}
name_of = lambda p: names.get(p['m_PathID'])
tex = lambda pid, sx=1, sy=1: {'m_Texture': {'m_FileID': 0, 'm_PathID': pid}, 'm_Scale': {'x': sx, 'y': sy}, 'm_Offset': {'x': 0, 'y': 0}}
print(json.dumps({
  'clear': u.material_info({'m_Name': 'mat_shape_circle_clear', 'm_SavedProperties': {'m_TexEnvs': [],
    'm_Floats': [['_InStep', 0.437], ['_InSmooth', 0.005], ['_OutStep', 0.44], ['_OutSmooth', 0.005], ['_DstBlend', 0.0]]}}, name_of),
  'tile': u.material_info({'m_Name': 'mat_shape_circle_tile_add', 'm_SavedProperties': {'m_TexEnvs': [['_AdditionMap', tex(13, 4.8636, 4.8636)]],
    'm_Floats': [['_InStep', 0.438], ['_InSmooth', 0.065], ['_OutStep', 0.491], ['_OutSmooth', 0.059]]}}, name_of),
  'sheet': u.material_info({'m_Name': 'mat_entry_num_sheet', 'm_SavedProperties': {'m_TexEnvs': [['_ParticleTex', tex(12)]],
    'm_Floats': [['_Column', 5.0], ['_Row', 2.0], ['_PropertyCtrlMode', 1.0]],
    'm_Colors': [['_Color1', {'r': 0.859, 'g': 0.282, 'b': 0.204, 'a': 1}]]}}, name_of),
  'dissolve': u.material_info({'m_Name': 'mat_entry_map_dissolve', 'm_SavedProperties': {
    'm_TexEnvs': [['_Mask_Tex', tex(13, 4.375, 2.625)], ['_Dissolve1_Tex', {'m_Texture': {'m_FileID': 3, 'm_PathID': 9}}]],
    'm_Floats': [['_RgbCtrl', 1.0], ['_Dst', 1.0]]}}, name_of),
  'add': u.material_info({'m_Name': 'mat_com_add', 'm_SavedProperties': {'m_TexEnvs': [], 'm_Floats': [['_DstBlend', 1.0]]}}, name_of),
}))`);
    assert.deepEqual(out.clear, { name: 'mat_shape_circle_clear', ring: [0.437, 0.005, 0.44, 0.005] });
    assert.deepEqual(out.tile, { name: 'mat_shape_circle_tile_add', fx: 1, ring: [0.438, 0.065, 0.491, 0.059], add: 'img_screen_line_hori', addTile: [4.864, 4.864] });
    assert.deepEqual(out.sheet, { name: 'mat_entry_num_sheet', fx: 1, sheet: { tex: 'entry_num_sheet', cols: 5, rows: 2, ctrl: 1, color: '#DB4834' } });
    assert.deepEqual(out.dissolve, { name: 'mat_entry_map_dissolve', fx: 1, blend: 'add', mask: 'img_screen_line_hori', maskTile: [4.375, 2.625], rgbCtrl: 1 });
    assert.deepEqual(out.add, { name: 'mat_com_add', blend: 'add' });
  });

  test('the export keeps the opening without the season screen\'s buttons, and lists what it draws', () => {
    const src = `import sys, json
sys.path.insert(0, ${JSON.stringify(TOOL)})
import season_entry as s
img = lambda sprite, w=10, h=10, mat=None: {'sprite': sprite, 'w': w, 'h': h, **({'material': mat} if mat else {})}
tree = {'name': 'panel_act3autochess_on_entry', 'children': [
  {'name': 'canvas_back', 'children': [{'name': 'bkg_1', 'image': img('bkg_season_on', 1559, 960)}]},
  {'name': 'canvas_center', 'children': [{'name': 'btn_medal', 'image': img('btn_medal')}]},
  {'name': 'canvas_front', 'children': [
    {'name': 'bottom_view', 'children': [{'name': 'btn_invite', 'image': img('btn_invite')}]},
    {'name': 'entry_anim_season_on', 'children': [
      {'name': 'num1', 'image': {'sprite': None, 'material': {'name': 'mat_entry_num_sheet', 'sheet': {'tex': 'entry_num_sheet'}}}},
      {'name': 'map_1_add', 'image': img('entry_anim_map', 280, 168, {'name': 'mat_entry_map_dissolve', 'mask': 'img_screen_line_hori'})},
      {'name': 'circle_tile', 'image': {'sprite': None, 'material': {'name': 'mat_shape_circle_tile_add', 'add': 'img_screen_line_hori'}}}]}]},
  {'name': 'top_menu'}, {'name': 'non_drawing_graphic'}]}
s.prune(tree)
print(json.dumps({'kept': [c['name'] for c in tree['children']], 'front': [c['name'] for c in tree['children'][1]['children']],
  'sprites': {k: sorted(map(list, v)) for k, v in s.sprite_refs(tree).items()}, 'textures': sorted(s.texture_refs(tree)),
  'sub': s.SUB, 'clips': list(s.CLIPS)}))`;
    const r = spawnSync(PY, ['-I', '-B', '-c', src], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.kept, ['canvas_back', 'canvas_front']);
    assert.deepEqual(out.front, ['entry_anim_season_on']);
    assert.deepEqual(out.sprites, { bkg_season_on: [[1559, 960]], entry_anim_map: [[280, 168]] });
    assert.deepEqual(out.textures, ['entry_num_sheet', 'img_screen_line_hori']);
    assert.equal(out.sub, 'ui/season/act3autochess/entry');
    assert.deepEqual(out.clips, ['autochess_entry_season_on', 'autochess_season_on_entry_loop']);

    const jobs = spawnSync(PY, ['-I', '-B', path.join(TOOL, 'extract.py'), '--print-jobs'], { encoding: 'utf8' });
    assert.equal(jobs.status, 0, jobs.stderr);
    const table = JSON.parse(jobs.stdout);
    assert.deepEqual(table.seasonEntry, { sub: 'ui/season/act3autochess/entry', bundle: 'activity/[uc]act3autochess.ab', prefab: 'panel_act3autochess_on_entry', clips: out.clips, format: 1 });
    assert.ok(table.expectedGroups.includes('ui/season/act3autochess/entry'), 'a full extract writes it (setup asks for --local again without it)');
  });
});
