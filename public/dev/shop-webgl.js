// Dev host for the ported shop renderer (Stage A). Builds an m.private-shaped mock, mounts the WebGL shop
// through ui/shop/host.js and exposes a debug surface for headless QA:
//   window.__shopWebglDebug = { ready, metrics(), setState(name), states, dispose(), errors }
// The renderer modules carry no URL/debug hooks of their own; everything this page toggles is a host option.

import { createShopHost } from '/js/ui/shop/host.js';
import { data } from '/js/data.js';
import { prepareTheme, themesReady } from '/js/uiTheme.js';

const STATES = ['normal', 'unfold', 'fold', 'disable', 'armed', 'frozen', 'able0', 'repeated'];
const THEME_ID = 'ac_s_closur';
const ITEM_ID = 'chess_item_1_01_e_a';
const REFRESH_PRICE = 1;
const UPGRADE_PRICE = 4;

const $ = (id) => document.getElementById(id);
const hostEl = $('host');
const statusEl = $('status');
const reportEl = $('report');
const errorsEl = $('errors');
const stateSel = $('state');
const coinIn = $('coin');
const levelSel = $('level');
const dprSel = $('dpr');
const stillIn = $('still');
const particlesIn = $('particles');
const spineSel = $('spine');
const remountBtn = $('remount');

const errors = [];
function recordError(message) {
  const text = String((message && message.message) || message || 'error');
  errors.push(text);
  errorsEl.textContent = errors.slice(-6).join('\n');
}
window.addEventListener('error', (event) => recordError(event.message || event.error));
window.addEventListener('unhandledrejection', (event) => recordError(event.reason));

let host = null;
let operators = [];
let mock = null;
let mode = new URLSearchParams(location.search).get('state') || 'normal';

for (const name of STATES) {
  const option = document.createElement('option');
  option.value = name;
  option.textContent = name;
  stateSel.append(option);
}
for (let level = 1; level <= 6; level += 1) {
  const option = document.createElement('option');
  option.value = String(level);
  option.textContent = `Lv ${level}`;
  levelSel.append(option);
}

/** Deterministic operator pool from the product chess table (non-golden, visible, in-shop records). */
async function loadOperators() {
  const res = await fetch('/data/chess.json');
  if (!res.ok) throw new Error(`/data/chess.json: HTTP ${res.status}`);
  const chess = await res.json();
  const rows = Object.values(chess).filter((row) => row && row.chessId && !row.isGolden
    && row.visible !== false && !row.hideInShop && row.isHidden !== true);
  rows.sort((a, b) => (Number(a.shopSortId) || 0) - (Number(b.shopSortId) || 0)
    || String(a.chessId).localeCompare(String(b.chessId)));
  const byTier = new Map();
  for (const row of rows) {
    const tier = Number(row.tier) || 1;
    if (!byTier.has(tier)) byTier.set(tier, row);
  }
  const pool = [...byTier.values()].map((row) => ({ id: row.chessId, tier: Number(row.tier) || 1, price: Number(row.price) || 1 }));
  for (const row of rows) {
    if (pool.length >= 12) break;
    if (pool.some((p) => p.id === row.chessId)) continue;
    pool.push({ id: row.chessId, tier: Number(row.tier) || 1, price: Number(row.price) || 1 });
  }
  if (pool.length < 6) throw new Error('chess table has fewer than 6 usable records');
  return pool;
}

/**
 * The mock private state: only the m.private fields the adapter reads (server/match/player/views.js privateView).
 * Simulated, not server-shaped: slots stay 5 chess + 1 item whatever `level` says, refreshPrice stays the paid
 * price during a free refresh, and board/hand/temp/standIns/diy are omitted, so shopCardFlags sees no owned copy
 * (the `repeated` state injects cardFlags directly) and ownStandIn/ownDiyRecord never compose a record.
 */
function buildPriv(stateName) {
  const level = Math.max(1, Math.min(6, Number(levelSel.value) || 1));
  const funds = stateName === 'able0' ? 0 : Math.max(0, Number(coinIn.value) || 0);
  const frozen = stateName === 'frozen';
  const slots = [];
  for (let i = 0; i < 5; i += 1) {
    const row = operators[i % operators.length];
    slots.push({ kind: 'chess', id: row.id, price: row.price, basePrice: row.price, sold: false, frozen });
  }
  slots.push({ kind: 'item', id: ITEM_ID, price: 1, basePrice: 1, sold: false, frozen });
  return {
    funds,
    deployCap: 8,
    deployCount: 2,
    shop: {
      level,
      maxLevel: 6,
      upgradePrice: level >= 6 ? 0 : UPGRADE_PRICE,
      refreshPrice: REFRESH_PRICE,
      freeRefreshes: 0,
      frozen,
      layout: { chess: 5, item: 1 },
      slots,
      rewardOffer: null,
    },
  };
}

function viewFor(stateName) {
  // The card-mark overlay (ui/shop/marks.js) is normally built by ShopCanvas from m.private; the dev
  // page has no board / hand / standIns / diy rows, so it injects a model directly — one mark of each
  // kind on the first cards, so the PSD positions and the right-growing text can be checked by eye
  // (also in the 0.7 deploy fold and at another dpr).
  const skill = { file: null, slot: 'S2', custom: false, aria: '技能', title: '技能：S2' };
  const cardMarks = [
    {
      skill,
      standIn: { label: '替补', aria: '银灰的替补', title: '未持有银灰：由替补干员 Sharp 上场' },
      merge: { label: '可晋升', aria: '可晋升', title: '再买 1 张合成精锐' },
      pips: { copies: 2, need: 3, aria: '已拥有 2/3', title: '已拥有 2/3' },
    },
    { skill, diy: { label: '自选', aria: '自选编队：银灰', title: '自选编队：银灰（只在你的商店出现）' } },
    { skill, pips: { copies: 1, need: 3, aria: '已拥有 1/3', title: '已拥有 1/3' } },
    { skill },
    { skill, merge: { label: '可晋升', aria: '可晋升', title: '再买 1 张合成精锐' } },
    null,
  ];
  if (stateName === 'fold') return { state: 'fold', cardMarks };
  if (stateName === 'disable') return { state: 'disable', avalid: false, cardMarks };
  if (stateName === 'armed') {
    return { state: 'unfold', armedSlotId: 2, armedAt: performance.now() - 1200, selectSlot: { slotId: 2, isGoods: true }, cardMarks };
  }
  if (stateName === 'repeated') {
    return { state: 'unfold', cardFlags: { 0: { hasSame: true, canComb: true, hasFusePartner: true }, 1: { hasFusePartner: true } }, cardMarks };
  }
  return { state: 'unfold', cardMarks };
}

function options() {
  const dpr = dprSel.value === 'auto' ? undefined : Number(dprSel.value);
  const params = new URLSearchParams(location.search);
  return {
    themeId: THEME_ID,
    dpr: params.get('dpr') != null ? Number(params.get('dpr')) : dpr,
    still: stillIn.checked || params.get('still') === '1',
    particles: particlesIn.checked || params.get('particles') === '1',
    spineMode: spineSel.value,
    // Stage B test hook: a prefab-meta object (W62 shape) injected before mount, e.g. from CDP --pre.
    ...(globalThis.__shopWebglMetaFixture ? { prefabMeta: globalThis.__shopWebglMetaFixture } : {}),
  };
}

function render() {
  if (!host) return;
  try {
    const metrics = host.metrics();
    reportEl.textContent = JSON.stringify({
      state: metrics.state,
      nodes: metrics.nodes,
      records: metrics.records,
      pitch: metrics.pitch,
      cardBoxes: metrics.cardBoxes,
      unresolved: Array.isArray(metrics.unresolved) ? metrics.unresolved.length : metrics.unresolved,
      materials: metrics.materials && metrics.materials.used,
      textures: metrics.textures,
      fonts: metrics.fonts,
      spine: metrics.spine && { loaded: metrics.spine.loaded, mode: metrics.spine.mode, error: metrics.spine.error },
      meta: metrics.meta,
      errors: metrics.errors,
      hostErrors: metrics.hostErrors,
    }, null, 1);
  } catch (err) {
    recordError(err);
  }
}

let themePrepared = null;

/**
 * Load the pack this page renders with. The product's own flow (ui/themeSettings.js useTheme) is prepareTheme →
 * selectTheme; this page takes only the load half and mounts with `options.themeId`, because selectTheme writes
 * `uiTheme` through settings.js, whose subscriber persists it to localStorage — opening a dev page must not change
 * the player's saved theme. ui/shop/host.js resolves the pack from options.themeId (preloadShopRuntime).
 */
async function prepareThemeForPage() {
  await data.loadAll('chess', 'items', 'bonds', 'garrisons', 'assets');
  // ui/shop/host.js imports ui/settings.js, which already started bootUiThemes on this page's import path.
  await themesReady().catch(() => {});
  const prepared = await prepareTheme(THEME_ID);
  if (!prepared.ok) recordError(`prepareTheme(${THEME_ID}): ${prepared.code || 'failed'}`);
}

async function mount() {
  statusEl.textContent = 'mounting…';
  if (!themePrepared) {
    themePrepared = prepareThemeForPage().catch((err) => { themePrepared = null; throw err; });
  }
  await themePrepared;
  host = await createShopHost({
    container: hostEl,
    priv: mock,
    view: viewFor(mode),
    options: options(),
    callbacks: {
      onCard: (index) => onCard(index),
      onOpen: () => apply('unfold'),
      onClose: () => apply('fold'),
      onRefresh: () => onRefresh(),
      onFreeze: () => onFreeze(),
      onLevelUp: () => onLevelUp(),
    },
  });
  window.__shopWebglDebug.host = host;
  window.__shopWebglDebug.meta = host.meta;
  statusEl.textContent = `mounted · ${mode}`;
  render();
}

function apply(stateName) {
  mode = stateName;
  stateSel.value = stateName;
  mock = buildPriv(stateName);
  // a full view: clear the previous state's selection/armed/card flags (the host merges partial updates)
  host.update(mock, { avalid: true, selectSlot: null, armedSlotId: null, cardFlags: null, ...viewFor(stateName) });
  statusEl.textContent = `mounted · ${mode}`;
  render();
}

function sync() {
  host.update(mock, viewFor(mode));
  render();
}

function onCard(index) {
  const slot = mock.shop.slots[index];
  if (!slot) return;
  if (host.view.armedSlotId === index + 1) {
    if (mock.funds < (Number(slot.price) || 0)) {
      // the server refuses; the dev host refuses the same way and records why
      recordError('not enough funds for this slot');
      return;
    }
    mock.funds -= Number(slot.price) || 0;
    slot.sold = true;
    mock.shop.slots = mock.shop.slots.map((row) => ({ ...row }));
    mode = mode === 'armed' ? 'unfold' : mode;
    sync();
    return;
  }
  host.update(mock, {
    ...viewFor(mode),
    selectSlot: { slotId: index + 1, isGoods: true },
    armedSlotId: index + 1,
    armedAt: performance.now(),
  });
  render();
}

function onRefresh() {
  const free = mock.shop.freeRefreshes > 0;
  if (!free && mock.funds < mock.shop.refreshPrice) { recordError('not enough funds for refresh'); return; }
  if (!free) mock.funds -= mock.shop.refreshPrice;
  const offset = 1 + Math.floor(Math.random() * Math.max(1, operators.length - 5));
  mock.shop.slots = mock.shop.slots.map((slot, index) => {
    if (slot.kind !== 'chess') return { ...slot };
    const row = operators[(offset + index) % operators.length];
    return { ...slot, id: row.id, price: row.price, basePrice: row.price, sold: false };
  });
  sync();
}

function onFreeze() {
  mock.shop.frozen = !mock.shop.frozen;
  for (const slot of mock.shop.slots) slot.frozen = mock.shop.frozen;
  sync();
}

function onLevelUp() {
  if (mock.shop.level >= mock.shop.maxLevel) return;
  mock.funds -= mock.shop.upgradePrice;
  mock.shop.level += 1;
  mock.shop.upgradePrice = mock.shop.level >= mock.shop.maxLevel ? 0 : UPGRADE_PRICE;
  sync();
}

stateSel.addEventListener('change', () => apply(stateSel.value));
levelSel.addEventListener('change', () => { mock.shop.level = Number(levelSel.value) || 1; mock.shop.upgradePrice = mock.shop.level >= 6 ? 0 : UPGRADE_PRICE; sync(); });
coinIn.addEventListener('change', () => { mock.funds = Math.max(0, Number(coinIn.value) || 0); sync(); });
for (const el of [stillIn, particlesIn]) el.addEventListener('change', () => remount());
spineSel.addEventListener('change', () => remount());
dprSel.addEventListener('change', () => { host.resize(); render(); });
remountBtn.addEventListener('click', () => remount());

async function remount() {
  if (host) { host.dispose(); host = null; }
  const stray = document.querySelectorAll('canvas.shop-webgl__canvas').length;
  if (stray !== 0) recordError(`dispose left ${stray} canvas`);
  await mount();
}

window.__shopWebglDebug = {
  ready: false,
  errors,
  states: STATES.slice(),
  host: null,
  meta: null,
  metrics: () => (host ? host.metrics() : null),
  setState: (name) => apply(name),
  dispose: () => { if (host) host.dispose(); host = null; },
};

(async () => {
  try {
    operators = await loadOperators();
    mock = buildPriv(mode);
    stateSel.value = mode;
    levelSel.value = String(mock.shop.level);
    await mount();
  } catch (err) {
    recordError(err);
    statusEl.textContent = `failed: ${(err && err.message) || err}`;
  } finally {
    window.__shopWebglDebug.ready = true;
  }
})();
