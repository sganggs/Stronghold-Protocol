// 流形 presentation only (§34.31). Official token prefab: Default is the unprefixed model,
// Melee / Melee_S3 replace its animation keys with A_*, Range / Range_S2 with B_*.
export const MANIFOLD = 'token_10030_mlyss_wtrman';
export const isManifold = (info) => (info?.spine || info?.defId) === MANIFOLD;

/** The existing copy event names the source operator; its official position decides the copied form. */
export function manifoldCopyForm(rec) {
  return rec?.position === 'RANGED' ? 'Range' : rec?.position === 'MELEE' ? 'Melee' : null;
}

/**
 * [ASSUMED] Reconstruct a missed copy (late replay / split clone, no copy event) from its existing atk kind.
 * The sim's copyInto always uses 'none' for melee and a nonempty projectile for ranged copies. It never
 * attacks before copying. No recovery / c0 transition or summoner skill state is inferred.
 */
export function manifoldAttackForm(kind) {
  return kind === 'none' ? 'Melee' : typeof kind === 'string' && kind ? 'Range' : null;
}
