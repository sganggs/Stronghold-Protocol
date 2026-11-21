// test/ui/seat-art.test.js — 名片干员 on the room's seat cards (PR #643 split 6, public/js/ui/seatArt.js): the pickable
// operators (one per charId of the visible, non-自选 chess records, the elite form, plus the 自选编队 pool of backups.json
// — #877; 6★ first), the default pool (5★/6★ by
// charId), the operator a seat shows (one's own local pick at once, a teammate's seats[].card, else one chosen by the
// player id — the same whatever order the records arrive in; none for a bot or an empty seat), the outfit it wears
// (seatCardSkin, the maintainer's decision 4 of 2026-10-21), the picture a card falls back to when one fails to load
// (seatArtSrc: the outfit, the default portrait, the avatar frame), the pick's store, and room.css following 文字大小
// without !important. Other periods (#877, DESIGN §37.325): the roster's records (rosterOperators, cardName), the seat
// cards resolving them without touching the default pool (cardContext extra), the picker's groups (cardGroups) and the
// draft's outfits from the room's seats (cardSkinPlayers). (The server's whitelist: test/lobby-card.test.js; the browser:
// test/ui/room-cards.e2e.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CARD_PREF, CARD_KEY, cardStore, setCard, parseStoredCard, cardOperators, cardContext, seatOperator, seatCardSkin, seatArtSrc,
  cardName, rosterOperators, cardGroups, cardSkinPlayers } from '../../public/js/ui/seatArt.js';
import { chessPortraitUrl, chessAvatarUrl } from '../../public/js/ui/assetUrls.js';
import { CARD_PERIOD_ORDER } from '../../shared/cardRoster.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHESS = Object.values(JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8')));
const BACKUPS = JSON.parse(readFileSync(path.join(ROOT, 'data/backups.json'), 'utf8'));
const ROSTER = JSON.parse(readFileSync(path.join(ROOT, 'data/card-roster.json'), 'utf8'));

test('the pickable operators: one per visible, non-自选 charId, the elite form, 6★ first', () => {
  const list = cardOperators(CHESS);
  const ids = list.map((c) => c.charId);
  assert.equal(new Set(ids).size, ids.length, 'one record per charId');
  const visible = new Set(CHESS.filter((c) => !c.isDiy && c.visible !== false && typeof c.charId === 'string').map((c) => c.charId));
  assert.deepEqual(new Set(ids), visible);
  assert.ok(!ids.includes('char_616_pithst'), 'a hidden preset is not offered');
  for (const c of list) {
    if (CHESS.some((x) => x.charId === c.charId && x.isGolden && x.visible !== false && !x.isDiy)) assert.equal(c.isGolden, true, c.charId);
  }
  for (let i = 1; i < list.length; i++) assert.ok((list[i - 1].rarity ?? 0) >= (list[i].rarity ?? 0), 'rarity descending');
  assert.equal(list[0].rarity, 6);
  assert.deepEqual(cardOperators(null), []);
  assert.deepEqual(cardOperators([null, { isDiy: true, charId: 'char_1_x' }, { charId: 7 }]), []);
});

test('the 自选编队 pool joins the list (#877): backups.diy.ownedPool, named and rated by diy.operators, no duplicate of a chess record', () => {
  const pool = BACKUPS.diy.ownedPool;
  const ops = BACKUPS.diy.operators;
  assert.ok(pool.length > 50);
  const plain = cardOperators(CHESS);
  const list = cardOperators(CHESS, BACKUPS);
  const ids = list.map((c) => c.charId);
  assert.equal(new Set(ids).size, ids.length, 'one record per charId');
  const chess = new Set(plain.map((c) => c.charId));
  for (const id of pool) {
    assert.ok(ids.includes(id), `${id} offered`);
    // a pool operator outside chess.json has no chess record: its name and rarity come from the 自选 operator table
    if (!chess.has(id)) {
      const rec = list.find((c) => c.charId === id);
      assert.equal(rec.name, ops[id].name);
      assert.equal(rec.rarity, ops[id].rarity);
      assert.equal(rec.assets, undefined, 'no chess record leaked in');
    }
  }
  // a pool id that also has a chess record keeps the chess one (its elite art), never a second entry
  for (const c of plain) if (pool.includes(c.charId)) assert.equal(list.find((x) => x.charId === c.charId), c);
  for (let i = 1; i < list.length; i++) assert.ok((list[i - 1].rarity ?? 0) >= (list[i].rarity ?? 0), 'rarity descending');
  // a pool pick is a card like any other: the seat resolves it, and the default pool may land on one
  const ctx = cardContext(list);
  const op = seatOperator({ playerId: 'p_x', name: 'X', isBot: false, card: 'char_003_kalts' }, ctx, { myId: 'p_x', myCard: 'char_003_kalts' });
  assert.equal(op.chess.charId, 'char_003_kalts');
  assert.equal(op.picked, true);
  assert.ok(ctx.pool.some((c) => c.charId === 'char_003_kalts'), 'a 6★ 自选 operator joins the default pool');
  // junk in the backups is ignored; a pool id without an operator record still shows (its charId as the name)
  const junk = { diy: { ownedPool: ['char_003_kalts', 'char_999_ghost', 7, ''], operators: { char_003_kalts: { name: '凯尔希', rarity: 6 } } } };
  const ids2 = cardOperators([], junk).map((c) => [c.charId, c.name, c.rarity]);
  assert.deepEqual(ids2, [['char_003_kalts', '凯尔希', 6], ['char_999_ghost', 'char_999_ghost', 0]]);
  assert.deepEqual(cardOperators(CHESS, null), plain, 'no backups: the chess list as before');
  assert.deepEqual(cardOperators(CHESS, {}), plain);
});

test('the default pool: 5★/6★ only, ordered by charId whatever order the records came in', () => {
  const list = cardOperators(CHESS);
  const a = cardContext(list);
  assert.ok(a.pool.length > 50 && a.pool.every((c) => c.rarity >= 5));
  const ids = a.pool.map((c) => c.charId);
  assert.deepEqual(ids, [...ids].sort());
  const b = cardContext(cardOperators([...CHESS].reverse()));
  assert.deepEqual(b.pool.map((c) => c.charId), ids);
  assert.equal(a.byChar.get('char_498_inside')?.charId, 'char_498_inside');
});

test('the operator a seat shows: own pick at once, a teammate\'s seats[].card, else the same default on every client', () => {
  const ctx = cardContext(cardOperators(CHESS));
  const other = cardContext(cardOperators([...CHESS].reverse()));
  const me = { playerId: 'p_me', name: 'Me', isBot: false, card: 'char_1012_skadi2' };
  const mate = { playerId: 'p_mate', name: 'Mate', isBot: false, card: 'char_498_inside' };
  // one's own seat: the local pick, even before the server echoes it (seat.card is still the old one)
  assert.deepEqual(seatOperator(me, ctx, { myId: 'p_me', myCard: 'char_498_inside' }), { chess: ctx.byChar.get('char_498_inside'), picked: true });
  // a teammate's seat: what the server says
  assert.equal(seatOperator(mate, ctx, { myId: 'p_me', myCard: 'char_1012_skadi2' }).chess.charId, 'char_498_inside');
  // no pick / an operator this client does not have / 默认 on one's own seat: the default by player id
  for (const [seat, own] of [[{ ...mate, card: undefined }, {}], [{ ...mate, card: 'char_999_nobody' }, {}], [me, { myId: 'p_me', myCard: '' }]]) {
    const op = seatOperator(seat, ctx, own);
    assert.equal(op.picked, false);
    assert.ok(ctx.pool.includes(op.chess));
    assert.equal(seatOperator(seat, other, own).chess.charId, op.chess.charId, 'the same default on every client');
  }
  const picks = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => seatOperator({ playerId: `p_${id}` }, ctx).chess.charId));
  assert.ok(picks.size > 1, 'different players get different defaults');
  // no portrait for a bot, an empty seat, or before the data loads
  assert.equal(seatOperator({ playerId: 'ai_1', isBot: true }, ctx), null);
  assert.equal(seatOperator(null, ctx), null);
  assert.equal(seatOperator({ playerId: 'p_x' }, cardContext([])), null);
  assert.equal(CARD_PREF, 'room.card');
});

// PR #894 follow-up: while the 自选 pool (backups) loads, a pick missing from the list draws nothing rather than a default
// operator that would swap to the real pick a moment later; a seat without a pick keeps its default at once
test('a pick not yet in the list waits while the 自选 pool loads; no pick keeps the default (PR #894 follow-up)', () => {
  const loading = cardContext(cardOperators(CHESS), { pending: true });
  const mate = { playerId: 'p_mate', name: 'Mate', isBot: false, card: 'char_003_kalts' };
  assert.equal(seatOperator(mate, loading), null, 'a pool-only pick waits');
  assert.equal(seatOperator({ ...mate, card: 'char_498_inside' }, loading).picked, true, 'a chess pick shows at once');
  assert.equal(seatOperator({ ...mate, card: undefined }, loading).picked, false, 'no pick: the default at once');
  // once loaded, an id that is still missing falls back to the default as before
  assert.equal(seatOperator(mate, cardContext(cardOperators(CHESS))).picked, false);
});

test('the outfit a seat card wears (decision 4 of 2026-10-21): one\'s own choice at once, another doctor\'s published map, the switch, the fallback', () => {
  const OP = 'char_1012_skadi2';
  const SKIN = `${OP}@test#1`;
  const me = { playerId: 'p_me', isBot: false };
  const mate = { playerId: 'p_mate', isBot: false, skins: { [OP]: SKIN } };
  const bare = { playerId: 'p_bare', isBot: false };
  const bot = { playerId: 'ai_1', isBot: true, skins: { [OP]: SKIN } };
  const players = [me, mate, bare, bot];
  const ctx = { myId: 'p_me', localSkins: { [OP]: 'mine#2' }, players, otherSkins: true };
  // one's own card: this browser's choice (not the published map — it shows at once, before the sync)
  assert.equal(seatCardSkin({ ...me, skins: { [OP]: 'old#1' } }, OP, ctx), 'mine#2');
  assert.equal(seatCardSkin(me, 'char_498_inside', ctx), null, 'no choice for that operator: the default');
  // another doctor's card: what that seat published (room.state seats[].skins, or a match's players[].skins)
  assert.equal(seatCardSkin(mate, OP, ctx), SKIN);
  assert.equal(seatCardSkin(bare, OP, ctx), null);
  assert.equal(seatCardSkin(mate, OP, { ...ctx, players: [] }), null, 'a seat not in the list publishes nothing');
  // 「显示其他玩家的皮肤」 off: the others' cards draw the default, one's own keeps its outfit
  assert.equal(seatCardSkin(mate, OP, { ...ctx, otherSkins: false }), null);
  assert.equal(seatCardSkin(me, OP, { ...ctx, otherSkins: false }), 'mine#2');
  // a bot, an empty seat, no operator: nothing
  assert.equal(seatCardSkin(bot, OP, ctx), null);
  assert.equal(seatCardSkin(null, OP, ctx), null);
  assert.equal(seatCardSkin(mate, null, ctx), null);
  // the picture: the outfit's when this page's manifest has it, else the operator's own (an appearance plugin missing here)
  const rec = { charId: OP, isGolden: true, assets: { portrait: `${OP}_2` } };
  const withSkin = { chars: { [OP]: { portrait: '/p/skadi_1.png', portraitE2: '/p/skadi_2.png', skins: { [SKIN]: { name: 'T', portrait: '/p/skin.png' } } } } };
  const without = { chars: { [OP]: { portrait: '/p/skadi_1.png', portraitE2: '/p/skadi_2.png' } } };
  assert.equal(chessPortraitUrl(withSkin, rec, { skin: seatCardSkin(mate, OP, ctx) }), '/p/skin.png');
  assert.equal(chessPortraitUrl(without, rec, { skin: seatCardSkin(mate, OP, ctx) }), '/p/skadi_2.png');
});

test('a picture that fails to load: the outfit gives way to the default portrait, that to the avatar frame (§35.18)', () => {
  const OUTFIT = '/assets/chars/outfit.png';
  const PLAIN = '/assets/chars/plain.png';
  assert.equal(seatArtSrc([OUTFIT, PLAIN]), OUTFIT, 'the outfit first');
  assert.equal(seatArtSrc([OUTFIT, PLAIN], [OUTFIT]), PLAIN, 'the outfit failed: the default portrait');
  assert.equal(seatArtSrc([OUTFIT, PLAIN], [OUTFIT, PLAIN]), null, 'both failed: the avatar frame');
  assert.equal(seatArtSrc([PLAIN, null]), PLAIN, 'no outfit worn: the default only');
  assert.equal(seatArtSrc([PLAIN, PLAIN], [PLAIN]), null, 'an outfit this page lacks drew the default already: no second try');
  assert.equal(seatArtSrc([null, null]), null);
  assert.equal(seatArtSrc(undefined), null);
  // screens/room.js: the card gets both pictures and walks them on each failed load
  const room = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
  assert.match(room, /const art = seat\.isBot \? null : seatArtSrc\(\[portrait, portraitDefault\], badArt\);/);
  assert.match(room, /onError=\$\{\(\) => setBadArt\(\(b\) => \(b\.includes\(art\) \? b : \[\.\.\.b, art\]\)\)\}/);
  assert.match(room, /portraitDefault=\$\{op && skin \? chessPortraitUrl\(data\.get\('assets'\), op\.chess\) : null\}/);
});

test('the pick\'s store: a string pref, \'\' for 默认; setCard persists and tells the store', () => {
  assert.equal(parseStoredCard('char_1_a'), 'char_1_a');
  for (const junk of [null, 7, {}, ['x']]) assert.equal(parseStoredCard(junk), '');
  const seen = [];
  const off = cardStore.subscribe((st) => seen.push(st[CARD_KEY]));
  try {
    setCard('char_498_inside');
    setCard(42);
  } finally { off(); }
  assert.deepEqual(seen, ['char_498_inside', '']);
  assert.equal(cardStore.get()[CARD_KEY], '');
});

test('room.css: the seat cards and the picker follow 文字大小, no !important / :has()', () => {
  const block = readFileSync(path.join(ROOT, 'public/css/screens/room.css'), 'utf8');
  const sizes = [...block.matchAll(/font-size:\s*([^;}]+)[;}]/g)].map((m) => m[1].trim());
  assert.ok(sizes.length >= 30, sizes.join(' | '));
  // (a capped size still follows 文字大小 below the cap — §35.18 review: the room's big button, and on a short screen the
  // seat cards, the top bar's text, the status line, 独立模拟's briefing and the picker's names)
  const STEP_CAP = /^calc\((\d+)px \+ var\(--t-step\)( \/ 2)?\)$/;
  for (const v of sizes) assert.match(v, /^(calc\(\.\d+ \* var\(--t\)\)|min\(calc\(\.\d+ \* var\(--t\)\), (\.\d+rem|\d+px|calc\(\d+px \+ var\(--t-step\)( \/ 2)?\))\))$/, v);
  const caps = sizes.filter((v) => v.startsWith('min('));
  assert.ok(caps.length >= 19, `the GoButton's label, rook and mark, and the short screen's caps (${caps.length})`);
  // the short screen's px caps keep the text readable (11–20 px at 中) and still grow above 中 (+ --t-step, theme.css;
  // §35.18 review: 中, 大 and 特大 had been the same) — but the picker's 11 px names, which reach it only at 特大
  for (const v of caps) {
    const cap = v.slice(v.indexOf('), ') + 3, -1);
    if (/rem$/.test(cap)) continue;
    const px = STEP_CAP.exec(cap)?.[1] ?? /^(\d+)px$/.exec(cap)?.[1];
    assert.ok(+px >= 11 && +px <= 20, v);
    if (!STEP_CAP.test(cap)) assert.equal(v, 'min(calc(.14 * var(--t)), 11px)', `${v}: a px cap grows with --t-step`);
  }
  assert.ok(!/!important/.test(block) && !/:has\(/.test(block));
  // #877 (DESIGN §37.325): the picker's group headings and its lines under the grid follow 文字大小 too
  for (const sel of ['cardpick__group', 'cardpick__notice']) {
    const rule = new RegExp(`\\.${sel} \\{[^}]*font-size: (calc\\(\\.\\d+ \\* var\\(--t\\)\\))`).exec(block);
    assert.ok(rule, `${sel} has its own font-size`);
  }
  assert.match(block, /\.cardpick__group \{[^}]*grid-column: 1 \/ -1;/, 'a heading across the grid');
  assert.match(block, /\.rseat__art img \{[^}]*object-fit: cover/);
  assert.match(block, /\.cardpick__grid[\s\S]*overflow-y: auto/);
  // the review of the text-fit fixes (§35.18): Korean breaks between words; the short screen's avatar frame 2rem at 小 and
  // smaller only as the text grows (not 1rem at every size); 复制's line height after `font` (which resets it); the phone
  // footer's status and pill at the start; 独立模拟's card 2.7 × --t (2.7rem at 小, as before)
  const plain = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(plain, /\.rs:lang\(ko\) \{ word-break: keep-all; overflow-wrap: break-word; \}/);
  assert.match(plain, /\.seat__art\.rseat__art > \.avatar--xl \{ --av: clamp\(1rem, calc\(3rem - var\(--t\)\), 2rem\); \}/);
  assert.doesNotMatch(plain, /--av: 1rem/);
  assert.match(plain, /\.rs-key__copy \{[^}]*font: inherit;[^}]*line-height: 1;/);
  assert.match(plain, /@media \(max-width: 900px\) \{[^@]*\.rs-foot__center \{ justify-self: start;/);
  assert.match(plain, /\.rs--solo \.rseat \{ --w: min\(calc\(2\.7 \* var\(--t\)\), 34vw\); \}/);
  // the review of those fixes: Japanese never starts a line with a small kana or ー (「シミュレーシ|ョン開始」); on a short
  // screen 独立模拟's card no wider than a co-op one (2.7 × --t had made it 173–238 px above 小), its briefing wider and
  // tighter above 中 so it does not scroll, and a modded room's 插件内容就绪 tag giving way to the state
  assert.match(plain, /\.rs:lang\(ja\) \{ line-break: strict; \}/);
  const short = plain.slice(plain.indexOf('@media (max-height: 520px) {'));
  assert.match(short, /\.rs--solo \.rseat \{ --w: min\(calc\(2\.7 \* var\(--t\)\), 3\.4rem, 34vw\); \}/);
  assert.match(short, /\.rs-brief \{ max-width: min\(11rem, 62vw\); padding: calc\(6px - max\(0px, var\(--t-step\)\)\) 12px; \}/);
  assert.match(short, /\.rs-brief h2 \{[^}]*line-height: calc\(1\.5em - 3 \* max\(0px, var\(--t-step\)\)\);/);
  assert.match(short, /\.rs-brief ul \{[^}]*line-height: calc\(1\.35em - max\(0px, var\(--t-step\)\)\);/);
  assert.match(short, /\.seat__content\.is-ready \{ display: none; \}/);
  // the review of the review: the briefing's difficulty code on one line (「AC-」 / 「2」); a paragraph's last line not a
  // single character; the state as wide as before it went in flow (「Standing / by」 in 独立模拟's 108 px card on phones);
  // on a phone your plate without its 你 tag (the corner mark says it)
  assert.match(plain, /\.rs-brief h2 \.num \{ white-space: nowrap; \}/);
  assert.doesNotMatch(plain, /\.rs-brief h2[^{]*\{[^}]*text-wrap/,
    'the briefing title wraps plainly (with pretty and the nowrap code Chrome broke 「…Simulation / AC-2」 where it fits)');
  // review of that review: `pretty` on the paragraphs only, `balance` on the short labels and the picker's names — WebKit's
  // `pretty` adds lines to short labels (「AI同盟者を追加」 cut at 特大 on a 640×360 phone) and kept 「アンジェリー|ナ」
  assert.doesNotMatch(plain, /^\.rs \{ text-wrap/m, 'no text-wrap on the whole room');
  assert.match(plain, /\.rs-hint, \.rs-brief p, \.rs-brief li \{ text-wrap: pretty; \}/);
  assert.match(plain, /\.rseat__add, \.rseat__wait small, \.rseat__invite small \{ text-wrap: balance; \}/);
  assert.match(plain, /\.cardpick__name \{ text-wrap: balance; \}/);
  // review of 6f34f380: `balance` broke Japanese 「AI同盟|者を追加」 inside the word at 特大 on the phones — phrase breaks
  assert.match(plain, /\.rseat__add:lang\(ja\) \{ word-break: auto-phrase; \}/);
  assert.match(plain, /\.rseat__state \{[^}]*margin: 0 -\.08rem;/);
  // 2 of the art's 3 px on a phone beside a 16 px box and a 3 px gap (all 3 px put the box and 「by」 against the card's
  // border on a 640×360 phone)
  assert.match(short, /\.rseat__state \{ gap: 3px; margin-inline: -2px;/);
  assert.match(short, /\.rseat__box \{ width: 16px; height: 16px; \}/);
  assert.match(short, /\.rseat__who \.seat__you \{ display: none; \}/);
  // §35.51: on a phone at least 370 px tall a long name takes two lines (then its ellipsis), every plate two lines tall
  assert.match(plain, /@media \(max-height: 520px\) and \(min-height: 370px\) \{\n  \.rseat__plate/);
  assert.match(short, /\.rseat__who \.seat__name \{ white-space: normal;[^}]*-webkit-line-clamp: 2;/);
  assert.match(short, /\.rseat__plate \{ min-height: max\(32px, calc\(36px \* var\(--sp-ui, 1\)\), calc\(2\.2 \* min\(calc\(\.28 \* var\(--t\)\), calc\(18px \+ var\(--t-step\) \/ 2\)\) \+ 8px\)\); \}/);
  // the corner mark is what screen readers hear as 你 (the tag, hidden on a phone, is aria-hidden everywhere)
  const roomJs = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
  assert.match(roomJs, /<span class="rseat__me" role="img" aria-label=\$\{t\('你'\)\}/);
  assert.match(roomJs, /<span class="rseat__who"><b class="seat__name">[^\n]*<span class="seat__you" aria-hidden="true">/);
  // review of 6f34f380: on a phone an AI teammate's plate without its 「AI·」 prefix (「AI·华…」 at 特大; the badge and
  // the AI 队友 tag say it), the prefix in its own span (botNameParts); desktops keep it
  assert.match(short, /\.seat__name-pre \{ display: none; \}/);
  assert.doesNotMatch(plain.slice(0, plain.indexOf('@media (max-height: 520px) {')), /\.seat__name-pre/);
  assert.match(roomJs, /<b class="seat__name">\$\{botPrefix \? html`<span class="seat__name-pre">\$\{botPrefix\[0\]\}<\/span>\$\{botPrefix\[1\]\}`/);
  // review of 7aa59703: English 「Copy」 set higher a pixel a step above 中 only (a fixed 4 px put it 2 px high at 小)
  assert.match(short, /\.rs-key__copy:lang\(en\) \{ padding-bottom: calc\(2 \* max\(0px, var\(--t-step\)\)\); \}/);
  assert.match(readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8'), /\} <span class="num t-dim">\$\{info\.code\}<\/span><\/h2>/,
    'the space before the code outside its nowrap span, so the title can still break there');
  // the ping pill grows in the room only (§35.18 review: a global min-height outgrew title.css's own height)
  assert.match(plain, /\.rs-clock__ping \.ping \{ height: auto; min-height: \.32rem;/);
  assert.match(readFileSync(path.join(ROOT, 'public/css/components.css'), 'utf8'), /\.ping \{[^}]*\n  height: \.32rem;/);
  // the plugin mode's chip beside the mode name (review of PR #813: its only rule had been deleted)
  assert.match(block, /\.rs-clock \.room-mode \{[^}]*border: 1px solid[^}]*text-overflow: ellipsis/);
});

test('an AI teammate\'s name split for the plate: 「AI·」 + the rest; a number-only name and a human seat unsplit (botNameParts)', async () => {
  const { botNameParts } = await import('../../public/js/screens/room.js');
  assert.deepEqual(botNameParts({ isBot: true, name: 'AI·华法琳' }), ['AI·', '华法琳']);
  assert.deepEqual(botNameParts({ isBot: true, name: 'AI · Warfarin' }), ['AI · ', 'Warfarin']);
  assert.deepEqual(botNameParts({ isBot: true, name: 'AI·Kal\'tsit\nx' }), ['AI·', 'Kal\'tsit\nx']);
  assert.equal(botNameParts({ isBot: true, name: 'AI·2' }), null, 'only a number after the prefix keeps it');
  assert.equal(botNameParts({ isBot: true, name: '华法琳' }), null);
  assert.equal(botNameParts({ isBot: true, name: 'AI·' }), null);
  assert.equal(botNameParts({ isBot: true }), null);
  assert.equal(botNameParts({ isBot: false, name: 'AI·x' }), null, 'a doctor named 「AI·x」 keeps the whole name');
  assert.equal(botNameParts({ name: 'AI·x' }), null);
  assert.equal(botNameParts(null), null);
});

// ---- #877 (DESIGN §37.325): other periods' operators on the cards --------------------------------------------------
test('a 自选编队 pool record carries its appellation from backups.units, so the picker finds it by its code name (#877)', () => {
  const list = cardOperators(CHESS, BACKUPS);
  const kalts = list.find((c) => c.charId === 'char_003_kalts');
  assert.equal(kalts.appellation, "Kal'tsit");
  assert.equal(kalts.name, '凯尔希');
  for (const c of list) assert.equal(typeof c.appellation, 'string', `${c.charId}: an appellation (chess records carry theirs)`);
  // no units entry: an empty appellation, never undefined
  assert.equal(cardOperators([], { diy: { ownedPool: ['char_9_x'], operators: { char_9_x: { name: 'X', rarity: 5 } } } })[0].appellation, '');
});

test('rosterOperators: the roster\'s operators the room lacks, as picker records, 6★ first; [] without a roster (#877)', () => {
  const room = cardOperators(CHESS, BACKUPS);
  const exclude = new Set(room.map((c) => c.charId));
  const others = rosterOperators(ROSTER, { exclude });
  assert.equal(room.length + others.length, ROSTER.operators.length, 'the room\'s list and the others make the whole roster');
  assert.ok(others.every((c) => !exclude.has(c.charId)), 'nothing of the room\'s list twice');
  const bee = others.find((c) => c.charId === 'char_344_beewax');
  assert.deepEqual({ ...bee, periods: [...bee.periods] }, { charId: 'char_344_beewax', name: '蜜蜡', zh: '蜜蜡', appellation: 'Beeswax', rarity: 5, isGolden: true,
    periods: ['act2autochess@V2_1'], other: true });
  for (let i = 1; i < others.length; i++) {
    const [a, b] = [others[i - 1], others[i]];
    assert.ok(a.rarity > b.rarity || (a.rarity === b.rarity && a.zh.localeCompare(b.zh, 'zh') <= 0), `${a.charId} before ${b.charId}`);
  }
  // (every 6★ of the other periods is in 第二期下半's list or pool: its others start at 5★; the whole roster at 6★)
  assert.equal(others[0].rarity, 5);
  assert.equal(rosterOperators(ROSTER)[0].rarity, 6);
  // a 自选-only operator of another period draws its E1 art (golden false), as in its own period's room
  const golden = new Map(ROSTER.operators.map((o) => [o.charId, o.golden]));
  for (const c of others) assert.equal(c.isGolden, golden.get(c.charId), c.charId);
  // the art: E2 of the roster's own charId (ui/assetUrls.js reads charId and isGolden, no chess record needed)
  const m = { chars: { char_344_beewax: { avatar: '/a/1.png', avatarE2: '/a/2.png', portrait: '/p/1.png', portraitE2: '/p/2.png' } } };
  assert.equal(chessPortraitUrl(m, bee), '/p/2.png');
  assert.equal(chessAvatarUrl(m, bee), '/a/2.png');
  for (const junk of [null, undefined, {}, { format: 2, operators: [] }, 'x']) assert.deepEqual(rosterOperators(junk), [], String(junk));
  assert.equal(rosterOperators(ROSTER).length, ROSTER.operators.length, 'no exclude: every row');
});

test('cardName: Chinese as it is; another language its game-text name, else the appellation; zh-TW the Chinese name (#877)', () => {
  const row = { name: '蜜蜡', appellation: 'Beeswax' };
  const names = { 蜜蜡: 'Beeswax (EN)' };
  const localeName = (zh) => names[zh] ?? zh; // data.js localeName: the name itself when the language lacks it
  assert.equal(cardName(row, { lang: 'zh', localeName }), '蜜蜡');
  assert.equal(cardName(row), '蜜蜡', 'the default language is Chinese');
  assert.equal(cardName(row, { lang: 'en', localeName }), 'Beeswax (EN)');
  assert.equal(cardName({ name: '摆渡人', appellation: 'Varkáris' }, { lang: 'en', localeName }), 'Varkáris', 'no name in the table: the appellation');
  assert.equal(cardName({ name: '摆渡人', appellation: 'Varkáris' }, { lang: 'ja', localeName }), 'Varkáris');
  assert.equal(cardName({ name: '摆渡人', appellation: 'Varkáris' }, { lang: 'zh-TW', localeName }), '摆渡人', 'a Chinese script keeps the Chinese name');
  assert.equal(cardName({ name: '蜜蜡', appellation: 'Beeswax' }, { lang: 'zh-TW', localeName: (zh) => (zh === '蜜蜡' ? '蜜蠟' : zh) }), '蜜蠟');
  assert.equal(cardName({ name: '摆渡人', appellation: '' }, { lang: 'en', localeName }), '摆渡人', 'no appellation either: the Chinese name');
  assert.equal(cardName(null, { lang: 'en' }), '');
  // rosterOperators names its records this way and keeps the Chinese one for the search
  const en = rosterOperators(ROSTER, { lang: 'en', localeName }).find((c) => c.charId === 'char_4166_varkis');
  assert.deepEqual([en.name, en.zh, en.appellation], ['Varkáris', '摆渡人', 'Varkáris']);
});

test('cardContext with the roster: other periods resolve a pick, the default pool and every default stay the same (#877)', () => {
  const room = cardOperators(CHESS, BACKUPS);
  const others = rosterOperators(ROSTER, { exclude: new Set(room.map((c) => c.charId)) });
  const plain = cardContext(room);
  const wide = cardContext(room, { extra: others });
  assert.ok(wide.byChar.has('char_344_beewax') && wide.byChar.has('char_4166_varkis'));
  assert.equal(wide.byChar.size, ROSTER.operators.length);
  assert.deepEqual(wide.pool, plain.pool, 'the default pool is the room\'s own list');
  for (let i = 0; i < 50; i++) {
    const seat = { playerId: `p_${i}`, name: `D${i}` };
    assert.equal(seatOperator(seat, wide).chess.charId, seatOperator(seat, plain).chess.charId, seat.playerId);
  }
  // a charId both lists hold keeps the room's record (a plugin's redefinition of an official operator)
  const mine = { charId: 'char_344_beewax', name: '插件蜜蜡', rarity: 6, isGolden: false };
  const ctx = cardContext([...room, mine], { extra: others });
  assert.equal(ctx.byChar.get('char_344_beewax'), mine);
  assert.equal(cardContext([], { extra: [null, ...others] }).byChar.size, others.length, 'junk in extra is skipped');
});

test('seatOperator and other periods: a teammate\'s cross-period card resolves; it waits while the roster loads; without one, the default (#877)', () => {
  const room = cardOperators(CHESS, BACKUPS);
  const others = rosterOperators(ROSTER, { exclude: new Set(room.map((c) => c.charId)) });
  const mate = { playerId: 'p_mate', name: 'Mate', isBot: false, card: 'char_4166_varkis' };
  const loaded = seatOperator(mate, cardContext(room, { extra: others }), { myId: 'p_me' });
  assert.equal(loaded.chess.charId, 'char_4166_varkis');
  assert.equal(loaded.picked, true);
  assert.equal(loaded.chess.other, true);
  // one's own local pick likewise, before the server echoes it
  assert.equal(seatOperator({ ...mate, card: '' }, cardContext(room, { extra: others }), { myId: 'p_mate', myCard: 'char_344_beewax' }).chess.charId, 'char_344_beewax');
  assert.equal(seatOperator(mate, cardContext(room, { pending: true })), null, 'the roster still loading: the avatar frame, no default for a moment');
  const missing = seatOperator(mate, cardContext(room));
  assert.equal(missing.picked, false, 'the roster missing: the default by player id');
  assert.equal(missing.chess.charId, seatOperator({ playerId: 'p_mate' }, cardContext(room)).chess.charId);
});

test('cardGroups: 第二期下半\'s room, then 规程, 第二期上半, 第一期下半 — each operator once, empty groups left out (#877)', () => {
  const room = cardOperators(CHESS, BACKUPS);
  const others = rosterOperators(ROSTER, { exclude: new Set(room.map((c) => c.charId)) });
  const groups = cardGroups(room, others, 'act2autochess');
  assert.deepEqual(groups.map((g) => g.key), ['room', 'act3autochess@V3_1', 'act2autochess@V2_1', 'act1autochess']);
  assert.deepEqual(groups.map((g) => g.ops.length), [187, 42, 6, 15]);
  assert.deepEqual(groups.map((g) => g.version), ['act2autochess', 'act3autochess@V3_1', 'act2autochess@V2_1', 'act1autochess']);
  const ids = groups.flatMap((g) => g.ops.map((c) => c.charId));
  assert.equal(new Set(ids).size, ids.length, 'each operator once');
  assert.equal(ids.length, ROSTER.operators.length);
  assert.deepEqual(groups[0].ops, room, 'the room\'s group: its own list in its order');
  // each other operator sits in the newest period that lists it besides the room's own
  for (const g of groups.slice(1)) {
    for (const c of g.ops) {
      const rest = c.periods.filter((p) => p !== 'act2autochess');
      assert.equal(g.key, rest.reduce((a, b) => (CARD_PERIOD_ORDER.indexOf(b) > CARD_PERIOD_ORDER.indexOf(a) ? b : a)), c.charId);
    }
  }
  assert.ok(groups.find((g) => g.key === 'act2autochess@V2_1').ops.some((c) => c.charId === 'char_344_beewax'));
  assert.ok(groups.find((g) => g.key === 'act3autochess@V3_1').ops.some((c) => c.charId === 'char_4166_varkis'));
  // a roster record only the room's version lists (an operator the room's plugins hide) joins the room's group, after its list
  const hidden = { charId: 'char_1_h', name: 'H', zh: 'H', rarity: 6, periods: ['act2autochess'], other: true };
  const g2 = cardGroups(room.slice(0, 3), [hidden, ...others.slice(0, 2)], 'act2autochess');
  assert.deepEqual(g2[0].ops.map((c) => c.charId), [...room.slice(0, 3).map((c) => c.charId), 'char_1_h']);
  // empty groups go: no others, an empty room (the data still loading)
  assert.deepEqual(cardGroups(room, [], 'act2autochess').map((g) => g.key), ['room']);
  assert.deepEqual(cardGroups([], [], 'act2autochess'), []);
  assert.deepEqual(cardGroups(null, null, 'act2autochess'), []);
  // a 规程 room: the other periods newest first, 规程 itself never a group of others
  const v3 = cardGroups(room, rosterOperators(ROSTER, { exclude: new Set(room.map((c) => c.charId)) }), 'act3autochess@V3_1');
  assert.ok(!v3.slice(1).some((g) => g.key === 'act3autochess@V3_1'));
  const order = v3.slice(1).map((g) => CARD_PERIOD_ORDER.indexOf(g.key));
  assert.deepEqual(order, [...order].sort((a, b) => b - a), 'newest first');
});

test('cardSkinPlayers: the draft\'s players over the room\'s seats — the match\'s choice wins per operator; no seat, no change (#877)', () => {
  const A = 'char_344_beewax', B = 'char_003_kalts';
  const players = [
    { playerId: 'p1', name: 'One', skins: { [B]: 'match#1' } },
    { playerId: 'p2', name: 'Two' },
    { playerId: 'p3', name: 'Three', skins: { [B]: 'match#3' } },
    null,
  ];
  const seats = [
    { playerId: 'p1', skins: { [A]: 'room#a', [B]: 'room#b' } },
    { playerId: 'p2', skins: { [A]: 'room#2' } },
    null,
    { playerId: 'ai_1', isBot: true },
  ];
  const out = cardSkinPlayers(players, seats);
  assert.deepEqual(out[0].skins, { [A]: 'room#a', [B]: 'match#1' }, 'the match\'s choice wins; the room adds the cross-period card');
  assert.deepEqual(out[1].skins, { [A]: 'room#2' });
  assert.equal(out[2], players[2], 'no room seat: the player as it is');
  assert.equal(out[3], null);
  assert.equal(out[0].name, 'One');
  assert.deepEqual(players[0].skins, { [B]: 'match#1' }, 'the input is never changed');
  assert.deepEqual(cardSkinPlayers(players, undefined), players);
  assert.deepEqual(cardSkinPlayers(undefined, seats), []);
  // the card wears it: seatCardSkin reads the merged list
  assert.equal(seatCardSkin({ playerId: 'p1' }, A, { myId: 'p9', players: out }), 'room#a');
  assert.equal(seatCardSkin({ playerId: 'p1' }, A, { myId: 'p9', players: out, otherSkins: false }), null, '「显示其他玩家的皮肤」 off');
});
