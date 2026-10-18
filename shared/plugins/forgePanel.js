// shared/plugins/forgePanel.js — the Forge panel shim (docs/PLUGINS.md §16). No Node APIs.
// A copied Forge panel runs only in the player's sandboxed ui iframe. This file is the ctx that panel sees.
// The importer inlines installForgeShim into ui/index.html (script-src 'unsafe-inline'). It does not execute the panel.
//
// [ASSUMED] Forge's net.status().ping is the number we receive as host message field `rtt`. The wire key is not
// `ping`: that string is a client→server intent (isMatchIntent). Forge's net.welcome().version is a string; ours is
// the decimal text of PROTOCOL_VERSION. mods.digest is the first 8 hex digits of the real room cs, omitted when
// unavailable. data.get returns a clone only
// for a table the panel declared and the caller supplied (chess / assets); anything else is null. Calls we cannot
// feed return { available: false, reason: 'not available in this game' } and no invented payload.

/** Fresh each call so one panel cannot change the reason another panel reads. */
export function forgeUnavailable() {
  return { available: false, reason: 'not available in this game' };
}

/**
 * Install the shim on `root` (the iframe's globalThis, or a test object).
 * The function closes over nothing outside its body: the importer pastes its source into the frame.
 * @param {Record<string, any>} root
 */
export function installForgeShim(root) {
  const g = root;
  const REASON = 'not available in this game';
  const unavailable = () => ({ available: false, reason: REASON });
  const keyOk = (k) => typeof k === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(k)
    && k !== '__proto__' && k !== 'constructor' && k !== 'prototype' && !k.includes('..');
  const scalar = (v) => v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

  function plain(v, d, seen) {
    if (v == null) return v;
    const kind = typeof v;
    if (kind === 'number') return Number.isFinite(v) ? v : null;
    if (kind === 'string') return v.length > 500 ? v.slice(0, 500) : v;
    if (kind === 'boolean') return v;
    if (kind !== 'object' || d > 8) return null;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) {
      const a = [];
      const n = v.length < 64 ? v.length : 64;
      for (let i = 0; i < n; i += 1) a.push(plain(v[i], d + 1, seen));
      return a;
    }
    const o = {};
    const keys = Object.keys(v);
    const n = keys.length < 64 ? keys.length : 64;
    for (let i = 0; i < n; i += 1) {
      const k = keys[i];
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      o[k] = plain(v[k], d + 1, seen);
    }
    return o;
  }

  function translate(feed, msgid, vars) {
    const key = String(msgid ?? '');
    const strings = feed.strings || {};
    const lang = feed.lang || 'zh';
    const primary = strings[lang];
    const zh = strings.zh;
    let s = primary && typeof primary[key] === 'string' ? primary[key]
      : zh && typeof zh[key] === 'string' ? zh[key] : key;
    if (vars && typeof vars === 'object') {
      s = s.replace(/\{(\w+)\}/g, (all, name) => (vars[name] != null ? String(vars[name]) : all));
    }
    return s;
  }

  function paint(feed) {
    const doc = feed.doc;
    // querySelector('.screen.result') matches the document element in browsers. The class is also put on body
    // so a selector that starts at body still sees it. `.st` is never added: that class hides the damage table.
    const nodes = [];
    if (doc && doc.documentElement) nodes.push(doc.documentElement);
    if (doc && doc.body) nodes.push(doc.body);
    for (let i = 0; i < nodes.length; i += 1) {
      const list = nodes[i].classList;
      if (!list || typeof list.add !== 'function' || typeof list.remove !== 'function') continue;
      list.remove('screen', 'result', 'room-screen', 'st');
      if (feed.marker === 'result' && feed.result) list.add('screen', 'result');
      if (feed.marker === 'room' && feed.room && Array.isArray(feed.room.seats) && feed.room.seats.length) list.add('room-screen');
    }
  }

  function emit(feed, msg) {
    if (typeof feed.post === 'function') { feed.post(msg); return; }
    try { g.parent.postMessage(msg, '*'); } catch { /* no parent in a test */ }
  }

  function dispatch(feed, type, payload) {
    const list = feed.listeners[type];
    if (!list) return;
    for (let i = 0; i < list.length; i += 1) {
      try { list[i](payload); } catch (err) { try { g.console.error(err); } catch { /* no console */ } }
    }
  }

  function create(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const feed = {
      id: typeof o.id === 'string' ? o.id : '',
      pack: typeof o.pack === 'string' ? o.pack : '',
      slot: typeof o.slot === 'string' ? o.slot : '',
      order: typeof o.order === 'number' ? o.order : 0,
      gate: o.gate == null ? null : o.gate,
      hostKey: o.hostKey == null ? null : o.hostKey,
      host: o.host || null,
      doc: o.doc || (o.host && o.host.ownerDocument) || null,
      marker: o.marker === 'result' || o.marker === 'room' ? o.marker : null,
      lang: typeof o.lang === 'string' ? o.lang : 'zh',
      strings: o.strings && typeof o.strings === 'object' ? o.strings : {},
      declared: Array.isArray(o.declared) ? o.declared : [],
      tables: o.data && typeof o.data === 'object' ? o.data : {},
      prefs: {},
      post: typeof o.post === 'function' ? o.post : null,
      version: null,
      plugins: null,
      cs: null,
      room: null,
      result: null,
      hasResult: false,
      net: null,
      meId: null,
      meName: null,
      listeners: Object.create(null),
    };
    if (o.prefs && typeof o.prefs === 'object') {
      for (const k of Object.keys(o.prefs)) if (keyOk(k) && scalar(o.prefs[k])) feed.prefs[k] = o.prefs[k];
    }
    const log = {
      info() { try { g.console.info.apply(g.console, arguments); } catch { /* ignore */ } },
      warn() { try { g.console.warn.apply(g.console, arguments); } catch { /* ignore */ } },
      error() { try { g.console.error.apply(g.console, arguments); } catch { /* ignore */ } },
    };
    const ctx = {
      id: feed.id,
      pack: feed.pack,
      slot: feed.slot,
      order: feed.order,
      gate: feed.gate,
      hostKey: feed.hostKey,
      host: feed.host,
      log,
      t(msgid, vars) { return translate(feed, msgid, vars); },
      net: {
        on(type, fn) {
          const name = typeof type === 'string' ? type : '';
          if (typeof fn !== 'function') return () => {};
          if (name !== 'room.state' && name !== 'm.result') return () => {};
          if (!feed.listeners[name]) feed.listeners[name] = [];
          feed.listeners[name].push(fn);
          return () => {
            const list = feed.listeners[name];
            if (!list) return;
            const at = list.indexOf(fn);
            if (at >= 0) list.splice(at, 1);
          };
        },
        status() {
          if (!feed.net) return null;
          const n = feed.net;
          return {
            status: n.status, attempt: n.attempt, retryAt: n.retryAt, ping: n.rtt, lastError: n.lastError,
          };
        },
        welcome() {
          if (feed.version == null && !feed.plugins) return null;
          const packs = Array.isArray(feed.plugins) ? feed.plugins.slice() : [];
          const mods = { packs };
          if (feed.cs) mods.digest = feed.cs.slice(0, 8);
          return { version: feed.version == null ? '' : String(feed.version), mods };
        },
        send() { return unavailable(); },
        sendResourceMessage() { return unavailable(); },
      },
      get me() {
        const mods = Array.isArray(feed.plugins) ? feed.plugins.slice() : null;
        return {
          playerId: feed.meId,
          name: feed.meName,
          room: mods ? { mods } : null,
        };
      },
      data: {
        get(table) {
          if (typeof table !== 'string' || !feed.declared.includes(table)) return null;
          if (table !== 'chess' && table !== 'assets') return null;
          if (!Object.prototype.hasOwnProperty.call(feed.tables, table)) return null;
          return plain(feed.tables[table], 0, new WeakSet());
        },
      },
      session: {
        getPref(key, fallback) {
          if (!keyOk(key) || !Object.prototype.hasOwnProperty.call(feed.prefs, key)) return fallback;
          return feed.prefs[key];
        },
        setPref(key, value) {
          if (!keyOk(key) || !scalar(value)) return false;
          if (typeof value === 'string' && value.length > 4096) return false;
          if (value == null) delete feed.prefs[key];
          else feed.prefs[key] = value;
          emit(feed, { v: 1, t: 'storage', op: value == null ? 'delete' : 'set', key, value });
          return true;
        },
        setPreload() { return unavailable(); },
        send() { return unavailable(); },
      },
    };
    feed.ctx = ctx;
    return feed;
  }

  function apply(feed, msg) {
    if (!feed || !msg || msg.v !== 1 || typeof msg.t !== 'string') return;
    if (msg.t === 'welcome') {
      if (typeof msg.lang === 'string' && msg.lang) feed.lang = msg.lang;
      if (typeof msg.version === 'number' && Number.isFinite(msg.version)) feed.version = msg.version;
      else if (typeof msg.version === 'string' && msg.version) feed.version = msg.version;
      if (Array.isArray(msg.plugins)) feed.plugins = msg.plugins.filter((id) => typeof id === 'string').slice(0, 32);
      feed.cs = typeof msg.cs === 'string' && /^[0-9a-f]{64}$/.test(msg.cs) ? msg.cs : null;
      if (msg.prefs && typeof msg.prefs === 'object') {
        for (const k of Object.keys(msg.prefs)) if (keyOk(k) && scalar(msg.prefs[k])) feed.prefs[k] = msg.prefs[k];
      }
      return;
    }
    if (msg.t === 'state') {
      const priv = msg.private && typeof msg.private === 'object' ? msg.private : null;
      const pub = msg.public && typeof msg.public === 'object' ? msg.public : null;
      if (priv && typeof priv.playerId === 'string') feed.meId = priv.playerId;
      if (pub && Array.isArray(pub.players) && feed.meId) {
        for (let i = 0; i < pub.players.length; i += 1) {
          const row = pub.players[i];
          if (row && row.playerId === feed.meId && typeof row.name === 'string') feed.meName = row.name;
        }
      }
      if (Object.prototype.hasOwnProperty.call(msg, 'room')) {
        const room = msg.room && typeof msg.room === 'object' ? msg.room : null;
        feed.room = room && Array.isArray(room.seats) ? { seats: room.seats } : null;
        feed.cs = room && typeof room.cs === 'string' && /^[0-9a-f]{64}$/.test(room.cs) ? room.cs : null;
        feed.plugins = room && Array.isArray(room.plugins) ? room.plugins.filter((id) => typeof id === 'string').slice(0, 32) : [];
        paint(feed);
        if (feed.room) dispatch(feed, 'room.state', feed.room);
      }
      return;
    }
    if (msg.t === 'result') {
      feed.hasResult = true;
      feed.result = msg.result && typeof msg.result === 'object' ? msg.result : null;
      paint(feed);
      dispatch(feed, 'm.result', feed.result);
      return;
    }
    if (msg.t === 'net') {
      const err = msg.lastError && typeof msg.lastError === 'object' ? msg.lastError : null;
      feed.net = {
        status: typeof msg.status === 'string' ? msg.status : null,
        attempt: typeof msg.attempt === 'number' && Number.isFinite(msg.attempt) ? msg.attempt : 0,
        retryAt: typeof msg.retryAt === 'number' && Number.isFinite(msg.retryAt) ? msg.retryAt : null,
        rtt: typeof msg.rtt === 'number' && Number.isFinite(msg.rtt) ? msg.rtt : null,
        lastError: err,
      };
      return;
    }
    if (msg.t === 'storage' && msg.ok === true && keyOk(msg.key)) {
      if (msg.op === 'delete') delete feed.prefs[msg.key];
      else if (msg.op === 'set' && scalar(msg.value)) feed.prefs[msg.key] = msg.value;
      else if (msg.op === 'get' && scalar(msg.value)) feed.prefs[msg.key] = msg.value;
    }
  }

  function replay(feed) {
    if (!feed) return;
    paint(feed);
    if (feed.room) dispatch(feed, 'room.state', feed.room);
    if (feed.hasResult) dispatch(feed, 'm.result', feed.result);
  }

  function boot(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const doc = g.document;
    let host = null;
    if (doc && typeof doc.createElement === 'function' && doc.body) {
      host = doc.createElement('div');
      doc.body.appendChild(host);
    }
    const pending = [];
    let feed = null;
    let started = false;
    let height = 0;
    let heightTimer = 0;
    const sendHeight = () => {
      heightTimer = 0;
      let h = 72;
      try { h = Math.ceil(doc.body.scrollHeight || 72); } catch { h = 72; }
      if (h === height) return;
      height = h;
      try { g.parent.postMessage({ v: 1, t: 'resize', height: h }, '*'); } catch { /* ignore */ }
    };
    const watch = () => {
      sendHeight();
      if (doc && typeof g.ResizeObserver === 'function' && doc.body) {
        try {
          const ro = new g.ResizeObserver(() => {
            if (heightTimer) return;
            heightTimer = g.setTimeout(sendHeight, 200);
          });
          ro.observe(doc.body);
        } catch { /* the frame still has the first height */ }
      }
    };
    const onMsg = (ev) => {
      // Opaque origins still permit cross-window postMessage. Check the sender before even queuing a feed.
      if (!ev || ev.source !== g.parent) return;
      const m = ev && ev.data;
      if (!m || m.v !== 1 || typeof m.t !== 'string') return;
      if (!started) {
        if (m.t !== 'welcome') { pending.push(m); return; }
        started = true;
        feed = create({ ...o, host, doc });
        g.__spForge.__feed = feed;
        apply(feed, m);
        for (let i = 0; i < pending.length; i += 1) apply(feed, pending[i]);
        const mount = g.__spForgeMount;
        if (typeof mount === 'function') {
          try { mount(feed.ctx); } catch (err) { try { g.console.error(err); } catch { /* ignore */ } }
        }
        replay(feed);
        try { g.parent.postMessage({ v: 1, t: 'ready' }, '*'); } catch { /* ignore */ }
        if (typeof o.slot === 'string') {
          try { g.parent.postMessage({ v: 1, t: 'slot', slot: o.slot }, '*'); } catch { /* ignore */ }
        }
        watch();
        return;
      }
      apply(feed, m);
    };
    if (typeof g.addEventListener === 'function') g.addEventListener('message', onMsg);
  }

  g.__spForge = { create, apply, replay, boot, unavailable };
  return g.__spForge;
}

/** Classic script the importer inlines. The panel source is a separate script in the same page. */
export const FORGE_SHIM_TEXT = `;(${installForgeShim.toString()})(typeof globalThis!=="undefined"?globalThis:this);\n`;
