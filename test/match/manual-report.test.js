import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observationMarkdown } from '../../tools/ai/manual-report.mjs';
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
      lp: 30, playerId: 'p', band: {}, deployCap: 8, bonds: [], rewards: [], choices: {}, opponents: [],
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
    'BOSS 首领: HP 80000 DEF 600 RES 40 WALK — 会穿过阻挡其的单位']) assert.ok(lines.includes(line), `missing ${JSON.stringify(line)}\n${page}`);
  assert.ok(lines.some(l => l.startsWith('0: 丁 [SNIPER air] T2 $3')));
  const actions = lines.slice(lines.indexOf('## Actions (IDs expire at the next observation)') + 1, lines.findIndex(l => l.startsWith('Answer act-4.json')) - 1);
  assert.deepEqual(actions, ['a1: buy shop slot 0 (丁, 3 gold)', 'a8: refresh (1 gold)', 'equip 7 盾 on: a3=1 乙, a4=2 丙', 'sell: a2=1 乙',
    'bench to hand idx 0: a5=1 乙', 'a7: ready',
    'place: tile=aN means aN RIGHT, aN+1 UP, aN+2 DOWN, aN+3 LEFT; a tile with letters lists only those',
    'place 5 甲: 9,9=a6R 9,8=a9 9,7=a13L']);
  assert.match(page, /bench\/withdraw \{"t":"g\.move","uid":U,"to":\{"area":"hand","idx":I\}\} \(I = the Hand slot number/);
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

