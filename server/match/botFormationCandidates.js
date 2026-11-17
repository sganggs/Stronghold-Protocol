// [ASSUMED] Whole-layout contact heuristics derived from #452 and the #690 follow-up.
// Inputs are current routes, legal placements and resolved attack ranges; no map IDs or taught coordinates.
// This scores geometry, not survival or skill timing. The caller must compare candidates in real rehearsal.
const attacks = unit => !unit.heal && unit.rec?.attackKind !== 'none' && unit.dps > 0;
const blocks = unit => (unit.rec?.stats?.blockCnt ?? unit.block ?? 0) > 0;

export function formationRelations(model, units) {
  const contacts = units.map(() => model.routes.map(() => null));
  const active = units.map(() => false), held = [], air = [];
  const healed = units.map(u => units.some(h => h !== u && h.heal && h.cover.has(u.key)));
  let missing = 0, exposure = 0;
  for (const [ri, route] of model.routes.entries()) {
    const fronts = route.fly ? [] : units.map((u, i) => ({ u, i, at: route.tiles.indexOf(u.key) }))
      .filter(f => blocks(f.u) && f.at >= 0);
    held.push(fronts.length > 0);
    for (const front of fronts) {
      const previous = route.tiles[Math.max(0, front.at - 1)];
      const supported = units.some(a => a !== front.u && attacks(a) && a.ground
        && a.cover.has(front.u.key) && a.cover.has(previous));
      contacts[front.i][ri] = supported;
      if (!supported) missing++;
    }
    const first = fronts.length ? Math.min(...fronts.map(f => f.at)) : route.tiles.length - 1;
    const approach = route.tiles.slice(0, first + 1);
    const contact = fronts.length ? route.tiles[Math.max(0, first - 1)] : null;
    let airDps = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!attacks(u) || (route.fly ? !u.air : !u.ground)) continue;
      let tiles = approach.filter(key => u.cover.has(key)).length;
      // [ASSUMED] A blocked enemy lingers on its incoming contact tile longer than a traversed tile.
      if (contact && u.cover.has(contact)) tiles += 3;
      if (tiles) active[i] = true;
      exposure += (route.n || 1) * u.dps * tiles;
      if (route.fly) airDps += u.dps * tiles;
    }
    air.push(airDps);
  }
  return { contacts, active, held, air, healed,
    rank: [-missing, -units.filter((u, i) => attacks(u) && !active[i]).length, exposure] };
}

export function preservesFormation(before, after) {
  return before.contacts.every((row, i) => row.every((v, ri) => v !== true || after.contacts[i][ri] !== false))
    && before.active.every((v, i) => !v || after.active[i])
    && before.held.every((v, i) => !v || after.held[i])
    && before.air.every((v, i) => after.air[i] >= v)
    && before.healed.every((v, i) => !v || after.healed[i]);
}

function better(a, b) {
  for (let i = 0; i < a.rank.length; i++) {
    if (Math.abs(a.rank[i] - b.rank[i]) > 1e-9) return a.rank[i] > b.rank[i];
  }
  return false;
}

/**
 * Refine a detached layout with legal options supplied by the production planner. Preserve input order for stable
 * ties and return the original array if nothing improves. No RNG, live board mutations or rehearsal here.
 * `placements(unit)` yields records for the same unit (including in-place rotations) in deterministic order.
 * Pure medics and tokens remain fixed; the production deployment path owns token withdrawal/redeployment.
 */
export function* refineFormationSteps(model, original, placements, { passes = 2 } = {}) {
  if (!Number.isInteger(passes) || passes < 0 || passes > 2) throw new RangeError('Formation passes must be 0..2');
  if (!model?.routes?.length || !original.length || !passes) return original;
  const units = original.slice();
  let changed = false;
  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      if (unit.kind === 'token' || unit.heal || !attacks(unit)) continue;
      const occupied = new Set(units.filter((_, j) => j !== i).map(u => u.key));
      const before = formationRelations(model, units);
      let best = unit, bestScore = before, tried = 0;
      for (const candidate of placements(unit)) {
        if (candidate.uid !== unit.uid || occupied.has(candidate.key)) continue;
        units[i] = candidate;
        const score = formationRelations(model, units);
        units[i] = unit;
        if (preservesFormation(before, score) && better(score, bestScore)) { best = candidate; bestScore = score; }
        if (++tried % 16 === 0) yield;
      }
      if (best !== unit) { units[i] = best; improved = true; changed = true; }
      yield;
    }
    if (!improved) break;
  }
  return changed ? units : original;
}
