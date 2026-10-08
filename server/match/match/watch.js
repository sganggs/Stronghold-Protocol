// server/match/match/watch.js — Match methods: watching (research 09 §3.1 / §6.3) — spectator seats (community report
// #26: stand-ins shown fields like an eliminated player), g.watch in both combat modes (the boss-group rule, prep
// scouting of a teammate's board), who is shown which field (the default watch, the boss fields, the resend on a
// reconnect, the spectator's spec without the funds), a field's m.field + b.snap (server-run mode) and the prep-scout
// pushes (GitHub #87). Eliminated humans and spectator seats follow a player through every phase reset (community
// report of 2026-10-06, item 56; the official DeadAutoObDn { obIndex, state, preparation }, research 09 §3.1; the idea
// of PR #189): the player they last watched with a manual g.watch (`watchPref`), else the first player still in.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { snapFrame } from '../fields.js';
import { OK, fail } from './common.js';

export class MatchWatch {
  /**
   * A spectator seat (community report #26; server/lobby.js spectate) joined during the match, came back or asked for a
   * resync: registered once, then resent what an eliminated player watching sees (_resync — never an m.private).
   */
  addSpectator(playerId) {
    if (this.disposed) return;
    const s = this._spectator(playerId);
    if (s) this.guard(() => this._resync(s));
  }

  /** The spectator left (room.leave / g.leave, removed by the host, reconnect window expired). */
  removeSpectator(playerId) {
    if (this.spectators.delete(playerId)) this.watchers.delete(playerId);
  }

  /** The stand-in of a spectator seat, created once (null for a player's id or a bad id). */
  _spectator(playerId) {
    if (typeof playerId !== 'string' || !playerId || this.players.has(playerId)) return null;
    let s = this.spectators.get(playerId);
    if (!s) {
      s = Object.freeze({ playerId, isBot: false, left: false, alive: false, connected: true, spectator: true });
      this.spectators.set(playerId, s);
    }
    return s;
  }

  /** Everyone shown fields: the seated humans still in (seat order), then the spectator seats' stand-ins. */
  _viewers() {
    const out = this.order.filter((ps) => !ps.isBot && !ps.left);
    for (const s of this.spectators.values()) out.push(s);
    return out;
  }

  /**
   * g.watch { fieldId, playerId? } — `playerId`: the player the viewer tapped (a shared 联防 / boss pair field shows two,
   * its id does not say which; recorded as the watch preference when that player is on the field).
   */
  watch(ps, fieldId, playerId = null) {
    if (typeof fieldId !== 'string') return fail(ERR.BAD_TARGET);
    if (this.clientCombat && this.fields.length && this.fields.some((x) => x.cc)) return this._watchClient(ps, fieldId, playerId);
    const f = this.fields.find((x) => x.fieldId === fieldId);
    if (f) {
      // 最终攻势 / 隐秘核心: "两名参与者会处于同一个战场，但无法查看另一组队友的战场情况" — a fighting player sees its own
      // boss field only (eliminated / departed players spectate freely)
      const own = this.fieldOf(ps);
      if ((f.kind === 'boss' || f.kind === 'hidden') && own && own !== f.fieldId) return fail(ERR.BAD_TARGET, 'other group hidden');
      this.watchers.set(ps.playerId, fieldId);
      this._watchPrefSet(ps, f, playerId);
      this._sendField(ps.playerId, fieldId);
      return OK;
    }
    if (fieldId.startsWith('n:')) {
      // prep scouting, only while no battle field is up: during 各自行动 / 联防 / 最终攻势 / 隐秘核心 an 'n:<pid>' id
      // must name a live field (else the boss-group rule above could be bypassed, and the viewer would stop receiving
      // its own field's snapshots). The scout stays in `watchers` so a later board change pushes prepFieldMeta again
      // (GitHub #87); combat start clears the map and reassigns live fields, spectators included.
      if (this.fields.length) return fail(ERR.BAD_TARGET, 'no such field');
      const target = this.players.get(fieldId.slice(2));
      if (!target || !target.alive) return fail(ERR.BAD_TARGET);
      this.watchers.set(ps.playerId, fieldId);
      if (target !== ps) this.watchPref.set(ps.playerId, target.playerId);
      this._notifyPrepScouts(target, { to: ps.playerId });
      return OK;
    }
    return fail(ERR.BAD_TARGET);
  }

  /**
   * Record the player a manual watch of field `f` names: `playerId` when it is one of the field's players, else the
   * field's only player — never the viewer itself; a shared field without `playerId` names nobody (PR #189's review).
   * Only manual watches write it: the automatic assignments below read it.
   */
  _watchPrefSet(ps, f, playerId = null) {
    const players = Array.isArray(f?.players) ? f.players : [];
    const pid = typeof playerId === 'string' && players.includes(playerId) ? playerId : players.length === 1 ? players[0] : null;
    if (pid && pid !== ps.playerId) this.watchPref.set(ps.playerId, pid);
  }

  /**
   * The player a viewer follows (an eliminated human, a spectator seat): its watch preference while that player is
   * still in, else the first player still in (seat order — the official FindFirstAvailObTarget, AI teammates included:
   * the remake's AI seats are players), never the viewer itself; null when nobody is left.
   */
  _watchTargetOf(ps) {
    const ok = (pid) => { const t = typeof pid === 'string' && pid !== ps.playerId ? this.players.get(pid) : null; return !!t && t.alive && !t.left; };
    const pref = this.watchPref.get(ps.playerId);
    if (ok(pref)) return pref;
    return this.order.find((q) => ok(q.playerId))?.playerId ?? null;
  }

  /** The field of the player `ps` follows among `fields` (null when that player has none this phase). */
  _watchTargetField(ps, fields) {
    const pid = this._watchTargetOf(ps);
    return pid ? fields.find((f) => Array.isArray(f.players) && f.players.includes(pid)) || null : null;
  }

  /** Does `ps` follow a player (an eliminated human or a spectator seat, still in the room)? */
  _follows(ps) {
    return !!ps && !ps.isBot && !ps.left && (ps.spectator || !ps.alive);
  }

  /**
   * A prep phase (回合开始 / 机变 / 休整期): an eliminated human / spectator seat scouts the board of the player it follows
   * — `keep`: a scout it already has this phase stays (a manual pick, a resync). Until 0.2.0 a phase reset dropped it
   * onto its own empty board every round (community report of 2026-10-06, item 56).
   */
  _followScout(ps, { keep = false } = {}) {
    if (!this._follows(ps) || this.fields.length) return;
    const cur = keep ? this.watchers.get(ps.playerId) : null;
    const kept = typeof cur === 'string' && cur.startsWith('n:') ? this.players.get(cur.slice(2)) : null;
    const target = kept && kept.alive && !kept.left ? kept : this.players.get(this._watchTargetOf(ps));
    if (!target) return;
    this.watchers.set(ps.playerId, `n:${target.playerId}`);
    if (ps.connected) this._notifyPrepScouts(target, { to: ps.playerId });
  }

  /**
   * g.watch under client-side combat: the watcher gets the field's spec (b.start, display only) and runs a local
   * replica fast-forwarded to the field's clock. No watching while the own normal battle runs; the other pair's boss
   * field is never shown to a fighting player; eliminated players may watch anything.
   */
  _watchClient(ps, fieldId, playerId = null) {
    const f = this.fields.find((x) => x.fieldId === fieldId) || null;
    if (!f) return fail(ERR.BAD_TARGET, 'no such field');
    const own = this.fields.find((x) => x.players.includes(ps.playerId)) || null;
    if (ps.alive) {
      if ((f.kind === 'boss' || f.kind === 'hidden') && own && own !== f) return fail(ERR.BAD_TARGET, 'other group hidden');
      if (f.kind === 'normal' && own && own !== f && own.live) return fail(ERR.WRONG_PHASE, 'own battle running');
    }
    this.watchers.set(ps.playerId, f.fieldId);
    this._watchPrefSet(ps, f, playerId);
    this.sendTo(ps.playerId, this._startMsg(f, ps.playerId, { watch: !f.players.includes(ps.playerId) }));
    return OK;
  }

  /**
   * Reconnect / resync: the spec of the field the player is on (fast-forwarded by the client); an eliminated human /
   * spectator seat the field it watches, else the one of the player it follows. With no client field up (a prep phase):
   * the board of the player it follows (item 56; PR #189's review — a resync in prep used to show nothing).
   */
  _resendBattle(ps) {
    if (!this.fields.some((f) => f.cc)) { this._followScout(ps, { keep: true }); return; }
    const fid = this.watchers.get(ps.playerId);
    let f = fid ? this.fields.find((x) => x.fieldId === fid) : null;
    if (!f) f = this.fields.find((x) => x.players.includes(ps.playerId)) || (this.phase === PHASE.UNITE ? this.fields[0] : null);
    if (!f && !ps.alive) f = this._watchTargetField(ps, this.fields) || this.fields[0] || null;
    if (!f) return;
    this.watchers.set(ps.playerId, f.fieldId);
    this.sendTo(ps.playerId, this._startMsg(f, ps.playerId, { watch: !f.players.includes(ps.playerId) }));
  }

  _defaultWatch() {
    this.watchers.clear();
    for (const ps of this._viewers()) {
      const own = this.fields.find((f) => f.players.includes(ps.playerId));
      // an eliminated human / spectator seat: the field of the player it follows (item 56), else the first
      const f = own || this._watchTargetField(ps, this.fields) || this.fields[0];
      if (!f) continue;
      this.watchers.set(ps.playerId, f.fieldId);
      if (ps.connected) this._sendField(ps.playerId, f.fieldId);
    }
  }

  /**
   * b.start of the boss fields: players get their own pair field, eliminated humans and spectator seats the field of
   * the player they follow (item 56), else the first.
   */
  _watchBossFields(fields) {
    for (const ps of this._viewers()) {
      const own = fields.find((f) => f.players.includes(ps.playerId)) || null;
      const f = own || this._watchTargetField(ps, fields) || fields[0];
      if (!f) continue;
      this.watchers.set(ps.playerId, f.fieldId);
      this._sendStart(ps.playerId, f, { watch: !own });
    }
  }

  /**
   * The spec a spectator seat is shown: the field's own, minus the players' `contentInfo.funds` — a private number (the
   * player's funds at the battle start) that no battle effect reads, so the replica still plays the same battle. The
   * other contentInfo counters stay: battle effects read them (sim/content: handUnits, roundStats.gainedChess).
   */
  _spectatorSpec(f) {
    if (!f.spectatorSpec) {
      const s = f.spec;
      const strip = (p) => {
        if (!p || !p.contentInfo || !Object.hasOwn(p.contentInfo, 'funds')) return p;
        const { funds, ...contentInfo } = p.contentInfo;
        void funds;
        return { ...p, contentInfo };
      };
      f.spectatorSpec = s && Array.isArray(s.players) ? { ...s, players: s.players.map(strip) } : s;
    }
    return f.spectatorSpec;
  }

  /** Humans currently shown a field (its players and its watchers, spectator seats included). */
  _humansShowing(f) {
    const out = new Set();
    for (const pid of f.players) out.add(pid);
    for (const [pid, fid] of this.watchers) if (fid === f.fieldId) out.add(pid);
    return [...out].filter((pid) => { const ps = this.players.get(pid) || this.spectators.get(pid); return ps && !ps.isBot && !ps.left; });
  }

  watchersOf(fieldId) {
    const out = [];
    for (const [pid, fid] of this.watchers) if (fid === fieldId) out.push(pid);
    return out;
  }

  _sendField(playerId, fieldId) {
    const f = this.fields.find((x) => x.fieldId === fieldId);
    if (f) {
      let meta;
      try { meta = f.battle.fieldMeta(); } catch (e) { this.reportError('fieldMeta', e); return; }
      this.sendTo(playerId, { t: 'm.field', ...meta, fieldId: f.fieldId, kind: f.kind, live: !!f.live });
      try { this.sendTo(playerId, snapFrame(f.fieldId, f.battle.snapshot())); } catch (e) { this.reportError('snapshot', e); }
      return;
    }
    if (typeof fieldId === 'string' && fieldId.startsWith('n:')) {
      const target = this.players.get(fieldId.slice(2));
      if (target && target.alive) this.sendTo(playerId, this.prepFieldMeta(target));
    }
  }

  /**
   * Push prepFieldMeta to whoever is scouting `ps` during prep (GitHub #87). `to` always receives the current view
   * (the player who just asked to watch); everyone scouting it receives a new `m.field` only when that view changed.
   * A live battle field owns the `n:<pid>` id, so this stays quiet once fields exist.
   */
  _notifyPrepScouts(ps, { to = null } = {}) {
    if (!ps || !ps.alive || this.fields.length) return;
    const fid = `n:${ps.playerId}`;
    const watchers = this.watchersOf(fid);
    if (!watchers.length) return;
    const meta = this.prepFieldMeta(ps);
    // Deduplicate the public payload itself: effects and enemy previews can change without any piece moving (#346).
    const sig = JSON.stringify(meta);
    const changed = sig !== ps._prepScoutSig;
    ps._prepScoutSig = sig;
    const dest = changed ? watchers : (to ? [to] : []);
    if (!dest.length) return;
    for (const pid of dest) this.sendTo(pid, meta);
  }
}
