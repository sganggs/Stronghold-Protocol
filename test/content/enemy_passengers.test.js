import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle } from '../helpers/battleHarness.js';
import * as enemies from '../../server/sim/content/enemies.js';

const CAMEL = 'enemy_10159_mntrjn', BUS = 'enemy_1302_ymtro_2';
const DOG = 'enemy_1000_gopro_2';
const parked = { motion: 'WALK', start: [9, 7], end: [9, 2], steps: [{ t: 'wait', s: 100 }, { t: 'move', p: [9, 2] }] };
const arena = (o = {}) => makeBattle({ content: 'generic', extraContent: [enemies], autoFinish: false, timeLimit: 600, ...o });
const spawn = (h, key, o = {}) => h.spawn(key, { pos: [9, 7], route: parked, ...o });
const seats = (e) => e.mem.ab.list.find((a) => a.passengers).passengers;

for (const [key, cap] of [[CAMEL, 5], [BUS, 4]]) {
	test(`${key}: carries non-machine normal and elite ground enemies, preserves them and respects capacity`, () => {
		const h = arena(); h.step();
		const e = spawn(h, key);
		const riders = Array.from({ length: cap + 1 }, (_, i) => spawn(h, i === 0 ? 'enemy_1045_hammer' : DOG));
		h.step();
		assert.equal(seats(e).length, cap);
		for (const p of riders.slice(0, cap)) {
			assert.equal(p.mem.carrier, e);
			assert.ok(p.alive && p.hidden && p.deployed);
		}
		assert.ok(!riders[cap].hidden);
		const r = riders[0], idx = r.route.legIdx, wait = r.route.waitLeft;
		h.run(2);
		assert.equal(r.route.legIdx, idx);
		assert.equal(r.route.waitLeft, wait);
		assert.equal(r.x, e.x);
		assert.equal(r.y, e.y);
		assert.ok(!h.snapshot().units.some((u) => u[0] === r.id));
		assert.equal(h.b.dealDamage(null, r, { amount: 100, type: 'true' }), 0);
	});

	test(`${key}: rejects leaders, machines, flying, hidden and out-of-radius enemies`, () => {
		const h = arena(); h.step();
		const e = spawn(h, key);
		const excluded = [spawn(h, 'enemy_1001_bigbo'), spawn(h, key === BUS ? CAMEL : BUS),
			spawn(h, 'enemy_1005_yokai'), spawn(h, DOG), spawn(h, DOG, { pos: [9, 7.501] })];
		h.b._setHidden(excluded[3], true);
		const boundary = spawn(h, DOG, { pos: [9, 7.5] });
		h.step();
		assert.deepEqual(seats(e), [boundary]);
		for (const p of excluded) assert.equal(p.mem.carrier, undefined);
	});

	for (const status of ['stun', 'freeze', 'sleep', 'levitate', 'unbalance', 'hidden']) {
		test(`${key}: ${status} prevents pickup until it ends`, () => {
			const h = arena(); h.step();
			const e = spawn(h, key), p = spawn(h, DOG);
			if (status === 'unbalance') e.unbalanceUntil = 100;
			else if (status === 'hidden') h.b._setHidden(e, true);
			else h.b.addBuff(e, { key: 'test:stop', flags: { [status]: true } });
			h.step();
			assert.equal(p.mem.carrier, undefined);
			e.unbalanceUntil = -Infinity;
			h.b._setHidden(e, false);
			h.b.removeBuff(e, 'test:stop');
			h.step();
			assert.equal(p.mem.carrier, e);
		});
	}

	test(`${key}: death unloads original units without a kill or bounty for passengers`, () => {
		const h = arena(); h.step();
		const e = spawn(h, key), p = spawn(h, DOG, { bounty: { coins: 3 } });
		h.step();
		h.b.kill(e);
		assert.ok(p.alive && !p.hidden);
		assert.equal(p.mem.carrier, undefined);
		assert.equal(h.b.killed, 1);
		if (key === CAMEL) {
			assert.ok(Math.abs(p.x - e.x) <= 0.2 && Math.abs(p.y - e.y) <= 0.2);
			assert.notEqual(p.route.legs, e.route.legs);
		} else assert.deepEqual([p.y, p.x], [Math.round(e.y), Math.round(e.x)]);
		assert.notEqual(p.route.legs[0]?.t, 'wait');
		h.runToEnd(100);
		assert.ok(!p.alive, 'unloaded passenger resumes walking and exits');
	});

	test(`${key}: leaking carrier unloads passengers; each leaks once and battle clears`, () => {
		const h = arena({ autoFinish: true });
		const route = { motion: 'WALK', start: [9, 7], end: [9, 2], checkpoints: [] };
		const e = spawn(h, key, { route }), p = spawn(h, DOG, { route });
		h.step();
		h.b.leak(e);
		assert.ok(p.alive && !p.hidden);
		h.runToEnd(100);
		assert.equal(h.b.leakedCount, 2);
		assert.equal(h.result().reason, 'cleared');
	});

	test(`${key}: natural exit releases passengers at the goal without hidden survivors`, () => {
		const h = arena({ autoFinish: true });
		const route = { motion: 'WALK', start: [9, 7], end: [9, 2], checkpoints: [] };
		const e = spawn(h, key, { route }), p = spawn(h, DOG, { route });
		h.step();
		assert.equal(p.mem.carrier, e);
		h.runToEnd(100);
		assert.equal(h.b.leakedCount, 2);
		assert.equal(h.result().reason, 'cleared');
		assert.ok(!p.hidden && !p.alive);
	});

	test(`${key}: timeout counts carrier and passenger independently once`, () => {
		const h = arena({ timeLimit: 1 });
		spawn(h, key); const p = spawn(h, DOG);
		h.step();
		assert.ok(p.hidden);
		h.runToEnd(2);
		assert.equal(h.b.leakedCount, 2);
		assert.equal(h.result().reason, 'timeout');
	});
}

test('camel speed uses additive -20% per passenger with absolute 0.1 floor, even under slow', () => {
	const h = arena(); h.step();
	const e = spawn(h, CAMEL);
	for (let n = 1; n <= 5; n++) {
		spawn(h, DOG); h.step();
		assert.ok(Math.abs(e.s.moveSpeed - Math.max(0.1, 1 - 0.2 * n)) < 1e-9);
	}
	h.b.addBuff(e, { key: 'test:slow', mods: { moveMul: 0.2 } });
	assert.equal(e.s.moveSpeed, 0.1);
});

test('all shipped stages lack a ladder: no arbitrary tile triggers early unloading', () => {
	const stages = JSON.parse(fs.readFileSync(new URL('../../data/stages.json', import.meta.url)));
	for (const s of Object.values(stages)) {
		assert.ok(!(s.devices || []).some((d) => /云梯|ladder/i.test(`${d.key} ${d.name} ${d.role}`)));
	}
});
