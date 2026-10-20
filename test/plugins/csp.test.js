import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Writable } from 'node:stream';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { siteCsp, SIM_WORKER_CSP } from '../../server/http/csp.js';
import { createRequestHandler } from '../../server/http/routes.js';
import { createStaticHandler } from '../../server/http/static.js';
import { installPixiNoEval } from '../../public/js/render/app/pixiNoEval.js';
import { createPluginRegistry } from '../../server/plugins/registry.js';
import { UI_FRAME_CSP } from '../../shared/plugins/ui.js';
import {scriptFixture} from '../helpers/scriptFixtures.js';
import {createContentSets} from '../../server/plugins/contentSets.js';
import {getData} from '../../server/data.js';

const publicDir = path.resolve('public');
function request(handler, url, headers = {}) {
  const body = [], result = { headers: {}, status: 0 };
  const res = new Writable({ write(chunk, _, done) { body.push(chunk); done(); } });
  res.setHeader = (name, value) => { result.headers[name.toLowerCase()] = value; };
  res.getHeader = name => result.headers[name.toLowerCase()];
  res.writeHead = (status, fields) => { result.status = status; for (const [k, v] of Object.entries(fields || {})) res.setHeader(k, v); };
  const done = once(res, 'finish').then(() => ({ ...result, body: Buffer.concat(body).toString() }));
  handler({ url, method: 'GET', headers }, res);
  return done;
}
function handler(csp = siteCsp(publicDir)) {
  const serveStatic = createStaticHandler({ publicDir, dataDir: path.resolve('data'), sharedDir: path.resolve('shared') });
  return createRequestHandler({ serveStatic, health: {}, log: console, csp });
}
test('page import maps hash exact bytes; no inline executable script/events; page forbids eval', () => {
  const csp = siteCsp(publicDir);
  assert.ok(!csp.includes('unsafe-eval')); assert.match(csp, /worker-src 'self' blob:/);
  assert.match(csp,/connect-src 'self';/);assert.ok(!/script-src[^;]*(?:data:|blob:)/.test(csp));
  // the player's own lobby video (ui/lobbyMedia.js) plays from an object URL; no remote media origin
  assert.match(csp, /media-src 'self' blob:;/);
  for (const file of ['index.html', 'studio/index.html', 'studio/console.html', 'dev/game-mock.html', 'dev/render-demo.html', 'dev/battle-perf.html', 'dev/uikit.html']) {
    const html = fs.readFileSync(path.join(publicDir, file), 'utf8');
    assert.ok(!/<[^>]+\son(?:load|error|click)=/i.test(html), file);
    for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (m[1].includes('importmap')) assert.ok(csp.includes(createHash('sha256').update(m[2]).digest('base64')), file);
      else assert.ok(!m[2].trim(), file);
    }
  }
});

test('native script HTTP routes serve exact descriptor bytes and JavaScript MIME under site CSP',async t=>{
  const f=scriptFixture(t);
  f.put('native',"import {kit} from 'sp:sdk@1'; export default sp => {};",
    {class:'trusted',permissions:['sim.code','trusted.page'],entry:{sim:'index.js',client:'page.js'}},{'page.js':'globalThis.nativeTest = true;'});
  const contents=createContentSets({registry:f.registry,vanillaData:getData()});
  const r=contents.resolve(['native']);assert.ok(r.ok,JSON.stringify(r));
  const set=r.set,cs16=set.cs.slice(0,16);
  const serveStatic=createStaticHandler({publicDir,dataDir:path.resolve('data'),sharedDir:path.resolve('shared'),contents});
  const serve=createRequestHandler({serveStatic,csp:siteCsp(publicDir),health:{},log:console});
  for(const rel of ['index.js','page.js']) {
    const url=`/cs/${cs16}/scripts/native/${rel}`,a=await request(serve,url);
    assert.equal(a.status,200);assert.match(a.headers['content-type'],/^text\/javascript/);
    assert.equal(a.body,set.scripts[0].browserSources[rel]);assert.equal(a.headers['content-security-policy'],siteCsp(publicDir));
    assert.equal((await request(serve,url,{'if-none-match':a.headers.etag})).status,304);
  }
  assert.match(set.scripts[0].browserSources['index.js'],/\/shared\/plugins\/sdk.js/);
  assert.equal((await request(serve,`/cs/${cs16}/scripts/native/not-listed.js`)).status,404);
  fs.writeFileSync(f.pluginsDir+'/native/page.js','globalThis.nativeTest = false;');
  assert.equal((await request(serve,`/cs/${cs16}/scripts/native/page.js`)).body,'globalThis.nativeTest = true;','immutable held bytes');
});
test('actual static responses: Worker CSP on 200/206/304 and encoded aliases, independent of site switch', async () => {
  for (const csp of [siteCsp(publicDir), null]) {
    const serve = handler(csp);
    const page = await request(serve, '/');
    assert.equal(page.headers['content-security-policy'], csp || undefined);
    const a = await request(serve, '/js/battle/simWorker.js');
    assert.equal(a.status, 200); assert.equal(a.headers['content-security-policy'], SIM_WORKER_CSP);
    for (const headers of [{ range: 'bytes=0-20' }, { 'if-none-match': a.headers.etag }]) {
      const b = await request(serve, '/js/battle/sim%57orker.js', headers);
      assert.equal(b.status, headers.range ? 206 : 304); assert.equal(b.headers['content-security-policy'], SIM_WORKER_CSP);
    }
    assert.match(SIM_WORKER_CSP, /connect-src 'none'/);
  }
});
test('Pixi CSP adapter uploads matrices, samplers, arrays and scalars without code generation', () => {
  class ShaderSystem {}
  installPixiNoEval({ ShaderSystem });
  const calls = [], gl = new Proxy({}, { get: (_, key) => (...args) => calls.push([key, ...args]) });
  const s = new ShaderSystem();
  s.renderer = { gl, texture: { bind: () => {} } };
  const data = { f: { type: 'float', size: 1 }, m: { type: 'mat3', size: 1 }, t: { type: 'sampler2D', size: 1 }, a: { type: 'vec3', size: 2, isArray: true } };
  s.shader = { program: { uniformData: data } };
  s.systemCheck(); s.syncUniforms({ uniforms: { f: 7, m: [1,0,0,0,1,0,0,0,1], t: {}, a: [1,2,3,4,5,6] } },
    { uniformData: Object.fromEntries(Object.keys(data).map(k => [k, { location: k, value: -1 }])) });
  assert.deepEqual(calls.map(c => c[0]), ['uniform1f', 'uniformMatrix3fv', 'uniform1i', 'uniform3fv']);
});

test('site CSP never changes the UI frame policy (200/206/304)', async t => {
  const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-p3b-frame-csp-'));
  t.after(() => fs.rmSync(pluginsDir, { recursive: true, force: true }));
  fs.cpSync(path.resolve('plugins/_template/ui'), path.join(pluginsDir, 'damage-meter'), { recursive: true });
  const dirs = { publicDir, pluginsDir, sharedDir: path.resolve('shared'), dataDir: path.resolve('data'), packsDir: path.join(pluginsDir, 'packs') };
  const registry = createPluginRegistry(dirs); registry.refresh(true);
  const file = registry.plugin('damage-meter').ui.served.get('ui/index.html');
  const url = `/p/damage-meter/${file.sha256.slice(0, 8)}/ui/index.html`;
  for (const csp of [siteCsp(publicDir), null]) {
    const serve = createRequestHandler({ serveStatic: createStaticHandler({ ...dirs, packs: registry }), health: {}, log: console, csp });
    const first = await request(serve, url);
    assert.equal(first.status, 200); assert.equal(first.headers['content-security-policy'], UI_FRAME_CSP);
    for (const headers of [{ range: 'bytes=0-20' }, { 'if-none-match': first.headers.etag }]) {
      const next = await request(serve, url, headers);
      assert.equal(next.status, headers.range ? 206 : 304); assert.equal(next.headers['content-security-policy'], UI_FRAME_CSP);
    }
  }
});
