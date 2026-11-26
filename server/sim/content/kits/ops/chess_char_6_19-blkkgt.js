// server/sim/content/kits/ops/chess_char_6_19-blkkgt.js — 锏 (char_4116_blkkgt) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { absoluteRangeKeys, sortEnemyTargets, canTargetEnemy } from '../../../targeting.js';
import { num, tbb, textCount, live, ANY, enemiesIn, instantKind, pullToward } from '../shared/tier6.js';

// ------------------------------------------------------------------------------------------------------------------
// 锏 chess_char_6_19 (剑豪) — S3 归于宁静; “天生的武者”; 活着的传奇; module “过往的注脚”

function blkkgt(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const slashes = Math.max(1, textCount(def?.skill?.description, /总计(\d+)次/, 10, 'total-times'));
  const iv = Math.max(0.05, num(bb.d_hit_interval, 0.3)), pullIv = Math.max(0.1, num(bb.p_hit_interval, 1));
  const maxT = Math.max(1, Math.floor(num(bb.max_target, 1)));
  const skillGrid = def?.skill?.rangeGrid?.length ? def.skill.rangeGrid : null;
  // the skill range (x-1): her range while S3 runs — also for the finisher, since onEnd runs before the engine
  // removes the skill's range
  const skillKeys = (unit) => unit.rangeKeys || [];
  const castKeys = (unit) => absoluteRangeKeys(skillGrid || unit.rangeGrid, unit.tileR, unit.tileC, unit.dir, unit.s.rangeExtend);
  const groundSkillTargets = (battle, unit) => battle.unitsInGrid(unit, skillGrid || [[0, 0], [0, 1]], { side: 'enemy' })
    .filter((e) => !e.isFlying && canTargetEnemy(unit, e, unit.profile));
  const airProfile = (unit) => ({ ...unit.profile, canHitFly: true, groundOnly: false });
  // S3 hits and pulls air units too — PRTS 锏 S3 备注 "※可对空。不会拖拽自身中心半径0.6708范围内的敌人" (her attacks and S1 /
  // S2 stay ground-only: "地面敌人"); the air units of the mode are 静态刚体, so the pull leaves them in place (Battle.pull)
  const victims = (battle, unit) => {
    const c = battle.enemiesInKeys(skillKeys(unit), unit, airProfile(unit));
    sortEnemyTargets(battle, unit, c, null);
    return c.slice(0, maxT);
  };
  const slash = (battle, unit, scale) => {
    const v = victims(battle, unit);
    if (v.length) battle.fx('slash', { x: unit.x, y: unit.y, id: unit.id, n: v.length });
    for (const e of v) battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, tags: ['skill', 'slash'] });
  };
  // "持续将敌人中等力度地拖拽至自身中心，之后…较大力地拖拽至自身": the official 力度 − 重量 pulls (PRTS 推与拉: the last one
  // aims at her own tile centre, the others at the usual 拉力起点 half a tile ahead; 急停 0.6708 around her)
  const pull = (battle, unit, force, last = false) => {
    for (const e of enemiesIn(battle, unit, skillKeys(unit))) {
      if (last) pullToward(battle, unit, e, force); else battle.pullToFront(e, unit, force);
    }
  };
  const skills = {
    // S1 纯粹的武力 (attack SP): the next attack hits up to max_target ground enemies of the 3×3 around her, each twice
    // (her trait) at atk_scale_s1 × ATK
    skchr_blkkgt_1: {
      kind: 'instant',
      trigger: 'SEARCH',
      canActivate: (battle, unit) => battle.enemiesInKeys(castKeys(unit), unit, unit.profile).length > 0,
      attack: { atkScale: num(bb.atk_scale_s1, 1) },
      targeting: { maxTargets: Math.max(1, Math.floor(num(bb.max_target, 5))), ...(skillGrid ? { rangeGrid: skillGrid } : {}) },
    },
    // S2 无声的嘲笑 (attack SP, 2 charges): up to max_target ground enemies of the front skill range take 2 slashes
    // (3 when blocked) of dot_scale × ATK; the talent procs at 100 % meanwhile (skill active + bb.prob)
    skchr_blkkgt_2: {
      kind: instantKind(def),
      ...(def?.skill?.trigger?.rule === 'SP_FULL' ? { trigger: 'SEARCH' } : {}),
      canActivate: (battle, unit) => groundSkillTargets(battle, unit).length > 0,
      onStart({ battle, unit }) {
        const c = groundSkillTargets(battle, unit);
        sortEnemyTargets(battle, unit, c, null);
        const v = c.slice(0, Math.max(1, Math.floor(num(bb.max_target, 5))));
        const nFree = Math.floor(num(bb['blkkgt_s_2[not_blocked].trig_cnt'], 2)), nBlocked = Math.floor(num(bb['blkkgt_s_2[blocked].trig_cnt'], 3));
        if (v.length) battle.fx('slash', { x: unit.x, y: unit.y, id: unit.id, n: v.length });
        for (const e of v) {
          const n = e.blockedBy ? nBlocked : nFree;
          for (let i = 0; i < n && e.alive; i++) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.dot_scale, 1), type: 'phys', isSkill: true, tags: ['skill', 'slash'] });
        }
      },
    },
  };
  // module 新合同: trait "攻击时无视敌人70点的防御力"; talent 活着的传奇 "攻击力+8%…地面敌人首次进入自身攻击范围时，使其战栗6秒"
  const penFlat = num(tb.def_penetrate_fixed), legendAtk = num(t1.atk), legendTremble = num(t1.not_combat);
  return {
    skills,
    install(battle, unit) {
      if (penFlat > 0 || legendAtk) battle.addBuff(unit, { key: 'blkkgt:contract', mods: { defIgnoreFlat: penFlat, atkPct: legendAtk }, persist: true, allowDead: true });
      // S3 slashes: 晕眩免疫, 冻结免疫 (PRTS 备注)
      battle.on('beforeStatus', (c) => {
        if (c.target === unit && unit.mem.dgb && (c.status === 'stun' || c.status === 'freeze')) c.cancel = true;
      }, { owner: unit });
      if (legendTremble > 0) {
        const seen = new WeakSet();
        battle.on('tick', () => {
          if (!live(unit)) return;
          for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, ANY)) {
            if (e.isFlying || seen.has(e)) continue;
            seen.add(e);
            battle.applyStatus(e, 'tremble', { duration: legendTremble, source: unit });
          }
        }, { owner: unit });
      }
    },
    skill: {
      kind: 'duration',
      ...(def?.skill?.trigger?.rule === 'SP_FULL' ? { trigger: 'SEARCH' } : {}),
      canActivate: (battle, unit) => battle.enemiesInKeys(castKeys(unit), unit, airProfile(unit)).length > 0,
      duration: slashes * iv,
      ...(skillGrid ? { targeting: { rangeGrid: skillGrid } } : {}),
      attack: { noAttack: true },
      // PRTS 备注 "※多段斩击期间，自身获得无敌，晕眩免疫，冻结免疫": invulnerable while the slashes run (removed in onEnd,
      // before the finisher); stun / freeze refused by her `beforeStatus` hook (install) while `mem.dgb` is set
      onStart({ battle, unit }) {
        unit.mem.dgb = { n: 1, acc: 0, pacc: 0 };
        battle.addBuff(unit, { key: 'blkkgt:slashes', duration: slashes * iv + 1, flags: { invulnerable: true }, visible: true, source: unit });
        slash(battle, unit, num(bb.d_atk_scale, 1));
      },
      onTick({ battle, unit, dt }) {
        const m = unit.mem.dgb;
        if (!m) return;
        m.acc += dt;
        m.pacc += dt;
        while (m.acc + 1e-9 >= iv && m.n < slashes) { m.acc -= iv; m.n++; slash(battle, unit, num(bb.d_atk_scale, 1)); } // loop-cap: interval floored and textCount total-times
        if (m.pacc + 1e-9 >= pullIv) { m.pacc -= pullIv; pull(battle, unit, num(bb.p_force)); }
      },
      onEnd({ battle, unit, reason }) {
        unit.mem.dgb = null;
        battle.removeBuff(unit, 'blkkgt:slashes');
        if (reason === 'death' || !unit.alive) return;
        battle.fx('finale', { x: unit.x, y: unit.y, id: unit.id });
        unit.mem.dgbFinale = true; // the finisher is part of the skill (talent at 100 %, module +10 %)
        try { slash(battle, unit, num(bb.e_atk_scale_end, 1)); } finally { unit.mem.dgbFinale = false; }
        pull(battle, unit, num(bb.e_force), true);
      },
    },
    talents: [
      { install(battle, unit) { // 活着的传奇 → “天生的武者” → module (skill damage +10 %)
        const prob = num(t0.prob), sc = num(t0.atk_scale, 1), tr = num(t0.not_combat), pen = num(t1.def_penetrate), skillMul = num(tb.damage_scale, 1);
        battle.on('hit', (ctx) => {
          const t = ctx.target, d = ctx.dmg;
          if (ctx.source !== unit || !t || t.side !== 'enemy' || d.type === 'element') return;
          if (pen > 0 && t.findBuff('tremble')) d.defIgnorePct += pen;
          const p = unit.skill?.active || unit.mem.dgbFinale ? num(bb.prob, prob) : prob;
          if (p > 0 && (p >= 1 || battle.rng() < p)) {
            d.amount *= sc;
            if (tr > 0 && t.alive) battle.applyStatus(t, 'tremble', { duration: tr, source: unit });
          }
          if (skillMul > 1 && d.isSkill) d.mul *= skillMul;
        }, { owner: unit });
      } },
    ],
  };
}

export default {
  chess_char_6_19_a: blkkgt,
};
