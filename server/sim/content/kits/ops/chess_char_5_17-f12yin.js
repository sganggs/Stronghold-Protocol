// server/sim/content/kits/ops/chess_char_5_17-f12yin.js — 山 (char_264_f12yin) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import {
  HALF_HP, num, talent, traitBb, skillGrid, batPct, mods, selectedId, lazySkills, instantKind, skillRange, whileOn,
  permBuff,
} from '../shared/tier5.js';

export default {
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
        // 横扫架势: the `skill` spec, also keyed so it still runs when S3 is the chess default (规程).
        skchr_f12yin_2: () => ({
          kind: 'toggle',
          allyTargets: false,
          mods: mods({ atkPct: num(bb.atk), defPct: num(bb.def), blockCnt: num(bb.block_cnt), hpRegenRatio: num(bb.hp_recovery_per_sec_by_max_hp_ratio) }),
          targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
          attack: { hitAllBlocked: true },
        }),
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
        // [ASSUMED] its attacks reach the enemies he blocks; the unblockable 铁钳号 of 白铁 never: it does not open it (skills.js
        // allyTargetsOk)
        allyTargets: false,
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
};
