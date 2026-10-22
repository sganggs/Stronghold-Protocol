import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { BondTimers, selectedBondTimers } from '../../public/js/ui/bondTimers.js';
import { buildDiagnostics } from '../../public/js/diag.js';
import { BOND_TIMERS } from '../../shared/bondTimers.js';

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = v => v == null || typeof v === 'boolean' ? '' : Array.isArray(v) ? v.map(text).join('')
  : typeof v === 'object' ? text(v.props?.children) : String(v);
const timers = [{ id: 'sargon', count: 2, remaining: 3.2 }, { id: 'siracusaAspd', count: 1, remaining: 20 },
  { id: 'siracusaStealth', count: 1, remaining: 20 }, { id: 'siracusaAfter', count: 1, remaining: 8 }];

test('bondTimers defaults off; only boolean true opts in, independently of ammo migration; diagnostics name it', () => {
  assert.equal(DEFAULT_SETTINGS.bondTimers, false);
  for (const v of [undefined, null, false, 'true', 1, {}, []]) assert.equal(sanitizeSettings({ bondTimers: v }).bondTimers, false);
  assert.equal(sanitizeSettings({ ammoCount: true, mysticEnergy: true }).bondTimers, false);
  const saved = sanitizeSettings({ bondTimers: true });
  assert.equal(sanitizeSettings(JSON.parse(JSON.stringify(saved))).bondTimers, true);
  assert.equal(sanitizeSettings({ ...saved, bondTimers: false }).bondTimers, false);
  const state = { me: {}, room: null, match: { public: null, battle: null }, connection: { status: 'online' } };
  assert.match(buildDiagnostics({ state, env: {}, settings: saved }), /bond timers/);
});

test('selected readout is scoped to the watched field and living unit, cleared by missing metadata and death', () => {
  const snap = { fieldId: 'n:p2', t: 7, units: [[1, 0, 0, 100]], bondTimers: [[1, timers]] };
  assert.deepEqual(selectedBondTimers(snap, 'n:p2', 1), timers, 'spectators read the watched unit without owner filtering');
  for (const [s, f, id] of [[snap, 'n:p1', 1], [snap, 'n:p2', 2], [snap, 'n:p2', null],
    [{ ...snap, units: [[1, 0, 0, 0]] }, 'n:p2', 1], [{ ...snap, bondTimers: undefined }, 'n:p2', 1], [null, 'n:p2', 1]]) {
    assert.deepEqual(selectedBondTimers(s, f, id), []);
  }
  assert.deepEqual(selectedBondTimers(JSON.parse(JSON.stringify(snap)), 'n:p2', 1), timers, 'first reconnect snapshot needs no prior events');
});

test('card labels Sargon next stack expiry and each Siracusa effect separately; empty/unknown rows render nothing', () => {
  const s = text(BondTimers({ rows: timers }));
  assert.match(s, /2 层 · 下一层 3.2 秒/);
  for (const d of BOND_TIMERS) assert.ok(s.includes(d.label));
  assert.equal(BondTimers({}), null);
  assert.equal(BondTimers({ rows: [{ id: 'unknown', count: 1, remaining: 5 }, { id: 'sargon', count: 0, remaining: Infinity }] }), null);
});

test('settings toggle, explanatory hint and all effect labels are translated in every shipped pack', () => {
  const src = read('public/js/ui/settings.js');
  assert.match(src, /value=\$\{s\.bondTimers\} onChange=\$\{\(v\) => updateSettings\(\{ bondTimers: v \}\)\}/);
  assert.ok(src.indexOf('value=${s.bondTimers}') > src.indexOf('value=${s.ammoEnergyCount}'));
  assert.ok(src.indexOf('value=${s.bondTimers}') < src.indexOf('value=${s.combatMetrics}'));
  const ids = [...BOND_TIMERS.map(d => d.label), '盟约效果剩余时间', '{n} 层 · 下一层 {s} 秒', '剩余 {s} 秒',
    '在选中单位的详情中显示叙拉古、萨尔贡效果的剩余时间；萨尔贡显示层数与下一层到期时间。官方界面没有这些数字。'];
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    for (const id of ids) assert.ok(pack[id]?.length, `${lang}: ${id}`);
  }
});
