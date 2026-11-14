// The picture checker on a tiny fixture. It must not read the shared public/assets tree:
// a missing catalogued icon, a listed URL with no file, and a resolved picture stay distinct.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatUiAssetRefs, uiAssetRefs } from '../tools/ui-asset-refs.mjs';

const repo = path.resolve(import.meta.dirname, '..');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-asset-refs-'));
  const file = (rel) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '');
    return '/' + rel.split(path.sep).join('/').replace(/^public\//, '');
  };
  // public/assets/ui/enemyTypeIcon/special_icon.png → URL /assets/ui/...
  const special = file('public/assets/ui/enemyTypeIcon/special_icon.png');
  const bond = file('public/assets/bond/yanShip.png');
  const trap = file('public/assets/item/trap_ok.png');
  const skill = file('public/assets/skill/sk_ok.png');
  const baseEnemy = file('public/assets/enemy/icon/enemy_base.png');
  const avatar = file('public/assets/char/avatar/char_ok.png');
  const portrait = file('public/assets/char/portrait/char_ok_1.png');
  const token = file('public/assets/token/avatar/token_ok.png');
  const listedMissing = '/assets/enemy/icon/enemy_listed.png';
  const assets = {
    ui: { 'enemyTypeIcon/special_icon': special },
    bonds: { yanShip: bond },
    items: { trap_ok: trap },
    skills: { sk_ok: skill },
    enemies: {
      enemy_listed: { icon: listedMissing },
      enemy_base: { icon: baseEnemy },
    },
    chars: { char_ok: { avatar, portrait } },
    tokens: { token_ok: { avatar: token } },
    prof: { icon: {}, large: {}, sub: {}, battlecard: {} },
  };
  const version = { id: 'fixture', label: 'fixture' };
  const packs = [{
    version,
    factions: { types: {
      SPECIAL: { type: 'SPECIAL', name: '特异', icon: 'special_icon' },
      CRITIC: { type: 'CRITIC', name: '特训敌人·致命', icon: 'critic_icon' },
    } },
    bonds: { yanShip: { bondId: 'yanShip', name: '炎', iconId: 'icon_yanShip' } },
    bands: {},
    items: { trap_ok_item: { name: '武装', iconId: 'no_such_icon', trapId: 'trap_ok' } },
    enemies: {
      enemy_listed: { name: 'listed' },
      enemy_base: { name: 'base' },
      enemy_base_2: { name: 'variant' },
      enemy_9036_acweb: { name: '淤困之茧' },
    },
    chess: {
      chess_ok: { chessId: 'chess_ok', charId: 'char_ok', name: '好', profession: 'SNIPER', subProfessionId: 'fastshot',
        status: { phase: 1 }, tier: 1, skill: { skillId: 'sk_ok', iconId: 'sk_ok', name: '好技能' }, module: { type: 'MAR-X', name: '模组' } },
      chess_placeholder: { chessId: 'chess_placeholder', name: '待选' },
    },
    tokens: { token_ok: { tokenId: 'token_ok', name: '探机', profession: 'TOKEN' } },
    backups: { units: {}, tokens: {} },
    garrisons: { garrison_01_a: { garrisonId: 'garrison_01_a', eventType: 'IN_BATTLE', eventTypeIcon: 'icon_battle', eventTypeDesc: '作战能力' } },
    config: { titles: [{ id: 'comment_1', picId: 'comment_icon_1', name: '卫戍之星' }], trophies: { medals: [] } },
  }];
  return { root, assets, packs, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('a catalogued icon on disk is kept, an unlisted faction icon is reported with its sibling folder', () => {
  const fx = fixture();
  try {
    const result = uiAssetRefs({ root: fx.root, packs: fx.packs, assets: fx.assets, local: { groups: {} }, files: true });
    const critic = result.missing.find((r) => r.id === 'CRITIC');
    assert.ok(critic);
    assert.equal(critic.category, 'faction');
    assert.equal(critic.name, '特训敌人·致命');
    assert.equal(critic.key, 'enemyTypeIcon/critic_icon');
    assert.equal(critic.reason, 'absent');
    assert.equal(critic.officialPath, 'dyn/ui/autochess/[uc]autochessouter/arts/enemytypeicon/critic_icon.png');
    assert.equal(critic.localPath, 'public/assets/ui/enemyTypeIcon/critic_icon.png');
    assert.equal(critic.assumed, true);
    assert.equal(critic.siblingExtracted, true);
    assert.equal(critic.siblingExample, 'enemyTypeIcon/special_icon');
    assert.equal(result.missing.some((r) => r.key === 'enemyTypeIcon/special_icon'), false);
    assert.match(formatUiAssetRefs(result), /critic_icon/);
    assert.match(formatUiAssetRefs(result), /\[ASSUMED\]/);
  } finally {
    fx.cleanup();
  }
});

test('a listed enemy icon with no file is missing; a _digits variant uses the base icon; trapId and skill icons resolve', () => {
  const fx = fixture();
  try {
    const result = uiAssetRefs({ root: fx.root, packs: fx.packs, assets: fx.assets, local: { groups: {} }, files: true });
    const listed = result.missing.find((r) => r.id === 'enemy_listed');
    assert.equal(listed.reason, 'file');
    assert.equal(listed.key, 'enemies/enemy_listed.icon');
    assert.equal(listed.url, '/assets/enemy/icon/enemy_listed.png');
    assert.equal(listed.officialPath, 'yuanyan3060/ArknightsGameResource/main/enemy/enemy_listed.png');
    assert.equal(result.missing.some((r) => r.id === 'enemy_base' || r.id === 'enemy_base_2'), false);
    const cocoon = result.missing.find((r) => r.id === 'enemy_9036_acweb');
    assert.equal(cocoon.reason, 'absent');
    assert.equal(cocoon.key, 'enemies/enemy_9036_acweb.icon');
    assert.equal(result.missing.some((r) => r.id === 'trap_ok_item' || r.id === 'yanShip' || r.id === 'sk_ok'), false);
    assert.equal(result.missing.some((r) => r.id === 'chess_placeholder'), false);
    assert.equal(result.missing.some((r) => r.id === 'chess_ok' && (r.category === 'chess-avatar' || r.category === 'chess-portrait')), false);
    assert.equal(result.missing.some((r) => r.category === 'token' && r.id === 'token_ok'), false);
    assert.equal(result.missing.some((r) => r.category === 'profession' && r.id === 'token'), false);
    const mod = result.missing.find((r) => r.category === 'module' && r.id === 'MAR-X');
    assert.equal(mod.key, 'local.groups.module/MAR-X');
    assert.equal(mod.officialPath, 'dyn/arts/ui/uniequiptype/MAR-X.png');
    const garrison = result.missing.find((r) => r.category === 'garrison');
    assert.equal(garrison.key, 'garrisonTypeIcon/s_icon_battle');
    assert.equal(result.missing.some((r) => r.key === 'buffIcon/icon_stage_buff'), true);
    assert.equal(result.missing.some((r) => r.key === 'modeIcon/mode_training_icon'), false);
    assert.equal(result.missing.some((r) => r.key === 'modeIcon/mode_funny_icon'), true);
  } finally {
    fx.cleanup();
  }
});

test('a bracketed skill id keeps the yuanyan percent-encoding and the pipeline file name', () => {
  const fx = fixture();
  try {
    fx.packs[0].chess.chess_ok.skill = { skillId: 'skcom_charge_cost[1]', iconId: 'skcom_charge_cost[1]', name: '冲锋号令' };
    const result = uiAssetRefs({ root: fx.root, packs: fx.packs, assets: fx.assets, local: { groups: {} }, files: true });
    const skill = result.missing.find((r) => r.id === 'skcom_charge_cost[1]');
    assert.equal(skill.key, 'skills/skcom_charge_cost[1]');
    assert.equal(skill.officialPath, 'yuanyan3060/ArknightsGameResource/main/skill/skill_icon_skcom_charge_cost%5B1%5D.png');
    assert.equal(skill.localPath, 'public/assets/skill/skcom_charge_cost_1_.png');
  } finally {
    fx.cleanup();
  }
});

test('a summon skill is text, not a picture; a map-char skill icon is a lookup', () => {
  const fx = fixture();
  try {
    fx.packs[0].tokens = {
      token_summon: { kind: 'summon', name: '娃娃', skill: { skillId: 'sktok_x', iconId: 'sktok_x', name: '咒', desc: '落咒' } },
      char_map: { kind: 'mapChar', name: '医疗', skill: { skillId: 'sk_missing_map', iconId: 'sk_missing_map', name: '治疗', desc: '回复' } },
    };
    const result = uiAssetRefs({ root: fx.root, packs: fx.packs, assets: fx.assets, local: { groups: {} }, files: true });
    assert.equal(result.missing.some((r) => r.id === 'sktok_x'), false);
    const skill = result.missing.find((r) => r.id === 'sk_missing_map');
    assert.equal(skill.category, 'skill');
    assert.equal(skill.key, 'skills/sk_missing_map');
  } finally {
    fx.cleanup();
  }
});

test('--files off treats a listed URL as present; --no-files is not the default the audit wants', () => {
  const fx = fixture();
  try {
    const result = uiAssetRefs({ root: fx.root, packs: fx.packs, assets: fx.assets, local: { groups: {} }, files: false });
    assert.equal(result.missing.some((r) => r.id === 'enemy_listed'), false);
    assert.equal(result.missing.find((r) => r.id === 'CRITIC').reason, 'absent');
  } finally {
    fx.cleanup();
  }
});

test('the command exits 0 and --json lists the missing faction on a tiny data root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-asset-refs-cli-'));
  const put = (rel, doc) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof doc === 'string' ? doc : JSON.stringify(doc));
  };
  try {
    for (const name of ['chess', 'tokens', 'enemies', 'items', 'bands', 'bonds', 'bosses', 'stages']) put(`data/${name}.json`, {});
    put('data/backups.json', { units: {}, tokens: {} });
    put('data/factions.json', { types: { CRITIC: { type: 'CRITIC', name: '致命', icon: 'critic_icon' } } });
    put('data/assets.json', { ui: {}, chars: {}, enemies: {}, tokens: {}, bonds: {}, bands: {}, items: {}, skills: {} });
    put('data/local-assets.json', { groups: {} });
    const run = spawnSync(process.execPath, ['tools/ui-asset-refs.mjs', `--root=${root}`, '--json'], { cwd: repo, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const body = JSON.parse(run.stdout);
    const critic = body.missing.find((r) => r.id === 'CRITIC');
    assert.equal(critic.key, 'enemyTypeIcon/critic_icon');
    assert.equal(critic.siblingExtracted, false);
    assert.equal(body.versions.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
