// Enemy buses: PRTS 伊利昂的木驮兽 / “越长尘”, 天赋&能力 (checked 2026-10-13).
// Both take non-leader, non-machine ground enemy units within 0.5; no faction / mass / elite restriction.
// The shipped autochess stages have no 云梯. 越长尘 unloads on removal there; no substitute unload point is invented.

import { hypot } from '../../detmath.js';
import { canCast, T } from './helpers.js';

function resetRoute(e, legs) {
	e.route = { legs: legs.map((leg) => ({ ...leg })), legIdx: 0, pts: null, ptIdx: 0,
		suffix: null, version: -1, waitLeft: null };
}

function unload(b, e, a) {
	for (const p of a.passengers) {
		delete p.mem.carrier;
		if (!p.alive) continue;
		p.x = a.camel ? e.x + b.rng.range(-0.2, 0.2) : Math.round(e.x);
		p.y = a.camel ? e.y + b.rng.range(-0.2, 0.2) : Math.round(e.y);
		b._clampPos(p);
		// The camel replaces the passenger's path with its remaining path. [ASSUMED] 越长尘 retains the passenger's
		// remaining path: PRTS specifies no replacement for this bus (the generic description only says "may").
		const r = a.camel ? e.route : p.route;
		let i = r.legIdx;
		if (r.legs[i]?.t === 'wait') i++; // unloading skips the current checkpoint's stop
		resetRoute(p, r.legs.slice(i));
		p.swing = false;
		p.atkStandUntil = -Infinity;
		b._setHidden(p, false);
	}
	a.passengers.length = 0;
}

export function passengerBus(ab, camel = false) {
	const max = T(ab, camel ? 'bus.max_cnt' : 'Bus.max_cnt') ?? (camel ? 5 : 4);
	const speed = T(ab, 'bus.move_speed') ?? -0.2;
	return {
		camel, passengers: [],
		spawn(b, e) {
			if (camel) { e.mem.moveSpeedFloor = 0.1; e.markDirty(); }
		},
		tick(b, e, a) {
			// Carried enemies may die from an existing effect; they no longer occupy a seat.
			a.passengers = a.passengers.filter((p) => p.alive);
			if (canCast(e, false, b) && !e.s.flags.freeze && !e.s.flags.sleep && !e.s.flags.levitate) {
				// [ASSUMED] When more candidates than seats overlap, use stable spawn order; PRTS names no priority.
				for (const p of b.enemies) {
					if (a.passengers.length >= max) break;
					if (p === e || !p.alive || p.hidden || p.mem.carrier || p.isBoss || p.def.rank === 'BOSS'
						|| p.motion === 'FLY' || p.def.tags.includes('machine') || hypot(p.x - e.x, p.y - e.y) > 0.5 + 1e-9) continue;
					p.mem.carrier = e;
					p.swing = false;
					b._cutAttackStand(p);
					b._setHidden(p, true);
					a.passengers.push(p);
				}
			}
			for (const p of a.passengers) { p.x = e.x; p.y = e.y; p.moving = false; }
			if (camel && a.seats !== a.passengers.length) {
				a.seats = a.passengers.length;
				b.addBuff(e, { key: 'ab:busSpeed', persist: true, mods: { moveMul: Math.max(0, 1 + speed * a.seats) } });
			}
		},
		death(c, b, e, a) { unload(b, e, a); },
	};
}
