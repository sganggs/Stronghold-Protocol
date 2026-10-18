import { render } from '../../../vendor/preact.module.js';
import { useEffect, useRef, useState } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { initLang, useLang, LangToggle } from '../../../js/ui/lang.js';
import { data } from '../../../js/data.js';
import { t } from '../../../../shared/i18n.js';
import { LAST_SCENARIO, SCENARIO_BYTES, parseScenario, cloneScenario } from '../../../../shared/studio/scenario.js';
import { post, takeKeyFromAddress, keepStudioKey } from '../api.js';
import { errorText } from '../issues.js';
import { Editor } from './editor.js';
import { ConsoleView } from './view.js';
import { scenarioText } from './problems.js';

function describe(e) {
  // The console has its own key box. Do not reuse the plugin studio's "change a plugin" wording.
  if (e?.code === 'PLUGIN_STUDIO_KEY') return t('请输入服务器启动时显示的工作台地址或密钥。');
  if (e?.code === 'PLUGIN_STUDIO_CONSOLE_SCENARIO' || e?.params?.path || e?.path) return scenarioText(e);
  return errorText(e);
}
function download(s) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(s, null, 2) + '\n'], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'battle-scenario.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const lang = useLang();
  useEffect(() => { document.title = t('测试控制台'); }, [lang]);
  const [options, setOptions] = useState(null), [s, setScenario] = useState(null), [compiled, setCompiled] = useState(null);
  const [error, setError] = useState(''), [valid, setValid] = useState(false), [key, setKey] = useState('');
  const [side, setSide] = useState(0), [selected, setSelected] = useState(null);
  const [palette, setPalette] = useState({ kind: 'chess', chessId: 'chess_char_1_01_a', dir: 'RIGHT', items: [] });
  const [json, setJson] = useState(''), [storage, setStorage] = useState(true);
  const seq = useRef(0), file = useRef(null);
  const boot = async () => {
    setError('');
    try {
      const o = await post('console/options');
      await data.loadAll('assets', 'stages', 'chess', 'tokens', 'enemies', 'items', 'bonds', 'bands', 'backups', 'config', 'waves', 'bosses');
      let initial = o.scenario;
      try {
        const saved = localStorage.getItem(LAST_SCENARIO);
        if (saved) initial = (await post('console/build', parseScenario(saved))).scenario;
      } catch (e) { setError(describe(e)); }
      setOptions(o); setScenario(initial);
    } catch (e) { setError(describe(e)); }
  };
  useEffect(() => { boot(); }, []);
  const adopt = result => {
    setCompiled(result); setValid(true); setError(''); setJson(JSON.stringify(result.scenario, null, 2));
    try { localStorage.setItem(LAST_SCENARIO, JSON.stringify(result.scenario)); setStorage(true); } catch { setStorage(false); }
  };
  useEffect(() => {
    if (!s) return;
    const n = ++seq.current; setValid(false);
    const timer = setTimeout(() => post('console/build', s).then(result => { if (seq.current === n) adopt(result); })
      .catch(e => { if (seq.current === n) setError(describe(e)); }), 250);
    return () => { clearTimeout(timer); seq.current++; };
  }, [s]);
  const update = next => { setValid(false); setScenario(next); };
  const importText = async text => {
    // Parse and validate before replacing the current editor or last saved scenario.
    const next = parseScenario(text);
    await post('console/build', next);
    setSide(0); setSelected(null); update(next);
  };
  const restore = async () => {
    try {
      const text = localStorage.getItem(LAST_SCENARIO);
      if (!text) { setError(t('此浏览器还没有保存的场景。')); return; }
      await importText(text);
    } catch (e) { setError(describe(e)); }
  };
  const load = async e => {
    const f = e.currentTarget.files?.[0]; e.currentTarget.value = '';
    if (!f) return;
    if (f.size > SCENARIO_BYTES) { setError(t('场景文件不能超过 512 KiB。')); return; }
    try { await importText(await f.text()); } catch (e) { setError(describe(e)); }
  };
  const placeTile = tile => {
    if (!s) return;
    let { row, col } = tile, at = side;
    if (s.kind === 'boss' || s.kind === 'hidden') { at = col > 10 && s.players.length > 1 ? 1 : 0; row += 7; if (at) col = 20 - col; }
    else if (s.kind === 'unite') { at = col > 10 && s.players.length > 1 ? 1 : 0; col -= at * 8; }
    const next = cloneScenario(s), player = next.players[at];
    const uid = Math.max(0, ...next.players.flatMap(p => p.units.map(u => u.uid))) + 1;
    const { uid: _uid, row: _r, col: _c, carryState: _carry, ...choice } = palette;
    player.units.push({ ...choice, uid, row, col }); setSide(at); setSelected(uid); update(next);
  };
  return html`<div class="sc-app">
    <header class="st-top"><div class="st-top__brand"><h1>${t('测试控制台')}</h1></div><a href="/studio/">${t('插件工作台')}</a><${LangToggle} /></header>
    <main class="sc-main">
      <p>${t('独立战斗沙盒 · 非官方测试 · 不计入战绩')}</p>
      ${!options ? html`<div class="sc-key"><label>${t('工作台密钥')}<input type="password" value=${key} onInput=${e => setKey(e.currentTarget.value)} /></label><button type="button" onClick=${() => { if (keepStudioKey(key)) boot(); else setError(t('请输入服务器启动时显示的工作台地址或密钥。')); }}>${t('打开控制台')}</button></div>` : null}
      ${error ? html`<p class="sc-error" role="alert">${error}</p>` : null}
      ${options && s ? html`<div class="sc-toolbar">
        <button type="button" disabled=${!valid} onClick=${() => download(s)}>${t('下载场景 JSON')}</button>
        <button type="button" onClick=${() => file.current.click()}>${t('导入场景 JSON')}</button><input ref=${file} type="file" accept="application/json,.json" hidden onChange=${load} />
        <button type="button" onClick=${restore}>${t('打开上次场景')}</button>
        <span role="status">${valid ? t('场景已验证') : t('等待场景验证')}</span>
        ${!storage ? html`<span>${t('控制台无法记住场景，请下载场景 JSON 保存。')}</span>` : null}
      </div>
      <div class="sc-layout"><${Editor} scenario=${s} compiled=${compiled} options=${options} update=${update} palette=${palette} setPalette=${setPalette} side=${side} setSide=${setSide} selected=${selected} setSelected=${setSelected} />
        <${ConsoleView} compiled=${compiled} valid=${valid} onTile=${placeTile} onSelect=${uid => { if (uid) { const i = s.players.findIndex(p => p.units.some(u => u.uid === uid)); if (i >= 0) { setSide(i); setSelected(uid); setPalette(cloneScenario(s.players[i].units.find(u => u.uid === uid))); } } }}
          onReroll=${() => { const a = new Uint32Array(1); crypto.getRandomValues(a); update({ ...s, seed: a[0] || 1 }); }} />
      </div>
      <details><summary>${t('高级场景 JSON')}</summary><p>${t('可编辑携带生命比例、技力、补位和完整场景字段；未知字段会被拒绝。')}</p><textarea rows="20" value=${json} onInput=${e => setJson(e.currentTarget.value)} aria-label=${t('高级场景 JSON')} /><button type="button" onClick=${async () => { try { await importText(json); } catch (e) { setError(describe(e)); } }}>${t('验证并应用 JSON')}</button></details>
      <details open class="sc-support"><summary>${t('支持范围与限制')}</summary><ul>
        <li>${t('策略仅运行战斗部分；商店、资金、获取时特质、整备奖励与跨回合计数不在本沙盒内。')}</li>
        <li>${t('联防官方练习将所选回合的整波敌人视为漏怪；实际漏怪可用自定义列表重现。')}</li>
        <li>${t('领袖使用本场阵地数量对应的共享生命池；不模拟其他战场、队伍生命或超时扣血。')}</li>
        <li>${t('场地装置不支持自由搬移。魔法道具、插件脚本和任意属性改写不在本沙盒内。完整对局请用大厅的测试房间。')}</li>
        <li>${t('本工具使用测试部署数量，不限制调度中心人口。装备最多两件，召唤物仍受所属干员与位置限制。')}</li>
        <li>${t('只运行装备的战斗效果，不重放装备时消耗或变形。')}</li>
        <li>${t('官方特效需要本机素材和 3D 支持；实际启用状态显示在画面下方。')}</li>
      </ul></details>` : null}
    </main>
  </div>`;
}
await initLang().catch(() => {});
document.title = t('测试控制台');
takeKeyFromAddress();
render(html`<${App} />`, document.getElementById('app'));
