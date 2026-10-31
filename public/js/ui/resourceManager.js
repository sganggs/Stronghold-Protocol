// Unified title-screen resource controls. Mount only the active section: opening never starts a transfer,
// and switching sections/closing pauses downloads or cancels imports through the panels' cleanup.
import { useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal } from './components.js';
import { AssetDownloadPanel } from './assetDownload.js';
import { AssetImportPanel } from './assetImport.js';
import { ResourceCheckPanel } from './resourceCheck.js';
import { VoiceLibrary } from './voiceLibrary.js';
import { t } from '../../../shared/i18n.js';

export function ResourceManagerButton() {
	const [open, setOpen] = useState(false);
	const [section, setSection] = useState('voice');
	return html`<${Button} variant="secondary" block=${true} size="sm" data-testid="resource-manager-open"
		onClick=${() => setOpen(true)}>${t('下载资源管理')}<//>
	<${Modal} open=${open} onClose=${() => setOpen(false)} title=${t('下载资源管理')} class="resource-manager"
		actions=${html`<${Button} onClick=${() => setOpen(false)}>${t('关闭')}<//>`}>
		<nav class="resource-manager__nav" aria-label=${t('下载资源管理')}>
			<${Button} size="sm" active=${section === 'voice'} data-testid="resource-voice"
				onClick=${() => setSection('voice')}>${t('干员语音')}<//>
			<${Button} size="sm" active=${section === 'download'} data-testid="resource-download"
				onClick=${() => setSection('download')}>${t('下载素材')}<//>
			<${Button} size="sm" active=${section === 'import'} data-testid="resource-import"
				onClick=${() => setSection('import')}>${t('导入素材包')}<//>
			<${Button} size="sm" active=${section === 'check'} data-testid="resource-check"
				onClick=${() => setSection('check')}>${t('检查资源')}<//>
		</nav>
		<div data-testid="resource-manager-panel">
			${open ? section === 'download' ? html`<${AssetDownloadPanel} />`
				: section === 'import' ? html`<${AssetImportPanel} />`
				: section === 'check' ? html`<${ResourceCheckPanel} />` : html`<${VoiceLibrary} />` : null}
		</div>
	<//>`;
}
