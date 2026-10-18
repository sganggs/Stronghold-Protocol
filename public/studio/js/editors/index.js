// public/studio/js/editors/index.js — the studio page's editor of each template (server/studio/templates/): which previews
// a section shows and what its slots take. One module per template — adding a template (the data, DSL, script and
// interface templates of a later step) is adding its module here beside the server's one; a template the page does not
// know yet still gets the generic slot list.

import art from './art.js';
import spine from './spine.js';
import voice from './voice.js';
import audio from './audio.js';
import numbers from './numbers.js';
import operator from './operator.js';
import dsl from './dsl.js';
import meta from './meta.js';
import mode from './mode.js';
import ui from './ui.js';
import script from './script.js';
import bond from './bond.js';
import item from './item.js';
import trait from './trait.js';
import offers from './offers.js';
import rules from './rules.js';
import theme from './theme.js';
import notices from './notices.js';
import fx from './fx.js';
import skins from './skins.js';

/**
 * @typedef {{ id: string, Component?: Function, previews?: (target: any) => string[], accept?: (slot: any) => string, multiple?: (slot: any) => boolean,
 *   hint?: (slot: any) => string }} StudioEditor
 *   previews: 'cards' (pictures in the game's interface), 'field' (the battlefield view), 'sound' (players)
 */

/** @type {Record<string, StudioEditor>} */
export const EDITORS = Object.freeze({ art, spine, voice, audio, numbers, operator, dsl, meta, mode, ui, script, bond, item, trait, offers, rules, theme, notices, fx, skins });

/** The editor of a template (a generic one for a template the page does not know). @param {string} id */
export function editorOf(id) {
  return EDITORS[id] || { id, previews: () => [], accept: () => '', multiple: () => true, hint: () => '' };
}
