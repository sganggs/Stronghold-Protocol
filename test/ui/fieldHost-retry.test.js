import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../public/js/ui/fieldHost.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/^export /gm, '')
  .replace('mountFieldView(host, { signal: controller.signal })', 'mountAttempt(host, { signal: controller.signal })');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function fixture({ kinds = ['fallback', 'engine'], forced = false, reason = 'timeout', delays } = {}) {
  const slots = [], timers = new Map(), views = [], attempts = [];
  const window = new EventTarget();
  const document = new EventTarget(); document.visibilityState = 'visible';
  const navigator = { onLine: true };
  let cursor = 0, queued = false, mounted = true, cleanup, effect, state, timerId = 0;
  const rerender = () => {
    if (!mounted || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (mounted) render(); });
  };
  const context = vm.createContext({
    AbortController, DOMException, URLSearchParams, Promise, window, document, navigator,
    location: { search: forced ? '?render=fallback' : '' },
    console: { error() {}, warn() {} },
    settingsStore: { subscribe: () => () => {} },
    store: { get: () => ({}), subscribe: () => () => {} },
    useState(initial) {
      const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value;
        if (next !== slots[i]) { slots[i] = next; rerender(); } }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((value, n) => value !== old[n])) { slots[i] = deps; effect = fn; }
    },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    mountAttempt(_host, { signal }) {
      const view = { kind: kinds[Math.min(attempts.length, kinds.length - 1)], fallbackReason: reason, destroyed: 0,
        destroy() { this.destroyed++; }, resize() {} };
      attempts.push(signal); views.push(view); return Promise.resolve(view);
    },
  });
  vm.runInContext((delays ? source.replace('[2000, 8000]', JSON.stringify(delays)) : source) + '\nglobalThis.hook = useFieldView;', context);
  function render() {
    cursor = 0; effect = null; state = context.hook({ current: {} });
    if (effect) { cleanup?.(); cleanup = effect(); }
  }
  render();
  return {
    timers, views, attempts, document, navigator,
    get state() { return state; },
    event(type) { (type === 'visibilitychange' ? document : window).dispatchEvent(new Event(type)); },
    fire() { const entry = timers.entries().next().value; assert.ok(entry, 'fallback schedules a bounded automatic retry');
      const [id, timer] = entry; timers.delete(id); timer.fn(); },
    unmount() { mounted = false; cleanup?.(); },
    get exposed() { return context.__SP_VIEW__; },
  };
}

test('fallback recovers automatically without online or visibility events and disposes its old view', async () => {
  const f = fixture(); await flush();
  assert.equal(f.state.kind, 'fallback'); assert.equal(f.timers.size, 1);
  f.fire(); await flush();
  assert.equal(f.state.kind, 'engine'); assert.equal(f.attempts.length, 2);
  assert.equal(f.views[0].destroyed, 1); assert.equal(f.views[1].destroyed, 0); assert.equal(f.timers.size, 0);
  f.unmount(); assert.equal(f.views[1].destroyed, 1); assert.equal(f.exposed, null);
});

test('permanent failure stops after two automatic retries rather than looping', async () => {
  const f = fixture({ kinds: ['fallback'] }); await flush();
  f.fire(); await flush(); f.fire(); await flush();
  assert.equal(f.attempts.length, 3); assert.equal(f.timers.size, 0);
  f.event('online'); await flush(); assert.equal(f.attempts.length, 4, 'existing user-event recovery remains available');
  f.event('visibilitychange'); await flush(); assert.equal(f.attempts.length, 5);
  f.event('online'); await flush(); assert.equal(f.attempts.length, 5, 'event retries are still bounded');
  f.unmount(); assert.ok(f.views.every(v => v.destroyed === 1));
});

test('a long outage can recover on return even after the automatic retry budget is exhausted', async () => {
  const f = fixture({ kinds: ['fallback', 'fallback', 'fallback', 'engine'] }); await flush();
  f.fire(); await flush(); f.fire(); await flush(); assert.equal(f.timers.size, 0);
  f.event('online'); await flush(); assert.equal(f.state.kind, 'engine'); assert.equal(f.attempts.length, 4);
  f.unmount();
});

test('automatic retry and repeated user events share a single attempt', async () => {
  const f = fixture(); await flush(); f.fire();
  for (let i = 0; i < 5; i++) { f.event('online'); f.event('visibilitychange'); }
  await flush(); assert.equal(f.attempts.length, 2); assert.equal(f.state.kind, 'engine'); f.unmount();
});

test('hidden or offline pages do not spend retry attempts; becoming usable resumes recovery', async () => {
  for (const reason of ['hidden', 'offline']) {
    const f = fixture(); await flush();
    if (reason === 'hidden') f.document.visibilityState = 'hidden'; else f.navigator.onLine = false;
    f.fire(); await flush(); assert.equal(f.attempts.length, 1);
    f.document.visibilityState = 'visible'; f.navigator.onLine = true;
    f.event(reason === 'hidden' ? 'visibilitychange' : 'online'); await flush();
    assert.equal(f.state.kind, 'engine'); assert.equal(f.attempts.length, 2); f.unmount();
  }
});

test('explicit simplified rendering never retries and unmount cancels a pending automatic retry', async () => {
  const forced = fixture({ forced: true }); await flush();
  assert.equal(forced.timers.size, 0); forced.event('online'); await flush(); assert.equal(forced.attempts.length, 1); forced.unmount();
  const f = fixture(); await flush(); assert.equal(f.timers.size, 1);
  f.unmount(); assert.equal(f.timers.size, 0); f.event('online'); await flush();
  assert.equal(f.attempts.length, 1); assert.equal(f.views[0].destroyed, 1);
});

test('non-timeout failures do not flash automatic loading, but event recovery remains bounded', async () => {
  const f = fixture({ kinds: ['fallback'], reason: 'error' }); await flush();
  assert.equal(f.timers.size, 0);
  for (let i = 0; i < 4; i++) { f.event('online'); await flush(); }
  assert.equal(f.attempts.length, 3, 'initial mount and only two event retries');
  assert.equal(f.timers.size, 0); f.unmount();
});

test('event retry budget does not change when the automatic delay list changes', async () => {
  const f = fixture({ kinds: ['fallback'], delays: [2000] }); await flush();
  f.fire(); await flush(); assert.equal(f.attempts.length, 2); assert.equal(f.timers.size, 0);
  for (let i = 0; i < 4; i++) { f.event('online'); await flush(); }
  assert.equal(f.attempts.length, 4, 'one automatic retry plus two independent event retries');
  f.unmount();
});
