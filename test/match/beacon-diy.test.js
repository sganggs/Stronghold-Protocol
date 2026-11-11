// GitHub #913: 信标's official text ends 「无法装备给自编干员」 / 「无法装备给自选干员」. Equipping it on a 自选
// operator used to destroy the carrier and send nothing. It is refused like any other illegal equip: no state change,
// the usual BAD_TARGET, and the client does not offer the target (test/ui/gameLogic.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatch, give, giveItem } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { itemTarget } from '../../server/match/bot.js';
import { chessIsDiy, itemForbidsDiy, itemTextForbidsDiy } from '../../shared/itemRules.js';

const QUIET = { warn() {}, error() {}, info() {} };
const REG = createRegistry({ log: QUIET });
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const T5A = 'chess_char_5_diy1_a';
const T5B = 'chess_char_5_diy1_b';
const SIEGE = 'char_112_siege';
const SIEGE_PICK = { charId: SIEGE, skillIndex: 2, uniEquipId: 'uniequip_002_siege' };
const BEACON = 'chess_item_5_04_e_a';
const GOLDEN = 'chess_item_5_04_e_b';
const HAMMER = 'chess_item_1_01_e_a';
const ITEM_FILES = [
  'data/items.json',
  'data/versions/act2autochess-v2_1/items.json',
  'data/versions/act1autochess/items.json',
  'data/versions/act1autochess-v1_1/items.json',
  'data/versions/act3autochess-v3_1/items.json',
];

const load = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

function setup(seed = 41) {
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: { [T5A]: SIEGE_PICK } },
    { seat: 1, playerId: 'p_1', name: 'P1', isBot: false, connected: true, diy: {} },
  ];
  const h = makeMatch({ mode: 'coop', seats, seed, registry: REG, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const p0 = h.ps('p_0');
  for (const p of [...p0.board.values(), ...p0.hand.filter(Boolean), ...p0.temp.filter(Boolean)]) {
    if (p.kind === 'chess') p0.returnCopies(p);
  }
  p0.board.clear();
  p0.hand.fill(null);
  p0.temp.fill(null);
  p0.offers.length = 0;
  p0.recompute();
  const equip = (item, target) => m.handle('p_0', { t: 'g.equip', itemUid: item.uid, targetUid: target.uid });
  return { h, m, p0, equip };
}

const owned = (ps) => [...ps.board.values(), ...ps.hand, ...ps.temp].filter((p) => p && p.kind === 'chess');
const gifts = (ps) => ps.effects.filter((e) => e.key === 'effect:builtin_gift');

test('noDiy is exactly the items whose official text forbids a 自选 carrier, in every version', () => {
  for (const rel of ITEM_FILES) {
    const items = load(rel);
    const flagged = [];
    for (const it of Object.values(items)) {
      const text = itemTextForbidsDiy(it.desc, it.descRaw);
      assert.equal(it.noDiy === true, text, `${rel} ${it.id}`);
      assert.equal(itemForbidsDiy(it), text, `${rel} ${it.id} predicate`);
      if (text) flagged.push(it.id);
    }
    assert.ok(flagged.length > 0, `${rel} has at least one 信标`);
    for (const id of flagged) assert.match(items[id].name, /信标/, `${rel} ${id}`);
  }
  const def = load('data/items.json');
  assert.equal(def[BEACON].noDiy, true);
  assert.equal(def[GOLDEN].noDiy, true);
  assert.equal(def[HAMMER].noDiy, undefined);
  const act3 = load('data/versions/act3autochess-v3_1/items.json');
  assert.equal(act3['chess_item_5_02_e_a'].noDiy, true);
  assert.equal(itemForbidsDiy({ desc: '无法装备给自选干员' }), true, 'a plugin item with the sentence and no flag');
  assert.equal(itemForbidsDiy({ noDiy: true, desc: 'translated' }), true);
  assert.equal(itemForbidsDiy({ desc: '攻击力+15%' }), false);
  assert.equal(chessIsDiy({ isDiy: true }), true);
  assert.equal(chessIsDiy({ diyFor: T5A }), true);
  assert.equal(chessIsDiy({ isDiy: false }), false);
});

test('信标 on a 自选 operator is refused: the piece and the item stay, nothing is offered or gifted', () => {
  const { h, m, p0, equip } = setup();
  const diy = p0.acquireChess(T5A, { source: 'test' });
  const elite = p0.acquireChess(T5B, { source: 'test' });
  assert.ok(diy && elite && chessIsDiy(p0.gd.chess(diy.id)) && chessIsDiy(p0.gd.chess(elite.id)));
  const before = owned(p0).map((p) => p.uid).sort();
  for (const [label, target, itemId] of [['normal', diy, BEACON], ['elite', elite, BEACON], ['golden', diy, GOLDEN]]) {
    const item = giveItem(m, p0, itemId);
    const res = equip(item, target);
    assert.deepEqual(res, { error: 'BAD_TARGET', detail: 'diy' }, label);
    assert.ok(p0.find(target.uid), `${label}: the carrier stays`);
    assert.ok(p0.find(item.uid), `${label}: the item stays`);
    assert.equal(p0.find(item.uid).area === 'equipped', false, `${label}: not equipped`);
  }
  assert.deepEqual(owned(p0).map((p) => p.uid).sort(), before);
  assert.equal(p0.offers.length, 0);
  assert.equal(gifts(p0).length, 0);
  const normal = give(m, p0, 'chess_char_3_01_a', 'hand');
  assert.deepEqual(equip(giveItem(m, p0, BEACON), normal), { ok: true }, 'a non-自选 carrier still works');
  assert.equal(p0.find(normal.uid), null, 'that carrier is destroyed');
  const hammer = giveItem(m, p0, HAMMER);
  assert.deepEqual(equip(hammer, diy), { ok: true }, 'an item without the sentence still equips on 自选');
  assert.ok((diy.items || []).some((it) => it.uid === hammer.uid));
  h.invariants();
});

test('the bot does not aim 信标 at a 自选 operator', () => {
  const { h, m, p0 } = setup(43);
  const diy = p0.acquireChess(T5A, { source: 'test' });
  // a hammer is equipment: the bot puts it on a deployed operator. 信标 also looks at the bench.
  assert.deepEqual(p0.move(diy.uid, { area: 'board', row: 9, col: 4 }, 'RIGHT'), { ok: true });
  const normal = give(m, p0, 'chess_char_2_01_a', 'hand');
  const beacon = giveItem(m, p0, BEACON);
  assert.equal(itemTarget(m, p0, beacon)?.uid, normal.uid, 'the lower-tier normal piece, not the tier-5 自选');
  p0.returnCopies(normal);
  const loc = p0.find(normal.uid);
  if (loc.area === 'hand') p0.hand[loc.idx] = null;
  p0.recompute();
  assert.equal(itemTarget(m, p0, beacon), null, 'only a 自选 carrier: the beacon stays in hand');
  assert.equal(itemTarget(m, p0, giveItem(m, p0, HAMMER))?.uid, diy.uid, 'a hammer still goes on the 自选 piece');
  h.invariants();
});
