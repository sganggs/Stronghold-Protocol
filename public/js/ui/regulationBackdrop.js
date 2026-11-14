// 规程's lobby ground (ui/screens/lobby.js HubBackdrop, and the title screen when the start-up version is 规程:
// versions.js startupVersion). Styles: css/screens/lobby.css `.hub-reg`. The title screen of a 规程 start draws the last
// frame of 规程's opening instead when that group is extracted (RegulationStill: the official season screen's ground,
// key art, skyline and title art, where ui/regulationFilm.js leaves them).
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { localAsset } from '../data.js';
import { loadRegulationPack, mountRegulationIntro, REG_END } from './regulationFilm.js';

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


/**
 * 规程's opening pack for the title screen: undefined while it loads, null without it (the group is not extracted),
 * else the pack (ui/regulationFilm.js loadRegulationPack). Nothing is loaded when `on` is false.
 * @param {boolean} on
 */
export function useRegulationPack(on) {
  const [pack, setPack] = useState(/** @type {any} */ (undefined));
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    loadRegulationPack().then((p) => { if (live) setPack(p || null); }, () => { if (live) setPack(null); });
    return () => { live = false; };
  }, [on]);
  return on ? pack : null;
}

/**
 * The opening's last frame, still (the season ground, the monument key art, the skyline and the title art on the
 * official canvas), so the film lands on the title screen; drawn again when the window changes size.
 * @param {{ pack: any }} props
 */
export function RegulationStill({ pack }) {
  const ref = useRef(null);
  useEffect(() => {
    const host = ref.current;
    if (!host || !pack) return undefined;
    let scene = null;
    try { scene = mountRegulationIntro(host, pack, { still: true }); } catch (err) { console.warn('[regulation] still failed', err); return undefined; }
    const draw = () => scene.render(REG_END);
    draw();
    addEventListener('resize', draw);
    return () => { removeEventListener('resize', draw); scene.destroy(); };
  }, [pack]);
  return html`<div ref=${ref} class="title-reg__still" aria-hidden="true"></div>`;
}
