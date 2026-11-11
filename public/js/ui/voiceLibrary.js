// Browser-local download selection. Playback and interface preferences stay independent.
import { useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { data, useData } from '../data.js';
import { useStore } from '../store.js';
import { voiceDownloadStore, downloadVoiceLanguages, setDownloadVoice, setDownloadVoiceLanguage, DOWNLOAD_VOICE_TREES } from '../voiceDownloads.js';
import { operatorVoiceOptions } from './operatorVoice.js';
import { audio } from '../audio.js';
import { VOICE_LANGS, VOICE_PICKS, VOICE_TREES } from '../voicePrefs.js';
import { t, tc } from '../../../shared/i18n.js';

const NAMES = { cn: '中文', jp: '日本語', en: 'English', kr: '한국어' }; // i18n-ignore

/** Only voiced operators, deduplicated across chess forms and including DIY operators. */
export function voiceRoster(audio, records) {
	const names = new Map(records.filter((r) => r?.charId).map((r) => [r.charId, r.name || r.charId]));
	const ids = new Set(['voice', ...Object.values(VOICE_TREES)].flatMap((tree) => Object.keys(audio?.[tree] || {})));
	return [...ids].map((charId) => ({ charId, name: names.get(charId) || charId }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Multiple downloadable dubs per operator; preview the most recently checked language. */
function VoiceRow({ operator, settings, manifest }) {
	const { charId, name } = operator;
	const selected = downloadVoiceLanguages(settings, charId, manifest);
	const [lastLanguage, setLastLanguage] = useState(null);
	const options = operatorVoiceOptions(manifest, charId).filter((o) => o.value && !o.unavailable);
	const preview = selected.includes(lastLanguage) ? lastLanguage : options.find((o) => selected.includes(o.value))?.value;
	const change = (lang, checked) => {
		voiceDownloadStore.set(setDownloadVoice(voiceDownloadStore.get(), charId, lang, checked, manifest));
		if (checked) setLastLanguage(lang);
	};
	return html`<tr data-voice-char=${charId}>
		<th scope="row">${name}</th>
		${VOICE_PICKS.map((lang) => {
			const option = options.find((o) => o.value === lang);
			return html`<td key=${lang}>
				${option ? html`<label class="voice-library__choice" title=${option.label}>
					<input type="checkbox" value=${lang} checked=${selected.includes(lang)}
						disabled=${option.unavailable || (selected.length === 1 && selected.includes(lang))} aria-label=${`${name} · ${option.label}`} onChange=${(e) => change(lang, e.currentTarget.checked)} />
					${lang === 'native' ? html`<small>${option.label}</small>` : null}
				</label>` : html`<span class="t-dim" aria-hidden="true">—</span>`}
			</td>`;
		})}
		<td><button type="button" aria-label=${`${name} · ${t('试听')}`} disabled=${!preview} onClick=${() => audio.previewVoice(charId, preview)}>${t('试听')}</button></td>
	</tr>`;
}

export function VoiceLibrary() {
	const ready = useData('assets', 'chess', 'backups');
	const settings = useStore((s) => s, Object.is, voiceDownloadStore);
	const [query, setQuery] = useState('');
	const backups = data.get('backups');
	const roster = voiceRoster(data.get('assets')?.audio, [
		...data.list('chess'), ...Object.values(backups?.units || {}), ...Object.entries(backups?.diy?.operators || {}).map(([charId, r]) => ({ ...r, charId })),
	]);
	const search = query.trim().toLocaleLowerCase();
	const rows = roster.filter((r) => `${r.name} ${r.charId}`.toLocaleLowerCase().includes(search));
	return html`<div class="voice-library" data-testid="voice-library">
		<p>${t('勾选需要下载的语音，可同时选择多种语言。下载选择不改变播放语言或游戏界面语言。')}</p>
		<p class="t-lo">${t('每名干员至少保留一种可用配音；取消语言全选时，会保留没有其他已选配音的干员。')}</p>
		<div class="voice-library__languages">
			${VOICE_PICKS.map((lang) => {
				const ids = Object.keys(data.get('assets')?.audio?.[DOWNLOAD_VOICE_TREES[lang]] || {});
				const count = ids.filter((id) => downloadVoiceLanguages(settings, id, data.get('assets')?.audio).includes(lang)).length;
				return html`<label class="voice-library__choice">
					<input type="checkbox" checked=${ids.length > 0 && count === ids.length} indeterminate=${count > 0 && count < ids.length}
						disabled=${!ids.length} onChange=${(e) => voiceDownloadStore.set(setDownloadVoiceLanguage(
							voiceDownloadStore.get(), data.get('assets')?.audio, lang, e.currentTarget.checked))} />
					${lang === 'native' ? tc('voice-lang', '本土语言') : NAMES[lang]}
				</label>`;
			})}
		</div>
		<input class="voice-library__search" type="search" aria-label=${t('搜索干员')} placeholder=${t('搜索干员')} value=${query}
			onInput=${(e) => setQuery(e.currentTarget.value)} />
		${!ready ? html`<p role="status">${t('正在读取素材清单…')}</p>`
			: data.status('assets') !== 'ready' ? html`<p role="alert">${t('无法读取素材清单，请检查网络后重试。')} <${Button} onClick=${() => data.invalidate('assets')}>${t('重试下载')}<//></p>`
				: html`<div class="voice-library__list">
					<table class="voice-library__table">
						<thead><tr><th scope="col">${t('干员')}</th>
							${VOICE_LANGS.map((lang) => html`<th key=${lang} scope="col">${NAMES[lang]}</th>`)}
							<th scope="col">${tc('voice-lang', '本土语言')}</th><th scope="col">${t('试听')}</th>
						</tr></thead>
						<tbody>${rows.map((r) => html`<${VoiceRow} key=${r.charId} operator=${r} settings=${settings} manifest=${data.get('assets')?.audio} />`)}</tbody>
					</table>
					${!rows.length ? html`<p>${t('没有符合条件的干员')}</p>` : null}
				</div>`}
		<p class="t-lo">${t('选择仅保存在此浏览器。语言全选作用于所有干员；试听播放最近勾选的语言。')}</p>
	</div>`;
}
