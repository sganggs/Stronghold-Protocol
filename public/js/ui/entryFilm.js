// The 卫戍协议：盟约 entry animation (ui/allianceScene.js) before the title screen, on every page load, with the event's
// sound as the recording has it: the entry cue act1autochess_g_ui_load at video 1.686 s, then the lobby music from its
// very start at 2.144 s with audio.js's own 0.8 s fade-in (a cross-correlation of the recording's soundtrack against the
// official files: r 0.988 / 0.998, nothing else is in it). A fresh page may not play sound before a user gesture, so a
// black 点击进入 card waits for the tap that unlocks it (audio.js listens for the same gesture), then the film runs.
// Volumes / mute are the settings' (sfx · bgm channels); the player's own lobby music (audio.setLobbyTrack) plays in
// place of the official track as everywhere else, untouched by the film. A tap / click / key skips; phones wait for
// landscape; reduced motion and a server without the art pack get no film (the title screen shows at once). Never over
// a room or a match: the route is watched from the card on, and a session restored into a room / a match while the card
// waits or the film runs takes the overlay down at once, silences the cue and hands the music back to that screen.
// main.js calls playEntryFilm once at boot.
import { store, selectRoute } from '../store.js';
import { audio, resolveBgm } from '../audio.js';
import { data } from '../data.js';
import { reducedMotion } from './device.js';
import { mountAllianceIntro, preloadSprites, setCycleOrigin, hasSprites, INTRO_AUDIO, INTRO_SPAN } from './allianceScene.js';
import { t } from '../../../shared/i18n.js';
import { scriptOf } from '../../../shared/i18nPacks.js';

const ENTRY_SFX = '/assets/audio/sfx/customse/act1autochess/act1autochess_g_ui_load.mp3';
// the cue against the music as the recording mixes them (cue ×0.28, music ×0.18 of their files), at the default
// volumes (sfx 0.8 → ×0.576, bgm 0.6 → ×0.198 in audio.js _applyVolumes)
const SFX_GAIN = 0.54;

const CSS = `
.spa-entry{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;
  border:0;outline:0;overflow:hidden;background:#000;cursor:pointer;color:#dfe9ea}
.spa-entry::backdrop{background:transparent}
.spa-entry__gate{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  font-family:Bender,"Microsoft YaHei","Noto Sans SC",sans-serif;color:#dfe9ea;animation:spa-pulse 1.8s ease-in-out infinite}
.spa-entry__gate b{font:700 22px/1 "Microsoft YaHei","Noto Sans SC",sans-serif;letter-spacing:.4em;padding-left:.4em}
.spa-entry__gate i{font-style:normal;font-size:12px;letter-spacing:.5em;color:#47c9a9}
@keyframes spa-pulse{0%,100%{opacity:.55}50%{opacity:1}}
.spa-entry__skip{position:absolute;right:3%;bottom:3.5%;z-index:2;font:12px/1 "Microsoft YaHei","Noto Sans SC",sans-serif;
  letter-spacing:.2em;color:rgba(220,240,236,.45);pointer-events:none;transition:opacity .3s}`;

const mq = (q) => { try { return !!matchMedia(q).matches; } catch { return false; } };
/** A phone / tablet: a coarse (touch) pointer and no mouse. */
const touchDevice = () => (mq('(pointer: coarse)') || mq('(any-pointer: coarse)')) && !mq('(any-pointer: fine)');
/** Phones play the opening in landscape (in portrait the game shows its rotate hint; a 16:9 film would be a strip). */
function phoneReady() {
  return innerWidth > innerHeight;
}
/** Run `fn` now, or on a phone once phoneReady holds — if `still()` is true by then. */
function whenPhoneReady(still, fn) {
  if (!touchDevice() || phoneReady()) { fn(); return; }
  const EVENTS = [[window, 'resize'], [window, 'orientationchange']];
  let waiting = true;
  const stop = () => { waiting = false; EVENTS.forEach(([t, e]) => t.removeEventListener(e, check)); clearInterval(gone); };
  const check = () => {
    if (!waiting || !phoneReady()) return;
    stop();
    // let the rotation settle (device.js re-fires resize once the viewport has its final size)
    setTimeout(() => { if (still()) fn(); }, 400);
  };
  const gone = setInterval(() => { if (!still()) stop(); }, 1000);
  EVENTS.forEach(([t, e]) => t.addEventListener(e, check));
}

/** Decode the cue (and warm the lobby music) while the pictures load; null when nothing can be heard now. */
async function prepareSound() {
  const ctx = audio.ctx;
  if (!ctx || ctx.state !== 'running' || audio.volumes?.muted) return null;
  const track = resolveBgm(data.get('assets'), 'lobby');
  const wait = (p) => Promise.race([Promise.resolve(p).catch(() => null), new Promise((r) => setTimeout(() => r(null), 2500))]);
  const [sfx] = await Promise.all([wait(audio._buffer(ENTRY_SFX)), wait(track?.intro ? audio._buffer(track.intro) : null), wait(track ? audio._buffer(track.loop) : null)]);
  return { sfx };
}
/**
 * Hold the screen's music for the opening: the playing track fades out and every playBgm meanwhile is only remembered;
 * the release starts the remembered (else the last) track from its top — audio.js's own start, fade-in included.
 * Null when the music is silent or the player's own lobby music is set (audio.setLobbyTrack → audio.lobbyTrack): that
 * one keeps playing on — no fade, playBgm left alone.
 * @param {any} [a] the audio manager (tests pass a stand-in)
 * @returns {(() => void) | null} the release
 */
export function holdBgm(a = audio) {
  if (!a.ctx || a.bgmSilent || a.lobbyTrack || Object.prototype.hasOwnProperty.call(a, 'playBgm')) return null;
  let asked;
  a.playBgm = (key) => { asked = key; };
  try { ++a.bgmToken; a._fadeOutBgm(null, 0.4); } catch { /* ignore */ }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    delete a.playBgm;
    try { a.playBgm(asked !== undefined ? asked : a.lastBgmKey ?? 'lobby'); } catch { /* ignore */ }
  };
}

let playing = false;

/**
 * @param {() => boolean} allowed  false once the film must go (a room / a match, the caller's skip)
 * @param {(host: HTMLElement) => { render: (t: number) => void, grain: () => void, destroy: () => void }} mount
 */
function run(allowed, mount) {
  if (playing || !allowed()) return;
  playing = true;
  if (!document.getElementById('spa-entry-style')) {
    const st = document.createElement('style');
    st.id = 'spa-entry-style';
    st.textContent = CSS;
    document.head.append(st);
  }
  // a modal <dialog>: the top layer, so it also covers the fullscreen prompt (fullscreen-guide.js, a modal dialog too)
  const el = document.createElement('dialog');
  el.className = 'spa-entry';
  el.setAttribute('aria-label', t('卫戍协议') + ' · ' + t('盟约'));
  el.innerHTML = '<span class="spa-entry__skip"></span>';
  el.firstChild.textContent = t('点击跳过');
  const locked = !(audio.ctx && audio.ctx.state === 'running');
  const skipLabel = el.querySelector('.spa-entry__skip');
  let gate = Promise.resolve(), gateKey = null;
  if (locked) {
    skipLabel.style.opacity = '0';
    const card = document.createElement('div');
    card.className = 'spa-entry__gate';
    card.innerHTML = '<b></b><i>TAP TO START</i>';
    card.firstChild.textContent = t('点击进入');
    // the Latin line is a decoration under a CJK prompt; a Latin translation already says it
    if (scriptOf(t('点击进入')) === 'alphabetic') card.lastChild.remove();
    el.append(card);
    gate = new Promise((resolve) => {
      const go = () => {
        removeEventListener('keydown', go, true);
        card.remove(); skipLabel.style.opacity = '';
        // audio.js creates / resumes the context on this same gesture; give it a moment to start running
        const until = performance.now() + 600;
        const wait = () => (audio.ctx?.state === 'running' || performance.now() > until ? resolve() : setTimeout(wait, 30));
        setTimeout(wait, 0);
      };
      gateKey = go;
      el.addEventListener('pointerdown', go, { once: true });
      addEventListener('keydown', go, true);
    });
  }
  document.body.append(el);
  try { el.showModal(); } catch { el.setAttribute('open', ''); }

  let scene = null, raf = 0, release = null, bgmTimer = 0, done = false, src = null;
  const cleanup = () => {
    cancelAnimationFrame(raf);
    try { scene?.destroy(); } catch { /* ignore */ }
    try { el.close(); } catch { /* ignore */ }
    el.remove();
    playing = false;
  };
  /** 'end' (the film ran out), 'skip' (a tap / key) or 'leave' (the route left the title / lobby) */
  const finish = (how) => {
    if (done) return;
    done = true;
    unwatch();
    clearTimeout(bgmTimer);
    removeEventListener('keydown', onKey, true);
    if (gateKey) removeEventListener('keydown', gateKey, true);
    if (how === 'leave') {
      // a restored room / match: nothing of the film may sit over it or be heard in it
      try { src?.node.stop(0); src?.gain.disconnect(); } catch { /* ignore */ }
      release?.(); // the music goes back to audio.js, which plays the new screen's track
      cleanup();
      return;
    }
    release?.();
    if (how === 'skip') {
      // a skip: the cue stops with the picture (the music starts now, from its top)
      try { const t = audio.ctx.currentTime; src?.gain.gain.setTargetAtTime(0, t, 0.08); src?.node.stop(t + 0.5); } catch { /* ignore */ }
      el.style.transition = 'opacity .3s ease';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      setTimeout(cleanup, 320);
    } else cleanup();
  };
  const onKey = () => finish('skip');
  el.addEventListener('cancel', (e) => { e.preventDefault(); if (!locked) finish('skip'); }); // Esc skips like any other key
  // skipping is armed once the film runs (the gate's own tap must not skip it)
  const armSkip = () => { el.addEventListener('pointerdown', () => finish('skip')); addEventListener('keydown', onKey, true); };
  // the route, from the card on: a session restored into a room / a match takes the film down at once
  const unwatch = store.subscribe(() => { if (!done && !allowed()) finish('leave'); });

  const fonts = document.fonts?.load
    ? Promise.race([Promise.all(['300 40px Bender', '400 40px Bender'].map((f) => document.fonts.load(f).catch(() => null))), new Promise((r) => setTimeout(r, 1200))])
    : null;
  const pictures = preloadSprites(undefined, 3000);
  gate.then(() => Promise.all([pictures, fonts, prepareSound()])).then((res) => {
    if (done || !res) return;
    if (!allowed()) { finish('leave'); return; }
    const sound = res[2];
    armSkip();
    try { scene = mount(el); } catch (err) { console.warn('[intro] could not start', err); finish('end'); return; }
    const { from, fadeAt, to } = INTRO_SPAN;
    const lead = 0.04;
    const t0 = performance.now() + lead * 1000; // video second `from` is on screen at t0
    setCycleOrigin(t0 + (3.12 - from) * 1000); // the backdrop under the opening shows the same moment of the cycle
    if (sound && audio.ctx?.state === 'running') {
      const ctx = audio.ctx;
      if (sound.sfx && audio.sfxGain) {
        try {
          const node = ctx.createBufferSource(), gain = ctx.createGain();
          node.buffer = sound.sfx; gain.gain.value = SFX_GAIN;
          node.connect(gain); gain.connect(audio.sfxGain);
          node.start(ctx.currentTime + lead + (INTRO_AUDIO.sfxAt - from));
          src = { node, gain };
        } catch { /* ignore */ }
      }
      release = holdBgm();
      // audio.js starts a track 50 ms after it is asked for
      if (release) bgmTimer = setTimeout(() => release?.(), Math.max(0, (lead + INTRO_AUDIO.bgmAt - from - 0.05) * 1000));
    }
    const frame = () => {
      if (done) return;
      const T = from + (performance.now() - t0) / 1000;
      if (T >= to) { finish('end'); return; }
      if (T < 3.2) scene.grain();
      scene.render(Math.max(from, T));
      const fade = Math.min(1, Math.max(0, (T - fadeAt) / (to - fadeAt)));
      el.style.opacity = (1 - fade).toFixed(3);
      if (fade > 0) { el.style.pointerEvents = 'none'; skipLabel.style.opacity = '0'; }
      raf = requestAnimationFrame(frame);
    };
    scene.render(from);
    raf = requestAnimationFrame(frame);
  });
}

/**
 * Play the film once per page load, before the title screen — also when a reload lands in the lobby; never over a
 * room or a match, never without the art pack or under reduced motion.
 * @param {{ skip?: () => boolean, mount?: typeof mountAllianceIntro }} [opts]  skip() → true when it must not (or no
 *   longer) play; mount: the scene (tests pass a stand-in)
 */
export async function playEntryFilm(opts = {}) {
  const { skip = () => false, mount = mountAllianceIntro } = opts;
  if (reducedMotion()) return;
  try { await data.load('assets'); } catch { return; }
  if (!hasSprites()) return;
  const allowed = () => { const r = selectRoute(store.get()); return r !== 'room' && r !== 'game' && !skip(); };
  if (!allowed()) return;
  whenPhoneReady(allowed, () => run(allowed, mount));
}
