// test/enemy-skill-clips.test.js — the skill slots of enemies whose clip names mislead the resolver play the clip of
// their official ability (tools/assets/spine.mjs PREFAB_SPINE_ROLES → data/assets.json `anims.skills`; DESIGN §35.19,
// §35.48).
//
// The client plays `anims.skills[slot]` for a sim ['cast', id, slot] event, the slot being the skill's index in
// data/enemies.json `skills[]`. The resolver pairs numbered clips with slots by name (Skill_n = slot n−1); the official
// prefabs name the clip per ability instead (EnemySkill ability `_animKey`). Until 0.3.2 假想敌：胄's 死亡集群 played the
// 2.533 s Skill_2 for the 3.833 s Skill_3, 盐风主教昆图斯's 大潮 and 崩坍 swapped clips (the third-form tide on the 3 s
// Skill_01 of 崩坍), and 阿利斯泰尔's storeA / Suicide played the wrong ones. 0.3.2 (§35.48) adds 泥岩 (its two slots
// swapped), “自在” (CrossAttack Skill_01_02; the second form's ShieldBurstReborn had no clip), 斩胄之剑 / 破胄之锤
// (Launch_Begin / Back_End), 锏 (A_Skill2 / B_Skill2) and the attack-class `strike` slots of 杰斯顿·威廉姆斯 and “碎铳之簧”.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { applyRoleFix, PREFAB_SPINE_ROLES } from '../tools/assets/spine.mjs';

const read = (rel) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
const E = read('data/enemies.json');
const V3 = read('data/versions/act3autochess-v3_1/enemies.json');
const enemyOf = (id) => E[id] || V3[id];
const A = read('data/assets.json');
const FX_INDEX = new URL('../public/assets/local/fx/index.json', import.meta.url);
// every enemy model with a `skills` fix (operators are keyed by charId)
const LEADERS = Object.keys(PREFAB_SPINE_ROLES).filter((id) => id.startsWith('enemy_') && PREFAB_SPINE_ROLES[id].skills);
// data slots whose official ability names no clip (empty _animKey or no animated ability), with the clip kept for them:
// “自在” 破桎而出 (both forms) on its Skill_02 set [ASSUMED], 锏 速杀 on the form's attack role (no clip of its own)
const NO_KEY = {
  enemy_1517_xi: { 1: 'Skill_02_Loop', 2: 'Skill_02_Loop' }, enemy_1525_blkswb: { 1: 'A_Attack', 3: 'B_Attack' },
  // 后兽 DyjswwSwitch names Translate, which is not a clip of the skeleton. The body keeps the resolved idle. [ASSUMED]
  enemy_2123_dyjsww: { 0: 'Idle_A' },
};
// data slots whose official clip differs from the one the client would play, left as they are because the sim never casts
// them (no `cast` event: nothing plays a skill clip for them) — the kit draws their moment otherwise (a form's change clip,
// FORMS in render/units.js) or not at all
const NEVER_CAST = {
  enemy_1288_duskls: ['BornAnim'], enemy_1288_duskls_2: ['BornAnim'], enemy_1292_duskld: ['BornAnim'],
  enemy_2085_skzjxd: ['Show'], enemy_2085_skzjxd_2: ['Show'],
  enemy_10042_prtrop: ['BuildBridge'], enemy_10042_prtrop_2: ['BuildBridge'],
  enemy_10081_mpplai: ['ChangeToB', 'ChangeToC', 'ChangeToD'],
  enemy_10116_ymgtop: ['EndAnim'],
  enemy_10127_rkmbst_2: ['M1Start'],
};
const officialKey = (u, s) => {
  const ab = ((u.skills || {})[String(s.prefabKey).toLowerCase()] || (u.skills || {})[s.prefabKey] || {}).abilities || [];
  return (ab.find((a) => a && a.animKey) || {}).animKey;
};

test('applyRoleFix checks every clip of a `skills` map: a missing one leaves the resolved slots', () => {
  const roles = { skills: { 0: { begin: null, loop: 'Skill_1', end: null, index: 0, idle: null } } };
  const fix = { skills: { 0: { begin: null, loop: 'Skill_1', end: null, index: 0, idle: null }, 1: { begin: null, loop: 'Skill_9', end: null, index: 1, idle: null } } };
  assert.deepEqual(applyRoleFix(roles, fix, { Skill_1: 1 }), { roles, missing: ['skills'] });
  assert.deepEqual(applyRoleFix(roles, fix, { Skill_1: 1, Skill_9: 2 }).roles.skills, fix.skills);
});

test('PREFAB_SPINE_ROLES skill slots: every clip in the model, carried into data/assets.json', () => {
  assert.deepEqual(LEADERS.sort(), ['enemy_1511_mdrock', 'enemy_1516_jakill', 'enemy_1517_xi', 'enemy_1521_dslily', 'enemy_1525_blkswb',
    'enemy_2123_dyjsww', 'enemy_9013_acstmk', 'enemy_9014_acstma', 'enemy_9015_acstmb', 'enemy_9019_actrpb', 'enemy_9020_actrpc', 'enemy_9032_aclionk']);
  for (const id of LEADERS) {
    const fix = PREFAB_SPINE_ROLES[id].skills;
    const sp = A.enemies[id].spine;
    const rec = enemyOf(id);
    const alt = enemyOf(`${id}_2`);
    for (const [slot, c] of Object.entries(fix)) {
      assert.ok(rec && slot < Math.max(rec.skills.length, alt?.skills?.length ?? 0), `${id} slot ${slot}: a data slot (of either record)`);
      for (const k of ['begin', 'loop', 'end']) if (c[k]) assert.ok(Object.hasOwn(sp.animations, c[k]), `${id} slot ${slot}: ${c[k]} in the model`);
      assert.deepEqual(sp.anims.skills[slot], c, `${id} slot ${slot}: data/assets.json (node tools/fetch-assets.mjs --offline)`);
    }
    // the primary `skill` role, when the fix gives one, is slot 0's
    if (PREFAB_SPINE_ROLES[id].skill) assert.deepEqual(sp.anims.skill, fix[0], `${id}: skill = slot 0`);
  }
  // 假想敌：胄's second record shares the model, and so its slots
  assert.deepEqual(A.enemies.enemy_9013_acstmk_2.spine.anims.skills, A.enemies.enemy_9013_acstmk.spine.anims.skills);
});

test('the slots the sim casts are fixed: 泥岩 swapped, 自在 Skill_01_02 + a clip for its second-form burst, the hands, 锏', () => {
  const sk = (id) => Object.fromEntries(Object.entries(A.enemies[id].spine.anims.skills).map(([k, c]) => [k, c.begin ? [c.begin, c.loop, c.end] : c.loop]));
  assert.deepEqual(sk('enemy_1511_mdrock'), { 0: 'Skill_2', 1: 'Skill_1' });
  const burst = ['Skill_02_Begin', 'Skill_02_Loop', 'Skill_02_End'];
  assert.deepEqual(sk('enemy_1517_xi'), { 0: 'Skill_01_02', 1: burst, 2: burst });
  for (const id of ['enemy_9014_acstma', 'enemy_9015_acstmb']) assert.deepEqual(sk(id), { 0: 'Launch_Begin', 1: 'Back_End' });
  assert.deepEqual(sk('enemy_1525_blkswb'), { 0: 'A_Skill2', 1: 'A_Attack', 2: 'B_Skill2', 3: 'B_Attack' });
  // 后兽: Blink Skill_B, Punishment Skill_A, GlobalDoom Skill_2_A (slot 0 keeps Idle_A; Translate is not in the model)
  assert.deepEqual(sk('enemy_2123_dyjsww'), { 0: 'Idle_A', 1: 'Skill_B', 2: 'Skill_B', 3: 'Skill_A', 4: 'Skill_2_A' });
  assert.equal(A.enemies.enemy_2123_dyjsww.spine.anims.skills[0].via, 'attack');
  // 速杀 keeps no clip of its own (via 'attack': a skill window plays nothing new), as before
  assert.equal(A.enemies.enemy_1525_blkswb.spine.anims.skills[1].via, 'attack');
  assert.equal(A.enemies.enemy_1525_blkswb.spine.anims.skills[3].via, 'attack');
  // the strike slots: an attack-class skill (the sim casts it inside one of the attacks); nothing else is a strike
  const strikes = [];
  for (const [id, a] of Object.entries(A.enemies)) for (const [slot, c] of Object.entries(a.spine?.anims?.skills || {})) if (c.strike) strikes.push(`${id}:${slot}:${c.loop}`);
  assert.deepEqual(strikes.sort(), ['enemy_1516_jakill:0:C1_Skill', 'enemy_1516_jakill:1:C2_Skill', 'enemy_9019_actrpb:0:Skill_b', 'enemy_9020_actrpc:0:Skill_c']);
});

test('the strike slots are the ones the sim casts from an attack\'s before hook', () => {
  const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  // 杰斯顿 (kitWarden): the (sp+1)th attack's slot; “碎铳之簧” (kitSpring): the shielded (spCost+1)-th attack's
  assert.match(src('server/sim/content/enemies/leaders.js'), /before\(c, b, e\) \{ const s = P\.killer \? pierce : iron;[^\n]*castSlot\(b, e, s\)/);
  assert.match(src('server/sim/content/bosses.js'), /before\(c, b, e2, a\) \{ if \(P\.up && [^\n]*castSlot\(b, e2, sk\)/);
});

test('PREFAB_SPINE_ROLES skill slots = the official ability animKey of each slot (local fx index, when extracted)', { skip: !existsSync(FX_INDEX) && 'no public/assets/local/fx/index.json' }, () => {
  const units = JSON.parse(readFileSync(FX_INDEX, 'utf8')).units || {};
  for (const id of [...LEADERS, 'enemy_9013_acstmk_2']) {
    const u = units[id];
    assert.ok(u && u.skills, `${id} in the index`);
    const fix = PREFAB_SPINE_ROLES[id.replace(/_2$/, '')].skills;
    const rec = enemyOf(id);
    assert.ok(rec && Array.isArray(rec.skills), `${id} in enemy data`);
    const anims = A.enemies[id]?.spine?.animations || {};
    rec.skills.forEach((s, slot) => {
      const key = officialKey(u, s);
      const keyInModel = !!(key && Object.hasOwn(anims, key));
      if (key && keyInModel) assert.equal(fix[slot].loop, key, `${id} slot ${slot} (${s.prefabKey})`);
      else if (fix[slot]) assert.equal(fix[slot].loop, NO_KEY[id]?.[slot], `${id} slot ${slot} (${s.prefabKey}): ${key ? `clip ${key} not in the model` : 'no official clip'}, the listed one kept`);
    });
  }
});

test('no other enemy slot the sim casts plays another clip than its official ability\'s (local fx index, when extracted)', { skip: !existsSync(FX_INDEX) && 'no public/assets/local/fx/index.json' }, () => {
  const units = JSON.parse(readFileSync(FX_INDEX, 'utf8')).units || {};
  const off = [];
  for (const [id, e] of Object.entries(E)) {
    const sp = A.enemies[id]?.spine;
    if (!sp || !units[id] || !Array.isArray(e.skills)) continue;
    e.skills.forEach((s, slot) => {
      const key = officialKey(units[id], s);
      if (!key || !Object.hasOwn(sp.animations, key)) return;          // no clip named, or one the model lacks
      const c = sp.anims.skills?.[slot] ?? sp.anims.skill;
      if (c && (c.loop === key || c.begin === key)) return;
      if (NEVER_CAST[id]?.includes(s.prefabKey)) return;
      off.push(`${id} slot ${slot} (${s.prefabKey}): ${c && c.loop} ≠ ${key}`);
    });
  }
  assert.deepEqual(off, []);
});

test('the NEVER_CAST slots are cast nowhere in the sim', () => {
  const dir = new URL('../server/sim/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.js'));
  const text = files.map((f) => readFileSync(new URL(String(f), dir), 'utf8')).join('\n');
  for (const keys of Object.values(NEVER_CAST)) {
    for (const k of keys) assert.ok(!new RegExp(`sk\\.${k}\\b|sk\\[['"]${k}['"]\\]`).test(text), `${k}: no ab.sk lookup in server/sim`);
  }
});
