// Interface themes (docs/THEMES.md): the manifest, the CSS variables, the voice gate, and storage
// when IndexedDB is blocked. The browser pass is test/ui/themes.e2e.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { createThemeLibrary } from '../../public/js/uiTheme.js';
import { openZip } from '../../public/js/assetPack.js';
import { themeTemplateDocument, zipStored } from '../../tools/theme-template.mjs';
import {
  BUILTIN_ID, THEME_LIMITS, VOICE_TRIGGERS, applyThemeTo, assessTheme, buyVoiceTrigger, createVoiceGate,
  cssUrl, emptyCueState, stepThemeCues, takeVoiceCues, themeDeclarations, themeRelPath, themeRootOf,
  themeStyleText, themeViewSnap,
} from '../../shared/uiTheme.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function manifest(over = {}) {
  return {
    spTheme: 1,
    id: 'iron-fan',
    name: '主题名',
    author: '作者',
    version: '1.0.0',
    description: '一句话',
    ...over,
  };
}

function assess(over = {}, files = [], extra = {}) {
  return assessTheme({ jsonText: JSON.stringify(manifest(over)), files, ...extra });
}

function snap(view) {
  return themeViewSnap(view);
}

function memoryOpen() {
  const rows = new Map();
  return async () => ({
    transaction() {
      const tx = {
        objectStore() {
          return {
            getAll() { return { result: [...rows.values()] }; },
            put(value, key) { rows.set(key, structuredClone(value)); return { result: key }; },
            delete(key) { rows.delete(key); return { result: undefined }; },
          };
        },
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  });
}

function library(extra = {}) {
  let n = 0;
  return createThemeLibrary({
    openDb: extra.openDb || memoryOpen(),
    measure: extra.measure || (async () => ({ ok: true, width: 8, height: 8 })),
    createUrl: extra.createUrl || (() => `blob:test/${++n}`),
    revokeUrl: extra.revokeUrl || (() => {}),
  });
}

function entry(path, text) {
  const bytes = new TextEncoder().encode(text);
  return { path, size: bytes.length, read: async () => bytes };
}

test('a good pack keeps colours, tokens, images, banners and voice', () => {
  const report = assess({
    thumbnail: 'thumb.png',
    colors: { skinLightColor: '#00FFC4', garrisonIconColor2: '#FFFFFF33', noSuch: '#fff' },
    tokens: { '--mint-400': '#112233', '--not-a-token': 'red' },
    images: {
      shop_main: 'ui/shop.png',
      prep_ready: { src: 'ui/ready.png', slice: [12, 24, 12, 24] },
      '': 'ui/shop.png',
      win_streak: 'ui/streak.png',
    },
    banners: { gameStart: 'fx/start.webp', perfectStreak: 'fx/streak.webp', rest: '' },
    voice: { AUTOCHESS_FREEZE: 'v/freeze.ogg', AUTOCHESS_GAME_START: ['v/a.ogg', 'v/b.ogg'], NOPE: 'v/nope.ogg' },
    extra: 1,
  }, [
    { path: 'thumb.png', size: 10, width: 32, height: 32, measured: true },
    { path: 'ui/shop.png', size: 10, width: 8, height: 8, measured: true },
    { path: 'ui/ready.png', size: 10, width: 8, height: 8, measured: true },
    { path: 'ui/streak.png', size: 10, width: 8, height: 8, measured: true },
    { path: 'fx/start.webp', size: 10, width: 8, height: 8, measured: true },
    { path: 'fx/streak.webp', size: 10, width: 8, height: 8, measured: true },
    { path: 'v/freeze.ogg', size: 20 },
    { path: 'v/a.ogg', size: 20 },
    { path: 'v/b.ogg', size: 20 },
    { path: 'v/nope.ogg', size: 20 },
    { path: 'notes.txt', size: 4 },
  ]);
  assert.equal(report.ok, true);
  assert.equal(report.colors.skinLightColor, '#00FFC4');
  assert.equal(report.colors.garrisonIconColor2, undefined);
  assert.deepEqual(report.tokens, { '--mint-400': '#112233' });
  assert.deepEqual(report.images.shop_main, { path: 'ui/shop.png', slice: null });
  assert.deepEqual(report.images.prep_ready.slice, [12, 24, 12, 24]);
  assert.deepEqual(report.banners.gameStart, { path: 'fx/start.webp', slice: null });
  assert.equal(report.banners.perfectStreak, undefined);
  assert.deepEqual(report.voice.AUTOCHESS_GAME_START, ['v/a.ogg', 'v/b.ogg']);
  assert.ok(report.used.images.includes('thumbnail'));
  assert.ok(report.unused.colors.includes('garrisonIconColor2'));
  assert.ok(report.unused.colors.includes('noSuch'));
  assert.ok(report.unused.images.includes('win_streak'));
  assert.ok(report.unused.banners.includes('perfectStreak'));
  assert.ok(report.unused.voice.includes('NOPE'));
  assert.ok(report.unused.keys.includes('extra'));
  assert.deepEqual(report.ignored, ['notes.txt']);
  assert.ok(report.refused.some((item) => item.path === 'tokens.--not-a-token' && item.code === 'bad-token'));
});

test('the whole pack is refused for a bad manifest, a reserved id, a path, or a limit', () => {
  assert.equal(assessTheme({ jsonText: '{' }).code, 'bad-json');
  assert.equal(assessTheme({ jsonText: '[]' }).code, 'bad-json');
  assert.equal(assess({ spTheme: '1' }).code, 'bad-version');
  assert.equal(assess({ spTheme: 2 }).code, 'bad-version');
  assert.equal(assess({ id: 'Iron' }).code, 'bad-id');
  assert.equal(assess({ id: '' }).code, 'bad-id');
  assert.equal(assess({ id: BUILTIN_ID }).code, 'reserved-id');
  assert.equal(assess({ name: '' }).code, 'name');
  assert.equal(assess({ name: 'x'.repeat(41) }).code, 'name');
  assert.equal(assess({ author: 'a\nb' }).code, 'name');
  assert.equal(assess({ version: '1'.repeat(33) }).code, 'name');
  assert.equal(assessTheme({ jsonText: `{"spTheme":1,"id":"a","name":"${'名'.repeat(20)}"}` }).ok, true);
  const huge = `{"spTheme":1,"id":"a","name":"n","pad":"${'x'.repeat(THEME_LIMITS.json)}"}`;
  assert.equal(assessTheme({ jsonText: huge }).code, 'too-big');
  const many = Array.from({ length: THEME_LIMITS.files }, (_, i) => ({ path: `f/${i}.png`, size: 1 }));
  assert.equal(assess({}, many).code, 'too-many-files');
  assert.equal(assess({}, [], { packBytes: THEME_LIMITS.pack + 1 }).code, 'too-big');
  assert.equal(assess({}, [{ path: '../x.png', size: 1 }]).code, 'bad-path');
  assert.equal(assess({}, [{ path: 'theme.json', size: 1 }]).code, 'bad-path');
  assert.equal(assess({}, [], { storedCount: THEME_LIMITS.packs }).code, 'too-many-packs');
  assert.equal(assess({}, [], { storedCount: THEME_LIMITS.packs, replace: true }).ok, true);
});

test('a bad file drops that key; an empty string is absent; prototype keys are ignored', () => {
  const report = assess({
    colors: { skinLightColor: 'nope', skinDarkColor: '#112233' },
    images: {
      shop_main: 'ui/missing.png',
      hud_player_info: { src: 'ui/hud.png', slice: [1, 2, 3] },
      game_start: 'http://evil/a.png',
      help_battle: '../a.png',
      countdown: 'ui/big.png',
      countdown_outer: 'ui/wide.png',
      prep_ready: 'ui/not.png',
      boss_damage: 'ui/note.txt',
    },
    voice: { AUTOCHESS_FREEZE: ['v/ok.ogg', 'v/late.ogg', 1] },
  }, [
    { path: 'ui/big.png', size: THEME_LIMITS.image + 1 },
    { path: 'ui/wide.png', size: 10, width: THEME_LIMITS.imageEdge + 1, height: 1, measured: true },
    { path: 'ui/not.png', size: 10, measured: false },
    { path: 'ui/note.txt', size: 4 },
    { path: 'v/ok.ogg', size: 4 },
    { path: 'v/late.ogg', size: THEME_LIMITS.audio + 1 },
  ]);
  assert.equal(report.ok, true);
  assert.equal(report.colors.skinLightColor, undefined);
  assert.equal(report.colors.skinDarkColor, '#112233');
  assert.equal(report.images.shop_main, undefined);
  assert.deepEqual(report.voice.AUTOCHESS_FREEZE, ['v/ok.ogg']);
  const codes = Object.fromEntries(report.refused.map((item) => [item.path, item.code]));
  assert.equal(codes['colors.skinLightColor'], 'bad-color');
  assert.equal(codes['images.shop_main'], 'missing');
  assert.equal(codes['images.hud_player_info'], 'bad-slice');
  assert.equal(codes['images.game_start'], 'bad-path');
  assert.equal(codes['images.help_battle'], 'bad-path');
  assert.equal(codes['images.countdown'], 'image-too-big');
  assert.equal(codes['images.countdown_outer'], 'image-dim');
  assert.equal(codes['images.prep_ready'], 'not-image');
  assert.equal(codes['images.boss_damage'], 'bad-type');
  assert.equal(codes['voice.AUTOCHESS_FREEZE'], 'audio-too-big');

  const empty = assess({ images: { shop_main: '' }, banners: { rest: '' }, voice: { AUTOCHESS_FREEZE: '' } });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.refused, []);
  assert.deepEqual(empty.images, {});

  const lines = Array.from({ length: 9 }, (_, i) => `v/${i}.ogg`);
  const capped = assess({ voice: { AUTOCHESS_FREEZE: lines } }, lines.map((path) => ({ path, size: 4 })));
  assert.equal(capped.voice.AUTOCHESS_FREEZE.length, 8);
  assert.ok(capped.refused.some((item) => item.path === 'voice.AUTOCHESS_FREEZE[8]' && item.code === 'bad-voice'));

  const poisoned = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"spTheme":1,"id":"iron-fan","name":"主题名"}');
  assert.equal(({}).polluted, undefined);
  const clean = assessTheme({ jsonText: JSON.stringify(poisoned) });
  assert.equal(clean.ok, true);
  assert.deepEqual(clean.unused.keys, []);
  assert.equal(({}).polluted, undefined);

  const unknown = assess({ voice: { NO_SUCH: 'nope.txt' } }, [{ path: 'nope.txt', size: 4 }]);
  assert.ok(unknown.unused.voice.includes('NO_SUCH'));
  assert.deepEqual(unknown.refused, []);
  assert.deepEqual(unknown.ignored, []);

  const dup = assess({ images: { shop_main: 'ui/a.png' } }, [
    { path: 'ui/a.png', size: 10, width: 5000, height: 1, measured: true },
    { path: 'ui/a.png', size: 10, width: 8, height: 8, measured: true },
  ]);
  assert.ok(dup.refused.some((item) => item.code === 'image-dim'));
});

test('paths stay inside the pack, and one folder around theme.json is the root', () => {
  assert.equal(themeRelPath('/etc/passwd'), 'etc/passwd');
  assert.equal(themeRelPath('a/../b.png'), null);
  assert.equal(themeRelPath('http://x/a.png'), null);
  assert.equal(themeRelPath('C:/a.png'), null);
  assert.equal(themeRelPath('a/b?.png'), null);
  assert.equal(themeRelPath('dir/'), null);
  assert.deepEqual(themeRootOf(['theme.json', 'ui/a.png']), { ok: true, prefix: '' });
  assert.deepEqual(themeRootOf(['pack/theme.json', 'pack/ui/a.png']), { ok: true, prefix: 'pack/' });
  assert.equal(themeRootOf(['a/theme.json', 'b/theme.json']).code, 'bad-json');
  assert.equal(themeRootOf(['../theme.json']).code, 'bad-path');
});

test('the built-in look adds no CSS; a pack writes blob URLs and a default frame slice', () => {
  assert.equal(themeStyleText(null), '');
  assert.equal(themeStyleText({ id: BUILTIN_ID, colors: { skinLightColor: '#fff' } }), '');
  assert.equal(themeStyleText({ builtin: true, id: 'iron-fan', colors: { skinLightColor: '#fff' } }), '');
  assert.equal(cssUrl('http://evil'), null);
  assert.equal(cssUrl('blob:a"b'), null);
  assert.equal(cssUrl('blob:ok'), 'url("blob:ok")');

  const decl = themeDeclarations({
    id: 'iron-fan',
    colors: { skinLightColor: '#00FFC4', garrisonIconColor2: '#fff' },
    tokens: { '--mint-400': '#112233' },
    images: {
      shop_main: { url: 'blob:shop' },
      chess_frame_normal: { url: 'blob:frame' },
      prep_ready: { url: 'blob:ready', slice: [1, 2, 3, 4] },
      help_battle: { url: 'http://no' },
    },
    banners: {
      gameStart: 'blob:start',
      perfectStreak: 'blob:no',
      rest: { url: 'blob:rest', slice: [8, 9, 10, 11] },
    },
  });
  assert.equal(decl.props['--sp-c-skin-light'], '#00FFC4');
  assert.equal(decl.props['--sp-img-shop_main'], 'url("blob:shop")');
  assert.equal(decl.props['--sp-slice-chess_frame_normal'], '8 8 8 8');
  assert.equal(decl.props['--sp-slice-px-prep_ready'], '1px 2px 3px 4px');
  // the same widths at the official size (one prefab unit = .0144rem), for the frames ui-theme.css draws (§37.204)
  assert.equal(decl.props['--sp-slice-rem-prep_ready'], '0.0144rem 0.0288rem 0.0432rem 0.0576rem');
  assert.equal(decl.props['--sp-banner-gameStart'], 'url("blob:start")');
  assert.equal(decl.props['--sp-banner-rest'], 'url("blob:rest")');
  assert.equal(decl.props['--sp-slice-rest'], '8 9 10 11');
  assert.equal(decl.props['--sp-slice-rem-rest'], '0.1152rem 0.1296rem 0.144rem 0.1584rem');
  assert.equal(decl.props['--sp-banner-perfectStreak'], undefined);
  assert.ok(decl.slices.includes('rest'));
  assert.equal(decl.props['--sp-img-help_battle'], undefined);
  assert.ok(!decl.colors.includes('garrison2'));
  assert.deepEqual(decl.slots.includes('shop_main') && decl.banners.includes('gameStart'), true);

  const props = {};
  const root = {
    style: {
      setProperty(name, value) { props[name] = value; },
      removeProperty(name) { delete props[name]; },
    },
    dataset: {},
  };
  applyThemeTo(root, { id: 'iron-fan', colors: { skinLightColor: '#00FFC4' }, images: { shop_main: { url: 'blob:shop' } } });
  assert.equal(root.dataset.spTheme, 'iron-fan');
  assert.match(root.dataset.spSlot, /shop_main/);
  assert.match(root.dataset.spColor, /skinLight/);
  assert.equal(props['--sp-c-skin-light'], '#00FFC4');
  applyThemeTo(root, null);
  assert.equal(root.dataset.spTheme, undefined);
  assert.equal(root.dataset.spSlot, undefined);
  assert.deepEqual(props, {});
});

test('theme paint rules are gated, and the sheets load after the device sheet', () => {
  const css = read('public/css/ui-theme.css');
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(clean))) {
    const selector = match[1];
    const body = match[2];
    if (!/--sp-(?:img|banner|c|slice)-/.test(`${selector}${body}`)) continue;
    assert.match(selector, /html\[data-sp-/, selector.trim());
  }
  // a slice on the element itself keeps the element's own background in the centre (no fill); only the ::before frames
  // fill: they draw the whole picture, sliced instead of stretched, over that background (§37.204)
  for (const [, selector, body] of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/border-image[^;}]*\bfill\b/.test(body)) continue;
    for (const one of selector.split(',')) assert.match(one.trim(), /::before$/, one.trim());
  }
  for (const page of ['public/index.html', 'public/dev/game-mock.html']) {
    const html = read(page);
    const at = html.indexOf('/css/devices.css');
    const theme = html.indexOf('/css/ui-theme.css');
    assert.ok(at >= 0 && theme > at, page);
  }
});

test('the starter pack lists every slot and the default colours, and matches the committed file', () => {
  const doc = themeTemplateDocument();
  const report = assessTheme({ jsonText: JSON.stringify(doc) });
  assert.equal(report.ok, true);
  assert.equal(report.id, 'my-theme');
  assert.equal(report.colors.skinLightColor, '#00FFC4');
  // bondColor / chessNameColor paint the regulation card once its chess-frame slot is present
  assert.equal(report.colors.bondColor, '#B7B7B7');
  assert.equal(report.colors.chessNameColor, '#FFFFFF');
  assert.ok(!report.unused.colors.includes('bondColor') && !report.unused.colors.includes('chessNameColor'));
  assert.deepEqual(report.images, {});
  assert.deepEqual(report.banners, {});
  assert.deepEqual(report.voice, {});
  assert.deepEqual(report.refused, []);
  assert.deepEqual(JSON.parse(read('docs/examples/ui-theme/theme.json')), doc);
});

test('voice: probability, cooldown, priority, and one line of several', () => {
  const miss = createVoiceGate({ random: () => 0.9, now: () => 0 });
  assert.equal(miss.request('AUTOCHESS_REST_NO_HP_LOSS', ['a']), null);
  assert.equal(miss.playing, null);

  let now = 0;
  const gate = createVoiceGate({ random: () => 0, now: () => now });
  assert.equal(gate.request('AUTOCHESS_FREEZE', ['a']), 'a');
  assert.equal(gate.request('AUTOCHESS_GAME_START', ['b']), 'b');
  gate.finish();
  assert.equal(gate.request('AUTOCHESS_FREEZE', ['c']), null);
  now = 14;
  assert.equal(gate.request('AUTOCHESS_FREEZE', ['c']), null);
  now = 15;
  assert.equal(gate.request('AUTOCHESS_FREEZE', ['c']), 'c');

  const same = createVoiceGate({ random: () => 0, now: () => 0 });
  assert.equal(same.request('AUTOCHESS_GAME_START', ['a']), 'a');
  assert.equal(same.request('AUTOCHESS_GAME_START', ['b']), null);

  const seq = [0, 0.5];
  let i = 0;
  const many = createVoiceGate({ random: () => seq[i++], now: () => 0 });
  assert.equal(many.request('AUTOCHESS_GAME_START', ['a', 'b']), 'b');

  const rolls = [0.9, 0];
  let r = 0;
  const next = createVoiceGate({ random: () => rolls[r++], now: () => 0 });
  assert.deepEqual(takeVoiceCues(next, ['AUTOCHESS_FREEZE', 'AUTOCHESS_GAME_START'], () => ['x']), ['x']);
  assert.equal(VOICE_TRIGGERS.AUTOCHESS_FREEZE.priority, 13);
  assert.equal(VOICE_TRIGGERS.AUTOCHESS_GAME_START.cd, 0);
});

test('cues follow the phase, the buy, and the fight that already happened', () => {
  assert.equal(buyVoiceTrigger({ ownedCopies: 2, tier: 6 }), 'AUTOCHESS_SAME_OPERATOR');
  assert.equal(buyVoiceTrigger({ ownedCopies: 0, tier: 4 }), 'AUTOCHESS_BUY_OPERATOR_HIGH');
  assert.equal(buyVoiceTrigger({ tier: 3 }), 'AUTOCHESS_BUY_OPERATOR_LOW');
  assert.equal(buyVoiceTrigger({ tier: Number.NaN }), 'AUTOCHESS_BUY_OPERATOR_LOW');
  assert.equal(buyVoiceTrigger({}), 'AUTOCHESS_BUY_OPERATOR_LOW');

  assert.deepEqual(stepThemeCues(emptyCueState(), snap({ phase: 'PREP', round: 1, lp: 30 })).cues, []);
  const boot = stepThemeCues(emptyCueState(), snap({ phase: 'BATTLE_CHECK' }));
  assert.deepEqual(boot.cues, ['AUTOCHESS_GAME_START']);
  assert.deepEqual(stepThemeCues(boot.state, snap({ phase: 'ROUND_START', round: 1 })).cues, []);

  const info = stepThemeCues(emptyCueState(), snap({ phase: 'INFO_CHECK' }));
  assert.deepEqual(stepThemeCues(info.state, snap({ phase: 'ROUND_START', round: 1 })).cues, ['AUTOCHESS_GAME_START']);

  const fight = stepThemeCues(emptyCueState(), snap({ phase: 'COMBAT', round: 2, lp: 20 }));
  assert.deepEqual(fight.cues, []);
  assert.deepEqual(stepThemeCues(fight.state, snap({ phase: 'PREP', round: 3, lp: 20 })).cues, ['AUTOCHESS_REST_NO_HP_LOSS']);
  assert.deepEqual(stepThemeCues(fight.state, snap({ phase: 'PREP', round: 3, lp: 15 })).cues, ['AUTOCHESS_REST_HP_LOSS']);
  assert.deepEqual(stepThemeCues(fight.state, snap({ phase: 'PREP', round: 14, lp: 15, bossRound: 14, hiddenRound: 15 })).cues, ['AUTOCHESS_REST_BOSS']);
  assert.deepEqual(stepThemeCues(fight.state, snap({ phase: 'PREP', round: 15, lp: 20, bossRound: 14, hiddenRound: 15 })).cues, ['AUTOCHESS_REST_HIDDEN_BOSS']);

  const quiet = stepThemeCues(emptyCueState(), snap({ phase: 'PREP', round: 2, shopLevel: 1, bonds: [{ bondId: 'b', layers: 1 }] }));
  const busy = stepThemeCues(quiet.state, snap({
    phase: 'PREP', round: 2, shopLevel: 2, frozen: true, countdownWarn: true,
    bonds: [{ bondId: 'b', layers: 2 }],
    rewardOffer: { source: 'merge', tier: 2, slots: [{ id: 's1' }] },
  }));
  assert.deepEqual(busy.cues, [
    'AUTOCHESS_ALLIANCE_LEVEL', 'AUTOCHESS_SHOP_UPGRADE', 'AUTOCHESS_COUNTDOWN',
    'AUTOCHESS_MERGE_TRIPLE', 'AUTOCHESS_FREEZE',
  ]);
  assert.deepEqual(stepThemeCues(busy.state, snap({
    phase: 'PREP', round: 2, shopLevel: 2, frozen: true, countdownWarn: true,
    bonds: [{ bondId: 'b', layers: 2 }],
    rewardOffer: { source: 'merge', tier: 2, slots: [{ id: 's1' }] },
  })).cues, []);

  const round1 = stepThemeCues(emptyCueState(), snap({ phase: 'ROUND_START', round: 1, lp: 30 }));
  assert.deepEqual(stepThemeCues(round1.state, snap({ phase: 'PREP', round: 1, lp: 30 })).cues, []);
  assert.equal(sanitizeSettings({ uiTheme: 'iron-fan' }).uiTheme, 'iron-fan');
});

test('storage: a blocked database keeps the pack for this library only, and the ninth pack is refused', async () => {
  const blocked = library({ openDb: async () => { throw new Error('blocked'); } });
  const json = JSON.stringify(manifest());
  const first = await blocked.importEntries([entry('theme.json', json)], json.length);
  assert.equal(first.ok, true);
  assert.equal(first.notice, 'session');
  assert.equal(blocked.get('iron-fan').name, '主题名');
  const other = library({ openDb: async () => { throw new Error('blocked'); } });
  await other.boot();
  assert.equal(other.get('iron-fan'), null);

  const open = memoryOpen();
  const kept = library({ openDb: open });
  for (let i = 0; i < THEME_LIMITS.packs; i++) {
    const body = JSON.stringify(manifest({ id: `pack${i}`, name: `主题${i}` }));
    const result = await kept.importEntries([entry('theme.json', body)], body.length);
    assert.equal(result.ok, true, result.code);
  }
  const ninth = JSON.stringify(manifest({ id: 'pack-extra', name: '多余' }));
  const refused = await kept.importEntries([entry('theme.json', ninth)], ninth.length);
  assert.equal(refused.code, 'too-many-packs');
  assert.equal(kept.list().length, THEME_LIMITS.packs);
  const again = JSON.stringify(manifest({ id: 'pack0', name: '替换' }));
  const replaced = await kept.importEntries([entry('theme.json', again)], again.length);
  assert.equal(replaced.ok, true);
  assert.equal(kept.get('pack0').name, '替换');

  const reloaded = library({ openDb: open });
  await reloaded.boot();
  assert.equal(reloaded.get('pack0').name, '替换');

  let reads = 0;
  const big = library();
  const pic = 'ui/big.png';
  const themed = JSON.stringify(manifest({ images: { shop_main: pic } }));
  const huge = await big.importEntries([
    entry('theme.json', themed),
    { path: pic, size: THEME_LIMITS.image + 1, read: async () => { reads += 1; return new Uint8Array([1]); } },
  ], themed.length + THEME_LIMITS.image + 1);
  assert.equal(huge.ok, true);
  assert.equal(reads, 0);
  assert.ok(huge.report.refused.some((item) => item.code === 'image-too-big'));

  const zipJson = JSON.stringify(manifest({ id: 'zipped', name: '压缩' }));
  const zip = zipStored([
    { name: 'ui/', data: new Uint8Array() },
    { name: 'pack/theme.json', data: new TextEncoder().encode(zipJson) },
  ]);
  const opened = await openZip(zip);
  assert.equal(opened.ok, true);
  const imported = await big.importZip({ arrayBuffer: async () => zip.buffer });
  assert.equal(imported.ok, true, imported.code);
  assert.equal(imported.id, 'zipped');
  const bad = await big.importZip({ arrayBuffer: async () => new TextEncoder().encode('nope').buffer });
  assert.equal(bad.code, 'bad-zip');
});
