// Spectator seats, the match side (community report #26, owner's decision 2026-10-04 — a remake feature: the official
// room has no spectator seat). A spectator (opts.spectators / addSpectator, server/lobby.js spectate) is shown fields like
// an ELIMINATED player in every phase — the first field of each battle (b.start watch), any field on g.watch, the 联防
// spec, the first boss field, a prep board on g.watch 'n:<pid>' — and the settlement; it never receives an m.private
// (shop, hand, funds …), an m.toast or m.unitStats, is never a field's player or authority, and every intent but g.watch
// is refused (SPECTATOR). The platform half (seats, cap, host removal, reconnect): test/lobby.test.js; over sockets with
// the real Match: test/match/lobby-integration.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, PHASE, EMOTES } from '../../shared/constants.js';
import { makeMatch } from './harness.js';

const S = 's_spec';
/** Keys only the private player view carries (DESIGN §8.3 m.private): none may reach a spectator, at any depth. */
const PRIVATE_KEYS = new Set(['funds', 'pendingFunds', 'hand', 'temp', 'shop', 'canReady', 'rewardOffer', 'freeRefreshes', 'loadout']);
function privateKeys(v, path = '', out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => privateKeys(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (PRIVATE_KEYS.has(k)) out.push(`${path}.${k}`);
      privateKeys(x, `${path}.${k}`, out);
    }
  }
  return out;
}
const frames = (h, id) => h.sent.filter(([pid]) => pid === id).map(([, x]) => x);
/** The intents a player has, refused for a spectator (the platform never routes them; the match refuses them too). */
const REFUSED = [
  { t: 'g.infoReady' }, { t: 'g.buy', slot: 0 }, { t: 'g.refresh' }, { t: 'g.levelUp' }, { t: 'g.ready', ready: true },
  { t: 'g.emote', id: EMOTES[0] }, { t: 'g.autoplay', on: true }, { t: 'g.unitStats', seq: 1 }, { t: 'g.choice', idx: 0 },
  { t: 'g.band', bandId: 'band_bldsk' }, { t: 'b.progress', battleId: 'x', gt: 1, killed: 0, total: 1 },
];

test('a spectator seat watches a whole match (各自行动, 联防, 最终攻势, settlement) like an eliminated player — never a private view', () => {
  const h = makeMatch({
    mode: 'coop', difficulty: 'FUNNY', humans: 3, seed: 9301, fake: true, clientCombat: true, spectators: [S],
    // round 1: p_0 leaks → p_1 / p_2 (perfect) hold a 联防; the Final Assault falls fast
    script: (b) => (b.kind === 'boss' ? { bossDps: 20000 } : b.kind === 'normal' && b.round === 1 ? { duration: 1, leaks: { p_0: 4 } } : { duration: 1 }),
  }).start();
  const m = h.m;
  h.autoHumans();
  assert.ok(m.spectators.has(S) && !m.players.has(S), 'a spectator, never a player');
  for (const msg of REFUSED) assert.deepEqual(m.handle(S, msg), { error: ERR.SPECTATOR }, msg.t);
  h.toPrep(1);
  for (const msg of REFUSED) assert.deepEqual(m.handle(S, msg), { error: ERR.SPECTATOR }, msg.t);
  // prep: a player's board, like a teammate scouting it (m.field prep: true)
  assert.deepEqual(m.handle(S, { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  const scout = h.lastTo(S, 'm.field');
  assert.equal(scout.fieldId, 'n:p_1');
  assert.equal(scout.prep, true);
  assert.deepEqual(scout, m.prepFieldMeta(h.ps('p_1')), 'exactly what a teammate scouting the board gets');
  assert.equal(m.handle(S, { t: 'g.watch', fieldId: `n:${S}` }).error, ERR.BAD_TARGET, 'a spectator has no board');
  const end = h.runToEnd();
  assert.equal(end.victory, true);

  const got = frames(h, S);
  for (const x of got) assert.ok(['m.public', 'm.field', 'b.start', 'b.end', 'm.result'].includes(x.t), `${x.t} sent to a spectator`);
  assert.equal(h.allTo(S, 'm.private').length, 0, 'no private player view');
  const starts = h.allTo(S, 'b.start');
  assert.ok(starts.length > 0);
  for (const st of starts) {
    assert.equal(st.watch, true, `${st.fieldId}: watched`);
    assert.equal(st.authoritative, false, `${st.fieldId}: never the authority`);
    assert.ok(!st.spec.players.some((p) => p.playerId === S), 'never a player of a field');
  }
  const kinds = new Set(starts.map((x) => x.kind));
  for (const k of ['normal', 'unite', 'boss']) assert.ok(kinds.has(k), `a ${k} field was shown (${[...kinds]})`);
  // what it was shown in 各自行动 is what an eliminated player is shown: the first field of the phase
  for (const st of starts.filter((x) => x.kind === 'normal')) assert.equal(st.fieldId, 'n:p_0');
  // the Final Assault's end reaches the boss field it watched, like every human shown that field
  const ends = h.allTo(S, 'b.end');
  assert.ok(ends.some((e) => e.fieldId === starts.filter((x) => x.kind === 'boss').pop().fieldId), 'b.end of the watched boss field');
  // the settlement: every player's public row, none of its own
  const res = h.lastTo(S, 'm.result');
  assert.ok(res, 'the spectator gets the result');
  assert.equal(res.playerId, S);
  assert.deepEqual(res.players.map((p) => p.playerId), ['p_0', 'p_1', 'p_2']);
  assert.deepEqual({ ...res, playerId: null }, { ...h.lastTo('p_1', 'm.result'), playerId: null }, 'the same rows a player gets');
  // nothing shown to it — unicast or broadcast — carries a private key
  for (const x of [...got, ...h.bc]) assert.deepEqual(privateKeys(x), [], `${x.t}: private keys`);
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors.slice(0, 2)));
  m.dispose();
});

test('during a battle a spectator may watch any field at once; one added mid-battle gets the state; a removed one gets nothing', () => {
  const h = makeMatch({
    mode: 'coop', humans: 2, seed: 9302, fake: true, clientCombat: true, instant: false, pace: 'paced', spectators: [S],
    script: () => ({ duration: 30 }),
  }).start();
  const m = h.m;
  h.toPrep(1);
  for (const pid of ['p_0', 'p_1']) m.handle(pid, { t: 'g.ready', ready: true });
  h.run(() => m.phase === PHASE.COMBAT);
  h.sched.advance(500);
  const first = h.lastTo(S, 'b.start');
  assert.deepEqual([first.fieldId, first.watch, first.authoritative], ['n:p_0', true, false], 'auto-observes the first field');
  // a fighting player may not look elsewhere — a spectator (like an eliminated player) may
  assert.equal(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }).error, ERR.WRONG_PHASE);
  assert.deepEqual(m.handle(S, { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  const st = h.lastTo(S, 'b.start');
  assert.deepEqual([st.fieldId, st.watch, st.authoritative], ['n:p_1', true, false]);
  // the field's spec as every watcher gets it — minus the player's funds at the battle start (no battle effect reads it)
  const spec = m.fields.find((f) => f.fieldId === 'n:p_1').spec;
  assert.ok(Object.hasOwn(spec.players[0].contentInfo, 'funds'), 'a player / teammate replica gets contentInfo.funds');
  const { funds, ...counters } = spec.players[0].contentInfo;
  assert.ok(Number.isFinite(funds));
  assert.deepEqual(st.spec, { ...spec, players: [{ ...spec.players[0], contentInfo: counters }] }, 'the same spec without funds');
  assert.deepEqual(privateKeys(st), []);
  assert.equal(m.watchers.get(S), 'n:p_1');
  for (const f of m.fields) assert.notEqual(f.authority, S);
  // a spectator seat taken mid-battle: m.public and the first field at once
  const LATE = 's_late';
  m.addSpectator(LATE);
  assert.ok(h.lastTo(LATE, 'm.public'));
  assert.equal(h.lastTo(LATE, 'b.start').fieldId, 'n:p_0');
  assert.equal(h.allTo(LATE, 'm.private').length, 0);
  m.addSpectator(LATE); // a resync: idempotent registration, the state again
  assert.equal(h.allTo(LATE, 'm.public').length, 2);
  assert.equal(m.spectators.size, 2);
  m.addSpectator('p_0'); // a player's id is never a spectator
  assert.ok(!m.spectators.has('p_0'));
  assert.equal(h.allTo('p_0', 'm.private').length > 0, true);
  // removed: nothing reaches it any more, its watch is gone
  m.removeSpectator(LATE);
  const before = frames(h, LATE).length;
  assert.equal(m.watchers.has(LATE), false);
  assert.equal(m.handle(LATE, { t: 'g.watch', fieldId: 'n:p_0' }).error, ERR.NOT_IN_ROOM);
  h.run(() => m.phase === PHASE.PREP && m.round === 2, { maxSteps: 2e6 });
  assert.equal(frames(h, LATE).length, before, 'a removed spectator is sent nothing');
  assert.equal(h.allTo(S, 'm.private').length, 0);
  m.dispose();
});

test('server-run combat (SP_COMBAT=server): a spectator is streamed the first field like an eliminated player', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 9303, fake: true, spectators: [S] }).start();
  const m = h.m;
  h.toPrep(1);
  for (const pid of ['p_0', 'p_1']) m.handle(pid, { t: 'g.ready', ready: true });
  h.run(() => m.phase === PHASE.SETTLE);
  const meta = h.allTo(S, 'm.field');
  assert.ok(meta.length > 0 && meta[0].fieldId === 'n:p_0', 'm.field of the first field');
  assert.ok(h.allTo(S, 'b.snap').length > 0, 'its snapshots');
  assert.equal(h.allTo(S, 'm.private').length, 0);
  m.dispose();
});
