// Tests for the asset pipeline (tools/assets/*) and the generated manifest
// data/assets.json. The pure helpers (animation-role resolver, atlas
// normalizer, PNG/WOFF2/audio helpers, plan id sets) are always tested; the
// on-disk checks run only when public/assets exists (it is git-ignored and
// produced by `npm run assets`); the optional local-client enemy and token models
// (spineLocal, tools/local-extract) only when data/local-assets.json lists them.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { resolveRoles, roleAnimationNames } from '../tools/assets/anim-roles.mjs';
import { normalizeAtlas, atlasInfo, parseAtlas } from '../tools/assets/atlas.mjs';
import { pngSize, isCompletePng, isMp3, validate } from '../tools/assets/formats.mjs';
import { encodeWoff2, decodeWoff2Tables, readSfnt, uintBase128 } from '../tools/assets/woff2.mjs';
import { assetToPath, pickUnitSfx, indexAudio } from '../tools/assets/audio.mjs';
import { mirrorUrl, safeName, encodePath } from '../tools/assets/sources.mjs';
import { collectEnemyIds, skillIndicesByChar, buildPlan, GUIDE_PAGES, UI_EXTRAS } from '../tools/assets/plan.mjs';
import { resolveTemplate, collectLeaves } from '../tools/assets/manifest.mjs';
import { spineEntry } from '../public/js/assets.js';
import { EMOTE_CATALOG, emoteArtGroup } from '../shared/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const ASSETS = join(PUBLIC, 'assets');
const MANIFEST = join(ROOT, 'data', 'assets.json');
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

// ---------------------------------------------------------------------------
describe('animation-role resolver (research 07 §5.4)', () => {
  test('simple Attack model (char_103_angel)', () => {
    const r = resolveRoles(['Attack', 'Default', 'Die', 'Idle', 'Start']);
    assert.equal(r.idle, 'Idle');
    assert.equal(r.deploy, 'Start');
    assert.deepEqual(r.attack, { begin: null, loop: 'Attack', end: null });
    assert.equal(r.die, 'Die');
    assert.equal(r.skill.via, 'attack');
    assert.equal(r.skill.loop, 'Attack');
    assert.equal(r.move, null);
    assert.equal(r.stun, null);
  });

  test('Attack_Start/Loop/End + plain Skill (char_102_texas, default skill index 1)', () => {
    const r = resolveRoles(['Attack_End', 'Attack_Loop', 'Attack_Start', 'Default', 'Die', 'Idle', 'Skill', 'Start'], { skillIndices: [1] });
    assert.deepEqual(r.attack, { begin: 'Attack_Start', loop: 'Attack_Loop', end: 'Attack_End' });
    assert.deepEqual(r.skill, { begin: null, loop: 'Skill', end: null, index: 1, idle: null });
  });

  test('Back model without Die/Skill', () => {
    const r = resolveRoles(['Attack_End', 'Attack_Loop', 'Attack_Start', 'Default', 'Idle', 'Start']);
    assert.equal(r.die, null);
    assert.equal(r.skill.via, 'attack');
  });

  test('Combat + Combat_Down (char_172_svrash)', () => {
    const r = resolveRoles(['Attack', 'Combat', 'Combat_Down', 'Default', 'Die', 'Idle', 'Skill', 'Start']);
    assert.equal(r.attack.loop, 'Attack');
    assert.deepEqual(r.attackDown, { begin: null, loop: 'Combat_Down', end: null, via: 'combat' });
  });

  test('numbered skills with Begin/Idle/Loop (char_350_surtr)', () => {
    const names = ['Attack', 'Die', 'Idle', 'Skill_2', 'Skill_2_Down', 'Skill_3_Begin', 'Skill_3_Idle', 'Skill_3_Loop', 'Start'];
    const s3 = resolveRoles(names, { skillIndices: [2] }).skill;
    assert.deepEqual(s3, { begin: 'Skill_3_Begin', loop: 'Skill_3_Loop', end: null, index: 2, idle: 'Skill_3_Idle' });
    const s2 = resolveRoles(names, { skillIndices: [1] }).skill;
    assert.deepEqual(s2, { begin: null, loop: 'Skill_2', end: null, index: 1, idle: null });
    const both = resolveRoles(names, { skillIndices: [2, 1] });
    assert.equal(both.skill.index, 2);
    assert.deepEqual(Object.keys(both.skills).sort(), ['1', '2']);
  });

  test('SkillN without underscore (char_2015_dusk)', () => {
    const r = resolveRoles(['Attack', 'Die', 'Idle', 'Skill2_Begin', 'Skill2_End', 'Skill2_Loop', 'Skill3_Attack', 'Start'], { skillIndices: [1] });
    assert.deepEqual(r.skill, { begin: 'Skill2_Begin', loop: 'Skill2_Loop', end: 'Skill2_End', index: 1, idle: null });
  });

  // PR #275 (@xcdoge): an enemy's manifest only ever had skill index 0 (plan.mjs passes [0]), so a multi-skill boss could
  // show one cast clip — 盐风主教昆图斯 has Skill_01..04. With `numberedSkills` (spine.mjs: enemy models) every numbered
  // skill clip is resolved after the caller's indices, whose first stays the primary.
  test('numbered skill clips of an enemy are all resolved (a multi-skill boss), the primary stays the caller’s first', () => {
    const names = ['Attack', 'Default', 'Die', 'Idle', 'Skill_01', 'Skill_02', 'Skill_03', 'Skill_04'];
    assert.equal(resolveRoles(names, { skillIndices: [0] }).skills, undefined, 'without the option: index 0 only (operators)');
    const r = resolveRoles(names, { skillIndices: [0], numberedSkills: true });
    assert.deepEqual(Object.keys(r.skills).sort(), ['0', '1', '2', '3']);
    assert.equal(r.skills['1'].loop, 'Skill_02');
    assert.equal(r.skills['3'].loop, 'Skill_04');
    assert.equal(r.skill.loop, 'Skill_01', 'the first index stays the primary clip');
    const first = resolveRoles(names, { skillIndices: [2], numberedSkills: true });
    assert.equal(first.skill.index, 2, 'a caller-declared primary still wins');
    assert.equal(first.skill.loop, 'Skill_03');
    // 自在: Skill_01 / Skill_01_02 are one slot, Skill_02_Begin / Loop / End the next
    const xi = resolveRoles(['Attack_01', 'Die', 'Idle', 'Skill_01', 'Skill_01_02', 'Skill_02_Begin', 'Skill_02_End', 'Skill_02_Loop'], { numberedSkills: true });
    assert.deepEqual(xi.skills['1'], { begin: 'Skill_02_Begin', loop: 'Skill_02_Loop', end: 'Skill_02_End', index: 1, idle: null });
    // phase-style skill clips (no index in the name) stay a single primary skill
    assert.equal(resolveRoles(['Attack', 'Die', 'Idle', 'Skill_Begin', 'Skill_Loop', 'Skill_End'], { numberedSkills: true }).skills, undefined);
  });

  // PR #275: the stun family is spelled Stun / Stun_End, Stun_1 / Stun_2 (巨大的丑东西: first form, second form) and
  // Dizzy_Begin / Dizzy_Loop / Dizzy_End (斩胄之剑 / 破胄之锤); without a role a stunned enemy freezes its clip.
  test('stun clips: numbered Stun_N and the Dizzy_* family are recognised', () => {
    const mc = resolveRoles(['Attack_1', 'Die', 'Idle_1', 'Idle_2', 'Move_1', 'Move_2', 'Stun_1', 'Stun_2'], {});
    assert.deepEqual(mc.stun, { begin: null, loop: 'Stun_1', end: null });
    const dz = resolveRoles(['Attack', 'Die', 'Idle_B', 'Move', 'Dizzy_Begin', 'Dizzy_Loop', 'Dizzy_End', 'Dizzy_Die'], {});
    assert.deepEqual(dz.stun, { begin: 'Dizzy_Begin', loop: 'Dizzy_Loop', end: 'Dizzy_End' });
    assert.deepEqual(resolveRoles(['Attack', 'Die', 'Idle', 'Stun', 'Stun_End'], {}).stun, { begin: null, loop: 'Stun', end: 'Stun_End' });
    assert.equal(resolveRoles(['Attack', 'Die', 'Idle', 'Move'], {}).stun, null);
  });

  // PR #275: a model's own Run cycle is a role of its own (猎狗pro: Move_Loop 0.80 s, Run_Loop 0.53 s); the move choice
  // is unchanged, the renderer switches to it for a fast enemy.
  test('the model’s own Run cycle becomes a separate run role', () => {
    const names = ['Attack', 'Default', 'Die', 'Idle', 'Move_Begin', 'Move_End', 'Move_Loop', 'Run_Begin', 'Run_End', 'Run_Loop'];
    const r = resolveRoles(names, {});
    assert.deepEqual(r.move, { begin: 'Move_Begin', loop: 'Move_Loop', end: 'Move_End' }, 'the move role is unchanged');
    assert.deepEqual(r.run, { begin: 'Run_Begin', loop: 'Run_Loop', end: 'Run_End' });
    assert.ok(roleAnimationNames(r).includes('Run_Loop'), 'the manifest writer validates the Run clips');
    assert.equal(resolveRoles(['Attack', 'Die', 'Idle', 'Move'], {}).run, undefined, 'no Run cycle, no role');
  });

  // The manifest (tools/fetch-assets.mjs --offline with this resolver): every model whose skeleton has a stun / Run clip
  // has the role, and every enemy with numbered skill clips has one clip per slot.
  describe('data/assets.json roles (PR #275)', () => {
    const manifest = JSON.parse(readFileSync(new URL('../data/assets.json', import.meta.url), 'utf8'));
    const models = [];
    for (const [id, e] of Object.entries(manifest.enemies || {})) if (e.spine) models.push([`enemies.${id}`, e.spine]);
    for (const [id, e] of Object.entries(manifest.tokens || {})) if (e.spine) models.push([`tokens.${id}`, e.spine]);
    for (const [id, e] of Object.entries(manifest.chars || {})) if (e.spine?.front) models.push([`chars.${id}`, e.spine.front]);
    const walk = (re, ok) => {
      const bad = [];
      let seen = 0;
      for (const [id, sp] of models) {
        if (!sp.animations || !Object.keys(sp.animations).some((n) => re.test(n))) continue;
        seen++;
        if (!ok(sp.anims || {}, id)) bad.push(id);
      }
      return { bad, seen };
    };
    test('every model with a stun clip has a stun role', () => {
      const { bad, seen } = walk(/^(stun|dizzy)/i, (a) => !!a.stun);
      assert.ok(seen >= 6, `models with a stun clip (${seen})`);
      assert.deepEqual(bad, []);
    });
    test('every model with a Run clip has a run role', () => {
      const { bad, seen } = walk(/^run/i, (a) => !!a.run);
      assert.ok(seen >= 3, `models with a Run clip (${seen})`);
      assert.deepEqual(bad, []);
    });
    test('every enemy with numbered skill clips has a clip per slot (盐风主教昆图斯: Skill_01..04)', () => {
      const { bad, seen } = walk(/^Skill_?0*[1-9](?:$|_)/i, (a, id) => !id.startsWith('enemies.') || !!a.skills);
      assert.ok(seen >= 10, `models with numbered skill clips (${seen})`);
      assert.deepEqual(bad, []);
      const q = manifest.enemies.enemy_1521_dslily.spine.anims;
      assert.deepEqual(Object.values(q.skills).map((c) => c.loop), ['Skill_01', 'Skill_02', 'Skill_03', 'Skill_04']);
      assert.equal(q.skill.loop, 'Skill_01', 'the primary clip is unchanged');
      // operators keep their pool's indices (宴's fix, PREFAB_SPINE_ROLES / DESIGN §25.22.9, stays as it was)
      const utage = manifest.chars.char_337_utage.spine.front.anims;
      assert.deepEqual(Object.keys(utage.skills).sort(), ['0', '1']);
      assert.equal(utage.skills['0'].loop, 'Skill_Loop');
      assert.equal(utage.skill.loop, 'Attack');
    });
  });

  test('pure supporter without Attack (char_4134_cetsyr)', () => {
    const r = resolveRoles(['Die', 'Idle', 'Skill_1_Begin', 'Skill_1_End', 'Skill_1_Loop', 'Skill_2_Begin', 'Skill_2_Loop', 'Start', 'Stun', 'Stun_Begin'], { skillIndices: [1] });
    assert.deepEqual(r.attack, { begin: null, loop: 'Skill_1_Loop', end: null, via: 'skill' });
    assert.equal(r.skill.loop, 'Skill_2_Loop');
    assert.deepEqual(r.stun, { begin: 'Stun_Begin', loop: 'Stun', end: null });
  });

  test('enemy move variants', () => {
    const slime = resolveRoles(['Attack', 'Default', 'Die', 'Idle', 'Move_Begin', 'Move_End', 'Move_Loop']);
    assert.deepEqual(slime.move, { begin: 'Move_Begin', loop: 'Move_Loop', end: 'Move_End' });
    const crowns = resolveRoles(['Appear', 'Attack', 'Die', 'Disappear', 'Idle', 'Move']);
    assert.deepEqual(crowns.move, { begin: null, loop: 'Move', end: null });
    const runner = resolveRoles(['Attack', 'Die', 'Idle', 'Run_Begin', 'Run_End', 'Run_Loop']);
    assert.deepEqual(runner.move, { begin: 'Run_Begin', loop: 'Run_Loop', end: 'Run_End' });
  });

  test('boss with numbered attacks and Skill_01 (enemy_1517_xi)', () => {
    const r = resolveRoles(['Attack_01', 'Attack_02', 'Die', 'Idle', 'Move', 'Revive_01', 'Skill_01', 'Skill_01_02', 'Skill_02_Begin', 'Skill_02_End', 'Skill_02_Loop']);
    assert.deepEqual(r.attack, { begin: null, loop: 'Attack_01', end: null, via: 'attackAny' });
    assert.equal(r.skill.loop, 'Skill_01');
    assert.equal(r.move.loop, 'Move');
  });

  test('fallbacks: Default idle, idle-as-attack, case-insensitive, empty', () => {
    assert.equal(resolveRoles(['Default', 'Die']).idle, 'Default');
    const onlyIdle = resolveRoles(['Idle']);
    assert.deepEqual(onlyIdle.attack, { begin: null, loop: 'Idle', end: null, via: 'idle' });
    assert.equal(onlyIdle.deploy, 'Idle');
    const lower = resolveRoles(['idle', 'attack', 'die']);
    assert.equal(lower.idle, 'idle');
    assert.equal(lower.attack.loop, 'attack');
    const empty = resolveRoles([]);
    assert.equal(empty.idle, null);
    assert.equal(empty.attack, null);
    assert.equal(empty.skill, null);
    assert.equal(resolveRoles(null).idle, null);
  });

  test('Attack_Begin + numbered attacks + Attack_End (char_1045_svash2)', () => {
    const names = ['Attack_A', 'Attack_B', 'Attack_Begin', 'Attack_C', 'Attack_End', 'Default', 'Die', 'Idle', 'Skill_1_A', 'Skill_2', 'Start'];
    assert.deepEqual(resolveRoles(names).attack, { begin: 'Attack_Begin', loop: 'Attack_A', end: 'Attack_End', via: 'attackAny' });
    // begin-only models still play the begin clip as the attack
    assert.deepEqual(resolveRoles(['Attack_Begin', 'Attack_End', 'Idle']).attack, { begin: null, loop: 'Attack_Begin', end: 'Attack_End' });
  });

  test('animated idle preferred over a 0 s pose when durations are known (enemy_9014_acstma)', () => {
    const names = ['Attack', 'Default', 'Die', 'Idle_A', 'Idle_B', 'Move', 'Skill'];
    assert.equal(resolveRoles(names).idle, 'Idle_A');
    assert.equal(resolveRoles(names, { durations: { Idle_A: 0, Idle_B: 2.667 } }).idle, 'Idle_B');
    // an exact 'Idle' always wins, even when static (tokens such as token_10012_rosmon_shield)
    assert.equal(resolveRoles(['Idle', 'Idle_B', 'Start'], { durations: { Idle: 0, Idle_B: 1 } }).idle, 'Idle');
    // all idle-like clips static → still the first one
    assert.equal(resolveRoles(['Idle_A', 'Idle_B'], { durations: { Idle_A: 0, Idle_B: 0 } }).idle, 'Idle_A');
  });

  test('Move_Start + Move + Move_End (enemy_1112_emppnt)', () => {
    const r = resolveRoles(['Attack', 'Default', 'Die', 'Idle', 'Move', 'Move_End', 'Move_Start']);
    assert.deepEqual(r.move, { begin: 'Move_Start', loop: 'Move', end: 'Move_End' });
  });

  test('directional-only skill clips (char_279_excu, char_431_ashlok Back)', () => {
    const excuFront = ['Attack', 'Default', 'Die', 'Idle', 'Skill_Down_Begin', 'Skill_Down_End', 'Skill_Down_Loop', 'Skill_Right_Begin', 'Skill_Right_End', 'Skill_Right_Loop', 'Start'];
    assert.deepEqual(resolveRoles(excuFront, { skillIndices: [1] }).skill,
      { begin: 'Skill_Right_Begin', loop: 'Skill_Right_Loop', end: 'Skill_Right_End', index: 1, idle: null });
    const excuBack = ['Attack', 'Default', 'Idle', 'Skill_Right_Begin', 'Skill_Right_End', 'Skill_Right_Loop', 'Skill_Up_Begin', 'Skill_Up_End', 'Skill_Up_Loop', 'Start'];
    assert.equal(resolveRoles(excuBack, { skillIndices: [1] }).skill.loop, 'Skill_Right_Loop');
    const ashlokBack = ['Attack01', 'Attack02', 'Default', 'Idle', 'Skill_Idle_Up', 'Skill_Loop_Up', 'Start'];
    assert.deepEqual(resolveRoles(ashlokBack).skill, { begin: null, loop: 'Skill_Loop_Up', end: null, index: 0, idle: 'Skill_Idle_Up' });
    // undirected clips always win; Down-only clips are never used for the skill
    assert.equal(resolveRoles(['Attack', 'Idle', 'Skill_Loop', 'Skill_Right_Loop']).skill.loop, 'Skill_Loop');
    assert.equal(resolveRoles(['Attack', 'Idle', 'Skill_Down_Loop']).skill.via, 'attack');
  });

  test('every referenced name exists in the input', () => {
    const names = ['Attack_Begin', 'Attack_Loop', 'Attack_End', 'Attack_Down_Begin', 'Attack_Down_Loop', 'Idle', 'Die', 'Start', 'Skill_2_Begin', 'Skill_2_Loop', 'Skill_2_End', 'Stun'];
    const r = resolveRoles(names, { skillIndices: [1, 0] });
    for (const n of roleAnimationNames(r)) assert.ok(names.includes(n), n);
    assert.deepEqual(r.attackDown, { begin: 'Attack_Down_Begin', loop: 'Attack_Down_Loop', end: null });
  });
});

// ---------------------------------------------------------------------------
describe('atlas normalization', () => {
  const fexli = '\nchar_x.png\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nArm\n  rotate: false\n  xy: 2, 2\n  size: 10, 12\n  orig: 10, 12\n  offset: 0, 0\n  index: -1\nLeg\n  rotate: 270\n  xy: 20, 2\n  size: 8, 8\n  orig: 8, 8\n  offset: 0, 0\n  index: -1\n';
  const sizeOf = () => ({ width: 256, height: 128 });

  test('inserts size right after the page name and is idempotent', () => {
    const r = normalizeAtlas(fexli, { pageSize: sizeOf });
    assert.ok(r.changed);
    const lines = r.text.split('\n');
    assert.equal(lines[1], 'char_x.png');
    assert.equal(lines[2], 'size: 256,128');
    assert.equal(lines[3], 'format: RGBA8888');
    const again = normalizeAtlas(r.text, { pageSize: sizeOf });
    assert.equal(again.changed, false);
    assert.equal(again.text, r.text);
    const info = atlasInfo(r.text);
    assert.deepEqual(info.pages, ['char_x.png']);
    assert.deepEqual([...info.regions], ['Arm', 'Leg']);
    assert.equal(info.hasSize, true);
    assert.equal(info.hasPma, false);
  });

  test('adds pma after page fields, fixes a wrong size, renames pages', () => {
    const r = normalizeAtlas('page a.png\nsize: 1,1\nformat: RGBA8888\nR\n  xy: 0, 0\n', { pageSize: sizeOf, pma: true, renamePage: (p) => p.replace(' ', '_') });
    assert.equal(r.text, 'page_a.png\nsize: 256,128\nformat: RGBA8888\npma: true\nR\n  xy: 0, 0\n');
    assert.deepEqual(r.fixedSize, ['page a.png']);
    assert.deepEqual(r.pages, ['page_a.png']);
    assert.equal(atlasInfo(r.text).hasPma, true);
    assert.equal(normalizeAtlas(r.text, { pageSize: sizeOf, pma: true }).changed, false);
  });

  test('handles multiple pages and CRLF; reports unsized pages', () => {
    const two = 'a.png\r\nformat: RGBA8888\r\nA\r\n  xy: 0, 0\r\n\r\nb.png\r\nformat: RGBA8888\r\nB\r\n  xy: 1, 1\r\n';
    const r = normalizeAtlas(two, { pageSize: (p) => (p === 'a.png' ? { width: 4, height: 8 } : null) });
    assert.deepEqual(r.missingSize, ['b.png']);
    const { pages } = parseAtlas(r.text);
    assert.deepEqual(pages.map((p) => [p.name, p.fields.size ?? null, p.regions]), [['a.png', '4,8', ['A']], ['b.png', null, ['B']]]);
  });
});

// ---------------------------------------------------------------------------
describe('format helpers', () => {
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(300, 0); ihdr.writeUInt32BE(150, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc(10))), chunk('IEND', Buffer.alloc(0))]);

  test('PNG size and completeness', () => {
    assert.deepEqual(pngSize(png), { width: 300, height: 150 });
    assert.equal(isCompletePng(png), true);
    assert.equal(isCompletePng(png.subarray(0, png.length - 6)), false);
    assert.equal(pngSize(Buffer.from('<html>not found</html>')), null);
    assert.equal(validate('png', Buffer.from('404: Not Found')), false);
  });

  test('MP3 and atlas sniffing', () => {
    assert.equal(isMp3(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200)])), true);
    assert.equal(isMp3(Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(200)])), true);
    assert.equal(isMp3(Buffer.from('404: Not Found'.padEnd(200))), false);
    assert.equal(validate('atlas', Buffer.from('\nx.png\nformat: RGBA8888\n')), true);
    assert.equal(validate('atlas', Buffer.from('404: Not Found')), false);
  });

  test('URL helpers', () => {
    assert.equal(mirrorUrl('https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/a/b.skel'), 'https://cdn.jsdelivr.net/gh/fexli/ArknightsResource@main/spine/a/b.skel');
    assert.equal(mirrorUrl('https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/voice/assets/x.mp3'), null);
    assert.equal(mirrorUrl('https://example.com/x'), null);
    assert.equal(encodePath('[uc]a/b c#.png'), '%5Buc%5Da/b%20c%23.png');
    assert.equal(safeName('skcom_charge_cost[3]'), 'skcom_charge_cost_3_');
    assert.equal(safeName('bg_open 1'), 'bg_open_1');
  });
});

// ---------------------------------------------------------------------------
describe('WOFF2 encoder', () => {
  test('UIntBase128', () => {
    assert.deepEqual(uintBase128(0), [0]);
    assert.deepEqual(uintBase128(127), [0x7f]);
    assert.deepEqual(uintBase128(128), [0x81, 0x00]);
    assert.equal(uintBase128(0xffffffff).length, 5);
    assert.throws(() => uintBase128(-1));
  });

  function makeSfnt(tables) {
    const n = tables.length;
    const header = Buffer.alloc(12 + 16 * n);
    header.writeUInt32BE(0x4f54544f, 0);
    header.writeUInt16BE(n, 4);
    let off = header.length;
    const bodies = [];
    tables.forEach(([tag, data], i) => {
      const rec = 12 + 16 * i;
      header.write(tag, rec, 'latin1');
      header.writeUInt32BE(off, rec + 8);
      header.writeUInt32BE(data.length, rec + 12);
      const padded = Buffer.alloc((data.length + 3) & ~3);
      data.copy(padded);
      bodies.push(padded);
      off += padded.length;
    });
    return Buffer.concat([header, ...bodies]);
  }

  test('lossless round trip (synthetic font incl. unknown tag)', () => {
    const sfnt = makeSfnt([['CFF ', Buffer.from('cff data '.repeat(50))], ['head', Buffer.alloc(54, 7)], ['zzzz', Buffer.from([1, 2, 3])]]);
    const w = encodeWoff2(sfnt);
    assert.equal(w.readUInt32BE(0), 0x774f4632);
    assert.equal(w.length % 4, 0);
    const dec = decodeWoff2Tables(w);
    const src = readSfnt(sfnt);
    for (const t of src.tables) assert.ok(dec.tables.find((d) => d.tag === t.tag).data.equals(t.data), t.tag);
  });

  test('shipped fonts decode back to their sources', (t) => {
    const dir = join(PUBLIC, 'fonts');
    if (!existsSync(join(dir, 'fonts.css'))) { t.skip('fonts not generated (run npm run assets)'); return; }
    for (const f of readdirSync(dir).filter((x) => /\.(otf|ttf)$/.test(x))) {
      const woff2 = join(dir, f.replace(/\.(otf|ttf)$/, '.woff2'));
      assert.ok(existsSync(woff2), `${woff2} exists`);
      const src = readSfnt(readFileSync(join(dir, f)));
      const dec = decodeWoff2Tables(readFileSync(woff2));
      assert.equal(dec.tables.length, src.tables.length);
      for (const tb of src.tables) assert.ok(dec.tables.find((d) => d.tag === tb.tag).data.equals(tb.data), `${f} ${tb.tag}`);
    }
  });
});

// ---------------------------------------------------------------------------
describe('audio banks and plan id sets', () => {
  test('asset paths and unit SFX role picking', () => {
    assert.equal(assetToPath('Audio/Sound_Beta_2/Player/p_atk/p_atk_sword_n'), 'player/p_atk/p_atk_sword_n.mp3');
    assert.equal(assetToPath(null), null);
    const idx = indexAudio({
      soundFXBanks: [
        { name: 'battle.ON_ABILITY_START.char_1_x.attack.1', sounds: [{ asset: 'Audio/Sound_Beta_2/P/a1' }] },
        { name: 'battle.ON_ABILITY_START.char_1_x.attack.0', sounds: [{ asset: 'Audio/Sound_Beta_2/P/a0' }] },
        { name: 'battle.ON_ABILITY_HIT.char_1_x.attack', sounds: [{ asset: 'Audio/Sound_Beta_2/P/h' }] },
        { name: 'battle.ON_UNIT_DEAD.char_1_x', sounds: [{ asset: 'Audio/Sound_Beta_2/P/d' }] },
        { name: 'battle.ON_SKILL_START.skchr_x_2', sounds: [{ asset: 'Audio/Sound_Beta_2/P/s' }] },
      ],
      bgmBanks: [{ name: 'battle.ON_GAME_READY.x', intro: null, loop: 'Audio/Sound_Beta_2/Music/x_loop' }],
      bankAlias: { 'battle.ON_GAME_READY.y': 'battle.ON_GAME_READY.x' },
    });
    const roles = pickUnitSfx(idx.unitBanks.get('char_1_x'));
    assert.deepEqual(roles, { attack: ['p/a0.mp3'], hit: ['p/h.mp3'], die: ['p/d.mp3'] });
    assert.deepEqual(idx.skillBanks.get('skchr_x_2').get('ON_SKILL_START'), ['p/s.mp3']);
    assert.deepEqual(idx.bgm('battle.ON_GAME_READY.y'), { intro: null, loop: 'music/x_loop.mp3' });
    assert.deepEqual(pickUnitSfx(undefined), {});
  });

  test('non-attack abilities are not used as the attack sound', () => {
    const banks = new Map([
      ['ON_ABILITY_ON.ShieldBurst', ['e/skill.mp3']],
      ['ON_ABILITY_START.T.1', ['e/talent.mp3']],
      ['ON_ABILITY_HIT.attack', ['e/hit.mp3']],
      ['ON_ABILITY_START.PowerAttack', ['e/power.mp3']],
    ]);
    assert.deepEqual(pickUnitSfx(banks), { attack: ['e/power.mp3'], hit: ['e/hit.mp3'] });
    banks.delete('ON_ABILITY_START.PowerAttack');
    assert.deepEqual(pickUnitSfx(banks), { hit: ['e/hit.mp3'] });
  });

  test('operators: normal-mode sounds only, their own projectile banks as fallbacks (user playtest #4 item 6)', () => {
    // 纯烬艾雅法拉: the numbered ability variant attack.2 is her S3 impact (_s) — never the normal hit
    const banks = new Map([['ON_ABILITY_START.attack', ['p/p_atk_x_n.mp3']], ['ON_ABILITY_HIT.attack.2', ['p/p_imp_x_s.mp3']]]);
    assert.deepEqual(pickUnitSfx(banks, { operator: true, projectile: { hit: ['p/p_imp_x_n.mp3'] } }), { attack: ['p/p_atk_x_n.mp3'], hit: ['p/p_imp_x_n.mp3'] });
    assert.deepEqual(pickUnitSfx(banks), { attack: ['p/p_atk_x_n.mp3'], hit: ['p/p_imp_x_s.mp3'] }, 'enemies / tokens unchanged');
    // a skill-mode plain bank (_d / _h / _s) is skipped; the plain ability wins over any numbered variant
    const b2 = new Map([['ON_ABILITY_START.attack', ['p/p_atk_y_h.mp3']], ['ON_ABILITY_START.attack.0', ['p/p_atk_y_n.mp3']], ['ON_ABILITY_ON.attack', ['p/p_atk_y_n2.mp3']]]);
    assert.deepEqual(pickUnitSfx(b2, { operator: true }).attack, ['p/p_atk_y_n2.mp3']);
    assert.deepEqual(pickUnitSfx(new Map([['ON_ABILITY_START.attack.1', ['p/p_atk_z_s.mp3']]]), { operator: true }), {}, 'only skill-mode files: no attack sound');
    assert.deepEqual(pickUnitSfx(undefined, { operator: true, projectile: { born: ['p/b.mp3'] } }), { attack: ['p/b.mp3'] }, 'no unit banks: the projectile bank');
  });

  test('enemy set covers 07 list, bosses and their summons', () => {
    const assets07 = readJson('docs/research/07-assets.json');
    const ids = new Set(collectEnemyIds({ assets07, enemies05: readJson('docs/research/05-enemies.json'), maps05: readJson('docs/research/05-maps.json'), ops03: readJson('docs/research/03-operators.json') }));
    for (const id of Object.keys(assets07.enemies)) assert.ok(ids.has(id), id);
    for (const id of ['enemy_9013_acstmk', 'enemy_9016_acstmr', 'enemy_9017_achunt', 'enemy_9021_acduml', 'enemy_9023_acdums', 'enemy_1521_dslily',
      'enemy_2016_csphtm', 'enemy_9032_aclionk', 'enemy_10028_vtswd', 'enemy_9033_acdeer', 'enemy_9013_acstmk_2', 'enemy_9012_acloon',
      'enemy_5601_entlec' /* 心烛, summoned by 隐德来希's default S3 (talent take_extra_enemy_key) */]) {
      assert.ok(ids.has(id), id);
    }
  });

  test('skill indices per char (primary first, backups included)', () => {
    const m = skillIndicesByChar(readJson('docs/research/03-operators.json'));
    assert.deepEqual(m.get('char_102_texas'), [1]);
    assert.equal(m.size, 138);
    assert.deepEqual([...m.get('char_603_csnipe')].sort(), [1, 2]);
  });

  test('template resolution drops missing files and uses fallbacks', () => {
    const tpl = { a: { alts: [{ rel: 'nope/x.png', urls: ['u1'] }] }, b: { c: { alts: [{ rel: 'nope/y.png', urls: ['u2'] }] } }, keep: 'v', m: { model: 'k' } };
    const r = resolveTemplate(tpl, { root: ROOT, spine: new Map([['k', { skel: '/assets/s.skel', atlas: '/assets/s.atlas', textures: [] }]]) });
    assert.deepEqual(Object.keys(r.value).sort(), ['keep', 'm']);
    assert.deepEqual(r.misses.sort(), ['a', 'b.c']);
    assert.deepEqual(r.droppedLeaves, ['a', 'b.c'], 'a leaf no alternative of which is on disk is a dropped leaf');
    assert.equal(collectLeaves(tpl).length, 2);
    const ok = resolveTemplate({ p: { alts: [{ rel: 'nope.png', urls: ['x'] }, { rel: 'package.json', urls: ['y'] }] } }, { root: ROOT, spine: new Map() });
    assert.equal(ok.value.p, '/assets/package.json');
    assert.equal(ok.fallbacks.length, 1);
    assert.deepEqual(ok.droppedLeaves, [], 'a fallback on disk is not a drop');
  });

  test('an array whose lines are all missing is dropped, with the entry it empties (a voice slot never downloaded)', () => {
    const line = (rel) => ({ alts: [{ rel, urls: ['u'] }] });
    const tpl = {
      voice: {
        a: { select: [line('nope/1.mp3'), line('nope/2.mp3')], place: [line('nope/3.mp3')] },
        b: { select: [line('nope/4.mp3'), line('package.json')] },
      },
      empty: [],
    };
    const r = resolveTemplate(tpl, { root: ROOT, spine: new Map() });
    assert.deepEqual(r.value.voice, { b: { select: ['/assets/package.json'] } }, 'operator a has no line on disk: no entry at all');
    assert.deepEqual(r.value.empty, [], 'an array that was empty in the template stays');
    assert.deepEqual(r.misses.sort(), ['voice.a.place[0]', 'voice.a.select[0]', 'voice.a.select[1]', 'voice.b.select[0]']);
    assert.deepEqual(r.droppedLeaves.sort(), r.misses.slice().sort(), 'every dropped line is a dropped leaf too');
  });

  // A unit's attack sound is a leaf like any other: when its file was never downloaded (or a checkout lost it) the whole
  // key vanishes from data/assets.json and the client plays nothing — there is no fallback and no URL to retry. The
  // resolution therefore reports it as a dropped leaf, which the run prints and --strict fails on
  // (tools/fetch-assets.mjs; docs/ASSETS.md "A dropped leaf is reported, never silent").
  test('move a resolved sound aside: the leaf leaves the manifest and is reported as dropped, never silently', async (t) => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const root = await mkdtemp(join(tmpdir(), 'sp-leaf-drop-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const rel = 'audio/sfx/player/p_atk/p_atk_somechar_n.mp3';
    const imp = 'audio/sfx/player/p_imp/p_imp_somechar_n.mp3';
    const ui = 'audio/sfx/general/g_ui/g_ui_btn_h.mp3';
    const leaf = (r) => ({ alts: [{ rel: r, urls: [`https://raw.githubusercontent.com/o/r/main/${r}`], kind: 'mp3' }] });
    const tpl = { audio: { sfx: { units: { char_x: { attack: leaf(rel), hit: leaf(imp) } }, ui: { click: leaf(ui) } } } };
    for (const r of [rel, imp, ui]) {
      await mkdir(join(root, dirname(r)), { recursive: true });
      await writeFile(join(root, r), 'ID3');
    }
    const before = resolveTemplate(tpl, { root, spine: new Map() });
    assert.equal(JSON.stringify(before.value), JSON.stringify({
      audio: {
        sfx: {
          units: { char_x: { attack: `/assets/${rel}`, hit: `/assets/${imp}` } },
          ui: { click: `/assets/${ui}` },
        },
      },
    }), 'every file on disk: the manifest is exactly the plan, byte for byte');
    assert.deepEqual([before.misses, before.droppedLeaves, before.fallbacks], [[], [], []]);

    await rm(join(root, rel)); // the download never happened / the file went missing
    const after = resolveTemplate(tpl, { root, spine: new Map() });
    assert.equal(Object.hasOwn(after.value.audio.sfx.units.char_x, 'attack'), false, 'the key is gone from the manifest');
    assert.equal(after.value.audio.sfx.units.char_x.hit, `/assets/${imp}`, 'the roles whose file is on disk stay');
    assert.deepEqual(after.droppedLeaves, ['audio.sfx.units.char_x.attack'], 'and the drop is reported, not silent');
    assert.ok(after.misses.includes('audio.sfx.units.char_x.attack'), 'the wider miss list names it too');
  });
});

// ---------------------------------------------------------------------------
describe('downloader (fake network)', () => {
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4);
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))]);
  const RAW_URL = 'https://raw.githubusercontent.com/o/r/main/a.png';
  const MIRROR = 'https://cdn.jsdelivr.net/gh/o/r@main/a.png';

  async function setup(routes) {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { Downloader } = await import('../tools/assets/downloader.mjs');
    const dir = await mkdtemp(join(tmpdir(), 'sp-assets-'));
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      const q = routes[url];
      const r = Array.isArray(q) ? (q.length > 1 ? q.shift() : q[0]) : q;
      if (!r) return new Response('404: Not Found', { status: 404 });
      if (r instanceof Error) throw r;
      return new Response(r.body, { status: r.status ?? 200, headers: r.headers });
    };
    const dl = new Downloader({ root: join(dir, 'out'), ledgerPath: join(dir, 'ledger.json'), fetchImpl, backoffMs: 0, log: () => {} });
    return { dl, dir, calls };
  }

  test('mirror fallback after a raw 404, then idempotent skip', async () => {
    const { dl, dir, calls } = await setup({ [MIRROR]: { body: PNG } });
    const job = { rel: 'x/a.png', urls: [RAW_URL], kind: 'png' };
    const r1 = await dl.run([job, { ...job }], 't');
    assert.equal(r1.get('x/a.png').status, 'ok');
    assert.deepEqual(calls, [RAW_URL, MIRROR]);
    assert.ok(readFileSync(join(dir, 'out', 'x', 'a.png')).equals(PNG));
    assert.equal(JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8')).files['x/a.png'].bytes, PNG.length);
    const r2 = await dl.run([job], 't');
    assert.equal(r2.get('x/a.png').status, 'skip');
    assert.equal(calls.length, 2);
  });

  test('retries transient errors and rejects invalid payloads', async () => {
    const { dl, dir } = await setup({
      [RAW_URL]: [new Error('ECONNRESET'), { status: 503, body: 'busy' }, { body: PNG }],
      'https://raw.githubusercontent.com/o/r/main/bad.png': { body: '<html>oops</html>' },
      'https://raw.githubusercontent.com/o/r/main/short.png': { body: PNG, headers: { 'content-length': String(PNG.length + 5) } },
    });
    const res = await dl.run([
      { rel: 'a.png', urls: [RAW_URL], kind: 'png' },
      { rel: 'bad.png', urls: ['https://raw.githubusercontent.com/o/r/main/bad.png'], kind: 'png' },
      { rel: 'short.png', urls: ['https://raw.githubusercontent.com/o/r/main/short.png'], kind: 'png' },
      { rel: 'none.png', urls: ['https://raw.githubusercontent.com/o/r/main/none.png'], kind: 'png' },
    ], 't');
    assert.equal(res.get('a.png').status, 'ok');
    assert.equal(res.get('bad.png').status, 'error');
    assert.equal(res.get('short.png').status, 'error');
    assert.equal(res.get('none.png').status, 'miss');
    for (const f of ['bad.png', 'short.png', 'none.png']) assert.equal(existsSync(join(dir, 'out', f)), false);
    assert.deepEqual(readdirSync(join(dir, 'out')), ['a.png']); // no temp files left behind
  });

  test('a corrupt skeleton is dropped and deleted so the next run re-downloads it', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { processModels } = await import('../tools/assets/spine.mjs');
    const dir = await mkdtemp(join(tmpdir(), 'sp-spine-'));
    const root = join(dir, 'assets');
    await mkdir(join(root, 'spine', 'x'), { recursive: true });
    await writeFile(join(root, 'spine', 'x', 'm.skel'), Buffer.alloc(64, 0xff));
    await writeFile(join(root, 'spine', 'x', 'm.atlas'), '\nm.png\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nR\n  xy: 0, 0\n  size: 1, 1\n');
    await writeFile(join(root, 'spine', 'x', 'm.png'), PNG);
    const job = (rel) => ({ rel, urls: ['u'], kind: rel.split('.').pop() });
    const models = new Map([['k', { key: 'k', dir: 'spine/x/', pma: false, skillIndices: [0], skel: job('spine/x/m.skel'), atlas: { ...job('spine/x/m.atlas'), mutable: true }, pngs: [job('spine/x/m.png')] }]]);
    let saved = 0;
    const dl = { ledger: { files: { 'spine/x/m.skel': { url: 'u', bytes: 64 } } }, saveLedger: async () => { saved++; } };
    const r = await processModels(models, { root, dl, cachePath: join(dir, 'cache.json'), download: false, log: () => {} });
    assert.equal(r.entries.size, 0);
    assert.match(r.problems.join('\n'), /skel parse failed/);
    assert.equal(existsSync(join(root, 'spine', 'x', 'm.skel')), false);
    assert.equal(dl.ledger.files['spine/x/m.skel'], undefined);
    assert.equal(saved, 1);
    assert.match(readFileSync(join(root, 'spine', 'x', 'm.atlas'), 'utf8'), /size: 2,2/); // atlas still normalized
  });

  test('leaf fallbacks follow 404s only, never transient errors', async () => {
    const { downloadLeaves } = await import('../tools/assets/manifest.mjs');
    const base = 'https://raw.githubusercontent.com/o/r/main/';
    const { dl, dir, calls } = await setup({
      [`${base}fallback.png`]: { body: PNG },
      [`${base}flaky.png`]: { status: 503, body: 'busy' },
      'https://cdn.jsdelivr.net/gh/o/r@main/flaky.png': { status: 503, body: 'busy' },
    });
    const leaves = [
      { path: 'gone', leaf: { alts: [{ rel: 'g.png', urls: [`${base}gone.png`], kind: 'png' }, { rel: 'g.png', urls: [`${base}fallback.png`], kind: 'png' }] } },
      { path: 'flaky', leaf: { alts: [{ rel: 'f.png', urls: [`${base}flaky.png`], kind: 'png' }, { rel: 'f.png', urls: [`${base}fallback.png`], kind: 'png' }] } },
    ];
    const blocked = await downloadLeaves(leaves, dl, join(dir, 'out'));
    assert.deepEqual(blocked, ['flaky']);
    assert.ok(readFileSync(join(dir, 'out', 'g.png')).equals(PNG), '404 primary → fallback used');
    assert.equal(existsSync(join(dir, 'out', 'f.png')), false, 'transient failure → no fallback on the primary path');
    assert.equal(calls.filter((u) => u.endsWith('fallback.png')).length, 1);
  });
});

// ---------------------------------------------------------------------------
// GitHub issue #42: a source deploy on a server without the Arknights client had no public/assets/local, so the battle
// emotes showed default icons and 玩法说明 showed text tips. The public mirror has both (checked 2026-10-03: all 55
// URLs answer 200 on raw.githubusercontent.com and on jsDelivr, same pictures and sizes as the local extraction), so the
// plan downloads them like any other UI sprite, keyed by the data/local-assets.json group and name.
describe('emotes and 玩法说明 pages from the public mirror (GitHub issue #42)', () => {
  const AA2 = 'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn/';
  const plan = () => buildPlan({ assets07: {}, ops03: {}, enemies05: {}, maps05: {}, audio: indexAudio({}), modelsData: {} }).template;

  test('the plan fetches the 36 battle emotes and the 19 guide pages from ArknightsAssets2 cn, keyed like the local art', () => {
    const ui = plan().ui;
    assert.equal(EMOTE_CATALOG.length, 36);
    for (const e of EMOTE_CATALOG) {
      const key = `${emoteArtGroup(e.id)}/${e.picId}`; // the local manifest's group + name (emoticon/<dir>/<picId>)
      assert.deepEqual(ui[key]?.alts, [{ rel: `ui/${key}.png`, urls: [`${AA2}ui/emoticon/theme/%5Buc%5D${e.themeId}/icon/${e.picId}.png`], kind: 'png' }], key);
    }
    assert.ok(ui['emoticon/fooldoctor/pic_fooldoctor_08_battle'], 'keyed by picId, not by the emote id (fooldoctor_06 → pic 08)');
    assert.notEqual(ui['emoticon/slug/pic_thanks_battle'].alts[0].rel, ui['emoticon/basic/pic_thanks_battle'].alts[0].rel, 'same picId, two themes');
    assert.deepEqual(GUIDE_PAGES.slice(0, 2), ['autochess_home_1', 'autochess_home_2']);
    assert.equal(GUIDE_PAGES.length, 19);
    for (const k of GUIDE_PAGES) {
      assert.deepEqual(ui[`guide/${k}`]?.alts, [{ rel: `ui/guide/${k}.png`, urls: [`${AA2}arts/guidebookpages/%5Bpack%5Dautochess/${k}.png`], kind: 'png' }], k);
    }
    const rels = Object.values(ui).map((l) => l.alts[0].rel);
    assert.equal(new Set(rels).size, rels.length, 'no two UI entries share a file');
    assert.ok(rels.every((r) => !r.startsWith('local/')), 'public/assets/local belongs to tools/local-extract');
    assert.equal(mirrorUrl(ui['emoticon/fooldoctor/pic_fooldoctor_08_battle'].alts[0].urls[0]),
      'https://cdn.jsdelivr.net/gh/ArknightsAssets/ArknightsAssets2@cn/assets/dyn/ui/emoticon/theme/%5Buc%5Demoticon_foolsday_doctor/icon/pic_fooldoctor_08_battle.png',
      'the jsDelivr fallback (downloader) serves the same path');
    assert.ok(Object.isFrozen(UI_EXTRAS) && UI_EXTRAS.every(Object.isFrozen));
  });

  test('a rebuilt manifest lists the copies that are on disk under /assets/ui/…; a missing one is left out', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const root = await mkdtemp(join(tmpdir(), 'sp-mirror-art-'));
    const ui = plan().ui;
    const keys = ['emoticon/basic/pic_happy_battle', 'guide/autochess_home_1', 'emoticon/slug/pic_bye_battle'];
    for (const k of keys.slice(0, 2)) {
      await mkdir(join(root, dirname(ui[k].alts[0].rel)), { recursive: true });
      await writeFile(join(root, ui[k].alts[0].rel), 'x');
    }
    const r = resolveTemplate({ ui: Object.fromEntries(keys.map((k) => [k, ui[k]])) }, { root, spine: new Map() });
    assert.deepEqual(r.value.ui, {
      'emoticon/basic/pic_happy_battle': '/assets/ui/emoticon/basic/pic_happy_battle.png',
      'guide/autochess_home_1': '/assets/ui/guide/autochess_home_1.png',
    });
    assert.deepEqual(r.misses, ['ui.emoticon/slug/pic_bye_battle']);
  });

  test('the committed data/assets.json lists all 55, so setup on an install made before them downloads them', () => {
    // tools/setup.mjs runs fetch-assets when data/assets.json lists a file that is not on disk (checkAssets)
    const m = readJson('data/assets.json');
    for (const e of EMOTE_CATALOG) assert.equal(m.ui[`emoticon/${e.dir}/${e.picId}`], `/assets/ui/emoticon/${e.dir}/${e.picId}.png`, e.id);
    for (const k of GUIDE_PAGES) assert.equal(m.ui[`guide/${k}`], `/assets/ui/guide/${k}.png`, k);
    assert.equal(m.stats.ui, Object.keys(m.ui).length);
    assert.ok(!JSON.stringify(m).includes('/assets/local/'), 'never a local-client path');
  });
});

// ---------------------------------------------------------------------------
describe('generated manifest data/assets.json', () => {
  const haveManifest = existsSync(MANIFEST);
  const haveAssets = existsSync(ASSETS);
  const manifest = haveManifest ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
  const skip = !haveManifest ? 'data/assets.json not generated (run npm run assets)'
    : !haveAssets ? 'public/assets missing (run npm run assets)' : false;

  /** Every '/assets/…' or '/fonts/…' URL in the manifest. */
  function urls(node, out = []) {
    if (typeof node === 'string') { if (/^\/(assets|fonts)\//.test(node)) out.push(node); }
    else if (Array.isArray(node)) node.forEach((x) => urls(x, out));
    else if (node && typeof node === 'object') Object.values(node).forEach((x) => urls(x, out));
    return out;
  }

  test('shape', { skip: !haveManifest && 'data/assets.json not generated' }, () => {
    assert.equal(manifest.version, 1);
    assert.equal(typeof manifest.hash, 'string');
    for (const k of ['chars', 'enemies', 'tokens', 'bonds', 'items', 'bands', 'skills', 'ui', 'prof', 'audio', 'fonts', 'stats']) {
      assert.ok(manifest[k] && typeof manifest[k] === 'object', k);
    }
  });

  test('every manifest path exists on disk', { skip }, () => {
    const all = [...new Set(urls(manifest))];
    assert.ok(all.length > 3000, `manifest lists ${all.length} files`);
    const missing = all.filter((u) => !existsSync(join(PUBLIC, u)) || statSync(join(PUBLIC, u)).size === 0);
    assert.deepEqual(missing, []);
  });

  test('every visible chess operator has avatar, portrait and a Front Spine', { skip }, () => {
    const ops = readJson('docs/research/03-operators.json');
    const ids = new Set(ops.chess.filter((c) => !c.isHidden && c.chessType !== 'DIY' && c.charId).map((c) => c.charId));
    assert.ok(ids.size >= 100);
    for (const id of ids) {
      const c = manifest.chars[id];
      assert.ok(c, `${id} in manifest`);
      for (const p of [c.avatar, c.portrait, c.spine?.front?.skel, c.spine?.front?.atlas, ...(c.spine?.front?.textures || [])]) {
        assert.ok(typeof p === 'string' && existsSync(join(PUBLIC, p)), `${id}: ${p}`);
      }
    }
  });

  test('all pool chars, bonds, items and bands are covered', { skip }, () => {
    const a07 = readJson('docs/research/07-assets.json');
    for (const id of Object.keys(a07.operators)) assert.ok(manifest.chars[id]?.avatar && manifest.chars[id]?.spine?.front, id);
    for (const id of Object.keys(a07.bonds)) assert.ok(manifest.bonds[id], id);
    for (const id of Object.keys(a07.items)) assert.ok(manifest.items[id], id);
    for (const id of Object.keys(a07.bands)) assert.ok(manifest.bands[id], id);
    for (const id of Object.keys(a07.enemies)) assert.ok(manifest.enemies[id]?.icon, id);
  });

  test('DESIGN §16 loadouts: every selectable skill has its icon; a multi-skill operator model has a clip per skill index', { skip }, () => {
    const chess = readJson('data/chess.json');
    const miss = [];
    const noClip = [];
    let n = 0;
    for (const r of Object.values(chess)) {
      if (!r?.visible) continue;
      for (const s of r.skills || []) {
        n++;
        const icon = manifest.skills[s.iconId || s.skillId] || manifest.skills[manifest.skillsById?.[s.skillId]];
        if (!icon || !existsSync(join(PUBLIC, icon))) miss.push(`${r.chessId} ${s.skillId}`);
        if ((r.skills || []).length > 1 && !manifest.chars[r.charId]?.spine?.front?.anims?.skills?.[String(s.index)]) noClip.push(`${r.chessId} S${s.index + 1}`);
      }
    }
    assert.ok(n >= 500, `${n} selectable skill records`);
    assert.deepEqual(miss, [], 'skill icons (the loadout screen, shop badges and the detail card show the chosen skill)');
    assert.deepEqual(noClip, [], 'Spine skill clips per index (a non-default skill never plays the default skill\'s animation)');
  });

  test('every atlas on disk has size: lines (and pma: true for enemies)', { skip }, () => {
    const atlases = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p); else if (e.name.endsWith('.atlas')) atlases.push(p);
      }
    };
    const spineDir = join(ASSETS, 'spine');
    if (existsSync(spineDir)) walk(spineDir);
    assert.ok(atlases.length > 400, `${atlases.length} atlases`);
    for (const p of atlases) {
      const info = atlasInfo(readFileSync(p, 'utf8'));
      assert.ok(info.hasSize, `${p} has size`);
      if (p.includes(`${join('spine', 'enemy')}`)) assert.ok(info.hasPma, `${p} has pma`);
      for (const page of info.pages) assert.ok(existsSync(join(dirname(p), page)), `${p} page ${page}`);
    }
  });

  test('Spine animation roles resolve (idle + attack or fallback)', { skip }, () => {
    const entries = [];
    for (const [id, c] of Object.entries(manifest.chars)) for (const [side, s] of Object.entries(c.spine || {})) entries.push([`${id}.${side}`, s]);
    for (const [id, e] of Object.entries(manifest.enemies)) if (e.spine) entries.push([id, e.spine]);
    for (const [id, t] of Object.entries(manifest.tokens)) if (t.spine) entries.push([id, t.spine]);
    assert.ok(entries.length > 400);
    for (const [id, s] of entries) {
      const names = Object.keys(s.animations || {});
      assert.ok(names.length > 0, `${id} has animations`);
      assert.ok(typeof s.anims?.idle === 'string' && names.includes(s.anims.idle), `${id} idle`);
      assert.ok(s.anims.attack && names.includes(s.anims.attack.loop), `${id} attack`);
      for (const n of roleAnimationNames(s.anims)) assert.ok(names.includes(n), `${id} role anim ${n}`);
    }
  });

  test('every Spine model loads like the client does (pixi-spine atlas reader + AtlasAttachmentLoader)', { skip }, async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(join(ROOT, 'package.json'));
    const core = require('@pixi/core');
    const base = require('@pixi-spine/base');
    const r38 = require('@pixi-spine/runtime-3.8');
    const models = new Map();
    for (const c of Object.values(manifest.chars)) for (const s of Object.values(c.spine || {})) models.set(s.skel, s);
    for (const e of Object.values(manifest.enemies)) if (e.spine) models.set(e.spine.skel, e.spine);
    for (const t of Object.values(manifest.tokens)) if (t.spine) models.set(t.spine.skel, t.spine);
    assert.ok(models.size > 400);
    // the official enemy and token models of the local client, as the client resolves them (DESIGN §13: only when listed)
    const localPath = join(ROOT, 'data', 'local-assets.json');
    const local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, 'utf8')) : null;
    for (const id of [...Object.keys(manifest.enemies), ...Object.keys(manifest.tokens)]) {
      const s = local ? spineEntry(manifest, id, { local }) : null;
      if (s?.local && [s.skel, s.atlas, ...s.textures].every((u) => existsSync(join(PUBLIC, u)))) models.set(s.skel, s);
    }
    for (const s of models.values()) {
      const dir = dirname(s.atlas);
      // pixi-spine finds the atlas by swapping the extension of the skel URL
      assert.equal(s.skel.replace(/\.skel$/, '.atlas'), s.atlas, s.skel);
      let done = false;
      const atlas = new base.TextureAtlas(readFileSync(join(PUBLIC, s.atlas), 'utf8'), (page, cb) => {
        const size = pngSize(readFileSync(join(PUBLIC, dir, page)));
        assert.ok(size, `${s.atlas}: page ${page}`);
        const bt = new core.BaseTexture(null, { width: size.width, height: size.height });
        bt.setRealSize(size.width, size.height);
        bt.valid = true;
        cb(bt); // regions outside the page make PIXI.Texture throw
      }, () => { done = true; });
      assert.ok(done, `${s.atlas} parsed`);
      assert.deepEqual(atlas.pages.map((p) => `${dir}/${p.name}`), s.textures, s.atlas);
      for (const p of atlas.pages) assert.ok(p.width > 0 && p.height > 0 && !!p.pma === s.pma, `${s.atlas} page ${p.name} size/pma`);
      const data = new r38.SkeletonBinary(new r38.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(readFileSync(join(PUBLIC, s.skel))));
      const skel = new r38.Skeleton(data);
      const state = new r38.AnimationState(new r38.AnimationStateData(data));
      for (const n of roleAnimationNames(s.anims)) {
        state.setAnimation(0, n, true);
        state.update(0.25);
        state.apply(skel);
        skel.updateWorldTransform();
      }
    }
  });

  test('audio: BGM phases and UI SFX', { skip }, () => {
    const { bgm, sfx } = manifest.audio;
    for (const k of ['lobby', 'prep', 'combat', 'boss']) assert.ok(bgm[k]?.loop, `bgm ${k}`);
    for (const k of ['buy', 'sell', 'refresh', 'levelup', 'merge', 'ready', 'timer', 'error', 'draft']) assert.ok(sfx.ui[k], `sfx.ui.${k}`);
    const units = Object.values(sfx.units);
    assert.ok(units.length > 300);
    for (const u of units) for (const v of Object.values(u)) assert.ok(typeof v === 'string' || (v && typeof v === 'object'));
    assert.ok(manifest.fonts.css && existsSync(join(PUBLIC, manifest.fonts.css)));
  });
});
