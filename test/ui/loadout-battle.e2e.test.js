// Real-server browser E2E of user playtest #2 item 1 end to end (DESIGN §16): the loadout chosen in the 干员调配
// overlay reaches the server (room.loadout → seat → Match → m.private.loadout), the battle spec (units[].skillIndex /
// moduleId) and the browser's own local battle (client-side combat, DESIGN §14), which fights with the chosen skill and
// module — checked by the skill's signature effect in the local sim, not only by ids.
//
//   SP_E2E=1 node --test test/ui/loadout-battle.e2e.test.js
//
// The chess: elite 野鬃 (chess_char_1_19_b). Default = S2 夹枪冲锋 (25/40 SP) + module 长枪替补套装 (ATK +40, ASPD +3).
// Chosen here: S1 骑枪刺击 (ON_DEPLOY: "部署后攻击速度+100" for 25 s) + 不装备 — so right after the unit deploys the
// local battle must show S1 active with a draining duration bar, ASPD +100 and the no-module stats (ATK 524, ASPD 100).
// The server is test/e2e/fastServer.mjs with its starter-kit hook (SP_START_CHESS: the elite in the hand at round 1);
// everything else is the real match engine and the real UI driven by real mouse input.
// Screenshots: test/e2e/out/loadout-battle-*.png.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, sleep, hasChrome, startRealServer, problemsOf } from '../e2e/client.mjs';
import { makeBattle } from '../helpers/battleHarness.js';
import { UF } from '../../shared/constants.js';
import { COLORS } from '../../public/js/render/style.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const BASE = 'chess_char_1_19_a';
const ELITE = 'chess_char_1_19_b';

/** Item 11: the phase's server deadline and the countdown widgets actually shown. */
const untimed = (c) => c.page.evaluate(() => ({
  deadline: !!globalThis.__SP__.store.get().match.public?.deadline,
  shown: [...document.querySelectorAll('.countdown')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(el).display !== 'none'; }).length,
}));

describe('user playtest #2 item 1 — loadout chosen in the UI fights in the local battle (real server)', { skip: !ENABLED && 'set SP_E2E=1 (Chrome + public/assets)' }, () => {
  test('干员调配 S1 + 不装备 for 野鬃 → m.private.loadout → b.start spec → the local sim runs S1 with the no-module stats', { timeout: 6 * 60 * 1000 }, async () => {
    const chess = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
    const rec = (Array.isArray(chess) ? chess : Object.values(chess.chess || chess)).find((x) => x && x.chessId === ELITE);
    const s1 = rec.skills.find((s) => s.index === 0);
    assert.equal(s1.skillId, 'skchr_wildmn_1');
    assert.equal(s1.spType, 'ON_DEPLOY');
    assert.notEqual(rec.skills.find((s) => s.isDefault).index, 0, 'S1 is not the default skill');
    assert.ok(rec.modules.some((m) => m.isDefault && m.uniEquipId !== 'uniequip_001'), 'the elite has a default module');

    const srv = await startRealServer({ fast: { timerScale: 0.5, combatSpeed: 2, startRound: 1, chess: [ELITE] } });
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'loadout', { prefix: 'loadout-battle' });
    try {
      await c.open();
      await c.enter('调配');
      // 1) the 干员调配 overlay: search 野鬃 → S1 + 不装备 (real clicks), synced with the server
      await c.click('.lobby-screen [data-testid="loadout-open"]');
      await c.page.waitForSelector('.lo .lo-card', { visible: true, timeout: 15000 });
      await c.click('.lo-search input');
      await c.page.keyboard.type('野鬃');
      await c.page.waitForFunction(() => document.querySelectorAll('.lo-card').length === 1, { timeout: 5000 });
      await c.click('.lo-card');
      await c.click('.lo-detail .lo-skill[data-skill="0"]');
      await c.click('.lo-detail .lo-mod[data-module="none"]');
      await c.page.waitForFunction(() => document.querySelector('.lo-skill.is-on[data-skill="0"]') && document.querySelector('.lo-mod.is-on[data-module="none"]'), { timeout: 3000 });
      await c.page.waitForFunction(() => /已同步/.test(document.querySelector('.lo-sync')?.textContent || ''), { timeout: 8000 });
      await c.shot('overlay');
      await c.page.keyboard.press('Escape');
      await c.page.waitForFunction(() => !document.querySelector('.lo'), { timeout: 3000 });

      // 2) a solo 标准 match: the briefing's m.private carries the loadout
      await c.click('.mode-card', '独立模拟');
      await c.click('.diff-card', '标准模拟');
      await c.click('.create-box button', '开始独立模拟');
      await c.waitFor((s) => !!s.room, 'solo room');
      if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      const lo = await c.page.evaluate(() => globalThis.__SP__.store.get().match.private?.loadout ?? null);
      assert.deepEqual(lo, { [BASE]: { skill: 0, module: 'none' } }, 'the match received the loadout');
      await c.click('.brief__foot .btn--primary', '准备就绪');
      await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
      await sleep(500);
      assert.deepEqual(await untimed(c), { deadline: false, shown: 0 }, 'item 11: the solo strategy draft is untimed');
      await c.click('.dband', null, { nth: 1 });
      await c.click('.draft-detail__btns .btn--primary', '确认选择');
      await c.waitFor((s) => s.phase === 'PREP' && !s.ready && s.hand > 0, 'prep with the starter kit', 60000);
      await sleep(1800); // camera flight + pieces
      assert.deepEqual(await untimed(c), { deadline: false, shown: 0 }, 'item 11: solo prep is untimed');

      // 3) place the elite (drag → direction wheel)
      await c.hookRequests();
      const [piece] = (await c.handPieces('chess')).filter((p) => p.id === ELITE);
      assert.ok(piece, 'the elite 野鬃 is in the hand');
      const tile = await c.freeTileFor(piece.uid);
      assert.ok(tile, 'a legal tile');
      const from = await c.piecePoint(piece.uid);
      const to = await c.tilePoint(tile.row, tile.col);
      await c.drag(from, to);
      await c.page.waitForSelector('.fwheel__dia', { timeout: 4000 });
      await c.swipe('RIGHT');
      await c.waitFor((s) => s.board > 0, 'placed', 8000);
      await sleep(600);

      // the detail card of the placed elite shows the chosen skill (已调配) and 未装备模组
      let detail = null;
      for (const at of [0.72, 0.4, 0.88]) {
        const p = await c.piecePoint(piece.uid, at);
        if (!p) continue;
        await c.page.mouse.click(p.x, p.y, { button: 'right' }); // right-click: the detail card only
        detail = await c.page.waitForSelector('.dpanel .dskill__name', { timeout: 2500 }).then(() => c.page.evaluate(() => ({
          skill: document.querySelector('.dpanel .dskill__name')?.textContent || '',
          tag: !!document.querySelector('.dpanel .dskill__name .dtag-loadout'),
          module: document.querySelector('.dpanel .dmodule')?.textContent || '',
          none: !!document.querySelector('.dpanel .dmodule.is-none'),
          // the record (base) value: with live stats (user playtest #4 item 7: the start-of-battle preview) it is the
          // cell's title "基础 N", else the value itself
          stats: Object.fromEntries([...document.querySelectorAll('.dpanel .dstat')].map((el) => [el.querySelector('.dstat__k')?.textContent,
            (el.getAttribute('title') || '').replace(/^基础 /, '') || el.querySelector('.dstat__v')?.textContent])),
          trait: document.querySelector('.dpanel .dtrait')?.textContent || '',
        })), () => null);
        if (detail) break;
      }
      assert.ok(detail, 'the detail card opens for the placed elite');
      assert.ok(detail.skill.includes(s1.name) && detail.tag, `detail card: ${s1.name} 已调配 (${JSON.stringify(detail)})`);
      assert.ok(detail.none && detail.module.includes('未装备模组'), `detail card: 未装备模组 (${JSON.stringify(detail)})`);
      // …and the stats / 特性 the unit fights with: no module (ATK 524, interval 1.00 s, "获得1点") — not the default module's
      assert.equal(detail.stats['攻击'], String(rec.statsBase.atk), `detail card ATK without the module (${JSON.stringify(detail.stats)})`);
      assert.equal(detail.stats['攻击间隔'], '1.00s', 'detail card interval: ASPD 100');
      assert.match(detail.trait, /获得1点部署费用/, `detail card 特性 without the module (${detail.trait})`);
      await c.shot('detail');
      await c.page.keyboard.press('Escape');
      await c.page.waitForFunction(() => !document.querySelector('.dpanel'), { timeout: 4000 });

      // 4) ready → the local battle
      await c.click('.readybtn');
      await c.waitFor((s) => s.phase === 'COMBAT', 'combat', 60000);
      const got = await c.page.waitForFunction((uid) => {
        const r = globalThis.__SP_RUNNER__;
        const e = r && [...r._entries.values()].find((x) => x.own && x.battle);
        if (!e) return false;
        const u = e.battle.allyUnits.find((x) => x.uid === uid);
        if (!u?.skill?.active || u.skill.id !== 'skchr_wildmn_1') return false;
        const tuple = e.battle.snapshot().units.find((t) => t[0] === u.id);
        const entry = (e.spec.players || []).flatMap((p) => p.units || []).find((x) => x.uid === uid) || null;
        return {
          authoritative: e.authoritative, t: e.battle.time,
          spec: entry && { chessId: entry.chessId, skillIndex: entry.skillIndex, moduleId: entry.moduleId },
          skill: u.skill?.id ?? null, source: u.kit?.skillSource ?? null, active: !!u.skill?.active,
          loadout: u.def?.loadout ?? null, atk: u.def?.stats?.atk, aspd: u.def?.stats?.aspd,
          liveAspd: u.s.aspd, timeLeft: u.skill.timeLeft, duration: u.skill.duration, ready: u.skill.ready,
          bar: tuple && { value: tuple[5], max: tuple[6] },
        };
      }, { timeout: 30000, polling: 100 }, piece.uid).then((h) => h.jsonValue())
        .catch(async (err) => {
          const dbg = await c.page.evaluate((uid) => {
            const r = globalThis.__SP_RUNNER__;
            const e = r && [...r._entries.values()].find((x) => x.own && x.battle);
            const u = e?.battle.allyUnits.find((x) => x.uid === uid);
            return { entries: r ? r._entries.size : -1, unit: u ? { skill: u.skill?.id, active: u.skill?.active, buffs: u.buffs.map((b) => b.key) } : null };
          }, piece.uid);
          throw new Error(`${err.message} — ${JSON.stringify(dbg)}`);
        });
      assert.equal(got.authoritative, true, 'the own normal battle is simulated by this browser');
      assert.deepEqual(got.spec, { chessId: ELITE, skillIndex: 0, moduleId: 'none' }, 'b.start spec carries the loadout');
      assert.equal(got.skill, 'skchr_wildmn_1', 'the local unit carries S1');
      assert.equal(got.source, 'skills', 'with its hand-authored spec');
      assert.deepEqual({ skillIndex: got.loadout?.skillIndex, moduleId: got.loadout?.moduleId }, { skillIndex: 0, moduleId: 'none' });
      assert.equal(got.atk, rec.statsBase.atk, 'no module: base ATK (the default module adds +40)');
      assert.equal(got.aspd, rec.statsBase.aspd, 'no module: base ASPD');
      assert.notEqual(rec.stats.atk, rec.statsBase.atk, 'control: the default module would change ATK');
      assert.equal(got.liveAspd - got.aspd, s1.bb.attack_speed, 'S1 signature: ASPD +100 on deploy');
      assert.equal(got.ready, false, 'deployment consumed its sole charge');
      assert.equal(got.duration, s1.duration);
      assert.equal(got.bar.max, s1.duration, 'zero-SP skill has a duration bar');
      assert.ok(Math.abs(got.bar.value - got.timeLeft) <= 0.06);
      assert.ok(got.active, 'S1 is active right after deploying');
      assert.ok(got.t < 10, `S1 fires on deploy (t = ${got.t}), long before S2 could charge (25/40 SP)`);
      await sleep(800);
      await c.shot('combat');
      // the battle ends and the round settles normally (the result upload is accepted)
      await c.waitFor((s) => s.phase === 'PREP' && s.round >= 2 || !!s.result, 'next prep', 180000);
      assert.deepEqual(problemsOf([c]), []);
    } finally {
      if (c.problems.length) console.log(c.problems.slice(0, 20).join('\n'));
      await c.close();
      await srv.stop();
    }
  });

  test('野鬃 S1 duration bar: full on deploy, half remaining, hidden after expiry (real renderer)', { timeout: 120000 }, async () => {
    const h = makeBattle({
      stageId: 'act2autochess_m01', autoFinish: false, timeLimit: 60,
      units: [{ chessId: ELITE, skillIndex: 0, moduleId: 'none', row: 9, col: 5 }],
    });
    h.b.start();
    const u = h.unit(ELITE);
    assert.equal(u.skill.id, 'skchr_wildmn_1');
    const meta = { ...h.b.fieldMeta(), stageId: 'act2autochess_m01' };
    const frames = [];
    for (const [name, elapsed, share] of [['full', 0, 1], ['half', u.skill.duration / 2, 0.5], ['ended', u.skill.duration / 2 + h.TICK, 0]]) {
      h.run(elapsed);
      const { t, ...rest } = h.snapshot();
      frames.push({ name, share, snap: { ...rest, t: 'b.snap', gt: t } });
      assert.equal(u.skill.ready, false, `${name}: no remaining deploy charge`);
      assert.equal(u.skill.active, name !== 'ended');
    }
    const srv = await startRealServer();
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'duration', { prefix: 'loadout-battle' });
    try {
      await c.open();
      await c.page.goto(`${srv.base}/dev/render-demo.html?scene=normal-m01&paused=1&panel=0`);
      await c.page.waitForFunction('window.__demo && (window.__demo.ready || window.__demo.error)', { timeout: 30000 });
      assert.equal(await c.page.evaluate(() => window.__demo.error ?? null), null);
      for (const f of frames) {
        await c.page.evaluate((meta, snap) => {
          const v = window.__demo.view;
          v.enterBattle(meta);
          v.setCamera('normal', { rect: meta.rect, side: 'L', instant: true });
          v.setLocalFeed({ on: true, speed: 2 });
          v.pushSnapshot(snap);
        }, meta, f.snap);
        await c.page.waitForFunction((id, spMax) => {
          const x = window.__demo.view.debug.views.get(id);
          return x?.spineReady && x.hud.visible && x.hud.alpha > 0.99 && x.hpFill.visible && x.spMax === spMax;
        }, { timeout: 15000 }, u.id, f.snap.units.find((t) => t[0] === u.id)[6]);
        const bar = await c.page.evaluate((id) => {
          const x = window.__demo.view.debug.views.get(id);
          return { visible: x.spFill.visible, bg: x.spBg.visible, share: x.spFill.width / (x.spBg.width - 2),
            tint: x.spFill.tint, flags: x.flags, glow: x.spGlow.visible, sp: x.sp, max: x.spMax };
        }, u.id);
        assert.equal(bar.glow, false, `${f.name}: no ready highlight`);
        assert.equal(!!(bar.flags & UF.SKILL), f.name !== 'ended');
        assert.equal(bar.visible, f.name !== 'ended');
        assert.equal(bar.bg, f.name !== 'ended');
        if (bar.visible) {
          assert.ok(Math.abs(bar.share - f.share) < 0.002, `${f.name}: drawn share ${bar.share}`);
          assert.equal(bar.tint, COLORS.spActive);
        } else assert.deepEqual([bar.sp, bar.max], [0, 0]);
        await c.shot(`duration-${f.name}`);
      }
      assert.deepEqual(problemsOf([c]), []);
    } finally {
      await c.close();
      await srv.stop();
    }
  });
});
