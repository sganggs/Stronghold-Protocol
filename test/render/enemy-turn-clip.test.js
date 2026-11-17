// test/render/enemy-turn-clip.test.js — DESIGN §35.57: an attack-class skill cast in the attack's turn (server/sim/content/
// enemies.js attackTurnSkill: §35.19 / §35.29 / §35.52; the sim sends ['cast', id, slot, dur, clip] and no 'atk') plays
// its slot's official clip once in place of the attack — 迷路的巨像 StunAttack `Skill` 2.333 s, 鼠王 唱沙 `Skill_1`,
// 昆图斯's tide `Skill_02` —, or the attack clip when its ability names none (clip 0: 重弩突袭者's 直击). Until then the
// swing it replaced showed nothing (the model stood idle). Real manifest entries, headless fake PIXI.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';
import { ENEMY_ATTACK_SKILL_CLIP, castSlot } from '../../server/sim/content/enemies/helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));

let fake, UnitView;
before(async () => {
  fake = installFakePixi();
  ({ UnitView } = await import('../../public/js/render/units.js'));
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

test('the sim marks an attack-turn cast with its clip', () => {
  const WALL = chessRec({ id: 't_wall', profession: 'TANK', stats: { atk: 0, maxHp: 1e9, def: 0, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
  const h = makeBattle({
    content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 7, autoFinish: false, timeLimit: 900, kind: 'normal',
    sharedBoss: { hp: 1e9, maxHp: 1e9, damage() {} }, defs: { chess: { t_wall: WALL } }, kits: { t_wall: () => ({ trait: { noAttack: true } }) },
    enemies: [], units: [{ chessId: 't_wall', row: 9, col: 6 }],
  });
  h.step();
  const e = h.spawn('enemy_2003_rockman', { pos: [9, 7], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => h.events.some((x) => x[0] === 'cast' && x[1] === e.id), 60);
  const ev = h.events.find((x) => x[0] === 'cast' && x[1] === e.id);
  assert.equal(ev.length, 5);
  assert.equal(ev[4], ENEMY_ATTACK_SKILL_CLIP.enemy_2003_rockman.StunAttack);
  assert.ok(!h.events.some((x) => x[0] === 'atk' && x[1] === e.id && h.events.indexOf(x) > h.events.indexOf(ev)), 'no attack with it');
});

test('plain cooldown casts keep their tuple, including a blackboard duration when present', () => {
  const events = [], b = { _ev: (e) => events.push(e) }, e = { id: 1 };
  castSlot(b, e, { slot: 2, bb: {} });
  castSlot(b, e, { slot: 3, bb: { duration: 1.234 } });
  assert.deepEqual(events, [['cast', 1, 2], ['cast', 1, 3, 1.23]]);
});

test('迷路的巨像: a StunAttack turn plays its Skill clip once at its own speed, then the attack clip again', async () => {
  const v = await enemy('enemy_2003_rockman');
  v.onAttack(null, 1, 'enemy');
  assert.equal(v.actor.current, 'Attack', 'a plain attack');
  run(v, 4, 1);
  v.setSkillSlot(0);
  v.onCast(0, 5, ENEMY_ATTACK_SKILL_CLIP.enemy_2003_rockman.StunAttack);
  assert.equal(v.actor.current, 'Skill', 'the turn plays the skill clip');
  assert.equal(v.actor.mode, 'attack');
  run(v, 3, 5);
  assert.equal(v.actor.strike, null, 'over with its clip');
  assert.notEqual(v.actor.current, 'Skill');
  v.onAttack(null, 8, 'enemy');
  assert.equal(v.actor.current, 'Attack', 'the next attack is plain');
});

test('an own-turn cast seen ahead winds its clip up (鼠王 唱沙 Skill_1), not restarted when rendered', async () => {
  const v = await enemy('enemy_1509_mousek');
  run(v, 1);
  v.setSkillSlot(0);
  assert.equal(v.windUpCast(0.2, 0, ENEMY_ATTACK_SKILL_CLIP.enemy_1509_mousek.DriftSand), true);
  assert.equal(v.actor.current, 'Skill_1');
  const tr = v.actor.spine.state.tracks[0];
  const started = tr && tr.trackTime;
  run(v, 0.2, 1);
  v.onCast(0, 1.2, ENEMY_ATTACK_SKILL_CLIP.enemy_1509_mousek.DriftSand);
  assert.equal(v.actor.current, 'Skill_1');
  if (tr && started != null) assert.ok(v.actor.spine.state.tracks[0] === tr, 'the same track entry: not restarted');
});

test('an ability that names no clip (clip 0: 重弩突袭者 直击) swings the attack clip; 昆图斯\'s tide plays Skill_02', async () => {
  const v = await enemy('enemy_1404_msnip');
  run(v, 1);
  v.setSkillSlot(0);
  v.onCast(0, 1, 0);
  assert.equal(v.actor.current, 'Attack', 'the attack clip, not the primary skill clip');
  const q = await enemy('enemy_1521_dslily');
  run(q, 1);
  q.setSkillSlot(6);
  q.onCast(6, 1, 1.667);
  assert.equal(q.actor.current, 'Skill_02');
});

test('the look-ahead winds up an attack-turn cast (the 5-field tuple) once, and leaves a plain cast to the attack', async () => {
  const { createWindUpLookahead } = await import('../../public/js/render/app/windup.js');
  const calls = [];
  const view = { actor: null, windUp() { return true; }, windUpCast(dt, slot, clip) { calls.push({ dt: Math.round(dt * 1000) / 1000, slot, clip }); return true; } };
  const la = createWindUpLookahead({ views: new Map([[1, view]]), woundUp: new WeakSet(), castStart() {} });
  const queue = (evs) => ({ forEachUpcoming(a, b, fn) { for (const [e, t] of evs) if (t > a && t <= b) fn(e, t); } });
  const e = ['cast', 1, 2, 0, 2.333];
  la.run(queue([[e, 2.25]]), 2);
  la.run(queue([[e, 2.25]]), 2.1);
  assert.deepEqual(calls, [{ dt: 0.25, slot: 2, clip: 2.333 }]);
  la.run(queue([[['cast', 1, 0], 2.2]]), 2);
  assert.equal(calls.length, 1, 'a plain cast is no turn');
});
