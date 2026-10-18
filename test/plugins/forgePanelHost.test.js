// Execute only our host, with fake time and transport. No pack source, socket or browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import * as ui from '../../shared/plugins/ui.js';

function host() {
  let source = fs.readFileSync(new URL('../../public/js/ui/pluginFrame.js', import.meta.url), 'utf8');
  const edits = [];
  for (const node of parse(source, { ecmaVersion: 2022, sourceType: 'module' }).body) {
    if (node.type === 'ImportDeclaration') edits.push([node.start, node.end]);
    if (node.type === 'ExportNamedDeclaration') edits.push([node.start, node.declaration.start]);
  }
  for (const [start, end] of edits.sort((a, b) => b[0] - a[0])) source = source.slice(0, start) + source.slice(end);
  source = source.replace(/\nboot\(\);\s*$/, '');
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const timeout = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; };
  const state = { connection: { status: 'online', ping: 10 }, match: { public: {}, private: {}, result: null }, room: null };
  class Clock extends Date { static now() { return now; } }
  const realm = vm.createContext({ ...ui, Date: Clock, store: { get: () => state }, window: { setTimeout: timeout }, setTimeout: timeout, PROTOCOL_VERSION: 1, getLang: () => 'en' });
  vm.runInContext(`${source}\nglobalThis.host={frames,handle,postNetNow,scheduleNet,scheduleResult,welcomeInfo,moveFrame};`, realm);
  const api = realm.host;
  const frame = (id) => {
    const sent = [];
    const rec = { id, declared: ['hud.right'], ready: false, loads: 1, closed: false, entries: {}, iframe: { contentWindow: { postMessage: (m) => sent.push({ at: now, ...structuredClone(m) }) } }, sent };
    api.frames.set(id, rec);
    return rec;
  };
  const advance = (time) => {
    now = time;
    // Run the due tasks in time order; callbacks can schedule a later task.
    for (let i = 0; i < 100; i += 1) {
      const due = [...timers].filter(([, v]) => v.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) return;
      timers.delete(due[0]);
      due[1].fn();
    }
    assert.fail('timer did not settle');
  };
  return { api, frame, advance, state };
}

test('net initialization and ready happen once per entry document and later changes obey 1 Hz', () => {
  const { api, frame, advance, state } = host();
  const rec = frame('first');
  api.postNetNow(rec);
  advance(10);
  for (let i = 0; i < 6; i += 1) api.handle(rec, { t: 'ready' });
  assert.deepEqual(rec.sent.filter((m) => m.t === 'net').map((m) => m.at), [0]);
  assert.equal(rec.sent.filter((m) => m.t === 'state').length, 1);
  assert.equal(rec.sent.filter((m) => m.t === 'result').length, 1);
  state.connection.ping = 20;
  api.scheduleNet();
  advance(999);
  assert.equal(rec.sent.filter((m) => m.t === 'net').length, 1);
  advance(1000);
  assert.deepEqual(rec.sent.filter((m) => m.t === 'net').map((m) => m.rtt), [10, 20]);
  api.moveFrame(rec, { appendChild() {} });
  rec.loads = 1;
  api.postNetNow(rec);
  api.handle(rec, { t: 'ready' });
  assert.equal(rec.sent.filter((m) => m.t === 'state').length, 2);
  assert.equal(rec.sent.filter((m) => m.t === 'net').length, 3);
});

test('initializing a sibling cannot consume another frame pending net or result update', () => {
  const { api, frame, advance, state } = host();
  const first = frame('first');
  api.postNetNow(first);
  api.handle(first, { t: 'ready' });
  advance(100);
  state.connection.ping = 91;
  state.match.result = { victory: true };
  api.scheduleNet();
  const second = frame('second');
  api.postNetNow(second);
  api.handle(second, { t: 'ready' });
  api.scheduleResult();
  assert.equal(first.sent.filter((m) => m.t === 'result').at(-1).result?.victory, true);
  advance(1000);
  assert.deepEqual(first.sent.filter((m) => m.t === 'net').map((m) => m.rtt), [10, 91]);
  assert.deepEqual(second.sent.filter((m) => m.t === 'net').map((m) => m.rtt), [91]);
  state.connection.ping = 103;
  api.scheduleNet();
  api.frames.clear();
  const count = first.sent.length;
  advance(2000);
  assert.equal(first.sent.length, count);
});

test('the host welcome supplies only the real room content identity', () => {
  const { api, frame, state } = host();
  state.room = { seats: [], content: { cs: '12345678'.repeat(8), plugins: [] }, code: 'SECRET' };
  const info = api.welcomeInfo(frame('first'));
  assert.equal(info.cs, state.room.content.cs);
  assert.equal(JSON.stringify(info).includes('SECRET'), false);
});
