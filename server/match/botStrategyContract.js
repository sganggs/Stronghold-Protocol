// Trusted, server-side AI implementations. No policy changes or extra RNG draws in the default adapter.
import * as legacy from './bot.js';

export const LEGACY_BOT = Object.freeze({
  id: 'legacy',
  pickBand: legacy.botPickBand,
  pickCard: legacy.botPickCard,
  prepBegin: legacy.botPrepBeginSteps,
  prepEnd: legacy.botPrepEndSteps,
  bountyKillChance: legacy.bountyKillChance,
});

/** @typedef {{ id: string, pickBand: typeof legacy.botPickBand, pickCard: typeof legacy.botPickCard,
 * prepBegin: typeof legacy.botPrepBeginSteps, prepEnd: typeof legacy.botPrepEndSteps,
 * bountyKillChance: typeof legacy.bountyKillChance }} BotStrategy */
/** @typedef {Partial<Omit<BotStrategy, 'id'>> & { id: string, base?: BotStrategy }} BotStrategyDefinition */

const HOOKS = Object.freeze(['pickBand', 'pickCard', 'prepBegin', 'prepEnd', 'bountyKillChance']);
const validId = (id) => typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id);

/** Inherit unchanged hooks instead of copying bot.js; validate configuration before a match starts. */
/** @param {BotStrategyDefinition} definition @returns {Readonly<BotStrategy>} */
export function defineBotStrategy(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new TypeError('Bot strategy: object required');
  const { id, base = LEGACY_BOT } = definition;
  if (!validId(id)) throw new TypeError('Bot strategy: id must be a lowercase identifier (letters, digits, hyphens)');
  if (!base || !validId(base.id) || HOOKS.some((hook) => typeof base[hook] !== 'function')) throw new TypeError(`Bot strategy ${id}: invalid base`);
  for (const key of Object.keys(definition)) {
    if (key !== 'id' && key !== 'base' && !HOOKS.includes(key)) throw new TypeError(`Bot strategy ${id}: unknown hook ${key}`);
  }
  const out = { id };
  for (const hook of HOOKS) {
    const fn = Object.hasOwn(definition, hook) ? definition[hook] : base[hook];
    if (typeof fn !== 'function') throw new TypeError(`Bot strategy ${id}: ${hook} must be a function`);
    out[hook] = fn;
  }
  return Object.freeze(/** @type {BotStrategy} */ (out));
}

/** Pure registry construction; never mutate registrations across rooms/tests or replace the legacy baseline. */
/** @param {BotStrategyDefinition[]} definitions */
export function createBotRegistry(definitions = []) {
  if (!Array.isArray(definitions)) throw new TypeError('Bot registry: definitions must be an array');
  const out = { legacy: LEGACY_BOT };
  for (const definition of definitions) {
    const strategy = defineBotStrategy(definition);
    if (Object.hasOwn(out, strategy.id)) throw new Error(`Duplicate bot strategy: ${strategy.id}`);
    out[strategy.id] = strategy;
  }
  return Object.freeze(out);
}
