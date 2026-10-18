// Small original synthetic tables; no official game files in tests.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT } from '../../server/data.js';

export const OFFICIAL_TEST_ID = 'char_999_test';
export function tableFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'official-tables-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (rel, value) => {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, typeof value === 'string' ? value : JSON.stringify(value));
  };
  fs.cpSync(path.join(ROOT, 'data'), path.join(root, 'data'), { recursive: true });
  const attrs = { maxHp: 1000, atk: 100, def: 100, magicResistance: 0, cost: 10, blockCnt: 1,
    baseAttackTime: 1, attackSpeed: 100, respawnTime: 70, spRecoveryPerSec: 1, hpRecoveryPerSec: 0, moveSpeed: 1, maxDeployCount: 1 };
  const phase = { maxLevel: 99, rangeId: 'test-range', attributesKeyFrames: [{ level: 1, data: attrs }, { level: 99, data: attrs }] };
  const tables = {
    'character_table.json': { [OFFICIAL_TEST_ID]: { name: 'Test', appellation: 'Test', rarity: 'TIER_4', profession: 'WARRIOR',
      position: 'MELEE', subProfessionId: 'fearless', description: 'Test trait', phases: [phase, phase, phase],
      skills: [{ skillId: 'test-skill', unlockCond: { phase: 'PHASE_0', level: 1 } }] } },
    'skill_table.json': { 'test-skill': { levels: Array.from({ length: 7 }, () => ({ name: 'Skill', description: 'Test',
      skillType: 'MANUAL', durationType: 'NONE', duration: 10, rangeId: null, blackboard: [],
      spData: { spType: 1, spCost: 10, initSp: 0, maxChargeTime: 1, increment: 1 } })) } },
    'range_table.json': { 'test-range': { grids: [{ row: 0, col: 0 }, { row: 0, col: 1 }] } },
    'uniequip_table.json': { equipDict: {}, charEquip: {} },
    'battle_equip_table.json': { test: { phases: [] } },
    'activity_table.json': { autoChessData: {} },
  };
  const docs = {
    'pack.json': { id: 'table-test', name: 'Test', version: '1.0.0', content: ['chess'] },
    'chess.json': { test_a: { charId: OFFICIAL_TEST_ID, tier: 1, bonds: ['deputShip'] } },
  };
  const files = new Map(Object.entries(docs).map(([name, doc]) => [name, Buffer.from(JSON.stringify(doc))]));
  const calls = [];
  const fetchImpl = async url => { calls.push(String(url)); return Response.json(tables[path.basename(String(url))]); };
  const cache = name => path.join(root, '.cache/gamedata/excel', name);
  const seed = () => { for (const [name, table] of Object.entries(tables)) put(`.cache/gamedata/excel/${name}`, table); };
  return { root, put, tables, files, calls, fetchImpl, cache, seed };
}
