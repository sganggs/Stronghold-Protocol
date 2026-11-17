// server/sim/content/kits/ops/ver-brigid.js — 水灯心 (char_4177_brigid), 规程·序列Ⅰ.
// The loopshooter boomerang flight stays the profession. The kit owns the extra bounces and the stuck cuts, and it
// calls comeBack itself: the engine does not, once boomerangOnward returns.

import { PROJECTILE_SPEEDS } from '../../../constants.js';
import { isHpLoss } from '../../../attack.js';
import { canTargetEnemy } from '../../../targeting.js';
import { cheb, num, onHitBy, RING1, talentBb, traitBb, up } from '../shared/tier1.js';
import { kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_brigid_1';
const S2 = 'skchr_brigid_2';

function brigid(_bb, chess, def) {
  const tb = traitBb(chess);
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'instant',
      attack: {
        atkScale: num(sbb.atk_scale, 1),
        // [ASSUMED] the official blackboard has only atk_scale and times. The next bounce is the nearest other enemy
        // within the 8-neighbour ring (1.5), preferring one this throw has not hit, at the boomerang's outbound speed.
        boomerangOnward(ctx) {
          const { battle, unit } = ctx;
          const hit = new Set(ctx.target ? [ctx.target] : []);
          let on = ctx.target, x = ctx.x, y = ctx.y;
          let left = Math.max(0, Math.floor(num(sbb.times)));
          const next = () => {
            if (left <= 0 || !ctx.home()) { ctx.comeBack(x, y); return; }
            const cands = battle.foesInRadius(x, y, RING1).filter((e) => e !== on && canTargetEnemy(unit, e, ctx.profile));
            if (!cands.length) { ctx.comeBack(x, y); return; }
            const d2 = (e) => (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
            cands.sort((a, b) => (hit.has(a) ? 1 : 0) - (hit.has(b) ? 1 : 0) || d2(a) - d2(b) || a.spawnSeq - b.spawnSeq);
            const tgt = cands[0];
            left--;
            battle.addProjectile({
              from: { x, y }, target: tgt, speed: PROJECTILE_SPEEDS.boomerang, visual: 'boomerang', source: unit, hitDead: true,
              onHit: (c) => {
                x = c.x; y = c.y;
                on = c.target;
                if (c.target) { hit.add(c.target); ctx.hit(c.target, c.x, c.y); }
                next();
              },
            });
          };
          next();
        },
      },
    };
    if (id === S2) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk) },
      attack: {
        ...(num(sbb['attack@sluggish']) > 0 ? { onHitStatus: { key: 'sluggish', duration: num(sbb['attack@sluggish']) } } : {}),
        // [ASSUMED] the extra cuts are physical attacks (so the 8-tile module can see them) at cut_scale × current ATK.
        // The first is one interval after the landing; the boomerang goes home after projectile_delay_time if she is still there.
        boomerangOnward(ctx) {
          const { battle, unit, target } = ctx;
          const iv = num(sbb['attack@interval']);
          const n = iv > 0 ? Math.max(0, Math.round(num(sbb['attack@cut_duration']) / iv)) : 0;
          const scale = num(sbb['attack@cut_scale'], 1);
          if (target && n > 0) {
            let left = n;
            battle.every(iv, (b, sc) => {
              if (!up(unit) || !target.alive || left <= 0) { sc.cancel(); return; }
              left--;
              b.dealDamage({
                source: unit, target, amount: unit.s.atk * scale, type: 'phys',
                isAttack: true, isSkill: true, tags: ['brigid:cut'],
              });
              if (left <= 0) sc.cancel();
            }, { owner: unit });
          }
          battle.after(num(sbb['attack@projectile_delay_time'], 1), () => {
            if (ctx.home()) ctx.comeBack(ctx.x, ctx.y);
          }, { owner: unit });
        },
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      // [ASSUMED] every HP-damage instance counts, including cuts and bounces, until the count equals the blackboard
      // once. Gauge fills do not. The count and the dodge reset on the next deploy.
      const need = Math.max(1, Math.floor(num(t0.trigger_damage_count)));
      const prob = num(t0.prob);
      if (prob > 0 && need > 0) {
        unit.mem.brigidHits = 0;
        battle.on('deploy', (c) => {
          if (c.unit !== unit) return;
          unit.mem.brigidHits = 0;
          battle.removeBuff(unit, 'brigid:dodge');
        }, { owner: unit });
        battle.on('damageOutput', (c) => {
          if (c.source !== unit || !up(unit) || unit.findBuff('brigid:dodge')) return;
          if (!c.dmg || c.dmg.type === 'element' || isHpLoss(c.dmg) || !(c.amount > 0)) return;
          unit.mem.brigidHits = (unit.mem.brigidHits || 0) + 1;
          if (unit.mem.brigidHits === need) {
            battle.addBuff(unit, { key: 'brigid:dodge', mods: { dodgePhys: prob }, persist: true, allowDead: true, tags: ['talent'] });
          }
        }, { owner: unit });
      }
      // LPS-X 「攻击周围8格的敌人时攻击力提升至110%」. The hidden talent repeats the trait number; apply it once.
      const near = num(tb.atk_scale);
      if (near > 1) onHitBy(battle, unit, ({ target, dmg }) => {
        if (dmg.isAttack && target && cheb(unit, target) <= 1) dmg.amount *= near;
      });
    },
  };
}

export default { char_4177_brigid: brigid };
