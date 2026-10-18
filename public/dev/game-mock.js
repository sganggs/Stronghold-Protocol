// Mock harness for the in-match UI (see game-mock.html). Fabricates a 4-player co-op match from the real
// data files and answers `g.*` intents with a small in-browser mock server (buy / sell / move / equip /
// refresh / freeze / level / ready / reward / choice / band …), so drag & drop and every button can be
// exercised. Combat phases stream b.snap / b.ev at 20 Hz through net._emit like the real socket.

import '/js/ui/compat.js';
import { render } from '/vendor/preact.module.js';
import { installDeviceSupport } from '/js/ui/device.js';
import { html, UiHosts } from '/js/ui/components.js';
import { ToastHost, toast } from '/js/ui/toasts.js';
import { ConnectionBanner } from '/js/ui/connBanner.js';
import { GuideHost } from '/js/ui/guide.js';
import { GameScreen } from '/js/screens/game.js';
import { store, emptyMatch, selectRoute } from '/js/store.js';
import { net, NetError } from '/js/net.js';
import { data } from '/js/data.js';
import { installAudio } from '/js/audio.js';
import { settingsStore } from '/js/ui/settings.js';
import { awayStore } from '/js/ui/matchChrome.js';
import { GAME_FILES } from '/js/ui/gameComponents.js';
import { PHASE, GEO } from '/shared/constants.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') === '1';
const VARIANTS = new Set((params.get('variant') || '').split(',').filter(Boolean));
// the match's stage (data/stages.json id): ?stage=act1autochess_m01 boards a stage whose own devices (crates / turrets)
// stand on the prep field — the default act2autochess_m01 keeps its blowers and turrets off it (rows 6 / 8 / 13)
const STAGE_ID = params.get('stage') || 'act2autochess_m01';

// ---- deterministic rng ----------------------------------------------------------------------------------
let seed = 20260927;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const ME = 'p1';
const PLAYERS = [
  { playerId: 'p1', seat: 0, name: '凯尔希', isBot: false, bandId: 'band_bldsk' },
  { playerId: 'ai_2', seat: 1, name: 'AI·华法琳', isBot: true, bandId: 'band_sarkazb' },
  { playerId: 'p3', seat: 2, name: 'Doctor·B', isBot: false, bandId: 'band_amiya' },
  { playerId: 'p4', seat: 3, name: '灰烬', isBot: false, bandId: 'band_amedic' },
];

let uidSeq = 100;
const nextUid = () => ++uidSeq;
let S = null; // mock server state

// ---- builders ------------------------------------------------------------------------------------------------
function visibleChess(tier) {
  return data.list('chess').filter((c) => c.visible && !c.isGolden && (!tier || c.tier === tier));
}
function shopItems() { return data.list('items').filter((i) => !i.isGolden && i.itemType === 'EQUIP' && !i.hideInShop); }

function makeSlot(level) {
  const tier = Math.max(1, Math.min(level, 1 + Math.floor(rnd() * level)));
  const c = pick(visibleChess(tier));
  const base = c.price;
  const r = rnd();
  const price = r < 0.15 ? Math.max(1, base - 1) : r > 0.9 ? base + 1 : base;
  return { kind: 'chess', id: c.chessId, price, basePrice: base, sold: false };
}
function makeItemSlot() {
  const it = pick(shopItems());
  return { kind: 'item', id: it.id, price: it.price, basePrice: it.price, sold: false };
}
function chessPiece(c, golden = false) {
  const id = golden ? (c.goldenId || c.chessId) : c.chessId;
  return { uid: nextUid(), kind: 'chess', id, golden, tier: c.tier, items: [] };
}
function itemPiece(it) { return { uid: nextUid(), kind: 'item', id: it.id, golden: !!it.isGolden, tier: it.tier }; }

// the mock server's bond counts: BOARD distinct members, plus 调和 (maniShip) like server/match/bondsMeta.js — a 调和
// operator on the board adds 1 to every core bond that has a member and marks the entry `harmony: 1` (the server sends it);
// the mode's inactive bonds (标准) are left out, as the server does
function computeBonds(priv) {
  const counts = new Map();
  const seen = new Set();
  const inactive = new Set(data.get('config')?.modes?.[S?.pub?.modeId]?.inactiveBondIds || []);
  for (const p of priv.board) {
    if (p.kind !== 'chess') continue;
    const c = data.lookup('chess', p.id);
    const base = c?.baseId || p.id;
    if (seen.has(base)) continue;
    seen.add(base);
    for (const b of c?.bonds || []) if (!inactive.has(b)) counts.set(b, (counts.get(b) || 0) + 1);
  }
  const harmony = counts.get('maniShip') > 0;
  const out = [];
  for (const [bondId, raw] of counts) {
    const b = data.lookup('bonds', bondId);
    const plus = harmony && b?.isCore ? 1 : 0;
    const count = raw + plus;
    const thresholds = b?.thresholds || [2];
    let tier = 0;
    for (const t of thresholds) if (count >= t) tier++;
    const layers = S?.layers?.[bondId] ?? (tier ? Math.floor(rnd() * 40) + 4 : Math.floor(rnd() * 6));
    if (S) S.layers[bondId] = layers;
    out.push({ bondId, count, active: tier > 0, tier, layers, ...(plus ? { harmony: plus } : {}), thresholds, countsHand: !!b?.countsHand });
  }
  return out.sort((a, b) => (b.active - a.active) || (b.layers - a.layers));
}

function refreshPrivate() {
  const p = S.priv;
  p.deployCount = p.board.filter((x) => x.kind === 'chess').length;
  p.bonds = computeBonds(p);
  p.canReady = !p.personalChoice && !p.temp.some(Boolean);
  const upg = [5, 8, 11, 12, 13];
  p.shop.maxLevel = 6;
  if (p.shop.upgradePrice == null) p.shop.upgradePrice = upg[p.shop.level - 1] ?? 0;
  p.shop.refreshPrice = p.shop.freeRefreshes > 0 ? 0 : 1;
  store.patch('match', { private: JSON.parse(JSON.stringify(p)) });
  const me = S.pub.players.find((x) => x.playerId === ME);
  if (me) { me.bonds = p.bonds; me.boardCount = p.deployCount; me.lp = p.lp; me.ready = p.ready; if (S.pub.phase === PHASE.PREP) me.status = p.ready ? 'ready' : 'acting'; }
  pushPublic();
}
function pushPublic() {
  S.pub.serverNow = Date.now();
  store.patch('match', { public: JSON.parse(JSON.stringify(S.pub)) });
}

function buildState() {
  uidSeq = 100;
  seed = 20260927;
  const stage = data.lookup('stages', STAGE_ID) || data.lookup('stages', 'act2autochess_m01');
  const melee = stage.deployTiles.normal.melee.slice();
  const ranged = stage.deployTiles.normal.rangedOnly.slice();
  const bonds = data.list('bonds');
  const core = shuffle(bonds.filter((b) => b.isCore && b.weight > 0)).slice(0, 3).map((b) => b.bondId);
  const addon = shuffle(bonds.filter((b) => !b.isCore && b.weight > 0)).slice(0, 4).map((b) => b.bondId);
  const disabled = new Set([...core, ...addon]);
  const banned = visibleChess().filter((c) => c.bonds.length && c.bonds.every((b) => disabled.has(b))).map((c) => c.chessId);
  const pool = visibleChess().filter((c) => !banned.includes(c.chessId));

  // board: 7 units on legal tiles
  const board = [];
  const used = new Set();
  const preferBond = pool.filter((c) => c.bonds.includes('yanShip') || c.bonds.includes('preciShip'));
  const lineup = shuffle(preferBond).slice(0, 5).concat(shuffle(pool).slice(0, 4));
  for (const c of lineup) {
    if (board.length >= 7) break;
    const tiles = c.position === 'MELEE' ? melee : [...ranged, ...melee];
    const t = tiles.find((x) => !used.has(`${x[0]},${x[1]}`));
    if (!t) continue;
    used.add(`${t[0]},${t[1]}`);
    const golden = board.length === 1;
    const piece = { ...chessPiece(c, golden), row: t[0], col: t[1] };
    if (board.length === 0) piece.items = [{ uid: nextUid(), id: shopItems()[3].id }, { uid: nextUid(), id: shopItems()[9].id }];
    if (board.length === 2) piece.items = [{ uid: nextUid(), id: shopItems()[5].id }];
    board.push(piece);
  }
  const hand = new Array(GEO.HAND_SIZE).fill(null);
  const hc = shuffle(pool).slice(0, 5);
  hand[9] = chessPiece(hc[0]);
  hand[8] = chessPiece(hc[1]);
  hand[7] = chessPiece(board[3] ? data.lookup('chess', board[3].id) : hc[2]); // a merge pair
  hand[6] = chessPiece(hc[3], true);
  hand[5] = itemPiece(shopItems()[12]);
  hand[4] = itemPiece(shopItems()[20]);
  const tokenOwner = data.list('tokens').find((t) => t.tokenId === 'token_10028_vigil_wolf');
  if (tokenOwner) hand[3] = { uid: nextUid(), kind: 'token', id: tokenOwner.tokenId, golden: false, count: 2 };
  const temp = new Array(GEO.TEMP_SIZE).fill(null);
  if (VARIANTS.has('temp')) { temp[0] = chessPiece(hc[4]); temp[1] = itemPiece(shopItems()[2]); }

  const level = 4;
  const slots = [];
  for (let i = 0; i < 5; i++) slots.push(makeSlot(level));
  slots[2].sold = true;
  // make one card complete a merge
  if (board[4]) { const c4 = data.lookup('chess', board[4].id); slots[0] = { kind: 'chess', id: c4.chessId, price: c4.price, basePrice: c4.price, sold: false }; hand[2] = chessPiece(c4); }
  slots.push(makeItemSlot());

  const enemies = data.list('enemies');
  const byRank = (r) => enemies.filter((e) => e.rank === r && !e.key.includes('template'));
  // m.private.nextEnemies (server/match/waves.js previewOf): one entry per spawn action, in spawn order
  const flyOf = (e) => e.stats?.motion === 'FLY' || !!e.isFlyEnemy;
  const nextEnemies = [
    ...shuffle(byRank('NORMAL')).slice(0, 4).map((e, i) => ({ enemyKey: e.key, count: [8, 6, 4, 3][i], gate: i % 2 ? 'upper' : 'lower', t: [3, 5, 12, 15][i], fly: flyOf(e), elite: false, boss: false, source: 'wave', tag: null })),
    ...shuffle(byRank('ELITE')).slice(0, 2).map((e, i) => ({ enemyKey: e.key, count: 1, gate: i ? 'upper' : 'lower', t: 18 + i * 6, fly: flyOf(e), elite: true, boss: false, source: 'wave', tag: null })),
    (() => { const e = pick(byRank('ELITE')); return { enemyKey: e.key, count: 1, gate: 'lower', t: 20, fly: flyOf(e), elite: true, boss: false, source: 'bounty', tag: 'bounty' }; })(),
  ].sort((a, b) => a.t - b.t);

  const priv = {
    playerId: ME, seat: 0, alive: !VARIANTS.has('dead'), lp: 24, funds: 13, bandId: 'band_bldsk', ready: false, canReady: true, personalChoice: null,
    shop: { level, maxLevel: 6, upgradePrice: 9, refreshPrice: 1, freeRefreshes: 0, frozen: VARIANTS.has('frozen'), slots, rewardOffer: null },
    hand, temp, board, deployCap: 8, deployCount: 0, bonds: [],
    effects: [
      { id: 'aceffect_band_21', name: '重点监护', desc: data.lookup('bands', 'band_bldsk')?.descRaw || '', iconKind: 'band', iconId: 'band_bldsk' },
      { id: 'allybuff_select_5', name: '补给', desc: '获得<@ba.vup>2</>次免费刷新机会，若存在其他队友则他们也获得', iconKind: 'team', iconId: 'icon_team_buff', counter: 2 },
      { id: 'enemyeffect_3', name: '悬赏·飞行I', desc: '为自身<@ba.vup>下场作战</>添加1只悬赏敌人，将其击倒者获得<@ba.vup>1</>资金', iconKind: 'choice', iconId: 'icon_player_buff', counter: 1 },
    ],
    nextEnemies,
    stats: { dmgDealt: 184230, kills: 96, leaks: 3, gold: 58, refreshes: 11, merges: 3 },
  };
  if (VARIANTS.has('loadout')) priv.loadout = mockLoadout(board, slots);
  if (VARIANTS.has('reward')) {
    priv.shop.rewardOffer = { tier: 5, slots: shuffle(visibleChess(5)).slice(0, 3).map((c) => ({ kind: 'chess', id: c.chessId, price: 0, sold: false })) };
  }

  const players = PLAYERS.map((p, i) => ({
    ...p, connected: i !== 3 || true, alive: true, lp: [24, 31, 18, 5][i], shopLevel: [4, 5, 3, 4][i], boardCount: [7, 8, 6, 7][i],
    ready: [false, true, false, false][i], bonds: [], fieldId: `n:${p.playerId}`, status: ['acting', 'ready', 'acting', 'acting'][i],
  }));
  players[3].connected = false;
  // boss-round prep (最终攻势 prep on the own half of the boss field): `boss` = the left half; `bossR` = seats swapped so
  // I am the second of the first pair → the mirrored right half (server pairPlayers: alive players by seat, in pairs)
  if (VARIANTS.has('bossR')) { players[0].seat = 1; players[1].seat = 0; }
  if (VARIANTS.has('dead')) { players[0].alive = false; players[0].status = 'dead'; players[0].lp = 0; priv.lp = 0; }

  const pub = {
    phase: PHASE.PREP, round: 6, lastRound: 14, bossRound: 14, hiddenRound: 15, deadline: Date.now() + 74000, serverNow: Date.now(), modeId: 'mode_multi_hard', difficulty: 'HARD',
    stageId: STAGE_ID, factions: ['FLY', 'TIMES', 'SPECIAL'], disabledBonds: [...disabled], bannedChess: banned, bossId: 'boss_5',
    hiddenBossId: 'boss_8', teamLp: null, bossHp: null, draft: null, sp: null, players, fields: [],
  };
  if (VARIANTS.has('boss') || VARIANTS.has('bossR')) pub.round = pub.bossRound;
  S = { stage, pub, priv, layers: {}, battle: null, pool, requests: [] };
}

/**
 * The 0.1.1 gaps (DESIGN §21.26): `funny` — the match is 标准 (its 本局禁用 bonds: 5 of 变形同构体's 14 pairings off);
 * `morph` — a 变形同构体 in the hand and in the shop's item slot, the first board operator wearing 变形同构体 + 维式重锤 (its
 * card highlights that pairing); `harmony` — 缪尔赛思 (调和) in place of the second board operator, so the core bonds with a
 * member count +1 and carry `harmony` (the bond popup's 调和 row).
 */
function applyGapVariants() {
  if (VARIANTS.has('funny')) { S.pub.modeId = 'mode_multi_funny'; S.pub.difficulty = 'FUNNY'; }
  if (VARIANTS.has('morph')) {
    const iso = data.list('items').find((i) => i.canGiveBond && !i.isGolden);
    const hammer = data.list('items').filter((i) => i.giveBondId === 'victoriaShip' && !i.isGolden).sort((a, b) => a.tier - b.tier)[0];
    if (iso) {
      S.priv.hand[5] = itemPiece(iso);
      const slot = S.priv.shop.slots.findIndex((s) => s && s.kind === 'item');
      if (slot >= 0) S.priv.shop.slots[slot] = { kind: 'item', id: iso.id, price: iso.price, basePrice: iso.price, sold: false };
      if (S.priv.board[0] && hammer) S.priv.board[0].items = [{ uid: nextUid(), id: iso.id }, { uid: nextUid(), id: hammer.id }];
    }
  }
  if (VARIANTS.has('harmony')) {
    const mani = visibleChess().find((c) => c.bonds.includes('maniShip'));
    const at = S.priv.board[1];
    if (mani && at) S.priv.board[1] = { ...chessPiece(mani), row: at.row, col: at.col };
  }
}

/**
 * `loadout` variant (DESIGN §16): the first board operator and the first shop card fight with a non-default skill, the
 * elite board operator with its module unequipped (m.private.loadout). Data without `skills[]` / `modules[]` (before the
 * loadout data build) gets a stand-in second skill / module list on those records — mock only.
 */
function mockLoadout(board, slots) {
  const out = {};
  const withSkills = (c) => {
    if (!c) return null;
    const recs = [c, c.goldenId ? data.lookup('chess', c.goldenId) : null, c.baseId && c.baseId !== c.chessId ? data.lookup('chess', c.baseId) : null].filter(Boolean);
    for (const r of recs) {
      if (Array.isArray(r.skills) && r.skills.length > 1) continue;
      const d = r.skill || {};
      const alt = { ...d, index: (d.index ?? 0) + 1, skillId: `${d.skillId || 'sk'}_mockalt`, iconId: d.iconId || r.assets?.skillIcon || d.skillId, name: `${d.name || '技能'}·改`, isDefault: false,
        desc: '（模拟）调配的第二技能：攻击力+60%，持续 20 秒', descRaw: '（模拟）调配的第二技能：攻击力<@ba.vup>+60%</>，持续 20 秒', spCost: 30, initSp: 10, duration: 20 };
      r.skills = [{ ...d, isDefault: true }, alt];
    }
    const base = c.isGolden ? data.lookup('chess', c.baseId) || c : c;
    const alt = (base.skills || []).find((x) => x && !x.isDefault);
    return alt ? { base, alt } : null;
  };
  const b0 = board[0] ? data.lookup('chess', board[0].id) : null;
  const s0 = slots.find((x) => x && x.kind === 'chess' && !x.sold);
  for (const c of [b0, s0 ? data.lookup('chess', s0.id) : null]) {
    const r = withSkills(c);
    if (r) out[r.base.chessId] = { skill: r.alt.index, module: r.base.goldenId ? 'none' : null };
  }
  const gold = board.find((p) => p.golden);
  const g = gold ? data.lookup('chess', gold.id) : null;
  if (g && g.isGolden) {
    const r = withSkills(g);
    if (g.module && !Array.isArray(g.modules)) g.modules = [{ uniEquipId: g.module.id, name: g.module.name, typeName: g.module.type, isDefault: true }];
    if (r) out[r.base.chessId] = { skill: r.alt.index, module: 'none' };
  }
  return out;
}

// ---- phases ---------------------------------------------------------------------------------------------------------
function setPhase(phase, variant) {
  stopBattle();
  buildState();
  for (const v of (variant || '').split(',').filter(Boolean)) VARIANTS.add(v);
  if (VARIANTS.has('reward') && !S.priv.shop.rewardOffer) S.priv.shop.rewardOffer = { tier: 5, slots: shuffle(visibleChess(5)).slice(0, 3).map((c) => ({ kind: 'chess', id: c.chessId, price: 0, sold: false })) };
  if (VARIANTS.has('temp') && !S.priv.temp.some(Boolean)) { S.priv.temp[0] = chessPiece(pick(S.pool)); S.priv.temp[1] = itemPiece(shopItems()[2]); }
  applyGapVariants();
  const pub = S.pub;
  pub.phase = phase;
  store.set({ match: emptyMatch(), ticker: [], emotes: [] });
  awayStore.set({ away: false });
  const solo = VARIANTS.has('solo');
  if (solo) {
    pub.players = pub.players.slice(0, 1);
    pub.modeId = 'mode_single_hard';
    store.set({ room: { ...store.get().room, mode: 'solo' } });
  } else {
    store.set({ room: { ...store.get().room, mode: 'coop' } });
  }
  switch (phase) {
    case PHASE.INFO_CHECK:
      pub.round = 0; pub.deadline = Date.now() + 21000;
      pub.players.forEach((p, i) => { p.ready = i === 1 || i === 2; p.status = p.ready ? 'ready' : 'deciding'; p.bandId = null; p.lp = 0; });
      S.priv.bandId = null;
      break;
    case PHASE.BAND_DRAFT:
      pub.round = 0; pub.deadline = Date.now() + 9000;
      pub.players.forEach((p) => { p.bandId = null; p.status = 'deciding'; p.ready = false; });
      S.priv.bandId = null;
      if (!solo) {
        pub.draft = { order: ['p3', 'p1', 'ai_2', 'p4'], turn: 'p1', picks: { p3: 'band_sarkazb' }, skipsLeft: { p1: 1, p3: 1, ai_2: 1, p4: 1 }, turnDeadline: Date.now() + 9000 };
        pub.players.find((p) => p.playerId === 'p3').bandId = 'band_sarkazb';
      } else pub.deadline = 0;
      break;
    case PHASE.BATTLE_CHECK:
      pub.round = 0; pub.deadline = Date.now() + 3000;
      break;
    case PHASE.SP_DRAFT: {
      pub.round = 9; pub.deadline = Date.now() + 14000;
      const fam = VARIANTS.has('supply') ? 'supply' : VARIANTS.has('shop') ? 'shop' : VARIANTS.has('tactic') ? 'tactic' : 'bounty';
      const ch = data.get('choices');
      let cards;
      if (fam === 'supply') cards = shuffle(shopItems().filter((i) => i.tier >= 3)).slice(0, 6).map((i) => ({ itemId: i.id }));
      // the official 机密商店 of match 8 R11 (test/fixtures/official-bounty-drafts.json): the same item twice
      else if (fam === 'shop') cards = ['变形同构体', '盟约之币', '商业包装方案', '变形同构体', '天马之盔', '双模机械臂'].map((n) => ({ itemId: shopItems().find((i) => i.name === n).id }));
      // the official 战术决策 of match 7 R11 (test/fixtures/official-bounty-drafts.json): the same card twice
      else if (fam === 'tactic') cards = ['补给', '补给', '谢拉格驰援', '列装', '莫斯提马的盟誓', '升华'].map((n) => ({ effectId: ch.cards.tactic.find((t) => t.name === n).effectId }));
      else cards = shuffle(ch.cards.bounty.filter((b) => b.draft !== false)).slice(0, 6).map((b) => ({ effectId: b.effectId }));
      if (solo) { cards = cards.slice(0, 3); pub.deadline = 0; }
      pub.sp = { family: fam, cards, order: solo ? ['p1'] : ['p4', 'p1', 'ai_2', 'p3'], turn: solo ? 'p1' : 'p1', picks: solo ? {} : { p4: 2 }, untimed: solo };
      pub.players.forEach((p) => { p.status = p.playerId === 'p4' ? 'ready' : 'deciding'; });
      break;
    }
    case PHASE.COMBAT: case PHASE.UNITE: case PHASE.SETTLE: case PHASE.FINAL_ASSAULT: case PHASE.HIDDEN_CORE:
      startCombat(phase);
      break;
    case PHASE.RESULT:
      pub.round = 14;
      // late: the RESULT phase first, m.result a moment later (as from the server)
      if (VARIANTS.has('late')) setTimeout(() => store.patch('match', { result: buildResult(!VARIANTS.has('defeat')) }), 800);
      else store.patch('match', { result: buildResult(!VARIANTS.has('defeat')) });
      break;
    default:
      break;
  }
  refreshPrivate();
  applyUiVariants();
}

// m.result in the exact shape of server/match/results.js buildResult (title = config.titles record, stats.gold = spent)
function buildResult(victory) {
  const titles = (data.get('config')?.titles || []).filter((t) => victory || !t.onlyOnWin);
  const pickTitle = (i) => { const t = titles[[0, 3, 5, 2][i] % Math.max(1, titles.length)]; return t ? { id: t.id, name: t.name, picId: t.picId, text: t.text } : null; };
  return {
    victory, roundsPassed: victory ? 14 : 11, hiddenReached: false, hiddenCleared: false, reason: victory ? 'victory' : 'defeat',
    bossId: 'boss_5', hiddenBossId: 'boss_8', difficulty: 'HARD', modeId: 'mode_multi_hard', stageId: S.pub.stageId, durationMs: 52 * 60000,
    players: S.pub.players.map((p, i) => ({
      playerId: p.playerId, seat: p.seat, name: p.name, isBot: p.isBot, left: false, alive: i !== 3, victory, lp: [12, 12, 12, 0][i], bandId: p.bandId,
      roundsPassed: i === 3 ? 9 : victory ? 14 : 11, eliminatedRound: i === 3 ? 10 : null, title: pickTitle(i),
      lineup: shuffle(S.pool).slice(0, 8 + (i % 2)).map((c, k) => ({ id: k < 3 ? c.goldenId : c.chessId, golden: k < 3, tier: c.tier, row: 9 + (k % 4), col: 2 + k, items: [] })),
      bonds: shuffle(data.list('bonds')).slice(0, 4).map((b, k) => ({ bondId: b.bondId, count: 3 - (k % 3), layers: [359, 136, 34, 12][k], active: k < 3, tier: k < 3 ? 1 : 0 })),
      stats: {
        dmgDealt: [2310000, 1720000, 980000, 402000][i], kills: [412, 388, 301, 150][i], leaks: [3, 6, 9, 31][i], gold: [188, 164, 231, 90][i],
        refreshes: [22, 18, 30, 8][i], merges: [7, 5, 9, 2][i], itemsEquipped: [9, 6, 11, 3][i], bossDamage: victory ? [912000, 610000, 240000, 0][i] : 0,
        activatedLayers: [541, 402, 377, 120][i], lpLost: [16, 19, 12, 24][i], perfectRounds: [11, 12, 9, 4][i],
      },
      trophies: i === 3 ? 1 : 5, reward: i === 3 ? 170 : 425,
    })),
  };
}

// ---- combat simulation ------------------------------------------------------------------------------------------------
function stopBattle() { if (S?.battle?.timer) clearInterval(S.battle.timer); if (S) S.battle = null; }

function startCombat(phase) {
  const pub = S.pub;
  const boss = phase === PHASE.FINAL_ASSAULT || phase === PHASE.HIDDEN_CORE;
  pub.round = boss ? (phase === PHASE.HIDDEN_CORE ? 15 : 14) : 6;
  pub.deadline = boss ? Date.now() + 95000 : Date.now() + 40000;
  // boss rounds (server Match: deadline = the level's 120 s countdown, overtimeAt = the drain start at 150 s):
  // `overtime` = the level time ran out, the drain starts in 18 s; `drain` = draining for 7 s
  if (boss) {
    const now = Date.now();
    if (VARIANTS.has('drain')) { pub.deadline = now - 37000; pub.overtimeAt = now - 7000; }
    else if (VARIANTS.has('overtime')) { pub.deadline = now - 12000; pub.overtimeAt = now + 18000; }
    else pub.overtimeAt = pub.deadline + 30000;
  }
  // solo pause (g.pause → m.public.paused)
  if (VARIANTS.has('paused')) pub.paused = true;
  pub.players.forEach((p, i) => { p.status = phase === PHASE.SETTLE ? 'done' : i === 1 ? 'done' : 'combat'; });
  if (phase === PHASE.UNITE) { pub.players[1].status = 'helping'; pub.players[0].status = 'helping'; }
  // 联防 live counter (user playtest #6 item 7; server m.public unite / players[].uniteLeft / pendingLp): ?variant=leaker
  // — you and 灰烬 let enemies through, the AI and Doctor·B help; otherwise Doctor·B leaked. The first leaker's count of
  // enemies still standing (uncapped: the ×N tag) falls with every kill below.
  const leakMock = phase === PHASE.UNITE && VARIANTS.has('leaker');
  const leftOf = (pid, n) => { const p = pub.players.find((x) => x.playerId === pid); if (p) { p.uniteLeft = n; p.pendingLp = Math.min(10, n) || undefined; } };
  if (phase === PHASE.UNITE) {
    pub.unite = leakMock ? { helpers: ['ai_2', 'p3'], leakers: ['p1', 'p4'] } : { helpers: ['p1', 'ai_2'], leakers: ['p3'] };
    if (leakMock) { leftOf('p1', 13); leftOf('p4', 3); pub.players[0].status = 'done'; pub.players[2].status = 'helping'; } else leftOf('p3', 12);
  }
  // the result box after a 联防 (server settle → m.public.uniteResult, ui/gameLogic/phases.js uniteResultBox; GitHub #235):
  // ?phase=SETTLE&variant=unite — you (p1) leaked and the helpers stopped every enemy: nobody paid → 全员无伤！;
  // `unite,through` — 3 got through and you were charged 3 → 生命值减少 −3; `unite,through,helper` — you HELPED, a
  // teammate leaked and paid → the official title alone (全员无伤！ would be false for that teammate); `unite,dead` — you
  // were eliminated before the round, so `losses` (alive players only, like the server) does not list you → no box.
  // Without `unite` the SETTLE view has no uniteResult: the round's own battle result box takes over (battleResultBox).
  if (phase === PHASE.SETTLE && VARIANTS.has('unite')) {
    const helpers = ['ai_2', 'p3'], leakers = ['p1', 'p4'];
    pub.uniteResult = VARIANTS.has('through')
      ? { through: 3, helpers, leakers, losses: { p1: 3, p4: 0, ai_2: 0, p3: 0 } }
      : { through: 0, helpers, leakers, losses: { p1: 0, p4: 0, ai_2: 0, p3: 0 } };
    if (VARIANTS.has('helper')) pub.uniteResult = { through: 3, helpers: ['p1', 'ai_2'], leakers: ['p3'], losses: { p1: 0, ai_2: 0, p3: 4, p4: 0 } };
    if (VARIANTS.has('dead')) delete pub.uniteResult.losses.p1;
  }
  const countKill = () => {
    if (phase !== PHASE.UNITE) return;
    const pid = leakMock ? 'p1' : 'p3';
    const p = S.pub.players.find((x) => x.playerId === pid);
    if (p && p.uniteLeft > 0) { leftOf(pid, p.uniteLeft - 1); pushPublic(); }
  };
  if (VARIANTS.has('done')) pub.players[0].status = 'done';
  let fields;
  let rect;
  let kind;
  if (boss) {
    kind = phase === PHASE.HIDDEN_CORE ? 'hidden' : 'boss';
    fields = pub.players.length === 1 ? [{ fieldId: 'b1', kind, players: ['p1'], live: true }]
      : [{ fieldId: 'b1', kind, players: ['p1', 'ai_2'], live: true }, { fieldId: 'b2', kind, players: ['p3', 'p4'], live: true }];
    rect = { ...GEO.BOSS_RECT };
    pub.teamLp = 61;
    pub.bossHp = { hp: 1_240_000, max: 1_990_000 };
  } else if (phase === PHASE.UNITE) {
    kind = 'unite';
    fields = [{ fieldId: 'u', kind: 'unite', players: ['p1', 'ai_2'], live: true }];
    rect = { ...GEO.UNITE_RECT };
  } else {
    kind = 'normal';
    fields = pub.players.map((p) => ({ fieldId: `n:${p.playerId}`, kind: 'normal', players: [p.playerId], live: true }));
    rect = { ...GEO.NORMAL_RECT };
  }
  pub.fields = fields;
  // like the server's m.public players[].fieldId (Match.fieldOf): the field each player fights on, null without one
  for (const p of pub.players) p.fieldId = fields.find((f) => f.players.includes(p.playerId))?.fieldId ?? null;
  const fieldRef = { id: fields[0].fieldId };
  const fieldId = fieldRef.id;
  const units = [];
  let id = 1;
  const board = S.priv.board;
  for (const p of board) {
    const c = data.lookup('chess', p.id);
    const colOff = 0;
    const r = boss ? p.row - 7 : p.row;
    units.push({ id: id++, kind: 'op', side: 'ally', ownerId: ME, defId: p.id, name: c?.name, tier: c?.tier, golden: !!p.golden, spine: c?.charId, avatar: c?.assets?.avatar, x: p.col + colOff, y: r, facing: 1, maxHp: c?.stats?.maxHp || 1000, uid: p.uid });
  }
  if (kind !== 'normal') {
    for (const p of board.slice(0, 5)) {
      const c = data.lookup('chess', pick(S.pool).chessId);
      const r = boss ? p.row - 7 : p.row;
      // 联防: the second helper's board on the other half, shifted 8 columns (server unite.js); boss pairs: mirrored
      const x = kind === 'unite' ? p.col + 8 : 20 - p.col;
      units.push({ id: id++, kind: 'op', side: 'ally', ownerId: 'ai_2', defId: c.chessId, name: c.name, tier: c.tier, golden: false, spine: c.charId, avatar: c.assets.avatar, x, y: r, facing: kind === 'unite' ? 1 : -1, maxHp: c.stats.maxHp });
    }
  }
  const enemyKeys = S.priv.nextEnemies.map((e) => e.enemyKey);
  const enemies = [];
  const nEnemy = boss ? 10 : 12;
  for (let i = 0; i < nEnemy; i++) {
    const key = enemyKeys[i % enemyKeys.length];
    const e = data.lookup('enemies', key);
    const y = boss ? [2, 5, 3][i % 3] : [9, 12][i % 2];
    const startX = boss ? (i % 2 ? 17 : 3) : kind === 'unite' ? 18 : 10; // escaped_multi: the right half's gates
    enemies.push({ id: id++, kind: 'enemy', side: 'enemy', ownerId: ME, defId: key, name: e?.name, spine: key, avatar: key, x: startX + rnd() * 0.3, y, facing: -1, maxHp: e?.stats?.maxHp || 3000, hp: e?.stats?.maxHp || 3000, spawnAt: i * 0.9, dir: boss ? (i % 2 ? -1 : 1) : -1, dead: false });
  }
  if (boss) {
    const bossRec = data.lookup('bosses', phase === PHASE.HIDDEN_CORE ? 'boss_8' : 'boss_5');
    const e = data.lookup('enemies', bossRec.enemyKey);
    enemies.push({ id: id++, kind: 'enemy', side: 'enemy', ownerId: ME, defId: bossRec.enemyKey, name: bossRec.name, spine: bossRec.enemyKey, avatar: bossRec.enemyKey, x: 10, y: 3, facing: -1, maxHp: e?.stats?.maxHp || 1e5, hp: (e?.stats?.maxHp || 1e5) * 0.62, spawnAt: 0, dir: 0, boss: true, dead: false });
  }
  // ?variant=devices — the stage's crates inside the rect are device UNITS (kind 'device', defId = the device key), as in the
  // real sim: absent from the field meta (a battle shown from its start), they come in with 'spawn' events once it steps;
  // __MOCK__.breakDevice(i) destroys one (hp 0 for a second in the snapshots, then gone)
  const deviceUnits = !VARIANTS.has('devices') ? [] : (S.stage.devices || [])
    .filter((d) => d.role === 'crate' && (typeof d.active === 'boolean' ? d.active : !d.hidden)
      && d.pos[0] >= rect.r0 && d.pos[0] <= rect.r1 && d.pos[1] >= rect.c0 && d.pos[1] <= rect.c1)
    .map((d) => ({ id: id++, kind: 'device', side: 'ally', ownerId: null, defId: d.key, name: d.name, x: d.pos[1], y: d.pos[0], facing: 1, maxHp: 100, hp: 100, deadAt: null }));
  // every field — 联防 too — is fought on the round's battlefield (server unite.js; 0.2.0's escaped-level map withdrawn)
  const field = { fieldId, kind, rect, stageId: pub.stageId, units: units.map((u) => ({ ...u })) };
  store.patch('match', { field });
  const allyState = units.map((u) => ({ ...u, hp: u.maxHp * (0.55 + rnd() * 0.45), sp: rnd() * 20, spMax: 20 }));
  const t0 = performance.now();
  const total = enemies.length;
  let killed = phase === PHASE.SETTLE ? total : 0;
  if (phase === PHASE.SETTLE) enemies.forEach((e) => { e.dead = true; });
  const spawned = new Set();
  let pausedFor = 0;
  let pausedSince = null;
  const tick = () => {
    // a paused solo battle stands still (the server's runner stops the clock too)
    if (S.pub.paused) { if (pausedSince == null) pausedSince = performance.now(); return; }
    if (pausedSince != null) { pausedFor += performance.now() - pausedSince; pausedSince = null; }
    const t = (performance.now() - t0 - pausedFor) / 1000 + 4;
    const ev = [];
    for (const d of deviceUnits) if (!spawned.has(d.id)) { spawned.add(d.id); ev.push(['spawn', { ...d }]); }
    for (const e of enemies) {
      if (e.dead || t < e.spawnAt) continue;
      if (!spawned.has(e.id)) { spawned.add(e.id); ev.push(['spawn', { ...e }]); }
      if (e.dir) e.x = Math.max(rect.c0 + 2.2, Math.min(rect.c1 - 2, e.x + e.dir * 0.035));
    }
    // attacks
    const liveEnemies = enemies.filter((e) => !e.dead && t >= e.spawnAt);
    for (const a of allyState) {
      if (!liveEnemies.length || rnd() > 0.2) continue;
      const tgt = liveEnemies[Math.floor(rnd() * liveEnemies.length)];
      const dmg = Math.round(200 + rnd() * 700);
      tgt.hp -= e2boss(tgt) ? dmg * 3 : dmg;
      ev.push(['atk', a.id, tgt.id, 'arrow'], ['dmg', tgt.id, dmg, rnd() < 0.3 ? 'arts' : 'phys']);
      a.sp = (a.sp + 1) % a.spMax;
      if (tgt.hp <= 0 && !tgt.boss && !tgt.dead) { tgt.dead = true; killed++; ev.push(['die', tgt.id]); countKill(); }
    }
    if (rnd() < 0.15) { const a = pick(allyState); a.hp = Math.min(a.maxHp, a.hp + 180); ev.push(['heal', a.id, 180]); }
    const snapUnits = [
      ...allyState.map((a) => [a.id, a.x, a.y, a.hp, a.maxHp, a.sp, a.spMax, a.sp > 15 ? 16 : 0, 2]),
      ...deviceUnits.filter((d) => d.deadAt == null || t - d.deadAt < 1).map((d) => [d.id, d.x, d.y, Math.max(0, d.hp), d.maxHp, 0, 0, 0, 2]),
      ...enemies.filter((e) => !e.dead && t >= e.spawnAt).map((e) => [e.id, e.x, e.y, Math.max(1, e.hp), e.maxHp, 0, 0, e.y === 5 ? 512 : 0, e.dir ? 1 : 2]),
    ];
    // wire frames exactly like server/match/fields.js: `t` is the frame type, game time travels as `gt`; b.ev first
    const snap = { t: 'b.snap', fieldId: fieldRef.id, gt: t, units: snapUnits, dp: Math.min(99, 10 + Math.floor(t)), killed, total };
    if (boss) snap.boss = { hp: S.pub.bossHp.hp, max: S.pub.bossHp.max };
    if (ev.length) net._emit('b.ev', { t: 'b.ev', fieldId: fieldRef.id, gt: t, ev });
    net._emit('b.snap', snap);
  };
  const e2boss = (e) => !!e.boss;
  S.battle = { timer: setInterval(tick, 50), fieldRef, devices: deviceUnits, hurtDevice: (i = 0, dmg = 100) => {
    const d = deviceUnits[i];
    if (!d || d.deadAt != null) return false;
    d.hp = Math.max(0, d.hp - dmg);
    if (d.hp <= 0) { d.deadAt = (performance.now() - t0 - pausedFor) / 1000 + 4; net._emit('b.ev', { t: 'b.ev', fieldId: fieldRef.id, gt: d.deadAt, ev: [['die', d.id]] }); }
    return true;
  } };
  setTimeout(tick, 60);
}

// ---- mock server --------------------------------------------------------------------------------------------------------
const fail = (code) => { throw new NetError(code); };
function findPiece(uid) {
  const p = S.priv;
  let i = p.board.findIndex((x) => x.uid === uid);
  if (i >= 0) return { area: 'board', i, piece: p.board[i] };
  i = p.hand.findIndex((x) => x && x.uid === uid);
  if (i >= 0) return { area: 'hand', i, piece: p.hand[i] };
  i = p.temp.findIndex((x) => x && x.uid === uid);
  if (i >= 0) return { area: 'temp', i, piece: p.temp[i] };
  return null;
}
function removeAt(loc) {
  const p = S.priv;
  if (loc.area === 'board') p.board.splice(loc.i, 1);
  else if (loc.area === 'hand') p.hand[loc.i] = null;
  else p.temp[loc.i] = null;
}
function freeHandIdx() { for (let i = GEO.HAND_SIZE - 1; i >= 0; i--) if (!S.priv.hand[i]) return i; return -1; }

async function mockRequest(t, f = {}) {
  await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
  if (!S) fail('WRONG_PHASE');
  S.requests.push([t, JSON.parse(JSON.stringify(f ?? {}))]); // E2E: what the UI sent
  const p = S.priv;
  const pub = S.pub;
  const prepOnly = () => { if (pub.phase !== PHASE.PREP) fail('WRONG_PHASE'); if (p.ready && t !== 'g.ready') fail('ALREADY'); };
  switch (t) {
    case 'g.infoReady': { const me = pub.players.find((x) => x.playerId === ME); me.ready = true; me.status = 'ready'; pushPublic(); return {}; }
    case 'g.band': {
      p.bandId = f.bandId; const me = pub.players.find((x) => x.playerId === ME); me.bandId = f.bandId;
      if (pub.draft) { pub.draft.picks[ME] = f.bandId; pub.draft.turn = 'ai_2'; pub.draft.turnDeadline = Date.now() + 12000; }
      refreshPrivate(); return {};
    }
    case 'g.bandSkip': {
      if (!pub.draft) fail('WRONG_PHASE');
      if (pub.draft.skipsLeft?.[ME] === 0) fail('ALREADY');
      pub.draft.order = pub.draft.order.filter((x) => x !== ME).concat(ME); pub.draft.skipsLeft = { ...pub.draft.skipsLeft, [ME]: 0 }; pub.draft.turn = 'ai_2'; pushPublic(); return {};
    }
    case 'g.buy': {
      prepOnly();
      const s = p.shop.slots[f.slot];
      if (!s || s.sold) fail('SOLD_OUT');
      if (s.price > p.funds) fail('NO_FUNDS');
      const idx = freeHandIdx();
      if (idx < 0) fail('HAND_FULL');
      p.funds -= s.price; s.sold = true;
      p.hand[idx] = s.kind === 'item' ? itemPiece(data.lookup('items', s.id)) : chessPiece(data.lookup('chess', s.id));
      refreshPrivate(); return {};
    }
    case 'g.refresh': {
      prepOnly();
      if (p.shop.refreshPrice > p.funds) fail('NO_FUNDS');
      if (p.shop.freeRefreshes > 0) p.shop.freeRefreshes--; else p.funds -= 1;
      const n = p.shop.slots.filter((s) => !s || s.kind !== 'item').length;
      p.shop.slots = [...Array.from({ length: n }, () => makeSlot(p.shop.level)), makeItemSlot()];
      refreshPrivate(); return {};
    }
    case 'g.freeze': prepOnly(); p.shop.frozen = !p.shop.frozen; refreshPrivate(); return {};
    case 'g.levelUp': {
      prepOnly();
      if (p.shop.level >= 6) fail('MAX_LEVEL');
      if (p.shop.upgradePrice > p.funds) fail('NO_FUNDS');
      p.funds -= p.shop.upgradePrice; p.shop.level++; p.shop.upgradePrice = [5, 8, 11, 12, 13][p.shop.level - 1] ?? 0;
      const n = p.shop.level >= 4 ? 5 : 4;
      // the upgrade opens the new slot EMPTY (server/match/player/economy.js _openLevelSlots: a null slot; a refresh fills it)
      while (p.shop.slots.filter((s) => !s || s.kind !== 'item').length < n) p.shop.slots.splice(p.shop.slots.length - 1, 0, null);
      toast(`调度中心等级提升至 ${p.shop.level}`, 'success');
      refreshPrivate(); return {};
    }
    case 'g.sell': {
      prepOnly();
      const loc = findPiece(f.uid); if (!loc) fail('BAD_TARGET');
      if (loc.piece.kind === 'item') fail('BAD_TARGET');
      removeAt(loc); p.funds += 1; refreshPrivate(); return {};
    }
    case 'g.destroy': { prepOnly(); const loc = findPiece(f.uid); if (!loc) fail('BAD_TARGET'); removeAt(loc); refreshPrivate(); return {}; }
    case 'g.move': {
      prepOnly();
      const loc = findPiece(f.uid); if (!loc) fail('BAD_TARGET');
      const to = f.to;
      if (to.area === 'hand') {
        const occ = p.hand[to.idx];
        removeAt(loc);
        if (occ) {
          if (loc.area === 'board') { p.board.push({ ...occ, row: loc.piece.row, col: loc.piece.col }); }
          else if (loc.area === 'hand') p.hand[loc.i] = occ;
          else p.temp[loc.i] = occ;
        }
        const { row, col, dir, ...rest } = loc.piece; // eslint-disable-line no-unused-vars
        p.hand[to.idx] = rest;
      } else {
        // the deploy wheel's facing, like PlayerState.move: top-level dir, else to.dir, else RIGHT (research 09 §1.2)
        const d = ['UP', 'RIGHT', 'DOWN', 'LEFT'].includes(f.dir) ? f.dir : ['UP', 'RIGHT', 'DOWN', 'LEFT'].includes(to.dir) ? to.dir : 'RIGHT';
        const oi = p.board.findIndex((x) => x.row === to.row && x.col === to.col);
        const occ = oi >= 0 ? p.board[oi] : null;
        if (occ && occ.uid === f.uid) { occ.dir = d; refreshPrivate(); return {}; } // re-orient in place
        if (!occ && loc.area !== 'board' && loc.piece.kind === 'chess' && p.board.filter((x) => x.kind === 'chess').length >= p.deployCap) fail('BOARD_FULL');
        if (occ) p.board.splice(oi, 1);
        const locNow = findPiece(f.uid);
        removeAt(locNow);
        if (occ) {
          if (loc.area === 'board') p.board.push({ ...occ, row: loc.piece.row, col: loc.piece.col });
          else { const { row, col, dir, ...rest } = occ; if (loc.area === 'hand') p.hand[loc.i] = rest; else p.temp[loc.i] = rest; } // eslint-disable-line no-unused-vars
        }
        p.board.push({ ...loc.piece, row: to.row, col: to.col, dir: d });
      }
      refreshPrivate(); return {};
    }
    case 'g.equip': {
      // like server PlayerState.equip: a third item replaces the equipped item the dialog picked (replaceUid, which
      // must be one of the target's items), else the oldest; the replaced item is destroyed
      prepOnly();
      const it = findPiece(f.itemUid); const tg = findPiece(f.targetUid);
      if (!it || !tg || tg.piece.kind !== 'chess') fail('BAD_TARGET');
      if (f.replaceUid != null && !(tg.piece.items || []).some((x) => x.uid === f.replaceUid)) fail('BAD_TARGET');
      removeAt(it);
      const target = findPiece(f.targetUid).piece;
      const items = [...(target.items || [])];
      if (items.length >= 2) {
        const i = f.replaceUid != null ? items.findIndex((x) => x.uid === f.replaceUid) : 0;
        items.splice(i >= 0 ? i : 0, 1);
      }
      target.items = [...items, { uid: it.piece.uid, id: it.piece.id }];
      refreshPrivate(); return {};
    }
    case 'g.pause': {
      // solo battles only (server: g.pause {on} → m.public.paused)
      if (S.pub.players.length > 1) fail('WRONG_PHASE');
      if (![PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE].includes(pub.phase)) fail('WRONG_PHASE');
      const now = Date.now();
      if (f.on && !pub.paused) { pub.paused = true; pub.pausedAt = now; }
      else if (!f.on && pub.paused) {
        // the clocks resume where they stopped
        const d = now - (pub.pausedAt || now);
        if (pub.deadline) pub.deadline += d;
        if (pub.overtimeAt) pub.overtimeAt += d;
        pub.paused = false; delete pub.pausedAt;
      }
      pushPublic(); return {};
    }
    case 'g.art': {
      prepOnly(); const it = findPiece(f.itemUid); if (!it) fail('BAD_TARGET');
      if (it.piece.id === 'chess_item_6_03_m') {
        if (p.personalChoice) fail('BAD_TARGET');
        const cards = data.get('choices').cards.bounty.filter((c) => c.payout === 'perfect' && c.rounds < 90).slice(0, 3)
          .map((c) => ({ ...c, kind: 'bounty', id: c.effectId, descRaw: data.lookup('effects', c.effectId)?.descRaw }));
        p.personalChoice = { id: `mock.choice.${nextUid()}`, round: pub.round, sourceItemId: it.piece.id, cards };
      }
      removeAt(it); toast('奇术已生效', 'success'); refreshPrivate(); return {};
    }
    case 'g.reward': {
      if (!p.shop.rewardOffer) fail('WRONG_PHASE');
      const s = p.shop.rewardOffer.slots[f.idx]; if (!s) fail('BAD_TARGET');
      const idx = freeHandIdx(); if (idx < 0) fail('HAND_FULL');
      p.hand[idx] = chessPiece(data.lookup('chess', s.id)); p.shop.rewardOffer = null; refreshPrivate(); return {};
    }
    case 'g.choice': {
      if (f.choiceId !== undefined) {
        prepOnly();
        const choice = p.personalChoice;
        if (!choice || choice.id !== f.choiceId || choice.round !== pub.round || !choice.cards[f.idx]) fail('BAD_TARGET');
        const card = choice.cards[f.idx];
        p.effects.push({ id: choice.id, name: card.name, desc: card.descRaw || card.desc, iconKind: 'choice', iconId: card.id });
        p.personalChoice = null;
        refreshPrivate(); return {};
      }
      if (!pub.sp) fail('WRONG_PHASE');
      const taken = Object.values(pub.sp.picks).includes(f.idx);
      if (taken) fail('BAD_TARGET');
      pub.sp.picks[ME] = f.idx; pub.sp.turn = 'ai_2'; pushPublic(); return {};
    }
    case 'g.ready': {
      if (pub.phase !== PHASE.PREP) fail('WRONG_PHASE');
      if (f.ready && p.personalChoice) fail('BAD_TARGET');
      if (f.ready && !p.canReady) fail('TEMP_NOT_EMPTY');
      p.ready = !!f.ready; refreshPrivate(); return {};
    }
    case 'g.emote': {
      store.set((s) => ({ emotes: [...s.emotes.slice(-19), { seq: Date.now(), playerId: ME, id: f.id, at: Date.now() }] }));
      return {};
    }
    case 'g.watch': {
      // server Match.watch rules: the other pair's boss field is hidden from a fighting player; no dead targets
      const target = (pub.fields || []).find((x) => x.fieldId === f.fieldId);
      const mine = (pub.fields || []).find((x) => x.players.includes(ME));
      const meAlive = pub.players.find((x) => x.playerId === ME)?.alive !== false;
      if (target && (target.kind === 'boss' || target.kind === 'hidden') && meAlive && mine && mine.fieldId !== target.fieldId) fail('BAD_TARGET');
      if (!target && String(f.fieldId).startsWith('n:') && pub.players.find((x) => x.playerId === f.fieldId.slice(2))?.alive === false) fail('BAD_TARGET');
      if ([PHASE.COMBAT, PHASE.UNITE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE, PHASE.SETTLE].includes(pub.phase)) {
        const cur = store.get().match.field;
        if (S.battle?.fieldRef) S.battle.fieldRef.id = f.fieldId;
        if (cur) store.patch('match', { field: { ...cur, fieldId: f.fieldId } });
      } else {
        const who = f.fieldId.replace(/^n:/, '');
        if (who !== ME) {
          const units = shuffle(S.pool).slice(0, 6).map((c, i) => ({ id: 900 + i, kind: 'op', side: 'ally', ownerId: who, defId: c.chessId, name: c.name, tier: c.tier, golden: i === 0, spine: c.charId, avatar: c.assets.avatar, x: [3, 4, 5, 7, 8, 5][i], y: [9, 9, 10, 11, 12, 12][i], facing: 1, maxHp: c.stats.maxHp }));
          // like server/match/match/views.js prepFieldMeta: a read-only prep board with THEIR coming enemies (the pen shows them)
          const theirs = S.priv.nextEnemies.filter((e) => e.source !== 'bounty').slice(0, 3).map((e) => ({ ...e, gate: 'upper', count: e.count + 1 }));
          store.patch('match', { field: { fieldId: f.fieldId, kind: 'normal', rect: { ...GEO.NORMAL_RECT }, stageId: pub.stageId, units, prep: true, nextEnemies: theirs } });
        }
      }
      return {};
    }
    case 'g.autoplay': case 'g.leave': case 'room.leave': return {};
    // the host frees a spectator seat (server/lobby.js removeSpectator; ?variant=spectators seats two, ?variant=notHost makes
    // another player the host)
    case 'room.removeSpectator': {
      const room = store.get().room;
      if (room?.hostId !== ME) fail('NOT_HOST');
      if (!(room.spectators || []).some((x) => x.playerId === f.playerId)) fail('BAD_TARGET');
      store.set({ room: { ...room, spectators: room.spectators.filter((x) => x.playerId !== f.playerId) } });
      return {};
    }
    default: return {};
  }
}

// ---- UI variants (open panels for screenshots) ------------------------------------------------------------------------------
function applyUiVariants() {
  const clickSel = (sel, delay = 250) => setTimeout(() => document.querySelector(sel)?.click(), delay);
  // the enemy list is the 敌方情报 tab of the 本局信息 dialog (left 🔍); the right 🔍▶▶ pans to the pen
  if (VARIANTS.has('drawer')) { clickSel('.gtop__iconbtn', 400); clickSel('.edrawer .tabs__tab:nth-child(2)', 700); }
  if (VARIANTS.has('info')) clickSel('.gtop__iconbtn', 400);
  if (VARIANTS.has('pen')) {
    // the pen needs the field view: wait for it to mount
    const t0 = Date.now();
    const tryPen = () => {
      if (globalThis.__SP_VIEW__ && document.querySelector('.enemybtn')) { setTimeout(() => document.querySelector('.enemybtn')?.click(), 300); return; }
      if (Date.now() - t0 < 15000) setTimeout(tryPen, 100);
    };
    tryPen();
  }
  if (VARIANTS.has('bond')) clickSel('.bslot .bond', 500);
  if (VARIANTS.has('emote')) {
    clickSel('.ewheel__btn', 400);
    setTimeout(() => {
      const now = Date.now();
      store.set({ emotes: [{ seq: now, playerId: 'p3', id: 'autochess_battle_nice_cooperate', at: now }, { seq: now + 1, playerId: 'ai_2', id: 'slug_autochess_battle_thanks', at: now }] });
    }, 300);
  }
  if (VARIANTS.has('settings')) clickSel('.gm__gear', 400);
  if (VARIANTS.has('collapsed')) clickSel('.funds__collapse', 400);
  // the first tap on a shop card selects it and opens its detail (there is no ⓘ corner)
  if (VARIANTS.has('detail')) clickSel('.shopbar__cards .scard:not(.scard--sold)', 500);
  if (VARIANTS.has('detailpiece')) setTimeout(() => {
    const el = document.querySelector('.ff-piece.is-golden') || document.querySelector('.ff-piece');
    el?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
  }, 600);
  if (VARIANTS.has('ticker')) setTimeout(() => store.set((s) => ({ ticker: [...s.ticker, { id: Date.now(), text: '<@ba.vup>Doctor·B博士</>对敌方领袖造成的伤害超过20%!', at: Date.now() }] })), 900);
  if (VARIANTS.has('toast')) setTimeout(() => toast('资金不足', 'error'), 500);
}

// ---- switcher --------------------------------------------------------------------------------------------------------------
const SWITCH = [
  ['INFO_CHECK', PHASE.INFO_CHECK, ''], ['BAND_DRAFT', PHASE.BAND_DRAFT, ''], ['BAND_DRAFT solo', PHASE.BAND_DRAFT, 'solo'],
  ['BATTLE_CHECK', PHASE.BATTLE_CHECK, ''], ['PREP', PHASE.PREP, ''], ['PREP + reward', PHASE.PREP, 'reward'],
  ['PREP + temp', PHASE.PREP, 'temp'], ['PREP frozen', PHASE.PREP, 'frozen'], ['PREP dead', PHASE.PREP, 'dead'],
  ['PREP boss (L)', PHASE.PREP, 'boss'], ['PREP boss (R)', PHASE.PREP, 'bossR'], ['PREP 标准 同构体 + 调和', PHASE.PREP, 'funny,morph,harmony'],
  ['SP bounty', PHASE.SP_DRAFT, 'bounty'], ['SP supply', PHASE.SP_DRAFT, 'supply'], ['SP shop', PHASE.SP_DRAFT, 'shop'], ['SP tactic', PHASE.SP_DRAFT, 'tactic'], ['SP solo', PHASE.SP_DRAFT, 'solo'],
  ['COMBAT', PHASE.COMBAT, ''], ['COMBAT done', PHASE.COMBAT, 'done'], ['UNITE', PHASE.UNITE, ''], ['UNITE leaker', PHASE.UNITE, 'leaker'], ['SETTLE', PHASE.SETTLE, ''],
  ['FINAL_ASSAULT', PHASE.FINAL_ASSAULT, ''], ['FA overtime soon', PHASE.FINAL_ASSAULT, 'overtime'], ['FA draining', PHASE.FINAL_ASSAULT, 'drain'],
  ['HIDDEN_CORE', PHASE.HIDDEN_CORE, ''], ['COMBAT solo (pause)', PHASE.COMBAT, 'solo'], ['FA solo paused', PHASE.FINAL_ASSAULT, 'solo,paused'],
  ['RESULT win', PHASE.RESULT, ''], ['RESULT lose', PHASE.RESULT, 'defeat'],
];
function Switcher() {
  const cur = store.get().match.public?.phase;
  return html`<h4>PHASE</h4>${SWITCH.map(([label, ph, v]) => html`<button class=${cur === ph ? 'on' : ''} onClick=${() => { VARIANTS.clear(); setPhase(ph, v); renderBar(); }}>${label}</button>`)}
    <h4>EVENTS</h4>
    <button onClick=${() => { const now = Date.now(); store.set((s) => ({ emotes: [...s.emotes, { seq: now, playerId: pick(['p3', 'ai_2', 'p4']), id: pick(['autochess_battle_happy', 'slug_autochess_battle_thanks', 'autochess_battle_call', 'autochess_battle_fooldoctor_05', 'autochess_battle_foolamiya_03', 'autochess_battle_foolwisdel_01']), at: now }] })); }}>teammate emote</button>
    <button onClick=${() => store.set((s) => ({ ticker: [...s.ticker, { id: Date.now(), text: `<@ba.vup>${pick(['Doctor·B', '灰烬'])}博士</>将调度中心等级提升为5级`, at: Date.now() }] }))}>ticker</button>
    <button onClick=${() => toast('资金不足', 'error')}>error toast</button>
    <button onClick=${() => { if (S.priv) { S.priv.shop.rewardOffer = { tier: 5, slots: shuffle(visibleChess(5)).slice(0, 3).map((c) => ({ kind: 'chess', id: c.chessId, price: 0, sold: false })) }; refreshPrivate(); } }}>merge reward</button>
    <button onClick=${() => { S.priv.funds += 10; refreshPrivate(); }}>+10 funds</button>`;
}
const bar = document.getElementById('mockbar');
function renderBar() { render(html`<${Switcher} />`, bar); }
window.addEventListener('keydown', (e) => { if (e.key === '`') bar.classList.toggle('hidden'); });
if (SHOT) bar.classList.add('hidden');

// ---- boot ---------------------------------------------------------------------------------------------------------------------
async function boot() {
  net.request = mockRequest;
  store.set({
    session: { entered: true },
    me: { playerId: ME, name: '凯尔希', token: null },
    connection: { status: 'online', ping: 42, attempt: 0, retryAt: 0, lastError: null, everOnline: true },
    clock: { offset: 0, rtt: 20, synced: true },
    room: {
      code: 'MOCK', hostId: VARIANTS.has('notHost') ? 'ai_2' : ME, mode: 'coop', difficulty: 'HARD', inMatch: true,
      seats: PLAYERS.map((p) => ({ seat: p.seat, playerId: p.playerId, name: p.name, isBot: p.isBot, ready: true, connected: true })),
      ...(VARIANTS.has('spectators') ? { spectators: [{ playerId: 'sp_1', name: '观战者甲', connected: true }, { playerId: 'sp_2', name: '观战者乙', connected: false }] } : {}),
    },
  });
  await data.loadAll(GAME_FILES);
  installDeviceSupport();
  installAudio({ getManifest: () => data.get('assets'), subscribe: store.subscribe, getState: store.get, selectRoute, settings: settingsStore.get() });
  const phase = params.get('phase') || 'PREP';
  setPhase(PHASE[phase] || PHASE.PREP, params.get('variant') || '');
  render(html`<div class="app-root"><div class="app-bg" aria-hidden="true"></div><${GameScreen} /><${ConnectionBanner} /><${ToastHost} /><${UiHosts} /><${GuideHost} /></div>`, document.getElementById('app'));
  renderBar();
  store.subscribe(() => renderBar());
  globalThis.__MOCK__ = { store, S: () => S, setPhase, mutate: (fn) => { fn(S); refreshPrivate(); }, pushPublic: () => pushPublic(),
    hurtDevice: (i, dmg) => S?.battle?.hurtDevice?.(i, dmg) ?? false };
}
boot().catch((err) => console.error('[mock] boot failed', err));
