import { fxForm } from '../../shared/protocol.js';
import { meleeOnHighGround } from '../../shared/highGround.js';
import { createFieldView } from '../js/render/app.js';
import { data } from '../js/data.js';
import { assets } from '../js/assets.js';
import { loadBrowserSim } from '../js/battle/runner.js';
import { battleCatalog, defaultBattleConfig, enemyContext, createBattleScenario, setAutoAttack, isFrequencyTarget, testDamage } from './battle-scenario.js';

const el = (id) => document.getElementById(id);
const debug = window.__battleTest = window.__emberTest = { ready: false, error: null, scene: null };
const configIds = ['operator', 'enemy', 'skill', 'module', 'stage', 'row', 'col', 'dir', 'start-row', 'start-col', 'end-row', 'end-col', 'checkpoints', 'seed', 'template-route'];
const controlIds = ['pause', 'step', 'knockout', 'hit', 'damage-apply', 'withdraw', 'rebuild-view'];
let sim, ds, raw, catalog, view, scene, unitInfo, paused = true, accumulator = 0, lastFrame = null, raf;
const num = (id) => el(id).value.trim() === '' ? NaN : Number(el(id).value);
const phaseNames = { husk: '余烬/再生状态', revived: '已复活', crawl: '爬行', grounded: '瘫痪', float: '飞行', echo_dark: '暗色余音', echo_gold: '金色余音' };

function log(message) {
  const item = document.createElement('li');
  item.textContent = `${(scene?.battle.time ?? 0).toFixed(2)} 秒 · ${message}`;
  el('log').prepend(item);
  while (el('log').children.length > 200) el('log').lastChild.remove();
}
function safe(fn) {
  try { el('error').textContent = ''; fn(); }
  catch (error) { el('error').textContent = error.message; }
}
function selectOptions(id, items, preferred) {
  const sel = el(id), old = preferred ?? sel.value;
  sel.replaceChildren(...items.map((x) => new Option(x.label, String(x.id))));
  if (items.some((x) => String(x.id) === old)) sel.value = old;
}
function filterCatalog(kind) {
  const query = el(`${kind}-search`).value.trim().toLowerCase();
  const list = kind === 'operator' ? catalog.operators : catalog.enemies;
  const selected = el(kind).value, filtered = list.filter((x) => x.search.includes(query));
  // Filtering does not select a different unit or restart combat.
  const keep = list.find((x) => x.id === selected);
  if (keep && !filtered.includes(keep)) filtered.unshift(keep);
  selectOptions(kind, filtered, selected);
}
function loadouts() {
  const r = raw.chess[el('operator').value];
  const skills = (r.skills ?? (r.skill ? [r.skill] : [])).map((s) => ({ id: s.index ?? 0, label: `技能 ${(s.index ?? 0) + 1} · ${s.name} · ${s.skillId}` }));
  selectOptions('skill', skills, String(r.skills?.find((s) => s.isDefault)?.index ?? r.skill?.index ?? 0));
  const mods = [{ id: 'none', label: '不装备模组' }, ...(r.modules ?? []).map((m) => ({ id: m.uniEquipId, label: `${m.name} · ${m.typeName} · Lv.${m.level} · ${m.uniEquipId}` }))];
  selectOptions('module', mods, r.modules?.find((m) => m.isDefault)?.uniEquipId ?? 'none');
  el('skill').disabled = !skills.length; el('module').disabled = mods.length === 1;
  updatePlacementInfo();
}
function updatePlacementInfo() {
  const r = raw.chess[el('operator').value];
  const placement = r.position === 'RANGED' ? '远程，可部署高台或允许的地面格'
    : meleeOnHighGround(r, el('module').value) ? '近战，HOK-Y 允许部署高台或地面格；高台不阻挡'
    : '近战，须部署允许的地面格';
  el('loadout-info').textContent = `${r.profession} / ${r.subProfessionName} · ${placement}`;
}
function readConfig() {
  const templateRoute = el('template-route').checked;
  // Disabled custom route fields must not invalidate the selected official route.
  const text = templateRoute ? '' : el('checkpoints').value.trim();
  const checkpoints = text ? text.split(/[;；\n]/).map((v) => v.trim().split(/[,，]/).map(Number)) : [];
  if (checkpoints.some((p) => p.length !== 2 || !p.every(Number.isInteger))) throw new Error('途经点格式错误，请使用 行,列; 行,列。');
  return { chessId: el('operator').value, enemyKey: el('enemy').value, stageId: el('stage').value,
    skillIndex: el('skill').value === '' ? null : Number(el('skill').value), moduleId: el('module').value,
    row: num('row'), col: num('col'), dir: el('dir').value, seed: num('seed'), templateRoute,
    start: [num('start-row'), num('start-col')], end: [num('end-row'), num('end-col')], checkpoints,
    allyAuto: el('ally-auto').checked, enemyAuto: el('enemy-auto').checked };
}
function setPlacementDefaults() {
  let c;
  try { c = defaultBattleConfig(raw, { chessId: el('operator').value, enemyKey: el('enemy').value, stageId: el('stage').value }); }
  catch { return; } // restart reports the concrete unsupported context.
  el('row').value = c.row; el('col').value = c.col;
  el('start-row').value = c.start[0]; el('start-col').value = c.start[1];
  el('end-row').value = c.end[0]; el('end-col').value = c.end[1];
  el('checkpoints').value = c.checkpoints.map((p) => p.join(',')).join('; ');
  el('template-route').checked = c.templateRoute;
  const r = ds.getChess(c.chessId), stage = ds.getStage(c.stageId);
  const rows = c.row === 2 ? [2, 3, 4, 5] : [9, 10, 11, 12];
  const candidates = rows.flatMap((row) => Array.from({ length: 9 }, (_, i) => [row, i + 2]));
  candidates.sort((a, b) => (Math.abs(a[0] - c.row) + Math.abs(a[1] - c.col)) - (Math.abs(b[0] - c.row) + Math.abs(b[1] - c.col)));
  const probe = sim.createBattleFromSpec(sim.buildBattleSpec({ stageId: c.stageId, kind: c.row === 2 ? 'boss' : 'normal', players: [], spawns: [] }), ds, { quiet: true });
  const rangedPlacement = r.position === 'RANGED' || meleeOnHighGround(raw.chess[c.chessId], el('module').value);
  const tile = candidates.find(([row, col]) => probe.grid.canStand(row, col, { ranged: rangedPlacement }) && !(stage.devices ?? []).some((d) => !d.hidden && d.row === row && d.col === col && /crate/.test(d.key)));
  if (tile) { el('row').value = tile[0]; el('col').value = tile[1]; }
}
function summarizeUnit(u, title) {
  if (!u) return `${title}：未部署`;
  const flags = Object.entries(u.s.flags).filter(([, on]) => on).map(([key]) => key === 'stealth' && u.blockedBy ? '隐匿（被阻挡，当前可攻击）' : key).join('、') || '无';
  const kind = u.form ?? scene.phases.get(u.id) ?? u.mem.ab?.form;
  const phase = !u.alive ? (u.removeReason === 'leak' ? '漏怪' : u.removed ? '已撤下/退场' : '死亡') : phaseNames[kind] ?? kind ?? '本体';
  const sk = u.skill, enemySkills = u.mem.ab?.list.filter((a) => a.cd != null).map((a) => `${Math.max(0, a.left).toFixed(1)}s`).join(' / ');
  const meter = u.mem.ab?.skillSp?.();
  const shieldHits = (u.mem.ab?.hitShield ?? 0) + (u.mem.ab?.frequencyShield?.() ?? 0) + u.buffs.reduce((n, b) => n + (b.shieldHits ?? 0), 0);
  const sp = sk && !sk.noSkill ? `${sk.sp.toFixed(1)} / ${sk.spCost} · 充能 ${sk.charges} · ${sk.active ? '技能中' : '未开启'}`
    : meter ? `${meter.value.toFixed(1)} / ${Number.isFinite(meter.max) ? meter.max : '∞'}` : '无独立 SP 运行条';
  return `${title}：${u.name} (#${u.id})\n生命${u.s.flags.hitCount || u.s.flags.hitCountArts ? '次数' : ''}：${u.hp.toFixed(1)} / ${u.s.maxHp.toFixed(1)}${shieldHits > 0 ? ` · 频次护盾 ${shieldHits}` : ''}\nSP：${sp}${enemySkills ? ` · 敌人技能冷却 ${enemySkills}` : ''}\n位置：行 ${u.y.toFixed(2)}，列 ${u.x.toFixed(2)} · ${u.side === 'ally' ? u.dir : u.motion}\n阶段：${phase} · 状态：${flags}\n阻挡：${u.side === 'enemy' ? (u.blockedBy ? `${u.blockedBy.name} (#${u.blockedBy.id})` : '无') : u.blocking.map((e) => `${e.name} (#${e.id})`).join('、') || '无'}`;
}
function damageTarget() {
  return el('target').value === 'operator' ? scene.operator : scene.battle.units.find((u) => u.id === Number(el('target').value)) ?? scene.enemy;
}
function updateControls() {
  for (const id of controlIds) el(id).disabled = !scene;
  if (!scene) return;
  const b = scene.battle, target = damageTarget();
  el('pause').disabled = b.finished; el('step').disabled = b.finished; el('pause').textContent = paused ? '开始' : '暂停';
  for (const id of ['knockout', 'damage-apply']) el(id).disabled = b.finished || !target?.alive;
  el('hit').disabled = b.finished || !target?.alive || !isFrequencyTarget(target);
  el('withdraw').disabled = !scene.operator.alive || scene.operator.removed;
}
function flush() {
  if (!scene) return;
  const b = scene.battle, ev = b.drainEvents();
  for (const e of ev) {
    if (e[0] === 'fx' && e[4]?.id != null && (fxForm(e) !== undefined || ['phase', 'grow', 'revive'].includes(e[1]))) {
      const kind = fxForm(e) ?? e[4].kind ?? (e[1] === 'grow' ? `成长阶段 ${e[4].stage + 1}` : '复活');
      scene.phases.set(e[4].id, kind); log(`单位 #${e[4].id}：${phaseNames[kind] ?? kind}`);
    } else if (['die', 'leak', 'skill', 'retreat', 'block', 'unblock'].includes(e[0])) log(`${e[0]} · ${JSON.stringify(e.slice(1))}`);
  }
  // Fixed local frames also accept multiple test operations at the same paused timestamp.
  view.presentLocalFrame(b.snapshot(), ev);
  if (b.finished) paused = true;
  selectOptions('target', [{ id: 'enemy', label: `所选敌人 · ${scene.enemy.name}` }, { id: 'operator', label: `干员 · ${scene.operator.name}` },
    ...b.units.filter((u) => u.side === 'enemy' && u !== scene.enemy).map((u) => ({ id: u.id, label: `${u.name} (#${u.id})${u.alive ? '' : ' · 已退场'}` }))]);
  el('state').textContent = `时间：${b.time.toFixed(2)} 秒（${paused ? '暂停' : '运行'}） · seed ${b.seed}\n击杀：${b.killed} / ${b.total} · 漏怪：${b.leakedCount}${b.sharedBoss ? ` · 共享池 ${b.sharedBoss.hp.toFixed(1)} / ${b.sharedBoss.maxHp.toFixed(1)}` : ''}${b.finished ? `\n战斗结束：${b.reason}` : ''}\n\n${summarizeUnit(scene.operator, '干员')}\n\n${summarizeUnit(scene.enemy, '所选敌人')}${b.aliveEnemies().length > 1 ? `\n\n当前关联敌人：${b.aliveEnemies().filter((u) => u !== scene.enemy).map((u) => `${u.name} (#${u.id}) HP ${u.hp.toFixed(1)} · ${u.form ?? scene.phases.get(u.id) ?? '本体'}`).join('；')}` : ''}`;
  if (b.errorCount) el('error').textContent = `模拟器报告 ${b.errorCount} 个错误：${JSON.stringify(b.errors)}`;
  updateControls();
}
function enterView() {
  const b = scene.battle, meta = b.fieldMeta();
  const ids = new Set(meta.units.map((u) => u.id));
  // A just-dead enemy still has a death animation in the snapshot, even though fieldMeta omits it.
  for (const [id] of b.snapshot().units) if (!ids.has(id)) {
    const u = b.units.find((u) => u.id === id);
    if (u) meta.units.push(unitInfo(u));
  }
  for (const info of meta.units) if (scene.phases.has(info.id) && !info.form) info.form = scene.phases.get(info.id);
  view.setStage(data.lookup('stages', scene.spec.stageId)); view.enterBattle(meta);
  view.setCamera(scene.context.boss ? 'boss' : 'normal', { rect: meta.rect, side: 'L', instant: true });
  view.setLocalFeed({ on: true, speed: 1 }); view.presentLocalFrame(b.snapshot());
}
function restart() {
  paused = true; accumulator = 0; lastFrame = null;
  // Discard the entire old Battle (including scheduled callbacks), even if new config is invalid.
  scene = null; debug.scene = null;
  el('log').replaceChildren(); el('models').textContent = ''; el('error').textContent = ''; el('context').textContent = '';
  view.enterBattle({ fieldId: 'n:dev', units: [] });
  for (const id of ['start-row', 'start-col', 'end-row', 'end-col', 'checkpoints']) el(id).disabled = el('template-route').checked;
  try {
    const c = readConfig();
    scene = createBattleScenario(sim, ds, raw, c); debug.scene = scene; debug.config = c;
    el('context').textContent = scene.context.notes.join('\n') || '普通场景：一名干员、一只敌人。地图装置按原有规则运行。';
    enterView(); flush();
    const activeScene = scene;
    Promise.all(scene.battle.units.filter((u) => u.kind !== 'device').map(async (u) => {
      const entry = assets.spineEntry(u.def.spine);
      if (!entry) return `${u.name}：素材索引缺少模型 ${u.def.spine}`;
      try { await assets.spine.acquire(entry); assets.spine.release(entry); return null; }
      catch (error) { return `${u.name}：模型加载失败（${error.message}）`; }
    })).then((messages) => { if (scene === activeScene) el('models').textContent = messages.filter(Boolean).join('\n') || '当前单位使用真实 Spine 模型。'; });
  } catch (error) {
    el('error').textContent = error.message; el('state').textContent = '配置无效，场景已停止。修改配置后会重新建立。';
  }
  updateControls();
}
function advance(seconds) {
  if (!scene || !Number.isFinite(seconds) || seconds < 0 || seconds > 600) return;
  paused = true; accumulator = 0; lastFrame = null;
  for (let i = 0; i < Math.round(seconds * 30) && !scene.battle.finished; i++) { scene.battle.step(); flush(); }
}
function frame(now) {
  const dt = lastFrame == null ? 0 : Math.min(.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (scene && !paused && !scene.battle.finished) {
    accumulator += dt;
    while (accumulator >= 1 / 30 && !scene.battle.finished) { scene.battle.step(); accumulator -= 1 / 30; }
    flush();
  }
  raf = requestAnimationFrame(frame);
}
function damage(options) {
  const target = damageTarget(), oldHp = target.hp;
  const dealt = testDamage(scene, target, options);
  log(`测试操作 · ${target.name}：${options.lethal ? '强制致死生命流失' : options.hit ? '频次攻击一次' : `${options.amount} ${options.type} 伤害`} · HP ${oldHp.toFixed(1)} → ${target.hp.toFixed(1)}${dealt === 0 ? '（当前规则未扣除生命）' : ''}`);
  flush();
}
try {
  await data.loadAll('chess', 'tokens', 'items', 'enemies', 'stages', 'bonds', 'config', 'bosses', 'waves');
  await assets.ready(); ({ spec: sim, ds } = await loadBrowserSim());
  ({ unitInfo } = await import('/sim/snapshot.js'));
  raw = { ...ds.raw, bosses: data.get('bosses'), config: data.get('config') };
  if (!raw.bosses || !raw.config) throw new Error('领袖或配置数据加载失败，不能保证特殊场景完整。');
  catalog = battleCatalog(raw); debug.catalog = catalog;
  selectOptions('operator', catalog.operators, 'chess_char_1_02_a'); selectOptions('enemy', catalog.enemies, 'enemy_1288_duskls'); selectOptions('stage', catalog.stages, 'act2autochess_m02');
  loadouts(); setPlacementDefaults();
  view = await createFieldView(el('field'), { data, assets, settings: { quality: 'high', damageNumbers: true } });
  view.setBoardMode('2d'); debug.view = view; restart();
  for (const id of configIds) el(id).onchange = () => {
    if (id === 'operator') loadouts();
    if (id === 'module') updatePlacementInfo();
    if (id === 'enemy') {
      try {
        if (enemyContext(raw, el('enemy').value).terrain) el('stage').value = defaultBattleConfig(raw, { enemyKey: el('enemy').value }).stageId;
      } catch { /* restart renders the concrete unsupported reason */ }
    }
    if (['operator', 'enemy', 'stage'].includes(id)) setPlacementDefaults();
    restart();
  };
  for (const kind of ['operator', 'enemy']) el(`${kind}-search`).oninput = () => filterCatalog(kind);
  el('restart').onclick = restart;
  el('pause').onclick = () => { paused = !paused; accumulator = 0; lastFrame = null; flush(); };
  el('step').onclick = () => advance(1);
  el('knockout').onclick = () => safe(() => damage({ lethal: true })); el('hit').onclick = () => safe(() => damage({ hit: true }));
  el('damage-apply').onclick = () => safe(() => damage({ amount: num('damage'), type: el('damage-type').value }));
  el('withdraw').onclick = () => { scene.battle.retreat(scene.operator, { permanent: true }); log('测试操作 · 撤下干员'); flush(); };
  el('rebuild-view').onclick = () => { enterView(); flush(); }; el('target').onchange = updateControls;
  for (const [id, side] of [['ally-auto', 'ally'], ['enemy-auto', 'enemy']]) el(id).onchange = () => {
    if (!scene) return;
    setAutoAttack(scene, side, el(id).checked); log(`测试操作 · ${side === 'ally' ? '干员' : '敌人'}方普通攻击${el(id).checked ? '开启' : '关闭'}`); flush();
  };
  el('restart').disabled = false;
  Object.assign(debug, { advance, restart, flush }); Object.defineProperty(debug, 'paused', { get: () => paused });
  debug.ready = true; raf = requestAnimationFrame(frame);
  window.addEventListener('pagehide', (event) => { if (!event.persisted) { cancelAnimationFrame(raf); view.destroy(); scene = null; } });
} catch (error) {
  debug.error = error.message; el('error').textContent = error.message; el('state').textContent = '加载失败'; console.error(error);
}
