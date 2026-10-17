// test/ui/audio-proj.test.js — a content pack's projectile launch sound (audio.sfx.proj).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { projSfxUrl } from '../../public/js/audio.js';

const URL1 = '/assets/audio/sfx/note/born.mp3';
const URL2 = '/assets/audio/sfx/note/hit.mp3';
const manifest = {
  audio: {
    sfx: {
      proj: {
        note: URL1,
        noteSkill: { born: URL1, hit: URL2 },
        shared: { born: URL1, units: { char_4182_oblvns: { born: URL2 } } },
      },
    },
  },
};

test('the short string form is the launch sound of the kind', () => {
  assert.equal(projSfxUrl(manifest, 'note'), URL1);
  // and only that: an impact sound has to be stated, it is never borrowed from the launch
  assert.equal(projSfxUrl(manifest, 'note', 'hit'), null);
});

test('the object form states a role of its own', () => {
  assert.equal(projSfxUrl(manifest, 'noteSkill', 'born'), URL1);
  assert.equal(projSfxUrl(manifest, 'noteSkill', 'hit'), URL2);
  assert.equal(projSfxUrl(manifest, 'noteSkill', 'die'), null);
});

test('a per-unit entry wins over the kind, like sfx.units does', () => {
  assert.equal(projSfxUrl(manifest, 'shared', 'born', 'char_4182_oblvns'), URL2);
  assert.equal(projSfxUrl(manifest, 'shared', 'born', 'char_290_vigna'), URL1);
  assert.equal(projSfxUrl(manifest, 'shared', 'born'), URL1);
});

test('a kind with no sound, or a junk manifest, is silent', () => {
  assert.equal(projSfxUrl(manifest, 'arrow'), null);
  assert.equal(projSfxUrl(manifest, ''), null);
  assert.equal(projSfxUrl(null, 'note'), null);
  assert.equal(projSfxUrl({}, 'note'), null);
  assert.equal(projSfxUrl({ audio: { sfx: { proj: { note: { born: 42 } } } } }, 'note'), null);
});
