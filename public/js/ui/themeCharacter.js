// The official funds-card character (theme.json `character`) on `.funds__char`.
// An image is a picture. A Spine of an installed official pack reuses the battle loader (Spine 3.8, pixi-spine); one
// of an imported pack is built from its bytes (themeSpine.js, §37.232). Idle loops, and a theme voice line plays the
// clip named in `anims.voice`. No character leaves today's box.

import { ensurePixi } from '../render/app/pixi.js';
import { bindThemeCharacterVoice } from '../uiTheme.js';
import { characterAnimName, characterIdleName } from '../../../shared/uiTheme.js';

let mountGen = 0;
/** The function last handed to bindThemeCharacterVoice. The funds card and ShopSpineView share mountGen. */
let voiceMountHandler = null;

/** Clip names on a pixi-spine actor. */
export function spineClipNames(actor) {
  const list = actor?.spineData?.animations || actor?.skeleton?.data?.animations || [];
  return new Set(list.map((anim) => anim?.name).filter(Boolean));
}

/**
 * Idle loop: the pack's idle name, else Default, else the skeleton's first clip.
 * @returns {boolean} whether a clip was set
 */
export function playThemeCharacterIdle(actor, character, { isDead } = {}) {
  if (!actor || (typeof isDead === 'function' && isDead())) return false;
  const names = spineClipNames(actor);
  const idleName = characterIdleName(character);
  const name = names.has(idleName) ? idleName : (names.has('Default') ? 'Default' : [...names][0]);
  if (!name) return false;
  try {
    actor.state.setAnimation(0, name, true);
    return true;
  } catch {
    return false;
  }
}

/**
 * The funds-card voice rule: `stem` null returns to idle; a mapped clip plays once, then idle.
 * `isPaused` is the canvas shop's parked pose (ShopSpineView). The DOM funds card does not pass it.
 * @returns {boolean} whether the actor was told to change clip
 */
export function playThemeCharacterStem(actor, character, stem, hooks = {}) {
  const isDead = typeof hooks.isDead === 'function' ? hooks.isDead : () => false;
  const isPaused = typeof hooks.isPaused === 'function' ? hooks.isPaused : () => false;
  const isCurrent = typeof hooks.isCurrent === 'function' ? hooks.isCurrent : () => true;
  if (!isCurrent() || !actor || isDead() || isPaused()) return false;
  if (!stem) return playThemeCharacterIdle(actor, character, { isDead });
  const idleName = characterIdleName(character);
  const name = characterAnimName(character, stem);
  const names = spineClipNames(actor);
  if (!name || !names.has(name)) return false;
  try {
    const track = actor.state.setAnimation(0, name, false);
    if (names.has(idleName)) actor.state.addAnimation(0, idleName, true, 0);
    if (track) {
      track.listener = {
        complete: () => {
          if (!isDead() && !isPaused() && isCurrent()) playThemeCharacterIdle(actor, character, { isDead });
        },
      };
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Register `onStem` as the theme-voice listener. The latest call answers. `release` unbinds only while
 * this call is still the latest, so disposing an older mount cannot clear a newer one.
 */
export function bindThemeCharacterMount(onStem) {
  const generation = ++mountGen;
  const wrapped = (stem) => {
    if (generation !== mountGen) return;
    onStem(stem);
  };
  voiceMountHandler = wrapped;
  bindThemeCharacterVoice(wrapped);
  return {
    generation,
    current: () => generation === mountGen,
    release() {
      if (generation !== mountGen) return false;
      bindThemeCharacterVoice(null);
      if (voiceMountHandler === wrapped) voiceMountHandler = null;
      return true;
    },
  };
}

/**
 * Deliver a stem to whichever mount bound last. Production playback goes through uiTheme.noteVoiceStem,
 * which calls the same function this registered.
 * @returns {boolean} whether a mount is listening
 */
export function dispatchThemeCharacterVoice(stem) {
  if (typeof voiceMountHandler !== 'function') return false;
  voiceMountHandler(stem);
  return true;
}

function fitSpine(actor, app) {
  const viewW = Math.max(1, app.renderer.width / (app.renderer.resolution || 1));
  const viewH = Math.max(1, app.renderer.height / (app.renderer.resolution || 1));
  actor.position.set(0, 0);
  actor.scale.set(1);
  try { actor.update(0); } catch { /* the first pose can throw before a clip exists */ }
  const bounds = typeof actor.getLocalBounds === 'function' ? actor.getLocalBounds() : null;
  const bw = Math.max(1, bounds?.width || viewW);
  const bh = Math.max(1, bounds?.height || viewH);
  const scale = Math.min(viewW / bw, viewH / bh);
  actor.scale.set(scale);
  const originX = bounds ? bounds.x + bounds.width / 2 : 0;
  const originY = bounds ? bounds.y + bounds.height / 2 : 0;
  actor.x = viewW / 2 - originX * scale;
  actor.y = viewH / 2 - originY * scale;
}

/**
 * Mount into `host`. Returns a dispose function. A missing PIXI build leaves the host empty.
 * @param {HTMLElement} host
 * @param {{ imageUrl?: string, spine?: { skel: string, atlas: string, textures: string[], anims?: object }, anims?: { idle?: string, voice?: Record<string, string> } } | null} character
 * @param {{ voice?: boolean }} [opts]  voice false: a second copy (a 规程 banner's window, ui/prefab/view.js) that plays
 *   idle only and leaves the funds card's voice binding alone
 */
export function mountThemeCharacter(host, character, opts = {}) {
  if (!host || !character) return () => {};
  const voice = opts.voice !== false;
  let dead = false;
  let app = null;
  let actor = null;
  const idleName = characterIdleName(character);

  const playIdle = () => {
    playThemeCharacterIdle(actor, character, { isDead: () => dead });
  };

  // Latest voice-bound mount answers (shared with ShopSpineView). A voice-less copy does not take the binding.
  let binding = null;
  if (voice) {
    binding = bindThemeCharacterMount((stem) => {
      playThemeCharacterStem(actor, character, stem, {
        isDead: () => dead,
        isCurrent: () => !!(binding && binding.current()),
      });
    });
  }

  const dispose = () => {
    dead = true;
    if (binding) {
      binding.release();
      binding = null;
    }
    if (app) {
      const view = app.view;
      try { app.destroy(true, { children: true, texture: false, baseTexture: false }); }
      catch { /* already destroyed */ }
      view?.remove?.();
      app = null;
    }
    actor = null;
    host.querySelector?.('.funds__charimg')?.remove();
  };

  if (character.imageUrl) {
    const img = document.createElement('img');
    img.className = 'funds__charimg';
    img.alt = '';
    img.draggable = false;
    img.src = character.imageUrl;
    host.appendChild(img);
    return dispose;
  }

  // validSpine (the battle loader's check) wants an `anims` record on the entry itself; the character keeps its own
  // `anims` beside `spine` (the default robot of the 规程 shop had none and drew nothing).
  const blobs = character.spine?.blobs || null;
  const entry = character.spine && !blobs ? { ...character.spine, anims: character.spine.anims || { idle: idleName } } : null;
  if (!entry && !blobs) return dispose;
  (async () => {
    try {
      let data;
      let P;
      if (blobs) {
        // an imported pack (§37.232): the model is built from its bytes, no request
        P = await ensurePixi();
        if (dead || !P?.spine?.Spine) return;
        const { loadSpineFromBlobs } = await import('../themeSpine.js');
        data = await loadSpineFromBlobs(blobs, P);
      } else {
        // assets.js loads lazily: a vanilla page's start does not import the asset store (test/ui/plugins-client.test.js)
        const { loadSpineData, validSpine } = await import('../assets.js');
        if (dead || !validSpine(entry)) return;
        P = await ensurePixi();
        if (dead || !P?.spine?.Spine) return;
        data = await loadSpineData(entry);
      }
      if (dead) return;
      const width = Math.max(1, Math.round(host.clientWidth || 108));
      const height = Math.max(1, Math.round(host.clientHeight || 116));
      app = new P.Application({
        width,
        height,
        backgroundAlpha: 0,
        resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
        autoDensity: true,
      });
      const view = app.view;
      view.className = 'funds__charcanvas';
      view.style.width = '100%';
      view.style.height = '100%';
      view.style.pointerEvents = 'none';
      view.setAttribute('aria-hidden', 'true');
      host.appendChild(view);
      actor = new P.spine.Spine(data);
      actor.autoUpdate = true;
      app.stage.addChild(actor);
      playIdle();
      fitSpine(actor, app);
    } catch {
      /* The funds numbers stay. A portrait that cannot load is not an error dialog. */
    }
  })();
  return dispose;
}
