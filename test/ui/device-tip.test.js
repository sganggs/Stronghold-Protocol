// GitHub #228 (idea of PR #229 by @rickylxw — the terrain tip of #184, for the stage DEVICES): a tap on a stage device
// (阻隔工事 / “双眼皮” / 射击台 / 源石流发生装置) explains it. `screens/game.js` tileClick hands over `{ kind: 'device',
// device }`, resolved from the stage the board on screen is built from — `gameLogic.deviceInfo` (the prep) or
// `deviceTipAt` (a battle: the crate / turret is a device unit there) — and the panel opens its device card.
// Covered: what the card says for the devices of the real stages (the sim's own numbers — sim/content/devices.js) in every
// shipped language, what the screen's override pipeline does to it (a 机变 card removes the crate → no tip), the battle
// path against a REAL battle (the turret outside the rect stands on another tile than its stage pos; the stage crates and
// turrets are not in the field meta of a battle shown from its start; a destroyed crate is gone), the panel link
// (resolveDetail) and that the card closes on the next field press. The tap reaching the screen is test/ui/device-tip.e2e.test.js.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setLang, setMessages, registerLangs } from '../../shared/i18n.js';
import { makeBattle } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { resolveDetail } = await import('../../public/js/ui/detailPanel.js');
const { deviceInfo, deviceTipAt, noteDeviceUnits, deviceUnitsForEntry, effectiveStage, closesOnFieldPress } = await import('../../public/js/ui/gameLogic.js');

const stages = JSON.parse(readFileSync(path.join(ROOT, 'data', 'stages.json'), 'utf8'));
const pack = (code) => { const p = JSON.parse(readFileSync(path.join(ROOT, 'public', 'i18n', `${code}.json`), 'utf8')); delete p._meta; return p; };

afterEach(() => { setLang('zh'); for (const l of ['en', 'ja', 'ko', 'zh-TW']) setMessages(l, {}); });

/** The first device of `role` in the stage. */
function deviceOf(stage, role) {
  const d = (stage.devices || []).find((x) => x.role === role);
  if (!d) throw new Error(`no ${role} device in ${stage.id}`);
  return d;
}
const TURRET_ON = { 'trap_1104_aclasert#1': true };

test('阻隔工事: the crate says its own HP and the enemy behaviour the sim runs', () => {
  const st = stages['act1autochess_m01'];
  const d = deviceOf(st, 'crate');
  const info = deviceInfo(st, d.pos[0], d.pos[1]);
  assert.equal(info.key, 'crate');
  assert.equal(info.name, '阻隔工事', 'the device\'s own data name (the data overlay localizes it)');
  assert.equal(info.tag, '场地装置');
  assert.deepEqual([info.row, info.col], d.pos);
  assert.match(info.lines[0], /绕开它走/);
  assert.match(info.lines[0], /无路可走/);
  assert.equal(info.lines[1], '生命 100 点，被摧毁后从场上消失');
  assert.deepEqual(info.facts, ['不可部署']);
  assert.equal(info.stats, undefined, 'the crate needs no stat grid beyond its HP line');
});

test('“双眼皮”: the turret reads its stats and the bond-layer scaling from the device entry', () => {
  const st = stages['act1autochess_m01'];
  // every stage's turrets stand dormant (active: false) until 机械援助 or a 机变 card turns the alias on — the screen
  // passes the player's own effectiveStage, so the tip lights up exactly when the client draws the turret
  const d = deviceOf(st, 'turret');
  assert.equal(deviceInfo(st, d.pos[0], d.pos[1]), null, 'dormant: no tip');
  const info = deviceInfo(effectiveStage(st, { deviceOverrides: TURRET_ON }), d.pos[0], d.pos[1]);
  assert.equal(info.name, '“双眼皮”');
  assert.match(info.lines[0], /法术伤害/);
  assert.match(info.lines[0], /脆弱/);
  assert.equal(info.lines[1], '按当前层数最高的盟约计算：每 1 层，攻击速度 +1（至多 +300），附加的脆弱 +0.1%（至多 +30%）');
  assert.equal(info.lines[2], '脆弱持续 2 秒');
  // the same numbers the sim runs (devices.js spawnTurret reads these blackboard keys)
  const bb = d.skill.bb;
  assert.deepEqual([bb.attack_speed_per_stack, bb.max_attack_speed, bb.damage_scale_per_stack, bb.max_damage_scale], [1, 300, 0.001, 1.3]);
  assert.deepEqual(info.stats, [
    { k: '生命上限', v: 3000 }, { k: '攻击', v: 900 }, { k: '防御', v: 200 }, { k: '攻击间隔', v: '4s' },
  ]);
  assert.deepEqual(info.facts, ['不可部署']);
});

test('射击台: the platform tells the deploy class it feeds the deploy map', () => {
  const st = stages['act1autochess_m03'];
  const d = deviceOf(st, 'platform');
  const info = deviceInfo(st, d.pos[0], d.pos[1]);
  assert.equal(info.name, '射击台');
  assert.match(info.lines[0], /高台位/);
  assert.match(info.lines[1], /远程位干员可以部署/);
  assert.match(info.lines[1], /不阻挡敌人/);
  assert.deepEqual(info.facts, ['仅远程位可部署']);
});

test('源石流发生装置: the blower names its direction, its reach and the airflow numbers the sim applies', () => {
  const st = stages['act2autochess_m01'];
  const d = deviceOf(st, 'blower');
  assert.equal(d.dir, 'DOWN');
  const info = deviceInfo(st, d.pos[0], d.pos[1]);
  assert.equal(info.name, '源石流发生装置');
  assert.equal(info.lines[0], '向前方 3 格吹出气流（这一台朝下）');
  assert.equal(info.lines[1], '部署在气流里的干员：朝向与风向相同的攻击力 +30%、相反的 −30%');
  assert.equal(info.lines[2], '在气流里移动的敌人：顺风移动速度 ×1.5、逆风 ×0.5');
  // …which are the blackboard values devices.js buildTerrain / tickAirflowAlly / tickAirflowEnemy read
  const bb = d.skill.bb;
  assert.deepEqual([bb['blower_s_character[equal].atk'], bb['blower_s_character[opposite].atk'], bb['blower_s_enemy[equal].move_speed'], bb['blower_s_enemy[opposite].move_speed']], [0.3, -0.3, 0.5, -0.5]);
  // a blower without its own blackboard falls back to the stage's special.blower.bb (the sim's order)
  const bare = { ...st, devices: [{ ...d, skill: null }], special: { blower: { bb: { 'blower_s_character[equal].atk': 0.1, 'blower_s_enemy[opposite].move_speed': -0.25 } } } };
  const fb = deviceInfo(bare, d.pos[0], d.pos[1]);
  assert.equal(fb.lines[1], '部署在气流里的干员：朝向与风向相同的攻击力 +10%');
  assert.equal(fb.lines[2], '在气流里移动的敌人：逆风 ×0.75');
});

test('a device the client does not draw says nothing: inactive, card-removed, tip-less role, ordinary tile', () => {
  // act1 m02's platforms stand dormant (weight-0 cards add them) — not drawn, so no tip
  const m02 = stages['act1autochess_m02'];
  const p = deviceOf(m02, 'platform');
  assert.equal(deviceInfo(m02, p.pos[0], p.pos[1]), null);
  // the screen passes the player's own effectiveStage: a 机变 card's deviceOverride flips the crate's active off
  const fake = { rows: [], tiles: {}, devices: [{ key: 'trap_1105_accrate', alias: 'trap_1105_accrate#001', role: 'crate', pos: [3, 3], active: true, stats: { maxHp: 100 } }] };
  assert.ok(deviceInfo(fake, 3, 3), 'the crate stands');
  const removed = effectiveStage(fake, { deviceOverrides: { 'trap_1105_accrate#001': false } });
  assert.equal(deviceInfo(removed, 3, 3), null);
  // a tip-less role (盟约寒风 is invisible; the controllers have no tile) falls through like an ordinary tile
  const m01 = stages['act1autochess_m01'];
  const cw = deviceOf(m01, 'coldWind');
  assert.equal(deviceInfo(m01, cw.pos[0], cw.pos[1]), null);
  assert.equal(deviceInfo(m01, 5, 5), null);
  assert.equal(deviceInfo(null, 0, 0), null);
  assert.equal(deviceInfo({ devices: 'x' }, 0, 0), null);
  assert.equal(deviceInfo(m01, 1.5, 2), null);
  assert.equal(deviceInfo({ devices: [{ role: '__proto__', pos: [1, 1], active: true }, { role: 'constructor', pos: [1, 1], active: true }] }, 1, 1), null);
});

test('every drawn tip-able device of every active stage carries a well-formed card, in every language', () => {
  for (const code of ['en', 'ja', 'ko', 'zh-TW']) setMessages(code, pack(code));
  registerLangs([{ code: 'en' }, { code: 'ja', fallback: ['en'] }, { code: 'ko', fallback: ['en'] }, { code: 'zh-TW' }]);
  let n = 0;
  for (const lang of ['zh', 'en', 'ja', 'ko', 'zh-TW']) {
    setLang(lang);
    for (const st of Object.values(stages)) {
      if (!st.active) continue;
      for (const d of st.devices || []) {
        if (!['crate', 'turret', 'platform', 'blower'].includes(d.role)) continue;
        if (!(typeof d.active === 'boolean' ? d.active : !d.hidden)) continue;
        const info = deviceInfo(st, d.pos[0], d.pos[1]);
        assert.ok(info, `${st.id} ${d.role} @${d.pos} has a tip`);
        assert.ok(info.name && info.tag, `${st.id} ${d.role} has a name and a tag`);
        assert.ok(info.lines.length && info.facts.length, `${st.id} ${d.role} has mechanism lines and a tile fact`);
        for (const line of [...info.lines, ...info.facts, info.tag]) {
          assert.ok(typeof line === 'string' && line.length && !/[{}]/.test(line), `${lang} ${st.id} ${d.role}: "${line}"`);
          // nothing is left in the source language where the pack has the words (the Chinese sources are Han text)
          if (lang === 'en' || lang === 'ko') assert.ok(!/[一-鿿]/.test(line), `${lang}: "${line}" is untranslated`);
        }
        n++;
      }
    }
  }
  assert.ok(n >= 5 * 4, `checked ${n} cards`);
});

test('the words of a card follow the language: English, 日本語, 한국어, 繁體中文', () => {
  for (const code of ['en', 'ja', 'ko', 'zh-TW']) setMessages(code, pack(code));
  registerLangs([{ code: 'en' }, { code: 'ja', fallback: ['en'] }, { code: 'ko', fallback: ['en'] }, { code: 'zh-TW' }]);
  const st = stages['act2autochess_m01'];
  const d = deviceOf(st, 'blower');
  setLang('en');
  const en = deviceInfo(st, d.pos[0], d.pos[1]);
  assert.equal(en.tag, 'Stage Device');
  assert.equal(en.lines[0], 'Blows an airflow 3 tiles ahead (this one faces Down)');
  assert.equal(en.lines[1], 'Operators deployed in the airflow: ATK +30% when facing the same way as the airflow, −30% when facing the opposite way');
  assert.equal(en.facts[0], 'Not deployable');
  setLang('ja');
  assert.equal(deviceInfo(st, d.pos[0], d.pos[1]).lines[1], '気流内に配置されたオペレーター：気流と同じ向きの攻撃力+30%、逆向きは−30%');
  setLang('ko');
  assert.equal(deviceInfo(st, d.pos[0], d.pos[1]).lines[0], '전방 3칸으로 기류를 내뿜음(이 장치는 아래 방향)');
  setLang('zh-TW');
  assert.equal(deviceInfo(st, d.pos[0], d.pos[1]).lines[2], '在氣流裡移動的敵人：順風移動速度 ×1.5、逆風 ×0.5');
  const tur = effectiveStage(stages['act1autochess_m01'], { deviceOverrides: TURRET_ON });
  const t0 = deviceOf(tur, 'turret');
  setLang('en');
  const eTur = deviceInfo(tur, t0.pos[0], t0.pos[1]);
  assert.deepEqual(eTur.stats.map((s) => s.k), ['Max HP', 'ATK', 'DEF', 'Attack Interval']);
  assert.equal(eTur.lines[2], 'The Fragile lasts 2 seconds');
});

// ---- a battle on screen ---------------------------------------------------------------------------------------------

/** What the game screen holds in a battle: the device UnitInfos (meta + 'spawn' events) and the latest snapshot by unit id. */
function screenView(h) {
  const units = noteDeviceUnits(new Map(), { units: h.battle.fieldMeta().units, events: h.eventsOf('spawn') });
  const snap = new Map(h.snapshot().units.map((t) => [t[0], t]));
  return { units: [...units.values()], snap };
}
const turretPlayers = () => [{
  playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [], bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 10 } },
  playerEffects: [{ id: 'aceffect_band_43', key: 'auto_chess_change_map', params: TURRET_ON }],
}];

test('a battle: the crates and the turret are found by their UNIT — the field meta of a battle shown from its start holds none of them', () => {
  const stageId = 'act1autochess_m01';
  const h = makeBattle({ stageId, players: turretPlayers(), autoFinish: false, timeLimit: 30 });
  assert.deepEqual(noteDeviceUnits(new Map(), { units: h.battle.fieldMeta().units }).size, 0, 'nothing stands before the first step');
  h.step(1);
  const v = screenView(h);
  assert.equal(v.units.length, 4, '3 crates + the turret');
  const stage = stages[stageId];
  const crate = v.units.find((u) => u.defId === 'trap_1105_accrate');
  const tip = deviceTipAt(stage, Math.round(crate.y), Math.round(crate.x), v);
  assert.equal(tip.key, 'crate');
  assert.equal(tip.unitId, crate.id, 'the unit rides along: the screen reads its live HP through it');
  assert.equal(tip.lines[1], '生命 100 点，被摧毁后从场上消失');
  // the turret stands on its stage pos here (inside the rect); the stage entry is dormant in the plain stage a watcher holds
  // (a teammate's 机变 / band overrides are not known) — the unit proves it stands, so it is explained
  const turret = v.units.find((u) => u.defId === 'trap_1104_aclasert');
  const tt = deviceTipAt(stage, Math.round(turret.y), Math.round(turret.x), v);
  assert.equal(tt.key, 'turret');
  assert.equal(tt.name, '“双眼皮”');
  assert.equal(tt.stats[0].v, 3000);
  // an ordinary tile, and a tile outside every unit: nothing
  assert.equal(deviceTipAt(stage, 12, 8, v), null);
  // before the first snapshot of the battle has arrived, a unit counts as standing
  assert.ok(deviceTipAt(stage, Math.round(crate.y), Math.round(crate.x), { units: v.units, snap: new Map() }));
  assert.ok(deviceTipAt(stage, Math.round(crate.y), Math.round(crate.x), { units: v.units }));
});

test('a battle: a turret outside the rect answers on the tile its UNIT stands on, not on its stage pos', () => {
  const stageId = 'act2autochess_m01';
  const h = makeBattle({ stageId, players: turretPlayers(), autoFinish: false, timeLimit: 30 });
  h.step(1);
  const v = screenView(h);
  const stage = stages[stageId];
  const turret = v.units.find((u) => u.defId === 'trap_1104_aclasert');
  assert.ok(turret, 'the turret is online');
  const [r, c] = [Math.round(turret.y), Math.round(turret.x)];
  const pos = deviceOf(effectiveStage(stage, { deviceOverrides: TURRET_ON }), 'turret').pos;
  assert.notDeepEqual([r, c], pos, 'act2 m01\'s turret stands on row 8, outside the normal field: the sim moves it');
  assert.equal(deviceTipAt(stage, r, c, v).key, 'turret');
  assert.equal(deviceTipAt(stage, r, c, v).unitId, turret.id);
  // its stage pos holds nothing any more (the static device is not drawn inside the rect): no phantom card there
  assert.equal(deviceTipAt(effectiveStage(stage, { deviceOverrides: TURRET_ON }), pos[0], pos[1], v), null);
  // the blowers are no units: they answer by their stage pos, as in the prep
  const bl = deviceOf(stage, 'blower');
  assert.equal(deviceTipAt(stage, bl.pos[0], bl.pos[1], v).key, 'blower');
});

test('a battle: a destroyed crate is gone — HP gone, then its tuple leaves the snapshots — and the tap falls through to the tile', () => {
  const h = makeBattle({ stageId: 'act1autochess_m01', autoFinish: false, timeLimit: 30 });
  h.step(1);
  const stage = stages['act1autochess_m01'];
  const crate = h.battle.allyUnits.find((u) => u.defId === 'trap_1105_accrate');
  const [r, c] = [crate.tileR, crate.tileC];
  assert.ok(deviceTipAt(stage, r, c, screenView(h)), 'standing');
  h.battle.kill(crate, null);
  h.step(1);
  assert.equal(crate.alive, false);
  const dying = screenView(h);
  assert.equal(dying.snap.get(crate.id)[3], 0, 'still in the snapshots for the die animation, with no HP');
  assert.equal(deviceTipAt(stage, r, c, dying), null);
  h.run(3);
  const gone = screenView(h);
  assert.equal(gone.snap.has(crate.id), false, 'its tuple left the snapshots');
  assert.ok(gone.snap.size > 0);
  assert.equal(deviceTipAt(stage, r, c, gone), null, 'long destroyed: the unit is still in the meta, the card is not');
  // the other crates stand
  const other = h.battle.allyUnits.find((u) => u.defId === 'trap_1105_accrate' && u.alive);
  assert.ok(deviceTipAt(stage, other.tileR, other.tileC, gone));
});

test('the prep and a scouted prep board: the stage\'s own device entries answer by pos (deviceInfo)', () => {
  const st = stages['act1autochess_m01'];
  const d = deviceOf(st, 'crate');
  assert.ok(deviceInfo(st, d.pos[0], d.pos[1]));
  // noteDeviceUnits keeps only device units, from the meta and from 'spawn' events
  const m = noteDeviceUnits(new Map(), {
    units: [{ id: 1, kind: 'op' }, { id: 2, kind: 'device', defId: 'trap_1105_accrate' }, null],
    events: [['spawn', { id: 3, kind: 'device', defId: 'trap_1104_aclasert' }], ['spawn', { id: 4, kind: 'enemy' }], ['die', 2], null, 'x'],
  });
  assert.deepEqual([...m.keys()], [2, 3]);
  assert.equal(noteDeviceUnits(new Map(), {}).size, 0);
  assert.equal(noteDeviceUnits(new Map(), { units: 'x', events: 5 }).size, 0);
  // a same-field refresh whose meta has no device keeps spawn-noted crates; a meta that names devices replaces them;
  // another field does not
  const kept = deviceUnitsForEntry(m, new Map(), true);
  assert.equal(kept, m);
  const fresh = new Map([[9, { id: 9, kind: 'device' }]]);
  assert.equal(deviceUnitsForEntry(m, fresh, true), fresh);
  assert.notEqual(deviceUnitsForEntry(m, new Map(), false), m);
  assert.equal(deviceUnitsForEntry(null, new Map(), true).size, 0);
  assert.equal(deviceUnitsForEntry(m, null, true).size, 0);
});

test('a device target resolves into the panel card; a malformed one resolves to nothing; the card closes on a field press', () => {
  const st = stages['act1autochess_m01'];
  const d = deviceOf(st, 'crate');
  const info = deviceInfo(st, d.pos[0], d.pos[1]);
  assert.deepEqual(resolveDetail({ kind: 'device', device: info }, new Map()), { type: 'device', device: info });
  const unit = { ...info, unitId: 17 };
  assert.deepEqual(resolveDetail({ kind: 'device', device: unit }, new Map()), { type: 'device', device: unit, unitId: 17 },
    'a battle device carries its unit id: the screen reads the live HP through it');
  assert.equal(resolveDetail({ kind: 'device' }, new Map()), null);
  assert.equal(resolveDetail({ kind: 'device', device: '阻隔工事' }, new Map()), null);
  assert.equal(resolveDetail(null, new Map()), null);
  assert.equal(closesOnFieldPress({ kind: 'device', device: info }), true, 'the next field press closes the device card');
  assert.equal(closesOnFieldPress({ kind: 'terrain' }), true);
  assert.equal(closesOnFieldPress({ kind: 'enemy' }), false);
});

test('MAP10 cannon has the same source description and stats in preparation and live battle, then disappears on destruction', () => {
  const stage = JSON.parse(
    readFileSync(path.join(ROOT, 'data/versions/act3autochess-v3_1/stages.json')),
  ).act3autochess_m10;
  const d = stage.devices.find(d => d.role === 'cannon' && d.pos[0] === 13 && d.pos[1] === 6);
  const prep = deviceInfo(stage, ...d.pos);
  assert.equal(prep.name, '盐坨子炮');
  assert.match(prep.lines[0], /炮弹/);
  assert.deepEqual(
    prep.stats.map(s => s.v),
    [60000, 900, 3000, 0],
  );
  const h = makeBattle({ stage, autoFinish: false });
  h.step();
  const c = h.b.enemies.find(e => e.defId === d.key);
  assert.equal(c.s.maxHp, 60000);
  assert.equal(c.s.atk, 900);
  const units = h.b.fieldMeta().units,
    snap = new Map(h.snapshot().units.map(u => [u[0], u]));
  const live = deviceTipAt(stage, ...d.pos, { units, snap });
  assert.equal(live.unitId, c.id);
  assert.deepEqual(live.stats, prep.stats);
  assert.deepEqual(live.lines, prep.lines);
  h.b.kill(c, null);
  h.step();
  assert.equal(
    deviceTipAt(stage, ...d.pos, {
      units: h.b.fieldMeta().units,
      snap: new Map(h.snapshot().units.map(u => [u[0], u])),
    }),
    null,
  );
});

test('cannon description uses each shipped language pack', () => {
  const stage = JSON.parse(
    readFileSync(path.join(ROOT, 'data/versions/act3autochess-v3_1/stages.json')),
  ).act3autochess_m10;
  const d = deviceOf(stage, 'cannon');
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    setMessages(lang, pack(lang));
    setLang(lang);
    const line = deviceInfo(stage, ...d.pos).lines[0];
    assert.ok(line.includes('3'), lang);
    assert.ok(!line.includes('{weight}'), lang);
    assert.notEqual(line, d.skill.desc, lang);
    if (lang === 'en') assert.match(line, /Physical splash damage/);
  }
});
