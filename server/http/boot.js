// server/http/boot.js — running the server as a process (`node server/index.js`, npm start, scripts/launch.mjs, the
// Windows service's scripts/run-server.cmd, NSSM, systemd):
//
//   * first, an update package extracted over the install (UPDATE.json) is finished — old files deleted, the install
//     verified (server/update.js); one that does not match its MANIFEST.json keeps the server from starting (exit 1);
//   * the boot banner: release version, the Local URL, the LAN URLs when listening on every interface, the
//     cloudflared command for internet play;
//   * a server that cannot start exits 1 (with a hint when the port is in use); unhandled rejections and uncaught
//     exceptions are logged, not fatal;
//   * graceful shutdown on SIGINT/SIGTERM (rooms get room.closed{reason:'shutdown'}, sockets close 1001); a second
//     signal exits at once, and the process exits anyway 5 s after the first.

import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { APP_VERSION, DEV_BUILD } from '../../shared/constants.js';
import { applyPendingUpdate } from '../update.js';
import { ROOT } from './config.js';
import { limitKeyOf } from '../net.js';
// The bind address lives in http/config.js with the rest of the environment (DEFAULT_BIND_HOST); read the comments
// there and docs/IPV6.md for what the default means.

/**
 * Non-internal addresses as http URLs — IPv4 first, then IPv6 (an IPv6 literal needs brackets: `http://[240e:…]:3000`).
 * @param {number} port
 */
export function lanUrls(port) {
  const v4 = [];
  const v6 = [];
  const v6Seen = new Set();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.internal) continue;
      if (a.family === 'IPv4' || a.family === 4) { v4.push(`http://${a.address}:${port}`); continue; }
      if (a.family !== 'IPv6' && a.family !== 6) continue;
      // Link-local needs a zone id (%eth0) that a URL cannot carry, so it is useless to a friend — left out.
      if (/^fe80:/i.test(a.address)) continue;
      // Privacy extensions give one machine several addresses in the same /64; one URL per prefix is enough.
      const prefix = limitKeyOf(a.address);
      if (v6Seen.has(prefix)) continue;
      v6Seen.add(prefix);
      v6.push(`http://[${a.address}]:${port}`);
    }
  }
  return [...v4, ...v6];
}

/**
 * The host to show in a URL for a bound `host`: a wildcard bind is not reachable as written, so it reads `localhost`
 * (same rule as server/index.js `url`). An explicit address — IPv4, an IPv6 literal or a name — is kept.
 * @param {string} host
 */
export function displayHost(host) {
  return host === '0.0.0.0' || host === '::' ? 'localhost' : host;
}

/** Is the module whose `import.meta.url` is `metaUrl` the file node was started with? */
export function isProcessEntry(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

/** Print the boot banner of a started server. @param {{ url: string, host: string, port: number }} srv */
export function printBanner(srv) {
  console.log(`\n  卫戍协议：盟约 · Stronghold Protocol: Alliance v${APP_VERSION}`);
  if (DEV_BUILD) console.log('  ! 开发版（dev 分支）：不稳定，请勿用于公开服务器 · development build — unstable, not for public servers');
  console.log(`  Local:   ${srv.url}`);
  if (srv.host === '0.0.0.0' || srv.host === '::') {
    for (const u of lanUrls(srv.port)) console.log(`  LAN:     ${u}`);
  }
  console.log('  Internet: cloudflared tunnel --url ' + `http://localhost:${srv.port}` + '\n');
}

/**
 * The process main: finish a pending update package, start the server, print the banner, stop gracefully on SIGINT /
 * SIGTERM.
 * @param {() => Promise<{ url: string, host: string, port: number, close: () => Promise<void> }>} start index.js startServer
 */
export async function runMain(start) {
  process.on('unhandledRejection', (e) => console.error('[process] unhandled rejection', e));
  process.on('uncaughtException', (e) => console.error('[process] uncaught exception', e));
  // before the data, the packs or the browser runtime are read: the files must be the new version's (server/update.js).
  // Nothing is listening yet, so returning ends the process with exit code 1 once the message is written.
  if (applyPendingUpdate(ROOT).state === 'failed') { process.exitCode = 1; return; }
  let srv;
  try {
    srv = await start();
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') console.error(`端口已被占用 / port in use: ${e.port ?? process.env.PORT ?? 3000}. Try PORT=3001 npm start`);
    else console.error('[boot] failed to start', e);
    process.exit(1);
  }
  printBanner(srv);

  let stopping = false;
  const stop = (signal) => {
    if (stopping) { console.log('forced exit'); process.exit(1); }
    stopping = true;
    console.log(`\n[${signal}] shutting down…`);
    setTimeout(() => process.exit(0), 5000).unref();
    srv.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}
