import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
const notice = source.slice(source.indexOf('  // graceful degradation:'), source.indexOf('  // phase changes:'));

function fixture(search = '') {
  const messages = [];
  const ref = { current: false };
  const context = vm.createContext({
    URLSearchParams, location: { search }, viewKind: 'loading',
    useRef: () => ref, useEffect: fn => fn(), t: s => s,
    toast: (...args) => messages.push(args),
  });
  const render = kind => {
    context.viewKind = kind;
    vm.runInContext(`(() => { ${notice} })()`, context);
  };
  return { messages, render, context };
}

test('fallback notice appears once across loading, fallback and successful recovery in one match', () => {
  const f = fixture();
  for (const kind of ['loading', 'fallback', 'loading', 'fallback', 'engine', 'loading', 'fallback']) f.render(kind);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0][1], 'info');
  const nextMatch = fixture(); nextMatch.render('fallback');
  assert.equal(nextMatch.messages.length, 1, 'a new mounted match has its own notice budget');
});

test('explicit fallback never consumes or shows the failure notice', () => {
  for (const search of ['?render=fallback', '']) {
    const f = fixture(search);
    if (!search) f.context.__SP_RENDER__ = 'fallback';
    f.render('fallback'); f.render('loading'); f.render('fallback');
    assert.equal(f.messages.length, 0);
  }
});
