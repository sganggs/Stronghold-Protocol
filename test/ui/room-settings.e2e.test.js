// Real-server browser E2E — the co-op room's settings after the official create flow (the event's 联合模拟, the
// maintainer's decision of 2026-10-21): the lobby's 创建同盟 creates the room at once at the remembered difficulty (标准
// in a fresh browser); in the room the host changes the difficulty (the pill → 选择模拟协议 → 确认, whose hint states
// the server rule: the other doctors ready again) and switches 「AI 队友最后选择」 under ⚙ 同盟设置; another doctor sees
// both read-only — the pill opens 选择模拟协议 without 确认 (the cards shown, not chosen, 由创建者选择), ⚙ lists the
// difficulty with 由创建者选择 and the switch with 由创建者设置 — gets a toast when the host changes the difficulty and
// has to ready again (server/lobby.js setDifficulty un-readies the other humans).
//
//   SP_E2E=1 node --test test/ui/room-settings.e2e.test.js
//
// Screenshots: test/e2e/out/room-settings-*.png.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, hasChrome, startRealServer, problemsOf, sleep } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();

/** The room's difficulty and the guest's ready flag as a client's store holds them. */
const roomOf = (c) => c.page.evaluate(() => {
  const s = globalThis.__SP__.store.get();
  return { difficulty: s.room?.difficulty, aiPicksLast: s.room?.aiPicksLast === true, ready: !!s.room?.seats?.find((x) => x?.playerId === s.me.playerId)?.ready };
});

describe('co-op room settings (real server)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome)' }, () => {
  test('创建同盟 → the room at once; the host changes the difficulty and 「AI 队友最后选择」 in it, the other doctor reads them', { timeout: 3 * 60 * 1000 }, async () => {
    const srv = await startRealServer();
    const P = (await import('puppeteer-core')).default;
    const host = new Client(P, srv.base, 'host', { prefix: 'room-settings' });
    const guest = new Client(P, srv.base, 'guest', { prefix: 'room-settings', w: 1280, h: 720 });
    try {
      await host.open();
      await host.enter('凯尔希');
      const room = await host.createCoop();
      assert.deepEqual(await roomOf(host), { difficulty: 'FUNNY', aiPicksLast: false, ready: false }, 'the fresh browser remembers 标准');
      await guest.open(`?room=${room.code}`);
      await guest.enter('阿米娅');
      await guest.waitFor((s) => s.room?.code === room.code, 'guest joined');
      await guest.page.waitForSelector('.room-screen .seat.is-me');

      // the guest: the pill opens 选择模拟协议 read-only — no 确认, the cards disabled, the room's difficulty selected
      await guest.click('.rs-pill__diff');
      await guest.page.waitForSelector('.modal__box.proto', { visible: true });
      let v = await guest.page.evaluate(() => ({
        selected: document.querySelector('.proto__body')?.dataset.difficulty,
        disabled: [...document.querySelectorAll('.modal__box.proto .diff-card')].map((b) => b.disabled),
        start: !!document.querySelector('.modal__box.proto .proto-start'),
        hint: document.querySelector('.modal__box.proto .proto-hint--ro')?.textContent.trim(),
      }));
      assert.deepEqual(v, { selected: 'FUNNY', disabled: [true, true, true, true], start: false, hint: '由创建者选择' });
      await sleep(900); // the dialog's 转场
      await guest.shot('guest-protocol');
      await guest.page.keyboard.press('Escape');
      await guest.page.waitForSelector('.modal__box.proto', { hidden: true });

      // the guest: ⚙ 同盟设置 — the difficulty and the switch, both read-only
      await guest.click('.rs-pill__gear');
      await guest.page.waitForSelector('.rs-opts', { visible: true });
      v = await guest.page.evaluate(() => ({
        diff: document.querySelector('[data-testid="room-opt-difficulty"]')?.textContent.replace(/\s+/g, ' ').trim(),
        sw: [...document.querySelectorAll('.rs-opts [role="switch"]')].map((b) => [b.textContent.trim(), b.disabled]),
        note: document.querySelector('.rs-opts .ailast')?.textContent.includes('由创建者设置'),
      }));
      assert.ok(v.diff.includes('标准模拟') && v.diff.includes('由创建者选择') && !v.diff.includes('更改'), v.diff);
      // §35.100 adds the default-off spectator handover setting; both switches are read-only for the guest.
      assert.deepEqual(v.sw, [['允许观战者接替 AI', true], ['AI 队友最后选择', true]]);
      assert.equal(v.note, true);
      await guest.shot('guest-options');
      await guest.page.keyboard.press('Escape');
      await guest.page.waitForSelector('.rs-opts', { hidden: true });

      // the guest readies; the host changes the difficulty in the room — the hint names the server rule
      await guest.click('.rs-go', '准备就绪');
      await guest.page.waitForFunction(() => {
        const s = globalThis.__SP__.store.get();
        return !!s.room?.seats?.find((x) => x?.playerId === s.me.playerId)?.ready;
      }, { timeout: 10000 });
      await host.click('.rs-pill__diff');
      await host.page.waitForSelector('.modal__box.proto', { visible: true });
      assert.equal(await host.page.$eval('.modal__box.proto .proto-hint', (el) => el.textContent.trim()), '更改难度后，其他博士需要重新准备就绪');
      await host.click('.modal__box.proto .diff-card', '终极模拟');
      await sleep(900); // the dialog's 转场
      await host.shot('host-protocol');
      await host.click('.modal__box.proto .proto-start', '确认');
      await host.page.waitForSelector('.modal__box.proto', { hidden: true, timeout: 10000 });
      // the accepted pick is the remembered difficulty: the next 创建同盟 starts there (README / PLAYING 难度沿用上次选的)
      assert.equal(await host.page.evaluate(() => localStorage.getItem('sp.pref.lobby.difficulty')), '"ABYSS"');
      assert.equal(await guest.page.evaluate(() => localStorage.getItem('sp.pref.lobby.difficulty')), null, 'a read-only guest remembers nothing');
      await guest.page.waitForFunction(() => globalThis.__SP__.store.get().room?.difficulty === 'ABYSS', { timeout: 10000 });
      assert.deepEqual(await roomOf(guest), { difficulty: 'ABYSS', aiPicksLast: false, ready: false }, 'the change un-readies the guest');
      await guest.page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((el) => el.textContent.includes('创建者已将模拟难度改为「终极模拟」')), { timeout: 5000 });
      assert.match(await guest.page.$eval('.rs-pill__diff', (el) => el.textContent), /终极模拟/);
      assert.equal(await host.page.$$eval('.toast', (els) => els.some((el) => el.textContent.includes('创建者已将模拟难度改为'))), false, 'the host is not told their own change');

      // the host switches 「AI 队友最后选择」; the guest sees it on (read-only)
      await host.click('.rs-pill__gear');
      await host.page.waitForSelector('.rs-opts', { visible: true });
      await host.click('.rs-opts [role="switch"]', 'AI 队友最后选择');
      await guest.page.waitForFunction(() => globalThis.__SP__.store.get().room?.aiPicksLast === true, { timeout: 10000 });
      await guest.click('.rs-pill__gear');
      await guest.page.waitForSelector('.rs-opts [role="switch"][aria-checked="true"]', { visible: true });
      assert.equal(await guest.page.$eval('.rs-opts [role="switch"][aria-checked="true"]', (b) => b.disabled), true);
      await guest.shot('guest-options-on');

      assert.deepEqual(problemsOf([host, guest]), []);
    } finally {
      await host.close();
      await guest.close();
      await srv.stop();
    }
  });
});
