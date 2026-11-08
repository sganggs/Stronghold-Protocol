// Shared prep orchestration. Actions own policy and validated PlayerState mutations;
// this module owns their order and yield boundaries. No match state lives in the factory.

const REQUIRED = Object.freeze(['takeOffers', 'sellJunk', 'buyLoopSteps', 'levelUp', 'planSpendSteps', 'spendDown',
  'maybeFreeze', 'arrangeSteps', 'equipItems', 'applyPlanSteps', 'resolveTemp', 'hasHandRoom', 'freeHandSlot',
  'rememberOwned', 'ready']);

/** Construct synchronous prep hooks from explicit actions, preserving the legacy scheduler contract. */
export function createPrepSteps(actions, { maxRefreshes, arrangeBeforeLevel = false }) {
  if (!Number.isInteger(maxRefreshes) || maxRefreshes < 0) throw new TypeError('Invalid refresh limit');
  for (const key of REQUIRED) if (typeof actions?.[key] !== 'function') throw new TypeError(`Missing prep action: ${key}`);
  for (const key of Object.keys(actions)) if (!REQUIRED.includes(key)) throw new TypeError(`Unknown prep action: ${key}`);
  const ops = Object.freeze({ ...actions });
  return Object.freeze({
    *prepBegin(m, ps, { delegate = false, pooled = false } = {}) {
      if (!ps.alive || ps.ready) return null;
      m.autoPickPersonalChoice(ps, 'bot');
      ops.takeOffers(m, ps);
      yield;
      ops.sellJunk(m, ps);
      yield;
      yield* ops.buyLoopSteps(m, ps, { fillOnly: true, maxRefreshes: 0 });
      ops.takeOffers(m, ps);
      if (arrangeBeforeLevel) yield* ops.arrangeSteps(m, ps);
      ops.levelUp(m, ps);
      yield;
      yield* ops.buyLoopSteps(m, ps, { fillOnly: false, maxRefreshes });
      ops.takeOffers(m, ps);
      if (arrangeBeforeLevel) yield* ops.arrangeSteps(m, ps);
      ops.levelUp(m, ps, { spare: true });
      yield* ops.planSpendSteps(m, ps);
      ops.spendDown(m, ps);
      ops.maybeFreeze(m, ps);
      yield;
      yield* ops.arrangeSteps(m, ps);
      ops.equipItems(m, ps);
      yield;
      return yield* ops.arrangeSteps(m, ps, { final: true, defer: true, delegate, pooled });
    },
    *prepEnd(m, ps, job = null) {
      if (!ps.alive || ps.ready) return;
      if (job && job.done && job.best !== job.plans[0]) yield* ops.applyPlanSteps(m, ps, job.chosen, job.best);
      ops.resolveTemp(m, ps);
      if (!ops.hasHandRoom(ps)) ops.freeHandSlot(m, ps);
      // §37.71: nothing re-arranges after the rehearsed layout (the advisor pass of §35.13 here put the unrehearsed
      // default layout back whenever it bought a piece)
      ops.rememberOwned(ps);
      m.autoPickPersonalChoice(ps, 'bot');
      ops.ready(ps);
    },
  });
}
