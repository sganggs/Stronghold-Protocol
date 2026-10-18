// public/studio/js/forge.js — 从 Forge 包导入 (DESIGN §32.12). A zip or a folder becomes a preview of the import report
// (POST /studio/api/forge/preview); confirming writes plugins/<id>/ (POST /studio/api/forge/import). The server never
// receives a path on its disk, and it never runs a script from the pack. The same studio key as every other change.
// A read clears the previous payload and report immediately. A late FileReader or a late preview cannot confirm.
// 「不生成脚本插件」 sends noScripts (the CLI's --no-scripts): the pack's kits/ do not become a script plugin. Toggling it
// clears the report, so confirm always writes what the last preview showed.

import { useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button } from '../../js/ui/components.js';
import { t } from '../../../shared/i18n.js';
import { post, fileBase64 } from './api.js';
import { errorText } from './issues.js';

/** The page refuses a pack bigger than this before it uploads (the server still enforces its own limit). */
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * The dialog (see the header).
 * @param {{ open: boolean, onClose: () => void, onImported: (plugins: { id: string, class: string }[]) => void }} props
 */
export function ForgeDialog({ open, onClose, onImported }) {
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [report, setReport] = useState(null);
  const [payload, setPayload] = useState(null);
  const [noScripts, setNoScripts] = useState(false);
  const [offline, setOffline] = useState(false);
  const zipRef = useRef(null);
  const dirRef = useRef(null);
  const gen = useRef(0);
  const payloadGen = useRef(0);
  const reportGen = useRef(0);
  const ticket = useRef(0);
  // a layout effect: the reset on open runs in the same task as the render, so a file chosen right after the dialog
  // appears is never invalidated by it (an effect ran later, bumped `gen` past that read and left Preview disabled)
  useLayoutEffect(() => {
    const mine = ++gen.current;
    payloadGen.current = 0;
    reportGen.current = 0;
    ticket.current += 1;
    setOffline(false);
    if (!open) {
      setBusy(false); setReading(false); setError(''); setNote(''); setReport(null); setPayload(null); setNoScripts(false);
      return () => { gen.current += 1; };
    }
    setBusy(false); setReading(false); setError(''); setNote(''); setReport(null); setPayload(null); setNoScripts(false);
    if (zipRef.current) zipRef.current.value = '';
    if (dirRef.current) dirRef.current.value = '';
    return () => { if (gen.current === mine) gen.current += 1; };
  }, [open]);
  const tooBig = () => { setError(t('包太大，超过 {max}。', { max: '64 MB' })); setPayload(null); setReport(null); setNote(''); };
  const beginRead = () => {
    const mine = ++gen.current;
    payloadGen.current = 0;
    reportGen.current = 0;
    ticket.current += 1;
    setReading(true);
    setBusy(false);
    setPayload(null);
    setReport(null);
    setError('');
    setNote(t('正在读取 Forge 包…'));
    return mine;
  };
  const takeZip = async (file) => {
    if (!file) return;
    const mine = beginRead();
    if (file.size > MAX_BYTES) {
      if (gen.current === mine) { tooBig(); setReading(false); }
      return;
    }
    try {
      const zip = await fileBase64(file);
      if (gen.current !== mine) return;
      payloadGen.current = mine;
      setPayload({ zip });
    } catch (e) {
      if (gen.current !== mine) return;
      setError(errorText(e));
      setPayload(null);
    } finally {
      if (gen.current === mine) { setReading(false); setNote(''); }
    }
  };
  const takeDir = async (list) => {
    const files = [...list];
    if (!files.length) return;
    const mine = beginRead();
    let total = 0;
    for (const f of files) total += f.size;
    if (total > MAX_BYTES) {
      if (gen.current === mine) { tooBig(); setReading(false); }
      return;
    }
    try {
      const out = [];
      for (const f of files) {
        if (gen.current !== mine) return;
        const rel = String(f.webkitRelativePath || f.name).replace(/\\/g, '/');
        const parts = rel.split('/').filter(Boolean);
        const name = parts.length > 1 ? parts.slice(1).join('/') : rel;
        out.push({ name, data: await fileBase64(f) });
      }
      if (gen.current !== mine) return;
      payloadGen.current = mine;
      setPayload({ files: out });
    } catch (e) {
      if (gen.current !== mine) return;
      setError(errorText(e));
      setPayload(null);
    } finally {
      if (gen.current === mine) { setReading(false); setNote(''); }
    }
  };
  const preview = async () => {
    if (!payload || reading) return;
    const mine = gen.current;
    const minePayload = payloadGen.current;
    const mineTicket = ++ticket.current;
    setBusy(true); setError('');
    try {
      const r = await post('forge/preview', { ...payload, ...(noScripts ? { noScripts: true } : {}), ...(offline ? { offline: true } : {}) });
      if (gen.current !== mine || payloadGen.current !== minePayload || ticket.current !== mineTicket) return;
      reportGen.current = minePayload;
      setReport(r.report);
    } catch (e) {
      if (gen.current !== mine || payloadGen.current !== minePayload || ticket.current !== mineTicket) return;
      reportGen.current = 0;
      setReport(null);
      setError(errorText(e));
    } finally {
      if (ticket.current === mineTicket) setBusy(false);
    }
  };
  const confirm = async () => {
    if (!payload || reading || reportGen.current !== payloadGen.current || !report?.products?.length) return;
    const mine = gen.current;
    const minePayload = payloadGen.current;
    const mineTicket = ++ticket.current;
    setBusy(true); setError('');
    try {
      const r = await post('forge/import', { ...payload, ...(noScripts ? { noScripts: true } : {}), ...(offline ? { offline: true } : {}) });
      if (gen.current !== mine || payloadGen.current !== minePayload || ticket.current !== mineTicket) return;
      setReport(r.report);
      reportGen.current = minePayload;
      if (!r.report?.ok || !r.report.products?.length) { setError(r.report?.check || t('这个包没有可以写入的插件。')); return; }
      setNote(t('已写入 {n} 个插件', { n: String((r.plugins || r.report.products).length) }));
      onImported(r.plugins || []);
    } catch (e) {
      if (gen.current !== mine || ticket.current !== mineTicket) return;
      setError(errorText(e));
    } finally {
      if (ticket.current === mineTicket) setBusy(false);
    }
  };
  const toggleScripts = (on) => {
    // a different product list: the report on screen no longer describes what confirm would write
    ticket.current += 1;
    reportGen.current = 0;
    setReport(null);
    setBusy(false);
    setNoScripts(on);
  };
  const locked = busy || reading;
  const hasScript = !!report?.products?.some((p) => p.class === 'script');
  const canWrite = !!(report?.ok && report.products?.length && reportGen.current === payloadGen.current && !reading);
  const actions = html`
    <${Button} onClick=${onClose} disabled=${locked}>${t('取消')}<//>
    <${Button} onClick=${preview} loading=${busy} disabled=${!payload || locked} data-testid="forge-preview">${t('预览导入报告')}<//>
    <${Button} variant="primary" onClick=${confirm} loading=${busy} disabled=${!canWrite || locked} data-testid="forge-confirm">${t('确认写入插件')}<//>`;
  return html`<${Modal} open=${open} title=${t('从 Forge 包导入')} onClose=${locked ? undefined : onClose} width="9.4rem" actions=${actions}>
    <div class="st-step" data-reading=${reading ? '1' : undefined}>
      <p class="st-note">${t('选择一个 Forge 工坊包（zip 或文件夹）。先预览报告，确认后才写入 plugins/。')}</p>
      <label class="st-forge-file">${t('从 Forge 包导入')} zip
        <input ref=${zipRef} type="file" accept=".zip,application/zip" data-testid="forge-zip" disabled=${locked}
          onChange=${(e) => { const f = e.currentTarget.files?.[0]; if (dirRef.current) dirRef.current.value = ''; takeZip(f); }} />
      </label>
      <label class="st-forge-file">${t('从 Forge 包导入')}
        <input ref=${dirRef} type="file" webkitdirectory=${true} directory=${true} multiple=${true} data-testid="forge-folder" disabled=${locked}
          onChange=${(e) => { if (zipRef.current) zipRef.current.value = ''; takeDir(e.currentTarget.files || []); }} />
      </label>
      <label class="st-check"><input type="checkbox" checked=${noScripts} disabled=${locked} data-testid="forge-no-scripts"
        onChange=${(e) => toggleScripts(e.currentTarget.checked)} /> ${t('不生成脚本插件（kits/ 里的行为脚本）')}</label>
      <label class="st-check"><input type="checkbox" checked=${offline} disabled=${locked} data-testid="forge-offline"
        onChange=${(e) => { toggleScripts(noScripts); setOffline(e.currentTarget.checked); }} /> ${t('离线导入（不下载官方数据表）')}</label>
      ${note ? html`<p class="st-note">${note}</p>` : null}
      ${error ? html`<p class="st-error" role="alert">${error}</p>` : null}
      ${report && !report.products?.length ? html`<p class="st-note">${report.needsManualAdaptation ? t('需要人工适配') : t('这个包没有可以写入的插件。')}</p>` : null}
      ${hasScript ? html`<p class="st-note" data-testid="forge-script-note">${t('脚本插件只在服主开启 SP_PLUGIN_SCRIPTS=sandbox（或受信任模式）并且房间选中它时运行；导入时没有执行它。')}</p>` : null}
      ${report ? html`<div>
        <h3 class="st-note">${t('导入报告')}</h3>
        <pre class="st-forge-report" data-testid="forge-report">${report.markdown || ''}</pre>
      </div>` : null}
    </div>
  </${Modal}>`;
}
