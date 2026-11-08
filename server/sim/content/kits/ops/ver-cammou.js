// server/sim/content/kits/ops/ver-cammou.js — 卡达 (char_328_cammou), 规程·序列Ⅰ.
// The unreleased drone ramp is the funnel profession (init_atk_scale / delta / max). max_stack_cnt is that ramp's
// stack cap, not a drone count.

import { enemiesInGrid, num, skillBbOf, statBuff, talentBb, up } from '../shared/tier1.js';
import { gridOf, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skcom_atk_up[2]';
const S2 = 'skchr_cammou_2';
const DRONE = 'cammou:drone';

function maybeStun(battle, unit, target, prob, dur) {
  if (!(dur > 0) || !target?.alive || !battle.rng.chance(prob)) return;
  battle.applyStatus(target, 'stun', { duration: dur, source: unit });
}

function cammou(_bb, chess, def) {
  const aspd = num(talentBb(chess, 0).attack_speed);
  const s2 = skillBbOf(chess, S2);
  const prob = num(s2['attack@prob']);
  const stun = num(s2['attack@stun']);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return { kind: 'duration', duration: posDur(rec), mods: { atkPct: num(sbb.atk) } };
    if (id === S2) {
      const g = gridOf(rec);
      return {
        kind: 'duration', duration: posDur(rec),
        mods: { atkPct: num(sbb.atk) },
        targeting: g ? { rangeGrid: g } : undefined,
        onStart({ unit }) {
          const key = typeof unit.profile.funnelMul === 'function' ? 'funnelMul' : 'dmgMul';
          const mul = unit.profile[key];
          unit.profile = { ...unit.profile, [key]: null };
          // [ASSUMED] the sentence names one 浮游单元 and the blackboard has no count. It starts at the trait's
          // initial scale (it does not copy the unreleased ramp) and the first shot waits one of her intervals.
          unit.mem.cammou = { key, mul, cd: unit.s.interval, lock: null, scale: null, done: false };
        },
        onTick({ battle, unit, dt }) {
          const rel = unit.mem.cammou;
          if (!rel || rel.done || !up(unit) || !unit.skill?.active) return;
          rel.cd -= dt;
          if (rel.lock && !rel.lock.alive) { rel.done = true; rel.lock = null; return; }
          if (!rel.lock) {
            rel.lock = enemiesInGrid(battle, unit, null, { canHitFly: true })[0] ?? null;
            rel.scale = null;
          }
          if (!rel.lock || rel.cd > 1e-9) return;
          rel.cd = unit.s.interval;
          const f = unit.profile.funnel || { init: 0.2, delta: 0.15, max: 1.1 };
          rel.scale = rel.scale == null ? f.init : Math.min(f.max, rel.scale + f.delta);
          const tgt = rel.lock;
          battle.fx('drone', { x: tgt.x, y: tgt.y, id: unit.id });
          battle.dealDamage(unit, tgt, {
            amount: unit.s.atk * unit.s.atkScaleMul * rel.scale, type: 'arts',
            isSkill: true, isAttack: false, tags: ['skill', 'drone', DRONE],
          });
          maybeStun(battle, unit, tgt, prob, stun);
        },
        onEnd({ unit }) {
          const rel = unit.mem.cammou;
          unit.mem.cammou = null;
          if (rel?.key && unit.profile) unit.profile = { ...unit.profile, [rel.key]: rel.mul };
        },
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      if (aspd) statBuff(battle, unit, 'cammou:sync', { aspd });
      battle.on('hit', (ctx) => {
        if (ctx.source !== unit || !unit.skill || unit.skill.id !== S2 || !unit.skill.active) return;
        const dmg = ctx.dmg;
        if (!dmg?.isAttack || !ctx.target) return;
        const tags = dmg.tags || [];
        if (tags.includes('drone') || tags.includes('addition') || tags.includes('funnel') || tags.includes(DRONE)) return;
        maybeStun(battle, unit, ctx.target, prob, stun);
      }, { owner: unit });
    },
  };
}

export default { char_328_cammou: cammou };
