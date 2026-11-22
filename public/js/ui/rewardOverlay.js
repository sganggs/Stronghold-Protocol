// Pick-one offer reminder (research 00 §3): the offer's cards themselves live in the shop bar (shopBar.js RewardCards —
// after a promotion, or a special refresh such as 凯瑟琳's 定向投放, they replace the bar's operator cards, like the
// original). When the player puts the pick off (稍后选择) this pill above the bar brings the cards back; it names the
// offer like the bar's header (gameLogic.offerHeader: 晋升奖励待选择 / 定向投放待选择 …, player report #6 after 0.1.0), with
// "+N" while N more offers wait behind it, and disappears once the server clears `shop.rewardOffer` (picked, or lapsed
// at the end of the prep — an offer queued after Ready lapses at the end of the next one: server PlayerState.lapseOffers,
// the official tip 「晋级的特殊奖励无法被刷新、冻结，也不会保留至下一回合」, DESIGN §37.339). It shows in PREP only, and
// game.js drops the minimised state when the prep ends, so the next prep never starts with a stale pill.

import { html, Icon, TierChip } from './components.js';
import { offerHeader } from './gameLogic.js';

/**
 * @param {{ priv:any, minimized:boolean, onMinimize:(m:boolean)=>void }} props
 */
export function RewardOverlay({ priv, minimized, onMinimize }) {
  const offer = priv?.shop?.rewardOffer;
  if (!offer || !Array.isArray(offer.slots) || !offer.slots.length || !minimized) return null;
  const head = offerHeader(offer);
  return html`<button type="button" class="rewardpill" onClick=${() => onMinimize(false)}>
    <${Icon} name=${head.icon} /><span>${head.pill}</span>${Number.isInteger(offer.tier) ? html`<${TierChip} tier=${offer.tier} size="sm" />` : null}${head.queued ? html`<span class="rewardpill__more" title=${head.more}>+${head.queued}</span>` : null}
  </button>`;
}
