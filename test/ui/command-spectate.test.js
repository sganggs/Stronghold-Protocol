// 规程 spectating: the column uses the spec's command and commandBondOverrides, not the opening strategy paragraph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
const { data } = await import('../../public/js/data.js');
const version = 'data/versions/act3autochess-v3_1';
const values = Object.fromEntries(['bands', 'effects', 'bonds'].map((name) => [name, readJson(`${version}/${name}.json`)]));
data.setContent({ id: 'command-spectate-test', values });
const { spectateEffects } = await import('../../public/js/battle/observe.js');
const { EffectsList } = await import('../../public/js/ui/effectsList.js');
const { effectDesc } = await import('../../public/js/ui/effectsList.js');
const { commandDisplayText } = await import('../../shared/commandDisplay.js');
const { bondEffectRecord } = await import('../../public/js/ui/bondEffect.js');
const { formatBondEffect } = await import('../../public/js/ui/richText.js');

test('act3 spectating resolves the current skill, the opening replacement, and a retained passive', () => {
  const bands = values.bands, effects = values.effects, bonds = values.bonds;
  const commandBand = bands.band_yan2;
  const command = commandBand.skills.find((s) => s.effectId === 'aceffect_band_83');
  const replace = command.buffs.find((b) => b.key === 'auto_chess_effect_replace');
  const overrides = { ...replace.bb, ...replace.bbStr };
  const spec = { players: [{
    playerId: 'p1', bandId: 'band_random', commandEffectId: command.effectId,
    bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 5 } },
    bondEffectOverrides: overrides, playerEffects: [{ id: bands.band_random.effectId, source: 'band' }],
  }] };
  const out = spectateEffects(spec, ['p1']);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((e) => e.descRef?.kind), ['bandSkill', 'bondEffect', 'effect']);
  assert.equal(out[0].id, command.effectId);
  assert.equal(effectDesc(out[0]), commandDisplayText(command.descRaw || command.desc));
  assert.notEqual(effectDesc(out[0]), bands.band_random.desc);
  assert.equal(out[1].descRef.effectId, overrides.bondeffect_yan_2);
  assert.equal(out[1].descRef.layers, 5);
  assert.equal(effectDesc(out[1]), formatBondEffect(bondEffectRecord(bonds.yanShip, effects[overrides.bondeffect_yan_2], 5), 5));
  assert.equal(out[2].id, bands.band_random.effectId);
  assert.ok(!out.some((e) => e.desc === bands.band_random.desc));
});

test('an opening replacement stays on the spectated column after the command itself has no replace table', () => {
  const bands = values.bands;
  const opening = bands.band_kazimier.buffs.find((b) => b.key === 'auto_chess_effect_replace');
  const overrides = { ...opening.bb, ...opening.bbStr };
  const command = bands.band_fund.skills.find((s) => s.type === 'ACTIVE' && !(s.buffs || []).some((b) => b.key === 'auto_chess_effect_replace'));
  assert.ok(command);
  const spec = { players: [{
    playerId: 'p1', bandId: 'band_kazimier', commandEffectId: command.effectId,
    bondEffectOverrides: overrides,
    playerEffects: [{ id: bands.band_kazimier.effectId, source: 'band' }],
  }] };
  const out = spectateEffects(spec, ['p1']);
  assert.equal(out[0].id, command.effectId);
  assert.equal(out.find((e) => e.descRef?.kind === 'bondEffect')?.id, 'bondeffect_kazimierz');
  assert.ok(!out.some((e) => e.id === bands.band_kazimier.effectId && e.command !== false));
  assert.equal(spectateEffects(spec, ['p1', 'p2']), undefined);
});

test('the command control hangs only on the live command row inside the ten-row cap', () => {
  const command = { type: function BandCommand() {}, props: { command: { effectId: 'live' } } };
  const effects = [
    { id: 'live', viewKey: 'command:live', name: '当前', desc: 'now', iconKind: 'band', command: true },
    { id: 'mapped', viewKey: 'bond:kaz', name: '替换', desc: 'swap', iconKind: 'band', command: false },
    { id: 'kept', viewKey: 'retained:band', name: '保留', desc: 'keep', iconKind: 'band', command: false },
    ...Array.from({ length: 9 }, (_, i) => ({ id: `choice-${i}`, name: `机变${i}`, desc: 'x', iconKind: 'choice' })),
  ];
  const tree = EffectsList({ effects, command });
  const rows = [];
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.props?.class === 'string' && v.props.class.split(/\s+/).includes('effects__row')) rows.push(v);
    walk(v.props?.children);
  };
  walk(tree);
  assert.equal(rows.length, 10);
  const hasControl = (row, node) => [].concat(row.props.children).includes(node);
  assert.equal(hasControl(rows[0], command), true);
  assert.equal(rows.slice(1).some((row) => hasControl(row, command)), false);
  const marker = { type: function BandCommand() {}, props: {} };
  const legacyRows = [];
  const walkLegacy = (v) => {
    if (Array.isArray(v)) { v.forEach(walkLegacy); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.props?.class === 'string' && v.props.class.split(/\s+/).includes('effects__row')) legacyRows.push(v);
    walkLegacy(v.props?.children);
  };
  walkLegacy(EffectsList({ effects: [{ id: 'band-old', name: '策略', desc: 'full', iconKind: 'band' }], command: marker }));
  assert.equal(legacyRows.length, 1);
  assert.equal(hasControl(legacyRows[0], marker), true);
});
