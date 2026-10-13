// User playtest #6 follow-up — the promotion cue of a merge (render/promote.js, render/fx.js promote, render/app.js
// setPrep). A merge's elite appears on the board tile of the deployed copy it replaced (PRTS 卫戍协议/帮助 "若消耗已部署至
// 作战区的干员，则发送至作战区对应位置"), else on a bench slot; setPrep recognises it (a new elite uid while normal copies of
// the same operator vanished) and plays fx.promote there instead of the plain deploy flash. Headless fake PIXI.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { promotionsOf } from '../../public/js/render/promote.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHESS = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
const ROWS = CHESS.chess || CHESS;
const chessOf = (id) => ROWS[id] || null;
const A = 'chess_char_1_01_a', B = 'chess_char_1_02_a';
const gold = (id) => ROWS[id].goldenId;
const e = (uid, id, area, o = {}) => ({ uid, area, piece: { uid, kind: 'chess', id, golden: !!ROWS[id]?.isGolden, ...o }, key: `p:${uid}`, ...o });

describe('promotionsOf', () => {
  test('a new elite whose normal copies vanished is a promotion (board or bench)', () => {
    const prev = [e(1, A, 'board', { row: 10, col: 3 }), e(2, A, 'board', { row: 11, col: 5 }), e(3, B, 'hand', { idx: 9 })];
    const next = [e(9, gold(A), 'board', { row: 11, col: 5 }), e(3, B, 'hand', { idx: 9 })];
    const p = promotionsOf(prev, next, chessOf);
    assert.deepEqual([...p.keys()], [9]);
    assert.deepEqual(p.get(9).map((g) => g.uid).sort(), [1, 2]);
    const hand = promotionsOf([e(1, A, 'hand', { idx: 9 }), e(2, A, 'hand', { idx: 8 })], [e(7, gold(A), 'hand', { idx: 9 })], chessOf);
    assert.deepEqual([...hand.keys()], [7], 'an elite arriving in the hand is promoted too');
  });
  test('not a promotion: the first state, a sale, an elite gained without copies vanishing, another operator', () => {
    assert.equal(promotionsOf([], [e(9, gold(A), 'board', { row: 10, col: 3 })], chessOf).size, 0, 'first setPrep');
    assert.equal(promotionsOf([e(1, A, 'board')], [], chessOf).size, 0, 'a sale');
    assert.equal(promotionsOf([e(1, B, 'hand')], [e(9, gold(A), 'hand')], chessOf).size, 0, 'a granted elite while another operator left');
    assert.equal(promotionsOf([e(1, A, 'hand')], [e(1, A, 'board', { row: 10, col: 3 }), e(5, B, 'hand')], chessOf).size, 0, 'a move and a buy');
    assert.equal(promotionsOf([e(4, gold(A), 'hand')], [e(4, gold(A), 'board', { row: 9, col: 2 })], chessOf).size, 0, 'an elite placed by hand');
  });
  test('two merges in one update are told apart by operator', () => {
    const prev = [e(1, A, 'board'), e(2, A, 'hand'), e(3, B, 'hand'), e(4, B, 'temp')];
    const next = [e(10, gold(A), 'board'), e(11, gold(B), 'hand')];
    const p = promotionsOf(prev, next, chessOf);
    assert.deepEqual(p.get(10).map((g) => g.uid).sort(), [1, 2]);
    assert.deepEqual(p.get(11).map((g) => g.uid).sort(), [3, 4]);
  });
});

describe('fx.promote', () => {
  let fake, FX;
  before(async () => { fake = installFakePixi(); FX = await import('../../public/js/render/fx.js'); });
  after(() => fake.restore());
  const cam = presetCamera('prep', { width: 1600, height: 900 });
  function makeFx() {
    const P = fake.P;
    const ctx = fakeViewCtx(P);
    return new FX.FxSystem({
      P, layers: ctx.layers, cam: () => cam, heightAt: () => 0, settings: { quality: 'high', damageNumbers: true },
      timeScale: () => 1, loadLevel: () => 0, subProfOf: () => null, view: () => null,
      screenSize: () => ({ width: 1600, height: 900 }), fieldTop: () => 120,
    });
  }
  const view = (x, y) => ({ id: 'p:9', x, y, z: 0, hover: 0, _headTiles: 1.2, alive: true, destroyed: false, isEnemy: false, info: { defId: gold(A) } });
  const texName = (fx, sp) => Object.keys(fx.tex).find((k) => fx.tex[k] === sp.texture);

  test('a gold pillar, a shockwave and a hex ring at the elite, streaks from the other copies; counted', () => {
    const fx = makeFx();
    const before = fx.counts;
    assert.equal(before.promotions, 0);
    fx.promote(view(5, 10), [{ x: 3, y: 11, z: 0 }]);
    const names = fx.parts.map((p) => texName(fx, p.sp));
    assert.ok(names.filter((n) => n === 'pillar').length >= 2, `pillars (${names.join(',')})`);
    assert.ok(names.includes('streak'), 'a streak from the other consumed copy');
    assert.ok(fx.rings.length >= 2, 'shockwave + hex ring');
    assert.equal(fx.counts.promotions, 1);
    fx.promote(null);
    assert.equal(fx.counts.promotions, 1, 'no view: nothing');
  });
});

test('render/app.js plays the promotion cue instead of the deploy flash for a merge\'s elite', () => {
  const src = readFileSync(path.join(ROOT, 'public/js/render/app.js'), 'utf8');
  assert.match(src, /import \{ promotionsOf \} from '\.\/promote\.js';/);
  assert.match(src, /const before = prepPieces\.length \? prepPieces : promoBase;[\s\S]{0,80}promotionsOf\(before, list, \(id\) => data\.chess\(id\)\)/, 'compared with the previous state');
  assert.match(src, /if \(prepPieces\.length\) promoBase = prepPieces;\s*prepPieces = \[\];/, 'a battle keeps the last prep state: a merge between two preps is cued too (QA 6b)');
  // (the elite and a new board piece land — the Start clip and its landing sound, PR #416 — and only the latter flashes)
  assert.match(src, /if \(promoFrom\.has\(e\.uid\)\) \{[\s\S]{0,400}fx\.promote\(v,[\s\S]{0,400}\} else if \(e\.area === 'board' && prevBoard\.size && !prevBoard\.has\(e\.uid\)\) \{ landPiece\(v, 'board'\); fx\.deploy\(v\); \}/);
  assert.match(src, /promotions,/, 'the cue log is exposed on view.debug (E2E)');
});
