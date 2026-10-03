// Clipboard helper shared by the room screen (invite code / link) and 干员调配 (导出 / 导入 payloads).
//
// Lives here rather than in a screen: `screens/room.js` imports `screens/loadout.js` (the 干员调配 button), so loadout
// importing the helper back from room would be a cycle.

/**
 * Copy text to the clipboard (async API with a textarea fallback for insecure contexts).
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyText(text) {
  try {
    if (globalThis.navigator?.clipboard && globalThis.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    // 16 px: iOS zooms into smaller focused fields; `readonly` keeps the keyboard away
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    ta.select();
    // iOS Safari ignores select() on a textarea: an explicit range is what it copies (LAN play over http has no
    // navigator.clipboard, so this path is the one iPhones / iPads take)
    try { ta.setSelectionRange(0, ta.value.length); } catch { /* ignore */ }
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
