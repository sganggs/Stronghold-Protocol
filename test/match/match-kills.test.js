import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { buildBattleSpec, createBattleFromSpec, compactResult } from '../../server/sim/spec.js';
import { validateClientResult } from '../../server/match/fields.js';
import { DATA } from './harness.js';

test('match kills add normal combat and unite credits across rounds', () => {
  const h = makeMatch({ mode: 'coop', humans: 3, fake: true, seed: 11, script: (b) => b.kind === 'unite'
    ? { creditedKills: { p_0: 2, p_2: 1 } }
    : { leaks: b.round === 1 ? { p_1: 3 } : {}, creditedKills: { p_0: b.round === 1 ? 8 : 3, p_1: 0, p_2: 0 } },
  }).start();
  h.autoHumans();
  h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 3);
  assert.equal(h.ps('p_0').creditedKills, 13);
	assert.equal(h.ps('p_0').uniteKills, 2, 'only the helper’s actual unite kills');
  assert.equal(h.ps('p_1').creditedKills, 0, 'the leaker does not get its teammates\' kill credits');
  assert.equal(h.ps('p_2').creditedKills, 1);
  h.m.finish({ victory: false });
  assert.equal(h.ended.players.find((p) => p.playerId === 'p_0').creditedKills, 13);
  h.m.dispose();
});

test('match total includes normal combat, Final Assault and Hidden Core', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, fake: true, seed: 7,
    script: (b) => ({ creditedKills: { p_0: b.kind === 'hidden' ? 11 : b.kind === 'boss' ? 6 : 1, p_1: 0 }, bossDps: b.sharedBoss ? b.sharedBoss.maxHp / 8 : 0 }),
  }).start();
  for (const ps of h.m.order) ps.activatedLayers = () => 700;
  h.autoHumans();
  const end = h.runToEnd();
  assert.equal(end.hiddenCleared, true);
  assert.equal(end.players.find((p) => p.playerId === 'p_0').creditedKills, 30, '13 normal + 6 boss + 11 hidden kills');
  assert.equal(h.m.errorCount, 0);
  h.m.dispose();
});

test('kills from a lost round are recorded before elimination', () => {
  const h = makeMatch({ mode: 'solo', humans: 1, fake: true, script: () => ({ leaks: { p_0: 10 }, creditedKills: { p_0: 7 } }) }).start();
  h.toPrep(1);
  h.ps('p_0').lp = 1;
  h.autoHumans();
  h.m.handle('p_0', { t: 'g.ready', ready: true });
  const end = h.runToEnd();
  assert.equal(end.players[0].alive, false);
  assert.equal(end.players[0].creditedKills, 7);
  h.m.dispose();
});

test('client result validation preserves kill credit and rejects malformed summaries', () => {
  const spec = buildBattleSpec({ stageId: 'act2autochess_m01', timeLimit: 1, content: 'none', players: [{ playerId: 'p_0', units: [] }] });
  const b = createBattleFromSpec(spec, DATA, { quiet: true });
  b.forceEnd();
  const raw = compactResult(b.result());
  assert.equal(validateClientResult(spec, raw).result.perPlayer.p_0.creditedKills, 0);
  for (const bad of [-1, 0.5, '1', null, 1e9 + 1]) {
    const forged = structuredClone(raw);
    forged.perPlayer.p_0.creditedKills = bad;
    assert.equal(validateClientResult(spec, forged).ok, false, String(bad));
  }
});

test('boss achievement divides credited damage by full boss HP even when the team has not killed it', () => {
	const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, fake: true, script: () => ({ bossDps: 0 }) }).start();
	h.toPrep(1);
	h.m.startFinalAssault(false);
	const pool = h.m.bossPool;
	pool.damage('p_0', pool.maxHp / 4);
	assert.equal(h.ps('p_0').stats.bossHpPercent, 25, '25% of boss HP, not 100% of team damage');
	pool.damage('p_1', pool.maxHp / 4);
	assert.equal(h.ps('p_0').stats.bossHpPercent, 25);
	assert.equal(h.ps('p_1').stats.bossHpPercent, 25);
	h.m.finish({ victory: false, reason: 'test' });
	assert.equal(h.ended.players.find((p) => p.playerId === 'p_0').stats.bossHpPercent, 25);
	h.m.dispose();
});
