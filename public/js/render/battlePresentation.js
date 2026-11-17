import { ANIM, UF } from '../../../shared/constants.js';

// Preserve flight, stealth-driven forms and other persistent identity/status bits.
const END_CLEAR = UF.SKILL | UF.STUNNED | UF.FROZEN | UF.SLEEP | UF.BLOCKED | UF.COLD;

/** Presentation-only completion: never infer an end from a missing/paused feed. */
export class BattlePresentation {
  constructor() { this.reset(); }
  reset() { this.requested = false; this.ended = false; this.tail = 0; }
  finish() { this.requested = true; }
  update(renderT, newestT, dt) {
    const start = !this.ended && this.requested && Number.isFinite(newestT) && renderT >= newestT;
    if (start) this.ended = true;
    if (this.ended) this.tail += Math.max(0, dt);
    return start;
  }
  sample(s) {
    return this.ended && s.hp > 0 && s.anim !== ANIM.DIE
      ? { ...s, anim: ANIM.IDLE, flags: s.flags & ~END_CLEAR, vx: 0, vy: 0 } : s;
  }
}
