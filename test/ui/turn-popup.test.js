// 机变 shared-turn cue ownership, renderer fallback, timing bounds and the generic disc's CSS contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packBanners } from '../../public/js/ui/prefab/banners.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const P = await import('../../public/js/ui/turnPopup.js');

test('generic disc uses only the official effectChoose sprites and stays absent without loaded art', () => {
  const ui = JSON.parse(read('data/assets.json')).ui;
  const js = read('public/js/ui/turnPopup.js');
  const keys = js.match(/const ART = \[([^\]]+)\]/)[1].match(/'([A-Za-z_0-9/]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(keys.sort(), ['effectChoose/bg_circle', 'effectChoose/bottom', 'effectChoose/plus', 'effectChoose/square_1', 'effectChoose/square_2']);
  for (const k of keys) assert.ok(k in ui, k);
  for (const m of js.matchAll(/k="([^"]+)"/g)) assert.ok(keys.includes(m[1]), m[1]);
  assert.doesNotMatch(js, /<svg/, 'no drawn stand-ins');
  assert.equal(P.turnPopupArtReady(), false, 'in Node (no Image) it never turns ready');
  assert.equal(P.TURN_POPUP_MS, 1200);
});

test('the themed renderer is selected only when its prefab can actually play a show clip', () => {
  const prefab = { scripts: [{ anims: { _showAnim: { clip: 'show', on: 2 } } }] };
  assert.equal(packBanners({ doc: { prefabs: { 'banner/effect_choose_self_select': prefab }, clips: { show: { len: 1 } } } }).yourTurn, true);
  assert.equal(packBanners({ doc: { prefabs: { 'banner/effect_choose_self_select': prefab }, clips: {} } }).yourTurn, false,
    'a missing clip falls back instead of swallowing the cue');
  assert.equal(packBanners({ doc: { prefabs: { 'banner/effect_choose_self_select': { scripts: [] } }, clips: { show: { len: 1 } } } }).yourTurn, false,
    'a prefab without _showAnim is not considered usable');
  assert.equal(packBanners(null).yourTurn, false);
});

test('game screen owns one live multiplayer cue; the choice overlay retains its header but emits no cue', () => {
  const g = read('public/js/screens/game.js');
  const choice = read('public/js/ui/choiceOverlay.js');
  const banners = read('public/js/ui/prefab/banners.js');
  assert.match(g, /spTurnCueKey\(pub, sp, \{ myId, solo, alive, spectator/);
  assert.match(g, /currentTurnCueRef\.current = turnCue\?\.key \?\? null/);
  assert.match(g, /audio\.sfx\('yourTurn', \{ isCurrent: \(\) => currentTurnCueRef\.current === turnCue\.key \}\)/);
  assert.match(g, /startedTurnCueRef\.current === turnCue\.key/);
  assert.match(g, /turnVisual\.renderer === 'theme'/);
  assert.match(choice, /t\('当前轮到你决策'\)/, 'the persistent draft header keeps its existing copy');
  assert.doesNotMatch(choice, /RegYourTurn|audio\.sfx\(['"]yourTurn|turnPop|turnMine/);
  assert.match(banners, /SELF_CHOOSE_BANNER_TIP'\)\) return t\('轮到你选'\)/);
  assert.match(banners, /label=\$\{t\('轮到你选'\)\} testid="your-turn-banner"/);
});

test('cue delays remain bounded behind active overlays, while generic reduced motion stays hidden', () => {
  assert.equal(P.TURN_CUE_WAIT_MS, 1800);
  assert.equal(P.TURN_CUE_PLATE_WAIT_MS, 2000);
  assert.ok(P.TURN_CUE_PLATE_WAIT_MS >= 1700 + 280, 'the round plate and leave fit inside its wait');
  assert.ok(P.TURN_CUE_PLATE_WAIT_MS + P.TURN_POPUP_MS <= 3500);
  const g = read('public/js/screens/game.js');
  assert.match(g, /const overlayKey = hasOffers \? '' : roundPop \? `r:\$\{roundPop\.key\}` : banner \? `b:\$\{banner\.key\}` : ''/);
  assert.match(g, /clearTimeout\(id\)/, 'a state change cancels the pending overlay wait');
  assert.match(read('public/css/screens/game-panels.css'), /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.sptp \{ display: none; \}/);
});

test('PREP, COMBAT and SP_DRAFT do not keep a central phase banner', () => {
  const phases = read('public/js/ui/gameLogic/phases.js');
  assert.match(phases, /case PHASE\.SP_DRAFT:\s*case PHASE\.PREP:\s*case PHASE\.COMBAT: return null;/);
  assert.match(read('public/js/screens/game.js'), /else setBanner\(null\)/, 'leaving a banner phase clears its old banner state');
});
