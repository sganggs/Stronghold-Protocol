// server/sim/content/kits/ops/chess_char_2_13-tippi.js — 蒂比 (char_4191_tippi) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { num, talentBb, up, onHitOn } from '../shared/tier1.js';
import { onDefaultSkill } from '../shared/tier2.js';
import { cancelDamage, damageDodgeMode } from '../../../attack/helpers.js';

/**
 * 起飞 of 蒂比's skills (gamedata_const ba.liftoff "不阻挡地面敌人且不会被地面敌人攻击，可以阻挡飞行敌人"): the skill's flags
 * `liftoff` (no ground enemy blocked — Battle._blockerFor; 对地规避 — targeting.js evadesGround: no ground enemy selects
 * her, while what selects nobody still lands — 无视无法选择 abilities, direct picks, flying units' blasts, 无来源 damage, the
 * ticks of a debuff already on her) and `blockFly` (blocks flyers at the air radius). She stays a ground unit on her tile (PRTS 行动方式 "起飞的
 * 干员仍然是地面单位": `unit.ground` unchanged — 隐德来希's 血镰 still counts her; 地面干员 bonds / items read her position).
 */
const LIFTOFF_FLAGS = Object.freeze({ blockFly: true, liftoff: true });
/** 蒂比 take-off: the ground enemies she blocked walk on. */
function tippiTakeOff({ battle, unit }) {
  battle.releaseBlocked(unit);
  battle.fx('takeoff', { x: unit.x, y: unit.y, id: unit.id });
}
/** 蒂比 landing when the airborne skill ends: the flyers she held are released. */
function tippiLand({ battle, unit }) {
  battle.releaseBlocked(unit);
}

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_13 蒂比 紧急赶场通知 (AUTO): "受到攻击后触发" is officially "受到伤害前触发" (PRTS 修正 原因 6; 备注 "在受到伤害前自动
  // 触发技能…若本次伤害为物理或法术，再将本次伤害闪避") — any incoming damage instance (an attack, a zone tick, the 源石溶剂
  // drain; never a 流失, which has no `hit`) sets it off (the kit is the only trigger: the engine rule is disabled) and a
  // physical/arts one is dodged; takes off for the duration: skill range, ATK +atk, attacks become 3 shots, blocks flying
  // (not ground) enemies. Trait "起飞后能够阻挡2个飞行敌人": flying enemies are blocked only while airborne. 片场工作指南
  // ("若最近N秒内未受伤害" — 修正 原文 攻击): if no damage for stack_time s, the next physical/arts damage is dodged (prob);
  // every damage instance restarts that timer (dodged or not; a 流失 does not — PRTS 备注).
  // S1 专业喷绘技巧 (alt, DEFAULT trigger from data): takes off at once for its duration — skill range, ATK +atk, blocks
  // flyers only; no triple shot, and incoming attacks never set it off.
  // Both take off as 起飞 (LIFTOFF_FLAGS): she blocks no ground enemy and none selects her (对地规避), so a ground enemy's
  // selected damage refused on the way never reaches her `hit` and neither sets off S2 nor restarts 片场工作指南.
  chess_char_2_13_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const s2 = onDefaultSkill(chess);
    return {
      trait: { blockFly: false },
      skill: {
        kind: 'duration', trigger: { rule: 'CUSTOM_RANGE', grid: [] }, // never by the engine: the hit handler below
        mods: { atkPct: num(bb.atk) }, flags: LIFTOFF_FLAGS,
        targeting: { rangeGrid: def?.skill?.rangeGrid ?? null },
        attack: { hits: 3 },
        onStart: tippiTakeOff,
        onEnd: tippiLand,
      },
      skills: {
        skchr_tippi_1: {
          kind: 'duration', mods: { atkPct: num(bb.atk) }, flags: LIFTOFF_FLAGS,
          targeting: { rangeGrid: def?.skill?.rangeGrid ?? null },
          onStart: tippiTakeOff,
          onEnd: tippiLand,
        },
      },
      talents: [{ install(battle, unit) {
        battle.removeBuff(unit, 'trait:skywalker'); // the profession grants blockFly permanently; here only airborne
        const st = num(t.stack_time), p = num(t.prob, 1);
        let last = -Infinity;
        battle.on('deploy', ({ unit: u }) => { if (u === unit) last = battle.time - st; }, { owner: unit });
        onHitOn(battle, unit, (ctx) => {
          const { dmg } = ctx;
          if (!dmg || dmg.cancel || !up(unit)) return;
          const dodgeable = (dmg.type === 'phys' || dmg.type === 'arts') && damageDodgeMode(dmg) !== 'ignore';
          const sk = unit.skill;
          let dodged = false;
          if (s2 && sk && sk.ready && !sk.active && unit.canAct && !unit.s.flags.silence && sk.activate('TAKE_DAMAGE')) dodged = dodgeable;
          else if (dodgeable && st > 0 && battle.time - last + 1e-9 >= st && battle.rng.chance(p)) dodged = true;
          last = battle.time;
					if (dodged) {
						const cancelled = cancelDamage(dmg, 'dodge');
						battle.fx('dodge', { x: unit.x, y: unit.y, id: unit.id });
						if (battle._hooks.dodge) battle.emit('dodge', { source: ctx.source, credit: ctx.credit, target: unit, dmg, cancelled });
					}
        }, 5);
      } }],
    };
  },
};
