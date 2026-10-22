import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTextFiniteReader, textFinite } from '../../shared/plugins/textNumber.js';
import { BOUND_TABLES, forgetOfficialBounds, rememberOfficialBounds } from '../../shared/plugins/officialBounds.js';

const NINES = '9'.repeat(400);

test('reusable finite readers preserve captures, Chinese digits and finite fallbacks', () => {
  const fallback = { valueOf() { throw new Error('unused fallback was coerced'); } };
  const cases = [
    ['value=0', /value=(-?\d+(?:\.\d+)?)/, fallback, 0],
    ['value=-12.5', /value=(-?\d+(?:\.\d+)?)/, fallback, -12.5],
    ['持续120秒', /持续(\d+)秒/, fallback, 120],
    ['nothing', /value=(\d+)/, fallback, fallback],
    ['value=', /value=(\d*)/, fallback, fallback],
    ['x', /x(\d+)?/, fallback, fallback],
    [null, /(\d+)/, fallback, fallback],
    [undefined, /(\d+)/, NaN, NaN],
    [`${NINES}连发`, /(\d+)连发/, '17', 17],
    [`${NINES}连发`, /(\d+)连发/, Infinity, 0],
    ['NaN', /(NaN)/, -3, -3],
    ['Infinity', /(Infinity)/, NaN, 0],
  ];
  for (const [text, re, fb, expected] of cases) {
    const read = createTextFiniteReader(re);
    assert.equal(textFinite(text, re, fb), expected);
    assert.equal(read(text, fb), expected);
    assert.equal(read(text, fb), expected, 'repeated reads have the same result');
  }
  for (const [digit, expected] of Object.entries({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 })) {
    const re = /([一二两三四五六七八九十])连击/;
    assert.equal(createTextFiniteReader(re)(`${digit}连击`, NaN), expected);
    assert.equal(textFinite(`${digit}连击`, re, NaN), expected);
  }
});

test('global and sticky readers start at zero without changing the original lastIndex', () => {
  for (const flags of ['', 'g', 'y', 'gy', 'iy']) {
    const re = new RegExp('v=(\\d+)', flags);
    re.lastIndex = 4;
    const read = createTextFiniteReader(re);
    assert.equal(read('v=3 v=7', 0), 3, flags);
    assert.equal(read('v=9', 0), 9, flags);
    assert.equal(read('none', 0), 0, flags);
    assert.equal(read('v=2', 0), 2, flags);
    assert.equal(read('xv=5', 0), flags.includes('y') ? 0 : 5, flags);
    assert.equal(re.lastIndex, 4, flags);
  }
  assert.equal(createTextFiniteReader(/V=(\d+)/iu)('v=12', 0), 12);
});

test('text coercion may re-enter a sticky reader without moving the outer match', () => {
  const read = createTextFiniteReader(/(\d+)/y);
  const input = {
    toString() {
      assert.equal(read('123', 0), 123);
      return '7';
    },
  };
  assert.equal(read(input, 0), 7);
  assert.equal(read('9', 0), 9);
});

test('a reader snapshots the pattern while textFinite keeps cloning the current pattern', () => {
  const re = /value=(\d+)/g;
  const read = createTextFiniteReader(re);
  re.compile('other=(\\d+)', 'y');
  assert.equal(read('value=4', 0), 4);
  assert.equal(read('other=8', 0), 0);
  assert.equal(textFinite('other=8', re, 0), 8);
  assert.equal(textFinite('value=4', re, 0), 0);

  const current = /value=(\d+)/;
  const input = {
    toString() {
      current.compile('other=(\\d+)');
      return 'value=6';
    },
  };
  assert.equal(textFinite(input, current, 0), 6, 'clone happens before text coercion');
  assert.equal(textFinite('other=5', current, 0), 5, 'next call sees the changed pattern');
});

test('a reader reads subclass pattern getters once and uses a plain private matcher', () => {
  const reads = [];
  class ObservedPattern extends RegExp {
    get source() { reads.push('source'); return super.source; }
    get flags() { reads.push('flags'); return super.flags; }
    exec() { throw new Error('caller matcher must not run'); }
  }
  const re = new ObservedPattern('(\\d+)', 'gy');
  const read = createTextFiniteReader(re);
  assert.deepEqual(reads, ['source', 'flags']);
  assert.equal(read('3', 0), 3);
  assert.equal(read('4', 0), 4);
  assert.deepEqual(reads, ['source', 'flags']);
  assert.equal(textFinite('5', re, 0), 5);
  assert.deepEqual(reads, ['source', 'flags', 'source', 'flags']);
});

test('invalid patterns return the fallback without coercing text', () => {
  const text = { toString() { throw new Error('text must not be coerced'); } };
  const fallback = Symbol('fallback');
  for (const re of [null, undefined, {}, '(\\d+)']) {
    assert.equal(createTextFiniteReader(re)(text, fallback), fallback);
    assert.equal(textFinite(text, re, fallback), fallback);
  }
});

test('official text scanning retains every phrase maximum across nested tables and new sources', () => {
  const phrases = [
    ['burst', '3连发', 3],
    ['attack-times', '攻击7次', 7],
    ['steal', '偷取触发2次', 2],
    ['combo', '十连击', 10],
    ['chain-attack', '连续攻击两次', 2],
    ['total-times', '总计6次', 6],
    ['extra-targets', '额外攻击4个目标', 4],
    ['at-most', '至多九个', 9],
    ['at-most-pack', '至多八只', 8],
    ['initial-pack', '初始七只', 7],
    ['jump-ally', '在5个友方单位间跳跃', 5],
    ['jump-enemy', '在6个敌人间跳跃', 6],
    ['own-max', '最多拥有2个', 2],
    ['exist-n', '存在 11 名', 11],
  ];
  const data = Object.fromEntries(BOUND_TABLES.map(table => [table, { records: [] }]));
  phrases.forEach(([_id, desc], i) => data[BOUND_TABLES[i % BOUND_TABLES.length]].records.push({ nested: [null, 42, { desc }] }));
  data.chess.records.push({ desc: `1连发 / ${NINES}连发` });
  data.enemies.records.push({ desc: `${NINES}连发` });
  try {
    const first = rememberOfficialBounds(data);
    assert.deepEqual(first.text, new Map(phrases.map(([id, _desc, max]) => [id, max])));
    assert.equal(rememberOfficialBounds(data), first, 'the existing source-identity cache is retained');
    assert.deepEqual(rememberOfficialBounds({ chess: ['8连发'] }).text, new Map([['burst', 8]]));
    assert.deepEqual(rememberOfficialBounds({}).text, new Map(), 'new sources do not retain an earlier maximum');
  } finally {
    forgetOfficialBounds();
  }
});
