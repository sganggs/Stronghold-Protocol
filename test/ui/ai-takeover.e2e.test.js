import { seedReleaseRead } from '../helpers/releaseNotes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const chrome=process.env.CHROME_PATH;
test('a spectator requests an AI in the browser, receives majority approval and reloads into the inherited seat', {skip:process.env.SP_E2E!=='1'||!chrome||!existsSync(chrome),timeout:120000},async()=>{
  const {startServer}=await import('../../server/index.js'),{TestClient}=await import('../helpers/wsClient.js'),puppeteer=(await import('puppeteer-core')).default;
  const srv=await startServer({port:0,host:'127.0.0.1',quiet:true,botRehearsal:0}),clients=[],browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--no-proxy-server',`--explicitly-allowed-ports=${srv.port}`]});
  try{
    const player=async name=>{const c=await TestClient.connect(srv.url.replace('http','ws')+'/ws');clients.push(c);c.id=(await c.hello(name)).playerId;return c;};
    const host=await player('Host');await host.request({t:'room.create',mode:'coop',difficulty:'NORMAL'});const room=[...srv.lobby.rooms.values()][0];
    await host.request({t:'room.setAiTakeover',on:true});
    const mate=await player('Mate');await mate.request({t:'room.join',code:room.code});await mate.request({t:'room.ready',ready:true});for(let i=0;i<2;i++)await host.request({t:'room.addBot'});await host.request({t:'room.start'});
    const m=room.match;m.startRound(1);m.phase='PREP';m.setDeadline(0);for(const p of m.order)p._botPrepToken=(p._botPrepToken||0)+1;m.flush(true);const bot=m.order[2];bot.funds=71;bot.acquireChess('chess_char_1_01_a',{fromPool:false});bot.dirty();m.flush(true);
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:900});
    await page.evaluateOnNewDocument(()=>{localStorage.setItem('sp.name','Late');sessionStorage.setItem('sp.entered','1');});await seedReleaseRead(page); await page.goto(srv.url+'/');
    await page.waitForFunction(async()=>{const {net}=await import('/js/net.js');return net.status==='online';});
    await page.evaluate(async code=>{const {net}=await import('/js/net.js');await net.request('room.spectate',{code});},room.code);
    await page.waitForSelector('.gm__corner .ai-participation-entry');await page.click('.gm__corner .ai-participation-entry');
    await page.evaluate(id=>{const buttons=[...document.querySelectorAll('.modal button')];const button=buttons.find(b=>b.textContent.includes('申请接替')&&b.textContent.includes(id));if(!button)throw Error('AI request button absent');button.click();},bot.name);
    await page.waitForFunction(async()=>{const {store}=await import('/js/store.js');return store.get().room?.aiTakeoverVotes?.length===1;});
    const vote=room.aiTakeoverVotes[0];if(process.env.AI_TAKEOVER_SHOT){const panel=await page.$('.modal__box');await panel.evaluate(el=>{el.style.background='#102019';el.style.animation='none';el.style.transform='none';});const box=await panel.boundingBox();await page.screenshot({path:process.env.AI_TAKEOVER_SHOT,clip:box});}
    await host.request({t:'room.aiVote',voteId:vote.id,approve:true});await mate.request({t:'room.aiVote',voteId:vote.id,approve:true});
    await page.waitForFunction(async id=>{const {store}=await import('/js/store.js');const s=store.get();return s.me.playerId===id&&s.match.private?.playerId===id&&!s.ui.restoring;},{},bot.playerId);
    assert.equal(bot.isBot,false);await page.reload();await page.waitForFunction(async id=>{const {store}=await import('/js/store.js');return store.get().me.playerId===id&&store.get().match.private?.playerId===id;},{},bot.playerId);
    assert.equal(bot.funds,71);
    m.finish({victory:false,reason:'test'});
    await page.waitForFunction(async id=>{const {store}=await import('/js/store.js');return store.get().match.result?.players?.some(p=>p.playerId===id&&p.aiTakeoverRound===1);},{},bot.playerId);
    const history=await page.evaluate(async id=>{const {loadStats,countsTowardStats,recordToResult}=await import('/js/ui/stats.js');const records=loadStats().records;const own=records.find(r=>r.selfId===id);return {found:!!own,counts:countsTowardStats(own),round:recordToResult(own)?.players?.find(p=>p.playerId===id)?.aiTakeoverRound};},bot.playerId);
    assert.deepEqual(history,{found:true,counts:false,round:1});assert.deepEqual(errors,[]);
  }finally{await browser.close();for(const c of clients)await c.terminate().catch(()=>{});await srv.close();}
});

test('the host can enable the default-off takeover setting through the room UI', {
  skip: process.env.SP_E2E !== '1' || !chrome || !existsSync(chrome), timeout: 60000,
}, async t => {
  const { startServer } = await import('../../server/index.js');
  const { default: puppeteer } = await import('puppeteer-core');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, botRehearsal: 0 });
  t.after(() => srv.close());
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', `--explicitly-allowed-ports=${srv.port}`] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => { localStorage.setItem('sp.name', 'Host'); sessionStorage.setItem('sp.entered', '1'); });
  await seedReleaseRead(page);
  await page.goto(srv.url);
  await page.waitForFunction(async () => (await import('/js/net.js')).net.status === 'online');
  await page.evaluate(async () => (await import('/js/net.js')).net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
  const room = [...srv.lobby.rooms.values()][0];
  assert.equal(room.aiTakeoverEnabled, false);
  await page.waitForSelector('.rs-pill__gear');
  await page.click('.rs-pill__gear');
  await page.waitForSelector('[data-testid="room-ai-takeover"]');
  assert.equal(await page.$eval('[data-testid="room-ai-takeover"]', el => el.getAttribute('aria-checked')), 'false');
  await page.click('[data-testid="room-ai-takeover"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="room-ai-takeover"]')?.getAttribute('aria-checked') === 'true');
  assert.equal(room.aiTakeoverEnabled, true);
  await page.click('[data-testid="room-ai-takeover"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="room-ai-takeover"]')?.getAttribute('aria-checked') === 'false');
  assert.equal(room.aiTakeoverEnabled, false);
});
