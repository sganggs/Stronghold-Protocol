// Asset URL helpers (public/js/ui/assetUrls.js) against the real manifest: every visible chess resolves its
// avatar and portrait (normal + golden), bonds / bands / items / enemies / factions / titles resolve, and
// nothing outside the manifest is ever returned.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  uiUrl, chessAvatarUrl, chessPortraitUrl, skillIconUrl, profIconUrl, subProfIconUrl, bondIconUrl, bandIconUrl, itemIconUrl,
  enemyIconUrl, tokenAvatarUrl, factionIconUrl, titleIconUrl, effectIconUrl,
} from '../../public/js/ui/assetUrls.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const m = load('assets.json');
const chess = load('chess.json');

function manifestUrls(obj, out = new Set()) {
  if (typeof obj === 'string' && obj.startsWith('/assets/')) out.add(obj);
  else if (obj && typeof obj === 'object') for (const v of Object.values(obj)) manifestUrls(v, out);
  return out;
}
const ALL = manifestUrls(m);
const inManifest = (u) => u == null || ALL.has(u);

describe('assetUrls', () => {
  test('every visible chess (normal + golden) has avatar, portrait and skill icon', () => {
    let n = 0;
    for (const c of Object.values(chess)) {
      if (!c.charId || c.isDiy) continue;
      const a = chessAvatarUrl(m, c);
      const p = chessPortraitUrl(m, c);
      assert.ok(a && inManifest(a), `avatar ${c.chessId}`);
      assert.ok(p && inManifest(p), `portrait ${c.chessId}`);
      assert.ok(inManifest(skillIconUrl(m, c)), `skill ${c.chessId}`);
      assert.ok(inManifest(profIconUrl(m, c.profession)));
      assert.ok(inManifest(subProfIconUrl(m, c)));
      n++;
    }
    assert.ok(n >= 200);
    const golden = Object.values(chess).find((c) => c.isGolden && m.chars[c.charId]?.avatarE2);
    assert.equal(chessAvatarUrl(m, golden), m.chars[golden.charId].avatarE2, 'golden uses E2 art');
  });
  test('a golden character key uses portraitE2 and avatarE2; a portrait-only entry keeps its URL', () => {
    const whitw2 = m.chars.char_1038_whitw2;
    const inside = m.chars.char_498_inside;
    const manifest = { chars: {
      plugin_1: { portrait: '/assets/char/portrait/plugin_1.png', portraitE2: '/assets/char/portrait/plugin_2.png', avatar: '/assets/char/avatar/plugin_1.png', avatarE2: '/assets/char/avatar/plugin_2.png' },
      custom_portrait: { portrait: '/custom.png' },
      gold_art: { portrait: '/gold.png', avatar: '/gold-a.png' },
      char_1038_whitw2: whitw2,
      char_498_inside: inside,
    } };
    const piece = (id, isGolden) => ({ isGolden, charId: id, assets: { portrait: id, avatar: id } });
    assert.equal(chessPortraitUrl(manifest, piece('plugin_1', true)), '/assets/char/portrait/plugin_2.png');
    assert.equal(chessPortraitUrl(manifest, piece('plugin_1', false)), '/assets/char/portrait/plugin_1.png');
    assert.equal(chessAvatarUrl(manifest, piece('plugin_1', true)), '/assets/char/avatar/plugin_2.png');
    assert.equal(chessAvatarUrl(manifest, piece('plugin_1', false)), '/assets/char/avatar/plugin_1.png');
    assert.equal(chessPortraitUrl(manifest, piece('custom_portrait', true)), '/custom.png', 'golden without portraitE2');
    assert.equal(chessPortraitUrl(manifest, { isGolden: true, assets: { portrait: 'gold_art' } }), '/gold.png', 'custom golden portrait URL');
    assert.equal(chessAvatarUrl(manifest, { isGolden: true, assets: { avatar: 'gold_art' } }), '/gold-a.png');
    assert.equal(chessPortraitUrl(manifest, piece('char_1038_whitw2', true)), whitw2.portraitE2);
    assert.equal(chessPortraitUrl(manifest, piece('char_498_inside', true)), inside.portraitE2);
    assert.equal(chessPortraitUrl(manifest, piece('char_498_inside', false)), inside.portrait);
    assert.equal(chessAvatarUrl(manifest, piece('char_498_inside', true)), inside.avatarE2);
    let official = 0;
    for (const c of Object.values(chess)) {
      if (!c.charId || c.isDiy) continue;
      official++;
      const portraitId = c.assets?.portrait;
      assert.equal(m.chars[portraitId], undefined, `${c.chessId}: portrait id is not a character key`);
      if (String(portraitId).endsWith('_2')) {
        const base = m.chars[portraitId.slice(0, -2)];
        assert.equal(chessPortraitUrl(m, c), base.portraitE2 || base.portrait, c.chessId);
      } else if (String(portraitId).endsWith('_1')) {
        assert.equal(chessPortraitUrl(m, c), m.chars[portraitId.slice(0, -2)].portrait, c.chessId);
      }
    }
    assert.equal(official, 258);
  });
  test('bonds, bands, items, enemies, tokens, factions, titles, effects', () => {
    for (const id of Object.keys(load('bonds.json'))) assert.ok(bondIconUrl(m, id), id);
    for (const id of Object.keys(load('bands.json'))) assert.ok(bandIconUrl(m, id), id);
    for (const it of Object.values(load('items.json'))) assert.ok(inManifest(itemIconUrl(m, it)), it.id);
    assert.ok(itemIconUrl(m, Object.values(load('items.json'))[0]));
    const enemies = load('enemies.json');
    let found = 0;
    for (const k of Object.keys(enemies)) { const u = enemyIconUrl(m, k); assert.ok(inManifest(u), k); if (u) found++; }
    assert.ok(found > Object.keys(enemies).length * 0.9);
    for (const t of Object.values(load('factions.json').types)) assert.ok(factionIconUrl(m, t.icon), t.type);
    for (const t of load('config.json').titles) assert.ok(titleIconUrl(m, t.picId), t.id);
    assert.ok(tokenAvatarUrl(m, 'token_10028_vigil_wolf'));
    assert.ok(effectIconUrl(m, { iconKind: 'team' }));
    assert.ok(effectIconUrl(m, { iconKind: 'choice' }));
    assert.ok(effectIconUrl(m, { iconKind: 'band', iconId: 'band_bldsk' }));
    assert.ok(effectIconUrl(m, { iconKind: 'garrison' }));
    assert.equal(effectIconUrl(m, { iconKind: 'x' }), null);
    assert.ok(uiUrl(m, 'hudPanel/icon_hp'));
  });
  test('missing manifest / ids ⇒ null, never throws', () => {
    for (const fn of [chessAvatarUrl, chessPortraitUrl, skillIconUrl, subProfIconUrl, itemIconUrl]) {
      assert.equal(fn(null, null), null);
      assert.equal(fn(m, { assets: {} }) ?? null, fn === skillIconUrl ? uiUrl(m, 'skillIcon/empty') : null);
    }
    assert.equal(bondIconUrl(m, 'nope'), null);
    assert.equal(bandIconUrl(null, 'band_bldsk'), null);
    assert.equal(enemyIconUrl(m, 'enemy_nope'), null);
    assert.equal(profIconUrl(m, 'NOPE'), null);
    assert.equal(uiUrl(undefined, 'x'), null);
    assert.equal(tokenAvatarUrl(m, null), null);
  });
});
