// tools/local-extract/fx.py (DESIGN §33, docs/design/vfx-format.md): the encodings of the official battle effects'
// descriptors — curves, gradients, render states, decoded animation clips, mount-point matrices, the file names of
// effect keys —, the units' emitters, charge groups and skills of index.json, its v3 talents, common / general
// abilities, abilities' projectiles, buff lives and group choice (§33.17), and extract.py's opt-in fx run. The
// Python helpers run without UnityPy (pure functions; plain python3). When the effects were extracted on this machine
// (data/local-fx.json, the list of the fx files, exists), the output is checked for consistency: every listed file
// exists, the index and the list agree, every key the index names has a descriptor, and data/local-assets.json holds
// no fx group. SP_FX_ROOT=<dir> checks an extraction staged elsewhere instead (`extract.py --only fx --out
// <dir>/public/assets/local --manifest <dir>/data/local-assets.json`: <dir>/data/local-fx.json and <dir>/public/…).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FX_ROOT = process.env.SP_FX_ROOT ? path.resolve(process.env.SP_FX_ROOT) : ROOT;
const TOOL = path.join(ROOT, 'tools/local-extract');
const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);
const ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
const readJson = (rel, root = ROOT) => { try { return JSON.parse(readFileSync(path.join(root, rel), 'utf8')); } catch { return null; } };
const manifest = readJson('data/local-assets.json', FX_ROOT);
const fxList = readJson('data/local-fx.json', FX_ROOT);

/** Run python code with `fx` imported; returns the parsed JSON it prints. */
function py(code) {
  const src = `import sys, json, math, struct, zlib\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport fx\n${code}`;
  const r = spawnSync(PY, ['-c', src], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

describe('fx.py encodings (no UnityPy needed)', { skip: !PY && 'no python3' }, () => {
  test('fx_file: URL-safe keys are their own file stem; others get the safe form + the key\'s CRC32', () => {
    const out = py(`print(json.dumps([fx.fx_file(k) for k in ['common_hit_01', 'buff_ fragile_01', 'buff_weak[limit]', 'x#1', 'x_1']]))`);
    assert.equal(out[0], 'common_hit_01');
    assert.match(out[1], /^buff__fragile_01-[0-9a-f]{8}$/);
    assert.match(out[2], /^buff_weak_limit-[0-9a-f]{8}$/);
    assert.notEqual(out[3], out[4], 'x#1 and x_1 do not collide');
    assert.equal(out[4], 'x_1');
  });

  test('f6: six significant digits, -0 → 0, integers stay, NaN / ±inf → null', () => {
    const out = py(`print(json.dumps([fx.f6(x) for x in [1.0000004, -0.0, 3, 0.258819049, 1e-13, float('nan'), float('inf'), True, 2.0, 1234567.8]]))`);
    assert.deepEqual(out, [1, 0, 3, 0.258819, 0, null, null, true, 2, 1234570]);
  });

  test('curve keys, MinMaxCurve modes, gradients, MinMaxGradient modes', () => {
    const out = py(`
k = lambda t, v, i, o, w=0: {'time': t, 'value': v, 'inSlope': i, 'outSlope': o, 'weightedMode': w, 'inWeight': 0.25, 'outWeight': 0.5}
curve = {'m_Curve': [k(0, 1, 0, -1), k(0.5, 0.2, float('inf'), 0, 3), k(1, 0, -1, -1)]}
mmc = lambda st, s=2.0, mn=0.5: {'minMaxState': st, 'scalar': s, 'minScalar': mn, 'maxCurve': curve, 'minCurve': {'m_Curve': [k(0, 0, 0, 0)]}}
col = lambda r, g, b, a: {'r': r, 'g': g, 'b': b, 'a': a}
g = {'m_Mode': 1, 'm_NumColorKeys': 2, 'm_NumAlphaKeys': 3, 'key0': col(1, 0, 0, 1), 'key1': col(0, 0, 1, 0.5), 'key2': col(0, 0, 0, 0),
     'ctime0': 0, 'ctime1': 65535, 'atime0': 0, 'atime1': 32768, 'atime2': 65535}
mmg = lambda st: {'minMaxState': st, 'minColor': col(0, 0, 0, 1), 'maxColor': col(1, 1, 1, 1), 'minGradient': g, 'maxGradient': g}
print(json.dumps({'keys': fx.enc_keys(curve), 'mmc': [fx.enc_mmc(mmc(s)) for s in (0, 3, 1, 2)],
                  'grad': fx.enc_gradient(g), 'mmg': [fx.enc_mmg(mmg(s)) for s in (0, 2, 1, 3, 4)]}))`);
    assert.deepEqual(out.keys, [[0, 1, 0, -1], [0.5, 0.2, null, 0, 3, 0.25, 0.5], [1, 0, -1, -1]], 'infinite slope = stepped (null); weighted keys carry their weights');
    assert.deepEqual(out.mmc[0], 2);
    assert.deepEqual(out.mmc[1], { min: 0.5, max: 2 });
    assert.deepEqual(Object.keys(out.mmc[2]), ['scalar', 'curve']);
    assert.deepEqual(Object.keys(out.mmc[3]), ['scalar', 'minCurve', 'maxCurve']);
    assert.deepEqual(out.grad, { mode: 'fixed', color: [[0, 1, 0, 0], [1, 0, 0, 1]], alpha: [[0, 1], [0.500008, 0.5], [1, 0]] });
    assert.deepEqual(out.mmg[0], [1, 1, 1, 1]);
    assert.deepEqual(out.mmg[1], { min: [0, 0, 0, 1], max: [1, 1, 1, 1] });
    assert.deepEqual(Object.keys(out.mmg[2]), ['gradient']);
    assert.deepEqual(Object.keys(out.mmg[3]), ['minGradient', 'maxGradient']);
    assert.deepEqual(Object.keys(out.mmg[4]), ['random']);
  });

  test('render_state: constants as written; a property-driven state takes the material value, else the shader default', () => {
    const out = py(`
v = lambda val, name='<noninit>': {'val': val, 'name': name}
rt = {'srcBlend': v(0, '_PremultiplyAlpha'), 'destBlend': v(10), 'srcBlendAlpha': v(0), 'destBlendAlpha': v(10), 'blendOp': v(0), 'colMask': v(15)}
state = {'rtBlend0': rt, 'zTest': v(0, '_ZTest'), 'zWrite': v(0), 'culling': v(0, '_CullMode')}
print(json.dumps([fx.render_state(state, {'_ZTest': 0}, {'_PremultiplyAlpha': 5, '_ZTest': 4, '_CullMode': 2}),
                  fx.render_state(state, {'_PremultiplyAlpha': 1, '_ZTest': 4}, {'_PremultiplyAlpha': 5})]))`);
    assert.deepEqual(out[0], { blend: ['SrcAlpha', 'OneMinusSrcAlpha', 'Zero', 'OneMinusSrcAlpha'], blendOp: 'Add', zTest: 'Disabled', zWrite: false, cull: 'Back', colorMask: 15 });
    assert.deepEqual(out[1].blend.slice(0, 2), ['One', 'OneMinusSrcAlpha'], 'a premultiplied material');
    assert.equal(out[1].zTest, 'LessEqual');
  });

  test('streamed clips: Hermite keys from cubic segments (buff_stun\'s 0 → −720° spin), stepped jumps, sentinels dropped', () => {
    const out = py(`
FLT_MAX = 3.4028234663852886e+38
def stream(frames):
    words = b''
    for t, keys in frames:
        words += struct.pack('<fI', t, len(keys))
        for k in keys:
            words += struct.pack('<i4f', *k)
    return list(struct.unpack('<%dI' % (len(words) // 4), words))
frames = [(-FLT_MAX, [(0, 0, 0, 0, 0), (1, 0, 0, 0, 1)]),
          (0.0, [(0, 1.4257, -21.4567, 0, 0), (1, 0, 0, 0, 1)]),
          (10.033333778381348, [(0, 0, 0, 0, -720), (1, 0, 0, 0, 5)]),
          (float('inf'), [])]
c = fx.streamed_curves(fx.decode_streamed(stream(frames)))
d = fx.dense_curves({'m_FrameCount': 3, 'm_CurveCount': 2, 'm_SampleRate': 10, 'm_BeginTime': 0.5, 'm_SampleArray': [0, 1, 1, 1, 3, 0]}, 4)
print(json.dumps({'c': {str(k): v for k, v in c.items()}, 'd': {str(k): v for k, v in d.items()}}))`);
    const spin = out.c['0'];
    assert.equal(spin.length, 2);
    assert.deepEqual(spin[0], [0, 0, 0, 0]);
    assert.equal(spin[1][0], 10.0333);
    assert.equal(spin[1][1], -720);
    assert.ok(Math.abs(spin[1][2]) < 0.05, `the in-slope at the end is the cubic's derivative (≈ 0): ${spin[1][2]}`);
    assert.deepEqual(out.c['1'], [[0, 1, 0, null], [10.0333, 5, null, 0]], 'a flat segment ending in a jump is stepped');
    assert.deepEqual(out.d['4'], [[0.5, 0, 0, 10], [0.6, 1, 10, 20], [0.7, 3, 20, 0]], 'dense samples become linear keys');
    assert.deepEqual(out.d['5'].map((k) => k[1]), [1, 1, 0]);
  });

  test('clip bindings: transform dimensions, material property attributes (CRC32 & 0x0FFFFFFF | component << 28), field paths', () => {
    const out = py(`
tc = zlib.crc32(b'_TintColor') & 0x0FFFFFFF
print(json.dumps({
  'dims': [fx.binding_dims({'typeID': 4, 'attribute': a}) for a in (1, 2, 3, 4)] + [fx.binding_dims({'typeID': 23, 'attribute': 1})],
  'attr': [list(fx.material_attribute(tc | (c << 28))) for c in (0, 3, 4, 7, 8)], 'tc': tc,
  'paths': sorted(fx.typetree_paths({'m_Parameters': {'widthMultiplier': 1, 'colorGradient': {'key0': {'r': 1}}}, 'm_Time': 0.2})),
}))`);
    assert.deepEqual(out.dims, [3, 4, 3, 3, 1]);
    assert.deepEqual(out.attr, [[out.tc, 'x'], [out.tc, 'w'], [out.tc, 'r'], [out.tc, 'a'], [out.tc, '']]);
    assert.deepEqual(out.paths, ['m_Parameters', 'm_Parameters.colorGradient', 'm_Parameters.colorGradient.key0',
      'm_Parameters.colorGradient.key0.r', 'm_Parameters.widthMultiplier', 'm_Time']);
  });

  test('mount points: a skin point composed through Graphic (−30° about X) and the FaceSwitcher (隐现\'s HitPoint)', () => {
    const out = py(`
m = fx.trs_matrix([0, 0, 0], [-0.258819, 0, 0, 0.965926], [1, 1, 1])
for t in ([[0, 0, 0], [0, 0, 0, 1], [1, 1, 1]], [[0, -0.16, -0.1], [0, 0, 0, 1], [0.27, 0.27, 0.27]], [[0, 0, 0], [0, 0, 0, 1], [1, 1, 1]], [[0, 1.8, 0], [0, 0, 0, 1], [1, 1, 1]]):
    m = fx.mat_mul(m, fx.trs_matrix(*t))
print(json.dumps(fx.mat_point(m)))`);
    assert.equal(out[0], 0);
    assert.ok(Math.abs(out[1] - 0.232324) < 1e-5 && Math.abs(out[2] + 0.249603) < 1e-5, JSON.stringify(out));
  });

  test('emitter lists and the live-particle estimate', () => {
    const out = py(`
f = {'_castEffects': [{'_directionType': 0, '_effects': ['x_attack_01_start', '', '', ''], '_startEvent': 2, '_endEvent': 3},
                      {'_directionType': 1, '_effects': ['', 'x_right', '', 'x_left', '', ''], '_startEvent': 2, '_endEvent': 3}],
     '_hitEffects': [{'_effects': ['', '', '', '']}], '_attachEffects': []}
ps = {'lengthInSec': 1, 'looping': False, 'InitialModule': {'startLifetime': {'min': 0.2, 'max': 0.6}, 'maxNumParticles': 1000},
      'EmissionModule': {'rateOverTime': 10, 'm_Bursts': [{'countCurve': {'min': 2, 'max': 5}, 'cycleCount': 1}]}}
print(json.dumps({'lists': fx.emitter_lists(f), 'live': fx.est_live(ps)}))`);
    assert.deepEqual(out.lists, { cast: [{ directionType: 0, effects: ['x_attack_01_start'], startEvent: 2, endEvent: 3 },
      { directionType: 1, effects: ['x_right', 'x_left'], slots: [null, 'x_right', null, 'x_left'], startEvent: 2, endEvent: 3 }] },
    'a directional row keeps the effect per facing (0 UP, 1 RIGHT, 2 DOWN, 3 LEFT)');
    assert.equal(out.live, 11, '10/s × 0.6 s + a burst of 5');
  });

  test('skin_rows: four (index, weight) pairs per vertex whatever the client stores (§33.9) — 2 per vertex, 1 without weights, the legacy 4', () => {
    const out = py(`print(json.dumps([fx.skin_rows([(10, 9), (3, 0)], [(0.503710, 0.496290), (1.0, 0.0)], 2),
                  fx.skin_rows([(4,), (7,)], None, 2), fx.skin_rows([(1, 2, 3, 4)], [(0.25, 0.25, 0.25, 0.25)], 1),
                  fx.skin_rows(None, None, 3), fx.skin_rows([(5,)], None, 2)]))`);
    assert.deepEqual(out[0], [[10, 9, 0, 0, 3, 0, 0, 0], [0.50371, 0.49629, 0, 0, 1, 0, 0, 0]], '铃兰 S3\'s Plane011: BlendWeight / BlendIndices of dimension 2');
    assert.deepEqual(out[1], [[4, 0, 0, 0, 7, 0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0]], 'one bone per vertex: no BlendWeight channel, weight 1 (8 of the 9 tails, 伊芙利特 S3)');
    assert.deepEqual(out[2], [[1, 2, 3, 4], [0.25, 0.25, 0.25, 0.25]], 'm_Skin / a compressed mesh: four already');
    assert.deepEqual(out[3], [null, null], 'no skin');
    assert.deepEqual(out[4], [[5, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0, 0]], 'a vertex past the rows binds nothing');
  });
});

describe('fx.py units: emitters of every class, charge groups, sub-abilities, skills\' root class (index.json v2)', { skip: !PY && 'no python3' }, () => {
  const ROW = `row = lambda keys, **kw: {'_directionType': 0, '_effects': keys, '_oneshot': 1, '_startEvent': 2, '_endEvent': 3, **kw}`;

  test('emitter_export: a plain UberEffectEmitter has no settings; subclasses keep theirs, their group rows join the lists with `group` / `anim`', () => {
    const out = py(`${ROW}
plain = {'_castEffects': [row(['a_start', '', '', ''])], '_hitEffects': [row(['a_hit'])], '_attachEffects': [], '_preDelayFactor': 0.0,
         '_recalculatePlaybackSpeed': 0, '_convertCastEndToAttachFinish': 0}
multi_hit = {'_castEffects': [row(['m_start'])], '_hitEffects': [], '_useRandomHitEffect': 0, '_useLoopHitEffect': 1, '_keepBaseHitEffect': 0,
             '_hitGroups': [{'effects': [row(['m_hit_01'])]}, {'effects': []}, {'effects': [row(['m_hit_03']), row(['m_hit_03_range'])]}],
             '_castGroups': [], '_useTimesBasedHitEffect': 0, '_timesBasedHitEffects': [], '_oncePerTarget': 0}
anim = {'_hitEffects': [row(['s_hit'])], '_castEffects': [], '_sourceAnimKey': 'Attack_1', '_loopType': 1,
        '_replaceGroup': [{'anim': 'Attack_1', 'effectOptions': [row(['s_start_01'])], 'hitEffectOptions': []},
                          {'anim': 'Attack_2', 'effectOptions': [row(['s_start_02'])], 'hitEffectOptions': [row(['s_hit_02'])]}]}
wolf = {'_castEffects': [], '_vigilWolfCastEffects': [row(['w_sub_1'], _buffKey='b1')], '_selector': {'m_FileID': 0, 'm_PathID': 7}}
mode = {'_hitEffects': [row(['f_hit'])], '_activeMode': 0}
aphris = {'_lineEffectKey': 'aphris_line', '_emitOnEvent': 4, '_waypointFixedHeight': 0.6499999761581421, '_owner': {'m_FileID': 0, 'm_PathID': 3}}
charge = {'_castEffects': [], '_chargeEffectGroups': [{'effects': [row(['c_02'], _startEvent=4)]}, {'effects': [row(['c_03'], _startEvent=4)]}],
          '_chargeCastGroups': [], '_isExEffectEmitter': 1, '_chargeEffectStartEvent': 4}
print(json.dumps({k: fx.emitter_export(c, f) for k, (c, f) in {'plain': ('UberEffectEmitter', plain), 'hit': ('MultiHitUberEffectEmitter', multi_hit),
                  'anim': ('UberAnimationEffectEmitter', anim), 'wolf': ('VigilWolfEffectEmitter', wolf), 'mode': ('UberEffectEmitterInCertainMode', mode),
                  'aphris': ('AphrisEffectEmitter', aphris), 'charge': ('MultiExChargeUberEffectEmitter', charge)}.items()}))`);
    assert.deepEqual(Object.keys(out.plain[0]), ['cast', 'hit']);
    assert.equal(out.plain[1], null, 'a plain UberEffectEmitter: no settings (its rows go straight to the attack)');
    const [hitRows, hitSet] = out.hit;
    assert.deepEqual(hitRows.cast.map((r) => r.effects[0]), ['m_start']);
    assert.deepEqual(hitRows.hit.map((r) => [r.effects[0], r.group]), [['m_hit_01', 0], ['m_hit_03', 2], ['m_hit_03_range', 2]], 'the group index survives an empty group');
    assert.deepEqual(hitSet, { class: 'MultiHitUberEffectEmitter', useRandomHitEffect: 0, useLoopHitEffect: 1, keepBaseHitEffect: 0,
      useTimesBasedHitEffect: 0, oncePerTarget: 0, groups: { hitGroups: 3 } });
    const [animRows, animSet] = out.anim;
    assert.deepEqual(animRows.cast.map((r) => [r.effects[0], r.group, r.anim]), [['s_start_01', 0, 'Attack_1'], ['s_start_02', 1, 'Attack_2']]);
    assert.deepEqual(animRows.hit.map((r) => [r.effects[0], r.group ?? null, r.anim ?? null]), [['s_hit', null, null], ['s_hit_02', 1, 'Attack_2']],
      'hitEffectOptions are hit rows; the base hit row has no group');
    assert.deepEqual(animSet, { class: 'UberAnimationEffectEmitter', sourceAnimKey: 'Attack_1', loopType: 1, loopTypeName: 'RANDOM',
      replaceAnims: ['Attack_1', 'Attack_2'], groups: { replaceGroup: 2 } }, 'v3: LoopType 1 is RANDOM (metadata), 0 LOOP');
    assert.deepEqual(out.wolf[0].cast, [{ directionType: 0, effects: ['w_sub_1'], oneshot: 1, startEvent: 2, endEvent: 3, buffKey: 'b1', field: '_vigilWolfCastEffects' }]);
    assert.deepEqual(out.wolf[1], { class: 'VigilWolfEffectEmitter' }, 'PPtrs are dropped');
    assert.deepEqual(out.mode[1], { class: 'UberEffectEmitterInCertainMode', activeMode: 0 });
    assert.deepEqual(out.aphris, [{}, { class: 'AphrisEffectEmitter', lineEffectKey: 'aphris_line', emitOnEvent: 4, waypointFixedHeight: 0.65 }]);
    assert.deepEqual(out.charge[0], {}, 'charge groups are no attack rows');
    assert.deepEqual(out.charge[1].chargeEffectGroups.map((g) => g.map((r) => [r.effects[0], r.startEvent])), [[['c_02', 4]], [['c_03', 4]]]);
    assert.equal(out.charge[1].chargeCastGroups, undefined, 'an empty group list is left out');
    assert.equal(out.charge[1].isExEffectEmitter, 1);
  });

  test('behaviour_uses: a group list\'s uses carry `group` / `groups`, the MultiHit choice flags, a replace group\'s `anim` (its hit options are hits)', () => {
    const out = py(`${ROW}
KEYS = {'h1', 'h2', 'h2_range', 'c1', 'a_start', 'a_hit'}
ek = lambda s: s.lower() if isinstance(s, str) and s.lower() in KEYS else None
mh = {'_castEffects': [row(['c1'])], '_useRandomHitEffect': 0, '_useLoopHitEffect': 1,
      '_hitGroups': [{'effects': [row(['h1'])]}, {'effects': [row(['h2']), row(['h2_range'])]}]}
ua = {'_replaceGroup': [{'anim': 'Skill_A', 'effectOptions': [row(['a_start'])], 'hitEffectOptions': [row(['a_hit'])]}]}
print(json.dumps({'mh': fx.behaviour_uses('MultiHitUberEffectEmitter', mh, ek, {}, node='n', ability='MultiMeleeAttack'),
                  'ua': fx.behaviour_uses('UberAnimationEffectEmitter', ua, ek, {}, node='n', ability='MeleeAttack')}))`);
    const groups = out.mh.filter((u) => u.list === 'hit').map((u) => [u.keys[0], u.group, u.groups, u.useLoopHitEffect ?? false, u.useRandomHitEffect ?? false]);
    assert.deepEqual(groups, [['h1', 0, 2, true, false], ['h2', 1, 2, true, false], ['h2_range', 1, 2, true, false]]);
    assert.equal(out.mh.find((u) => u.list === 'cast').group, undefined, 'a plain row has no group');
    assert.deepEqual(out.ua.map((u) => [u.role, u.keys[0], u.list, u.anim, u.group]), [['start', 'a_start', 'cast', 'Skill_A', 0], ['hit', 'a_hit', 'hit', 'Skill_A', 0]]);
  });

  test('skill_root / main_ability / is_ability: the Skill-derived class, an enemy\'s EnemySkill, the ability (counters and helpers are not)', () => {
    const out = py(`
sk = lambda: {'_canSilenced': 1, '_attachSignalIds': []}
print(json.dumps([
  fx.skill_root([('CastSkill', sk()), ('BuffDuringSkill', {'_buffs': []}), ('ActiveBuffAbility', {})]),
  fx.skill_root([('BuffDuringSkill', {'_buffs': []}), ('ReplacementSkillFixed', sk()), ('RangedAttack', {}), ('UberEffectEmitter', {})]),
  fx.skill_root([('MeleeAttack', {}), ('UberEffectEmitter', {}), ('EnemySkill', {'_familyMask': 3}), ('ReadyEnemySkillEffect', {})]),
  fx.skill_root([('AuraAbility', {}), ('TargetValidator', {})]),
  fx.main_ability(['AbilityEventCounter', 'MeleeAttack', 'UberEffectEmitter']), fx.main_ability(['ThreePartChannelingAnimation', 'UberEffectEmitter']),
  [fx.is_ability(c) for c in ('RangedAttackWithExtraActions', 'MultiFunnelNormalAttack', 'Heal', 'AbilityRandomGroup', 'MultiChargeAbilityEventCounter',
                              'SelectorTriggerWithCertainCondition', 'UberEffectEmitter', 'ChargeTimeListener', 'SimpleUnitAnimatorHooker')],
  [fx.is_emitter('FunnelEffectEmitter', {}), fx.is_emitter('Foo', {'_hitEffects': []}), fx.is_emitter('MeleeAttack', {})]]))`);
    assert.deepEqual(out[0], ['CastSkill', 'ActiveBuffAbility']);
    assert.deepEqual(out[1], ['ReplacementSkillFixed', 'RangedAttack']);
    assert.deepEqual(out[2], ['EnemySkill', 'MeleeAttack']);
    assert.deepEqual(out[3], [null, 'AuraAbility']);
    assert.equal(out[4], 'MeleeAttack', 'an event counter is no ability');
    assert.equal(out[5], null);
    assert.deepEqual(out[6], [true, true, true, true, false, false, false, false, false]);
    assert.deepEqual(out[7], [true, true, false]);
  });

  test('token_skill_ids, mount_names, prefab_anchor', () => {
    const out = py(`
rec = {'skill': {'skillId': 'sktok_a', 'prefabId': 'sktok_a'}, 'variants': {'v1': {'skill': {'skillId': 'sktok_a'}}, 'v2': {'skill': {'skillId': 'x', 'prefabId': 'sktok_b'}}},
       'talents': [{'skill': {'skillId': 'sktok_c'}}], 'skills': [{'skillId': 'not_under_a_skill_key'}], 'other': {'skill': None}}
nodes = [{'behaviours': [{'class': 'ParticleEffect', 'enabled': False, 'fields': {'_spawnLocation': 9}}]},
         {'behaviours': [{'class': 'FollowMountPoint', 'enabled': True, 'fields': {'_mountPointType': 6}},
                         {'class': 'ParticleEffect', 'enabled': True, 'fields': {'_spawnLocation': 8}}]}]
print(json.dumps([fx.token_skill_ids(rec), fx.mount_names([6, 8, 9, 5, 10, 29, 30, True]), fx.prefab_anchor(nodes), fx.prefab_anchor([{'name': 'x'}]),
                  fx.INDEX_VERSION, fx.FORMAT_VERSION, fx.MESH_VERSION,
                  [fx.norm_channel([255, 128, 0, 51], 2), fx.norm_channel([127, -128], 3), fx.norm_channel([65535], 4), fx.norm_channel([0.5, 1.0], 0), fx.norm_channel([1, 0], None)]]))`);
    assert.deepEqual(out[0], ['sktok_a', 'sktok_b', 'sktok_c'], 'every object under a `skill` key, prefabId first, once');
    assert.deepEqual(out[1], ['SPECIAL_1', 'SPECIAL_2', 'SPECIAL_3', 'SPECIAL_0', 'SPECIAL_4', 'SPECIAL_23', null, null]);
    assert.deepEqual(out[2], [8, 6], 'the first enabled ParticleEffect / FollowMountPoint');
    assert.deepEqual(out[3], [null, null]);
    assert.deepEqual(out.slice(4, 7), [3, 1, 2], 'index.json is version 3 (Phase 1d), the meshes 2; the descriptors stay 1');
    const [unorm8, snorm8, unorm16, float, unknown] = out[7];
    assert.deepEqual(unorm8.map((x) => Math.round(x * 1e4) / 1e4), [1, 0.502, 0, 0.2], 'a UNorm8 colour channel (raw bytes) → 0…1');
    assert.deepEqual(snorm8, [1, -1], 'SNorm8 → −1…1, clamped');
    assert.deepEqual(unorm16, [1]);
    assert.deepEqual(float, [0.5, 1], 'a float channel stays');
    assert.deepEqual(unknown, [1, 0], 'an unknown format (a compressed mesh\'s colours, already 0…1) stays');
  });
});

describe('fx.py skill effect roles (index.json skills, DESIGN §33.12)', { skip: !PY && 'no python3' }, () => {
  const EK = `KEYS = {'ifrit_skill_02_start', 'ifrit_skill_02_range', 'common_firemagic_hit_01', 'buff_burn', 'x_skill_buff',
  'x_skill_end', 'x_hit', 'x_start_up', 'x_start', 'x_start_down', 'x_hook', 'x_ready', 'x_tpl_start', 'x_tpl_finish', 'x_tpl_derived'}
ek = lambda s: s.lower() if isinstance(s, str) and s.lower() in KEYS else None`;

  test('emit_role / name_role: list kind, one-shot, events and names place an effect in the skill\'s time', () => {
    const out = py(`${EK}
print(json.dumps([fx.emit_role('hit', {}, 'x_hit'), fx.emit_role('attach', {}, 'x'), fx.emit_role('cast', {'_oneshot': 1, '_startEvent': 2}, 'x_skill_02_range'),
  fx.emit_role('cast', {'_oneshot': 0, '_startEvent': 2, '_endEvent': 3}, 'x_skill_buff'), fx.emit_role('cast', {'_oneshot': 1, '_startEvent': 2}, 'x_start'),
  fx.emit_role('cast', {'_oneshot': 1, '_startEvent': 3}, 'x'), fx.emit_role('cast', {'_oneshot': 1, '_startEvent': 2}, 'x_buff_end'),
  fx.name_role('nian_skill_01_hit'), fx.name_role('humus_buff_01'), fx.name_role('x', 'ON_CAST_START'), fx.name_role('x'),
  fx.event_name(fx.ABILITY_EVENTS, 4), fx.event_name(fx.BUFF_EVENTS, 11), fx.event_name(fx.ABILITY_EVENTS, 99), len(fx.BUFF_EVENTS)]))`);
    assert.deepEqual(out, ['hit', 'loop', 'range', 'loop', 'start', 'end', 'end', 'hit', 'loop', 'start', 'other',
      'ON_SPELL_ON', 'ON_OUTPUT_DAMAGE', null, 109]);
  });

  test('behaviour_uses: emitter rows (directional slots, hooks), buffs with their carrier and template, mode switches', () => {
    const out = py(`${EK}
tpl = {'burn': {'effect': None, 'graph': []}, 'empty': {'effect': 'x_skill_buff', 'graph': []},
       'x_t': {'effect': None, 'graph': [['ON_BUFF_START', 'CreateEffect', '_effectKey', 'x_tpl_start'],
                                         ['ON_BUFF_FINISH', 'CreateEffect', '_effectKey', 'x_tpl_finish'],
                                         ['ON_BUFF_TRIGGER', 'CreateBuff', 'overrideEffectKey', 'x_tpl_derived']]}}
emitter = {'_hitEffects': [{'_directionType': 0, '_effects': ['common_firemagic_hit_01', '', '', ''], '_oneshot': 1, '_endEvent': 3}],
           '_castEffects': [{'_directionType': 0, '_effects': ['ifrit_skill_02_start', 'x_hit', '', ''], '_oneshot': 1, '_startEvent': 2, '_endEvent': 3},
                            {'_directionType': 0, '_effects': ['IFRIT_skill_02_range'], '_oneshot': 0, '_startEvent': 2, '_endEvent': 3},
                            {'_directionType': 3, '_effects': ['x_start_up', 'x_start', 'x_start_down', 'x_start', '', ''], '_oneshot': 1, '_startEvent': 4, '_endEvent': 3},
                            {'_directionType': 0, '_effects': [''], '_oneshot': 0, '_startEvent': 2, '_endEvent': 3, '_hookEffectAfterFirstAttack': 'x_hook'}]}
attack = {'_activeBuffs': [{'buffKey': 'ifrit_s_2', 'templateKey': 'burn', 'overrideEffectKey': 'buff_burn', 'blackboard': []}]}
own = {'_selector': {'m_FileID': 0, 'm_PathID': 0}, '_buffs': [{'buffKey': 'x_s', 'templateKey': 'empty', 'overrideEffectKey': '', 'blackboard': []},
       {'buffKey': 'x_s[t]', 'templateKey': 'x_t', 'overrideEffectKey': '', 'blackboard': [{'key': 'effect', 'value': 0, 'valueStr': 'x_hit'}]}]}
switch = {'_buffs': [{'buffKey': 'x_s[switch]', 'templateKey': 'switch_mode', 'overrideEffectKey': '', 'blackboard': [{'key': 'mode', 'value': 2.0, 'valueStr': ''}]}]}
u1 = fx.behaviour_uses('UberEffectEmitter', emitter, ek, tpl, node='skchr_x', ability='MeleeAttack')
u2 = fx.behaviour_uses('MeleeAttack', attack, ek, tpl)
u3 = fx.behaviour_uses('ActiveBuffAbility', own, ek, tpl)
u4 = fx.behaviour_uses('ReadySkillEffect', {'_effects': ['x_ready'], '_stopBeforeCast': 1}, ek, tpl)
print(json.dumps({'u1': u1, 'u2': u2, 'u3': u3, 'u4': u4, 'roles': fx.roles_of(u1 + u2 + u3 + u4),
                  'modes': [fx.skill_mode(switch), fx.skill_mode({'_switchToMode': 1}), fx.skill_mode(own)],
                  'on': [fx.buff_target('ActiveBuffAbility', '_buffs', {'_selector': {'m_PathID': 5}}), fx.buff_target('AuraAbility', '_buffs', {}),
                         fx.buff_target('BuffDuringSkill', '_buffs', {}), fx.buff_target('SpawnTokenOnTileByIDAbility', '_buffsToToken', {}),
                         fx.buff_target('SomethingNew', '_buffs', {})],
                  'graph': fx.graph_effects(json.dumps([{'$type': 'Torappu.Battle.Action.Nodes+CreateEffect', '_effectKey': 'X_tpl_start'},
                                                        {'$type': 'Torappu.Battle.Action.Nodes+CreateBuff', '_buff': {'buffKey': 'b', 'overrideEffectKey': 'x_tpl_derived'}}]), ek)}))`);
    const hit = out.u1.find((u) => u.list === 'hit');
    assert.deepEqual(hit, { role: 'hit', keys: ['common_firemagic_hit_01'], from: 'UberEffectEmitter._hitEffects', node: 'skchr_x', ability: 'MeleeAttack', endEvent: 'ON_CAST_END', oneshot: true, list: 'hit' });
    const casts = out.u1.filter((u) => u.list === 'cast');
    assert.deepEqual(casts.map((u) => [u.role, u.keys, u.startEvent ?? null]), [
      ['start', ['ifrit_skill_02_start'], 'ON_CAST_START'],           // directionType 0: the first slot only (x_hit is a leftover)
      ['range', ['ifrit_skill_02_range'], 'ON_CAST_START'],           // keys lower case
      ['start', ['x_start_up', 'x_start', 'x_start_down'], 'ON_SPELL_ON'],
      ['loop', ['x_hook'], 'ON_CAST_START'],                          // a row without an effect of its own: its hook
    ]);
    assert.deepEqual(casts[2].slots, ['x_start_up', 'x_start', 'x_start_down', 'x_start']);
    assert.equal(casts[2].directionType, 3);
    assert.equal(casts[3].from, 'UberEffectEmitter._castEffects._hookEffectAfterFirstAttack');
    assert.deepEqual(out.u2, [{ role: 'loop', keys: ['buff_burn'], from: 'MeleeAttack._activeBuffs', on: 'targets', buff: 'ifrit_s_2', template: 'burn' }]);
    assert.deepEqual(out.u3.map((u) => [u.role, u.keys[0], u.on, u.event ?? u.bb ?? null]), [
      ['loop', 'x_skill_buff', 'owner', null],                       // no override: the template's effectKey
      ['start', 'x_tpl_start', 'owner', 'ON_BUFF_START'],
      ['end', 'x_tpl_finish', 'owner', 'ON_BUFF_FINISH'],
      ['loop', 'x_tpl_derived', 'owner', 'ON_BUFF_TRIGGER'],         // a buff the template creates loops
      ['hit', 'x_hit', 'owner', 'effect'],                           // a blackboard effect, placed by its name
    ]);
    assert.equal(out.u3[1].from, 'ActiveBuffAbility._buffs → template x_t');
    assert.deepEqual(out.u4, [{ role: 'ready', keys: ['x_ready'], from: 'ReadySkillEffect._effects' }]);
    assert.deepEqual(Object.keys(out.roles), ['start', 'loop', 'range', 'hit', 'end', 'ready'], 'roles in SKILL_ROLES order');
    assert.deepEqual(out.roles.start, ['ifrit_skill_02_start', 'x_start_up', 'x_start', 'x_start_down', 'x_tpl_start']);
    assert.deepEqual(out.modes, [2, 1, null]);
    assert.deepEqual(out.on, ['targets', 'targets', 'owner', 'token', null]);
    assert.deepEqual(out.graph, [['CreateEffect', '_effectKey', 'x_tpl_start'], ['CreateBuff', 'overrideEffectKey', 'x_tpl_derived']]);
  });
});

describe('fx.py Phase 1d (index.json v3, DESIGN §33.17): buff lives, ability links, talents, group choice', { skip: !PY && 'no python3' }, () => {
  test('buff_life: Torappu.LifeType names (numbers in prefabs, names in templates), time, the duration key of a timed buff, DB, tick', () => {
    const out = py(`
B = lambda **kw: {'buffKey': 'b', 'overrideEffectKey': '', **kw}
print(json.dumps([fx.buff_life(B(lifeTimeType=1, durationKey='duration', lifeTime=0.0, loadFromDB=0, triggerInterval=-1.0)),
  fx.buff_life(B(lifeTimeType=2, durationKey='duration', lifeTime=0.0, triggerInterval=0.03)),
  fx.buff_life(B(lifeTimeType=0, durationKey='', lifeTime=0.5, loadFromDB=1)),
  fx.buff_life(B(lifeTimeType=1, durationKey='none', lifeTime=6.0)),
  fx.buff_life(B(lifeTimeType='INFINITY', durationKey=None)), fx.buff_life(B(lifeTimeType=7)), fx.buff_life(B()), list(fx.LIFE_TYPES)]))`);
    assert.deepEqual(out[0], { type: 'LIMITED', key: 'duration' }, 'a LIMITED buff reads its time from the blackboard key');
    assert.deepEqual(out[1], { type: 'INFINITY', tick: 0.03 }, 'the key of a buff that does not end by time is left out');
    assert.deepEqual(out[2], { type: 'IMMEDIATELY', time: 0.5, db: true });
    assert.deepEqual(out[3], { type: 'LIMITED', time: 6 }, "'none' is no key");
    assert.deepEqual(out[4], { type: 'INFINITY' }, "the templates' Odin data write the names");
    assert.deepEqual(out[5], { type: '7' });
    assert.equal(out[6], null);
    assert.deepEqual(out[7], ['IMMEDIATELY', 'LIMITED', 'INFINITY', 'CUSTOM']);
  });

  test('behaviour_uses: a buff\'s uses carry its life; the attachments\' / blockers\' / tile listeners\' buffs sit on targets', () => {
    const out = py(`
KEYS = {'x_buff', 'x_tick', 'x_debuff'}
ek = lambda s: s.lower() if isinstance(s, str) and s.lower() in KEYS else None
tpl = {'t': {'effect': None, 'graph': [['ON_BUFF_TRIGGER', 'CreateEffect', '_effectKey', 'x_tick']]}}
own = {'_buffs': [{'buffKey': 'b1', 'templateKey': 't', 'overrideEffectKey': 'x_buff', 'blackboard': [], 'lifeTimeType': 1, 'durationKey': 'duration', 'lifeTime': 0.0, 'triggerInterval': 1.0}]}
att = {'_additiveActiveBuffs': [{'buffKey': 'b2', 'templateKey': 'empty', 'overrideEffectKey': 'x_debuff', 'blackboard': [], 'lifeTimeType': 1, 'durationKey': '', 'lifeTime': 0.0}]}
print(json.dumps({'own': fx.behaviour_uses('PassiveBuffAbility', own, ek, tpl), 'att': fx.behaviour_uses('PassiveAttachmentAbility', att, ek, tpl),
  'on': [fx.buff_target('BlockedToggleChecker', '_buffsToBlockee', {}), fx.buff_target('BuffToEnemyTileListener', '_buffsWhenEnemyEnter', {}),
         fx.buff_target('BuffToCharacterTileListener', '_buffs', {}), fx.buff_target('SpawnTokenOnTileByIDAbility', '_buffsToExistToken', {}),
         fx.buff_target('LockTargetAbility', '_buff', {}), fx.buff_target('PassiveBuffAbility', '_buffs', {})]}))`);
    assert.deepEqual(out.own.map((u) => [u.role, u.keys[0], u.life]), [['loop', 'x_buff', { type: 'LIMITED', key: 'duration', tick: 1 }],
      ['trigger', 'x_tick', { type: 'LIMITED', key: 'duration', tick: 1 }]], 'the template\'s periodic action carries the buff\'s tick');
    assert.deepEqual([out.att[0].on, out.att[0].life], ['targets', { type: 'LIMITED' }], '_additiveActiveBuffs: added to the owner\'s attacks');
    assert.deepEqual(out.on, ['targets', 'targets', 'targets', 'token', 'targets', 'owner']);
  });

  test('graph_links / bb_ability_names: the abilities a template casts or stops (an unnamed one: its buff\'s blackboard ability_name), mode switches, created buffs', () => {
    const out = py(`
N = lambda t, **kw: {'$type': 'Torappu.Battle.Action.Nodes+' + t, **kw}
state = json.dumps([N('TriggerAbility', _abilityName='kazema[switch2stand]'), N('TriggerAbility', _abilityName=''),
  N('InterruptAbility', _abilityName='Aura'), N('SwitchMode', _modeIndex=1, _loadModeFromBlackboard=True, _restoreDefault=False),
  N('SwitchMode', _modeIndex=0, _loadModeFromBlackboard=False, _restoreDefault=True),
  N('CheckUnitCurrentMode', _succeedNodes=[N('CreateBuff', _buff={'buffKey': 'k', 'templateKey': 'kazema_switchend', 'overrideEffectKey': None})]),
  N('FilterAbilityName', _abilityName='Skill')])
buff = {'buffKey': 'gnosis_t_2', 'templateKey': 'triggerability_tick_trigger', 'overrideEffectKey': '', 'blackboard': [{'key': 'ability_name', 'value': 0.0, 'valueStr': 'gnosis_t_2_buff'}]}
print(json.dumps([fx.graph_links(state), fx.graph_links('not json'), fx.bb_ability_names({'_buffs': [buff, {**buff, 'blackboard': []}]}),
                  [t for t, _ in fx.graph_nodes(state)]]))`);
    const [links, none, named, types] = out;
    assert.deepEqual(links[0], [['TriggerAbility', 'kazema[switch2stand]', 'cast'], ['TriggerAbility', null, 'cast'], ['InterruptAbility', 'Aura', 'stop']],
      'FilterAbilityName names an ability but neither casts nor stops it');
    assert.deepEqual(links[1], [['bb', false], [0, true]]);
    assert.deepEqual(links[2], ['kazema_switchend']);
    assert.deepEqual(none, [[], [], []]);
    assert.deepEqual(named, [['gnosis_t_2', 'triggerability_tick_trigger', 'gnosis_t_2_buff']]);
    assert.ok(types.includes('CreateBuff'), 'nested nodes are walked');
  });

  test('group_select / attack_extras / config_ability: how a group picks its sub-abilities, mount points, multi-shot fields', () => {
    const out = py(`
P = lambda i: {'m_FileID': 0, 'm_PathID': i}
print(json.dumps([
  fx.group_select('AbilityRandomGroup', {'_abilities': [P(1)], '_selectMethod': 0, '_isConfigurableProb': 1, '_probKeyList': ['p1', 'p2'], '_diffFromLastOneIfNotFirst': 1, '_selectAllAtLeastOnce': 0}),
  fx.group_select('AbilityRandomGroup', {'_abilities': [], '_selectMethod': 1, '_isConfigurableProb': 0, '_probKeyList': ['p']}),
  fx.group_select('AbilitySelectableGroup', {'_abilityConfigs': [], '_selectAbilitySequentially': 0}),
  fx.group_select('BurstAttackGroup', {'_abilityConfigs': [], '_selectAbilitySequentially': 1}),
  fx.group_select('AbilityParallelGroup', {'_abilities': []}), fx.group_select('AbilitySequenceGroup', {'_abilities': [], '_enableLoop': 1}),
  fx.group_select('AbilityFirstSucceedGroup', {'_abilities': []}), fx.group_select('MeleeAttack', {'_animKey': 'Attack'}),
  fx.attack_extras({'_mountPointType': 2, '_useMountGroup': 1, '_mountGroup': {'loopType': 1, 'mountPoints': [5, 6]}, '_additionalTimes': 14,
                    '_triggerDelta': 0.029999999329447746, '_additionalProjectile': 'projectile_x', '_useMultiAdditionalProjectiles': 0, '_additionalProjectiles': ['y']}),
  fx.attack_extras({'_mountPointType': 0, '_useMountGroup': 0, '_mountGroup': {'loopType': 0, 'mountPoints': [1]}}), fx.attack_extras({}),
  fx.config_ability({'_ability': P(9), '_trigger': P(3)}), fx.config_ability(P(4))]))`);
    assert.deepEqual(out[0], { method: 'random', probKeys: ['p1', 'p2'], diffFromLast: true });
    assert.deepEqual(out[1], { method: 'loop' }, 'SelectMethod 1 is Loop; the weights only with _isConfigurableProb');
    assert.deepEqual(out.slice(2, 8), [{ method: 'trigger' }, { method: 'sequential' }, { method: 'parallel' }, { method: 'sequence', loop: true },
      { method: 'firstSucceed' }, null]);
    assert.deepEqual(out[8], { mount: 'MUZZLE', mountGroup: { loop: 'LOOP', mounts: ['SPECIAL_0', 'SPECIAL_1'] }, additionalTimes: 14, triggerDelta: 0.03,
      additionalProjectile: 'projectile_x' });
    assert.deepEqual(out[9], { mount: 'FOOT' }, 'a mount group only when used');
    assert.deepEqual(out[10], {});
    assert.deepEqual(out.slice(11), [{ m_FileID: 0, m_PathID: 9 }, { m_FileID: 0, m_PathID: 4 }]);
  });

  test('talent_when / ability_when: deploy, reborn, attack by the Talent class; toggle / passive by the ability; else null', () => {
    const out = py(`print(json.dumps([fx.talent_when('AppearTalent', 'MeleeAttack', []), fx.talent_when('AppearSyncedTalent', 'AuraAbility', []),
  fx.talent_when('RebornTalent', 'EmptyAbility', []), fx.talent_when('ManualTriggerRebornTalent', 'EmptyAbility', []),
  fx.talent_when('ProbReplaceNextAtkTalent', 'MultiMeleeAttack', []), fx.talent_when('Talent', 'ToggleablePassiveBuffAbility', ['Talent', 'ToggleablePassiveBuffAbility', 'HpRatioToggleChecker']),
  fx.talent_when('Talent', 'PassiveBuffAbility', []), fx.talent_when('Talent', 'GlobalAuraAbility', []), fx.talent_when('Talent', 'ActiveAbilityWrapper', []),
  fx.talent_when('Talent', None, []), fx.ability_when('PassiveAttachmentAbility', []), fx.ability_when('AbilitySequenceGroup', [])]))`);
    assert.deepEqual(out, ['deploy', 'deploy', 'reborn', 'reborn', 'attack', 'toggle', 'passive', 'passive', null, null, 'passive', null]);
  });

  test('talent_keys / enemy_talent_prefixes: our data\'s talent ids → the prefab\'s Talents/<key> nodes', () => {
    const out = py(`
ct = {'char_1_x': {'talents': [{'candidates': [{'prefabKey': '1'}, {'prefabKey': '1+'}]}, {'candidates': [{'prefabKey': '2'}]}, {'candidates': []}],
                   'trait': {'candidates': [{'prefabKey': '-1'}]}},
      'token_9_y': {'talents': [{'candidates': [{'prefabKey': '1'}]}], 'trait': None}, 'char_2_z': {'talents': [], 'trait': {'candidates': []}}}
be = {'uniequip_002_x': {'phases': [{'parts': [{'isToken': False, 'addOrOverrideTalentDataBundle': {'candidates': [{'talentIndex': -1, 'prefabKey': '10'}, {'talentIndex': 0, 'prefabKey': '1'}]}},
                                              {'isToken': True, 'addOrOverrideTalentDataBundle': {'candidates': [{'talentIndex': 0, 'prefabKey': '99'}]}}]},
                                   {'parts': [{'isToken': False, 'addOrOverrideTalentDataBundle': {'candidates': [{'talentIndex': -1, 'prefabKey': '10'}]}}]}]}}
ue = {'equipDict': {'uniequip_002_x': {'charId': 'char_1_x'}, 'uniequip_001_x': {'charId': 'char_1_x'}}}
print(json.dumps([fx.talent_keys(['char_1_x', 'token_9_y', 'char_2_z', 'char_404'], ct, be, ue), fx.talent_keys(['char_1_x'], {}, {}, {}),
  fx.enemy_talent_prefixes({'talents': {'bb': {'Reborn.duration': 5, 'Reborn.invincible': 10, 'ClearSp.hp_ratio': 0.25, 'plain': 1}, 'bbStr': {'Fx.key': 'a'}}})]))`);
    assert.deepEqual(out[0], {
      char_1_x: { base: { 0: ['1', '1+'], 1: ['2'] }, trait: ['-1'], modules: { uniequip_002_x: { '-1': ['10'], 0: ['1'] } } },
      token_9_y: { base: { 0: ['1'] } },
    }, 'a module\'s token parts are its summons\'; a unit without talents is left out');
    assert.deepEqual(out[1], {}, 'no tables, no links');
    assert.deepEqual(out[2], ['Reborn', 'ClearSp', 'Fx']);
  });

  test('ability_info / projectile_emitters / row_keys, the funnel and reborn effect fields, the preload list', () => {
    const out = py(`
pk = lambda s: s.lower() if isinstance(s, str) and s.lower().startswith('projectile_') else None
KEYS = {'f_idle', 'f_back', 'f_show', 'f_hide', 'r_start', 'pre'}
ek = lambda s: s.lower() if isinstance(s, str) and s.lower() in KEYS else None
ranged = [('RangedAttack', {'_animKey': 'Attack', '_attackType': 1, '_damageType': 2, '_projectileKey': 'Projectile_A', '_extraProjectileKeys': ['projectile_B', ''], '_projectileDestination': 0, '_mountPointType': 3}),
          ('UberEffectEmitter', {'_castEffects': []}), ('SimpleProjectileEmitter', {'_projectileKey': 'projectile_c'})]
group = [('AbilityRandomGroup', {'_abilities': [], '_selectMethod': 1})]
buffs = [('ActiveBuffAbility', {'_buffs': []})]
print(json.dumps([fx.ability_info(ranged, pk), fx.projectile_emitters(ranged, pk, skip='RangedAttack'), fx.ability_info(group, pk), fx.ability_info(buffs, pk),
  fx.row_keys({'effects': ['a'], 'slots': [None, 'b'], 'hookEffectAfterFirstAttack': 'c'}), fx.row_keys({'effects': [], 'hookEffectAfterFirstAttack': ''}),
  [(u['role'], u['keys'][0]) for u in fx.behaviour_uses('FunnelEffectEmitter', {'_idleEffect': ['f_idle'], '_idleBackEffect': ['f_back'], '_appearEffect': ['f_show'], '_disappearEffect': ['f_hide']}, ek, {})],
  [(u['role'], u['keys'][0]) for u in fx.behaviour_uses('RebornTalent', {'_effects': ['r_start']}, ek, {})], fx.behaviour_uses('ExtraAbilityPreloads', {'_effects': ['pre']}, ek, {})]))`);
    assert.deepEqual(out[0], { class: 'RangedAttack', animKey: 'Attack', attackType: 1, damageType: 2, projectileKey: 'projectile_a', extraProjectileKeys: ['projectile_b'],
      projectileDestination: 0, mount: 'HEAD' });
    assert.deepEqual(out[1], [{ class: 'SimpleProjectileEmitter', projectileKey: 'projectile_c' }]);
    assert.deepEqual(out[2], { class: 'AbilityRandomGroup', select: { method: 'loop' } });
    assert.equal(out[3], null, 'an ability without attack fields or sub-abilities is no abilities entry');
    assert.deepEqual(out[4], ['a', 'b', 'c']);
    assert.deepEqual(out[5], []);
    assert.deepEqual(out[6], [['loop', 'f_idle'], ['loop', 'f_back'], ['start', 'f_show'], ['end', 'f_hide']]);
    assert.deepEqual(out[7], [['start', 'r_start']]);
    assert.deepEqual(out[8], [], 'ExtraAbilityPreloads only preloads');
  });

  test('behaviour_uses: a replace group\'s uses name its LoopType (LOOP / RANDOM)', () => {
    const out = py(`
ek = lambda s: s if s in ('a_start', 'b_start') else None
row = lambda k: {'_directionType': 0, '_effects': [k], '_oneshot': 1, '_startEvent': 2, '_endEvent': 3}
f = {'_sourceAnimKey': 'Attack', '_loopType': 0, '_replaceGroup': [{'anim': 'Attack_A', 'effectOptions': [row('a_start')], 'hitEffectOptions': []},
                                                                  {'anim': 'Attack_B', 'effectOptions': [row('b_start')], 'hitEffectOptions': []}]}
print(json.dumps([[u['keys'][0], u['anim'], u['group'], u['loopType']] for u in fx.behaviour_uses('UberAnimationEffectEmitter', f, ek, {}, node='n', ability='MeleeAttack')]))`);
    assert.deepEqual(out, [['a_start', 'Attack_A', 0, 'LOOP'], ['b_start', 'Attack_B', 1, 'LOOP']]);
  });
});

describe('extract.py: the fx run is opt-in', { skip: !PY && 'no python3' }, () => {
  test('fx_selected: only an --only prefix naming fx runs it (a plain run leaves the effects out)', () => {
    const src = `import sys, json\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport extract as e\n`
      + `print(json.dumps([e.fx_selected(o) for o in ([], ['fx'], ['fx/'], ['fx/prefabs'], ['map'], ['f'], ['map', 'fx'])]))`;
    const r = spawnSync(PY, ['-c', src], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), [false, true, true, true, false, false, true]);
  });

  test('an fx run drops the fx groups an earlier run left in data/local-assets.json (the files have data/local-fx.json)', () => {
    const src = `import sys, json\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport extract as e, fx\n`
      + "old = {'fx': {'index': {}}, 'fx/prefabs': {'a': {}}, 'fx/tex': {}, 'map/fx': {'m': {}}, 'emoticon/x': {}}\n"
      + "print(json.dumps([sorted(e.ran_groups(old, {}, True)), sorted(e.ran_groups(old, {'map/fx': {}})),\n"
      + "  sorted(e.merge_manifest(old, {}, e.ran_groups(old, {}, True))), fx.FX_MANIFEST, list(fx.FX_GROUPS)]))";
    const r = spawnSync(PY, ['-c', src], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    const [afterFx, afterMap, merged, name, groups] = JSON.parse(r.stdout);
    assert.deepEqual(afterFx, ['fx', 'fx/prefabs', 'fx/tex'], 'map/fx is not an fx group');
    assert.deepEqual(afterMap, ['map/fx'], 'another run keeps the groups it did not write');
    assert.deepEqual(merged, ['emoticon/x', 'map/fx']);
    assert.equal(name, 'local-fx.json');
    assert.deepEqual(groups, ['fx', 'fx/prefabs', 'fx/tex', 'fx/mesh']);
  });

  test('--print-jobs lists the fx run: its output dir, format version and the Phase 1a sample', () => {
    const r = spawnSync(PY, [path.join(TOOL, 'extract.py'), '--print-jobs'], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    const { fx, jobs } = JSON.parse(r.stdout);
    assert.equal(fx.sub, 'fx');
    assert.equal(fx.version, 1);
    assert.equal(fx.indexVersion, 3);
    assert.equal(fx.meshVersion, 2);
    assert.equal(fx.optIn, true);
    assert.equal(fx.textureFormat, 'webp');
    assert.deepEqual(fx.textureFormats, ['webp', 'png']);
    for (const k of ['common_hit_01', 'buff_stun', 'buff_autochess_frozen', 'inside_attack_01_trail_front', 'ifrit_skill_03_buff', 'enemy_tidmag_attack_01_hit']) {
      assert.ok(fx.sample.keys.includes(k), k);
    }
    assert.ok(fx.sample.units.includes('char_498_inside') && fx.sample.units.includes('enemy_1041_lazerd'));
    assert.ok(!jobs.some((j) => j.sub === 'fx' || j.sub.startsWith('fx/')), 'not a plain job: the fx run has its own entry');
  });
});

/** Every Emit row of an attack (index.json units[id].modes[].attack / combat): its lists, its sub-abilities'. */
function attackRows(a, out = []) {
  if (!a) return out;
  for (const l of ['cast', 'hit', 'attach', 'inputTarget', 'castTarget']) for (const e of a[l] || []) out.push(e);
  for (const sub of a.abilities || []) attackRows(sub, out);
  return out;
}
/** Every Emit row of a unit's charge groups (their emitters' rows and per-energy groups, their abilities'). */
function chargeRows(u, out = []) {
  const em = (e) => {
    for (const l of ['cast', 'hit', 'attach', 'inputTarget', 'castTarget']) for (const r of e[l] || []) out.push(r);
    for (const k of ['chargeEffectGroups', 'chargeCastGroups', 'mergedChargeEffectGroups', 'mergedChargeCastGroups']) for (const g of e[k] || []) out.push(...g);
  };
  for (const g of u.charge || []) { for (const e of g.emitters) em(e); for (const ab of g.abilities) for (const e of ab.emitters) em(e); }
  return out;
}
const rowKeys = (e) => [...e.effects, ...(e.slots || []).filter(Boolean), ...(e.hookEffectAfterFirstAttack ? [e.hookEffectAfterFirstAttack] : [])];

describe('extracted effects (when fx was extracted on this machine)', { skip: !fxList?.groups?.fx?.index && 'fx not extracted' }, () => {
  const groups = fxList?.groups || {};
  const onDisk = (p) => path.join(FX_ROOT, 'public', p);
  const hasFiles = !!groups.fx?.index?.path && existsSync(onDisk(groups.fx.index.path));
  const index = hasFiles && groups.fx?.index ? readJson(path.join('public', groups.fx.index.path), FX_ROOT) : null;

  test('data/local-fx.json lists the fx files in its groups; data/local-assets.json has none of them', () => {
    assert.equal(fxList.format, 'fx-manifest');
    assert.deepEqual(Object.keys(fxList.groups).sort(), ['fx', 'fx/mesh', 'fx/prefabs', 'fx/tex']);
    assert.equal(fxList.count, Object.values(fxList.groups).reduce((n, g) => n + Object.keys(g).length, 0));
    for (const g of Object.keys(manifest?.groups || {})) assert.ok(g !== 'fx' && !g.startsWith('fx/'), `${g} left in data/local-assets.json`);
  });

  test('the list names every file, the index and the list agree, every named key has a descriptor', { skip: !hasFiles && 'files not here' }, () => {
    assert.ok(index, groups.fx.index.path);
    assert.equal(index.format, 'fx-index');
    assert.equal(index.version, groups.fx.index.version);
    assert.deepEqual(Object.keys(index.prefabs).sort(), Object.keys(groups['fx/prefabs']).sort(), 'one manifest entry per descriptor');
    for (const g of ['fx/prefabs', 'fx/tex', 'fx/mesh']) {
      for (const [k, e] of Object.entries(groups[g] || {})) {
        assert.ok(existsSync(onDisk(e.path)), `${g} ${k}: ${e.path}`);
        if (e.half) assert.ok(existsSync(onDisk(e.half)), `${g} ${k}: ${e.half}`);
      }
    }
    const named = new Set();
    for (const [id, u] of Object.entries(index.units)) {
      if (u.aliasOf) assert.ok(index.units[u.aliasOf] && !index.units[u.aliasOf].aliasOf, `${id}: aliasOf ${u.aliasOf} is a unit of its own`);
      for (const k of u.refs) named.add(k);
      for (const m of u.modes) for (const e of [...attackRows(m.attack), ...attackRows(m.combat)]) for (const k of rowKeys(e)) named.add(k);
      for (const e of chargeRows(u)) for (const k of rowKeys(e)) named.add(k);
      for (const e of u.spineEffects || []) for (const k of rowKeys(e)) named.add(k);
    }
    // the skills: index.skills (operators', tokens') and every unit's own (an enemy's are not in index.skills); the
    // units' talents and abilities (v3) have the same uses / roles / unclassified
    const allSkills = Object.entries(index.skills);
    for (const [id, u] of Object.entries(index.units)) for (const [sid, s] of Object.entries(u.skills || {})) if (!index.skills[sid]) allSkills.push([`${id} ${sid}`, s]);
    for (const [id, u] of Object.entries(index.units)) {
      for (const [k, t] of Object.entries(u.talents || {})) allSkills.push([`${id} talent ${k}`, { ...t, mode: null }]);
      for (const a of u.abilities || []) allSkills.push([`${id} ${a.kind} ${a.node}`, { ...a, mode: null }]);
    }
    for (const [sid, s] of allSkills) {
      assert.ok(Array.isArray(s.uses) && Array.isArray(s.unclassified) && s.roles && typeof s.roles === 'object', `${sid}: uses / roles / unclassified`);
      for (const use of s.uses) {
        assert.ok(['start', 'loop', 'range', 'cast', 'hit', 'end', 'ready', 'trigger', 'other'].includes(use.role), `${sid}: role ${use.role}`);
        for (const k of [...use.keys, ...(use.slots || [])]) if (k) named.add(k);
      }
      if (s.mode !== null) assert.ok(Number.isInteger(s.mode) && ['data', 'name'].includes(s.modeBy), `${sid}: mode ${s.mode} by ${s.modeBy}`);
    }
    for (const p of Object.values(index.projectiles)) { if (p.main) named.add(p.main); for (const k of p.effects) named.add(k); }
    for (const v of Object.values(index.prefabs)) for (const k of v.refs) named.add(k);
    for (const g of ['hit', 'die', 'birth']) for (const k of Object.values(index.generic[g])) named.add(k);
    for (const k of named) assert.ok(index.prefabs[k], `${k} is named by the index and exported`);
    for (const [k, v] of Object.entries(index.prefabs)) {
      assert.equal(k, k.toLowerCase(), 'keys are lower case');
      const d = JSON.parse(readFileSync(onDisk(groups['fx/prefabs'][k].path), 'utf8'));
      assert.equal(d.format, 'fx-prefab');
      assert.equal(d.key, k);
      assert.equal(d.nodes.length, v.nodes);
      for (const t of d.textures) assert.ok(groups['fx/tex'][t], `${k}: texture ${t} listed`);
      for (const m of d.meshes) assert.ok(groups['fx/mesh'][m], `${k}: mesh ${m} listed`);
      for (const n of d.nodes) {
        for (const r of ['particleSystemRenderer', 'meshRenderer', 'trailRenderer', 'lineRenderer', 'skinnedMeshRenderer']) {
          for (const mi of n[r]?.materials || []) assert.ok(mi === null || (mi >= 0 && mi < d.materials.length), `${k} ${n.name}: material ${mi}`);
        }
      }
    }
  });
  test('index.json v2 (Phase 1c): subclass emitters in the mode attacks, the charge groups, hit groups, enemy / token skills, skills\' root classes', { skip: !(index?.version >= 2) && 'no v2 index here' }, () => {
    // the mode attacks whose emitters are UberEffectEmitter subclasses (client 26-09-13: these 19 operators)
    const SUB = new Set(['MultiChargeUberEffectEmitter', 'MultiHitUberEffectEmitter', 'UberAnimationEffectEmitter']);
    const hasSub = (a) => !!a && ((a.emitters || []).some((e) => SUB.has(e.class)) || (a.abilities || []).some(hasSub));
    for (const id of ['char_469_indigo', 'char_4046_ebnhlz', 'char_4226_veen', 'char_1050_chen3', 'char_4009_irene', 'char_1028_texas2',
      'char_4064_mlynar', 'char_4098_vvana', 'char_4116_blkkgt', 'char_1502_crosly', 'char_1044_hsgma2', 'char_1019_siege2', 'char_1042_phatm2',
      'char_1046_sbell2', 'char_2027_wang', 'char_4080_lin', 'char_4088_hodrer', 'char_4133_logos', 'char_4229_aphris']) {
      const u = index.units[id];
      if (u) assert.ok(u.modes.some((m) => hasSub(m.attack)), `${id}: a mode attack with an UberEffectEmitter subclass`);
    }
    for (const u of Object.values(index.units)) {
      for (const m of u.modes) {
        for (const a of [m.attack, m.combat]) {
          if (!a?.emitters) continue;
          for (const e of attackRows({ ...a, abilities: [] })) assert.ok(Number.isInteger(e.emitter) && e.emitter < a.emitters.length, `${u.prefab} ${m.name}: emitter index`);
        }
      }
    }
    const chen3 = index.units.char_1050_chen3?.modes.find((m) => m.name === 'S1');
    if (chen3) {
      assert.deepEqual(chen3.attack.hit.map((e) => [e.effects[0], e.group]), [['chen3_skill_01_hit_01', 0], ['chen3_skill_01_hit_02', 1]]);
      assert.deepEqual(chen3.attack.cast.map((e) => e.effects[0]), ['chen3_skill_01_start_01', 'chen3_skill_01_start_02']);
    }
    // 深靛's charge: the trait group's per-energy loops, the store abilities' projectiles and mount points, the modes' links
    const indigo = index.units.char_469_indigo;
    if (indigo) {
      const g = indigo.charge[0];
      assert.equal(g.maxChargeTimes, 3);
      assert.deepEqual(g.emitters[0].chargeEffectGroups.map((x) => x[0].effects[0]), ['indigo_attack_charge_02', 'indigo_attack_charge_03', 'indigo_attack_charge_04', 'indigo_attack_charge_05']);
      assert.deepEqual(g.abilities.map((a) => a.projectileKey), ['projectile_chr_indigo', 'projectile_chr_indigo_s1', 'projectile_chr_indigo_s2']);
      assert.deepEqual(g.abilities[0].mounts, ['SPECIAL_1', 'SPECIAL_2', 'SPECIAL_3', 'SPECIAL_0']);
      assert.deepEqual(g.abilities[0].emitters[0].chargeEffectGroups[0][0].effects, ['indigo_attack_charge_01_start']);
      const def = indigo.modes.find((m) => m.name === 'Default').attack;
      assert.deepEqual(def.charge, { group: 0, ability: 0, animKey: 'Attack_Charge' });
      assert.deepEqual(g.abilities[0].modes, ['Default', 'Default_T1']);
    }
    const veen = index.units.char_4226_veen?.charge?.[0];
    if (veen) assert.equal(veen.emitters[0].mergedChargeEffectGroups.length, 4);
    // skills: hit groups, the root class
    const chen = index.skills.skchr_chen_3;
    if (chen) assert.equal(new Set(chen.uses.filter((u) => u.list === 'hit' && Number.isInteger(u.group)).map((u) => u.group)).size, 10);
    for (const [sid, s] of Object.entries(index.skills)) assert.ok('rootClass' in s && 'rootAbility' in s, `${sid}: rootClass`);
    if (index.skills.skchr_amgoat_2) assert.equal(index.skills.skchr_amgoat_2.rootClass, 'ReplacementSkill');
    // an enemy's skills (its own nodes) and its blocked attack; a summon's skill (index.skills too)
    const hammer = index.units.enemy_1045_hammer;
    if (hammer) {
      assert.equal(hammer.modes[0].attack, null);
      assert.deepEqual(hammer.modes[0].combat.hit.map((e) => e.effects[0]), ['hammer_attack_01_hit']);
      const s = hammer.skills.stuncombat;
      assert.equal(s.rootClass, 'EnemySkill');
      assert.deepEqual(s.roles.ready, ['hammer_skill_01_buff']);
      assert.ok(!index.skills.stuncombat, 'an enemy\'s skill keys stay in its unit');
    }
    const drone = index.units.token_10005_mgllan_drone1;
    if (drone) assert.ok(drone.skills.sktok_mgllan_drone1 && index.skills.sktok_mgllan_drone1, 'token skills');
    assert.ok(Object.values(index.prefabs).some((p) => Number.isInteger(p.spawn)), 'prefab summaries carry their spawn location');
    // The skins' points exclude prefab-root placement. The November acfnca prefab deliberately lowers Graphic.
    for (const [id, sk] of Object.entries(index.skins)) {
      for (const [face, p] of Object.entries(sk.points.HitPoint || {})) {
        const [x, y, z] = p.pos;
        if (id === 'enemy_9027_acfnca') {
          // enm_pfb_36: Graphic y=-1.2, scale=.27, tilt=-30°; HitPoint local y=1.8.
          assert.deepEqual(p.pos, [0, -0.779112, -0.303]);
          continue;
        }
        assert.ok(Math.abs(x) < 0.9 && y > -0.6 && y < 1.6 && z > -1.5 && z < 0.01, `${id} HitPoint (${face}) over the feet: ${p.pos}`);
      }
    }
  });

  test('index.json v3 (Phase 1d): talents, common / general abilities, the abilities\' projectiles, buff lives, group choice', { skip: !(index?.version >= 3) && 'no v3 index here' }, () => {
    const WHEN = new Set(['deploy', 'reborn', 'attack', 'toggle', 'passive', null]);
    const LIFE = new Set(['IMMEDIATELY', 'LIMITED', 'INFINITY', 'CUSTOM']);
    const METHODS = new Set(['random', 'loop', 'trigger', 'sequential', 'firstSucceed', 'parallel', 'sequence']);
    let talents = 0, abilities = 0, lives = 0;
    const checkNode = (id, n, modes) => {
      assert.ok(typeof n.node === 'string' && n.node, `${id}: node path`);
      assert.ok(WHEN.has(n.when ?? null), `${id} ${n.node}: when ${n.when}`);
      for (const m of [n.mode, ...(n.modes || []), n.reborn?.mode, ...(n.switchMode || []).map((x) => x.mode)]) {
        if (m != null) assert.ok(modes.includes(m), `${id} ${n.node}: mode ${m} is one of the unit's`);
      }
      for (const t of [...(n.triggers || []), ...(n.stops || [])]) assert.ok(t.template && t.event && t.action && t.name, `${id} ${n.node}: trigger fields`);
      for (const c of n.toggle || []) assert.match(c.class, /ToggleChecker$/);
    };
    const checkAbilities = (id, list) => {
      for (const a of list || []) {
        assert.ok(a.node && a.class, `${id}: abilities entry`);
        if (a.projectileKey) assert.ok(index.projectiles[a.projectileKey], `${id} ${a.node}: projectile ${a.projectileKey} exported`);
        if (a.select) assert.ok(METHODS.has(a.select.method), `${id} ${a.node}: select ${a.select.method}`);
      }
    };
    for (const [id, u] of Object.entries(index.units)) {
      const modes = u.modes.map((m) => m.name);
      for (const [k, t] of Object.entries(u.talents || {})) {
        talents++;
        assert.ok(t.nodes.length && (t.effects.length || t.projectiles.length), `${id} talent ${k}: nodes and effects`);
        t.nodes.forEach((n, i) => {
          checkNode(`${id} talent ${k}`, n, modes);
          if (n.same != null) assert.ok(n.same < i && !t.nodes[n.same].mode, `${id} talent ${k}: same points at an earlier node outside the modes`);
        });
        checkAbilities(`${id} talent ${k}`, t.abilities);
      }
      for (const a of u.abilities || []) {
        abilities++;
        assert.ok(['common', 'general', 'trait'].includes(a.kind), `${id} ${a.node}: kind ${a.kind}`);
        if (a.kind === 'general') assert.ok(a.modes?.length, `${id} ${a.node}: a general ability names its modes`);
        checkNode(id, a, modes);
        checkAbilities(`${id} ${a.node}`, a.abilities);
      }
      const walk = (a) => {
        if (!a) return;
        if (a.select) assert.ok(METHODS.has(a.select.method), `${id}: attack select ${a.select.method}`);
        for (const e of a.emitters || []) if (e.class === 'UberAnimationEffectEmitter') assert.ok(['LOOP', 'RANDOM'].includes(e.loopTypeName), `${id}: loopTypeName`);
        (a.abilities || []).forEach(walk);
      };
      for (const m of u.modes) { walk(m.attack); walk(m.combat); }
      if (u.talentKeys) assert.ok(u.talentKeys.base && typeof u.talentKeys.base === 'object', `${id}: talentKeys.base`);
    }
    const allUses = [...Object.values(index.skills), ...Object.values(index.units).flatMap((u) => [...Object.values(u.talents || {}), ...(u.abilities || [])])]
      .flatMap((s) => s.uses);
    for (const x of allUses) if (x.life) { lives++; assert.ok(LIFE.has(x.life.type), `life ${x.life.type}`); }
    for (const s of Object.values(index.skills)) checkAbilities('skill', s.abilities);
    assert.ok(talents > 0 && abilities > 0 && lives > 0, `talents ${talents}, abilities ${abilities}, buff lives ${lives}`);
    // known units (client 26-09-13): a leader's 重生, a stand switch, a talent cast by a generic template, a deploy cast,
    // a trait talent's key, a funnel attack's funnels, a skill's projectile
    const reid = index.units.enemy_1539_reid?.talents?.Reborn;
    if (reid) {
      const r = reid.nodes.find((n) => n.reborn)?.reborn;
      assert.deepEqual([r.mode, r.handler, r.maxCount], ['Reborn', 'Revive', 1]);
      assert.ok(reid.nodes.find((n) => n.node === r.handlerNode)?.when === 'reborn');
      assert.deepEqual(reid.uses.filter((x) => x.ability === 'EmptyAnimatedAbility').map((x) => [x.keys[0], x.role, x.startEvent]),
        [['enemy_reid_revive_01', 'loop', 'ON_CAST_START'], ['enemy_reid_revive_02', 'end', 'ON_CAST_END']]);
      assert.equal(reid.bb, 'Reborn', 'data/enemies.json talents.bb Reborn.*');
    }
    const kazema = index.units.char_4016_kazema;
    if (kazema) {
      const sw = kazema.abilities.find((a) => a.name === 'kazema[switch2stand]');
      assert.ok(sw.triggers.some((t) => t.template === 'kazema_tr' && t.event === 'ON_BEFORE_TRY_SET_HP_ZERO'), JSON.stringify(sw.triggers));
      assert.ok(sw.switchMode.some((x) => x.mode === 'Stand'));
      assert.deepEqual(kazema.talentKeys.trait, ['-1']);
    }
    const gnosis = index.units.char_206_gnosis?.talents?.['2'];
    if (gnosis) assert.ok(gnosis.nodes.some((n) => (n.triggers || []).some((t) => t.name === 'gnosis_t_2_buff' && t.buff === 'gnosis_t_2')));
    const nearl2 = index.units.char_1014_nearl2?.talents?.['1'];
    if (nearl2) assert.ok(nearl2.nodes.some((n) => n.when === 'deploy' && n.class === 'AppearTalent'));
    const kjera = index.units.char_4013_kjera?.modes.find((m) => m.name === 'S2')?.attack;
    if (kjera) assert.deepEqual(kjera.abilities.map((a) => [a.node, a.emitters?.[0]?.class]), [['Modes/S2/Body/Funnel_0', 'FunnelEffectEmitter'], ['Modes/S2/Body/Funnel_1', 'FunnelEffectEmitter']]);
    const amgoat = index.skills.skchr_amgoat_2;
    if (amgoat) {
      assert.deepEqual(amgoat.abilities.map((a) => [a.class, a.projectileKey]), [['RangedAttack', 'projectile_amgoat_s2']]);
      assert.ok(amgoat.uses.some((x) => x.projectileKey === 'projectile_amgoat_s2'));
    }
  });

  test('meshes version 2 (Phase 1c): vertex colours 0…1', { skip: !(index?.version >= 2) && 'no v2 index here' }, () => {
    let n = 0;
    for (const [k, e] of Object.entries(groups['fx/mesh'] || {})) {
      const m = readJson(path.join('public', e.path), FX_ROOT);
      assert.equal(m?.version, 2, `${k}: mesh version`);
      if (m.colors) { n++; assert.ok(m.colors.every((c) => c >= 0 && c <= 1), `${k}: colours 0…1`); }
    }
    assert.ok(n > 0 || !Object.keys(groups['fx/mesh'] || {}).length, 'some meshes have colours');
  });

  test('skinned meshes the descriptors name carry four bone influences per vertex and their bind poses (skin_rows, 2026-10-15)', { skip: !hasFiles && 'files not here' }, () => {
    let n = 0;
    for (const [k, e] of Object.entries(groups['fx/prefabs'] || {})) {
      const d = readJson(path.join('public', e.path), FX_ROOT);
      for (const nd of d?.nodes || []) {
        const key = nd.skinnedMeshRenderer?.m_Mesh?.mesh;
        const me = key && groups['fx/mesh'][key];
        if (!me) continue;
        const m = readJson(path.join('public', me.path), FX_ROOT);
        n++;
        assert.ok(Array.isArray(m?.boneIndices) && m.boneIndices.length === m.vertexCount * 4, `${k}/${nd.name}: ${key} has 4 bone indices per vertex (an extraction before the fix wrote the client's 1–2, or none)`);
        assert.equal(m.boneWeights?.length, m.vertexCount * 4, `${k}/${nd.name}: 4 weights per vertex`);
        assert.ok(m.bindPoses?.length > 0, `${k}/${nd.name}: bind poses`);
      }
    }
    assert.ok(n > 0, 'the set has skinned meshes (伊芙利特 S3, 铃兰 S3, 凯尔希 S1 …)');
  });

  test('skin points carry their local rotation and whether their BoneFollower follows the bone\'s rotation (rot / followRot)', { skip: !Object.values(index?.skins || {}).some((s) => Object.values(s.points || {}).some((p) => Object.values(p).some((f) => 'rot' in f))) && 'an index extracted before the points\' rotations' }, () => {
    let still = 0;
    for (const [id, sk] of Object.entries(index.skins)) {
      for (const [nm, p] of Object.entries(sk.points || {})) {
        for (const [face, f] of Object.entries(p)) {
          assert.ok(Array.isArray(f.rot) && f.rot.length === 4 && f.rot.every(Number.isFinite), `${id} ${nm} (${face}): rot`);
          assert.ok(Math.abs(Math.hypot(...f.rot) - 1) < 1e-4, `${id} ${nm} (${face}): a unit quaternion`);
          if (f.bone) assert.equal(typeof f.followRot, 'boolean', `${id} ${nm} (${face}): followRot with a bone`);
          else assert.ok(!('followRot' in f), `${id} ${nm} (${face}): no followRot without a bone`);
          if (f.followRot === false) still++;
        }
      }
    }
    assert.ok(still > 0, 'some BoneFollowers keep the point\'s own rotation');
    // 洛洛's SpecialPoint1 and 令's SpecialPoint2: on their bones, 30° about x of their own (chararts defaultskin)
    for (const [id, nm] of [['char_4040_rockr', 'SpecialPoint1'], ['char_2023_ling', 'SpecialPoint2']]) {
      for (const f of Object.values(index.skins[id]?.points?.[nm] || {})) {
        assert.equal(f.followRot, false, `${id} ${nm}`);
        assert.ok(Math.abs(f.rot[0] - 0.258819) < 1e-5 && Math.abs(f.rot[3] - 0.965926) < 1e-5, `${id} ${nm}: ${f.rot}`);
      }
    }
    for (const f of Object.values(index.skins.char_1038_whitw2?.points?.SpecialPoint0 || {})) assert.equal(f.followRot, true, '荒芜拉普兰德\'s wolves turn with their bones');
  });

  test('projectiles of an index written by the fixed extractor: `main` is the projectile class\'s flying effect, a chain\'s line is `link`', { skip: !Object.values(index?.projectiles || {}).some((p) => p.link) && 'an index written before the fix (the runtime reads the behaviours: flight.js projectileParts)' }, (t) => {
    let legacy = 0;
    for (const [k, p] of Object.entries(index.projectiles)) {
      const own = (p.behaviours || []).find((b) => /Projectile$/.test(b.class) && b.fields && '_mainEffect' in b.fields);
      const link = (p.behaviours || []).find((b) => /^(ChainLightningEffectBehaviour|HarpoonRenderer)$/.test(b.class) && b.fields?._mainEffect);
      // --fx-add-only keeps earlier records byte-identical. A mixed index may contain old line records alongside
      // newly extracted ones; flight.js reads their behaviours. Do not mistake those old records for new output.
      if (p.rolesVersion !== 1 && !Object.hasOwn(p, 'link')) { legacy++; continue; }
      if (own) assert.equal(p.main, (own.fields._mainEffect || '').toLowerCase() || null, `${k}: main`);
      if (link) assert.equal(p.link, link.fields._mainEffect.toLowerCase(), `${k}: link`);
    }
    if (legacy) t.diagnostic(`${legacy} retained legacy projectile records use the runtime behaviour fallback`);
  });
});
