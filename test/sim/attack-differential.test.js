// The original engine remains an independent oracle for behavior that this refactor does not intentionally change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as original from '../../server/sim/damage.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

function fixture() {
	const h = makeBattle({
		defs: {
			chess: { t: chessRec({ id: 't', stats: { atk: 100, maxHp: 10000 }, skill: null }) },
			enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 10000, speed: 0, mass: 0 }) },
		},
		units: [{ uid: 1, chessId: 't', row: 10, col: 5 }], content: 'none', autoFinish: false, hooks: [],
	});
	h.step();
	return { h, b: h.b, u: h.unit(1), e: h.spawn('enemy_dummy', { pos: [10, 8] }) };
}

function runDamage(old, { type, attribution, shield, amount }) {
	const { b, u, e } = fixture();
	b.addBuff(u, { key: 'source', mods: { dmgDealtMul: 1.2, defIgnoreFlat: 10, resIgnorePct: 0.2 } });
	b.addBuff(e, { key: 'target', shield, mods: { defFlat: 200 - e.s.def, resFlat: 30 - e.s.res, dmgTakenMul: 1.3 } });
	const trace = [];
	for (const name of ['hit', 'hpDamage', 'fatal', 'damaged', 'kill']) b.on(name, c => trace.push({ name,
		source: c.source?.id ?? null, credit: c.credit?.id ?? null, killer: c.killer?.id ?? null, amount: c.amount }));
	const source = attribution === 'ownerless' ? null : u;
	const dmg = { type, amount, sourceless: attribution === 'sourceless' };
	const result = old ? original.dealDamage(b, source, e, dmg) : b.dealDamage(source, e, dmg);
	return { result, hp: e.hp, alive: e.alive, dealt: u.stats.dmg, taken: e.stats.taken,
		shield: e.findBuff('target')?.shield ?? 0, trace, events: b.drainEvents() };
}

test('legacy-compatible damage matches original HP, barriers, event order, attribution and wire events across 72 cases', () => {
	for (const type of ['phys', 'arts', 'true', 'elemental']) {
		for (const attribution of ['source', 'sourceless', 'ownerless']) {
			for (const shield of [0, 100, 20000]) {
				for (const amount of [100, 20000]) {
					const spec = { type, attribution, shield, amount };
					assert.deepEqual(runDamage(false, spec), runDamage(true, spec), JSON.stringify(spec));
				}
			}
		}
	}
});

function runElement(old) {
	const { b, u, e } = fixture();
	if (old) {
		b.dealDamage = (source, target, dmg) => original.dealDamage(b, source, target, dmg);
		b.heal = (source, target, amount, opts) => original.heal(b, source, target, amount, opts);
	}
	b.addBuff(u, { key: 'source', mods: { dmgDealtMul: 7 } });
	const trace = [];
	for (const name of ['elementHit', 'elementBurst', 'hit', 'fatal', 'damaged']) b.on(name, c => trace.push({ name,
		source: c.source?.id ?? null, amount: c.amount, type: c.dmg?.type }));
	const results = [];
	for (const element of ['burn', 'neural']) {
		results.push(b.dealDamage(u, e, { amount: 400, type: 'element', element }));
		results.push(b.dealDamage(u, e, { amount: 600, type: 'element', element }));
	}
	return { results, hp: e.hp, elem: e.elem, dealt: u.stats.dmg, taken: e.stats.taken, trace, events: b.drainEvents() };
}

test('sourced gauge fill, burst, source-less burst damage and cross-element cooldown match original', () => {
	assert.deepEqual(runElement(false), runElement(true));
});

function runHeal(old, regen) {
	const { b, u } = fixture();
	u.hp = u.s.maxHp - 100;
	b.addBuff(u, { key: 'heal', mods: { healingDealtMul: 1.2, healingTakenMul: 1.5 } });
	const trace = [];
	b.on('heal', c => { trace.push(c.amount); c.amount *= 2; });
	const fn = old ? (amount, opts) => original.heal(b, u, u, amount, opts) : (amount, opts) => b.heal(u, u, amount, opts);
	const result = fn(75, { regen, overheal: true });
	return { result, hp: u.hp, heal: u.stats.heal, shield: u.findBuff('overheal')?.shield ?? 0, trace, events: b.drainEvents() };
}

test('ordinary healing, overheal, regeneration and heal hook edits match original', () => {
	for (const regen of [false, true]) assert.deepEqual(runHeal(false, regen), runHeal(true, regen));
});
