// GitHub #851: 老鲤 【得闲饮茶】 「第3回合进入休整期时，获得2、4阶随机干员各1名」 — the 「进入休整期时」 grants run at the prep start
// (onPrepStart), after the round's 机变 phase (research 01 §4.1 steps 4 and 6), not at the round start before the
// draft opens. server/sim/content/bands/meta.js header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA, give, legalTileFor } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';

const REG = createRegistry({ log: { warn() {}, error() {}, info() {} } });

function lmleeMatch(mode, seed = 5) {
  const h = makeMatch({ mode, difficulty: 'NORMAL', humans: 1, bots: mode === 'coop' ? 1 : 0, seed, registry: REG, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps.bandId = 'band_lmlee'; // the draft offers a seat a few bands only; the handler is looked up by bandId at dispatch
  const grants = [];
  const orig = ps.acquireChess.bind(ps);
  ps.acquireChess = (id, o = {}) => { const p = orig(id, o); if (p && /band/.test(String(o.source || ''))) grants.push([h.m.phase, h.m.round, DATA.chess[id].tier]); return p; };
  return { h, m: h.m, ps, grants };
}

test('#851 同盟 NORMAL: 老鲤\'s R3 operators come at the R3 prep start, after the 机变 draft — none at ROUND_START / SP_DRAFT', () => {
  const { h, m, grants } = lmleeMatch('coop');
  assert.ok(m.gd.spRounds().includes(3), 'R3 is a 机变 round in 同盟 NORMAL');
  assert.ok(h.drive(() => m.phase === 'ROUND_START' && m.round === 3));
  assert.deepEqual(grants, [], 'nothing at the R3 round start');
  assert.ok(h.drive(() => m.phase === 'SP_DRAFT' && m.round === 3, { ready: true }));
  assert.deepEqual(grants, [], 'nothing while the R3 draft is open');
  h.toPrep(3);
  assert.deepEqual(grants.map(([ph, r]) => `${ph} R${r}`), ['PREP R3', 'PREP R3']);
  assert.deepEqual(grants.map(([, , t]) => t).sort(), [2, 4]);
  h.toPrep(4);
  assert.equal(grants.length, 2, 'once');
  m.dispose();
});

test('#851 single NORMAL (R3 not a 机变 round): 老鲤 still grants at the R3 prep start', () => {
  const { h, m, grants } = lmleeMatch('solo');
  assert.ok(!m.gd.spRounds().includes(3));
  h.toPrep(3);
  assert.deepEqual(grants.map(([ph, r, t]) => `${ph} R${r} T${t}`).sort(), ['PREP R3 T2', 'PREP R3 T4']);
  m.dispose();
});

// DESIGN §35.53: the operators' traits with 「<进入休整期时>」 (SERVER_PREP_START) run at the prep start as well — research 01
// §4.1 step 6 and appendix A1 (「进入此阶段时，触发<进入休整期时>的效果」), after the round's 机变 draft. Until 0.3.2 they ran
// on the round start, before the draft opened (the strategies' grants moved in §35.24).
test('§35.53 同盟 NORMAL: an operator\'s 「进入休整期时」 trait (缄默德克萨斯: a free refresh) runs at the R3 prep start, after the 机变 draft', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 5, registry: REG, fake: true }).start();
  const m = h.m;
  h.toPrep(2);
  const ps = h.ps('p_0');
  give(m, ps, 'chess_char_4_16_a', 'board', legalTileFor(m, ps, 'chess_char_4_16_a'));
  const runs = [];
  const orig = m.dispatcher._call.bind(m.dispatcher);
  m.dispatcher._call = (p, key, hnd, hook, src, ev, ...rest) => {
    if (p === ps && src && src.kind === 'garrison' && src.garrison && src.garrison.garrisonId === 'garrison_114_a') runs.push(`${m.phase} R${m.round} ${hook}`);
    return orig(p, key, hnd, hook, src, ev, ...rest);
  };
  assert.ok(m.gd.spRounds().includes(3));
  assert.ok(h.drive(() => m.phase === 'ROUND_START' && m.round === 3));
  assert.deepEqual(runs, [], 'nothing at the R3 round start');
  assert.ok(h.drive(() => m.phase === 'SP_DRAFT' && m.round === 3, { ready: true }));
  assert.deepEqual(runs, [], 'nothing while the R3 draft is open');
  h.toPrep(3);
  assert.deepEqual(runs, ['PREP R3 onPrepStart']);
  m.dispose();
});
