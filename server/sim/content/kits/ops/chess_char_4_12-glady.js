// server/sim/content/kits/ops/chess_char_4_12-glady.js — 歌蕾蒂娅 (char_474_glady) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { bodyDist } from '../../../body.js';
import {
  AURA, num, tbb, moduleBb, grid, batFlat, enemyHasTag, targetsInRange, whileDeployed, pulse, alt, instantKind,
  pullToFront, withDefaults,
} from '../shared/tier4.js';

const ABYSSAL = new Set(['char_143_ghost', 'char_263_skadi', 'char_474_glady', 'char_4145_ulpia', 'char_1023_ghost2']);
const isAbyssal = (u) => u?.def?.raw?.groupId === 'abyssal' || ABYSSAL.has(u?.def?.charId ?? u?.def?.raw?.charId);

export default withDefaults({
  // ===== 歌蕾蒂娅 (hookmaster) S3 缺水的碎漩狂舞 — bind a far target, tornado: slow, 85 % arts pulses + pull, final pull
  //       S1 缺水的大洋裂断 (charges: next attack pulls the target to her front, 150 %/180 %); S2 缺水的掌握怒海 (BAT +0.5 s,
  //       wider range, ≤ 2 targets — blocked first — at 135 %/150 % and pulled to her front); module HOK-Y (淡金坠饰):
  //       a pull towards herself of an enemy farther than 2.5 tiles is one force level stronger
  chess_char_4_12_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1), mb = moduleBb(def);
    const tb = def.traitBb || {};
    const R = 1.5; // PRTS: tornado radius; the final net has radius 1 instead.
    const force = num(bb.force, num(bb['attack@force'], 0));
    const iv = Math.max(0.1, num(bb.interval, 1.5));
    const g = grid(def.skill?.rangeGrid);
    const dragDmg = (battle, unit, e, moved) => { // module: dragged enemies take arts damage ∝ distance
      if (!(moved > 0) || !(num(tb.value, 0) > 0) || !e.alive) return;
      battle.dealDamage(unit, e, { amount: num(tb.value) * moved / Math.max(1e-6, num(tb.dist, 1)), type: 'arts', isSkill: true, tags: ['drag'] });
    };
    // module HOK-Y: "向自身拖拽较远的敌人时力度提升一个等级"
    const farR = num(mb['skill@range_radius'], num(mb['attack@range_radius'], 0)), farF = num(mb['skill@delta_force'], num(mb['attack@delta_force'], 0));
    const selfForce = (unit, e, f) => (farR > 0 && farF > 0 && Math.hypot(e.x - unit.x, e.y - unit.y) > farR + 1e-9 ? f + farF : f);
    const pullSelf = (battle, unit, e, f) => { if (e && e.alive) dragDmg(battle, unit, e, pullToFront(battle, unit, e, selfForce(unit, e, f))); };
    return {
      skills: alt(def, {
        skchr_glady_1: () => ({
          kind: instantKind(def),
          attack: { atkScale: num(bb.atk_scale, 1.5), onHit({ battle, unit, target }) { pullSelf(battle, unit, target, num(bb.force, 1)); } },
        }),
        skchr_glady_2: () => ({
          kind: 'duration',
          mods: { batPct: batFlat(def, bb.base_attack_time) },
          // (target sorting already puts the enemies she blocks first)
          targeting: { ...(g ? { rangeGrid: g } : {}), maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 2))) },
          attack: { atkScale: num(bb['attack@atk_scale'], 1.35), onEachHit({ battle, unit, target }) { pullSelf(battle, unit, target, num(bb['attack@force'], 1)); } },
          onStart({ battle, unit }) { battle.fx('wake', { x: unit.x, y: unit.y, id: unit.id }); },
        }),
      }),
      skill: {
        kind: 'duration',
        onStart({ battle, unit, skill }) {
          const foes = targetsInRange(battle, unit).sort((a, b) => bodyDist(b, unit.x, unit.y) - bodyDist(a, unit.x, unit.y) || a.id - b.id);
          const t = foes[0];
          unit.mem.tornado = t ? { x: t.x, y: t.y, acc: 0 } : null;
          if (!t) return;
          battle.applyStatus(t, 'bind', { duration: skill.duration, source: unit });
          battle.fx('tornado', { x: t.x, y: t.y, id: unit.id, r: R, duration: skill.duration });
        },
        onTick({ battle, unit, dt }) {
          const T = unit.mem.tornado;
          if (!T) return;
          const inside = battle.foesInRadius(T.x, T.y, R);
          for (const e of inside) pulse(battle, e, `glady:slow:${unit.id}`, { moveMul: Math.max(0, 1 + num(bb.move_speed, -0.5)) });
          T.acc += dt;
          if (T.acc + 1e-9 < iv) return;
          T.acc -= iv;
          for (const e of inside) {
            if (!e.alive || e.s.flags.untargetable) continue;
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 0.85), type: 'arts', isSkill: true, tags: ['skill', 'tornado'] });
            // "小力地拖拽至中心": a pull to the marked point (PRTS 推与拉: its 6 tornado pulls stop 0.05 from it)
            if (e.alive) dragDmg(battle, unit, e, battle.pull(e, force, { to: T, stop: 0.05 }));
          }
          battle.fx('tornadoPulse', { x: T.x, y: T.y, id: unit.id, r: R });
        },
        onEnd({ battle, unit, reason }) {
          const T = unit.mem.tornado;
          unit.mem.tornado = null;
          if (!T || reason === 'death' || !unit.alive) return;
          for (const e of battle.foesInRadius(T.x, T.y, 1)) pullSelf(battle, unit, e, force);
          battle.fx('pull', { x: T.x, y: T.y, id: unit.id });
        },
      },
      talents: [
        { install(battle, unit) { // 阿戈尔的波涛: 深海猎人 regen 2.5 %/s, −25 % phys/arts damage from 海怪
          whileDeployed(battle, unit, AURA, () => {
            for (const a of battle.allies(unit.ownerId)) if (isAbyssal(a)) pulse(battle, a, 'glady:tide', { hpRegenRatio: num(t0.hp_recovery_per_sec_by_max_hp_ratio, 0.025) });
          });
          battle.on('hit', (c) => {
            if (!c.target.findBuff?.('glady:tide') || !enemyHasTag(c.source, 'seamonster') || (c.dmg.type !== 'phys' && c.dmg.type !== 'arts')) return;
            c.dmg.mul *= 1 - num(t0.damage_resistance, 0.25);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 弱肉强食: ×1.3 against enemies of weight ≤ 3
          battle.on('hit', (c) => {
            if (c.source === unit && c.dmg.isAttack && c.target.side === 'enemy' && c.target.s.massLevel <= num(t1.value, 3)) c.dmg.mul *= num(t1.atk_scale, 1.3);
          }, { owner: unit });
        } },
      ],
    };
  },
});
