import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const entries = { chess_char_1_01_a: { skill: 0, module: 'none' } };
const notOwned = ['chess_char_4_22_a'];
const diy = { chess_char_5_diy1_a: { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' } };

async function setup(t) {
  const stateDir = mkdtempSync(join(tmpdir(), 'stronghold-state-'));
  let server;
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await server?.close();
    rmSync(stateDir, { recursive: true, force: true });
  });
  const restart = async () => {
    await server?.close();
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, stateDir, heavyBurst: 30, seedFn: () => 4242 });
  };
  await restart();
  return {
    stateDir, restart,
    async connect(token) {
      const c = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
      clients.push(c);
      c.welcome = await c.hello('Doctor', token);
      return c;
    },
    url: () => server.url,
  };
}

async function ok(client, message) {
  const reply = await client.request(message);
  assert.equal(reply.t, 'ok', JSON.stringify(reply));
}

test('user Given saved preferences When the server restarts Then only the same credential restores them', async (t) => {
  const h = await setup(t);
  const a = await h.connect();
  assert.equal(a.welcome.preferences.entries, null);
  assert.deepEqual(readdirSync(join(h.stateDir, 'profiles')), [], 'connections alone do not create disk records');
  await ok(a, { t: 'room.loadout', entries });
  await ok(a, { t: 'room.ownership', notOwned });
  await ok(a, { t: 'room.diy', picks: diy });
  await h.restart();
  const b = await h.connect(a.welcome.token);
  assert.equal(b.welcome.playerId, a.welcome.playerId);
  assert.equal(b.welcome.resumed, false, 'the old live match is not restored');
  assert.deepEqual(b.welcome.preferences, { entries, notOwned, diy });
  const stranger = await h.connect('0'.repeat(32));
  assert.notEqual(stranger.welcome.playerId, b.welcome.playerId);
  assert.equal(stranger.welcome.preferences.entries, null);
  for (const file of readdirSync(join(h.stateDir, 'profiles'))) {
    assert.ok(!readFileSync(join(h.stateDir, 'profiles', file), 'utf8').includes(a.welcome.token));
  }
  assert.equal((await fetch(h.url() + '/state/profiles/anything.json')).status, 404);
  await ok(b, { t: 'room.loadout', entries: {} });
  await h.restart();
  assert.deepEqual((await h.connect(a.welcome.token)).welcome.preferences.entries, {});
});

test('user Given an unwritable profile When an edit fails Then the server rejects it and retains the last saved settings', async (t) => {
  const h = await setup(t);
  const a = await h.connect();
  await ok(a, { t: 'room.loadout', entries });
  const file = readdirSync(join(h.stateDir, 'profiles'))[0];
  const blocked = join(h.stateDir, 'profiles', file + '.tmp');
  mkdirSync(blocked);
  const reply = await a.request({ t: 'room.loadout', entries: {} });
  assert.equal(reply.code, 'INTERNAL');
  assert.deepEqual(JSON.parse(readFileSync(join(h.stateDir, 'profiles', file), 'utf8')).loadout, entries);
  rmSync(blocked, { recursive: true });
  await h.restart();
  assert.deepEqual((await h.connect(a.welcome.token)).welcome.preferences.entries, entries);
});

test('user Given a real match When buying selling and leaving Then the disk retains its result and successful trades', async (t) => {
  const h = await setup(t);
  const a = await h.connect();
  await ok(a, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
  await ok(a, { t: 'room.start' });
  await ok(a, { t: 'g.infoReady' });
  await a.waitFor('m.public', (m) => m.phase === 'BAND_DRAFT', 10000);
  await ok(a, { t: 'g.band', bandId: 'band_cannot' });
  await a.waitFor('m.public', (m) => m.phase === 'PREP', 10000);
  const view = await a.waitFor('m.private', (m) => m.shop?.slots?.some((s) => s?.kind === 'chess'), 10000);
  const slot = view.shop.slots.findIndex((s) => s?.kind === 'chess' && s.price <= view.funds);
  assert.ok(slot >= 0);
  const id = view.shop.slots[slot].id;
  await ok(a, { t: 'g.buy', slot });
  const bought = await a.waitFor('m.private', (m) => m.hand?.some((p) => p?.id === id), 5000);
  const piece = bought.hand.find((p) => p?.id === id);
  await ok(a, { t: 'g.sell', uid: piece.uid });
  assert.equal((await a.request({ t: 'g.sell', uid: piece.uid })).t, 'error');
  const archive = readdirSync(join(h.stateDir, 'matches')).find((f) => f.endsWith('.json'));
  const blocked = join(h.stateDir, 'matches', archive + '.tmp');
  mkdirSync(blocked);
  await ok(a, { t: 'g.leave' });
  assert.equal(JSON.parse(readFileSync(join(h.stateDir, 'matches', archive), 'utf8')).status, 'started');
  rmSync(blocked, { recursive: true });
  // Graceful shutdown retries the retained result after the volume becomes writable again.
  await h.restart();
  const files = readdirSync(join(h.stateDir, 'matches'));
  const record = JSON.parse(readFileSync(join(h.stateDir, 'matches', files.find((f) => f.endsWith('.json'))), 'utf8'));
  assert.equal(record.status, 'finished');
  assert.equal(record.result.reason, 'abandoned');
  assert.equal(record.result.players[0].bandId, 'band_cannot');
  assert.equal(record.result.players[0].playerId, a.welcome.playerId);
  assert.equal(record.result.actionsComplete, true);
  const actions = readFileSync(join(h.stateDir, 'matches', `${record.id}.actions.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(actions.map(({ type, id: chessId }) => [type, chessId]), [['buy', id], ['sell', id]]);
  assert.equal(actions[0].price, view.shop.slots[slot].price);
  assert.equal(actions[1].uid, piece.uid);
  assert.ok(actions.every((a) => a.round === 1));
});

test('user Given an old or damaged profile When reconnecting Then obsolete choices are removed and malformed data is refused', async (t) => {
  const h = await setup(t);
  const a = await h.connect();
  await ok(a, { t: 'room.loadout', entries });
  const file = join(h.stateDir, 'profiles', readdirSync(join(h.stateDir, 'profiles'))[0]);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  saved.loadout.chess_char_9_99_a = { skill: 0 };
  writeFileSync(file, JSON.stringify(saved));
  await h.restart();
  const b = await h.connect(a.welcome.token);
  assert.deepEqual(b.welcome.preferences.entries, entries);
  saved.diy = ['invalid'];
  writeFileSync(file, JSON.stringify(saved));
  await h.restart();
  await assert.rejects(h.connect(a.welcome.token), /saved preferences unavailable/);
  assert.equal(readFileSync(file, 'utf8'), JSON.stringify(saved), 'a failed restore never overwrites the source');
});

test('user Given server settings When browser preferences are stale Then the page restores the server choices', {
  skip: process.env.SP_E2E !== '1' || !existsSync(process.env.CHROME_PATH || ''),
}, async (t) => {
  const h = await setup(t);
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('sp.name', 'Persistence test');
    sessionStorage.setItem('sp.entered', '1');
  });
  await page.goto(h.url());
  await page.waitForSelector('[data-testid="loadout-open"]');
  await page.click('[data-testid="loadout-open"]');
  await page.waitForSelector('.lo-detail .lo-skill[data-skill="0"]');
  await page.click('.lo-detail .lo-skill[data-skill="0"]');
  await page.click('.lo-detail .lo-mod[data-module="none"]');
  await page.waitForFunction(() => /已同步/.test(document.querySelector('.lo-sync')?.textContent || ''));
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.loadout')).entries), entries);
  await page.evaluate(() => localStorage.setItem('sp.pref.loadout', JSON.stringify({ v: 1, entries: {} })));
  await page.reload();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sp.pref.loadout'))?.entries?.chess_char_1_01_a?.module === 'none');
  await page.click('[data-testid="loadout-open"]');
  await page.waitForSelector('.lo-skill.is-on[data-skill="0"]');
  assert.ok(await page.$('.lo-mod.is-on[data-module="none"]'));
});
