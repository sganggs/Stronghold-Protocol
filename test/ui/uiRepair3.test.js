// Regression tests for in-match UI defects (round-3 hunt): the 暂离 (AI 托管) flag leaking into the next match, game
// shortcuts acting behind the 本局信息 / 敌方情报 drawer, two elimination banners during SETTLE, a right-click /
// long-press detail card that a press on the field did not close, and the touch hit areas of the 交流 pager (static
// check here; the in-browser check is in devices.e2e.test.js).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shortcutBlocked, showDeadPill, closesOnFieldPress } from '../../public/js/ui/gameLogic.js';
import { PHASE } from '../../shared/constants.js';

describe('暂离 (AI 托管) is scoped to one match', () => {
  test('the flag survives in-match updates and is dropped when the match ends or its state is cleared', async () => {
    const { awayStore, awayEnds } = await import('../../public/js/ui/matchChrome.js');
    const { store, emptyMatch } = await import('../../public/js/store.js');
    const inMatch = (phase) => ({ ...emptyMatch(), public: { phase, players: [] } });
    store.set({ match: inMatch(PHASE.PREP) });
    awayStore.set({ away: true });
    store.patch('match', { public: { phase: PHASE.COMBAT, players: [] } });
    assert.equal(awayStore.get().away, true, 'still away while the match runs');
    // result → 返回同盟 (result.js back): the match slice is cleared
    store.patch('match', { result: { victory: false } });
    assert.equal(awayStore.get().away, false, 'the settlement ends 暂离');
    awayStore.set({ away: true });
    store.set({ match: emptyMatch() });
    assert.equal(awayStore.get().away, false, 'clearing the match (返回同盟 / a new match / room closed) ends 暂离');
    // the next match opens without the overlay flag
    store.set({ match: inMatch(PHASE.INFO_CHECK) });
    assert.equal(awayStore.get().away, false);
    assert.equal(awayEnds({ match: inMatch(PHASE.PREP) }, { match: inMatch(PHASE.PREP) }), false);
    assert.equal(awayEnds({ match: emptyMatch() }, { match: emptyMatch() }), false, 'nothing to end outside a match');
    store.set({ match: emptyMatch() });
  });
});

describe('game shortcuts behind overlays', () => {
  test('the 本局信息 / 敌方情报 drawer swallows R / F / D / Space, Esc still closes it', () => {
    for (const act of ['refresh', 'freeze', 'levelUp', 'retreat', 'sell', 'ready']) {
      assert.equal(shortcutBlocked(act, { drawer: true }), true, act);
      assert.equal(shortcutBlocked(act, {}), false, act);
      assert.equal(shortcutBlocked(act, { modal: true }), true, act);
    }
    assert.equal(shortcutBlocked('escape', { drawer: true }), false);
    assert.equal(shortcutBlocked('escape', { modal: true }), true, 'a modal handles its own Esc');
    assert.equal(shortcutBlocked(null, {}), true);
  });
});

describe('elimination banners', () => {
  test('the HUD pill shows outside combat only — never during SETTLE, where the combat HUD already says it', () => {
    assert.equal(showDeadPill(false, PHASE.PREP), true);
    assert.equal(showDeadPill(false, PHASE.SP_DRAFT), true);
    assert.equal(showDeadPill(false, PHASE.SETTLE), false);
    for (const p of [PHASE.COMBAT, PHASE.UNITE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]) assert.equal(showDeadPill(false, p), false, p);
    assert.equal(showDeadPill(true, PHASE.PREP), false);
  });
});

describe('detail card vs a press on the field', () => {
  test('a card opened from the field (tap, right-click, long press, battle unit) closes; others stay', () => {
    assert.equal(closesOnFieldPress({ kind: 'piece', uid: 3 }), true);
    assert.equal(closesOnFieldPress({ kind: 'unit', unitId: 7 }), true);
    for (const kind of ['chess', 'item', 'enemy']) assert.equal(closesOnFieldPress({ kind, id: 'x' }), false, kind);
    assert.equal(closesOnFieldPress(null), false);
  });

  test('the field press handler closes the card whether or not a piece is selected', () => {
    const src = readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
    const h = src.slice(src.indexOf('const onDown = () => {'), src.indexOf("host.addEventListener('pointerdown', onDown, true)"));
    assert.ok(h.length > 0);
    assert.match(h, /setDetail\(\(d\) => \(closesOnFieldPress\(d\) \? null : d\)\)/);
    assert.doesNotMatch(h, /if \(L\.sel\) \{[^}]*setDetail/, 'not only while a piece is selected');
  });
});

describe('交流 pager touch hit areas (css/devices.css)', () => {
  const css = readFileSync(new URL('../../public/css/devices.css', import.meta.url), 'utf8');
  test('‹ / › hit areas start under the emote cells and grow outwards; dots only up to half the gap', () => {
    assert.match(css, /\.sp-coarse \.ewheel__panel \.ewheel__nav::before \{ top: \.03rem; bottom: -\.15rem; height: auto; transform: none; \}/);
    assert.match(css, /\.sp-coarse \.ewheel__panel \.ewheel__nav\.is-prev::before \{ left: auto; right: 0; \}/);
    assert.match(css, /\.sp-coarse \.ewheel__panel \.ewheel__nav\.is-next::before \{ left: 0; right: auto; \}/);
    assert.match(css, /\.sp-coarse \.ewheel__dot::before \{ inset: -\.02rem -\.05rem -\.2rem;/);
  });
});

describe('dev hook', () => {
  test('useFieldView clears globalThis.__SP_VIEW__ when it destroys the view', () => {
    const src = readFileSync(new URL('../../public/js/ui/fieldHost.js', import.meta.url), 'utf8');
    const cleanup = src.slice(src.indexOf('return () => {', src.indexOf('export function useFieldView')));
    assert.match(cleanup.slice(0, 600), /globalThis\.__SP_VIEW__ === viewRef\.current\) globalThis\.__SP_VIEW__ = null/);
  });
});
