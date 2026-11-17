import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { ItemView } from '../../public/js/render/units.js';
import { itemTexture } from '../../public/js/render/textures.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../../data/${name}.json`, import.meta.url)));
const manifest = load('assets');
const current = load('items');
const previous = load('versions/act1autochess/items');
const urlOf = (item) => manifest.items[item.iconId];
const tick = () => new Promise(resolve => setImmediate(resolve));

test('every reused item ID with different art keeps separate bench textures in both switch directions', async () => {
  const fake = installFakePixi();
  const image = async () => ({ width: 128, height: 128 });
  const ctx = fakeViewCtx(fake.P, { assets: { image } });
  let compared = 0;
  try {
    for (const [id, old] of Object.entries(previous)) {
      const next = current[id];
      if (!next || urlOf(old) === urlOf(next)) continue;
      assert.ok(urlOf(old) && urlOf(next), id);
      const view = (it) => new ItemView(ctx, { id, defId: id, icon: urlOf(it), color: 0x9aa5a0 });
      const a = view(old), b = view(next), again = view(old);
      await tick();
      assert.notEqual(a.plate.texture, b.plate.texture, `${id}: ${old.name} → ${next.name}`);
      assert.equal(a.plate.texture, again.plate.texture, `${id}: returning reuses only the same art`);
      for (const v of [a, b, again]) v.destroy();
      compared++;
    }
    assert.ok(compared > 20, `${compared} reused IDs checked`);
  } finally { fake.restore(); }
});

test('item textures key by icon URL, load state and frame colour; aliases can share art', async () => {
  const fake = installFakePixi();
  try {
    const img = { width: 128, height: 128 };
    const a = itemTexture('/first.png', img, 0xffffff);
    assert.equal(a, itemTexture('/first.png', img, 0xffffff));
    assert.notEqual(a, itemTexture('/second.png', img, 0xffffff));
    assert.notEqual(a, itemTexture('/first.png', null, 0xffffff));
    assert.notEqual(a, itemTexture('/first.png', img, 0xffc600));
    const ctx = fakeViewCtx(fake.P, { assets: { image: async () => img } });
    const first = new ItemView(ctx, { id: 'one', defId: 'one', icon: '/alias.png', color: 0xffffff });
    const second = new ItemView(ctx, { id: 'two', defId: 'two', icon: '/alias.png', color: 0xffffff });
    await tick();
    assert.equal(first.plate.texture, second.plate.texture, 'IDs do not partition identical art');
    first.destroy(); second.destroy();
  } finally { fake.restore(); }
});

test('a changed or removed item icon supersedes pending art, and destroyed views ignore late loads', async () => {
  const fake = installFakePixi();
  const pending = new Map();
  try {
    const ctx = fakeViewCtx(fake.P, { assets: { image: url => new Promise(resolve => pending.set(url, resolve)) } });
    const v = new ItemView(ctx, { id: 1, defId: 'same-item', icon: '/old.png', color: 0xffffff });
    v.setIcon('/new.png');
    pending.get('/new.png')({ width: 128, height: 128 });
    await tick();
    const current = v.plate.texture;
    pending.get('/old.png')({ width: 128, height: 128 });
    await tick();
    assert.equal(v.plate.texture, current, 'late old art is ignored');
    v.setIcon(null);
    assert.notEqual(v.plate.texture, current, 'no stale icon when its manifest entry disappears');
    assert.equal(v.info.icon, null);
    v.setIcon('/late.png');
    const placeholder = v.plate.texture;
    v.destroy();
    pending.get('/late.png')({ width: 128, height: 128 });
    await tick();
    assert.equal(v.plate.texture, placeholder);
  } finally { fake.restore(); }
});
