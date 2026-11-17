// Real version hosts, real mouse input; test commands only construct the full bench / full field fixture.
// SP_E2E=1 node --test test/ui/bench-swap.e2e.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, hasChrome, problemsOf, sleep, cameraSettled } from '../e2e/client.mjs';

const enabled = process.env.SP_E2E === '1' && hasChrome();
const request = (c, type, body = {}) => c.page.evaluate((type, body) => globalThis.__SP__.net.request(type, body), type, body);
const state = c => c.page.evaluate(() => globalThis.__SP__.store.get().match.private);
let srv, savedTestMode;
before(async () => {
  if (!enabled) return;
  savedTestMode = process.env.SP_TEST_MODE;
  process.env.SP_TEST_MODE = '1';
  const { startServer } = await import('../../server/index.js');
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false,
    versions: { enabled: 'all' }, matchHost: { matchOptions: { botRehearsal: 0 } } });
});
after(async () => {
  if (!enabled) return;
  await srv?.close();
  if (savedTestMode === undefined) delete process.env.SP_TEST_MODE;
  else process.env.SP_TEST_MODE = savedTestMode;
});

for (const version of ['act2autochess', 'act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1']) {
  for (const render of ['fallback', 'engine']) {
    test(`${version} ${render}: full bench drag swaps and tap / tile picking`, { skip: !enabled, timeout: 120_000 }, async t => {
      const puppeteer = (await import('puppeteer-core')).default;
      const c = new Client(puppeteer, srv.url, 'bench-swap', { prefix: 'bench-swap' });
      try {
        await c.open(`?render=${render}`);
        await c.enter('Tester');
        await request(c, 'room.create', { mode: 'solo', difficulty: 'NORMAL', test: true, version, soloUnlimited: true });
        await c.page.waitForFunction((id) => (globalThis.__SP__.data.get('config')?.version?.id || 'act2autochess') === id
          && (id === 'act2autochess' || globalThis.__SP_CONTENT__?.state()?.status === 'ready'), { timeout: 30000 }, version);
        await request(c, 'room.start');
        await c.waitFor(s => s.phase === 'INFO_CHECK', 'briefing');
        await request(c, 'g.infoReady');
        await c.waitFor(s => s.phase === 'BAND_DRAFT', 'strategy draft');
        await request(c, 'g.band', { bandId: 'band_bldsk' });
        await c.waitFor(s => s.phase === 'PREP', 'preparation');
        await request(c, 'g.test', { cmd: 'timers', args: { on: false } });
        await c.page.waitForFunction(() => !document.querySelector('.screen.draft, [data-testid="protocol-boot"]'));
        await c.page.waitForFunction(kind => globalThis.__SP_VIEW__?.kind === kind, {}, render);
        const initial = await state(c);
        for (const p of [...initial.hand, ...initial.temp, ...initial.board].filter(Boolean)) {
          await request(c, p.kind === 'chess' ? 'g.sell' : 'g.destroy', { uid: p.uid });
        }
        let grants = 0;
        const grant = async () => {
          // The host test console permits eight grants per command per ten seconds.
          if (grants > 0 && grants % 8 === 0) await sleep(10_100);
          grants++;
          const count = (await state(c)).hand.filter(Boolean).length;
          await request(c, 'g.test', { cmd: 'chess', args: { id: 'chess_char_1_10_b' } });
          await c.page.waitForFunction(n => globalThis.__SP__.store.get().match.private.hand.filter(Boolean).length === n + 1, {}, count);
          return (await state(c)).hand.find(Boolean);
        };
        for (let i = 0; i < initial.deployCap; i++) {
          const piece = await grant();
          const tile = await c.freeTileFor(piece.uid);
          assert.ok(tile);
          await request(c, 'g.move', { uid: piece.uid, to: { area: 'board', ...tile } });
          await c.page.waitForFunction(uid => globalThis.__SP__.store.get().match.private.board.some(p => p.uid === uid), {}, piece.uid);
        }
        while ((await state(c)).hand.some(p => !p)) await grant();
        const fixture = await state(c);
        const at = fixture.board[0];
        const idx = 5;
        const counts = s => [s.hand.filter(Boolean).length, s.board.filter(p => p.kind === 'chess').length, s.temp.filter(Boolean).length];
        assert.deepEqual(counts(fixture), [10, fixture.deployCap, 0]);
        await sleep(300);
        await cameraSettled(c.page);
        // Observe the actual requests, including rejected ones, so the pre-fix run reports every path.
        await c.page.evaluate(() => {
          const net = globalThis.__SP__.net, original = net.request.bind(net);
          globalThis.__benchMoves = [];
          net.request = async (type, body) => {
            try {
              const result = await original(type, body);
              if (type === 'g.move') globalThis.__benchMoves.push({ body, ok: true });
              return result;
            } catch (error) {
              if (type === 'g.move') globalThis.__benchMoves.push({ body, error: error.code || error.message });
              throw error;
            }
          };
        });
        await c.drops();
        const results = [];
        for (const path of ['bench-drag', 'field-drag', 'bench-tap-drag', 'field-tile-tap-drag']) {
          await c.drops();
          await c.page.keyboard.press('Escape');
          const before = await state(c);
          const board = before.board.find(p => p.row === at.row && p.col === at.col);
          const hand = before.hand[idx];
          const toBoard = path.startsWith('bench');
          const from = path === 'field-tile-tap-drag' && render === 'engine'
            ? await c.tilePoint(at.row, at.col) : await c.piecePoint(toBoard ? hand.uid : board.uid);
          assert.ok(from, path);
          if (path.includes('tap')) {
            await c.page.mouse.click(from.x, from.y);
            const uid = toBoard ? hand.uid : board.uid;
            await c.page.waitForSelector(`.uframe[data-uid="${uid}"]`, { visible: true });
            // The selection frame first reuses its old position. Wait until its retreat button has moved off the card.
            if (render === 'fallback') await c.page.waitForFunction(({ x, y, uid }) =>
              document.elementFromPoint(x, y)?.closest('.ff-piece')?.dataset.uid === String(uid), {}, { ...from, uid });
            // A tap selects the piece for inspection. Moving it still requires a drag; there is no click-click deploy.
          }
          const to = toBoard ? await c.tilePoint(at.row, at.col) : await c.piecePoint(hand.uid);
          const hit = await c.page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 350), from);
          await c.drag(from, to, { retarget: toBoard ? null : () => c.piecePoint(hand.uid) });
          if (toBoard) {
            await c.page.waitForSelector('.fwheel__dia', { timeout: 5000 });
            await c.page.waitForFunction(() => document.activeElement?.matches('.fwheel'));
            await c.page.keyboard.press('ArrowRight');
            await c.page.waitForSelector('.fwheel.is-right');
            await c.page.keyboard.press('Enter');
            await c.page.waitForSelector('.fwheel', { hidden: true });
          }
          try {
            await c.page.waitForFunction(n => globalThis.__benchMoves.length > n, { timeout: 5000 }, results.length);
          } catch (error) {
            t.diagnostic(JSON.stringify({ path, from, to, hit, drops: await c.drops(), toasts: await c.toasts(), results }));
            await c.shot(`failed-${version}-${render}`);
            throw error;
          }
          await cameraSettled(c.page);
          const result = await c.page.evaluate(() => globalThis.__benchMoves.at(-1));
          assert.equal(result.body.uid, toBoard ? hand.uid : board.uid, `${path}: picked the intended card`);
          assert.deepEqual(result.body.to, toBoard ? { area: 'board', row: at.row, col: at.col, dir: 'RIGHT' } : { area: 'hand', idx });
          // Version hosts acknowledge before their next private view arrives. Aim the next drag only after that view.
          if (result.ok) await c.page.waitForFunction(({ idx, boardUid, handUid, row, col }) => {
            const s = globalThis.__SP__.store.get().match.private;
            return s.hand[idx]?.uid === boardUid && s.board.some(p => p.uid === handUid && p.row === row && p.col === col);
          }, {}, { idx, boardUid: board.uid, handUid: hand.uid, row: at.row, col: at.col });
          const after = await state(c);
          assert.deepEqual(counts(after), counts(fixture), `${path}: no extra occupant or overflow`);
          results.push({ path, ...result, swapped: after.hand[idx]?.uid === board.uid
            && after.board.some(p => p.uid === hand.uid && p.row === at.row && p.col === at.col) });
        }
        t.diagnostic(JSON.stringify(results));
        assert.ok(results.every(r => r.ok && r.swapped), 'every input path completes the swap');
        assert.deepEqual(problemsOf([c]), []);
      } finally { await c.close(); }
    });
  }
}
