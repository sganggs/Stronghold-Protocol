// §35.9: a readable index over human-visible data, not a second intent executor.
import { FIELD, legalTiles, parseKey } from './board.js';
import { interestDigest, effectText } from '../ai/knowledge.js';
import { operatorCaps } from '../ai/playbook.js';
import { ruleOption } from '../../shared/plugins/rules.js';
import { pieceBonds } from './bondsMeta.js';
import { advisorBanks } from './aiEconomy.js';

export function aiDigest(m, ps, kind, pub, own, pack = null) {
  const gd = ps.gd || m.gd;
  const names = new Map((pack ? [...pack.operators, ...pack.items, ...pack.bonds, ...pack.bands, ...pack.enemies, ...pack.bosses] : []).map(r => [r.id, r]));
  const named = id => {
    const r = names.get(id), chess = gd.chess(id);
    const raw = (chess && ps.fieldRecord(chess)) || gd.item(id) || gd.token(id) || gd.bond(id) || gd.band(id) || gd.enemy(id) || gd.boss(id);
    const nameZh = raw?.name || r?.nameZh || id;
    return { name: r && r.nameZh === nameZh ? r.name : nameZh, nameZh };
  };
  const chessView = id => {
    const rec = gd.chess(id);
    if (!rec) return {};
    // name is already applied by named(). class is the official profession. caps match the playbook hints.
    return { class: rec.profession || '', caps: operatorCaps(rec) };
  };
  const operator = p => p.kind === 'chess' ? { baseId: gd.baseIdOf(p.id), bonds: pieceBonds(gd, p, m.rules),
    stars: gd.isGolden(p.id) ? 2 : 1, ...chessView(p.id) } : {};
  // [ASSUMED] Kill chance is the seat strategy's bountyKillChance (legacy exposure model) when that hook returns
  // a finite number. Compact enemy stats are the catalogue row, not the round's scaled combat values.
  const enemyBrief = key => {
    const e = gd.enemy(key);
    if (!e) return undefined;
    const effect = effectText([e.desc, ...(e.abilities || [])]).replace(/<@[^>]*>|<\/>/g, '').slice(0, 160);
    return { hp: e.stats?.maxHp || 0, def: e.stats?.def || 0, res: e.stats?.res || 0, motion: e.stats?.motion || '',
      fly: typeof e.isFlyEnemy === 'boolean' ? e.isFlyEnemy : e.stats?.motion === 'FLY', ...(effect ? { effect } : {}) };
  };
  const withBounty = card => {
    if (!card || card.kind !== 'bounty') return card;
    let killChance;
    if (typeof m.bot?.bountyKillChance === 'function') {
      try {
        const p = m.bot.bountyKillChance(m, ps, card);
        if (typeof p === 'number' && Number.isFinite(p)) killChance = p;
      } catch { /* a broken estimator must not drop the observation */ }
    }
    const enemy = card.enemyKey ? enemyBrief(card.enemyKey) : undefined;
    return { ...card, ...(killChance === undefined ? {} : { killChance }), ...(enemy ? { enemy } : {}) };
  };
  const piece = p => ({ ...p, ...named(p.id), ...operator(p), items: (p.items || []).map(i => ({ ...i, ...named(i.id) })) });
  const slots = list => (list || []).map((s, slot) => s && ({ ...s, slot, ...named(s.id), ...operator(s), tier: gd.tierOf(s.id) }));
  const actions = [];
  const add = (intent, text) => actions.push({ id: `a${actions.length + 1}`, text, intent });
  if (kind === 'band' && pub.draft?.turn === ps.playerId) {
    for (const id of gd.bandIds()) if (!m.bandTaken(id, ps.playerId)) add({ t: 'g.band', bandId: id }, `band ${named(id).nameZh}`);
    if (pub.draft.skipsLeft[ps.playerId] > 0) add({ t: 'g.bandSkip' }, 'skip band turn');
  }
  if (kind === 'card' && pub.sp?.turn === ps.playerId) {
    for (const c of pub.sp.cards) if (!c.soldOut && pub.sp.taken[c.idx] == null) add({ t: 'g.choice', idx: c.idx }, `card ${c.idx}: ${c.name}`);
  }
  if (kind === 'offer' || kind === 'prep') for (const w of pub.offers || []) {
    const seat = w.seats.find(s => s.playerId === ps.playerId && !s.picked);
    for (const c of seat?.slots || []) if (c.available) add({ t: 'g.offer', offerId: w.id, pluginId: w.pluginId, seq: w.seq, idx: c.idx, cardId: c.id }, `offer ${w.id}: ${c.name}`);
  }
  if (kind === 'prep' && !ps._gate()) {
    const free = own.hand.findIndex(p => !p);
    own.shop.slots.forEach((s, slot) => {
      if (s && !s.sold && s.price <= own.funds && free >= 0) add({ t: 'g.buy', slot }, `buy shop slot ${slot} (${named(s.id).nameZh}, ${s.price} gold)`);
    });
    if (own.funds >= own.shop.refreshPrice) add({ t: 'g.refresh' }, `refresh (${own.shop.refreshPrice} gold)`);
    add({ t: 'g.freeze' }, own.shop.frozen ? 'unfreeze shop' : 'freeze shop');
    if (own.shop.level < own.shop.maxLevel && own.funds >= own.shop.upgradePrice && !ps._testShopNext) add({ t: 'g.levelUp' }, `level up (${own.shop.upgradePrice} gold)`);
    for (const p of [...own.hand, ...own.temp, ...own.board].filter(Boolean)) {
      if (p.kind === 'chess') add({ t: 'g.sell', uid: p.uid }, `sell ${p.uid} (${named(p.id).nameZh})`);
      if (p.kind === 'item') {
        add({ t: 'g.destroy', uid: p.uid }, `destroy ${p.uid} (${named(p.id).nameZh})`);
        const rec = gd.item(p.id);
        // [ASSUMED] Shortcuts cover side-effect-free eligibility. Arbitrary plugin consumables/Arts can only
        // prove eligibility by running their effect, so they remain raw-intent actions (never execute to probe).
        if (rec?.itemType === 'EQUIP' && !rec.kind?.startsWith('consume_on_equip')) {
          for (const target of ps.allChess()) if (ps._slotPolicy().accepts(target.items || [], rec))
            add({ t: 'g.equip', itemUid: p.uid, targetUid: target.uid }, `equip ${p.uid} on ${target.uid} (${named(target.id).nameZh})`);
        }
        continue;
      }
      const loc = ps.find(p.uid);
      if (free >= 0) add({ t: 'g.move', uid: p.uid, to: { area: 'hand', idx: free } }, `bench ${p.uid} in slot ${free}`);
      for (const [row, col] of legalTiles(ps.deployMap(), ps._placementOf(loc.piece))) {
        if (!ps._legal(loc.piece, row, col)) continue;
        const occ = ps.board.get(`${row},${col}`);
        if (occ && occ.uid !== p.uid) continue; // swaps remain available through raw intents
        if (loc.area !== 'board' && p.kind === 'chess' && ps.deployCount >= ps.deployCap) continue;
        if (p.kind === 'token' && ![...ps.board.values()].some(o => o.uid === p.ownerUid)) continue;
        for (const dir of ['RIGHT', 'UP', 'DOWN', 'LEFT']) {
          if (occ && p.kind === 'chess' && !ps._roomForOutOfRange(loc.piece, `${row},${col}`, dir)) continue;
          add({ t: 'g.move', uid: p.uid, to: { area: 'board', row, col }, dir }, `place ${p.uid} (${named(p.id).nameZh}) at ${row},${col} ${dir}`);
        }
      }
      if (ruleOption(m.rules, 'unequip') === 'allow' && free >= 0) for (const it of p.items || [])
        add({ t: 'g.unequip', itemUid: it.uid }, `unequip ${it.uid} from ${p.uid}`);
    }
    own.shop.rewardOffer?.slots.forEach((s, idx) => {
      if (s && !s.sold && free >= 0 && (s.price || 0) <= own.funds) add({ t: 'g.reward', idx }, `reward ${idx}: ${named(s.id).nameZh}`);
    });
    own.personalChoice?.cards.forEach((c, idx) => add({ t: 'g.choice', idx, choiceId: own.personalChoice.id }, `personal card ${idx}: ${c.name}`));
    if (own.canReady) add({ t: 'g.ready', ready: true }, 'ready');
  }
  return {
    playerId: own.playerId, round: pub.round, phase: pub.phase, lp: own.lp, band: { id: own.bandId, ...named(own.bandId) },
    availability: { disabledBonds: pub.disabledBonds, bannedChess: pub.bannedChess, diyBanned: own.diyBanned },
    factions: pub.factions,
    ...(m.externalAI?.config.mode === 'plan' ? { feedback: m.externalAI.feedbackFor(ps) } : {}),
    economy: { gold: own.funds, interest: interestDigest(gd, own.bandId, own.funds), level: own.shop.level,
      exp: null, upgradePrice: own.shop.upgradePrice, refreshPrice: own.shop.refreshPrice,
      expiringFunds: gd.leftoverKeptBands.includes(own.bandId) ? 0 : own.funds,
      frozenSlots: own.shop.slots.flatMap((s, slot) => s?.frozen && !s.sold ? [slot] : []),
      bankOperators: advisorBanks(m, ps).map(p => ({ uid: p.uid, id: p.id, sellValue: gd.sellPrice(p.id) })) },
    bonds: own.bonds.map(b => ({ ...b, ...named(b.bondId), nextThreshold: b.thresholds?.find(n => n > b.count) ?? null })),
    shop: slots(own.shop.slots), rewards: slots(own.shop.rewardOffer?.slots),
    personalChoice: own.personalChoice ? { ...own.personalChoice, cards: (own.personalChoice.cards || []).map(withBounty) } : own.personalChoice,
    bench: own.hand.map((p, slot) => p && ({ ...piece(p), slot })).filter(Boolean),
    overflow: own.temp.filter(Boolean).map(piece), board: own.board.map(piece),
    deployCap: own.deployCap, upcoming: own.nextEnemies.map(e => ({ ...e, ...named(e.enemyKey) })), boss: { id: pub.bossId, ...named(pub.bossId), round: pub.bossRound },
    // Existing human scouting builder, board only. Never read opponents' privateView/hand/funds/stock.
    opponents: pub.players.filter(p => p.playerId !== own.playerId && p.alive).map(p => ({ playerId: p.playerId,
      lp: p.lp, bandId: p.bandId, bonds: p.bonds, board: m._prepBoardUnits(m.players.get(p.playerId)).map(u =>
        ({ id: u.defId, name: u.name, tier: u.tier, row: u.y, col: u.x, dir: u.dir, items: u.items })) })),
    choices: { cards: pub.sp?.cards?.map(withBounty), offers: pub.offers },
    geometry: { rows: [FIELD.r0, FIELD.r1], cols: [0, FIELD.c1], tiles: [...ps.deployMap()].map(([key, terrain]) => ({ at: parseKey(key), terrain })) },
    actions,
    actionScope: 'Current-state shortcuts; IDs last only for this observation. Raw intents also support swaps, Arts, consumables, band focus and offer refresh; all actions are revalidated.',
  };
}
