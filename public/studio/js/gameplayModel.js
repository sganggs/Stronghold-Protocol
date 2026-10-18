// Data-only form model. Kept outside shared/ so authoring never changes vanilla content identity.
export const GAMEPLAY_TEMPLATES = Object.freeze(['bond', 'item', 'trait', 'offers', 'rules']);
export const bondId = id => `bond_x_${id.replaceAll('-', '_')}_one`;

// [ASSUMED] Small, immediately playable examples; authors can replace every value in the forms.
export function gameplayDefaults(template, id) {
  const bond = bondId(id);
  const talents = [{ when: 'deploy', do: [{ buff: { mods: { atkPct: 0.25 } } }] }];
  if (template === 'bond') return { name: id, desc: id, thresholds: [1, 2], countMode: 'BOARD', isCore: false,
    members: ['char_102_texas'], talents,
    prep: [{ when: 'roundStart', do: [{ funds: { amount: 1 } }] }], effectTier: 1, bond };
  if (template === 'item') return { name: id, base: 'chess_item_1_01_e_a', paired: true,
    normal: { price: 1, tier: 1 }, elite: { price: 2, tier: 1 }, hideInShop: false, shopExcluded: false, shopSortId: 10000 };
  if (template === 'trait') return { charId: 'char_102_texas', desc: id, translations: {}, override: false,
    spec: { dsl: 1, talents, meta: { on: [] } } };
  if (template === 'offers') return { window: { offer: 1, id: 'choice', when: { at: ['prep'], rounds: [1] },
    windowSec: 30, quorum: 'all', onTimeout: 'auto', defer: [], slots: 1, refresh: { perSlot: 1 },
    options: { source: 'offers/cards.json' } },
    cards: [1, 2, 3].map(n => ({ id: `card-${n}`, name: `+${n}`, desc: `+${n}`, icon: 'funds', apply: { funds: n } })) };
  if (template === 'rules') return { rules: { shopBias: 'official', prepLoadout: 'locked', morphPairing: 'official', unequip: 'official' } };
  return {};
}

/** Form edits and sidecar JSON share the same lossless representation (no stringified JSON fields). */
export function gameplayOptions(draft) {
  return { ...gameplayDefaults(draft.template, draft.id), ...draft.options };
}
export const editGameplay = (draft, patch) => ({ ...draft, options: { ...gameplayOptions(draft), ...patch } });

// The two DSL vocabularies differ: operator gain/deploy versus bond income/refresh.
export function gameplayHooks(template) {
  if (template === 'bond') return ['roundStart', 'income', 'buy', 'sell', 'refresh', 'merge', 'levelUp', 'battleResult'];
  if (template === 'trait') return ['gain', 'deploy', 'roundStart', 'buy', 'sell', 'merge', 'levelUp', 'battleResult'];
  return [];
}
