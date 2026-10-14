// Compat shim (stronghold-ui-hub package) — install ONLY when the target has no public/js/federation.js.
// The original deployment links several servers into one room directory ("federation"). A single server: off.

/** Whether this page belongs to a federated directory. */
export const enabled = false;

/** This page's node id in the directory ('' when not federated). */
export function currentNode() { return ''; }
