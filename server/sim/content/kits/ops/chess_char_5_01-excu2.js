// server/sim/content/kits/ops/chess_char_5_01-excu2.js — 圣约送葬人 (char_1032_excu2) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import {
  num, on, talent, batPct, mods, inFaction, isOp, selectedId, lazySkills, skillRange,
} from '../shared/tier5.js';

const isLaterano = (u) => inFaction(u, 'lateranoShip', ['laterano']);

/** Enemy `e` attacks `t` in melee (not a ranged shot), mirroring ai.js enemyAttack. */
function meleeAttacker(e, t) {
  const melee = e.profile?.melee ?? e.def?.applyWay === 'MELEE';
  const r = num(e.base?.rangeRadius, 0);
  return melee || !(r > 0) || (e.blockedBy === t && r < 1);
}

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 圣约送葬人 — S2 近身铳斗 (ammo, attack SP): ATK/DEF +, block +1, melee hits dodged with prob (+ammo refill).
  // T1 受选之人: extra attack chance (+prob_add per ammo spent in the skill). T2 铳弹共感: +ammo per Laterano op.
  // S1 遗嘱执行 (ammo 8, attack SP): skill range, ATK +, ignores def_penetrate_fixed DEF.
  // S3 圣约决裁 (ammo 16): skill range, BAT +0.5 s, ATK +; +attack@atk ATK per bullet spent (≤ attack@max_stack_cnt),
  // reaper self-heal ×trait_ratio; at the end every enemy attacked during the skill takes attack@final_atk_scale × ATK phys.
  // Module REA-Y (elite): ASPD +12 with ≥ 2 enemies in range.
  chess_char_5_01_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tm = talent(chess, -1);
    const sid = selectedId(chess, def);
    const prob = num(bb.prob), refill = num(bb.recover_cnt, 1);
    return {
      skills: lazySkills({
        skchr_excu2_1: () => ({
          kind: 'ammo', ammo: num(bb['attack@trigger_time'], 8),
          mods: mods({ atkPct: num(bb.atk), defIgnoreFlat: num(bb.def_penetrate_fixed) }),
          targeting: skillRange(chess, def),
        }),
        skchr_excu2_3: () => ({
          kind: 'ammo', ammo: num(bb['attack@trigger_time'], 16),
          mods: mods({ atkPct: num(bb.atk), batPct: batPct(bb.base_attack_time, chess) }),
          targeting: skillRange(chess, def),
          attack: { onEachHit({ unit, target }) { if (target && target.side === 'enemy') unit.mem.verdict?.add(target); } },
          onStart({ unit }) {
            unit.mem.verdict = new Set();
            // 特性的回复生命效果提高至2倍 (the reaper profile reads profile.selfHeal on every attack)
            if (unit.profile) { unit.mem.verdictHeal0 ??= num(unit.profile.selfHeal, 50); unit.profile.selfHeal = unit.mem.verdictHeal0 * num(bb.trait_ratio, 1); }
          },
          onEnd({ battle, unit }) {
            const hit = unit.mem.verdict;
            unit.mem.verdict = null;
            if (unit.profile && unit.mem.verdictHeal0 != null) unit.profile.selfHeal = unit.mem.verdictHeal0;
            if (hit && unit.alive) {
              for (const e of hit) {
                if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb['attack@final_atk_scale']), type: 'phys', isSkill: true, tags: ['skill', 'verdict'] });
              }
              battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id, r: 1.5, skill: 'excu2' });
            }
            battle.removeBuff(unit, 'excu2:verdict');
          },
        }),
      }),
      skill: {
        kind: 'ammo', ammo: num(bb['attack@trigger_time'], 12),
        mods: mods({ atkPct: num(bb.atk), defPct: num(bb.def), blockCnt: num(bb.block_cnt) }),
      },
      // REA-Y: its trait part is DISPLAY-only (official battle_equip_table uniequip_003_excu2: target DISPLAY, the ASPD
      // text "{value}" = 12; the ASPD rider itself is the talent −1 part). data/chess.json merges that display blackboard
      // into trait.bb ({value: 12}), which the reaper profile would read as its per-hit heal: the heal stays the base
      // trait's (50).
      trait: tm['trigger_cnt[equip]'] != null && chess?.traitBase?.bb?.value != null ? { selfHeal: num(chess.traitBase.bb.value, 50) } : undefined,
      talents: [
        { install(battle, unit) { // 受选之人
          let spent = 0;
          const reset = (c) => { if (c.unit === unit) spent = 0; };
          battle.on('skillStart', reset, { owner: unit });
          battle.on('skillEnd', reset, { owner: unit });
          battle.on('ammoUsed', (c) => { if (c.unit === unit) spent++; }, { owner: unit });
          // PRTS 备注: "触发时可额外回复1点攻击回复技力，不额外消耗弹药" — the extra attack is an attack (attack SP, trait
          // heal) but consumes no ammo (engine forceAttack `noAmmo`: no bullet, no ammoUsed for any listener — the
          // 7-bullet 特质 counter, items, bonds and the prob_add counter above)
          battle.on('attack', (c) => {
            if (c.attacker !== unit || unit.mem.extraAttack || !on(unit)) return;
            const p = num(t0.prob) + (unit.skill?.active ? num(t0.prob_add) * spent : 0);
            if (!(p > 0) || !battle.rng.chance(Math.min(1, p))) return;
            const dep = unit.deploySeq;
            battle.after(0, () => {
              if (!on(unit) || unit.deploySeq !== dep || !unit.canAct || unit.s.flags.disarm) return;
              unit.mem.extraAttack = true;
              let hit = false;
              try { hit = battle.forceAttack(unit, null, { noAmmo: true }); } finally { unit.mem.extraAttack = false; }
              if (hit) battle.fx('extraAttack', { x: unit.x, y: unit.y, id: unit.id });
            }, { owner: unit });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 铳弹共感
          battle.on('skillStart', (c) => {
            if (c.unit !== unit || c.skill.kind !== 'ammo') return;
            const n = battle.allies().filter((a) => isOp(a) && isLaterano(a)).length;
            const stacks = Math.min(num(t1.add_count_max_stack, 4), n);
            if (stacks > 0) c.skill.addAmmo(stacks * num(t1.add_count, 1));
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // REA-Y "攻击范围内存在2名及以上敌人时攻击速度+12": the ENGINE owns this trait line now
        // (server/sim/content/traitMods.js, applied from battle/players.js _setupUnit for every operator) — a second
        // implementation here would count the same 12 points twice.
        if (sid === 'skchr_excu2_3') { // S3: +attack@atk ATK per bullet spent
          battle.on('ammoUsed', (c) => {
            if (c.unit !== unit || !unit.skill?.active) return;
            battle.addBuff(unit, { key: 'excu2:verdict', refresh: 'stack', maxStacks: Math.max(1, num(bb['attack@max_stack_cnt'], 30)), mods: mods({ atkPct: num(bb['attack@atk']) }) });
          }, { owner: unit });
        }
        if (sid && sid !== 'skchr_excu2_2') return;
        // S2: melee attacks dodged with `prob`, each dodge refills ammo
        battle.on('hit', (c) => {
          if (c.target !== unit || !unit.skill?.active || !c.source || c.source.side !== 'enemy' || !c.dmg.isAttack) return;
          if (!meleeAttacker(c.source, unit) || !(prob > 0) || !battle.rng.chance(prob)) return;
          c.dmg.cancel = true;
          battle.fx('dodge', { x: unit.x, y: unit.y, id: unit.id });
          // a dodge like the engine's (listeners of the `dodge` hook — items/bonds — see it too)
          if (battle.hasHook('dodge')) battle.emit('dodge', { source: c.source, target: unit, dmg: c.dmg });
          unit.skill.addAmmo(refill);
        }, { owner: unit });
      },
    };
  },
};
