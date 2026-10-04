// test/render/feedback3-skill-idle.test.js — community report #23 (0.1.3): "折娅开了技能就会不停做跳起来打人的动作，哪怕没有接敌".
// 折桠's S2 model (char_4207_branch) has Skill_2_Begin, Skill_2_Loop (the jump attack, OnAttack at 0.8 s), Skill_2_End
// and Skill_2_Idle; the actor queued the loop after the begin clip, so it jumped with nobody to hit (the sim made no
// attack). Now a skill with an idle clip of its own (anims skill.idle ≠ skill.loop) stands in that idle between attacks,
// plays the loop only on attacks, and goes back to the idle after a spell of attacks (its End clip only when the skill
// ends). Skills whose loop IS their idle (蕾缪安 S3) and skills without an idle (宴) are unchanged. Real manifest entries,
// headless fake PIXI (test/render/fakepixi.js).

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

test('折桠 S2: begin, then Skill_2_Idle — the jump attack only on attacks, back to the idle after them, End only when the skill ends', () => {
  const a = actor('char_4207_branch', 1);
  assert.deepEqual([a.roles.skill.loop, a.roles.skill.idle], ['Skill_2_Loop', 'Skill_2_Idle'], 'the manifest roles');
  a.setSkill(true);
  assert.deepEqual(a.log, [['set', 'Skill_2_Begin', false], ['queue', 'Skill_2_Idle', true]], 'no Skill_2_Loop queued after the begin clip');
  run(a, 3);
  assert.equal(a.mode, 'base');
  assert.ok(!names(a).includes('Skill_2_Loop'), 'no attack: no jump attack');
  // she is hit, an enemy stands on her tile: attacks every 1.5 s
  a.log.length = 0;
  a.attack(1.5);
  assert.equal(a.current, 'Skill_2_Loop', 'the attack plays the skill loop');
  run(a, 1.5); a.attack(1.5);
  run(a, 1.5 * 1.4 + 0.1);
  assert.equal(a.mode, 'base');
  assert.equal(a.current, 'Skill_2_Idle', 'the enemy is gone: back to the skill idle');
  assert.ok(!names(a).includes('Skill_2_End'), 'the skill End clip is not played between attacks');
  a.setSkill(false);
  assert.equal(a.current, 'Skill_2_End', 'the skill ends on its End clip');
  run(a, 0.2);
  assert.equal(a.current, 'Idle');
});

test('the other skills with an own idle clip follow the same rule (史尔特尔 S3 begin → Skill_3_Idle); 耀骑士临光 S3 (no begin) already idled', () => {
  const s = actor('char_350_surtr', 2);
  s.setSkill(true);
  assert.deepEqual(s.log, [['set', 'Skill_3_Begin', false], ['queue', 'Skill_3_Idle', true]]);
  s.attack(1.25);
  assert.equal(s.current, 'Skill_3_Loop');
  const n = actor('char_1014_nearl2', 2);
  n.setSkill(true);
  assert.deepEqual(n.log, [['set', 'Skill_3_Idle', true]], 'unchanged: the skill idle at once');
  n.attack(1.2);
  assert.equal(n.current, 'Skill_3');
  run(n, 1.2 * 1.4 + 0.1);
  assert.equal(n.current, 'Skill_3_Idle');
});

test('unchanged: a loop that is the skill idle (蕾缪安 S3) and a skill without an idle clip (宴: its loop stays the stance)', () => {
  const l = actor('char_4193_lemuen', 2);
  l.setSkill(true);
  assert.deepEqual(l.log, [['set', 'Skill_3_Begin', false], ['queue', 'Skill_3_Idle', true]]);
  const u = actor('char_337_utage', 1);
  assert.equal(u.roles.skill.idle, null);
  u.setSkill(true);
  assert.deepEqual(u.log, [['set', 'Skill_Start', false], ['queue', 'Skill_Loop', true]], 'begin → loop, as before');
  u.log.length = 0;
  u.attack(1.2);
  run(u, 1.2 * 1.4 + 0.1);
  assert.deepEqual(names(u).slice(-2), ['Skill_End', 'Idle'], 'its spell of attacks still ends as before');
});
