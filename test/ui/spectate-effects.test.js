// 观战对象的效果列(游玩记录 #2 追加反馈:「观战队友时右侧的 effect 列也改成观战对象的」):
//   * 整备期侦察:m.field 直接带被侦察玩家的 effectsView(server Match.prepFieldMeta,现成显示形状);
//   * 战斗观战(显示复刻):runner 从 spec 的原始 playerEffects 客户端还原显示条目
//     (battle/observe.js spectateEffects — 策略效果经 bands.json 的 effectId,其余经 effects.json);
//   * 联防 / boss 对半场与服务器运行场的 meta 无 effects —— 列留空,不再显示自己的。
// 服务器侧:test/match/prep-bench.test.js。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};
const { data } = await import('../../public/js/data.js');
await data.loadAll('effects', 'bands', 'assets');
const { spectateEffects } = await import('../../public/js/battle/observe.js');

describe('spectateEffects — the watched battle\'s effects column from the spec', () => {
  const spec = { players: [
    { playerId: 'p1', playerEffects: [
      { id: 'aceffect_band_21', source: 'band' },            // 华法琳【重点监护】
      { id: 'aceffect_char_1', source: 'choice', counter: 2 },
      { id: 'effect_not_in_data', source: 'team' },
    ] },
    { playerId: 'p2', playerEffects: [] },
  ] };

  test('the single member\'s playerEffects resolved: band via bands.json, the rest via effects.json', () => {
    const out = spectateEffects(spec, ['p1']);
    assert.ok(Array.isArray(out) && out.length === 3);
    assert.deepEqual([out[0].name, out[0].iconKind, out[0].iconId], ['重点监护', 'band', 'icon_bldsk']);
    assert.match(out[0].desc, /开始作战时/);
    assert.deepEqual([out[1].name, out[1].iconKind, out[1].counter], ['未精英化', 'choice', 2]);
    assert.equal(out[2].name, 'effect_not_in_data', 'an unknown id falls back to the id');
    assert.equal(out[2].iconKind, 'team');
  });

  test('undefined where whose column would be ambiguous or missing', () => {
    assert.equal(spectateEffects(spec, ['p1', 'p2']), undefined, '联防 / boss pairs');
    assert.equal(spectateEffects({ players: [{ playerId: 'p1' }] }, ['p1']), undefined, 'no playerEffects on the spec');
    assert.equal(spectateEffects(null, ['p1']), undefined);
    assert.deepEqual(spectateEffects(spec, ['p2']), [], 'an empty list stays a list (empty column)');
  });

  test('wiring: the runner derives it for replica fields, the game screen prefers the field\'s list (source)', () => {
    assert.match(read('public/js/battle/runner.js'), /effects: spectateEffects\(e\.spec, e\.members\)/);
    assert.match(read('public/js/battle/runner.js'), /import \{ spectateEffects \} from '\.\/observe\.js'/);
    assert.match(read('public/js/screens/game.js'), /watchingOther && field \? \(field\.effects \?\? null\) : priv\?\.effects/);
  });
});
