// i18n core (shared/i18n.js) and the UI string table (public/i18n/en.json): t() / tc() fallback and params, plurals,
// lists, data names, language state, the server message wire format (msg → wireMessage → translateWire), and the
// tooling's msgid derivation (tools/i18n.mjs). docs/I18N.md.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  t, tc, tParts, N_, setLang, getLang, onLangChange, addMessages, setMessages, hasMessage, normalizeLang, format, setNameResolver,
  tName, dn, msg, renderMessage, wireMessage, translateWire, DEFAULT_LANG,
} from '../shared/i18n.js';
import { templateMsgid, paramName, quote, codemodSource, scanSource } from '../tools/i18n.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EN = JSON.parse(readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));

afterEach(() => { setLang('zh'); setMessages('en', {}); setNameResolver(null); });

test('t(): Chinese is the default and the msgid; a missing translation falls back to the Chinese text', () => {
  assert.equal(getLang(), DEFAULT_LANG);
  addMessages('en', { 整备区已满: 'Bench is full' });
  assert.equal(t('整备区已满'), '整备区已满', 'zh shows the msgid');
  setLang('en');
  assert.equal(t('整备区已满'), 'Bench is full');
  assert.equal(t('没有翻译的句子'), '没有翻译的句子', 'untranslated → Chinese');
  assert.equal(t(null), '');
  assert.equal(t(42), '42');
  assert.equal(hasMessage('整备区已满'), true);
  assert.equal(hasMessage('没有翻译的句子'), false);
  assert.equal(hasMessage('没有翻译的句子', 'zh'), true, 'the source language has every msgid');
});

test('params: {name}, positional {0}, plural {n|one|other}, lists and missing values', () => {
  addMessages('en', { '还剩 {n} 秒': '{n} {n|second|seconds} left', '{0}博士对敌方领袖造成的伤害超过20%!': 'Dr. {0} dealt over 20%!' });
  assert.equal(t('还剩 {n} 秒', { n: 3 }), '还剩 3 秒');
  setLang('en');
  assert.equal(t('还剩 {n} 秒', { n: 1 }), '1 second left');
  assert.equal(t('还剩 {n} 秒', { n: 5 }), '5 seconds left');
  assert.equal(t('{0}博士对敌方领袖造成的伤害超过20%!', ['阿米娅']), 'Dr. 阿米娅 dealt over 20%!', 'array params fill {0}');
  assert.equal(format('{a} / {b}', { a: 'x' }), 'x / {b}', 'a missing value keeps the placeholder');
  assert.equal(format('{names}', { names: ['甲', '乙'] }, { lang: 'zh' }), '甲、乙');
  assert.equal(format('{names}', { names: ['A', 'B'] }, { lang: 'en' }), 'A, B');
  assert.equal(format('官方{0:0%}', { 0: 1 }), '官方{0:0%}', 'official format placeholders are not ours: untouched');
  assert.equal(format('{constructor}', {}), '{constructor}', 'no prototype lookups');
});

test('tc(): a context key wins, else the plain msgid; Chinese shows the msgid', () => {
  addMessages('en', { 'toggle::关闭': 'Off', 关闭: 'Close' });
  assert.equal(tc('toggle', '关闭'), '关闭');
  setLang('en');
  assert.equal(tc('toggle', '关闭'), 'Off');
  assert.equal(tc('dialog', '关闭'), 'Close');
  assert.equal(t('关闭'), 'Close');
  assert.equal(N_('标记'), '标记', 'N_ only marks a msgid');
});

test('tParts(): a sentence with markup inside — the translation split at its placeholders, object params kept as they are', () => {
  const b = { type: 'b', props: { children: 14 } }; // a vnode stand-in
  addMessages('en', { '第 {r} 回合 · 最终攻势': 'Final Assault in round {r}', '{n} 名{who}已调整': '{n} {n|operator|operators} of {who} adjusted' });
  assert.deepEqual(tParts('第 {r} 回合 · 最终攻势', { r: b }), ['第 ', b, ' 回合 · 最终攻势'], 'zh: the text around the markup as written');
  assert.deepEqual(tParts('只有文字'), ['只有文字']);
  assert.deepEqual(tParts('{a}{b}', { a: '甲', b: 2 }), ['甲2'], 'plain values join the text around them');
  assert.deepEqual(tParts('{r}', { r: b }), [b], 'empty text is dropped');
  assert.deepEqual(tParts('留着 {x}', {}), ['留着 {x}'], 'a missing value keeps the placeholder');
  assert.deepEqual(tParts('禁用{names}盟约', { names: [b, b] }), ['禁用', [b, b], '盟约'], 'an array of vnodes is markup too');
  assert.deepEqual(tParts('{names}', { names: ['甲', dn('乙')] }), ['甲、乙'], 'an array of texts is a list');
  setLang('en');
  assert.deepEqual(tParts('第 {r} 回合 · 最终攻势', { r: b }), ['Final Assault in round ', b], 'the English word order');
  setNameResolver((name) => ({ 阿米娅: 'Amiya' })[name] || name);
  assert.deepEqual(tParts('{n} 名{who}已调整', { n: 1, who: dn('阿米娅') }), ['1 operator of Amiya adjusted'], 'plurals and data names as in t()');
});

test('data names: { dn } params and tName go through the resolver, only outside Chinese; player names never do', () => {
  setNameResolver((name) => ({ 琳琅诗怀雅: 'Swire the Elegant Wit', 阿米娅: 'Amiya' })[name] || name);
  addMessages('en', { '{names}只能部署在召唤者攻击范围内，已退回整备区': '{names} were returned to the Bench', '{name}博士中途退出了模拟': 'Dr. {name} left the simulation' });
  const m = msg('{names}只能部署在召唤者攻击范围内，已退回整备区', { names: ['琳琅诗怀雅', '无名'].map(dn) });
  assert.equal(translateWire(wireMessage(m)), '琳琅诗怀雅、无名只能部署在召唤者攻击范围内，已退回整备区', 'zh: names as sent');
  setLang('en');
  assert.equal(translateWire(wireMessage(m)), 'Swire the Elegant Wit, 无名 were returned to the Bench');
  // a player called 阿米娅 stays 阿米娅 (plain string param, not dn)
  assert.equal(translateWire(wireMessage(msg('{name}博士中途退出了模拟', { name: '阿米娅' }))), 'Dr. 阿米娅 left the simulation');
  assert.equal(tName('阿米娅'), 'Amiya');
  setLang('zh');
  assert.equal(tName('阿米娅'), '阿米娅');
});

test('language state: setLang normalizes, notifies listeners once per change; normalizeLang', () => {
  const seen = [];
  const off = onLangChange((l, prev) => seen.push(`${prev}>${l}`));
  assert.equal(setLang('en-US'), true);
  assert.equal(setLang('en'), false, 'no change, no event');
  assert.equal(setLang('xx'), true, 'unknown → default zh');
  off();
  setLang('en');
  assert.deepEqual(seen, ['zh>en', 'en>zh']);
  assert.equal(normalizeLang('zh_CN'), 'zh');
  assert.equal(normalizeLang('EN'), 'en');
  assert.equal(normalizeLang('fr'), null);
  assert.equal(normalizeLang(undefined), null);
});

test('server wire format: text keeps the Chinese rendering for older clients; params are sanitized', () => {
  assert.deepEqual(wireMessage('整备区已满，获得的装备已销毁'), { text: '整备区已满，获得的装备已销毁' });
  const w = wireMessage(msg('【{label}】层数达成，获得{gain}资金', { label: dn('奇迹'), gain: 20, evil: { x: 1 }, 'bad key': 1 }));
  assert.deepEqual(w, { text: '【奇迹】层数达成，获得20资金', msgid: '【{label}】层数达成，获得{gain}资金', params: { label: { dn: '奇迹' }, gain: 20, evil: null } });
  assert.equal(renderMessage(msg('{who}：获得{name}', { who: dn('歌蕾蒂娅'), name: dn('斯卡蒂') })), '歌蕾蒂娅：获得斯卡蒂');
  // a frame from an older server (no msgid): its text is the msgid
  addMessages('en', { 隐秘核心已解锁: 'Hidden Core unlocked' });
  setLang('en');
  assert.equal(translateWire({ text: '隐秘核心已解锁' }), 'Hidden Core unlocked');
  assert.equal(translateWire({ text: 'Doctor 7 博士的目标生命值已耗尽' }), 'Doctor 7 博士的目标生命值已耗尽', 'unknown text shows as is');
  assert.equal(translateWire(null), '');
});

test('public/i18n/en.json: valid, English values, placeholders kept, the pilot screens and server messages translated', () => {
  const entries = Object.entries(EN).filter(([k]) => !k.startsWith('_'));
  assert.ok(entries.length >= 1000, `PR #70's seed + phase 2: ${entries.length}`);
  for (const [k, v] of entries) {
    assert.equal(typeof v, 'string', k);
    assert.ok(v.trim(), `empty translation for ${k}`);
    assert.ok(!/[一-鿿]/.test(v.replace(/\{[^{}]*\}/g, '')), `Chinese left in the translation of ${k}: ${v}`);
    const want = new Set([...k.matchAll(/\{([A-Za-z0-9_$]+)\}/g)].map((m) => m[1]));
    const have = new Set([...v.matchAll(/\{([A-Za-z0-9_$]+)(?:\|[^{}]*)?\}/g)].map((m) => m[1]));
    for (const p of want) assert.ok(have.has(p), `${k}: {${p}} missing in "${v}"`);
  }
  for (const k of ['开始', '博士代号', '设置', '语言', '同盟模拟', '创建同盟', '加入同盟', '开始模拟', 'toggle::关闭', '整备区已满',
    '第 {r} 回合 · 最终攻势', '本局禁用{names}盟约，此策略效果可能无法发挥', 'bond-threshold::名', 'list::、', '干员持有', '先锋', '开心',
    '{names}只能部署在召唤者攻击范围内，已退回整备区', '{name}博士的目标生命值已耗尽', '联防阶段：{names} 迎战突破防线的敌人', '【维多利亚】获得{n}件维式重锤']) {
    assert.ok(EN[k], `en.json lacks ${k}`);
  }
});

test('the whole client, shared and the server messages: no Chinese literal left unwrapped, every msgid in public/i18n/en.json (extract 0, check --strict)', async () => {
  // what tools/i18n.mjs scans: public/js (not dev / vendor / assets / fonts), shared, server — server/sim only for the
  // texts it sends (msg() / ctx.toast), its own t() / N_() are other helpers
  const SKIP = new Set(['node_modules', 'vendor', 'assets', 'fonts', 'dev']);
  const files = [];
  const visit = (rel) => {
    for (const name of readdirSync(path.join(ROOT, rel)).sort()) {
      if (SKIP.has(name) || name.startsWith('.')) continue;
      const r = `${rel}/${name}`;
      if (statSync(path.join(ROOT, r)).isDirectory()) visit(r);
      else if (/\.m?js$/.test(name)) files.push(r);
    }
  };
  for (const root of ['public/js', 'shared', 'server']) visit(root);
  assert.ok(files.length > 300, `${files.length} files`);
  const missing = [];
  let used = 0;
  for (const f of files) {
    const { msgids, literals } = await scanSource(readFileSync(path.join(ROOT, f), 'utf8'), f);
    const server = f.startsWith('server/');
    for (const m of msgids) {
      if (server && m.via !== 'msg' && m.via !== 'server') continue;
      used++;
      if (!EN[m.msgid]) missing.push(`${f}:${m.line} ${m.msgid}`);
    }
    if (!f.startsWith('server/sim/')) for (const l of literals) if (!l.reason) missing.push(`${f}:${l.line} not wrapped: ${l.msgid}`);
  }
  assert.ok(used >= 1350, `msgid uses: ${used} (1 404 at phase 2)`);
  assert.deepEqual(missing, []);
});

test('tools/i18n.mjs: msgids of template literals name their params; the codemod wraps text, attributes and nested strings', async () => {
  assert.equal(paramName('poolN', 0), 'poolN');
  assert.equal(paramName('info.rounds', 1), 'rounds');
  assert.equal(paramName('ids.length', 0), 'n');
  assert.equal(paramName('MAX_SEATS - 1', 2), '2');
  assert.deepEqual(templateMsgid(['战场随机（共', '张）'], ['ids.length']), { msgid: '战场随机（共{n}张）', params: [{ name: 'n', src: 'ids.length' }] });
  assert.equal(templateMsgid(['', ' / ', ''], ['a.x', 'b.x']).msgid, '{x} / {x2}', 'same name from two expressions: numbered');
  assert.equal(quote("it's\n"), "'it\\'s\\n'");
  const src = [
    "import { html } from './components.js';",
    "const TABLE = { a: '甲' };",
    "export function V({ name, n }) {",
    "  if (name === '比较') return null;",
    "  toast(`剩余 ${n} 名`, 'warn');",
    "  return html`<p title=\"提示 ${n}\">你好 ${name || '博士'} 世界<b>${n}</b> 回合</p>`;",
    "  const sample = '字体样例'; // i18n-ignore",
    "}",
  ].join('\n');
  const out = await codemodSource(src, path.join(ROOT, 'public/js/ui/x.js'));
  assert.match(out.src, /import \{ t, N_ \} from '\.\.\/\.\.\/\.\.\/shared\/i18n\.js';/);
  assert.match(out.src, /const TABLE = \{ a: N_\('甲'\) \};/, 'module level: marked, not translated');
  assert.match(out.src, /name === '比较'/, 'compared literals are left alone');
  assert.match(out.src, /toast\(t\('剩余 \{n\} 名', \{ n \}\), 'warn'\)/);
  assert.match(out.src, /title=\$\{t\('提示 \{n\}', \{ n \}\)\}/);
  // a child that is not a plain value splits the run; the string inside it is wrapped too
  assert.match(out.src, />\$\{t\('你好'\)\} \$\{name \|\| t\('博士'\)\} \$\{t\('世界'\)\}<b>/);
  assert.match(out.src, /<\/b> \$\{t\('回合'\)\}<\/p>/);
  assert.equal(out.manual.length, 1);
  // tParts() is a msgid call: its msgid is extracted, the text inside is not a literal left to wrap
  const scanned = await scanSource("const v = html`<span>${tParts('第 {r} 回合', { r: html`<b>${n}</b>` })}</span>`;", 'x.js');
  assert.deepEqual(scanned.msgids.map((m) => [m.msgid, m.via]), [['第 {r} 回合', 'tParts']]);
  assert.deepEqual(scanned.literals.filter((l) => !l.reason), []);
  // an aliased import (`t as tr`, where t is a local variable) is the same msgid call
  const aliased = await scanSource("import { t as tr } from '../../../shared/i18n.js';\nconst t = 3;\nexport const f = () => tr('替补') + t;", 'x.js');
  assert.deepEqual(aliased.msgids.map((m) => [m.msgid, m.via]), [['替补', 't']]);
  assert.deepEqual(aliased.literals.filter((l) => !l.reason), []);
  // developer text is not UI text: an error result's detail, a logger call, a file marked i18n-ignore-file
  const dev = await scanSource([
    "export const a = (x) => ({ error: 'BAD_TARGET', detail: `不是自选格子 ${x ? '甲' : '乙'}` });",
    "export function b(ev, log) { ev.detail = '已经是精锐'; log.warn(`[match] 自选 被忽略`); this.m.log?.info?.('信息'); return '界面文字'; }",
  ].join('\n'), 'x.js');
  assert.deepEqual(dev.literals.filter((l) => !l.reason).map((l) => l.msgid), ['界面文字']);
  const whole = await scanSource("// (i18n-ignore-file: developer reports)\nexport const r = ['开发者报告', `第${1}条`];", 'x.js');
  assert.deepEqual(whole.literals.filter((l) => !l.reason), []);
});

test('user Given Unicode before UI text When the codemod runs Then edits keep source offsets and malformed code is rejected', async () => {
  const src = 'const icon = "😀";\nexport function view(name) { return html`<p>你好 ${name}</p>`; }';
  const out = await codemodSource(src, path.join(ROOT, 'public/js/ui/x.js'));
  assert.ok(out.src.includes('const icon = "😀";'));
  assert.ok(out.src.includes("html`<p>${t('你好 {name}', { name })}</p>`"));
  const scanned = await scanSource(out.src, 'x.js');
  assert.deepEqual(scanned.msgids.map(({ msgid }) => msgid), ['你好 {name}']);
  await assert.rejects(scanSource('export const =', 'broken.js'), /broken.js: cannot parse/);
});
