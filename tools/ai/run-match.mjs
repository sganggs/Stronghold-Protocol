// [ASSUMED] Benchmark virtual time pauses for bounded real IO. Live matches keep their normal phase clock.
export async function runMatch(m, done, { maxSteps = 5e6 } = {}) {
  try {
    for (let step = 0; step < maxSteps; step++) {
      if (m.externalAI?.inflight.size) {
        await m.externalAI.waitForIdle();
        // Direct replies may enqueue the next observation before the previous promise finishes.
        if (m.externalAI.inflight.size) continue;
      }
      if (done()) return true;
      if (!m.sched.runNext()) return false;
    }
    return done();
  } catch (error) {
    m.dispose();
    throw error;
  }
}

export function strategyMetrics(m, summary) {
  return (summary?.players || []).map(p => ({
    seat: p.seat, strategy: m.externalAI && (!m.externalAI.config.seats || m.externalAI.config.seats.includes(p.seat))
      ? `external:${m.externalAI.config.mode}` : m.bot.id === 'external' ? 'legacy' : m.bot.id,
    survivalRound: p.eliminatedRound ?? m.round, roundsPassed: p.roundsPassed, finalLP: p.lp,
    damageDealt: p.stats.dmgDealt, leaderDamage: p.stats.bossDamage, wins: Number(p.victory),
    external: m.externalAI?.metrics.bySeat[p.seat] || null,
  }));
}

export function aggregateStrategies(records) {
  const groups = new Map();
  for (const r of records) for (const p of r.strategyMetrics || []) {
    const key = `${r.config || r.difficulty}:${p.strategy}`;
    const s = groups.get(key) || { key, seats: 0, survivalRound: 0, finalLP: 0, damageDealt: 0, leaderDamage: 0, wins: 0,
      calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, usageReports: 0, latencyMs: 0, fallbacks: 0 };
    s.seats++;
    for (const k of ['survivalRound', 'finalLP', 'damageDealt', 'leaderDamage', 'wins']) s[k] += p[k];
    for (const k of ['calls', 'inputTokens', 'outputTokens', 'cachedTokens', 'usageReports', 'latencyMs', 'fallbacks']) s[k] += p.external?.[k] || 0;
    groups.set(key, s);
  }
  return [...groups.values()].map(s => ({ ...s, survivalRound: s.survivalRound / s.seats, finalLP: s.finalLP / s.seats,
    damageDealt: s.damageDealt / s.seats, leaderDamage: s.leaderDamage / s.seats,
    meanLatencyMs: s.calls ? s.latencyMs / s.calls : 0 }));
}
