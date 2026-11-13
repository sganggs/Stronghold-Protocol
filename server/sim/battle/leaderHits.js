// server/sim/battle/leaderHits.js — Battle methods: damage actually removed from the current leader pool,
// per operator. Boss and hidden battles only. Not part of Battle.result() (goldens and result hashes stay put).
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

const ID_RE = /^[A-Za-z0-9_\-.:]+$/;
// shared/protocol.js isUid tops out at 2^31 inclusive. No `**` here: the sim forbids it.
const UID_MAX = 2147483648;

function okId(v) {
  return typeof v === 'string' && v.length >= 1 && v.length <= 64 && ID_RE.test(v);
}

/**
 * The operator a hit is ranked under. [ASSUMED] a token's damage counts for the operator that summoned it
 * (walk `ownerUnit` at most four steps). Devices, unowned hits and a token with no operator are not ranked;
 * the player's pool total still includes them, so the ranked shares can sum to less than that player's share.
 * @param {object|null|undefined} credit
 * @returns {{ pid: string, uid: number, chess: string, tier: number }|null}
 */
function rankedOp(credit) {
  let u = credit;
  for (let i = 0; i < 4 && u && u.kind === 'token' && u.ownerUnit; i++) u = u.ownerUnit;
  if (!u || u.kind !== 'op') return null;
  const uid = u.uid;
  if (!Number.isInteger(uid) || uid < 1 || uid > UID_MAX) return null;
  if (!okId(u.ownerId) || !okId(u.defId)) return null;
  let tier = u.def && Number.isInteger(u.def.tier) ? u.def.tier : 0;
  if (tier < 0) tier = 0;
  if (tier > 10) tier = 10;
  return { pid: u.ownerId, uid, chess: u.defId, tier };
}

export class BattleLeaderHits {
  /**
   * `dealt` is the HP the pool actually lost (applyHpDecrease). A CreditPool re-sim records only the newly
   * credited excess, because that is the drop in pool HP, not the hit the re-sim asked for.
   * @param {object|null|undefined} credit
   * @param {number} dealt
   */
  noteLeaderDamage(credit, dealt) {
    if (!(dealt > 0) || !Number.isFinite(dealt)) return;
    if (this.kind !== 'boss' && this.kind !== 'hidden') return;
    const op = rankedOp(credit);
    if (!op) return;
    if (!this._leaderHits) this._leaderHits = new Map();
    const key = `${op.pid}\0${op.uid}`;
    let row = this._leaderHits.get(key);
    if (!row) {
      row = { pid: op.pid, uid: op.uid, chess: op.chess, tier: op.tier, dmg: 0 };
      this._leaderHits.set(key, row);
    } else {
      row.chess = op.chess;
      row.tier = op.tier;
    }
    row.dmg += dealt;
  }

  /** A copy. Empty until a boss or hidden battle records a ranked hit. */
  leaderHits() {
    if (!this._leaderHits) return [];
    const out = [];
    for (const row of this._leaderHits.values()) {
      out.push({ pid: row.pid, uid: row.uid, chess: row.chess, tier: row.tier, dmg: row.dmg });
    }
    return out;
  }
}
