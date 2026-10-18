// 0.2.0 补位 — client side (the approved plan, owner's decision 2026-10-05): the 干员持有 tab's model (storage, toggles,
// the roster by tier, export / import) and its server sync (room.ownership), and the match UI of a not-owned chess —
// SHOWN as its stand-in wherever the player's copy appears (the owner's recall of the official mode, 2026-10-06): the
// shop / reward card (the stand-in's portrait, name, class and skill; the chess's bonds and price; a small 「替补」 mark),
// the own pieces (the stand-in's model in the hand, 临时整备区 and on the board, a 「替补」 tag), the detail card (the
// stand-in's portrait, name, skill, talents; the chess's bonds and 特质; 「银灰的替补」), the bond popups (own and a
// teammate's), the result lineup and the equip-replace dialog — while the rules keep the chess (placement and ranges
// by the stand-in's body, as before).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const M = await import('../../public/js/ui/ownershipModel.js');
const { installOwnershipSync, SYNC_DEBOUNCE_MS } = await import('../../public/js/ui/loadoutSync.js');
const { createStore } = await import('../../public/js/store.js');
const G = await import('../../public/js/ui/gameLogic.js');
const { ChessCard } = await import('../../public/js/ui/shopBar.js');
const { ChessDetail, resolveDetail } = await import('../../public/js/ui/detailPanel.js');
const { BondPopup } = await import('../../public/js/ui/bondStrip.js');
const { ownerBoard } = await import('../../public/js/ui/watchBonds.js');
const { replaceRequest } = await import('../../public/js/ui/equipReplace.js');
const { LineupThumb } = await import('../../public/js/screens/result.js');
const { standInPieces } = await import('../../public/js/screens/game/standInTags.js');
const { OwnCard } = await import('../../public/js/screens/ownership.js');
const { data } = await import('../../public/js/data.js');
const { DATA } = await import('../match/harness.js');

await data.loadAll('chess', 'bonds', 'assets', 'garrisons', 'items', 'backups');

const getChess = (id) => (Object.hasOwn(DATA.chess, id) ? DATA.chess[id] : null);
const BACKUPS = DATA.backups;
const SILVER = 'chess_char_4_22_a'; // 银灰 → Sharp (S2 亮剑)
const MLYSS = 'chess_char_6_11_a'; // 缪尔赛思 (RANGED) → 郁金香 (MELEE)
const SARIA = 'chess_char_5_11_a'; // 塞雷娅 (MELEE) → Touch (RANGED)
const CATHY = 'chess_char_4_11_a'; // 凯瑟琳 (PRESET)

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const textOf = (v) => [...walk(v)].flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children])).filter((x) => typeof x === 'string' || typeof x === 'number').join('');
/** Render a component tree one level of function components deep at a time (htm vnodes with function types). */
function expand(v, depth = 6) {
  if (Array.isArray(v)) return v.map((x) => expand(x, depth));
  if (!v || typeof v !== 'object') return v;
  if (typeof v.type === 'function' && depth > 0) {
    try { return expand(v.type(v.props || {}), depth - 1); } catch { return v; }
  }
  const children = v.props?.children;
  return children === undefined ? v : { ...v, props: { ...v.props, children: expand(children, depth) } };
}
const srcsOf = (v) => [...walk(v)].map((n) => n.props?.src).filter((x) => typeof x === 'string');

describe('干员持有 model (ui/ownershipModel.js)', () => {
  test('storage: tolerant parse, clean sorted ids, round trip; hostile keys dropped', () => {
    assert.deepEqual(M.parseStoredOwnership(null), []);
    assert.deepEqual(M.parseStoredOwnership({ v: 1, notOwned: [SILVER, 'bad id', SILVER, '__proto__', 7, SARIA] }), [SILVER, SARIA].sort());
    assert.deepEqual(M.parseStoredOwnership([MLYSS]), [MLYSS], 'a bare array of an older build');
    assert.deepEqual(M.toStoredOwnership([SARIA, SILVER]), { v: M.OWNERSHIP_VERSION, notOwned: [SILVER, SARIA].sort() });
    assert.deepEqual(M.sanitizeNotOwned([SILVER, CATHY, 'chess_char_9_99_a', getChess(SILVER).goldenId], getChess), [SILVER], 'droppable chess only');
  });
  test('toggles: setOwned / isOwned return new sorted lists', () => {
    let list = [];
    list = M.setOwned(list, SARIA, false);
    list = M.setOwned(list, SILVER);
    assert.deepEqual(list, [SILVER, SARIA].sort());
    assert.equal(M.isOwned(list, SILVER), false);
    assert.equal(M.isOwned(list, MLYSS), true);
    assert.deepEqual(M.setOwned(list, SILVER, true), [SARIA]);
    assert.deepEqual(list, [SILVER, SARIA].sort(), 'input unchanged');
  });
  test('roster: the 53 NORMAL chess of the shop by tier (6 / 13 / 17 / 17); each has its stand-in summary', () => {
    const roster = M.ownershipRoster(data.list('chess'));
    assert.equal(roster.length, 53);
    assert.ok(!roster.some((c) => c.chessType !== 'NORMAL' || c.isGolden || !c.visible));
    assert.deepEqual(M.rosterByTier(roster).map((g) => [g.tier, g.list.length]), [[3, 6], [4, 13], [5, 17], [6, 17]]);
    for (const c of roster) {
      const si = M.standInSummary(c, BACKUPS);
      assert.ok(si && si.charId === c.backup.charId && si.skill.index === c.backup.skillIndex, c.chessId);
    }
    assert.equal(M.standInSummary(getChess(SILVER), BACKUPS).name, 'Sharp');
    assert.equal(M.notOwnedCount([SILVER, CATHY, 'chess_char_6_10_a'], roster), 1, 'PRESET / retired ids do not count');
  });
  test('export / import: versioned envelope, bare arrays and text; junk, newer versions and other kinds refused', () => {
    const text = M.serializeOwnership([SARIA, SILVER], { now: 0 });
    const env = JSON.parse(text);
    assert.deepEqual([env.kind, env.v, env.count, env.notOwned], [M.OWNERSHIP_EXPORT_KIND, 1, 2, [SILVER, SARIA].sort()]);
    assert.deepEqual(M.parseOwnershipImport(text), { ok: true, notOwned: [SILVER, SARIA].sort() });
    assert.deepEqual(M.parseOwnershipImport([MLYSS]), { ok: true, notOwned: [MLYSS] });
    assert.deepEqual(M.parseOwnershipImport({ v: 1, notOwned: [] }), { ok: true, notOwned: [] }, 'an empty list = everything owned');
    assert.equal(M.parseOwnershipImport('').ok, false);
    assert.equal(M.parseOwnershipImport('{nope').ok, false);
    assert.equal(M.parseOwnershipImport({ v: 9, notOwned: [] }).ok, false);
    assert.equal(M.parseOwnershipImport({ kind: 'stronghold.loadout', v: 1, entries: {} }).ok, false);
    assert.equal(M.parseOwnershipImport('x'.repeat(M.OWNERSHIP_IMPORT_MAX_BYTES + 1)).ok, false);
  });
  test('the 干员持有 card is a switch: operator → stand-in; a tap asks for the other state', () => {
    const calls = [];
    const card = OwnCard({ m: data.get('assets'), chess: getChess(SILVER), backups: BACKUPS, owned: true, onToggle: (id, owned) => calls.push([id, owned]) });
    assert.equal(card.props.role, 'switch');
    assert.equal(card.props['aria-checked'], 'true');
    assert.ok(textOf(card).includes('银灰') && textOf(card).includes('Sharp') && textOf(card).includes('S2'));
    card.props.onClick();
    assert.deepEqual(calls, [[SILVER, false]]);
    const off = OwnCard({ m: null, chess: getChess(SILVER), backups: BACKUPS, owned: false, onToggle() {} });
    assert.ok(hasClass(off, 'is-off'));
    assert.equal(off.props['aria-checked'], 'false');
  });
});

// ---- sync -------------------------------------------------------------------------------------------------------------

function fakeNet() {
  const listeners = new Map();
  const net = {
    status: 'online', sent: [], replies: [],
    on(t, fn) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(fn); return () => listeners.get(t).delete(fn); },
    emit(t, msg) { for (const fn of listeners.get(t) || []) fn(msg); },
    request(t, fields) {
      net.sent.push({ t, ...fields });
      const r = net.replies.shift();
      return r && r.error ? Promise.reject(Object.assign(new Error(r.error), { code: r.error })) : Promise.resolve({ t: 'ok' });
    },
  };
  return net;
}
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const q = new Map();
  return {
    setTimeout: (fn, ms) => { const id = ++seq; q.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => q.delete(id),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...q.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        q.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      now = end;
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
  };
}

test('ownership sync: room.ownership after welcome and after edits (debounced); in a match stored for the next one (told once)', async () => {
  const net = fakeNet();
  const T = fakeTimers();
  const told = [];
  const target = createStore({ notOwned: [SILVER], open: false, ownSync: 'idle' });
  const s = installOwnershipSync({ net, timers: T, target, notify: (t) => told.push(t) });
  net.emit('welcome', {});
  await T.advance(100);
  assert.deepEqual(net.sent, [{ t: 'room.ownership', notOwned: [SILVER] }]);
  assert.equal(target.get().ownSync, 'synced');
  target.set({ notOwned: [SILVER, SARIA].sort() });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.deepEqual(net.sent[1], { t: 'room.ownership', notOwned: [SILVER, SARIA].sort() });
  // a running match: ROOM_STARTED = stored for the next match, not an error; the edit is told once
  net.replies.push({ error: 'ROOM_STARTED' });
  target.set({ notOwned: [] });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.equal(target.get().ownSync, 'locked');
  assert.equal(told.length, 1);
  assert.match(told[0], /下一局生效/);
  // back in the lobby: sent again (accepted)
  net.emit('room.state', { inMatch: false });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.deepEqual(net.sent.at(-1), { t: 'room.ownership', notOwned: [] });
  assert.equal(target.get().ownSync, 'synced');
  s.dispose();
});

// ---- match UI -------------------------------------------------------------------------------------------------------------

describe('match UI of a not-owned chess', () => {
  const priv = { playerId: 'p_0', standIns: [SILVER, MLYSS, SARIA], loadout: {}, board: [], hand: [], temp: [] };
  const SHARP = 'char_609_acguad';
  const sharp = () => BACKUPS.units[SHARP];

  test('gameLogic: own pieces by m.private.standIns (normal + elite); the composed record keeps the identity', () => {
    assert.deepEqual(G.standInIds(priv), [SILVER, MLYSS, SARIA]);
    assert.equal(G.fieldsStandIn(priv, getChess(SILVER)), true);
    assert.equal(G.fieldsStandIn(priv, getChess(getChess(SILVER).goldenId)), true, 'the elite too');
    assert.equal(G.fieldsStandIn({ standIns: [] }, getChess(SILVER)), false);
    assert.equal(G.fieldsStandIn(null, getChess(SILVER)), false);
    const si = G.standInOf(getChess(SILVER), BACKUPS);
    assert.deepEqual([si.charId, si.name, si.standInFor, si.chessId, si.price, si.bonds, si.garrisonIds], [SHARP, 'Sharp', getChess(SILVER).charId, SILVER, getChess(SILVER).price, getChess(SILVER).bonds, getChess(SILVER).garrisonIds]);
    assert.equal(G.standInOf(getChess(SILVER), BACKUPS), si, 'cached');
    assert.equal(G.standInOf(si, BACKUPS), si, 'a composed record is its own stand-in');
    assert.equal(G.standInOf(getChess(CATHY), BACKUPS), null, 'PRESET');
    assert.equal(G.ownStandIn(getChess(SILVER), priv, BACKUPS), si);
    assert.equal(G.ownStandIn(getChess(SILVER), { standIns: [] }, BACKUPS), null);
    assert.equal(G.standInLabel(si), '替补', 'a small mark');
    assert.equal(G.standInLabel(getChess(SILVER)), null);
    assert.equal(G.standInForText('银灰'), '银灰的替补');
    assert.match(G.standInTip(si, '银灰'), /未持有银灰：由替补干员 Sharp 上场/);
    const lo = G.standInLoadout(si, getChess, BACKUPS);
    assert.equal(lo.skill.skillId, 'skchr_acguad_2', 'its backup skill (S2), never the player\'s loadout');
    // the deployed record: the stand-in's for a dropped chess, the loadout's otherwise
    assert.equal(G.deployedRecord(getChess(SILVER), priv, getChess, BACKUPS).charId, SHARP);
    assert.equal(G.deployedRecord(si, priv, getChess, BACKUPS).charId, SHARP, 'a composed record deploys as itself');
    assert.equal(G.deployedRecord(getChess(SILVER), { standIns: [] }, getChess, BACKUPS).charId, getChess(SILVER).charId);
    const eg = getChess(getChess(MLYSS).goldenId);
    assert.equal(G.deployedModuleId(eg, priv, getChess, BACKUPS), eg.backup.uniEquipId, 'the backup module (SOL-X)');
  });

  test('placement: a dropped chess is placed by its stand-in\'s position (缪尔赛思 → 郁金香 melee, 塞雷娅 → Touch ranged)', () => {
    const stage = null; // (the deploy tiles are not needed for the placement class)
    const ctx = G.placementContext({ priv, stage, editable: true, getChess, backups: BACKUPS });
    assert.equal(G.piecePosition(ctx, { kind: 'chess', id: MLYSS }), 'MELEE');
    assert.equal(G.piecePosition(ctx, { kind: 'chess', id: SARIA }), 'RANGED');
    const own = G.placementContext({ priv: { standIns: [] }, stage, editable: true, getChess, backups: BACKUPS });
    assert.equal(G.piecePosition(own, { kind: 'chess', id: MLYSS }), 'RANGED');
    assert.equal(G.piecePosition(own, { kind: 'chess', id: SARIA }), 'MELEE');
  });

  test('shop / reward card: the stand-in\'s portrait, name, class and skill; the chess\'s bonds and price; a small 「替补」 mark', () => {
    const slot = { kind: 'chess', id: SILVER, price: 3, basePrice: 3 };
    const card = ChessCard({ slot, idx: 0, priv, onBuy() {}, onDetail() {} });
    const nodes = [...walk(card)];
    const badge = nodes.find((v) => hasClass(v, 'scard__standin'));
    assert.ok(badge, 'the mark');
    assert.deepEqual([badge.props['data-standin'], badge.props['data-for'], badge.props.children], [SHARP, SILVER, '替补']);
    assert.match(badge.props.title, /银灰/, 'its title names the chess');
    assert.equal(nodes.find((v) => hasClass(v, 'scard__name')).props.children, 'Sharp', 'the stand-in\'s name');
    assert.ok(hasClass(card, 'is-standin'));
    assert.match(card.props['aria-label'], /^Sharp（银灰的替补），价格 3/);
    assert.ok(srcsOf(card).some((u) => u.includes('char_609_acguad_1')), 'the stand-in\'s portrait');
    assert.ok(!srcsOf(card).some((u) => u.includes('svrash')), 'not the replaced operator\'s');
    assert.ok(textOf(nodes.find((v) => hasClass(v, 'scard__class'))).includes(sharp().subProfessionName), 'the stand-in\'s class (无畏者)');
    const bonds = nodes.filter((v) => hasClass(v, 'scard__bond')).map((v) => v.key);
    assert.deepEqual(bonds, getChess(SILVER).bonds, 'the chess\'s bonds still count');
    const skill = nodes.find((v) => v?.type && v.props?.lo);
    assert.equal(skill.props.lo.skill.skillId, 'skchr_acguad_2');
    const owned = ChessCard({ slot, idx: 0, priv: { standIns: [] }, onBuy() {}, onDetail() {} });
    assert.equal([...walk(owned)].find((v) => hasClass(v, 'scard__standin')), undefined, 'owned: no mark');
    assert.equal([...walk(owned)].find((v) => hasClass(v, 'scard__name')).props.children, '银灰');
  });

  test('detail card: the stand-in\'s portrait, name, skill and talents, 「银灰的替补」, the chess\'s bonds and 特质; a unit with standInFor likewise', () => {
    const piece = { uid: 41, kind: 'chess', id: SILVER, golden: false, items: [] };
    const pieces = new Map([[41, { piece, area: 'hand', idx: 0 }]]);
    const r = resolveDetail({ kind: 'piece', uid: 41 }, pieces, { priv, backups: BACKUPS });
    assert.equal(r.standIn?.charId, SHARP);
    assert.equal(resolveDetail({ kind: 'piece', uid: 41 }, pieces, { priv: { standIns: [] }, backups: BACKUPS }).standIn, null);
    assert.equal(resolveDetail({ kind: 'chess', id: SILVER }, new Map(), { priv, backups: BACKUPS }).standIn?.charId, SHARP, 'a shop card');
    const u = resolveDetail({ kind: 'unit', unit: { id: 9, uid: 99, side: 'ally', kind: 'op', defId: SARIA, standInFor: getChess(SARIA).charId } }, new Map(), { priv: null, backups: BACKUPS });
    assert.equal(u.standIn?.charId, 'char_613_acmedc', 'a teammate\'s unit says it itself');
    // a teammate's bond popup row: its own word (standInFor), never the viewer's list
    const mate = resolveDetail({ kind: 'chess', id: SILVER, owner: 'p_1' }, new Map(), { priv, backups: BACKUPS });
    assert.equal(mate.standIn, null, 'the viewer\'s 补位 list is not the teammate\'s');
    assert.equal(resolveDetail({ kind: 'chess', id: SILVER, owner: 'p_1', standInFor: getChess(SILVER).charId }, new Map(), { priv, backups: BACKUPS }).standIn?.charId, SHARP);
    assert.equal(resolveDetail({ kind: 'chess', id: SILVER, foreign: true }, new Map(), { priv, backups: BACKUPS }).standIn, null, 'the banned list: the chess');
    const blocks = ChessDetail({ chess: r.chess, piece, editable: false, bonds: [], loadout: null, standIn: r.standIn });
    const head = blocks.find((b) => b.key === 'head');
    const hn = [...walk(head)];
    const tag = hn.find((v) => hasClass(v, 'dtag-standin'));
    assert.equal(tag?.props.children, '替补');
    assert.equal(hn.find((v) => hasClass(v, 'dhead__name')).props.children, 'Sharp', 'the stand-in\'s name');
    assert.equal(hn.find((v) => hasClass(v, 'dhead__for')).props.children, '银灰的替补', 'the replaced operator, under the name [ASSUMED]');
    assert.ok(srcsOf(head).some((x) => x.includes('char_609_acguad_1')), 'the stand-in\'s portrait');
    assert.ok(textOf(head).includes(sharp().subProfessionName), 'the stand-in\'s class');
    // the chess's bonds (chips) and 特质 (garrison block) still apply
    const chips = hn.find((v) => v?.type && Array.isArray(v.props?.bondIds));
    assert.deepEqual(chips.props.bondIds, getChess(SILVER).bonds);
    const garrison = blocks.find((b) => b.key === 'garrison');
    assert.equal(garrison?.props.garrison?.garrisonId ?? garrison?.props.garrison?.id ?? null, getChess(SILVER).garrisonIds[0], 'the chess\'s 特质');
    const skill = blocks.find((b) => b.key === 'skill');
    assert.ok(JSON.stringify(skill.props).includes(r.standIn.skill.name), 'the stand-in\'s skill');
    const talents = blocks.find((b) => b.key === 'talents');
    for (const t of r.standIn.talents.filter((x) => x.name && !x.hidden)) assert.ok(JSON.stringify(talents.props).includes(t.name), `talent ${t.name}`);
    assert.ok(!JSON.stringify(blocks).includes(getChess(SILVER).skill.name), 'not the replaced operator\'s skill');
    // an owned chess: its own name and English name
    const plain = ChessDetail({ chess: getChess(SILVER), piece, editable: false, bonds: [], loadout: null, standIn: null });
    const ph = [...walk(plain.find((b) => b.key === 'head'))];
    assert.equal(ph.find((v) => hasClass(v, 'dhead__name')).props.children, '银灰');
    assert.equal(ph.find((v) => hasClass(v, 'dhead__for')), undefined);
    // PR #73's 选中干员 voice (DetailPanel `voice`, in battle): the stand-in speaks, like its battle lines (audio.js keys
    // them by UnitInfo spine, the stand-in's model) — never the operator it replaces
    assert.match(readFileSync(path.join(ROOT, 'public/js/ui/detailPanel.js'), 'utf8'),
      /const selectChar = voice && detail\?\.type === 'chess' \? detail\.standIn\?\.assets\?\.voice \|\| detail\.standIn\?\.charId \|\| detail\.chess\?\.assets\?\.voice \|\| detail\.chess\?\.charId \|\| null : null;/);
  });

  test('own prep pieces with stand-ins get a small 「替补」 tag (hand, temp, board); others none', () => {
    const p = {
      standIns: [SILVER],
      hand: [{ uid: 1, kind: 'chess', id: SILVER }, { uid: 2, kind: 'chess', id: CATHY }, null],
      temp: [{ uid: 3, kind: 'chess', id: getChess(SILVER).goldenId }],
      board: [{ uid: 4, kind: 'chess', id: SILVER, row: 10, col: 4 }, { uid: 5, kind: 'token', id: 'x', row: 9, col: 4 }],
    };
    assert.deepEqual(standInPieces(p, getChess, BACKUPS).map((x) => [x.uid, x.area, x.label, x.name]), [[1, 'hand', '替补', 'Sharp'], [3, 'temp', '替补', 'Sharp'], [4, 'board', '替补', 'Sharp']]);
    assert.match(standInPieces(p, getChess, BACKUPS)[0].tip, /未持有银灰/);
    assert.deepEqual(standInPieces({ ...p, standIns: [] }, getChess, BACKUPS), []);
  });

  test('bond popups: the own not-owned member and a teammate\'s stand-in unit are drawn as the stand-in (mark, name), their rows open the stand-in', () => {
    const bond = getChess(SILVER).bonds[0]; // 谢拉格
    const own = { ...priv, board: [{ uid: 4, kind: 'chess', id: SILVER, row: 10, col: 4 }] };
    assert.equal(G.memberStandIn(own, getChess(SILVER), BACKUPS, getChess)?.charId, SHARP, 'own: by m.private.standIns');
    assert.equal(G.memberStandIn({ ...own, standIns: [] }, getChess(SILVER), BACKUPS, getChess), null);
    const seen = [];
    const pop = expand(BondPopup({ bondId: bond, entry: { count: 1, active: false, tier: 0, layers: 0 }, priv: own, onClose() {}, onMember: (...a) => seen.push(a) }));
    const row = [...walk(pop)].find((v) => hasClass(v, 'bpop__member') && v.props['data-standin'] === SHARP);
    assert.ok(row, 'the member row is the stand-in');
    assert.ok(hasClass(row, 'is-on'), 'on the board');
    assert.equal(textOf([...walk(row)].find((v) => hasClass(v, 'bpop__mname'))), 'Sharp');
    assert.ok([...walk(row)].some((v) => hasClass(v, 'uthumb__si')), 'the small 「替补」 mark on the thumbnail');
    assert.ok(srcsOf(row).some((x) => x.includes('char_609_acguad')), 'the stand-in\'s avatar');
    row.props.onClick();
    assert.deepEqual(seen.at(-1), [SILVER, null, getChess(SILVER).charId]);
    // a watched teammate: their unit says it is a stand-in (UnitInfo standInFor → ownerBoard); the viewer's list does not count
    const field = { units: [{ kind: 'op', ownerId: 'p_1', defId: SILVER, standInFor: getChess(SILVER).charId }, { kind: 'op', ownerId: 'p_1', defId: SARIA }] };
    const mate = ownerBoard(field, 'p_1');
    assert.equal(mate.board[0].standInFor, getChess(SILVER).charId);
    assert.equal(mate.board[1].standInFor, undefined);
    assert.equal(G.memberStandIn(mate, getChess(SILVER), BACKUPS, getChess)?.charId, SHARP);
    assert.equal(G.memberStandIn(mate, getChess(SARIA), BACKUPS, getChess), null, 'a teammate\'s own 塞雷娅 stays 塞雷娅');
    const mpop = expand(BondPopup({ bondId: bond, entry: { count: 1, active: false, tier: 0, layers: 0 }, priv: mate, owner: 'P1', onClose() {} }));
    assert.ok([...walk(mpop)].some((v) => hasClass(v, 'bpop__member') && v.props['data-standin'] === SHARP), 'a teammate\'s stand-in row');
  });

  test('result lineup: a lineup entry with standInFor draws the stand-in with the mark; the elite too; others the chess', () => {
    const gd = { chess: getChess, backups: BACKUPS };
    const th = expand(LineupThumb({ u: { id: getChess(SILVER).goldenId, golden: true, tier: 4, standInFor: getChess(SILVER).charId }, gd }));
    assert.ok([...walk(th)].some((v) => hasClass(v, 'uthumb__si') && v.props['data-standin'] === SHARP), 'the mark');
    assert.ok(srcsOf(th).some((x) => x.includes('char_609_acguad')), 'the stand-in\'s avatar');
    assert.equal(th.props.title, 'Sharp（银灰的替补）');
    const plain = expand(LineupThumb({ u: { id: SILVER, tier: 4 }, gd }));
    assert.ok(![...walk(plain)].some((v) => hasClass(v, 'uthumb__si')));
    assert.equal(plain.props.title, '银灰');
  });

  test('equip-replace dialog: the operator is named and drawn as the stand-in it shows', () => {
    const items = [{ uid: 11, id: 'a' }, { uid: 12, id: 'b' }];
    const target = { uid: 1, kind: 'chess', id: SILVER, items };
    const ctx = { pieces: new Map([[1, { piece: target }], [3, { piece: { uid: 3, kind: 'item', id: 'c' } }]]) };
    const intent = { t: 'g.equip', confirmReplace: true, fields: { itemUid: 3, targetUid: 1 } };
    const shown = (id) => G.ownStandIn(getChess(id), priv, BACKUPS) || getChess(id);
    const req = replaceRequest(ctx, intent, shown, () => null);
    assert.equal(req.targetName, 'Sharp');
    assert.equal(req.targetRec?.charId, SHARP);
    assert.equal(replaceRequest(ctx, intent, getChess, () => null).targetRec, null, 'owned: the data\'s record');
  });

  test('the model of a dropped chess is the stand-in\'s in the hand, the 临时整备区 and on the board (render/app.js pieceInfo reads m.private.standIns)', () => {
    const src = readFileSync(path.join(ROOT, 'public/js/render/app.js'), 'utf8');
    assert.match(src, /const si = chess && standInList\.includes\(chess\.baseId \|\| chess\.chessId\) \? data\.standIn\(piece\.id\) : null;/);
    assert.doesNotMatch(src, /area === 'board' && chess && standInList/, 'not only on the board');
    assert.match(src, /standInList = Array\.isArray\(src\.standIns\)/);
    assert.match(src, /const sig = `\$\{info\.kind\}\|\$\{info\.defId\}\|\$\{info\.golden \? 1 : 0\}\|\$\{info\.spine \|\| ''\}`/);
    assert.match(readFileSync(path.join(ROOT, 'public/js/render/app/info.js'), 'utf8'), /standInFor: typeof u\.standInFor === 'string'/);
    // the DOM fallback field draws every own piece of it with the stand-in's avatar and name
    const ff = readFileSync(path.join(ROOT, 'public/js/ui/fallbackField.js'), 'utf8');
    assert.match(ff, /chessAvatarUrl\(mm, ownSi\(chess\) \|\| ownDiy\(chess\) \|\| chess\)/);
    assert.match(ff, /\(ownSi\(chess\) \|\| ownDiy\(chess\) \|\| chess\)\?\.name/);
  });
});
