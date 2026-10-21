// Regression tests (Node) of user playtest #3, HUD / UI items:
//   2  the own LP's pending loss is marked live while the own battle's enemies enter the blue gate — pendingLoss / liveLp (the settle
//      rule min(lpCapPerRound, counted leaks), reset when the settled m.private lands, 联防中 during 联防), the team
//      panel rows (rowLp: own live value, teammates' m.public players[].pendingLp), the LP tower's −N tick, and the
//      server's pendingLp (server/match/match/views.js _pendingLpView)
//   3  the temp overflow row (临时整备区): the ready button's visible reason, the row's frame geometry (tempRowFrame)
//   8  the operator's own effect (特质 / garrison) right under the detail card's header (CHESS_SECTIONS, rendered order)
//   9  no spinning busy indicators next to texts: no wait / progress cursors, the button's busy bar instead of a
//      spinning ring, the 机变 card's 选择中 strip (never stuck), a still hourglass; the data store retries a transient
//      failure and every data file the match UI reads is one the match screen waits for (GAME_FILES); the 特质 chip's
//      icon is the garrison's official type icon (the spoked 特异化 glyph only on 特异化 特质, not on every 休整期 one)
// (browser counterparts: the scratch checks of the playtest-3 workstream; the E2E suites cover the flows)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE, GEO } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// the browser data store reads the real data files from disk (ChessDetail / ChoiceOverlay renders below)
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { pendingLoss, liveLp, ownLeaks, pendingTip, tempInfo, tempReadyReason, ReadyToggle, TEMP_RULE } = await import('../../public/js/ui/hud.js');
const { rowLp } = await import('../../public/js/ui/teamPanel.js');
const { LpTower, GAME_FILES } = await import('../../public/js/ui/gameComponents.js');
const { tempRowFrame, tempRowRule } = await import('../../public/js/ui/underframe.js');
const { ChessDetail, CHESS_SECTIONS, garrisonTypeIconKey } = await import('../../public/js/ui/detailPanel.js');
const { ChoiceView, pickBusy } = await import('../../public/js/ui/choiceOverlay.js');
const { Button, Spinner } = await import('../../public/js/ui/components.js');
const { data, createDataStore, RETRY_DELAYS_MS } = await import('../../public/js/data.js');

/** Every vnode of a preact tree (htm output), depth first. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
/** The text of a vnode tree in document order. */
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  return typeof v === 'object' ? textOf(v.props?.children) : '';
};
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

// ---- 2: live LP ----------------------------------------------------------------------------------------------------

describe("2: the own LP's pending loss is marked live while the battle runs", () => {
  test('pendingLoss is the settle rule: min(lpCapPerRound, counted leaks), never negative', () => {
    assert.equal(pendingLoss(0), 0);
    assert.equal(pendingLoss(3), 3);
    assert.equal(pendingLoss(10), 10);
    assert.equal(pendingLoss(14), 10, 'capped (config lpCapPerRound 10)');
    assert.equal(pendingLoss(14, 12), 12, 'the configured cap');
    for (const junk of [-3, NaN, null, undefined, 'x']) assert.equal(pendingLoss(junk), 0, String(junk));
    const cfg = JSON.parse(read('data/config.json'));
    assert.equal(cfg.lpCapPerRound, 10, 'the cap the client reads (gd.config.lpCapPerRound)');
  });

  test('the own count: the further of the local runner\'s and the server\'s (a display replica stands still while the player watches a teammate)', () => {
    assert.equal(ownLeaks(3, 1), 3, 'the local battle is ahead of the ~1 Hz b.progress');
    assert.equal(ownLeaks(2, 5), 5, 'a display replica paused while watching another field: the server moved on');
    assert.equal(ownLeaks(undefined, 4), 4, 'no local entry (reconnect, still loading)');
    assert.equal(ownLeaks(4, undefined), 4);
    for (const [a, b] of [[undefined, undefined], [NaN, null], [-2, 'x']]) assert.equal(ownLeaks(a, b), 0);
    // the game screen feeds liveLp with it
    assert.match(read('public/js/screens/game.js'), /leaks: ownLeaks\(localLeaks, meP\?\.pendingLp\)/);
  });

  /** Feed liveLp a sequence of states, keeping its base like the game screen (lpBaseRef). */
  const run = (steps) => {
    let base = null;
    return steps.map((s) => { const r = liveLp(base, s); base = r.base; return r; });
  };

  test('COMBAT: lp − pending as leaks come in; the settled m.private (sent before the SETTLE m.public) drops the pending part — never subtracted twice', () => {
    const at = (o) => ({ phase: PHASE.COMBAT, round: 5, lp: 30, statsLeaks: 7, leaks: 0, cap: 10, ...o });
    const out = run([
      at({}),
      at({ leaks: 1 }),
      at({ leaks: 3 }),
      // the settlement: m.private (lp 27, stats.leaks 10) lands while m.public still says COMBAT (Match.flush order)
      at({ leaks: 3, lp: 27, statsLeaks: 10 }),
      // then the SETTLE m.public
      { phase: PHASE.SETTLE, round: 5, lp: 27, statsLeaks: 10, leaks: 3, cap: 10 },
      // the next round
      { phase: PHASE.PREP, round: 6, lp: 27, statsLeaks: 10, leaks: 0, cap: 10 },
      { phase: PHASE.COMBAT, round: 6, lp: 27, statsLeaks: 10, leaks: 0, cap: 10 },
      { phase: PHASE.COMBAT, round: 6, lp: 27, statsLeaks: 10, leaks: 2, cap: 10 },
    ]);
    assert.deepEqual(out.map((r) => r.shown), [30, 29, 27, 27, 27, 27, 27, 25]);
    assert.deepEqual(out.map((r) => r.pending), [0, 1, 3, 0, 0, 0, 0, 2]);
    assert.ok(out.every((r) => r.unite === false));
  });

  test('a settlement that charged nothing (a 联防 saved everything) is seen through stats.leaks; the SETTLE phase alone drops it too', () => {
    const at = (o) => ({ phase: PHASE.UNITE, round: 8, lp: 20, statsLeaks: 4, leaks: 5, cap: 10, ...o });
    const out = run([
      { phase: PHASE.COMBAT, round: 8, lp: 20, statsLeaks: 4, leaks: 5, cap: 10 },
      at({}),
      at({ statsLeaks: 9 }), // settled: lp unchanged (0 lost), the counted leaks recorded
      { phase: PHASE.SETTLE, round: 8, lp: 20, statsLeaks: 9, leaks: 5, cap: 10 },
    ]);
    assert.deepEqual(out.map((r) => r.shown), [15, 15, 20, 20]);
    assert.deepEqual(out.map((r) => r.unite), [false, true, false, false], '联防中 while the 联防 may still save part of it');
    // without stats (older view): the SETTLE phase ends it
    const bare = run([{ phase: PHASE.UNITE, round: 8, lp: 20, leaks: 5 }, { phase: PHASE.SETTLE, round: 8, lp: 20, leaks: 5 }]);
    assert.deepEqual(bare.map((r) => r.shown), [15, 20]);
  });

  test('clamped at 0; nothing pending for the eliminated, in prep, in boss rounds or without an LP', () => {
    assert.equal(liveLp(null, { phase: PHASE.COMBAT, round: 3, lp: 4, leaks: 9 }).shown, 0);
    assert.equal(liveLp(null, { phase: PHASE.COMBAT, round: 3, lp: 4, leaks: 9 }).pending, 4, 'never more than the LP left');
    assert.equal(liveLp(null, { phase: PHASE.COMBAT, round: 3, lp: 40, leaks: 9, alive: false }).pending, 0);
    for (const phase of [PHASE.PREP, PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.SETTLE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE, PHASE.RESULT]) {
      const r = liveLp(null, { phase, round: 3, lp: 40, leaks: 9 });
      assert.deepEqual([r.pending, r.shown, r.base], [0, 40, null], phase);
    }
    assert.deepEqual(liveLp(null, { phase: PHASE.COMBAT, round: 3, lp: undefined, leaks: 2 }), { base: null, pending: 0, shown: null, unite: false, left: null });
    assert.match(pendingTip(30, 3), /结算时扣除 3 点/);
    assert.match(pendingTip(30, 10, { unite: true }), /联防中/);
    assert.equal(pendingTip(30, 0), null);
  });

  test('team panel rows: the own row takes the top bar\'s live value, a teammate\'s m.public players[].pendingLp; only in COMBAT / 联防', () => {
    const pub = { phase: PHASE.COMBAT };
    assert.deepEqual(rowLp({ lp: 30, pendingLp: 3 }, pub), { lp: 30, pending: 3, unite: false, left: null });
    assert.deepEqual(rowLp({ lp: 2, pendingLp: 3 }, pub), { lp: 2, pending: 2, unite: false, left: null }, 'clamped at the LP left');
    assert.deepEqual(rowLp({ lp: 30 }, pub), { lp: 30, pending: 0, unite: false, left: null });
    assert.deepEqual(rowLp({ lp: 30, pendingLp: 4 }, { phase: PHASE.UNITE }), { lp: 30, pending: 4, unite: true, left: null });
    assert.deepEqual(rowLp({ lp: 30, pendingLp: 4 }, { phase: PHASE.SETTLE }), { lp: 30, pending: 0, unite: false, left: null });
    assert.deepEqual(rowLp({ lp: 30, pendingLp: 4, alive: false }, pub), { lp: 30, pending: 0, unite: false, left: null });
    // the own row: the top bar's numbers (m.private lp — m.public may lag behind it by a throttle interval)
    assert.deepEqual(rowLp({ lp: 30, pendingLp: 1 }, pub, { lp: 30, pending: 5, unite: false }), { lp: 30, pending: 5, unite: false, left: null });
    assert.deepEqual(rowLp({ lp: 30 }, pub, { lp: 25, pending: 0, unite: false }), { lp: 25, pending: 0, unite: false, left: null }, 'settled m.private first');
    assert.deepEqual(rowLp({ lp: 30 }, { phase: PHASE.FINAL_ASSAULT }, { lp: 99, pending: 5 }), { lp: 30, pending: 0, unite: false, left: null }, 'boss rounds: the row keeps its own share');
  });

  test('LP tower: the settled LP in red with a −N tick keyed by the pending value (it pops again on every leak) — the official keeps the current value until settlement (GitHub #479), the 联防中 tag', () => {
    const plain = LpTower({ value: 24, size: 'lg' });
    assert.ok(!hasClass(plain, 'is-pending'));
    assert.equal(textOf(plain), '24');
    const v = LpTower({ value: 24, size: 'lg', pending: 3, tip: 'x' });
    assert.ok(hasClass(v, 'is-pending'));
    const pend = [...walk(v)].find((n) => hasClass(n, 'lp__pend'));
    assert.equal(pend.key, 3, 'keyed: a new count re-mounts the tick (its pop animation plays again)');
    assert.equal(textOf(pend), '−3');
    const val = [...walk(v)].find((n) => hasClass(n, 'lp__val'));
    assert.equal(textOf(val), '24', 'the number keeps the settled LP; the −3 tick carries the pending loss (GitHub #479)');
    assert.equal(v.props.title, 'x');
    const unite = LpTower({ value: 5, pending: 9, note: '联防中' });
    assert.equal(textOf([...walk(unite)].find((n) => hasClass(n, 'lp__val'))), '5');
    assert.equal(textOf([...walk(unite)].find((n) => hasClass(n, 'lp__pend'))), '−5', 'the tick clamps at the LP left');
    assert.equal(textOf([...walk(unite)].find((n) => hasClass(n, 'lp__note'))), '联防中');
    assert.equal(textOf(LpTower({ value: null, pending: 3 })), '--');
  });

  test('server: m.public players[].pendingLp = min(cap, the authority\'s reported leaks) during COMBAT, the own battle\'s count in 联防, gone at SETTLE', async () => {
    const { makeMatch } = await import('../match/harness.js');
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 0, seed: 7331, captureFrames: false, clientCombat: true, clients: false });
    h.autoHumans();
    h.m.start();
    h.run(() => h.m.phase === PHASE.COMBAT && h.m.round === 1);
    const m = h.m;
    const view = (pid) => m.publicView().players.find((p) => p.playerId === pid);
    const f = m.fields.find((x) => x.players.includes('p_0'));
    assert.equal(f.mode, 'client');
    assert.equal('pendingLp' in view('p_0'), false, 'omitted while nothing leaked');
    m.handle('p_0', { t: 'b.progress', battleId: f.battleId, gt: 5, killed: 1, total: 9, leaks: 3 });
    assert.equal(view('p_0').pendingLp, 3);
    assert.equal('pendingLp' in view('p_1'), false);
    m.handle('p_0', { t: 'b.progress', battleId: f.battleId, gt: 9, killed: 1, total: 20, leaks: 14 });
    assert.equal(view('p_0').pendingLp, m.gd.lpCapPerRound, 'capped');
    // 联防: the recorded own results
    m.phase = PHASE.UNITE;
    m.lastResults = new Map([['p_0', { leaked: [{ enemyKey: 'a' }, { enemyKey: 'b', counted: false }, { enemyKey: 'c', counted: true }] }]]);
    assert.equal(view('p_0').pendingLp, 2, 'counted !== false, like settle()');
    assert.equal('pendingLp' in view('p_1'), false);
    for (const phase of [PHASE.SETTLE, PHASE.PREP, PHASE.FINAL_ASSAULT]) {
      m.phase = phase;
      assert.equal('pendingLp' in view('p_0'), false, phase);
    }
    m.dispose();
  });
});

// ---- 3: the temp overflow row --------------------------------------------------------------------------------------

describe('3: the temp overflow row (临时整备区)', () => {
  const priv = (temp) => ({ alive: true, ready: false, canReady: !temp.some(Boolean), temp });

  test('the ready button shows why it is refused, under it, not only on hover', () => {
    const p = priv([{ uid: 1, kind: 'item', id: 'x' }, { uid: 2, kind: 'chess', id: 'y' }, null, null, null]);
    assert.deepEqual(tempInfo(p), { count: 2, items: 1 });
    assert.match(tempReadyReason(p), /^临时整备区还有 2 个单位：/);
    assert.ok(tempReadyReason(p).includes(TEMP_RULE));
    assert.match(TEMP_RULE, /休整期结束时.*销毁/, 'says what happens at the end of the prep');
    const v = ReadyToggle({ priv: p, onToggle() {}, readyCount: 1, total: 4 });
    const why = [...walk(v)].find((n) => hasClass(n, 'readywrap__why'));
    assert.ok(why, 'visible reason');
    assert.equal(textOf(why), '临时整备区 2 个单位待处理');
    const btn = [...walk(v)].find((n) => n.type === 'button');
    assert.equal(btn.props.disabled, true);
    // empty temp: no reason, enabled
    const ok = ReadyToggle({ priv: priv([null, null, null, null, null]), onToggle() {} });
    assert.equal([...walk(ok)].find((n) => hasClass(n, 'readywrap__why')), undefined);
    assert.ok(![...walk(ok)].find((n) => n.type === 'button').props.disabled);
    assert.deepEqual(tempInfo(null), { count: 0, items: 0 });
  });

  test('Ready shows the personal-choice reason and describes it even with no temp pieces', () => {
    for (const temp of [[], [{ uid: 1, kind: 'item' }]]) {
      const v = ReadyToggle({ priv: { ...priv(temp), canReady: false, personalChoice: { id: 'choice.1' } }, onToggle() {} });
      const nodes = [...walk(v)];
      const btn = nodes.find((n) => n.type === 'button');
      assert.equal(btn.props.disabled, true);
      assert.equal(btn.props['aria-describedby'], 'readywrap-why');
      assert.equal(textOf(nodes.find((n) => hasClass(n, 'readywrap__why'))), '请先完成教鞭选择');
      assert.equal(nodes.find((n) => n.type?.name === 'Tooltip').props.text, '请先完成教鞭选择');
    }
  });

  test('the row frame: the outer corners of both end tiles, the label on the side with room (mirrored Final Assault prep too)', () => {
    // tileScreen polys: [back-left, back-right, front-right, front-left] (render/app.js tileScreen corner order)
    const tile = (cx, y, w = 100, d = 60) => ({ x: cx, y, s: w, poly: [[cx - w / 2 + 6, y - d / 2], [cx + w / 2 - 6, y - d / 2], [cx + w / 2, y + d / 2], [cx - w / 2, y + d / 2]] });
    const a = tile(800, 640), b = tile(1260, 640);
    const f = tempRowFrame(a, b, { labelW: 290, gap: 10, vw: 1920 });
    assert.deepEqual(f.quad, [[756, 610], [1304, 610], [1310, 670], [750, 670]]);
    assert.deepEqual([f.left, f.right, f.top, f.bottom, f.y], [750, 1310, 610, 670, 640]);
    assert.equal(f.side, 'left');
    // the Final Assault prep of the right-hand player draws the board mirrored: the ends swap on screen
    assert.deepEqual(tempRowFrame(b, a, { labelW: 290, gap: 10, vw: 1920 }).quad, f.quad);
    // no room on the left (a narrow phone): the label goes right
    assert.equal(tempRowFrame(tile(200, 300), tile(600, 300), { labelW: 290, gap: 10, vw: 1200 }).side, 'right');
    // neither side has room: left (clipped rather than covering the row)
    assert.equal(tempRowFrame(tile(200, 300), tile(600, 300), { labelW: 290, gap: 10, vw: 900 }).side, 'left');
    for (const bad of [null, {}, { poly: [[0, 0]] }, { poly: [[0, 0], [1, 0], [1, NaN], [0, 1]] }]) assert.equal(tempRowFrame(bad, b), null);
  });

  test('the row\'s label matches the server\'s due rule (PlayerState tempDue): destroyed at this prep\'s end unless ready — then kept through the next prep', () => {
    assert.match(tempRowRule(false), /才能准备；休整期结束时仍在此处的将被销毁$/);
    // Ready is refused while the row holds pieces: what lies there while ready arrived after it (due at the next prep)
    assert.match(tempRowRule(true), /保留到下个休整期/);
    assert.match(tempRowRule(true), /取消准备则在本休整期结束时销毁/);
  });

  test('the game screen frames the row only on the own prep board while it holds pieces (source contract)', () => {
    const game = read('public/js/screens/game.js');
    assert.match(game, /const tempNotice = temp\.count > 0 && !!view && viewKind !== 'loading' && showPrep && alive && !pen && !sp;/);
    assert.match(game, /<\$\{TempRowNotice\} view=\$\{view\} count=\$\{temp\.count\} items=\$\{temp\.items\} label=\$\{!drag && !facing\}\s+ready=\$\{phase === PHASE\.PREP && !!priv\?\.ready\} \/>/);
    assert.match(game, /toast\(tempReadyReason\(L\.priv\) \|\| refused, 'warn'\)/, 'Space says why');
    const css = read('public/css/screens/game-panels.css');
    assert.match(css, /\.tempnote \{ position: fixed; inset: 0; z-index: 2; pointer-events: none; \}/, 'over the field, under the HUD, never takes the pointer');
  });

  test('while the ready button shows its reason the effects column moves down a line (on phones the ready count ran into it)', () => {
    const game = read('public/js/screens/game.js');
    // the same condition as ReadyToggle's reason: PREP, alive, not ready, pieces in the row
    assert.match(game, /const readyWhy = phase === PHASE\.PREP && alive && !priv\?\.ready && \(hasPersonalChoice \|\| temp\.count > 0\);/);
    assert.match(game, /readyWhy && 'has-readywhy'/);
    const css = read('public/css/screens/game.css');
    assert.match(css, /\.gm__effects \{ position: absolute; right: \.3rem; top: 2\.4rem; \}/);
    assert.match(css, /\.gm\.has-readywhy \.gm__effects \{ top: calc\(2\.4rem \+ max\(\.3rem, calc\(16px \* var\(--sp-ui, 1\)\)\)\); \}/);
  });
});

// ---- 8: the operator's own effect first --------------------------------------------------------------------------------

describe('8: 特质 right under the detail card\'s header', () => {
  // GitHub #175 (from PR #192 by @kukiC): the card's 7 / 14 is the cap the battle applies
  test('华法琳\'s normal and elite cards show the 7 / 14 layer caps (GitHub #175)', async () => {
    await data.loadAll('chess', 'garrisons', 'assets', 'bonds', 'items');
    for (const [id, cap] of [['chess_char_4_26_a', 7], ['chess_char_4_26_b', 14]]) {
      const blocks = ChessDetail({ chess: data.lookup('chess', id), piece: null, editable: false, bonds: [], loadout: null });
      const block = blocks.find((b) => b.key === 'garrison');
      const rich = [...walk(block.type(block.props))].find((n) => n.props?.text != null);
      assert.match(rich.props.text, new RegExp(`每场战斗至多${cap}层`));
    }
  });

  test('the block order', () => {
    assert.deepEqual(CHESS_SECTIONS, ['head', 'garrison', 'trait', 'stats', 'skill', 'module', 'equip', 'talents', 'actions']);
  });

  test('a rendered operator card: header, then 特质 (trigger + description), then the rest in CHESS_SECTIONS order', async () => {
    await data.loadAll('chess', 'garrisons', 'assets', 'bonds', 'items');
    const c = data.lookup('chess', 'chess_char_3_04_b'); // 琳琅诗怀雅 (elite): <休整期结束时> garrison, modules, talents
    assert.ok(c && c.garrisonIds && c.garrisonIds[0]);
    const g = data.lookup('garrisons', c.garrisonIds[0]);
    assert.equal(g.eventType, 'SERVER_PREP_FIN');
    const blocks = ChessDetail({ chess: c, piece: { uid: 7, kind: 'chess', id: c.chessId, golden: true, items: [] }, editable: false, onSell() {}, bonds: [], loadout: null, onBond: null });
    const keys = blocks.map((b) => b.key);
    assert.deepEqual(keys, ['head', 'garrison', 'trait', 'stats', 'skill', 'module', 'equip', 'talents']);
    assert.equal(blocks[1].props.garrison, g, 'the operator\'s own garrison');
    // the garrison block itself: the 特质 label, the trigger chip and the description
    const gb = blocks[1].type(blocks[1].props);
    assert.ok(hasClass(gb, 'dgarrison'));
    assert.ok(textOf(gb).includes('特质'));
    assert.ok(textOf(gb).includes(g.eventTypeDesc));
    const rich = [...walk(gb)].find((n) => n.props?.text != null);
    assert.equal(rich.props.text, g.descRaw || g.desc);
    // an operator without a garrison (a summon's chess record may have none) simply starts with the trait
    const bare = ChessDetail({ chess: { ...c, garrisonIds: [] }, piece: null, editable: false, bonds: [], loadout: null });
    assert.deepEqual(bare.map((b) => b.key), ['head', 'trait', 'stats', 'skill', 'module', 'talents']);
  });

  test('the 特质 chip carries the garrison\'s official type icon (eventTypeIcon) — the spoked 特异化 glyph only on 特异化', async () => {
    await data.loadAll('garrisons', 'assets', 'chess');
    const all = data.list('garrisons');
    assert.ok(all.length > 200);
    const bad = all.filter((g) => garrisonTypeIconKey(g) !== `s_${g.eventTypeIcon}`);
    assert.deepEqual(bad.map((g) => g.garrisonId), [], 'every garrison shows its own type icon');
    // (the spoked icon_support reads like a loading spinner: it used to stand before every <休整期开始时 / 结束时> 特质)
    const spoked = all.filter((g) => garrisonTypeIconKey(g) === 's_icon_support');
    assert.ok(spoked.length > 0 && spoked.every((g) => g.eventTypeDesc === '特异化'), 'icon_support = 特异化 only');
    const prep = all.filter((g) => g.eventType === 'SERVER_PREP_START' || g.eventType === 'SERVER_PREP_FIN');
    assert.ok(prep.filter((g) => garrisonTypeIconKey(g) !== 's_icon_support').length > prep.length / 2, 'most 休整期 特质 are 持续叠加 / 整备能力');
    // no official icon in the record: a guess by the trigger, never a path from the data
    assert.equal(garrisonTypeIconKey({ eventType: 'SERVER_PREP_FIN' }), 's_icon_bond');
    assert.equal(garrisonTypeIconKey({ eventType: 'IN_BATTLE', eventTypeIcon: '../../x' }), 's_icon_battle');
    assert.equal(garrisonTypeIconKey(null), 's_icon_bond');
    // the rendered card of 琳琅诗怀雅 (elite): <休整期结束时> · 整备能力 → the gold 整备能力 icon
    const c = data.lookup('chess', 'chess_char_3_04_b');
    const g = data.lookup('garrisons', c.garrisonIds[0]);
    assert.equal(g.eventTypeDesc, '整备能力');
    const blocks = ChessDetail({ chess: c, piece: null, editable: false, bonds: [], loadout: null });
    const gb = blocks.find((b) => b.key === 'garrison');
    const img = [...walk(gb.type(gb.props))].find((n) => hasClass(n, 'dgarrison__icon'));
    assert.match(String(img.props.src), /garrisonTypeIcon\/s_icon_gold\.png$/);
  });

  test('css: a compact gold-accented block; stats in a 4 × 2 grid so the skill stays close', () => {
    const css = read('public/css/screens/game-panels.css');
    assert.match(css, /\.dgarrison \{[^}]*border-left: 3px solid var\(--gold-2\)/);
    assert.match(css, /\.dstats \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
    assert.match(read('public/css/devices.css'), /@media \(max-height: 460px\) \{\n {2}\.dhead__art \{ height: 1\.66rem; \}\n {2}\.dhead__en \{ display: none; \}/);
  });
});

// ---- 9: no spinner next to texts; data loaded once, before the match screen --------------------------------------------

describe('9: busy indicators and data loading', () => {
  const cssFiles = () => {
    const out = [];
    const walkDir = (d) => { for (const e of readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walkDir(p); else if (p.endsWith('.css')) out.push(p); } };
    walkDir('public/css');
    return out;
  };

  test('no wait / progress cursor anywhere (the OS shows a spinning wheel next to the pointer — over the detail card beside an underframe button, the 交流 button …)', () => {
    for (const f of cssFiles()) assert.doesNotMatch(read(f), /cursor:\s*(wait|progress)/, f);
  });

  test('a busy button keeps its icon and gets a delayed sweeping bar — no spinning ring', () => {
    const v = Button({ loading: true, icon: 'play', children: '继续作战' });
    assert.equal(v.props.disabled, true);
    assert.equal(v.props['aria-busy'], 'true');
    const nodes = [...walk(v)];
    assert.ok(nodes.some((n) => hasClass(n, 'btn__icon')), 'the icon stays');
    assert.ok(nodes.some((n) => hasClass(n, 'btn__busy')));
    assert.ok(!nodes.some((n) => hasClass(n, 'btn__spin')));
    const idle = [...walk(Button({ icon: 'play', children: 'x' }))];
    assert.ok(!idle.some((n) => hasClass(n, 'btn__busy')));
    const css = read('public/css/components.css');
    assert.doesNotMatch(css, /\.btn__spin/);
    assert.match(css, /\.btn__busy \{[^}]*animation: btn-busy-in 1ms linear 250ms forwards;/, 'only after 250 ms: quick replies show nothing');
    assert.match(css, /@keyframes btn-busy \{ from \{ transform: translateX\(-100%\); \} to \{ transform: translateX\(250%\); \} \}/, 'a sweep, not a rotation');
  });

  test('机变: the card being picked shows 选择中 (no spinner) only until the pick shows in m.public', () => {
    assert.equal(pickBusy(2, { idx: 2 }, null), true);
    assert.equal(pickBusy(2, { idx: 1 }, null), false);
    assert.equal(pickBusy(null, { idx: 2 }, null), false);
    assert.equal(pickBusy(2, { idx: 2 }, 2), false, 'the pick landed: never stuck on the card');
    assert.equal(pickBusy(0, { idx: 0 }, 0), false, 'index 0 too');
    assert.equal(pickBusy(2, { idx: 2, takenBy: 'p_1' }, null), false);
    const sp = { family: 'tactic', name: '战术决策', desc: '', cards: [{ idx: 0, name: 'A', desc: 'a' }, { idx: 1, name: 'B', desc: 'b' }], order: ['me'], turnPid: 'me', pickOf: new Map(), untimed: true };
    // (ChoiceView: the overlay's pure view — ChoiceOverlay keeps the two-tap selection, user playtest #4 item 2)
    const v = ChoiceView({ pub: { players: [{ playerId: 'me', seat: 0, name: 'Me' }] }, sp, myId: 'me', solo: true, busyIdx: 1 });
    const nodes = [...walk(v)];
    const busyCards = nodes.filter((n) => hasClass(n, 'spcard') && hasClass(n, 'is-busy'));
    assert.equal(busyCards.length, 1);
    assert.equal(textOf(nodes.find((n) => hasClass(n, 'spcard__busy'))), '选择中');
    assert.ok(!nodes.some((n) => n.type === Spinner), 'no spinner over the card text');
    // the pick landed (m.public) while the request still waits for its reply
    const landed = ChoiceView({ pub: { players: [] }, sp: { ...sp, pickOf: new Map([['me', 1]]), cards: [sp.cards[0], { ...sp.cards[1], takenBy: 'me' }] }, myId: 'me', solo: true, busyIdx: 1 });
    assert.ok(![...walk(landed)].some((n) => hasClass(n, 'spcard__busy')));
  });

  test('choice requests carry the personal ID while global requests keep their existing shape', async () => {
    const { net } = await import('../../public/js/net.js');
    const { actions } = await import('../../public/js/ui/gameActions.js');
    const request = net.request, sent = [];
    net.request = async (t, fields) => { sent.push([t, fields]); };
    try {
      assert.equal(await actions.choice(0), true);
      assert.equal(await actions.choice(2, 'seed.choice.3'), true);
      assert.deepEqual(sent, [['g.choice', { idx: 0 }], ['g.choice', { idx: 2, choiceId: 'seed.choice.3' }]]);
    } finally { net.request = request; }
  });

  test('the "作战结束，等待队友完成作战" hourglass stands still', () => {
    const css = read('public/css/screens/game.css');
    assert.doesNotMatch(css, /hg-flip/);
    assert.match(css, /\.chud__msg \.icon \{ width: \.22rem; height: \.22rem; color: var\(--gold\); \}/);
  });

  test('data store: a transient failure is retried (the file stays loading), a 404 / bad JSON is not; a superseded retry stays silent', async () => {
    const waits = [];
    const wait = async (ms) => { waits.push(ms); };
    let calls = 0;
    const flaky = createDataStore({
      wait,
      fetch: async () => {
        calls++;
        if (calls === 1) throw new TypeError('Failed to fetch');
        if (calls === 2) return { ok: false, status: 502, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ list: [{ id: 'x', v: 1 }] }) };
      },
    });
    const p = flaky.load('chess');
    assert.equal(flaky.status('chess'), 'loading');
    await p;
    assert.equal(flaky.status('chess'), 'ready');
    assert.equal(flaky.lookup('chess', 'x').v, 1);
    assert.deepEqual(waits, RETRY_DELAYS_MS.slice(0, 2));
    assert.deepEqual(RETRY_DELAYS_MS, [600, 2000]);

    const warn = console.warn;
    console.warn = () => {};
    try {
      let n404 = 0;
      const gone = createDataStore({ wait, fetch: async () => { n404++; return { ok: false, status: 404, json: async () => ({}) }; } });
      await gone.load('bands');
      assert.equal(gone.status('bands'), 'missing');
      assert.equal(n404, 1, 'a 404 is final');
      let nBad = 0;
      const bad = createDataStore({ wait, fetch: async () => { nBad++; return { ok: true, status: 200, json: async () => JSON.parse('{"broken": ') }; } });
      await bad.load('bands');
      assert.equal(bad.status('bands'), 'missing');
      assert.equal(nBad, 1, 'a delivered file that is not JSON is final');
      let nDown = 0;
      const down = createDataStore({ wait, fetch: async () => { nDown++; throw new TypeError('offline'); } });
      await down.load('items');
      assert.equal(down.status('items'), 'missing');
      assert.equal(nDown, 1 + RETRY_DELAYS_MS.length, 'gives up after the retries');
      // invalidated while waiting to retry: the old load stops, the new one decides
      let release;
      let nInv = 0;
      const inv = createDataStore({
        wait: () => new Promise((r) => { release = r; }),
        fetch: async () => { nInv++; if (nInv === 1) throw new TypeError('offline'); return { ok: true, status: 200, json: async () => ({ a: { v: 2 } }) }; },
      });
      const seen = [];
      inv.subscribe((name) => seen.push(`${name}:${inv.status(name)}`));
      const first = inv.load('config');
      await new Promise((r) => setImmediate(r));
      const second = inv.invalidate('config');
      await second;
      release();
      await first;
      assert.equal(inv.status('config'), 'ready');
      assert.equal(inv.get('config').a.v, 2);
      assert.equal(nInv, 2, 'the superseded load did not fetch again');
      assert.deepEqual(seen, ['config:loading', 'config:ready']);
    } finally { console.warn = warn; }
  });

  test('every data file the in-match UI reads is in GAME_FILES (the match screen waits for them: no text appears late); main.js warms them in a room', () => {
    const files = [
      ...readdirSync(path.join(ROOT, 'public/js/ui')).filter((f) => f.endsWith('.js')).map((f) => `public/js/ui/${f}`),
      ...['game', 'briefing', 'bandDraft', 'result'].map((s) => `public/js/screens/${s}.js`),
    ];
    const used = new Set();
    for (const f of files) for (const m of read(f).matchAll(/data\.(?:get|lookup|list|load|status)\('([A-Za-z-]+)'/g)) used.add(m[1]);
    for (const m of read('public/js/ui/gameComponents.js').matchAll(/useData\('([A-Za-z-]+)'/g)) used.add(m[1]);
    assert.ok(used.size >= 10, [...used].join(','));
    const missing = [...used].filter((n) => !GAME_FILES.includes(n));
    assert.deepEqual(missing, [], 'read by the match UI but not awaited by the match screen');
    const main = read('public/js/main.js');
    assert.match(main, /if \(s\.room && !prev\.room\) warmGameData\(\);/);
    assert.match(main, /data\.loadAll\(GAME_FILES\)/);
  });
});

test('GEO: the temp row the notice frames is the server\'s (row 8, cols 4–8)', () => {
  assert.deepEqual([GEO.TEMP_ROW, GEO.TEMP_C0, GEO.TEMP_SIZE], [8, 4, 5]);
});
