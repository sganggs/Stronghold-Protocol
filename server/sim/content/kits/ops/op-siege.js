// server/sim/content/kits/ops/op-siege.js — 推进之王 (char_112_siege) 自选 operator kit: 6★ 尖兵 (先锋), an owned-6★ pick
// of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_112_siege, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json) and PRTS 推进之王
// (talent 修正 "在场时"; 粉碎 备注 "本天赋无视自身的阻回，可响应飞行单位的死亡"; S2 备注 "技能固定动画不受攻击速度影响";
// S3 "攻击间隔增大(+1.0)").
// - Trait (尖兵) "能够阻挡两个敌人": the profession default (block 2). Module SOL-X “糖果盒” overrides it with
//   "阻挡敌人时攻击力和防御力各+8％" (trait bb atk / def): +atk / +def while she blocks at least one enemy.
// - T1 万兽之王 "在场时，所有【先锋】职业干员的攻击力和防御力各+8%" (full potential: +10%): an aura on every 【先锋】 operator of
//   the field (her included) while she is deployed (installAura: the kits' convention for field-wide talents — teammates' pioneers
//   in a shared field too; several sources keep the strongest). SOL-X stage 2+ adds "自身攻击力和防御力额外+N%" (the module talent
//   change's bb, +8 % at stage 3): a self buff on top; the aura value stays the base talent's (talentsBase).
// - T2 粉碎 "周围四格内有敌人倒下时获得1点技力" (talent range x-5: her tile and the four next to it): +sp SP when an enemy
//   dies there — flying enemies too, and under her own 阻回 (PRTS 备注) — never while a timed skill runs (AK: no SP during
//   a skill). SOL-Y stage 2+ raises it to sp (3 at stage 3) "场上随机另一名【先锋】职业干员获得1点技力": the hidden module
//   talent's sp to one other 【先锋】 operator of the field, drawn uniformly [ASSUMED: any deployed other pioneer, a draw that
//   cannot take SP wastes it].
// - Module SOL-Y “初诺” "首次部署时部署费用-4" (hidden runtime_cost −4): the first deployment of a battle costs nothing in
//   this mode ⇒ no effect (as 德克萨斯's 战术快递 elite note); its HP / ATK are in the stats.
// - S1 冲锋号令·γ型 (AUTO, no target): +cost DP at once; an AUTO skill acting on nobody fires as soon as its SP is full
//   (`trigger: 'SP_FULL'`, as 德克萨斯's kit casts the same skill — the owner's AUTO rule, kits/README.md checklist 5).
// - S2 跃空锤 (AUTO, 可充能 2 / 3 次): the next attack hits every enemy around her — the skill range x-5 — for atk_scale × ATK
//   physical and gives cost DP; the data's DEFAULT trigger (an AUTO "next attack" waits for her attack). The AoE is the
//   attack itself, so it reaches the ground enemies a melee attack can [ASSUMED: no source says it reaches air]. The fixed
//   skill animation (PRTS 备注) does not change the sim's attack timing.
// - S3 碎颅击 (MANUAL, 18 / 21 s): attack interval +base_attack_time s (a flat +1.0 on her 1.05 s), each attack at
//   attack@atk_scale × ATK with attack@buff_prob to stun the target attack@stun s.

import { num, talentBb, talentGrid, moduleBb, traitBb, moduleOn, skillRec, statBuff, toggleBuff, installAura, batMod,
  up, skillBusy, giveSp } from '../shared/tier1.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';

const S1 = 'skcom_charge_cost[3]';
const S2 = 'skchr_siege_2';
const S3 = 'skchr_siege_3';
/** The four tiles around her and her own (talent / skill range x-5) when the data carries no grid. */
const X5 = Object.freeze([[1, 0], [0, -1], [0, 0], [0, 1], [-1, 0]]);

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** A 【先锋】 operator (summons are never 【先锋】 operators). */
const isPioneer = (a) => !!a && a.kind === 'op' && a.def?.profession === 'PIONEER';

/** The module the record fights with (its active one), or null. */
function activeModule(chess) {
  if (!moduleOn(chess)) return null;
  return (chess.modules ?? []).find((m) => m && m.uniEquipId === chess.module.id) ?? null;
}

export default {
  char_112_siege: (bb, chess) => {
    const base0 = talentBb({ talents: chess?.talentsBase ?? chess?.talents }, 0);   // 万兽之王 without the module change
    const mod = activeModule(chess);
    const self0 = mod?.talentChanges?.find((t) => t && t.talentIndex === 0)?.bb ?? {};   // SOL-X stage 2+: 自身额外
    const t1 = talentBb(chess, 1);
    const grid1 = talentGrid(chess, 1) ?? X5;
    const hidden = moduleBb(chess);   // SOL-Y: runtime_cost (no effect), sp to another pioneer (stage 2+)
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2);
    return {
      skills: {
        [S1]: {
          kind: 'instant', trigger: 'SP_FULL',
          onStart({ battle, unit }) {
            const n = num(b1.cost);
            battle.addDp(unit.ownerId, n, unit);
            battle.fx('dp', { x: unit.x, y: unit.y, n, id: unit.id });
          },
        },
        [S2]: {
          kind: num(s2?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          targeting: { rangeGrid: s2?.rangeGrid ?? X5, allInRange: true },
          attack: { atkScale: num(b2.atk_scale, 1) },
          onStart({ battle, unit }) {
            const n = num(b2.cost);
            battle.addDp(unit.ownerId, n, unit);
            battle.fx('dp', { x: unit.x, y: unit.y, n, id: unit.id });
            battle.fx('aoe', { x: unit.x, y: unit.y, radius: 1, id: unit.id, skill: 'siege:hammer' });
          },
        },
        [S3]: {
          kind: 'duration',
          mods: { batPct: batMod(b3.base_attack_time, chess) },
          attack: {
            atkScale: num(b3['attack@atk_scale'], 1),
            onHit({ battle, unit, target }) {
              if (target && target.alive && target.side === 'enemy' && battle.rng.chance(num(b3['attack@buff_prob']))) {
                battle.applyStatus(target, 'stun', { duration: num(b3['attack@stun']), source: unit });
              }
            },
          },
        },
      },
      talents: [
        { install(battle, unit) { // 万兽之王: the field's 【先锋】 ATK / DEF +atk / +def; SOL-X stage 2+: her own extra
          const a = num(base0.atk), d = num(base0.def);
          if (a || d) installAura(battle, unit, { key: 'talent:siege:pioneers', value: a, select: isPioneer, mods: { atkPct: a, defPct: d } });
          statBuff(battle, unit, 'talent:siege:self', { atkPct: num(self0.atk), defPct: num(self0.def) });
        } },
        { install(battle, unit) { // 粉碎: an enemy falls on her x-5 ⇒ +sp SP (阻回 ignored); SOL-Y: +1 SP to another pioneer
          const sp = num(t1.sp), other = num(hidden.sp);
          if (!(sp > 0)) return;
          battle.on('death', (ctx) => {
            const e = ctx.unit;
            if (e.side !== 'enemy' || ctx.reason !== 'killed' || !up(unit) || !unit.skill) return;
            if (!bodyInRange(e, new Set(absoluteRangeKeys(grid1, unit.tileR, unit.tileC, unit.dir, 0)))) return;
            // "无视自身的阻回": the 'init' reason passes 阻回; a running timed skill still takes no SP
            if (!skillBusy(unit)) unit.skill.gainSp(sp, 'init');
            if (other > 0) {
              const mates = battle.alliesFor(unit).filter((a) => a !== unit && isPioneer(a));
              if (mates.length) giveSp(battle.rng.pick(mates), other);
            }
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // SOL-X “糖果盒”: 阻挡敌人时攻击力和防御力各+8％
        const ma = num(tb.atk), md = num(tb.def);
        if (ma || md) toggleBuff(battle, unit, 'trait:siege:block', () => unit.blocking.length > 0, { atkPct: ma, defPct: md });
      },
    };
  },
};
