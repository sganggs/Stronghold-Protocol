// P3a review regressions: real children, bounded outer watchdogs, no listening sockets required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { scriptFixture } from '../helpers/scriptFixtures.js';
import { trustDecision, isUnspecifiedAddress } from '../../server/plugins/trusted.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { SCRIPT_PROBE_TIMEOUT_MS } from '../../server/plugins/scriptPreflight.js';
import { createTrustedRuntime } from '../../server/plugins/trustedRuntime.js';
import { TRUSTED_HEALTH_BYTES } from '../../server/plugins/trustedApi.js';
import { checkScript } from '../../shared/plugins/scriptCheck.js';
import { readPluginManifest } from '../../shared/plugins/manifest.js';
import { startServer } from '../../server/index.js';

const quiet = {info(){},warn(){},error(){}};
const zeros = ['::','::0','0::0','0::','0000::','::0000','0:0:0:0:0:0:0:0000',
  '0000:0000:0000:0000:0000:0000:0000:0000','0:0:0:0:0:0:0::','::0.0.0.0',
  '0.0.0.0','0.1.2.3','0.255.255.255','::ffff:0.0.0.0','::ffff:0.255.255.255',
  '0:0:0:0:0:FFFF:0000:0000','0:0:0:0:0:ffff:ff:ffff'];
function pidFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'sp-p3a-pid-'));
  const file = path.join(dir,'child.pid');
  t.after(() => {
    if (fs.existsSync(file)) for (const pid of fs.readFileSync(file,'utf8').trim().split('\n').map(Number)) {
      try { process.kill(pid,'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    }
    fs.rmSync(dir,{recursive:true,force:true});
  });
  return file;
}
function assertDead(file) {
  const pid = Number(fs.readFileSync(file,'utf8').trim());
  assert.ok(pid > 0);
  assert.throws(() => process.kill(pid,0), {code:'ESRCH'}, `child ${pid} must be reaped`);
}
function service(f, source) {
  f.put('service','export default () => {};',{
    class:'trusted',scope:['server'],permissions:['trusted.server'],entry:{server:'server.js'},
  },{'server.js':source});
}
async function request(runtime, url) {
  let status, body;
  const handled = await runtime.route({url,method:'GET'},{writeHead:s => {status=s;},end:b => {body=b;}});
  return {handled,status,value:body && JSON.parse(body)};
}
// An outer async watchdog ensures a broken spawnSync cannot hang the test runner itself.
function runComposition(dirs, ids, probeMs = 1000) {
  const source = `import { createPluginRegistry } from ${JSON.stringify(new URL('../../server/plugins/registry.js',import.meta.url).href)};
    import { buildContentSet } from ${JSON.stringify(new URL('../../server/plugins/contentSet.js',import.meta.url).href)};
    const registry = createPluginRegistry(${JSON.stringify(dirs)}, {scriptMode:'trusted',scriptHost:'127.0.0.1'});
    console.log(JSON.stringify(buildContentSet({registry,ids:${JSON.stringify(ids)}})));`;
  // (the probe's ceiling, SP_SCRIPT_PROBE_MS, at probeMs — 1 s unless a test needs more: the hang case returns quickly;
  // the default is 5 s)
  const env = {...process.env, SP_SCRIPT_PROBE_MS: String(probeMs)}; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath,['--input-type=module','-e',source],{env,stdio:['ignore','pipe','pipe'],timeout:probeMs+7000,killSignal:'SIGKILL'});
  let stdout = '', stderr = '';
  child.stdout.on('data',b => {stdout+=b;}); child.stderr.on('data',b => {stderr+=b;});
  return new Promise((resolve,reject) => {
    child.on('error',reject);
    child.on('close',(code,signal) => {
      if (code !== 0) reject(new Error(`composition failed to return: ${code}/${signal} ${stderr}`));
      else { try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); } }
    });
  });
}

test('all unspecified IP spellings and IPv4-mapped zero/8 refuse trusted mode', () => {
  const p = {id:'demo',script:{lockHash:'pinned',lockValid:true}}, pins = {demo:'pinned'};
  for (const host of zeros) {
    assert.equal(isUnspecifiedAddress(host),true,host);
    assert.equal(trustDecision(p,{host,mode:'trusted',pins})?.code,'PLUGIN_TRUST_PUBLIC',host);
    assert.equal(trustDecision(p,{host,mode:'trusted-force',pins}),null,host);
  }
  for (const host of ['::1','0::1','127.0.0.1','192.168.1.5','10.1.2.3','172.16.0.1','fd00::1','fe80::1%lo0',
    '::ffff:127.0.0.1','0:0:0:0:0:ffff:c0a8:105','::ffff:a01:203']) {
    assert.equal(isUnspecifiedAddress(host),false,host);
    assert.equal(trustDecision(p,{host,mode:'trusted',pins}),null,host);
  }
  for (const host of ['8.8.8.8','::ffff:8.8.8.8','2001:4860::1','invalid','127.0.0.1:80'])
    assert.equal(trustDecision(p,{host,mode:'trusted',pins})?.code,'PLUGIN_TRUST_PUBLIC',host);
});

for (const mode of ['trusted','trusted-force']) test(`actual wildcard bind rechecks ${mode} and shutdown reaps the service`,async t => {
  const f = scriptFixture(t), file = pidFile(t);
  service(f,`import fs from 'node:fs'; export function activate(api) {
    fs.writeFileSync(${JSON.stringify(file)},String(process.pid)); process.on('SIGTERM',()=>{});
    api.health.extend({pid:process.pid}); api.http.route('/x/service/ok',()=>true);
  }`);
  const old = process.env.SP_PLUGIN_SCRIPTS; process.env.SP_PLUGIN_SCRIPTS = mode;
  t.after(() => { if (old === undefined) delete process.env.SP_PLUGIN_SCRIPTS; else process.env.SP_PLUGIN_SCRIPTS=old; });
  // Simulate the OS canonicalizing an accepted input to a wildcard; this runs the real startServer post-bind path.
  t.mock.method(http.Server.prototype,'listen',function() {queueMicrotask(() => this.emit('listening'));return this;});
  t.mock.method(http.Server.prototype,'address',() => ({address:'::',family:'IPv6',port:12345}));
  const server = await startServer({host:'127.0.0.1',port:0,pluginsDir:f.pluginsDir,quiet:true,studio:false,assetIndex:false});
  t.after(() => server.close());
  if (mode === 'trusted') {
    assert.equal(server.packs.plugin('service').status,'disabled');
    assert.equal(server.packs.plugin('service').disabled.code,'PLUGIN_TRUST_PUBLIC');
    server.packs.rescan();assert.equal(server.packs.plugin('service').status,'disabled');
    assert.equal(server.lobby.trustedRuntime,null);assertDead(file);
  } else {
    assert.equal(server.packs.plugin('service').status,'loaded');
    server.packs.rescan();assert.equal(server.packs.plugin('service').status,'loaded');
    assert.equal((await request(server.lobby.trustedRuntime,'/x/service/ok')).value,true);
    await server.close();assertDead(file);
  }
});

test('SIGTERM-catching setup hits the probe\'s SIGKILL ceiling, returns no set and leaves no child',async t => {
  const f = scriptFixture(t), file = pidFile(t);
  const source = `export default function setup() {
    const p = global['pro' + 'cess']; p.getBuiltinModule('fs').writeFileSync(${JSON.stringify(file)},String(p.pid));
    p.on('SIGTERM',()=>{}); while (true) {}
  }`;
  assert.equal(checkScript(source).sandboxable,true);
  f.put('loop',source);
  // The ceiling covers the probe's whole life: its start (Node, the SDK and the simulation modules — a quarter of a
  // second on an idle machine, over 1 s on a busy CI runner or Windows) and then the setup. Only a setup that is
  // running when SIGKILL comes tests the SIGTERM-catching case: if it never started (no pid written), the same
  // composition runs again with a ceiling twice as long. Every run must still be refused at its own ceiling.
  for (const ms of [1000,2000,4000,8000]) {
    const result = await runComposition(f.registry.contentDirs,['loop'],ms);
    assert.equal(result.cs,undefined);assert.equal(result.problems[0].code,'PLUGIN_SCRIPT_CHECK');
    assert.match(result.problems[0].message,new RegExp(`${ms} ms.*SIGKILL`));
    if (fs.existsSync(file)) break;
  }
  assert.ok(fs.existsSync(file),'the setup started within one of the ceilings');assertDead(file);
  assert.equal(SCRIPT_PROBE_TIMEOUT_MS,5000,'the default ceiling (no SP_SCRIPT_PROBE_MS in this process)');
});

test('probe cache covers successes and failures but separates locks, descriptors and normalized settings',t => {
  const f = scriptFixture(t), file = path.join(f.root,'count.txt');
  const source = `export default sp => {
    global['pro'+'cess'].getBuiltinModule('fs').appendFileSync(${JSON.stringify(file)},'x');
    if (sp.settings.n === 3) throw Error('three is refused');
    sp.kits.register('char_x_cache_'+sp.settings.n,()=>({}));
  }`;
  f.put('cache',source,{settings:{n:{type:'integer',min:1,max:3,default:1}}});
  f.put('extra','export default sp => sp.kits.register("char_x_extra_guard",()=>({}));');
  const build = ids => buildContentSet({registry:f.registry,ids});
  assert.deepEqual(build(['cache']).problems,[]);
  assert.deepEqual(build(['cache','extra']).problems,[]);
  assert.equal(fs.readFileSync(file,'utf8'),'x','same script across different sets is probed once');
  assert.deepEqual(build([{id:'cache',settings:{n:2}}]).problems,[]);
  assert.equal(fs.readFileSync(file,'utf8'),'xx');
  for (let i=0;i<2;i++) assert.equal(build([{id:'cache',settings:{n:3}}]).problems[0].code,'PLUGIN_SCRIPT_CHECK');
  assert.equal(fs.readFileSync(file,'utf8'),'xxx','failed probe is cached too');
  f.put('cache',source+'\n// new lock',{settings:{n:{type:'integer',min:1,max:3,default:1}}});
  assert.deepEqual(build(['cache']).problems,[]);assert.equal(fs.readFileSync(file,'utf8'),'xxxx');
  f.put('conflict','export default sp => sp.kits.register("char_x_cache_1",()=>({}));');
  assert.deepEqual(build(['conflict']).problems,[]);
  assert.equal(build(['cache','conflict']).problems[0].code,'PLUGIN_SCRIPT_CONFLICT','cached reports still conflict');
});

for (const action of ['activation timeout','activation error','route timeout','close']) test(`trusted ${action} kills a SIGTERM-catching child and waits for exit`,{timeout:15000},async t => {
  const f = scriptFixture(t), file = pidFile(t);
  service(f,`import fs from 'node:fs'; export function activate(api) {
    fs.writeFileSync(${JSON.stringify(file)},String(process.pid));process.on('SIGTERM',()=>{});
    ${action === 'activation timeout' ? 'while(true){}' : action === 'activation error' ? "throw Error('activation failed');" : ''}
    api.http.route('/x/service/ok',()=>{${action === 'route timeout' ? 'while(true){}' : 'return true;'}});
    api.health.extend({pid:process.pid});
  }`);
  const lines = [];
  const runtime = await createTrustedRuntime({registry:f.registry,log:{...quiet,warn:m => lines.push(m)}});
  if (action.startsWith('activation')) {
    assert.equal(runtime,null);assert.ok(lines.some(m => m.includes(action.endsWith('timeout') ? 'timed out' : 'activation failed')));
  } else {
    assert.ok(runtime);t.after(() => runtime.close());
    if (action === 'route timeout') {
      const response = await request(runtime,'/x/service/ok');
      assert.equal(response.status,502);assert.match(response.value.error,/timed out/);
    } else await runtime.close();
    assert.deepEqual(Object.keys(runtime.health),[]);
    assert.equal((await request(runtime,'/x/service/ok')).handled,false);
  }
  assertDead(file);
});

test('health JSON has a UTF-8 byte limit in both the API and parent IPC receiver',async t => {
  const f = scriptFixture(t);
  service(f,`export function activate(api) {
    const edge = 'a'.repeat(${TRUSTED_HEALTH_BYTES}-2);
    api.health.extend(edge);
    let rejected=0;
    for (const value of [edge+'a','界'.repeat(6000),undefined]) {try {api.health.extend(value);}catch {rejected++;}}
    process.send({type:'health',id:'service',value:'界'.repeat(6000)});
    process.send({type:'health',id:'unknown',value:true});
    api.http.route('/x/service/check',()=>({rejected}));
  }`);
  const runtime = await createTrustedRuntime({registry:f.registry,log:quiet});assert.ok(runtime);t.after(() => runtime.close());
  assert.deepEqual((await request(runtime,'/x/service/check')).value,{rejected:3});
  assert.equal(Buffer.byteLength(JSON.stringify(runtime.health.service)),TRUSTED_HEALTH_BYTES);
  assert.deepEqual(Object.keys(runtime.health),['service']);
});

test('trusted client diagnostics request .js; UI client diagnostics still request .html',() => {
  const raw = {manifest:2,id:'client',version:'1.0.0',app:'*',api:1,class:'trusted',scope:['room'],permissions:['trusted.page'],entry:{client:'client.html'}};
  const bad = readPluginManifest(raw,{id:'client'});
  assert.match(bad.problems.join(),/entry.client.*not a \.js file/);
  assert.deepEqual(readPluginManifest({...raw,entry:{client:'client.js'}},{id:'client'}).problems,[]);
  assert.match(readPluginManifest({...raw,class:'ui',scope:['personal'],permissions:['ui.frame'],entry:{client:'client.js'}},{id:'client'}).problems.join(),/not a \.html file/);
});
