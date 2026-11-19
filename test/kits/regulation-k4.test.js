// 规程·序列Ⅰ shared operators: the kit is found by charId, every selectable skill is authored,
// and the 规程-only blackboard keys changed in this lane actually fire.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { KITS, officialKitKey, skillSpecSource } from '../../server/sim/content/index.js';
import { KIT_CHAR_IDS } from '../../server/sim/content/kits/index.js';
import { COLS } from '../../server/sim/constants.js';
import { makeBattle } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });
const DATA = loadData(path.join(ROOT, 'data/versions/act3autochess-v3_1'), { log: QUIET });
const ENEMY = 'enemy_1000_gopro_2';

// 规程 chess id (normal) → charId. From the lane list; goldens are that record's goldenId.
const OPS = [
  ['chess_char_1_01_a', 'char_4207_branch'], ['chess_char_1_02_a', 'char_127_estell'],
  ['chess_char_1_03_a', 'char_143_ghost'], ['chess_char_1_04_a', 'char_496_wildmn'],
  ['chess_char_1_06_a', 'char_199_yak'], ['chess_char_1_08_a', 'char_469_indigo'],
  ['chess_char_1_18_a', 'char_140_whitew'], ['chess_char_1_19_a', 'char_183_skgoat'],
  ['chess_char_2_03_a', 'char_381_bubble'], ['chess_char_2_04_a', 'char_4139_papyrs'],
  ['chess_char_2_05_a', 'char_4211_snhunt'], ['chess_char_2_06_a', 'char_237_gravel'],
  ['chess_char_2_10_a', 'char_4114_harold'], ['chess_char_2_12_a', 'char_150_snakek'],
  ['chess_char_2_13_a', 'char_258_podego'], ['chess_char_2_15_a', 'char_4151_tinman'],
  ['chess_char_2_16_a', 'char_337_utage'], ['chess_char_2_20_a', 'char_4163_rosesa'],
  ['chess_char_2_23_a', 'char_135_halo'], ['chess_char_2_24_a', 'char_218_cuttle'],
  ['chess_char_3_02_a', 'char_426_billro'], ['chess_char_3_07_a', 'char_422_aurora'],
  ['chess_char_3_08_a', 'char_4013_kjera'], ['chess_char_3_09_a', 'char_174_slbell'],
  ['chess_char_3_10_a', 'char_4137_udflow'], ['chess_char_3_11_a', 'char_263_skadi'],
  ['chess_char_3_12_a', 'char_423_blemsh'], ['chess_char_3_13_a', 'char_4026_vulpis'],
  ['chess_char_3_14_a', 'char_427_vigil'], ['chess_char_3_16_a', 'char_332_archet'],
  ['chess_char_3_18_a', 'char_355_ethan'], ['chess_char_3_22_a', 'char_4162_cathy'],
  ['chess_char_3_23_a', 'char_616_pithst'], ['chess_char_3_24_a', 'char_4016_kazema'],
  ['chess_char_3_25_a', 'char_4054_malist'], ['chess_char_4_06_a', 'char_4042_lumen'],
  ['chess_char_4_07_a', 'char_2026_yu'], ['chess_char_4_08_a', 'char_416_zumama'],
  ['chess_char_4_09_a', 'char_206_gnosis'], ['chess_char_4_10_a', 'char_1023_ghost2'],
  ['chess_char_4_11_a', 'char_437_mizuki'], ['chess_char_4_12_a', 'char_430_fartth'],
  ['chess_char_4_13_a', 'char_4064_mlynar'], ['chess_char_4_14_a', 'char_1034_jesca2'],
  ['chess_char_4_19_a', 'char_264_f12yin'], ['chess_char_4_20_a', 'char_1031_slent2'],
  ['chess_char_4_23_a', 'char_4082_qiubai'], ['chess_char_4_24_a', 'char_472_pasngr'],
  ['chess_char_4_25_a', 'char_291_aglina'], ['chess_char_4_26_a', 'char_171_bldsk'],
  ['chess_char_4_27_a', 'char_341_sntlla'], ['chess_char_5_01_a', 'char_1016_agoat2'],
  ['chess_char_5_06_a', 'char_4058_pepe'], ['chess_char_5_07_a', 'char_1046_sbell2'],
  ['chess_char_5_08_a', 'char_1045_svash2'], ['chess_char_5_09_a', 'char_474_glady'],
  ['chess_char_5_10_a', 'char_4145_ulpia'], ['chess_char_5_12_a', 'char_358_lisa'],
  ['chess_char_5_14_a', 'char_1019_siege2'], ['chess_char_5_15_a', 'char_391_rosmon'],
  ['chess_char_5_16_a', 'char_4010_etlchi'], ['chess_char_5_17_a', 'char_202_demkni'],
  ['chess_char_5_18_a', 'char_1047_halo2'], ['chess_char_5_24_a', 'char_420_flamtl'],
  ['chess_char_6_01_a', 'char_1039_thorn2'], ['chess_char_6_02_a', 'char_1040_blaze2'],
  ['chess_char_6_03_a', 'char_1012_skadi2'], ['chess_char_6_05_a', 'char_1014_nearl2'],
  ['chess_char_6_06_a', 'char_1038_whitw2'], ['chess_char_6_10_a', 'char_4146_nymph'],
  ['chess_char_6_12_a', 'char_4134_cetsyr'], ['chess_char_6_13_a', 'char_350_surtr'],
  ['chess_char_6_14_a', 'char_4116_blkkgt'], ['chess_char_6_17_a', 'char_2015_dusk'],
  ['chess_char_6_18_a', 'char_4193_lemuen'], ['chess_char_6_19_a', 'char_249_mlyss'],
];

// Authored on neither season. The kits never grew a spec for them.
const GENERIC_OK = new Set(['char_183_skgoat|skchr_skgoat_2', 'char_4163_rosesa|skchr_rosesa_1']);

const ds = new DataSource(DATA);

function use(t) {
  setGameData(DATA);
  t.after(() => setGameData(null));
}

function chessId(charId, elite = false) {
  const normal = OPS.find(([, c]) => c === charId)?.[0];
  assert.ok(normal && DATA.chess[normal]?.charId === charId, charId);
  if (!elite) return normal;
  const golden = DATA.chess[normal].goldenId;
  assert.equal(DATA.chess[golden]?.charId, charId);
  return golden;
}

function skillIndex(charId, skillId, elite = false) {
  const skills = DATA.chess[chessId(charId, elite)].skills || [];
  const i = skills.findIndex((s) => s.skillId === skillId);
  assert.ok(i >= 0, `${charId} ${skillId}`);
  return i;
}

function defOf(charId, skillId, elite = false, moduleId = null) {
  const id = chessId(charId, elite);
  const loadout = { skillIndex: skillId == null ? null : skillIndex(charId, skillId, elite) };
  if (moduleId) loadout.moduleId = moduleId;
  return ds.getChess(id, loadout);
}

function specOf(def) {
  const key = officialKitKey(def, DATA);
  const kit = KITS[key](def.skill?.bb ?? {}, def.raw ?? def, def);
  const id = def.skill?.id;
  if (id && kit?.skills && Object.prototype.hasOwnProperty.call(kit.skills, id)) return kit.skills[id];
  return kit?.skill ?? null;
}

function close(actual, expected, eps, what) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= eps, `${what}: got ${actual}, expected ${expected}`);
}

function field(t, specs, extra = {}) {
  use(t);
  const heals = [];
  const h = makeBattle({
    data: ds,
    seed: extra.seed ?? 3,
    timeLimit: extra.timeLimit ?? 30,
    autoFinish: false,
    setup(b) { b.on('heal', (c) => heals.push(c)); },
    units: specs.map((s, i) => ({
      uid: s.uid ?? i + 1,
      chessId: s.chessId ?? chessId(s.charId, !!s.elite),
      row: s.row, col: s.col,
      skillIndex: s.skillIndex ?? null,
      moduleId: s.moduleId ?? null,
    })),
  });
  h.heals = heals;
  h.battle.start();
  return h;
}

function foe(h, pos) {
  return h.spawn(ENEMY, { pos, mods: { defMul: 0, resMul: 0, speedMul: 0, hpMul: 80, atkMul: 0 } });
}

describe('regulation K4 shared kits', { concurrency: 1 }, () => {
  test('every selectable skill of the 77 is authored, and the kit is that operator', (t) => {
    use(t);
    const bad = [];
    for (const [id, charId] of OPS) {
      for (const elite of [false, true]) {
        const chess = elite ? DATA.chess[id]?.goldenId : id;
        assert.ok(DATA.chess[chess], `${charId} ${elite ? 'golden' : 'normal'}`);
        const skills = DATA.chess[chess].skills || [];
        const indexes = skills.length ? skills.map((_, i) => i) : [null];
        for (const i of indexes) {
          const def = ds.getChess(chess, { skillIndex: i });
          const key = officialKitKey(def, DATA);
          const owner = (key && KIT_CHAR_IDS[key]) || key;
          const skillId = def.skill?.id ?? '(none)';
          const src = skillSpecSource(def);
          if (owner !== charId) bad.push(`${charId} ${chess} kit ${key} owner ${owner}`);
          if ((src === 'generic' || src === 'none') && !GENERIC_OK.has(`${charId}|${skillId}`)) {
            bad.push(`${charId} ${skillId} ${elite ? 'g' : 'n'} ${src}`);
          }
        }
      }
    }
    assert.deepEqual(bad, []);
  });

  test('re-registered skills keep their authored spec, not the generic duration', (t) => {
    use(t);
    const estell = specOf(defOf('char_127_estell', 'skchr_estell_2'));
    assert.equal(estell.flags.noHeal, true);
    const ghost = specOf(defOf('char_143_ghost', 'skchr_ghost_2'));
    assert.equal(typeof ghost.onStart, 'function');
    const gravel = specOf(defOf('char_237_gravel', 'skchr_gravel_2'));
    assert.equal(gravel.spType, 'none');
    assert.equal(gravel.trigger, 'NEVER');
    const skadi = specOf(defOf('char_263_skadi', 'skchr_skadi_3'));
    assert.ok(skadi.mods.hpPct > 0 && skadi.mods.defPct > 0, 'skadi S3 mods');
    const fartth = specOf(defOf('char_430_fartth', 'skchr_fartth_3'));
    assert.equal(fartth.targeting.rangeGrid.length, COLS);
    const billro = specOf(defOf('char_426_billro', 'skchr_billro_2'));
    assert.equal(billro.kind, 'duration');
    assert.ok(Number.isFinite(billro.mods.batPct));
    const mountain = specOf(defOf('char_264_f12yin', 'skchr_f12yin_2'));
    assert.equal(mountain.kind, 'toggle');
    assert.equal(mountain.attack.hitAllBlocked, true);
    const dusk = specOf(defOf('char_2015_dusk', 'skchr_dusk_1'));
    assert.equal(dusk.kind, 'charges');
    assert.equal(dusk.attack.splashRadius, 1.7);
    const saria = specOf(defOf('char_202_demkni', 'skchr_demkni_2'));
    assert.equal(saria.kind, 'instant');
    assert.equal(saria.heal, true);
    const silver = specOf(defOf('char_1045_svash2', 'skchr_svash2_2'));
    assert.equal(silver.kind, 'charges');
    assert.equal(typeof silver.onStart, 'function');
    const pas = specOf(defOf('char_472_pasngr', 'skchr_pasngr_3'));
    assert.equal(pas.kind, 'charges');
    assert.equal(typeof pas.onStart, 'function');
    assert.equal(skillSpecSource(defOf('char_472_pasngr', 'skchr_pasngr_3', true)), 'skills');
  });

  test('trigger rows named by the lane resolve on the 规程 chess', (t) => {
    use(t);
    const rule = (charId, skillId) => defOf(charId, skillId, true).skill.trigger.rule;
    assert.equal(rule('char_469_indigo', 'skchr_indigo_1'), 'SEARCH');
    assert.equal(rule('char_469_indigo', 'skchr_indigo_2'), 'SEARCH');
    assert.equal(rule('char_472_pasngr', 'skchr_pasngr_3'), 'SP_FULL');
    assert.equal(rule('char_1039_thorn2', 'skchr_thorn2_3'), 'SEARCH');
    assert.equal(rule('char_4116_blkkgt', 'skchr_blkkgt_2'), 'SP_FULL');
    assert.equal(rule('char_4116_blkkgt', 'skchr_blkkgt_3'), 'SP_FULL');
    assert.equal(rule('char_350_surtr', 'skchr_surtr_2'), 'CUSTOM_RANGE');
    assert.equal(rule('char_350_surtr', 'skchr_surtr_3'), 'CUSTOM_RANGE');
  });

  test('妮芙 S1 and S3 are authored only while the loaded data is 规程', (t) => {
    use(t);
    const s1 = defOf('char_4146_nymph', 'skchr_nymph_1', true);
    const s3 = defOf('char_4146_nymph', 'skchr_nymph_3', true);
    const s2 = defOf('char_4146_nymph', 'skchr_nymph_2', true);
    assert.equal(skillSpecSource(s1), 'skills');
    assert.equal(skillSpecSource(s3), 'skills');
    assert.equal(skillSpecSource(s2), 'kit');
    const spec = specOf(s3);
    assert.equal(spec.mods.atkPct, s3.skill.bb.atk);
    assert.equal(spec.mods.aspd, s3.skill.bb.attack_speed);
    assert.equal(spec.attack.atkScale, s3.skill.bb['attack@split_atk_scale']);
    assert.equal(s3.skill.bb['attack@magic_atk_scale'], 0);
    setGameData(null);
    assert.equal(skillSpecSource(s1), 'generic');
    assert.equal(skillSpecSource(s3), 'generic');
    assert.equal(skillSpecSource(s2), 'kit');
  });

  test('史尔特尔 golden 余烬 gains the module attack speed; 盟约 does not', (t) => {
    const h = field(t, [{ charId: 'char_350_surtr', row: 10, col: 5, elite: true }]);
    const u = h.unit(1);
    h.b.dealDamage(null, u, { amount: 1e9, type: 'true', canDodge: false });
    const ember = u.findBuff('surtr:ember');
    assert.ok(ember, '余烬');
    assert.equal(ember.mods.aspd, 30);
    assert.equal(u.alive, true);

    setGameData(null);
    const base = makeBattle({
      seed: 3, timeLimit: 20, autoFinish: false,
      units: [{ uid: 1, chessId: 'chess_char_5_07_b', row: 10, col: 5 }],
    });
    base.battle.start();
    const s = base.unit(1);
    base.b.dealDamage(null, s, { amount: 1e9, type: 'true', canDodge: false });
    const old = s.findBuff('surtr:ember');
    assert.ok(old, '盟约 余烬');
    assert.ok(!(old.mods && old.mods.aspd), '盟约 ember has no attack speed');
  });

  test('魔王 golden motes heal an ally for heal_scale × ATK', (t) => {
    const h = field(t, [
      { charId: 'char_4134_cetsyr', row: 10, col: 5, elite: true, uid: 1 },
      { charId: 'char_127_estell', row: 10, col: 6, elite: false, uid: 2 },
    ]);
    const u = h.unit(1);
    const ally = h.unit(2);
    assert.ok(h.runUntil(() => h.heals.some((c) => c.source === u && c.target === ally && c.opts?.tags?.includes('talent')), 4), 'mote heal');
    const hit = h.heals.find((c) => c.source === u && c.target === ally && c.opts.tags.includes('talent'));
    close(hit.amount, u.s.atk * 0.3, 0.05, 'cetsyr mote heal');
  });

  test('烛煌 burn burst grants the hidden ATK buff; module 003 counters while downed and refunds SP', (t) => {
    const h = field(t, [{ charId: 'char_1040_blaze2', row: 10, col: 5, elite: true }]);
    const u = h.unit(1);
    const e = foe(h, [10, 8]);
    h.b.emit('elementBurst', { element: 'burn', target: e });
    const buff = u.findBuff('blaze2:meltAtk');
    assert.ok(buff, 'melt atk');
    assert.equal(buff.mods.atkPct, 0.1);
    close(buff.duration, 10, 1e-6, 'melt duration');

    setGameData(null);
    const base = makeBattle({
      seed: 3, timeLimit: 20, autoFinish: false,
      units: [{ uid: 1, chessId: 'chess_char_5_03_b', row: 10, col: 5 }],
      enemies: [{ key: 'enemy_1007_slime', time: 0, pos: [10, 8], mods: { hpMul: 40, atkMul: 0, speedMul: 0, resMul: 0, defMul: 0 } }],
    });
    base.battle.start();
    const old = base.unit(1);
    const foe0 = base.enemies()[0];
    if (foe0) base.b.emit('elementBurst', { element: 'burn', target: foe0 });
    assert.equal(old.findBuff('blaze2:meltAtk'), null);

    const h3 = field(t, [{ charId: 'char_1040_blaze2', row: 10, col: 5, elite: true, moduleId: 'uniequip_003_blaze2' }]);
    const b = h3.unit(1);
    const wolf = foe(h3, [10, 8]);
    const sp0 = b.skill.sp;
    h3.b.dealDamage(wolf, b, { amount: 1e9, type: 'true', canDodge: false });
    assert.equal(b.mem.downed, true);
    assert.equal(b.alive, true);
    assert.equal(wolf.stats.taken, 0, 'the downing hit is not a counter');
    const shield = b.findBuff('blaze2:downed');
    shield.shield = 0;
    b.hp = b.s.maxHp;
    const hits = [];
    h3.b.on('damaged', (c) => { if (c.target === wolf) hits.push(c); });
    h3.b.dealDamage(wolf, b, { amount: 1, type: 'true', canDodge: false });
    assert.equal(b.alive, true);
    const arts = hits.find((c) => c.type === 'arts');
    const burn = hits.find((c) => c.type === 'element');
    assert.ok(arts, 'rally arts');
    close(arts.amount, b.s.atk * 1.2, 0.05, 'rally arts');
    assert.ok(arts.dmg.tags.includes('blazeRally'));
    assert.ok(burn, 'rally burn');
    close(burn.amount, arts.amount * 0.3, 0.05, 'rally burn');
    b.hp = b.s.maxHp;
    assert.ok(h3.runUntil(() => b.mem.downed === false, 2), 'revived');
    close(b.skill.sp - sp0, 8, 0.5, 'rally sp');
  });

  test('妮芙 module 003 shortens the soul interval to the blackboard', (t) => {
    const h = field(t, [{ charId: 'char_4146_nymph', row: 10, col: 5, elite: true, moduleId: 'uniequip_003_nymph' }]);
    const u = h.unit(1);
    const e = foe(h, [10, 8]);
    h.b.addBuff(e, { key: 'apoptosisBurst', duration: 5 });
    h.b.dealDamage(u, e, { amount: 10, type: 'arts', isAttack: true, isSkill: true });
    const soul = e.findBuff(`nymph:soul:${u.id}`);
    assert.ok(soul, 'soul');
    close(soul.interval, 0.7, 1e-9, 'module interval');

    const h0 = field(t, [{ charId: 'char_4146_nymph', row: 10, col: 5, elite: true }]);
    const n = h0.unit(1);
    const e0 = foe(h0, [10, 8]);
    h0.b.addBuff(e0, { key: 'apoptosisBurst', duration: 5 });
    h0.b.dealDamage(n, e0, { amount: 10, type: 'arts', isAttack: true, isSkill: true });
    close(e0.findBuff(`nymph:soul:${n.id}`).interval, 1, 1e-9, 'base interval');
  });
});
