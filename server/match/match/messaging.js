// server/match/match/messaging.js — Match methods: messaging — unicast, broadcast, toasts, the ticker lines
// (config.broadcasts by type; the remake's CUSTOM lines), the dirty marks and flush: m.private per player only when it
// changed (plus the prep scouts of that player's board), m.public throttled (DELAYS.PUBLIC_THROTTLE) and deduplicated.
// i18n (docs/I18N.md): a toast / CUSTOM line is a string (its own msgid) or a shared/i18n.js msg(msgid, params); the frame
// carries `text` (the Chinese rendering, what older clients show) plus `msgid` / `params`; a broadcast line carries its
// `args` so the client can fill the localized config.broadcasts template.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { DELAYS } from './common.js';
import { wireMessage } from '../../../shared/i18n.js';

export class MatchMessaging {
  sendTo(playerId, msg) {
    if (this.disposed) return false;
    const ps = this.players.get(playerId) || this.spectators.get(playerId);
    if (!ps || ps.isBot || ps.left) return false;
    try { return !!this.sendFn(playerId, msg); } catch (e) { this.reportError('send', e); return false; }
  }

  broadcast(msg) {
    if (this.disposed) return;
    try { this.broadcastFn(msg); } catch (e) { this.reportError('broadcast', e); }
  }

  /** @param {string|{ msgid: string, params?: object }} text a string or msg() (shared/i18n.js) */
  toast(ps, kind, text) {
    if (!ps || ps.isBot || ps.left || !ps.connected) return;
    this.sendTo(ps.playerId, { t: 'm.toast', kind, ...wireMessage(text) });
  }

  /** Broadcast ticker from config.broadcasts by type; `param` picks the variant (SHOP_LEVEL level, BOSS_HIT share…). */
  tickerFor(type, args = [], { playerId = null, to = null, param = null } = {}) {
    const list = Array.isArray(this.gd.config.broadcasts) ? this.gd.config.broadcasts.filter((b) => b && b.type === type) : [];
    let b = list[0];
    if (param != null) b = list.find((x) => Array.isArray(x.params) && x.params.includes(String(param))) || b;
    const tpl = b && typeof b.text === 'string' ? b.text : null;
    if (!tpl) return;
    const text = tpl.replace(/\{(\d)\}/g, (_, i) => (args[Number(i)] != null ? String(args[Number(i)]) : ''));
    const msg = { t: 'm.ticker', text, id: b.id, type, priority: Number(b.priority) || 0, playerId, args: args.map((a) => String(a ?? '')) };
    if (to) this.sendTo(to, msg);
    else this.broadcast(msg);
  }

  /**
   * A ticker line of the remake's own (type CUSTOM). `priority`: the match-flow notices (隐秘核心已解锁, 联防阶段, a player out
   * or gone) take FLOW_TICKER_PRIORITY so the strip does not hold them behind shop-level lines; other lines 0.
   */
  tickerText(text, priority = 0) {
    if (!text) return;
    const w = wireMessage(text);
    this.broadcast({ t: 'm.ticker', ...w, text: w.text.slice(0, 200), id: null, type: 'CUSTOM', priority: Number(priority) || 0, playerId: null });
  }

  markPublic() { this._pubDirty = true; }
  /**
   * A player's state changed: its m.private and (throttled, deduplicated) m.public (level, board, bonds…) — in a boss
   * round's prep also its pair partner's m.private, which shows this board on its other half (bossMate, item 51).
   */
  markPrivate(ps) {
    if (!ps) return;
    this._privDirty.add(ps);
    this._pubDirty = true;
    const m = this._bossMateOf(ps);
    if (m) this._privDirty.add(m.mate);
  }

  /** Send pending m.private (per player, only when changed) and m.public (throttled ≤ 10/s). */
  flush(forcePublic = false) {
    if (this.disposed) return;
    this._syncBattleSpeed();
    if (this._privDirty.size) {
      const list = [...this._privDirty];
      this._privDirty.clear();
      for (const ps of list) {
        if (!(ps.isBot || ps.left || !ps.connected)) this._sendPrivate(ps, false);
        this._notifyPrepScouts(ps);
      }
    }
    if (this._pubDirty || forcePublic) this._maybeSendPublic(forcePublic);
  }

  _sendPrivate(ps, force) {
    let view;
    try { view = ps.privateView(); } catch (e) { this.reportError('privateView', e); return; }
    const json = JSON.stringify(view);
    if (!force && json === ps._lastPriv) return;
    ps._lastPriv = json;
    this.sendTo(ps.playerId, view);
  }

  _maybeSendPublic(force) {
    const now = this.sched.now();
    if (!force && now - this._lastPubAt < DELAYS.PUBLIC_THROTTLE) {
      if (!this._pubTimer) {
        const wait = Math.max(1, DELAYS.PUBLIC_THROTTLE - (now - this._lastPubAt));
        this._pubTimer = this.sched.setTimeout(() => {
          this._pubTimer = null;
          if (this.disposed) return;
          try { this._maybeSendPublic(false); } catch (e) { this.reportError('public', e); }
        }, wait);
      }
      return;
    }
    this._pubDirty = false;
    let view;
    try { view = this.publicView(); } catch (e) { this.reportError('publicView', e); return; }
    const { serverNow, ...rest } = view;
    const json = JSON.stringify(rest);
    if (!force && json === this._lastPubJson) return;
    this._lastPubJson = json;
    // Snapshot building / serialization can take time; throttle from the actual broadcast, not its start.
    this._lastPubAt = this.sched.now();
    this.broadcast(view);
  }
}
