// Recover an explicitly selected local seat; nickname and IP never identify a player.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal } from './components.js';
import { identity, net } from '../net.js';
import { store } from '../store.js';
import { t } from '../../../shared/i18n.js';
import { toast } from './toasts.js';

export function ResumeMatchButton() {
  const [items, setItems] = useState(() => identity.recoverable());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => setItems(identity.recoverable());
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    refresh();
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  if (!items.length) return null;
  const resume = async (item) => {
    if (busy) return;
    setBusy(true);
    if (await identity.resume(item.id)) {
      identity.setEntered(true);
      store.patch('session', { entered: true });
      // Keep the tentative token in this document until welcome persists it. Reloading here
      // would either lose the selection or falsely turn it into an established session claim.
      net.close();
      net.setName(item.name);
      net.connect();
      setOpen(false);
      setBusy(false);
    } else {
      setBusy(false);
      toast(t('此对局仍在其他窗口中，或当前浏览器无法安全恢复。请关闭原窗口后重试。'), 'warn');
    }
  };
  return html`<${Button} variant="secondary" size="sm" data-testid="resume-local-match" onClick=${() => setOpen(true)}>${t('恢复本机对局')}<//>
    <${Modal} open=${open} onClose=${() => !busy && setOpen(false)} title=${t('恢复本机对局')}>
      <p>${t('选择已关闭窗口的对局。服务器重启或对局过期后无法恢复。')}</p>
      ${items.map((item) => html`<${Button} key=${item.id} variant="secondary" block=${true} disabled=${busy} onClick=${() => resume(item)}>
        ${t('{name} · 同盟 {code}', { name: item.name || t('博士'), code: item.code || '—' })}<//>`)}
    <//>`;
}
