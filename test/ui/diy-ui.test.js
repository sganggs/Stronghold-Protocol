// 0.2.0 自选编队 — client side (research 0.2.0 §2; the owner's decisions of 2026-10-05): the 自选编队 tab's model (storage,
// the slots, the picker's operators with the kit list, skill / module choices without 集成战略 modules, export / import)
// and its server sync (room.diy; welcome.diyKitted), the tab's components (four slots, the picker, 确认), and the match
// UI of a 自选 piece — the shop / reward card and the detail card show the operator (name, art, class, derived bonds,
// the pick's skill and module) with a 「自选」 badge, the own pieces get a tag, placement reads the operator's position, and
// the bond popup lists the 自选 member (own and a teammate's).
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

const M = await import('../../public/js/ui/diyModel.js');
const { installDiySync, SYNC_DEBOUNCE_MS } = await import('../../public/js/ui/loadoutSync.js');
const { createStore } = await import('../../public/js/store.js');
const G = await import('../../public/js/ui/gameLogic.js');
const { ChessCard } = await import('../../public/js/ui/shopBar.js');
const { ChessDetail, resolveDetail } = await import('../../public/js/ui/detailPanel.js');
const { BondPopup } = await import('../../public/js/ui/bondStrip.js');
const { ownerBoard } = await import('../../public/js/ui/watchBonds.js');
const { diyPieces } = await import('../../public/js/screens/game/standInTags.js');
const { DiyPanelView, DiyPickerView } = await import('../../public/js/screens/diy.js');
const { data } = await import('../../public/js/data.js');
const { DATA } = await import('../match/harness.js');
const { KITTED_CHARS } = await import('../../server/sim/content/kits/index.js');

await data.loadAll('chess', 'bonds', 'assets', 'garrisons', 'items', 'backups');

const D = { chess: DATA.chess, backups: DATA.backups };
const getChess = (id) => (Object.hasOwn(DATA.chess, id) ? DATA.chess[id] : null);
const T5A = 'chess_char_5_diy1_a';
const T5B = 'chess_char_5_diy2_a';
const T6A = 'chess_char_6_diy1_a';
const T6B = 'chess_char_6_diy2_a';
const SIEGE = 'char_112_siege';
const SHARP = 'char_609_acguad';
const KALTS = 'char_003_kalts'; // 凯尔希: an ISW-A module at both elite stages
const SIEGE_PICK = { charId: SIEGE, skillIndex: 2, uniEquipId: 'uniequip_002_siege' };
const KIT = [...KITTED_CHARS];

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
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
const textOf = (v) => [...walk(v)].flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children])).filter((x) => typeof x === 'string' || typeof x === 'number').join('');

describe('自选编队 model (ui/diyModel.js)', () => {
  test('storage: tolerant parse, junk and hostile keys dropped, round trip', () => {
    assert.deepEqual(M.parseStoredDiy(null), {});
    const raw = { v: 1, picks: { [T5A]: SIEGE_PICK, [T6A]: { charId: SHARP }, __proto__x: 1, bad: { charId: 'a b' }, [T6B]: { charId: SIEGE, skillIndex: 99 } } };
    assert.deepEqual(M.parseStoredDiy(raw), { [T5A]: SIEGE_PICK, [T6A]: { charId: SHARP }, [T6B]: { charId: SIEGE } });
    assert.deepEqual(M.toStoredDiy({ [T5A]: SIEGE_PICK }), { v: M.DIY_VERSION, picks: { [T5A]: SIEGE_PICK } });
    assert.equal(M.diyCount({ [T5A]: SIEGE_PICK, [T6A]: null }), 1);
    assert.deepEqual(M.setPick({ [T5A]: SIEGE_PICK }, T5A, null), {});
    assert.deepEqual(M.setPick({}, T6A, { charId: SHARP }), { [T6A]: { charId: SHARP } });
  });

  test('the four slots by tier, with the 调度中心 level that sells them', () => {
    assert.deepEqual(M.diySlotList(D).map((s) => [s.slotId, s.tier, s.shopLevel]), [[T5A, 5, 5], [T5B, 5, 5], [T6A, 6, 6], [T6B, 6, 6]]);
  });

  test('the picker lists only kitted operators (prototypes first), marks one another slot holds', () => {
    const opts = M.pickOptions(T5A, {}, D, KIT);
    const ids = opts.map((o) => o.charId);
    assert.ok(ids.includes(SIEGE) && ids.includes(SHARP) && ids.includes('char_601_cguard'));
    assert.ok(ids.every((id) => KIT.includes(id)), 'no operator without a kit');
    assert.ok(ids.indexOf(SHARP) < ids.indexOf(SIEGE), 'prototypes first');
    assert.deepEqual(opts.find((o) => o.charId === SIEGE).bonds, ['victoriaShip']);
    assert.equal(opts.find((o) => o.charId === SHARP).proto, true);
    assert.ok(!M.pickOptions(T6A, {}, D, KIT).some((o) => o.charId === 'char_601_cguard'), 'a 4★ reserve is a tier-5 pick only');
    // taken: an owned operator in any other slot; a prototype in the other slot of its tier (not across tiers)
    const roster = { [T5B]: { charId: SHARP }, [T6A]: SIEGE_PICK };
    const at5 = M.pickOptions(T5A, roster, D, KIT);
    assert.equal(at5.find((o) => o.charId === SIEGE).taken, T6A);
    assert.equal(at5.find((o) => o.charId === SHARP).taken, T5B);
    assert.equal(M.pickOptions(T6B, roster, D, KIT).find((o) => o.charId === SHARP).taken, null, 'a prototype may fill a tier-5 and a tier-6 slot');
    assert.deepEqual(M.pickOptions(T5A, {}, D, []), [], 'no kit list (not connected): nothing to pick');
  });

  test('choices: three skills, the elite form\'s modules without the 集成战略 (ISW-A) ones; a prototype\'s locked selection', () => {
    const ch = M.pickChoices(SIEGE, T6A, D);
    assert.deepEqual(ch.skills.map((s) => s.index), [0, 1, 2]);
    assert.deepEqual(ch.modules.map((x) => x.uniEquipId), ['uniequip_002_siege', 'uniequip_003_siege']);
    assert.equal(ch.stage, 3);
    assert.equal(M.pickChoices(SIEGE, T5A, D).stage, 1);
    const kalts = M.pickChoices(KALTS, T6A, D);
    assert.ok(kalts.elite.modules.some((x) => x.typeName === 'ISW-A'), 'the form has one');
    assert.ok(!kalts.modules.some((x) => x.rec.typeName === 'ISW-A'), 'never offered');
    const proto = M.pickChoices(SHARP, T5A, D);
    assert.equal(proto.proto, true);
    assert.deepEqual(proto.locked, { skillIndex: 2, uniEquipId: 'uniequip_002_acguad' });
    assert.deepEqual(M.defaultPick(SIEGE, T5A, D), { charId: SIEGE, skillIndex: 2, uniEquipId: 'uniequip_002_siege' }, 'S3 and the first module');
    assert.deepEqual(M.defaultPick(SHARP, T5A, D), { charId: SHARP });
  });

  test('sanitize keeps what the server keeps; export / import envelopes', () => {
    assert.deepEqual(M.sanitizeDiyPicks({ [T5A]: SIEGE_PICK, [T6A]: { charId: SIEGE, skillIndex: 0 } }, D, KIT), { [T5A]: SIEGE_PICK });
    const text = M.serializeDiy({ [T5A]: SIEGE_PICK }, { now: 0 });
    const env = JSON.parse(text);
    assert.deepEqual([env.kind, env.v, env.count, env.picks], [M.DIY_EXPORT_KIND, 1, 1, { [T5A]: SIEGE_PICK }]);
    assert.deepEqual(M.parseDiyImport(text), { ok: true, picks: { [T5A]: SIEGE_PICK } });
    assert.deepEqual(M.parseDiyImport({ v: 1, picks: {} }), { ok: true, picks: {} });
    for (const bad of ['', '{nope', { v: 9, picks: {} }, { kind: 'stronghold.ownership', v: 1, notOwned: [] }, 'x'.repeat(M.DIY_IMPORT_MAX_BYTES + 1), [1]]) {
      assert.equal(M.parseDiyImport(bad).ok, false, JSON.stringify(bad).slice(0, 30));
    }
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
        const next = [...q.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
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

test('diy sync: welcome brings the kit list and sends room.diy; edits are debounced; in a match stored for the next one (told once)', async () => {
  const net = fakeNet();
  const T = fakeTimers();
  const told = [];
  const target = createStore({ diy: { [T5A]: SIEGE_PICK }, diyKitted: null, open: false, diySync: 'idle' });
  const s = installDiySync({ net, timers: T, target, notify: (x) => told.push(x) });
  net.emit('welcome', { diyKitted: [SIEGE, SHARP, 7] });
  assert.deepEqual(target.get().diyKitted, [SIEGE, SHARP]);
  await T.advance(100);
  assert.deepEqual(net.sent, [{ t: 'room.diy', picks: { [T5A]: SIEGE_PICK } }]);
  assert.equal(target.get().diySync, 'synced');
  target.set({ diy: { [T5A]: SIEGE_PICK, [T6A]: { charId: SHARP } } });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.deepEqual(net.sent[1], { t: 'room.diy', picks: { [T5A]: SIEGE_PICK, [T6A]: { charId: SHARP } } });
  net.replies.push({ error: 'ROOM_STARTED' });
  target.set({ diy: {} });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.equal(target.get().diySync, 'locked');
  assert.deepEqual(told, ['自选编队是局外设置，修改将在下一局生效']);
  net.emit('room.state', { inMatch: false });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.deepEqual(net.sent.at(-1), { t: 'room.diy', picks: {} });
  s.dispose();
});

// ---- the tab --------------------------------------------------------------------------------------------------------------

describe('自选编队 tab (screens/diy.js)', () => {
  for (const slotId of [T5A, T6A]) {
    for (const saved of [null, SIEGE_PICK]) {
      test(`the picker: ${slotId}, ${saved ? 'saved' : 'empty'} slot retains edits when reselecting its operator`, () => {
        const picks = saved ? { [slotId]: saved } : {};
        const done = [];
        let draft = saved ? { ...saved } : null;
        let filter = 'all';
        let query = '';
        const view = () => expand(DiyPickerView({ m: null, slot: { slotId }, picks, kitted: KIT,
          onDone: (p) => done.push(p), onClose() {}, filter, query, draft,
          onFilter: (f) => { filter = f; }, onQuery: (q) => { query = q; }, onDraft: (d) => { draft = d; } }));
        const click = (key, value) => {
          const node = [...walk(view())].find((v) => v.props?.[key] === value && typeof v.props.onClick === 'function');
          assert.ok(node, `${key}=${value} is clickable`);
          node.props.onClick();
        };
        click('data-char', SIEGE);
        click('data-skill', 0);
        click('data-module', 'none');
        const edited = { charId: SIEGE, skillIndex: 0, uniEquipId: null };
        assert.deepEqual(draft, edited);
        click('data-char', SIEGE);
        assert.deepEqual(draft, edited, 'reselecting keeps both the skill and explicit no-module choice');
        // Filtering/searching the operator out and back in must not change the draft either.
        filter = 'owned';
        query = 'no matching operator';
        assert.ok(![...walk(view())].some((v) => hasClass(v, 'diy-opt')));
        query = '推进';
        click('data-char', SIEGE);
        assert.deepEqual(draft, edited);
        click('data-testid', 'diy-confirm');
        assert.deepEqual(done, [edited]);
        assert.deepEqual(picks, saved ? { [slotId]: saved } : {}, 'the saved picks stay unchanged until the parent saves');
        // Switching operators still initializes the new pick, and returning restores the saved/default pick.
        filter = 'all';
        query = '';
        click('data-char', SHARP);
        assert.deepEqual(draft, M.defaultPick(SHARP, slotId, D));
        click('data-char', SIEGE);
        assert.deepEqual(draft, saved || M.defaultPick(SIEGE, slotId, D));
      });
    }
  }

  test('four slots by tier: an empty slot to fill, a filled one shows the operator, its tag, skill and module', () => {
    const tree = expand(DiyPanelView({ m: data.get('assets'), picks: { [T5A]: SIEGE_PICK, [T6A]: { charId: SHARP } }, legal: { [T5A]: SIEGE_PICK, [T6A]: { charId: SHARP } }, kitted: KIT, onSet() {}, picking: null, onPicking() {} }));
    const slots = [...walk(tree)].filter((v) => hasClass(v, 'diy-slot'));
    assert.deepEqual(slots.map((v) => v.props['data-slot']), [T5A, T5B, T6A, T6B]);
    const siege = slots[0];
    assert.equal(siege.props['data-char'], SIEGE);
    const txt = textOf(siege);
    assert.ok(txt.includes(DATA.backups.units[SIEGE].name) && txt.includes('已持有') && txt.includes('S3') && txt.includes('SOL-X'), txt);
    assert.ok(textOf(slots[2]).includes('原型'));
    assert.ok(hasClass(slots[1], 'is-empty') && textOf(slots[1]).includes('选择干员'));
  });

  test('the picker: the slot\'s operators; choosing one and its skill / module confirms the pick', () => {
    const done = [];
    let draft = { ...SIEGE_PICK };
    const view = () => expand(DiyPickerView({ m: null, slot: { slotId: T5A, tier: 5, shopLevel: 5 }, picks: { [T5A]: SIEGE_PICK }, kitted: KIT, onDone: (p) => done.push(p), onClose() {},
      filter: 'all', query: '', draft, onFilter() {}, onQuery() {}, onDraft: (d) => { draft = d; } }));
    let tree = view();
    const opts = [...walk(tree)].filter((v) => hasClass(v, 'diy-opt'));
    assert.ok(opts.some((v) => v.props['data-char'] === SIEGE) && opts.some((v) => v.props['data-char'] === SHARP));
    // the current pick is shown with its three skills and its modules (none + X + Y)
    const skills = [...walk(tree)].filter((v) => v.props?.role === 'radio' && v.props['data-skill'] != null);
    assert.deepEqual(skills.map((v) => v.props['data-skill']), [0, 1, 2]);
    assert.equal(skills.find((v) => v.props['aria-checked'] === 'true').props['data-skill'], 2);
    const mods = [...walk(tree)].filter((v) => v.props?.role === 'radio' && v.props['data-module'] != null);
    assert.deepEqual(mods.map((v) => v.props['data-module']), ['none', 'uniequip_002_siege', 'uniequip_003_siege']);
    // another skill and no module, then 确认
    skills.find((v) => v.props['data-skill'] === 0).props.onClick();
    tree = view();
    [...walk(tree)].find((v) => v.props?.role === 'radio' && v.props['data-module'] === 'none').props.onClick();
    tree = view();
    [...walk(tree)].find((v) => v.props?.['data-testid'] === 'diy-confirm').props.onClick();
    assert.deepEqual(done, [{ charId: SIEGE, skillIndex: 0, uniEquipId: null }]);
    // a prototype: its locked skill only; 确认 sends just the operator (the server completes the locked selection)
    [...walk(tree)].find((v) => hasClass(v, 'diy-opt') && v.props['data-char'] === SHARP).props.onClick();
    tree = view();
    assert.deepEqual([...walk(tree)].filter((v) => v.props?.role === 'radio' && v.props['data-skill'] != null).map((v) => [v.props['data-skill'], v.props.disabled]), [[2, true]]);
    [...walk(tree)].find((v) => v.props?.['data-testid'] === 'diy-confirm').props.onClick();
    assert.deepEqual(done.at(-1), { charId: SHARP });
  });
});

// ---- match UI -------------------------------------------------------------------------------------------------------------

describe('match UI of a 自选 piece', () => {
  const priv = { diy: { [T5A]: SIEGE_PICK, [T6A]: { charId: SHARP, skillIndex: 2, uniEquipId: 'uniequip_002_acguad' } }, loadout: {}, standIns: [], board: [], hand: [], temp: [] };
  test('gameLogic: the own pick of a slot (normal + elite), the composed record, the own getter', () => {
    assert.deepEqual(G.ownDiyPick(priv, getChess(T5A)), SIEGE_PICK);
    assert.deepEqual(G.ownDiyPick(priv, getChess('chess_char_5_diy1_b')), SIEGE_PICK, 'the elite too');
    assert.equal(G.ownDiyPick(priv, getChess(T5B)), null, 'a slot not filled');
    assert.equal(G.ownDiyPick(priv, getChess('chess_char_4_22_a')), null);
    const rec = G.ownDiyRecord(getChess(T5A), priv, D);
    assert.deepEqual([rec.name, rec.charId, rec.diyFor, rec.bonds, rec.tier, rec.price], [DATA.backups.units[SIEGE].name, SIEGE, T5A, ['victoriaShip'], 5, 4]);
    assert.equal(G.ownDiyRecord(getChess(T5A), priv, D), rec, 'cached');
    const get = G.diyGetter(getChess, priv, D);
    assert.equal(get(T5A), rec);
    assert.equal(get('chess_char_4_22_a'), getChess('chess_char_4_22_a'));
    assert.equal(G.chessLoadout(get('chess_char_5_diy1_b'), priv.loadout, get).skill.skillId, 'skchr_siege_3', 'the pick\'s skill');
    assert.equal(G.deployedModuleId(get('chess_char_5_diy1_b'), priv, get, D.backups), 'uniequip_002_siege', 'the pick\'s module on the elite');
    assert.equal(G.cardDiy(getChess(T5A), { unit: { diy: { charId: SHARP, skillIndex: 2, uniEquipId: 'uniequip_002_acguad' } }, data: D }).charId, SHARP, 'a teammate\'s unit says it itself');
  });

  test('placement reads the operator\'s position (推进之王 melee) through the own getter', () => {
    const get = G.diyGetter(getChess, priv, D);
    const ctx = G.placementContext({ priv, stage: null, editable: true, getChess: get, backups: D.backups });
    assert.equal(G.piecePosition(ctx, { kind: 'chess', id: T5A }), 'MELEE');
  });

  test('shop / reward card: the operator\'s name and bonds, the 「自选」 badge, the pick\'s skill', () => {
    const card = ChessCard({ slot: { kind: 'chess', id: T5A, price: 4, basePrice: 4 }, idx: 0, priv, onBuy() {}, onDetail() {} });
    const nodes = [...walk(card)];
    const badge = nodes.find((v) => hasClass(v, 'scard__diy'));
    assert.ok(badge);
    assert.equal(badge.props['data-diy'], SIEGE);
    assert.equal(badge.props.children, '自选');
    assert.equal(nodes.find((v) => hasClass(v, 'scard__name')).props.children, DATA.backups.units[SIEGE].name);
    assert.ok(nodes.some((v) => v.props?.bondId === 'victoriaShip'), 'the derived bond');
    assert.equal(nodes.find((v) => v?.type && v.props?.lo).props.lo.skill.skillId, 'skchr_siege_3');
    const other = ChessCard({ slot: { kind: 'chess', id: T5A, price: 4, basePrice: 4 }, idx: 0, priv: { diy: {} }, onBuy() {}, onDetail() {} });
    assert.equal([...walk(other)].find((v) => hasClass(v, 'scard__diy')), undefined);
  });

  test('detail card: own piece / card / a unit carrying diy → the operator, the 「自选」 tag, the pick\'s skill and module', () => {
    const piece = { uid: 7, kind: 'chess', id: 'chess_char_5_diy1_b', golden: true, items: [] };
    const pieces = new Map([[7, { piece, area: 'board', row: 10, col: 4 }]]);
    const r = resolveDetail({ kind: 'piece', uid: 7 }, pieces, { priv, backups: D.backups });
    assert.equal(r.chess.charId, SIEGE);
    assert.deepEqual(r.diy, SIEGE_PICK);
    assert.equal(resolveDetail({ kind: 'chess', id: T5A }, new Map(), { priv, backups: D.backups }).chess.charId, SIEGE, 'a shop card');
    assert.equal(resolveDetail({ kind: 'chess', id: T5A, foreign: true }, new Map(), { priv, backups: D.backups }).diy, undefined, 'the banned list / another player\'s card');
    const u = resolveDetail({ kind: 'unit', unit: { id: 3, uid: 33, side: 'ally', kind: 'op', defId: T6A, diy: { charId: SHARP, skillIndex: 2, uniEquipId: 'uniequip_002_acguad' } } }, new Map(), { priv: null, backups: D.backups });
    assert.equal(u.chess.charId, SHARP);
    const blocks = ChessDetail({ chess: r.chess, piece, editable: false, bonds: [], loadout: priv.loadout, diy: r.diy });
    const head = blocks.find((b) => b.key === 'head');
    assert.equal([...walk(head)].find((v) => hasClass(v, 'dtag-diy'))?.props.children, '自选');
    assert.equal([...walk(head)].find((v) => hasClass(v, 'dhead__name')).props.children, DATA.backups.units[SIEGE].name);
    const skill = blocks.find((b) => b.key === 'skill');
    assert.ok(JSON.stringify(skill.props).includes('skchr_siege_3'));
    const mod = blocks.find((b) => b.key === 'module');
    assert.ok(JSON.stringify(mod.props).includes('uniequip_002_siege'), 'the pick\'s module (elite)');
    assert.ok(!blocks.some((b) => b.key === 'garrison'), 'no 特质');
  });

  test('own prep pieces of a filled slot get the 「自选」 tag', () => {
    const p = { ...priv, hand: [{ uid: 1, kind: 'chess', id: T5A }, { uid: 2, kind: 'chess', id: 'chess_char_4_22_a' }], temp: [], board: [{ uid: 4, kind: 'chess', id: 'chess_char_6_diy1_b', row: 10, col: 4 }] };
    assert.deepEqual(diyPieces(p, getChess, D).map((x) => [x.uid, x.area, x.label, x.name]), [[1, 'hand', '自选', DATA.backups.units[SIEGE].name], [4, 'board', '自选', DATA.backups.units[SHARP].name]]);
    assert.deepEqual(diyPieces({ ...p, diy: {} }, getChess, D), []);
  });

  test('bonds: the popup lists the own 自选 member (煌-style several bonds count each) and a teammate\'s by its unit\'s pick', () => {
    const get = G.diyGetter(getChess, priv, D);
    const own = { ...priv, board: [{ uid: 4, kind: 'chess', id: T5A, row: 10, col: 4 }], hand: [{ uid: 5, kind: 'chess', id: T6A }] };
    const vic = G.bondMembers(DATA.bonds.victoriaShip, own, [], get);
    const row = vic.find((x) => x.diy);
    assert.deepEqual([row.id, row.name, row.onBoard, row.owned, row.rec.charId], [T5A, DATA.backups.units[SIEGE].name, true, true, SIEGE]);
    const empty = G.bondMembers(DATA.bonds.emptyShip, own, [], get);
    assert.deepEqual(empty.filter((x) => x.diy).map((x) => [x.id, x.inHand]), [[T6A, true]], 'the prototype in the hand counts for 协防');
    assert.equal(G.memberHeadCount(vic.filter((x) => x.diy)), 1);
    // a watched teammate: its board from the field units, their picks carried along (watchBonds ownerBoard)
    const field = { units: [{ kind: 'op', ownerId: 'p_2', defId: T5B, diy: { charId: 'char_017_huang', skillIndex: 0, uniEquipId: null } }] };
    const mate = ownerBoard(field, 'p_2');
    assert.deepEqual(mate.board[0].diy, { charId: 'char_017_huang', skillIndex: 0, uniEquipId: null });
    const pieceRecord = (p) => (p.diy ? G.diyRecordFor(getChess(p.id), p.diy, D) : null) || getChess(p.id);
    for (const b of ['yanShip', 'victoriaShip']) {
      const rows = G.bondMembers(DATA.bonds[b], mate, [], getChess, () => null, pieceRecord);
      assert.ok(rows.some((x) => x.diy && x.rec.charId === 'char_017_huang'), `煌 is a ${b} member`);
    }
    // the popup itself renders the 自选 row with its tag
    const pop = expand(BondPopup({ bondId: 'victoriaShip', entry: { count: 1, active: false, tier: 0, layers: 0 }, priv: own, onClose() {} }));
    const mrow = [...walk(pop)].find((v) => hasClass(v, 'bpop__member') && textOf(v).includes(DATA.backups.units[SIEGE].name));
    assert.ok(mrow, 'the 自选 member row');
    assert.ok([...walk(mrow)].some((v) => hasClass(v, 'bpop__diy')), 'tagged 自选');
  });

  test('the renderer draws the operator (pieceInfo reads m.private.diy; UnitInfo diy is kept)', () => {
    const src = readFileSync(path.join(ROOT, 'public/js/render/app.js'), 'utf8');
    assert.match(src, /const pick = chess && chess\.isDiy \? diyPicks\[chess\.baseId \|\| chess\.chessId\] : null;/);
    assert.match(src, /diyPicks = src\.diy && typeof src\.diy === 'object' \? src\.diy : \{\};/);
    assert.match(readFileSync(path.join(ROOT, 'public/js/render/app/info.js'), 'utf8'), /diy: u\.diy && typeof u\.diy === 'object'/);
  });
});
