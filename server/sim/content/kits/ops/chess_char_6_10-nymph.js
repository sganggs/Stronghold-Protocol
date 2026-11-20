// server/sim/content/kits/ops/chess_char_6_10-nymph.js — 妮芙 (char_4146_nymph) kit, tier 6 (hidden).
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { bodyInRange } from '../../../body.js';
import { num, tbb, live, elementDmg } from '../shared/tier6.js';
import { isVersionData, gameData } from '../../tokens.js';

/** 规程 only. 盟约's tier-6 chess keeps S1 / S3 on the generic spec they already had. */
const regulation = () => isVersionData() && gameData()?.config?.version?.family === 'regulation';

// ------------------------------------------------------------------------------------------------------------------
// 妮芙 chess_char_6_10 (本源术师, hidden tier-6 entry) — S2 怵然震爆; 失魂; 窥心钥; module 心声

function nymph(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const sid = def?.skill?.id ?? null;
  const reg = regulation();
  // 规程 module 003 restates the DoT period; the base talent has no interval key (one second).
  const soulIv = Math.max(0.1, num(t0['nymph_t_1[ep_damage].interval'], 1));
  const soul = (battle, unit, t, scale) => {
    const burst = t.findBuff('apoptosisBurst');
    if (!burst || !(scale > 0)) return;
    const key = `nymph:soul:${unit.id}`;
    const cur = t.findBuff(key);
    if (cur) { cur.data.scale = Math.max(cur.data.scale, scale); cur.timeLeft = Math.max(cur.timeLeft, burst.timeLeft); return; }
    battle.addBuff(t, {
      key, duration: Math.max(0.1, burst.timeLeft), interval: soulIv, source: unit, data: { scale },
      // 元素伤害 = the 'elemental' damage type (no DEF/RES, × elementalTakenMul)
      onTick: ({ unit: e, buff }) => { if (e.findBuff('apoptosisBurst')) battle.dealDamage(unit, e, { amount: unit.s.atk * buff.data.scale, type: 'elemental', element: 'apoptosis', canDodge: false, tags: ['talent', 'elementDmg'] }); },
    });
  };
  const grid = def?.skill?.rangeGrid;
  const skills = reg ? {
    // S1 笞心击 / S3 心防溃决 are selectable on the 规程 chess. The tier-6 kit only authored S2.
    skchr_nymph_1: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
    },
    skchr_nymph_3: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) },
      targeting: {
        ...(grid?.length ? { rangeGrid: grid } : {}),
        maxTargets: Math.max(1, num(bb['attack@max_target'], 2)),
      },
      attack: { atkScale: num(bb['attack@split_atk_scale'], 1) },
    },
  } : null;
  return {
    ...(skills ? { skills } : {}),
    skill: {
      kind: 'charges',
      attack: {
        atkScale: num(bb.atk_scale, 1),
        splashRadius: num(bb.projectile_range, 1.5),
        splashScale: 1,
        onHit({ battle, unit, target }) {
          if (target && target.alive && num(bb.fear) > 0) battle.applyStatus(target, 'fear', { duration: num(bb.fear), source: unit });
          battle.fx('shockBlast', { x: target ? target.x : unit.x, y: target ? target.y : unit.y, id: unit.id });
        },
      },
    },
    talents: [
      { install(battle, unit) { // skill apoptosis (per damaged target) + 失魂
        battle.on('damaged', (ctx) => {
          const t = ctx.target;
          if (ctx.source !== unit || !t || t.side !== 'enemy' || ctx.type === 'element' || !ctx.dmg?.isAttack) return;
          const skillHit = !!ctx.dmg.isSkill;
          if (t.alive) soul(battle, unit, t, skillHit ? num(bb.element_atk_scale, num(t0.element_atk_scale)) : num(t0.element_atk_scale));
          if (skillHit && t.alive) elementDmg(battle, unit, t, 'apoptosis', ctx.amount * num(bb.ep_damage_ratio));
          // 规程 S1: 附带法术伤害的凋亡损伤, and extra elemental damage on a target already in a burst.
          if (reg && skillHit && t.alive) {
            elementDmg(battle, unit, t, 'apoptosis', ctx.amount * num(bb['attack@ep_damage_ratio']));
            if (t.findBuff('apoptosisBurst')) elementDmg(battle, unit, t, 'apoptosis', unit.s.atk * num(bb['attack@extra_ep_damage_scale']));
          }
        }, { owner: unit });
        // 规程 S3: an attack on a target in an apoptosis burst deals elemental damage.
        if (reg && sid === 'skchr_nymph_3') battle.on('hit', (c) => {
          if (c.source !== unit || !unit.skill?.active || !c.dmg?.isAttack || !c.target?.findBuff('apoptosisBurst')) return;
          if (c.dmg.type !== 'arts' && c.dmg.type !== 'phys') return;
          c.dmg.type = 'elemental';
          c.dmg.element = 'apoptosis';
          c.dmg.canDodge = false;
        }, { owner: unit, priority: -10 });
      } },
      { install(battle, unit) { // 窥心钥 (elite module: field-wide, +ASPD at max stacks)
        const atk = num(t1.atk), max = Math.max(1, Math.floor(num(t1.max_stack_cnt, 10)));
        const fieldWide = t1.stack_cnt_check != null, as = num(t1.attack_speed);
        battle.on('deploy', ({ unit: u }) => { if (u === unit) unit.mem.nymphKey = 0; }, { owner: unit });
        battle.on('elementBurst', ({ target, element }) => {
          if (element !== 'apoptosis' || !live(unit) || !target || target.side !== 'enemy') return;
          if (!fieldWide && !bodyInRange(target, unit.rangeKeySet)) return;
          unit.mem.nymphKey = Math.min(max, (unit.mem.nymphKey || 0) + 1);
          const n = unit.mem.nymphKey;
          battle.addBuff(unit, { key: 'nymph:key', mods: { atkPct: atk * n, aspd: fieldWide && n >= max ? as : 0 } });
        }, { owner: unit });
      } },
      { install(battle, unit) { // elite module: ×1.1 vs targets in an element burst
        const ds = num(tb.damage_scale, 1);
        if (ds > 1) battle.on('hit', (ctx) => { if (ctx.source === unit && ctx.target.s.flags.burstLock) ctx.dmg.mul *= ds; }, { owner: unit });
      } },
    ],
  };
}

export default {
  chess_char_6_10_a: nymph,
};
