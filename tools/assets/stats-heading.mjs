// Versioned official webview source; image bytes are downloaded, never committed.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { guardDefaultFetch } from './env-proxy.mjs';
import { isCompletePng } from './formats.mjs';

export const STATS_HEADING_SCRIPT = 'https://web.hycdn.cn/arknights/webview/act1autochess.c77088.js';
const LABELS = {
	headingSequence: 'seasonData',
	headingSocial: 'socialData',
	headingAchievement: 'seasonBest.title',
	headingBond: 'bondRecord.title',
	headingStrategy: 'part.3.title',
};

export function embeddedHeadingAssets(script) {
	const images = new Map([...script.matchAll(/label:\(0,\w+\.Ru\)\("([^"]+)"\),icon:"(data:image\/png;base64,[^"]+)"/g)].map((match) => [match[1], match[2]]));
	return Object.fromEntries(Object.entries(LABELS).map(([name, label]) => {
		const url = images.get(label);
		if (!url || !isCompletePng(Buffer.from(url.split(',')[1], 'base64'))) throw new Error(`missing or invalid stats heading ${label}`);
		return [name, url];
	}));
}

export async function statsHeadingJobs(root, { offline = false, fetchImpl = globalThis.fetch, log = console.log } = {}) {
	const cache = join(root, '.cache', 'stats-heading-c77088.js');
	let images = {};
	try {
		try {
			images = embeddedHeadingAssets(await readFile(cache, 'utf8'));
		} catch (error) {
			if (offline) throw error;
			guardDefaultFetch(fetchImpl, 'official stats headings');
			const response = await fetchImpl(STATS_HEADING_SCRIPT, { signal: AbortSignal.timeout(20000) });
			if (!response.ok) throw new Error(`stats headings HTTP ${response.status}`);
			const script = await response.text();
			images = embeddedHeadingAssets(script);
			await mkdir(join(root, '.cache'), { recursive: true });
			await writeFile(`${cache}.tmp`, script);
			await rename(`${cache}.tmp`, cache);
		}
	} catch (error) {
		log(`[stats-assets] ${error.message}; keep any existing heading files`);
	}
	return Object.keys(LABELS).map((name) => ({ name, rel: `ui/statistics/${name}.png`, urls: images[name] ? [images[name]] : [], kind: 'png' }));
}

export async function statsRecordJobs(root, { offline = false, fetchImpl = globalThis.fetch, log = console.log } = {}) {
	const classes = { recordV3Funds: 'nZVCYI', recordV3Promotions: 'gIbX6j', recordV3Defeats: 'gTGR1Z', recordSoloStreak: 'BefoJ0', recordCoopStreak: 'HXa71S', recordUniteKills: 'IJ0JtT', recordBossShare: 'Gw6FEH', recordV3Label: 'Iaxjpz' };
	const extract = (css) => Object.fromEntries(Object.entries(classes).map(([name, cls]) => {
		const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === (name === 'recordV3Label' ? `.${cls}` : `.C8dKKz.${cls}`));
		const url = rule?.[2].match(/data:image\/png;base64,[A-Za-z0-9+/=]+/)?.[0];
		if (!url || !isCompletePng(Buffer.from(url.split(',')[1], 'base64'))) throw new Error(`missing or invalid stats record ${name}`);
		return [name, url];
	}));
	const cache = join(root, '.cache', 'stats-records-7e8eea.css');
	let images = {};
	try {
		try { images = extract(await readFile(cache, 'utf8')); }
		catch (error) {
			if (offline) throw error;
			guardDefaultFetch(fetchImpl, 'official stats records');
			const response = await fetchImpl('https://web.hycdn.cn/arknights/webview/act1autochess.7e8eea.css', { signal: AbortSignal.timeout(20000) });
			if (!response.ok) throw new Error(`stats records HTTP ${response.status}`);
			const css = await response.text();
			images = extract(css);
			await mkdir(join(root, '.cache'), { recursive: true });
			await writeFile(`${cache}.tmp`, css);
			await rename(`${cache}.tmp`, cache);
		}
	} catch (error) { log(`[stats-assets] ${error.message}; keep existing record icons`); }
	return Object.keys(classes).map((name) => ({ name, rel: `ui/statistics/${name}.png`, urls: images[name] ? [images[name]] : [], kind: 'png' }));
}

/** Latest social achievement chart; the previous season retains its own mask and glow. */
export async function statsSocialJobs(root, { log = console.log } = {}) {
	const selectors = {
		socialTitleMask: '.aE33b1 .RlT_kG .aFbJd2 .WqPlp7',
		socialCountGlow: '.aE33b1 .roU_tu .LOEhW2.zrK7_e:before',
		socialTitleMark: '.aE33b1 .qARHvN',
		socialTitleLabel: '.aE33b1.wnFoM6 .g8v4GG',
		socialTitleGroupMark: '.nllGWA h3:before',
	};
	let css = '';
	try { css = await readFile(join(root, '.cache', 'stats-records-7e8eea.css'), 'utf8'); }
	catch (error) { log(`[stats-assets] ${error.message}; keep existing social chart art`); }
	const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
	return Object.entries(selectors).map(([name, selector]) => {
		const body = rules.find(m => m[1].trim() === selector)?.[2];
		const url = body?.match(/data:image\/(?:png|svg\+xml);base64,[A-Za-z0-9+/=]+/)?.[0];
		const svg = url?.startsWith('data:image/svg+xml;');
		const bytes = url ? Buffer.from(url.split(',')[1], 'base64') : null;
		const valid = bytes && (svg ? /^<svg\b/.test(bytes.toString('utf8')) : isCompletePng(bytes));
		return { name, rel: `ui/statistics/${name}.${svg ? 'svg' : 'png'}`, urls: valid ? [url] : [], kind: svg ? 'bin' : 'png' };
	});
}

/** The small title icons embedded in the latest official statistics page. */
export async function statsTitleJobs(root, { log = console.log } = {}) {
	try {
		const script = await readFile(join(root, '.cache', 'stats-heading-c77088.js'), 'utf8');
		const start = script.indexOf('rM=new Map(');
		const end = script.indexOf('function rP(', start);
		if (start < 0 || end < 0) throw new Error('missing official title icon map');
		return [...script.slice(start, end).matchAll(/\["(comment_\d+)","(data:image\/png;base64,[^"]+)"\]/g)].map(([, id, url]) => {
			if (!isCompletePng(Buffer.from(url.split(',')[1], 'base64'))) throw new Error(`invalid official title icon ${id}`);
			return { name: `socialTitle_${id}`, rel: `ui/statistics/socialTitle_${id}.png`, urls: [url], kind: 'png' };
		});
	} catch (error) { log(`[stats-assets] ${error.message}; keep existing title icons`); return []; }
}
