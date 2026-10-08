// server/sim/battle/combat.js — Battle methods: damage, heal and HP loss (the guarded entry points of the damage.js
// pipeline), projectiles and forced attacks (ai.js performAttack).
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { dealDamage as pipeDamage, heal as pipeHeal, applyHpLoss, makeDamageInfo, reduceElement, leaderHitCancelled } from '../damage.js';
import { effectiveProfile, performAttack, acquireTargets } from '../ai.js';

export class BattleCombat {
  dealDamage(source, target, dmg) {
    try { return pipeDamage(this, source, target, dmg); } catch (e) { this._internalError('dealDamage', e); return 0; }
  }

  heal(source, target, amount, opts = {}) {
    try { return pipeHeal(this, source, target, amount, opts); } catch (e) { this._internalError('heal', e); return 0; }
  }

  /**
   * 充能至上限立刻释放 (skills.js SkillRuntime.onChargeCap, the OPT-IN `chargeFull` release; see that file's header):
   * called every step after the projectiles, so a `charges` skill whose SkillSpec sets `capRelease: true` and whose
   * charges have reached its cap releases once the moment they do — including for the SP a hit that landed in this very
   * step recovered. Returns how many skills released (tests). Every unit with a skill is asked; a skill that did not opt
   * in, whose charges are not full, whose kind is not `charges` or whose maxCharges is 1 answers without doing anything.
   * Battle._hasChargeCap (set by `_setupUnit` for every unit that opted in, summons created mid-battle included) skips
   * the whole phase when no such unit exists.
   */
  _chargeCapReleases() {
    let n = 0;
    const list = this.allyUnits;
    for (let i = 0; i < list.length && !this._endReq; i++) {
      const u = list[i];
      if (!u.alive || !u.deployed || !u.skill || u.skill.chargeCap !== true) continue;
      if (u.skill.onChargeCap()) n++;
    }
    return n;
  }

  /**
   * HP loss that ignores DEF/RES, dodge and shields (流失). May kill. opts: { source, silent, tags, from } — `from` = the
   * DamageInfo this loss derives from (damage passed on to a leader, split, shared…): its tags are inherited and it is
   * kept as `dmg.origin`, so `damaged` handlers that skip their own tagged damage also skip what it turned into; a loss
   * derived from 无来源 damage (`from.sourceless`, element bursts) is 无来源 too (hooks see no source, `source` is credited).
   * `sourceless: true` makes the loss itself 无来源 ("受到等量的无来源生命流失": hooks see no source; `source` keeps the
   * credit — the stats and the per-player shared-pool tally).
   * On a leader in a boss / hidden battle a loss of ≥ BOSS_HIT_LIMIT is cancelled like a hit (damage.js leaderHitCancelled)
   * — except with `noHitLimit: true`: a share of the leader's pool that is no hit (胄's 死亡集群 drone link, content/bosses.js).
   */
  loseHp(target, amount, { source = null, silent = false, tags = null, from = null, sourceless = false, noHitLimit = false } = {}) {
    if (!target || !target.alive || !(amount > 0)) return 0;
    // 限伤 (shared/constants.js BOSS_HIT_LIMIT): a loss passed on to a leader (the parts' 传递) is one hit too
    if (!noHitLimit && leaderHitCancelled(this, target, amount)) return 0;
    const t = ['hpLoss'];
    for (const list of [from && from.tags, tags]) if (Array.isArray(list)) for (const x of list) if (!t.includes(x)) t.push(x);
    return applyHpLoss(this, source, target, amount, { type: 'true', tags: t, noSp: true, silent, origin: from ?? null, sourceless: !!sourceless || !!(from && from.sourceless) });
  }

  reduceElement(target, amount, element = null) { return reduceElement(target, amount, element); }

  makeDamage(d) { return makeDamageInfo(d); }

  addProjectile(p) { return this.projectiles.add(p); }

  // exposed for ai/content convenience
  effectiveProfile(u) { return effectiveProfile(u); }

  /**
   * Perform an immediate attack with a unit's current profile (content: "立即攻击", extra attacks, counters). It is an
   * attack in every respect (hooks, attack SP, a running ammo skill's bullet) — except with `noAmmo: true`: an extra
   * attack that spends no ammo (no `ammoUsed`, the skill never ends on it; 圣约送葬人 "不额外消耗弹药").
   * Returns true when an attack was made.
   */
  forceAttack(u, targets = null, { noAmmo = false } = {}) {
    if (!u || !u.alive || !u.profile) return false;
    const prof = effectiveProfile(u);
    const t = targets ?? acquireTargets(this, u, prof);
    if (!t || !t.length) return false;
    const n0 = u.stats.attacks;
    performAttack(this, u, prof, t, noAmmo ? { noAmmo: true } : null);
    return u.stats.attacks > n0;
  }
}
