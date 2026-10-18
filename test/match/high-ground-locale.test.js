// GitHub #676: a MELEE chess whose Chinese trait reads 「可以放置于远程位」 may stand on a 高台 in every
// shipped language. The client places from the localized record (ui/gameLogic/placement.js piecePosition).
// en / ja / ko / zh-TW replace that Simplified line, so the build stores the reading as placeOnRanged
// (tools/build-data.mjs) and meleeOnHighGround reads the flag, keeping the phrase as a fallback for a
// Chinese or plugin record. screens/game.js placeCtx lists data.locale() so a language switch rebuilds it.
// The server keeps the Chinese record. Both must agree. Golden is unchanged: the server already accepted
// the deploy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legalTiles, placeClass, positionClass, tileKey } from '../../server/match/board.js';
import { PLACE_ON_RANGED, baseTraitText, meleeOnHighGround } from '../../shared/highGround.js';
import { applyFileOverlay } from '../../shared/i18nData.js';
import { diyRecord } from '../../shared/diy.js';
import { DATA, makeMatch, give, chessOfTier } from './harness.js';
import { placementContext, canPlace as clientCanPlace, boardTargets, piecePosition } from '../../public/js/ui/gameLogic.js';

const HIGH_STAGE = 'act2autochess_m01';
const HIGH = ['10,4', '11,4', '12,4'];
const HOLDERS = ['chess_char_4_12_a', 'chess_char_4_12_b', 'chess_char_2_03_a', 'chess_char_2_03_b', 'chess_char_3_07_a', 'chess_char_3_07_b'];
const WEEDY = 'char_400_weedy';
const WEEDY_FORMS = ['2/1/4/0', '2/60/7/1', '2/60/7/3'];
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const LANGS = ['zh', 'en', 'ja', 'ko', 'zh-TW'];
const TANK = (c) => c.profession === 'TANK' && c.position === 'MELEE';
const pack = (lang) => JSON.parse(readFileSync(new URL(`../../data/i18n/${lang}.json`, import.meta.url), 'utf8'));
const PACKS = { en: pack('en'), ja: pack('ja'), ko: pack('ko'), 'zh-TW': pack('zh-TW') };

function prep() {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 11 }).start();
  h.toPrep(1);
  h.setStage(HIGH_STAGE);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  return { h, m: h.m, ps };
}

/** The chess file as the client sees it in `lang` (zh is the Chinese record). */
function chessOf(lang) {
  if (lang === 'zh') return DATA.chess;
  return applyFileOverlay(DATA.chess, PACKS[lang].files.chess).value;
}

/** backups.json as the client sees it. The 自选 body is composed from a form of this file. */
function backupsOf(lang) {
  if (lang === 'zh') return DATA.backups;
  return applyFileOverlay(DATA.backups, PACKS[lang].files.backups).value;
}

const keysOf = (tiles) => tiles.map(([r, c]) => tileKey(r, c)).sort();
const board = (k) => { const [row, col] = k.split(',').map(Number); return { area: 'board', row, col }; };

test('高台 fallback: the Simplified line, or placeOnRanged: true, and nothing else', () => {
  assert.equal(meleeOnHighGround({ position: 'MELEE', trait: { desc: '技能可以使敌人产生位移\n可以放置于远程位' } }), true);
  assert.equal(meleeOnHighGround({ position: 'MELEE', placeOnRanged: false, trait: { desc: '可以放置于远程位' } }), true, 'an explicit false still falls through to the line');
  assert.equal(meleeOnHighGround({ position: 'MELEE', placeOnRanged: true, trait: { desc: 'Can be deployed on Ranged Tiles' } }), true);
  assert.equal(meleeOnHighGround({ position: 'MELEE', trait: { desc: 'Can be deployed on Ranged Tiles' } }), false, 'a translation alone is ground-only');
  assert.equal(meleeOnHighGround({ position: 'MELEE', trait: { desc: '可以额外部署在远程位' } }), false);
  assert.equal(meleeOnHighGround({ position: 'RANGED', placeOnRanged: true, trait: { desc: '可以放置于远程位' } }), false);
  assert.equal(meleeOnHighGround(null), false);
  assert.equal(meleeOnHighGround({ position: 'MELEE' }), false);
});

test('高台 data: placeOnRanged is exactly the Chinese line, on the six chess and on every backup form that has it', () => {
  const flagged = Object.values(DATA.chess).filter((c) => c.placeOnRanged === true).map((c) => c.chessId).sort();
  assert.deepEqual(flagged, HOLDERS.slice().sort());
  for (const id of HOLDERS) {
    const c = DATA.chess[id];
    assert.equal(c.position, 'MELEE', id);
    assert.equal(c.placeOnRanged, true, id);
    assert.ok(baseTraitText(c).includes(PLACE_ON_RANGED), id);
    assert.equal(meleeOnHighGround(c), true, id);
  }
  const forms = [];
  for (const [charId, unit] of Object.entries(DATA.backups.units)) {
    for (const [key, form] of Object.entries(unit.forms || {})) {
      const want = unit.position === 'MELEE' && typeof form.trait?.desc === 'string' && form.trait.desc.includes(PLACE_ON_RANGED);
      assert.equal(form.placeOnRanged === true, want, `${charId} ${key}`);
      if (want) forms.push(`${charId}@${key}`);
    }
  }
  for (const key of WEEDY_FORMS) assert.ok(forms.includes(`${WEEDY}@${key}`), key);
  assert.equal(DATA.backups.units[WEEDY].position, 'MELEE');
});

test('高台 client: each locale overlay still places the six, and the highlights agree with the server', () => {
  const { m, ps } = prep();
  const holders = HOLDERS.map((id) => give(m, ps, id));
  const tankId = chessOfTier(1, TANK).find((id) => m.pool.has(id));
  const tank = give(m, ps, tankId);
  const map = ps.deployMap();
  const allTiles = keysOf(legalTiles(map, 'all'));
  const meleeTiles = keysOf(legalTiles(map, 'melee'));
  for (const k of HIGH) assert.ok(allTiles.includes(k) && !meleeTiles.includes(k), k);
  for (const lang of LANGS) {
    const chess = chessOf(lang);
    const ctx = placementContext({
      priv: ps.privateView(), stage: m.stage, editable: true,
      getChess: (id) => chess[id] ?? null,
      getToken: (id) => DATA.tokens[id] ?? null,
      getItem: (id) => DATA.items[id] ?? null,
    });
    for (const p of holders) {
      const rec = chess[p.id];
      assert.equal(rec.placeOnRanged, true, `${lang} ${p.id}: flag survives the overlay`);
      assert.equal(rec.position, 'MELEE', `${lang} ${p.id}`);
      assert.equal(baseTraitText(rec).includes(PLACE_ON_RANGED), lang === 'zh', `${lang} ${p.id}: trait text`);
      assert.equal(meleeOnHighGround(rec), true, `${lang} ${p.id}`);
      assert.equal(piecePosition(ctx, p), 'ALL', `${lang} ${p.id}`);
      assert.equal(placeClass(ps, DATA.chess[p.id]), 'all', `${lang} ${p.id}: server`);
      const lit = keysOf(boardTargets(ctx, p.uid).legal);
      assert.deepEqual(lit, allTiles, `${lang} ${p.id}: highlights = the server`);
      for (const k of HIGH) assert.equal(clientCanPlace(ctx, p.uid, board(k)).ok, true, `${lang} ${p.id} → ${k}`);
    }
    const refused = clientCanPlace(ctx, tank.uid, board(HIGH[0]));
    assert.equal(refused.ok, false, lang);
    assert.equal(refused.reason, '近战单位只能部署在地面', lang);
    assert.equal(piecePosition(ctx, tank), 'MELEE', lang);
    assert.deepEqual(keysOf(boardTargets(ctx, tank.uid).legal), meleeTiles, `${lang}: a 重装 stays on the ground`);
  }
  m.dispose();
});

test('高台 自选: localized 温蒂 keeps placeOnRanged and the client agrees with placeClass', () => {
  const { m, ps } = prep();
  const map = ps.deployMap();
  const allTiles = keysOf(legalTiles(map, 'all'));
  const tankId = chessOfTier(1, TANK).find((id) => m.pool.has(id));
  const cases = [[5, false], [5, true], [6, true]];
  for (const lang of LANGS) {
    const backups = backupsOf(lang);
    const data = { chess: DATA.chess, backups };
    for (const [tier, elite] of cases) {
      const slotId = elite ? SLOT[tier].replace(/_a$/, '_b') : SLOT[tier];
      const rec = diyRecord(SLOT[tier], { charId: WEEDY, skillIndex: 0, uniEquipId: null }, { elite, data });
      const label = `${lang} T${tier} ${elite ? 'elite' : 'normal'}`;
      assert.ok(rec, label);
      assert.equal(rec.placeOnRanged, true, label);
      assert.equal(rec.position, 'MELEE', label);
      assert.equal(baseTraitText(rec).includes(PLACE_ON_RANGED), lang === 'zh', `${label}: trait text`);
      assert.equal(meleeOnHighGround(rec), true, label);
      assert.equal(positionClass(rec), 'all', label);
      assert.equal(placeClass({ fieldRecord: () => rec }, DATA.chess[slotId]), 'all', `${label}: server`);
      const ctx = placementContext({
        priv: { hand: [{ uid: 1, kind: 'chess', id: slotId }, { uid: 2, kind: 'chess', id: tankId }], board: [], temp: [], deployCap: 8 },
        stage: m.stage, editable: true,
        getChess: (id) => (id === slotId ? rec : DATA.chess[id] ?? null),
        getToken: (id) => DATA.tokens[id] ?? null,
        getItem: (id) => DATA.items[id] ?? null,
      });
      assert.equal(piecePosition(ctx, { kind: 'chess', id: slotId }), 'ALL', label);
      assert.deepEqual(keysOf(boardTargets(ctx, 1).legal), allTiles, `${label}: highlights`);
      for (const k of HIGH) assert.equal(clientCanPlace(ctx, 1, board(k)).ok, true, `${label} → ${k}`);
      const refused = clientCanPlace(ctx, 2, board(HIGH[0]));
      assert.equal(refused.ok, false, label);
      assert.equal(refused.reason, '近战单位只能部署在地面', label);
    }
  }
  m.dispose();
});
