// Compat shim (stronghold-ui-hub package) — install ONLY when the target has no public/js/ui/ownerName.js.
// The original deployment marks its owner's nickname (a coloured name + a 服主 badge). Without that: nobody is marked.
// Fill in isOwnerName yourself if your server wants the mark (the room and the 缺人同盟 card call it with a name).

/** @param {string} _name @returns {boolean} */
export function isOwnerName(_name) { return false; }

/** Plain DOM: put `name` (and `suffix`) into `element`. @param {Element} element @param {string} name @param {string} [suffix] */
export function decorateOwnerName(element, name, suffix = '') {
  if (!element) return element;
  element.textContent = `${name ?? ''}${suffix}`;
  return element;
}
