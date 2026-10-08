// server/sim/battle/status.js — Battle methods: buffs and statuses: addBuff (refresh rules) / removeBuff, the per-tick
// buff pass (onTick, expiry, natural regeneration), catalogue statuses (immunities, 抵抗, 寒冷 → 冻结, 浮空, 诱导, 恐惧) and
// "同名效果取最高".
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { COLD_FREEZE_DURATION, LEVITATE_HALF_WEIGHT, RESIST_DEFAULT } from '../constants.js';
import { makeBuff, STATUS, RESIST_STATUSES } from '../buffs.js';
import { palsyBuff } from '../damage.js';
import { evadesGround } from '../targeting.js';
import { stampFear } from '../fear.js';

export class BattleStatus {
  addBuff(unit, b) {
    if (!unit || (!unit.alive && !b.allowDead)) return null;
    const buff = makeBuff(b);
    const list = unit.buffs;
    let idx = -1;
    for (let i = 0; i < list.length; i++) if (list[i].key === buff.key) { idx = i; break; }
    if (idx >= 0 && buff.refresh !== 'independent') {
      const old = list[idx];
      switch (buff.refresh) {
        case 'keep':
          return old;
        case 'stack':
          old.stacks = Math.min(old.stacks + buff.stacks, Math.max(old.maxStacks, buff.maxStacks));
          old.maxStacks = Math.max(old.maxStacks, buff.maxStacks);
          old.timeLeft = buff.duration;
          old.duration = buff.duration;
          if (buff.mods) old.mods = buff.mods;
          if (buff.flags) old.flags = buff.flags;
          unit.markDirty();
          return old;
        case 'extend':
          old.timeLeft = Math.max(old.timeLeft, buff.duration);
          old.duration = Math.max(old.duration, buff.duration);
          if (buff.mods) old.mods = buff.mods;
          if (buff.flags) old.flags = buff.flags;
          if (buff.shield > old.shield) old.shield = buff.shield;
          if (buff.shieldHits > old.shieldHits) old.shieldHits = buff.shieldHits;
          unit.markDirty();
          return old;
        default:
          list[idx] = buff;
          unit.markDirty();
          return buff;
      }
    }
    if (buff.refresh === 'independent') {
      const same = list.filter((x) => x.key === buff.key);
      if (same.length >= buff.maxStacks) {
        const oldest = same.reduce((a, c) => (a.seq < c.seq ? a : c));
        this._removeBuffAt(unit, list.indexOf(oldest), true);
      }
    }
    list.push(buff);
    unit.markDirty();
    if (buff.visible || buff.status) {
      const key = buff.status ?? buff.key;
      if (list.filter((x) => (x.status ?? x.key) === key).length === 1) this._ev(['status', unit.id, key, 1]);
    }
    return buff;
  }

  removeBuff(unit, keyOrBuff) {
    if (!unit) return 0;
    let n = 0;
    for (let i = unit.buffs.length - 1; i >= 0; i--) {
      const b = unit.buffs[i];
      if (b === keyOrBuff || b.key === keyOrBuff) { this._removeBuffAt(unit, i, true); n++; }
    }
    return n;
  }

  _removeBuffAt(unit, i, callRemove = true) {
    const b = unit.buffs[i];
    if (!b) return;
    unit.buffs.splice(i, 1);
    unit.markDirty();
    if ((b.visible || b.status)) {
      const key = b.status ?? b.key;
      if (!unit.buffs.some((x) => (x.status ?? x.key) === key)) this._ev(['status', unit.id, key, 0]);
    }
    if (callRemove && b.onRemove) this._safe(() => b.onRemove({ battle: this, unit, buff: b }), 'buff.onRemove', unit);
  }

  _tickBuffs(dt) {
    const units = this.units;
    for (let i = 0, n = units.length; i < n; i++) { // units created by onTick handlers start ticking next tick
      const u = units[i];
      if (!u.alive || u.removed) continue;
      if (u.buffs.length) {
        const arr = u.buffs.slice();
        for (const b of arr) {
          if (!u.alive) break;
          if (u.buffs.indexOf(b) < 0) continue;
          if (b.onTick) {
            if (b.interval > 0) {
              b._acc += dt;
              let n = 0;
              while (b._acc >= b.interval - 1e-9 && n++ < 8) {
                b._acc -= b.interval;
                this._safe(() => b.onTick({ battle: this, unit: u, buff: b, dt: b.interval }), 'buff.onTick', u);
              }
            } else this._safe(() => b.onTick({ battle: this, unit: u, buff: b, dt }), 'buff.onTick', u);
          }
          if (b.timeLeft !== Infinity) {
            b.timeLeft -= dt;
            if (b.timeLeft <= 1e-9) {
              const i = u.buffs.indexOf(b);
              if (i >= 0) {
                this._removeBuffAt(u, i, false);
                if (b.onExpire) this._safe(() => b.onExpire({ battle: this, unit: u, buff: b }), 'buff.onExpire', u);
              }
            }
          }
        }
      }
      // natural HP regeneration
      if (u.alive && u.deployed && !u.bossPool) {
        const regen = u.s.hpRegen;
        if (regen > 0 && u.hp < u.s.maxHp) {
          u._regenAcc = (u._regenAcc ?? 0) + regen * dt;
          if (u._regenAcc >= 1 || u.hp + u._regenAcc >= u.s.maxHp) {
            this.heal(u, u, u._regenAcc, { self: true, silent: true, regen: true });
            u._regenAcc = 0;
          }
        }
      }
    }
  }

  /**
   * Apply a catalogue status. opts: { duration, source, value, force, refresh, point, resistApplied, stackAs, reenter } — returns
   * true when applied. Honours enemy immunities (stun/silence/sleep/frozen/levitate/feared) unless `force`. `beforeStatus`
   * handlers may cancel it or change `duration` / `value`. Official rules (buffs.js STATUS): 抵抗 (the `resist` status)
   * shortens the RESIST_STATUSES by its value (default half; applied after `beforeStatus`; `resistApplied` skips that
   * pass — the cold-on-cold 冻结 below already used post-抵抗 lengths). A second 寒冷 while 寒冷 remains applies 冻结 for
   * max(remaining, this cold after 抵抗) (PRTS 术语释义 寒冷 「持续时间取双方之中最高」); on an enemy (友方寒冷) the pair turns into
   * that 冻结 and no 寒冷 is left (「两两一对产生友方冻结」). 浮空 and 缚地 last half as long on units
   * heavier than LEVITATE_HALF_WEIGHT (current massLevel); 冻结's RES cut hits enemies only; 麻痹 adds stacks; "同名效果取最高"
   * statuses (`valued`) keep the strongest value — a weaker application only extends past the stronger one's end (it
   * then resumes); `stackAs` = the value such an application competes with instead of its own (its effect stays
   * `value`): an effect the game stacks as another strength — Raidian S3's 虚弱, PRTS 备注 "在叠加时视为90%（1级~6级）/80%
   * （7级~专精二）…的虚弱（仅影响叠加优先级，不影响实际效果）"; other statuses refresh to the longer duration. 诱导 (`attract`) walks the enemy to `point`
   * ([r, c] or {x, y}; default the source's tile — a new application moves the point); 恐惧 (`fear`) stamps where it
   * was applied and from where (fear.js stampFear: the fan of 恐惧可达地块 its movement uses). A stunned/sleeping operator
   * releases the enemies it blocks; a feared/levitated/unblockable/attracted/sleeping enemy is released by its blocker
   * (沉睡 = 无法行动+无敌+不可阻挡, PRTS 异常效果: the slot frees for the next enemy, the sleeper stays put — DESIGN §24.9).
   * `statusApplied` reports the final duration and `entered` (the target did not carry the status before) — or, with
   * `reenter`, entered anyway: a pulse whose own short status the caller re-applies as a fresh one each time (缇缇 S2's
   * sleep ward, DESIGN §24.8); the buff itself is refreshed as usual.
   * A unit that is 无敌 and 无法选中 at once (a 重生 in progress, a hovering or 永久无敌 leader part) takes no status from
   * the other side, `force` included — PRTS 无敌 "无法被不同阵营选中": so a status carried by the very hit that knocked an
   * enemy out does not land after its 重生's cleanse (DESIGN §21.4). A ground enemy's status never lands on an airborne
   * 起飞 ally (对地规避: targeting.js evadesGround) unless `opts.ignoreSelect`.
   */
  applyStatus(target, key, opts = {}) {
    if (!target || !target.alive) return false;
    const src = opts.source;
    if (src && src.side && src.side !== target.side && target.s.flags.invulnerable && target.s.flags.untargetable) return false;
    if (!opts.ignoreSelect && target.s.flags.liftoff && evadesGround(src, target)) return false;
    const tpl = STATUS[key] || { flags: { [key]: true } };
    let duration = opts.duration == null ? Infinity : Number(opts.duration);
    let value = opts.value;
    if (!(duration > 0)) return false;
    const immune = target.def && target.def.immune;
    if (!opts.force && tpl.immune && immune && immune.has(tpl.immune)) return false;
    // 浮空 Buff (PRTS 异常效果: "若单位数据上为飞行单位且不持有缚地异常或是持有浮空异常则Buff取消"; 行动方式 "行动类型（数据）为
    // 飞行的单位、以及已持有浮空异常的单位无法被施加浮空Buff"): refused on data flyers (`motion` FLY) that hold no 缚地 and on
    // units already levitated — a hovering 近地悬浮 enemy is WALK in its data, so it can be levitated (no 浮空强化 in this mode)
    if (key === 'levitate' && ((target.motion === 'FLY' && !target.s.flags.groundbind) || target.s.flags.levitate)) return false;
    if (this._hooks.beforeStatus) {
      const c = this.emit('beforeStatus', { source: opts.source ?? null, target, status: key, duration, value, cancel: false });
      if (c.cancel || !target.alive) return false;
      const d = Number(c.duration);
      if (d === Infinity || (Number.isFinite(d) && d > 0)) duration = d;
      else if (Number.isFinite(d) && d <= 0) return false;
      value = c.value;
    }
    if (RESIST_STATUSES.has(key) && !opts.resistApplied) {
      const rv = this.resistOf(target);
      if (rv > 0) duration *= 1 - rv;
    }
    // 浮空 / 缚地 (ba.levitate, ba.groundbind): "对重量大于3的单位持续时间减半"
    if ((key === 'levitate' || key === 'groundbind') && target.s.massLevel > LEVITATE_HALF_WEIGHT) duration /= 2;
    if (!(duration > 0)) return false;
    if (key === 'cold' && target.findBuff('cold') && !(immune && immune.has('frozen'))) {
      // PRTS 术语释义 寒冷: 友方寒冷 pairs into 冻结, 「持续时间取双方之中最高」. `duration` is this cold after 抵抗;
      // the cold already on the target keeps timeLeft. addBuff refresh 'extend' below sets that cold to the same max.
      // COLD_FREEZE_DURATION is only the fallback when neither side has a duration. resistApplied: that max is already
      // post-抵抗, so the freeze must not be halved again.
      // [ASSUMED] one catalogue cold, so an enemy-applied second cold uses this max too. PRTS states it on the 友方
      // line only (敌方 cold becomes 冻结 when the target already has 敌方 cold or 敌方 冻结).
      const prev = target.findBuff('cold');
      const spans = [prev.timeLeft, duration].filter((t) => t === Infinity || (Number.isFinite(t) && t > 0));
      const freezeFor = spans.length ? Math.max(...spans) : COLD_FREEZE_DURATION;
      const froze = this.applyStatus(target, 'freeze', {
        duration: freezeFor, source: opts.source, force: opts.force,
        ...(spans.length ? { resistApplied: true } : {}),
      });
      if (!target.alive) return false;
      // 友方寒冷 — every cold on an enemy: the operators', summons', items', the 谢拉格 wind's — "始终需要两两一对产生友方冻结"
      // (PRTS 术语释义 寒冷; 异常效果 COLD "在特定条件下转变为冻结"): the pair BECOMES the 冻结, so neither cold is left and a
      // later single cold on the frozen enemy is a 寒冷 that needs its own partner. Until 0.2.0 the older cold stayed on,
      // extended to the freeze's length, so any cold before it ran out froze again: the 谢拉格 wind alone (every 25 s,
      // 20 + 0.1 × layers s of cold) froze an enemy for the rest of the battle from 51 layers on — wherever it stood —
      // and never below (community reports of 2026-10-06 「谢拉格盟约冰冻时间没有随层数正确成长」, 「…被在无法被任何干员攻击
      // 到的地方永控」). A 敌方 cold (on an operator) keeps the old rule: PRTS 「…施加的敌方寒冷会变为敌方冻结」 names no pairing.
      if (froze && target.side === 'enemy') {
        this.removeBuff(target, 'cold');
        return true;
      }
    }
    const source = opts.source ?? null;
    let entered = true;
    if (opts.reenter !== true) for (const b of target.buffs) if ((b.status ?? b.key) === key) { entered = false; break; }
    if (tpl.palsy) {
      this.addBuff(target, { ...palsyBuff(value ?? 1), duration, source });
    } else if (tpl.valued != null && typeof tpl.mods === 'function' && opts.refresh == null) {
      this._applyValuedStatus(target, key, tpl, duration, value ?? tpl.valued, source, opts.stackAs);
    } else {
      const mods = tpl.enemyOnlyMods && target.side !== 'enemy' ? null : typeof tpl.mods === 'function' ? tpl.mods(value) : (tpl.mods || null);
      const b = this.addBuff(target, { key, duration, refresh: opts.refresh ?? 'extend', mods, flags: tpl.flags || null, status: key, visible: true, source });
      if (tpl.attract && b) this._setAttractPoint(target, b, opts.point ?? value, source);
      // 恐惧: the hit position and the source's position of every application (fear.js — the fan of reachable tiles)
      if (key === 'fear' && b && target.side === 'enemy') stampFear(this, target, b, source);
    }
    const f = tpl.flags;
    if (f && target.side === 'enemy' && (f.levitate || f.unblockable || f.fear || f.sleep)) this._unblock(target);
    if (f && target.side === 'ally' && f.noBlock) this.releaseBlocked(target);
    if (this._hooks.statusApplied) this.emit('statusApplied', { source, target, status: key, duration, value, entered });
    return true;
  }

  /** 抵抗 of a unit: share of a resisted status's duration removed (0 = none; the `resist` status value, ≤ 0.95). */
  resistOf(unit) {
    if (!unit || !unit.buffs.length) return 0;
    let r = 0;
    for (const b of unit.buffs) {
      if (b.status !== 'resist') continue;
      const v = Number.isFinite(b.data?.value) ? b.data.value : RESIST_DEFAULT;
      if (v > r) r = v;
    }
    return Math.min(0.95, r);
  }

  /** 诱导 target point of an `attract` status buff (enemy walks there; see ai.js moveAttracted). */
  _setAttractPoint(target, buff, point, source) {
    let r = null, c = null;
    if (Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) { r = point[0]; c = point[1]; }
    else if (point && typeof point === 'object' && Number.isFinite(point.x) && Number.isFinite(point.y)) { r = point.y; c = point.x; }
    else if (source && Number.isFinite(source.x) && Number.isFinite(source.y)) { r = source.y; c = source.x; }
    if (r == null) { if (!buff.data.attract) buff.data = { ...buff.data, attract: null }; return; }
    const R = this.rect;
    r = Math.max(R.r0, Math.min(R.r1, Math.round(r)));
    c = Math.max(R.c0, Math.min(R.c1, Math.round(c)));
    buff.data = { ...buff.data, attract: { r, c, pts: null, i: 0, ver: -1 } };
  }

  /**
   * "同名效果取最高" for a content effect that is not a catalogue status (no immunities, 抵抗, `beforeStatus` /
   * `statusApplied` hooks or status icon): ONE instance of `key` per target whatever the number of sources — the
   * strongest `value` applies, a weaker application only extends past the stronger one's end (it then resumes), an
   * equal one refreshes to the longer duration. `mods(value)` builds the buff's mods. The engine's default for two
   * same-named buffs (PRTS 作战机制 "同名buff的默认叠加策略buff只能表现出一个"). Returns true when applied.
   * @param {object} target
   * @param {string} key
   * @param {{ duration: number, value: number, mods: (v: number) => object, source?: object|null }} opts
   */
  applyStrongest(target, key, { duration, value, mods, source = null } = {}) {
    if (!target || !target.alive || !(Number(duration) > 0) || !Number.isFinite(value) || typeof mods !== 'function') return false;
    this._applyValuedStatus(target, key, { mods, valued: value, plain: true }, Number(duration), value, source);
    return true;
  }

  /**
   * Keep the strongest value, then resume weaker effects in order of strength at their original expiry times.
   * `buff.data.tail` links the waiting effects, with decreasing strength and increasing expiry times. A
   * `plain` template (applyStrongest) is an ordinary invisible buff, not a status. `stackAs` (finite): the strength this
   * application competes with instead of its value (applyStatus opts.stackAs); kept in `data.stackAs` / the tail.
   */
  _applyValuedStatus(target, key, tpl, duration, value, source, stackAs = null) {
    const as = Number.isFinite(stackAs) ? stackAs : null;
    const strength = (v, s = null) => Math.abs(Number.isFinite(s) ? s : Number.isFinite(v) ? v : tpl.valued);
    const entry = (v, s, extra) => (Number.isFinite(s) ? { value: v, stackAs: s, ...extra } : { value: v, ...extra });
    const after = (tail, until) => {
      while (tail && tail.until <= until) tail = tail.tail;
      return tail || null;
    };
    const insertTail = (tail, incoming) => {
      if (!tail) return incoming;
      const diff = strength(incoming.value, incoming.stackAs) - strength(tail.value, tail.stackAs);
      if (diff > 1e-12) return { ...incoming, tail: after(tail, incoming.until) };
      if (diff < -1e-12) {
        if (incoming.until <= tail.until) return tail;
        return { ...tail, tail: insertTail(tail.tail, incoming) };
      }
      // Equal-priority waiting effects keep the longest-lived application's value, including its stackAs.
      const kept = incoming.until > tail.until ? incoming : tail;
      return { ...kept, tail: after(tail.tail, kept.until) };
    };
    const make = (v, dur, tail, s = null) => ({
      ...(tpl.buff || null),   // extra buff fields of the status (抵抗: the 麻痹 decay tick)
      key, duration: dur, refresh: 'replace', mods: tpl.mods(v), flags: tpl.flags || null, status: tpl.plain ? null : key,
      visible: !tpl.plain, source,
      data: entry(v, s, { tail }),
      onExpire: ({ battle, unit, buff }) => {
        const t = after(buff.data.tail, battle.time + 1e-6);
        if (t && unit.alive) battle.addBuff(unit, make(t.value, t.until - battle.time, t.tail || null, t.stackAs));
      },
    });
    const old = target.buffs.find((b) => b.key === key && (tpl.plain || b.status === key));
    if (!old) { this.addBuff(target, make(value, duration, null, as)); return; }
    const oldV = old.data && Number.isFinite(old.data.value) ? old.data.value : tpl.valued;
    const oldAs = old.data && Number.isFinite(old.data.stackAs) ? old.data.stackAs : null;
    const oldEnd = this.time + old.timeLeft, newEnd = this.time + duration;
    const oldTail = old.data && old.data.tail;
    if (strength(value, as) > strength(oldV, oldAs) + 1e-12) {
      // Stronger: take over now, retaining every old effect that can still become active afterwards.
      const tail = after(entry(oldV, oldAs, { until: oldEnd, tail: oldTail }), newEnd);
      this.addBuff(target, make(value, duration, tail, as));
    } else if (strength(value, as) < strength(oldV, oldAs) - 1e-12) {
      // Weaker: insert among the waiting effects instead of replacing the one with the latest expiry.
      if (newEnd > oldEnd) old.data = { ...old.data, value: oldV, tail: insertTail(oldTail, entry(value, as, { until: newEnd })) };
    } else if (duration > old.timeLeft) {
      old.timeLeft = duration;
      old.duration = Math.max(old.duration, duration);
      old.data.tail = after(oldTail, newEnd);
    }
  }

  removeStatus(target, key) { return this.removeBuff(target, key); }
}
