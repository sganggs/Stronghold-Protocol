// Local import panel in resource management. Unmounting cancels imports; stored bytes remain.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, ProgressBar, confirmDialog } from './components.js';
import { assetImport } from '../assetPack.js';
import { askPersistStorage, clearImportedAssets, countImportedFiles, importSupport, storageEstimate } from '../assetCache.js';
import { t } from '../../../shared/i18n.js';

function importStatus(state) {
  if (state.phase === 'reading') return t('正在读取素材包…');
  if (state.phase === 'importing') return t('正在校验并写入…');
  if (state.phase === 'complete') return t('导入完成');
  if (state.phase === 'partial') return t('导入结束，有文件未通过校验');
  if (state.phase === 'empty') return t('没有找到与服务器清单一致的素材。');
  if (state.phase === 'cancelled') return t('导入已取消');
  if (state.phase === 'error' && state.error === 'bad-zip') return t('素材包不是有效的 zip。');
  if (state.phase === 'error' && state.error === 'manifest') return t('无法读取素材清单，导入已停止。');
  if (state.phase === 'error') return t('导入失败。');
  return '';
}

function walkEntry(entry, prefix, out) {
  if (!entry) return Promise.resolve();
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((file) => {
        out.push({ path, read: async () => new Uint8Array(await file.arrayBuffer()) });
        resolve();
      }, () => resolve());
    });
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const readBatch = () => new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    return (async () => {
      for (;;) {
        const batch = await readBatch();
        if (!batch.length) break;
        for (const child of batch) await walkEntry(child, path, out);
      }
    })().catch(() => {});
  }
  return Promise.resolve();
}

async function walkHandle(dir, prefix, out) {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'file') {
      out.push({
        path,
        read: async () => new Uint8Array(await (await handle.getFile()).arrayBuffer()),
      });
    } else if (handle.kind === 'directory') {
      await walkHandle(handle, path, out);
    }
  }
}

/** Resource manager local-import panel; mounting only reads local storage metadata. */
export function AssetImportPanel() {
  const [imported, setImported] = useState(() => assetImport.get());
  const [storeInfo, setStoreInfo] = useState(null);
  const [persistNote, setPersistNote] = useState(null);
  const folderRef = useRef(null);
  const zipRef = useRef(null);
  useEffect(() => {
    const off = assetImport.subscribe(setImported);
    setImported(assetImport.get());
    return () => {
      off();
      assetImport.cancel();
    };
  }, []);
  // Cache Storage and the storage estimate only: nothing goes to the server. Read as the dialog opens and when an import
  // ends, never per stored file: listing a cache of 30,000 entries ten times a second made a whole-pack import quadratic.
  const importBusy = ['reading', 'importing'].includes(imported.phase);
  useEffect(() => {
    if (importBusy || !importSupport().ok) return undefined;
    let stop = false;
    (async () => {
      const count = await countImportedFiles();
      const est = await storageEstimate();
      if (!stop) setStoreInfo({ count, usage: est?.usage ?? null });
    })().catch(() => {});
    return () => { stop = true; };
  }, [imported.phase]);
  useEffect(() => {
    if (imported.accepted <= 0 || !['complete', 'partial'].includes(imported.phase)) return undefined;
    let stop = false;
    (async () => {
      const kept = await askPersistStorage();
      if (!stop) setPersistNote(kept);
    })().catch(() => {});
    return () => { stop = true; };
  }, [imported.phase, imported.accepted]);
  const support = importSupport();
  const importText = importStatus(imported);
  const showImportCounts = ['complete', 'partial', 'empty', 'cancelled', 'error'].includes(imported.phase)
    && (imported.accepted + imported.rejected + imported.skipped + imported.failed) > 0;

  const startFiles = (files) => {
    if (!files?.length || !support.ok) return;
    void assetImport.start({ type: 'files', files });
  };
  const onFolderInput = (event) => {
    const input = event.currentTarget;
    const files = [...(input.files || [])].map((file) => ({
      path: file.webkitRelativePath || file.name,
      read: async () => new Uint8Array(await file.arrayBuffer()),
    }));
    input.value = '';
    startFiles(files);
  };
  const onZipInput = (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (file && support.ok) void assetImport.start({ type: 'zip', data: file });
  };
  const chooseFolder = async () => {
    if (!support.ok || importBusy) return;
    const picker = globalThis.showDirectoryPicker;
    if (typeof picker === 'function') {
      try {
        const dir = await picker();
        const files = [];
        await walkHandle(dir, dir.name || '', files);
        if (files.length) startFiles(files);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    folderRef.current?.click();
  };
  const onDrop = async (event) => {
    event.preventDefault();
    if (!support.ok || importBusy) return;
    const dt = event.dataTransfer;
    if (!dt) return;
    const dropped = [...(dt.files || [])];
    if (dropped.length === 1 && /\.zip$/i.test(dropped[0].name)) {
      void assetImport.start({ type: 'zip', data: dropped[0] });
      return;
    }
    const collected = [];
    let walked = false;
    for (const item of [...(dt.items || [])]) {
      const entry = item.webkitGetAsEntry?.();
      if (!entry) continue;
      walked = true;
      await walkEntry(entry, '', collected);
    }
    if (!walked) {
      for (const file of dropped) {
        collected.push({
          path: file.webkitRelativePath || file.name,
          read: async () => new Uint8Array(await file.arrayBuffer()),
        });
      }
    }
    startFiles(collected);
  };
  const clearImported = async () => {
    const ok = await confirmDialog({
      title: t('清除已导入的素材'),
      text: t('只删除这台浏览器里导入的素材，不会影响服务器。'),
      okText: t('确认清除'),
      danger: true,
    });
    if (!ok) return;
    await clearImportedAssets();
    setStoreInfo({ count: 0, usage: storeInfo?.usage ?? null });
    setPersistNote(null);
  };

	return html`<section class="asset-import-dialog">
      <p class="t-lo">${t('从素材包 zip、完整包 zip 或自己的 public/assets 文件夹导入。只收下和服务器清单哈希一致的文件，不上传任何内容。')}</p>
      <p class="t-lo">${t('导入只从服务器读取素材清单，美术文件不走网络；没有导入的素材仍在用到时从服务器加载。')}</p>
      ${support.ok ? html`
        <div class="asset-import__row">
          <${Button} size="sm" data-testid="asset-import-folder" disabled=${importBusy} onClick=${() => void chooseFolder()}>${t('选择文件夹')}<//>
          <${Button} size="sm" data-testid="asset-import-zip" disabled=${importBusy} onClick=${() => zipRef.current?.click()}>${t('选择 zip')}<//>
          ${importBusy ? html`<${Button} size="sm" data-testid="asset-import-cancel" onClick=${() => assetImport.cancel()}>${t('取消导入')}<//>` : null}
          ${(storeInfo?.count > 0) ? html`<${Button} size="sm" disabled=${importBusy} data-testid="asset-import-clear" onClick=${() => void clearImported()}>${t('清除已导入的素材')}<//>` : null}
        </div>
        <input class="asset-import__file" type="file" webkitdirectory=${true} multiple=${true} ref=${folderRef} tabindex="-1" aria-hidden="true"
          data-testid="asset-import-folder-input" onChange=${onFolderInput} />
        <input class="asset-import__file" type="file" accept=".zip,application/zip" ref=${zipRef} tabindex="-1" aria-hidden="true"
          data-testid="asset-import-zip-input" onChange=${onZipInput} />
        <div class="asset-import__drop" onDragOver=${(event) => event.preventDefault()} onDrop=${(event) => void onDrop(event)}>
          ${t('或把文件夹 / zip 拖到这里')}
        </div>
      ` : html`<p class="asset-import__reason" data-testid="asset-import-unavailable">${
        support.reason === 'insecure'
          ? t('导入需要 HTTPS 或 localhost。当前是 http 地址，浏览器不允许 Service Worker，所以不能导入。')
          : t('此浏览器不能导入本地素材。')
      }</p>`}
      <p role="status" data-testid="asset-import-status" class="asset-import__status">${importText}</p>
      ${importBusy || (imported.total > 0 && imported.phase !== 'idle') ? html`<${ProgressBar} value=${imported.done} max=${imported.total || 1} label=${t('已完成 {done} / {total} 个文件', { done: imported.done, total: imported.total })} />` : null}
      ${showImportCounts ? html`<p data-testid="asset-import-counts">${t('已导入 {accepted} 个，校验不符 {rejected} 个，跳过 {skipped} 个，无法读取 {failed} 个', {
        accepted: imported.accepted, rejected: imported.rejected, skipped: imported.skipped, failed: imported.failed,
      })}</p>` : null}
      ${imported.unsupported > 0 ? html`<p class="t-lo">${t('其中 {n} 个因压缩方式不支持被跳过', { n: imported.unsupported })}</p>` : null}
      ${storeInfo && storeInfo.usage != null ? html`<p class="t-lo">${t('已缓存 {count} 个文件，浏览器存储约 {size} MB。', {
        count: storeInfo.count, size: (storeInfo.usage / 1048576).toFixed(1),
      })}</p>` : null}
      ${persistNote === true ? html`<p class="t-lo">${t('已请求浏览器尽量保留这些素材。')}</p>` : null}
      ${persistNote === false ? html`<p class="t-lo">${t('浏览器可能在存储空间不足时清掉导入的素材。')}</p>` : null}
	</section>`;
}
