// server/sim/content/kits/ops/chess_char_6_09-cello.js — 塑心 (char_245_cello) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { bodyInRange } from '../../../body.js';
import { hasHp } from '../../../attack.js';
import {
  num, tbb, moduleBb, live, isElite, enemiesIn, selectedSkill, skillGridOf, bstate, onElementHit, elementDmg, aura,
} from '../shared/tier6.js';

// ------------------------------------------------------------------------------------------------------------------
// 塑心 chess_char_6_09 (巫役) — S1 “黄金的狂喜”; 无词哀歌; 精神逆构; module 强弱法

function cello(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {}, mod = moduleBb(chess);
  const sid = selectedSkill(chess, def);
  const isS1 = sid === 'skchr_cello_1' || !(chess?.skills?.length); // S1 = the default (no loadout info ⇒ default)
  // "第二天赋效果提升至N倍" (S3): every 精神逆构 number scaled around 1 (delta × N) while it runs
  const boost = (c) => (c.mem.celloBoost > 0 ? c.mem.celloBoost : 1);
  const scaled = (v, c) => 1 + (v - 1) * boost(c);
  /** S2 partner: the other operator of her range with the highest ATK (re-picked every 0.5 s). */
  const pickPartner = (battle, unit) => {
    unit.mem.celloPick = 0.5;
    const ops = battle.alliesInGrid(unit).filter((a) => a !== unit && a.kind === 'op');
    unit.mem.celloPartner = ops.reduce((best, a) => (!best || a.s.atk > best.s.atk + 1e-9 ? a : best), null);
  };
  const skills = {
    // S2 “安魂的弥撒”: ASPD +, one extra target; while it runs every damage she or the highest-ATK other operator of her
    // range deals to an enemy also adds ep_damage_ratio × her ATK 凋亡损伤 (install)
    skchr_cello_2: {
      kind: 'duration',
      mods: { aspd: num(bb.attack_speed) },
      targeting: { maxTargets: 2 },
      onStart({ battle, unit }) { pickPartner(battle, unit); },
      onTick({ battle, unit, dt }) {
        unit.mem.celloPick -= dt;
        if (unit.mem.celloPick > 0 && live(unit.mem.celloPartner)) return;
        pickPartner(battle, unit);
      },
      onEnd({ unit }) { unit.mem.celloPartner = null; },
    },
    // S3 “自由的探戈”: stops attacking, skill range, ATK +atk, 精神逆构 ×scale_delta_to_one; the other operators of her
    // range with the highest max HP / ATK / DEF get +20 % of that stat
    skchr_cello_3: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      ...(skillGridOf(def) ? { targeting: { rangeGrid: skillGridOf(def) } } : {}),
      attack: { noAttack: true },
      onStart({ unit }) { unit.mem.celloBoost = num(bb.scale_delta_to_one, 1); unit.mem.celloAcc = Infinity; },
      onTick({ battle, unit, dt }) {
        unit.mem.celloAcc += dt;
        if (unit.mem.celloAcc < 0.5) return;
        unit.mem.celloAcc = 0;
        const ops = battle.alliesInGrid(unit).filter((a) => a !== unit && a.kind === 'op');
        const top = (f) => ops.reduce((best, a) => (!best || f(a) > f(best) + 1e-9 ? a : best), null);
        const give = (a, key, mods) => { if (a) battle.addBuff(a, { key, mods, duration: 0.75, refresh: 'replace', source: unit, visible: true }); };
        give(top((a) => a.base.maxHp), 'cello:tango:hp', { hpPct: num(bb['cello_s_3[max_hp].max_hp']) });
        give(top((a) => a.base.atk), 'cello:tango:atk', { atkPct: num(bb['cello_s_3[atk].atk']) });
        give(top((a) => a.base.def), 'cello:tango:def', { defPct: num(bb['cello_s_3[def].def']) });
      },
      onEnd({ unit }) { unit.mem.celloBoost = 1; },
    },
  };
  return {
    skills,
    // S1 "技能未开启时无法普通攻击" and its 未处于损伤爆发期间 target pick belong to S1 only
    trait: isS1 ? { noAttackUnlessSkill: true, priority: 'notBurst' } : null,
    install(battle, unit) {
      if (sid !== 'skchr_cello_2') return;
      const ratio = num(bb.ep_damage_ratio);
      // PRTS 塑心 S2 备注: "受影响的干员即将造成伤害时，因该效果造成的凋亡损伤生效于当次触发的伤害之前，该造成的凋亡损伤的来源
      // 始终为塑心" — a late `hit` handler (after every handler that may cancel the damage), so the 凋亡 lands while the
      // target is alive and may burst before the damage; 无来源 bursts (source null) never trigger it. It rides the
      // damage about to be dealt, so a hit dodged or absorbed afterwards still carried it [ASSUMED].
      battle.on('hit', (ctx) => {
        const s = ctx.source, t = ctx.target, d = ctx.dmg;
        if (!(ratio > 0) || !unit.skill?.active || !live(unit) || !s || !t || t.side !== 'enemy' || !hasHp(t) || !d || d.cancel) return;
        if (d.type === 'element' || d.type === 'elemental' || !(d.amount > 0) || (s !== unit && s !== unit.mem.celloPartner)) return;
        elementDmg(battle, unit, t, 'apoptosis', unit.s.atk * ratio);
      }, { owner: unit, priority: -1000 });
    },
    skill: {
      kind: 'charges',
      targeting: { priority: 'notBurst' },
      attack: {
        atkScale: num(bb.atk_scale, 1),
        onHit({ battle, unit, target }) { if (target && target.alive) elementDmg(battle, unit, target, 'apoptosis', unit.s.atk * num(bb.ep_damage_ratio)); },
      },
    },
    talents: [
      { install(battle, unit) { // 无词哀歌
        const er = num(t0.ep_damage_ratio), slug = num(t0.sluggish);
        aura(battle, unit, 1, () => {
          for (const e of enemiesIn(battle, unit)) {
            if (er > 0) elementDmg(battle, unit, e, 'apoptosis', unit.s.atk * er, ['talent']);
            if (slug > 0 && e.alive) battle.applyStatus(e, 'sluggish', { duration: slug, source: unit });
          }
        });
      } },
      { install(battle, unit) { // 精神逆构 (+ module element fragile / field-wide + DoT) and trait module (×1.18 vs elite/leader)
        const amp = num(t1.ep_damage_scale, 1), frag = num(t1.damage_scale, 1) - 1, elite = num(tb.ep_damage_scale, 1);
        // module 音乐家的旅程: "在场时，全场敌人…" (field-wide) + damage_value 元素伤害 per second during the burst
        const dot = num(t1.damage_value), fieldWide = t1.damage_value != null, dotIv = Math.max(0.1, num(t1.interval, 1));
        unit.mem.celloAmp = amp;
        unit.mem.celloWide = fieldWide;
        // one battle-wide handler: every apoptosis fill on an enemy inside some 塑心's range (or anywhere for a field-wide
        // one) × the strongest 精神逆构 (the same effect from two 塑心 does not stack)
        const S = bstate(battle);
        if (!S.cellos) {
          S.cellos = new Set();
          battle.on('elementHit', (ctx) => {
            const t = ctx.target, d = ctx.dmg;
            if (!d || d.type !== 'element' || d.element !== 'apoptosis' || !t || t.side !== 'enemy') return;
            let best = 1;
            for (const c of S.cellos) {
              if (!live(c) || !(c.mem.celloWide || bodyInRange(t, c.rangeKeySet))) continue;
              const v = scaled(c.mem.celloAmp, c);
              if (v > best) best = v;
            }
            if (best > 1) d.mul *= best;
          });
        }
        if (amp > 1) S.cellos.add(unit);
        // 强弱法 (elite trait): her element damage vs elite / leader enemies ×1.18
        if (elite > 1) onElementHit(battle, unit, (ctx) => (ctx.source === unit && ctx.target.side === 'enemy' && isElite(ctx.target) ? elite : 1));
        // "凋亡损伤爆发期间受到5%的元素脆弱" — the 元素脆弱 status (同名效果取最高)
        if (frag > 0) aura(battle, unit, 0.25, () => {
          for (const e of enemiesIn(battle, unit)) if (e.findBuff('apoptosisBurst')) battle.applyStatus(e, 'elemFragile', { duration: 0.4, value: frag * boost(unit), source: unit });
        });
        if (dot > 0) aura(battle, unit, dotIv, () => {
          for (const e of battle.enemies) {
            if (e.alive && !e.hidden && e.findBuff('apoptosisBurst')) battle.dealDamage(unit, e, { amount: dot * boost(unit), type: 'elemental', element: 'apoptosis', canDodge: false, tags: ['talent', 'elementDmg'] });
          }
        });
        // module 音乐家的旅程 trait: "攻击范围内敌人受到10%的元素脆弱"
        const mFrag = num(mod.damage_scale, 1) - 1;
        if (mFrag > 0) aura(battle, unit, 0.25, () => {
          for (const e of enemiesIn(battle, unit)) battle.applyStatus(e, 'elemFragile', { duration: 0.4, value: mFrag, source: unit });
        });
      } },
    ],
  };
}

export default {
  chess_char_6_09_a: cello,
};
