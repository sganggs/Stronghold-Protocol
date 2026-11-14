// 选择自编 — CUSTOM_CHECK, after the strategy draft on a season that has diyBringLimits (规程: 0–2 per tier).
// The roster itself stays the lobby's 自选编队. This screen only chooses which of those slots enter the match.
// Cards whose core is banned, or whose every add-on is banned, are grey and cannot be selected (the server's
// diyBanned list). Confirming none is 禁用自选. The screen opens with the timeout default checked [ASSUMED]:
// the first legal slots of each tier, in data order, up to the cap.

import { useState } from '../../vendor/hooks.module.js';
import { html, Button, TierChip } from '../ui/components.js';
import { useGameData, OperatorImage, BondGlyph } from '../ui/gameComponents.js';
import { StepHeader, ExitModal } from '../ui/matchChrome.js';
import { actions } from '../ui/gameActions.js';
import { sortedPlayers, phaseTotalSeconds, pregameStepCount, pregameStepIndex } from '../ui/gameLogic.js';
import { useStore } from '../store.js';
import { data } from '../data.js';
import { slotRecord } from '../ui/diyModel.js';
import { defaultDiyBring, diyBringCap } from '../../../shared/diyBring.js';
import { diySlot, diySlotIds } from '../../../shared/diy.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

const bundle = () => ({ chess: data.get('chess'), backups: data.get('backups') });

/**
 * Why a grey card cannot be brought: every bond of it is greyed (server gamedata bondsExclude, §37.200) — its core
 * bond(s) when it has no add-on, its add-ons when it has no core, else all of them.
 */
function greyReason(rec) {
  const bonds = Array.isArray(rec?.bonds) ? rec.bonds : [];
  const table = data.get('bonds') || {};
  const core = bonds.filter((b) => table[b]?.isCore).length;
  if (!core) return t('附加盟约均已禁用');
  return core === bonds.length ? t('核心盟约已禁用') : t('所属盟约均已禁用');
}

/** 选择自编 screen. */
export function DiyCheckScreen() {
  const pub = useStore((s) => s.match.public);
  const priv = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  const solo = useStore((s) => s.room?.mode === 'solo') || String(pub?.modeId || '').includes('single');
  const gd = useGameData();
  const [exit, setExit] = useState(false);
  const [busy, setBusy] = useState(false);
  // null = the player has not touched the list, so the shown selection is the server's timeout default.
  const [picked, setPicked] = useState(null);
  if (!pub) return null;

  const roster = priv?.diy && typeof priv.diy === 'object' ? priv.diy : {};
  const banned = new Set(Array.isArray(priv?.diyBanned) ? priv.diyBanned : []);
  const limits = pub.diyCheck?.limits || null;
  const pack = bundle();
  const order = diySlotIds(pack);
  const tierOf = (id) => diySlot(id, pack)?.tier ?? null;
  const defaults = defaultDiyBring(order, { roster, banned: [...banned], limits, tierOf });
  const picks = pub.diyCheck?.picks;
  const inMap = !!(picks && Object.hasOwn(picks, myId));
  const mine = inMap ? picks[myId] : undefined;
  const confirmed = Array.isArray(mine) ? mine : null;
  const shown = confirmed ?? (picked ?? defaults);
  const canEdit = inMap && confirmed == null && !busy;
  const selected = new Set(shown);

  const groups = [];
  for (const id of order) {
    if (!roster[id]) continue;
    const tier = tierOf(id);
    let g = groups.find((x) => x.tier === tier);
    if (!g) { g = { tier, ids: [] }; groups.push(g); }
    g.ids.push(id);
  }

  const caps = limits ? Object.values(limits).filter((v) => Number.isInteger(v)) : [];
  const n = caps.length && caps.every((c) => c === caps[0]) ? caps[0] : (caps[0] ?? 2);

  const toggle = (id) => {
    if (!canEdit || banned.has(id)) return;
    const cur = picked ?? defaults;
    if (cur.includes(id)) { setPicked(cur.filter((x) => x !== id)); return; }
    const tier = tierOf(id);
    const cap = diyBringCap(limits, tier);
    const count = cur.filter((x) => tierOf(x) === tier).length;
    if (cap != null && count >= cap) return;
    setPicked([...cur, id]);
  };

  const confirm = async (slots) => {
    if (!canEdit) return;
    setBusy(true);
    setPicked(slots);
    await actions.diyBring(slots);
    setBusy(false);
  };

  const players = sortedPlayers(pub);
  const readyN = players.filter((p) => Array.isArray(picks?.[p.playerId])).length;

  return html`<div class="screen brief diy-check" data-testid="diy-check">
    <div class="brief__bg" aria-hidden="true"></div>
    <${StepHeader} step=${pregameStepIndex(gd.config, 'CUSTOM_CHECK')} of=${pregameStepCount(gd.config)} title=${t('选择自编')} micro="SQUAD // CUSTOM CHECK" pub=${pub}
      total=${phaseTotalSeconds(pub, gd.config)} onExit=${() => setExit(true)} />
    <main class="brief__main">
      <p class="diy-check__lead">${t('每阶至多带入 {n} 名，未选择的干员不会进入本次模拟', { n })}</p>
      ${groups.length === 0 ? html`<p class="diy-check__empty">${t('尚未编入自选干员')}</p>` : groups.map((g) => {
        const cap = diyBringCap(limits, g.tier);
        const got = g.ids.filter((id) => selected.has(id)).length;
        return html`<section key=${g.tier} class="diy-check__tier">
          <h2 class="diy-check__tierhead"><${TierChip} tier=${g.tier} size="sm" /><span class="num">${ROMAN[g.tier] || g.tier}</span><span>${t('阶')}</span>
            ${cap != null ? html`<b class="num diy-check__count">${got}/${cap}</b>` : null}</h2>
          <div class="diy-check__grid">
            ${g.ids.map((id) => {
              const pick = roster[id];
              const rec = slotRecord(id, pick, pack);
              const unit = data.get('backups')?.units?.[pick.charId];
              const on = selected.has(id);
              const grey = banned.has(id);
              return html`<button key=${id} type="button" class=${cx('diy-check__card', on && 'is-on', grey && 'is-banned')}
                data-testid="diy-check-card" data-slot=${id} disabled=${!canEdit || grey} aria-pressed=${on ? 'true' : 'false'}
                onClick=${() => toggle(id)}>
                <${OperatorImage} class="diy-check__art" chess=${{ charId: pick.charId, assets: unit?.assets }} />
                <span class="diy-check__name">${rec?.name || pick.charId}</span>
                <span class="diy-check__bonds">${(rec?.bonds || []).map((b) => html`<${BondGlyph} key=${b} bondId=${b} />`)}</span>
                ${grey ? html`<small class="diy-check__why">${greyReason(rec)}</small>` : null}
              </button>`;
            })}
          </div>
        </section>`;
      })}
    </main>
    <footer class="brief__foot">
      ${!pub.diyCheck?.untimed ? html`<p class="diy-check__hint">${t('超时未确认时，按槽位顺序自动带入')}</p>` : null}
      <div class="brief-ready">
        <span class="brief-ready__txt">${t('已就绪')}<b class="num">${readyN}</b><span class="num">/${players.length}</span></span>
        <span class="brief-ready__pips">${players.map((p) => html`<i key=${p.playerId} class=${cx(Array.isArray(picks?.[p.playerId]) && 'on', p.playerId === myId && 'me')} title=${p.name}></i>`)}</span>
      </div>
      <${Button} variant="ghost" size="lg" data-testid="diy-check-none" disabled=${!canEdit} onClick=${() => confirm([])}>${t('不带入自选')}<//>
      <${Button} variant="primary" size="xl" class="brief-go" data-testid="diy-check-confirm" icon=${confirmed ? 'check' : inMap ? 'play' : 'eye'}
        active=${!!confirmed} loading=${busy} disabled=${!canEdit}
        onClick=${() => confirm(shown)}>${confirmed ? t('已就绪') : inMap ? t('确认编队') : t('观战中')}<//>
    </footer>
    <${ExitModal} open=${exit} onClose=${() => setExit(false)} solo=${solo} />
  </div>`;
}
