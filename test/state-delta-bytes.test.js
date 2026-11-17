// test/state-delta-bytes.test.js — how many bytes the delta transport actually saves over one real match.
//
// The reviewer asked for the number on a live round rather than a micro-benchmark. This drives a real co-op match
// through the ordinary prep/combat pipeline, captures every public view it broadcasts, and feeds those exact views
// through the same transport a connection uses: the bytes sent versus the bytes the whole views would have cost.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { negotiateStateDelta, prepareStateFrame } from '../server/stateTransport.js';
import { makeMatch } from './match/harness.js';

/** Run a whole co-op match and return every `m.public` view it broadcast, in order. */
function capturePublicViews() {
  const h = makeMatch({
    mode: 'coop',
    difficulty: 'NORMAL',
    seats: [
      { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true },
      { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true },
      { seat: 2, playerId: 'ai_1', name: 'AI1', isBot: true, connected: true },
    ],
    seed: 11,
    hostId: 'p_0',
  }).start();
  const views = [];
  h.onBroadcast.push((msg) => { if (msg.t === 'm.public') views.push(msg); });
  // The human seat decides nothing; the AI seats play, which is enough to walk the match through several rounds.
  h.drive(() => h.ended != null, { maxSteps: 4e6 });
  h.m.dispose();
  return views;
}

test('a real match: the delta frames carry fewer bytes than the same public views sent whole', () => {
  const views = capturePublicViews();
  assert.ok(views.length >= 10, `the match broadcast enough public views to measure (saw ${views.length})`);

  const ws = {};
  negotiateStateDelta(ws, 1);
  let sent = 0;
  let whole = 0;
  let patched = 0;
  for (const view of views) {
    const encoded = JSON.stringify(view);
    whole += Buffer.byteLength(encoded);
    const frame = prepareStateFrame(ws, view, encoded);
    sent += Buffer.byteLength(frame.data);
    if (!frame.data.includes('"full"')) patched++;
    frame.commit();
  }

  const ratio = sent / whole;
  assert.ok(patched > 0, `some frames of the match were sent as patches (saw ${patched}/${views.length})`);
  // A compression that made frames bigger would be a regression, not a win: this is the hard half of the assertion.
  assert.ok(ratio < 1, `the delta frames cost less than the whole views (ratio ${ratio.toFixed(3)})`);
  // Printed for the PR conversation: the reviewer asked for the number on a real match.
  console.log(`[delta-bytes] views=${views.length} patched=${patched} whole=${whole}B sent=${sent}B ` +
    `saved=${whole - sent}B ratio=${ratio.toFixed(3)}`);
});
