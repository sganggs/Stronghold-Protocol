// Registry only: implementations import the contract, not this module, to avoid registration/import cycles.
// The external host is loaded by llmGate.js, and only on a dev checkout (§35.66). A release has no `external` id.
import { createBotRegistry, defineBotStrategy } from './botStrategyContract.js';
import { EXTERNAL_BOT, llmIntegrationEnabledNow } from './llmGate.js';

import { ADAPTIVE_BOT, IOLETA_ADAPTIVE_BOT } from './botAdaptive.js';
import { IOLETA_BOT } from './botIoleta.js';

// Registration does not enable external IO or select an opt-in strategy.
export const BOT_STRATEGIES = createBotRegistry([...(llmIntegrationEnabledNow && EXTERNAL_BOT ? [EXTERNAL_BOT] : []),
  IOLETA_BOT, ADAPTIVE_BOT, IOLETA_ADAPTIVE_BOT]);

/** @param {string | import('./botStrategyContract.js').BotStrategyDefinition} [selection] */
export function getBotStrategy(selection = 'legacy', registry = BOT_STRATEGIES) {
  // An unset or empty selection means the original bot, at startup and in every match/tool.
  if (selection === '') selection = 'legacy';
  if (selection && typeof selection === 'object') return defineBotStrategy(selection);
  // A release package has no external host. Map the id back to the built-in bot instead of refusing to boot.
  // startServer logs that once; this remap stays quiet so a match child does not print it again.
  if (selection === 'external' && !llmIntegrationEnabledNow) selection = 'legacy';
  if (typeof selection !== 'string' || !Object.hasOwn(registry, selection)) {
    throw new Error(`Unknown bot strategy: ${String(selection)}; available: ${Object.keys(registry).join(', ')}`);
  }
  return registry[selection];
}

/**
 * Per-seat overrides of the match's strategy (#816 P1). `SP_BOT_STRATEGY_SEATS` text is `seat:id[,seat:id…]`
 * (room seats 0–3 like SP_EXTERNAL_AI_SEATS, registered IDs); a programmatic selection is `{ [seat]: id | definition }`.
 * Unset or empty: no overrides. Each entry resolves through getBotStrategy (unknown IDs fail, a release maps external).
 * @param {string | Record<string, string | import('./botStrategyContract.js').BotStrategyDefinition>} [selection]
 * @returns {Readonly<Record<string, import('./botStrategyContract.js').BotStrategy>>}
 */
export function getBotStrategySeats(selection, registry = BOT_STRATEGIES) {
  const out = {};
  if (selection == null || selection === '') return Object.freeze(out);
  let entries;
  if (typeof selection === 'string') {
    entries = selection.split(',').map((part) => {
      const at = part.indexOf(':');
      if (at < 0) throw new Error(`Bot strategy seats: expected seat:id, got "${part.trim()}"`);
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()];
    });
  } else if (typeof selection === 'object' && !Array.isArray(selection)) entries = Object.entries(selection);
  else throw new Error('Bot strategy seats: a seat:id list or a { seat: id } object is required');
  if (entries.length > 4) throw new Error('Bot strategy seats: at most 4 seats');
  for (const [seat, choice] of entries) {
    if (!/^[0-3]$/.test(seat)) throw new Error(`Bot strategy seats: seat must be 0..3, got "${seat}"`);
    if (Object.hasOwn(out, seat)) throw new Error(`Bot strategy seats: seat ${seat} is listed twice`);
    // getBotStrategy reads '' / undefined as legacy; an entry must name its strategy.
    if (choice == null || choice === '') throw new Error(`Bot strategy seats: seat ${seat} needs a strategy id`);
    try { out[seat] = getBotStrategy(choice, registry); }
    catch (cause) { throw new Error(`Bot strategy seats: seat ${seat}: ${cause.message}`, { cause }); }
  }
  return Object.freeze(out);
}
