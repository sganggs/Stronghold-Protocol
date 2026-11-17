// 选择自编 screen wiring: the client marks the cards and both pages load the stylesheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('选择自编 screen exposes its controls and both pages link the stylesheet', () => {
  const js = read('public/js/screens/diyCheck.js');
  for (const id of ['diy-check', 'diy-check-confirm', 'diy-check-none', 'diy-check-card']) {
    assert.match(js, new RegExp(`data-testid="${id}"`), id);
  }
  assert.match(js, /默认|defaultDiyBring/);
  for (const page of ['public/index.html', 'public/dev/game-mock.html']) {
    assert.match(read(page), /href="\/css\/screens\/diy-check\.css"/, page);
  }
});
