// Shared by invite links, loadouts and settings exports, including LAN / insecure contexts.
/** @param {string} text @returns {Promise<boolean>} */
export async function copyText(text) {
  try {
    if (globalThis.navigator?.clipboard && globalThis.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* use the selected-text fallback */ }
  let ta, prev;
  try {
    prev = document.activeElement;
    ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    // Keep the temporary selection inside the active focus trap (#433). The 16 px readonly field avoids iOS zoom
    // and its keyboard; do not disable the dialog's focus protection or copy a selection redirected to another field.
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;font-size:16px';
    const host = prev?.closest?.('[role="dialog"][aria-modal="true"], .guide') || document.body;
    host.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, ta.value.length); // iOS Safari ignores select() alone
    if (document.activeElement !== ta || ta.selectionStart !== 0 || ta.selectionEnd !== ta.value.length) return false;
    return !!document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta?.remove();
    if (prev?.isConnected) prev.focus?.({ preventScroll: true });
  }
}
