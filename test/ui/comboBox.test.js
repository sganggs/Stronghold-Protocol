// Keyboard map of the custom listbox (ui/comboBox.js comboMove). No DOM: the component
// calls this function and returns focus to the combobox when `focusReturn` is set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comboMove } from '../../public/js/ui/comboBox.js';

const options = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'end', label: 'Endless' },
];
const closed = { open: false, active: 1, query: '', queryAt: 0 };

test('arrows open onto the current option, then move without wrapping', () => {
  const down = comboMove(closed, { key: 'ArrowDown', time: 0 }, { options });
  assert.equal(down.open, true);
  assert.equal(down.active, 1, 'the first ArrowDown keeps the current option');
  assert.equal(down.prevent, true);
  const next = comboMove(down, { key: 'ArrowDown', time: 10 }, { options });
  assert.equal(next.active, 2);
  const up = comboMove(next, { key: 'ArrowUp', time: 20 }, { options });
  assert.equal(up.active, 1);
  const stuck = comboMove({ open: true, active: 0, query: '', queryAt: 0 }, { key: 'ArrowUp' }, { options });
  assert.equal(stuck.active, 0);
  const end = comboMove({ open: true, active: options.length - 1, query: '', queryAt: 0 }, { key: 'ArrowDown' }, { options });
  assert.equal(end.active, options.length - 1);
  const openedUp = comboMove({ open: false, active: -1, query: '', queryAt: 0 }, { key: 'ArrowUp' }, { options });
  assert.equal(openedUp.active, options.length - 1);
});

test('Home and End jump, Enter and Space commit, Esc closes and asks for focus back', () => {
  const home = comboMove({ open: true, active: 3, query: '', queryAt: 0 }, { key: 'Home' }, { options });
  assert.equal(home.active, 0);
  const end = comboMove(home, { key: 'End' }, { options });
  assert.equal(end.active, options.length - 1);
  const opened = comboMove(closed, { key: 'Enter' }, { options });
  assert.equal(opened.open, true);
  assert.equal(opened.commit, undefined);
  const picked = comboMove({ ...opened, active: 2 }, { key: ' ' }, { options });
  assert.equal(picked.commit, 'ja');
  assert.equal(picked.open, false);
  assert.equal(picked.focusReturn, true);
  const esc = comboMove({ open: true, active: 2, query: 'e', queryAt: 5 }, { key: 'Escape' }, { options });
  assert.equal(esc.open, false);
  assert.equal(esc.commit, undefined);
  assert.equal(esc.focusReturn, true);
  assert.equal(esc.prevent, true);
  const idle = comboMove(closed, { key: 'Escape' }, { options });
  assert.equal(idle.prevent, false);
  assert.equal(idle.focusReturn, false);
});

test('type-ahead grows a buffer, then starts again after the gap, and wraps', () => {
  const e = comboMove(closed, { key: 'e', time: 1000 }, { options });
  assert.equal(e.open, true);
  assert.equal(e.active, 4, 'Endless follows English when the buffer starts after the current option');
  assert.equal(e.query, 'e');
  const en = comboMove(e, { key: 'n', time: 1200 }, { options });
  assert.equal(en.active, 4, 'Endless still starts with the grown buffer');
  assert.equal(en.query, 'en');
  const eng = comboMove(en, { key: 'g', time: 1300 }, { options });
  assert.equal(eng.active, 1, 'English is the later label that starts with eng');
  const again = comboMove(eng, { key: 'e', time: 1300 + 501 }, { options });
  assert.equal(again.query, 'e');
  assert.equal(again.active, 4, 'a fresh buffer starts at the next option and wraps onto Endless');
  const contains = comboMove({ open: true, active: 0, query: '', queryAt: 0 }, { key: 's', time: 10 }, { options, typeaheadMs: 500 });
  assert.equal(contains.active, 1, 'a letter no label starts with still matches inside English');
});

test('Alt+Arrow opens or commits, Tab closes, an empty value can be committed', () => {
  const alt = comboMove(closed, { key: 'ArrowDown', altKey: true }, { options });
  assert.equal(alt.open, true);
  assert.equal(alt.commit, undefined);
  const up = comboMove({ open: true, active: 0, query: '', queryAt: 0 }, { key: 'ArrowUp', altKey: true }, { options: [{ value: '', label: '跟随全局' }, ...options] });
  assert.equal(up.commit, '');
  assert.equal(up.focusReturn, true);
  const tab = comboMove({ open: true, active: 1, query: '', queryAt: 0 }, { key: 'Tab' }, { options });
  assert.equal(tab.open, false);
  assert.equal(tab.commit, undefined);
  assert.equal(tab.prevent, false);
});
