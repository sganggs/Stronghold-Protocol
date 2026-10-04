// Browser E2E helpers (puppeteer-core + the system Chrome): a real game server in a child process and a `Client`
// per player that drives the real UI with real mouse clicks, keys and canvas drags (no net.request shortcuts).
// Used by test/e2e/coop.e2e.mjs. Not a test file itself (it only exports helpers).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT = path.join(ROOT, 'test/e2e/out');
export const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const hasChrome = () => existsSync(CHROME);

const CHROME_ARGS = ['--no-sandbox', '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio', '--force-device-scale-factor=1'];

/** A free TCP port on 127.0.0.1. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/**
 * Start the real server (`node server/index.js`, or test/e2e/fastServer.mjs with `fast` speed-ups) on a free port (or
 * `port`: e.g. the port of a server just stopped — a server restart the open clients reconnect to).
 * @param {{ port?: number, fast?: { timerScale?: number, combatSpeed?: number, startRound?: 'boss'|'hidden'|number, kit?: number, chess?: string[],
 *   items?: string[], idleBots?: boolean, kits?: string[][], botChess?: string[], autoPlace?: boolean, eliminate?: number[], stage?: string } }} [opts]
 *   kits: per-human starter kits (seat order); botChess: the AI seats' kit; autoPlace: the kits go onto the board at the
 *   first prep; eliminate: humans (seat order) eliminated at the jump; stage: the stage of every match — fastServer.mjs hooks
 * @returns {Promise<{ base: string, port: number, logs: string[], stop: (o?: { hard?: boolean }) => Promise<void> }>}
 */
export async function startRealServer(opts = {}) {
  const port = Number.isInteger(opts.port) && opts.port > 0 ? opts.port : await freePort();
  const entry = opts.fast ? path.join(ROOT, 'test/e2e/fastServer.mjs') : path.join(ROOT, 'server/index.js');
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
  // under `node --test` the runner's marker would turn fastServer.mjs into a no-op module (it is not a test file)
  delete env.NODE_TEST_CONTEXT;
  if (opts.fast) {
    env.SP_TIMER_SCALE = String(opts.fast.timerScale ?? 1);
    env.SP_COMBAT_SPEED = String(opts.fast.combatSpeed ?? 2);
    // test hook of fastServer.mjs: the first round of every match (e.g. 'boss') + a starter kit of operators
    if (opts.fast.startRound != null) env.SP_START_ROUND = String(opts.fast.startRound);
    if (opts.fast.kit != null) env.SP_START_KIT = String(opts.fast.kit);
    if (opts.fast.chess?.length) env.SP_START_CHESS = opts.fast.chess.join(',');
    if (opts.fast.items?.length) env.SP_START_ITEMS = opts.fast.items.join(',');
    if (opts.fast.shop?.length) env.SP_START_SHOP = opts.fast.shop.join(',');
    if (opts.fast.idleBots) env.SP_IDLE_BOTS = '1';
    if (Array.isArray(opts.fast.kits)) env.SP_START_KITS = JSON.stringify(opts.fast.kits);
    if (opts.fast.botChess?.length) env.SP_BOT_CHESS = opts.fast.botChess.join(',');
    if (opts.fast.autoPlace) env.SP_AUTO_PLACE = '1';
    if (opts.fast.eliminate?.length) env.SP_ELIMINATE = opts.fast.eliminate.join(',');
    if (opts.fast.stage) env.SP_STAGE = String(opts.fast.stage);
  }
  const child = spawn(process.execPath, [entry], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  const onData = (buf) => { for (const line of String(buf).split('\n')) if (line.trim()) logs.push(line); if (logs.length > 400) logs.splice(0, logs.length - 400); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const base = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode != null) throw new Error(`server exited (${child.exitCode}):\n${logs.join('\n')}`);
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > 20000) { child.kill('SIGKILL'); throw new Error(`server did not start:\n${logs.join('\n')}`); }
    await sleep(150);
  }
  return {
    base, port, logs,
    // `{ hard: true }`: SIGKILL at once — a crash: no room.closed 'shutdown' reaches the clients
    stop: ({ hard = false } = {}) => new Promise((resolve) => {
      if (child.exitCode != null || child.signalCode != null) { resolve(); return; }
      const t = setTimeout(() => { child.kill('SIGKILL'); }, 4000);
      child.once('exit', () => { clearTimeout(t); resolve(); });
      child.kill(hard ? 'SIGKILL' : 'SIGTERM');
    }),
  };
}

/**
 * One player: its own Chrome process with a single, always visible tab (two tabs of one browser would leave one
 * hidden — no animation frames, so the Pixi view and visibility checks stall).
 */
export class Client {
  constructor(puppeteer, base, label, { w = 1920, h = 1080, prefix = 'coop' } = {}) {
    Object.assign(this, { puppeteer, base, label, w, h, prefix, problems: [], log: [], shots: [] });
  }

  async open(query = '') {
    mkdirSync(OUT, { recursive: true });
    this.browser = await this.puppeteer.launch({ executablePath: CHROME, headless: true, args: CHROME_ARGS, protocolTimeout: 90000 });
    const [first] = await this.browser.pages();
    const page = first || await this.browser.newPage();
    this.page = page;
    await page.setViewport({ width: this.w, height: this.h });
    page.on('console', (m) => {
      if (m.type() === 'error') this.problems.push(`console: ${m.text()} @ ${m.location()?.url || ''}`);
    });
    page.on('pageerror', (e) => this.problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => {
      const err = r.failure()?.errorText || '';
      if (err === 'net::ERR_ABORTED' && /\.(mp3|ogg|wav|m4a)(\?|$)/.test(r.url())) return; // media element swaps
      this.problems.push(`requestfailed: ${r.url()} ${err}`);
    });
    page.on('response', (r) => { if (r.status() >= 400) this.problems.push(`http ${r.status()}: ${r.url()}`); });
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.goto(`${this.base}/${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__SP__ && !!document.querySelector('.screen'), { timeout: 30000 });
  }

  note(msg) { this.log.push(`[${this.label}] ${msg}`); }

  /** Compact snapshot of the client store. */
  st() {
    return this.page.evaluate(() => {
      const s = globalThis.__SP__.store.get();
      const pub = s.match.public;
      const priv = s.match.private;
      const me = pub?.players?.find((p) => p.playerId === s.me.playerId) || null;
      return {
        me: s.me.playerId, room: s.room ? { code: s.room.code, inMatch: !!s.room.inMatch, mode: s.room.mode } : null,
        phase: pub?.phase ?? null, round: pub?.round ?? 0, bossRound: pub?.bossRound ?? null, status: me?.status ?? null, alive: priv ? priv.alive !== false : true,
        camera: document.querySelector('.gm')?.dataset.camera ?? null,
        ready: !!priv?.ready, canReady: priv?.canReady !== false, funds: priv?.funds ?? null, level: priv?.shop?.level ?? null,
        frozen: !!priv?.shop?.frozen, lp: priv?.lp ?? null, kills: priv?.stats?.kills ?? null, leaks: priv?.stats?.leaks ?? null,
        upgradePrice: priv?.shop?.upgradePrice ?? null, refreshPrice: priv?.shop?.refreshPrice ?? null,
        deployCap: priv?.deployCap ?? 8, deployCount: priv?.deployCount ?? 0, reward: !!priv?.shop?.rewardOffer,
        hand: (priv?.hand || []).filter(Boolean).length, temp: (priv?.temp || []).filter(Boolean).length,
        board: (priv?.board || []).length, result: !!s.match.result, field: s.match.field?.fieldId ?? null,
        fields: (pub?.fields || []).map((f) => `${f.fieldId}:${f.kind}:${f.live ? 1 : 0}`),
        sp: pub?.sp ? { turn: pub.sp.turn, picked: Object.keys(pub.sp.picks || {}).length } : null,
        draft: pub?.draft ? { turn: pub.draft.turn, picks: Object.keys(pub.draft.picks || {}).length } : null,
      };
    });
  }

  async waitFor(pred, what, timeout = 60000) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeout) {
      last = await this.st();
      if (pred(last)) return last;
      await sleep(200);
    }
    throw new Error(`${this.label}: timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
  }

  async close() { await this.browser?.close().catch(() => {}); }

  /** Real mouse click on the `nth` visible, uncovered element matching `sel` whose text includes `text`. */
  async click(sel, text = null, { timeout = 15000, optional = false, nth = 0, button = 'left', any = false } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const pt = await this.point(sel, text, nth, any);
      if (pt) {
        await this.page.mouse.click(pt.x, pt.y, { button });
        // 准备 with funds left asks first (剩余资金). Accept it so a test that means "start the fight" is not stuck in PREP.
        if (sel === '.readybtn') await this.confirmFundsLeft();
        return true;
      }
      await sleep(150);
    }
    if (optional) return false;
    throw new Error(`${this.label}: nothing clickable for ${sel}${text ? ` "${text}"` : ''}`);
  }

  /** If the 剩余资金 confirm is up, press 准备就绪. No dialog is a no-op. */
  async confirmFundsLeft() {
    await sleep(250);
    const open = await this.page.evaluate(() => {
      const t = document.querySelector('.modal__title');
      return !!(t && t.textContent.includes('剩余资金'));
    });
    if (!open) return false;
    return this.click('.modal__actions button', '准备就绪', { timeout: 4000 });
  }

  /** Centre of the nth visible, enabled (unless `any`), uncovered match (or null). */
  point(sel, text = null, nth = 0, any = false) {
    return this.page.evaluate((sel, text, nth, any) => {
      let n = 0;
      for (const el of document.querySelectorAll(sel)) {
        if (text && !(el.textContent || '').includes(text)) continue;
        if (!any && (el.disabled || el.getAttribute('aria-disabled') === 'true')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const x = r.left + r.width / 2; const y = r.top + r.height / 2;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const top = document.elementFromPoint(x, y);
        if (top && !el.contains(top) && !top.contains(el)) continue; // covered
        if (n++ < nth) continue;
        return { x, y };
      }
      return null;
    }, sel, text, nth, any);
  }

  async exists(sel) { return !!(await this.page.$(sel)); }

  async visible(sel) {
    return this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }, sel);
  }

  async shot(name) {
    const file = `${this.prefix}-${name}${this.w === 1280 ? '-720' : ''}.png`;
    await this.page.screenshot({ path: path.join(OUT, file) });
    this.shots.push(file);
    return file;
  }

  /** Title → lobby with a callsign. */
  async enter(name) {
    await this.page.waitForSelector('.title-login input', { timeout: 20000 });
    await this.click('.title-login input');
    await this.page.keyboard.type(name);
    await this.click('.title-login button', '开始');
    await this.page.waitForSelector('.lobby-screen', { timeout: 20000 });
  }

  // ---- field view (render engine debug hooks) -------------------------------------------------------------------

  viewKind() { return this.page.evaluate(() => globalThis.__SP_VIEW__?.kind ?? null); }
  viewStats() { return this.page.evaluate(() => { try { return globalThis.__SP_VIEW__?.raw?.stats?.() ?? null; } catch { return null; } }); }

  /** Client point to grab a prep piece (`at` = fraction of the piece rect's height, from the top). */
  piecePoint(uid, at = 0.72) {
    return this.page.evaluate((uid, at) => {
      const r = globalThis.__SP_VIEW__?.pieceScreenRect(uid);
      return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height * at } : null;
    }, uid, at);
  }

  /** Record the view's pieceDrop events (for diagnostics) and return + clear them. */
  drops() {
    return this.page.evaluate(() => {
      const v = globalThis.__SP_VIEW__;
      if (v && !v.__e2eHooked) { v.__e2eHooked = true; globalThis.__e2eDrops = []; v.on('pieceDrop', (e) => globalThis.__e2eDrops.push(e)); v.on('pieceDragStart', (e) => globalThis.__e2eDrops.push({ start: e?.uid })); }
      const out = globalThis.__e2eDrops || [];
      globalThis.__e2eDrops = [];
      return JSON.stringify(out);
    });
  }

  /** Visible toast texts. */
  toasts() { return this.page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).filter(Boolean)); }

  /**
   * Client point of a board tile centre (top face). BOARD coordinates: the view's `tileScreen` maps them to where the
   * tile is drawn (the Final Assault prep shows the own board on a half of the boss field, mirrored on the right).
   */
  tilePoint(row, col) {
    return this.page.evaluate((row, col) => {
      const raw = globalThis.__SP_VIEW__?.raw;
      if (typeof raw?.tileScreen === 'function') {
        const t = raw.tileScreen(row, col);
        if (t && Number.isFinite(t.x) && Number.isFinite(t.y)) return { x: t.x, y: t.y };
      }
      const cam = raw?.debug?.cam;
      if (!cam) return null;
      const z = raw.debug.tiles.heightAt(row, col);
      const p = cam.project(col, row, z);
      const cr = raw.debug.app.view.getBoundingClientRect();
      return { x: cr.left + p.x, y: cr.top + p.y };
    }, row, col);
  }

  /** Press at `from`, move in steps to `to`, optionally screenshot mid-drag, release. */
  async drag(from, to, { steps = 14, midShot = null } = {}) {
    const m = this.page.mouse;
    await m.move(from.x, from.y);
    await m.down();
    for (let i = 1; i <= steps; i++) {
      await m.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
      await sleep(14);
    }
    await sleep(160);
    if (midShot) await this.shot(midShot);
    await m.up();
  }

  /** An empty legal tile for a piece (mirrors the deploy rules: melee on melee tiles, ranged anywhere). */
  freeTileFor(uid, { prefer = 'gate' } = {}) {
    return this.page.evaluate((uid, prefer) => {
      const { store, data } = globalThis.__SP__;
      const s = store.get();
      const priv = s.match.private;
      const st = data.lookup('stages', s.match.public.stageId);
      const piece = [...priv.hand, ...priv.temp, ...priv.board].find((p) => p && p.uid === uid);
      if (!piece || !st?.deployTiles?.normal) return null;
      const rec = piece.kind === 'token' ? data.lookup('tokens', piece.id) : data.lookup('chess', piece.id);
      const melee = rec?.position === 'MELEE';
      const dt = st.deployTiles.normal;
      const tiles = melee ? dt.melee : [...dt.rangedOnly, ...dt.melee];
      const used = new Set(priv.board.map((p) => `${p.row},${p.col}`));
      const free = tiles.filter(([r, c]) => !used.has(`${r},${c}`));
      if (!free.length) return null;
      if (prefer === 'gate') free.sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]));
      else free.sort((a, b) => (a[1] - b[1]) || (b[0] - a[0]));
      return { row: free[0][0], col: free[0][1] };
    }, uid, prefer);
  }

  handPieces(kind = null) {
    return this.page.evaluate((kind) => {
      const priv = globalThis.__SP__.store.get().match.private;
      return (priv?.hand || []).map((p, idx) => p && { uid: p.uid, id: p.id, kind: p.kind, golden: !!p.golden, idx })
        .filter((p) => p && (!kind || p.kind === kind));
    }, kind);
  }

  boardPieces() {
    return this.page.evaluate(() => (globalThis.__SP__.store.get().match.private?.board || []).map((p) => ({
      uid: p.uid, id: p.id, kind: p.kind, golden: !!p.golden, row: p.row, col: p.col, items: (p.items || []).length,
    })));
  }

  async isEditable() {
    const s = await this.st();
    return s.phase === 'PREP' && !s.ready && s.alive;
  }

  // ---- direction wheel / intents (research 09 §1.2 / §5) --------------------------------------------------------

  /** Record every intent the UI sends (wraps net.request once per page; ui/gameActions.js looks it up per call). */
  hookRequests() {
    return this.page.evaluate(() => {
      const n = globalThis.__SP__.net;
      if (n.__e2eReq) return;
      const orig = n.request.bind(n);
      globalThis.__e2eReq = [];
      n.request = (t, f, o) => { globalThis.__e2eReq.push([t, JSON.parse(JSON.stringify(f || {}))]); return orig(t, f, o); };
      n.__e2eReq = true;
    });
  }

  /** Recorded intents of type `t` (all when null), oldest first. */
  requests(t = null) {
    return this.page.evaluate((t) => (globalThis.__e2eReq || []).filter((r) => !t || r[0] === t), t);
  }

  /** Geometry of the open direction wheel (client px): centre + half-diagonal, or null. */
  wheel() {
    return this.page.evaluate(() => {
      const el = document.querySelector('.fwheel__dia');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, half: r.width / 2 };
    });
  }

  /**
   * Choose a direction on the open wheel: press at its centre, drag towards `dir` (UP / RIGHT / DOWN / LEFT) past the
   * dead-zone, optionally screenshot while held, release. `dir` null = release in the centre (cancel).
   */
  async swipe(dir, { midShot = null, reach = 0.72, board = true } = {}) {
    const w = await this.wheel();
    if (!w) throw new Error(`${this.label}: no direction wheel open`);
    // `dir` is a BOARD direction: on the mirrored right half of the Final Assault prep the screen swipe is RIGHT ↔ LEFT
    const mirror = board && await this.page.evaluate(() => !!globalThis.__SP_VIEW__?.raw?.prepField?.()?.mirror);
    const sdir = mirror ? ({ RIGHT: 'LEFT', LEFT: 'RIGHT' }[dir] || dir) : dir;
    const v = { UP: [0, -1], RIGHT: [1, 0], DOWN: [0, 1], LEFT: [-1, 0] }[sdir] || [0, 0];
    const m = this.page.mouse;
    await m.move(w.x, w.y);
    await m.down();
    const steps = 10;
    for (let i = 1; i <= steps; i++) { await m.move(w.x + (v[0] * w.half * reach * i) / steps + 1, w.y + (v[1] * w.half * reach * i) / steps + 1); await sleep(16); }
    await sleep(200);
    if (midShot) await this.shot(midShot);
    await m.up();
  }

  /**
   * The equip-replace dialog (ui/equipReplace.js) is open after an item drop: pick equipped item `nth` (0 = the older)
   * and 确认替换. Returns false when no dialog is open.
   */
  async confirmReplace(nth = 0) {
    if (!(await this.exists('.eqr .eqr__opt'))) return false;
    await this.click('.eqr__opt', null, { nth });
    await this.click('.eqr__ok');
    await this.page.waitForFunction(() => !document.querySelector('.eqr'), { timeout: 4000 }).catch(() => {});
    return true;
  }

  /** Board piece `uid` as the store has it ({ row, col, dir }) or null. */
  boardPiece(uid) {
    return this.page.evaluate((uid) => {
      const p = (globalThis.__SP__.store.get().match.private?.board || []).find((x) => x.uid === uid);
      return p ? { row: p.row, col: p.col, dir: p.dir ?? null } : null;
    }, uid);
  }
}

/** Throw when any client logged console errors, page errors, failed requests or HTTP errors. */
export function problemsOf(clients) {
  const out = [];
  for (const c of clients) for (const p of c.problems) out.push(`${c.label}: ${p}`);
  return out;
}
