// test/launch-scripts.test.js — scripts/launch.mjs --scripts (the plugin script mode for the server it starts,
// SP_PLUGIN_SCRIPTS — docs/PLUGINS.md §13) and scripts/start-windows-sandbox.bat, its double-click form on Windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, serverEnv, SCRIPT_MODES, TEST_MODE_FLAGS, warnTestMode } from '../scripts/launch.mjs';
import { TEST_MODE_PUBLIC_HINT, TEST_MODE_UNKNOWN_HINT } from '../server/testMode.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('--scripts sets SP_PLUGIN_SCRIPTS for the server; off removes an inherited one; no flag keeps it', () => {
  assert.deepEqual([...SCRIPT_MODES], ['off', 'sandbox', 'trusted', 'trusted-force']);
  for (const argv of [['--scripts', 'sandbox'], ['--scripts=sandbox']]) {
    const o = parseArgs(argv);
    assert.equal(o.scripts, 'sandbox');
    assert.deepEqual(o.setupArgs, [], 'not passed on to setup');
    assert.equal(serverEnv(o, {}).SP_PLUGIN_SCRIPTS, 'sandbox');
  }
  assert.equal(serverEnv(parseArgs(['--scripts', 'off']), { SP_PLUGIN_SCRIPTS: 'sandbox' }).SP_PLUGIN_SCRIPTS, undefined);
  assert.equal(serverEnv(parseArgs([]), { SP_PLUGIN_SCRIPTS: 'trusted' }).SP_PLUGIN_SCRIPTS, 'trusted');
  const env = serverEnv(parseArgs(['--port', '3001', '--scripts', 'trusted-force', '--no-assets']), {});
  assert.deepEqual([env.PORT, env.SP_PLUGIN_SCRIPTS], ['3001', 'trusted-force']);
});

test('--test-mode sets SP_TEST_MODE; off removes an inherited one; no flag keeps it', () => {
  assert.deepEqual([...TEST_MODE_FLAGS], ['off', '1', 'force']);
  for (const argv of [['--test-mode', '1'], ['--test-mode=force']]) {
    const o = parseArgs(argv);
    assert.equal(o.testMode, argv[0].includes('=') ? 'force' : '1');
    assert.equal(serverEnv(o, {}).SP_TEST_MODE, o.testMode);
  }
  assert.equal(serverEnv(parseArgs(['--test-mode', 'off']), { SP_TEST_MODE: '1' }).SP_TEST_MODE, undefined);
  assert.equal(serverEnv(parseArgs([]), { SP_TEST_MODE: 'force' }).SP_TEST_MODE, 'force');
  const src = readFileSync(path.join(ROOT, 'scripts/launch.mjs'), 'utf8');
  assert.match(src, /--test-mode \$\{o\.testMode\} 不会改变正在运行的服务器/);
});

test('start-windows-sandbox.bat is start-windows.bat --scripts sandbox (CRLF, other arguments passed on)', () => {
  const bat = readFileSync(path.join(ROOT, 'scripts/start-windows-sandbox.bat'), 'utf8');
  assert.match(bat, /^@echo off\r\n/);
  assert.ok(!/[^\r]\n/.test(bat), 'CRLF line endings (cmd.exe)');
  assert.match(bat, /call "%~dp0start-windows\.bat" --scripts sandbox %\*\r\n$/);
});

test('bare --test-mode enables local mode without swallowing another launcher option', () => {
  const o = parseArgs(['--test-mode', '--host', '127.0.0.1', '--no-open', '--no-setup']);
  assert.equal(o.testMode, '1'); assert.equal(o.host, '127.0.0.1');
  assert.equal(o.open, false); assert.equal(o.setup, false); assert.deepEqual(o.setupArgs, []);
  assert.equal(serverEnv(o, {}).SP_TEST_MODE, '1');
  assert.equal(parseArgs(['--test-mode=']).testMode, '');
  assert.equal(TEST_MODE_FLAGS.includes(parseArgs(['--test-mode', 'invalid']).testMode), false);
});

test('warnTestMode prints the Chinese public hint and an unrecognised word, and stays quiet otherwise', () => {
  const lines = [];
  const log = { warn: (s) => lines.push(s) };
  const pub = { en0: [{ address: '8.8.8.8', family: 'IPv4', internal: false }] };
  const priv = { en0: [{ address: '192.168.1.9', family: 'IPv4', internal: false }] };
  warnTestMode({ host: '::' }, { SP_TEST_MODE: '1' }, log, pub);
  assert.equal(lines[0], TEST_MODE_PUBLIC_HINT);
  lines.length = 0;
  warnTestMode({ host: '127.0.0.1' }, { SP_TEST_MODE: 'forced' }, log, priv);
  assert.equal(lines[0], TEST_MODE_UNKNOWN_HINT);
  lines.length = 0;
  warnTestMode({ host: '::' }, { SP_TEST_MODE: 'off' }, log, pub);
  warnTestMode({ host: '::' }, {}, log, pub);
  warnTestMode({ host: '127.0.0.1' }, { SP_TEST_MODE: '1' }, log, pub);
  warnTestMode({ host: '0.0.0.0' }, { SP_TEST_MODE: '1' }, log, priv);
  warnTestMode({ host: '0.0.0.0' }, { SP_TEST_MODE: '1' }, log, {});
  assert.deepEqual(lines, []);
});
