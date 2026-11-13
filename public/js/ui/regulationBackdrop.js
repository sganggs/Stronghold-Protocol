// 规程's lobby ground (ui/screens/lobby.js HubBackdrop, and the title screen when the start-up version is 规程:
// versions.js startupVersion). Styles: css/screens/lobby.css `.hub-reg`.
import { html } from './components.js';
import { localAsset } from '../data.js';

/** The local-client art of 规程's season (tools/local-extract/extract.py job ui/season/act3autochess; data/local-assets.json). */
export const REGULATION_ART = 'ui/season/act3autochess';
/** The season whose look the lobby wears: 规程 (act3autochess) has its own; every 盟约 version keeps the hub's. */
export const REGULATION = 'act3autochess';

/**
 * 规程's lobby ground (the official season screen's layers, data-season="act3autochess"): its red worn ground, the 乌萨斯
 * monument key art and the industrial skyline in front, under drawn sun rays and scan lines — each layer only when the
 * local-client art has it; without the art the theme's gradients stand alone.
 */
export function RegulationBackdrop() {
  const art = (name) => localAsset(REGULATION_ART, name);
  const [ground, pic, skyline] = [art('bkg_season_on'), art('bg_season_on'), art('bg_front_season_on')];
  return html`<span class="hub-reg" aria-hidden="true">
    ${ground ? html`<img class="hub-reg__ground" src=${ground} alt="" />` : null}
    <span class="hub-reg__rays"></span>
    ${pic ? html`<img class="hub-reg__pic" src=${pic} alt="" />` : null}
    ${skyline ? html`<img class="hub-reg__skyline" src=${skyline} alt="" />` : null}
    <span class="hub-reg__scan"></span>
  </span>`;
}

