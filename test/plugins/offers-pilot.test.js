// test/plugins/offers-pilot.test.js — a minimal pilot plugin carried all the way through the real path (PLUGIN API v2,
// docs/PLUGINS.md §10b): a folder with nothing but a manifest and `offers/*.json` is found by the registry, loaded as a
// content plugin, built into a content set whose offers are tagged with their plugin, and the engine then opens those
// windows in a real match — before R3, before R9 (rounds no official schedule has a window on) and on every even round
// — and applies the declared effect primitives.
//
// This is the "can the part actually carry a flow" check: no plugin code exists anywhere in this file's fixture, and no
// plugin code runs while the windows open, settle or apply.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPluginRegistry } from '../../server/plugins/registry.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { offersAt } from '../../shared/plugins/offers.js';
import { createRoomSets } from '../../server/plugins/roomSets.js';
import { createContentSets } from '../../server/plugins/contentSets.js';
import { createMatchHosts } from '../../server/match/host/index.js';
import { getData } from '../../server/data.js';
import { fileURLToPath } from 'node:url';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from '../match/harness.js';

/** The pilot: a manifest and three windows, one of them at `{ every: 2 }`. */
const PILOT = {
  manifest: {
    manifest: 2, id: 'pilot', name: { zh: '窗口试点', en: 'Window pilot' }, version: '1.0.0',
    app: '>=0.3.0 <0.4.0', api: 2, class: 'content', scope: ['room'], permissions: ['offers'],
    offers: ['offers/before-r3.json', 'offers/before-r9.json', 'offers/every-2.json'],
  },
  files: {
    'offers/before-r3.json': { offer: 1, id: 'before-r3', when: { at: ['prep'], rounds: [3] }, windowSec: 20, quorum: 'all', onTimeout: 'auto', slots: 3, refresh: { perSlot: 1 }, options: { source: 'lib/options.json' }, apply: { funds: 5 } },
    'offers/before-r9.json': { offer: 1, id: 'before-r9', when: { at: ['prep'], rounds: [9] }, windowSec: 20, quorum: 'all', onTimeout: 'auto', slots: 3, options: { source: 'lib/options.json' }, apply: { layers: { bond: 'deputShip', count: 1 } } },
    'offers/every-2.json': { offer: 1, id: 'every-2', when: { at: ['prep'], rounds: { every: 2 } }, windowSec: 0, quorum: 'none', slots: 3, options: { source: 'lib/options.json' }, apply: { funds: 1 } },
    'lib/options.json': ['a', 'b', 'c', 'd'].map(id => ({ id, name: `Card ${id}`, desc: 'Window grant', icon: 'funds' })),
  },
};

/** Write the pilot into a fresh plugins/ folder, scan it, and build its content set. */
function pilotSet(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-pilot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'plugins', PILOT.manifest.id);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify(PILOT.manifest));
  for (const [rel, doc] of Object.entries(PILOT.files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), JSON.stringify(doc));
  }
  const registry = createPluginRegistry({
    publicDir: path.join(dir, 'public'), packsDir: path.join(dir, 'packs'), pluginsDir: path.join(dir, 'plugins'),
    dataDir: path.join(process.cwd(), 'data'),
  });
  registry.rescan();
  const found = registry.plugins().filter((p) => p.id === 'pilot');
  assert.equal(found.length, 1, 'the registry loaded the pilot');
  assert.equal(found[0].offers.length, 3, 'its three windows were read');
  const set = buildContentSet({ registry, ids: ['pilot'] });
  assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
  return { set, registry, root };
}

test('a manifest with nothing but offers is loaded, and the set carries its windows tagged by plugin', (t) => {
  const { set } = pilotSet(t);
  assert.equal(set.vanilla, false);
  assert.equal(set.offers.length, 3);
  assert.deepEqual(set.offers.map((o) => `${o.pluginId}:${o.id}`).sort(), ['pilot:before-r3', 'pilot:before-r9', 'pilot:every-2']);
  // the round expression survives the build: R3, R9 and every even round
  const at = (round) => offersAt(set.offers, { at: 'prep', round }).map((x) => x.offer.id).sort();
  assert.deepEqual(at(1), []);
  assert.deepEqual(at(2), ['every-2']);
  assert.deepEqual(at(3), ['before-r3']);
  assert.deepEqual(at(4), ['every-2']);
  assert.deepEqual(at(9), ['before-r9']);
  assert.deepEqual(at(10), ['every-2']);
});

test('the engine opens the pilot windows before R3 and before R9 and applies their primitives', (t) => {
  const { set } = pilotSet(t);
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 11 });
  h.m.offers = set.offers;
  h.start();
  const openAt = (id, round) => () => h.m.offerWin.some((w) => w.id === id && w.round === round);
  // R3: the declared window waits for both humans and pays 5 to each who picks
  assert.ok(h.run(openAt('before-r3', 3)), 'before-r3 opened');
  const humans = h.m.alivePlayers().filter((ps) => !ps.isBot);
  const before = humans.map((ps) => ps.funds);
  for (const ps of humans) assert.deepEqual(h.m.requestOffer(ps, 'before-r3', 1), { ok: true });
  humans.forEach((ps, i) => assert.equal(ps.funds, before[i] + 5, 'the declared primitive applied'));
  assert.ok(h.run(() => h.m.phase === PHASE.PREP && h.m.round === 3), 'R3 prep ran');
  // R9: the same engine, a different window — the effect is a bond layer, not funds
  assert.ok(h.run(openAt('before-r9', 9)), 'before-r9 opened on R9');
  const seat = h.m.alivePlayers().find((ps) => !ps.isBot);
  const layers = seat.layers.deputShip || 0;
  assert.deepEqual(h.m.requestOffer(seat, 'before-r9', 0), { ok: true });
  assert.equal(seat.layers.deputShip, layers + 1, 'the layer primitive applied');
  h.m.dispose();
});

test('a vanilla match of the same code opens no window at all (the part absent ⇒ nothing changes)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 11 });
  h.start();
  for (let i = 0; i < 40 && !h.m.ended; i++) {
    assert.equal(h.m.offerWin.length, 0, 'no window is ever open');
    h.run(() => h.m.ended != null || h.m.phase === PHASE.PREP, { maxSteps: 4000 });
  }
  assert.equal(h.m.offerSeq, 0, 'no window was ever built');
  h.m.dispose();
});

test('offers-only content changes room identity; option edits replace cs and old snapshots survive', t => {
  const { set, registry, root } = pilotSet(t);
  const vanilla = buildContentSet({ registry, ids: [] });
  assert.notEqual(set.cs, vanilla.cs);
  assert.equal(set.plugins[0].id, 'pilot');
  const contents = createContentSets({ registry, vanillaData: getData() });
  const room = createRoomSets({ registry, visual: null, contents, policy: null }).resolve(['pilot']);
  assert.equal(room.ok, true);
  assert.equal(room.set.cs, set.cs);
  assert.equal(room.set.plugins[0].id, 'pilot');
  assert.equal(room.set.plugins[0].hash, set.plugins[0].hash.slice(0, 16));
  const file = path.join(root, 'lib/options.json');
  const cards = JSON.parse(fs.readFileSync(file)); cards[0].name = 'Changed';
  fs.writeFileSync(file, JSON.stringify(cards)); registry.rescan();
  const changed = buildContentSet({ registry, ids: ['pilot'] });
  assert.deepEqual(changed.problems, []);
  assert.notEqual(changed.cs, set.cs);
  assert.notEqual(changed.plugins[0].hash, set.plugins[0].hash);
  assert.notEqual(set.offers[0].cards[0].name, 'Changed');
  assert.equal(buildContentSet({ registry, ids: [] }).cs, vanilla.cs, 'installing/editing offers never changes vanilla composition');
});

for (const transport of ['process', 'worker']) test(`offers reach real Match options, snapshots and g.offer in ${transport} host`, { timeout: 30000 }, async t => {
  const { registry } = pilotSet(t);
  const contents = createContentSets({ registry, vanillaData: getData() });
  const resolved = contents.resolve(['pilot']); assert.ok(resolved.ok, JSON.stringify(resolved));
  const hosts = createMatchHosts({ contents, options: { transport, matchOptions: { botRehearsal: 0 },
    matchModule: fileURLToPath(new URL('./fixtures/offerMatch.js', import.meta.url)) } });
  t.after(() => hosts.close());
  let deliver;
  const first = new Promise(resolve => { deliver = resolve; });
  const frames = [];
  const match = hosts.create(resolved.set.cs, { roomCode: 'PILT', mode: 'coop', difficulty: 'NORMAL',
    seats: [0, 1].map(seat => ({ seat, playerId: `p_${seat}`, name: 'Pilot', connected: true, isBot: false })),
    seed: 7, cs: resolved.set.cs, requireCs: true, send() { return true; }, onEnd() {},
    broadcast(msg) { frames.push(msg); if (msg.offers?.length) deliver(msg); } });
  match.start();
  const timer = setTimeout(() => deliver(null), 20000); t.after(() => clearTimeout(timer));
  const frame = await first; assert.ok(frame, 'host published a playable window');
  const w = frame.offers[0];
  assert.equal(w.pluginId, 'pilot'); assert.equal(w.seats[0].slots.length, 3);
  assert.ok(w.seats[0].slots.every(c => c.name && c.desc && c.icon));
  assert.deepEqual(await match.handle('p_0', { t: 'g.offer', offerId: w.id, pluginId: w.pluginId, seq: w.seq, idx: 0 }), { ok: true });
  assert.deepEqual(await match.handle('p_1', { t: 'g.offer', offerId: w.id, pluginId: w.pluginId, seq: w.seq, idx: 0 }), { ok: true });
  const diag = await match.diag(); assert.equal(diag.errorCount, 0);
  match.dispose();
});
