// Shop WebGL host: the mount/dispose lifecycle the Stage A dev page (and later Stage B's theme gate)
// drives. It owns everything the browser needs — canvas, fonts, textures, PIXI, RAF, DOM hotspots and
// listeners — while the ported panels/scene stay exactly as they are (they read a view model).
//
// The host is NOT the product shop bar: no game state mutation, no audio, no actions. A caller hands in
// an m.private-shaped private state plus a small view description and receives clicks through callbacks;
// Stage B maps those to the product's actions.* intents.

import { data as productData } from '../../data.js';
import { settingsStore } from '../settings.js';
import { themePack, themesReady } from '../../uiTheme.js';
// Namespace import: `uninstallThemeFontFaces` is an optional export (a missing one must not break this module),
// and the rest is read through the same namespace.
import * as shopDocs from '../prefab/shopDocs.js';
import { t, N_ } from '../../../../shared/i18n.js';
import { shopModelFromPrivate, shopSignature } from './adapter/model.js';
import { buildShopMeta } from './adapter/prefabMeta.js';
import { resolveShopMeta } from './meta.js';
import { ShopScene } from './scene.js';
import { ShopSpineView } from './spineView.js';
import { AutoChessBattleShopMainView } from './mainView.js';
import { UIButton } from './widgets.js';

/** Control hotspots the prefab's UIButtons cover; their guards are read from each UIButton's _clickGuard. */
const CONTROL_HOTSPOT_SPECS = [
  { key: 'enable', paths: ['entry_enable_hotspot', 'btn_open'], event: 'open' },
  { key: 'fold', paths: ['btn_close', 'fold_hot_spot'], event: 'close' },
  { key: 'refresh', paths: ['btn_refresh/hotspot'], event: 'refresh' },
  { key: 'freeze', paths: ['btn_frozen/hotspot'], event: 'freeze' },
  // The two reward pills are told apart by their subtree: both are named `btn_reward`, and the folded copy
  // comes first in the panel, so a bare `btn_reward/hotspot` suffix resolved to the folded node in both
  // states — leaving the unfolded pill's hotspot unplaced (0×0) while the shop was open.
  { key: 'reward', paths: ['state_unfold/panel_ctrl_btn/btn_reward/hotspot'], event: 'reward' },
  // The folded shop keeps a copy of the reward pill on the `state_able` tab (设置 → 操作, default off); the
  // unfolded one is hidden while folded, so the two never show together.
  { key: 'rewardFold', paths: ['state_able/btn_reward/hotspot'], event: 'reward' },
  { key: 'levelUp', paths: ['hotspot_normal', 'upgrade'], event: 'levelUp', panel: true },
].map((spec) => Object.freeze({ ...spec, paths: Object.freeze([...spec.paths]) }));

/** The same hotspots, deep-frozen: a caller must not rewire the host at runtime. */
export const CONTROL_HOTSPOTS = Object.freeze(CONTROL_HOTSPOT_SPECS);

const DESIGN = Object.freeze([1920, 372]);

/** Accessible labels for the prefab hotspots; the freeze label is refreshed from the model. */
const CONTROL_LABELS = Object.freeze({
  open: N_('展开商店'),
  close: N_('收起商店'),
  refresh: N_('刷新'),
  freeze: N_('冻结'),
  reward: N_('选择奖励'),
  levelUp: N_('升级'),
});

/** Ambient (idle spine / card FX / particles) repaint cap; interaction and clips still paint every frame. */
const AMBIENT_INTERVAL_MS = 1000 / 20;

/**
 * The reward hotspot's accessible name. Minimized, the painted label already names the offer (选择{title}),
 * so it is used as is; while the row is shown (label 稍后) the offer's title is prepended. The DOM bar's
 * header carries the same two facts for the same offer.
 * @param {any} reward `view.reward` (ShopCanvas.shopRewardView)
 * @returns {string}
 */
export function rewardAriaLabel(reward) {
  if (!reward) return t('选择奖励');
  const label = reward.label || t('选择奖励');
  if (!reward.title || !reward.visible) return label;
  return t('{title}：{label}', { title: reward.title, label });
}

/** Whether any ambient loop (spine idle, card FX, particles) still needs a repaint. */
export function ambientPaintNeeded({ particleAnim, cardFxAnim, spineAnim, spinePaint }) {
  return !!(particleAnim || cardFxAnim || spineAnim || spinePaint);
}

/**
 * The ShopScene options a host mount derives from its own options. `still` pins the card clips, the pinned
 * times freeze the scrub / dev poses, and `cardParticles` gates the card emitters. Kept pure so the
 * host → scene pass-through is testable without a WebGL context.
 * @param {{ still?: boolean, cardTime?: number, particleTime?: number, arrowAt?: number, cardParticles?: boolean }} [options]
 * @returns {{ still: boolean|undefined, cardTime: number|undefined, particleTime: number|undefined,
 *   arrowAt: number|undefined, cardParticles: boolean|undefined }}
 */
export function shopSceneOptions(options = {}) {
  return {
    still: options.still,
    cardTime: options.cardTime,
    particleTime: options.particleTime,
    arrowAt: options.arrowAt,
    cardParticles: options.cardParticles,
  };
}

/**
 * Disable a control hotspot for the reason the view published, and give that reason a tooltip. A blocked
 * tool button stays clickable: a native disabled button swallows both the title tooltip and the click, so the
 * player cannot learn why it is locked; aria-disabled + a click that reports onRefuse keeps the explanation
 * reachable. The scene's tinted button must not press either. Exported so a fake element/button can pin the
 * four DOM effects without a WebGL context.
 * @param {any} el the hotspot element
 * @param {{ interactable: boolean }|null} button the scene's tinted button (optional)
 * @param {string|null} reason the block reason (null = usable)
 */
export function applyControlState(el, button, reason) {
  const disabled = !!reason;
  el.disabled = false;
  if (disabled) {
    el.setAttribute('aria-disabled', 'true');
    el.title = reason;
  } else {
    el.removeAttribute('aria-disabled');
    el.removeAttribute('title');
  }
  if (button) button.interactable = !disabled;
}

/**
 * What a control-hotspot click does, in order: a blocked tool button reports its reason through `onRefuse`
 * and does nothing else; a blocked panel control (level up) still runs its action so the caller can refuse it
 * with the old bar's wording; a usable control presses the scene button and runs the action. `press` returns
 * the scene button's Press() result (false = still in a click cooldown).
 * @param {{ reason?: string|null, panel?: boolean, press?: () => boolean,
 *   onRefuse?: ((reason: string) => void)|null, run?: (() => void)|null }} o
 * @returns {'refuse'|'blocked'|'run'}
 */
export function runControlClick({ reason = null, panel = false, press = () => true, onRefuse = null, run = null } = {}) {
  if (reason && !panel) {
    onRefuse?.(reason);
    return 'refuse';
  }
  if (!reason && !press()) return 'blocked';
  run?.();
  return 'run';
}

/** Preloaded shop runtime per theme id: the pack's shop/card/prefab documents, loaded once. */
const runtimeCache = new Map();

/**
 * Resolve the current theme's shop documents from the existing official theme pack (groups → officialAssetUrl),
 * install/wait for its manifest font faces and keep the theme pack's character. No /data fetch and no theme path
 * is built here: a theme without shop.json/card.json/prefabs.json simply has no runtime (the gate keeps the old
 * UI), which is also how a future theme opts in.
 *
 * @param {{ themeId?: string, groups?: Record<string, any>|null, fontTimeoutMs?: number, fonts?: boolean }} [opts]
 * @returns {Promise<{ themeId: string, status: 'ready', docs: any, pack: any, character: any, fonts: any }>}
 */
export async function preloadShopRuntime(opts = {}) {
  const themeId = String(opts.themeId || (settingsStore.get() || {}).uiTheme || '');
  // F5: settings.js starts bootUiThemes() asynchronously; before it settles themePack() is null, so the shop
  // would mount with the built-in white colours and no character spine. Wait for the theme boot; a boot that
  // fails (uiTheme.js rejects themesReady()) is a failed preload — the caller keeps the DOM bar — never a
  // reason to mount with the built-in colours.
  await themesReady();
  const groups = opts.groups || (productData.get('local') || {}).groups || null;
  const pack = themePack(themeId);
  const cacheKey = `${themeId}#${(pack && pack.rev) || ''}`;
  const cached = runtimeCache.get(cacheKey);
  if (cached) return cached.promise;
  const entry = { themeId, cacheKey, status: 'loading', docs: null, pack, character: null, fonts: null, faceList: null, error: null, promise: null };
  entry.promise = (async () => {
    try {
      let local = groups;
      if (!local && typeof productData.load === 'function') {
        try { await productData.load('local'); } catch { /* no local art manifest */ }
        local = (productData.get('local') || {}).groups || null;
      }
      const docs = await shopDocs.themeShopDocs(local, themeId);
      if (!docs) throw new Error(`theme ${themeId || '(none)'} has no shop documents`);
      let fonts = null;
      if (opts.fonts !== false) {
        const faces = shopDocs.themeFonts(local);
        if (faces.length) shopDocs.installThemeFontFaces(faces);
        const families = shopDocs.documentFontFamilies(docs.shop, docs.card, docs.prefabs);
        await shopDocs.loadDocumentFonts(families, opts.fontTimeoutMs, faces);
        fonts = { faces: faces.length, families };
        entry.faceList = faces;
      }
      entry.docs = docs;
      entry.pack = pack;
      entry.character = (pack && pack.character) || null;
      entry.fonts = fonts;
      entry.status = 'ready';
      // A new revision replaces this theme's older runtime: a theme reinstall bumps pack.rev, and the
      // superseded documents and font URLs must not stay cached for the rest of the session.
      for (const [key, other] of runtimeCache) {
        if (other.themeId === themeId && key !== cacheKey) runtimeCache.delete(key);
      }
      return entry;
    } catch (err) {
      entry.status = 'failed';
      entry.error = err;
      // A failed load is retryable: drop the entry so the next preload/mount loads again instead of replaying it.
      if (runtimeCache.get(cacheKey) === entry) runtimeCache.delete(cacheKey);
      throw err;
    }
  })();
  // A caller that only observes the status must not create an unhandled rejection.
  entry.promise.catch(() => {});
  runtimeCache.set(cacheKey, entry);
  return entry.promise;
}

// There is no status/clear export: `preloadShopRuntime` is the only entry (game.js keeps the gate's status), a
// failed entry removes itself so the next call retries, and a ready entry evicts the same theme's older revisions.

/**
 * The model fields the canvas draws. `shopSignature` (adapter/model.js) is only the row's identity — a
 * purchase (sold), a freeze, a price shift or a level-up deliberately does not change it (it drives the
 * refresh clip) — so the immediate-repaint key must cover the painted model itself. Without this, a frozen
 * toggle or a bought card whose id stays put waits for the rAF's dirty flag, which a hidden tab, a fold or a
 * reward offer may never run. garrisonTint is part of the painted model: a theme pack whose colours
 * finish loading after the first frame must repaint without a disable→unfold cycle.
 */
export function shopModelPaintKey(model) {
  if (!model) return '';
  const cards = Array.isArray(model.slots) ? model.slots : [];
  const select = model.selectSlot;
  const row = cards.map((card) => [
    card.slotId, card.id, card.isEmpty ? 1 : 0, card.isFrozen ? 1 : 0,
    card.price, card.srcPrice, card.currCoin, card.tier, card.level,
    card.armed ? 1 : 0, card.armedAt || 0,
    card.isHandFull ? 1 : 0, card.hasSame ? 1 : 0, card.canComb ? 1 : 0, card.hasFusePartner ? 1 : 0,
    card.name, card.nameColor, card.bondColor,
    // The localized art/labels a data overlay can replace while the slot's id stays put.
    card.portraitFile, card.profMarkFile, card.garrisonIconFile, card.garrisonTint, card.iconFile,
    Array.isArray(card.bondList)
      ? card.bondList.map((bond) => `${bond.id}:${bond.name || ''}:${bond.iconFile || ''}`).join(',')
      : '',
  ].join(':')).join('|');
  return [
    model.avalid ? 1 : 0, model.unfold ? 1 : 0, model.level, model.maxLevel, model.coinCount,
    model.refreshCost, model.upgradeCost, model.freeRefreshCnt,
    model.isFrozen ? 1 : 0, model.isSpecRefresh ? 1 : 0, model.isSpecialRecruit ? 1 : 0,
    model.remainCharCnt, model.refreshSeq,
    select ? `${select.slotId}:${select.isGoods ? 1 : 0}:${select.isUpgrade ? 1 : 0}:${select.sold ? 1 : 0}:${select.isChar ? 1 : 0}` : '',
    row,
  ].join('|');
}

/**
 * @param {{ container: HTMLElement, priv: any, view?: any, options?: any, callbacks?: any }} opts
 *   `view`: `{ state?, unfold?, avalid?, selectSlot?, armedSlotId?, armedAt?, refreshSeq?, cardFlags?,
 *     cardMarks?, reward?, controls? }`
 *   `view.cardMarks`: one `cardMarkModel` (or null) per display slot — the DOM overlay inside each card
 *     hotspot (ui/shop/marks.js); absent draws no marks (the dev page and old callers).
 *   `view.reward`: `{ count, visible, label, title, micro, sub, more }` or null — the reward control
 *     (ShopCanvas.shopRewardView); `label` is the painted 稍后 / 选择{title} text, `title` the offer's name.
 *   `view.controls`: `{ refresh?: string|null, freeze?: string|null, levelUp?: string|null }` — the block
 *     reason per control hotspot (ShopCanvas's shopBlockReason wording); a non-empty reason disables the
 *     hotspot and becomes its tooltip. Absent → no control gating (the dev page and old callers).
 *   `options`: `{ themeBase?, fonts?, fontTimeoutMs?, spineMode?, dpr?, particles?, still?, cardTime?,
 *     particleTime?, arrowAt?, status?, cardParticles? }`
 *   `callbacks`: `{ onCard?, onCardDetail?, onOpen?, onClose?, onRefresh?, onFreeze?, onLevelUp?, onReward?, onRefuse?, onFail? }`
 *     `onCardDetail(index)` is the card hotspot's contextmenu (the caller opens the detail without arming);
 *     `onFail(err)` is the host's own fatal path (WebGL context lost / a render throw in the frame loop).
 *     The caller owns the fallback: `update()` rethrows a render failure so its try/catch can run once.
 * @returns {Promise<any>} the host handle
 */
export async function createShopHost(opts = {}) {
  const container = opts.container;
  if (!container) throw new Error('createShopHost: container required');
  const options = opts.options || {};
  const callbacks = opts.callbacks || {};
  const errors = [];
  const notes = { fonts: null, spine: null };

  container.classList.add('shop-webgl');
  const stage = document.createElement('div');
  stage.className = 'shop-webgl__stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'shop-webgl__canvas';
  stage.append(canvas);
  const hotspots = document.createElement('div');
  hotspots.className = 'shop-webgl__hotspots';
  stage.append(hotspots);
  container.append(stage);

  const runtime = options.runtime || await preloadShopRuntime({
    themeId: options.themeId,
    groups: options.groups,
    fonts: options.fonts,
    fontTimeoutMs: options.fontTimeoutMs,
  });
  const docs = runtime.docs;
  const pack = runtime.pack;
  notes.fonts = runtime.fonts;
  // A language switch remounts the host while the runtime stays cached, and dispose() removes the theme's
  // @font-face block: install it again for this mount (a no-op when the same block is already in place).
  if (runtime.faceList && runtime.faceList.length) {
    try { shopDocs.installThemeFontFaces(runtime.faceList); } catch { /* a document without head is not fatal */ }
  }

  // Prefab metadata (tint targets / status path map): adapter/prefabMeta.js buildShopMeta derives it from the
  // shop/card documents (per-node pathID + full colorGroup); an explicit option overrides it. The tables stay
  // empty until the documents carry that data, and the renderer works without them.
  const hasMetaOverride = !!(options.prefabMeta || options.tintTargets || options.pathIdMap || options.loadPrefabMeta);
  const meta = await resolveShopMeta({
    options: hasMetaOverride
      ? options
      : { ...options, loadPrefabMeta: () => buildShopMeta({ shop: docs.shop, card: docs.card }) },
  });

  const scene = new ShopScene({
    theme: docs,
    canvas,
    tintTargets: meta.tintTargets,
    pathIdMap: meta.pathIdMap,
    particlesEnabled: !!options.particles,
    statusEnabled: options.status !== false,
    particleComponents: null,
    options: shopSceneOptions(options),
  });
  let priv = opts.priv || {};
  let view = { state: 'unfold', ...(opts.view || {}) };
  scene.state = view.state;
  const mainView = new AutoChessBattleShopMainView({ scene });

  const spine = new ShopSpineView({
    scene,
    host: container,
    mode: options.spineMode || 'compose',
    character: runtime.character,
  });
  scene.externalQuad = (rec) => (rec.node === scene.spineHolderNode ? spine.quad() : null);
  spine.start();

  /** Find a node under the panel by a path suffix and return its UIButton._clickGuard (C# bool + seconds). */
  function clickGuardFor(paths) {
    for (const suffix of paths) {
      const node = (function walk(n) {
        if (!n) return null;
        const path = String(n.path || '');
        if (path === suffix || path.endsWith('/' + suffix)) return n;
        for (const child of n.children || []) {
          const hit = walk(child);
          if (hit) return hit;
        }
        return null;
      })(scene.panel);
      if (!node) continue;
      const comp = (node.components || []).find((c) => c && c.class === 'UIButton');
      if (comp && comp.fields && comp.fields._clickGuard) return comp.fields._clickGuard;
    }
    return null;
  }
  const buttons = Object.fromEntries(CONTROL_HOTSPOTS.map((spec) => [spec.key,
    new UIButton({ clickGuard: clickGuardFor(spec.paths), tintRoot: spec.key === 'levelUp' ? scene.panel : null,
      tintTargets: spec.key === 'levelUp' ? scene.tintTargets.panel : [] })]));

  let dead = false;
  /** WebGL context lost (reported once; the caller falls back to the DOM shop bar). */
  let contextLost = false;
  /** A lost context or a thrown frame: the next `update()` rethrows it so the caller's guard falls back. */
  let fatalError = null;
  let needsPaint = true;
  let refreshSeq = Number(view.refreshSeq) || Number(priv && priv.shop && priv.shop.refreshSeq) || 0;

  function modelOf(nextView = view, nextPriv = priv) {
    const state = nextView.state || 'unfold';
    const unfold = nextView.unfold != null ? !!nextView.unfold : !(state === 'fold' || state === 'disable');
    const avalid = nextView.avalid != null ? !!nextView.avalid : state !== 'disable';
    // The server owns the refresh sequence (ShopData.refreshSeq); the view may forward it, otherwise the
    // private shop carries it. A mount/reconnect has the same sequence as the server, so it never plays.
    const seq = Number(nextView.refreshSeq != null ? nextView.refreshSeq
      : (nextPriv && nextPriv.shop && nextPriv.shop.refreshSeq)) || 0;
    return shopModelFromPrivate(nextPriv, {
      colors: (pack && pack.colors) || {},
      urlOf: docs.url,
      unfold,
      avalid,
      selectSlot: nextView.selectSlot || null,
      armedSlotId: nextView.armedSlotId != null ? Number(nextView.armedSlotId) : null,
      armedAt: nextView.armedAt,
      refreshSeq: seq,
      cardFlags: nextView.cardFlags || null,
      controls: nextView.controls || null,
      reward: nextView.reward || null,
      foldReward: !!nextView.foldReward,
      ownerSkin: nextView.ownerSkin || null,
    });
  }

  function updateModel({ paint = false } = {}) {
    const model = modelOf();
    scene.model = model;
    syncAria(model);
    mainView.UpdateView(model, { paint: false });
    if (paint) needsPaint = true;
    return model;
  }

  /**
   * A card hotspot's label: name and price, the card's own marks (the same facts the DOM card shows: a
   * stand-in's operator, the DIY pick, owned copies, the skill, 可晋升) and the two-tap state.
   * @param {any} card the model card
   * @param {any} model the shop model
   * @param {any} [marks] the card's mark model (ui/shop/marks.js)
   */
  function cardLabel(card, model, marks) {
    if (!card || card.isEmpty) return t('空栏位');
    const label = t('{name}，价格 {price}', { name: card.name || card.id, price: card.price });
    const extra = [];
    if (marks) {
      for (const key of ['standIn', 'diy', 'pips', 'skill', 'merge']) {
        if (marks[key] && marks[key].aria) extra.push(marks[key].aria);
      }
    }
    const named = extra.length ? `${label}，${extra.join('，')}` : label;
    if (!card.armed) return named;
    return `${named}${cardBlocked(card, model) ? t('，无法购买') : t('，再次点击确认')}`;
  }

  /**
   * Whether the model already says the card cannot be bought. The block reason itself belongs to the caller
   * (ui/gameLogic's shopBlockReason); this is only what the view model carries: a disabled shop or not enough
   * funds. It feeds aria-disabled, never the click: an unaffordable card stays tappable so the caller can
   * refuse it with a reason.
   */
  function cardBlocked(card, model) {
    if (!card || card.isEmpty) return true;
    if (model && model.avalid === false) return true;
    const funds = Number(card.currCoin != null ? card.currCoin : (model && model.coinCount)) || 0;
    return Number(card.price) > funds;
  }

  /** Accessible labels and state follow the current language, the card model and the control reasons. */
  function syncAria(model) {
    const freeze = controlEls.get('freeze');
    if (freeze) freeze.el.setAttribute('aria-label', t(model && model.isFrozen ? N_('解冻') : N_('冻结')));
    const reward = controlEls.get('reward');
    if (reward) reward.el.setAttribute('aria-label', rewardAriaLabel(model && model.reward));
    const rewardFold = controlEls.get('rewardFold');
    if (rewardFold) rewardFold.el.setAttribute('aria-label', rewardAriaLabel(model && model.reward));
    const cards = (model && Array.isArray(model.slots)) ? model.slots : [];
    const marks = (view && Array.isArray(view.cardMarks)) ? view.cardMarks : [];
    for (const [index, el] of cardEls) {
      const card = cards[index];
      el.setAttribute('aria-label', cardLabel(card, model, marks[index]));
      if (card && card.armed) el.setAttribute('aria-pressed', 'true');
      else el.removeAttribute('aria-pressed');
      el.setAttribute('aria-disabled', cardBlocked(card, model) ? 'true' : 'false');
    }
  }

  /** `view.controls` carries a block reason per control hotspot; absent (dev page, old callers) = no gating. */
  function controlReason(event) {
    const controls = view && view.controls;
    if (!controls || typeof controls !== 'object') return null;
    const reason = controls[event];
    return typeof reason === 'string' && reason ? reason : null;
  }

  /**
   * Apply the current block reason + the reward hotspot's visibility to one control element. Visibility needs
   * both the view flag and a painted box: a reward the view keeps but the frame does not show (an inactive
   * node) must leave no hidden-but-focusable 0×0 button behind.
   */
  function syncControlState(entry, box) {
    if (entry.spec.event === 'reward') {
      const wanted = entry.spec.key === 'rewardFold' ? (view && view.foldReward) : (view && view.reward);
      entry.el.hidden = !wanted || !box;
    }
    applyControlState(entry.el, entry.button, controlReason(entry.spec.event));
  }

  function visibleBox(box) {
    if (!box || !box.shown || !(Number(box.alpha) > 0.01)) return null;
    return box;
  }

  function boxFor(path) {
    let box = null;
    for (const [key, candidate] of scene.frame.boxes) {
      if (key === path || key.endsWith(`/${path}`)) { box = candidate; break; }
    }
    return visibleBox(box);
  }

  function place(el, box) {
    if (!box) { el.hidden = true; return; }
    const unit = scene.unitCss || 1;
    el.hidden = false;
    el.style.left = `${box.x * unit}px`;
    el.style.top = `${box.y * unit}px`;
    el.style.width = `${box.w * unit}px`;
    el.style.height = `${box.h * unit}px`;
    // The card mark overlay sizes its text from the card box (game-shop-canvas.css).
    el.style.setProperty('--card-w', `${box.w * unit}px`);
    el.style.setProperty('--card-h', `${box.h * unit}px`);
  }

  const controlEls = new Map();
  for (const spec of CONTROL_HOTSPOTS) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `shop-webgl__hit shop-webgl__hit--${spec.key}`;
    el.dataset.shopWebglAction = spec.event;
    el.hidden = true;
    el.setAttribute('aria-label', t(CONTROL_LABELS[spec.event] || spec.event));
    hotspots.append(el);
    controlEls.set(spec.key, { el, spec, button: buttons[spec.key] });
    bindHit(el, spec.key);
  }

  /**
   * Card hotspots by slot index. Only a slot that currently holds a card gets one: an empty or sold slot is not
   * focusable, cannot be tapped and is not a target for the buy hotkey (game.js resolves it through
   * `[data-shop-slot]`). The map entry is removed again when a slot empties.
   *
   * The hotspot is `<button data-shop-slot=N>` inside the `[data-shop-webgl]` root ShopCanvas assigns to
   * `barRef`: game.js matches `:is(.shopbar,[data-shop-webgl]) [data-shop-slot]` and requires
   * `barRef.current.contains(card)`. N is the 0-based display index; the model slotId is N + 1.
   */
  const cardEls = new Map();

  function createCardEl(index) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'shop-webgl__slot';
    el.dataset.shopSlot = String(index);
    el.hidden = true;
    hotspots.append(el);
    bindHit(el, 'card');
    return el;
  }

  function bindHit(el, key) {
    const now = () => performance.now();
    const cardView = () => scene.slots.views[Number(el.dataset.shopSlot)];
    el.addEventListener('pointerenter', () => {
      if (key === 'card') scene.slots.setHover(Number(el.dataset.shopSlot));
      else controlEls.get(key)?.button?.setHover(true);
    });
    el.addEventListener('pointerleave', () => {
      if (key === 'card') scene.slots.setHover(-1);
      else controlEls.get(key)?.button?.setHover(false);
    });
    el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (key === 'card') {
        const v = cardView();
        if (v && v.button) v.button.setPressed(true);
      } else {
        controlEls.get(key)?.button?.setPressed(true);
      }
    });
    el.addEventListener('pointerup', (event) => {
      if (event.button !== 0) return;
      if (key === 'card') {
        const v = cardView();
        if (v && v.button) v.button.setPressed(false);
      } else {
        controlEls.get(key)?.button?.setPressed(false);
      }
    });
    el.addEventListener('pointercancel', () => {
      if (key !== 'card') controlEls.get(key)?.button?.setPressed(false);
    });
    el.addEventListener('click', () => {
      if (dead) return;
      if (key === 'card') {
        const index = Number(el.dataset.shopSlot);
        const v = cardView();
        if (v && v.button && !v.button.Press(now())) return;
        if (callbacks.onCard) callbacks.onCard(index);
        return;
      }
      const entry = controlEls.get(key);
      if (!entry) return;
      const reason = controlReason(entry.spec.event);
      const handler = callbacks[`on${entry.spec.event[0].toUpperCase()}${entry.spec.event.slice(1)}`];
      // A blocked tool button is not natively disabled (that would swallow the click and its title);
      // report the reason through the same toast the old shop bar uses. A blocked panel control still runs
      // its handler so the caller can refuse it with the old wording.
      runControlClick({
        reason,
        panel: !!entry.spec.panel,
        press: () => entry.button.Press(now()),
        onRefuse: callbacks.onRefuse || null,
        run: handler || null,
      });
    });
    // Right-click on a card opens its detail without arming it (the old shop bar's onContextMenu). The caller
    // owns what the detail shows, so this only forwards the slot index.
    if (key === 'card') {
      el.addEventListener('contextmenu', (event) => {
        if (dead) return;
        event.preventDefault();
        if (callbacks.onCardDetail) callbacks.onCardDetail(Number(el.dataset.shopSlot));
      });
    }
  }

  /**
   * The project's own marks on one card hotspot (ui/shop/marks.js): a DOM overlay inside the hotspot
   * button, so it follows the card box every frame, keeps the browser's title tooltips, the interface
   * font size and the accessible name, and never blocks the two-tap flow (the spans have no handlers).
   * A key on the button's dataset skips the DOM work when nothing changed.
   * @param {HTMLButtonElement} el the card hotspot
   * @param {any} marks cardMarkModel output, already filtered by the 卡面标记 switches
   */
  function syncCardMarks(el, marks) {
    const key = marks ? JSON.stringify(marks) : '';
    if (el.dataset.shopMarks === key) return;
    el.dataset.shopMarks = key;
    let root = el.querySelector(':scope > .shop-marks');
    if (!root) {
      root = document.createElement('span');
      root.className = 'shop-marks';
      root.setAttribute('aria-hidden', 'true');
      el.append(root);
    }
    root.textContent = '';
    if (!marks) return;
    const add = (cls, text, title) => {
      const span = document.createElement('span');
      span.className = `shop-mark ${cls}`;
      if (title) span.title = title;
      if (text) span.textContent = text;
      root.append(span);
      return span;
    };
    if (marks.standIn) add('shop-mark--standin', marks.standIn.label, marks.standIn.title);
    if (marks.diy) add('shop-mark--diy', marks.diy.label, marks.diy.title);
    if (marks.merge) add('shop-mark--merge', marks.merge.label, marks.merge.title);
    if (marks.pips) {
      const pips = add('shop-mark--pips', '', marks.pips.title);
      for (let i = 0; i < marks.pips.need; i += 1) {
        const pip = document.createElement('i');
        if (i < marks.pips.copies) pip.className = 'on';
        pips.append(pip);
      }
    }
    if (marks.skill) {
      const skill = add('shop-mark--skill', '', marks.skill.title);
      if (marks.skill.custom) skill.classList.add('is-custom');
      if (marks.skill.file) {
        const img = document.createElement('img');
        img.src = marks.skill.file;
        img.alt = '';
        skill.append(img);
      } else if (marks.skill.slot) {
        const glyph = document.createElement('b');
        glyph.textContent = marks.skill.slot;
        skill.append(glyph);
      }
    }
  }

  /**
   * The card hotspots the painted frame shows: create one for a slot that holds a card, place it on that card's
   * box, and drop the hotspot of a slot that is empty or was sold (the row shrank after a purchase). A folded
   * shop paints no card box, so nothing stays clickable behind the fold.
   */
  function syncCardHotspots() {
    const cards = (scene.model && Array.isArray(scene.model.slots)) ? scene.model.slots : [];
    const marks = (view && Array.isArray(view.cardMarks)) ? view.cardMarks : [];
    const roots = scene.cardRoots || [];
    for (const [index, el] of [...cardEls]) {
      const card = cards[index];
      if (!card || card.isEmpty) {
        el.remove();
        cardEls.delete(index);
      }
    }
    for (let index = 0; index < roots.length; index += 1) {
      const card = cards[index];
      if (!card || card.isEmpty) continue;
      let el = cardEls.get(index);
      if (!el) {
        el = createCardEl(index);
        cardEls.set(index, el);
      }
      place(el, visibleBox(scene.frame.boxes.get(roots[index].path) || null));
      syncCardMarks(el, filterMarks(marks[index]));
    }
  }

  /** The mark model the overlay draws: the caller's filtered one, or null when the dev page has none. */
  function filterMarks(marks) {
    return marks && (marks.skill || marks.standIn || marks.diy || marks.pips || marks.merge) ? marks : null;
  }

  function updateHotspots() {
    syncCardHotspots();
    syncAria(scene.model);
    for (const [, entry] of controlEls) {
      let box = null;
      for (const path of entry.spec.paths) { box = boxFor(path); if (box) break; }
      place(entry.el, box);
      syncControlState(entry, box);
    }
    stage.style.width = canvas.style.width;
    stage.style.height = canvas.style.height;
  }

  function tickButtons(now) {
    let changed = false;
    for (const instance of Object.values(buttons)) if (instance.tick(now)) changed = true;
    for (const instance of scene.slots.cardButtons()) if (instance.tick(now)) changed = true;
    return changed;
  }

  function paintFrame(clips = scene.motion.clipTracks()) {
    lastPaintAt = performance.now();
    scene.slots.tickCards(performance.now());
    scene.paint({ clips });
    updateHotspots();
    needsPaint = false;
  }

  let lastTexturesReady = -1;
  let frames = 0;
  let lastState = view.state;

  function applyState(nextState, { animate = true } = {}) {
    const previous = scene.state;
    scene.state = nextState;
    if (previous !== nextState && animate && (previous === 'fold' || previous === 'unfold')
      && (nextState === 'fold' || nextState === 'unfold')) {
      scene.chrome.playFold(nextState === 'unfold');
    }
    lastState = nextState;
  }

  scene.chrome.foldSwitchTween.onAfterHide = () => { applyState('fold', { animate: false }); needsPaint = true; };
  scene.chrome.foldSwitchTween.onAfterShow = () => { applyState('unfold', { animate: false }); needsPaint = true; };

  let lastPaintKey = null;

  /** The view fields whose change is visible (everything else on a private push is not). */
  function viewPaintKey() {
    const select = view.selectSlot;
    return [
      view.state, view.avalid, view.unfold, view.refreshSeq,
      select ? `${select.slotId ?? ''}:${select.isUpgrade ? 1 : 0}:${select.isGoods ? 1 : 0}` : '',
      view.armedSlotId, view.armedAt,
      JSON.stringify(view.cardFlags || null),
      JSON.stringify(view.cardMarks || null),
      JSON.stringify(view.controls || null),
      JSON.stringify(view.reward || null),
      // The folded shop's copy of the pill is painted from this flag (`state_able/btn_reward`), so a
      // 设置 → 操作 toggle while folded must repaint even when nothing else on the shop changed.
      view.foldReward ? 1 : 0,
    ].join('|');
  }

  function update(nextPriv, nextView = {}) {
    if (dead) return null;
    // A lost context or a thrown frame cannot be painted any more: the caller's next push is what carries the
    // failure back, so its try/catch can run once (setFailed + onFail) and the gate keeps the DOM shop bar.
    if (fatalError) throw fatalError;
    if (nextPriv) priv = nextPriv;
    view = { ...view, ...nextView };
    refreshSeq = Number(view.refreshSeq != null ? view.refreshSeq
      : (priv && priv.shop && priv.shop.refreshSeq)) || 0;
    if (view.state && view.state !== lastState) applyState(view.state);
    else if (view.state) scene.state = view.state;
    // A private push mostly carries state the shop does not draw (ready flags, timers, other players).
    // Update the model either way, but only repaint when the shop actually looks different: the update
    // path used to cost ~17 ms per push on a desktop GPU.
    let model;
    try {
      model = updateModel({ paint: false });
      const key = `${scene.state}|${refreshSeq}|${shopSignature(priv)}|${viewPaintKey()}|${shopModelPaintKey(model)}`;
      if (key !== lastPaintKey) {
        lastPaintKey = key;
        // A refresh re-renders the cards; re-bind the panel holder (the panel itself is not rebuilt) and
        // force one spine compose so the character cannot stay detached from the new frame.
        scene.refreshSpineHolder();
        if (spine && spine.mode !== 'off') {
          spine.tick(performance.now(), true);
          needsPaint = true;
        }
        paintFrame();
      }
    } catch (err) {
      // A renderer throw does not escape through the caller's event/props path: record it for metrics and
      // rethrow so ShopCanvas's single guard owns the fallback (fail once, then stop pushing). The host never
      // falls back by itself on this path.
      const message = String((err && err.message) || err);
      errors.push(message);
      if (scene.errors) scene.errors.push(message);
      throw err;
    }
    return model;
  }

  function resize() {
    if (dead) return;
    const width = Math.max(1, Math.round(container.clientWidth || DESIGN[0]));
    const dpr = options.dpr != null ? Number(options.dpr) : Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
    scene.resize(width, dpr || 1);
    needsPaint = true;
  }

  let raf = 0;
  let bootAt = performance.now();
  let lastPaintAt = 0;
  function loop() {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    // The renderer's own listener can lose the context outside our event turn (a GPU reset, a driver reset);
    // polling its flag keeps one fallback path instead of a rendered-on-lost-context frame.
    if (scene.renderer && scene.renderer.lost) { onContextLost(); return; }
    try {
      frame();
    } catch (err) {
      halt(err);
    }
  }

  /**
   * A WebGL context loss cannot be painted any more and is not restored here: report it once, stop the frame
   * loop and let the owner fall back to the DOM shop bar. Without an `onFail` callback the failure is replayed
   * by the next `update()`, which the caller's own guard turns into the same fallback.
   */
  function onContextLost() {
    if (dead || contextLost) return;
    contextLost = true;
    fatalError = new Error('shop canvas: WebGL context lost');
    errors.push(fatalError.message);
    if (scene.errors) scene.errors.push(fatalError.message);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (callbacks.onFail) callbacks.onFail(fatalError);
  }
  canvas.addEventListener('webglcontextlost', onContextLost);

  /**
   * A frame-loop throw must not escape requestAnimationFrame (an uncaught error would repeat on every frame):
   * record it once, stop the loop and hand it to the owner, which owns the fallback. The failure is also kept
   * as the host's fatal error, so an `update()` that arrives first falls back the same way even without onFail.
   */
  function halt(err) {
    const message = String((err && err.message) || err);
    fatalError = err instanceof Error ? err : new Error(message);
    errors.push(message);
    if (scene.errors) scene.errors.push(message);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (callbacks.onFail) callbacks.onFail(fatalError);
  }

  function frame() {
    frames += 1;
    const now = performance.now();
    scene.particleElapsed = (now - bootAt) / 1000;
    scene.motion.tick(now);
    const clips = scene.motion.clipTracks();
    const cardAnim = scene.slots.tickCards(now);
    const cardFxAnim = !!(scene.cardRoots && scene.cardRoots.length && scene.cardFxAnimating());
    let texChanged = false;
    if (frames % 6 === 0) {
      let ready = 0;
      for (const [, entry] of scene.renderer.textures) if (entry && entry.ready) ready += 1;
      if (ready !== lastTexturesReady) { lastTexturesReady = ready; texChanged = true; }
    }
    const tintChanged = tickButtons(now);
    const particleAnim = !!(scene.particlesEnabled && scene.particlesAnimating());
    const spinePaint = spine.consumePaintRequest();
    const spineAnim = spine.animating();
    // Interaction, clips and model changes paint immediately; the ambient loops (spine idle, card FX,
    // particles) only need to keep moving and are capped, so an idle shop stops eating the frame budget
    // (the in-game ping is measured on this same main thread).
    // A panel auto-clip (the refresh button's special sweep) is not a motion track, so `clips` does not carry
    // it; without this the loop would only advance on whoever else asked for a paint.
    const autoClipAnim = scene.autoClipAnimating();
    const urgent = !!(scene.dirty || clips.length || autoClipAnim || cardAnim || texChanged || tintChanged || needsPaint);
    // The spine compose canvas changes on every tick (its envelope follows the idle animation), so it is
    // an ambient repaint, not an urgent one; otherwise it would defeat the ambient cap below.
    const ambient = ambientPaintNeeded({ particleAnim, cardFxAnim, spineAnim, spinePaint });
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (!hidden && (urgent || (ambient && now - lastPaintAt >= AMBIENT_INTERVAL_MS))) {
      // The spine canvas is only read by a paint, so tick it right before one; ticking it every rAF
      // renders the PIXI scene even on frames the shop canvas never shows.
      spine.tick(now);
      paintFrame(clips);
      lastPaintAt = now;
    }
    let finished = false;
    for (const done of scene.motion.flushFinished()) { done(); finished = true; }
    if (finished && !scene.motion.busy) {
      // Re-apply the widget actives (cost toggle, confirm strip, buttons) after the clip, then drop the
      // stale active snapshot. The clip length is untouched.
      scene.animBase = null;
      mainView.invalidate();
      updateModel({ paint: false });
      needsPaint = true;
    }
  }

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  if (observer) observer.observe(container);

  resize();
  update(priv, {});
  paintFrame();
  bootAt = performance.now();
  raf = requestAnimationFrame(loop);

  /**
   * Teardown order: stop the loop and the observer first (no paint may race the release), drop our listeners,
   * destroy the spine view (its own PIXI app and the atlas pages an imported pack built), then the card
   * renderer. `renderer.destroy()` deletes program/buffers/textures while the context is still alive and then
   * releases the context itself (cardStage's WEBGL_lose_context, idempotent), so the host does not lose it
   * separately: losing it first would turn every delete* into a no-op and leave the GL objects to the browser.
   * The @font-face block and the hotspot elements go last.
   */
  function dispose() {
    if (dead) return;
    dead = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (observer) observer.disconnect();
    canvas.removeEventListener('webglcontextlost', onContextLost);
    try { spine.destroy(); } catch (err) { errors.push(String((err && err.message) || err)); }
    try { scene.renderer.destroy(); } catch (err) { errors.push(String((err && err.message) || err)); }
    try {
      // Optional export of ui/prefab/shopDocs.js (a missing one must not break teardown).
      if (typeof shopDocs.uninstallThemeFontFaces === 'function') shopDocs.uninstallThemeFontFaces();
    } catch (err) { errors.push(String((err && err.message) || err)); }
    for (const el of controlEls.values()) el.el.remove();
    for (const el of cardEls.values()) el.remove();
    controlEls.clear();
    cardEls.clear();
    stage.remove();
    container.classList.remove('shop-webgl');
  }

  function metrics() {
    const base = mainView.metrics();
    return {
      ...base,
      host: {
        widthCss: container.clientWidth, dpr: scene.dpr, dead, lost: contextLost || !!(scene.renderer && scene.renderer.lost),
        canvas: [canvas.width, canvas.height],
        hotspotCount: visibleHotspotCount(),
      },
      errors: scene.errors.slice(),
      hostErrors: errors.slice(),
      fonts: notes.fonts,
      spine: spine.debug,
      meta: { source: meta.source, ...meta.stats },
    };
  }

  function visibleHotspotCount() {
    let n = 0;
    for (const el of cardEls.values()) if (!el.hidden) n += 1;
    for (const entry of controlEls.values()) if (!entry.el.hidden) n += 1;
    return n;
  }

  return {
    scene,
    mainView,
    spine,
    docs,
    meta,
    buttons,
    canvas,
    update,
    resize,
    dispose,
    metrics,
    get model() { return scene.model; },
    get state() { return scene.state; },
    get priv() { return priv; },
    get view() { return view; },
  };
}
