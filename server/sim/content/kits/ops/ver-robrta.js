// server/sim/content/kits/ops/ver-robrta.js — 罗比菈塔 (char_484_robrta), 规程·序列Ⅰ.
// Stock, the cap and leaving with her are the craftsman helpers (op-ironmn.js). This mode does not pre-place the
// 造型仪, so the kit deploys them. The token's respawnTime is the official in-place return and is not run here.
// The def% / shield duration are the token talent; the chess talent blackboard is only the carried count.

import { offsetTile } from '../../../dir.js';
import { num, summonTileFree, talentBb, traitBb, up } from '../shared/tier1.js';
import { kitSkills, posDur } from '../shared/version.js';
import { deviceState, devicesLeaveWithOwner, devicesUp, rechargeDevices } from './op-ironmn.js';

const S1 = 'skchr_robrta_1';
const S2 = 'skchr_robrta_2';
const TOKEN = 'token_10018_robrta_mach';

function shieldLayers(desc) {
  const m = /(\d+)层/.exec(String(desc || ''));
  return m ? +m[1] : 0;
}

function faceOwner(r, c, owner) {
  const tr = owner.tileR, tc = owner.tileC;
  if (tr === r + 1 && tc === c) return 'UP';
  if (tr === r - 1 && tc === c) return 'DOWN';
  if (tc === c + 1 && tr === r) return 'RIGHT';
  if (tc === c - 1 && tr === r) return 'LEFT';
  return owner.dir;
}

function deviceTile(battle, unit) {
  for (const [dr, dc] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
    const [r, c] = offsetTile(unit.tileR, unit.tileC, dr, dc, unit.dir);
    if (summonTileFree(battle, r, c)) return [r, c];
  }
  return null;
}

function tokenTalent(battle, owner) {
  const td = battle.tokenDef(TOKEN, owner);
  const list = td?.talents ?? [];
  return list.find((t) => t?.bb && (t.bb.def != null || t.bb.duration != null)) ?? null;
}

function machineKit(owner) {
  return {
    trait: { noAttack: true },
    install(battle, dev) {
      battle.on('deploy', (ctx) => {
        if (ctx.unit !== dev) return;
        const talent = tokenTalent(battle, owner);
        const defPct = num(talent?.bb?.def);
        const dur = num(talent?.bb?.duration);
        let layers = shieldLayers(talent?.desc) || shieldLayers(talent?.descRaw);
        // [ASSUMED] 2 only when the token sentence has no 层 count. The built sentence says 2层.
        if (!(layers > 0)) layers = 2;
        const [r, c] = offsetTile(dev.tileR, dev.tileC, 0, 1, dev.dir);
        const a = battle.unitAt(r, c);
        if (!a || a.kind !== 'op' || a.side !== 'ally') return;
        if (a.def?.position !== 'MELEE' && a.profile?.attack !== 'melee') return;
        if (!(dur > 0)) return;
        if (defPct > 0) battle.addBuff(a, { key: 'robrta:def', mods: { defPct }, duration: dur, refresh: 'replace', source: dev, tags: ['talent'] });
        if (layers > 0) battle.addBuff(a, { key: 'robrta:shield', shieldHits: layers, duration: dur, refresh: 'replace', visible: true, source: dev, tags: ['talent'] });
      }, { owner: dev });
    },
  };
}

function placeDevice(battle, unit) {
  const st = deviceState(unit);
  if (st.stock <= 0 || devicesUp(unit).length >= (unit.mem.robrtaField || 1)) return null;
  const tile = deviceTile(battle, unit);
  if (!tile) return null;
  const [r, c] = tile;
  st.stock -= 1;
  const dev = battle.spawnToken(unit, TOKEN, r, c, {
    dir: faceOwner(r, c, unit), untargetable: true, kit: machineKit(unit),
  });
  if (!dev) { st.stock += 1; return null; }
  st.devices.add(dev);
  battle.fx('summon', { x: dev.x, y: dev.y, id: dev.id, src: unit.id });
  return dev;
}

function robrta(_bb, chess, def) {
  const stockCap = Math.max(1, Math.floor(num(talentBb(chess, 0).cnt, 3) + num(traitBb(chess).cnt)));
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk), defPct: num(sbb.def) },
    };
    if (id === S2) return {
      kind: 'duration', duration: posDur(rec),
      mods: { blockCnt: num(sbb.block_cnt), defPct: num(sbb.def) },
      attack: { noAttack: true },
      onEnd({ battle, unit }) {
        if (!up(unit)) return;
        rechargeDevices(unit, num(sbb['robrta_s_2[recharge].cnt']));
        // [ASSUMED] the device gained at the end is deployed at once, with no separate DP payment. The cost cut is
        // already the token variant's cost, and this battle does not run a placement phase for unplaced stock.
        placeDevice(battle, unit);
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const td = battle.tokenDef(TOKEN, unit);
      unit.mem.robrtaField = Math.max(1, Math.floor(num(td?.stats?.deployLimit ?? td?.deployLimit, 3)));
      battle.on('deploy', (ctx) => {
        if (ctx.unit !== unit) return;
        const st = deviceState(unit);
        // [ASSUMED] one prepared device on deploy (the sentence's 携带 is the stock, 最多部署 is the field cap),
        // on a free orthogonal tile, the one behind her first, facing her so its [0, 1] tile is hers.
        if (!devicesUp(unit).length) { st.cap = stockCap; st.stock = stockCap; }
        placeDevice(battle, unit);
      }, { owner: unit });
      devicesLeaveWithOwner(battle, unit);
    },
  };
}

export default { char_484_robrta: robrta };
