// test/content/feedback3-siracusa-rolls.test.js — 叙拉古 6's true-damage proc rolls on every 普通伤害 hit of a member
// (0.1.3; community report 「叙拉古盟约真伤概率数值没有正确递增成长」, GitHub #79 「咬了一整个技能也没出」). PRTS 盟约记录
// 叙拉古: "※仅在造成普通伤害时尝试…", "每次造成普通伤害时尝试触发"; PRTS 伤害分类: 普通伤害 = attack type NORMAL, the
// default (group damage too unless it is 溅射); 溅射 / 持续 (BUFF) / 附加 (ADDITION) are other types. With the battle rng
// forced to 0 every roll hits, so the procs count the hits that rolled (the PRD rule and the amounts are unchanged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const L = 20;
const SIRA6 = { siracusaShip: { count: 6, active: true, tier: 2, layers: L } };
const dummy = (key) => enemyRec({ key, hp: 1e9, speed: 0, def: 0, res: 0 });
const ENEMIES = { e_dummy: dummy('e_dummy'), e_dummy2: dummy('e_dummy2') };
function forceRng(h, v) { const orig = h.b.rng; h.b.rng = Object.assign(() => v, orig); }
const isProc = (c) => !!(c.dmg && c.dmg.tags && c.dmg.tags.includes('bond:siracusa'));
const hasTag = (c, t) => !!(c.dmg && c.dmg.tags && c.dmg.tags.includes(t));

test('叙拉古 6: which damage rolls — attacks, skill hits, drone attacks yes; 溅射, 持续, 附加, item procs, element, 无来源 no', () => {
  const h = makeBattle({
    defs: { chess: { r0_a: chessRec({ id: 'r0_a', bonds: ['siracusaShip'], skill: null }) }, enemies: ENEMIES },
    units: [{ chessId: 'r0_a', row: 10, col: 3 }], enemies: [{ key: 'e_dummy', pos: [12, 9] }], // out of her range
    bonds: SIRA6, autoFinish: false, timeLimit: 300,
  });
  h.step(1);
  const a = h.unit('r0_a'), e = h.enemies()[0];
  assert.ok(a.s.flags.stealth, '隐匿 after the deployment');
  forceRng(h, 0);
  let procs = 0;
  h.b.on('damaged', (c) => { if (isProc(c)) procs++; });
  const rolls = (d) => { const n0 = procs; h.b.dealDamage(a, e, { amount: 1, ...d }); return procs - n0; };
  const cases = [
    ['a normal attack', { type: 'phys', isAttack: true }, 1],
    ['a skill hit (剑雨-like)', { type: 'arts', isSkill: true, tags: ['skill'] }, 1],
    ['a drone attack (neither attack nor skill)', { type: 'arts', tags: ['droneAttack'] }, 1],
    ['a module / talent hit with no class', { type: 'arts', tags: ['talent'] }, 1],
    ['溅射', { type: 'phys', isAttack: true, isSplash: true }, 0],
    ['持续 (the S3 pulse, 缄默德克萨斯 S1)', { type: 'arts', isSkill: true, tags: ['skill', 'drone', 'dot'] }, 0],
    ['持续 (periodic)', { type: 'true', canDodge: false, tags: ['dot', 'periodic'] }, 0],
    ['附加 (拉普兰德 module, 忍冬 追凶)', { type: 'arts', tags: ['module', 'addition'] }, 0],
    ['an item proc', { type: 'true', canDodge: false, tags: ['item', 'item:pegasus'] }, 0],
    ['another bond\'s rider', { type: 'true', canDodge: false, tags: ['bond:kazimierz'] }, 0],
    ['element damage', { type: 'element', element: 'burn' }, 0],
    ['无来源 damage', { type: 'arts', canDodge: false, sourceless: true }, 0],
  ];
  for (const [label, d, want] of cases) assert.equal(rolls(d), want, label);
  checkInvariants(h.b);
});

test('叙拉古 6: 荒芜拉普兰德 S3 — every drone attack rolls, the per-second pulse (持续法术伤害) does not', () => {
  const log = [];
  const h = makeBattle({
    defs: { enemies: ENEMIES }, seed: 7, timeLimit: 120, autoFinish: false, bonds: SIRA6,
    units: [{ chessId: 'chess_char_6_18_a', row: 10, col: 3, carryState: { sp: 69 } }],
    enemies: [{ key: 'e_dummy', pos: [12, 9] }],
    setup(b) { b.on('damaged', (c) => log.push(c), { priority: -999 }); },
  });
  const u = h.unit('chess_char_6_18_a');
  assert.ok(h.runUntil(() => u.skill.active, 10), 'S3 cast');
  forceRng(h, 0);
  const t0 = h.b.time, from = log.length;
  h.run(10);
  assert.ok(u.skill.active && u.s.flags.stealth, 'still in S3 and 隐匿');
  const mine = log.slice(from).filter((c) => c.source === u);
  const drones = mine.filter((c) => hasTag(c, 'droneAttack')).length;
  const pulses = mine.filter((c) => hasTag(c, 'drone'));
  const procs = mine.filter(isProc).length;
  assert.ok(drones >= 5, `drone attacks ${drones}`);
  assert.ok(pulses.length >= 5 && pulses.every((c) => hasTag(c, 'dot')), `pulses ${pulses.length}, 持续伤害`);
  assert.equal(mine.filter((c) => c.dmg?.isAttack).length, 0, 'no attack of her own during S3');
  assert.equal(procs, drones, `one roll per drone attack, none per pulse (t ${t0.toFixed(1)}–${h.b.time.toFixed(1)})`);
  checkInvariants(h.b);
});

test('叙拉古 6: 德克萨斯 S2 剑雨 — both hits on every enemy around roll', () => {
  const log = [];
  const h = makeBattle({
    defs: { enemies: ENEMIES }, seed: 3, timeLimit: 60, autoFinish: false, bonds: SIRA6,
    units: [{ chessId: 'chess_char_1_08_a', row: 10, col: 3, carryState: { sp: 40 } }],
    // inside the skill's diamond, outside her attack range (her tile and the one in front)
    enemies: [{ key: 'e_dummy', pos: [10, 5] }, { key: 'e_dummy2', pos: [11, 4] }],
    setup(b) { b.on('damaged', (c) => log.push({ c, t: b.time }), { priority: -999 }); },
  });
  forceRng(h, 0);
  const u = h.unit('chess_char_1_08_a');
  const rainHit = (x) => x.c.source === u && x.c.dmg?.isSkill && !isProc(x.c);
  assert.ok(h.runUntil(() => log.some(rainHit), 5), '剑雨 cast');
  const T = log.find(rainHit).t;
  const mine = log.filter((x) => x.c.source === u && x.t === T).map((x) => x.c);
  assert.equal(mine.filter((c) => c.dmg?.isSkill && !isProc(c)).length, 4, 'two hits on each of the two enemies');
  assert.equal(mine.filter((c) => c.dmg?.isAttack).length, 0, 'no attack hit in that tick');
  assert.equal(mine.filter(isProc).length, 4, 'every 剑雨 hit rolled (rng 0: each roll hits)');
  checkInvariants(h.b);
});
