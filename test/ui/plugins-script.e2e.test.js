// SP_E2E=1 node --test test/ui/plugins-script.e2e.test.js (run this file alone).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client,hasChrome,sleep} from '../e2e/client.mjs';
import {scriptFixture} from '../helpers/scriptFixtures.js';
import {startServer} from '../../server/index.js';
const enabled=process.env.SP_E2E==='1' && hasChrome();
test('two pages consent separately, refusal gates start, accepted script battles verify', {skip:!enabled,timeout:300000},async t=>{
 const f=scriptFixture(t);f.put('training',`export default sp => sp.content.register({install(b){b.on('battleStart',()=>{for(const u of b.allyUnits)b.addBuff(u,{key:'training',mods:{atkFlat:2}});});}});`);
 f.put('page-code','export default () => {};',{class:'trusted',permissions:['trusted.page'],entry:{client:'page.js'}},{'page.js':'globalThis.__TRUSTED_PAGE_LOADED__ = true;'});
 const previous=process.env.SP_PLUGIN_SCRIPTS;process.env.SP_PLUGIN_SCRIPTS='trusted';
 let srv;
 try {srv=await startServer({port:0,host:'127.0.0.1',quiet:true,pluginsDir:f.pluginsDir,assetIndex:false,matchHost:{matchOptions:{verify:'all',timerScale:0.1,combatSpeed:16,botRehearsal:0}}});}
 finally {if(previous===undefined)delete process.env.SP_PLUGIN_SCRIPTS;else process.env.SP_PLUGIN_SCRIPTS=previous;}
 t.after(()=>srv.close());
 const policy=(await fetch(srv.url)).headers.get('content-security-policy');
 assert.match(policy,/connect-src 'self';/);assert.ok(!/script-src[^;]*(?:data:|blob:|unsafe-eval)/.test(policy));
 const P=(await import('puppeteer-core')).default;
 const host=new Client(P,srv.url,'host',{prefix:'plugins-script',w:1600,h:900}), guest=new Client(P,srv.url,'guest',{prefix:'plugins-script',w:1600,h:900});
 t.after(async()=>{await host.close();await guest.close();});
 await host.open();await host.enter('凯尔希');const {code}=await host.createCoop();
 await guest.open();await guest.enter('阿米娅');await guest.click('.mode-card','同盟模拟');await guest.click('.join-row input');await guest.page.keyboard.type(code);await guest.click('.join-row button','加入同盟');await guest.page.waitForSelector('.room-screen');
 await host.page.evaluate(()=>globalThis.__SP__.net.request('room.setPlugins',{plugins:[{id:'training'},{id:'page-code'}]}));
 for(const c of [host,guest]){await c.page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.textContent.includes('它可以完全控制你的游戏页面'));assert.match(await c.page.$eval('[role="dialog"]',e=>e.textContent),/training/);}
 await guest.click('.modal__actions button','拒绝');
 await Promise.all([host.page.waitForNavigation({waitUntil:'domcontentloaded'}),host.click('.modal__actions button','同意运行')]);
 await host.page.waitForFunction(()=>globalThis.__TRUSTED_PAGE_LOADED__===true && globalThis.__SP__?.store?.get().room);
 const refusal=await host.page.evaluate(async()=>{try{await globalThis.__SP__.net.request('room.start');return null;}catch(e){return e.code;}});assert.equal(refusal,'PLUGIN_CONSENT');
 await guest.click('.trusted-banner button');
 await Promise.all([guest.page.waitForNavigation({waitUntil:'domcontentloaded'}),guest.click('.modal__actions button','同意运行')]);
 for(const c of [host,guest])await c.page.waitForFunction(()=>globalThis.__TRUSTED_PAGE_LOADED__===true);
 for(const c of [host,guest])await c.page.waitForFunction(()=>globalThis.__SP__?.store?.get()?.room?.seats.filter(s=>s&&!s.isBot).every(s=>s.content==='ready'));
 await guest.click('.room-bar__right button','准备就绪');await host.click('.room-bar__right button','开始模拟');
 await host.waitFor(s=>s.phase==='COMBAT','battle',120000);
 const match=srv.lobby.getRoom(code).match;let accepted=false,last;
 for(const begin=Date.now();Date.now()-begin<90000;){last=await match.diag();if(last.verifyStats?.verified>0 || last.fields?.some(f=>f.done&&f.resultSource==='client')){accepted=true;break;}await sleep(100);}
 assert.ok(accepted,JSON.stringify(last));assert.equal(last.verifyStats.rejected,0);
 for(const c of [host,guest])assert.ok(await c.page.$('[data-testid="trusted-banner"]'));
});
