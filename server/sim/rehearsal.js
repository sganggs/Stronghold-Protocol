// server/sim/rehearsal.js — the bot layout rehearsal's comparison, shared by the server and by the host's browser
// (DESIGN §14 rehearsal delegation). The candidates of one rehearsal are simulated once each and the winner is the one
// with the fewest counted leaks, then the most leader damage, then the most kills, then the earliest candidate — on a
// boss field (Final Assault, Hidden Core) leader damage less a leak's cost first (§37.61, FA_LEAK_SECONDS)
// (server/match/bot.js). Both sides
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

/**
 * §37.61 [ASSUMED]: a boss field (Final Assault, Hidden Core) goes on until the team's LP runs out or the pool is empty,
 * so a leak there — about 1 LP — costs about one real second of a fight of ~120 + LP real seconds: its rehearsal ranks
 * leader damage × (1 − counted leaks / FA_LEAK_SECONDS) first (a tie falls back to the usual order) and stops no
 * candidate early (one that leaks more can still deal more). Solo 终极 1–320 with the body candidates: 52.0 → 55.9 %.
 */
export const FA_LEAK_SECONDS = 150;

/** A boss field's battle (Final Assault or Hidden Core): its rehearsal ranks leader damage first. */
const bossField = (battle) => !!battle && (battle.kind === 'boss' || battle.kind === 'hidden');

/** Counted leaks of `playerId` in a battle (running or finished): the settle rule's count. */
export function rehearsalLeaks(battle, playerId) {
  const r = battle && typeof battle.result === 'function' ? battle.result() : null;
  const pp = r && r.perPlayer && r.perPlayer[playerId];
  return pp ? (pp.leaked || []).filter((l) => l && l.counted !== false).length : 0;
}

/**
 * The best candidate of a rehearsal so far: `index` into the candidate order, `leaks` / `boss` / `score`.
 * Counted leaks rank first; leader damage breaks a leak tie; `score` (the old −1000/kills/position number) breaks the rest.
 * A boss field ranks leader damage less a leak's cost first (§37.61, FA_LEAK_SECONDS).
 */
export class RehearsalScore {
  /** @param {string} playerId whose leaks and kills the candidates are compared by */
  constructor(playerId) {
    this.playerId = playerId;
    this.index = 0;
    this.leaks = Infinity;
    this.boss = -Infinity;
    this.gain = -Infinity;
    this.score = -Infinity;
  }

  /**
   * Whether a running candidate can still win: its counted leaks do not exceed the best finished one's. The early stop
   * the server's rehearsal always had (a candidate beaten here is not scored).
   */
  alive(battle) {
    if (bossField(battle)) return true;
    return !(this.leaks < Infinity && rehearsalLeaks(battle, this.playerId) > this.leaks);
  }

  /**
   * Score the finished candidate `candidateIndex`. Fewer counted leaks win. On a leak tie, more leader damage wins
   * (a Final Assault rehearsal; a normal field records 0). On a tie of both, −1000 per leak + kills − 0.01 × position
   * keeps the earlier candidate, and that number is what `score` stores. A battle without a result of its own (a
   * stand-in for a constructor failure) is no candidate at all.
   * One counted leak still outranks any leader-damage difference on a normal field: a leak spends LP, and the pools are
   * far smaller than the weight of one leak in the old score. [ASSUMED] #315. A boss field ranks leader damage ×
   * (1 − leaks / FA_LEAK_SECONDS) first (§37.61); an equal value falls back to that order.
   * @returns {boolean} true when this candidate is the new best
   */
  note(battle, candidateIndex) {
    const r = battle && typeof battle.result === 'function' ? battle.result() : null;
    const pp = r && !r.synthetic && r.perPlayer && r.perPlayer[this.playerId];
    if (!pp) return false;
    const leaks = (pp.leaked || []).filter((l) => l && l.counted !== false).length;
    const boss = Math.max(0, Number(pp.bossDamage) || 0);
    const score = -leaks * 1000 + (pp.killed || 0) - candidateIndex * 0.01;
    // §37.37: the layers the battle gained (its 特质 and bonds, `layerGains`) break a leak and leader-damage tie
    const gain = Object.values(pp.layerGains || {}).reduce((s, n) => s + (Number(n) || 0), 0);
    if (bossField(battle) && this.leaks < Infinity && (boss > 0 || this.boss > 0)) {
      const value = boss * Math.max(0, 1 - leaks / FA_LEAK_SECONDS), best = this.boss * Math.max(0, 1 - this.leaks / FA_LEAK_SECONDS);
      if (Math.abs(value - best) > 1e-6) {
        if (value < best) return false;
        this.score = score;
        this.leaks = leaks;
        this.boss = boss;
        this.gain = gain;
        this.index = candidateIndex;
        return true;
      }
    }
    const better = leaks < this.leaks
      || (leaks === this.leaks && boss > this.boss)
      || (leaks === this.leaks && boss === this.boss && gain > this.gain)
      || (leaks === this.leaks && boss === this.boss && gain === this.gain && score > this.score);
    if (!better) return false;
    this.score = score;
    this.leaks = leaks;
    this.boss = boss;
    this.gain = gain;
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
   * @param {{ onError?: (e: Error, index: number) => void, stage?: number, tickBudget?: number }} [opts] a factory that throws is reported and skipped
   */
  constructor(candidates, playerId, cap, { onError = null, stage = 0, tickBudget = 0 } = {}) {
    this.candidates = candidates;
    this.cap = cap;
    if (!Number.isInteger(stage) || stage < 0 || stage > 8
      || !Number.isSafeInteger(tickBudget) || tickBudget < 0) throw new RangeError('Invalid rehearsal limits');
    this.stage = stage;
    this.tickBudget = tickBudget;
    this.totalTicks = 0;
    this.completed = 0;
    this.zeroComplete = false;
    this.stopReason = null;
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
   *   makes progress. A test replay passes the same check points and ignores the wall clock (`control`).
   * @param {null | { note?: (n: number) => void }} [control] when set, each stepped tick is counted for the journal
   * @returns {boolean} true when every candidate is done
   */
  run(outOfBudget = null, control = null) {
    // ticks stepped in THIS call: the budget is checked every 4 of them, across the candidate boundary too
    let n = 0;
    // a candidate was consumed in THIS call: the check between candidates asks once the call did anything, so a
    // candidate that never ticks (it was already finished, it could not be built, its construction threw) cannot run
    // the whole candidate list past the caller's budget either
    let worked = false;
    const note = () => { n++; this.totalTicks++; if (control) control.note(1); this.spent = n; };
    while (this.index < this.candidates.length) { // loop-cap: the candidate list
      // a candidate that ended mid-slice (finished, cap, or beaten at a 64-tick check that skipped the budget test):
      // check the budget before building and stepping the next one
      if (outOfBudget && worked && outOfBudget()) { this.spent = n; return false; }
      if (!this.current && ((this.stage && this.index >= this.stage && this.zeroComplete)
        || (this.tickBudget && this.totalTicks >= this.tickBudget))) {
        this.stopReason = this.zeroComplete && this.index >= this.stage ? 'zero' : 'budget';
        this.candidates.fill(null, this.index);
        this.spent = n;
        return true;
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
          while (this.ticks < this.cap && !battle.finished && (!this.tickBudget || this.totalTicks < this.tickBudget)) { // loop-cap: the tick cap
            battle.step();
            this.ticks++;
            note();
            if ((this.ticks & 63) === 0 && !this.score.alive(battle)) { beaten = true; break; }
            if (outOfBudget && (n & 3) === 0 && outOfBudget()) { this.spent = n; return false; }
          }
          if (!beaten) {
            const complete = battle.finished;
            if (!complete) battle.forceEnd('timeout');
            // Adaptive candidates interrupted by a cap cannot displace a completed result.
            const result = complete ? battle.result() : null;
            if (!this.stage || (complete && !result?.errors)) this.score.note(battle, this.index);
            if (complete) {
              this.completed++;
              if (result?.reason === 'cleared' && !result.synthetic && !result.errors
                && result.perPlayer?.[this.score.playerId] && rehearsalLeaks(battle, this.score.playerId) === 0) {
                this.zeroComplete = true;
              }
            }
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
    this.stopReason ||= 'exhausted';
    this.spent = n;
    return true;
  }
}
