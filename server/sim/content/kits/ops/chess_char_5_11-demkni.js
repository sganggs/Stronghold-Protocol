// server/sim/content/kits/ops/chess_char_5_11-demkni.js — 塞雷娅 (char_202_demkni) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import {
  HALF_HP, NEVER, AURA_IV, AURA_DUR, num, on, talent, traitBb, skillGrid, mods, selectedId, lazySkills, instantKind,
  whileOn, lowHpHealUp, permBuff,
} from '../shared/tier5.js';

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

export default {
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
          trigger: { rule: 'SKILL_RANGE', grid, allies: true, hpAtMost: HALF_HP },
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
        lowHpHealUp(battle, unit, tb);   // GUA-X: set_heal_scale_by_hpratio filters LT (strictly below)
        if (num(tb.damage_resistance) > 0) permBuff(battle, unit, 'saria:moduleY', { dmgTakenMul: 1 - num(tb.damage_resistance) });
      },
    };
  },
};
