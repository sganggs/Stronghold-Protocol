// Registered strategies through whole matches: co-op (联防 helpers, the shared operator pool and its equipment stock,
// human seats on AI 托管), the boss round and Final Assault, and a gameplay-plugin room whose rehearsal falls back to
// the server. The engine audit (server/match/audit.js) checks every rule it knows at every phase change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { attachAudit } from '../../server/match/audit.js';
import { FakeBattle } from './fakeBattle.js';
import { makeMatch, checkInvariants } from './harness.js';
import { attachRehearsalHost } from './simClient.js';

const STRATEGIES = ['legacy', 'ioleta', 'adaptive', 'ioleta-adaptive'];
const seats = (humans) => [0, 1, 2, 3].map((seat) => seat < humans
  ? { seat, playerId: `p_${seat}`, name: `P${seat}`, isBot: false, connected: true }
  : { seat, playerId: `ai_${seat}`, name: `AI${seat}`, isBot: true, connected: true });

for (const botStrategy of STRATEGIES) test(`${botStrategy}: a four-seat co-op match to its end passes the engine audit`, t => {
  // the boss field takes shared-pool damage so the Final Assault resolves; ordinary fields leak now and then
  const script = (b) => (b.kind === 'boss' ? { bossDps: 400 } : { leaks: { [b.players[0]]: b.round % 3 === 0 ? 1 : 0 } });
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', seats: seats(2), seed: 23, fake: true, script, botRehearsal: 3,
    botStrategy }).start();
  t.after(() => { h.m.dispose(); FakeBattle.reset(); });
  h.autoHumans();
  const audit = attachAudit(h.m);
  const seen = new Set();
  h.onBroadcast.push(() => { seen.add(h.m.phase); });
  const end = h.runToEnd({ maxSteps: 2e7 });
  assert.equal(h.m.bot.id, botStrategy);
  assert.deepEqual(audit.violations, []);
  assert.ok(audit.checks > 500, `audit ran ${audit.checks} checks`);
  assert.ok(seen.has(PHASE.PREP) && h.m.round >= 14, `the match reached R${h.m.round} (Final Assault is R14)`);
  assert.ok(end, 'the match ended');
  assert.equal(h.m.errorCount, 0, h.logs.error.join('\n'));
  checkInvariants(h.m);
});

for (const botStrategy of STRATEGIES) test(`${botStrategy}: a gameplay-plugin room rehearses on the server, never in the host browser`, t => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: seats(2), seed: 5, botRehearsal: 3, botStrategy,
    hostId: 'p_0', botRehearsalDelegate: true, cs: 'ab'.repeat(32), requireCs: true }).start();
  t.after(() => h.m.dispose());
  h.autoHumans();
  const host = attachRehearsalHost(h);
  h.run(() => h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === 2), { maxSteps: 8e6 });
  assert.equal(h.m.round, 2);
  assert.equal(host.tasks.length, 0, 'the host is not asked');
  assert.deepEqual(h.m.rehearsalStats, { delegated: 0, answered: 0, takeovers: 0 });
  assert.equal(h.m.errorCount, 0, h.logs.error.join('\n'));
  checkInvariants(h.m);
});
