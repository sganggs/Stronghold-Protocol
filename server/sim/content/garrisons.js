// server/sim/content/garrisons.js — 特质 (garrisons), battle side and prep side (docs/DATA.md §4, docs/META.md §2.3).
//
//   install(battle)             IN_BATTLE garrisons — garrisons/battle.js
//   registerMeta(registry)      SERVER_* garrisons — garrisons/meta.js (garrison:<effectKey>)
//   triggerGainEffects(ctx, p)  re-run the 获得时 garrisons of an owned chess piece (×投资人); returns the effects run

export { install } from './garrisons/battle.js';
export { registerMeta, triggerGainEffects } from './garrisons/meta.js';
export { ursusTempExtra } from './garrisons/regulation.js';
