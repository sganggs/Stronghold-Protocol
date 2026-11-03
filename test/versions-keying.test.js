// Versions M0 (docs/SIM.md §7.2, DESIGN §35.22.3): on another official version's build (config.version) hand-written
// behaviour is found by the operator's charId and the item's effectId, not by the default data's chess / item ids —
// 上半 (act1autochess) gives 50 of its 100 chess ids and most item ids to other operators and effects. The default data
// and the plugin content sets built on it (no config.version) keep the by-id lookups of before M0. Every data directory
// checked here — data/, every data/versions/*/ with a chess.json, and the directories of SP_VERSION_DATA_DIRS
// (path.delimiter-separated, e.g. a dry build) — must:
//   * resolve every chess to a kit written for its own charId, or list its charId in PENDING_KIT_CHARS (generic kit;
//     empty after the 第一期 charId kits, §35.22.9);
//   * resolve every 自选 pick (owned pool and prototypes, each slot) and every 补位 stand-in to the kit of its charId, or
//     be a 预备干员 (GENERIC_KIT_CHARS, generic by design) or a version's 自选 pick listed in PENDING_DIY_KIT_CHARS
//     (empty after the borrowed tier kits), which the kitted gate (KITTED_CHARS) then drops;
//   * dispatch every item to the handler of its own effectId, and bind each meta override only to item keys whose
//     record carries its effectId and the buff it reads;
//   * match its pinned resolution counts (EXPECT; a directory without an entry fails until it gets one);
//   * match its pinned members of the kits' hand-written group lists, 深海猎人 and 莱茵生命 (GROUPS; likewise).
// The default data must keep exactly the old item lookups (test/fixtures/versions-keying-baseline.json, frozen on
// db8e226d before the change). These tests check WHICH handler key an item dispatches to, not the handler's body: a
// swapped body is caught by test/golden.test.js. Also: a missing bond threshold is not reached on a version's build (炎
// without its 9-member tier), 远牙's granted trait, 夕's generic dragon, 凯瑟琳's cell, 蒸汽之心's hammers and the AI's
// community / i18n overlays (server and client) follow a version's data, not the default ids, while the default data and
// plugin content sets on it keep the by-id answers; band and bond ids, still keyed by id, keep the default's entities.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, getData, setData, resetData } from '../server/data.js';
import { DataSource } from '../server/sim/simdata.js';
import { KITS, officialKitKey } from '../server/sim/content/index.js';
import {
  KIT_CHAR_IDS, KIT_FILES, TIER_KITS, TIER_KIT_KEYS_BY_CHAR, PENDING_KIT_CHARS, PENDING_DIY_KIT_CHARS, GENERIC_KIT_CHARS, KITTED_CHARS,
} from '../server/sim/content/kits/index.js';
import { diyPool, diySlot, diySlotIds, isPrototypePick } from '../shared/diy.js';
import { checkDiyPicks } from '../shared/protocol.js';
import { setGameData, itemEffectKey, itemIdsWithEffect, officialItemIdsWithEffect, isMutationCell, mutationCellIds } from '../server/sim/content/support/index.js';
import { BATTLE_EFFECT_IDS, DEFAULT_ITEM_KEYS, battleEffectOf, hasBattleEffect, hammerKeys } from '../server/sim/content/items/battle.js';
import { PlayerPrep } from '../server/match/player/prep.js';
import { applyPatches } from '../shared/plugins/patch.js';
import { itemMetaBindings } from '../server/sim/content/items/meta.js';
import { createRegistry, resetDefaultRegistry } from '../server/match/effectsMeta.js';
import { genericKit } from '../server/sim/content/generic.js';
import { TOKEN_IDS } from '../server/sim/content/tokens.js';
import { makeBattle, chessRec, enemyRec, checkInvariants } from './helpers/battleHarness.js';
import { buildPlaybook } from '../server/ai/playbook.js';
import { knowledgePack } from '../server/ai/knowledge.js';
import { hasBattlePart as bandHasBattlePart } from '../server/sim/content/bands/battle.js';
import { bandMetaHandler } from '../server/sim/content/bands/meta.js';
import { createDataStore, DATA_FILES } from '../public/js/data.js';
import { ABYSSAL as ABYSSAL_SKADI } from '../server/sim/content/kits/ops/chess_char_3_05-skadi.js';
import { isAbyssal as isAbyssalGlady } from '../server/sim/content/kits/ops/chess_char_4_12-glady.js';
import { isAbyssal as isAbyssalSkadi2 } from '../server/sim/content/kits/ops/chess_char_6_04-skadi2.js';
import { abyssalOf, isAbyssal as isAbyssalTier5 } from '../server/sim/content/kits/shared/tier5.js';
import { isRhine, rhineOf } from '../server/sim/content/kits/ops/chess_char_6_11-mlyss.js';
import { RHINE as RHINE_ALL } from '../server/sim/content/kits/ops/op-slent2.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });
const BASELINE = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/versions-keying-baseline.json'), 'utf8'));
const DEFAULT_DIR = path.join(ROOT, 'data');

/** data/, every data/versions/<id>/ with a chess.json, and SP_VERSION_DATA_DIRS. */
const DIRS = (() => {
  const out = [DEFAULT_DIR];
  const vdir = path.join(ROOT, 'data', 'versions');
  if (existsSync(vdir)) {
    for (const e of readdirSync(vdir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && existsSync(path.join(vdir, e.name, 'chess.json'))) out.push(path.join(vdir, e.name));
    }
  }
  for (const d of String(process.env.SP_VERSION_DATA_DIRS || '').split(path.delimiter).filter(Boolean)) out.push(path.resolve(d));
  return out;
})();
const label = (dir) => path.relative(ROOT, dir).split(path.sep).join('/') || dir;
const isDefault = (dir) => dir === DEFAULT_DIR;
const cache = new Map();
const dataOf = (dir) => {
  if (!cache.has(dir)) cache.set(dir, isDefault(dir) ? getData({ log: QUIET }) : loadData(dir, { log: QUIET }));
  return cache.get(dir);
};

/** The real config.version of 上半's build (a copy of the default data carrying it resolves as a version's build). */
const SHANG_CONFIG = path.join(ROOT, 'data/versions/act1autochess/config.json');
const SHANG_VERSION = existsSync(SHANG_CONFIG) ? JSON.parse(readFileSync(SHANG_CONFIG, 'utf8')).version
  : { id: 'act1autochess', family: 'covenant', rules: {} };
/** `data` with config.version set: behaviour by charId / effectId, nothing else changes. */
const versioned = (data) => ({ ...data, config: { ...data.config, version: SHANG_VERSION } });

/**
 * The pinned resolution of each directory: kits over the normal official chess records (own = its id's kit, tier = an
 * operator's tier kit under another id, op = a 自选 op-* kit, pending = distinct charIds without a kit), the 自选 picks
 * (distinct charIds over every slot's pool: kitted, generic = 预备干员, pending = PENDING_DIY_KIT_CHARS) and the 补位
 * stand-in records (kitted, generic = 预备干员), items with a
 * BY_EFFECT handler (records, golden included) and the distinct handlers, 蒸汽之心's hammer keys, the item records with
 * a battle part, and the item keys each meta override binds (items/meta.js OVERRIDES).
 */
const DEFAULT_META = Object.freeze({
  dispatchTicket: ['chess_item_2_02_e'], pager: ['chess_item_4_01_e'], pointer: ['chess_item_6_03_m'], customerBounty: ['chess_item_6_01_m'],
  scroll: ['chess_item_6_02_m'], customerDestroy: ['chess_item_6_01_m'], cauldron: ['chess_item_6_03_e'],
});
const SHANG = Object.freeze({
  // 自选: the 24 borrowed charId kits (§35.22.9) are kitted; V1_1's owned pool has one operator less (娜斯提)
  kits: { own: 46, tier: 19, op: 31, pending: 0 }, diy: { kitted: 81, generic: 6, pending: 0 }, standIns: { kitted: 64, generic: 68 },
  items: 44, handlers: 22, battleEffect: 68,
  hammers: ['chess_item_2_03_e', 'chess_item_2_04_e', 'chess_item_2_05_e', 'chess_item_2_06_e'],
  // 上半 has no 紧急调度券, and its 寻呼模块 (eff_acarm075) reads use_equip_add_goods_rule_with_refresh_shop: unbound (M2)
  meta: { dispatchTicket: [], pager: [], pointer: ['chess_item_6_03_m'], customerBounty: ['chess_item_6_01_m'], scroll: ['chess_item_6_02_m'],
    customerDestroy: ['chess_item_6_01_m'], cauldron: ['chess_item_6_02_e'] },
  cells: ['chess_item_6_08_e_a'],
});
const EXPECT = Object.freeze({
  data: {
    // 自选: 75 owned 6★ (冻河, 国度 and 塔露拉 from CN 2.7.91, DESIGN §37.91) + the 9 elites are kitted, the 预备干员 generic
    kits: { own: 129, tier: 0, op: 0, pending: 0 }, diy: { kitted: 84, generic: 6, pending: 0 }, standIns: { kitted: 82, generic: 28 },
    items: 54, handlers: 27, battleEffect: 82,
    hammers: ['chess_item_4_09_e', 'chess_item_3_09_e', 'chess_item_3_10_e', 'chess_item_2_03_e'], meta: DEFAULT_META,
    cells: ['chess_item_5_08_e_a'],
  },
  'data/versions/act1autochess': SHANG,
  'data/versions/act1autochess-v1_1': { ...SHANG, diy: { kitted: 80, generic: 6, pending: 0 } },
  // 下半 V2_1: the chess and item ids of today's data, 13 chess entries fewer (V2_2's 5 new operators and 8 re-tiered
  // entries); 4 owned 自选 picks borrow the shop kit (银灰, 空弦, 卡涅利安, 伺夜)
  'data/versions/act2autochess-v2_1': {
    kits: { own: 116, tier: 0, op: 0, pending: 0 }, diy: { kitted: 76, generic: 6, pending: 0 }, standIns: { kitted: 74, generic: 26 },
    items: 54, handlers: 27, battleEffect: 82,
    hammers: ['chess_item_4_09_e', 'chess_item_3_09_e', 'chess_item_3_10_e', 'chess_item_2_03_e'], meta: DEFAULT_META,
    cells: ['chess_item_5_08_e_a'],
  },
});

/** The behaviour of each default item key (C in the plan): BY_ITEM key → effectId. */
const BATTLE_KEY_TO_EFFECT = Object.freeze({
  chess_item_3_02_e: 'eff_acarm063', chess_item_3_04_e: 'eff_acarm040', chess_item_3_05_e: 'eff_acarm051',
  chess_item_3_06_e: 'eff_acarm049', chess_item_3_11_e: 'eff_acarm064', chess_item_4_03_e: 'eff_acarm052',
  chess_item_4_04_e: 'eff_acarm055', chess_item_4_05_e: 'eff_acarm060', chess_item_4_06_e: 'eff_acarm065',
  chess_item_4_07_e: 'eff_acarm119', chess_item_4_08_e: 'eff_acarm057', chess_item_4_10_e: 'eff_acarm059',
  chess_item_4_11_e: 'eff_acarm061', chess_item_4_12_e: 'eff_acarm068', chess_item_5_01_e: 'eff_acarm058',
  chess_item_5_02_e: 'eff_acarm062', chess_item_5_03_e: 'eff_acarm067', chess_item_5_09_e: 'eff_acarm118',
  chess_item_6_01_e: 'eff_acarm117', chess_item_6_02_e: 'eff_acarm076', chess_item_6_03_e: 'eff_acarm077',
  chess_item_6_04_e: 'eff_acarm078', chess_item_6_05_e: 'eff_acarm079', chess_item_6_06_e: 'eff_acarm102',
  chess_item_6_07_e: 'eff_acarm103', chess_item_6_10_e: 'eff_acarm120', chess_item_6_11_e: 'eff_acarm122',
});
/** The default key of each items/meta.js override → its effectId. */
const META_KEY_TO_EFFECT = Object.freeze({
  chess_item_2_02_e: 'eff_acarm115', chess_item_4_01_e: 'eff_acarm075', chess_item_6_03_m: 'eff_acchal',
  chess_item_6_01_m: 'eff_acdisney', chess_item_6_02_m: 'eff_accopy', chess_item_6_03_e: 'eff_acarm077',
});

/**
 * Load directory `dir` as the game data for one test: support's data object, and for a version directory also
 * server/data.js (the meta registry reads it); undone after the test.
 */
function useDir(t, dir) {
  const data = dataOf(dir);
  setGameData(data);
  if (!isDefault(dir)) { setData(clone(data)); setGameData(null); }
  t.after(() => { setGameData(null); if (!isDefault(dir)) { resetData(); resetDefaultRegistry(); } });
  return data;
}

const tierOfKey = (key) => Number(/^chess_char_(\d+)_/.exec(key)?.[1]);
/** The by-id lookup before versions M0 (content/index.js registeredKit): baseId, exact id, suffix-less id. */
function oldKitKey(def) {
  if (!def) return null;
  if ((def.standInFor && def.charId && def.charId !== def.standInFor) || (def.diyFor && def.charId)) return Object.hasOwn(KITS, def.charId) ? def.charId : null;
  const bare = String(def.baseId ?? def.id ?? '').replace(/_[ab]$/, '');
  return [def.baseId, def.id, bare].find((k) => k != null && Object.hasOwn(KITS, k) && KITS[k]) ?? null;
}
/** Every chess def of a data directory (DataSource over that data alone). */
function defsOf(data) {
  const ds = new DataSource(data, null);
  return Object.keys(data.chess || {}).sort().map((id) => ({ id, rec: data.chess[id], def: ds.getChess(id) }));
}
/** The normal record of an item key (`<key>_a`, or the key itself for an Art). */
const normalOf = (items, key) => items[`${key}_a`] ?? items[key] ?? null;
const hooksOf = (h) => Object.keys(h).filter((n) => typeof h[n] === 'function').sort();
const clone = (v) => JSON.parse(JSON.stringify(v));

// =====================================================================================================================
// kits

test('KIT_CHAR_IDS: exactly the tier kit keys, in KIT_FILES order, matching data/chess.json and each kit file\'s header', () => {
  const tierKeys = TIER_KITS.flatMap((reg) => Object.keys(reg));
  assert.deepEqual(Object.keys(KIT_CHAR_IDS), tierKeys);
  const chess = dataOf(DEFAULT_DIR).chess;
  for (const [key, charId] of Object.entries(KIT_CHAR_IDS)) assert.equal(chess[key]?.charId, charId, key);
  const files = KIT_FILES.flat();
  assert.equal(files.length, tierKeys.length);
  for (const file of files) {
    const key = `${file.split('-')[0]}_a`;
    const head = readFileSync(path.join(ROOT, 'server/sim/content/kits/ops', file), 'utf8').split('\n')[0];
    assert.equal(/\((char_[0-9a-z]+_[0-9a-z]+)\)/.exec(head)?.[1], KIT_CHAR_IDS[key], `${file} header`);
  }
  for (const [charId, keys] of Object.entries(TIER_KIT_KEYS_BY_CHAR)) for (const k of keys) assert.equal(KIT_CHAR_IDS[k], charId);
});

test('PENDING_KIT_CHARS: operators without any kit (one that gets a kit leaves the list)', () => {
  assert.equal(new Set(PENDING_KIT_CHARS).size, PENDING_KIT_CHARS.length);
  for (const c of PENDING_KIT_CHARS) {
    assert.ok(!TIER_KIT_KEYS_BY_CHAR[c] && !Object.hasOwn(KITS, c), `${c} has a kit now: remove it from PENDING_KIT_CHARS`);
  }
});

for (const dir of DIRS) {
  test(`kits of ${label(dir)}: every chess resolves to its own charId's kit, or is pending (generic); the pinned split`, (t) => {
    const data = dataOf(dir);
    setGameData(data);
    t.after(() => setGameData(null));
    const pending = new Set();
    const split = { own: 0, tier: 0, op: 0, pending: new Set() };
    let checked = 0;
    for (const { id, rec, def } of defsOf(data)) {
      if (rec.isDiy || rec.charId == null) continue;
      checked++;
      const key = officialKitKey(def);
      if (!rec.baseId || rec.baseId === id) {
        if (!key) split.pending.add(def.charId);
        else if (key === (def.baseId ?? id)) split.own++;
        else if (KIT_CHAR_IDS[key]) split.tier++;
        else split.op++;
      }
      if (key) {
        assert.equal(KIT_CHAR_IDS[key] ?? key, def.charId, `${id} (${def.charId}) → ${key}`);
        const same = (TIER_KIT_KEYS_BY_CHAR[def.charId] ?? []).some((k) => tierOfKey(k) === def.tier);
        if (same) assert.equal(tierOfKey(key), def.tier, `${id}: the tier kit of its tier`);
      } else {
        assert.ok(PENDING_KIT_CHARS.includes(def.charId), `${id} (${def.charId}) has no kit and is not in PENDING_KIT_CHARS`);
        pending.add(def.charId);
      }
    }
    assert.ok(checked > 0);
    if (isDefault(dir)) assert.equal(pending.size, 0, 'the default data has no pending operator');
    const want = EXPECT[label(dir)];
    assert.ok(want, `${label(dir)} has no EXPECT entry: pin its counts`);
    assert.deepEqual({ ...split, pending: split.pending.size }, want.kits);
  });
}

test('PENDING_DIY_KIT_CHARS: operators with a tier kit only, never a 自选 kit (one that gets a 自选 kit leaves the list)', () => {
  assert.equal(new Set(PENDING_DIY_KIT_CHARS).size, PENDING_DIY_KIT_CHARS.length);
  for (const c of PENDING_DIY_KIT_CHARS) {
    assert.ok(TIER_KIT_KEYS_BY_CHAR[c]?.length, `${c} has no tier kit`);
    assert.ok(!Object.hasOwn(KITS, c) && !KITTED_CHARS.includes(c), `${c} has a 自选 kit now: remove it from PENDING_DIY_KIT_CHARS`);
    assert.ok(!PENDING_KIT_CHARS.includes(c) && !GENERIC_KIT_CHARS.includes(c), c);
  }
});

for (const dir of DIRS) {
  test(`自选 and 补位 of ${label(dir)}: every pick and stand-in has its charId's kit, is a 预备干员 or a pending 自选 pick; the kitted gate agrees; the pinned split`, (t) => {
    const data = dataOf(dir);
    setGameData(data);
    t.after(() => setGameData(null));
    const ds = new DataSource(data, null);
    const kitted = new Set(KITTED_CHARS);
    const diy = { kitted: new Set(), generic: new Set(), pending: new Set() };
    const slots = diySlotIds(data);
    assert.ok(slots.length > 0);
    for (const slotId of slots) {
      const { tier } = diySlot(slotId, data);
      for (const charId of diyPool(tier, { data })) {
        const pick = isPrototypePick(data, tier, charId) ? { charId } : { charId, skillIndex: 0, uniEquipId: null };
        const def = ds.getChess(slotId, { diy: pick });
        assert.ok(def, `${slotId} ${charId}: a legal pick`);
        const key = officialKitKey(def);
        const kept = Object.keys(checkDiyPicks({ [slotId]: pick }, { data, kitted: KITTED_CHARS }).picks).length === 1;
        if (key) {
          assert.equal(KIT_CHAR_IDS[key] ?? key, charId, `${slotId} ${charId} → ${key}`);
          assert.ok(kitted.has(charId) && kept, `${slotId} ${charId}: kitted, kept by the gate`);
          diy.kitted.add(charId);
        } else if (GENERIC_KIT_CHARS.includes(charId)) {
          assert.ok(kept, `${slotId} ${charId}: a 预备干员 is kept by the gate`);
          diy.generic.add(charId);
        } else {
          assert.ok(!isDefault(dir) && PENDING_DIY_KIT_CHARS.includes(charId), `${slotId} ${charId} has no 自选 kit and is not in PENDING_DIY_KIT_CHARS`);
          assert.ok(!kept && !diyPool(tier, { data, kitted: KITTED_CHARS }).includes(charId), `${slotId} ${charId}: the gate drops a pending pick`);
          diy.pending.add(charId);
        }
      }
    }
    const standIns = { kitted: 0, generic: 0 };
    for (const id of Object.keys(data.chess || {})) {
      const def = ds.getStandIn(id);
      if (!def) continue;
      const key = officialKitKey(def);
      if (key) { assert.equal(KIT_CHAR_IDS[key] ?? key, def.charId, `${id} stand-in ${def.charId} → ${key}`); standIns.kitted++; }
      else { assert.ok(GENERIC_KIT_CHARS.includes(def.charId), `${id}: stand-in ${def.charId} has no kit and is no 预备干员`); standIns.generic++; }
    }
    const want = EXPECT[label(dir)];
    assert.ok(want, `${label(dir)} has no EXPECT entry: pin its counts`);
    assert.deepEqual({ kitted: diy.kitted.size, generic: diy.generic.size, pending: diy.pending.size }, want.diy);
    assert.deepEqual(standIns, want.standIns);
  });
}

// The kits' hand-written group lists (character_table groupId; no built record carries it): 深海猎人 for 斯卡蒂 (its own
// list) and for 歌蕾蒂娅, 浊心斯卡蒂 and the tier-5 kits (归溟幽灵鲨, 乌尔比安; one list, shared/tier5.js abyssalOf), 莱茵生命
// for 缪尔赛思. Per directory, the shop chess and 自选 operators
// each list sees, as literals: a roster that brings in a new member fails until the list follows (DESIGN §35.22.4). The
// additions of M0 (安哲拉, 星源) apply on a version's build only.
const GROUPS = Object.freeze({
  'data': { abyssal: ['char_1023_ghost2', 'char_143_ghost', 'char_263_skadi', 'char_4145_ulpia', 'char_474_glady'], rhineMissed: [] },
  'data/versions/act1autochess': {
    abyssal: ['char_1023_ghost2', 'char_143_ghost', 'char_218_cuttle', 'char_263_skadi', 'char_4145_ulpia', 'char_474_glady'],
    // 伊芙利特 and 淬羽赫默: shop chess in 第一期, 自选 picks today; whether 自选 members count is open (M2, DESIGN §35.22.5)
    rhineMissed: ['char_1031_slent2', 'char_134_ifrit'],
  },
  'data/versions/act1autochess-v1_1': {
    abyssal: ['char_1023_ghost2', 'char_143_ghost', 'char_218_cuttle', 'char_263_skadi', 'char_4145_ulpia', 'char_474_glady'],
    rhineMissed: ['char_1031_slent2', 'char_134_ifrit'],
  },
  'data/versions/act2autochess-v2_1': { abyssal: ['char_1023_ghost2', 'char_143_ghost', 'char_263_skadi', 'char_4145_ulpia', 'char_474_glady'], rhineMissed: [] },
});

test('深海猎人 lists: on a version\'s build both lists hold the same six operators (every character_table groupId "abyssal" member); without config.version the lists of before M0', () => {
  const six = ['char_1023_ghost2', 'char_143_ghost', 'char_218_cuttle', 'char_263_skadi', 'char_4145_ulpia', 'char_474_glady'];
  const five = six.filter((c) => c !== 'char_218_cuttle');
  const def = dataOf(DEFAULT_DIR);
  const ver = versioned(def);
  assert.deepEqual([...abyssalOf(ver)].sort(), six);
  assert.deepEqual([...abyssalOf(def)].sort(), five);
  assert.deepEqual([...ABYSSAL_SKADI].sort(), six, '斯卡蒂\'s list named 安哲拉 before M0, on every data');
  assert.deepEqual([...rhineOf(ver)].filter((c) => !rhineOf(def).has(c)), ['char_135_halo']);
  for (const c of rhineOf(ver)) assert.ok(RHINE_ALL.has(c), `缪尔赛思's ${c} is no 莱茵生命 member`);
});

// the predicates each kit calls (歌蕾蒂娅's tide, 浊心斯卡蒂's 捕食习性 aura, the tier-5 talents; 缪尔赛思's SP on copy, SP on
// deploy and battleStart cost cut): a kit reading the version list directly fails here (the golden corpus has no
// 安哲拉 / 星源 chess)
test('group lists: a plugin content set on the default data that fields 安哲拉 / 星源 as official operators keeps the lists of before M0', (t) => {
  // a Forge chess or §34.16 record of an official operator outside the roster carries the charId and no groupId
  const data = clone(dataOf(DEFAULT_DIR));
  for (const [id, charId] of [['chess_x_t_cuttle_a', 'char_218_cuttle'], ['chess_x_t_halo_a', 'char_135_halo']]) {
    data.chess[id] = { ...data.chess.chess_char_1_02_a, chessId: id, baseId: id, goldenId: null, upgradeChessId: null, charId };
  }
  assert.equal(Object.hasOwn(data.config, 'version'), false);
  setGameData(data);
  t.after(() => setGameData(null));
  const op = (charId) => ({ kind: 'op', def: { charId, raw: {} } });
  const abyssal = { 'tier5 (归溟幽灵鲨, 乌尔比安)': isAbyssalTier5, 歌蕾蒂娅: isAbyssalGlady, 浊心斯卡蒂: isAbyssalSkadi2 };
  for (const [name, is] of Object.entries(abyssal)) {
    assert.equal(is(op('char_218_cuttle')), false, name);
    assert.equal(is(op('char_143_ghost')), true, name);
  }
  assert.equal(isRhine(op('char_135_halo')), false, '缪尔赛思');
  assert.equal(isRhine(op('char_108_silent')), true, '缪尔赛思');
  setGameData(versioned(data));
  for (const [name, is] of Object.entries(abyssal)) assert.equal(is(op('char_218_cuttle')), true, name);
  assert.equal(isRhine(op('char_135_halo')), true, '缪尔赛思');
});

for (const dir of DIRS) {
  test(`group lists of ${label(dir)}: the 深海猎人 members each list sees and the shop 莱茵生命 members 缪尔赛思's list misses`, () => {
    const data = dataOf(dir);
    const shop = new Set(Object.values(data.chess || {}).map((c) => c.charId).filter(Boolean));
    const roster = new Set([...shop, ...Object.keys(data.backups?.diy?.operators || {})]);
    const want = GROUPS[label(dir)];
    assert.ok(want, `${label(dir)} has no GROUPS entry: pin its group members`);
    assert.deepEqual([...roster].filter((c) => abyssalOf(data).has(c)).sort(), want.abyssal);
    assert.deepEqual([...shop].filter((c) => RHINE_ALL.has(c) && !rhineOf(data).has(c)).sort(), want.rhineMissed);
  });
}

test('kits of data/: the new lookup equals the by-id lookup for all 266 records', () => {
  const all = defsOf(dataOf(DEFAULT_DIR));
  assert.equal(all.length, 266);
  for (const { id, def } of all) assert.equal(officialKitKey(def), oldKitKey(def), id);
});

test('kits: on a version\'s build a chess id given to another operator takes that operator\'s kit (or none); plugin chess keep the by-id lookup', (t) => {
  setGameData(versioned(dataOf(DEFAULT_DIR)));
  t.after(() => setGameData(null));
  const ds = new DataSource(dataOf(DEFAULT_DIR), null);
  const yak = ds.getChess('chess_char_1_02_a');
  // 上半's chess_char_1_02_a is 讯使 (a charId kit, §35.22.9), its chess_char_5_12_a 林 (an op-* kit)
  assert.equal(officialKitKey({ ...yak, charId: 'char_198_blackd' }), 'char_198_blackd');
  assert.equal(officialKitKey({ ...ds.getChess('chess_char_5_12_a'), charId: 'char_4080_lin' }), 'char_4080_lin');
  // 锡人 at tier 2 under another id → chess_char_2_19_a; at an unknown tier → the first one
  assert.equal(officialKitKey({ ...yak, charId: 'char_4151_tinman', tier: 2 }), 'chess_char_2_19_a');
  assert.equal(officialKitKey({ ...yak, charId: 'char_4151_tinman', tier: 6 }), 'chess_char_1_16_a');
  // fixtures (charId defaults to the chess id) and plugin chess (forgeImport's ref:null keeps the generic kit)
  assert.equal(officialKitKey({ ...yak, charId: 'chess_char_1_02_a' }), 'chess_char_1_02_a');
  assert.equal(officialKitKey({ ...yak, id: 'chess_x_test_yak_a', baseId: 'chess_x_test_yak_a' }), null);
  assert.equal(officialKitKey({ ...yak, id: 'chess_x_test_yak_a', baseId: 'chess_x_test_yak_a', charId: 'char_300_phenxi' }), null);
  // the data passed in decides, not only the loaded data
  assert.equal(officialKitKey({ ...yak, charId: 'char_198_blackd' }, dataOf(DEFAULT_DIR)), 'chess_char_1_02_a');
});

test('kits and items: a plugin content set on the default data that patches an official charId / effectId keeps the old lookups', (t) => {
  const { data, problems } = applyPatches(clone(dataOf(DEFAULT_DIR)), [
    { op: 'set', file: 'chess', id: 'chess_char_1_02_a', path: ['charId'], value: 'char_4151_tinman' },
    { op: 'set', file: 'chess', id: 'chess_char_1_03_a', path: ['charId'], value: 'char_198_blackd' },
    { op: 'set', file: 'items', id: 'chess_item_3_02_e_a', path: ['effectId'], value: 'eff_acarm040' },
    { op: 'set', file: 'items', id: 'chess_item_4_01_e_a', path: ['effectId'], value: 'eff_acarm999' },
  ], { pluginId: 'demo' });
  assert.equal(problems.length, 0);
  assert.equal(Object.hasOwn(data.config, 'version'), false);
  setGameData(data);
  t.after(() => { setGameData(null); resetDefaultRegistry(); });
  const ds = new DataSource(data, null);
  assert.equal(officialKitKey(ds.getChess('chess_char_1_02_a')), 'chess_char_1_02_a');
  assert.equal(officialKitKey(ds.getChess('chess_char_1_03_a')), 'chess_char_1_03_a');
  assert.equal(battleEffectOf('chess_item_3_02_e_a'), 'eff_acarm063', '精准狙击镜 keeps its behaviour');
  assert.equal(battleEffectOf('chess_item_3_02_e_b'), 'eff_acarm063');
  assert.deepEqual(itemMetaBindings().find((b) => b.name === 'pager').keys, ['chess_item_4_01_e']);
  // the same patches on a version's build follow the patched values
  setGameData(versioned(data));
  assert.equal(officialKitKey(ds.getChess('chess_char_1_02_a')), 'chess_char_1_16_a');
  assert.equal(officialKitKey(ds.getChess('chess_char_1_03_a')), 'char_198_blackd');
  assert.equal(battleEffectOf('chess_item_3_02_e_a'), 'eff_acarm040');
  assert.deepEqual(itemMetaBindings().find((b) => b.name === 'pager').keys, []);
});

test('cells, hammers, 远牙 and 夕: a plugin content set on the default data that patches an official charId / effectId keeps the old lookups', (t) => {
  const { data, problems } = applyPatches(clone(dataOf(DEFAULT_DIR)), [
    { op: 'set', file: 'items', id: 'chess_item_5_08_e_a', path: ['effectId'], value: 'eff_acarm999' },
    { op: 'set', file: 'items', id: 'chess_item_6_08_e_a', path: ['effectId'], value: 'eff_acarm072' },
    { op: 'set', file: 'items', id: 'chess_item_6_05_e_a', path: ['effectId'], value: 'eff_acarm998' },
    { op: 'set', file: 'chess', id: 'chess_char_4_20_a', path: ['charId'], value: 'char_198_blackd' },
    { op: 'set', file: 'chess', id: 'chess_char_4_20_b', path: ['charId'], value: 'char_198_blackd' },
  ], { pluginId: 'demo' });
  assert.equal(problems.length, 0);
  assert.equal(Object.hasOwn(data.config, 'version'), false);
  setGameData(data);
  t.after(() => setGameData(null));
  // 凯瑟琳's cell (support/index.js isMutationCell / mutationCellIds, used by prep.js and bands/meta.js): by id
  assert.deepEqual(mutationCellIds(data), ['chess_item_5_08_e_a']);
  assert.equal(isMutationCell('chess_item_5_08_e_a', data), true);
  assert.equal(isMutationCell('chess_item_6_08_e_a', data), false);
  // 蒸汽之心's hammers (items/battle.js hammerInfo): read from chess_item_6_05_e_a whatever its effectId
  assert.deepEqual(hammerKeys(), EXPECT.data.hammers);
  // 远牙's granted trait (garrisons/battle.js farToothGrants): garrison_108_a/b, not found by charId
  const bond = { count: 3, active: true, tier: 1, layers: 0 };
  const h = makeBattle({
    data: new DataSource(data, null),
    units: [{ chessId: 'chess_char_4_20_a', row: 10, col: 3 }, { chessId: 'chess_char_2_11_a', row: 10, col: 8 }],
    bonds: { kazimierzShip: bond, preciShip: bond }, autoFinish: false, timeLimit: 300,
  });
  h.step();
  const u = h.unit('chess_char_2_11_a');
  assert.deepEqual(h.result().perPlayer.p1.layerGains, { kazimierzShip: 4, preciShip: 4 }, 'initial deployment');
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive && u.trait.doll, 'the lethal hit switches to a substitute');
  assert.deepEqual(h.result().perPlayer.p1.layerGains, { kazimierzShip: 8, preciShip: 8 }, '远牙 with a patched charId still gains on the switch');
  checkInvariants(h.b);
  // 夕's generic-kit dragon (tokens.js): chess_char_5_12 whatever its charId; her charId under another id gives none
  const raw = new DataSource(getData({ log: QUIET }), null).rawChess('chess_char_5_12_a');
  for (const [id, charId, want] of [['chess_char_5_12_a', 'char_4080_lin', true], ['chess_char_5_99_a', raw.charId, false]]) {
    const hd = makeBattle({
      defs: { chess: { [id]: { ...raw, chessId: id, baseId: id, goldenId: null, charId } }, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e8, speed: 0 }) } },
      kits: { [id]: genericKit }, units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'e_dummy', pos: [10, 5] }],
      autoFinish: false, timeLimit: 30,
    });
    assert.equal(hd.runUntil(() => hd.b.allyUnits.some((x) => x.defId === TOKEN_IDS.duskDragon), 10), want, `${id} ${charId}`);
    checkInvariants(hd.b);
  }
});

test('officialKitKey on a version\'s build: a tier kit that failed to load stays generic (never the operator\'s other tier kit); a char_x_ charId keeps the by-id kit', () => {
  const data = versioned(dataOf(DEFAULT_DIR));
  const ds = new DataSource(dataOf(DEFAULT_DIR), null);
  const tin2 = { ...ds.getChess('chess_char_1_02_a'), id: 'chess_char_2_19_a', baseId: 'chess_char_2_19_a', charId: 'char_4151_tinman', tier: 2 };
  assert.equal(officialKitKey(tin2, data), 'chess_char_2_19_a');
  // 锡人's tier-2 kit file failed to load: KITS and TIER_KIT_KEYS_BY_CHAR ("whose file loaded") lack it
  const kits = { ...KITS }; delete kits.chess_char_2_19_a;
  const tierKeys = { ...TIER_KIT_KEYS_BY_CHAR, char_4151_tinman: TIER_KIT_KEYS_BY_CHAR.char_4151_tinman.filter((k) => k !== 'chess_char_2_19_a') };
  assert.deepEqual(tierKeys.char_4151_tinman, ['chess_char_1_16_a']);
  assert.equal(officialKitKey(tin2, data, { kits, tierKeys }), null, 'generic, not chess_char_1_16_a');
  // under another chess id the operator's remaining tier kit is found by charId
  assert.equal(officialKitKey({ ...tin2, id: 'chess_char_2_98_a', baseId: 'chess_char_2_98_a' }, data, { kits, tierKeys }), 'chess_char_1_16_a');
  // a plugin charId (char_x_) on an official chess id keeps the by-id kit
  assert.equal(officialKitKey({ ...ds.getChess('chess_char_1_02_a'), charId: 'char_x_demo_op' }, data), 'chess_char_1_02_a');
});

// =====================================================================================================================
// items

test('BY_EFFECT: every key is a normal effectId of data/items.json; the 27 default handlers are all there, each with its default key', () => {
  const items = dataOf(DEFAULT_DIR).items;
  const normal = new Set(Object.values(items).filter((r) => r && (!r.baseId || r.baseId === r.id)).map((r) => r.effectId));
  for (const e of BATTLE_EFFECT_IDS) assert.ok(normal.has(e), e);
  assert.deepEqual([...BATTLE_EFFECT_IDS].sort(), BASELINE.battle.byItem.map((k) => BATTLE_KEY_TO_EFFECT[k]).sort());
  assert.deepEqual(Object.fromEntries(Object.entries(DEFAULT_ITEM_KEYS).map(([e, k]) => [k, e])), BATTLE_KEY_TO_EFFECT);
  for (const [e, k] of Object.entries(DEFAULT_ITEM_KEYS)) assert.equal(items[`${k}_a`]?.effectId, e, k);
});

for (const dir of DIRS) {
  test(`items of ${label(dir)}: each item runs the handler of its own effectId; the meta overrides bind its own keys; the pinned counts`, (t) => {
    const data = useDir(t, dir);
    const items = data.items || {};
    const dispatch = {};
    for (const id of Object.keys(items).sort()) {
      const h = battleEffectOf(id);
      if (h) {
        dispatch[id] = h;
        const rec = items[id], normal = rec.baseId && rec.baseId !== id ? items[rec.baseId] : rec;
        assert.equal(h, normal.effectId, `${id}: its own effect`);
      }
    }
    for (const { name, effectId, buff, keys } of itemMetaBindings()) {
      for (const key of keys) {
        assert.equal(normalOf(items, key)?.effectId, effectId, `meta ${name} → ${key}: its effectId`);
        assert.ok((normalOf(items, key)?.buffs ?? []).some((b) => b?.key === buff), `meta ${name} → ${key}: carries ${buff}`);
      }
    }
    const reg = createRegistry({ log: QUIET });
    for (const { keys } of itemMetaBindings()) for (const key of keys) assert.ok(reg.has(`item:${key}`), key);
    for (const k of reg.keys().filter((x) => x.startsWith('item:'))) assert.ok(normalOf(items, k.slice(5)), `${k} names an item of this data`);
    const want = EXPECT[label(dir)];
    assert.ok(want, `${label(dir)} has no EXPECT entry: pin its counts`);
    assert.ok(Object.keys(dispatch).length > 0, 'at least one official item resolves to a BY_EFFECT handler');
    assert.equal(Object.keys(dispatch).length, want.items, 'items with a BY_EFFECT handler');
    assert.equal(new Set(Object.values(dispatch)).size, want.handlers, 'distinct BY_EFFECT handlers');
    assert.equal(Object.values(items).filter((r) => hasBattleEffect(r)).length, want.battleEffect, 'items with a battle part');
    assert.deepEqual(Object.fromEntries(itemMetaBindings().map((b) => [b.name, b.keys])), want.meta);
    // 蒸汽之心 found by its effect: its hammers have a battle part (the hammer cache follows the data object: the
    // default directory runs first in this file, so a version directory exercises the reset)
    assert.deepEqual(hammerKeys(), want.hammers, '蒸汽之心\'s hammers');
    for (const k of want.hammers) assert.equal(hasBattleEffect(normalOf(items, k)), true, `hammer ${k}`);
    assert.deepEqual(mutationCellIds(data), want.cells, '突变细胞');
    if (isDefault(dir)) {
      const want = Object.fromEntries(Object.entries(BASELINE.battle.dispatch).map(([id, k]) => [id, BATTLE_KEY_TO_EFFECT[k]]));
      assert.deepEqual(dispatch, want, 'item → handler, as the baseline mapped by effectId');
      assert.deepEqual(Object.keys(items).sort().filter((id) => hasBattleEffect(items[id])), BASELINE.battle.battleEffect);
      const bound = itemMetaBindings().map((b) => [b.effectId, b.keys]);
      const wantBound = BASELINE.meta.wraps.map((w) => [META_KEY_TO_EFFECT[w.key], [w.key]]);
      assert.deepEqual(bound, wantBound, 'the meta overrides bind the baseline keys, in the baseline order');
      const keys = reg.keys().filter((x) => x.startsWith('item:')).sort();
      assert.deepEqual(keys, Object.keys(BASELINE.registry.itemHooks).sort(), 'the item: entries of the meta registry');
      for (const k of keys) assert.deepEqual(hooksOf(reg.get(k)), BASELINE.registry.itemHooks[k], k);
    }
  });
}

test('itemEffectKey: golden → normal effect; plugin records follow effectRef, without one they have no official behaviour', (t) => {
  const base = getData({ log: QUIET });
  setGameData({ ...base, items: {
    ...base.items,
    item_x_t_a: { id: 'item_x_t_a', effectRef: 'chess_item_3_02_e_a', effectId: 'eff_acarm063' },
    item_x_t_b: { id: 'item_x_t_b', effectId: 'eff_acarm063' },
    item_x_t_c: { id: 'item_x_t_c', effectRef: 'chess_item_5_08_e_a', effectId: 'eff_acarm072' },
  } });
  t.after(() => setGameData(null));
  assert.equal(itemEffectKey('chess_item_3_02_e_b'), 'eff_acarm063');
  assert.equal(itemEffectKey('item_x_t_a'), 'eff_acarm063');
  assert.equal(itemEffectKey('item_x_t_b'), null);
  assert.equal(battleEffectOf('item_x_t_a'), 'eff_acarm063');
  assert.equal(battleEffectOf('item_x_t_b'), null);
  assert.deepEqual(itemIdsWithEffect('eff_acarm063'), ['chess_item_3_02_e_a', 'chess_item_3_02_e_b']);
  assert.deepEqual(itemIdsWithEffect('eff_acarm063', { normalOnly: true }), ['chess_item_3_02_e_a']);
  // 凯瑟琳's allowance counts only the official normal cell
  assert.deepEqual(itemIdsWithEffect('eff_acarm072', { normalOnly: true }), ['chess_item_5_08_e_a']);
  assert.equal(isMutationCell('chess_item_5_08_e_a'), true);
  assert.equal(isMutationCell('chess_item_5_08_e_b'), false);
  assert.equal(isMutationCell('item_x_t_c'), false);
  const v = versioned({ ...base, items: { ...base.items, item_x_t_c: { id: 'item_x_t_c', effectRef: 'chess_item_5_08_e_a', effectId: 'eff_acarm072' } } });
  assert.equal(isMutationCell('chess_item_5_08_e_a', v), true);
  assert.equal(isMutationCell('chess_item_5_08_e_b', v), false);
  assert.equal(isMutationCell('item_x_t_c', v), false);
  // official records only: a plugin record without an effectRef is no cell even with the cell's effectId, and an
  // official-id record that carries an effectRef (a copy of its base) is not an official record of that effect
  const w = versioned({ ...base, items: { ...base.items,
    item_x_t_d: { id: 'item_x_t_d', effectId: 'eff_acarm072' },
    chess_item_9_98_e_a: { id: 'chess_item_9_98_e_a', effectRef: 'chess_item_5_08_e_a', effectId: 'eff_acarm072' },
  } });
  assert.equal(isMutationCell('item_x_t_d', w), false);
  assert.equal(isMutationCell('chess_item_9_98_e_a', w), false);
  assert.deepEqual(mutationCellIds(w), ['chess_item_5_08_e_a']);
  assert.deepEqual(officialItemIdsWithEffect(w.items, 'eff_acarm072', { normalOnly: true }), ['chess_item_5_08_e_a']);
  assert.deepEqual(officialItemIdsWithEffect(w.items, 'eff_acarm072'), ['chess_item_5_08_e_a', 'chess_item_5_08_e_b']);
});

test('凯瑟琳: picking the cell of the match\'s data from her offer uses the allowance (server/match/player/prep.js)', () => {
  const pick = (data, id) => {
    const ps = {
      _gate: () => null, offers: [{ source: 'band:band_cathy', slots: [{ kind: 'item', id, price: 0 }] }], hand: [null], funds: 0,
      gd: { raw: data, item: (x) => data.items[x] ?? null }, counters: {},
      acquireItem: () => true, spend() {}, _afterSpend() {}, recompute() {},
    };
    assert.deepEqual(PlayerPrep.prototype.pickReward.call(ps, 0), { ok: true });
    return ps.counters['band:cathy:cellTaken'] === 1;
  };
  const def = dataOf(DEFAULT_DIR);
  assert.equal(pick(def, 'chess_item_5_08_e_a'), true);
  assert.equal(pick(def, 'chess_item_6_08_e_a'), false, 'not a cell in the default data');
  for (const dir of DIRS.filter((d) => !isDefault(d))) {
    const data = dataOf(dir);
    for (const id of mutationCellIds(data)) assert.equal(pick(data, id), true, `${label(dir)} ${id}`);
    // 上半 gives the default cell's id to another item; 下半 V2_1 keeps it
    if (data.items.chess_item_5_08_e_a && !mutationCellIds(data).includes('chess_item_5_08_e_a')) {
      assert.equal(pick(data, 'chess_item_5_08_e_a'), false, `${label(dir)}: the default id is another item`);
    }
  }
});

for (const dir of DIRS) {
  test(`凯瑟琳 on ${label(dir)}: once the cell is taken her later offers leave out that data's cell, never another id (bands/meta.js)`, (t) => {
    const data = useDir(t, dir);
    const cells = mutationCellIds(data);
    assert.deepEqual(cells, EXPECT[label(dir)]?.cells ?? cells);
    // V1_1 (20 strategies) has no 凯瑟琳 band
    if (!data.bands?.band_cathy) { assert.ok(!isDefault(dir), 'the default data has band_cathy'); return; }
    const h = bandMetaHandler('band_cathy');
    assert.equal(typeof h?.onLevelUp, 'function', 'band_cathy offers on level-up');
    // a stub pool: the first id not excluded; it holds the data's cell, the default cell id (another item, or none, in a
    // 上半 version; the same cell in 下半 V2_1) and enough filler for a full offer
    const otherId = !cells.includes('chess_item_5_08_e_a');
    const pool = [...cells, ...(otherId ? ['chess_item_5_08_e_a'] : []), 'filler_1', 'filler_2', 'filler_3'];
    const offer = (taken) => {
      const out = [];
      h.onLevelUp({
        data, counter: (k) => (k === 'band:cathy:cellTaken' ? taken : 0),
        rollPool: (_id, { exclude = [] } = {}) => { const id = pool.find((x) => !exclude.includes(x)); return id ? { kind: 'item', id } : null; },
        offerItems: (ids) => out.push(...ids),
      });
      return out;
    };
    assert.ok(cells.every((c) => offer(0).includes(c)), 'before the cell is taken it can be offered');
    const after = offer(1);
    assert.equal(after.length, 3, 'a full offer');
    for (const c of cells) assert.ok(!after.includes(c), `${c} left out once taken`);
    if (otherId) assert.ok(after.includes('chess_item_5_08_e_a'), 'the default cell id is not left out on a version that gives it to another item');
  });
}

// =====================================================================================================================
// bonds, traits, tokens

test('reached(): on a version\'s build 9 炎 whose record lacks ex_bond_char_cnt (no 9-member tier) spawn ONE 炎佑; without config.version two', (t) => {
  const data = clone(getData({ log: QUIET }));
  for (const b of data.bonds.yanShip.buffs) if (b.bb) delete b.bb.ex_bond_char_cnt;
  t.after(() => setGameData(null));
  const ids = Array.from({ length: 9 }, (_, i) => `y${i}_a`);
  const chess = Object.fromEntries(ids.map((id) => [id, chessRec({ id, bonds: ['yanShip'], profession: 'WARRIOR', skill: null,
    stats: { atk: 1000, maxHp: 10000, def: 0, blockCnt: 2 } })]));
  for (const [d, want] of [[versioned(data), 1], [data, 2]]) {
    setGameData(d);
    const h = makeBattle({
      defs: { chess, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e8, speed: 0 }) } },
      units: ids.map((chessId, i) => ({ chessId, row: 10 + Math.floor(i / 7), col: 3 + (i % 7) })),
      bonds: { yanShip: { count: 9, active: true, tier: 3, layers: 0 } },
    });
    h.step(1);
    assert.equal(h.b.allyUnits.filter((u) => u.defId === TOKEN_IDS.yanyou && u.alive).length, want, d.config.version ? 'version' : 'default');
    checkInvariants(h.b);
  }
});

for (const [farId, swapGains] of [['chess_char_4_99_a', 8], ['chess_x_test_far_a', 4]]) test(`远牙: on a version\'s build the trait its own traits grant gains on dollSwap under other chess and garrison ids (${farId}: ${swapGains === 8 ? 'official, gains' : 'a plugin chess, no grant'})`, (t) => {
  const data = versioned(clone(getData({ log: QUIET })));
  // another version's ids: 远牙 at chess_char_4_99, its trait garrison_901_a granting garrison_902_a (a copy of 108);
  // a plugin chess_x_ record with his charId adds no grant (official records only)
  const far = { ...data.chess.chess_char_4_20_a, chessId: farId, baseId: farId, goldenId: null, garrisonIds: ['garrison_901_a'] };
  data.chess[farId] = far;
  data.garrisons.garrison_901_a = { ...data.garrisons.garrison_148_a, garrisonId: 'garrison_901_a', bbStr: { give_garrison_id: 'garrison_902_a' } };
  data.garrisons.garrison_902_a = { ...data.garrisons.garrison_108_a, garrisonId: 'garrison_902_a' };
  setGameData(data);
  t.after(() => setGameData(null));
  const bond = { count: 3, active: true, tier: 1, layers: 0 };
  const h = makeBattle({
    data: new DataSource(data, null),
    units: [{ chessId: farId, row: 10, col: 3 }, { chessId: 'chess_char_2_11_a', row: 10, col: 8 }],
    bonds: { kazimierzShip: bond, preciShip: bond }, autoFinish: false, timeLimit: 300,
  });
  h.step();
  const u = h.unit('chess_char_2_11_a');
  const gains = () => h.result().perPlayer.p1.layerGains;
  assert.deepEqual(gains(), { kazimierzShip: 4, preciShip: 4 }, 'initial deployment');
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive && u.trait.doll, 'the lethal hit switches to a substitute');
  assert.deepEqual(gains(), { kazimierzShip: swapGains, preciShip: swapGains }, 'the switch gains (official 远牙 only)');
  checkInvariants(h.b);
});

test('夕: on a version\'s build her generic-kit dragon follows her charId (any official chess id), not a plugin chess', (t) => {
  const raw = new DataSource(getData({ log: QUIET }), null).rawChess('chess_char_5_12_a');
  setGameData(versioned(getData({ log: QUIET })));
  t.after(() => setGameData(null));
  for (const [id, want] of [['chess_char_5_99_a', true], ['chess_x_test_dusk_a', false]]) {
    const h = makeBattle({
      defs: { chess: { [id]: { ...raw, chessId: id, baseId: id, goldenId: null } }, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e8, speed: 0 }) } },
      kits: { [id]: genericKit }, units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'e_dummy', pos: [10, 5] }],
      autoFinish: false, timeLimit: 30,
    });
    assert.equal(h.runUntil(() => h.b.allyUnits.some((u) => u.defId === TOKEN_IDS.duskDragon), 10), want, id);
    checkInvariants(h.b);
  }
});

// =====================================================================================================================
// bands

test('auto_chess_change_map: Touch\'s map characters have a battle part and count as team support; 第一期\'s 森蚺 device switch also supports the team', (t) => {
  t.after(() => setGameData(null));
  // the bands carrying the key in each directory → whether it is Touch's map-character shape
  const want = { band_amedic: true, band_zumama: true };
  for (const dir of DIRS) {
    const data = dataOf(dir);
    setGameData(data);
    const holders = Object.keys(data.bands || {}).filter((id) => (data.bands[id].buffs || []).some((b) => b.key === 'auto_chess_change_map'));
    // 下半 (the default and V2_1): Touch; 上半: 森蚺
    assert.deepEqual(holders, data.config?.season === 'act1autochess' ? ['band_zumama'] : ['band_amedic'], label(dir));
    const roles = new Map(buildPlaybook(data, { modeId: 'mode_single_normal' }).bands.map((b) => [b.id, b.roleClasses]));
    for (const id of holders) {
      assert.equal(bandHasBattlePart(id), want[id], `${label(dir)} ${id}: battle part`);
      assert.equal(roles.get(id)?.includes('team-support'), want[id], `${label(dir)} ${id}: team support`);
    }
  }
});

/**
 * The band ids code keys behaviour by on every data (bands/meta.js band_cathy / DUCK_BAND, bands/battle.js AMEDIC_BAND,
 * server/match/gamedata.js band_bldsk / band_cannot). Bond ids are all keyed by id too (bonds/core.js INSTALLERS,
 * memberOf(…, 'yanShip'), addon …): DESIGN §35.22.4 relies on a version reusing them only for the same band or bond.
 */
const CODE_KEYED_BANDS = Object.freeze(['band_cathy', 'band_ducklord', 'band_amedic', 'band_bldsk', 'band_cannot']);
for (const dir of DIRS.filter((d) => !isDefault(d))) {
  test(`bands and bonds of ${label(dir)}: each code-keyed band id and every shared bond id keeps the default's name and effectId`, () => {
    const def = dataOf(DEFAULT_DIR);
    const data = dataOf(dir);
    for (const id of CODE_KEYED_BANDS) {
      const b = data.bands?.[id];
      if (!b) continue;
      assert.deepEqual([b.name, b.effectId], [def.bands[id].name, def.bands[id].effectId], `${label(dir)} ${id}`);
    }
    for (const [id, b] of Object.entries(data.bonds || {})) {
      if (!def.bonds[id]) continue;
      assert.deepEqual([b.name, b.effectId], [def.bonds[id].name, def.bonds[id].effectId], `${label(dir)} ${id}`);
    }
  });
}

// =====================================================================================================================
// AI

test('AI: another version\'s data gets no community evidence and no default-id i18n overlay', () => {
  const data = getData({ log: QUIET });
  const other = versioned(data);
  const def = buildPlaybook(data, { modeId: 'mode_single_normal' });
  assert.ok(def.community.pairs.length || def.community.builds.length, 'the default keeps its community evidence');
  const pb = buildPlaybook(other, { modeId: 'mode_single_normal' });
  assert.deepEqual(pb.community, { revision: null, pairs: [], builds: [], roles: [] });
  const en = knowledgePack(other, { modeId: 'mode_single_normal', language: 'en' });
  assert.ok(en.operators.every((p) => p.name === p.nameZh), 'Chinese names');
  assert.ok(knowledgePack(data, { modeId: 'mode_single_normal', language: 'en' }).operators.some((p) => p.name !== p.nameZh));
});

/** A store fetch over `dir`'s files, with the language folder's overlays (data/i18n) at /data/i18n/. */
function dirFetch(dir) {
  return async (url) => {
    const rel = url.replace(/^\/data\//, '');
    const abs = rel.startsWith('i18n/') ? path.join(DEFAULT_DIR, rel) : path.join(dir, rel);
    if (!existsSync(abs)) return { ok: false, status: 404, json: async () => null };
    const text = readFileSync(abs, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  };
}
const TEXT_FILES = ['chess', 'bonds', 'items', 'bands', 'enemies', 'tokens', 'choices', 'config', 'backups'];

for (const dir of DIRS) {
  test(`client (public/js/data.js): ${label(dir)} ${isDefault(dir) ? 'takes' : 'never takes'} the language folder's data/i18n overlay; a content set's own texts apply`, async () => {
    const files = TEXT_FILES.filter((n) => existsSync(path.join(dir, DATA_FILES[n])));
    const d = createDataStore({ fetch: dirFetch(dir), retryDelays: [] });
    await d.loadAll(files);
    assert.equal(await d.setLocale('en'), 'en');
    const changed = () => files.filter((n) => d.get(n) !== d.getRaw(n));
    if (isDefault(dir)) { assert.ok(changed().includes('items'), 'the default data is localized'); return; }
    // 上半 reuses default ids for other records (chess_item_2_03_e_b, eff_acarm054, garrison_69_b …): nothing applied
    assert.deepEqual(changed(), [], 'served version files');
    assert.equal(d.lookup('items', 'chess_item_2_03_e_b').desc, d.lookupRaw('items', 'chess_item_2_03_e_b').desc);
    const en = JSON.parse(readFileSync(path.join(DEFAULT_DIR, 'i18n/en.json'), 'utf8'));
    const values = Object.fromEntries(files.map((n) => [n, d.getRaw(n)]));
    // a version content set without texts of its own: none
    d.setContent({ id: 'cs-version', values });
    await d.setLocale('en');
    assert.deepEqual(changed(), [], 'a version content set without its own texts');
    // with its own (here: the default overlay standing in for a per-version one, M3): applied
    d.setContent({ id: 'cs-version-own', values, overlay: async () => en, langs: ['en'] });
    await d.setLocale('en');
    assert.ok(changed().length > 0, 'the set\'s own texts apply');
  });
}
