#!/usr/bin/env node
// scripts/launch.mjs — cross-platform "prepare + start + open the browser", used by scripts/start-windows.bat,
// scripts/start-windows.ps1 and scripts/start.sh (docs/DEPLOY.md).
//
//   node scripts/launch.mjs [--port 3000] [--host 0.0.0.0] [--no-open] [--no-setup] [setup options…]
//   --host :: binds one dual-stack socket (IPv6 *and* IPv4) — the opt-in for a line with a public IPv6 prefix.
//
//   1. If our server already answers on the port, just open the browser (double-clicking twice is harmless).
//   2. node tools/setup.mjs --quiet (dependencies, vendor libs, art download / resume, optional local extraction);
//      setup options such as --no-assets, --no-local, --local, --game <dir>, -y are passed through.
//   3. node server/index.js (PORT / HOST from the options or the environment; SP_COMBAT / SP_VERIFY / TRUST_PROXY /
//      DEBUG are inherited), then — once /healthz answers — prints the addresses to share and opens
//      http://localhost:<port> (not with --no-open, SP_NO_BROWSER=1, or on a Linux box without a display).
// Ctrl+C stops the server (it gets the signal from the terminal itself); the exit code is the server's.

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
// 打开浏览器只有一份实现（走 shell 关联 = 默认浏览器，且不会把浏览器拉成提权）
import { openBrowser as openInBrowser } from './open-browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';

if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error(`Node.js ${process.versions.node} 太旧，需要 22 或更高（22 / 24 LTS）：https://nodejs.org/zh-cn/download`);
  process.exit(1);
}

const { c, mark } = await import('../tools/setup.mjs');
const { probePort, KIND_LABEL, hostUrl, shareTargets } = await import('../tools/doctor.mjs');
const { bindsIpv6 } = await import('../shared/ipv6.js');

function parseArgs(argv) {
  const o = { port: Number(process.env.PORT) || 3000, host: process.env.HOST || '0.0.0.0', open: !/^(1|true|yes)$/i.test(process.env.SP_NO_BROWSER || ''), setup: true, setupArgs: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, v] = a.split('=');
    const val = () => (v !== undefined ? v : argv[++i]);
    if (k === '--port') o.port = Number(val()) || o.port;
    else if (k === '--host') o.host = val() || o.host;
    else if (a === '--no-open') o.open = false;
    else if (a === '--no-setup') o.setup = false;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--game') o.setupArgs.push(a, argv[++i] ?? '');
    else o.setupArgs.push(a);
  }
  return o;
}

function openBrowser(url) {
  return openInBrowser(url) !== null;
}

function printShare(port, host = '0.0.0.0') {
  // only the addresses this bind can actually be reached on: with the default 0.0.0.0 that is IPv4 alone (#188)
  const addrs = shareTargets(host);
  const line = c.dim('─'.repeat(56));
  console.log(`\n${line}`);
  console.log(`${mark.ok} ${c.bold('服务器已启动')}   本机打开：${c.cyan(`http://localhost:${port}`)}`);
  if (addrs.length) {
    console.log('  发给朋友（需要能访问这台电脑的网络）：');
    for (const a of addrs.slice(0, 4)) console.log(`    ${c.cyan(hostUrl(a.address, port))}  ${c.dim(KIND_LABEL[a.kind])}`);
  } else {
    console.log(c.warn('  没有检测到局域网地址：朋友暂时无法连接（检查网线/Wi-Fi）。'));
  }
  // an IPv6 address of a V4-only bind is real but nothing answers there — say how to actually use it (review of #188)
  if (!bindsIpv6(host) && shareTargets('::').some((a) => a.address.includes(':'))) {
    console.log(c.dim('  本机有 IPv6 地址：要让朋友用公网 IPv6 直连，用 --host :: 启动（见 docs/DEPLOY.md §2.5）。'));
  }
  console.log(c.dim('  建房后把 4 位「同盟密钥」或「复制链接」（…/?room=密钥）发给朋友。'));
  console.log(c.dim('  朋友打不开？运行 node tools/doctor.mjs 检查防火墙。按 Ctrl+C 停止服务器。'));
  console.log(`${line}\n`);
}

async function waitHealthy(port, child, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && child.exitCode === null) {
    const p = await probePort(port);
    if (p.state === 'ours') return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
    console.log(src.slice(1, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  const localUrl = `http://localhost:${o.port}`;

  const before = await probePort(o.port, o.host);
  if (before.state === 'ours') {
    console.log(`${mark.ok} 服务器已经在运行（端口 ${o.port}），直接打开浏览器。`);
    printShare(o.port, o.host);
    if (o.open) openBrowser(localUrl);
    return 0;
  }
  if (before.state !== 'free') {
    console.error(`${mark.err} 端口 ${o.port} 被其他程序占用或无权限（${before.code || before.state}）。`);
    console.error(`  换一个端口：${IS_WIN ? 'scripts\\start-windows.bat --port 3001' : 'scripts/start.sh --port 3001'}`);
    return 1;
  }

  if (o.setup) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'setup.mjs'), '--quiet', ...o.setupArgs], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) { console.error(`${mark.err} 准备步骤失败（见上方）。`); return r.status || 1; }
  }

  const env = { ...process.env, PORT: String(o.port), HOST: o.host };
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env, stdio: 'inherit' });
  const forward = (sig) => { if (child.exitCode === null) { try { child.kill(sig); } catch { /* gone */ } } };
  // SIGINT reaches the server straight from the terminal (same process group / console); forwarding it too would make
  // the server's second-signal path force-exit. Other signals (service managers, `kill`) are forwarded.
  process.on('SIGINT', () => {});
  for (const sig of ['SIGTERM', 'SIGHUP', 'SIGBREAK']) { try { process.on(sig, () => forward(sig === 'SIGBREAK' ? 'SIGTERM' : sig)); } catch { /* unsupported here */ } }

  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve(code ?? (signal ? 0 : 1))));
  if (await waitHealthy(o.port, child)) {
    printShare(o.port, o.host);
    if (o.open && !openBrowser(localUrl)) console.log(c.dim(`（未能自动打开浏览器，请手动访问 ${localUrl}）`));
  }
  return exited;
}

// Same convention as tools/setup.mjs: the helpers above are importable, but only running this file starts anything.
// Without the guard, importing launch.mjs would fall through to main() in the background and bind a port.
function isMain() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain()) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e?.stack || e); process.exitCode = 1; });
}
