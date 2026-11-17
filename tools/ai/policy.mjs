// [ASSUMED] Deliberately small example policy, not an official AI: first available draft/offer, then Ready.
// One action per response allows inspection of its result before the next action. No hidden data or game imports.
export function decide(o) {
  if (o.type === 'hello') return { v: o.v, id: o.id, type: 'hello', knowledgeVersion: o.knowledge.version };
  if (o.context.mode === 'plan') {
    const choice = o.context.kind !== 'prep' ? o.digest.actions.find(a => ['g.band', 'g.choice', 'g.offer'].includes(a.intent.t))?.id : undefined;
    // §35.14: add concrete item IDs to buy; freezeSearch opts into searching on the last refresh fund.
    // A reasoned { level, holdLevel: true, why } holds only this prep, including a one-round delay.
    return { v: o.v, id: o.id, plan: { ...(choice ? { choice } : {}),
      economy: { maxRefreshes: 8, freezeSearch: false }, items: { buy: [] } } };
  }
  const p = o.private, pub = o.public;
  let intent;
  if (o.context.kind === 'band') {
    // Public static catalogue: data/bands.json, these four bands support every official mode.
    const id = ['band_bldsk', 'band_amiya', 'band_duyaoy', 'band_sarkazb'].find(b => !pub.players.some(p => p.bandId === b));
    if (id) intent = { t: 'g.band', bandId: id };
  } else if (o.context.kind === 'card') {
    const card = pub.sp?.cards?.find(c => !c.soldOut && pub.sp.taken[c.idx] == null);
    if (card) intent = { t: 'g.choice', idx: card.idx };
  } else if (o.context.kind === 'offer') {
    for (const w of pub.offers || []) {
      const seat = w.seats.find(s => s.playerId === p.playerId && !s.picked);
      const card = seat?.slots.find(c => c.available);
      if (card) { intent = { t: 'g.offer', offerId: w.id, pluginId: w.pluginId, seq: w.seq, idx: card.idx, cardId: card.id }; break; }
    }
  } else if (p.personalChoice) intent = { t: 'g.choice', idx: 0, choiceId: p.personalChoice.id };
  else if (p.canReady) intent = { t: 'g.ready', ready: true };
  return { v: o.v, id: o.id, intents: intent ? [intent] : [], done: !intent || intent.t === 'g.ready' };
}
