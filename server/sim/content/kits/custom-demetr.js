// 贝洛内 (char_4037_demetr, WARRIOR / fighter) — DIY catalog kit. Official numbers come from the resolved def
// (talent / trait / skill blackboards incl. the ADVANCED module's trait + talent upgrades merged by the builder).
//
// T1 家族手段: every attack cuts the target's DEF by `attack@def` (−7 %, the module −8 %) for `attack@def_dec_duration`
//   (10 s), at most `attack@limited_stack_cnt` (5) stacks — `attack@s2_limited_stack_cnt` (8) while S2 runs, and a target
//   at the cap is 停顿 (sluggish) then. Damage he deals to a target scales with its missing HP: ×1.00 at full HP up to
//   ×1 + `max_add_on_scale` (1.28; module 1.42) at or below `max_hp_ratio` (20 %).
// T2 街头直觉: `init_prob` (80 %) phys/arts dodge right after deployment, decaying `dec_prob` (2 %) per second for
//   `trig_cnt` (20) seconds down to the 40 % the description names (init − dec × trig = 0.4).
// S1 家主的余裕 (AUTO/attack SP, 4): the next attack hits the target twice at `atk_scale` (210 %) ATK phys.
// S2 军师的手段 (MANUAL, 26 / 18 s): the skill range, ASPD +`attack_speed` (60), each attack hits `attack@max_target`
//   (3) targets at `attack@atk_scale` (170 %) ATK phys; the T1 cap rises to 8 (sluggish at the cap, above).
// S3 清算 (MANUAL, 39 / 30 s): ATK +`…[bonus].atk` (140 %), ASPD +`…[bonus].attack_speed` (40), each hit has a
//   `…[bonus].prob` (40 %) chance of an extra `…[bonus].prob_atk_scale` (150 %) ATK phys instance; on cast (and whenever
//   an élite/boss he attacked dies, or he has not attacked for `[target_timer].interval × [target_timer].time_stack` =
//   0.5 × 2 = 1 s) he picks one ground enemy of the trigger's search grid (自身周围 a 2-tile circle, the data's
//   CUSTOM_RANGE_SEARCH_ENEMY grid) and moves onto its tile when that tile is deployable; a lethal blow does not knock
//   him out — the skill ends instead — after which he returns to the tile the skill was cast from.
//
// [ASSUMED] `attack@finish_listener_duration` (3 s) is not modelled as a delay before the return home: the text only
//   says "技能结束后返回初始位置" (the return runs in onEnd).
// [ASSUMED] the 停顿 lasts `attack@def_dec_duration` (10 s) and is refreshed on every attack while the target sits at
//   the T1 cap with S2 running (the official length of the "叠满" state is not in the blackboard).
// [ASSUMED] stacks above the S2 cap (8) are clamped back to 5 when the skill ends (the official per-skill cap is
//   modelled on the running skill, not on the lasting buff).

import { num, talentBb, onHitBy, toggleBuff } from './tier1.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../targeting.js';

const selectedId = (chess, def) => chess?.skill?.skillId ?? def?.skill?.id ?? def?.skill?.skillId ?? null;
const gridOf = (def) => def?.skill?.rangeGrid ?? def?.skill?.trigger?.grid ?? def?.skill?.trigger?.customRangeGrid ?? null;
const op = (u) => !!u && u.kind === 'op' && u.alive && u.deployed;
const enemy = (u) => !!u && u.side === 'enemy' && u.alive && !u.hidden;
const eliteness = (e) => !!e && (e.isBoss || e.def?.rank === 'ELITE' || e.def?.rank === 'BOSS');
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** 家主的余裕 "对目标造成两次…伤害": the double hit count (the description's 两次; the blackboard carries only atk_scale). */
const S1_HITS = 2;

function demetr(bb, chess, def) {
  const sid = selectedId(chess, def);
  const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1), tb = chess?.trait?.bb ?? {};
  const defPct = num(t0['attack@def'], -0.07);
  const defDur = num(t0['attack@def_dec_duration'], 10);
  const buffKey = (unit) => `demetr:def:${unit.id}`;
  // S2 runs (a unit only ever runs its own selected skill): its talent-1 cap / sluggish rider applies
  const s2On = (unit) => sid === 'skchr_demetr_2' && !!unit.skill?.active;
  const stackCap = (unit) => Math.max(1, num(s2On(unit) ? t0['attack@s2_limited_stack_cnt'] : t0['attack@limited_stack_cnt'], s2On(unit) ? 8 : 5));
  /** 家族手段 missing-HP damage multiplier: ×1 at `min_hp_ratio` (full HP) up to ×1 + `max_add_on_scale` at `max_hp_ratio`. */
  const missingHpScale = (target) => {
    const full = num(t0.min_hp_ratio, 1), low = num(t0.max_hp_ratio, 0.2);
    const t = clamp01((full - target.hpRatio) / Math.max(1e-9, full - low));
    const min = num(t0.min_add_on_scale, 0), max = num(t0.max_add_on_scale, 0.28);
    return 1 + min + (max - min) * t;
  };
  // S3 清算 — 自身周围 the skill's search grid (the data's CUSTOM_RANGE_SEARCH_ENEMY grid, a 2-tile circle): the ground
  // enemies on it, best target first (blocked/priority/remaining-distance order as every other pick of his).
  const searchGrid = gridOf(def) ?? null;
  const pickTarget = (battle, unit, exclude = null) => {
    if (!searchGrid) return null;
    const list = battle.enemiesInKeys(absoluteRangeKeys(searchGrid, unit.tileR, unit.tileC, unit.dir, 0), unit, { canHitFly: false })
      .filter((e) => e !== exclude);
    if (!list.length) return null;
    sortEnemyTargets(battle, unit, list, unit.profile?.priority ?? null);
    return list[0];
  };
  const freeGround = (battle, r, c) => battle.grid.inRect(r, c) && battle.grid.canStand(r, c) && !battle.grid.isObstacle(r, c) && !battle.isReservedTile(r, c);
  /** 【移动】至目标所在位置 (only when the tile is deployable). */
  const dash = (battle, unit, e) => {
    if (!enemy(e)) return false;
    const r = Math.round(e.y), c = Math.round(e.x);
    if (r === unit.tileR && c === unit.tileC) return true;
    if (!freeGround(battle, r, c)) return false;
    const fromX = unit.x, fromY = unit.y;
    if (!battle.relocate(unit, r, c)) return false;
    battle.fx('teleport', { x: unit.x, y: unit.y, id: unit.id, fromX, fromY });
    return true;
  };
  const reselect = (battle, unit, exclude = null) => {
    const e = pickTarget(battle, unit, exclude);
    unit.mem.demetrTarget = e;
    if (e) dash(battle, unit, e);
    return e;
  };
  const returnHome = (battle, unit, reason) => {
    const home = unit.mem.demetrHome;
    unit.mem.demetrHome = null;
    unit.mem.demetrTarget = null;
    if (!home || reason === 'death' || !op(unit)) return;
    if (unit.tileR === home.r && unit.tileC === home.c) return;
    const fromX = unit.x, fromY = unit.y;
    if (battle.relocate(unit, home.r, home.c)) battle.fx('teleport', { x: unit.x, y: unit.y, id: unit.id, fromX, fromY });
  };
  // 持续 1 秒未进行攻击时，会立即重新选取目标 (target_timer 0.5 s × 2)
  const idleWindow = num(bb['attack@demetr_s3[target_timer].interval'], 0.5) * num(bb['attack@demetr_s3[target_timer].time_stack'], 2);

  const skills = {
    skchr_demetr_1: { kind: 'instant', attack: { atkScale: num(bb.atk_scale, 1), hits: S1_HITS } },
    skchr_demetr_2: {
      kind: 'duration',
      mods: { aspd: num(bb.attack_speed) },
      targeting: { ...(gridOf(def) ? { rangeGrid: gridOf(def) } : {}), maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 3))) },
      attack: { atkScale: num(bb['attack@atk_scale'], 1) },
      // the S2 cap (8) is a property of the running skill: when it ends the T1 cap reverts to `attack@limited_stack_cnt`
      onEnd({ battle, unit }) {
        const cap = Math.max(1, num(t0['attack@limited_stack_cnt'], 5));
        for (const e of battle.enemies) {
          const b = e.findBuff(buffKey(unit));
          if (b && (b.stacks > cap || b.maxStacks > cap)) { b.stacks = Math.min(b.stacks, cap); b.maxStacks = cap; e.markDirty(); }
        }
      },
    },
    skchr_demetr_3: {
      kind: 'duration',
      mods: { atkPct: num(bb['attack@demetr_s3[bonus].atk'], 1.4), aspd: num(bb['attack@demetr_s3[bonus].attack_speed'], 40) },
      attack: {
        // 攻击时有 40 % 的几率造成相当于攻击力 150 % 的物理伤害 (one extra instance per hit that lands)
        onEachHit({ battle, unit, target, attackId }) {
          if (!enemy(target) || !battle.rng.chance(num(bb['attack@demetr_s3[bonus].prob'], 0.4))) return;
          battle.dealDamage(unit, target, { amount: unit.s.atk * num(bb['attack@demetr_s3[bonus].prob_atk_scale'], 1.5), type: 'phys', isSkill: true, attackId, tags: ['skill', 'demetrProc'] });
        },
      },
      onStart({ battle, unit }) {
        unit.mem.demetrHome = { r: unit.tileR, c: unit.tileC };
        unit.mem.demetrAttackAt = battle.time;
        reselect(battle, unit);
      },
      onAttack({ battle, unit }) { unit.mem.demetrAttackAt = battle.time; },
      onTick({ battle, unit }) {
        if (battle.time - (unit.mem.demetrAttackAt ?? -Infinity) < idleWindow) return;
        const cur = unit.mem.demetrTarget;
        if (enemy(cur) && Math.round(cur.y) === unit.tileR && Math.round(cur.x) === unit.tileC) return;
        reselect(battle, unit);
      },
      onEnd({ battle, unit, reason }) { returnHome(battle, unit, reason); },
    },
  };

  return {
    skills,
    skill: skills[sid],
    talents: [{ install(battle, unit) {
      onHitBy(battle, unit, ({ target, dmg }) => {
        if (!enemy(target)) return;
        // 家族手段 — "目标剩余生命值比例越低自身对其造成的伤害越高": every instance he deals (attacks, the S3 proc)
        if (dmg.amount > 0) dmg.amount *= missingHpScale(target);
        if (!dmg.isAttack) return;
        // …and every attack cuts its DEF for 10 s, at most `cap` stacks (8 while S2 runs)
        const cap = stackCap(unit);
        battle.addBuff(target, { key: buffKey(unit), duration: defDur, refresh: 'stack', maxStacks: cap, mods: { defPct }, source: unit, visible: true });
        const b = target.findBuff(buffKey(unit));
        if (b && b.stacks > cap) { b.stacks = cap; b.maxStacks = cap; target.markDirty(); }
        // S2 军师的手段: 叠满后对目标造成持续的停顿
        if (s2On(unit) && b && b.stacks >= cap) battle.applyStatus(target, 'sluggish', { duration: defDur, source: unit });
      });

      // 街头直觉: 40 % phys/arts dodge, 80 % right after deployment, −2 %/s over 20 s (init − dec × trig = 40 %)
      const floor = Math.max(0, num(t1.init_prob, 0.8) - num(t1.dec_prob, 0.02) * num(t1.trig_cnt, 20));
      battle.every(0.25, () => {
        if (!op(unit)) return;
        const p = Math.max(floor, num(t1.init_prob, 0.8) - num(t1.dec_prob, 0.02) * (battle.time - unit.deployedAt));
        battle.addBuff(unit, { key: 'demetr:dodge', duration: 0.4, mods: { dodgePhys: p, dodgeArts: p }, source: unit, visible: true });
      }, { owner: unit, immediate: true });

      // module FGT-Y 实用的工具 (Lv3) trait: 生命值高于50%时攻击速度+10 (bb merged into the trait by the builder)
      if (num(tb.attack_speed) > 0) toggleBuff(battle, unit, 'demetr:trait', () => unit.hpRatio > num(tb.hp_ratio, 0.5), { aspd: num(tb.attack_speed) });

      // 清算: 自身攻击的精英、领袖敌人被击倒 → 立即重新选取目标 (the victim is still `alive` inside the kill hook: exclude it)
      battle.on('kill', ({ victim }) => {
        if (sid !== 'skchr_demetr_3' || !op(unit) || !unit.skill?.active) return;
        if (victim !== unit.mem.demetrTarget || !eliteness(victim)) return;
        reselect(battle, unit, victim);
      }, { owner: unit });

      // 清算: 受到致命伤害时不撤退但会结束技能 (onEnd returns him home)
      battle.on('fatal', (ctx) => {
        if (ctx.unit !== unit || ctx.prevented || sid !== 'skchr_demetr_3' || !unit.skill?.active) return;
        ctx.prevented = true;
        unit.hp = Math.max(unit.hp, 1);
        unit.skill.end('forced');
      }, { owner: unit, priority: 10 });
    } }],
  };
}

export default demetr;
