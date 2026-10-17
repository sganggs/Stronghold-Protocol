// test/render/projlook.test.js — content-owned projectile looks (public/js/render/fx/projlook.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PROJ } from '../../public/js/render/style.js';
import { FALLBACK, mergeProjSpec, projSpec } from '../../public/js/render/fx/projlook.js';

test('a pack describes a kind the built-in table does not know', () => {
  const spec = projSpec('note', { fx: { proj: { note: { look: 'orb', tint: 0xffd7a0, glow: 0xffad3d, head: 0.5 } } } });
  assert.ok(spec);
  assert.equal(spec.look, 'orb');
  assert.equal(spec.tint, 0xffd7a0);
  assert.equal(spec.glow, 0xffad3d);
  assert.equal(spec.head, 0.5);
  // everything the pack did not state comes from the fallback, never from "undefined"
  assert.equal(spec.speed, FALLBACK.speed);
  assert.equal(spec.width, FALLBACK.width);
  assert.equal(spec.hit, 'spark');
});

test('a built-in kind keeps every value the pack does not override', () => {
  const spec = projSpec('arrow', { fx: { proj: { arrow: { tint: 0x112233 } } } });
  assert.equal(spec.tint, 0x112233);
  for (const k of Object.keys(PROJ.arrow)) if (k !== 'tint') assert.deepEqual(spec[k], PROJ.arrow[k], k);
});

test('a kind nobody describes is still no look at all', () => {
  assert.equal(projSpec('nope', null), null);
  assert.equal(projSpec('nope', { fx: { proj: {} } }), null);
  assert.equal(projSpec('', { fx: { proj: { '': { tint: 1 } } } }), null);
});

test('junk in the manifest keeps the stock look instead of breaking it', () => {
  const base = PROJ.arrow;
  assert.equal(mergeProjSpec(base, null), base);
  assert.equal(mergeProjSpec(base, 'nope'), base);
  assert.equal(mergeProjSpec(base, []), base);
  assert.equal(mergeProjSpec(base, { look: 'laser' }).look, base.look);      // unknown look
  assert.equal(mergeProjSpec(base, { hit: 'nuke' }).hit, base.hit);         // unknown arrival
  assert.equal(mergeProjSpec(base, { speed: 0 }).speed, base.speed);        // below the range
  assert.equal(mergeProjSpec(base, { speed: 9999 }).speed, base.speed);     // above it
  assert.equal(mergeProjSpec(base, { speed: Number.NaN }).speed, base.speed);
  assert.equal(mergeProjSpec(base, { width: -1 }).width, base.width);
  assert.equal(mergeProjSpec(base, { tint: 0x1000000 }).tint, base.tint);   // not a 24-bit colour
  assert.equal(mergeProjSpec(base, { tint: 'red' }).tint, base.tint);
  assert.equal(mergeProjSpec(base, { once: 'yes' }).once, base.once);
});

test('a stated value wins, including once and a colour given as a float', () => {
  const spec = mergeProjSpec(PROJ.arrow, { once: true, tint: 18.4, speed: 9.5 });
  assert.equal(spec.once, true);
  assert.equal(spec.tint, 18);
  assert.equal(spec.speed, 9.5);
});

test('the built-in table is never mutated', () => {
  const before = JSON.stringify(PROJ);
  projSpec('arrow', { fx: { proj: { arrow: { tint: 1, speed: 2 } } } });
  projSpec('note', { fx: { proj: { note: { tint: 1 } } } });
  assert.equal(JSON.stringify(PROJ), before);
});
