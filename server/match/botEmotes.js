// AI teammate reactions, adapted from PR #444 by @DDDarkstar.
// [ASSUMED] Reaction choices are social heuristics, not official gameplay rules.
// Only mixed human/AI matches; no RNG, decisions, timer scheduling or battle changes.
// Enabled by default; SP_BOT_EMOTES=0 disables every entry point.
import { EMOTES, EMOTE_COOLDOWN_MS } from '../../shared/constants.js';
export const BOT_EMOTES_ON = process.env.SP_BOT_EMOTES !== '0';
const E = (name) => `autochess_battle_${name}`;
export function hasHumans(m) {
  return !!m?.order?.some((p) => p && !p.isBot) && !!m?.order?.some((p) => p?.isBot);
}
export function sendEmote(m, p, id) {
  if (!BOT_EMOTES_ON || !hasHumans(m) || !p?.isBot || !p.alive || !EMOTES.includes(id)) return false;
  const now = m.sched.now();
  if (typeof p.lastEmoteAt === 'number' && now - p.lastEmoteAt < EMOTE_COOLDOWN_MS) return false;
  p.lastEmoteAt = now;
  m.broadcast({ t: 'm.emote', playerId: p.playerId, id });
  return true;
}
export function onHumanEmote(m, senderId, id) {
  if (!BOT_EMOTES_ON || !hasHumans(m) || !m.order.some((p) => p.playerId === senderId && !p.isBot)) return false;
  const replies = { [E('thanks')]: E('noproblem'), [E('sorry')]: E('noproblem'),
    [E('nice_cooperate')]: E('thanks'), [E('happy')]: E('happy'), [E('call')]: E('playingcool'),
    [E('playingcool')]: E('happy'), [E('sad')]: E('sad') };
  const reply = replies[id];
  if (!reply) return false;
  return m.order.some((p) => p.isBot && sendEmote(m, p, reply)); // at most one reply, skipping cooling bots
}
export function onPickCard(m, p, card) {
  return card?.kind === 'bounty' && sendEmote(m, p, E('thinking'));
}
export function onStartUnite(m, plan) {
  return !!plan?.helpers?.some((p) => p.isBot && sendEmote(m, p, E('nice_cooperate')));
}
export function pickSettleEmote(m, p) {
  const r = m.lastResults.get(p.playerId);
  if (!r) return null;
  const ranked = m.alivePlayers().filter((q) => m.lastResults.has(q.playerId)).sort((a, b) => {
    const ar = m.lastResults.get(a.playerId), br = m.lastResults.get(b.playerId);
    return (br.killed || 0) - (ar.killed || 0) || (br.damageDealt || 0) - (ar.damageDealt || 0);
  });
  if (ranked.length > 1 && ranked[0] === p && r.killed > 0) return E('call');
  const leaks = (r.leaked || []).filter((l) => l && l.counted !== false).length;
  if (leaks > 0) return E('scared');
  if (r.perfect !== false) return E('playingcool');
  if (r.coins > 0) return E('thanks');
  return null;
}
export function onSettle(m) {
  if (!BOT_EMOTES_ON || !hasHumans(m) || m._botEmotesSettledRound === m.round) return false;
  m._botEmotesSettledRound = m.round;
  let sent = false;
  for (const p of m.alivePlayers()) if (p.isBot) {
    if (sendEmote(m, p, pickSettleEmote(m, p))) sent = true;
  }
  return sent;
}
export function onMerge(m, p, info) {
  if (!BOT_EMOTES_ON || !hasHumans(m) || !p?.isBot || !p.alive || info?.kind !== 'chess') return false;
  const counts = m._botEmotesMerges ??= new Map();
  const n = (counts.get(p.playerId) || 0) + 1;
  counts.set(p.playerId, n);
  return n === 3 && sendEmote(m, p, E('scared'));
}
export function onGiftTicker(m, recipient, fromPlayerId) {
  // Display names are not unique identities; use the trusted source player id.
  return !!m.order.some((p) => p.playerId === fromPlayerId && !p.isBot && p !== recipient)
    && sendEmote(m, recipient, E('thanks'));
}
export function resetRoundCounters(m) { m._botEmotesMerges?.clear(); }
