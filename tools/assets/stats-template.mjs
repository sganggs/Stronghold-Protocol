// Public, versioned official webview assets. Image bytes are extracted at setup time, never kept in git.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { guardDefaultFetch } from './env-proxy.mjs';
import { isCompletePng } from './formats.mjs';
import { statsHeadingJobs, statsRecordJobs, statsSocialJobs, statsTitleJobs } from './stats-heading.mjs';

export const STATS_TEMPLATE_CSS = 'https://web.hycdn.cn/arknights/webview/act1autochess.41668e.css';
const CDN = 'https://web.hycdn.cn/arknights/webview/assets';
const FONT_CSS = `@font-face { font-family: 'Official Stats Numerals'; font-display: swap; src: url('number-font.woff2') format('woff2'); }
@font-face { font-family: 'Official Stats Labels'; font-display: swap; src: url('label-font.woff2') format('woff2'); }
`;

/** Extract embedded images, checking their types before exposing download jobs. */
export function embeddedStatsAssets(css) {
  const extract = (selector, type) => {
    const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((match) => match[1].includes(selector));
    const url = rule?.[2].match(/url\(["']?(data:[^\s)"']+)["']?\)/)?.[1];
    if (!url?.startsWith(`data:${type};base64,`)) throw new Error(`missing official stats asset ${selector}`);
    const bytes = Buffer.from(url.split(',')[1], 'base64');
    if (type === 'image/png' ? !isCompletePng(bytes) : !/^<svg\b/.test(bytes.toString('utf8'))) {
      throw new Error(`invalid official stats asset ${selector}`);
    }
    return url;
  };
  return {
    titleMask: extract('.WqPlp7', 'image/svg+xml'),
    countGlow: extract('.zrK7_e:before', 'image/png'),
    recordLabel: extract('.D_liCN .C8cb_l .grJEuP', 'image/png'),
    recordFunds: extract('.D_liCN .C8cb_l:first-child .QjacBn', 'image/png'),
    recordPromotions: extract('.D_liCN .C8cb_l:nth-child(2) .QjacBn', 'image/png'),
    recordDefeats: extract('.D_liCN .C8cb_l:nth-child(3) .QjacBn', 'image/png'),
    strategyTopFrame: extract('.MjyVeP .oetJsV', 'image/png'),
    bondTopFrame: extract('.zJvtrR', 'image/png'),
    achievementBondFrame: extract('.vMxx75 .QjacBn', 'image/png'),
    headingIconFrame: extract('.d55Z07 .YhjRsw', 'image/png'),
    headingIcon: extract('.d55Z07 .YhjRsw:after', 'image/png'),
    ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`memberTier${i + 1}`, extract(`.X3pmNU .V1837J[data-value="${i + 1}"]`, 'image/png')])),
    ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`achievementTier${i + 1}`, extract(`.MLjcnT .ykHBSj[data-value="${i + 1}"]`, 'image/png')])),
    achievementElite1: extract('.MLjcnT .E1AGEa .UuPuiA[data-value="1"]', 'image/png'),
    achievementItemSlot: extract('.MLjcnT .yREPMr .uMnwgg .qgW2SX', 'image/png'),
    strategyBadgeFrame: extract('.jDhW1o', 'image/png'),
    strategyBadge: extract('.jDhW1o.GajVs2:after', 'image/png'),
  };
}

/** Jobs shared by the full asset setup and the focused stats downloader. */
export async function statsTemplateJobs(root, { offline = false, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const cache = join(root, '.cache', 'stats-template-41668e.css');
  /** @type {Partial<ReturnType<typeof embeddedStatsAssets>>} */
  let embedded = {};
  try {
    let css;
    try {
      css = await readFile(cache, 'utf8');
      embeddedStatsAssets(css);
    } catch (error) {
      if (offline) throw error;
      guardDefaultFetch(fetchImpl, 'official stats template');
      const response = await fetchImpl(STATS_TEMPLATE_CSS, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`stats template HTTP ${response.status}`, { cause: error });
      css = await response.text();
      embeddedStatsAssets(css);
      await mkdir(join(root, '.cache'), { recursive: true });
      await writeFile(`${cache}.tmp`, css);
      await rename(`${cache}.tmp`, cache);
    }
    embedded = embeddedStatsAssets(css);
  } catch (error) {
    log(`[stats-assets] ${error.message}; keep any existing files`);
  }
  const sources = [
    ['titleMask', 'title-mask.svg', embedded.titleMask],
    ['countGlow', 'count-glow.png', embedded.countGlow],
    ['decoration', 'dash.png', `${CDN}/img/dash.99f37d.png`],
    ['numberFont', 'number-font.woff2', `${CDN}/fonts/NovecentoWide-Medium.fb69ff.woff2`],
    ['labelFont', 'label-font.woff2', `${CDN}/fonts/SourceHanSans-Medium.678769.woff2`],
    ['fontStyles', 'fonts.css', `data:text/css;charset=utf-8,${encodeURIComponent(FONT_CSS)}`],
    ['recordLabel', 'record-label.png', embedded.recordLabel],
    ['recordFunds', 'record-funds.png', embedded.recordFunds],
    ['recordPromotions', 'record-promotions.png', embedded.recordPromotions],
    ['recordDefeats', 'record-defeats.png', embedded.recordDefeats],
    ['strategyTopFrame', 'strategy-top-frame.png', embedded.strategyTopFrame],
    ['bondTopFrame', 'bond-top-frame.png', embedded.bondTopFrame],
    ['achievementBondFrame', 'achievement-bond-frame.png', embedded.achievementBondFrame],
    ['achievementBg', 'achievement-bg.png', `${CDN}/img/bg.cdd07d.png`],
    ['achievementBondTile', 'achievement-bond-tile.png', `${CDN}/img/bond-bg.53ee8c.png`],
    ['headingBar', 'heading-bar.png', `${CDN}/img/title-bg.26ebe7.png`],
    ['headingIconFrame', 'heading-icon-frame.png', embedded.headingIconFrame],
    ['headingIcon', 'heading-icon.png', embedded.headingIcon],
    ['memberFrame', 'member-frame.png', `${CDN}/img/bg-circle.cd5774.png`],
    ...Array.from({ length: 6 }, (_, i) => [`memberTier${i + 1}`, `member-tier-${i + 1}.png`, embedded[`memberTier${i + 1}`]]),
    ...Array.from({ length: 6 }, (_, i) => [`achievementTier${i + 1}`, `achievement-tier-${i + 1}.png`, embedded[`achievementTier${i + 1}`]]),
    ['achievementElite0', 'achievement-elite-0.png', `${CDN}/img/elite_0.949306.png`],
    ['achievementElite1', 'achievement-elite-1.png', embedded.achievementElite1],
    ['achievementElite2', 'achievement-elite-2.png', `${CDN}/img/elite_2.71c645.png`],
    ['achievementItemSlot', 'achievement-item-slot.png', embedded.achievementItemSlot],
    ['strategyBadgeFrame', 'strategy-badge-frame.png', embedded.strategyBadgeFrame],
    ['strategyBadge', 'strategy-badge.png', embedded.strategyBadge],
  ];
  return [...sources.map(([name, file, url]) => ({
    name, rel: `ui/statistics/${file}`, urls: url ? [url] : [],
    kind: file.endsWith('.png') ? 'png' : file.endsWith('.woff2') ? 'font' : 'bin',
  })), ...await statsHeadingJobs(root, { offline, fetchImpl, log }), ...await statsRecordJobs(root, { offline, fetchImpl, log }), ...await statsSocialJobs(root, { log }), ...await statsTitleJobs(root, { log })];
}
