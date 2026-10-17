// The existing stronghold.loadout export carries every operator's potential/cultivation, including DIY-only ones.
// Real server + headless Chrome, normal UI input only; no storage/store/network mutation. No art is required.
// SP_E2E=1 node --test test/ui/loadout-ops-export.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, hasChrome, startRealServer } from '../e2e/client.mjs';

const KALTS = 'char_003_kalts';
const INSIDE = 'chess_char_1_01_a';
const SLOT = 'chess_char_6_diy1_a';
const slot = `.diy-slot[data-slot="${SLOT}"]`;
const picker = '[data-testid="diy-picker"]';
const io = '[data-testid="loadout-io-text"]';

describe('loadout export includes DIY-only cultivation (real server, headless Chrome)', {
  skip: !(process.env.SP_E2E === '1' && hasChrome()) && 'set SP_E2E=1 (and have Chrome)',
}, () => {
  let srv, P;
  before(async () => { srv = await startRealServer(); P = (await import('puppeteer-core')).default; });
  after(async () => { await srv?.stop(); });

  async function open(label) {
    const c = new Client(P, srv.base, label, { prefix: 'loadout-ops-export', w: 1280, h: 800 });
    try {
      await c.open();
      await c.enter('调配回归');
      await c.click('.lobby-screen [data-testid="loadout-open"]');
      await c.page.waitForSelector('.lo-card');
      return c;
    } catch (e) { await c.close(); throw e; }
  }
  const tab = (c, name) => c.click(`.lo-tab[data-tab="${name}"]`);
  const disabled = (c, id) => c.page.$eval(`[data-testid="${id}"]`, e => e.disabled);
  const saved = (c) => c.page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('sp.pref.loadout') || '{}');
    return { entries: p.entries || {}, ops: p.ops || {} };
  });
  async function chooseKalts(c) {
    await tab(c, 'diy');
    await c.click(`${slot} :is(.diy-slot__fill, [data-testid="diy-change"])`);
    await c.page.waitForSelector(picker);
    await c.click(`${picker} .lo-search input`);
    await c.page.keyboard.type('凯尔希');
    await c.click(`${picker} .diy-opt[data-char="${KALTS}"] .diy-opt__pick`);
    await c.click('[data-testid="diy-confirm"]');
    await c.page.waitForSelector(picker, { hidden: true });
  }
  async function setKalts(c, patch) {
    await tab(c, 'diy');
    for (const [key, value] of Object.entries(patch)) await c.page.select(`${slot} select[data-cult="${key}"]`, String(value));
  }
  async function changeNormal(c) {
    await tab(c, 'loadout');
    await c.click(`.lo-card[data-chess="${INSIDE}"] .lo-q--skill[data-skill="0"]`);
    await c.page.select(`.lo-card[data-chess="${INSIDE}"] select[data-cult="potential"]`, '2');
  }
  async function exportText(c, id = 'loadout-export') {
    assert.equal(await disabled(c, id), false, `${id} must allow the saved settings to be exported`);
    await c.click(`[data-testid="${id}"]`);
    await c.page.waitForSelector(io);
    const text = await c.page.$eval(io, e => e.value);
    await c.page.keyboard.press('Escape');
    await c.page.waitForSelector(io, { hidden: true });
    return text;
  }
  async function importText(c, text, id = 'loadout-import') {
    await c.click(`[data-testid="${id}"]`);
    await c.page.waitForSelector(io);
    await c.click(io);
    await c.page.keyboard.type(text);
    await c.click('[data-testid="loadout-io-apply"]');
    await c.page.waitForSelector(io, { hidden: true });
  }

  for (const [name, normal, patch] of [
    ['DIY potential only', false, { potential: 1 }],
    ['DIY cultivation only', false, { cultivate: 0 }],
    ['DIY potential and cultivation', false, { potential: 1, cultivate: 0 }],
    ['normal only', true, null],
    ['normal and DIY', true, { potential: 1, cultivate: 0 }],
  ]) {
    test(`${name}: export then import in a fresh browser preserves entries and ops`, { timeout: 90000 }, async () => {
      let c, target, diyText;
      try {
        c = await open(name);
        if (patch) {
          await chooseKalts(c);
          await setKalts(c, patch);
          await c.shot(`${name.replaceAll(' ', '-')}-settings`);
          diyText = await exportText(c, 'diy-export');
          const diy = JSON.parse(diyText);
          assert.equal(diy.kind, 'stronghold.diy');
          assert.equal('ops' in diy, false, 'the DIY roster format stays unchanged');
          assert.equal(diy.picks[SLOT].charId, KALTS);
        }
        if (normal) await changeNormal(c);
        await tab(c, 'loadout');
        const expected = await saved(c);
        if (patch) assert.deepEqual(expected.ops[KALTS], patch);
        if (!normal) {
          assert.deepEqual(expected.entries, {});
          assert.match(await c.page.$eval('.lo-top__right', e => e.textContent), /已调整\s*0/);
          assert.equal(await c.page.$eval('.lo-top__right button:last-child', e => e.disabled), true,
            'normal reset still covers only its roster');
        }
        console.log(JSON.stringify({ scenario: name, saved: expected, exportDisabled: await disabled(c, 'loadout-export') }));
        await c.shot(`${name.replaceAll(' ', '-')}-before-export`);
        const text = await exportText(c);
        const payload = JSON.parse(text);
        assert.equal(payload.kind, 'stronghold.loadout');
        assert.equal(payload.v, 1);
        assert.equal(payload.count, normal ? 1 : 0, 'count retains its existing entry semantics');
        assert.deepEqual({ entries: payload.entries, ops: payload.ops }, expected);
        await c.shot(`${name.replaceAll(' ', '-')}-exported`);
        target = await open(`${name} import`);
        if (diyText) {
          await tab(target, 'diy');
          await importText(target, diyText, 'diy-import');
          await tab(target, 'loadout');
        }
        await importText(target, text);
        assert.deepEqual(await saved(target), expected, 'a fresh browser keeps the complete exported loadout');
        await target.page.reload({ waitUntil: 'domcontentloaded' });
        await target.page.waitForSelector('.lobby-screen');
        assert.deepEqual(await saved(target), expected, 'the imported loadout persists across reload');
        if (patch) {
          assert.deepEqual(await target.page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.diy')).picks), JSON.parse(diyText).picks);
          await target.click('.lobby-screen [data-testid="loadout-open"]');
          await tab(target, 'diy');
          await target.page.waitForSelector(`${slot} select[data-cult]`);
          assert.deepEqual(await target.page.$$eval(`${slot} select[data-cult]`, els => Object.fromEntries(els.map(e => [e.dataset.cult, Number(e.value)]))),
            { potential: patch.potential ?? 6, cultivate: patch.cultivate ?? 3 }, 'the restored pick displays its restored settings');
          await target.shot(`${name.replaceAll(' ', '-')}-imported`);
        }
        assert.deepEqual([...c.problems, ...target.problems].filter(p => p.startsWith('pageerror:')), []);
        console.log(JSON.stringify({ scenario: name, payload, imported: await saved(target), resourceProblems: c.problems.length + target.problems.length }));
      } finally { await target?.close(); await c?.close(); }
    });
  }

  test('defaults, clearing a pick and normal reset preserve the existing scopes', { timeout: 90000 }, async () => {
    let c;
    try {
      c = await open('reset');
      assert.equal(await disabled(c, 'loadout-export'), true);
      await chooseKalts(c);
      await tab(c, 'loadout');
      assert.equal(await disabled(c, 'loadout-export'), true, 'a roster choice alone is not loadout settings');
      await setKalts(c, { potential: 1, cultivate: 0 });
      await changeNormal(c);
      await c.click('.lo-top__right button', '全部恢复默认');
      await c.click('.modal button', '恢复默认');
      await c.page.waitForSelector('.modal', { hidden: true });
      assert.deepEqual(await saved(c), { entries: {}, ops: { [KALTS]: { potential: 1, cultivate: 0 } } });
      assert.equal(await disabled(c, 'loadout-export'), false, 'normal reset retains exportable DIY settings');
      await tab(c, 'diy');
      await c.click(`${slot} [data-testid="diy-clear"]`);
      await tab(c, 'loadout');
      assert.equal(await disabled(c, 'loadout-export'), false, 'clearing a pick retains its per-operator settings');
      await chooseKalts(c);
      await setKalts(c, { potential: 6, cultivate: 3 });
      await tab(c, 'loadout');
      assert.deepEqual(await saved(c), { entries: {}, ops: {} });
      assert.equal(await disabled(c, 'loadout-export'), true, 'back to defaults: nothing to export');
      assert.deepEqual(c.problems.filter(p => p.startsWith('pageerror:')), []);
    } finally { await c?.close(); }
  });
});
