// The operator model facing on the real event path (DESIGN §37.329; PR #730 by @Seals-awa, ported to the rules the
// maintainer fixed on 2026-10-21 / 10-23): UnitView.windUp (the look-ahead's accepted wind-up) and UnitView.onAttack
// (a strike no wind-up started) turn the model toward that attack's target; nothing else turns it — not the end of the
// attack, not the target's death, not a long idle. Area attacks and a stunned model do not turn; the Front ⇄ Back swap
// of a turn up / down lands in the middle of the 0.15 s turn and the attack goes on on the new model; the skill model
// rule of #786 reads the turned facing; the official face modes (none / Default / FirstCastTarget) apply.
// Scaffolding as test/render/skill-front-face.test.js: fake PIXI, the real manifest and asset helpers.
//
//   node --test test/render/facing-events.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { spineEntry, hasBackSpine } from '../../public/js/assets.js';
import { UF } from '../../shared/constants.js';
import { markAreaAttacks } from '../../public/js/render/facing.js';
import { SnapshotBuffer } from '../../public/js/render/interp.js';
import { attackRateEvents } from '../../public/js/render/attackRate.js';
import { createWindUpLookahead } from '../../public/js/render/app/windup.js';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const M = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
const TEXAS = 'char_102_texas';        // no face-mode rows (Target); S2 剑雨 has no Back skill clip (#786)
const WILDMANE = 'char_496_wildmn';    // 野鬃: Attack Target, S2 `Skill_2` Default
const IFRIT = 'char_134_ifrit';        // 伊芙利特: Attack none
const FLAMETAIL = 'char_420_flamtl';   // 焰尾: Attack / skill rows FirstCastTarget

let fake, UnitView;
before(async () => {
  fake = installFakePixi();
  ({ UnitView } = await import('../../public/js/render/units.js'));
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { await tick(); await tick(); };
const cam = () => presetCamera('normal', { width: 1280, height: 720 });
let clockT = 0;
/** n frames of 1/60 s (the fake context's animRate is 1: game time = real time). */
const frames = (v, n) => { for (let i = 0; i < n; i++) { clockT += 1 / 60; v.update(1 / 60, cam(), clockT); } };

function store() {
  return {
    picture: () => null,
    image: async () => null,
    hasBack: (id, skin) => hasBackSpine(M, id, skin),
    spineEntry: (id, o) => spineEntry(M, id, o),
    spine: { acquire: async (e) => ({ animations: Object.keys(e.animations || {}).map((name) => ({ name })) }), release() {} },
  };
}

async function op(id, dir, extra = {}) {
  const v = new UnitView(fakeViewCtx(fake.P, { assets: store(), cam }), { id: 5, side: 'ally', kind: 'op', defId: id, spine: id, tier: 1, x: 5, y: 5, maxHp: 1000, dir, ...extra });
  await settle();
  frames(v, 5);
  assert.ok(v.actor, 'model built');
  return v;
}
const at = (x, y) => ({ x, y, alive: true });
const front = (id) => M.chars[id].spine.front;
const back = (id) => M.chars[id].spine.back;
function cast(v, on) {
  if (on) v.flags |= UF.SKILL; else v.flags &= ~UF.SKILL;
  v.setSkill(on);
}

describe('when the model turns', () => {
  test('the accepted wind-up turns it toward that attack\'s target in 0.15 s; dir stays the deploy direction', async () => {
    const v = await op(TEXAS, 'RIGHT');
    assert.equal(v.windUp(2, 'none', null, 1, at(2, 5)), false, 'a wind-up still too early is no attack start');
    assert.equal(v.face.turning, false, 'and turns nothing');
    assert.equal(v.windUp(0.2, 'none', null, 1, at(2, 5)), true);
    assert.equal(v.face.turning, true);
    assert.equal(v.visFacing, 1, 'the turn starts from the deploy facing');
    frames(v, 10);                       // 0.167 s
    assert.equal(v.visFacing, -1, 'facing the target on the left');
    assert.equal(v.modelFlip(), -1);
    assert.equal(v.dir, 'RIGHT', 'display only');
    assert.equal(v.facing, 1);
  });

  test('a new attack on another target turns it again', async () => {
    const v = await op(TEXAS, 'RIGHT');
    v.onAttack(at(2, 5), 1, 'none');
    frames(v, 10);
    assert.equal(v.visFacing, -1);
    v.onAttack(at(8, 5), 3, 'none');
    frames(v, 10);
    assert.equal(v.visFacing, 1, 'the next attack\'s target on the right');
  });

  test('the end of the attack, the target\'s death and a long idle keep the facing (no turn back)', async () => {
    const v = await op(TEXAS, 'RIGHT');
    const enemy = at(2, 5);
    assert.equal(v.windUp(0.2, 'none', null, 1, enemy), true);
    frames(v, 12);
    v.onAttack(enemy, 0.2, 'none', true);
    frames(v, 90);                       // the attack clip is over
    assert.notEqual(v.actor.mode, 'attack');
    assert.equal(v.visFacing, -1, 'action end: held');
    enemy.alive = false;                 // the target died / left
    frames(v, 60);
    assert.equal(v.visFacing, -1, 'target gone: held');
    frames(v, 600);                      // ten seconds without an attack [ASSUMED: held]
    assert.equal(v.visFacing, -1, 'long idle: held');
    assert.equal(v.face.view, 'LEFT');
  });

  test('a strike no wind-up started turns at the strike; a wound-up strike does not turn again', async () => {
    const v = await op(TEXAS, 'RIGHT');
    v.onAttack(at(2, 5), 1, 'none', false);
    assert.equal(v.face.turning, true, 'a late batch: the clip starts at its strike frame, and so does the turn');
    frames(v, 12);
    assert.equal(v.windUp(0.2, 'none', null, 1, at(2, 6)), true);
    frames(v, 12);
    v.onAttack(at(9, 5), 1.2, 'none', true);
    assert.equal(v.face.turning, false, 'wound up: its facing was decided at the wind-up');
    assert.equal(v.visFacing, -1);
  });

  test('area attacks do not turn, through the look-ahead or a late strike', async () => {
    const v = await op(TEXAS, 'RIGHT');
    assert.equal(v.windUp(0.2, 'none', null, 1, at(2, 5), true), true);
    assert.equal(v.face.turning, false);
    frames(v, 60);
    v.onAttack(at(2, 5), 2, 'none', false, true);
    assert.equal(v.face.turning, false);
    assert.equal(v.visFacing, 1);
  });

  test('a stunned, frozen or sleeping model does not turn', async () => {
    for (const flag of [UF.STUNNED, UF.FROZEN, UF.SLEEP]) {
      const v = await op(TEXAS, 'RIGHT');
      v.flags |= flag;
      v.onAttack(at(2, 5), 1, 'none');
      assert.equal(v.face.turning, false, String(flag));
      assert.equal(v.visFacing, 1);
    }
  });

  test('the effects of the turn\'s first frame place by the side it turns to (cast effects, a late strike\'s shot)', async () => {
    // render/app/windup.js calls castStart right after the accepted windUp, render/app.js the attack's effects right
    // after onAttack: the drawn mirror flips only edge-on, half a turn later (the review of round 84)
    const pose = (v) => FxWiring.prototype.pose.call({ _camTilt: () => undefined }, v);
    const v = await op(TEXAS, 'RIGHT');
    assert.equal(v.windUp(0.2, 'none', null, 1, at(2, 5)), true);
    assert.equal(v.visFacing, 1, 'drawn: still the deploy side');
    assert.equal(v.settledFacing, -1, 'the side the turn goes to');
    assert.equal(pose(v).left, true, 'FxWiring.pose: the cast effects spawn on the left');
    assert.equal(v.modelFlip(true), -1, 'boneOffset\'s mirror (bone-followed points, the strike-frame muzzle)');
    assert.equal(v.modelFlip(), 1, 'the drawn model\'s');
    frames(v, 12);
    assert.equal(pose(v).left, true);
    assert.equal(v.visFacing, v.settledFacing, 'once the turn is over the two agree');
    const w = await op(TEXAS, 'RIGHT');
    w.onAttack(at(2, 5), 1, 'none', false);
    assert.equal(w.visFacing, 1);
    assert.equal(pose(w).left, true, 'a late strike: its shot leaves from the left side');
    const e = await op(TEXAS, 'LEFT');
    assert.equal(pose(e).left, true, 'no turn: the facing as drawn');
    assert.equal(e.settledFacing, e.visFacing);
  });

  test('a redeploy and a re-orientation settle on the deploy direction', async () => {
    const v = await op(TEXAS, 'RIGHT');
    v.onAttack(at(2, 5), 1, 'none');
    frames(v, 12);
    assert.equal(v.visFacing, -1);
    v.onDeploy();
    assert.equal(v.visFacing, 1, 'redeployed: its own direction');
    v.onAttack(at(2, 5), 3, 'none');
    frames(v, 12);
    v.setDir('DOWN');
    assert.equal(v.visFacing, 1);
    assert.equal(v.face.deployDir, 'DOWN');
  });
});

describe('the skeleton', () => {
  test('a target above swaps to the Back model in the middle of the turn, and the attack goes on on it', async () => {
    const v = await op(TEXAS, 'RIGHT');
    assert.equal(v.actor.entry, front(TEXAS));
    assert.equal(v.windUp(0.3, 'none', null, 1, at(5.6, 8)), true);
    assert.equal(v._wantsBack(), false, 'still the Front model as the turn starts');
    frames(v, 4);                        // 0.067 s: before the middle
    await settle();
    assert.equal(v.actor.entry, front(TEXAS));
    frames(v, 2);                        // past 0.075 s: the swap is asked for
    assert.equal(v._wantsBack(), true);
    await settle();
    assert.equal(v.actor.entry, back(TEXAS), 'the Back model took over');
    assert.equal(v.actor.mode, 'attack', 'and goes on with the wind-up (asynchronous swap, the review of 2026-10-19)');
    assert.equal(v.actor.current, 'Attack_Loop');
    assert.equal(v.swapT, 1, 'in place, no fallback diamond');
  });

  test('a strike-frame attack resumes from its strike; a finished attack is not replayed on a later swap', async () => {
    const v = await op(TEXAS, 'RIGHT');
    v.onAttack(at(5.6, 8), 1, 'none');
    frames(v, 6);
    await settle();
    assert.equal(v.actor.entry, back(TEXAS));
    assert.equal(v.actor.mode, 'attack', 'the strike goes on on the Back model');
    frames(v, 120);
    assert.equal(v._pendingAttack, null, 'the clip is over');
    v.onAttack(at(5, 2), 4, 'none', false, true);   // an area attack: no turn …
    v.face.toDeploy();                               // … a Default skill's turn back instead (Front for RIGHT)
    frames(v, 6);
    await settle();
    assert.equal(v.actor.entry, front(TEXAS));
  });

  test('deployed UP: a horizontal target keeps the Back model, a target below brings the Front one', async () => {
    const v = await op(TEXAS, 'UP');
    assert.equal(v.actor.entry, back(TEXAS));
    v.onAttack(at(2, 5), 1, 'none');
    frames(v, 12);
    await settle();
    assert.equal(v.actor.entry, back(TEXAS), 'mirror only');
    assert.equal(v.visFacing, -1);
    v.onAttack(at(4.4, 2), 3, 'none');
    frames(v, 12);
    await settle();
    assert.equal(v.actor.entry, front(TEXAS), 'below: the Front model');
  });

  test('#786: turned up, a skill the Back model cannot show plays on the Front model', async () => {
    const v = await op(TEXAS, 'RIGHT', { skillIndex: 1 });
    v.onAttack(at(5.6, 8), 1, 'none');
    frames(v, 12);
    await settle();
    assert.equal(v.actor.entry, back(TEXAS), 'turned up: Back');
    cast(v, true);
    assert.equal(v._skillFacesFront(), true, 'the turned facing counts as facing up');
    frames(v, 1);
    await settle();
    assert.equal(v.actor.entry, front(TEXAS), '剑雨 on the Front model');
    assert.equal(v.actor.current, 'Skill');
    cast(v, false);
    frames(v, 160);
    await settle();
    assert.equal(v.actor.entry, back(TEXAS), 'and the turned Back model after the clip');
  });
});

describe('the official face modes', () => {
  test('none: 伊芙利特\'s attack never turns her', async () => {
    const v = await op(IFRIT, 'RIGHT');
    v.onAttack(at(2, 5), 1, 'none');
    assert.equal(v.face.turning, false);
    assert.equal(v.visFacing, 1);
  });

  test('Default: 野鬃 turns for her attacks, and her S2\'s first attack goes back to the deployed facing', async () => {
    const v = await op(WILDMANE, 'RIGHT', { skillIndex: 1 });
    v.onAttack(at(2, 5), 1, 'none');
    frames(v, 12);
    assert.equal(v.visFacing, -1, 'Attack: Target');
    cast(v, true);
    frames(v, 30);
    assert.equal(v.visFacing, -1, 'the skill start itself turns nothing [ASSUMED: the turn waits for an attack]');
    v.onAttack(at(2, 5), 2, 'none');
    frames(v, 12);
    assert.equal(v.visFacing, 1, 'S2 (Skill_2 Default): the deployed facing');
    v.onAttack(at(2, 5), 3, 'none');
    frames(v, 12);
    assert.equal(v.visFacing, 1, 'and it stays there through the skill');
  });

  test('FirstCastTarget: while 焰尾\'s skill runs she keeps facing its first target; her normal attacks turn each time', async () => {
    const v = await op(FLAMETAIL, 'RIGHT', { skillIndex: 2 });
    const first = at(2, 5), second = at(9, 5);
    cast(v, true);
    v.onAttack(first, 1, 'none');
    frames(v, 12);
    assert.equal(v.visFacing, -1, 'the skill\'s first attack: its target');
    v.onAttack(second, 2, 'none');
    frames(v, 12);
    assert.equal(v.visFacing, -1, 'a later attack still faces the first target');
    cast(v, false);
    v.onAttack(second, 4, 'none');
    frames(v, 12);
    assert.equal(v.visFacing, 1, 'outside the skill every attack is its own cast');
  });

  test('a first attack that did not turn still counts as the skill\'s first cast', async () => {
    const v = await op(FLAMETAIL, 'RIGHT', { skillIndex: 2 });
    cast(v, true);
    v.onAttack(at(2, 5), 1, 'none', false, true);   // area: no turn
    assert.equal(v._castSeen, true);
    assert.equal(v._castTarget, null, 'no target was taken by it');
    v.onAttack(at(2, 5), 2, 'none');
    frames(v, 12);
    assert.equal(v.visFacing, -1, 'the next attack takes its own target');
  });
});

describe('the look-ahead and the batch', () => {
  test('an area batch is marked once at ingestion; the look-ahead hands the mark to windUp', async () => {
    const a1 = ['atk', 1, 2, 'none'], a2 = ['atk', 1, 3, 'none'], s = ['atk', 4, 2, 'none'];
    const areaAtk = new WeakSet();
    markAreaAttacks([a1, a2, s], areaAtk);
    const calls = [];
    const view = (id) => ({ windUp(lead, kind, slot, interval, target, area) { calls.push({ id, area }); return true; } });
    const views = new Map([[1, view(1)], [4, view(4)], [2, { x: 1, y: 1 }], [3, { x: 2, y: 2 }]]);
    const la = createWindUpLookahead({ views, woundUp: new WeakSet(), areaAtk, castStart() {} });
    la.run({ forEachUpcoming(a, b, fn) { for (const e of [a1, a2, s]) fn(e, 1); } }, 0.8);
    assert.deepEqual(calls, [{ id: 1, area: true }, { id: 1, area: true }, { id: 4, area: false }]);
  });

  test('a fast single-target attacker over two adjacent batches: neither attack is an area one, both turn', async () => {
    // the real ingestion (render/app.js pushEvents: markAreaAttacks, then interp.pushEvents) into a real SnapshotBuffer,
    // the real look-ahead and UnitView; the PR grouped by the 1.5 s look-ahead window and took these for an area attack
    const v = await op(TEXAS, 'RIGHT');
    const left = { id: 21, ...at(2, 5) }, right = { id: 22, ...at(8, 5) };
    const views = new Map([[5, v], [21, left], [22, right]]);
    const interp = new SnapshotBuffer({ delay: 0.1, rate: 2 });
    const woundUp = new WeakSet(), areaAtk = new WeakSet();
    const ingest = (list, gt) => { markAreaAttacks(list, areaAtk); interp.pushEvents(attackRateEvents(list), 0, gt); };
    const a1 = ['atk', 5, 21, 'none'], a2 = ['atk', 5, 22, 'none'];
    // two server batches 3 ticks apart (server/match/fields.js SNAP_EVERY), each with the attacker's rate (#729)
    ingest([['rate', 5, 0.1], a1], 1.0);
    ingest([['rate', 5, 0.1], a2], 1.1);
    const both = [['atk', 5, 21, 'none'], ['atk', 5, 22, 'none']];
    ingest(both, 2.5);                    // and one batch that does hit two targets
    const casts = [];
    const la = createWindUpLookahead({ views, woundUp, areaAtk, castStart: (cv) => casts.push(cv.settledFacing) });
    const seen = [];
    for (let renderT = 0.6; renderT < 3; renderT += 1 / 60) {
      la.run(interp, renderT);
      for (const e of interp.takeEvents(renderT)) {
        if (e[0] !== 'atk') continue;
        v.onAttack(views.get(e[2]), renderT, e[3], woundUp.has(e), areaAtk.has(e));
        seen.push({ tgt: e[2], wound: woundUp.has(e), area: areaAtk.has(e), face: v.settledFacing });
      }
      frames(v, 1);
    }
    assert.equal(areaAtk.has(a1) || areaAtk.has(a2), false, 'one target per batch: single-target attacks');
    assert.ok(areaAtk.has(both[0]) && areaAtk.has(both[1]), 'two targets in one batch: an area attack');
    assert.deepEqual(seen.slice(0, 2).map((x) => [x.tgt, x.area, x.face]), [[21, false, -1], [22, false, 1]],
      'the first attack turned left, the next one right');
    assert.ok(seen[0].wound, 'the first one through its wind-up');
    assert.deepEqual(seen.slice(2).map((x) => [x.area, x.face]), [[true, 1], [true, 1]], 'the area batch turns nothing');
    assert.equal(casts[0], -1, 'its cast effects on the side it turned to');
  });

  test('render/app.js marks every batch and hands the marks to onAttack', () => {
    const src = readFileSync(path.join(ROOT, 'public/js/render/app.js'), 'utf8');
    assert.match(src, /markAreaAttacks\(list, areaAtk\);\s*return interp\.pushEvents\(/);
    assert.match(src, /src\.onAttack\?\.\(tgt, now, e\[3\], woundUp\.has\(e\), areaAtk\.has\(e\)\)/);
    assert.match(src, /createWindUpLookahead\(\{ views, woundUp, areaAtk,/);
  });
});
