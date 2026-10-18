// 公告 (DESIGN §34.14). A button on the title screen and the lobby, only when the server's catalogue has at least
// one notice. Opening the popup marks every notice on screen as seen (sp.pref.notices-seen). The body is text,
// never HTML. With no notices the button is not rendered.

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button } from './components.js';
import { useStore } from '../store.js';
import { catalog, loadCatalog, installedCount, pluginName } from '../content.js';
import { useLang } from './lang.js';
import { t } from '../../../shared/i18n.js';
import { noticeView, readSeen, markSeen } from '../../../shared/plugins/notices.js';

/** Title and lobby entry. Renders nothing when this server has no notice. */
export function NoticesButton() {
  const installed = useStore((s) => installedCount(s) > 0 || s.installedNotices === true);
  const cat = useStore((s) => s, Object.is, catalog);
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => readSeen());
  useEffect(() => { if (installed) loadCatalog(); }, [installed]);
  if (!installed) return null;
  const view = noticeView(cat.plugins, lang, seen, pluginName);
  if (!view.notices.length) return null;
  const openPopup = () => {
    setSeen(markSeen(view.notices.map((n) => n.key)));
    setOpen(true);
  };
  return html`<span class="notice-slot">
    <button type="button" class="notice-entry tapx" data-testid="notices-open" aria-label=${t('公告')} onClick=${openPopup}>
      ${t('公告')}
      ${view.unread ? html`<span class="notice-entry__dot" aria-label=${t('有未读公告')}></span>` : null}
    </button>
    <${Modal} open=${open} title=${t('公告')} micro="NOTICES" onClose=${() => setOpen(false)}
      actions=${html`<${Button} variant="primary" onClick=${() => setOpen(false)}>${t('关闭')}<//>`}>
      <div class="notice-list">
        ${view.notices.map((n) => html`<article key=${n.key} class="notice-card" data-notice=${n.key}>
          <p class="notice-card__meta">${n.pluginName}${n.date ? ` · ${n.date}` : ''}</p>
          <h3 class="notice-card__title">${n.title}</h3>
          <p class="notice-card__body">${n.body}</p>
        </article>`)}
      </div>
    <//>
  </span>`;
}
