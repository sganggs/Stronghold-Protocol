// §34.31: role logic only, with original small fixtures; no extracted files or artwork.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { skillAttackMode } from '../../public/js/render/skillAttack.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { UF } from '../../shared/constants.js';

const assets = JSON.parse(readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));
let fake, SpineActor;
before(async () => {
  fake = installFakePixi();
  ({ SpineActor } = await import('../../public/js/render/spine.js'));
});
after(() => fake.restore());

function actor(charId, skillIndex, { hits, face = 'front', index = null, down = false, source = true } = {}) {
  const entry = structuredClone(assets.chars[charId].spine[face]);
  if (hits) entry.hits = hits;
  const a = new SpineActor({ animations: Object.keys(entry.animations).map(name => ({ name })) }, entry);
  a.setSkillIndex(skillIndex);
  if (source) a.skillAttackMode = () => {
    const mode = skillAttackMode(index, { info: { spine: charId }, skillIndex: a.skillIndex });
    return mode ? { ...mode, down } : null;
  };
  return a;
}

// Original minimal index-shaped fixture, not an extracted file. Mode numbers intentionally differ from skill slots.
const blemishineIndex = () => ({ units: { char_423_blemsh: { kind: 'char', modes: [
  { name: 'Default', attack: { animKey: 'Attack' } },
  { name: 'T2_Default', attack: { animKey: 'Attack' } },
  { name: 'S2', attack: { animKey: 'Attack' } },
  { name: 'S3', attack: { animKey: 'Skill_3' } },
], skills: {
  skchr_blemsh_2: { mode: 2, uses: [{ template: 'switch_mode' }] },
  skchr_blemsh_3: { mode: 3, uses: [{ template: 'switch_mode' }] },
} } } });

for (const loaded of [false, true]) {
  test(`Blemishine S2: cast once, normal attacks while sleepers remain (${loaded ? 'loaded index' : 'no index'})`, () => {
    for (const [face, down, strike] of [['front', false, 'Attack'], ['front', true, 'Attack_Down'], ['back', false, 'Attack']]) {
      const a = actor('char_423_blemsh', 1, { index: loaded ? blemishineIndex() : null, face, down });
      assert.deepEqual(a.entry.hits.Skill_2, [0.5], 'the real manifest cast has OnAttack');
      a.setSkill(true);
      assert.equal(a.current, 'Skill_2');
      for (let n = 0; n < 9; n++) {
        assert.equal(a.windUp(1.2, 0.2), true);
        a.attack(1.2);
        assert.equal(a.current, strike);
        assert.equal(a.strikePose().anim.name, strike);
        a.update(1.2);
        assert.equal(a.current, 'Idle');
        assert.equal(a.skillOn, true);
      }
      a.setSkill(false);
      assert.equal(a._attackClip(), a.roles.attack);
    }
  });

  test(`Blemishine S1 replacement and S3 strike stay on their own clips (${loaded ? 'loaded index' : 'no index'})`, () => {
    for (const slot of [0, 2]) {
      const a = actor('char_423_blemsh', slot, { index: loaded ? blemishineIndex() : null, down: true });
      a.setSkill(true);
      a.attack(1.2);
      assert.equal(a.current, `Skill_${slot + 1}`);
    }
  });
}

test('an unverified operator keeps its skill clip as the attack clip, even a lone clip without OnAttack', () => {
  // No generic cast heuristic (the integrator's narrowing, §34.31): only verified mode mappings change a clip.
  const a = actor('char_206_gnosis', 1, { hits: { Attack: [0.3], Skill_2: [] }, index: null });
  a.setSkill(true);
  assert.equal(a._attackClip(), a.roles.skill);
});

test('Blemishine S2 without an index: the cast plays at skill start, then normal strikes (the verified mapping)', () => {
  // Synthetic no-event variant. The installed Blemishine manifest DOES have Skill_2: [0.5].
  // the client always attaches the mapping hook; with no index loaded it gets null (units.js)
  const a = actor('char_423_blemsh', 1, { hits: { Attack: [0.5], Skill_2: [] }, index: null });
  a.setSkill(true);
  assert.equal(a.current, 'Skill_2', 'the cast still plays once');
  assert.equal(a._attackClip(), a.roles.attack);
  assert.equal(a.windUp(1.2, 0.2), true);
  assert.equal(a.current, 'Attack');
  a.attack(1.2);
  assert.equal(a.strikePose().anim.name, 'Attack');
  assert.equal(a.strikePose().time, 0.5);
  a.update(2);
  assert.equal(a.current, 'Idle');
});

test('Blemishine S3 keeps its OnAttack strike without an index', () => {
  const a = actor('char_423_blemsh', 2);
  a.setSkill(true);
  a.attack(1.2);
  assert.equal(a.current, 'Skill_3');
  assert.equal(a.strikePose().time, 0.567);
});

test('held stances, dedicated strikes and distinct skill idles retain their role logic', () => {
  for (const [id, slot, strike, rest] of [
    ['char_128_plosis', 1, null, 'Skill_Loop'],
    ['char_1020_reed2', 2, 'Skill_3_Attack', 'Skill_3_Loop'],
    ['char_4207_branch', 1, 'Skill_2_Loop', 'Skill_2_Idle'],
  ]) {
    for (const index of [null, { units: { [id]: { kind: 'char', modes: [{ name: 'Default', attack: { animKey: 'Attack' } }],
      skills: { [`skchr_${id.split('_').at(-1)}_${slot + 1}`]: { mode: 0 } } } } }]) {
      const a = actor(id, slot, { index });
      a.setSkill(true);
      a.update(3);
      assert.equal(a._attackClip()?.loop ?? null, strike, id);
      a.attack(1.2);
      if (strike) {
        assert.equal(a.current, strike, id);
        a.update(3);
        assert.equal(a.current, rest, id);
      } else {
        assert.notEqual(a.current, 'Attack', id);
        assert.equal(a._idleName(), rest, id);
      }
      a.setSkill(false);
      assert.equal(a.current, a.roles.skill.end, id);
    }
  }
});

test('loaded mode selection uses the skill link and the default when there is no switch', () => {
  const index = blemishineIndex();
  const input = { info: { spine: 'char_423_blemsh' }, skillIndex: 1 };
  index.units.char_423_blemsh.skills.skchr_blemsh_2.mode = 3;
  assert.deepEqual(skillAttackMode(index, input), { animKey: 'Skill_3' }, 'not skillIndex + 1 or a guessed S2 name');
  index.units.char_423_blemsh.skills.skchr_blemsh_2.mode = null;
  assert.deepEqual(skillAttackMode(index, input), { animKey: 'Attack' });
  assert.deepEqual(skillAttackMode({ units: {} }, input), { animKey: 'Attack' }, 'verified fallback without a unit');
  delete index.units.char_423_blemsh.skills.skchr_blemsh_2;
  assert.deepEqual(skillAttackMode(index, input), { animKey: 'Attack' }, 'verified fallback without a skill');
});

test('unverified legacy mode keys do not replace Humus and Gavial skill strikes', () => {
  for (const [id, slot, strike] of [['char_491_humus', 1, 'Skill_2_Loop'], ['char_1026_gvial2', 2, 'Skill_3']]) {
    const index = { units: { [id]: { modes: [{ name: `S${slot + 1}`, attack: { animKey: 'Attack' } }],
      skills: { [`skchr_${id.split('_').at(-1)}_${slot + 1}`]: { mode: 0 } } } } };
    const a = actor(id, slot, { index });
    a.setSkill(true);
    a.attack(1.2);
    assert.equal(a.current, strike);
  }
});

test('a cosmetic skeleton without the mapped clip keeps its own roles', () => {
  const a = actor('char_423_blemsh', 1, { index: blemishineIndex() });
  a.names.delete('Attack');
  a.setSkill(true);
  assert.equal(a._attackClip(), a.roles.skill);
});

test('UnitView reads late index loads and current slot / direction without initiating index loads', async () => {
  const { UnitView } = await import('../../public/js/render/units.js');
  const entry = assets.chars.char_423_blemsh.spine.front;
  const model = { animations: Object.keys(entry.animations).map(name => ({ name })) };
  let index = null;
  const ctx = fakeViewCtx(fake.P, {
    cam: () => presetCamera('normal', { width: 1280, height: 720 }),
    skillAttackIndex: () => index,
    ofx: { lib: { index() { assert.fail('role selection must not fetch the index'); } } },
    assets: { picture: () => null, spineEntry: () => entry, spine: { acquire: async () => model, release() {} } },
  });
  const v = new UnitView(ctx, { id: 1, kind: 'op', side: 'ally', spine: 'char_423_blemsh',
    defId: 'chess_char_3_12_a', maxHp: 100, skillIndex: 1, dir: 'RIGHT' });
  v.flags |= UF.SKILL; // the snapshot and skill arrive while the model is still loading
  v.setSkill(true);
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.ok(v.actor);
    assert.equal(v.actor.skillOn, true);
    assert.equal(v.actor._attackClip().loop, 'Attack');
    v.setDir('DOWN');
    assert.equal(v.actor._attackClip().loop, 'Attack_Down');
    index = blemishineIndex();
    index.units.char_423_blemsh.skills.skchr_blemsh_2.mode = 3;
    assert.equal(v.actor._attackClip().loop, 'Skill_3', 'the late index is read without rebuilding the actor');
    v.setSkillSlot(0);
    assert.equal(v.actor._attackClip().loop, 'Skill_1');
    v.setSkillSlot(2);
    assert.equal(v.actor._attackClip().loop, 'Skill_3');
  } finally { v.destroy(); }
});

test('enemy abilities and token controllers keep their no-event skill clips', async () => {
  const { UnitView } = await import('../../public/js/render/units.js');
  const entry = { animations: { Idle: 1, Attack: 1, Skill: 1 }, hits: {},
    anims: { idle: 'Idle', attack: { loop: 'Attack' }, skill: { begin: null, loop: 'Skill', end: null } } };
  for (const kind of ['enemy', 'token']) {
    const ctx = fakeViewCtx(fake.P, {
      cam: () => presetCamera('normal', { width: 1280, height: 720 }),
      assets: { picture: () => null, spineEntry: () => entry,
        spine: { acquire: async () => ({ animations: Object.keys(entry.animations).map(name => ({ name })) }), release() {} } },
    });
    const v = new UnitView(ctx, { id: 1, kind, side: kind === 'enemy' ? 'enemy' : 'ally', defId: 'fixture', maxHp: 100 });
    await new Promise(resolve => setImmediate(resolve));
    try {
      v.setSkill(true);
      v.actor.attack(1);
      assert.equal(v.actor.current, 'Skill', kind);
    } finally { v.destroy(); }
  }
});
