import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';

test('client-run boss and hidden fights support cross-group viewing, reconnect and return without authority changes', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 4, seed: 54,
    fake: true, instant: false, clientCombat: true,
    script: battle => ['boss', 'hidden'].includes(battle.kind) ? { bossDps: battle.sharedBoss.maxHp / 10 } : {},
  }).start();
  const m = h.m;
  try {
    assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === 14));
    for (const player of m.order) {
      player.bondCountBonus.yanShip = 3; player.layers.yanShip = 400; player.recompute();
    }
    for (const phase of [PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]) {
      assert.ok(h.drive(() => m.phase === phase));
      const [own, other] = m.fields, viewer = own.players[0];
      const authorities = m.fields.map(field => field.authority);
      const lp = m.teamLp;
      assert.deepEqual(m.handle(viewer, { t: 'g.watch', fieldId: other.fieldId, playerId: other.players[0] }), { ok: true });
      const start = h.lastTo(viewer, 'b.start');
      assert.equal(start.fieldId, other.fieldId);
      assert.equal(start.watch, true);
      assert.equal(start.authoritative, false);
      // a living watcher from the other group gets the spec without the players' funds (Match._spectatorSpec, PR #971 at merge)
      assert.ok(other.spec.players.some((p) => p.contentInfo && Object.hasOwn(p.contentInfo, 'funds')), 'the field spec carries funds');
      assert.ok(start.spec.players.every((p) => !p.contentInfo || !Object.hasOwn(p.contentInfo, 'funds')), 'no funds for the watcher');
      assert.deepEqual(start.spec.players.map((p) => p.units?.length ?? 0), other.spec.players.map((p) => p.units?.length ?? 0));
      const ownStart = h.sent.filter(([pid, x]) => pid === viewer && x.t === 'b.start' && x.fieldId === own.fieldId).at(-1)?.[1];
      assert.ok(ownStart && ownStart.spec.players.some((p) => p.contentInfo && Object.hasOwn(p.contentInfo, 'funds')), 'its own field keeps them');
      m.onReconnect(viewer);
      assert.equal(h.lastTo(viewer, 'b.start').fieldId, other.fieldId);
      assert.deepEqual(m.handle(viewer, { t: 'g.watch', fieldId: own.fieldId }), { ok: true });
      assert.equal(m.watchers.get(viewer), own.fieldId);
      assert.deepEqual(m.fields.map(field => field.authority), authorities);
      assert.equal(m.teamLp, lp);
    }
  } finally { m.dispose(); }
});
