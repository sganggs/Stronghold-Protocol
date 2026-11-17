import { h } from '../../vendor/preact.module.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button } from './components.js';
import { createStore, useStore, selectRoute } from '../store.js';
import { APP_VERSION } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';
import { RELEASE_SEEN_PREFIX, releaseSections, releaseLink } from './releaseNotesModel.js';

const request = createStore({ serial: 0 });
export function ReleaseNotesButton() {
  return html`<button type="button" class="title-repo release-notes-entry" onClick=${() => request.set((s) => ({ serial: s.serial + 1 }))}>${t('更新说明')}</button>`;
}

function inline(text) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^\s)]+\))/g).map((part) => {
    if (part.startsWith('`')) return html`<code>${part.slice(1, -1)}</code>`;
    if (part.startsWith('**')) return html`<strong>${part.slice(2, -2)}</strong>`;
    if (part.startsWith('*')) return html`<em>${part.slice(1, -1)}</em>`;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link && releaseLink(link[2])) return html`<a href=${releaseLink(link[2])} target="_blank" rel="noopener noreferrer">${link[1]}</a>`;
    return part;
  });
}

/** Small text-only Markdown renderer for the changelog's headings, lists, paragraphs and fenced code. */
export function ReleaseMarkdown({ text }) {
  const blocks = [];
  const lines = text.trim().split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^```/.test(line)) {
      const code = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      blocks.push(html`<pre><code>${code.join('\n')}</code></pre>`);
    } else if (/^#{3,6} /.test(line)) {
      const [, hashes, title] = line.match(/^(#+) (.*)$/);
      blocks.push(h(`h${hashes.length}`, {}, inline(title)));
    } else if (/^[-*] /.test(line)) {
      const items = [];
      do { items.push(html`<li>${inline(lines[i].slice(2))}</li>`); } while (++i < lines.length && /^[-*] /.test(lines[i]));
      i--;
      blocks.push(html`<ul>${items}</ul>`);
    } else blocks.push(html`<p>${inline(line)}</p>`);
  }
  return html`<article class="release-notes-body">${blocks}</article>`;
}

export function ReleaseNotesHost() {
  const safe = useStore((s) => ['title', 'lobby'].includes(selectRoute(s)) && !s.ui.restoring);
  const serial = useStore((s) => s.serial, Object.is, request);
  const [sections, setSections] = useState([]);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const attempted = useRef(false);
  const handled = useRef(0);
  useEffect(() => {
    if (!safe) return undefined;
    const manual = serial !== handled.current;
    if (!manual && attempted.current) return undefined;
    let seen = false;
    try { seen = localStorage.getItem(RELEASE_SEEN_PREFIX + APP_VERSION) === '1'; } catch { /* private mode: once per page */ }
    if (!manual && seen) return undefined;
    let cancelled = false;
    fetch('/CHANGELOG.md', { cache: 'no-cache' }).then((res) => {
      if (!res.ok) throw new Error(`CHANGELOG: ${res.status}`);
      return res.text();
    }).then((text) => {
      const entries = releaseSections(text, APP_VERSION);
      if (!entries.length) throw new Error('Missing current release');
      if (cancelled) return;
      setSections(entries); setIndex(0); setFailed(false); setOpen(true);
      attempted.current = true; handled.current = serial;
    }).catch(() => {
      if (cancelled) return;
      attempted.current = true; handled.current = serial;
      if (manual) { setFailed(true); setOpen(true); }
    });
    return () => { cancelled = true; };
  }, [safe, serial]);
  const close = () => {
    if (!failed && sections.length) {
      try { localStorage.setItem(RELEASE_SEEN_PREFIX + APP_VERSION, '1'); } catch { /* private mode */ }
    }
    setOpen(false);
  };
  return html`<${Modal} open=${safe && open} title=${t('更新说明')} micro=${failed ? '' : sections[index]?.title}
    class="release-notes" width="min(10rem, 94vw)" onClose=${close}
    actions=${html`<${Button} disabled=${failed || index === 0} onClick=${() => setIndex(index - 1)}>${t('更新版本')}<//>
      <${Button} disabled=${failed || index >= sections.length - 1} onClick=${() => setIndex(index + 1)}>${t('更早版本')}<//>
      <${Button} variant="primary" onClick=${close}>${t('关闭')}<//>`}>
    ${failed ? html`<p>${t('更新说明加载失败，请稍后重试。')}</p>` : html`<${ReleaseMarkdown} key=${index} text=${sections[index]?.body || ''} />`}
  <//>`;
}
