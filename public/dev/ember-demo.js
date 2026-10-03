import { createFieldView } from '../js/render/app.js';
import { data } from '../js/data.js';
import { assets } from '../js/assets.js';
import { loadBrowserSim } from '../js/battle/runner.js';
import { createEmberScenario, EMBER_ENEMIES } from './ember-scenario.js';

const el = (id) => document.getElementById(id);
const debug = window.__emberTest = { ready: false, error: null };
for (const [value, name] of Object.entries(EMBER_ENEMIES)) el('enemy').add(new Option(name, value));
let sim, ds, view, scene, paused = true, accumulator = 0, lastFrame = null, lastPhase;

function phase() {
  const e = scene.enemy;
  if (!e.alive) return e.removeReason === 'leak' ? '已漏过终点' : '余烬已消灭';
  return e.form === 'ember' ? '余烬' : e.form === 'normal' ? '已复活' : '本体';
}
function log(message) {
  const item = document.createElement('li');
  item.textContent = `${scene.battle.time.toFixed(2)} 秒 · ${message}`;
  el('log').prepend(item);
}
function flush() {
  const { battle: b, enemy: e, blocker } = scene;
  const ev = b.drainEvents();
  if (ev.length) view.pushEvents({ t: 'b.ev', fieldId: b.fieldId, gt: b.time, ev });
  view.pushSnapshot(b.snapshot());
  const current = phase();
  if (current !== lastPhase) { log(current); lastPhase = current; }
  el('state').textContent = `时间：${b.time.toFixed(2)} 秒${paused ? '（暂停）' : ''}\n阶段：${current}\n${e.form === 'ember' ? '剩余生命次数' : '生命'}：${Math.ceil(e.hp)} / ${Math.round(e.s.maxHp)}\n隐匿：${e.s.flags.stealth ? '是' : '否'}\n被阻挡：${e.blockedBy ? '是' : '否'}\n位置：${e.x.toFixed(2)}, ${e.y.toFixed(2)}\n实际击杀计数：${b.killed}`;
  el('knockout').disabled = !e.alive || e.form === 'ember';
  el('hit').disabled = !e.alive || e.form !== 'ember';
  el('withdraw').disabled = !blocker?.alive;
  el('pause').textContent = paused ? '开始' : '暂停';
}
function restart() {
  scene = createEmberScenario(sim, ds, { enemyKey: el('enemy').value, blocker: el('blocker').checked });
  paused = true; accumulator = 0; lastPhase = null;
  el('log').replaceChildren();
  view.setStage(data.lookup('stages', scene.spec.stageId));
  const meta = scene.battle.fieldMeta();
  view.enterBattle(meta);
  view.setCamera('normal', { rect: meta.rect, side: 'L', instant: true });
  view.setLocalFeed({ on: true, speed: 1 });
  debug.scene = scene;
  flush();
}
function advance(seconds) {
  for (let i = 0; i < Math.round(seconds * 30); i++) { scene.battle.step(); flush(); }
}
function frame(now) {
  const dt = lastFrame == null ? 0 : Math.min(.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!paused) {
    accumulator += dt;
    while (accumulator >= 1 / 30) { scene.battle.step(); accumulator -= 1 / 30; }
    flush();
  }
  requestAnimationFrame(frame);
}
try {
  await data.loadAll('chess', 'tokens', 'items', 'enemies', 'stages', 'bonds', 'config');
  await assets.ready();
  ({ spec: sim, ds } = await loadBrowserSim());
  view = await createFieldView(el('field'), { data, assets, settings: { quality: 'high', damageNumbers: true } });
  view.setBoardMode('2d');
  debug.view = view;
  restart();
  el('restart').onclick = restart;
  el('enemy').onchange = restart;
  el('blocker').onchange = restart;
  el('pause').onclick = () => { paused = !paused; accumulator = 0; flush(); };
  el('step').onclick = () => { paused = true; advance(1); };
  el('knockout').onclick = () => { scene.battle.dealDamage(null, scene.enemy, { amount: Math.ceil(scene.enemy.hp) + 1, type: 'true' }); flush(); };
  el('hit').onclick = () => { scene.battle.dealDamage(null, scene.enemy, { amount: 1, type: 'true' }); log('攻击余烬一次'); flush(); };
  el('withdraw').onclick = () => { scene.battle.retreat(scene.blocker, { permanent: true }); log('撤下角峰'); flush(); };
  for (const id of ['restart', 'pause', 'step']) el(id).disabled = false;
  debug.advance = advance;
  debug.ready = true;
  requestAnimationFrame(frame);
} catch (error) {
  debug.error = error.message;
  el('error').textContent = error.message;
  el('state').textContent = '加载失败';
  console.error(error);
}
