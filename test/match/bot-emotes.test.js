import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as BE from '../../server/match/botEmotes.js';
import { EMOTE_COOLDOWN_MS } from '../../shared/constants.js';
import { makeMatch, give, giveItem, DATA } from './harness.js';
const E = (name) => `autochess_battle_${name}`;
function fixture() {
  const human = { playerId: 'human', isBot: false, alive: true };
  const ai = { playerId: 'ai', isBot: true, alive: true, lastEmoteAt: -Infinity };
  const other = { playerId: 'other', isBot: true, alive: true, lastEmoteAt: -Infinity };
  const messages = [];let now = 10000;
  const m = { round: 1, order: [human, ai, other], lastResults: new Map(), sched: { now: () => now },
    alivePlayers: () => m.order.filter((p) => p.alive), broadcast: (x) => messages.push(x) };
  return { m, human, ai, other, messages, advance: () => { now += EMOTE_COOLDOWN_MS + 1; } };
}
test('AI emotes use the existing whitelist and cooldown, never impersonate a human', () => {
  const { m, ai, human, messages, advance } = fixture();
  assert.equal(BE.sendEmote(m, human, E('thanks')), false);
  assert.equal(BE.sendEmote(m, ai, 'bad'), false);
  assert.equal(BE.sendEmote(m, ai, E('thanks')), true);
  assert.equal(BE.sendEmote(m, ai, E('thanks')), false);
  advance();assert.equal(BE.sendEmote(m, ai, E('thanks')), true);
  ai.alive = false;advance();assert.equal(BE.sendEmote(m, ai, E('thanks')), false);
  assert.equal(messages.length, 2);
});
test('one eligible AI answers a human, cooling seats are skipped; AI messages do not recurse', () => {
  const { m, human, ai, other, messages } = fixture();ai.lastEmoteAt = m.sched.now();
  assert.equal(BE.onHumanEmote(m, human.playerId, E('thanks')), true);
  assert.deepEqual(messages.map((x) => x.playerId), [other.playerId]);
  assert.equal(BE.onHumanEmote(m, ai.playerId, E('thanks')), false);
  assert.equal(BE.onHumanEmote(m, 'unknown', E('thanks')), false);
});
test('pure AI and solo games stay silent at every entry point', () => {
  for (const pureAI of [true, false]) {
    const { m, human, ai, messages } = fixture();m.order = pureAI ? [ai] : [human];
    BE.sendEmote(m, ai, E('thanks'));BE.onHumanEmote(m, human.playerId, E('thanks'));
    BE.onSettle(m);BE.onPickCard(m, ai, { kind: 'bounty' });BE.onStartUnite(m, { helpers: [ai] });
    BE.onGiftTicker(m, ai, human.playerId);for (let n=0;n<3;n++) BE.onMerge(m, ai, { kind: 'chess' });
    assert.deepEqual(messages, []);
  }
});
test('settlement uses this round, breaks kill ties by damage and cannot repeat after cooldown', () => {
  const { m, ai, other, messages, advance } = fixture();
  ai.stats = { kills: 999 };other.stats = { kills: 0 };
  m.lastResults.set(ai.playerId, { killed: 2, damageDealt: 10, leaked: [{ counted: true }], perfect: false });
  m.lastResults.set(other.playerId, { killed: 2, damageDealt: 20, leaked: [], perfect: true });
  assert.equal(BE.pickSettleEmote(m, ai), E('scared'));assert.equal(BE.pickSettleEmote(m, other), E('call'));
  assert.equal(BE.onSettle(m), true);advance();assert.equal(BE.onSettle(m), false);
  assert.equal(messages.length, 2);m.round++;assert.equal(BE.onSettle(m), true);
});
test('third chess merge reacts once per round, not to items or every later merge', () => {
  const { m, ai, messages, advance } = fixture();
  BE.onMerge(m, ai, { kind: 'item' });
  for(let n=0;n<8;n++) { BE.onMerge(m, ai, { kind: 'chess' });advance(); }
  assert.equal(messages.length, 1);BE.resetRoundCounters(m);
  for(let n=0;n<3;n++) { BE.onMerge(m, ai, { kind: 'chess' });advance(); }
  assert.equal(messages.length, 2);
});
test('gift reactions identify the source player rather than an operator display name', () => {
  const { m, ai, human, other, messages } = fixture();
  assert.equal(BE.onGiftTicker(m, ai, '琳琅诗怀雅'), false);
  assert.equal(BE.onGiftTicker(m, ai, other.playerId), false);
  assert.equal(BE.onGiftTicker(m, ai, human.playerId), true);
  assert.equal(messages.length, 1);
});
test('environment switch suppresses every emote entry point', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {sendEmote} from './server/match/botEmotes.js';
    const ai={playerId:'ai',isBot:true,alive:true};
    if(sendEmote({order:[ai,{isBot:false}]},ai,'autochess_battle_thanks')) process.exit(2);
  `], { env: { ...process.env, SP_BOT_EMOTES: '0' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
test('actual match emote and merge hooks broadcast without errors', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed: 1, fake: true }).start().toPrep();t.after(() => h.m.dispose());
  const [human, ai] = h.m.order;human.lastEmoteAt = ai.lastEmoteAt = -Infinity;
  assert.equal(h.m.emote(human, E('thanks')).ok, true);
  const c = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 1);
  for (let n=0;n<3;n++) ai.acquireChess(c.chessId);
  assert.equal(h.m._botEmotesMerges.get(ai.playerId), 1);
});

test('real beacon delivery from a human makes the receiving bot thank the correct player', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 31, fake: true }).start().toPrep();
  t.after(() => h.m.dispose());
  const [human, ai] = h.m.order;
  ai.isBot = true; ai.lastEmoteAt = -Infinity;
  const c = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 2 && c.bonds.length);
  const carrier = give(h.m, human, c.chessId, 'hand');
  const item = giveItem(h.m, human, 'chess_item_5_04_e_a');
  assert.equal(h.m.handle(human.playerId, { t: 'g.equip', itemUid: item.uid, targetUid: carrier.uid }).ok, true);
  h.m.round = 2;
  h.m.dispatch(human, 'onRoundStart', { round: 2 });
  assert.ok(h.bc.filter((e) => e.t === 'm.emote').some((e) => e.playerId === ai.playerId && e.id === E('thanks')));
  assert.equal(human.effects.filter((e) => e.key === 'effect:builtin_gift').length, 0);
  assert.equal(h.m.errorCount, 0);
});
