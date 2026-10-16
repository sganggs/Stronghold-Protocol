// #676: localized display records must not change deployment legality.
// Real server, mouse drags and language switches. Optional screenshots: SP_E2E_OUT=<dir>.
// SP_E2E=1 CHROME_PATH=... node --test test/ui/high-ground-i18n.e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, hasChrome, startRealServer, aimedDrag, sleep } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const GLADIIA = ['chess_char_4_12_a', 'chess_char_4_12_b'];
const HIGH = [10, 4];
const LANGS = ['en', 'ja', 'ko', 'zh-TW', 'zh'];

async function screenshot(c, name) {
  if (!process.env.SP_E2E_OUT) return;
  mkdirSync(process.env.SP_E2E_OUT, { recursive: true });
  await c.page.screenshot({ path: path.join(process.env.SP_E2E_OUT, name + '.png') });
}

async function language(c, code) {
  await c.click('.gm__gear');
  await c.page.waitForSelector('.modal [data-testid="lang-toggle"]');
  const select = '.modal [data-testid="lang-toggle"] select';
  if (await c.page.$(select)) await c.page.select(select, code);
  else await c.click('.modal [data-testid="lang-toggle"] button[data-lang="' + code + '"]');
  await c.page.waitForFunction((lang) => globalThis.__SP__.data.locale() === lang, {}, code);
  await c.click('.modal__actions .btn--primary');
  await c.page.waitForSelector('.modal', { hidden: true });
}

test('#676: normal and elite Gladiia can deploy on a high tile in every shipped language', {
  skip: !ENABLED && 'set SP_E2E=1 with Chrome and assets',
  timeout: 240000,
}, async () => {
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startRealServer({ fast: { startRound: 2, chess: GLADIIA, stage: 'act2autochess_m01' } });
  const c = new Client(puppeteer, srv.base, 'high-ground-i18n');
  try {
    await c.open('?lang=zh');
    await c.enter('高台测试');
    await c.click('.mode-card', '独立模拟');
    await c.click('.diff-card', '险境');
    await c.click('.create-box button', '开始独立模拟');
    await c.waitFor((s) => !!s.room, 'solo room');
    if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
    await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing');
    await c.click('.brief__foot .btn--primary', '准备就绪');
    await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft');
    await c.click('.dband', null, { nth: 1 });
    await c.click('.draft-detail__btns .btn--primary', '确认选择');
    await c.waitFor((s) => s.phase === 'PREP' && !s.ready, 'prep');
    await c.page.waitForFunction(() => !!globalThis.__SP_VIEW__?.raw?.debug?.tiles, { timeout: 20000 });

    for (const code of LANGS) {
      await language(c, code);
      const display = await c.page.evaluate((id) => {
        const data = globalThis.__SP__.data;
        const rec = data.lookup('chess', id), raw = data.lookupRaw('chess', id);
        return { name: rec.name, translatedTrait: rec.trait.desc !== raw.trait.desc };
      }, GLADIIA[0]);
      assert.equal(display.name === '歌蕾蒂娅', code === 'zh', code + ': the displayed name follows the language');
      assert.equal(display.translatedTrait, code !== 'zh', code + ': trait descriptions remain translated');

      for (const id of GLADIIA) {
        const piece = await c.page.evaluate((id) => globalThis.__SP__.store.get().match.private.hand.find((p) => p?.id === id), id);
        assert.ok(piece, code + ': Gladiia in hand');
        const from = await c.piecePoint(piece.uid);
        const to = await c.tilePoint(...HIGH);
        assert.ok(from && to, 'the hand piece and high tile are visible');
        let lit = [];
        await aimedDrag(c.page, from, to, { before: async () => {
          lit = await c.page.evaluate(() => {
            const tiles = globalThis.__SP_VIEW__.raw.debug.tiles.highlights.get('legal')?.tiles || [];
            return tiles.map((t) => Array.isArray(t) ? t.join(',') : t.row + ',' + t.col);
          });
          if (code === 'en' && id === GLADIIA[0]) await screenshot(c, 'english-drag');
        } });
        await sleep(250);
        const wheel = !!(await c.page.$('.fwheel__dia'));
        if (!wheel) await screenshot(c, code + '-refused');
        assert.ok(lit.includes(HIGH.join(',')), code + ' ' + id + ': the high tile must be highlighted');
        assert.ok(wheel, code + ' ' + id + ': the drop must open the facing wheel');
        await c.swipe('RIGHT');
        await c.page.waitForFunction((uid) => globalThis.__SP__.store.get().match.private.board.some((p) => p.uid === uid), {}, piece.uid);
        const placed = await c.page.evaluate((uid) => globalThis.__SP__.store.get().match.private.board.find((p) => p.uid === uid), piece.uid);
        assert.deepEqual([placed.row, placed.col], HIGH, code + ': server accepted the high tile');
        if (code === 'en' && id === GLADIIA[0] && process.env.SP_E2E_OUT) {
          await sleep(1000); // the piece's movement and deployment fade finish before the evidence screenshot
          await screenshot(c, 'english-deployed');
        }

        const point = await c.piecePoint(piece.uid);
        await c.page.mouse.click(point.x, point.y);
        await c.click('.uframe__btn--retreat');
        await c.page.waitForFunction((uid) => globalThis.__SP__.store.get().match.private.hand.some((p) => p?.uid === uid), {}, piece.uid);
      }
    }
    assert.deepEqual(c.problems.filter((p) => p.startsWith('pageerror:')), []);
  } finally {
    await c.close();
    await srv.stop();
  }
});
