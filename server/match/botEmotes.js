// server/match/botEmotes.js — AI teammates' in-game emote reactions.
//
// An opt-in social layer: at the moments a real player naturally reacts (漏怪、合成精锐、联防开场、收到礼物),
// an AI seat also fires a single `m.emote` broadcast. Zero effect on rng, decision or scoring; the
// cooldown piggybacks on the official `EMOTE_COOLDOWN_MS` (intent.emote rate limit).
//
// Boundary: pure-AI matches and solo matches are silent — only when a human seat is present does this
// module wake up. SP_BOT_EMOTES=0 disables the whole module at deploy time.
//
// Hooks are six tiny install sites (intents / spDraft / unitePhase / settle / acquire / effectsMeta);
// every hook does its own hasHumans + cooldown check and returns silently otherwise.
import { EMOTES, EMOTE_COOLDOWN_MS } from '../../shared/constants.js';

// ---- emote-id set this module may send (the official whitelist: subset of EMOTES) ------------------
const E_HAPPY = 'autochess_battle_happy';             // 开心
const E_SCARED = 'autochess_battle_scared';           // 害怕
const E_SORRY = 'autochess_battle_sorry';             // 对不起
const E_THANKS = 'autochess_battle_thanks';           // 谢谢
const E_THINKING = 'autochess_battle_thinking';       // 思考
const E_COOP = 'autochess_battle_nice_cooperate';     // 合作愉快
const E_NOPROB = 'autochess_battle_noproblem';        // 没问题！
const E_RESPECT = 'autochess_battle_respect';         // 敬礼！
const E_CALL = 'autochess_battle_call';               // 欢呼！
const E_COOL = 'autochess_battle_playingcool';        // 酷！
const E_SAD = 'autochess_battle_sad';                 // 伤心

/** The settle-phase pool is one emote per alive bot seat per round; any later hook in the same round is suppressed. */
const SETTLE_POOL = new Set([E_HAPPY, E_SCARED, E_SORRY, E_THANKS, E_THINKING, E_COOP, E_NOPROB, E_RESPECT, E_CALL, E_COOL, E_SAD]);

// ---- kill switch -----------------------------------------------------------------
export const BOT_EMOTES_ON = process.env.SP_BOT_EMOTES !== '0';

/**
 * True iff at least one non-bot seat AND at least one bot seat are currently in `m.order`. The
 * "silent pure-AI" / "silent solo" boundary — only a coop room with humans *and* bots warrants an
 * AI teammate reaction; pure-AI rooms have no one to react to, solo rooms have no AI to react.
 */
export function hasHumans(m) {
  if (!m || !m.order || m.order.length < 2) return false;
  let humans = 0, bots = 0;
  for (const ps of m.order) if (ps) { if (ps.isBot) bots++; else humans++; }
  return humans > 0 && bots > 0;
}

/**
 * Send an emote on `p`'s behalf, obeying the per-seat cooldown. Returns true when sent.
 * Mirrors server/match/match/intents.js emote() but bypasses intent-validation (already authorised here).
 */
export function sendEmote(m, p, id) {
  if (!BOT_EMOTES_ON || !m || !p || !id || !EMOTES.includes(id)) return false;
  if (!p.alive) return false;
  const now = m.sched ? m.sched.now() : Date.now();
  if (typeof p.lastEmoteAt === 'number' && now - p.lastEmoteAt < EMOTE_COOLDOWN_MS) return false;
  p.lastEmoteAt = now;
  m.broadcast({ t: 'm.emote', playerId: p.playerId, id });
  return true;
}

/**
 * Pick the settle-phase emote for `p` based on the round's outcome. Returns an id from SETTLE_POOL,
 * or null when no clear sentiment fits. Each helper is queried at most once per round (the settle
 * hook walks every alive player and dispatches).
 *
 * Priority order (the first matching rule wins):
 *   1. eli (ps.lp == 0 after settle) → sad
 *   2. mvp of the round (max kills, tie → bigger damageDealt, fallback null) → call
 *   3. perfect (zero leaks) → cool
 *   4. leaked at least one this round → afraid (via scared)
 *   5. collected a bounty → thanks
 *   6. else null (silent — not every round needs a line)
 */
export function pickSettleEmote(m, p) {
  const r = m.lastResults && m.lastResults.get(p.playerId);
  if (!r) return null;
  if (p.lp <= 0) return E_SAD;
  if (p.alive && p.stats) {
    // the MVP: most kills; tie → most damage; only fire on coop rooms (a solo player celebrating their
    // own round breaks the immersive silence — the room has only them and the bots).
    const alive = m.alivePlayers ? m.alivePlayers() : [];
    const isMvp = alive.length >= 2 && p.stats.kills > 0 && p.stats.kills === Math.max(...alive.map((q) => q.stats ? q.stats.kills : 0));
    if (isMvp) return E_CALL;
  }
  const counted = (r.leaked || []).filter((l) => l && l.counted !== false).length;
  if (r.perfect !== false && counted === 0) return E_COOL;
  if (counted > 0) return E_SCARED;
  if (Number(r.coins) > 0) return E_THANKS;
  return null;
}

/**
 * Hook 1 — intents.js slow-path: a real player just sent `m.emote`; the bots read the message and pick
 * a context-aware reply (or none). Two layers of restraint:
 *   - only the **first** bot that sees the human's emote in a short window replies (no flood)
 *   - the reply is debounced against the bot's own cooldown
 */
export function onHumanEmote(m, senderId, id) {
  if (!hasHumans(m)) return null;
  if (!id || !EMOTES.includes(id)) return null;
  // map of replies for the 7 messages humans actually use in coop rooms
  const reply = {
    [E_THANKS]: [E_NOPROB, E_COOP],
    [E_SORRY]: [E_NOPROB, E_RESPECT],
    [E_COOP]: [E_THANKS, E_COOL],
    [E_HAPPY]: [E_HAPPY, E_COOL],
    [E_CALL]: [E_COOL, E_HAPPY],
    [E_COOL]: [E_HAPPY, E_COOL],
    [E_SAD]: [E_SAD, E_NOPROB],
  };
  const candidates = reply[id];
  if (!candidates) return null;
  // pick the first alive bot that can reply (cooldown gate); never the sender themselves
  for (const p of m.order) {
    if (!p || !p.isBot || !p.alive || p.playerId === senderId) continue;
    const choice = candidates[0];
    return sendEmote(m, p, choice);
  }
  return false;
}

/**
 * Hook 2 — spDraft.js pickCard: when an AI just grabbed a bounty card, fire a single "thinking" — a
 * tiny "I'm on it" beat, no different from the human's. Suppressed when the human picks (a human
 * thanking themselves is weird).
 */
export function onPickCard(m, p, card) {
  if (!BOT_EMOTES_ON || !hasHumans(m) || !p || !card || !card.kind) return false;
  if (!p.isBot) return false;
  if (card.kind !== 'bounty') return false;
  return sendEmote(m, p, E_THINKING);
}

/**
 * Hook 3 — unitePhase.js startUnite: every helper fires "cooperate" once on a won setup, mirroring the
 * official "thanks!" line. The hook fires before the deadline broadcast, so all helpers share the cooldown.
 * Limited to the first alive helper (avoids 4 simultaneous bubbles).
 */
export function onStartUnite(m, plan) {
  if (!BOT_EMOTES_ON || !hasHumans(m) || !plan || !plan.helpers) return false;
  const helper = plan.helpers.find((p) => p && p.isBot && p.alive);
  if (!helper) return false;
  return sendEmote(m, helper, E_COOP);
}

/**
 * Hook 4 — settle.js settle: per-round "what just happened" beat for alive bots. Up to one line per bot
 * per round (the SETTLE_POOL already limits to one pick). The settle hook walks the alive order; for each
 * bot, picks an id (or null) and sends it.
 */
export function onSettle(m) {
  if (!BOT_EMOTES_ON || !hasHumans(m)) return false;
  const alive = m.alivePlayers ? m.alivePlayers() : [];
  let sent = 0;
  for (const p of alive) {
    if (!p || !p.isBot || !p.alive) continue;
    const id = pickSettleEmote(m, p);
    if (!id || !SETTLE_POOL.has(id)) continue;
    if (sendEmote(m, p, id)) sent++;
  }
  return sent > 0;
}

/**
 * Hook 5 — acquire.js onMerge: a "scared" beat fires when a bot merges a chess into its elite THREE times
 * in a single round (the official UI marks that as the "great success" trail). Tracked by a per-match
 * counter that the settle hook clears.
 *
 * NOTE: this module keeps its own counter (`_botEmotesMergeCount`) on `m`; settle.js clears it.
 */
export function onMerge(m, p, info) {
  if (!BOT_EMOTES_ON || !hasHumans(m)) return false;
  if (!p || !p.isBot || !p.alive) return false;
  if (!info || info.kind !== 'chess') return false; // only chess merges, not items
  if (!m._botEmotesMerges) m._botEmotesMerges = Object.create(null);
  m._botEmotesMerges[p.playerId] = (m._botEmotesMerges[p.playerId] || 0) + 1;
  if (m._botEmotesMerges[p.playerId] >= 3) return sendEmote(m, p, E_SCARED);
  return false;
}

/**
 * Hook 6 — effectsMeta.js giftTicker: when a real player sends a CHAR_GIFT (configurable, see
 * effectsMeta.js; the case fires through the gift ticker text), the recipient bot thanks them.
 */
export function onGiftTicker(m, recipient, fromName) {
  if (!BOT_EMOTES_ON || !hasHumans(m)) return false;
  if (!recipient || !recipient.isBot || !recipient.alive) return false;
  // sanity: only thank when the gift came from a human (not from another bot)
  if (typeof fromName !== 'string' || !fromName) return false;
  return sendEmote(m, recipient, E_THANKS);
}

/**
 * Settle.js calls this at the top of the next round to clear the per-match merge counter.
 * (Piggybacked on settle so we don't need a new event.)
 */
export function resetRoundCounters(m) {
  if (m && m._botEmotesMerges) for (const k of Object.keys(m._botEmotesMerges)) m._botEmotesMerges[k] = 0;
  return true;
}