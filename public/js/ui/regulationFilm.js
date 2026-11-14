// 规程·序列Ⅰ's opening before the title screen (DESIGN §37.147). A 规程 start (versions.js startupVersion: the first
// start, or a lobby set to 规程) plays the client's own season entry where a 盟约 start plays 盟约's film
// (ui/entryFilm.js runs both: the 点击进入 card, the skip, the cue and the music hold are the same): the activity's
// panel_act3autochess_on_entry with its legacy clip autochess_entry_season_on (3.17 s: a black cover lifts off a red
// "loading" screen — four ID cards, the map with its lines, the percent counter to 100 % and COMPLETE —, the season
// emblem breaks out between expanding rings, then the season ground zooms in under the title art) and the cards'
// flicker, autochess_season_on_entry_loop, the PlayAutomatically loop of entry_anim_season_on. The season screen's own
// buttons are not in the export (tools/local-extract/season_entry.py): the film ends on the ground and the title art,
// the picture the title screen opens on (screens/title.js draws the same ground and the art at the same place).
// Drawn by ui/prefab/stage.js, laid out again every frame on the official 1280 × 720 canvas expanded to the screen
// (CanvasScaler: the ground's 1559 × 960 art covers 4:3 to 19.5:9). Without the extracted group nothing plays.

import { data } from '../data.js';
import { officialAssetUrl } from '../../../shared/uiTheme.js';
import { makePack } from './prefab/view.js';
import { createStage } from './prefab/stage.js';
import { createPose, clipPose, resolvePath } from './prefab/anim.js';

/** The local-client group (tools/local-extract/season_entry.py SUB; data/local-assets.json). */
export const REGULATION_ENTRY = 'ui/season/act3autochess/entry';
export const ENTRY_PREFAB = 'panel_act3autochess_on_entry';
export const ENTRY_CLIP = 'autochess_entry_season_on';
const LOOP_CLIP = 'autochess_season_on_entry_loop';
const LOOP_ON = 'canvas_front/entry_anim_season_on';
/** The official UI canvas (CanvasScaler reference resolution), expanded to the screen's aspect. */
export const REF_W = 1280;
export const REF_H = 720;
/** Film seconds: the entry clip runs 0 → 3.17 s; its last frame holds while the overlay fades into the title screen. */
export const REG_SPAN = Object.freeze({ from: 0, fadeAt: 3.2, to: 3.6 });
/** A moment past the entry clip's end: its last frame (the title screen's still, ui/regulationBackdrop.js). */
export const REG_END = 3.2;
/**
 * The load cue (the client's autochess_g_ui_load, the same sound as 盟约's act1autochess_g_ui_load) as the film starts,
 * and 规程's music as the season ground comes in. [ASSUMED] both times: no recording of this entry with its sound.
 */
export const REG_AUDIO = Object.freeze({ sfxAt: 0, bgmAt: 2.3 });

/** Units → rem text (1 unit = 0.01rem, as ui/prefab/view.js draws). @param {number} u */
const rem = (u) => `${Number((u / 100).toFixed(3))}rem`;

let packLoad = null;

/**
 * The opening's pack (prefabs.json and its sprites), or null: the group is not extracted, the file is unreadable or not
 * this format. Loads the local manifest first.
 * @returns {Promise<ReturnType<typeof makePack> | null>}
 */
export function loadRegulationPack() {
  if (packLoad) return packLoad;
  packLoad = (async () => {
    try { await data.load('local'); } catch { return null; }
    const groups = data.get('local')?.groups;
    // a path outside the group's folder is not followed (shared/uiTheme.js officialAssetUrl, as the theme packs)
    const url = officialAssetUrl(REGULATION_ENTRY, groups?.[REGULATION_ENTRY]?.['prefabs.json']);
    if (!url) return null;
    try {
      const res = await fetch(url);
      const doc = res.ok ? await res.json() : null;
      if (!doc || doc.spPrefabs !== 1 || !doc.prefabs?.[ENTRY_PREFAB] || !doc.clips?.[ENTRY_CLIP]) return null;
      return makePack(groups, REGULATION_ENTRY, doc);
    } catch {
      return null;
    }
  })();
  // a failed look (no manifest yet, a network error) may succeed on the next page load, not later on this one
  return packLoad;
}

/** Forget the loaded pack (tests; a page keeps its first look). */
export function clearRegulationPack() {
  packLoad = null;
}

/** Every picture the opening draws: its sprites and its effect textures. @param {any} pack @returns {string[]} */
export function regulationPictures(pack) {
  const urls = new Set();
  (function walk(n) {
    const img = n?.image;
    if (img?.sprite) { const u = pack.sprite(img.sprite, img.file); if (u) urls.add(u); }
    const m = img?.material;
    for (const name of [m?.base, m?.mask, m?.add, m?.sheet?.tex]) { if (name) { const u = pack.texture(name); if (u) urls.add(u); } }
    for (const c of n?.children || []) walk(c);
  })(pack?.doc?.prefabs?.[ENTRY_PREFAB]);
  return [...urls];
}

/**
 * Load every picture within `ms`: true when all of them loaded (a film with a missing picture does not play).
 * @param {any} pack @param {number} ms @returns {Promise<boolean>}
 */
export function preloadRegulation(pack, ms) {
  const urls = regulationPictures(pack);
  if (!urls.length) return Promise.resolve(false);
  const one = (u) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = u;
  });
  return Promise.race([
    Promise.all(urls.map(one)).then((all) => all.every(Boolean)),
    new Promise((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

/**
 * The pose of film second t: the entry clip on the panel and the loop on entry_anim_season_on (it starts with the
 * clip, which activates that layer at 0 s), on a canvas of w × h units.
 * @param {any} pack @param {number} t @param {number} w @param {number} h
 */
export function regulationPose(pack, t, w, h) {
  const prefab = pack.doc.prefabs[ENTRY_PREFAB];
  const pose = createPose();
  pose.size.set(prefab, [w, h]);
  clipPose(pack.doc.clips[ENTRY_CLIP], prefab, t, pose);
  const loop = pack.doc.clips[LOOP_CLIP];
  const on = loop ? resolvePath(prefab, LOOP_ON) : null;
  if (on) clipPose(loop, on, t, pose);
  return pose;
}

/**
 * The scene ui/entryFilm.js runs: render(t) draws film second t. `still`: the title screen's copy of the last frame
 * (ui/regulationBackdrop.js RegulationStill), not the film.
 * @param {HTMLElement} host @param {any} pack @param {{ still?: boolean }} [opts]
 * @returns {{ render: (t: number) => void, grain: () => void, destroy: () => void }}
 */
export function mountRegulationIntro(host, pack, { still = false } = {}) {
  const prefab = pack.doc.prefabs[ENTRY_PREFAB];
  const frame = document.createElement('div');
  // spa-stage: the class test/e2e/client.mjs passEntryFilm waits for once the film runs
  frame.className = still ? 'rf rf--still' : 'spa-stage rf';
  const stageEl = document.createElement('div');
  stageEl.className = 'pf__stage rf__stage';
  frame.appendChild(stageEl);
  host.append(frame);
  const stage = createStage(stageEl, { pack, prefab });
  let fitted = '';
  let w = REF_W;
  let h = REF_H;
  const fit = () => {
    const vw = host.clientWidth || innerWidth;
    const vh = host.clientHeight || innerHeight;
    const key = `${vw}x${vh}`;
    if (key === fitted) return;
    fitted = key;
    const unit = Math.min(vw / REF_W, vh / REF_H);
    w = vw / unit;
    h = vh / unit;
    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    stageEl.style.width = rem(w);
    stageEl.style.height = rem(h);
    stageEl.style.transform = `scale(${unit / (remPx * 0.01)})`;
    stage.root.style.left = rem(w / 2);
    stage.root.style.top = rem(h / 2);
  };
  return {
    render(t) {
      fit();
      stage.draw(regulationPose(pack, t, w, h));
    },
    grain() {},
    destroy() {
      stage.destroy();
      frame.remove();
    },
  };
}
