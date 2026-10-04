// Result screen (research 06 §10.6): victory / defeat hero with rounds passed, boss medallions, and a
// card per player — band, final lineup avatars with elite marks, stats, title (评语) with its icon —
// plus 返回同盟.
//
// Expected m.result (free-form in DESIGN §8.2; fields read tolerantly, see gameLogic.normalizeResult):
//   { victory, roundsPassed, lastRound?, hiddenCleared?, bossId?, hiddenBossId?, difficulty?, modeId?, durationMs?,
//     players: [{ playerId, seat, name, isBot, alive, lp, bandId, roundsPassed?,
//                 title: 'comment_1' | { id, name? } | null,
//                 lineup: [{ id /* chessId, golden id if elite */, golden?, tier?, items?: [itemId] }],
//                 bonds?: [{ bondId, layers, active }],
//                 stats: { dmgDealt, kills, leaks, gold /* funds SPENT */, refreshes, merges, bossDamage?, itemsEquipped?,
//                          activatedLayers?, lpLost?, perfectRounds? } }] }

import { useEffect } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, DifficultyTag } from '../ui/components.js';
import { useGameData, Img, UnitThumb, BandIcon, PlayerAvatar, BondGlyph, LpTower, Sprite } from '../ui/gameComponents.js';
import { normalizeResult, fmtNum } from '../ui/gameLogic.js';
import { enemyIconUrl, titleIconUrl, uiUrl } from '../ui/assetUrls.js';
import { store, useStore, emptyMatch } from '../store.js';
import { audio } from '../audio.js';
import { T } from '../i18n.js';
const cx = (...p) => p.flat().filter(Boolean).join(' ');

// The first seven present are shown (+ remaining LP = a 4×2 grid); the title (评语) stats come first.
// `gold` is the funds a player SPENT (server/match/PlayerState.js spend(); the 挥金如土 title stat).
const STAT_ROWS = [
  ['dmgDealt', T('造成伤害')], ['kills', T('击倒敌人')], ['bossDamage', T('领袖伤害')], ['activatedLayers', T('盟约层数')],
  ['merges', T('晋升次数')], ['itemsEquipped', T('配发装备')], ['gold', T('消耗资金')], ['perfectRounds', T('完美作战')],
  ['refreshes', T('刷新次数')], ['leaks', T('未击倒')], ['lpLost', T('损失生命')],
];

function PlayerCard({ p, myId, titles, best, solo = false }) {
  const gd = useGameData();
  const titleRec = p.title ? titles.find((t) => t.id === p.title.id) || null : null;
  const titleName = p.title?.name || titleRec?.name || null;
  const stats = STAT_ROWS.filter(([k]) => Number.isFinite(p.stats[k])).slice(0, 7);
  const band = p.bandId ? gd.band(p.bandId) : null;
  const lineup = p.lineup.slice(0, 10);
  const bonds = p.bonds.filter((b) => b.active || b.layers > 0).sort((a, b) => (b.layers || 0) - (a.layers || 0)).slice(0, 6);
  return html`<article class=${cx('rcard', p.playerId === myId && 'is-self', p.alive === false && 'is-dead')}>
    <header class="rcard__head">
      <${PlayerAvatar} player=${p} self=${p.playerId === myId} />
      <div class="rcard__who">
        <b class="rcard__name">${p.name}${p.isBot ? html`<span class="rcard__ai">AI</span>` : null}${p.playerId === myId ? html`<span class="rcard__you">${T('你')}</span>` : null}</b>
        <span class="rcard__band">${band ? html`<${BandIcon} bandId=${band.bandId} size="xs" />${band.name}` : '—'}</span>
      </div>
      <div class="rcard__mid">
        <div class="rcard__lineup">
          ${lineup.length ? lineup.map((u, i) => html`<${UnitThumb} key=${i} kind=${u.kind === 'token' ? 'token' : 'chess'} id=${u.id} golden=${!!u.golden} tier=${u.tier} size="sm" />`)
            : html`<span class="rcard__noinfo">${p.alive === false ? T('阵容已撤离') : 'NO INFO'}</span>`}
        </div>
        ${bonds.length ? html`<div class="rcard__bonds">${bonds.map((b) => html`<span key=${b.bondId} class=${cx('rbond', b.active && 'is-on')} title=${gd.bond(b.bondId)?.name || b.bondId}>
          <${BondGlyph} bondId=${b.bondId} /><b class="num">${b.layers ?? 0}</b></span>`)}</div>` : null}
      </div>
      <div class="rcard__round"><${MicroLabel}>ROUNDS</${MicroLabel}><b class="num">${p.roundsPassed}</b>
        ${p.trophies > 0 || p.reward > 0 ? html`<span class="rcard__gain">${p.trophies > 0 ? html`<span title=${T('获得奖杯')}><${Icon} name="crown" /><b class="num">+${p.trophies}</b></span>` : null}${p.reward > 0 ? html`<span title=${T('卫戍认证')}><${Icon} name="shield" /><b class="num">+${p.reward}</b></span>` : null}</span>` : null}
      </div>
      ${titleName ? html`<div class="rcard__title" title=${titleRec?.text || p.title?.text || ''}>
        <${Img} src=${titleIconUrl(gd.m, titleRec?.picId || p.title?.picId || String(p.title.id || '').replace('comment_', 'comment_icon_'))} class="rcard__ticon" fallback=${html`<${Icon} name="crown" />`} />
        <span><${MicroLabel} tone="gold">${T('评语')}</${MicroLabel}><b>${titleName}</b></span>
      </div>` : html`<span class="rcard__title rcard__title--none" aria-hidden="true"></span>`}
    </header>
    <div class="rcard__stats">
      ${stats.map(([k, label]) => html`<div key=${k} class=${cx('rstat', best[k] === p.playerId && 'is-best')}><span>${label}</span><b class="num">${fmtNum(p.stats[k])}</b></div>`)}
      ${Number.isFinite(p.lp) ? html`<div class="rstat" title=${p.lpShared && !solo ? T('最终攻势起全队共享目标生命值') : ''}><span>${p.lpShared && !solo ? T('同盟剩余生命') : T('剩余生命')}</span><${LpTower} value=${p.lp} size="sm" /></div>` : null}
    </div>
  </article>`;
}

/** RESULT screen. */
export function ResultScreen() {
  const res = useStore((s) => s.match.result);
  const pub = useStore((s) => s.match.public);
  const myId = useStore((s) => s.me.playerId);
  const hasRoom = useStore((s) => !!s.room);
  const gd = useGameData();
  const r = normalizeResult(res, pub);
  const titles = Array.isArray(gd.config?.titles) ? gd.config.titles : [];
  const best = {};
  for (const [k] of STAT_ROWS) {
    let top = null;
    for (const p of r.players) if (Number.isFinite(p.stats[k]) && p.stats[k] > 0 && (top == null || p.stats[k] > top.v)) top = { v: p.stats[k], id: p.playerId };
    if (top && r.players.length > 1) best[k] = top.id;
  }
  useEffect(() => { audio.sfx(r.victory ? 'settlementSucceed' : 'settlementFail'); }, []);
  const back = () => store.set({ match: emptyMatch() });
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
        <div class="result__logo"><${Sprite} k="entry/season_logo_settle" class="result__logoimg" fallback=${html`<${MicroLabel} tone="mint">STRONGHOLD PROTOCOL</${MicroLabel}>`} /></div>
        ${r.difficulty ? html`<${DifficultyTag} difficulty=${r.difficulty} size="lg" />` : null}
        <h1 class="result__headline">${r.victory ? T('模拟完成') : T('模拟失败')}</h1>
        <p class="result__sub">${r.victory ? T('成功卫戍 · 敌方领袖已被击败') : T('防线已被突破')}</p>
        <div class="result__rounds">
          <span class="result__rlabel">${T('通过回合')}</span>
          <b class="result__rnum num">${r.roundsPassed}</b>
          ${r.roundsPassed <= r.lastRound ? html`<span class="result__rof num">/${r.lastRound}</span>` : null}
        </div>
        <div class="result__medals">
          ${boss ? html`<div class=${cx('medal', r.victory && 'is-done')} title=${boss.name}>
            <${Img} src=${enemyIconUrl(gd.m, boss.enemyKey)} /><span class="medal__check">${r.victory ? html`<${Icon} name="check" />` : html`<${Icon} name="close" />`}</span>
            <span class="medal__label">${T('敌方领袖')}</span></div>` : null}
          ${hidden ? html`<div class=${cx('medal', 'medal--hidden', r.hiddenCleared && 'is-done')} title=${hidden.name}>
            <${Img} src=${enemyIconUrl(gd.m, hidden.enemyKey)} /><span class="medal__check">${r.hiddenCleared ? html`<${Icon} name="check" />` : html`<${Icon} name="close" />`}</span>
            <span class="medal__label">${T('隐秘核心')}</span></div>` : null}
        </div>
        ${mins ? html`<p class="result__time t-lo">${T('本局耗时')} <b class="num">${mins}</b> ${T('分钟')}</p>` : null}
        <footer class="result__foot">
          <${Button} variant="primary" size="xl" icon="chevronLeft" onClick=${back}>${hasRoom ? T('返回同盟') : T('返回大厅')}<//>
        </footer>
      </section>
      <section class="result__players">
        <h2 class="brief-h"><span>${T('同盟成员')}</span><${MicroLabel}>ALLIANCE REPORT</${MicroLabel}></h2>
        ${r.players.length ? r.players.map((p) => html`<${PlayerCard} key=${p.playerId} p=${p} myId=${myId} titles=${titles} best=${best} solo=${r.players.length < 2} />`)
          : html`<p class="t-dim">${T('暂无结算数据')}</p>`}
      </section>
    </main>
  </div>`;
}

