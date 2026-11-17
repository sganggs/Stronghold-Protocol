// server/sim/content/kits/ops/ver-ctrail.js — 云迹 (char_4165_ctrail), 规程·序列Ⅰ.
// The skywalker branch's permanent flyer block is removed: she blocks flyers only while airborne.
// [ASSUMED] she does not block ground enemies while flying (起飞). [ASSUMED] `attack@height_offset` is
// presentation only. [ASSUMED] the airborne talent multiplies the attack and stacks with the skill's ATK%,
// it does not replace that ATK%. S1's data trigger is DEFAULT; the skill is a deploy-time takeoff.

import { sortEnemyTargets } from '../../../targeting.js';
import { num, skillRec, talentBb, toggleBuff, up } from '../shared/tier1.js';
import { gridOf, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_ctrail_1';
const S2 = 'skchr_ctrail_2';
const LIFTOFF = Object.freeze({ liftoff: true, blockFly: true });

function takeOff(battle, unit) {
  battle.releaseBlocked(unit);
  battle.fx('takeoff', { x: unit.x, y: unit.y, id: unit.id });
}
function land(battle, unit) { battle.releaseBlocked(unit); }

function ctrail(_bb, chess) {
  const t0 = talentBb(chess, 0);
  const s2 = skillRec(chess, S2)?.bb ?? {};
  const maxWalk = Math.max(0, Math.floor(num(s2['attack@max_walk_target'], 2)));
  const maxT = Math.max(1, Math.floor(num(s2['attack@max_target'], 3)));
  const airScale = num(t0.atk_scale, 1);
  const groundDef = num(t0.def);
  const { skills, skill } = kitSkills(chess, null, (id, rec, sbb) => {
    if (id === S1) {
      const g = gridOf(rec);
      return {
        kind: 'duration', activateOnDeploy: true, spCost: 0, spType: 'none', trigger: 'NEVER',
        duration: posDur(rec),
        mods: { atkPct: num(sbb.atk), dodgePhys: num(sbb.prob) },
        flags: LIFTOFF,
        targeting: g ? { rangeGrid: g } : undefined,
        onStart({ battle, unit }) { takeOff(battle, unit); },
        onEnd({ battle, unit }) { land(battle, unit); },
      };
    }
    if (id === S2) {
      const g = gridOf(rec);
      return {
        kind: 'duration',
        duration: posDur(rec),
        mods: { atkPct: num(sbb.atk) },
        flags: LIFTOFF,
        targeting: g ? { rangeGrid: g, maxTargets: maxT } : { maxTargets: maxT },
        attack: {
          onHit({ battle, unit, target }) {
            if (!target?.alive || !target.isFlying) return;
            const dur = num(sbb['attack@sluggish']);
            if (dur > 0) battle.applyStatus(target, 'sluggish', { duration: dur, source: unit });
          },
        },
        onStart({ battle, unit }) { takeOff(battle, unit); },
        onEnd({ battle, unit }) { land(battle, unit); },
      };
    }
    return { kind: 'instant' };
  });
  return {
    trait: { blockFly: false },
    skills, skill,
    install(battle, unit) {
      const drop = () => battle.removeBuff(unit, 'trait:skywalker');
      drop();
      battle.on('deploy', (ctx) => { if (ctx.unit === unit) drop(); }, { owner: unit });
      if (groundDef) toggleBuff(battle, unit, 'ctrail:ground', () => !unit.s.flags.liftoff, { defPct: groundDef });
      if (airScale !== 1) {
        battle.on('hit', (ctx) => {
          if (ctx.source !== unit || !up(unit) || !unit.s.flags.liftoff || !ctx.dmg?.isAttack) return;
          ctx.dmg.mul *= airScale;
        }, { owner: unit });
      }
      battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit || !unit.skill?.active || unit.skill.id !== S2) return;
        const prof = ctx.profile || unit.profile;
        const cands = battle.enemiesInKeys(unit.rangeKeys, unit, prof);
        for (const e of battle.blockedTargets(unit, prof)) if (!cands.includes(e)) cands.push(e);
        if (!cands.length) return;
        // One priority order, then a cap on ground targets; flyers fill the rest (予愿安洁莉娜 S3).
        sortEnemyTargets(battle, unit, cands, prof.priority);
        let ground = 0;
        const out = [];
        for (const e of cands) {
          if (out.length >= maxT) break;
          if (!e.isFlying) { if (ground >= maxWalk) continue; ground++; }
          out.push(e);
        }
        if (out.length) ctx.targets = out;
      }, { owner: unit });
    },
  };
}

export default { char_4165_ctrail: ctrail };
