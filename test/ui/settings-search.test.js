import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesSetting, settingsSearchText } from '../../public/js/ui/settingsSearch.js';

test('localized labels, explanations and English micro labels share literal case-insensitive search', () => {
  assert.ok(matchesSetting('声音 AUDIO 背景音乐 BGM', 'bgm'));
  assert.ok(matchesSetting('战斗显示 BATTLE 盟约效果剩余时间 下一层到期时间', '下一层'));
  assert.ok(matchesSetting('Sound AUDIO Voice Language 日本語', 'voice 日本語'));
  assert.ok(matchesSetting('音声 AUDIO 優先する言語', '音声 優先'));
  assert.equal(matchesSetting('Controls HOTKEYS', 'audio'), false);
  assert.equal(matchesSetting('Sounds BGM', 'BGM voice'), false);
});

test('full-width input and whitespace normalize, while punctuation remains literal', () => {
  assert.equal(settingsSearchText('  ＢＧＭ　\n 音乐  '), 'bgm 音乐');
  assert.ok(matchesSetting('BGM 背景音乐', 'ＢＧＭ　音乐'));
  assert.ok(matchesSetting('声音', '   '));
  assert.equal(matchesSetting('Voice AUDIO', '.*'), false);
  assert.equal(matchesSetting('Voice AUDIO', '[voice]'), false);
  assert.ok(matchesSetting('Use [test] theme', '[test]'));
});
