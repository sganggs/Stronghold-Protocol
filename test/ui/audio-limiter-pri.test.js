// test/ui/audio-limiter-pri.test.js — SFX priority (SFX_PRI) and popOldest in SfxLimiter.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SfxLimiter, SFX_PRI } from '../../public/js/audio.js';

const lim = (o = {}) => new SfxLimiter({ unitCooldownMs: 0, urlGapMs: 0, maxPerUrl: 99, ...o });

/** Attach an ender to every voice, so an eviction shows up as its token in the returned array. */
const watch = (L) => {
  const ended = [];
  for (const [t, v] of L.voices) v.end = () => ended.push(t);
  return ended;
};

test('the tiers are ordered event < unit < deco', () => {
  assert.ok(SFX_PRI.event < SFX_PRI.unit);
  assert.ok(SFX_PRI.unit < SFX_PRI.deco);
});

test('a full cap refuses a same-tier sound and lets a better tier take the oldest voice', () => {
  const L = lim({ maxVoices: 2 });
  assert.equal(L.tryAcquire(0, 'a', '/a.mp3', SFX_PRI.unit), true);
  assert.equal(L.tryAcquire(0, 'b', '/b.mp3', SFX_PRI.unit), true);
  const ended = watch(L);
  // the crowd is full: another ordinary sound is refused, never queued
  assert.equal(L.tryAcquire(0, 'c', '/c.mp3', SFX_PRI.unit), false);
  assert.equal(L.active, 2);
  // an event sound (a skill's activation, a death) takes the oldest voice instead
  assert.equal(L.tryAcquire(0, 'd', '/d.mp3', SFX_PRI.event), true);
  assert.equal(L.active, 2);                    // the cap is honoured: one in, one out
  assert.equal(ended.length, 1);                // the displaced voice was told to end
  assert.equal(L.alive(L.lastToken), true);     // and the new one owns its slot
});

test('a displaced voice never starts late: alive() is false and its release is a no-op', () => {
  const L = lim({ maxVoices: 1 });
  assert.equal(L.tryAcquire(0, 'a', '/a.mp3', SFX_PRI.deco), true);
  const old = L.lastToken;
  watch(L);
  assert.equal(L.tryAcquire(0, 'b', '/b.mp3', SFX_PRI.event), true);
  assert.equal(L.alive(old), false);
  // the sound whose buffer had not decoded yet gives up: releasing the dead token must not free the new voice
  L.release('/a.mp3', old);
  assert.equal(L.alive(L.lastToken), true);
  assert.equal(L.active, 1);
});

test('release by token frees the slot exactly once', () => {
  const L = lim({ maxVoices: 1 });
  assert.equal(L.tryAcquire(0, 'a', '/a.mp3'), true);
  const t = L.lastToken;
  L.release('/a.mp3', t);
  assert.equal(L.active, 0);
  assert.equal(L.alive(t), false);
  L.release('/a.mp3', t);                       // second release: no-op
  assert.equal(L.active, 0);
  // a legacy call without a token still frees a slot (older callers)
  assert.equal(L.tryAcquire(0, 'b', '/b.mp3'), true);
  L.release('/b.mp3');
  assert.equal(L.active, 0);
});

test('the per-url cap also yields to a strictly better tier only', () => {
  const L = lim({ maxVoices: 8, maxPerUrl: 1 });
  assert.equal(L.tryAcquire(0, 'a', '/same.mp3', SFX_PRI.deco), true);
  watch(L);
  // a second copy at the same tier is refused (the official maxSoundAllowed 2 is a bank property, not a mood)
  assert.equal(L.tryAcquire(0, 'b', '/same.mp3', SFX_PRI.deco), false);
  // ... but an event-tier copy of the same file takes over
  assert.equal(L.tryAcquire(0, 'c', '/same.mp3', SFX_PRI.event), true);
  assert.equal(L.activeByUrl.get('/same.mp3'), 1);
});

test('the default tier is the event tier, so an unaware caller is never starved', () => {
  const L = lim({ maxVoices: 1 });
  assert.equal(L.tryAcquire(0, 'a', '/a.mp3', SFX_PRI.deco), true);
  assert.equal(L.tryAcquire(0, 'b', '/b.mp3'), true);   // no pri argument
  assert.equal(L.active, 1);
});

test('a request the per-unit cooldown refuses never evicts a voice', () => {
  // one voice of decoration holds the only slot; a unit sound comes back too soon for its own cooldown
  const L = new SfxLimiter({ maxVoices: 1, unitCooldownMs: 400, urlGapMs: 0, maxPerUrl: 99 });
  assert.equal(L.tryAcquire(0, 'crowd', '/a.mp3', SFX_PRI.deco), true);
  const ended = watch(L);
  assert.equal(L.tryAcquire(100, 'hero', '/b.mp3', SFX_PRI.event), true);   // hero takes the slot
  // 100 ms later the same hero tries again: refused by the cooldown, and nothing is taken away for it
  assert.equal(L.tryAcquire(200, 'hero', '/c.mp3', SFX_PRI.event), false);
  assert.equal(ended.length, 1);                 // only the crowd's eviction, not a second one
  assert.equal(L.active, 1);
  assert.equal(L.lastToken, 0);                  // the refused call granted nothing
});
