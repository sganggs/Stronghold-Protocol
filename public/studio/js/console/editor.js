import { useState } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { data, useData } from '../../../js/data.js';
import { useLang } from '../../../js/ui/lang.js';
import { t } from '../../../../shared/i18n.js';
import { emptyPlayer, cloneScenario, scenarioDevices } from '../../../../shared/studio/scenario.js';
import { diyPool, lockedSelection } from '../../../../shared/diy.js';
import { unitForm } from '../../../../shared/standIn.js';
import { deviceOptionName, lockedModuleLabel, modeOptionLabel, moduleOptionName, moduleOptions, routeLabel, skillOptionName, tokenRemaining } from './labels.js';

export const labelOf = r => `${data.localeName(r.name || r.id || r.chessId || r.tokenId || r.effectId || '')}${r.isGolden ? ` (${t('精锐')})` : ''} · ${r.id || r.chessId || r.tokenId || r.effectId || r.bondId || r.bandId || r.modeId || r.key || ''}`;
export function Select({ label, value, options, onChange, disabled = false }) {
  return html`<label>${label}<select value=${value ?? ''} disabled=${disabled} onChange=${e => onChange(e.currentTarget.value)}>${options.map(([id, name]) => html`<option key=${id} value=${id}>${name}</option>`)}</select></label>`;
}
export function Numeric({ label, value, onChange, min = 0, max = 999, step = 1, disabled = false }) {
  return html`<label>${label}<input type="number" value=${value} min=${min} max=${max} step=${step} disabled=${disabled} onChange=${e => onChange(e.currentTarget.valueAsNumber)} /></label>`;
}
export function Search({ label, records, value, onChange, empty = false }) {
  const [query, setQuery] = useState('');
  const shown = records.filter(r => r.id === value || `${r.name} ${r.id} ${data.localeName(r.name || '')}`.toLowerCase().includes(query.toLowerCase()));
  return html`<div class="sc-search"><label>${label}<input type="search" value=${query} placeholder=${t('搜索中文名或 ID')} onInput=${e => setQuery(e.currentTarget.value)} /></label>
    <${Select} label=${label} value=${value} options=${[...(empty ? [['', t('无')]] : []), ...shown.map(r => [r.id, labelOf(r)])]} onChange=${onChange} />
  </div>`;
}
const entries = name => Object.entries(data.getRaw(name) || {}).map(([id, r]) => ({ ...r, id }));
const changeField = (s, kind) => ({ ...s, kind, waveId: null, bossId: kind === 'hidden' ? 'boss_8' : kind === 'boss' ? 'boss_1' : null,
  round: kind === 'hidden' ? 15 : kind === 'boss' ? 14 : 1, enemies: [], players: (kind === 'normal' ? s.players.slice(0, 1) : s.players).map(p => ({ ...p, units: [], deviceOverrides: {} })) });

function placedName(u, rawChess) {
  if (!u) return '';
  if (u.diy?.charId) {
    const rec = data.getRaw('backups')?.units?.[u.diy.charId];
    return data.localeName(rec?.name || u.diy.charId);
  }
  if (u.kind === 'token' || (!u.chessId && u.tokenId)) return data.localeName(data.lookupRaw('tokens', u.tokenId)?.name || u.tokenId || '');
  return data.localeName(rawChess[u.chessId]?.name || u.chessId || '');
}

export function Editor({ scenario: s, compiled, options, update, palette, setPalette, side, setSide, selected, setSelected }) {
  useLang();
  useData('stages', 'chess', 'tokens', 'enemies', 'items', 'bonds', 'bands', 'backups', 'config', 'waves', 'bosses');
  const p = s.players[side] || s.players[0];
  const write = patch => update({ ...s, ...patch });
  const player = patch => write({ players: s.players.map((v, i) => i === side ? { ...v, ...patch } : v) });
  const rawChess = data.getRaw('chess') || {};
  const chess = rawChess[palette.chessId];
  const raw = { chess: rawChess, backups: data.getRaw('backups') };
  const pool = chess?.isDiy ? diyPool(chess.tier, { data: raw }) : [];
  const form = palette.diy ? unitForm(raw.backups, palette.diy.charId, chess?.status) : chess;
  const locked = palette.diy ? lockedSelection(raw, chess?.tier, palette.diy.charId) : null;
  // Display copies: data.get / lookup apply the same file overlay as the match UI. localeName only
  // covers the flat names map, so mode, skill and device names stay Chinese if read from getRaw.
  const locBackups = data.get('backups') || raw.backups;
  const locChess = (palette.chessId && data.lookup('chess', palette.chessId)) || chess;
  const shownForm = palette.diy ? (unitForm(locBackups, palette.diy.charId, chess?.status) || form) : (locChess || form);
  const lockedModName = lockedModuleLabel(locBackups, palette.diy?.charId, locked?.uniEquipId);
  const modes = (data.get('config') || data.getRaw('config'))?.modes || {};
  const fixedLoadout = palette.kind !== 'chess' || !!palette.standIn || !!locked;
  const unit = p.units.find(u => u.uid === selected);
  const pickChess = id => {
    id ||= 'chess_char_1_01_a';
    const rec = rawChess[id];
    const first = rec?.isDiy ? diyPool(rec.tier, { data: raw })[0] : null;
    const charId = typeof first === 'string' ? first : first?.charId;
    const diy = charId ? { charId, ...(lockedSelection(raw, rec.tier, charId) || { skillIndex: 0, uniEquipId: null }) } : null;
    setPalette({ kind: 'chess', chessId: id, dir: palette.dir || 'RIGHT', items: [], ...(diy ? { diy } : {}) });
  };
  const modify = patch => {
    const next = { ...palette, ...patch }; setPalette(next);
    if (unit && unit.kind === palette.kind && (unit.chessId || unit.tokenId) === (palette.chessId || palette.tokenId)) player({ units: p.units.map(u => u.uid === selected ? { ...u, ...patch } : u) });
  };
  const remove = uid => { player({ units: p.units.filter(u => u.uid !== uid && u.ownerUid !== uid) }); setSelected(null); };
  const itemOptions = [['', t('无')], ...entries('items').filter(r => r.itemType === 'EQUIP').map(r => [r.id, labelOf(r)])];
  return html`<div class="sc-editor">
    <details open><summary>${t('场地与波次')}</summary><div class="sc-fields">
      <label>${t('场景名称')}<input value=${s.name} maxLength="120" onChange=${e => write({ name: e.currentTarget.value })} /></label>
      <${Select} label=${t('地图')} value=${s.stageId} options=${entries('stages').map(r => [r.id, labelOf(r)])}
        onChange=${id => write({ stageId: id, players: s.players.map(v => ({ ...v, units: [], deviceOverrides: {} })) })} />
      <${Select} label=${t('战场区域')} value=${s.kind} options=${[['normal', t('各自行动')], ['boss', t('最终攻势')], ['hidden', t('隐秘核心')], ['unite', t('联防')]]} onChange=${kind => { setSide(0); update(changeField(s, kind)); }} />
      <${Select} label=${t('难度')} value=${s.modeId} options=${Object.entries(modes).map(([id, r]) => [id, modeOptionLabel(r, id)])} onChange=${modeId => write({ modeId, waveId: null })} />
      <${Numeric} label=${t('回合')} value=${s.round} min=${1} max=${15} onChange=${round => write({ round })} />
      <${Numeric} label=${t('随机种子')} value=${s.seed} min=${1} max=${4294967295} onChange=${seed => write({ seed })} />
      <${Numeric} label=${t('运行上限（游戏秒）')} value=${s.seconds} min=${1} max=${1200} onChange=${seconds => write({ seconds })} />
      ${['boss', 'hidden'].includes(s.kind) ? html`<${Select} label=${t('领袖')} value=${s.bossId} options=${entries('bosses').filter(r => !!r.hidden === (s.kind === 'hidden')).map(r => [r.id, labelOf(r)])} onChange=${bossId => write({ bossId, waveId: null })} />` : null}
      ${s.kind === 'normal' ? html`<${Select} label=${t('官方波次模板')} value=${s.waveId} options=${[['', t('按回合自动选择')], ...entries('waves').filter(r => r.kind === 'normal' || (r.kind === 'training' && !r.bossId)).map(r => [r.id, r.id])]} onChange=${waveId => write({ waveId: waveId || null })} />` : null}
      <${Select} label=${t('敌人来源')} value=${s.enemyMode} options=${[['official', t('官方波次')], ['custom', t('自定义敌人')]]} onChange=${enemyMode => write({ enemyMode, enemies: [] })} />
      <p>${t('切换地图或战场区域会清空部署；回合决定敌方缩放。')}</p>
      ${compiled ? html`<code>${JSON.stringify(compiled.scale)}</code>` : null}
    </div></details>
    <details open><summary>${t('部署干员与召唤物')}</summary><div class="sc-fields">
      <${Select} label=${t('玩家阵地')} value=${side} options=${s.players.map((_, i) => [i, t('阵地 {n}', { n: i + 1 })])} onChange=${value => { setSide(+value); setSelected(null); }} />
      ${s.kind !== 'normal' ? html`<button type="button" onClick=${() => { setSide(0); write({ players: s.players.length === 1 ? [...s.players, emptyPlayer()] : s.players.slice(0, 1) }); }}>${s.players.length === 1 ? t('添加第二阵地') : t('移除第二阵地')}</button>` : null}
      <${Search} label=${t('干员（普通 / 精锐）')} records=${entries('chess')} value=${palette.chessId} onChange=${pickChess} />
      ${chess?.isDiy ? html`<${Select} label=${t('自选干员')} value=${palette.diy?.charId} options=${pool.map(v => { const id = typeof v === 'string' ? v : v.charId; return [id, data.localeName(raw.backups.units[id]?.name || id)]; })}
        onChange=${charId => modify({ diy: { charId, ...(lockedSelection(raw, chess.tier, charId) || { skillIndex: 0, uniEquipId: null }) }, potential: undefined, cultivate: undefined })} />` : null}
      <${Select} label=${t('技能')} disabled=${fixedLoadout} value=${palette.diy?.skillIndex ?? palette.skillIndex ?? form?.skill?.index ?? shownForm?.skills?.[0]?.index}
        options=${(shownForm?.skills || []).map(sk => [sk.index, skillOptionName(sk)])}
        onChange=${v => modify(palette.diy ? { diy: { ...palette.diy, skillIndex: +v } } : { skillIndex: +v })} />
      <${Select} label=${t('模组')} disabled=${fixedLoadout} value=${palette.diy ? (palette.diy.uniEquipId || 'none') : palette.moduleId ?? form?.modules?.find(m => m.isDefault)?.uniEquipId ?? 'none'}
        options=${[['none', t('不装备')], ...moduleOptions(shownForm?.modules, !!palette.diy, locked?.uniEquipId, lockedModName).map(m => [m.uniEquipId, moduleOptionName(m)])]}
        onChange=${v => modify(palette.diy ? { diy: { ...palette.diy, uniEquipId: v === 'none' ? null : v } } : { moduleId: v })} />
      <${Select} label=${t('朝向')} value=${palette.dir} options=${[['RIGHT', t('右')], ['UP', t('上')], ['LEFT', t('左')], ['DOWN', t('下')]]} onChange=${dir => modify({ dir })} />
      ${[0, 1].map(i => html`<${Select} key=${i} disabled=${palette.kind !== 'chess'} label=${t('装备槽 {n}', { n: i + 1 })} value=${palette.items?.[i] || ''} options=${itemOptions} onChange=${v => { const items = [...(palette.items || [])]; items[i] = v; modify({ items: items.filter(Boolean) }); }} />`)}
      <${Numeric} label=${t('潜能')} disabled=${fixedLoadout} value=${palette.potential ?? 6} min=${1} max=${6} onChange=${potential => modify({ potential })} />
      <${Numeric} label=${t('练度')} disabled=${fixedLoadout} value=${palette.cultivate ?? 0} max=${3} onChange=${cultivate => modify({ cultivate })} />
      <${Select} label=${t('通过所属干员部署召唤物')} value=${palette.kind === 'token' ? `${palette.ownerUid}:${palette.tokenId}` : ''}
        options=${[['', t('部署所选干员')], ...(compiled?.tokens[side] || []).map(v => [`${v.ownerUid}:${v.tokenId}`, `${v.ownerUid} · ${data.localeName(v.name)} (${tokenRemaining(v, p.units)})`])]}
        onChange=${v => { if (!v) pickChess(palette.chessId); else { const [ownerUid, tokenId] = v.split(':'); setPalette({ kind: 'token', tokenId, ownerUid: +ownerUid, dir: palette.dir }); } }} />
      <p>${t('选择单位后点击棋盘格部署。点击已部署单位可检查或移除。')}</p>
      <div class="sc-grid" role="group" aria-label=${t('部署棋盘')}>${[12, 11, 10, 9].flatMap(row => Array.from({ length: 9 }, (_, n) => {
        const col = n + 2, at = p.units.find(u => u.row === row && u.col === col);
        const tile = compiled?.maps[side]?.find(v => v.row === row && v.col === col);
        return html`<button type="button" key=${`${row},${col}`} class=${`sc-tile ${tile?.type || 'blocked'} ${at?.uid === selected ? 'selected' : ''}`} data-row=${row} data-col=${col}
          disabled=${!tile && !at} title=${`${row},${col}${at ? ` · ${at.chessId || at.tokenId}` : ''}`} onClick=${() => {
            if (at) { setSelected(at.uid); setPalette(cloneScenario(at)); return; }
            const uid = Math.max(0, ...s.players.flatMap(v => v.units.map(u => u.uid))) + 1;
            const { uid: _uid, row: _row, col: _col, carryState: _carry, ...choice } = palette;
            player({ units: [...p.units, { ...choice, uid, row, col }] }); setSelected(uid);
          }}>${at ? placedName(at, rawChess) : `${row},${col}`}</button>`;
      }))}</div>
      <ul class="sc-unit-list">${p.units.map(u => html`<li key=${u.uid}><button type="button" onClick=${() => { setSelected(u.uid); setPalette(cloneScenario(u)); }}>${u.uid} · ${placedName(u, rawChess)} (${u.row},${u.col})</button><button type="button" onClick=${() => remove(u.uid)}>${t('移除')}</button></li>`)}</ul>
    </div></details>
    ${s.enemyMode === 'custom' ? html`<${Enemies} s=${s} compiled=${compiled} write=${write} />` : null}
    <details><summary>${t('悬赏精英')}</summary><div class="sc-fields"><${Search} label=${t('添加悬赏')} records=${options.bounties.map(r => ({ ...r, id: r.effectId }))} value="" empty=${true} onChange=${id => { if (id) write({ bounties: [...s.bounties, id] }); }} />
      ${s.bounties.map((id, i) => html`<button type="button" key=${i} onClick=${() => write({ bounties: s.bounties.filter((_, n) => n !== i) })}>${data.localeName(options.bounties.find(b => b.effectId === id)?.name || id)} · ${t('移除')}</button>`)}</div></details>
    <${Globals} s=${s} p=${p} side=${side} compiled=${compiled} player=${player} options=${options} write=${write} />
  </div>`;
}

function Enemies({ s, compiled, write }) {
  const [enemyKey, setEnemy] = useState('enemy_1007_slime');
  const [count, setCount] = useState(1), [time, setTime] = useState(0), [interval, setInterval] = useState(1), [routeIndex, setRoute] = useState(0);
  return html`<details open><summary>${t('自定义敌人')}</summary><div class="sc-fields">
    <${Search} label=${t('敌人')} records=${entries('enemies')} value=${enemyKey} onChange=${setEnemy} />
    <${Numeric} label=${t('数量')} value=${count} min=${1} max=${100} onChange=${setCount} />
    <${Numeric} label=${t('出现时间（秒）')} value=${time} max=${1200} step=${0.1} onChange=${setTime} />
    <${Numeric} label=${t('间隔（秒）')} value=${interval} max=${120} step=${0.1} onChange=${setInterval} />
    <${Select} label=${t('出生门 / 路线')} value=${routeIndex} options=${(compiled?.spec.routes || []).map((r, i) => [i, routeLabel(r, i)])} onChange=${v => setRoute(+v)} />
    <button type="button" onClick=${() => write({ enemies: [...s.enemies, { enemyKey, count, time, interval, routeIndex }] })}>${t('添加敌人')}</button>
    ${s.enemies.map((e, i) => html`<button type="button" key=${i} onClick=${() => write({ enemies: s.enemies.filter((_, n) => n !== i) })}>${data.localeName(data.lookupRaw('enemies', e.enemyKey)?.name || e.enemyKey)} ×${e.count} · ${e.time}s · ${e.routeIndex} · ${t('移除')}</button>`)}
  </div></details>`;
}
function Globals({ s, p, side, compiled, player, options, write }) {
  return html`<details><summary>${t('盟约、策略与机变')}</summary><div class="sc-fields">
    <p>${t('盟约按指定阶数与层数生效；不会自动按阵容激活。')}</p>
    ${entries('bonds').map(b => html`<div class="sc-bond" key=${b.id}><${Select} label=${data.localeName(b.name)} value=${p.bonds[b.id]?.tier || 0} options=${[[0, t('未激活')], ...b.thresholds.map((n, i) => [i + 1, `${i + 1} (${n})`])]}
      onChange=${v => player({ bonds: { ...p.bonds, [b.id]: { tier: +v, layers: p.bonds[b.id]?.layers || 0 } } })} />
      <${Numeric} label=${t('层数')} value=${p.bonds[b.id]?.layers || 0} onChange=${layers => player({ bonds: { ...p.bonds, [b.id]: { tier: p.bonds[b.id]?.tier || 0, layers } } })} /></div>`)}
    <${Select} label=${t('策略')} value=${p.bandId} options=${[['', t('无')], ...entries('bands').map(b => [b.id, labelOf(b)])]} onChange=${id => player({ bandId: id || null })} />
    <${Numeric} label=${t('手牌数量（机变条件）')} value=${p.handUnits} max=${15} onChange=${handUnits => player({ handUnits })} />
    <${Select} label=${t('添加战斗机变')} value="" options=${[['', t('无')], ...options.choices.filter(c => c.supported).map(c => [c.effectId, labelOf(c)])]} onChange=${id => { if (id) player({ choices: [...p.choices, id] }); }} />
    ${p.choices.map((id, i) => html`<button type="button" key=${i} onClick=${() => player({ choices: p.choices.filter((_, n) => n !== i) })}>${data.localeName(options.choices.find(c => c.effectId === id)?.name || id)} · ${t('移除')}</button>`)}
    <details><summary>${t('不支持的机变（整备阶段）')}</summary><ul>${options.choices.filter(c => !c.supported).map(c => html`<li key=${c.effectId}>${labelOf(c)}</li>`)}</ul></details>
    <${Numeric} label=${t('初始部署费用')} value=${s.flags.dpInit ?? 10} max=${99} onChange=${dpInit => write({ flags: { ...s.flags, dpInit } })} />
    <${Numeric} label=${t('每秒部署费用')} value=${s.flags.dpPerSec ?? 1} max=${99} step=${0.25} onChange=${dpPerSec => write({ flags: { ...s.flags, dpPerSec } })} />
  </div></details>
  <details><summary>${t('场地装置')}</summary><div class="sc-fields">
    <p>${t('装置只能在官方地图预设的位置启用或关闭。')}</p>
    ${scenarioDevices(data.lookup('stages', s.stageId) || data.lookupRaw('stages', s.stageId), s, side).map(d => html`<label key=${d.alias}><input type="checkbox" checked=${p.deviceOverrides[d.alias] ?? compiled?.spec.players[side]?.deviceOverrides[d.alias] ?? d.active ?? !d.hidden}
      onChange=${e => player({ deviceOverrides: { ...p.deviceOverrides, [d.alias]: e.currentTarget.checked } })} />${deviceOptionName(d)}</label>`)}
  </div></details>`;
}
