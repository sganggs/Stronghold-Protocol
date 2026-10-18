// 「协议已失效」 (ui/downedPlate.js, css/screens/game.css .downm): when it is due, the face drawings, the project's Modal,
// the wiring in screens/game.js and the stylesheet's rules. In a browser: test/ui/downed-plate.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const D = await import('../../public/js/ui/downedPlate.js');

const pub = (others) => ({ players: [{ playerId: 'me', alive: false }, ...others] });

test('downedDue: the own alive turning false with a teammate still in; not a reload, a spectator seat or the team\'s end', () => {
  const mate = [{ playerId: 'b', alive: true }];
  assert.equal(D.downedDue({ was: true, alive: false, spectator: false, pub: pub(mate), myId: 'me' }), true);
  assert.equal(D.downedDue({ was: undefined, alive: false, spectator: false, pub: pub(mate), myId: 'me' }), false, 'a reload that finds me out');
  assert.equal(D.downedDue({ was: false, alive: false, spectator: false, pub: pub(mate), myId: 'me' }), false, 'already out');
  assert.equal(D.downedDue({ was: true, alive: true, spectator: false, pub: pub(mate), myId: 'me' }), false);
  assert.equal(D.downedDue({ was: true, alive: false, spectator: true, pub: pub(mate), myId: 'me' }), false, 'a spectator seat');
  assert.equal(D.downedDue({ was: true, alive: false, spectator: false, pub: pub([{ playerId: 'b', alive: false }]), myId: 'me' }), false, 'nobody left: the match ends');
});

test('the faces: equal rows, the knocked-out one with X eyes; one path of whole pixels', () => {
  for (const k of ['calm', 'downed']) {
    const rows = D.PIX[k];
    assert.ok(rows.every((r) => r.length === rows[0].length), k);
  }
  assert.match(D.PIX.downed[4], /#\.#/, 'an X');
  assert.equal(D.pixPath(['.##.', '#..#']), 'M1 0h2v1h-2zM0 1h1v1h-1zM3 1h1v1h-1z');
});

test('the official map, the project\'s Modal, no drawn crest; not ready without the art', () => {
  const js = read('public/js/ui/downedPlate.js');
  assert.ok('settle/settlemen_personal_fail' in JSON.parse(read('data/assets.json')).ui);
  assert.match(js, /<\$\{Modal\} open=\$\{open\} onClose=\$\{onWatch\}/, 'focus trap and Esc');
  assert.match(js, /data-autofocus=\$\{true\} onClick=\$\{onWatch\}/, '继续观战 has the focus');
  assert.equal(D.downedArtReady(), false, 'in Node (no Image) it never turns ready');
});

test('screens/game.js: the dialog once the own alive turns false from real data; 离开模拟 opens the exit dialog', () => {
  const g = read('public/js/screens/game.js');
  assert.match(g, /if \(!spectator && !priv && !meP\) return;/);
  assert.match(g, /if \(downedArtReady\(\) && downedDue\(\{ was, alive, spectator, pub, myId \}\)\) setDowned\(true\);/);
  assert.match(g, /<\$\{DownedPlate\} open=\$\{downed\} onWatch=\$\{\(\) => setDowned\(false\)\} onLeave=\$\{\(\) => \{ setDowned\(false\); setExitOpen\(true\); \}\} \/>/);
});

test('the stylesheet: keyframes defined, text follows 文字大小, reduced motion stops it, the project\'s rules', () => {
  const css = read('public/css/screens/game.css');
  const block = css.slice(css.indexOf('/* 协议已失效'));
  for (const n of ['downm-shake', 'downm-in']) assert.match(block, new RegExp(`@keyframes ${n} \\{`), n);
  for (const m of block.matchAll(/font-size:\s*([^;]+);/g)) assert.match(m[1], /var\(--t\)/, m[1]);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{\n\s+\.downm__face\.is-out, \.downm__title \{ animation: none; \}/);
  assert.doesNotMatch(block, /!important|:has\(|--t\s*:/);
});
