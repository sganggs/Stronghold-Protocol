// [ASSUMED] Normal-round positioning preferences distilled from the owner's 42 layouts.
// docs/research/ioleta-adaptive-default.md records the evidence, held-out cases and match comparisons.
import { FORMATION_PROFILES } from './botFormationProfiles.js';

const tileValues = new WeakMap();

// [ASSUMED] Experimental combinations of owner v0.2 zones and upstream 0.3 contact/safety ideas.
export const FORMATION_MODES = ['legacy', 'learned', 'ordered', 'contact', 'refined', 'combined', 'optimized', 'adaptive'];

/** Explicit experimental preset; unmeasured difficulties retain owner v0.2. */
export function resolveFormationMode(m, ps = null) {
  const mode = m.botFormationMode || (ps?.bandId === 'band_ioleta' && m.botIoletaPolicy === 'experimental'
    ? 'adaptive' : 'legacy');
  if (mode !== 'optimized') return mode;
  return m.difficulty === 'HARD' ? 'contact' : m.difficulty === 'ABYSS' ? 'combined' : 'learned';
}

export function contactValue(model, units) {
  let value = 0;
  for (const u of units) {
    // The damage model's `block` excludes ranged professions; medics still have real blocking stats.
    const block = u.heal ? (u.rec?.stats?.blockCnt ?? u.block) : u.block;
    if (!(block > 0)) continue;
    if (!model.ground.has(u.key)) { if (u.heal) value += 2; continue; }
    const routes = (model.index.get(u.key) || []).filter(([ri]) => !model.routes[ri].fly);
    if (!routes.length) continue;
    const supported = routes.every(([ri, i]) => units.some(a => a !== u && !a.heal && a.ground && a.dps > 0
      && a.cover.has(u.key) && a.cover.has(model.routes[ri].tiles[Math.max(0, i - 1)])));
    if (supported) value += u.heal ? 1 : 2;
    else if (u.heal) value -= 2;
  }
  return value;
}

export function formationProfile(m) {
  // Explicitly exclude both boss modes even if a caller supplies a stale normal wave.
  if (!m.wave || !Number.isInteger(m.round) || m.round < 1 || m.round > 13
    || m.round === m.gd.bossRound || m.round === m.gd.hiddenRound) return null;
  return FORMATION_PROFILES[m.stageId] || null;
}

export function formationRole(rec) {
  if (rec.attackKind === 'heal' || rec.dmgType === 'heal') return 'heal';
  if (rec.position === 'MELEE' && ['TANK', 'PIONEER'].includes(rec.profession) && rec.stats?.blockCnt >= 2) {
    return rec.rangeGrid?.some(([r, c]) => r === 0 && c === 0) ? 'block' : 'support';
  }
  return 'damage';
}

/** Soft terrain-specific deployment zones, not fixed slots: actual legality/ranges always win. */
export function formationTileValue(profile, role, key) {
  let cache = tileValues.get(profile);
  if (!cache) { cache = new Map(); tileValues.set(profile, cache); }
  const cacheKey = `${role}|${key}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const cells = profile[role] || {};
  const peak = Math.max(1, ...Object.values(cells));
  const [r, c] = key.split(',').map(Number);
  let best = 0;
  for (const [k, count] of Object.entries(cells)) {
    const [rr, cc] = k.split(',').map(Number);
    best = Math.max(best, count / peak / (1 + Math.abs(r - rr) + Math.abs(c - cc)));
  }
  cache.set(cacheKey, best);
  return best;
}

/** Score formation relationships without assuming a particular roster or always facing RIGHT. */
export function formationValue(model, units, profile) {
  const healers = units.filter(u => u.heal);
  const fronts = units.filter(u => u.block > 0 && u.cover.has(u.key) && model.ground.has(u.key));
  let value = 0;
  for (const u of units) {
    value += formationTileValue(profile, formationRole(u.rec), u.key);
    if (!u.heal && healers.some(h => h.cover.has(u.key))) value += fronts.includes(u) ? 1.4 : 0.7;
    // A rear dealer should reach a blocking point (including from its side). A dead-zone
    // fortress stays useful behind a defender instead of taking the foremost blocking tile.
    if (!u.heal && u.dps > 0 && fronts.some(f => f !== u && u.cover.has(f.key))) value += 1;
  }
  for (const rt of model.routes) {
    if (rt.fly) continue;
    const onRoute = fronts.filter(u => rt.tiles.includes(u.key));
    if (onRoute.length) value += 1.5;
  }
  return value;
}
