// §35.20: original index-shaped fixtures and existing manifest metadata; no client dumps or art fixtures.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { skillAttackMode } from '../../public/js/render/skillAttack.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { UF } from '../../shared/constants.js';

const assets = JSON.parse(readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));
const candidates = [
  ['char_102_texas', 0, 'skcom_charge_cost', 'Attack_Loop'],
  ['char_102_texas', 1, 'skchr_texas_2', 'Attack_Loop'],
  ['char_427_vigil', 0, 'skchr_vigil_1', 'Attack'],
  ['char_427_vigil', 1, 'skchr_vigil_2', 'Attack'],
  ['char_1023_ghost2', 0, 'skchr_ghost2_1', 'Attack'],
  ['char_1020_reed2', 1, 'skchr_reed2_2', 'Attack'],
  ['char_1014_nearl2', 1, 'skchr_nearl2_2', 'Attack_Loop'],
];
let fake, SpineActor;
before(async () => {
  fake = installFakePixi();
  ({ SpineActor } = await import('../../public/js/render/spine.js'));
});
after(() => fake.restore());

function indexFor(id, skillId) {
  // Deliberately reordered modes: Ghost's initial Empty switch is NOT its later attack mode.
  const modes = [
    { name: 'Empty' },
    { name: 'S2', attack: { animKey: 'Attack_Loop' } },
    { name: 'Default', attack: { animKey: /texas|vigil/.test(id) ? '' : 'Attack' } },
  ];
  const mode = id.includes('ghost2') ? 0 : id.includes('nearl2') ? 1 : null;
  return { units: { [id]: { kind: 'char', modes, skills: { [skillId]: { mode } } } } };
}

function actor(id, slot, { face = 'front', down = false, index = null, entry } = {}) {
  entry ||= structuredClone(assets.chars[id].spine[face]);
  const a = new SpineActor({ animations: Object.keys(entry.animations).map(name => ({ name })) }, entry);
  a.setSkillIndex(slot);
  a.skillAttackMode = () => ({ ...skillAttackMode(index, { info: { spine: id }, skillIndex: a.skillIndex }), down });
  return a;
}

for (const [id, slot, sid, strike] of candidates) for (const loaded of [false, true]) {
  test(`${id} S${slot + 1}: verified strikes, both models and four facings (${loaded ? 'index' : 'no index'})`, () => {
    for (const dir of ['RIGHT', 'LEFT', 'DOWN', 'UP']) {
      const face = dir === 'UP' ? 'back' : 'front', down = dir === 'DOWN';
      const a = actor(id, slot, { face, down, index: loaded ? indexFor(id, sid) : null });
      a.spine.scale.x = dir === 'LEFT' ? -1 : 1;
      const queued = [];
      const add = a.spine.state.addAnimation;
      a.spine.state.addAnimation = (track, name, loop, delay) => {
        queued.push(name);
        return add(track, name, loop, delay);
      };
      a.setSkill(true);
      const expected = down && a.roles.attackDown ? a.roles.attackDown : a.roles.attack;
      assert.equal(expected.loop, down && a.roles.attackDown ? 'Attack_Down' : strike);
      assert.equal(a._attackClip(), expected, 'retain the model attack role including its Begin/End');
      for (let n = 0; n < 3; n++) {
        assert.equal(a.windUp(1.2, 0.1), true);
        a.attack(1.2);
        assert.equal(a.current, expected.loop);
        assert.equal(a.strikePose().anim.name, expected.loop);
        assert.equal(a.strikePose().time, a.entry.hits[expected.loop][0]);
        a.update(2);
        assert.equal(a.mode, 'base');
        if (expected.end) {
          assert.equal(a.current, expected.end);
          assert.equal(queued.at(-1), 'Idle', 'fake PIXI records but does not advance the queued idle');
        } else assert.equal(a.current, 'Idle');
      }
      a.setSkill(false);
      assert.equal(a._attackClip(), a.roles.attack);
    }
  });
}

test('verified slots resolve DIY / record / common skill identities without accepting a different skill', () => {
  for (const [id, slot, sid] of candidates) {
    const rec = { charId: id, skill: { index: slot, skillId: `${sid}[3]`, prefabId: sid } };
    for (const index of [null, indexFor(id, sid)]) {
      assert.deepEqual(skillAttackMode(index, { rec }), { animKey: 'Attack' });
      assert.deepEqual(skillAttackMode(index, { info: { diy: { charId: id, skillIndex: slot } } }), { animKey: 'Attack' });
      assert.equal(skillAttackMode(index, { rec, info: { form: 'substitute' } }), null);
      const other = { ...rec, skill: { index: slot, skillId: 'plugin_other_skill' } };
      assert.notEqual(skillAttackMode(index, { rec: other })?.animKey, 'Attack');
    }
  }
  // Tulip has only skchr_apionr_1 in character/skill_table; a clip named Skill_2 is not an S2.
  assert.equal(skillAttackMode(null, { info: { spine: 'char_513_apionr', skillIndex: 1 } }), null);
});

test('cast clips still play once; hit events in Reed Front / Specter Back do not make them recurring attacks', () => {
  for (const [id, slot, face, cast] of [
    ['char_102_texas', 1, 'front', 'Skill'],
    ['char_427_vigil', 0, 'back', 'Skill1'],
    ['char_427_vigil', 1, 'front', 'Skill2'],
    ['char_1020_reed2', 1, 'front', 'Skill_2'],
    ['char_1023_ghost2', 0, 'back', 'Skill_1'],
  ]) {
    const a = actor(id, slot, { face });
    a.setSkill(true);
    assert.equal(a.current, cast);
    if (/reed2|ghost2/.test(id)) assert.ok(a.entry.hits[cast].length);
    a.setSkill(false);
    assert.equal(a.current, cast, 'an instant off must not erase the one-shot cast');
    a.update(4);
    assert.equal(a.current, 'Idle');
  }
});

test('cosmetic attack roles, missing clips, held loops and distinct skill idles retain ownership', () => {
  for (const [id, slot] of candidates) {
    const entry = structuredClone(assets.chars[id].spine.front);
    entry.animations.SkinStrike = 1;
    entry.anims.attack = { begin: null, loop: 'SkinStrike', end: null };
    const a = actor(id, slot, { entry });
    a.setSkill(true);
    assert.equal(a._attackClip(), a.roles.attack, 'use the installed skin role, not a default skeleton literal');
    a.names.delete('SkinStrike');
    assert.equal(a._attackClip(), a.roles.skill, 'missing normal role retains the skin skill');
  }
  const entry = structuredClone(assets.chars.char_1020_reed2.spine.front);
  // A cosmetic model may provide a held skill stance even for a verified slot.
  entry.anims.skills[1] = entry.anims.skills[2];
  const held = actor('char_1020_reed2', 1, { entry });
  held.setSkill(true);
  assert.equal(held._attackClip().loop, 'Skill_3_Attack');
  assert.equal(held._idleName(), 'Skill_3_Loop');
  for (const [id, slot, strike, idle] of [
    ['char_427_vigil', 2, 'Skill3_Attack_A', 'Skill3_Idle'],
    ['char_1023_ghost2', 2, 'Skill_3_Attack', 'Skill_3_Idle'],
    ['char_1014_nearl2', 0, 'Skill_1_Loop', 'Skill_1_Idle'],
    ['char_1014_nearl2', 2, 'Skill_3', 'Skill_3_Idle'],
    ['char_431_ashlok', 1, 'Skill_Loop', 'Skill_Idle'],
  ]) {
    const a = actor(id, slot, { index: indexFor(id, `skchr_${id.split('_').at(-1)}_${slot + 1}`) });
    a.setSkill(true);
    a.attack(1);
    assert.equal(a.current, strike);
    a.update(3);
    assert.equal(a.current, idle);
  }
});

test('UnitView keeps the verified mapping across late index/model loads, slots and Front/Back swaps', async () => {
  const { UnitView } = await import('../../public/js/render/units.js');
  let index = null;
  const ctx = fakeViewCtx(fake.P, {
    cam: () => presetCamera('normal', { width: 1280, height: 720 }),
    skillAttackIndex: () => index,
    assets: { picture: () => null, hasBack: () => true,
      spineEntry: (_id, { back }) => assets.chars.char_427_vigil.spine[back ? 'back' : 'front'],
      spine: { acquire: async entry => ({ animations: Object.keys(entry.animations).map(name => ({ name })) }), release() {} },
    },
  });
  const v = new UnitView(ctx, { id: 1, kind: 'op', side: 'ally', spine: 'char_427_vigil', maxHp: 100, skillIndex: 0, dir: 'RIGHT' });
  const loaded = () => new Promise(resolve => setImmediate(resolve));
  try {
    v.flags |= UF.SKILL;
    v.setSkill(true); // arrives before the async model, then survives the Front/Back replacement
    await loaded();
    assert.equal(v.actor._attackClip().loop, 'Attack');
    index = indexFor('char_427_vigil', 'skchr_vigil_1');
    v.setDir('DOWN');
    assert.equal(v.actor._attackClip().loop, 'Attack_Down');
    v.setDir('UP');
    await loaded();
    assert.equal(v.actor.entry, assets.chars.char_427_vigil.spine.back);
    assert.equal(v.actor._attackClip().loop, 'Attack');
    v.setSkillSlot(2);
    assert.equal(v.actor._attackClip().loop, 'Skill3_Attack_A');
    v.setSkillSlot(1);
    assert.equal(v.actor._attackClip().loop, 'Attack');
  } finally { v.destroy(); }
});
