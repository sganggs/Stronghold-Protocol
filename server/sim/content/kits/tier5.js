// server/sim/content/kits/tier5.js — hand-authored kits for every tier-5 chess (DESIGN §7, docs/SIM.md §7.2).
//
// export default { [baseChessId]: (bb, chess, def) => Kit }. `bb` = skill blackboard at the chess's level (normal Lv4 /
// elite Lv7), `chess` = data/chess.json record (talents with their own bb — elite records already carry the module talent
// upgrades — trait.bb incl. the module trait upgrade, stats, tokens), `def` = normalised def (skill.rangeGrid, …).
// Every number comes from those blackboards; the few constants below exist only in the skill TEXT (no blackboard key).
//
// Conventions shared by the kits of this file:
// - `base_attack_time` in skill blackboards is an absolute delta in seconds (AK attribute ADDITION: 烛煌 1.6 s − 1.3 s,
//   号角 2.8 s − 1.2 s, 白面鸮 2.85 s − 1.8 s, 寒檀 2.9 s − 2.4 s); it is converted into `batPct` of the chess's base BAT.
// - 元素伤害 (elemental HP damage, not a gauge) is the engine DamageInfo type 'elemental' (no DEF/RES/dodge,
//   × elementalTakenMul = 元素脆弱), with `element` set for the client colour.
// - Mechanics missing from the chess text follow the PRTS 备注 of the base operator (verified 2026-09-28): 号角 S3 overload
//   is the second half of the 24 s duration; 圣约送葬人's extra attack consumes no ammo; 夕 S1 splash 1.7; 烛煌 revive stun
//   radius 1.7, S3 splash 1.7 and its refilled ammo capped at the skill's ammo; 寒檀 icicles splash 1.5 and cycle left
//   row → right row → own row; 失重 = weight −1 level; 魔王 motes orbit at 1.15 (30°/s, hit radius 0.4); 铃兰 T2 is an
//   aura (sluggish enemies in range are 脆弱 while sluggish); 缇缇's chain sleep picks the highest-aggro enemy within
//   1.5; 乌尔比安 lands on the anchor tile > the tile beyond > his own tile; 引星棘刺 throws at the farthest forward tile
//   when no enemy is in range; 夕 T2 summons only on a deployable target tile.
// - Non-stacking auras refresh a short buff with a fixed key every 0.25 s while the source is on the field.
//   SP auras ("同类效果取最高") share the buff key `aura:spRecovery` (mods.spRecoveryFlat): the highest value wins.
// - Skills whose auto-cast needs a condition the engine rules can't express use the NEVER trigger (CUSTOM_RANGE with an
//   empty grid) plus their own activation — 塞雷娅 S2 (`autoCast`: an injured ally in the heal area of the skill; her
//   initial range is her own tile), 华法琳 (heal target below half HP, checked right before the heal). 塞雷娅 S1 (自动触发)
//   uses the engine's DEFAULT rule with `allies` / `hpAtMost` (about to attack + an ally of the skill area at ≤ half HP:
//   the heal replaces that attack). Every other
//   kit keeps the data rule (tools/build-data.mjs resolveTrigger, the official 技能策略: DEFAULT = about to attack + an
//   enemy in the INITIAL range; SKILL_RANGE for a MANUAL skill's own 技能范围; the class rows — 重装 TAKE_DAMAGE … — for
//   every MANUAL skill; AUTO skills never take a class row).
// - fx kinds emitted (battle.fx(kind, {x, y, id, …})): 'aoe' {r, skill}, 'healAoe' {r}, 'summon' {token}, 'anchor'
//   {fromX, fromY, r}, 'teleport', 'zone' {r, duration}, 'iceSpike' {r}, 'extraAttack', 'downed', 'revive' {r},
//   'overload', 'ember', 'bloodBattle', 'reborn', 'candle', 'wake' {scale}, 'mote', 'hpShare', 'crit',
//   'meltdown', 'soul', 'sleepGuard', 'weightless'; engine kinds used: 'dodge'.

import { COLS } from '../../constants.js';
import { bodyInKeys, bodyInRadius, bodyKeys } from '../../body.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../targeting.js';
import { frontOf, rotateOffset, toLocal } from '../../dir.js';
import { mitigate, hasHp, isHpLoss } from '../../damage.js';

// ---- text-only constants (the official blackboards carry no key for these) --------------------------------------
/** 华法琳 S1 "只当目标生命值不满一半时才会触发"; 塞雷娅 S1 "血量小于等于一半"; 山 module "生命值高于50%时". */
const HALF_HP = 0.5;
/** 夕 S1 "下一次攻击溅射范围扩大" — expanded splash radius (tiles; the splash-caster default is 1.1). PRTS: "溅射半径扩大至1.7". */
const DUSK_SPLASH_RADIUS = 1.7;
/** 隐德来希 S3 "每次攻击对心烛至少造成35%攻击力的伤害". */
const CANDLE_MIN_ATK = 0.35;
/** 隐德来希 S3 心烛 enemy key (hidden talent bbStr take_extra_enemy_key; not in data/enemies.json). */
const CANDLE_KEY = 'enemy_5601_entlec';
/** 烛煌 绝处重燃 "使附近的敌人晕眩" radius (tiles). PRTS 备注: 1.7. */
const NEARBY_RADIUS = 1.7;
/** 烛煌 S3 "攻击变为群体攻击": splash radius around the target (tiles). PRTS 技能3 备注 "攻击溅射半径1.7". */
const BLAZE_S3_SPLASH = 1.7;
/** 玛恩纳 游侠 "周围存在3名及以上敌人" radius (8-neighbourhood). */
const AROUND_RADIUS = 1.5;
/** 安洁莉娜 S3 失重: weight (massLevel) reduction while weightless. PRTS: "重量下降一个等级". */
const WEIGHTLESS_MASS = 1;
/** 寒檀 S2 icicle splash radius (PRTS 备注 "冰凌溅射半径1.5"). */
const ICICLE_RADIUS = 1.5;
/** 寒檀 S2 icicle fall time (s) between the attack and the impact. [ASSUMED] */
const ICICLE_DELAY = 0.3;
/** 寒檀 S2 icicle lines, lateral offsets in her facing-RIGHT frame: ① the line on her left, ② on her right, ③ her own, then ①. */
const ICICLE_ROWS = [1, -1, 0];
/** 魔王 T1 微尘: collision radius of one mote (PRTS 备注 0.4); orbit radius / speed come from the talent bb. */
const MOTE_HIT_RADIUS = 0.4;
/**
 * Abyssal Hunters (【深海猎人】 = character_table groupId `abyssal`; data/chess.json has no groupId, the charIds come from
 * docs/research/03-operators.json): 幽灵鲨, 斯卡蒂, 歌蕾蒂娅, 乌尔比安, 归溟幽灵鲨. 浊心斯卡蒂 (char_1012_skadi2) has groupId
 * null in the official data — she is NOT an Abyssal Hunter for these talents.
 */
const ABYSSAL = new Set(['char_143_ghost', 'char_263_skadi', 'char_474_glady', 'char_4145_ulpia', 'char_1023_ghost2']);
/** Never auto-fires (CUSTOM_RANGE with an empty trigger grid): the kit activates the skill itself. */
const NEVER = Object.freeze({ rule: 'CUSTOM_RANGE', grid: Object.freeze([]) });
const AURA_IV = 0.25;
const AURA_DUR = 0.5;
// alternate skills (loadouts) — text-only numbers
/** "周围" (8-neighbourhood) as a radius: 隐德来希 S2 血镰, 缇缇 S2 sleep ward, 乌尔比安 S1 anchor, 引星棘刺 S3 area. */
const RING1 = 1.5;
/** 夕 S3 "攻击范围与溅射范围扩大" — the expanded splash radius, the same 1.7 as S1 (PRTS). [ASSUMED for S3] */
const DUSK_S3_SPLASH = DUSK_SPLASH_RADIUS;
/** 号角 S2 过载: the second half of the ammo (PRTS 备注 of S3 "技能进行到一半时"; S2 counts shots). [ASSUMED] */
const HORN_S2_OVERLOAD_AT = 0.5;

// ---- helpers ------------------------------------------------------------------------------------------------------
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const on = (u) => !!u && u.alive && u.deployed && !u.removed;
/** In the unit's current range: an ally by its tile, an enemy by its body (a huge one's every tile — sim/body.js). */
const inRange = (unit, x) => !!unit.rangeKeySet && bodyInKeys(x, unit.rangeKeySet);
const talent = (chess, i) => (chess?.talents || []).find((t) => t && t.index === i)?.bb ?? {};
const talentRec = (chess, i) => (chess?.talents || []).find((t) => t && t.index === i) ?? null;
const traitBb = (chess) => chess?.trait?.bb ?? {};
const skillGrid = (chess, def) => def?.skill?.rangeGrid ?? chess?.skill?.rangeGrid ?? null;
const maxCharges = (chess, def) => num(def?.skill?.maxCharges, num(chess?.skill?.maxChargeTime, 1));
/** Blackboard `base_attack_time` (seconds) → batPct of this chess's base attack time. */
const batPct = (sec, chess) => { const b = num(chess?.stats?.bat, 1) || 1; const v = num(sec) / b; return v ? Math.max(-0.9, v) : 0; };
/** Drop zero / non-finite entries (a zero mod is noise in the buff list). */
const mods = (m) => { const o = {}; for (const k of Object.keys(m)) { const v = m[k]; if (typeof v === 'number' && Number.isFinite(v) && v !== 0) o[k] = v; } return o; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const nationOf = (u) => u?.def?.raw?.nationId ?? null;
const inFaction = (u, bond, nations) => !!u?.def && ((u.def.bonds || []).includes(bond) || nations.includes(nationOf(u)));
const isLaterano = (u) => inFaction(u, 'lateranoShip', ['laterano']);
const isKazimierz = (u) => inFaction(u, 'kazimierzShip', ['kazimierz']);
const isKjerag = (u) => inFaction(u, 'kjeragShip', ['kjerag']);
const isSargonMinos = (u) => inFaction(u, 'sargonShip', ['sargon', 'minos']);
const isAbyssal = (u) => u?.def?.raw?.groupId === 'abyssal' || ABYSSAL.has(u?.def?.charId);
const isOp = (u) => u && u.kind === 'op';

// ---- operator loadouts (DESIGN §16) -------------------------------------------------------------------------------
// A kit function is resolved per SELECTED skill: `bb` / `chess.skill` / `def.skill` are the selected skill's. The default
// skill keeps its `skill` spec; every other selectable skill is a `skills[skillId]` entry. Kit `install` / talents run
// under every skill, so default-skill machinery in them is guarded by the selected skill id (`sid`).
/** Id of the selected skill of a chess record / def. */
const selectedId = (chess, def) => chess?.skill?.skillId ?? def?.skill?.id ?? null;
/** `skills` map whose entries are built only when read (each spec is a function of the SELECTED skill's bb). */
function lazySkills(builders) {
  const o = {};
  for (const [id, build] of Object.entries(builders)) Object.defineProperty(o, id, { enumerable: true, get: build });
  return o;
}
/** Spec kind of an instant skill (charges when the selected skill can charge). */
const instantKind = (chess, def) => (maxCharges(chess, def) > 1 ? 'charges' : 'instant');
/** Skill-range targeting override of the selected skill (undefined without a skill range). */
const skillRange = (chess, def, extra = null) => {
  const g = skillGrid(chess, def);
  return g || extra ? { ...(g ? { rangeGrid: g } : {}), ...(extra || {}) } : undefined;
};
/** "攻击范围内存在N名及以上敌人时攻击速度+X" (modules REA-Y). */
function crowdAspd(battle, unit, key, aspd, cnt) {
  if (!aspd || !(cnt > 0)) return;
  whileOn(battle, unit, 0.2, () => {
    if (battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile).length >= cnt) battle.addBuff(unit, { key, duration: 0.3, mods: { aspd } });
  });
}
/** "攻击范围内存在元素损伤爆发的敌人时，技力自然恢复速度+X/秒" (modules PRI-Y). */
function burstSpUp(battle, unit, key, sp) {
  if (!(sp > 0)) return;
  whileOn(battle, unit, AURA_IV, () => {
    if (battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).some((e) => e.s.flags.burstLock)) battle.addBuff(unit, { key, duration: AURA_DUR, mods: { spRecoveryFlat: sp } });
  });
}
/** "攻击范围内存在敌人时，技力自然恢复速度+X/秒" (modules DEC-X). */
function enemySpUp(battle, unit, key, sp) {
  if (!(sp > 0)) return;
  whileOn(battle, unit, AURA_IV, () => {
    if (battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).length) battle.addBuff(unit, { key, duration: AURA_DUR, mods: { spRecoveryFlat: sp } });
  });
}

/** First living deployed ally with the same operator (charId) — used to keep same-name talents from stacking. */
function leaderOf(battle, unit) {
  const cid = unit.def?.charId;
  for (const a of battle.allyUnits) if (on(a) && a.def?.charId === cid) return a;
  return null;
}

/** Enemy `e` attacks `t` in melee (not a ranged shot), mirroring ai.js enemyAttack. */
function meleeAttacker(e, t) {
  const melee = e.profile?.melee ?? e.def?.applyWay === 'MELEE';
  const r = num(e.base?.rangeRadius, 0);
  return melee || !(r > 0) || (e.blockedBy === t && r < 1);
}

/** Enemy not moving along its route (blocked, stunned, rooted, waiting…). */
const isStill = (e) => !!(e.blockedBy || !e.moving || e.s.flags.stun || e.s.flags.noMove || !(e.s.moveSpeed > 0));

/** Elemental HP damage (元素伤害): engine type 'elemental' (× elementalTakenMul in the pipeline, never trueTakenMul). */
function elementHit(battle, src, tgt, amount, tag, element = null) {
  if (!tgt || !tgt.alive || !(amount > 0)) return 0;
  return battle.dealDamage(src, tgt, { amount, type: 'elemental', element, canDodge: false, tags: ['element', tag] });
}

/**
 * Activate the unit's skill whenever it is ready and `cond()` holds (NEVER-trigger skills). Consecutive casts of a
 * multi-charge skill are spaced by at least one attack interval (like the attack-driven DEFAULT rule).
 */
function autoCast(battle, unit, cond) {
  battle.on('tick', () => {
    const sk = unit.skill;
    if (!sk || sk.noSkill || !on(unit) || !unit.canAct || !sk.ready || unit.s.flags.silence) return;
    if (sk.active && sk.isTimed) return;
    if (battle.time - sk.lastStart < unit.s.interval - 1e-9) return;
    if (cond()) sk.activate('DEFAULT');
  }, { owner: unit });
}

/** Periodic check while the unit is on the field. */
function whileOn(battle, unit, sec, fn) {
  battle.every(sec, () => { if (on(unit)) fn(); }, { owner: unit });
}

/** "同类效果取最高" SP-recovery aura: refresh `aura:spRecovery` on matching allies unless a higher one is present. */
function spAura(battle, unit, value, filter) {
  if (!(value > 0)) return;
  whileOn(battle, unit, AURA_IV, () => {
    for (const a of battle.alliesFor(unit)) {
      if (!filter(a)) continue;
      const cur = a.findBuff('aura:spRecovery');
      if (cur && num(cur.mods?.spRecoveryFlat) > value + 1e-9) continue;
      battle.addBuff(a, { key: 'aura:spRecovery', duration: AURA_DUR, mods: { spRecoveryFlat: value } });
    }
  });
}

/** Module PRI-X (本源术师): damage vs enemies in an element burst ×damage_scale. */
function burstDamageUp(battle, unit, mul) {
  if (!(mul > 1)) return;
  battle.on('hit', (c) => {
    if (c.source !== unit || !c.target || c.target.side !== 'enemy' || c.dmg.type === 'element') return;
    if (c.target.s.flags.burstLock) c.dmg.mul *= mul;
  }, { owner: unit });
}

/** Modules PHY-X / GUA-X: heals on allies below hp_ratio ×heal_scale. */
function lowHpHealUp(battle, unit, tb) {
  const mul = num(tb.heal_scale), thr = num(tb.hp_ratio);
  if (!(mul > 1) || !(thr > 0)) return;
  battle.on('heal', (c) => {
    if (c.source !== unit || c.opts?.regen || !c.target || c.target.side !== 'ally') return;
    if (c.target.hpRatio < thr) c.amount *= mul;
  }, { owner: unit });
}

/**
 * Modules "攻击范围扩大" (夕 SPC-X, 白面鸮 RIN-X): the range becomes the SELECTED module's own grid — the data's
 * range-only talent change (talentIndex −1), e.g. SPC-X = the 3×3 caster range + ONE centre tile [0,3] — like tier4's
 * 莫斯提马 / 莱恩哈特 / 白面鸮 (integration review: a flat forward +1 added a whole column, 3 tiles, and widened the skill
 * ranges too). It replaces the unit's own range, so the DEFAULT trigger's initial range follows; skills with their own
 * range keep it. Without such a grid in the data: one extra forward tile [ASSUMED].
 */
function moduleRangeUp(battle, unit, chess) {
  if (!chess?.isGolden || !/攻击范围扩大/.test(String(chess?.trait?.moduleDesc ?? ''))) return;
  const m = chess.module;
  const rec = m && m.active && m.id ? (chess.modules || []).find((x) => x && x.uniEquipId === m.id) : null;
  const g = (rec?.talentChanges || []).find((t) => t && t.talentIndex === -1 && Array.isArray(t.rangeGrid) && t.rangeGrid.length)?.rangeGrid;
  if (g) {
    unit.rangeGrid = g.map((p) => [p[0], p[1]]);
    battle.refreshRange(unit);
    return;
  }
  // a permanent (persist, never-expiring) rangeExtend: the engine counts it in the initial range of the DEFAULT skill
  // trigger ("敌人进入初始攻击范围") as well
  battle.addBuff(unit, { key: 't5:moduleRange', mods: { rangeExtend: 1 }, persist: true, allowDead: true });
}

/** Permanent (talent) stat buff that survives death/redeploy. */
function permBuff(battle, unit, key, m) {
  const mm = mods(m);
  if (Object.keys(mm).length) battle.addBuff(unit, { key, mods: mm, persist: true, allowDead: true });
}

/** Enemies inside an absolute-key grid of `grid` offsets around `unit` (best targets first). */
function enemiesInGrid(battle, unit, grid, n = 0, { ignoreStealth = false } = {}) {
  const keys = absoluteRangeKeys(grid || unit.rangeGrid || [[0, 0]], unit.tileR, unit.tileC, unit.dir, 0);
  let list;
  if (ignoreStealth) {
    const set = new Set(keys);
    list = battle.enemies.filter((e) => e.alive && !e.hidden && e.deployed && !e.s.flags.untargetable && bodyInKeys(e, set));
  } else list = battle.enemiesInKeys(keys, unit, { canHitFly: true });
  sortEnemyTargets(battle, unit, list, null);
  return n > 0 && list.length > n ? list.slice(0, n) : list;
}

/** Straight-road length through each tile (max of the horizontal and vertical runs of ground-passable tiles). */
const ROAD_CACHE = new WeakMap();
function straightRun(battle, r, c) {
  let m = ROAD_CACHE.get(battle);
  if (!m) {
    m = new Map();
    const g = battle.grid, R = battle.rect;
    const pass = (rr, cc) => g.groundPassable(rr, cc, true);
    for (let rr = R.r0; rr <= R.r1; rr++) {
      for (let cc = R.c0; cc <= R.c1; cc++) {
        if (!pass(rr, cc)) continue;
        let h = 1, v = 1;
        for (let k = cc - 1; k >= R.c0 && pass(rr, k); k--) h++;
        for (let k = cc + 1; k <= R.c1 && pass(rr, k); k++) h++;
        for (let k = rr - 1; k >= R.r0 && pass(k, cc); k--) v++;
        for (let k = rr + 1; k <= R.r1 && pass(k, cc); k++) v++;
        m.set(rr * COLS + cc, Math.max(h, v));
      }
    }
    ROAD_CACHE.set(battle, m);
  }
  return m.get(r * COLS + c) ?? 0;
}

// ==================================================================================================================
// kits

const KITS = {
  // ---------------------------------------------------------------------------------------------------------------
  // 圣约送葬人 — S2 近身铳斗 (ammo, attack SP): ATK/DEF +, block +1, melee hits dodged with prob (+ammo refill).
  // T1 受选之人: extra attack chance (+prob_add per ammo spent in the skill). T2 铳弹共感: +ammo per Laterano op.
  // S1 遗嘱执行 (ammo 8, attack SP): skill range, ATK +, ignores def_penetrate_fixed DEF.
  // S3 圣约决裁 (ammo 16): skill range, BAT +0.5 s, ATK +; +attack@atk ATK per bullet spent (≤ attack@max_stack_cnt),
  // reaper self-heal ×trait_ratio; at the end every enemy attacked during the skill takes attack@final_atk_scale × ATK phys.
  // Module REA-Y (elite): ASPD +12 with ≥ 2 enemies in range.
  chess_char_5_01_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tm = talent(chess, -1);
    const sid = selectedId(chess, def);
    const prob = num(bb.prob), refill = num(bb.recover_cnt, 1);
    return {
      skills: lazySkills({
        skchr_excu2_1: () => ({
          kind: 'ammo', ammo: num(bb['attack@trigger_time'], 8),
          mods: mods({ atkPct: num(bb.atk), defIgnoreFlat: num(bb.def_penetrate_fixed) }),
          targeting: skillRange(chess, def),
        }),
        skchr_excu2_3: () => ({
          kind: 'ammo', ammo: num(bb['attack@trigger_time'], 16),
          mods: mods({ atkPct: num(bb.atk), batPct: batPct(bb.base_attack_time, chess) }),
          targeting: skillRange(chess, def),
          attack: { onEachHit({ unit, target }) { if (target && target.side === 'enemy') unit.mem.verdict?.add(target); } },
          onStart({ unit }) {
            unit.mem.verdict = new Set();
            // 特性的回复生命效果提高至2倍 (the reaper profile reads profile.selfHeal on every attack)
            if (unit.profile) { unit.mem.verdictHeal0 ??= num(unit.profile.selfHeal, 50); unit.profile.selfHeal = unit.mem.verdictHeal0 * num(bb.trait_ratio, 1); }
          },
          onEnd({ battle, unit }) {
            const hit = unit.mem.verdict;
            unit.mem.verdict = null;
            if (unit.profile && unit.mem.verdictHeal0 != null) unit.profile.selfHeal = unit.mem.verdictHeal0;
            if (hit && unit.alive) {
              for (const e of hit) {
                if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb['attack@final_atk_scale']), type: 'phys', isSkill: true, tags: ['skill', 'verdict'] });
              }
              battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id, r: 1.5, skill: 'excu2' });
            }
            battle.removeBuff(unit, 'excu2:verdict');
          },
        }),
      }),
      skill: {
        kind: 'ammo', ammo: num(bb['attack@trigger_time'], 12),
        mods: mods({ atkPct: num(bb.atk), defPct: num(bb.def), blockCnt: num(bb.block_cnt) }),
      },
      // REA-Y: its trait part is DISPLAY-only (official battle_equip_table uniequip_003_excu2: target DISPLAY, the ASPD
      // text "{value}" = 12; the ASPD rider itself is the talent −1 part). data/chess.json merges that display blackboard
      // into trait.bb ({value: 12}), which the reaper profile would read as its per-hit heal: the heal stays the base
      // trait's (50).
      trait: tm['trigger_cnt[equip]'] != null && chess?.traitBase?.bb?.value != null ? { selfHeal: num(chess.traitBase.bb.value, 50) } : undefined,
      talents: [
        { install(battle, unit) { // 受选之人
          let spent = 0;
          const reset = (c) => { if (c.unit === unit) spent = 0; };
          battle.on('skillStart', reset, { owner: unit });
          battle.on('skillEnd', reset, { owner: unit });
          battle.on('ammoUsed', (c) => { if (c.unit === unit) spent++; }, { owner: unit });
          // PRTS 备注: "触发时可额外回复1点攻击回复技力，不额外消耗弹药" — the extra attack is an attack (attack SP, trait
          // heal) but consumes no ammo (engine forceAttack `noAmmo`: no bullet, no ammoUsed for any listener — the
          // 7-bullet 特质 counter, items, bonds and the prob_add counter above)
          battle.on('attack', (c) => {
            if (c.attacker !== unit || unit.mem.extraAttack || !on(unit)) return;
            const p = num(t0.prob) + (unit.skill?.active ? num(t0.prob_add) * spent : 0);
            if (!(p > 0) || !battle.rng.chance(Math.min(1, p))) return;
            const dep = unit.deploySeq;
            battle.after(0, () => {
              if (!on(unit) || unit.deploySeq !== dep || !unit.canAct || unit.s.flags.disarm) return;
              unit.mem.extraAttack = true;
              let hit = false;
              try { hit = battle.forceAttack(unit, null, { noAmmo: true }); } finally { unit.mem.extraAttack = false; }
              if (hit) battle.fx('extraAttack', { x: unit.x, y: unit.y, id: unit.id });
            }, { owner: unit });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 铳弹共感
          battle.on('skillStart', (c) => {
            if (c.unit !== unit || c.skill.kind !== 'ammo') return;
            const n = battle.allies().filter((a) => isOp(a) && isLaterano(a)).length;
            const stacks = Math.min(num(t1.add_count_max_stack, 4), n);
            if (stacks > 0) c.skill.addAmmo(stacks * num(t1.add_count, 1));
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        crowdAspd(battle, unit, 'excu2:module', num(tm.attack_speed), num(tm['trigger_cnt[equip]']));
        if (sid === 'skchr_excu2_3') { // S3: +attack@atk ATK per bullet spent
          battle.on('ammoUsed', (c) => {
            if (c.unit !== unit || !unit.skill?.active) return;
            battle.addBuff(unit, { key: 'excu2:verdict', refresh: 'stack', maxStacks: Math.max(1, num(bb['attack@max_stack_cnt'], 30)), mods: mods({ atkPct: num(bb['attack@atk']) }) });
          }, { owner: unit });
        }
        if (sid && sid !== 'skchr_excu2_2') return;
        // S2: melee attacks dodged with `prob`, each dodge refills ammo
        battle.on('hit', (c) => {
          if (c.target !== unit || !unit.skill?.active || !c.source || c.source.side !== 'enemy' || !c.dmg.isAttack) return;
          if (!meleeAttacker(c.source, unit) || !(prob > 0) || !battle.rng.chance(prob)) return;
          c.dmg.cancel = true;
          battle.fx('dodge', { x: unit.x, y: unit.y, id: unit.id });
          // a dodge like the engine's (listeners of the `dodge` hook — items/bonds — see it too)
          if (battle.hasHook('dodge')) battle.emit('dodge', { source: c.source, target: unit, dmg: c.dmg });
          unit.skill.addAmmo(refill);
        }, { owner: unit });
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 缇缇 — S3 旧日绽放 (25 s): ATK +, 2 targets, sleeps non-sleeping targets; during the skill every enemy waking up (or
  // knocked out asleep) takes arts damage growing with the sleep time (linear min_atk_scale → max_atk_scale over `sleep` s,
  // PRTS 备注) and sends the highest-aggro enemy within range_radius to sleep; other allies in range fall asleep (小睡)
  // instead of dying. T1 凝固的时光: can attack sleeping enemies, +15 % ATK arts vs non-moving
  // enemies, sleeping enemies take 30 % ATK arts/s. T2 勇气的报偿: Sargon/Minos ops above 50 % HP get +20 ASPD.
  // S1 缓蚀 (duration): ATK +, attack@prob chance per attack to sleep the target attack@sleep s.
  // S2 封护 (duration): no attacks, ATK +; she and the lowest-HP-ratio operator in her range sleep until the skill ends
  // (沉睡 = invulnerable), enemies around either of them keep falling asleep; T1 ×talent_scale.
  chess_char_5_02_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1);
    const sid = selectedId(chess, def);
    const hitSleep = num(bb['attack@sleep'], num(bb.sleep, 5));
    const minS = num(bb.min_atk_scale, 1), maxS = num(bb.max_atk_scale, minS);
    const chainSleep = num(bb.sleep, hitSleep), radius = num(bb.range_radius, 1.5), chainN = Math.max(1, num(bb.max_target, 1));
    // S2 封护: "第一天赋效果提升至N倍" while it runs
    const t0Scale = (unit) => (sid === 'skchr_titi_2' && unit.skill?.active ? num(bb.talent_scale, 1) : 1);
    const ward = (battle, unit, a) => {
      const entered = !a.buffs.some((b) => (b.status ?? b.key) === 'sleep');
      battle.addBuff(a, { key: 'titi:ward', flags: { sleep: true }, visible: true, status: 'sleep', data: { src: unit } });
      battle.releaseBlocked(a);
      if (battle.hasHook('statusApplied')) battle.emit('statusApplied', { source: unit, target: a, status: 'sleep', duration: Infinity, entered });
    };
    return {
      skills: lazySkills({
        skchr_titi_1: () => ({
          kind: 'duration', mods: mods({ atkPct: num(bb.atk) }),
          attack: {
            onHit({ battle, unit, target }) {
              if (!target || !target.alive || target.s.flags.sleep || !battle.rng.chance(num(bb['attack@prob']))) return;
              battle.applyStatus(target, 'sleep', { duration: num(bb['attack@sleep']), source: unit });
            },
          },
        }),
        skchr_titi_2: () => ({
          kind: 'duration', mods: mods({ atkPct: num(bb.atk) }),
          attack: { noAttack: true },
          onStart({ battle, unit }) {
            const pick = battle.alliesInGrid(unit).filter((a) => a !== unit && isOp(a) && a.hp > 0)
              .sort((a, b) => a.hpRatio - b.hpRatio || a.id - b.id)[0] ?? null;
            unit.mem.titiWard = pick ? [unit, pick] : [unit];
            for (const a of unit.mem.titiWard) ward(battle, unit, a);
            unit.mem.titiWardAcc = AURA_IV;
            battle.fx('sleepGuard', { x: unit.x, y: unit.y, id: unit.id });
          },
          onTick({ battle, unit, dt }) {
            unit.mem.titiWardAcc += dt;
            if (unit.mem.titiWardAcc < AURA_IV - 1e-9) return;
            unit.mem.titiWardAcc = 0;
            for (const a of unit.mem.titiWard || []) {
              if (!a.alive || !a.deployed || !a.findBuff('titi:ward')) continue;
              for (const e of battle.foesInRadius(a.x, a.y, RING1)) if (e.alive) battle.applyStatus(e, 'sleep', { duration: AURA_DUR, source: unit });
            }
          },
          onEnd({ battle, unit }) {
            for (const a of unit.mem.titiWard || []) {
              const b = a.findBuff('titi:ward');
              if (b && b.data.src === unit) battle.removeBuff(a, b);
            }
            unit.mem.titiWard = null;
          },
        }),
      }),
      trait: { hitSleep: true }, // 凝固的时光 (a): she targets and damages sleeping enemies (沉睡 = 无敌 for everyone else)
      skill: {
        kind: 'duration',
        mods: mods({ atkPct: num(bb.atk) }),
        attack: {
          maxTargets: Math.max(1, num(bb['attack@max_target'], 2)),
          onHit({ battle, unit, target }) {
            if (!target || !target.alive || target.s.flags.sleep) return;
            battle.applyStatus(target, 'sleep', { duration: hitSleep, source: unit });
          },
        },
        onEnd({ battle, unit }) {
          for (const a of battle.allyUnits) {
            const b = a.findBuff('titi:allySleep');
            if (b && b.data.src === unit) battle.removeBuff(a, b);
          }
        },
      },
      talents: [
        { install(battle, unit) { // 凝固的时光 — (a) is the `hitSleep` trait above
          // (b) +extra_atk_scale arts vs non-moving enemies
          battle.on('damaged', (c) => {
            if (c.source !== unit || !c.dmg?.isAttack || c.dmg.isSplash || c.type === 'element') return;
            const e = c.target;
            if (e.side !== 'enemy' || !e.alive || !isStill(e)) return;
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(t0.extra_atk_scale) * t0Scale(unit), type: 'arts', tags: ['talent', 'titiStill'] });
          }, { owner: unit });
          // (c) sleeping enemies take damage_atk_scale × ATK arts per second
          whileOn(battle, unit, 1, () => {
            const amount = unit.s.atk * num(t0.damage_atk_scale) * t0Scale(unit);
            for (const e of battle.enemies) {
              if (e.alive && !e.hidden && e.s.flags.sleep) battle.dealDamage(unit, e, { amount, type: 'arts', tags: ['talent', 'titiDream'] });
            }
          });
        } },
        { install(battle, unit) { // 勇气的报偿: 精力充沛
          whileOn(battle, unit, AURA_IV, () => {
            for (const a of battle.allies()) {
              if (isOp(a) && isSargonMinos(a) && a.hpRatio > num(t1.hp_ratio, 0.5)) battle.addBuff(a, { key: 'titi:vigor', duration: AURA_DUR, mods: { aspd: num(t1.attack_speed) } });
            }
          });
        } },
      ],
      install(battle, unit) {
        if (sid && sid !== 'skchr_titi_3') return;
        // S3: wake-up burst chain (sleep applied by anyone counts)
        const asleep = new Map();
        // PRTS 备注: "向1.5半径内除该单位外仇恨值最高的敌方单位施加沉睡" — highest aggro (taunt) first, then the nearest
        const sleepOthers = (from) => {
          const cands = battle.foesInRadius(from.x, from.y, radius).filter((o) => o !== from && !o.s.flags.sleep && !o.mem?.candleOwner)
            .sort((a, b) => (b.s.taunt || 0) - (a.s.taunt || 0) || dist(a, from) - dist(b, from) || a.spawnSeq - b.spawnSeq);
          let n = 0;
          for (const o of cands) {
            if (n >= chainN) break;
            if (battle.applyStatus(o, 'sleep', { duration: chainSleep, source: unit })) n++;
          }
        };
        battle.on('statusApplied', (c) => {
          if (c.status === 'sleep' && c.target.side === 'enemy' && !asleep.has(c.target)) asleep.set(c.target, battle.time);
        }, { owner: unit });
        battle.on('tick', () => {
          if (!asleep.size) return;
          for (const [e, t0s] of asleep) {
            if (!e.alive) { asleep.delete(e); continue; }
            if (e.s.flags.sleep) continue;
            asleep.delete(e);
            if (!unit.skill?.active || !on(unit)) continue;
            const scale = minS + (maxS - minS) * Math.min(1, (battle.time - t0s) / Math.max(0.1, chainSleep));
            battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', isSkill: true, tags: ['skill', 'titiWake'] });
            battle.fx('wake', { x: e.x, y: e.y, id: e.id, scale: Math.round(scale * 100) / 100 });
            sleepOthers(e);
          }
        }, { owner: unit });
        battle.on('kill', (c) => {
          const v = c.victim;
          if (v.side !== 'enemy' || !asleep.has(v)) return;
          asleep.delete(v);
          if (unit.skill?.active && on(unit)) sleepOthers(v);
        }, { owner: unit });
        // S3: other allies in range fall asleep instead of dying, until healed to full or the skill ends
        battle.on('fatal', (c) => {
          const a = c.unit;
          if (c.prevented || a.side !== 'ally' || a === unit) return;
          const guard = a.findBuff('titi:allySleep');
          if (guard) { if (guard.data.src === unit) c.prevented = true; return; }
          if (!isOp(a) || !unit.skill?.active || !on(unit) || !unit.rangeKeySet?.has(a.tileR * COLS + a.tileC)) return;
          c.prevented = true;
          const entered = !a.buffs.some((b) => (b.status ?? b.key) === 'sleep');
          battle.addBuff(a, {
            key: 'titi:allySleep', flags: { sleep: true }, visible: true, status: 'sleep', data: { src: unit }, interval: 0.2,
            onTick: ({ unit: x, buff }) => { if (x.hp >= x.s.maxHp - 1e-6) battle.removeBuff(x, buff); },
          });
          // other content (特质 "干员进入沉睡时") observes it like any sleep status
          if (battle.hasHook('statusApplied')) battle.emit('statusApplied', { source: unit, target: a, status: 'sleep', duration: Infinity, entered });
          battle.fx('sleepGuard', { x: a.x, y: a.y, id: a.id });
        }, { owner: unit, priority: 5 });
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 烛煌 — S3 众恶的焚场 (ammo): skill range 4-11 (the targets; the DEFAULT cast still needs an enemy in 3-1), ATK +,
  // BAT −1.3 s, "攻击变为群体攻击" = one target + a BLAZE_S3_SPLASH (1.7) splash around it (PRTS 备注 "攻击溅射半径1.7",
  // 中点判定 — so the fire reaches past the diamond; it used to hit every enemy inside it instead, community report E1
  // after 0.1.0), +attack@atk_scale ATK elemental damage to every enemy of the attack in a burn burst (main and splash),
  // dealt BEFORE the attack's own damage ("于攻击造成伤害前判定元素爆发并造成元素伤害": a 'hit' hook — so a hit that kills
  // or starts the burst keeps / does not get it); loses 3 % max HP/s; any burn burst on the field refills ammo_recover
  // bullets, never above the skill's ammo ("补充后的弹药数量无法超过上限"). Each landed bolt shows its splash (fx 'splash' r 1.7).
  // T1 熔点引爆: burn burst anywhere → 350 % ATK elemental damage to it + heal 12 % max HP. T2 绝处重燃: downed instead of
  // dying (6000 shield, no attack, no heal, 3 %/s regen) → revives at full HP and stuns nearby enemies.
  // Module (elite): ×damage_scale vs enemies in an element burst.
  // S1 炙手之援 (instant): the operator with the highest max HP in her range carries a fire aura for max_duration s —
  // every `interval` s the enemies within range_radius of it take atk_scale × her ATK arts + element_multiplier × that
  // damage as 灼燃损伤. S2 沸血燎原 (duration): skill range, BAT +0.9 s, ATK +, 3 targets; each attack costs
  // attack@hp_ratio of her max HP and leaves a burning tile under every target: ground enemies on it move −50 % and take
  // atk_scale × ATK arts + element_damage_scale × that as 灼燃损伤 per second (the tiles burn until the skill ends
  // [ASSUMED: no duration in the data]). Module PRI-Y (elite): SP +0.2/s while an enemy in range is in an element burst.
  chess_char_5_03_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess), tm = talent(chess, -1);
    const sid = selectedId(chess, def);
    const lose = num(bb.lose_hp_scale);
    const burnTiles = (battle, unit) => {
      const tiles = unit.mem.blazeTiles;
      if (!tiles || !tiles.size) return;
      unit.mem.blazeAcc2 = (unit.mem.blazeAcc2 ?? 0) + AURA_IV;
      const dmgTick = unit.mem.blazeAcc2 >= 1 - 1e-9;
      if (dmgTick) unit.mem.blazeAcc2 -= 1;
      for (const e of battle.enemies) {
        if (!e.alive || e.hidden || e.isFlying || !bodyInKeys(e, tiles)) continue;
        battle.addBuff(e, { key: `blaze2:ground:${unit.id}`, duration: AURA_DUR, mods: { moveMul: Math.max(0, 1 + num(bb.move_speed)) } });
        if (!dmgTick) continue;
        const d = battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'arts', isSkill: true, tags: ['skill', 'blazeGround'] });
        if (d > 0 && e.alive) battle.dealDamage(unit, e, { type: 'element', element: 'burn', amount: d * num(bb.element_damage_scale), tags: ['skill', 'blazeGround'] });
      }
    };
    return {
      skills: lazySkills({
        skchr_blaze2_1: () => ({
          kind: instantKind(chess, def),
          onStart({ battle, unit }) {
            const t = battle.alliesInGrid(unit).filter((a) => isOp(a)).sort((a, b) => b.s.maxHp - a.s.maxHp || a.id - b.id)[0];
            if (!t) return;
            const r = num(bb.range_radius, 1.5);
            battle.addBuff(t, {
              key: `blaze2:aid:${unit.id}`, duration: num(bb.max_duration, 20), interval: Math.max(0.1, num(bb.interval, 1)), visible: true, data: { src: unit },
              onTick: ({ unit: x }) => {
                for (const e of battle.foesInRadius(x.x, x.y, r)) {
                  const d = battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'arts', isSkill: true, tags: ['skill', 'blazeAid'] });
                  if (d > 0 && e.alive) battle.dealDamage(unit, e, { type: 'element', element: 'burn', amount: d * num(bb.element_multiplier), tags: ['skill', 'blazeAid'] });
                }
              },
            });
            battle.fx('aoe', { x: t.x, y: t.y, id: unit.id, r, skill: 'blaze2Aid' });
          },
        }),
        skchr_blaze2_2: () => ({
          kind: 'duration',
          mods: mods({ atkPct: num(bb.atk), batPct: batPct(bb.base_attack_time, chess) }),
          targeting: skillRange(chess, def, { maxTargets: Math.max(1, num(bb['attack@max_target'], 3)) }),
          attack: {
            onEachHit({ unit, target }) {
              if (target && target.side === 'enemy') unit.mem.blazeTiles?.add(Math.round(target.y) * COLS + Math.round(target.x));
            },
          },
          onStart({ unit }) { unit.mem.blazeTiles = new Set(); unit.mem.blazeAcc2 = 0; },
          onAttack({ battle, unit }) { battle.loseHp(unit, unit.s.maxHp * num(bb['attack@hp_ratio']), { source: unit }); },
          onEnd({ unit }) { unit.mem.blazeTiles = null; },
        }),
      }),
      skill: {
        kind: 'ammo', ammo: num(bb['attack@trigger_time'], 18),
        mods: mods({ atkPct: num(bb.atk), batPct: batPct(bb.base_attack_time, chess) }),
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
        attack: {
          splashRadius: BLAZE_S3_SPLASH,
          // the fire of each landed bolt (the screen rings splash attacks by sub-profession; 本源术师 is not one): once
          // per attack at the main target / its spot — from the profile it was fired with, so the last bolt too
          onHit({ battle, unit, target, x, y }) {
            battle.fx('splash', { x, y, ...(target && target.alive ? { id: target.id } : {}), src: unit.id, r: BLAZE_S3_SPLASH, element: 'burn' });
          },
        },
        onStart({ unit }) { unit.mem.blazeAcc = 0; },
        onTick({ battle, unit, dt }) {
          if (!(lose > 0)) return;
          unit.mem.blazeAcc = (unit.mem.blazeAcc ?? 0) + dt;
          while (unit.mem.blazeAcc >= 1 && unit.alive) {
            unit.mem.blazeAcc -= 1;
            battle.loseHp(unit, unit.s.maxHp * lose, { source: unit });
          }
        },
      },
      talents: [
        { install(battle, unit) { // 熔点引爆
          battle.on('elementBurst', (c) => {
            if (c.element !== 'burn' || !on(unit) || c.target.side !== 'enemy') return;
            elementHit(battle, unit, c.target, unit.s.atk * num(t0.ep_damage_scale), 'blazeMelt', 'burn');
            // 绝处重燃: "倒地期间…无法被治疗" — the meltdown heal does not reach her while downed
            if (!unit.mem.downed) battle.heal(unit, unit, unit.s.maxHp * num(t0.hp_ratio), { self: true });
            battle.fx('meltdown', { x: c.target.x, y: c.target.y, id: c.target.id });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 绝处重燃
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.downed = false; }, { owner: unit });
          battle.on('fatal', (c) => {
            if (c.unit !== unit || c.prevented || unit.mem.downed) return;
            c.prevented = true;
            unit.mem.downed = true;
            if (unit.skill?.active) unit.skill.end('downed');
            battle.releaseBlocked(unit);
            const dep = unit.deploySeq;
            battle.addBuff(unit, {
              key: 'blaze2:downed', visible: true, shield: num(t1.dynamic), interval: 0.2,
              flags: { disarm: true, noHeal: true },
              mods: mods({ hpRegenRatio: num(t1.hp_recovery_per_sec_by_max_hp_ratio), blockCnt: -99 }),
              onTick: ({ unit: u, buff }) => {
                if (u.deploySeq !== dep || u.hp < u.s.maxHp - 1e-6) return;
                battle.removeBuff(u, buff);
                u.mem.downed = false;
                for (const e of battle.foesInRadius(u.x, u.y, NEARBY_RADIUS)) if (e.alive) battle.applyStatus(e, 'stun', { duration: num(t1.stun), source: u });
                battle.fx('revive', { x: u.x, y: u.y, id: u.id, r: NEARBY_RADIUS });
              },
            });
            battle.fx('downed', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit, priority: -50 });
        } },
      ],
      install(battle, unit) {
        burstDamageUp(battle, unit, num(tb.damage_scale));
        burstSpUp(battle, unit, 'blaze2:module', num(tm.sp_recovery_per_sec));
        if (sid === 'skchr_blaze2_2') whileOn(battle, unit, AURA_IV, () => burnTiles(battle, unit));
        if (sid && sid !== 'skchr_blaze2_3') return;
        // S3: each hit of her skill attack (main and splash) on an enemy in a burn burst deals the bonus first (PRTS 备注).
        // Gated on the attack's own isSkill (captured when the bolt was fired), not on the live skill: her bolts land after
        // the last bullet's end('ammo') / an early end (downed), and those still carry it. Only S3 runs here (sid gate).
        battle.on('hit', (c) => {
          const d = c.dmg, t = c.target;
          if (c.source !== unit || !d.isAttack || !d.isSkill || d.cancel) return;
          if (t.side === 'enemy' && t.alive && t.findBuff('burnBurst')) elementHit(battle, unit, t, unit.s.atk * num(bb['attack@atk_scale']), 'blazeBurn', 'burn');
        }, { owner: unit });
        const maxAmmo = num(bb['attack@trigger_time'], 18);
        battle.on('elementBurst', (c) => { // S3: burn bursts refill ammo, up to the skill's ammo
          const sk = unit.skill;
          if (c.element !== 'burn' || !sk?.active || sk.kind !== 'ammo' || !on(unit)) return;
          const n = Math.min(num(bb.ammo_recover), maxAmmo - sk.ammoLeft);
          if (n > 0) sk.addAmmo(n);
        }, { owner: unit });
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 华法琳 — S1 紧急包扎 (charges, attack SP): the next heal on a target below half HP adds hp_ratio × its max HP.
  // T1 血液样本回收: an enemy dying in range → +2 SP to herself and to a random ally in range.
  // Module (elite): heals on allies below 50 % ×1.15.
  chess_char_5_04_a: (bb, chess) => {
    const t0 = talent(chess, 0), tb = traitBb(chess);
    const ratio = num(bb.hp_ratio);
    return {
      skill: {
        kind: 'charges', heal: true, trigger: NEVER,
        onStart({ unit }) { unit.mem.bldskBonus = unit.mem.bldskTarget ?? null; },
      },
      talents: [{ install(battle, unit) { // 血液样本回收
        battle.on('kill', (c) => {
          const v = c.victim;
          if (v.side !== 'enemy' || !on(unit) || !inRange(unit, v)) return;
          unit.skill?.gainSp(num(t0['bldsk_t_1[self].sp']), 'talent');
          const others = battle.alliesInGrid(unit).filter((a) => a !== unit && a.skill && !a.skill.noSkill && a.skill.kind !== 'passive');
          const pick = battle.rng.pick(others);
          if (pick) pick.skill.gainSp(num(t0['bldsk_t_1[rand].sp']), 'talent');
        }, { owner: unit });
      } }],
      install(battle, unit) {
        // the skill only fires for a heal target below half HP: checked right before the heal
        battle.on('beforeAttack', (c) => {
          if (c.attacker !== unit) return;
          unit.mem.bldskNoSp = false;
          const sk = unit.skill;
          if (!sk || !sk.ready || unit.s.flags.silence) return;
          const t = c.targets[0];
          if (!t || t.side !== 'ally' || !(t.hpRatio < HALF_HP)) return;
          unit.mem.bldskTarget = t;
          // the heal made by the skill recovers no attack SP (engine rule for skill attacks: cost N ⇒ every N+1 heals)
          if (sk.activate('DEFAULT')) unit.mem.bldskNoSp = true;
          unit.mem.bldskTarget = null;
        }, { owner: unit });
        battle.on('spGain', (c) => {
          if (c.unit !== unit || c.reason !== 'attack' || !unit.mem.bldskNoSp) return;
          unit.mem.bldskNoSp = false;
          c.amount = 0;
        }, { owner: unit, priority: 100 });
        battle.on('heal', (c) => { // merged into the same heal
          if (c.source !== unit || !unit.mem.bldskBonus || c.target !== unit.mem.bldskBonus) return;
          unit.mem.bldskBonus = null;
          // the bonus is part of the same heal: the healer's and the target's healing multipliers apply to it too
          c.amount += c.target.s.maxHp * ratio * num(unit.s.healingDealtMul, 1) * num(c.target.s.healingTakenMul, 1);
          battle.fx('healAoe', { x: c.target.x, y: c.target.y, id: c.target.id, r: 0.5 });
        }, { owner: unit, priority: 10 });
        lowHpHealUp(battle, unit, tb);
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 乌尔比安 — S3 必须开辟的通路 (25 s, CUSTOM_RANGE row ahead): max HP/ATK +, throws an anchor forward that stops on the
  // first enemy or at max distance — on his own tile while he blocks: 135 % ATK phys + 6 s stun around it
  // (projectile_range); moves onto the anchor tile when deployable and not his own (a 从不混淆的方向 marker keeps his tile)
  // and returns at skill end — both 【移动】, i.e. free redeploys (Battle.moveRedeploy; the return empties his SP).
  // T1 本性的坚守: heal 100 (160 below 50 %) on every hit taken. T2 血脉的哺养: per kill +120 max HP / +30 ATK (×9),
  // other Abyssal Hunters +50 %. Module (elite): healing received ×1.2.
  // S1 必须促成的接触 (instant): the anchor lands on the best enemy of the skill range (beyond his own range, unblocked
  // first) and drags up to max_target enemies around it (RING1) in front of him (中等力度), atk_scale × ATK phys each;
  // a 捕网 — ground enemies only ([ASSUMED] like 雪雉's "不对空" net). S3's anchor blast has no such note: it hits air
  // units too [ASSUMED].
  // S2 必须维系的界限 (toggle, 持续时间无限): T1 ×talent_scale, block +1, max HP +, ATK +.
  chess_char_5_05_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess);
    const sid = selectedId(chess, def);
    const t0Scale = sid === 'skchr_ulpia_2' ? num(bb.talent_scale, 1) : 1;
    const tokenId = chess?.skill?.overrideTokenKey ?? def?.skill?.raw?.overrideTokenKey ?? 'token_10039_ulpia_block';
    const trig = def?.skill?.trigger?.grid ?? chess?.skill?.trigger?.customRangeGrid ?? [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]];
    const reach = Math.max(1, ...trig.filter((p) => p[0] === 0).map((p) => p[1]));
    const radius = num(bb.projectile_range, 1.5);
    return {
      skills: lazySkills({
        skchr_ulpia_1: () => ({
          kind: instantKind(chess, def),
          onStart({ battle, unit }) {
            // "向前方扔出船锚": the anchor goes beyond his own reach first (pulling what he already hits is moot), then
            // unblocked ground enemies, then the usual target order
            const list = enemiesInGrid(battle, unit, skillGrid(chess, def) ?? unit.rangeGrid);
            const reach = (e) => inRange(unit, e);
            // the anchor is a 捕网 (PRTS 备注 "实际效果为捕网而非拖拽"); 雪雉's 捕网 is "不对空" (PRTS 雪雉 备注) — [ASSUMED] the same
            // for this one: it never lands on or catches air units (FLY, 近地悬浮, 浮空)
            const main = list.find((e) => !reach(e) && !e.blockedBy && !e.isFlying) ?? list.find((e) => !e.blockedBy && !e.isFlying) ?? list.find((e) => !e.isFlying);
            if (!main) return;
            const near = battle.foesInRadius(main.x, main.y, RING1).filter((e) => !e.isFlying && !e.s.flags.untargetable && !e.s.flags.sleep)
              .sort((a, b) => (a === main ? -1 : b === main ? 1 : 0) || dist(a, main) - dist(b, main) || a.spawnSeq - b.spawnSeq)
              .slice(0, Math.max(1, num(bb.max_target, 2)));
            const force = num(bb.force, 1);
            battle.fx('anchor', { x: main.x, y: main.y, id: unit.id, fromX: unit.x, fromY: unit.y, r: RING1 });
            for (const e of near) {
              // "中等力度地拖拽至面前": the 捕网's pull uses the 拖拽 rules (PRTS 推与拉 §捕网 "力的大小：同拖拽") —
              // Battle.pullToFront, the official 力度 − 重量 pull
              battle.pullToFront(e, unit, force);
              if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'phys', isSkill: true, tags: ['skill', 'anchorPull'] });
            }
          },
        }),
        skchr_ulpia_2: () => ({
          kind: 'toggle',
          mods: mods({ atkPct: num(bb.atk), hpPct: num(bb.max_hp), blockCnt: num(bb.block_cnt) }),
        }),
      }),
      skill: {
        kind: 'duration',
        mods: mods({ hpPct: num(bb.max_hp), atkPct: num(bb.atk) }),
        onStart({ battle, unit }) {
          // PRTS 备注 ② — the anchor's target: his own tile while he blocks an enemy (e.g. just after a 突袭 landing),
          // else the nearest tile ahead in the skill range (straight along his direction) with an enemy on it, else the
          // farthest one. His own tile is a candidate only while he blocks ("自身所在地块（仅阻挡敌人时）"); not taken: the
          // reading of the range's own tile (6-1 starts at [0,0]) as distance 0 for the second rule (a flyer over him)
          let stop = 0;
          if (!unit.blocking.some((e) => e.alive && e.blockedBy === unit)) {
            for (let d = 1; d <= reach; d++) {
              const [r, c] = frontOf(unit.tileR, unit.tileC, unit.dir, d);
              // the anchor stops at the field edge and in front of a ground obstacle (crates, roadblocks)
              if (!battle.grid.inRect(r, c) || battle.grid.isObstacle(r, c)) break;
              stop = d;
              if (battle.enemiesInKeys([r * COLS + c], unit, { canHitFly: true }).length) break;
            }
          }
          const [sr, sc] = frontOf(unit.tileR, unit.tileC, unit.dir, stop);
          const fromX = unit.x, fromY = unit.y;
          battle.fx('anchor', { x: sc, y: sr, id: unit.id, fromX, fromY, r: radius });
          for (const e of battle.foesInRadius(sc, sr, radius)) {
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'phys', isSkill: true, tags: ['skill', 'anchor'] });
            if (e.alive) battle.applyStatus(e, 'stun', { duration: num(bb.stun), source: unit });
          }
          // ③ 【移动】 — only a change of tile moves him and leaves the 从不混淆的方向 ("若目标地块不为当前地块，会在原地部署"): an
          // anchor on his own tile leaves him where he stands, no marker, nothing to return from [ASSUMED: the "tile one
          // beyond the landing" is not tried when the landing is his own tile]
          if (stop === 0 || !unit.alive) return;
          // PRTS 备注: landing tile > the tile one beyond it > his own tile (a deployable, free, unreserved melee tile)
          const ok = ([r, c]) => (r !== unit.tileR || c !== unit.tileC) && battle.grid.inRect(r, c) && battle.grid.canStand(r, c) && !battle.grid.isObstacle(r, c) && !battle.isReservedTile(r, c);
          const dest = [[sr, sc], frontOf(unit.tileR, unit.tileC, unit.dir, stop + 1)].find(ok);
          if (dest == null) return;
          const home = [unit.tileR, unit.tileC];
          // the 【移动】 is a redeploy on the new tile (Battle.moveRedeploy: a new deployment, deploy effects fire again,
          // no exit) that keeps the running skill — "【移动】后仅继承下列效果：技能进度、第二天赋叠加层数"; the rest of
          // his buffs are kept too (owner's deviation, DESIGN §22.3). The marker is deployed after the move (备注 ③)
          if (!battle.moveRedeploy(unit, dest[0], dest[1]) || !unit.alive || !unit.skill?.active) return;
          const marker = battle.spawnToken(unit, tokenId, home[0], home[1], { untargetable: true, kit: { skill: null, trait: { noAttack: true } } });
          unit.mem.anchorHome = { r: home[0], c: home[1], marker };
          battle.fx('teleport', { x: unit.x, y: unit.y, id: unit.id, fromX, fromY });
        },
        onEnd({ battle, unit }) {
          const h = unit.mem.anchorHome;
          unit.mem.anchorHome = null;
          if (!h) return;
          if (h.marker && h.marker.alive) battle.retreat(h.marker, { reason: 'expired', permanent: true });
          if (unit.alive && unit.deployed) {
            // ④ 【返回】: a 【移动】 back to his tile "【返回】时将清空技力，但仍可以享受后续由其他效果提供的技力" — the SP is
            // emptied before the deploy effects of the return run (迅捷作战粮, 黄沙罗盘 … still give theirs, so do skillEnd
            // effects after it: 迅捷). Here in onEnd the skill's mods are still on (skills.js end) [ASSUMED: officially the
            // return comes "技能结束后"; none of the deploy effects that can reach him reads his stats]
            const fromX = unit.x, fromY = unit.y;
            if (battle.moveRedeploy(unit, h.r, h.c, { clearSp: true })) battle.fx('teleport', { x: unit.x, y: unit.y, id: unit.id, fromX, fromY });
          }
        },
      },
      talents: [
        { install(battle, unit) { // 本性的坚守
          battle.on('damaged', (c) => {
            if (c.target !== unit || !on(unit) || unit.hp <= 0 || !(c.amount > 0) || c.type === 'element' || isHpLoss(c.dmg)) return; // (not a 流失)
            const v = (unit.hpRatio < num(t0.hp_ratio, 0.5) ? num(t0.value2) : num(t0.value1)) * (unit.skill?.active ? t0Scale : 1);
            if (v > 0) battle.heal(unit, unit, v, { self: true });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 血脉的哺养
          battle.on('kill', (c) => {
            if (c.killer !== unit || c.victim.side !== 'enemy' || !on(unit)) return;
            battle.addBuff(unit, { key: 'ulpia:blood', refresh: 'stack', maxStacks: Math.max(1, num(t1.max_stack_cnt, 9)), mods: mods({ hpFlat: num(t1.max_hp), atkFlat: num(t1.atk) }) });
            const share = mods({ hpFlat: num(t1['ulpia_t_1[abyssal].max_hp']), atkFlat: num(t1['ulpia_t_1[abyssal].atk']) });
            if (!Object.keys(share).length) return;
            for (const a of battle.allies()) {
              if (a !== unit && isOp(a) && isAbyssal(a)) battle.addBuff(a, { key: 'ulpia:bloodShare', refresh: 'stack', maxStacks: Math.max(1, num(t1['ulpia_t_1[abyssal].max_stack_cnt'], 9)), mods: share });
            }
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        if (num(tb.heal_scale) > 0) permBuff(battle, unit, 'ulpia:module', { healingTakenMul: num(tb.heal_scale) });
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 隐德来希 — S3 灵与欲的惜别 (20 s): skill range, ATK +, ASPD +100; summons a 心烛 for up to 3 highest-HP ground enemies
  // in range (60 % of their current HP, same DEF/RES); his hits on a candle deal at least 35 % ATK and the original loses
  // the same HP; only he can damage candles (other allies' attacks are redirected to the original).
  // T1 萃血: each hit steals 75 max HP (≤ 1350) and applies 200 arts/s for 5 s. T2 重盈: once below 25 % HP, heal 50 %
  // max HP and take −10 % phys damage afterwards. Reaper trait (heal per hit, module 60) comes from the profession.
  // S1 玫影觅迹 (instant, attack SP): next attack atk_scale × ATK, twice. S2 绯红壁合 (duration): no attacks; blood sickles
  // on herself and on one other ground unit (the ally with the most enemies around it) cut every enemy around them (RING1)
  // for atk_scale × ATK phys every `interval` s — ground enemies only unless the carrier has taken off (PRTS 备注).
  // Module REA-Y (elite): ASPD +12 with ≥ 2 enemies in range.
  chess_char_5_06_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess);
    const hpScale = num(bb['attack@max_hp_scale'], 0.6), defScale = num(bb['attack@def_scale'], 1), resScale = num(bb['attack@magic_resistance_scale'], 1);
    const nCandles = Math.max(1, num(bb['attack@max_target'], 3));
    const candleKey = talentRec(chess, 2)?.bbStr?.take_extra_enemy_key ?? CANDLE_KEY;
    const aroundN = (battle, a) => battle.foesInRadius(a.x, a.y, RING1).length;
    return {
      skills: lazySkills({
        skchr_etlchi_1: () => ({ kind: instantKind(chess, def), attack: { atkScale: num(bb.atk_scale, 1), hits: 2 } }),
        skchr_etlchi_2: () => ({
          kind: 'duration', attack: { noAttack: true },
          onStart({ battle, unit }) {
            const other = battle.alliesFor(unit).filter((a) => a !== unit && a.ground && a.hp > 0)
              .sort((a, b) => aroundN(battle, b) - aroundN(battle, a) || dist(a, unit) - dist(b, unit) || a.id - b.id)[0] ?? null;
            unit.mem.sickles = other ? [unit, other] : [unit];
            unit.mem.sickleAcc = 0;
            for (const a of unit.mem.sickles) battle.fx('aoe', { x: a.x, y: a.y, id: unit.id, r: RING1, skill: 'etlchiSickle' });
          },
          onTick({ battle, unit, dt }) {
            const iv = Math.max(0.1, num(bb.interval, 0.5));
            unit.mem.sickleAcc += dt;
            while (unit.mem.sickleAcc >= iv - 1e-9) {
              unit.mem.sickleAcc -= iv;
              for (const a of unit.mem.sickles || []) {
                if (!a.alive || !a.deployed) continue;
                // PRTS 备注 "被添加血镰的单位处于起飞时，血镰可对空": a sickle on the ground spares air units (FLY, 近地悬浮, 浮空);
                // 起飞 = an airborne skywalker (蒂比's skills: flag `liftoff`; still a 地面单位, so she can carry one)
                const air = !!a.s.flags.liftoff;
                for (const e of battle.foesInRadius(a.x, a.y, RING1)) {
                  if (e.isFlying && !air) continue;
                  battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'phys', isSkill: true, tags: ['skill', 'bloodSickle'] });
                }
              }
            }
          },
          onEnd({ unit }) { unit.mem.sickles = null; },
        }),
      }),
      skill: {
        kind: 'duration',
        mods: mods({ atkPct: num(bb.atk), aspd: num(bb.attack_speed) }),
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
        onStart({ battle, unit }) {
          unit.mem.candles = [];
          const picks = battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: false })
            .filter((e) => !e.isFlying && !e.mem?.candleOwner && !e.isBoss)
            .sort((a, b) => b.hp - a.hp || a.spawnSeq - b.spawnSeq).slice(0, nCandles);
          for (const e of picks) {
            const r = Math.round(e.y), c = Math.round(e.x);
            // 心烛 is not in data/enemies.json: an inline record (neutral, never attacks, never moves, not counted)
            const def = {
              name: '心烛', rank: 'NORMAL', applyWay: 'NONE', motion: 'WALK', notCountInTotal: true, lifePointReduce: 0,
              stats: { maxHp: Math.max(1, e.hp * hpScale), atk: 0, def: e.s.def * defScale, magicResistance: e.s.res * resScale, moveSpeed: 0, massLevel: num(e.base.massLevel, 1) },
            };
            const cd = battle.spawnEnemy(candleKey, {
              def, pos: [e.y, e.x], route: { motion: 'WALK', start: [r, c], end: [r, c], checkpoints: [] },
              countInTotal: false, ownerPlayerId: e.ownerId,
            });
            if (!cd) continue;
            cd.name = '心烛';
            Object.assign(cd.base, { maxHp: Math.max(1, e.hp * hpScale), atk: 0, def: e.s.def * defScale, res: e.s.res * resScale, moveSpeed: 0 });
            cd.profile = { ...(cd.profile || {}), noAttack: true };
            cd.markDirty();
            cd.hp = cd.s.maxHp;
            cd.mem.candleOwner = unit;
            cd.mem.candleOf = e;
            cd.mem.noLeak = true;                           // never a leak at the time limit (Battle._timeout)
            battle.addBuff(cd, { key: 'etlchi:candle', flags: { unblockable: true, noMove: true } });
            unit.mem.candles.push(cd);
            battle.fx('candle', { x: cd.x, y: cd.y, id: cd.id, of: e.id });
          }
        },
        onEnd({ battle, unit }) {
          for (const cd of unit.mem.candles || []) if (cd.alive) battle.kill(cd, null);
          unit.mem.candles = [];
        },
      },
      talents: [
        { install(battle, unit) { // 萃血
          const steal = num(t0['attack@steal_hp']), cap = num(t0['attack@steal_hp_max']);
          const dot = num(t0.magic_value), dotDur = num(t0.dot_duration, 5), iv = num(t0.interval, 1);
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.stolen = 0; }, { owner: unit });
          battle.on('damaged', (c) => {
            if (c.source !== unit || !c.dmg?.isAttack || c.type === 'element') return;
            const e = c.target;
            if (e.side !== 'enemy' || !e.alive || e.mem?.candleOwner || !on(unit)) return;
            if (dot > 0) {
              battle.addBuff(e, { key: `etlchi:dot:${unit.id}`, duration: dotDur, interval: iv, refresh: 'extend',
                onTick: ({ unit: x }) => battle.dealDamage(unit, x, { amount: dot, type: 'arts', tags: ['talent', 'dot'] }) });
            }
            const stolen = num(unit.mem.stolen);
            // (a boss sharing the match HP pool keeps its max HP: the pool is owned by the match)
            const n = Math.min(steal, cap - stolen, Math.floor(e.s.maxHp - 1)); // never below 1 max HP
            if (n > 0 && !e.bossPool) {
              unit.mem.stolen = stolen + n;
              // the victim keeps an explicit running total (a 'stack' refresh would rescale every stack by the last n)
              const key = `etlchi:steal:${unit.id}`;
              const lost = num(e.findBuff(key)?.data?.total) + n;
              const hp0 = e.hp;
              battle.addBuff(e, { key, mods: { hpFlat: -lost }, data: { total: lost } });
              // 偷取生命上限: the victim's current HP only drops where it exceeds the new maximum (the engine keeps ratios)
              if (e.alive) e.hp = Math.min(hp0, e.s.maxHp);
              battle.addBuff(unit, { key: 'etlchi:gain', mods: { hpFlat: unit.mem.stolen } });
            }
          }, { owner: unit });
        } },
        { install(battle, unit) { // 重盈
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.reborn = false; }, { owner: unit });
          battle.on('damaged', (c) => {
            if (c.target !== unit || unit.mem.reborn || !on(unit) || unit.hp <= 0 || !(unit.hpRatio < num(t1.hp_ratio))) return;
            unit.mem.reborn = true;
            battle.heal(unit, unit, unit.s.maxHp * num(t1['etlchi_t_2[heal].hp_ratio']), { self: true });
            if (num(t1.damage_resistance) > 0) battle.addBuff(unit, { key: 'etlchi:reborn', mods: { physTakenMul: 1 - num(t1.damage_resistance) } });
            battle.fx('reborn', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        crowdAspd(battle, unit, 'etlchi:module', num(tb.attack_speed), num(tb.cnt));
        const mine = (e) => e && e.mem && e.mem.candleOwner === unit;
        // "心烛只受隐德来希攻击的影响": other sources' element gauges never fill a candle either
        battle.on('elementHit', (c) => { if (mine(c.target) && c.source !== unit) c.dmg.cancel = true; }, { owner: unit });
        battle.on('beforeStatus', (c) => { if (mine(c.target) && c.source !== unit) c.cancel = true; }, { owner: unit });
        battle.on('hit', (c) => {
          if (!mine(c.target)) return;
          if (c.source !== unit) { c.dmg.cancel = true; return; }
          if (c.dmg.type !== 'phys' && c.dmg.type !== 'arts') return;
          const ss = unit.s;
          const mit = mitigate(c.dmg.amount, c.dmg.type, c.target.s, {
            defIgnorePct: c.dmg.defIgnorePct + ss.defIgnorePct, defIgnoreFlat: c.dmg.defIgnoreFlat + ss.defIgnoreFlat,
            resIgnorePct: c.dmg.resIgnorePct + ss.resIgnorePct, resIgnoreFlat: c.dmg.resIgnoreFlat + ss.resIgnoreFlat,
          });
          const floor = ss.atk * CANDLE_MIN_ATK;
          if (mit < floor) { c.dmg.type = 'true'; c.dmg.amount = floor; c.dmg.canDodge = false; }
        }, { owner: unit, priority: -20 });
        battle.on('damaged', (c) => {
          if (!mine(c.target) || !(c.amount > 0) || c.type === 'element') return;
          const o = c.target.mem.candleOf;
          if (o && o.alive) battle.loseHp(o, c.amount, { source: unit });
        }, { owner: unit });
        battle.on('death', (c) => { // the original fell or leaked: its candle goes out
          if (c.unit.side !== 'enemy' || c.unit.mem?.candleOwner) return;
          for (const cd of unit.mem.candles || []) if (cd.alive && cd.mem.candleOf === c.unit) battle.kill(cd, null);
        }, { owner: unit });
        battle.on('beforeAttack', (c) => { // other allies hit the original instead of the candle
          if (c.attacker === unit || c.attacker.side !== 'ally' || !(unit.mem.candles && unit.mem.candles.length)) return;
          if (!c.targets.some(mine)) return;
          const out = [];
          for (const t of c.targets) {
            if (!mine(t)) { if (!out.includes(t)) out.push(t); continue; }
            const o = t.mem.candleOf;
            if (o && o.alive && !out.includes(o) && !c.targets.includes(o)) out.push(o);
          }
          c.targets = out;
        }, { owner: unit });
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 史尔特尔 — S3 黄昏 (toggle, 持续时间无限): full heal, ATK +, range +2, 3 targets, max HP +5000 (flat), HP loss ramping
  // to 20 % max HP/s over 60 s. T1 熔火: ignores 20 RES. T2 余烬: lethal damage keeps HP ≥ 1 for 8 s (不死 + 禁疗), then she
  // withdraws.
  // Module (elite): ASPD +8 while not blocking.
  // S1 烈焰魔剑 (instant, attack SP): next attack atk_scale × ATK; a kill refills all SP at once.
  // S2 熔核巨影 (duration): ATK +, range +1, 2 targets; an attack that hits a single enemy is ×critical atk_scale.
  // Module AFT-Y (elite): the enemies she blocks are 法术脆弱 +10 %.
  chess_char_5_07_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess);
    const sid = selectedId(chess, def);
    const iv = Math.max(0.05, num(bb.interval, 0.2)), peak = num(bb.hp_ratio), ramp = Math.max(0.1, num(bb.duration, 60));
    const maxHp = num(bb.max_hp);
    return {
      skills: lazySkills({
        skchr_surtr_1: () => ({
          kind: instantKind(chess, def),
          attack: {
            atkScale: num(bb.atk_scale, 1),
            onHit({ unit, target }) {
              // 将目标击倒则立即恢复所有技力 (the skill is still pending here: the refill is the next charge)
              if (target && target.side === 'enemy' && !target.alive && unit.skill) unit.skill.gainSp(unit.skill.spCost, 'skill');
            },
          },
        }),
        skchr_surtr_2: () => ({
          kind: 'duration', mods: mods({ atkPct: num(bb.atk) }),
          targeting: mods({ rangeExtend: Math.round(num(bb.ability_range_forward_extend)), maxTargets: num(bb['attack@max_target']) }),
        }),
      }),
      skill: {
        kind: 'toggle',
        mods: mods({ atkPct: num(bb.atk), ...(Math.abs(maxHp) > 5 ? { hpFlat: maxHp } : { hpPct: maxHp }) }),
        targeting: mods({ rangeExtend: Math.round(num(bb.ability_range_forward_extend)), maxTargets: num(bb['attack@max_target']) }),
        onStart({ battle, unit }) {
          unit.mem.twilightT = 0;
          unit.mem.twilightAcc = 0;
          // "立即恢复所有生命" — PRTS 技能3 备注 "（无视禁疗）": it reaches her during 余烬 too
          battle.heal(unit, unit, unit.s.maxHp, { self: true, ignoreHealFree: true });
          battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id, r: 1, skill: 'surtr' });
        },
        onTick({ battle, unit, dt }) {
          if (!(peak > 0)) return;
          unit.mem.twilightT += dt;
          unit.mem.twilightAcc += dt;
          while (unit.mem.twilightAcc >= iv && unit.alive) {
            unit.mem.twilightAcc -= iv;
            const rate = peak * Math.min(1, unit.mem.twilightT / ramp);
            if (rate > 0) battle.loseHp(unit, unit.s.maxHp * rate * iv, { source: unit, silent: true });
          }
        },
      },
      talents: [
        { install(battle, unit) { permBuff(battle, unit, 'surtr:magma', { resIgnoreFlat: num(t0.magic_resist_penetrate_fixed) }); } },
        { install(battle, unit) { // 余烬
          // PRTS 天赋备注: "持有不死的情况下不会触发此天赋" (a 不死 that prevented the blow first: `c.prevented` — 坚固维式重锤's
          // lock, PRIO_REVIVE −100, runs after this −60 on the same first lethal blow [ASSUMED order], so it never starts
          // while 余烬 is unused). "触发本天赋后，获得禁疗与不死": 不死 = every later lethal blow is prevented (`mem.ember`);
          // 禁疗 (异常效果 HEAL_FREE "无法成为治疗类能力的目标，且受到的治疗量变为0", an HP-regen attribute excepted) = flags
          // noHeal (no heal pick, no heal from others) + healFree (her own heals too; S3's start heal "无视禁疗"), shown as
          // the status 'healFree' until she leaves. "强制退出战场视为撤回干员": a retreat (Battle.retreat drops the buff) — she
          // lies down where she stood and redeploys there, like every operator that leaves the field (PRTS 卫戍协议/帮助
          // "干员退场后…原地留下一个“倒地干员”…自动部署至该位置"; Battle.isDown, GitHub #60).
          const wait = num(t1['surtr_t_2[withdraw].interval'], 8);
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.ember = false; }, { owner: unit });
          battle.on('fatal', (c) => {
            if (c.unit !== unit || c.prevented) return;
            c.prevented = true;
            if (unit.mem.ember) return;
            unit.mem.ember = true;
            const dep = unit.deploySeq;
            battle.addBuff(unit, { key: 'surtr:ember', status: 'healFree', flags: { noHeal: true, healFree: true } });
            battle.fx('ember', { x: unit.x, y: unit.y, id: unit.id });
            battle.after(wait, () => { if (unit.alive && unit.deploySeq === dep) battle.retreat(unit, { reason: 'retreat' }); }, { owner: unit });
          }, { owner: unit, priority: -60 });
        } },
      ],
      install(battle, unit) {
        const aspd = num(tb.attack_speed);
        if (aspd) {
          whileOn(battle, unit, 0.2, () => {
            if (!unit.blocking.length) battle.addBuff(unit, { key: 'surtr:module', duration: 0.3, mods: { aspd } });
            else battle.removeBuff(unit, 'surtr:module');
          });
        }
        const fragile = num(tb.damage_scale, 1) - 1; // AFT-Y: 自身阻挡的敌人受到10%的法术脆弱效果
        if (fragile > 0) {
          whileOn(battle, unit, 0.2, () => {
            for (const e of unit.blocking) if (e.alive) battle.applyStatus(e, 'artsFragile', { duration: 0.3, value: fragile, source: unit });
          });
        }
        if (sid === 'skchr_surtr_2') { // S2: 仅攻击到一个敌人时对其攻击力提升至140%
          const solo = num(bb['attack@surtr_s_2[critical].atk_scale'], 1);
          battle.on('beforeAttack', (c) => { if (c.attacker === unit) unit.mem.surtrSolo = !!unit.skill?.active && c.targets.filter((t) => t && t.alive).length === 1; }, { owner: unit, priority: -100 });
          battle.on('hit', (c) => {
            if (c.source === unit && unit.mem.surtrSolo && unit.skill?.active && c.dmg.isAttack && !c.dmg.isSplash) c.dmg.amount *= solo;
          }, { owner: unit });
        }
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 号角 — S3 终极防线 (24 s in total, a two-segment gauge — PRTS 备注: "技能进行到一半时触发额外效果"): ATK +, BAT −1.2 s
  // for the first 12 s, then 过载 for the remaining damage_duration (12) s: ATK changes to +50 %, HP loss ramping to 12 %
  // max HP/s at the end. T1 军事要塞: all Defenders ATK +20 % while she is on the field.
  // T2 血战: once per deployment, lethal damage → full heal, max HP −50 %, ASPD +18, DEF +18 %.
  // Module (elite): ×1.1 vs blocked enemies.
  // S1 照明榴弹 (instant / 2 charges elite, 自动触发 ⇒ DEFAULT): next attack atk_scale × ATK; a ranged (unblocked) one also
  // splashes projectile_range and lights the impact for projectile_delay_time s (enemies within projectile_range lose
  // 隐匿). S2 暴风号令 (ammo 10): every attack attack@s2.atk_scale × ATK phys splash; 过载 for the second half of the
  // ammo [ASSUMED like S3]: + attack@s2.magic_atk_scale × ATK arts to every enemy hit (manual close never happens in the
  // auto battle). Module FOR-Y (elite): ASPD +10 while not blocking.
  // S2 and S3 cast with an enemy in range (data DEFAULT, rawRule TAKE_DAMAGE): the owner's deliberate deviation from the
  // official 重装 TAKE_DAMAGE row (DESIGN §21.29, tools/build-data.mjs TRIGGER_DEVIATIONS).
  chess_char_5_08_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess), tm = talent(chess, -1);
    const sid = selectedId(chess, def);
    const s2Ammo = Math.max(1, num(bb['attack@s2.trigger_time'], 10));
    const total = Math.max(0.1, num(def?.skill?.duration, num(chess?.skill?.duration, 24)));
    const ovAtk = num(bb['horn_s_3[overload_start].atk'], num(bb.atk));
    const ovIv = Math.max(0.05, num(bb['horn_s_3[overload_start].interval'], 0.2));
    const ovPeak = num(bb['horn_s_3[overload_start].hp_ratio']);
    const ovRamp = Math.max(0.1, Math.min(total, num(bb['horn_s_3[overload_start].damage_duration'], total / 2)));
    const main = total - ovRamp;
    const blockedMul = num(tb.atk_scale);
    return {
      skills: lazySkills({
        skchr_horn_1: () => ({
          kind: instantKind(chess, def), // 自动触发 "下次攻击": the data rule DEFAULT (an AUTO skill takes no 技能策略)
          attack: {
            atkScale: num(bb.atk_scale, 1),
            onHit({ battle, unit, x, y }) {
              if (!unit.mem.hornFlare) return;
              unit.mem.hornFlare = false;
              (unit.mem.flares ??= []).push({ x, y, until: battle.time + num(bb.projectile_delay_time, 6) });
              battle.fx('zone', { x, y, id: unit.id, r: num(bb.projectile_range, 1.7), duration: num(bb.projectile_delay_time, 6) });
            },
          },
        }),
        skchr_horn_2: () => ({
          kind: 'ammo', ammo: s2Ammo,
          attack: { atkScale: num(bb['attack@s2.atk_scale'], 1) },
          onStart({ unit }) { unit.mem.hornS2Over = false; },
          onEnd({ unit }) { unit.mem.hornS2Over = false; },
        }),
      }),
      skill: {
        kind: 'duration', duration: total,
        mods: mods({ atkPct: num(bb.atk), batPct: batPct(bb.base_attack_time, chess) }),
        onStart({ unit }) { unit.mem.hornT = 0; unit.mem.hornAcc = 0; unit.mem.overload = false; },
        onTick({ battle, unit, dt }) {
          unit.mem.hornT += dt;
          if (!unit.mem.overload && unit.mem.hornT >= main - 1e-9) {
            unit.mem.overload = true;
            const delta = ovAtk - num(bb.atk);
            battle.addBuff(unit, { key: 'horn:overload', visible: true, mods: mods({ atkPct: delta }) });
            battle.fx('overload', { x: unit.x, y: unit.y, id: unit.id });
          }
          if (!unit.mem.overload || !(ovPeak > 0)) return;
          unit.mem.hornAcc += dt;
          while (unit.mem.hornAcc >= ovIv && unit.alive) {
            unit.mem.hornAcc -= ovIv;
            const rate = ovPeak * Math.min(1, (unit.mem.hornT - main) / ovRamp);
            if (rate > 0) battle.loseHp(unit, unit.s.maxHp * rate * ovIv, { source: unit, silent: true });
          }
        },
        onEnd({ battle, unit }) { unit.mem.overload = false; battle.removeBuff(unit, 'horn:overload'); },
      },
      trait: blockedMul > 1 ? { dmgMul: (b, u, t) => (t && t.blockedBy ? blockedMul : 1) } : undefined,
      talents: [
        { install(battle, unit) { // 军事要塞
          const atk = num(t0.atk);
          if (!atk) return;
          whileOn(battle, unit, AURA_IV, () => {
            for (const a of battle.allies()) if (isOp(a) && a.def?.profession === 'TANK') battle.addBuff(a, { key: 'horn:fortress', duration: AURA_DUR, mods: { atkPct: atk } });
          });
        } },
        { install(battle, unit) { // 血战
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.bloodBattle = false; }, { owner: unit });
          battle.on('fatal', (c) => {
            if (c.unit !== unit || c.prevented || unit.mem.bloodBattle) return;
            c.prevented = true;
            unit.mem.bloodBattle = true;
            battle.addBuff(unit, { key: 'horn:bloodBattle', visible: true, mods: mods({ hpMul: 1 - num(t1.max_hp), aspd: num(t1.attack_speed), defPct: num(t1.def) }) });
            unit.hp = Math.max(1, unit.hp);
            battle.heal(unit, unit, unit.s.maxHp * num(t1.hp_ratio, 1), { self: true });
            battle.fx('bloodBattle', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit, priority: -40 });
        } },
      ],
      install(battle, unit) {
        const aspd = num(tm.attack_speed); // FOR-Y: 不阻挡敌人时…攻击速度+10
        if (aspd) whileOn(battle, unit, 0.2, () => { if (!unit.blocking.length) battle.addBuff(unit, { key: 'horn:moduleY', duration: 0.3, mods: { aspd } }); });
        if (sid === 'skchr_horn_1') {
          // the pending shot: a ranged (unblocked) attack widens its splash and lights the impact
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !unit.skill?.pending || !c.profile) return;
            unit.mem.hornFlare = !c.profile._fortressMelee;
            if (unit.mem.hornFlare) c.profile.splashRadius = Math.max(num(c.profile.splashRadius), num(bb.projectile_range, 1.7));
          }, { owner: unit, priority: -100 });
          battle.every(AURA_IV, () => {
            const fl = unit.mem.flares;
            if (!fl || !fl.length) return;
            unit.mem.flares = fl.filter((f) => f.until > battle.time + 1e-9);
            const r = num(bb.projectile_range, 1.7);
            for (const f of unit.mem.flares) for (const e of battle.enemies) {
              if (e.alive && !e.hidden && bodyInRadius(e, f.x, f.y, r)) battle.applyStatus(e, 'reveal', { duration: AURA_DUR, source: unit });
            }
          }, { owner: unit });
        }
        if (sid === 'skchr_horn_2') {
          const magic = num(bb['attack@s2.magic_atk_scale']);
          battle.on('beforeAttack', (c) => { // 过载: the second half of the ammo
            if (c.attacker !== unit || !unit.skill?.active || !c.profile) return;
            const shot = s2Ammo - num(unit.skill.ammoLeft) + 1;
            const over = shot > s2Ammo * HORN_S2_OVERLOAD_AT + 1e-9;
            if (over && !unit.mem.hornS2Over) battle.fx('overload', { x: unit.x, y: unit.y, id: unit.id });
            unit.mem.hornS2Over = over;
            if (!over || !(magic > 0)) return;
            // decided at the shot (a shell still in flight when the skill ends keeps it): the effective profile of this
            // attack (a per-attack copy while the skill runs) carries the extra arts splash on every enemy it hits
            const prev = c.profile.onEachHit;
            c.profile.onEachHit = (b, u, victim, hc) => {
              if (prev) prev(b, u, victim, hc);
              if (victim && victim.alive && victim.side === 'enemy') b.dealDamage(unit, victim, { amount: unit.s.atk * magic, type: 'arts', isSkill: true, isSplash: true, tags: ['skill', 'hornOverload'] });
            };
          }, { owner: unit, priority: -100 });
        }
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 魔王 — bard (aura heal 10 % ATK/s). S3 编织重构现世 (30 s): skill range, aura 65 %, motes never vanish, other allies in
  // range get 鼓舞 = +65 % of her max HP, HP of everyone in range is equalised every 2 s.
  // T1 过往尘埃: 3 motes orbit her; one colliding with an operator vanishes and gives it ×1.5 aura healing for 6 s, then
  // respawns after 6 s.
  // T2 魔王残响: allies take −10 % damage from Sarkaz enemies. Module (elite): ≥2 other ops in range → ATK +8 %.
  chess_char_5_09_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess), tm = talent(chess, -1);
    const baseRatio = num(tb['attack@atk_to_hp_recovery_ratio'], 0.1);
    const skillRatio = num(bb['attack@atk_to_hp_recovery_ratio'], baseRatio);
    const inspire = num(bb.max_hp);
    const shareIv = Math.max(0.1, num(bb['attack@cetsyr_s_3[cal_hp_ratio].interval'], 2));
    const inspireAll = (battle, unit) => {
      if (!(inspire > 0)) return;
      const hp = unit.s.maxHp * inspire;
      for (const a of battle.alliesInGrid(unit)) {
        if (a !== unit) battle.addBuff(a, { key: 'cetsyr:inspire', duration: AURA_DUR, visible: true, status: 'inspire', mods: { hpFlat: hp }, data: { src: unit } });
      }
    };
    return {
      skill: {
        kind: 'duration',
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
        onStart({ battle, unit }) {
          if (unit.profile) unit.profile.auraRatio = skillRatio;
          unit.mem.shareAcc = 0;
          unit.mem.inspireAcc = 0;
          inspireAll(battle, unit);
          battle.fx('healAoe', { x: unit.x, y: unit.y, id: unit.id, r: 2.5 });
        },
        onTick({ battle, unit, dt }) {
          unit.mem.inspireAcc += dt;
          if (unit.mem.inspireAcc >= AURA_IV) { unit.mem.inspireAcc = 0; inspireAll(battle, unit); }
          unit.mem.shareAcc += dt;
          if (unit.mem.shareAcc < shareIv - 1e-9) return;
          unit.mem.shareAcc -= shareIv;
          const group = battle.alliesInGrid(unit).filter((a) => a.alive && a.kind !== 'device');
          let hp = 0, max = 0;
          for (const a of group) { hp += a.hp; max += a.s.maxHp; }
          if (!(max > 0) || group.length < 2) return;
          const ratio = hp / max;
          for (const a of group) a.hp = Math.max(1, Math.min(a.s.maxHp, a.s.maxHp * ratio));
          battle.fx('hpShare', { x: unit.x, y: unit.y, id: unit.id, ratio: Math.round(ratio * 1000) / 1000 });
        },
        onEnd({ battle, unit }) {
          if (unit.profile) unit.profile.auraRatio = baseRatio;
          for (const a of battle.allyUnits) {
            const b = a.findBuff('cetsyr:inspire');
            if (b && b.data.src === unit) battle.removeBuff(a, b);
          }
        },
      },
      talents: [
        { install(battle, unit) { // 过往尘埃: cnt motes orbit her (radius range_radius, dynamic_spd °/s, PRTS hit radius 0.4)
          const cnt = Math.max(0, Math.floor(num(t0.cnt, 3))), orbit = num(t0.range_radius, 1.15);
          const spd = (num(t0.dynamic_spd, 30) * Math.PI) / 180;
          const cd = num(t0.cooldown, 6), dur = num(t0.talent_duration, 6), mul = num(t0['attack@trait_mul'], 1.5);
          const motes = new Array(cnt).fill(0); // per orbit slot: the time its mote is back (vanished → respawn after cd)
          const reach = orbit + MOTE_HIT_RADIUS + 0.01;
          battle.on('deploy', (c) => { if (c.unit === unit) motes.fill(0); }, { owner: unit });
          whileOn(battle, unit, AURA_IV, () => {
            if (!cnt) return;
            const keep = !!unit.skill?.active; // S3: "微尘"不再消失
            // "微尘"碰撞友方干员: operators only; a mote never collides with an operator already under a mote effect
            const cands = battle.alliesInRadius(unit.x, unit.y, reach, null).filter((a) => a !== unit && isOp(a) && !a.findBuff('cetsyr:mote'));
            if (!cands.length) return;
            const t = battle.time - num(unit.deployedAt);
            for (let k = 0; k < cnt; k++) {
              if (motes[k] > battle.time + 1e-9) continue;
              const ang = spd * t + (2 * Math.PI * k) / cnt;
              // the orbit turns with his direction: angle 0 = straight ahead, π/2 = his left hand
              const [fr, fc] = unit.fwd, [lr, lc] = rotateOffset(1, 0, unit.dir);
              const mx = unit.x + orbit * (fc * Math.cos(ang) + lc * Math.sin(ang)), my = unit.y + orbit * (fr * Math.cos(ang) + lr * Math.sin(ang));
              let hit = null, hd = Infinity;
              for (const a of cands) {
                if (a.findBuff('cetsyr:mote')) continue;
                const d = Math.hypot(a.x - mx, a.y - my);
                if (d <= MOTE_HIT_RADIUS + 1e-9 && d < hd) { hd = d; hit = a; }
              }
              if (!hit) continue;
              battle.addBuff(hit, { key: 'cetsyr:mote', duration: dur, visible: true, data: { src: unit, mul } });
              if (!keep) motes[k] = battle.time + cd;
              battle.fx('mote', { x: hit.x, y: hit.y, id: hit.id });
            }
          });
          battle.on('heal', (c) => {
            if (c.source !== unit || !c.opts?.aura) return;
            const b = c.target.findBuff('cetsyr:mote');
            if (b) c.amount *= num(b.data.mul, 1);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 魔王残响
          const dr = num(t1.damage_resistance);
          if (!(dr > 0)) return;
          battle.on('hit', (c) => {
            if (!c.target || c.target.side !== 'ally' || !c.source || c.source.side !== 'enemy') return;
            if (!(c.source.def?.tags || []).includes('sarkaz') || leaderOf(battle, unit) !== unit) return;
            c.dmg.mul *= 1 - dr;
          }, { owner: unit });
        } },
      ],
      install(battle, unit) { // module: ≥ cnt other ops in the (base) range → ATK +8 %
        const atk = num(tm.atk), need = num(tm.cnt, 2);
        if (!chess?.isGolden || !atk) return;
        whileOn(battle, unit, AURA_IV, () => {
          const keys = new Set(unit.baseRangeKeys || []);
          let n = 0;
          for (const a of battle.allies()) if (a !== unit && isOp(a) && keys.has(a.tileR * COLS + a.tileC)) n++;
          if (n >= need) battle.addBuff(unit, { key: 'cetsyr:module', duration: AURA_DUR, mods: { atkPct: atk } });
        });
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 铃兰 — S3 狐火渺然 (27/29 s): no attacks, skill range, every enemy in range is sluggish, allies in range heal 9/11 %
  // ATK per second, T2 ×scale_delta_to_one. T1 技力光环·辅助: Supporters +0.4 SP/s (highest wins).
  // T2 画地为牢: sluggish enemies in range also take +20 % damage for the same time. Module (elite): +0.2 SP/s with an
  // enemy in range.
  chess_char_5_10_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tm = talent(chess, -1);
    const boost = num(bb.scale_delta_to_one, 1);
    const healRatio = num(bb['attack@atk_to_hp_recovery_ratio']);
    const fragile = num(t1.damage_scale, 1) - 1;
    return {
      // S1 全力以赴 (duration): ATK +, ASPD +. S2 儿时的舞乐 (toggle, 持续时间无限): ATK +, 2 targets.
      skills: lazySkills({
        skchr_lisa_1: () => ({ kind: 'duration', mods: mods({ atkPct: num(bb.atk), aspd: num(bb.attack_speed) }) }),
        skchr_lisa_2: () => ({ kind: 'toggle', mods: mods({ atkPct: num(bb.atk) }), targeting: { maxTargets: Math.max(1, num(bb['attack@max_target'], 2)) } }),
      }),
      skill: {
        kind: 'duration',
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
        attack: { noAttack: true },
        onStart({ unit }) { unit.mem.foxSlow = AURA_IV; unit.mem.foxHeal = 0; },
        onTick({ battle, unit, dt }) {
          unit.mem.foxSlow += dt;
          if (unit.mem.foxSlow >= AURA_IV) {
            unit.mem.foxSlow = 0;
            for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) battle.applyStatus(e, 'sluggish', { duration: AURA_DUR, source: unit });
          }
          unit.mem.foxHeal += dt;
          if (unit.mem.foxHeal >= 1) {
            unit.mem.foxHeal -= 1;
            if (!(healRatio > 0)) return;
            for (const a of battle.alliesInGrid(unit)) if (a.hp < a.s.maxHp) battle.heal(unit, a, unit.s.atk * healRatio, { aura: true });
          }
        },
      },
      talents: [
        { install(battle, unit) { spAura(battle, unit, num(t0.sp_recovery_per_sec), (a) => isOp(a) && a.def?.profession === 'SUPPORT'); } },
        { install(battle, unit) { // 画地为牢 — PRTS 备注: an aura; every enemy in her range that is 停顿 (whoever caused it)
          // carries the talent's 脆弱 while it stays 停顿 and in range. It is the standard 脆弱 status (same-name: highest wins).
          if (!(fragile > 0)) return;
          whileOn(battle, unit, AURA_IV, () => {
            const v = fragile * (unit.skill?.active ? boost : 1);
            for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) {
              if (e.alive && e.findBuff('sluggish')) battle.applyStatus(e, 'fragile', { duration: AURA_DUR, value: v, source: unit });
            }
          });
        } },
      ],
      install(battle, unit) { // module
        const sp = num(tm.sp_recovery_per_sec);
        if (!chess?.isGolden || !(sp > 0)) return;
        whileOn(battle, unit, AURA_IV, () => {
          if (battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).length) battle.addBuff(unit, { key: 'lisa:module', duration: AURA_DUR, mods: { spRecoveryFlat: sp } });
        });
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 塞雷娅 — S2 药物配置 (instant, time SP): heals every ally in the skill range for heal_scale × ATK (cast when one is
  // injured). T1 莱茵充能护服: every 20 s on the field ATK +5 % / DEF +4 % (×5). T2 精神回复: +1 SP to every ally she heals.
  // Module (elite): heals on allies below 50 % ×1.15.
  // S1 急救 (instant / 2 charges elite, 自动触发: cast at her attack when an ally of the skill area 周围 is at ≤ half HP):
  // that attack is instead a heal of the lowest such ally for heal_scale × ATK.
  // S3 钙质化 (duration; the 重装 strategy TAKE_DAMAGE): allies in the skill area heal
  // attack@heal_scale × ATK per second; enemies there take arts ×demkni_s_3.damage_scale and move −60 %.
  // Module GUA-Y (elite): damage taken −15 %.
  chess_char_5_11_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess);
    const sid = selectedId(chess, def);
    const grid = skillGrid(chess, def) ?? [[0, 0]];
    const zone = (battle, unit) => {
      const at = unit.tileR * COLS + unit.tileC;
      if (unit.mem.sariaAt !== at) { unit.mem.sariaAt = at; unit.mem.sariaKeys = new Set(absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0)); }
      const keys = unit.mem.sariaKeys;
      return battle.allies().filter((a) => keys.has(a.tileR * COLS + a.tileC) && (a === unit || !(a.s.flags.noHeal || a.profile?.noHeal)));
    };
    const healable = (a, unit) => a.kind !== 'device' && (a === unit || !(a.s.flags.noHeal || a.profile?.noHeal));
    return {
      skills: lazySkills({
        skchr_demkni_1: () => ({
          // 自动触发: its own rule, no 技能策略 — PRTS 备注 "此技能仅在周围有符合血量条件的友方单位时可触发，触发时会替换当次
          // 攻击" and the corrected text "血量小于等于一半": checked when she is about to attack (an enemy target, the basic
          // rule), an ally of the skill area at ≤ half HP casts it and that attack becomes the heal (unlike 古米's 备用军粮,
          // no heal mode is left waiting: the engine withdraws a cast whose ally was healed before the attack)
          kind: instantKind(chess, def),
          trigger: { rule: 'DEFAULT', grid, allies: true, hpAtMost: HALF_HP },
          targeting: { rangeGrid: grid },
          attack: { dmgType: 'heal', heal: { mode: 'single', hpAtMost: HALF_HP }, healScale: num(bb.heal_scale, 1), projectile: 'none' },
          onHit({ battle, target }) { if (target) battle.fx('healAoe', { x: target.x, y: target.y, id: target.id, r: 0.5 }); },
        }),
        skchr_demkni_3: () => ({
          kind: 'duration',
          onStart({ unit }) { unit.mem.calcAcc = 0; unit.mem.calcAura = AURA_IV; },
          onTick({ battle, unit, dt }) {
            unit.mem.calcAura += dt;
            if (unit.mem.calcAura >= AURA_IV - 1e-9) {
              unit.mem.calcAura = 0;
              const m = { artsTakenMul: num(bb['demkni_s_3.damage_scale'], 1), moveMul: Math.max(0, 1 + num(bb['demkni_s_3.move_speed'])) };
              for (const e of battle.unitsInGrid(unit, grid, { side: 'enemy' })) battle.addBuff(e, { key: 'saria:calcify', duration: AURA_DUR, visible: true, mods: m });
            }
            unit.mem.calcAcc += dt;
            if (unit.mem.calcAcc < 1 - 1e-9) return;
            unit.mem.calcAcc -= 1;
            const amt = unit.s.atk * num(bb['attack@heal_scale']);
            if (amt > 0) for (const a of battle.unitsInGrid(unit, grid, { side: 'ally' })) if (healable(a, unit) && a.hp < a.s.maxHp - 1e-6) battle.heal(unit, a, amt);
          },
        }),
      }),
      skill: {
        kind: 'instant', heal: true, trigger: NEVER,
        onStart({ battle, unit }) {
          const amt = unit.s.atk * num(bb.heal_scale, 1);
          for (const a of zone(battle, unit)) if (a.hp < a.s.maxHp - 1e-6) battle.heal(unit, a, amt);
          battle.fx('healAoe', { x: unit.x, y: unit.y, id: unit.id, r: 2.5 });
        },
      },
      talents: [
        { install(battle, unit) { // 莱茵充能护服
          const iv = Math.max(1, num(t0.interval, 20)), max = Math.max(1, num(t0.max_stack_cnt, 5));
          whileOn(battle, unit, 1, () => {
            const n = Math.min(max, Math.floor((battle.time - unit.deployedAt + 1e-6) / iv));
            const cur = unit.findBuff('saria:suit');
            if (n > 0 && (!cur || cur.stacks !== n)) battle.addBuff(unit, { key: 'saria:suit', stacks: n, maxStacks: max, mods: mods({ atkPct: num(t0.atk), defPct: num(t0.def) }) });
          });
        } },
        { install(battle, unit) { // 精神回复
          const sp = num(t1.sp);
          if (!(sp > 0)) return;
          battle.on('heal', (c) => {
            if (c.source !== unit || c.opts?.regen || !(c.amount > 0) || !c.target.skill) return;
            c.target.skill.gainSp(sp, 'talent');
          }, { owner: unit, priority: -10 });
        } },
      ],
      install(battle, unit) {
        // S2 only: the NEVER-trigger skill casts itself when an ally in its area is injured
        if (!sid || sid === 'skchr_demkni_2') autoCast(battle, unit, () => zone(battle, unit).some((a) => a.hp < a.s.maxHp - 1e-6));
        lowHpHealUp(battle, unit, tb);
        if (num(tb.damage_resistance) > 0) permBuff(battle, unit, 'saria:moduleY', { dmgTakenMul: 1 - num(tb.damage_resistance) });
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 夕 — S1 工笔入化 (2 charges): next attack 180 % ATK with an expanded splash. T1 化境: a kill by 夕 or 小自在 → ATK +2 %
  // (×15). T2 点睛: first attack after deploying summons 小自在 (25 s) on the target's tile (deployable ground).
  // Module (elite): 攻击范围扩大.
  // S2 泼墨淋漓 (duration): skill range, ATK +, ASPD +, hits every enemy in range (one hit each: no splash on top);
  // arts damage ×damage_scale on enemies below hp_ratio. S3 写意胜形 (duration): skill range, BAT +0.4 s, prefers
  // unblocked enemies, splash 1.7, ATK +; every attack summons 小自在 on the target's tile (deployable ground) or moves /
  // refreshes the one already out (deployLimit 1: "召唤/刷新一个"), 25 s (the 点睛 token duration).
  chess_char_5_12_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1);
    const sid = selectedId(chess, def);
    const tokenId = talentRec(chess, 1)?.tokenKey ?? (chess?.tokens || [])[0] ?? 'token_10015_dusk_drgn';
    const tokenDur = num(t1['attack@tokenduration'], 25);
    const freeGround = (battle, r, c) => battle.grid.inRect(r, c) && battle.grid.canStand(r, c) && !battle.grid.isObstacle(r, c) && !battle.isReservedTile(r, c);
    // 小自在 expiry follows tk.mem.duskUntil (a refresh pushes it back)
    const expire = (battle, tk) => {
      if (!tk.alive) return;
      const left = num(tk.mem.duskUntil) - battle.time;
      if (left > 1e-6) battle.after(left, () => expire(battle, tk), { owner: tk });
      else battle.retreat(tk, { reason: 'expired', permanent: true });
    };
    /** Summon 小自在 on (r, c), or move / refresh hers when one is out. */
    const summon = (battle, unit, r, c) => {
      const mine = battle.allyUnits.find((x) => x.kind === 'token' && x.ownerUnit === unit && x.defId === tokenId && x.alive && x.deployed);
      if (mine) {
        if (mine.tileR !== r || mine.tileC !== c) {
          const fromX = mine.x, fromY = mine.y;
          if (!freeGround(battle, r, c) || !battle.relocate(mine, r, c)) return null;
          battle.fx('teleport', { x: mine.x, y: mine.y, id: mine.id, fromX, fromY });
        }
        mine.mem.duskUntil = battle.time + tokenDur;
        return mine;
      }
      if (!freeGround(battle, r, c)) return null;
      const tk = battle.spawnToken(unit, tokenId, r, c);
      if (!tk) return null;
      tk.mem.duskUntil = battle.time + tokenDur;
      battle.after(tokenDur, () => expire(battle, tk), { owner: tk });
      battle.fx('summon', { x: tk.x, y: tk.y, id: tk.id, token: tokenId });
      return tk;
    };
    return {
      skills: lazySkills({
        skchr_dusk_2: () => ({
          kind: 'duration', mods: mods({ atkPct: num(bb.atk), aspd: num(bb.attack_speed) }),
          targeting: skillRange(chess, def, { allInRange: true }),
          attack: { splashRadius: 0 },
        }),
        skchr_dusk_3: () => ({
          kind: 'duration', mods: mods({ atkPct: num(bb.atk), batPct: batPct(bb.base_attack_time, chess) }),
          targeting: skillRange(chess, def),
          attack: { splashRadius: DUSK_S3_SPLASH },
        }),
      }),
      skill: { kind: 'charges', attack: { atkScale: num(bb.atk_scale, 1), splashRadius: DUSK_SPLASH_RADIUS } },
      talents: [
        { install(battle, unit) { // 化境
          battle.on('kill', (c) => {
            const k = c.killer;
            if (!k || c.victim.side !== 'enemy' || !(k === unit || (k.kind === 'token' && k.ownerUnit === unit)) || !on(unit)) return;
            battle.addBuff(unit, { key: 'dusk:realm', refresh: 'stack', maxStacks: Math.max(1, num(t0.max_stack_cnt, 15)), mods: { atkPct: num(t0.atk) } });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 点睛
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.duskSummoned = false; }, { owner: unit });
          battle.on('attack', (c) => {
            if (c.attacker !== unit || unit.mem.duskSummoned) return;
            const t = c.targets.find((x) => x.side === 'enemy');
            if (!t) return;
            unit.mem.duskSummoned = true;
            // "在目标位置（可部署地面）召唤": only on the target's own tile when it is free deployable ground — PRTS 备注:
            // otherwise nothing is summoned, and the talent is spent for this deployment either way
            summon(battle, unit, Math.round(t.y), Math.round(t.x));
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        moduleRangeUp(battle, unit, chess);
        if (sid === 'skchr_dusk_2') {
          const cut = num(bb.hp_ratio, HALF_HP), mul = num(bb.damage_scale, 1);
          battle.on('hit', (c) => {
            if (c.source !== unit || !unit.skill?.active || c.dmg.type !== 'arts' || !c.target || c.target.side !== 'enemy') return;
            if (c.target.hpRatio < cut) c.dmg.mul *= mul;
          }, { owner: unit });
        }
        if (sid === 'skchr_dusk_3') {
          // 优先攻击未阻挡的敌人
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !unit.skill?.active || !c.targets.length || !c.targets[0].blockedBy) return;
            const list = battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile);
            sortEnemyTargets(battle, unit, list, null);
            const alt = list.find((e) => !e.blockedBy);
            if (alt) c.targets = [alt, ...c.targets.slice(1).filter((x) => x !== alt)];
          }, { owner: unit, priority: 10 });
          battle.on('attack', (c) => {
            if (c.attacker !== unit || !unit.skill?.active) return;
            const t = c.targets.find((x) => x.side === 'enemy');
            if (t) summon(battle, unit, Math.round(t.y), Math.round(t.x));
          }, { owner: unit });
        }
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 归溟幽灵鲨 — dollkeeper (professions.js installDollkeeper: the 替身 form, its switch animations, 阻回). Her <替身> makes
  // no normal attack (PRTS 特性备注 "<替身>不进行普通攻击") and so casts no skill (kit trait `dollNoAttack`).
  // S2 生存的渴望 (15/17 s): ATK/ASPD +, HP never below 1 (PRTS 备注: 不死 — a lethal hit does not switch her meanwhile);
  // when it ends she switches to the 替身 at once (PRTS 修正 "技能结束后立刻切换为<替身>", the text's 视为被击倒: no lethal
  // HP loss, so no 不死 / 复活 effect takes it). T1 拥抱自我: the 替身 slows nearby enemies −40 % and deals 40 % ATK
  // arts/s to them (PRTS 备注 "伤害与减速不可对空": ground enemies only) — once it fights (not during its switch
  // animation). T2 阿戈尔的深邃: Abyssal Hunters in the team max HP +20 %. Module (elite): substitute ATK +15 %.
  // S1 生存的技巧 (duration): swaps HP ratios with the other operator of the skill area (周围) with the lowest HP ratio,
  // ATK +. S3 生存的重压 (duration): BAT +1 s, hits every blocked enemy, ATK +, max HP +; an attacked enemy whose HP ratio
  // is ≥ hers takes attack@atk_scale_ex × ATK phys more, otherwise she loses attack@hp_ratio of her max HP.
  // Module PUM-Y (elite): substitute max HP +20 %.
  chess_char_5_13_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess);
    const sid = selectedId(chess, def);
    const aroundGrid = chess?.trait?.rangeGrid ?? [[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]];
    return {
      skills: lazySkills({
        skchr_ghost2_1: () => ({
          kind: 'duration', mods: mods({ atkPct: num(bb.atk) }),
          onStart({ battle, unit }) {
            const t = battle.unitsInGrid(unit, skillGrid(chess, def) ?? aroundGrid, { side: 'ally' }).filter((a) => a !== unit && isOp(a) && a.hp > 0)
              .sort((a, b) => a.hpRatio - b.hpRatio || a.id - b.id)[0];
            if (!t) return;
            const mine = unit.hpRatio, theirs = t.hpRatio;
            unit.hp = Math.max(1, Math.min(unit.s.maxHp, unit.s.maxHp * theirs));
            t.hp = Math.max(1, Math.min(t.s.maxHp, t.s.maxHp * mine));
            battle.fx('hpShare', { x: t.x, y: t.y, id: unit.id, to: t.id });
          },
        }),
        skchr_ghost2_3: () => ({
          kind: 'duration',
          mods: mods({ atkPct: num(bb.atk), hpPct: num(bb.max_hp), batPct: batPct(bb.base_attack_time, chess) }),
          attack: {
            hitAllBlocked: true,
            onEachHit({ battle, unit, target, kind }) {
              if (kind !== 'main' || !target || target.side !== 'enemy') return;
              if (unit.mem.ghostHeavy?.get(target)) {
                if (target.alive) battle.dealDamage(unit, target, { amount: unit.s.atk * num(bb['attack@atk_scale_ex']), type: 'phys', isSkill: true, tags: ['skill', 'ghost2Weight'] });
              } else if (unit.alive) battle.loseHp(unit, unit.s.maxHp * num(bb['attack@hp_ratio']), { source: unit });
            },
          },
        }),
      }),
      skill: {
        kind: 'duration',
        mods: mods({ atkPct: num(bb.atk), aspd: num(bb.attack_speed) }),
        // "技能结束后立刻切换为<替身>": nothing when the skill ended with her (death) or by her switch to the 替身, or she
        // already is one
        onEnd({ battle, unit, reason }) {
          if (reason === 'death' || reason === 'substitute' || !unit.alive || !unit.deployed || unit.trait.doll) return;
          battle.emit('dollSwitch', { unit, reason: 'skill', done: false });
        },
      },
      trait: { dollNoAttack: true },
      talents: [
        { install(battle, unit) { // 拥抱自我 (the 替身 fighting: not during a switch animation)
          const slow = num(t0.move_speed), scale = num(t0.atk_scale);
          whileOn(battle, unit, AURA_IV, () => {
            if (!unit.trait.doll || unit.trait.dollSwitching || !slow) return;
            for (const e of battle.unitsInGrid(unit, aroundGrid, { side: 'enemy' })) if (!e.isFlying) battle.addBuff(e, { key: 'ghost2:embrace', duration: AURA_DUR, mods: { moveMul: Math.max(0, 1 + slow) } });
          });
          whileOn(battle, unit, 1, () => {
            if (!unit.trait.doll || unit.trait.dollSwitching || !(scale > 0)) return;
            for (const e of battle.unitsInGrid(unit, aroundGrid, { side: 'enemy' })) if (!e.isFlying) battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', tags: ['talent', 'embrace'] });
          });
        } },
        { install(battle, unit) { // 阿戈尔的深邃
          const hp = num(t1.max_hp);
          if (!hp) return;
          battle.on('battleStart', () => {
            for (const a of battle.getPlayer(unit.ownerId)?.units ?? []) if (isOp(a) && isAbyssal(a)) battle.addBuff(a, { key: 'ghost2:abyss', mods: { hpPct: hp }, persist: true, allowDead: true });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // S2: HP never below 1 while it runs
        if (!sid || sid === 'skchr_ghost2_2') battle.on('fatal', (c) => { if (c.unit === unit && unit.skill?.active) c.prevented = true; }, { owner: unit, priority: 10 });
        if (sid === 'skchr_ghost2_3') { // S3: 生命比例高于或等于自身 — judged when the attack starts
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !unit.skill?.active) return;
            unit.mem.ghostHeavy = new Map(c.targets.filter(Boolean).map((t) => [t, t.hpRatio >= unit.hpRatio - 1e-9]));
          }, { owner: unit, priority: -100 });
        }
        const hpUp = num(tb.max_hp); // PUM-Y: 替身…生命值提升
        if (hpUp) whileOn(battle, unit, 0.2, () => { if (unit.trait.doll) battle.addBuff(unit, { key: 'ghost2:moduleY', duration: 0.3, mods: { hpPct: hpUp } }); });
        const atk = num(tb.atk);
        if (atk) {
          whileOn(battle, unit, 0.2, () => {
            if (unit.trait.doll) battle.addBuff(unit, { key: 'ghost2:module', duration: 0.3, mods: { atkPct: atk } });
          });
        }
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 凛御银灰 — S2 御敌的锋锐 (2 charges; PRTS 备注 "可对空"): the 6 front-most enemies in the skill range take 260 % ATK
  // phys, cold + reveal for 4 s; the waiting (knocked-out) op nearest to 风雪之眼 by cost gets −11 redeploy cost (right
  // side guard/caster/sniper first); waiting ops left of the eye (cost < eye cost) cast the AoE with their own ATK when
  // they redeploy (≤2).
  // T1 开放性开局: ops left of the eye and himself: +4 SP at deployment, redeploy time −20 %.
  // T2 雪境先驱: Kjerag ops freeze-immune, DEF +60, 1.5 % max HP/s regen; doubled after 15 s on the field.
  // The eye follows the selected skill (its overrideTokenKey: S1 eagle1 cost 16, S2 eagle2 14, S3 eagle3 19).
  // S1 周旋的谋略 (instant): +cost DP at once; the waiting op nearest to the eye gets −[deck].cost redeploy cost (same pick
  // as S2) and a barrier of [deck].shield × his max HP when it redeploys.
  // S3 变革已至 (duration 48 s): skill range; enemies in it lose 隐匿; every attack hits every enemy of the range on the
  // target's line (his facing) for bird_atk_scale × ATK phys + 脆弱 (damage_scale − 1, weak[limit] s [ASSUMED duration]);
  // +[start_cost] DP at once, then +[cost].cost DP every [cost].interval s; the first activation of the battle swaps the
  // base costs of the most (guard/caster/sniper first) and least expensive waiting ops. "风雪之眼变为可部署" is not
  // modelled (nobody deploys by hand in the auto battle).
  chess_char_5_14_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1);
    const grid = skillGrid(chess, def) ?? [[0, 0], [0, 1]];
    const eyeId = chess?.skill?.overrideTokenKey ?? talentRec(chess, 0)?.tokenKey ?? 'token_10057_svash2_eagle2';
    const n = Math.max(1, num(bb.max_target, 6)), maxStacks = Math.max(1, num(bb.max_stack_cnt, 2));
    const PREF = ['WARRIOR', 'CASTER', 'SNIPER'];
    /** Waiting (knocked-out) ops of his player split around the eye cost, and the one nearest to the eye (right side first). */
    const waitingArea = (battle, unit) => {
      const eye = unit.mem.eyeCost ?? 0;
      const waiting = battle.allyUnits.filter((a) => isOp(a) && a !== unit && a.ownerId === unit.ownerId && !a.alive && !a.removed);
      const right = waiting.filter((a) => a.base.cost >= eye).sort((a, b) => a.base.cost - b.base.cost || a.id - b.id);
      const left = waiting.filter((a) => a.base.cost < eye).sort((a, b) => b.base.cost - a.base.cost || a.id - b.id);
      const pick = right.find((a) => PREF.includes(a.def?.profession)) ?? right[0] ?? left[0] ?? null;
      return { waiting, right, left, pick };
    };
    const cutCost = (a, v) => {
      if (!a || !(v > 0)) return;
      a.mem.svashCostBase ??= a.base.cost;
      a.base.cost = Math.max(0, a.base.cost - v);
    };
    const slash = (battle, caster, atk) => {
      // PRTS 备注: the slash ignores 隐匿 and hits flying enemies (and its reveal makes them targetable afterwards)
      for (const e of enemiesInGrid(battle, caster, grid, n, { ignoreStealth: true })) {
        battle.dealDamage(caster, e, { amount: atk * num(bb.atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill', 'svash2'] });
        if (!e.alive) continue;
        battle.applyStatus(e, 'cold', { duration: num(bb.cold), source: caster });
        battle.applyStatus(e, 'reveal', { duration: num(bb.cold), source: caster });
      }
      battle.fx('aoe', { x: caster.x + caster.fwd[1] * 1.5, y: caster.y + caster.fwd[0] * 1.5, id: caster.id, r: 2, skill: 'svash2' });
    };
    return {
      skills: lazySkills({
        // (自动触发: an AUTO skill takes no 技能策略 — an AUTO DP skill fires as soon as it is ready, like 伺夜 S1)
        skchr_svash2_1: () => ({
          kind: instantKind(chess, def),
          trigger: 'SP_FULL',
          onStart({ battle, unit }) {
            battle.addDp(unit.ownerId, num(bb.cost));
            const { pick } = waitingArea(battle, unit);
            cutCost(pick, num(bb['svash2_s_1[deck].cost']));
            if (pick) pick.mem.svashShield = unit.s.maxHp * num(bb['svash2_s_1[deck].shield']);
            battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id, r: 1, skill: 'svash2Plan' });
          },
        }),
        skchr_svash2_3: () => ({
          kind: 'duration',
          targeting: skillRange(chess, def),
          attack: {
            atkScale: num(bb.bird_atk_scale, 1),
            onEachHit({ battle, unit, target }) {
              if (!target || !target.alive || target.side !== 'enemy') return;
              const v = num(bb.damage_scale, 1) - 1;
              if (v > 0) battle.applyStatus(target, 'fragile', { duration: num(bb['weak[limit]'], 2), value: v, source: unit });
            },
          },
          onStart({ battle, unit }) {
            battle.addDp(unit.ownerId, num(bb['svash2_s_3[start_cost].cost']));
            unit.mem.svashDpAcc = 0;
            unit.mem.svashReveal = AURA_IV;
            if (!unit.mem.svashSwapped) { // 首次开启时交换…基础部署费用
              unit.mem.svashSwapped = true;
              const { waiting } = waitingArea(battle, unit);
              const baseCost = (a) => a.mem.svashCostBase ?? a.base.cost;
              const byCost = waiting.slice().sort((a, b) => baseCost(b) - baseCost(a) || a.id - b.id);
              const hi = byCost.find((a) => PREF.includes(a.def?.profession)) ?? byCost[0];
              const lo = byCost.filter((a) => a !== hi).pop();
              if (hi && lo && baseCost(hi) !== baseCost(lo)) {
                const ch = baseCost(hi), cl = baseCost(lo);
                for (const [a, v] of [[hi, cl], [lo, ch]]) {
                  if (a.mem.svashCostBase != null) { a.base.cost = Math.max(0, v - (a.mem.svashCostBase - a.base.cost)); a.mem.svashCostBase = v; } else a.base.cost = v;
                }
              }
            }
          },
          onTick({ battle, unit, dt }) {
            const iv = Math.max(0.1, num(bb['svash2_s_3[cost].interval'], 2));
            unit.mem.svashDpAcc += dt;
            while (unit.mem.svashDpAcc >= iv - 1e-9) { unit.mem.svashDpAcc -= iv; battle.addDp(unit.ownerId, num(bb['svash2_s_3[cost].cost'], 1)); }
            unit.mem.svashReveal += dt;
            if (unit.mem.svashReveal < AURA_IV - 1e-9) return;
            unit.mem.svashReveal = 0;
            for (const e of enemiesInGrid(battle, unit, grid, 0, { ignoreStealth: true })) battle.applyStatus(e, 'reveal', { duration: AURA_DUR, source: unit });
          },
        }),
      }),
      skill: {
        kind: 'charges', // DEFAULT (data): cast right before an attack on an enemy in his initial (melee) range
        onStart({ battle, unit }) {
          slash(battle, unit, unit.s.atk);
          // cost cut: nearest to the eye, right side guard/caster/sniper preferred
          const { left, pick } = waitingArea(battle, unit);
          cutCost(pick, num(bb.cost));
          for (const a of left) a.mem.svashCasts = Math.min(maxStacks, num(a.mem.svashCasts) + 1);
        },
      },
      talents: [
        { install(battle, unit) { // 开放性开局
          const sp = num(t0.sp), mul = num(t0.respawn_time, 1);
          const left = (a) => isOp(a) && a.ownerId === unit.ownerId && (a === unit || a.base.cost < num(unit.mem.eyeCost));
          battle.on('battleStart', () => {
            if (!on(unit) || !(sp > 0)) return;
            for (const a of battle.allies(unit.ownerId)) if (left(a) && a.skill) a.skill.gainSp(sp, 'talent');
          }, { owner: unit });
          battle.on('deploy', (c) => {
            const a = c.unit;
            if (c.initial || !left(a) || !(a === unit || on(unit))) return;
            if (sp > 0 && a.skill) a.skill.gainSp(sp, 'talent');
          }, { owner: unit });
          battle.on('death', (c) => {
            const a = c.unit;
            if (!left(a) || a.removed || !(a === unit || on(unit)) || !Number.isFinite(a.respawnAt) || !(mul > 0 && mul < 1)) return;
            a.respawnAt = a.deathAt + (a.respawnAt - a.deathAt) * mul;
          }, { owner: unit });
        } },
        { install(battle, unit) { // 雪境先驱
          const defv = num(t1.def), regen = num(t1.hp_recovery_per_sec_by_max_hp_ratio), after = num(t1.interval, 15);
          whileOn(battle, unit, AURA_IV, () => {
            const m = battle.time - unit.deployedAt >= after - 1e-9 ? 2 : 1;
            for (const a of battle.allies()) {
              if (isOp(a) && isKjerag(a)) battle.addBuff(a, { key: 'svash2:snow', duration: AURA_DUR, mods: mods({ defFlat: defv * m, hpRegenRatio: regen * m }) });
            }
          });
          battle.on('beforeStatus', (c) => {
            if (c.status === 'freeze' && c.target.side === 'ally' && c.target.findBuff('svash2:snow')) c.cancel = true;
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        const tok = battle.tokenDef(eyeId, unit); // the owner's skill variant (DESIGN §16)
        unit.mem.eyeCost = num(tok?.stats?.cost, 14);
        if (selectedId(chess, def) === 'skchr_svash2_3') {
          // S3: every attack hits the enemies of the skill range on the target's line (his facing frame): the line of
          // the target's position; another enemy is on it when its body is (a huge one: any tile — body.js)
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !unit.skill?.active || !c.targets.length) return;
            const main = c.targets[0];
            const lat = (r, cc) => toLocal(r - unit.tileR, cc - unit.tileC, unit.dir)[0];
            const l0 = lat(Math.round(main.y), Math.round(main.x));
            const onLine = (e) => bodyKeys(e).some((k) => lat(Math.floor(k / COLS), k % COLS) === l0);
            const line = battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile).filter((e) => e !== main && onLine(e));
            if (line.length) c.targets = [main, ...line];
          }, { owner: unit, priority: 10 });
        }
        // waiting-area effects resolve when the op (re)deploys
        battle.on('deploy', (c) => {
          const a = c.unit;
          if (!isOp(a) || a.ownerId !== unit.ownerId) return;
          if (a.mem.svashCostBase != null) { a.base.cost = a.mem.svashCostBase; a.mem.svashCostBase = null; }
          if (num(a.mem.svashShield) > 0 && !c.initial) { // S1: 部署后获得…屏障
            battle.addBuff(a, { key: 'svash2:barrier', shield: a.mem.svashShield, visible: true });
            a.mem.svashShield = 0;
          }
          const casts = num(a.mem.svashCasts);
          if (casts > 0 && !c.initial) {
            a.mem.svashCasts = 0;
            for (let i = 0; i < casts; i++) slash(battle, a, a.s.atk);
          }
        }, { owner: unit });
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 引星棘刺 — S2 解构涌潮 (instant / 2 charges elite): throws an alchemy unit at the target: for 12/15 s ground enemies
  // around it get healing ×0.5, take 120/140 % ATK arts per second, allies heal 12/15 % ATK per second; the unit drifts
  // along the throw direction and its radius grows. T1 心相: ATK +10 %, +3 s when another op is in range.
  // T2 视界: allies ASPD +5, enemies −5 (doubled on straight roads ≥ 6 tiles). Module (elite): +0.1 SP/s with a unit out.
  // S1 度算浪波 (instant): an alchemy unit thrown at the ally in her range with the lowest HP ratio: for
  // projectile_delay_time s (+3 s 心相) allies on the landing tile and the 8 around it get DEF +def and heal
  // hp_recovery_per_sec_ratio × ATK per second. S3 “我的海疆”: passive — her range is the skill range; active
  // (instant) — alchemy units on the max_target_token operators with the lowest block count: for projectile_delay_time s
  // the enemies around each of them (RING1, following it) get ATK/DEF/RES −, one strongest instance (不叠加), and take
  // atk_scale × ATK arts per second, everything ramping +per_interval each `interval` s up to max_stack_cnt steps.
  chess_char_5_15_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tm = talent(chess, -1);
    const sid = selectedId(chess, def);
    const baseDur = num(bb.projectile_delay_time, num(bb.remaining_time, 12));
    const r0 = num(bb.projectile_range, 1.1), grow = num(bb.value), speed = num(bb.projectile_move_speed);
    const healMul = Math.max(0, num(bb.heal_scale, 1));
    const extend = (battle, unit) => (battle.alliesInGrid(unit).some((a) => a !== unit && isOp(a)) ? Math.min(num(t0.projectile_extend), num(t0.projectile_extend_max, Infinity)) : 0);
    // S3 ramp: value after `steps` intervals, clamped towards the max ("效果逐渐提升…15秒后达到最大")
    const ramp = (base, per, max, steps) => {
      const v = num(base) + num(per) * steps;
      return num(max) < num(base) ? Math.max(num(max), v) : Math.min(num(max, v), v);
    };
    /** One tick (AURA_IV) of an S1 guard zone / S3 sea zone. */
    const tickSpecial = (battle, unit, z, seaHits) => {
      if (z.type === 'guard') {
        const inZone = (a) => Math.abs(a.tileR - z.r) <= 1 && Math.abs(a.tileC - z.c) <= 1;
        const allies = battle.alliesFor(unit).filter(inZone);
        for (const a of allies) battle.addBuff(a, { key: 'thorn2:bastion', duration: AURA_DUR, mods: mods({ defFlat: num(bb.def) }) });
        if (z.acc >= 1 - 1e-9) {
          z.acc -= 1;
          const heal = unit.s.atk * num(bb.hp_recovery_per_sec_ratio);
          if (heal > 0) for (const a of allies) if (a.hp < a.s.maxHp) battle.heal(unit, a, heal, { aura: true });
        }
        return;
      }
      // sea: follows its operator while it stands on the field; the first burn lands with the unit, then one per
      // `interval` (so the 15th step — the max — is reached 15 s after the throw, for the debuff and the damage alike)
      if (z.anchor && z.anchor.alive && z.anchor.deployed) { z.x = z.anchor.x; z.y = z.anchor.y; }
      const iv = Math.max(0.1, num(bb.interval, 1));
      const steps = Math.min(Math.max(0, num(bb.max_stack_cnt, 15)), Math.floor((z.t - AURA_IV + 1e-9) / iv));
      const foes = battle.foesInRadius(z.x, z.y, RING1);
      for (const e of foes) seaHits.set(e, Math.max(seaHits.get(e) ?? -1, steps));
      if (z.acc >= iv - 1e-9) {
        z.acc -= iv;
        const scale = ramp(bb.atk_scale, bb.atk_scale_per_interval, bb.max_atk_scale, steps);
        z.burn = { foes, scale }; // dealt after the debuffs of this tick are on
      }
    };
    return {
      skills: lazySkills({
        skchr_thorn2_1: () => ({
          kind: instantKind(chess, def),
          onStart({ battle, unit }) {
            const t = battle.alliesInGrid(unit).filter((a) => a.hp > 0).sort((a, b) => a.hpRatio - b.hpRatio || b.blocking.length - a.blocking.length || dist(a, unit) - dist(b, unit) || a.id - b.id)[0];
            if (!t) return;
            const z = { type: 'guard', r: t.tileR, c: t.tileC, x: t.x, y: t.y, t: 0, acc: 0, dur: num(bb.projectile_delay_time, 6) + extend(battle, unit) };
            (unit.mem.zones ??= []).push(z);
            battle.fx('zone', { x: z.x, y: z.y, id: unit.id, r: RING1, duration: z.dur });
          },
        }),
        skchr_thorn2_3: () => ({
          kind: instantKind(chess, def),
          onStart({ battle, unit }) {
            const ops = battle.allies(unit.ownerId).filter((a) => isOp(a) && a.hp > 0)
              .sort((a, b) => a.s.blockCnt - b.s.blockCnt || dist(a, unit) - dist(b, unit) || a.id - b.id)
              .slice(0, Math.max(1, num(bb.max_target_token, 3)));
            const dur = num(bb.projectile_delay_time, 19) + extend(battle, unit);
            for (const a of ops) {
              (unit.mem.zones ??= []).push({ type: 'sea', anchor: a, x: a.x, y: a.y, t: 0, acc: Math.max(0.1, num(bb.interval, 1)) - AURA_IV, dur });
              battle.fx('zone', { x: a.x, y: a.y, id: unit.id, r: RING1, duration: dur });
            }
          },
        }),
      }),
      skill: {
        kind: maxCharges(chess, def) > 1 ? 'charges' : 'instant',
        onStart({ battle, unit }) {
          const list = battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile);
          sortEnemyTargets(battle, unit, list, null);
          let t = list.find((e) => !e.isFlying) ?? list[0];
          if (!t) {
            // PRTS 备注: no enemy in range → thrown at the farthest tile straight ahead inside her range
            let best = null;
            for (const k of unit.rangeKeys || []) {
              const r = Math.floor(k / COLS), c = k % COLS;
              if (!battle.grid.inRect(r, c)) continue;
              const [lat, d] = toLocal(r - unit.tileR, c - unit.tileC, unit.dir);
              if (lat !== 0) continue;
              if (d > 0 && (!best || d > best.d)) best = { d, x: c, y: r };
            }
            if (!best) return;
            t = best;
          }
          const extra = battle.alliesInGrid(unit).some((a) => a !== unit && isOp(a)) ? Math.min(num(t0.projectile_extend), num(t0.projectile_extend_max, Infinity)) : 0;
          // it drifts away from her deployment tile ("移动方向始终为远离棘刺部署位置中心的方向")
          const dx = t.x - unit.x, dy = t.y - unit.y, len = Math.hypot(dx, dy) || 1;
          const z = { x: t.x, y: t.y, vx: (dx / len) * speed, vy: (dy / len) * speed, t: 0, acc: 0, dur: baseDur + extra };
          (unit.mem.zones ??= []).push(z);
          battle.fx('zone', { x: z.x, y: z.y, id: unit.id, r: r0, duration: z.dur });
        },
      },
      talents: [
        { install(battle, unit) { permBuff(battle, unit, 'thorn2:mind', { atkPct: num(t0.atk) }); } },
        { install(battle, unit) { // 视界
          const cnt = num(t1.cnt, 6);
          const ally = num(t1.attack_speed_ally), allyX = num(t1.attack_speed_ally_extra), foe = num(t1.attack_speed_enemy), foeX = num(t1.attack_speed_enemy_extra);
          whileOn(battle, unit, AURA_IV, () => {
            for (const a of battle.alliesFor(unit)) {
              const v = ally + (straightRun(battle, a.tileR, a.tileC) >= cnt ? allyX : 0);
              if (v) battle.addBuff(a, { key: 'thorn2:vision', duration: AURA_DUR, mods: { aspd: v } });
            }
            for (const e of battle.enemies) {
              if (!e.alive || e.hidden) continue;
              const v = foe + (straightRun(battle, Math.round(e.y), Math.round(e.x)) >= cnt ? foeX : 0);
              if (v) battle.addBuff(e, { key: 'thorn2:vision', duration: AURA_DUR, mods: { aspd: v } });
            }
          });
        } },
      ],
      install(battle, unit) {
        const sp = num(tm.sp_recovery_per_sec);
        if (sid === 'skchr_thorn2_3') { // S3 被动效果：攻击范围扩大 (her own range, so also the DEFAULT trigger range)
          const g = skillGrid(chess, def);
          if (g) { unit.rangeGrid = g; battle.refreshRange(unit); }
        }
        // alchemy units keep working after she falls (they are already thrown)
        battle.every(AURA_IV, () => {
          const zones = unit.mem.zones;
          if (!zones || !zones.length) return;
          const R = battle.rect;
          const seaHits = new Map();
          for (const z of zones) {
            z.t += AURA_IV;
            z.acc += AURA_IV;
            if (z.type) { tickSpecial(battle, unit, z, seaHits); continue; }
            z.x = Math.max(R.c0, Math.min(R.c1, z.x + z.vx * AURA_IV));
            z.y = Math.max(R.r0, Math.min(R.r1, z.y + z.vy * AURA_IV));
            const r = r0 + grow * z.t;
            const foes = battle.foesInRadius(z.x, z.y, r).filter((e) => !e.isFlying);
            for (const e of foes) battle.addBuff(e, { key: 'thorn2:rot', duration: AURA_DUR, mods: { healingTakenMul: healMul } });
            if (z.acc >= 1 - 1e-9) {
              z.acc -= 1;
              for (const e of foes) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'arts', isSkill: true, tags: ['skill', 'alchemy'] });
              const heal = unit.s.atk * num(bb.hp_recovery_per_sec_ratio_chr);
              if (heal > 0) for (const a of battle.alliesInRadius(z.x, z.y, r, null)) if (a.hp < a.s.maxHp) battle.heal(unit, a, heal, { aura: true });
              battle.fx('zone', { x: z.x, y: z.y, id: unit.id, r, duration: Math.max(0, z.dur - z.t) });
            }
          }
          for (const [e, steps] of seaHits) { // S3 debuff: 不叠加 — the strongest zone wins
            if (!e.alive) continue;
            battle.addBuff(e, { key: 'thorn2:sea', duration: AURA_DUR, visible: true, mods: mods({
              atkPct: ramp(bb.atk, bb.atk_per_interval, bb.max_atk, steps),
              defPct: ramp(bb.def, bb.def_per_interval, bb.max_def, steps),
              resMul: 1 + ramp(bb.magic_resistance, bb.magic_resistance_per_interval, bb.max_magic_resistance, steps),
            }) });
          }
          for (const z of zones) {
            if (!z.burn) continue;
            for (const e of z.burn.foes) if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * z.burn.scale, type: 'arts', isSkill: true, tags: ['skill', 'mySea'] });
            z.burn = null;
          }
          unit.mem.zones = zones.filter((z) => z.t < z.dur - 1e-9);
          if (chess?.isGolden && sp > 0 && on(unit) && unit.mem.zones.length) battle.addBuff(unit, { key: 'thorn2:module', duration: AURA_DUR, mods: { spRecoveryFlat: sp } });
        }, { owner: unit });
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 白面鸮 — ringhealer. S2 脑啡肽 (33/36 s): skill range, BAT −1.8/−1.9 s. T1 技力光环: all allies +0.3 SP/s (highest
  // wins). Module (elite): 攻击范围扩大.
  chess_char_5_16_a: (bb, chess, def) => {
    const t0 = talent(chess, 0);
    return {
      skill: {
        kind: 'duration', heal: true,
        mods: mods({ batPct: batPct(bb.base_attack_time, chess) }),
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
      },
      talents: [{ install(battle, unit) { spAura(battle, unit, num(t0.sp_recovery_per_sec), () => true); } }],
      install(battle, unit) { moduleRangeUp(battle, unit, chess); },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 山 — S2 横扫架势 (stance toggle): DEF −30 %, range = own tile, ATK +35 %, block +1, hits every blocked enemy, 4 % max HP/s
  // regen. T1 巨力重拳: 20 % chance ×1.6 ATK and target ATK −15 % for 3 s. T2 强壮肉体: DEF +10 %, 15 % phys dodge.
  // Module (elite): ASPD +10 above 50 % HP.
  // S1 左勾扫拳 (instant, attack SP): next attack atk_scale × ATK on max_target enemies. S3 震地碎岩击 (duration): skill
  // range, BAT +0.7 s, ATK +, double hits on up to attack@max_target enemies, each pushed (中等力度); T1 chance →
  // talent@prob. Module FGT-X (elite): 15 % physical dodge.
  chess_char_5_17_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess);
    const sid = selectedId(chess, def);
    const critScale = num(t0.atk_scale, 1);
    const critProb = (unit) => (sid === 'skchr_f12yin_3' && unit.skill?.active ? num(bb['talent@prob'], num(t0.prob)) : num(t0.prob));
    return {
      skills: lazySkills({
        skchr_f12yin_1: () => ({ kind: instantKind(chess, def), attack: { atkScale: num(bb.atk_scale, 1), maxTargets: Math.max(1, num(bb.max_target, 2)) } }),
        skchr_f12yin_3: () => ({
          kind: 'duration',
          mods: mods({ atkPct: num(bb.atk), batPct: batPct(bb.base_attack_time, chess) }),
          targeting: skillRange(chess, def, { maxTargets: Math.max(1, num(bb['attack@max_target'], 3)) }),
          attack: {
            hits: 2,
            onEachHit({ battle, unit, target, kind }) {
              if (kind !== 'main' || !target || !target.alive || target.side !== 'enemy') return;
              // "中等力度地推动" (PRTS 备注: on the 2nd hit of each attack — onEachHit runs after both): a radial push by
              // the official 力度 − 重量 distance (Battle.push)
              battle.push(target, num(bb['attack@force'], 1), { from: unit });
            },
          },
        }),
      }),
      skill: {
        kind: 'toggle',
        mods: mods({ atkPct: num(bb.atk), defPct: num(bb.def), blockCnt: num(bb.block_cnt), hpRegenRatio: num(bb.hp_recovery_per_sec_by_max_hp_ratio) }),
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
        attack: { hitAllBlocked: true },
      },
      trait: {
        dmgMul: (b, u) => (u.mem.crit ? critScale : 1),
        afterHit: (b, u, t) => {
          if (!u.mem.crit || !t || !t.alive || !num(t0.atk)) return;
          b.addBuff(t, { key: 'f12yin:punch', duration: num(t0.duration, 3), mods: { atkPct: num(t0.atk) }, visible: true, status: 'weaken' });
        },
      },
      talents: [
        { install(battle, unit) { // 巨力重拳: one roll per attack
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit) return;
            const p = critProb(unit);
            unit.mem.crit = p > 0 && battle.rng.chance(p);
            if (unit.mem.crit) battle.fx('crit', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit });
        } },
        { install(battle, unit) { permBuff(battle, unit, 'f12yin:body', { defPct: num(t1.def), dodgePhys: num(t1.prob) }); } },
      ],
      install(battle, unit) {
        // FGT-X: 拥有15%的物理闪避 (an own dodge source: rolls independently of 强壮肉体)
        if (num(tb.prob) > 0) permBuff(battle, unit, 'f12yin:moduleX', { dodgePhys: num(tb.prob) });
        const aspd = num(tb.attack_speed);
        if (!aspd) return;
        whileOn(battle, unit, 0.2, () => { if (unit.hpRatio > HALF_HP) battle.addBuff(unit, { key: 'f12yin:module', duration: 0.3, mods: { aspd } }); });
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 百炼嘉维尔 — S2 链锯强袭 (33/36 s): skill range, ATK/DEF +; hits on unblocked enemies drag them in front of her.
  // T1 战地巨斧: ATK/DEF +10 %, +4 % per extra blocked enemy. T2 医学背景: healing received +20 % (+40 % below 50 %).
  // Module (elite): ×1.1 vs blocked enemies.
  chess_char_5_18_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess);
    const force = num(bb['attack@force'], 1);
    const blockedMul = num(tb.atk_scale);
    return {
      skill: {
        kind: 'duration',
        mods: mods({ atkPct: num(bb.atk), defPct: num(bb.def), blockCnt: num(bb.block_cnt) }),
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
        attack: {
          onHit({ battle, unit, target }) {
            if (!target || !target.alive || target.side !== 'enemy' || target.blockedBy) return;
            battle.pullToFront(target, unit, force); // the official 力度 − 重量 pull (Battle.pullToFront)
          },
        },
      },
      trait: blockedMul > 1 ? { dmgMul: (b, u, t) => (t && t.blockedBy ? blockedMul : 1) } : undefined,
      talents: [
        { install(battle, unit) { // 战地巨斧
          const apply = () => {
            const extra = Math.max(0, unit.blocking.length - 1);
            if (unit.mem.axeN === extra && unit.findBuff('gvial2:axe')) return;
            unit.mem.axeN = extra;
            battle.addBuff(unit, { key: 'gvial2:axe', mods: mods({ atkPct: num(t0.atk) + num(t0.atk_add) * extra, defPct: num(t0.def) + num(t0.def_add) * extra }) });
          };
          battle.on('deploy', (c) => { if (c.unit === unit) { unit.mem.axeN = -1; apply(); } }, { owner: unit });
          whileOn(battle, unit, 0.2, apply);
        } },
        { install(battle, unit) { // 医学背景
          battle.on('heal', (c) => {
            if (c.target !== unit) return;
            c.amount *= unit.hpRatio < num(t1.hp_ratio, 0.5) ? num(t1.heal_scale_2, 1) : num(t1.heal_scale_1, 1);
          }, { owner: unit });
        } },
      ],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 玛恩纳 — librator (ramp to +200 % ATK while idle). S3 未照耀的荣光 (26 s, CUSTOM_RANGE): skill range, trait ×2, 5
  // targets at 125/150 % ATK phys, air units too (PRTS 备注 "※可对空"; player report B4 after 0.1.0: on a flying wave the
  // cast hit nothing for 26 s); enemies in range take +10/11 % of his ATK true damage from every Kazimierz attack. Per
  // PRTS 备注 the trait bonus drops by 10 % (per_kill_reduce, absolute: +400 % → +390 %) for each enemy knocked out by
  // his own attack (or the damage it carries — not 无动于衷's reflection, not a mark another operator's attack set off),
  // settled after that attack, never below +0 %. T1 游侠: ×1.1 ATK on attacks (×1.15 and −15 % damage taken with ≥3
  // enemies around). T2 无动于衷: taunt +1, Kazimierz ops reflect 15 % of his ATK as true damage when attacked.
  // S1 未声张的怒火 (duration, SEARCH): attacks attack@atk_scale × ATK, DEF +. S2 未宽解的悲哀 (duration): skill range,
  // BAT +0.3 s, attacks attack@atk_scale × ATK twice; a kill of his own attacks during the skill keeps the trait ramp
  // when it ends. S1 / S2 have no 对空 note: ground only, like his trait.
  chess_char_5_19_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1);
    const sid = selectedId(chess, def);
    const up = num(bb.trait_up, 1), perKill = num(bb.per_kill_reduce);
    // S3: the trait bonus = ramp × trait_up + per_kill_reduce × kills, ≥ 0 — the trait's own ramp buff stays, the
    // difference goes into `mlynar:traitUp` (negative once the kills take the bonus below the ramp)
    const applyUp = (battle, unit) => {
      const ramp = num(unit.trait.ramp);
      const extra = unit.mem.mlyUp ? Math.max(0, ramp * up + perKill * num(unit.mem.mlyKills)) - ramp : 0;
      if (extra) battle.addBuff(unit, { key: 'mlynar:traitUp', mods: { atkPct: extra } });
      else battle.removeBuff(unit, 'mlynar:traitUp');
    };
    /**
     * "仅自身普通攻击（与该次攻击附带的伤害）击倒非角色类单位" (PRTS S2 / S3 备注): `onKill(victim)` for each enemy he
     * knocks out, while his skill runs, that his current attack hit (or the mark it set off, tagged 'mlynarOwn') — so a
     * kill by the damage that attack carries (天马之枪, the 卡西米尔 bond's true damage, the mark) counts too, in any
     * hook order; `onAttack()` after each of his attacks ("加成降低于当次攻击后统一结算"), which also closes the set.
     * 无动于衷's reflection and a mark another operator's attack set off happen outside his attack: never counted.
     */
    const ownKills = (battle, unit, onKill, onAttack = null) => {
      const hit = new Set();
      battle.on('damaged', (c) => {
        if (c.source === unit && (c.dmg?.isAttack || (c.dmg?.tags || []).includes('mlynarOwn'))) hit.add(c.target);
      }, { owner: unit, priority: 1000 });
      battle.on('kill', (c) => { if (c.killer === unit && hit.has(c.victim) && c.victim.side === 'enemy' && unit.skill?.active) onKill(c.victim); }, { owner: unit });
      battle.on('attack', (c) => { if (c.attacker !== unit) return; hit.clear(); if (onAttack) onAttack(); }, { owner: unit });
    };
    return {
      skills: lazySkills({
        skchr_mlynar_1: () => ({ kind: 'duration', mods: mods({ defPct: num(bb.def) }), attack: { atkScale: num(bb['attack@atk_scale'], 1) } }),
        skchr_mlynar_2: () => ({
          kind: 'duration', mods: mods({ batPct: batPct(bb.base_attack_time, chess) }),
          targeting: skillRange(chess, def),
          attack: { atkScale: num(bb['attack@atk_scale'], 1), hits: 2 },
        }),
      }),
      skill: {
        kind: 'duration',
        targeting: { ...(skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : {}), canHitFly: true },
        attack: { atkScale: num(bb['attack@atk_scale'], 1), maxTargets: Math.max(1, num(bb['attack@max_target'], 1)) },
        onStart({ battle, unit }) {
          unit.mem.mlyUp = true; unit.mem.mlyKills = 0; unit.mem.mlyPending = 0;
          applyUp(battle, unit);
          battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id, r: 2, skill: 'mlynar' });
        },
        onEnd({ battle, unit }) { unit.mem.mlyUp = false; unit.mem.mlyPending = 0; battle.removeBuff(unit, 'mlynar:traitUp'); },
      },
      trait: { dmgMul: (b, u) => (num(u.mem.mlyNear) >= num(t0.cnt, 3) ? num(t0.atk_scale_up, 1) : num(t0.atk_scale_base, 1)) },
      talents: [
        { install(battle, unit) { // 游侠
          const dr = num(t0.damage_resistance);
          whileOn(battle, unit, 0.2, () => {
            unit.mem.mlyNear = battle.foesInRadius(unit.x, unit.y, AROUND_RADIUS).length;
            if (dr > 0 && unit.mem.mlyNear >= num(t0.cnt, 3)) battle.addBuff(unit, { key: 'mlynar:ranger', duration: 0.3, mods: { dmgTakenMul: 1 - dr } });
          });
        } },
        { install(battle, unit) { // 无动于衷
          permBuff(battle, unit, 'mlynar:unmoved', { taunt: num(t1.taunt_level) });
          const scale = num(t1.atk_scale);
          if (!(scale > 0)) return;
          battle.on('damaged', (c) => {
            const a = c.target, src = c.source;
            if (a.side !== 'ally' || !isOp(a) || !isKazimierz(a) || !src || src.side !== 'enemy' || !src.alive || !c.dmg?.isAttack) return;
            if (!on(unit) || leaderOf(battle, unit) !== unit) return;
            battle.dealDamage(unit, src, { amount: unit.s.atk * scale, type: 'true', canDodge: false, tags: ['talent', 'reflect'] });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        if (sid === 'skchr_mlynar_2') {
          // 技能期间若击倒敌人，技能结束时特性效果不重置: the librator trait resets the ramp on skillEnd (priority 0) —
          // remember it before and put it back after
          battle.on('skillStart', (c) => { if (c.unit === unit) unit.mem.mlyKeep = false; }, { owner: unit });
          ownKills(battle, unit, () => { unit.mem.mlyKeep = true; });
          battle.on('skillEnd', (c) => {
            if (c.unit === unit) unit.mem.mlyRamp = unit.mem.mlyKeep && c.reason !== 'death' ? num(unit.trait.ramp) : null;
          }, { owner: unit, priority: 100 });
          battle.on('skillEnd', (c) => {
            if (c.unit !== unit || unit.mem.mlyRamp == null) return;
            unit.trait.ramp = unit.mem.mlyRamp;
            unit.mem.mlyRamp = null;
            if (unit.trait.ramp > 0 && unit.alive) battle.addBuff(unit, { key: 'trait:libratorRamp', mods: { atkPct: unit.trait.ramp } });
          }, { owner: unit, priority: -100 });
        }
        if (sid && sid !== 'skchr_mlynar_3') return;
        ownKills(battle, unit, () => { unit.mem.mlyPending = num(unit.mem.mlyPending) + 1; }, () => {
          if (!unit.mem.mlyPending || !unit.mem.mlyUp) return;
          unit.mem.mlyKills = num(unit.mem.mlyKills) + unit.mem.mlyPending;
          unit.mem.mlyPending = 0;
          applyUp(battle, unit);
        });
        const extra = num(bb.atk_scale);
        if (!(extra > 0)) return;
        battle.on('damaged', (c) => {
          const src = c.source, e = c.target;
          if (!src || src.side !== 'ally' || !isOp(src) || !isKazimierz(src) || !c.dmg?.isAttack || c.type === 'element') return;
          if (e.side !== 'enemy' || !e.alive || !unit.skill?.active || !on(unit) || !inRange(unit, e)) return;
          const tags = src === unit ? ['skill', 'mlynarMark', 'mlynarOwn'] : ['skill', 'mlynarMark'];
          battle.dealDamage(unit, e, { amount: unit.s.atk * extra, type: 'true', canDodge: false, isSkill: true, tags });
        }, { owner: unit });
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 安洁莉娜 — slower (no normal attack while the skill is off). S3 秘杖·反重力模式 (14/18 s, SEARCH): every enemy on the
  // field is weightless, skill range, ATK +, 4/5 targets. T1 加速力场: all allies ASPD +7. T2 兼职工作: while the skill is
  // off, all allies regenerate 20 HP/s. Module (elite): longer sluggish (trait bb, profession tunables).
  // S1 秘杖·速充模式 (duration, attack SP): ATK +; she attacks normally with S1 ("技能未开启时无法普通攻击" is only in the
  // S2/S3 texts). S2 秘杖·微粒模式 (duration, SEARCH): attack interval ×base_attack_time ("极大幅度缩短": a positive value
  // described as a shortening is the new interval ratio, tier1 batMod convention), each attack damage_scale × ATK arts.
  // Module DEC-X (elite): SP +0.2/s with an enemy in range.
  chess_char_5_20_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tm = talent(chess, -1);
    const sid = selectedId(chess, def);
    const ratioBat = (v) => (num(v) > 0 && num(v) < 1 ? num(v) - 1 : batPct(v, chess));
    const weightless = (battle, unit) => {
      const left = Math.max(0.1, num(unit.skill?.timeLeft, 1));
      for (const e of battle.enemies) {
        if (!e.alive || e.findBuff('aglina:weightless')) continue;
        // 失重: weight −1 level (engine mod `massFlat`; massLevel never drops below 0)
        battle.addBuff(e, { key: 'aglina:weightless', status: 'weightless', visible: true, duration: left, data: { src: unit }, mods: { massFlat: -WEIGHTLESS_MASS } });
      }
    };
    return {
      skills: lazySkills({
        skchr_aglina_1: () => ({ kind: 'duration', mods: mods({ atkPct: num(bb.atk) }) }),
        skchr_aglina_2: () => ({ kind: 'duration', mods: mods({ batPct: ratioBat(bb.base_attack_time) }), attack: { atkScale: num(bb.damage_scale, 1) } }),
      }),
      skill: {
        kind: 'duration',
        mods: mods({ atkPct: num(bb.atk) }),
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
        attack: { maxTargets: Math.max(1, num(bb['attack@max_target'], 1)) },
        onStart({ battle, unit }) { unit.mem.aglAcc = 0; weightless(battle, unit); battle.fx('weightless', { x: unit.x, y: unit.y, id: unit.id }); },
        onTick({ battle, unit, dt }) { unit.mem.aglAcc += dt; if (unit.mem.aglAcc >= AURA_IV) { unit.mem.aglAcc = 0; weightless(battle, unit); } },
        onEnd({ battle, unit }) {
          for (const e of battle.enemies) { const b = e.findBuff('aglina:weightless'); if (b && b.data.src === unit) battle.removeBuff(e, b); }
        },
      },
      trait: sid === 'skchr_aglina_1' ? undefined : { noAttackUnlessSkill: true },
      install(battle, unit) { enemySpUp(battle, unit, 'aglina:module', num(tm.sp_recovery_per_sec)); },
      talents: [
        { install(battle, unit) { // 加速力场
          const aspd = num(t0.attack_speed);
          if (aspd) whileOn(battle, unit, AURA_IV, () => { for (const a of battle.alliesFor(unit)) battle.addBuff(a, { key: 'aglina:field', duration: AURA_DUR, mods: { aspd } }); });
        } },
        { install(battle, unit) { // 兼职工作
          const hp = num(t1.hp_recovery_per_sec);
          // an HP-regeneration attribute, so 禁疗 does not stop it — PRTS 备注 "生命回复的提供方式为增加目标的'生命回复速度'属性，
          // 不受治疗加成和禁疗影响" (异常效果 禁疗: "增减生命回复速度…的效果不会被识别为治疗类能力"); a 孤立 unit (炎佑) is not
          // selected (Battle.alliesFor)
          if (hp > 0) whileOn(battle, unit, AURA_IV, () => { if (!unit.skill?.active) for (const a of battle.alliesFor(unit)) battle.addBuff(a, { key: 'aglina:parttime', duration: AURA_DUR, mods: { hpRegen: hp } }); });
        } },
      ],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 寒檀 — S2 “女巫之泪” (15 s): skill range, BAT −2.4 s; attacks become icicles on random tiles of the range (cycling left
  // row → right row → own row): 65/75 % ATK arts + 1 s cold to every enemy within 1.5 of the impact. T1 生于冰寒: after 20 s on the field ATK +15 % and 抵抗 (negative
  // statuses on her last half as long).
  chess_char_5_21_a: (bb, chess, def) => {
    const t0 = talent(chess, 0);
    const scale = num(bb['attack@atk_scale'], 1), cold = num(bb['attack@cold']);
    const resist = Math.min(1, Math.max(0, -num(t0.one_minus_status_resistance)));   // share of the duration removed
    return {
      // S1 迅捷打击·γ型 (duration): ATK +, ASPD +.
      skills: lazySkills({
        'skcom_quickattack[3]': () => ({ kind: 'duration', mods: mods({ atkPct: num(bb.atk), aspd: num(bb.attack_speed) }) }),
      }),
      skill: {
        kind: 'duration',
        mods: mods({ batPct: batPct(bb.base_attack_time, chess) }),
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
        attack: { noAttack: true },
        onStart({ unit }) { unit.mem.iceCd = 0; unit.mem.iceRow = 0; },
        onTick({ battle, unit, dt }) {
          unit.mem.iceCd -= dt;
          if (unit.mem.iceCd > 0 || !unit.canAct || unit.s.flags.disarm) return;
          if (!battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).length) return;
          unit.mem.iceCd = unit.s.interval;
          // PRTS 备注: icicles fall on a random tile of ① the row on her left, ② the row on her right, ③ her own row, …
          let k = null;
          for (let i = 0; i < ICICLE_ROWS.length && k == null; i++) {
            const idx = (num(unit.mem.iceRow) + i) % ICICLE_ROWS.length;
            const lat = ICICLE_ROWS[idx];
            const keys = (unit.rangeKeys || []).filter((x) => toLocal(Math.floor(x / COLS) - unit.tileR, x % COLS - unit.tileC, unit.dir)[0] === lat);
            if (!keys.length) continue;
            k = battle.rng.pick(keys);
            unit.mem.iceRow = (idx + 1) % ICICLE_ROWS.length;
          }
          if (k == null) return;
          const r = Math.floor(k / COLS), c = k % COLS;
          unit.lastAttackAt = battle.time;
          unit.stats.attacks++; // "攻击变为…召唤冰凌": every icicle is one of her attacks
          battle.fx('iceSpike', { x: c, y: r, id: unit.id, r: ICICLE_RADIUS });
          battle.after(ICICLE_DELAY, () => {
            const hit = [];
            for (const e of battle.foesInRadius(c, r, ICICLE_RADIUS)) {
              battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', isAttack: true, isSkill: true, isSplash: true, tags: ['skill', 'iceSpike'] });
              if (e.alive && cold > 0) battle.applyStatus(e, 'cold', { duration: cold, source: unit });
              if (e.alive) hit.push(e);
            }
            // an icicle is an attack: "攻击时" effects (items, bonds) see it with the enemies it hit
            if (hit.length && battle.hasHook('attack')) battle.emit('attack', { attacker: unit, targets: hit, isSkill: true });
          }, { owner: unit });
        },
      },
      talents: [{ install(battle, unit) { // 生于冰寒
        const after = num(t0.interval, 20);
        // + 抵抗 (engine `resist` status: new control statuses last half as long, never compounding with other sources)
        whileOn(battle, unit, 0.5, () => {
          if (battle.time - unit.deployedAt < after - 1e-9 || unit.findBuff('sntlla:born')) return;
          battle.addBuff(unit, { key: 'sntlla:born', visible: true, mods: mods({ atkPct: num(t0.atk) }) });
          if (resist > 0) battle.applyStatus(unit, 'resist', { value: resist, source: unit });
        });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 妮芙 — S2 怵然震爆 (1/2 charges): next attack 270/300 % ATK arts + 4/5 s fear on the target and an equal arts splash
  // (projectile_range), every hit adding 18/22 % of its damage as apoptosis; targets in an apoptosis burst raise T1 to 70/85 %.
  // T1 失魂: hitting an enemy in an apoptosis burst → 40 % ATK elemental damage per second until the burst ends.
  // T2 窥心钥: an apoptosis burst in range → ATK +2 % (×10). Module (elite): ×damage_scale vs enemies in a burst.
  // S1 笞心击 (duration): ATK +; attacks add attack@ep_damage_ratio of their damage as 凋亡损伤 and, on a target in an
  // apoptosis burst, attack@extra_ep_damage_scale × ATK elemental damage. S3 心防溃决 (duration): skill range, ATK +,
  // ASPD +, 2 targets; attacks on a target in an apoptosis burst deal elemental damage (split_atk_scale × ATK, no arts).
  // Module PRI-Y (elite): SP +0.2/s while an enemy in range is in an element burst.
  chess_char_5_22_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess), tm = talent(chess, -1);
    const sid = selectedId(chess, def);
    const ep = num(bb.ep_damage_ratio, num(bb['attack@ep_damage_ratio'])), skillSoul = num(bb.element_atk_scale), soulBase = num(t0.element_atk_scale);
    const soul = (battle, unit, e, scale) => {
      const burst = e.findBuff('apoptosisBurst');
      if (!burst || !(scale > 0)) return;
      const key = `nymph:soul:${unit.id}`;
      const cur = e.findBuff(key);
      if (cur) { cur.data.scale = Math.max(num(cur.data.scale), scale); return; }
      battle.addBuff(e, {
        key, duration: Math.max(0.1, burst.timeLeft), interval: 1, data: { scale },
        onTick: ({ unit: x, buff }) => {
          if (!x.findBuff('apoptosisBurst')) { battle.removeBuff(x, buff); return; }
          elementHit(battle, unit, x, unit.s.atk * num(buff.data.scale), 'nymphSoul', 'apoptosis');
        },
      });
      battle.fx('soul', { x: e.x, y: e.y, id: e.id });
    };
    return {
      skills: lazySkills({
        skchr_nymph_1: () => ({ kind: 'duration', mods: mods({ atkPct: num(bb.atk) }) }),
        skchr_nymph_3: () => ({
          kind: 'duration', mods: mods({ atkPct: num(bb.atk), aspd: num(bb.attack_speed) }),
          targeting: skillRange(chess, def, { maxTargets: Math.max(1, num(bb['attack@max_target'], 2)) }),
          attack: { atkScale: num(bb['attack@split_atk_scale'], 1) },
        }),
      }),
      skill: {
        kind: maxCharges(chess, def) > 1 ? 'charges' : 'instant',
        attack: {
          atkScale: num(bb.atk_scale, 1), splashRadius: num(bb.projectile_range, 1.5),
          onHit({ battle, unit, target, x, y }) {
            if (target && target.alive) battle.applyStatus(target, 'fear', { duration: num(bb.fear), source: unit });
            battle.fx('aoe', { x, y, id: unit.id, r: num(bb.projectile_range, 1.5), skill: 'nymph' });
          },
        },
      },
      talents: [
        { install(battle, unit) { // 失魂 (+ the skill's apoptosis rider and 70 % upgrade)
          battle.on('damaged', (c) => {
            if (c.source !== unit || c.type === 'element' || c.target.side !== 'enemy' || !c.target.alive || !c.dmg) return;
            // (S1 has no attack override: its attacks are the skill's while it runs)
            const skillAtk = c.dmg.isSkill || (sid === 'skchr_nymph_1' && !!unit.skill?.active);
            // (not on a killing blow: the target is at 0 HP here — no burst on the corpse)
            if (skillAtk && c.dmg.isAttack && ep > 0 && c.amount > 0 && hasHp(c.target)) {
              battle.dealDamage(unit, c.target, { type: 'element', element: 'apoptosis', amount: c.amount * ep, tags: ['skill', 'nymph'] });
            }
            if (c.dmg.isAttack && c.target.alive) soul(battle, unit, c.target, c.dmg.isSkill ? Math.max(skillSoul, soulBase) : soulBase);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 窥心钥
          battle.on('elementBurst', (c) => {
            if (c.element !== 'apoptosis' || c.target.side !== 'enemy' || !on(unit) || !inRange(unit, c.target)) return;
            battle.addBuff(unit, { key: 'nymph:key', refresh: 'stack', maxStacks: Math.max(1, num(t1.max_stack_cnt, 10)), mods: { atkPct: num(t1.atk) } });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        burstDamageUp(battle, unit, num(tb.damage_scale));
        burstSpUp(battle, unit, 'nymph:module', num(tm.sp_recovery_per_sec));
        if (sid === 'skchr_nymph_1') { // S1: extra elemental damage on burst targets (the 凋亡 rider is T1's `ep`)
          const extra = num(bb['attack@extra_ep_damage_scale']);
          battle.on('damaged', (c) => {
            if (c.source !== unit || !unit.skill?.active || !c.dmg?.isAttack || c.type === 'element' || c.type === 'elemental') return;
            const e = c.target;
            if (e.side !== 'enemy' || !e.alive || !e.findBuff('apoptosisBurst') || !(extra > 0)) return;
            elementHit(battle, unit, e, unit.s.atk * extra, 'nymphLash', 'apoptosis');
          }, { owner: unit });
        }
        if (sid === 'skchr_nymph_3') { // S3: attacks on a burst target become elemental damage
          battle.on('hit', (c) => {
            if (c.source !== unit || !unit.skill?.active || !c.dmg.isAttack || !c.target || !c.target.findBuff('apoptosisBurst')) return;
            if (c.dmg.type !== 'arts' && c.dmg.type !== 'phys') return;
            c.dmg.type = 'elemental';
            c.dmg.element = 'apoptosis';
            c.dmg.canDodge = false;
            (c.dmg.tags ||= []).push('nymphBreak');
          }, { owner: unit, priority: -10 });
        }
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 录武官 — S2 一点关窍 (25 s): ATK +; healed allies get a 10 s buff healing 80/120 HP on every hit taken.
  // T1 学成于聚: an op in range starting a skill → +1 SP and ASPD +16 for 8 s. Module (elite): heals below 50 % ×1.15.
  // S1 触类旁通 (2/3 charges): the next heal restores heal_scale × ATK and heals max_target allies.
  chess_char_5_23_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), tb = traitBb(chess);
    const dur = num(bb['attack@buff_duration'], 10), value = num(bb['attack@fixed_heal_value']);
    return {
      skills: lazySkills({
        skchr_reckpr_1: () => ({ kind: instantKind(chess, def), heal: true, attack: { healScale: num(bb.heal_scale, 1), maxTargets: Math.max(1, num(bb.max_target, 2)) } }),
      }),
      skill: {
        kind: 'duration', heal: true,
        mods: mods({ atkPct: num(bb.atk) }),
        onHit({ battle, unit, target }) {
          // "治疗干员后为其施加一个增益": operators only (summons are 友方单位, not 干员)
          if (!target || !target.alive || !isOp(target) || !(value > 0)) return;
          battle.addBuff(target, { key: 'reckpr:guard', duration: dur, visible: true, data: { src: unit, value } });
        },
      },
      talents: [{ install(battle, unit) { // 学成于聚
        battle.on('skillStart', (c) => {
          const a = c.unit;
          if (a === unit || !isOp(a) || !on(unit) || !inRange(unit, a)) return;
          if (num(t0.prob, 1) < 1 && !battle.rng.chance(num(t0.prob, 1))) return;
          unit.skill?.gainSp(num(t0.sp), 'talent');
          if (num(t0.attack_speed)) battle.addBuff(unit, { key: 'reckpr:learn', duration: num(t0.duration, 8), mods: { aspd: num(t0.attack_speed) } });
        }, { owner: unit });
      } }],
      install(battle, unit) {
        battle.on('damaged', (c) => {
          const a = c.target;
          if (a.side !== 'ally' || !(c.amount > 0) || a.hp <= 0 || c.type === 'element' || isHpLoss(c.dmg)) return; // (not a 流失)
          const b = a.findBuff('reckpr:guard');
          if (b && b.data.src === unit) battle.heal(unit, a, num(b.data.value));
        }, { owner: unit });
        lowHpHealUp(battle, unit, tb);
      },
    };
  },
};

export default KITS;
