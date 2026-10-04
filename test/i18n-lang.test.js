// Display language switch (js/i18n.js, shared/i18n.js): language detection, T() / TC() / TH(), the server's
// template + args messages, and that the UI code passes its Chinese source texts through T().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveLang, T, TC, TH, tr, trDeep, setI18n, lang } from '../public/js/i18n.js';
import { formatText, textMsg, formatMsg, createTranslator, nameArg, namesArg, playerName, playerNameSkip } from '../shared/i18n.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('resolveLang: a saved choice wins, else the first zh / en browser language, else 中文', () => {
  assert.equal(resolveLang({ saved: 'en', languages: ['zh-CN'] }), 'en');
  assert.equal(resolveLang({ saved: 'zh', languages: ['en-US'] }), 'zh');
  assert.equal(resolveLang({ saved: null, languages: ['en-US', 'zh-CN'] }), 'en');
  assert.equal(resolveLang({ saved: null, languages: ['zh-TW', 'en'] }), 'zh');
  assert.equal(resolveLang({ saved: null, languages: ['ja-JP', 'en-GB'] }), 'en', 'first supported entry, not the first entry');
  assert.equal(resolveLang({ saved: null, languages: ['ja-JP', 'ko'] }), 'zh', 'unsupported languages fall back to 中文');
  assert.equal(resolveLang({ saved: null, languages: [] }), 'zh');
  assert.equal(resolveLang({ saved: 'fr', languages: ['EN'] }), 'en', 'an invalid saved value is ignored; codes are case-insensitive');
  assert.equal(resolveLang({ saved: null, languages: ['english'] }), 'zh', 'only the en / en-* codes count');
});

test('under Node the page language is 中文 and T() returns the (formatted) Chinese source', () => {
  assert.equal(lang, 'zh');
  setI18n(null);
  assert.equal(T('开始'), '开始');
  assert.equal(T('输入你的代号（最多 {0} 字）', 12), '输入你的代号（最多 12 字）');
});

test('T / TC / TH with a dictionary', () => {
  setI18n({ 开始: 'Start', '输入你的代号（最多 {0} 字）': 'Enter your callsign (max {0} chars)', 关闭: 'Close', 'toggle\u0004关闭': 'Off', '已选择「{0}」{1}': 'Selected "{0}"{1}' });
  try {
    assert.equal(T('开始'), 'Start');
    assert.equal(T('输入你的代号（最多 {0} 字）', 12), 'Enter your callsign (max 12 chars)');
    assert.equal(T('未收录的文本'), '未收录的文本', 'unknown texts pass through');
    assert.equal(TC('toggle', '关闭'), 'Off');
    assert.equal(TC('button', '关闭'), 'Close', 'no context entry: the plain text');
    const node = { type: 'small' };
    assert.deepEqual(TH('已选择「{0}」{1}', 'A', node), ['Selected "', 'A', '"', node]);
    assert.deepEqual(TH('已选择「{0}」{1}', 'A', null), ['Selected "', 'A', '"'], 'a null slot renders nothing');
    assert.equal(tr('开始'), 'Start');
  } finally {
    setI18n(null);
  }
});

test('formatText fills {n} slots; without args the template is untouched', () => {
  assert.equal(formatText('{0}博士的{1}', ['A', 'B']), 'A博士的B');
  assert.equal(formatText('{0}+{1}', ['A']), 'A+');
  assert.equal(formatText('{0}', []), '{0}');
  assert.equal(formatText(null, ['x']), null);
});

test('server text messages: Chinese template + args, formatted per client language', () => {
  const m = textMsg('地形变化：{0}无法停留在原位置，已撤回整备区', [{ list: ['能天使', '德克萨斯'] }]);
  assert.equal(m.text, '地形变化：能天使、德克萨斯无法停留在原位置，已撤回整备区', 'text: the filled Chinese line');
  assert.equal(m.tpl, '地形变化：{0}无法停留在原位置，已撤回整备区');
  assert.deepEqual(m.args, [{ list: ['能天使', '德克萨斯'] }]);
  assert.deepEqual(textMsg('隐秘核心已解锁'), { text: '隐秘核心已解锁' }, 'no args: text only');
  assert.deepEqual(JSON.parse(JSON.stringify(textMsg('{0}', [NaN, 3, null]))).args, ['NaN', 3, ''], 'args are JSON-safe');

  const zh = createTranslator(null);
  assert.equal(formatMsg(m, zh, 'zh'), m.text);
  const en = createTranslator({
    '地形变化：{0}无法停留在原位置，已撤回整备区': 'Terrain changed: {0} can no longer stay in place and returned to the Bench',
    能天使: 'Exusiai', 德克萨斯: 'Texas', 隐秘核心已解锁: 'Hidden Core unlocked',
  });
  assert.equal(formatMsg(m, en, 'en'), 'Terrain changed: Exusiai, Texas can no longer stay in place and returned to the Bench');
  assert.equal(formatMsg({ text: '隐秘核心已解锁' }, en, 'en'), 'Hidden Core unlocked', 'an old-style message: its text is translated');
  assert.equal(formatMsg({ tpl: '{0}博士中途退出了模拟', args: ['Amiya'] }, en, 'en'), 'Amiya博士中途退出了模拟', 'a template missing from the dictionary stays Chinese');
  assert.equal(formatMsg(null, en), '');
});

// ---- player nicknames are never translated (PR #70 review: a player named 能天使 must not show as "Exusiai")

const NAME_DICT = { 能天使: 'Exusiai', 'AI·华法琳': 'AI·Warfarin', 德克萨斯: 'Texas', '{0}博士中途退出了模拟': 'Dr. {0} left the simulation',
  '<@ba.vup>{0}博士</>的{1}干员造成的伤害量达到{2}': '<@ba.vup>Dr. {0}</>\'s {1} dealt {2} damage', '联防阶段：{0} 迎战突破防线的敌人': 'Unite Phase: {0} take on the enemies that broke through' };

test('message fields: player names stay as typed, data names of the same message are translated, bot names translate', () => {
  setI18n(NAME_DICT);
  try {
    const room = { seats: [{ seat: 0, name: '能天使', isBot: false }, { seat: 1, name: 'AI·华法琳', isBot: true }, { seat: 2, name: 'AI·华法琳', isBot: false }] };
    const r = trDeep(room, { skip: playerNameSkip('room.state') });
    assert.deepEqual(r.seats.map((s) => s.name), ['能天使', 'AI·Warfarin', 'AI·华法琳'], 'a human typing a bot name is not a bot');
    const pub = { players: [{ playerId: 'p1', name: '能天使', isBot: false }], fields: [{ name: '能天使' }], shop: { slots: [{ name: '能天使' }] } };
    const p = trDeep(pub, { skip: playerNameSkip('m.public') });
    assert.equal(p.players[0].name, '能天使');
    assert.equal(p.fields[0].name, 'Exusiai', 'a data record\'s name is still translated');
    assert.equal(p.shop.slots[0].name, 'Exusiai');
    const res = trDeep({ players: [{ name: '能天使', isBot: false, title: { name: '能天使' } }] }, { skip: playerNameSkip('m.result') });
    assert.equal(res.players[0].name, '能天使');
    assert.equal(res.players[0].title.name, 'Exusiai', 'only the player\'s own name field is kept');
    assert.equal(playerNameSkip('m.private'), null, 'other messages translate as before');
    assert.equal(trDeep({ name: '能天使' }).name, 'Exusiai');
  } finally {
    setI18n(null);
  }
});

test('template args: { name } is never translated (bots excepted), data args still are, the zh fallback is filled', () => {
  const en = createTranslator(NAME_DICT);
  const quit = textMsg('{0}博士中途退出了模拟', [nameArg({ name: '能天使', isBot: false })]);
  assert.equal(quit.text, '能天使博士中途退出了模拟');
  assert.equal(formatMsg(quit, en, 'en'), 'Dr. 能天使 left the simulation');
  assert.equal(formatMsg(textMsg('{0}博士中途退出了模拟', [nameArg('AI·华法琳', true)]), en, 'en'), 'Dr. AI·Warfarin left the simulation');
  assert.equal(formatMsg(textMsg('{0}博士中途退出了模拟', [nameArg('AI·华法琳', false)]), en, 'en'), 'Dr. AI·华法琳 left the simulation');
  const dmg = textMsg('<@ba.vup>{0}博士</>的{1}干员造成的伤害量达到{2}', [nameArg({ name: '能天使', isBot: false }), '能天使', '5000']);
  assert.equal(formatMsg(dmg, en, 'en'), '<@ba.vup>Dr. 能天使</>\'s Exusiai dealt 5000 damage', 'the player keeps the name, the operator is translated');
  const unite = textMsg('联防阶段：{0} 迎战突破防线的敌人', [namesArg([{ name: '能天使', isBot: false }, { name: 'AI·华法琳', isBot: true }])]);
  assert.equal(unite.text, '联防阶段：能天使、AI·华法琳 迎战突破防线的敌人');
  assert.equal(formatMsg(unite, en, 'en'), 'Unite Phase: 能天使, AI·Warfarin take on the enemies that broke through');
  assert.deepEqual(JSON.parse(JSON.stringify(unite.args)), [{ names: [{ name: '能天使', bot: false }, { name: 'AI·华法琳', bot: true }] }], 'JSON-safe');
  assert.equal(playerName('能天使', false, en), '能天使');
  assert.equal(playerName('德克萨斯', true, en), '德克萨斯', 'only BOT_NAMES translate on a bot seat');
});

test('server: no player name reaches a toast / ticker template as a plain (translatable) argument', () => {
  const files = execFileSync('git', ['ls-files', 'server'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter((f) => f.endsWith('.js'));
  const bad = [];
  for (const f of files) {
    readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (!/\b(tickerText|tickerFor|toast|giftTicker)\s*\(/.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
      const args = line.slice(line.search(/\b(tickerText|tickerFor|toast|giftTicker)\s*\(/));
      // a player's name (ps / p / player / from / owner / helper … .name) inside the call without nameArg / namesArg
      if (/\[[^\]]*\b(ps|p|player|pl|from|owner|helper|h|me|other)\.name\b/.test(args) && !/nameArg\(|namesArg\(/.test(args)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  assert.deepEqual(bad, [], 'wrap player names with nameArg / namesArg (shared/i18n.js)');
});

test('a real match: the quit ticker of a player named 能天使 keeps the name in English', async () => {
  const { makeMatch } = await import('./match/harness.js');
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: [
    { seat: 0, playerId: 'p_0', name: '能天使', isBot: false, connected: true },
    { seat: 1, playerId: 'p_1', name: 'P1', isBot: false, connected: true },
  ], clients: false });
  h.m.start();
  h.m.onLeave('p_0');
  const line = h.bc.filter((x) => x.t === 'm.ticker').find((x) => x.tpl === '{0}博士中途退出了模拟');
  assert.ok(line, 'quit ticker sent');
  assert.deepEqual(line.args, [{ name: '能天使', bot: false }]);
  assert.equal(line.text, '能天使博士中途退出了模拟');
  const en = createTranslator(JSON.parse(readFileSync(path.join(ROOT, 'public', 'i18n', 'en.json'), 'utf8')));
  assert.equal(en('能天使'), 'Exusiai', 'the real dictionary does know the operator');
  assert.match(formatMsg(line, en, 'en'), /能天使/);
  assert.doesNotMatch(formatMsg(line, en, 'en'), /Exusiai/);
  h.m.dispose();
});

test('the UI code has no display text outside T() and the dictionary slots match (tools/i18n/ui-check.mjs)', () => {
  let out = '';
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'i18n', 'ui-check.mjs'), '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch (err) {
    out = err.stdout;
  }
  const f = JSON.parse(out);
  const show = (list) => list.slice(0, 20).map((x) => `${x.file ?? ''}:${x.line ?? ''} ${x.text ?? `${x.key} → ${x.value}`}`).join('\n');
  assert.equal(f['cjk-raw'].length, 0, `Chinese UI text outside T():\n${show(f['cjk-raw'])}`);
  assert.equal(f['en-raw'].length, 0, `English UI text left in place:\n${show(f['en-raw'])}`);
  assert.equal(f.slots.length, 0, `dictionary entries whose {n} slots differ from the key:\n${show(f.slots)}`);
});
