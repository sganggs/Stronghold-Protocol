// The bond strip follows the watched player (DESIGN §20.15, user report after playtest #6: "观看队友时（不仅是休整时候，
// 还有自己战斗结束时，联防时，最终boss战）盟约栏应该变成当前队友的盟约以及他的层数"). Node tests of the selection logic
// (public/js/ui/watchBonds.js): which field is on screen, whose bonds the strip shows in every watch situation — prep
// scouting, a teammate's battle after the own one, an eliminated player's auto-observed field, 联防 and the Final Assault
// (the ‹ › half the camera shows; 全景 = yourself when you fight there, else the teammate picked with 前往查看 / the
// field's first player — never the viewer's own bonds on a field they do not fight on), the game screen's state →
// strip (screenStrip, incl. a shared field watched with 前往查看), the camera half of a picked player, the live layers
// laid over (capped at 999), the teammate's member list, the strip / popup labelling and the ‹ › pill with 返回战场,
// and the popup of a card's bond chip (the UNIT owner's bond, not the strip's: detailBondOwner / toggleBond / popupView).
// Server side: test/match/watch-bonds.test.js; on screen: test/ui/watch-bonds.e2e.test.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// the browser data store reads the real data files from disk
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { screenFieldId, bondOwnerId, ownerBonds, withLiveLayers, ownerBoard, stripView, playerBonds, watchedPlayer, playerLayer, screenStrip,
  detailBondOwner, toggleBond, popupView } = await import('../../public/js/ui/watchBonds.js');
const { BondStrip, BondPopup } = await import('../../public/js/ui/bondStrip.js');
const { CombatHud } = await import('../../public/js/ui/combatHud.js');
const { cameraLayers } = await import('../../public/js/battle/observe.js');
const { BOND_LAYER_CAP } = await import('../../shared/constants.js');
const { data } = await import('../../public/js/data.js');
await data.loadAll('bonds', 'chess', 'assets');

/** Every vnode of a preact tree (htm output), depth first; function components are expanded. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && /^[A-Z]/.test(v.type.name) && ['OwnerTag'].includes(v.type.name)) yield* walk(v.type(v.props));
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (typeof v.type === 'function' && v.type.name === 'OwnerTag') return textOf(v.type(v.props));
  return textOf(v.props?.children);
};

// ---- a 4-player co-op match as m.public / m.private carry it ----------------------------------------------------------
const ME = 'p1';
const bond = (bondId, count, layers, tier = count >= 2 ? 1 : 0) => ({ bondId, count, active: tier > 0, tier, layers });
const PUB = (extra = {}) => ({
  phase: 'PREP',
  players: [
    { playerId: 'p1', seat: 0, name: '凯尔希', alive: true, bonds: [bond('yanShip', 3, 12, 1)] },
    { playerId: 'p2', seat: 1, name: '阿米娅', alive: true, bonds: [bond('sargonShip', 2, 40, 1), bond('kjeragShip', 0, 7, 0)] },
    { playerId: 'p3', seat: 2, name: '华法琳', alive: true, bonds: [bond('lateranoShip', 4, 120, 2)] },
    { playerId: 'ai_4', seat: 3, name: 'AI·煌', alive: true, isBot: true, bonds: [] },
  ],
  fields: [],
  ...extra,
});
const PRIV = { playerId: ME, bonds: [{ ...bond('yanShip', 3, 12, 1), thresholds: [3, 6, 9], countsHand: false }], board: [{ kind: 'chess', id: 'x' }], hand: [], temp: [] };

describe('§20.15 screenFieldId: the field on screen', () => {
  test('prep: the own board (null) unless a teammate is scouted', () => {
    assert.equal(screenFieldId({ combat: false, watchingOther: false, watching: null, home: 'n:p1' }), null);
    assert.equal(screenFieldId({ combat: false, watchingOther: true, watching: 'n:p2', home: 'n:p1' }), 'n:p2');
  });
  test('battle: the watched field, else the battle the view shows (the auto-observed one of an eliminated player), else home', () => {
    assert.equal(screenFieldId({ combat: true, watchingOther: true, watching: 'n:p3', battleFieldId: 'n:p1', home: 'n:p1' }), 'n:p3');
    assert.equal(screenFieldId({ combat: true, battleFieldId: 'n:p2', home: 'n:p1' }), 'n:p2', 'eliminated: the runner\'s auto-observed field');
    assert.equal(screenFieldId({ combat: true, battleFieldId: 'u', home: 'n:p1' }), 'u', '联防 observer');
    assert.equal(screenFieldId({ combat: true, battleFieldId: null, home: 'b1' }), 'b1', 'before the runner shows anything: home');
  });
  test('SETTLE: the field the last battle left on screen', () => {
    assert.equal(screenFieldId({ settle: true, battleFieldId: 'n:p2', home: 'n:p1' }), 'n:p2');
    assert.equal(screenFieldId({ settle: true, home: 'n:p1' }), 'n:p1');
  });
});

describe('§20.15 bondOwnerId: whose bonds the strip shows', () => {
  test('own board / own battle → yourself', () => {
    assert.equal(bondOwnerId({ pub: PUB(), myId: ME, fieldId: null }), ME);
    assert.equal(bondOwnerId({ pub: PUB(), myId: ME, fieldId: 'n:p1' }), ME);
  });
  test('prep scouting, a teammate\'s battle after the own one, an eliminated player\'s auto-observed field → that teammate', () => {
    assert.equal(bondOwnerId({ pub: PUB(), myId: ME, fieldId: 'n:p2' }), 'p2');
    assert.equal(bondOwnerId({ pub: PUB({ phase: 'COMBAT' }), myId: ME, fieldId: 'n:ai_4' }), 'ai_4', 'an AI teammate too');
  });
  test('an unknown field owner falls back to yourself', () => {
    assert.equal(bondOwnerId({ pub: PUB(), myId: ME, fieldId: 'n:ghost' }), ME);
    assert.equal(bondOwnerId({ pub: PUB(), myId: ME, fieldId: '' }), ME);
  });

  // 联防 with two helpers: the first helper holds the right half (runner sides), research 09 §3.1
  const unite = (helpers, sides) => ({
    pub: PUB({ phase: 'UNITE', fields: [{ fieldId: 'u', kind: 'unite', players: helpers, live: true }], unite: { helpers, leakers: ['p3'] } }),
    field: { fieldId: 'u', kind: 'unite', players: helpers, sides, local: true },
  });
  test('联防 helper: the ‹ › half → the player on it ("你自己" → yours, "👁 name" → theirs); 全景 → yours', () => {
    const { pub, field } = unite(['p2', 'p1'], { p2: 'R', p1: 'L' });
    const at = (layer) => bondOwnerId({ pub, myId: ME, fieldId: 'u', field, layer, halves: true });
    assert.equal(at('R'), 'p2');
    assert.equal(at('L'), ME);
    assert.equal(at('ALL'), ME);
  });
  test('联防 observer (a leaker, not on the field): a half → its helper; 全景 → helper 1 (two helpers) / the lone helper (one) — never yours', () => {
    const two = unite(['p2', 'ai_4'], { p2: 'R', ai_4: 'L' });
    assert.equal(bondOwnerId({ pub: two.pub, myId: 'p3', fieldId: 'u', field: two.field, layer: 'L', halves: true }), 'ai_4');
    assert.equal(bondOwnerId({ pub: two.pub, myId: 'p3', fieldId: 'u', field: two.field, layer: 'R', halves: true }), 'p2');
    assert.equal(bondOwnerId({ pub: two.pub, myId: 'p3', fieldId: 'u', field: two.field, layer: 'ALL', halves: true }), 'p2', '全景: the first helper listed, not the leaker\'s own');
    assert.equal(bondOwnerId({ pub: two.pub, myId: 'p3', fieldId: 'u', field: two.field, layer: 'ALL', halves: true, watched: 'ai_4' }), 'ai_4', '全景: the helper picked with 前往查看');
    assert.equal(bondOwnerId({ pub: two.pub, myId: 'p3', fieldId: 'u', field: two.field, layer: 'L', halves: true, watched: 'p2' }), 'ai_4', 'a ‹ › half beats the pick');
    // the avatar watch of the 联防 field before the pill is offered (halves = false): the picked helper, else helper 1
    assert.equal(bondOwnerId({ pub: two.pub, myId: 'p3', fieldId: 'u', field: two.field, layer: 'ALL', halves: false, watched: 'ai_4' }), 'ai_4');
    assert.equal(bondOwnerId({ pub: two.pub, myId: 'p3', fieldId: 'u', field: null, halves: false }), 'p2', 'no meta yet: the m.public listing');
    assert.equal(bondOwnerId({ pub: two.pub, myId: 'p3', fieldId: 'u', field: two.field, halves: false, watched: 'p1' }), 'p2', 'a pick not on that field is ignored');
    const one = unite(['p2'], { p2: 'R' });
    assert.equal(bondOwnerId({ pub: one.pub, myId: 'p3', fieldId: 'u', field: one.field, layer: 'ALL', halves: true }), 'p2', 'the lone helper\'s field');
    assert.equal(bondOwnerId({ pub: one.pub, myId: 'p3', fieldId: 'u', field: one.field, layer: 'L', halves: true }), 'p2', 'an empty half (无人在家) → as 全景');
    assert.equal(bondOwnerId({ pub: one.pub, myId: 'p2', fieldId: 'u', field: one.field, layer: 'L', halves: true }), 'p2', 'the lone helper himself');
  });
  test('Final Assault pair: the partner\'s half → the partner; own half / 全景 → yours; an eliminated spectator on 全景 → the picked / first player', () => {
    const pub = PUB({ phase: 'FINAL_ASSAULT', fields: [{ fieldId: 'b1', kind: 'boss', players: ['p1', 'p3'], live: true }, { fieldId: 'b2', kind: 'boss', players: ['p2', 'ai_4'], live: true }] });
    const field = { fieldId: 'b1', kind: 'boss', players: ['p1', 'p3'], sides: { p1: 'L', p3: 'R' }, local: true };
    const at = (layer, myId = ME, halves = true) => bondOwnerId({ pub, myId, fieldId: 'b1', field, layer, halves });
    assert.equal(at('R'), 'p3');
    assert.equal(at('L'), ME);
    assert.equal(at('ALL'), ME);
    assert.equal(at('R', ME, false), ME, 'no ‹ › pill (a lone field / server-run combat): the field rule');
    assert.equal(at('ALL', 'p2'), 'p1', 'eliminated spectator, not on the pair, 全景: the pair\'s first player — never your own');
    assert.equal(at('R', 'p2'), 'p3', 'eliminated spectator on a half: that player');
    assert.equal(bondOwnerId({ pub, myId: 'p2', fieldId: 'b1', field, layer: 'ALL', halves: true, watched: 'p3' }), 'p3', 'the player picked with 前往查看');
    assert.equal(bondOwnerId({ pub, myId: 'p2', fieldId: 'b1', field, halves: false, watched: 'p3' }), 'p3', 'no ‹ › pill: the pick still decides');
    assert.equal(bondOwnerId({ pub, myId: 'p1', fieldId: 'b1', field, halves: false, watched: 'p3' }), ME, 'a pair member on 全景: own (a member never picks a player of its own field)');
    // a stale field meta (another field) never decides the half
    assert.equal(bondOwnerId({ pub, myId: ME, fieldId: 'b1', field: { ...field, fieldId: 'b2' }, layer: 'R', halves: true }), ME);
  });
  test('a lone player\'s boss field watched by an eliminated player → that player', () => {
    const pub = PUB({ phase: 'FINAL_ASSAULT', fields: [{ fieldId: 'b2', kind: 'boss', players: ['p3'], live: true }] });
    assert.equal(bondOwnerId({ pub, myId: 'p2', fieldId: 'b2', field: null }), 'p3');
  });
});

describe('§20.15 the picked teammate and the camera half', () => {
  test('watchedPlayer: the row tapped while that watch is on screen, else null', () => {
    assert.equal(watchedPlayer({ fieldId: 'u', playerId: 'p2' }, 'u'), 'p2');
    assert.equal(watchedPlayer({ fieldId: 'u', playerId: 'p2' }, 'b1'), null, 'another field is watched now');
    assert.equal(watchedPlayer({ fieldId: 'u', playerId: 'p2' }, null), null, 'back home');
    assert.equal(watchedPlayer(null, 'u'), null);
    assert.equal(watchedPlayer({ fieldId: 'u' }, 'u'), null);
  });
  test('playerLayer: the ‹ › half of a picked player on a two-half field; null for a normal / lone field or a stranger', () => {
    const pub = PUB({ phase: 'UNITE' });
    const two = { fieldId: 'u', kind: 'unite', players: ['p2', 'ai_4'], sides: { p2: 'R', ai_4: 'L' }, local: true };
    assert.equal(playerLayer(two, pub, 'p3', 'p2'), 'R');
    assert.equal(playerLayer(two, pub, 'p3', 'ai_4'), 'L');
    assert.equal(playerLayer(two, pub, 'p3', 'p1'), null, 'not on that field');
    const pair = { fieldId: 'b1', kind: 'boss', players: ['p1', 'p3'], sides: { p1: 'L', p3: 'R' }, local: true };
    assert.equal(playerLayer(pair, pub, 'p2', 'p3'), 'R');
    assert.equal(playerLayer({ fieldId: 'b2', kind: 'boss', players: ['p3'], sides: { p3: 'L' } }, pub, 'p2', 'p3'), null, 'a lone boss field has no halves');
    assert.equal(playerLayer({ fieldId: 'n:p2', kind: 'normal', players: ['p2'] }, pub, ME, 'p2'), null);
    assert.equal(playerLayer(null, pub, ME, 'p2'), null);
  });
});

describe('§20.15 screenStrip: the game screen\'s state → whose bonds (every watch situation)', () => {
  const helpers = ['p2', 'ai_4'];
  const UNITE = PUB({ phase: 'UNITE', fields: [{ fieldId: 'u', kind: 'unite', players: helpers, live: true }], unite: { helpers, leakers: ['p1', 'p3'] } });
  const uField = { fieldId: 'u', kind: 'unite', players: helpers, sides: { p2: 'R', ai_4: 'L' }, local: true };
  const FA = PUB({ phase: 'FINAL_ASSAULT', players: PUB().players.map((p) => (p.playerId === ME ? { ...p, alive: false } : p)),
    fields: [{ fieldId: 'b1', kind: 'boss', players: ['p2', 'p3'], live: true }, { fieldId: 'b2', kind: 'boss', players: ['ai_4'], live: true }] });
  const b1 = { fieldId: 'b1', kind: 'boss', players: ['p2', 'p3'], sides: { p2: 'L', p3: 'R' }, local: true };
  // what game.js passes: layers = cameraLayers(field) on the field on screen (also a watched one), [] otherwise
  const S = (o) => screenStrip({ pub: o.pub, priv: PRIV, myId: ME, home: 'n:p1', ...o, layers: o.layers ?? (o.field ? cameraLayers(o.field, o.pub, ME) : []) });

  test('prep: the own board, then the scouted teammate (前往查看), back home → own again', () => {
    assert.deepEqual([S({ pub: PUB() }).ownerId, S({ pub: PUB() }).name], [ME, null]);
    const scout = S({ pub: PUB(), watchingOther: true, watching: 'n:p2', who: { fieldId: 'n:p2', playerId: 'p2' } });
    assert.deepEqual([scout.fieldId, scout.ownerId, scout.name], ['n:p2', 'p2', '阿米娅']);
    assert.deepEqual(scout.bonds.map((b) => b.bondId), ['sargonShip', 'kjeragShip']);
  });
  test('own battle over → a teammate\'s battle watched; an eliminated player\'s auto-observed normal field', () => {
    const pub = PUB({ phase: 'COMBAT', fields: [{ fieldId: 'n:p1', kind: 'normal', players: ['p1'], live: false }, { fieldId: 'n:p3', kind: 'normal', players: ['p3'], live: true }] });
    const live = { p3: { lateranoShip: 130 } };
    const w = S({ pub, combat: true, watchingOther: true, watching: 'n:p3', battleFieldId: 'n:p3', who: { fieldId: 'n:p3', playerId: 'p3' }, bondLayers: live });
    assert.deepEqual([w.ownerId, w.bonds[0].layers], ['p3', 130], 'their live layers');
    const auto = S({ pub, combat: true, battleFieldId: 'n:p3', bondLayers: live });
    assert.equal(auto.ownerId, 'p3', 'eliminated: the runner\'s auto-observed field');
  });
  test('联防 leaker auto-observing (全景): helper 1, tagged — not the leaker\'s own bonds', () => {
    const st = S({ pub: UNITE, combat: true, battleFieldId: 'u', field: uField, layer: 'ALL' });
    assert.deepEqual([st.fieldId, st.ownerId, st.self, st.name], ['u', 'p2', false, '阿米娅']);
    assert.equal(S({ pub: UNITE, combat: true, battleFieldId: 'u', field: uField, layer: 'L' }).ownerId, 'ai_4', 'the ‹ › pill on helper 2\'s half');
  });
  test('联防 leaker taps a helper\'s avatar (前往查看 → watching \'u\'): that helper, with or without the ‹ › pill', () => {
    const watch = (pid, o = {}) => S({ pub: UNITE, combat: true, watchingOther: true, watching: 'u', battleFieldId: 'u', field: uField, who: { fieldId: 'u', playerId: pid }, ...o });
    assert.equal(watch('ai_4', { layer: 'ALL' }).ownerId, 'ai_4', '全景 after the pick: the picked helper');
    assert.equal(watch('ai_4', { layer: 'L' }).ownerId, 'ai_4', 'the camera moved to the picked helper\'s half');
    assert.equal(watch('p2', { layer: 'R' }).ownerId, 'p2');
    assert.equal(watch('ai_4', { layers: [], layer: 'ALL' }).ownerId, 'ai_4', 'no ‹ › pill (halves = false): the pick decides');
    assert.equal(watch('ai_4', { layer: 'R' }).ownerId, 'p2', 'the viewer stepped the pill to the other half: that helper');
    // a pick of another watch (stale) never decides
    assert.equal(S({ pub: UNITE, combat: true, watchingOther: true, watching: 'u', battleFieldId: 'u', field: uField, layer: 'ALL', who: { fieldId: 'n:ai_4', playerId: 'ai_4' } }).ownerId, 'p2');
  });
  test('联防 helper: 全景 / own half → own; the partner\'s half → the partner', () => {
    const at = (layer) => screenStrip({ pub: UNITE, priv: PRIV, myId: 'p2', home: 'u', combat: true, battleFieldId: 'u', field: uField, layers: cameraLayers(uField, UNITE, 'p2'), layer }).ownerId;
    assert.deepEqual([at('ALL'), at('R'), at('L')], ['p2', 'p2', 'ai_4']);
  });
  test('Final Assault, eliminated spectator: auto-observed pair 全景 → the first player; a picked player → them; the lone field → its player', () => {
    assert.equal(S({ pub: FA, combat: true, battleFieldId: 'b1', field: b1, layer: 'ALL' }).ownerId, 'p2', 'never the spectator\'s own');
    assert.equal(S({ pub: FA, combat: true, battleFieldId: 'b1', field: b1, layer: 'R' }).ownerId, 'p3');
    const pick = S({ pub: FA, combat: true, watchingOther: true, watching: 'b1', battleFieldId: 'b1', field: b1, layer: 'ALL', who: { fieldId: 'b1', playerId: 'p3' } });
    assert.deepEqual([pick.ownerId, pick.name], ['p3', '华法琳']);
    const lone = { fieldId: 'b2', kind: 'boss', players: ['ai_4'], sides: { ai_4: 'L' }, local: true };
    assert.equal(S({ pub: FA, combat: true, watchingOther: true, watching: 'b2', battleFieldId: 'b2', field: lone, who: { fieldId: 'b2', playerId: 'ai_4' } }).ownerId, 'ai_4');
  });
  test('live layers only in the battle phases and SETTLE (prep shows the views)', () => {
    const live = { p2: { sargonShip: 99 } };
    assert.equal(S({ pub: PUB(), watchingOther: true, watching: 'n:p2', bondLayers: live }).bonds[0].layers, 40, 'prep: the view');
    assert.equal(S({ pub: PUB({ phase: 'SETTLE' }), settle: true, battleFieldId: 'n:p2', bondLayers: live }).bonds[0].layers, 99, 'SETTLE: live');
  });
});

describe('§20.15 the ‹ › pill of a shared field watched with 前往查看 (ui/combatHud.js)', () => {
  const layers = [{ key: 'L', label: '华法琳', self: false, watch: true }, { key: 'ALL', label: '全景', self: false, watch: false }, { key: 'R', label: '阿米娅', self: false, watch: true }];
  test('observing + halves: the ‹ › pill (the picked player\'s half) with 返回战场 — no separate observing pill', () => {
    const v = CombatHud({ pub: {}, myId: ME, watching: 'u', hud: null, myDone: false, client: { observing: { name: '阿米娅' }, onBack() {}, layers, layer: 'R', onLayer() {} } });
    const pill = [...walk(v)].find((x) => hasClass(x, 'chud__layers'));
    assert.ok(pill && hasClass(pill, 'is-observing'));
    assert.match(textOf(pill), /阿米娅/);
    assert.match(textOf(pill), /返回战场/);
    assert.ok(![...walk(v)].some((x) => hasClass(x, 'chud__observe')));
  });
  test('observing a normal field: the "👁 name" pill + 返回战场; a helper\'s own pill has no 返回战场', () => {
    const v = CombatHud({ pub: {}, myId: ME, watching: 'n:p2', hud: null, myDone: true, client: { observing: { name: '阿米娅' }, onBack() {}, layers: [], layer: 'ALL' } });
    const pill = [...walk(v)].find((x) => hasClass(x, 'chud__observe'));
    assert.ok(pill && /阿米娅/.test(textOf(pill)) && /返回战场/.test(textOf(pill)));
    const own = CombatHud({ pub: {}, myId: ME, watching: null, hud: null, myDone: false, client: { observing: null, onBack() {}, layers, layer: 'ALL', onLayer() {} } });
    const p2 = [...walk(own)].find((x) => hasClass(x, 'chud__layers'));
    assert.ok(p2 && !hasClass(p2, 'is-observing') && !/返回战场/.test(textOf(p2)));
  });
});

describe('§20.15 the bonds: views + live layers', () => {
  test('ownerBonds: your m.private list, a teammate\'s m.public list', () => {
    assert.equal(ownerBonds({ pub: PUB(), priv: PRIV, myId: ME, ownerId: ME }), PRIV.bonds);
    assert.deepEqual(ownerBonds({ pub: PUB(), priv: null, myId: ME, ownerId: ME }), PUB().players[0].bonds, 'no m.private yet: the public row');
    assert.deepEqual(ownerBonds({ pub: PUB(), priv: PRIV, myId: ME, ownerId: 'p2' }).map((b) => b.bondId), ['sargonShip', 'kjeragShip']);
    assert.deepEqual(ownerBonds({ pub: PUB(), priv: PRIV, myId: ME, ownerId: 'nobody' }), []);
  });
  test('withLiveLayers: the battle\'s absolute counts lift the view\'s, never lower them, never past 999; a new bond joins', () => {
    const list = [bond('sargonShip', 2, 40, 1), bond('kjeragShip', 0, 7, 0)];
    assert.equal(withLiveLayers(list, null), list, 'nothing to lay over: the same list');
    assert.equal(withLiveLayers(list, {}), list);
    const out = withLiveLayers(list, { sargonShip: 46, kjeragShip: 3, victoriaShip: 2 });
    assert.deepEqual(out.map((b) => [b.bondId, b.layers]), [['sargonShip', 46], ['kjeragShip', 7], ['victoriaShip', 2]]);
    assert.deepEqual(out[2], { bondId: 'victoriaShip', count: 0, active: false, tier: 0, layers: 2 });
    assert.equal(list[0].layers, 40, 'the view is not mutated');
    assert.equal(withLiveLayers(list, { sargonShip: 5000 })[0].layers, BOND_LAYER_CAP, 'capped at 999');
    assert.equal(withLiveLayers(list, { sargonShip: 40 }), list, 'equal counts: the same list');
  });
  test('stripView / playerBonds: the owner, the name (null for yourself) and the list with the owner\'s live layers', () => {
    const pub = PUB({ phase: 'COMBAT', fields: [{ fieldId: 'n:p1', kind: 'normal', players: ['p1'], live: false }, { fieldId: 'n:p2', kind: 'normal', players: ['p2'], live: true }] });
    const live = { p1: { yanShip: 15 }, p2: { sargonShip: 44 } };
    const own = stripView({ pub, priv: PRIV, myId: ME, fieldId: 'n:p1', live });
    assert.deepEqual([own.ownerId, own.self, own.name], [ME, true, null]);
    assert.equal(own.bonds[0].layers, 15, 'the own battle\'s live count');
    assert.deepEqual(own.bonds[0].thresholds, [3, 6, 9], 'm.private extras kept');
    const mate = stripView({ pub, priv: PRIV, myId: ME, fieldId: 'n:p2', live });
    assert.deepEqual([mate.ownerId, mate.self, mate.name], ['p2', false, '阿米娅']);
    assert.deepEqual(mate.bonds.map((b) => [b.bondId, b.layers]), [['sargonShip', 44], ['kjeragShip', 7]], 'THEIR bonds, THEIR live count');
    assert.deepEqual(playerBonds({ pub, priv: PRIV, myId: ME, ownerId: 'p3', live }).map((b) => b.layers), [120]);
  });
  test('ownerBoard: the teammate\'s operators on the field on screen feed the popup\'s member list (no hand)', () => {
    const field = { fieldId: 'n:p2', prep: true, units: [
      { id: 1, kind: 'op', side: 'ally', ownerId: 'p2', defId: 'chess_char_1_19_a', area: 'board' },
      { id: 2, kind: 'token', side: 'ally', ownerId: 'p2', defId: 'tok' },
      { id: 3, kind: 'op', side: 'ally', ownerId: 'p3', defId: 'chess_other' },
      { id: 4, kind: 'enemy', side: 'enemy', ownerId: null, defId: 'enemy_1' },
      { id: 5, kind: 'op', side: 'ally', ownerId: 'p2', defId: 'chess_char_1_03_a', area: 'hand' },
      { id: 6, kind: 'op', side: 'ally', ownerId: 'p2', defId: 'chess_char_2_04_a', area: 'temp' },
    ] };
    assert.deepEqual(ownerBoard(field, 'p2'), { board: [{ kind: 'chess', id: 'chess_char_1_19_a' }], hand: [], temp: [] });
    assert.equal(ownerBoard(null, 'p2'), null);
  });
  test('ownerBoard: under client-side combat the battle on screen\'s operators join (the runner\'s meta predates their deploy)', () => {
    const meta = { fieldId: 'b1', local: true, units: [{ id: 90, kind: 'enemy', side: 'enemy', ownerId: null, defId: 'boss' }] };
    const ops = [{ kind: 'op', ownerId: 'p2', defId: 'chess_char_1_09_a' }, { kind: 'op', ownerId: 'p2', defId: 'chess_char_1_03_a' }];
    assert.deepEqual(ownerBoard(meta, 'p2'), { board: [], hand: [], temp: [] }, 'the meta alone: nobody in play');
    assert.deepEqual(ownerBoard(meta, 'p2', ops).board.map((x) => x.id), ['chess_char_1_09_a', 'chess_char_1_03_a']);
    assert.deepEqual(ownerBoard(null, 'p2', ops).board.length, 2, 'the battle alone');
    assert.deepEqual(ownerBoard(meta, 'p3', ops).board, [], 'only that owner\'s');
    const v = popupView({ open: { id: 'sargonShip', ownerId: 'p2' }, pub: PUB(), priv: PRIV, myId: ME, field: meta, units: ops });
    assert.deepEqual(v.priv.board.map((x) => x.id), ['chess_char_1_09_a', 'chess_char_1_03_a'], 'popupView passes them on');
    assert.equal(popupView({ open: { id: 'yanShip', ownerId: ME }, pub: PUB(), priv: PRIV, myId: ME, field: meta, units: ops }).priv, PRIV, 'your own: your pieces');
  });
});

describe('§20.15 the strip and the popup say whose bonds they show', () => {
  const ids = Object.keys(data.get('bonds') || {}).slice(0, 2);
  test('a teammate\'s strip: the amber "👁 name" tag, data-owner, aria-label; your own: none', () => {
    assert.equal(ids.length, 2, 'bonds.json loaded');
    const list = ids.map((id, i) => bond(id, 2 + i, 10 * (i + 1), 1));
    const other = BondStrip({ bonds: list, owner: '阿米娅', onOpen() {} });
    const root = [...walk(other)].find((v) => hasClass(v, 'bstrip'));
    assert.ok(root && hasClass(root, 'is-other'));
    assert.equal(root.props['data-owner'], '阿米娅');
    assert.equal(root.props['aria-label'], '阿米娅 的盟约');
    const tag = [...walk(other)].find((v) => hasClass(v, 'bstrip__owner'));
    assert.ok(tag, 'the owner tag');
    assert.match(textOf(tag), /阿米娅/);
    assert.deepEqual([...walk(other)].filter((v) => hasClass(v, 'bslot')).map((v) => v.props['data-bond']).sort(), [...ids].sort(), 'one slot per bond (data-bond)');
    const mine = BondStrip({ bonds: list, owner: null, onOpen() {} });
    const r2 = [...walk(mine)].find((v) => hasClass(v, 'bstrip'));
    assert.ok(!hasClass(r2, 'is-other') && r2.props['data-owner'] == null);
    assert.ok(![...walk(mine)].some((v) => hasClass(v, 'bstrip__owner')));
  });
  test('a teammate without bonds: "name 尚未激活盟约" with the tag', () => {
    const v = BondStrip({ bonds: [], owner: 'AI·煌', onOpen() {} });
    assert.match(textOf(v), /AI·煌 尚未激活盟约/);
    assert.ok([...walk(v)].some((x) => hasClass(x, 'bstrip__owner')));
    assert.match(textOf(BondStrip({ bonds: [], onOpen() {} })), /部署干员以激活盟约/);
  });
  test('the popup of a teammate\'s bond: "👁 name 的盟约", their count / layers, members from their board', () => {
    const id = ids[0];
    const rec = data.lookup('bonds', id);
    const member = (rec.visibleMembers && rec.visibleMembers[0]) || rec.members[0];
    const v = BondPopup({ bondId: id, entry: bond(id, 2, 333, 1), priv: { board: [{ kind: 'chess', id: member }], hand: [], temp: [] }, owner: '阿米娅', onClose() {} });
    const root = [...walk(v)].find((x) => hasClass(x, 'bpop'));
    assert.ok(hasClass(root, 'is-other') && root.props['data-owner'] === '阿米娅');
    assert.match(root.props['aria-label'], /^阿米娅 的盟约：/);
    assert.match(textOf([...walk(v)].find((x) => hasClass(x, 'bpop__owner'))), /阿米娅.*的盟约/);
    assert.match(textOf([...walk(v)].find((x) => hasClass(x, 'bpop__facts'))), /333/);
    const on = [...walk(v)].filter((x) => hasClass(x, 'bpop__member') && hasClass(x, 'is-on'));
    assert.equal(on.length, 1, 'the teammate\'s operator on the field is the one member in play');
    const own = BondPopup({ bondId: id, entry: bond(id, 2, 5, 1), priv: PRIV, onClose() {} });
    assert.ok(![...walk(own)].some((x) => hasClass(x, 'bpop__owner')));
  });
});

test('§20.15 wiring: the game screen feeds the strip, the popup and the detail card from screenStrip (no viewer data for a teammate)', () => {
  const src = read('public/js/screens/game.js');
  assert.match(src, /const strip = screenStrip\(\{[^}]*field, layers, layer, who: watchWho, bondLayers:/, 'the field on screen, the ‹ › layers, the picked teammate');
  assert.match(src, /<\$\{BondStrip\} bonds=\$\{stripBonds\}[^>]*owner=\$\{strip\.name\}/);
  // the popup carries the player it was opened for: the strip's owner from the strip, the unit owner from a card's chip
  assert.match(src, /const bondPop = popupView\(\{ open: bondOpen, pub, priv, myId, field, units: popOps, live: liveLayers \}\)/);
  assert.match(src, /battleRunner\.ownerOps\(bondOpen\.ownerId, field\.fieldId\)/, 'a teammate\'s members in play: the battle on screen\'s operators');
  assert.match(src, /<\$\{BondPopup\} bondId=\$\{bondPop\.bondId\} entry=\$\{bondPop\.entry\} priv=\$\{bondPop\.priv\}[^>]*owner=\$\{bondPop\.name\}/);
  assert.match(src, /onOpen=\$\{\(id\) => openBond\(id, strip\.ownerId, 'strip'\)\}/, 'the strip opens its owner\'s bond');
  assert.match(src, /const detailOwner = detailBondOwner\(detailTarget, \{ pub, myId, stripOwnerId: strip\.ownerId \}\)/);
  assert.match(src, /onBond=\$\{\(id\) => openBond\(id, detailOwner, 'detail'\)\}/, 'a card\'s chip opens the same owner\'s bond as its chips show');
  assert.match(src, /onMember=\$\{\(id, items, standInFor, diy\) => setDetail\(\{ kind: 'chess', id, owner: bondPop\.ownerId, items: items \|\| null, standInFor: standInFor \|\| null, diy: diy \|\| null \}\)\}/,
    'a member card keeps the popup\'s player (and a 变形同构体 row\'s items, a 补位 row\'s standInFor, a teammate\'s 自选 row\'s pick)');
  assert.match(src, /openId=\$\{bondPop && bondPop\.ownerId === strip\.ownerId \? bondPop\.bondId : null\}/, 'the strip marks only its own owner\'s popup');
  assert.match(src, /setBondOpen\(\(b\) => \(b && b\.from === 'strip' \? null : b\)\)/, 'a strip popup closes when the strip changes hands');
  assert.ok(!/stripBonds\.find\(\(b\) => b\.bondId === bondOpen\)/.test(src), 'no popup entry read from the strip regardless of its owner');
  assert.match(src, /requestWatch\(t\.fieldId, p\.playerId\)/, 'a team-row pick remembers the player');
  assert.match(src, /\(!watchingOther \|\| field\.fieldId === watching\) \? cameraLayers\(field, pub, myId\)/, 'the ‹ › pill on a watched shared field');
  // a reload while watching a teammate's battle: the resent field becomes the watched one again (observing pill, 返回战场)
  assert.match(src, /const r = resumedWatch\(battleState, \{ pub, myId, alive, watching, seen: seenBattleRef\.current \}\);\s*seenBattleRef\.current = r\.seen;\s*if \(r\.fieldId\) setWatching\(r\.fieldId\);/);
});

describe('§20.15 the popup of a card\'s bond chip: the UNIT owner\'s bond (a shared field shows both halves\' units)', () => {
  // a Final Assault pair: p1 (the viewer, left) and p2 (the partner, right) on 'b1'
  const pub = PUB({ phase: 'FINAL_ASSAULT', fields: [{ fieldId: 'b1', kind: 'boss', players: ['p1', 'p2'], live: true }, { fieldId: 'b2', kind: 'boss', players: ['p3', 'ai_4'], live: true }] });
  const units = [
    { id: 11, uid: 1, ownerId: 'p1', side: 'player', kind: 'op', defId: 'chess_char_1_10_a' },
    { id: 21, uid: 1, ownerId: 'p2', side: 'player', kind: 'op', defId: 'chess_char_1_12_a' },
    { id: 22, uid: 2, ownerId: 'p2', side: 'player', kind: 'op', defId: 'chess_char_1_09_a' },
    { id: 90, side: 'enemy', defId: 'enemy_1007_slime' },
  ];
  const b1 = { fieldId: 'b1', kind: 'boss', players: ['p1', 'p2'], sides: { p1: 'L', p2: 'R' }, local: true, units };
  const unit = (id) => ({ kind: 'unit', unitId: id, unit: units.find((u) => u.id === id) });
  test('detailBondOwner: a unit → its owner (a known player); your piece → yours; a member card → the popup\'s player; else the strip\'s', () => {
    assert.equal(detailBondOwner(unit(21), { pub, myId: ME, stripOwnerId: ME }), 'p2', '全景 (strip = yours): the partner\'s unit is the partner\'s');
    assert.equal(detailBondOwner(unit(11), { pub, myId: ME, stripOwnerId: 'p2' }), ME, 'the partner\'s half (strip = theirs): your own unit is yours');
    assert.equal(detailBondOwner(unit(90), { pub, myId: ME, stripOwnerId: 'p2' }), 'p2', 'an enemy (no owner): the strip\'s');
    assert.equal(detailBondOwner({ kind: 'unit', unit: { id: 5, ownerId: 'ghost', defId: 'x' } }, { pub, myId: ME, stripOwnerId: 'p2' }), 'p2', 'an unknown owner: the strip\'s');
    assert.equal(detailBondOwner({ kind: 'unit', unitId: 99, unit: null }, { pub, myId: ME, stripOwnerId: 'p3' }), 'p3', 'an unresolved unit: the strip\'s');
    assert.equal(detailBondOwner({ kind: 'piece', uid: 3 }, { pub, myId: ME, stripOwnerId: 'p2' }), ME, 'your own piece (board / bench)');
    assert.equal(detailBondOwner({ kind: 'chess', id: 'c', owner: 'p2' }, { pub, myId: ME, stripOwnerId: ME }), 'p2', 'a member card of the partner\'s popup');
    assert.equal(detailBondOwner({ kind: 'chess', id: 'c' }, { pub, myId: ME, stripOwnerId: 'p3' }), 'p3', 'a shop / drawer card: the strip\'s');
    assert.equal(detailBondOwner(null, { pub, myId: ME, stripOwnerId: null }), ME);
  });
  test('toggleBond: the same bond of the same player closes; another player\'s or another bond switches', () => {
    const a = toggleBond(null, 'sargonShip', 'p2', 'detail');
    assert.deepEqual(a, { id: 'sargonShip', ownerId: 'p2', from: 'detail' });
    assert.equal(toggleBond(a, 'sargonShip', 'p2', 'strip'), null);
    assert.deepEqual(toggleBond(a, 'sargonShip', ME, 'strip'), { id: 'sargonShip', ownerId: ME, from: 'strip' }, 'the same bond of the viewer: their popup instead');
    assert.deepEqual(toggleBond(a, 'kjeragShip', 'p2', 'detail'), { id: 'kjeragShip', ownerId: 'p2', from: 'detail' });
  });
  test('popupView: the partner\'s bond (entry + live layers, name, their operators as members), never the viewer\'s', () => {
    const v = popupView({ open: { id: 'sargonShip', ownerId: 'p2', from: 'detail' }, pub, priv: PRIV, myId: ME, field: b1, live: { p2: { sargonShip: 55 }, p1: { sargonShip: 3 } } });
    assert.equal(v.ownerId, 'p2');
    assert.equal(v.self, false);
    assert.equal(v.name, '阿米娅');
    assert.deepEqual([v.entry.bondId, v.entry.count, v.entry.active, v.entry.layers], ['sargonShip', 2, true, 55], 'the partner\'s count / tier, their live layers');
    assert.notEqual(v.priv, PRIV, 'not the viewer\'s pieces');
    assert.deepEqual(v.priv.board.map((x) => x.id).sort(), ['chess_char_1_09_a', 'chess_char_1_12_a'], 'the partner\'s operators on the field on screen');
    assert.deepEqual([v.priv.hand, v.priv.temp], [[], []], 'their hand is never sent');
  });
  test('popupView: your own bond (m.private entry with thresholds, your pieces, no name); a bond not listed → no entry; nothing open → null', () => {
    const own = popupView({ open: { id: 'yanShip', ownerId: ME, from: 'detail' }, pub, priv: PRIV, myId: ME, field: b1, live: null });
    assert.deepEqual([own.self, own.name, own.priv], [true, null, PRIV]);
    assert.deepEqual(own.entry.thresholds, [3, 6, 9], 'the m.private entry');
    assert.equal(popupView({ open: { id: 'lateranoShip', ownerId: 'p2' }, pub, priv: PRIV, myId: ME, field: b1 }).entry, null, 'the partner has no such bond');
    assert.equal(popupView({ open: null, pub, priv: PRIV, myId: ME }), null);
    assert.equal(popupView({ open: { id: 'yanShip' }, pub, priv: PRIV, myId: ME }).ownerId, ME, 'no owner: yours');
    const capped = popupView({ open: { id: 'sargonShip', ownerId: 'p2' }, pub, priv: PRIV, myId: ME, field: b1, live: { p2: { sargonShip: 5000 } } });
    assert.equal(capped.entry.layers, BOND_LAYER_CAP, 'never above the 999 cap');
    assert.equal(popupView({ open: { id: 'sargonShip', ownerId: 'p2' }, pub, priv: PRIV, myId: ME, field: null }).priv, null, 'no field on screen: no members');
  });
  test('the reported case end to end: on 全景 the strip is yours, the partner\'s unit chip opens the PARTNER\'s popup — and back', () => {
    const layers = cameraLayers(b1, pub, ME);
    const S = (layer) => screenStrip({ pub, priv: PRIV, myId: ME, combat: true, battleFieldId: 'b1', home: 'b1', field: b1, layers, layer });
    const all = S('ALL');
    assert.deepEqual([all.ownerId, all.self], [ME, true], '全景: your strip');
    const owner = detailBondOwner(unit(21), { pub, myId: ME, stripOwnerId: all.ownerId });
    const chips = owner === all.ownerId ? all.bonds : playerBonds({ pub, priv: PRIV, myId: ME, ownerId: owner });
    assert.deepEqual(chips.map((b) => b.bondId), ['sargonShip', 'kjeragShip'], 'the card\'s chips: the partner\'s bonds');
    const pop = popupView({ open: toggleBond(null, 'sargonShip', owner, 'detail'), pub, priv: PRIV, myId: ME, field: b1 });
    assert.deepEqual([pop.name, pop.entry.count, pop.entry.layers], ['阿米娅', 2, 40], 'the popup: the partner\'s, labelled');
    // the partner's half (strip = theirs): your own unit's chip opens YOUR popup, unlabelled
    const right = S('R');
    assert.equal(right.ownerId, 'p2');
    const mine = detailBondOwner(unit(11), { pub, myId: ME, stripOwnerId: right.ownerId });
    const pop2 = popupView({ open: toggleBond(null, 'yanShip', mine, 'detail'), pub, priv: PRIV, myId: ME, field: b1 });
    assert.deepEqual([pop2.self, pop2.name, pop2.entry.layers], [true, null, 12]);
  });
});
