// test/match/feedback1-runner-forms.test.js — player report #5 after 0.1.0 ("转译基底不会变身…加载变身动画然后就没了"), the
// client runner's part (public/js/battle/runner.js under Node: fake socket, manual clock and animation frames, the real
// sim on the real stage 战场#01). A form change reaches the view only as an fx with a `form` (sim content/enemies.js
// setForm; shared/protocol.js fxForm) — b.snap tuples carry no form. The runner used to drop those fx in a catch-up
// frame (a stall of more than ≈0.53 s real at 2×: only spawn / die / deploy / status / skill / leak passed) and every
// event while the tab was hidden, so the view kept the first form and the 转译基底·α died on the 寻仇者's B_Die (the
// review's headless-Chrome repro). Now a catch-up keeps them (keepsState), a hidden tab holds the battle on screen's
// state-bearing events for the first frame back (compacted past HELD_MAX; still past it, the view re-enters from the field
// meta) — a battle that ended while hidden delivers them when the tab is shown — the game screen's pre-entry buffer keeps
// them too (screens/game.js keepEarly, same predicate) and so does the render engine's event queue (render/interp.js
// isCosmeticEvent: never dropped as stale, never shed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBattleRunner, keepsState, compactHeld, HELD_MAX, EV_SLICE } from '../../public/js/battle/runner.js';
import { SnapshotBuffer } from '../../public/js/render/interp.js';
import { keepEarly } from '../../public/js/screens/game/early.js';
import { createStore, initialState } from '../../public/js/store.js';
import * as specMod from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { validateC2S, fxForm } from '../../shared/protocol.js';
import { DATA } from './harness.js';

const DS = new DataSource(DATA, null);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TR = 'enemy_10081_mpplai';

function fakeNet() {
  const handlers = new Map();
  const n = {
    sent: [],
    on(t, fn) { if (!handlers.has(t)) handlers.set(t, new Set()); handlers.get(t).add(fn); return () => handlers.get(t).delete(fn); },
    emit(t, msg) { for (const fn of handlers.get(t) || []) fn({ t, ...msg }); },
    send(t, fields) { const msg = { ...fields, t }; assert.equal(validateC2S(msg), null, `invalid ${t}`); n.sent.push(msg); return true; },
    request(t, fields) { const msg = { ...fields, t, rid: 1 }; assert.equal(validateC2S(msg), null, `invalid ${t}`); n.sent.push(msg); return Promise.resolve({ t: 'ok' }); },
  };
  return n;
}

function rig({ hidden = false } = {}) {
  let t = 1000;
  const frames = [];
  const intervals = [];
  const docListeners = [];
  const doc = { hidden, addEventListener(type, fn) { if (type === 'visibilitychange') docListeners.push(fn); } };
  const net = fakeNet();
  const store = createStore(initialState);
  const runner = createBattleRunner({
    net, store, doc,
    now: () => t,
    raf: (fn) => { frames.push(fn); return frames.length; },
    caf: () => {},
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: () => {},
    loadSim: async () => ({ spec: specMod, ds: DS }),
    logger: { error() {}, warn() {}, info() {}, debug() {} },
  });
  const feed = { evs: [], fields: [], snaps: 0 };
  runner.on('ev', (e) => feed.evs.push(e));
  runner.on('field', (f) => feed.fields.push(f));
  runner.on('snap', () => { feed.snaps++; });
  return {
    runner, net, doc, feed,
    /** advance the clock by `ms` in animation frames of `step` ms (pump intervals while hidden) */
    advance(ms, step = 1000 / 60) {
      const end = t + ms;
      while (t < end) {
        t = Math.min(end, t + step);
        if (doc.hidden) { for (const fn of intervals) fn(); continue; }
        const q = frames.splice(0);
        for (const fn of q) fn(t);
      }
    },
    show() { doc.hidden = false; for (const fn of docListeners) fn(); },
    async settle() { for (let i = 0; i < 50; i++) { await new Promise((res) => setImmediate(res)); const q = frames.splice(0); for (const fn of q) fn(t); } },
  };
}

/** 战场#01: 百炼嘉维尔 blocks the lower lane on (9,8); one 转译基底·α walks it (9,10) → (9,2) — blocked, it turns 幽灵. */
const start = (authoritative = false) => ({
  battleId: 'fb1.runner', fieldId: 'n:P1', kind: 'normal', speed: 2, elapsed: 0, authoritative, watch: !authoritative,
  spec: specMod.buildBattleSpec({
    battleId: 'fb1.runner', fieldId: 'n:P1', kind: 'normal', seed: 5, modeId: 'mode_multi_hard', round: 3, stageId: 'act2autochess_m01', timeLimit: 400,
    players: [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, kind: 'chess', chessId: 'chess_char_4_23_b', row: 9, col: 8, dir: 'RIGHT' }], bonds: {}, playerEffects: [] }],
    spawns: [{ time: 0, enemyKey: TR, routeIndex: 0, count: 1, mods: { hpMul: 1, atkMul: 0.01 } }],
    routes: [{ motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [] }], flags: {},
  }),
});

const all = (feed) => feed.evs.flatMap((x) => x.ev);
const formsOf = (list, id) => list.filter((x) => fxForm(x) !== undefined && x[4].id === id).map(fxForm);
const trOf = (e) => e.battle.units.find((u) => u.defId === TR);

test('fxForm / keepsState: a setForm fx (any fx kind with a `form`) is state; a barrier \'phase\', hit sparks and damage numbers are not', () => {
  assert.equal(fxForm(['fx', 'phase', 1, 2, { id: 3, kind: 'translator_youling', form: 'translator_youling', dur: 2 }]), 'translator_youling');
  assert.equal(fxForm(['fx', 'ember', 1, 2, { id: 3, hits: 5, dur: 11, form: 'husk' }]), 'husk');
  assert.equal(fxForm(['fx', 'revive', 1, 2, { id: 3, form: null }]), null, 'null = back to the base clip set');
  assert.equal(fxForm(['fx', 'phase', 1, 2, { id: 3, kind: 'artsBarrier', value: 300 }]), undefined, 'a barrier phase is no form');
  assert.equal(fxForm(['fx', 'ember', 1, 2, { form: 'husk' }]), undefined, 'no unit');
  assert.equal(fxForm(['dmg', 3, 100]), undefined);
  assert.ok(keepsState(['fx', 'revive', 1, 2, { id: 3, form: 'revived' }]));
  assert.ok(keepsState(['spawn', { id: 3 }]) && keepsState(['die', 3, 'killed']));
  assert.ok(!keepsState(['fx', 'explode', 1, 2, { r: 1 }]) && !keepsState(['atk', 1, 3]) && !keepsState(['dmg', 3, 100]));
});

test('the smooth feed carries 转译基底·α\'s form fx (blocked ⇒ 幽灵)', async () => {
  const r = rig();
  r.net.emit('b.start', start());
  await r.settle();
  const e = r.runner._entries.get('fb1.runner');
  for (let i = 0; i < 12 && trOf(e)?.form == null; i++) r.advance(1000);
  r.advance(1500);
  const tr = trOf(e);
  assert.equal(tr?.form, 'translator_youling', 'fixture: blocked by 百炼嘉维尔 it turns 幽灵');
  assert.equal(r.runner.stats().catchups, 0, 'no catch-up');
  assert.deepEqual(formsOf(all(r.feed), tr.id), ['translator_youling']);
  r.runner.dispose();
});

test('janky frames (0.7 s each: every frame a catch-up) keep the form fx — hit sparks and damage numbers still go', async () => {
  const r = rig();
  r.net.emit('b.start', start());
  await r.settle();
  const e = r.runner._entries.get('fb1.runner');
  for (let i = 0; i < 40 && !e.done && !(trOf(e)?.form && e.battle.time > 12); i++) r.advance(700, 700);
  const tr = trOf(e);
  assert.equal(tr?.form, 'translator_youling');
  assert.ok(r.runner.stats().catchups > 5, `catch-up frames (${r.runner.stats().catchups})`);
  const list = all(r.feed);
  assert.deepEqual(formsOf(list, tr.id), ['translator_youling'], 'the view learns the 幽灵 form (it used to keep the A model)');
  assert.ok(!list.some((x) => x[0] === 'atk' || x[0] === 'dmg'), 'catch-up frames still drop the decoration');
  const spawnAt = list.findIndex((x) => x[0] === 'spawn' && x[1].id === tr.id);
  const formAt = list.findIndex((x) => fxForm(x) !== undefined && x[4].id === tr.id);
  const dieAt = list.findIndex((x) => x[0] === 'die' && x[1] === tr.id);
  assert.ok(spawnAt >= 0 && formAt > spawnAt && (dieAt < 0 || dieAt > formAt), `in order: spawn ${spawnAt}, form ${formAt}, die ${dieAt}`);
  r.runner.dispose();
});

test('a hidden tab across the change: nothing rendered meanwhile, the first frame back delivers the held spawn and form fx', async () => {
  const r = rig({ hidden: true });
  r.net.emit('b.start', start(true));
  await r.settle();
  const e = r.runner._entries.get('fb1.runner');
  assert.equal(r.feed.fields.length, 1, 'shown (the field meta) before the first tick');
  for (let i = 0; i < 12 && trOf(e)?.form == null; i++) r.advance(1000, 250);
  r.advance(1500, 250);
  const tr = trOf(e);
  assert.equal(tr?.form, 'translator_youling', 'pumped through the change while hidden');
  assert.equal(r.feed.evs.length, 0, 'nothing rendered while hidden');
  assert.ok(e.held.length > 0 && e.held.every(keepsState), 'the battle on screen holds its state-bearing events');
  r.show();
  r.advance(1000 / 60);
  const first = all(r.feed);   // nothing was rendered while hidden: the first frame back
  assert.ok(first.some((x) => x[0] === 'spawn' && x[1].id === tr.id), 'the translator\'s spawn (it used to come back as an unknown view)');
  assert.deepEqual(formsOf(first, tr.id), ['translator_youling'], 'and its form');
  // each held tuple keeps the game time it was drained at (batches of EV_SLICE ticks), not the first frame's
  const spawnMsg = r.feed.evs.find((m) => m.ev.some((x) => x[0] === 'spawn' && x[1].id === tr.id));
  const formMsg = r.feed.evs.find((m) => formsOf(m.ev, tr.id).length);
  const frameGt = r.feed.evs[r.feed.evs.length - 1].gt;
  assert.ok(spawnMsg.gt < formMsg.gt && formMsg.gt < frameGt - 1.5, `stamps: spawn ${spawnMsg.gt}, form ${formMsg.gt}, frame ${frameGt}`);
  assert.ok(r.feed.evs.every((m, i) => i === 0 || m.gt >= r.feed.evs[i - 1].gt), 'in game-time order');
  assert.equal(e.held.length, 0);
  assert.equal(r.feed.fields.length, 1, 'no re-entry needed');
  r.runner.dispose();
});

test('compactHeld: a long hidden fight\'s status / skill toggles shrink to the last per unit, everything else stays in order', () => {
  const list = [['spawn', { id: 1 }], ['status', 1, 'stun', 1], ['skill', 2, 1], ['status', 1, 'stun', 0], ['fx', 'phase', 0, 0, { id: 1, form: 'husk' }],
    ['status', 1, 'cold', 1], ['skill', 2, 0], ['die', 1, 'killed'], ['status', 1, 'stun', 1]];
  assert.deepEqual(compactHeld(list), [list[0], list[4], list[5], list[6], list[7], list[8]]);
});

test('a hidden-tab backlog of status toggles beyond HELD_MAX is compacted: no re-entry, the last state arrives', async () => {
  const r = rig({ hidden: true });
  r.net.emit('b.start', start(true));
  await r.settle();
  const e = r.runner._entries.get('fb1.runner');
  for (let i = 0; i < 12 && trOf(e)?.form == null; i++) r.advance(1000, 250);
  const tr = trOf(e);
  e.held.push(...Array.from({ length: HELD_MAX }, (_, i) => ['status', tr.id, 'stun', i % 2]));
  r.advance(500, 250);
  assert.ok(!e.stale && e.held.length < 100, `compacted (${e.held.length})`);
  r.show();
  r.advance(1000 / 60);
  assert.equal(r.feed.fields.length, 1, 'no re-entry');
  const first = all(r.feed);
  assert.deepEqual(first.filter((x) => x[0] === 'status' && x[2] === 'stun'), [['status', tr.id, 'stun', 1]], 'the last toggle only');
  assert.deepEqual(formsOf(first, tr.id), ['translator_youling'], 'the form fx kept');
  r.runner.dispose();
});

test('the own battle ends while the tab is hidden: showing it delivers the backlog and a last snapshot (no frame runs for a finished battle)', async () => {
  const r = rig({ hidden: true });
  r.net.emit('b.start', start(true));
  await r.settle();
  const e = r.runner._entries.get('fb1.runner');
  for (let i = 0; i < 60 && !e.battle.finished; i++) r.advance(1000, 250);
  assert.ok(e.battle.finished && e.done, 'it ended while hidden');
  assert.ok(e.held.length > 0, 'its state events wait');
  const snaps = r.feed.snaps;
  r.show();
  const list = all(r.feed);
  const tr = trOf(e) || { id: list.find((x) => x[0] === 'spawn' && x[1].defId === TR)?.[1].id };
  assert.ok(list.some((x) => x[0] === 'spawn' && x[1].id === tr.id), 'the spawn');
  assert.ok(list.some((x) => (x[0] === 'die' && x[1] === tr.id) || (x[0] === 'leak' && x[1] === tr.id)), 'and its end');
  assert.ok(r.feed.snaps > snaps, 'a last snapshot');
  assert.equal(e.held.length, 0);
  r.runner.dispose();
});

test('a hidden-tab backlog still beyond HELD_MAX after compaction: the first frame back re-enters the view from the field meta (UnitInfo `form`)', async () => {
  const r = rig({ hidden: true });
  r.net.emit('b.start', start(true));
  await r.settle();
  const e = r.runner._entries.get('fb1.runner');
  for (let i = 0; i < 12 && trOf(e)?.form == null; i++) r.advance(1000, 250);
  const tr = trOf(e);
  assert.ok(tr?.form, 'changing');
  e.held.push(...Array.from({ length: HELD_MAX }, (_, i) => ['spawn', { id: 100000 + i }]), ['status', tr.id, 'stun', 1]);
  r.advance(500, 250);
  assert.ok(e.stale && e.held.length === 0, 'overflow: dropped, marked stale');
  r.show();
  r.advance(1000 / 60);
  assert.equal(r.feed.fields.length, 2, 're-entered');
  const meta = r.feed.fields[1];
  assert.equal(meta.units.find((u) => u.id === tr.id)?.form, 'translator_youling', 'the field meta carries the form');
  assert.equal(e.stale, false);
  r.advance(1000 / 60);
  assert.ok(!r.feed.evs.some((x) => x.ev.some((y) => y[0] === 'status' && y[2] === 'stun')), 'the dropped backlog never arrives');
  r.runner.dispose();
});

test('screens/game.js buffers the form fx with the state-bearing events it replays when a field is entered late', () => {
  const src = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');
  const early = readFileSync(path.join(ROOT, 'public/js/screens/game/early.js'), 'utf8');
  assert.match(early, /const keepEarly = \(e\) => Array\.isArray\(e\) && \(STATE_EV\.has\(e\[0\]\) \|\| fxForm\(e\) !== undefined\);/);
  assert.match(src, /for \(const e of msg\.ev\) if \(keepEarly\(e\)\) buf\.push\(e\);/);
  // a new m.field for the field on screen buffers its frames until the enter effect re-enters it (enterBattle resets)
  assert.match(src, /if \(msg\.fieldId === lastFieldRef\.current\) reentryRef\.current = msg\.fieldId;/);
  assert.match(src, /const onEv = \(msg\) => \{\s+const cur = shownId\(\);/);
  assert.match(src, /lastFieldRef\.current = field\.fieldId;\s+reentryRef\.current = null;/);
});

test('entering a field late replays the SAME buffered events to the view and to the sound', () => {
  // The other half of "the first ultimate is sometimes silent": this effect used to take the `early` list keepEarly had
  // collected and filter it down to its `'spawn'` tuples before handing it to the audio. An operator that casts inside
  // its deploy tick (`initSp` already at `spCost`, or one deployed into a running battle) emits `['skill', id, 1]` at
  // t = 0 — before the player entered this field — and `setFieldUnits` above only teaches the sound WHO is on the field,
  // never what they did, so that one cast was never played while every later one was (the owner's "sometimes"). Both
  // paths now see one list in one order. (Ported from 0.1.4, where keepEarly still lived in screens/game.js.)
  const src = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');
  assert.match(src, /view\.pushEvents\(early\);/, 'the view gets the buffered list');
  assert.match(src, /audio\.handleBattleEvents\(early\);/, 'and the sound gets that same list');
  assert.ok(!/audio\.handleBattleEvents\(early\.filter\(/.test(src),
    "no second filter: 'spawn'-only replay dropped the deploy-time cast of the battle just entered");

  // The listener's own buffering (state-bearing kinds only, screens/game/early.js), the real predicate: what survives
  // for the replay. The `fx` tuple below is a form change (protocol.js fxForm), kept like every state-bearing kind.
  const stream = [
    ['atk', 1, 2, 'none'],                 // stale cosmetics: dropped (they would look wrong replayed)
    ['dmg', 2, 40, 'phys'],
    ['spawn', { id: 1, spine: 'char_263_skadi', skillIndex: 2 }],
    ['deploy', 1],
    ['skill', 1, 1],                       // ← the deploy-tick cast of the fight the player just entered
    ['skill', 1, 0],
    ['fx', 'form', 2, 3, { id: 2, form: 'translator_youling' }],
    ['die', 2, 'killed'],
  ];
  const early = stream.filter(keepEarly);
  assert.deepEqual(early.map((e) => e[0]), ['spawn', 'deploy', 'skill', 'skill', 'fx', 'die'],
    'the pre-entry buffer keeps every state-bearing kind');
  assert.deepEqual(early.filter((e) => e[0] === 'spawn').map((e) => e[0]), ['spawn'],
    'the old spawn-only replay threw the cast away — the bug this covers');
  // the audio side reads exactly these, in this order (its own handlers: spawn → track the unit, skill → its cue,
  // die / deploy → their own sound), and a 'skill' whose unit is still unknown is held, not dropped (audio.js)
  const fed = [];
  const audio = { handleBattleEvents: (ev) => fed.push(...ev.map((e) => e[0])) };
  audio.handleBattleEvents(early);
  assert.deepEqual(fed, ['spawn', 'deploy', 'skill', 'skill', 'fx', 'die']);
  assert.ok(fed.includes('skill'), 'the deploy-time cast reaches the cue');
});

/**
 * The view's side too (render/app.js): the runner's frames go into the render engine's SnapshotBuffer, whose clock
 * follows the snapshots, and processEvents takes the due events with the 1.5 game s stale-cosmetic window — a form fx
 * must come out of it (review of the final WD fix: a stall > ≈0.78 s real used to drop it there, the fourth place).
 */
function viewRig({ hidden = false } = {}) {
  const r = rig({ hidden });
  const interp = new SnapshotBuffer({ delay: 0.034, rate: 2 });
  const handled = [];
  const late = new Map();   // like render/app.js processEvents: state events handed out > 1.5 game s late → how late
  let clock = 0;
  r.runner.on('field', () => interp.reset());
  r.runner.on('snap', (x) => interp.push(x, clock));
  r.runner.on('ev', (m) => interp.pushEvents(m.ev, clock, m.gt));
  const render = (tSec) => {
    clock = tSec;
    const rT = interp.update(tSec);
    if (Number.isFinite(rT)) interp.takeEvents(rT, handled, rT - 1.5, late);
  };
  const advance = r.advance;
  let realMs = 1000;
  r.advance = (ms, step = 1000 / 60) => {
    const end = realMs + ms;
    while (realMs < end) {
      const d = Math.min(step, end - realMs);
      advance(d, d);
      realMs += d;
      if (!r.doc.hidden) render(realMs / 1000);
    }
  };
  return { ...r, handled, interp, late };
}

test('runner → render engine: one 1.2 s stall right after the change — the view still handles the 幽灵 form fx', async () => {
  const r = viewRig();
  r.net.emit('b.start', start(true));
  await r.settle();
  const e = r.runner._entries.get('fb1.runner');
  for (let i = 0; i < 2000 && trOf(e)?.form == null; i++) r.advance(1000 / 60);
  r.advance(1000 / 60);
  r.advance(1200, 1200);
  r.advance(1500);
  const tr = trOf(e);
  assert.equal(tr?.form, 'translator_youling');
  assert.deepEqual(formsOf(r.handled, tr.id), ['translator_youling']);
  r.runner.dispose();
});

test('runner → render engine: a watched replica hidden 20 s across the change (catch-up frames of 8 game s on return) — the view handles the form fx', async () => {
  const r = viewRig();
  r.net.emit('b.start', start(false));
  await r.settle();
  r.advance(300);
  r.doc.hidden = true;
  r.advance(20000, 250);
  r.show();
  r.advance(4000);
  const e = r.runner._entries.get('fb1.runner');
  const id = all(r.feed).find((x) => x[0] === 'spawn' && x[1].defId === TR)?.[1].id;
  assert.ok(id != null, 'the translator was announced');
  assert.ok(r.runner.stats().catchups > 0, 'caught up on return');
  assert.deepEqual(formsOf(r.handled, id), ['translator_youling'], `the view learnt the form (sim: ${trOf(e)?.form ?? 'gone'})`);
  r.runner.dispose();
});

// QA of feedback1 (§21.19): a hidden tab's backlog and a catch-up frame used to go out stamped with the frame's game time,
// so the render engine saw a form fx as on time and replayed its 2 s change clip seconds after the change (a 转译基底·α
// walking along in A_Die_C). Each batch now keeps its own game time (EV_SLICE ticks): the fx is handed out as late as it
// is, and render/app.js skips a change clip that would already have ended.
const formLate = (r, id) => { const x = r.handled.find((ev) => fxForm(ev) !== undefined && ev[4].id === id); return x ? r.late.get(x) ?? 0 : null; };

test('runner → render engine: the own battle hidden 20 s across the change — the form fx comes out as late as it is (the 2 s change clip is not replayed)', async () => {
  const r = viewRig();
  r.net.emit('b.start', start(true));
  await r.settle();
  const e = r.runner._entries.get('fb1.runner');
  let changedAt = null;
  e.battle.on('tick', () => { if (changedAt == null && trOf(e)?.form != null) changedAt = e.battle.time; });
  r.advance(300);
  r.doc.hidden = true;
  r.advance(20000, 250);
  assert.ok(changedAt != null && changedAt < 15, `changed while hidden (t ${changedAt})`);
  r.show();
  r.advance(1000);
  const tr = trOf(e);
  const id = tr?.id ?? all(r.feed).find((x) => x[0] === 'spawn' && x[1].defId === TR)?.[1].id;
  const formMsg = r.feed.evs.find((m) => formsOf(m.ev, id).length);
  assert.ok(formMsg && formMsg.gt >= changedAt - 1e-9 && formMsg.gt <= changedAt + EV_SLICE / 30 + 1e-9, `stamped at the change (${formMsg?.gt} vs ${changedAt})`);
  const late = formLate(r, id);
  assert.ok(late != null && late > 10, `handed out ${late?.toFixed(1)} game s late — render/app.js skips the change clip`);
  r.runner.dispose();
});

test('runner → render engine: catch-up frames of 8 game s (a replica shown 20 s late) stamp each slice — the form fx is late by its age in the frame', async () => {
  const r = viewRig();
  r.net.emit('b.start', start(false));
  await r.settle();
  r.advance(300);
  r.doc.hidden = true;
  r.advance(20000, 250);
  r.show();
  r.advance(4000);
  const id = all(r.feed).find((x) => x[0] === 'spawn' && x[1].defId === TR)?.[1].id;
  assert.ok(r.runner.stats().catchups > 0, 'caught up on return');
  const formMsg = r.feed.evs.find((m) => formsOf(m.ev, id).length);
  const sameFrame = r.feed.evs.filter((m) => m.gt > formMsg.gt);
  assert.ok(sameFrame.length && sameFrame[0].gt - formMsg.gt < 8, 'later batches of the catch-up carry later stamps');
  const late = formLate(r, id);
  assert.ok(late != null && late > 2, `the fx is handed out ${late?.toFixed(1)} game s late (was 0: the frame's stamp)`);
  r.runner.dispose();
});
