// test/render/loadout-skill.test.js — the equipped skill (DESIGN §16 operator loadout, user playtest #2 item 1) reaches
// the battle presentation: the sim's UnitInfo carries `skillIndex`, the Spine actor plays THAT skill's clip
// (`anims.skills[index]`, e.g. 史尔特尔 on S1 never shows the S3 黄昏 transformation) and the audio plays that skill's
// own ON_SKILL_START sound (`sfx.units[id].skills[index]`). Integration regressions (the loadout batch had the sim,
// data and UI, but every battle still animated / sounded the default skill).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';
import { AudioManager } from '../../public/js/audio.js';

const REAL = { skip: !hasGeneratedData() };

describe('UnitInfo.skillIndex (sim)', () => {
  test('spawn events carry the equipped skill index: the loadout one, else the default', REAL, () => {
    const h = makeBattle({
      units: [
        { chessId: 'chess_char_5_07_a', row: 10, col: 5, uid: 1, skillIndex: 0 },   // 史尔特尔 on S1 (default S3)
        { chessId: 'chess_char_1_01_a', row: 11, col: 5, uid: 2 },                  // 隐现 on its default S2
      ],
      enemies: [], autoFinish: false, timeLimit: 10,
    });
    h.step();
    const spawns = h.eventsOf('spawn').map((e) => e[1]).filter((u) => u.side === 'ally');
    const byUid = new Map(spawns.map((u) => [u.uid, u]));
    assert.equal(byUid.get(1)?.skillIndex, 0, '史尔特尔: S1');
    assert.equal(byUid.get(2)?.skillIndex, 1, '隐现: default S2');
  });
});

describe('Spine actor + audio use the equipped skill', () => {
  let fake, UnitView;
  before(async () => {
    fake = installFakePixi();
    ({ UnitView } = await import('../../public/js/render/units.js'));
  });
  after(() => fake.restore());
  const tick = () => new Promise((r) => setImmediate(r));
  const cam = () => presetCamera('prep', { width: 1280, height: 720 });
  const S1 = { begin: null, loop: 'Skill_1', end: null, index: 0, idle: null };
  const S3 = { begin: 'Skill_3_Begin', loop: 'Skill_3_Loop', end: null, index: 2, idle: 'Skill_3_Idle' };
  const entry = {
    skel: '/s/x.skel', atlas: '/s/x.atlas', textures: ['/s/x.png'],
    anims: { idle: 'Idle', attack: { begin: null, loop: 'Attack', end: null }, skill: S3, skills: { 0: S1, 2: S3 } },
    animations: { Idle: 1, Attack: 1, Skill_1: 1, Skill_3_Begin: 0.6, Skill_3_Loop: 1, Skill_3_Idle: 1 },
  };
  const names = Object.keys(entry.animations).map((name) => ({ name }));
  const assets = {
    picture: () => null, image: async () => null, spineEntry: () => entry,
    spine: { acquire: async () => ({ animations: names }), release() {} },
  };
  async function actorFor(skillIndex) {
    const ctx = fakeViewCtx(fake.P, { assets, cam });
    const v = new UnitView(ctx, { id: 1, side: 'ally', kind: 'op', defId: 'chess_char_5_07_a', spine: 'char_350_surtr', tier: 5, x: 5, y: 10, maxHp: 1000, skillIndex });
    await tick(); await tick();
    assert.ok(v.actor, 'spine actor built');
    return v.actor;
  }

  test('S1 equipped: the skill clip is S1 (not the default S3 transformation)', async () => {
    const a = await actorFor(0);
    assert.equal(a.roles.skill.loop, 'Skill_1');
    a.setSkill(true);
    assert.equal(a._attackClip().loop, 'Skill_1', 'attacks during the skill use the S1 clip');
    assert.notEqual(a.current, 'Skill_3_Begin', 'no S3 transformation');
    const d = await actorFor(undefined);
    d.setSkill(true);
    assert.equal(d.current, 'Skill_3_Begin', 'control: the default S3 starts with its begin clip');
  });

  test('default / unknown index: the primary skill clip', async () => {
    assert.equal((await actorFor(undefined)).roles.skill.loop, 'Skill_3_Loop');
    assert.equal((await actorFor(2)).roles.skill.loop, 'Skill_3_Loop');
    assert.equal((await actorFor(1)).roles.skill.loop, 'Skill_3_Loop', 'no clip for S2 in the model: primary');
  });

  test('audio: the equipped skill’s own ON_SKILL_START sound', () => {
    const manifest = { audio: { sfx: { units: { char_350_surtr: { skill: '/sfx/s3.mp3', skills: { 0: '/sfx/s1.mp3', 2: '/sfx/s3.mp3' } } } } } };
    const a = new AudioManager({ win: null, getManifest: () => manifest });
    a.ctx = {};
    const played = [];
    a._play = (url) => { played.push(url); };
    a.setFieldUnits([
      { id: 1, side: 'ally', kind: 'op', defId: 'chess_char_5_07_a', spine: 'char_350_surtr', skillIndex: 0 },
      { id: 2, side: 'ally', kind: 'op', defId: 'chess_char_5_07_a', spine: 'char_350_surtr' },
    ]);
    a.handleBattleEvents([['skill', 1, 1], ['skill', 2, 1]]);
    assert.deepEqual(played, ['/sfx/s1.mp3', '/sfx/s3.mp3']);
  });

  // The sim's 'cast' event carries the data skill slot an enemy ability casts (content/enemies.js castSkillSlot →
  // render/app.js `case 'cast'` → UnitView.setSkillSlot): a multi-skill boss shows Skill_01..04 in turn instead of one
  // animation for every ability (docs/research/13 §7).
  test('an enemy cast slot swaps its skill clip mid-battle (多技能 BOSS)', async () => {
    const ctx = fakeViewCtx(fake.P, { assets, cam });
    const v = new UnitView(ctx, { id: 9, side: 'enemy', kind: 'enemy', defId: 'enemy_1521_dslily', x: 5, y: 10, maxHp: 100 }, {});
    await tick(); await tick();
    assert.ok(v.actor, 'spine actor built');
    assert.equal(v.actor.roles.skill.loop, 'Skill_3_Loop', 'the manifest primary clip to start with');
    assert.equal(v.skillIndex, null, 'no slot reported yet');
    v.setSkillSlot(0);                       // the 'cast' event's slot (data skills[0] → Skill_01)
    assert.equal(v.skillIndex, 0);
    assert.equal(v.actor.roles.skill.loop, 'Skill_1', 'that slot’s own clip');
    v.setSkillSlot(0);                       // the same slot again: nothing to rebuild
    assert.equal(v.actor.roles.skill.loop, 'Skill_1');
    v.setSkillSlot(-1);                      // a non-slot is ignored
    assert.equal(v.skillIndex, 0);
  });
});
