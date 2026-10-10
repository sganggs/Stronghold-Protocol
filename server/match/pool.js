// server/match/pool.js — the SHARED chess pool (copies per base chess, across all players), per-match bans,
// copy-weighted shop rolls (research 00-INDEX §3, §6; DESIGN §6.2) and the shared ITEM pool (GitHub #466).
//
// Model (chess):
//   * Every visible (non-hidden, non-DIY) base chess that is not banned this match has `cap` copies
//     (config.economy.poolCopies[tier], overrides e.g. 缪尔赛思 4). `left[baseId]` = copies not owned by anyone.
//   * Owning a piece takes copies: a normal piece holds 1, an elite holds 3 (merge of 3 normals). Shop displays
//     do NOT reserve copies; buying fails (SOLD_OUT) when left = 0.
//   * Pieces remember how many copies they hold (`piece.poolCopies`), so selling / elimination / temp wipes return
//     exactly what was taken — chess granted by effects while the pool is empty (or hidden/banned chess) hold 0.
//   * Invariant (tests): 0 ≤ left ≤ cap and left + Σ held copies == cap for every base chess.
//
// Rolls: each chess slot draws ONE copy uniformly from all remaining copies of eligible chess with tier ≤ shop level
// ("copy-weighted"; duplicates within a roll allowed). The item slot draws ONE copy uniformly from the remaining
// copies of the shared item pool (ItemPool below) with tier ≤ shop level. A roll may add entries outside the pool
// (`extra`, after its own): one player's 自选 stock (0.2.0, player/diy.js diyRollEntries) — weighted by its copies like
// any chess, drawn by that player's shop only.

/**
 * Per-match disabled bond set D and banned chess (research 01 A2): D = uniform sample of `core` core bonds and `addon`
 * add-on bonds among weight > 0 bonds that are active in the mode. A visible chess is banned iff every one of its
 * bonds is in D ∪ mode.inactiveBondIds.
 * @param {import('./gamedata.js').GameData} gd
 * @param {Function} rng seeded rng (createRng)
 * @returns {{ drawn: string[], staticOff: string[], banned: string[] }}
 */
export function drawDisabledBonds(gd, rng) {
  const { core: nCore, addon: nAddon } = gd.bans(gd.difficulty);
  const staticOff = [...gd.modeInactiveBonds].filter((b) => gd.bond(b)).sort();
  const eligible = gd.bondIds.filter((b) => {
    const bond = gd.bond(b);
    return bond && Number(bond.weight) > 0 && !gd.modeInactiveBonds.has(b);
  });
  const core = eligible.filter((b) => gd.bond(b).isCore);
  const addon = eligible.filter((b) => !gd.bond(b).isCore);
  const drawn = [...sample(core, nCore, rng), ...sample(addon, nAddon, rng)].sort();
  const off = new Set([...drawn, ...staticOff]);
  const banned = [];
  for (const id of gd.visibleChess) {
    const c = gd.chess(id);
    const bonds = Array.isArray(c.bonds) ? c.bonds : [];
    if (bonds.length > 0 && bonds.every((b) => off.has(b))) banned.push(id);
  }
  return { drawn, staticOff, banned };
}

function sample(arr, n, rng) {
  const a = arr.slice();
  rng.shuffle(a);
  return a.slice(0, Math.max(0, Math.min(n, a.length)));
}

export class SharedPool {
  /**
   * @param {import('./gamedata.js').GameData} gd
   * @param {{ banned?: Iterable<string> }} [opts]
   */
  constructor(gd, { banned = [] } = {}) {
    this.gd = gd;
    const ban = new Set(banned);
    /** @type {Map<string, { cap: number, left: number, tier: number }>} */
    this.entries = new Map();
    for (const id of gd.visibleChess) {
      if (ban.has(id)) continue;
      const cap = gd.poolCopies(id);
      if (cap <= 0) continue;
      this.entries.set(id, { cap, left: cap, tier: gd.tierOf(id) });
    }
    this.banned = [...ban].sort();
  }

  /** Whether a base chess is part of this match's pool (visible, not banned). */
  has(baseId) { return this.entries.has(baseId); }
  cap(baseId) { return this.entries.get(baseId)?.cap ?? 0; }
  left(baseId) { return this.entries.get(baseId)?.left ?? 0; }

  /** Take up to n copies; returns the number actually taken (0 when not in the pool / empty). */
  take(baseId, n = 1) {
    const e = this.entries.get(baseId);
    if (!e || !(n > 0)) return 0;
    const k = Math.min(e.left, Math.floor(n));
    e.left -= k;
    return k;
  }

  /** Return n copies (clamped at the cap). Returns the number actually returned. */
  give(baseId, n = 1) {
    const e = this.entries.get(baseId);
    if (!e || !(n > 0)) return 0;
    const k = Math.min(e.cap - e.left, Math.floor(n));
    e.left += k;
    return k;
  }

  /**
   * Remaining copies of eligible chess (tier ≤ maxTier, or exactly `tier`): the pool's entries, then `extra` ([id, entry]
   * pairs of the same shape — a player's 自选 stock) under the same filters.
   */
  _eligible({ maxTier = 6, tier = null, filter = null, extra = null } = {}) {
    const out = [];
    const scan = (list) => {
      for (const [id, e] of list) {
        if (e.left <= 0) continue;
        if (tier != null ? e.tier !== tier : e.tier > maxTier) continue;
        if (filter && !filter(id, e)) continue;
        out.push([id, e.left]);
      }
    };
    scan(this.entries);
    if (extra) scan(extra);
    return out;
  }

  /**
   * Copy-weighted roll: one copy uniformly among remaining copies of eligible chess. Returns a base id or null.
   * @param {Function} rng
   * @param {{ maxTier?: number, tier?: number|null, filter?: (id: string, e: object) => boolean,
   *   extra?: Iterable<[string, { left: number, tier: number }]>|null }} [opts]
   */
  roll(rng, opts = {}) {
    const el = this._eligible(opts);
    let total = 0;
    for (const [, n] of el) total += n;
    if (total <= 0) return null;
    let r = rng() * total;
    for (const [id, n] of el) { r -= n; if (r < 0) return id; }
    return el[el.length - 1][0];
  }

  /** Tier shares of a copy-weighted roll at shop level `maxTier` (current remaining copies). */
  tierShares(maxTier) {
    const t = {};
    let total = 0;
    for (const [, e] of this.entries) {
      if (e.tier > maxTier || e.left <= 0) continue;
      t[e.tier] = (t[e.tier] || 0) + e.left;
      total += e.left;
    }
    const out = {};
    for (const k of Object.keys(t)) out[k] = total > 0 ? t[k] / total : 0;
    return out;
  }

  /** { baseId: left } snapshot (tests / diagnostics). */
  snapshot() {
    const o = {};
    for (const [id, e] of this.entries) o[id] = e.left;
    return o;
  }

  totalLeft() {
    let n = 0;
    for (const e of this.entries.values()) n += e.left;
    return n;
  }
}

/**
 * The shared ITEM pool (GitHub #466): every shop-eligible item (gd.shopItemsByTier) holds its
 * config.economy.itemPoolCopies copies (per-item itemPoolCopiesOverrides; 路标月报#2, bilibili BV1eLXXBqEgF —
 * Ⅰ 4, Ⅱ 6 with 简易通讯机 5, Ⅲ 7, Ⅳ 8 with 蜂鸣器/防暴盾/浓缩嗅盐 6 and 寻呼模块/伪装服/拉特兰桥夹 7,
 * Ⅴ 7 with 商业包装方案 2, Ⅵ 3; the same table in a 同盟模拟 match — the official item table, unlike the
 * operator one, names no 同盟/独立 split). Keys are the normal items' ids: a golden item holds 2 copies (the two
 * normals it merged from, 整备's in-place golden included — it takes its second on the upgrade).
 * Model (mirrors SharedPool): owning an item takes copies (acquireItem — every path counts: the shop buy, a 机变
 * card, a reward pick, a grant; the items the 特质 produce outright — SERVER_GAIN_EQUIP, 诗怀雅 / 卡涅利安 / 耶拉 /
 * 缪尔赛思 — are granted `fromPool: false` and hold 0), losing one gives back (destroyed, replaced, temp-resolved,
 * eliminated — PlayerPieces.returnCopies). Shop displays do NOT reserve copies: buying a sold-out item fails
 * (SOLD_OUT) and sold-out items are never drawn. A config without the key pools nothing (entries stay empty — the
 * pre-#466 behavior). Invariant (tests): 0 ≤ left ≤ cap and left + Σ held copies == cap for every item.
 * Draws are copy-weighted: one copy uniformly among the remaining copies of the items with tier ≤ the shop level
 * (`roll`) — the shop item slot, the 道具补给 cards and the generic random-item grants (Match.rollItemId) draw
 * through it; pools with their own `items` / `weighted` lists keep those weights but drop sold-out items.
 */
export class ItemPool {
  /**
   * @param {import('./gamedata.js').GameData} gd
   */
  constructor(gd) {
    this.gd = gd;
    /** @type {Map<string, { cap: number, left: number, tier: number }>} */
    this.entries = new Map();
    for (const [tier, ids] of Object.entries(gd.shopItemsByTier)) {
      for (const id of ids) {
        const cap = gd.itemPoolCopies(id);
        if (cap <= 0) continue;
        this.entries.set(id, { cap, left: cap, tier: Number(tier) });
      }
    }
  }

  /** Whether a (normal) item is part of this match's item pool. */
  has(itemId) { return this.entries.has(itemId); }
  cap(itemId) { return this.entries.get(itemId)?.cap ?? 0; }
  left(itemId) { return this.entries.get(itemId)?.left ?? 0; }

  /** Take up to n copies; returns the number actually taken (0 when not in the pool / empty). */
  take(itemId, n = 1) {
    const e = this.entries.get(itemId);
    if (!e || !(n > 0)) return 0;
    const k = Math.min(e.left, Math.floor(n));
    e.left -= k;
    return k;
  }

  /** Return n copies (clamped at the cap). Returns the number actually returned. */
  give(itemId, n = 1) {
    const e = this.entries.get(itemId);
    if (!e || !(n > 0)) return 0;
    const k = Math.min(e.cap - e.left, Math.floor(n));
    e.left += k;
    return k;
  }

  /**
   * Remaining copies of eligible items (one of `tiers`, exactly `tier`, or tier ≤ maxTier).
   */
  _eligible({ maxTier = 6, tier = null, tiers = null, filter = null } = {}) {
    const out = [];
    for (const [id, e] of this.entries) {
      if (e.left <= 0) continue;
      if (tiers ? !tiers.includes(e.tier) : tier != null ? e.tier !== tier : e.tier > maxTier) continue;
      if (filter && !filter(id, e)) continue;
      out.push([id, e.left]);
    }
    return out;
  }

  /**
   * Copy-weighted roll: one copy uniformly among remaining copies of eligible items. Returns an item id or null.
   * @param {Function} rng
   * @param {{ maxTier?: number, tier?: number|null, tiers?: number[]|null, filter?: (id: string, e: object) => boolean }} [opts]
   */
  roll(rng, opts = {}) {
    const el = this._eligible(opts);
    let total = 0;
    for (const [, n] of el) total += n;
    if (total <= 0) return null;
    let r = rng() * total;
    for (const [id, n] of el) { r -= n; if (r < 0) return id; }
    return el[el.length - 1][0];
  }

  /** Remaining copies of one tier (tests / the 道具补给's tier range). */
  tierLeft(tier) {
    let n = 0;
    for (const e of this.entries.values()) if (e.tier === tier) n += e.left;
    return n;
  }

  /** { itemId: left } snapshot (tests / diagnostics). */
  snapshot() {
    const o = {};
    for (const [id, e] of this.entries) o[id] = e.left;
    return o;
  }

  totalLeft() {
    let n = 0;
    for (const e of this.entries.values()) n += e.left;
    return n;
  }
}
