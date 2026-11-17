// §37.46 (the maintainer's choice of 2026-10-30): on 终极 the bots' band pick multiplies the starting-LP weight by how well
// the bots play each band (bandStrength: 80 forced 终极 solo games per band, shrunk toward the mean, to the 6th power).
// Other difficulties keep the LP weight alone (only the default version has 终极; the others stop at 绝境).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { botPickBand, bandStrength } from '../../server/match/bot.js';

const bots = (n) => Array.from({ length: n }, (_, i) => ({ seat: i, playerId: `ai_${i}`, name: `AI-${i + 1}`, isBot: true, connected: true }));

/** The first seat's pick shares over an even sweep of the bots' rng (botPickBand draws once per call). */
function shares(m, ps, n = 4000) {
  const orig = m.rngBots;
  const count = {};
  try {
    for (let i = 0; i < n; i++) {
      m.rngBots = () => (i + 0.5) / n;
      const id = botPickBand(m, ps);
      count[id] = (count[id] || 0) + 1;
    }
  } finally { m.rngBots = orig; }
  return (id) => (count[id] || 0) / n;
}

test('§37.46: on 终极 the band pick also weighs how well the bots play each band', (t) => {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', seed: 3, seats: bots(1) });
  t.after(() => h.dispose?.());
  const m = h.m, ps = m.order[0];
  const s = (id) => bandStrength(m, id);
  assert.ok(s('band_amiya') > s('band_sarkazb') && s('band_sarkazb') > s('band_doberm') && s('band_doberm') > s('band_clementia'),
    '阿米娅 > 歌利亚 > 杜宾 > 克莱门莎');
  // a band outside the table (plugin data) counts as the table's mean
  assert.ok(s('band_plugin_x') > s('band_mlynar') && s('band_plugin_x') < s('band_doberm'));
  const share = shares(m, ps);
  // 歌利亚 still leads on its 45 LP, more often than by LP alone (44 %); 克莱门莎 (26 LP, the bots' weakest band) almost never
  assert.ok(share('band_sarkazb') > 0.5, `歌利亚 ${share('band_sarkazb')}`);
  assert.ok(share('band_clementia') < 0.002, `克莱门莎 ${share('band_clementia')}`);
  // 阿米娅 (25 LP) against 杜宾 (30 LP): 1 to 5 by LP alone, about 2 to 3 with the strength
  assert.ok(share('band_amiya') / share('band_doberm') > 0.5, `阿米娅 / 杜宾 ${share('band_amiya') / share('band_doberm')}`);
});

test('§37.46: off 终极 the LP weight stands alone', (t) => {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 3, seats: bots(1) });
  t.after(() => h.dispose?.());
  for (const id of h.m.gd.bandIds()) assert.equal(bandStrength(h.m, id), 1, id);
});
