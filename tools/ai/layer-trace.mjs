// Optional botbench diagnostics (history §37.24). Wrap only this match's instances;
// never mutate gameplay state, handlers, prototypes or RNG. Not a policy input.
// Gains are recorded at onLayers: actual clamped bank additions, including combat
// settlement, never hypothetical rehearsal gains. Nested sources retain both a
// triggering band/item and the acquired operator's own trait.
// Keep raw IDs and operations so later analyses can regroup without rerunning.
export function traceLayers(m, rec) {
  const trace = rec.layerTrace = { gains: [], spending: [], sales: [], snapshots: [], cards: [] };
  const stack = [];
  const merged = new Set();
  const action = [];
  let serial = 0;
  const wrap = (obj, name, fn) => { const base = obj[name]; obj[name] = function (...args) { return fn.call(this, base.bind(this), ...args); }; };
  const describe = (key, hook, source, ev) => ({ key, hook, kind: source?.kind, id: source?.piece?.id,
    uid: source?.piece?.uid, garrison: source?.garrisonId, event: source?.garrison?.eventType,
    acquiredFrom: ev?.source, elite: !!(source?.piece && m.gd.isGolden(source.piece.id)) });
  wrap(m.dispatcher, '_call', (base, ps, key, handler, hook, source, ev, repeat) => {
    stack.push(describe(key, hook, source, ev));
    try { return base(ps, key, handler, hook, source, ev, repeat); } finally { stack.pop(); }
  });
  wrap(m.dispatcher, 'runKey', (base, ps, key, hook, source, ev) => {
    stack.push(describe(key, hook, source, ev));
    try { return base(ps, key, hook, source, ev); } finally { stack.pop(); }
  });
  wrap(m, 'dispatch', (base, ps, hook, ev, opts) => {
    if (hook === 'onMerge' && ev?.kind === 'chess' && !ev.preview) merged.add(`${ps.playerId}:${ev.piece.uid}`);
    if (hook === 'onLayers' && !ev?.preview) trace.gains.push({ round: m.round, pid: ps.playerId,
      bond: ev.bondId, add: ev.to - ev.from, from: ev.from, to: ev.to, reason: ev.reason,
      sources: stack.map(s => ({ ...s, merged: merged.has(`${ps.playerId}:${s.uid}`) })), action: action.at(-1) ?? null });
    return base(ps, hook, ev, opts);
  });
  const snapshot = (ps, phase) => trace.snapshots.push({ round: m.round, pid: ps.playerId, phase, alive: ps.alive,
    lp: ps.lp, funds: ps.funds, pendingFunds: ps.pendingFunds, level: ps.shop.level, focus: ps._botFocusId ?? null,
    band: ps.bandId, layers: { ...ps.layers }, bonds: structuredClone(ps.bonds),
    board: [...ps.board].map(([tile, p]) => ({ tile, id: p.id, uid: p.uid, items: (p.items || []).map(i => i.id) })),
    hand: ps.hand.filter(Boolean).map(p => ({ id: p.id, uid: p.uid, kind: p.kind })) });
  for (const ps of m.players.values()) {
    wrap(ps, 'spend', (base, amount) => {
      const before = ps.stats.gold;
      const result = base(amount);
      const spent = ps.stats.gold - before;
      if (action.length) action.at(-1).spent += spent;
      else if (spent) trace.spending.push({ seq: serial++, round: m.round, pid: ps.playerId, name: 'effect', spent });
      return result;
    });
    for (const name of ['buy', 'refresh', 'levelUp', 'takeOffer', 'equip', 'useArt']) {
      if (typeof ps[name] !== 'function') continue;
      wrap(ps, name, (base, ...args) => {
        const slot = name === 'buy' ? ps.shop.slots[args[0]] : null;
        // Diagnostic call-site label only: distinguishes §35.63 purchases from ordinary procurement.
        const trade = name === 'buy' && /\bat tradeOnce\b/.test(new Error().stack);
        const a = { seq: serial++, round: m.round, pid: ps.playerId, name, trade, id: slot?.id, kind: slot?.kind, spent: 0 };
        action.push(a);
        try { return base(...args); } finally {
          action.pop();
          trace.spending.push({ ...a, funds: ps.funds });
        }
      });
    }
    wrap(ps, 'sell', (base, uid) => {
      const p = ps.find(uid)?.piece;
      const before = ps.funds;
      const result = base(uid);
      trace.sales.push({ round: m.round, pid: ps.playerId, uid, id: p?.id, refund: ps.funds - before });
      return result;
    });
    wrap(ps, 'endPrep', (base) => { snapshot(ps, 'beforeEndPrep'); const out = base(); snapshot(ps, 'afterEndPrep'); return out; });
  }
  wrap(m, '_applyCard', (base, ps, idx) => { trace.cards.push({ round: m.round, pid: ps.playerId, card: structuredClone(m.sp?.cards[idx]) }); return base(ps, idx); });
  return () => { for (const ps of m.order) snapshot(ps, m.phase); };
}
