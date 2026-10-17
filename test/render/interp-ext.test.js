// `ext`：内容单位自己发布给客户端的展示状态（sim Unit.publish）——解析、丢弃畸形项、按快照读回；不参与插值。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer, normalizeSnapshot } from '../../public/js/render/interp.js';
import { ANIM } from '../../shared/constants.js';

const tuple = (id, x) => [id, x, 9, 100, 100, 0, 0, 0, ANIM.IDLE];
const frame = (t, x, ext) => ({ t, units: [tuple(1, x)], ...(ext === undefined ? {} : { ext }) });

test('ext：只保留快照里存在的单位与非空、类型合法的键值', () => {
  const valid = normalizeSnapshot({
    t: 1, units: [tuple(1, 0)], ext: [
      null, 'x', [1], [2, [['a', 1]]], [1, 'nope'],
      [1, [null, ['', 1], [1, 1], ['a', 2.5], ['b', 'text'], ['c', true], ['d', null], ['e', {}], [{}, 1]]],
    ],
  });
  assert.deepEqual([...valid.ext.keys()], [1], 'the unknown unit is dropped');
  assert.deepEqual(valid.ext.get(1), { a: 2.5, b: 'text', c: true }, 'bad keys and values are dropped');
  for (const ext of [undefined, null, {}, [], [[2, [['a', 1]]]], [[1, []]]]) {
    assert.equal(normalizeSnapshot({ t: 1, units: [tuple(1, 0)], ext }).ext, null);
  }
});

test('extOf：按快照时间读回发布的状态，不插值；没有发布或没有单位时返回 null', () => {
  const b = new SnapshotBuffer();
  b.push(frame(0, 0, [[1, [['stage', 1], ['cooling', false]]]]));
  b.push(frame(1, 1, [[1, [['stage', 2], ['label', 'second']]]]));
  b.push(frame(2, 2));
  assert.deepEqual(b.extOf(1, 0), { stage: 1, cooling: false });
  assert.deepEqual(b.extOf(1, 0.5), { stage: 1, cooling: false }, 'the older snapshot until the newer starts');
  assert.deepEqual(b.extOf(1, 1), { stage: 2, label: 'second' });
  assert.equal(b.extOf(1, 2), null, 'a snapshot without ext clears it');
  assert.equal(b.extOf(9, 1), null, 'an unknown unit has published nothing');
  assert.equal(new SnapshotBuffer().extOf(1), null, 'no snapshot at all');
});
