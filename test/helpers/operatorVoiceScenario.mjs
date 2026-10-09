import assert from 'node:assert/strict';

/** Shared browser scenario. Page uses Puppeteer's API; the local runner can adapt an existing browser driver. */
export async function operatorVoiceScenario(page, base, screenshot = null) {
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('sp.name', '语音测试');
    sessionStorage.setItem('sp.entered', '1');
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && !!document.querySelector('.lobby-screen'));
  await page.click('[data-testid="loadout-open"]');
  const row = '.lo-card[data-chess="chess_char_1_01_a"]';
  const control = `${row} select[data-voice-char]`;
  await page.waitForSelector(control);
  const charId = await page.$eval(control, (el) => el.dataset.voiceChar);
  const before = await page.evaluate(async () => (await import('/js/ui/loadoutSync.js')).loadoutStore.get().entries);
  await page.select(control, 'jp');
  assert.equal(await page.$eval(control, (el) => el.value), 'jp');
  assert.equal(await page.evaluate((id) => JSON.parse(localStorage.getItem('sp.pref.settings')).voiceOverrides[id], charId), 'jp');
  assert.deepEqual(await page.evaluate(async () => (await import('/js/ui/loadoutSync.js')).loadoutStore.get().entries), before, 'listening preferences leave gameplay choices alone');
  await page.click(`${row} .lo-card__pick`);
  assert.equal(await page.$eval('.lo-detail select[data-voice-char]', (el) => el.value), 'jp');
  await page.select('.lo-detail select[data-voice-char]', 'cn');
  assert.equal(await page.$eval(control, (el) => el.value), 'cn');
  await page.evaluate(async () => {
    const { updateSettings } = await import('/js/ui/settings.js');
    updateSettings({ voiceLang: 'jp' });
    const { loadoutStore } = await import('/js/ui/loadoutSync.js');
    loadoutStore.set({ sync: 'locked' });
  });
  assert.equal(await page.$eval('.lo-detail select[data-voice-char]', (el) => el.disabled), false, 'listening preferences remain editable when loadout is locked');
  await page.select('.lo-detail select[data-voice-char]', 'jp');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('.lobby-screen'));
  await page.click('[data-testid="loadout-open"]');
  await page.waitForSelector(control);
  assert.equal(await page.$eval(control, (el) => el.value), 'jp', 'preference survives reload');
  await page.click(`${row} .lo-card__pick`);
  await page.click('.lo-dhead__reset');
  assert.equal(await page.$eval(control, (el) => el.value), '');
  assert.equal(await page.evaluate((id) => Object.hasOwn(JSON.parse(localStorage.getItem('sp.pref.settings')).voiceOverrides, id), charId), false);
  await page.select(control, 'cn');
  await page.evaluate(async () => {
    const { loadoutStore } = await import('/js/ui/loadoutSync.js');
    loadoutStore.set({ filters: { ...loadoutStore.get().filters, changedOnly: true } });
  });
  await page.waitForFunction(() => document.querySelectorAll('.lo-card').length === 1);
  assert.equal(await page.$eval('.lo-card', (el) => el.dataset.chess), 'chess_char_1_01_a');
  if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
  await page.click('[data-testid="loadout-reset-all"]');
  await page.waitForSelector('.modal .btn--danger');
  await page.click('.modal .btn--danger');
  await page.waitForFunction(() => document.querySelectorAll('.lo-card').length === 0);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).voiceOverrides), {});
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).voiceLang), 'jp', 'reset keeps global language');
  await page.evaluate(async () => {
    const { loadoutStore, setDiyPicks } = await import('/js/ui/loadoutSync.js');
    setDiyPicks({ chess_char_6_diy1_a: { charId: 'char_003_kalts', skillIndex: 0 } });
    loadoutStore.set({ tab: 'diy' });
  });
  const diy = '.diy select[data-voice-char="char_003_kalts"]';
  await page.waitForSelector(diy);
  await page.select(diy, 'cn');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).voiceOverrides.char_003_kalts), 'cn');
  await page.select(diy, '');
  assert.equal(await page.evaluate(() => Object.hasOwn(JSON.parse(localStorage.getItem('sp.pref.settings')).voiceOverrides, 'char_003_kalts')), false);
  await page.evaluate(async () => {
    const { loadoutStore } = await import('/js/ui/loadoutSync.js');
    loadoutStore.set({ tab: 'loadout', filters: { ...loadoutStore.get().filters, changedOnly: false } });
  });
  await page.setViewport({ width: 844, height: 390 });
  await page.click('.lo-detail-back');
  await page.waitForSelector(control);
  await page.select(control, 'cn');
  await page.click(`${row} .lo-card__pick`);
  assert.equal(await page.$eval('.lo-detail select[data-voice-char]', (el) => el.value), 'cn');
  if (screenshot) await page.screenshot({ path: screenshot.replace('.png', '-phone.png'), fullPage: true });
  await page.setViewport({ width: 390, height: 844 });
  const bounds = await page.$eval('.lo-detail select[data-voice-char]', (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  });
  assert.ok(bounds.left >= 0 && bounds.right <= 390 && bounds.width >= 150, 'portrait phone voice control fits the detail');
  if (screenshot) await page.screenshot({ path: screenshot.replace('.png', '-portrait.png'), fullPage: true });
}
