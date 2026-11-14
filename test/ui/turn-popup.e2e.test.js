// Real Preact-view regression checks for shared-draft turn cues.
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/turn-popup.e2e.test.js
// The browser gets synthetic SVGs and one tiny prefab through request interception; no game art is needed.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ART_PREFIX = '/__turn-popup-test-art/';
const ART_KEYS = ['bg_circle', 'square_1', 'square_2', 'plus', 'bottom'];
const PREFAB_PATH = '/assets/local/themes/ac_s_closur/prefabs.json';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><path fill="#4ed8af" d="M0 0h8v8H0z"/></svg>';

const assets = JSON.parse(readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));
const testAssets = {
  ...assets,
  ui: {
    ...assets.ui,
    ...Object.fromEntries(ART_KEYS.map((name) => [`effectChoose/${name}`, `${ART_PREFIX}${name}.svg`])),
  },
};
const localAssets = {
  groups: {
    'themes/ac_s_closur': {
      'prefabs.json': { path: PREFAB_PATH },
    },
  },
};
const themePrefabs = {
  spPrefabs: 1,
  prefabs: {
    'banner/effect_choose_self_select': {
      id: 1,
      name: 'SyntheticTurnBanner',
      rect: { pivot: [0.5, 0.5], sizeDelta: [420, 100], anchoredPosition: [0, 0] },
      scripts: [{ refs: { _title: 2 }, anims: { _showAnim: { clip: 'turn-show', on: 1 } } }],
      children: [{
        id: 2,
        name: 'Title',
        rect: { pivot: [0.5, 0.5], sizeDelta: [400, 80], anchoredPosition: [0, 0] },
        text: { text: 'fixture title', fontSize: 36, color: '#FFFFFFFF', align: 4 },
      }],
    },
  },
  clips: { 'turn-show': { len: 0.7, curves: [] } },
};

describe('shared 机变 turn cue (headless browser)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  });

  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  async function open({ phase = 'PREP', variant = '' } = {}) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const problems = [];
    await page.setBypassServiceWorker(true);
    await page.setViewport({ width: 1440, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/data/assets.json') {
        await request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(testAssets) });
      } else if (pathname === '/data/local-assets.json') {
        await request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(localAssets) });
      } else if (pathname === PREFAB_PATH) {
        await request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(themePrefabs) });
      } else if (pathname.startsWith(ART_PREFIX)) {
        await request.respond({ status: 200, contentType: 'image/svg+xml', body: SVG });
      } else if (pathname.startsWith('/assets/')) {
        await request.abort();
      } else {
        await request.continue();
      }
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&phase=${phase}${variant ? `&variant=${variant}` : ''}`, {
      waitUntil: 'networkidle0', timeout: 60000,
    });
    await page.waitForFunction(() => !!globalThis.__MOCK__, { timeout: 30000 });
    return { page, problems, context };
  }

  async function settle(page, delay = 60) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (delay) await sleep(delay);
  }

  async function setPhase(page, phase) {
    await page.evaluate((next) => globalThis.__MOCK__.setPhase(next), phase);
    await settle(page);
  }

  async function mutate(page, source) {
    await page.evaluate((body) => {
      const M = globalThis.__MOCK__;
      M.mutate(new Function('s', body));
      M.pushPublic();
    }, source);
    await settle(page);
  }

  async function watchTurnCue(page) {
    await page.evaluate(async () => {
      const { audio } = await import('/js/audio.js');
      globalThis.__turnCueCalls = [];
      audio.sfx = (name, options = {}) => {
        if (name === 'yourTurn') {
          globalThis.__turnCueCalls.push({
            at: performance.now(),
            isCurrent: typeof options.isCurrent === 'function' ? options.isCurrent() : null,
            isCurrentFn: typeof options.isCurrent === 'function' ? options.isCurrent : null,
          });
        }
      };
    });
  }

  async function selectTheme(page) {
    const response = page.waitForResponse((res) => res.url().endsWith(PREFAB_PATH) && res.status() === 200, { timeout: 5000 });
    await page.evaluate(async () => {
      const { updateSettings } = await import('/js/ui/settings.js');
      updateSettings({ uiTheme: 'ac_s_closur' });
    });
    await response;
    await settle(page);
  }

  test('PREP, COMBAT and SP_DRAFT show no central phase banner', async () => {
    const { page, problems, context } = await open();
    try {
      for (const phase of ['PREP', 'COMBAT', 'SP_DRAFT']) {
        await setPhase(page, phase);
        assert.equal(await page.$('.pbanner'), null, `${phase} has no central banner`);
      }
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  });

  test('the default disc plays once, tolerates unrelated state updates, and invalidates its audio key when picked', async () => {
    const { page, problems, context } = await open();
    try {
      await watchTurnCue(page);
      await setPhase(page, 'SP_DRAFT');
      await page.waitForSelector('[data-testid="turn-popup"]', { timeout: 5000 });
      await page.waitForFunction(() => globalThis.__turnCueCalls.length === 1, { timeout: 3000 });
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="turn-popup"] img')]
        .every((img) => img.complete && img.naturalWidth > 0), { timeout: 3000 });

      assert.equal(await page.$('.pbanner'), null);
      assert.equal(await page.$$eval('[data-testid="turn-popup"] img', (imgs) => imgs.length), 8, 'all layers of the generic disc are present');
      assert.equal(await page.$('[data-testid="your-turn-banner"]'), null, 'the built-in theme uses the generic disc');
      assert.equal(await page.$eval('[data-testid="turn-popup"]', (el) => el.textContent.replace(/\s+/g, '')), '轮到你选');

      await mutate(page, 's.pub.serverNow += 100;');
      assert.equal(await page.evaluate(() => globalThis.__turnCueCalls.length), 1, 'an unrelated update does not replay the cue');

      await mutate(page, "s.pub.sp.picks.p1 = 0; s.pub.sp.turn = 'ai_2';");
      assert.equal(await page.evaluate(() => globalThis.__turnCueCalls.length), 1, 'picking ends this cue without replay');
      assert.equal(await page.evaluate(() => globalThis.__turnCueCalls[0].isCurrentFn()), false, 'the captured audio key is stale after the pick');
      assert.equal(await page.$('[data-testid="turn-popup"]'), null, 'the visual leaves as soon as this seat has picked');
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  });

  test('a loaded official theme draws one themed banner instead of the default disc', async () => {
    const { page, problems, context } = await open();
    try {
      await watchTurnCue(page);
      await selectTheme(page);
      await setPhase(page, 'SP_DRAFT');
      await page.waitForSelector('[data-testid="your-turn-banner"]', { timeout: 5000 });
      await page.waitForFunction(() => globalThis.__turnCueCalls.length === 1, { timeout: 3000 });

      assert.equal(await page.$('[data-testid="turn-popup"]'), null, 'the generic disc is not duplicated');
      assert.equal(await page.$eval('[data-testid="your-turn-banner"]', (el) => el.textContent.replace(/\s+/g, '')), '轮到你选');
      assert.equal((await page.$$('.mpop--pf[data-testid="your-turn-banner"]')).length, 1);
      assert.equal(await page.evaluate(() => globalThis.__turnCueCalls.length), 1);
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  });

  test('loading a theme after the cue does not replay it or replace its chosen renderer', async () => {
    const { page, problems, context } = await open();
    try {
      await watchTurnCue(page);
      await setPhase(page, 'SP_DRAFT');
      await page.waitForSelector('[data-testid="turn-popup"]', { timeout: 5000 });
      await page.waitForFunction(() => globalThis.__turnCueCalls.length === 1, { timeout: 3000 });

      await selectTheme(page);
      assert.equal(await page.$('[data-testid="your-turn-banner"]'), null, 'a late theme load does not replace this cue');
      assert.equal(await page.evaluate(() => globalThis.__turnCueCalls.length), 1, 'a late theme load does not replay the sound');

      await page.waitForFunction(() => !document.querySelector('[data-testid="turn-popup"]'), { timeout: 3000 });
      await sleep(200);
      assert.equal(await page.$('[data-testid="your-turn-banner"]'), null, 'the loaded theme waits for a later turn');
      assert.equal(await page.evaluate(() => globalThis.__turnCueCalls.length), 1);
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  });

  test('solo shared draft and a personal 教鞭 choice have no turn popup or your-turn sound', async () => {
    const solo = await open({ variant: 'solo' });
    try {
      await watchTurnCue(solo.page);
      await setPhase(solo.page, 'SP_DRAFT');
      await sleep(350);
      assert.deepEqual(await solo.page.evaluate(() => globalThis.__turnCueCalls), []);
      assert.equal(await solo.page.$('[data-testid="turn-popup"]'), null);
      assert.equal(await solo.page.$('[data-testid="your-turn-banner"]'), null);
      assert.deepEqual(solo.problems, []);
    } finally {
      await solo.context.close();
    }

    const personal = await open();
    try {
      await watchTurnCue(personal.page);
      await personal.page.evaluate(async () => {
        const { data } = await import('/js/data.js');
        const cards = data.get('choices').cards.bounty.filter((card) => card.draft !== false).slice(0, 3)
          .map((card) => ({ effectId: card.effectId }));
        const M = globalThis.__MOCK__;
        M.mutate((s) => {
          s.priv.playerId = 'p1';
          s.priv.alive = true;
          s.priv.personalChoice = { id: 'test-personal-choice', round: s.pub.round, cards };
        });
        M.pushPublic();
      });
      await settle(personal.page);
      await personal.page.waitForSelector('.spov--personal', { timeout: 3000 });
      await sleep(350);
      assert.deepEqual(await personal.page.evaluate(() => globalThis.__turnCueCalls), []);
      assert.equal(await personal.page.$('[data-testid="turn-popup"]'), null);
      assert.equal(await personal.page.$('[data-testid="your-turn-banner"]'), null);
      assert.deepEqual(personal.problems, []);
    } finally {
      await personal.context.close();
    }
  });

  test('a pick during the round plate cancels the delayed turn cue and keeps one round popup', async () => {
    const { page, problems, context } = await open({ phase: 'ROUND_START' });
    try {
      await watchTurnCue(page);
      await page.waitForSelector('[data-testid="round-popup"]', { timeout: 5000 });
      await setPhase(page, 'SP_DRAFT');
      assert.equal((await page.$$('[data-testid="round-popup"]')).length, 1, 'the existing round plate remains singular');

      await mutate(page, "s.pub.sp.picks.p1 = 0; s.pub.sp.turn = 'ai_2';");
      await sleep(2300);
      assert.deepEqual(await page.evaluate(() => globalThis.__turnCueCalls), [], 'the canceled turn never emits sound');
      assert.equal(await page.$('[data-testid="turn-popup"]'), null);
      assert.equal(await page.$('[data-testid="your-turn-banner"]'), null);
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  });

  test('leaving SP_DRAFT cancels a delayed cue even when the round plate is still up', async () => {
    const { page, problems, context } = await open({ phase: 'ROUND_START' });
    try {
      await watchTurnCue(page);
      await page.waitForSelector('[data-testid="round-popup"]', { timeout: 5000 });
      await setPhase(page, 'SP_DRAFT');
      assert.equal((await page.$$('[data-testid="round-popup"]')).length, 1, 'the same round plate stays singular while the cue waits');
      await setPhase(page, 'COMBAT');
      await sleep(2300);
      assert.deepEqual(await page.evaluate(() => globalThis.__turnCueCalls), [], 'leaving the draft cancels the pending sound');
      assert.equal(await page.$('[data-testid="turn-popup"]'), null);
      assert.equal(await page.$('[data-testid="your-turn-banner"]'), null);
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  });
});
