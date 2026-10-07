// Observing rules of the client (public/js/battle/observe.js, research 09 §3.1 / §6.3) — the mirror of the server's
// Match._watchClient: prep boards, no observing while the own normal battle runs, a teammate's field once it is over,
// the other pair's boss field hidden, eliminated players free; the 联防 / 最终攻势 camera halves and their captions;
// a reloaded screen that watched a teammate's battle takes the watch back (resumedWatch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeTarget, teammateProgress, cameraLayers, layerCamera, isClientCombat, resumedWatch } from '../../public/js/battle/observe.js';

const P = (id, seat, extra = {}) => ({ playerId: id, seat, name: id.toUpperCase(), alive: true, ...extra });
const pubOf = (phase, fields, players) => ({ phase, combatMode: 'client', fields, players });

test('observeTarget: prep, own battle running / over, boss pairs, eliminated players', () => {
  const players = [P('a', 0), P('b', 1), P('c', 2, { alive: false })];
  assert.equal(isClientCombat(pubOf('PREP', [], players)), true);
  assert.deepEqual(observeTarget(players[1], pubOf('PREP', [], players), 'a'), { fieldId: 'n:b' });
  assert.match(observeTarget(players[2], pubOf('PREP', [], players), 'a').reason, /淘汰/);
  const combat = (liveA) => pubOf('COMBAT', [
    { fieldId: 'n:a', kind: 'normal', players: ['a'], live: liveA },
    { fieldId: 'n:b', kind: 'normal', players: ['b'], live: true, progress: { killed: 3, total: 8, done: false } },
  ], players);
  assert.match(observeTarget(players[1], combat(true), 'a').reason, /作战中无法查看/);
  assert.deepEqual(observeTarget(players[1], combat(true), 'a', { ownDone: true }), { fieldId: 'n:b' }, 'the local battle already ended');
  assert.deepEqual(observeTarget(players[1], combat(false), 'a'), { fieldId: 'n:b' });
  assert.deepEqual(observeTarget(players[0], combat(false), 'a', { observing: true }), { back: true });
  // the teammate's capsule reads `resolved` (the field's own enemies knocked out or leaked); a report without one falls
  // back to `killed` (public/js/battle/observe.js teammateProgress)
  assert.deepEqual(teammateProgress(combat(false), 'a'), [{ playerId: 'b', name: 'B', isBot: false, killed: 3, resolved: 3, total: 8, done: false }]);
  const reported = pubOf('COMBAT', [{ fieldId: 'n:b', kind: 'normal', players: ['b'], live: true, progress: { killed: 5, resolved: 3, total: 8, done: false } }], players);
  assert.deepEqual(teammateProgress(reported, 'a'), [{ playerId: 'b', name: 'B', isBot: false, killed: 5, resolved: 3, total: 8, done: false }],
    'a reported `resolved` wins over `killed` (5 counted knock-outs — splits included —, 3 of the round\'s own enemies resolved)');
  const fa = pubOf('FINAL_ASSAULT', [
    { fieldId: 'b1', kind: 'boss', players: ['a', 'b'], live: true },
    { fieldId: 'b2', kind: 'boss', players: ['d'], live: true },
  ], [...players, P('d', 3)]);
  assert.match(observeTarget(P('d', 3), fa, 'a').reason, /另一组/);
  assert.match(observeTarget(players[1], fa, 'a').reason, /同一战场/);
  const dead = pubOf('FINAL_ASSAULT', fa.fields, [{ ...players[0], alive: false }, players[1], P('d', 3)]);
  assert.deepEqual(observeTarget(P('d', 3), dead, 'a'), { fieldId: 'b2' }, 'eliminated: anything');
});

test('cameraLayers: ‹ LEFT / 全景 / RIGHT › with "你自己" / name / "无人在家"; none for normal or single boss fields', () => {
  const pub = { players: [P('a', 0), P('b', 1)] };
  const unite = { fieldId: 'u', kind: 'unite', rect: { r0: 9, r1: 12, c0: 0, c1: 20 }, players: ['a', 'b'], sides: { a: 'R', b: 'L' } };
  assert.deepEqual(cameraLayers(unite, pub, 'a').map((l) => [l.key, l.label]), [['L', 'B'], ['ALL', '全景'], ['R', '你自己']]);
  const single = { ...unite, players: ['b'], sides: { b: 'L' } };
  assert.deepEqual(cameraLayers(single, pub, 'a').map((l) => l.label), ['B', '全景', '无人在家']);
  assert.deepEqual(cameraLayers({ kind: 'normal' }, pub, 'a'), []);
  assert.deepEqual(cameraLayers({ kind: 'boss', players: ['a'], sides: { a: 'L' } }, pub, 'a'), [], 'a solo boss field has no halves');
  assert.deepEqual(layerCamera(unite, 'R', 'R'), { rect: unite.rect, side: 'R', half: true });
  assert.deepEqual(layerCamera(unite, 'ALL', 'R'), { rect: unite.rect, side: 'R' });
});

test('resumedWatch: a reload while watching a teammate\'s battle adopts the resent field once per battle (review, DESIGN §20.15)', () => {
  const players = [P('a', 0), P('b', 1), P('c', 2)];
  const pub = pubOf('COMBAT', [
    { fieldId: 'n:a', kind: 'normal', players: ['a'], live: false },
    { fieldId: 'n:b', kind: 'normal', players: ['b'], live: true },
  ], players);
  const watched = { battleId: 'r3-n:b', fieldId: 'n:b', kind: 'normal', watch: true, done: false };
  const own = { battleId: 'r3-n:a', fieldId: 'n:a', kind: 'normal', watch: false, done: true };
  const o = { pub, myId: 'a', alive: true, watching: null, seen: null };
  // the reload: the server resends b's battle (b.start watch: true) to a screen at home
  assert.deepEqual(resumedWatch(watched, o), { seen: 'r3-n:b', fieldId: 'n:b' });
  // once per battle: after 返回战场 (watching null again) the same battle, still shown until the own b.start, stays put
  assert.deepEqual(resumedWatch(watched, { ...o, seen: 'r3-n:b' }), { seen: 'r3-n:b', fieldId: null });
  // first seen while watching (a 前往查看 under way): marked, never adopted later
  assert.deepEqual(resumedWatch(watched, { ...o, watching: 'n:b' }), { seen: 'r3-n:b', fieldId: null });
  // loading (no `watch` in that state yet): undecided while watching nothing, marked when already watching
  const loading = { loading: true, battleId: 'r3-n:b', fieldId: 'n:b', kind: 'normal' };
  assert.deepEqual(resumedWatch(loading, o), { seen: null, fieldId: null });
  assert.deepEqual(resumedWatch(loading, { ...o, watching: 'n:b' }), { seen: 'r3-n:b', fieldId: null });
  // the own battle, no battle, no m.public yet (undecided)
  assert.deepEqual(resumedWatch(own, o), { seen: 'r3-n:a', fieldId: null });
  assert.deepEqual(resumedWatch({ ...watched, fieldId: 'n:a' }, o), { seen: 'r3-n:b', fieldId: null }, 'a field listing the viewer');
  assert.deepEqual(resumedWatch(null, o), { seen: null, fieldId: null });
  assert.deepEqual(resumedWatch(watched, { ...o, pub: null }), { seen: null, fieldId: null });
  // other rules keep theirs: an eliminated player's auto-observe, 联防 / boss fields, other phases, server-run combat
  assert.deepEqual(resumedWatch(watched, { ...o, alive: false }), { seen: 'r3-n:b', fieldId: null });
  const unite = pubOf('UNITE', [{ fieldId: 'u', kind: 'unite', players: ['b', 'c'], live: true }], players);
  assert.deepEqual(resumedWatch({ battleId: 'r3-u', fieldId: 'u', kind: 'unite', watch: true }, { ...o, pub: unite }), { seen: 'r3-u', fieldId: null }, 'a 联防 leaker');
  assert.deepEqual(resumedWatch(watched, { ...o, pub: { ...pub, phase: 'UNITE' } }), { seen: 'r3-n:b', fieldId: null });
  assert.deepEqual(resumedWatch(watched, { ...o, pub: { ...pub, combatMode: 'server' } }), { seen: 'r3-n:b', fieldId: null });
  assert.deepEqual(resumedWatch({ ...watched, fieldId: 'n:x' }, o), { seen: 'r3-n:b', fieldId: null }, 'a field not listed');
});
