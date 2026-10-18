// Real-server browser E2E (DESIGN §20.15, user report after playtest #6): the bond strip follows the watched teammate.
// Two humans — the host on a 1280×720 desktop, the guest deploying at 1280×720 and then on the user's phone (756×366 CSS
// px) — start a co-op match at the Final Assault (fastServer SP_START_ROUND=boss) with a known starter kit; the host
// deploys 古米 + 艾丝黛尔 (坚守 / 萨尔贡), the guest 惊蛰 + 跃跃 (炎 / 精准), so their strips hold different bonds.
//   * prep: the host scouts the guest (前往查看) → the strip shows the GUEST's bonds and counts with the amber
//     "👁 阿米娅" tag, the popup of one of them says "阿米娅 的盟约"; 返回自己 → the host's own bonds again;
//   * Final Assault (one pair field): 全景 → your own bonds; the ‹ › pill on the partner's half → the partner's bonds
//     (tagged), on your own half → yours; the guest on the phone does the same — the tagged strip stays on screen, clear
//     of the team panel, the name at ≥ 9 px (≥ 10 px on the desktop); a card's bond chip opens the UNIT owner's popup
//     whichever player the strip follows (the guest's operator on 全景 → "阿米娅 的盟约", the host's own on the partner's
//     half → the host's own), with the count the chip shows.
// 联防 observer (2 humans + 1 AI from round 3, fastServer hooks: per-human kits auto-placed, the guest without a board):
//   the guest leaks, the host and the AI help → the guest (phone) on 全景 sees helper 1's bonds (never its own), taps
//   each helper's avatar (前往查看) → the camera goes to that helper's half, the ‹ › pill and the strip name the same
//   helper, 返回战场 sits in the pill and leaves no error; the host (helper, desktop) keeps its own bonds on 全景.
// Final Assault spectator (2 humans + 2 AI at the boss round, the guest eliminated at the jump, boss pairs by seat): the
//   guest auto-observes the pair field → its first player's bonds (never its own), taps the second player's operator
//   and its card's bond chip → the SECOND player's popup (the strip stays on the first), taps each pair player → their
//   half + bonds, taps the lone field's player → that field and its player's bonds.
// After the own battle (2 humans + 1 idle AI from round 3, 1× combat, the guest's enemies spawning at twice their times):
//   the host's battle ends first, the host watches a teammate still fighting → the strip shows that teammate's bonds with the observing pill "👁 name" + 返回战场; a
//   reload keeps all three (the resent field is adopted — battle/observe.js resumedWatch); 返回战场 → the own bonds.
// Unit counterparts: test/ui/watch-bonds.test.js (selection logic incl. 联防), test/match/watch-bonds.test.js (views),
// test/match/observe.test.js (resumedWatch).
//
//   SP_E2E=1 node --test test/ui/watch-bonds.e2e.test.js
//
// Screenshots: test/e2e/out/watch-bonds-*.png.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, sleep, hasChrome, startRealServer, problemsOf, waitForFunctionLong } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const HOST_KIT = ['chess_char_1_10_a', 'chess_char_1_12_a']; // 古米 (坚守), 艾丝黛尔 (萨尔贡)
const GUEST_KIT = ['chess_char_1_03_a', 'chess_char_1_09_a']; // 惊蛰 (炎), 跃跃 (精准)
// a 联防 needs two perfect players: the host fields six 萨尔贡 operators (百炼嘉维尔, 卡涅利安, 菲莱, 至简, 艾丝黛尔, 莎草),
// the AI seats five 拉特兰 ones + 古米 (信仰搅拌机, 莫斯提马, 能天使, 空弦, 送葬人; 坚守) — different bonds on each strip
const UNITE_HOST_KIT = ['chess_char_4_23_a', 'chess_char_4_24_a', 'chess_char_3_06_a', 'chess_char_3_13_a', 'chess_char_1_12_a', 'chess_char_2_06_a'];
const BOT_KIT = ['chess_char_4_01_a', 'chess_char_4_02_a', 'chess_char_3_01_a', 'chess_char_3_21_a', 'chess_char_2_01_a', 'chess_char_1_10_a'];
// "after the own battle": the same host without 菲莱 — the layout planner behind fastServer's autoPlace puts a zero-range
// guard on a road tile first (PR #339, §27.35), where she holds the enemies and the host's battle could run 109 s of a
// 110 s round-3 limit (measured; 53–68 s without her)
const AFTER_HOST_KIT = UNITE_HOST_KIT.filter((id) => id !== 'chess_char_3_06_a');

/** The strip as shown: whose (data-owner), the bonds (data-bond) with their counts, the tag's text. */
const stripOf = (c) => c.page.evaluate(() => {
  const el = document.querySelector('.gm__bonds .bstrip');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const tag = el.querySelector('.bstrip__owner');
  const tr = tag ? tag.getBoundingClientRect() : null;
  return {
    owner: el.getAttribute('data-owner'), other: el.classList.contains('is-other'),
    bonds: [...el.querySelectorAll('.bslot')].map((s) => s.getAttribute('data-bond')).sort(),
    counts: Object.fromEntries([...el.querySelectorAll('.bslot')].map((s) => [s.getAttribute('data-bond'), s.querySelector('.bslot__count')?.firstChild?.textContent ?? null])),
    tag: tag ? tag.textContent.trim() : null,
    tagFont: tag ? parseFloat(getComputedStyle(tag.querySelector('.micro')).fontSize) : null,
    pill: document.querySelector('.chud__layers .vswitch__label')?.textContent?.trim() ?? null,
    pillBack: !!document.querySelector('.chud__layers .chud__back'),
    observe: document.querySelector('.chud__observe .vswitch__label')?.textContent?.trim() ?? null,
    tagRect: tr ? { left: tr.left, top: tr.top, right: tr.right, bottom: tr.bottom } : null,
    rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    vw: innerWidth, vh: innerHeight,
    team: (() => { const t = document.querySelector('.team'); if (!t) return null; const b = t.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; })(),
  };
});

/** A player's bond ids with members as the views carry them (yours: m.private; a teammate's: m.public). */
const bondsOf = (c, name) => c.page.evaluate((name) => {
  const s = globalThis.__SP__.store.get();
  const p = s.match.public.players.find((x) => x.name === name);
  const own = p && p.playerId === s.me.playerId;
  const list = own ? s.match.private.bonds : p.bonds;
  return { ids: list.filter((b) => b.count > 0 || b.layers > 0 || b.active).map((b) => b.bondId).sort(), counts: Object.fromEntries(list.map((b) => [b.bondId, String(b.count)])) };
}, name);

/**
 * Tap one of `ownerId`'s operators on the battle field on screen (a point the renderer's own picking maps to that unit,
 * not covered by the HUD), then its card's first bond chip: the popup that chip opens (whose, its count) + the chip's
 * count. null when no such operator could be tapped.
 */
async function chipPopup(c, ownerId) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const pt = await c.page.evaluate((ownerId) => {
      const d = globalThis.__SP_VIEW__?.raw?.debug;
      if (!d?.views || !d.pick?.battleUnitAt || !d.app?.view) return null;
      const canvas = d.app.view;
      const r = canvas.getBoundingClientRect();
      for (const v of d.views.values()) {
        const info = v.info;
        if (v.destroyed || !info || info.ownerId !== ownerId || info.side === 'enemy' || typeof v.bounds !== 'function') continue;
        const b = v.bounds();
        for (const at of [0.85, 0.65, 0.95, 0.45]) {
          const x = b.x + b.width / 2;
          const y = b.y + b.height * at;
          if (d.pick.battleUnitAt(x, y) !== v || document.elementFromPoint(r.left + x, r.top + y) !== canvas) continue;
          return { x: r.left + x, y: r.top + y, defId: info.defId };
        }
      }
      return null;
    }, ownerId);
    if (!pt) { await sleep(400); continue; }
    await c.page.mouse.click(pt.x, pt.y);
    const card = await c.page.waitForSelector('.dpanel button.dbond[data-bond]', { timeout: 2500 }).then(() => true).catch(() => false);
    if (!card) continue;
    // a bond the mode switches off (标准: 本局禁用, since 0.1.1) shows no count on its chip: take a live one when there is one
    const chip = await c.page.evaluate(() => {
      const el = document.querySelector('.dpanel button.dbond[data-bond]:not(.is-off)') || document.querySelector('.dpanel button.dbond[data-bond]');
      return { bondId: el.getAttribute('data-bond'), count: el.querySelector('.dbond__count')?.firstChild?.textContent ?? null, off: el.classList.contains('is-off') };
    });
    await c.page.click(`.dpanel button.dbond[data-bond="${chip.bondId}"]`);
    await c.page.waitForSelector('.bpop', { timeout: 3000 });
    const pop = await c.page.evaluate(() => {
      const el = document.querySelector('.bpop');
      return { owner: el.getAttribute('data-owner'), label: el.getAttribute('aria-label'), tag: el.querySelector('.bpop__owner')?.textContent || '',
        count: el.querySelector('.bpop__facts b.num')?.textContent ?? null, on: el.querySelectorAll('.bpop__member.is-on').length };
    });
    return { ...pop, bondId: chip.bondId, chipCount: chip.count, off: chip.off, defId: pt.defId };
  }
  return null;
}

/** Close the bond popup and the card (Esc closes the popup first). */
async function closeCard(c) {
  for (let i = 0; i < 3 && (await c.page.$('.bpop, .dpanel')); i++) {
    await c.page.keyboard.press('Escape');
    await sleep(250);
  }
}

/** Hand piece `chessId` → a legal board tile through the direction wheel. */
async function place(c, chessId) {
  const piece = (await c.handPieces('chess')).find((p) => p.id === chessId);
  assert.ok(piece, `${c.label}: ${chessId} in the hand`);
  const n0 = (await c.boardPieces()).length;
  const tile = await c.freeTileFor(piece.uid);
  assert.ok(tile, `${c.label}: a legal tile for ${chessId}`);
  await c.drag(await c.piecePoint(piece.uid), await c.tilePoint(tile.row, tile.col));
  await c.page.waitForSelector('.fwheel__dia', { timeout: 4000 });
  await c.swipe('RIGHT');
  await c.page.waitForFunction((n0) => (globalThis.__SP__.store.get().match.private?.board || []).length > n0, { timeout: 8000 }, n0);
}

/** Two humans in a co-op room with `bots` AI seats: the host on a 1280×720 desktop, the guest on the user's phone
 *  (756×366 CSS px, touch), through the briefing and the band draft. */
async function coopMatch(P, base, { bots = 1, prefix }) {
  const host = new Client(P, base, 'host', { prefix: `${prefix}-host`, w: 1280, h: 720 });
  const guest = new Client(P, base, 'guest', { prefix: `${prefix}-phone`, w: 756, h: 366 });
  await host.open();
  await host.enter('凯尔希');
  await host.click('.mode-card', '同盟模拟');
  await host.click('.diff-card', '标准模拟');
  await host.click('.create-box button', '创建同盟');
  const room = (await host.waitFor((s) => !!s.room?.code, 'room created')).room;
  for (let i = 0; i < bots; i++) {
    await host.click('button', '添加 AI 队友');
    await sleep(600);
  }
  await guest.open(`?room=${room.code}`);
  await guest.page.setViewport({ width: 756, height: 366, hasTouch: true, isMobile: true });
  await guest.page.reload({ waitUntil: 'domcontentloaded' });
  await guest.page.waitForFunction(() => !!globalThis.__SP__ && !!document.querySelector('.screen'), { timeout: 30000 });
  await guest.enter('阿米娅');
  await guest.waitFor((s) => s.room?.code === room.code, 'guest joined');
  const guestReady = () => guest.page.evaluate(() => {
    const s = globalThis.__SP__.store.get();
    return !!s.room?.seats?.find((x) => x && x.playerId === s.me.playerId)?.ready;
  });
  for (let i = 0; i < 6 && !(await guestReady()); i++) {
    await guest.click('.room-bar__right button', '准备就绪', { optional: true, timeout: 3000 });
    await sleep(600);
  }
  assert.ok(await guestReady(), 'guest ready');
  await host.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
  for (const c of [host, guest]) await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
  for (const c of [host, guest]) await c.click('.brief__foot .btn--primary', '准备就绪');
  for (const c of [host, guest]) await c.waitFor((s) => s.phase !== 'INFO_CHECK', 'band draft', 40000);
  const picked = new Set();
  const t0 = Date.now();
  while (picked.size < 2 && Date.now() - t0 < 120000) {
    for (const c of [host, guest]) {
      const s = await c.st();
      if (s.phase !== 'BAND_DRAFT') { picked.add(c.label); continue; }
      if (picked.has(c.label) || s.draft?.turn !== s.me) continue;
      await c.click('.dband:not(.is-taken)', null, { nth: c === host ? 2 : 5 });
      await sleep(200);
      await c.click('.draft-detail__btns .btn--primary', '确认选择');
      picked.add(c.label);
    }
    await sleep(250);
  }
  // error toasts from here on (返回战场 of a leaker must not raise one)
  for (const c of [host, guest]) {
    await c.page.evaluate(() => {
      globalThis.__toastErrors = [];
      new MutationObserver(() => {
        for (const t of document.querySelectorAll('.toast--error .toast__text')) {
          if (!t.dataset.seen) { t.dataset.seen = '1'; globalThis.__toastErrors.push(t.textContent); }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
  }
  return { host, guest };
}

/** A teammate's row → 前往查看 (team panel). */
async function watchMate(c, name) {
  const pt = await c.page.evaluate((name) => {
    for (const row of document.querySelectorAll('.team__row')) {
      if (!(row.querySelector('.team__name')?.textContent || '').includes(name)) continue;
      const b = row.querySelector('.team__btn').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }
    return null;
  }, name);
  assert.ok(pt, `${c.label}: ${name}'s row`);
  await c.page.mouse.click(pt.x, pt.y);
  assert.ok(await c.click('.team__ob', '前往查看', { timeout: 4000, optional: true }), `${c.label}: 前往查看 on ${name}`);
}

/** Every player's name and bond ids (count, layers or active), the field listing, the 联防 helpers. */
const matchView = (c) => c.page.evaluate(() => {
  const s = globalThis.__SP__.store.get();
  const pub = s.match.public;
  const ids = (list) => (list || []).filter((b) => b.count > 0 || b.layers > 0 || b.active).map((b) => b.bondId).sort();
  return {
    me: s.me.playerId,
    names: Object.fromEntries(pub.players.map((p) => [p.playerId, p.name])),
    bonds: Object.fromEntries(pub.players.map((p) => [p.name, ids(p.playerId === s.me.playerId && s.match.private ? s.match.private.bonds : p.bonds)])),
    fields: (pub.fields || []).map((f) => ({ fieldId: f.fieldId, kind: f.kind, players: f.players })),
    field: s.match.field ? { fieldId: s.match.field.fieldId, sides: s.match.field.sides || null } : null,
  };
});
const ownerIs = (c, name) => c.page.waitForFunction((name) => (document.querySelector('.gm__bonds .bstrip')?.getAttribute('data-owner') ?? null) === name, { timeout: 6000 }, name);

describe('DESIGN §20.15 — the bond strip shows the watched teammate\'s bonds (real server)', { skip: !ENABLED && 'set SP_E2E=1 (Chrome + public/assets)' }, () => {
  test('prep scouting and the Final Assault ‹ › halves (desktop host, phone guest)', { timeout: 8 * 60 * 1000 }, async () => {
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 'boss', chess: [...HOST_KIT, ...GUEST_KIT] } });
    const P = (await import('puppeteer-core')).default;
    const host = new Client(P, srv.base, 'host', { prefix: 'watch-bonds', w: 1280, h: 720 });
    // the guest deploys on a desktop-sized window (the phone's shop bar covers the bench), then turns into the phone
    const guest = new Client(P, srv.base, 'guest', { prefix: 'watch-bonds-phone', w: 1280, h: 720 });
    try {
      await host.open();
      await host.enter('凯尔希');
      await host.click('.mode-card', '同盟模拟');
      await host.click('.diff-card', '标准模拟');
      await host.click('.create-box button', '创建同盟');
      const room = (await host.waitFor((s) => !!s.room?.code, 'room created')).room;
      await guest.open(`?room=${room.code}`);
      await guest.enter('阿米娅');
      await guest.waitFor((s) => s.room?.code === room.code, 'guest joined');
      const guestReady = () => guest.page.evaluate(() => {
        const s = globalThis.__SP__.store.get();
        return !!s.room?.seats?.find((x) => x && x.playerId === s.me.playerId)?.ready;
      });
      for (let i = 0; i < 6 && !(await guestReady()); i++) {
        await guest.click('.room-bar__right button', '准备就绪', { optional: true, timeout: 3000 });
        await sleep(600);
      }
      assert.ok(await guestReady(), 'guest ready');
      await host.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      for (const c of [host, guest]) await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      for (const c of [host, guest]) await c.click('.brief__foot .btn--primary', '准备就绪');
      for (const c of [host, guest]) await c.waitFor((s) => s.phase !== 'INFO_CHECK', 'band draft', 40000);
      const picked = new Set();
      const t0 = Date.now();
      while (picked.size < 2 && Date.now() - t0 < 120000) {
        for (const c of [host, guest]) {
          const s = await c.st();
          if (s.phase !== 'BAND_DRAFT') { picked.add(c.label); continue; }
          if (picked.has(c.label) || s.draft?.turn !== s.me) continue;
          await c.click('.dband:not(.is-taken)', null, { nth: c === host ? 2 : 5 });
          await sleep(200);
          await c.click('.draft-detail__btns .btn--primary', '确认选择');
          picked.add(c.label);
        }
        await sleep(250);
      }
      for (const c of [host, guest]) await c.waitFor((s) => s.phase === 'PREP' && !s.ready && s.hand >= 4, 'boss-round prep with the kit', 60000);
      await sleep(1800);
      for (const id of HOST_KIT) await place(host, id);
      for (const id of GUEST_KIT) await place(guest, id);
      await sleep(800);

      // ---- prep: the host's own strip, then the guest's board (前往查看) -------------------------------------------
      const hostOwn = await bondsOf(host, '凯尔希');
      const guestPub = await bondsOf(host, '阿米娅');
      assert.ok(hostOwn.ids.length && guestPub.ids.length, `both have bonds (${hostOwn.ids} / ${guestPub.ids})`);
      assert.notDeepEqual(hostOwn.ids, guestPub.ids, 'different kits, different bonds');
      let st = await stripOf(host);
      assert.deepEqual([st.owner, st.other, st.bonds], [null, false, hostOwn.ids], 'prep, own board: the host\'s own bonds');
      await host.click('.team__row:not(.is-self) .team__btn', null, { nth: 0 });
      assert.ok(await host.click('.team__ob', '前往查看', { optional: true, timeout: 3000 }), 'host: 前往查看 in prep');
      await host.page.waitForSelector('.gm__watching', { timeout: 6000 });
      await host.page.waitForFunction(() => document.querySelector('.gm__bonds .bstrip')?.getAttribute('data-owner') === '阿米娅', { timeout: 6000 });
      st = await stripOf(host);
      assert.deepEqual([st.owner, st.other, st.bonds], ['阿米娅', true, guestPub.ids], 'scouting: the GUEST\'s bonds');
      for (const id of st.bonds) assert.equal(st.counts[id], guestPub.counts[id], `${id}: the guest's member count`);
      assert.match(st.tag, /阿米娅/, 'the 👁 name tag');
      // the popup of one of them is the guest's too
      await host.click(`.gm__bonds .bslot[data-bond="${st.bonds[0]}"] .bond`, null, { any: true });
      await host.page.waitForSelector('.bpop[data-owner="阿米娅"]', { timeout: 4000 });
      const pop = await host.page.evaluate(() => ({ owner: document.querySelector('.bpop__owner')?.textContent || '', facts: document.querySelector('.bpop__facts')?.textContent || '' }));
      assert.match(pop.owner, /阿米娅.*的盟约/);
      await host.shot('prep-scout');
      await host.page.keyboard.press('Escape');
      await host.click('.gm__watching button', '返回自己');
      await host.page.waitForFunction(() => !document.querySelector('.gm__bonds .bstrip')?.getAttribute('data-owner'), { timeout: 6000 });
      st = await stripOf(host);
      assert.deepEqual([st.owner, st.bonds], [null, hostOwn.ids], '返回自己: the host\'s own bonds again');

      // ---- Final Assault: the pair field's halves (the guest on the user's phone, 756×366 CSS px) ----------------------
      await guest.page.setViewport({ width: 756, height: 366 });
      guest.w = 756;
      guest.h = 366;
      for (const c of [host, guest]) {
        if (!(await c.st()).ready) await c.click('.readybtn');
      }
      for (const c of [host, guest]) await c.waitFor((s) => s.phase === 'FINAL_ASSAULT', 'Final Assault', 60000);
      for (const c of [host, guest]) await c.page.waitForSelector('.chud__layers', { timeout: 20000 });
      await sleep(1200);
      const pair = await host.page.evaluate(() => {
        const f = globalThis.__SP__.store.get().match.field;
        return { fieldId: f?.fieldId, sides: f?.sides || null, me: globalThis.__SP__.store.get().me.playerId };
      });
      assert.ok(pair.sides && Object.keys(pair.sides).length === 2, `one pair field with both (${JSON.stringify(pair)})`);
      const hostSide = pair.sides[pair.me];
      st = await stripOf(host);
      assert.deepEqual([st.owner, st.bonds], [null, hostOwn.ids], '全景: the host\'s own bonds');
      // a card's bond chip on the shared field (review): on 全景 (the strip is the host's) the GUEST's operator's chip
      // opens the GUEST's bond — labelled, with the guest's count, the same number the chip shows
      const guestId = Object.keys(pair.sides).find((id) => id !== pair.me);
      let chip = await chipPopup(host, guestId);
      assert.ok(chip, 'host: a card of the guest\'s operator and its bond chip');
      const guestNow = await bondsOf(host, '阿米娅');
      assert.equal(chip.owner, '阿米娅', `全景: the guest's unit chip opens the guest's popup (${JSON.stringify(chip)})`);
      assert.match(chip.tag, /阿米娅.*的盟约/);
      assert.equal(chip.count, guestNow.counts[chip.bondId] ?? '0', `the guest's member count (${JSON.stringify({ chip, guestNow })})`);
      if (!chip.off) assert.equal(chip.chipCount, chip.count, 'the chip and its popup agree');
      if (Number(chip.count) > 0) assert.ok(chip.on >= 1, `the guest's operators in play are listed as members (${JSON.stringify(chip)})`);
      st = await stripOf(host);
      assert.equal(st.owner, null, 'the strip stays the host\'s on 全景');
      await host.shot('fa-chip-partner');
      await closeCard(host);
      /** Step the ‹ › pill to `key` ('L' | 'ALL' | 'R') from 全景. */
      const toLayer = async (c, key) => {
        const arrow = key === 'L' ? '左侧战场' : '右侧战场';
        if (key !== 'ALL') await c.click(`.chud__layers .vswitch__arrow[aria-label="${arrow}"]`);
        await sleep(500);
      };
      const back = async (c, key) => { if (key !== 'ALL') await c.click(`.chud__layers .vswitch__arrow[aria-label="${key === 'L' ? '右侧战场' : '左侧战场'}"]`); await sleep(400); };
      const partnerSide = hostSide === 'L' ? 'R' : 'L';
      await toLayer(host, partnerSide);
      await host.page.waitForFunction(() => document.querySelector('.gm__bonds .bstrip')?.getAttribute('data-owner') === '阿米娅', { timeout: 4000 });
      st = await stripOf(host);
      assert.deepEqual([st.owner, st.bonds], ['阿米娅', guestPub.ids], 'the partner\'s half: the GUEST\'s bonds');
      assert.ok(st.tagFont >= 10, `desktop: the name is legible (${st.tagFont} px)`);
      await host.shot('fa-partner-half');
      // the reverse: on the partner's half (the strip is the guest's) the host's OWN operator's chip opens the host's bond
      chip = await chipPopup(host, pair.me);
      assert.ok(chip, 'host: a card of its own operator and its bond chip');
      const hostNow = await bondsOf(host, '凯尔希');
      assert.equal(chip.owner, null, `the partner's half: an own unit's chip opens the host's own popup (${JSON.stringify(chip)})`);
      assert.equal(chip.tag, '');
      assert.equal(chip.count, hostNow.counts[chip.bondId] ?? '0', `the host's member count (${JSON.stringify({ chip, hostNow })})`);
      if (!chip.off) assert.equal(chip.chipCount, chip.count, 'the chip and its popup agree');
      st = await stripOf(host);
      assert.equal(st.owner, '阿米娅', 'the strip stays the guest\'s on that half');
      await closeCard(host);
      await back(host, partnerSide);
      await toLayer(host, hostSide);
      st = await stripOf(host);
      assert.deepEqual([st.owner, st.bonds], [null, hostOwn.ids], 'the own half ("你自己"): the host\'s bonds');

      // the phone: the guest looks at the host's half
      const guestSide = hostSide === 'L' ? 'R' : 'L';
      st = await stripOf(guest);
      assert.equal(st.owner, null, 'guest, 全景: own bonds');
      await toLayer(guest, hostSide);
      await guest.page.waitForFunction(() => document.querySelector('.gm__bonds .bstrip')?.getAttribute('data-owner') === '凯尔希', { timeout: 4000 });
      st = await stripOf(guest);
      assert.deepEqual([st.owner, st.bonds], ['凯尔希', hostOwn.ids], 'phone: the partner\'s half shows the HOST\'s bonds');
      assert.ok(st.tagRect && st.tagRect.left >= 0 && st.tagRect.right <= st.vw && st.tagRect.top >= 0 && st.tagRect.bottom <= st.vh, `phone: the tag is on screen (${JSON.stringify(st.tagRect)})`);
      assert.ok(st.rect.right <= st.vw + 1, `phone: the strip stays inside the viewport (${JSON.stringify(st.rect)})`);
      assert.ok(st.tagFont >= 9, `phone: the name is legible (${st.tagFont} px)`);
      if (st.team) {
        const overlap = !(st.tagRect.right <= st.team.left || st.tagRect.left >= st.team.right || st.tagRect.bottom <= st.team.top || st.tagRect.top >= st.team.bottom);
        assert.ok(!overlap, `phone: the tag is clear of the team panel (${JSON.stringify({ tag: st.tagRect, team: st.team })})`);
      }
      await guest.shot('fa-partner-half');
      await back(guest, hostSide);
      await toLayer(guest, guestSide);
      st = await stripOf(guest);
      assert.equal(st.owner, null, 'phone, own half: own bonds');
      assert.deepEqual(problemsOf([host, guest]), []);
    } finally {
      for (const c of [host, guest]) if (c.problems.length) console.log(c.label, c.problems.slice(0, 20).join('\n'));
      await host.close();
      await guest.close();
      await srv.stop();
    }
  });

  test('联防 observer: helper 1 on 全景, the picked helper\'s half + bonds, 返回战场 in the pill (phone leaker, desktop helper)', { timeout: 15 * 60 * 1000 }, async () => {
    // the host fights with a 萨尔贡 kit, the AI with a 拉特兰 kit, the guest has no board (every enemy leaks)
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 3, idleBots: true, autoPlace: true,
      kits: [UNITE_HOST_KIT, []], botChess: BOT_KIT } });
    const P = (await import('puppeteer-core')).default;
    let host = null;
    let guest = null;
    try {
      ({ host, guest } = await coopMatch(P, srv.base, { bots: 1, prefix: 'watch-bonds-unite' }));
      // up to three rounds: the guest (no board — fastServer keeps a band's gift operators in its hand) leaks; a 联防
      // needs the host and the AI perfect (random waves). Only a 联防 of exactly those two helpers counts (review: the
      // guest must be the leaker, not a helper)
      let after = null;
      let found = false;
      for (let round = 3; round <= 5 && !found; round++) {
        for (const c of [host, guest]) await c.waitFor((s) => s.phase === 'PREP' && s.round === round, `round-${round} prep`, 120000);
        await sleep(1500);
        for (const c of [host, guest]) if (!(await c.st()).ready) await c.click('.readybtn');
        after = await guest.waitFor((s) => s.phase === 'UNITE' || s.phase === 'SETTLE' || (s.phase === 'PREP' && s.round > round), '联防', 300000);
        const mv0 = after.phase === 'UNITE' ? await matchView(guest) : null;
        const u0 = mv0 ? mv0.fields.find((f) => f.fieldId === 'u') : null;
        if (u0 && u0.players.length === 2 && !u0.players.includes(mv0.me)) { found = true; break; }
        console.log(`round ${round}: no 2-helper 联防 without the guest (${after.phase} ${JSON.stringify(mv0 ? mv0.fields : after.fields)}), next round`);
        await guest.waitFor((s) => s.phase !== 'UNITE', '联防 over', 300000);
      }
      assert.ok(found && after.phase === 'UNITE', `the guest leaked and two helpers were perfect (${JSON.stringify(after.fields)})`);
      await guest.page.waitForSelector('.chud__layers', { timeout: 15000 });
      const mv = await matchView(guest);
      const u = mv.fields.find((f) => f.fieldId === 'u');
      assert.ok(u && u.players.length === 2 && !u.players.includes(mv.me), `a 2-helper 联防 without the guest (${JSON.stringify(mv.fields)})`);
      const [h1, h2] = u.players.map((pid) => mv.names[pid]);
      // 全景: helper 1's bonds, tagged — not the leaker's own
      await ownerIs(guest, h1);
      let st = await stripOf(guest);
      assert.deepEqual([st.owner, st.other, st.bonds, st.pill], [h1, true, mv.bonds[h1], '全景'], 'leaker on 全景: helper 1');
      await sleep(800);
      await guest.shot('overview');
      // the host (helper 1 or 2) on 全景: its own bonds
      const hs = await stripOf(host);
      assert.equal(hs.owner, null, 'the helper on 全景: own bonds');
      // the guest picks each helper: the camera goes to their half, pill and strip agree, 返回战场 in the pill
      for (const name of [h2, h1]) {
        assert.equal((await guest.st()).phase, 'UNITE', '联防 still running');
        await watchMate(guest, name);
        await ownerIs(guest, name);
        await guest.page.waitForFunction((name) => (document.querySelector('.chud__layers .vswitch__label')?.textContent || '').includes(name), { timeout: 6000 }, name);
        st = await stripOf(guest);
        assert.deepEqual([st.owner, st.bonds, st.observe], [name, mv.bonds[name], null], `picked ${name}: their bonds, no separate observing pill`);
        assert.ok(st.pill.includes(name) && st.pillBack, `the ‹ › pill names ${name} and carries 返回战场 (${st.pill})`);
        assert.ok(st.tagRect && st.tagRect.left >= 0 && st.tagRect.right <= st.vw && st.tagFont >= 9, `phone: the tag on screen, legible (${JSON.stringify(st.tagRect)} ${st.tagFont}px)`);
        await sleep(900); // the camera flies to the half (750 ms)
        await guest.shot(`picked-${name === mv.names[u.players[0]] ? 'helper1' : 'helper2'}`);
      }
      // 返回战场: no refused g.watch (no own field in 联防), the 联防 view stays with a helper's bonds
      await guest.click('.chud__layers .chud__back', '返回战场');
      await sleep(1200);
      st = await stripOf(guest);
      assert.ok(st.owner === h1 || st.owner === h2, `back: still a helper's bonds (${st.owner})`);
      assert.equal(st.pillBack, false, 'back: the pill without 返回战场');
      assert.deepEqual(await guest.page.evaluate(() => globalThis.__toastErrors), [], 'no error toast');
      assert.deepEqual(problemsOf([host, guest]), []);
    } finally {
      for (const c of [host, guest]) if (c?.problems.length) console.log(c.label, c.problems.slice(0, 20).join('\n'));
      await host?.close();
      await guest?.close();
      await srv.stop();
    }
  });

  test('after the own battle: the watched teammate\'s bonds, kept through a reload with the observing pill + 返回战场 (desktop)', { timeout: 12 * 60 * 1000 }, async () => {
    // the host's five 萨尔贡 operators end their battle first; the guest (no board) leaks, and its enemies spawn at twice
    // their times (fastServer SP_SLOW_SPAWNS), so its battle runs to the round's time limit — a window of 40 s and more
    // for watching it and a reload (at the scheduled times a leaker's walk outlasted the host's battle by 5–11 s in 0.2.1
    // and 0.2.2 alike, and the 0.2.2 full pass lost 返回战场 to 联防); the host watches the guest, reloads, then goes back
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 1, startRound: 3, idleBots: true, autoPlace: true,
      kits: [AFTER_HOST_KIT, []], slowSpawns: '1:2' } });
    const P = (await import('puppeteer-core')).default;
    let host = null;
    let guest = null;
    try {
      ({ host, guest } = await coopMatch(P, srv.base, { bots: 1, prefix: 'watch-bonds-after' }));
      let checked = false;
      for (let round = 3; round <= 5 && !checked; round++) {
        for (const c of [host, guest]) await c.waitFor((s) => s.phase === 'PREP' && s.round === round, `round-${round} prep`, 180000);
        await sleep(1500);
        for (const c of [host, guest]) if (!(await c.st()).ready) await c.click('.readybtn');
        await host.waitFor((s) => s.phase === 'COMBAT', 'combat', 60000);
        // the own battle over while a teammate's still runs (at 1× it may last longer than the browser's 90 s protocol
        // timeout, which cut a plain page.waitForFunction off with a bare "Waiting failed")
        const target = await waitForFunctionLong(host.page, () => {
          const s = globalThis.__SP__.store.get();
          const pub = s.match.public;
          if (pub?.phase !== 'COMBAT') return { gone: true };
          const me = s.me.playerId;
          const b = s.match.battle;
          const mine = pub.players.find((p) => p.playerId === me);
          if (!(mine?.status === 'done' || (b && b.fieldId === `n:${me}` && b.done))) return false;
          const live = pub.fields.filter((f) => f.kind === 'normal' && f.live && f.players[0] !== me);
          if (!live.length) return { gone: true };
          const pick = live.find((f) => !pub.players.find((p) => p.playerId === f.players[0])?.isBot) || live[0];
          return { fieldId: pick.fieldId, playerId: pick.players[0], name: pub.players.find((p) => p.playerId === pick.players[0]).name };
        }, { timeout: 240000, polling: 250 }).then((h) => h.jsonValue());
        if (target.gone) { console.log(`round ${round}: no teammate battle left to watch, next round`); continue; }
        const name = target.name;
        await watchMate(host, name);
        await ownerIs(host, name);
        const pubBonds = async () => (await matchView(host)).bonds[name];
        let st = await stripOf(host);
        // every bond the teammate's view lists is on the strip (live in-battle gains may add more)
        for (const id of await pubBonds()) assert.ok(st.bonds.includes(id), `${name}'s ${id} on the strip (${JSON.stringify(st.bonds)})`);
        assert.ok((st.observe || '').includes(name), `the observing pill names ${name} (${st.observe})`);
        assert.ok(await host.page.$('.chud__observe .chud__back'), '返回战场 in the observing pill');
        // the replica on screen (the strip follows the watch at once; the field arrives with its b.start)
        const onScreen = await host.page.waitForFunction((fid) => {
          const s = globalThis.__SP__.store.get();
          if (s.match.public?.phase !== 'COMBAT') return { gone: true };
          return s.match.battle && !s.match.battle.loading && s.match.battle.fieldId === fid ? { ok: true } : false;
        }, { timeout: 30000, polling: 250 }, target.fieldId).then((h) => h.jsonValue());
        if (onScreen.gone) { console.log(`round ${round}: the battles ended while the replica loaded, next round`); continue; }
        assert.equal((await stripOf(host)).owner, name, 'the replica on screen: still their bonds');
        await sleep(600);
        await host.shot('watching');
        // a reload while watching (pre-existing gap, review): the resent field is adopted — strip, pill and 返回战场
        const before = host.problems.length;
        await host.page.reload({ waitUntil: 'domcontentloaded' });
        await host.page.waitForFunction(() => !!globalThis.__SP__ && !!document.querySelector('.screen'), { timeout: 30000 });
        const resumed = await host.page.waitForFunction((fid) => {
          const s = globalThis.__SP__.store.get();
          if (s.match.public && s.match.public.phase !== 'COMBAT') return { gone: true };
          return s.match.battle && !s.match.battle.loading && s.match.battle.fieldId === fid && document.querySelector('.gm__bonds .bstrip') ? { ok: true } : false;
        }, { timeout: 60000, polling: 250 }, target.fieldId).then((h) => h.jsonValue());
        host.problems.splice(before, Infinity, ...host.problems.slice(before).filter((p) => !/ERR_ABORTED/.test(p)));
        if (resumed.gone) { console.log(`round ${round}: the battles ended during the reload, next round`); continue; }
        await ownerIs(host, name);
        await host.page.waitForFunction((name) => (document.querySelector('.chud__observe .vswitch__label')?.textContent || '').includes(name), { timeout: 8000 }, name);
        assert.ok(await host.page.$('.chud__observe .chud__back'), 'after the reload: 返回战场 again');
        assert.equal(await host.page.$('.chud__wait'), null, 'after the reload: no "等待队友" message in place of the observing pill');
        st = await stripOf(host);
        for (const id of await pubBonds()) assert.ok(st.bonds.includes(id), `after the reload: ${name}'s ${id} on the strip (${JSON.stringify(st.bonds)})`);
        await sleep(1500); // the phase banner of the fresh screen
        await host.shot('reloaded');
        // 返回战场 → the own bonds, untagged. The watched battle may end meanwhile — 联防 or the settlement takes the
        // screen and the pill with it (the 0.2.2 full pass) — then the next round tries again
        if (!(await host.click('.chud__observe .chud__back', '返回战场', { optional: true, timeout: 8000 }))) {
          const phase = (await host.st()).phase;
          if (phase !== 'COMBAT') { console.log(`round ${round}: the battles ended before 返回战场 (${phase}), next round`); continue; }
          throw new Error('host: nothing clickable for .chud__observe .chud__back "返回战场" while the battle runs');
        }
        await host.page.waitForFunction(() => !document.querySelector('.gm__bonds .bstrip')?.getAttribute('data-owner'), { timeout: 8000 });
        st = await stripOf(host);
        assert.deepEqual([st.owner, st.observe], [null, null], 'back: own bonds, no observing pill');
        const fid = await host.page.evaluate(() => globalThis.__SP__.store.get().match.battle?.fieldId ?? null);
        const me = (await host.st()).me;
        if ((await host.st()).phase === 'COMBAT') assert.equal(fid, `n:${me}`, 'back: the own battle on screen');
        checked = true;
      }
      assert.ok(checked, 'a teammate\'s battle was watched, reloaded and left');
      assert.deepEqual(problemsOf([host, guest]), []);
    } finally {
      for (const c of [host, guest]) if (c?.problems.length) console.log(c.label, c.problems.slice(0, 20).join('\n'));
      await host?.close();
      await guest?.close();
      await srv.stop();
    }
  });

  /** The official 协议已失效 dialog (ui/downedPlate.js) a player sees when their own LP runs out while the team plays on:
   * 继续观战 closes it (a no-op when it is not open). */
  async function continueWatching(c) {
    const btn = await c.page.waitForSelector('[data-testid="downed-plate"] ~ .downm__btns .downm__btn--watch, .downm__btn--watch', { timeout: 4000 }).catch(() => null);
    if (btn) { await btn.click(); await c.page.waitForFunction(() => !document.querySelector('[data-testid="downed-plate"]'), { timeout: 5000 }).catch(() => {}); }
  }

  test('Final Assault spectator (eliminated): the pair\'s first player, each picked player\'s half + bonds, the lone field', { timeout: 8 * 60 * 1000 }, async () => {
    // boss pairs by seat (fastServer SP_SEAT_PAIRS): the eliminated guest follows the host (the first player still in,
    // MatchWatch._watchTargetOf), and under the random pairs of 0.2.5 the host fought alone in one match of three — the
    // guest then watched the lone field, which has no ‹ › pill
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 'boss', idleBots: true, autoPlace: true,
      kits: [UNITE_HOST_KIT, []], botChess: BOT_KIT, eliminate: [1], seatPairs: true } });
    const P = (await import('puppeteer-core')).default;
    let host = null;
    let guest = null;
    try {
      ({ host, guest } = await coopMatch(P, srv.base, { bots: 2, prefix: 'watch-bonds-fa' }));
      await host.waitFor((s) => s.phase === 'PREP' && !s.ready, 'boss-round prep', 60000);
      assert.equal((await guest.st()).alive, false, 'the guest is eliminated');
      await sleep(1500);
      await host.click('.readybtn');
      for (const c of [host, guest]) await c.waitFor((s) => s.phase === 'FINAL_ASSAULT', 'Final Assault', 90000);
      // the eliminated guest answers the official 协议已失效 dialog (PR #705) with 继续观战 before watching
      await continueWatching(guest);
      await guest.page.waitForSelector('.chud__layers', { timeout: 20000 });
      await sleep(1000);
      const mv = await matchView(guest);
      const pair = mv.fields.find((f) => f.players.length === 2);
      const lone = mv.fields.find((f) => f.players.length === 1);
      assert.ok(pair && lone && mv.field?.fieldId === mv.fields[0].fieldId, `a pair field and a lone one, the first auto-observed (${JSON.stringify(mv)})`);
      assert.equal(pair.fieldId, mv.fields[0].fieldId, 'the pair field is listed first');
      const first = mv.names[pair.players[0]];
      await ownerIs(guest, first);
      let st = await stripOf(guest);
      assert.deepEqual([st.owner, st.bonds, st.pill], [first, mv.bonds[first], '全景'], 'auto-observed pair, 全景: the first player (never the spectator\'s own)');
      await guest.shot('auto');
      // a card's bond chip (review): the strip follows the first player, the SECOND player's operator's chip opens the
      // second player's bond (labelled, their count — the number the chip shows), the strip stays on the first
      const second = mv.names[pair.players[1]];
      const chip = await chipPopup(guest, pair.players[1]);
      assert.ok(chip, `spectator: a card of ${second}'s operator and its bond chip`);
      const secondNow = await bondsOf(guest, second);
      assert.equal(chip.owner, second, `全景: ${second}'s unit chip opens ${second}'s popup (${JSON.stringify(chip)})`);
      assert.equal(chip.count, secondNow.counts[chip.bondId] ?? '0', `${second}'s member count (${JSON.stringify({ chip, secondNow })})`);
      if (!chip.off) assert.equal(chip.chipCount, chip.count, 'the chip and its popup agree');
      if (Number(chip.count) > 0) assert.ok(chip.on >= 1, `${second}'s operators in play are listed as members (${JSON.stringify(chip)})`);
      assert.equal((await stripOf(guest)).owner, first, 'the strip stays on the first player');
      await guest.shot('chip-second');
      await closeCard(guest);
      for (const pid of [pair.players[1], pair.players[0]]) {
        const name = mv.names[pid];
        await watchMate(guest, name);
        await ownerIs(guest, name);
        await guest.page.waitForFunction((name) => (document.querySelector('.chud__layers .vswitch__label')?.textContent || '').includes(name), { timeout: 6000 }, name);
        st = await stripOf(guest);
        assert.deepEqual([st.owner, st.bonds, st.pillBack], [name, mv.bonds[name], false], `picked ${name}: their half and bonds (no 返回战场 when eliminated)`);
      }
      await sleep(900); // the camera flies to the half (750 ms)
      await guest.shot('picked');
      const loneName = mv.names[lone.players[0]];
      await watchMate(guest, loneName);
      await ownerIs(guest, loneName);
      await guest.page.waitForFunction((name) => (document.querySelector('.chud__observe .vswitch__label')?.textContent || '').includes(name), { timeout: 8000 }, loneName);
      st = await stripOf(guest);
      assert.deepEqual([st.owner, st.bonds, st.observe], [loneName, mv.bonds[loneName], loneName], 'the lone field: its player, the observing pill names them');
      // the host on its pair field, 全景: own
      st = await stripOf(host);
      assert.equal(st.owner, null, 'the host on 全景: own bonds');
      assert.deepEqual(problemsOf([host, guest]), []);
    } finally {
      for (const c of [host, guest]) if (c?.problems.length) console.log(c.label, c.problems.slice(0, 20).join('\n'));
      await host?.close();
      await guest?.close();
      await srv.stop();
    }
  });
});
