// Yu S3's controller prefabs (§34.31). Official YuS3EffectBehaviour.OnPlay creates a root on
// every grid in the owner's row (UP/DOWN) or column (LEFT/RIGHT). WithEdgeBehaviour offsets
// the visible pieces 0.4 in the deploy direction, chooses vertical art by camera side, and
// adds caps on invalid neighbouring tiles. Source/root are controllers, not one-shot casts.
export const YU_WALL_SOURCE = 'yu_skill3_range_01_source';
const lc = (key) => typeof key === 'string' ? key.toLowerCase() : null;
const fields = (def, name) => def?.nodes?.flatMap((n) => n.behaviours || []).find((b) => b.class === name && b.enabled !== false)?.fields;

/** Finite battlefield rectangle; [ASSUMED] our active field is the official controller's map. */
export function wallRect(rect) {
  if (!rect || ![rect.r0, rect.r1, rect.c0, rect.c1].every(Number.isFinite)) return null;
  const r = { r0: Math.max(0, Math.ceil(rect.r0)), r1: Math.min(18, Math.floor(rect.r1)), c0: Math.max(0, Math.ceil(rect.c0)), c1: Math.min(20, Math.floor(rect.c1)) };
  return r.r0 <= r.r1 && r.c0 <= r.c1 ? r : null;
}

/** Per-grid roots plus the offset visible pieces; cap positions follow the official neighbouring grid. */
export function yuWallLayout(v, rect, cfg, cameraX = 10) {
  const r = wallRect(rect), x = Math.round(v.x), y = Math.round(v.y);
  if (!r || x < r.c0 || x > r.c1 || y < r.r0 || y > r.r1) return [];
  const dir = v.dir || 'RIGHT', horizontal = dir === 'UP' || dir === 'DOWN';
  const offset = Number.isFinite(cfg._offset) ? cfg._offset : 0;
  const dx = horizontal ? 0 : dir === 'LEFT' ? -offset : offset;
  const dy = horizontal ? dir === 'DOWN' ? -offset : offset : 0;
  const side = x + dx > cameraX ? 'Right' : 'Left';
  const key = lc(cfg[horizontal ? '_effectWhenHorizontal' : `_effectVerticalWhenAtWorld${side}`]);
  const pieces = [];
  for (let i = horizontal ? r.c0 : r.r0; i <= (horizontal ? r.c1 : r.r1); i++) {
    const cx = horizontal ? i : x, cy = horizontal ? y : i;
    pieces.push({ root: true, x: cx, y: cy });
    pieces.push({ key, x: cx + dx, y: cy + dy });
  }
  const ends = horizontal
    ? [[cfg._effectEdgeWhenHorizontalLeft, r.c0 - 1, y], [cfg._effectEdgeWhenHorizontalRight, r.c1 + 1, y]]
    : [[cfg[`_effectEdgeWhenVerticalWorld${side}Down`], x, r.r0 - 1], [cfg[`_effectEdgeWhenVerticalWorld${side}Up`], x, r.r1 + 1]];
  for (const [k, cx, cy] of ends) pieces.push({ key: lc(k), x: cx + dx, y: cy + dy, edge: true });
  return pieces;
}

/** A skill-held composite handle, including asynchronous prefab loads and owner removal. */
export class YuWall {
  constructor(w, owner) {
    this.w = w; this.owner = owner; this.key = YU_WALL_SOURCE; this.alive = true;
    this.parts = []; this.started = false; this.at = w.ofx.time; this.next = this.at;
    // Placement is fixed at cast, even if the owner later moves.
    this.origin = { x: owner.x, y: owner.y, dir: owner.dir };
    this.rect = wallRect(w.ofx.ctx?.fieldRect?.());
    this.update();
  }

  update() {
    if (!this.alive) return;
    if (!this.w.ofx.active || this.owner.destroyed || this.owner.alive === false) { this.stop(); return; }
    const ofx = this.w.ofx;
    const source = fields(ofx.lib.def(this.key), 'YuS3EffectBehaviour');
    const rootKey = lc(source?._effectEachGrid);
    const cfg = fields(ofx.lib.def(rootKey), 'YuS3EffectWithEdgeBehaviour');
    if (!cfg || !this.rect) return; // remain pending while recursive preloading completes
    if (!this.started) {
      this.started = true;
      const cam = ofx.ctx?.cam?.(), cameraX = cam?.position?.().x ?? 10;
      const r = this.rect;
      // No clipping: the official wall spans the battlefield with its caps on the invalid tiles just past each end.
      // (A world-space clip discarded most of the curtain — some vertex paths pass local positions as v_wpos — and
      // left flat orange slivers; the maintainer's official video shows the whole crimson curtain.)
      this.data = undefined;
      this.parts = yuWallLayout(this.origin, r, cfg, cameraX).map((p) => ({ ...p, key: p.root ? rootKey : p.key, h: null }));
      this.next = this.at + Math.max(0, Number(cfg._edgeEffectIntervalFirstTick) || 0);
    }
    for (const p of this.parts) {
      if (p.h?.alive || (p.edge && ofx.time < this.next) || !p.key || !ofx.lib.has(p.key)) continue;
      const r = this.rect, row = Math.max(r.r0, Math.min(r.r1, Math.round(p.y))), col = Math.max(r.c0, Math.min(r.c1, Math.round(p.x)));
      const z = ofx.ctx?.heightAt?.(row, col) || 0;
      p.h = ofx.spawn(p.key, { pos: [p.x - 10, p.y - 9, -z], groundZ: -z }, { owner: this.owner, loop: true, important: true, data: this.data });
    }
    if (ofx.time >= this.next) this.next = ofx.time + Math.max(0.05, Number(cfg._edgeEffectInterval) || 2);
  }

  stop() { this.alive = false; for (const p of this.parts) p.h?.stop(); }
  kill() { this.alive = false; for (const p of this.parts) p.h?.kill(); }
}
