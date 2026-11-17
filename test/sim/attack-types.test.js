// Native tinman_t_2 filters attackType BUFF at ON_TAKE_DAMAGE, independently of attribution and attack behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { refreshTinmanWither } from '../../server/sim/content/kits/ops/chess_char_1_16-tinman.js';
import { dealDamage } from '../../server/sim/attack.js';

const ds = getDefaultSource();
function arena({ elite = true, skillIndex, beforeCast = null, res = 0, allies = [] } = {}) {
  const id = `chess_char_2_19_${elite ? 'b' : 'a'}`;
  const h = makeBattle({ autoFinish: false, defs: {
    chess: { [id]: { ...ds.rawChess(id), garrisonIds: [] } },
    enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 1000000, def: 50, res, atk: 0, speed: 0 }) } },
    units: [{ uid: 'tinman', chessId: id, ...(skillIndex != null ? { skillIndex } : {}), row: 10, col: 4, carryState: { sp: 0 } }, ...allies] });
  h.step();
  const b = h.b, u = h.unit('tinman'), e = h.spawn('enemy_probe', { pos: [10, 6] });
  u.atkCd = 999;
  if (beforeCast) beforeCast({ h, b, u, e });
  const atk = u.s.atk;
  assert.ok(u.skill.activate('test', { free: true }));
  h.step();
  const w = e.findBuff('tinman:wither')?.data.mul ?? 1;
  return { h, b, u, e, w, atk };
}
function done({ b }) { checkInvariants(b); assert.deepEqual(b.errors, []); }
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('Tinman filters explicit attack type after mitigation, independently of tags and attack behavior', () => {
  const f = arena(), { b, e, w } = f;
  assert.ok(w > 1);
  approx(b.dealDamage({ target: e, amount: 100, type: 'phys', attackType: 'BUFF' }), 50 * w);
  approx(b.dealDamage({ target: e, amount: 100, type: 'phys', attackType: 'NORMAL', tags: ['dot'] }), 50);
  approx(b.dealDamage({ target: e, amount: 100, type: 'phys', tags: ['dot'] }), 50);
  approx(b.dealDamage({ target: e, amount: 100, type: 'phys', attackType: 'BUFF', isAttack: true }), 50 * w);
  for (const attackType of ['NONE', 'SPLASH', 'ADDITION']) approx(b.dealDamage({ target: e, amount: 100, type: 'phys', attackType }), 50);
  approx(b.dealHPLose({ target: e, amount: 100, type: 'phys' }), 50);
  assert.throws(() => dealDamage(b, { target: e, amount: 100, attackType: 'invalid' }), TypeError);
  done(f);
});

test('legacy tag inference stays at the compatibility boundary and explicit classification wins', () => {
  const f = arena(), { b, u, e, w } = f;
  approx(b.dealDamage(u, e, { amount: 100, type: 'phys', tags: ['dot'] }), 50 * w);
  approx(b.dealDamage(u, e, { amount: 100, type: 'phys', tags: ['dot'], attackType: 'NORMAL' }), 50);
  const dmg = b.makeDamage({ amount: 100, type: 'phys', tags: ['dot'], canDodge: false });
  delete dmg.attackType; // A fully normalized descriptor created before attackType existed.
  let seen;
  b.on('hit', c => { if (c.target === e) seen = c.dmg; });
  approx(b.dealDamage(u, e, dmg), 50 * w);
  assert.equal(seen, dmg);
  done(f);
});

for (const shieldFirst of [true, false]) test(`Tinman injury multiplier follows ${shieldFirst ? 'an earlier' : 'a later'} barrier's acquisition position`, () => {
  const f = arena({ beforeCast: shieldFirst ? ({ b, e }) => b.addBuff(e, { key: 'barrier', shield: 100000 }) : null });
  const { b, e, w } = f;
  // The first large barrier survives the initial pulse and keeps its actual acquisition position.
  if (shieldFirst) e.findBuff('barrier').shield = 40;
  else b.addBuff(e, { key: 'barrier', shield: 40 });
  approx(b.dealDamage({ target: e, amount: 100, type: 'true', attackType: 'BUFF' }), shieldFirst ? 60 * w : 100 * w - 40);
  done(f);
});

for (const elite of [false, true]) for (const skillIndex of [0, 1]) {
  test(`Tinman ${elite ? 'elite' : 'normal'} S${skillIndex + 1} caches ATK, stays source-less after death and retains kill credit`, () => {
    const f = arena({ elite, skillIndex, res: 30, beforeCast({ b, u }) {
      b.addBuff(u, { key: 'source-modifiers', mods: { dmgDealtMul: 3, resIgnoreFlat: 100 } });
    } });
    const { h, b, u, e, w, atk } = f, seen = [];
    b.on('damageApplied', c => { if (c.target === e && c.dmg.tags.includes('zone')) seen.push(c); });
    const scale = u.skill.bb.atk_scale;
    b.addBuff(u, { key: 'later-atk', mods: { atkFlat: 10000 } });
    b.kill(u, null);
    h.run(1.1);
    assert.ok(seen.length >= 1);
    for (const c of seen) {
      assert.equal(c.source, null);
      assert.equal(c.credit, u);
      assert.equal(c.dmg.attackType, 'BUFF');
      assert.equal(c.dmg.calculation, 'precomputed');
      approx(c.amount, atk * scale * 0.7 * w);
    }
    e.hp = 1;
    let killer;
    b.on('death', c => { if (c.unit === e) killer = c.killer; });
    h.run(1.1);
    assert.equal(e.alive, false);
    assert.equal(killer, u);
    done(f);
  });
}

for (const shield of [false, true]) test(`Tinman ordinary arts ticks ${shield ? 'spend an earlier shield before a later dodge' : 'permit a normal dodge'}`, () => {
  const f = arena({ beforeCast({ b, e }) {
    if (shield) b.addBuff(e, { key: 'shield', shieldHits: 3 });
    b.addBuff(e, { key: 'dodge', mods: { dodgeArts: 1 } });
  } });
  const { h, b, e } = f;
  const hp = e.hp;
  let rolls = 0;
  b.rng = Object.assign(() => { rolls++; return 0; }, b.rng);
  h.run(1.1);
  assert.equal(e.hp, hp);
  assert.equal(rolls, shield ? 0 : 1);
  if (shield) assert.equal(e.findBuff('shield').shieldHits, 1);
  done(f);
});

test('overlapping real Tinman units stack their damage, not their BUFF amplification, and refresh keeps injury order', () => {
  const f = arena(), { h, b, u, e, w } = f;
  const held = e.findBuff('tinman:wither'), seq = held.seq;
  assert.ok(u.skill.activate('test', { free: true }));
  h.step();
  assert.equal(e.buffs.filter(buff => buff.key === 'tinman:wither').length, 2);
  approx(b.dealDamage({ target: e, amount: 100, type: 'true', attackType: 'BUFF' }), 100 * w);
  h.run(1.1);
  assert.ok(e.buffs.includes(held));
  assert.equal(held.seq, seq);
  approx(b.dealDamage({ target: e, amount: 100, type: 'true', attackType: 'BUFF' }), 100 * w);
  done(f);
});

test('Tinman named amplification takes the strongest held copy and restores a weaker one after expiry', () => {
  const f = arena(), { h, b, u, e, w } = f;
  refreshTinmanWither(b, e, u, 'weak-fixture', 1, 1.1);
  approx(b.dealDamage({ target: e, amount: 100, type: 'true', attackType: 'BUFF' }), 100 * w);
  refreshTinmanWither(b, e, u, 'strong-fixture', 0.1, 1.5);
  approx(b.dealDamage({ target: e, amount: 100, type: 'true', attackType: 'BUFF' }), 150);
  h.run(0.2);
  approx(b.dealDamage({ target: e, amount: 100, type: 'true', attackType: 'BUFF' }), 100 * w);
  done(f);
});

for (const skillIndex of [0, 1]) test(`Tinman S${skillIndex + 1} coverage removes out-of-range amplification and reacquires it before a direct hit`, () => {
  const f = arena({ skillIndex }), { b, e, w } = f;
  const first = e.findBuff('tinman:wither'), x = e.x;
  e.x += 10;
  approx(b.dealDamage({ target: e, amount: 100, type: 'true', attackType: 'BUFF' }), 100);
  assert.equal(e.findBuff('tinman:wither'), null);
  e.x = x;
  approx(b.dealDamage({ target: e, amount: 100, type: 'true', attackType: 'BUFF' }), 100 * w);
  const second = e.findBuff('tinman:wither');
  assert.notEqual(second, first);
  assert.ok(second.seq > first.seq, 're-entering actually acquires a new effect');
  done(f);
});

for (const skillIndex of [0, 1]) test(`Tinman S${skillIndex + 1} coverage survives caster death until the declared lifetime, then releases effects and hooks`, () => {
  const f = arena({ skillIndex }), { h, b, u, e, w } = f;
  b.kill(u, null);
  const count = name => (b._hooks[name] ?? []).filter(hook => hook.owner === null).length;
  const hits = count('hit'), ticks = count('tick');
  const duration = u.skill.bb.projectile_delay_time;
  h.run(duration - 0.3);
  assert.equal(u.mem.tinZones, 1, 'the unit still exists after its last damage pulse');
  approx(b.dealDamage({ target: e, amount: 100, type: 'true', attackType: 'BUFF' }), 100 * w);
  h.run(0.5);
  assert.equal(u.mem.tinZones, 0);
  assert.equal(e.findBuff('tinman:wither'), null);
  assert.equal(count('hit'), hits - 1);
  assert.equal(count('tick'), ticks - 1);
  approx(b.dealDamage({ target: e, amount: 100, type: 'true', attackType: 'BUFF' }), 100);
  done(f);
});

test('Tinman S2 regeneration tracks coverage, survives caster death and still bypasses healing prohibition', () => {
  const f = arena({ skillIndex: 1, allies: [{ uid: 'ally', chessId: 'chess_char_1_02_a', row: 10, col: 5 }] });
  const { h, b, u } = f, ally = h.unit('ally');
  const zone = () => ally.buffs.filter(buff => buff.key.startsWith('tinman:zone:'));
  assert.equal(zone().length, 1);
  const value = zone()[0].mods.hpRegen, x = ally.x;
  b.addBuff(ally, { key: 'healing-prohibition', flags: { healFree: true } });
  b.kill(u, null);
  ally.hp = ally.s.maxHp / 2;
  let hp = ally.hp;
  h.run(0.2);
  assert.ok(ally.hp > hp);
  ally.x += 10;
  b.dealDamage({ target: ally, amount: 1, type: 'true' });
  assert.equal(zone().length, 0);
  hp = ally.hp;
  h.run(0.2);
  approx(ally.hp, hp);
  ally.x = x;
  b.dealDamage({ target: ally, amount: 1, type: 'true' });
  assert.equal(zone().length, 1);
  approx(zone()[0].mods.hpRegen, value);
  hp = ally.hp;
  h.run(0.2);
  assert.ok(ally.hp > hp);
  done(f);
});

test('overlapping Tinman S2 units keep independent regeneration pools and expire separately', () => {
  const f = arena({ skillIndex: 1, allies: [{ uid: 'ally', chessId: 'chess_char_1_02_a', row: 10, col: 5 }] });
  const { h, b, u } = f, ally = h.unit('ally');
  const zone = () => ally.buffs.filter(buff => buff.key.startsWith('tinman:zone:'));
  const value = zone()[0].mods.hpRegen;
  h.run(0.3);
  assert.ok(u.skill.activate('test', { free: true }));
  h.step();
  assert.equal(zone().length, 2);
  approx(zone().reduce((sum, buff) => sum + buff.mods.hpRegen, 0), 2 * value);
  b.kill(u, null);
  assert.ok(h.runUntil(() => u.mem.tinZones === 1, u.skill.bb.projectile_delay_time + 1));
  assert.equal(zone().length, 1);
  approx(zone()[0].mods.hpRegen, value);
  assert.ok(h.runUntil(() => u.mem.tinZones === 0, 1));
  assert.equal(zone().length, 0);
  done(f);
});
