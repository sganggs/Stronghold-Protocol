// The two enemy-data units used as allied summons by the 莱塔尼亚 bond.
// They need an explicit adapter: normalizeToken's TOKEN defaults would otherwise turn their arts attacks into physical
// damage and its generic two-tile grid would replace the enemy record's melee / radial attack range.

import { ATTACK_ANIM_TIME, BLOCK_RADIUS_SQ, COLS, MOVE_SCALE, ROWS } from '../../constants.js';
import { bodyDist, hitRect } from '../../body.js';
import { birthCellTargets, birthLocalTargets, canTargetEnemy } from '../../targeting.js';
import { hypot } from '../../detmath.js';

const EPS = 1e-9;
const TILE_INSET = 1e-6;
const FOUR_WAYS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Build the inline spawn options while preserving enemy-record combat values on an ally token. */
export function lethaniaSummon(id, raw) {
  const stats = raw?.stats ?? {};
  const ranged = String(raw?.applyWay).toUpperCase() === 'RANGED' && Number(stats.rangeRadius) > 0;
  const radius = Math.max(0, Number(ranged ? stats.rangeRadius : stats.rawRangeRadius) || 0);
  const moveSpeed = Math.max(0, Number(stats.moveSpeed) || 0);
  const blockCnt = Math.max(0, Number(stats.blockCnt) || 0);
  const def = {
    ...raw,
    id,
    name: raw?.name ?? id,
    profession: ranged ? 'CASTER' : 'WARRIOR',
    attackKind: ranged ? 'ranged' : 'melee',
    dmgType: stats.dmgType ?? 'arts',
    // Enemy data does not provide this selector field; the ranged record has no stated anti-air restriction.
    canHitFly: ranged,
    rangeGrid: [[0, 0]],
  };
  return {
    def,
    anySource: true,
    stats: { moveSpeed, rangeRadius: radius, blockCnt },
    kit: summonKit({ ranged, radius }),
  };
}

function summonKit({ ranged, radius }) {
  return {
    trait: {
      attack: ranged ? 'ranged' : 'melee',
      dmgType: 'arts',
      projectile: ranged ? 'bolt' : 'none',
      canHitFly: ranged,
      attackRangeRadius: radius,
      ...(ranged ? { strictAttackRange: true } : {}),
    },
    install(battle, unit) {
      unit.mem.lethaniaPursuit = true;
      unit.motion = 'GROUND';
      battle.on('tick', ({ dt }) => moveTowardTarget(battle, unit, dt), { owner: unit });
    },
  };
}

function targetableEnemies(battle, unit) {
  const out = [];
  for (const enemy of battle.enemies) if (canTargetEnemy(unit, enemy, unit.profile)) out.push(enemy);
  return out;
}

function inAttackRange(unit, enemy, x, y) {
  const radius = unit.profile.attackRangeRadius;
  const collider = enemy.hitArea ? 0 : 0.1;
  return bodyDist(enemy, x, y) <= radius + collider + EPS;
}

function assignBirthBlock(battle, unit, targets) {
  let best = null, bestD2 = Infinity;
  for (const enemy of targets) {
    const flags = enemy.s.flags;
    if (enemy.blockedBy || flags.unblockable || flags.levitate || flags.fear || flags.sleep) continue;
    const weight = enemy.blockWeight ?? 1;
    const fly = enemy.isFlying;
    if (!battle._blockerFor(unit, enemy, weight, fly)) continue;
    const dx = enemy.x - unit.x, dy = enemy.y - unit.y;
    const d2 = dx * dx + dy * dy;
    const scale = fly ? 1 + (unit.s.blockRadiusScale || 0) : 1;
    const radius2 = fly ? BLOCK_RADIUS_SQ.fly * scale * scale : BLOCK_RADIUS_SQ.ground;
    if (d2 < radius2 && d2 < bestD2) { best = enemy; bestD2 = d2; }
  }
  if (!best) return false;
  best.blockedBy = unit;
  unit.blocking.push(best);
  best.moving = false;
  if (battle._hooks.blocked) battle.emit('blocked', { blocker: unit, enemy: best });
  return true;
}

/** Capture NOTE's birth tile and initial local target set once, then assign one legally blockable unblocked target. */
export function captureLethaniaBirthMode(battle, unit) {
  unit.mem ??= {};
  const cell = { row: unit.tileR, col: unit.tileC };
  const targets = birthCellTargets(battle, unit, unit.profile, cell);
  unit.mem.lethaniaBirthCell = cell;
  unit.mem.lethaniaBirthTargetIds = targets.map((enemy) => enemy.id);
  unit.mem.lethaniaBirthMode = targets.length > 0;
  if (targets.length) assignBirthBlock(battle, unit, targets);
  return targets;
}

function attackPointInTile(unit, enemy, r, c) {
  const rect = hitRect(enemy);
  const tx = rect ? Math.max(rect.x0, Math.min(rect.x1, c)) : enemy.x;
  const ty = rect ? Math.max(rect.y0, Math.min(rect.y1, r)) : enemy.y;
  return [Math.max(c - 0.5 + TILE_INSET, Math.min(c + 0.5 - TILE_INSET, tx)),
    Math.max(r - 0.5 + TILE_INSET, Math.min(r + 0.5 - TILE_INSET, ty))];
}

function canAttackFromTile(battle, unit, enemy, r, c) {
  const [x, y] = attackPointInTile(unit, enemy, r, c);
  return inAttackRange(unit, enemy, x, y);
}

function findGroundRoute(battle, unit, goals, { idle = false } = {}) {
  const startR = unit.tileR, startC = unit.tileC;
  if (!battle.grid.groundPassable(startR, startC)) return null;
  const start = startR * COLS + startC;
  const prev = new Int16Array(ROWS * COLS).fill(-2);
  const queue = new Int16Array(ROWS * COLS);
  let head = 0, tail = 0;
  prev[start] = -1;
  queue[tail++] = start;
  let goal = -1;

  while (head < tail) { // loop-cap: each grid tile is enqueued at most once (ROWS * COLS)
    const key = queue[head++];
    const r = (key / COLS) | 0, c = key % COLS;
    if (goals.has(key)) { goal = key; break; }
    for (const [dr, dc] of FOUR_WAYS) {
      const nr = r + dr, nc = c + dc;
      if (!battle.grid.inRect(nr, nc)) continue;
      const next = nr * COLS + nc;
      if (prev[next] !== -2 || !battle.grid.groundPassable(nr, nc)) continue;
      prev[next] = key;
      queue[tail++] = next;
    }
  }
  if (goal < 0) return null;
  const reversed = [];
  for (let k = goal; k >= 0; k = prev[k]) reversed.push([(k / COLS) | 0, k % COLS]);
  reversed.reverse();
  const first = reversed[1];
  const firstAxis = first ? (first[0] !== startR ? 'y' : 'x') : null;
  return { path: reversed, target: goals.get(goal), goalKey: goal, idle, version: battle.grid.version,
    // A fractional current position moves along the first route segment before centering its cross-axis. This avoids
    // walking backward to the source-tile center before making any progress toward the target.
    index: first ? 1 : 0, firstAxis };
}

function findAttackPosition(battle, unit, targets) {
  const goals = new Map();
  const R = battle.rect;
  for (const enemy of targets) {
    const rect = hitRect(enemy);
    const radius = unit.profile.attackRangeRadius;
    const reach = radius + (rect ? 0 : 0.1);
    const ex = rect ? Math.max(Math.abs(rect.x0 - enemy.x), Math.abs(rect.x1 - enemy.x)) : 0;
    const ey = rect ? Math.max(Math.abs(rect.y0 - enemy.y), Math.abs(rect.y1 - enemy.y)) : 0;
    const c0 = Math.max(R.c0, Math.ceil(enemy.x - reach - ex - 0.5 - EPS));
    const c1 = Math.min(R.c1, Math.floor(enemy.x + reach + ex + 0.5 + EPS));
    const r0 = Math.max(R.r0, Math.ceil(enemy.y - reach - ey - 0.5 - EPS));
    const r1 = Math.min(R.r1, Math.floor(enemy.y + reach + ey + 0.5 + EPS));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (canAttackFromTile(battle, unit, enemy, r, c)) goals.set(r * COLS + c, enemy);
    }
  }
  return goals.size ? findGroundRoute(battle, unit, goals) : null;
}

function findIdleRoute(battle, unit, target) {
  const row = Math.round(target.y), col = Math.round(target.x);
  if (!battle.grid.groundPassable(row, col)) return null;
  const goal = row * COLS + col;
  return findGroundRoute(battle, unit, new Map([[goal, null]]), { idle: true });
}

/** Capture one unit's center-of-tile idle point when the visible field becomes empty. */
function updateEmptyFieldTarget(battle, unit) {
  unit.mem ??= {};
  const hasLivingEnemy = battle.enemies.some((enemy) => enemy.alive && enemy.deployed);
  if (hasLivingEnemy) {
    if (unit.mem.lethaniaEmptyInitialized && !unit.mem.lethaniaHadEnemies) {
      unit.mem.lethaniaIdleTarget = null;
      if (unit.mem.lethaniaRoute?.idle) unit.mem.lethaniaRoute = null;
    }
    unit.mem.lethaniaHadEnemies = true;
    unit.mem.lethaniaEmptyInitialized = true;
    return true;
  }
  if (unit.mem.lethaniaHadEnemies || !unit.mem.lethaniaEmptyInitialized) {
    unit.mem.lethaniaIdleTarget = { x: unit.tileC, y: unit.tileR };
    unit.mem.lethaniaHadEnemies = false;
    unit.mem.lethaniaEmptyInitialized = true;
    unit.mem.lethaniaRoute = null;
  }
  return false;
}

function canEnter(battle, r, c) { return battle.grid.groundPassable(r, c); }

function setPosition(battle, unit, x, y) {
  const r = Math.round(y), c = Math.round(x);
  if (r !== unit.tileR || c !== unit.tileC) {
    if (!canEnter(battle, r, c)) return false;
    unit.tileR = r;
    unit.tileC = c;
    unit.ground = battle.grid.isLow(r, c) && !battle._elevated?.has(r * COLS + c);
    battle._refreshRange(unit);
  }
  unit.x = x;
  unit.y = y;
  return true;
}

/** Move along a four-way ground route; friendly entities may overlap and never block this pursuer's path. */
function walkPath(battle, unit, route, dt) {
  let budget = Math.max(0, unit.s.moveSpeed) * MOVE_SCALE * Math.max(0, dt);
  let moved = false;
  let guard = ROWS * COLS + 2;
  while (budget > EPS && guard-- > 0) { // loop-cap: ROWS * COLS route tiles plus at most 2 alignment/terminal steps
    if (route.index >= route.path.length) {
      if (route.idle) break;
      if (!inAttackRange(unit, route.target, unit.x, unit.y)) {
        const [r, c] = route.path[route.path.length - 1];
        const [px, py] = attackPointInTile(unit, route.target, r, c);
        const dx = px - unit.x, dy = py - unit.y;
        const distance = hypot(dx, dy);
        if (distance <= EPS) break;
        const step = Math.min(budget, distance);
        if (setPosition(battle, unit, unit.x + dx / distance * step, unit.y + dy / distance * step)) {
          moved = true;
          budget -= step;
          continue;
        }
      }
      break;
    }
    const [ty, tx] = route.path[route.index];
    const dx = tx - unit.x, dy = ty - unit.y;
    // Follow the first grid segment before centering its cross-axis. Later waypoints are tile centers, so every turn
    // remains axis aligned and cannot cut a terrain corner.
    const stepX = route.firstAxis === 'y' && Math.abs(dy) > EPS ? 0
      : Math.abs(dx) > EPS ? dx : 0;
    const stepY = stepX === 0 ? dy : 0;
    const distance = Math.abs(stepX) + Math.abs(stepY);
    if (distance <= EPS) {
      route.index++;
      route.firstAxis = null;
      continue;
    }
    const step = Math.min(budget, distance);
    let nx = unit.x + Math.sign(stepX) * step;
    let ny = unit.y + Math.sign(stepY) * step;
    const nr = Math.round(ny), nc = Math.round(nx);
    if ((nr !== unit.tileR || nc !== unit.tileC) && !canEnter(battle, nr, nc)) {
      // Stop just inside the current tile; the next tick's BFS will route around the changed terrain.
      const boundary = stepX > 0 ? unit.tileC + 0.5 - EPS : stepX < 0 ? unit.tileC - 0.5 + EPS
        : stepY > 0 ? unit.tileR + 0.5 - EPS : unit.tileR - 0.5 + EPS;
      nx = stepX ? boundary : unit.x;
      ny = stepY ? boundary : unit.y;
      const clamped = Math.abs(nx - unit.x) + Math.abs(ny - unit.y);
      if (clamped > EPS && setPosition(battle, unit, nx, ny)) moved = true;
      break;
    }
    if (!setPosition(battle, unit, nx, ny)) break;
    moved = true;
    budget -= step;
    if (Math.abs(unit.x - tx) <= EPS && Math.abs(unit.y - ty) <= EPS) {
      route.index++;
      route.firstAxis = null;
    }
  }
  unit.moving = moved;
}

function moveTowardTarget(battle, unit, dt) {
  unit.moving = false;
  if (!unit.alive || !unit.deployed) return;
  // Record empty-field transitions before status / attack-animation gates, so a stun at that instant cannot defer
  // the captured point until after the unit has moved elsewhere.
  const hasLivingEnemy = updateEmptyFieldTarget(battle, unit);
  const birthLocal = birthLocalTargets(battle, unit, unit.profile);
  if (birthLocal) assignBirthBlock(battle, unit, birthLocal);
  if (!unit.canAct || unit.s.flags.noMove || unit.blocking.length
    || unit.s.moveSpeed <= 0 || battle.time - unit.lastAttackAt < ATTACK_ANIM_TIME - EPS) return;
  if (birthLocal) { unit.mem.lethaniaRoute = null; return; }

  const targets = targetableEnemies(battle, unit);
  if (targets.some((e) => inAttackRange(unit, e, unit.x, unit.y))) {
    unit.mem.lethaniaRoute = null;
    return;
  }

  if (!targets.length) {
    // A living but currently unselectable enemy is still on the field; hold position rather than using the idle target.
    if (hasLivingEnemy) return;
    if (!battle.grid.groundPassable(unit.tileR, unit.tileC)) return;
    const idle = unit.mem.lethaniaIdleTarget;
    if (!idle) return;
    const goalKey = Math.round(idle.y) * COLS + Math.round(idle.x);
    let route = unit.mem.lethaniaRoute;
    if (route && !route.idle) route = null;
    if (!route || !route.idle || route.goalKey !== goalKey || route.version !== battle.grid.version) route = null;
    if (route) {
      const [nr, nc] = route.path[route.index] ?? [];
      if (nr != null && (nr !== unit.tileR || nc !== unit.tileC) && !canEnter(battle, nr, nc)) route = null;
    }
    if (!route) route = findIdleRoute(battle, unit, idle);
    unit.mem.lethaniaRoute = route;
    if (route) walkPath(battle, unit, route, dt);
    return;
  }

  // [ASSUMED] Choose the shortest four-way ground path to any currently selectable enemy; normal target priority
  // applies once in range. Friendly units and other Leithania summons are not path obstacles.
  let route = unit.mem.lethaniaRoute;
  if (route && (route.idle || !targets.includes(route.target) || route.version !== battle.grid.version
    || !canAttackFromTile(battle, unit, route.target, route.path[route.path.length - 1][0], route.path[route.path.length - 1][1]))) route = null;
  if (route) {
    const [nr, nc] = route.path[route.index] ?? [];
    if (nr != null && (nr !== unit.tileR || nc !== unit.tileC) && !canEnter(battle, nr, nc)) route = null;
  }
  if (!route) route = findAttackPosition(battle, unit, targets);
  unit.mem.lethaniaRoute = route;
  if (route) walkPath(battle, unit, route, dt);
}
