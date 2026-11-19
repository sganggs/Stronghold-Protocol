// test/render/vfx-jesca2-shell.test.js — 涤火杰西卡 S3 under 官方特效 (round 83, history §37.242; GitHub report: her S3's
// attack effects looked wrong). Her mode S3's attack is an AbilitySelectableGroup ('trigger') of ExtraBomb (a
// ProjectileToTileAbility: the shell) and S3Attack (her normal shot). An 'atk' plays S3Attack (fitsAttack never picks the
// to-tile ability: a guard here); the kit's 'bombardShell' now fires ExtraBomb (its cast at the muzzle for her facing,
// projectile_chr_jesca2_s3_bomb's trail flying straight to the end point) and its 'bombard' plays the shell's
// _effectsWhenStop jesca2_skill_03_hit_02 where it went off, ending the shell there (skills.js FX_BINDINGS
// skchr_jesca2_3 launch / ends). Until round 83 both drew 蕾缪安's procedural mortar shell and blast.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring, pickAttacks } from '../../public/js/render/vfx/wiring.js';
import { FX_BINDINGS, bindingKeys } from '../../public/js/render/vfx/skills.js';
import { UF } from '../../shared/constants.js';

const KEYS = ['jesca2_skill_03_start_01', 'jesca2_skill_03_start_01_02', 'jesca2_skill_03_trail_01', 'jesca2_skill_03_hit_01',
  'jesca2_skill_03_start_02', 'jesca2_skill_03_start_02_down', 'jesca2_skill_03_trail_02', 'jesca2_skill_03_hit_02',
  'jesca2_skill_03_buff_01', 'jesca2_attack_start_01', 'jesca2_attack_trail_01', 'jesca2_attack_hit_01', 'g_hit'];
const LOOPING = new Set(['jesca2_skill_03_buff_01', 'jesca2_skill_03_trail_01', 'jesca2_skill_03_trail_02', 'jesca2_attack_trail_01']);
const row = (keys, slots = null) => ({ effects: keys, directionType: slots ? 3 : 0, ...(slots ? { slots } : {}), oneshot: 1, startEvent: 2 });

/** The index rows of her modes as the extractor writes them (public/assets/local/fx/index.json units.char_1034_jesca2). */
function s3Mode(name) {
  const base = `Modes/${name}/Body/Attack`;
  return {
    name,
    attack: {
      class: 'AbilitySelectableGroup', node: base, select: { method: 'trigger' }, cast: [], hit: [],
      abilities: [
        { class: 'ProjectileToTileAbility', node: `${base}/ExtraBomb`, animKey: 'Skill_3_Skill', projectileKey: 'projectile_chr_jesca2_s3_bomb',
          cast: [row(['jesca2_skill_03_start_02', 'jesca2_skill_03_start_02_down'],
            ['jesca2_skill_03_start_02', 'jesca2_skill_03_start_02', 'jesca2_skill_03_start_02_down', 'jesca2_skill_03_start_02'])], hit: [] },
        { class: 'RangedAttack', node: `${base}/S3Attack`, animKey: 'Attack', projectileKey: 'projectile_chr_jesca2_s3',
          cast: [row(['jesca2_skill_03_start_01', 'jesca2_skill_03_start_01_down'],
            ['jesca2_skill_03_start_01', 'jesca2_skill_03_start_01', 'jesca2_skill_03_start_01_down', 'jesca2_skill_03_start_01']),
          row(['jesca2_skill_03_start_01_02'])], hit: [] },
      ],
    },
    combat: null,
  };
}

function makeIndex(installed) {
  const prefabs = Object.fromEntries(installed.map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k) }]));
  const ranged = (node, proj, start) => ({ class: 'RangedAttack', node, projectileKey: proj, cast: [row([start])], hit: [] });
  return {
    units: {
      char_1034_jesca2: {
        kind: 'char', skills: {}, talents: {}, startEffect: null, deadEffect: null,
        modes: [
          { name: 'Default', attack: ranged('Modes/Default/Body/Attack', 'projectile_chr_jesca2', 'jesca2_attack_start_01'), combat: null },
          { name: 'S1', attack: null, combat: null },
          { name: 'S2', attack: null, combat: null },
          s3Mode('S3'),
          s3Mode('S3[D]'),
        ],
      },
      enemy_dummy: { kind: 'enemy', skills: {}, talents: {}, startEffect: null, deadEffect: null, modes: [{ name: 'Default', attack: null, combat: null }] },
    },
    projectiles: {
      projectile_chr_jesca2: { main: 'jesca2_attack_trail_01', onHit: ['jesca2_attack_hit_01'], movement: { speed: 10 } },
      projectile_chr_jesca2_s3: { main: 'jesca2_skill_03_trail_01', onHit: ['jesca2_skill_03_hit_01'], movement: { speed: 10 } },
      // the shell: no onHit / onReached in the index — its blast is the EffectBehaviour's _effectsWhenStop
      projectile_chr_jesca2_s3_bomb: { main: 'jesca2_skill_03_trail_02', onHit: null, onReached: null, movement: { speed: 5 },
        effects: ['jesca2_skill_03_hit_02', 'jesca2_skill_03_trail_02'] },
    },
    skills: {
      skchr_jesca2_3: { rootClass: 'CastSkillWithLimitTimes', rootAbility: 'ActiveBuffAbility', effects: ['jesca2_skill_03_buff_01'],
        projectiles: [], mode: 3, modeBy: 'name', abilities: [], unclassified: [], roles: { loop: ['jesca2_skill_03_buff_01'] },
        uses: [{ role: 'loop', keys: ['jesca2_skill_03_buff_01'], from: 'ActiveBuffAbility._buffs', node: 'skchr_jesca2_3', on: 'owner', life: { type: 'INFINITY' } }] },
    },
    skins: {},
    generic: { hit: { phys: 'g_hit' }, die: {}, birth: {}, status: {}, keys: [] },
    prefabs,
  };
}

const RECS = {
  char_1034_jesca2: { skill: { skillId: 'skchr_jesca2_3', index: 2, skillType: 'MANUAL', durationType: 'AMMO', duration: -1, bb: {} } },
};

async function setup(installed = KEYS) {
  const index = makeIndex(installed);
  const handles = [];
  const ofx = {
    active: true, time: 0, lite: false, tier: 'full', timers: [], ctx: {},
    lib: {
      has: (k) => !!index.prefabs[k], def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: 1 } : null),
      index: async () => index, preload: async (keys) => keys.length, defs: new Map(),
    },
    spawn(key, place, opts) {
      const h = { key, place, opts, time: 0, anchor: [0, 0, 0], stopped: false, get alive() { return !this.stopped; },
        stop() { this.stopped = true; }, kill() { this.stopped = true; } };
      handles.push(h);
      return h;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, { speed: () => 10, record: (info) => RECS[info.defId] || null, view: (id) => views.get(id) || null });
  await w.ready();
  const jes = { id: 1, x: 5, y: 9, z: 0, visFacing: 1, isEnemy: false, alive: true, flags: 0, sp: 0, spMax: 10, dir: 'RIGHT',
    info: { id: 1, spine: 'char_1034_jesca2', defId: 'char_1034_jesca2', side: 'ally', kind: 'op', skillIndex: 2 } };
  const foe = { id: 2, x: 8, y: 9, z: 0, visFacing: -1, isEnemy: true, alive: true, flags: 0,
    info: { id: 2, spine: 'enemy_dummy', defId: 'enemy_dummy', side: 'enemy', kind: 'enemy' } };
  views.set(1, jes); views.set(2, foe);
  // the flights advance with the handles' clocks (the real effect layer's track callbacks)
  const frame = (dt = 1 / 30) => {
    w.sync(views.values()); w.tick(); ofx.time += dt;
    for (const h of handles) if (!h.stopped && typeof h.opts?.track === 'function') { h.time += dt; h.opts.track(h); }
  };
  await w.begin([...views.values()]);
  frame();
  return { w, ofx, jes, foe, frame, handles };
}

const keysOf = (handles) => handles.map((h) => h.key);

describe('涤火杰西卡 S3 under 官方特效 (round 83)', () => {
  test('pickAttacks (guard): her S3 shot is S3Attack, never the to-tile ExtraBomb; a group of to-tile shots keeps them', () => {
    const g = s3Mode('S3').attack;
    const picked = pickAttacks(g, { ranged: true }, 7, 0, 0);
    assert.deepEqual(picked.map((a) => a.node), ['Modes/S3/Body/Attack', 'Modes/S3/Body/Attack/S3Attack']);
    // 森蚺 S2: AbilityRandomGroup (loop) of three to-tile shots — still one of them in turn
    const tiles = { class: 'AbilityRandomGroup', select: { method: 'loop' },
      abilities: ['M', 'R', 'L'].map((n) => ({ class: 'ProjectileToTileAbility', node: `Modes/S2/Body/Attack/${n}Attack` })) };
    assert.deepEqual([0, 1, 2].map((nth) => pickAttacks(tiles, { ranged: true }, 7, 0, nth)[1].node.split('/').pop()), ['MAttack', 'RAttack', 'LAttack']);
  });

  test('the binding: launch ExtraBomb with the shell projectile; the blast is its stop effect and ends the shell', () => {
    const b = FX_BINDINGS.skchr_jesca2_3;
    assert.equal(b.bombardShell.launch, 'ExtraBomb');
    assert.equal(b.bombardShell.projectile, 'projectile_chr_jesca2_s3_bomb');
    assert.deepEqual([...b.bombard.keys], ['jesca2_skill_03_hit_02']);
    assert.equal(b.bombard.ends, 'bombardShell');
    assert.equal(b.bombard.during, undefined);
    assert.deepEqual(bindingKeys(makeIndex(KEYS), 'skchr_jesca2_3').sort(), ['jesca2_skill_03_hit_02', 'jesca2_skill_03_trail_02']);
  });

  test('an S3 shot plays S3Attack (start_01, its trail), never the shell', async () => {
    const { w, jes, foe, frame, handles } = await setup();
    jes.flags |= UF.SKILL; w.skill(jes, true); frame();
    const from = handles.length;
    w.castStart(jes, foe, 'ranged', { skip: 0, left: 0.6, skillOn: true });
    w.attack(jes, foe, 'ranged', 0, true);
    const got = keysOf(handles.slice(from));
    assert.ok(got.includes('jesca2_skill_03_start_01'), got.join());
    assert.ok(got.includes('jesca2_skill_03_trail_01'), got.join());
    assert.ok(!got.some((k) => /_0?2$|start_02|trail_02|hit_02/.test(k) && k !== 'jesca2_skill_03_start_01_02'), got.join());
  });

  test('bombardShell fires ExtraBomb: its cast for her facing and the shell flying straight; bombard blasts and ends it', async () => {
    const { w, jes, frame, handles } = await setup();
    jes.flags |= UF.SKILL; w.skill(jes, true); frame();
    const from = handles.length;
    assert.equal(w.simFx('bombardShell', 9, 9, { id: 1, r: 1.7, t: 0.8 }), true);
    const fired = handles.slice(from);
    assert.deepEqual(keysOf(fired).sort(), ['jesca2_skill_03_start_02', 'jesca2_skill_03_trail_02']);
    const shell = fired.find((h) => h.key === 'jesca2_skill_03_trail_02');
    for (let i = 0; i < 6; i++) frame(0.05);   // 0.3 s of a 0.8 s flight
    assert.equal(shell.stopped, false);
    const x0 = shell.anchor[0];
    // it went off at an enemy before its end point: the blast there, the shell stops where it is on the next tick
    const mid = handles.length;
    assert.equal(w.simFx('bombard', 6.5, 9, { id: 1, r: 1.7 }), true);
    assert.deepEqual(keysOf(handles.slice(mid)), ['jesca2_skill_03_hit_02']);
    frame(0.05);
    assert.equal(shell.stopped, true);
    assert.equal(shell.anchor[0], x0);
    // facing DOWN: the _down cast
    jes.dir = 'DOWN';
    const down = handles.length;
    w.simFx('bombardShell', 5, 13, { id: 1, r: 1.7, t: 0.8 });
    assert.ok(keysOf(handles.slice(down)).includes('jesca2_skill_03_start_02_down'));
  });

  test('without the prefabs both stay procedural (the field view draws its own shell and blast)', async () => {
    const { w, jes, frame } = await setup(KEYS.filter((k) => !/_02(_down)?$/.test(k)));
    jes.flags |= UF.SKILL; w.skill(jes, true); frame();
    assert.equal(w.simFx('bombardShell', 9, 9, { id: 1, r: 1.7, t: 0.8 }), false);
    assert.equal(w.simFx('bombard', 9, 9, { id: 1, r: 1.7 }), false);
  });
});
