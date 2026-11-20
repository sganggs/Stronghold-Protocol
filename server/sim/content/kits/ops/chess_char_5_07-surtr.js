// server/sim/content/kits/ops/chess_char_5_07-surtr.js — 史尔特尔 (char_350_surtr) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { num, talent, traitBb, mods, selectedId, lazySkills, instantKind, whileOn, permBuff } from '../shared/tier5.js';

export default {
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
          while (unit.mem.twilightAcc >= iv && unit.alive) { // loop-cap: interval floored before the loop
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
          // "干员退场后…原地留下一个“倒地干员”…自动部署至该位置"; Battle.isDown, GitHub #60). With her death animation
          // (`dying`): PRTS Touch(卫戍协议) 超脱 备注 counts it as a knock-out ("如史尔特尔的天赋效果").
          const wait = num(t1['surtr_t_2[withdraw].interval'], 8);
          // 规程 module 余烬: 期间攻击速度+N. Absent on 盟约, so the buff stays flags-only there.
          const emberAs = num(t1['surtr_t_2[withdraw].attack_speed']);
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.ember = false; }, { owner: unit });
          battle.on('fatal', (c) => {
            if (c.unit !== unit || c.prevented) return;
            c.prevented = true;
            if (unit.mem.ember) return;
            unit.mem.ember = true;
            const dep = unit.deploySeq;
            battle.addBuff(unit, {
              key: 'surtr:ember', status: 'healFree', flags: { noHeal: true, healFree: true },
              ...(emberAs ? { mods: { aspd: emberAs } } : {}),
            });
            battle.fx('ember', { x: unit.x, y: unit.y, id: unit.id });
            battle.after(wait, () => { if (unit.alive && unit.deploySeq === dep) battle.retreat(unit, { reason: 'retreat', dying: true }); }, { owner: unit });
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
};
