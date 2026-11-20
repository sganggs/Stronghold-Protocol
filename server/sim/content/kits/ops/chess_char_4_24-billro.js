// server/sim/content/kits/ops/chess_char_4_24-billro.js — 卡涅利安 (char_426_billro) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import {
  num, tbb, moduleBb, grid, batFlat, enemiesOnRange, whileDeployed, toggleBuff, skillActive, isSel, alt, withDefaults,
} from '../shared/tier4.js';

/** 卡涅利安 S3 食噬之印: the ATK bonus climbs in 1 s steps over 20 s (PRTS 备注; the blackboard has no ramp time). */
const BILLRO_S3_RAMP = 20;
/** 卡涅利安 S3 charged mark: one buff per enemy, shared by every 卡涅利安 (PRTS 备注), ≤ 5 stacks (skill text). */
const BILLRO_MARK = 'billro:mark';
const BILLRO_MARK_MAX = 5;

export default withDefaults({
  // ===== 卡涅利安 (phalanx) S2 沙缚镣锁 — faster attacks on every enemy in range (the trait's 群体法术伤害), 0.3 s
  //       sluggish on each; charged: ATK +10 % and bind; talents
  //       S1 沙暴守卫 (SEARCH: ATK/DEF up; charged — cast with every charge stored — "特性效果在技能期间继续生效", PRTS 备注
  //       "应用蓄力时：应用技能未开启时的特性": the skill-off trait stays in force, the DEF/RES guard AND 不攻击 — she makes
  //       no attack until the skill ends, a pure guard);
  //       S3 食噬之印 (wider range — data rule ACTIVE_RANGE on its x-2, the owner's rule of 2026-10-05 over the 阵法术师
  //       SEARCH row —, ATK +0 % → +140 %/+200 % in 1 s steps over 20 s — PRTS 备注; charged: each attack adds a
  //       stack of the mark BEFORE its damage — PRTS 备注 "于攻击造成伤害前生效，多层效果之间加算叠加" — +20 % damage from
  //       her per stack, ≤ 5, so ×1.2 on the first hit and ×2.0 from the 5th, until the skill ends; one mark per enemy:
  //       another 卡涅利安 only adds stacks to it, the bonus is the setter's — PRTS 备注 popup). Talent 生命之餐 heals on
  //       every skill; module PLX-X keeps part of the guard during any skill, PLX-Y (乡音): +3 % damage per enemy in range
  //       (≤ 5)
  chess_char_4_24_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1), mb = moduleBb(def);
    const tb = def.traitBb || {};
    const keepDef = num(tb['billro_e_002[buff].def'], 0), keepRes = num(tb['billro_e_002[buff].magic_resistance'], 0);
    const S1 = isSel(def, 'skchr_billro_1'), S2 = isSel(def, 'skchr_billro_2'), S3 = isSel(def, 'skchr_billro_3');
    const g = grid(def.skill?.rangeGrid);
    const isCharged = (skill) => skill.maxCharges > 1 && skill.charges + 1 >= skill.maxCharges; // cast with every charge stored
    return {
      // charged S1: the skill-off trait's 不攻击 stays in force while the skill lasts (PRTS S1 备注) — no attack at all
      trait: S1 ? { canAttack: (battle, u) => !(skillActive(u) && u.mem.billroCharged) } : null,
      skills: alt(def, {
        skchr_billro_1: () => ({
          kind: 'duration',
          // [ASSUMED] a charged cast makes no attack at all: 白铁's 铁钳号 alone does not open it (skills.js allyTargetsOk)
          allyTargets: false,
          mods: { atkPct: num(bb.atk), defPct: num(bb.def) },
          onStart({ battle, unit, skill }) {
            unit.mem.billroCharged = isCharged(skill);
            // 蓄力额外效果：特性效果在技能期间继续生效 (the profession removes its own guard buff when a skill starts; the
            // kit trait's canAttack keeps the trait's 不攻击)
            if (unit.mem.billroCharged) battle.addBuff(unit, { key: 'billro:s1guard', mods: { defPct: num(unit.profile?.guardDef, 2), resFlat: num(unit.profile?.guardRes, 20) } });
            // (`charged`: display only — the client's 蓄力 sand armour, render/vfx/skillfx.js)
            battle.fx('shell', { x: unit.x, y: unit.y, id: unit.id, charged: unit.mem.billroCharged || undefined });
          },
          onEnd({ battle, unit }) { unit.mem.billroCharged = false; battle.removeBuff(unit, 'billro:s1guard'); },
        }),
        // 沙缚镣锁: the `skill` spec, also keyed so it still runs when S3 is the chess default (规程).
        skchr_billro_2: () => ({
          kind: 'duration',
          mods: { batPct: batFlat(def, bb.base_attack_time) },
          onStart({ battle, unit, skill }) {
            const charged = isCharged(skill);
            unit.mem.billroCharged = charged;
            if (charged) battle.addBuff(unit, { key: 'billro:charged', mods: { atkPct: num(bb.atk, 0.1) } });
            battle.fx(charged ? 'sandChainsCharged' : 'sandChains', { x: unit.x, y: unit.y, id: unit.id, charged: charged || undefined });
          },
          onEnd({ battle, unit }) { unit.mem.billroCharged = false; battle.removeBuff(unit, 'billro:charged'); },
        }),
        skchr_billro_3: () => ({
          kind: 'duration',
          targeting: g ? { rangeGrid: g } : undefined,
          onStart({ battle, unit, skill }) {
            unit.mem.billroCharged = isCharged(skill);
            unit.mem.billroRamp = 0;
            unit.mem.billroMarked = new Set();
            battle.addBuff(unit, { key: 'billro:s3atk', mods: { atkPct: 0 } });
            battle.fx('devour', { x: unit.x, y: unit.y, id: unit.id, charged: unit.mem.billroCharged || undefined });
          },
          onTick({ unit, dt }) { // 攻击力逐渐增至+N%: PRTS 备注 "从+0%开始在20秒内线性增加，攻击力每1秒更新1次"
            unit.mem.billroRamp = (unit.mem.billroRamp ?? 0) + dt;
            const steps = Math.min(BILLRO_S3_RAMP, Math.floor(unit.mem.billroRamp + 1e-9));
            const b = unit.findBuff('billro:s3atk');
            if (b && b.mods.atkPct !== num(bb.atk) * steps / BILLRO_S3_RAMP) { b.mods = { atkPct: num(bb.atk) * steps / BILLRO_S3_RAMP }; unit.markDirty(); }
          },
          onEnd({ battle, unit }) {
            battle.removeBuff(unit, 'billro:s3atk');
            // "持续至技能结束": the marks she set end with her skill (stacks another 卡涅利安 added to them included)
            for (const id of unit.mem.billroMarked || []) {
              const e = battle.unitById(id);
              if (e && e.findBuff(BILLRO_MARK)?.source === unit) battle.removeBuff(e, BILLRO_MARK);
            }
            unit.mem.billroMarked = null;
            unit.mem.billroCharged = false;
          },
        }),
      }),
      skill: {
        kind: 'duration',
        mods: { batPct: batFlat(def, bb.base_attack_time) },
        onStart({ battle, unit, skill }) {
          const charged = isCharged(skill);
          unit.mem.billroCharged = charged;
          if (charged) battle.addBuff(unit, { key: 'billro:charged', mods: { atkPct: num(bb.atk, 0.1) } });
          battle.fx(charged ? 'sandChainsCharged' : 'sandChains', { x: unit.x, y: unit.y, id: unit.id, charged: charged || undefined });
        },
        onEnd({ battle, unit }) { unit.mem.billroCharged = false; battle.removeBuff(unit, 'billro:charged'); },
      },
      talents: [
        { install(battle, unit) { // 生命之餐: every skill start heals 40 % max HP (×2 when charged)
          battle.on('skillStart', (c) => {
            if (c.unit !== unit) return;
            const charged = isCharged(c.skill);
            battle.heal(unit, unit, unit.s.maxHp * (charged ? num(t0['billro_t_1[enhance].heal_scale'], 0.8) : num(t0.heal_scale, 0.4)), { self: true });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 蓄势待发: +0.6 SP/s once a charge is stored
          whileDeployed(battle, unit, 0.1, () => toggleBuff(battle, unit, 'billro:t2', !!unit.skill && unit.skill.charges >= 1 && !skillActive(unit), { spRecoveryFlat: num(t1.sp_recovery_per_sec, 0.6) }));
        } },
      ],
      install(battle, unit) {
        // module PLX-X (elite default): 技能开启时保留部分效果 (any skill; a charged S1 keeps the whole guard instead)
        if (keepDef || keepRes) {
          battle.on('skillStart', (c) => {
            if (c.unit !== unit || (S1 && unit.mem.billroCharged)) return;
            battle.addBuff(unit, { key: 'billro:keep', mods: { defPct: keepDef, resFlat: keepRes } });
          }, { owner: unit });
          battle.on('skillEnd', (c) => { if (c.unit === unit) battle.removeBuff(unit, 'billro:keep'); }, { owner: unit });
        }
        // module PLX-Y: 范围内敌人越多造成的伤害越高（每个 +3 %，最多 5 个）
        const per = num(mb.damage_scale, 0), cap = num(mb.max_valid_stack_cnt, 5);
        if (per > 0) {
          battle.on('hit', (c) => {
            if (c.source !== unit || c.target.side !== 'enemy') return;
            const n = Math.min(cap, enemiesOnRange(battle, unit).length);
            if (n > 0) c.dmg.mul *= 1 + per * n;
          }, { owner: unit });
        }
        if (S3) {
          // charged S3 食噬之印: each attack adds a stack BEFORE its damage (PRTS 备注 "于攻击造成伤害前生效"); stacks add up,
          // +20 % damage taken from the mark's setter per stack. One mark per enemy (PRTS 备注 popup: "存在则为已有的BUFF叠加
          // 一次加成，不存在则给与敌人仅对此卡涅利安的伤害生效的一个食噬之印BUFF"): another 卡涅利安 stacks it without the bonus
          const per = num(bb['attack@damage_scale'], 0.2);
          battle.on('hit', (c) => {
            const e = c.target;
            if (c.source !== unit || e.side !== 'enemy') return;
            let m = e.findBuff?.(BILLRO_MARK) || null;
            if (c.dmg.isAttack && skillActive(unit) && unit.mem.billroCharged) {
              if (m) battle.addBuff(e, { key: BILLRO_MARK, refresh: 'stack', maxStacks: BILLRO_MARK_MAX, duration: m.timeLeft });
              else {
                m = battle.addBuff(e, { key: BILLRO_MARK, refresh: 'stack', maxStacks: BILLRO_MARK_MAX, duration: Math.max(0.1, (unit.skill?.timeLeft ?? 0) + 0.1), source: unit, visible: true });
                if (m) unit.mem.billroMarked?.add(e.id);
              }
            }
            if (m && m.source === unit) c.dmg.mul *= 1 + per * (m.stacks || 1);
          }, { owner: unit });
        }
        if (!S2) return;
        // "每次攻击对目标造成0.3秒停顿" (charged: 束缚): every enemy her attack damages — each one on her range
        battle.on('damaged', (c) => {
          const e = c.target;
          if (c.source !== unit || !c.dmg || !c.dmg.isAttack || e.side !== 'enemy' || !e.alive || !skillActive(unit)) return;
          if (unit.mem.billroCharged) battle.applyStatus(e, 'bind', { duration: num(bb['attack@root'], 0.3), source: unit });
          else battle.applyStatus(e, 'sluggish', { duration: num(bb['attack@sluggish'], 0.3), source: unit });
        }, { owner: unit });
      },
    };
  },
});
