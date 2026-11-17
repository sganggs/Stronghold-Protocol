// server/sim/content/kits/ops/chess_char_6_20-agoat2.js — 纯烬艾雅法拉 (char_1016_agoat2) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import { num, bv, tbb, textCount, WHOLE_FIELD, bstate, aura } from '../shared/tier6.js';

// ------------------------------------------------------------------------------------------------------------------
// 纯烬艾雅法拉 chess_char_6_20 (行医) — S3 火山回响; 氤氲; 火山灰疗愈

function agoat2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const hs = num(bb['attack@heal_scale'], 1);
  const shots = Math.max(1, textCount(def?.skill?.description, /(\d+)连发/, 1, 'burst'));
  const elemLoad = (a) => (a.elem ? a.elem.burn + a.elem.neural + a.elem.necrosis + a.elem.apoptosis + a.elem.erosion : 0);
  const skills = {
    // S1 无声润物 (toggle, heal): ATK +atk, one extra heal target, every ally of her range recovers ep_heal_ratio × ATK
    // 元素损伤 per second. 自动触发 with effects on allies only (nothing to target): on as soon as its SP is full (SP_FULL,
    // the owner's decision of 2026-10-05, like 浊心斯卡蒂 S2 / 引星棘刺 S1); until 0.2.0 the data's DEFAULT heal rule kept
    // it off until an ally of her range was injured, so its 元素损伤 recovery never ran on a field without HP damage
    skchr_agoat2_1: {
      kind: 'toggle',
      heal: true,
      trigger: 'SP_FULL',
      mods: { atkPct: num(bb.atk) },
      targeting: { maxTargets: 2 },
      onStart({ unit }) { unit.mem.agoatAcc = 0; },
      onTick({ battle, unit, dt }) {
        unit.mem.agoatAcc = (unit.mem.agoatAcc || 0) + dt;
        if (unit.mem.agoatAcc + 1e-9 < 1) return;
        unit.mem.agoatAcc -= 1;
        const v = unit.s.atk * bv(bb, 'ep_heal_ratio');
        if (v > 0) for (const a of battle.alliesInGrid(unit)) battle.reduceElement(a, v);
      },
    },
    // S2 云霭荫佑 (heal): one heal (her normal amount + element recovery) on every ally of her range, then a barrier
    // over that range for `duration` s absorbing agoat2_s_2[shield].atk_scale × ATK of 元素损伤 in all (install)
    skchr_agoat2_2: {
      kind: 'instant',
      heal: true,
      onStart({ battle, unit }) {
        const er = num(unit.profile?.heal?.elementHealRatio, num(tb.ep_heal_ratio, 0.5));
        const allies = battle.alliesInGrid(unit);
        for (const a of allies) {
          if (er > 0) battle.healElement({ target: a, amount: unit.s.atk * er });
          if (a.hp < a.s.maxHp) battle.heal(unit, a, unit.s.atk, { skillHeal: true });
        }
        const S = bstate(battle);
        // PRTS: recasting this source refreshes its shared pool instead of adding another shield.
    S.agoatVeils = (S.agoatVeils ?? []).filter(v => v.src !== unit);
        S.agoatVeils.push({ keys: new Set(unit.rangeKeys || []), pool: unit.s.atk * bv(bb, 'atk_scale', 5), until: battle.time + num(bb.duration, 12), src: unit });
        battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id, duration: num(bb.duration, 12) });
        if (!S.agoatVeilHook) {
          S.agoatVeilHook = true;
          battle.on('elementHit', (ctx) => { // the barrier absorbs 元素损伤 of the allies inside it
            const t = ctx.target, d = ctx.dmg;
            if (!t || t.side !== 'ally' || !d || d.type !== 'element' || d.cancel) return;
            S.agoatVeils = S.agoatVeils.filter((v) => v.pool > 1e-9 && battle.time < v.until);
            const k = t.tileR * COLS + t.tileC;
            for (const v of S.agoatVeils) {
              if (!v.keys.has(k)) continue;
              const eff = d.amount * d.mul;
              if (!(eff > 0)) return;
              const take = Math.min(v.pool, eff);
              v.pool -= take;
              if (take >= eff - 1e-9) { d.cancel = true; return; }
              d.mul *= (eff - take) / eff;
            }
          }, { priority: -2000 });
        }
      },
    },
  };
  return {
    skills,
    install(battle, unit) {
      // module 想要留下的生命: "攻击范围内存在受到元素损伤的友方单位时，攻击速度+8"
      const as = num(tb.attack_speed);
      if (as) aura(battle, unit, 0.25, () => {
        if (battle.alliesInGrid(unit).some((a) => elemLoad(a) > 0)) battle.addBuff(unit, { key: 'agoat2:linger', mods: { aspd: as }, duration: 0.4, refresh: 'replace' });
      });
    },
    skill: {
      kind: 'duration',
      heal: true,
      targeting: { rangeGrid: WHOLE_FIELD, maxTargets: shots },
      attack: { healScale: hs },
      onStart({ skill, unit }) {
        const h = unit.profile?.heal || { mode: 'single' };
        skill.spec.attack.heal = { ...h, elementHealRatio: num(h.elementHealRatio) * hs };
      },
    },
    talents: [
      { install(battle, unit) { // S3: 5 shots, different targets first
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !unit.skill?.active || !ctx.targets.length || ctx.targets.length >= shots) return;
          const base = ctx.targets.slice();
          const out = [];
          for (let i = 0; i < shots; i++) out.push(base[i % base.length]); // loop-cap: textCount burst
          ctx.targets = out;
        }, { owner: unit });
      } },
      { install(battle, unit) { // 氤氲
        // "普通治疗使目标每秒额外受到一次治疗量和元素损伤回复量为10%的增益治疗，持续6秒（最多叠加3层）" — PRTS 备注: "本天赋受
        // 特性治疗倍率影响，使用缓存攻击力；叠加时，重置持续时间并更新缓存攻击力": a 10 % heal shaped like her normal one —
        // HP heal_scale × ATK and 元素损伤 recovery heal_scale × the trait's ep_heal_ratio × ATK (0.5 / 0.6: 5 % / 6 %,
        // it used to be the full 10 %) — per stack, with the ATK of the last application; a new stack refreshes them all.
        const sc = num(t0.heal_scale), dur = num(t0.duration, 6), max = Math.max(1, Math.floor(num(t0.max_stack_cnt, 3)));
        if (!(sc > 0)) return;
        const epRatio = () => num(unit.profile?.heal?.elementHealRatio, num(tb.ep_heal_ratio, 0.5));
        battle.on('heal', (ctx) => {
          const t = ctx.target;
          if (ctx.source !== unit || ctx.opts?.hot || ctx.opts?.aura || ctx.opts?.regen || ctx.opts?.skillHeal || !t) return;
          // keyed per 纯烬: two of them (co-op) each keep their own stacks, ATK and heal source
          const b = battle.addBuff(t, {
            key: `agoat2:mist:${unit.id}`, duration: dur, refresh: 'stack', stacks: 1, maxStacks: max, interval: 1, source: unit, data: {},
            onTick: ({ unit: a, buff }) => {
              const amt = num(buff.data.atk, unit.s.atk) * sc * Math.max(1, buff.stacks);
              battle.reduceElement(a, amt * epRatio());
              if (a.hp < a.s.maxHp) battle.heal(unit, a, amt, { hot: true });
            },
          });
          if (b) b.data.atk = unit.s.atk;
        }, { owner: unit });
      } },
      { install(battle, unit) { // 火山灰疗愈 (×talent_scale during S3)
        // "受到的元素损伤降低" is a 元素损伤 multiplier applied on the element hit (PRTS 元素 "…后续可应用元素损伤倍率
        // 提升/降低等效果"), not `elemTakenMul` (元素伤害 / 元素脆弱): the aura buff carries the cut, `elementHit` applies it
        const hp = num(t1.max_hp), er = num(t1.ep_damage_resistance), mulS = num(bb.talent_scale, 1);
        aura(battle, unit, 0.5, () => {
          const f = unit.skill?.active ? mulS : 1;
          for (const a of battle.alliesInGrid(unit)) {
            battle.addBuff(a, { key: 'agoat2:ash', mods: { hpPct: hp * f }, data: { epCut: Math.min(1, er * f) }, source: unit, duration: 0.75, refresh: 'replace' });
          }
        });
        battle.on('elementHit', (ctx) => {
          const d = ctx.dmg, b = ctx.target?.findBuff?.('agoat2:ash');
          if (!b || b.source !== unit || !d || d.type !== 'element') return;
          const cut = num(b.data?.epCut);
          if (cut > 0) d.mul *= Math.max(0, 1 - cut);
        }, { owner: unit, priority: 20 });
      } },
    ],
  };
}

export default {
  chess_char_6_20_a: agoat2,
};
