// The four modules of existing chess that the CN 2.7.91 operator tables (data/*.json since 4480d8cf) bring: 号角 ISW-A,
// 凛御银灰 CSR-X, 缪尔赛思 TAC-D and 溯光星源 DEC-X, each at the stage the mode fields it (tier-5 elites stage 1, tier-6
// elites stage 3), and the other loadouts of those elites staying as they were. Numbers come from the records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KITS } from '../../server/sim/content/kits/index.js';
import { MAGIC_ARCANE } from '../../server/sim/content/kits/shared/tier1.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { loadoutOptions, checkLoadout, resolveLoadout, MODULE_NONE } from '../../shared/protocol.js';
import { traitRangeExtend } from '../../shared/loadoutRecord.js';
import { chessOptions, effectiveChoice, setChoice } from '../../public/js/ui/loadoutModel.js';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const ds = getDefaultSource();
const raw = (id) => ds.rawChess(id);
const modRec = (id, m) => raw(id).modules.find((x) => x.uniEquipId === m);
/** The talent-part blackboards (talentIndex −1) of a module record, in order. */
const partsOf = (id, m) => modRec(id, m).talentChanges.filter((t) => t.talentIndex === -1).map((t) => t.bb);
const approx = (a, b, msg = '', eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} != ${b}`);
const done = (h) => { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); };
const dummy = enemyRec({ key: 'dummy', hp: 1e8, speed: 0, def: 0, res: 0, atk: 0 });
const op = (id, o = {}) => chessRec({ id, skill: null, ...o });
const statsOf = (id, m) => { const r = raw(id), a = modRec(id, m).attr; return Object.fromEntries(Object.keys(a).map((k) => [k, r.statsBase[k] + a[k]])); };

const HORN = 'chess_char_5_08_b', ISWA = 'uniequip_004_horn', FORX = 'uniequip_002_horn', FORY = 'uniequip_003_horn';
const SVASH = 'chess_char_5_14_b', CSRX = 'uniequip_002_svash2';
const MLYSS = 'chess_char_6_11_b', TACD = 'uniequip_004_mlyss', TACX = 'uniequip_002_mlyss', TACY = 'uniequip_003_mlyss';
const HALO = 'chess_char_6_16_b', DECX = 'uniequip_003_halo2', DECY = 'uniequip_002_halo2';
const WTRMAN = 'token_10030_mlyss_wtrman';

// =================================================================================================================
// 号角 ISW-A 号角特限证章 — an 集成战略 module: its stats only

test('号角 ISW-A (stage 1 on the tier-5 elite): its stats only — 军事要塞 stays the base +23 %, no FOR-X / FOR-Y part, no 集成战略 clause', () => {
  const r = raw(HORN);
  assert.equal(r.status.equipLevel, 1);
  assert.ok(loadoutOptions(raw('chess_char_5_08_a'), r).modules.includes(ISWA));
  const def = ds.getChess(HORN, { moduleId: ISWA });
  for (const [k, v] of Object.entries(statsOf(HORN, ISWA))) approx(def.stats[k], v, k);
  assert.equal(def.raw.module.id, ISWA);
  assert.equal(def.raw.module.level, 1);
  assert.equal(def.raw.trait.modeOnly, true, '特性追加 「在集成战略中…」');
  assert.equal(traitRangeExtend(def.raw), 0);
  assert.deepEqual(def.raw.talents.map((t) => [t.index, t.bb]), r.talentsBase.map((t) => [t.index, t.bb]), 'the empty talent part adds nothing');
  const fortress = r.talentsBase.find((t) => t.index === 0).bb.atk;
  const ranges = {};
  for (const moduleId of [ISWA, FORX, FORY, MODULE_NONE]) {
    const h = makeBattle({ defs: { chess: { tank: op('tank', { profession: 'TANK' }), guard: op('guard') } }, autoFinish: false,
      units: [{ uid: 1, chessId: HORN, row: 10, col: 3, moduleId }, { uid: 2, chessId: 'tank', row: 12, col: 3 }, { uid: 3, chessId: 'guard', row: 12, col: 5 }] });
    h.run(0.5);
    const u = h.unit(1), tank = h.unit(2), guard = h.unit(3);
    approx(tank.findBuff('horn:fortress').mods.atkPct, fortress, `${moduleId}: 军事要塞`);
    assert.equal(guard.findBuff('horn:fortress'), null, '重装 only');
    const blocked = u.profile.dmgMul ? u.profile.dmgMul(h.b, u, { blockedBy: tank }) : 1;
    approx(blocked, moduleId === FORX ? r.modules.find((m) => m.uniEquipId === FORX).traitOverride.bb.atk_scale : 1, `${moduleId}: ×1.1 vs blocked is FOR-X's`);
    h.run(0.5);
    assert.equal(!!u.findBuff('horn:moduleY'), moduleId === FORY, `${moduleId}: ASPD while not blocking is FOR-Y's`);
    ranges[moduleId] = u.rangeKeys.slice().sort((a, b) => a - b);
    done(h);
  }
  assert.deepEqual(ranges[ISWA], ranges[MODULE_NONE], 'no 攻击距离 from the module');
});

test('号角 ISW-A stages 2 / 3: the 集成战略 clause of its talent part stays inert (official stage-3 blackboard)', () => {
  // battle_equip_table uniequip_004_horn phase 3, horn_equip_3_3_p2 — the mode's 号角 is tier 5 (stage 1); this checks
  // that a stage-3 record (another version's tier-6 form) would not leak the 集成战略 clause either
  const IS3 = { atk: 0.3, max_hp: 0.5, ability_range_forward_extend: 1, sp: 5, sp_max: 10 };
  const kits = { chess_char_5_08_a: (bb, rec, def) => KITS.chess_char_5_08_a(bb, { ...rec, talents: [...rec.talents, { index: -1, name: null, desc: null, bb: IS3, hidden: true, fromModule: true }] }, def) };
  const h = makeBattle({ kits, defs: { chess: { tank: op('tank', { profession: 'TANK' }) } }, autoFinish: false,
    units: [{ uid: 1, chessId: HORN, row: 10, col: 3, moduleId: ISWA }, { uid: 2, chessId: 'tank', row: 12, col: 3 }] });
  h.step();
  const u = h.unit(1), tank = h.unit(2);
  assert.ok(u.skill.sp < u.skill.initSp + 1, `no 「自身立即获得5点技力」: ${u.skill.sp}`);
  h.run(0.5);
  approx(tank.findBuff('horn:fortress').mods.atkPct, raw(HORN).talentsBase.find((t) => t.index === 0).bb.atk, 'only the plain 军事要塞');
  approx(tank.s.maxHp, tank.base.maxHp, 'no 生命上限+50%');
  approx(u.s.maxHp, u.base.maxHp);
  assert.equal(u.s.baseRangeExtend || 0, 0, 'no 攻击距离+1');
  done(h);
});

// =================================================================================================================
// 凛御银灰 CSR-X 邀约 — optional (the season's default stays no module)

test('凛御银灰 CSR-X: the default stays no module, and the 干员调配 options, the server check, the match and the sim def all take the module', () => {
  const base = raw('chess_char_5_14_a'), gold = raw(SVASH), m = modRec(SVASH, CSRX);
  assert.equal(gold.module.id, null);
  assert.equal(gold.module.active, false);
  assert.ok(gold.modules.every((x) => !x.isDefault));
  const opt = loadoutOptions(base, gold);
  assert.deepEqual(opt.modules, [CSRX, MODULE_NONE]);
  assert.equal(opt.defaultModule, MODULE_NONE);
  // the 干员调配 screen (public/js/ui/loadoutModel.js): both cards, 不装备 the default; a pick is kept and sent
  assert.deepEqual(chessOptions(base, gold).moduleOptions.map((o) => [o.id, o.isDefault, o.rec?.typeName ?? null]),
    [[CSRX, false, 'CSR-X'], [MODULE_NONE, true, null]]);
  const entries = setChoice({}, base, gold, { module: CSRX });
  assert.deepEqual(entries, { chess_char_5_14_a: { module: CSRX } });
  assert.deepEqual(effectiveChoice(entries, base, gold), { skill: opt.defaultSkill, module: CSRX, changed: true });
  assert.deepEqual(setChoice(entries, base, gold, { module: MODULE_NONE }), {}, '不装备 is the default again');
  // the server's check (room.loadout) and the match's resolution (PlayerState.battleInput → PlayerBattleInput.moduleId)
  const chk = checkLoadout(entries, raw);
  assert.equal(chk.ok, true);
  assert.deepEqual(chk.loadout.chess_char_5_14_a, { skill: opt.defaultSkill, module: CSRX });
  assert.deepEqual(resolveLoadout(chk.loadout, gold, raw), { skillIndex: opt.defaultSkill, moduleId: CSRX });
  assert.deepEqual(resolveLoadout(null, gold, raw), { skillIndex: opt.defaultSkill, moduleId: MODULE_NONE });
  // the sim def (simdata getChess → shared/loadoutRecord.js loadoutRecord)
  const def = ds.getChess(SVASH, { skillIndex: opt.defaultSkill, moduleId: CSRX });
  for (const [k, v] of Object.entries(statsOf(SVASH, CSRX))) approx(def.stats[k], v, k);
  assert.deepEqual(def.raw.module, { id: CSRX, name: m.name, type: 'CSR-X', level: 1, active: true });
  assert.equal(def.raw.trait.moduleDesc, m.traitOverride.moduleDesc);
  assert.deepEqual(def.raw.talents.filter((t) => t.index === -1).map((t) => t.bb), partsOf(SVASH, CSRX));
  const none = ds.getChess(SVASH, { moduleId: MODULE_NONE });
  assert.equal(none, ds.getChess(SVASH), '不装备 = the default def');
  assert.equal(none.raw.module.active, false);
  assert.ok(!none.raw.talents.some((t) => t.index === -1));
  // 风雪之眼 resolves the module's variant (data/tokens.json byModule) — same cost as without it
  for (const t of raw(SVASH).tokens) {
    const v = ds.rawToken(t).variants[SVASH].byModule[CSRX];
    assert.ok(v, `${t}: byModule variant`);
    assert.equal(ds.getToken(t, SVASH, def.loadout).stats.cost, v.stats.cost);
    assert.equal(ds.getToken(t, SVASH, def.loadout).stats.cost, ds.getToken(t, SVASH, none.loadout).stats.cost);
  }
});

const SVASH_DEFS = { chess: {
  cheap: op('cheap', { stats: { cost: 6, respawnTime: 5 } }),
  mid: op('mid', { stats: { cost: 9, respawnTime: 5 } }),
  dear: op('dear', { profession: 'CASTER', stats: { cost: 20, respawnTime: 5 } }),
} };
function svash(moduleId, kits = undefined) {
  const h = makeBattle({ defs: SVASH_DEFS, kits, autoFinish: false, flags: { dpInit: 0, dpPerSec: 0 },
    units: [{ uid: 1, chessId: SVASH, row: 10, col: 3, moduleId }, { uid: 2, chessId: 'cheap', row: 12, col: 3 },
      { uid: 3, chessId: 'mid', row: 12, col: 5 }, { uid: 4, chessId: 'dear', row: 11, col: 7 }] });
  h.step();
  return { h, u: h.unit(1), cheap: h.unit(2), mid: h.unit(3), dear: h.unit(4) };
}

test('凛御银灰 CSR-X 特性追加: at his battle-start deployment the cheapest other operator costs 4 less at its next deployment; nothing without the module', () => {
  const cut = Math.abs(partsOf(SVASH, CSRX)[0].value);
  assert.equal(cut, 4);
  for (const moduleId of [CSRX, MODULE_NONE]) {
    const { h, u, cheap, mid, dear } = svash(moduleId);
    const c = moduleId === CSRX ? cut : 0;
    assert.deepEqual([cheap.base.cost, mid.base.cost, dear.base.cost], [6 - c, 9, 20], `${moduleId}: the cheapest of his squad`);
    // knocked out, it redeploys for the cut cost, which that deployment uses up
    h.b.dealDamage(null, cheap, { amount: 1e9, type: 'true' });
    const ps = h.b.getPlayer(u.ownerId);
    ps.dp = 6 - c;
    assert.ok(h.runUntil(() => cheap.alive && cheap.deployed, 8), `${moduleId}: redeployed with ${6 - c} DP`);
    assert.equal(ps.dp, 0);
    assert.equal(cheap.base.cost, 6, 'used up');
    // his own redeploy is no first deployment: nobody gets another cut
    h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
    h.b.redeploy(u);
    assert.ok(u.alive);
    assert.deepEqual([cheap.base.cost, mid.base.cost, dear.base.cost], [6, 9, 20]);
    done(h);
  }
});

test('凛御银灰 CSR-X stages 2 / 3 (tier-6 forms): 开放性开局 takes the composed numbers — ATK +atk with the SP left of the eye, redeploy time ×0.75 (official stage-3 blackboard)', () => {
  // battle_equip_table uniequip_002_svash2 phase 3, svash2_equip_1_3_p2 (the tier-5 elite fields stage 1, whose 开放性开局 is
  // the base talent); multiplier_max_offset has nothing to act on (the mode never raises a redeploy cost)
  const T0 = { respawn_time: 0.75, sp: 4, atk: 0.1, multiplier_max_offset: -0.25 };
  const kits = { chess_char_5_14_a: (bb, rec, def) => KITS.chess_char_5_14_a(bb, { ...rec, talents: rec.talents.map((t) => (t.index === 0 ? { ...t, bb: { ...t.bb, ...T0 } } : t)) }, def) };
  const { h, u, cheap, mid, dear } = svash(CSRX, kits);
  assert.ok(mid.base.cost < u.mem.eyeCost && u.mem.eyeCost <= dear.base.cost, 'cheap / mid left of the eye, dear right of it');
  for (const a of [u, cheap, mid]) approx(a.findBuff('svash2:open')?.mods.atkPct ?? 0, T0.atk, `${a.defId}: left of the eye / himself`);
  assert.equal(dear.findBuff('svash2:open'), null, 'right of the eye');
  h.b.dealDamage(null, mid, { amount: 1e9, type: 'true' });
  approx(mid.respawnAt - mid.deathAt, 5 * T0.respawn_time, 'redeploy time −25 %');
  assert.equal(mid.findBuff('svash2:open'), null, 'kept for that deployment only');
  done(h);
  // the shipped stage-1 record: no ATK line, redeploy time ×0.8
  const s1 = svash(CSRX);
  assert.equal(s1.u.findBuff('svash2:open'), null);
  s1.h.b.dealDamage(null, s1.mid, { amount: 1e9, type: 'true' });
  approx(s1.mid.respawnAt - s1.mid.deathAt, 5 * raw(SVASH).talentsBase[0].bb.respawn_time);
  done(s1.h);
});

// =================================================================================================================
// 缪尔赛思 TAC-D “缪尔赛思和朋友们” (stage 3)

test('缪尔赛思 TAC-D (stage 3): the composed record and the 流形 variant — ep_damage_ratio, atk_scale / sp, a 100 % copy without the +5 SP', () => {
  const r = raw(MLYSS);
  assert.equal(r.status.equipLevel, 3);
  const def = ds.getChess(MLYSS, { moduleId: TACD });
  for (const [k, v] of Object.entries(statsOf(MLYSS, TACD))) approx(def.stats[k], v, k);
  const parts = partsOf(MLYSS, TACD);
  assert.deepEqual(def.raw.talents.filter((t) => t.index === -1).map((t) => t.bb), parts);
  assert.equal(parts.find((b) => 'ep_damage_ratio' in b).ep_damage_ratio, 0.12);
  assert.deepEqual(parts.find((b) => 'atk_scale' in b), { atk_scale: 4, sp: 80 });
  const tokTalents = (loadout) => ds.getToken(WTRMAN, MLYSS, loadout).talents.map((t) => t.bb);
  const scale = (loadout) => tokTalents(loadout).find((b) => Number.isFinite(b.scale)).scale;
  assert.equal(scale(def.loadout), 1, '复制全部（100%）属性');
  assert.equal(scale(ds.getChess(MLYSS, { moduleId: MODULE_NONE }).loadout), 0.9);
  assert.ok(!tokTalents(def.loadout).some((b) => Number.isFinite(b.sp) || Number.isFinite(b.damage_scale)), 'no TAC-X token parts');
});

/** 缪尔赛思 (uid 1) at 10,3 facing right (her range: rows 9–11, columns 3–6), her 流形 piece (uid 9) at `tok`. */
function mlyss(moduleId, { tok = [12, 8], extra = [], chess = {} } = {}) {
  const h = makeBattle({ seed: 7, autoFinish: false, hooks: ['damaged', 'spGain'], captureNoisy: true,
    defs: { enemies: { dummy }, chess: { guard: op('guard', { stats: { atk: 800, def: 100 } }), ...chess } },
    units: [{ uid: 1, chessId: MLYSS, row: 10, col: 3, moduleId }, { uid: 2, chessId: 'guard', row: 9, col: 5 },
      ...extra, { uid: 9, kind: 'token', tokenId: WTRMAN, row: tok[0], col: tok[1], ownerUid: 1 }] });
  h.step();
  return { h, u: h.unit(1), guard: h.unit(2), tok: h.b.allyUnits.find((t) => t.defId === WTRMAN && t.alive) };
}

test('缪尔赛思 TAC-D 特性追加: every damage she or her 流形 deals adds 12 % of it as 侵蚀损伤; other operators and the other modules add none', () => {
  const ratio = partsOf(MLYSS, TACD).find((b) => 'ep_damage_ratio' in b).ep_damage_ratio;
  for (const moduleId of [TACD, TACX, TACY, MODULE_NONE]) {
    const { h, u, guard, tok } = mlyss(moduleId);
    assert.ok(tok, '流形 on the field');
    const k = moduleId === TACD ? ratio : 0;
    const e = h.spawn('dummy', { pos: [10, 5] });
    const fills = (src) => h.hooksOf('damaged').filter((c) => c.type === 'element' && c.target === e && c.source === src);
    const a = h.b.dealDamage(u, e, { amount: 1000, type: 'arts' });
    approx(e.elem.erosion, a * k, `${moduleId}: her damage`);
    const b = h.b.dealDamage(tok, e, { amount: 500, type: 'phys' });
    approx(e.elem.erosion, (a + b) * k, `${moduleId}: the 流形's`);
    assert.equal(fills(tok).length, k ? 1 : 0, 'the 流形 is the source of its own rider');
    h.b.dealDamage(guard, e, { amount: 1000, type: 'phys' });
    h.b.dealDamage(u, e, { amount: 1000, type: 'elemental' });
    approx(e.elem.erosion, (a + b) * k, 'no rider on another operator\'s damage nor on 元素伤害');
    done(h);
  }
});

test('缪尔赛思 TAC-D 净水即生命: an enemy whose 侵蚀 bursts in her or a 流形\'s range takes atk_scale × her ATK 元素伤害 and the 流形 gains sp SP', () => {
  const { atk_scale: scale, sp } = partsOf(MLYSS, TACD).find((b) => 'atk_scale' in b);
  for (const moduleId of [TACD, TACX, MODULE_NONE]) {
    const { h, u, tok } = mlyss(moduleId);
    const on = moduleId === TACD;
    const inHer = h.spawn('dummy', { pos: [10, 5] }), inTok = h.spawn('dummy', { pos: [12, 8] }), far = h.spawn('dummy', { pos: [12, 12] });
    const hits = (e) => h.hooksOf('damaged').filter((c) => c.target === e && c.source === u && (c.dmg?.tags || []).includes('mlyss:burst'));
    for (const [e, inRange] of [[inHer, true], [inTok, true], [far, false]]) {
      tok.skill.setSpTotal(0); // (its copy skill starts nearly full: 95 / 100)
      h.b.dealDamage(null, e, { amount: e.gaugeMax, type: 'element', element: 'erosion' });
      assert.ok(e.findBuff('erosionBurst'), 'burst');
      const hit = on && inRange;
      assert.equal(hits(e).length, hit ? 1 : 0, `${moduleId}: follow-up`);
      if (hit) { assert.equal(hits(e)[0].type, 'elemental'); approx(hits(e)[0].amount, u.s.atk * scale); }
      approx(tok.skill.spTotal, hit ? sp : 0, `${moduleId}: the 流形's SP`);
    }
    done(h);
  }
});

test('缪尔赛思 TAC-D: copying a 莱茵生命 operator gives her no 开源节流 SP (the 80 SP belong to the 流形), and the 流形 copies 100 %', () => {
  const rhine = { rh: op('rh', { charId: 'char_108_silent', stats: { atk: 700 } }) };
  const tacy = partsOf(MLYSS, TACY).find((b) => 'sp' in b).sp;
  for (const [moduleId, sp, scale] of [[TACD, 0, 1], [TACY, tacy, 0.9]]) {
    // the 流形 copies the operator nearest to it: the 莱茵生命 one beside it, not the guard two tiles away
    const { h, u, tok } = mlyss(moduleId, { tok: [11, 5], chess: rhine, extra: [{ uid: 3, chessId: 'rh', row: 11, col: 6 }] });
    assert.ok(h.runUntil(() => tok.mem.mlyss, 10), 'copied');
    const src = h.unit(3);
    assert.equal(tok.mem.mlyss.from, src.id);
    approx(tok.base.atk, src.base.atk * scale, `${moduleId}: copy scale`);
    const gains = h.hooksOf('spGain').filter((c) => c.unit === u && c.reason === 'talent').map((c) => c.amount);
    assert.deepEqual(gains, sp ? [sp] : [], `${moduleId}: her talent SP`);
    done(h);
  }
});

// =================================================================================================================
// 溯光星源 DEC-X 远方问候 (stage 3)

test('溯光星源 DEC-X (stage 3): 能源解析 takes the module numbers — 脆弱 damage_scale, raised to damage_scale_max after interval s (potential chain kept)', () => {
  const m = modRec(HALO, DECX), up = m.talentChanges.find((t) => t.talentIndex === 1);
  assert.equal(raw(HALO).status.equipLevel, 3);
  const def = ds.getChess(HALO, { moduleId: DECX });
  for (const [k, v] of Object.entries(statsOf(HALO, DECX))) approx(def.stats[k], v, k);
  assert.deepEqual(def.talents[1].bb, up.bb);
  assert.deepEqual(ds.getChess(HALO, { moduleId: DECX, potential: 1 }).talents[1].bb, up.potBelow.bb);
  const t1 = up.bb, base = raw(HALO).talentsBase.find((t) => t.index === 1).bb;
  for (const [moduleId, bb] of [[DECX, t1], [DECY, base], [MODULE_NONE, base]]) {
    const h = makeBattle({ defs: { enemies: { dummy } }, autoFinish: false, units: [{ uid: 1, chessId: HALO, row: 10, col: 4, moduleId }] });
    const e = h.spawn('dummy', { pos: [10, 6] });
    const iv = bb['halo2_t_1[weak].interval'];
    h.run(iv - 0.3);
    approx(e.s.dmgTakenMul, bb['halo2_t_1[weak].damage_scale'], `${moduleId}: before ${iv} s`);
    h.run(0.8);
    approx(e.s.dmgTakenMul, bb['halo2_t_1[weak].damage_scale_max'], `${moduleId}: after ${iv} s`);
    done(h);
  }
});

test('溯光星源 DEC-X 能源解析: 术法充盈 on her and the operators of the 4 tiles around (one effect, 同名效果取最高), arts damage only, while she is on the field', () => {
  const part = modRec(HALO, DECX).talentChanges.find((t) => t.talentIndex === -1 && 'damage_scale' in t.bb);
  const v = part.bb.damage_scale;
  assert.equal(part.rangeGrid.length, 5, 'x-5');
  for (const moduleId of [DECX, DECY, MODULE_NONE]) {
    const h = makeBattle({ defs: { enemies: { dummy }, chess: { a: op('a', { profession: 'CASTER' }), b: op('b'), c: op('c') } }, autoFinish: false,
      units: [{ uid: 1, chessId: HALO, row: 10, col: 4, moduleId }, { uid: 5, chessId: HALO, row: 12, col: 4, moduleId },
        { uid: 2, chessId: 'a', row: 11, col: 4 }, { uid: 3, chessId: 'b', row: 10, col: 3 }, { uid: 4, chessId: 'c', row: 12, col: 7 }] });
    h.run(0.5);
    const u = h.unit(1), a = h.unit(2), b = h.unit(3), c = h.unit(4);
    const want = moduleId === DECX ? v : 1;
    for (const x of [u, a, b]) approx(x.s.artsDealtMul, want, `${moduleId}: ${x.defId}`);
    assert.equal(c.s.artsDealtMul, 1, 'two tiles away');
    assert.equal(a.buffs.filter((x) => x.key === MAGIC_ARCANE).length, moduleId === DECX ? 1 : 0, 'one effect from both 溯光星源');
    const e = h.spawn('dummy', { pos: [9, 15] });
    approx(h.b.dealDamage(a, e, { amount: 1000, type: 'arts' }), 1000 * want, 'arts damage dealt');
    approx(h.b.dealDamage(a, e, { amount: 1000, type: 'phys' }), 1000, 'physical damage untouched');
    h.b.retreat(u, { permanent: true });
    h.b.retreat(h.unit(5), { permanent: true });
    h.run(0.5);
    approx(a.s.artsDealtMul, 1, 'gone with her');
    done(h);
  }
});

test('溯光星源 DEC-X 特性追加: +0.2 SP/s of natural recovery while an enemy is in her range; not without one, not on the other modules', () => {
  const spUp = partsOf(HALO, DECX).find((b) => 'sp_recovery_per_sec' in b).sp_recovery_per_sec;
  for (const [moduleId, enemy, rate] of [[DECX, true, 1 + spUp], [DECX, false, 1], [DECY, true, 1], [MODULE_NONE, true, 1]]) {
    const h = makeBattle({ defs: { enemies: { dummy } }, autoFinish: false, units: [{ uid: 1, chessId: HALO, row: 10, col: 4, moduleId }] });
    if (enemy) h.spawn('dummy', { pos: [10, 6] });
    const u = h.unit(1);
    h.run(0.5);
    const sp0 = u.skill.sp;
    h.run(2);
    assert.equal(u.skill.activations, 0);
    approx(u.skill.sp - sp0, 2 * rate * u.s.spRecovery, `${moduleId} ${enemy ? 'enemy in range' : 'no enemy'}`, 0.02);
    done(h);
  }
});
