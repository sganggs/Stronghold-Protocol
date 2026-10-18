// Interface plugins (DESIGN §32.8): message shape and rate, storage quota, slot allocation, the registry accepting
// and refusing a ui manifest, the /p/ CSP header, and a ui plugin leaving `cs` alone (it does count toward `vs`).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { C2S } from '../../shared/protocol.js';
import { UI_SLOT_IDS, readPluginManifest, classStatus } from '../../shared/plugins/manifest.js';
import {
  UI_ERRORS, UI_FRAME_CSP, UI_LIMITS, UI_SLOTS, battlePayload, checkStorageWrite, clampHeight, clampNotice,
  createNoticeLimiter, createRateLimiter, createSlotTable, frameEntryAllowed, frameLoadDecision, framePageUrl,
  hostNet, hostResult, hostState, hostWelcome, isIntentType, isMatchIntent, namespacedStorageKey, netSlot,
  sanitizeEvent, subsetPrivate, subsetPublic, subsetResult, subsetRoom, validateHostMessage, validatePluginMessage,
} from '../../shared/plugins/ui.js';
import { createPluginRegistry, readPluginFolder, scanPlugins } from '../../server/plugins/registry.js';
import { createVisualSets } from '../../server/plugins/visualSet.js';
import { createStaticHandler } from '../../server/http/static.js';
import { computeVanillaContent, servedCodeFiles } from '../../server/plugins/identity.js';
import { splitUrl } from '../../server/http/common.js';
import { ERR } from '../../shared/constants.js';
import { writePlugin, cosmetic } from '../helpers/pluginFixtures.js';
import { setUiPlugin, toggleRecommend, uiPlugins, uiRecommend, visibleRecommend } from '../../public/js/ui/uiPlugins.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const uiManifest = (extra = {}) => ({
  manifest: 2, name: { zh: '伤害统计', en: 'Damage tally' }, description: { zh: '只读的伤害合计' },
  version: '1.0.0', app: '*', api: 1, class: 'ui', scope: ['personal'], permissions: ['ui.frame'],
  entry: { client: 'ui/index.html' }, slots: ['hud.right'], ...extra,
});

/** A tiny checkout: data/assets.json so a ui plugin has a `vs`, one cosmetic file, one ui frame. */
function rootWith(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ui-'));
  const put = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  put('data/assets.json', '{}\n');
  put('public/index.html', '<!doctype html>');
  fs.mkdirSync(path.join(root, 'packs'));
  for (const [rel, body] of Object.entries(files)) put(rel, body);
  return root;
}

function schemaMatches(schema, value, root) {
  if (schema == null || typeof schema !== 'object') return false;
  if (schema.$ref) return schemaMatches(root.$defs[schema.$ref.replace('#/$defs/', '')], value, root);
  if (schema.oneOf) return schema.oneOf.some((s) => schemaMatches(s, value, root));
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  // A const, an enum, or an empty schema (a storage value) has no type of its own.
  if (!schema.type) return true;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const props = schema.properties || {};
    const keys = Object.keys(value);
    if (schema.additionalProperties === false && keys.some((k) => !Object.prototype.hasOwnProperty.call(props, k))) return false;
    if ((schema.required || []).some((k) => !Object.prototype.hasOwnProperty.call(value, k))) return false;
    return keys.every((k) => !props[k] || schemaMatches(props[k], value[k], root));
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return false;
    if (schema.minLength != null && value.length < schema.minLength) return false;
    if (schema.maxLength != null && value.length > schema.maxLength) return false;
    return true;
  }
  if (schema.type === 'integer') return Number.isInteger(value);
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'array') return Array.isArray(value) && (!schema.items || value.every((x) => schemaMatches(schema.items, x, root)));
  return false;
}

describe('the postMessage contract', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/ui.schema.json'), 'utf8'));

  test('the schema lists the same slots the host grants', () => {
    assert.deepEqual(schema.$defs.slot.enum, [...UI_SLOTS]);
    assert.deepEqual([...UI_SLOTS], [...UI_SLOT_IDS]);
  });

  test('a plugin message agrees with the schema, and every client intent is rejected', () => {
    const yes = [
      { v: 1, t: 'ready' },
      { v: 1, t: 'slot', slot: 'hud.right' },
      { v: 1, t: 'resize', height: 72 },
      { v: 1, t: 'notice', text: '准备好了' },
      { v: 1, t: 'stats', unitId: 3 },
      { v: 1, t: 'stats', unitId: 3, fieldId: 'f1' },
      { v: 1, t: 'storage', op: 'keys' },
      { v: 1, t: 'storage', op: 'get', key: 'total' },
      { v: 1, t: 'storage', op: 'set', key: 'total', value: 4 },
      { v: 1, t: 'storage', op: 'delete', key: 'total' },
    ];
    const no = [
      { v: 1, t: 'ready', extra: true },
      { v: 1, t: 'slot', slot: 'nope' },
      { v: 1, t: 'resize', height: '72' },
      { v: 2, t: 'ready' },
      { v: 1, t: 'g.buy', slot: 0 },
      { v: 1, t: 'ready', nested: { t: 'g.buy' } },
      null,
      'hello',
    ];
    for (const msg of yes) {
      assert.equal(schemaMatches(schema, msg, schema), true, JSON.stringify(msg));
      const r = validatePluginMessage(msg);
      assert.equal(r.ok, true, JSON.stringify(msg));
    }
    for (const msg of no) {
      assert.equal(schemaMatches(schema, msg, schema), false, JSON.stringify(msg));
      const r = validatePluginMessage(msg);
      assert.equal(r.ok, false, JSON.stringify(msg));
    }
    const nested = validatePluginMessage({ v: 1, t: 'ready', nested: { t: 'g.buy' } });
    assert.equal(nested.reason, 'intent');
    const buy = validatePluginMessage({ v: 1, t: 'g.buy', slot: 0 });
    assert.equal(buy.reason, 'intent');
    for (const key of Object.keys(C2S)) {
      assert.equal(isIntentType(key), true, key);
      const r = validatePluginMessage({ v: 1, t: key });
      assert.equal(r.ok, false, key);
      assert.equal(r.reason, 'intent', key);
    }
    assert.equal(validatePluginMessage({ v: 1, t: 'welcome' }).reason, 'shape');
  });

  test('the rate limit, the storage quota and the slot table', () => {
    let now = 1_000;
    const lim = createRateLimiter({ now: () => now });
    for (let i = 0; i < UI_LIMITS.burst; i++) assert.equal(lim.allow('p'), true);
    assert.equal(lim.allow('p'), false);
    now += 1_000;
    assert.equal(lim.allow('p'), true);

    /** @type {Record<string, string>} */
    const entries = Object.create(null);
    const ok = checkStorageWrite(entries, 'total', 4);
    assert.equal(ok.ok, true);
    entries.total = ok.text;
    assert.equal(namespacedStorageKey('damage-meter', 'total'), 'sp.plugin.damage-meter.total');
    assert.equal(namespacedStorageKey('damage-meter', '../x'), null);
    assert.equal(checkStorageWrite(entries, '__proto__', 1).error, UI_ERRORS.PLUGIN_STORAGE);
    assert.equal(checkStorageWrite(entries, 'n', { t: 'g.buy' }).error, UI_ERRORS.PLUGIN_INTENT);
    assert.equal(isMatchIntent({ t: 'b.snap', units: [] }), false, 'the host snapshot label is not a client intent');
    assert.equal(isMatchIntent({ t: 'b.snap', nested: { t: 'g.buy' } }), true, 'a real intent nested under b.snap is still refused');
    assert.equal(checkStorageWrite(Object.create(null), 'snap', { t: 'b.snap', units: [] }).ok, true);
    assert.equal(checkStorageWrite(entries, 's', 'hello').ok, true, 'a plain string is not an intent');
    const cjk = checkStorageWrite(Object.create(null), 'cjk', '测'.repeat(1365));
    assert.equal(cjk.ok, false, 'UTF-8 bytes of the JSON, not UTF-16 code units');
    assert.equal(checkStorageWrite(Object.create(null), 'edge', 'x'.repeat(4094)).ok, true, '4096 UTF-8 bytes with the quotes is allowed');
    const big = checkStorageWrite(entries, 'big', 'x'.repeat(UI_LIMITS.storageValueBytes));
    assert.equal(big.ok, false);
    for (let i = 0; i < UI_LIMITS.storageKeys - 1; i++) entries['k' + i] = '1';
    assert.equal(checkStorageWrite(entries, 'overflow', 1).ok, false);

    const table = createSlotTable();
    assert.equal(table.request('a', 'hud.right', ['hud.right']).ok, true);
    assert.equal(table.request('b', 'hud.right', ['hud.right']).error, UI_ERRORS.PLUGIN_SLOT);
    assert.equal(table.request('a', 'nope', ['hud.right']).error, UI_ERRORS.PLUGIN_SLOT);
    assert.equal(table.request('a', 'room.panel', ['hud.right', 'room.panel']).ok, true);
    assert.equal(table.holder('hud.right'), null);
    assert.equal(table.holder('room.panel'), 'a');
    table.release('a');
    assert.equal(table.slotOf('a'), null);
    assert.equal(table.request('b', 'room.panel', ['room.panel']).ok, true);

    assert.equal(clampHeight(10), UI_LIMITS.heightMin);
    assert.equal(clampHeight(9000), UI_LIMITS.heightMax);
    assert.equal(clampHeight(Number.NaN), null);
    assert.equal(clampNotice('  too   wide  '), 'too wide');
    assert.equal(clampNotice('x'.repeat(81)), null);

    let noticeAt = 0;
    const notices = createNoticeLimiter({ now: () => noticeAt });
    assert.equal(notices.allow('p', '同一句'), true);
    assert.equal(notices.allow('p', '同一句'), true, 'the same text is not delayed, so toasts can merge it');
    assert.equal(notices.allow('p', '另一句'), false);
    noticeAt += UI_LIMITS.noticeIntervalMs - 1;
    assert.equal(notices.allow('p', '另一句'), false);
    assert.equal(notices.allow('p', '同一句'), true, 'repeating the same text does not move the window');
    noticeAt += 1;
    assert.equal(notices.allow('p', '另一句'), true);
  });

  test('the private view is an allowlist', () => {
    const priv = subsetPrivate({
      playerId: 'p', seat: 0, alive: true, lp: 3, funds: 10, loadout: { secret: true }, ops: [1],
      token: 'no', diy: { a: 1 }, effects: ['x'], nextEnemies: [1], personalChoice: 'hidden',
      hand: [{ uid: 1, kind: 'chess', id: 'a', secret: 'no' }],
      stats: { dmgDealt: 4, kills: 1, leaks: 0, gold: 2, refreshes: 9 },
    });
    assert.equal(priv.loadout, undefined);
    assert.equal(priv.ops, undefined);
    assert.equal(priv.token, undefined);
    assert.equal(priv.diy, undefined);
    assert.equal(priv.effects, undefined);
    assert.equal(priv.nextEnemies, undefined);
    assert.equal(priv.personalChoice, undefined);
    assert.equal(priv.hand[0].secret, undefined);
    assert.equal(priv.stats.refreshes, undefined);
    assert.equal(priv.stats.dmgDealt, 4);
    const pub = subsetPublic({ phase: 'PREP', players: [{ playerId: 'p', name: '凯尔希', hand: [1] }], hiddenBossId: 'x' });
    assert.equal(pub.hiddenBossId, undefined);
    assert.equal(pub.players[0].hand, undefined);
    assert.equal(pub.players[0].name, '凯尔希');
  });

  test('a battle push drops a snapshot that does not fit, and the frame URL stays inside /p/', () => {
    const small = battlePayload({ fieldId: 'f', gt: 1, events: [{ t: 'damage', amount: 4, secret: { a: 1 } }], snap: { hp: 1 } });
    assert.equal(small.events[0].secret, undefined);
    assert.equal(small.events[0].amount, 4);
    assert.equal(small.truncated, false);
    const dmg = sanitizeEvent(['dmg', 12, 480, 'phys']);
    assert.deepEqual(dmg, { t: 'dmg', unitId: 12, amount: 480, kind: 'phys' });
    const crit = sanitizeEvent(['dmg', 12, 480, 'phys', 'r']);
    assert.equal(crit.amount, 480);
    assert.equal(crit.unitId, 12);
    assert.equal(crit.crit, true);
    assert.deepEqual(sanitizeEvent(['heal', 7, 30]), { t: 'heal', unitId: 7, amount: 30 });
    const atk = sanitizeEvent(['atk', 3, 9, 'phys']);
    assert.equal(atk.amount, undefined);
    assert.equal(atk.sourceId, 3);
    assert.equal(atk.targetId, 9);
    const spawn = sanitizeEvent(['spawn', { id: 1, defId: 'a', loadout: { secret: 1 }, diy: { a: 1 } }]);
    assert.deepEqual(spawn, { t: 'spawn' });
    assert.equal(JSON.stringify(spawn).includes('loadout'), false);
    const units = battlePayload({ fieldId: 'f', gt: 1, events: [], snap: { units: Array.from({ length: 40 }, (_, i) => ['u', i, 1]) } });
    assert.equal(units.snap.units.length, 32);
    assert.equal(units.truncated, true, 'a 32-item cut is truncated even when the JSON is far under 48 KB');
    const cut = battlePayload({ fieldId: 'f', gt: 1, events: [], snap: { name: 'x'.repeat(121) } });
    assert.equal(cut.snap.name.length, 120);
    assert.equal(cut.truncated, true);
    const wideKeys = {};
    for (let i = 0; i < 25; i++) wideKeys['k' + i] = i;
    const keysCut = battlePayload({ fieldId: 'f', gt: 1, events: [], snap: wideKeys });
    assert.equal(Object.keys(keysCut.snap).length, 24);
    assert.equal(keysCut.truncated, true);
    let deep = { v: 1 };
    for (let i = 0; i < 5; i++) deep = { n: deep };
    const deepCut = battlePayload({ fieldId: 'f', gt: 1, events: [], snap: deep });
    assert.equal(deepCut.truncated, true);
    assert.ok(deepCut.snap);
    const stamped = battlePayload({ fieldId: 'f', gt: 2, events: [], snap: { t: 'b.snap', units: [[1, 0, 0]], fieldId: 'f', gt: 2 } });
    assert.equal(stamped.snap.t, undefined);
    assert.deepEqual(stamped.snap.units, [[1, 0, 0]]);
    assert.equal(stamped.truncated, false);
    assert.equal(frameLoadDecision(1), 'entry');
    assert.equal(frameLoadDecision(2), 'destroy');
    assert.equal(frameLoadDecision(3), 'destroy');
    assert.equal(frameLoadDecision(0), 'destroy');
    assert.match(UI_FRAME_CSP, /(^|; )sandbox allow-scripts(;|$)/);
    assert.doesNotMatch(UI_FRAME_CSP, /allow-same-origin/);
    assert.match(UI_FRAME_CSP, /frame-ancestors 'self'/);
    assert.match(UI_FRAME_CSP, /base-uri 'none'/);
    assert.match(UI_FRAME_CSP, /form-action 'none'/);
    // plainClone caps each string at 120 characters, so one long string still fits; a wide tree does not.
    const row = {};
    for (let i = 0; i < 24; i++) row['k' + i] = 'x'.repeat(200);
    const wide = {};
    for (let i = 0; i < 24; i++) wide['r' + i] = { ...row };
    const huge = battlePayload({ fieldId: 'f', gt: 1, events: [], snap: wide });
    assert.equal(huge.snap, null);
    assert.equal(huge.truncated, true);
    const url = framePageUrl('damage-meter', 'ui/index.html', 'ab'.repeat(32));
    assert.equal(url, '/p/damage-meter/abababab/ui/index.html');
    assert.equal(frameEntryAllowed('damage-meter', '/p/damage-meter/abababab/ui/index.html'), true);
    assert.equal(frameEntryAllowed('damage-meter', '/p/other-plug/abababab/ui/index.html'), false);
    assert.equal(frameEntryAllowed('damage-meter', '/p/damage-meter/abababab/../plugin.json'), false);
    assert.equal(framePageUrl('damage-meter', '../x.html', 'ab'.repeat(32)), null);
  });
});

describe('the registry and /p/', () => {
  let root;
  let server;
  let registry;
  const dirs = () => ({
    publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'),
    packsDir: path.join(root, 'packs'), pluginsDir: path.join(root, 'plugins'),
  });
  const get = (rawPath, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: rawPath, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });

  before(async () => {
    const html = fs.readFileSync(path.join(ROOT, 'plugins/_template/ui/ui/index.html'));
    root = rootWith({});
    writePlugin(path.join(root, 'plugins/damage-meter'), uiManifest(), {
      'ui/index.html': html, 'ui/icon.png': 'png', 'README.md': '# tally\n',
    });
    writePlugin(path.join(root, 'plugins/skin'), cosmetic({
      permissions: ['assets.add'], assets: { chars: { char_102_texas: { avatar: 'art/a.png' } } },
    }), { 'art/a.png': 'png' });
    const bad = [
      ['plugins/no-entry', uiManifest({ entry: undefined, slots: ['hud.right'] })],
      ['plugins/bad-slot', uiManifest({ slots: ['hud.left'] })],
      ['plugins/outside', uiManifest()],
      ['plugins/cosmetic-slots', cosmetic({ slots: ['hud.right'], assets: { chars: { char_102_texas: { avatar: 'a.png' } } } })],
    ];
    for (const [rel, manifest] of bad) {
      const files = rel.endsWith('outside') ? { 'ui/index.html': '<p></p>', 'art/x.png': 'png' } : { 'ui/index.html': '<p></p>', 'a.png': 'png' };
      writePlugin(path.join(root, rel), manifest, files);
    }
    writePlugin(path.join(root, 'plugins/linked'), uiManifest(), { 'ui/index.html': '<p></p>' });
    try {
      const outside = path.join(root, 'secret.html');
      fs.writeFileSync(outside, 'no');
      fs.symlinkSync(outside, path.join(root, 'plugins/linked/ui/link.html'));
    } catch { /* a file system without links still has the other checks */ }
    registry = createPluginRegistry({ ...dirs(), sharedDir: path.join(ROOT, 'shared') }, { recheckMs: 0 });
    const sets = createVisualSets({ registry });
    const handler = createStaticHandler({
      ...dirs(), sharedDir: path.join(ROOT, 'shared'), simDir: path.join(ROOT, 'server/sim'),
      packs: registry, visual: sets, content: { cs: 'ab'.repeat(32), index: { plugins: [] } },
    });
    server = http.createServer((req, res) => {
      const p = splitUrl(req.url);
      handler(req, res, p.rawPath, p.query).catch(() => res.destroy());
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(() => new Promise((resolve) => {
    server.close(() => { fs.rmSync(root, { recursive: true, force: true }); resolve(); });
  }));

  test('a ui manifest is loaded, a bad one is not, and the catalogue names the frame without a disk path', () => {
    const scan = scanPlugins(dirs());
    const ui = scan.plugins.find((p) => p.id === 'damage-meter');
    assert.ok(ui, scan.skipped.map((s) => `${s.where}: ${s.problems.join('; ')}`).join('\n'));
    assert.equal(ui.class, 'ui');
    assert.equal(ui.status, 'loaded');
    assert.equal(ui.visual, undefined);
    assert.ok(ui.ui.vs && ui.ui.vs.length === 64);
    assert.equal(ui.ui.entry, 'ui/index.html');
    assert.deepEqual(ui.ui.slots, ['hud.right']);
    assert.equal(typeof ui.ui.frameFiles['ui/index.html'], 'string');
    assert.equal(ui.ui.frameFiles['plugin.json'], undefined, 'plugin.json is hashed into vs and not served');
    const index = registry.pluginIndex({ vanilla: 'cd'.repeat(32) });
    const entry = index.plugins.find((p) => p.id === 'damage-meter');
    assert.equal(entry.vs, ui.ui.vs);
    assert.equal(entry.frameBytes, ui.ui.bytes);
    assert.equal(entry.entry, 'ui/index.html');
    assert.deepEqual(entry.slots, ['hud.right']);
    assert.equal(JSON.stringify(index).includes(root), false);
    const skipped = new Map(scan.skipped.map((s) => [s.where, s.problems.join('\n')]));
    assert.match(skipped.get('plugins/no-entry/'), /entry\.client/);
    assert.match(skipped.get('plugins/bad-slot/'), /slots/);
    assert.match(skipped.get('plugins/outside/'), /outside the folder of entry\.client/);
    assert.match(skipped.get('plugins/cosmetic-slots/'), /not something a cosmetic plugin carries/);
    if (skipped.has('plugins/linked/')) assert.match(skipped.get('plugins/linked/'), /symbolic link/);
    assert.equal(classStatus('ui'), 'loaded');
    assert.equal(classStatus('script'), 'loaded');
  });

  test('the template folder itself is a valid ui plugin and is not scanned from plugins/_template', () => {
    const tpl = readPluginFolder(path.join(ROOT, 'plugins/_template/ui'), { vanilla: { manifest: null, sha256: null } });
    assert.deepEqual(tpl.problems, []);
    assert.equal(tpl.plugin.status, 'loaded');
    assert.equal(tpl.plugin.id, 'ui');
    const scan = scanPlugins(dirs());
    assert.equal(scan.plugins.some((p) => p.where.includes('_template')), false);
  });

  test('/p/ sends the frame CSP for a ui file, and not for cosmetic art', async () => {
    const ui = registry.plugin('damage-meter');
    const file = ui.ui.served.get('ui/index.html');
    const hash = file.sha256.slice(0, 8);
    const url = `/p/damage-meter/${hash}/ui/index.html`;
    const first = await get(url);
    assert.equal(first.status, 200);
    assert.equal(first.headers['content-security-policy'], UI_FRAME_CSP);
    assert.match(first.headers['cache-control'], /immutable/);
    const again = await get(url, { 'if-none-match': first.headers.etag });
    assert.equal(again.status, 304);
    assert.equal(again.headers['content-security-policy'], UI_FRAME_CSP);
    const png = await get(`/p/damage-meter/${ui.ui.served.get('ui/icon.png').sha256.slice(0, 8)}/ui/icon.png`);
    assert.equal(png.status, 200);
    assert.equal(png.headers['content-security-policy'], UI_FRAME_CSP);
    const skin = registry.plugin('skin');
    const art = skin.visual.served.get('art/a.png');
    const cosmeticRes = await get(`/p/skin/${art.sha256.slice(0, 8)}/art/a.png`);
    assert.equal(cosmeticRes.status, 200, cosmeticRes.body.toString('utf8'));
    assert.equal(cosmeticRes.headers['content-security-policy'], undefined);
    assert.equal((await get(`/p/damage-meter/${hash}/plugin.json`)).status, 404);
    assert.equal((await get(`/p/damage-meter/${hash}/README.md`)).status, 404);
    assert.equal((await get('/p/damage-meter/abcdabcd/ui/../../secret.html')).status, 404);
    assert.equal((await get(`/p/damage-meter/${hash}/.hidden`)).status, 404);
    const wrong = await get(`/p/damage-meter/${'0'.repeat(8)}/ui/index.html`);
    assert.equal(wrong.status, 200);
    assert.equal(wrong.headers['cache-control'], 'no-cache');
    assert.equal(wrong.headers['content-security-policy'], UI_FRAME_CSP);
    const partial = await get(url, { Range: 'bytes=0-3' });
    assert.equal(partial.status, 206);
    assert.match(partial.headers['content-security-policy'], /(^|; )sandbox allow-scripts(;|$)/);
    assert.doesNotMatch(partial.headers['content-security-policy'], /allow-same-origin/);
    assert.equal(partial.headers['content-security-policy'], UI_FRAME_CSP);
    assert.equal(registry.pluginFile('damage-meter', 'ui/index.html').frame, true);
    assert.equal(registry.pluginFile('skin', 'art/a.png').frame, false);
  });

  test('a ui plugin changes vs and does not change cs, and a room cannot enable it', () => {
    const simDir = path.join(root, 'sim');
    const sharedDir = path.join(root, 'shared');
    fs.mkdirSync(simDir);
    fs.writeFileSync(path.join(simDir, 'a.js'), 'export const a = 1;\n');
    fs.mkdirSync(path.join(sharedDir, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(sharedDir, 'plugins/m.js'), 'export const m = 1;\n');
    fs.writeFileSync(path.join(root, 'data/economy.json'), '{}\n');
    const opts = { simDir, sharedDir, dataDir: path.join(root, 'data'), shim: 'export function getData(){ return {}; }\n' };
    const before = computeVanillaContent(opts);
    const vs1 = registry.plugin('damage-meter').ui.vs;
    const htmlPath = path.join(root, 'plugins/damage-meter/ui/index.html');
    fs.writeFileSync(htmlPath, fs.readFileSync(htmlPath, 'utf8') + '\n');
    registry.rescan();
    const vs2 = registry.plugin('damage-meter').ui.vs;
    const after = computeVanillaContent(opts);
    assert.notEqual(vs1, vs2);
    assert.equal(before.cs, after.cs);
    assert.deepEqual(after.index.plugins, []);
    assert.equal(after.index.settings && Object.keys(after.index.settings).length, 0);
    const blocked = createVisualSets({ registry }).resolve(['damage-meter']);
    assert.equal(blocked.error, ERR.PLUGIN_BLOCKED);
    const listed = servedCodeFiles({ simDir: path.join(ROOT, 'server/sim'), sharedDir: path.join(ROOT, 'shared') });
    assert.ok(listed.some((f) => f.path === 'shared/plugins/ui.js'));
    assert.equal(listed.some((f) => f.path.includes('plugins/damage-meter')), false);
  });
});

describe('this browser\'s switches', () => {
  after(() => { uiPlugins.reset(); uiRecommend.reset(); });

  test('at most eight, and a recommendation stays on this browser unless the room already carries one', () => {
    uiPlugins.reset();
    uiRecommend.reset();
    for (let i = 0; i < UI_LIMITS.maxPlugins; i++) assert.equal(setUiPlugin('plug-' + i, true).ok, true);
    assert.equal(setUiPlugin('plug-extra', true).error, UI_ERRORS.PLUGIN_LIMIT);
    assert.equal(setUiPlugin('nope_id', true).error, UI_ERRORS.PLUGIN_SHAPE);
    assert.equal(setUiPlugin('plug-0', false).ok, true);
    assert.equal(uiPlugins.get().ids.includes('plug-0'), false);
    assert.equal(toggleRecommend('damage-meter', true).ok, true);
    assert.deepEqual(visibleRecommend({ hostId: 'h' }, false), []);
    assert.deepEqual(visibleRecommend({ hostId: 'h' }, true), ['damage-meter']);
    assert.deepEqual(visibleRecommend({ uiRecommend: ['other-one'] }, false), ['other-one']);
    assert.deepEqual(visibleRecommend({ content: { uiRecommend: ['from-room'] } }, true), ['damage-meter', 'from-room']);
  });
});

test('the frame host module loads where there is no browser', async () => {
  await import('../../public/js/ui/pluginFrame.js');
});

describe('forge panel feeds', () => {
  test('welcome without the extra info stays the old shape', () => {
    assert.deepEqual(hostWelcome('damage-meter', ['hud.right']), { v: 1, t: 'welcome', id: 'damage-meter', slots: ['hud.right'] });
  });

  test('room seats keep null holes and drop the join code', () => {
    const room = subsetRoom({
      code: 'SECRET',
      seats: [{ seat: 0, playerId: 'p', name: '凯尔希', isBot: false, ready: true, connected: true, content: 'ok' }, null, null, null],
      content: { plugins: [{ id: 'rose', version: '1.0.0' }] },
    });
    assert.equal(room.code, undefined);
    assert.equal(room.seats.length, 4);
    assert.equal(room.seats[1], null);
    assert.equal(room.seats[0].content, undefined);
    assert.deepEqual(room.plugins, ['rose']);
    assert.equal(subsetRoom({ code: 'SECRET' }), null);
  });

  test('a settle payload keeps exact damage and drops lineup, diy and seed', () => {
    const result = subsetResult({
      t: 'm.result', seed: 9, hiddenBossId: 'boss', victory: true, roundsPassed: 15,
      players: [{
        playerId: 'p', name: 'A', seat: 0, lineup: [{ diy: { charId: 'x' } }],
        stats: { dmgDealt: 123456, bossDamage: 7, kills: 3, gold: 40, secret: 1 },
      }],
    });
    assert.equal(result.seed, undefined);
    assert.equal(result.hiddenBossId, undefined);
    assert.equal(result.t, undefined);
    assert.equal(result.players[0].lineup, undefined);
    assert.equal(result.players[0].stats.dmgDealt, 123456);
    assert.equal(result.players[0].stats.secret, undefined);
    assert.equal(hostResult(null).result, null);
  });

  test('net uses rtt, stays at 1 Hz, and a nested intent is still refused', () => {
    const msg = hostNet({ status: 'online', attempt: 2, retryAt: 50, ping: 37, everOnline: true, playerId: 'p', lastError: { code: 'closed', text: 'bye' } });
    assert.equal(msg.ping, undefined);
    assert.equal(msg.rtt, 37);
    assert.equal(msg.playerId, undefined);
    assert.equal(msg.everOnline, undefined);
    assert.equal(validateHostMessage(msg).ok, true);
    assert.equal(isMatchIntent(msg), false);
    assert.equal(UI_LIMITS.netHz, 1);
    assert.deepEqual(netSlot(null, 1000, 1000), { send: true, wait: 0 });
    assert.deepEqual(netSlot(1000, 1500, 1000), { send: false, wait: 500 });
    assert.deepEqual(netSlot(1000, 2000, 1000), { send: true, wait: 0 });
    const crafted = { v: 1, t: 'result', result: { players: [{ t: 'g.buy' }] } };
    assert.equal(validateHostMessage(crafted).ok, false);
    const state = hostState({ phase: 'PREP' }, { playerId: 'p' });
    assert.equal(state.room, undefined);
    const withRoom = hostState({ phase: 'PREP' }, { playerId: 'p' }, { seats: [null, null, null, null] });
    assert.equal(withRoom.room.seats.length, 4);
  });
});

test('an empty slots list warns and still reads; a missing client page does not', () => {
  const empty = readPluginManifest(uiManifest({ slots: [] }), { id: 'damage-meter' });
  assert.equal(empty.manifest.slots.length, 0);
  assert.ok(empty.warnings.some((w) => /no slot/.test(w)));
  const missing = readPluginManifest(uiManifest({ entry: {} }), { id: 'damage-meter' });
  assert.equal(missing.manifest, null);
  assert.ok(missing.problems.some((p) => /entry\.client/.test(p)));
  const hash = sha(Buffer.from('x'));
  assert.equal(typeof hash, 'string');
});
