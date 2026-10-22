// Read-only selected-unit HUD metadata (#746); never used by gameplay or golden digests.
import { BOND_TIMERS } from '../../../../shared/bondTimers.js';
import { bondRecord, buffParams, num } from '../support/index.js';

/** [ASSUMED] Show stack count + next expiry, rounded UP to 0.1 simulation seconds (no active 0.0s).
 * Buff timeLeft and the recorded stealth-removal time are authoritative, including early removal and redeploy.
 * No duration is inferred from layers, deployment age, client time or a previously received snapshot.
 */
export function bondTimerView(u, time) {
  if (!u.alive || !u.deployed || u.hidden || u.side !== 'ally') return [];
  const rows = [];
  for (const d of BOND_TIMERS) {
    let count = 0, remaining = Infinity;
    if (d.buffKey) {
      for (const b of u.buffs) {
        if (b.key !== d.buffKey || !Number.isFinite(b.timeLeft) || b.timeLeft <= 1e-9) continue;
        count++;
        remaining = Math.min(remaining, b.timeLeft);
      }
    } else if (d.window) {
      const w = d.window, start = u.mem?.[w.start];
      if (!Number.isFinite(start)) continue; // Infinity while the bond's stealth is still active; absent before deploy.
      const duration = num(buffParams(bondRecord(w.bondId), w.effect)?.[w.duration], 0);
      remaining = start + duration - time;
      if (remaining > 1e-9) count = 1;
    }
    if (count && Number.isFinite(remaining)) rows.push({ id: d.id, count, remaining: Math.ceil((remaining - 1e-9) * 10) / 10 });
  }
  return rows;
}
