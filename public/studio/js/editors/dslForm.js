// A structured DSL editor. The spec remains data; every edit is checked by the server's validateDsl.
import { useEffect, useState } from '../../../vendor/hooks.module.js';
import { html, Button } from '../../../js/ui/components.js';
import { data } from '../../../js/data.js';
import { t, N_ } from '../../../../shared/i18n.js';
import { MODS_SCHEMA } from '../../../../shared/plugins/skillSpec.js';
import { get, post } from '../api.js';
import { IssueList } from '../issues.js';
import { RecordPicker } from './gameplayControls.js';
import { Select, NumberField, fieldLabel, without } from './controls.js';

const WORDS = {
  deploy: N_('部署时'), battleStart: N_('战斗开始时'), attack: N_('攻击时'), hitDealt: N_('造成伤害时'), hitTaken: N_('受到攻击时'),
  kill: N_('击倒敌人时'), allyDeath: N_('友方倒下时'), skillStart: N_('技能开始时'), skillEnd: N_('技能结束时'), every: N_('每隔一段时间'), hpBelow: N_('生命跌破阈值时'), always: N_('首次上场时'),
  roundStart: N_('回合开始时'), income: N_('获得收入时'), buy: N_('购买时'), sell: N_('出售时'), refresh: N_('刷新时'), merge: N_('合成时'), levelUp: N_('升级时'), battleResult: N_('战斗结算时'),
  buff: N_('增加属性'), status: N_('施加状态'), damage: N_('造成伤害'), heal: N_('治疗'), sp: N_('回复技力'), dp: N_('增加部署费用'),
  push: N_('推开'), pull: N_('拉近'), spawnToken: N_('召唤单位'), layers: N_('增加盟约层数'), shield: N_('添加护盾'), fx: N_('播放特效'),
  funds: N_('改变资金'), gainItem: N_('获得道具'), self: N_('自身'), target: N_('当前目标'), source: N_('事件来源'),
  alliesInRange: N_('范围内友方'), enemiesInRange: N_('范围内敌人'), enemiesInRadius: N_('圆形范围内敌人'), lowestHpAlly: N_('生命最低的友方'), allAllies: N_('所有己方单位'),
  chance: N_('触发概率'), selfHpBelow: N_('自身生命比例低于'), targetHas: N_('目标拥有状态'), bondActive: N_('盟约已激活'), skillActive: N_('技能正在开启'), round: N_('指定回合'),
};
const BATTLE_TRIGGERS = ['always','deploy','battleStart','attack','hitDealt','hitTaken','kill','allyDeath','skillStart','skillEnd','every','hpBelow'];
const META_TRIGGERS = ['roundStart','income','buy','sell','refresh','merge','levelUp','battleResult'];
const TARGETS = ['self','target','source','alliesInRange','enemiesInRange','enemiesInRadius','lowestHpAlly','allAllies'];
const ACTIONS = ['buff','status','damage','heal','sp','dp','push','pull','spawnToken','layers','shield','fx'];
const labels = xs => xs.map(id => ({ id, name: WORDS[id] ? t(WORDS[id]) : id }));
const bool = (label, checked, onChange) => html`<label class="st-check"><input type="checkbox" checked=${!!checked} onChange=${e => onChange(e.currentTarget.checked)} />${label}</label>`;
const listOptions = table => Object.entries(data.get(table) || {}).map(([id, r]) => ({ id, name: r.name || id }));
const changedAt = (list, i, value) => list.map((v, n) => n === i ? value : v);
const removeButton = fn => html`<button type="button" class="st-link-btn is-danger" onClick=${fn}>${t('删除')}</button>`;

function Value({ value = 0, onChange, source, depth = 0, max = 1e9 }) {
  const kind = value && typeof value === 'object' ? Object.keys(value).find(k => !['default','of'].includes(k)) || 'number' : 'number';
  const bb = Object.keys(source?.skill?.bb || { atk: 0.5 });
  const trait = Object.keys(source?.trait?.bb || { atk: 0.5 });
  const defaults = { number: 1, bb: { bb: bb[0] || 'atk' }, talent: { talent: [0, Object.keys(source?.talents?.[0]?.bb || {})[0] || 'atk'] }, trait: { trait: trait[0] || 'atk' }, stat: { stat: 'atk', of: 'self' }, batMod: { batMod: { bb: 'base_attack_time' } } };
  const select = k => onChange(defaults[k] ?? { [k]: [1, 1] });
  const kinds = ['number','bb','talent','trait','stat', ...(depth < 6 ? ['batMod','mul','add','sub','div','min','max'] : [])];
  return html`<div class="st-value">
    <${Select} label=${t('取值')} value=${kind} options=${kinds} onChange=${select} />
    ${kind === 'number' ? html`<${NumberField} label=${t('数值')} min=${-max} max=${max} value=${typeof value === 'number' ? value : null} onChange=${onChange} />` : null}
    ${kind === 'bb' || kind === 'trait' ? html`<${Select} label=${t('黑板字段')} value=${value[kind]} options=${[...new Set([value[kind], ...(kind === 'bb' ? bb : trait)])]} onChange=${k => onChange({ ...value, [kind]: k })} />` : null}
    ${kind === 'talent' ? html`<${NumberField} label=${t('天赋序号')} min=${0} max=${20} step=${1} value=${value.talent[0]} onChange=${n => onChange({ talent: [n, value.talent[1]] })} />
      <${Select} label=${t('黑板字段')} value=${value.talent[1]} options=${[...new Set([value.talent[1], ...Object.keys(source?.talents?.[value.talent[0]]?.bb || {})])]} onChange=${key => onChange({ talent: [value.talent[0], key] })} />` : null}
    ${kind === 'stat' ? html`<${Select} label=${t('属性')} value=${value.stat} options=${['atk','maxHp','hp','def','res'].map(id => ({ id, name: fieldLabel(id) }))} onChange=${stat => onChange({ ...value, stat })} />
      <${Select} label=${t('目标')} value=${value.of || 'self'} options=${labels(['self','target','source','lastSpawn'])} onChange=${of => onChange({ ...value, of })} />` : null}
    ${kind === 'batMod' ? html`<${Value} value=${value.batMod} onChange=${v => onChange({ batMod: v })} source=${source} depth=${depth + 1} />` : null}
    ${['mul','add','sub','div','min','max'].includes(kind) ? html`<div class="st-value__operands">${value[kind].map((v, i) => html`<div><${Value} value=${v} source=${source} depth=${depth + 1} onChange=${v => onChange({ [kind]: changedAt(value[kind], i, v) })} />
      ${value[kind].length > 1 ? removeButton(() => onChange({ [kind]: value[kind].filter((_, n) => n !== i) })) : null}</div>`)}
      ${value[kind].length < 8 ? html`<button type="button" class="st-link-btn" onClick=${() => onChange({ [kind]: [...value[kind], 1] })}>${t('添加取值')}</button>` : null}</div>` : null}
  </div>`;
}
let boundsRequest;
function Mods({ value = {}, onChange, source }) {
  const [add, setAdd] = useState('atkPct');
  const [bounds, setBounds] = useState({});
  useEffect(() => {
    let live = true;
    boundsRequest ||= get('authoring?template=trait').catch(e => { boundsRequest = null; throw e; });
    boundsRequest.then(r => { if (live) setBounds(r.dslBounds || {}); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return html`<div class="st-dsl-mods">${Object.entries(value).map(([k, v]) => html`<div><strong>${fieldLabel(k)}</strong><${Value} value=${v} max=${bounds[k] ?? 1e9} source=${source} onChange=${v => onChange({ ...value, [k]: v })} />${removeButton(() => onChange(without(value, k)))}</div>`)}
    <${Select} label=${t('属性')} value=${add} options=${Object.keys(MODS_SCHEMA.properties).map(id => ({ id, name: fieldLabel(id) }))} onChange=${setAdd} />
    <button type="button" class="st-link-btn" onClick=${() => onChange({ ...value, [add]: value[add] ?? 0.5 })}>${t('添加属性')}</button>
  </div>`;
}
function Target({ value = 'self', onChange, source }) {
  const radius = typeof value === 'object';
  return html`<div><${Select} label=${t('目标')} value=${radius ? 'enemiesInRadius' : value} options=${labels(TARGETS)} onChange=${v => onChange(v === 'enemiesInRadius' ? { enemiesInRadius: 1.5 } : v)} />
    ${radius ? html`<${Value} value=${value.enemiesInRadius} source=${source} onChange=${v => onChange({ ...value, enemiesInRadius: v })} />
      <${Select} label=${t('中心')} value=${value.at || 'self'} options=${labels(['self','target','source','lastSpawn'])} onChange=${at => onChange({ ...value, at })} />
      <${Select} label=${t('范围形状')} value=${value.shape || 'radius'} options=${['radius','chebyshev']} onChange=${shape => onChange({ ...value, shape })} />
      ${bool(t('包含隐匿单位'), value.includeStealth, includeStealth => onChange({ ...value, includeStealth }))}` : null}
  </div>`;
}
function Conditions({ value = {}, meta, onChange, source, burst = false, localBond = null }) {
  const choices = (meta ? ['round','chance','bondActive'] : ['chance','targetHas','selfHpBelow','enemiesInRange','bondActive','skillActive', ...(burst ? ['element', 'targetOnField', 'selfOnField'] : [])])
    .filter(k => !localBond || k !== 'bondActive'); // bond templates already own this guard
  const [add, setAdd] = useState(choices[0]);
  const set = (k, v) => onChange({ ...value, [k]: v });
  return html`<details open=${Object.keys(value).length > 0}><summary>${t('条件（全部满足）')}</summary>
    ${Object.entries(value).map(([k, v]) => html`<div class="st-dsl-condition"><strong>${labels([k])[0].name}</strong>
      ${k === 'bondActive' ? html`<${RecordPicker} kind="bond" label=${t('盟约')} value=${typeof v === 'string' ? v : v.id} onChange=${id => set(k, { id, tier: v.tier || 1 })} />
        <${NumberField} label=${t('层级')} value=${v.tier || 1} min=${1} onChange=${tier => set(k, { id: typeof v === 'string' ? v : v.id, tier })} />`
        : k === 'targetHas' ? html`<${Select} label=${t('状态')} value=${v} options=${['stun','cold','freeze','sleep','stealth','disarm','silence']} onChange=${v => set(k, v)} />`
        : k === 'element' ? html`<${Select} label=${t('元素')} value=${v} options=${['neural', 'erosion', 'burn', 'necrosis', 'apoptosis']} onChange=${v => set(k, v)} />`
        : ['targetOnField', 'selfOnField'].includes(k) ? bool(k, v, v => set(k, v))
        : k === 'skillActive' ? bool(t('技能正在开启'), v === true, v => set(k, v))
        : k === 'round' ? html`<${NumberField} label=${t('回合')} value=${v} step=${1} min=${1} onChange=${v => set(k, v)} />`
        : html`<${Value} value=${v} source=${source} onChange=${v => set(k, v)} />`}
      ${removeButton(() => onChange(without(value, k)))}</div>`)}
    <${Select} label=${t('条件')} value=${add} options=${labels(choices)} onChange=${setAdd} />
    <button type="button" class="st-link-btn" onClick=${() => set(add, add === 'bondActive' ? { id: listOptions('bonds')[0]?.id, tier: 1 } : add === 'targetHas' ? 'stun' : ['skillActive', 'targetOnField', 'selfOnField'].includes(add) ? true : add === 'element' ? 'neural' : 1)}>${t('添加条件')}</button>
  </details>`;
}
const actionDefault = verb => verb === 'buff' ? { mods: { atkPct: 0.5 } } : verb === 'status' ? { key: 'stun', duration: 1 } : verb === 'spawnToken'
  ? { token: listOptions('tokens')[0]?.id || '', tile: 'around' } : verb === 'fx' ? { kind: 'aoe', radius: 1.5 } : verb === 'layers'
    ? { bond: listOptions('bonds')[0]?.id || '', amount: 1 } : verb === 'gainItem' ? { item: listOptions('items')[0]?.id || '' }
      : ['push','pull'].includes(verb) ? { force: 1 } : { amount: 1, ...(['damage','heal'].includes(verb) ? { target: 'target' } : {}) };
function Actions({ value = [], onChange, source, meta = false, trait = false, localBond = null, depth = 0 }) {
  const choices = meta ? ['funds','layers','gainItem'] : ACTIONS;
  const [add, setAdd] = useState(choices[0]);
  return html`<div class="st-dsl-actions">
    ${value.map((node, i) => {
      const verb = choices.find(k => k in node);
      if (!verb) return html`<p class="st-error">${t('请检查格式')}</p>`;
      const body = node[verb];
      const setBody = next => onChange(changedAt(value, i, { ...node, [verb]: next }));
      const set = (key, v) => setBody({ ...body, [key]: v });
      const nums = { damage: ['amount'], heal: ['amount'], sp: ['amount'], dp: ['amount'], shield: ['amount','duration'], layers: ['amount'], status: ['duration'], buff: ['duration'], push: ['force'], pull: ['force'], spawnToken: ['duration'], fx: ['radius','dur'], funds: ['amount'] }[verb] || [];
      const chain = node.then || body.then || [];
      return html`<fieldset class="st-dsl-action"><legend>${labels([verb])[0].name}</legend>
        <${Select} label=${t('动作')} value=${verb} options=${labels(choices)} onChange=${v => onChange(changedAt(value, i, { [v]: actionDefault(v) }))} />
        ${!meta && !['fx','dp','layers','spawnToken'].includes(verb) ? html`<${Target} value=${body.target || 'self'} source=${source} onChange=${v => set('target', v)} />` : null}
        ${verb === 'buff' ? html`<${Mods} value=${body.mods} source=${source} onChange=${v => set('mods', v)} />` : null}
        ${nums.map(key => html`<div><label class="st-check"><input type="checkbox" checked=${key in body} onChange=${e => setBody(e.currentTarget.checked ? { ...body, [key]: 1 } : without(body, key))} />${key}</label>
          ${key in body ? trait && verb === 'layers' && !meta && (body.maxPerBattle !== undefined || body.bond === 'selfActive')
            ? html`<${NumberField} label=${t('数量')} value=${body[key]} min=${1} max=${1000000} step=${1} onChange=${v => set(key, v)} />`
            : html`<${Value} value=${body[key]} source=${source} onChange=${v => set(key, v)} />` : null}</div>`)}
        ${verb === 'damage' ? html`<${Select} label=${t('伤害类型')} value=${body.type || 'phys'} options=${['phys','arts','true']} onChange=${v => set('type', v)} />
          <${NumberField} label=${t('重复次数')} value=${body.times || 1} min=${1} max=${8} step=${1} onChange=${v => set('times', v)} />
          ${bool(t('生命流失'), body.lose, v => set('lose', v))}${bool(t('技能伤害'), body.isSkill, v => set('isSkill', v))}` : null}
        ${verb === 'status' ? html`<${Select} label=${t('状态')} value=${body.key} options=${['stun','cold','freeze','sleep','stealth','disarm','silence']} onChange=${v => set('key', v)} />` : null}
        ${verb === 'layers' || verb === 'gainItem' ? html`<${RecordPicker} kind=${verb === 'layers' ? 'bond' : 'item'} localBond=${verb === 'layers' ? localBond : null} label=${verb === 'layers' ? t('盟约') : t('道具')} value=${body.bond || body.item} onChange=${v => set(verb === 'layers' ? 'bond' : 'item', v)} />` : null}
        ${trait && verb === 'layers' && !meta ? html`${bool(t('自身激活的盟约'), body.bond === 'selfActive', on => set('bond', on ? 'selfActive' : listOptions('bonds')[0]?.id || ''))}
          ${bool(t('每场上限'), body.maxPerBattle !== undefined, on => setBody(on ? { ...body, maxPerBattle: 1 } : without(body, 'maxPerBattle')))}
          ${body.maxPerBattle !== undefined ? html`<${NumberField} label=${t('每场上限')} value=${body.maxPerBattle} min=${1} max=${1000000} step=${1} onChange=${v => set('maxPerBattle', v)} />` : null}` : null}
        ${trait && verb === 'gainItem' ? html`<${NumberField} label=${t('数量')} value=${body.count ?? 1} min=${1} max=${64} step=${1} onChange=${v => set('count', v)} />` : null}
        ${verb === 'funds' ? bool(t('直接设置本次收入'), body.setIncome, v => set('setIncome', v)) : null}
        ${verb === 'spawnToken' ? html`<${Select} label=${t('召唤物')} value=${typeof body.token === 'string' ? body.token : body.token?.fallback || ''} options=${listOptions('tokens')} onChange=${v => set('token', v)} />` : null}
        ${verb === 'fx' ? html`<${Select} label=${t('特效')} value=${body.kind} options=${['aoe','dp','summon','heal','shield']} onChange=${v => set('kind', v)} />` : null}
        ${!meta && depth < 4 ? html`<details open=${chain.length > 0}><summary>${t('然后执行')}</summary><${Actions} value=${chain} source=${source} trait=${trait} localBond=${localBond} depth=${depth + 1}
          onChange=${then => onChange(changedAt(value, i, { [verb]: without(body, 'then'), then }))} /></details>` : null}
        ${removeButton(() => onChange(value.filter((_, n) => n !== i)))}
      </fieldset>`;
    })}
    <div class="st-inline"><${Select} label=${t('动作')} value=${add} options=${labels(choices)} onChange=${setAdd} />
      <button type="button" class="st-link-btn" disabled=${value.length >= 32} onClick=${() => onChange([...value, { [add]: actionDefault(add) }])}>${t('添加动作')}</button></div>
  </div>`;
}
export function DslRules({ value = [], onChange, source, meta = false, trait = false, localBond = null }) {
  return html`<div>${value.map((rule, i) => {
    const change = patch => onChange(changedAt(value, i, { ...rule, ...patch }));
    return html`<fieldset class="st-dsl-rule"><${Select} label=${t('触发器')} value=${rule.when} options=${labels(meta ? trait ? ['gain','deploy','roundStart','buy','sell','merge','levelUp','battleResult'] : META_TRIGGERS : [...BATTLE_TRIGGERS, ...(trait ? ['elementBurst'] : [])])} onChange=${when => change({ when, ...(when === 'every' ? { seconds: 1 } : when === 'hpBelow' ? { below: 0.5 } : {}) })} />
      ${rule.when === 'every' ? html`<${NumberField} label=${t('间隔（秒）')} value=${rule.seconds} min=${1 / 30} onChange=${seconds => change({ seconds })} />` : null}
      ${rule.when === 'hpBelow' ? html`<${NumberField} label=${t('生命比例')} value=${rule.below} min=${0.001} max=${1} onChange=${below => change({ below })} />` : null}
      ${!meta ? html`<${NumberField} label=${t('冷却（秒）')} value=${rule.cooldown || 0} min=${0} onChange=${cooldown => change({ cooldown })} />` : null}
      <${Conditions} value=${rule.if} source=${source} meta=${meta} localBond=${localBond} burst=${trait && rule.when === 'elementBurst'} onChange=${v => change({ if: v })} />
      <${Actions} value=${rule.do} source=${source} meta=${meta} trait=${trait} localBond=${localBond} onChange=${v => change({ do: v })} />
      ${removeButton(() => onChange(value.filter((_, n) => n !== i)))}
    </fieldset>`;
  })}<${Button} size="sm" disabled=${value.length >= 32} onClick=${() => onChange([...value, { when: meta ? 'roundStart' : 'deploy', do: [] }])}>${t('添加触发规则')}<//></div>`;
}
export function DslForm({ id, spec, onChange, source, meta = false }) {
  const [validation, setValidation] = useState(null);
  const signature = JSON.stringify(spec);
  useEffect(() => {
    let alive = true;
    setValidation(null);
    const timer = setTimeout(() => post('validate-dsl', { spec }).then(r => { if (alive) setValidation({ ...r, signature }); }).catch(() => { if (alive) setValidation({ failed: true, signature }); }), 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [signature]);
  const current = validation?.signature === signature ? validation : null;
  const change = patch => onChange({ ...spec, dsl: 1, ...patch });
  const skill = spec.skill;
  return html`<div class="st-dsl" data-testid="dsl-form">
    ${meta ? html`<${DslRules} meta=${true} value=${spec.meta?.on} source=${source} onChange=${on => change({ meta: { ...spec.meta, key: `effect:${id}:income`, on } })} />`
      : html`${bool(t('启用技能规格'), !!skill, on => onChange(on ? { ...spec, skill: { kind: 'duration', duration: 10, mods: { atkPct: 0.5 } } } : without(spec, 'skill')))}
        ${skill ? html`<fieldset><${Select} label=${t('技能类型')} value=${skill.kind || 'instant'} options=${['instant','duration','ammo','charges','toggle','passive']} onChange=${kind => change({ skill: { ...skill, kind, ...(kind === 'ammo' ? { ammo: skill.ammo ?? 8 } : {}) } })} />
          ${['duration','ammo','spCost','initSp'].map(k => html`<div>${bool(k, k in skill, on => change({ skill: on ? { ...skill, [k]: 10 } : without(skill, k) }))}
            ${k in skill ? html`<${Value} value=${skill[k]} source=${source} onChange=${v => change({ skill: { ...skill, [k]: v } })} />` : null}</div>`)}
          <${Mods} value=${skill.mods} source=${source} onChange=${mods => change({ skill: { ...skill, mods } })} />
          ${['start','end','hit','attack','tick'].map(slot => html`<details open=${!!skill.on?.[slot]?.length}><summary>${t('技能回调')} · ${slot}</summary>
            <${Actions} value=${skill.on?.[slot]} source=${source} onChange=${actions => change({ skill: { ...skill, on: { ...skill.on, [slot]: actions } } })} />
          </details>`)}
        </fieldset>` : null}
        <h4>${t('天赋')}</h4><${DslRules} value=${spec.talents} source=${source} onChange=${talents => change({ talents })} />`}
    <div class=${`st-banner ${current?.ok ? 'is-ok' : 'is-warn'}`} data-testid="dsl-validation">
      ${current?.failed ? t('DSL 校验未完成，规格尚未确认可保存，请重试。') : current ? current.ok ? t('DSL 校验通过') : html`<${IssueList} issues=${current.problems.map(p => ({ code: p.code, level: 'problem', text: p.zh, params: { where: p.path, detail: p.zh } }))} />` : t('正在校验 DSL…')}
    </div>
  </div>`;
}
