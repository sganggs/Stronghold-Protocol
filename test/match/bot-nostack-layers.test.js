// 规程 bot valuations give noStack bonds no layers. The four 盟约 periods keep the hidden-layer estimates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give, giveItem, legalTileFor } from './harness.js';
import { getVersionData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import {
  acquireLayers, bondLayerWeight, botPickCard, engineFor, gainCountLayers, itemTarget,
  positionTraitValue, prepTraitValue, refreshLayers,
} from '../../server/match/bot.js';

const QUIET = { warn() {}, error() {}, info() {} };
const VERSIONS = [
  ['default', DATA],
  ['V1_1', getVersionData('act1autochess@V1_1', { log: QUIET })],
  ['V1_2', getVersionData('act1autochess', { log: QUIET })],
  ['V2_1', getVersionData('act2autochess@V2_1', { log: QUIET })],
  ['V3_1', getVersionData('act3autochess@V3_1', { log: QUIET })],
];
const ONE = () => 1;
const on = (...ids) => Object.fromEntries(ids.map((id) => [id, { active: true }]));

function hiddenId(raw) {
  const id = Object.keys(raw.bonds).find((bond) => raw.bonds[bond].noStack);
  assert.ok(id, 'this version has a noStack bond');
  return id;
}

function world(raw, extra = {}) {
  const bonds = extra.bonds
    ? {
      ...raw.bonds,
      ...Object.fromEntries(Object.entries(extra.bonds).map(([id, patch]) => [id, { ...raw.bonds[id], ...patch }])),
    }
    : raw.bonds;
  const data = {
    ...raw,
    chess: { ...raw.chess, ...(extra.chess || {}) },
    garrisons: { ...raw.garrisons, ...(extra.garrisons || {}) },
    effects: { ...raw.effects, ...(extra.effects || {}) },
    bonds,
  };
  return { data, gd: new GameData(data, 'mode_multi_hard') };
}

function seat(gd, spec = {}) {
  const ps = {
    gd,
    bonds: spec.bonds || {},
    board: new Map(spec.board || []),
    hand: spec.hand || [],
    round: { refreshes: spec.refreshes || 0 },
    shop: { level: 3 },
    layers: spec.layers || {},
  };
  return { m: { gd }, ps };
}

const piece = (id, bonds, garrisonIds = []) => ({ chessId: id, bonds, garrisonIds });
const viewOf = (entries) => ({ at: new Map(entries) });
const blankView = viewOf([]);

function want(reg, regValue, covenantValue) {
  return reg ? regValue : covenantValue;
}

test('bondLayerWeight: 规程 gives an active noStack bond 0; 盟约 keeps focus, core and other weights', () => {
  for (const [label, raw] of VERSIONS) {
    const hidden = hiddenId(raw);
    const { gd } = world(raw);
    const bonds = { [hidden]: { active: true }, yanShip: { active: true } };
    const reg = gd.regulationLayers;
    assert.equal(bondLayerWeight(gd, bonds, hidden, 'yanShip'), want(reg, 0, 0.3), `${label} other`);
    assert.equal(bondLayerWeight(gd, bonds, hidden, hidden), want(reg, 0, 1), `${label} focus`);
    assert.equal(bondLayerWeight(gd, bonds, 'yanShip', 'yanShip'), 1, `${label} stacking focus`);
    assert.equal(bondLayerWeight(gd, bonds, 'yanShip', 'other'), 0.5, `${label} stacking core`);
    assert.equal(bondLayerWeight(gd, { [hidden]: { active: false } }, hidden, hidden), 0, `${label} inactive`);
  }
});

test('acquireLayers: the shared gate still drops noStack only in 规程, including a plugin that flips the flag', () => {
  for (const [label, raw] of VERSIONS) {
    const hidden = hiddenId(raw);
    const garrisons = {
      g_all: { eventType: 'SERVER_GAIN', effectKey: 'SERVER_ADD_BOND_CHESS_ALL', bb: { count: 5 }, bbStr: {} },
      g_most: { eventType: 'SERVER_GAIN', effectKey: 'SERVER_ADD_BOND_ACTIVATED_MOST_LAYER', bb: { count: 7 }, bbStr: {} },
    };
    const chess = { syn: piece('syn', [hidden, 'yanShip'], ['g_all']) };
    const { gd } = world(raw, { chess, garrisons });
    const both = on(hidden, 'yanShip');
    const got = Object.fromEntries(acquireLayers(...Object.values(seat(gd, { bonds: both })), gd.chess('syn')));
    assert.deepEqual(got, want(gd.regulationLayers, { yanShip: 5 }, { [hidden]: 5, yanShip: 5 }), `${label} own bonds`);
    const most = Object.fromEntries(acquireLayers(
      ...Object.values(seat(gd, { bonds: both, layers: { [hidden]: 100, yanShip: 1 } })),
      { bonds: [hidden, 'yanShip'], garrisonIds: ['g_most'] },
    ));
    assert.deepEqual(most, want(gd.regulationLayers, { yanShip: 7 }, { [hidden]: 7 }), `${label} most layer`);
    const flipped = world(raw, {
      chess,
      garrisons,
      bonds: { [hidden]: { noStack: false }, yanShip: { noStack: true } },
    });
    const plug = Object.fromEntries(acquireLayers(...Object.values(seat(flipped.gd, { bonds: both })), flipped.gd.chess('syn')));
    assert.deepEqual(plug, gd.regulationLayers ? { [hidden]: 5 } : { [hidden]: 5, yanShip: 5 }, `${label} plugin flag`);
  }
});

test('prepTraitValue: summed traits skip noStack in 规程 and a stacking bond beside one still counts', () => {
  for (const [label, raw] of VERSIONS) {
    const hidden = hiddenId(raw);
    const { gd } = world(raw, {
      chess: {
        self: piece('self', [hidden, 'yanShip']),
        front: piece('front', [hidden]),
        bare: piece('bare', []),
      },
    });
    const reg = gd.regulationLayers;
    const { m, ps } = seat(gd, { bonds: on(hidden, 'yanShip') });
    const at = (id, g) => prepTraitValue(m, ps, blankView, ONE, { id }, '10,4', 'RIGHT', g);
    assert.equal(at('self', { effectKey: 'SERVER_ADD_BOND_CHESS_ALL', bb: { count: 3 }, bbStr: {} }), want(reg, 3, 6), `${label} all`);
    const listed = { effectKey: 'SERVER_ADD_BOND', bb: { count: 3 }, bbStr: { bond: `${hidden},yanShip` } };
    assert.equal(at('bare', listed), want(reg, 3, 6), `${label} listed`);
    const multi = { effectKey: 'SERVER_ADD_MULTIPLE_BOND', bb: {}, bbStr: { bond: `${hidden},yanShip`, count: '4,1' } };
    assert.equal(at('bare', multi), want(reg, 1, 5), `${label} multiple`);
    const view = viewOf([['10,5', { kind: 'chess', id: 'front' }]]);
    const pos = { effectKey: 'SERVER_ADD_BOND_POSITION', bb: { count: 3 }, bbStr: { dir: 'front' } };
    assert.equal(prepTraitValue(m, ps, view, ONE, { id: 'bare' }, '10,4', 'RIGHT', pos), want(reg, 0, 3), `${label} position`);
    assert.equal(at('bare', { effectKey: 'SERVER_POOL_CHAR', bb: {}, bbStr: {} }), 12, `${label} gift stays`);
  }
});

test('prepTraitValue: most-layer, level-gap and in-hand estimates drop a noStack-only board only in 规程', () => {
  for (const [label, raw] of VERSIONS) {
    const hidden = hiddenId(raw);
    const { gd } = world(raw, {
      chess: {
        only: piece('only', [hidden]),
        mix: piece('mix', [hidden, 'yanShip']),
        none: piece('none', []),
      },
    });
    const reg = gd.regulationLayers;
    const run = (bonds, hand, g) => prepTraitValue(...[...Object.values(seat(gd, { bonds, hand })), blankView, ONE, { id: 'none' }, '10,4', 'RIGHT', g]);
    const most = { effectKey: 'SERVER_ADD_BOND_ACTIVATED_MOST_LAYER', bb: { count: 5 }, bbStr: {} };
    assert.equal(run(on(hidden), [], most), want(reg, 0, 5), `${label} most, hidden only`);
    assert.equal(run(on(hidden, 'yanShip'), [], most), 5, `${label} most, stacking still active`);
    assert.equal(run({}, [], most), 5, `${label} most, nothing active keeps the estimate`);
    const gap = { effectKey: 'SERVER_ADD_ACT_BOND_DIFF_LV_MOST_LAYER', bb: { multi: 2 }, bbStr: {} };
    assert.equal(run(on(hidden), [], gap), want(reg, 0, 6), `${label} level gap`);
    assert.equal(run(on(hidden, 'yanShip'), [], gap), 6, `${label} level gap beside a stacking bond`);
    const hand = { effectKey: 'SERVER_ADD_BOND_IN_HAND', bb: { count: 4 }, bbStr: {} };
    const only = [{ kind: 'chess', id: 'only' }];
    assert.equal(run(on(hidden), only, hand), want(reg, 0, 2), `${label} hand, hidden only`);
    assert.equal(run(on(hidden, 'yanShip'), [{ kind: 'chess', id: 'mix' }], hand), 2, `${label} hand, mixed chess still counts`);
    assert.equal(run({}, [{ kind: 'chess', id: 'none' }], hand), 2, `${label} hand, no active bond keeps the estimate`);
  }
});

test('positionTraitValue: front, same-row skill, copied prep and trigger skip noStack in 规程', () => {
  for (const [label, raw] of VERSIONS) {
    const hidden = hiddenId(raw);
    const gCopy = { eventType: 'SERVER_PREP_FIN', effectKey: 'SERVER_ADD_BOND', bb: { count: 3 }, bbStr: { bond: `${hidden},yanShip` } };
    const gGain = { eventType: 'SERVER_GAIN', effectKey: 'SERVER_ADD_BOND_CHESS_ALL', bb: { count: 4 }, bbStr: {} };
    const gEng = { eventType: 'SERVER_PREP_FIN', desc: '使自身已激活的盟约层数+4', effectKey: 'SERVER_ADD_BOND', bb: {}, bbStr: {} };
    const { gd } = world(raw, {
      chess: {
        front: piece('front', [hidden], []),
        both: piece('both', [hidden, 'yanShip'], ['g_gain', 'g_eng']),
        copy: piece('copy', [hidden, 'yanShip'], ['g_copy']),
      },
      garrisons: { g_copy: gCopy, g_gain: gGain, g_eng: gEng },
    });
    const reg = gd.regulationLayers;
    const row = viewOf([
      ['10,0', { kind: 'chess', id: 'a' }],
      ['10,1', { kind: 'chess', id: 'b' }],
      ['10,2', { kind: 'chess', id: 'c' }],
    ]);
    const ahead = viewOf([['10,5', { kind: 'chess', id: 'front' }]]);
    const call = (bonds, view, id, t) => positionTraitValue(
      ...Object.values(seat(gd, { bonds })), view, ONE, { id }, '10,4', 'RIGHT', t, false,
    );
    const pos = call(on(hidden), ahead, 'front', { kind: 'pos', off: 1, n: 3, on: 'SERVER_PREP_FIN' });
    assert.equal(pos, want(reg, 0, 3), `${label} front`);
    const skill = { kind: 'rowSkill', cap: 10, n: 1, on: 'IN_BATTLE' };
    assert.equal(call(on(hidden), row, 'a', skill), want(reg, 0, 6), `${label} row skill, hidden only`);
    assert.equal(call(on(hidden, 'yanShip'), row, 'a', skill), 6, `${label} row skill beside a stacking bond`);
    assert.equal(call({}, row, 'a', skill), 6, `${label} row skill, nothing active keeps the estimate`);
    const copied = call(on(hidden, 'yanShip'), viewOf([['10,5', { kind: 'chess', id: 'copy' }]]), 'copy', { kind: 'copy', event: 'SERVER_PREP_FIN' });
    assert.equal(copied, want(reg, 3, 6), `${label} copied prep`);
    const triggered = call(on(hidden, 'yanShip'), viewOf([['10,5', { kind: 'chess', id: 'both' }]]), 'both', { kind: 'trigger' });
    assert.equal(triggered, want(reg, 4, 8), `${label} trigger`);
    const extra = call(on(hidden, 'yanShip'), viewOf([['10,5', { kind: 'chess', id: 'both' }]]), 'both', { kind: 'extra', n: 1 });
    assert.equal(extra, want(reg, 4, 8), `${label} extra casts`);
  }
});

test('gainCountLayers and refreshLayers: a named noStack bond adds nothing in 规程 and still adds in 盟约', () => {
  for (const [label, raw] of VERSIONS) {
    const hidden = hiddenId(raw);
    const garrisons = {
      g_gain: {
        eventType: 'SERVER_PREP_FIN', effectKey: 'SERVER_ADD_BOND_METHOD', bb: { multi: 2 },
        bbStr: { add_method: 'round_gain_char', bond: `${hidden},yanShip` },
      },
      g_mul: {
        eventType: 'SERVER_PREP_FIN', effectKey: 'SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER',
        bb: { multiplier: 3, max_layer: 99 }, bbStr: { bond: `${hidden},yanShip` },
      },
      g_ref: {
        eventType: 'SERVER_REFRESH_SHOP', effectKey: 'SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT',
        bb: { layer: 5 }, bbStr: { bond: hidden },
      },
    };
    const { gd } = world(raw, {
      chess: {
        boarder: piece('boarder', [hidden, 'yanShip'], ['g_gain', 'g_mul']),
        refresher: piece('refresher', [hidden], ['g_ref']),
      },
      garrisons,
    });
    const reg = gd.regulationLayers;
    const gain = (bonds) => gainCountLayers(...Object.values(seat(gd, {
      bonds, board: [['0,0', { kind: 'chess', id: 'boarder' }]],
    })));
    assert.equal(gain(on(hidden, 'yanShip')), want(reg, 2, 4), `${label} gain both`);
    assert.equal(gain(on(hidden)), want(reg, 0, 2), `${label} gain hidden only`);
    const refresh = refreshLayers(...Object.values(seat(gd, {
      bonds: on(hidden, 'yanShip'),
      board: [['0,0', { kind: 'chess', id: 'boarder' }]],
      hand: [{ kind: 'chess', id: 'refresher' }],
    })));
    assert.equal(refresh, want(reg, 3, 11), `${label} refresh`);
    const flipped = world(raw, {
      chess: { boarder: piece('boarder', [hidden, 'yanShip'], ['g_gain']) },
      garrisons,
      bonds: { [hidden]: { noStack: true }, yanShip: { noStack: true } },
    });
    const plug = gainCountLayers(...Object.values(seat(flipped.gd, {
      bonds: on(hidden, 'yanShip'), board: [['0,0', { kind: 'chess', id: 'boarder' }]],
    })));
    assert.equal(plug, reg ? 0 : 4, `${label} marking the stacking bond noStack changes only 规程`);
  }
});

test('engineFor: 规程 夜莺 does not score 协防干员 layers; a self-bond trait still scores a stacking bond', () => {
  const v3 = VERSIONS.find(([label]) => label === 'V3_1')[1];
  const nightGd = new GameData(v3, 'mode_multi_hard');
  const night = v3.chess.chess_char_4_22_a;
  assert.equal(night.name, '夜莺');
  assert.ok(night.bonds.includes('emptyShip'));
  assert.equal(engineFor({ gd: nightGd }, night, 'emptyShip'), false);
  const text = { eventType: 'SERVER_BATTLE_FIN', desc: '使自身已激活的盟约层数+1', effectKey: 'SERVER_ADD_BOND' };
  for (const [label, raw] of VERSIONS) {
    const hidden = hiddenId(raw);
    const { gd } = world(raw, {
      chess: { syn: piece('syn', [hidden, 'yanShip'], ['g_eng']) },
      garrisons: { g_eng: text },
    });
    const c = gd.chess('syn');
    assert.equal(engineFor({ gd }, c, hidden), !gd.regulationLayers, `${label} noStack`);
    assert.equal(engineFor({ gd }, c, 'yanShip'), true, `${label} stacking`);
  }
});

function visibleWith(raw, bond) {
  return Object.values(raw.chess).find((c) => c.visible && !c.isGolden && !c.isDiy && (c.bonds || []).includes(bond));
}

function spItemId(raw) {
  return Object.keys(raw.items).find((id) => raw.items[id].category === 'SP' && !raw.items[id].isGolden);
}

function open(raw) {
  const h = makeMatch({
    mode: 'coop', difficulty: 'HARD', humans: 1, seed: 3, data: raw, fake: true,
  }).start();
  h.toPrep(1, { band: raw.bands.band_bldsk ? 'band_bldsk' : 'band_amiya' });
  const m = h.m;
  const ps = m.order[0];
  ps.hand.fill(null);
  ps.board.clear();
  ps.recompute();
  return { h, m, ps };
}

function activate(ps, ...ids) {
  for (const id of ids) {
    const bond = ps.gd.bond(id);
    ps.bondCountBonus[id] = bond.thresholds?.[0] || bond.activeCount || 1;
  }
  ps.recompute();
  for (const id of ids) assert.equal(ps.bonds[id]?.active, true, id);
}

test('itemTarget: a skill-point item prefers the noStack caster in 盟约 and the stacking caster in 规程', () => {
  for (const [label, raw] of VERSIONS) {
    const hidden = hiddenId(raw);
    const hid = visibleWith(raw, hidden);
    const yan = visibleWith(raw, 'yanShip');
    const sp = spItemId(raw);
    assert.ok(hid && yan && hid.chessId !== yan.chessId && sp, label);
    const { data } = world(raw, {
      chess: {
        [hid.chessId]: { ...hid, garrisonIds: ['g_hid'] },
        [yan.chessId]: { ...yan, garrisonIds: ['g_yan'] },
      },
      garrisons: {
        g_hid: {
          eventType: 'IN_BATTLE', effectKey: 'SYN_SKILL', bb: { bond_add_count: 8 },
          bbStr: { key: 'act1autochess_gar_event_useskill', bond_type: 'bond_by_id', bond_id: hidden },
        },
        g_yan: {
          eventType: 'IN_BATTLE', effectKey: 'SYN_SKILL', bb: { bond_add_count: 1 },
          bbStr: { key: 'act1autochess_gar_event_useskill', bond_type: 'bond_by_id', bond_id: 'yanShip' },
        },
      },
    });
    const { h, m, ps } = open(data);
    try {
      give(m, ps, hid.chessId, 'board', legalTileFor(m, ps, hid.chessId));
      give(m, ps, yan.chessId, 'board', legalTileFor(m, ps, yan.chessId));
      const item = giveItem(m, ps, sp);
      activate(ps, hidden, 'yanShip');
      m.rngBots = () => 0;
      const target = itemTarget(m, ps, item, undefined, false);
      assert.equal(target?.id, ps.gd.regulationLayers ? yan.chessId : hid.chessId, label);
    } finally { h.m.dispose(); }
  }
});

test('botPickCard: a noStack layer tactic is worth 0 in 规程 and keeps its score in 盟约; an empty bond list stays 4', () => {
  for (const [label, raw] of VERSIONS) {
    const hidden = hiddenId(raw);
    const { data } = world(raw, {
      effects: {
        eff_hid: { effectId: 'eff_hid', buffs: [{ key: 'global_special_choice_bond_addlayer', bb: { count: 10 }, bbStr: { bond_list: hidden } }] },
        eff_yan: { effectId: 'eff_yan', buffs: [{ key: 'global_special_choice_bond_addlayer', bb: { count: 1 }, bbStr: { bond_list: 'yanShip' } }] },
        eff_empty: { effectId: 'eff_empty', buffs: [{ key: 'global_special_choice_bond_addlayer', bb: { count: 9 }, bbStr: { bond_list: '' } }] },
        eff_bench: { effectId: 'eff_bench', buffs: [{ key: 'global_special_choice_prep_finish_bench_at_most', bb: {}, bbStr: {} }] },
      },
    });
    const { h, m, ps } = open(data);
    try {
      activate(ps, hidden, 'yanShip');
      m.rngBots = () => 0;
      const card = (id) => ({ kind: 'tactic', id, name: id, team: false, tacticKind: 'ally' });
      const pick = (...ids) => botPickCard(m, ps, ids.map(card), ids.map((_, i) => i));
      const reg = ps.gd.regulationLayers;
      assert.equal(pick('eff_hid', 'eff_yan'), reg ? 1 : 0, `${label} hidden vs stacking`);
      assert.equal(pick('eff_empty', 'eff_bench'), 0, `${label} empty list stays above the bench card`);
      assert.equal(pick('eff_hid', 'eff_empty'), reg ? 1 : 0, `${label} empty list versus a noStack card`);
    } finally { h.m.dispose(); }
  }
});
