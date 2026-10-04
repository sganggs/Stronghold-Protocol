// RENDER_E2E=1 node --test test/render/battle-sandbox.browser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { getData } from '../../server/data.js';
const chrome = process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const skip = process.env.RENDER_E2E !== '1' || !existsSync(chrome) ? 'set RENDER_E2E=1 with Chrome and downloaded models' : false;

test('general battle page: selectors, real automatic combat, flight, loadouts, validation, context and deterministic restart', { skip, timeout: 120000 }, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true, args: ['--no-first-run', '--no-sandbox', `--explicitly-allowed-ports=${srv.port}`] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/ember-test.html`);
    await page.waitForFunction(() => window.__battleTest?.ready || window.__battleTest?.error);
    assert.equal(await page.evaluate(() => window.__battleTest.error), null);
    const state = () => page.evaluate(() => {
      const d = window.__battleTest, s = d.scene, b = s?.battle;
      if (!s) return { error: document.querySelector('#error').textContent };
      return { t: b.time, hp: s.enemy.hp, allyHp: s.operator.hp, blocked: !!s.enemy.blockedBy, motion: s.enemy.motion,
        attacks: s.operator.stats.attacks, sp: s.operator.skill.sp, paused: d.paused, kind: b.kind, errors: b.errorCount,
        skill: s.operator.def.skill?.index, module: s.operator.def.loadout.moduleId,
        form: s.enemy.form ?? null, viewForm: d.view.debug.views.get(s.enemy.id)?.form ?? null,
        viewHp: d.view.debug.views.get(s.enemy.id)?.hp,
        pool: b.sharedBoss?.hp ?? null, count: b.aliveEnemies().length, log: document.querySelector('#log').textContent };
    });
    const configure = async (values) => {
      await page.evaluate((config) => {
        for (const [id, value] of Object.entries(config)) {
          const input = document.getElementById(id);
          if (input.type === 'checkbox') input.checked = value; else input.value = String(value);
        }
        window.__battleTest.restart();
      }, values);
      assert.equal(await page.$eval('#error', (e) => e.textContent), '');
    };
    const advance = (n) => page.evaluate((s) => window.__battleTest.advance(s), n);
    const model = () => page.waitForFunction(() => {
      const d = window.__battleTest;
      return d.view.debug.views.get(d.scene?.enemy.id)?.spineReady && d.view.debug.views.get(d.scene?.operator.id)?.spineReady;
    });
    const initial = await state(); assert.equal(initial.error, undefined, initial.error); assert.equal(initial.t, 0); assert.ok(initial.paused);
    await model();
    await page.type('#operator-search', '角峰');
    assert.ok(await page.$eval('#operator', (s) => [...s.options].every((o) => o.text.includes('角峰'))));
    await page.$eval('#operator-search', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
    await page.type('#enemy-search', 'duskls');
    assert.ok(await page.$eval('#enemy', (s) => s.options.length === 2));
    await page.$eval('#enemy-search', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
    await advance(9);
    const fighting = await state(); assert.ok(fighting.blocked && fighting.hp < initial.hp && fighting.allyHp < initial.allyHp && fighting.attacks > 0);
    await page.click('#restart'); await advance(9);
    assert.deepEqual(await state(), fighting);
    await page.click('#restart'); await page.click('#pause');
    await page.waitForFunction(() => window.__battleTest.scene.battle.time >= .2);
    await page.click('#pause');
    const stopped = (await state()).t;
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));
    assert.equal((await state()).t, stopped);
    await page.select('#operator', 'chess_char_1_01_a');
    await configure({ row: 10, col: 4, 'enemy-auto': false }); await model(); await advance(12);
    assert.ok((await state()).attacks > 0);
    assert.equal(await page.evaluate(() => window.__battleTest.scene.operator.ground), false);
    const fly = Object.values(getData().enemies).find((e) => e.isFlyEnemy && e.rank === 'NORMAL' && !e.tokenOnly);
    await page.select('#enemy', fly.key); await configure({ row: 10, col: 4 }); await model(); await advance(12);
    assert.equal((await state()).motion, 'FLY'); assert.ok((await state()).attacks > 0 && !(await state()).blocked);
    await page.select('#operator', 'chess_char_1_02_a');
    await page.$eval('#row', (e) => { e.value = '10'; e.dispatchEvent(new Event('change')); });
    await page.$eval('#col', (e) => { e.value = '4'; e.dispatchEvent(new Event('change')); });
    assert.ok((await state()).error.includes('地面/高台')); assert.ok(await page.$eval('#step', (e) => e.disabled));
    await page.select('#enemy', 'enemy_1288_duskls');
    await configure({ 'ally-auto': false, 'enemy-auto': false });
    await model(); await page.click('#knockout');
    assert.equal((await state()).form, 'husk'); assert.equal((await state()).viewForm, 'husk');
    await page.evaluate(() => {
      const d = window.__battleTest, v = d.view.debug.views.get(d.scene.enemy.id);
      v.actor.update(12);
    });
    assert.equal((await state()).viewForm, 'husk', 'animation time cannot revive a paused simulator');
    assert.equal(await page.evaluate(() => {
      const d = window.__battleTest;
      return d.view.debug.views.get(d.scene.enemy.id).actor.endClip;
    }), null, 'the simulator owns phase timers in the paused sandbox');
    // Two operations at the SAME paused timestamp must update both model metadata and displayed HP.
    await page.click('#hit'); assert.equal((await state()).hp, 5, 'the real rebirth invulnerability blocks test attacks');
    await advance(1);
    await page.click('#hit'); assert.equal((await state()).hp, 4); assert.equal((await state()).viewHp, 4);
    await page.click('#hit'); assert.equal((await state()).hp, 3); assert.equal((await state()).viewHp, 3);
    assert.ok((await state()).log.includes('测试操作'));
    await page.click('#rebuild-view'); await model(); assert.equal((await state()).viewForm, 'husk');
    await page.select('#enemy', 'enemy_1521_dslily'); await model();
    assert.equal((await state()).kind, 'boss'); assert.ok((await state()).pool > 0);
    assert.ok(await page.$eval('#context', (e) => e.textContent.includes('trap_039_dstnta')));
    await page.click('#template-route');
    await page.$eval('#checkpoints', (e) => { e.value = 'invalid checkpoint'; e.dispatchEvent(new Event('change')); });
    assert.match(await page.$eval('#error', (e) => e.textContent), /途经点格式错误/);
    await page.click('#template-route');
    assert.equal(await page.$eval('#error', (e) => e.textContent), '', 'disabled custom route fields cannot invalidate a template route');
    assert.equal(await page.$eval('#checkpoints', (e) => e.disabled), true);
    assert.equal((await state()).kind, 'boss');
    await page.select('#enemy', 'enemy_9018_actrpa'); await model();
    assert.equal((await state()).kind, 'hidden'); assert.equal((await state()).count, 4);
    const pool = (await state()).pool;
    await configure({ 'damage-type': 'true', damage: 1000 }); await page.click('#damage-apply');
    assert.ok((await state()).pool < pool);
    await page.select('#enemy', 'enemy_9033_acdeer');
    await configure({ 'ally-auto': false, 'enemy-auto': false });
    await advance(3);
    assert.equal(await page.evaluate(() => window.__battleTest.scene.enemy.stats.attacks), 0);
    await page.click('#enemy-auto'); await advance(1);
    const deerAttacks = await page.evaluate(() => window.__battleTest.scene.enemy.stats.attacks);
    assert.ok(deerAttacks > 0);
    await page.click('#enemy-auto');
    await page.evaluate(() => {
      const s = window.__battleTest.scene;
      s.battle.loseHp(s.enemy, s.enemy.hp * .6);
    });
    await advance(1);
    assert.equal(await page.evaluate(() => window.__battleTest.scene.enemy.stats.attacks), deerAttacks);
    assert.ok(await page.evaluate(() => window.__battleTest.scene.enemy.findBuff('boss:madness')));
    await page.select('#enemy', 'enemy_9021_acduml_2');
    await configure({ 'ally-auto': false, 'enemy-auto': false });
    await advance(85);
    assert.ok(await page.evaluate(() => {
      const b = window.__battleTest.scene.battle;
      const leaders = b.enemies.filter((e) => ['enemy_9021_acduml_2', 'enemy_9022_acdumm'].includes(e.defId));
      return leaders.length === 2 && leaders.every((e) => e.stats.attacks === 0)
        && b.enemies.some((e) => e.defId === 'enemy_9023_acdums')
        && leaders.some((e) => e.mem.ab.list.some((a) => a.casts > 0));
    }), 'pipe/string ordinary attacks stop while their summons and skills continue');
    await page.click('#enemy-auto'); await advance(45);
    assert.ok(await page.evaluate(() => window.__battleTest.scene.enemy.stats.attacks > 0));
    await page.click('#enemy-auto');
    await page.select('#enemy', 'enemy_9016_acstmr'); assert.ok((await state()).error.includes('绑定真实攻击目标'));
    await page.select('#enemy', 'enemy_1158_divman');
    assert.equal(await page.$eval('#stage', (e) => e.value), 'act2autochess_m04');
    await advance(1);
    assert.ok(await page.evaluate(() => window.__battleTest.scene.enemy.s.flags.stealth));
    await page.select('#enemy', 'enemy_1288_duskls');
    await page.select('#stage', 'act2autochess_m02');
    const op = Object.values(getData().chess).find((c) => c.isGolden && c.skills?.length > 1 && c.modules?.length);
    await page.select('#operator', op.chessId);
    await page.select('#skill', String(op.skills.find((s) => !s.isDefault).index));
    await page.select('#module', op.modules[0].uniEquipId);
    assert.equal((await state()).module, op.modules[0].uniEquipId);
    assert.equal((await state()).skill, op.skills.find((s) => !s.isDefault).index);
    await model();
    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      for (let i = 0; i < 30; i++) await new Promise(requestAnimationFrame);
    });
    mkdirSync('test/e2e/out', { recursive: true });
    await page.screenshot({ path: 'test/e2e/out/battle-sandbox.png' });
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(async () => { for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame); });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile layout has no horizontal overflow');
    await page.screenshot({ path: 'test/e2e/out/battle-sandbox-mobile.png' });
    assert.deepEqual(errors, []); assert.equal((await state()).errors, 0);
  } finally { await browser?.close(); await srv.close(); }
});
