// test/render/skill-loop-hold.test.js — DESIGN §34.4. A skill with Begin / Loop / End and no idle of its own
// plays Begin once, holds the loop for the whole skill, and plays End only when the skill ends. An attack during it
// plays a same-prefix attack clip when the skeleton has one (焰影苇草 S3 Skill_3_Attack) and then the loop again.
// A loop that itself has OnAttack is that strike (送葬人 S2): windUp runs, strikePose is that frame, and the clip
// is scaled to the attack interval, then the looping loop again — not End. A loop with no OnAttack is not
// restarted (白面鸮 S2's heals used to replay the loop as a one-shot and then End + Idle). A stun returns to the
// held loop; a skill that turns on during a stun plays Begin when the stun ends.
// Real manifest entries, headless fake PIXI (test/render/fakepixi.js). The fake does not advance a queued clip, so a
// held loop is asserted by the log staying empty.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi } from './fakepixi.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assets = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));

let fake, SpineActor;
before(async () => {
  fake = installFakePixi();
  ({ SpineActor } = await import('../../public/js/render/spine.js'));
});
after(() => fake.restore());

/** An actor of a real operator's Front model with its equipped skill, recording every clip set / queued. */
function actor(charId, skillIndex) {
  const entry = assets.chars[charId].spine.front;
  const a = new SpineActor({ animations: Object.keys(entry.animations).map((name) => ({ name })) }, entry);
  a.setSkillIndex(skillIndex);
  a.log = [];
  const st = a.spine.state;
  const set = st.setAnimation, add = st.addAnimation;
  st.setAnimation = (i, name, loop) => { a.log.push(['set', name, !!loop]); return set(i, name, loop); };
  st.addAnimation = (i, name, loop) => { a.log.push(['queue', name, !!loop]); return add(i, name, loop); };
  return a;
}
const run = (a, s, dt = 1 / 60) => { for (let t = 0; t < s - 1e-9; t += dt) a.update(dt); };
const names = (a) => a.log.map(([, n]) => n);

/** Let the attack clip that is playing now finish and settle (the return-to-loop, or End). */
function settle(a) {
  run(a, Math.max(0, a.attackUntil - a.clock) + 0.05);
}

test('白面鸮 S2: Begin once, the loop holds through heals, End only when the skill ends', () => {
  const a = actor('char_128_plosis', 1);
  assert.equal(a.roles.skill.idle, null);
  assert.deepEqual(
    [a.roles.skill.begin, a.roles.skill.loop, a.roles.skill.end],
    ['Skill_Start', 'Skill_Loop', 'Skill_End'],
  );
  assert.equal(a._skillOwnAttack(), null, 'no Skill_Attack beside the loop');
  a.setSkill(true);
  assert.deepEqual(a.log, [['set', 'Skill_Start', false], ['queue', 'Skill_Loop', true]]);
  a.log.length = 0;
  // her S2 heals on the attack interval (sim 'atk'); one of them lands during Begin
  for (let i = 0; i < 4; i++) {
    assert.equal(a.windUp(1.05, 0.15), false, 'a heal does not wind up a new clip');
    a.attack(1.05);
    run(a, 1.05);
  }
  assert.deepEqual(a.log, [], 'heals do not replay Begin, the loop, End or Idle');
  assert.equal(a.current, 'Skill_Start', 'the queued loop is never replaced');
  a.setSkill(false);
  assert.equal(a.current, 'Skill_End');
  run(a, a.dur('Skill_End') + 0.05);
  assert.equal(a.current, 'Idle');
  assert.ok(!names(a).includes('Skill_Start'), 'End does not start the skill over');
});

test('焰影苇草 S3: attacks play Skill_3_Attack, then the loop; End only when the skill ends', () => {
  const a = actor('char_1020_reed2', 2);
  assert.equal(a.roles.skill.idle, null);
  assert.deepEqual(
    [a.roles.skill.begin, a.roles.skill.loop, a.roles.skill.end],
    ['Skill_3_Begin', 'Skill_3_Loop', 'Skill_3_End'],
  );
  assert.equal(a._skillOwnAttack(), 'Skill_3_Attack');
  a.setSkill(true);
  assert.deepEqual(a.log, [['set', 'Skill_3_Begin', false], ['queue', 'Skill_3_Loop', true]]);
  run(a, a.dur('Skill_3_Begin') + 0.05);
  a.log.length = 0;
  for (let i = 0; i < 3; i++) {
    a.attack(1.2);
    assert.equal(a.current, 'Skill_3_Attack', 'the skill\'s own strike, not Begin and not the loop as a one-shot');
    settle(a);
    assert.equal(a.current, 'Skill_3_Loop');
    assert.equal(a.spine.state.tracks[0].loop, true, 'back to the looping stance');
  }
  assert.ok(!names(a).includes('Skill_3_End') && !names(a).includes('Idle') && !names(a).includes('Skill_3_Begin'));
  a.setSkill(false);
  assert.equal(a.current, 'Skill_3_End');
  run(a, a.dur('Skill_3_End') + 0.05);
  assert.equal(a.current, 'Idle');
});

test('星熊 S1: the plain Skill loop holds through attacks (no Skill_Attack clip)', () => {
  const a = actor('char_136_hsguma', 0);
  assert.equal(a.roles.skill.idle, null);
  assert.deepEqual(
    [a.roles.skill.begin, a.roles.skill.loop, a.roles.skill.end],
    ['Skill_Begin', 'Skill', 'Skill_End'],
  );
  assert.equal(a._skillOwnAttack(), null, 'Attack and Skill_Down are not this skill\'s strike');
  a.setSkill(true);
  assert.deepEqual(a.log, [['set', 'Skill_Begin', false], ['queue', 'Skill', true]]);
  a.log.length = 0;
  for (let i = 0; i < 3; i++) {
    a.attack(1.2);
    run(a, 1.2);
  }
  assert.deepEqual(a.log, []);
  assert.ok(a.current !== 'Attack' && a.current !== 'Skill_End' && a.current !== 'Idle');
  a.setSkill(false);
  assert.equal(a.current, 'Skill_End');
});

test('送葬人 S2: the loop\'s OnAttack is the strike — windUp, strikePose, scale follows the interval', () => {
  const a = actor('char_279_excu', 1);
  const loop = 'Skill_Right_Loop';
  const iv = 1.553; // reported skill attack interval; the clip is 2 s with hits at 0.1 and 0.267
  assert.equal(a.roles.skill.idle, null);
  assert.deepEqual(
    [a.roles.skill.begin, a.roles.skill.loop, a.roles.skill.end],
    ['Skill_Right_Begin', loop, 'Skill_Right_End'],
  );
  assert.deepEqual(a.entry.hits[loop], [0.1, 0.267]);
  assert.equal(a._skillOwnAttack(), null, 'no separate Skill_Right_Attack');
  a.setSkill(true);
  run(a, a.dur('Skill_Right_Begin') + 0.05);
  a.log.length = 0;
  assert.equal(a.windUp(iv, 0.04), true, 'the swing starts before the shot');
  assert.equal(a.mode, 'attack');
  assert.equal(a.current, loop);
  const pose = a.strikePose();
  assert.equal(pose && pose.anim.name, loop);
  assert.equal(pose.time, 0.1, 'the shot leaves the first OnAttack frame');
  const expectTs = a.dur(loop) / iv;
  assert.ok(Math.abs(a.windTs - expectTs) < 1e-9, 'the rhythm scale is duration / interval');
  a.attack(iv);
  assert.ok(Math.abs(a.spine.state.tracks[0].timeScale - expectTs) < 1e-9);
  settle(a);
  assert.equal(a.current, loop);
  assert.equal(a.spine.state.tracks[0].loop, true, 'back to the looping loop, not End');
  assert.ok(!names(a).includes('Skill_Right_End') && !names(a).includes('Idle') && !names(a).includes('Attack'));
  assert.equal(a.windUp(iv, 0.04), true, 'the next shot winds up again');
  assert.equal(a.strikePose().time, 0.1);
});

test('夕 S2: OnAttack at the first frame does not wind up; the attack still scales the loop and sets strikePose', () => {
  // [ASSUMED] DESIGN §34.4.1: hit time 0 has no wind-up (windUp requires hit > 0). The shot still uses that frame.
  const a = actor('char_2015_dusk', 1);
  const loop = 'Skill2_Loop';
  const iv = 2.071;
  assert.deepEqual(a.entry.hits[loop], [0]);
  a.setSkill(true);
  run(a, a.dur('Skill2_Begin') + 0.05);
  assert.equal(a.windUp(iv, 0.05), false, 'nothing to wind up when the strike is frame 0');
  a.attack(iv);
  assert.equal(a.mode, 'attack');
  assert.equal(a.current, loop);
  assert.equal(a.strikePose().time, 0);
  assert.ok(Math.abs(a.spine.state.tracks[0].timeScale - a.dur(loop) / iv) < 1e-9);
  settle(a);
  assert.equal(a.current, loop);
  assert.equal(a.spine.state.tracks[0].loop, true);
  assert.ok(!names(a).includes('Skill2_End') && !names(a).includes('Idle'));
});

test('白面鸮 S2: a stun mid-skill returns to the loop, and the next heal leaves her there', () => {
  const a = actor('char_128_plosis', 1);
  a.setSkill(true);
  assert.equal(a.current, 'Skill_Start');
  a.setBase('stun');
  assert.equal(a.mode, 'stun');
  assert.equal(a.skillOn, true);
  a.log.length = 0;
  a.setBase('idle');
  assert.equal(a.skillOn, true);
  assert.equal(a.mode, 'base');
  assert.equal(a.current, 'Skill_Loop');
  assert.equal(a.spine.state.tracks[0].loop, true);
  assert.deepEqual(a.log, [['set', 'Skill_Loop', true]]);
  a.log.length = 0;
  assert.equal(a.windUp(1.05, 0.15), false);
  a.attack(1.05);
  assert.deepEqual(a.log, [], 'a heal does not stand her up');
  assert.equal(a.current, 'Skill_Loop');
});

test('白面鸮 S2: a skill that starts during a stun plays Begin when the stun ends', () => {
  const a = actor('char_128_plosis', 1);
  a.setBase('stun');
  a.log.length = 0;
  a.setSkill(true);
  assert.equal(a.mode, 'stun');
  assert.equal(a.skillOn, true);
  assert.deepEqual(a.log, [], 'Begin waits');
  a.setBase('idle');
  assert.deepEqual(a.log, [['set', 'Skill_Start', false], ['queue', 'Skill_Loop', true]]);
  assert.equal(a.mode, 'skillBegin');
  run(a, a.dur('Skill_Start') + 0.05);
  assert.equal(a.mode, 'base');
  // the fake never advances a queued clip, so she is still on Begin until something plays the loop
  a.log.length = 0;
  a.setBase('stun');
  a.setBase('idle');
  assert.equal(a.current, 'Skill_Loop', 'the second stun resumes the loop and does not replay Begin');
  assert.deepEqual(a.log, [['set', 'Skill_Loop', true]]);
  a.setSkill(false);
  assert.equal(a.current, 'Skill_End');
});
