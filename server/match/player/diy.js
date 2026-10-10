// server/match/player/diy.js — PlayerState methods: 自选编队 (0.2.0 DIY; research 0.2.0 §2, the owner's decisions of
// 2026-10-05) — the human's picks for the four DIY slots and what a slotted operator changes in the player's own state.
//   * setDiy: the seat's picks when the match started (seats[].diy, server/lobby.js room.diy), re-checked against this
//     match's data and kit registry (shared/protocol.js checkDiyPicks, server/sim/content/kits/index.js KITTED_CHARS) and
//     fixed for the match — an out-of-match setting: a change during a match applies to the next one. Bots field no 自选
//     piece [ASSUMED]. `diy` = { [slotBaseId]: { charId, skillIndex, uniEquipId } } (frozen; uniEquipId null = none).
//   * the player's data view (diyGameData): with picks, `ps.gd` is a view of the match's GameData whose chess(id) is the
//     composed 自选 record of a slotted slot, both forms (shared/diy.js diyRecord: the slot's identity — tier, price, sell
//     price, the 3 → elite merge, status: E2 Lv1 skill rank 4 / E2 Lv60 rank 7 with the module at stage 1 at tier 5, 3 at
//     tier 6 — and the operator's body: name, class, position, stats, range, the pick's skill and module, no 特质, the
//     bonds derived from its factions; `diyFor` = the slot, `charId` = the operator). Every rule that reads a record
//     through ps.gd — bonds (bondsMeta), the 特质 / meta effects (effectsMeta makeCtx), placement and summon ranges, the
//     AI 托管 evaluation, names in toasts and tickers — sees the operator. A player without picks keeps the match's
//     GameData itself: nothing changes for anyone else. token(id) also finds the 自选 summons (data/backups.json
//     `tokens`) and placeableTokens() reads their variant of the owner form (`<charId>@<statusKey>`, shared/diy.js
//     diyTokenOwner), so a placeable 自选 summon comes to the hand like any operator's (PRTS 卫戍协议/帮助 §战斗部署).
//   * the per-player stock (initDiyStock, called by the match once its bans are drawn): each slotted DIY piece has copies
//     of its own — the tier's pool copies, 8 at tier 5 and 5 at tier 6 [ASSUMED: research 0.2.0 §2.5, the excel has no
//     stock field] — drawn by this player only; it never enters the shared pool (PR #71's shared shop was the mistake to
//     avoid). A piece all of whose bonds are switched off this match (本局禁用: the drawn bans and the mode's static list)
//     gets no stock and so leaves the shop, like a preset chess whose bonds are all off (PRTS 卫戍协议：盟约 "禁用盟约有可能
//     影响自选的支援干员"); 协防 (emptyShip) is never banned, so a prototype always stays. poolOf(baseId) routes every copy
//     taken or returned for a slotted slot to that stock (buy, reward picks, merges, promotions, sells, temp, elimination).
//   * the shop's draws (diyRollEntries): the stock of each slotted slot joins this player's copy-weighted rolls — the
//     shop's chess slots and the reward offers' temporary refreshes [ASSUMED] — weighted like any chess of its tier, once
//     the 调度中心 has reached the slot's shopLevel (activity_table shopLevelDisplayDataDict lists the tier-5 slots at
//     level 5 and the tier-6 slots at level 6; PRTS 帮助 "仅在调度中心等级 ≥ 干员所在等阶"). The price is the slot's (any
//     chess of its tier: 4).
//   * random grants (diyStockEntries, 0.2.0 WE2 #9): an effect, reward or 机变 card that grants this player a random
//     operator from the pool draws its stock too — 「自选干员放入后模拟中的补给池随机范围也将被相应扩大」 (bilibili), "调度中心
//     随机资源的范围将被扩大" (PRTS 新手教程) — under the roll's own tier rules (the effect's tier / maxTier: no 调度中心 gate,
//     as for a preset chess) and filters (bonds read through the player's data view).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { KITTED_CHARS } from '../../sim/content/kits/index.js';
import { checkDiyPicks } from '../../../shared/protocol.js';
import { diyRecord, diySlot, diyTokenOwner } from '../../../shared/diy.js';
import { atPotential } from '../../../shared/potential.js';

const posIntOr = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The copies of a player's slotted DIY pieces — the shared pool's copy interface (has / cap / left / take / give) for
 * those base ids only. `entries`: baseId → { cap, left, tier, shopLevel }.
 */
export class DiyStock {
  constructor() {
    /** @type {Map<string, { cap: number, left: number, tier: number, shopLevel: number }>} */
    this.entries = new Map();
  }

  has(baseId) { return this.entries.has(baseId); }
  cap(baseId) { return this.entries.get(baseId)?.cap ?? 0; }
  left(baseId) { return this.entries.get(baseId)?.left ?? 0; }

  /** Take up to n copies; returns the number taken (0 for a base id without stock). */
  take(baseId, n = 1) {
    const e = this.entries.get(baseId);
    if (!e || !(n > 0)) return 0;
    const k = Math.min(e.left, Math.floor(n));
    e.left -= k;
    return k;
  }

  /** Return n copies (clamped at the cap); returns the number returned. */
  give(baseId, n = 1) {
    const e = this.entries.get(baseId);
    if (!e || !(n > 0)) return 0;
    const k = Math.min(e.cap - e.left, Math.floor(n));
    e.left += k;
    return k;
  }

  /** { baseId: left } (tests / diagnostics). */
  snapshot() {
    const o = {};
    for (const [id, e] of this.entries) o[id] = e.left;
    return o;
  }
}

/**
 * The player's view of the match's GameData (see the header): `records` maps the ids of the slotted slots (normal and
 * elite) to their composed 自选 records; every other lookup is the match's own.
 * @param {import('../gamedata.js').GameData} gd
 * @param {Map<string, object>} records
 * @returns {import('../gamedata.js').GameData}
 */
export function diyGameData(gd, records) {
  const view = Object.create(gd);
  const backups = isObj(gd.raw && gd.raw.backups) ? gd.raw.backups : null;
  const diyTokens = backups && isObj(backups.tokens) ? backups.tokens : {};
  const tokenOf = (id) => (typeof id === 'string' && Object.hasOwn(diyTokens, id) && isObj(diyTokens[id]) ? diyTokens[id] : null);
  Object.defineProperties(view, {
    /** the match's own GameData (the view is per player) */
    matchData: { value: gd },
    chess: { value: (id) => (typeof id === 'string' && records.has(id) ? records.get(id) : gd.chess(id)) },
    token: { value: (id) => gd.token(id) || tokenOf(id) },
    /**
     * GameData.placeableTokens for a slotted slot: the summons its record lists (the pick's skill and talents) that are
     * placeable, by the variant of the owner form (`bySkill[skillIndex]` sources) — the deploy limit as the count (PRTS
     * 卫戍协议/帮助 "根据召唤物部署数量上限（非初始持有量）"), the active module's own when its variant has one (`byModule`:
     * 望's TRP-X "可同时部署的陷阱数量提升", 6 → 7 棋子; SUM-Y stage 2+ 4 drones / summons). The data's deploy limit holds the
     * token's own talent additions (tools/build-data.mjs tokenTalentDeckBonus, 0.2.0): 麦哲伦 / 令 / 电弧 3, 白铁 2, 夜莺 3 幻影 —
     * at the owner's potential (`loadout.potential`, PlayerState.loadoutFor; 0.2.2: 望's 棋子 6 below 潜能3, 7 from it).
     */
    placeableTokens: {
      value: (chessId, loadout = null) => {
        const rec = typeof chessId === 'string' && records.has(chessId) ? records.get(chessId) : null;
        if (!rec) return gd.placeableTokens(chessId, loadout);
        const owner = diyTokenOwner(rec.charId, rec.status);
        const out = [];
        for (const tid of Array.isArray(rec.tokens) ? rec.tokens : []) {
          const t = tokenOf(tid);
          if (!t || t.kind !== 'summon' || t.placeable !== true) continue;
          const v = isObj(t.variants) ? atPotential(t.variants[owner] ?? null, loadout?.potential) : null;
          if (v) {
            const alt = loadout && Number.isInteger(loadout.skillIndex) && v.bySkill ? v.bySkill[loadout.skillIndex] : null;
            const src = Array.isArray(alt?.sources) ? alt.sources : Array.isArray(v.sources) ? v.sources : [];
            if (!src.includes('talent') && !src.includes('skill')) continue;
          }
          const mid = rec.module && rec.module.active ? rec.module.id : null;
          const vm = v && mid && isObj(v.byModule) ? v.byModule[mid] ?? null : null;
          out.push({ tokenId: tid, count: Math.min(posIntOr(vm?.stats?.deployLimit, posIntOr(v?.stats?.deployLimit, posIntOr(t.deployLimit, 1))), 9) });
        }
        return out;
      },
    },
  });
  return view;
}

export class PlayerDiy {
  /**
   * Fix the 自选 picks for the match (see the header): the seat's picks re-checked against this match's data and kits;
   * a slot whose record cannot be composed is left empty. With picks, `this.gd` becomes the player's data view.
   * @param {any} picks `{ [slotBaseId]: { charId, skillIndex?, uniEquipId? } | null }`
   * @param {{ kitted?: Iterable<string> }} [opts] the operators with a kit (default: the registry's KITTED_CHARS; tests may
   *   widen it to slot an operator whose kit is still being written)
   * @returns {boolean} false when the picks are malformed (nothing changes) or the player is a bot
   */
  setDiy(picks, { kitted = KITTED_CHARS } = {}) {
    if (this.isBot) return false;
    const gd = this.m.gd;
    const data = gd.raw;
    const res = checkDiyPicks(picks, { data, kitted });
    if (!res || !('ok' in res)) {
      this.m.log?.warn?.(`[match ${this.m.roomCode}] 自选 picks of ${this.playerId} ignored: ${res && res.detail}`);
      return false;
    }
    const kept = {};
    const records = new Map();
    for (const [slotId, pick] of Object.entries(res.picks)) {
      const slot = diySlot(slotId, data);
      let normal;
      let golden;
      try {
        normal = diyRecord(slotId, pick, { elite: false, data });
        golden = diyRecord(slotId, pick, { elite: true, data });
      } catch { normal = null; golden = null; }
      if (!slot || !normal || !golden) continue;
      records.set(slot.baseId, Object.freeze(normal));
      records.set(slot.goldenId, Object.freeze(golden));
      kept[slot.baseId] = Object.freeze({ charId: pick.charId, skillIndex: pick.skillIndex, uniEquipId: pick.uniEquipId ?? null });
    }
    this.diy = Object.freeze(kept);
    this._diyRecords = records;
    this.gd = records.size ? diyGameData(gd, records) : gd;
    return true;
  }

  /**
   * The stock of each slotted DIY piece (see the header), once the match has drawn its bans: `off` = the bonds switched
   * off this match (drawn + the mode's static list). A piece all of whose bonds are off gets none (`diyBanned`).
   * @param {Set<string>} off
   */
  initDiyStock(off = new Set()) {
    const { stock, banned } = this.buildDiyStock(off);
    this.diyStock = stock;
    this.diyBanned = banned;
  }

  /** Prepare stock without mutating this player, so setup rerolls can commit all players together. */
  buildDiyStock(off = new Set()) {
    const stock = new DiyStock();
    const banned = [];
    const gd = this.m.gd;
    for (const slotId of Object.keys(this.diy || {})) {
      const rec = this._diyRecords.get(slotId);
      const slot = diySlot(slotId, gd.raw);
      if (!rec || !slot) continue;
      const bonds = Array.isArray(rec.bonds) ? rec.bonds : [];
      if (bonds.length > 0 && bonds.every((b) => off.has(b))) { banned.push(slotId); continue; }
      const cap = gd.poolCopies(slotId);
      if (!(cap > 0)) continue;
      stock.entries.set(slotId, { cap, left: cap, tier: gd.tierOf(slotId), shopLevel: slot.shopLevel });
    }
    return { stock, banned: Object.freeze(banned) };
  }

  /** The copy accounting of base chess `baseId` for this player: its own stock for a slotted DIY slot, else the shared pool. */
  poolOf(baseId) {
    return this.diyStock && this.diyStock.has(baseId) ? this.diyStock : this.m.pool;
  }

  /**
   * The stock entries this player's shop draws from now ([baseId, entry] with copies left and the 调度中心 at the slot's
   * shopLevel), or null (none — the shared pool's roll alone, exactly as without picks).
   * @returns {Array<[string, { cap: number, left: number, tier: number, shopLevel: number }]> | null}
   */
  diyRollEntries() {
    if (!this.diyStock || !this.diyStock.entries.size) return null;
    const out = [];
    for (const [id, e] of this.diyStock.entries) if (e.left > 0 && this.shop.level >= e.shopLevel) out.push([id, e]);
    return out.length ? out : null;
  }

  /**
   * The stock entries a random grant of this player draws besides the shared pool (see the header): every slotted piece
   * with copies left, whatever the 调度中心 level (the roll's own tier rules apply), or null (none).
   * @returns {Array<[string, { cap: number, left: number, tier: number, shopLevel: number }]> | null}
   */
  diyStockEntries() {
    if (!this.diyStock || !this.diyStock.entries.size) return null;
    const out = [...this.diyStock.entries].filter(([, e]) => e.left > 0);
    return out.length ? out : null;
  }

  /**
   * The 自选 pick a chess id (normal or elite) of this player fields — its slot's — or null (not a slotted slot).
   * @param {string} id
   * @returns {{ charId: string, skillIndex: number, uniEquipId: string|null } | null}
   */
  diyPickOf(id) {
    const rec = this._diyRecords && typeof id === 'string' ? this._diyRecords.get(id) : null;
    return rec ? this.diy[rec.diyFor] ?? null : null;
  }
}
