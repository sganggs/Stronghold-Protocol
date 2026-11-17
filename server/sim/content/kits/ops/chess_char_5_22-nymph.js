// server/sim/content/kits/ops/chess_char_5_22-nymph.js — 妮芙 (char_4146_nymph) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { hasHp } from '../../../attack.js';
import {
  num, on, inRange, talent, traitBb, maxCharges, mods, selectedId, lazySkills, skillRange, burstSpUp, elementHit,
  burstDamageUp,
} from '../shared/tier5.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 妮芙 — S2 怵然震爆 (1/2 charges): next attack 270/300 % ATK arts + 4/5 s fear on the target and an equal arts splash
  // (projectile_range), every hit adding 18/22 % of its damage as apoptosis; targets in an apoptosis burst raise T1 to 70/85 %.
  // T1 失魂: hitting an enemy in an apoptosis burst → 40 % ATK elemental damage per second until the burst ends.
  // T2 窥心钥: an apoptosis burst in range → ATK +2 % (×10). Module (elite): ×damage_scale vs enemies in a burst.
  // S1 笞心击 (duration): ATK +; attacks add attack@ep_damage_ratio of their damage as 凋亡损伤 and, on a target in an
  // apoptosis burst, attack@extra_ep_damage_scale × ATK elemental damage. S3 心防溃决 (duration): skill range, ATK +,
  // ASPD +, 2 targets; attacks on a target in an apoptosis burst deal elemental damage (split_atk_scale × ATK, no arts).
  // Module PRI-Y (elite): SP +0.2/s while an enemy in range is in an element burst.
  chess_char_5_22_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess), tm = talent(chess, -1);
    const sid = selectedId(chess, def);
    const ep = num(bb.ep_damage_ratio, num(bb['attack@ep_damage_ratio'])), skillSoul = num(bb.element_atk_scale), soulBase = num(t0.element_atk_scale);
    const soul = (battle, unit, e, scale) => {
      const burst = e.findBuff('apoptosisBurst');
      if (!burst || !(scale > 0)) return;
      const key = `nymph:soul:${unit.id}`;
      const cur = e.findBuff(key);
      if (cur) { cur.data.scale = Math.max(num(cur.data.scale), scale); return; }
      battle.addBuff(e, {
        key, duration: Math.max(0.1, burst.timeLeft), interval: 1, data: { scale },
        onTick: ({ unit: x, buff }) => {
          if (!x.findBuff('apoptosisBurst')) { battle.removeBuff(x, buff); return; }
          elementHit(battle, unit, x, unit.s.atk * num(buff.data.scale), 'nymphSoul', 'apoptosis');
        },
      });
      battle.fx('soul', { x: e.x, y: e.y, id: e.id });
    };
    return {
      skills: lazySkills({
        skchr_nymph_1: () => ({ kind: 'duration', mods: mods({ atkPct: num(bb.atk) }) }),
        skchr_nymph_3: () => ({
          kind: 'duration', mods: mods({ atkPct: num(bb.atk), aspd: num(bb.attack_speed) }),
          targeting: skillRange(chess, def, { maxTargets: Math.max(1, num(bb['attack@max_target'], 2)) }),
          attack: { atkScale: num(bb['attack@split_atk_scale'], 1) },
        }),
      }),
      skill: {
        kind: maxCharges(chess, def) > 1 ? 'charges' : 'instant',
        attack: {
          atkScale: num(bb.atk_scale, 1), splashRadius: num(bb.projectile_range, 1.5),
          onHit({ battle, unit, target, x, y }) {
            if (target && target.alive) battle.applyStatus(target, 'fear', { duration: num(bb.fear), source: unit });
            battle.fx('aoe', { x, y, id: unit.id, r: num(bb.projectile_range, 1.5), skill: 'nymph' });
          },
        },
      },
      talents: [
        { install(battle, unit) { // 失魂 (+ the skill's apoptosis rider and 70 % upgrade)
          battle.on('damaged', (c) => {
            if (c.source !== unit || c.type === 'element' || c.target.side !== 'enemy' || !c.target.alive || !c.dmg) return;
            // (S1 has no attack override: its attacks are the skill's while it runs)
            const skillAtk = c.dmg.isSkill || (sid === 'skchr_nymph_1' && !!unit.skill?.active);
            // (not on a killing blow: the target is at 0 HP here — no burst on the corpse)
            if (skillAtk && c.dmg.isAttack && ep > 0 && c.amount > 0 && hasHp(c.target)) {
              battle.dealDamage(unit, c.target, { type: 'element', element: 'apoptosis', amount: c.amount * ep, tags: ['skill', 'nymph'] });
            }
            if (c.dmg.isAttack && c.target.alive) soul(battle, unit, c.target, c.dmg.isSkill ? Math.max(skillSoul, soulBase) : soulBase);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 窥心钥
          battle.on('elementBurst', (c) => {
            if (c.element !== 'apoptosis' || c.target.side !== 'enemy' || !on(unit) || !inRange(unit, c.target)) return;
            battle.addBuff(unit, { key: 'nymph:key', refresh: 'stack', maxStacks: Math.max(1, num(t1.max_stack_cnt, 10)), mods: { atkPct: num(t1.atk) } });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        burstDamageUp(battle, unit, num(tb.damage_scale));
        burstSpUp(battle, unit, 'nymph:module', num(tm.sp_recovery_per_sec));
        if (sid === 'skchr_nymph_1') { // S1: extra elemental damage on burst targets (the 凋亡 rider is T1's `ep`)
          const extra = num(bb['attack@extra_ep_damage_scale']);
          battle.on('damaged', (c) => {
            if (c.source !== unit || !unit.skill?.active || !c.dmg?.isAttack || c.type === 'element' || c.type === 'elemental') return;
            const e = c.target;
            if (e.side !== 'enemy' || !e.alive || !e.findBuff('apoptosisBurst') || !(extra > 0)) return;
            elementHit(battle, unit, e, unit.s.atk * extra, 'nymphLash', 'apoptosis');
          }, { owner: unit });
        }
        if (sid === 'skchr_nymph_3') { // S3: attacks on a burst target become elemental damage
          battle.on('hit', (c) => {
            if (c.source !== unit || !unit.skill?.active || !c.dmg.isAttack || !c.target || !c.target.findBuff('apoptosisBurst')) return;
            if (c.dmg.type !== 'arts' && c.dmg.type !== 'phys') return;
            c.dmg.type = 'elemental';
            c.dmg.element = 'apoptosis';
            c.dmg.canDodge = false;
            (c.dmg.tags ||= []).push('nymphBreak');
          }, { owner: unit, priority: -10 });
        }
      },
    };
  },
};
