// test/ui/shop-card-stage.test.js — the card stage's safety rules around the WebGL context:
// 1. an attribute the linked program dropped (getAttribLocation returns -1) is never enabled — Chrome answers
//    enableVertexAttribArray(-1) with INVALID_VALUE on every draw until it gives up on the context;
// 2. destroy() hands the context back through WEBGL_lose_context exactly once, and only after the deletes:
//    delete* on a lost context is a no-op, so losing first would leave every GPU object to the browser;
// 3. a create() that gives up releases the context and the listener the same way, so a failed mount cannot
//    leave a live context behind (the host builds a fresh canvas per mount);
// 4. the sampler state of a texture record reaches the GL and the texture cache key, and a record without
//    TextureSettings keeps the bare URL as its key.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { create } from '../../public/js/render/shop/cardStage.js';

// The sampling enums have to be distinct: the Proxy below answers every other all-caps property with 1, which
// would make CLAMP_TO_EDGE, REPEAT and LINEAR indistinguishable in the assertions.
const ENUM = {
  CLAMP_TO_EDGE: 0x812f,
  REPEAT: 0x2901,
  MIRRORED_REPEAT: 0x8370,
  LINEAR: 0x2601,
  NEAREST: 0x2600,
  TEXTURE_2D: 0x0de1,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  RGBA: 0x1908,
  UNSIGNED_BYTE: 0x1401,
};

// The stage touches most of the WebGL2 surface. This fake answers an all-caps property with its ENUM value (or
// 1), every other function with a no-op, and overrides the calls the rules below observe.
function fakeGl({ attribs = {}, withLose = true, linkFails = false } = {}) {
  const calls = { enabled: [], pointers: [], loses: 0, log: [], texParameteri: [], seq: [] };
  const loseContextExt = withLose
    ? { loseContext: () => { calls.loses += 1; calls.log.push('loseContext'); } }
    : null;
  const overrides = {
    ...ENUM,
    getAttribLocation: (_program, name) => (name in attribs ? attribs[name] : 0),
    // The location is the uniform's name, so the recorded calls say which uniform they set.
    getUniformLocation: (_program, name) => name,
    enableVertexAttribArray: (location) => { calls.enabled.push(location); },
    vertexAttribPointer: (location) => { calls.pointers.push(location); },
    getExtension: (name) => {
      calls.log.push(`getExtension:${name}`);
      return name === 'WEBGL_lose_context' ? loseContextExt : null;
    },
    getParameter: () => 4096,
    getShaderParameter: () => true,
    getProgramParameter: () => !linkFails,
    getProgramInfoLog: () => 'link failed',
    isContextLost: () => false,
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    createTexture: () => ({}),
    deleteBuffer: () => { calls.log.push('deleteBuffer'); },
    deleteProgram: () => { calls.log.push('deleteProgram'); },
    deleteTexture: () => {},
    texParameteri: (_target, pname, value) => { calls.texParameteri.push([pname, value]); },
    uniform1f: (name, value) => { calls.seq.push(['u1f', name, value]); },
    uniform4f: (name, a, b, c, d) => { calls.seq.push(['u4f', name, [a, b, c, d]]); },
    drawArrays: () => { calls.seq.push(['draw']); },
  };
  const gl = new Proxy(overrides, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && /^[A-Z][A-Z0-9_]*$/.test(prop)) return 1;
      return () => {};
    },
  });
  return { gl, calls };
}

function fakeCanvas(gl) {
  const listeners = [];
  return {
    width: 100,
    height: 100,
    style: {},
    listeners,
    getContext: () => gl,
    addEventListener: (type) => { listeners.push(type); },
    removeEventListener: (type) => {
      const at = listeners.indexOf(type);
      if (at >= 0) listeners.splice(at, 1);
    },
  };
}

// cardStage loads its images through `new Image()`; node has no DOM. The fake records the src and never fires
// load, so the entries stay on the 1x1 placeholder - the assertions only observe the GL state set on creation.
function withFakeImage(fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'Image');
  const previous = globalThis.Image;
  globalThis.Image = class FakeImage {
    set src(value) { this.currentSrc = String(value); }

    get src() { return this.currentSrc; }
  };
  try {
    return fn();
  } finally {
    if (had) globalThis.Image = previous;
    else delete globalThis.Image;
  }
}

function makeStage({ attribs, withLose, linkFails, records = [], particles = null, card = null, expectStage = true } = {}) {
  const { gl, calls } = fakeGl({ attribs, withLose, linkFails });
  const canvas = fakeCanvas(gl);
  const stage = create(canvas, { size: [157, 207], ...(card || {}) }, { order: () => records }, {
    search: '',
    particles,
    cardTime: () => 0,
    particleTime: () => 0,
  });
  if (expectStage) assert.ok(stage, 'the stage was created');
  return { stage, calls, canvas };
}

test('a dropped vertex attribute is never enabled, including after the particle pass', () => {
  const node = { name: 'fx_loop' };
  const record = { active: true, node, abs: { x: 0, y: 0, w: 10, h: 10 }, pose: {} };
  let particleDraws = 0;
  const particles = {
    create: () => ({
      has: (n) => n === node,
      advance: () => {},
      draw: () => { particleDraws += 1; },
      aliveCount: () => 0,
      destroy: () => {},
    }),
  };
  // The VERT shader reads only aUV, so a linked program reports aPos as -1.
  const { stage, calls } = makeStage({ attribs: { aPos: -1, aUV: 0 }, records: [record], particles });
  assert.deepEqual(calls.enabled, [0], 'set-up enables only the attribute that survived linking');

  stage.draw(0);

  assert.equal(particleDraws, 1, 'the particle pass drew the node');
  assert.deepEqual(calls.enabled, [0, 0, 0], 'draw re-enables aUV once per pass, including after particles');
  assert.deepEqual(calls.pointers, [0, 0, 0]);
  assert.ok(!calls.enabled.includes(-1), 'the dropped attribute (-1) is never passed to the GL');
});

test('destroy releases the context exactly once, after the deletes', () => {
  const { stage, calls, canvas } = makeStage();
  assert.equal(calls.loses, 0, 'creating the stage does not lose the context');
  assert.ok(calls.log.includes('getExtension:WEBGL_lose_context'),
    'the extension is grabbed while the context is still alive');
  assert.deepEqual(canvas.listeners, ['webglcontextlost'], 'the stage listens for a lost context');

  stage.destroy();

  assert.equal(calls.loses, 1, 'destroy loses the context once');
  const deleteAt = calls.log.indexOf('deleteBuffer');
  const loseAt = calls.log.indexOf('loseContext');
  assert.ok(deleteAt >= 0, 'the quad buffer was deleted');
  assert.ok(loseAt > deleteAt, 'the context is lost only after the GL objects are deleted');
  assert.deepEqual(canvas.listeners, [], 'the lost-context listener is dropped');

  stage.destroy();

  assert.equal(calls.loses, 1, 'a repeated destroy does not lose it again');
});

test('a context that offers no WEBGL_lose_context still destroys cleanly', () => {
  const { stage, calls } = makeStage({ withLose: false });
  stage.destroy();
  stage.destroy();
  assert.equal(calls.loses, 0);
  assert.ok(calls.log.includes('deleteBuffer'), 'the GL objects are still deleted');
});

// A failed create() used to return null with the context still alive and the listener still attached: the host
// builds a fresh canvas per mount, so every failed mount kept one WebGL context against the per-page limit.
test('a failed link releases the context and the listener', () => {
  const { stage, calls, canvas } = makeStage({ linkFails: true, expectStage: false });
  assert.equal(stage, null, 'create() gave up');
  assert.equal(calls.loses, 1, 'the context was released through WEBGL_lose_context');
  assert.deepEqual(canvas.listeners, [], 'the lost-context listener was dropped');
  assert.equal(calls.log.filter((entry) => entry === 'deleteProgram').length, 1, 'the half-linked program was deleted');
  assert.equal(calls.log.filter((entry) => entry === 'loseContext').length, 1, 'and the release ran exactly once');
});

test('a compile failure releases the context too, without a lose extension', () => {
  const { gl, calls } = fakeGl({ withLose: false });
  gl.compileShader = () => {};
  gl.getShaderParameter = () => false;
  const canvas = fakeCanvas(gl);
  const stage = create(canvas, { size: [157, 207] }, { order: () => [] }, { search: '' });
  assert.equal(stage, null, 'create() gave up');
  assert.deepEqual(canvas.listeners, [], 'the listener was dropped');
  assert.ok(calls.log.includes('getExtension:WEBGL_lose_context'),
    'the extension was still looked up, so an available one would be used');
});

// A record's TextureSettings decide the sampler state (the official UV maths does not wrap, so the wrap is the
// texture's own), and the sampling has to be part of the texture cache key.
test('a texture record carries its wrap/filter into the GL state', () => {
  const record = {
    active: true,
    node: { name: 'pic', image: { file: 'sprite.png', color: '#FFFFFF', wrapU: 0, wrapV: 2, filter: 0 } },
    abs: { x: 0, y: 0, w: 10, h: 10 },
    pose: {},
  };
  withFakeImage(() => {
    const { stage, calls } = makeStage({ records: [record] });
    stage.draw(0);
    assert.equal(stage.textures.size, 1, 'the sprite texture was cached');
    assert.deepEqual(calls.texParameteri, [
      [ENUM.TEXTURE_WRAP_S, ENUM.REPEAT],
      [ENUM.TEXTURE_WRAP_T, ENUM.MIRRORED_REPEAT],
      [ENUM.TEXTURE_MIN_FILTER, ENUM.NEAREST],
      [ENUM.TEXTURE_MAG_FILTER, ENUM.NEAREST],
    ]);
    stage.destroy();
  });
});

test('a record without TextureSettings keeps CLAMP_TO_EDGE/LINEAR and the bare URL as its cache key', () => {
  const plain = {
    active: true,
    node: { name: 'a', image: { file: 'plain.png', color: '#FFFFFF' } },
    abs: { x: 0, y: 0, w: 10, h: 10 },
    pose: {},
  };
  const wrapped = {
    active: true,
    node: { name: 'b', image: { file: 'plain.png', color: '#FFFFFF', wrapU: 0 } },
    abs: { x: 0, y: 20, w: 10, h: 10 },
    pose: {},
  };
  withFakeImage(() => {
    const { stage, calls } = makeStage({ records: [plain, wrapped] });
    stage.draw(0);
    assert.deepEqual(calls.texParameteri.slice(0, 4), [
      [ENUM.TEXTURE_WRAP_S, ENUM.CLAMP_TO_EDGE],
      [ENUM.TEXTURE_WRAP_T, ENUM.CLAMP_TO_EDGE],
      [ENUM.TEXTURE_MIN_FILTER, ENUM.LINEAR],
      [ENUM.TEXTURE_MAG_FILTER, ENUM.LINEAR],
    ], 'a missing field is "not read", not Repeat');
    assert.ok(stage.textures.has('plain.png'), 'textures.get(url) still resolves a plain record');
    assert.equal(stage.textures.size, 2, 'a different sampling is a different cache entry');
    assert.deepEqual(calls.texParameteri.slice(4), [
      [ENUM.TEXTURE_WRAP_S, ENUM.REPEAT],
      [ENUM.TEXTURE_WRAP_T, ENUM.CLAMP_TO_EDGE],
      [ENUM.TEXTURE_MIN_FILTER, ENUM.LINEAR],
      [ENUM.TEXTURE_MAG_FILTER, ENUM.LINEAR],
    ], 'the same file with a different wrap gets its own texture');
    stage.destroy();
  });
});

// The per-record uniform reset must cover uRawFlipV (only the material branch and the external quad write it),
// and the tint steps mutate one array instead of reassigning it - both were changed in the same pass over the
// draw loop, so pin the resulting uniform values.
test('the per-record uniforms are reset and the AlphaBlend tint is applied once', () => {
  const sweep = {
    active: true,
    rawUv: true,
    node: {
      name: 'sweep1',
      path: 'card/group_upgrade/group_normal/fx_upgrade/sweep1',
      raw: { mat: 'm_sweep' },
    },
    abs: { x: 0, y: 0, w: 10, h: 10 },
    pose: {},
  };
  const rawImage = {
    active: true,
    rawUv: true,
    node: { name: 'raw_pic', raw: {}, image: { file: 'plain.png', color: '#FFFFFF' } },
    abs: { x: 0, y: 20, w: 10, h: 10 },
    pose: {},
  };
  const card = {
    materials: {
      m_sweep: { shader: 'Torappu/UI/AlphaBlend', draw: {}, colors: { _TintColor: [0.25, 0.5, 0.5, 1] } },
    },
  };
  withFakeImage(() => {
    const { stage, calls } = makeStage({ records: [sweep, rawImage], card });
    stage.draw(0);
    const draws = [];
    calls.seq.forEach((entry, index) => { if (entry[0] === 'draw') draws.push(index); });
    assert.equal(draws.length, 2, 'both records drew');
    const lastBefore = (name, limit) => {
      let found = null;
      for (let i = 0; i < limit; i += 1) if (calls.seq[i][1] === name) found = calls.seq[i];
      return found;
    };
    assert.deepEqual(lastBefore('uRawFlipV', draws[0]), ['u1f', 'uRawFlipV', 1],
      'the confirm sweep is the raw-UV, V-flipped case');
    assert.deepEqual(lastBefore('uRawFlipV', draws[1]), ['u1f', 'uRawFlipV', 0],
      'the next record does not inherit the flip');
    // 2 x tex x vColor x _TintColor.rgb, applied exactly once: white vColor * 2 * [0.25,0.5,0.5] = [0.5,1,1].
    assert.deepEqual(lastBefore('uTint', draws[0])[2], [0.5, 1, 1, 1]);
    stage.destroy();
  });
});
