// Shared 载客 for 伊利昂的木驮兽 (enemy_10159_mntrjn) and “越长尘” (enemy_1302_ymtro_2).
// PRTS 天赋&能力, checked 2026-10-14: both take non-leader, non-machine ground enemies inside radius 0.5
// (载客半径; not a blackboard key). No faction, weight or elite restriction.
// 木驮兽: cap bus.max_cnt (5), each passenger adds bus.move_speed (−0.2) to a single moveMul, then an absolute
// 0.1 floor (移动速度存在 0.1 数值下限). Unload scatters inside a 0.4-side square (±0.2) and replaces the
// passenger's route with the carrier's remaining route.
// “越长尘”: cap Bus.max_cnt (4). Unload is the centre of the carrier's tile.
// bus.half_cnt (木驮兽 blackboard 2) is the PRTS model swap (已载客 ≥2, and again at the cap). The client draws
// the default skin (docs/ASSETS.md); no snapshot field selects a Spine skin, so the key is not applied.
// Shipped stages have no 云梯 (data/stages.json, data/waves.json). “首次到达云梯时释放” and the permanent
// pickup disable after that first ladder are not implemented; nothing is invented in their place.
// Removal (kill or leak, both emit `death`) unloads. Timeout does not emit `death`: each living unit, hidden
// passengers included, is counted once by Battle._timeout and is not unloaded into a second leak.

import { hypot } from '../../detmath.js';
import { canCast, T } from './helpers.js';

const BOARD_RADIUS = 0.5;
/** Half-width of the camel's 0.4-side unload square. `rng.range` is [a, b), so the far edge is not a possible value. */
const UNLOAD_HALF = 0.2;
const CAMEL_SPEED_FLOOR = 0.1;

function resetRoute(e, legs) {
  e.route = {
    legs: legs.map((leg) => ({ ...leg })),
    legIdx: 0, pts: null, ptIdx: 0, suffix: null, version: -1, waitLeft: null,
  };
}

function isLeader(p) {
  return !!(p.isBoss || (p.def && p.def.rank === 'BOSS'));
}

function isMachine(p) {
  const tags = p.def && p.def.tags;
  return Array.isArray(tags) && tags.includes('machine');
}

/**
 * Who may board. Hidden passengers cannot. Other control on the passenger does not stop boarding — PRTS 载客条件
 * names only 非领袖、非机械、地面. [ASSUMED] A stunned, frozen, sleeping, levitated, unbalanced or feared passenger
 * still boards. Fear, silence, cold and 诱导 are not in the carrier's stop list either (that list is hidden,
 * 失衡, stun, freeze, sleep, 浮空 — checked against these flag names).
 */
function canBoard(e, p) {
  if (p === e || !p.alive || !p.deployed || p.hidden || p.mem.carrier) return false;
  if (isLeader(p) || isMachine(p) || p.motion === 'FLY') return false;
  return hypot(p.x - e.x, p.y - e.y) <= BOARD_RADIUS + 1e-9;
}

function unload(b, e, a) {
  const list = a.passengers;
  for (const p of list) {
    if (p.mem.carrier === e) delete p.mem.carrier;
    if (!p.alive) continue;
    if (a.camel) {
      // Boarding order, x then y. The battle's existing stream only — no Math.random.
      p.x = e.x + b.rng.range(-UNLOAD_HALF, UNLOAD_HALF);
      p.y = e.y + b.rng.range(-UNLOAD_HALF, UNLOAD_HALF);
    } else {
      p.x = Math.round(e.x);
      p.y = Math.round(e.y);
    }
    b._clampPos(p);
    // The camel replaces the path with its own remaining path (PRTS 卸客时路径替换为自身剩余路径).
    // [ASSUMED] “越长尘” keeps the passenger's own remaining path: PRTS names no replacement for this variant.
    const r = (a.camel ? e.route : p.route) || { legs: [], legIdx: 0 };
    const legs = r.legs || [];
    let i = Number.isInteger(r.legIdx) ? r.legIdx : 0;
    // [ASSUMED] Skip the in-progress checkpoint wait. “剩余路径” does not say that wait is replayed.
    if (legs[i] && legs[i].t === 'wait') i++;
    resetRoute(p, legs.slice(i));
    p.swing = false;
    p.atkStandUntil = -Infinity;
    b._setHidden(p, false);
  }
  a.passengers = [];
  a.seats = 0;
}

/**
 * One passenger bus. `camel` selects the 木驮兽 rules (speed, square unload, route replacement).
 * Hiding is the presentation and the untargetable rule (snapshot omits `hidden`; targeting skips it).
 * [ASSUMED] A carried passenger also takes no new damage, because the attack/ pipeline returns 0 for `hidden` — not only
 * because nothing selects it. Identity, bounty and HP already lost stay on the unit.
 */
export function passengerBus(ab, camel = false) {
  const max = T(ab, camel ? 'bus.max_cnt' : 'Bus.max_cnt', 'bus.max_cnt', 'Bus.max_cnt') ?? (camel ? 5 : 4);
  const speed = T(ab, 'bus.move_speed') ?? -0.2;
  return {
    camel,
    passengers: [],
    seats: 0,
    spawn(b, e) {
      if (camel) {
        e.mem.moveSpeedFloor = CAMEL_SPEED_FLOOR;
        e.markDirty();
      }
    },
    tick(b, e, a) {
      // A carried enemy can still be removed by something that does not check `hidden`. It frees the seat.
      a.passengers = a.passengers.filter((p) => {
        if (p.alive && p.mem.carrier === e) return true;
        if (p.mem.carrier === e) delete p.mem.carrier;
        return false;
      });
      // canCast already refuses hidden, stun (also set for freeze / sleep / 浮空) and 失衡. The flag checks stay
      // so a later change to that stun aggregate cannot start pickup during freeze, sleep or 浮空. Silence does not.
      const picking = canCast(e, false, b) && !e.s.flags.freeze && !e.s.flags.sleep && !e.s.flags.levitate;
      if (picking) {
        // [ASSUMED] Overflow boards in stable spawn order (`b.enemies`). PRTS names no priority.
        for (const p of b.enemies) {
          if (a.passengers.length >= max) break;
          if (!canBoard(e, p)) continue;
          p.mem.carrier = e;
          p.swing = false;
          b._cutAttackStand(p);
          b._setHidden(p, true);
          a.passengers.push(p);
        }
      }
      for (const p of a.passengers) {
        p.x = e.x;
        p.y = e.y;
        p.moving = false;
      }
      if (camel && a.seats !== a.passengers.length) {
        a.seats = a.passengers.length;
        // One replaced buff, so the cuts add: mul = max(0, 1 + n·bus.move_speed), not 0.8^n.
        // At 0 passengers the factor is 1 (no slow). The 0.1 floor is mem.moveSpeedFloor, after every other mul.
        b.addBuff(e, {
          key: 'ab:busSpeed', persist: true,
          mods: { moveMul: Math.max(0, 1 + speed * a.seats) },
        });
      }
    },
    death(c, b, e, a) { unload(b, e, a); },
  };
}
