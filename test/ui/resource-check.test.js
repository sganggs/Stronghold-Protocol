import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkResources, resourceRequirements, summarizeResources } from '../../public/js/resourceCheck.js';

const a = 'char_102_texas', b = 'char_010_chen';
const line = (lang, id, slot) => `/assets/audio/voice/${lang}/${id}/${slot}.mp3`;
const manifest = { chars: { [a]: { avatar: '/assets/a.png', spine: { skel: '/assets/a.skel', textures: ['/assets/a.png'] } } },
  audio: { bgm: '/assets/audio/bgm/a.mp3',
    voice: { [a]: { select: line('cn', a, 'select'), place: line('cn', a, 'place') }, [b]: { select: line('cn', b, 'select') } },
    voiceJp: { [a]: { select: line('jp', a, 'select'), place: line('jp', a, 'place') } },
  } };
const json = (value) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const body = () => new Response('resource');
const fixture = (get) => async (url, options) => url === '/data/assets.json' ? json(manifest)
  : ['/data/local-assets.json', '/data/local-fx.json'].includes(url) ? new Response('', { status: 404 }) : get(url, options);

test('completeness requires every non-voice file and a whole available dub for each voiced operator', () => {
  const plan = resourceRequirements(manifest, { groups: { scene: { path: '/assets/local/scene.bin' } } });
  assert.deepEqual(new Set(plan.nonVoice), new Set(['/assets/a.png', '/assets/a.skel', '/media/bgm/a', '/assets/local/scene.bin']));
  const ready = new Map(plan.nonVoice.map((url) => [url, true]));
  // One line or mixing incomplete languages cannot pass the operator requirement.
  ready.set(`/media/voice/cn/${a}/select`, true);
  ready.set(`/media/voice/jp/${a}/place`, true);
  ready.set(`/media/voice/cn/${b}/select`, true);
  assert.deepEqual(summarizeResources(plan, ready).voices.missing, [a]);
  ready.set(`/media/voice/jp/${a}/select`, true);
  assert.equal(summarizeResources(plan, ready).complete, true);
  ready.delete('/assets/a.skel');
  assert.equal(summarizeResources(plan, ready).complete, false);
  assert.throws(() => resourceRequirements({}), /manifest/);
});

test('an import-cache hit is enough and only a miss probes the HTTP cache', async () => {
  const plan = resourceRequirements(manifest);
  const requests = [];
  const report = await checkResources({
    caches: { open: async () => ({ match: async (url) => plan.nonVoice.includes(url) ? body() : undefined }) },
    fetch: fixture(async (url, options) => {
      requests.push([url, options]);
      assert.equal(options.cache, 'only-if-cached');
      assert.equal(options.mode, 'same-origin');
      return url.startsWith('/media/voice/cn/') ? body() : new Response('', { status: 504 });
    }),
  });
  assert.equal(report.complete, true);
  assert.equal(report.voices.ready, 2);
  assert.ok(!requests.some(([url]) => plan.nonVoice.includes(url)), 'imported entries need no HTTP probe');
});

test('a cached original audio URL is accepted; HTML, partial, empty and unverified responses never count', async () => {
  const report = await checkResources({ caches: null, fetch: fixture(async (url) => {
    if (url === '/assets/a.png') return new Response('<html>missing</html>', { headers: { 'content-type': 'text/html' } });
    if (url === '/assets/a.skel') return new Response('partial', { status: 206 });
    if (url === '/media/bgm/a') throw new TypeError('Cache unavailable');
    if (url === '/assets/audio/bgm/a.mp3') return new Response('', { headers: { 'content-length': '0', 'content-type': 'audio/mpeg' } });
    if (url.startsWith('/media/')) return new Response('', { status: 504 });
    return body();
  }) });
  assert.equal(report.complete, false);
  assert.equal(report.nonVoice.ready, 0);
  assert.equal(report.voices.ready, 2, 'original audio aliases satisfy complete voice banks');
  assert.deepEqual(report.unverified, []);
});

test('downstream local lookup receives all requirements independently of download choices and reports progress', async () => {
  const progress = [];
  const report = await checkResources({ caches: null, fetch: fixture(() => assert.fail('no asset network calls')),
    hasResource: async () => true, onProgress: (value) => progress.push(value),
  });
  assert.equal(report.complete, true);
  assert.equal(progress.at(-1).done, progress.at(-1).total);
  assert.equal(report.voices.operators.find((operator) => operator.charId === a).languages.length, 2);
  const controller = new AbortController();
  await assert.rejects(checkResources({ caches: null, signal: controller.signal, fetch: fixture(() => assert.fail()),
    hasResource: async () => { controller.abort(); return true; },
  }), { name: 'AbortError' });
});

test('optional manifests are included when present, but errors cannot produce a complete result', async () => {
  await assert.rejects(checkResources({ caches: null, fetch: async () => new Response('', { status: 503 }) }), /manifest/);
  const plan = resourceRequirements(manifest, null, { groups: { fx: { path: '/assets/local/fx/hit.json' } } });
  assert.ok(plan.nonVoice.includes('/assets/local/fx/hit.json'));
});

test('Cache Storage open and match failures remain unverified despite HTTP cache misses', async () => {
  for (const caches of [{ open: async () => { throw new Error('storage'); } },
    { open: async () => ({ match: async () => { throw new Error('lookup'); } }) }]) {
    const report = await checkResources({ caches, fetch: fixture(async () => { throw new TypeError('cache miss'); }) });
    assert.ok(report.unverified.length > 0);
    assert.equal(report.complete, false);
  }
});

test('a 200 hit counts from status and headers; its body is cancelled unread', { timeout: 5000 }, async () => {
  let reads = 0, cancels = 0;
  // pull() never produces a chunk. A checker that reads the body cannot finish; constructing the Response may pull once.
  const hanging = (headers) => new Response(new ReadableStream({
    pull() { reads += 1; return new Promise(() => {}); },
    cancel() { cancels += 1; },
  }), { status: 200, headers });
  const report = await checkResources({ caches: null, fetch: fixture(async (url) => {
    if (url === '/assets/a.png') return new Response('', { status: 200, headers: { 'content-length': '0', 'content-type': 'image/png' } });
    if (url === '/assets/a.skel') return new Response('partial', { status: 206, headers: { 'content-length': '7' } });
    return hanging({ 'content-type': 'application/octet-stream', 'content-length': '8' });
  }) });
  assert.ok(cancels > 0);
  assert.ok(reads <= cancels, 'the checker does not read past the stream the Response itself started');
  assert.equal(report.nonVoice.missing.includes('/assets/a.png'), true);
  assert.equal(report.nonVoice.missing.includes('/assets/a.skel'), true);
  assert.equal(report.nonVoice.missing.includes('/media/bgm/a'), false);
  assert.equal(report.voices.ready, 2);
});

test('cancel does not wait for a hit body', { timeout: 5000 }, async () => {
  const controller = new AbortController();
  let started = 0;
  await assert.rejects(checkResources({
    caches: null,
    signal: controller.signal,
    fetch: fixture(async () => {
      started += 1;
      if (started === 1) controller.abort();
      return new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }), {
        status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': '4' },
      });
    }),
  }), { name: 'AbortError' });
});
