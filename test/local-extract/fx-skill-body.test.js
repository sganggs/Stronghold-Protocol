// tools/local-extract/fx.py trigger uses and token skill modes (round 88 g1).
// A skill whose prefab names no effect does NOT gain the mode's attack or a mode-scoped ability: the client
// already plays those. An ability a skill-prefab template triggers is copied, with `from` starting `trigger `.
// No game client.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOOL = path.join(ROOT, 'tools/local-extract');
const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);
const ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };

function py(code) {
  const src = `import sys, json\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport fx\n${code}`;
  const r = spawnSync(PY, ['-c', src], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const MODES = [
  {
    name: 'Default',
    attack: {
      class: 'RangedAttack', node: 'Modes/Default/Attack', projectileKey: 'projectile_default',
      cast: [{ effects: ['common_attack_start'], oneshot: 1, startEvent: 2 }],
      attach: [{ effects: ['common_attack_attach'] }],
    },
  },
  {
    name: 'S2',
    attack: {
      class: 'RangedAttack', node: 'Modes/S2/Body/Attack', projectileKey: 'projectile_chr_phatom_s2',
      cast: [{
        effects: ['phatom_skill_02_start'], oneshot: 1, startEvent: 2,
        hookEffectAfterFirstAttack: 'phatom_skill_02_hook',
        directionType: 1, slots: ['phatom_skill_02_start', 'phatom_skill_02_start_l'],
      }],
      hit: [{ effects: ['phatom_skill_02_hit'], oneshot: 1, startEvent: 0 }],
      attach: [{ effects: ['phatom_skill_02_attach'] }],
      inputTarget: [{ effects: ['phatom_skill_02_aim'], oneshot: 1, startEvent: 2 }],
      abilities: [{
        class: 'MeleeAttack', node: 'Modes/S2/Body/Attack/Sub',
        hit: [{ effects: ['phatom_skill_02_sub_hit'], oneshot: 1, startEvent: 0 }],
      }],
    },
  },
  { name: 'S3', attack: { class: 'EmptyActiveAbility', node: 'Modes/S3/Attack', cast: [], hit: [] } },
];

describe('fx.py token modes and trigger uses (no UnityPy)', { skip: !PY && 'no python3' }, () => {
  test('named_skill_mode is an exact s<n> on skchr and sktok', () => {
    const out = py(`
print(json.dumps({
  'twin': fx.named_skill_mode('sktok_phatom_2', ['Default', 'S1', 'S2']),
  'twin3': fx.named_skill_mode('sktok_phatom_3', ['Default', 'S2', 'S3']),
  'billro': fx.named_skill_mode('skchr_billro_1', ['Default', 'S1', 'S1_Enhance']),
  'vvana': fx.named_skill_mode('skchr_vvana_3', ['Default', 'S3_1', 'S3_2']),
  'fly': fx.named_skill_mode('skchr_taraxa_1', ['Default', 'S1_FlyStart', 'S1_FlyLoop']),
  'sub': fx.named_skill_mode('skchr_kroos2_2', ['Default', 'S1', 'S2', 'S2_Sub']),
  'kalts': fx.named_skill_mode('skchr_kalts2_3', ['default', 's3', 's3_transporting', 's1', 's2']),
  'enemy': fx.named_skill_mode('1', ['Default', 'S1']),
  'skcom': fx.named_skill_mode('skcom_heal_self', ['Default', 'S1']),
  'doroth': fx.named_skill_mode('skchr_doroth_1', ['Default', 'T2']),
  'empty': fx.named_skill_mode('', ['S1']),
  'drone': fx.named_skill_mode('sktok_mgllan_drone1', ['Default', 'S1']),
}))`);
    assert.equal(out.twin, 2);
    assert.equal(out.twin3, 2);
    assert.equal(out.billro, 1);
    assert.equal(out.vvana, null);
    assert.equal(out.fly, null);
    assert.equal(out.sub, 2);
    assert.equal(out.kalts, 1);
    assert.equal(out.enemy, null);
    assert.equal(out.skcom, null);
    assert.equal(out.doroth, null);
    assert.equal(out.empty, null);
    assert.equal(out.drone, null);
  });

  test('skill_owned_by keeps a digit in the character code and skips the char number', () => {
    const out = py(`
print(json.dumps({
  'kalts2': fx.skill_owned_by('char_1052_kalts2', 'skchr_kalts2_3'),
  'kroos2': fx.skill_owned_by('char_1021_kroos2', 'skchr_kroos2_2'),
  'number': fx.skill_owned_by('char_1052_kalts2', 'skchr_1052_1'),
  'other': fx.skill_owned_by('char_1052_kalts2', 'skchr_billro_1'),
  'skcom': fx.skill_owned_by('char_1052_kalts2', 'skcom_heal_self'),
  'twin': fx.skill_owned_by('token_10007_phatom_twin', 'sktok_phatom_2'),
  'opTwin': fx.skill_owned_by('char_250_phatom', 'sktok_phatom_2'),
}))`);
    assert.equal(out.kalts2, true);
    assert.equal(out.kroos2, true);
    assert.equal(out.number, false);
    assert.equal(out.other, false);
    assert.equal(out.skcom, false);
    assert.equal(out.twin, true);
    assert.equal(out.opTwin, true);
  });

  test('apply_trigger_uses does not append a mode attack or a mode-scoped ability', () => {
    const out = py(`
import copy
modes = json.loads(${JSON.stringify(JSON.stringify(MODES))})
skill = {'mode': 1, 'effects': [], 'projectiles': [], 'uses': [{'role': 'loop', 'keys': ['already_loop'], 'from': 'prefab'}], 'unclassified': []}
before = copy.deepcopy(skill)
abilities = [
  {'name': 'Effect', 'modes': ['S2'], 'node': 'Modes/S2/Effect',
   'uses': [{'role': 'loop', 'keys': ['phatom_skill_02_buff'], 'from': 'PassiveBuffAbility._buffs'}],
   'projectiles': ['projectile_mode_ability']},
  {'name': 'Ability0', 'class': 'PassiveBuffAbility', 'modes': ['S2'], 'node': 'Modes/S2/Ability0',
   'uses': [{'role': 'loop', 'keys': ['cello_skill_03_buff_01'], 'from': 'PassiveBuffAbility._buffs'}]},
]
merged = fx.apply_trigger_uses(skill, modes, abilities, [])
print(json.dumps({'same': merged is skill, 'untouched': skill == before, 'keys': [k for u in merged.get('uses') or [] for k in u['keys']]}))`);
    assert.equal(out.same, true);
    assert.equal(out.untouched, true);
    for (const k of ['phatom_skill_02_start', 'phatom_skill_02_hit', 'phatom_skill_02_aim', 'phatom_skill_02_sub_hit', 'phatom_skill_02_buff', 'cello_skill_03_buff_01', 'common_attack_start', 'phatom_skill_02_attach']) {
      assert.equal(out.keys.includes(k), false, k);
    }
  });

  test('a template trigger is copied; another mode, a known key and a dropped slot are not', () => {
    const out = py(`
import copy
skill = {'mode': 2, 'effects': ['already'], 'projectiles': [], 'uses': [{'role': 'loop', 'keys': ['already'], 'from': 'prefab'}], 'unclassified': ['left']}
before = copy.deepcopy(skill)
modes = [{'name': 'Default'}, {'name': 'S1'}, {'name': 'S3', 'attack': {'class': 'EmptyActiveAbility', 'node': 'Modes/S3', 'cast': [{'effects': ['mode_attack_key']}]}}]
abilities = [
  {'name': 'Ability0', 'class': 'PassiveBuffAbility', 'modes': ['S3'], 'node': 'Modes/S3/Ability0',
   'uses': [{'role': 'loop', 'keys': ['cello_skill_03_buff_01', 'already'], 'from': 'PassiveBuffAbility._buffs',
             'slots': ['cello_skill_03_buff_01', 'gone']}]},
  {'name': 'Other', 'modes': ['S1'], 'uses': [{'role': 'loop', 'keys': ['not_this'], 'from': 'PassiveBuffAbility._buffs'}]},
  {'name': 'RespawnBorn', 'node': 'Others/RespawnBorn', 'modes': [],
   'triggers': [{'template': 'kalts2_s_3[restore]', 'event': 'ON_BUFF_START', 'action': 'TriggerAbility'}],
   'uses': [
     {'role': 'range', 'keys': ['kalts2_skill_03_range_01'], 'from': 'UberEffectEmitter._castEffects'},
     {'role': 'loop', 'keys': ['kalts2_skill_03_teleport_end_01'], 'from': 'BuffDuringCastingFixed._buffs',
      'slots': ['kalts2_skill_03_teleport_end_01', 'missing_slot'], 'directionType': 1},
   ],
   'projectiles': ['projectile_restore']},
  {'name': 'Aimed', 'modes': ['S1'],
   'triggers': [{'template': 'kalts2_s_3[restore]'}],
   'uses': [{'role': 'loop', 'keys': ['aimed_elsewhere'], 'from': 'X'}],
   'projectiles': ['projectile_aimed']},
  {'name': 'KnownOnly',
   'triggers': [{'template': 'kalts2_s_3[restore]'}],
   'uses': [{'role': 'loop', 'keys': ['already'], 'from': 'Y'}],
   'projectiles': ['projectile_should_not_copy']},
  {'name': 'Both', 'modes': ['S3'],
   'triggers': [{'template': 'kalts2_s_3[restore]'}],
   'uses': [{'role': 'loop', 'keys': ['both_key'], 'from': 'PassiveBuffAbility._buffs'}]},
]
merged = fx.apply_trigger_uses(skill, modes, abilities, ['kalts2_s_3[restore]'])
bare = fx.apply_trigger_uses(skill, modes, abilities, [])
flag = {'mode': True, 'effects': [], 'projectiles': [], 'uses': []}
missing = {'mode': 9, 'effects': [], 'projectiles': [], 'uses': []}
none_mode = {'mode': None, 'effects': [], 'projectiles': [], 'uses': []}
known_only = {'mode': 2, 'effects': ['kalts2_skill_03_range_01'], 'projectiles': [], 'uses': []}
known_ab = {'name': 'KnownOnly', 'triggers': [{'template': 'kalts2_s_3[restore]'}],
            'uses': [{'role': 'loop', 'keys': ['kalts2_skill_03_range_01'], 'from': 'Y'}],
            'projectiles': ['projectile_should_not_copy']}
held = fx.apply_trigger_uses(known_only, modes, [known_ab], ['kalts2_s_3[restore]'])
print(json.dumps({
  'untouched': skill == before,
  'merged': merged,
  'bareSame': bare is skill,
  'boolSame': fx.apply_trigger_uses(flag, modes, abilities, ['kalts2_s_3[restore]']) is flag,
  'missingSame': fx.apply_trigger_uses(missing, modes, abilities, ['kalts2_s_3[restore]']) is missing,
  'noneSame': fx.apply_trigger_uses(none_mode, modes, abilities, ['kalts2_s_3[restore]']) is none_mode,
  'knownSame': held is known_only,
}))`);
    assert.equal(out.untouched, true);
    assert.equal(out.bareSame, true);
    assert.equal(out.boolSame, true);
    assert.equal(out.missingSame, true);
    assert.equal(out.noneSame, true);
    assert.equal(out.knownSame, true);
    const keys = out.merged.uses.flatMap((u) => u.keys);
    assert.equal(keys.includes('cello_skill_03_buff_01'), false);
    assert.equal(keys.includes('not_this'), false);
    assert.equal(keys.includes('aimed_elsewhere'), false);
    assert.equal(keys.includes('mode_attack_key'), false);
    assert.equal(keys.includes('already'), true);
    assert.ok(keys.includes('kalts2_skill_03_range_01'));
    assert.ok(keys.includes('kalts2_skill_03_teleport_end_01'));
    assert.ok(keys.includes('both_key'));
    const born = out.merged.uses.find((u) => u.keys.includes('kalts2_skill_03_range_01'));
    assert.equal(born.from, 'trigger kalts2_s_3[restore] UberEffectEmitter._castEffects');
    assert.equal(born.node, 'Others/RespawnBorn');
    const end = out.merged.uses.find((u) => u.keys.includes('kalts2_skill_03_teleport_end_01'));
    assert.equal(end.from, 'trigger kalts2_s_3[restore] BuffDuringCastingFixed._buffs');
    assert.equal(end.slots, undefined);
    assert.equal(end.directionType, undefined);
    const both = out.merged.uses.find((u) => u.keys.includes('both_key'));
    assert.equal(both.from, 'trigger kalts2_s_3[restore] PassiveBuffAbility._buffs');
    assert.deepEqual(out.merged.projectiles, ['projectile_restore']);
    assert.deepEqual(out.merged.effects, ['already', 'both_key', 'kalts2_skill_03_range_01', 'kalts2_skill_03_teleport_end_01']);
    assert.deepEqual(out.merged.unclassified, ['left']);
    assert.equal(out.merged.roles.loop[0], 'already');
    assert.ok(out.merged.roles.range.includes('kalts2_skill_03_range_01'));
    assert.equal(out.merged.uses[0].from, 'prefab');
  });

  test('collect_template_keys keeps a restore buff that is not a BuffData', () => {
    const out = py(`
found = set()
fx.collect_template_keys({
  '_buffs': [{'buffKey': 'kalts2_s_3', 'overrideEffectKey': '', 'templateKey': 'kalts2_s_3'}],
  '_restoreSkillBuff': {'buffKey': 'kalts2_s_3[restore]', 'templateKey': 'kalts2_s_3[restore]'},
}, found)
print(json.dumps(sorted(found)))`);
    assert.deepEqual(out, ['kalts2_s_3', 'kalts2_s_3[restore]']);
    const only = py(`print(json.dumps([b.get('templateKey') for b in fx.buffs_in({
  '_restoreSkillBuff': {'buffKey': 'kalts2_s_3[restore]', 'templateKey': 'kalts2_s_3[restore]'},
})]))`);
    assert.deepEqual(only, []);
  });
});
