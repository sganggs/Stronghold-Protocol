// [ASSUMED] Optional map-independent adaptive search. `adaptive` changes placement only (legacy picker and
// procurement); `ioleta-adaptive` pairs it with Russell procurement, composed exactly once.
import { defineBotStrategy } from './botStrategyContract.js';
import { IOLETA_BOT, createIoletaPrepSteps } from './botIoleta.js';
import { arrangeSteps, adaptiveCandidatePlansSteps, createBotPrepSteps } from './bot.js';

/** arrangeSteps with geometry candidates and the adaptive rehearsal budget (only when rehearsal is on). */
export const adaptiveArrangeSteps = (m, ps, opts = {}) => arrangeSteps(m, ps,
  { ...opts, candidatePlans: adaptiveCandidatePlansSteps, adaptive: m.botRehearsal > 1 });

export const ADAPTIVE_BOT = defineBotStrategy({
  id: 'adaptive',
  ...createBotPrepSteps({ arrangeSteps: adaptiveArrangeSteps }),
});

export const IOLETA_ADAPTIVE_BOT = defineBotStrategy({
  id: 'ioleta-adaptive', base: defineBotStrategy(IOLETA_BOT),
  ...createIoletaPrepSteps({ arrangeSteps: adaptiveArrangeSteps }),
});
