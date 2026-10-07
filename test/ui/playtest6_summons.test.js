// User playtest #6 items 1 and 2, the UI side: a summon piece in the hand / on the board says how it takes the field
// (ui/detailPanel.js summonDeployHint / TokenDetail) — 赫默's 医疗探机 once at the battle start, then each time her skill
// fires; 凯瑟琳's 支援装置 with the board — and shows what it does (the device's talent 定向支援信号, the doll's token
// skill), with the numbers of the owner's own variant (a golden owner's summon is stronger: resolveDetail finds the
// owner by `ownerUid`). One switch, shared/constants.js SKILL_SUMMON_START_DEPLOY (the PRTS start-of-battle deploy,
// settled by the user after playtest #6), drives the sim and the hint; the guide (docs/PLAYING.md §4) and docs/SIM.md
// must say the same. The rules themselves:
// test/match/playtest6_summons.test.js (prep) and test/content/playtest6_summons.test.js (battle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { TokenDetail, summonDeployHint, resolveDetail } = await import('../../public/js/ui/detailPanel.js');
const { tokenVariantFor } = await import('../../public/js/ui/gameLogic/loadout.js');
const { indexPieces } = await import('../../public/js/ui/gameLogic.js');
const { SKILL_SUMMON_START_DEPLOY } = await import('../../shared/constants.js');
const simTokens = await import('../../server/sim/content/tokens.js');
const { data } = await import('../../public/js/data.js');
const TOKENS = JSON.parse(readFileSync(path.join(ROOT, 'data', 'tokens.json'), 'utf8'));

const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (typeof v === 'object' && typeof v.type === 'function' && ['Section', 'Stat', 'LiveTag'].includes(v.type.name)) return textOf(v.type(v.props));
  return typeof v === 'object' ? textOf(v.props?.children) : '';
};

test('summonDeployHint: skill summons at the start and with the skill, talent summons with the board, other tokens say nothing', () => {
  assert.equal(SKILL_SUMMON_START_DEPLOY, true, 'the user\'s answer after playtest #6: the PRTS start deploy');
  assert.match(summonDeployHint(TOKENS.token_10000_silent_healrb), /^作战开始时在摆放的位置部署一次.*发动技能时/);
  assert.match(summonDeployHint(TOKENS.token_10006_vodfox_doll), /^作战开始时在摆放的位置部署一次.*发动技能时/);
  for (const id of ['token_10041_cathy_catsld', 'token_10028_vigil_wolf', 'token_10017_skadi2_dedant', 'token_10030_mlyss_wtrman']) {
    assert.match(summonDeployHint(TOKENS[id]), /作战开始时/, id);
  }
  assert.equal(summonDeployHint(TOKENS.token_10056_angel2_target), null, '投递坐标 is no hand piece');
  assert.equal(summonDeployHint(TOKENS.enemy_9012_acloon), null);
});

test('one switch for the start-of-battle deploy: the sim and the hint read shared/constants.js SKILL_SUMMON_START_DEPLOY', () => {
  assert.equal(simTokens.SKILL_SUMMON_START_DEPLOY, SKILL_SUMMON_START_DEPLOY, 'the sim re-exports the shared switch');
  const drone = TOKENS.token_10000_silent_healrb;
  assert.equal(summonDeployHint(drone), summonDeployHint(drone, SKILL_SUMMON_START_DEPLOY), 'the hint defaults to it');
  // off (the playtest #4 reading): only with the skill; on (PRTS, the default): once at the start, then with each skill
  assert.match(summonDeployHint(drone, false), /^所属干员发动技能时才在摆放的位置出现/);
  assert.match(summonDeployHint(drone, true), /^作战开始时在摆放的位置部署一次，之后所属干员每次发动技能时再次出现/);
  assert.match(summonDeployHint(TOKENS.token_10006_vodfox_doll, true), /作战开始时.*部署一次/);
  // talent summons deploy with the board either way
  assert.equal(summonDeployHint(TOKENS.token_10041_cathy_catsld, true), summonDeployHint(TOKENS.token_10041_cathy_catsld, false));
});

test('the guide and SIM.md state the start-of-battle rule the switch selects (flip it ⇒ update both)', () => {
  const playing = readFileSync(path.join(ROOT, 'docs', 'PLAYING.md'), 'utf8');
  const sim = readFileSync(path.join(ROOT, 'docs', 'SIM.md'), 'utf8');
  if (SKILL_SUMMON_START_DEPLOY) {
    assert.match(playing, /医疗探机、诅咒娃娃[^\n]*开战时[^\n]*部署一次/, 'PLAYING.md §4: the drone / doll also deploy once at the start');
    assert.match(sim, /deploys once at the battle start/, 'SIM.md token pieces: the PRTS start deploy');
  } else {
    assert.match(playing, /医疗探机、诅咒娃娃要等所属干员发动技能时才在摆放的位置出现/, 'PLAYING.md §4: only with the skill');
    assert.match(sim, /a skill's summon[^.]*waits on its tile and takes the field there\s+each time the skill gives one/, 'SIM.md token pieces');
  }
  // the exception for unplaced summons is stated for the summons it holds for (test/content/playtest6_summons)
  assert.match(playing, /狼群、流形（战术家的援军）没有摆放时会在战术点出现/);
  assert.ok(!/没有摆放的召唤物不会出现/.test(playing), 'no blanket "unplaced summons never appear"');
});

test('the summon card: 凯瑟琳\'s device shows the hint and its shield talent; 巫恋\'s doll its token skill', async () => {
  await data.loadAll('tokens', 'assets');
  const dev = textOf(TokenDetail({ token: TOKENS.token_10041_cathy_catsld, piece: { kind: 'token', id: 'token_10041_cathy_catsld', count: 2 } }));
  assert.match(dev, /作战开始时在摆放的位置部署/);
  assert.match(dev, /定向支援信号/);
  assert.match(dev, /屏障/);
  const drone = textOf(TokenDetail({ token: TOKENS.token_10000_silent_healrb, piece: { kind: 'token', id: 'token_10000_silent_healrb', count: 1 } }));
  assert.match(drone, /作战开始时在摆放的位置部署一次，之后所属干员每次发动技能时再次出现/);
  assert.ok(!/自我销毁/.test(drone), 'the withdraw skill is not listed');
  const doll = textOf(TokenDetail({ token: TOKENS.token_10006_vodfox_doll, piece: { kind: 'token', id: 'token_10006_vodfox_doll', count: 1 } }));
  assert.match(doll, /攻击力和防御力-25%/);
  // a summon on the battlefield (no prep piece) shows no prep hint
  assert.ok(!/摆放的位置/.test(textOf(TokenDetail({ token: TOKENS.token_10041_cathy_catsld, piece: null }))));
});

test('a golden owner\'s summon card shows the golden variant: 精锐 巫恋\'s doll −30%, 精锐 赫默\'s drone ATK 114', async () => {
  await data.loadAll('tokens', 'assets');
  assert.equal(tokenVariantFor(TOKENS.token_10000_silent_healrb, 'chess_char_2_02_b').stats.atk, 114);
  assert.equal(tokenVariantFor(TOKENS.token_10000_silent_healrb, 'chess_char_2_02_a').stats.atk, 85);
  assert.equal(tokenVariantFor(TOKENS.token_10000_silent_healrb, null).stats.atk, 85, 'unknown owner: the first variant');
  // the private view: golden 巫恋 on the board, her doll card in the hand (resolveDetail reads the owner by ownerUid)
  const priv = {
    board: [{ uid: 7, kind: 'chess', id: 'chess_char_3_15_b', row: 10, col: 4 }, { uid: 9, kind: 'chess', id: 'chess_char_2_02_b', row: 10, col: 5 }],
    hand: [{ uid: 8, kind: 'token', id: 'token_10006_vodfox_doll', ownerUid: 7, count: 1 }, { uid: 10, kind: 'token', id: 'token_10000_silent_healrb', ownerUid: 9, count: 1 }],
    temp: [],
  };
  const pieces = indexPieces(priv);
  const doll = resolveDetail({ kind: 'piece', uid: 8 }, pieces);
  assert.equal(doll.ownerId, 'chess_char_3_15_b');
  const dollText = textOf(TokenDetail(doll));
  assert.match(dollText, /攻击力和防御力-30%/);
  assert.ok(!/-25%/.test(dollText));
  const drone = resolveDetail({ kind: 'piece', uid: 10 }, pieces);
  assert.match(textOf(TokenDetail(drone)), /114/);
  // in battle the own summon unit carries its piece uid: the same owner variant
  const unit = resolveDetail({ kind: 'unit', unit: { id: 3, side: 'ally', defId: 'token_10006_vodfox_doll', uid: 8 } }, pieces);
  assert.equal(unit.type, 'token');
  assert.equal(unit.ownerId, 'chess_char_3_15_b');
});

// GitHub #260 (PR #278): the 外勤医疗 strategy's map characters are operators of the mode — the card read them as summons
// (召唤物, an owner variant they do not have: base stats only)
const allText = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(allText).join('');
  if (typeof v === 'object' && typeof v.type === 'function' && ['Section', 'Stat', 'LiveTag'].includes(v.type.name)) return allText(v.type(v.props));
  if (typeof v === 'object' && typeof v.props?.text === 'string') return v.props.text;
  return typeof v === 'object' ? allText(v.props?.children) : '';
};

test('GitHub #260: Touch / 预备干员-医疗 cards say 干员 · 医疗 and show the skill, talents and 特性 of their record; 恳切福音 says what the sim does (低于一半)', async () => {
  await data.loadAll('tokens', 'assets');
  for (const [id, want] of [
    ['char_613_acmedc', ['恳切福音', '攻击距离<@ba.vup>+2</>', '攫升', '治疗目标时使其获得3点技力', '超脱', '获得5点技力', '恢复友方单位生命', '初始', '持续']],
    ['char_605_cmedic', ['治疗强化·β型', '攻击力<@ba.vup>+50%</>', '攻击提升', '攻击力+4%', '恢复友方单位生命']],
  ]) {
    // a battle click resolves the unit as its token record
    const detail = resolveDetail({ kind: 'unit', unit: { id: 91, side: 'ally', defId: id } }, new Map());
    assert.equal(detail.type, 'token');
    const text = allText(TokenDetail(detail));
    assert.match(text, /干员/);
    assert.match(text, /医疗/);
    assert.doesNotMatch(text, /召唤物/);
    for (const w of want) assert.ok(text.includes(w), `${id}: ${w}`);
    assert.equal(/PRTS 修正/.test(text), id === 'char_613_acmedc', `${id}: the 低于一半 line only under 恳切福音`);
  }
  // the record keeps the official sentence; the line under it is what touchGospel does (strictly below hp_ratio)
  assert.match(TOKENS.char_613_acmedc.skill.desc, /不高于一半/);
  assert.match(allText(TokenDetail({ token: TOKENS.char_613_acmedc })), /实际为生命值低于一半/);
  // a summon keeps its summon card
  assert.match(allText(TokenDetail({ token: TOKENS.token_10006_vodfox_doll, ownerId: 'chess_char_3_15_a' })), /召唤物/);
});
