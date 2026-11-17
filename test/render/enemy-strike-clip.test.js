// test/render/enemy-strike-clip.test.js — DESIGN §35.48: an enemy's attack-class skill (the sim casts it in its attack's
// `before` hook: ['cast', id, slot] then that attack's 'atk' in the same tick, no skill window) plays its slot's official
// clip in place of the attack clip when the slot is a `strike` (data/assets.json anims.skills, tools/assets/spine.mjs
// PREFAB_SPINE_ROLES): 杰斯顿·威廉姆斯 C1_Skill / C2_Skill, “碎铳之簧” Skill_b / Skill_c. 锏's second form keeps its slot clips
// (B_Skill2) instead of the form's attack role. Real manifest entries, headless fake PIXI (test/render/fakepixi.js).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));

let fake, UnitView, STRIKE_WINDOW;
before(async () => {
  fake = installFakePixi();
  ({ UnitView, STRIKE_WINDOW } = await import('../../public/js/render/units.js'));
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const cam = () => presetCamera('prep', { width: 1280, height: 720 });

/** A battle view of a real enemy model (its data/assets.json spine entry). */
async function enemy(defId) {
  const entry = ASSETS.enemies[defId].spine;
  const assets = {
    picture: () => null, image: async () => null, spineEntry: () => entry,
    spine: { acquire: async () => ({ animations: Object.keys(entry.animations).map((name) => ({ name })) }), release() {} },
  };
  const v = new UnitView(fakeViewCtx(fake.P, { assets, cam }), { id: 1, side: 'enemy', kind: 'enemy', defId, x: 5, y: 12, maxHp: 100 }, {});
  await tick(); await tick();
  assert.ok(v.actor, 'spine actor built');
  return v;
}
const run = (v, s, t0 = 0, dt = 1 / 60) => { for (let t = 0; t < s - 1e-9; t += dt) v.update(dt, cam(), t0 + t); };

test('杰斯顿: the cast of a strike slot makes that tick\'s attack play C1_Skill, then attacks play C1_Attack again', async () => {
  const v = await enemy('enemy_1516_jakill');
  v.onAttack(null, 1, 'enemy');
  assert.equal(v.actor.current, 'C1_Attack', 'a plain attack');
  run(v, 3, 1);
  v.setSkillSlot(0);
  v.onCast(0, 4);
  v.onAttack(null, 4, 'enemy');
  assert.equal(v.actor.current, 'C1_Skill', 'the ironsandstorm attack');
  // a second target's 'atk' of the same tick (one per target) keeps the clip
  v.onAttack(null, 4, 'enemy');
  assert.equal(v.actor.current, 'C1_Skill');
  run(v, 3, 4);
  assert.equal(v.actor.strike, null, 'the strike ends with its clip');
  v.onAttack(null, 7, 'enemy');
  assert.equal(v.actor.current, 'C1_Attack', 'the next attack is plain again');
});

test('a wound-up strike (the look-ahead saw the cast in the attack\'s tick) is not restarted by its attack', async () => {
  const v = await enemy('enemy_1516_jakill');
  assert.equal(v.windUp(0.2, 'enemy', 0), true);
  assert.equal(v.actor.current, 'C1_Skill', 'wound up on the slot clip');
  const track = v.actor.spine.state.tracks[0];
  run(v, 0.2, 10);
  v.setSkillSlot(0);
  v.onCast(0, 10.2);
  v.onAttack(null, 10.2, 'enemy');
  assert.equal(v.actor.current, 'C1_Skill');
  assert.equal(v.actor.spine.state.tracks[0], track, 'the wound-up clip goes on (no second swing)');
  // a wind-up without a cast in its tick is a plain one
  run(v, 3, 10.2);
  assert.equal(v.windUp(0.2, 'enemy', null), true);
  assert.equal(v.actor.current, 'C1_Attack');
});

test('the killer form strikes on C2_Skill; a stale cast or a non-strike slot leaves the attack clip', async () => {
  const v = await enemy('enemy_1516_jakill');
  v.setForm('form2');
  v.onAttack(null, 1, 'enemy');
  assert.equal(v.actor.current, 'C2_Attack');
  run(v, 3, 1);
  v.setSkillSlot(1);
  v.onCast(1, 4);
  v.onAttack(null, 4, 'enemy');
  assert.equal(v.actor.current, 'C2_Skill', 'armorpiercing');
  run(v, 3, 4);
  // a cast whose attack never came (its target gone): a later attack is plain
  v.onCast(1, 7);
  v.onAttack(null, 7 + STRIKE_WINDOW + 0.5, 'enemy');
  assert.equal(v.actor.current, 'C2_Attack');
  // 泥岩's slots are cast on their own (a skill window plays them): no strike
  const rock = await enemy('enemy_1511_mdrock');
  rock.onCast(0, 1);
  rock.onAttack(null, 1, 'enemy');
  assert.equal(rock.actor.current, 'Attack_1');
});

test('“碎铳之簧”: the shield\'s special attack plays Skill_b / Skill_c', async () => {
  for (const [id, clip] of [['enemy_9019_actrpb', 'Skill_b'], ['enemy_9020_actrpc', 'Skill_c']]) {
    const v = await enemy(id);
    v.setSkillSlot(0);
    v.onCast(0, 2);
    v.onAttack(null, 2, 'enemy');
    assert.equal(v.actor.current, clip, id);
  }
});

test('the skill slots that a skill window plays: 泥岩 RefreshShield Skill_2, 锏 B_Skill2 in its second form, 斩胄之剑 Launch_Begin', async () => {
  const rock = await enemy('enemy_1511_mdrock');
  rock.setSkillSlot(0);
  rock.setSkill(true);
  assert.equal(rock.actor.current, 'Skill_2', '屏障 refresh');
  const mace = await enemy('enemy_1525_blkswb');
  mace.setSkillSlot(0);
  assert.equal(mace.actor.roles.skill.loop, 'A_Skill2');
  mace.setForm('form2');
  mace.setSkillSlot(2);
  assert.equal(mace.actor.roles.skill.loop, 'B_Skill2', 'the form keeps the slot clip');
  assert.equal(mace.actor.roles.attack.loop, 'B_Attack', 'and its own attack');
  mace.setSkill(true);
  assert.equal(mace.actor.current, 'B_Skill2');
  // 速杀 names no clip: its skill window plays nothing new
  const m2 = await enemy('enemy_1525_blkswb');
  m2.setSkillSlot(1);
  const before = m2.actor.current;
  m2.setSkill(true);
  assert.equal(m2.actor.current, before);
  const blade = await enemy('enemy_9014_acstma');
  blade.setSkillSlot(0);
  blade.setSkill(true);
  assert.equal(blade.actor.current, 'Launch_Begin', '掷剑');
});

// The wind-up look-ahead (render/app/windup.js, render/app.js windUpAttacks): a ['cast', id, slot] queued in the tick of
// that enemy's 'atk' winds the attack up on the slot (UnitView.windUp's third argument); a cast of another tick does not.
test('the look-ahead passes a cast of the attack\'s own tick to windUp, null for a cast of another tick', async () => {
  const { createWindUpLookahead } = await import('../../public/js/render/app/windup.js');
  const calls = [], starts = [];
  const view = { actor: null, windUp(dt, kind, slot) { calls.push({ dt: Math.round(dt * 1000) / 1000, kind, slot }); return true; } };
  const views = new Map([[1, view]]);
  const la = createWindUpLookahead({ views, woundUp: new WeakSet(), castStart: (v, tv, kind) => starts.push(kind) });
  const queue = (evs) => ({ forEachUpcoming(a, b, fn) { for (const [e, t] of evs) if (t > a && t <= b) fn(e, t); } });
  la.run(queue([[['cast', 1, 1], 2.2], [['atk', 1, 9, 'enemy'], 2.2]]), 2);
  assert.deepEqual(calls.pop(), { dt: 0.2, kind: 'enemy', slot: 1 }, 'the strike slot of the attack\'s tick');
  la.run(queue([[['cast', 1, 0], 2.1], [['atk', 1, 9, 'enemy'], 2.2]]), 2);
  assert.deepEqual(calls.pop(), { dt: 0.2, kind: 'enemy', slot: null }, 'a cast of an earlier tick: a plain wind-up');
  la.run(queue([[['atk', 1, 9, 'enemy'], 2.3]]), 2);
  assert.equal(calls.pop().slot, null, 'no cast: plain');
  // a tuple wound up once is not wound up again
  const e = ['atk', 1, 9, 'enemy'];
  la.run(queue([[e, 2.2]]), 2);
  la.run(queue([[e, 2.2]]), 2.05);
  assert.equal(calls.length, 1);
  assert.equal(starts.length, 4, 'the cast effects start with each wind-up');
});
