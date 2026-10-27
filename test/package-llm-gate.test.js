// A release package omits the external-AI / LLM integration (§35.66). A dev checkout still registers it.
// Run: node --test test/package-llm-gate.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findSpecifiers } from '../tools/check-imports.mjs';
import { isPlayerFile, plan, resolveSpecifier, trackedFiles } from '../tools/package.mjs';
import {
  LLM_RELEASE_EXCLUDE, LLM_RELEASE_MARKER, LLM_RELEASE_MARKER_TEXT, isLlmReleasePath, omitLlmFromRelease,
} from '../server/match/llmRelease.js';
import { llmIntegrationEnabled, llmIntegrationEnabledNow, LLM_IGNORED_LOG, releaseIgnoresExternalAi, EXTERNAL_BOT } from '../server/match/llmGate.js';
import { BOT_STRATEGIES, getBotStrategy } from '../server/match/botStrategies.js';
import { TestClient } from './helpers/wsClient.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Tracked paths, plus the gate modules when this checkout has not indexed them yet. */
function releasePaths() {
  const tracked = trackedFiles(ROOT);
  const have = new Set(tracked);
  const extra = ['server/match/llmGate.js', 'server/match/llmRelease.js'].filter((rel) => !have.has(rel) && fs.existsSync(path.join(ROOT, rel)));
  return extra.length ? [...tracked, ...extra] : tracked;
}

test('the release file list omits the LLM integration and still ships the built-in bot', () => {
  const p = plan(ROOT, { paths: releasePaths(), lite: true, allowDirty: true, scan: false, measure: false });
  assert.deepEqual(p.problems, []);
  const shipped = new Set(p.files);
  for (const rel of LLM_RELEASE_EXCLUDE) {
    if (rel.endsWith('/')) assert.ok(![...shipped].some((f) => f.startsWith(rel) || f === rel.slice(0, -1)), rel);
    else assert.ok(!shipped.has(rel), rel);
  }
  assert.ok(![...shipped].some((f) => f.startsWith('tools/ai/') || f.startsWith('server/ai/')));
  assert.ok(p.generated.includes(LLM_RELEASE_MARKER));
  assert.ok(shipped.has(LLM_RELEASE_MARKER));
  assert.equal(isPlayerFile(LLM_RELEASE_MARKER), false);
  for (const rel of ['server/match/bot.js', 'server/match/aiPlan.js', 'server/match/aiEconomy.js',
    'server/match/botStrategyContract.js', 'server/match/botStrategies.js', 'server/match/llmGate.js', 'server/match/llmRelease.js']) {
    assert.ok(shipped.has(rel), rel);
    assert.equal(isPlayerFile(rel), true, rel);
  }
  for (const rel of LLM_RELEASE_EXCLUDE) assert.equal(isPlayerFile(rel.endsWith('/') ? `${rel}x.js` : rel), false, rel);
  for (const dir of ['server/ai', 'tools/ai']) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      assert.equal(isLlmReleasePath(rel), true, rel);
      assert.ok(!shipped.has(rel), rel);
    }
  }
  for (const rel of p.files) {
    if (!/\.(?:m?js|cjs)$/.test(rel)) continue;
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const { spec, line } of findSpecifiers(src)) {
      const target = resolveSpecifier(rel, spec);
      assert.equal(target != null && isLlmReleasePath(target), false, `${rel}:${line} imports ${spec}`);
      assert.equal(isLlmReleasePath(spec), false, `${rel}:${line} imports ${spec}`);
    }
  }
});

test('the marker wins over a present host, and a dev checkout still registers external', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-llm-gate-'));
  try {
    assert.equal(llmIntegrationEnabled(root), false);
    fs.mkdirSync(path.join(root, 'server/match'), { recursive: true });
    fs.writeFileSync(path.join(root, 'server/match/externalAI.js'), '// absent host\n');
    assert.equal(llmIntegrationEnabled(root), true);
    fs.writeFileSync(path.join(root, LLM_RELEASE_MARKER), LLM_RELEASE_MARKER_TEXT);
    assert.equal(llmIntegrationEnabled(root), false);
    fs.rmSync(path.join(root, LLM_RELEASE_MARKER));
    fs.rmSync(path.join(root, 'server/match/externalAI.js'));
    assert.equal(llmIntegrationEnabled(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(llmIntegrationEnabledNow, true);
  assert.equal(releaseIgnoresExternalAi({ SP_BOT_STRATEGY: 'external', SP_EXTERNAL_AI_TRANSPORT: 'http', SP_LLM_URL: 'http://127.0.0.1:9' }), false);
  assert.equal(BOT_STRATEGIES.external?.id, 'external');
  assert.equal(getBotStrategy('external').id, 'external');
  assert.equal(getBotStrategy('external').decide, EXTERNAL_BOT.decide);
  assert.deepEqual(Object.keys(BOT_STRATEGIES), ['legacy', 'external', 'ioleta', 'adaptive', 'ioleta-adaptive']);
});

test('a packaged server boots and plays a bot match while ignoring external-AI settings', { timeout: 120_000 }, async () => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-llm-release-'));
  // tools/assets is a real server import (studio, plugin packer). Link only that directory:
  // a link of tools/ itself would let omitLlmFromRelease delete the checkout's tools/ai.
  const links = ['shared', 'data', 'public', 'packs', 'plugins', 'node_modules', 'schemas', 'tools/assets'];
  const saved = {
    SP_BOT_STRATEGY: process.env.SP_BOT_STRATEGY,
    SP_BOT_STRATEGY_SEATS: process.env.SP_BOT_STRATEGY_SEATS,
    SP_EXTERNAL_AI_TRANSPORT: process.env.SP_EXTERNAL_AI_TRANSPORT,
    SP_EXTERNAL_AI_URL: process.env.SP_EXTERNAL_AI_URL,
    SP_EXTERNAL_AI_MANUAL_WAIT: process.env.SP_EXTERNAL_AI_MANUAL_WAIT,
    SP_LLM_URL: process.env.SP_LLM_URL,
  };
  let client;
  let srv;
  try {
    fs.cpSync(path.join(ROOT, 'server'), path.join(stage, 'server'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(stage, 'package.json'));
    fs.mkdirSync(path.join(stage, 'tools'), { recursive: true });
    for (const name of links) {
      const from = path.join(ROOT, name);
      if (fs.existsSync(from)) fs.symlinkSync(from, path.join(stage, name));
    }
    omitLlmFromRelease(stage);
    for (const rel of LLM_RELEASE_EXCLUDE) {
      if (!rel.startsWith('server/')) continue;
      assert.equal(fs.existsSync(path.join(stage, rel)), false, rel);
    }
    assert.equal(fs.readFileSync(path.join(stage, LLM_RELEASE_MARKER), 'utf8'), LLM_RELEASE_MARKER_TEXT);
    process.env.SP_BOT_STRATEGY = 'external';
    process.env.SP_BOT_STRATEGY_SEATS = '1:external';
    process.env.SP_EXTERNAL_AI_TRANSPORT = 'http';
    process.env.SP_EXTERNAL_AI_URL = 'http://127.0.0.1:9';
    process.env.SP_LLM_URL = 'http://127.0.0.1:9';
    process.env.SP_EXTERNAL_AI_MANUAL_WAIT = '1';
    const lines = [];
    const log = {
      info(s) { lines.push(String(s)); },
      warn() {},
      error(s) { lines.push(`error ${s}`); },
      debug() {},
    };
    const serverMod = await import(pathToFileURL(path.join(stage, 'server/index.js')).href);
    const { Match } = await import(pathToFileURL(path.join(stage, 'server/match/Match.js')).href);
    let match;
    class OpeningMatch extends Match {
      constructor(opts) { super({ ...opts, timerScale: 0.01, botRehearsal: 0, botSliceMs: 0.001 }); match = this; }
    }
    srv = await serverMod.startServer({
      port: 0, host: '127.0.0.1', assetIndex: false, studio: false, log, MatchClass: OpeningMatch, seedFn: () => 69,
    });
    const ignored = lines.filter((line) => line.includes('[llm]'));
    assert.deepEqual(ignored, [LLM_IGNORED_LOG]);
    // a per-seat external choice alone is an external-AI setting too (#816 P1)
    const gate = await import(pathToFileURL(path.join(stage, 'server/match/llmGate.js')).href);
    assert.equal(gate.releaseIgnoresExternalAi({ SP_BOT_STRATEGY_SEATS: '0:legacy, 1 : external' }), true);
    assert.equal(gate.releaseIgnoresExternalAi({ SP_BOT_STRATEGY_SEATS: '1:ioleta' }), false);
    assert.equal(gate.releaseIgnoresExternalAi({ SP_EXTERNAL_AI_MANUAL_WAIT: '1' }), true);
    const res = await fetch(`${srv.url}/healthz`);
    assert.equal(res.status, 200);
    client = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    const welcome = await client.hello('BotTest');
    const request = async (msg) => assert.equal((await client.request(msg)).t, 'ok', msg.t);
    await request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    await request({ t: 'room.addBot' });
    await request({ t: 'room.start' });
    await client.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    assert.equal(match.bot.id, 'legacy');
    assert.equal(match.seatBots[1].id, 'legacy');
    assert.equal(match.externalAI, null);
    await request({ t: 'g.infoReady' });
    const draft = await client.waitFor('m.public', (p) => p.phase === 'BAND_DRAFT' && p.draft.turn === welcome.playerId, 10000);
    const taken = new Set(Object.values(draft.draft.picks));
    await request({ t: 'g.band', bandId: match.gd.bandIds().find((id) => !taken.has(id)) });
    await client.waitFor('m.public', (p) => p.phase === 'PREP' && p.round === 1 && p.players.some((ps) => ps.isBot && ps.ready), 10000);
    const ai = match.order.find((ps) => ps.isBot);
    assert.ok(ai.bandId && ai.ready && ai.board.size > 0, 'the built-in bot drafted, bought and deployed');
    assert.equal(match.errorCount, 0);
    assert.equal(lines.filter((line) => line.includes('[llm]')).length, 1);
  } finally {
    await client?.terminate();
    await srv?.close();
    for (const key of Object.keys(saved)) {
      if (saved[key] == null) delete process.env[key];
      else process.env[key] = saved[key];
    }
    for (const name of links) {
      const link = path.join(stage, name);
      try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link); } catch { /* already gone */ }
    }
    fs.rmSync(stage, { recursive: true, force: true });
  }
});
