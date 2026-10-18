import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button } from '../../js/ui/components.js';
import { t } from '../../../shared/i18n.js';
import { get, post } from './api.js';
import { Select, NumberField } from './editors/controls.js';
import { IssueList, errorText } from './issues.js';
import { TrialReplay } from './preview/replay.js';
import { PluginSettings } from '../../js/ui/pluginSettings.js';
import { GAMEPLAY_TEMPLATES } from './gameplayModel.js';
import { GameplayExercise } from './gameplayTrial.js';
const outcome = value => ({ win: t('胜利'), loss: t('失败'), timeout: t('达到时限'), draw: t('平局'), left: t('左侧胜利'), right: t('右侧胜利') }[value] || value);
export function TrialBench({ state, draft }) {
  const [options, setOptions] = useState({ operators: [], waves: [], golden: [] });
  const [scenario, setScenario] = useState('dummy');
  const [operator, setOperator] = useState('');
  const [opponent, setOpponent] = useState('');
  const [wave, setWave] = useState('act1autochess_01');
  const [seconds, setSeconds] = useState(30);
  const [settings, setSettings] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [reset, setReset] = useState(0);
  const [board, setBoard] = useState('3d'), [effects, setEffects] = useState('lite');
  const [exercise, setExercise] = useState({ round: 1, at: 'prep', hook: '', actions: [], elite: false });
  const gameplay = GAMEPLAY_TEMPLATES.includes(draft?.template || state.authoring?.template);
  useEffect(() => { setExercise(v => ({ ...v, hook: '', elite: false, actions: [] })); }, [draft?.template || state.authoring?.template]);
  useEffect(() => { setResult(null); setExercise(v => ({ ...v, actions: [] })); }, [JSON.stringify(draft)]);
  useEffect(() => { let alive = true; get('trial-options').then(r => { if (alive) setOptions(r); }); return () => { alive = false; }; }, []);
  const run = async (actions = []) => {
    setBusy(true); setResult(null); setError('');
    try {
      const nextExercise = { ...exercise, actions };
      setExercise(nextExercise);
      const r = await post('trial', { id: state.id, scenario, operator: operator || undefined, opponent: opponent || undefined, wave, seconds, seed: 1, settings,
        ...(gameplay ? { exercise: nextExercise } : {}),
        ...(draft && draft.template !== 'script' ? { draft } : {}) });
      setResult(r); setPlaying(true); setReset(n => n + 1);
      if (globalThis.__studio) globalThis.__studio.trial = r;
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return html`<section class="st-trial" data-testid="trial-bench"><h3>${t('试一场')}</h3>
    <p class="st-note">${t('使用当前草稿，与原版在相同种子和场景下比较；新干员的原版对照使用所借用的官方干员。')}</p>
    <div class="st-trial-options">
      <${Select} label=${t('场景')} value=${scenario} onChange=${setScenario} options=${[
        { id:'dummy', name:t('单干员对木桩') }, { id:'wave', name:t('对一波敌人') }, { id:'duel', name:t('两名干员对打（定点攻击试验）') }, ...options.golden]} />
      ${!scenario.startsWith('golden:') ? html`<${Select} label=${t('干员')} value=${operator} onChange=${setOperator} options=${[{ id:'', name:t('优先使用插件的新干员') }, ...options.operators]} />
        <${NumberField} label=${t('时长（秒）')} value=${seconds} min=${1} max=${120} step=${1} onChange=${setSeconds} />` : null}
      ${scenario === 'duel' ? html`<${Select} label=${t('对手')} value=${opponent} onChange=${setOpponent} options=${[{ id:'', name:t('默认参考干员') }, ...options.operators]} />` : null}
      ${scenario === 'wave' ? html`<${Select} label=${t('敌人波次')} value=${wave} onChange=${setWave} options=${options.waves} />` : null}
    </div>
    ${scenario === 'duel' ? html`<p class="st-note">${t('定点对打使用普攻与技能攻击属性；只选敌人的技能效果不会把对手当敌人。这不是正式 PvP 模式。')}</p>` : null}
    <${PluginSettings} definitions=${state.manifest.settings || {}} values=${settings} onSave=${setSettings} disabled=${busy} />
    ${gameplay ? html`<${GameplayExercise} template=${draft?.template || state.authoring?.template} value=${exercise} result=${result?.exercise} busy=${busy || exercise.actions.length >= 32}
      onChange=${v => { setExercise({ ...v, actions: [] }); setResult(null); }} onAction=${action => run([...exercise.actions, action])} />` : null}
    <${Button} variant="primary" loading=${busy} disabled=${busy || state.class === 'ui'} data-testid="run-trial" onClick=${() => run()}>${t('开始对照')}<//>
    ${error ? html`<p class="st-error">${error}</p>` : null}
    ${result?.ok === false ? html`<${IssueList} issues=${result.issues} />` : null}
    ${result?.ok ? html`<div data-testid="trial-comparison"><table class="st-table"><thead><tr><th></th><th>${t('原版')}</th><th>${t('插件')}</th><th>${t('差值')}</th></tr></thead>
      <tbody><tr><th>${t('干员')}</th><td>${result.comparison.baseline}</td><td>${result.comparison.operator}</td><td></td></tr>
        <tr><th>${t('伤害')}</th><td>${Math.round(result.vanilla.damage)}</td><td>${Math.round(result.plugin.damage)}</td><td>${Math.round(result.comparison.damage)}</td></tr>
        <tr><th>${t('时长（秒）')}</th><td>${result.vanilla.result.time}</td><td>${result.plugin.result.time}</td><td>${result.comparison.duration.toFixed(3)}</td></tr>
        <tr><th>${t('结果')}</th><td>${outcome(result.vanilla.outcome)}</td><td>${outcome(result.plugin.outcome)}</td><td></td></tr></tbody></table>
      <div class="st-inline"><${Button} size="sm" onClick=${() => setPlaying(!playing)}>${playing ? t('暂停') : t('播放')}<//>
        <${Button} size="sm" data-testid="replay-trial" onClick=${() => { setReset(n => n + 1); setPlaying(true); }}>${t('重新播放')}<//>
        <${Select} label=${t('播放速度')} value=${String(speed)} options=${['0.5','1','2','4']} onChange=${v => setSpeed(Number(v))} />
        <${Select} label=${t('画面')} value=${board} options=${['3d','2d']} onChange=${setBoard} />
        <${Select} label=${t('官方特效')} value=${effects} options=${[{ id:'off', name:t('关闭') }, { id:'lite', name:t('精简') }, { id:'full', name:t('完整') }]} onChange=${setEffects} /></div>
      <div class="st-trial-pair">${['vanilla','plugin'].map(side => html`<div><h4>${side === 'vanilla' ? t('原版') : t('插件')}</h4>
        <${TrialReplay} replay=${result[side]} playing=${playing} speed=${speed} reset=${reset} board=${board} effects=${effects} />
        <details><summary>${t('事件摘要与伤害统计')}</summary><pre class="st-code">${JSON.stringify({ events: result[side].events, units: result[side].units, errors: result[side].errors }, null, 2)}</pre></details>
      </div>`)}</div>
    </div>` : null}
  </section>`;
}
