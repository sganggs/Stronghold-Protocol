// The 自选 golden match covers what it claims (test/golden/README.md, tools/golden.mjs — 0.2.0 自选编队): reads the stored
// digest only (test/golden.test.js recomputes it). Its human seat (AI 托管) slots 推进之王 and prototypes; its shop draws
// its 自选 pieces (and only from the slots' 调度中心 levels), its AI fields 推进之王 — the operator kit — in battle, the
// stock ends where the held copies leave it, and the match ends without errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const MATCHES = read('./golden/matches.json');
const BACKUPS = read('../data/backups.json');
const ECONOMY = read('../data/config.json').economy;

test('matches: the 自选 match\'s human seat draws its 自选 pieces in its shop and fields 推进之王 in battle', () => {
  const [id, dg] = Object.entries(MATCHES.scenarios).find(([k]) => /-diy$/.test(k)) || [];
  assert.ok(dg, 'scenario present');
  assert.deepEqual(dg.errors, { engine: 0, logged: 0, sim: 0, dispatcher: 0 }, id);
  assert.deepEqual(Object.keys(dg.diy.picks).sort(), Object.keys(BACKUPS.diy.slots).sort(), 'all four slots filled');
  assert.equal(dg.diy.picks.chess_char_5_diy1_a.charId, 'char_112_siege');
  const draws = dg.diy.rounds.flatMap(([, d]) => (d ? d.split(' ') : []));
  assert.ok(draws.length >= 2, `shop draws: ${draws.join(', ')}`);
  for (const d of draws) assert.ok(Object.hasOwn(BACKUPS.diy.slots, `chess_char_${d}`), d);
  const fielded = dg.diy.rounds.filter(([, , f]) => f).flatMap(([r, , f]) => f.split(' ').map((x) => `${r}:${x}`));
  assert.ok(fielded.some((x) => x.endsWith('5_diy1_a→char_112_siege')), `fielded: ${fielded.join(', ')}`);
  for (const [r, , f] of dg.diy.rounds) {
    for (const x of f ? f.split(' ') : []) {
      const [slot, charId] = x.split('→');
      assert.equal(dg.diy.picks[`chess_char_${slot}`].charId, charId, `round ${r}: ${x} fights as its pick`);
    }
  }
  // the stock: never above its cap (the pool copies of its tier — 8 at tier 5, 5 at tier 6, ×2 in this co-op match:
  // economy.poolCopiesCoopScale, GitHub #430)
  const capOf = (slot) => ECONOMY.poolCopies[BACKUPS.diy.slots[slot].tier] * (ECONOMY.poolCopiesCoopScale || 1);
  for (const [slot, left] of Object.entries(dg.diy.stock)) assert.ok(left >= 0 && left <= capOf(slot), slot);
});
