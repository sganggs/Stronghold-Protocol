import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {scriptFixture} from '../helpers/scriptFixtures.js';
import {createContentSets} from '../../server/plugins/contentSets.js';
import {createMatchHosts} from '../../server/match/host/index.js';
import {buildContentSet,contentSetFiles} from '../../server/plugins/contentSet.js';
import {getData,ROOT} from '../../server/data.js';
import {loadBrowserSim} from '../../public/js/battle/runner.js';
import {loadContentSet} from '../../public/js/content.js';
import {makeBattle} from '../helpers/battleHarness.js';
import {buildBattleSpec,resultDigest} from '../../server/sim/spec.js';
import {DATA_SHIM_JS} from '../../server/http/static.js';
import {createTrustedRuntime} from '../../server/plugins/trustedRuntime.js';
const quiet={info(){},warn(){},error(){}};
const timeout=(ms)=>new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('timeout')),ms);timer.unref();});
function template(f){
 const dir=path.join(ROOT,'plugins/_template/script');
 return f.put('script-demo',fs.readFileSync(path.join(dir,'sim/index.js'),'utf8'),JSON.parse(fs.readFileSync(path.join(dir,'plugin.json'))),{
  'sim/index.js':fs.readFileSync(path.join(dir,'sim/index.js'),'utf8'),
  'guard.json':JSON.parse(fs.readFileSync(path.join(dir,'guard.json'))),
 });
}
test('same script battle is bit-identical in match child and loadBrowserSim, spectator fetches no scripts',async t=>{
 const f=scriptFixture(t);template(f);
 const built=buildContentSet({registry:f.registry,ids:['script-demo']});assert.deepEqual(built.problems,[]);
 const calls=[], served=contentSetFiles(built);
 const fetch=async url=>{
  calls.push(url);let body;
  if(url.startsWith('/cs/'))body=served.get(url.split('/').slice(3).join('/'))?.body;
  else body=fs.readFileSync(path.join(ROOT,url.split('?')[0].slice(1)));
  return {ok:!!body,arrayBuffer:async()=>new Uint8Array(body).buffer};
 };
 const spectator=await loadContentSet(built.cs,{fetch,retryDelays:[]});assert.equal(spectator.canSim,false);assert.equal(spectator.scripts.length,0);assert.ok(!calls.some(x=>x.includes('/scripts/')));
 const accepted=await loadContentSet(built.cs,{fetch,consent:true,retryDelays:[]});assert.equal(accepted.scripts.length,1);
 const runtime=path.join(f.root,'runtime');fs.mkdirSync(path.join(runtime,'server'),{recursive:true});
 // as the browser gets /sim/: no Node loader (by file name: cpSync passes `\` paths on Windows), else a cyclic import
 // simdata.js → nodeData.js → the data.js shim → simdata.js deadlocks loadBrowserSim
 fs.cpSync('server/sim',path.join(runtime,'server/sim'),{recursive:true,filter:src=>path.basename(src)!=='nodeData.js'});
 assert.equal(fs.existsSync(path.join(runtime,'server/sim/nodeData.js')),false);
 fs.cpSync('shared',path.join(runtime,'shared'),{recursive:true});
 fs.writeFileSync(path.join(runtime,'package.json'),'{"type":"module"}');fs.writeFileSync(path.join(runtime,'server/data.js'),DATA_SHIM_JS);
 const base=pathToFileURL(path.join(runtime,'server/sim')).href+'/';
 const sim=await loadBrowserSim({base,data:built.data,cs:built.cs,bounds:built.bounds,scripts:accepted.scripts,hashInput:built.index});
 const h=makeBattle({stageId:'act1autochess_m01',units:[],timeLimit:3});
 const spec=buildBattleSpec({...h.b.opts,cs:built.cs,stageId:'act1autochess_m01',players:[{playerId:'p1',seat:0,units:[{uid:'guard',chessId:'chess_x_script_demo_guard_a',row:9,col:5}]}]});
 const browser=sim.spec.createBattleFromSpec(spec,sim.ds);browser.start();for(let i=0;i<90;i++)browser.step();
 assert.equal(browser.allyUnits[0].kit.generic,undefined);assert.ok(browser.allyUnits[0].s.atk>200);
 const contents=createContentSets({registry:f.registry,vanillaData:getData()});const set=contents.resolve(['script-demo']);assert.ok(set.ok,JSON.stringify(set));
 const hosts=createMatchHosts({contents,log:quiet,options:{matchOptions:{scriptSpec:spec},matchModule:fileURLToPath(new URL('./fixtures/scriptBattleMatch.js',import.meta.url))}});t.after(()=>hosts.close());
 let resolve;const message=new Promise(r=>{resolve=r;});
 const m=hosts.create(built.cs,{roomCode:'TEST',seats:[],scriptSpec:spec,broadcast:resolve,send(){},onEnd(){}});m.start();
 const result=await Promise.race([message,timeout(15000)]);
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.snapshot,browser.snapshot());assert.deepEqual(result.digest,resultDigest(browser.result()));m.dispose();
});
test('all-bot match completes with script content and meta effects in production child', {timeout:120000},async t=>{
 const f=scriptFixture(t);f.put('training',`export default sp => {
 sp.content.register({install(b){b.on('battleStart',()=>{for(const u of b.allyUnits)b.addBuff(u,{key:'test',mods:{atkFlat:2}});});}});
 sp.meta.register('global:training',{onRoundStart(ctx){ctx.addFunds(1);}});
 }`,{permissions:['sim.code','meta.code'],entry:{sim:'index.js',meta:'index.js'}});
 const contents=createContentSets({registry:f.registry,vanillaData:getData()});const r=contents.resolve(['training']);assert.ok(r.ok,JSON.stringify(r));
 const hosts=createMatchHosts({contents,log:quiet,options:{virtualTime:true,matchOptions:{botRehearsal:0}}});t.after(()=>hosts.close());
 let end;const done=new Promise(resolve=>{end=resolve;});
 const match=hosts.create(r.set.cs,{roomCode:'BOTS',mode:'coop',difficulty:'NORMAL',modeId:'mode_multi_normal',
  seats:Array.from({length:4},(_,i)=>({seat:i,playerId:'ai_'+i,name:'Bot '+i,isBot:true,connected:true})),spectators:[],seed:7,matchNo:1,cs:r.set.cs,requireCs:true,
  broadcast(){},send(){return true;},onEnd:end});match.start();
 const summary=await Promise.race([done,timeout(100000)]);assert.equal(typeof summary.victory,'boolean');
 const d=await match.diag();assert.equal(d.errorCount,0,JSON.stringify(d.errors));assert.equal(d.simErrors,0);match.dispose();
});
test('trusted activate routes, immutable lobby copies and health run in a child',async t=>{
 const f=scriptFixture(t);f.put('service','export default () => {};',{class:'trusted',scope:['server'],permissions:['trusted.server'],entry:{server:'server.js'}},{'server.js':`
 export function activate(api){let joined=0;api.http.route('/x/service/status',()=>({joined}));
 api.lobby.on('playerJoined',e=>{if(!Object.isFrozen(e.room))throw Error('mutable');joined++;api.health.extend({joined});});api.health.extend({joined});}
 `});
 const runtime=await createTrustedRuntime({registry:f.registry,log:quiet});assert.ok(runtime);t.after(()=>runtime.close());
 runtime.event('playerJoined',{room:{code:'TEST'}});
 const response=await new Promise(resolve=>{runtime.route({url:'/x/service/status',method:'GET'},{writeHead(){},end:body=>resolve(JSON.parse(body))});});
 assert.deepEqual(response,{joined:1});assert.deepEqual(runtime.health.service,{joined:1});
});
test('CLI test runs the template harness with composed data',t=>{
 const f=scriptFixture(t);const dir=template(f);
 fs.mkdirSync(path.join(dir,'test'));let source=fs.readFileSync('plugins/_template/script/test/guard.test.js','utf8');
 source=source.replace('../../../test/helpers/battleHarness.js',pathToFileURL(path.join(ROOT,'test/helpers/battleHarness.js')).href);
 fs.writeFileSync(path.join(dir,'test/guard.test.js'),source);
 fs.symlinkSync(path.join(ROOT,'data'),path.join(f.root,'data'));fs.symlinkSync(path.join(ROOT,'server'),path.join(f.root,'server'));fs.symlinkSync(path.join(ROOT,'shared'),path.join(f.root,'shared'));
 // This explicit local command ignores both server mode and the pin (even after test files changed).
 fs.writeFileSync(path.join(f.pluginsDir,'config.json'),JSON.stringify({trusted:{'script-demo':'wrong-pin'}}));
 const env={...process.env,SP_PLUGIN_SCRIPTS:'sandbox'};delete env.NODE_TEST_CONTEXT;
 const r=spawnSync(process.execPath,['tools/plugin.mjs','test','script-demo','--root',f.root],{encoding:'utf8',timeout:20000,env});
 assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/ℹ pass 1\b/); // spec on every Node version
});
