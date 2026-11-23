// Real SettingsModal controls with a generated local theme. SP_E2E=1; SETTINGS_BROWSER=firefox uses Firefox BiDi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seedReleaseRead } from '../helpers/releaseNotes.js';
import { zipStored } from '../../tools/theme-template.mjs';

const firefox = process.env.SETTINGS_BROWSER === 'firefox';
const binary = firefox ? process.env.FIREFOX_PATH || '/run/current-system/sw/bin/firefox'
  : process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.SP_E2E === '1' && existsSync(binary);
const out = process.env.SETTINGS_SHOTS || path.join(tmpdir(), 'sp-settings-search-shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('settings categories/search: controls, localization, imports, keyboard ownership and responsive layout', {skip:!enabled, timeout:180000}, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({host:'127.0.0.1',port:0,quiet:true,workers:0,roomWorkers:0,matchWorkers:0,assetIndex:false});
  const dir = mkdtempSync(path.join(tmpdir(), 'sp-settings-search-'));
  let browser, page;
  const errors = [], failed = [], checks = [];
  mkdirSync(out, {recursive:true});
  try {
    browser = await puppeteer.launch(firefox ? {browser:'firefox',executablePath:binary,headless:true,
      extraPrefsFirefox:{'dom.ipc.processCount':2,'dom.ipc.processPrelaunch.enabled':false,'fission.autostart':false}}
      : {executablePath:binary,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--force-device-scale-factor=1']});
    page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
    page.on('response', r => { if(r.status()>=400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    await seedReleaseRead(page);
    await page.setRequestInterception(true);
    page.on('request', r => { if(new URL(r.url()).hostname==='fonts.googleapis.com') void r.respond({status:200,contentType:'text/css',body:''}); else void r.continue(); });
    await page.setViewport({width:1440,height:900});
    await page.goto(srv.url+'/',{waitUntil:'networkidle0',timeout:60000});
    await page.waitForSelector('.title-settings');
    await page.click('.title-settings');
    await page.waitForSelector('.settings-nav');
    await page.waitForFunction(()=>!document.querySelector('.settings-modal')?.getAnimations().some(a=>a.playState==='running'));
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>document.querySelector('[data-setting-id="language"]')?.textContent.trim());
    await sleep(300);
    const shot = async name => { await page.screenshot({path:path.join(out,`${name}.png`)}); };
    const search = async query => {
      await page.click('[data-testid="settings-search"]');
      // select the old query through the DOM: Ctrl+A only selects all on Windows / Linux (on macOS it moves the caret to
      // the line start, so the new query was typed in front of the old one)
      await page.$eval('[data-testid="settings-search"]', (el) => el.select());
      await page.keyboard.press('Backspace');
      if(query) await page.type('[data-testid="settings-search"]',query);
      await sleep(100);
    };
    const ids = () => page.$$eval('.settings-entry', es=>es.filter(e=>e.getClientRects().length>0).map(e=>e.dataset.settingId));
    const category = async id => { await page.click(`[data-settings-tab="${id}"]`); await sleep(60); };
    const boxHeight = await page.$eval('.settings-modal',e=>e.getBoundingClientRect().height);
    assert.equal(await page.$$eval('.settings-nav [role="tab"]',es=>es.length),6);
    const fitAligned = await page.$$eval('.set-fit__row', rows => rows.every(row => {
      const centers = [...row.children].map(el => { const r=el.getBoundingClientRect(); return (r.top+r.bottom)/2; });
      return Math.max(...centers)-Math.min(...centers)<2;
    }));
    assert.ok(fitAligned,'screen-fit label, steps, range and value share one row');
    const labelStyles = () => page.$$eval('.settings-content .set-row__label', labels => labels
      .filter(e => e.getClientRects().length).map(e => ({ text:e.textContent, weight:getComputedStyle(e).fontWeight, size:getComputedStyle(e).fontSize })));
    const ordinaryLabel = (await labelStyles())[0];
    assert.equal(ordinaryLabel.weight,'400');
    assert.equal(await page.$('.settings-content [class*="sw-sec__"]'),null,'settings use ordinary labels rather than result-screen decorations');
    await shot('categories-desktop');
    for (const id of ['audio','battle','controls','appearance','resources']) {
      await category(id);
      assert.equal(await page.$eval('.settings-modal',e=>e.getBoundingClientRect().height),boxHeight);
      assert.ok(await page.$eval('.settings-content',e=>e.scrollWidth-e.clientWidth<=1),`category ${id} fits horizontally`);
      for (const label of await labelStyles()) {
        assert.equal(label.weight,ordinaryLabel.weight,`consistent label weight: ${label.text}`);
        assert.equal(label.size,ordinaryLabel.size,`consistent label size: ${label.text}`);
      }
      await shot(`category-${id}`);
    }
    assert.equal(await page.$$eval('.set-key[data-action="retreat"]',es=>es.length),1,'results reuse one control instance');
    await category('audio');
    await search('DPS');
    assert.deepEqual(await ids(),['combatMetrics'],'a description in another category can be found');
    await shot('search-description');
    const toggle = '[data-setting-id="combatMetrics"] [role="switch"]';
    const before = await page.$eval(toggle,e=>e.getAttribute('aria-checked'));
    await page.click(toggle);
    assert.notEqual(await page.$eval(toggle,e=>e.getAttribute('aria-checked')),before);
    await page.click('[data-testid="settings-search"]'); await page.keyboard.press('Escape');
    assert.equal(await page.$eval('[data-settings-tab="audio"]',e=>e.getAttribute('aria-selected')),'true');
    assert.ok(await page.$('.settings-modal'),'Escape clears a focused search before closing');
    assert.equal(await page.$eval('.settings-modal',e=>e.getBoundingClientRect().height),boxHeight);
    checks.push('cross-category search/control/clear');

    await search(' ＢＧＭ '); assert.deepEqual(await ids(),['bgm']);
    await search('.*'); assert.deepEqual(await ids(),[]);
    await shot('search-empty');
    await page.keyboard.press('Escape');
    await category('controls');
    await page.click('[data-action="retreat"]');
    await page.waitForSelector('.set-key.is-waiting');
    await page.keyboard.press('Escape');
    assert.ok(await page.$('.settings-modal')); assert.equal(await page.$('.set-key.is-waiting'),null);
    await page.click('[data-action="retreat"]');
    await page.evaluate(()=>document.querySelector('[data-settings-tab="audio"]').click());
    await sleep(100);
    assert.equal(await page.$('.set-key.is-waiting'),null,'hidden shortcut capture is cancelled');
    await search('静音'); assert.deepEqual(await ids(),['muted']);
    await page.keyboard.press('Escape');
    await page.focus('[data-settings-tab="audio"]');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.$eval('[data-settings-tab="battle"]',e=>e.getAttribute('aria-selected')),'true');
    await page.keyboard.press('End');
    assert.equal(await page.$eval('[data-settings-tab="resources"]',e=>e.getAttribute('aria-selected')),'true');
    checks.push('keyboard tabs and shortcut capture');

    await page.click('[data-testid="diag-copy"]');
    await sleep(150);
    const note = await page.$eval('.set-diag .set-keys__note',e=>e.textContent);
    await page.evaluate(()=>{globalThis.__settingsDiag=document.querySelector('.set-diag');});
    await category('appearance'); await category('resources');
    assert.equal(await page.$eval('.set-diag .set-keys__note',e=>e.textContent),note);
    assert.ok(await page.evaluate(()=>globalThis.__settingsDiag===document.querySelector('.set-diag')));
    checks.push('diagnostic state retained');

    const zip = path.join(dir,'settings-search-test.zip');
    writeFileSync(zip,zipStored([{name:'theme.json',data:Buffer.from(JSON.stringify({spTheme:1,id:'settings-search-test',name:'Needle Theme',author:'test',version:'1',colors:{skinLightColor:'#123456'}}))}]));
    await category('appearance');
    await page.evaluate(()=>{
      const original=File.prototype.arrayBuffer;
      const gate=new Promise(resolve=>{globalThis.__releaseSettingsTheme=resolve;});
      File.prototype.arrayBuffer=async function(){if(this.name==='settings-search-test.zip') await gate;return original.call(this);};
    });
    await (await page.$('[data-testid="theme-import-zip"]')).uploadFile(zip);
    await sleep(60);
    await category('interface');
    await search('Needle Theme'); assert.deepEqual(await ids(),[]);
    await page.evaluate(()=>globalThis.__releaseSettingsTheme());
    await page.waitForFunction(()=>document.querySelector('[data-theme-id="settings-search-test"]'));
    await page.waitForFunction(()=>!document.querySelector('[data-setting-id="theme"]')?.hidden);
    assert.deepEqual(await ids(),['theme']);
    await page.click('[data-testid="settings-search"]'); await page.keyboard.press('Escape');
    await category('appearance');
    await page.waitForSelector('[data-testid="theme-report"]');
    assert.match(await page.$eval('[data-testid="theme-report"]',e=>e.textContent),/导入完成/);
    checks.push('in-flight theme import retained and searchable');

    await category('interface');
    await page.evaluate(async()=>{await (await import('/js/ui/lang.js')).switchLang('en');});
    await search('Damage Numbers');
    assert.deepEqual(await ids(),['damageNumbers','officialDamageNumbers']);
    await shot('search-english');
    await search('BGM'); assert.deepEqual(await ids(),['bgm']);
    await page.keyboard.press('Escape');
    checks.push('localized live index');
    for (const [w,h] of [[1280,720],[960,540],[844,390],[390,844]]) {
      await page.setViewport({width:w,height:h});
      await category('interface');
      await page.evaluate(async()=>{(await import('/js/ui/settings.js')).updateSettings({textSize:'xl'});});
      await sleep(100);
      const geometry=await page.evaluate(()=>{
        const box=document.querySelector('.settings-modal'),r=box.getBoundingClientRect();
        const layout=document.querySelector('.settings-layout'),c=document.querySelector('.settings-content');
        return {r:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},vw:innerWidth,vh:innerHeight,
          boxOverflow:box.scrollWidth-box.clientWidth,layoutOverflow:layout.scrollWidth-layout.clientWidth,contentOverflow:c.scrollWidth-c.clientWidth};
      });
      assert.ok(geometry.r.left>=0&&geometry.r.right<=w+1&&geometry.r.top>=0&&geometry.r.bottom<=h+1,JSON.stringify(geometry));
      assert.ok(geometry.boxOverflow<=1&&geometry.layoutOverflow<=1&&geometry.contentOverflow<=1,JSON.stringify(geometry));
      await shot(`large-text-${w}x${h}`);
      if(w===844) for(const id of ['audio','controls']) {
        await category(id);
        if(id==='audio') assert.ok(await page.$$eval('.set-voice .set-seg button', buttons=>buttons.every(button=>{
          const range=document.createRange();range.selectNodeContents(button);
          const text=range.getBoundingClientRect(),box=button.getBoundingClientRect();
          return range.getClientRects().length===1 && text.left>=box.left-1 && text.right<=box.right+1;
        })),'voice-language names stay on one line');
        await shot(`short-${id}`);
      }
    }
    checks.push('four sizes with extra-large English text');
    await page.evaluate(async()=>{(await import('/js/ui/settings.js')).updateSettings({textSize:'sm'});});
    await page.click('[data-testid="settings-search"]'); await page.keyboard.press('Escape');
    await page.waitForSelector('.settings-modal',{hidden:true});
    await page.click('.title-settings');
    assert.equal(await page.$eval('[data-testid="settings-search"]',e=>e.value),'');
    assert.equal(await page.$eval('[data-settings-tab="interface"]',e=>e.getAttribute('aria-selected')),'true');
    await page.reload({waitUntil:'networkidle0'});
    assert.equal(await page.evaluate(async()=>(await import('/js/ui/settings.js')).settingsStore.get().combatMetrics),before!=='true');
    checks.push('reopen reset and preference persistence');
    assert.deepEqual(errors,[]);
    assert.deepEqual(failed,[]);
  } finally {
    writeFileSync(path.join(out,'receipt.json'),JSON.stringify({browser:firefox?'firefox':'chrome',checks,errors,failed},null,2));
    await page?.screenshot({path:path.join(out,'final.png')}).catch(()=>{});
    await browser?.close(); await srv.close(); rmSync(dir,{recursive:true,force:true});
  }
});
