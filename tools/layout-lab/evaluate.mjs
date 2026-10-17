// Geometry-only validation of withheld demonstrations; this is not a combat win-rate estimate.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getData } from '../../server/data.js';
import { buildDeployMap } from '../../server/match/board.js';
import { planLayout, rangeTiles, fieldModel } from '../../server/match/bot.js';
import { createRng } from '../../server/sim/rng.js';

export const demonstrations = JSON.parse(readFileSync(new URL('../../docs/research/layout-demonstrations.json', import.meta.url), 'utf8'));
const data = getData({ log: { info() {}, warn() {}, error() {} } });

export function exampleSetup(example) {
  const records = example.units.map((u, i) => ({
    chessId: `example-${i}`, position: u.place.toUpperCase(), profession: u.role === 'block' ? 'TANK' : u.role === 'heal' ? 'MEDIC' : 'WARRIOR',
    attackKind: u.role === 'heal' ? 'heal' : u.place === 'melee' ? 'melee' : 'ranged',
    dmgType: u.role === 'heal' ? 'heal' : 'phys', rangeGrid: u.range, canHitFly: u.place !== 'melee',
    stats: { blockCnt: u.block, atk: 500, bat: 1, aspd: 100 },
  }));
  const gd = { chess: id => records.find(r => r.chessId === id), bossRound: 14, hiddenRound: 15 };
  const stage = data.stages[example.mapId];
  const m = { botFormationMode: 'learned', gd, round: 8, stageId: example.mapId, stage, wave: { templateId: 'demonstration', routes: [], spawns: [] }, rngBots: createRng(1) };
  const ps = { gd, deployMap: () => buildDeployMap(stage) };
  return { m, ps, records, pieces: records.map((r, uid) => ({ uid, id: r.chessId, kind: 'chess' })) };
}

export function measure(example, placements, model) {
  const units = placements.map((p, i) => ({ ...example.units[i], ...p,
    key: `${p.row},${p.col}`, cover: new Set(rangeTiles({ rangeGrid: example.units[i].range }, p.row, p.col, p.dir)) }));
  const healers = units.filter(u => u.role === 'heal');
  const fighters = units.filter(u => u.role !== 'heal');
  const fronts = fighters.filter(u => u.block && model.ground.has(u.key) && u.cover.has(u.key));
  return {
    healed: fighters.filter(u => healers.some(h => h.cover.has(u.key))).length,
    fighters: fighters.length,
    heldRoutes: model.routes.filter(rt => !rt.fly && fronts.some(u => rt.tiles.includes(u.key))).length,
    routes: model.routes.filter(rt => !rt.fly).length,
    supportedFronts: fronts.filter(f => fighters.some(u => u !== f && u.cover.has(f.key))).length,
    fronts: fronts.length,
  };
}

export function evaluateExample(example, formation) {
  const { m, ps, pieces } = exampleSetup(example);
  const plan = planLayout(m, ps, pieces, undefined, { formation });
  const placements = pieces.map(p => {
    const [row, col] = plan.get(p.uid).split(',').map(Number);
    return { row, col, dir: plan.dirOf(p.uid) };
  });
  return { placements, metrics: measure(example, placements, fieldModel(m, ps)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = demonstrations.examples.filter(e => e.heldOut).map(e => ({ id: e.id,
    before: evaluateExample(e, false).metrics, after: evaluateExample(e, true).metrics,
    human: measure(e, e.units, fieldModel(exampleSetup(e).m)),
  }));
  console.log(JSON.stringify(rows, null, 2));
}
