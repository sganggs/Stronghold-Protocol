// Preparation effects of 规程 commands. Official keys/blackboards select behaviour; no reused band ids.
import { paramsOf, openSkillChangeDraft, reconcileCommandChests } from './bandCommands.js';
import { pieceBonds as bondsOfPiece } from './bondsMeta.js';

const slotsOf = ps => ps.shop.slots.flatMap((s, i) => s?.kind === 'chess' && !s.sold ? [i] : []);
const mark = (ps, data) => (ps.commandMarks ||= []).push({ id: ps.m.nextUid(), round: ps.m.round, ...data });
const matches = (ps, id, bond) => ps.gd.chess(id)?.bonds?.includes(bond);
const buffs = (s, key) => s.buffs.filter(b => b.key === key).map(paramsOf);
const stateOf = (ps, s) => ps.command.records[s.effectId];
const roundCount = (ps, key) => ps.round[`command:${key}`] || 0;
const bump = (ps, key) => (ps.round[`command:${key}`] = roundCount(ps, key) + 1);
const replace = (ps, ctx, slot, id) => ctx.setShopSlot(slot, { kind: 'chess', id, frozen: ps.shop.frozen });

/** Non-mutating plan creation. Only seeded rolls occur here; apply executes after the command's payment. */
export function commandPlan(ps, skill, target, ctx) {
  const piece = target.uid ? ps.find(target.uid)?.piece : null;
  const slot = target.slot !== undefined ? ps.shop.slots[target.slot] : null;
  for (const b of skill.buffs) {
    const p = paramsOf(b);
    switch (b.key) {
      case 'skill_mark_char_inst_tag':
        return { apply: () => mark(ps, { uid: piece.uid, tag: p.tag }) };
      case 'skill_mark_pos_grow_use_cnt':
        return { apply: () => mark(ps, { ...target, tag: p.tag }) };
      case 'skill_add_pos_effect_enemy':
        return { apply: () => mark(ps, { ...target, enemyId: p.enemy_id, coin: p.coin, persistent: true }) };
      case 'skill_next_equip_buy_discount':
        return { apply: () => { (ps.commandDiscounts ||= []).push({ remaining: p.times, amount: p.count }); } };
      case 'skill_transform_char_same_tier': {
        const id = ctx.rollChess({ tier: ps.gd.tierOf(slot.id) });
        return id ? { apply: () => replace(ps, ctx, target.slot, id) } : null;
      }
      case 'skill_copy_char_with_equip': {
        const id = piece.id, items = (piece.items || []).map(i => i.id);
        return { apply: () => {
          const copy = ps.acquireChess(id, { source: 'command' });
          for (const itemId of items) {
            const item = ps.acquireItem(itemId, { source: 'command', displayed: true, deferMerge: true });
            if (item && copy) ctx.equipDirect(item.uid, copy.uid);
          }
        } };
      }
      case 'skill_act_bond_grow_garr_cnt': {
        const active = bondsOfPiece(ps.gd, piece, ps.m.rules).filter(id => ps.bonds[id]?.active);
        return active.length ? { apply: () => { for (const id of active) ps.addLayers(id, p.initial_count, { requireActive: true, reason: 'command' }); } } : null;
      }
      case 'skill_upgrade_char':
        return { apply: () => ps.promote(piece) };
      case 'skill_gain_gold_cd_by_gold': {
        const gold = p.mingold + ctx.rng.int(p.maxgold - p.mingold + 1);
        return { cooldown: gold, apply: () => ps.addFunds(gold, { reason: 'command' }) };
      }
      case 'skill_trigger_garr_event':
        return { apply: () => ctx.triggerGarrisons(piece.uid, p.event) };
      case 'skill_garr_event_extra_exec':
        return { apply: () => mark(ps, { uid: piece.uid, event: p.event, count: p.count }) };
      case 'skill_transform_char_up_tier': {
        const id = ctx.rollChess({ tier: Math.min(6, ps.gd.tierOf(piece.id) + 1) });
        return id ? { apply: () => ps.transformChess(piece, id) } : null;
      }
      case 'skill_drop_hp_to_low_gain_coin': {
        const others = ps.m.alivePlayers().filter(o => o !== ps).sort((a, b) => a.lp - b.lp || a.seat - b.seat);
        const other = others[0];
        if (!other || other.lp >= ps.lp) return null;
        const lost = ps.lp - other.lp, gold = Math.min(p.max_count, lost);
        // Official skillDesc places healing at prep end. [ASSUMED] Equal lowest HP selects the first seat;
        // healing equals HP sacrificed (the max_count cap applies only to the gold sentence).
        return { apply: () => {
          ps.lp = other.lp;
          ps.stats.lpLost += lost;
          ps.addFunds(gold, { reason: 'command' });
          mark(ps, { healPlayerId: other.playerId, heal: lost });
          ps.m.markPublic();
        } };
      }
      case 'skill_take_shop_char':
      case 'skill_gain_all_shop_char': {
        const indices = ctx.rng.shuffle(slotsOf(ps)).slice(0, b.key === 'skill_take_shop_char' ? p.count : Infinity);
        return indices.length ? { apply: () => {
          for (const i of indices) {
            const id = ps.shop.slots[i].id;
            ctx.setShopSlot(i, null);
            ps.acquireChess(id, { source: 'command' });
          }
        } } : null;
      }
      case 'skill_sell_char_bond_layer': {
        const tier = ps.gd.tierOf(piece.id), active = Object.keys(ps.bonds).filter(id => ps.bonds[id].active);
        return { apply: () => {
          ps.sell(piece.uid);
          for (const id of active) ps.addLayers(id, tier, { reason: 'command' });
        } };
      }
      case 'skill_refresh_shop_high_tier':
      case 'skill_refresh_shop_bond_char':
      case 'skill_refresh_shop_board_char': {
        const boardIds = new Set([...ps.board.values()].filter(p => p.kind === 'chess').map(p => ps.gd.baseIdOf(p.id)));
        const opts = b.key === 'skill_refresh_shop_high_tier' ? { tier: Math.min(6, ps.shop.level + p.lv_up) }
          : b.key === 'skill_refresh_shop_bond_char' ? { bond: p.bond, maxTier: ps.shop.level }
          : { maxTier: ps.shop.level, filter: id => boardIds.has(ps.gd.baseIdOf(id)) };
        const count = p.count ?? ps.gd.shopSlots(ps.shop.level).chess, ids = [];
        for (let i = 0; i < count; i++) { const id = ctx.rollChess(opts); if (id) ids.push(id); }
        if (b.key === 'skill_refresh_shop_high_tier' && ids.length < count) return null;
        return { apply: () => {
          ps.rollShop();
          const slots = slotsOf(ps);
          ids.forEach((id, i) => { if (slots[i] !== undefined) replace(ps, ctx, slots[i], id); });
          // [ASSUMED] A command refresh is not a manual-refresh event (no extra refresh payment or trait triggers).
        } };
      }
      case 'skill_change_shop_equip': {
        const i = ps.shop.layout?.chess ?? ps.gd.shopSlots(ps.shop.level).chess;
        const id = ctx.rollItem({ maxTier: ps.shop.level, exclude: [ps.shop.slots[i]?.id].filter(Boolean) });
        return id ? { apply: () => ctx.setShopSlot(i, { kind: 'item', id, frozen: ps.shop.frozen }) } : null;
      }
      case 'skill_mark_shop_equip_tag': {
        const itemId = slot.id;
        return { apply: () => { ctx.setShopSlot(target.slot, null); mark(ps, { tag: p.tag, itemId }); } };
      }
      case 'skill_layer_limit_grow_round':
        return { apply: () => mark(ps, { uid: piece.uid, layerCapBonus: ps.m.round }) };
      case 'skill_remove_gain_bond_char': {
        const id = ctx.rollChess({ bond: p.bond, maxTier: ps.gd.tierOf(p.in_shop ? slot.id : piece.id) });
        return id ? { apply: () => {
          if (p.in_shop) replace(ps, ctx, target.slot, id);
          else ps.transformChess(piece, id);
        } } : null;
      }
      case 'skill_gain_bond_char': {
        const ids = [];
        for (let i = 0; i < p.count; i++) { const id = ctx.rollChess({ bond: p.bond, maxTier: ps.shop.level }); if (id) ids.push(id); }
        return ids.length ? { apply: () => { for (const id of ids) ps.acquireChess(id, { source: 'command' }); } } : null;
      }
      default: break; // paired passive / cost modifiers are handled by the state machine and hooks below
    }
  }
  return null;
}

export const commandPassive = {
  onBattleResult(ps, s, ctx, ev) {
    reconcileCommandChests(ps, ev.result);
    reconcileCommandChests(ps, ev.unite?.perPlayer?.[ps.playerId]);
  },
  onPrepStart(ps, s, ctx) {
    for (const p of buffs(s, 'prep_start_random_equip_in_round')) if (ctx.round === p.round) {
      // [ASSUMED] Normal equipment pool at exactly the current shop tier (official text).
      const id = ctx.rollItem({ tier: ps.shop.level });
      if (id) ctx.grantItem(id);
    }
    // The original strategy keeps opening its draft after a chosen command replaces the current row.
    for (const b of ps.gd.band(ps.bandId).buffs || []) if (b.key === 'gain_band_skill_from_pool_in_prep') {
      openSkillChangeDraft(ps, paramsOf(b).choice_event, ctx);
    }
  },
  onPrepEnd(ps, s, ctx) {
    for (const p of buffs(s, 'skill_cost_round_grow_reset_on_use')) {
      const st = stateOf(ps, s); st.currentCost = Math.max(0, st.currentCost - p.delta);
    }
    for (const m of ps.commandMarks || []) {
      if (m.round !== ps.m.round || m.prepApplied) continue;
      if (m.event) for (let i = 0; i < m.count; i++) ctx.triggerGarrisons(m.uid, m.event);
      if (m.healPlayerId) {
        const other = ps.m.players.get(m.healPlayerId);
        if (other?.alive) { other.lp = Math.min(ps.gd.startLp(other.bandId), other.lp + m.heal); other.dirty(); ps.m.markPublic(); }
      }
      m.prepApplied = true;
    }
  },
  onGain(ps, s, ctx, ev) {
    if (ev.kind !== 'chess') return;
    for (const p of buffs(s, 'gain_bond_cnt_shop_up_discount')) {
      if (!matches(ps, ev.piece.id, p.bond)) continue;
      // [ASSUMED] The gain counter starts anew at each shop level; a gain includes rewards and grants.
      const key = `command:discount:${ps.shop.level}`;
      ps.counters[key] = (ps.counters[key] || 0) + 1;
      if (ps.counters[key] === p.count) ps.shop.upgradePrice = Math.max(0, ps.shop.upgradePrice - p.value);
    }
  },
  onPrice(ps, s, ctx, ev) {
    if (ev.kind === 'item') {
      const discount = (ps.commandDiscounts || []).filter(d => d.remaining > 0).reduce((sum, d) => sum + d.amount, 0);
      ctx.modifyPrice(-discount);
    }
  },
  onBuy(ps, s, ctx, ev) {
    if (ev.kind === 'item') {
      for (const d of ps.commandDiscounts || []) if (d.remaining > 0) d.remaining--;
      return;
    }
    for (const p of buffs(s, 'skill_cost_reduce_on_buy_bond')) if (matches(ps, ev.slot.id, p.bond)) {
      const st = stateOf(ps, s); st.currentCost = Math.max(0, st.currentCost - p.count);
    }
    for (const p of buffs(s, 'buy_bond_char_cnt_gain_equip')) if (matches(ps, ev.slot.id, p.bond)) {
      const key = `command:buy:${s.effectId}`;
      ps.counters[key] = (ps.counters[key] || 0) + 1;
      if (ps.counters[key] % p.count === 0) for (let i = 0; i < p.count2; i++) {
        const id = ctx.rollItem({ maxTier: ps.shop.level }); if (id) ctx.grantItem(id);
      }
    }
  },
  onRefresh(ps, s, ctx) {
    for (const p of buffs(s, 'n_round_refresh_cnt_gain_coin')) {
      if (ps.m.round % p.round === 0 && ps.round.refreshes <= p.refresh_count) ctx.addFunds(p.coin, 'command');
    }
  },
  onMerge(ps, s, ctx, ev) {
    if (ev.kind === 'chess') for (const p of buffs(s, 'promote_char_extra_award')) {
      if (bump(ps, 'promote') <= p.n) for (let i = 0; i < p.count; i++) ps.pushRewardOffer('command');
    }
    if (ev.kind === 'item') for (const p of buffs(s, 'promote_equip_extra_award')) {
      if (bump(ps, 'equip') > p.n) continue;
      const ids = [];
      // [ASSUMED] Normal equipment up to shop tier + 1; draw distinct entries for the free offer.
      for (let i = 0; i < p.count; i++) {
        const id = ctx.rollItem({ maxTier: Math.min(6, ps.shop.level + 1), exclude: ids }); if (id) ids.push(id);
      }
      for (let i = 0; i < p.select_count && ids.length; i++) ctx.offerItems(ids);
    }
  },
  onSold(ps, s, ctx, ev) {
    for (const p of buffs(s, 'sell_char_swap_shop_char')) {
      if (ps.gd.isGolden(ev.piece.id) || roundCount(ps, 'swap') > 0) continue;
      const slots = ctx.rng.shuffle(slotsOf(ps)).slice(0, p.count);
      if (!slots.length) continue;
      bump(ps, 'swap');
      for (const i of slots) {
        const id = ps.shop.slots[i].id;
        replace(ps, ctx, i, ev.piece.id);
        ps.acquireChess(id, { source: 'command' });
      }
      ev.gain = 0;
    }
  },
};
