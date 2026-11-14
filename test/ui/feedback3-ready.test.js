// The 准备 confirmation with funds left (community report #4 after 0.1.2): public/js/ui/gameLogic.js readyFundsPrompt,
// asked by public/js/screens/game.js toggleReady (the 准备 button and Space). The prep's end wipes unspent funds
// (PRTS 卫戍协议/帮助 「本回合的剩余资金将清零」); act2autochess constData noMoneyTipsBand lists the strategies with no such
// tip (坎诺特). The server rule is unchanged: readying is accepted, endPrep wipes the funds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readyFundsPrompt, readyCommandPrompt, readyPrompt } from '../../public/js/ui/gameLogic.js';
import { makeMatch } from '../match/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = JSON.parse(readFileSync(path.join(ROOT, 'data/config.json'), 'utf8'));
const KEPT = CONFIG.economy.leftoverFundsKeptByBands;
const priv = (o = {}) => ({ alive: true, ready: false, funds: 5, bandId: 'band_bldsk', ...o });

test('readying with funds left asks first; the text names the funds and the wipe', () => {
  const ask = readyFundsPrompt(priv(), { keptBands: KEPT });
  assert.ok(ask);
  assert.match(ask.text, /5 资金/);
  assert.match(ask.text, /剩余资金将清零/);
  assert.equal(ask.okText, '准备就绪');
  assert.equal(ask.cancelText, '继续整备');
  assert.ok(readyFundsPrompt(priv({ funds: 1 }), { keptBands: KEPT }), '1 fund is enough to ask');
});

test('no prompt: 0 funds, 坎诺特 (noMoneyTipsBand), un-ready, already ready, eliminated, AI 托管, no state', () => {
  assert.deepEqual(KEPT, ['band_cannot'], 'data/config.json carries the official noMoneyTipsBand');
  assert.equal(readyFundsPrompt(priv({ funds: 0 }), { keptBands: KEPT }), null);
  assert.equal(readyFundsPrompt(priv({ funds: -2 }), { keptBands: KEPT }), null);
  assert.equal(readyFundsPrompt(priv({ bandId: 'band_cannot', funds: 9 }), { keptBands: KEPT }), null, '坎诺特 keeps its funds');
  assert.equal(readyFundsPrompt(priv({ bandId: 'band_cannot', funds: 9 })), null, 'the official list is the fallback without config');
  assert.equal(readyFundsPrompt(priv(), { ready: false, keptBands: KEPT }), null, 'cancelling a ready never asks');
  assert.equal(readyFundsPrompt(priv({ ready: true }), { keptBands: KEPT }), null);
  assert.equal(readyFundsPrompt(priv({ alive: false }), { keptBands: KEPT }), null);
  assert.equal(readyFundsPrompt(priv(), { keptBands: KEPT, autoplay: true }), null, 'AI 托管');
  assert.equal(readyFundsPrompt(null, { keptBands: KEPT }), null);
});

test('the server rule stays: readying with funds is accepted and the prep end wipes them (坎诺特 keeps them)', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 5, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const p0 = h.ps('p_0'), p1 = h.ps('p_1');
  p0.funds = 7; p0.bandId = 'band_bldsk';
  p1.funds = 6; p1.bandId = 'band_cannot';
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
  p0.endPrep(); p1.endPrep();
  assert.equal(p0.funds, 0);
  assert.equal(p1.funds, 6);
  m.dispose();
});

test('game.js asks through readyFundsPrompt / readyCommandPrompt before g.ready (button and Space share toggleReady)', () => {
  const src = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');
  const body = src.slice(src.indexOf('const toggleReady = useCallback('), src.indexOf('const toggleReady = useCallback(') + 2200);
  assert.match(body, /const autoplay = !!me\?\.autoplay;/);
  assert.match(body, /readyFundsPrompt\(L\.priv, \{ keptBands: data\.get\('config'\)\?\.economy\?\.leftoverFundsKeptByBands, autoplay \}\)/);
  assert.match(body, /!commandAskMuted\.current \? readyCommandPrompt\(L\.priv, \{ autoplay \}\)/);
  assert.ok(body.indexOf('confirmDialog({ ...ask') > 0 && body.indexOf('confirmDialog({ ...ask') < body.indexOf('actions.ready(r)'), 'confirmed before the request');
  assert.match(src, /onReady=\$\{toggleReady\}/);
  assert.match(src, /toggleReady\(!L\.priv\.ready\)/, 'Space');
});

// §37.201: an unused drag command asks too (the owner, 2026-11-14), in the same box, mutable for the match
const cmd = (o = {}) => ({ type: 'ACTIVE', targetType: 'COMMON_CHESS', usable: true, reason: null, targets: [{ uid: 3 }], ...o });
test('a usable drag command not used this round asks; locked, passive, cooled down, broke, click-only or targetless do not', () => {
  assert.match(readyCommandPrompt(priv({ command: cmd() })).text, /指令还可以使用/);
  assert.ok(readyCommandPrompt(priv({ command: cmd({ targetType: 'TILE' }) })), 'a tile target is dragged too');
  assert.equal(readyCommandPrompt(priv({ command: cmd({ targetType: 'NO_TARGET' }) })), null, 'a click command');
  assert.equal(readyCommandPrompt(priv({ command: cmd({ type: 'PASSIVE' }) })), null);
  assert.equal(readyCommandPrompt(priv({ command: cmd({ type: 'NONE', usable: false, reason: 'locked' }) })), null);
  assert.equal(readyCommandPrompt(priv({ command: cmd({ usable: false, reason: 'cooldown' }) })), null);
  assert.equal(readyCommandPrompt(priv({ command: cmd({ usable: false, reason: 'funds' }) })), null);
  assert.equal(readyCommandPrompt(priv({ command: cmd({ targets: [] }) })), null, 'no target this round');
  assert.equal(readyCommandPrompt(priv({ command: null })), null);
  assert.equal(readyCommandPrompt(priv({ command: cmd(), ready: true })), null);
  assert.equal(readyCommandPrompt(priv({ command: cmd() }), { ready: false }), null, 'cancelling a ready never asks');
  assert.equal(readyCommandPrompt(priv({ command: cmd() }), { autoplay: true }), null, 'AI 托管');
  assert.equal(readyCommandPrompt(priv({ command: cmd(), alive: false })), null);
});

test('one box for both reasons: the command sentence first, the funds question last; only the command makes it mutable', () => {
  const funds = readyFundsPrompt(priv({ funds: 4 }), { keptBands: KEPT });
  const command = readyCommandPrompt(priv({ command: cmd() }));
  const both = readyPrompt(funds, command);
  assert.equal(both.title, '准备就绪前');
  assert.equal(both.lines.length, 2);
  assert.match(both.lines[0], /指令还可以使用/);
  assert.match(both.lines[1], /4 资金未使用.*确定准备就绪吗/);
  assert.equal(both.mutable, true);
  const onlyCommand = readyPrompt(null, command);
  assert.equal(onlyCommand.title, '指令未使用');
  assert.deepEqual(onlyCommand.lines.slice(1), ['确定准备就绪吗？']);
  assert.equal(onlyCommand.mutable, true);
  const onlyFunds = readyPrompt(funds, null);
  assert.equal(onlyFunds.title, '剩余资金');
  assert.deepEqual(onlyFunds.lines, [funds.text]);
  assert.equal(onlyFunds.mutable, false);
  assert.equal(readyPrompt(null, null), null);
  assert.equal(both.okText, '准备就绪');
  assert.equal(both.cancelText, '继续整备');
});
