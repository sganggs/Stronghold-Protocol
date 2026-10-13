// The 补位 golden corpus covers what it claims (test/golden/README.md, tools/golden.mjs — 0.2.0): reads the stored
// digests only (test/golden.test.js recomputes them). The `standins` family fields every NORMAL chess record (normal and
// elite) as its stand-in — the battle unit's def is the chess id, its loadout the backup selection — so all 17 stand-ins
// run; every active skill a chess names for its stand-in is cast in some battle (the ON_DEPLOY passives of 预备干员-特种
// and Misery count no cast: their units deploy); no battle reports a content error. The 补位 match fields stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const CHESS = read('../data/chess.json');
const BACKUPS = read('../data/backups.json');
const STANDINS = read('./golden/standins.json');
const MATCHES = read('./golden/matches.json');
const COL = Object.fromEntries(STANDINS.columns.units.map((k, i) => [k, i]));

const normal = Object.values(CHESS).filter((c) => c.chessType === 'NORMAL' && c.backup && c.backup.charId !== c.charId);

test('standins: every NORMAL chess record (normal + elite) is fielded once, with its backup skill, without content errors', () => {
  assert.equal(normal.length, 110);
  const seen = new Map();
  for (const [id, sc] of Object.entries(STANDINS.scenarios)) {
    assert.equal(sc.errors.count, 0, `${id}: ${sc.errors.kinds.join('; ')}`);
    for (const u of sc.units) if (u[COL.kind] === 'op') seen.set(u[COL.def], u);
  }
  assert.deepEqual([...seen.keys()].sort(), normal.map((c) => c.chessId).sort());
  for (const c of normal) {
    const u = seen.get(c.chessId);
    assert.equal(u[COL.skill], c.backup.skillIndex, `${c.chessId}: the backup skill`);
    assert.ok(u[COL.deploys] >= 1, `${c.chessId}: deployed`);
  }
  assert.equal(new Set(normal.map((c) => c.backup.charId)).size, 17, 'all 17 stand-ins');
});

test('standins: every active skill a chess names for its stand-in is cast; passive ones deploy', () => {
  const cast = new Map();
  for (const sc of Object.values(STANDINS.scenarios)) {
    for (const u of sc.units) {
      if (u[COL.kind] !== 'op') continue;
      const c = CHESS[u[COL.def]];
      const k = `${c.backup.charId}|${u[COL.skill]}`;
      cast.set(k, (cast.get(k) || 0) + (u[COL.casts] || 0));
    }
  }
  for (const c of normal) {
    const k = `${c.backup.charId}|${c.backup.skillIndex}`;
    const form = Object.values(BACKUPS.units[c.backup.charId].forms)[0];
    const sk = form.skills.find((s) => s.index === c.backup.skillIndex);
    if (sk.skillType === 'PASSIVE' || sk.spType === 'ON_DEPLOY') continue;
    assert.ok(cast.get(k) > 0, `${c.backup.charId} S${c.backup.skillIndex + 1} (${sk.name}) never cast`);
  }
});

test('user: Given no owned NORMAL operators, When AI plays a full match, Then it fields stand-ins without engine errors', () => {
  const dg = MATCHES.scenarios['coop2-NORMAL-1-unowned-roster'];
  assert.ok(dg, 'scenario present');
  assert.deepEqual(dg.errors, { engine: 0, logged: 0, sim: 0, dispatcher: 0 });
  const fielded = dg.standIns.rounds.filter(([, s]) => s).flatMap(([, s]) => s.split(' '));
  assert.ok(new Set(fielded).size >= 2, `stand-ins fielded: ${[...new Set(fielded)].join(', ')}`);
  for (const f of fielded) {
    const [id, charId] = f.split('→');
    const c = CHESS[`chess_char_${id}`];
    assert.ok(dg.standIns.notOwned.includes(c.baseId || c.chessId), `${f}: not owned`);
    assert.equal(charId, c.backup.charId);
  }
});
