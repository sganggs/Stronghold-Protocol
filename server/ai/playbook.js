// §35.12: public, reproducible advisor catalogue. No match object, RNG or live pool input.
// Rules: activity_table autoChessData + act2autochess, character/skill tables; docs/AI-STRATEGY.md.
// [ASSUMED] All classifications, text-derived capability hints, graph weights and timing estimates are advisory.
import { GameData } from '../match/gamedata.js';
import { bandBondIds } from '../../shared/bandBonds.js';
import { BOSS_HIT_LIMIT } from '../../shared/constants.js';
import { COMMUNITY } from './strategy-community.js';
import { operatorEvents, deriveCycles } from './cycles.js';

const sorted = rows => rows.sort((a, b) => a.id.localeCompare(b.id));
const uniq = xs => [...new Set(xs)];
const source = 'activity_table autoChessData / act2autochess → data/bands.json buffs; server/sim/content/bands/';
const fields = c => [c.trait?.desc, c.skill?.desc, ...(c.talents || []).map(t => t.desc)].join(' ');
const isBeacon = item => item?.buffs?.some(b => b.key === 'use_equip_recruit_new_char_and_give_char_to_player_most_bond');

// Official chess fields: canHitFly, dmgType, position, stats.blockCnt, profession, subProfessionId
// (character_table / act2autochess charChessDataDict, generated data/chess.json).
export function operatorCaps(c) {
  return {
    air: c?.canHitFly === true && !['heal', 'none'].includes(c?.dmgType),
    block: c?.position === 'MELEE' && c?.stats?.blockCnt > 0,
    sustain: c?.profession === 'MEDIC' || c?.dmgType === 'heal',
    elementRecovery: c?.subProfessionId === 'wandermedic',
  };
}

function capabilities(c) {
  const text = fields(c);
  return {
    ...operatorCaps(c),
    // i18n-ignore: match official Chinese mechanical text, never player-facing strings
    reveal: /隐匿.{0,6}失效|无视.{0,6}隐匿|反隐/.test(text),
    // i18n-ignore: match official Chinese mechanical text
    elementDamage: /造成元素损伤|附带.{0,12}(凋亡|灼燃|神经|侵蚀)损伤/.test(text),
  };
}

function bandProfile(id, band, data, gd) {
  const effective = data.bands?.[band.effectRef] || band, buffs = effective.buffs || [];
  const bonds = uniq([...(band.bondIds || []), ...bandBondIds(effective, { bonds: data.bonds, pools: data.choices?.pools })])
    .filter(id => data.bonds?.[id]);
  const classes = [], insights = [];
  if (bonds.length) classes.push('bond-engine');
  const add = (kind, role, p, mechanic, advice) => {
    classes.push(role); insights.push({ kind, parameters: p, mechanic, advice: `[ASSUMED] ${advice}`, source });
  };
  for (const b of buffs) {
    const p = { ...b.bb, ...b.bbStr }, key = p.key || b.key;
    if (b.key === 'round_start_bond_check_gain_layer') add('single-bond', 'bond-engine', p,
      `At R${p.round} start, exactly ${p.factioncount} active bond(s): +${p.count1} layers; otherwise +${p.count2} to each active stacking bond. noStack is excluded (maintainer decision 2026-10-08).`,
      'Focus one stacking bond through the preceding round; widen only after the check. Count ALL incidental active bonds.');
    if (key === 'act1autochess_band2_buff') add('wide', 'wide-bond', p,
      Object.keys(p).filter(k => /^value_\d+$/.test(k)).map(k => Number(k.slice(6))).sort((a, b) => a - b)
        .map(i => `${p[`value_${i}`]}+ active: ATK +${p[`atk_${i}`] * 100}%, HP +${p[`max_hp_${i}`] * 100}%`).join('; '),
      'Use overlapping cheap two-member thresholds; three priority targets need not limit incidental activations.');
    if (b.key === 'prep_finish_char_bond_add_layer') add('mixed-tier', 'bond-engine', p,
      `Prep end: one random fielded operator per distinct tier adds ${p.layer} layers to its bonds, without requiring activation.`,
      'Keep useful mixed-tier units; this does not give every active bond the full tier-count bonus.');
    if (key === 'act2autochess_band12_buff') add('duplicates', 'combat-modifier', p,
      `Same-base-name fielded operators (normal or elite) receive ATK +${p.atk * 100}% at battle start.`,
      'Keep a useful pair if its damage outweighs the lost distinct-member slot; automatic merges still apply.');
    if (key === 'act2autochess_band3_buff') add('elites', 'elite-merge', p,
      `At battle start each fielded elite gains ATK +${p.atk_per_cnt * 100}% and HP +${p.max_hp_per_cnt * 100}% per fielded elite.`,
      'Build cheap elites as a safety net; normal operators do not receive this multiplier.');
    if (b.key === 'auto_chess_change_map' && /_ge$/.test(p.common_condition || '')) add('elite-support', 'team-support', p,
      `Each player's reserve medic becomes Touch when that player's board has at least ${p.cnt} elites at battle start.`,
      'Reach the elite condition on each board; teammates do not share an elite count.');
    if (b.key === 'coin_carry_over') add('interest', 'economy', p,
      `Carry funds; interest min(${p.max}, floor(leftover / ${p.capital}) * ${p.interest}) at round start.`,
      'Reserve the next useful interest threshold only if survival permits; other bands normally lose leftover funds.');
    if (key === 'act1autochess_band19_buff') add('weakness', 'combat-modifier', p,
      'Physical/Arts hits become weakness damage, choosing the favorable defense calculation.',
      'Useful against uneven DEF/RES; does not remove the leader hit limit.');
    if (/coin|price_change/.test(b.key)) classes.push('economy');
    if (/copy_max/.test(b.key)) classes.push('elite-merge');
    if (b.key === 'auto_chess_change_map' || b.key === 'round_start_all_player_change_enemy_2') classes.push('team-support');
    if (b.key === 'round_start_all_player_change_enemy_2') add('team-enemies', 'team-support', p,
      `From R${p.round}, replace ${p.min}–${p.max} eligible ground enemies on each living player's field with the listed bounty enemies.`,
      'Review teammates\' early survival before choosing enemy replacement for its income.');
    if (/special_goods/.test(b.key) || p.type === 'equip' || p.type === 'trap') classes.push('item');
    // Read granted item mechanics rather than assuming every item grant is team support.
    const item = data.items?.[p.chess];
    if (isBeacon(item)) classes.push('team-support');
  }
  const beaconRounds = buffs.filter(b => isBeacon(data.items?.[b.bbStr?.chess]))
    .map(b => b.bb?.round).filter(Number.isFinite).sort((a, b) => a - b);
  if (beaconRounds.length) insights.push({ kind: 'supplier', parameters: { rounds: beaconRounds }, source,
    mechanic: 'Beacon consumes the carrier, offers same-tier replacements, and sends the original next round to the teammate with most matching bond members (random ties).',
    advice: '[ASSUMED] Buy a missing teammate core only when the automatic recipient and delivery timing fit.' });
  const roleClasses = uniq(classes.length ? classes : ['combat-modifier']);
  return { id, name: band.name, effect: effective.desc || '', bondIds: bonds, roleClass: roleClasses[0], roleClasses, insights,
    grantedItems: buffs.map(b => b.bbStr?.chess).filter(id => data.items?.[id]),
    carriesFunds: gd.leftoverKeptBands.includes(id), beaconRounds };
}

// [ASSUMED] Baseline schedule: upgrade at most once/round after reserving the cheapest piece's price, one paid refresh,
// spend remaining income on pieces. No carry, sales, grants, band bonuses, bans or competition. Shop draws use
// pristine copy shares; expected distinct sightings and cumulative purchase capacity are NOT roll guarantees.
function accessSchedule(gd, operators) {
  let level = 1, upgraded = 1, budget = 0;
  const missed = new Map(operators.map(c => [c.id, 1])), seen = new Map(operators.map(c => [c.id, 0]));
  const reserve = Math.min(...operators.map(c => c.cost), Infinity);
  return Array.from({ length: gd.lastRound }, (_, i) => {
    const round = i + 1, income = gd.income(round);
    const price = Math.max(0, (gd.upgradeBase(level) ?? Infinity) - (round - upgraded));
    const canUpgrade = level < gd.maxShopLevel && price <= income - reserve;
    const upgrade = canUpgrade ? price : 0;
    if (canUpgrade) { level++; upgraded = round; }
    const refresh = income - upgrade >= gd.refreshPrice ? gd.refreshPrice : 0;
    budget += Math.max(0, income - upgrade - refresh);
    const eligible = operators.filter(c => c.tier <= level), total = eligible.reduce((n, c) => n + gd.poolCopies(c.id), 0);
    const draws = gd.shopSlots(level).chess * (refresh || gd.refreshPrice === 0 ? 2 : 1);
    for (const c of eligible) {
      const p = total ? gd.poolCopies(c.id) / total : 0;
      missed.set(c.id, missed.get(c.id) * (1 - p) ** draws);
      seen.set(c.id, seen.get(c.id) + draws * p);
    }
    return { round, level, purchaseBudget: budget, distinct: Object.fromEntries([...missed].map(([id, p]) => [id, 1 - p])),
      encounters: Object.fromEntries(seen) };
  });
}

// [ASSUMED] Maintainer 2026-10-19 tempo: unlock T2/3/4/5/6 by R3/5/7/10/13 when affordable.
// Cost/income/discounts are data, deadlines are advice. At an access deadline skip the usual cheapest-piece
// reserve instead of delaying the upgrade; no EXP, sales, grants, carried funds or guaranteed rolls are assumed.
function recommendedSchedule(gd, operators) {
  let level = 1, upgraded = 1;
  const cheapest = Math.min(...operators.map(c => c.cost), Infinity);
  return Array.from({ length: gd.lastRound }, (_, i) => {
    const round = i + 1, target = round < 3 ? 1 : round < 5 ? 2 : round < 7 ? 3 : round < 10 ? 4 : round < 13 ? 5 : 6;
    const cost = Math.max(0, (gd.upgradeBase(level) ?? Infinity) - (round - upgraded));
    const reserve = [3, 5, 7, 10, 13].includes(round) ? 0 : cheapest;
    const can = level < Math.min(target, gd.maxShopLevel) && cost <= gd.income(round) - reserve;
    if (can) { level++; upgraded = round; }
    return { round, level, upgradeCost: can ? cost : 0, purchaseBudget: gd.income(round) - (can ? cost : 0) };
  });
}

export function buildPlaybook(data, { modeId, community = COMMUNITY } = {}) {
  const gd = new GameData(data, modeId);
  const operators = sorted(gd.visibleChess.map(id => {
    const c = gd.chess(id);
    return { id, name: c.name, tier: c.tier, cost: gd.chessPrice(id), sellPrice: gd.sellPrice(id), poolCopies: gd.poolCopies(id), bonds: c.bonds || [], profession: c.profession,
      dmgType: c.dmgType, canHitFly: c.canHitFly, mergeCopies: gd.mergeCount(id), capabilities: capabilities(c),
      events: operatorEvents(data, c), eliteEvents: operatorEvents(data, gd.chess(c.goldenId)),
      traits: (c.garrisonIds || []).map(id => ({ id, effect: data.garrisons?.[id]?.desc || '' })) };
  }));
  const schedule = accessSchedule(gd, operators), edges = new Map();
  for (const c of operators) for (const [i, a] of c.bonds.entries()) for (const b of c.bonds.slice(i + 1)) {
    const ids = [a, b].sort(), key = ids.join('|');
    if (!edges.has(key)) edges.set(key, { bonds: ids, weight: 0, operators: [] });
    const e = edges.get(key); e.weight += 1 / c.tier; e.operators.push(c.id);
  }
  const graph = [...edges.values()].map(e => ({ ...e, weight: +e.weight.toFixed(4) }))
    .sort((a, b) => b.weight - a.weight || a.bonds.join('|').localeCompare(b.bonds.join('|')));
  const bonds = sorted(Object.entries(data.bonds || {}).map(([id, b]) => {
    const elite = b.countsGoldenOnly || b.countMode === 'BOARD_ALL_CHESS';
    const members = operators.filter(c => elite || c.bonds.includes(id));
    const thresholds = (b.thresholds || []).map(count => {
      const cheapest = members.slice().sort((a, b) => a.cost - b.cost).slice(0, count);
      const cost = cheapest.reduce((n, c) => n + c.cost * (elite ? c.mergeCopies : 1), 0);
      const capacity = b.countMode === 'BOARD_AND_DECK' ? Infinity : gd.deployCap;
      const r = count <= capacity && cheapest.length === count && schedule.find(r => r.purchaseBudget >= cost && members.reduce((n, c) => n +
        (elite ? Math.min(1, Math.max(0, (r.encounters[c.id] - c.mergeCopies + 1) / c.mergeCopies)) : r.distinct[c.id]), 0) >= count);
      return { count, estimatedRound: r ? r.round : null,
        basis: count > capacity ? 'needs capacity/count modifiers' : elite ? 'expected merge encounters; not owned elites' : 'expected distinct sightings and budget' };
    });
    return { id, name: b.name, countMode: b.countMode, eliteOnly: !!elite, noStack: !!b.noStack,
      membersByTier: Object.fromEntries(uniq(members.map(c => c.tier)).sort((a, b) => a - b).map(t => [t, members.filter(c => c.tier === t).map(c => c.id)])),
      thresholds, coverage: Object.fromEntries(['air', 'reveal', 'elementRecovery', 'elementDamage', 'block', 'sustain']
        .map(k => [k, members.filter(c => c.capabilities[k]).map(c => c.id)])),
      pairings: graph.filter(e => e.bonds.includes(id)).slice(0, 5).map(e => ({ id: e.bonds.find(x => x !== id), weight: e.weight, operators: e.operators })) };
  }));
  const bands = sorted(Object.entries(data.bands || {}).filter(([id]) => gd.bandAllowed(id)).map(([id, b]) => bandProfile(id, b, data, gd)));
  const warnings = [], validBond = id => bonds.some(b => b.id === id);
  for (const entry of community.mains || []) {
    const band = bands.find(b => b.id === entry.band);
    if (!band || !validBond(entry.main)) { warnings.push({ kind: 'unavailable-community-main', ...entry }); continue; }
    band.communityMain = entry;
    if (band.bondIds.length && !band.bondIds.includes(entry.main)) warnings.push({ kind: 'main-disagreement', dataBondIds: band.bondIds, ...entry });
  }
  const pairs = (community.pairs || []).filter(e => {
    if (validBond(e.main) && e.subs.every(validBond)) return true;
    warnings.push({ kind: 'unavailable-community-pair', ...e }); return false;
  });
  const builds = (community.builds || []).map(e => {
    // Names/aliases are community evidence; only visible normal IDs become buy targets. Hidden forms remain
    // traceable in records. No fuzzy name matching or invention of a substitute for an absent operator.
    const members = (e.members || []).map(m => {
      const op = operators.find(c => c.name === m.name);
      return { ...m, id: op?.id || null, tier: op?.tier || null, bonds: op?.bonds || [],
        records: Object.values(data.chess || {}).filter(c => !c.isGolden && c.name === m.name).map(c => c.chessId).sort() };
    });
    const coreGroups = (e.requiredRoles || []).map(role => ({ role, options: members.filter(m => m.role === role && m.id).map(m => m.id) }));
    // Official activity_table act2autochess bond/effect/garrison/item/band records, regenerated in data/*.json.
    // Preserve current parameters beside recipe differences so a changed version never relies on prose alone.
    const mechanics = Object.fromEntries(Object.entries(e.evidence || {}).map(([kind, ids]) => [kind, ids.map(id => {
      const r = data[kind]?.[id];
      return { id, available: !!r, source: `data/${kind}.json:${id}`,
        ...(r ? Object.fromEntries(Object.entries({ desc: r.desc, thresholds: r.thresholds, bb: r.bb, bbStr: r.bbStr, buffs: r.buffs,
          event: r.eventType, giveBondId: r.giveBondId, canGiveBond: r.canGiveBond }).filter(([, value]) => value !== undefined)) : {}) };
    })]));
    return { ...e, ...(e.members ? { members, coreGroups, mechanics } : {}),
      available: e.status !== 'unresolved' && e.bonds.every(validBond) && coreGroups.every(g => g.options.length) };
  });
  return { schema: 'sp-playbook/1', policy: '[ASSUMED] advisory estimates and scores; no guaranteed timing, stock or combat outcome',
    sources: ['docs/AI-STRATEGY.md', source, 'data/chess.json: bonds/tier/price/profession/canHitFly/dmgType/trait/skill/talents/garrisonIds',
      'data/config.json modes/economy; server/match/pool.js; shared/constants.js BOSS_HIT_LIMIT'],
    modeId: gd.modeId, maxShopLevel: gd.maxShopLevel, inactiveBonds: gd.mode.inactiveBondIds || [], operators, bonds, graph, bands,
    cycles: deriveCycles(data, operators, community.builds || []),
    schedule: schedule.map(({ round, level, purchaseBudget }) => ({ round, level, purchaseBudget })),
    recommendedSchedule: recommendedSchedule(gd, operators),
    // [ASSUMED] Historical measurement, not an official deadline or a prediction for different content/modes.
    // No-plan bot from 1ca3921c; botbench solo:HARD,coop4:HARD --seeds 3 --seed 1 --rehearsal 0 --jobs 1.
    legacyReference: ['mode_single_hard', 'mode_multi_hard'].includes(gd.modeId) ? {
      source: 'docs/AI-STRATEGY.md § Advisor economy; measured 2026-10-19, legacy 1ca3921c, seeds 1–3, rehearsal 0',
      config: gd.modeId === 'mode_single_hard' ? 'solo:HARD' : 'coop4:HARD',
      checkpoints: [4, 7, 10, 13].map((round, i) => ({ round,
        meanLevel: (gd.modeId === 'mode_single_hard' ? [2, 3.6667, 5, 6] : [2, 3.9167, 5, 6])[i] })),
      caveat: 'Small vanilla sample, surviving seats only. Re-run botbench for changed content; explain falling behind, never treat it as a hard cap.',
    } : null,
    community: { revision: community.revision, pairs, builds, roles: community.roles || [] }, warnings,
    enemies: sorted(Object.entries(data.enemies || {}).map(([id, e]) => ({ id, types: e.acTypes || [], fly: !!e.isFlyEnemy,
      def: e.stats?.def || 0, res: e.stats?.res || 0, inactiveIn: e.inactiveIn || [] }))),
    factions: Object.values(data.factions?.types || {}).map(f => ({ id: f.type, enemies: f.pool })),
    bosses: sorted(Object.entries(data.bosses || {}).map(([id, b]) => ({ id, enemyKey: b.enemyKey,
      abilities: b.abilities || [], escorts: uniq(Object.values(b.escortsByTemplate || {}).flat().map(e => e.key).filter(Boolean)) }))),
    leaderHitLimit: BOSS_HIT_LIMIT,
    lateRule: 'Final Assault/Hidden Core: ceil(final single-hit damage) >= leaderHitLimit is voided on leaders, not clamped. Prefer repeated sub-limit hits [ASSUMED].',
  };
}
