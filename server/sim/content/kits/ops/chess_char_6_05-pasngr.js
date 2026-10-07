// server/sim/content/kits/ops/chess_char_6_05-pasngr.js — 异客 (char_472_pasngr) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { absoluteRangeKeys, canTargetEnemy } from '../../../targeting.js';
import { CHAIN_RADIUS } from '../../../constants.js';
import { bodyDist, bodyInKeys } from '../../../body.js';
import { num, bv, tbb, live, ANY, enemiesIn, batOf, N4, aura } from '../shared/tier6.js';

// ------------------------------------------------------------------------------------------------------------------
// 异客 chess_char_6_05 (链术师) — S3 辉煌裂片; 机理分析; 孤卒

// PRTS S3: target's containing tile, range x-1 (13-cell diamond). Chain bounces keep their own radius.
const STORM_GRID = [[-2, 0], [-1, -1], [-1, 0], [-1, 1], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [1, -1], [1, 0], [1, 1], [2, 0]];

function pasngr(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const skillGrid = def?.skill?.rangeGrid?.length ? def.skill.rangeGrid : null;
  const strike = (battle, unit, first, scale) => {
    const ch0 = unit.profile?.chain || { count: 4, falloff: 0.15, radius: CHAIN_RADIUS };
    // elite module (电磁调节器) upgrades the skill's chain too: skill@chain.atk_scale / skill@sluggish
    const ch = { ...ch0, falloff: tb['skill@chain.atk_scale'] != null ? 1 - num(tb['skill@chain.atk_scale']) : num(ch0.falloff, 0.15) };
    const count = Math.max(1, Math.floor(num(bb['chain.max_target'], ch.count || 4)));
    const slug = num(tb['skill@sluggish'], num(bb.sluggish, ch.sluggish ?? 0));
    const hit = new Set();
    let prev = first;
    for (let i = 0; i < count && prev; i++) {
      hit.add(prev.id);
      battle.fx('lightning', { x: prev.x, y: prev.y, id: prev.id, src: unit.id });
      battle.dealDamage(unit, prev, { amount: unit.s.atk * scale * Math.pow(1 - num(ch.falloff, 0.15), i), type: 'arts', isSkill: true, isAttack: true, tags: ['skill', 'storm'] });
      if (slug > 0 && prev.alive) battle.applyStatus(prev, 'sluggish', { duration: slug, source: unit });
      let best = null, bd = Infinity;
      for (const x of battle.foesInRadius(prev.x, prev.y, ch.radius || CHAIN_RADIUS)) {
        if (hit.has(x.id) || !canTargetEnemy(unit, x, ANY)) continue;
        const d = bodyDist(x, prev.x, prev.y);
        if (d < bd - 1e-9) { bd = d; best = x; }
      }
      prev = best;
    }
  };
  // the chain of her profile (trait / module: bounce count, falloff, 停顿) with skill overrides
  const chainOf = (unit, o) => ({ ...(unit.profile?.chain || { count: 4, falloff: 0.15, radius: CHAIN_RADIUS, sluggish: 0.5 }), ...o });
  const skills = {
    // S1 电能之触: next attack at atk_scale × ATK, bouncing over max_target enemies with a sluggish-s 停顿 (the module's
    // skill@pasngr_s_1.chain.atk_scale sets its falloff)
    skchr_pasngr_1: {
      kind: 'instant',
      attack: { atkScale: bv(bb, 'atk_scale', 1) },
      onStart({ unit, skill }) {
        const o = { count: Math.max(1, Math.floor(bv(bb, 'max_target', 4))), sluggish: bv(bb, 'sluggish', 0.5) };
        if (tb['skill@pasngr_s_1.chain.atk_scale'] != null) o.falloff = 1 - num(tb['skill@pasngr_s_1.chain.atk_scale']);
        skill.spec.attack.chain = chainOf(unit, o);
      },
    },
    // S2 聚焦指令: range +1, ATK +atk, base attack time ×0.7/×0.6 (akdata: 乘算负数), bounces raised to attack@max_target
    skchr_pasngr_2: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), batPct: batOf(bb.base_attack_time, def, true) },
      targeting: { rangeExtend: num(bb.ability_range_forward_extend) },
      attack: {},
      onStart({ unit, skill }) { skill.spec.attack.chain = chainOf(unit, { count: Math.max(1, Math.floor(num(bb['attack@max_target'], 5))) }); },
    },
  };
  return {
    skills,
    skill: {
      kind: 'charges',
      onStart({ battle, unit }) {
        const keys = skillGrid ? absoluteRangeKeys(skillGrid, unit.tileR, unit.tileC, unit.dir, unit.s.rangeExtend) : unit.rangeKeys;
        const cands = enemiesIn(battle, unit, keys);
        if (!cands.length) return;
        const tgt = cands.reduce((a, b) => (b.hp > a.hp ? b : a));
        const cx = Math.round(tgt.x), cy = Math.round(tgt.y);
        const zoneKeys = absoluteRangeKeys(STORM_GRID, cy, cx, 1);
        const dur = num(bb.duration, 4), iv = Math.max(0.1, num(bb.interval, 0.5)), scale = num(bb.atk_scale, 1);
        const n = Math.max(1, Math.round(dur / iv));
        battle.fx('storm', { x: cx, y: cy, id: unit.id, duration: dur, r: 2 });
        let k = 0;
        const seq = unit.deploySeq;
        const h = battle.every(iv, () => {
          if (!live(unit) || unit.deploySeq !== seq) { h.cancel(); return; } // the storm ends when she leaves the field
          if (++k >= n) h.cancel();
          const zone = enemiesIn(battle, unit, zoneKeys);
          const e = battle.rng.pick(zone);
          if (e) strike(battle, unit, e, scale);
        }, { owner: unit });
      },
    },
    talents: [
      { install(battle, unit) { // 机理分析
        const thr = num(t0.hp_ratio, 0.8), ds = bv(t0, 'damage_scale', 1), dur = bv(t0, 'duration', 3);
        const key = `pasngr:enhance:${unit.id}`;
        battle.on('hit', (ctx) => {
          const t = ctx.target;
          if (ctx.source !== unit || !t || t.side !== 'enemy' || ctx.dmg.type === 'element') return;
          if (ctx.dmg.isAttack && t.hpRatio >= thr - 1e-9) battle.addBuff(t, { key, duration: dur, refresh: 'replace', source: unit });
          if (t.findBuff(key)) ctx.dmg.mul *= ds;
        }, { owner: unit });
      } },
      { install(battle, unit) { // 孤卒: no enemy on the 4 surrounding tiles
        const atk = num(t1.atk), spr = num(t1.sp_recovery_per_sec);
        aura(battle, unit, 0.25, () => {
          const near = new Set(absoluteRangeKeys(N4, unit.tileR, unit.tileC, 1, 0));
          if (battle.enemies.some((e) => e.alive && !e.hidden && bodyInKeys(e, near))) return;
          battle.addBuff(unit, { key: 'pasngr:lone', mods: { atkPct: atk, spRecoveryFlat: spr }, duration: 0.4, refresh: 'replace' });
        });
      } },
    ],
  };
}

export default {
  chess_char_6_05_a: pasngr,
};
