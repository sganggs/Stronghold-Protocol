// shared/loadoutRecord.js — operator loadouts (DESIGN §16, DATA.md §2.2): a data/chess.json record as the selected
// skill / module make it. Pure ESM shared by the simulation (server/sim/simdata.js re-exports it: getChess(id, loadout)
// builds unit defs from it) and the client UI (the detail card shows the stats / 特性 / talents the unit fights with —
// user playtest #2 integration: an elite on 不装备 showed its default module's ATK and trait; attackRangeGrid = the range
// it is deployed with, also the board overlay and the deploy wheel — extendedGrid is the battle's own 攻击距离 growth,
// re-exported by server/sim/targeting.js). One implementation, so the card and the battle never disagree. (Which
// choices a player may make: shared/protocol.js loadoutOptions.) A loadout may carry the operator's potential (潜能 1–6,
// the player's 干员调配 setting since 0.2.2 — shared/potential.js): the record is composed at it first.

import { GEO } from './constants.js';
import { atPotential, isPotential, POTENTIAL_DEFAULT } from './potential.js';

/**
 * Resolve a loadout against a chess record. `potential` (潜能 1–6; anything else = 6, full potential — the default)
 * rides along: loadoutRecord composes the record at it (shared/potential.js atPotential).
 * @param {object|null} rec data/chess.json record
 * @param {{ skillIndex?: number, moduleId?: string, skill?: number, module?: string, potential?: number }|null} [loadout]
 * @returns {{ skillIndex: number|null, moduleId: string|null, potential: number, skillIsDefault: boolean,
 *             moduleIsDefault: boolean, potentialIsDefault: boolean, isDefault: boolean }|null} null without a record;
 *             `moduleId` null for chess without module choices
 */
export function resolveRecordLoadout(rec, loadout = null) {
  if (!rec || typeof rec !== 'object') return null;
  const skills = Array.isArray(rec.skills) ? rec.skills : null;
  const defSkill = rec.skill && Number.isInteger(rec.skill.index) ? rec.skill.index : (skills?.find((s) => s && s.isDefault)?.index ?? null);
  const lo = loadout && typeof loadout === 'object' ? loadout : {};
  const wantSkill = lo.skillIndex ?? lo.skill;
  const skillIndex = skills && Number.isInteger(wantSkill) && skills.some((s) => s && s.index === wantSkill) ? wantSkill : defSkill;
  const mods = Array.isArray(rec.modules) ? rec.modules : null;
  const defMod = mods ? (mods.find((m) => m && m.isDefault)?.uniEquipId ?? 'none') : null;
  const wantMod = lo.moduleId ?? lo.module;
  const moduleId = mods && (wantMod === 'none' || (typeof wantMod === 'string' && mods.some((m) => m && m.uniEquipId === wantMod))) ? wantMod : defMod;
  const potential = isPotential(lo.potential) ? lo.potential : POTENTIAL_DEFAULT;
  const skillIsDefault = skillIndex === defSkill;
  const moduleIsDefault = moduleId === defMod;
  const potentialIsDefault = potential === POTENTIAL_DEFAULT;
  return {
    skillIndex, moduleId, potential, skillIsDefault, moduleIsDefault, potentialIsDefault,
    isDefault: skillIsDefault && moduleIsDefault && potentialIsDefault,
  };
}

const clean6 = (v) => (typeof v !== 'number' || !Number.isFinite(v) || Number.isInteger(v) || Math.abs(v) >= 1e6 ? v : Math.round(v * 1e6) / 1e6);

/** Stats with a module: the no-module `statsBase` + the module's flat `attr` (same arithmetic as tools/build-data.mjs). */
export function composeStats(statsBase, attr) {
  const s = { ...(statsBase || {}) };
  for (const [f, v] of Object.entries(attr || {})) s[f] = clean6((s[f] || 0) + v);
  return s;
}

/**
 * A talent entry without its potential chain (shared/potential.js: `potMin` / `potBelow`).
 * @param {any} t
 * @returns {any}
 */
const unchained = ({ potMin: _m, potBelow: _b, ...t }) => t;

/**
 * Talents with a module: apply ModuleRecord.talentChanges to the no-module talents — the merge rule of
 * tools/build-data.mjs mergeTalentChanges (override of an existing index: module values win, base keys the module does
 * not restate are kept; otherwise appended; empty placeholders dropped). The result carries no potential chains: a merged
 * list is composed at one potential (resolve the inputs first — shared/potential.js atPotential).
 */
export function composeTalents(base, changes) {
  const talents = (base || []).map(unchained);
  for (const ch0 of changes || []) {
    const { talentIndex, ...rest } = unchained(ch0);
    const rec = { index: talentIndex, ...rest, fromModule: true };
    const at = talentIndex >= 0 ? talents.findIndex((x) => x.index === talentIndex) : -1;
    if (at >= 0) {
      const old = talents[at];
      talents[at] = {
        ...rec,
        name: rec.name || old.name, desc: rec.desc ?? old.desc, descRaw: rec.descRaw ?? old.descRaw,
        bb: { ...old.bb, ...rec.bb }, bbStr: { ...old.bbStr, ...rec.bbStr },
        rangeGrid: rec.rangeGrid || old.rangeGrid, tokenKey: rec.tokenKey || old.tokenKey,
        hidden: old.hidden && rec.hidden,
      };
    } else {
      talents.push(rec);
    }
  }
  return talents.filter((t) => t.name || t.desc || Object.keys(t.bb || {}).length || t.tokenKey);
}

/**
 * The chess record as the selected loadout makes it (a new object; the input is never mutated): at a potential below 6
 * the record at that potential first (stats / statsBase / talents / talentsBase / module talent changes — shared/potential.js
 * atPotential); `skill` = the selected SkillRecord; golden chess with a non-default module choice: `stats` = statsBase +
 * module attr, `trait` = the module's traitOverride or traitBase, `talents` = talentsBase + talentChanges, `module` =
 * the chosen module (`active:false`, id null for 'none'). A talent that summons through a container token (凛御银灰)
 * follows the selected skill's token. The default loadout returns `rec` itself.
 * @param {object} rec0 data/chess.json record
 * @param {object} lo resolveRecordLoadout(rec0, …)
 */
export function loadoutRecord(rec0, lo) {
  if (!rec0 || !lo || lo.isDefault) return rec0;
  const rec = lo.potentialIsDefault === false ? atPotential(rec0, lo.potential) : rec0;
  const out = { ...rec };
  if (!lo.moduleIsDefault && Array.isArray(rec.modules)) {
    const m = lo.moduleId === 'none' ? null : rec.modules.find((x) => x.uniEquipId === lo.moduleId) ?? null;
    out.stats = composeStats(rec.statsBase ?? rec.stats, m ? m.attr : null);
    out.trait = (m && m.traitOverride) || rec.traitBase || rec.trait;
    out.talents = composeTalents(rec.talentsBase ?? rec.talents, m ? m.talentChanges : null);
    out.module = m
      ? { id: m.uniEquipId, name: m.name ?? null, type: m.typeName ?? null, level: m.level ?? rec.module?.level ?? 0, active: true }
      : { id: null, name: null, type: null, level: rec.module?.level ?? 0, active: false };
  }
  if (!lo.skillIsDefault && Array.isArray(rec.skills)) {
    const s = rec.skills.find((x) => x.index === lo.skillIndex);
    if (s) {
      out.skill = s;
      if (rec.assets) out.assets = { ...rec.assets, skillIcon: s.iconId ?? rec.assets.skillIcon };
      const tok = s.overrideTokenKey;
      if (tok && (rec.tokens || []).includes(tok) && (out.talents || []).some((t) => t && t.containerTokenKey)) {
        out.talents = out.talents.map((t) => (t && t.containerTokenKey ? { ...t, tokenKey: tok } : t));
      }
    }
  }
  return out;
}

/**
 * Whether the selected skill's `rangeGrid` is the range the operator is deployed with
 * (「被动效果：攻击范围扩大」, 引星棘刺 S3). `passiveRange` is that reading of the Chinese skill text, stored by
 * tools/build-data.mjs (GitHub #700). The client previews the localized record, whose `desc` no longer has the line.
 * A record without the flag — Chinese data from before the flag, or a plugin — still matches the Simplified line.
 * [ASSUMED] A plugin may set `passiveRange: true` without the line. Any other value, including `false`, still falls
 * through to the line, as `placeOnRanged` does. A translation alone, with no flag, keeps the operator's own grid.
 * @param {object|null} sk
 * @returns {boolean}
 */
function skillCarriesOwnRange(sk) {
  if (!sk || !Array.isArray(sk.rangeGrid) || !sk.rangeGrid.length) return false;
  if (sk.passiveRange === true) return true;
  return /被动效果：攻击范围扩大/.test(String(sk.desc ?? '')); // i18n-ignore: fallback match, not player text
}

/**
 * Whether the equipped module's added trait line widens the attack range (「攻击范围扩大」, 莱恩哈特 SPC-X).
 * `trait.rangeExpand` is that reading of the Chinese `moduleDesc` (GitHub #700). Absent → the Simplified line.
 * [ASSUMED] A plugin may set `rangeExpand: true` without the line. `false` still falls through to the line.
 * A translation alone, with no flag, does not widen the preview.
 * @param {object|null} trait
 * @returns {boolean}
 */
function moduleWidensRange(trait) {
  if (trait?.rangeExpand === true) return true;
  return /攻击范围扩大/.test(String(trait?.moduleDesc ?? '')); // i18n-ignore: fallback match, not player text
}

/**
 * The attack range a (loadout-resolved) chess record fights with from its deployment — the detail card without a live
 * entry, the board's range overlay and the deploy wheel (DESIGN §16), the same tiles the battle unit starts with (prep
 * m.unitStats `range`): the selected skill's grid when it is that skill's own range (`passiveRange`, or the Chinese
 * line "被动效果：攻击范围扩大" when the flag is absent — 引星棘刺 S3 3-9); else an elite whose equipped module widens
 * the range (`trait.rangeExpand`, or "攻击范围扩大" when the flag is absent) uses that module's own grid — its
 * range-only talent change (talentIndex −1), e.g. SPC-X = the 3×3 caster range + the centre tile [0,3] — as the
 * kits do (kits/shared/tier4.js moduleRangeGrid). The kits still read the Chinese record; this preview does not
 * change them. Anything else uses `rangeGrid`. Then grown by the 特性's permanent 攻击距离 (traitRangeExtend:
 * 信仰搅拌机 SPT-Y "攻击距离+1"). A running skill's range is the live entry's.
 * @param {object|null} rec loadoutRecord(…) output (or a data/chess.json record: its default module)
 * @returns {number[][]|null}
 */
export function attackRangeGrid(rec) {
  if (!rec || typeof rec !== 'object') return null;
  let g = Array.isArray(rec.rangeGrid) ? rec.rangeGrid : null;
  const sk = rec.skill;
  const m = rec.module;
  if (skillCarriesOwnRange(sk)) {
    g = sk.rangeGrid;
  } else if (rec.isGolden && m && m.active && m.id && moduleWidensRange(rec.trait)) {
    const mod = (Array.isArray(rec.modules) ? rec.modules : []).find((x) => x && x.uniEquipId === m.id);
    const mg = (mod?.talentChanges || []).find((t) => t && t.talentIndex === -1 && Array.isArray(t.rangeGrid) && t.rangeGrid.length)?.rangeGrid;
    if (mg) g = mg;
  }
  const ext = traitRangeExtend(rec);
  return g && ext ? extendedGrid(g, ext) : g;
}

/**
 * The permanent 攻击距离 (ability_range_forward_extend) a record's 特性 grants — a module's, e.g. 信仰搅拌机 SPT-Y
 * "攻击距离+1" (its kit's rangeUp: a persistent rangeExtend buff, s.baseRangeExtend); 0 for one that works in 集成战略
 * only (空弦 ISW-A). `trait.modeOnly` is that reading of the Chinese `moduleDesc`, stored at build time (GitHub #700),
 * so a localized record still refuses the extend. Absent → the Simplified line 「集成战略」. [ASSUMED] A plugin may set
 * `modeOnly: true` without the line. `false` still falls through to the line. A translation alone, with no flag, does
 * not suppress the extend. The other 攻击距离 of the mode are skills' (their running range).
 * @param {object|null} rec loadoutRecord(…) output
 */
export function traitRangeExtend(rec) {
  const t = rec && typeof rec === 'object' ? rec.trait : null;
  if (!t || typeof t !== 'object') return 0;
  if (t.modeOnly === true || /集成战略/.test(String(t.moduleDesc ?? ''))) return 0; // i18n-ignore: fallback match, not player text
  const n = Math.floor(Number(t.bb?.ability_range_forward_extend) || 0);
  return n > 0 ? n : 0;
}

/**
 * A range grid (`[dRow, dCol]`, facing RIGHT) grown by `extend` (rangeExtend / 攻击距离, DESIGN §3): every row gains
 * the whole tiles 1 … ⌊extend⌋ beyond its far (+dCol) end — the relative form of what server/sim/targeting.js
 * absoluteRangeKeys builds, deduplicated, junk entries dropped. One implementation for the battle (re-exported by
 * targeting.js: Battle._refreshRange keeps it as `unit.liveRangeGrid`, the card's live 攻击范围, when an extend applies)
 * and the record's attackRangeGrid.
 * @param {Array<[number, number]>|null|undefined} grid
 * @param {number} [extend]
 * @returns {Array<[number, number]>}
 */
export function extendedGrid(grid, extend = 0) {
  const out = [];
  const seen = new Set();
  const add = (dr, dc) => { const k = `${dr},${dc}`; if (!seen.has(k)) { seen.add(k); out.push([dr, dc]); } };
  if (!Array.isArray(grid)) return out;
  const cells = grid.filter((p) => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]));
  for (const [dr, dc] of cells) add(dr, dc);
  if (extend > 0 && Number.isFinite(extend)) {
    const maxByRow = new Map();
    for (const [dr, dc] of cells) maxByRow.set(dr, Math.max(maxByRow.get(dr) ?? -Infinity, dc));
    for (const [dr, mx] of maxByRow) for (let k = 1; k <= Math.min(extend, GEO.COLS); k++) add(dr, mx + k);
  }
  return out;
}
