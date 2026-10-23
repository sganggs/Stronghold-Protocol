import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const chrome = process.env.CHROME_PATH;
const enabled = process.env.SP_SPEED_UI === '1' && chrome && existsSync(chrome);

test('battle speed native HUD: desktop/mobile, proposals, reject/withdraw, observer and Unite coexistence', { skip: !enabled }, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-first-run'] });
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', r => {
      if (r.isNavigationRequest()) void r.respond({ contentType: 'text/html', body: '<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/components.css"><link rel="stylesheet" href="/css/screens/game.css"><div id="root"></div>' });
      else void r.continue();
    });
    await page.goto(`http://127.0.0.1:${srv.port}/speed-test`);
    await page.evaluate(async () => {
      const { html } = await import('/js/ui/components.js');
      const { render } = await import('/vendor/preact.module.js');
      const { TopBar } = await import('/js/ui/hud.js');
      window.speedTest = {
        myId: 'p1', requests: [],
        state: { phaseId: '1.s1', revision: 0, multiplier: 1, available: true, eligible: ['p1', 'p2'], vote: null },
        draw() {
          render(html`<div class="gm"><div class="gm__hud"><${TopBar}
            pub=${{ phase: 'UNITE', round: 1, players: [], battleSpeed: this.state, unite: { fastForward: { phaseId: '1.u', round: 1, status: 'waiting', eligible: ['p1','p2'], votes: [] } } }}
            priv=${{ lp: 100 }} conn=${{ online: true }} hud=${{ killed: 3, total: 28 }} myId=${this.myId}
            onUniteFast=${async () => {}}
            onBattleSpeed=${async msg => {
              this.requests.push(msg);
              if (msg.action === 'propose') this.state.vote = { id: 'v1', target: msg.target, proposer: this.myId, eligible: ['p1','p2'], agreed: [this.myId], deadline: Date.now() + 15000 };
              else this.state.vote = null;
              this.draw();
            }} /></div></div>`, document.getElementById('root'));
        },
      }; window.speedTest.draw();
    });
    mkdirSync('test/e2e/out', { recursive: true });
    for (const [name, width, height] of [['desktop',1920,1080], ['mobile',844,390], ['portrait',390,844]]) {
      await page.setViewport({ width, height }); await page.waitForSelector('.battle-speed button');
      const bounds = await page.$eval('.battle-controls', el => {
        const a = el.getBoundingClientRect(), b = el.querySelector('.battle-speed').getBoundingClientRect(), c = el.querySelector('.unite-fast').getBoundingClientRect();
        return { x:a.x, right:a.right, bottom:a.bottom, speedBottom:b.bottom, uniteTop:c.top, button:el.querySelector('button').getBoundingClientRect().height };
      });
      assert.ok(bounds.x >= 0 && bounds.right <= width && bounds.bottom <= height, JSON.stringify(bounds));
      assert.ok(bounds.speedBottom <= bounds.uniteTop && bounds.button >= 32);
      await page.screenshot({ path: path.resolve(`test/e2e/out/battle-speed-${name}.png`) });
    }
    await page.click('.battle-speed button:nth-of-type(3)');
    await page.waitForFunction(() => window.speedTest.requests.length === 1);
    assert.deepEqual(await page.evaluate(() => window.speedTest.requests[0]), { phaseId:'1.s1', revision:0, action:'propose', target:4 });
    await page.click('.battle-speed button');
    await page.waitForFunction(() => window.speedTest.requests.length === 2);
    assert.equal(await page.evaluate(() => window.speedTest.requests[1].action), 'withdraw');
    await page.evaluate(() => { window.speedTest.myId='observer'; window.speedTest.draw(); });
    await page.waitForFunction(() => document.querySelectorAll('.battle-speed button').length === 0);
    assert.deepEqual(errors, []);
  } finally { if (browser) await browser.close(); await srv.close(); }
});
