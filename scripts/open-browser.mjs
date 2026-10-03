// Opening the game page in the player's browser.
//
// Why not `rundll32 url.dll,FileProtocolHandler` (the usual one-liner): it runs *inside* the caller's token, so a
// launcher started from an elevated console starts Edge/Chrome **elevated** too — and from then on Edge greets the
// player with 「Microsoft Edge 未响应，因为现有实例正在以提升的权限运行。是否要用普通权限重启现有实例? 是/否」
// instead of just opening the page.
//
// `explorer.exe <url>` avoids that because Explorer is not the process that opens the browser: a second Explorer
// invocation hands the request to the shell instance that is already running, and *that* one (started at logon, not
// elevated) resolves the URL through the default-browser association. Caveat: this hand-off is how the shell behaves
// in practice, not an interface Microsoft documents or promises — treat it as the best available trick rather than a
// supported API, and keep the rundll32 rung around for hosts where explorer.exe cannot be found.
//
// Windows therefore has a single rung, chosen synchronously from what is actually on disk: explorer.exe when it is
// there, rundll32 otherwise. There is deliberately no "try one, fall back on spawn failure" ladder: spawn() reports
// ENOENT / EACCES through the child's asynchronous `error` event, not by throwing, so a fallback wired to a thrown
// exception would never fire in practice.
//
// There is deliberately no `cmd /c start "" <url>` rung either: cmd re-parses everything after `/c`, so a URL holding
// an `&` (e.g. the room link `?room=ABCD&name=…`) is split at the `&` — cmd runs `start "" <url-up-to-&>` and then
// tries to run the remainder as a second command. The browser then opens a truncated address, or a stray console
// window flashes. Passing an argument array to CreateProcess avoids the shell entirely, which is why the remaining
// rungs are safe.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** Does this path exist? Injectable as `exists` so the Windows rung can be tested without the host's filesystem. */
function realExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

/**
 * Absolute path of a system executable, or null when it is not where we expect it.
 *
 * Built with **win32** semantics whatever the host is: the value is handed to a Windows process, and the rung is
 * also inspected from tests (CI runs them on Linux, where `path.join` is posix and would emit `C:\Windows/explorer.exe`
 * — a mixed-separator string that never matches a real Windows path).
 * @param {NodeJS.ProcessEnv} env
 * @param {string} sub subdirectory under the Windows root ('' / '.' for the root itself)
 * @param {string} name
 * @param {(p: string) => boolean} exists
 * @returns {string | null}
 */
function systemExe(env, sub, name, exists) {
  const root = env.SystemRoot || env.windir || 'C:\\Windows';
  const abs = path.win32.join(root, sub || '.', name);
  return exists(abs) ? abs : null;
}

/**
 * Candidate launch commands for `url`, best first.
 *
 * At most one entry per platform: which rung Windows gets is decided here, synchronously, from the filesystem.
 * @param {string} url
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean }} [o]
 *   `exists` defaults to the real filesystem; pass one in to test the Windows rung from any host.
 * @returns {{ cmd: string, args: string[], label: string }[]}
 */
export function browserCommands(url, { platform = process.platform, env = process.env, exists = realExists } = {}) {
  if (platform === 'win32') {
    // shell association: the default browser, opened by the non-elevated shell instance (see the header)
    const explorer = systemExe(env, '.', 'explorer.exe', exists);
    if (explorer) return [{ cmd: explorer, args: [url], label: 'explorer' }];
    // legacy fallback for the theoretical case of a Windows host without explorer.exe; it *does* inherit our token,
    // so it is only ever reached when the de-elevating rung is unavailable
    const rundll32 = systemExe(env, 'System32', 'rundll32.exe', exists);
    if (rundll32) return [{ cmd: rundll32, args: ['url.dll,FileProtocolHandler', url], label: 'rundll32' }];
    return [];
  }
  if (platform === 'darwin') return [{ cmd: 'open', args: [url], label: 'open' }];
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return [{ cmd: 'xdg-open', args: [url], label: 'xdg-open' }];
  return [];
}

/**
 * Open `url` with the player's default browser. Returns the label of the launcher that was spawned, or null when
 * there is nothing to start (headless Linux, no known system binary) — callers then just print the URL.
 *
 * The label is returned as soon as spawn() accepted the command. A missing binary surfaces later as the child's
 * `error` event (ENOENT / EACCES), which is why one is attached: an unhandled `error` event would crash the
 * launcher, and retrying a different rung at that point would mean opening a second browser after a race.
 * @param {string} url
 * @param {{ spawnImpl?: typeof spawn, platform?: string, env?: NodeJS.ProcessEnv,
 *           exists?: (p: string) => boolean, log?: (m: string) => void }} [o]
 * @returns {string | null}
 */
export function openBrowser(url, { spawnImpl = spawn, platform = process.platform, env = process.env, exists = realExists, log } = {}) {
  for (const { cmd, args, label } of browserCommands(url, { platform, env, exists })) {
    try {
      const child = spawnImpl(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
      if (!child || typeof child.unref !== 'function') continue;
      child.on?.('error', () => {});
      child.unref();
      return label;
    } catch (err) {
      log?.(`${label}: ${err?.code || err?.message || err}`);
    }
  }
  return null;
}
