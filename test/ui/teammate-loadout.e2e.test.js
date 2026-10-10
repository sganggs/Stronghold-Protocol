// Real-server browser E2E (DESIGN §16): scouting a teammate's board in prep (前往查看) shows THAT player's operator
// loadout in the detail card — not the viewer's, not the defaults. The guest picks S1 骑枪刺击 + 不装备 for 野鬃 in the
// room's 干员调配 and places the elite; the host (no loadout: default S2 + the default module) opens the guest's board
// and right-clicks the unit: the card must read S1 (已调配) and 未装备模组, with the no-module ATK.
// Unit/integration counterpart: test/match/teammate-loadout.test.js.
//
//   SP_E2E=1 node --test test/ui/teammate-loadout.e2e.test.js
//
// Screenshots: test/e2e/out/teammate-loadout-*.png.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, sleep, hasChrome, startRealServer, problemsOf } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const BASE = 'chess_char_1_19_a';
const ELITE = 'chess_char_1_19_b'; // elite 野鬃: default S2 + 长枪替补套装

/** The open detail card (or null within `timeout`). */
const readCard = (c, timeout = 2500) => c.page.waitForSelector('.dpanel .dskill__name', { timeout }).then(() => c.page.evaluate(() => ({
  skill: document.querySelector('.dpanel .dskill__name')?.textContent || '',
  tag: !!document.querySelector('.dpanel .dskill__name .dtag-loadout'),
  module: document.querySelector('.dpanel .dmodule')?.textContent || '',
  none: !!document.querySelector('.dpanel .dmodule.is-none'),
  // the record (base) value: a live card (user playtest #4 item 7) carries it as the cell's title "基础 N"
  stats: Object.fromEntries([...document.querySelectorAll('.dpanel .dstat')].map((el) => [el.querySelector('.dstat__k')?.textContent,
    (el.getAttribute('title') || '').replace(/^基础 /, '') || el.querySelector('.dstat__v')?.textContent])),
}))).catch(() => null);

describe('DESIGN §16 — a teammate\'s unit shows its owner\'s loadout (real server)', { skip: !ENABLED && 'set SP_E2E=1 (Chrome + public/assets)' }, () => {
  test('前往查看 in prep: the guest\'s 野鬃 (S1 + 不装备) reads S1 已调配 / 未装备模组 on the host\'s card', { timeout: 6 * 60 * 1000 }, async () => {
    const chess = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
    const rec = (Array.isArray(chess) ? chess : Object.values(chess.chess || chess)).find((x) => x && x.chessId === ELITE);
    const s1 = rec.skills.find((s) => s.index === 0);
    const sDef = rec.skills.find((s) => s.isDefault);
    assert.notEqual(sDef.index, 0, 'S1 is not the default skill');
    assert.notEqual(rec.stats.atk, rec.statsBase.atk, 'the default module changes ATK');

    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 1, chess: [ELITE] } });
    const P = (await import('puppeteer-core')).default;
    const host = new Client(P, srv.base, 'host', { prefix: 'teammate-loadout' });
    const guest = new Client(P, srv.base, 'guest', { prefix: 'teammate-loadout', w: 1280, h: 720 });
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

      // the guest's 干员调配 (room screen): 野鬃 → S1 + 不装备, synced
      await guest.click('[data-testid="loadout-open"]');
      await guest.page.waitForSelector('.lo .lo-card', { visible: true, timeout: 15000 });
      await guest.click('.lo-search input');
      await guest.page.keyboard.type('野鬃');
      await guest.page.waitForFunction(() => document.querySelectorAll('.lo-card').length === 1, { timeout: 5000 });
      await guest.click('.lo-card__pick');
      // the row's quick choices (0.2.2: the roster is one list, a row per operator with its skills and the elite's
      // modules; the detail's own module cards sit below the fold) — the row and the detail agree on S1 + 不装备
      await guest.click('.lo-card .lo-q--skill[data-skill="0"]');
      await guest.click('.lo-card .lo-q--mod[data-module="none"]');
      await guest.page.waitForFunction(() => document.querySelector('.lo-card .lo-q--skill[data-skill="0"]')?.getAttribute('aria-pressed') === 'true'
        && document.querySelector('.lo-card .lo-q--mod[data-module="none"]')?.getAttribute('aria-pressed') === 'true'
        && document.querySelector('.lo-detail .lo-skill.is-on[data-skill="0"]') && document.querySelector('.lo-detail .lo-mod.is-on[data-module="none"]'), { timeout: 3000 });
      await guest.page.waitForFunction(() => /已同步/.test(document.querySelector('.lo-sync')?.textContent || ''), { timeout: 8000 });
      await guest.page.keyboard.press('Escape');
      await guest.page.waitForFunction(() => !document.querySelector('.lo'), { timeout: 3000 });

      // ready (the first click after the overlay closed can land while it fades out: click until the seat is ready)
      const guestReady = () => guest.page.evaluate(() => {
        const s = globalThis.__SP__.store.get();
        return !!s.room?.seats?.find((x) => x && x.playerId === s.me.playerId)?.ready;
      });
      for (let i = 0; i < 5 && !(await guestReady()); i++) {
        await sleep(500);
        await guest.click('.room-bar__right button', '准备就绪', { optional: true, timeout: 3000 });
        await sleep(500);
      }
      assert.ok(await guestReady(), 'guest ready');
      await host.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      for (const c of [host, guest]) await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      const loOf = (c) => c.page.evaluate(() => globalThis.__SP__.store.get().match.private?.loadout ?? null);
      assert.deepEqual(await loOf(guest), { [BASE]: { skill: 0, module: 'none' } }, 'the guest\'s match loadout');
      assert.deepEqual(await loOf(host), {}, 'the host fights with the defaults');
      for (const c of [host, guest]) await c.click('.brief__foot .btn--primary', '准备就绪');
      // the draft first (a client still in the briefing would count as done without picking: its turn then runs out —
      // Match.BAND_TURN_SECONDS, 50 s each since the 2026-10-10 official-play report)
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
      for (const c of [host, guest]) await c.waitFor((s) => s.phase === 'PREP' && !s.ready && s.hand > 0, 'prep with the starter kit', 60000);
      await sleep(1800);

      // the guest places its elite (drag → direction wheel)
      const [piece] = (await guest.handPieces('chess')).filter((p) => p.id === ELITE);
      assert.ok(piece, 'the elite 野鬃 is in the guest\'s hand');
      const tile = await guest.freeTileFor(piece.uid);
      assert.ok(tile, 'a legal tile');
      await guest.drag(await guest.piecePoint(piece.uid), await guest.tilePoint(tile.row, tile.col));
      await guest.page.waitForSelector('.fwheel__dia', { timeout: 4000 });
      await guest.swipe('RIGHT');
      await guest.waitFor((s) => s.board > 0, 'placed', 8000);

      // the host scouts the guest (前往查看) — the scouting m.field carries the guest's loadout
      await host.click('.team__row:not(.is-self) .team__btn', null, { nth: 0 });
      assert.ok(await host.click('.team__ob', '前往查看', { optional: true, timeout: 3000 }), 'host: 前往查看 in prep');
      await host.page.waitForSelector('.gm__watching', { timeout: 6000 });
      const unit = await host.page.waitForFunction((uid) => {
        const f = globalThis.__SP__.store.get().match.field;
        const u = f && f.prep ? (f.units || []).find((x) => x.uid === uid) : null;
        return u ? { skillIndex: u.skillIndex ?? null, moduleId: u.moduleId ?? null, ownerId: u.ownerId } : false;
      }, { timeout: 8000, polling: 100 }, piece.uid).then((h) => h.jsonValue());
      assert.deepEqual([unit.skillIndex, unit.moduleId], [0, 'none'], 'm.field (prep scouting) unit loadout');
      await sleep(1200); // camera flight + the scouted board
      // the renderer keeps them on its unit info (the Spine actor's skill clip; a tap hands the info to the card)
      const info = await host.page.evaluate((uid) => {
        const views = globalThis.__SP_VIEW__?.raw?.debug?.views;
        const v = views ? [...views.values()].find((x) => x.info?.uid === uid) : null;
        return v ? { skillIndex: v.info.skillIndex ?? null, moduleId: v.info.moduleId ?? null } : null;
      }, piece.uid);
      assert.deepEqual(info, { skillIndex: 0, moduleId: 'none' }, 'render unit info keeps the loadout');

      let card = null;
      for (const at of [0.72, 0.4, 0.88]) {
        const p = await host.piecePoint(piece.uid, at);
        if (!p) continue;
        await host.page.mouse.click(p.x, p.y, { button: 'right' });
        card = await readCard(host);
        if (card) break;
      }
      assert.ok(card, 'the detail card opens for the teammate\'s elite');
      await host.shot('scout-card');
      assert.ok(card.skill.includes(s1.name) && card.tag, `teammate card: ${s1.name} 已调配 (${JSON.stringify(card)})`);
      assert.ok(!card.skill.includes(sDef.name), 'not the default skill');
      assert.ok(card.none && card.module.includes('未装备模组'), `teammate card: 未装备模组 (${JSON.stringify(card)})`);
      assert.equal(card.stats['攻击'], String(rec.statsBase.atk), `teammate card ATK without the module (${JSON.stringify(card.stats)})`);
      assert.deepEqual(problemsOf([host, guest]), []);
    } finally {
      for (const c of [host, guest]) if (c.problems.length) console.log(c.label, c.problems.slice(0, 20).join('\n'));
      await host.close();
      await guest.close();
      await srv.stop();
    }
  });
});
