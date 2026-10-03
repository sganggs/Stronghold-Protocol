import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sim from '../../server/sim/spec.js';
import { getData } from '../../server/data.js';
import { canTargetEnemy } from '../../server/sim/targeting.js';
import { unitInfo } from '../../server/sim/snapshot.js';
import { createEmberScenario, EMBER_ENEMIES } from '../../public/dev/ember-scenario.js';

const ds = getData();
const run = (b, seconds) => { for (let i = 0; i < seconds * 30; i++) b.step(); };
const fatal = (b, e) => b.dealDamage(null, e, { amount: 1e8, type: 'true' });

for (const enemyKey of Object.keys(EMBER_ENEMIES)) {
  test(`${enemyKey}: real lethal damage enters a live, moving ember with client form metadata`, () => {
    const { battle: b, enemy: e, blocker } = createEmberScenario(sim, ds, { enemyKey });
    b.drainEvents();
    const x = e.x;
    fatal(b, e);
    assert.ok(e.alive);
    assert.equal(b.killed, 0);
    assert.equal(e.form, 'husk');
    assert.equal(unitInfo(e).form, 'husk');
    const ev = b.drainEvents();
    assert.ok(ev.some((v) => v[0] === 'fx' && v[1] === 'ember' && v[4].form === 'husk'));
    assert.ok(!ev.some((v) => v[0] === 'die'));
    run(b, 1);
    assert.ok(e.x < x && e.s.flags.stealth);
    for (let i = 0; i < 240 && !e.blockedBy; i++) b.step();
    assert.equal(e.blockedBy, blocker);
    assert.ok(canTargetEnemy(blocker, e, blocker.profile));
    const blockedX = e.x;
    b.retreat(blocker, { permanent: true });
    run(b, 1);
    assert.ok(e.x < blockedX && e.s.flags.stealth);
    assert.ok(!canTargetEnemy(blocker, e, blocker.profile));
    const hits = e.hp;
    for (let i = 0; i < hits; i++) {
      b.dealDamage(null, e, { amount: 1, type: 'true' });
      assert.equal(e.alive, i < hits - 1);
    }
    assert.equal(b.killed, 1);
    run(b, 20);
    assert.ok(!e.alive, 'a destroyed ember never revives');
    assert.equal(b.errorCount, 0);
  });

  test(`${enemyKey}: the fixed scenario revives an untouched ember and emits normal form`, () => {
    const { battle: b, enemy: e } = createEmberScenario(sim, ds, { enemyKey });
    const hp = e.s.maxHp;
    fatal(b, e);
    b.drainEvents();
    run(b, 16);
    assert.ok(e.alive);
    assert.equal(e.form, 'revived');
    assert.equal(unitInfo(e).form, 'revived');
    assert.equal(e.hp, hp);
    assert.equal(b.killed, 0);
    assert.ok(b.drainEvents().some((v) => v[0] === 'fx' && v[1] === 'revive' && v[4].form === 'revived'));
    assert.equal(b.errorCount, 0);
  });
}
