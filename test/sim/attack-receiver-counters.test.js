// PRTS 伤判效果 / 玛恩纳 / 刺玫: receiving units own their injury observation effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

function fixture(kind, duplicate = false) {
	const chessId = kind === 'mlynar' ? 'chess_char_5_19_a' : 'chess_char_1_06_a';
	const h = makeBattle({ autoFinish: false, units: [
		{ uid: 'source', chessId, row: 10, col: 3, skillIndex: kind === 'mlynar' ? 0 : 1 },
		{ uid: 'receiver', chessId: 'receiver', row: 10, col: 4 },
		...(duplicate ? [{ uid: 'other', chessId, row: 11, col: 3, skillIndex: kind === 'mlynar' ? 0 : 1 }] : []),
	], defs: { chess: { receiver: chessRec({ id: 'receiver', bonds: ['kazimierzShip'], stats: { maxHp: 20000, atk: 0 }, skill: null }) },
		enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 100000, def: 0, res: 0, speed: 0, atk: 0 }) } } });
	h.step();
	const b = h.b, source = h.unit('source'), receiver = h.unit('receiver');
	const enemy = h.spawn('enemy_probe', { pos: [10, 8] });
	if (kind === 'vendela') {
		assert.ok(source.skill.activate('test', { free: true }));
		assert.equal(source.mem.protege, receiver);
	}
	return { h, b, source, receiver, enemy };
}
const keyOf = (kind, source) => `${kind === 'mlynar' ? 'mlynar:reflection' : 'vendla:counter'}:${source.id}`;

for (const kind of ['mlynar', 'vendela']) for (const defence of ['dodge', 'block', 'barrier']) {
	test(`${kind} receiver reflects after earlier ${defence} and removes coverage when the provider leaves`, () => {
		const { b, source, receiver, enemy } = fixture(kind);
		b.addBuff(receiver, { key: 'earlier', injuryPriority: 3000,
			...(defence === 'dodge' ? { mods: { dodgePhys: 1 } } : defence === 'barrier' ? { shield: 10000 } : { injury(c) { c.block(); } }) });
		b.rng = () => 0;
		let answers = 0, successes = 0;
		b.on('hit', c => { if (c.source === source && c.target === enemy && c.dmg.tags?.some(t => t === 'counter' || t === 'reflect')) answers++; });
		b.on('damageApplied', c => { if (c.target === receiver) successes++; });
		const buff = receiver.findBuff(keyOf(kind, source));
		assert.ok(buff);
		b.emit('tick', { dt: 0 });
		assert.equal(receiver.findBuff(buff.key), buff, 'continuous coverage must retain acquisition order');
		const hp = receiver.hp;
		b.dealDamage({ source: enemy, target: receiver, amount: 100, type: 'phys' });
		assert.equal(receiver.hp, hp);
		assert.equal(successes, 0);
		assert.equal(answers, 1);
		b.dealHPLose({ source: enemy, target: receiver, amount: 1 });
		b.dealElementDamage({ source: enemy, target: receiver, amount: 1, element: 'burn' });
		b.dealDamage({ source: null, credit: enemy, target: receiver, amount: 1, type: 'true' });
		b.dealDamage({ source: enemy, target: receiver, amount: 1, type: 'true', tags: ['reflect'] });
		const expected = kind === 'vendela' ? 2 : 1;
		assert.equal(answers, expected, 'Vendla native source filter does not infer exclusions from descriptive tags');
		b.retreat(source);
		assert.equal(receiver.findBuff(keyOf(kind, source)), null);
		b.dealDamage({ source: enemy, target: receiver, amount: 100, type: 'phys' });
		assert.equal(answers, expected);
		checkInvariants(b);
		assert.equal(b.errors.length, 0);
	});
}

test('Vendla counter skips source calculation, keeps output, and is independent of the provider action state', () => {
	for (const status of ['stun', 'freeze', 'sleep', 'disarm']) {
		const { b, source, receiver, enemy } = fixture('vendela');
		b.applyStatus(source, status, { duration: 10 });
		let calculations = 0, outputs = 0;
		const hits = [];
		b.on('damageCalculate', c => { if (c.source === source) { calculations++; c.dmg.amount *= 100; } });
		b.on('damageOutput', c => { if (c.source === source) outputs++; });
		b.on('hit', c => { if (c.source === source && c.target === enemy) hits.push(c.dmg); });
		assert.equal(source.s.flags[status], true);
		if (status === 'stun' || status === 'freeze') assert.equal(source.canAct, false);
		b.dealDamage({ source: enemy, target: receiver, amount: 10, type: 'true', tags: ['counter', 'reflect'] });
		assert.equal(calculations, 0);
		assert.equal(outputs, 1);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].calculation, 'precomputed');
		assert.equal(hits[0].attackType, 'NORMAL');
		assert.equal(hits[0].applyWay, 'RANGED');
		assert.equal(hits[0].traitAlly, receiver);
		assert.deepEqual(b.errors, []);
		checkInvariants(b);
	}
});

for (const kind of ['mlynar', 'vendela']) {
	test(`${kind} receiver redeployment follows continuous aura versus cast-time target grant`, () => {
		const { b, source, receiver } = fixture(kind);
		const first = receiver.findBuff(keyOf(kind, source));
		assert.ok(first);
		b.retreat(receiver);
		assert.equal(receiver.findBuff(first.key), null);
		assert.ok(b.redeploy(receiver));
		const later = receiver.findBuff(first.key);
		if (kind === 'mlynar') assert.ok(later && later.seq > first.seq);
		else assert.equal(later, null, 'the protected target is chosen and granted the effect at cast, not every deploy');
		checkInvariants(b);
	});
}

test('Mlynar duplicate-provider policy remains one living source and switches immediately on departure', () => {
	const { h, b, source, receiver, enemy } = fixture('mlynar', true);
	const other = h.unit('other'), hits = [];
	b.on('hit', c => { if (c.target === enemy && c.dmg.tags?.includes('reflect')) hits.push(c.source); });
	b.dealDamage({ source: enemy, target: receiver, amount: 1, type: 'true' });
	assert.deepEqual(hits.splice(0), [source]);
	b.retreat(source);
	assert.equal(receiver.findBuff(keyOf('mlynar', source)), null);
	assert.ok(receiver.findBuff(keyOf('mlynar', other)));
	b.dealDamage({ source: enemy, target: receiver, amount: 1, type: 'true' });
	assert.deepEqual(hits.splice(0), [other]);
	assert.ok(b.redeploy(source));
	b.dealDamage({ source: enemy, target: receiver, amount: 1, type: 'true' });
	assert.deepEqual(hits, [source]);
	checkInvariants(b);
});

test("ending one Vendela skill removes only its receiver observer and leaves another source's current taunt", () => {
	const { h, b, source, receiver, enemy } = fixture('vendela', true);
	const other = h.unit('other');
	assert.ok(other.skill.activate('test', { free: true }));
	assert.equal(other.mem.protege, receiver);
	assert.equal(receiver.findBuff('vendla:taunt').source, other);
	source.skill.end('test');
	assert.equal(receiver.findBuff(keyOf('vendela', source)), null);
	assert.ok(receiver.findBuff(keyOf('vendela', other)));
	assert.equal(receiver.findBuff('vendla:taunt').source, other);
	const answers = [];
	b.on('hit', c => { if (c.target === enemy && c.dmg.tags?.includes('counter')) answers.push(c.source); });
	b.dealDamage({ source: enemy, target: receiver, amount: 10, type: 'true' });
	assert.deepEqual(answers, [other]);
	other.skill.end('test');
	assert.equal(receiver.findBuff('vendla:taunt'), null);
	assert.equal(receiver.findBuff(keyOf('vendela', other)), null);
	checkInvariants(b);
});


test('Vendela counter follows the native ranged route and ordinary arts dodge', () => {
	const { b, source, receiver, enemy } = fixture('vendela');
	b.addBuff(enemy, { key: 'arts-dodge', mods: { dodgeArts: 1 } });
	b.rng = () => 0;
	const routes = [];
	b.on('hit', c => { if (c.source === source && c.target === enemy) routes.push(c.dmg.applyWay); });
	const hp = enemy.hp;
	b.dealDamage({ source: enemy, target: receiver, amount: 10, type: 'true' });
	assert.deepEqual(routes, ['RANGED']);
	assert.equal(enemy.hp, hp);
	checkInvariants(b);
});


test('Vendela counter trait heal settles before the triggering injury removes HP', () => {
	const { b, source, receiver, enemy } = fixture('vendela');
	receiver.hp = receiver.s.maxHp;
	const hp = receiver.hp, order = [];
	b.on('heal', c => { if (c.source === source && c.target === receiver) order.push(['heal', receiver.hp]); });
	b.on('hpChanged', c => { if (c.target === receiver && c.kind === 'damage') order.push(['damage', receiver.hp]); });
	assert.equal(b.dealDamage({ source: enemy, target: receiver, amount: 10, type: 'true' }), 10);
	assert.equal(receiver.hp, hp - 10, 'the pre-injury full-HP heal cannot replenish this later loss');
	assert.deepEqual(order, [['heal', hp], ['damage', hp - 10]]);
	checkInvariants(b);
});
