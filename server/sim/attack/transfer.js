// Explicit reservations from the actual post-barrier amount: no reconstruction from the victim's final HP delta.
/**
 * Reserve a share for a transfer group. [ASSUMED] Simultaneous sharing keeps the project's existing §29.2 contract;
 * PRTS specifies Skadi's priority and HP loss, but does not settle its composition with the Stead bond.
 * Callbacks run after all shares have been reserved, with the full ancestry to prevent revisiting the same transfer.
 */
export function reserveTransfer(ctx, ratio, tag, apply) {
  if (!(ctx.amount > 0) || !(ratio > 0) || typeof apply !== 'function') return 0;
  const group = ctx.transfers ??= { base: ctx.amount, entries: [] };
  if (group.entries.some(e => e.tag === tag)) return 0;
  const amount = Math.min(ctx.amount, group.base * Math.min(1, ratio));
  ctx.amount -= amount;
  group.entries.push({ amount, tag, apply });
  return amount;
}

export function applyTransfers(battle, ctx) {
  const entries = ctx.transfers?.entries ?? [];
  const tags = [...new Set([...(ctx.dmg.tags ?? []), ...entries.map(e => e.tag)])];
  for (const entry of entries) {
    try { entry.apply(entry.amount, tags); } catch (error) { battle._internalError('transfer', error); }
  }
}
