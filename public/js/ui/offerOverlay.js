// Native offer UI: two-tap confirmation and the choice overlay's responsive cards.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Countdown, Button } from './components.js';
import { GIcon } from './gameComponents.js';
import { spTap } from './choiceOverlay.js';
import { t } from '../../../shared/i18n.js';

export const offerSeat = (offer, myId) => offer?.seats?.find(s => s.playerId === myId) || null;
export const offerPickable = (offer, myId, readOnly, busy) => !readOnly && busy == null && offerSeat(offer, myId)?.picked === false;
export const offerBlocksPrep = offers => !!offers?.some(o => o.quorum !== 'none');
// [ASSUMED] Nonblocking picks auto-collapse; a deliberate reopen can inspect the completed seat.
export function offerVisible(offers, myId, dismissed = [], selected = null) {
  return offers.find(o => o.seq === selected?.seq && offerSeat(o, myId)?.picked === selected.picked)
    || offers.find(o => o.quorum !== 'none')
    || offers.find(o => !dismissed.includes(o.seq) && !offerSeat(o, myId)?.picked)
    || null;
}
const ICONS = { funds: 'sell', layers: 'bolt', item: 'shield', chess: 'rook', refresh: 'refresh' };

export function OfferOverlay({ pub, myId, readOnly = false, onAction }) {
  const [selected, setSelected] = useState(null);
  const [dismissed, setDismissed] = useState([]);
  const [armed, setArmed] = useState(null);
  const [busy, setBusy] = useState(null);
  const root = useRef(null);
  const offers = pub?.offers || [];
  const offer = offerVisible(offers, myId, dismissed, selected);
  const open = o => { setSelected({ seq: o.seq, picked: offerSeat(o, myId)?.picked }); setArmed(null); };
  const dismissible = offer?.quorum === 'none';
  const dismiss = () => {
    if (!dismissible) return;
    setDismissed(ids => [...ids.filter(id => id !== offer.seq && offers.some(o => o.seq === id)), offer.seq]);
    setSelected(null); setArmed(null);
  };
  useEffect(() => { setArmed(null); setBusy(null); }, [offer?.seq]);
  useEffect(() => {
    if (!offer) return;
    const previous = document.activeElement;
    root.current?.focus();
    return () => previous?.focus?.();
  }, [offer?.seq]);
  if (!offer) return html`<${OfferDock} offers=${offers} myId=${myId} onOpen=${open} />`;
  const can = offerPickable(offer, myId, readOnly, busy);
  const act = async (idx, refresh = false) => {
    if (!can || !refresh && offerSeat(offer, myId)?.slots[idx]?.available === false) return;
    const token = `${offer.seq}:${idx}`;
    setArmed(null); setBusy(token);
    try { await onAction(offer, idx, refresh, offerSeat(offer, myId)?.slots[idx]?.id); }
    finally { setBusy(b => b === token ? null : b); }
  };
  const tap = idx => {
    if (offerSeat(offer, myId)?.slots[idx]?.available === false) return;
    const next = spTap(armed, idx, can);
    setArmed(next.armed);
    if (next.pick != null) void act(next.pick);
  };
  const onKeyDown = e => {
    if (e.key === 'Escape') { if (armed == null) dismiss(); setArmed(null); e.stopPropagation(); }
    if (e.key !== 'Tab') return;
    const buttons = [...root.current.querySelectorAll('button:not(:disabled)')];
    const first = buttons[0], last = buttons.at(-1);
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { first.focus(); e.preventDefault(); }
  };
  return html`<div ref=${root} tabindex="-1" class="spov offerov" role="dialog" aria-modal="true" aria-label=${t('插件选择')} onKeyDown=${onKeyDown}>
    <div class="spov__veil" aria-hidden="true"></div>
    <div class="spov__inner">
      <nav class="offerov__tabs" aria-label=${t('插件选择')}>
        ${offers.map(o => html`<${Button} key=${o.seq} size="sm" onClick=${() => open(o)} aria-pressed=${o.seq === offer.seq}>${o.pluginId} / ${o.id}<//>`)}
        ${dismissible ? html`<${Button} size="sm" onClick=${dismiss}>${t('收起')}<//>` : null}
      </nav>
      <${OfferView} offer=${offer} myId=${myId} readOnly=${readOnly} busy=${busy} armed=${armed} onTap=${tap} onRefresh=${idx => act(idx, true)} />
    </div>
  </div>`;
}

export function OfferDock({ offers, myId, onOpen }) {
  return html`<nav class="offerov__dock" aria-label=${t('插件选择')}>
    ${offers.map(o => html`<${Button} key=${o.seq} size="sm" onClick=${() => onOpen(o)}>
      ${t('插件选择')} · ${o.id} · ${offerSeat(o, myId)?.picked ? t('等待队友') : t('选择一项')}<//>`)}
  </nav>`;
}

/** Pure view for the native match popup and node rendering tests; all plugin text stays text. */
export function OfferView({ offer, myId, readOnly = false, busy = null, armed = null, onTap = () => {}, onRefresh = () => {} }) {
  const mine = offerSeat(offer, myId);
  const seat = mine || offer.seats[0];
  const can = offerPickable(offer, myId, readOnly, busy);
  return html`<header class="spov__head">
    <div><h2>${t('插件选择')} · ${offer.id}</h2><p>${t('点击卡牌选中，再次点击确认')}</p>
      <p role="status">${readOnly || !mine ? t('观战中') : mine.picked ? t('等待队友') : t('选择一项')}
        · ${t('还有 {n} 人未选择', { n: offer.waiting })}</p></div>
    <${Countdown} deadline=${offer.deadline} total=${offer.windowSec} size="md" />
  </header>
  <div class="spov__grid spov__grid--3">
    ${(seat?.slots || []).map(card => html`<div class="offerov__slot" key=${card.idx}>
      <button type="button" class=${`spcard ${can && card.available !== false ? 'is-pickable' : ''} ${can && card.available !== false && armed === card.idx ? 'is-armed' : ''}`}
        disabled=${!can || card.available === false} aria-pressed=${can && card.available !== false && armed === card.idx} aria-busy=${busy != null} onClick=${() => onTap(card.idx)}
        aria-label=${card.available !== false && armed === card.idx ? t('{name}，已选中，再次点击确认', { name: card.name }) : card.name}>
        <span class="spcard__head"><span class="spcard__icon" aria-hidden="true"><${GIcon} name=${ICONS[card.icon]} /></span>
          <b class="spcard__name">${card.name}</b></span>
        <span class="spcard__desc">${card.desc}</span>
        ${card.available === false ? html`<span class="spcard__unavailable">${t('暂不可用')}</span>` : null}
        ${can && card.available !== false && armed === card.idx ? html`<span class="spcard__confirm"><${Icon} name="check" />${t('确认选择')}</span>` : null}
      </button>
      <${Button} size="sm" icon="refresh" disabled=${!can || card.remaining <= 0} onClick=${() => onRefresh(card.idx)}>
        ${t('刷新（剩余 {n} 次）', { n: card.remaining })}<//>
    </div>`)}
  </div>`;
}
