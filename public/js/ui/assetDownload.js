// The title screen's 下载完整素材 (docs/history/0.3.0.md §32.14.23): the button, its hint line and the dialog, which starts the
// download queue (assetDownload.js) as it opens; closing it pauses. The import of a local pack has its own button beside
// this one (ui/assetImport.js, §32.14.39): a file already imported counts as ready here and is not requested again.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal, ProgressBar } from './components.js';
import { assetDownload } from '../assetDownload.js';
import { t } from '../../../shared/i18n.js';

/** 下载完整素材: the button, its hint line and the download dialog. */
export function AssetDownloadButton() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(() => assetDownload.get());
  useEffect(() => {
    const off = assetDownload.subscribe(setState);
    setState(assetDownload.get());
    return () => {
      off();
      assetDownload.pause();
    };
  }, []);
  const busy = ['preparing', 'downloading'].includes(state.phase);
  const close = () => {
    assetDownload.pause();
    setOpen(false);
  };
  const status = state.phase === 'complete' ? t('本次素材下载完成')
    : state.phase === 'preparing' ? t('正在读取素材清单…')
      : state.phase === 'paused' ? t('素材下载已暂停')
        : state.phase === 'error' ? t('无法读取素材清单，请检查网络后重试。')
          : state.phase === 'partial' ? t('有 {n} 个素材下载失败', { n: state.failures.length })
            : t('正在下载素材…');
  const label = state.phase === 'complete' ? t('素材已下载')
    : state.phase === 'paused' ? t('继续下载素材') : t('下载完整素材');

  // done includes both imported files and fully read downloads; cached counts imports only.
  const ready = state.done || 0;
  const missing = Math.max(0, (state.total || 0) - ready);
  return html`<div class="title-assets__item">
    <${Button} variant="secondary" block=${true} size="sm" data-testid="asset-download" aria-describedby="title-asset-download-hint" onClick=${() => {
      setOpen(true);
      if (state.phase !== 'complete') void assetDownload.start();
    }}>${label}<//>
    <small id="title-asset-download-hint">${t('含模型、贴图和音频，建议使用 Wi-Fi 下载。')}</small>
    <${Modal} open=${open} onClose=${close} title=${t('下载完整素材')} class="asset-download" actions=${html`
      ${busy ? html`<${Button} onClick=${() => assetDownload.pause()}>${t('暂停下载')}<//>`
        : html`<${Button} variant="primary" data-testid="asset-download-resume" onClick=${() => void assetDownload.start()}>
          ${state.phase === 'complete' ? t('重新检查') : state.phase === 'paused' ? t('继续下载素材') : t('重试下载')}<//>`}
      <${Button} onClick=${close}>${t('关闭')}<//>`}>
      <p role="status" data-testid="asset-download-status">${status}</p>
      <${ProgressBar} value=${state.done} max=${state.total || 1} label=${t('已完成 {done} / {total} 个文件', { done: state.done, total: state.total })} />
      <p>${t('已读取 {size} MB（含浏览器缓存）', { size: (state.bytes / 1048576).toFixed(1) })}</p>
      ${state.total > 0 ? html`<p>${t('已就绪 {ready}，缺少 {missing}', { ready, missing })}</p>` : null}
      <p class="t-lo">${t('已导入的素材直接使用，不再向服务器请求。')}</p>
      <p class="t-lo">${t('下载本服务器提供的素材到浏览器缓存。关闭窗口会暂停；缓存被清理后可再次下载。')}</p>
      ${state.localMissing ? html`<p class="t-lo">${t('服务器未提供额外的本地素材包，将使用基础素材。')}</p>` : null}
      ${state.failures.length ? html`<div class="asset-download__errors">
        <p>${t('下载未完成。请重试；若文件持续缺失，请联系服主补齐素材。')}</p>
        <details><summary>${t('查看失败文件')}</summary><ul>
          ${state.failures.slice(0, 30).map((item) => html`<li key=${item.url}><code>${item.url}</code> (${item.status})</li>`)}
        </ul></details>
      </div>` : null}
    <//>
  </div>`;
}
