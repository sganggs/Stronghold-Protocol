// ui/gameLogic/terrain.js — the tips of a tap on the ground: special terrain tiles (GitHub issue #184: 特殊地形的单击信息
// 提示) and, in the same place, stage devices (阻隔工事 / “双眼皮” / 射击台 / 气流: GitHub #228, PR #229 by @rickylxw —
// deviceInfo / deviceTipAt below). Re-exported from ../gameLogic.js.
//
// The words go through t() (docs/I18N.md: the Chinese text is the msgid, public/i18n/en.json the English): the name /
// tag / fact tables are marked N_() and translated where terrainInfo hands them out, the mechanism lines are built
// with their numbers as params. A device's NAME is a data text (data/stages.json `devices[].name`, localized by the
// data overlay: "Barricade", "'Double Lids'" …), not a msgid.

import { isObj } from './shared.js';
import { t, N_ } from '../../../../shared/i18n.js';

// ---- special terrain tips (GitHub issue #184: 特殊地形的单击信息提示) ----------------------------------------

/**
 * What tapping a special tile says. `lines` are functions of the stage's own terrain parameters (`stage.special[<terrain>]`
 * and the tile's `bb`, the very numbers the sim runs on — server/sim/content/devices.js), so a tip can never disagree with
 * the battle; the prose is ours (docs/PLAYING.md wording, PRTS 特殊地形 / 沼泽控制 / 深水区 地形信息).
 * `tag` is the chip above the name; `fact` needs the tile's own legend entry (see terrainInfo).
 */
const TERRAIN_TIPS = Object.freeze({
  infection: {
    name: N_('活性源石'), tag: N_('特殊地形'),
    lines: (st) => {
      const b = isObj(st?.infection?.bb) ? st.infection.bb : {};
      const dmg = param(b.damage, 0);
      const mods = [];
      if (param(b.atk, 0)) mods.push(t('攻击力 +{atk}%', { atk: Math.round(param(b.atk, 0) * 100) }));
      if (param(b.attack_speed, 0)) mods.push(t('攻击速度 +{aspd}', { aspd: param(b.attack_speed, 0) }));
      return [
        dmg ? t('部署于其上的我方单位、经过的敌方单位，每秒受到 {dmg} 点真实伤害（无来源）', { dmg }) : t('在其上的我方单位与经过的敌方单位持续受到伤害'),
        mods.length ? t('同时获得：{mods}', { mods }) : null,
        param(b.duration, 0) ? t('效果持续 {sec} 秒；离开地块后仍然保留，再次接触会重新计时', { sec: param(b.duration, 0) }) : null,
      ].filter(Boolean);
    },
  },
  mire: {
    name: N_('沼泽'), tag: N_('特殊地形'),
    lines: (st) => {
      const m = isObj(st?.mire) ? st.mire : {};
      const per = param(m.aspdPerStack, -0.05);
      const move = param(m.moveMulPerStack, -0.05);
      const max = param(m.maxStacks, 10);
      const heavy = param(m.heavyWeight, 3);
      const sec = param(m.intervalSec, 1);
      return [
        move
          ? t('留在沼泽里的单位每 {sec} 秒获得 1 层「陷入沼泽」：攻击速度 {aspd}，敌方单位还有移动速度 {move}', { sec, aspd: pctText(per), move: pctText(move) })
          : t('留在沼泽里的单位每 {sec} 秒获得 1 层「陷入沼泽」：攻击速度 {aspd}', { sec, aspd: pctText(per) }),
        heavy ? t('重量 ≥ {heavy} 的敌人一次获得 2 层', { heavy }) : null,
        t('最多 {max} 层；离开沼泽后解除', { max }),
      ].filter(Boolean);
    },
  },
  smog: {
    name: N_('排气格栅'), tag: N_('特殊地形'),
    // the sim gives the tile's buff `flags: { stealth: true }` (devices.js enterTerrain): enemy ranged targeting
    // skips it like 隐匿 — and, like 隐匿, it does NOT stop the enemy it blocks from attacking it (PRTS 隐匿).
    lines: () => [
      t('站在排气格栅上的干员不会被敌方的远程攻击选中（效果相当于隐匿）'),
      t('但挡住敌人的干员仍会被它攻击到'),
    ],
  },
  duelGrass: {
    name: N_('隐匿地块'), tag: N_('特殊地形'),
    lines: () => [
      t('其上的双方地面单位获得隐匿，离开地块后解除'),
      t('敌方单位被阻挡时显形，解除阻挡后立即恢复隐匿'),
    ],
  },
  deepsea: {
    name: N_('深水区'), tag: N_('特殊地形'),
    lines: (st) => {
      const b = isObj(st?.deepsea?.bb) ? st.deepsea.bb : {};
      const dmg = param(b['sea_drown[enemy].damage'], 0);
      const aspd = param(b['sea_drown[enemy].attack_speed'], 0);
      const move = param(b['sea_drown[enemy].move_speed'], 0);
      const out = [];
      if (dmg) out.push(t('敌人每秒受到 {dmg} 点伤害', { dmg }));
      const slowed = move && move !== 1;
      if (aspd && slowed) out.push(t('攻击速度 {aspd}、移动速度 ×{move}', { aspd: pctText(aspd), move }));
      else if (aspd) out.push(t('攻击速度 {aspd}', { aspd: pctText(aspd) }));
      else if (slowed) out.push(t('移动速度 ×{move}', { move }));
      // devices.js tickDeepsea: sourceless true damage tagged 'dot' / 'periodic' / 'deepsea' — deliberately NOT 'terrain'
      // (环境伤害, which is what 活性源石's tick is): it is nobody's damage, so no 干员's 增伤 / 穿透 / 装备 applies.
      out.push(t('溺水伤害属于无来源伤害（不吃干员的增伤、穿透与装备加成），也不归类为环境伤害'));
      out.push(t('拒绝部署（特制水上平台可以让这一格变得可部署）'));
      return out;
    },
  },
  start: { name: N_('红门'), tag: N_('敌方入口'), lines: () => [t('敌方单位从这里出场')] },
  end: { name: N_('蓝门'), tag: N_('保护目标'), lines: () => [t('敌人走进这里会扣你的目标生命值（LP），一回合至多 10 点')] },
  telin: { name: N_('传送入口'), tag: N_('特殊地形'), lines: () => [t('敌人走到这里会从场上消失')] },
  telout: { name: N_('传送出口'), tag: N_('特殊地形'), lines: () => [t('消失的敌人会从这里重新出现')] },
});

/** Tile keys that carry a tip of their own although the legend gives them no `special` tag (gates, teleports). */
const TIP_BY_TILEKEY = Object.freeze({ tile_start: 'start', tile_end: 'end', tile_telin: 'telin', tile_telout: 'telout', tile_duel_grassland: 'duelGrass' });
/** 深水区's own legend entry is the one tile whose mechanism overrides the level's buildableType (grid.js DEPLOY_REFUSED_TILES). */
const BUILDABILITY = Object.freeze({ ALL: N_('可部署'), MELEE: N_('仅近战位可部署'), RANGED: N_('仅远程位可部署'), NONE: N_('不可部署') });

const param = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const pctText = (v) => `${v > 0 ? '+' : '−'}${Math.abs(Math.round(param(v, 0) * 100))}%`;

/**
 * The tip a tap on board tile (row, col) opens (GitHub issue #184 — "建议加入对于特殊地形的单击信息提示"), or null for an
 * ordinary tile (road / floor / wall / fence …): those say nothing, so a tap on them still just closes what is open.
 * The tile comes from the stage the board on screen is built from (`stage.rows` + `stage.tiles`, data/stages.json), and
 * the numbers from that stage's own terrain parameters — the same values the sim runs. It reads the stage only, so a
 * 补位 / 自选 board (whose pieces are other records) explains its tiles the same way. The text is in the current
 * language (t()).
 * @param {{ rows?: string[], tiles?: Record<string, any>, special?: any } | null | undefined} stage the shown field's stage
 * @param {number} row board row (row 0 = the bottom row, DESIGN §1)
 * @param {number} col
 * @returns {{ key:string, name:string, tag:string, row:number, col:number, lines:string[], facts:string[] } | null}
 */
export function terrainInfo(stage, row, col) {
  const rows = Array.isArray(stage?.rows) ? stage.rows : null;
  const line = rows && Number.isInteger(row) && row >= 0 ? rows[row] : null;
  if (typeof line !== 'string' || !Number.isInteger(col) || col < 0 || col >= line.length) return null;
  const tiles = isObj(stage.tiles) ? stage.tiles : null;
  const tile = tiles ? tiles[line[col]] : null;
  if (!isObj(tile)) return null;
  const key = tile.special || TIP_BY_TILEKEY[tile.tileKey] || null;
  const tip = key ? TERRAIN_TIPS[key] : null;
  if (!tip) return null;
  const facts = [];
  const build = BUILDABILITY[tile.buildable];
  if (build) facts.push(t(build));
  if (tile.height === 'HIGH') facts.push(t('高台'));
  if (tile.groundPassable === false) facts.push(t('只有空中单位能通过'));
  else if (tile.groundPassable === true) facts.push(t('地面单位可通过'));
  return { key, name: t(tip.name), tag: t(tip.tag), row, col, lines: tip.lines(stage.special).filter((s) => typeof s === 'string' && s), facts };
}

// ---- stage device tips (GitHub #228, PR #229 by @rickylxw: the stage DEVICES, not only the tiles) ---------------------

/** The device roles a tap explains; the rest is invisible (盟约寒风, the 沼泽 / 涨潮 controllers) or not fielded this season. */
const DEVICE_TIP_ROLES = Object.freeze(['crate', 'turret', 'platform', 'blower']);
/** Roles the battle spawns as device UNITS (Battle._spawnStageDevices, devices.js spawnTurret): in a battle a tap finds them by unit. */
const DEVICE_UNIT_ROLES = Object.freeze(['crate', 'turret']);
const TIP_TAG = N_('场地装置');
const DIR_NAME = Object.freeze({ UP: N_('上'), DOWN: N_('下'), LEFT: N_('左'), RIGHT: N_('右') });

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * What tapping a stage device says — the same contract as TERRAIN_TIPS, but `lines` read the device's own stage entry
 * (data/stages.json `stage.devices[]`: stats / skill blackboard / dir / rangeTiles), the very numbers the sim runs
 * (`sim/content/devices.js`, `Battle._spawnStageDevices`), so a tip can never disagree with the battle. The prose is ours
 * (docs/PLAYING.md wording; PRTS 阻隔工事 / “双眼皮” / 射击台 / 源石流发生装置 and the sim's behaviour). `stats` is the
 * stat grid under the lines (the turret's), `facts` what the tile allows.
 */
const DEVICE_TIPS = Object.freeze({
  crate: {
    lines: (st, d) => [
      t('挡在地面上的工事：地面敌人会绕开它走；只有无路可走时才会撞上来，把它摧毁后继续前进'),
      t('生命 {hp} 点，被摧毁后从场上消失', { hp: param(d.stats?.maxHp, 100) }),
    ],
    facts: () => [t(BUILDABILITY.NONE)],            // board.js buildDeployMap: an active crate takes its tile off the deploy map
  },
  turret: {
    lines: (st, d) => {
      const bb = isObj(d.skill?.bb) ? d.skill.bb : {};
      // devices.js spawnTurret: the same blackboard keys and the same `持续N秒` read from the skill text
      const dur = /持续(\d+(?:\.\d+)?)秒/.exec(String(d.skill?.desc ?? ''));
      const aspdMax = param(bb.max_attack_speed, Infinity);
      const fragMax = param(bb.max_damage_scale, Infinity);
      return [
        t('自动攻击射程内的一名敌人，造成法术伤害，命中的敌人附加脆弱'),
        t('按当前层数最高的盟约计算：每 1 层，攻击速度 +{aspd}（至多 +{aspdMax}），附加的脆弱 +{frag}%（至多 +{fragMax}%）', {
          aspd: param(bb.attack_speed_per_stack, 1),
          aspdMax: Number.isFinite(aspdMax) ? aspdMax : '∞',
          frag: round1(param(bb.damage_scale_per_stack, 0.001) * 100),
          fragMax: Number.isFinite(fragMax) ? round1((fragMax - 1) * 100) : '∞',
        }),
        dur ? t('脆弱持续 {sec} 秒', { sec: Number(dur[1]) }) : null,
      ];
    },
    stats: (st, d) => {
      const s = isObj(d.stats) ? d.stats : {};
      const out = [{ k: t('生命上限'), v: param(s.maxHp, 100) }];
      if (param(s.atk, 0)) out.push({ k: t('攻击'), v: param(s.atk, 0) });
      if (param(s.def, 0)) out.push({ k: t('防御'), v: param(s.def, 0) });
      const sec = param(s.bat, 0) > 0 ? param(s.bat, 0) * 100 / (param(s.aspd, 100) > 0 ? param(s.aspd, 100) : 100) : 0;
      if (sec) out.push({ k: t('攻击间隔'), v: `${round1(sec)}s` });
      return out;
    },
    facts: () => [t(BUILDABILITY.NONE)],
  },
  platform: {
    lines: () => [
      t('高台位装置：地面敌人不能走上这一格'),
      t('远程位干员可以部署在其上；站上去的干员在高位，不阻挡敌人'),
    ],
    facts: () => [t(BUILDABILITY.RANGED)],          // board.js: an active platform makes its tile a 'ranged' deploy tile
  },
  blower: {
    lines: (st, d) => {
      // devices.js buildTerrain: the device's own skill blackboard, else stage.special.blower.bb; rangeTiles = its own tile + the lane
      const bb = isObj(d.skill?.bb) ? d.skill.bb : (isObj(st?.blower?.bb) ? st.blower.bb : {});
      const dir = DIR_NAME[String(d.dir || 'UP').toUpperCase()] || DIR_NAME.UP;
      const lane = Array.isArray(d.rangeTiles) && d.rangeTiles.length > 1 ? d.rangeTiles.length - 1 : 3;
      const out = [t('向前方 {n} 格吹出气流（这一台朝{dir}）', { n: lane, dir: t(dir) })];
      const eq = param(bb['blower_s_character[equal].atk'], 0);
      const op = param(bb['blower_s_character[opposite].atk'], 0);
      const mods = [];
      if (eq) mods.push(t('朝向与风向相同的攻击力 {v}', { v: pctText(eq) }));
      if (op) mods.push(t('相反的 {v}', { v: pctText(op) }));
      if (mods.length) out.push(t('部署在气流里的干员：{mods}', { mods }));
      const eqM = param(bb['blower_s_enemy[equal].move_speed'], 0);
      const opM = param(bb['blower_s_enemy[opposite].move_speed'], 0);
      const em = [];
      if (eqM) em.push(t('顺风移动速度 ×{v}', { v: round2(1 + eqM) }));
      if (opM) em.push(t('逆风 ×{v}', { v: round2(1 + opM) }));
      if (em.length) out.push(t('在气流里移动的敌人：{mods}', { mods: em }));
      return out;
    },
    facts: () => [t(BUILDABILITY.NONE)],
  },
});
const round2 = (v) => Math.round(v * 100) / 100;

/** A stage device entry is drawn: `active` when it carries it, else not `hidden` (render/tiles.js _stageDevices, board3d/layout.js stageDevices). */
const deviceDrawn = (d) => (typeof d.active === 'boolean' ? d.active : !d.hidden);

/** The card of stage device `d` standing at (row, col) — `tip` is DEVICE_TIPS[d.role]. */
function deviceCard(stage, d, row, col) {
  const tip = DEVICE_TIPS[d.role];
  const lines = tip.lines(stage.special, d).filter((s) => typeof s === 'string' && s);
  const stats = typeof tip.stats === 'function' ? tip.stats(stage.special, d) : null;
  const name = typeof d.name === 'string' && d.name ? d.name : String(d.role);
  return {
    key: d.role, name, tag: t(TIP_TAG), row, col, lines, facts: tip.facts(stage.special, d).filter(Boolean),
    ...(stats && stats.length ? { stats } : {}),
  };
}

/**
 * The tip a tap on the tile (row, col) opens when a stage DEVICE stands on it (GitHub #228, PR #229), or null: an ordinary
 * tile — or a device this client does not draw (`active` false: a turret that stays dormant until 机械援助 / a 机变 card
 * switches it on, a crate such a card removed) — falls through to `terrainInfo`. Visibility mirrors what the renderers draw
 * (`render/tiles.js _stageDevices`, `board3d/layout.js stageDevices`): `active` when set, else not `hidden`. The stage is
 * the shown field's (already the player's own `effectiveStage`, so a card-removed crate is not in the way). The device's
 * name is its data text (localized by the data overlay); the lines are in the current language (t()).
 * @param {{ devices?: any[], special?: any, rows?: string[], tiles?: Record<string, any> } | null | undefined} stage
 * @param {number} row board row (row 0 = the bottom row, DESIGN §1)
 * @param {number} col
 * @param {{ roles?: readonly string[] }} [opts] `roles`: only these roles answer (default: the four of DEVICE_TIP_ROLES)
 * @returns {{ key:string, name:string, tag:string, row:number, col:number, lines:string[], facts:string[], stats?:{k:string,v:string|number}[] } | null}
 */
export function deviceInfo(stage, row, col, { roles = DEVICE_TIP_ROLES } = {}) {
  const list = Array.isArray(stage?.devices) ? stage.devices : null;
  if (!list || !Number.isInteger(row) || !Number.isInteger(col)) return null;
  for (const d of list) {
    if (!isObj(d) || !Array.isArray(d.pos) || d.pos[0] !== row || d.pos[1] !== col) continue;
    if (!roles.includes(d.role) || !DEVICE_TIPS[d.role] || !deviceDrawn(d)) continue;
    return deviceCard(stage, d, row, col);
  }
  return null;
}

/**
 * The tip of a tap on (row, col) while a BATTLE shows the field — the live counterpart of `deviceInfo`: crates and “双眼皮”
 * turrets are device UNITS there (kind 'device', one per drawn stage device, `defId` = the device key), so they are
 * found by the unit standing on the tile — a turret outside the battle's rect stands on another tile than its stage `pos`
 * (devices.js deviceTile) — and what the card says comes from the stage entry of that key. The platforms and blowers are no
 * units: they answer by their stage `pos`, as in the prep.
 * A destroyed device (HP gone, or no longer in the snapshots once its DIE animation is over) is not there any more: the
 * tap belongs to the tile under the wreck (null here, so it falls through to `terrainInfo`). Before the first snapshot of the
 * battle has arrived (`snap` empty) a unit counts as standing.
 * The result is the same card as `deviceInfo`'s, with `unitId` (the unit, for its live HP: the screen reads `b.snap`
 * through it, like a unit card's `snapHp`).
 * @param {object|null|undefined} stage the shown field's stage
 * @param {number} row @param {number} col
 * @param {{ units?: any[]|null, snap?: Map<number, any[]>|null }} battle the field's unit infos (m.field.units) and the
 *   latest snapshot tuples by unit id ([id, x, y, hp, maxHp, …])
 */
export function deviceTipAt(stage, row, col, { units = null, snap = null } = {}) {
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
  const u = (Array.isArray(units) ? units : []).find((x) => isObj(x) && x.kind === 'device' && Math.round(Number(x.x)) === col && Math.round(Number(x.y)) === row);
  if (!u) return deviceInfo(stage, row, col, { roles: DEVICE_TIP_ROLES.filter((r) => !DEVICE_UNIT_ROLES.includes(r)) });
  if (snap && snap.size > 0) {
    const tuple = snap.get(u.id);
    if (!Array.isArray(tuple) || !(tuple[3] > 0)) return null;
  }
  const list = Array.isArray(stage?.devices) ? stage.devices : [];
  const same = list.filter((d) => isObj(d) && d.key === u.defId && DEVICE_UNIT_ROLES.includes(d.role));
  const d = same.find((x) => Array.isArray(x.pos) && x.pos[0] === row && x.pos[1] === col) || same[0];
  return d ? { ...deviceCard(stage, d, row, col), unitId: u.id } : null;
}

/**
 * Fold the device units a battle shows into `map` (UnitInfo by unit id): the field meta's `units` (what stands when the field
 * is entered) and the 'spawn' event tuples `['spawn', UnitInfo]` after it — the stage crates and the “双眼皮” turrets come
 * into being with the battle's first step (`battleStart`), after the meta of a battle shown from its beginning was taken.
 * Only kind 'device' is kept; `deviceTipAt` reads the map's values.
 * @param {Map<number, any>} map
 * @param {{ units?: any[]|null, events?: any[]|null }} [from]
 */
export function noteDeviceUnits(map, { units = null, events = null } = {}) {
  for (const u of Array.isArray(units) ? units : []) if (isObj(u) && u.kind === 'device' && u.id != null) map.set(u.id, u);
  for (const e of Array.isArray(events) ? events : []) if (Array.isArray(e) && e[0] === 'spawn' && isObj(e[1]) && e[1].kind === 'device' && e[1].id != null) map.set(e[1].id, e[1]);
  return map;
}

/**
 * The device-unit map after entering a field. A refresh of the same field whose new meta names no device
 * (the start-of-battle list: crates and turrets arrive as `spawn` and are not repeated) keeps the units
 * already noted. A meta that names devices replaces the map. A different field does not keep the previous one.
 * @param {Map<number, any>|null|undefined} previous
 * @param {Map<number, any>} noted
 * @param {boolean} sameField
 */
export function deviceUnitsForEntry(previous, noted, sameField) {
  if (!(noted instanceof Map) || noted.size > 0 || !sameField) return noted instanceof Map ? noted : new Map();
  return previous instanceof Map && previous.size > 0 ? previous : noted;
}
