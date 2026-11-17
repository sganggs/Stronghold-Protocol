// server/sim/content/kits/ops/chess_char_3_18-vulpis.js — 忍冬 (char_4026_vulpis) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import {
  num, defOf, talentBb, traitBb, altSkills, instantKindOf, alive, gridKeys, fx, copyGrid, enemiesOn, whileTrue,
  isLeader,
} from '../shared/tier3.js';

/** 忍冬 S3's 迷彩 (until her next cast): its own buff key, never merged with another unit status. */
const CAMOU_KEY = 'vulpis:camou';

export default {
  // ---- 3_18 忍冬 · 尖兵 — S3 隐狐之艺: +DP, range +1, ATK +, decaying ASPD, hits all blocked, 0.2 s stun per hit,
  //      after a kill during the skill 迷彩 from its end until the next cast ("进入迷彩状态，直至下一次开启技能") — the
  //      `camou` status under its own key (ba.camou "不阻挡时不成为敌方普通攻击的目标": only the enemy she blocks attacks
  //      her, as with 隐匿; it used to be the generic `stealth` = 隐匿 under the key `stealth`, shared with 伪装服's timed
  //      隐匿, which the unending one then made permanent, and it counted as 隐匿 for 叙拉古 / 家族徽章 — user playtest #6
  //      "叙拉古阵营隐身不会结束": the bond's 隐匿 ends on time, this 迷彩 officially lasts); 追凶: bonus arts on marked
  //      enemies; 蓄势: DP regen + out-of-combat
  //      regen; 精锐 module SOL-X: ATK/DEF + while blocking
  //      S1 小施惩戒 (charges): next attack + extra_damage_ratio × ATK arts and +cost DP; S2 坠刃拷问 (charges, the data rule
  //      SKILL_RANGE: fires once an enemy is inside its own range 3-12, charges 3 s apart): +cost DP, ≤ max_target enemies of that range take atk_scale arts and
  //      停顿 — the ones already 停顿 are also stunned; its targets come from the 3-12 only (PRTS S2 备注 "可对空；无法选中被自身
  //      阻挡而没有位于技能范围内的敌人" — an S2 note, not S3's: S3 隐狐之艺 has none, its client selector is the standard
  //      「同时攻击阻挡的所有敌人」 one). (SOL-Y "首次部署时部署费用-4": the initial deployment is free.)
  chess_char_3_18_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0), t1 = talentBb(d, 1);
    const tb = traitBb(d);
    const skillGrid = copyGrid(d.skill?.rangeGrid);
    const aspd0 = num(bb.attack_speed, 0);
    const kit = {
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk) },
        attack: { hitAllBlocked: true, onHitStatus: { key: 'stun', duration: num(bb['attack@stun'], 0.2) } },
        onStart({ battle, unit, skill }) {
          battle.removeBuff(unit, CAMOU_KEY);
          unit.mem.vulpisKill = false;
          const dp = num(bb.cost, 0);
          if (dp > 0) { battle.addDp(unit.ownerId, dp, unit); fx(battle, 'dp', unit, { n: dp }); }
          battle.addBuff(unit, { key: 'skill:vulpis_aspd', mods: { aspd: aspd0 } });
          unit.mem.vulpisDur = skill.timeLeft;
        },
        onTick({ battle, unit, skill }) {
          const b = unit.findBuff('skill:vulpis_aspd');
          const dur = unit.mem.vulpisDur || skill.duration || 1;
          if (b) { b.mods = { aspd: aspd0 * Math.max(0, skill.timeLeft) / dur }; unit.markDirty(); }
        },
        onEnd({ battle, unit, reason }) {
          battle.removeBuff(unit, 'skill:vulpis_aspd');
          if (reason !== 'death' && unit.alive && unit.mem.vulpisKill) {
            battle.addBuff(unit, { key: CAMOU_KEY, flags: { camou: true }, status: 'camou', source: unit });
            fx(battle, 'camouflage', unit);
          }
        },
      },
      skills: altSkills(chess, d, bb, {
        skchr_vulpis_1: (s) => ({
          kind: instantKindOf(s),
          attack: { onHit({ battle, unit, target }) {
            if (target && target.alive) battle.dealDamage(unit, target, { amount: unit.s.atk * num(s.bb.extra_damage_ratio), type: 'arts', isSkill: true, tags: ['skill', 'vulpisPunish'] });
            const dp = num(s.bb.cost, 0);
            if (dp > 0) { battle.addDp(unit.ownerId, dp, unit); fx(battle, 'dp', unit, { n: dp }); }
          } },
        }),
        skchr_vulpis_2: (s) => { // 坠刃拷问 — air units too (PRTS 备注 "※可对空"); data trigger SKILL_RANGE (its 3-12 range)
          const grid = copyGrid(s.rangeGrid);
          const n = Math.max(1, Math.floor(num(s.bb.max_target, 6)));
          return {
            kind: instantKindOf(s),
            onStart({ battle, unit }) {
              const dp = num(s.bb.cost, 0);
              if (dp > 0) { battle.addDp(unit.ownerId, dp, unit); fx(battle, 'dp', unit, { n: dp }); }
              const list = enemiesOn(battle, unit, gridKeys(grid ?? unit.rangeGrid, unit), n);
              for (const e of list) {
                const was = !!e.findBuff('sluggish'); // "若敌人已经处于停顿状态" (before this cast)
                battle.dealDamage(unit, e, { amount: unit.s.atk * num(s.bb.atk_scale, 1), type: 'arts', isSkill: true, tags: ['skill', 'vulpisTorture'] });
                if (!e.alive) continue;
                battle.applyStatus(e, 'sluggish', { duration: num(s.bb.sluggish, 0), source: unit });
                if (was && e.alive) battle.applyStatus(e, 'stun', { duration: num(s.bb.stun, 0), source: unit });
              }
              if (list.length) fx(battle, 'aoe', unit, { radius: 1.5, dmgType: 'arts', skill: 'vulpis_2', n: list.length });
            },
          };
        },
      }),
      talents: [
        { install(battle, unit) { // 追凶
          const marks = new Map();
          // re-entrancy guard: content that turns a hit into HP loss credited to her (频次 enemies: every instance
          // = 1 HP) would otherwise feed the bonus back into itself until the hook-depth limit
          let busy = false;
          battle.on('damaged', (ctx) => {
            const e = ctx.target;
            if (busy || ctx.source !== unit || e.side !== 'enemy' || ctx.type === 'element' || ctx.dmg?.tags?.includes('vulpisHunt')) return;
            let t = marks.get(e.id);
            // PRTS talent remarks: the first damage instance also receives the arts addition.
            if (t == null) { t = battle.time; marks.set(e.id, t); }
            if (battle.time - t <= num(t0.interval, 10) + 1e-9 && e.alive) {
              busy = true;
              // PRTS 备注 "伤害类型为法术附加伤害": tag addition (no 叙拉古 6 roll)
              try { battle.dealDamage(unit, e, { amount: unit.s.atk * num(t0.atk_scale), type: 'arts', canDodge: false, tags: ['talent', 'vulpisHunt', 'addition'] }); } finally { busy = false; }
            }
          }, { owner: unit });
          battle.on('kill', (ctx) => { if (ctx.killer === unit && unit.skill?.active) unit.mem.vulpisKill = true; }, { owner: unit });
        } },
        { install(battle, unit) { // 蓄势
          unit.mem.vulpisDp = true;
          const bonus = num(t1.delta_cost_increase_time, 1) - 1;
          const quiet = num(t1.interval, 4);
          const regen = num(t1['vulpis_t_2[heal][interval].hp_recovery_per_sec_by_max_hp_ratio'], 0);
          battle.on('tick', (ctx) => {
            if (!alive(unit)) return;
            if (bonus > 0 && isLeader(battle, unit, 'vulpisDp')) battle.addDp(unit.ownerId, battle.flags.dpPerSec * ctx.dt * bonus);
            const on = battle.time - unit.lastHitAt >= quiet && regen > 0;
            const has = !!unit.findBuff('talent:vulpis_regen');
            if (on && !has) battle.addBuff(unit, { key: 'talent:vulpis_regen', mods: { hpRegenRatio: regen } });
            else if (!on && has) battle.removeBuff(unit, 'talent:vulpis_regen');
          }, { owner: unit });
        } },
      ],
    };
    if (skillGrid) kit.skill.targeting = { rangeGrid: skillGrid };
    if (num(tb.atk) > 0 || num(tb.def) > 0) {
      kit.install = (battle, unit) => whileTrue(battle, unit, 'trait:vulpis_block', () => unit.blocking.length > 0, { atkPct: num(tb.atk), defPct: num(tb.def) });
    }
    return kit;
  },
};
