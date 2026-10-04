// test/render/feedback3-move-deploy.test.js — 乌尔比安's S3 【移动】 and 【返回】 are redeploys since 0.1.3 (sim
// Battle.moveRedeploy: a 'deploy' event, the snapshot's deploy animation). The client shows them as deploys: the
// interpolation snaps a unit whose deploy animation starts between two snapshots instead of sliding it there, and a
// skill that ends as the unit deploys (the 【返回】 comes right before the S3's 'skill' off event) lets the deploy clip
// (Start) play out instead of cutting it with the skill's End clip. Real manifest entry, headless fake PIXI.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi } from './fakepixi.js';
import { SnapshotBuffer } from '../../public/js/render/interp.js';
import { ANIM } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assets = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
const snap = (t, units) => ({ fieldId: 'n:1', t, units, dp: 10, killed: 0, total: 5 });
const U = (id, x, y, anim = ANIM.IDLE) => [id, x, y, 100, 100, 5, 10, 0, anim];

let fake, SpineActor;
before(async () => {
  fake = installFakePixi();
  ({ SpineActor } = await import('../../public/js/render/spine.js'));
});
after(() => fake.restore());

test('interp: a unit redeployed between two snapshots (its deploy animation starts) snaps to its tile; a walk still slides', () => {
  const b = new SnapshotBuffer({ teleport: 2.5 });
  b.push(snap(0, [U(1, 3, 10), U(2, 3, 11)]), 0);
  b.push(snap(0.1, [U(1, 5, 10, ANIM.DEPLOY), U(2, 5, 11)]), 0.05); // 1: a 2-tile 【移动】; 2: a 2-tile slide
  const mid = b.sample(0.05);
  assert.equal(mid.get(1).x, 3, 'the old tile until the new snapshot');
  assert.equal(mid.get(1).vx, 0);
  assert.equal(mid.get(2).x, 4, 'a plain move interpolates');
  assert.equal(b.sample(0.1).get(1).x, 5, 'then the new tile');
  // already deploying in both snapshots (deployed < 0.5 s before): an ordinary lerp
  const c = new SnapshotBuffer({ teleport: 2.5 });
  c.push(snap(0, [U(1, 3, 10, ANIM.DEPLOY)]), 0);
  c.push(snap(0.1, [U(1, 4, 10, ANIM.DEPLOY)]), 0.05);
  assert.equal(c.sample(0.05).get(1).x, 3.5);
  // a stalled stream right after the jump: no extrapolation along it
  const d = new SnapshotBuffer({ teleport: 2.5, maxExtrapolate: 0.1, rate: 2 });
  d.push(snap(0, [U(1, 3, 10)]), 0);
  d.push(snap(0.1, [U(1, 5, 10, ANIM.DEPLOY)]), 0.05);
  assert.equal(d.sample(0.25).get(1).x, 5, 'stays on its new tile');
});

test('SpineActor: 乌尔比安\'s 【返回】 — deploy then skill off keeps the Start clip, then the plain idle; skill off alone plays the End', () => {
  const entry = assets.chars.char_4145_ulpia.spine.front;
  const make = () => {
    const a = new SpineActor({ animations: Object.keys(entry.animations).map((name) => ({ name })) }, entry);
    a.setSkillIndex(2);
    return a;
  };
  const run = (a, s, dt = 1 / 60) => { for (let t = 0; t < s - 1e-9; t += dt) a.update(dt); };
  assert.deepEqual([make().roles.deploy, make().roles.skill.end], ['Start', 'Skill_3_End'], 'the manifest roles');
  const a = make();
  a.setSkill(true);   // S3 on ('skill' 1) …
  a.deploy();         // … and his 【移动】 ('deploy') in the same batch: the Start clip on the anchor tile
  assert.equal(a.current, 'Start');
  run(a, 3);
  assert.equal(a.mode, 'base');
  a.deploy();         // the 【返回】 ('deploy') …
  a.setSkill(false);  // … right before the S3's 'skill' 0
  assert.equal(a.mode, 'deploy');
  assert.equal(a.current, 'Start', 'the deploy clip is not cut by Skill_3_End');
  run(a, entry.animations.Start + 0.1);
  assert.equal(a.mode, 'base');
  assert.equal(a.current, 'Idle', 'then the plain idle (the skill is off)');
  const b = make();
  b.setSkill(true);
  run(b, 3);
  b.setSkill(false);
  assert.equal(b.current, 'Skill_3_End', 'a skill ending without a deploy still plays its End clip');
});
