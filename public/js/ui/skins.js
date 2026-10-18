// 干员皮肤：客户端状态与同步 (docs/SKINS.md).
//
// Where an appearance comes from: NOT from data/*.json. A skin is written by a COSMETIC PLUGIN's overlay
// (docs/PLUGINS.md §9) — `chars[<charId>].illust` and `chars[<charId>].skins[<skinKey>] = { name, group, avatar,
// avatarE2, portrait, portraitE2, illust, spine: { front, back? } }` — so the source of truth is the composed asset
// manifest: data.get('assets'), which data.js shows through public/js/cosmetics.js `cosmetics.apply` (the room's visual
// set, then this player's personal plugins, over the installation's own manifest). The plugin is INSTALLED by the
// server's owner and switched on by each player in 设置 → 外观插件 (`scope: ["personal"]`: no room, no host, no cs).
//
// Two different things live here and keeping them apart is what makes the picker work:
//
//   * the CATALOGUE — `chars[<charId>].skins` of the manifest above: whatever the enabled plugins write, plus the
//     operator's own `illust` as the 默认 tile's art. A skin whose record has no Spine model is art only (see
//     `playable` in availableSkins): the renderer would fall back to the operator's own body, so it is shown but not
//     offered.
//   * the CHOICE — a plain `{ [charId]: skinId }` map, persisted per browser in localStorage and mirrored to the
//     server through `room.skins` — the shape the loadout uses (ui/loadoutSync.js installPrefSync), except that this
//     one is PUBLIC: the server puts it in `Match.publicView().players[].skins` and in every unit of a watched board,
//     which is how a teammate sees your skin (server/match/match/views.js).
//
// The key is the OPERATOR id (`char_498_inside`), not the chess id: the manifest groups skins under the operator, and
// an operator's normal, elite and 自选 pieces are the same operator — one entry covers all three. The renderer agrees:
// a unit's skin is looked up by `charId` (server/match/match/views.js `skinFor`).

import { createStore, loadPref, savePref } from '../store.js';
import { data } from '../data.js';
import { SKIN_LIMITS } from '../../../shared/protocol.js';

/** The localStorage preference (`sp.pref.<key>`) of this browser's skin choices: `{ [charId]: skinId }`. */
export const SKINS_PREF = 'skins';

/** The store field the sync engine watches (ui/loadoutSync.js installPrefSync `key`) and its sync state field. */
export const SKINS_KEY = 'skins';
export const SKINS_SYNC_KEY = 'skinsSync';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);

/**
 * Whether a skin record can be worn: it names a Spine model. Deliberately the RELAXED form of assets.js
 * `skinHasModel` (which additionally requires the resolved entry to pass `validSpine`), because this module is on the
 * boot path (main.js → screens/lobby.js → screens/loadout.js → ui/loadoutSync.js) and pulling the asset store in with
 * its Spine cache there would be a cost the title page never needs (test/ui/plugins-client.test.js pins that). The
 * difference can only be a skin whose model is written but does not resolve — the picker would offer it once and the
 * renderer would draw the operator's own body, which is the same fallback a plugin-withdrawn model gets.
 */
export const skinHasModel = (skin) => !!skin && isObj(skin.spine) && isObj(skin.spine.front) && typeof skin.spine.front.skel === 'string';

/**
 * A stored selection as the store holds it: `{ [charId]: skinId }`, both non-empty strings, at most
 * `SKIN_LIMITS.entries` of them.
 *
 * The cap is the WIRE's own (shared/protocol.js isSkinSelection) and it is applied here because this is the only parse
 * of a stored selection: the store's initial state, every edit (setSkins / setSkin / clearSkin) and what the sync sends
 * (ui/loadoutSync.js installSkinsSync `prepare`) all come through it. Over the limit is not a bigger message the server
 * trims — it is BAD_MSG for the whole `room.skins`, so nothing would be stored and the sync would sit in 'error'
 * (ui/loadoutSync.js installPrefSync). Pairs are kept in insertion order, the way the not-owned list keeps the first ids
 * it can hold (ui/ownershipModel.js cleanIds); only a hand-edited localStorage gets near the limit, and junk that is not
 * a pair does not spend the budget.
 */
export function parseStoredSkins(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  let kept = 0;
  for (const [charId, skinId] of Object.entries(raw)) {
    if (kept >= SKIN_LIMITS.entries) break;
    if (!str(charId) || !str(skinId)) continue;
    out[charId] = skinId;
    kept++;
  }
  return out;
}

/**
 * This browser's choices and their sync state, kept apart from the app store for the same reason the loadout is
 * (ui/loadoutSync.js: it must survive a room / match reset). `ui/loadoutSync.js installSkinsSync` watches
 * `SKINS_KEY` and mirrors it to the server as `room.skins`.
 */
export const skinsStore = createStore({ [SKINS_KEY]: parseStoredSkins(loadPref(SKINS_PREF, null)), [SKINS_SYNC_KEY]: 'idle' });

/**
 * Replace the whole stored selection (persisted at once; the sync engine picks the change up). Out-of-match data, so
 * nothing is sanitised away here: a stored id whose plugin is switched off today is kept, and comes back with it
 * (`chosenSkin` reports it as 默认 while it resolves to nothing).
 * @param {Record<string, string>} entries
 */
export function setSkins(entries) {
  const next = parseStoredSkins(entries);
  try { savePref(SKINS_PREF, next); } catch { /* private mode: the session keeps it */ }
  skinsStore.set({ [SKINS_KEY]: next });
}

/** Choose one operator's appearance. */
export function setSkin(charId, skinId) {
  const id = str(charId), skin = str(skinId);
  if (!id || !skin) return;
  setSkins({ ...(skinsStore.get()[SKINS_KEY] || {}), [id]: skin });
}

/** Drop one operator's choice (it goes back to its default model). */
export function clearSkin(charId) {
  const id = str(charId);
  const next = { ...(skinsStore.get()[SKINS_KEY] || {}) };
  if (!(id in next)) return;
  delete next[id];
  setSkins(next);
}

/** This browser's choice for one operator, or null. */
export const skinFor = (charId) => (str(charId) ? (skinsStore.get()[SKINS_KEY] || {})[charId] || null : null);

// ---- the catalogue (the composed asset manifest) --------------------------------------------------------------

/**
 * Every appearance of an operator the enabled plugins write, plus what the renderer makes of each (docs/SKINS.md).
 *
 * `playable` is the difference that matters: the skin's record holds a Spine model the client resolves
 * (`skinHasModel`). A skin without one is still listed — its art is worth looking at — but it is not offered (the
 * renderer would draw the operator's own body).
 *
 * Art falls back the way the renderer falls back, and NEVER to a placeholder: a skin that ships no portrait shows the
 * operator's own (its `illust`, then its `portrait`). That is why `portrait` / `avatar` / `illust` here are already
 * resolved URLs, not raw manifest fields.
 * @param {string} charId operator id (`char_498_inside`)
 * @returns {{ id: string, name: string, group: string, playable: boolean, portrait: string|null, avatar: string|null,
 *   illust: string|null }[]}
 */
export function availableSkins(charId) {
  const id = str(charId);
  if (!id) return [];
  const m = data.get('assets');
  const rec = m && isObj(m.chars) ? m.chars[id] : null;
  // a record without `skins` still has its own appearance (the 默认 row below), because the picker's global display rule
  // shows the section for an operator the plugins wrote no skin for (hasAnySkinChoices, docs/SKINS.md)
  if (!rec) return [];
  const ownIllust = str(rec.illust);
  const ownPortrait = str(rec.portrait);
  const ownAvatar = str(rec.avatar);
  const rows = [];
  for (const [skinId, skin] of Object.entries(isObj(rec.skins) ? rec.skins : {})) {
    if (!str(skinId) || !isObj(skin)) continue;
    const playable = skinHasModel(skin);
    // the tile art: the fixed-size portrait family first (a 1:2 box the grid lines up on), then the illustration, then
    // the avatar; the operator's own portrait when the skin ships none (`fallbackArt`, which the picker draws a little
    // differently so a plugin that replaced only the model is legible)
    const ownArt = str(skin.portrait) || str(skin.illust);
    const portrait = ownArt || ownPortrait;
    const avatar = str(skin.avatar) || str(skin.illust) || ownAvatar;
    const illust = str(skin.illust) || portrait;
    rows.push({
      id: skinId,
      name: str(skin.name) || skinId,
      group: str(skin.group) || '',
      playable,
      portrait,
      avatar,
      illust,
      fallbackArt: !ownArt && !str(skin.avatar),
      own: false,
    });
  }
  // The operator's OWN appearance, always the first row — even for a record the plugins wrote no `skins` under, because
  // the picker shows the section for every operator as soon as one of them has a skin (hasAnySkinChoices).
  //
  // The art is what a plugin wrote for the operator: its 立绘 `chars[<charId>].illust` when there is one — the picture a
  // plugin replaces for the operator itself (docs/PLUGINS.md §9), which the 默认 tile is the only place to see — else its
  // portrait, else its avatar. Preferring the 立绘 is deliberate: a plugin may give an operator a picture and no skin at
  // all, and that picture must be visible rather than staying in the manifest unread. The tile box is 1:2 and crops to
  // the top, exactly as it already does for a skin that ships only an illust. Never null while the record has any of
  // the three: an empty art box is the one thing this row must not draw.
  rows.unshift({
    id: '', name: '', group: '', playable: true,
    portrait: ownIllust || ownPortrait, avatar: ownAvatar,
    illust: ownIllust || ownPortrait, fallbackArt: false, own: true,
  });
  return rows;
}

/**
 * Whether the composed manifest offers a skin choice ANYWHERE: at least one operator of `data.get('assets').chars` has
 * one wear-able skin. This is the picker's display rule (docs/SKINS.md), and it is GLOBAL on purpose.
 *
 * The rule it replaced (a per-operator one, still available as `hasSkinChoices`) hid the whole section from every
 * operator a plugin wrote no skin for — so a player looking at such an operator could not tell "this operator has no
 * skin" from "the plugin did not load", and the feature read as broken. Since this rule, an operator without a skin
 * shows the section holding its 默认 tile alone: the plugin is plainly on, this operator simply has no look of its own.
 * Do NOT turn this back into a per-operator gate — that is the whole point of the change, and it reverses it.
 *
 * Nothing wearing anything means no section anywhere, keeping the promise that an installation without a cosmetic layer
 * looks exactly as it did before the feature: no plugin, a plugin that writes only pictures (`illust`) and no skin, or
 * only art-only skins (no model to wear).
 *
 * Counted through `hasSkinChoices` (one operator's rows at a time) so the global and the per-operator judgement can
 * never disagree about what a "wear-able skin" is.
 * @returns {boolean}
 */
export function hasAnySkinChoices() {
  const m = data.get('assets');
  const chars = m && isObj(m.chars) ? m.chars : null;
  if (!chars) return false;
  return Object.keys(chars).some((charId) => hasSkinChoices(charId));
}

/**
 * Whether ONE operator has a choice to offer at all: **默认 plus at least one wear-able appearance**.
 *
 * This is NOT the picker's display rule any more (that is `hasAnySkinChoices`, docs/SKINS.md): the section is shown for
 * every operator once one of them has a skin, so the single- 默认 box this returns false for is deliberately drawn.
 * Kept exported as the single-operator criterion — the question a badge, a filter or a future rule would ask, and what
 * `hasAnySkinChoices` is built from.
 *
 * A skin with art but no model does not count: it cannot be worn, so it is not a second choice.
 * @param {string} charId
 * @returns {boolean}
 */
export function hasSkinChoices(charId) {
  return availableSkins(charId).some((x) => !x.own && x.playable);
}

/**
 * The appearance this operator really wears for a stored selection, or null (默认).
 *
 * A stored id that is not one of THIS operator's wear-able appearances counts as no choice: the plugin may have been
 * switched off, the skin removed from its overlay, or the entry may name a model this client cannot resolve. The
 * entry itself is left alone — switching the plugin back on brings the appearance back — exactly as the renderer and
 * the server fall back to the default model for a skin they cannot resolve (assets.js spineEntry).
 * @param {string} charId @param {Record<string, string>} [entries] defaults to this browser's live selection
 * @returns {string|null}
 */
export function chosenSkin(charId, entries = null) {
  const id = str(charId);
  if (!id) return null;
  const want = str((entries || skinsStore.get()[SKINS_KEY] || {})[id]);
  if (!want) return null;
  return availableSkins(id).some((x) => !x.own && x.playable && x.id === want) ? want : null;
}

/** The files the picker reads: the composed manifest (the skins, and the 默认 tile's own art). */
export function loadSkinData() {
  data.load('assets').catch(() => {});
}
