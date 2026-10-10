// server/sim/content/enemies/archetypes.js — ability archetypes of the enemy kits (split from content/enemies.js; the
// module map is in its header): stealth, splashAttack, deathBoom, refraction, float, prisoner, reborn, frontGuard,
// unbalanced, artsBarrier, husk, statue, bleed, pollution, dmgZone, skill(), blinkForward … and the archetype kits
// reused by several keys (kitEp, kitTimes …).

import { MOVE_SCALE, COLS, STEALTH_RESTORE } from '../../constants.js';
import {
  HUSK_REBIRTH, BOOM_RADIUS, POLLUTION_INTERVAL, STEALTH_RESTORE_BY_KEY, DUCK_STEALTH_RESTORE, nthOf, stOf, safe, num, T, elem, hurt,
  areaAllies, areaAlliesInTiles, zone, spawnChildren, stepToward, setHits, hitCount, setForm, absorbArts, auraBuff,
  unbalancedNow,
} from './helpers.js';
import { hypot } from '../../detmath.js';

// ---------------------------------------------------------------------------------------------------------------
// archetypes

/**
 * 隐匿: permanent stealth. Blocked it is lifted; it hides again STEALTH_RESTORE s after the block ends, or after its own
 * "（解除阻挡N秒后恢复）" (STEALTH_RESTORE_BY_KEY → buff `data.stealthRestore`; Battle._stealthSwitch) — a 鸭爵 swap (tag
 * 'duck') no sooner than DUCK_STEALTH_RESTORE s (the owner's decision of 2026-10-07, a deliberate deviation).
 */
const stealth = () => ({
  spawn(b, e, a, ab) {
    let n = STEALTH_RESTORE_BY_KEY[ab.key];
    if (e.tag === 'duck' && (n ?? STEALTH_RESTORE) < DUCK_STEALTH_RESTORE) n = DUCK_STEALTH_RESTORE;
    b.addBuff(e, { key: 'ab:stealth', flags: { stealth: true }, persist: true, data: n != null ? { stealthRestore: n } : {} });
  },
});

/** 无法被阻挡. */
const unblockable = () => ({ spawn(b, e) { b.addBuff(e, { key: 'ab:unblockable', flags: { unblockable: true }, persist: true }); } });

/**
 * "受到伤害时开始奔跑，移动速度+N%" (鸭爵 `run.attack@move_speed`): the first damage it takes ⇒ move speed ×(1 + v) for good —
 * PRTS 鸭爵 天赋 "移动速度+400%" for v 4, PRTS 卫戍协议：盟约 下半/PRTS盟约记录 鸭爵 备注 "受伤后移动速度+300%" for the act2 v 3.
 */
const runWhenHit = (v) => ({ taken(c, b, e, a) { if (a.on || !(v > 0)) return; a.on = true; b.addBuff(e, { key: 'ab:duckRun', persist: true, mods: { moveMul: 1 + v } }); } });

/**
 * 频次 (the 14 器物 keys, kitTimes): maxHp = hits = the data's max HP × the spawn's HP multiplier. The round effects reach
 * these units like any enemy (攻坚装备 / II / III leave out only 炎佑), but not 补给线 / 补给线II, whose `enemy_exclude` lists
 * exactly these 14 keys (activity_table aceffect_enemy_2 / 2_2, data/effects.json): that share (`mods.supplyHpMul`, co-op
 * 终极 R5–R15) comes out again — a 频次 enemy's death spawn inherits the parent's mods, so it travels with them. Whole hits:
 * setHits rounds [ASSUMED: no source says how a fractional count rounds]. Until 0.2.1 the count was the data's whatever
 * the difficulty (PR #272).
 */
const times = (artsOnly = false) => ({
  spawn(b, e) {
    const s = Number(e.mods && e.mods.supplyHpMul);
    setHits(e, e.base.maxHp / (Number.isFinite(s) && s > 0 ? s : 1));
    hitCount(b, e, true, artsOnly);
  },
});

/** "只能被阻挡数大于等于N的单位阻挡". */
const blockWeight = (n) => ({ spawn(b, e) { e.blockWeight = n; } });

const taunt = (n) => ({ spawn(b, e) { if (n) b.addBuff(e, { key: 'ab:taunt', mods: { taunt: n }, persist: true }); } });

const maxTargets = (n) => ({ spawn(b, e) { if (n > 1) e.profile.maxTargets = n; } });

/** Element damage on every attack hit: ATK × ratio. */
const ep = (el, ratio, sil = false) => ({ sil, dealt(c, b, e) { if (ratio > 0) elem(b, e, c.target, el, e.s.atk * ratio); } });

/** Status on every attack hit. */
const onHitStatus = (key, dur, value) => ({ dealt(c, b, e) { if (dur > 0) b.applyStatus(c.target, key, { duration: dur, source: e, value }); } });

/**
 * A normal attack that splashes around its target (PRTS: "对主目标造成…普通伤害，对溅射目标造成…溅射伤害"): 碎骨's grenade,
 * “巨大的丑东西” / “墓碑”'s unblocked ranged attack, 烹泉 / 沏虹's attack, 集团军重型火炮's shell. Its mode is fixed when the
 * attack starts (`before`): `unblocked` = only an attack begun while not blocked splashes (the others are the plain melee
 * hit at `meleeScale`). The main target takes the engine's attack at `scale` × ATK (e.profile.atkScale, a normal attack:
 * on-hit effects apply); when it lands (the main hit's 'hit', before its dodge) the others around the target take
 * `scale` × ATK as a splash — an area selection (areaAllies / areaAlliesInTiles: no 隐匿 ally, the blocker included
 * (GitHub #97), no airborne 起飞 one for a ground enemy; 迷彩 is not checked — DESIGN §22.12). `tiles` 1 = the target's tile and
 * its 8 neighbours (格子判定), else `radius` around the target (中点判定). `noAir`: "不可对空" (a flying ally — the 炎佑
 * dragon — is skipped; without it "可溅射飞行单位"). `dodge`: the splash hits may be dodged (烹泉 / 沏虹, whose PRTS 天赋 calls
 * them 法术普通伤害 — a normal attack's damage); a 溅射伤害 splash cannot. `onEach(b, e, u)` runs on every unit hit (the target
 * after its damage).
 */
function splashAttack({ scale = 1, meleeScale = 1, unblocked = true, tiles = 0, radius = 0, noAir = false, dodge = false, fxKind = 'splash', onEach = null } = {}) {
  return {
    before(c, b, e, a) { a.splash = !unblocked || !e.blockedBy; e.profile.atkScale = a.splash ? scale : meleeScale; },
    hitOut(c, b, e, a) {
      const t = c.target;
      if (!a.splash || !c.dmg.isAttack || !t) return;
      b.fx('explode', { x: t.x, y: t.y, r: tiles > 0 ? tiles + 0.5 : radius, kind: fxKind, ...(tiles > 0 ? { tiles: 'box' } : {}) });
      const area = tiles > 0 ? areaAlliesInTiles(b, e, t.tileR, t.tileC, 'box', tiles) : areaAllies(b, e, t.x, t.y, radius);
      for (const u of area) {
        if (u === t || (noAir && u.isFlying)) continue;
        hurt(b, e, u, e.s.atk * scale, c.dmg.type, { tags: ['splash'], canDodge: dodge });
        if (onEach && u.alive) onEach(b, e, u);
      }
    },
    dealt(c, b, e, a) { if (a.splash && onEach && c.target.alive) onEach(b, e, c.target); },
  };
}

/**
 * Tile keys of an enemy's path up to its next checkpoint, its own tile included (PRTS “复仇者” 冲锋 "位于自身下个检查点前的后续
 * 路径上(包含自身当前所在地块)"): the tiles its current move leg crosses — the straight segments through the leg's smoothed
 * waypoints (ai.js planLeg; the last one is the leg's checkpoint), sampled every quarter tile.
 */
function pathKeysAhead(e) {
  const keys = new Set([Math.round(e.y) * COLS + Math.round(e.x)]);
  const R = e.route;
  if (!R || !Array.isArray(R.pts)) return keys;
  let x = e.x, y = e.y;
  for (let i = R.ptIdx ?? 0; i < R.pts.length; i++) {
    const p = R.pts[i], n = Math.max(1, Math.ceil(hypot(p.x - x, p.y - y) * 4));
    for (let k = 1; k <= n; k++) keys.add(Math.round(y + ((p.y - y) * k) / n) * COLS + Math.round(x + ((p.x - x) * k) / n));
    x = p.x; y = p.y;
  }
  return keys;
}

/** "不会攻击飞行单位" (an engine candidate filter, ai.js enemyAttack: the 炎佑 dragon is a flying ally). */
const noAirTargets = () => ({ spawn(b, e) { e.profile.canTarget = (u) => !u.isFlying; } });

/**
 * 抵抗 (ba.buffres, the engine `resist` status: control durations halved, 麻痹 loses 1 stack every 5 s) + optional
 * immunities. Value from the talent's `Buff.one_minus_status_resistance` when present (−0.5 ⇒ half).
 */
const resist = (immune = []) => ({
  spawn(b, e, a, ab) {
    const v = -(T(ab, 'Buff.one_minus_status_resistance') ?? -0.5);
    b.applyStatus(e, 'resist', { source: e, value: v > 0 ? Math.min(1, v) : 0.5 });
    if (immune.length) ab.immune = new Set([...(ab.immune || []), ...immune]);
  },
});

const immuneTo = (...keys) => ({ spawn(b, e, a, ab) { ab.immune = new Set([...(ab.immune || []), ...keys]); } });

/** Every Nth attack: status on the targets ("攻击2次后，下一次攻击会晕眩目标"). */
const nthAttackStatus = (n, key, dur, sil = true) => ({
  sil,
  spawn(b, e, a) { a.n = 0; },
  attack(c, b, e, a) {
    a.n++;
    if (a.n % n) return;
    for (const t of c.targets) {
      if (!t.alive || !(dur > 0) || (c.targetDeployments && c.targetDeployments.get(t) !== t.deploySeq)) continue;
      b.applyStatus(t, key, { duration: dur, source: e });
    }
  },
});

/** Every Nth attack deals ×scale (+ optional element). */
const nthAttackPower = (n, scale, el = null, ratio = 0) => ({
  spawn(b, e, a) { a.n = 0; a.power = false; },
  before(c, b, e, a) { a.power = (a.n + 1) % n === 0; },
  hitOut(c, b, e, a) { if (a.power && c.dmg.isAttack) c.dmg.amount *= scale; },
  dealt(c, b, e, a) { if (a.power && el && ratio > 0) elem(b, e, c.target, el, e.s.atk * ratio); },
  attack(c, b, e, a) { a.n++; },
});

/** Aura on other enemies within r: timed buff refreshed every iv s. */
const enemyAura = (r, key, mods, sil = true, iv = 0.5) => ({
  sil, iv,
  tick(b, e) { for (const o of b.enemiesInRadius(e.x, e.y, r)) if (o !== e) auraBuff(b, o, key, iv, mods); },
});

/**
 * Aura on allies within r — every ally there, 隐匿 ones included: its one user, 寒霜, is PRTS's own example of an enemy
 * debuff that "无视隐匿状态起作用" (PRTS 作战机制 §隐匿与Buff的关系: "敌方寒霜的攻速下降Debuff").
 */
const allyAura = (r, key, mods, sil = true, iv = 0.5, flags = null) => ({
  sil, iv,
  tick(b, e) { for (const u of b.alliesInRadius(e.x, e.y, r)) auraBuff(b, u, key, iv, mods, flags, true); },
});

/** Self ATK buff once HP first drops below ratio. */
const lowHpBuff = (ratio, mods, key = 'ab:lowhp') => ({
  taken(c, b, e, a) {
    if (a.on || !(e.hpRatio < ratio)) return;
    a.on = true;
    b.addBuff(e, { key, mods, persist: true, visible: true });
  },
});

/** Death spawn ("被击倒后生成N个<X>"). */
const deathSpawn = (key, cnt, extra = {}) => ({
  death(c, b, e) { if (c.reason === 'killed' && key && cnt > 0) spawnChildren(b, e, key, cnt, extra); },
});

/**
 * Death explosion on the allies within r it can select (areaAllies — PRTS 高能源石虫 / 冰爆源石虫 / 卷心籽 死亡爆炸 "…无视迷彩，
 * 不可对空", no 无视无法选择: a 隐匿 ally is spared; the dead enemy blocks nobody). `noAir` (default — all three say so):
 * a flying ally (the 炎佑 dragon) is skipped; until 0.2.1 it took the blast (community report: 炎祐吃到了不该吃到的地面伤害).
 */
const deathBoom = ({ scale, type = 'phys', r = BOOM_RADIUS, status = null, sil = true, cond = null, noAir = true }) => ({
  sil,
  death(c, b, e, a) {
    if (c.reason !== 'killed' || (cond && !cond(e, a))) return;
    const atk = e.s.atk;
    b.fx('explode', { x: e.x, y: e.y, r, kind: 'deathBoom', id: e.id });
    for (const u of areaAllies(b, e, e.x, e.y, r)) {
      if (noAir && u.isFlying) continue;
      if (scale > 0) hurt(b, e, u, atk * scale, type);
      if (status && u.alive) b.applyStatus(u, status.key, { duration: status.dur, source: e, value: status.value });
    }
  },
});

/** 折射: RES +v (and optional max HP +hpPct) while not silenced. */
const refraction = (res, hpPct = 0) => ({
  silAware: true,                                                    // SILENCE-flagged: silence switches it off in tick()
  tick(b, e, a) {
    const on = !e.s.flags.silence;
    if (on === a.on) return;
    a.on = on;
    if (on) b.addBuff(e, { key: 'ab:refraction', mods: hpPct ? { resFlat: res, hpPct } : { resFlat: res }, persist: true, visible: true });
    else b.removeBuff(e, 'ab:refraction');
  },
});

/**
 * 近地悬浮 (ba.float "无法被阻挡或近战攻击"; PRTS 术语释义: "此类效果开始时，单位强制解除阻挡，随后行动方式变为飞行（算作空中
 * 单位）… 无论飞行与否，单位只会采用地面寻路"): while floating the enemy carries the 'ab:float' buff — unblockable, an air unit for
 * every targeting / ground-only rule (flag `float` ⇒ Unit.isFlying: melee operators, 迷迭香's ground-only shots and
 * splash, ground traps and terrain skip it; ranged attacks hit it) with 失衡免疫 (`noDisplace`, "初始模式：近地悬浮，失衡
 * 免疫" on the enemies' PRTS pages) — its `motion` stays WALK, so it keeps the ground path (and 浮空 can still lift it:
 * Battle.applyStatus refuses data flyers only). Losing the float is each
 * enemy's own ability (PRTS; 缚地 "使部分近地悬浮敌人掉落" is "实为敌人自身的能力"): kitSyufo, kitParrot. 喷气人's 飞行模式 is
 * the same state for 7 s (its 'ab:takeoff' buff carries the flags; kitLeaderMisc).
 */
const FLOAT_KEY = 'ab:float';

const setFloat = (b, e, on) => {
  if (on) b.addBuff(e, { key: FLOAT_KEY, flags: { unblockable: true, float: true, noDisplace: true }, persist: true });
  else b.removeBuff(e, FLOAT_KEY);
};

const float = () => ({ spawn(b, e) { setFloat(b, e, true); } });

/** The enemies whose kit spawns them hovering (float()): the match's bot counts them as air units (bot.js fieldModel). */
export const HOVER_KEYS = Object.freeze(['enemy_2025_syufo', 'enemy_10045_parrot']);

/**
 * "生命值首次降至一半以下时，在数秒内陷入恐惧" (SelfFear; PRTS “萨科塔之翼/之眼/昂首” "生命值首次低于50%时，对自身施加持续5s的恐惧，
 * 在5s内移动速度最终提升至150%"). The fear's source is the enemy itself, so it has no 恐惧可达地块: for SelfFear.fear s it
 * flies to random points of its own tile (±0.25) at ×move_speed — the engine's 恐惧 movement (fear.js; user playtest #6
 * item 13, "小范围乱飞") — then flies on along its route.
 */
const selfFear = (ab) => ({
  taken(c, b, e, a) {
    if (a.done || !(e.hpRatio < 0.5)) return;
    a.done = true;
    const fear = T(ab, 'SelfFear.fear') ?? 0;
    if (fear > 0) b.applyStatus(e, 'fear', { duration: fear, source: e });
    // PRTS “萨科塔之翼/之眼”: "在5s内移动速度最终提升至150%" — move_speed 1.5 is the final multiplier
    const ms = T(ab, 'SelfFear.move_speed') ?? 0, sd = T(ab, 'SelfFear.speed_duration') ?? 0;
    if (ms > 0 && sd > 0) b.addBuff(e, { key: 'ab:fearRun', duration: sd, mods: { moveMul: ms }, flags: { unblockable: true } });
  },
});

/**
 * Prisoners (孤岛风云: 禁锢 → 解放). The official battle prefabs (local client battle/enm_pfb_*.ab) have three modes and the
 * buff templates (buff_template_data enemy_confinement, enemy_confinement[atk_cnt], enemy_liberty_listener[warning]) move
 * between them: the 禁锢终端 starts with `confinement.times` charges; before each attack (ON_BEFORE_ATTACK — here the
 * `before` hook: an attack 麻痹 interrupts never gets there, PRTS 拳师囚犯 "在持有麻痹的情况下，攻击不计数") one is spent, and
 * the one that leaves a single charge switches it to mode R, the warning — still confined, its collar light blinking
 * orange; before the next attack it switches to mode L, 【解放】, so the times-th attack already hits freed (PRTS
 * "进行第4次攻击前，切换至解放状态"; until 0.2.0 it was freed after that attack's damage). The model follows the mode
 * (setForm: UnitInfo `form`, render/units.js FORMS): the manifest's clips are the grey confined set, 'warning' the orange
 * set, 'liberty' the red one — the 'liberate' fx carries it (a community report of 2026-10-06: they came out of the gate
 * drawn freed and never changed).
 */
function prisoner(ab, { freeAll = false } = {}) {
  const t = (k) => T(ab, k) ?? 0;
  const times = Math.max(1, Math.round(T(ab, 'confinement.times') ?? 4));
  const liberate = (b, e, a) => {
    if (a.free || !e.alive) return;
    a.free = true;
    b.removeBuff(e, 'ab:confined');
    b.addBuff(e, { key: 'ab:liberty', persist: true, visible: true, mods: {
      atkPct: t('liberty.atk'), defIgnorePct: t('liberty.def_penetrate'), resFlat: t('liberty.magic_resistance'), hpRegen: t('liberty.hp_recovery_per_sec') } });
    setForm(b, e, 'liberty', 'liberate');
    if (freeAll && !stOf(b).freedAll) {
      // "第一次解放时同时解放全场敌人"
      stOf(b).freedAll = true;
      for (const o of b.aliveEnemies()) for (const x of (o.mem.ab ? o.mem.ab.list : [])) if (x.liberate && !x.free) x.liberate(b, o, x);
    }
  };
  return {
    liberate,
    spawn(b, e, a) {
      a.n = 0; a.free = false;
      b.addBuff(e, { key: 'ab:confined', persist: true, visible: true, mods: { aspd: t('confinement.attack_speed'), defFlat: t('confinement.def') } });
    },
    before(c, b, e, a) {
      if (a.free) return;
      if (++a.n >= times) liberate(b, e, a);
      else if (a.n === times - 1) setForm(b, e, 'warning');
    },
  };
}

/** Free every confined prisoner on the field (重犯's first liberation, 杰斯顿's killer form). */
function freeAllPrisoners(b) {
  for (const o of b.aliveEnemies()) for (const x of (o.mem.ab ? o.mem.ab.list : [])) if (x.liberate && !x.free) x.liberate(b, o, x);
}

/**
 * 重生 "清空自身身上除白名单外所有Buff" (PRTS 特殊机制 §重生): at a 重生 (reborn(), husk(), statue()) the enemy loses every
 * buff an operator / summon / device put on it and every source-less catalogue status (晕眩, 减速, 恐惧, 脆弱, 诱导 … —
 * buffs.js STATUS). Kept [ASSUMED: the whitelist]: its talents and traits (`persist` buffs, and what it or another enemy
 * gave it — 锏's 抵抗 is a self-applied status, enemy auras refresh every few tenths of a second anyway) and the field's
 * state buffs without a source (on-tile terrain, airflow — re-applied by position — and element burst locks). Without it
 * a 逐火 knocked out while feared (叙拉古 / 妮芙: 恐惧 makes it unblockable) stayed unblockable — so, 隐匿, untargetable —
 * as an ember until the fear ran out. 活性源石's lasting effect (devices.js touchInfection) is no field state but a timed
 * buff that outlives the tile, so it is cleared like any buff (PRTS 特殊机制 非首次标记: "如无特殊说明，也默认同常规Buff一样
 * 可被重生清除"); contact gives it again while the enemy stands on the tile. Kept, its 1 s ticks — each a hit of a husk's
 * 特殊生命值 — killed a 逐火 ember that had crossed the tile long before it could stand up (review of GitHub #33 item 6).
 */
/**
 * The end of a 重生 (PRTS 特殊机制 §重生 "重生结束时，重置自身的通用技能与当前形态的技能冷却为初始冷却"): every ability with a
 * cooldown starts again from its initial cooldown (until 0.1.1 the countdowns ran on through the 重生).
 */
function rebirthCooldowns(e) {
  for (const s of (e.mem.ab && e.mem.ab.list) || []) if (s.cd != null) s.left = num(s.icd, 0);
}

/** devices.js' lasting 活性源石 effect: a timed buff, not field state — cleared at a 重生 (rebirthCleanse). */
const INFECTION_BUFF = 'terrain:infection';

function rebirthCleanse(b, e) {
  for (const x of e.buffs.slice()) {
    if (x.persist || (x.source && x.source.side === 'enemy')) continue;
    if (x.source || x.status || x.key === INFECTION_BUFF) b.removeBuff(e, x);
  }
}

/**
 * "首次被击倒后重生 / 进入第二形态": the first knock-out is hidden (kill credit and bounty wait for the real death) and starts
 * a rebirth of `dur` s — statuses cleared (rebirthCleanse), invulnerable, untargetable, released by its blocker, inert
 * (no move / attack / skill).
 * `onKo(b, e, a)` runs at once (self-destruct, freeing prisoners …), `during(b, e, a, elapsed)` every tick of it; then the
 * enemy stands up with `hpRatio` of its max HP, `onReborn(b, e, a)` switches the form and `invincible` s of 无敌 follow.
 * `a.state`: undefined → 'reborn' → 'form2'. The 'telegraph' fx of the knock-out carries `form: 'reborn'` and the 'revive'
 * fx `form: 'form2'`: models with those clip sets (render/units.js FORMS — 锏, 扎罗, “复仇者”, 杰斯顿) play them.
 */
function reborn({ dur = 0, hpRatio = 1, invincible = 0, onKo = null, during = null, onReborn = null, key = 'ab:reborn' } = {}) {
  const finish = (b, e, a) => {
    if (!e.alive || a.state !== 'reborn') return;
    a.state = 'form2';
    b.removeBuff(e, key);
    e.profile.noAttack = a.noAtk;
    if (onReborn) safe(b, e, () => onReborn(b, e, a));
    e.hp = Math.max(1, e.s.maxHp * Math.max(0, Math.min(1, hpRatio)));
    if (invincible > 0) b.addBuff(e, { key: `${key}:inv`, duration: invincible, visible: true, flags: { invulnerable: true } });
    if (e.route) e.route.pts = null;
    e.atkCd = 0;
    rebirthCooldowns(e);
    setForm(b, e, 'form2', 'revive', { kind: 'reborn' });
  };
  return {
    killed(c, b, e, a) {
      if (a.state) return false;
      a.state = 'reborn';
      a.t0 = b.time;
      a.noAtk = e.profile.noAttack;
      e.unbalanceUntil = -Infinity;   // a 重生 is a forced state change: it ends a 失衡 (PRTS 失衡位移机制 「例如复活」)
      rebirthCleanse(b, e);
      e.hp = Math.min(1, e.s.maxHp);
      if (onKo) safe(b, e, () => onKo(b, e, a));
      if (!(dur > 0)) { finish(b, e, a); return true; }
      e.profile.noAttack = true;
      b.addBuff(e, {
        key, duration: dur, visible: true, persist: true,
        flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true, stun: true },
        onTick: during ? ({ battle }) => during(battle, e, a, battle.time - a.t0) : null,
        onExpire: ({ battle }) => finish(battle, e, a),
      });
      setForm(b, e, 'reborn', 'telegraph', { r: 1, dur, kind: 'reborn' });
      return true;
    },
  };
}

/** 正面减伤: phys/arts damage from allies in front of the enemy (`a.facing` side) × (1 − cut); `face` updates a.facing. */
function frontGuard(cut, face) {
  return {
    spawn(b, e, a) { a.facing = -1; a.px = e.x; },
    tick(b, e, a) { face(b, e, a); },
    hitIn(c, b, e, a) {
      const s = c.source, ty = c.dmg.type;
      if (!s || s.side !== 'ally' || (ty !== 'phys' && ty !== 'arts') || !(cut > 0)) return;
      if ((s.x - e.x) * a.facing > 1e-6) c.dmg.mul *= Math.max(0, 1 - cut);
    },
  };
}

/** Faces its walking direction (horizontal component; keeps the last one while standing). */
const faceMove = (b, e, a) => { const dx = e.x - a.px; if (Math.abs(dx) > 1e-6) a.facing = dx > 0 ? 1 : -1; a.px = e.x; };

/** "始终面向我方干员数量较多的方向": the side with more deployed operators (ties keep the current facing; PRTS 圆仔 "无视其可选性":
 *  隐匿 operators count). */
const faceCrowd = (b, e, a) => {
  let l = 0, r = 0;
  for (const u of b.allies()) { if (u.kind !== 'op') continue; if (u.x > e.x + 1e-6) r++; else if (u.x < e.x - 1e-6) l++; }
  if (r !== l) a.facing = r > l ? 1 : -1;
};

/**
 * 失衡 (unbalanced movement): being pushed / pulled by operators. battle.displace() has no hook, so it is detected as
 * movement beyond the enemy's own route speed between two ticks (teleport legs excluded). `onMove(b, e, a, tiles)`.
 */
function unbalanced(onMove) {
  return {
    tick(b, e, a, dt) {
      const px = a.px, py = a.py, hid = a.hid;
      a.px = e.x; a.py = e.y; a.hid = e.hidden;
      if (px == null || hid || e.hidden) return;
      const own = e.s.moveSpeed * MOVE_SCALE * dt * 1.5 + 1e-3;
      const extra = hypot(e.x - px, e.y - py) - own;
      a.lx = px; a.ly = py;                                          // where the move started (direction for onMove)
      if (extra > 0.05) onMove(b, e, a, extra);
    },
  };
}

/** An arts-only barrier ("吸收法术伤害的屏障") of `amount`; `a.left` = what is left, `refresh(b, e)` restores it. */
function artsBarrier(amount, { key = 'ab:artsBarrier', whileUp = null } = {}) {
  return {
    refresh(b, e, a) {
      a.left = amount;
      b.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'artsBarrier', value: amount });
      if (whileUp) b.addBuff(e, { key, persist: true, visible: true, mods: whileUp });
    },
    spawn(b, e, a) { if (amount > 0) a.refresh(b, e, a); },
    hitIn(c, b, e, a) {
      if (!(a.left > 0)) return;
      a.left -= absorbArts(c, a.left);
      if (a.left > 1e-6) return;
      a.left = 0;
      b.fx('shieldBreak', { x: e.x, y: e.y, id: e.id });
      // the bonus it grants ends once the overflow of the breaking hit has landed (never before: an HP bonus removed
      // first would rescale HP and make the overflow count twice)
      if (c.dmg.cancel) b.removeBuff(e, key); else a.breaking = true;
    },
    taken(c, b, e, a) { if (a.breaking) { a.breaking = false; b.removeBuff(e, key); } },
  };
}

/**
 * "被击倒时暂时变为…，一段时间后重生" (talent Revive[Trigger]: 逐火 embers, 假想敌：再生's puppet). A knock-out of the first form is
 * no kill (credit, bounty and the kill count wait for the real death): HUSK_REBIRTH s of 重生 first — statuses cleared
 * (rebirthCleanse: a feared warrior is no unblockable ember), invulnerable, untargetable, unblockable, immobile, 失衡免疫
 * (PRTS 深池逐火战士 天赋 "被击倒后重生，持续1s，随后变为怨恨的余烬，1s内不移动且持有无敌+无法阻挡+失衡免疫"; PRTS 特殊机制 §重生) —
 * then the husk until `delay` s after that: `hits` HP of 特殊生命值机制 (every damage instance removes 1 — PRTS 特殊机制
 * §特殊生命值机制; engine flag hitCount), no attack (缴械), walking its route on — 隐匿 (`stealthy`: targetable only while
 * blocked and for 3 s after a block ends, the block the knock-out itself releases included — targeting.js
 * enemyStealthed; drawn solid meanwhile) and / or unblockable (`unblock`: 再生's 傀儡 "不可被阻挡"). Killing the husk is
 * the real death; a husk still standing after `delay` s stands up in its first form with full HP, and every later
 * knock-out starts it again ("一次又一次地站起").
 * `onHusk(b, e)` runs as the husk begins, after the 重生 ("进入此形态时": 再生's shields).
 * User report after 0.1.0 (#8): the v2.5 ember stood still, stealthed AND unblockable — nobody could ever target it.
 * fx (setForm): 'ember' {id, hits, dur, form: 'husk'} at the knock-out, 'revive' {id, form: 'revived'} when it stands
 * up (the renderer switches the model's clip set: render/units.js FORMS).
 */
function husk({ hits, delay, stealthy = true, unblock = false, onHusk = null, key = 'ab:ember' }) {
  const revive = (b, e, a) => {
    if (!e.alive || a.state !== 'husk') return;
    a.state = null;
    hitCount(b, e, false);
    e.base.maxHp = a.max;
    e.markDirty();
    void e.s;
    e.hp = e.s.maxHp;
    e.profile.noAttack = a.noAtk;
    b.removeBuff(e, key);
    b.removeBuff(e, `${key}:reborn`);
    if (e.route) e.route.pts = null;
    e.atkCd = 0;
    setForm(b, e, 'revived', 'revive');
  };
  return {
    killed(c, b, e, a) {
      // an HP loss (流失 bypasses 无敌) during the 1 s 重生 cannot cut it short
      if (a.state === 'husk' && b.time < a.rebornUntil) { e.hp = e.s.maxHp; return true; }
      if (a.state === 'husk' || !(hits > 0) || !(delay > 0)) return false;   // the husk's knock-out is the real death
      a.state = 'husk';
      a.rebornUntil = b.time + HUSK_REBIRTH;
      e.unbalanceUntil = -Infinity;   // a 重生 is a forced state change: it ends a 失衡 (PRTS 失衡位移机制 「例如复活」)
      a.noAtk = e.profile.noAttack;
      a.max = a.max ?? e.base.maxHp;
      rebirthCleanse(b, e);
      e.profile.noAttack = true;
      e.lastAttackAt = -Infinity;                         // the snapshot shows no attack of the fallen warrior
      setHits(e, hits);
      hitCount(b, e, true);
      b.addBuff(e, { key, visible: true, persist: true, flags: { disarm: true, ...(stealthy ? { stealth: true } : {}), ...(unblock ? { unblockable: true } : {}) } });
      b.addBuff(e, { key: `${key}:reborn`, duration: HUSK_REBIRTH, flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true, noDisplace: true } });
      // the 重生's 无法阻挡 ends a block at once (as applyStatus does for a status): a warrior knocked out while blocked
      // leaves an ember whose 隐匿 is switched off until STEALTH_RESTORE (3) s after that block ended
      // (Battle._stealthSwitch) — ~2 s after the 1 s 重生, which stays 无敌 + untargetable — so ranged operators and
      // operator splash can finish it although its blocker took the next warrior meanwhile (players after 0.1.1: "the
      // stealth monster revives forever"). [ASSUMED] the order: the 重生's cleanse first, then the ember's 隐匿 with the
      // block-end switch (PRTS documents neither the order of 重生 vs that switch nor whether it survives the 重生)
      b._unblock(e);
      if (e.route) e.route.pts = null;
      setForm(b, e, 'husk', 'ember', { hits, dur: HUSK_REBIRTH + delay });
      b.after(HUSK_REBIRTH, () => { if (e.alive && a.state === 'husk') { rebirthCooldowns(e); if (onHusk) onHusk(b, e); } }, { owner: e });
      b.after(HUSK_REBIRTH + delay, () => revive(b, e, a), { owner: e });
      return true;
    },
  };
}

/**
 * 守墓石像 / 愤怒的守墓石像 (PRTS 天赋): 地面模式 — melee attacks only while blocked; the first defeat is an instant 重生
 * (statuses cleared: rebirthCleanse) to 100 % HP into 转换模式 for stone.duration s — "无法被阻挡，自缚，失衡免疫，免疫浮空。
 * 防御力增加800，法术抗性增加30", no attack [ASSUMED: PRTS lists none] — then 飞行模式, "变为飞行单位，失衡免疫": a flyer
 * no push or pull moves, whose ranged attacks (the data's 1.6 radius) deal arts damage and never target flyers; the HP is
 * not refilled again. Its pages list no 静态刚体 (data `staticBody` stays off), so the 失衡免疫 of the flight is a persistent
 * `noDisplace` buff. 浮空 is refused from the statue on (`ab.immune`; data flyers refuse it anyway). [ASSUMED] a 浮空 it
 * already carries at the knock-out runs out. fx forms 'stone' / 'fly' (its Sleep and *_2 clips, render/units.js FORMS).
 * <破碎支柱> (an event device) has no counterpart in this mode.
 */
function statue(ab) {
  const dur = T(ab, 'stone.duration') ?? 0;
  return {
    spawn(b, e) { e.profile.melee = true; },
    killed(c, b, e, a, ab2) {
      if (a.done || !(dur > 0)) return false;
      a.done = true;
      a.noAtk = e.profile.noAttack;
      rebirthCleanse(b, e);                                 // "进行重生。重生瞬间完成"
      rebirthCooldowns(e);
      e.profile.noAttack = true;
      e.hp = e.s.maxHp;
      ab2.immune = new Set([...(ab2.immune || []), 'levitate']);
      setForm(b, e, 'stone', 'stone', { dur });
      b.addBuff(e, {
        key: 'ab:stone', duration: dur, visible: true, flags: { noMove: true, selfBound: true, unblockable: true, noDisplace: true },
        mods: { defFlat: T(ab, 'stone.def') ?? 0, resFlat: T(ab, 'stone.magic_resistance') ?? 0 },
        onExpire: ({ battle }) => {
          if (!e.alive) return;
          e.motion = 'FLY';
          Object.assign(e.profile, { noAttack: a.noAtk, melee: false, dmgType: 'arts', canTarget: (u) => !u.isFlying });
          battle.addBuff(e, { key: 'ab:flight', persist: true, flags: { noDisplace: true } });
          if (e.route) e.route.pts = null;
          setForm(battle, e, 'fly', 'revive', { kind: 'fly' });
        },
      });
      return true;
    },
  };
}

/**
 * Bleeding on hit (逐腐兽): arts damage per second, removed by healing. A tick selects nobody (`ignoreSelect`): it keeps
 * hurting an ally that took off (起飞) after the bleed landed; so do the other enemy debuff DoTs (沙狱, burnDot, 淤困).
 */
function bleed(ab) {
  const dmg = T(ab, 'Bleeding.attack@bleeding_damage') ?? 0, dur = T(ab, 'Bleeding.attack@duration') ?? 0;
  return {
    dealt(c, b, e) {
      if (!(dmg > 0 && dur > 0)) return;
      b.addBuff(c.target, {
        key: 'ab:bleed', duration: dur, refresh: 'replace', interval: 1, visible: true,
        onTick: ({ battle, unit }) => battle.dealDamage(e, unit, { amount: dmg, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'bleed'] }),
      });
    },
  };
}

/**
 * 【污染秽蚀】 zone (PRTS 萨卡兹枯朽战士 / 萨卡兹枯朽战车: "范围内位于低地/高地的我方干员和召唤物每秒受到50/25点真实普通伤害
 * （可对空，无视无法选择、迷彩；同名效果不叠加）"): `low` true damage per second on low ground, `high` on high ground, to every
 * ally inside (flyers, stealthed, untargetable and airborne 起飞 ones included — `ignoreSelect`; an airborne 蒂比 stands on
 * her low tile: `low`); a unit inside several zones takes one tick per second (`mem.pollutedAt`: the last tick it took).
 */
function pollution(b, src, x, y, r, life, low, high) {
  zone(b, { x, y, r, life, iv: POLLUTION_INTERVAL, kind: 'pollution', tick(units) {
    for (const u of units) {
      const v = u.ground ? low : high;
      if (!(v > 0) || b.time - (u.mem.pollutedAt ?? -Infinity) < POLLUTION_INTERVAL - 1e-6) continue;
      u.mem.pollutedAt = b.time;
      hurt(b, src, u, v, 'true', { tags: ['pollution'], ignoreSelect: true });
    }
  } });
}

/**
 * Damage zone (`amount` per tick, tagged `kind`). Unlike 【污染秽蚀】 it does not ignore 无法选择: it ticks on the allies
 * its area selection takes (areaAllies: no unblocking 隐匿, untargetable or sleeping ally; no airborne 起飞 one for a ground
 * enemy — PRTS 集团军重型火炮 【燃烧区域】 "碰撞不受迷彩制约，不可对空": 迷彩 only). A sourceless zone (`src` null: 假想敌：蚀裂's
 * 毒雾, an enemy's 死亡爆炸 with no 无视可选性 note on PRTS) selects as an effect with no selecting enemy: 隐匿 kept out, an
 * airborne 起飞 ally reached (§21.22; until 0.1.2 it took everyone inside). `noAir`: "不可对空" — a flying ally (the 炎佑
 * dragon) is skipped too (集团军重型火炮's 【燃烧区域】, since 0.1.3).
 */
function dmgZone(b, src, x, y, r, life, iv, amount, type = 'arts', kind = 'zone', el = null, elAmount = 0, { noAir = false } = {}) {
  zone(b, { x, y, r, life, iv, kind, pick: (zx, zy, zr) => areaAllies(b, src, zx, zy, zr).filter((u) => !(noAir && u.isFlying)), tick(units) {
    for (const u of units) {
      hurt(b, src, u, amount, type, { tags: [kind] });
      if (el && elAmount > 0) elem(b, src, u, el, elAmount, { tags: [kind] });
    }
  } });
}

/** A cooldown skill ability (`id` labels it for tests / other abilities). */
const skill = (s, fire, { cond = null, sil = false, cd = null, icd = null, id = null } = {}) => (s || cd != null) && fire ? ({
  id: id ?? null, sil, cd: cd ?? s.cd, icd: icd ?? s.icd, cond, fire,
}) : null;

/** Blink past the blocker along the path (弑君者 / 卢西恩). Returns the start position. */
export function blinkForward(b, e, dist) {
  if (unbalancedNow(b, e)) return null;                              // 失衡: 「无法…使用技能」 — no blink meanwhile
  const from = { x: e.x, y: e.y };
  const R = e.route;
  let left = dist;
  if (R && R.pts && R.ptIdx < R.pts.length) {
    let i = R.ptIdx;
    while (left > 1e-9 && i < R.pts.length) {
      const p = R.pts[i];
      const d = hypot(p.x - e.x, p.y - e.y);
      if (d <= left) { e.x = p.x; e.y = p.y; left -= d; i++; } else { stepToward(e, p.x, p.y, left); left = 0; }
    }
  } else if (R && R.legs && R.legs[R.legIdx] && R.legs[R.legIdx].r != null) {
    const L = R.legs[R.legIdx];
    stepToward(e, L.c, L.r, dist);
  }
  // never end inside a wall
  if (!b.grid.groundPassable(Math.round(e.y), Math.round(e.x)) && e.motion !== 'FLY') { e.x = from.x; e.y = from.y; return null; }
  b.addBuff(e, { key: 'ab:blink', duration: 1, flags: { invulnerable: true, unblockable: true } });
  if (R) R.pts = null;
  b.fx('blink', { x: e.x, y: e.y, id: e.id, fx: from.x, fy: from.y });
  return from;
}

// ---------------------------------------------------------------------------------------------------------------
// kits by archetype (functions reused by several keys)

const kitEp = (el, ...keys) => (ab) => [ep(el, T(ab, ...keys) ?? 0)];

const kitStealth = () => [stealth()];

const kitTimes = (artsOnly = false) => () => [times(artsOnly), unblockable()];

const kitRefraction = (ab) => [refraction(T(ab, 'refracting.magic_resistance', 'Refracting.magic_resistance') ?? 0)];

const kitPrisoner = (freeAll = false) => (ab) => [prisoner(ab, { freeAll })];

const kitDeathSpawn = (extra = []) => (ab) => [deathSpawn(ab.tS['DeadSpawn.enemy_key'], T(ab, 'DeadSpawn.cnt') ?? 0), ...extra];

const kitStun3 = (ab) => [nthAttackStatus(nthOf(ab.sk.stuncombat), 'stun', (ab.sk.stuncombat && ab.sk.stuncombat.bb.stun) || 0, true)];

const kitSelfFear = (ab) => [selfFear(ab)];

/** 深池逐火战士 / 精锐战士 / 护卫: knock-out ⇒ 1 s 重生 ⇒ a walking, 隐匿, disarmed 余烬 / 火灰 of prop_max_hp hits for `interval` s
 *  (PRTS 深池逐火战士 天赋: "基础最大生命值临时变为5…具有特殊生命值机制，不进行攻击，获得隐匿、缴械，10s后若未被击倒则变回战士形态并恢复所有
 *  生命"); blocking it lifts the 隐匿, so its blocker (and every operator in range) can beat it — also during the 3 s
 *  after a block ends, the warrior's own block that the knock-out releases included (Battle._stealthSwitch). */
const kitEmber = (ab) => [husk({ hits: T(ab, 'Revive[Trigger].prop_max_hp'), delay: T(ab, 'Revive[Trigger].interval') })];

/**
 * 萨卡兹枯朽战士 / 组长 · death: 【污染秽蚀】 (PRTS 天赋 "{{特殊机制|死亡爆炸}}（释放半径2.0，持续8s的【污染秽蚀】）"). Silenced at its
 * death it releases nothing: PRTS 特殊机制 死亡爆炸 "如无特殊说明，此能力默认可沉默…若不处于沉默状态，将会…释放", and the
 * client agrees — its PollutedDie ability is a buff of template `projectile_on_killed` (battle prefab
 * enemy_1267_nhpbr / _2), whose ON_OWNER_KILLED first checks `CheckAbnormalFlag SILENCED` (unset) before it emits the
 * pollution projectile — the template of 高能源石虫's SILENCE-flagged blast too. Its handbook line alone is NORMAL, the one
 * exception to the handbook rule of content/enemies.js (community report of 2026-10-06, item 10: until 0.2.0 a
 * silenced one still poisoned its blockers).
 */
const kitPolluted = (ab) => [{
  sil: true,
  death(c, b, e) {
    if (c.reason !== 'killed') return;
    pollution(b, e, e.x, e.y, T(ab, 'PollutedDie.projectile_range') ?? 1, T(ab, 'PollutedDie.projectile_life_time') ?? 0,
      T(ab, 'PollutedDie.polluted_damage_low') ?? 0, T(ab, 'PollutedDie.polluted_damage_high') ?? 0);
  },
}];

// used by the other enemy modules (content/enemies.js and content/enemies/*.js)
export {
  stealth, unblockable, runWhenHit, blockWeight, taunt, maxTargets, ep, onHitStatus, splashAttack, pathKeysAhead,
  noAirTargets, resist, immuneTo, nthAttackStatus, nthAttackPower, enemyAura, allyAura, lowHpBuff, deathSpawn,
  deathBoom, refraction, setFloat, float, selfFear, freeAllPrisoners, reborn, frontGuard, faceMove, faceCrowd,
  unbalanced, artsBarrier, husk, statue, bleed, pollution, dmgZone, skill, kitEp, kitStealth, kitTimes, kitRefraction,
  kitPrisoner, kitDeathSpawn, kitStun3, kitSelfFear, kitEmber, kitPolluted,
};
