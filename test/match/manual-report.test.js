import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observationMarkdown, resultMarkdown } from '../../tools/ai/manual-report.mjs';
import { actionReply } from '../../tools/ai/manual-files.mjs';

const row = (r, cells) => `${String(r).padStart(4)} ${cells.map(c => c.padStart(3)).join('')}`;
const unit = (uid, name, extra = {}) => ({ uid, id: `c${uid}`, name, kind: 'chess', class: 'WARRIOR', caps: { block: true }, bonds: [], items: [], ...extra });
function observation({ handFull = false } = {}) {
  return {
    v: 'sp-ai/1', id: 'x', public: { serverNow: 0 }, results: [],
    context: { round: 4, kind: 'prep', phase: 'PREP', deadline: 0, remaining: 50 },
    private: { seat: 0, shop: { maxLevel: 6, freeRefreshes: 0 }, deployCount: 2, effects: [], stats: { gold: 0, refreshes: 0, merges: 0 },
      hand: handFull ? Array(10).fill({}) : [null, ...Array(9).fill({})] },
    digest: {
      lp: 30, playerId: 'p', band: {}, deployCap: 8, bonds: [], rewards: [], choices: {}, opponents: [], boss: { id: 'boss_9', name: '首领', round: 14 },
      bench: [unit(5, '甲', { slot: 9 }), { uid: 7, id: 'i7', name: '盾', kind: 'item', slot: 8, items: [] }], overflow: [],
      board: [unit(1, '乙', { row: 9, col: 8, dir: 'RIGHT' }), unit(2, '丙', { row: 10, col: 5, dir: 'UP', class: 'CASTER', caps: { air: true } })],
      economy: { gold: 9, level: 3, upgradePrice: 8, refreshPrice: 1, interest: { carries: false }, frozenSlots: [] },
      shop: [{ slot: 0, kind: 'chess', id: 'c9', name: '丁', class: 'SNIPER', caps: { air: true }, tier: 2, price: 3, bonds: [] }],
      upcoming: [{ enemyKey: 'e1', name: '首领', count: 1, gate: 'lower', boss: true,
        enemy: { hp: 80000, def: 600, res: 40, motion: 'WALK', fly: false, effect: '会穿过阻挡其的单位' } }],
      geometry: { rows: [9, 12], cols: [0, 10],
        tiles: [{ at: [9, 8], terrain: 'melee' }, { at: [10, 5], terrain: 'melee' }, { at: [12, 3], terrain: 'ranged' }],
        routes: [{ fly: false, tiles: [[9, 10], [9, 9], [9, 8], [9, 7], [10, 7]] }, { fly: true, tiles: [[12, 10], [11, 9]] }] },
      lastBattle: { round: 3, lp: 30, lpLoss: 2, killed: 9, total: 11, leaks: [{ enemyKey: 'e2', name: '虫', count: 2, counted: 2, gates: ['lower'] }],
        units: [{ uid: 1, id: 'c1', name: '乙', kind: 'op', dmg: 12345, kills: 4, taken: 100, heal: 0 }] },
      actions: [
        { id: 'a1', text: 'buy shop slot 0 (丁, 3 gold)', intent: { t: 'g.buy', slot: 0 } },
        { id: 'a2', text: 'sell 1 (乙)', intent: { t: 'g.sell', uid: 1 } },
        { id: 'a3', text: 'equip 7 on 1 (乙)', intent: { t: 'g.equip', itemUid: 7, targetUid: 1 } },
        { id: 'a4', text: 'equip 7 on 2 (丙)', intent: { t: 'g.equip', itemUid: 7, targetUid: 2 } },
        { id: 'a5', text: 'bench 1 in slot 0', intent: { t: 'g.move', uid: 1, to: { area: 'hand', idx: 0 } } },
        { id: 'a6', text: 'place 5 at 9,9 RIGHT', intent: { t: 'g.move', uid: 5, to: { area: 'board', row: 9, col: 9 }, dir: 'RIGHT' } },
        ...['RIGHT', 'UP', 'DOWN', 'LEFT'].map((dir, k) => ({ id: `a${9 + k}`, text: `place 5 at 9,8 ${dir}`, intent: { t: 'g.move', uid: 5, to: { area: 'board', row: 9, col: 8 }, dir } })),
        { id: 'a13', text: 'place 5 at 9,7 LEFT', intent: { t: 'g.move', uid: 5, to: { area: 'board', row: 9, col: 7 }, dir: 'LEFT' } },
        { id: 'a7', text: 'ready', intent: { t: 'g.ready', ready: true } },
        { id: 'a8', text: 'refresh (1 gold)', intent: { t: 'g.refresh' } },
      ],
    },
  };
}

test('the manual page shows the last battle, a route map, roles, leader briefs and grouped actions in priority order', () => {
  const page = observationMarkdown(observation(), null, 4), lines = page.split('\n');
  for (const line of ['## Last battle R3: killed 9/11, LP −2 → 30', 'Leaks: 虫 ×2 lower gate.', 'Units dmg/kills/taken/heal: 1 乙 12.3k/4/100/0.',
    `     ${[3, 4, 5, 6, 7, 8, 9, 10].map(c => String(c).padStart(3)).join('')}`, row(12, ['H', ' ', ' ', ' ', ' ', ' ', ' ', '~']),
    row(11, [' ', ' ', ' ', ' ', ' ', ' ', '~', ' ']), row(10, [' ', ' ', '2', ' ', '^', ' ', ' ', ' ']),
    row(9, [' ', ' ', ' ', ' ', '^', '1', '<', '<']), 'Units: 1=1 乙 RIGHT on route; 2=2 丙 UP', '## Hand', 'uid=5 甲 [WARRIOR block] slot=9; ',
    'BOSS 首领: HP 80000 DEF 600 RES 40 WALK — 会穿过阻挡其的单位', 'Final Assault: R14 vs 首领 (boss_9).']) assert.ok(lines.includes(line), `missing ${JSON.stringify(line)}\n${page}`);
  assert.ok(lines.some(l => l.startsWith('0: 丁 [SNIPER air] T2 $3')));
  const actions = lines.slice(lines.indexOf('## Actions (IDs expire at the next observation)') + 1, lines.findIndex(l => l.startsWith('Answer act-4.json')) - 1);
  assert.deepEqual(actions, ['a1: buy shop slot 0 (丁, 3 gold)', 'a8: refresh (1 gold)', 'equip 7 盾 on: a3=1 乙, a4=2 丙', 'sell: a2=1 乙',
    'bench to hand idx 0: a5=1 乙', 'a7: ready',
    'place: tile=aN means aN RIGHT, aN+1 UP, aN+2 DOWN, aN+3 LEFT; a tile with letters lists only those',
    'place 5 甲: 9,9=a6R 9,8=a9 9,7=a13L']);
  assert.match(page, /bench\/withdraw \{"t":"g\.move","uid":U,"to":\{"area":"hand","idx":I\}\} \(I = the Hand slot number/);
});

test('rewards show class and tier, summons their owner; a full deploy cap and eliminated teammates are stated', () => {
  const o = observation();
  o.private.deployCount = 8;
  o.digest.rewards = [{ slot: 0, id: 'c20', name: '戊', class: 'WARRIOR', caps: { block: true }, tier: 6, price: 0, bonds: [] }];
  o.digest.bench.push({ uid: 9, id: 't9', kind: 'token', ownerUid: 1, name: '召唤物', slot: 7, items: [] });
  o.public.players = [{ playerId: 'p', alive: true }, { playerId: 'q', alive: false, bandId: 'band_x' }];
  const lines = observationMarkdown(o, null, 2).split('\n');
  for (const line of ['reward idx=0 id=c20: 戊 [WARRIOR block] T6 $0 — ',
    'uid=9 召唤物 [summon of 乙; placeable while its owner is on the board; not counted in the deploy cap] slot=7; ',
    '## Hand (deploy 8/8 full: operators here have no place shortcuts; swap one onto an occupied tile with a raw g.move)',
    '## Teammates (public)', 'Out: q (band band_x); you play on alone.']) assert.ok(lines.includes(line), `missing ${JSON.stringify(line)}\n${lines.join('\n')}`);
});

test('with the knowledge ranges, the map legend counts route tiles in each unit\'s base range for its facing', () => {
  // 乙 at 9,8 RIGHT: tiles 9,8 and 9,9 (ground route both); 丙 at 10,5 UP with a 2-tile forward range: 10,5 and 11,5
  const pack = { operators: [{ id: 'c1', range: [[0, 0], [0, 1]] }, { id: 'c2', range: [[0, 0], [0, 1]] }] };
  assert.ok(observationMarkdown(observation(), pack, 4).split('\n').includes(
    'Units (range = route tiles in its base range: ground/flyer): 1=1 乙 RIGHT on route range 2/0; 2=2 丙 UP range 0/0'));
});

test('a full hand says why no buy or reward shortcuts are listed', () => {
  assert.match(observationMarkdown(observation({ handFull: true }), null, 1), /## Hand \(FULL: no buy or reward shortcuts until you sell or place a piece\)/);
  assert.doesNotMatch(observationMarkdown(observation(), null, 1), /FULL/);
});

test('a batch may end with {"done":true}; anywhere else or outside prep it is refused', () => {
  const prep = { kind: 'prep', remaining: 10 };
  assert.deepEqual(actionReply(['a1', { done: true }], prep).intents, ['a1', { t: 'g.ready', ready: true }]);
  assert.deepEqual(actionReply({ done: true }, prep).intents, [{ t: 'g.ready', ready: true }]);
  assert.throws(() => actionReply([{ done: true }, 'a1'], prep), /only be the last entry/);
  assert.throws(() => actionReply(['a1', { done: true }], { kind: 'card', remaining: 10 }), /only for prep/);
});

test('the result page carries the last battle, the Final Assault included', () => {
  const record = { version: 'v', seed: 1, mode: 'solo', difficulty: 'ABYSS', round: 14, fa: { pool: 3000000, remaining: 2070000, damageBySeat: { 0: 930000 } },
    summary: { teamLp: 0, players: [{ seat: 0, playerId: 'p', victory: false, roundsPassed: 13, lp: 0, stats: { gold: 151 } }] },
    layerTrace: { spending: [], snapshots: [] }, external: { bySeat: { 0: { fallbacks: 0 } } }, finalFeedback: { 0: [] },
    lastBattle: { 0: { round: 14, boss: true, lp: 0, lpLoss: 0, killed: 20, total: 25, leaks: [{ enemyKey: 'b', name: '首领', count: 1, counted: 1, gates: [] }],
      units: [{ uid: 3, id: 'c3', name: '异客', kind: 'op', dmg: 420000, kills: 5, taken: 0, heal: 0 }] } } };
  const lines = resultMarkdown(record, 0).split('\n');
  for (const line of ['## Last battle R14 (boss field): killed 20/25, LP → 0', 'Leaks: 首领 ×1.', 'Units dmg/kills/taken/heal: 3 异客 420k/5/0/0.'])
    assert.ok(lines.includes(line), `missing ${JSON.stringify(line)}\n${lines.join('\n')}`);
});
