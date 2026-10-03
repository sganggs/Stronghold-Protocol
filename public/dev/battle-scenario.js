// Deterministic sandbox built from the production BattleSpec, data and full content.
// No replacement enemy defs or stat overrides: extra units are required boss context.
import { GEO, BOSS_HIT_LIMIT } from '../../shared/constants.js';
import { resolveRecordLoadout } from '../../shared/loadoutRecord.js';

const entries = (raw, name) => Object.entries(raw[name]?.[name] ?? raw[name] ?? {});
const unsupportedStage = (id) => /^act1autochess_m0[567]$/.test(id);
// These are conditional abilities from the actual enemy records, not an enemy whitelist.
function terrainContext(enemy) {
  const text = (enemy?.abilities ?? []).map((a) => a.text ?? '').join(' ');
  if (/源石污染|活性源石/.test(text)) return { glyph: 'i', name: '源石污染区/活性源石', mechanic: '污染区内攻击或激活能力' };
  if (/水蚀|水中/.test(text)) return { glyph: 'd', name: '深水', mechanic: '水中隐匿、增益或水蚀' };
  return null;
}
const terrainTiles = (stage, glyph) => (stage?.rows ?? []).slice(9, 13).flatMap((line, i) => [...line].flatMap((g, col) => g === glyph && col >= 2 && col <= 10 ? [[i + 9, col]] : []));
export function battleCatalog(raw) {
  return {
    operators: entries(raw, 'chess').filter(([, r]) => r.charId && !r.isDiy).map(([id, r]) => ({
      id, record: r, label: `${r.name} · ${r.isGolden ? '精英' : '普通'} · ${id}`,
      search: `${r.name} ${id} ${r.charId}`.toLowerCase(),
    })),
    enemies: entries(raw, 'enemies').map(([id, r]) => ({
      id, record: r, label: `${r.name} · ${{ NORMAL: '普通', ELITE: '精锐', BOSS: '领袖' }[r.rank] ?? r.rank} · ${id}${r.tokenOnly ? ' · 关联单位' : ''}`,
      search: `${r.name} ${id}`.toLowerCase(),
    })),
    stages: entries(raw, 'stages').map(([id, r]) => ({ id, label: `${r.name} · ${id}` })),
  };
}

export function enemyContext(raw, enemyKey) {
  const enemies = Object.fromEntries(entries(raw, 'enemies'));
  const bosses = entries(raw, 'bosses').map(([, b]) => b);
  let boss = bosses.find((b) => b.enemyKey === enemyKey);
  if (!boss) boss = bosses.find((b) => b.parts?.includes(enemyKey));
  // Script-generated equipment / shells also depend on their leader.
  if (!boss && enemies[enemyKey]?.tokenOnly) boss = bosses.find((b) => enemies[b.enemyKey]?.summons?.includes(enemyKey));
  const terrain = terrainContext(enemies[enemyKey]);
  if (!boss) return { boss: null, template: null, terrain, notes: terrain ? [`地形能力：${terrain.mechanic}需要经过${terrain.name}。选择敌人时自动建议对应地图和地形出生点；手动改图或路线可观察未触发状态。`] : [] };
  const templateId = boss.templates?.mode_single_normal?.template;
  const template = raw.waves?.[templateId];
  if (!template) throw new Error(`${enemyKey} 需要 ${boss.name} 的关卡模板 ${templateId ?? '（缺失）'}，数据不可用。`);
  if (enemyKey === 'enemy_9016_acstmr') throw new Error('刺胄之弹需要胄在技能中绑定真实攻击目标并生成追踪路线；请选择假想敌：胄，观察其正常技能生成的炮弹。');
  return { boss, template, templateId, notes: [
    `已补齐 ${boss.name} 的单人${boss.hidden ? '隐秘核心' : '领袖'}模板 ${templateId}、共享生命池、关联部件及召唤路线。`,
    ...(template.devices?.length ? [`模板装置：${template.devices.map((d) => `${d.alias} (${d.pos})`).join('、')}`] : []),
  ] };
}

export function defaultBattleConfig(raw, { chessId = 'chess_char_1_02_a', enemyKey = 'enemy_1288_duskls', stageId } = {}) {
  const context = enemyContext(raw, enemyKey);
  const bossField = !!context.boss;
  const terrainStage = context.terrain && entries(raw, 'stages').find(([id, s]) => !unsupportedStage(id) && terrainTiles(s, context.terrain.glyph).length);
  stageId ??= terrainStage?.[0] ?? 'act2autochess_m02';
  const checkpoints = context.terrain ? terrainTiles(raw.stages[stageId], context.terrain.glyph).slice(0, 1) : [];
  const spawn = context.template?.spawns.find((s) => (s.key ?? s.enemyKey) === enemyKey);
  const route = spawn && context.template.routes[spawn.routeIndex];
  return { chessId, enemyKey, stageId, row: bossField ? 2 : 9, col: 8, dir: 'RIGHT', templateRoute: bossField && !!route,
    start: bossField ? [3, 10] : checkpoints[0] ?? [9, 10], end: bossField ? [2, 2] : [9, 2], checkpoints: [],
    seed: 7, allyAuto: true, enemyAuto: true, ...resolveRecordLoadout(raw.chess[chessId], {}) };
}

function checkPoint(grid, p, motion, name) {
  if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isInteger) || !grid.inRect(...p)) throw new Error(`${name}必须是战场范围内的整数行、列。`);
  if (!(motion === 'FLY' ? grid.flyPassable(...p) : grid.walkable(...p))) throw new Error(`${name} (${p}) 不能供${motion === 'FLY' ? '飞行' : '地面'}敌人通行。`);
}

export function createBattleScenario(sim, ds, raw, config) {
  const c = { ...config };
  const op = raw.chess[c.chessId];
  if (!op?.charId || op.isDiy) throw new Error('请选择真实干员；甄选干员是待填入角色的模板，不能独立部署。');
  const def = ds.getChess(c.chessId, c);
  const enemyDef = ds.getEnemy(c.enemyKey);
  if (!enemyDef) throw new Error(`敌人数据不存在：${c.enemyKey}`);
  const lo = resolveRecordLoadout(op, c);
  if (c.skillIndex != null && c.skillIndex !== lo.skillIndex) throw new Error('该形态尚未解锁所选技能。');
  if (c.moduleId != null && c.moduleId !== lo.moduleId && !(c.moduleId === 'none' && lo.moduleId == null)) throw new Error('该形态不支持所选模组。');
  if (!Object.hasOwn(raw.stages, c.stageId)) throw new Error(`地图数据不存在：${c.stageId}`);
  if (unsupportedStage(c.stageId)) throw new Error('当前模拟器尚未实现这张地图的水上平台、沙尘暴或树丛装置；请选择已支持的地图。');
  if (!Number.isInteger(c.seed) || c.seed < 1 || c.seed > 0xffffffff) throw new Error('随机种子须为 1～4294967295 的整数。');
  if (!['UP', 'RIGHT', 'DOWN', 'LEFT'].includes(c.dir)) throw new Error('无效部署朝向。');
  const ctx = enemyContext(raw, c.enemyKey), tpl = ctx.template;
  const bossField = !!ctx.boss;
  const rect = { ...(bossField ? GEO.BOSS_RECT : GEO.NORMAL_RECT) };
  const deployRect = { ...GEO.FIELD, ...(bossField ? { r0: 2, r1: 5 } : {}) };
  if (![c.row, c.col].every(Number.isInteger) || c.row < deployRect.r0 || c.row > deployRect.r1 || c.col < deployRect.c0 || c.col > deployRect.c1) throw new Error(`干员部署限制：行 ${deployRect.r0}～${deployRect.r1}，列 ${deployRect.c0}～${deployRect.c1}。`);
  const motion = enemyDef.motion;
  const templateSpawn = tpl?.spawns.find((s) => (s.key ?? s.enemyKey) === c.enemyKey);
  const templateRoute = c.templateRoute && templateSpawn ? tpl.routes[templateSpawn.routeIndex] : null;
  if (c.templateRoute && !templateRoute) throw new Error('这个敌人没有独立模板路线，请关闭模板路线并指定出生点与终点。');
  const route = templateRoute ?? { motion, start: c.start, end: c.end, checkpoints: c.checkpoints ?? [] };
  // Keep template routes at their original indices: branch/patrol dispatch matches them exactly.
  const routes = [...(tpl?.routes ?? []), route];
  const routeIndex = templateRoute ? templateSpawn.routeIndex : routes.length - 1;
  const contextSpawns = (tpl?.spawns ?? []).filter((s) => s.tag === 'boss' || s.tag === 'part')
    .filter((s) => (s.key ?? s.enemyKey) !== c.enemyKey)
    .map((s) => ({ ...s, enemyKey: s.key ?? s.enemyKey, time: 0, count: 1 }));
  const selected = { time: 0, enemyKey: c.enemyKey, routeIndex, count: 1,
    tag: ctx.boss?.enemyKey === c.enemyKey ? 'boss' : bossField ? 'part' : undefined };
  const poolMax = bossField ? ctx.boss.bloodPoint?.NORMAL * (raw.config?.bossHpScale?.solo ?? 0.25) : null;
  if (bossField && !(poolMax > 0)) throw new Error('缺少真实领袖生命池配置。');
  const spec = sim.buildBattleSpec({
    battleId: 'dev.battle', fieldId: 'n:dev', content: 'full', kind: bossField ? (ctx.boss.hidden ? 'hidden' : 'boss') : 'normal',
    seed: c.seed, stageId: c.stageId, rect, timeLimit: 300, modeId: 'mode_single_normal', round: bossField ? (ctx.boss.hidden ? 15 : 14) : 1,
    waveId: ctx.templateId, bossId: ctx.boss?.bossId, boss: bossField ? { poolHp: poolMax, poolMax } : null,
    enemyOverrides: tpl?.overrides ?? {}, flags: { layerGainsEnabled: false },
    players: [{ playerId: 'dev', seat: 0, side: 'L', colOffset: 0, coords: 'field', bonds: {}, playerEffects: [],
      units: [{ uid: 1, kind: 'chess', chessId: c.chessId, row: c.row, col: c.col, dir: c.dir, skillIndex: lo.skillIndex, moduleId: lo.moduleId }],
    }], spawns: [...contextSpawns, selected], routes,
  });
  const battle = sim.createBattleFromSpec(spec, ds, { quiet: true });
  battle.autoFinish = false;
  if (!battle.grid.canStand(c.row, c.col, { ranged: def.position === 'RANGED' })) throw new Error(`部署格 (${c.row},${c.col}) 不支持${def.position === 'RANGED' ? '远程' : '近战'}干员（地面/高台/不可部署限制）。`);
  // Stage devices and owner summons use the normal deployment hooks.
  battle.start();
  const operator = battle.allyUnits.find((u) => u.uid === 1);
  if (!operator?.alive || !operator.deployed) throw new Error('该部署位置被地图装置占用，干员无法部署。');
  // Official templates contain teleports and patrol legs; the game's compiler handles those.
  const points = templateRoute ? [] : [route.start, ...route.checkpoints, route.end];
  for (const p of points) checkPoint(battle.grid, p, motion, '路线节点');
  if (ctx.terrain) ctx.notes.push(terrainTiles(raw.stages[c.stageId], ctx.terrain.glyph).length
    ? `当前地图含${ctx.terrain.name}；能力仅在敌人实际经过对应地形时触发。`
    : `当前地图无${ctx.terrain.name}，${ctx.terrain.mechanic}不会触发。`);
  for (let i = 1; i < points.length; i++) {
    if (motion !== 'FLY' && battle.grid.flowField(...points[i]).dist[battle.grid.key(...points[i - 1])] < 0) throw new Error(`地面路线不连通：(${points[i - 1]}) → (${points[i]})。`);
    if (motion === 'FLY') {
      const a = points[i - 1], z = points[i], n = Math.max(Math.abs(z[0] - a[0]), Math.abs(z[1] - a[1])) * 4;
      for (let k = 0; k <= n; k++) if (!battle.grid.flyPassable(Math.round(a[0] + (z[0] - a[0]) * k / (n || 1)), Math.round(a[1] + (z[1] - a[1]) * k / (n || 1)))) throw new Error('飞行路线穿过禁止通行的地图格。');
    }
  }
  const scene = { battle, spec, config: c, operator, blocker: operator, enemy: null, context: ctx, phases: new Map() };
  // These controls suppress ordinary attacks only; skills, movement and phase timers keep their real rules.
  const applyAuto = (u) => {
    const enabled = u.side === 'ally' ? c.allyAuto : c.enemyAuto;
    if (enabled) battle.removeBuff(u, 'dev:auto-off');
    else if (!u.findBuff('dev:auto-off')) battle.addBuff(u, { key: 'dev:auto-off', persist: true, flags: { disarm: true } });
  };
  battle.on('enemySpawn', ({ enemy }) => applyAuto(enemy), { priority: -1000 });
  battle.on('deploy', ({ unit }) => applyAuto(unit), { priority: -1000 });
  // Apply before the first combat tick, including content-created summons.
  for (const u of battle.units) applyAuto(u);
  battle._processSpawns();
  scene.enemy = battle.units.find((u) => u.side === 'enemy' && u.defId === c.enemyKey);
  if (!scene.enemy) throw new Error('所选敌人未能生成。');
  if (battle.errorCount) throw new Error(`场景初始化失败：${battle.errors.map((e) => String(e.message ?? e)).join('；')}`);
  return scene;
}

export function setAutoAttack(scene, side, enabled) {
  scene.config[side === 'ally' ? 'allyAuto' : 'enemyAuto'] = !!enabled;
  for (const u of scene.battle.units.filter((u) => u.side === side)) {
    scene.battle.removeBuff(u, 'dev:auto-off');
    if (!enabled) scene.battle.addBuff(u, { key: 'dev:auto-off', persist: true, flags: { disarm: true } });
  }
}

export function isFrequencyTarget(target) {
  return !!target && !!(target.s.flags.hitCount || target.s.flags.hitCountArts || target.mem.ab?.hitShield > 0 || target.mem.ab?.frequencyShield?.() > 0 || target.buffs.some((b) => b.shieldHits > 0));
}

export function testDamage(scene, target, { lethal = false, amount = 1, type = 'true', hit = false } = {}) {
  const b = scene.battle;
  if (!target?.alive || b.finished) throw new Error('目标已退场或战斗已结束。');
  if (hit && !isFrequencyTarget(target)) throw new Error('当前目标不是频次生命或频次护盾。');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('测试伤害必须是有限正数。');
  if (!lethal) return b.dealDamage(hit ? scene.operator : null, target, { amount: hit ? 1 : amount, type: hit && target.s.flags.hitCountArts ? 'arts' : hit ? 'phys' : type, isAttack: hit, sourceless: hit, tags: ['dev:test-damage'] });
  // Explicit testing HP loss bypasses defences but still fires fatal/kill/revival hooks.
  // Leaders retain the production single-hit cap: split pool depletion into legal losses.
  let dealt = 0;
  do {
    const loss = target.isBoss ? Math.min(target.hp, BOSS_HIT_LIMIT - 1) : target.hp;
    const before = target.hp;
    dealt += b.loseHp(target, loss, { tags: ['dev:test-lethal'] });
    if (!target.bossPool || target.hp >= before) break;
  } while (target.alive && target.hp > 0);
  return dealt;
}
