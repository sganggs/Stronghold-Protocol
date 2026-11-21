// MAP10's enemy-side default entity. PRTS 盐坨子炮 + official trap_196_cnnon / projectile_trap_cnnon_small.
// The stage owns its placement, SP and unload route; wave enemy multipliers and kill/LP counters do not apply.
import { Unit } from '../units.js';
import { unitInfo } from '../snapshot.js';
import { compileRoute } from '../ai.js';
import { DIR_VEC, normDir } from '../dir.js';
import { hypot } from '../detmath.js';
import { canTargetEnemy, areaSelectable } from '../targeting.js';

export const SALT_CANNON = 'trap_196_cnnon';
// Client: Eat radius 1.0 + enemy collision radius 0.1, max weight 3, cap 1; x-4 is a 3×3 grid, speed 5.
const BOARD_RADIUS = 1.1,
  MAX_WEIGHT = 3,
  BLAST_RADIUS = 1.5,
  SHOT_SPEED = 5,
  RELEASE_HALF = 0.2,
  REBOARD_DELAY = 0.1;
const IMMUNE = new Set(['stun', 'cold', 'frozen', 'levitate', 'silence', 'sleep', 'dying']);

function release(b, c, passenger, x, y) {
  if (!passenger || passenger.mem.carrier !== c) return;
  delete passenger.mem.carrier;
  if (c.mem.saltCannon.passenger === passenger) c.mem.saltCannon.passenger = null;
  if (!passenger.alive) return;
  passenger.x = x + b.rng.range(-RELEASE_HALF, RELEASE_HALF);
  passenger.y = y + b.rng.range(-RELEASE_HALF, RELEASE_HALF);
  b._clampPos(passenger);
  const route = c.mem.saltCannon.data.route;
  if (route)
    passenger.route = {
      legs: compileRoute(route, b.rect),
      legIdx: 0,
      pts: null,
      ptIdx: 0,
      suffix: null,
      version: -1,
      waitLeft: null,
    };
  passenger.swing = false;
  // [ASSUMED] Releasing onto a new route clears the previous displacement's unbalance.
  passenger.unbalanceUntil = -Infinity;
  b._cutAttackStand(passenger);
  passenger.mem.cannonBoardAfter = b.time + REBOARD_DELAY;
  b._setHidden(passenger, false);
  // Client sailor_t[move_speed_up]: the release marker grants a FINAL_SCALER, not an additive speed bonus.
  if (passenger.defId === 'enemy_10043_sailor') {
    const bb = passenger.def?.raw?.talents?.bb;
    const speed = bb?.['MoveSpeedUp.move_speed'],
      duration = bb?.['MoveSpeedUp.speed_up_duration'];
    if (speed > 0 && duration > 0) b.addBuff(passenger, { key: 'ab:sailorCannon', duration, mods: { moveMul: speed } });
  }
}

function fire(b, c) {
  const st = c.mem.saltCannon,
    to = st.to,
    passenger = st.passenger;
  const flight = { projectile: null, passenger, final: st.dying, done: false };
  const finish = cancelled => {
    if (flight.done) return;
    flight.done = true;
    st.flights.delete(flight);
    if (cancelled) {
      // Only *_death projectiles have DurBusAbilityKillPassengers (_ev 4).
      // [ASSUMED] An ordinary cancelled shot leaves Eat's passenger in the cannon for its next shot.
      if (flight.final && passenger?.alive && passenger.mem.carrier === c) {
        delete passenger.mem.carrier;
        b.kill(passenger, null);
        st.passenger = null;
      }
    } else {
      // A fixed-point splash selects all motions and ignores camouflage; stealth/untargetable still exclude.
      // [ASSUMED] Our devices stay out: the shell's professionMask 1023 also has the TOKEN / TRAP bits (op-closur 767 has no
      // TRAP), but areaSelectable leaves `kind === 'device'` allies out, as for every other area hit.
      const targets = [];
      for (const a of b.allyUnits)
        if (
          areaSelectable(c, a) &&
          Math.abs(a.tileC - Math.round(to.x)) <= 1 &&
          Math.abs(a.tileR - Math.round(to.y)) <= 1
        ) {
          targets.push(a.id);
          b.dealDamage({
            source: c,
            target: a,
            amount: c.s.atk,
            type: 'phys',
            isSkill: true,
            tags: ['saltCannon', 'splash'],
          });
        }
      release(b, c, passenger, to.x, to.y);
      b.fx('saltCannonHit', { id: c.id, x: to.x, y: to.y, r: BLAST_RADIUS, targets });
    }
    if (flight.final && c.alive) b.kill(c, null);
  };
  flight.projectile = b.addProjectile({
    from: c,
    to,
    speed: SHOT_SPEED,
    source: c,
    visual: 'saltCannon',
    onHit: () => finish(false),
  });
  st.flights.add(flight);
  // Existing projectile-removal abilities can remove a point shot. Observe that on the next tick, as enemy kits do.
  flight.cancel = () => finish(true);
  const duration = hypot(c.x - to.x, c.y - to.y) / SHOT_SPEED;
  b.fx('saltCannonShot', { id: c.id, x: to.x, y: to.y, fromX: c.x, fromY: c.y, t: duration, r: BLAST_RADIUS });
}

function spawn(b, d) {
  const raw = d.raw ?? d,
    data = raw.cannon;
  if (!data?.route || !(data.spCost > 0) || !(data.spRecovery > 0)) return null;
  const [dr, dc] = DIR_VEC[normDir(d.dir)],
    to = { x: d.col + dc * data.distance, y: d.row + dr * data.distance };
  if (!b.grid.inRect(to.y, to.x)) return null; // the map stores every phase/half; only this field's cannons act
  const stats = raw.stats;
  if (!stats || !(stats.maxHp > 0)) return null;
  const c = new Unit({
    id: ++b._idSeq,
    side: 'enemy',
    kind: 'device',
    defId: SALT_CANNON,
    name: d.name,
    def: { id: SALT_CANNON, name: d.name, immune: IMMUNE, spine: SALT_CANNON },
    x: d.col,
    y: d.row,
    dir: d.dir,
    motion: 'WALK',
    base: { ...stats, tauntLevel: -1, moveSpeed: 0, spRecovery: data.spRecovery },
  });
  c.alive = c.deployed = true;
  c.counted = c.inTotal = false;
  c.spawnSeq = ++b._spawnSeq;
  c.deploySeq = ++b._deploySeq;
  c.deployedAt = b.time;
  c.profile = { noAttack: true, maxTargets: 0 };
  c.lpr = 0;
  c.mem.noLeak = true;
  c.mem.fixedDeviceTile = [d.row, d.col];
  c.mem.saltCannon = {
    data,
    to,
    sp: Math.max(0, data.initSp),
    passenger: null,
    flights: new Set(),
    floor: false,
    dying: false,
  };
  b.addBuff(c, {
    key: 'device:saltCannon',
    persist: true,
    flags: { noMove: true, unblockable: true, noDisplace: true },
  });
  // This trap rewrites its tile to impassable. Its normal positions lie on the separator outside the road rect.
  if (b.grid.inRect(d.row, d.col)) b.grid.setObstacle(d.row, d.col, true, 'block');
  b.units.push(c);
  b.enemies.push(c);
  b._ev(['spawn', unitInfo(c)]);
  return c;
}

export function installSaltCannons(b, active) {
  if (!(b.stage.devices || []).some(d => d.key === SALT_CANNON)) return;
  const cannons = [];
  b.on(
    'battleStart',
    () => {
      if (b.opts.devices === false) return;
      for (const d of b.stage.devices || [])
        if (d.key === SALT_CANNON && active(d)) {
          const c = spawn(b, d);
          if (c) cannons.push(c);
        }
    },
    { priority: 50 },
  );
  b.on('tick', ({ dt }) => {
    for (const c of cannons) {
      const st = c.mem.saltCannon;
      for (const flight of st.flights)
        if (!flight.done && !b.projectiles.list.includes(flight.projectile)) flight.cancel();
      if (!c.alive) continue;
      if (st.passenger && (!st.passenger.alive || st.passenger.mem.carrier !== c)) st.passenger = null;
      if (st.passenger) {
        st.passenger.x = c.x;
        st.passenger.y = c.y;
        st.passenger.moving = false;
      }
      if (st.dying || c.hidden || c.s.flags.stun || c.s.flags.freeze || c.s.flags.sleep || c.s.flags.levitate) continue;
      if (!st.passenger && !(c.unbalanceUntil > b.time)) {
        // [ASSUMED] Stable spawn order breaks ties; generic selection also excludes sleeping passengers.
        const p = b.enemies.find(
          e =>
            e.kind === 'enemy' &&
            e !== c &&
            !e.mem.carrier &&
            !e.isFlying &&
            e.weight <= MAX_WEIGHT &&
            !(e.mem.cannonBoardAfter > b.time + 1e-9) &&
            canTargetEnemy(null, e) &&
            hypot(e.x - c.x, e.y - c.y) <= BOARD_RADIUS + 1e-9,
        );
        if (p) {
          st.passenger = p;
          p.mem.carrier = c;
          p.swing = false;
          b._cutAttackStand(p);
          b._setHidden(p, true);
        }
      }
      if (!c.s.flags.noSp) st.sp += dt * c.s.spRecovery;
      if (st.sp + 1e-9 >= st.data.spCost) {
        st.sp = 0;
        fire(b, c);
      }
    }
  });
  b.on('hpChanged', ({ target }) => {
    const st = target?.mem.saltCannon;
    if (st) st.floor = target.hp <= 1;
  });
  b.on('beforeStatus', ctx => {
    // Cold itself has no generic immunity key in STATUS; this native trap explicitly has cold immunity.
    if (ctx.target?.mem.saltCannon && ctx.status === 'cold') ctx.cancel = true;
  });
  b.on(
    'fatal',
    ctx => {
      const c = ctx.unit,
        st = c?.mem.saltCannon;
      if (!st) return;
      if (!st.floor) {
        st.floor = true;
        ctx.prevented = true;
        c.hp = 1;
        return;
      }
      ctx.prevented = true;
      c.hp = 1;
      if (!st.passenger?.alive || st.passenger.mem.carrier !== c) {
        // cnnon_t[death] performs InstantKill from the cannon's own buff, without operator kill credit.
        b.kill(c, null);
        return;
      }
      if (st.dying) return;
      st.dying = true;
      b.addBuff(c, { key: 'device:saltCannon:dying', persist: true, flags: { untargetable: true } });
      fire(b, c);
    },
    { priority: 100 },
  );
  b.on('death', ({ unit }) => {
    const st = unit?.mem.saltCannon;
    if (!st) return;
    if (b.grid.inRect(unit.tileR, unit.tileC)) b.grid.setObstacle(unit.tileR, unit.tileC, false, 'block');
    // A forced removal still unloads as a carrier; the normal loaded destruction waits for its own projectile.
    release(b, unit, st.passenger, unit.x, unit.y);
  });
}
