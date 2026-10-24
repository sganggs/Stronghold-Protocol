// A unit's summons leave with it (engine rule, server/sim/battle/deploy.js `_remove` → `_recallSummons`).
// Reported 2026-10-23: 琳琅诗怀雅 S2's 香槟炸弹 stayed on the field when she was knocked out — the original game
// withdraws the bottles with her (maintainer's playtest), and the same holds for every summon a unit owns; only a
// token the token's own kit retracts was ever removed before 0.3.2. The rule sits on the window between
// `underway` and `resolved` and does not count as a knock-out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';
import { TOKEN_IDS } from '../../server/sim/content/tokens.js';

const REAL = { skip: !hasGeneratedData() };
const SWIRE = 'chess_char_3_04_b'; // 琳琅诗怀雅, S2 见面礼: places a 香槟炸弹
const flat = { rows: { '9': '##ERRrrRrrSrrrrrrrS##', '10': '##hrrRrrrrfrrrrrrrf##', '11': '##hrrRrrrrfrrrrrrrf##' } };

const bottles = (h, u) => h.b.allyUnits.filter((t) => t.kind === 'token' && t.defId === TOKEN_IDS.champagne && t.ownerUnit === u);
function herField(opts = {}) {
  return makeBattle({
    flat,
    units: [{ uid: 1, chessId: SWIRE, row: 9, col: 4, skill: 2 }],
    enemies: [{ uid: 90, enemyId: 'enemy_1007_slime', row: 3, col: 4 }],
    autoFinish: false, timeLimit: 90, seed: 7, ...opts,
  });
}
const castS2 = (h) => { const sw = h.unit(1); sw.skill.sp = sw.skill.spCost; h.step(2); return sw; };

test('琳琅诗怀雅 S2: the bottles leave with her — knocked out, retreated or sold (playtest 2026-10-23)', REAL, () => {
  for (const how of ['killed', 'retreat', 'sold']) {
    const h = herField();
    h.run(0.5);
    const sw = castS2(h);
    const b = bottles(h, sw);
    assert.equal(b.length, 1, `${how}: the S2 placed its bomb`);
    assert.equal(b[0].alive, true);
    if (how === 'killed') h.b.kill(sw, null);
    else if (how === 'retreat') h.b.retreat(sw);
    else h.b.retreat(sw, { permanent: true }); // 出售 / 联防移交: the piece leaves the field for good
    h.step(3);
    assert.equal(b[0].alive, false, `${how}: the bomb goes with her`);
    assert.equal(b[0].removeReason, 'retreat', `${how}: withdrawn with her, not knocked out`);
    assert.equal(h.b.allyUnits.filter((t) => t.kind === 'token' && t.alive).length, 0, `${how}: nothing of hers is left standing`);
    checkInvariants(h.b);
  }
});

test("a token of another unit's is not touched by an exit", REAL, () => {
  const h = makeBattle({
    flat,
    units: [{ uid: 1, chessId: SWIRE, row: 9, col: 4, skill: 2 }, { uid: 2, chessId: 'chess_char_2_02_a', row: 10, col: 5 }],
    enemies: [{ uid: 90, enemyId: 'enemy_1007_slime', row: 3, col: 4 }],
    autoFinish: false, timeLimit: 90, seed: 7,
  });
  h.run(0.5);
  const sw = h.unit(1);
  const b = bottles(h, castS2(h));
  assert.equal(b.length, 1);
  h.b.retreat(h.unit(2));
  h.step(3);
  assert.equal(b[0].alive, true, 'only its own owner takes it away');
  checkInvariants(h.b);
});

test('an exit a kill handler cancels (revive: 破财消灾, 余烬) leaves her summons alone', REAL, () => {
  // the unit never leaves the field: `kill` restores hp before `_remove` runs
  const h = herField({ setup: (b) => b.on('kill', ({ victim }) => { if (victim.defId === SWIRE && victim.side === 'ally') victim.hp = Math.max(1, victim.s.maxHp * 0.5); }) });
  h.run(0.5);
  const sw = castS2(h);
  const b = bottles(h, sw);
  assert.equal(b.length, 1);
  h.b.kill(sw, null);
  h.step(3);
  assert.equal(sw.alive, true, 'revived in place');
  assert.equal(b[0].alive, true, 'and its bomb stays');
  checkInvariants(h.b);
});

test('a summon the original game leaves standing is exempt (医疗探机)', REAL, () => {
  // content/tokens.js `KEPT_ON_OWNER_EXIT` → `deploy` hook → `Unit.keepOnOwnerExit`; `_recallSummons` skips it
  const h = herField();
  h.run(0.5);
  const sw = h.unit(1);
  const drone = h.b.spawnToken(sw, TOKEN_IDS.healDrone, 9, 6, { duration: 30 });
  assert.equal(drone.keepOnOwnerExit, true, 'the content layer stamps the exemption on deploy');
  h.b.retreat(sw, { permanent: true });
  h.step(2);
  assert.equal(drone.alive, true, 'the drone stays where it was put');
  checkInvariants(h.b);
});

test('a token her own death effect places is not swept up by the same exit', REAL, () => {
  // the cascade runs before `die` / `death` (deploy.js `_remove`), so something born there survives the exit
  let born = null;
  const h = herField({
    setup: (b) => b.on('death', ({ unit }) => {
      if (unit.defId === SWIRE && unit.side === 'ally') born = b.spawnToken(unit, TOKEN_IDS.champagne, 9, 6, { duration: 20 });
    }),
  });
  h.run(0.5);
  const sw = castS2(h);
  const b = bottles(h, sw);
  assert.equal(b.length, 1);
  h.b.kill(sw, null);
  h.step(2);
  assert.equal(b[0].alive, false, 'the one that stood before she left is withdrawn');
  assert.ok(born, 'her exit placed another one');
  assert.equal(born.alive, true, 'and it stands');
  checkInvariants(h.b);
});
