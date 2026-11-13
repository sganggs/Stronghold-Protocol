// Shared preference state without loading the settings modal / audio just to read image visibility.
// settings.js owns persistence and the audio / document effects, as before.
import { createStore, loadPref } from '../store.js';
import { sanitizeSettings } from './gameLogic/settings.js';

/** Settings store: { bgm, sfx, voice, voiceLang, voiceNative, voiceOverrides, muted, damageNumbers, officialDamageNumbers, ammoEnergyCount, fullscreenWakeLock, bondTimers, combatMetrics, prepDeployFold, quality, officialFx, otherSkins, textSize, uiTheme, keys }. uiTheme empty = the built-in interface (docs/THEMES.md). */
export const settingsStore = createStore(sanitizeSettings(loadPref('settings', null)));
