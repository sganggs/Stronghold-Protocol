// The attack wind-up look-ahead of the battle view (render/app.js windUpAttacks): an 'atk' still queued in the snapshot
// buffer starts its Spine clip early enough for the strike frame to land when the event is rendered (the look-ahead is
// the interpolation delay, ~0.2 game s). Its own module so the queue walk is testable (test/render/enemy-strike-clip).

import { CHAIN_KINDS } from './tune.js';

/**
 * `views` (id → UnitView), `woundUp` (a WeakSet of the 'atk' tuples already wound up), `castStart(view, targetView, kind,
 * opts)` (render/vfx/wiring.js castStart: the official cast effects that start with the clip). The 'atk' target view is
 * passed into `windUp` so the model faces it when the clip starts (UnitView.onAttack's rule, GitHub #869). Returns
 * `run(interp, renderT)`, walking the events queued in (renderT, renderT + 1.5].
 */
export function createWindUpLookahead({ views, woundUp, castStart }) {
  let upcomingT = 0;
  // the look-ahead's skill state: a ['skill', id, on] queued before an 'atk' of that unit (an instant skill sends 1, its
  // attack and 0 in one tick) — the official cast effects of the wind-up are the skill's own then
  const upSkill = new Map();
  // … and its casts: a ['cast', id, slot] in the tick of an 'atk' of that enemy — an attack-class skill cast in the
  // attack's `before` hook; a `strike` slot winds that attack up on the slot's clip (UnitView.onCast, DESIGN §35.48).
  // A cast in the attack's turn (['cast', id, slot, dur, clip]: no 'atk' with it) winds up its own clip, so the clip's
  // strike frame lands with the cast (UnitView.windUpCast, DESIGN §35.57)
  const upCast = new Map();
  const rates = new Map();
  function onUpcoming(e, t) {
    if (e[0] === 'skill') { upSkill.set(e[1], !!e[2]); return; }
    if (e[0] === 'cast') {
      upCast.set(e[1], { slot: e[2] | 0, t });
      if (e.length > 4 && !woundUp.has(e)) {
        const v = views.get(e[1]);
        if (v && v.windUpCast && v.windUpCast(t - upcomingT, e[2] | 0, Number(e[4]) || 0)) woundUp.add(e);
      }
      return;
    }
    if (e[0] !== 'atk' || woundUp.has(e) || CHAIN_KINDS.has(e[3])) return;
    const v = views.get(e[1]);
    if (!v || !v.windUp) return;
    const cast = upCast.get(e[1]);
    let interval;
    for (const rate of rates.get(e[1]) || []) {
      if (rate.t > t) break;
      interval = rate.value;
    }
    const target = views.get(e[2]);
    if (v.windUp(t - upcomingT, e[3], cast && cast.t === t ? cast.slot : null, interval, target)) {
      woundUp.add(e);
      const a = v.actor;
      const skillOn = upSkill.has(e[1]) ? upSkill.get(e[1]) : undefined;
      castStart(v, target, e[3], a ? { skip: a.windSkip || 0, left: a.windCastLeft || 0, skillOn } : { skillOn });
    }
  }
  return {
    run(interp, renderT) {
      upcomingT = renderT;
      upSkill.clear();
      upCast.clear();
      rates.clear();
      // Rates are emitted after ally attacks, so inspect the entire tick before winding up its attack.
      interp.forEachUpcoming(renderT, renderT + 1.5, (e, t) => {
        if (e[0] !== 'rate') return;
        if (!rates.has(e[1])) rates.set(e[1], []);
        rates.get(e[1]).push({ t, value: e[2] });
      });
      interp.forEachUpcoming(renderT, renderT + 1.5, onUpcoming);
    },
  };
}
