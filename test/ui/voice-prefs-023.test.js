import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { sanitizeVoiceOverrides, voiceLangFor } from '../../public/js/voicePrefs.js';
import { AudioManager, voiceLine, voiceTreeFor } from '../../public/js/audio.js';
import { VOICE_SPECIAL_TYPES } from '../../public/js/voicePrefs.js';
import { data } from '../../public/js/data.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const a = 'char_263_skadi', b = 'char_103_angel';
test('old settings migrate to inherit, malformed or prototype entries are discarded', () => {
  assert.deepEqual(sanitizeSettings({ voiceLang: 'jp' }).voiceOverrides, {});
  assert.deepEqual(sanitizeVoiceOverrides(Object.assign(Object.create({ [b]: 'jp' }), { [a]: 'jp', bad: 'cn', char_1_no: 'zz' })), { [a]: 'jp' });
  // every whole dub and every special type is a legal override; anything else is dropped
  assert.deepEqual(sanitizeVoiceOverrides({ [a]: 'en', [b]: 'kr' }), { [a]: 'en', [b]: 'kr' });
  assert.deepEqual(sanitizeVoiceOverrides({ [a]: 'ita' }), { [a]: 'ita' });
  assert.deepEqual(sanitizeVoiceOverrides({ [a]: 'cn_topolect' }), { [a]: 'cn_topolect' });
  assert.deepEqual(sanitizeVoiceOverrides({ [a]: 'de' }), {});
  for (const raw of [null, [], 1, 'jp']) assert.deepEqual(sanitizeVoiceOverrides(raw), {});
});
test('per-character override survives persistence; deletion restores the current global setting', () => {
  const settings = sanitizeSettings(JSON.parse(JSON.stringify({ voiceLang: 'cn', voiceOverrides: { [a]: 'jp', [b]: 'cn' } })));
  const manager = new AudioManager();
  manager.setVoiceLang(settings.voiceLang, settings.voiceOverrides);
  assert.equal(voiceLangFor(a, manager.voiceLang, manager.voiceOverrides), 'jp');
  manager.setVoiceLang('jp');
  assert.equal(voiceLangFor(b, manager.voiceLang, manager.voiceOverrides), 'cn');
  delete settings.voiceOverrides[b];
  manager.setVoiceLang('jp', settings.voiceOverrides);
  assert.equal(voiceLangFor(b, manager.voiceLang, manager.voiceOverrides), 'jp');
  assert.equal(voiceLangFor('unknown', 'cn', manager.voiceOverrides), 'cn');
});
test('the per-operator JP preference retains the existing per-slot Chinese fallback', () => {
  const tree = { voice: { [a]: { select: '/cn.mp3' } }, voiceJp: { [a]: { skill1: '/jp.mp3' } } };
  assert.equal(voiceLine(tree, a, 'select', voiceLangFor(a, 'cn', { [a]: 'jp' })).url, '/cn.mp3');
  assert.equal(voiceLine(tree, a, 'skill1', voiceLangFor(a, 'cn', { [a]: 'jp' })).url, '/jp.mp3');
});

test('English / Korean are whole trees of their own, and a special voice is that operator\'s subtree', () => {
  const audio = {
    voice: { [a]: { start: '/cn.mp3' } },
    voiceJp: { [a]: { start: '/jp.mp3' } },
    voiceEn: { [a]: { start: '/en.mp3' } },
    voiceKr: { [a]: { start: '/kr.mp3' } },
    voiceSpecial: { [a]: { ita: { start: '/ita.mp3' }, cn_topolect: { start: '/topo.mp3' } } },
  };
  assert.equal(voiceTreeFor(audio, a, 'jp').start, '/jp.mp3');
  assert.equal(voiceTreeFor(audio, a, 'en').start, '/en.mp3');
  assert.equal(voiceTreeFor(audio, a, 'kr').start, '/kr.mp3');
  assert.equal(voiceTreeFor(audio, a, 'ita').start, '/ita.mp3', 'the CUSTOM group reads voiceSpecial[charId][type]');
  assert.equal(voiceTreeFor(audio, a, 'cn_topolect').start, '/topo.mp3');
  assert.equal(voiceTreeFor(audio, a, 'cn'), null, '中文 is the base tree voiceLine reads directly');
  assert.equal(voiceTreeFor(audio, a, 'zz'), null);
  assert.equal(voiceTreeFor(audio, b, 'en'), null, 'an operator without that tree has none');
  assert.deepEqual([...VOICE_SPECIAL_TYPES], ['cn_topolect', 'ita', 'ger', 'rus', 'fre', 'spa', 'linkage']);
});

test('a special-voice choice plays its own file and falls back to the Chinese line of the same name, slot by slot', () => {
  const tree = {
    voice: { [a]: { select: '/cn_select.mp3', place: '/cn_place.mp3' } },
    voiceSpecial: { [a]: { ita: { select: '/ita_select.mp3' } } },
  };
  const line = (slot) => voiceLine(tree, a, slot, voiceLangFor(a, 'cn', { [a]: 'ita' }));
  assert.deepEqual(line('select'), { url: '/ita_select.mp3', fallback: '/cn_select.mp3' }, 'the special line, with the Chinese twin as its fallback');
  assert.deepEqual(line('place'), { url: '/cn_place.mp3', fallback: null }, 'a slot the special voice lacks plays 中文, like the JP dub does');
});

test('导出 / 导入语音设置：payload 带类型与版本，导入只认合法内容并清洗覆盖表', async () => {
  const mod = await import('../../public/js/ui/operatorVoice.js');
  const { voiceExportPayload, parseVoiceImport, VOICE_EXPORT_TYPE } = mod;
  const payload = voiceExportPayload({ voiceLang: 'jp', voiceOverrides: { [a]: 'ita' } });
  assert.deepEqual(payload, { type: VOICE_EXPORT_TYPE, version: 1, voiceLang: 'jp', voiceOverrides: { [a]: 'ita' } });
  assert.equal(VOICE_EXPORT_TYPE, 'stronghold-voice', '文件名与 type 都带 stronghold-voice 前缀');
  // 合法：完整 payload；也接受裸的 { voiceLang, voiceOverrides }
  assert.deepEqual(parseVoiceImport(payload), { voiceLang: 'jp', voiceOverrides: { [a]: 'ita' } });
  assert.deepEqual(parseVoiceImport({ voiceLang: 'en', voiceOverrides: { [b]: 'cn_topolect' } }), { voiceLang: 'en', voiceOverrides: { [b]: 'cn_topolect' } });
  // 非法：别的 type、非对象、空内容、非法语种被忽略而保留覆盖表
  assert.equal(parseVoiceImport({ type: 'stronghold-loadout', voiceOverrides: { [a]: 'ita' } }), null, '不认别人的导出文件');
  for (const bad of [null, [], 1, 'x']) assert.equal(parseVoiceImport(bad), null, String(bad));
  assert.equal(parseVoiceImport({}), null, '什么都没带 ⇒ 不导入');
  assert.deepEqual(parseVoiceImport({ voiceLang: 'zz', voiceOverrides: { [a]: 'ita' } }), { voiceLang: null, voiceOverrides: { [a]: 'ita' } }, '语种非法就不改全局，但覆盖表仍可用');
  assert.equal(parseVoiceImport({ voiceLang: 'zh', voiceOverrides: { [a]: 'de' } }), null, '覆盖值也要是已知语种 ⇒ 否则没有可导入内容');
});

test('设置页那一行按需加载花名册：标题画面（还没进对局）也能逐个设置', () => {
  // 名单来自 chess + backups。干员调配页用 useData(...) 按需加载并重渲染；只读 data.get('chess') 的话，标题画面
  // 那两个文件还没被请求过，名单为空，这一行就只剩提示（玩家反馈：之前没改的时候都可以直接在这里改的）。
  const src = readFileSync(path.join(ROOT, 'public/js/ui/operatorVoice.js'), 'utf8');
  assert.match(src, /import \{ data, useData \} from '\.\.\/data\.js'/, '要用 useData 才能触发加载');
  assert.match(src, /const settled = useData\('chess', 'backups'\)/, '像干员调配页那样按需加载 chess + backups');
  assert.match(src, /settled \? t\('该模式下没有可设置的干员'\) : t\('正在载入干员名单…'\)/, '两种提示：加载中 / 该模式没有');
  assert.ok(!/if \(!all\.length\) return null/.test(src), '名单为空时整行仍然渲染（曾经直接消失过）');
});

test('the picker offers the dubs the manifest carries and this operator\'s own special voices, each named in its language', async () => {
  const { voiceOptions } = await import('../../public/js/ui/operatorVoice.js');
  const audio = {
    voice: { [a]: { start: '/cn.mp3' } },
    voiceJp: { [a]: { start: '/jp.mp3' } },
    voiceKr: { [a]: { start: '/kr.mp3' } },          // no voiceEn: English is not offered for this operator
    voiceSpecial: { [a]: { ita: { start: '/ita.mp3' } } },
  };
  assert.deepEqual(voiceOptions(a, audio).map((o) => o.id), ['cn', 'jp', 'kr', 'ita'], 'the dubs the manifest has for it, then its own special voices');
  assert.equal(voiceOptions(a, audio)[0].label, '中文');
  assert.equal(voiceOptions(a, audio)[3].label, '意大利语', 'a special voice is named by the language it is in');
  assert.deepEqual(voiceOptions(b, audio).map((o) => o.id), ['cn'], 'an operator the manifest does not voice can only be 中文');
});
