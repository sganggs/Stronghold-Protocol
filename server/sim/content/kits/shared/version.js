// server/sim/content/kits/shared/version.js — helpers shared by the 第一期 charId kits (ops/ver-*.js, DESIGN §35.22.9).

import { CHAIN_RADIUS, COLS } from '../../../constants.js';
import { aggregateMods } from '../../../buffs.js';
import { offsetTile } from '../../../dir.js';
import { num, skillRec, traitBb, up } from './tier1.js';

/** `one_minus_status_resistance` (−0.5 ⇒ 50% 抵抗) clamped to the engine's resist value. */
export const resistValue = (v) => {
  const n = num(v, 0);
  return n < 0 ? Math.min(0.95, -n) : 0;
};

/** "周围四格" of high ground: the four orthogonal neighbours. [ASSUMED] absolute tiles, not facing-relative. */
export function highlandNear(battle, unit) {
  let n = 0;
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const t = battle.grid.tile(unit.tileR + dr, unit.tileC + dc);
    if (t && t.height === 'HIGH') n++;
  }
  return n;
}

/** The ally on the tile directly ahead (部署方向), or null. */
export function frontAlly(battle, unit) {
  const [r, c] = offsetTile(unit.tileR, unit.tileC, 0, 1, unit.dir);
  const a = battle.unitAt(r, c);
  return a && a.side === 'ally' && a !== unit ? a : null;
}

/** Largest element gauge (灼燃 / 神经 / 凋亡 / 坏死 / 侵蚀). */
export const elemLoad = (a) => Math.max(a?.elem?.burn ?? 0, a?.elem?.neural ?? 0, a?.elem?.necrosis ?? 0, a?.elem?.apoptosis ?? 0, a?.elem?.erosion ?? 0);

/** Magazine written in a skill text ("装有9发子弹") when the flattened blackboard has no ammo key. 0 when the text has none. */
export function ammoInText(desc) {
  const m = /(\d+)发子弹/.exec(String(desc || ''));
  return m ? +m[1] : 0;
}

/** "N名" written in a skill text. */
export function namedCount(desc, fallback = 1) {
  const m = /(\d+)名/.exec(String(desc || ''));
  return m ? +m[1] : fallback;
}

/** A tile of the field is deep water (锡兰 "场地中存在水地形", together with the runtime water tag). */
export function fieldHasDeepWater(battle) {
  const w = battle.grid?.deepWater;
  if (!w) return false;
  for (let i = 0; i < w.length; i++) if (w[i]) return true;
  return false;
}

/** Skill text (`desc` on a built chess, `description` on a normalised skill). */
export const descOf = (rec) => rec?.desc ?? rec?.descRaw ?? rec?.description ?? '';

/** A copy of the skill's range, or of its trigger grid when the skill range itself is empty. */
export function gridOf(rec) {
  const g = (Array.isArray(rec?.rangeGrid) && rec.rangeGrid.length ? rec.rangeGrid : null)
    || (Array.isArray(rec?.trigger?.customRangeGrid) && rec.trigger.customRangeGrid.length ? rec.trigger.customRangeGrid : null);
  return g ? g.map((p) => [p[0], p[1]]) : null;
}

/** Instant, or charges when this skill's own record stores more than one. */
export const chargeKind = (rec) => ((rec?.maxChargeTime ?? 1) > 1 ? 'charges' : 'instant');

/** Positive data duration, or undefined so the runtime keeps the normalised skill's. */
export const posDur = (rec) => (typeof rec?.duration === 'number' && rec.duration > 0 ? rec.duration : undefined);

/**
 * Every skill of `chess` built by `build(id, rec, bb)`, plus `skill` = the selected one.
 * Each spec closes over that skill's own blackboard (a kit is called once, for whichever skill is selected).
 */
export function kitSkills(chess, def, build) {
  const skills = {};
  const ids = [];
  for (const s of chess?.skills ?? []) if (s?.skillId && !ids.includes(s.skillId)) ids.push(s.skillId);
  const sid = chess?.skill?.skillId ?? def?.skill?.id ?? null;
  if (sid && !ids.includes(sid)) ids.push(sid);
  for (const id of ids) {
    const rec = skillRec(chess, id);
    skills[id] = build(id, rec, rec?.bb ?? {});
  }
  return { skills, skill: sid ? skills[sid] ?? null : null, sid };
}

/**
 * Chain shape for one skill attack. Falloff is 0 when the trait says the jumps no longer lose damage
 * (`attack@chain.atk_scale` 1), otherwise the branch's 15 %.
 */
export function chainShape(chess, count, sluggish) {
  const tb = traitBb(chess);
  const falloff = tb['attack@chain.atk_scale'] != null ? 1 - num(tb['attack@chain.atk_scale'], 1) : 0.15;
  return {
    count: num(count, 3),
    radius: CHAIN_RADIUS,
    falloff,
    sluggish: sluggish != null ? num(sluggish) : num(tb['attack@sluggish'], 0.5),
  };
}

/**
 * 鼓舞: +`val` of `stat` (`atk` / `def` / `hp`) after the target's own multipliers (flat compensated), strongest
 * source wins. `mem.noInspire` (吟游者 "自身不受鼓舞影响") never receives it. Same keys as 浊心斯卡蒂's inspire.
 */
export function inspireStat(battle, target, val, src, stat = 'atk') {
  if (!(val > 0) || !up(target) || target.mem?.noInspire) return;
  const key = stat === 'atk' ? 'inspire' : `inspire:${stat}`;
  const cur = target.findBuff(key);
  if (cur && cur.data && cur.data.src !== src.id && cur.data.val > val && cur.timeLeft > 0.1) return;
  const { add, mul } = aggregateMods(target.buffs.filter((b) => b.key !== key));
  const f = stat === 'def' ? Math.max(0, 1 + (add.defPct ?? 0)) * (mul.defMul ?? 1)
    : stat === 'hp' ? Math.max(0, 1 + (add.hpPct ?? 0)) * (mul.hpMul ?? 1)
      : Math.max(0, 1 + (add.atkPct ?? 0)) * (mul.atkMul ?? 1);
  const flat = f > 1e-6 ? val / f : val;
  const mods = stat === 'def' ? { defFlat: flat } : stat === 'hp' ? { hpFlat: flat } : { atkFlat: flat };
  battle.addBuff(target, { key, mods, duration: 0.75, refresh: 'replace', source: src, visible: true, data: { src: src.id, val } });
}

/** Gradual DP: `per` every `interval` seconds, `packets` times, the rest when the skill ends on its duration. */
export function beginDp(unit, key, interval, packets, per) {
  unit.mem[key] = { acc: 0, got: 0, interval: Math.max(0.05, num(interval, 1)), packets: Math.floor(num(packets)), per: num(per, 1) };
}
export function tickDp(battle, unit, key, dt) {
  const m = unit.mem[key];
  if (!m) return;
  m.acc += dt;
  let guard = 0;
  while (m.acc + 1e-9 >= m.interval && m.got < m.packets && guard++ < 64) { // loop-cap: one packet per interval, bounded by the packet count
    m.acc -= m.interval;
    m.got++;
    battle.addDp(unit.ownerId, m.per, unit);
  }
}
export function endDp(battle, unit, key, reason) {
  const m = unit.mem[key];
  unit.mem[key] = null;
  if (m && reason === 'duration' && m.got < m.packets) battle.addDp(unit.ownerId, (m.packets - m.got) * m.per, unit);
}

/** Hidden module trait "攻击范围内所有敌人移动速度−N%" (`move_speed` negative): a slow while they stay in range. */
export function installRangeSlow(battle, unit, moveSpeed) {
  const v = Math.abs(num(moveSpeed));
  if (!(v > 0)) return;
  battle.every(0.25, () => {
    if (!up(unit) || !unit.rangeKeys) return;
    for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) {
      battle.applyStatus(e, 'slow', { value: v, duration: 0.45, source: unit });
    }
  }, { owner: unit, immediate: true });
}

export { COLS };
