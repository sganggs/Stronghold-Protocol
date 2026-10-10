// Real-server browser E2E of user playtest #2 item 10 (+ item 6 on the real flow): the boss round's prep shows the
// player's own half of the boss field (tiles, gates, objective) and placing works — solo (标准: R9 最终攻势; 险境:
// R15 隐秘核心) and co-op (two humans: the host prepares on the LEFT half, the guest on the mirrored RIGHT half) — then
// the Final Assault starts with the placed units on the boss field. Along the way (item 6): the pen stays hidden with
// the board (🔍▶▶ shows it, 🔍◀◀ "返回战场" hides it again), scouting a teammate (前往查看) and coming back, and in
// the boss battle.
//
//   SP_E2E=1 node --test test/ui/playtest2.real.e2e.test.js
//   SP_E2E=1 SP_P2_REAL=solo|hidden|coop|observe node --test test/ui/playtest2.real.e2e.test.js
//
// Item 6 on the playtest's own flow ('observe'): co-op with an AI teammate (fastServer SP_IDLE_BOTS: the AI places
// nothing, so its battle lasts the enemies' whole walk), the human's battle ends first → 前往查看 the AI's running battle
// → 返回战场: the camera frames the own battlefield again, no enemy pen (figures, 2D rows, 3D area).
//
// The server is test/e2e/fastServer.mjs with its test hook SP_START_ROUND ('boss' / 'hidden': the first round of the
// match is the boss round, every human gets a few operators and funds) — everything else is the real match engine
// and the real UI driven by real mouse input. Screenshots: test/e2e/out/fix-boss-*.png.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, sleep, hasChrome, startRealServer, problemsOf, waitForFunctionLong } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const ONLY = process.env.SP_P2_REAL || '';
const only = (k) => (ONLY && ONLY !== k ? `SP_P2_REAL=${ONLY}` : false);

let puppeteer = null;
const pptr = async () => { if (!puppeteer) puppeteer = (await import('puppeteer-core')).default; return puppeteer; };

/** Field view state: camera, prep field, drawn rows, 3D area, pen figures, the boss field's gates / objective on screen. */
function viewState(c) {
  return c.page.evaluate(() => {
    const v = globalThis.__SP_VIEW__;
    const raw = v?.raw;
    const d = raw?.debug;
    const s = globalThis.__SP__.store.get();
    const st = globalThis.__SP__.data.lookup('stages', s.match.public?.stageId);
    const pens = d ? [...d.penViews.values()] : [];
    const onScreen = (row, col) => {
      if (!d?.cam) return false;
      const p = d.cam.project(col, row, 0);
      const cr = d.app.view.getBoundingClientRect();
      return p.x > 0 && p.y > 0 && p.x < cr.width && p.y < cr.height;
    };
    // the boss field's own-half landmarks (research 05 §2.2: gates 'O', objective 'E' on rows 0–5)
    const marks = [];
    (st?.rows || []).forEach((line, r) => { if (r > 5) return; [...line].forEach((ch, cc) => { if (ch === 'O' || ch === 'E') marks.push({ ch, r, c: cc }); }); });
    return {
      kind: v?.kind, camera: document.querySelector('.gm')?.dataset.camera, camKind: d?.camKind ?? null,
      prepField: raw?.prepField?.() ?? null, band: d?.tiles.band ?? null,
      area3d: d?.board3d ? Math.max(...d.board3d.area.map((a) => a.r1)) : null,
      pen: pens.length, penVisible: pens.filter((x) => x.root && x.root.visible !== false).length,
      marks: marks.map((m) => ({ ...m, on: onScreen(m.r, m.c) })),
      // prep piece views: board uid → world y (FA prep: board row − 7)
      prepY: Object.fromEntries((s.match.private?.board || []).map((p) => [p.uid, d?.views.get('p:' + p.uid)?.y ?? null])),
    };
  });
}

async function soloToPrep(c, diff) {
  await c.open();
  await c.enter('煌');
  await c.click('.mode-card', '独立模拟');
  await c.click('.diff-card', diff);
  await c.click('.create-box button', '开始独立模拟');
  await c.waitFor((s) => !!s.room, 'solo room');
  if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
  await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
  await c.click('.brief__foot .btn--primary', '准备就绪');
  await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
  await c.click('.dband', null, { nth: 1 });
  await c.click('.draft-detail__btns .btn--primary', '确认选择');
  const s = await c.waitFor((x) => x.phase === 'PREP' && !x.ready, 'boss-round prep', 60000);
  await sleep(1800); // camera flight + pieces
  return s;
}

/** Hand → board through the direction wheel; returns the placed { uid, row, col }. */
async function placeOne(c, dir = 'RIGHT') {
  await c.hookRequests();
  const hand = (await c.handPieces('chess'));
  assert.ok(hand.length, `${c.label}: the starter kit is in the hand`);
  for (const p of hand) {
    const tile = await c.freeTileFor(p.uid);
    if (!tile) continue;
    const from = await c.piecePoint(p.uid);
    const to = await c.tilePoint(tile.row, tile.col);
    assert.ok(from && to, `${c.label}: piece and tile on screen`);
    await c.drag(from, to);
    await c.page.waitForSelector('.fwheel__dia', { timeout: 4000 });
    await c.swipe(dir);
    const placed = await c.waitFor((x) => x.board > 0, 'placed', 8000).then(() => c.boardPiece(p.uid), () => null);
    if (placed) {
      assert.deepEqual([placed.row, placed.col], [tile.row, tile.col], `${c.label}: landed on the board tile`);
      assert.equal(placed.dir, dir, `${c.label}: with the chosen direction`);
      return { uid: p.uid, ...placed };
    }
  }
  throw new Error(`${c.label}: nothing could be placed`);
}

/** The boss-round prep checks shared by every variant. */
async function checkBossPrep(c, side, tag) {
  const v = await viewState(c);
  assert.equal(v.kind, 'engine', `${tag}: the render engine is mounted`);
  assert.equal(v.camera, 'bossPrep', `${tag}: the prep camera is the boss field's`);
  assert.equal(v.camKind, 'bossPrep');
  assert.deepEqual(v.prepField, { kind: 'bossPrep', side, mirror: side === 'R' }, `${tag}: own ${side} half`);
  assert.deepEqual(v.band, [0, 13], `${tag}: the boss field rows are drawn (no pen rows)`);
  if (v.area3d != null) assert.ok(v.area3d <= 6, `${tag}: the 3D board builds the boss field (${v.area3d})`);
  const own = v.marks.filter((m) => (side === 'R' ? m.c >= 10 : m.c <= 10));
  assert.ok(own.length >= 2, `${tag}: boss-field gates / objective exist (${JSON.stringify(v.marks)})`);
  assert.ok(own.every((m) => m.on), `${tag}: the own half's gates and objective are on screen (${JSON.stringify(own)})`);
  assert.equal(v.penVisible, 0, `${tag}: no pen figure with the board`);
  return v;
}

/** 🔍▶▶ → the pen (the boss wave), 🔍◀◀ (返回战场) → back to the boss field, pen hidden again. */
async function penRoundTrip(c, tag) {
  await c.click('.enemybtn');
  await c.page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'pen', { timeout: 4000 });
  await sleep(700);
  const p = await viewState(c);
  assert.ok(p.pen > 0 && p.penVisible > 0, `${tag}: the pen shows the boss wave`);
  await c.shot('boss-pen');
  await c.click('.gtop__iconbtn');
  await c.page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'bossPrep', { timeout: 4000 });
  await sleep(900);
  const b = await viewState(c);
  assert.equal(b.penVisible, 0, `${tag}: back on the boss field (返回战场): no pen figure`);
  assert.deepEqual(b.band, [0, 13]);
}

/** The Final Assault / Hidden Core battle: the boss field with the placed unit on its boss row. */
async function checkBossBattle(c, placed, side, tag) {
  await c.waitFor((s) => s.phase === 'FINAL_ASSAULT' || s.phase === 'HIDDEN_CORE', 'boss battle', 60000);
  await c.page.waitForFunction(() => { const s = globalThis.__SP_VIEW__?.raw?.stats?.(); return !!s && s.mode === 'battle' && s.units > 0; }, { timeout: 30000 });
  await sleep(1500);
  // the unit's battle view (units deploy one after another at the start)
  await c.page.waitForFunction((uid) => [...globalThis.__SP_VIEW__.raw.debug.views.values()].some((x) => x?.info?.uid === uid), { timeout: 10000 }, placed.uid)
    .catch(async () => console.log(tag, 'views:', JSON.stringify(await c.page.evaluate(() => [...globalThis.__SP_VIEW__.raw.debug.views.values()].map((x) => [x.info?.uid, x.info?.defId, x.info?.side, x.info?.x, x.info?.y])))));
  const r = await c.page.evaluate((uid) => {
    const d = globalThis.__SP_VIEW__.raw.debug;
    const s = globalThis.__SP__.store.get();
    const view = [...d.views.values()].find((x) => x?.info?.uid === uid) || null;
    const u = view ? { x: view.info.x, y: view.info.y } : null;
    const pens = [...d.penViews.values()];
    return {
      camKind: d.camKind, field: s.match.field?.kind, band: d.tiles.band,
      area3d: d.board3d ? Math.max(...d.board3d.area.map((a) => a.r1)) : null,
      unit: u ? { x: u.x, y: u.y } : null, view: view ? { x: view.x, y: view.y } : null, penVisible: pens.filter((x) => x.root?.visible !== false).length,
    };
  }, placed.uid);
  assert.ok(r.field === 'boss' || r.field === 'hidden', `${tag}: the battle is on the boss field (${r.field})`);
  assert.equal(r.camKind, 'boss');
  assert.equal(r.penVisible, 0, `${tag}: no pen in the boss battle`);
  assert.ok(r.band[1] <= 13, `${tag}: no pen rows drawn (${r.band})`);
  if (r.area3d != null) assert.ok(r.area3d <= 6, `${tag}: boss area only`);
  assert.ok(r.unit, `${tag}: the placed unit fights (${JSON.stringify(r)})`);
  assert.equal(Math.round(r.unit.y), placed.row - 7, `${tag}: on its boss row (board row ${placed.row} − 7)`);
  assert.equal(Math.round(r.unit.x), side === 'R' ? 20 - placed.col : placed.col, `${tag}: on its ${side} column`);
  await c.shot('boss-battle');
}

/** Camera / pen state of the battle view (item 6). */
function battleViewState(c) {
  return c.page.evaluate(() => {
    const d = globalThis.__SP_VIEW__?.raw?.debug;
    const s = globalThis.__SP__.store.get();
    const pens = d ? [...d.penViews.values()] : [];
    const r = globalThis.__SP_RUNNER__?.state?.() || null;
    return {
      camera: document.querySelector('.gm')?.dataset.camera ?? null, camKind: d?.camKind ?? null, band: d?.tiles.band ?? null,
      area3d: d?.board3d ? Math.max(...d.board3d.area.map((a) => a.r1)) : null,
      penVisible: pens.filter((x) => x.root && x.root.visible !== false).length,
      penRowsDrawn: !!d && d.tiles.grid.some((row) => row.some((t) => t.r >= 14 && t.drawn)),
      field: s.match.field?.fieldId ?? null, runner: r ? { fieldId: r.fieldId, own: !!r.own, watch: !!r.watch, done: !!r.done } : null,
      // unit-layer sprites no view owns (a stale unit of the field shown before would stay drawn)
      orphans: d ? d.ctx.layers.units.children.filter((ch) => ch.visible !== false && ch.worldVisible !== false)
        .filter((ch) => ![...d.views.values()].some((v) => v && v.root === ch))
        .map((ch) => ch.getBounds()).filter((b) => b.width > 4 && b.height > 4).map((b) => `${Math.round(b.x)},${Math.round(b.y)}`) : [],
    };
  });
}

/**
 * Wait for a prep matching `pred`; a 机变 draft on the way is picked with its two taps (user playtest #4 item 2) —
 * a single human's 机变 is untimed (Match.soloUntimed, item 3): nothing picks it for them any more.
 */
async function untilPrep(c, pred, what, timeout = 90000) {
  const t0 = Date.now();
  for (;;) {
    const left = Math.max(2000, timeout - (Date.now() - t0));
    const s = await c.waitFor((x) => (x.phase === 'PREP' && pred(x)) || (x.phase === 'SP_DRAFT' && x.sp?.turn === x.me), what, left);
    if (s.phase === 'PREP') return s;
    await c.click('.spcard.is-pickable', null, { optional: true, timeout: 4000 });
    await c.click('.spcard.is-armed', null, { optional: true, timeout: 4000 });
    await c.waitFor((x) => x.phase !== 'SP_DRAFT' || x.sp?.turn !== x.me, '机变 picked', 15000);
  }
}

// The field's 3D area ends at its separator row 13 — the row-13 devices blow into the field (act2 m01's blowers, user
// playtest #5 item 6: render/app.js boardArea) — and the enemy preview pen starts at row 14.
const NO_PEN_R1 = 13;

function assertNoPen(v, tag) {
  assert.deepEqual(v.orphans, [], `${tag}: no stale unit sprite of another field`);
  assert.equal(v.penVisible, 0, `${tag}: no pen figure`);
  assert.equal(v.penRowsDrawn, false, `${tag}: no pen rows drawn (${v.band})`);
  assert.ok(v.band && v.band[1] <= 13, `${tag}: drawn rows ${v.band}`);
  if (v.area3d != null) assert.ok(v.area3d <= NO_PEN_R1, `${tag}: 3D area without the pen block (${v.area3d})`);
}

describe('user playtest #2 item 6 — 前往查看 → 返回战场 in combat (real server)', { skip: !ENABLED && 'set SP_E2E=1 (Chrome + public/assets)' }, () => {
  test('co-op with an AI: observing its battle and 返回战场 frame the battlefield only — never the enemy pen', { skip: only('observe'), timeout: 10 * 60 * 1000 }, async () => {
    const srv = await startRealServer({ fast: { timerScale: 0.5, combatSpeed: 2, startRound: 2, kit: 6, idleBots: true } });
    const c = new Client(await pptr(), srv.base, 'observe', { prefix: 'fix' });
    try {
      await c.open();
      await c.enter('煌');
      await c.click('.mode-card', '同盟模拟');
      await c.click('.diff-card', '标准模拟');
      await c.click('.create-box button', '创建同盟');
      await c.waitFor((s) => !!s.room?.code, 'room created');
      await c.click('button', '添加 AI 队友');
      await sleep(500);
      await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      await c.click('.brief__foot .btn--primary', '准备就绪');
      await c.waitFor((s) => s.phase === 'BAND_DRAFT' && s.draft?.turn === s.me || s.phase === 'PREP', 'my band pick', 60000);
      if ((await c.st()).phase === 'BAND_DRAFT') {
        await c.click('.dband:not(.is-taken)', null, { nth: 1 });
        await c.click('.draft-detail__btns .btn--primary', '确认选择');
      }
      let observed = false;
      for (let tries = 0; tries < 3 && !observed; tries++) {
        const s0 = await untilPrep(c, (s) => !s.ready, 'prep');
        await sleep(1500);
        // the own field fights with everything the deploy cap allows: it clears its wave long before the idle AI's
        // enemies have walked their whole path
        for (let k = 0; k < 8; k++) {
          const s = await c.st();
          if (s.deployCount >= s.deployCap || !(await c.handPieces('chess')).length) break;
          try { await placeOne(c, 'RIGHT'); } catch { break; }
          await sleep(300);
        }
        const v0 = await battleViewState(c);
        assertNoPen(v0, `R${s0.round} prep`);
        await c.click('.readybtn');
        await c.waitFor((s) => s.phase === 'COMBAT', 'combat', 60000);
        await sleep(1500);
        assertNoPen(await battleViewState(c), `R${s0.round} own battle`);
        // own battle over while the AI's field still runs (sliced: longer than the browser's 90 s protocol timeout)
        const target = await waitForFunctionLong(c.page, () => {
          const s = globalThis.__SP__.store.get();
          const r = globalThis.__SP_RUNNER__?.state?.();
          const pub = s.match.public;
          if (pub?.phase !== 'COMBAT') return 'phase';
          if (!r || !r.own || !r.done) return false;
          const f = (pub.fields || []).find((x) => x.kind === 'normal' && x.live && !x.players.includes(s.me.playerId));
          return f ? f.fieldId : 'none';
        }, { timeout: 120000, polling: 200 }).then((h) => h.jsonValue(), () => 'timeout');
        if (!target || ['phase', 'none', 'timeout'].includes(target)) { c.note(`R${s0.round}: no running teammate field after the own battle (${target})`); continue; }
        await c.page.waitForSelector('.chud__wait', { timeout: 5000 });
        await c.click('.team__row:not(.is-self) .team__btn', null, { nth: 0 });
        if (!(await c.click('.team__ob', '前往查看', { optional: true, timeout: 3000 }))) { c.note(`R${s0.round}: no 前往查看`); continue; }
        const ok = await c.page.waitForFunction((fid) => { const r = globalThis.__SP_RUNNER__?.state?.(); return !!r && r.fieldId === fid && r.watch; }, { timeout: 15000 }, target).then(() => true, () => false);
        if (!ok || (await c.st()).phase !== 'COMBAT') { c.note(`R${s0.round}: the observed battle ended meanwhile`); continue; }
        await sleep(1300);
        const w = await battleViewState(c);
        assert.equal(w.camKind, 'normal', 'observing: the battle camera');
        assertNoPen(w, 'observing the teammate');
        await c.shot('observe-teammate');
        if ((await c.st()).phase !== 'COMBAT') { c.note(`R${s0.round}: combat ended before 返回战场`); continue; }
        await c.click('.team__back, .chud__back', '返回战场', { timeout: 4000 });
        await c.page.waitForFunction(() => { const r = globalThis.__SP_RUNNER__?.state?.(); return !r || (r.own && !r.watch); }, { timeout: 10000 });
        await sleep(1300); // the camera flight
        const b = await battleViewState(c);
        if ((await c.st()).phase === 'COMBAT') {
          assert.equal(b.camKind, 'normal', `返回战场: the own battle camera (${b.camKind})`);
          assert.ok(b.runner?.own && !b.runner.watch, '返回战场: the own field is shown');
          assertNoPen(b, '返回战场');
          await c.shot('observe-back');
          observed = true;
        }
      }
      assert.ok(observed, `observed a teammate's battle and came back (${c.log.join(' | ')})`);
      // and the next prep: the board without the pen, the pen only with 🔍▶▶
      const s1 = await untilPrep(c, () => true, 'next prep');
      await sleep(1500);
      assertNoPen(await battleViewState(c), `R${s1.round} prep after observing`);
      assert.deepEqual(problemsOf([c]), []);
    } finally {
      if (c.problems.length) console.log(c.problems.slice(0, 20).join('\n'));
      await c.close();
      await srv.stop();
    }
  });
});

describe('user playtest #2 item 10 — boss-round prep on the boss field (real server)', { skip: !ENABLED && 'set SP_E2E=1 (Chrome + public/assets)' }, () => {
  test('solo 标准 (R9 最终攻势): the own half of the boss field while preparing, placing works, the FA uses it', { skip: only('solo'), timeout: 8 * 60 * 1000 }, async () => {
    const srv = await startRealServer({ fast: { timerScale: 0.5, combatSpeed: 8, startRound: 'boss' } });
    const c = new Client(await pptr(), srv.base, 'solo', { prefix: 'fix' });
    try {
      const s = await soloToPrep(c, '标准模拟');
      assert.equal(s.round, s.bossRound, 'the boss round');
      await checkBossPrep(c, 'L', 'solo');
      await c.shot('boss-prep-solo');
      const placed = await placeOne(c, 'RIGHT');
      await sleep(600);
      const v = await viewState(c);
      assert.equal(Math.round(v.prepY[placed.uid]), placed.row - 7, 'the placed piece stands on its boss row');
      await c.shot('boss-prep-solo-placed');
      await penRoundTrip(c, 'solo');
      await c.click('.readybtn');
      await checkBossBattle(c, placed, 'L', 'solo');
      assert.deepEqual(problemsOf([c]), []);
    } finally {
      if (c.problems.length) console.log(c.problems.slice(0, 20).join('\n'));
      await c.close();
      await srv.stop();
    }
  });

  test('solo 险境 (R15 隐秘核心): the boss field prep of the Hidden Core round', { skip: only('hidden'), timeout: 8 * 60 * 1000 }, async () => {
    const srv = await startRealServer({ fast: { timerScale: 0.5, combatSpeed: 8, startRound: 'hidden' } });
    const c = new Client(await pptr(), srv.base, 'hidden', { prefix: 'fix', w: 1366, h: 768 });
    try {
      const s = await soloToPrep(c, '险境模拟');
      assert.equal(s.round, 15, 'the Hidden Core round');
      await checkBossPrep(c, 'L', 'hidden');
      const placed = await placeOne(c, 'UP');
      await c.shot('boss-prep-hidden');
      await c.click('.readybtn');
      await checkBossBattle(c, placed, 'L', 'hidden');
      assert.deepEqual(problemsOf([c]), []);
    } finally {
      if (c.problems.length) console.log(c.problems.slice(0, 20).join('\n'));
      await c.close();
      await srv.stop();
    }
  });

  test('co-op 险境 (R14): host on the left half, guest on the mirrored right half; scouting and 返回 keep the pen hidden', { skip: only('coop'), timeout: 10 * 60 * 1000 }, async () => {
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 8, startRound: 'boss', items: ['chess_item_6_03_m'] } });
    const P = await pptr();
    const host = new Client(P, srv.base, 'host', { prefix: 'fix' });
    const guest = new Client(P, srv.base, 'guest', { prefix: 'fix', w: 1280, h: 720 });
    try {
      await host.open();
      await host.enter('凯尔希');
      await host.click('.mode-card', '同盟模拟');
      await host.click('.diff-card', '险境模拟');
      await host.click('.create-box button', '创建同盟');
      const room = (await host.waitFor((s) => !!s.room?.code, 'room created')).room;
      await guest.open(`?room=${room.code}`);
      await guest.enter('阿米娅');
      await guest.waitFor((s) => s.room?.code === room.code, 'guest joined');
      await guest.click('.room-bar__right button', '准备就绪');
      await sleep(400);
      await host.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      for (const c of [host, guest]) await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      for (const c of [host, guest]) await c.click('.brief__foot .btn--primary', '准备就绪');
      // the draft first (a client still in the briefing would count as done without picking: its turn then runs out —
      // Match.BAND_TURN_SECONDS, 50 s each since the 2026-10-10 official-play report)
      for (const c of [host, guest]) await c.waitFor((s) => s.phase !== 'INFO_CHECK', 'band draft', 40000);
      // band draft: whoever's turn it is picks a free strategy
      const picked = new Set();
      const t0 = Date.now();
      while (picked.size < 2 && Date.now() - t0 < 120000) {
        for (const c of [host, guest]) {
          const s = await c.st();
          if (s.phase !== 'BAND_DRAFT') { picked.add(c.label); continue; }
          if (picked.has(c.label) || s.draft?.turn !== s.me) continue;
          await c.click('.dband:not(.is-taken)', null, { nth: c === host ? 2 : 5 });
          await sleep(200);
          await c.click('.draft-detail__btns .btn--primary', '确认选择');
          picked.add(c.label);
        }
        await sleep(250);
      }
      for (const c of [host, guest]) await c.waitFor((s) => s.phase === 'PREP' && !s.ready, 'boss-round prep', 60000);
      await sleep(1800);
      const hs = await host.st();
      assert.equal(hs.round, hs.bossRound, 'the boss round');
      await checkBossPrep(host, 'L', 'host');
      await checkBossPrep(guest, 'R', 'guest');
      const hp = await placeOne(host, 'RIGHT');
      const gp = await placeOne(guest, 'RIGHT');
      await sleep(600);
      const gv = await viewState(guest);
      assert.equal(Math.round(gv.prepY[gp.uid]), gp.row - 7, 'guest: on its boss row');
      await host.shot('boss-prep-coop-L');
      await guest.shot('boss-prep-coop-R');
      // scouting the teammate's board (前往查看) and coming back: no pen with the boards, the boss field again
      await host.click('.team__row:not(.is-self) .team__btn', null, { nth: 0 });
      assert.ok(await host.click('.team__ob', '前往查看', { optional: true, timeout: 3000 }), 'host: 前往查看 in the boss-round prep');
      {
        await host.page.waitForSelector('.gm__watching', { timeout: 6000 });
        await sleep(900);
        const w = await viewState(host);
        assert.equal(w.penVisible, 0, 'scouting: no pen figure with the teammate\'s board');
        assert.ok(w.band[1] <= 13, `scouting: no pen rows (${w.band})`);
        await host.click('.gm__watching button, .team__back', null, { timeout: 4000 });
        await host.page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'bossPrep', { timeout: 6000 });
        await sleep(900);
        const back = await viewState(host);
        assert.equal(back.penVisible, 0, '返回: no pen figure');
        assert.deepEqual(back.prepField, { kind: 'bossPrep', side: 'L', mirror: false }, '返回: the own boss half again');
      }
      await penRoundTrip(guest, 'guest');
      // Real clients open their own 教鞭 candidates together; refreshing one tab restores that same private choice.
      const choiceOf = (c) => c.page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__SP__.store.get().match.private.personalChoice)));
      const deadline = await host.page.evaluate(() => globalThis.__SP__.store.get().match.public.deadline);
      await Promise.all([[host, hp], [guest, gp]].map(async ([c, placed]) => {
        const art = (await c.handPieces('item')).find((p) => p.id === 'chess_item_6_03_m');
        assert.ok(art, `${c.label}: starter 教鞭`);
        await c.drag(await c.piecePoint(art.uid), await c.tilePoint(placed.row, placed.col));
        await c.page.waitForSelector('.spov[aria-label="教鞭选择"]', { timeout: 6000 });
      }));
      const hostChoice = await choiceOf(host), guestChoice = await choiceOf(guest);
      assert.notEqual(hostChoice.id, guestChoice.id);
      for (const c of [host, guest]) {
        assert.equal((await choiceOf(c)).cards.length, 3);
        assert.equal((await c.st()).canReady, false);
        assert.equal(await c.page.$('.spov__order'), null);
        assert.equal(await c.page.evaluate(() => globalThis.__SP__.store.get().match.public.deadline), deadline);
      }
      await host.page.reload({ waitUntil: 'networkidle0' });
      await host.page.waitForSelector('.spov[aria-label="教鞭选择"]', { timeout: 20000 });
      assert.deepEqual(await choiceOf(host), hostChoice, 'refresh reuses the ID and cards');
      assert.deepEqual(await choiceOf(guest), guestChoice, 'the teammate keeps its own candidates');
      await host.page.evaluate(async () => { await (await import('/js/ui/lang.js')).switchLang('en'); });
      await host.page.waitForSelector('.spov[aria-label="Pointing Stick Choice"]');
      assert.match(await host.page.$eval('.spov__title', (el) => el.textContent), /Pointing Stick · Tactical Training/);
      assert.equal(await host.page.$eval('[data-testid="ready-why"]', (el) => el.textContent), 'Complete the Pointing Stick choice first');
      assert.equal(await guest.page.$eval('.spov', (el) => el.getAttribute('aria-label')), '教鞭选择', 'language stays per client');
      assert.deepEqual(await choiceOf(host), hostChoice, 'language switch does not replace the offer');
      await host.page.evaluate(async () => { await (await import('/js/ui/lang.js')).switchLang('zh'); });
      await host.page.waitForSelector('.spov[aria-label="教鞭选择"]');
      const refused = await host.page.evaluate(async (id) => {
        try { await globalThis.__SP__.net.request('g.choice', { idx: 0, choiceId: id }); return null; }
        catch (e) { return e.code; }
      }, guestChoice.id);
      assert.equal(refused, 'BAD_TARGET', 'a live client cannot submit the teammate\'s ID');
      await host.shot('dobermann-private-reconnect');
      for (const c of [host, guest]) {
        await c.click('.spcard.is-pickable');
        assert.ok(await choiceOf(c), 'first tap only highlights');
        await c.click('.spov__confirm');
        await c.page.waitForFunction(() => globalThis.__SP__.store.get().match.private.personalChoice === null, { timeout: 6000 });
      }
      for (const c of [host, guest]) await c.click('.readybtn');
      await checkBossBattle(host, hp, 'L', 'host');
      await checkBossBattle(guest, gp, 'R', 'guest');
      assert.deepEqual(problemsOf([host, guest]), []);
    } finally {
      for (const c of [host, guest]) if (c.problems.length) console.log(c.label, c.problems.slice(0, 20).join('\n'));
      await host.close();
      await guest.close();
      await srv.stop();
    }
  });
});
