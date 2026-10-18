// Theme variables and announcements (DESIGN §34.14). Synthetic manifests only: no Forge pack, no game art.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPluginManifest, pluginIndexEntry, buildPluginIndex } from '../../shared/plugins/manifest.js';
import { acceptColour, acceptTime, acceptEasing, acceptThemeValue, readThemeDeclaration, resolveThemeVars, THEME_TOKENS, THEME_VAR_LIMIT } from '../../shared/plugins/theme.js';
import { readNotices, capCatalogueNotices, collectNotices, noticeView, markSeen, readSeen, writeSeen, NOTICE_LIMITS } from '../../shared/plugins/notices.js';
import { applyThemeProperties } from '../../public/js/themeVars.js';
import { planForgeImport, importForge } from '../../server/plugins/forgeImport.js';
import { readVanillaAssets } from '../../server/plugins/registry.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { fixture } from '../helpers/contentFixtures.js';
import { scriptFixture } from '../helpers/scriptFixtures.js';
import { verifyScripts } from '../../shared/plugins/scriptLoad.js';
import { createRoomSets } from '../../server/plugins/roomSets.js';
import { createContentSets } from '../../server/plugins/contentSets.js';
import { healthReport } from '../../server/http/routes.js';
import { Lobby } from '../../server/lobby.js';
import { ROOT } from '../../server/data.js';
import { createVisualSets } from '../../server/plugins/visualSet.js';
import { packPlugin } from '../../server/plugins/pack.js';
import { nodeSha256 } from '../../server/plugins/identity.js';
import { png } from '../helpers/pluginFixtures.js';

const vanilla = readVanillaAssets(path.join(ROOT, 'data'));
const ctx = (id) => ({ id });

test('theme grammar: colours, times and easings; urls and expressions are refused', () => {
  assert.equal(acceptColour('#abc'), '#abc');
  assert.equal(acceptColour('#abcd'), '#abcd');
  assert.equal(acceptColour('#aabbcc'), '#aabbcc');
  assert.equal(acceptColour('#aabbccdd'), '#aabbccdd');
  assert.equal(acceptColour('rgb(1, 2, 3)'), 'rgb(1, 2, 3)');
  assert.equal(acceptColour('rgba(1 2 3 / 40%)'), 'rgba(1 2 3 / 40%)');
  assert.equal(acceptColour('hsl(120 50% 40%)'), 'hsl(120 50% 40%)');
  assert.equal(acceptColour('hsla(-10, 50%, 40%, .5)'), 'hsla(-10, 50%, 40%, .5)');
  assert.equal(acceptColour('red'), null);
  assert.equal(acceptColour('RGB(1,2,3)'), null);
  for (const value of ['rgb(1, 2, 3 / .5)', 'rgb(1%, 2, 3)', 'hsl(120, 50%, 40% / .2)', 'rgb(1 2 3 .5)', 'rgb(1\u00a02\u00a03)', 'rgb(1e2 2 3)']) assert.equal(acceptColour(value), null, value);
  assert.equal(acceptTime('0s'), '0s');
  assert.equal(acceptTime('2s'), '2s');
  assert.equal(acceptTime('2000ms'), '2000ms');
  assert.equal(acceptTime('150ms'), '150ms');
  assert.equal(acceptTime('2.1s'), null);
  assert.equal(acceptTime('2001ms'), null);
  assert.equal(acceptTime('-1ms'), null);
  assert.equal(acceptTime('1'), null);
  assert.equal(acceptEasing('ease-out'), 'ease-out');
  assert.equal(acceptEasing('linear'), 'linear');
  assert.equal(acceptEasing('cubic-bezier(0, .2, 1, -0.4)'), 'cubic-bezier(0, .2, 1, -0.4)');
  assert.equal(acceptEasing('cubic-bezier(1.1, 0, 1, 0)'), null);
  assert.equal(acceptEasing('Ease'), null);
  assert.equal(acceptThemeValue('--text-hi', 'var(--mint-500)'), null);
  assert.equal(acceptThemeValue('--text-hi', 'url(https://x)'), null);
  assert.equal(acceptThemeValue('--t-fast', 'calc(1s)'), null);
  assert.equal(acceptThemeValue('--nope', '#fff'), null);
  for (const value of ['#fff;', '#fff{}', '<svg>', '"#fff"', "'#fff'", '\\23fff', 'expression(1)', 'url(x)', 'var(--red)']) {
    assert.ok(readThemeDeclaration({ vars: { '--text-hi': value } }).problems.some((p) => p.code === 'PLUGIN_THEME_VALUE' || p.code === 'PLUGIN_THEME_URL'), value);
  }
});

test('the theme allowlist covers exactly the root colour, time and easing tokens', () => {
  const cssDir = path.join(ROOT, 'public/css');
  const defaults = {};
  for (const name of fs.readdirSync(cssDir).filter((n) => n.endsWith('.css'))) {
    const text = fs.readFileSync(path.join(cssDir, name), 'utf8');
    for (const block of text.matchAll(/:root\s*\{([^}]+)\}/g)) {
      for (const [, token, value] of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        const v = value.trim();
        if (acceptColour(v) || acceptTime(v) || acceptEasing(v) || token === '--bk-c') defaults[token] = true;
      }
    }
  }
  assert.deepEqual(Object.keys(THEME_TOKENS).sort(), Object.keys(defaults).sort());
});

test('a theme declaration: flat map or vars, one bad name refuses ours, drop keeps the rest', () => {
  const good = readThemeDeclaration({ vars: { '--text-hi': '#f4faf7', '--t-fast': '0s', '--ease-out': 'linear' } });
  assert.deepEqual(good.problems, []);
  assert.equal(good.vars['--ease-out'], 'linear');
  const flat = readThemeDeclaration({ '--amber': '#f6a329' });
  assert.equal(flat.vars['--amber'], '#f6a329');
  const bad = readThemeDeclaration({ vars: { '--text-hi': '#fff', '--made-up': '#fff' } });
  assert.equal(bad.vars, null);
  assert.equal(bad.problems[0].code, 'PLUGIN_THEME_NAME');
  const url = readThemeDeclaration({ a: 'url(http://x)' });
  assert.match(url.problems.map((p) => p.code).join(), /PLUGIN_THEME_URL/);
  assert.match(url.problems.map((p) => p.text).join(), /"theme" names a URL/);
  const shape = readThemeDeclaration({ a: 1 });
  assert.equal(shape.problems[0].code, 'PLUGIN_THEME_SHAPE');
  const mixed = readThemeDeclaration({ vars: { '--text-hi': '#fff' }, extra: 1 });
  assert.equal(mixed.problems[0].code, 'PLUGIN_THEME_SHAPE');
  const many = { vars: {} };
  many.vars = Object.fromEntries(Array.from({ length: THEME_VAR_LIMIT + 1 }, (_, i) => [`--x${i}`, '#fff']));
  const over = readThemeDeclaration(many);
  assert.equal(over.vars, null);
  assert.ok(over.problems.some((p) => p.code === 'PLUGIN_THEME_LIMIT'));
  const dropped = readThemeDeclaration({ vars: { '--text-hi': '#fff', '--nope': 'red', '--t-fast': 'url(http://x)' } }, { drop: true });
  assert.deepEqual(dropped.vars, { '--text-hi': '#fff' });
  const manifest = readPluginManifest({
    manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'cosmetic', scope: ['personal'],
    permissions: ['theme'], theme: { vars: { '--text-hi': '#f4faf7', '--line': '#2d3d37' } },
  }, ctx('night'));
  assert.deepEqual(manifest.problems, []);
  assert.equal(manifest.manifest.themeVars['--line'], '#2d3d37');
});

test('later plugin id wins a shared token; apply writes it and restore removes it', () => {
  const won = resolveThemeVars([
    { id: 'b-night', vars: { '--text-hi': '#111111', '--line': '#222222' } },
    { id: 'a-day', vars: { '--text-hi': '#ffffff' } },
  ]);
  assert.deepEqual(won.find((w) => w.name === '--text-hi'), { name: '--text-hi', value: '#111111', pluginId: 'b-night' });
  assert.equal(won.find((w) => w.name === '--line').pluginId, 'b-night');
  const calls = [];
  const root = { style: { setProperty(n, v) { calls.push(['set', n, v]); }, removeProperty(n) { calls.push(['del', n]); } } };
  let applied = applyThemeProperties(root, won, new Set());
  assert.ok(calls.some((c) => c[0] === 'set' && c[1] === '--text-hi' && c[2] === '#111111'));
  applied = applyThemeProperties(root, [], applied);
  assert.deepEqual(calls.filter((c) => c[0] === 'del').map((c) => c[1]).sort(), ['--line', '--text-hi']);
  assert.equal(applyThemeProperties(null, won, applied).size, 0);
  assert.equal(applyThemeProperties({ style: {} }, [{ name: '--text-hi', value: 'url(http://x)' }], new Set()).size, 0);
});

test('notices: good and bad shapes; the catalogue caps and the popup view', () => {
  const good = readNotices([{
    id: 'hello', title: '标题', body: '一行\nhttps://example.test 不是链接', date: '2026-10-11',
    i18n: { en: { title: 'Hello', body: 'Line\nhttps://example.test' }, 'zh-TW': { title: '標題', body: '內容' } },
  }]);
  assert.deepEqual(good.problems, []);
  assert.equal(good.notices[0].body.includes('<'), false);
  assert.match(good.notices[0].body, /https:\/\/example\.test/);
  const tagged = readNotices([{ id: 'tag', title: 'T', body: '<b>hi</b>' }]);
  assert.equal(tagged.notices[0].body, '<b>hi</b>', 'angle brackets stay text');
  assert.equal(readNotices({ id: 'a' }).problems[0].code, 'PLUGIN_NOTICE_SHAPE');
  assert.equal(readNotices([{ id: 'A', title: 'T', body: 'B' }]).problems[0].code, 'PLUGIN_NOTICE_SHAPE');
  assert.equal(readNotices([{ id: 'a', title: '', body: 'B' }]).problems[0].code, 'PLUGIN_NOTICE_TEXT');
  assert.equal(readNotices([{ id: 'a', title: 'a\nb', body: 'B' }]).problems[0].code, 'PLUGIN_NOTICE_TEXT');
  assert.equal(readNotices([{ id: 'a', title: 'T', body: 'B', extra: 1 }]).problems[0].code, 'PLUGIN_NOTICE_SHAPE');
  assert.equal(readNotices([{ id: 'a', title: 'T', body: 'B', date: '11-10-2026' }]).problems[0].code, 'PLUGIN_NOTICE_SHAPE');
  assert.equal(readNotices([{ id: 'a', title: 'T', body: 'B', i18n: { nope: { title: 'T', body: 'B' } } }]).problems[0].code, 'PLUGIN_NOTICE_LANG');
  assert.equal(readNotices([{ id: 'a', title: 'x'.repeat(81), body: 'B' }]).problems[0].code, 'PLUGIN_NOTICE_LIMIT');
  assert.equal(readNotices([{ id: 'a', title: 'T', body: 'y'.repeat(2001) }]).problems[0].code, 'PLUGIN_NOTICE_LIMIT');
  const tooMany = readNotices(Array.from({ length: NOTICE_LIMITS.perPlugin + 1 }, (_, i) => ({ id: `n${i}`, title: 'T', body: 'B' })));
  assert.equal(tooMany.notices, null);
  assert.ok(tooMany.problems.some((p) => p.code === 'PLUGIN_NOTICE_LIMIT'));
  const manifest = readPluginManifest({
    manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'cosmetic', scope: ['personal'],
    notices: [{ id: 'announcement', title: '公告', body: '正文' }],
  }, ctx('board'));
  assert.deepEqual(manifest.problems, [], manifest.problems.join());
  assert.deepEqual(manifest.warnings, []);
  assert.equal(manifest.manifest.notices[0].id, 'announcement');

  const entry = (id, notices, visual) => ({
    id, class: 'cosmetic', status: 'loaded', source: 'plugin', bytes: 1, count: 1,
    manifest: {
      manifest: 2, name: id, englishName: id, names: { zh: id }, description: {}, version: '1.0.0', app: '*', compatible: true, api: 1,
      scope: ['personal'], authors: [], credits: '', license: '', homepage: '',
      requires: {}, optional: {}, conflicts: {}, loadAfter: [], loadBefore: [], priority: 0, settings: {}, permissions: [],
      ...(notices ? { notices } : {}),
    },
    visual,
  });
  const bare = pluginIndexEntry(entry('bare', null, { vs: 'ab'.repeat(32), bytes: 0, ops: [] }));
  assert.equal(bare.vs, 'ab'.repeat(32), 'existing plugins keep their catalogue shape');
  assert.equal(bare.artBytes, 0);
  assert.equal(bare.notices, undefined);
  const only = pluginIndexEntry(entry('notes', [{ id: 'n', title: 'T', body: 'B' }], { vs: 'ab'.repeat(32), bytes: 0, ops: [] }));
  assert.equal(only.vs, undefined);
  const disabled = entry('off', datedNotice());
  disabled.status = 'disabled';
  assert.equal(pluginIndexEntry(disabled).notices, undefined);
  const art = pluginIndexEntry(entry('art', null, { vs: 'cd'.repeat(32), bytes: 0, ops: [{ at: ['chars'] }] }));
  assert.equal(art.vs, 'cd'.repeat(32));
  assert.equal(art.artBytes, 0);
  const dated = [{ id: 'old', title: 'O', body: 'B', date: '2020-01-01' }, { id: 'new', title: 'N', body: 'B', date: '2026-10-11' }];
  const index = buildPluginIndex([
    entry('z-plug', [{ id: 'plain', title: 'P', body: 'B' }]),
    entry('a-plug', dated),
  ]);
  const listed = collectNotices(index.plugins);
  assert.deepEqual(listed.map((n) => `${n.pluginId}/${n.id}`), ['a-plug/new', 'a-plug/old', 'z-plug/plain']);
  const view = noticeView([
    { id: 'a-plug', status: 'loaded', name: '甲', notices: [{ id: 'new', title: '原', body: '文', date: '2026-10-11', i18n: { en: { title: 'New', body: 'Body' } } }] },
    { id: 'off', status: 'disabled', notices: [{ id: 'x', title: 'T', body: 'B' }] },
  ], 'en', new Set(), (p) => p.name);
  assert.equal(view.notices.length, 1);
  assert.equal(view.notices[0].title, 'New');
  assert.equal(view.notices[0].pluginName, '甲');
  assert.equal(view.unread, true);
  const seen = markSeen(view.notices.map((n) => n.key), memStorage());
  assert.equal(noticeView([{ id: 'a-plug', status: 'loaded', name: '甲', notices: [{ id: 'new', title: '原', body: '文', i18n: { en: { title: 'New', body: 'Body' } } }] }], 'en', seen, (p) => p.name).unread, false);
  const boom = { getItem() { throw new Error('no store'); }, setItem() { throw new Error('no store'); } };
  assert.equal(readSeen(boom).size, 0);
  assert.equal(markSeen(['p/a'], boom).has('p/a'), true);

  const fat = 'x'.repeat(2000);
  const rows = Array.from({ length: 30 }, (_, i) => ({
    id: `p${String(i).padStart(2, '0')}`,
    notices: [{ id: 'n', title: 'T', body: fat, date: `2026-01-${String(i + 1).padStart(2, '0')}` }],
  }));
  const capped = capCatalogueNotices(rows);
  const kept = capped.flatMap((e) => e.notices || []);
  assert.ok(kept.length < 30);
  assert.ok(kept.length <= NOTICE_LIMITS.catalogue);
  assert.equal(capped[29].notices[0].id, 'n', 'the newest dated notice is kept');
  assert.equal(capped[0].notices, undefined, 'the oldest notice does not fit and is dropped');
  const small = Array.from({ length: 110 }, (_, i) => ({ id: `p${i}`, notices: [{ id: 'n', title: 'T', body: 'B' }] }));
  assert.equal(collectNotices(capCatalogueNotices(small)).length, NOTICE_LIMITS.catalogue);
  const escaped = rows.map((r) => ({ ...r, notices: [{ ...r.notices[0], body: '\n'.repeat(2000) + 'x', i18n: { en: { title: 'T', body: '\t'.repeat(2000) } } }] }));
  const payload = capCatalogueNotices(escaped).filter((e) => e.notices);
  const bytes = payload.reduce((n, p) => n + Buffer.byteLength(JSON.stringify(p.notices)), 0);
  assert.ok(bytes <= NOTICE_LIMITS.catalogueBytes, `${bytes} serialized bytes`);
});

function datedNotice() { return [{ id: 'n', title: 'T', body: 'B', date: '2026-01-01' }]; }

test('notice validation rejects impossible dates and malformed translations; storage getters may throw', () => {
  for (const date of ['2026-02-29', '2026-13-01', '0000-01-01', '2026-04-31']) assert.equal(readNotices([{ ...datedNotice()[0], date }]).notices, null, date);
  assert.equal(readNotices([{ ...datedNotice()[0], date: '2024-02-29' }]).problems.length, 0);
  for (const i18n of [{ en: [] }, { en: { title: 'T' } }, { en: { title: 'T', body: 'B', html: true } }, { en: { title: 'T', body: 'B' }, EN: { title: 'T', body: 'B' } }]) {
    assert.equal(readNotices([{ ...datedNotice()[0], i18n }]).notices, null);
  }
  assert.equal(readNotices([...datedNotice(), ...datedNotice()]).notices, null);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('blocked'); } });
  try {
    assert.equal(readSeen().size, 0);
    assert.equal(writeSeen(new Set(['p/n'])), false);
    assert.equal(markSeen(['p/n']).has('p/n'), true);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('Forge import: theme-only, variables beside a panel, and notices', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'w1-forge-'));
  // The product id is the pack id. pluginsDir must not already contain that folder (dry-run still refuses an existing dest).
  const pluginsDir = path.join(parent, 'out');
  fs.mkdirSync(pluginsDir);
  const opts = { dryRun: true, pluginsDir, root: ROOT, dataDir: path.join(ROOT, 'data'), vanilla };
  const why = (got) => JSON.stringify(got.report?.check || got.issues || got.report);
  const write = (id, pack, files = {}) => {
    const dir = path.join(parent, 'packs', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(pack));
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, typeof body === 'string' ? body : JSON.stringify(body));
    }
    return dir;
  };
  try {
    const night = write('theme-night', {
      id: 'theme-night', name: '夜间', version: '1.0.0',
      client: { theme: { vars: { '--text-hi': '#f4faf7', '--text-md': '#d3e3db', '--text-lo': '#a6bab1', '--text-dim': '#7f938a', '--line': '#2d3d37', '--line-2': '#23302b', '--nope': '#fff' } } },
    });
    const nightPlan = planForgeImport(mapOf(night));
    assert.deepEqual(nightPlan.roles, ['cosmetic']);
    assert.equal(nightPlan.meta.themeVars['--text-hi'], '#f4faf7');
    assert.equal(nightPlan.meta.themeVars['--nope'], undefined);
    assert.ok(nightPlan.meta.skipped.some((s) => s.code === 'PLUGIN_THEME_NAME' && s.path.endsWith('--nope')));
    const nightGot = await importForge(night, opts);
    assert.equal(nightGot.ok, true, why(nightGot));
    const nightReport = nightGot.report;
    assert.deepEqual(nightReport.products[0].permissions, ['theme']);
    assert.match(nightReport.products[0].imported.join('\n'), /--text-hi/);

    const lite = write('perf-lite', {
      id: 'perf-lite', name: '轻量', version: '1.0.0',
      client: {
        theme: { vars: { '--t-fast': '0s', '--ease-out': 'linear' } },
        panels: [{ id: 'lite', slot: 'root.overlays', module: 'client/lite.js', styles: ['client/lite.css'] }],
      },
    }, { 'client/lite.js': '/* not executed */', 'client/lite.css': '/* not executed */' });
    const liteGot = await importForge(lite, opts);
    assert.equal(liteGot.ok, true, why(liteGot));
    const liteReport = liteGot.report;
    assert.equal(liteReport.needsManualAdaptation, true);
    assert.match(liteReport.products[0].imported.join('\n'), /--t-fast/);
    assert.match(liteReport.markdown, /lite\.css/);

    const board = write('notice-board', {
      id: 'notice-board', name: '公告板', version: '1.0.0',
      notices: { announcement: 'notice/announcement.json', credits: 'notice/credits.json' },
    }, {
      'notice/announcement.json': { version: '1.0.0', date: '2026-10-11', summary: '上线', sections: [{ name: '变更', items: ['第一行', 'see https://example.test'] }] },
      'notice/credits.json': [{ name: '甲', note: '文案', url: 'https://example.test/a' }],
    });
    const boardPlan = planForgeImport(mapOf(board));
    assert.equal(boardPlan.meta.notices.length, 2);
    assert.equal(boardPlan.meta.notices[0].id, 'announcement');
    assert.equal(boardPlan.meta.notices[0].date, '2026-10-11');
    assert.match(boardPlan.meta.notices[0].title, /1\.0\.0/);
    assert.match(boardPlan.meta.notices[0].title, /上线/);
    assert.match(boardPlan.meta.notices[0].body, /变更\n第一行/);
    assert.match(boardPlan.meta.notices[1].body, /甲 — 文案\nhttps:\/\/example\.test\/a/);
    assert.equal(boardPlan.meta.notices[1].i18n.en.title, 'Credits');
    assert.equal(boardPlan.meta.notices[1].i18n['zh-TW'].title, '鳴謝');
    const boardGot = await importForge(board, opts);
    assert.equal(boardGot.ok, true, why(boardGot));
    const boardReport = boardGot.report;
    assert.deepEqual(boardReport.products[0].permissions, []);
    assert.match(boardReport.products[0].imported.join('\n'), /notices → announcement/);
    assert.match(boardReport.products[0].imported.join('\n'), /notices → credits/);

    // Announcements ride on rule packs even while their gameplay conversion belongs to another branch.
    for (const id of ['morph-plus', 'prep-loadout', 'shop-bond-bias', 'unequip']) {
      const dir = write(id, { id, version: '1.0.0', combat: true, behaviour: [{ switch: 'example', option: 'enabled' }], notices: { announcement: 'notice/announcement.json' } }, {
        'notice/announcement.json': { version: '1.0.0', date: '2026-10-17', summary: id, sections: [] },
      });
      const plan = planForgeImport(mapOf(dir));
      assert.ok(plan.roles.includes('cosmetic'), id);
      assert.equal(plan.meta.notices[0].body, id);
    }
    const missing = write('missing-notice', { id: 'missing-notice', version: '1.0.0', notices: { announcement: 'notice/missing.json' } });
    const missingPlan = planForgeImport(mapOf(missing));
    assert.equal(missingPlan.meta.notices.length, 0, 'a missing file is not displayed as a path string');
    assert.ok(missingPlan.meta.skipped.some((s) => s.path === 'notices.announcement'));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('notice catalogue hint reaches health and welcome, and is omitted when absent', () => {
  const cs = 'ab'.repeat(32);
  for (const present of [true, false]) {
    const plugins = { hasNotices: () => present, unofficial: () => 0 };
    const lobby = { plugins, stats: () => ({}) };
    const health = healthReport({ startedAt: Date.now(), network: { connectionCount: 0 }, registry: { size: 0 }, lobby, content: { cs } });
    const welcome = Lobby.prototype.welcomeInfo.call({ vanilla: { cs }, plugins });
    assert.deepEqual(health.content, { vanilla: cs, sets: 0, ...(present ? { notices: true } : {}) });
    assert.deepEqual(welcome.content, { vanilla: cs, ...(present ? { notices: true } : {}) });
  }
});

test('notices are not part of a content set hash', (t) => {
  const fx = fixture(t);
  const id = 'notehash';
  fx.put(id, { permissions: ['data.patch'], data: ['data/patch.json'] }, { 'data/patch.json': { patch: 1, ops: [] } });
  const a = buildContentSet({ registry: fx.registry, ids: [id] });
  assert.equal(a.problems.length, 0, JSON.stringify(a.problems));
  const sets = createContentSets({ registry: fx.registry, vanillaData: {} });
  const selected = sets.resolve([id]);
  assert.equal(selected.ok, true);
  sets.hold(selected.set.cs);
  const stale = [];
  sets.onStale((...args) => stale.push(args));
  const file = path.join(fx.dir, 'plugins', id, 'plugin.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const snapshot = fx.registry.plugin(id).content.hash;
  for (const notices of [datedNotice(), [{ id: 'hello', title: 'Hi', body: 'Changed body only' }], [], undefined]) {
    if (notices === undefined) delete doc.notices; else doc.notices = notices;
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));
    fx.registry.rescan();
    const b = buildContentSet({ registry: fx.registry, ids: [id] });
    assert.equal(b.problems.length, 0, JSON.stringify(b.problems));
    assert.equal(b.cs, a.cs, 'notice add/edit/empty/remove keeps cs');
    assert.equal(fx.registry.plugin(id).content.hash, snapshot, 'same gameplay snapshot');
    assert.deepEqual(b.plugins, a.plugins, 'same room-facing hashes');
    assert.deepEqual(stale, [], 'no gameplay-stale notification for catalogue-only changes');
    assert.equal(sets.resolve([id]).set.cs, selected.set.cs);
  }
  sets.release(selected.set.cs);
  sets.close();
});

test('registry checks theme files and delivers capped notices independently of room selection', (t) => {
  const fx = fixture(t);
  const baseline = buildContentSet({ registry: fx.registry, ids: [] });
  fx.put('theme-file', { class: 'cosmetic', scope: ['personal'], permissions: ['theme'], theme: 'theme.json', notices: datedNotice() }, { 'theme.json': { vars: { '--text-hi': '#abc' } } });
  const item = fx.registry.pluginIndex().plugins.find((p) => p.id === 'theme-file');
  assert.deepEqual(item.theme, { vars: { '--text-hi': '#abc' } });
  assert.deepEqual(item.notices, datedNotice());
  assert.equal(item.vs, undefined);
  assert.equal(buildContentSet({ registry: fx.registry, ids: [] }).cs, baseline.cs);
  const sets = createRoomSets({ registry: fx.registry, visual: null, contents: null, policy: null });
  assert.equal(sets.hasNotices(), true);
  fx.put('theme-file', { class: 'cosmetic', scope: ['personal'], permissions: ['theme'], theme: 'theme.json' }, { 'theme.json': { vars: { '--text-hi': 'var(--red)' } } });
  assert.equal(fx.registry.plugin('theme-file'), null);
  assert.equal(sets.hasNotices(), false);

  fx.put('lang-notice', { class: 'lang', lang: 'fr', scope: ['personal'], permissions: [], files: { ui: 'ui.json' }, notices: datedNotice() }, { 'ui.json': { _meta: { name: 'Français' } } });
  assert.ok(fx.registry.pluginIndex().plugins.find((p) => p.id === 'lang-notice')?.notices);
  assert.equal(sets.hasNotices(), true, 'language plugins also advertise notices');
});

for (const mode of ['sandbox', 'trusted']) test(`${mode} script notice add/edit/remove keeps content identity and raw lock verification`, (t) => {
  const fx = scriptFixture(t, { mode });
  const source = 'export default sp => {};';
  fx.put('note-script', source);
  const a = buildContentSet({ registry: fx.registry, ids: ['note-script'] });
  assert.deepEqual(a.problems, []);
  verifyScripts(a.scripts, a.index);
  assert.equal(JSON.parse(a.scripts[0].manifestSource).notices, undefined);
  const sets = createContentSets({ registry: fx.registry, vanillaData: {} });
  t.after(() => sets.close());
  const selected = sets.resolve(['note-script']);
  sets.hold(selected.set.cs);
  const stale = [];
  sets.onStale((...args) => stale.push(args));
  const rawHashes = new Set([fx.registry.plugin('note-script').script.lockHash]);
  for (const extra of [{ notices: datedNotice() }, { notices: [{ id: 'updated', title: 'Updated', body: 'Different text' }] }, {}]) {
    fx.put('note-script', source, extra);
    const p = fx.registry.plugin('note-script');
    assert.equal(p.script.lockValid, true);
    assert.equal(nodeSha256(Buffer.from(p.script.manifestSource)), p.content.files['plugin.json'], 'raw bytes still verify');
    rawHashes.add(p.script.lockHash);
    const b = buildContentSet({ registry: fx.registry, ids: ['note-script'] });
    assert.deepEqual(b.problems, []);
    verifyScripts(b.scripts, b.index);
    assert.equal(b.cs, a.cs);
    assert.deepEqual(b.scripts, a.scripts, 'canonical descriptor for absent and present notices');
    assert.deepEqual(b.plugins, a.plugins);
    assert.deepEqual(stale, []);
  }
  assert.equal(rawHashes.size, 3, 'lock pins retain the complete notice-sensitive bytes');
});

for (const packed of [false, true]) test(`art notice and theme edits keep vs and room hashes (${packed ? 'locked' : 'unlocked'})`, (t) => {
  const fx = fixture(t);
  const dir = fx.put('art-news', { class: 'cosmetic', scope: ['personal', 'room'], permissions: ['assets.override', 'theme'],
    assets: { chars: { char_102_texas: { avatar: 'avatar.png' } } }, theme: 'theme.json',
  }, { 'theme.json': { vars: { '--t-fast': '0s' } } });
  fs.writeFileSync(path.join(dir, 'avatar.png'), png());
  const rescan = () => { if (packed) assert.equal(packPlugin(dir).wrote, true); fx.registry.rescan(); };
  rescan();
  const visual = createVisualSets({ registry: fx.registry });
  t.after(() => visual.close());
  const a = visual.resolve(['art-news']);
  assert.equal(a.ok, true);
  visual.hold(a.set.vs);
  const stale = [];
  visual.onStale((...args) => stale.push(args));
  const file = path.join(dir, 'plugin.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const notices of [datedNotice(), [{ id: 'n', title: 'News', body: 'Edited' }], undefined]) {
    if (notices === undefined) delete doc.notices; else doc.notices = notices;
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));
    rescan();
    const b = visual.resolve(['art-news']);
    assert.equal(b.set.vs, a.set.vs);
    assert.deepEqual(b.set.plugins, a.set.plugins);
    assert.deepEqual(stale, []);
  }
  for (const theme of [{ vars: { '--t-fast': '1s' } }, { vars: { '--t-fast': '2s' } }]) {
    doc.theme = theme;
    fs.writeFileSync(file, JSON.stringify(doc));
    fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify(theme));
    rescan();
    const b = visual.resolve(['art-news']);
    assert.equal(b.set.vs, a.set.vs, 'inline and file theme values stay personal');
    assert.deepEqual(b.set.plugins, a.set.plugins);
    assert.deepEqual(stale, []);
  }
  fs.writeFileSync(path.join(dir, 'avatar.png'), png(5));
  rescan();
  assert.notEqual(visual.resolve(['art-news']).set.vs, a.set.vs, 'real art changes still invalidate');
  assert.equal(stale.length, 1);
});

test('an oversized valid notice cannot suppress another plugin, even near the remaining byte cap', (t) => {
  const fat = { id: 'fat', title: 'T', body: '汉'.repeat(2000), date: '9999-12-31',
    i18n: Object.fromEntries(['en', 'ja', 'ko', 'zh-TW', 'fr', 'de', 'es', 'it'].map((code) => [code, { title: 'T', body: '汉'.repeat(2000) }])) };
  assert.deepEqual(readNotices([fat]).problems, []);
  const normal = { id: 'normal', title: 'T', body: 'B' };
  const fx = fixture(t);
  fx.put('hostile', { class: 'cosmetic', scope: ['personal'], permissions: [], notices: [fat] });
  fx.put('normal', { class: 'cosmetic', scope: ['personal'], permissions: [], notices: [normal] });
  assert.equal(fx.registry.plugin('hostile').status, 'loaded');
  assert.deepEqual(collectNotices(fx.registry.pluginIndex().plugins).map((n) => n.id), ['normal']);
  const rows = Array.from({ length: 24 }, (_, i) => ({ id: `p${i}`, notices: [{ id: 'n', title: 'T', body: 'x'.repeat(2000), date: '2026-10-17' }] }));
  const capped = capCatalogueNotices([...rows, { id: 'normal', notices: [normal] }]);
  assert.equal(capped.find((p) => p.id === 'normal').notices.length, 1, 'skip a non-fitting entry and continue');
});

test('theme raw values are bounded before trimming or parsing, inline and in files', (t) => {
  const fx = fixture(t);
  const boundary = '0'.repeat(399) + 's';
  const over = '0'.repeat(400) + 's';
  assert.equal(acceptThemeValue('--t-fast', boundary), boundary);
  for (const value of [over, ' '.repeat(400) + '0s', '0'.repeat(1024 * 1024) + 's']) {
    assert.equal(acceptThemeValue('--t-fast', value), null);
    assert.equal(readThemeDeclaration({ vars: { '--t-fast': value } }).vars, null);
  }
  for (const fromFile of [false, true]) {
    fx.put('oversized', { class: 'cosmetic', scope: ['personal'], permissions: ['theme'],
      theme: fromFile ? 'theme.json' : { vars: { '--t-fast': over } },
    }, fromFile ? { 'theme.json': { vars: { '--t-fast': over } } } : {});
    assert.equal(fx.registry.plugin('oversized'), null, 'registry refuses oversized values');
  }
});

test('ui notice add/edit/remove keeps the frame visual identity and file hashes', (t) => {
  const fx = fixture(t);
  const manifest = { class: 'ui', scope: ['personal'], permissions: ['ui.frame'], entry: { client: 'ui/index.html' }, slots: ['hud.right'] };
  fx.put('frame-news', manifest, { 'ui/index.html': '<p>Frame</p>' });
  const before = fx.registry.plugin('frame-news').ui;
  for (const extra of [{ notices: datedNotice() }, { notices: [{ id: 'n', title: 'Edited', body: 'Body' }] }, {}]) {
    fx.put('frame-news', { ...manifest, ...extra });
    const after = fx.registry.plugin('frame-news').ui;
    assert.equal(after.vs, before.vs);
    assert.equal(after.hash, before.hash);
    assert.deepEqual(after.frameFiles, before.frameFiles);
  }
});

test('trusted personal theme values never enter gameplay descriptors or room-facing hashes', (t) => {
  const fx = scriptFixture(t);
  const manifest = { class: 'trusted', permissions: ['sim.code', 'theme'], theme: 'theme.json' };
  fx.put('theme-script', 'export default sp => {};', manifest, { 'theme.json': { vars: { '--t-fast': '0s' } } });
  const a = buildContentSet({ registry: fx.registry, ids: ['theme-script'] });
  assert.deepEqual(a.problems, []);
  for (const theme of ['theme.json', { vars: { '--t-fast': '2s' } }]) {
    fx.put('theme-script', 'export default sp => {};', { ...manifest, theme }, { 'theme.json': { vars: { '--t-fast': '1s' } } });
    const b = buildContentSet({ registry: fx.registry, ids: ['theme-script'] });
    assert.deepEqual(b.problems, []);
    verifyScripts(b.scripts, b.index);
    assert.equal(b.cs, a.cs);
    assert.deepEqual(b.plugins, a.plugins);
    assert.deepEqual(b.scripts, a.scripts);
    assert.equal(JSON.parse(b.scripts[0].manifestSource).theme, undefined);
  }
});

function memStorage() {
  const mem = new Map();
  return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, v); } };
}

function mapOf(dir) {
  const files = new Map();
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs)) {
      const p = path.join(abs, name);
      const next = rel ? `${rel}/${name}` : name;
      if (fs.statSync(p).isDirectory()) walk(p, next);
      else files.set(next, fs.readFileSync(p));
    }
  };
  walk(dir, '');
  return files;
}
