// test/ui/version-vote.test.js — the room's version vote strip (public/js/ui/versionVote.js, DESIGN §35.23 M1; protocol §4 /
// §5): room.state.versionVote read tolerantly; a voter who has not agreed gets 同意切换 / 拒绝切换, one who agreed waits, the
// host gets 取消投票, a spectator (no voter) only reads it; the count, the voters' chips and the countdown; the room's
// facts with another version (needsContent gates ready and start, not the 非官方 mark); the pill's and the GoButton's
// texts in the room source; the messages the strip sends validate against the protocol.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { versionVoteOf, versionVoteFacts, VersionVoteView, secondsLeft } = await import('../../public/js/ui/versionVote.js');
const { roomFacts } = await import('../../public/js/screens/room.js');
const { VersionTag } = await import('../../public/js/ui/pluginTag.js');

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const textOf = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v) : Array.isArray(v) ? v.map(textOf).join('') : textOf(v.props?.children));
const byTestId = (tree, id) => [...walk(tree)].find((n) => n.props?.['data-testid'] === id) || null;

const room = (vote, extra = {}) => ({
  code: 'ABCD', mode: 'coop', hostId: 'p1', version: 'act1autochess',
  seats: [{ seat: 0, playerId: 'p1', name: 'Host' }, { seat: 1, playerId: 'p2', name: 'Guest' }, { seat: 2, playerId: 'bot', name: 'AI', isBot: true }],
  spectators: [{ playerId: 'p9', name: 'Watcher' }],
  content: { cs: 'ab'.repeat(32), vanilla: true, version: 'act1autochess', plugins: [] },
  ...(vote ? { versionVote: vote } : {}), ...extra,
});
const VOTE = { id: 7, proposerId: 'p1', version: 'act2autochess@V2_1', voters: ['p1', 'p2'], agreed: ['p1'], remainingMs: 41_200 };
const draw = (r, myId, extra = {}) => VersionVoteView({ facts: versionVoteFacts(r, myId), seconds: 42, onAgree() {}, onDecline() {}, onCancel() {}, ...extra });

test('versionVoteOf: the open vote, tolerantly; nothing without one or with a malformed one', () => {
  assert.equal(versionVoteOf(room(null)), null);
  assert.equal(versionVoteOf(room({ ...VOTE, id: '7' })), null);
  assert.equal(versionVoteOf(room({ ...VOTE, voters: 'p1' })), null);
  const v = versionVoteOf(room({ ...VOTE, remainingMs: -5 }));
  assert.deepEqual([v.id, v.version, v.voters, v.agreed, v.remainingMs], [7, 'act2autochess@V2_1', ['p1', 'p2'], ['p1'], 0]);
});

test('a voter who has not agreed: 同意切换 / 拒绝切换, the count, the chips, the countdown', () => {
  const tree = draw(room(VOTE), 'p2');
  assert.match(textOf(tree), /切换到「第二期上半」投票：1\/2/);
  assert.match(textOf(tree), /42/);
  assert.match(textOf(tree), /Host · 已同意/);
  assert.match(textOf(tree), /Guest · 待同意/);
  assert.ok(byTestId(tree, 'version-agree') && byTestId(tree, 'version-decline'));
  assert.equal(byTestId(tree, 'version-cancel'), null, 'not the host');
  assert.equal(tree.props['aria-live'], 'polite');
  const countdown = [...walk(tree)].find((n) => n.props?.class === 'vervote__time');
  assert.equal(countdown.props['aria-hidden'], 'true', 'the live region never announces countdown ticks');
  const floating = draw(room(VOTE), 'p2', { floating: true });
  assert.equal(floating.props.role, 'alertdialog');
  assert.equal(floating.props.tabindex, '-1', 'the dialog can receive focus without focusing a vote button');
});

test('the host (counted as agreed): only 取消投票; a spectator only reads it; offline disables the buttons', () => {
  const host = draw(room(VOTE), 'p1');
  assert.equal(byTestId(host, 'version-agree'), null);
  assert.ok(byTestId(host, 'version-cancel'));
  const spec = draw(room(VOTE), 'p9');
  assert.ok(spec, 'shown to a spectator');
  assert.equal(byTestId(spec, 'version-agree'), null);
  assert.equal(byTestId(spec, 'version-cancel'), null);
  const off = draw(room(VOTE), 'p2', { online: false });
  assert.equal(byTestId(off, 'version-agree').props.disabled, true);
  assert.equal(byTestId(off, 'version-decline').props.disabled, true);
  assert.equal(draw(room(null), 'p2'), null, 'no vote: no strip');
});

test('the clicks reach their handlers; the countdown anchors on a duration', () => {
  const calls = [];
  const tree = draw(room(VOTE), 'p2', { onAgree: () => calls.push('agree'), onDecline: () => calls.push('decline') });
  byTestId(tree, 'version-agree').props.onClick();
  byTestId(tree, 'version-decline').props.onClick();
  assert.deepEqual(calls, ['agree', 'decline']);
  assert.equal(secondsLeft(10_000 + 41_200, 10_000), 42);
  assert.equal(secondsLeft(10_000, 99_000), 0);
});

test('the messages the strip sends are the protocol\'s (room.versionVote / room.cancelVersionVote, voteId)', () => {
  const src = readFileSync(path.join(ROOT, 'public/js/ui/versionVote.js'), 'utf8');
  assert.match(src, /net\.request\('room\.versionVote', \{ voteId: id, agree: true \}\)/);
  assert.match(src, /net\.request\('room\.versionVote', \{ voteId: id, agree: false \}\)/);
  assert.match(src, /net\.request\('room\.cancelVersionVote', \{ voteId: id \}\)/);
  assert.match(src, /if \(pending\.current\) return;/, 'one request at a time (like 重刷本局)');
});

test('the room\'s facts with another version: ready and start wait for every page\'s check; not 非官方', () => {
  const r = room(null, { seats: [{ seat: 0, playerId: 'p1', content: 'ready' }, { seat: 1, playerId: 'p2', content: 'loading', ready: false, connected: true }] });
  const host = roomFacts(r, 'p1');
  assert.deepEqual([host.needsContent, host.versionRoom, host.modded, host.contentReady, host.canStart], [true, true, false, false, false]);
  const guest = roomFacts(r, 'p2');
  assert.equal(guest.myContent, 'loading');
  const ready = roomFacts({ ...r, seats: [{ seat: 0, playerId: 'p1', content: 'ready' }, { seat: 1, playerId: 'p2', content: 'ready', ready: true, connected: true }] }, 'p1');
  assert.equal(ready.canStart, true);
  const plain = roomFacts({ code: 'X', mode: 'coop', hostId: 'p1', seats: [{ seat: 0, playerId: 'p1' }], content: { cs: 'ab'.repeat(32), vanilla: true, plugins: [] } }, 'p1');
  assert.deepEqual([plain.needsContent, plain.myContent], [false, 'ready'], 'a 第二期下半 room: unchanged');
});

test('VersionTag: another version\'s name; nothing for 第二期下半 or an unknown id', () => {
  assert.equal(VersionTag({ version: 'act2autochess' }), null);
  assert.equal(VersionTag({ version: null }), null);
  assert.equal(VersionTag({ room: { code: 'A' } }), null);
  assert.equal(VersionTag({ version: 'zzz' }), null);
  const tag = VersionTag({ room: { version: 'act1autochess@V1_1' } });
  assert.equal(textOf(tag), '第一期上半');
  assert.equal(tag.props['data-version'], 'act1autochess@V1_1');
});

test('the room screen: the strip between the 观战席 and the footer, the version pill, the vote blocks 开始模拟, the banner, the invite', () => {
  const src = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
  assert.match(src, /<\$\{SpectatorBar\}[^\n]*\/>\n\s*<\$\{VersionVote\} room=\$\{room\} \/>/);
  assert.match(src, /data-testid="room-version"/);
  assert.match(src, /disabled=\$\{!facts\.canStart \|\| !online \|\| busy === 'start' \|\| !!vote\}/);
  // gameplay plugins no longer block a proposal on the page: the server checks their manifest versions
  assert.doesNotMatch(src, /facts\.modded \? t\('请先关闭改变玩法的插件'\)/);
  assert.match(src, /data-testid="version-banner"/);
  assert.match(src, /t\('\{name\}邀请你加入卫戍协议：盟约·\{version\}【\{difficulty\}】'/);
  assert.match(src, /net\.request\('room\.proposeVersion', \{ version \}\)/);
  const game = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');
  assert.match(game, /voteRoom && \(hasResult \|\| mode === 'result'\) \? html`<\$\{VersionVote\} room=\$\{voteRoom\} class="vervote--float" \/>`/, 'the settlement screen shows the vote');
});
