import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { startServer } from '../../server/index.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { spawnMapChar } from '../../server/sim/content/tokens.js';

const chrome = process.env.CHROME_PATH;
const enabled = process.env.SP_E2E === '1' && chrome && existsSync(chrome);

test('user Given a real battle with strategy medics When clicking units and closing details Then attack tiles follow selection',
  { skip: !enabled && 'Set SP_E2E=1 and CHROME_PATH', timeout: 60000 }, async () => {
    const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workers: 0, clientBuild: false,
      userFile: ':memory:', announcementsFile: null, assetIndex: false });
    const puppeteer = (await import('puppeteer-core')).default;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    try {
      for (const medicId of ['char_613_acmedc', 'char_605_cmedic']) {
        const h = makeBattle({ stageId: 'act2autochess_m01', units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 4 }], autoFinish: false });
        h.step();
        assert.ok(spawnMapChar(h.b, h.b.players[0].playerId, medicId));
        h.step();
        const field = h.b.fieldMeta();
        const snapshot = h.b.snapshot();
        assert.equal(field.units.length, 2);
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.port}/dev/game-mock.html?render=fallback&shot=1&phase=PREP`);
        await page.waitForSelector('.ff-piece');
        await page.evaluate(async ({ field, snapshot }) => {
          const { store } = await import('/js/store.js');
          const { net } = await import('/js/net.js');
          const pub = store.get().match.public;
          store.patch('match', { public: { ...pub, phase: 'COMBAT', fields: [{ fieldId: field.fieldId, players: [pub.players[0].playerId] }] }, field });
          // The local runner emits the snapshot synchronously, before the screen's field-entry effect.
          net._emit('b.snap', snapshot);
        }, { field, snapshot });
        await page.waitForSelector('.ff-unit');
        for (let i = 0; i < field.units.length; i++) {
          const units = await page.$$('.ff-unit');
          await units[i].click();
          await page.waitForSelector('.dpanel');
          await page.waitForSelector('.ff-tile.is-range');
          const lit = await page.$$eval('.ff-tile.is-range', (els) => els.map((e) => [Number(e.dataset.row), Number(e.dataset.col)]));
          const u = field.units[i];
          if (u.defId === medicId) {
            assert.ok(lit.some(([r, c]) => r === 10 && c === 5), 'medic reaches three columns right from the stage tile');
            assert.ok(!lit.some(([, c]) => c === 6), 'inactive skill does not extend the base range');
          }
          // A new wire snapshot must refresh the open overlay, not just the unit sprite.
          await page.evaluate(async ({ snapshot, id }) => {
            const { net } = await import('/js/net.js');
            net._emit('b.snap', { ...snapshot, units: snapshot.units.map((v) => v[0] === id ? [v[0], v[1] + 1, ...v.slice(2)] : v) });
          }, { snapshot, id: u.id });
          await page.waitForFunction((before) => {
            const now = [...document.querySelectorAll('.ff-tile.is-range')].map((e) => [Number(e.dataset.row), Number(e.dataset.col)]);
            return now.length === before.length && now.every(([r, c]) => before.some(([br, bc]) => br === r && bc + 1 === c));
          }, {}, lit);
          await page.evaluate(async () => {
            const { store } = await import('/js/store.js');
            store.patch('match', { public: { ...store.get().match.public, phase: 'SETTLE' } });
            // Allow Preact's after-paint phase effects to run before asserting retained UI.
            await new Promise((resolve) => setTimeout(resolve, 250));
          });
          assert.ok(await page.$('.dpanel'), 'same-field settlement keeps the inspected card');
          assert.ok(await page.$('.ff-tile.is-range'), 'same-field settlement keeps its range');
          await page.click('.dpanel__close');
          await page.waitForFunction(() => !document.querySelector('.ff-tile.is-range'));
          await page.evaluate(async (snapshot) => {
            const { net } = await import('/js/net.js');
            net._emit('b.snap', snapshot);
          }, snapshot);
        }
        await (await page.$$('.ff-unit'))[0].click();
        await page.waitForSelector('.ff-tile.is-range');
        await page.evaluate(async ({ field, snapshot }) => {
          const { store } = await import('/js/store.js');
          const { net } = await import('/js/net.js');
          const fieldId = `${field.fieldId}:next`;
          store.patch('match', { field: { ...field, fieldId } });
          net._emit('b.snap', { ...snapshot, fieldId });
        }, { field, snapshot });
        await page.waitForFunction(() => !document.querySelector('.dpanel') && !document.querySelector('.ff-tile.is-range'));
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally {
      await browser.close();
      await server.close();
    }
  });


// Real GameScreen + Pixi / Three renderer; only the prepared roster / enemy preview is a controlled fixture.
const rangeBrowser = process.env.SP_RANGE_BROWSER === 'firefox' ? 'firefox' : 'chrome';
const rangeExecutable = rangeBrowser === 'firefox' ? process.env.FIREFOX_PATH : chrome;
const rangeEnabled = process.env.SP_E2E === '1' && rangeExecutable && existsSync(rangeExecutable);
test('user Given a boss hit rectangle When inspecting an operator Then striped overlap matches deployment and stays below units',
  { skip: !rangeEnabled && 'Set SP_E2E=1 and CHROME_PATH (or SP_RANGE_BROWSER=firefox and FIREFOX_PATH)', timeout: 240000 }, async () => {
    const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workers: 0, clientBuild: false,
      userFile: ':memory:', announcementsFile: null, assetIndex: false });
    const puppeteer = (await import('puppeteer-core')).default;
    const launch = () => puppeteer.launch({ browser: rangeBrowser, executablePath: rangeExecutable, headless: true, protocolTimeout: 45000,
      args: rangeBrowser === 'chrome' ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['-remote-allow-system-access'],
      extraPrefsFirefox: { 'webgl.force-enabled': true, 'dom.ipc.processCount': 2, 'dom.ipc.processCount.webIsolated': 1,
        'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false } });
    const out = new URL('../e2e/out/selected-range/', import.meta.url);
    mkdirSync(out, { recursive: true });
    const receipts = [];
    let browser;
    try {
      for (const [side, healing, width, height] of [['L', false, 1440, 900], ['R', false, 1280, 720], ['L', true, 1280, 720], ['R', true, 844, 390]]) {
        if (process.env.SP_RANGE_CASE && process.env.SP_RANGE_CASE !== `${side}-${healing ? 'heal' : 'attack'}`) continue;
        const name = `${rangeBrowser}-${side}-${healing ? 'heal' : 'attack'}-${width}`;
        console.log(`Range check: ${name}`);
        if (!browser) browser = await launch();
        console.log(`Range check: ${name} browser ready`);
        const page = await browser.newPage();
        console.log(`Range check: ${name} page ready`);
        const errors = [], diagnostics = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('requestfailed', req => diagnostics.push({ path: new URL(req.url()).pathname, error: req.failure()?.errorText }));
        page.on('response', res => { if (res.status() >= 400) diagnostics.push({ path: new URL(res.url()).pathname, status: res.status() }); });
        try {
          await page.setViewport({ width, height });
          console.log(`Range check: ${name} viewport ready`);
          await page.goto(`http://127.0.0.1:${server.port}/dev/game-mock.html?render=engine&board=3d&shot=1&phase=PREP&variant=${side === 'R' ? 'bossR' : 'boss'}&version=regulation&stage=act3autochess_m09`);
          await page.waitForFunction(() => globalThis.__MOCK__ && globalThis.__SP_VIEW__?.raw?.debug?.board3d, { timeout: 60000 });
          console.log(`Range check: ${name} renderer ready`);
          const fixture = await page.evaluate(async (healing) => {
            const { data } = await import('/js/data.js');
            const { isHealingRange } = await import('/js/ui/rangeStyle.js');
            const chess = data.list('chess').find(c => !c.isGolden && (healing ? isHealingRange(c) : c.charId === 'char_103_angel'));
            if (!chess) throw new Error('Missing official range fixture');
            globalThis.__MOCK__.mutate(s => {
              s.priv.board = [{ uid: 9001, kind: 'chess', id: chess.chessId, tier: chess.tier, dir: 'RIGHT', row: 11, col: 8, items: [] }];
              s.priv.nextEnemies = [{ enemyKey: 'enemy_9013_acstmk', count: 1, boss: true, source: 'wave', start: [3, 10], t: 0 }];
              s.pub.deadline = Date.now() + 3600000;
            });
            globalThis.__MOCK__.pushPublic();
            return chess.chessId;
          }, healing);
          await page.waitForFunction(() => !!globalThis.__SP_VIEW__.raw.debug.views.get('p:9001'));
          await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1800)));
          const position = () => page.evaluate(() => {
            const raw = globalThis.__SP_VIEW__.raw, rect = raw.pieceScreenRect(9001);
            if (rect) for (const fy of [.65, .4, .85, .2]) for (const fx of [.5, .3, .7]) {
              const x = rect.left + rect.width * fx, y = rect.top + rect.height * fy;
              if (raw.pieceAtClientPoint(x, y) === 9001) return { x, y };
            }
            throw new Error(`No unobstructed piece click point: ${JSON.stringify(rect)}`);
          });
          await page.screenshot({ path: new URL(`${name}-before-click.png`, out).pathname });
          const pos = await position();
          await page.mouse.click(pos.x, pos.y);
          await page.waitForFunction(() => document.querySelector('.dpanel') && globalThis.__SP_VIEW__.raw.debug.tiles.highlights.has('selRange'));
          await page.waitForSelector('.fwheel__stripes--under polygon');
          const check = await page.evaluate(() => {
            const raw = globalThis.__SP_VIEW__.raw, hl = raw.debug.tiles.highlights;
            const range = hl.get('selRange').tiles, boss = hl.get('leaderHit').tiles;
            const overlap = range.filter(([r, c]) => boss.some(([br, bc]) => r === br && c === bc));
            const svg = document.querySelector('.fwheel__stripes--under'), host = svg.parentElement;
            const rect = host.getBoundingClientRect();
            const xf = raw.prepField();
            const polys = [...svg.querySelectorAll('polygon')].map(p => p.getAttribute('points'));
            const expected = range.map(([r, c]) => {
              const tile = raw.tileScreen(r + 7, xf.mirror ? 20 - c : c);
              return tile.poly.map(([x, y]) => `${(x - rect.left).toFixed(1)},${(y - rect.top).toFixed(1)}`).join(' ');
            });
            return { range, overlap, polys, expected, beforeUnits: svg.nextSibling === raw.debug.app.view,
              stripe: svg.querySelector('pattern rect').getAttribute('fill'), pointerEvents: getComputedStyle(svg).pointerEvents,
              layers: host.querySelectorAll('.fwheel__stripes--under').length, side: xf.side };
          });
          assert.ok(check.overlap.length > 0, 'fixture actually overlaps the boss body');
          assert.deepEqual(check.polys, check.expected, 'each stripe uses the same single board transform, including mirrored R');
          assert.equal(check.beforeUnits, true); assert.equal(check.layers, 1); assert.equal(check.pointerEvents, 'none');
          assert.equal(check.side, side);
          assert.equal(check.stripe, healing ? 'rgba(138,229,255,.5)' : 'rgba(255,178,70,.5)');
          await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));
          await page.screenshot({ path: new URL(`${name}.png`, out).pathname });
          // Changing board modes while the SAME detail remains open must switch ownership to the native stripes.
          await page.evaluate(() => globalThis.__SP_VIEW__.raw.setBoardMode('2d'));
          await page.waitForFunction(() => !document.querySelector('.fwheel__stripes--under'));
          assert.equal(await page.evaluate(() => globalThis.__SP_VIEW__.raw.debug.tiles.highlights.get('selRange').style.stripes), true);
          if (side === 'L' && !healing) await page.screenshot({ path: new URL(`${name}-2d.png`, out).pathname });
          await page.evaluate(() => globalThis.__SP_VIEW__.raw.setBoardMode('3d'));
          await page.waitForSelector('.fwheel__stripes--under polygon');
          assert.equal(await page.$$eval('.fwheel__stripes--under', els => els.length), 1);
          await page.click('.dpanel__close');
          await page.waitForFunction(() => !document.querySelector('.fwheel__stripes--under') && !globalThis.__SP_VIEW__.raw.debug.tiles.highlights.has('selRange'));
          // Click again to ensure the managed SVG is released and recreated rather than accumulated.
          const again = await position(); await page.mouse.click(again.x, again.y);
          await page.waitForSelector('.fwheel__stripes--under polygon');
          assert.equal(await page.$$eval('.fwheel__stripes--under', els => els.length), 1);
          await page.click('.dpanel__close');
          await page.waitForFunction(() => !document.querySelector('.fwheel__stripes--under'));
          if (side === 'L' && !healing) {
            let from = await position(); await page.mouse.click(from.x, from.y);
            await page.waitForSelector('.fwheel__stripes--under polygon');
            from = await position(); // selection adds action buttons; resolve an unobstructed canvas point again
            const to = await page.evaluate(() => { const t = globalThis.__SP_VIEW__.raw.tileScreen(11, 8); return { x: t.x, y: t.y }; });
            await page.mouse.move(from.x, from.y); await page.mouse.down();
            await page.mouse.move(from.x + 40, from.y, { steps: 4 });
            await page.mouse.move(to.x, to.y, { steps: 6 });
            await page.waitForFunction(() => !document.querySelector('.fwheel__stripes--under') && !document.querySelector('.dpanel'));
            await page.mouse.up(); await page.waitForSelector('.fwheel');
            await page.keyboard.press('ArrowRight');
            await page.waitForSelector('.fwheel__stripes--under polygon');
            const wheel = await page.evaluate(() => ({
              layers: document.querySelectorAll('.fwheel__stripes--under').length,
              range: globalThis.__SP_VIEW__.raw.debug.tiles.highlights.get('facing')?.tiles.length,
              selected: globalThis.__SP_VIEW__.raw.debug.tiles.highlights.has('selRange'),
            }));
            assert.equal(wheel.layers, 1); assert.ok(wheel.range > 0); assert.equal(wheel.selected, false);
            await page.screenshot({ path: new URL(`${name}-deployment.png`, out).pathname });
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => !document.querySelector('.fwheel') && !document.querySelector('.fwheel__stripes--under'));
          }
          receipts.push({ name, fixture, check, errors, diagnostics });
          writeFileSync(new URL(`${rangeBrowser}.json`, out), JSON.stringify(receipts, null, 2));
          assert.deepEqual(errors, []);
          assert.deepEqual(diagnostics, []);
        } catch (error) {
          writeFileSync(new URL(`${name}-failure.json`, out), JSON.stringify({ error: error.message, errors, diagnostics }, null, 2));
          await page.screenshot({ path: new URL(`${name}-failure.png`, out).pathname }).catch(() => {});
          throw error;
        } finally {
          // Bound Firefox's WebGL / BiDi resources with an isolated profile per case.
          if (rangeBrowser === 'firefox') { await browser.close(); browser = null; }
          else await page.close();
        }
      }
    } finally {
      await browser?.close();
      await server.close();
    }
  });
