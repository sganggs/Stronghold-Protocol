// Real-server browser E2E — spectator seats (community report #26, a remake feature: the official room has none). The
// lobby's 观战 takes a spectator seat; the room lists it under 观战席 (the host's ✕ frees one — that spectator is told
// room.closed {kicked}); the spectator's room view has 观战中 instead of the ready button; in the match it has no shop,
// no ready toggle, no emote wheel and reads 观战中 (never "你已被淘汰"), is shown the first player's board in 休整期 by
// itself and the first field in battle, never holds an m.private, sends nothing but g.watch (plus its own room.spectate /
// room.loadout), gets its seat back after a reload, and 离开观战 returns it to the lobby.
// Server side: test/lobby.test.js, test/match/spectator.test.js, test/match/lobby-integration.test.js.
//
//   SP_E2E=1 node --test test/ui/spectator.e2e.test.js
//
// Screenshots: test/e2e/out/spectator-*.png.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, sleep, hasChrome, startRealServer, problemsOf } from '../e2e/client.mjs';
import { TestClient } from '../helpers/wsClient.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const ALLOWED = new Set(['room.spectate', 'room.loadout', 'g.watch', 'g.leave', 'room.leave']);

/** The spectator's own view of the store: still a spectator, never a private view. */
const specState = (c) => c.page.evaluate(() => {
  const s = globalThis.__SP__.store.get();
  return {
    spectating: !!s.room?.spectators?.some((x) => x.playerId === s.me.playerId),
    priv: s.match.private != null,
    battle: s.match.battle ? { watch: !!s.match.battle.watch, authoritative: !!s.match.battle.authoritative, fieldId: s.match.battle.fieldId } : null,
    field: s.match.field ? { fieldId: s.match.field.fieldId, prep: !!s.match.field.prep } : null,
  };
});

describe('spectator seats (community report #26, real server)', { skip: !ENABLED && 'set SP_E2E=1 (Chrome + public/assets)' }, () => {
  test('观战 from the lobby → 观战席 in the room → the match: watching only, no private view, resume, 离开观战', { timeout: 6 * 60 * 1000 }, async () => {
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 4, startRound: 1, kit: 3, autoPlace: true } });
    const P = (await import('puppeteer-core')).default;
    const host = new Client(P, srv.base, 'host', { prefix: 'spectator' });
    const spec = new Client(P, srv.base, 'spec', { prefix: 'spectator', w: 1280, h: 720 });
    let extra = null;
    try {
      await host.open();
      await host.enter('凯尔希');
      await host.click('.mode-card', '同盟模拟');
      await host.click('.diff-card', '标准模拟');
      await host.click('.create-box button', '创建同盟');
      const room = (await host.waitFor((s) => !!s.room?.code, 'room created')).room;
      await host.click('.seat--empty button', '添加 AI 队友');

      // the lobby's 观战 entry
      await spec.open();
      await spec.hookRequests();
      await spec.enter('阿米娅');
      await spec.click('.join-row input');
      await spec.page.keyboard.type(room.code);
      await spec.click('.join-row button', '观战');
      await spec.page.waitForSelector('.room-screen .specbar__who.is-me', { timeout: 10000 });
      const roomView = await spec.page.evaluate(() => ({
        bar: document.querySelector('.room-bar__right .btn--xl')?.textContent || '',
        barDisabled: !!document.querySelector('.room-bar__right .btn--xl')?.disabled,
        status: document.querySelector('.room-bar__status')?.textContent || '',
        seats: [...document.querySelectorAll('.seat__name')].map((e) => e.textContent),
      }));
      assert.match(roomView.bar, /观战中/);
      assert.equal(roomView.barDisabled, true);
      assert.match(roomView.status, /观战中/);
      assert.ok(!roomView.seats.includes('阿米娅'), 'never in a player seat');
      await spec.shot('room-spectator');

      // a second spectator (a bare socket) — the host's ✕ removes it: room.closed {kicked}
      extra = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      await extra.hello('华法琳');
      assert.equal((await extra.request({ t: 'room.spectate', code: room.code })).t, 'ok');
      await host.page.waitForFunction(() => document.querySelectorAll('.specbar__who').length === 2, { timeout: 8000 });
      await host.shot('room-host-specbar');
      await host.click('.specbar__who button[aria-label*="华法琳"]');
      assert.equal((await extra.waitFor('room.closed', () => true, 5000)).reason, 'kicked');
      await host.page.waitForFunction(() => document.querySelectorAll('.specbar__who').length === 1, { timeout: 8000 });

      // the match: a spectator is no player to wait for
      await host.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      for (const c of [host, spec]) await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      assert.match(await spec.page.evaluate(() => document.querySelector('.brief__foot .btn--primary')?.textContent || ''), /观战中/);
      await host.click('.brief__foot .btn--primary', '准备就绪');
      const t0 = Date.now();
      for (;;) {
        const s = await host.st();
        if (s.phase === 'PREP') break;
        assert.ok(Date.now() - t0 < 120000, `host stuck in ${s.phase}`);
        if (s.phase === 'BAND_DRAFT' && s.draft?.turn === s.me) {
          await host.click('.dband:not(.is-taken)', null, { nth: 2, optional: true, timeout: 2000 });
          await sleep(200);
          await host.click('.draft-detail__btns .btn--primary', '确认选择', { optional: true, timeout: 2000 });
        }
        await sleep(300);
      }
      // 休整期: the first player's board by itself, read-only; no shop / ready / 交流
      await spec.waitFor((s) => s.phase === 'PREP', 'spectator in prep', 30000);
      await spec.page.waitForSelector('.gm__watching', { timeout: 10000 });
      await spec.page.waitForSelector('.gm__dead--spectator', { timeout: 10000 });
      const prep = await spec.page.evaluate(() => ({
        watching: document.querySelector('.gm__watching')?.textContent || '',
        back: [...document.querySelectorAll('.gm__watching button')].length,
        pill: document.querySelector('.gm__dead')?.textContent || '',
        shop: !!document.querySelector('.shopbar, .shopbar-tab'),
        ready: !!document.querySelector('.readybtn'),
        emote: !!document.querySelector('.ewheel'),
      }));
      assert.match(prep.watching, /凯尔希/, 'the host\'s board is shown');
      assert.equal(prep.back, 0, 'no 返回自己 — a spectator has no board');
      assert.match(prep.pill, /观战中/);
      assert.doesNotMatch(prep.pill, /淘汰/);
      assert.deepEqual([prep.shop, prep.ready, prep.emote], [false, false, false]);
      const sp1 = await specState(spec);
      assert.deepEqual([sp1.spectating, sp1.priv], [true, false]);
      assert.equal(sp1.field?.prep, true);
      await sleep(1200);
      await spec.shot('prep');

      // battle: the first field, a display replica (watch), never the authority
      await host.click('.readybtn', null, { timeout: 10000 });
      await spec.waitFor((s) => s.phase === 'COMBAT', 'combat', 60000);
      await spec.page.waitForFunction(() => !!globalThis.__SP__.store.get().match.battle?.watch, { timeout: 20000 });
      const sp2 = await specState(spec);
      assert.deepEqual([sp2.priv, sp2.battle.watch, sp2.battle.authoritative], [false, true, false]);
      // the auto-observed field reads "👁 name" (as for an eliminated player), with no 返回战场 — never "你已被淘汰"
      await spec.page.waitForSelector('.chud__observe', { timeout: 10000 });
      const hud = await spec.page.evaluate(() => ({
        text: document.querySelector('.chud')?.textContent || '',
        back: !!document.querySelector('.chud__back'),
        emote: !!document.querySelector('.ewheel'),
      }));
      assert.match(hud.text, /凯尔希/);
      assert.doesNotMatch(hud.text, /淘汰/);
      assert.deepEqual([hud.back, hud.emote], [false, false]);
      await sleep(1500);
      await spec.shot('battle');

      // a reload: the seat comes back with the match
      await spec.page.reload({ waitUntil: 'domcontentloaded' });
      await spec.page.waitForFunction(() => !!globalThis.__SP__ && !!globalThis.__SP__.store.get().match.public, { timeout: 30000 });
      const sp3 = await specState(spec);
      assert.deepEqual([sp3.spectating, sp3.priv], [true, false]);

      // 离开观战: back to the lobby, the match goes on
      await spec.click('.gtop__exit', null, { timeout: 15000 });
      await spec.click('.modal button', '离开观战');
      await spec.page.waitForSelector('.lobby-screen', { timeout: 10000 });
      await host.page.waitForFunction(() => (globalThis.__SP__.store.get().room?.spectators || []).length === 0, { timeout: 8000 });
      const sent = await spec.requests();
      assert.deepEqual([...new Set(sent.map((r) => r[0]))].filter((t) => !ALLOWED.has(t)), [], 'a spectator sends no player action');
      assert.deepEqual(problemsOf([host, spec]), []);
    } finally {
      await extra?.terminate().catch(() => {});
      for (const c of [host, spec]) await c.close();
      await srv.stop();
    }
  });
});
