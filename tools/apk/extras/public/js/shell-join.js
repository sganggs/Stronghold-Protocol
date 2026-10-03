// shell-join.js — cross-server invite-code UI (v2.7.2, Discovery Plane architecture).
//
// Discovery and joining are fully separated:
//   • window.shell.resolveInvite(code)  → native: directory presence lookup + signed-list
//     validation → [{id, name, rttMs, humans}] (no URLs ever reach the page)
//   • window.shell.joinOnOrigin(id, code) → native: switch origin with ?room=CODE
//   • phone-host rooms still flow through the native room-code dialog (window.shell.join)
//
// The target server remains the final authority on joinability (ROOM_NOT_FOUND / FULL / STARTED
// surface as normal toasts from the game's own net layer). This module is UI only — no sockets,
// no scanning, no URL handling.
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var CODE_RE = /^[A-HJ-NP-Z]{4}$/; // upstream alphabet (no I/O), matches native + directory
  var lastFailAt = 0;
  var COOLDOWN_MS = 15 * 1000; // client-side politeness; the directory rate-limits authoritatively

  /** Resolve an invite code. Resolves { kind, note?, entries? } for the picker in shellPanels. */
  function resolveCode(code) {
    var K = String(code || '').trim().toUpperCase();
    if (!CODE_RE.test(K)) {
      return Promise.resolve({ kind: 'none', note: '邀请码为 4 位字母（不含 I / O）' });
    }
    if (Date.now() - lastFailAt < COOLDOWN_MS) {
      return Promise.resolve({ kind: 'cooldown', note: '刚刚查找过，请稍候再试' });
    }
    return new Promise(function (resolve) {
      var native = window.shell && typeof window.shell.resolveInvite === 'function';
      if (!native) {
        // plain web build: only the current origin is knowable — deep-link straight into it
        resolve({ kind: 'single', entry: { id: '', name: '当前服务器', rttMs: -1, humans: -1 } });
        return;
      }
      try {
        var list = JSON.parse(window.shell.resolveInvite(K) || '[]');
        if (!Array.isArray(list) || !list.length) {
          lastFailAt = Date.now();
          resolve({ kind: 'none', note: '未找到邀请码 ' + K + '（可能已结束、过期或服务器暂时离线）' });
          return;
        }
        list.sort(function (a, b) { // by measured latency, per owner decision
          var ar = a.rttMs > 0 ? a.rttMs : Number.MAX_VALUE;
          var br = b.rttMs > 0 ? b.rttMs : Number.MAX_VALUE;
          return ar - br;
        });
        resolve(list.length === 1 ? { kind: 'single', entry: list[0] } : { kind: 'conflict', entries: list });
      } catch (e) {
        resolve({ kind: 'none', note: '查找失败，请稍后重试' });
      }
    });
  }

  window.__SP_JOIN = {
    resolveCode: resolveCode,
    CODE_RE: CODE_RE,
  };
})();
