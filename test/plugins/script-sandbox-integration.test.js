import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {scriptFixture} from '../helpers/scriptFixtures.js';
import {buildContentSet,contentSetFiles} from '../../server/plugins/contentSet.js';
import {createContentSets} from '../../server/plugins/contentSets.js';
import {createRoomSets} from '../../server/plugins/roomSets.js';
import {readPolicy} from '../../server/plugins/policy.js';
import {trustDecision} from '../../server/plugins/trusted.js';
import {getData,ROOT} from '../../server/data.js';
import {loadContentSet} from '../../public/js/content.js';
import {verifyScripts,scriptUrl} from '../../shared/plugins/scriptLoad.js';
import {Lobby} from '../../server/lobby.js';
import {SessionRegistry} from '../../server/net.js';
import {Worker} from 'node:worker_threads';
import {WorkerSimHost} from '../../public/js/battle/simHost.js';
import {fixtureSpec,WORKER_LOAD_MS} from '../helpers/simHostFixture.js';

const source = `import {kit} from 'sp:sdk@1'; export default sp => {
  if (typeof global !== 'undefined' || typeof harden !== 'undefined' || typeof lockdown !== 'undefined') throw Error('native probe');
  sp.kits.register('char_x_demo_guard',()=>({skill:{kind:'passive',mods:{atkPct:kit.num(0.5)}}}));
}`;
const fetchSet = built => {
  const served = contentSetFiles(built);
  return async url => {
    const body = url.startsWith('/cs/') ? served.get(url.split('/').slice(3).join('/'))?.body : fs.readFileSync(ROOT+url.split('?')[0]);
    return {ok:!!body,arrayBuffer:async()=>new Uint8Array(body).buffer};
  };
};

test('sandbox catalogue, constrained preflight, no pin/public gate, real room needs no consent', async t => {
  const f=scriptFixture(t,{mode:'sandbox',host:'0.0.0.0'});
  f.put('demo',source);
  fs.writeFileSync(f.pluginsDir+'/config.json','{"trusted":{}}'); f.registry.rescan();
  const p=f.registry.plugin('demo'); assert.equal(p.status,'loaded');
  assert.equal(f.registry.pluginIndex().plugins.find(p=>p.id==='demo').execution,'sandbox');
  assert.equal(trustDecision(p,{mode:'sandbox',host:'0.0.0.0'}),null);
  assert.equal(trustDecision({...p,script:{...p.script,lockValid:false}},{mode:'sandbox'}).code,'PLUGIN_TRUST_PIN');
  assert.equal(trustDecision({...p,class:'trusted'},{mode:'sandbox'}).code,'PLUGIN_SCRIPTS_DISABLED');
  assert.equal(readPolicy(null,{env:{SP_PLUGIN_SCRIPTS:'sandbox'}}).policy.classes.script,true);
  assert.equal(readPolicy(null,{env:{SP_PLUGIN_SCRIPTS:'sandbox'}}).policy.classes.trusted,undefined);
  const contents=createContentSets({registry:f.registry,vanillaData:getData()});
  const plugins=createRoomSets({registry:f.registry,visual:null,contents,policy:null});
  const lobby=new Lobby({registry:new SessionRegistry(),content:{cs:'c'.repeat(64)},plugins});t.after(()=>lobby.shutdown());
  const host={playerId:'h',name:'Host',connected:true,ws:null},guest={playerId:'g',name:'Guest',connected:true,ws:null};
  lobby.create(host,{mode:'coop',difficulty:'NORMAL'});lobby.join(guest,{code:host.roomCode});
  assert.deepEqual(lobby.setPlugins(host,{plugins:[{id:'demo'}]}),{ok:true});
  const room=lobby.roomOf(host),content=room.toState().content;
  assert.equal(content.execution,'sandbox');assert.equal(content.trusted,undefined);assert.equal(content.plugins[0].execution,'sandbox');
  const built=buildContentSet({registry:f.registry,ids:['demo']});assert.deepEqual(built.problems,[]);
  const loaded=await loadContentSet(built.cs,{fetch:fetchSet(built),retryDelays:[]});
  assert.equal(loaded.canSim,true);assert.equal(loaded.nativeVerified,false);assert.equal(loaded.scripts.length,1);
  verifyScripts(loaded.scripts,loaded.index);
  for(const s of [host,guest]) assert.deepEqual(lobby.contentReady(s,{cs:built.cs}),{ok:true});
  for(const seat of room.seats.filter(Boolean))seat.ready=true;
  lobby.startMatch=()=>({ok:true});assert.deepEqual(lobby.start(host),{ok:true});
  const forged=structuredClone(loaded.scripts);forged[0].execution='trusted';
  assert.throws(()=>verifyScripts(forged,built.index),/hash mismatch/);
});

test('native and mixed sets require consent; mode changes identity; source responses must match descriptor bytes',async t=>{
  const portable='export default sp => sp.kits.register("char_x_demo_guard",()=>({}));';
  const f=scriptFixture(t,{mode:'sandbox'});f.put('demo',portable);
  const sandbox=buildContentSet({registry:f.registry,ids:['demo']});assert.deepEqual(sandbox.problems,[]);
  // Identical manifest, lock and source, with only the execution decision changed.
  f.registry.plugin('demo').script.execution='trusted';
  const native=buildContentSet({registry:f.registry,ids:['demo']});assert.deepEqual(native.problems,[]);
  assert.notEqual(native.cs,sandbox.cs);
  const noConsent=await loadContentSet(native.cs,{fetch:fetchSet(native),retryDelays:[]});assert.equal(noConsent.canSim,false);
  const loaded=await loadContentSet(native.cs,{fetch:fetchSet(native),consent:true,retryDelays:[]});assert.equal(loaded.nativeVerified,true);
  const fetch=fetchSet(native),url=scriptUrl(native.cs,'demo','index.js');
  await assert.rejects(loadContentSet(native.cs,{consent:true,retryDelays:[],fetch:async u=>u===url
    ? {ok:true,arrayBuffer:async()=>new TextEncoder().encode(portable+'\n// changed').buffer} : fetch(u)}),/script response hash mismatch/);
  // An untrusted index cannot relabel native descriptors as sandbox and authorize execution.
  await assert.rejects(loadContentSet(native.cs,{retryDelays:[],fetch:async u=>u.endsWith('/index.json')
    ? {ok:true,arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify({...native.index,execution:'sandbox'})).buffer} : fetch(u)}),/execution mode mismatch/);
  const trusted=scriptFixture(t,{mode:'trusted'});trusted.put('demo',portable);
  trusted.put('page','export default () => {};',{class:'trusted',permissions:['trusted.page'],entry:{client:'page.js'}},{'page.js':'globalThis.pageProbe = true;'});
  const contents=createContentSets({registry:trusted.registry,vanillaData:getData()});
  const rooms=createRoomSets({registry:trusted.registry,visual:null,contents,policy:null});
  const mixed=rooms.resolve(['demo','page']);assert.ok(mixed.ok,JSON.stringify(mixed));
  assert.equal(mixed.set.execution,'trusted');assert.equal(mixed.set.trusted.plugins.length,2);
  const set=contents.get(mixed.set.cs),part=mixed.set.cs.slice(0,16);
  const route=contents.file(part,'scripts/page/page.js');assert.match(route.type,/text\/javascript/);
  assert.equal(route.body.toString(),set.scripts.find(p=>p.id==='page').sources['page.js']);
  assert.equal(contents.file(part,'scripts/page/../page.js'),null);
  assert.equal(contents.file(part,'scripts/page/not-listed.js'),null);
});

test('production SDK budget in SES disables one plugin, keeps other effects and live engine objects',async t=>{
  const f=scriptFixture(t,{mode:'sandbox'});
  f.put('bad',`export default sp => sp.content.register({install(b){
    b.on('battleStart',()=>{b.addBuff(b.allyUnits[0],{key:'bad',mods:{atkFlat:999}});for(let i=0;i<9000;i++)b.addDp('p1',1);});
  }});`);
  f.put('good',`export default sp => sp.content.register({install(b){b.on('tick',()=>b.addDp('p1',1));}});`);
  const built=buildContentSet({registry:f.registry,ids:['bad','good']});assert.deepEqual(built.problems,[]);
  const loaded=await loadContentSet(built.cs,{fetch:fetchSet(built),retryDelays:[]});
  const host=new WorkerSimHost({loadTimeoutMs:WORKER_LOAD_MS,workerFactory:()=>{
    const worker=new Worker(new URL('../helpers/simWorkerNode.mjs',import.meta.url));
    const port={postMessage:m=>worker.postMessage(m),terminate:()=>worker.terminate()};
    worker.on('message',data=>port.onmessage?.({data}));worker.on('error',e=>port.onerror?.(e));return port;
  }});t.after(()=>host.stop());
  await host.load(built.cs,{cs:built.cs,data:Object.fromEntries(loaded.values),bounds:loaded.bounds,scripts:loaded.scripts,hashInput:loaded.index});
  await host.start(fixtureSpec());await host.step(3);
  const bad=await host.rpc('budget',['bad']),good=await host.rpc('budget',['good']);
  assert.equal(bad.disabled,true);assert.equal(bad.used,8000);assert.equal(good.disabled,false);assert.ok(good.used>0);
  assert.equal(bad.alive,true);assert.equal(bad.errors.filter(e=>e.hook==='plugin:bad'||e.label==='plugin:bad').length,1);
});
