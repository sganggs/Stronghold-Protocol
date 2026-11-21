// test/ui/shop-card-stage.test.js — the card stage's two safety rules around the WebGL context:
// 1. an attribute the linked program dropped (getAttribLocation returns -1) is never enabled — Chrome answers
//    enableVertexAttribArray(-1) with INVALID_VALUE on every draw until it gives up on the context;
// 2. destroy() hands the context back through WEBGL_lose_context exactly once, and only after the deletes:
//    delete* on a lost context is a no-op, so losing first would leave every GPU object to the browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { create } from '../../public/js/render/shop/cardStage.js';

// The stage touches most of the WebGL2 surface. This fake answers an all-caps property with 1 (the enums),
// every other function with a no-op, and overrides the few calls the two rules observe.
function fakeGl({ attribs = {}, withLose = true } = {}) {
  const calls = { enabled: [], pointers: [], loses: 0, log: [] };
  const loseContextExt = withLose
    ? { loseContext: () => { calls.loses += 1; calls.log.push('loseContext'); } }
    : null;
  const overrides = {
    getAttribLocation: (_program, name) => (name in attribs ? attribs[name] : 0),
    enableVertexAttribArray: (location) => { calls.enabled.push(location); },
    vertexAttribPointer: (location) => { calls.pointers.push(location); },
    getExtension: (name) => {
      calls.log.push(`getExtension:${name}`);
      return name === 'WEBGL_lose_context' ? loseContextExt : null;
    },
    getParameter: () => 4096,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    isContextLost: () => false,
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    createTexture: () => ({}),
    deleteBuffer: () => { calls.log.push('deleteBuffer'); },
    deleteProgram: () => { calls.log.push('deleteProgram'); },
    deleteTexture: () => {},
    drawArrays: () => {},
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

function makeStage({ attribs, withLose, records = [], particles = null } = {}) {
  const { gl, calls } = fakeGl({ attribs, withLose });
  const canvas = fakeCanvas(gl);
  const stage = create(canvas, { size: [157, 207] }, { order: () => records }, {
    search: '',
    particles,
    cardTime: () => 0,
    particleTime: () => 0,
  });
  assert.ok(stage, 'the stage was created');
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
