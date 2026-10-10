// Install prompts are browser-issued, one-use capabilities. No service worker or application cache is installed.
export function createPwaInstall(win) {
  let prompt = null, installed = false;
  const listeners = new Set();
  const display = win?.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)');
  const available = () => !!prompt && !installed && !display?.matches && !win?.navigator?.standalone;
  const emit = () => { for (const fn of listeners) fn(available()); };
  const offer = (event) => {
    if (installed || display?.matches || win?.navigator?.standalone || typeof event.prompt !== 'function') return;
    event.preventDefault();
    prompt = event;
    emit();
  };
  const done = () => { installed = true; prompt = null; emit(); };
  win?.addEventListener?.('beforeinstallprompt', offer);
  win?.addEventListener?.('appinstalled', done);
  display?.addEventListener?.('change', emit);
  return {
    available,
    subscribe(fn) { listeners.add(fn); fn(available()); return () => listeners.delete(fn); },
    async request() {
      if (!available()) return false;
      const event = prompt;
      prompt = null; // Consume before awaiting: dismissal, rejection and repeated clicks cannot reuse this event.
      emit();
      try {
        const result = await event.prompt();
        const choice = event.userChoice ? await event.userChoice : result;
        return choice?.outcome === 'accepted';
      } catch { return false; }
    },
    dispose() {
      win?.removeEventListener?.('beforeinstallprompt', offer);
      win?.removeEventListener?.('appinstalled', done);
      display?.removeEventListener?.('change', emit);
      prompt = null; listeners.clear();
    },
  };
}
export const pwaInstall = createPwaInstall(globalThis.window);
