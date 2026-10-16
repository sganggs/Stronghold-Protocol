// Deterministic sandbox built from the production BattleSpec, data and full content.
// No replacement enemy defs or stat overrides: extra units are required boss context.
import { GEO, BOSS_HIT_LIMIT } from '../../shared/constants.js';
import { resolveRecordLoadout } from '../../shared/loadoutRecord.js';
import { meleeOnHighGround } from '../../shared/highGround.js';
import { isPotential, isCultivate } from '../../shared/potential.js';
import { t } from '../../shared/i18n.js';

const entries = (raw, name) => Object.entries(raw[name]?.[name] ?? raw[name] ?? {});
const unsupportedStage = (id) => /^act1autochess_m0[567]$/.test(id);
// Sandbox selection preferences requested on 2026-10-16; historical versions remain selectable.
const DEFAULT_OPERATOR_VARIANTS = {
  char_4151_tinman: 'chess_char_2_19_a',
  char_4013_kjera: 'chess_char_3_20_a',
  char_4196_reckpr: 'chess_char_5_23_a',
  char_128_plosis: 'chess_char_4_21_a',
  char_1026_gvial2: 'chess_char_4_23_a',
  char_4134_cetsyr: 'chess_char_4_25_a',
  char_171_bldsk: 'chess_char_4_26_a',
  char_4146_nymph: 'chess_char_5_22_a',
};
// These leaders implement their ordinary attack inside a scripted tick, outside the engine attack loop.
const SCRIPTED_ATTACKS = new Set(['enemy_9033_acdeer', 'enemy_9021_acduml', 'enemy_9021_acduml_2', 'enemy_9022_acdumm']);
// These are conditional abilities from the actual enemy records, not an enemy whitelist.
function terrainContext(enemy) {
  const text = (enemy?.abilities ?? []).map((a) => a.text ?? '').join(' ');
  if (/源石污染|活性源石/.test(text)) return { glyph: 'i', name: t('源石污染区/活性源石'), mechanic: t('污染区内攻击或激活能力') };
  if (/水蚀|水中/.test(text)) return { glyph: 'd', name: t('深水'), mechanic: t('水中隐匿、增益或水蚀') };
  return null;
}
const terrainTiles = (stage, glyph) => (stage?.rows ?? []).slice(9, 13).flatMap((line, i) => [...line].flatMap((g, col) => g === glyph && col >= 2 && col <= 10 ? [[i + 9, col]] : []));

// PRTS enemy roster: https://prts.wiki/w/敌人一览 . Classify handbook fields, not scripted skill behaviour.
function enemyFilterGroups() {
  return [
    { id: 'rank', options: [['NORMAL', t('普通')], ['ELITE', t('精英')], ['BOSS', t('领袖')]] },
    { id: 'motion', options: [['WALK', t('地面')], ['FLY', t('飞行')]] },
    { id: 'kind', options: [['infection', t('感染生物')], ['drone', t('无人机')], ['sarkaz', t('萨卡兹')],
      ['mutant', t('宿主')], ['seamonster', t('海怪')], ['originiumartscraft', t('法术造物')], ['animated', t('化物')],
      ['machine', t('机械')], ['wildanimal', t('野生动物')], ['collapsal', t('坍缩体')], ['origen', t('源石造物')], ['other', t('其他')]] },
    { id: 'attack', options: [['MELEE', t('近战')], ['RANGED', t('远程')], ['NONE', t('不攻击')]] },
    { id: 'damage', options: [['phys', t('物理')], ['arts', t('法术')], ['heal', t('治疗')], ['none', t('无')]] },
  ];
}

/** AND across filter groups and search; multi-category records match either of their categories. */
export function filterBattleEnemies(enemies, filters = {}, query = '') {
  const search = query.trim().toLowerCase();
  return enemies.filter((enemy) => enemy.search.includes(search)
    && Object.entries(filters).every(([key, value]) => !value || enemy.categories[key]?.includes(value)));
}

export function battleCatalog(raw, localize = (name) => name) {
  const operators = new Map();
  for (const [id, r] of entries(raw, 'chess')) {
    if (!r.charId || r.isDiy) continue;
    let operator = operators.get(r.charId);
    if (!operator) {
      operator = { id: r.charId, label: localize(r.name), search: `${r.name} ${localize(r.name)} ${r.charId}`, variants: [] };
      operators.set(r.charId, operator);
    }
    const baseId = r.baseId ?? id;
    let variant = operator.variants.find((v) => v.id === baseId);
    if (!variant) {
      variant = { id: baseId, label: t('{tier}阶', { tier: r.tier }), normal: null, golden: null };
      operator.variants.push(variant);
    }
    variant[r.isGolden ? 'golden' : 'normal'] = id;
    operator.search += ` ${id}`;
  }
  const groups = enemyFilterGroups();
  const kinds = new Set(groups.find((g) => g.id === 'kind').options.map(([id]) => id));
  const enemies = entries(raw, 'enemies').map(([id, r]) => {
    const tags = (r.tags ?? []).filter((tag) => kinds.has(tag));
    return {
      id, record: r, label: `${localize(r.name)} · ${{ NORMAL: t('普通'), ELITE: t('精锐'), BOSS: t('领袖') }[r.rank] ?? r.rank} · ${id}${r.tokenOnly ? t(' · 关联单位') : ''}`,
      search: `${r.name} ${localize(r.name)} ${id} ${r.handbookIndex ?? ''} ${r.desc ?? ''} ${(r.abilities ?? []).map((a) => a.text ?? '').join(' ')}`.toLowerCase(),
      categories: {
        rank: [r.rank], motion: [r.stats?.motion ?? (r.isFlyEnemy ? 'FLY' : 'WALK')], kind: tags.length ? tags : ['other'],
        attack: r.applyWay === 'ALL' ? ['MELEE', 'RANGED'] : [r.applyWay],
        damage: r.stats?.dmgTypes ?? (r.stats?.dmgType ? [r.stats.dmgType] : []),
      },
    };
  });
  return {
    operators: [...operators.values()].map((op) => ({ ...op, search: op.search.toLowerCase(),
      defaultVariant: DEFAULT_OPERATOR_VARIANTS[op.id] ?? op.variants[0].id })),
    enemies,
    enemyFilters: groups.map((group) => ({ ...group, options: group.options
      .filter(([id]) => enemies.some((enemy) => enemy.categories[group.id].includes(id)))
      .map(([id, label]) => ({ id, label })) })),
    stages: entries(raw, 'stages').map(([id, r]) => ({ id, label: `${localize(r.name)} · ${id}` })),
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
  if (!boss) return { boss: null, template: null, terrain, notes: terrain ? [t('地形能力：{mechanic}需要经过{name}。选择敌人时自动建议对应地图和地形出生点；手动改图或路线可观察未触发状态。', { mechanic: terrain.mechanic, name: terrain.name })] : [] };
  const templateId = boss.templates?.mode_single_normal?.template;
  const template = raw.waves?.[templateId];
  if (!template) throw new Error(t('{enemyKey} 需要 {name} 的关卡模板 {2}，数据不可用。', { enemyKey, name: boss.name, 2: templateId ?? t('（缺失）') }));
  if (enemyKey === 'enemy_9016_acstmr') throw new Error(t('刺胄之弹需要胄在技能中绑定真实攻击目标并生成追踪路线；请选择假想敌：胄，观察其正常技能生成的炮弹。'));
  return { boss, template, templateId, notes: [
    t('已补齐 {name} 的单人{1}模板 {templateId}、共享生命池、关联部件及召唤路线。', { name: boss.name, 1: boss.hidden ? t('隐秘核心') : t('领袖'), templateId }),
    ...(template.devices?.length ? [t('模板装置：{0}', { 0: template.devices.map((d) => `${d.alias} (${d.pos})`).join('、') })] : []),
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
    seed: 7, potential: 6, cultivate: 0, allyAuto: true, enemyAuto: true, ...resolveRecordLoadout(raw.chess[chessId], {}) };
}

function checkPoint(grid, p, motion, name) {
  if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isInteger) || !grid.inRect(...p)) throw new Error(t('{name}必须是战场范围内的整数行、列。', { name }));
  if (!(motion === 'FLY' ? grid.flyPassable(...p) : grid.walkable(...p))) throw new Error(t('{name} ({p}) 不能供{2}敌人通行。', { name, p, 2: motion === 'FLY' ? t('飞行') : t('地面') }));
}

export function createBattleScenario(sim, ds, raw, config) {
  const c = { ...config };
  if (!isPotential(c.potential) || !isCultivate(c.cultivate)) throw new Error(t('潜能须为 1～6，练度须为 0～3 的整数。'));
  if (typeof c.allyAuto !== 'boolean' || typeof c.enemyAuto !== 'boolean' || typeof c.templateRoute !== 'boolean') throw new Error(t('攻击开关与模板路线须为布尔值。'));
  if (!Array.isArray(c.checkpoints) || c.checkpoints.length > 64) throw new Error(t('途经点须为数组，最多 64 个。'));
  const op = raw.chess[c.chessId];
  if (!Object.hasOwn(raw.chess, c.chessId) || !op?.charId || op.isDiy) throw new Error(t('请选择真实干员；甄选干员是待填入角色的模板，不能独立部署。'));
  const def = ds.getChess(c.chessId, c);
  const enemyDef = ds.getEnemy(c.enemyKey);
  if (!Object.hasOwn(raw.enemies, c.enemyKey) || !enemyDef) throw new Error(t('敌人数据不存在：{enemyKey}', { enemyKey: c.enemyKey }));
  const lo = resolveRecordLoadout(op, c);
  if (c.skillIndex != null && c.skillIndex !== lo.skillIndex) throw new Error(t('该形态尚未解锁所选技能。'));
  if (c.moduleId != null && c.moduleId !== lo.moduleId && !(c.moduleId === 'none' && lo.moduleId == null)) throw new Error(t('该形态不支持所选模组。'));
  if (!Object.hasOwn(raw.stages, c.stageId)) throw new Error(t('地图数据不存在：{stageId}', { stageId: c.stageId }));
  if (unsupportedStage(c.stageId)) throw new Error(t('当前模拟器尚未实现这张地图的水上平台、沙尘暴或树丛装置；请选择已支持的地图。'));
  if (!Number.isInteger(c.seed) || c.seed < 1 || c.seed > 0xffffffff) throw new Error(t('随机种子须为 1～4294967295 的整数。'));
  if (!['UP', 'RIGHT', 'DOWN', 'LEFT'].includes(c.dir)) throw new Error(t('无效部署朝向。'));
  const ctx = enemyContext(raw, c.enemyKey), tpl = ctx.template;
  const bossField = !!ctx.boss;
  const rect = { ...(bossField ? GEO.BOSS_RECT : GEO.NORMAL_RECT) };
  const deployRect = { ...GEO.FIELD, ...(bossField ? { r0: 2, r1: 5 } : {}) };
  if (![c.row, c.col].every(Number.isInteger) || c.row < deployRect.r0 || c.row > deployRect.r1 || c.col < deployRect.c0 || c.col > deployRect.c1) throw new Error(t('干员部署限制：行 {r0}～{r1}，列 {c0}～{c1}。', { r0: deployRect.r0, r1: deployRect.r1, c0: deployRect.c0, c1: deployRect.c1 }));
  const motion = enemyDef.motion;
  const templateSpawn = tpl?.spawns.find((s) => (s.key ?? s.enemyKey) === c.enemyKey);
  const templateRoute = c.templateRoute && templateSpawn ? tpl.routes[templateSpawn.routeIndex] : null;
  if (c.templateRoute && !templateRoute) throw new Error(t('这个敌人没有独立模板路线，请关闭模板路线并指定出生点与终点。'));
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
  if (bossField && !(poolMax > 0)) throw new Error(t('缺少真实领袖生命池配置。'));
  const spec = sim.buildBattleSpec({
    battleId: 'dev.battle', fieldId: 'n:dev', content: 'full', kind: bossField ? (ctx.boss.hidden ? 'hidden' : 'boss') : 'normal',
    seed: c.seed, stageId: c.stageId, rect, timeLimit: 300, modeId: 'mode_single_normal', round: bossField ? (ctx.boss.hidden ? 15 : 14) : 1,
    waveId: ctx.templateId, bossId: ctx.boss?.bossId, boss: bossField ? { poolHp: poolMax, poolMax } : null,
    enemyOverrides: tpl?.overrides ?? {}, flags: { layerGainsEnabled: false },
    players: [{ playerId: 'dev', seat: 0, side: 'L', colOffset: 0, coords: 'field', bonds: {}, playerEffects: [],
      units: [{ uid: 1, kind: 'chess', chessId: c.chessId, row: c.row, col: c.col, dir: c.dir, skillIndex: lo.skillIndex, moduleId: lo.moduleId,
        potential: c.potential, cultivate: c.cultivate }],
    }], spawns: [...contextSpawns, selected], routes,
  });
  const battle = sim.createBattleFromSpec(spec, ds, { quiet: true });
  battle.autoFinish = false;
  const rangedPlacement = def.position === 'RANGED' || meleeOnHighGround(op);
  if (!battle.grid.canStand(c.row, c.col, { ranged: rangedPlacement })) throw new Error(t('部署格 ({row},{col}) 不支持{2}干员（地面/高台/不可部署限制）。', { row: c.row, col: c.col, 2: def.position === 'RANGED' ? t('远程') : t('近战') }));
  // Stage devices and owner summons use the normal deployment hooks.
  battle.start();
  const operator = battle.allyUnits.find((u) => u.uid === 1);
  if (!operator?.alive || !operator.deployed) throw new Error(t('该部署位置被地图装置占用，干员无法部署。'));
  // Official templates contain teleports and patrol legs; the game's compiler handles those.
  const points = templateRoute ? [] : [route.start, ...route.checkpoints, route.end];
  for (const p of points) checkPoint(battle.grid, p, motion, t('路线节点'));
  if (ctx.terrain) ctx.notes.push(terrainTiles(raw.stages[c.stageId], ctx.terrain.glyph).length
    ? t('当前地图含{name}；能力仅在敌人实际经过对应地形时触发。', { name: ctx.terrain.name })
    : t('当前地图无{name}，{mechanic}不会触发。', { name: ctx.terrain.name, mechanic: ctx.terrain.mechanic }));
  for (let i = 1; i < points.length; i++) {
    if (motion !== 'FLY' && battle.grid.flowField(...points[i]).dist[battle.grid.key(...points[i - 1])] < 0) throw new Error(t('地面路线不连通：({0}) → ({1})。', { 0: points[i - 1], 1: points[i] }));
    if (motion === 'FLY') {
      const a = points[i - 1], z = points[i], n = Math.max(Math.abs(z[0] - a[0]), Math.abs(z[1] - a[1])) * 4;
      for (let k = 0; k <= n; k++) if (!battle.grid.flyPassable(Math.round(a[0] + (z[0] - a[0]) * k / (n || 1)), Math.round(a[1] + (z[1] - a[1]) * k / (n || 1)))) throw new Error(t('飞行路线穿过禁止通行的地图格。'));
    }
  }
  const scene = { battle, spec, config: c, operator, blocker: operator, enemy: null, context: ctx, phases: new Map() };
  // Mask the local ordinary-attack selectors only (冰凌 targets allies, 管/弦 target 余音).
  // Production disarm rules, phase checks, summoning and independent scripted skills stay intact.
  const attackView = new Proxy(battle, {
    get(target, key) {
      if (key === 'allies') return () => [];
      if (key === 'enemies') return [];
      const value = Reflect.get(target, key, target);
      // rng is a callable object with pick/shuffle methods; binding would drop those properties.
      if (key === 'rng') return value;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const scriptedControls = new WeakSet();
  const installScriptedControl = (u) => {
    if (!SCRIPTED_ATTACKS.has(u.defId) || scriptedControls.has(u)) return;
    const attack = u.mem.ab?.list[0];
    if (!attack?.tick) throw new Error(t('{name}的脚本普攻结构已变化，测试页无法安全关闭该攻击。', { name: u.name }));
    const tick = attack.tick;
    attack.tick = function (b, enemy, ability, dt) {
      return tick.call(this, c.enemyAuto ? b : attackView, enemy, ability, dt);
    };
    scriptedControls.add(u);
  };
  // These controls suppress ordinary attacks only; skills, movement and phase timers keep their real rules.
  const applyAuto = (u) => {
    installScriptedControl(u);
    const enabled = u.side === 'ally' ? c.allyAuto : c.enemyAuto;
    if (enabled) battle.removeBuff(u, 'dev:auto-off');
    else if (!u.findBuff('dev:auto-off')) battle.addBuff(u, { key: 'dev:auto-off', persist: true, flags: { disarm: true } });
  };
  battle.on('enemySpawn', ({ enemy }) => applyAuto(enemy), { priority: -1000 });
  battle.on('deploy', ({ unit }) => { if (unit.side === 'ally') applyAuto(unit); }, { priority: -1000 });
  // Apply before the first combat tick, including content-created summons.
  for (const u of battle.units) applyAuto(u);
  battle._processSpawns();
  scene.enemy = battle.units.find((u) => u.side === 'enemy' && u.defId === c.enemyKey);
  if (!scene.enemy) throw new Error(t('所选敌人未能生成。'));
  if (battle.errorCount) throw new Error(t('场景初始化失败：{0}', { 0: battle.errors.map((e) => String(e.message ?? e)).join('；') }));
  return scene;
}

export function setAutoAttack(scene, side, enabled) {
  if (!['ally', 'enemy'].includes(side) || typeof enabled !== 'boolean') throw new Error(t('无效攻击开关。'));
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
  if (!target?.alive || b.finished) throw new Error(t('目标已退场或战斗已结束。'));
  if (hit && !isFrequencyTarget(target)) throw new Error(t('当前目标不是频次生命或频次护盾。'));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(t('测试伤害必须是有限正数。'));
  if (!['true', 'phys', 'arts'].includes(type)) throw new Error(t('无效伤害类型。'));
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
