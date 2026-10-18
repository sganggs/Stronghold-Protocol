// server/match/match/testCommands.js — Match methods: g.test, the host's test-mode commands
// (DESIGN §34.8 phase 2). Installed on Match.prototype by server/match/Match.js.
//
// Every command calls a primitive the real match already uses (addFunds, acquireChess,
// acquireItem, addLayers, pickBand, startRound, levelUp, addBounty, pickCard,
// pickPersonalChoice, enterPrep, enterSpDraft, finishBandDraft, prepDeadline). Nothing here
// retargets another player, another room, a file, or a plugin script. The commanding seat is
// the host's own PlayerState.
//
// [ASSUMED] Choices no official source settles:
//   * Co-op test rooms are allowed. Only the current host commands, and a command changes that
//     host's seat only. A normal room never gains the flag.
//   * funds / lp / bond layers / team LP are absolute counts. A lower bond count is refused
//     (addLayers cannot decrease). An equal count is a success that changes nothing.
//   * hp is the shared boss pool's current HP, written directly so it does not credit boss
//     damage. It is refused while the pool does not exist. It is also accepted during
//     FINAL_ASSAULT / HIDDEN_CORE, which is when the pool exists in a real match. teamLp is
//     the same. Operator HP inside a running battle is sim state and is not a command.
//   * Equipment grants use the existing displayed-offer overdraw bookkeeping, even with no stock.
//   * A token grant is +1 of a placeable token of a chess the host already owns (board, hand
//     or temp), even past that token's deploy limit. An unowned token is refused.
//   * strategy during BAND_DRAFT is pickBand (that method sets the strategy's starting LP).
//     After the draft, bandId changes and LP is kept unless resetLp is true.
//   * level calls levelUp: it spends the real upgrade price and obeys that method's gate
//     (PREP, not ready, not max level).
//   * round calls startRound. Intermediate rounds are not settled. An accepted jump first
//     eliminates every alive player with LP <= 0, the same helper settlement uses. If nobody
//     remains, the match ends eliminated and the round does not start. A jump into the hidden
//     round opens team LP with the Final Assault's helper when that pool was never opened.
//     Refused before a strategy is chosen, and while a battle is live. A refusal does not eliminate.
//   * phase prep from ROUND_START calls enterPrep and therefore skips a 机变 draft that has
//     not started. From SP_DRAFT it is refused until every pick is in, so an open draft is
//     not aborted. phase combat calls prepDeadline (the real timeout path), not a new jump.
//   * The shop queue replaces the whole next roll once, frozen slots included. A queued shop blocks level upgrades until consumed.
//   * Timers off holds the phase callback instead of scaling time to zero (a zero delay would
//     fire at once). Turning them on re-arms the original duration, not the leftover.
//   * Rate: 8 attempted commands of one type per 10s of scheduler time, counted before the
//     audit. Guests (NOT_HOST) and spectators (SPECTATOR) share that bucket. TEST_FORBIDDEN
//     does not. An oversized id or string is refused before it is traced (BAD_TARGET or
//     BAD_MSG, never clamped). The audit keeps the parsed args, or { rejected: true } when
//     the shape itself was refused.
//   * bond count sets the ordinary extra-member bonus (0..99), allowing activation without
//     pieces. computeBonds still decides the tier; a mode-disabled bond is refused.

import { ERR, PHASE, layerGainRoom } from '../../../shared/constants.js';
import { parseTestArgs, isTestCommand, TEST_LOG_CAP, TEST_RATE_COUNT, TEST_RATE_WINDOW_MS } from '../../../shared/testMode.js';
import { OK, fail } from './common.js';

const BLOCKED = new Set([PHASE.LOBBY, PHASE.COMBAT, PHASE.UNITE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE, PHASE.RESULT]);

export class MatchTestCommands {
  /**
   * g.test { cmd, args? }. Refused unless this match was created as a test match. Every attempt
   * is rated first. Spectators and other seats are then refused. Only the current host runs a command.
   * @param {import('../PlayerState.js').PlayerState} ps
   * @param {{ cmd?: string, args?: object }} msg
   */
  applyTestCommand(ps, msg) {
    if (this.test !== true) return fail(ERR.TEST_FORBIDDEN);
    if (!ps) return fail(ERR.NOT_HOST);
    // [ASSUMED] Every seat shares one bucket per command, including a guest or a spectator.
    // The stamp happens before the refusal audit so those attempts consume a slot.
    const cmd = isTestCommand(msg?.cmd) ? msg.cmd : 'invalid';
    if (!this._testRateAllows(cmd)) {
      this._testAudit(ps, cmd, { rejected: true }, ERR.RATE);
      return fail(ERR.RATE);
    }
    this._testStamp(cmd);
    if (ps.spectator) {
      this._testAudit(ps, cmd, { rejected: true }, ERR.SPECTATOR);
      return fail(ERR.SPECTATOR);
    }
    if (ps.playerId !== this.hostId) {
      this._testAudit(ps, cmd, { rejected: true }, ERR.NOT_HOST);
      return fail(ERR.NOT_HOST);
    }
    if (msg && (msg.oversize === 'BAD_TARGET' || msg.oversize === 'BAD_MSG')) {
      this._testAudit(ps, cmd, { rejected: true }, msg.oversize);
      return fail(msg.oversize === 'BAD_TARGET' ? ERR.BAD_TARGET : ERR.BAD_MSG);
    }
    if (msg && typeof msg === 'object') {
      for (const k of Object.keys(msg)) {
        if (k === 't' || k === 'cmd' || k === 'args' || k === 'rid') continue;
        this._testAudit(ps, cmd, { rejected: true }, ERR.BAD_MSG);
        return fail(ERR.BAD_MSG);
      }
    }
    const parsed = parseTestArgs(cmd, msg && msg.args);
    if ('error' in parsed) {
      this._testAudit(ps, cmd, { rejected: true }, parsed.error);
      return fail(parsed.error === 'BAD_TARGET' ? ERR.BAD_TARGET : ERR.BAD_MSG);
    }
    let res;
    this._testApplying = true;
    try {
      res = this._applyTest(ps, cmd, parsed.args);
    } catch (e) {
      this.reportError(`g.test ${cmd}`, e);
      res = fail(ERR.INTERNAL);
    } finally { this._testApplying = false; }
    const code = res && res.error ? res.error : null;
    this._testAudit(ps, cmd, parsed.args, code, res && res.detail);
    if (this._testOutcome) {
      const outcome = this._testOutcome; this._testOutcome = null; this.finish(outcome);
    }
    return code ? res : OK;
  }

  _testRateAllows(cmd) {
    const now = this.sched.now();
    const list = (this._testRate.get(cmd) || []).filter((t) => now >= t && now - t < TEST_RATE_WINDOW_MS);
    this._testRate.set(cmd, list);
    return list.length < TEST_RATE_COUNT;
  }

  _testStamp(cmd) {
    const list = this._testRate.get(cmd) || [];
    list.push(this.sched.now());
    this._testRate.set(cmd, list);
  }

  _testAudit(ps, cmd, args, code, detail) {
    const ok = !code;
    const entry = {
      seq: ++this._testSeq,
      playerId: ps.playerId,
      cmd: String(cmd || '').slice(0, 16),
      args,
      at: this.sched.now(),
      ok,
    };
    if (code) entry.code = String(code).slice(0, 32);
    if (typeof detail === 'string' && detail) entry.detail = detail.slice(0, 120);
    this.log.info?.(`[test-audit ${this.roomCode}] ${JSON.stringify(entry)}`);
    this.testLog.push(entry);
    if (this.testLog.length > TEST_LOG_CAP) this.testLog.splice(0, this.testLog.length - TEST_LOG_CAP);
    if (ok) this.testActions++;
    this.markPublic();
  }

  _applyTest(ps, cmd, args) {
    switch (cmd) {
      case 'funds': return this._testFunds(ps, args.amount);
      case 'chess': return this._testChess(ps, args.id);
      case 'item': return this._testItem(ps, args.id);
      case 'token': return this._testToken(ps, args.id, args.ownerUid);
      case 'lp': return this._testLp(ps, args.value);
      case 'hp': return this._testHp(args.value);
      case 'teamLp': return this._testTeamLp(args.value);
      case 'round': return this._testRound(ps, args.round);
      case 'phase': return this._testPhase(args.name);
      case 'shop': return this._testShop(ps, args.slots);
      case 'timers': return this._testTimers(args.on);
      case 'bond': return this._testBond(ps, args.id, args.layers, args.count);
      case 'strategy': return this._testStrategy(ps, args.id, args.resetLp === true);
      case 'level': return ps.levelUp();
      case 'bounty': return this._testBounty(ps, args.enemyKey);
      case 'choice': return this._testChoice(ps, args.idx, args.choiceId);
      default: return fail(ERR.BAD_MSG);
    }
  }

  /** Economy and grants: not during a live battle or a terminal phase. */
  _testQuiet() {
    if (this.fields.some((f) => f && f.live)) return fail(ERR.WRONG_PHASE);
    if (BLOCKED.has(this.phase)) return fail(ERR.WRONG_PHASE);
    return null;
  }

  _testFunds(ps, amount) {
    const blocked = this._testQuiet();
    if (blocked) return blocked;
    ps.addFunds(amount - ps.funds, { reason: 'test' });
    return OK;
  }

  _testChess(ps, id) {
    const blocked = this._testQuiet();
    if (blocked) return blocked;
    const rec = ps.gd.chess(id);
    if (!rec || (rec.isDiy && !rec.diyFor)) return fail(ERR.BAD_TARGET);
    const owned = ps.acquireChess(id, { source: 'grant' });
    if (!owned) return fail(ERR.BAD_TARGET);
    return OK;
  }

  _testItem(ps, id) {
    const blocked = this._testQuiet();
    if (blocked) return blocked;
    if (!this.gd.item(id)) return fail(ERR.BAD_TARGET);
    const owned = ps.acquireItem(id, { source: 'grant', displayed: true });
    if (!owned) return fail(ERR.SOLD_OUT);
    return OK;
  }

  _testToken(ps, id, ownerUid) {
    const blocked = this._testQuiet();
    if (blocked) return blocked;
    const loc = ps.find(ownerUid);
    if (!loc || loc.piece.kind !== 'chess') return fail(ERR.BAD_TARGET);
    const owner = loc.piece;
    const rec = ps.gd.chess(owner.id);
    if (!rec || (typeof ps.fieldsStandIn === 'function' && ps.fieldsStandIn(rec))) return fail(ERR.BAD_TARGET);
    const placeable = ps.gd.placeableTokens(owner.id, ps.loadoutFor(rec));
    if (!placeable.some((t) => t.tokenId === id)) return fail(ERR.BAD_TARGET);
    const stack = [...ps.hand, ...ps.temp].find((p) => p && p.kind === 'token' && p.ownerUid === owner.uid && p.id === id);
    if (stack) stack.count = (stack.count || 1) + 1;
    else ps.stow(ps.newPiece('token', id, { count: 1, ownerUid: owner.uid }), { allowTemp: true });
    ps.dirty();
    return OK;
  }

  _testLp(ps, value) {
    const blocked = this._testQuiet();
    if (blocked) return blocked;
    ps.lp = value;
    ps.dirty();
    this.markPrivate(ps);
    return OK;
  }

  /** Boss-pool HP. [ASSUMED] also during the boss phases, where the pool actually exists. */
  _testHp(value) {
    if (this.phase === PHASE.LOBBY || this.phase === PHASE.COMBAT || this.phase === PHASE.UNITE || this.phase === PHASE.RESULT) return fail(ERR.WRONG_PHASE);
    if (this.fields.some((f) => f && f.live) && this.phase !== PHASE.FINAL_ASSAULT && this.phase !== PHASE.HIDDEN_CORE) return fail(ERR.WRONG_PHASE);
    const pool = this.bossPool;
    if (!pool || !Number.isFinite(pool.maxHp)) return fail(ERR.WRONG_PHASE);
    if (value > pool.maxHp) return fail(ERR.BAD_TARGET);
    pool.hp = value;
    this._broadcastPool(true);
    this.markPublic();
    return OK;
  }

  _testTeamLp(value) {
    if (this.phase === PHASE.LOBBY || this.phase === PHASE.COMBAT || this.phase === PHASE.UNITE || this.phase === PHASE.RESULT) return fail(ERR.WRONG_PHASE);
    if (this.teamLp == null || !Number.isFinite(this.teamLp)) return fail(ERR.WRONG_PHASE);
    this.teamLp = value;
    if (this.bossPool) this._broadcastPool(true);
    this.markPublic();
    return OK;
  }

  _testRound(ps, round) {
    const blocked = this._testQuiet();
    if (blocked) return blocked;
    if (this.phase === PHASE.INFO_CHECK || this.phase === PHASE.BAND_DRAFT || !ps.bandId) return fail(ERR.WRONG_PHASE);
    const hidden = this.gd.hiddenRound;
    const hi = Math.max(this.gd.lastRound || 0, hidden > 0 ? hidden : 0);
    if (round > hi) return fail(ERR.BAD_TARGET, `round|${JSON.stringify({ hi })}`);
    this.eliminateBroken();
    if (!this.alivePlayers().length) {
      this.finish({ victory: false, reason: 'eliminated' });
      return OK;
    }
    this.setDeadline(0);
    this.cancel(this._turnTimer);
    this._turnToken++;
    this.startRound(round, () => {
      // Run after any blocking battleCheck window and the actual round start. Ordinary progression
      // keeps the Final Assault's LP; a jump never fought it. Boss prep itself still has no team LP.
      if (hidden > 0 && hidden !== this.gd.bossRound && this.round === hidden && this.teamLp == null) this._openTeamLp();
    });
    return OK;
  }

  _testPhase(name) {
    if (name === 'advance') return this._testAdvance();
    if (name === 'battleCheck') {
      if (this.phase !== PHASE.BAND_DRAFT) return fail(ERR.WRONG_PHASE);
      this.finishBandDraft();
      return OK;
    }
    if (name === 'prep') {
      if (this.phase === PHASE.ROUND_START) { this.setDeadline(0); this.enterPrep(); return OK; }
      if (this.phase === PHASE.SP_DRAFT) {
        const s = this.sp;
        if (s && s.order.some((id) => s.picks[id] == null)) return fail(ERR.WRONG_PHASE);
        this.finishSpDraft();
        return OK;
      }
      return fail(ERR.WRONG_PHASE);
    }
    if (name === 'sp') {
      if (this.phase !== PHASE.ROUND_START || !this.gd.spRounds().includes(this.round)) return fail(ERR.WRONG_PHASE);
      this.setDeadline(0);
      this.enterSpDraft();
      return OK;
    }
    if (name === 'combat') {
      if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
      this.prepDeadline();
      return OK;
    }
    return fail(ERR.BAD_TARGET);
  }

  _testAdvance() {
    const held = this._testHeld;
    if (!held || typeof held.fn !== 'function') return fail(ERR.WRONG_PHASE);
    this._testHeld = null;
    this._testArmed = null;
    held.fn();
    return OK;
  }

  _testShop(ps, slots) {
    const blocked = this._testQuiet();
    if (blocked) return blocked;
    const spec = this.gd.shopSlots(ps.shop.level);
    const n = spec.chess + spec.item;
    const shopDetail = `shop|${JSON.stringify({ chess: spec.chess, item: spec.item })}`;
    if (slots.length !== n) return fail(ERR.BAD_TARGET, shopDetail);
    for (let i = 0; i < n; i++) {
      const want = i < spec.chess ? 'chess' : 'item';
      const s = slots[i];
      if (!s || s.kind !== want) return fail(ERR.BAD_TARGET, shopDetail);
      if (want === 'chess' ? !ps.gd.chess(s.id) || (ps.gd.chess(s.id).isDiy && !ps.gd.chess(s.id).diyFor) : !ps.gd.item(s.id)) return fail(ERR.BAD_TARGET);
    }
    ps._testShopNext = slots.map((s) => ({ kind: s.kind, id: s.id }));
    ps.dirty();
    return OK;
  }

  _testTimers(on) {
    // COMBAT / UNITE / FINAL_ASSAULT / HIDDEN_CORE write this.deadline themselves. Zeroing it
    // hides every countdown and turning timers back on cannot restore that clock.
    if (this.phase === PHASE.COMBAT || this.phase === PHASE.UNITE || this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE || this.fields.some((f) => f && f.live)) {
      return fail(ERR.WRONG_PHASE, 'timers');
    }
    if (this.phase === PHASE.LOBBY || this.phase === PHASE.RESULT) return fail(ERR.WRONG_PHASE);
    if (on === this.testTimers) return OK;
    if (on) {
      const held = this._testHeld;
      this.testTimers = true;
      this._testHeld = null;
      if (held) this.setDeadline(held.seconds, held.fn, { silent: !!held.silent });
    } else {
      this.testTimers = false;
      const armed = this._testArmed;
      this.cancel(this._phaseTimer);
      this._phaseTimer = null;
      this.deadline = 0;
      this._testHeld = armed || null;
    }
    if (this.phase === PHASE.BAND_DRAFT && this.draft) this.draft.turnDeadline = this.deadline;
    this.markPublic();
    return OK;
  }

  _testBond(ps, id, layers, count) {
    const blocked = this._testQuiet();
    if (blocked) return blocked;
    if (!this.gd.bond(id) || this.gd.modeInactiveBonds.has(id)) return fail(ERR.BAD_TARGET, 'bond');
    const cur = ps.layers[id] || 0;
    if (layers < cur) return fail(ERR.BAD_TARGET, 'layers');
    // [ASSUMED] count is an absolute extra member count, applied by the ordinary bond calculator.
    // A count-only change still recomputes, so the player's own bond strip updates.
    if (count !== undefined) ps.bondCountBonus[id] = count;
    if (layers === cur) {
      if (count !== undefined) ps.recompute();
      return OK;
    }
    const delta = layers - cur;
    if (layerGainRoom(cur, delta) !== delta) return fail(ERR.BAD_TARGET);
    const add = ps.addLayers(id, delta, { reason: 'test' });
    if (add !== delta) return fail(ERR.BAD_TARGET);
    return OK;
  }

  _testStrategy(ps, id, resetLp) {
    if (this.fields.some((f) => f && f.live)) return fail(ERR.WRONG_PHASE);
    if (BLOCKED.has(this.phase) || this.phase === PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
    if (!this.gd.bandAllowed(id)) return fail(ERR.BAD_TARGET);
    if (this.phase === PHASE.BAND_DRAFT) return this.pickBand(ps, id);
    if (this.bandTaken(id, ps.playerId)) return fail(ERR.BAD_TARGET);
    ps.bandId = id;
    if (this.draft) this.draft.picks[ps.playerId] = id;
    if (resetLp) ps.lp = this.gd.startLp(id);
    ps.dirty();
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  _testBounty(ps, enemyKey) {
    const blocked = this._testQuiet();
    if (blocked) return blocked;
    const enemy = this.gd.enemy(enemyKey);
    if (!enemy || this.gd.inactiveEnemies.has(enemyKey)) return fail(ERR.BAD_TARGET);
    const id = this.addBounty(ps, {
      enemyKey,
      name: typeof enemy.name === 'string' && enemy.name ? enemy.name : enemyKey,
      coin: 0,
      payout: 'kill',
      count: 1,
      rounds: 1,
    });
    if (!id) return fail(ERR.BAD_TARGET);
    return OK;
  }

  _testChoice(ps, idx, choiceId) {
    if (choiceId !== undefined) return this.pickPersonalChoice(ps, idx, choiceId);
    if (this.phase !== PHASE.SP_DRAFT) return fail(ERR.WRONG_PHASE);
    return this.pickCard(ps, idx);
  }
}
