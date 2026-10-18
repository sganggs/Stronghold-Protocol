import { html, Button } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
import { OFFER_WHEN, OFFER_QUORUM, OFFER_TIMEOUT, OFFER_ICONS, OFFER_EFFECTS } from '../../../../shared/plugins/offers.js';
import { PLUGIN_OFFERS_MAX_WINDOW_SEC } from '../../../../shared/plugins/limits.js';
import { gameplayOptions, editGameplay } from '../gameplayModel.js';
import { NumberField, Select, TextField } from './controls.js';
import { Toggle, LongText, RecordPicker, removeAt, replaceAt, DraftValidation } from './gameplayControls.js';

const effectDefault = key => key === 'layers' ? { bond: 'victoriaShip', count: 1 } : key === 'item' ? 'chess_item_1_01_e_a' : key === 'chess' ? '' : 1;
export function OffersEditor({ draft, onChange }) {
  const o = gameplayOptions(draft), w = o.window;
  const change = patch => onChange(editGameplay(draft, patch));
  const window = patch => change({ window: { ...w, ...patch } });
  const rounds = w.when.rounds;
  const kind = rounds === 'any' ? 'any' : Array.isArray(rounds) ? 'list' : rounds?.every ? 'every' : 'range';
  const setRounds = rounds => window({ when: { ...w.when, rounds } });
  return html`<div class="st-form" data-testid="offers-editor">
    <${TextField} label=${t('窗口标识')} value=${w.id} onChange=${id => window({ id })} />
    ${OFFER_WHEN.map(at => html`<${Toggle} label=${at} value=${w.when.at.includes(at)} onChange=${on => window({ when: { ...w.when, at: on ? [...w.when.at, at] : w.when.at.filter(x => x !== at) } })} />`)}
    <${Select} label=${t('回合范围')} value=${kind} options=${['any', 'list', 'every', 'range']} onChange=${k => setRounds(k === 'any' ? 'any' : k === 'list' ? [1] : k === 'every' ? { every: 1 } : { from: 1, to: 15 })} />
    ${kind === 'list' ? html`${rounds.map((r, i) => html`<div><${NumberField} label=${t('回合')} value=${r} min=${1} max=${99} step=${1} onChange=${v => setRounds(replaceAt(rounds, i, v))} />
      <${Button} size="sm" onClick=${() => setRounds(removeAt(rounds, i))}>${t('删除')}<//></div>`)}
      <${Button} size="sm" disabled=${rounds.length >= 64} onClick=${() => setRounds([...rounds, (rounds.at(-1) || 0) + 1])}>${t('添加')}<//>` : null}
    ${kind === 'every' || kind === 'range' ? (kind === 'every' ? ['every'] : ['from', 'to']).map(k => html`<${NumberField} label=${k} value=${rounds[k]} min=${1} max=${kind === 'every' ? 32 : 99} step=${1} onChange=${v => setRounds({ ...rounds, [k]: v })} />`) : null}
    <${NumberField} label=${t('选项数量')} value=${w.slots} min=${1} max=${6} step=${1} onChange=${slots => window({ slots })} />
    <${NumberField} label=${t('每格刷新次数')} value=${w.refresh.perSlot} min=${0} max=${2} step=${1} onChange=${perSlot => window({ refresh: { perSlot } })} />
    <${NumberField} label=${t('窗口时长（秒）')} value=${w.windowSec} min=${0} max=${PLUGIN_OFFERS_MAX_WINDOW_SEC} step=${1} onChange=${windowSec => window({ windowSec })} />
    <${Select} label=${t('等待方式')} value=${w.quorum} options=${OFFER_QUORUM} onChange=${quorum => window({ quorum })} />
    <p class="st-note">${t('none 不阻塞；all 等待全部；majority 等待多数。0 秒不打开窗口。')}</p>
    <${Select} label=${t('超时处理')} value=${w.onTimeout} options=${OFFER_TIMEOUT} onChange=${onTimeout => window({ onTimeout })} />
    <${Toggle} label=${t('延后准备结算')} value=${w.defer.includes('prepSettle')} onChange=${on => window({ defer: on ? ['prepSettle'] : [] })} />
    <h4>${t('选项池')}</h4>
    ${o.cards.map((card, i) => {
      const set = patch => change({ cards: replaceAt(o.cards, i, { ...card, ...patch }) });
      const key = Object.keys(card.apply)[0], value = card.apply[key];
      const effect = v => set({ apply: { [key]: v } });
      return html`<fieldset><legend>${card.id}</legend>
        <${TextField} label=${t('标识')} value=${card.id} onChange=${id => set({ id })} />
        <${TextField} label=${t('名字')} value=${card.name} onChange=${name => set({ name })} />
        <${LongText} label=${t('描述')} max=${240} value=${card.desc} onChange=${desc => set({ desc })} />
        <${Select} label=${t('图标')} value=${card.icon} options=${OFFER_ICONS} onChange=${icon => set({ icon })} />
        <${Select} label=${t('奖励')} value=${key} options=${OFFER_EFFECTS} onChange=${k => set({ apply: { [k]: effectDefault(k) } })} />
        ${['item', 'chess', 'layers'].includes(key) ? html`<${RecordPicker} kind=${key === 'layers' ? 'bond' : key} label=${t('目标')} value=${key === 'layers' ? value.bond : value} onChange=${v => effect(key === 'layers' ? { ...value, bond: v } : v)} />` : null}
        ${key === 'layers' ? html`<${NumberField} label=${t('层数')} value=${value.count} min=${1} max=${999} step=${1} onChange=${count => effect({ ...value, count })} />` : null}
        ${['funds', 'pendingFunds', 'freeRefresh'].includes(key) ? html`<${NumberField} label=${t('数量')} value=${value} min=${key === 'freeRefresh' ? 1 : 0} max=${key === 'freeRefresh' ? 6 : 1000} step=${1} onChange=${effect} />` : null}
        <${Button} size="sm" onClick=${() => change({ cards: removeAt(o.cards, i) })}>${t('删除')}<//>
      </fieldset>`;
    })}
    <${Button} size="sm" disabled=${o.cards.length >= 128} onClick=${() => {
      const id = Array.from({ length: 129 }, (_, n) => `card-${n + 1}`).find(id => !o.cards.some(c => c.id === id));
      change({ cards: [...o.cards, { id, name: '+1', desc: '+1', icon: 'funds', apply: { funds: 1 } }] });
    }}>${t('添加')}<//>
    <${DraftValidation} draft=${draft} />
  </div>`;
}
export default { id: 'offers', Component: OffersEditor };
