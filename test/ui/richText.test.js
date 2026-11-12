// Rich-text formatter (public/js/ui/richText.js): official markup parsing, placeholders, bond effects —
// checked against every description in the generated data so no real text breaks the parser.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRichText, richTextPlain, rtClassName, formatPlaceholder, fillPlaceholders, formatBondEffect } from '../../public/js/ui/richText.js';
import { bondEffectRecord } from '../../public/js/ui/bondEffect.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));

test('regulation replacement displays use the selected effect bindings for all seven strategies', () => {
  const bonds = load('versions/act3autochess-v3_1/bonds.json');
  const effects = load('versions/act3autochess-v3_1/effects.json');
  const pairs = [
    ['yanShip', 'bondeffect_yan'], ['sargonShip', 'bondeffect_sargon'],
    ['victoriaShip', 'bondeffect_victoria_2'], ['egirShip', 'bondeffect_egir_2'],
    ['kazimierzShip', 'bondeffect_kazimierz'], ['kjeragShip', 'bondeffect_kjerag'],
    ['siracusaShip', 'bondeffect_siracusa'],
  ];
  const before = JSON.stringify(bonds);
  for (const [id, target] of pairs) {
    for (const layers of [0, 40, 999]) {
      const record = bondEffectRecord(bonds[id], effects[target], layers);
      assert.equal(record.effectId, target);
      assert.equal(record.effectDescRaw, effects[target].descRaw);
      assert.ok(Array.isArray(effects[target].effectDescParams), target);
      const text = richTextPlain(formatBondEffect(record, layers));
      assert.ok(!/\{\d+(?::[^}]+)?\}|NaN|—/.test(text), `${target}: ${text}`);
      assert.equal(record.descRaw, formatBondEffect(record, layers));
    }
  }
  const flame = bondEffectRecord(bonds.kazimierzShip, effects.bondeffect_kazimierz, 40);
  assert.deepEqual(bondEffectRecord(bonds.yanShip, effects.bondeffect_yan).thresholds, [3, 6, 9]);
  assert.match(richTextPlain(flame.descRaw), /90%/);
  assert.match(richTextPlain(flame.descRaw), /120%/);
  assert.ok(!richTextPlain(flame.descRaw).includes('整备区最右侧'));
  const normal = bondEffectRecord(bonds.kazimierzShip, effects.bondeffect_kazimierz_2, 40);
  assert.match(richTextPlain(normal.descRaw), /整备区最右侧/);
  assert.match(richTextPlain(formatBondEffect(normal, 40)), /90%/);
  assert.equal(JSON.stringify(bonds), before);
  assert.equal(bondEffectRecord(bonds.kazimierzShip, undefined), bonds.kazimierzShip);
});

test('description parameters respect official maxima and missing bindings stay visibly unavailable', () => {
  const record = { effectDesc: '{0:0%}', effectDescParams: [{ index: 0, format: '0%', base: 'base', perStack: 'growth', max: 2 }], bb: { base: 0.5, growth: 0.1 } };
  assert.equal(formatBondEffect(record, 999), '200%');
  assert.equal(formatBondEffect({ ...record, bb: {} }, 0), '—');
});

describe('parseRichText', () => {
  test('styled spans, terms, literal trigger labels, newlines', () => {
    const segs = parseRichText('所有干员<@ba.vup>防御力</>提升\n<在场<@autochess.dgreen>3</>名>改为<$ba.stun>晕眩</>');
    assert.deepEqual(segs, [
      { text: '所有干员', cls: [], term: false },
      { text: '防御力', cls: ['ba.vup'], term: false },
      { text: '提升', cls: [], term: false },
      { br: true },
      { text: '<在场', cls: [], term: false },
      { text: '3', cls: ['autochess.dgreen'], term: false },
      { text: '名>改为', cls: [], term: false },
      { text: '晕眩', cls: ['ba.stun'], term: true },
    ]);
  });
  test('nesting, escaped newlines, stray closers, unterminated tags', () => {
    const segs = parseRichText('<@ba.vup>a<$ba.cold>b</>c</>d\\ne</>f<@ba.kw>g');
    assert.deepEqual(segs.filter((s) => !s.br).map((s) => [s.text, s.cls.join('+'), s.term]), [
      ['a', 'ba.vup', false], ['b', 'ba.vup+ba.cold', true], ['c', 'ba.vup', false], ['d', '', false], ['e</>f', '', false], ['g', 'ba.kw', false],
    ]);
    assert.equal(segs.filter((s) => s.br).length, 1);
  });
  test('non-strings and empty', () => {
    assert.deepEqual(parseRichText(null), []);
    assert.deepEqual(parseRichText(''), []);
    assert.deepEqual(parseRichText(42), [{ text: '42', cls: [], term: false }]);
    assert.equal(richTextPlain('<获得时>获得<@ba.vup>1</>资金'), '<获得时>获得1资金');
  });
  test('class names', () => {
    assert.equal(rtClassName('ba.vup'), 'rt-vup');
    assert.equal(rtClassName('ba.vdown'), 'rt-vdown');
    assert.equal(rtClassName('whatever'), 'rt-hl');
    assert.equal(rtClassName('ba.stun', true), 'rt-term');
  });
  test('every official description parses to the same plain text as `desc`', () => {
    let checked = 0;
    const files = ['bonds.json', 'bands.json', 'items.json', 'garrisons.json', 'effects.json'];
    for (const f of files) {
      for (const rec of Object.values(load(f))) {
        if (typeof rec?.descRaw !== 'string' || typeof rec?.desc !== 'string') continue;
        const plain = richTextPlain(rec.descRaw).replace(/\s+/g, '');
        assert.equal(plain, rec.desc.replace(/\s+/g, ''), `${f}: ${rec.bondId || rec.bandId || rec.id || rec.garrisonId || rec.effectId}`);
        checked++;
      }
    }
    for (const c of Object.values(load('chess.json'))) {
      if (!c?.skill?.descRaw) continue;
      assert.equal(richTextPlain(c.skill.descRaw).replace(/\s+/g, ''), c.skill.desc.replace(/\s+/g, ''), c.chessId);
      checked++;
    }
    assert.ok(checked > 500, `checked ${checked}`);
  });
});

describe('placeholders', () => {
  test('formatPlaceholder', () => {
    assert.equal(formatPlaceholder(0.15, '0%'), '15%');
    assert.equal(formatPlaceholder(0.1234, '0.0%'), '12.3%');
    assert.equal(formatPlaceholder(3.6, '0'), '4');
    assert.equal(formatPlaceholder(3.64, '0.0'), '3.6');
    assert.equal(formatPlaceholder(-0.001, '0'), '0');
    assert.equal(formatPlaceholder(NaN, '0'), '?');
    assert.equal(formatPlaceholder(2), '2');
  });
  test('fillPlaceholders keeps unknown indexes', () => {
    assert.equal(fillPlaceholders('攻击+{0:0%}，持续{1}秒，{2:0}', [0.2, 5]), '攻击+20%，持续5秒，{2:0}');
    assert.equal(fillPlaceholders('x{0}', ['文本']), 'x文本');
    assert.equal(fillPlaceholders(null, []), '');
  });
  test('formatBondEffect resolves base + perStack × layers for every bond', () => {
    const bonds = load('bonds.json');
    const deput = bonds.deputShip;
    const txt = formatBondEffect(deput, 10);
    const expected = Math.round((deput.bb.base_def + deput.bb.def_per_stack * 10) * 100);
    assert.ok(richTextPlain(txt).includes(`+${expected}%`), txt);
    for (const b of Object.values(bonds)) {
      const out = richTextPlain(formatBondEffect(b, 25));
      assert.ok(!/\{\d+(:[^}]*)?\}/.test(out), `${b.bondId} leaves a placeholder: ${out}`);
    }
    // a chance stops at 100 % (GitHub #108: 不屈 read 124 % at 266 layers; the sim caps it with min(1, …))
    for (const id of ['indomShip', 'swiftShip', 'miraShip']) {
      const pct = richTextPlain(formatBondEffect(bonds[id], 500)).match(/(\d+)%/);
      assert.ok(pct && Number(pct[1]) === 100, `${id} at 500 layers: ${pct && pct[0]}`);
    }
    assert.equal(formatBondEffect(null, 3), '');
    assert.equal(formatBondEffect({ effectDesc: 'x{0:0}', effectDescParams: [{ index: 0, format: '0', base: 'a', perStack: 'b' }], bb: { a: 1, b: 2 } }, 'bad'), 'x1');
  });
});
