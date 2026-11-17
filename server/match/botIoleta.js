// Registered procurement only; placement remains independently selectable.
import { botPickBand, botPrepBeginSteps, botPrepEndSteps, createBotPrepSteps } from './bot.js';
import { ioletaBuyBonus, ioletaCore, ioletaCanLevel, ioletaTarget, ioletaSearchTargets,
  refreshIoletaPlan } from './botIoletaPolicy.js';

export const IOLETA_POLICY = Object.freeze({
  buyBonus: ioletaBuyBonus, core: ioletaCore, canLevel: ioletaCanLevel,
  target: ioletaTarget, searchTargets: ioletaSearchTargets,
});

/** Explicit actions allow pairing the same procurement with contact placement in local comparisons. */
export function createIoletaPrepSteps(actions = {}) {
  const prep = createBotPrepSteps(actions, IOLETA_POLICY);
  const fallback = Object.keys(actions).length ? createBotPrepSteps(actions) : {
    prepBegin: botPrepBeginSteps, prepEnd: botPrepEndSteps,
  };
  return Object.freeze({
    *prepBegin(m, ps, opts) {
      if (ps.bandId !== 'band_ioleta') return yield* fallback.prepBegin(m, ps, opts);
      if (!ps.alive || ps.ready) return null;
      refreshIoletaPlan(m, ps);
      return yield* prep.prepBegin(m, ps, opts);
    },
    *prepEnd(m, ps, job) {
      return yield* (ps.bandId === 'band_ioleta' ? prep : fallback).prepEnd(m, ps, job);
    },
  });
}

const prep = createIoletaPrepSteps();
export const IOLETA_BOT = Object.freeze({
  id: 'ioleta',
  pickBand(m, ps) {
    // [ASSUMED] Prefer Russell when offered and free; all other choices use the legacy picker.
    const id = 'band_ioleta';
    if (m.gd.bandIds().includes(id) && !m.bandTaken(id, ps.playerId)
      && !m.gd.bandBondIds(id).some(b => m.gd.modeInactiveBonds.has(b))) return id;
    return botPickBand(m, ps);
  },
  ...prep,
});
