#!/usr/bin/env node
// tools/doctor.mjs — diagnose an install (docs/DEPLOY.md「排错」). Read-only: changes nothing.
//
//   node tools/doctor.mjs [--port 3000] [--host ::]
//
// Checks: Node/npm versions, dependencies, public/vendor, data/*.json, the shipped files against the release's
// MANIFEST.json (server/update.js checkInstall; a source checkout has none) and an update package not applied yet,
// downloaded art/audio, optional local-client art,
// Python (only needed for the optional extraction), the port (free / our server running → /healthz / another
// program), LAN addresses friends can use (virtual adapters and VPNs labelled), firewall hints per OS, tunnel tools
// (Tailscale, ZeroTier, cloudflared) and the env vars the server reads.
// Exit code 1 when something essential is missing (the same rule as tools/setup.mjs --check).

import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ROOT, MIN_NODE, IS_WIN, IS_MAC, c, mark, capture, padDisplay, displayWidth,
  checkNode, checkDeps, checkVendor, checkData, checkAssets, checkLocal, findClient, findPython,
  LOCAL_ART_FALLBACK, LOCAL_ART_COPY_HINT,
} from './setup.mjs';
import { checkInstall, MANIFEST_FILE, UPDATE_FILE } from '../server/update.js';

// ---------------------------------------------------------------------------------------------------
// LAN addresses (also used by scripts/launch.mjs)
// ---------------------------------------------------------------------------------------------------

// 名字里带这些的网卡不对局域网开放：虚拟机 / 容器 / WSL / 代理软件的 TUN 适配器（Mihomo、Clash）。
// tun0 / tap0 不归这一类：classifyAddresses 先判下面的 VPN_IF，它的 `tun\d` / `tap` 是子串匹配，
// tun0 / tap0 先被它命中，归为 vpn（那正是同组好友互连用的地址）。
const VIRTUAL_IF = /(vethernet|virtualbox|vmware|vmnet|docker|^br-|^veth|wsl|hyper-v|vboxnet|bridge\d|utun|awdl|llw|parallels|loopback|mihomo|clash|sing-?box)/i;
// 点对点 VPN：这些地址就是同组好友互相访问用的（Tailscale / ZeroTier / WireGuard / Radmin VPN / Hamachi）。
const VPN_IF = /(tailscale|zerotier|^zt|wireguard|^wg\d|tun\d|tap|radmin|hamachi)/i;

function ipv4ToInt(ip) { return ip.split('.').reduce((n, x) => (n << 8) + Number(x), 0) >>> 0; }
function inCidr(ip, base, bits) { const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0; return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask); }

/** The first two hextets of an IPv6 address (a zone id is dropped); null when it cannot be parsed. @param {string} ip */
function ipv6Head(ip) {
  const [a = '', b = ''] = String(ip).split('%')[0].split(':');
  const h1 = parseInt(a, 16);
  if (!Number.isInteger(h1)) return null;
  const h2 = parseInt(b, 16);
  return [h1, Number.isInteger(h2) ? h2 : 0];
}

/** An http URL for one address — an IPv6 literal needs brackets (`http://[240e:…]:3000`). Also used by scripts/launch.mjs. */
export function hostUrl(address, port) {
  return `http://${String(address).includes(':') ? `[${address}]` : address}:${port}`;
}

/** IPv6 counterpart of the IPv4 chain below (same order, same kinds). @param {string} name @param {string} ip */
function classifyV6(name, ip) {
  const head = ipv6Head(ip);
  if (!head) return 'virtual';
  const [h1, h2] = head;
  // fe80::/10 needs a zone id (%12 / %eth0) that a URL cannot carry, so it is no use to a friend.
  if ((h1 & 0xffc0) === 0xfe80) return 'linklocal';
  // The IPv6 equivalents of the 198.18/15 special case: 2002::/16 (6to4) and 2001:db8::/32 (documentation) are never
  // an address to hand out.
  if (h1 === 0x2002 || (h1 === 0x2001 && h2 === 0x0db8)) return 'virtual';
  if (VPN_IF.test(name)) return 'vpn';
  if (VIRTUAL_IF.test(name)) return 'virtual';
  if ((h1 & 0xfe00) === 0xfc00) return 'lan';    // fc00::/7 ULA — the IPv6 RFC 1918
  if ((h1 & 0xe000) === 0x2000) return 'public'; // 2000::/3 global unicast
  return 'virtual';
}

/**
 * Classify every non-internal address — IPv4 and IPv6 — as 'lan' (RFC 1918 / ULA fc00::/7, what friends at home use),
 * 'vpn' (Tailscale / ZeroTier / Radmin / Hamachi / CGNAT 100.64/10), 'virtual' (Hyper-V, WSL, Docker, VirtualBox, a
 * Clash/Mihomo TUN adapter … — not reachable from other machines, sharing them only confuses people), 'public' (a
 * public address directly on this machine; an IPv6 global unicast one is the usual way in for a home server) or
 * 'linklocal' (169.254 / fe80:: — no DHCP, or a zone id a URL cannot carry).
 * @returns {{ name: string, address: string, kind: string }[]} best first
 */
export function classifyAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  const v6Seen = new Set(); // privacy extensions put several addresses of one /64 on a machine — one entry is enough
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.internal) continue;
      const ip = a.address;
      if (a.family === 'IPv4' || a.family === 4) {
        let kind;
        if (inCidr(ip, '169.254.0.0', 16)) kind = 'linklocal';
        // 198.18.0.0/15 是 RFC 2544 的基准测试段：代理软件（Clash / Mihomo 的 fake-ip 池）拿它做本地 TUN 地址，
        // 绝对不是能发给朋友的「公网 IP」。
        else if (inCidr(ip, '198.18.0.0', 15)) kind = 'virtual';
        else if (VPN_IF.test(name) || inCidr(ip, '100.64.0.0', 10)) kind = 'vpn';
        else if (VIRTUAL_IF.test(name)) kind = 'virtual';
        else if (inCidr(ip, '10.0.0.0', 8) || inCidr(ip, '172.16.0.0', 12) || inCidr(ip, '192.168.0.0', 16)) kind = 'lan';
        else kind = 'public';
        out.push({ name, address: ip, kind });
        continue;
      }
      if (a.family !== 'IPv6' && a.family !== 6) continue;
      const kind = classifyV6(name, ip);
      if (kind === 'linklocal' || kind === 'virtual') { out.push({ name, address: ip, kind }); continue; }
      const prefix = ip.split('%')[0].split(':').slice(0, 4).join(':');
      if (v6Seen.has(`${name}|${prefix}`)) continue;
      v6Seen.add(`${name}|${prefix}`);
      out.push({ name, address: ip, kind });
    }
  }
  const rank = { lan: 0, vpn: 1, public: 2, virtual: 3, linklocal: 4 };
  return out.sort((x, y) => rank[x.kind] - rank[y.kind]);
}

export const KIND_LABEL = { lan: '局域网', vpn: 'VPN/Tailscale/ZeroTier', public: '公网 IP', virtual: '虚拟网卡（通常无法从别的电脑访问）', linklocal: '无效地址（未获取到 IP）' };

// ---------------------------------------------------------------------------------------------------
// Port probe
// ---------------------------------------------------------------------------------------------------

function getJson(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; if (body.length > 65536) req.destroy(); });
      res.on('end', () => { let json = null; try { json = JSON.parse(body); } catch { /* not ours */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', (e) => resolve({ error: e.code || e.message }));
  });
}

function canListen(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (e) => resolve({ ok: false, code: e.code }));
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve({ ok: true })));
  });
}

/** 'ours' (our server answers /healthz), 'free', 'busy' (another program) or 'denied'. */
export async function probePort(port, host = '::') {
  const r = await getJson(`http://127.0.0.1:${port}/healthz`);
  if (r.json && r.json.ok === true && 'uptimeSec' in r.json) return { state: 'ours', health: r.json };
  const l = await canListen(port, host);
  if (l.ok) return { state: 'free' };
  if (l.code === 'EACCES') return { state: 'denied', code: l.code };
  return { state: 'busy', code: l.code, http: r.status };
}

// ---------------------------------------------------------------------------------------------------
// Firewall hints
// ---------------------------------------------------------------------------------------------------

function firewallHints(port) {
  const lines = [];
  if (IS_WIN) {
    const rule = capture('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=Stronghold Protocol'], { timeout: 10000 });
    if (rule.ok) lines.push([mark.ok, '已存在防火墙入站规则「Stronghold Protocol」']);
    else {
      lines.push([mark.warn, `未找到规则「Stronghold Protocol」。朋友连不上时，用「管理员」PowerShell 运行：`]);
      lines.push(['', c.cyan(`netsh advfirewall firewall add rule name="Stronghold Protocol" dir=in action=allow protocol=TCP localport=${port} profile=private,domain`)]);
      lines.push(['', c.dim('（或首次启动时在 Windows 弹窗里勾选「专用网络」并允许 Node.js；scripts\\install-service-windows.ps1 也会自动添加）')]);
    }
    const prof = capture('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-NetConnectionProfile | ForEach-Object { $_.InterfaceAlias + '|' + $_.NetworkCategory }"], { timeout: 15000 });
    if (prof.ok && prof.out) {
      for (const l of prof.out.split(/\r?\n/).filter(Boolean)) {
        const [alias, cat] = l.split('|');
        if (/public/i.test(cat || '')) {
          lines.push([mark.warn, `网络「${alias}」是「公用网络」：Windows 默认拦截公用网络的入站连接。家里的网络建议改为「专用」：`]);
          lines.push(['', c.cyan(`Set-NetConnectionProfile -InterfaceAlias "${alias}" -NetworkCategory Private`) + c.dim('（管理员 PowerShell）')]);
        } else lines.push([mark.ok, `网络「${alias}」类型：${cat}`]);
      }
    }
  } else if (IS_MAC) {
    const fw = capture('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate'], { timeout: 5000 });
    if (/enabled/i.test(fw.out) && !/disabled/i.test(fw.out)) {
      lines.push([mark.warn, 'macOS 防火墙已开启：首次启动时请在弹窗中「允许」node 接受传入连接，或运行：']);
      lines.push(['', c.cyan(`sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "${process.execPath}" --unblockapp "${process.execPath}"`)]);
    } else if (fw.out) lines.push([mark.ok, 'macOS 防火墙未开启（局域网可直接访问）']);
  } else {
    lines.push([c.dim('i'), `Linux：若启用了 ufw/firewalld，请放行端口：sudo ufw allow ${port}/tcp  或  sudo firewall-cmd --add-port=${port}/tcp --permanent && sudo firewall-cmd --reload`]);
  }
  return lines;
}

function tool(cmd, args) {
  const r = capture(cmd, args, { timeout: 5000, shell: IS_WIN });
  return r.ok ? (r.out.split(/\r?\n/)[0] || 'ok') : null;
}

// ---------------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { port: Number(process.env.PORT) || 3000, host: process.env.HOST || '::', help: false };
  for (let i = 0; i < argv.length; i++) {
    const [k, v] = argv[i].split('=');
    const val = () => (v !== undefined ? v : argv[++i]);
    if (k === '--port') o.port = Number(val()) || o.port;
    else if (k === '--host') o.host = val() || o.host;
    else if (k === '-h' || k === '--help') o.help = true;
    else throw new Error(`unknown option ${argv[i]}`);
  }
  return o;
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); return 2; }
  if (opts.help) { console.log('node tools/doctor.mjs [--port 3000] [--host ::]  — 只读诊断，不修改任何文件'); return 0; }
  const rows = [];
  let bad = false;
  const row = (state, label, detail = '') => { rows.push([state, label, detail]); if (state === 'err') bad = true; };
  const section = (title) => rows.push([null, title]);

  console.log(c.bold('\n卫戍协议：盟约 · doctor') + c.dim(`  ${os.type()} ${os.release()} ${process.arch} · ${ROOT}`));

  section('运行环境');
  const node = checkNode();
  row(node.ok ? (node.recommended ? 'ok' : 'warn') : 'err', 'Node.js', `v${node.version}` + (node.ok ? (node.recommended ? '' : '（推荐 22 / 24 LTS）') : `（需要 ≥ ${MIN_NODE}：https://nodejs.org/zh-cn/download）`));
  const npmV = tool(IS_WIN ? 'npm.cmd' : 'npm', ['--version']);
  row(npmV ? 'ok' : 'warn', 'npm', npmV ? `v${npmV}` : '未找到（安装 Node.js 时会自带）');

  section('安装');
  const deps = checkDeps();
  row(deps.ok ? 'ok' : 'err', '依赖 node_modules', deps.ok ? '' : `缺少 ${deps.missing.join(', ')} → npm install`);
  const vendor = checkVendor();
  row(vendor.ok ? 'ok' : 'err', '前端库 public/vendor', vendor.ok ? (vendor.optionalMissing.length ? 'three.js 缺失（3D 棋盘回退 2D）' : '') : `缺少 ${vendor.missing.join(', ')} → node tools/vendor.mjs`);
  const data = checkData();
  row(data.ok ? 'ok' : 'err', '游戏数据 data/*.json', data.ok ? '' : `缺少/损坏：${[...data.missing, ...data.broken].join(', ')}`);
  // the release's file list (every package has one; art is setup's and is checked below)
  const inst = checkInstall(ROOT);
  const instLabel = `文件校验 ${MANIFEST_FILE}`;
  if (inst.state === 'none') row('skip', instLabel, '没有：源码目录，不校验');
  else if (inst.state === 'broken') row('warn', instLabel, `无法读取（${inst.error}）→ 重新解压同一版本的整合包`);
  else if (inst.state === 'ok') row('ok', instLabel, `${inst.checked} 个文件与 v${inst.app} 一致`);
  else {
    const bad = [...inst.runtime, ...inst.other];
    const eg = bad.slice(0, 3).join(' ') + (bad.length > 3 ? ' …' : '');
    row(inst.runtime.length ? 'err' : 'warn', instLabel, `${bad.length} 个文件与 v${inst.app} 不一致或缺失（例：${eg}）`
      + (inst.runtime.length ? ` → 重新解压 v${inst.app} 的完整包（或它的更新包）` : '：只是说明 / 脚本文件，不影响运行'));
  }
  if (inst.pending) row('warn', `更新包 ${UPDATE_FILE}`, '已解压、还没有应用：下次启动服务器时自动应用');
  const assets = checkAssets();
  row(assets.ok ? 'ok' : 'warn', '美术/音频 public/assets', assets.ok ? `${assets.total} 个文件`
    : !assets.present ? '未下载 → node tools/setup.mjs（游戏仍可运行，使用占位图）' : `缺 ${assets.missing}/${assets.total}（例：${assets.sample.join(' ')}）→ node tools/setup.mjs`);
  const fonts = fs.existsSync(path.join(ROOT, 'public', 'fonts', 'fonts.css'));
  row(fonts ? 'ok' : 'warn', '字体 public/fonts', fonts ? '' : '未生成（随素材下载一起生成；缺失时用系统字体）');
  const local = checkLocal();
  const client = findClient(null);
  row(local.manifest ? 'ok' : 'skip', '本地客户端美术（可选）', local.manifest
    ? `${local.count} 项${local.board3d ? '，3D 棋盘可用' : '，无棋盘贴图（2D 棋盘）'}${local.board3d && !local.tiles ? '；缺 tiles.json → node tools/setup.mjs' : ''}`
    : client ? `检测到 ${client.kind} 客户端 → node tools/setup.mjs --local` : `未提取：${LOCAL_ART_FALLBACK}（${LOCAL_ART_COPY_HINT}）`);
  if (client || local.manifest) {
    const py = findPython();
    row(py ? 'ok' : 'skip', 'Python（仅提取用）', py ? `${py.cmd} ${py.version}` : '未找到 Python 3.8+');
  }

  section('服务器');
  const port = await probePort(opts.port, opts.host);
  if (port.state === 'ours') {
    const h = port.health;
    row('ok', `端口 ${opts.port}`, `服务器正在运行${h.app ? `（v${h.app}）` : ''}：运行 ${h.uptimeSec}s · 房间 ${h.rooms ?? '?'} · 对局 ${h.matches ?? '?'} · 连接 ${h.sockets ?? '?'}`);
  } else if (port.state === 'free') row('ok', `端口 ${opts.port}`, '空闲（服务器未运行；npm start 启动）');
  else if (port.state === 'denied') row('err', `端口 ${opts.port}`, '没有权限监听（Linux 上 < 1024 的端口需要 root）→ 换一个 PORT');
  else row('err', `端口 ${opts.port}`, `被其他程序占用（${port.code}）→ 关闭它或换端口：${IS_WIN ? '$env:PORT=3001; npm start' : 'PORT=3001 npm start'}`);
  const env = ['PORT', 'HOST', 'SP_COMBAT', 'SP_VERIFY', 'TRUST_PROXY', 'DEBUG'].filter((k) => process.env[k] != null && process.env[k] !== '');
  row('skip', '环境变量', env.length ? env.map((k) => `${k}=${process.env[k]}`).join(' ') : '全部默认（PORT=3000 HOST=:: SP_COMBAT=client SP_VERIFY=off）');

  section('朋友如何访问');
  const addrs = classifyAddresses();
  if (!addrs.length) row('warn', '网络', '没有可用的地址（未联网？）');
  for (const a of addrs) {
    const usable = a.kind === 'lan' || a.kind === 'vpn' || a.kind === 'public';
    // An IPv6 literal needs the brackets of hostUrl(): `http://240e:…:3000` is not a URL anyone can open.
    row(usable ? 'ok' : 'skip', hostUrl(a.address, opts.port), `${KIND_LABEL[a.kind]} · ${a.name}`);
  }
  if (opts.host !== '0.0.0.0' && opts.host !== '::') row('warn', 'HOST', `HOST=${opts.host}：只监听这个地址，其他电脑可能连不上（默认 :: 双栈，见 docs/IPV6.md）`);

  section('防火墙');
  for (const [m, text] of firewallHints(opts.port)) rows.push([m === '' ? 'raw' : 'mark', text, '', m]);

  section('公网联机工具（可选）');
  const ts = tool('tailscale', ['version']);
  const zt = tool('zerotier-cli', ['-v']);
  const cf = tool('cloudflared', ['--version']);
  row(ts ? 'ok' : 'skip', 'Tailscale', ts || '未安装（推荐：https://tailscale.com/download ）');
  row(zt ? 'ok' : 'skip', 'ZeroTier', zt || '未安装');
  row(cf ? 'ok' : 'skip', 'cloudflared', cf || '未安装（临时公网链接：cloudflared tunnel --url http://localhost:' + opts.port + '）');

  // print
  const width = Math.max(...rows.filter((r) => r[0] && r[0] !== 'raw' && r[0] !== 'mark').map((r) => displayWidth(r[1]))) + 2;
  for (const r of rows) {
    if (r[0] === null) { console.log(c.bold(`\n${r[1]}`)); continue; }
    if (r[0] === 'raw') { console.log(`  ${r[1]}`); continue; }
    if (r[0] === 'mark') { console.log(`${r[3]} ${r[1]}`); continue; }
    console.log(`${mark[r[0]]} ${padDisplay(r[1], width)}${r[2] ? c.dim(r[2]) : ''}`);
  }
  console.log(bad ? c.err('\n有必须解决的问题（✘）。') + ' 大多数情况运行 node tools/setup.mjs 即可修复。' : c.ok('\n基本环境正常。'));
  return bad ? 1 : 0;
}

function isMain() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain()) main().then((code) => { process.exitCode = code; }, (e) => { console.error(e?.stack || e); process.exitCode = 1; });
