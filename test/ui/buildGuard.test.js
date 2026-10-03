// test/ui/buildGuard.test.js — public/js/ui/buildGuard.js: the "this page runs an outdated build" guard that lets a
// deploy reach a tab that was already open (a page keeps its imported ES modules for its whole lifetime — the reason a
// client-only battle fix stayed invisible on the reporting player's page).
//
// Review-driven contract: a check that cannot read a build NEVER reloads, a new build is acted on only after two checks
// in a row agree, and a match on screen is never thrown away — the guard waits for it (and its settlement) to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBuildOnce, startBuildGuard, fetchBuild, BUILD_CHECK_MS, BUILD_FETCH_TIMEOUT_MS } from '../../public/js/ui/buildGuard.js';

/** A fake fetch answering /healthz with `build` (null → the frame carries none). */
const fetchOf = (build) => async (url, init) => {
  assert.equal(url, '/healthz');
  assert.equal(init.cache, 'no-store');
  return { ok: true, status: 200, json: async () => ({ ok: true, build }) };
};

test('fetchBuild: the tag, or null when unreachable / not reported / too slow', async () => {
  assert.equal(await fetchBuild(fetchOf('aaa')), 'aaa');
  assert.equal(await fetchBuild(async () => { throw new Error('offline'); }), null);
  assert.equal(await fetchBuild(async () => ({ ok: false, status: 503, json: async () => ({}) })), null);
  assert.equal(await fetchBuild(fetchOf(null)), null);
  // a request that never answers must not keep the guard waiting forever
  const t0 = Date.now();
  assert.equal(await fetchBuild(() => new Promise(() => {}), { timeoutMs: 20 }), null);
  assert.ok(Date.now() - t0 < BUILD_FETCH_TIMEOUT_MS, 'gives up on its own timeout');
});

test('checkBuildOnce: first sighting, unchanged, changed, and unknown when the server says nothing', async () => {
  assert.deepEqual(await checkBuildOnce({ fetchFn: fetchOf('aaa') }), { status: 'first', build: 'aaa' });
  assert.deepEqual(await checkBuildOnce({ fetchFn: fetchOf('aaa'), known: 'aaa' }), { status: 'current', build: 'aaa' });
  assert.deepEqual(await checkBuildOnce({ fetchFn: fetchOf('bbb'), known: 'aaa' }), { status: 'new', build: 'bbb' });
  assert.deepEqual(await checkBuildOnce({ fetchFn: async () => { throw new Error('offline'); }, known: 'aaa' }), { status: 'unknown', build: null });
});

/** A guard driven by hand: run the interval callback on demand. */
function manual({ inMatch = false } = {}) {
  const ticks = [];
  const calls = { reload: 0, stale: [] };
  let build = 'aaa';
  let reachable = true;
  let busy = inMatch;
  const guard = startBuildGuard({
    fetchFn: async () => {
      if (!reachable) throw new Error('offline');
      return { ok: true, status: 200, json: async () => ({ build }) };
    },
    reload: () => { calls.reload++; },
    inMatch: () => busy,
    setInterval: (fn) => { ticks.push(fn); return ticks.length; },
    clearInterval: () => {},
    onStale: (info) => calls.stale.push(info),
  });
  return {
    calls, ticks, guard,
    setBuild: (b) => { build = b; },
    setReachable: (b) => { reachable = b; },
    setInMatch: (b) => { busy = b; },
    /** run the interval callback and let its await settle */
    tick: async () => { for (const fn of ticks) fn(); await new Promise((r) => setTimeout(r, 0)); },
  };
}

test('startBuildGuard: records this page\'s build in memory, reloads once on a NEW build (after two agreeing checks)', async () => {
  const m = manual();
  await new Promise((r) => setTimeout(r, 0));                  // the immediate first check
  assert.equal(m.guard.known(), 'aaa');
  assert.equal(m.calls.reload, 0);
  await m.tick();
  assert.equal(m.calls.reload, 0, 'same build → no reload');
  m.setBuild('bbb');
  await m.tick();
  assert.equal(m.calls.reload, 0, 'one sighting is not enough: a half-copied deploy must not ping-pong the page');
  assert.equal(m.guard.stale(), false);
  await m.tick();
  assert.equal(m.calls.reload, 1, 'the same new build twice → the page reloads');
  assert.deepEqual(m.calls.stale, [{ build: 'bbb', known: 'aaa', waiting: false }]);
  await m.tick();
  assert.equal(m.calls.reload, 1, 'the guard stopped after reloading');
  assert.equal(m.guard.stale(), true);
});

test('startBuildGuard: a NEW build that is then not served twice is dropped (rolling deploy / reverts)', async () => {
  const m = manual();
  await new Promise((r) => setTimeout(r, 0));
  m.setBuild('bbb');
  await m.tick();
  m.setBuild('aaa');                                           // the fleet rolled back to this page's build
  await m.tick();
  m.setBuild('bbb');
  await m.tick();
  assert.equal(m.calls.reload, 0, 'never saw the same new build twice in a row');
});

test('startBuildGuard: an unreadable /healthz never reloads — not even after a new build was seen', async () => {
  const m = manual();
  await new Promise((r) => setTimeout(r, 0));
  m.setBuild('bbb');
  await m.tick();                                              // one sighting of the new build
  m.setReachable(false);                                       // …and now the server is restarting
  await m.tick();
  await m.tick();
  assert.equal(m.calls.reload, 0, 'a failed check is unknown, never a reason to reload');
  assert.equal(m.guard.stale(), false);
  m.setReachable(true);
  await m.tick();
  assert.equal(m.calls.reload, 0, 'the sightings must be consecutive: the failures in between reset the count');
  await m.tick();
  assert.equal(m.calls.reload, 1, 'two checks in a row agree → reload');
});

test('startBuildGuard: a match on screen is never thrown away — it waits for the match (and its settlement) to end', async () => {
  const m = manual({ inMatch: true });
  await new Promise((r) => setTimeout(r, 0));
  m.setBuild('bbb');
  await m.tick();
  await m.tick();
  assert.equal(m.calls.reload, 0, 'in a match: the reload waits');
  assert.equal(m.guard.stale(), true, 'the staleness is remembered');
  assert.deepEqual(m.calls.stale, [{ build: 'bbb', known: 'aaa', waiting: true }], 'the UI is told to offer a reload');
  await m.tick();
  assert.equal(m.calls.reload, 0);
  m.setInMatch(false);                                         // back in the lobby / room: the match is over
  await m.tick();
  assert.equal(m.calls.reload, 1, 'once nothing is at stake the page reloads');
});

test('startBuildGuard: stop() ends the watch', async () => {
  const m = manual();
  await new Promise((r) => setTimeout(r, 0));
  m.guard.stop();
  m.setBuild('bbb');
  await m.tick();
  await m.tick();
  assert.equal(m.calls.reload, 0);
  assert.equal(m.guard.stale(), false);
  assert.equal(BUILD_CHECK_MS, 60_000);
});
