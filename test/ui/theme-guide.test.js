// docs/THEME-GUIDE.md and its example pack docs/examples/ui-theme-demo (§37.234): the pack imports whole (every key it
// writes used, nothing refused, no stray file), its Spine files belong together, and the guide names every colour key,
// image slot, banner and voice trigger the client accepts — a new slot without a line in the guide fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BANNER_KEYS, COLOR_KEYS, UNWIRED_IMAGE_SLOTS, VOICE_TRIGGERS, WIRED_IMAGE_SLOTS, assessTheme,
} from '../../shared/uiTheme.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DEMO = join(ROOT, 'docs/examples/ui-theme-demo');
const GUIDE = readFileSync(join(ROOT, 'docs/THEME-GUIDE.md'), 'utf8');

function walk(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

/** Width and height from a PNG or WebP header (what the browser's decode measures on import). */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { width: 1 + (b & 0x3fff), height: 1 + ((b >>> 14) & 0x3fff) }; }
    if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

test('the example pack imports whole: every key it writes is used, nothing refused, no stray file', () => {
  const jsonText = readFileSync(join(DEMO, 'theme.json'), 'utf8');
  const files = walk(DEMO).filter((f) => f !== 'theme.json').map((path) => {
    const buf = readFileSync(join(DEMO, path));
    const dim = /\.(png|webp)$/i.test(path) ? imageSize(buf) : null;
    if (/\.(png|webp)$/i.test(path)) assert.ok(dim, `${path}: a readable image header`);
    return dim ? { path, size: buf.length, ...dim, measured: true } : { path, size: buf.length };
  });
  const r = assessTheme({ jsonText, files });
  assert.equal(r.ok, true, r.code);
  assert.equal(r.id, 'neon-dusk-demo');
  assert.deepEqual(r.refused, []);
  assert.deepEqual(r.ignored, [], 'every file of the example is named by theme.json');
  assert.deepEqual(r.unused.images, []);
  assert.deepEqual(r.unused.banners, []);
  assert.deepEqual(r.unused.keys, []);
  assert.deepEqual(Object.keys(r.images).sort(), ['chess_frame_normal', 'countdown', 'hud_player_info', 'prep_ready', 'shop_main']);
  assert.deepEqual(r.images.prep_ready.slice, [16, 16, 16, 16]);
  assert.deepEqual(Object.keys(r.banners).sort(), ['battleEnd', 'coop']);
  assert.deepEqual(r.character.spine, { skel: 'character/neon.json', atlas: 'character/neon.atlas', textures: ['character/neon.png'] });
  const total = files.reduce((n, f) => n + f.size, 0);
  assert.ok(total < 64 * 1024, `the example stays small (${total} bytes)`);
});

test('the example Spine: a 3.8 skeleton with Idle / Happy / Talk, every attachment a region of its atlas page', () => {
  const skel = JSON.parse(readFileSync(join(DEMO, 'character/neon.json'), 'utf8'));
  // either line ending: .gitattributes keeps atlases LF, but an author's own pack may come from Windows (pixi-spine reads both)
  const atlas = readFileSync(join(DEMO, 'character/neon.atlas'), 'utf8').split(/\r?\n/);
  assert.match(skel.skeleton.spine, /^3\.8\./);
  assert.deepEqual(Object.keys(skel.animations).sort(), ['Happy', 'Idle', 'Talk']);
  assert.equal(atlas.find((l) => l.trim()), 'neon.png', 'the page is the texture theme.json lists');
  const regions = new Set(atlas.filter((l) => l && !l.startsWith(' ') && !l.includes(':') && !l.endsWith('.png')));
  for (const skin of skel.skins) {
    for (const [slot, byName] of Object.entries(skin.attachments)) {
      for (const name of Object.keys(byName)) assert.ok(regions.has(name), `${slot}/${name}: a region of neon.atlas`);
    }
  }
  const bones = new Set(skel.bones.map((b) => b.name));
  for (const slot of skel.slots) assert.ok(bones.has(slot.bone), `slot ${slot.name} hangs on a bone`);
  for (const anim of Object.values(skel.animations)) for (const bone of Object.keys(anim.bones || {})) assert.ok(bones.has(bone));
});

test('the guide names every colour key, image slot, banner and voice trigger the client accepts', () => {
  const named = (key) => {
    if (GUIDE.includes(`\`${key}\``)) return true;
    const range = /^(.*_)\d$/.exec(key); // shop_level_3 → `shop_level_1` … `shop_level_6`
    return !!range && GUIDE.includes(`\`${range[1]}1\``) && GUIDE.includes(`\`${range[1]}6\``);
  };
  const keys = [...COLOR_KEYS, ...WIRED_IMAGE_SLOTS, ...UNWIRED_IMAGE_SLOTS, ...BANNER_KEYS, ...Object.keys(VOICE_TRIGGERS)];
  const missing = keys.filter((k) => !named(k));
  assert.deepEqual(missing, [], 'docs/THEME-GUIDE.md lists them (update its tables with docs/THEMES.md)');
  assert.ok(GUIDE.includes('](examples/ui-theme-demo/theme.json)'), 'the guide links its example pack');
});
