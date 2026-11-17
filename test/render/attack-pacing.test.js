// Attack-clip pacing through the REAL path (#729 review): the sim's own attack interval reaches the view and the actor.
//
//   server/sim/snapshot.js  unitInfo  → UnitInfo.atkInterval (s.interval with its buffs)
//   Server → client        b.snap / b.ev  ['rate', id, seconds] when a skill or a buff changed it
//   render/app/info.js     renderInfo keeps atkInterval            ← it used to drop it
//   render/app.js          spawn → new UnitView(info); 'rate' → view.setAtkInterval(seconds)
//   render/units.js        the view paces its attack clip over it; a paused unit keeps the known interval
//   render/spine.js        SpineActor.windUp / attack take that interval for the clip's time scale
//
// Covered: the first strike, a skill / buff change, a delayed batch, and attacking again after a stop.
// `node --test test/render/attack-pacing.test.js`
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { renderInfo } from '../../public/js/render/app/info.js';
import { ATK_JUMP_TOLERANCE, ATK_DEFAULT_S, clampAtkInterval } from '../../public/js/render/attackRate.js';
import { unitInfo } from '../../server/sim/snapshot.js';
import { BattleEvents } from '../../server/sim/battle/events.js';

let fake, UnitView;
before(async () => {
  fake = installFakePixi();
  ({ UnitView } = await import('../../public/js/render/units.js'));
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const cam = () => presetCamera('prep', { width: 1280, height: 720 });

function store() {
  const entry = {
    skel: '/s/front.skel', atlas: '/s/front.atlas',
    anims: { idle: 'Idle', attack: { loop: 'Attack' }, skill: { loop: 'Skill' }, deploy: 'Start' },
    animations: { Idle: 1, Attack: 1, Skill: 1, Start: 1 }, hits: { Attack: [0.4] },
  };
  return {
    picture: () => null, image: async () => null, hasBack: () => false,
    spineEntry: () => entry,
    spine: { acquire: async () => ({ animations: [{ name: 'Idle' }, { name: 'Attack' }, { name: 'Skill' }, { name: 'Start' }] }), release: () => {} },
  };
}

/** A view exactly as render/app.js builds it: through renderInfo(UnitInfo). */
async function view(unitInfoLike) {
  const info = renderInfo(unitInfoLike);
  const ctx = fakeViewCtx(fake.P, { assets: store(), cam });
  const v = new UnitView(ctx, info);
  await tick(); await tick();
  return v;
}

const unit = (extra = {}) => ({
  id: 1, kind: 'op', side: 'ally', defId: 'char_test', spine: 'char_test', name: 'test', tier: 1,
  x: 4, y: 9, facing: 1, maxHp: 1000, dir: 'RIGHT', bat: 1.2, aspd: 100, ...extra,
});

describe('the sim value reaches the view', () => {
  test('renderInfo keeps UnitInfo.atkInterval (it used to drop the field)', () => {
    const info = renderInfo(unit({ atkInterval: 0.75 }));
    assert.equal(info.atkInterval, 0.75);
    assert.equal(renderInfo(unit()).atkInterval, undefined, 'absent on the wire: stays undefined, no fake 0');
    assert.equal(renderInfo(unit({ atkInterval: 0 })).atkInterval, undefined);
  });

  test('a fresh view starts from the sim interval, not from the record guess', async () => {
    // the record guess would be bat * 100 / aspd = 1.2; the sim says a buff brought it to 0.5
    const v = await view(unit({ atkInterval: 0.5 }));
    assert.equal(v.atkInterval, 0.5);
    assert.equal(v.atkKnown, true);
    // and the actor the clip is played on uses it
    assert.equal(v.windUp(0.2, 'none'), true);
    assert.equal(Math.round(v.actor.interval * 1000) / 1000, 0.5);
  });

  test('without the field the view falls back to its record guess (an enemy, an old frame)', async () => {
    const v = await view(unit());
    assert.equal(v.atkKnown, false);
    assert.equal(v.atkInterval, clampAtkInterval(1.2));
  });
});

describe('a skill / buff change', () => {
  test("a 'rate' event paces the next swing and the actor", async () => {
    const v = await view(unit({ atkInterval: 1.2 }));
    v.setAtkInterval(0.35);                        // what app.js case 'rate' does
    assert.equal(v.atkInterval, 0.35);
    assert.equal(v.atkKnown, true);
    // a fast interval needs a shorter lead: the strike frame must still be ahead (windUpPlan)
    assert.equal(v.windUp(0.1, 'none'), true);
    assert.equal(Math.round(v.actor.interval * 1000) / 1000, 0.35, 'the clip is paced over the new interval');
  });

  test('the sim emits rate only when the interval changed', () => {
    const evs = [];
    // Publishing the birth info seeds the sent value before the first tick.
    const u7 = { id: 7, alive: true, deployed: true, s: { interval: 0.5 }, _rateDirty: true };
    unitInfo(u7);
    const battle = { recordEvents: true, units: [u7], _ev: (t) => evs.push(t) };
    BattleEvents.prototype._emitRateChanges.call(battle);
    assert.deepEqual(evs, [], 'no event for the value the spawn already carried');
    assert.equal(u7._rateDirty, false, 'the flag is consumed');
    BattleEvents.prototype._emitRateChanges.call(battle);          // unchanged: nothing
    assert.equal(evs.length, 0);
    u7.s.interval = 0.35; u7._rateDirty = true;                    // a skill came on
    BattleEvents.prototype._emitRateChanges.call(battle);
    assert.deepEqual(evs, [['rate', 7, 0.35]]);
    BattleEvents.prototype._emitRateChanges.call(battle);          // same value again: nothing
    assert.equal(evs.length, 1);
    u7.s.interval = 1; u7._rateDirty = true;                       // the buff expired
    BattleEvents.prototype._emitRateChanges.call(battle);
    assert.deepEqual(evs[1], ['rate', 7, 1]);
    // a unit that is not on the field, or has no interval, is skipped (and costs nothing when clean)
    const quiet = { recordEvents: true, units: [{ id: 8, alive: false, deployed: true, s: { interval: 1 }, _rateDirty: true }, { id: 9, alive: true, deployed: true, s: {}, _rateDirty: true }, { id: 10, alive: true, deployed: true, s: { interval: 2 } }], _ev: (t) => evs.push(t) };
    BattleEvents.prototype._emitRateChanges.call(quiet);
    assert.equal(evs.length, 2);
  });
});

describe('a change in the SAME tick as the attack (the review case)', () => {
  test('a same-tick skill change paces the FIRST swing with the new interval', async () => {
    // the sim changed s.interval this tick (a skill that just started); the snapshot already carries it, while the
    // 'rate' event for that change is one step behind. The look-ahead must pace from the snapshot.
    const v = await view(unit({ atkInterval: 1.2 }));
    assert.equal(v.atkInterval, 1.2);
    // render/app.js keeps one info object per unit, and a later snapshot replaces its fields in place
    v.info.atkInterval = 0.6;
    v.sync({ x: 4, y: 9, hp: 1000, maxHp: 1000, sp: 0, spMax: 0, flags: 0, anim: 0, vx: 0, vy: 0 });
    assert.equal(v.atkInterval, 0.6, 'the snapshot value is adopted before any rate event is applied');
    assert.equal(v.atkKnown, true, 'and it stays authoritative');
    assert.equal(v.actor.interval, 0.6, 'the actor paces that swing at 0.6 s');
    v.setAtkInterval(0.6);                       // the following rate event for the same number is a no-op
    assert.equal(v.atkInterval, 0.6);
  });

  test('a rate event outranks the stale spawn UnitInfo (it is spawn-time metadata)', async () => {
    // The real entry: render/app.js spawns the view from UnitInfo, pushes every 'rate' event into setAtkInterval, and the
    // frame loop then calls sync() with the next snapshot — whose info object still holds the SPAWN value.
    const v = await view(unit({ atkInterval: 1.2 }));
    assert.equal(v.atkInterval, 1.2, 'the spawn value paces the first swing');
    const snap = { x: 4, y: 9, hp: 1000, maxHp: 1000, sp: 0, spMax: 0, flags: 0, anim: 0, vx: 0, vy: 0 };
    v.setAtkInterval(0.6);                       // the 'rate' event of a skill that just started
    assert.equal(v.atkInterval, 0.6);
    assert.equal(v.actor.interval, 0.6, 'the actor paces that swing at 0.6 s');
    v.sync(snap);                                // same frame: UnitInfo is spawn-time metadata, still 1.2
    assert.equal(v.atkInterval, 0.6, 'the stale spawn value does not overwrite the event');
    v.sync(snap);
    assert.equal(v.atkInterval, 0.6, 'and it stays put on later frames');
  });

  test('a spawn that reuses the view re-seeds the pacing state (a 重生 / a second life)', async () => {
    // app.js keeps the view when a spawn arrives for an id it already has, so the previous life's rate event must not hold
    // the new life's interval: case 'spawn' calls respawn(info) on the reused view.
    const v = await view(unit({ atkInterval: 1.2 }));
    v.setAtkInterval(0.6);                       // the previous life's rate event
    v.sync({ x: 4, y: 9, hp: 1000, maxHp: 1000, sp: 0, spMax: 0, flags: 0, anim: 0, vx: 0, vy: 0 });
    assert.equal(v.atkInterval, 0.6);
    v.respawn({ atkInterval: 0.9 });             // the new life's UnitInfo
    assert.equal(v.atkInterval, 0.9, 'the new spawn value is taken');
    assert.equal(v.rateSeen, false, 'and the next rate event counts again');
    v.sync({ x: 4, y: 9, hp: 1000, maxHp: 1000, sp: 0, spMax: 0, flags: 0, anim: 0, vx: 0, vy: 0 });
    assert.equal(v.atkInterval, 0.9, 'nothing overwrites it with the old life');
  });

  test('without a rate event the snapshot value is still adopted', async () => {
    const v = await view(unit({ atkInterval: 1.2 }));
    v.info.atkInterval = 0.9;                    // stands in for a spawn info built from a later snapshot
    v.sync({ x: 4, y: 9, hp: 1000, maxHp: 1000, sp: 0, spMax: 0, flags: 0, anim: 0, vx: 0, vy: 0 });
    assert.equal(v.atkInterval, 0.9, 'no rate event yet: the snapshot value is used');
    v.setAtkInterval(0.6);
    v.sync({ x: 4, y: 9, hp: 1000, maxHp: 1000, sp: 0, spMax: 0, flags: 0, anim: 0, vx: 0, vy: 0 });
    assert.equal(v.atkInterval, 0.6, 'after that event the stale info no longer wins');
  });

  test('the rate event carries the interval the current swing runs on (emitted after the skill tick)', () => {
    const u = { id: 7, alive: true, deployed: true, _rateDirty: true, _rateSent: 0, s: { interval: 0.5 } };
    const ev = new BattleEvents();          // a method container: the sim installs it on Battle.prototype
    ev.recordEvents = true;
    ev._evq = [];
    ev.units = [u];
    ev._emitRateChanges();
    const rate = ev._evq.filter((e) => Array.isArray(e) && e[0] === 'rate');
    assert.equal(rate.length, 1, 'one rate event');
    assert.equal(rate[0][2], 0.5, 'and it carries the post-skill interval');
  });
});

describe('the playback after the hit and the clip tail', () => {
  test('the actor is paced at the sim interval, and a tail remains after the strike', async () => {
    const v = await view(unit({ atkInterval: 0.8 }));
    assert.equal(v.windUp(0.3, 'none'), true, 'a wind-up is accepted');
    assert.ok(Math.abs(v.actor.interval - 0.8) < 1e-9, 'the clip runs over the sim interval');
    v.onAttack({ x: 4, y: 12 }, 1, 'none', false);
    const tail = Number(v.actor.attackUntil) - Number(v.actor.clock);
    assert.ok(tail > 0, 'a tail remains after the strike');
    assert.ok(tail <= 0.8 * 2 + 1e-6, 'and it is bounded by the interval');
  });
});
describe('the intervals the renderer must not mistake for a rhythm', () => {
  test('a delayed batch (a late first attack) does not turn the sim interval into a slow one', async () => {
    const v = await view(unit({ atkInterval: 0.5 }));
    v.onAttack({ x: 5, y: 9 }, 9.4, 'none');       // first attack, seen 9.4 s into the battle (a field entered late)
    v.onAttack({ x: 5, y: 9 }, 10.6, 'none');      // 1.2 s later: the client only saw the recovery, not a rhythm
    assert.equal(v.atkInterval, 0.5, 'the sim value wins over a gap it never measured');
    assert.equal(v.atkInterval, clampAtkInterval(0.5));
  });

  test('attacking again after a stop (a stun, a control, a redeploy) keeps the known interval', async () => {
    const v = await view(unit({ atkInterval: 0.9 }));
    v.onAttack({ x: 5, y: 9 }, 1.0, 'none');
    v.onAttack({ x: 5, y: 9 }, 1.9, 'none');       // normal gap: no change needed
    assert.equal(v.atkInterval, 0.9);
    v.onAttack({ x: 5, y: 9 }, 6.9, 'none');       // 5 s later: the unit was stunned and then walked back
    assert.equal(v.atkInterval, 0.9, 'the pause is not a slower attack');
    v.onAttack({ x: 5, y: 9 }, 7.85, 'none');      // attacking again at the known rhythm
    assert.ok(Math.abs(v.atkInterval - 0.9) < 0.02, 'only tick-sized wobble is followed');
  });

  test('small wobble around the known value is still followed', async () => {
    const v = await view(unit({ atkInterval: 1.0 }));
    v.onAttack({ x: 5, y: 9 }, 1.0, 'none');
    v.onAttack({ x: 5, y: 9 }, 2.04, 'none');      // +4 %: inside ATK_JUMP_TOLERANCE
    assert.ok(Math.abs(v.atkInterval - 1.0) < 0.02, 'drift is small, not a jump');
    assert.ok(v.atkInterval < 1.04, 'the raw measurement is not taken outright');
    assert.ok(ATK_JUMP_TOLERANCE > 0.04);
  });

  test('an unknown interval (no sim value) is still measured — an enemy, a legacy frame', async () => {
    const v = await view(unit({ kind: 'enemy', side: 'enemy', defId: 'enemy_test' }));
    assert.equal(v.atkKnown, false);
    v.onAttack({ x: 3, y: 9 }, 2.0, 'none');
    v.onAttack({ x: 3, y: 9 }, 3.2, 'none');       // the only source of truth here: the measured gap
    assert.equal(Math.round(v.atkInterval * 100) / 100, 1.2);
  });

  test('the sim side: unitInfo carries the interval, and a one-off cast is not a rhythm', async () => {
    const u = { id: 3, defId: 'char_test', kind: 'op', side: 'ally', x: 4, y: 9, s: { interval: 0.66, maxHp: 100, flags: {} }, base: { maxHp: 100 }, hidden: false };
    const info = unitInfo(u);
    assert.equal(info.atkInterval, 0.66);
    const v = await view(unit({ atkInterval: 0.66 }));
    v.onAttack({ x: 5, y: 9 }, 1.0, 'droneBomb');  // PROJ.once: one clip at its own speed, no rhythm measured
    assert.equal(v.atkInterval, 0.66);
  });

  test('the default when nothing is known at all', async () => {
    const v = await view(unit({ bat: 0, aspd: 0 }));
    assert.equal(v.atkInterval, ATK_DEFAULT_S);
  });
});

test('the first changed interval is emitted after the birth value was published', () => {
  const u = { id: 7, alive: true, deployed: true, s: { interval: 1, maxHp: 100, flags: {} } };
  assert.equal(unitInfo(u).atkInterval, 1);
  u.s.interval = 0.5;
  u._rateDirty = true;
  const events = new BattleEvents();
  Object.assign(events, { recordEvents: true, _evq: [], units: [u] });
  events._emitRateChanges();
  assert.deepEqual(events._evq, [['rate', 7, 0.5]]);
});

test('lookahead uses the rate at the attack tick without applying a later tick early', async () => {
  const { createWindUpLookahead } = await import('../../public/js/render/app/windup.js');
  const calls = [];
  const view = { windUp: (...args) => { calls.push(args); return true; } };
  const events = [[['atk', 1, 2, 'none'], 1], [['rate', 1, 0.5], 1], [['rate', 1, 2], 1.2]];
  const look = createWindUpLookahead({ views: new Map([[1, view]]), woundUp: new WeakSet(), castStart() {} });
  look.run({ forEachUpcoming: (from, to, fn) => events.forEach(([e, t]) => fn(e, t)) }, 0);
  assert.equal(calls[0][3], 0.5);
});

test('delivery places a rate before its attack while preserving spawn and skill order', async () => {
  const { attackRateEvents } = await import('../../public/js/render/attackRate.js');
  const spawn = ['spawn', { id: 1 }], skill = ['skill', 1, 1], attack = ['atk', 1, 2, 'none'], rate = ['rate', 1, 0.5];
  assert.deepEqual(attackRateEvents([spawn, skill, attack, rate]), [spawn, skill, rate, attack]);
});
