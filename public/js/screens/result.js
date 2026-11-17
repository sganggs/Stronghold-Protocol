// The full settlement report (research 06 §10.6): victory / defeat hero with rounds passed, boss medallions, and a
// card per player — band, final lineup avatars with elite marks, stats, title (评语) with its icon. The live RESULT
// screen opens it as 数据详情 over the settlement flow (screens/settle.js); the stats page re-views a stored match with it.
//
// Expected m.result (free-form in DESIGN §8.2; fields read tolerantly, see gameLogic.normalizeResult):
//   { victory, roundsPassed, lastRound?, hiddenCleared?, bossId?, hiddenBossId?, difficulty?, modeId?, durationMs?,
//     players: [{ playerId, seat, name, isBot, alive, lp, bandId, roundsPassed?,
//                 title: 'comment_1' | { id, name? } | null,
//                 lineup: [{ id /* chessId, golden id if elite */, golden?, tier?, items?: [itemId],
//                            diy? /* 0.2.0 自选编队: a DIY slot's pick { charId, skillIndex, uniEquipId } — the card
//                                    draws the operator (gameLogic diyRecordFor) */,
//                            standInFor? /* 0.2.0 补位: the replaced operator's charId — the card draws the stand-in
//                                           with a small 「替补」 mark (gameLogic standInOf; the owner's recall, 2026-10-06) */ }],
//                 bonds?: [{ bondId, layers, active }],
//                 stats: { dmgDealt, kills, leaks, gold /* funds SPENT */, refreshes, merges, bossDamage?, itemsEquipped?,
//                          activatedLayers?, lpLost?, perfectRounds? } }] }

import { useEffect } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, DifficultyTag } from '../ui/components.js';
import { useGameData, Img, UnitThumb, BandIcon, PlayerAvatar, BondGlyph, LpTower, Sprite } from '../ui/gameComponents.js';
import { normalizeResult, fmtNum, diyRecordFor, cardStandIn, standInForText } from '../ui/gameLogic.js';
import { data } from '../data.js';
import { enemyIconUrl, titleIconUrl, uiUrl } from '../ui/assetUrls.js';
import { audio } from '../audio.js';
import { sentText } from '../ui/lang.js';
import { UnofficialMark, VersionTag } from '../ui/pluginTag.js';
import { TestMark } from '../ui/testConsole.js';
import { t, tParts, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

// The first seven present are shown (+ remaining LP = a 4×2 grid); the title (评语) stats come first.
// `gold` is the funds a player SPENT (server/match/player/economy.js spend(); the 挥金如土 title stat).
const STAT_ROWS = [
  ['dmgDealt', N_('造成伤害')], ['kills', N_('击倒敌人')], ['bossDamage', N_('领袖伤害')], ['activatedLayers', N_('盟约层数')],
  ['merges', N_('晋升次数')], ['itemsEquipped', N_('配发装备')], ['gold', N_('消耗资金')], ['perfectRounds', N_('完美作战')],
  ['refreshes', N_('刷新次数')], ['leaks', N_('未击倒')], ['lpLost', N_('损失生命')],
];

/**
 * The bonds a result card lists (at most 6): the active ones and those holding layers, most layers first. A bond whose
 * layers the game never shows (bonds.json `noStack`: 调和 协防干员 独行 绝技 — PRTS 卫戍协议：盟约 下半/PRTS盟约记录 「部分盟约不会
 * 显示叠加层数，但是叠加层数的特质/策略/装备等效果仍然对其生效」) counts none for the order and carries no number
 * (`hideLayers`), as on the bond strip since 0.1.4 (PR #66) — the card printed them until 0.2.0 (community report
 * 「独行这种盟约是不能叠层的」).
 * @param {any[]} bonds m.result players[].bonds @param {(bondId: string) => any} bondRec bonds.json record lookup
 */
export function resultBonds(bonds, bondRec = () => null) {
  const list = (Array.isArray(bonds) ? bonds : []).filter((b) => b && typeof b.bondId === 'string')
    .map((b) => (bondRec(b.bondId)?.noStack ? { ...b, hideLayers: true } : b));
  const shown = (b) => (b.hideLayers ? 0 : b.layers || 0);
  return list.filter((b) => b.active || shown(b) > 0).sort((a, b) => shown(b) - shown(a)).slice(0, 6);
}

/**
 * One unit of a final lineup: a 自选 piece draws its operator; a 补位 piece (`standInFor`) its stand-in, with the small
 * 「替补」 mark — the title names the chess it fielded for.
 */
export function LineupThumb({ u, gd, ownerId }) {
  const chess = u.kind === 'token' ? null : gd.chess(u.id);
  const dr = u.diy && chess ? diyRecordFor(chess, u.diy, { chess: data.get('chess'), backups: data.get('backups') }) : null;
  const si = !dr && chess ? cardStandIn(chess, { unit: u, backups: gd.backups }) : null;
  return html`<${UnitThumb} kind=${u.kind === 'token' ? 'token' : 'chess'} id=${u.id} ownerId=${ownerId} skin=${u.skin} golden=${!!u.golden} tier=${u.tier} size="sm" rec=${dr || si}
    title=${si ? t('{name}（{note}）', { name: si.name, note: standInForText(chess.name) }) : undefined} />`;
}

function PlayerCard({ p, myId, titles, best, solo = false, skinOwnerId = null }) {
  const gd = useGameData();
  const titleRec = p.title ? titles.find((x) => x.id === p.title.id) || null : null;
  // (the server sends the title's Chinese name: the localized config.titles record when it is that record's)
  const rawTitle = p.title ? (data.getRaw('config')?.titles || []).find((x) => x && x.id === p.title.id) || null : null;
  const titleName = sentText(p.title?.name, rawTitle?.name, titleRec?.name) || titleRec?.name || null;
  const stats = STAT_ROWS.filter(([k]) => Number.isFinite(p.stats[k])).slice(0, 7);
  const band = p.bandId ? gd.band(p.bandId) : null;
  const lineup = p.lineup.slice(0, 10);
  const bonds = resultBonds(p.bonds, (id) => gd.bond(id));
  return html`<article class=${cx('rcard', p.playerId === myId && 'is-self', p.alive === false && 'is-dead')}>
    <header class="rcard__head">
      <${PlayerAvatar} player=${p} self=${p.playerId === myId} />
      <div class="rcard__who">
        <b class="rcard__name">${p.name}${p.isBot ? html`<span class="rcard__ai">AI</span>` : null}${p.playerId === myId ? html`<span class="rcard__you">${t('你')}</span>` : null}</b>
        ${Number.isInteger(p.aiTakeoverRound) ? html`<small>${t('第 {round} 回合接替 AI；含此前席位数据，不计入个人统计或奖励。', { round: p.aiTakeoverRound })}</small>` : null}
        <span class="rcard__band">${band ? html`<${BandIcon} bandId=${band.bandId} size="xs" />${band.name}` : '—'}</span>
      </div>
      <div class="rcard__mid">
        <div class="rcard__lineup">
          ${lineup.length ? lineup.map((u, i) => html`<${LineupThumb} key=${i} u=${u} gd=${gd} ownerId=${skinOwnerId} />`)
            : html`<span class="rcard__noinfo">${p.alive === false ? t('阵容已撤离') : 'NO INFO'}</span>`}
        </div>
        ${bonds.length ? html`<div class="rcard__bonds">${bonds.map((b) => html`<span key=${b.bondId} class=${cx('rbond', b.active && 'is-on')} title=${gd.bond(b.bondId)?.name || b.bondId}>
          <${BondGlyph} bondId=${b.bondId} />${b.hideLayers ? null : html`<b class="num">${b.layers ?? 0}</b>`}</span>`)}</div>` : null}
      </div>
      <div class="rcard__round"><${MicroLabel}>ROUNDS</${MicroLabel}><b class="num">${p.roundsPassed}</b>
        ${p.trophies > 0 || p.reward > 0 ? html`<span class="rcard__gain">${p.trophies > 0 ? html`<span title=${t('获得奖杯')}><${Icon} name="crown" /><b class="num">+${p.trophies}</b></span>` : null}${p.reward > 0 ? html`<span title=${t('卫戍认证')}><${Icon} name="shield" /><b class="num">+${p.reward}</b></span>` : null}</span>` : null}
      </div>
      ${titleName ? html`<div class="rcard__title" title=${titleRec?.text || p.title?.text || ''}>
        <${Img} src=${titleIconUrl(gd.m, titleRec?.picId || p.title?.picId || String(p.title.id || '').replace('comment_', 'comment_icon_'))} class="rcard__ticon" fallback=${html`<${Icon} name="crown" />`} />
        <span><${MicroLabel} tone="gold">${t('评语')}</${MicroLabel}><b>${titleName}</b></span>
      </div>` : html`<span class="rcard__title rcard__title--none" aria-hidden="true"></span>`}
    </header>
    <div class="rcard__stats">
      ${stats.map(([k, label]) => html`<div key=${k} class=${cx('rstat', best[k] === p.playerId && 'is-best')}><span>${t(label)}</span><b class="num">${fmtNum(p.stats[k])}</b></div>`)}
      ${Number.isFinite(p.lp) ? html`<div class="rstat" title=${p.lpShared && !solo ? t('最终攻势起全队共享目标生命值') : ''}><span>${p.lpShared && !solo ? t('同盟剩余生命') : t('剩余生命')}</span><${LpTower} value=${p.lp} size="sm" /></div>` : null}
    </div>
  </article>`;
}

/**
 * The settlement view of one m.result payload — the live flow's 数据详情 (screens/settle.js), and the stats page's
 * re-view of a stored match (screens/stats.js, which hands it the payload recordToResult rebuilt; `quiet`: no settlement
 * jingle). `content`: the room's content (room.state.content, or a stats record's) — gameplay plugins mark the result
 * unofficial (DESIGN §32.6). `slot`: the 结算 tab plugin slot (result.tab) — false where the page under it has one.
 * @param {{ res: any, pub?: any, myId?: string|null, backLabel: string, onBack: () => void, quiet?: boolean, content?: any, slot?: boolean }} props
 */
export function ResultView({ res, pub = null, myId = null, backLabel, onBack, quiet = false, content = null, slot = true, version = null }) {
  // [ASSUMED] Stored statistics have no outfit snapshot: without pub, do not borrow a live match's choices.
  const gd = useGameData();
  const r = normalizeResult(res, pub);
  const titles = Array.isArray(gd.config?.titles) ? gd.config.titles : [];
  const best = {};
  for (const [k] of STAT_ROWS) {
    let top = null;
    for (const p of r.players) if (Number.isFinite(p.stats[k]) && p.stats[k] > 0 && (top == null || p.stats[k] > top.v)) top = { v: p.stats[k], id: p.playerId };
    if (top && r.players.length > 1) best[k] = top.id;
  }
  useEffect(() => { if (!quiet) audio.sfx(r.victory ? 'settlementSucceed' : 'settlementFail'); }, []);
  const boss = r.bossId ? gd.boss(r.bossId) : null;
  // the Hidden Core medal (and its corrupted leader) only once R15 was actually fought
  const hidden = r.hiddenBossId && r.hiddenReached ? gd.boss(r.hiddenBossId) : null;
  const bg = uiUrl(gd.m, r.victory ? 'settle/settlemen_teamshow_success' : 'settle/settlemen_teamshow_fail');
  const mins = r.durationMs ? Math.round(r.durationMs / 60000) : null;

  return html`<div class=${cx('screen', 'result', r.victory ? 'is-win' : 'is-lose')}>
    <div class="result__bg" aria-hidden="true" style=${bg ? `--result-bg:url("${bg}")` : undefined}></div>
    <div class="result__grid" aria-hidden="true"></div>
    <main class="result__main">
      <section class="result__hero">
        <div class="result__summary">
        <div class="result__logo"><${Sprite} k="entry/season_logo_settle" class="result__logoimg" fallback=${html`<${MicroLabel} tone="mint">STRONGHOLD PROTOCOL</${MicroLabel}>`} /></div>
        ${r.difficulty ? html`<${DifficultyTag} difficulty=${r.difficulty} size="lg" />` : null}
        <h1 class="result__headline">${r.victory ? t('模拟完成') : t('模拟失败')}</h1>
        <${UnofficialMark} room=${content ? { content } : null} class="result__modmark" /><${VersionTag} version=${version} class="result__vertag" />
        ${res?.test === true ? html`<p class="result__test" data-testid="result-test"><${TestMark} /> ${t('测试对局')}${Number.isInteger(res.testActions) ? html` · ${t('测试指令 {n} 次', { n: res.testActions })}` : null}</p>
          <p class="t-dim">${t('本局为测试对局，不计入统计、成就、称号、徽章与卫戍认证。')}</p>` : null}
        <p class="result__sub">${r.victory ? t('成功卫戍 · 敌方领袖已被击败') : t('防线已被突破')}</p>
        <div class="result__rounds">
          <span class="result__rlabel">${t('通过回合')}</span>
          <b class="result__rnum num">${r.roundsPassed}</b>
          ${r.roundsPassed <= r.lastRound ? html`<span class="result__rof num">/${r.lastRound}</span>` : null}
        </div>
        <div class="result__medals">
          ${boss ? html`<div class=${cx('medal', r.victory && 'is-done')} title=${boss.name}>
            <${Img} src=${enemyIconUrl(gd.m, boss.enemyKey)} /><span class="medal__check">${r.victory ? html`<${Icon} name="check" />` : html`<${Icon} name="close" />`}</span>
            <span class="medal__label">${t('敌方领袖')}</span></div>` : null}
          ${hidden ? html`<div class=${cx('medal', 'medal--hidden', r.hiddenCleared && 'is-done')} title=${hidden.name}>
            <${Img} src=${enemyIconUrl(gd.m, hidden.enemyKey)} /><span class="medal__check">${r.hiddenCleared ? html`<${Icon} name="check" />` : html`<${Icon} name="close" />`}</span>
            <span class="medal__label">${t('隐秘核心')}</span></div>` : null}
        </div>
        ${mins ? html`<p class="result__time t-lo">${tParts('本局耗时 {n} 分钟', { n: html`<b class="num">${mins}</b>`, mins })}</p>` : null}
        </div>
        <footer class="result__foot">
          <${Button} variant="primary" size="xl" icon="chevronLeft" onClick=${onBack}>${backLabel}<//>
        </footer>
      </section>
      <section class="result__players">
        <h2 class="brief-h"><span>${t('同盟成员')}</span><${MicroLabel}>ALLIANCE REPORT</${MicroLabel}></h2>
        ${r.players.length ? r.players.map((p) => html`<${PlayerCard} key=${p.playerId} p=${p} skinOwnerId=${pub ? p.playerId : null} myId=${myId} titles=${titles} best=${best} solo=${r.players.length < 2} />`)
          : html`<p class="t-dim">${t('暂无结算数据')}</p>`}
      </section>
      ${slot ? html`<div class="ui-slot" data-ui-slot="result.tab" aria-label=${t('界面插件')} dangerouslySetInnerHTML=${{ __html: '' }}></div>` : null}
    </main>
  </div>`;
}

