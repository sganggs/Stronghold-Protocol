// server/sim/rehearsal.js — the bot layout rehearsal's comparison, shared by the server and by the host's browser
// (DESIGN §14 rehearsal delegation). The candidates of one rehearsal are simulated once each and the winner is the one
// with the fewest counted leaks, then the most kills, then the earliest candidate (server/match/bot.js). Both sides
// step the same BattleSpecs in the same order and use THIS module, so a rehearsal delegated to a browser picks exactly
// the candidate the server would pick — including the early stop (a candidate whose counted leaks already exceed the
// best finished one's can no longer win) and the tick cap (the field's time limit + 5 s of slack).
//
// Pure ESM (served at /sim/rehearsal.js): no Node API, no clock, no randomness — the caller owns the stepping, the
// candidates' construction and its wall-clock slices (`RehearsalRun.run(outOfBudget)`).

/**
 * Ticks one candidate may take: its time limit + 5 s of slack. A round without a limit is rehearsed for 60 s of game
 * time (the `Battle` default), like the server's own rehearsal cap before this module existed.
 * @param {number|undefined|null} timeLimit game seconds of the field
 */
export const rehearsalCap = (timeLimit) => Math.ceil(((Number(timeLimit) || 60) + 5) * 30);

/** Counted leaks of `playerId` in a battle (running or finished): the settle rule's count. */
export function rehearsalLeaks(battle, playerId) {
  const r = battle && typeof battle.result === 'function' ? battle.result() : null;
  const pp = r && r.perPlayer && r.perPlayer[playerId];
  return pp ? (pp.leaked || []).filter((l) => l && l.counted !== false).length : 0;
}

/**
 * The optional limits of a rehearsal run, as both sides of a delegated rehearsal read them (a frame field is untrusted:
 * anything but a non-negative integer is "off"). `stage` > 0: once the first `stage` candidates are done, the rest only
 * run while the best finished one still leaks (this is a leak-first search heuristic; later zero-leak candidates may have different kill counts). `tickBudget` > 0: no further candidate starts once the run has stepped that
 * many ticks in total (the one running finishes). 0 = off for both, the behaviour before these limits existed.
 * [ASSUMED] AI search budget only (docs/research/ioleta-adaptive-default.md); no game rule.
 * @param {{ stage?: unknown, tickBudget?: unknown }} [o]
 * @returns {{ stage: number, tickBudget: number }}
 */
export function rehearsalLimits(o = {}) {
  const int = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
  return { stage: int(o && o.stage), tickBudget: int(o && o.tickBudget) };
}

/** The best candidate of a rehearsal so far: `index` into the candidate order, `leaks` / `score` of that candidate. */
export class RehearsalScore {
  /** @param {string} playerId whose leaks and kills the candidates are compared by */
  constructor(playerId) {
    this.playerId = playerId;
    this.index = 0;
    this.leaks = Infinity;
    this.score = -Infinity;
  }

  /**
   * Whether a running candidate can still win: its counted leaks do not exceed the best finished one's. The early stop
   * the server's rehearsal always had (a candidate beaten here is not scored).
   */
  alive(battle) {
    return !(this.leaks < Infinity && rehearsalLeaks(battle, this.playerId) > this.leaks);
  }

  /**
   * Score the finished candidate `candidateIndex`: −1000 per counted leak + its kills, minus 0.01 × its position, so a
   * tie goes to the earlier candidate. A battle without a result of its own (a stand-in for a constructor failure) is
   * no candidate at all.
   * @returns {boolean} true when this candidate is the new best
   */
  note(battle, candidateIndex) {
    const r = battle && typeof battle.result === 'function' ? battle.result() : null;
    const pp = r && !r.synthetic && r.perPlayer && r.perPlayer[this.playerId];
    if (!pp) return false;
    const leaks = (pp.leaked || []).filter((l) => l && l.counted !== false).length;
    const score = -leaks * 1000 + (pp.killed || 0) - candidateIndex * 0.01;
    if (!(score > this.score)) return false;
    this.score = score;
    this.leaks = leaks;
    this.index = candidateIndex;
    return true;
  }
}

/**
 * One rehearsal run: the candidate battles in their order, stepped and scored by {@link RehearsalScore}. A candidate is
 * a factory (`() => battle`) the run calls when its turn comes — the caller keeps building them inside its slices, so a
 * `Battle`'s construction (a whole battle's setup) belongs to the same slice budget as its stepping instead of happening
 * for every candidate before the budget is looked at. One build cannot be interrupted (no hard real-time slicing): the
 * budget is checked between candidates, so a slice overruns by at most one build.
 * The candidates are consumed and dropped as they finish (a long rehearsal holds one battle at a time).
 *
 *   const run = new RehearsalRun(inputs.map((o) => () => m.newBattle(o)), playerId, cap, { onError });
 *   run.run(() => outOfTime());   // false: the budget ran out, call again to continue
 *   run.score.index               // the winning candidate
 */
export class RehearsalRun {
  /**
   * @param {Array<() => (any | null)>} candidates the candidates in order, each a factory returning its battle; one that
   *   returns nothing (or throws) could not be built and is skipped like the stand-in the server's own rehearsal gets:
   *   never scored, never picked
   * @param {string} playerId whose leaks and kills the candidates are compared by
   * @param {number} cap ticks per candidate ({@link rehearsalCap})
   * @param {{ onError?: (e: Error, index: number) => void, stage?: number, tickBudget?: number }} [opts] a factory
   *   that throws is reported and skipped; `stage` / `tickBudget` see {@link rehearsalLimits}
   */
  constructor(candidates, playerId, cap, { onError = null, stage = 0, tickBudget = 0 } = {}) {
    this.candidates = candidates;
    this.cap = cap;
    const limits = rehearsalLimits({ stage, tickBudget });
    this.stage = limits.stage;
    this.tickBudget = limits.tickBudget;
    /** ticks stepped over all candidates of this run (the tickBudget's count) */
    this.spent = 0;
    this.score = new RehearsalScore(playerId);
    this.onError = onError;
    this.index = 0;
    this.ticks = 0;
    /** The battle of the candidate being stepped (a factory is called once; a slice that stops mid-candidate resumes it). */
    this.current = null;
  }

  /**
   * Build and step the candidates until every one is done or `outOfBudget()` (the caller's wall-clock slice) returns
   * true.
   * @param {null | (() => boolean)} [outOfBudget] checked every 4 ticks and between candidates (a candidate built in
   *   this call is always stepped or scored before the check), so a slice never exceeds 4 ticks of stepping (plus the
   *   one build of the candidate it stops on) past its budget; the first candidate of a call always runs, so every call
   *   makes progress
   * @returns {boolean} true when every candidate is done
   */
  run(outOfBudget = null) {
    // ticks stepped in THIS call: the budget is checked every 4 of them, across the candidate boundary too
    let n = 0;
    // a candidate was consumed in THIS call: the check between candidates asks once the call did anything, so a
    // candidate that never ticks (it was already finished, it could not be built, its construction threw) cannot run
    // the whole candidate list past the caller's budget either
    let worked = false;
    while (this.index < this.candidates.length) { // loop-cap: the candidate list
      // a candidate that ended mid-slice (finished, cap, or beaten at a 64-tick check that skipped the budget test):
      // check the budget before building and stepping the next one
      if (outOfBudget && worked && outOfBudget()) return false;
      // the limits are looked at between candidates only: a candidate that started always finishes and is scored
      if (!this.current && this.limited()) {
        for (let i = this.index; i < this.candidates.length; i++) this.candidates[i] = null; // loop-cap: the candidate list
        this.index = this.candidates.length;
        break;
      }
      try {
        // the candidate of this turn, built when the first slice reaches it: its construction is part of the sliced
        // work, and the battle stays in `this.current` for the slices that continue it
        if (!this.current) {
          const candidate = this.candidates[this.index];
          this.candidates[this.index] = null;
          this.current = candidate() || null;
        }
        const battle = this.current;
        if (battle) {
          let beaten = false;
          while (this.ticks < this.cap && !battle.finished) { // loop-cap: the tick cap
            battle.step();
            this.ticks++;
            this.spent++;
            n++;
            if ((this.ticks & 63) === 0 && !this.score.alive(battle)) { beaten = true; break; }
            if (outOfBudget && (n & 3) === 0 && outOfBudget()) return false;
          }
          if (!beaten) {
            if (!battle.finished) battle.forceEnd('timeout');
            this.score.note(battle, this.index);
          }
        }
      } catch (e) {
        this.onError?.(e, this.index);
      }
      worked = true;
      this.current = null;
      this.index++;
      this.ticks = 0;
    }
    return true;
  }

  /** Whether the limits end the run before the next candidate (see {@link rehearsalLimits}). */
  limited() {
    if (this.stage > 0 && this.index >= this.stage && this.score.leaks === 0) return true;
    return this.tickBudget > 0 && this.spent >= this.tickBudget;
  }
}
