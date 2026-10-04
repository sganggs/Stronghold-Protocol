// User playtest #6 item 7 (workstream WC), the client side: during 联防 a leaker's count of its enemies still standing
// on the 联防 field falls live as the helpers kill them — uncapped in the official runner tag ×N (phase capsule, team
// rows), while the LP loss stays min(10, N). Pure HUD helpers (ui/hud.js, ui/teamPanel.js) and the browser runner
// (public/js/battle/runner.js state().uniteLeft / b.progress `left`) on a real 联防 spec. The server side is in
// test/match/playtest6-matchflow.test.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE } from '../../shared/constants.js';
import { createBattleRunner } from '../../public/js/battle/runner.js';
import { createStore, initialState } from '../../public/js/store.js';
import * as specMod from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { Battle } from '../../server/sim/Battle.js';
import { validateC2S } from '../../shared/protocol.js';
import { DATA, makeMatch } from '../match/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const { liveLp, uniteRemaining, pendingTip, PhaseCapsule, MissTag, missTip } = await import('../../public/js/ui/hud.js');
const { rowLp, rowLpTip } = await import('../../public/js/ui/teamPanel.js');

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  return typeof v === 'object' ? textOf(v.props?.children) : '';
};
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

describe('#7 the 联防 leak counter (HUD)', () => {
  test('uniteRemaining: the local 联防 replica\'s count while it runs (the field on screen), else the server\'s; null when unknown', () => {
    assert.equal(uniteRemaining(12, 14), 12, 'the local replica is ahead of the ~1 Hz report');
    assert.equal(uniteRemaining(15, 13), 15, 'a split raised it on the field before the next report: the replica shows it');
    assert.equal(uniteRemaining(undefined, 13), 13, 'no local replica yet (loading / not on screen)');
    assert.equal(uniteRemaining(0, 3), 0);
    for (const [a, b] of [[undefined, undefined], [null, NaN], [-1, 'x']]) assert.equal(uniteRemaining(a, b), null);
  });

  test('liveLp in 联防: the count replaces the own battle\'s leaks — uncapped in `left`, the LP loss capped at 10, falling live', () => {
    let base = null;
    const step = (o) => { const r = liveLp(base, { phase: PHASE.UNITE, round: 7, lp: 30, statsLeaks: 2, leaks: 14, cap: 10, ...o }); base = r.base; return r; };
    const seq = [15, 14, 12, 10, 9, 4, 0].map((n) => step({ uniteLeft: n }));
    assert.deepEqual(seq.map((r) => r.left), [15, 14, 12, 10, 9, 4, 0]);
    assert.deepEqual(seq.map((r) => r.pending), [10, 10, 10, 10, 9, 4, 0], 'min(10, left)');
    assert.deepEqual(seq.map((r) => r.shown), [20, 20, 20, 20, 21, 26, 30]);
    assert.ok(seq.every((r) => r.unite), '联防中 while the player is a leaker (also at 0: the tag shows ×0)');
    // the settlement lands (m.private lp 26): nothing pending any more, no tag
    const settled = step({ uniteLeft: 4, lp: 26, statsLeaks: 16 });
    assert.deepEqual([settled.pending, settled.left, settled.shown], [0, null, 26]);
    // not a leaker / no count: the own battle's count (the old behaviour)
    const helper = liveLp(null, { phase: PHASE.UNITE, round: 7, lp: 30, leaks: 0 });
    assert.deepEqual([helper.pending, helper.left, helper.unite], [0, null, false]);
    const legacy = liveLp(null, { phase: PHASE.UNITE, round: 7, lp: 30, leaks: 14 });
    assert.deepEqual([legacy.pending, legacy.left], [10, null]);
    // COMBAT ignores it
    assert.equal(liveLp(null, { phase: PHASE.COMBAT, round: 7, lp: 30, leaks: 2, uniteLeft: 9 }).left, null);
  });

  test('tooltips name the true count and the capped loss', () => {
    const over = pendingTip(30, 10, { unite: true, left: 15 });
    assert.match(over, /还剩 15 个.*剩余不足 10 个后，队友每击倒一个少扣 1 点.*扣除 10 点（每回合至多 10 点）/);
    assert.doesNotMatch(over, /队友每击倒一个就少扣/, 'above the cap a kill does not lower the loss');
    assert.match(pendingTip(30, 4, { unite: true, left: 4 }), /还剩 4 个，队友每击倒一个就少扣 1 点/);
    assert.match(pendingTip(30, 8, { unite: true, left: 9, cap: 8 }), /剩余不足 8 个后.*每回合至多 8 点/);
    assert.equal(rowLpTip({ lp: 30, pending: 10, unite: true, left: 13 }), '目标生命值 30，联防中：漏过的敌人还剩 13 个，按现在结算扣除 10 点（每回合至多 10 点）');
    assert.match(rowLpTip({ lp: 30, pending: 8, unite: true, left: 13 }, 8), /每回合至多 8 点/, 'the configured cap');
    assert.equal(rowLpTip({ lp: 30, pending: 0, unite: true, left: 0 }), null);
  });

  test('team rows: a teammate\'s m.public players[].uniteLeft (uncapped) next to lp − pendingLp; the own row the top bar\'s value', () => {
    const pub = { phase: PHASE.UNITE };
    assert.deepEqual(rowLp({ lp: 30, pendingLp: 10, uniteLeft: 13 }, pub), { lp: 30, pending: 10, unite: true, left: 13 });
    assert.deepEqual(rowLp({ lp: 30, uniteLeft: 0 }, pub), { lp: 30, pending: 0, unite: true, left: 0 }, 'all struck down: ×0');
    assert.deepEqual(rowLp({ lp: 30 }, pub), { lp: 30, pending: 0, unite: false, left: null }, 'a helper');
    assert.deepEqual(rowLp({ lp: 30, pendingLp: 2, uniteLeft: 2 }, { phase: PHASE.COMBAT }), { lp: 30, pending: 2, unite: false, left: null }, 'COMBAT: no tag');
    assert.deepEqual(rowLp({ lp: 30, uniteLeft: 12 }, pub, { lp: 30, pending: 10, unite: true, left: 11 }), { lp: 30, pending: 10, unite: true, left: 11 });
  });

  test('team rows of a helper watching the 联防: a teammate\'s count comes from the local replica on screen (live with the kills), else m.public', () => {
    const pub = { phase: PHASE.UNITE, unite: { helpers: ['me'], leakers: ['b', 'c'] } };
    const b = { playerId: 'b', lp: 30, pendingLp: 10, uniteLeft: 13 }; // the authority's last report (~1 Hz, a kill behind)
    const c = { playerId: 'c', lp: 4, pendingLp: 4, uniteLeft: 6 };
    const local = { b: 12, c: 9 };
    assert.deepEqual(rowLp(b, pub, null, { uniteLocal: local }), { lp: 30, pending: 10, unite: true, left: 12 }, 'the replica wins');
    assert.deepEqual(rowLp(b, pub, null, { uniteLocal: { b: 7 } }), { lp: 30, pending: 7, unite: true, left: 7 }, 'loss = min(10, left) from the same count');
    assert.deepEqual(rowLp(b, pub, null, { uniteLocal: { b: 7 }, cap: 5 }), { lp: 30, pending: 5, unite: true, left: 7 }, 'the configured cap');
    assert.deepEqual(rowLp(c, pub, null, { uniteLocal: local }), { lp: 4, pending: 4, unite: true, left: 9 }, 'never more than the LP left');
    assert.deepEqual(rowLp(b, pub, null, { uniteLocal: {} }), { lp: 30, pending: 0, unite: true, left: 0 }, 'absent from the replica = all struck down');
    assert.deepEqual(rowLp(b, pub, null, { uniteLocal: null }), { lp: 30, pending: 10, unite: true, left: 13 }, 'no replica on screen: m.public');
    assert.deepEqual(rowLp({ playerId: 'me', lp: 30 }, pub, null, { uniteLocal: local }), { lp: 30, pending: 0, unite: false, left: null }, 'a helper row gets no tag');
    assert.deepEqual(rowLp(b, { ...pub, phase: PHASE.COMBAT }, null, { uniteLocal: local }), { lp: 30, pending: 10, unite: false, left: null }, 'COMBAT ignores it');
    const own = { lp: 30, pending: 10, unite: true, left: 11 };
    assert.deepEqual(rowLp(b, pub, own, { uniteLocal: { b: 2 } }), own, 'the own row keeps the top bar\'s value');
    // wiring: the game screen hands the runner's per-leaker counts to the team panel, which passes them to rowLp
    assert.match(read('public/js/screens/game.js'), /const uniteLocal = phase === PHASE\.UNITE && battleState && battleState\.uniteLeft \? battleState\.uniteLeft : null;/);
    assert.match(read('public/js/screens/game.js'), /<\$\{TeamPanel\}[^\n]*uniteLocal=\$\{uniteLocal\}/);
    assert.match(read('public/js/ui/teamPanel.js'), /rowLp\(p, pub, self \? selfLive : null, \{ uniteLocal, cap \}\)/);
  });

  test('the tag\'s tooltip speaks to the leaker on the own tag, names the teammate on a teammate\'s row', () => {
    assert.equal(missTip(5), '你漏过的敌人还剩 5 个（队友正在迎战）');
    assert.equal(missTip(0), '你漏过的敌人已全部被击倒');
    assert.equal(missTip(5, 'Doctor·B'), 'Doctor·B 漏过的敌人还剩 5 个（联防中）');
    assert.equal(missTip(0, 'Doctor·B'), 'Doctor·B 漏过的敌人已全部被击倒');
    assert.equal(MissTag({ n: 5, name: 'Doctor·B' }).props.title, 'Doctor·B 漏过的敌人还剩 5 个（联防中）');
    assert.equal(MissTag({ n: 5 }).props.title, '你漏过的敌人还剩 5 个（队友正在迎战）');
    assert.match(read('public/js/ui/teamPanel.js'), /<\$\{MissTag\} n=\$\{lp\.left\} name=\$\{self \? null : p\.name \|\| T\('博士'\)\} \/>/);
  });

  test('the phase capsule carries the official runner tag ×N in 联防 only; the tag reads the uncapped number', () => {
    const tagOf = (v) => [...walk(v)].find((n) => n.type === MissTag);
    const unite = PhaseCapsule({ pub: { phase: PHASE.UNITE }, hud: { killed: 3, total: 17 }, miss: 14 });
    assert.equal(tagOf(unite)?.props.n, 14);
    assert.equal(tagOf(PhaseCapsule({ pub: { phase: PHASE.UNITE }, hud: { killed: 3, total: 17 }, miss: null })), undefined, 'a helper / observer');
    assert.equal(tagOf(PhaseCapsule({ pub: { phase: PHASE.COMBAT }, hud: { killed: 3, total: 17 }, miss: 5 })), undefined);
    const tag = MissTag({ n: 14 });
    assert.ok(hasClass(tag, 'misstag'));
    assert.match(textOf(tag), /14$/);
    assert.match(tag.props.title, /还剩 14 个/);
    assert.ok(hasClass(MissTag({ n: 0 }), 'is-clear'));
    // wiring: the top bar hands the live value to the capsule; the game screen feeds liveLp with the leaker's count
    assert.match(read('public/js/ui/hud.js'), /PhaseCapsule} pub=\$\{pub\} hud=\$\{hud\} miss=/);
    assert.match(read('public/js/screens/game.js'), /uniteLeft: leaker \? uniteRemaining\(localLeft, meP\?\.uniteLeft\) : null/);
    assert.match(read('public/js/ui/teamPanel.js'), /<\$\{MissTag\} n=\$\{lp\.left\} name=/);
  });
});

// ---- the browser runner on a real 联防 spec --------------------------------------------------------------------------

const DS = new DataSource(DATA, null);
const LEAKS = 14;

/** Real battles whose 联防 helpers strike down a leaked enemy every 6 game seconds (from 4 s on). */
class SlowHelpers extends Battle {
  constructor(opts) {
    super(opts);
    if (this.kind !== 'unite') return;
    let next = 4;
    this.on('tick', () => {
      if (this.time < next) return;
      const e = this.enemies.find((x) => x.alive && x.counted);
      if (!e) return;
      this.kill(e, null);
      next += 6;
    });
  }
}

/** The b.start frames of a 联防 where p_1 let LEAKS 源石虫 through and p_0 helps (client-side combat, no clients). */
function uniteStarts() {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 710, captureFrames: false, clientCombat: true, clients: false });
  h.m.start();
  h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 1, { ready: false });
  const m = h.m;
  m.phase = PHASE.COMBAT;
  m.fields = [];
  m.lastResults = new Map([
    ['p_0', { leaked: [], perfect: true, coins: 0, layerGains: {}, killed: 5, total: 5, unitsEnd: [] }],
    ['p_1', { leaked: Array.from({ length: LEAKS }, () => ({ enemyKey: 'enemy_1007_slime', mods: null, lpr: 1, sourcePlayerId: 'p_1', tag: null, counted: true })), perfect: false, coins: 0, layerGains: {}, killed: 0, total: LEAKS, unitsEnd: [] }],
  ]);
  m._afterCombat();
  assert.equal(m.phase, PHASE.UNITE);
  const out = { helper: h.lastTo('p_0', 'b.start'), leaker: h.lastTo('p_1', 'b.start') };
  m.dispose();
  return out;
}

function rig() {
  let t = 1000;
  const frames = [];
  const sent = [];
  const handlers = new Map();
  const net = {
    on(ty, fn) { if (!handlers.has(ty)) handlers.set(ty, new Set()); handlers.get(ty).add(fn); return () => handlers.get(ty).delete(fn); },
    emit(ty, msg) { for (const fn of handlers.get(ty) || []) fn({ t: ty, ...msg }); },
    send(ty, fields) { const msg = { ...fields, t: ty }; assert.equal(validateC2S(msg), null, `invalid ${ty}`); sent.push(msg); return true; },
    request(ty, fields) { const msg = { ...fields, t: ty, rid: 1 }; assert.equal(validateC2S(msg), null, `invalid ${ty}`); sent.push(msg); return Promise.resolve({ t: 'ok' }); },
  };
  const store = createStore(initialState);
  const spec = { ...specMod, createBattleFromSpec: (s, ds, o = {}) => specMod.createBattleFromSpec(s, ds, { ...o, BattleClass: SlowHelpers }) };
  const runner = createBattleRunner({
    net, store, doc: { hidden: false, addEventListener() {} }, now: () => t,
    raf: (fn) => { frames.push(fn); return frames.length; }, caf: () => {},
    setInterval: () => 1, clearInterval: () => {},
    loadSim: async () => ({ spec, ds: DS }),
    logger: { error() {}, warn() {}, info() {}, debug() {} },
  });
  return {
    runner, net, store, sent,
    advance(ms, step = 1000 / 60) { const end = t + ms; while (t < end) { t = Math.min(end, t + step); for (const fn of frames.splice(0)) fn(t); } },
    async settle() { for (let i = 0; i < 50; i++) { await new Promise((res) => setImmediate(res)); for (const fn of frames.splice(0)) fn(t); } },
  };
}

test('#7 runner: a 联防 replica publishes state().uniteLeft as it falls; the authority reports b.progress `left`', async () => {
  const { helper, leaker } = uniteStarts();
  assert.equal(helper.kind, 'unite');
  assert.equal(helper.authoritative, true, 'the helper runs the 联防');
  assert.equal(leaker.authoritative, false, 'the leaker watches a display replica');

  // the leaker's browser: a display replica — its top bar reads state().uniteLeft (store.match.battle)
  const L = rig();
  L.net.emit('b.start', leaker);
  await L.settle();
  const seen = [];
  for (let i = 0; i < 160; i++) {
    L.advance(500);
    const s = L.store.get().match.battle;
    if (s && s.uniteLeft) seen.push(s.uniteLeft.p_1 ?? 0);
  }
  assert.equal(seen[0], LEAKS, 'starts at every enemy that got through');
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] <= seen[i - 1], '源石虫 never split: it only falls here');
  assert.ok(new Set(seen).size >= 4 && seen[seen.length - 1] < 10, `falls live: ${[...new Set(seen)].join(' → ')}`);
  assert.equal(L.sent.filter((x) => x.t === 'b.progress').length, 0, 'a replica never reports');
  L.runner.dispose();

  // the helper's browser: the authority's reports carry the counts
  const H = rig();
  H.net.emit('b.start', helper);
  await H.settle();
  H.advance(20_000);
  const prog = H.sent.filter((x) => x.t === 'b.progress');
  assert.ok(prog.length >= 15, `${prog.length} reports`);
  assert.ok(prog.every((x) => x.left && Object.keys(x.left).every((k) => k === 'p_1')), 'left: the leaker only');
  assert.ok(prog[prog.length - 1].left.p_1 < prog[0].left.p_1, 'the reported count falls');
  H.runner.dispose();
});
