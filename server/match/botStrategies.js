// Registry only: implementations import the contract, not this module, to avoid registration/import cycles.
import { createBotRegistry, defineBotStrategy } from './botStrategyContract.js';

// Add imports and definitions here when a new strategy is ready; initially only the unchanged legacy bot ships.
export const BOT_STRATEGIES = createBotRegistry();

/** @param {string | import('./botStrategyContract.js').BotStrategyDefinition} [selection] */
export function getBotStrategy(selection = 'legacy', registry = BOT_STRATEGIES) {
  if (selection && typeof selection === 'object') return defineBotStrategy(selection);
  if (typeof selection !== 'string' || !Object.hasOwn(registry, selection)) {
    throw new Error(`Unknown bot strategy: ${String(selection)}; available: ${Object.keys(registry).join(', ')}`);
  }
  return registry[selection];
}
