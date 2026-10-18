// Author flipbooks use Pixi's sprite/quad path on either board, on the same battle clock as official effects.
import { flipbookFrame } from './pluginFormat.js';
import { mergePluginFx } from './pluginLibrary.js';
import { skillRecordOf } from './skills.js';
import { UF } from '../../../../shared/constants.js';

export class PluginFxPlayer {
  constructor({ P, layer, assets, cam, enabled, record, speed, ofx }) {
    Object.assign(this, { P, layer, assets, cam, enabled, record, speed, ofx });
    this.live = new Set(); this.loops = new Map(); this.time = 0; this.textures = new Map();
    // Per-shot arrivals, keyed by the shot object; never a target-wide claim on damage events.
    this.hitClaims = new Map();
    this.source = null; this.catalog = mergePluginFx(null, {});
  }
  refresh() {
    const source = this.assets?.manifest?.fx;
    if (source !== this.source) { this.clear(); this.clearTextures(); this.source = source; this.catalog = mergePluginFx(null, source); }
  }
  binding(v) {
    const rec = this.record(v?.info), idx = v?.info?.diy?.skillIndex ?? v?.info?.skillIndex ?? rec?.skill?.index;
    this.ofx.lib?.notePluginUnit?.(rec?.fx?.unit);
    const sk = skillRecordOf(rec, idx), all = this.catalog.bindings[rec?.charId || v?.info?.diy?.charId];
    return all?.[String(idx)] || all?.[sk?.skillId] || {};
  }
  play(key, at, { owner = null, duration = null, target = null, flight = null, loop = false, done = null } = {}) {
    this.refresh();
    if (!this.enabled() || !at || owner?.destroyed || owner?.alive === false || this.live.size >= 128) return null; // [ASSUMED] 128 plugin instances on either board.
    const b = this.catalog.books.get(key), prefab = this.catalog.descriptors.has(key);
    if (!b && !prefab) return null;
    if (prefab && !this.ofx.active) return null;
    const pos = { x: at.x, y: at.y, z: at.z || 0 };
    const e = { key, b, owner, target, flight, loop, done, pos, start: this.time, end: this.time + (duration ?? (loop ? 600 : b ? b.frames / b.fps : 4)), dead: false, sprite: null, handle: null };
    if (b) {
      let base = this.textures.get(b.url);
      if (!base) { base = this.P.BaseTexture.from(b.url); this.textures.set(b.url, base); }
      e.texture = new this.P.Texture(base);
      e.sprite = new this.P.Sprite(e.texture);
      e.sprite.anchor.set(...(b.anchor || [0.5, 0.5]));
      e.sprite.blendMode = b.blend === 'add' ? this.P.BLEND_MODES.ADD : this.P.BLEND_MODES.NORMAL;
      this.layer.addChild(e.sprite);
    } else {
      e.handle = this.ofx.spawn(key, { pos: [pos.x - 10, pos.y - 9, -pos.z] }, { owner, loop });
      if (!e.handle) return null;
    }
    e.stop = () => { if (e.dead) return; e.dead = true; e.handle?.kill(); e.sprite?.destroy(); e.texture?.destroy(false); this.live.delete(e); };
    this.live.add(e);
    return e;
  }
  phase(v, phase, at = v, options = {}) {
    this.refresh();
    return this.play(this.binding(v)[phase], at, { owner: v, ...options });
  }
  skill(v, on) {
    const id = v?.info?.id ?? v?.id;
    this.loops.get(id)?.stop(); this.loops.delete(id);
    if (!on) return !!this.phase(v, 'skillEnd');
    const start = this.phase(v, 'skillStart');
    const e = this.phase(v, 'skillLoop', v, { loop: true });
    if (e) this.loops.set(id, e);
    return !!(start || e);
  }
  sync(views) {
    if (!this.enabled()) return;
    for (const v of views) {
      const id = v?.info?.id ?? v?.id, on = v.alive !== false && !!((v.flags | 0) & UF.SKILL);
      const held = this.loops.get(id);
      if (!on && held) { held.stop(); this.loops.delete(id); }
      if (on && (!held || held.dead)) {
        const e = this.phase(v, 'skillLoop', v, { loop: true });
        if (e) this.loops.set(id, e);
      }
    }
  }
  attack(src, tgt, kind) {
    if (!src || !tgt) return false;
    const cast = this.phase(src, 'attack');
    if (!kind || kind === 'none') return !!cast;
    // [ASSUMED] Match the generic projectile speed; the event does not carry an authoritative arrival time.
    const flight = Math.max(0.05, Math.min(3, Math.hypot(tgt.x - src.x, tgt.y - src.y) / Math.max(1, this.speed(kind))));
    const projectile = this.phase(src, 'projectile', src, { target: tgt, flight, duration: flight });
    if (this.enabled() && src.alive !== false && !src.destroyed && this.binding(src).hit && this.hitClaims.size < 128) {
      this.hitClaims.set({ src, tgt }, this.time + flight);
    }
    return !!projectile;
  }
  hit(src, target) {
    // [ASSUMED] The damage tuple has no ranged source id. Only an identified source that draws a hit may
    // suppress this event's spark; estimated arrivals cannot claim unrelated ranged, husk or paired damage.
    return src ? !!this.phase(src, 'hit', target) : false;
  }
  simFx(kind, x, y, extra) {
    this.refresh();
    if (kind === 'phase' && this.catalog.silent.has(extra?.kind)) return true;
    if (kind !== 'plugin') return false;
    // A missing/disabled plugin effect is a silent visual no-op, never a procedural fallback.
    if (typeof extra?.skill === 'string') this.play(extra.skill, { x, y }, { duration: Number.isFinite(extra.dur) ? Math.max(0, Math.min(30, extra.dur)) : null });
    return true;
  }
  update(dt) {
    this.refresh();
    if (!this.enabled()) { this.clear(); return; }
    this.time += Math.max(0, dt);
    for (const [shot, at] of this.hitClaims) {
      const { src, tgt } = shot;
      if (src.destroyed || src.alive === false || tgt.destroyed || tgt.alive === false) this.hitClaims.delete(shot);
      else if (at <= this.time) { this.hitClaims.delete(shot); this.phase(src, 'hit', tgt); }
    }
    for (const e of [...this.live]) {
      if (e.owner && (e.owner.destroyed || e.owner.alive === false)) { e.stop(); continue; }
      if (this.time >= e.end) { e.stop(); e.done?.(); continue; }
      const age = this.time - e.start;
      let pos = e.loop && e.owner ? e.owner : e.pos;
      if (e.flight && e.target) { const f = Math.min(1, age / e.flight); pos = { x: e.pos.x + (e.target.x - e.pos.x) * f, y: e.pos.y + (e.target.y - e.pos.y) * f, z: (e.pos.z || 0) + 0.4 }; }
      e.handle?.place({ pos: [pos.x - 10, pos.y - 9, -(pos.z || 0)] });
      if (!e.b) continue;
      const frame = flipbookFrame({ ...e.b, loop: e.loop || !!e.flight || e.b.loop }, age);
      if (!frame) { e.stop(); continue; }
      const base = e.texture.baseTexture;
      if (!base.valid) { e.sprite.visible = false; continue; }
      const w = e.b.w / e.b.cols, h = e.b.h / frame.rows;
      e.texture.frame = new this.P.Rectangle(frame.col * w, frame.row * h, w, h);
      const p = this.cam().project(pos.x, pos.y, (pos.z || 0) + 0.4);
      e.sprite.visible = true; e.sprite.position.set(p.x, p.y);
      e.sprite.width = p.s * (e.b.scale ?? 1); e.sprite.height = e.sprite.width * h / w;
    }
  }
  clear() { for (const e of [...this.live]) e.stop(); this.loops.clear(); this.hitClaims.clear(); }
  clearTextures() { for (const base of this.textures.values()) base.destroy(); this.textures.clear(); }
  destroy() { this.clear(); this.clearTextures(); }
}
