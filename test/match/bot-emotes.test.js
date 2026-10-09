// test/match/bot-emotes.test.js — AI teammates' emote reactions (server/match/botEmotes.js, opt-in / SP_BOT_EMOTES=0).
//
// Eleven cases pin the boundary (silent pure-AI + silent solo + rate-limited sends) and the six hooks'
// behaviour. Pure reads of m.emote broadcasts; no rng, no scoring changes — golden is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import * as BE from '../../server/match/botEmotes.js';
import { EMOTE_COOLDOWN_MS, EMOTES } from '../../shared/constants.js';

const EMOTES_OF_BOT = (h) => h.bc.filter((m) => m && m.t === 'm.emote' && h.ps(m.playerId) && h.ps(m.playerId).isBot);

/** A small fake match helper — wrap makeMatch to expose the bot's PlayerState for hasHumans / sendEmote probes. */
function boot(o) {
  const h = makeMatch({ mode: o.mode ?? 'coop', humans: o.humans ?? 1, bots: o.bots ?? 1, seed: o.seed ?? 1, fake: true }).start();
  return h;
}

test('botEmotes: the default weighted bot module is enabled (no env switch)', () => {
  assert.equal(BE.BOT_EMOTES_ON, true, 'no SP_BOT_EMOTES env means the module is on by default');
});

test('botEmotes: hasHumans is false in a pure-AI match and true in coop', () => {
  // harness makes a coop with humans=1 + bots=1; hasHumans must agree
  const pureAi = makeMatch({ mode: 'coop', humans: 0, bots: 2, seed: 1, fake: true }).start().m;
  assert.strictEqual(BE.hasHumans(pureAi), false, 'pure-AI coop: no humans → silent');
  const coop = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed: 1, fake: true }).start().m;
  assert.strictEqual(BE.hasHumans(coop), true, '1h+1b coop: a human is seated, the bot reacts');
  // solo has no AI seat at all (1 human, 0 bots) — hasHumans is false: there is no AI to react
  const solo = makeMatch({ mode: 'solo', humans: 1, bots: 0, seed: 1, fake: true }).start().m;
  assert.strictEqual(BE.hasHumans(solo), false, 'solo lobby: no AI seat to react');
});

test('botEmotes: sendEmote obeys the per-seat cooldown', () => {
  const h = boot({ humans: 1, bots: 1 });
  const ai = h.ps('ai_0');
  ai.lastEmoteAt = -Infinity; // clear
  // bump the match sched.now (virtual clock)
  h.m.sched.now = () => 100000;
  assert.equal(BE.sendEmote(h.m, ai, 'autochess_battle_thanks'), true);
  // same emote again right after should be rate-limited
  assert.equal(BE.sendEmote(h.m, ai, 'autochess_battle_thanks'), false);
  // advance the clock past the cooldown
  h.m.sched.now = () => 100000 + EMOTE_COOLDOWN_MS + 1;
  assert.equal(BE.sendEmote(h.m, ai, 'autochess_battle_thanks'), true);
});

test('botEmotes: sendEmote rejects unknown emote ids', () => {
  const h = boot({ humans: 1, bots: 1 });
  const ai = h.ps('ai_0');
  ai.lastEmoteAt = -Infinity;
  assert.equal(BE.sendEmote(h.m, ai, 'autochess_battle_does_not_exist'), false);
  // a valid id from the catalog still works
  assert.equal(BE.sendEmote(h.m, ai, 'autochess_battle_thanks'), true);
  // sanity: ids come from EMOTES (the whitelist)
  assert.ok(EMOTES.includes('autochess_battle_thanks'));
});

test('botEmotes: hasHumans gate — onPurchase broadcasts nothing for a pure-AI match', () => {
  const h = boot({ humans: 0, bots: 2, mode: 'coop' });
  const ai = h.ps('ai_0');
  ai.lastEmoteAt = -Infinity;
  // try every hook, all should be no-ops (no humans → all hooks bail at hasHumans(m) === false)
  assert.equal(BE.onPickCard(h.m, ai, { kind: 'bounty' }), false);
  assert.equal(BE.onStartUnite(h.m, { helpers: [ai] }), false);
  assert.equal(BE.onSettle(h.m), false);
  assert.equal(BE.onMerge(h.m, ai, { kind: 'chess' }), false);
  assert.equal(BE.onGiftTicker(h.m, ai, 'a human'), false);
  assert.equal(BE.onHumanEmote(h.m, 'p_0', 'autochess_battle_thanks'), null);
  // no m.emote broadcast
  assert.equal(EMOTES_OF_BOT(h).length, 0);
});

test('botEmotes: onSettle fires exactly one line per alive AI', () => {
  const h = boot({ humans: 1, bots: 1 });
  const ai = h.ps('ai_0');
  ai.lastEmoteAt = -Infinity;
  ai.lp = 20; // alive, not eliminated
  // inject a fake "this round's last result" with zero leaks → the bot should pick the "cool" line
  h.m.lastResults = new Map([[ai.playerId, { leaked: [], perfect: true, coins: 0, layerGains: {}, killed: 0, damageDealt: 0 }]]);
  const sent = BE.onSettle(h.m);
  assert.strictEqual(sent, true, 'sent=true when at least one bot spoke');
  const lines = EMOTES_OF_BOT(h);
  assert.strictEqual(lines.length, 1, 'one line per bot per round');
  assert.strictEqual(lines[0].id, 'autochess_battle_playingcool', 'a clean round picks the "cool" emote');
  // repeat the call: cooldown blocks the second send
  const sent2 = BE.onSettle(h.m);
  assert.strictEqual(sent2, false, 'rate-limited by sendEmote');
  // still exactly one line in the broadcast log
  assert.strictEqual(EMOTES_OF_BOT(h).length, 1);
});

test('botEmotes: onSettle picks the right id per pattern', () => {
  // Each pattern picks a different emote id (the priority list lives in botEmotes.pickSettleEmote).
  const patterns = [
    { name: 'leaker', leaked: [{ counted: true }], perfect: false, coins: 0, kills: 0, expect: 'autochess_battle_scared' },
    { name: 'mvp', leaked: [], perfect: true, coins: 0, kills: 3, expect: 'autochess_battle_call' },
    { name: 'clean', leaked: [], perfect: true, coins: 0, kills: 0, expect: 'autochess_battle_playingcool' },
    { name: 'coin-only', leaked: [], perfect: false, coins: 1, kills: 0, expect: 'autochess_battle_thanks' },
    { name: 'flat', leaked: [], perfect: false, coins: 0, kills: 0, expect: null },
  ];
  for (const p of patterns) {
    const h = boot({ humans: 1, bots: 1 });
    const ai = h.ps('ai_0');
    ai.lastEmoteAt = -Infinity;
    ai.lp = 20; // alive, not eliminated
    ai.stats = { kills: p.kills, leaks: 0, damageDealt: 0 };
    h.m.lastResults = new Map([[ai.playerId, { leaked: p.leaked, perfect: p.perfect, coins: p.coins, layerGains: {}, killed: p.kills, damageDealt: 0 }]]);
    const sent = BE.onSettle(h.m);
    const lines = EMOTES_OF_BOT(h);
    if (p.expect) {
      assert.ok(sent, `${p.name}: sendEmote fired`);
      assert.strictEqual(lines.length, 1, `${p.name}: exactly one line`);
      assert.strictEqual(lines[0].id, p.expect, `${p.name}: picked ${p.expect}`);
    } else {
      assert.strictEqual(sent, false, `${p.name}: silent when no sentiment fits`);
      assert.strictEqual(lines.length, 0);
    }
    h.m.dispose();
  }
});

test('botEmotes: onPickCard fires "thinking" when a bot takes a bounty, silent otherwise', () => {
  const h = boot({ humans: 1, bots: 1 });
  const ai = h.ps('ai_0');
  ai.lastEmoteAt = -Infinity;
  // bounty card → "thinking"
  assert.equal(BE.onPickCard(h.m, ai, { kind: 'bounty' }), true);
  // tactic / item / supply → silent
  assert.equal(BE.onPickCard(h.m, ai, { kind: 'tactic' }), false);
  assert.equal(BE.onPickCard(h.m, ai, { kind: 'item' }), false);
  // a human picks: silent (humans don't say "thinking" through this hook)
  const human = h.ps('p_0');
  human.lastEmoteAt = -Infinity;
  assert.equal(BE.onPickCard(h.m, human, { kind: 'bounty' }), false);
  // settle cooldown ran out after enough time: but here we did two onPickCard calls in the same round — only the
  // bounty pick the bot made was sent, exactly one m.emote line
  const lines = EMOTES_OF_BOT(h);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].id, 'autochess_battle_thinking');
});

test('botEmotes: onStartUnite fires "cooperate" once for the first alive bot helper', () => {
  const h = boot({ humans: 1, bots: 2 });
  const ai0 = h.ps('ai_0'), ai1 = h.ps('ai_1');
  // give them a fresh cooldown so the second call (shouldn't happen anyway) is moot
  ai0.lastEmoteAt = -Infinity; ai1.lastEmoteAt = -Infinity;
  // both helpers alive → only ai_0 (the first) speaks
  assert.equal(BE.onStartUnite(h.m, { helpers: [ai0, ai1] }), true);
  const lines = EMOTES_OF_BOT(h);
  assert.equal(lines.length, 1, 'one bubble, not two');
  assert.equal(lines[0].id, 'autochess_battle_nice_cooperate');
  assert.equal(lines[0].playerId, ai0.playerId, 'the first alive helper spoke, not the second');
});

test('botEmotes: onMerge triggers "scared" only on the 3rd chess merge of the round', () => {
  const h = boot({ humans: 1, bots: 1 });
  const ai = h.ps('ai_0');
  ai.lastEmoteAt = -Infinity;
  // merge #1, #2 → silent
  assert.equal(BE.onMerge(h.m, ai, { kind: 'chess' }), false);
  assert.equal(BE.onMerge(h.m, ai, { kind: 'chess' }), false);
  assert.equal(EMOTES_OF_BOT(h).length, 0);
  // merge #3 → "scared"
  assert.equal(BE.onMerge(h.m, ai, { kind: 'chess' }), true);
  assert.equal(EMOTES_OF_BOT(h).length, 1);
  assert.equal(EMOTES_OF_BOT(h)[0].id, 'autochess_battle_scared');
  // item merges do NOT count
  assert.equal(BE.onMerge(h.m, ai, { kind: 'item' }), false);
  // reset for the next round (clear the per-match counter)
  BE.resetRoundCounters(h.m);
  assert.equal(BE.onMerge(h.m, ai, { kind: 'chess' }), false, 'counter cleared → silent again');
});

test('botEmotes: onGiftTicker fires "thanks" when a bot receives a human gift', () => {
  const h = boot({ humans: 1, bots: 1 });
  const ai = h.ps('ai_0');
  ai.lastEmoteAt = -Infinity;
  // human sends the gift → "thanks"
  assert.equal(BE.onGiftTicker(h.m, ai, 'P0'), true);
  // unknown sender → silent
  assert.equal(BE.onGiftTicker(h.m, ai, ''), false);
  // a human receiving a gift is silent
  const human = h.ps('p_0'); human.lastEmoteAt = -Infinity;
  assert.equal(BE.onGiftTicker(h.m, human, 'AI0'), false);
  const lines = EMOTES_OF_BOT(h);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].id, 'autochess_battle_thanks');
});

test('botEmotes: onHumanEmote maps the 6 most-common human emotes to a single bot reply', () => {
  const h = boot({ humans: 1, bots: 1 });
  const ai = h.ps('ai_0');
  ai.lastEmoteAt = -Infinity;
  // a few reply maps; the hook must emit exactly one line and stick to the catalog
  const cases = [
    { in: 'autochess_battle_thanks',    out: 'autochess_battle_noproblem' },
    { in: 'autochess_battle_sorry',     out: 'autochess_battle_noproblem' },
    { in: 'autochess_battle_nice_cooperate', out: 'autochess_battle_thanks' },
    { in: 'autochess_battle_happy',     out: 'autochess_battle_happy' },
    { in: 'autochess_battle_call',      out: 'autochess_battle_playingcool' },
    { in: 'autochess_battle_playingcool', out: 'autochess_battle_happy' },
    { in: 'autochess_battle_sad',       out: 'autochess_battle_sad' },
  ];
  for (const c of cases) {
    // fresh clock each case (no cooldown between rounds)
    ai.lastEmoteAt = -Infinity;
    const before = EMOTES_OF_BOT(h).length;
    const r = BE.onHumanEmote(h.m, 'p_0', c.in);
    assert.equal(r, true, `human ${c.in} → bot spoke`);
    const after = EMOTES_OF_BOT(h).length;
    assert.equal(after - before, 1, 'exactly one new line');
    const last = EMOTES_OF_BOT(h)[EMOTES_OF_BOT(h).length - 1];
    assert.equal(last.id, c.out, `${c.in} maps to ${c.out}`);
  }
  // unknown emote → null
  ai.lastEmoteAt = -Infinity;
  const before = EMOTES_OF_BOT(h).length;
  assert.equal(BE.onHumanEmote(h.m, 'p_0', 'autochess_battle_zzz'), null);
  assert.equal(EMOTES_OF_BOT(h).length, before);
});