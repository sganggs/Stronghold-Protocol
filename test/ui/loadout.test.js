// test/ui/loadout.test.js — 干员调配 client logic (DESIGN §16): the loadout model (storage parsing, options, choices,
// sanitising a stale browser loadout so the server never refuses it, roster filters, display helpers), the server
// sync (room.loadout after welcome / edits, debounce, lock / rate handling, never on missing data) and the overlay's
// auto-close rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkLoadout, MODULE_NONE } from '../../shared/protocol.js';
import { PHASE } from '../../shared/constants.js';
import {
  parseStored, toStored, chessOptions, effectiveChoice, setChoice, resetChoice, sanitizeEntries, rosterOf, filterRoster,
  changedCount, moduleBadge, attrRows, skillTags, skillLabel, selectedSkill, selectedModule, recordsOf,
  exportPayload, serializeExport, parseImport, LOADOUT_EXPORT_KIND, LOADOUT_VERSION, LOADOUT_IMPORT_MAX_BYTES,
} from '../../public/js/ui/loadoutModel.js';
import { installLoadoutSync, SYNC_DEBOUNCE_MS, RETRY_MS, applyLoadoutEntries, setEntries, loadoutStore } from '../../public/js/ui/loadoutSync.js';
import { createStore } from '../../public/js/store.js';
import { shouldAutoClose } from '../../public/js/screens/loadout.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHESS = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
const BONDS = JSON.parse(readFileSync(path.join(ROOT, 'data/bonds.json'), 'utf8'));
const get = (id) => (Object.hasOwn(CHESS, id) ? CHESS[id] : null);
const getBond = (id) => (Object.hasOwn(BONDS, id) ? BONDS[id] : null);
const INSIDE = 'chess_char_1_01_a';
const SWIRE = 'chess_char_3_04_a';
const { base: IB, golden: IG } = recordsOf(INSIDE, get);
const { base: SB, golden: SG } = recordsOf(SWIRE, get);
const SWIRE_ALT = SG.modules.find((m) => !m.isDefault).uniEquipId;

test('parseStored: tolerant of junk, keeps structurally valid entries; toStored round trip', () => {
  assert.deepEqual(parseStored(null), {});
  assert.deepEqual(parseStored('x'), {});
  assert.deepEqual(parseStored({ v: 1, entries: { [INSIDE]: { skill: 0, module: 'none', junk: 1 }, 'bad id': { skill: 1 }, [SWIRE]: { skill: -1 } } }),
    { [INSIDE]: { skill: 0, module: 'none' } });
  assert.deepEqual(parseStored({ [INSIDE]: { skill: 1 } }), { [INSIDE]: { skill: 1 } }, 'bare map (older build)');
  const e = { [INSIDE]: { skill: 0 } };
  assert.deepEqual(parseStored(JSON.parse(JSON.stringify(toStored(e)))), e);
});

test('exportPayload / serializeExport: versioned envelope, entries copied; parseImport round trip', () => {
  const entries = { [INSIDE]: { skill: 0 }, [SWIRE]: { module: SWIRE_ALT } };
  const p = exportPayload(entries, { now: Date.UTC(2026, 9, 3, 4, 5, 6) });
  assert.deepEqual(Object.keys(p).sort(), ['count', 'entries', 'exportedAt', 'kind', 'v'], 'exactly the envelope, no unused field');
  assert.equal(p.kind, LOADOUT_EXPORT_KIND);
  assert.equal(p.v, LOADOUT_VERSION);
  assert.equal(p.count, 2);
  assert.equal(p.exportedAt, '2026-10-03T04:05:06.000Z');
  assert.deepEqual(p.entries, entries);
  assert.notEqual(p.entries, entries, 'a copy — later edits must not mutate an already-built payload');
  assert.notEqual(p.entries[INSIDE], entries[INSIDE]);
  assert.equal(exportPayload(null).count, 0);

  const back = parseImport(serializeExport(entries, { now: 0 }));
  assert.equal(back.ok, true);
  assert.deepEqual(back.entries, entries);
});

test('parseImport: accepts the envelope, the stored form, a bare map and text; refuses junk, newer data and hostile keys', () => {
  const entries = { [INSIDE]: { skill: 0 } };
  assert.deepEqual(parseImport(exportPayload(entries)).entries, entries, 'envelope');
  assert.deepEqual(parseImport(toStored(entries)).entries, entries, 'stored { v, entries }');
  assert.deepEqual(parseImport(entries).entries, entries, 'bare map (hand-written / older build)');
  assert.deepEqual(parseImport(JSON.stringify(exportPayload(entries))).entries, entries, 'serialised text');
  assert.deepEqual(parseImport(`\n  ${JSON.stringify(entries)}  \n`).entries, entries, 'padded text');

  for (const junk of ['', '   ', 'not a payload', '{', 42, null, undefined, [], true]) {
    assert.equal(parseImport(junk).ok, false, `${JSON.stringify(junk)} is refused`);
  }
  const newer = parseImport({ v: LOADOUT_VERSION + 1, entries });
  assert.equal(newer.ok, false, 'a NEWER payload is refused, never mis-read');
  assert.match(newer.error, /请先更新游戏/, 'the player is told to update the game');
  assert.equal(parseImport({ kind: 'some.other.tool', entries }).ok, false, "another tool's payload");
  assert.equal(parseImport({ v: LOADOUT_VERSION, entries: {} }).ok, false, 'nothing to import');
  assert.equal(parseImport({ v: LOADOUT_VERSION, entries: { 'bad id': { skill: 0 } } }).ok, false, 'no structurally valid entry');
  assert.equal(parseImport('x'.repeat(LOADOUT_IMPORT_MAX_BYTES + 1)).ok, false, 'an oversized payload is refused before parsing');

  // hostile keys: JSON.parse keeps `__proto__` as an own key, and assigning it would rewrite an object's prototype
  const hostile = JSON.parse(`{"entries":{"__proto__":{"skill":0},"constructor":{"skill":0},"prototype":{"skill":0},"${INSIDE}":{"skill":0}}}`);
  assert.deepEqual(Object.keys(hostile.entries), ['__proto__', 'constructor', 'prototype', INSIDE], 'fixture: parsed as own keys');
  const safe = parseImport(hostile);
  assert.deepEqual(safe.entries, { [INSIDE]: { skill: 0 } }, 'only the real chess survives');
  assert.equal(Object.getPrototypeOf(safe.entries), Object.prototype, 'the entry map keeps a clean prototype');
  assert.equal({}.skill, undefined, 'Object.prototype was not polluted');
});

test('applyLoadoutEntries: sanitises against the loaded data and reports what was dropped', () => {
  const before = loadoutStore.get().entries;
  try {
    const res = applyLoadoutEntries({ [INSIDE]: { skill: 0 }, chess_nope_999: { skill: 0 } }, get);
    assert.deepEqual(res, { applied: 1, dropped: 1 }, 'the unknown chess is dropped, the real one applied');
    assert.deepEqual(loadoutStore.get().entries, { [INSIDE]: { skill: 0 } }, 'the store got the sanitised entries');
  } finally {
    setEntries(before);
  }
});

test('applyLoadoutEntries: an import that keeps nothing changes nothing (review: it used to wipe the loadout)', () => {
  setEntries({ [INSIDE]: { skill: 0 } });
  const before = loadoutStore.get().entries;
  try {
    assert.deepEqual(applyLoadoutEntries({ chess_nope_999: { skill: 0 } }, get), { applied: 0, dropped: 1 }, 'every chess unknown');
    assert.equal(loadoutStore.get().entries, before, 'the current loadout is untouched (not even replaced by an equal one)');
    const def = IB.skills.find((s) => s.isDefault).index;
    assert.deepEqual(applyLoadoutEntries({ [INSIDE]: { skill: def } }, get), { applied: 0, dropped: 1 }, 'every choice already the default');
    assert.equal(loadoutStore.get().entries, before, 'still untouched');
  } finally {
    setEntries(before);
  }
});

test('options: skill records at Lv4 (normal) and Lv7 (elite); modules + 不装备 with defaults flagged', () => {
  const o = chessOptions(IB, IG);
  assert.deepEqual(o.skillOptions.map((s) => s.index), [0, 1]);
  assert.equal(o.skillOptions.find((s) => s.isDefault).index, 1);
  for (const s of o.skillOptions) {
    assert.equal(s.normal.level, IB.status.skillLevel, 'normal record at the normal skill level');
    assert.equal(s.elite.level, IG.status.skillLevel, 'elite record at the elite skill level');
    assert.equal(s.normal.skillId, s.elite.skillId);
  }
  assert.deepEqual(o.moduleOptions.map((m) => m.id), ['uniequip_002_inside', MODULE_NONE]);
  assert.ok(o.moduleOptions[0].isDefault && o.moduleOptions[0].rec.typeName === 'MAR-X');
  assert.equal(o.moduleOptions[1].rec, null);
  const s = chessOptions(SB, SG);
  assert.equal(s.moduleOptions.length, SG.modules.length + 1);
});

test('choices: set / reset keep only non-default entries; effectiveChoice falls back to defaults', () => {
  let e = {};
  assert.deepEqual(effectiveChoice(e, IB, IG), { skill: 1, module: 'uniequip_002_inside', changed: false });
  e = setChoice(e, IB, IG, { skill: 0 });
  assert.deepEqual(e, { [INSIDE]: { skill: 0 } });
  e = setChoice(e, IB, IG, { module: MODULE_NONE });
  assert.deepEqual(e, { [INSIDE]: { skill: 0, module: MODULE_NONE } });
  assert.deepEqual(effectiveChoice(e, IB, IG), { skill: 0, module: MODULE_NONE, changed: true });
  e = setChoice(e, IB, IG, { skill: 1, module: 'uniequip_002_inside' });
  assert.deepEqual(e, {}, 'back to the defaults ⇒ no entry');
  e = setChoice(e, IB, IG, { skill: 5 }); // not selectable: ignored
  assert.deepEqual(e, {});
  e = setChoice(setChoice({}, SB, SG, { module: SWIRE_ALT }), IB, IG, { skill: 0 });
  assert.equal(changedCount(e, get), 2);
  e = resetChoice(e, SWIRE);
  assert.deepEqual(e, { [INSIDE]: { skill: 0 } });
  // stale entries resolve to the defaults
  assert.deepEqual(effectiveChoice({ [INSIDE]: { skill: 9, module: 'gone' } }, IB, IG), { skill: 1, module: 'uniequip_002_inside', changed: false });
});

test('sanitizeEntries: drops unknown chess / illegal parts one by one, and the result always passes checkLoadout', () => {
  const stale = {
    [INSIDE]: { skill: 0, module: SWIRE_ALT }, // the module belongs to another character: the skill part survives
    [SWIRE]: { module: SWIRE_ALT },
    chess_char_9_99_a: { skill: 0 }, // removed from the data
    [IG.chessId]: { skill: 0 }, // an elite id
    [SB.chessId + 'x']: { skill: 1 },
  };
  const out = sanitizeEntries(stale, get);
  assert.deepEqual(out, { [INSIDE]: { skill: 0 }, [SWIRE]: { module: SWIRE_ALT } });
  assert.ok(checkLoadout(out, get).ok);
  // every visible chess × every choice sanitises to an accepted loadout
  const all = {};
  for (const c of rosterOf(Object.values(CHESS))) {
    const o = chessOptions(c, get(c.goldenId));
    all[c.chessId] = { skill: o.skills.find((i) => i !== o.defaultSkill), module: o.modules[o.modules.length - 1] };
  }
  const s = sanitizeEntries(all, get);
  assert.equal(Object.keys(s).length, 112);
  assert.ok(checkLoadout(s, get).ok);
});

test('selectedSkill / selectedModule for the in-match UI (shop cards, detail panel)', () => {
  const lo = checkLoadout({ [INSIDE]: { skill: 0, module: MODULE_NONE } }, get).loadout;
  assert.equal(selectedSkill(lo, IB, get).index, 0);
  assert.equal(selectedSkill(lo, IG, get).level, IG.status.skillLevel);
  assert.equal(selectedModule(lo, IG, get), null);
  assert.equal(selectedModule({}, IG, get).uniEquipId, 'uniequip_002_inside');
  assert.equal(selectedModule(lo, IB, get), null, 'normal chess have no module');
  assert.equal(selectedSkill(null, SB, get).index, SB.skill.index);
});

test('roster and filters: 112 visible chess in shop order; tier / class / bond / search / changed-only', () => {
  const roster = rosterOf(Object.values(CHESS));
  assert.equal(roster.length, 112);
  assert.ok(roster.every((c) => !c.isGolden && c.visible));
  for (let i = 1; i < roster.length; i++) assert.ok(roster[i - 1].tier <= roster[i].tier);
  const t3 = filterRoster(roster, { tier: 3 }, {}, get, getBond);
  assert.ok(t3.length > 0 && t3.every((c) => c.tier === 3));
  const snipers = filterRoster(roster, { prof: 'SNIPER' }, {}, get, getBond);
  assert.ok(snipers.length > 0 && snipers.every((c) => c.profession === 'SNIPER'));
  const bond = IB.bonds[0];
  assert.ok(filterRoster(roster, { bond }, {}, get, getBond).every((c) => c.bonds.includes(bond)));
  assert.deepEqual(filterRoster(roster, { query: '隐现' }, {}, get, getBond).map((c) => c.chessId), [INSIDE]);
  const bondName = getBond(bond).name;
  assert.ok(filterRoster(roster, { query: bondName }, {}, get, getBond).some((c) => c.chessId === INSIDE), 'search matches bond names');
  assert.deepEqual(filterRoster(roster, { changedOnly: true }, { [INSIDE]: { skill: 0 }, [SWIRE]: { skill: SB.skill.index } }, get, getBond).map((c) => c.chessId), [INSIDE]);
});

test('display helpers: module badge, stat rows, skill tags', () => {
  assert.equal(moduleBadge({ typeName: 'MAR-X' }), 'X');
  assert.equal(moduleBadge({ typeName: 'ISW-α' }), 'α');
  assert.equal(moduleBadge(null, MODULE_NONE), '—');
  assert.deepEqual(attrRows({ maxHp: 80, atk: 22, def: 0 }).map((r) => [r.label, r.text, r.positive]), [['生命上限', '+80', true], ['攻击力', '+22', true]]);
  assert.deepEqual(attrRows({ cost: -1, respawnTime: -4 }).map((r) => [r.label, r.text, r.positive]), [['部署费用', '-1', true], ['再部署时间', '-4秒', true]]);
  assert.deepEqual(attrRows(null), []);
  const t = skillTags(IB.skills[1]);
  assert.equal(t.sp, '自动回复');
  assert.equal(t.cost, IB.skills[1].spCost);
  assert.equal(t.duration, '弹药');
  assert.equal(skillLabel(2), 'S3');
  const passive = skillTags({ skillType: 'PASSIVE', spType: 8 });
  assert.equal(passive.passive, true);
  assert.equal(passive.cost, null);
});

// ---- sync ---------------------------------------------------------------------------------------------------------------

function fakeNet() {
  const listeners = new Map();
  const net = {
    status: 'online',
    sent: [],
    replies: [],
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
const syncStore = (entries = {}) => createStore({ entries, open: false, from: null, sel: null, filters: {}, sync: 'idle' });

test('sync: welcome sends the sanitised loadout; edits are debounced; identical content is not resent', async () => {
  const net = fakeNet();
  const T = fakeTimers();
  const target = syncStore({ [INSIDE]: { skill: 0 }, chess_char_9_99_a: { skill: 1 } });
  const s = installLoadoutSync({ net, timers: T, target, getChessReady: async () => CHESS, lookupChess: get });
  net.emit('welcome', {});
  await T.advance(100);
  assert.deepEqual(net.sent, [{ t: 'room.loadout', entries: { [INSIDE]: { skill: 0 } } }], 'stale entry dropped');
  assert.equal(target.get().sync, 'synced');
  target.set({ entries: { [INSIDE]: { skill: 0 }, [SWIRE]: { module: SWIRE_ALT } } });
  target.set({ entries: { [INSIDE]: { skill: 0 }, [SWIRE]: { module: MODULE_NONE } } });
  await T.advance(SYNC_DEBOUNCE_MS - 10);
  assert.equal(net.sent.length, 1, 'debounced');
  await T.advance(20);
  assert.equal(net.sent.length, 2);
  assert.deepEqual(net.sent[1].entries, { [INSIDE]: { skill: 0 }, [SWIRE]: { module: MODULE_NONE } });
  target.set({ entries: { ...target.get().entries } }); // same content, new object
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.equal(net.sent.length, 2, 'unchanged content is not resent');
  net.emit('welcome', {}); // a new / resumed session always gets it again
  await T.advance(100);
  assert.equal(net.sent.length, 3);
  s.dispose();
});

test('sync: locked match (WRONG_PHASE) is not an error; RATE retries; offline waits for the next welcome; missing data never sends', async () => {
  const net = fakeNet();
  const T = fakeTimers();
  const target = syncStore({ [INSIDE]: { skill: 0 } });
  const s = installLoadoutSync({ net, timers: T, target, getChessReady: async () => CHESS, lookupChess: get });
  net.replies.push({ error: 'WRONG_PHASE' });
  net.emit('welcome', {});
  await T.advance(100);
  assert.equal(target.get().sync, 'locked');
  // back in the lobby (room.state without a match): sent again
  net.emit('room.state', { inMatch: false });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.equal(net.sent.length, 2);
  assert.equal(target.get().sync, 'synced');
  // RATE → retried after RETRY_MS
  net.replies.push({ error: 'RATE' });
  target.set({ entries: {} });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.equal(net.sent.length, 3);
  assert.equal(target.get().sync, 'pending');
  await T.advance(RETRY_MS + 10);
  assert.equal(net.sent.length, 4);
  assert.deepEqual(net.sent[3].entries, {});
  assert.equal(target.get().sync, 'synced');
  // offline: nothing sent until the next welcome
  net.status = 'reconnecting';
  target.set({ entries: { [INSIDE]: { skill: 0 } } });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.equal(net.sent.length, 4);
  net.status = 'online';
  net.emit('welcome', {});
  await T.advance(100);
  assert.equal(net.sent.length, 5);
  s.dispose();
  // chess data missing: never sanitise everything away (that would clear the server's copy)
  const net2 = fakeNet();
  const t2 = syncStore({ [INSIDE]: { skill: 0 } });
  const s2 = installLoadoutSync({ net: net2, timers: T, target: t2, getChessReady: async () => null, lookupChess: () => null });
  net2.emit('welcome', {});
  await T.advance(100);
  assert.equal(net2.sent.length, 0);
  assert.equal(t2.get().sync, 'error');
  s2.dispose();
});

test('sync: closing the overlay sends a pending edit at once (the next click — 准备就绪 / 开始模拟 — must not overtake it)', async () => {
  const net = fakeNet();
  const T = fakeTimers();
  const target = syncStore({});
  const s = installLoadoutSync({ net, timers: T, target, getChessReady: async () => CHESS, lookupChess: get });
  net.emit('welcome', {});
  await T.advance(100);
  assert.equal(net.sent.length, 1);
  target.set({ open: true, from: 'briefing' });
  target.set({ entries: { [INSIDE]: { skill: 0 } } });
  await T.advance(50); // well inside the debounce
  assert.equal(net.sent.length, 1, 'still debounced while the overlay is open');
  target.set({ open: false });
  for (let i = 0; i < 5; i++) await Promise.resolve(); // microtasks only: no timer ran
  assert.equal(net.sent.length, 2, 'sent on close, before any later task (e.g. the g.infoReady click)');
  assert.deepEqual(net.sent[1].entries, { [INSIDE]: { skill: 0 } });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.equal(net.sent.length, 2, 'the cancelled debounce does not send it twice');
  // closing without a pending edit sends nothing
  target.set({ open: true });
  target.set({ open: false });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.equal(net.sent.length, 2);
  s.dispose();
});

test('overlay auto-close: briefing entry closes when INFO_CHECK ends; lobby / room entry closes when a match starts', () => {
  const open = (from) => ({ open: true, from });
  assert.equal(shouldAutoClose(open('briefing'), PHASE.INFO_CHECK, true, true), false);
  assert.equal(shouldAutoClose(open('briefing'), PHASE.BAND_DRAFT, true, true), true);
  assert.equal(shouldAutoClose(open('room'), null, false, false), false);
  assert.equal(shouldAutoClose(open('room'), null, true, false), true);
  assert.equal(shouldAutoClose(open('lobby'), PHASE.INFO_CHECK, true, true), false, 'reopened during the briefing from elsewhere');
  assert.equal(shouldAutoClose({ open: false, from: 'briefing' }, PHASE.PREP, true, true), false);
});

test('untimed phases show no countdown: the "无倒计时" placeholder of Countdown is hidden (user playtest #11)', () => {
  const css = readFileSync(path.join(ROOT, 'public/css/screens/loadout.css'), 'utf8');
  assert.match(css, /\.countdown\[aria-label="无倒计时"\]\s*\{\s*display:\s*none;/);
  const html = readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="\/css\/screens\/loadout\.css" \/>/, 'loaded on every page');
  // contract with ui/components.js: a missing deadline renders the Countdown with exactly that aria-label (or nothing)
  const comp = readFileSync(path.join(ROOT, 'public/js/ui/components.js'), 'utf8');
  const fn = comp.slice(comp.indexOf('export function Countdown'), comp.indexOf('export function Countdown') + 2500);
  assert.ok(/'无倒计时'/.test(fn) || /return null/.test(fn), 'Countdown marks (or skips) the untimed state');
});

test('the background layer (.lo__bg: mint glow + grid) keeps position: absolute — no later rule of the same specificity overrides it (PR #14)', () => {
  const css = readFileSync(path.join(ROOT, 'public/css/screens/loadout.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.lo__bg\s*\{[^}]*position:\s*absolute;/);
  // `.lo > *` (one class, after .lo__bg) used to set position: relative on it, a 0-px flex item that never drew
  assert.ok(!/\.lo\s*>\s*\*\s*\{[^}]*position/.test(css), 'no universal child rule setting position');
  assert.match(css, /\.lo > :where\(:not\(\.lo__bg\)\) \{ position: relative; \}/, 'the other layers still stack above it, at one class of specificity');
  const after = css.slice(css.indexOf('.lo__bg'));
  for (const m of after.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/\.lo__bg\b/.test(m[1]) || /:not\(\.lo__bg\)/.test(m[1])) continue;
    for (const v of m[2].matchAll(/position:\s*([a-z-]+)/g)) assert.equal(v[1], 'absolute', `${m[1].trim()} changes the layer's position`);
  }
});

// ---- review fixes (adversarial review of the loadout workstream) -------------------------------------------------------

/** A net whose replies are released by hand (the socket is ordered: replies come back in request order). */
function deferredNet() {
  const listeners = new Map();
  const net = {
    status: 'online',
    sent: [],
    pending: [],
    on(t, fn) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(fn); return () => listeners.get(t).delete(fn); },
    emit(t, msg) { for (const fn of listeners.get(t) || []) fn(msg); },
    request(t, fields) {
      net.sent.push({ t, ...fields });
      return new Promise((resolve, reject) => net.pending.push({ resolve, reject }));
    },
    async reply(error = null) {
      const p = net.pending.shift();
      if (error) p.reject(Object.assign(new Error(error), { code: error })); else p.resolve({ t: 'ok' });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
  };
  return net;
}
const ticks = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('sync: an edit closed while an earlier room.loadout is still in flight is sent at once, not after that reply', async () => {
  const net = deferredNet();
  const T = fakeTimers();
  const target = syncStore({ [INSIDE]: { skill: 0 } });
  const s = installLoadoutSync({ net, timers: T, target, getChessReady: async () => CHESS, lookupChess: get, notify: () => {} });
  net.emit('welcome', {});
  await T.advance(100);
  assert.equal(net.sent.length, 1, 'welcome send in flight (no reply yet)');
  target.set({ open: true, from: 'briefing' });
  target.set({ entries: { [INSIDE]: { skill: 0, module: MODULE_NONE } } });
  target.set({ open: false });
  await ticks(); // microtasks only: the player's next click (准备就绪) is a later task
  assert.equal(net.sent.length, 2, 'the edit went out before the first reply (the same ordered socket)');
  assert.deepEqual(net.sent[1].entries, { [INSIDE]: { skill: 0, module: MODULE_NONE } });
  // the older reply must not mark the newer content as synced / the newer reply wins
  await net.reply();
  assert.equal(target.get().sync, 'sending', 'the older reply does not settle the state');
  await net.reply();
  assert.equal(target.get().sync, 'synced');
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.equal(net.sent.length, 2, 'nothing resent');
  // reverting to the content of a request that is still in flight is not sent twice; reverting to the last accepted
  // content while a different one is in flight is sent (the server applies the newest frame)
  target.set({ entries: { [INSIDE]: { skill: 0 } } });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.equal(net.sent.length, 3);
  target.set({ entries: { [INSIDE]: { skill: 0, module: MODULE_NONE } } });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.equal(net.sent.length, 4, 'back to the accepted content while another is in flight: sent');
  target.set({ entries: { [INSIDE]: { skill: 0, module: MODULE_NONE } } });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.equal(net.sent.length, 4, 'identical to the one in flight: not duplicated');
  await net.reply();
  await net.reply();
  assert.equal(target.get().sync, 'synced');
  s.dispose();
});

test('sync: an edit refused because the match locked its loadout is told to the player once; a resync is not', async () => {
  const net = deferredNet();
  const T = fakeTimers();
  const told = [];
  const target = syncStore({ [INSIDE]: { skill: 0 } });
  const s = installLoadoutSync({ net, timers: T, target, getChessReady: async () => CHESS, lookupChess: get, notify: (t) => told.push(t) });
  net.emit('welcome', {}); // reconnect during a running match: the resync is refused, nothing to tell
  await T.advance(100);
  await net.reply('WRONG_PHASE');
  assert.equal(target.get().sync, 'locked');
  assert.deepEqual(told, []);
  // an edit (the briefing overlay closed by INFO_CHECK ending) arrives too late
  target.set({ open: true, from: 'briefing' });
  target.set({ entries: { [INSIDE]: { skill: 1 } } });
  target.set({ open: false });
  await ticks();
  assert.equal(net.sent.length, 2);
  await net.reply('WRONG_PHASE');
  assert.equal(target.get().sync, 'locked');
  assert.equal(told.length, 1);
  assert.match(told[0], /下一局生效/);
  s.dispose();
});

test('sync: an empty loadout is sent without loading chess.json (no 1.6 MB download in the lobby for it)', async () => {
  const net = deferredNet();
  const T = fakeTimers();
  let loads = 0;
  const target = syncStore({});
  const s = installLoadoutSync({ net, timers: T, target, getChessReady: async () => { loads++; return CHESS; }, lookupChess: get, notify: () => {} });
  net.emit('welcome', {});
  await T.advance(100);
  assert.deepEqual(net.sent, [{ t: 'room.loadout', entries: {} }]);
  assert.equal(loads, 0);
  await net.reply();
  target.set({ entries: { [INSIDE]: { skill: 0 } } });
  await T.advance(SYNC_DEBOUNCE_MS + 10);
  assert.equal(loads, 1, 'a real loadout is sanitised against the data');
  assert.deepEqual(net.sent[1].entries, { [INSIDE]: { skill: 0 } });
  s.dispose();
});

test('entry badge (review fix): counts like the screen once chess.json is loaded (stale entries of retired chess do not count)', async () => {
  const { badgeCount } = await import('../../public/js/screens/loadout.js');
  // unknown id, a retired (hidden) chess on a non-default skill (红豆 S1), an elite id
  const entries = { [INSIDE]: { skill: 0 }, chess_char_9_99_a: { skill: 1 }, chess_char_1_05_a: { skill: 0 }, [IB.goldenId]: { skill: 0 } };
  assert.equal(get('chess_char_1_05_a').isHidden, true, 'fixture: 红豆 is retired');
  assert.equal(badgeCount(entries, null), 4, 'before the data: the stored entries');
  assert.equal(badgeCount(entries, get), 1, 'with the data: only chess the screen shows as 已调整');
  assert.equal(badgeCount(entries, get), changedCount(entries, get));
  assert.equal(badgeCount({}, get), 0);
});
