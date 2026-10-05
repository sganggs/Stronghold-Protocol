// server/sim/content/kits/tier1.js — Tier 1 operator kits (+ the shared kit helpers used by tier2.js).
//
// export default { [baseChessId]: (bb, chess, def) => Kit } (docs/SIM.md §7.2). `bb` = skill blackboard at the chess's
// level (normal Lv4 / elite Lv7), `chess` = raw data/chess.json record (talents with their own bb, trait.bb incl. the
// elite module upgrade, module{active}), `def` = normalised def (def.skill.rangeGrid, def.skill.description …).
// Every number comes from a blackboard; the few constants below exist nowhere in data and are documented.
// Profession defaults (professions.js) are reused: kits only add what the trait text / module says beyond them.
//
// Covered (normal + elite): 1_01 隐现 1_02 角峰 1_03 惊蛰 1_04 深巡 1_05 红豆(H) 1_06 刺玫 1_07 普罗旺斯 1_08 德克萨斯
// 1_09 跃跃 1_10 古米 1_11 地灵(H) 1_12 艾丝黛尔 1_13 波登可 1_14 格雷伊 1_16 锡人(H) 1_17 深靛
// 1_18 宴 1_19 野鬃 1_20 雷蛇.  (H = hidden in the shop pool, still authored.) 1_15 盟约·辅助干员(H) lives in tier6.js.
// Operator loadouts (DESIGN §16): every selectable non-default skill of the 16 visible chess is authored in the kit's
// `skills: { [skillId]: SkillSpec }` map from its own SkillRecord (skillRec / skillBbOf — Lv4 normal, Lv7 elite);
// talents / traits read the resolved record, so a module choice ('none' ⇒ traitBase / talentsBase, module.active
// false) is honoured. Per-skill triggers come from data (the official 技能策略: every MANUAL 重装 skill ⇒ TAKE_DAMAGE —
// but the six of the owner's deliberate deviation, DESIGN §21.29 / tools/build-data.mjs TRIGGER_DEVIATIONS, which are
// DEFAULT —, a MANUAL skill with its own 技能范围 ⇒ SKILL_RANGE, AUTO skills keep their own rule); the few spec rules are
// documented at the skill (冲锋号令 AUTO ⇒ SP_FULL, 花香疗法 heal-type DEFAULT; the two 哨戒铁卫 S2s 深巡 行动能力剥夺 and
// 雷蛇 反击电弧 state the DEFAULT their data carries since that deviation — GitHub issue #4, PR #12).
// Tests: test/content/kits_alt_t1.test.js.
//
// fx kinds emitted (battle.fx(kind, {x, y, …})): aoe {radius, id, skill} · zone {radius, dur, id, skill} ·
// counter {id} · crit {id} · dp {n, id} · heal {id} · taunt {id} · summon {id, token} · pull {id} · sonic {radius} ·
// shield {id} · overload {id} · takeoff {id} · sleep {id} · buff {id, kind} · reveal {id} · dodge (engine kind).

import { COLS, CHAIN_RADIUS } from '../../constants.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../targeting.js';
import { frontOf, offsetTile } from '../../dir.js';
import { bodyInKeys, bodyOnTile, bodyTileReach } from '../../body.js';

// =================================================================================================================
// shared helpers (named exports; content/index.js only merges the default export)

/** Finite number or `d` (blackboard values may be strings). */
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));

/** Named talent `i` (data index ≥ 0, in order) of a raw chess record. */
function talentAt(chess, i) {
  const list = (chess?.talents ?? []).filter((t) => t && t.index !== -1);
  return list[i] ?? null;
}
/** Blackboard of named talent `i` ({} when absent). */
export const talentBb = (chess, i = 0) => talentAt(chess, i)?.bb ?? {};
/** Range grid of named talent `i` (or null). */
export const talentGrid = (chess, i = 0) => talentAt(chess, i)?.rangeGrid ?? null;
/** Merged blackboard of the hidden module talents (data index −1, elite only). */
export function moduleBb(chess) {
  const o = {};
  for (const t of chess?.talents ?? []) if (t && t.index === -1 && t.bb) Object.assign(o, t.bb);
  return o;
}
/** Trait blackboard (elites include their module's trait upgrade). */
export const traitBb = (chess) => chess?.trait?.bb ?? {};
/** Elite module active (golden chess). */
export const moduleOn = (chess) => !!(chess?.module && chess.module.active);

export const up = (u) => !!u && u.alive && u.deployed;
export const posKey = (u) => Math.round(u.y) * COLS + Math.round(u.x);
/** Chebyshev tile distance between two units (a huge enemy: from the nearest tile it occupies — sim/body.js). */
export const cheb = (a, b) => (b.hitArea ? bodyTileReach(b, Math.round(a.y), Math.round(a.x))
  : a.hitArea ? bodyTileReach(a, Math.round(b.y), Math.round(b.x))
    : Math.max(Math.abs(Math.round(a.y) - Math.round(b.y)), Math.abs(Math.round(a.x) - Math.round(b.x))));
/** Normal attack hit on its primary target (no splash, no chain jump). */
export const isMainHit = (dmg) => !!dmg && dmg.isAttack && !dmg.isSplash && !(dmg.tags && dmg.tags.includes('chain'));
/** Damage ctx caused by an enemy's attack. */
export const byEnemyAttack = (ctx) => !!ctx.source && ctx.source.side === 'enemy' && !!ctx.dmg && ctx.dmg.isAttack;
/**
 * `damaged` ctx of a damage that removed HP and can give 受击回复 SP — the engine's rule (damage.js applyHpLoss: not a 流失
 * (`noSp`, Battle.loseHp), not an element 损伤), whatever its source: an attack, a zone, the 无来源 源石溶剂 tick.
 */
export const hurtSpDamage = (ctx) => !!ctx.dmg && !ctx.dmg.noSp && ctx.type !== 'element' && ctx.amount > 0;
/** A timed skill is running (no SP may be gained). */
export const skillBusy = (u) => !!(u.skill && u.skill.active && u.skill.isTimed);
/** Give SP unless a timed skill is running (AK: no SP gain during a skill). */
export function giveSp(u, n, reason = 'talent') {
  if (!u || !u.skill || u.skill.noSkill || skillBusy(u) || !(n > 0)) return 0;
  return u.skill.gainSp(n, reason);
}

/** 'hit' handler for damage dealt BY `unit` (pre-mitigation; mutate ctx.dmg). */
export function onHitBy(battle, unit, fn, priority = 0) {
  return battle.on('hit', (ctx) => { if (ctx.source === unit && ctx.target && ctx.target.side === 'enemy') fn(ctx); }, { owner: unit, priority });
}
/** 'hit' handler for damage dealt TO `unit`. */
export function onHitOn(battle, unit, fn, priority = 0) {
  return battle.on('hit', (ctx) => { if (ctx.target === unit) fn(ctx); }, { owner: unit, priority });
}
/** 'damaged' handler for damage dealt TO `unit`. */
export function onDamagedOn(battle, unit, fn, priority = 0) {
  return battle.on('damaged', (ctx) => { if (ctx.target === unit) fn(ctx); }, { owner: unit, priority });
}

/** Targetable enemies inside `grid` (relative to the unit; null ⇒ current range), best targets first. */
export function enemiesInGrid(battle, unit, grid, { n = 0, priority = null, canHitFly = true, groundOnly = false } = {}) {
  const keys = grid ? absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0) : unit.rangeKeys;
  const list = battle.enemiesInKeys(keys, unit, { canHitFly, groundOnly });
  sortEnemyTargets(battle, unit, list, priority ?? unit.profile?.priority ?? null);
  return n > 0 && list.length > n ? list.slice(0, n) : list;
}
/**
 * Deployed allies (no devices) whose tile is inside `grid` relative to `unit` (null ⇒ current range) — never a 孤立 unit
 * (炎佑: Battle.allySelectable), as Battle.alliesInGrid.
 */
export function alliesInGridOf(battle, unit, grid = null) {
  const set = grid ? new Set(absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0)) : (unit.rangeKeySet || new Set(unit.rangeKeys || []));
  return battle.allyUnits.filter((a) => a.alive && a.deployed && !a.hidden && a.kind !== 'device' && set.has(a.tileR * COLS + a.tileC) && battle.allySelectable(a, unit));
}
/** Any targetable enemy in the unit's current range. */
export const enemyInRange = (battle, unit) => battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).length > 0;

/** Run `fn` once per battle for `key` (battle-wide handlers shared by several units). */
const ONCE = new WeakMap();
export function once(battle, key, fn) {
  let s = ONCE.get(battle);
  if (!s) ONCE.set(battle, (s = new Set()));
  if (s.has(key)) return;
  s.add(key);
  fn();
}

/** Permanent talent stat buff (survives death / redeploy). */
export function statBuff(battle, unit, key, mods) {
  const m = {};
  for (const [k, v] of Object.entries(mods)) if (Number.isFinite(v) && v !== 0 && !(k.endsWith('Mul') && v === 1)) m[k] = v;
  if (Object.keys(m).length) battle.addBuff(unit, { key, mods: m, persist: true, allowDead: true, tags: ['talent'] });
}

/** Keep buff `key` on `unit` exactly while cond() holds (checked every tick). `mods` may be a function. */
export function toggleBuff(battle, unit, key, cond, mods, extra = {}) {
  const check = () => {
    const want = up(unit) && !!cond();
    const has = unit.findBuff(key);
    if (want && !has) battle.addBuff(unit, { key, mods: typeof mods === 'function' ? mods() : mods, tags: ['talent'], ...extra });
    else if (!want && has) battle.removeBuff(unit, key);
  };
  battle.on('tick', check, { owner: unit });
  battle.on('battleStart', check, { owner: unit });
  battle.on('deploy', (ctx) => { if (ctx.unit === unit && battle.started) check(); }, { owner: unit });
}

/**
 * Aura while `unit` is on the field: every `interval` s, allies passing `select(a)` get buff `key` for slightly longer
 * than the interval. Several sources of the same aura never stack: the strongest `value` wins.
 */
export function installAura(battle, unit, { key, select, mods, value = 0, interval = 0.5 }) {
  battle.every(interval, () => {
    if (!up(unit)) return;
    for (const a of battle.alliesFor(unit)) {
      if (!select(a)) continue;
      const cur = a.findBuff(key);
      if (cur && cur.source !== unit && (cur.data?.v ?? 0) > value && cur.timeLeft > 0.05) continue;
      battle.addBuff(a, { key, duration: interval + 0.1, mods: typeof mods === 'function' ? mods(a) : mods, source: unit, data: { v: value }, tags: ['aura'] });
    }
  }, { owner: unit, immediate: true });
}

/** Extra natural SP recovery (+perSec) while cond() holds (hooks the per-tick 'time' SP gain). */
export function spTimeBonus(battle, unit, perSec, cond) {
  if (!(perSec > 0)) return;
  battle.on('spGain', (ctx) => {
    if (ctx.unit === unit && ctx.reason === 'time' && cond()) ctx.amount += perSec * battle.dt;
  }, { owner: unit });
}

/** Module "攻击范围内敌人的隐匿效果失效": stealthed enemies inside the current range are revealed. */
export function installReveal(battle, unit, interval = 0.2) {
  battle.every(interval, () => {
    if (!up(unit) || !unit.rangeKeySet) return;
    for (const e of battle.enemies) {
      if (!e.alive || e.hidden || !e.s.flags.stealth || !bodyInKeys(e, unit.rangeKeySet)) continue;
      const was = !!e.s.flags.reveal;
      if (battle.applyStatus(e, 'reveal', { duration: interval + 0.1, source: unit }) && !was) battle.fx('reveal', { x: e.x, y: e.y, id: e.id });
    }
  }, { owner: unit });
}

/**
 * Lingering area (spores, alchemy units): `onPulse(battle)` runs immediately and then every `interval` s,
 * `round(duration / interval)` times in total. Not owned by the caster: it keeps working after the caster falls.
 */
export function makeZone(battle, caster, { x, y, radius, duration, interval = 1, skill, onPulse, onEnd }) {
  const total = Math.max(1, Math.round(duration / interval));
  let n = 0;
  battle.fx('zone', { x, y, radius, dur: duration, id: caster.id, skill });
  return battle.every(interval, (b, sc) => {
    onPulse(b);
    if (++n >= total) { sc.cancel(); if (onEnd) onEnd(b); }
  }, { immediate: true });
}

/**
 * A tile a summon may take: inside the field and not reserved (Battle.isReservedTile: nobody on it, no knocked-out
 * operator lying there, not the home tile of a board unit that has not deployed yet / waits to redeploy — a summon
 * there would stop that operator from redeploying until it leaves).
 */
export function summonTileFree(battle, r, c) {
  return Number.isInteger(r) && Number.isInteger(c) && battle.grid.inRect(r, c) && !battle.isReservedTile(r, c);
}

/** First free tile around `unit` (Chebyshev ring 1, front first — offsets rotated by its direction) where `ok(r, c)` holds. */
export function freeTileAround(battle, unit, ok) {
  const order = [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1], [1, -1], [-1, -1]];
  for (const [dr, dc] of order) {
    const [r, c] = offsetTile(unit.tileR, unit.tileC, dr, dc, unit.dir);
    if (!summonTileFree(battle, r, c)) continue;
    if (ok(r, c)) return [r, c];
  }
  return null;
}

/** Skill spec kind for an instant skill with (possible) charges. */
export const instantKind = (def) => ((def?.skill?.maxCharges ?? 1) > 1 ? 'charges' : 'instant');

/**
 * SkillRecord `skillId` of a raw chess record (DESIGN §16 operator loadouts): the selected skill (`chess.skill`) or one of
 * `chess.skills[]` (every skill of the chess at its level — bb, duration, rangeGrid, trigger). Null when absent.
 * A kit's `skills` map builds every entry from its own record, so each spec is right whichever skill is selected.
 */
export function skillRec(chess, skillId) {
  if (chess?.skill && (chess.skill.skillId ?? chess.skill.id) === skillId) return chess.skill;
  return (chess?.skills ?? []).find((s) => s && s.skillId === skillId) ?? null;
}
/** Blackboard of skill `skillId` of a raw chess record ({} when absent). */
export const skillBbOf = (chess, skillId) => skillRec(chess, skillId)?.bb ?? {};

/**
 * Skill blackboard `base_attack_time` → engine batPct of this chess's base attack time. The value is a FLAT change of
 * the base attack time in seconds (AK attribute ADDITION: 送葬人 −0.5 on 2.3 s "少量缩短(-0.5)" ⇒ 1.8 s, 红豆 +0.5
 * "略微增大(+0.5)" — the same convention as tier4/tier5), except a positive value described as a shortening, which is
 * the new interval ratio (深靛 0.7 "攻击间隔略微缩短" ⇒ ×0.7). The convention is per skill in AK: skills PRTS lists as
 * a ratio (雷蛇 反击电弧 "+70%", 古米 食粮烹制 "+130%", 深靛 灯塔守卫者 "-80%") use batPct = value directly, not this.
 */
export function batMod(v, chess = null, desc = '') {
  const x = num(v, 0);
  if (!x) return 0;
  if (x > 0 && x < 1 && /间隔[^，。；]*缩短/.test(desc)) return x - 1;
  const bat = num(chess?.stats?.bat, 1) || 1;
  return Math.max(-0.9, x / bat);
}

// =================================================================================================================
// tier-local constants that exist nowhere in data

/** Radius (tiles) of 波登可's spore cloud. No blackboard key; PRTS 波登可 备注 "孢子群范围半径为0.9，可对空". */
const SPORE_RADIUS = 0.9;
/** "周围8格" = Chebyshev ring 1 ⇒ Euclidean radius covering the 8 neighbours. */
export const RING1 = 1.5;
/** 普罗旺斯 杀戮嗅觉 "普通攻击不再以生命值高于80%的敌人作为目标" — the 80 % exists only in the skill text. */
const PROVE_S2_MAX_HP = 0.8;

// =================================================================================================================
// kit builders shared by two chess ids

/**
 * 锡人 “大拉里” (chess_char_1_16 hidden and chess_char_2_19): throw an alchemy unit at the current target —
 * for projectile_delay_time s, ground enemies within projectile_range tiles take atk_scale × ATK arts per second,
 * allies there recover hp_recovery_per_sec_ratio × ATK per second. Elite: 凋敝魂灵 (skill@damage_scale: damage-over-
 * time taken by ground enemies inside a unit ×1.2) and the module's +sp_recovery_per_sec SP while a unit exists.
 */
export function tinmanKit(bb, chess, def) {
  const dur = num(bb.projectile_delay_time, 10);
  const radius = num(bb.projectile_range, 1.5);
  const dmgScale = num(bb.atk_scale);
  const healRatio = num(bb.hp_recovery_per_sec_ratio);
  const wither = num(talentBb(chess, 1)['skill@damage_scale'], 1);
  const spBonus = num(moduleBb(chess).sp_recovery_per_sec);
  const witherKey = 'tinman:wither';
  return {
    skill: {
      kind: instantKind(def),
      onStart({ battle, unit }) {
        const tgt = enemiesInGrid(battle, unit, null, { n: 1, groundOnly: true })[0] ?? enemiesInGrid(battle, unit, null, { n: 1 })[0];
        const x = tgt ? tgt.x : unit.x + unit.fwd[1], y = tgt ? tgt.y : unit.y + unit.fwd[0];
        const atk = unit.s.atk;
        unit.mem.tinZones = (unit.mem.tinZones ?? 0) + 1;
        makeZone(battle, unit, {
          x, y, radius, duration: dur, skill: 'tinman', onPulse(b) {
            for (const e of b.foesInRadius(x, y, radius)) {
              if (e.isFlying || e.s.flags.untargetable) continue;
              if (wither > 1) b.addBuff(e, { key: witherKey, duration: 1.05, data: { mul: wither }, source: unit });
              b.dealDamage(unit, e, { amount: atk * dmgScale, type: 'arts', isSkill: true, canDodge: false, tags: ['dot', 'zone'] });
            }
            if (healRatio > 0) for (const a of b.alliesInRadius(x, y, radius, null)) if (a.hp < a.s.maxHp) b.heal(unit, a, atk * healRatio, { tags: ['zone'] });
          },
          onEnd() { unit.mem.tinZones = Math.max(0, (unit.mem.tinZones ?? 1) - 1); },
        });
      },
    },
    talents: [{ install(battle, unit) {
      if (wither > 1) {
        // "持续伤害" = damage over time only: 'dot'-tagged ticks and the per-second ticks of a necrosis / apoptosis
        // burst — never instantaneous bursts (burn/neural bursts, skill/summon bursts are also tagged 'burst')
        once(battle, witherKey, () => battle.on('hit', (ctx) => {
          if (!ctx.target || ctx.target.side !== 'enemy') return;
          const tags = ctx.dmg.tags || [];
          if (!(tags.includes('dot') || tags.includes('necrosis') || tags.includes('apoptosis'))) return;
          const w = ctx.target.findBuff(witherKey);
          if (w) ctx.dmg.amount *= w.data?.mul ?? 1;
        }));
      }
      spTimeBonus(battle, unit, spBonus, () => (unit.mem.tinZones ?? 0) > 0);
    } }],
  };
}

// =================================================================================================================
// kits

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_01 隐现 “解决麻烦”: ammo (attack@trigger_time) ATK+atk, base attack time +base_attack_time s, prefers ranged
  // enemies, taunt −1. 火力支援: after `duration` s on the field own ammo +self_ammo (from the next cast); elite: another
  // random 【拉特兰】 op's ammo +ally_ammo while that deployment lasts (one grant per source).
  // Alternate S1 “不惹麻烦” (AUTO, attack SP): attack@trigger_time rounds of attack@atk_scale × ATK physical (an ammo
  // skill, so 火力支援's larger magazine applies to it too).
  chess_char_1_01_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const dur = num(t.duration), selfAmmo = num(t.self_ammo), allyAmmo = num(t.ally_ammo);
    const s1 = skillBbOf(chess, 'skchr_inside_1');
    return {
      skill: {
        kind: 'ammo', ammo: num(bb['attack@trigger_time'], 1),
        mods: { atkPct: num(bb.atk), batPct: batMod(bb.base_attack_time, chess, def?.skill?.description ?? chess?.skill?.desc), taunt: -1 },
        targeting: { priority: 'ranged' },
      },
      skills: {
        skchr_inside_1: { kind: 'ammo', ammo: Math.max(1, Math.floor(num(s1['attack@trigger_time'], 4))), attack: { atkScale: num(s1['attack@atk_scale'], 1) } },
      },
      talents: [{ install(battle, unit) {
        const onField = () => up(unit) && battle.time - unit.deployedAt + 1e-9 >= dur;
        battle.on('skillStart', ({ unit: u, skill }) => {
          if (u === unit && skill.kind === 'ammo' && onField() && selfAmmo > 0) skill.addAmmo(selfAmmo);
        }, { owner: unit });
        if (!(allyAmmo > 0)) return;
        // elite: once per deployment, `duration` s after it, one random other 【拉特兰】 operator with an ammo skill gets
        // +ally_ammo for as long as this deployment lasts (one grant per source — redeploying never stacks it)
        battle.on('deploy', ({ unit: u }) => {
          if (u !== unit) return;
          const seq = unit.deploySeq;
          battle.after(dur, () => {
            // (the larger magazine applies from the next activation: a running skill keeps its rounds)
            if (!up(unit) || unit.deploySeq !== seq) return;
            const pool = battle.allyUnits.filter((a) => a !== unit && a.kind === 'op' && a.ownerId === unit.ownerId && a.alive
              && (a.def.bonds || []).includes('lateranoShip') && a.skill && a.skill.kind === 'ammo');
            const pick = battle.rng.pick(pool);
            if (!pick) return;
            (pick.mem.insiderAmmo ??= new Map()).set(unit.id, { src: unit, seq, n: allyAmmo });
            battle.fx('buff', { x: pick.x, y: pick.y, id: pick.id, kind: 'ammo' });
          }, { owner: unit });
        }, { owner: unit });
        once(battle, 'insider:bonusAmmo', () => battle.on('skillStart', ({ unit: u, skill }) => {
          const m = u.mem.insiderAmmo;
          if (!m || skill.kind !== 'ammo') return;
          let n = 0;
          for (const [k, g] of m) {
            if (up(g.src) && g.src.deploySeq === g.seq) n += g.n;
            else m.delete(k);
          }
          if (n > 0) skill.addAmmo(n);
        }));
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_02 角峰 抗寒体质: HP +max_hp, DEF +def, RES ×(1+magic_resistance). 雪原卫士: RES +magic_resistance (flat).
  // Alternate S1 体能强化 (重装 ⇒ TAKE_DAMAGE trigger from data): HP +max_hp, +hp_recovery_per_sec HP per second
  // (the 生命回复速度 attribute). Elite module PRO-Y (block 4) is a stat of the module (attr blockCnt).
  chess_char_1_02_a: (bb, chess) => {
    const s1 = skillBbOf(chess, 'skchr_yak_1');
    return {
      skill: { kind: 'duration', mods: { hpPct: num(bb.max_hp), defPct: num(bb.def), resMul: 1 + num(bb.magic_resistance) } },
      skills: { skchr_yak_1: { kind: 'duration', mods: { hpPct: num(s1.max_hp), hpRegen: num(s1.hp_recovery_per_sec) } } },
      talents: [{ install(battle, unit) { statBuff(battle, unit, 'talent:yak', { resFlat: num(talentBb(chess, 0).magic_resistance) }); } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_03 惊蛰 初雷: ATK +atk, chain jumps lose no damage. 通流无阻: vs unblocked enemies ATK ×atk_scale (every jump).
  // Alternate S1 攻击力强化·γ型: ATK +atk (the chain keeps its falloff). Elite module CHA-X (4 jumps, −10 %, 0.8 s 停顿)
  // is the chain profile of the module trait (professions.js TUNE.chain).
  chess_char_1_03_a: (bb, chess) => {
    const scale = num(talentBb(chess, 0).atk_scale, 1);
    return {
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk) }, attack: {} },
      skills: { 'skcom_atk_up[3]': { kind: 'duration', mods: { atkPct: num(skillBbOf(chess, 'skcom_atk_up[3]').atk) } } },
      talents: [{ install(battle, unit) {
        if (scale !== 1) onHitBy(battle, unit, ({ target, dmg }) => { if (dmg.isAttack && !target.blockedBy) dmg.amount *= scale; });
      } }],
      install(battle, unit) {
        // the chain shape (count / sluggish, elite module included) comes from the resolved chain profile
        const ch = unit.profile.chain || { count: num(traitBb(chess)['attack@max_target'], 3), radius: CHAIN_RADIUS, sluggish: num(traitBb(chess)['attack@sluggish'], 0.5) };
        if (unit.skill && unit.skill.spec.attack) unit.skill.spec.attack.chain = { ...ch, falloff: 0 };
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_04 深巡 行动能力剥夺: longer line range (skill grid), ATK +atk, ASPD +attack_speed, fin darts pierce
  // attack@max_target enemies on the line and cause attack@sluggish s of 停顿.
  // 技能策略 → DEFAULT (PR #12; DESIGN §21.29): the official 下半 class row hands every MANUAL 重装 skill TAKE_DAMAGE,
  // which makes a 2-2 ranged 哨戒铁卫 wait until something hits her — in practice until she blocks (GitHub issue #4). By
  // the owner's deliberate deviation from that row (2026-10-03, community feedback) this offensive ranged skill takes
  // the basic strategy (SP ready + about to attack + an enemy inside the initial range); her data says DEFAULT too
  // (rawRule keeps the official TAKE_DAMAGE). Only the rule changes: spCost / initSp / spType still come from data.
  // 细胞活性抑制剂: attacks inflict `damage` arts per `interval` s for `duration` s (damage_seamonster vs 【海怪】).
  // Elite module (SPT-X): stealth of enemies inside the range is cancelled.
  // Alternate S1 侵袭破坏应对 (重装 ⇒ TAKE_DAMAGE trigger from data): ATK +atk, DEF +def.
  chess_char_1_04_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const s1 = skillBbOf(chess, 'skchr_udflow_1');
    return {
      skill: {
        trigger: 'DEFAULT',
        kind: 'duration', mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) },
        targeting: { rangeGrid: def?.skill?.rangeGrid ?? null, maxTargets: num(bb['attack@max_target'], 1) },
        attack: { onHitStatus: { key: 'sluggish', duration: num(bb['attack@sluggish'], 1) } },
      },
      skills: { skchr_udflow_1: { kind: 'duration', mods: { atkPct: num(s1.atk), defPct: num(s1.def) } } },
      talents: [{ install(battle, unit) {
        const dur = num(t.duration), iv = num(t.interval, 1);
        if (!(dur > 0) || !(num(t.damage) > 0)) return;
        battle.on('damaged', (ctx) => {
          if (ctx.source !== unit || !ctx.dmg?.isAttack || ctx.target.side !== 'enemy' || !ctx.target.alive) return;
          const sea = (ctx.target.def?.tags || []).includes('seamonster');
          const amount = sea ? num(t.damage_seamonster, num(t.damage) * 2) : num(t.damage);
          battle.addBuff(ctx.target, {
            key: `udflow:dot:${unit.id}`, duration: dur, interval: iv, refresh: 'extend', source: unit, visible: false,
            onTick: ({ battle: b, unit: e }) => b.dealDamage(unit, e, { amount, type: 'arts', canDodge: false, tags: ['dot'] }),
          });
        }, { owner: unit });
      } }],
      install(battle, unit) { if (moduleOn(chess) && chess.isGolden) installReveal(battle, unit); },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_05 红豆 (hidden) 槌音: base attack time +base_attack_time s, ATK +atk. 蛮力穿刺: each attack prob1 (prob2 while the skill
  // runs) for ATK +atk on that attack. Elite module (CHG-Y): vs enemies below hp_ratio HP, ATK ×atk_scale.
  chess_char_1_05_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    return {
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk), batPct: batMod(bb.base_attack_time, chess) } },
      talents: [{ install(battle, unit) {
        const key = 'vigna:proc';
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit) return;
          const p = unit.skill?.active ? num(t.prob2) : num(t.prob1);
          if (p > 0 && battle.rng.chance(p)) {
            battle.addBuff(unit, { key, duration: 0.1, mods: { atkPct: num(t.atk) } });
            battle.fx('crit', { x: unit.x, y: unit.y, id: unit.id });
          }
        }, { owner: unit });
        // melee hits resolve synchronously inside the attack: the one-attack buff is dropped right after it
        battle.on('attack', (ctx) => { if (ctx.attacker === unit && unit.findBuff(key)) battle.removeBuff(unit, key); }, { owner: unit });
        if (tb.hp_ratio != null && num(tb.atk_scale, 1) !== 1) {
          onHitBy(battle, unit, ({ target, dmg }) => { if (dmg.isAttack && target.hpRatio < num(tb.hp_ratio)) dmg.amount *= num(tb.atk_scale, 1); });
        }
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_06 刺玫 荆藤庇荫: ATK +atk; the ally with the highest max HP in range gets taunt +taunt_level; whenever that ally is
  // attacked, 刺玫 deals atk_scale × ATK arts to the attacker, and her trait heal (scale × damage) only goes to that ally.
  // 土壤基肥改良: the highest-max-HP ally in range receives heal_scale × healing ("受到的治疗效果提升") — never its natural /
  // skill HP regeneration (the 生命回复速度 attribute is "不受治疗加成影响": 宴 分神, 角峰 体能强化; PRTS).
  // Alternate S1 战术咏唱·γ型: ASPD +attack_speed (the trait heal keeps going to the most injured ally in range).
  // Elite module INC-X (heal 60 % of the damage) is the incantation profile of the module trait (TUNE.incantationmedic).
  chess_char_1_06_a: (bb, chess) => {
    const hs = num(talentBb(chess, 0).heal_scale, 1);
    const tauntKey = 'vendla:taunt';
    // the protégé only exists while 荆藤庇荫 runs (mem.protege is set by its onStart only)
    const protege = (u) => (u.skill?.active && up(u.mem.protege) ? u.mem.protege : null);
    return {
      skills: { 'skcom_magic_rage[3]': { kind: 'duration', mods: { aspd: num(skillBbOf(chess, 'skcom_magic_rage[3]').attack_speed) } } },
      trait: {
        // 咒愈师 trait: EVERY damage she deals heals an ally for 50 % of it (professions.js `installIncantation`,
        // buff_template_data `vendla_tr` = ON_AFTER_OUTPUT_DAMAGE) — while 荆藤庇荫 runs her S2 says "仅对该角色触发刺玫
        // 特性", so her protégé is the target then; otherwise it is the lowest-HP ally in range.
        install(battle, u) {
          battle.on('damaged', (c) => {
            const t = c.target;
            if (c.source !== u || !u.alive || !t || t.side !== 'enemy' || !(c.amount > 0)) return;
            if (c.type === 'element' || c.type === 'elemental') return;
            const ally = (c.dmg && c.dmg.traitAlly) || protege(u) || battle.lowestHpAllyInRange(u);
            if (ally) battle.heal(u, ally, c.amount * (u.profile.healRatio ?? 0.5), { tags: ['incantation'] });
          }, { owner: u });
        },
      },
      skill: {
        kind: 'duration', mods: { atkPct: num(bb.atk) },
        onStart({ battle, unit, skill }) {
          const cands = alliesInGridOf(battle, unit).sort((a, b) => b.s.maxHp - a.s.maxHp || a.deploySeq - b.deploySeq);
          const p = cands[0] ?? null;
          unit.mem.protege = p;
          if (!p) return;
          battle.addBuff(p, { key: tauntKey, duration: skill.duration + 0.1, mods: { taunt: num(bb.taunt_level, 1) }, visible: true, source: unit });
          battle.fx('taunt', { x: p.x, y: p.y, id: p.id });
        },
        onEnd({ battle, unit }) {
          if (unit.mem.protege) battle.removeBuff(unit.mem.protege, tauntKey);
          unit.mem.protege = null;
        },
      },
      talents: [{ install(battle, unit) {
        battle.on('damaged', (ctx) => {
          const p = protege(unit);
          if (!p || ctx.target !== p || !byEnemyAttack(ctx) || !ctx.source.alive || !unit.canAct) return;
          // "并仅对该角色触发刺玫特性": this counter damage is healed by the trait (install above) for the protégé — the
          // damage instance names her, so no separate heal here (it would double)
          battle.dealDamage(unit, ctx.source, { amount: unit.s.atk * num(bb.atk_scale), type: 'arts', isSkill: true, canDodge: false, tags: ['counter'], traitAlly: p });
          battle.fx('counter', { x: ctx.source.x, y: ctx.source.y, id: unit.id });
        }, { owner: unit });
        if (hs !== 1) {
          let cacheT = -1, top = null;
          battle.on('heal', (ctx) => {
            if (!up(unit) || ctx.opts?.regen) return;
            if (cacheT !== battle.time) {
              cacheT = battle.time;
              top = alliesInGridOf(battle, unit).sort((a, b) => b.s.maxHp - a.s.maxHp || a.deploySeq - b.deploySeq)[0] ?? null;
            }
            if (ctx.target === top) ctx.amount *= hs;
          }, { owner: unit });
        }
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_07 普罗旺斯 狼眼 (passive): per hp_ratio_drop of HP the target has lost, ATK +atk_scale_up against it — CONTINUOUS,
  // not in 20 % steps (PRTS note: "并非以每20%为固定节点 … 攻击力倍率提升至[100%+(100%-目标生命比例)×加成量×5]", i.e.
  // ×(1 + lost / hp_ratio_drop × atk_scale_up)).
  // 狩猎箭头: each attack prob (prob2 when the enemy is on the tile right in front) for ATK ×atk_scale.
  // 狼眼 is an ATK increase ⇒ it scales her (ATK-based) attacks only, never fixed-value damage she sources
  // (叙拉古 5000+50·L true proc, fixed item/DoT ticks…).
  // Alternate S2 杀戮嗅觉: ATK +atk, but normal attacks never target an enemy above 80 % HP (with only such enemies in
  // range she holds her fire). Her attacks stay normal attacks. (狼眼 is S1 only: absent when S2 is carried.)
  // Elite module ARC-X only changes stats (ATK/DEF, faster redeploy).
  chess_char_1_07_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const drop = num(bb.hp_ratio_drop), upPer = num(bb.atk_scale_up);
    const S2 = 'skchr_prove_2';
    const huntable = (e) => e.hpRatio <= PROVE_S2_MAX_HP + 1e-9;
    const s2On = (u) => !!(u.skill && u.skill.active && u.skill.id === S2);
    return {
      skill: { kind: 'passive' },
      skills: { [S2]: { kind: 'duration', mods: { atkPct: num(skillBbOf(chess, S2).atk) } } },
      trait: {
        canAttack: (battle, u) => !s2On(u) || battle.enemiesInKeys(u.rangeKeys, u, u.profile).some(huntable),
      },
      install(battle, unit) {
        if (unit.skill?.id !== S2) return;
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !s2On(unit) || ctx.targets.every(huntable)) return;
          const prof = ctx.profile || unit.profile;
          const cands = battle.enemiesInKeys(unit.rangeKeys, unit, prof).filter(huntable);
          sortEnemyTargets(battle, unit, cands, prof.priority);
          ctx.targets = cands.slice(0, Math.max(1, ctx.targets.length));
        }, { owner: unit });
      },
      talents: [{ install(battle, unit) {
        onHitBy(battle, unit, ({ target, dmg }) => {
          if (!dmg.isAttack) return;
          if (drop > 0 && upPer > 0) {
            const lost = Math.max(0, Math.min(1, 1 - target.hpRatio));
            if (lost > 0) dmg.amount *= 1 + (lost / drop) * upPer;
          }
          if (!isMainHit(dmg)) return;
          const [fr, fc] = frontOf(unit.tileR, unit.tileC, unit.dir);
          const front = bodyOnTile(target, fr, fc);
          const p = front ? num(t.prob2) : num(t.prob);
          if (p > 0 && battle.rng.chance(p)) {
            dmg.amount *= num(t.atk_scale, 1);
            battle.fx('crit', { x: target.x, y: target.y, id: unit.id });
          }
        });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_08 德克萨斯 剑雨: +cost DP; every enemy around (skill grid) takes two hits of atk_scale × ATK arts and is
  // stunned `stun` s — air units too (PRTS 备注 "※可对空"). 战术快递: +cost initial DP. (Elite hidden runtime_cost −4
  // "首次部署时部署费用-4": the initial deployment is free in battle ⇒ no effect.)
  // Alternate S1 冲锋号令·γ型 (AUTO, no target): +cost DP at once. An AUTO skill keeps its normal rule in this mode
  // (research 03 §1.4: only MANUAL skills are converted by the trigger table) ⇒ it fires as soon as SP is full.
  chess_char_1_08_a: (bb, chess, def) => ({
    skills: {
      'skcom_charge_cost[3]': {
        kind: 'instant', trigger: 'SP_FULL',
        onStart({ battle, unit }) {
          const n = num(skillBbOf(chess, 'skcom_charge_cost[3]').cost);
          battle.addDp(unit.ownerId, n);
          battle.fx('dp', { x: unit.x, y: unit.y, n, id: unit.id });
        },
      },
    },
    skill: {
      kind: 'instant',
      onStart({ battle, unit }) {
        battle.addDp(unit.ownerId, num(bb.cost));
        battle.fx('dp', { x: unit.x, y: unit.y, n: num(bb.cost), id: unit.id });
        const grid = def?.skill?.rangeGrid;
        const foes = grid ? enemiesInGrid(battle, unit, grid) : battle.foesInRadius(unit.x, unit.y, RING1).filter((e) => !e.s.flags.untargetable);
        battle.fx('aoe', { x: unit.x, y: unit.y, radius: 2, id: unit.id, skill: 'swordRain' });
        for (const e of foes) {
          for (let i = 0; i < 2 && e.alive; i++) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'arts', isSkill: true, tags: ['skill'] });
          if (e.alive) battle.applyStatus(e, 'stun', { duration: num(bb.stun), source: unit });
        }
      },
    },
    talents: [{ install(battle, unit) {
      const n = num(talentBb(chess, 0).cost);
      if (n > 0) battle.on('battleStart', () => battle.addDp(unit.ownerId, n), { owner: unit });
    } }],
  }),

  // ---------------------------------------------------------------------------------------------------------------
  // 1_09 跃跃 (回环射手: every attack is a boomerang out to the target and back — she attacks again only once it is
  // caught, professions.js loopshooter / ai.js throwBoomerang). 乐趣加倍: ATK +atk, each attack throws `cnt`
  // boomerangs at the target (cnt hits); they fly the same path, so the flight carries cnt hits and all of them are
  // back together ("必须回收全部回旋投掷物才可以进行下一次攻击"). 戏耍随心: prob per hit (each boomerang on its own) for
  // ATK ×atk_scale. Elite module (LPS-X, trait atk_scale): vs enemies on the 8 surrounding tiles ATK ×atk_scale.
  // Alternate S1 强力击·β型 (AUTO, attack SP): the next attack at atk_scale × ATK.
  chess_char_1_09_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const near = num(traitBb(chess).atk_scale, 1);
    return {
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk) }, attack: { hits: Math.max(1, Math.floor(num(bb.cnt, 1))) } },
      skills: { skchr_caper_1: { kind: 'instant', attack: { atkScale: num(skillBbOf(chess, 'skchr_caper_1').atk_scale, 1) } } },
      talents: [{ install(battle, unit) {
        onHitBy(battle, unit, ({ target, dmg }) => {
          if (!dmg.isAttack) return;
          if (near !== 1 && cheb(unit, target) <= 1) dmg.amount *= near;
          if (!dmg.isSplash && num(t.prob) > 0 && battle.rng.chance(num(t.prob))) {
            dmg.amount *= num(t.atk_scale, 1);
            battle.fx('crit', { x: target.x, y: target.y, id: unit.id });
          }
        });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_10 古米 备用军粮 (自动触发, ct charges — an AUTO skill: no 技能策略 applies, it keeps its own rule; PRTS 备注 "此技能
  // 在存在生命值不满的可治疗角色时可触发；技能触发后古米将切换至治疗模式（普通攻击改为治疗技能范围内的一名友方单位），直至古米
  // 完成一次普通攻击的治疗"): cast as soon as a healable ally of the skill range (x-4, herself included) is injured —
  // no enemy needed (user playtest #6: it waited until she engaged) — then her next normal attack heals the most
  // injured ally of the skill range for heal_scale × ATK instead of hitting an enemy; she makes no normal attack until
  // that heal is done. Elite module (GUA-X): targets below hp_ratio HP get ×heal_scale more.
  // 平底锅专精: each attack prob for ATK ×atk_scale and a `stun` s stun (only when that hit lands).
  // Alternate S2 食粮烹制 (PRTS notes: 10 s 缴械 at the start, the real duration is disarm + 30 s, attacks become heals
  // with the attack interval +130 %): cooking for `disarm` s — no attacks, DEF +def; then for the skill's `duration` s
  // she heals the most injured ally inside the skill grid (x-4) for ATK per attack, ATK +atk, base attack time
  // ×(1 + base_attack_time). The GUA-X heal bonus (below hp_ratio: ×heal_scale) applies to these heals too.
  // Trigger: TAKE_DAMAGE (data: the 重装 strategy "不受技能范围影响，受到伤害时释放技能").
  chess_char_1_10_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    const S2 = 'skchr_sunbr_2';
    const r2 = skillRec(chess, S2);
    const b2 = r2?.bb ?? {};
    const cook = Math.max(0, num(b2.disarm, 10));
    const cookKey = 'sunbr:cook', serveKey = 'sunbr:serve';
    const healGrid = def?.skill?.rangeGrid ?? null;
    return {
      skills: {
        [S2]: {
          kind: 'duration', duration: cook + Math.max(0, num(r2?.duration, 30)),
          mods: { batPct: Math.max(0, num(b2.base_attack_time)) },
          targeting: { rangeGrid: r2?.rangeGrid ?? def?.skill?.rangeGrid ?? null },
          attack: { dmgType: 'heal', heal: { mode: 'single' } },
          onStart({ battle, unit }) {
            battle.addBuff(unit, { key: cookKey, duration: cook, mods: { defPct: num(b2.def) }, flags: { disarm: true }, tags: ['skill'], visible: true });
          },
          onTick({ battle, unit }) {
            if (!unit.findBuff(cookKey) && !unit.findBuff(serveKey)) {
              battle.addBuff(unit, { key: serveKey, mods: { atkPct: num(b2.atk) }, tags: ['skill'] });
              battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'heal' });
            }
          },
          onEnd({ battle, unit }) {
            battle.removeBuff(unit, cookKey);
            battle.removeBuff(unit, serveKey);
          },
        },
      },
      install(battle, unit) {
        if (tb.hp_ratio == null || num(tb.heal_scale, 1) === 1) return;
        // GUA-X on her skill heals (S1's heal-mode attack, S2's attack heals while it runs — herself included, she stands
        // in the grid), never her natural / self regeneration
        battle.on('heal', (ctx) => {
          if (ctx.source !== unit || !unit.skill?.active || ctx.opts?.regen || ctx.opts?.self) return;
          if (ctx.target.hpRatio < num(tb.hp_ratio)) ctx.amount *= num(tb.heal_scale, 1);
        }, { owner: unit });
      },
      skill: {
        kind: instantKind(def),
        heal: true,
        ...(healGrid ? { trigger: { rule: 'SKILL_RANGE', grid: healGrid, allies: true }, targeting: { rangeGrid: healGrid } } : {}),
        // the heal-mode attack: the most injured ally of the skill range (acquireTargets, heal profile)
        attack: { dmgType: 'heal', heal: { mode: 'single' }, healScale: num(bb.heal_scale, 1), projectile: 'none' },
        onHit({ battle, target }) { if (target) battle.fx('heal', { x: target.x, y: target.y, id: target.id }); },
      },
      talents: [{ install(battle, unit) {
        // the proc is rolled per attack hit; the stun only follows a hit that landed (not dodged / cancelled)
        const procs = new WeakSet();
        onHitBy(battle, unit, ({ target, dmg }) => {
          if (!isMainHit(dmg) || !(num(t.prob) > 0) || !battle.rng.chance(num(t.prob))) return;
          dmg.amount *= num(t.atk_scale, 1);
          procs.add(dmg);
          battle.fx('crit', { x: target.x, y: target.y, id: unit.id });
        });
        battle.on('damaged', (ctx) => {
          if (ctx.source !== unit || !ctx.dmg || !procs.has(ctx.dmg) || !ctx.target.alive) return;
          procs.delete(ctx.dmg);
          battle.applyStatus(ctx.target, 'stun', { duration: num(t.stun), source: unit });
        }, { owner: unit });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_11 地灵 (hidden) 攻击力强化·β型: ATK +atk. Elite 地质勘探: trait 停顿 +sluggish s (module trait 1.2 s included).
  chess_char_1_11_a: (bb, chess) => {
    const add = num(talentBb(chess, 0).sluggish);
    const kit = { skill: { kind: 'duration', mods: { atkPct: num(bb.atk) } } };
    if (add > 0) kit.trait = { onHitStatus: { key: 'sluggish', duration: num(traitBb(chess).sluggish, 0.8) + add } };
    return kit;
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_12 艾丝黛尔 舍身突击 (hurt SP): ATK +atk, cannot be healed by others. 自愈能力: an enemy dying within the talent
  // grid (8 surrounding tiles) heals her hp_ratio × max HP. Elite module (CEN-Y): above hp_ratio HP, physical damage
  // taken −damage_resistance.
  // Alternate S1 攻击力强化·β型: ATK +atk (she stays a heal target).
  chess_char_1_12_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const grid = talentGrid(chess, 0);
    const tb = traitBb(chess);
    return {
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk) }, flags: { noHeal: true } },
      skills: { 'skcom_atk_up[2]': { kind: 'duration', mods: { atkPct: num(skillBbOf(chess, 'skcom_atk_up[2]').atk) } } },
      talents: [{ install(battle, unit) {
        battle.on('death', (ctx) => {
          const e = ctx.unit;
          if (e.side !== 'enemy' || ctx.reason !== 'killed' || !up(unit)) return;
          const near = grid ? bodyInKeys(e, absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0)) : cheb(unit, e) <= 1;
          if (near) battle.heal(unit, unit, unit.s.maxHp * num(t.hp_ratio), { self: true, tags: ['talent'] });
        }, { owner: unit });
        if (tb.damage_resistance != null) {
          onHitOn(battle, unit, ({ dmg }) => { if (dmg.type === 'phys' && unit.hpRatio > num(tb.hp_ratio)) dmg.mul *= 1 - num(tb.damage_resistance); });
        }
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_13 波登可 孢子扩散: a vial bursts on the current target into a projectile_delay_time s spore cloud (radius 0.9,
  // PRTS 备注, 可对空): enemies inside are 停顿 and lose their abilities (silence) and take atk_scale × ATK arts per second.
  // 园丁: every 【辅助】 operator on the field ATK +atk. Elite module (DEC-X): +sp_recovery_per_sec SP/s with an enemy in range.
  // Alternate S1 花香疗法: ATK +atk, normal attacks heal the most injured ally in range instead (ATK per attack). A heal
  // skill: DEFAULT fires it with an injured ally inside her initial range (research 03 §1.4) — also checked every tick,
  // since she is only "about to attack" with an enemy in range.
  chess_char_1_13_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const spBonus = num(moduleBb(chess).sp_recovery_per_sec);
    const dur = num(bb.projectile_delay_time, 5);
    const S1 = 'skchr_podego_1';
    return {
      skills: {
        [S1]: { kind: 'duration', heal: true, mods: { atkPct: num(skillBbOf(chess, S1).atk) }, attack: { dmgType: 'heal', heal: { mode: 'single' } } },
      },
      install(battle, unit) {
        if (unit.skill?.id !== S1) return;
        battle.on('tick', () => {
          const sk = unit.skill;
          if (!up(unit) || !unit.canAct || !sk.ready || sk.active || sk.opCooling || unit.s.flags.silence) return;
          if (battle.injuredAlliesInKeys(unit.baseRangeKeys || unit.rangeKeys, unit).length) sk.activate('DEFAULT');
        }, { owner: unit });
      },
      skill: {
        kind: 'instant',
        onStart({ battle, unit }) {
          const tgt = enemiesInGrid(battle, unit, null, { n: 1 })[0];
          const x = tgt ? tgt.x : unit.x + unit.fwd[1], y = tgt ? tgt.y : unit.y + unit.fwd[0];
          const atk = unit.s.atk;
          makeZone(battle, unit, {
            x, y, radius: SPORE_RADIUS, duration: dur, skill: 'spores', onPulse(b) {
              for (const e of b.foesInRadius(x, y, SPORE_RADIUS)) {
                if (e.s.flags.untargetable) continue;
                b.applyStatus(e, 'sluggish', { duration: 1.05, source: unit });
                b.applyStatus(e, 'silence', { duration: 1.05, source: unit });
                b.dealDamage(unit, e, { amount: atk * num(bb.atk_scale), type: 'arts', isSkill: true, canDodge: false, tags: ['dot', 'zone'] });
              }
            },
          });
        },
      },
      talents: [{ install(battle, unit) {
        const v = num(t.atk);
        if (v) installAura(battle, unit, { key: 'talent:podego', value: v, select: (a) => a.kind === 'op' && a.def.profession === 'SUPPORT', mods: { atkPct: v } });
        spTimeBonus(battle, unit, spBonus, () => enemyInRange(battle, unit));
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_14 格雷伊 静电释放: ASPD +attack_speed, the talent 停顿 lasts talent_scale × longer.
  // 静电场: attacks cause `sluggish` s of 停顿 to the attacked target.
  // Alternate S1 战术咏唱·β型: ASPD +attack_speed (the talent 停顿 keeps its length). Elite module SPC-Y: cost only.
  chess_char_1_14_a: (bb, chess) => {
    const sl = num(talentBb(chess, 0).sluggish);
    return {
      skills: { 'skcom_magic_rage[2]': { kind: 'duration', mods: { aspd: num(skillBbOf(chess, 'skcom_magic_rage[2]').attack_speed) } } },
      trait: sl > 0 ? { onHitStatus: { key: 'sluggish', duration: sl } } : undefined,
      skill: {
        kind: 'duration', mods: { aspd: num(bb.attack_speed) },
        attack: sl > 0 ? { onHitStatus: { key: 'sluggish', duration: sl * num(bb.talent_scale, 1) } } : {},
      },
    };
  },

  // 1_15 盟约·辅助干员 (hidden, band 优等生): its kit is tier6.js `pithst` (迭代元素 — one implementation only).

  // ---------------------------------------------------------------------------------------------------------------
  // 1_16 锡人 (hidden tier-1 entry of chess_char_2_19): see tinmanKit.
  chess_char_1_16_a: tinmanKit,

  // ---------------------------------------------------------------------------------------------------------------
  // 1_17 深靛 光影迷宫: attack interval ×base_attack_time, talent chance ×talent_scale, bound enemies in range take
  // indigo_s_2[damage].atk_scale × ATK arts every indigo_s_2[damage].interval s.
  // 柔光缚目: attacks bind the target `duration` s with `prob`; bound enemies are never chosen as targets.
  // Alternate S1 灯塔守卫者: for `duration` s the skill range (4-1), attack interval ×(1 + base_attack_time) (PRTS:
  // "大幅度缩短(-80%)" ⇒ ×0.2 — a flat −0.8 s on 3 s would be less than S2's "略微缩短 ×0.7"), every attack hits for
  // attack@atk_scale × ATK arts. Elite module MSC-X (store 4) is the mystic profile of the module trait (TUNE.mystic).
  chess_char_1_17_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const dScale = num(bb['indigo_s_2[damage].atk_scale']);
    const dIv = num(bb['indigo_s_2[damage].interval'], 0.5);
    const bound = (e) => !!e.s.flags.bind;
    const r1 = skillRec(chess, 'skchr_indigo_1');
    const b1 = r1?.bb ?? {};
    return {
      skills: {
        skchr_indigo_1: {
          kind: 'duration', mods: { batPct: Math.max(-0.95, Math.min(0, num(b1.base_attack_time))) },
          targeting: { rangeGrid: r1?.rangeGrid ?? null },
          attack: { atkScale: num(b1['attack@atk_scale'], 1) },
        },
      },
      trait: {
        // with only bound enemies in range (or blocked by her — always her targets, Battle.blockedTargets) she holds her
        // fire (the mystic trait stores the energy meanwhile)
        canAttack(battle, u) {
          const ok = battle.enemiesInKeys(u.rangeKeys, u, u.profile).some((e) => !bound(e)) || battle.blockedTargets(u, u.profile).some((e) => !bound(e));
          if (!ok) u.trait.hadTarget = false;
          return ok;
        },
        afterHit(battle, u, target) {
          if (!target || !target.alive || target.side !== 'enemy') return;
          const p = num(t.prob) * (u.skill?.active ? num(bb.talent_scale, 1) : 1);
          if (p > 0 && battle.rng.chance(Math.min(1, p))) battle.applyStatus(target, 'bind', { duration: num(t.duration), source: u });
        },
      },
      skill: {
        kind: 'duration', mods: { batPct: batMod(bb.base_attack_time, chess, def?.skill?.description ?? chess?.skill?.desc) },
        onStart({ unit }) { unit.mem.indigoAcc = 0; },
        onTick({ battle, unit, dt }) {
          if (!(dScale > 0) || !(dIv > 0)) return;
          unit.mem.indigoAcc = (unit.mem.indigoAcc ?? 0) + dt;
          while (unit.mem.indigoAcc >= dIv - 1e-9) {
            unit.mem.indigoAcc -= dIv;
            for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) {
              if (bound(e)) battle.dealDamage(unit, e, { amount: unit.s.atk * dScale, type: 'arts', isSkill: true, canDodge: false, tags: ['dot'] });
            }
          }
        },
      },
      talents: [{ install(battle, unit) {
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !ctx.targets.some(bound)) return;
          const prof = ctx.profile || unit.profile;
          const cands = battle.enemiesInKeys(unit.rangeKeys, unit, prof);
          for (const e of battle.blockedTargets(unit, prof)) if (!cands.includes(e)) cands.push(e);
          for (let i = cands.length - 1; i >= 0; i--) if (bound(cands[i])) cands.splice(i, 1);
          sortEnemyTargets(battle, unit, cands, prof.priority);
          ctx.targets = cands.slice(0, Math.max(1, ctx.targets.length));
        }, { owner: unit });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_18 宴 落地斩·破门 (passive): at each deployment lose hp_ratio of current HP, then for `duration` s ATK +atk and
  // attacks deal arts damage. 认真模式: 坚忍 ASPD up to +min_attack_speed, reached at min_hp_ratio HP (linear).
  // Elite (module talent): below hp_ratio HP, 庇护 −damage_resistance physical/arts damage taken.
  // Alternate S1 分神: stops attacking, block count 0 (her blocked enemies walk on), DEF +def, recovers
  // hp_recovery_per_sec_by_max_hp_ratio × max HP per second (the 生命回复速度 attribute: works under her 武者 no-heal).
  chess_char_1_18_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const buffKey = 'utage:s2';
    const s1 = skillBbOf(chess, 'skchr_utage_1');
    return {
      skills: {
        skchr_utage_1: {
          kind: 'duration',
          mods: { defPct: num(s1.def), hpRegenRatio: num(s1.hp_recovery_per_sec_by_max_hp_ratio), blockCnt: -99 },
          attack: { noAttack: true },
          onStart({ battle, unit }) { battle.releaseBlocked(unit); },
        },
      },
      skill: {
        kind: 'passive',
        onStart({ battle, unit }) {
          const loss = unit.hp * num(bb.hp_ratio);
          if (loss > 0 && unit.hp - loss >= 1) battle.loseHp(unit, loss, { source: unit });
          battle.addBuff(unit, { key: buffKey, duration: num(bb.duration), mods: { atkPct: num(bb.atk) }, tags: ['skill'], visible: true });
          battle.fx('aoe', { x: unit.x, y: unit.y, radius: 1, id: unit.id, skill: 'breach' });
        },
      },
      talents: [{ install(battle, unit) {
        onHitBy(battle, unit, ({ dmg }) => { if (dmg.isAttack && dmg.type === 'phys' && unit.findBuff(buffKey)) dmg.type = 'arts'; });
        const maxAs = num(t.min_attack_speed), minHp = num(t.min_hp_ratio);
        if (maxAs > 0 && minHp < 1) {
          battle.on('tick', () => {
            if (!up(unit)) return;
            const v = maxAs * Math.max(0, Math.min(1, (1 - unit.hpRatio) / (1 - minHp)));
            const cur = unit.findBuff('utage:serious');
            if (cur && Math.abs((cur.data?.v ?? 0) - v) < 0.5) return;
            if (v < 0.5) { if (cur) battle.removeBuff(unit, 'utage:serious'); return; }
            battle.addBuff(unit, { key: 'utage:serious', mods: { aspd: v }, data: { v }, tags: ['talent'] });
          }, { owner: unit });
        }
        // 庇护 (ba.protect): "受到的物理和法术伤害降低相应比例" — physical and arts damage only
        if (t.damage_resistance != null && t.hp_ratio != null) {
          onHitOn(battle, unit, ({ dmg }) => {
            if ((dmg.type === 'phys' || dmg.type === 'arts') && unit.hpRatio < num(t.hp_ratio)) dmg.mul *= 1 - num(t.damage_resistance);
          });
        }
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_19 野鬃 夹枪冲锋: wider range (skill grid), ATK +atk, "攻击会把目标往攻击方向中等力度地推开" (attack@force 1 = 中力) by
  // the official 力度 − 重量 distance (Battle.push: weight 0 → 2.14 tiles, 1 → 1.7, 2 → 0.44, 3 → 0.12, ≥ 4 → none; user
  // playtest #6 item 14). A directional push (方向力, PRTS 推与拉): the client's S2 attack ability (charpack
  // char_496_wildmn, anim Skill_2) carries buff wildmn_s_2[force] of template knockback[dir] — buff_template_data:
  // Knockback {_useSourceDirection: true, _decreaseForceLevelWhenNotInDirection: 2} — i.e. along her deploy direction,
  // radial at 受力等级 −2 for a target > 45° off it or < 0.25 tile away (特殊修正); the radial pushes are
  // knockback[relative] (琳琅诗怀雅 S3, 山 S3, 莫斯提马 S3). Her text uses the 推击手 wording "往攻击方向". So an enemy she
  // grabs behind her centre (the hand-over after a push freed her block) is not thrown 1.7 tiles towards the objective
  // (player feedback D2, "往攻击方向相反方向推"; it was a radial push before).
  // 一致向前: after deploying (normal flag 0: first deployment only; elite flag 1: every deployment) every undeployed
  // 【近卫】 operator of the player costs `value` less DP to deploy (≤ max_stack_cnt per operator until it deploys).
  // Alternate S1 骑枪刺击 (PASSIVE, ON_DEPLOY): for `duration` s after every deployment ASPD +attack_speed.
  // Elite module CHG-X (+2 DP per kill) is the charger profile of the module trait (TUNE.charger).
  chess_char_1_19_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const force = num(bb['attack@force'], 1);
    const r1 = skillRec(chess, 'skchr_wildmn_1');
    return {
      skills: {
        skchr_wildmn_1: {
          kind: 'passive',
          onStart({ battle, unit }) {
            const d = num(r1?.duration);
            if (d > 0) battle.addBuff(unit, { key: 'wildmn:s1', duration: d, mods: { aspd: num(r1?.bb?.attack_speed) }, tags: ['skill'], visible: true });
          },
        },
      },
      skill: {
        kind: 'duration', mods: { atkPct: num(bb.atk) },
        targeting: { rangeGrid: def?.skill?.rangeGrid ?? null },
        attack: {
          onHit({ battle, unit, target }) {
            if (!target || !target.alive || target.side !== 'enemy') return;
            battle.push(target, force, { from: unit, dir: { x: unit.fwd[1], y: unit.fwd[0] } });
          },
        },
      },
      talents: [{ install(battle, unit) {
        const cut = Math.abs(num(t.value, -1)), cap = num(t.max_stack_cnt, 1), every = num(t.flag) === 1;
        let deploys = 0;
        battle.on('deploy', ({ unit: u }) => {
          if (u === unit) {
            deploys++;
            if (!every && deploys > 1) return;
            for (const a of battle.allyUnits) {
              if (a === unit || a.kind !== 'op' || a.ownerId !== unit.ownerId || a.alive || a.removed || a.def.profession !== 'WARRIOR') continue;
              const done = a.mem.wildmnCut ?? 0;
              const d = Math.min(cut, cap - done, a.base.cost);
              if (d > 0) { a.base.cost -= d; a.mem.wildmnCut = done + d; }
            }
          } else if (u.mem.wildmnCut > 0) {
            // the discount is consumed by this deployment
            u.base.cost += u.mem.wildmnCut;
            u.mem.wildmnCut = 0;
          }
        }, { owner: unit });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 1_20 雷蛇 反击电弧 (hurt SP): attack interval ×(1 + base_attack_time) (PRTS "攻击间隔增大(+70%)": a RATIO for this skill,
  // 1.2 → 2.04 s — not +0.7 s), ATK +atk, arts attacks on up to attack@max_target enemies,
  // attack@buff_prob to stun attack@stun s; afterwards 雷蛇 is stunned `stun` s.
  // 技能策略 → DEFAULT (PR #12; DESIGN §21.29): 反击电弧 is an offensive skill (ATK +125 %, arts hits on up to 3 enemies,
  // stun); the official 下半 TANK row (TAKE_DAMAGE for every MANUAL 重装 skill) made it — and 深巡's S2 — wait for a hit
  // (GitHub issue #4). The owner's deliberate deviation from that row (2026-10-03, community feedback) gives both
  // 哨戒铁卫 S2s the basic strategy; the data says DEFAULT too (rawRule keeps the official TAKE_DAMAGE).
  // 战术防御: when attacked, +sp SP to herself and to one random ally in the talent grid. Elite 雷抗: RES +magic_resistance.
  // Elite module (SPT-X): stealth of enemies inside the range is cancelled.
  // Alternate S1 充能防御 (AUTO, hurt SP, "技能自动开启" — an AUTO skill takes no 技能策略: SP_FULL, so the hit that fills SP
  // sets it off): PRTS "技能拥有8s的持续时间": for bb.duration s DEF +def, and the next damage instance taken is blocked
  // (cancelled — a blocked hit "导致第一天赋无法触发": no 战术防御 SP, no hurt SP).
  chess_char_1_20_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const grid = talentGrid(chess, 0);
    const S1 = 'skchr_liskam_1';
    const b1 = skillBbOf(chess, S1);
    const blockKey = 'liskam:block';
    return {
      skills: {
        [S1]: {
          kind: 'duration', duration: num(b1.duration, 8), mods: { defPct: num(b1.def) }, trigger: 'SP_FULL',
          onStart({ battle, unit, skill }) {
            battle.addBuff(unit, { key: blockKey, duration: skill.duration + 0.05, tags: ['skill'], visible: true });
            battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id });
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, blockKey); },
        },
      },
      install(battle, unit) {
        if (moduleOn(chess) && chess.isGolden) installReveal(battle, unit);
        if (unit.skill?.id !== S1) return;
        battle.on('hit', (ctx) => {
          if (ctx.target !== unit || ctx.dmg.cancel || !(ctx.dmg.amount > 0) || !unit.findBuff(blockKey)) return;
          ctx.dmg.cancel = true;
          battle.removeBuff(unit, blockKey);
          battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id });
        }, { owner: unit, priority: 50 });
      },
      skill: {
        trigger: 'DEFAULT',
        kind: 'duration', mods: { atkPct: num(bb.atk), batPct: Math.max(0, num(bb.base_attack_time)) },
        targeting: { maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 1))) },
        attack: {
          dmgType: 'arts',
          onHit({ battle, unit, target }) {
            if (target && target.alive && battle.rng.chance(num(bb['attack@buff_prob']))) battle.applyStatus(target, 'stun', { duration: num(bb['attack@stun']), source: unit });
          },
        },
        onEnd({ battle, unit, reason }) {
          if (reason !== 'death' && unit.alive && num(bb.stun) > 0) battle.applyStatus(unit, 'stun', { duration: num(bb.stun), source: unit });
        },
      },
      talents: [{ install(battle, unit) {
        const sp = num(t.sp);
        if (sp > 0) {
          // PRTS 备注 "仅伤害量不为0且能够触发受击回复的伤害才能触发此天赋": any such damage, not only an enemy attack
          // (a zone tick, the 源石溶剂 drain — player report D1 audit)
          onDamagedOn(battle, unit, (ctx) => {
            if (!hurtSpDamage(ctx) || !up(unit)) return;
            giveSp(unit, sp);
            const mates = alliesInGridOf(battle, unit, grid ?? [[1, 0], [0, -1], [0, 1], [-1, 0]]).filter((a) => a !== unit && a.skill && !a.skill.noSkill);
            const m = battle.rng.pick(mates);
            if (m) giveSp(m, sp);
          });
        }
        statBuff(battle, unit, 'talent:liskam', { resFlat: num(talentBb(chess, 1).magic_resistance) });
      } }],
    };
  },
};

