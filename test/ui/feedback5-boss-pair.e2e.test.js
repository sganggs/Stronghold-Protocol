// Real-server browser E2E of the community reports of 2026-10-06, items 51 / 55 (the boss round's prep). A co-op match
// jumped to the boss round (fastServer SP_START_ROUND=boss), 2 humans (seats 0 and 3) + 2 AI seats, every board placed
// by the jump (SP_AUTO_PLACE). Pairing is random; both clients must use the published pair and side.
//   * item 51: each human's prep shows its own pieces on its half (the guest's mirrored onto the right half) and its
//     partner's pieces on the other half (read-only 'm:<uid>' views from m.private bossMate, facing as the battle will
//     place them), the leader standing on the boss field; the team panel frames the pair's two avatars (green, the
//     official bg_team_border or a plain ring) from the prep through the Final Assault;
//   * item 55: with the guest eliminated at the jump, its prep shows the followed player's half of the boss field (the
//     prep scout of item 56, kind 'boss' on the boss-field prep camera) with the leader — it used to be its own empty
//     normal board.
// Unit counterparts: test/match/feedback5-boss-pair-prep.test.js, feedback5-boss-prep-scout.test.js,
// feedback5-watch-follow.test.js.
//
//   SP_E2E=1 node --test test/ui/feedback5-boss-pair.e2e.test.js
//
// Screenshots: test/e2e/out/boss-pair-*.png.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, sleep, hasChrome, startRealServer, problemsOf } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const HOST_KIT = ['chess_char_4_23_a', 'chess_char_4_24_a', 'chess_char_3_06_a', 'chess_char_3_13_a'];
const GUEST_KIT = ['chess_char_1_03_a', 'chess_char_1_09_a', 'chess_char_2_01_a', 'chess_char_3_21_a'];
const BOT_KIT = ['chess_char_4_01_a', 'chess_char_4_02_a', 'chess_char_3_01_a', 'chess_char_2_06_a'];

/** What the view shows in the boss round's prep: own pieces, the partner's ('m:'), the leader, the framed rows. */
const prepView = (c) => c.page.evaluate(() => {
  const s = globalThis.__SP__.store.get();
  const v = globalThis.__SP_VIEW__?.raw;
  const entries = v?.debug?.views ? [...v.debug.views.entries()] : [];
  const pick = (pre) => entries.filter(([k]) => String(k).startsWith(pre)).map(([, x]) => ({ id: x.info?.defId, owner: x.info?.ownerId ?? null, x: Math.round(x.x), y: Math.round(x.y), dir: x.info?.dir ?? null }));
  return {
    me: s.me.playerId, phase: s.match.public?.phase, camKind: v?.debug?.camKind ?? null, mode: v?.mode ?? null,
    pair: s.match.public?.bossPairs?.find(g => g.includes(s.me.playerId)) ?? [],
    field: s.match.field ? { fieldId: s.match.field.fieldId, kind: s.match.field.kind, prep: !!s.match.field.prep, side: s.match.field.side ?? null } : null,
    own: pick('p:'), mates: pick('m:'), scout: entries.filter(([k]) => typeof k === 'number' || /^\d+$/.test(String(k))).length,
    leader: v?.debug?.leader ? { key: v.debug.leader.key, shown: !!v.debug.leader.view?.root?.visible } : null,
    framed: [...document.querySelectorAll('.team__row.is-team .team__name')].map((n) => n.textContent),
    names: Object.fromEntries((s.match.public?.players || []).map((p) => [p.playerId, p.name])),
    bossMate: s.match.private?.bossMate ? { playerId: s.match.private.bossMate.playerId, side: s.match.private.bossMate.side } : null,
  };
});

async function coopAtBoss(P, base, prefix) {
  const host = new Client(P, base, 'host', { prefix: `${prefix}-host`, w: 1280, h: 720 });
  const guest = new Client(P, base, 'guest', { prefix: `${prefix}-guest`, w: 1280, h: 720 });
  await host.open();
  await host.enter('凯尔希');
  const room = await host.createCoop();
  for (let i = 0; i < 2; i++) { await host.click('button', '添加 AI 队友'); await sleep(600); }
  await guest.open(`?room=${room.code}`);
  await guest.enter('阿米娅');
  await guest.waitFor((s) => s.room?.code === room.code, 'guest joined');
  for (let i = 0; i < 6; i++) { await guest.click('.room-bar__right button', '准备就绪', { optional: true, timeout: 3000 }); await sleep(500); }
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
      await c.click('.draft-detail__btns .btn--primary', '确认选择');
      picked.add(c.label);
    }
    await sleep(250);
  }
  return { host, guest };
}

describe('the boss round\'s prep: the pair together, the frames, a watcher\'s boss field (items 51 / 55, real server)', { skip: !ENABLED && 'set SP_E2E=1 (Chrome + public/assets)' }, () => {
  test('item 51: own half (mirrored on the right) + the partner\'s pieces on the other half + the pair framed, prep and fight', { timeout: 6 * 60 * 1000 }, async () => {
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 'boss', idleBots: true, autoPlace: true, kits: [HOST_KIT, GUEST_KIT], botChess: BOT_KIT } });
    const P = (await import('puppeteer-core')).default;
    let host = null;
    let guest = null;
    try {
      ({ host, guest } = await coopAtBoss(P, srv.base, 'boss-pair'));
      await host.waitFor((s) => s.phase === 'PREP' && !s.ready, 'boss-round prep', 90000);
      await host.page.waitForFunction(() => [...(globalThis.__SP_VIEW__?.raw?.debug?.views?.keys() || [])].some((k) => String(k).startsWith('m:')), { timeout: 20000 });
      await guest.page.waitForFunction(() => [...(globalThis.__SP_VIEW__?.raw?.debug?.views?.keys() || [])].some((k) => String(k).startsWith('m:')), { timeout: 20000 });
      await sleep(800);
      const hv = await prepView(host);
      const gv = await prepView(guest);
      await host.shot('prep');
      await guest.shot('prep');
      for (const v of [hv, gv]) {
        assert.equal(v.camKind, 'bossPrep');
        assert.equal(v.pair.length, 2);
        const right = v.pair.indexOf(v.me) === 1;
        assert.equal(v.bossMate?.playerId, v.pair.find(id => id !== v.me));
        assert.equal(v.bossMate.side, right ? 'L' : 'R');
        assert.ok(v.own.length >= 4 && v.own.every(u => right ? u.x >= 10 : u.x <= 10), `own side: ${JSON.stringify(v)}`);
        assert.ok(v.mates.length >= 4 && v.mates.every(u => (right ? u.x <= 10 : u.x >= 10) && u.owner === v.bossMate.playerId));
        assert.ok((right ? v.own : v.mates).some(u => u.dir === 'LEFT'), 'the right-half units mirror their facing');
      }
      assert.ok(hv.leader?.shown && gv.leader?.shown, 'the leader stands on the boss field for both');
      assert.deepEqual(hv.framed.sort(), [hv.names[hv.me], hv.names[hv.bossMate.playerId]].sort(), 'the host and its partner framed');
      assert.deepEqual(gv.framed.sort(), [gv.names[gv.me], gv.names[gv.bossMate.playerId]].sort(), 'the guest and its partner framed');
      // the fight keeps the frames
      await host.click('.readybtn');
      await guest.click('.readybtn');
      for (const c of [host, guest]) await c.waitFor((s) => s.phase === 'FINAL_ASSAULT', 'Final Assault', 90000);
      await sleep(1500);
      assert.deepEqual((await prepView(host)).framed.sort(), hv.framed.sort(), 'the fight: the same pair framed');
      assert.deepEqual(problemsOf([host, guest]), []);
    } finally {
      for (const c of [host, guest]) if (c?.problems.length) console.log(c.label, c.problems.slice(0, 20).join('\n'));
      await host?.close();
      await guest?.close();
      await srv.stop();
    }
  });

  test('item 55: an eliminated guest\'s prep shows the followed player\'s half of the boss field with the leader', { timeout: 6 * 60 * 1000 }, async () => {
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 'boss', idleBots: true, autoPlace: true, kits: [HOST_KIT, []], botChess: BOT_KIT, eliminate: [1] } });
    const P = (await import('puppeteer-core')).default;
    let host = null;
    let guest = null;
    try {
      ({ host, guest } = await coopAtBoss(P, srv.base, 'boss-scout'));
      await host.waitFor((s) => s.phase === 'PREP' && !s.ready, 'boss-round prep', 90000);
      await guest.page.waitForFunction(() => globalThis.__SP__.store.get().match.field?.kind === 'boss', { timeout: 20000 });
      await sleep(1500);
      const gv = await prepView(guest);
      await guest.shot('scout');
      assert.equal((await guest.st()).alive, false, 'the guest is eliminated');
      assert.deepEqual([gv.field?.prep, gv.field?.kind, gv.camKind], [true, 'boss', 'bossPrep'], JSON.stringify(gv.field));
      assert.equal(gv.field.fieldId, `n:${Object.keys(gv.names)[0]}`, 'following the first player still in (the host)');
      assert.ok(gv.leader?.shown, `the leader on the boss field: ${JSON.stringify(gv.leader)}`);
      assert.ok(await guest.exists('.gm__watching'), 'the read-only watching banner');
      assert.deepEqual(problemsOf([host, guest]), []);
    } finally {
      for (const c of [host, guest]) if (c?.problems.length) console.log(c.label, c.problems.slice(0, 20).join('\n'));
      await host?.close();
      await guest?.close();
      await srv.stop();
    }
  });
});
