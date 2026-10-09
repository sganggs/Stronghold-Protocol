// Opt-in browser regression: SP_E2E=1 and CHROME_PATH, like loadout.e2e.test.js.
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { operatorVoiceScenario } from '../helpers/operatorVoiceScenario.mjs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('per-operator voices: row/detail, persistence, match lock, changed filter and reset', {
  skip: process.env.SP_E2E !== '1' || !existsSync(CHROME),
}, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await operatorVoiceScenario(page, `http://127.0.0.1:${srv.port}/`);
    if (problems.length) throw new Error(problems.join('\n'));
  } finally { await browser?.close(); await srv.close(); }
});
