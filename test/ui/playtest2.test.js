// Regression tests (Node) of user playtest #2, UI items 6–10 + the loadout display (DESIGN §16):
//   6  the enemy preview pen belongs to the pen camera only: bandFor / boardArea / penShown of render/app.js
//   8  the detail card docks on the side away from a selected unit's underframe — for every bench / temp / board tile
//      at the official prep / Final Assault prep cameras of 10 viewports (16:9, 16:10, 21:9, 32:13.4, 4:3, 1280×720,
//      1366×768, iPad landscape, 1024×768, 1440×900) the chosen slot never overlaps the underframe
//  10 the boss round's prep camera is the own half of the boss field — solo (R9 / R15) and co-op (L / R), and a lone
//      player's boss battle frames its own half
//  §16 chessLoadout: the skill / module a chess fights with under m.private.loadout
// (browser counterparts: test/ui/playtest2.e2e.test.js, test/ui/playtest2.real.e2e.test.js)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { presetCamera, OFFICIAL_PARAMS, parseCameraParam } from '../../public/js/render/projection.js';
import { bandFor, boardArea, penShown, viewKind } from '../../public/js/render/app.js';
import { AREAS } from '../../public/js/render/board3d/layout.js';
import { underframeRect } from '../../public/js/ui/underframe.js';
import { panelSide, panelSlots, chessLoadout, prepCamera, bondPopupPlace, BPOP } from '../../public/js/ui/gameLogic.js';
import { checkButtons } from '../../public/js/ui/hud.js';
import { DATA } from '../match/harness.js';
import { skillRecordIconUrl } from '../../public/js/ui/assetUrls.js';

const maxRow = (areas) => Math.max(...areas.map((a) => a.r1));
const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('6: the enemy pen only with the pen camera', () => {
  test('prep / battle / 联防 cameras draw no pen rows and build no pen area; the pen camera does', () => {
    for (const k of ['prep', 'normal', 'unite']) {
      assert.ok(bandFor(k)[1] <= 13, `${k}: 2D rows ${bandFor(k)}`);
      // the field and its separator rows (row 13 carries devices blowing into the field, user playtest #5 item 6)
      assert.ok(maxRow(boardArea(k)) <= 13, `${k}: 3D area rows ≤ 13 (no pen rows 14–18)`);
      assert.equal(penShown(k), false, `${k}: pen figures hidden`);
    }
    for (const k of ['boss', 'hidden', 'bossPrep']) {
      assert.deepEqual(bandFor(k), [0, 13], k);
      assert.ok(maxRow(boardArea(viewKind(k))) <= 6, `${k}: boss field only`);
      assert.equal(penShown(viewKind(k)), false);
    }
    assert.deepEqual(bandFor('pen'), [6, 18]);
    assert.equal(maxRow(boardArea('pen')), 18);
    assert.equal(boardArea('pen'), AREAS.normal, 'the pen view keeps the field + pen block');
    assert.equal(penShown('pen'), true);
    // a camera flight to / from the pen shows it while it lasts
    assert.equal(penShown('prep', 'pen'), true);
    assert.equal(penShown('pen', 'prep'), true);
  });

  test('the field areas are the official ones minus the pen block', () => {
    assert.deepEqual(boardArea('normal'), AREAS.normal.filter((a) => a.r1 <= 13));
    assert.deepEqual(boardArea('unite'), AREAS.unite.filter((a) => a.r1 <= 13));
    assert.ok(boardArea('normal').some((a) => a.r0 <= 6 && a.r1 >= 12 && a.c0 === 0 && a.c1 >= 10), 'own field + bench');
  });

  test('the 🔍◀◀ back button of the pen view is the one labelled 返回战场', () => {
    const b = checkButtons({ pen: true, penAvail: true, infoOpen: false });
    assert.equal(b.left.tip, '返回战场');
    assert.equal(b.left.back, true);
  });
});

describe('8: the detail card never covers the selected unit\'s underframe', () => {
  const SIZES = [[1920, 1080], [1680, 1050], [2560, 1080], [3440, 1440], [1600, 1200], [1280, 720], [1366, 768], [1180, 820], [1024, 768], [1440, 900]];
  const remOf = (W, H) => Math.max(40, Math.min(W / 19.2, H / 10.8, 240)); // css/theme.css html font-size
  const tiles = () => {
    const out = [];
    for (let c = 0; c < 10; c++) out.push([7, c, 'bench']);
    for (let c = 4; c <= 8; c++) out.push([8, c, 'temp']);
    for (let r = 9; r <= 12; r++) for (let c = 2; c <= 10; c++) out.push([r, c, 'board']);
    return out;
  };

  test('panelSide: left unless the underframe overlaps it and the right slot is clear', () => {
    const slots = { left: { left: 230, right: 720, top: 210, bottom: 978 }, right: { left: 1340, right: 1830, top: 210, bottom: 702 } };
    assert.equal(panelSide(null, slots), 'left');
    assert.equal(panelSide({ left: 800, right: 1000, top: 400, bottom: 600 }, slots), 'left');
    assert.equal(panelSide({ left: 300, right: 600, top: 500, bottom: 760 }, slots), 'right');
    assert.equal(panelSide({ left: 300, right: 1500, top: 500, bottom: 690 }, slots), 'left', 'both covered: the default (the underframe is drawn above)');
    assert.equal(panelSide({ left: 1400, right: 1600, top: 400, bottom: 600 }, slots), 'left');
  });

  test('panelSlots follow the css (left 2.3rem / 4.9rem wide; right .9rem from the edge, above the open shop)', () => {
    const s = panelSlots({ width: 1920, height: 1080 }, 100, { shopOpen: true });
    const round = (a) => a.map((v) => Math.round(v));
    assert.deepEqual(round([s.left.left, s.left.right, s.left.top]), [230, 720, 210]);
    assert.deepEqual(round([s.right.left, s.right.right, s.right.bottom]), [1920 - 580, 1830, 1080 - 378]);
    assert.equal(panelSlots({ width: 1920, height: 1080 }, 100, { shopOpen: false }).right.bottom, 1080 - 102);
  });

  test('safe-area insets: the slots are laid out in the HUD layer (its client offset and size)', () => {
    // a notched phone in landscape: the HUD sits 47 px in from both sides and 12 px from the top (css/devices.css)
    const hud = { left: 47, top: 12, width: 844 - 94, height: 390 - 12 - 21 };
    const R = 40;
    const s = panelSlots(hud, R, { shopOpen: true });
    const z = panelSlots({ width: hud.width, height: hud.height }, R, { shopOpen: true });
    for (const k of ['left', 'right']) {
      assert.deepEqual([s[k].left, s[k].right], [z[k].left + 47, z[k].right + 47], `${k}: shifted by the left inset`);
      assert.deepEqual([s[k].top, s[k].bottom], [z[k].top + 12, z[k].bottom + 12], `${k}: shifted by the top inset`);
    }
    assert.ok(Math.abs(s.right.right - (844 - 47 - R * 0.9)) < 1e-9, 'the right slot keeps .9rem from the HUD\'s right edge');
    // an underframe just right of the left card's client edge: covered only once the inset is counted
    const uf = { left: 47 + R * 7.1, right: 47 + R * 9, top: 150, bottom: 260 };
    assert.equal(panelSide(uf, z), 'left', 'viewport frame: looks clear');
    assert.equal(panelSide(uf, s), 'right', 'HUD frame: the card would cover it');
    // bond popup candidates shift the same way
    const ufB = { left: 47 + R * 2.4, right: 47 + R * 3.4, top: 150, bottom: 260 };
    assert.equal(bondPopupPlace(ufB, { width: hud.width, height: hud.height }, R, null), 'right');
    assert.equal(bondPopupPlace(ufB, hud, R, null), 'right');
    assert.equal(bondPopupPlace({ left: R * 2.35, right: R * 2.5, top: 150, bottom: 260 }, hud, R, null), 'left', 'left of the inset-shifted popup');
  });

  test('css: only the bond discs take the pointer over the board; the underframe undoes the HUD safe-area offset', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../../public/css/screens/game.css', import.meta.url), 'utf8');
    assert.match(css, /\.gm__bonds > \*, \.gm__bonds \.bstrip \{ pointer-events: none; \}/, 'the strip box lets taps through');
    assert.match(css, /\.gm__bonds \.bslot, \.gm__bonds \.bstrip__more \{ pointer-events: auto; \}/, 'the discs stay clickable');
    assert.doesNotMatch(css, /\.gm__bonds > \* \{ pointer-events: auto; \}/);
    const dev = readFileSync(new URL('../../public/css/devices.css', import.meta.url), 'utf8');
    assert.match(dev, /\.gm__hud > \.uframe \{ margin-left: calc\(-1 \* var\(--sa-l\)\); margin-top: calc\(-1 \* var\(--sa-t\)\); \}/);
    const panels = readFileSync(new URL('../../public/css/screens/game-panels.css', import.meta.url), 'utf8');
    assert.match(panels, /\.uframe__label\s*\{[^}]*white-space:\s*nowrap\s*;/, 'shortcut labels stay on one line');
  });

  // a finger's tap near a disc: the browser's touch adjustment moved it onto the nearest element that responds to clicks
  // (the canvas's pointer listeners do not count), so with PR #149's 收起 toggle pushing the discs over the back row a tap
  // on the row-12 unit at 844×390 opened the bond popup (test/render/models.browser.test.js #4.1 touch)
  test('the field canvas is a click target of its own, so a tap on the board stays on the tile under the finger', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync(new URL('../../public/js/render/app.js', import.meta.url), 'utf8');
    assert.match(app, /\n {2}canvas\.addEventListener\('click', onTapTarget\);\n/, 'registered with the other canvas listeners');
    assert.match(app, /\n +canvas\.removeEventListener\('click', onTapTarget\);\n/, 'dropped on destroy');
    assert.match(app, /const onTapTarget = \(\) => \{\};/, 'a no-op: the press itself stays with the pointer events');
  });

  test('underframeRect covers the diamond and its buttons', () => {
    const r = underframeRect({ x: 500, y: 600, s: 100 }, 100);
    assert.ok(r.left <= 500 - 105 && r.right >= 500 + 105 && r.bottom === 600 + 105);
    assert.ok(r.top < 600 - 105, 'buttons above the diamond');
    assert.equal(underframeRect(null, 100), null);
  });

  for (const [kind, side] of [['prep', 'L'], ['bossPrep', 'L'], ['bossPrep', 'R']]) {
    test(`${kind}${kind === 'bossPrep' ? ` ${side}` : ''}: every bench / temp / board tile at 10 viewports`, () => {
      let docked = 0;
      for (const [W, H] of SIZES) {
        const rem = remOf(W, H);
        const cam = kind === 'prep'
          ? presetCamera('prep', { width: W, height: H }, { rect: { r0: 7, r1: 12, c0: 0, c1: 10 }, side: 'L' })
          : presetCamera('bossPrep', { width: W, height: H }, { side });
        for (const shopOpen of [true, false]) {
          const slots = panelSlots({ width: W, height: H }, rem, { shopOpen });
          for (const [r, c, area] of tiles()) {
            // where the view draws the tile (render/prepfield.js: FA prep rows − 7, right half mirrored)
            const p = kind === 'prep' ? cam.project(c, r, 0) : cam.project(side === 'R' ? 20 - c : c, r - 7, 0);
            assert.ok(p.x > 0 && p.x < W && p.y > 0 && p.y < H, `${W}×${H} ${area} ${r},${c} on screen`);
            const uf = underframeRect({ x: p.x, y: p.y, s: p.s }, rem);
            const chosen = panelSide(uf, slots);
            if (chosen === 'right') docked++;
            assert.equal(hit(uf, slots[chosen]), false, `${W}×${H} ${area} ${r},${c}: the ${chosen} card covers the underframe`);
          }
        }
      }
      assert.ok(docked > 0, 'some units dock the card on the right');
    });
  }
});

describe('8 / 9: the bond popup opened from the card keeps clear of the underframe (and of the card if it can)', () => {
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const rectOf = (place, W, H, R) => {
    const left = place === 'left' ? R * BPOP.left : place === 'beside' ? R * BPOP.beside
      : place === 'besideR' ? W - R * (BPOP.besideR + BPOP.width) : W - R * (BPOP.right + BPOP.width);
    return { left, right: left + R * BPOP.width, top: R * BPOP.top, bottom: H - R * BPOP.bottomGap };
  };
  test('next to the card first, then the free side, then over the card; no card → left', () => {
    const vp = { width: 1920, height: 1080 };
    assert.equal(bondPopupPlace(null, vp, 100, null), 'left');
    assert.equal(bondPopupPlace(null, vp, 100, 'left'), 'beside');
    assert.equal(bondPopupPlace(null, vp, 100, 'right'), 'besideR');
    // the playtest screenshot: a bench unit on the left, card docked right, underframe at x 560–840 — both the place
    // left of the card and the left place cover it: the popup goes over the card
    assert.equal(bondPopupPlace({ left: 560, right: 840, top: 400, bottom: 700 }, vp, 100, 'right'), 'right');
    assert.equal(bondPopupPlace({ left: 900, right: 1100, top: 400, bottom: 700 }, vp, 100, 'right'), 'left');
    assert.equal(bondPopupPlace({ left: 300, right: 500, top: 400, bottom: 700 }, vp, 100, 'right'), 'besideR');
    assert.equal(bondPopupPlace({ left: 800, right: 1000, top: 400, bottom: 700 }, vp, 100, 'left'), 'right');
    assert.equal(bondPopupPlace({ left: 0, right: 1920, top: 400, bottom: 700 }, vp, 100, 'left'), 'beside', 'all covered: the first');
  });
  test('an underframe anywhere on screen: never covered when some place is free; the card only covered as the last resort', () => {
    for (const [W, H] of [[1920, 1080], [1280, 720], [2560, 1080], [1600, 1200], [1180, 820]]) {
      const R = Math.max(40, Math.min(W / 19.2, H / 10.8, 240));
      const slots = panelSlots({ width: W, height: H }, R, { shopOpen: true });
      for (const card of ['left', 'right', null]) {
        const all = card === 'left' ? ['beside', 'right', 'left'] : card === 'right' ? ['besideR', 'left', 'right'] : ['left', 'right'];
        for (let x = 0; x < W; x += 40) {
          const uf = { left: x, right: x + R * 2.2, top: H * 0.4, bottom: H * 0.6 };
          const place = bondPopupPlace(uf, { width: W, height: H }, R, card);
          const free = all.filter((p) => !hit(uf, rectOf(p, W, H, R)));
          if (free.length) assert.equal(place, free[0], `${W}×${H} card ${card} uf@${x}`);
          else assert.equal(place, all[0]);
          if (card && hit(rectOf(place, W, H, R), slots[card])) assert.equal(place, card, 'over the card only as the last resort');
        }
      }
    }
  });
});

describe('10: the boss round prep shows the own half of the boss field', () => {
  const pl = (playerId, seat, alive = true) => ({ playerId, seat, alive });
  test('solo 标准 R9 / 险境 R15 and co-op pairs (L / R); eliminated players keep the normal board', () => {
    assert.deepEqual(prepCamera({ round: 9, bossRound: 9, hiddenRound: null, players: [pl('me', 0)] }, 'me'), { kind: 'bossPrep', opts: { side: 'L' } });
    assert.deepEqual(prepCamera({ round: 15, bossRound: 14, hiddenRound: 15, players: [pl('me', 0)] }, 'me'), { kind: 'bossPrep', opts: { side: 'L' } });
    const coop = { round: 14, bossRound: 14, hiddenRound: 15, players: [pl('a', 0), pl('b', 1), pl('c', 2), pl('d', 3, false)] };
    assert.equal(prepCamera(coop, 'a').opts.side, 'L');
    assert.equal(prepCamera(coop, 'b').opts.side, 'R');
    assert.equal(prepCamera(coop, 'c').opts.side, 'L', 'the odd player alone on the second field');
    assert.equal(prepCamera(coop, 'd').kind, 'prep');
    assert.equal(prepCamera({ ...coop, round: 13 }, 'a').kind, 'prep');
  });

  test('the boss prep camera is the official left / right boss prep camera and shows rows 0–5 of its half', () => {
    for (const side of ['L', 'R']) {
      const cam = presetCamera('bossPrep', { width: 1920, height: 1080 }, { side });
      const key = side === 'R' ? 'right_boss_shop_camera_param' : 'left_boss_shop_camera_param';
      const p = parseCameraParam(OFFICIAL_PARAMS[key]);
      assert.ok(Math.abs(cam.tx - (p[0] + 10)) < 1e-6, `${side}: official x`);
      for (const [r, c] of [[2, 2], [2, 10], [5, 10], [0, 0], [1, 4]]) {
        const q = cam.project(side === 'R' ? 20 - c : c, r, 0);
        assert.ok(q.x > 0 && q.x < 1920 && q.y > 0 && q.y < 1080, `${side}: boss tile ${r},${c} on screen`);
      }
    }
  });

  test('a lone player\'s boss battle can be framed on its half (the ‹ › half cameras)', () => {
    const half = presetCamera('boss', { width: 1920, height: 1080 }, { rect: { r0: 0, r1: 5, c0: 0, c1: 20 }, side: 'L', half: true });
    const all = presetCamera('boss', { width: 1920, height: 1080 }, { rect: { r0: 0, r1: 5, c0: 0, c1: 20 }, side: 'L' });
    assert.ok(half.tx < all.tx, 'the left half camera looks left of 全景');
    for (const [r, c] of [[2, 2], [2, 10], [5, 10]]) {
      const q = half.project(c, r, 0);
      assert.ok(q.x > 0 && q.x < 1920 && q.y > 0 && q.y < 1080, `left half: ${r},${c} on screen (gates / objective)`);
    }
  });
});

describe('§16: chessLoadout (m.private.loadout → skill / module shown)', () => {
  const sk = (index, isDefault = false) => ({ index, skillId: `sk_${index}`, iconId: `sk_${index}`, name: `技能${index}`, isDefault });
  const base = { chessId: 'c_a', baseId: 'c_a', goldenId: 'c_b', isGolden: false, visible: true, skill: sk(2, true), skills: [sk(0), sk(1), sk(2, true)] };
  const gold = { chessId: 'c_b', baseId: 'c_a', isGolden: true, visible: true, skill: sk(2, true), skills: [sk(0), sk(1), sk(2, true)],
    module: { id: 'uniequip_x', name: '模组X', type: 'XYZ-X', active: true },
    modules: [{ uniEquipId: 'uniequip_x', name: '模组X', typeName: 'XYZ-X', isDefault: true }, { uniEquipId: 'uniequip_y', name: '模组Y', typeName: 'XYZ-Y' }] };
  const get = (id) => ({ c_a: base, c_b: gold }[id] || null);

  test('defaults without a loadout', () => {
    const r = chessLoadout(base, null, get);
    assert.equal(r.skill.index, 2);
    assert.equal(r.defaultSkill, true);
    assert.equal(r.module, null, 'normal chess have no module');
    assert.equal(r.changed, false);
    const g = chessLoadout(gold, {}, get);
    assert.equal(g.module.id, 'uniequip_x');
    assert.equal(g.defaultModule, true);
  });

  test('a chosen skill / module / 不装备 (keyed by the base chess id, for the elite too)', () => {
    const lo = { c_a: { skill: 0, module: 'none' } };
    const r = chessLoadout(base, lo, get);
    assert.equal(r.skill.skillId, 'sk_0');
    assert.equal(r.defaultSkill, false);
    assert.equal(r.changed, true);
    const g = chessLoadout(gold, lo, get);
    assert.equal(g.skill.skillId, 'sk_0');
    assert.equal(g.module.none, true);
    assert.equal(g.module.name, '未装备模组');
    assert.equal(g.defaultModule, false);
    const y = chessLoadout(gold, { c_a: { skill: 2, module: 'uniequip_y' } }, get);
    assert.deepEqual([y.module.id, y.module.name, y.module.typeName, y.defaultSkill], ['uniequip_y', '模组Y', 'XYZ-Y', true]);
  });

  test('illegal choices fall back to the defaults; data without skills[] keeps the default skill', () => {
    assert.equal(chessLoadout(base, { c_a: { skill: 7 } }, get).skill.index, 2);
    assert.equal(chessLoadout(gold, { c_a: { skill: 1, module: 'nope' } }, get).module.id, 'uniequip_x');
    const old = { chessId: 'o_a', baseId: 'o_a', isGolden: false, visible: true, skill: sk(1, true) };
    const r = chessLoadout(old, { o_a: { skill: 0 } }, (id) => (id === 'o_a' ? old : null));
    assert.equal(r.skill.index, 1);
    assert.equal(chessLoadout(null, null), null);
  });

  test('a chosen skill without an icon in the manifest: null with { empty: false } (the card draws S1–S3)', () => {
    const m = { skills: { sk_a: '/assets/skill/sk_a.png' }, skillsById: {}, ui: {} };
    assert.equal(skillRecordIconUrl(m, { skillId: 'sk_a', iconId: 'sk_a' }, { empty: false }), '/assets/skill/sk_a.png');
    assert.equal(skillRecordIconUrl(m, { skillId: 'sk_b', iconId: 'sk_b' }, { empty: false }), null);
    assert.notEqual(skillRecordIconUrl(m, { skillId: 'sk_b' }), '/assets/skill/sk_a.png', 'default: the empty sprite (or null without one)');
  });

  test('real data: every visible chess resolves a skill (with or without skills[])', () => {
    const get2 = (id) => DATA.chess[id] || null;
    for (const c of Object.values(DATA.chess)) {
      if (!c.visible) continue;
      const r = chessLoadout(c, null, get2);
      if (c.skill) assert.ok(r.skill && r.skill.name, `${c.chessId}: default skill`);
      assert.equal(r.defaultSkill, true, `${c.chessId}: no loadout = default`);
    }
  });

  test('integration: the detail card record = what the battle fights with (stats / 特性 / talents of the chosen module or 不装备)', async () => {
    const { getDefaultSource } = await import('../../server/sim/simdata.js');
    const ds = getDefaultSource();
    const get2 = (id) => DATA.chess[id] || null;
    // 野鬃 elite on 不装备: base ATK / ASPD and the no-module trait (the default module: ATK +40, ASPD +3, "获得2点")
    const g = DATA.chess.chess_char_1_19_b;
    const none = chessLoadout(g, { chess_char_1_19_a: { skill: 0, module: 'none' } }, get2);
    assert.equal(none.record.stats.atk, g.statsBase.atk);
    assert.equal(none.record.stats.aspd, g.statsBase.aspd);
    assert.notEqual(none.record.stats.atk, g.stats.atk, 'differs from the default-module card');
    assert.match(none.record.trait.desc, /获得1点部署费用/);
    assert.equal(chessLoadout(g, null, get2).record, g, 'default loadout: the data record itself');
    // every elite × every module choice: the card's record equals the sim's unit def (stats, trait, talents)
    let n = 0;
    for (const c of Object.values(DATA.chess)) {
      if (!c.visible || !c.isGolden || !Array.isArray(c.modules)) continue;
      for (const moduleId of ['none', ...c.modules.map((x) => x.uniEquipId)]) {
        const lo = { [c.baseId]: { module: moduleId } };
        const rec = chessLoadout(c, lo, get2).record;
        const def = ds.getChess(c.chessId, { moduleId });
        for (const k of ['maxHp', 'atk', 'def', 'res', 'aspd', 'cost', 'blockCnt', 'respawnTime']) {
          if (rec.stats[k] != null && def.raw.stats[k] != null) assert.equal(rec.stats[k], def.raw.stats[k], `${c.chessId} ${moduleId} ${k}`);
        }
        assert.equal(rec.trait?.desc ?? null, def.raw.trait?.desc ?? null, `${c.chessId} ${moduleId} trait`);
        assert.deepEqual((rec.talents || []).map((t) => t.name), (def.raw.talents || []).map((t) => t.name), `${c.chessId} ${moduleId} talents`);
        n++;
      }
    }
    assert.ok(n > 100, `${n} elite × module choices`);
  });

  test('integration: the card / wheel range = the battle unit\'s range (an equipped "攻击范围扩大" module grid)', async () => {
    const { makeBattle } = await import('../helpers/battleHarness.js');
    const { attackRangeGrid } = await import('../../shared/loadoutRecord.js');
    const { previewGrid } = await import('../../public/js/ui/facing.js');
    const get2 = (id) => DATA.chess[id] || null;
    const key = (g) => g.map(([r, c]) => `${r},${c}`).sort().join(' ');
    let changed = 0;
    for (const c of Object.values(DATA.chess)) {
      if (!c.visible || !c.isGolden || !Array.isArray(c.modules)) continue;
      for (const moduleId of ['none', ...c.modules.map((x) => x.uniEquipId)]) {
        const lo = { [c.baseId]: { module: moduleId } };
        const rec = chessLoadout(c, lo, get2).record;
        const g = attackRangeGrid(rec);
        if (key(g) === key(c.rangeGrid) && moduleId === 'none') continue;
        const h = makeBattle({ units: [{ chessId: c.chessId, row: 10, col: 3, moduleId }], enemies: [], autoFinish: false, timeLimit: 5 });
        h.step();
        const u = h.unit(c.chessId);
        // the range it starts with: its grid + a module's permanent 攻击距离 (信仰搅拌机 SPT-Y; community report E1 review)
        assert.equal(key(g), key(u.liveRangeGrid), `${c.chessId} ${moduleId}: card range = battle range`);
        const wheel = previewGrid({ getChess: get2, chessRecord: (r) => chessLoadout(r, lo, get2).record }, { kind: 'chess', id: c.chessId });
        assert.equal(key(wheel), key(u.liveRangeGrid), `${c.chessId} ${moduleId}: wheel preview = battle range`);
        if (key(g) !== key(c.rangeGrid)) changed++;
      }
    }
    assert.ok(changed >= 4, `${changed} module choices change the range (莫斯提马 SPC-X, 莱恩哈特 / 白面鸮 / 夕 defaults)`);
  });
});
