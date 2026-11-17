// The solo 「不限时」 switch and the version's time lines (DESIGN §35.23.10): the gear only for a timed solo, the
// briefing and the lobby card follow the version, and every new msgid has English with no CJK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOM = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
const LOBBY = readFileSync(path.join(ROOT, 'public/js/screens/lobby.js'), 'utf8');
const PICKER = readFileSync(path.join(ROOT, 'public/js/ui/versionPicker.js'), 'utf8');
const EN = JSON.parse(readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));

const roomMod = () => import(pathToFileURL(path.join(ROOT, 'public/js/screens/room.js')).href);
const verMod = () => import(pathToFileURL(path.join(ROOT, 'public/js/versions.js')).href);

const room = (o = {}) => ({
  code: 'ABCD', hostId: 'h', mode: 'solo', difficulty: 'NORMAL',
  seats: [{ seat: 0, playerId: 'h', name: 'Host', isBot: false, ready: false, connected: true }],
  ...o,
});
const v1 = { id: 'act1autochess', rules: { soloTimed: true } };
const v2 = { id: 'act2autochess@V2_1', rules: {} };

const MSGIDS = [
  '不限时',
  '模拟设置',
  '休整每轮 300 秒，机变 150 秒',
  '每轮 300 秒',
  '独立模拟中每轮休整限时 300 秒，机变 150 秒',
  '关闭本局休整与机变的计时。官方为休整期每轮 300 秒、机变 150 秒。',
  '核心规则已按该版本。悬赏抽取、部分数值和六名敌人的攻击前摇仍是推算',
];

test('soloUnlimitedOption: a timed solo only, off when the key is absent, host edits', async () => {
  const { soloUnlimitedOption, aiLastOption } = await roomMod();
  assert.deepEqual(soloUnlimitedOption(room(), 'h', true), { on: false, editable: true });
  assert.deepEqual(soloUnlimitedOption(room({ soloUnlimited: true }), 'h', true), { on: true, editable: true });
  assert.deepEqual(soloUnlimitedOption(room({ soloUnlimited: true, hostId: 'other' }), 'g', true), { on: true, editable: false });
  assert.equal(soloUnlimitedOption(room(), 'h', false), null, '第二期 solo');
  assert.equal(soloUnlimitedOption(room(), 'h', null), null, 'data not on screen');
  assert.equal(soloUnlimitedOption(room({ mode: 'coop' }), 'h', true), null);
  assert.equal(soloUnlimitedOption(null, 'h', true), null);
  assert.equal(aiLastOption(room(), 'h'), null, 'solo still has no AI switch');
});

test('solo time lines: 300/150 when timed and off, the untimed lines otherwise, nothing while unknown', async () => {
  const { soloTimeMsgid, soloTimedOf } = await verMod();
  assert.equal(soloTimedOf({ version: v1 }, 'act1autochess'), true);
  assert.equal(soloTimedOf({ version: v1 }, 'act1autochess@V1_1'), null, 'still showing another version');
  assert.equal(soloTimedOf({ version: v2 }, 'act2autochess@V2_1'), false);
  assert.equal(soloTimedOf({}, 'act2autochess'), false);
  assert.equal(soloTimedOf(null, null), false);

  assert.equal(soloTimeMsgid('brief', { timed: true, unlimited: false }), '独立模拟中每轮休整限时 300 秒，机变 150 秒');
  assert.equal(soloTimeMsgid('brief', { timed: true, unlimited: true }), '独立模拟中休整期与机变阶段不限时');
  assert.equal(soloTimeMsgid('brief', { timed: false }), '独立模拟中休整期与机变阶段不限时');
  assert.equal(soloTimeMsgid('brief', { timed: null }), '');
  assert.equal(soloTimeMsgid('card', { timed: true, unlimited: false }), '休整每轮 300 秒，机变 150 秒');
  assert.equal(soloTimeMsgid('card', { timed: false }), '休整期与机变阶段不限时');
  assert.equal(soloTimeMsgid('short', { timed: true, unlimited: false }), '每轮 300 秒');
  assert.equal(soloTimeMsgid('short', { timed: true, unlimited: true }), '不限时');
  assert.equal(soloTimeMsgid('short', { timed: false }), '');
});

test('the room, the lobby and the picker say the new lines through t(); en.json has the English', () => {
  assert.match(ROOM, /net\.request\('room\.setSoloUnlimited', \{ on \}\)/);
  assert.match(LOBBY, /soloUnlimited: true/);
  assert.match(LOBBY, /data-testid="solo-unlimited"/);
  assert.ok(PICKER.includes("t('核心规则已按该版本。悬赏抽取、部分数值和六名敌人的攻击前摇仍是推算')"));
  assert.ok(!PICKER.includes('部分规则仍按第二期下半，正在逐步复刻'));
  for (const zh of MSGIDS) {
    assert.equal(typeof EN[zh], 'string', `en.json: ${zh}`);
    assert.ok(EN[zh].length > 0 && !/[一-鿿]/.test(EN[zh]), `English for ${zh}: ${EN[zh]}`);
  }
});
