// server/testMode.js — whether this process may open test rooms (DESIGN §34.8 phase 2).
// The decision uses the address the server bound, never the HTTP peer. An explicit public
// address stays off unless the owner set SP_TEST_MODE=force. A wildcard bind ('::', '0.0.0.0',
// and the other unspecified spellings) is judged from the machine's interface addresses: when
// every non-internal address is loopback, private, link-local or IPv6 ULA, it is treated like
// an explicit LAN bind and `1` is accepted. Any global address keeps `1` refused.
// An unknown host fails closed, so the gate stays off until the listen address is known.
//
// [ASSUMED] unset / 0 / off / false / no is off and silent. Any other word is also off, but
// startup warns (unrecognizedTestMode). 1 / true / yes / on / local is the local-and-LAN mode.
// Only the exact word force enables a public listener.
// [ASSUMED] A wildcard bind on a machine whose interfaces are all private is a LAN listener.
// A port forward on the router is the owner's own exposure, the same as an explicit LAN bind.
// No non-internal address (or only internal ones) counts as private-only. A failed interface
// read fails closed. A reverse proxy in front of loopback is still a public deployment when
// the process is bound to a public or unspecified-with-public-NIC address: the process only
// sees the bind address and the machine's own interfaces, the same judgment as
// SP_PLUGIN_SCRIPTS=trusted-force.

import os from 'node:os';
import { isIP } from 'node:net';
import { isLocalIp, normalizeIp } from './net.js';
import { isUnspecifiedAddress, trustedHostAllowed } from './plugins/trusted.js';

const LOCAL = new Set(['1', 'true', 'yes', 'on', 'local']);
const SILENT_OFF = new Set(['', '0', 'off', 'false', 'no']);

/** Printed when `1` is refused. The launcher and the server log share this text. */
export const TEST_MODE_PUBLIC_HINT =
  '测试模式 1 未开启：监听地址是公网，或这台机器有公网地址。仅本机请用 --host 127.0.0.1；局域网请用 --host <局域网IP>；要在公网监听上开启请用 --test-mode force（或 SP_TEST_MODE=force）。'; // i18n-ignore: operator console text (launcher and server log), not UI

/** Printed when SP_TEST_MODE is a word this process does not know. Test rooms stay off. */
export const TEST_MODE_UNKNOWN_HINT =
  '未识别的 SP_TEST_MODE，测试房间保持关闭。可用的值：off、1、force。'; // i18n-ignore: operator console text (launcher and server log), not UI

/** Printed when force opens test rooms on a public or wildcard listener. Same hint style as TEST_MODE_PUBLIC_HINT. */
export const TEST_MODE_FORCE_HINT =
  '测试模式 force 已在公网或通配监听上开启测试房间（--test-mode force 或 SP_TEST_MODE=force）。环回地址前面的反向代理仍然是公网部署。'; // i18n-ignore: operator console text (launcher and server log), not UI

/** @param {unknown} raw @returns {'off'|'local'|'force'} */
export function parseTestModeEnv(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'force') return 'force';
  if (LOCAL.has(s)) return 'local';
  return 'off';
}

/**
 * A word that is not a known mode and not a silent off. null when there is nothing to warn about.
 * @param {unknown} raw the SP_TEST_MODE value before parseTestModeEnv
 * @returns {string|null}
 */
export function unrecognizedTestMode(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (SILENT_OFF.has(s) || s === 'force' || LOCAL.has(s)) return null;
  return TEST_MODE_UNKNOWN_HINT;
}

/**
 * True when every non-internal address is local (or there is none). False when any is public
 * or the snapshot cannot be read. `interfaces` omitted reads os.networkInterfaces().
 * @param {NodeJS.Dict<os.NetworkInterfaceInfo[]>|null|undefined} [interfaces]
 */
export function interfacesArePrivate(interfaces) {
  let snapshot = interfaces;
  if (snapshot === undefined) {
    try { snapshot = os.networkInterfaces(); } catch { return false; }
  }
  if (snapshot == null || typeof snapshot !== 'object') return false;
  try {
    for (const list of Object.values(snapshot)) {
      if (!Array.isArray(list)) continue;
      for (const info of list) {
        if (!info || info.internal) continue;
        const ip = normalizeIp(typeof info.address === 'string' ? info.address : '');
        if (!ip) continue;
        if (!isLocalIp(ip)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {'off'|'local'|'force'|string} mode
 * @param {string} host the bound address (empty until listen)
 * @param {NodeJS.Dict<os.NetworkInterfaceInfo[]>|null} [interfaces] test snapshot; omitted reads the machine
 * @returns {{ enabled: boolean, warn: string|null }}
 */
export function testModeGate(mode, host, interfaces) {
  const m = mode === 'force' || mode === 'local' ? mode : 'off';
  if (m === 'off') return { enabled: false, warn: null };
  const known = typeof host === 'string' && isIP(host) !== 0;
  if (!known) return { enabled: false, warn: null };
  let local = trustedHostAllowed(host, 'trusted');
  if (!local && isUnspecifiedAddress(host)) local = interfacesArePrivate(interfaces);
  if (m === 'local' && !local) return { enabled: false, warn: TEST_MODE_PUBLIC_HINT };
  if (m === 'force' && !local) {
    return {
      enabled: true,
      warn: TEST_MODE_FORCE_HINT,
    };
  }
  return { enabled: true, warn: null };
}
