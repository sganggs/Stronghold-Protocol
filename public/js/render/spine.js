// render/spine.js — Spine battle chibi wrapper + animation state machine (research 07 §5.4–5.5, ASSETS.md Roles).
//
// SpineActor owns one PIXI.spine.Spine built from cached skeleton data (assets.spine LRU; the instance never
// owns the atlas, so destroying it never frees shared textures). Animation roles come from the manifest
// (`anims`: idle, deploy, attack{begin,loop,end}, attackDown, skill{begin,loop,end,idle}, die, move, stun).
//
// Driving (units.js calls these; the sim is authoritative, the actor only visualises):
//   setBase('idle'|'move'|'stun')        the resting state from the snapshot anim code
//   attack(interval)                      one attack happened now (b.ev 'atk'): plays begin→loop, re-phases the loop
//                                         so its OnAttack frame lands now, timeScale = loopDuration / interval
//   setSkill(on)                          skill begin→loop while active (skill idle replaces idle), end on stop
//   deploy()                              'Start' once, then base
//   die()                                 die clip once (callers fade out afterwards)
//   stunned (setBase('stun'))             stun clip, or the current track frozen at timeScale 0
//   setForm(roles, change)                another clip set of the skeleton (an enemy's mode), after a change clip
//   update(dt)                            advances the skeleton (autoUpdate is off: one clock for everything)
// Attack mode lasts until ~1.4 attack intervals without a new attack, then the end clip (if any) and base.

const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Longest wind-up compression (× the rhythm speed) when the look-ahead is shorter than the natural wind-up. */
export const MAX_WIND_SPEEDUP = 2.5;

/**
 * Attack clip timing (pure). `loopDur` / `hit` are clip seconds (strike frame at `hit`), `interval` and `lead` game
 * seconds. The clip plays at `ts = loopDur / interval` (one loop per attack); started `lead` before the attack it
 * reaches the strike frame on time: from `start = hit − lead·ts` at `ts` when little of the wind-up is lost,
 * otherwise from (nearly) the beginning at up to MAX_WIND_SPEEDUP × ts (`tsWind`).
 * @returns {{ ts: number, tsWind: number, start: number }}
 */
export function windUpPlan(loopDur, hit, interval, lead) {
  const ts = clampN(loopDur / Math.max(0.08, interval), 0.35, 4);
  const L = Math.max(0, lead);
  let start = Math.max(0, hit - L * ts), tsWind = ts;
  if (start > hit * 0.15 && L > 0) {
    tsWind = Math.min(ts * MAX_WIND_SPEEDUP, hit / L);
    start = Math.max(0, hit - L * tsWind);
  }
  return { ts, tsWind, start };
}

/** Whether any skin of the skeleton data has a clipping attachment (pixi-spine AttachmentType.Clipping = 6). */
export function hasClipping(data) {
  try {
    for (const skin of data?.skins || []) {
      const list = typeof skin.getAttachments === 'function' ? skin.getAttachments() : [];
      for (const e of list) {
        const a = e && e.attachment;
        if (a && (a.type === 6 || a.constructor?.name === 'ClippingAttachment' || ('endSlot' in a && 'vertices' in a && !('uvs' in a)))) return true;
      }
    }
  } catch { /* unknown runtime shape: assume none */ }
  return false;
}

export class SpineActor {
  /**
   * @param {any} spineData PIXI.spine skeleton data
   * @param {object} entry manifest Spine entry (anims, animations, hits, bounds, pma)
   */
  constructor(spineData, entry) {
    const P = globalThis.PIXI;
    this.entry = entry;
    this.roles = entry.anims || {};
    this.durations = entry.animations || {};
    this.spine = new P.spine.Spine(spineData);
    this.spine.autoUpdate = false;
    this.names = new Set((spineData.animations || []).map((a) => a.name));
    /**
     * Clipping attachments render as stencil masks (≈1.5 ms of GPU each per frame on tiled GPUs): such skeletons
     * are drawn through the impostor atlas while clipping is on, and clipping is switched off (unclipped slots,
     * visually negligible on battle chibis) when too many of them share a field (app.js budget).
     */
    this.clipped = hasClipping(spineData);
    this.clipOn = true;
    if (this.clipped) {
      const sp = this.spine;
      const orig = typeof sp.createGraphics === 'function' ? sp.createGraphics.bind(sp) : null;
      if (orig) sp.createGraphics = (slot, att) => { const g = orig(slot, att); if (!this.clipOn && slot.clippingContainer) { slot.clippingContainer.mask = null; g.renderable = false; } return g; };
    }
    try { this.spine.stateData.defaultMix = 0.12; } catch { /* ignore */ }
    this.base = 'idle';
    this.mode = 'base';           // base | attack | skillBegin | deploy | die | stun
    this.skillOn = false;
    this.attackUntil = 0;
    this.clock = 0;
    this.current = '';
    this.frozen = false;
    this.dead = false;
    this.interval = 1;
    this._play(this._idleName(), true);
  }

  /** Enable / disable the skeleton's clipping masks. */
  setClipping(on) {
    on = !!on;
    if (!this.clipped || on === this.clipOn) return;
    this.clipOn = on;
    for (const slot of this.spine?.skeleton?.slots || []) {
      if (!slot.clippingContainer) continue;
      slot.clippingContainer.mask = on ? slot.currentGraphics || null : null;
      // PIXI makes a released mask renderable again: the clip polygon must never draw as a white shape
      if (slot.currentGraphics) slot.currentGraphics.renderable = false;
    }
  }

  /**
   * The equipped skill (DESIGN §16 loadout, UnitInfo.skillIndex): its own Spine clip when the model has one per skill
   * index (`anims.skills`), else the primary skill's clip.
   * @param {number|undefined} index 0-based skill index
   */
  setSkillIndex(index) {
    const anims = this.entry?.anims || {};
    const clip = Number.isInteger(index) && anims.skills ? anims.skills[String(index)] : null;
    this.roles = clip ? { ...anims, skill: clip } : anims;
  }

  /**
   * Another clip set of the same skeleton — an enemy's mode (render/units.js FORMS: 掠海漂移体's 爬行模式 plays its *_02
   * clips): `roles` override the manifest roles (null = back to them); `change` = a transition clip played once first
   * (also while stunned: the pose it ends in is the one a stun then holds).
   */
  setForm(roles, change = null) {
    const anims = this.entry?.anims || {};
    this.roles = roles ? { ...anims, ...roles } : anims;
    if (this.dead) return;
    if (change && this.has(change)) {
      this.stunWanted = this.mode === 'stun';
      this.frozen = false;
      this.mode = 'change';
      this._play(change, false, { mix: 0.08 });
      this.changeUntil = this.clock + this.dur(change);
    } else if (this.mode === 'base') this._play(this._baseName(), true);
    else if (this.mode === 'stun' && this.has(this.roles.stun?.loop)) this._play(this.roles.stun.loop, true);
  }

  has(name) { return !!name && this.names.has(name); }
  dur(name) { const d = this.durations[name]; return typeof d === 'number' && d > 0 ? d : this._durFromData(name); }

  _durFromData(name) {
    try { const a = this.spine.spineData.findAnimation(name); return a && a.duration > 0 ? a.duration : 1; } catch { return 1; }
  }

  _idleName() {
    const sk = this.roles.skill;
    if (this.skillOn && sk && this.has(sk.idle)) return sk.idle;
    return this.has(this.roles.idle) ? this.roles.idle : (this.has('Idle') ? 'Idle' : [...this.names][0]);
  }

  _baseName() {
    if (this.base === 'move') {
      const mv = this.roles.move;
      if (mv && this.has(mv.loop)) return mv.loop;
    }
    return this._idleName();
  }

  _play(name, loop, { timeScale = 1, mix, track = 0, start = 0 } = {}) {
    if (!this.has(name)) return false;
    const st = this.spine.state;
    const e = st.setAnimation(track, name, loop);
    if (e) {
      e.timeScale = timeScale;
      if (mix != null) e.mixDuration = mix;
      if (start) e.trackTime = start;
    }
    this.current = name;
    return true;
  }

  _queue(name, loop, timeScale = 1) {
    if (!this.has(name)) return false;
    const e = this.spine.state.addAnimation(0, name, loop, 0);
    if (e) e.timeScale = timeScale;
    return true;
  }

  /** Resting state from the snapshot. */
  setBase(base) {
    if (this.dead) return;
    const b = base === 'move' || base === 'stun' ? base : 'idle';
    // a mode change clip plays out first; the resting state it lands in is remembered
    if (this.mode === 'change') { this.stunWanted = b === 'stun'; if (b !== 'stun') this.base = b; return; }
    if (b === 'stun') { this._enterStun(); return; }
    if (this.mode === 'stun') this._leaveStun();
    if (b === this.base && this.mode !== 'stun') return;
    this.base = b;
    if (this.mode === 'base') this._play(this._baseName(), true);
  }

  _enterStun() {
    if (this.mode === 'stun') return;
    this.mode = 'stun';
    const s = this.roles.stun;
    if (s && this.has(s.loop)) {
      if (this.has(s.begin)) { this._play(s.begin, false); this._queue(s.loop, true); }
      else this._play(s.loop, true);
    } else {
      this.frozen = true;
    }
  }

  _leaveStun() {
    this.frozen = false;
    this.mode = 'base';
    this._play(this._baseName(), true);
  }

  /**
   * An attack is due in `lead` game seconds (the renderer sees it ahead in the snapshot buffer): start the attack
   * clip from its wind-up so the strike frame lands when the attack event is rendered. Returns true once started;
   * false when it is still too early (call again next frame) or there is nothing to wind up.
   */
  windUp(interval, lead) {
    if (this.dead || this.mode === 'stun' || this.mode === 'die' || this.mode === 'change' || !(lead >= 0)) return false;
    const clip = this._attackClip();
    if (!clip) return false;
    if (this.mode === 'attack' && this.current === clip.loop) return false; // in rhythm: attack() re-phases
    const iv = clampN(Number.isFinite(interval) && interval > 0 ? interval : this.interval, 0.08, 8);
    const loopDur = this.dur(clip.loop);
    const hit = this._hitTime(clip.loop, loopDur);
    const plan = windUpPlan(loopDur, hit, iv, lead);
    if (!(hit > 0) || lead * plan.ts > hit + 1e-6) return false;
    this.interval = iv;
    this.mode = 'attack';
    this.attackUntil = this.clock + lead + Math.max(0.45, iv * 1.4);
    this._play(clip.loop, true, { timeScale: plan.tsWind, start: plan.start, mix: 0.06 });
    this.windTs = plan.ts;
    this.windUntil = this.clock + lead;
    return true;
  }

  /** An attack happened now. `interval` = seconds between attacks (game time already scaled to real). */
  attack(interval) {
    if (this.dead || this.mode === 'stun' || this.mode === 'die' || this.mode === 'change') return;
    this.interval = clampN(Number.isFinite(interval) && interval > 0 ? interval : this.interval, 0.08, 8);
    const clip = this._attackClip();
    if (!clip) return;
    const loopDur = this.dur(clip.loop);
    const ts = clampN(loopDur / this.interval, 0.35, 4);
    const hit = this._hitTime(clip.loop, loopDur);
    const wasAttacking = this.mode === 'attack' && this.current === clip.loop;
    this.mode = 'attack';
    this.attackUntil = this.clock + Math.max(0.45, this.interval * 1.4);
    this.windUntil = null;
    if (!wasAttacking) {
      // not wound up (no look-ahead, e.g. a batch that arrived late): the sim already resolved the hit, so show
      // the strike frame now
      this._play(clip.loop, true, { timeScale: ts, start: hit, mix: 0.06 });
    } else {
      const e = this.spine.state.tracks[0];
      if (e) {
        e.timeScale = ts;
        // re-phase gently so the strike frame lines up with this attack
        const t = e.trackTime % loopDur;
        let d = hit - t;
        if (d > loopDur / 2) d -= loopDur; else if (d < -loopDur / 2) d += loopDur;
        e.trackTime += d * 0.8;
      }
    }
  }

  _attackClip() {
    const sk = this.roles.skill;
    if (this.skillOn && sk && this.has(sk.loop) && sk.via !== 'attack' && !this._skillIsBuffOnly()) return sk;
    const a = this.roles.attack;
    if (a && this.has(a.loop)) return a;
    return null;
  }

  // Skill loops that are pure stances (no OnAttack in the loop) are still valid attack visuals during a skill;
  // only an idle-typed skill loop is treated as buff-only.
  _skillIsBuffOnly() {
    const sk = this.roles.skill;
    return !!sk && sk.loop === this.roles.idle;
  }

  _hitTime(anim, dur) {
    const hits = this.entry.hits && this.entry.hits[anim];
    if (Array.isArray(hits) && hits.length && Number.isFinite(hits[0])) return clampN(hits[0], 0, dur);
    return dur * 0.5;
  }

  /** Skill active flag changed. */
  setSkill(on) {
    on = !!on;
    if (on === this.skillOn || this.dead) return;
    this.skillOn = on;
    const sk = this.roles.skill;
    if (this.mode === 'stun' || this.mode === 'die') return;
    if (on && sk) {
      if (this.has(sk.begin)) {
        this.mode = 'skillBegin';
        this._play(sk.begin, false, { mix: 0.08 });
        this.skillBeginUntil = this.clock + this.dur(sk.begin);
        if (this.has(sk.loop)) this._queue(sk.loop, true);
      } else if (this.mode === 'base') this._play(this._baseName(), true);
    } else if (!on && sk) {
      if (this.has(sk.end)) {
        this.mode = 'skillEnd';
        this._play(sk.end, false, { mix: 0.08 });
        this.skillEndUntil = this.clock + this.dur(sk.end);
      } else {
        this.mode = 'base';
        this._play(this._baseName(), true);
      }
    }
  }

  deploy() {
    if (this.dead) return;
    const d = this.roles.deploy;
    if (this.has(d) && d !== this.roles.idle) {
      this.mode = 'deploy';
      this._play(d, false, { mix: 0 });
      this.deployUntil = this.clock + this.dur(d);
    }
  }

  /** Play the death clip; returns its duration (0 when there is none). */
  die() {
    if (this.dead) return 0;
    this.dead = true;
    this.frozen = false;
    this.mode = 'die';
    const d = this.roles.die || (this.has('Die') ? 'Die' : null);
    if (d && this.has(d)) { this._play(d, false, { mix: 0.05 }); return this.dur(d); }
    return 0;
  }

  /** Revive (redeploy after death). */
  revive() {
    this.dead = false;
    this.mode = 'base';
    this.skillOn = false;
    this._play(this._baseName(), true);
  }

  update(dt) {
    this.clock += dt;
    if (this.windUntil != null && this.clock >= this.windUntil) {
      // a compressed wind-up reached its strike frame: back to the rhythm speed (attack() also does it)
      this.windUntil = null;
      const e = this.spine.state.tracks[0];
      if (e && this.mode === 'attack') e.timeScale = this.windTs;
    }
    switch (this.mode) {
      case 'attack':
        if (this.clock > this.attackUntil) {
          this.mode = 'base';
          const clip = this._attackClip() || this.roles.attack;
          if (clip && this.has(clip.end)) { this._play(clip.end, false); this._queue(this._baseName(), true); }
          else this._play(this._baseName(), true, { mix: 0.15 });
        }
        break;
      case 'skillBegin':
        if (this.clock >= this.skillBeginUntil) { this.mode = 'base'; if (!this.has(this.roles.skill?.loop)) this._play(this._baseName(), true); }
        break;
      case 'skillEnd':
        if (this.clock >= this.skillEndUntil) { this.mode = 'base'; this._play(this._baseName(), true); }
        break;
      case 'deploy':
        if (this.clock >= this.deployUntil) { this.mode = 'base'; this._play(this._baseName(), true); }
        break;
      case 'change':
        if (this.clock >= this.changeUntil) {
          this.mode = 'base';
          if (this.stunWanted) { this.stunWanted = false; this._enterStun(); } else this._play(this._baseName(), true);
        }
        break;
      default: break;
    }
    if (!this.frozen) {
      try { this.spine.update(dt); } catch { /* a broken skeleton must not stop the frame */ }
    }
  }

  /** Model height in skeleton units (setup-pose bounds, else a chibi default). */
  get height() {
    const b = this.entry.bounds;
    if (b && Number.isFinite(b.height) && b.height > 20) return Math.min(b.height, 900);
    return 380;
  }

  destroy() {
    try { this.spine.destroy({ children: true, texture: false, baseTexture: false }); } catch { /* ignore */ }
    this.spine = null;
  }
}
