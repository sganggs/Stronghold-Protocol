

















import { setActive, setText, setSprite, scriptsOf, resolveScriptRefs, findPath } from './prefab.js';
import { ThreeStateToggleState } from './model.js';


export function twoStateToggleOf(node, index) {
  const entry = scriptsOf(node, 'TwoStateToggle')[0];
  if (!entry) return null;
  const { refs } = resolveScriptRefs(entry, index);
  return new TwoStateToggle({ unselect: refs._unselect || null, select: refs._select || null });
}


export function threeStateToggleOf(node, index) {
  const entry = scriptsOf(node, 'ThreeStateToggle')[0];
  if (!entry) return null;
  const { refs } = resolveScriptRefs(entry, index);
  return new ThreeStateToggle({ unselect: refs._unselect || null, firstSelect: refs._firstSelect || null, secondSelect: refs._secondSelect || null });
}



export class TwoStateToggle {
  constructor({ unselect = null, select = null } = {}) {
    this.unselect = unselect;
    this.select = select;
    this.selected = false;
    this.inited = false;
  }

  
  set_selected(value) {
    const on = !!value;
    if (this.inited && this.selected === on) return;
    this.inited = true;
    this.selected = on;
    setActive(this.select, on);
    setActive(this.unselect, !on);
  }

  
  toggle() {
    this.set_selected(!this.selected);
  }
}



export class ThreeStateToggle {
  constructor({ unselect = null, firstSelect = null, secondSelect = null } = {}) {
    this.unselect = unselect;
    this.firstSelect = firstSelect;
    this.secondSelect = secondSelect;
    this.state = ThreeStateToggleState.UNSELECT;
    this.inited = false;
  }

  
  _changeState(next) {
    const state = Number(next);
    if (this.inited && this.state === state) return;
    this.inited = true;
    this.state = state;
    setActive(this.unselect, state === ThreeStateToggleState.UNSELECT);
    setActive(this.firstSelect, state === ThreeStateToggleState.FIRST_SELECT);
    setActive(this.secondSelect, state === ThreeStateToggleState.SECOND_SELECT);
  }

  
  set_state(state) {
    this._changeState(state);
  }

  
  toggle() {
    this._changeState(this.state === ThreeStateToggleState.UNSELECT
      ? ThreeStateToggleState.FIRST_SELECT : ThreeStateToggleState.UNSELECT);
  }
}



export class FadeSwitchTween {
  
  constructor({ scene, node, duration = 0.16, activeAlpha = 1, key = null, ignoreTimeScale = true,
    dontDisableGameObject = false, onAfterShow = null, onAfterHide = null } = {}) {
    this.scene = scene;
    this.node = node;
    this.duration = Number(duration) || 0.16;
    this.activeAlpha = Number(activeAlpha) || 1;
    this.key = key || `fade:${node && (node.path || node.name)}`;
    this.ignoreTimeScale = ignoreTimeScale;
    this.dontDisableGameObject = dontDisableGameObject;
    this.onAfterShow = onAfterShow;
    this.onAfterHide = onAfterHide;
    this.isShowing = false;
    this.isTweening = false;
    this.value = 0;
  }

  get isShow() {
    return this.isShowing;
  }

  
  Reset(show) {
    this.scene.motion.cancel(this.key, 'reset');
    this.isTweening = false;
    this.isShowing = !!show;
    this.value = show ? this.activeAlpha : 0;
    this._setActive(!!show);
    this._write();
  }

  
  set_isShow(show) {
    if (show) this.Show(); else this.Hide();
  }

  Show() {
    if (this.isShowing) return;
    this.isShowing = true;
    this._setActive(true);
    this._start(this.value, this.activeAlpha, () => {
      this.isTweening = false;
      if (this.onAfterShow) this.onAfterShow();
    });
  }

  Hide() {
    if (!this.isShowing) return;
    this.isShowing = false;
    this._start(this.value, 0, () => {
      this.isTweening = false;
      this._setActive(false);
      if (this.onAfterHide) this.onAfterHide();
    });
  }

  _start(from, to, done) {
    this.isTweening = true;
    const start = performance.now();
    this.scene.motion.track(this.key, {
      len: this.duration,
      onSample: (t) => {
        const u = this.duration > 0 ? Math.min(1, Math.max(0, t / this.duration)) : 1;

        const k = 1 - (1 - u) * (1 - u);
        this.value = from + (to - from) * k;
        this._write();
      },
      done: () => {
        this.value = to;
        this._write();
        void start;
        done();
      },
      restart: true,
    });
  }

  _setActive(active) {
    if (!this.node) return;
    if (this.dontDisableGameObject && !active) return;
    this.node.active = !!active;
  }

  _write() {
    if (this.node) this.scene.setFade(this.node, this.value);
  }
}


export class UIBiAnimClipSwitchTween {
  
  static builder(clipOn, clipOff) {
    return { clipOn, clipOff, durationOn: 0, durationOff: 0, easeOn: 1, easeOff: 1, tweenFromStart: true };
  }

  
  constructor({ scene, key = 'ui-bi-anim', clipOn = null, clipOff = null, target = null,
    inactivateTargetIfHide = false, onAfterShow = null, onAfterHide = null } = {}) {
    this.scene = scene;
    this.key = key;
    this.clipOn = clipOn;
    this.clipOff = clipOff;
    this.target = target;
    this.inactivateTargetIfHide = inactivateTargetIfHide;
    this.onAfterShow = onAfterShow;
    this.onAfterHide = onAfterHide;
    this.isShowing = false;
    this.isTweening = false;
    this.released = false;
  }

  get isShow() {
    return this.isShowing;
  }

  
  set_isShow(show, force = false) {
    if (show) this.Show(force); else this.Hide(force);
  }

  
  Show(force = false) {
    if (this.released) return;


    if (this.isShowing && !force) return;
    this.isShowing = true;
    this._setTargetActive(true);
    this._play(this.clipOn, 'onAfterShow');
  }

  
  Hide(force = false) {
    if (this.released) return;
    if (!this.isShowing && !force) return;
    this.isShowing = false;
    this._play(this.clipOff, 'onAfterHide', () => {
      this._setTargetActive(false);
    });
  }

  
  Reset(show) {
    this.scene.motion.cancel(this.key, 'reset');
    this.isTweening = false;
    this.isShowing = !!show;
    this._setTargetActive(!!show);
  }

  ClearTween() {
    this.scene.motion.cancel(this.key, 'clear');
    this.isTweening = false;
  }

  Release() {
    this.ClearTween();
    this.released = true;
  }

  _setTargetActive(active) {
    if (!this.target || !this.inactivateTargetIfHide) return;
    this.target.active = !!active;
  }

  _play(location, callback, after = null) {
    if (!location || !location.name) {
      if (callback === 'onAfterHide' && after) after();
      if (this[callback]) this[callback]();
      return;
    }
    this.isTweening = true;
    this.scene.motion.play(this.key, location.name, {
      doc: location.doc,
      basePath: location.basePath,
      done: () => {
        this.isTweening = false;
        if (after) after();
        if (this[callback]) this[callback]();
      },
      onCancel: () => { this.isTweening = false; },
    });
  }
}



export class AnimationWrapper {
  
  constructor({ clips = {}, ownerPath = null, play = null } = {}) {
    this.clips = clips || {};
    this.ownerPath = ownerPath;
    this.play = play;
  }

  
  clip(name) {
    return (this.clips && this.clips[name]) || null;
  }

  
  sampleAt(name, t) {
    const clip = this.clip(name);
    return clip ? { clip, t } : null;
  }

  SampleClipAtBegin(name) {
    return this.sampleAt(name, 0);
  }

  SampleClipAtEnd(name) {
    const clip = this.clip(name);
    return clip ? { clip, t: Number(clip.len) || 0 } : null;
  }

  
  Play(name) {
    const clip = this.clip(name);
    if (!clip) return 0;
    if (this.play) this.play(name);
    return Number(clip.len) || 0;
  }

  
  PlayWithTween(name) {
    this.Play(name);
    return { name, duration: Number(this.clip(name)?.len) || 0, kill: () => {} };
  }
}



export class UIViewStatusDriver {
  
  constructor({ entries = [], resolveClip = null, applyClip = null } = {}) {
    this.entries = entries || [];
    this.resolveClip = resolveClip;
    this.applyClip = applyClip;
    this.lastStatus = null;
    this.lastApplied = 0;
    this.history = [];
  }

  
  static fromPathIdMap(map, { prefab, root }) {
    const byName = new Map();
    for (const entry of (map && map.statusEntries) || []) {
      if (!entry || entry.prefab !== prefab || Number(entry.descriptionType) !== 1) continue;
      const target = entry.targets && entry.targets.gameObject;
      if (!target || !target.resolved || !target.path) continue;
      const rel = String(target.path).replace(new RegExp(`^${prefab}/?`), '');
      const node = findPath(root, rel);
      if (!node) continue;
      const list = byName.get(entry.statusName) || [];
      list.push({ gameObject: node, active: Number(entry.active) || 0 });
      byName.set(entry.statusName, list);
    }
    return new UIViewStatusDriver({
      entries: [...byName].map(([statusName, descriptions]) => ({ statusName, descriptions })),
    });
  }

  HasStatus(statusName) {
    return (this.entries || []).some((e) => e && e.statusName === statusName);
  }

  
  SetStatus(statusName) {
    const entry = (this.entries || []).find((e) => e && e.statusName === statusName);
    if (!entry) {

      this.errors = this.errors || [];
      this.errors.push(`[UIViewStatusDriver] Status not found for name: ${statusName}`);
      return false;
    }
    this.lastStatus = statusName;
    this.lastApplied = 0;
    this.history.push(statusName);
    if (this.history.length > 8) this.history.shift();
    for (const d of entry.descriptions || []) {
      if (!d) continue;
      if (d.gameObject) { setActive(d.gameObject, !!d.active); this.lastApplied += 1; }
      if (d.isSwitchTweenShow && d.switchTween) d.switchTween.set_isShow(true);
      if (d._animationLocation && d._animationLocation.animationName && this.applyClip) {
        this.applyClip(d._animationLocation.animationName, d.animationDelay || 0);
      }
      if (d.image && d.setImageAlpha && d.imageColor) {
        d.image.color = rgbaCss(d.imageColor, d.image.color);
      }
      if (d.text && d.setTextAlpha && d.textColor) {
        d.text.color = rgbaCss(d.textColor, d.text.color);
      }
    }
    return true;
  }
}


function rgbaCss(color, fallback) {
  if (!color) return fallback;
  const hex = (v) => Math.max(0, Math.min(255, Math.round(Number(v) * 255))).toString(16).padStart(2, '0');
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}${hex(color.a)}`.toUpperCase();
}



export class UIAtlasImage {
  constructor(node) {
    this.node = node;
  }

  SetSprite(file, extra) {
    setSprite(this.node, file, extra);
  }

  SetActive(value) {
    setActive(this.node, value);
  }
}



export class SimpleLayoutContent {
  constructor(node) {
    this.node = node;
    this.adapter = null;
  }

  set_adapter(adapter) {
    this.adapter = adapter;
    this.render();
  }

  
  render() {
    if (!this.adapter) return;
    const count = Number(this.adapter.GetCount()) || 0;
    this.node.children = [];
    for (let i = 0; i < count; i += 1) {
      const view = this.adapter.GetView(i, this.node);
      if (view) this.node.children.push(view);
    }
  }

  
  refresh() {
    this.render();
  }
}



export const LEVEL_SPRITES_DISABLED = false;

export class AutoChessShopLevelView {
  
  constructor({ images = [], spritePrefix = 'shop_level', color = null } = {}) {
    this.images = images.filter(Boolean);
    this.spritePrefix = spritePrefix;
    
    this.color = color;
  }

  
  Render(level, skinId = '', isUpgrade = false) {
    const n = Math.max(1, Math.min(6, Math.round(Number(level) || 1)));
    void skinId;
    void isUpgrade;
    if (LEVEL_SPRITES_DISABLED) return n;
    const prefix = this.spritePrefix;
    for (const image of this.images) {
      setSprite(image, `sprites/${prefix}_${n}.webp`, { sprite: `${prefix}_${n}`, ...(this.color ? { color: this.color } : {}) });
    }
    return n;
  }
}



export class ShopCostView {
  
  constructor({ root, index } = {}) {
    this.root = root;
    this.index = index;
    this.enoughToggle = null;
    this.costNum = null;
    this.enoughNum = null;
    this._bind();
  }

  _bind() {
    const root = this.root;
    if (!root) return;
    const normal = nodeByPath(root, 'root_normal');
    const grey = nodeByPath(root, 'root_grey');
    this.normal = normal;
    this.grey = grey;
    this.enoughToggle = new TwoStateToggle({ unselect: grey, select: normal });

    this.costNum = normal && nodeByPath(normal, 'text_num');
    this.costNums = [this.costNum, grey && nodeByPath(grey, 'text_num')].filter(Boolean);
    this.enoughNum = this.costNum;
  }

  
  _enoughIndex() {
    return this.enoughToggle && this.enoughToggle.selected ? 0 : 1;
  }

  
  Render(cost, total) {
    const price = Number(cost) || 0;
    const coin = Number(total) || 0;
    if (this.enoughToggle) this.enoughToggle.set_selected(price <= coin);

    for (const num of this.costNums || []) setText(num, price);
    this.enoughNum = (this.costNums || [])[this._enoughIndex()] || this.costNum;
    return this;
  }

  
  SetPriceColor(color) {
    // The C# cost view keeps two numbers: the normal (enough) number carries the calculated price colour,
    // while the grey (not enough) number stays #C0C5C3. Selecting the grey group must not turn its number red.
    if (this.costNums[0] && this.costNums[0].text && color) {
      this.costNums[0].text = { ...this.costNums[0].text, color };
    }
    if (this.costNums[1] && this.costNums[1].text) {
      this.costNums[1].text = { ...this.costNums[1].text, color: '#C0C5C3' };
    }
    this.enoughNum = this.costNums[0] || this.costNum;
    return this;
  }
}


function nodeByPath(root, path) {
  let node = root;
  for (const part of String(path).split('/').filter(Boolean)) {
    if (!node) return null;
    node = (node.children || []).find((c) => c.name === part) || null;
  }
  return node;
}



export class ShopMoneyView {
  constructor({ root } = {}) {
    this.root = root;
    this.coinNum = root ? nodeByPath(root, 'coin_num') : null;
    this.gainFxDriver = null;
  }

  Render(coinCount, playGainFx = false) {
    if (this.coinNum) setText(this.coinNum, Number(coinCount) || 0);
    if (playGainFx && this.gainFxDriver) this.gainFxDriver.SetStatus('fx_gain_money');
  }
}



export class TwoStateBiAnimationSwitcher {
  
  constructor({ anims = {}, onPlay = null } = {}) {
    this.anims = anims || {};
    this.onPlay = onPlay;
    this.isShow = false;
  }

  
  set_isShow(show) {
    this.isShow = !!show;
    const anim = show ? this.anims._animSelect : this.anims._animUnselect;
    const clip = anim && anim.clip ? anim.clip : null;
    if (clip && this.onPlay) this.onPlay(clip);
    return clip;
  }

  
  set_state(show) {
    return this.set_isShow(show);
  }
}



export class TwoPhaseButtonWidget {
  
  constructor({ onFirstClick = null, onConfirm = null, confirmClip = null, switcher = null } = {}) {
    this.onFirstClick = onFirstClick;
    this.onConfirm = onConfirm;
    this.confirmClip = confirmClip;
    
    this.switcher = switcher;
    
    this.state = 0;
    this.confirming = false;
    this.startedAt = 0;
    
    this.confirmDuration = 1.0;
  }

  
  ConfirmPreClick() {
    this.state = 1;
    this.confirming = true;
    if (this.switcher) this.switcher.set_isShow(true);
  }

  
  Reset() {
    this.state = 0;
    this.confirming = false;
    this.startedAt = 0;
    if (this.switcher) this.switcher.set_isShow(false);
  }

  
  progress(now) {
    if (!this.confirming) return 0;
    return Math.min(1, (now - this.startedAt) / this.confirmDuration);
  }

  
  EventOnClick(now, slotId) {
    if (this.state === 0) {
      this.startedAt = now;
      if (this.onFirstClick) this.onFirstClick(slotId);
      return 'arming';
    }
    if (this.onConfirm) this.onConfirm(slotId);
    return 'confirmed';
  }
}



export const TINT_COLORS = {
  normal: [1, 1, 1, 1],
  hover: [0.9607843160629272, 0.9607843160629272, 0.9607843160629272, 1],
  pressed: [0.7843137383460999, 0.7843137383460999, 0.7843137383460999, 1],
  disabled: [0.7843137383460999, 0.7843137383460999, 0.7843137383460999, 0.501960813999176],
};

export const TINT_FADE = 0.1;


export class UIButton {
  
  constructor({ node = null, onClick = null, interactable = true, guardSeconds = 0, cooldown = 0, signal = '',
    tintRoot = null, tintTargets = [] } = {}) {
    this.node = node;
    this.onClick = onClick;
    this.interactable = interactable;
    this.guardSeconds = Number(guardSeconds) || 0;
    this.cooldown = Number(cooldown) || 0;
    this.signal = signal;
    this.lastPress = -1e9;
    
    this.lastBlocked = null;

    this.tintRoot = tintRoot;
    this.tintTargets = Array.isArray(tintTargets) ? tintTargets : [];
    this.hovered = false;
    this.pressed = false;
    this.tintKind = 'normal';
    this.tint = [...TINT_COLORS.normal];
    this.tintFrom = [...TINT_COLORS.normal];
    this.tintTo = [...TINT_COLORS.normal];
    this.tintStart = 0;
    this.tintT = 1;
    this.tintNodes = null;
  }


  
  /** The prefab's cooldown lock (`cooldown` seconds after a press); a button without one is never on cooldown. */
  IsInCooldown(now = performance.now()) {
    if (!this.cooldown) return false;
    return now - this.lastPress < this.cooldown * 1000;
  }

  /** The prefab's click guard (`guardSeconds`): the per-button debounce of a rapid second press. */
  IsInGuard(now = performance.now()) {
    if (!this.guardSeconds) return false;
    return now - this.lastPress < this.guardSeconds * 1000;
  }

  
  Press(now = performance.now()) {
    if (!this.interactable) return false;
    if (this.IsInCooldown(now) || this.IsInGuard(now)) { this.lastBlocked = now; return false; }
    this.lastPress = now;
    if (this.onClick) this.onClick(now);
    return true;
  }

  
  setHover(value) {
    if (this.hovered === !!value) return;
    this.hovered = !!value;
    this._retarget();
  }

  
  setPressed(value) {
    if (this.pressed === !!value) return;
    this.pressed = !!value;
    this._retarget();
  }

  
  tick(now = performance.now()) {
    if (this.tintT >= 1) return false;
    const u = Math.min(1, (now - this.tintStart) / (TINT_FADE * 1000));
    this.tint = this.tintFrom.map((value, index) => value + (this.tintTo[index] - value) * u);
    this.tintT = u;
    this._applyTint();
    return true;
  }

  _retarget() {
    const kind = this.pressed ? 'pressed' : (this.hovered ? 'hover' : 'normal');
    if (kind === this.tintKind && this.tintT >= 1) return;
    this.tintKind = kind;
    this.tintFrom = [...this.tint];
    this.tintTo = [...TINT_COLORS[kind]];
    this.tintStart = performance.now();
    this.tintT = 0;
  }

  _nodes() {
    if (this.tintNodes) return this.tintNodes;
    if (!this.tintRoot || !this.tintTargets.length) { this.tintNodes = []; return this.tintNodes; }
    this.tintNodes = this.tintTargets.map((path) => findPath(this.tintRoot, path)).filter(Boolean);
    return this.tintNodes;
  }

  _applyTint() {
    const nearWhite = this.tint.every((value, index) => Math.abs(value - TINT_COLORS.normal[index]) < 1e-4);
    for (const node of this._nodes()) node.tintMul = nearWhite ? null : [...this.tint];
  }
}



export class DynFontLoader {
  constructor({ family = 'NotoSansHans-Medium' } = {}) {
    this.family = family;
  }

  Apply(node) {
    if (!node || !node.text) return node;
    node.text = { ...node.text, font: this.family };
    return node;
  }
}
