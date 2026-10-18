// server/match/pool.js — the SHARED chess pool (copies per base chess, across all players), per-match bans,
// copy-weighted shop rolls (research 00-INDEX §3, §6; DESIGN §6.2).
//
// Model:
//   * Every visible (non-hidden, non-DIY) base chess that is not banned this match has `cap` copies
//     (config.economy.poolCopies[tier], measured identity overrides; co-op shared stock doubled). `left` is the
//     signed capacity minus occupation; the public left() and shop sampling clamp a deficit to zero.
//   * Owning a piece takes copies: a normal piece holds 1, an elite holds 3 (merge of 3 normals). Shop displays
//     do NOT reserve copies. An operator or equipment card already shown in the shop, or a reward already shown, can
//     still be taken and overdraws (chess: a negative raw left; equipment: SharedItemPool's debt — GitHub #498, and
//     the maintainer's decision of 2026-10-14 for equipment, #624). A slot that is already sold still fails SOLD_OUT.
//     Future rolls exclude empty stock. 整备 and grants that are not an already-shown card stay stock-limited.
//   * Pieces remember how many copies they hold (`piece.poolCopies`), so selling / elimination / temp wipes return
//     exactly what was taken — chess granted by effects while the pool is empty (or hidden/banned chess) hold 0.
//   * Invariant: raw left ≤ cap and raw left + Σ held copies == cap. Mimic can exceed stock, but its copies still occupy it.
//
// Rolls: each chess slot draws ONE copy uniformly from all remaining copies of eligible chess with tier ≤ shop level
// ("copy-weighted"; duplicates within a roll allowed). The item slot picks a tier with the same tier shares, then a
// uniform shop-eligible item of that tier (falling back to lower tiers). A roll may add entries outside the pool
// (`extra`, after its own): one player's 自选 stock — the ordinary shop passes diyRollEntries (the shopLevel gate);
// the promotion reward and random grants pass diyStockEntries (the roll's own tier, DESIGN §30.23). Weighted by its
// copies like any chess, drawn by that player only.

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
  left(baseId) { return Math.max(0, this.entries.get(baseId)?.left ?? 0); }

  /** Take up to n copies; returns the number actually taken (0 when not in the pool / empty). */
  take(baseId, n = 1, { overdraw = false } = {}) {
    const e = this.entries.get(baseId);
    if (!e || !(n > 0)) return 0;
    const k = overdraw ? Math.floor(n) : Math.min(Math.max(0, e.left), Math.floor(n));
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
  _eligible({ maxTier = 6, tier = null, filter = null, extra = null, ignoreCounts = false } = {}) {
    const out = [];
    const scan = (list) => {
      for (const [id, e] of list) {
        if (!ignoreCounts && e.left <= 0) continue;
        if (tier != null ? e.tier !== tier : e.tier > maxTier) continue;
        if (filter && !filter(id, e)) continue;
        out.push([id, ignoreCounts ? 1 : e.left]);
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

  /**
   * Item roll for the shop's item slot: tier by the chess tier shares at this level, uniform item within the tier,
   * falling back to lower tiers when a tier has no item. Returns an item id or null.
   * `bias` (shopBias bondBias): a Set of active bond ids. A tier is drawn from items whose giveBondId is in that set
   * when any remain after the stock gate; an empty filtered tier falls back to the official list of that tier.
   * null or an empty Set keeps today's rng (one draw for the tier, one for the pick). Bias never grants an item.
   */
  rollItem(rng, maxTier, stock = null, bias = null) {
    const shares = this.tierShares(maxTier);
    const tiers = Object.keys(shares).map(Number).sort((a, b) => a - b);
    let tier = null;
    if (tiers.length) {
      let r = rng();
      for (const t of tiers) { r -= shares[t]; if (r < 0) { tier = t; break; } }
      if (tier == null) tier = tiers[tiers.length - 1];
    } else {
      tier = 1 + Math.floor(rng() * Math.max(1, maxTier));
    }
    const useBias = bias instanceof Set && bias.size > 0;
    const gated = (t) => (this.gd.shopItemsByTier[t] || []).filter((id) => !stock || stock.canGain(id));
    const pick = (list) => (stock ? stock.pick(rng, list) : list[Math.floor(rng() * list.length)]);
    const choose = (t) => {
      const list = gated(t);
      if (!list.length) return null;
      if (!useBias) return pick(list);
      const biased = list.filter((id) => {
        const rec = this.gd.item(id);
        return !!(rec && typeof rec.giveBondId === 'string' && bias.has(rec.giveBondId));
      });
      return pick(biased.length ? biased : list);
    };
    for (let t = tier; t >= 1; t--) {
      const id = choose(t);
      if (id) return id;
    }
    for (let t = tier + 1; t <= 6; t++) {
      const id = choose(t);
      if (id) return id;
    }
    return null;
  }

  /** { baseId: left } snapshot (tests / diagnostics). */
  snapshot() {
    const o = {};
    for (const [id, e] of this.entries) o[id] = Math.max(0, e.left);
    return o;
  }

  totalLeft() {
    let n = 0;
    for (const e of this.entries.values()) n += Math.max(0, e.left);
    return n;
  }
}

/** Shared equipment stock, derived from actual ownership. Merges, equips and returns cannot lose a reservation:
 * normal equipment occupies one, upgraded equipment two. Shop and reward displays reserve nothing. An already
 * displayed shop card or item reward may be taken after `left` hits 0; `owe` records those copies and `repay`
 * clears them first when a copy actually leaves the match (destroy, consume, elimination, a temp wipe). Rolls and
 * `canGain` keep using the clamped `left`, so an empty item does not appear again until the debt is repaid and a
 * copy is free. 整备 and ordinary grants stay limited. Fixed gift families may exceed the cap without a debt entry.
 * Source: the original experiment BV1eLXXBqEgF, 1:30 and 2:30, extended to equipment by the maintainer on
 * 2026-10-14 (#624). [ASSUMED] An item that is consumed, destroyed or removed by elimination no longer occupies
 * stock, consistently with the video's ownership model; this is not a per-match purchase limit. */
export class SharedItemPool {
  constructor(gd, players) {
    this.gd = gd;
    this.players = players;
    /** @type {Map<string, number>} base id → copies taken past the cap by an already-displayed card */
    this.debt = new Map();
  }
  cap(id) { return this.gd.itemPoolCopies(id); }
  need(id) { return this.gd.isGolden(id) ? 2 : 1; }
  held(id) {
    const base = this.gd.baseIdOf(id);
    let count = 0;
    const see = p => {
      if (!p) return;
      if (p.kind === 'item' && this.gd.baseIdOf(p.id) === base) count += this.need(p.id);
      for (const item of p.items || []) if (this.gd.baseIdOf(item.id) === base) count += this.need(item.id);
    };
    for (const ps of this.players()) {
      for (const p of ps.hand) see(p);
      for (const p of ps.temp) see(p);
      for (const p of ps.board.values()) see(p);
    }
    return count;
  }
  /** Signed cap − held. Infinity when the item has no shop cap. */
  rawLeft(id) { const cap = this.cap(id); return cap == null ? Infinity : cap - this.held(id); }
  left(id) { const raw = this.rawLeft(id); return raw === Infinity ? Infinity : Math.max(0, raw); }
  canGain(id) { return this.left(id) >= this.need(id); }
  debtOf(id) { return this.debt.get(this.gd.baseIdOf(id)) || 0; }
  /** Record `copies` of debt on the base item. Uncapped items and non-positive counts record nothing. */
  owe(id, copies) {
    const n = Math.floor(Number(copies));
    const base = this.gd.baseIdOf(id);
    if (!(n > 0) || this.cap(base) == null) return 0;
    this.debt.set(base, (this.debt.get(base) || 0) + n);
    return n;
  }
  /** Repay up to `copies` of debt. Returns how many were repaid (0 when nothing is owed). */
  repay(id, copies) {
    const n = Math.floor(Number(copies));
    const base = this.gd.baseIdOf(id);
    const cur = this.debt.get(base) || 0;
    if (!(n > 0) || cur <= 0) return 0;
    const k = Math.min(cur, n);
    if (cur === k) this.debt.delete(base);
    else this.debt.set(base, cur - k);
    return k;
  }
  /** Stock gates eligibility, not probability: retain the existing uniform item draw or explicit data weights.
   * The measured stock table alone does not establish shop probabilities. */
  pick(rng, ids, weights = null) {
    const list = [...new Set(ids)].filter(id => this.canGain(id));
    const pairs = list.map(id => [id, weights ? Math.max(0, Number(weights.get(id)) || 0) : 1]);
    const total = pairs.reduce((n, p) => n + Math.max(0, p[1]), 0);
    if (!(total > 0)) return null;
    let r = rng() * total;
    for (const [id, weight] of pairs) if ((r -= Math.max(0, weight)) < 0) return id;
    return pairs.at(-1)?.[0] || null;
  }
}
