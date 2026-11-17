// Real-server browser E2E of 0.2.0 补位 end to end (the approved plan, owner's decision 2026-10-05; the display follows
// the owner's recall of the official mode, 2026-10-06): the 干员持有 tab of the 干员调配 overlay marks 银灰 as not owned
// (real clicks; persisted in localStorage; room.ownership → session → seat → the next match's m.private.standIns); in
// the match the shop card shows the stand-in Sharp (name, portrait, a small 「替补」 mark; 银灰's bonds and price);
// bought, the hand piece is Sharp's model with the 「替补」 tag; deployed, the board model is Sharp's and the detail
// card shows Sharp (name, skill) with 「银灰的替补」; in the browser's own battle (client-side combat) the unit is the
// stand-in — the b.start spec marks it `standIn: true`, the local sim fields char_609_acguad with its kit, and the
// battle view draws Sharp's Spine model; the match then ends (the fast server's finishAfter hook) and the result
// screen's lineup shows Sharp with the 「替补」 mark.
//
//   SP_E2E=1 node --test test/ui/standin.e2e.test.js
//
// The server is test/e2e/fastServer.mjs with its starter-kit hooks (no starter operators, 银灰 in the first shop slot,
// 20 funds) and SP_FINISH_AFTER 1 (the match ends once round 1 has settled); everything else is the real match engine
// and the real UI driven by real mouse input. Screenshots: test/e2e/out/standin-*.png.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, sleep, hasChrome, startRealServer, problemsOf } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const SILVER = 'chess_char_4_22_a'; // 银灰 (NORMAL) → Sharp (char_609_acguad), S2 亮剑
const SHARP = 'char_609_acguad';

describe('0.2.0 补位 — a not-owned operator fights as its stand-in (real server)', { skip: !ENABLED && 'set SP_E2E=1 (Chrome + public/assets)' }, () => {
  test('干员持有: drop 银灰 → the shop shows Sharp → buy (the hand shows Sharp) → deploy (Sharp card) → the local battle fields Sharp → the result shows Sharp', { timeout: 6 * 60 * 1000 }, async () => {
    const srv = await startRealServer({ fast: { timerScale: 0.5, combatSpeed: 2, startRound: 1, kit: 0, shop: [SILVER], finishAfter: 1 } });
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'standin', { prefix: 'standin' });
    try {
      await c.open();
      await c.enter('替补');
      // 1) 干员调配 → 干员持有: mark 银灰 未持有 (real clicks), synced with the server, persisted in the browser
      await c.click('.lobby-screen [data-testid="loadout-open"]');
      await c.page.waitForSelector('.lo .lo-tab[data-tab="ownership"]', { visible: true, timeout: 15000 });
      await c.click('.lo .lo-tab[data-tab="ownership"]');
      await c.page.waitForSelector(`.own-card[data-chess="${SILVER}"]`, { visible: true, timeout: 15000 });
      const cards = await c.page.evaluate(() => [...document.querySelectorAll('.own-card')].length);
      assert.equal(cards, 53, 'the 53 NORMAL chess of the shop');
      await c.click(`.own-card[data-chess="${SILVER}"]`);
      await c.page.waitForFunction((id) => document.querySelector(`.own-card[data-chess="${id}"]`)?.getAttribute('aria-checked') === 'false', { timeout: 3000 }, SILVER);
      await c.page.waitForFunction(() => /已同步/.test(document.querySelector('[data-testid="ownership-sync"]')?.textContent || ''), { timeout: 8000 });
      const card = await c.page.evaluate((id) => document.querySelector(`.own-card[data-chess="${id}"]`)?.textContent || '', SILVER);
      assert.ok(card.includes('银灰') && card.includes('Sharp') && card.includes('未持有'), card);
      const stored = await c.page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.ownership') || 'null'));
      assert.deepEqual(stored, { v: 2, notOwnedChars: ['char_172_svrash'], notOwned: [SILVER] }, 'stored by operator with the older-build copy (DESIGN §35.23)');
      await c.shot('ownership');
      await c.page.keyboard.press('Escape');
      await c.page.waitForFunction(() => !document.querySelector('.lo'), { timeout: 3000 });

      // 2) a solo 标准 match: the briefing's m.private carries the list
      // 独立模拟 → 选择模拟协议 (标准 preselected in a fresh browser) → 开始独立模拟 (§35.51: the old lobby's difficulty cards)
      await c.click('.mode-card', '独立模拟');
      await c.click('.create-box button', '开始独立模拟');
      await c.waitFor((s) => !!s.room, 'solo room');
      if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      const standIns = await c.page.evaluate(() => globalThis.__SP__.store.get().match.private?.standIns ?? null);
      assert.deepEqual(standIns, [SILVER], 'the match received the not-owned list');
      await c.click('.brief__foot .btn--primary', '准备就绪');
      await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
      await c.click('.dband', null, { nth: 1 });
      await c.click('.draft-detail__btns .btn--primary', '确认选择');
      await c.waitFor((s) => s.phase === 'PREP' && !s.ready && s.funds >= 3, 'prep with funds', 60000);
      await sleep(1800); // camera flight

      // 3) the shop card shows the stand-in: Sharp (name, portrait) with a small 「替补」 mark, 银灰's bond; two taps buy it
      await c.page.waitForSelector('.scard .scard__standin', { visible: true, timeout: 10000 });
      const shopCard = await c.page.evaluate(() => {
        const el = document.querySelector('.scard .scard__standin')?.closest('.scard');
        return el ? {
          name: el.querySelector('.scard__name')?.textContent, badge: el.querySelector('.scard__standin')?.textContent,
          standIn: el.querySelector('.scard__standin')?.dataset.standin, for: el.querySelector('.scard__standin')?.dataset.for,
          art: el.querySelector('.scard__art')?.getAttribute('src') || '', bonds: [...el.querySelectorAll('.scard__bond > span:last-child')].map((b) => b.textContent),
        } : null;
      });
      assert.ok(shopCard, 'the stand-in card');
      assert.deepEqual([shopCard.name, shopCard.badge, shopCard.standIn, shopCard.for], ['Sharp', '替补', SHARP, SILVER]);
      assert.match(shopCard.art, /char_609_acguad/, 'Sharp\'s portrait');
      assert.deepEqual(shopCard.bonds, ['谢拉格'], '银灰\'s bond still counts');
      await c.shot('shop');
      await c.click('.scard', 'Sharp');
      await sleep(300);
      await c.click('.scard', 'Sharp');
      await c.waitFor((s) => s.hand > 0, 'bought', 8000);
      await sleep(900);
      const [piece] = (await c.handPieces('chess')).filter((p) => p.id === SILVER);
      assert.ok(piece, 'the 银灰 piece is in the hand');
      // the hand piece is Sharp's model, tagged 「替补」
      await c.page.waitForFunction((uid) => document.querySelector(`.sitag[data-uid="${uid}"]`)?.textContent === '替补', { timeout: 5000 }, piece.uid);
      await c.page.waitForFunction((uid, sharp) => globalThis.__SP_VIEW__?.raw?.debug?.views?.get(`p:${uid}`)?.info?.spine === sharp, { timeout: 5000 }, piece.uid, SHARP);
      await c.shot('hand');

      // 4) deploy it (drag → direction wheel): the board model stays Sharp's; the card shows Sharp, 「银灰的替补」
      const tile = await c.freeTileFor(piece.uid);
      assert.ok(tile, 'a legal tile');
      await c.drag(await c.piecePoint(piece.uid), await c.tilePoint(tile.row, tile.col));
      await c.page.waitForSelector('.fwheel__dia', { timeout: 4000 });
      await c.swipe('RIGHT');
      await c.waitFor((s) => s.board > 0, 'placed', 8000);
      await c.page.waitForFunction((uid, sharp) => {
        const v = globalThis.__SP_VIEW__?.raw?.debug?.views?.get(`p:${uid}`);
        return v && v.info?.spine === sharp && v.info?.standInFor;
      }, { timeout: 8000 }, piece.uid, SHARP);
      await sleep(600);
      let detail = null;
      for (const at of [0.72, 0.4, 0.88]) {
        const p = await c.piecePoint(piece.uid, at);
        if (!p) continue;
        await c.page.mouse.click(p.x, p.y, { button: 'right' });
        detail = await c.page.waitForSelector('.dpanel .dtag-standin', { timeout: 2500 }).then(() => c.page.evaluate(() => ({
          tag: document.querySelector('.dpanel .dtag-standin')?.textContent || '',
          name: document.querySelector('.dpanel .dhead__name')?.textContent || '',
          for: document.querySelector('.dpanel .dhead__for')?.textContent || '',
          skill: document.querySelector('.dpanel .dskill')?.dataset.skill || '',
        })), () => null);
        if (detail) break;
      }
      assert.ok(detail, 'the detail card opens for the deployed piece');
      assert.deepEqual(detail, { tag: '替补', name: 'Sharp', for: '银灰的替补', skill: 'skchr_acguad_2' });
      await c.shot('board');
      await c.page.keyboard.press('Escape');

      // 5) ready → the local battle fields Sharp (spec standIn: true; the sim's def; the view's Spine model)
      await c.click('.readybtn');
      await c.waitFor((s) => s.phase === 'COMBAT', 'combat', 60000);
      const got = await c.page.waitForFunction((uid, sharp) => {
        const r = globalThis.__SP_RUNNER__;
        const e = r && [...r._entries.values()].find((x) => x.own && x.battle);
        if (!e) return false;
        const u = e.battle.allyUnits.find((x) => x.uid === uid);
        if (!u) return false;
        const views = globalThis.__SP_VIEW__?.raw?.debug?.views;
        const v = views ? [...views.values()].find((x) => x.info?.uid === uid && !String(x.id).startsWith('p:')) : null;
        if (!v || !v.spineReady) return false;
        const entry = (e.spec.players || []).flatMap((p) => p.units || []).find((x) => x.uid === uid) || null;
        return {
          authoritative: e.authoritative, spec: entry && { chessId: entry.chessId, standIn: entry.standIn ?? null, skillIndex: entry.skillIndex ?? null },
          charId: u.def?.charId, standInFor: u.def?.standInFor, skill: u.skill?.id ?? null, bonds: u.def?.bonds,
          viewSpine: v.info.spine, viewStandInFor: v.info.standInFor ?? null, model: String(v._actorEntry?.skel || ''),
        };
      }, { timeout: 30000, polling: 150 }, piece.uid, SHARP).then((h) => h.jsonValue());
      assert.equal(got.authoritative, true, 'the own normal battle is simulated by this browser');
      assert.deepEqual(got.spec, { chessId: SILVER, standIn: true, skillIndex: null }, 'b.start spec marks the stand-in');
      assert.equal(got.charId, SHARP, 'the local sim fields Sharp');
      assert.equal(got.skill, 'skchr_acguad_2', 'with the chess\'s backup skill (S2 亮剑)');
      assert.equal(got.viewSpine, SHARP);
      assert.ok(got.viewStandInFor, 'the view knows it is a stand-in');
      assert.match(got.model, /char_609_acguad/, 'the battle view draws Sharp\'s Spine model');
      await sleep(800);
      await c.shot('combat');
      // 6) the battle ends, the round settles (the result upload is accepted) and the match ends (finishAfter 1): the
      // settlement's own report (screens/settle.js, after its intro) shows Sharp's card with the 「替补」 mark
      await c.waitFor((s) => !!s.result, 'result', 180000);
      await c.page.waitForSelector('[data-testid="settle-self"] .sop:not(.is-empty)', { visible: true, timeout: 15000 });
      const lineup = await c.page.evaluate(() => [...document.querySelectorAll('[data-testid="settle-self"] .sop:not(.is-empty)')].map((el) => ({
        title: el.getAttribute('title') || '', mark: el.querySelector('.sop__si')?.textContent || '',
        standIn: el.querySelector('.sop__si')?.dataset.standin || '', art: el.querySelector('.sop__art img')?.getAttribute('src') || '',
      })));
      assert.equal(lineup.length, 1, 'the one operator fielded');
      assert.deepEqual([lineup[0].title, lineup[0].mark, lineup[0].standIn], ['Sharp（银灰的替补）', '替补', SHARP]);
      assert.match(lineup[0].art, /char_609_acguad/, 'Sharp\'s avatar');
      await sleep(400);
      await c.shot('result');
      assert.deepEqual(problemsOf([c]), []);
    } finally {
      if (c.problems.length) console.log(c.problems.slice(0, 20).join('\n'));
      await c.close();
      await srv.stop();
    }
  });
});
