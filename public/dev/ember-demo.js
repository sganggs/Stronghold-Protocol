import { fxForm } from '../../shared/protocol.js';
import { meleeOnHighGround } from '../../shared/highGround.js';
import { t } from '../../shared/i18n.js';
import { createFieldView } from '../js/render/app.js';
import { data } from '../js/data.js';
import { assets } from '../js/assets.js';
import { initLang } from '../js/ui/lang.js';
import { loadBrowserSim } from '../js/battle/simLoader.js';
import { battleCatalog, defaultBattleConfig, enemyContext, isFrequencyTarget, filterBattleEnemies } from './battle-scenario.js';
import { createRecorder, replayScenario, dataVersion, MAX_TICKS } from './battle-replay.js';
import { installDevelopmentFrames } from './battle-frames.js';
import { translatePage } from './ember-ui.js';

const el = (id) => document.getElementById(id);
const debug = window.__battleTest = window.__emberTest = { ready: false, error: null, scene: null };
const configIds = ['operator', 'operator-variant', 'operator-elite', 'enemy', 'skill', 'module', 'potential', 'cultivate', 'stage', 'row', 'col', 'dir', 'start-row', 'start-col', 'end-row', 'end-col', 'checkpoints', 'seed', 'template-route'];
const controlIds = ['pause', 'step', 'step-frame', 'step-n', 'knockout', 'hit', 'damage-apply', 'withdraw', 'rebuild-view', 'export', 'download', 'replay'];
let sim, ds, raw, catalog, view, recorder, scene, unitInfo, TICK, version;
let paused = true, accumulator = 0, lastFrame = null, raf, stopped = false, generation = 0, fileRequest = 0;
let selectedEnemyKey = 'enemy_1288_duskls';
const lifetime = new AbortController();
const num = (id) => el(id).value.trim() === '' ? NaN : Number(el(id).value);
const logs = [];
const phaseName = (kind) => ({ husk: t('余烬/再生状态'), revived: t('已复活'), crawl: t('爬行'), grounded: t('瘫痪'),
  float: t('飞行'), echo_dark: t('暗色余音'), echo_gold: t('金色余音') })[kind] ?? kind ?? t('本体');

function renderLogs() {
  const filter = el('log-filter').value;
  el('log').replaceChildren(...logs.filter((x) => filter === 'all' || x.kind === filter).slice().reverse().map((x) => {
    const item = document.createElement('li'); item.textContent = x.text; return item;
  }));
}
function log(message, kind = 'combat') {
  logs.push({ kind, text: t('帧 {tick} · {seconds} 秒 · {message}', { tick: recorder?.tick ?? 0, seconds: (scene?.battle.time ?? 0).toFixed(3), message }) });
  if (logs.length > 200) logs.shift(); renderLogs();
}
function fail(error) {
  const message = String(error?.message ?? error);
  el('error').textContent = message; log(message, 'error'); paused = true; updateControls();
}
async function safe(fn) {
  try { el('error').textContent = ''; return await fn(); }
  catch (error) { fail(error); }
}
function selectOptions(id, items, preferred) {
  const sel = el(id), old = preferred ?? sel.value;
  sel.replaceChildren(...items.map((x) => new Option(x.label, String(x.id))));
  if (items.some((x) => String(x.id) === old)) sel.value = old;
}
function filterCatalog(kind) {
  if (kind === 'enemy') return filterEnemies();
  const query = el(`${kind}-search`).value.trim().toLowerCase();
  const list = catalog.operators;
  const selected = el(kind).value, filtered = list.filter((x) => x.search.includes(query));
  const keep = list.find((x) => x.id === selected);
  if (keep && !filtered.includes(keep)) filtered.unshift(keep);
  selectOptions(kind, filtered, selected);
}
function filterEnemies() {
  const filters = Object.fromEntries(catalog.enemyFilters.map((group) => [group.id, el(`enemy-filter-${group.id}`).value]));
  const filtered = filterBattleEnemies(catalog.enemies, filters, el('enemy-search').value);
  selectOptions('enemy', filtered, selectedEnemyKey);
  if (!filtered.some((enemy) => enemy.id === selectedEnemyKey)) {
    const placeholder = new Option(filtered.length ? t('请选择敌人') : t('没有符合条件的敌人'), '', true, true);
    placeholder.disabled = true; el('enemy').prepend(placeholder); el('enemy').value = '';
  }
  el('enemy-filter-count').textContent = t('符合条件：{n} / {total}', { n: filtered.length, total: catalog.enemies.length });
}
function clearEnemyFilters() {
  for (const group of catalog.enemyFilters) el(`enemy-filter-${group.id}`).value = '';
  el('enemy-search').value = ''; filterEnemies();
}
function operatorForms(chessId, resetVersion = false) {
  const record = chessId && raw.chess[chessId];
  const operator = catalog.operators.find((op) => op.id === el('operator').value);
  selectOptions('operator-variant', operator.variants, record?.baseId ?? (resetVersion ? operator.defaultVariant : undefined));
  el('operator-variant').closest('label').hidden = operator.variants.length < 2;
  const variant = operator.variants.find((v) => v.id === el('operator-variant').value);
  const elite = el('operator-elite');
  elite.disabled = !variant.normal || !variant.golden;
  if (elite.disabled) elite.checked = !!variant.golden;
  else if (record) elite.checked = !!record.isGolden;
}
function selectedChessId() {
  const operator = catalog.operators.find((op) => op.id === el('operator').value);
  const variant = operator.variants.find((v) => v.id === el('operator-variant').value);
  return el('operator-elite').checked ? variant.golden : variant.normal;
}
function loadouts() {
  const r = raw.chess[selectedChessId()];
  const skills = (r.skills ?? (r.skill ? [r.skill] : [])).map((s) => ({ id: s.index ?? 0,
    label: t('技能 {n} · {name} · {id}', { n: (s.index ?? 0) + 1, name: data.localeName(s.name), id: s.skillId }) }));
  selectOptions('skill', skills, String(r.skills?.find((s) => s.isDefault)?.index ?? r.skill?.index ?? 0));
  const mods = [{ id: 'none', label: t('不装备模组') }, ...(r.modules ?? []).map((m) => ({ id: m.uniEquipId, label: `${data.localeName(m.name)} · ${m.typeName} · Lv.${m.level} · ${m.uniEquipId}` }))];
  selectOptions('module', mods, r.modules?.find((m) => m.isDefault)?.uniEquipId ?? 'none');
  el('skill').disabled = !skills.length; el('module').disabled = mods.length === 1; updatePlacementInfo();
}
function updatePlacementInfo() {
  const r = raw.chess[selectedChessId()];
  const placement = r.position === 'RANGED' ? t('远程，可部署高台或允许的地面格')
    : meleeOnHighGround(r) ? t('近战，职业特性允许部署高台或地面格；高台不阻挡') : t('近战，须部署允许的地面格');
  el('loadout-info').textContent = `${r.profession} / ${data.localeName(r.subProfessionName)} · ${placement}`;
}
function readConfig() {
  const templateRoute = el('template-route').checked;
  const text = templateRoute ? '' : el('checkpoints').value.trim();
  const checkpoints = text ? text.split(/[;；\n]/).map((v) => v.trim().split(/[,，]/).map((n) => n.trim() === '' ? NaN : Number(n))) : [];
  const defaults = templateRoute ? defaultBattleConfig(raw, { chessId: selectedChessId(), enemyKey: selectedEnemyKey, stageId: el('stage').value }) : null;
  if (checkpoints.some((p) => p.length !== 2 || !p.every(Number.isInteger))) throw new Error(t('途经点格式错误，请使用 行,列; 行,列。'));
  return { chessId: selectedChessId(), enemyKey: selectedEnemyKey, stageId: el('stage').value,
    skillIndex: el('skill').value === '' ? null : Number(el('skill').value), moduleId: el('module').value,
    potential: num('potential'), cultivate: num('cultivate'), row: num('row'), col: num('col'), dir: el('dir').value, seed: num('seed'), templateRoute,
    start: defaults?.start ?? [num('start-row'), num('start-col')], end: defaults?.end ?? [num('end-row'), num('end-col')], checkpoints,
    allyAuto: el('ally-auto').checked, enemyAuto: el('enemy-auto').checked };
}
function writeConfig(c) {
  el('operator-search').value = ''; el('enemy-search').value = '';
  selectOptions('operator', catalog.operators, raw.chess[c.chessId].charId); operatorForms(c.chessId);
  selectedEnemyKey = c.enemyKey; clearEnemyFilters(); loadouts();
  for (const [id, key] of [['skill', 'skillIndex'], ['module', 'moduleId'], ['stage', 'stageId'], ['row', 'row'], ['col', 'col'], ['dir', 'dir'], ['seed', 'seed'], ['potential', 'potential'], ['cultivate', 'cultivate']]) el(id).value = c[key] ?? (id === 'module' ? 'none' : '');
  for (const [id, point] of [['start', c.start], ['end', c.end]]) { el(`${id}-row`).value = point[0]; el(`${id}-col`).value = point[1]; }
  el('checkpoints').value = c.checkpoints.map((p) => p.join(',')).join('; '); el('template-route').checked = c.templateRoute; updatePlacementInfo();
}
function setPlacementDefaults() {
  let c;
  try { c = defaultBattleConfig(raw, { chessId: selectedChessId(), enemyKey: selectedEnemyKey, stageId: el('stage').value }); }
  catch { return; }
  for (const key of ['row', 'col']) el(key).value = c[key];
  for (const [id, p] of [['start', c.start], ['end', c.end]]) { el(`${id}-row`).value = p[0]; el(`${id}-col`).value = p[1]; }
  el('checkpoints').value = ''; el('template-route').checked = c.templateRoute;
  const r = ds.getChess(c.chessId), stage = ds.getStage(c.stageId);
  const rows = c.row === 2 ? [2, 3, 4, 5] : [9, 10, 11, 12];
  const candidates = rows.flatMap((row) => Array.from({ length: 9 }, (_, i) => [row, i + 2]));
  candidates.sort((a, b) => (Math.abs(a[0] - c.row) + Math.abs(a[1] - c.col)) - (Math.abs(b[0] - c.row) + Math.abs(b[1] - c.col)));
  const probe = sim.createBattleFromSpec(sim.buildBattleSpec({ stageId: c.stageId, kind: c.row === 2 ? 'boss' : 'normal', players: [], spawns: [] }), ds, { quiet: true });
  const ranged = r.position === 'RANGED' || meleeOnHighGround(raw.chess[c.chessId]);
  const tile = candidates.find(([row, col]) => probe.grid.canStand(row, col, { ranged }) && !(stage.devices ?? []).some((d) => !d.hidden && d.row === row && d.col === col && /crate/.test(d.key)));
  if (tile) { el('row').value = tile[0]; el('col').value = tile[1]; }
}
function summarizeUnit(u, title) {
  if (!u) return t('{title}：未部署', { title });
  // Inspect already-computed stats; never cause a lazy stat recalculation from a status panel.
  const stats = u._s ?? u.base, flags = Object.entries(stats.flags ?? {}).filter(([, on]) => on).map(([key]) => key).join(', ') || '—';
  const phase = !u.alive ? (u.removeReason === 'leak' ? t('漏怪') : u.removed ? t('已撤下/退场') : t('死亡')) : phaseName(u.form ?? scene.phases.get(u.id) ?? u.mem.ab?.form);
  const sk = u.skill, meter = u.mem.ab?.skillSp?.();
  const hits = (u.mem.ab?.hitShield ?? 0) + (u.mem.ab?.frequencyShield?.() ?? 0) + u.buffs.reduce((n, b) => n + (b.shieldHits ?? 0), 0);
  const shield = (u.mem.ab?.damageShield?.() ?? 0) + u.buffs.reduce((n, b) => n + (b.shield ?? 0), 0);
  const sp = sk && !sk.noSkill ? `${sk.sp.toFixed(2)} / ${sk.spCost} · ${sk.charges} · ${sk.active ? t('技能中') : t('未开启')}`
    : meter ? `${meter.value.toFixed(2)} / ${Number.isFinite(meter.max) ? meter.max : '∞'}` : '—';
  const cooldowns = u.mem.ab?.list.filter((a) => a.cd != null).map((a) => `${Math.max(0, a.left).toFixed(2)}s`).join(' / ') || '—';
  const blocking = u.side === 'enemy' ? (u.blockedBy ? `#${u.blockedBy.id} ${data.localeName(u.blockedBy.name)}` : '—')
    : u.blocking.map((e) => `#${e.id} ${data.localeName(e.name)}`).join(', ') || '—';
  return t('{title}：{name} (#{id})\nHP：{hp} / {maxHp} · 护盾：{shield} · 频次护盾：{hits}\nSP：{sp} · 敌人技能冷却：{cooldowns}\n位置：行 {row}，列 {col}\n阶段：{phase} · 状态：{flags}\n阻挡：{blocking}',
    { title, name: data.localeName(u.name), id: u.id, hp: u.hp.toFixed(2), maxHp: stats.maxHp.toFixed(2), shield: shield.toFixed(2), hits, sp, cooldowns, row: u.y.toFixed(2), col: u.x.toFixed(2), phase, flags, blocking });
}
function damageTarget() {
  return el('target').value === 'operator' ? scene.operator : scene.battle.units.find((u) => u.id === Number(el('target').value)) ?? scene.enemy;
}
function updateControls() {
  for (const id of controlIds) el(id).disabled = !scene;
  if (!scene) return;
  const b = scene.battle, target = damageTarget(), ended = b.finished || recorder.tick >= MAX_TICKS;
  for (const id of ['pause', 'step', 'step-frame', 'step-n']) el(id).disabled = ended;
  el('pause').textContent = paused ? t('开始') : t('暂停');
  for (const id of ['knockout', 'damage-apply']) el(id).disabled = ended || !target?.alive;
  el('hit').disabled = ended || !target?.alive || !isFrequencyTarget(target);
  el('withdraw').disabled = !scene.operator.alive || scene.operator.removed;
  el('ally-auto').checked = scene.config.allyAuto; el('enemy-auto').checked = scene.config.enemyAuto;
}
function consumeEvents(s, ev, logEvents = true) {
  for (const e of ev) {
    if (e[0] === 'fx' && e[4]?.id != null && (fxForm(e) !== undefined || ['phase', 'grow', 'revive'].includes(e[1]))) {
      const kind = fxForm(e) ?? e[4].kind ?? (e[1] === 'grow' ? `grow:${e[4].stage + 1}` : 'revived'); s.phases.set(e[4].id, kind);
      if (logEvents) log(t('单位 #{id}：{phase}', { id: e[4].id, phase: phaseName(kind) }), 'phase');
    } else if (logEvents && ['die', 'leak', 'skill', 'retreat', 'block', 'unblock'].includes(e[0])) log(`${e[0]} · ${JSON.stringify(e.slice(1))}`);
  }
}
function flush() {
  if (!scene || stopped) return;
  const b = scene.battle, ev = b.drainEvents(); consumeEvents(scene, ev); view.presentLocalFrame(b.snapshot(), ev);
  if (b.finished || recorder.tick >= MAX_TICKS) paused = true;
  selectOptions('target', [{ id: 'enemy', label: t('所选敌人') + ' · ' + data.localeName(scene.enemy.name) }, { id: 'operator', label: t('干员') + ' · ' + data.localeName(scene.operator.name) },
    ...b.units.filter((u) => u.side === 'enemy' && u !== scene.enemy).map((u) => ({ id: u.id, label: `${data.localeName(u.name)} (#${u.id})` }))]);
  el('state').textContent = t('帧 {tick} · {seconds} 秒 · {status} · seed {seed}\n击杀：{killed} / {total} · 漏怪：{leaks}',
    { tick: recorder.tick, seconds: b.time.toFixed(3), status: paused ? t('暂停') : t('运行'), seed: b.seed, killed: b.killed, total: b.total, leaks: b.leakedCount })
    + (b.sharedBoss ? '\n' + t('共享生命池：{hp} / {max}', { hp: b.sharedBoss.hp.toFixed(2), max: b.sharedBoss.maxHp.toFixed(2) }) : '')
    + (b.finished ? '\n' + t('战斗结束：{reason}', { reason: b.reason }) : '')
    + '\n\n' + [scene.operator, ...b.units.filter((u) => u.side === 'enemy')].map((u) => summarizeUnit(u, u === scene.operator ? t('干员') : u === scene.enemy ? t('所选敌人') : t('关联单位'))).join('\n\n');
  if (b.errorCount) {
    el('error').textContent = t('模拟器报告 {n} 个错误：{errors}', { n: b.errorCount, errors: JSON.stringify(b.errors) });
    if (scene.loggedErrors !== b.errorCount) { scene.loggedErrors = b.errorCount; log(el('error').textContent, 'error'); } paused = true;
  }
  updateControls();
}
function enterView() {
  const b = scene.battle, meta = b.fieldMeta(), ids = new Set(meta.units.map((u) => u.id));
  for (const [id] of b.snapshot().units) if (!ids.has(id)) { const u = b.units.find((u) => u.id === id); if (u) meta.units.push(unitInfo(u)); }
  for (const info of meta.units) if (scene.phases.has(info.id) && !info.form) info.form = scene.phases.get(info.id);
  view.setStage(data.lookup('stages', scene.spec.stageId)); view.enterBattle(meta);
  view.setCamera(scene.context.boss ? 'boss' : 'normal', { rect: meta.rect, side: 'L', instant: true }); view.presentLocalFrame(b.snapshot());
}
function checkModels() {
  const activeScene = scene, gen = generation; el('models').textContent = t('正在检查模型；模拟状态可继续查看。');
  Promise.all(scene.battle.units.filter((u) => u.kind !== 'device').map(async (u) => {
    const entry = assets.spineEntry(u.def.spine);
    if (!entry) return t('{name}：素材索引缺少模型 {id}；可继续查看模拟状态。', { name: data.localeName(u.name), id: u.def.spine });
    try { await assets.spine.acquire(entry); return null; }
    catch (error) { return t('{name}：模型加载失败（{error}）；可继续查看模拟状态。', { name: data.localeName(u.name), error: error.message }); }
    finally { assets.spine.release(entry); }
  })).then((messages) => { if (!stopped && scene === activeScene && generation === gen) el('models').textContent = messages.filter(Boolean).join('\n') || t('当前单位使用真实 Spine 模型。'); })
    .catch((error) => { if (!stopped && generation === gen) fail(error); });
}
function adopt(next, warnings = []) {
  generation++; paused = true; accumulator = 0; lastFrame = null; recorder = next; scene = recorder.scene; debug.scene = scene;
  logs.length = 0; renderLogs(); el('error').textContent = ''; el('version-warning').textContent = warnings.join('\n');
  el('context').textContent = scene.context.notes.join('\n') || t('普通场景：一名干员、一只敌人。地图装置按原有规则运行。');
  for (const id of ['start-row', 'start-col', 'end-row', 'end-col', 'checkpoints']) el(id).disabled = scene.config.templateRoute;
  enterView(); flush(); checkModels();
}
function restart() {
  generation++; paused = true; accumulator = 0; lastFrame = null; scene = null; recorder = null; debug.scene = null; logs.length = 0; renderLogs();
  for (const id of ['models', 'context', 'version-warning', 'error']) el(id).textContent = '';
  view.enterBattle({ fieldId: 'n:dev', units: [] });
  try { adopt(createRecorder(sim, ds, raw, readConfig(), version)); }
  catch (error) { fail(error); el('state').textContent = t('配置无效，场景已停止。修改配置后会重新建立。'); }
  updateControls();
}
function advanceFrames(n) {
  if (!scene) return;
  if (!Number.isInteger(n) || n < 1 || n > MAX_TICKS) throw new Error(t('帧数须为 1～18000 的整数。'));
  paused = true; accumulator = 0; lastFrame = null;
  for (let i = 0; i < n && recorder.step(); i++) flush(); flush();
}
function advance(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_TICKS * TICK) throw new Error(t('无效推进秒数。'));
  if (seconds > 0) advanceFrames(Math.round(seconds / TICK));
}
function frame(now) {
  if (stopped) return;
  const dt = lastFrame == null ? 0 : Math.min(.1, (now - lastFrame) / 1000); lastFrame = now;
  try {
    if (scene && !paused) {
      accumulator += dt * num('speed');
      while (accumulator >= TICK && !paused) {
        if (!recorder.step()) { paused = true; break; } accumulator -= TICK; flush();
      }
      if (paused) flush();
    }
  } catch (error) { fail(error); }
  raf = requestAnimationFrame(frame);
}
function perform(params) {
  const op = recorder.perform(params); log(t('测试操作 · {operation}', { operation: JSON.stringify(op) }), 'operation'); flush();
}
function damage(options = {}) {
  perform({ type: 'damage', targetId: damageTarget().id, amount: options.amount ?? 1,
    damageType: options.type ?? 'true', lethal: !!options.lethal, hit: !!options.hit });
}
function exportJSON() { const text = JSON.stringify(recorder.export(), null, 2); el('scene-json').value = text; return text; }
function importJSON(input) {
  const { recorder: next, warnings } = replayScenario(sim, ds, raw, input, version, (r) => consumeEvents(r.scene, r.scene.battle.drainEvents(), false));
  writeConfig({ ...next.export().config, seed: next.export().seed }); adopt(next, warnings);
  log(t('重放完成：{ticks} 帧，{n} 条操作。', { ticks: next.tick, n: next.operations.length }), 'operation');
}
function destroy() {
  if (stopped) return; stopped = true; generation++; paused = true; cancelAnimationFrame(raf); lifetime.abort(); view?.destroy(); scene = null; recorder = null; debug.scene = null;
}
try {
  translatePage(); await initLang(); translatePage();
  await data.loadAll('chess', 'tokens', 'items', 'enemies', 'stages', 'bonds', 'config', 'bosses', 'waves');
  await assets.ready(); ({ spec: sim, ds, raw } = await loadBrowserSim());
  ({ unitInfo } = await import('/sim/snapshot.js')); ({ TICK } = await import('/sim/constants.js'));
  raw = { ...raw, bosses: data.getRaw('bosses'), config: data.getRaw('config') };
  if (!raw.bosses || !raw.config) throw new Error(t('领袖或配置数据加载失败，不能保证特殊场景完整。'));
  version = dataVersion(raw); catalog = battleCatalog(raw, data.localeName.bind(data)); debug.catalog = catalog;
  selectOptions('operator', catalog.operators, raw.chess.chess_char_1_02_a.charId); operatorForms('chess_char_1_02_a');
  for (const group of catalog.enemyFilters) selectOptions(`enemy-filter-${group.id}`, [{ id: '', label: t('全部') }, ...group.options], '');
  filterEnemies(); selectOptions('stage', catalog.stages, 'act2autochess_m02'); loadouts(); setPlacementDefaults();
  view = await createFieldView(el('field'), { data, assets, signal: lifetime.signal, developmentFrames: installDevelopmentFrames, settings: { quality: 'high', damageNumbers: true } });
  await view.setBoardMode('2d'); debug.view = view; restart();
  const bind = (id, event, fn) => el(id).addEventListener(event, () => safe(fn), { signal: lifetime.signal });
  for (const id of configIds) bind(id, 'change', () => {
    if (['operator', 'operator-variant'].includes(id)) operatorForms(undefined, id === 'operator');
    if (['operator', 'operator-variant', 'operator-elite'].includes(id)) loadouts(); if (id === 'module') updatePlacementInfo();
    if (id === 'enemy') {
      if (!el('enemy').value) return;
      selectedEnemyKey = el('enemy').value;
      try { if (enemyContext(raw, selectedEnemyKey).terrain) el('stage').value = defaultBattleConfig(raw, { enemyKey: selectedEnemyKey }).stageId; }
      catch { /* restart reports the concrete error */ }
    }
    if (['operator', 'operator-variant', 'operator-elite', 'enemy', 'stage'].includes(id)) setPlacementDefaults(); restart();
  });
  for (const kind of ['operator', 'enemy']) bind(`${kind}-search`, 'input', () => filterCatalog(kind));
  for (const group of catalog.enemyFilters) bind(`enemy-filter-${group.id}`, 'change', filterEnemies);
  bind('enemy-filter-clear', 'click', clearEnemyFilters);
  bind('restart', 'click', restart); bind('pause', 'click', () => { paused = !paused; accumulator = 0; lastFrame = null; flush(); });
  bind('step', 'click', () => advance(1)); bind('step-frame', 'click', () => advanceFrames(1)); bind('step-n', 'click', () => advanceFrames(num('frame-count')));
  bind('knockout', 'click', () => damage({ lethal: true })); bind('hit', 'click', () => damage({ hit: true }));
  bind('damage-apply', 'click', () => damage({ amount: num('damage'), type: el('damage-type').value }));
  bind('withdraw', 'click', () => perform({ type: 'retreat', targetId: scene.operator.id }));
  bind('rebuild-view', 'click', () => { enterView(); flush(); }); bind('target', 'change', updateControls);
  for (const [id, side] of [['ally-auto', 'ally'], ['enemy-auto', 'enemy']]) bind(id, 'change', () => { if (scene) perform({ type: 'autoAttack', side, enabled: el(id).checked }); });
  bind('export', 'click', exportJSON);
  bind('download', 'click', () => {
    const url = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = 'battle-scene.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  bind('import', 'click', () => importJSON(el('scene-json').value)); bind('replay', 'click', () => importJSON(exportJSON()));
  bind('scene-file', 'change', async () => {
    const request = ++fileRequest, gen = generation;
    const current = () => !stopped && request === fileRequest && gen === generation;
    const file = el('scene-file').files[0]; if (!file) return; if (file.size > 2e6) throw new Error(t('场景 JSON 超过 2 MB。'));
    let text;
    try { text = await file.text(); }
    catch (error) { if (current()) throw error; return; }
    if (!current()) return;
    el('scene-json').value = text; importJSON(text);
  });
  bind('log-filter', 'change', renderLogs);
  bind('copy-log', 'click', async () => { const filter = el('log-filter').value; await navigator.clipboard.writeText(logs.filter((x) => filter === 'all' || x.kind === filter).map((x) => x.text).join('\n')); });
  el('restart').disabled = false; el('import').disabled = false;
  Object.assign(debug, { advance, advanceFrames, restart, flush, exportJSON, importJSON, destroy, logs });
  Object.defineProperties(debug, { paused: { get: () => paused }, recorder: { get: () => recorder } });
  debug.ready = true; raf = requestAnimationFrame(frame);
  window.addEventListener('pagehide', (event) => { if (!event.persisted) destroy(); }, { signal: lifetime.signal });
  window.addEventListener('error', (event) => fail(event.error ?? event.message), { signal: lifetime.signal });
  window.addEventListener('unhandledrejection', (event) => fail(event.reason), { signal: lifetime.signal });
} catch (error) {
  debug.error = error.message; el('error').textContent = error.message; el('state').textContent = t('加载失败'); view?.destroy(); console.error(error);
}
