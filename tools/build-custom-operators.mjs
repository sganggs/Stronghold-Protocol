#!/usr/bin/env node
// Build the official DIY operator catalog from local Arknights excel tables: every obtainable six-star
// operator that is not part of the season's own chess pool, composed into each of the four 甄选 slots
// (tier V/VI, normal/golden) at the slot's training status.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChess } from './build-data.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'custom-operators.json');
const SLOT_IDS = [
  ['5_a', 'chess_char_5_diy1_a'], ['5_b', 'chess_char_5_diy1_b'],
  ['6_a', 'chess_char_6_diy1_a'], ['6_b', 'chess_char_6_diy1_b'],
];
const SKILL_TYPE = { 0: 'PASSIVE', 1: 'MANUAL', 2: 'AUTO' };
const DURATION_TYPE = { 0: 'NONE', 1: 'DURATION', 2: 'INFINITE', 3: 'AMMO' };
const PHASE = { 0: 'PHASE_0', 1: 'PHASE_1', 2: 'PHASE_2' };

function parseArgs(argv) {
  let source = join(ROOT, '.cache', 'gamedata');
  let out = OUT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { console.log('usage: node tools/build-custom-operators.mjs --source <data-root> [--out <file>]'); process.exit(0); }
    if (arg === '--source' || arg === '--out') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a path argument`);
      if (arg === '--source') source = resolve(value);
      else out = resolve(value);
      continue;
    }
    if (arg.startsWith('--source=')) source = resolve(arg.slice(9));
    else if (arg.startsWith('--out=')) out = resolve(arg.slice(6));
    else throw new Error(`unknown option ${arg}`);
  }
  return { source, out };
}

async function loadJson(root, rel) { return JSON.parse(await readFile(join(root, rel), 'utf8')); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function normaliseChar(char) {
  const out = clone(char);
  const rawRarity = Number(out.rarity);
  out.rarity = rawRarity >= 0 && rawRarity <= 5 ? `TIER_${rawRarity + 1}` : out.rarity;
  out.phases = (out.phases || []).map((p) => ({ ...p, phase: typeof p.phase === 'number' ? PHASE[p.phase] : p.phase }));
  return out;
}
function normaliseSkills(table) {
  return Object.fromEntries(Object.entries(table).map(([id, skill]) => [id, {
    ...skill,
    levels: (skill.levels || []).map((lv) => ({ ...lv, skillType: typeof lv.skillType === 'number' ? SKILL_TYPE[lv.skillType] || String(lv.skillType) : lv.skillType, durationType: typeof lv.durationType === 'number' ? DURATION_TYPE[lv.durationType] || String(lv.durationType) : lv.durationType })),
  }]));
}
function factionBonds(char, bondInfoDict) {
  const ids = new Set([char.nationId, char.groupId, char.teamId].filter(Boolean));
  const matches = Object.entries(bondInfoDict || {}).filter(([, bond]) => (bond.powerIdList || []).some((id) => ids.has(id))).map(([id]) => id).sort();
  return matches.length ? matches : ['emptyShip'];
}
function makeContext(tables, act, chars, skills, uniequip, battleEquip, rangeTable) {
  const charTable = { ...tables.character };
  for (const char of Object.values(chars)) charTable[char.charId] = char;
  return { act, ac: tables.activity.autoChessData, charTable, skillTable: skills, rangeTable, uniequip, battleEquip, handbook: {}, enemyDb: new Map(), levels: {}, templateIds: [], stageIds: [], enemyDataLevelId: null, research: { core: {}, bonds: {}, items: {}, enemies: {}, maps: {}, assets: {} }, manifest: null };
}
function buildSyntheticAct(sourceAct, chars, bonds) {
  const act = clone(sourceAct);
  act.charChessDataDict = {};
  act.chessNormalIdLookupDict = {};
  act.charShopChessDatas = {};
  act.diyChessDict = {};
  const priceRows = act.shopCharChessInfoData || {};
  for (const [slot, listedId] of SLOT_IDS) {
    const normalId = listedId.replace(/_b$/, '_a');
    const official = sourceAct.charChessDataDict[normalId];
    const officialShop = sourceAct.charShopChessDatas[normalId];
    const eliteId = normalId.replace(/_a$/, '_b');
    // Synthetic entries are built as normal records; DIY metadata is applied after composition.
    act.charShopChessDatas[normalId] = { ...officialShop, chessType: 'PRESET' };
    for (const [id, isGolden] of [[normalId, false], [eliteId, true]]) {
      const status = clone(sourceAct.charChessDataDict[id]?.status || official.status);
      act.charChessDataDict[id] = { ...clone(sourceAct.charChessDataDict[id] || official), chessId: id, isGolden, status, bondIds: bonds, garrisonIds: [] };
      act.chessNormalIdLookupDict[id] = normalId;
    }
    act.charShopChessDatas[normalId].charId = chars[0].charId;
    act.charShopChessDatas[normalId].defaultSkillIndex = 0;
    act.charShopChessDatas[normalId].defaultUniEquipId = null;
    const tier = officialShop.chessLevel;
    if (!priceRows[String(tier)]) throw new Error(`missing DIY price table tier ${tier}`);
  }
  return act;
}
function selectedModuleId(uniequip, charId) {
  return (uniequip.charEquip?.[charId] || []).find((id) => uniequip.equipDict?.[id]?.type === 'ADVANCED') || null;
}

/**
 * The officially eligible 甄选 (DIY) candidates: every obtainable six-star operator that is not already
 * part of this season's chess pool (the pool's own operators are recruited normally, so a DIY slot
 * never duplicates one). Deterministic: sorted by charId.
 */
function eligibleCharIds(activity, character) {
  const act = activity.activity.AUTOCHESS_SEASON.act2autochess;
  const pool = new Set();
  for (const shop of Object.values(act.charShopChessDatas || {})) {
    if (shop && typeof shop === 'object') {
      if (shop.charId) pool.add(shop.charId);
      if (shop.backupCharId) pool.add(shop.backupCharId);
    }
  }
  return Object.entries(character || {})
    .filter(([id, c]) => c && id.startsWith('char_') && !pool.has(id) && !c.isNotObtainable
      && (Number(c.rarity) === 5 || c.rarity === 'TIER_6') && c.phases && c.phases[2])
    .map(([id]) => id)
    .sort();
}

export async function buildCustomCatalog({ source, out = OUT } = {}) {
  if (!source) source = join(ROOT, '.cache', 'gamedata');
  const [activity, character, skillTableRaw, rangeTable, uniequip, battleEquip] = await Promise.all([
    loadJson(source, 'excel/activity_table.json'), loadJson(source, 'excel/character_table.json'), loadJson(source, 'excel/skill_table.json'),
    loadJson(source, 'excel/range_table.json'), loadJson(source, 'excel/uniequip_table.json'), loadJson(source, 'excel/battle_equip_table.json'),
  ]);
  const sourceAct = activity.activity.AUTOCHESS_SEASON.act2autochess;
  const selected = Object.fromEntries(eligibleCharIds(activity, character)
    .map((charId) => [charId, { ...normaliseChar(character[charId]), charId }]));
  const skills = normaliseSkills(skillTableRaw);
  const bondsFor = (char) => factionBonds(char, activity.autoChessData.bondInfoDict);
  const catalog = {};
  for (const char of Object.values(selected)) {
    const bonds = bondsFor(char);
    const act = buildSyntheticAct(sourceAct, [char], bonds);
    const ctx = makeContext({ activity, character, rangeTable }, act, selected, skills, uniequip, battleEquip, rangeTable);
    for (const slot of SLOT_IDS) {
      const [variant, officialId] = slot;
      const cd = act.charChessDataDict[officialId];
      const isGolden = variant.endsWith('_b');
      const baseId = isGolden ? officialId.replace(/_b$/, '_a') : officialId;
      const normalShop = act.charShopChessDatas[baseId];
      normalShop.charId = char.charId;
      normalShop.defaultSkillIndex = (char.skills || []).length - 1;
      const chosenModuleId = selectedModuleId(uniequip, char.charId);
      normalShop.defaultUniEquipId = isGolden ? chosenModuleId : null;
      act.charChessDataDict[officialId].status = { ...cd.status, evolvePhase: 2, charLevel: isGolden ? 60 : 1, skillLevel: isGolden ? 7 : 4, equipLevel: isGolden ? (variant.startsWith('6_') ? 3 : 1) : 0 };
      const built = buildChess(ctx).chess[officialId];
      if (!built) throw new Error(`builder produced no record for ${char.charId} ${variant}`);
      built.isDiy = true; built.visible = true; built.bonds = bonds; built.garrisonIds = [];
      if (built.modules && chosenModuleId) built.modules = built.modules.filter((module) => module.uniEquipId === chosenModuleId);
      built.charId = char.charId; built.baseId = `custom_${char.charId}_${variant}`; built.chessId = built.baseId;
      built.goldenId = null; built.identifier = null; built.upgradeChessId = null;
      catalog[char.charId] ||= { charId: char.charId, name: char.name, appellation: char.appellation, profession: char.profession, subProfessionId: char.subProfessionId, subProfessionName: built.subProfessionName, position: char.position, nationId: char.nationId || null, groupId: char.groupId || null, teamId: char.teamId || null, bonds, variants: {} };
      catalog[char.charId].variants[variant] = built;
    }
  }
  const text = JSON.stringify(catalog);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, text);
  return { catalog, source, out, count: Object.keys(catalog).length, variants: Object.values(catalog).reduce((n, c) => n + Object.keys(c.variants).length, 0), sourceVersion: activity.autoChessData.versionInfoDict || null };
}

async function main(argv = process.argv.slice(2)) {
  const { source, out } = parseArgs(argv);
  const result = await buildCustomCatalog({ source, out });
  console.log(`custom operators: ${result.count} chars, ${result.variants} variants; source=${result.source}; output=${result.out}`);
  console.log(`source version: ${JSON.stringify(result.sourceVersion)}`);
}

const invoked = (() => { try { return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (invoked) main().catch((error) => { console.error(`build-custom-operators: ${error.stack || error}`); process.exitCode = 1; });
