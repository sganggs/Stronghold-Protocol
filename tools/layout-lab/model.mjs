// Human layout annotation corpus. Training examples, not battle balance or AI policy.
import { createHash } from 'node:crypto';
import { buildDeployMap, positionClass, canPlace } from '../../server/match/board.js';
import { rotateOffset, isDir } from '../../server/sim/dir.js';
import { createRng } from '../../server/sim/rng.js';
import { attackRangeGrid, loadoutRecord, resolveRecordLoadout } from '../../shared/loadoutRecord.js';

export const DISTRIBUTIONS = [[2, 5, 1], [3, 4, 1], [4, 3, 1], [2, 4, 2], [3, 3, 2], [4, 2, 2]];
export const CORPUS_SEED = 20261015;

export function makeCorpus(data) {
  const ids = data.config.modes.mode_single_hard.stages;
  if (JSON.stringify(ids) !== JSON.stringify(data.config.modes.mode_multi_hard.stages)) throw new Error('Dire map pools differ');
  const rng = createRng(CORPUS_SEED);
  const roster = Object.values(data.chess).filter(c => c.visible && !c.isGolden && !c.isDiy && !c.isHidden)
    .map(c => {
      const lo = resolveRecordLoadout(c);
      const body = loadoutRecord(c, lo);
      return { id: c.chessId, sourceName: c.name, sourceSkill: body.skill?.name, role: c.attackKind === 'heal' ? 'heal'
        : c.position === 'MELEE' && ['TANK', 'PIONEER'].includes(c.profession) && c.stats.blockCnt >= 2 ? 'block' : 'damage',
      place: positionClass(body), block: body.stats.blockCnt || 0, range: attackRangeGrid(body),
      attackKind: body.attackKind, subProfession: c.subProfessionId };
    }).filter(c => c.range?.length && (c.role !== 'damage' || ['melee', 'ranged'].includes(c.attackKind)));
  const maps = ids.map(id => {
    const s = data.stages[id];
    const deploy = Object.fromEntries(buildDeployMap(s));
    const routes = Object.entries(s.groundPathsWithDevices || s.groundPaths)
      .filter(([key]) => ['9,10->9,2', '12,10->9,2'].includes(key)).map(([id, tiles]) => ({ id, tiles }));
    if (routes.length !== 2) throw new Error(`Missing normal routes: ${id}`);
    const tiles = [];
    for (let r = 12; r >= 9; r--) for (let c = 2; c <= 10; c++) {
      const cell = s.tiles[s.rows[r][c]];
      tiles.push({ r, c, key: `${r},${c}`, deploy: deploy[`${r},${c}`] || null, glyph: s.rows[r][c],
        terrain: cell.tileKey, groundPassable: cell.groundPassable, special: cell.special });
    }
    const inside = ([r, c]) => r >= 9 && r <= 12 && c >= 2 && c <= 10;
    const devices = (s.devices || []).filter(d => d.active && (inside(d.pos) || d.rangeTiles?.some(inside)))
      .map(d => ({ name: d.name, role: d.role, pos: d.pos, dir: d.dir, rangeTiles: d.rangeTiles?.filter(inside) || [] }));
    return { id, name: s.name, tiles, deploy, routes, devices };
  });
  const cases = maps.flatMap((map, mi) => DISTRIBUTIONS.map((counts, ci) => {
    const used = new Set();
    const units = counts.flatMap((count, ri) => {
      const role = ['block', 'damage', 'heal'][ri];
      return Array.from({ length: count }, (_, i) => {
        const pool = roster.filter(c => c.role === role && !used.has(c.id));
        // Sample range shapes first so common operators do not crowd out rare geometries.
        const groups = new Map();
        for (const c of pool) { const k = `${c.place}|${JSON.stringify(c.range)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
        const group = [...groups.values()][Math.floor(rng() * groups.size)];
        const rec = group[Math.floor(rng() * group.length)];
        used.add(rec.id);
        return { ...rec, uid: `${role}-${i + 1}`, number: i + 1 };
      });
    });
    return { id: `${map.id}-${ci + 1}`, mapId: map.id, mapIndex: mi, example: ci + 1, counts, units };
  }));
  const body = { schema: 1, seed: CORPUS_SEED, maps, cases };
  return { ...body, fingerprint: createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16) };
}

export function validateAnnotation(corpus, id, input) {
  const example = corpus.cases.find(c => c.id === id);
  if (!example || !input || typeof input !== 'object' || !Array.isArray(input.placements)) throw new Error('Invalid example');
  if (typeof input.notes !== 'string' || input.notes.length > 8000 || typeof input.confirmed !== 'boolean') throw new Error('Invalid notes');
  const map = corpus.maps.find(m => m.id === example.mapId);
  const deploy = new Map(Object.entries(map.deploy));
  const used = new Set(), occupied = new Set();
  const placements = input.placements.map(p => {
    const u = example.units.find(u => u.uid === p.uid);
    const key = `${p.row},${p.col}`;
    if (!u || used.has(u.uid) || occupied.has(key) || !Number.isInteger(p.row) || !Number.isInteger(p.col)
      || !isDir(p.dir) || !canPlace(deploy, u.place, p.row, p.col)) throw new Error('Illegal placement');
    used.add(u.uid); occupied.add(key);
    return { uid: u.uid, row: p.row, col: p.col, dir: p.dir };
  });
  if (input.confirmed && placements.length !== 8) throw new Error('Place all eight units before confirming');
  return { placements, notes: input.notes, confirmed: input.confirmed };
}

export function describeLayout(corpus, id, annotation) {
  const c = corpus.cases.find(c => c.id === id), m = corpus.maps.find(m => m.id === c.mapId);
  const placed = annotation.placements.map(p => {
    const u = c.units.find(u => u.uid === p.uid);
    const coverage = u.range.map(([dr, dc]) => { const [r, col] = rotateOffset(dr, dc, p.dir); return `${p.row + r},${p.col + col}`; });
    return { ...p, role: u.role, place: u.place, range: u.range, block: u.block, coverage };
  });
  return {
    routes: m.routes.map(rt => ({ id: rt.id, blockers: placed.filter(p => p.block > 0 && m.deploy[`${p.row},${p.col}`] === 'melee'
      && rt.tiles.some(([r, c]) => p.row === r && p.col === c)).map(p => ({ uid: p.uid, dir: p.dir,
        routeIndex: rt.tiles.findIndex(([r, c]) => p.row === r && p.col === c) })).sort((a, b) => a.routeIndex - b.routeIndex) })),
    units: placed.map(p => ({ ...p, healedBy: placed.filter(h => h.role === 'heal' && h.uid !== p.uid && h.coverage.includes(`${p.row},${p.col}`)).map(h => h.uid),
      approachTiles: m.routes.map(rt => { const i = rt.tiles.findIndex(([r, c]) => p.row === r && p.col === c);
        return { route: rt.id, count: i < 0 ? null : rt.tiles.slice(0, i).filter(t => p.coverage.includes(t.join(','))).length }; }) })),
  };
}
