// server/sim/content/kits/ops/chess_char_6_15-qiubai.js — 仇白 (char_4082_qiubai) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { num, tbb, textCount, enemiesIn, skillGridOf, aura } from '../shared/tier6.js';
import { hasHp } from '../../../attack.js';
import { installLordArtsAddition } from '../shared/lord.js';

// ------------------------------------------------------------------------------------------------------------------
// 仇白 chess_char_6_15 (领主) — S3 问雪; 入隙; 落英; module 雪浸过的斗笠

function qiubai(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const extraTargets = textCount(def?.skill?.description, /额外攻击(\d+)个目标/, 0, 'extra-targets');
  const skillGrid = def?.skill?.rangeGrid?.length ? def.skill.rangeGrid : null;
  const gapScale = t0.atk_scale_t != null ? num(t0.atk_scale_t) : num(t0.atk_scale), bothMul = t0.atk_scale_t != null ? num(t0.value, 1) : 1;
  const modArts = num(tb.atk_scale_m);
  const gapKey = t0.atk_scale_t != null ? 'qiubai_e_002_t[damage]' : 'qiubai_talent_1[damage]';
  // module 欲雪时: 落英 "首次命中敌人时提升至100%且束缚时间提升至3秒" (duration_advanced); trait "攻击范围内存在2名及以上敌人时
  // 攻击速度+12" (talent-0 part cnt / attack_speed)
  const firstBind = num(t1.duration_advanced), hitOnce = new WeakMap();
  const crowdCnt = num(t0.cnt), crowdAs = num(t0.attack_speed);
  const skillGridQ = skillGridOf(def);
  const groundIn = (battle, unit) => enemiesIn(battle, unit).filter((e) => !e.isFlying);
  const skills = {
    // S1 留羽 (attack SP): the next attack binds its target `duration` s; when that bind ends the target and the enemies
    // near it take aoe_scale × ATK arts
    skchr_qiubai_1: {
      kind: 'instant',
      attack: {
        onHit({ battle, unit, target }) {
          if (!target || !target.alive) return;
          const dur = num(bb.duration, 2);
          battle.applyStatus(target, 'bind', { duration: dur, source: unit });
          const seq = unit.deploySeq;
          battle.after(dur, () => {
            if (!unit.alive || unit.deploySeq !== seq) return;
            const x = target.x, y = target.y; // (a fallen target keeps its last position)
            battle.fx('aoe', { x, y, id: unit.id });
            for (const e of battle.foesInRadius(x, y, 1.2, true)) { // splash around the target: 中点判定
              if (e.alive && !e.s.flags.untargetable) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.aoe_scale, 1), type: 'arts', isSkill: true, isSplash: e !== target, tags: ['skill'] });
            }
          }, { owner: unit });
        },
      },
    },
    // S2 承影 (attack SP, 5 s): sword_begin_atk_scale × ATK arts on the ground enemies of the front range at the start,
    // skill range + ATK +atk, ground enemies in range 停顿, sword_end_atk_scale × ATK physical on them at the end
    skchr_qiubai_2: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      ...(skillGridQ ? { targeting: { rangeGrid: skillGridQ } } : {}),
      onStart({ battle, unit }) {
        battle.fx('sword', { x: unit.x, y: unit.y, id: unit.id });
        for (const e of groundIn(battle, unit)) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.sword_begin_atk_scale, 1), type: 'arts', isSkill: true, tags: ['skill'] });
      },
      onTick({ battle, unit }) { for (const e of groundIn(battle, unit)) battle.applyStatus(e, 'sluggish', { duration: 0.25, source: unit }); },
      onEnd({ battle, unit, reason }) {
        if (reason === 'death' || !unit.alive) return;
        for (const e of groundIn(battle, unit)) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.sword_end_atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill'] });
      },
    },
  };
  return {
    skills,
    talents: crowdCnt > 0 && crowdAs ? [{ install(battle, unit) {
      aura(battle, unit, 0.25, () => {
        if (enemiesIn(battle, unit).length >= crowdCnt) battle.addBuff(unit, { key: 'qiubai:crowd', mods: { aspd: crowdAs }, duration: 0.4, refresh: 'replace' });
      });
    } }] : [],
    install(battle, unit) {
      // [ASSUMED] Relative DEFAULT-priority acquisition follows talent registration before the module.
      battle.on('damageCalculate', c => {
        const target = c.target;
        if (c.source !== unit || !hasHp(target) || target.side !== 'enemy') return;
        // qiubai_t_1 / e_002_t creates a target-held 0.1 s buff; check statuses only on finish.
        if (gapScale > 0) {
          const finishGap = () => {
            if (!hasHp(target)) return;
            const slug = !!(target.findBuff('sluggish') || target.findBuff('sluggish[inf]')), bind = !!(target.findBuff('bind') || target.s.flags.bind);
            if (!slug && !bind) return;
            battle.dealDamage({ source: unit, target, amount: unit.s.atk * gapScale * (slug && bind ? bothMul : 1),
              type: 'arts', attackType: 'ADDITION', applyWay: 'NONE', calculation: 'precomputed', origin: c.dmg, tags: ['talent', 'qiubai:gap'] });
          };
          const pending = battle.addBuff(target, {
            key: gapKey, source: unit,
            // [ASSUMED] Reapplication follows the sim's replace contract for this native single-stack key.
            refresh: 'replace', onRemove: finishGap,
          });
          // Use an absolute deadline: a buff created before the buff phase must not expire one tick early.
          battle.after(0.1, () => {
            if (target.findBuff(gapKey) === pending) battle.removeBuff(target, pending);
          }, { owner: unit });
        }
        // Native 落英 also listens to source calculation; Y's durable first mark belongs to a deployment.
        if (firstBind > 0 && hitOnce.get(target) !== unit.deploySeq) {
          hitOnce.set(target, unit.deploySeq);
          battle.applyStatus(target, 'bind', { duration: firstBind, source: unit });
        } else if (num(t1.prob) > 0 && battle.rng() < num(t1.prob)) {
          battle.applyStatus(target, 'bind', { duration: num(t1.duration), source: unit });
        }
      }, { owner: unit });
      installLordArtsAddition(battle, unit, modArts);
    },
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      targeting: { maxTargets: 1 + extraTargets, ...(skillGrid ? { rangeGrid: skillGrid } : {}) },
      attack: { dmgType: 'arts', dmgMul: () => 1 },
      onStart({ unit }) { unit.mem.qbStack = 0; },
      onAttack({ battle, unit }) {
        const max = Math.floor(num(bb.max_stack_cnt));
        if (unit.mem.qbStack >= max) return;
        unit.mem.qbStack++;
        battle.addBuff(unit, { key: 'qiubai:snow', mods: { aspd: num(bb.attack_speed) * unit.mem.qbStack } });
      },
      onEnd({ battle, unit }) { battle.removeBuff(unit, 'qiubai:snow'); unit.mem.qbStack = 0; },
    },
  };
}

export default {
  chess_char_6_15_a: qiubai,
};
