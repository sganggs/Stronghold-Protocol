// Real-server browser E2E — the official versions' vote rules and a version match (DESIGN §35.23, M1), on an in-process
// server that enables every version with a short vote (versionVoteMs 4 s, versionRetryMs 0.5 s) and fast match hosts
// (timerScale 0.1, combatSpeed 16 — the version hosts take the same matchHost options):
//   * the vote: a spectator is no voter (1/2, no 同意 button on its page) → the vote expires (toast) → a human taking a
//     seat voids the next one (toast) → the host cancels one (the guest's toast) → three seated humans agree → all switch;
//   * the cross-lane race of the in-flight settings: the host edits 角峰's skill in 干员调配 while a vote for 第一期下半
//     is open (the edit is checked against 第二期下半, where 角峰 is chess_char_1_02_a); after the switch the page sends
//     it again for 第一期下半 (角峰 is chess_char_2_03_a there, chess_char_1_02_a is 讯使) only after room.contentReady,
//     and the match fights with 角峰's choice on his own chess and nothing on 讯使's;
//   * that match, with two AI teammates, runs in a version host (/healthz versions: a worker) to its settlement under
//     AI 托管; the settlement shows the version's tag, the device record names it, and leaving restores the guest's lobby
//     version (第二期下半).
//
//   SP_E2E=1 node --test test/ui/versions-flow.e2e.test.js
//
// Screenshots: test/e2e/out/versions-flow-*.png.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, hasChrome, problemsOf, sleep } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
/** 角峰 (char_199_yak): chess_char_1_02_a in 第二期下半, chess_char_2_03_a in 第一期下半, whose chess_char_1_02_a is 讯使. */
const YAK_V2 = 'chess_char_1_02_a';
const YAK_V1 = 'chess_char_2_03_a';

async function startVersionServer() {
  const { startServer } = await import('../../server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: process.env.SP_E2E_VERBOSE !== '1', versions: { enabled: 'all' },
    versionVoteMs: 4000, versionRetryMs: 500, matchHost: { matchOptions: { timerScale: 0.1, combatSpeed: 16, botRehearsal: 0 } } });
  for (const t0 = Date.now(); Date.now() - t0 < 20000;) {
    const h = await fetch(`${srv.url}/healthz?traffic=1`).then((r) => r.json(), () => null);
    if (!h?.assetHashes || h.assetHashes.ready) break;
    await sleep(150);
  }
  return srv;
}

const stateOf = (c) => c.page.evaluate(() => {
  const s = globalThis.__SP__.store.get();
  const k = globalThis.__SP_CONTENT__?.state() || {};
  return { kind: k.kind ?? null, version: k.version ?? null, status: k.status ?? null, room: s.room ? (s.room.version ?? 'act2autochess') : null,
    code: s.room?.code ?? null, vote: s.room?.versionVote ?? null, config: globalThis.__SP__.data.get('config')?.version?.id ?? 'act2autochess',
    phase: s.match.public?.phase ?? null, round: s.match.public?.round ?? 0, result: !!s.match.result, loadout: s.match.private?.loadout ?? null };
});
const waitState = async (c, pred, what, timeout = 30000) => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) { last = await stateOf(c); if (pred(last)) return last; await sleep(150); }
  throw new Error(`${c.label}: timed out waiting for ${what} (last: ${JSON.stringify({ ...last, loadout: undefined })})`);
};
const openWith = async (c, sel, text, waitSel) => {
  for (let i = 0; i < 4; i++) {
    await c.click(sel, text);
    try { await c.page.waitForSelector(waitSel, { visible: true, timeout: 2500 }); return; } catch { /* again */ }
  }
  throw new Error(`${c.label}: ${waitSel} never showed`);
};
const settle = (c) => c.page.waitForFunction(() => !document.getAnimations()
  .some((a) => /^(tr|ps|rs|rseat)-/.test(String(a.animationName)) && a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity), { timeout: 10000 });
/** The host proposes a version through the room's pill and the picker. */
const propose = async (c, id) => {
  await openWith(c, '[data-testid="room-version"]', null, '[data-testid="version-picker"]');
  await settle(c);
  await c.click(`.verpick__pick[data-version="${id}"]`);
  await c.page.waitForSelector('[data-testid="version-picker"]', { hidden: true, timeout: 10000 });
};
const waitToast = (c, text, timeout = 10000) => c.page.waitForFunction((t) => [...document.querySelectorAll('.toast__text')].some((e) => e.textContent.includes(t)), { timeout }, text);
const req = (c, type, body = {}) => c.page.evaluate((type, body) => globalThis.__SP__.net.request(type, body).then((r) => r ?? null, (e) => ({ error: e?.code || String(e) })), type, body);

/** The WebSocket frames a page sends (CDP), parsed; `since` = an index into them. */
async function recordSent(c) {
  const frames = [];
  const cdp = await c.page.target().createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameSent', (e) => { try { frames.push(JSON.parse(e.response.payloadData)); } catch { /* binary / not JSON */ } });
  return frames;
}

describe('official versions: the vote rules and a version match (in-process server, every version)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome)' }, () => {
  test('the vote: a spectator does not vote, expiry, a seat taken voids it, the host cancels, unanimous agreement switches', { timeout: 4 * 60 * 1000 }, async () => {
    const srv = await startVersionServer();
    const P = (await import('puppeteer-core')).default;
    const host = new Client(P, srv.url, 'host', { prefix: 'versions-flow', w: 1280, h: 720 });
    const guest = new Client(P, srv.url, 'guest', { prefix: 'versions-flow', w: 1280, h: 720 });
    const third = new Client(P, srv.url, 'third', { prefix: 'versions-flow-third', w: 1280, h: 720 });
    try {
      await host.open();
      await host.enter('凯尔希');
      const { code } = await host.createCoop();
      await guest.open(`?room=${code}`);
      await guest.enter('阿米娅');
      await guest.waitFor((s) => s.room?.code === code, 'guest joined');
      await third.open();
      await third.enter('华法琳');
      assert.equal((await req(third, 'room.spectate', { code }))?.error ?? null, null, 'a spectator seat');
      await waitState(third, (s) => s.code === code, 'the spectator in the room');

      // 1. a spectator is no voter; the vote expires
      await propose(host, 'act1autochess');
      await host.page.waitForSelector('[data-testid="version-vote"]', { visible: true, timeout: 10000 });
      assert.match(await host.page.$eval('[data-testid="version-vote"]', (e) => e.textContent), /第一期下半.*1\/2/, 'host + guest vote, the spectator does not');
      await guest.page.waitForSelector('[data-testid="version-agree"]', { visible: true, timeout: 10000 });
      await third.page.waitForSelector('[data-testid="version-vote"]', { visible: true, timeout: 10000 });
      assert.equal(await third.exists('[data-testid="version-agree"]'), false, 'no 同意 button for a spectator');
      await third.shot('vote-spectator');
      await waitToast(host, '切换版本投票已超时', 15000);
      await waitToast(guest, '切换版本投票已超时', 5000);
      assert.equal((await stateOf(host)).room, 'act2autochess', 'unchanged after the expiry');
      await host.page.waitForSelector('[data-testid="version-vote"]', { hidden: true });

      // 2. a human taking a seat voids the next vote (the spectator leaving does not)
      await sleep(700); // versionRetryMs after an expired vote
      await propose(host, 'act1autochess');
      await guest.page.waitForSelector('[data-testid="version-agree"]', { visible: true, timeout: 10000 });
      await third.click('.rs-exit');
      await third.page.waitForSelector('.lobby-screen', { timeout: 15000 });
      await host.page.waitForFunction(() => globalThis.__SP__.store.get().room?.spectators?.length === 0, { timeout: 10000 });
      assert.ok((await stateOf(host)).vote, 'a spectator leaving keeps the vote');
      assert.equal((await req(third, 'room.join', { code }))?.error ?? null, null, 'a player seat');
      await waitToast(host, '同盟成员有变动，切换版本投票已取消');
      await waitState(host, (s) => !s.vote, 'the vote voided');

      // 3. the host cancels: the others are told
      await sleep(400);
      await propose(host, 'act1autochess');
      await guest.page.waitForSelector('[data-testid="version-agree"]', { visible: true, timeout: 10000 });
      assert.match(await host.page.$eval('[data-testid="version-vote"]', (e) => e.textContent), /1\/3/, 'three seated humans');
      await host.click('[data-testid="version-cancel"]');
      await waitToast(guest, '创建者取消了切换版本投票');
      await waitToast(third, '创建者取消了切换版本投票');
      await waitState(host, (s) => !s.vote, 'the vote cancelled');

      // 4. unanimous: every seated human agrees → every page switches
      await sleep(400);
      await propose(host, 'act1autochess');
      await guest.page.waitForSelector('[data-testid="version-agree"]', { visible: true, timeout: 10000 });
      await third.page.waitForSelector('[data-testid="version-agree"]', { visible: true, timeout: 10000 });
      await guest.click('[data-testid="version-agree"]');
      await host.page.waitForFunction(() => /2\/3/.test(document.querySelector('[data-testid="version-vote"]')?.textContent || ''), { timeout: 10000 });
      assert.equal((await stateOf(host)).room, 'act2autochess', 'not before the last voter');
      await third.click('[data-testid="version-agree"]');
      for (const c of [host, guest, third]) {
        await waitState(c, (s) => s.room === 'act1autochess' && s.version === 'act1autochess' && s.status === 'ready' && !s.vote, `${c.label}: switched`);
      }
      await waitToast(guest, '同盟已切换到「第一期下半」');
      await host.shot('switched');
      assert.deepEqual(problemsOf([host, guest, third]), []);
    } catch (err) {
      for (const c of [host, guest, third]) await c.shot('fail').catch(() => {});
      throw err;
    } finally {
      await host.close();
      await guest.close();
      await third.close();
      await srv.close();
    }
  });

  test('an edit during an open vote reaches the new version\'s match on its own operator; the match runs in a version host to its settlement', { timeout: 12 * 60 * 1000 }, async () => {
    const srv = await startVersionServer();
    const P = (await import('puppeteer-core')).default;
    const host = new Client(P, srv.url, 'host', { prefix: 'versions-flow-match', w: 1280, h: 720 });
    const guest = new Client(P, srv.url, 'guest', { prefix: 'versions-flow-match-guest', w: 1280, h: 720 });
    try {
      await host.open();
      await host.enter('凯尔希');
      const sent = await recordSent(host);
      const { code } = await host.createCoop();
      await guest.open(`?room=${code}`);
      await guest.enter('阿米娅');
      await guest.waitFor((s) => s.room?.code === code, 'guest joined');

      // the vote for 第一期下半 is open while the host edits 角峰 (S1, not his default S2) in the room's 干员调配 (checked against 第二期下半)
      await propose(host, 'act1autochess');
      await guest.page.waitForSelector('[data-testid="version-agree"]', { visible: true, timeout: 10000 });
      await openWith(host, '.room-screen [data-testid="loadout-open"]', null, '.lo .lo-search input');
      await host.page.type('.lo-search input', '角峰');
      await host.page.waitForFunction(() => document.querySelectorAll('.lo-card').length === 1, { timeout: 5000 });
      await host.click('.lo-card__pick');
      await host.page.waitForSelector('.lo-detail .lo-skill[data-skill="0"]', { visible: true });
      await host.click('.lo-detail .lo-skill[data-skill="0"]');
      await host.page.waitForFunction(() => /已同步/.test(document.querySelector('.lo-sync')?.textContent || ''), { timeout: 10000 });
      const during = sent.filter((f) => f.t === 'room.loadout').at(-1);
      assert.deepEqual(during?.entries?.[YAK_V2], { skill: 0 }, 'sent for 第二期下半 while the vote is open');
      await host.page.keyboard.press('Escape');
      await host.page.waitForFunction(() => !document.querySelector('.lo'), { timeout: 10000 });
      assert.ok((await stateOf(host)).vote, 'still open');
      const mark = sent.length;
      await guest.click('[data-testid="version-agree"]');
      for (const c of [host, guest]) await waitState(c, (s) => s.room === 'act1autochess' && s.version === 'act1autochess' && s.status === 'ready', `${c.label}: switched`);
      const room = await host.page.evaluate(() => globalThis.__SP__.store.get().room);

      // after the switch: room.contentReady for the version's cs first, then the loadout again, by 第一期下半's chess ids
      const t0 = Date.now();
      let after = [];
      while (Date.now() - t0 < 10000) {
        after = sent.slice(mark);
        const ready = after.findIndex((f) => f.t === 'room.contentReady' && f.cs === room.content.cs);
        if (ready >= 0 && after.slice(ready).some((f) => f.t === 'room.loadout')) break;
        await sleep(150);
      }
      const readyAt = after.findIndex((f) => f.t === 'room.contentReady' && f.cs === room.content.cs);
      assert.ok(readyAt >= 0, `room.contentReady for the version (${after.map((f) => f.t).join(', ')})`);
      const loadouts = after.filter((f) => f.t === 'room.loadout');
      assert.ok(loadouts.length && after.indexOf(loadouts[0]) > readyAt, `no loadout sent after the switch before the content was ready (${after.map((f) => f.t).join(', ')})`);
      const last = loadouts.at(-1);
      assert.deepEqual(last.entries[YAK_V1], { skill: 0 }, '角峰\'s choice on his 第一期下半 chess');
      assert.equal(last.entries[YAK_V2], undefined, 'nothing on 讯使 (第一期下半\'s chess_char_1_02_a)');

      // two AI teammates; the guest readies; the host starts: the match runs in a version host
      assert.equal((await req(host, 'room.addBot'))?.error ?? null, null);
      assert.equal((await req(host, 'room.addBot'))?.error ?? null, null);
      await guest.page.waitForFunction(() => !document.querySelector('.rs-go')?.disabled, { timeout: 15000 });
      assert.equal((await req(guest, 'room.ready', { ready: true }))?.error ?? null, null);
      await sleep(300);
      assert.equal((await req(host, 'room.start'))?.error ?? null, null);
      const brief = await waitState(host, (s) => s.phase === 'INFO_CHECK' && !!s.loadout, 'the briefing', 60000);
      assert.equal(brief.loadout[YAK_V1]?.skill, 0, `the match fights with 角峰's choice on his own chess ${JSON.stringify(brief.loadout)}`);
      assert.equal(brief.loadout[YAK_V2], undefined, '讯使 carries nothing of 角峰');
      const health = await fetch(`${srv.url}/healthz`).then((r) => r.json());
      assert.ok(health.versions && health.versions.hosts.workers >= 1, `a version host runs the match ${JSON.stringify(health.versions)}`);
      await host.page.waitForSelector('[data-testid="version-tag"][data-version="act1autochess"]', { visible: true, timeout: 20000 });
      await host.shot('briefing');

      // AI 托管 for both humans → the settlement
      for (const c of [host, guest]) {
        await req(c, 'g.infoReady', {});
        await req(c, 'g.autoplay', { on: true });
      }
      let seen = 0;
      const tEnd = Date.now() + 10 * 60 * 1000;
      for (;;) {
        const s = await stateOf(host);
        if (s.round > seen) { seen = s.round; host.note(`round ${s.round} ${s.phase}`); }
        if (s.result) break;
        if (Date.now() > tEnd) throw new Error(`no settlement after 10 min (round ${s.round}, ${s.phase})`);
        await sleep(1000);
      }
      assert.ok(seen >= 3, `played several rounds (${seen})`);
      await host.page.waitForSelector('.sself [data-testid="version-tag"][data-version="act1autochess"], .steam [data-testid="version-tag"][data-version="act1autochess"]', { timeout: 30000 });
      await host.shot('settlement');
      const rec = await host.page.evaluate(() => (JSON.parse(localStorage.getItem('sp.pref.stats') || 'null')?.records || []).at(-1) ?? null);
      assert.equal(rec?.version, 'act1autochess', 'the device record names the version');

      // the guest leaves through the settlement and the room: its lobby is 第二期下半 again
      for (let i = 0; i < 20 && !(await guest.exists('.room-screen')); i++) {
        await guest.click('[data-testid="settle-intro"]', null, { timeout: 1000, optional: true });
        await guest.click('.settle button', '下一步', { timeout: 1000, optional: true });
        await guest.click('.settle button', '返回同盟', { timeout: 1000, optional: true });
        await sleep(500);
      }
      await guest.click('.rs-exit');
      await guest.page.waitForSelector('.lobby-screen', { timeout: 20000 });
      await waitState(guest, (s) => s.room === null && s.config === 'act2autochess', 'the guest back on 第二期下半', 20000);
      assert.deepEqual(problemsOf([host, guest]), []);
    } catch (err) {
      console.log(host.log.join('\n'));
      for (const c of [host, guest]) await c.shot('fail').catch(() => {});
      throw err;
    } finally {
      await host.close();
      await guest.close();
      await srv.close();
    }
  });
});
