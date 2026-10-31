// Resource checks inspect local caches; they never download missing art to make the check pass.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, ProgressBar } from './components.js';
import { checkResources } from '../resourceCheck.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

export function ResourceCheckPanel() {
	const controller = useRef(null);
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState({ done: 0, total: 0 });
	const [result, setResult] = useState(null);
	const [error, setError] = useState(false);
	useEffect(() => () => controller.current?.abort(), []);
	const start = async () => {
		controller.current?.abort();
		const run = new AbortController();
		controller.current = run;
		setBusy(true); setResult(null); setError(false); setProgress({ done: 0, total: 0 });
		let last = 0;
		try {
			const report = await checkResources({ signal: run.signal, onProgress: (value) => {
				if (!run.signal.aborted && (Date.now() - last > 100 || value.done === value.total)) {
					last = Date.now(); setProgress(value);
				}
			} });
			if (!run.signal.aborted) setResult(report);
		} catch {
			if (!run.signal.aborted) setError(true);
		} finally { if (!run.signal.aborted) setBusy(false); }
	};
	const cancel = () => { controller.current?.abort(); setBusy(false); };
	const names = new Map([
		...data.list('chess'), ...Object.values(data.get('backups')?.units || {}),
		...Object.entries(data.get('backups')?.diy?.operators || {}).map(([charId, operator]) => ({ ...operator, charId })),
	].map((operator) => [operator.charId, operator.name]));
	return html`<section class="resource-check" data-testid="resource-check-panel">
		<p>${t('资源完整条件：语音外的资源全部就绪，且每个有语音的干员至少有一种完整配音。')}</p>
		<p class="t-lo">${t('检查已导入的资源和浏览器缓存，仅获取资源清单，不下载缺少的素材。')}</p>
		<div class="resource-manager__actions">
			<${Button} variant="primary" disabled=${busy} data-testid="resource-check-start" onClick=${() => void start()}>${t('检查资源')}<//>
			${busy ? html`<${Button} onClick=${cancel}>${t('取消')}<//>` : null}
		</div>
		${busy ? html`<p role="status">${t('正在检查资源…')}</p>
			<${ProgressBar} value=${progress.done} max=${progress.total || 1} label=${t('已完成 {done} / {total} 个文件', progress)} />` : null}
		${error ? html`<p role="alert">${t('资源检查失败，请确认服务器提供完整的资源清单后重试。')}</p>` : null}
		${result ? html`<div data-testid="resource-check-result">
			<p role="status"><b>${result.complete ? t('资源完整') : t('资源尚未完整')}</b></p>
			<p>${t('语音外资源：{ready} / {total} 个文件就绪', result.nonVoice)}</p>
			<p>${t('干员语音：{ready} / {total} 名干员至少有一种完整配音', result.voices)}</p>
			${result.unverified.length ? html`<p class="t-lo">${t('有 {n} 个文件无法确认是否已缓存，未计入就绪。', { n: result.unverified.length })}</p>` : null}
			${result.nonVoice.missing.length ? html`<details><summary>${t('查看未就绪的资源')}</summary><ul>
				${result.nonVoice.missing.slice(0, 30).map((url) => html`<li key=${url}><code>${url}</code></li>`)}
			</ul></details>` : null}
			${result.voices.missing.length ? html`<details><summary>${t('查看缺少配音的干员')}</summary><ul>
				${result.voices.missing.map((charId) => html`<li key=${charId}>${names.get(charId) || charId}</li>`)}
			</ul></details>` : null}
		</div>` : null}
	</section>`;
}
