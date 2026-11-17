// server/sim/battle/hooks.js — Battle methods: the hook bus (on / off / offOwner / emit, the MAX_HOOK_DEPTH guard and
// its chain diagnostics), the timers (after / every, run at the start of each tick) and the isolation of content
// callbacks (_safe, _handlerError: a failing handler is skipped and counted; repeated engine errors end the battle as a
// timeout).
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { TICK, MAX_INTERNAL_ERRORS, MAX_HOOK_DEPTH } from '../constants.js';

let hookSeq = 0;

let schedSeq = 0;

export class BattleHooks {
  // =============================================================================================================
  // hook bus

  on(name, fn, opts = {}) {
    if (typeof fn !== 'function') return null;
    const h = { name, fn, priority: Number(opts.priority) || 0, owner: opts.owner ?? null, seq: ++hookSeq, removed: false, once: !!opts.once };
    const list = this._hooks[name] ?? (this._hooks[name] = []);
    let i = list.length;
    while (i > 0 && list[i - 1].priority < h.priority) i--; // loop-cap: hook list length
    list.splice(i, 0, h);
    return h;
  }

  off(nameOrHandle, fn) {
    if (nameOrHandle && typeof nameOrHandle === 'object') {
      const h = nameOrHandle;
      h.removed = true;
      const list = this._hooks[h.name];
      if (list) {
        const i = list.indexOf(h);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) delete this._hooks[h.name];
      }
      return;
    }
    const list = this._hooks[nameOrHandle];
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) if (!fn || list[i].fn === fn) { list[i].removed = true; list.splice(i, 1); }
    if (!list.length) delete this._hooks[nameOrHandle];
  }

  /** Remove every hook and scheduled callback registered with `owner`. */
  offOwner(owner) {
    for (const name of Object.keys(this._hooks)) {
      const list = this._hooks[name];
      for (let i = list.length - 1; i >= 0; i--) if (list[i].owner === owner) { list[i].removed = true; list.splice(i, 1); }
      if (!list.length) delete this._hooks[name];
    }
    for (const s of this._sched) if (s.owner === owner) s.cancelled = true;
  }

  hasHook(name) { return !!this._hooks[name]; }

  emit(name, ctx) {
    const list = this._hooks[name];
    if (!list) return ctx;
    // Recursion guard: handlers that re-trigger their own event (damaged → dealDamage → damaged …) would otherwise
    // recurse until a stack overflow, whose depth (and thus the outcome) depends on the machine — not deterministic.
    if (this._emitDepth >= MAX_HOOK_DEPTH) {
      this._handlerError(`hookDepth:${name}`, null, new Error(`hook nesting deeper than ${MAX_HOOK_DEPTH}; handlers skipped — ${this._chain(name)}`));
      return ctx;
    }
    const d = this._emitDepth++;
    // The hooks are iterated over a snapshot (a handler may add / remove hooks): one buffer per nesting level, reused
    // across emits — this runs several times a tick, so a fresh `slice()` per call was pure garbage.
    const arr = (this._emitBufs ?? (this._emitBufs = []))[d] ?? (this._emitBufs[d] = []);
    arr.length = list.length;
    for (let i = 0; i < list.length; i++) arr[i] = list[i];
    this._frameCtx[d] = ctx;
    try {
      for (let i = 0; i < arr.length; i++) {
        const h = arr[i];
        if (h.removed) continue;
        this._frameName[d] = name;
        this._frameOwner[d] = h.owner;
        try { h.fn(ctx, this); } catch (e) { this._handlerError(`hook:${name}`, h.owner, e); }
        if (h.once) this.off(h);
        if (ctx && ctx.stopPropagation) break;
      }
    } finally {
      this._emitDepth--;
      arr.length = 0; // drop the snapshot's references: a hook removed after this emit must not stay reachable
    }
    return ctx;
  }

  /**
   * The open hook/callback frames (outermost first) — names the loop when the nesting guard trips, e.g.
   * "chain: hit(enemy_1430_lrrook) > damaged(chess_char_3_18_a) > hit(enemy_1430_lrrook) > … > damaged".
   */
  _chain(last) {
    const id = (u) => (u && typeof u === 'object' ? (u.defId ?? u.name ?? '?') : u == null ? '' : String(u));
    const lab = (i) => {
      const o = this._frameOwner[i];
      let who = id(o);
      const c = this._frameCtx[i];
      if (!who && c && typeof c === 'object') { // global handler: show the units of the event instead
        const a = c.source ?? c.attacker ?? c.killer ?? null, t = c.target ?? c.unit ?? c.victim ?? c.enemy ?? null;
        who = a || t ? `${id(a)}→${id(t)}` : '';
      }
      return `${this._frameName[i]}${who ? `(${who})` : ''}`;
    };
    const n = this._emitDepth;
    const parts = [];
    for (let i = 0; i < Math.min(n, 4); i++) parts.push(lab(i));
    if (n > 12) parts.push('…');
    for (let i = Math.max(4, n - 8); i < n; i++) parts.push(lab(i));
    parts.push(last);
    return `chain: ${parts.join(' > ')}`;
  }

  // =============================================================================================================
  // scheduling

  after(seconds, fn, opts = {}) {
    const s = { due: this.time + Math.max(0, Number(seconds) || 0), fn, owner: opts.owner ?? null, interval: 0, seq: ++schedSeq, cancelled: false, holdsBattle: !!opts.holdsBattle };
    s.cancel = () => { s.cancelled = true; };
    this._sched.push(s);
    return s;
  }

  every(seconds, fn, opts = {}) {
    const iv = Math.max(TICK, Number(seconds) || TICK);
    const s = { due: this.time + (opts.immediate ? 0 : iv), fn, owner: opts.owner ?? null, interval: iv, seq: ++schedSeq, cancelled: false, count: 0, holdsBattle: false };
    s.cancel = () => { s.cancelled = true; };
    this._sched.push(s);
    return s;
  }

  _runScheduled() {
    const all = this._sched;
    if (!all.length) return;
    const now = this.time + 1e-9;
    // Collected into a reused buffer (one per nesting level, emptied afterwards): this runs every tick, and `filter`
    // plus `slice` allocated two arrays per tick.
    const bufs = this._dueBufs ?? (this._dueBufs = []);
    const depth = this._runDepth ?? 0;
    const due = bufs[depth] ?? (bufs[depth] = []);
    due.length = 0;
    this._runDepth = depth + 1;
    try {
      let cancelled = 0;
      for (let i = 0; i < all.length; i++) {
        const s = all[i];
        if (s.cancelled) { cancelled++; continue; }
        if (s.due <= now) due.push(s);
      }
      if (!due.length) {
        if (cancelled) this._compactDue();
        return;
      }
      due.sort((a, b) => a.due - b.due || a.seq - b.seq);
      for (let i = 0; i < due.length; i++) {
        const s = due[i];
        if (s.cancelled) continue;
        if (s.interval > 0) {
          let n = 0;
          while (s.due <= now && !s.cancelled && n++ < 8) { // loop-cap: battle.every at most 8 per tick
            s.count++;
            this._safe(() => s.fn(this, s), 'every', s.owner);
            s.due += s.interval;
          }
          if (s.due <= now) s.due = this.time + s.interval;
        } else {
          s.cancelled = true;
          this._safe(() => s.fn(this, s), 'after', s.owner);
        }
      }
      this._compactDue();
    } finally {
      this._runDepth = depth;
      due.length = 0; // a fired timer must not stay reachable through the scratch buffer
    }
  }

  /** Drop cancelled timers in place (the list is read every tick; a fresh array per tick was garbage). */
  _compactDue() {
    const all = this._sched;
    let m = 0;
    for (let i = 0; i < all.length; i++) { const s = all[i]; if (!s.cancelled) all[m++] = s; }
    all.length = m;
  }

  // =============================================================================================================
  // callback isolation and errors

  /** Run a content callback (skill/buff/projectile/timer/install) isolated from errors; shares the hook depth guard. */
  _safe(fn, label, owner = null) {
    if (this._emitDepth >= MAX_HOOK_DEPTH) {
      this._handlerError(`hookDepth:${label}`, owner, new Error(`callback nesting deeper than ${MAX_HOOK_DEPTH}; skipped — ${this._chain(label)}`));
      return undefined;
    }
    const d = this._emitDepth++;
    this._frameName[d] = label;
    this._frameOwner[d] = owner;
    this._frameCtx[d] = null;
    try { return fn(); } catch (e) { this._handlerError(label, owner, e); return undefined; } finally { this._emitDepth--; }
  }

  _handlerError(label, owner, e, internal = false) {
    this.errorCount++;
    const who = owner && owner.defId ? owner.defId : (owner && owner.name) || '';
    const key = `${label}|${who}|${e && e.message}`;
    if (!this._errKeys.has(key)) {
      this._errKeys.add(key);
      if (this.errors.length < 100) this.errors.push({ label, who, message: String(e && e.message), stack: e && e.stack });
      if (this.opts.quiet !== true) this.logger.error?.(`[sim] ${label}${who ? ' (' + who + ')' : ''} failed: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
    }
    // Content handler errors are isolated (the handler is skipped, the battle continues). Repeated *engine*
    // errors mean the field state is suspect: force-end it as a timeout (DESIGN §11).
    if (internal) {
      this.internalErrorCount = (this.internalErrorCount ?? 0) + 1;
      if (this.internalErrorCount > MAX_INTERNAL_ERRORS && !this.finished && !this._forcing) {
        this._forcing = true;
        try { this.forceEnd('timeout'); } catch { this._hardFinish('timeout'); }
      }
    }
  }

  _internalError(label, e) { this._handlerError('internal:' + label, null, e, true); }
}
