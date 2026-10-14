// Compat shim (stronghold-ui package) — install ONLY when the target has no public/js/ui/namecards.js.
// 名片 (an account's name-card background) is a feature of the original deployment: its accounts service + its own card
// art (not distributed). Placeholder: no card is ever set (the local account's `card` is null), so a seat / plate shows
// no name-card layer. To add name cards: return the card's image here for a card id and give the account a `card`
// (AGENTS.md §3.2).
export const cardUrl = () => null;
export function NameCardLayer() { return null; }
export function nameCardLayer() { return null; }
export function loadNamecards() { return Promise.resolve([]); }
export function openNamecardPicker() {}
