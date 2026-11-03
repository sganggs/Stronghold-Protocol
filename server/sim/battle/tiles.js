// server/sim/battle/tiles.js — Battle methods: field tiles: obstacles, relocation and 【移动】, knocked-out operators'
// bodies (isDown, downOn, restTile, _layBody) and the tiles no automatic placement may take, tactical points and the
// enemies' ground paths.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { ROWS, COLS, DOWN_STATE } from '../constants.js';
import { localOrder, localBefore } from '../dir.js';

export class BattleTiles {
  /** Toggle a ground obstacle (enemies re-read their flow field). `kind` 'block' (default, impassable) | 'crate'. */
  setObstacle(r, c, on, kind = 'block') { this.grid.setObstacle(r, c, on, kind); }

  /** Move an ally to another tile (keeps state); never onto a living unit or a knocked-out operator (downOn). */
  relocate(unit, r, c) {
    // only a living, deployed ally moves, and only onto an integer tile of this field (a dead unit left in _occ
    // would later "block" from a tile it no longer stands on once it redeploys at home)
    if (!unit || unit.side !== 'ally' || !unit.alive || !unit.deployed) return false;
    if (!Number.isInteger(r) || !Number.isInteger(c) || !this.grid.inRect(r, c)) return false;
    const k = r * COLS + c;
    if (this._occ[k] && this._occ[k] !== unit && this._occ[k].alive) return false;
    if (this.downOn(r, c)) return false;
    const ok = unit.tileR * COLS + unit.tileC;
    if (this._occ[ok] === unit) this._occ[ok] = null;
    this.releaseBlocked(unit);
    if (unit.obstacle) this.grid.setObstacle(unit.tileR, unit.tileC, false, unit.obstacleKind);
    unit.tileR = r; unit.tileC = c; unit.x = c; unit.y = r;
    unit.ground = this.grid.isLow(r, c) && !this._elevated?.has(k);
    this._occ[k] = unit;
    if (unit.obstacle) this.grid.setObstacle(r, c, true, unit.obstacleKind);
    this._refreshRange(unit); // current + base range, CUSTOM_RANGE trigger keys
    return true;
  }

  /**
   * 【移动】 (PRTS 术语释义 移动: "不退场，以当前血量在目标位置部署 … 本质上为一次特殊的撤退-再部署行为"): `unit` leaves its
   * tile (relocate: same checks, false = refused, nothing changed) and is deployed on (r, c) at once. A new deployment —
   * deploySeq / aggroSeq / deployedAt (the deploy animation; once-per-deployment effects re-arm) — announced by
   * `deploy` { initial: false, move: true }: deploy effects fire again ("可以通过移动行为多次触发部署时触发的效果"). Not an
   * exit: no `die` / `death`, so no knock-out, no redeploy timer or cost ("因移动撤退时不会积累再部署惩罚") — 不屈 and
   * 阿戈尔's revive, which act on exits "因移动之外的原因" (PRTS 阿戈尔 备注), never see it. HP, buffs and a running skill
   * stay: officially nothing carries over but what the mover's skill names (乌尔比安 S3: 技能进度 and the second talent's
   * stacks); the remake keeps the rest too (owner's deviation, DESIGN §22.3). `clearSp`: the 技力 is emptied before the
   * deploy handlers run ("部署时将清空技力"; 乌尔比安's 【返回】 "将清空技力，但仍可以享受后续由其他效果提供的技力").
   */
  moveRedeploy(unit, r, c, { clearSp = false } = {}) {
    if (!this.relocate(unit, r, c)) return false;
    // #903: a 【移动】 is a retreat and redeploy (PRTS 术语释义「移动」), so the element gauges reset like a real deployment
    // (deploy.js) and an element burst's lock goes with them; the other buffs stay (DESIGN §22.3)
    for (const b of unit.buffs.filter((x) => x.flags && x.flags.burstLock)) this.removeBuff(unit, b);
    unit.elem.burn = unit.elem.neural = unit.elem.necrosis = unit.elem.apoptosis = unit.elem.erosion = 0;
    unit.markDirty();
    unit.deploySeq = ++this._deploySeq;
    unit.aggroSeq = unit.deploySeq;
    unit.deployedAt = this.time;
    const sk = unit.skill;
    if (clearSp && sk && !sk.noSkill && sk.kind !== 'passive' && !(sk.active && sk.isTimed)) {
      sk.sp = 0;
      sk.charges = sk.spCost <= 0 ? sk.maxCharges : 0; // (a free skill is available once per deployment: skills.js reset)
    }
    this._ev(['deploy', unit.id]);
    if (this._hooks.deploy) this.emit('deploy', { unit, initial: false, move: true });
    return true;
  }

  /**
   * A tile no automatic placement may take (the 突袭 landing tile, tactical points, summon / device tiles): a living
   * unit stands on it, or it is the rest tile (restTile) of an ally piece that has not deployed yet or waits to
   * redeploy — the tile a knocked-out operator lies on ("倒地干员所在地块…所有我方单位在此处的部署行为将被阻止", PRTS
   * 卫戍协议/帮助 §作战阶段 单位部署), else its home tile (a token parked there would keep that unit off the field).
   */
  isReservedTile(r, c) {
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= ROWS || c < 0 || c >= COLS) return true;
    const u = this._occ[r * COLS + c];
    if (u && u.alive) return true;
    for (const a of this.allyUnits) {
      if (a.alive || a.removed || (a.kind !== 'op' && a.kind !== 'token')) continue;
      const [tr, tc] = this.restTile(a);
      if (tr === r && tc === c) return true;
    }
    return false;
  }

  /**
   * The knocked-out operator (isDown) lying on (r, c), other than `except`, or null. Official (PRTS 卫戍协议/帮助 §作战阶段
   * 单位部署): "干员退场后…原地留下一个“倒地干员”…满足再部署条件时，移除场上的该倒地干员并自动部署至该位置" and "倒地干员所在
   * 地块视为可部署，但所有我方单位在此处的部署行为将被阻止" — its tile (`body`, _layBody) takes no other ally: `_deploy`
   * (initial deploys, redeploys, the 突袭 landing, summons), `spawnDevice` and `relocate` refuse it.
   */
  downOn(r, c, except = null) {
    for (const a of this.allyUnits) {
      if (a === except || !this.isDown(a)) continue;
      const [br, bc] = a.body ?? [a.tileR, a.tileC];
      if (br === r && bc === c) return a;
    }
    return null;
  }

  /**
   * The tile a withdrawn ally comes back on (redeploy, _checkRedeploys): a down operator's body tile (isDown) — where it
   * fell, or its home (_layBody) — else its home tile.
   */
  restTile(u) {
    return this.isDown(u) ? (u.body ? [u.body[0], u.body[1]] : [u.tileR, u.tileC]) : [u.homeR, u.homeC];
  }

  /**
   * Where a knocked-out operator lies (it redeploys there): the tile it fell on, except — "若干员被击倒的位置为其他干员或
   * 召唤物的初始位置，则在被击倒后，尝试返回其自身的初始位置" (PRTS 卫戍协议/帮助) — a tile that is another board piece's
   * home (a piece with a board uid: the 初始位置 is the prep placement — whether that piece is on the field, waiting or
   * gone: a summon only leaves its home free once it has expired or been killed, so a removed one must count too), where
   * it goes back to its own home tile when that is in the rect and free (isReservedTile: no living unit, no other body,
   * no other waiting piece's tile). It stays where it fell when its home is taken [ASSUMED: one attempt, at the
   * knock-out]. Only an operator moved off its board tile — a 突袭 jump, 乌尔比安's anchor — can fall elsewhere. One
   * deliberate deviation, the owner's decision of 2026-10-07 (community report 28): a unit whose content holds
   * `downAtHome` — 乌尔比安 moved by his S3 (kits/ops/chess_char_5_05-ulpia.js) — goes back to its home tile, its
   * deployment tile, wherever it fell (that home taken: where it fell, as above). Sets `u.body` (b.snap `down` carries
   * it); x / y / tileR / tileC keep where it fell, so the `kill` / `death` handlers (被击倒时 effects) still act there.
   */
  _layBody(u) {
    const r = u.tileR, c = u.tileC, hr = u.homeR, hc = u.homeC;
    u.body = [r, c];
    if (r === hr && c === hc) return;
    if (!u.downAtHome && !this.allyUnits.some((a) => a !== u && a.uid != null && (a.kind === 'op' || a.kind === 'token') && a.homeR === r && a.homeC === c)) return;
    if (!this.grid.inRect(hr, hc) || this.isReservedTile(hr, hc)) return;
    u.body = [hr, hc];
  }

  /**
   * Tactical point (战术点) for tactician reinforcements: a free (isReservedTile) walkable ground tile of the unit's
   * initial range (baseRangeKeys), on an enemy ground path first (groundPathTiles — where a player would put the
   * blocker), then nearest to the unit (Chebyshev; the smaller sideways offset — in the unit's facing-RIGHT frame, so
   * its forward line — breaks ties), then the lowest local (row, col) offset (sim/dir.js localOrder: for a RIGHT-facing
   * unit exactly the lowest tile key). The choice turns with the unit's direction. null when none.
   */
  findTacticalPoint(unit) {
    if (!unit) return null;
    const onPath = this.groundPathTiles();
    let best = null, bp = 2, bd = Infinity, bo = null;
    for (const k of unit.baseRangeKeys || unit.rangeKeys || []) {
      const r = (k / COLS) | 0, c = k % COLS;
      if (!this.grid.groundPassable(r, c) || !this.grid.canStand(r, c)) continue;
      if (this.isReservedTile(r, c)) continue;
      const o = localOrder(r - unit.tileR, c - unit.tileC, unit.dir);
      const d = Math.max(Math.abs(r - unit.tileR), Math.abs(c - unit.tileC)) + 0.01 * Math.abs(o[0]);
      if (!(d > 0)) continue;
      const p = onPath.has(k) ? 0 : 1;
      if (p < bp || (p === bp && (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && localBefore(o, bo))))) { bp = p; bd = d; bo = o; best = [r, c]; }
    }
    return best;
  }

  /**
   * Ground tiles the enemies of this field walk on: the flow-field routes (grid.findPath, live obstacles) of the
   * non-FLY routes this battle's wave spawns on (every non-FLY route when no queued spawn names one — e.g. content-only
   * battles), leg by leg (start → MOVE/APPEAR checkpoints → end, clamped to the rect). R1–R3 spawn at the lower gate
   * only (research 08 §4.1), so the unused upper lane does not attract tactical points. Set of tile keys, cached per
   * grid version.
   */
  groundPathTiles() {
    const ver = this.grid.version ?? 0;
    const used = (this._pathRoutesUsed ??= new Set());
    const before = used.size;
    for (const p of this._pending || []) if (!p.route && Number.isInteger(p.routeIndex)) used.add(p.routeIndex);
    if (this._pathTiles && this._pathTilesVer === ver && used.size === before) return this._pathTiles;
    const set = new Set();
    const R = this.rect;
    const clampPt = (p) => [Math.max(R.r0, Math.min(R.r1, Math.round(p[0]))), Math.max(R.c0, Math.min(R.c1, Math.round(p[1])))];
    const ok = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
    const walk = (route) => route && route.motion !== 'FLY' && ok(route.start);
    const routes = this.routes || [];
    const any = [...used].some((i) => walk(routes[i]));
    routes.forEach((route, i) => {
      if (!walk(route) || (any && !used.has(i))) return;
      const pts = [clampPt(route.start)];
      for (const cp of route.checkpoints || []) if ((cp.type === 'MOVE' || cp.type === 'APPEAR') && ok(cp.pos)) pts.push(clampPt(cp.pos));
      if (ok(route.end)) pts.push(clampPt(route.end));
      for (let j = 1; j < pts.length; j++) {
        const [a, b] = [pts[j - 1], pts[j]];
        const p = this.grid.findPath(a[0], a[1], b[0], b[1]) || this.grid.findPath(a[0], a[1], b[0], b[1], { ignoreObstacles: true });
        for (const [r, c] of p || []) set.add(r * COLS + c);
      }
    });
    this._pathTiles = set;
    this._pathTilesVer = ver;
    return set;
  }

  /**
   * An operator lying on the field, waiting to redeploy on that tile (DESIGN §5.5: after its respawn time, when the tile
   * is free and DP ≥ cost; _layBody, downOn). PRTS 卫戍协议/帮助 §作战阶段 单位部署: "干员退场后，将返回隐藏的待部署区，并原地
   * 留下一个“倒地干员”以供查看信息，满足再部署条件时，移除场上的该倒地干员并自动部署至该位置。" — every 退场 (GitHub #60, the owner's
   * decision of 2026-10-04): knocked out ('killed'), entering the battle knocked out (FORCED_EXIT, 联防) and forced out
   * by its own effects ('retreat': 史尔特尔's 余烬, 耀骑士临光 S2, 骑士戒律 + 竞技旗, 伊内丝 S3; 'merchant': a 商人 that cannot
   * pay) — except the 突袭 retreat ('raid', redeployed at once on its landing tile); not removed for good, after it was
   * deployed. A forced exit stays no kill: its 'die' / `death` reason is not 'killed' (no 被击倒 effect, 阿戈尔, no
   * knock-down count — but 不屈 rolls on it, and Touch's 超脱 counts a `dying` one: 史尔特尔's 余烬, 骑士戒律 + 竞技旗). The
   * client keeps its model on that tile knocked down with a redeploy countdown (b.snap `down`, render/units.js); summons,
   * devices and enemies simply leave.
   */
  isDown(u) {
    return !!u && u.side === 'ally' && u.kind === 'op' && !u.alive && !u.removed && u.removeReason !== 'raid'
      && u.deploySeq > 0 && Number.isFinite(u.respawnAt);
  }

  /**
   * constants.js DOWN_STATE of a down operator: its timer runs, or it waits for its tile / the DP — the same checks as
   * _checkRedeploys (a living unit or another body on its rest tile). No ally may take the tile it lies on (downOn), so
   * WAIT_TILE is a safeguard only.
   */
  _downState(u) {
    if (this.time + 1e-9 < u.respawnAt) return DOWN_STATE.COUNTING;
    const [r, c] = this.restTile(u);
    const occ = this._occ[r * COLS + c];
    if ((occ && occ.alive && occ !== u) || this.downOn(r, c, u)) return DOWN_STATE.WAIT_TILE;
    const ps = this.getPlayer(u.ownerId);
    return !ps || ps.dp + 1e-9 < u.base.cost ? DOWN_STATE.WAIT_DP : DOWN_STATE.COUNTING;
  }
}
