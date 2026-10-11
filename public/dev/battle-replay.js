// Development-only recorder: rebuild the initial BattleSpec, then inject operations at tick boundaries.
// [ASSUMED] tick 0 is after start/spawn hooks, before the first step. Operations at tick N run after N steps.
import { APP_VERSION } from '../../shared/constants.js';
import { t } from '../../shared/i18n.js';
import { createBattleScenario, setAutoAttack, testDamage } from './battle-scenario.js';

export const SCHEMA_VERSION = 1;
export const MAX_TICKS = 18000;
export const MAX_OPERATIONS = 10000;
const clone = (v) => JSON.parse(JSON.stringify(v));
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const fields = (v, keys) => object(v) && Object.keys(v).every((k) => keys.includes(k));
const CONFIG_KEYS = ['chessId', 'enemyKey', 'stageId', 'skillIndex', 'moduleId', 'potential', 'cultivate', 'row', 'col', 'dir',
  'start', 'end', 'checkpoints', 'templateRoute', 'allyAuto', 'enemyAuto'];

/** Stable content fingerprint of all unlocalized simulation data, including boss templates/configuration. */
export function dataVersion(raw) {
  const stable = (v) => Array.isArray(v) ? v.map(stable) : object(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
  const src = JSON.stringify(stable(raw));
  let a = 2166136261, b = 5381;
  for (let i = 0; i < src.length; i++) { a = Math.imul(a ^ src.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ src.charCodeAt(i); }
  return `fnv1a-djb2:${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

function validateOperation(op, endTick) {
  const base = ['tick', 'sequence', 'type'];
  if (!object(op) || !integer(op.tick, endTick) || !integer(op.sequence, MAX_OPERATIONS)) throw new Error(t('操作帧号或同帧序号无效。'));
  if (op.type === 'autoAttack') {
    if (!fields(op, [...base, 'side', 'enabled']) || !['ally', 'enemy'].includes(op.side) || typeof op.enabled !== 'boolean') throw new Error(t('无效攻击开关。'));
  } else if (op.type === 'damage') {
    if (!fields(op, [...base, 'targetId', 'amount', 'damageType', 'lethal', 'hit']) || !integer(op.targetId, 1000000) || op.targetId === 0
      || !Number.isFinite(op.amount) || op.amount <= 0 || op.amount > 1e12 || !['true', 'phys', 'arts'].includes(op.damageType)
      || typeof op.lethal !== 'boolean' || typeof op.hit !== 'boolean' || op.lethal && op.hit) throw new Error(t('无效手动伤害操作。'));
  } else if (op.type === 'retreat') {
    if (!fields(op, [...base, 'targetId']) || !integer(op.targetId, 1000000) || op.targetId === 0) throw new Error(t('无效撤退操作。'));
  } else throw new Error(t('未知操作类型：{type}', { type: String(op.type) }));
}

/** Strict structural validation before simulation; createBattleScenario checks data IDs, loadouts and terrain. */
export function validateReplay(input, { gameVersion = APP_VERSION, version } = {}) {
  if (typeof input === 'string' && input.length > 2e6) throw new Error(t('场景 JSON 超过 2 MB。'));
  let doc;
  try { doc = typeof input === 'string' ? JSON.parse(input) : clone(input); }
  catch { throw new Error(t('场景 JSON 格式错误。')); }
  if (!fields(doc, ['schemaVersion', 'gameVersion', 'dataVersion', 'seed', 'config', 'operations', 'endTick'])
    || doc.schemaVersion !== SCHEMA_VERSION) throw new Error(t('不支持的场景 schemaVersion。'));
  if (typeof doc.gameVersion !== 'string' || doc.gameVersion.length > 64 || !/^fnv1a-djb2:[0-9a-f]{16}$/.test(doc.dataVersion)
    || !Number.isInteger(doc.seed) || doc.seed < 1 || doc.seed > 0xffffffff || !integer(doc.endTick, MAX_TICKS)) throw new Error(t('场景版本、seed 或结束帧无效。'));
  const c = doc.config;
  const point = (p) => Array.isArray(p) && p.length === 2 && p.every((x) => integer(x, 20));
  if (!fields(c, CONFIG_KEYS) || CONFIG_KEYS.some((k) => !(k in c))
    || !['chessId', 'enemyKey', 'stageId'].every((k) => typeof c[k] === 'string' && /^[\w-]{1,128}$/.test(c[k]))
    || !(c.skillIndex === null || integer(c.skillIndex, 9)) || !(c.moduleId === null || typeof c.moduleId === 'string' && /^[\w-]{1,64}$/.test(c.moduleId))
    || !integer(c.potential, 6) || c.potential < 1 || !integer(c.cultivate, 3)
    || !integer(c.row, 18) || !integer(c.col, 20) || !['UP', 'RIGHT', 'DOWN', 'LEFT'].includes(c.dir)
    || !point(c.start) || !point(c.end) || !Array.isArray(c.checkpoints) || c.checkpoints.length > 64 || !c.checkpoints.every(point)
    || !['templateRoute', 'allyAuto', 'enemyAuto'].every((k) => typeof c[k] === 'boolean')) throw new Error(t('场景配置格式、坐标或数值无效。'));
  if (!Array.isArray(doc.operations) || doc.operations.length > MAX_OPERATIONS) throw new Error(t('操作序列无效或超过 10000 条。'));
  for (const op of doc.operations) validateOperation(op, doc.endTick);
  doc.operations.sort((a, b) => a.tick - b.tick || a.sequence - b.sequence);
  const seq = new Map();
  for (const op of doc.operations) {
    const expected = seq.get(op.tick) ?? 0;
    if (op.sequence !== expected) throw new Error(t('同帧操作序号须从 0 连续递增。'));
    seq.set(op.tick, expected + 1);
  }
  const warnings = [];
  if (doc.gameVersion !== gameVersion || version && doc.dataVersion !== version) warnings.push(t('版本不一致：场景 {game} / {data}，当前 {currentGame} / {currentData}；重放结果可能不同。',
    { game: doc.gameVersion, data: doc.dataVersion, currentGame: gameVersion, currentData: version ?? '?' }));
  return { doc, warnings };
}

/** One recorder owns exactly one fresh battle. No runtime objects are serialized. */
export function createRecorder(sim, ds, raw, config, version = dataVersion(raw)) {
  const initial = clone(config);
  const scene = createBattleScenario(sim, ds, raw, initial);
  const operations = [];
  let tick = 0;
  function apply(op) {
    if (op.type === 'autoAttack') setAutoAttack(scene, op.side, op.enabled);
    else {
      const target = scene.battle.units.find((u) => u.id === op.targetId);
      if (!target) throw new Error(t('操作目标不存在：#{id}', { id: op.targetId }));
      if (op.type === 'damage') testDamage(scene, target, { amount: op.amount, type: op.damageType, lethal: op.lethal, hit: op.hit });
      else {
        if (target !== scene.operator || !target.alive || target.removed) throw new Error(t('撤退目标必须是场上的所选干员。'));
        scene.battle.retreat(target, { permanent: true });
      }
    }
  }
  function perform(params) {
    if (operations.length >= MAX_OPERATIONS) throw new Error(t('操作序列无效或超过 10000 条。'));
    const prev = operations.at(-1);
    const op = { ...params, tick, sequence: prev?.tick === tick ? prev.sequence + 1 : 0 };
    validateOperation(op, tick);
    apply(op); operations.push(clone(op));
    return op;
  }
  function step() {
    if (tick >= MAX_TICKS || scene.battle.finished) return false;
    scene.battle.step(); tick++;
    return true;
  }
  return { scene, operations, perform, step, get tick() { return tick; },
    export() {
      return { schemaVersion: SCHEMA_VERSION, gameVersion: APP_VERSION, dataVersion: version, seed: initial.seed,
        config: clone(Object.fromEntries(CONFIG_KEYS.map((k) => [k, initial[k]]))), operations: clone(operations), endTick: tick };
    },
  };
}

/** Import is transactional: validate and re-simulate a separate battle before the caller replaces its scene. */
export function replayScenario(sim, ds, raw, input, version = dataVersion(raw), onFrame = () => {}) {
  const { doc, warnings } = validateReplay(input, { version });
  const recorder = createRecorder(sim, ds, raw, { ...doc.config, seed: doc.seed }, version);
  let index = 0;
  while (true) {
    while (index < doc.operations.length && doc.operations[index].tick === recorder.tick) {
      const { tick: _tick, sequence: _sequence, ...params } = doc.operations[index++];
      recorder.perform(params);
    }
    onFrame(recorder);
    if (recorder.tick === doc.endTick) break;
    if (!recorder.step()) throw new Error(t('场景在第 {tick} 帧已结束，无法重放后续操作。', { tick: recorder.tick }));
  }
  return { recorder, warnings };
}
