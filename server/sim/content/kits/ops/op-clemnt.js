// 克莱门莎 (char_4231_clemnt), 本源近卫. Official CN tables 2026-10-08 (client 2.7.81),
// PRTS 克莱门莎, 2026-10-09: all skills at ranks 4/7 and both potential-sensitive talents.
// https://prts.wiki/w/克莱门莎 . No module was released with her.
// PRTS still marks several launch-day details unknown: [ASSUMED] S2's ordinary splash radius 1.5;
// carriage's unresolved 放逐 combination = cannot walk/attack/be blocked, but remains damageable;
// its boundary clearance 0.4, carriage updates once per sim tick, vortex ends with the skill;
// S3 first bombardment at 0.5 s, then twice at 1 s intervals, launched shots survive skill end.
// These pending confirmations are listed in DESIGN §28.1; keep each assumption local to this kit.

import { num, talentBb, skillRec, up } from '../shared/tier1.js';
import { canTargetEnemy } from '../../../targeting.js';
import { bodyInKeys, hitRect } from '../../../body.js';
import { dirVec } from '../../../dir.js';
import { COLS } from '../../../constants.js';
import { hasHp } from '../../../damage.js';

const S1 = 'skchr_clemnt_1', S2 = 'skchr_clemnt_2', S3 = 'skchr_clemnt_3';
const GROUND = Object.freeze({ canHitFly: false, groundOnly: true });
const AIR = Object.freeze({ canHitFly: true });
const SPEED = 2, DISTANCE = 3, CATCH_HALF = 0.55, VORTEX_RADIUS = 1.5;
const SPLASH_RADIUS = 1.5; // [ASSUMED] PRTS has not published S2's normal attack splash radius.
const FIRST_BOMB = 0.5; // [ASSUMED] Neither PRTS nor the edited official demo settles the first landing offset.
const CAST = 'clemnt:cast', CARRY = 'clemnt:carry:';
const skillBb = (raw, id) => skillRec(raw, id)?.bb ?? {};
const tile = (u) => [Math.round(u.y), Math.round(u.x)];
const immunity = (e) => e.def?.raw?.stats?.otherImmunities ?? [];
// No current mode enemy has the three named teleport immunities. Also honour explicit normalized flags for custom data.
const cannotCarry = (e) => e.s.flags.selfBound || e.def?.immune?.has('exile') || e.def?.immune?.has('teleport')
  || immunity(e).some((s) => /teleport|transmit|exile/i.test(String(s)));

/** Cabin's 1.1 × 1.1 collision square; huge bodies use the engine hit rectangle. */
function touches(e, x, y) {
  const r = hitRect(e);
  return r ? r.x1 >= x - CATCH_HALF && r.x0 <= x + CATCH_HALF && r.y1 >= y - CATCH_HALF && r.y0 <= y + CATCH_HALF
    : Math.abs(e.x - x) <= CATCH_HALF + 1e-9 && Math.abs(e.y - y) <= CATCH_HALF + 1e-9;
}

export default {
  char_4231_clemnt: (bb, raw) => {
    const t0 = talentBb(raw, 0), t1 = talentBb(raw, 1);
    const b1 = skillBb(raw, S1), b2 = skillBb(raw, S2), b3 = skillBb(raw, S3);
    const rider = ({ battle, unit, target, dealt }, ratio) => {
      if (dealt > 0 && hasHp(target)) battle.dealDamage(unit, target, {
        amount: dealt * ratio, type: 'element', element: 'erosion', isSkill: true, tags: ['skill', 'clemnt:rider'],
      });
    };
    const freePassengers = (battle, unit) => {
      const c = unit.mem.clemntCabin;
      if (c) for (const e of c.passengers) battle.removeBuff(e, CARRY + unit.id);
      battle.removeBuff(unit, CAST);
    };
    const finishCabin = (battle, unit, c) => {
      if (c.stopped) return;
      c.stopped = true;
      freePassengers(battle, unit);
      // PRTS: vortex at the cabin's actual stopping position, radius 1.5, can hit air.
      c.tick = 0;
      battle.fx('tide', { x: c.x, y: c.y, r: VORTEX_RADIUS, dur: unit.skill.timeLeft, id: unit.id });
    };
    const startCabin = (battle, unit) => {
      const [dr, dc] = dirVec(unit.dir), [r, col] = tile(unit);
      let distance = DISTANCE;
      for (let d = 1; d <= DISTANCE + 1; d++) {
        const rr = r + dr * d, cc = col + dc * d, t = battle.grid.tile(rr, cc);
        if (!battle.grid.groundPassable(rr, cc) || t.height === 'HIGH' || t.key === 'tile_hole') {
          // [ASSUMED] PRTS's provisional rule: stop 0.4 tiles before the impassable edge.
          distance = Math.min(distance, Math.max(0, d - 0.5 - 0.4)); break;
        }
      }
      const c = unit.mem.clemntCabin = { x: col, y: r, ox: col, oy: r, dr, dc, distance, moved: 0,
        mass: num(b2['attack@max_passenger_mass'], 8), passengers: [], stopped: false, tick: 0 };
      battle.addBuff(unit, { key: CAST, duration: 10, flags: { disarm: true }, tags: ['skill'] });
      battle.fx('anchor', { x: col + dc * distance, y: r + dr * distance, fromX: col, fromY: r, id: unit.id, dur: distance / SPEED });
      if (distance <= 1e-9) finishCabin(battle, unit, c);
    };
    const tickCabin = (battle, unit, dt) => {
      const c = unit.mem.clemntCabin;
      if (!c || !up(unit)) return;
      if (!c.stopped) {
        c.moved = Math.min(c.distance, c.moved + SPEED * dt);
        c.x = c.ox + c.dc * c.moved; c.y = c.oy + c.dr * c.moved;
        // Release before either boarding limit is checked: invalid riders occupy neither a slot
        // nor weight. Return their current weight, including modifiers applied during the ride.
        for (let i = c.passengers.length - 1; i >= 0; i--) {
          const e = c.passengers[i], [er, ec] = tile(e);
          if (!e.alive || e.hidden || cannotCarry(e)
            || !battle.grid.findPath(er, ec, Math.round(c.y), Math.round(c.x))) {
            battle.removeBuff(e, CARRY + unit.id);
            c.passengers.splice(i, 1);
            c.mass += e.weight;
          }
        }
        const cap = num(b2['attack@max_passenger_cnt'], 15);
        for (const e of battle.enemies) {
          if (c.passengers.length >= cap) break;
          if (!e.alive || !e.deployed || e.hidden || e.isFlying || cannotCarry(e) || c.passengers.includes(e)
            || e.weight > c.mass + 1e-9 || !touches(e, c.x, c.y)) continue;
          const [er, ec] = tile(e);
          if (!battle.grid.findPath(er, ec, Math.round(c.y), Math.round(c.x))) continue;
          c.mass -= e.weight;
          c.passengers.push(e);
          battle._unblock(e);
          // [ASSUMED] PRTS has not yet resolved every status in 放逐; no invulnerability or hide is invented.
          battle.addBuff(e, { key: CARRY + unit.id, flags: { noMove: true, disarm: true, unblockable: true }, source: unit, tags: ['skill'] });
        }
        for (const e of c.passengers) {
          if (!e.findBuff(CARRY + unit.id)) continue;
          const fromX = e.x, fromY = e.y;
          e.x = c.x; e.y = c.y;
          if (e.route) e.route.pts = null;
          battle.fx('teleport', { x: e.x, y: e.y, fromX, fromY, id: e.id, src: unit.id });
        }
        if (c.moved >= c.distance - 1e-9) finishCabin(battle, unit, c);
        return;
      }
      const foes = battle.enemiesInRadius(c.x, c.y, VORTEX_RADIUS).filter((e) => canTargetEnemy(unit, e, AIR));
      for (const e of foes) battle.addBuff(e, { key: `clemnt:vortex:${unit.id}`, duration: 0.1,
        mods: { moveMul: 1 + num(b2['attack@move_speed'], -0.7) }, source: unit, tags: ['skill'] });
      c.tick += dt;
      if (c.tick < 1 - 1e-9) return;
      c.tick -= 1;
      for (const e of foes) {
        battle.dealDamage(unit, e, { amount: num(b2['attack@water_element'], 200), type: 'element',
          element: 'erosion', isSkill: true, canDodge: false, tags: ['skill', 'dot', 'clemnt:vortex:erosion'] });
        if (hasHp(e)) battle.dealDamage(unit, e, { amount: unit.s.atk * num(b2['attack@physical_atk_scale']),
          type: 'phys', canDodge: false, isSkill: true, tags: ['skill', 'dot', 'clemnt:vortex'] });
      }
    };
    const bombard = (battle, unit, e, m, skill) => {
      const [r, c] = tile(e), key = r * COLS + c;
      if ((m.tiles.get(key) ?? -1) > battle.time) return false;
      m.tiles.set(key, battle.time + num(b3.projectile_life_time, 5));
      const keys = new Set([[r, c], [r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]].map(([rr, cc]) => rr * COLS + cc));
      const atk = unit.s.atk;
      battle.fx('lock', { x: c, y: r, id: e.id, src: unit.id, dur: FIRST_BOMB });
      for (let n = 0; n < 3; n++) battle.after(FIRST_BOMB + n, () => {
        battle.fx('blast', { x: c, y: r, r: 1.5, id: unit.id });
        for (const t of battle.enemies) {
          if (!canTargetEnemy(unit, t, GROUND) || !bodyInKeys(t, keys)) continue;
          battle.dealDamage(unit, t, { amount: atk * num(b3.s3_atk_scale), type: 'phys', canDodge: false,
            isSkill: true, tags: ['skill', 'clemnt:bomb'] });
          if (hasHp(t)) battle.dealDamage(unit, t, { amount: atk * num(b3.ep_damage_scale), type: 'elemental', element: 'erosion',
            canDodge: false, isSkill: true, tags: ['skill', 'clemnt:bomb'] });
        }
      }, { owner: unit, holdsBattle: true });
      skill.ammoLeft--;
      battle.emit('ammoUsed', { unit, left: skill.ammoLeft, skill });
      return true;
    };
    return {
      skills: {
        [S1]: { kind: 'instant', attack: { atkScale: num(b1.atk_scale, 1),
          onHit(c) { rider(c, num(b1.ep_damage_ratio)); } } },
        [S2]: {
          kind: 'duration', mods: { aspd: num(b2.attack_speed) },
          targeting: { rangeGrid: skillRec(raw, S2)?.rangeGrid },
          attack: { atkScale: num(b2['attack@aoe_atk_scale'], 1), groundOnly: true,
            onEachHit({ battle, unit, target, kind, attackId }) {
              if (kind !== 'main' || !target) return;
              // Main victim plus at most four neighbours, never every unit in the radius.
              // [ASSUMED] Ties among splash victims follow the engine's stable spawn order.
              const near = battle.foesInRadius(target.x, target.y, SPLASH_RADIUS, true)
                .filter((e) => e !== target && canTargetEnemy(unit, e, GROUND))
                .slice(0, Math.max(0, num(b2['attack@max_target'], 5) - 1));
              for (const e of near) battle.dealDamage(unit, e, {
                amount: unit.s.atk * unit.s.atkScaleMul * num(b2['attack@aoe_atk_scale'], 1), type: 'phys',
                isAttack: true, isSplash: true, isSkill: true, attackId, tags: ['skill', 'clemnt:splash'],
              });
            } },
          onStart({ battle, unit }) { startCabin(battle, unit); },
          onTick({ battle, unit, dt }) { tickCabin(battle, unit, dt); },
          onEnd({ battle, unit }) { freePassengers(battle, unit); unit.mem.clemntCabin = null; },
        },
        [S3]: {
          kind: 'ammo', ammo: num(b3.trigger_time, 10),
          targeting: { rangeGrid: skillRec(raw, S3)?.rangeGrid, maxTargets: num(b3['attack@max_target'], 3) },
          attack: { atkScale: num(b3['attack@atk_scale'], 1), onHit(c) { rider(c, num(b3['attack@ep_damage_ratio'])); } },
          onAttack(c) { c.noAmmo = true; },
          onStart({ unit }) { unit.mem.clemntBombs = { marks: new Map(), tiles: new Map() }; },
          onTick({ battle, unit, skill }) {
            const m = unit.mem.clemntBombs;
            if (!m || !unit.canAct) return;
            const choices = [];
            for (const [e, until] of m.marks) {
              if (until < battle.time - 1e-9 || !e.alive || e.hidden) { m.marks.delete(e); continue; }
              if (canTargetEnemy(unit, e, GROUND)) choices.push(e);
            }
            const dist2 = (e) => { const dx = e.x - unit.x, dy = e.y - unit.y; return dx * dx + dy * dy; };
            choices.sort((a, b) => dist2(a) - dist2(b) || a.spawnSeq - b.spawnSeq);
            for (const e of choices) if (bombard(battle, unit, e, m, skill)) { m.marks.delete(e); break; }
            if (skill.ammoLeft <= 0) skill.end('ammo');
          },
          onEnd({ unit }) { unit.mem.clemntBombs = null; },
        },
      },
      talents: [
        { install(battle, unit) { // 生死定夺: ATK scale BEFORE DEF, per physical damage instance.
          battle.on('hit', ({ source, target, dmg }) => {
            if (source !== unit || dmg.type !== 'phys' || !target || target.side !== 'enemy') return;
            const chance = target.s.def < target.base.def ? num(t0.prob_special) : num(t0.prob_normal);
            if (battle.rng() < chance) dmg.amount *= num(t0.t1_atk_scale, 1);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 习得性防御: source tile in forward half-plane, plus every enemy she blocks.
          battle.on('hit', ({ source, target, dmg }) => {
            if (target !== unit || !source || (dmg.type !== 'phys' && dmg.type !== 'arts')) return;
            const [dr, dc] = dirVec(unit.dir), [r, c] = tile(source);
            if (source.blockedBy !== unit && (r - unit.tileR) * dr + (c - unit.tileC) * dc < 0) return;
            const sea = source.def?.tags?.includes('seamonster');
            dmg.mul *= 1 - num(sea ? t1.damage_resistance_seamonster : t1.damage_resistance_normal);
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        battle.on('elementBurst', ({ target, element }) => {
          if (element !== 'erosion' || !up(unit) || !unit.skill?.active || unit.skill.id !== S3
            || !canTargetEnemy(unit, target, GROUND)) return;
          unit.mem.clemntBombs?.marks.set(target, battle.time + num(b3.ep_break_duration, 1));
        }, { owner: unit });
      },
    };
  },
};
