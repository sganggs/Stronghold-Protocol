// shared/loadoutRecord.js — operator loadouts (DESIGN §16, DATA.md §2.2): a data/chess.json record as the selected
// skill / module make it. Pure ESM shared by the simulation (server/sim/simdata.js re-exports it: getChess(id, loadout)
// builds unit defs from it) and the client UI (the detail card shows the stats / 特性 / talents the unit fights with —
// user playtest #2 integration: an elite on 不装备 showed its default module's ATK and trait; attackRangeGrid = the range
// it is deployed with, also the board overlay and the deploy wheel — extendedGrid is the battle's own 攻击距离 growth,
// re-exported by server/sim/targeting.js). One implementation, so the card and the battle never disagree. (Which
// choices a player may make: shared/protocol.js loadoutOptions.)

import { GEO } from './constants.js';

/**
 * Resolve a loadout against a chess record.
 * @param {object|null} rec data/chess.json record
 * @param {{ skillIndex?: number, moduleId?: string, skill?: number, module?: string }|null} [loadout]
 * @returns {{ skillIndex: number|null, moduleId: string|null, skillIsDefault: boolean, moduleIsDefault: boolean,
 *             isDefault: boolean }|null} null without a record; `moduleId` null for chess without module choices
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
  const skillIsDefault = skillIndex === defSkill;
  const moduleIsDefault = moduleId === defMod;
  return { skillIndex, moduleId, skillIsDefault, moduleIsDefault, isDefault: skillIsDefault && moduleIsDefault };
}

const clean6 = (v) => (typeof v !== 'number' || !Number.isFinite(v) || Number.isInteger(v) || Math.abs(v) >= 1e6 ? v : Math.round(v * 1e6) / 1e6);

/** Stats with a module: the no-module `statsBase` + the module's flat `attr` (same arithmetic as tools/build-data.mjs). */
export function composeStats(statsBase, attr) {
  const s = { ...(statsBase || {}) };
  for (const [f, v] of Object.entries(attr || {})) s[f] = clean6((s[f] || 0) + v);
  return s;
}

/**
 * Talents with a module: apply ModuleRecord.talentChanges to the no-module talents — the merge rule of
 * tools/build-data.mjs mergeTalentChanges (override of an existing index: module values win, base keys the module does
 * not restate are kept; otherwise appended; empty placeholders dropped).
 */
export function composeTalents(base, changes) {
  const talents = (base || []).map((t) => ({ ...t }));
  for (const ch of changes || []) {
    const { talentIndex, ...rest } = ch;
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
 * The chess record as the selected loadout makes it (a new object; the input is never mutated): `skill` = the selected
 * SkillRecord; golden chess with a non-default module choice: `stats` = statsBase + module attr, `trait` = the module's
 * traitOverride or traitBase, `talents` = talentsBase + talentChanges, `module` = the chosen module (`active:false`,
 * id null for 'none'). A talent that summons through a container token (凛御银灰) follows the selected skill's token.
 * The default loadout returns `rec` itself.
 * @param {object} rec data/chess.json record
 * @param {object} lo resolveRecordLoadout(rec, …)
 */
export function loadoutRecord(rec, lo) {
  if (!rec || !lo || lo.isDefault) return rec;
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
 * The attack range a (loadout-resolved) chess record fights with from its deployment — the detail card without a live
 * entry, the board's range overlay and the deploy wheel (DESIGN §16), the same tiles the battle unit starts with (prep
 * m.unitStats `range`): the selected skill's grid when it reads "被动效果：攻击范围扩大" (引星棘刺 S3 3-9: her own range
 * while she carries it, tier5 kit); else an elite whose equipped module reads "攻击范围扩大" uses that module's own grid
 * — its range-only talent change (talentIndex −1), e.g. SPC-X = the 3×3 caster range + the centre tile [0,3] — as the
 * kits do (tier4 moduleRangeGrid, tier5 moduleRangeUp); anything else its `rangeGrid`. Then grown by the 特性's
 * permanent 攻击距离 (traitRangeExtend: 信仰搅拌机 SPT-Y "攻击距离+1"). A running skill's range is the live entry's.
 * @param {object|null} rec loadoutRecord(…) output (or a data/chess.json record: its default module)
 * @returns {number[][]|null}
 */
export function attackRangeGrid(rec) {
  if (!rec || typeof rec !== 'object') return null;
  let g = Array.isArray(rec.rangeGrid) ? rec.rangeGrid : null;
  const sk = rec.skill;
  const m = rec.module;
  if (sk && Array.isArray(sk.rangeGrid) && sk.rangeGrid.length && /被动效果：攻击范围扩大|Passive: Attack Range expanded/i.test(String(sk.desc ?? ''))) {
    g = sk.rangeGrid;
  } else if (rec.isGolden && m && m.active && m.id && /攻击范围扩大|Attack Range expanded/i.test(String(rec.trait?.moduleDesc ?? ''))) {
    const mod = (Array.isArray(rec.modules) ? rec.modules : []).find((x) => x && x.uniEquipId === m.id);
    const mg = (mod?.talentChanges || []).find((t) => t && t.talentIndex === -1 && Array.isArray(t.rangeGrid) && t.rangeGrid.length)?.rangeGrid;
    if (mg) g = mg;
  }
  const ext = traitRangeExtend(rec);
  return g && ext ? extendedGrid(g, ext) : g;
}

/**
 * The permanent 攻击距离 (ability_range_forward_extend) a record's 特性 grants — a module's, e.g. 信仰搅拌机 SPT-Y
 * "攻击距离+1" (tier4 rangeUp: a persistent rangeExtend buff, s.baseRangeExtend); 0 for one that works "在集成战略中" only
 * (空弦 ISW-A). The other 攻击距离 of the mode are skills' (their running range).
 * @param {object|null} rec loadoutRecord(…) output
 */
export function traitRangeExtend(rec) {
  const t = rec && typeof rec === 'object' ? rec.trait : null;
  if (!t || typeof t !== 'object' || /集成战略|Integrated Strategies/i.test(String(t.moduleDesc ?? ''))) return 0;
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
