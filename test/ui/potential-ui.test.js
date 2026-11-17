// test/ui/potential-ui.test.js — the client side of the per-operator 潜能 / 练度 (0.2.2, the owner's decision of
// 2026-10-08: 「调配干员里自己设置吧，默认满潜满加成」): the stored settings (`sp.pref.loadout` { v, entries, ops } — an
// older stored loadout has none = the defaults), their helpers (set / reset / sanitise against the operators the server
// knows), 导出 / 导入 with them, the sync (`room.loadout { entries, ops }`), and the cards: chessLoadout composes the record
// at the operator's potential with its 练度 multiplier (the player's settings, a teammate's unit's own, never a stand-in's),
// a 自选 card at its pick's potential.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cultivationCharIds } from '../../shared/protocol.js';
import {
  parseStoredOps, toStored, opsOf, setOps, resetOps, sanitizeOps, exportPayload, parseImport, changedCount,
  rosterOf, filterRoster,
} from '../../public/js/ui/loadoutModel.js';
import { installLoadoutSync, SYNC_DEBOUNCE_MS, applyLoadoutEntries, loadoutStore, setEntries, setOpsMap } from '../../public/js/ui/loadoutSync.js';
import { createStore } from '../../public/js/store.js';
import { chessLoadout, unitCultivation, standInLoadout, standInOf, ownDiyPick, ownDiyRecord, cardDiy } from '../../public/js/ui/gameLogic.js';
import { CultivationSelects, CultivationSection, cultivationView, potentialEditable } from '../../public/js/screens/cultivation.js';
import { data } from '../../public/js/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (n) => JSON.parse(readFileSync(path.join(ROOT, `data/${n}.json`), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const EFFECTS = load('effects');
const get = (id) => (Object.hasOwn(CHESS, id) ? CHESS[id] : null);
const VENDLA = 'chess_char_1_06_a';
const V = CHESS[VENDLA].charId;
const KALTS = 'char_003_kalts';
const IDS = cultivationCharIds(CHESS, BACKUPS);
const isOp = (id) => IDS.has(id);

test('storage: ops beside the entries; junk / defaults dropped; an older stored loadout has none (the defaults)', () => {
  assert.deepEqual(parseStoredOps({ v: 1, entries: { [VENDLA]: { skill: 0 } } }), {}, 'a 0.2.1 stored loadout');
  assert.deepEqual(parseStoredOps(null), {});
  const raw = { v: 1, entries: {}, ops: { [V]: { potential: 1, cultivate: 0 }, [KALTS]: { potential: 6, cultivate: 3 }, x: 'junk', 'a b': { potential: 1 }, char_y: { potential: 9 }, __proto__: { potential: 1 } } };
  assert.deepEqual(parseStoredOps(raw), { [V]: { potential: 1, cultivate: 0 } });
  // v2 (DESIGN §35.23): the choices by operator beside the ops
  assert.deepEqual(toStored({ [V]: { skill: 0 } }, { [V]: { potential: 2 } }), { v: 2, byChar: { [V]: { skill: 0 } }, ops: { [V]: { potential: 2 } } });
  assert.deepEqual(parseStoredOps(toStored({ [V]: { skill: 0 } }, { [V]: { potential: 2 } })), { [V]: { potential: 2 } }, 'the ops read as before');
});

test('helpers: opsOf / setOps / resetOps keep only non-default values; sanitizeOps keeps what the server would', () => {
  assert.deepEqual(opsOf({}, V), { potential: 6, cultivate: 3, changed: false });
  let o = setOps({}, V, { potential: 1 });
  assert.deepEqual(o, { [V]: { potential: 1 } });
  o = setOps(o, V, { cultivate: 0 });
  assert.deepEqual(opsOf(o, V), { potential: 1, cultivate: 0, changed: true });
  o = setOps(o, V, { potential: 6, cultivate: 3 });
  assert.deepEqual(o, {}, 'back to the defaults: no entry');
  o = setOps(o, V, { potential: 0 });
  assert.deepEqual(o, {}, 'an illegal value is ignored');
  assert.deepEqual(resetOps({ [V]: { potential: 2 }, [KALTS]: { cultivate: 1 } }, V), { [KALTS]: { cultivate: 1 } });
  assert.deepEqual(sanitizeOps({ [V]: { potential: 2 }, [KALTS]: { cultivate: 1 }, char_609_acguad: { potential: 1 }, char_999_x: { potential: 1 }, [CHESS.chess_char_1_01_a.charId]: { potential: 6 } }, isOp),
    { [V]: { potential: 2 }, [KALTS]: { cultivate: 1 } }, 'a prototype / unknown operator / defaults dropped');
  assert.deepEqual(sanitizeOps({ [V]: { potential: 2 }, char_x_flat: { potential: 1, cultivate: 0 } }, () => true, (id) => id !== 'char_x_flat'),
    { [V]: { potential: 2 }, char_x_flat: { cultivate: 0 } }, 'a plugin operator with no curve drops the non-default potential and keeps the rest');
});

test('导出 / 导入: the envelope carries ops; an older export keeps the current settings; settings alone import', () => {
  const p = exportPayload({ [V]: { skill: 0 } }, { ops: { [V]: { potential: 2 } } });
  assert.deepEqual(p.ops, { [V]: { potential: 2 } });
  const back = parseImport(JSON.stringify(p));
  assert.deepEqual([back.ok, back.byChar, back.ops], [true, { [V]: { skill: 0 } }, { [V]: { potential: 2 } }]);
  const old = parseImport({ kind: 'stronghold.loadout', v: 1, entries: { [VENDLA]: { skill: 0 } } });
  assert.equal('ops' in old, false, 'an older export: no ops');
  assert.equal(parseImport({ v: 1, entries: {}, ops: { [V]: { cultivate: 1 } } }).ok, true, 'settings only');
  assert.equal(parseImport({ v: 1, entries: {}, ops: {} }).ok, false, 'nothing at all');
  const before = { entries: loadoutStore.get().entries, ops: loadoutStore.get().ops };
  try {
    setOpsMap({ [KALTS]: { cultivate: 1 } });
    const r1 = applyLoadoutEntries({ [VENDLA]: { skill: 0 } }, get);
    assert.deepEqual(r1, { applied: 1, dropped: 0 });
    assert.deepEqual(loadoutStore.get().ops, { [KALTS]: { cultivate: 1 } }, 'no ops in the import: the settings stay');
    const r2 = applyLoadoutEntries({}, get, { ops: { [V]: { potential: 3 }, char_609_acguad: { potential: 1 } }, isOperator: isOp });
    assert.deepEqual(r2, { applied: 0, dropped: 1, ops: 1 });
    assert.deepEqual(loadoutStore.get().ops, { [V]: { potential: 3 } }, 'the imported settings replace the current ones');
  } finally {
    setEntries(before.entries);
    setOpsMap(before.ops);
  }
});

test('the 已调整 count and 仅看已调整 include an operator whose 潜能 / 练度 differ', () => {
  const roster = rosterOf(Object.values(CHESS));
  assert.equal(changedCount({}, get, { [V]: { potential: 2 } }, roster), 1);
  assert.equal(changedCount({ [VENDLA]: { skill: 0 } }, get, { [V]: { potential: 2 } }, roster), 1, 'one operator');
  assert.equal(changedCount({}, get, {}, roster), 0);
  const only = filterRoster(roster, { changedOnly: true }, {}, get, () => null, { [V]: { cultivate: 0 } });
  assert.deepEqual(only.map((c) => c.chessId), [VENDLA]);
});

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
function expand(v, depth = 6) {
  if (Array.isArray(v)) return v.map((x) => expand(x, depth));
  if (!v || typeof v !== 'object') return v;
  if (typeof v.type === 'function' && depth > 0) {
    try { return expand(v.type(v.props || {}), depth - 1); } catch { return v; }
    }
  const children = v.props?.children;
  return children === undefined ? v : { ...v, props: { ...v.props, children: expand(children, depth) } };
}
const propIs = (tree, name, value) => [...walk(tree)].some((n) => n.props && n.props[name] === value);

test('a plugin operator with no potential curve hides the potential control and keeps 练度', () => {
  const tables = { chess: { a: { charId: 'char_x_curved', potDown: { atk: [1] } } }, backups: { units: {} } };
  assert.equal(potentialEditable('char_102_texas', tables), true);
  assert.equal(potentialEditable('char_x_flat', tables), false);
  assert.equal(potentialEditable('char_x_curved', tables), true);
  assert.equal(cultivationView('char_x_flat', { char_x_flat: { potential: 1 } }, tables).changed, false);
  assert.equal(cultivationView('char_x_flat', { char_x_flat: { potential: 1, cultivate: 0 } }, tables).changed, true);
  assert.equal(cultivationView('char_x_curved', { char_x_curved: { potential: 1 } }, tables).potentialOn, true);
  const fake = { chessId: 'chess_x_flat_a', charId: 'char_x_flat', visible: true, isGolden: false, isDiy: false, baseId: 'chess_x_flat_a' };
  assert.equal(changedCount({}, () => fake, { char_x_flat: { potential: 1 } }, [fake], () => false), 0);
  assert.equal(changedCount({}, () => fake, { char_x_flat: { potential: 1 } }, [fake], () => true), 1);
  assert.equal(changedCount({}, () => fake, { char_x_flat: { cultivate: 0 } }, [fake], () => false), 1);
  const orig = data.get;
  data.get = (name) => (name === 'chess' ? tables.chess : name === 'backups' ? tables.backups : null);
  try {
    const flatOps = { char_x_flat: { potential: 1, cultivate: 0 } };
    const selects = expand(CultivationSelects({ charId: 'char_x_flat', ops: flatOps, onSet() {} }));
    assert.equal(propIs(selects, 'data-cult', 'potential'), false);
    assert.equal(propIs(selects, 'data-cult', 'cultivate'), true);
    const section = expand(CultivationSection({ charId: 'char_x_flat', ops: { char_x_flat: { potential: 1 } }, onSet() {} }));
    assert.equal(propIs(section, 'data-potential', 1), false);
    assert.equal([...walk(section)].some((n) => n.props && Object.hasOwn(n.props, 'data-cultivate')), true);
    assert.equal([...walk(section)].some((n) => typeof n.props?.class === 'string' && n.props.class.includes('lo-badge--changed')), false);
    const curved = expand(CultivationSelects({ charId: 'char_x_curved', ops: {}, onSet() {} }));
    assert.equal(propIs(curved, 'data-cult', 'potential'), true);
    const official = expand(CultivationSelects({ charId: 'char_102_texas', ops: {}, onSet() {} }));
    assert.equal(propIs(official, 'data-cult', 'potential'), true);
  } finally {
    data.get = orig;
  }
});

function fakeNet() {
  const listeners = new Map();
  const net = {
    status: 'online', sent: [], replies: [],
    on(t, fn) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(fn); return () => listeners.get(t).delete(fn); },
    emit(t, msg) { for (const fn of listeners.get(t) || []) fn(msg); },
    request(t, fields) { net.sent.push({ t, ...fields }); return Promise.resolve({ t: 'ok' }); },
  };
  return net;
}
function fakeTimers() {
  let now = 0; let seq = 0;
  const q = new Map();
  return {
    setTimeout: (fn, ms) => { const id = ++seq; q.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => q.delete(id),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...q.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        q.delete(next[0]); now = next[1].at; next[1].fn();
        for (let i = 0; i < 8; i++) await Promise.resolve();
      }
      now = end;
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
  };
}

test('sync: room.loadout carries the sanitised ops; an edit of the settings alone is sent; none set ⇒ ops {} without a download', async () => {
  const net = fakeNet();
  const T = fakeTimers();
  let backups = 0;
  const target = createStore({ entries: {}, ops: { [V]: { potential: 1 }, char_609_acguad: { potential: 1 } }, open: false, sync: 'idle' });
  const s = installLoadoutSync({ net, timers: T, target, getChessReady: async () => CHESS, getBackupsReady: async () => { backups++; return BACKUPS; }, lookupChess: get, operatorIds: () => IDS });
  net.emit('welcome', {});
  await T.advance(100);
  assert.deepEqual(net.sent, [{ t: 'room.loadout', entries: {}, ops: { [V]: { potential: 1 } } }], 'a prototype dropped');
  assert.equal(backups, 1, 'the 自选 pool needs backups.json');
  target.set({ ops: { [V]: { potential: 1, cultivate: 2 } } });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.deepEqual(net.sent[1], { t: 'room.loadout', entries: {}, ops: { [V]: { potential: 1, cultivate: 2 } } });
  s.dispose();
  // nothing set: nothing to sanitise, no data loaded
  const net2 = fakeNet();
  let loads = 0;
  const t2 = createStore({ entries: {}, ops: {}, open: false, sync: 'idle' });
  const s2 = installLoadoutSync({ net: net2, timers: T, target: t2, getChessReady: async () => { loads++; return CHESS; }, getBackupsReady: async () => { loads++; return BACKUPS; }, lookupChess: get, operatorIds: () => IDS });
  net2.emit('welcome', {});
  await T.advance(100);
  assert.deepEqual([net2.sent, loads], [[{ t: 'room.loadout', entries: {}, ops: {} }], 0]);
  s2.dispose();
});

test('cards: the record at the player\'s 潜能 with its 练度 multiplier; a teammate\'s unit its own; a stand-in neither', () => {
  const v = CHESS[VENDLA];
  const fx = { effects: EFFECTS };
  const at = (opts) => chessLoadout(v, null, get, { ...fx, ...opts }).record.stats;
  assert.deepEqual([at({}).atk, at({}).cost], [435 * 1.1, 15], 'no settings: 满潜 + 精英2 Lv.60');
  assert.deepEqual([at({ ops: { [V]: { potential: 1, cultivate: 0 } } }).atk, at({ ops: { [V]: { potential: 1, cultivate: 0 } } }).cost], [413, 17]);
  assert.deepEqual([at({ ops: { [V]: { cultivate: 1 } } }).atk, at({ ops: { [V]: { cultivate: 1 } } }).def], [435 * 1.05, 77 * 1.05]);
  assert.equal(chessLoadout(v, null, get, { ops: { [V]: { potential: 4 } }, ...fx }).record.talents.find((t) => t.name === '土壤基肥改良').bb.heal_scale, 1.08);
  assert.deepEqual(chessLoadout(v, null, get, { ops: { [V]: { potential: 2 } }, ...fx }).cultivation, { potential: 2, cultivate: 3 });
  // a teammate's unit: its UnitInfo
  assert.deepEqual(unitCultivation({ potential: 3, cultivate: 1 }), { potential: 3, cultivate: 1 });
  assert.equal(unitCultivation({}), null, 'neither: a raw / stand-in unit');
  assert.equal(at({ cultivation: unitCultivation({ cultivate: 0 }) }).atk, 435);
  assert.equal(at({ cultivation: null }).atk, 435, 'none');
  // a stand-in (补位): neither, whatever the settings say
  const normal = Object.values(CHESS).find((c) => c.chessType === 'NORMAL' && !c.isGolden && c.visible);
  const st = standInOf(normal, BACKUPS);
  const si = standInLoadout(st, get, BACKUPS);
  assert.ok(st && st.standInFor === normal.charId);
  assert.equal(si.cultivation, null);
  assert.deepEqual(si.record.stats, st.stats, 'the stand-in\'s own numbers');
  assert.equal(chessLoadout(st, null, get, { ops: { [normal.charId]: { potential: 1, cultivate: 0 }, [st.charId]: { potential: 1 } }, ...fx }).cultivation, null);
});

test('自选 cards: the player\'s own pick at its 潜能 (m.private.ops), another player\'s unit at its UnitInfo potential', () => {
  const T6 = 'chess_char_6_diy1_a';
  const data = { chess: CHESS, backups: BACKUPS };
  const priv = { diy: { [T6]: { charId: KALTS, skillIndex: 0, uniEquipId: null } }, ops: { [KALTS]: { potential: 1 } } };
  assert.deepEqual(ownDiyPick(priv, CHESS[T6]), { charId: KALTS, skillIndex: 0, uniEquipId: null, potential: 1 });
  const rec = ownDiyRecord(CHESS[T6], priv, data);
  assert.deepEqual([rec.stats.atk, rec.stats.cost], [392, 20], '凯尔希 潜能1');
  const full = ownDiyRecord(CHESS[T6], { ...priv, ops: {} }, data);
  assert.deepEqual([full.stats.atk, full.stats.cost], [417, 18]);
  const mate = cardDiy(CHESS[T6], { unit: { diy: { charId: KALTS, skillIndex: 0, uniEquipId: null }, potential: 1, cultivate: 3 }, data });
  assert.equal(mate.stats.atk, 392);
  // the card multiplies the 练度 on top (the composed record is already at its potential)
  assert.equal(chessLoadout(rec, null, get, { ops: priv.ops, effects: EFFECTS }).record.stats.atk, 392 * 1.1);
});
