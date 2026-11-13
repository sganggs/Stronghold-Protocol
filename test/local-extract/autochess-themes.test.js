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
