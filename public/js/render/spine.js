// render/spine.js — Spine battle chibi wrapper + animation state machine (research 07 §5.4–5.5, ASSETS.md Roles).
//
// SpineActor owns one PIXI.spine.Spine built from cached skeleton data (assets.spine LRU; the instance never
// owns the atlas, so destroying it never frees shared textures). Animation roles come from the manifest
// (`anims`: idle, deploy, attack{begin,loop,end}, attackDown, skill{begin,loop,end,idle}, die, move, stun).
//
// Driving (units.js calls these; the sim is authoritative, the actor only visualises):
//   setBase('idle'|'move'|'stun')        the resting state from the snapshot anim code
//   attack(interval, once)                one attack happened now (b.ev 'atk'): plays begin→loop, re-phases the loop
//                                         so its OnAttack frame lands now, timeScale = loopDuration / interval;
//                                         `once` (a one-off cast, style.js PROJ[kind].once — 暴鸰's bomb drop): the
//                                         clip plays once at its own speed, then base; `clipPerAttack` (enemies,
//                                         GitHub #58): every attack plays the clip once — at its own speed, faster
//                                         only when the attacks come quicker than the clip —, then base (Move while
//                                         the sim walks it: it stands for that clip, server/sim/ai.js attackStand)
//   setSkill(on)                          skill begin, then — when the skill has an idle clip of its own (skill.idle,
//                                         not its loop) — that idle between attacks, its loop (the skill's attack clip)
//                                         only on attacks (community report #23: 折桠's S2 jump attack looped with no
//                                         enemy engaged); end on stop. A skill clip with NEITHER a Begin nor an own Idle
//                                         (德克萨斯 剑雨 and the other 58 instant skills: anims.skill {begin:null,
//                                         loop:'Skill', end:null}) plays that clip once for its own length: an instant
//                                         skill's flag is off again within the same 0.5 s window (sim skills.js), so
//                                         without this the actor fell through to its idle and played no skill clip at
//                                         all (player report).
//   deploy()                              'Start' once, then base
//   die()                                 die clip once (callers fade out afterwards); a skeleton without one holds its
//                                         idle clip's first frame (GitHub issue #25: the attack loop went on)
//   stunned (setBase('stun'))             stun clip, or the current track frozen at timeScale 0
//   setForm(roles, change, end)           another clip set of the skeleton (an enemy's mode, a 傀儡师's 替身), after a change clip
//                                         (no attack cuts the change clip short); `end` = { clip, in, roles? }: a
//                                         closing clip timed to end `in` s from now (a 重生's last clip ends with the
//                                         重生), landing in `roles`
//   update(dt)                            advances the skeleton (autoUpdate is off: one clock for everything)
//   poseHeld()                            true while the pose cannot change (render/units.js then neither re-poses nor
//                                         redraws the model, only advances `clock`)
// Attack mode lasts until ~1.4 attack intervals without a new attack (a `once` cast and every attack of a
// `clipPerAttack` actor: to the end of its clip), then the end clip (if any) and base — except the attacks of a skill
// with its own idle clip, which go straight back to that idle: the skill's end clip closes the skill, not each spell of
// attacks while it runs.

const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Longest wind-up compression (× the rhythm speed) when the look-ahead is shorter than the natural wind-up. */
export const MAX_WIND_SPEEDUP = 2.5;

/** Floor for the one-shot window of a skill clip with no Begin / own Idle (a very short clip still gets frames). */
const SKILL_CLIP_MIN = 0.2;

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

/** A clipping attachment (pixi-spine AttachmentType.Clipping = 6). */
const isClip = (a) => !!a && (a.type === 6 || a.constructor?.name === 'ClippingAttachment' || ('endSlot' in a && 'vertices' in a && !('uvs' in a)));

/** Whether any skin of the skeleton data has a clipping attachment. */
export function hasClipping(data) {
  try {
    for (const skin of data?.skins || []) {
      const list = typeof skin.getAttachments === 'function' ? skin.getAttachments() : [];
      for (const e of list) if (isClip(e && e.attachment)) return true;
    }
  } catch { /* unknown runtime shape: assume none */ }
  return false;
}

/**
 * Is (x, y) inside the polygon of `n` points `pts` (flat [x0, y0, x1, y1, …])? Ray casting (PR #384 by @Convey123).
 */
export function pointInPolygon(x, y, pts, n) {
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1], xj = pts[j * 2], yj = pts[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * World centre of what a slot draws, into `out` ([x, y]); false when it draws nothing measurable. A mesh: the mean of its
 * world vertices (`buf` grows to fit); a region: its quad's centre — the attachment's (x, y) through the bone (the four
 * corners sit symmetrically around it; RegionAttachment.computeWorldVertices takes a bone in runtime 3.8, a slot in 4.1).
 */
function slotCentre(slot, att, buf, out) {
  const n = att.worldVerticesLength | 0;
  if (n >= 2 && typeof att.computeWorldVertices === 'function') {
    if (buf.v.length < n) buf.v = new Float32Array(n);
    const v = buf.v;
    att.computeWorldVertices(slot, 0, n, v, 0, 2);
    let cx = 0, cy = 0;
    for (let k = 0; k < n; k += 2) { cx += v[k]; cy += v[k + 1]; }
    out[0] = cx / (n >> 1); out[1] = cy / (n >> 1);
  } else if (att.region !== undefined && Number.isFinite(att.x) && Number.isFinite(att.y) && slot.bone) {
    const b = slot.bone;
    out[0] = b.a * att.x + b.b * att.y + b.worldX; out[1] = b.c * att.x + b.d * att.y + b.worldY;
  } else return false;
  return Number.isFinite(out[0]) && Number.isFinite(out[1]);
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
     * are drawn through the impostor atlas while clipping is on, and clipping is switched off when too many of them
     * share a field (app.js budget) — then _eyeMaskFallback hides what a closed eyelid would cut (GitHub #177).
     */
    this.clipped = hasClipping(spineData);
    this.clipOn = true;
    this._clipHidden = new Set(); // slot indexes the eyelid fallback hid in its last pass (_eyeMaskFallback)
    if (this.clipped) {
      const sp = this.spine;
      const orig = typeof sp.createGraphics === 'function' ? sp.createGraphics.bind(sp) : null;
      if (orig) sp.createGraphics = (slot, att) => { const g = orig(slot, att); if (!this.clipOn && slot.clippingContainer) { slot.clippingContainer.mask = null; g.renderable = false; } return g; };
    }
    try { this.spine.stateData.defaultMix = 0.12; } catch { /* ignore */ }
    this.base = 'idle';
    this.mode = 'base';           // base | attack | skillBegin | deploy | die | stun | change
    this.endClip = null;          // setForm's closing clip, played as a change clip once the clock reaches endAt,
    this.endAt = 0;               // landing in endRoles (the next form's) when given
    this.endRoles = null;
    this.skillIndex = null;       // the skill slot whose clip `skill` plays (setSkillIndex), null = the manifest's primary
    this.runMode = false;         // move on the model's own Run cycle (setRunMode)
    this.formRoles = null;        // the clip set of the form in force (setForm), over the unit's own roles
    this.skillOn = false;
    this.skillClipOnce = false;    // skillBegin: the skill's own clip plays once (a clip with no Begin / own Idle)
    this.skillEndPending = false;  // … and the skill turned off inside it: play its End clip / base when it ends
    this.attackUntil = 0;
    this.clock = 0;
    this.current = '';
    this.frozen = false;
    this.dead = false;
    this.interval = 1;
    /**
     * Enemies (render/units.js, GitHub #58): each attack plays the attack clip once — at its own speed, faster only when
     * the attacks come quicker than the clip — and then the resting state; the sim stands the enemy for exactly that
     * clip (server/sim/ai.js attackStand). Off (operators): the clip loops over the attack rhythm.
     */
    this.clipPerAttack = false;
    this.wound = false;           // clipPerAttack: wound up for the coming attack (windUp → attack)
    this._applied = false;        // an update has posed the skeleton since its clip last changed (poseHeld)
    this._appliedTint = undefined; // the tint that update put on the slots (pixi-spine applies `tint` in update)
    this._play(this._idleName(), true);
  }

  /** Enable / disable the skeleton's clipping masks. */
  setClipping(on) {
    on = !!on;
    if (!this.clipped || on === this.clipOn) return;
    this.clipOn = on;
    if (on) this._showClipHidden();   // the stencil takes over from the eyelid fallback
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
    this.skillIndex = Number.isInteger(index) ? index : null;
    this._applyRoles();
  }

  /**
   * A fast mover walks on its model's own Run cycle (`anims.run`; PR #275 by @xcdoge): 猎狗pro (moveSpeed 1.9, 行动速度很快)
   * ships Move_Loop 0.80 s next to Run_Loop 0.53 s. Composes with setSkillIndex; a model without a Run cycle is unchanged.
   */
  setRunMode(on) {
    this.runMode = !!on;
    this._applyRoles();
  }

  /** The unit's own roles (the manifest's, its skill slot's clip and the Run cycle applied) under the form in force. */
  _applyRoles() {
    const anims = this.entry?.anims || {};
    const clip = Number.isInteger(this.skillIndex) && anims.skills ? anims.skills[String(this.skillIndex)] : null;
    const run = this.runMode && anims.run ? anims.run : null;
    const base = clip || run ? { ...anims } : anims;
    if (clip) base.skill = clip;
    if (run) base.move = run;
    this.baseRoles = base;
    this.roles = this.formRoles ? { ...base, ...this.formRoles } : base;
  }

  /** The unit's own roles: the manifest's with its skill slot's clip (setSkillIndex) and Run cycle — what a form ends in. */
  _baseRoles() { return this.baseRoles || this.entry?.anims || {}; }

  /**
   * Another clip set of the same skeleton — an enemy's mode (render/units.js FORMS: 掠海漂移体's 爬行模式 plays its *_02
   * clips), a 傀儡师's 替身: `roles` override the unit's own roles (null = back to them — the equipped skill's clip
   * included); `change` = a transition clip played once first (also while stunned: the pose it ends in is the one a stun
   * then holds). `end` = { clip, in, roles? } (game s): a closing clip played the same way so that it ends `in` s from
   * now, landing in `roles` — a leader's 重生 ends on its last clip while the sim still holds it, and the next form
   * starts on its own clips.
   */
  setForm(roles, change = null, end = null) {
    const anims = this._baseRoles();
    this.formRoles = roles || null;   // kept over a later skill slot (_applyRoles)
    this.roles = roles ? { ...anims, ...roles } : anims;
    this.endClip = null;
    if (this.dead) return;
    if (end && this.has(end.clip) && end.in > 0) {
      this.endClip = end.clip;
      this.endAt = this.clock + Math.max(0, end.in - this.dur(end.clip));
      this.endRoles = end.roles || null;
    }
    if (change && this.has(change)) this._change(change);
    else if (this.mode === 'base') this._play(this._baseName(), true);
    else if (this.mode === 'stun' && this.has(this.roles.stun?.loop)) this._play(this.roles.stun.loop, true);
  }

  /**
   * Re-pose on the clip set in force right after an immediate form switch (render/units.js STEALTH_FORMS: 假想敌：骨刺's
   * stealth bit; PR #365): a running attack goes on in the new set's attack clip at the same point relative to its
   * strike frame (a pending wind-up still strikes at windUntil), a stun / the resting state restarts on the new set's
   * clip without a crossfade, and the skeleton is posed at once — also while a freeze holds it (`frozen`).
   */
  syncFormPose() {
    if (this.dead) return;
    if (this.mode === 'attack') {
      const track = this.spine.state.tracks[0];
      const clip = this._attackClip();
      if (!track || !clip) return;
      const dur = this.dur(clip.loop);
      const oldHit = this._hitTime(this.current, this.dur(this.current));
      const hit = this._hitTime(clip.loop, dur);
      const start = clampN(track.trackTime + hit - oldHit, 0, dur);
      const lead = this.wound && this.windUntil != null
        ? Math.max(0, this.windUntil - this.clock) : 0;
      const ts = lead > 0 ? Math.max(0, hit - start) / lead : track.timeScale;
      const tailTs = lead > 0 ? this.windTs : ts;
      this._play(clip.loop, track.loop, { start, timeScale: ts, mix: 0 });
      this.attackUntil = this.clock + lead +
        Math.max(0, dur - (lead > 0 ? hit : start)) / tailTs;
    } else if (this.mode === 'stun') {
      const name = this.has(this.roles.stun?.loop) ? this.roles.stun.loop : this._baseName();
      this._play(name, true, { mix: 0 });
    } else if (this.mode === 'base') {
      this._play(this._baseName(), true, { mix: 0 });
    } else {
      return;
    }
    // Apply the new attachments even when normal updates are frozen.
    this.spine.update(0);
  }

  /** Play a form's transition clip once; attacks and the resting state wait for it (mode 'change'). */
  _change(clip) {
    if (this.mode !== 'change') this.stunWanted = this.mode === 'stun';
    this.frozen = false;
    this.mode = 'change';
    this._play(clip, false, { mix: 0.08 });
    this.changeUntil = this.clock + this.dur(clip);
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
    this._applied = false;
    return true;
  }

  _queue(name, loop, timeScale = 1) {
    if (!this.has(name)) return false;
    const e = this.spine.state.addAnimation(0, name, loop, 0);
    if (e) e.timeScale = timeScale;
    this._applied = false;
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
  windUp(interval, lead, once = false) {
    if (this.dead || this.mode === 'stun' || this.mode === 'die' || this.mode === 'change' || !(lead >= 0)) return false;
    const clip = this._attackClip();
    if (!clip) return false;
    const single = once || this.clipPerAttack;
    // in rhythm: attack() re-phases; a clip-per-attack actor starts each attack's clip anew unless already wound up for it
    if (this.mode === 'attack' && this.current === clip.loop && (!this.clipPerAttack || once || this.wound)) return false;
    const loopDur = this.dur(clip.loop);
    // a one-off cast plays at the clip's own speed (one loop per clip length), whatever the attack rhythm
    const iv = once ? loopDur : clampN(Number.isFinite(interval) && interval > 0 ? interval : this.interval, 0.08, 8);
    const hit = this._hitTime(clip.loop, loopDur);
    // clip per attack: its own speed, sped up only when the attacks come quicker than the clip
    const plan = windUpPlan(loopDur, hit, this.clipPerAttack && !once ? Math.min(iv, loopDur) : iv, lead);
    if (!(hit > 0) || lead * plan.ts > hit + 1e-6) return false;
    if (!once) this.interval = iv;
    this.mode = 'attack';
    this.attackUntil = this.clock + lead + (single ? Math.max(0, loopDur - hit) / plan.ts : Math.max(0.45, iv * 1.4));
    this._play(clip.loop, !single, { timeScale: plan.tsWind, start: plan.start, mix: 0.06 });
    this.windTs = plan.ts;
    this.windUntil = this.clock + lead;
    this.wound = true;
    return true;
  }

  /**
   * An attack happened now. `interval` = seconds between attacks (game time already scaled to real); `once` = a one-off
   * cast (no rhythm): the clip plays once at its own speed from its strike frame, then the resting state.
   */
  attack(interval, once = false) {
    if (this.dead || this.mode === 'stun' || this.mode === 'die' || this.mode === 'change') return;   // a form change plays out
    if (!once) this.interval = clampN(Number.isFinite(interval) && interval > 0 ? interval : this.interval, 0.08, 8);
    const clip = this._attackClip();
    if (!clip) return;
    const loopDur = this.dur(clip.loop);
    const per = this.clipPerAttack && !once;
    const single = once || per;
    // clip per attack: its own speed (ts 1), faster only when the attacks come quicker than the clip
    const ts = once ? 1 : per ? clampN(loopDur / Math.min(this.interval, loopDur), 1, 4) : clampN(loopDur / this.interval, 0.35, 4);
    const hit = this._hitTime(clip.loop, loopDur);
    // (a clip-per-attack actor still playing the previous attack's clip was not wound up for this one)
    const wasAttacking = this.mode === 'attack' && this.current === clip.loop && (!per || this.wound);
    this.mode = 'attack';
    this.attackUntil = this.clock + (single ? Math.max(0, loopDur - hit) / ts : Math.max(0.45, this.interval * 1.4));
    this.windUntil = null;
    this.wound = false;
    if (!wasAttacking) {
      // not wound up (no look-ahead, e.g. a batch that arrived late): the sim already resolved the hit, so show the
      // strike frame now — unless a clip-per-attack actor's rhythm leaves room for the whole clip (interval ≥ clip):
      // then the clip plays complete from its wind-up at its own speed, the strike a little late (重犯's iron ball
      // lifts before the slam; #246 by @TsangAsuna, accepted by the owner on 2026-10-07)
      const whole = per && this.interval >= loopDur;
      if (whole) this.attackUntil = this.clock + loopDur / ts;
      this._play(clip.loop, !single, { timeScale: ts, start: whole ? 0 : hit, mix: 0.06 });
    } else if (single) {
      const e = this.spine.state.tracks[0];
      if (e) e.timeScale = ts;
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

  /**
   * The running skill's own idle clip when its attacks are its loop clip (anims skill.idle ≠ skill.loop: 折桠's
   * Skill_2_Idle beside the Skill_2_Loop jump attack, 史尔特尔's Skill_3_Idle, 耀骑士临光's Skill_3_Idle …): the pose
   * between its attacks. null otherwise — no skill on, no idle clip, or the loop is that idle (蕾缪安's S2 / S3).
   */
  _skillIdle() {
    const sk = this.roles.skill;
    if (!this.skillOn || !sk || sk.idle === sk.loop || !this.has(sk.idle)) return null;
    return this._attackClip() === sk ? sk.idle : null;
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
    // a skill that ends as the unit (re)deploys — 乌尔比安's 【返回】 is a 【移动】 (sim Battle.moveRedeploy) right before
    // his S3's 'skill' off event — lets the deploy clip play out (then the plain idle) instead of cutting it with the End
    if (!on && this.mode === 'deploy') return;
    if (on && sk) {
      this.skillEndPending = false;
      this.skillClipOnce = false;
      if (this.has(sk.begin)) {
        this.mode = 'skillBegin';
        this._play(sk.begin, false, { mix: 0.08 });
        this.skillBeginUntil = this.clock + this.dur(sk.begin);
        // then the skill's own idle until an attack plays its loop (community report #23); without one, the loop
        const next = this._skillIdle() || (this.has(sk.loop) ? sk.loop : null);
        if (next) this._queue(next, true);
      } else if (!this.has(sk.idle) && this.has(sk.loop) && sk.via !== 'attack' && sk.loop !== this.roles.attack?.loop && !this._skillIsBuffOnly()) {
        // No Begin and no own Idle: the skill's clip IS its animation (德克萨斯 剑雨 — anims.skill {begin:null,
        // loop:'Skill', end:null}, the 2.17 s clip; 58 instant skills in all). Play it once for its own length. An
        // instant skill turns the flag off inside the same tick (sim skills.js fires 'skill' 1 and 0 together and only
        // holds the anim code SKILL for 0.5 s), so this window is what keeps it on screen: the actor used to fall
        // through to the base clip and show no skill animation at all (player report).
        this.mode = 'skillBegin';
        this.skillClipOnce = true;
        this._play(sk.loop, false, { mix: 0.08 });
        this.skillBeginUntil = this.clock + Math.max(SKILL_CLIP_MIN, this.dur(sk.loop));
      } else if (this.mode === 'base') this._play(this._baseName(), true);
    } else if (!on && sk) {
      // an instant skill switches off while its own one-shot clip runs: let the clip finish — the state machine plays
      // its End clip (or the base) when the window ends — instead of cutting it with End / base right now
      if (this.skillClipOnce && this.clock < this.skillBeginUntil) {
        this.skillEndPending = true;
        return;
      }
      this.skillClipOnce = false;
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
      this.deployAt = this.clock;
      this.deployUntil = this.clock + this.dur(d);
    }
  }

  /** Seconds into the deploy clip while it plays, else null (a model swapped mid-deploy carries it over: units.js). */
  deployElapsed() {
    return this.mode === 'deploy' ? Math.max(0, this.clock - (this.deployAt || 0)) : null;
  }

  /** The skeleton's death clip, or null. */
  dieClip() {
    const d = this.roles.die || (this.has('Die') ? 'Die' : null);
    return d && this.has(d) ? d : null;
  }

  /**
   * Play the death clip; returns its duration (0 when there is none). A skeleton without one (131 of the 135 Back
   * models, GitHub issue #25; a few idle-only summons and enemies) stops whatever looped — an attack, a skill or the idle —
   * and holds the first frame of its idle clip (frozen when it has none either) [ASSUMED look]: a dead unit never goes on attacking. A
   * knocked-out operator shows its fall with the Front model instead (render/units.js _wantsBack).
   */
  die() {
    if (this.dead) return 0;
    this.dead = true;
    this.frozen = false;
    this.mode = 'die';
    const d = this.dieClip();
    if (d) { this._play(d, false, { mix: 0.05 }); return this.dur(d); }
    const idle = this.has(this.roles.idle) ? this.roles.idle : this.has('Idle') ? 'Idle' : null;
    if (idle) this._play(idle, false, { mix: 0.1, timeScale: 0 });
    else this.frozen = true;
    return 0;
  }

  /**
   * True while an update would draw the same pixels: a frozen model, or a dead one whose only clip — track 0, not
   * looping, not mixing — has played out (the held end of a death clip; a skeleton without one holds its idle at
   * timeScale 0). Only once an update has posed the current clip and put the current tint on the slots (pixi-spine applies
   * `tint` in update: the grey of a knocked-out operator, a hit flash). Never while a form's closing clip or a wind-up is
   * pending: those act on the clock.
   */
  poseHeld() {
    if (!this._applied || this.spine.tint !== this._appliedTint || this.endClip || this.windUntil != null) return false;
    if (this.frozen) return true;
    if (this.mode !== 'die') return false;
    const tracks = this.spine.state.tracks;
    for (let i = 1; i < tracks.length; i++) if (tracks[i]) return false;
    const e = tracks[0];
    if (!e || e.loop || e.mixingFrom) return false;
    return e.timeScale === 0 || e.trackTime >= e.animationEnd - e.animationStart;
  }

  /** Revive (redeploy after death). */
  revive() {
    this.dead = false;
    this.frozen = false;
    this.mode = 'base';
    this.skillOn = false;
    this._play(this._baseName(), true);
  }

  update(dt) {
    this.clock += dt;
    if (this.endClip && this.clock >= this.endAt) {
      const clip = this.endClip;
      this.endClip = null;
      if (this.endRoles) { this.formRoles = this.endRoles; this.roles = { ...this._baseRoles(), ...this.endRoles }; }
      if (!this.dead) this._change(clip);
    }
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
          this.wound = false;
          const clip = this._attackClip() || this.roles.attack;
          // a skill with its own idle: back to that idle (its end clip is for the end of the skill, setSkill(false))
          const toSkillIdle = clip === this.roles.skill && !!this._skillIdle();
          if (clip && this.has(clip.end) && !toSkillIdle) { this._play(clip.end, false); this._queue(this._baseName(), true); }
          else this._play(this._baseName(), true, { mix: 0.15 });
        }
        break;
      case 'skillBegin':
        if (this.clock >= this.skillBeginUntil) {
          const sk = this.roles.skill;
          const once = this.skillClipOnce;
          const pending = this.skillEndPending;
          this.skillClipOnce = false;
          this.skillEndPending = false;
          this.mode = 'base';
          if (pending && this.has(sk?.end)) {
            // the skill switched off inside its own clip: its End clip closes it now
            this.mode = 'skillEnd';
            this._play(sk.end, false, { mix: 0.08 });
            this.skillEndUntil = this.clock + this.dur(sk.end);
          } else if (once || pending || !this.has(sk?.loop)) {
            // the one-shot clip is over (or the skill has no loop clip at all): rest. A Begin clip with a queued next
            // clip (the loop, or the skill's own idle) needs no play here — it is already on the track
            this._play(this._baseName(), true);
          }
        }
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
    if (this.clipped && !this.clipOn) this._eyeMaskFallback();
    this._applied = true;
    this._appliedTint = this.spine.tint;
  }

  /**
   * The eyelids without the stencil masks (GitHub #177; PR #384 by @Convey123, re-implemented). On this roster the
   * clipping attachments are eyelids: the polygon is the eye's opening and the eyeball / eye-white meshes drawn after
   * it are clipped to it, so a closing eye (a blink, a knock-down) is hidden by the mask, not by the art. The masks
   * are off on a crowded field or below high quality (render/app.js pickClipping), and the eyeballs showed through
   * the closed lids (佩佩, 仇白, 隐德来希, 琳琅诗怀雅 …). While they are off, every slot a clip covers — walked in draw
   * order from the clipping slot to its endSlot, with the attachments in force (any skin), as pixi-spine does — is
   * hidden for the frame when the centre of what it draws lies outside the clip polygon [ASSUMED: all or nothing per
   * slot, an approximation of the mask's cut]. pixi-spine shows every attached slot container again on each update.
   */
  _eyeMaskFallback() {
    const sp = this.spine, skel = sp && sp.skeleton, boxes = sp && sp.slotContainers;
    if (!skel || !Array.isArray(skel.drawOrder) || !boxes) return;
    this._showClipHidden();   // undo the last pass (a pixi-spine update re-shows them anyway; a frozen one does not)
    try {
      const buf = this._clipBuf || (this._clipBuf = { v: new Float32Array(64), poly: new Float32Array(16), c: [0, 0] });
      let pn = -1, end = null;   // pn: points of the clip in force (−1: none; < 3: degenerate, hides nothing)
      for (const slot of skel.drawOrder) {
        const att = typeof slot.getAttachment === 'function' ? slot.getAttachment() : slot.attachment;
        if (isClip(att)) {
          const n = att.worldVerticesLength | 0;
          if (buf.poly.length < n) buf.poly = new Float32Array(n);
          if (n >= 6) att.computeWorldVertices(slot, 0, n, buf.poly, 0, 2);
          pn = n >> 1;
          end = att.endSlot && att.endSlot !== slot.data ? att.endSlot : null;
          continue;
        }
        if (pn < 0) continue;
        const box = boxes[slot.data.index];
        if (pn >= 3 && att && box && slotCentre(slot, att, buf, buf.c) && !pointInPolygon(buf.c[0], buf.c[1], buf.poly, pn)) {
          box.visible = false;
          this._clipHidden.add(slot.data.index);
        }
        if (end && slot.data === end) { pn = -1; end = null; }
      }
    } catch { /* an unknown runtime shape must never stop the frame */ }
  }

  /** Show the slot containers the fallback hid (those still drawing an attachment). */
  _showClipHidden() {
    if (!this._clipHidden.size) return;
    const slots = this.spine?.skeleton?.slots, boxes = this.spine?.slotContainers;
    for (const i of this._clipHidden) {
      const slot = slots && slots[i];
      if (boxes && boxes[i] && slot && (typeof slot.getAttachment === 'function' ? slot.getAttachment() : slot.attachment)) boxes[i].visible = true;
    }
    this._clipHidden.clear();
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
