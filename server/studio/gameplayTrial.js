// Studio-only prep exercise. Production Match owns grants, refresh RNG, deadlines and trait hooks.
import { Match } from '../match/Match.js';
import { VirtualScheduler } from '../match/scheduler.js';
import { getDefaultRegistry } from '../match/effectsMeta.js';
import { registerDslMeta } from '../match/dslMeta.js';
import { GAMEPLAY_TEMPLATES, gameplayOptions, bondId, gameplayHooks } from '../../public/studio/js/gameplayModel.js';
import { PHASE } from '../../shared/constants.js';
import { rulesTrial } from './rulesTrial.js';
import { StudioError } from './files.js';

const hooks = { income: 'onIncome', refresh: 'onRefresh', gain: 'onTraitGain', deploy: 'onTraitDeploy', roundStart: 'onRoundStart', buy: 'onBuy', sell: 'onSold', merge: 'onMerge', levelUp: 'onLevelUp', battleResult: 'onBattleResult' };
const fail = detail => { throw new StudioError('PLUGIN_STUDIO_TRIAL_SCENARIO', 400, { detail }); };

export function gameplayTrial(set, scene, draft, request = {}) {
  if (!draft || !GAMEPLAY_TEMPLATES.includes(draft.template) || !scene.stage) return null;
  const o = gameplayOptions(draft), input = request.exercise || {};
  const round = input.round ?? 1, at = input.at ?? 'prep', actions = input.actions ?? [];
  if (!Number.isInteger(round) || round < 1 || round > 99 || !['prep', 'battleCheck'].includes(at)
    || !Array.isArray(actions) || actions.length > 32 || input.hook && !gameplayHooks(draft.template).includes(input.hook)) fail('exercise');
  const scheduler = new VirtualScheduler();
  const registry = getDefaultRegistry(), grants = [];
  for (const [pluginId, specs] of Object.entries(set.data.dsl || {})) for (const spec of specs) {
    registerDslMeta(registry, spec, { pluginId }); grants.push({ key: spec.meta.key, battle: false });
  }
  const m = new Match({ data: set.data, mode: 'solo', modeId: 'mode_single_normal', seed: request.seed || 1,
    seats: [{ playerId: 'studio', seat: 0, name: 'Studio', isBot: false }], scheduler, registry,
    offers: set.offers || [], ...(set.rules ? { rules: set.rules } : {}), send: () => true, broadcast() {}, onEnd() {} });
  try {
    m.round = round; m.phase = PHASE.PREP;
    const ps = m.players.get('studio');
    ps.effects.push(...grants);
    const player = scene.spec.players[0];
    const pieces = player.units.map(u => {
      const piece = ps.newPiece('chess', u.chessId);
      ps.board.set(`${u.row},${u.col}`, piece);
      return piece;
    });
    ps.recompute();
    if (draft.template === 'bond') {
      const id = bondId(draft.id), record = set.data.bonds[id];
      // [ASSUMED] Explicit active-state fixture, like the test console: no population or duplicate counting simulation.
      ps.bonds[id] = { active: true, tier: o.effectTier, layers: 0, count: record.thresholds[o.effectTier - 1] };
      player.bonds = { [id]: { ...ps.bonds[id] } };
    }
    if (draft.template === 'item') {
      const id = `item_x_${draft.id.replaceAll('-', '_')}_${input.elite ? 'b' : 'a'}`;
      const item = set.data.items[id];
      if (!item) fail('item form');
      ps.acquireItem(id, { silent: true });
      if (item.itemType === 'EQUIP') player.units[0].items = [id];
    }
    const snapshot = () => ({ funds: ps.funds, pendingFunds: ps.pendingFunds, freeRefresh: ps.shop.freeRefreshes,
      layers: Object.fromEntries(Object.entries(ps.bonds).map(([id, b]) => [id, b.layers])),
      inventory: [...ps.hand, ...ps.temp].filter(Boolean).map(p => ({ id: p.id, kind: p.kind })), rules: m.rules || {} });
    const before = snapshot();
    const hook = input.hook || (draft.template === 'bond' ? o.prep[0]?.when : draft.template === 'trait' ? o.spec.meta?.on?.[0]?.when : null) || 'roundStart';
    // [ASSUMED] One isolated event with the first holder. Cross-round economics still require a full room.
    const event = { piece: pieces[0], kind: 'chess', source: 'studio', win: true, income: 0 };
    m.dispatch(ps, hooks[hook], event);
    // As in startRound, setIncome modifies the event before its nonnegative integer amount is credited.
    if (hook === 'income') ps.addFunds(Number.isFinite(event.income) ? Math.max(0, Math.trunc(event.income)) : 0, { reason: 'income' });
    const ruleChecks = draft.template === 'rules' ? rulesTrial(m, ps, scene, o.rules) : undefined;
    if (draft.template === 'bond') player.bonds[bondId(draft.id)].layers = ps.bonds[bondId(draft.id)].layers;
    m.openOfferWindow(at, round);
    const outcomes = [];
    for (const action of actions) {
      if (!action || !['pick', 'refresh', 'timeout'].includes(action.kind)) fail('action');
      if (action.kind === 'timeout') {
        // Advance the virtual clock to the last declared deadline; no real-time timer or room is created.
        const end = Math.max(scheduler.now(), ...m.offerWin.map(w => w.deadline));
        scheduler.advance(end - scheduler.now()); outcomes.push({ ok: true });
      } else {
        const w = m.offerWin.find(w => w.id === action.id && w.pluginId === action.pluginId);
        const identity = w ? { pluginId: w.pluginId, seq: w.seq, cardId: action.cardId } : null;
        outcomes.push(action.kind === 'pick' ? m.requestOffer(ps, action.id, action.idx, identity) : m.requestOfferRefresh(ps, action.id, action.idx, identity));
      }
    }
    // Item grants are visible in the inventory; equip/trap targeting stays a full match operation.
    return { before, after: snapshot(), windows: m.offerViews(), blocking: m.offerBlocking(), outcomes, round, at, hook, ...(ruleChecks ? { ruleChecks } : {}) };
  } finally { m.dispose(); scheduler.dispose(); }
}
