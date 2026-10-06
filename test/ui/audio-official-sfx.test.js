// 部署音与技能激活音按官方 bank 的两条语义播放（用户报告：干员魔王部署、开技能都没有声音）。
//
// 官方 `excel/audio_data.json`：
// - `battle.ON_UNIT_BORN.<charId>`（只有 12 / 121 名本模式干员有）maxSoundAllowed 1 + popOldest，没有专属音的干员
//   走通用 bank `battle.ON_UNIT_BORN.char` → `b_char_set`，**maxSoundAllowed 0（不限次）**：每一次部署都该响。
//   `b_char_tokenset` 是召唤物的同类通用音（ON_UNIT_BORN.token，maxSoundAllowed 2）。
//   上游客户端把没有专属音的干员全塞进同一个限流键 `'deploy'`（同键 160 ms 冷却），十人同批部署只响四个；
//   同时那十份 1.41 s 的同一素材若同时起播会叠成一份很响的（相位完全一致），所以整批按 DEPLOY_BURST_STEP_MS 铺开。
// - `battle.ON_SKILL_START.<skillId>` 里 13 个 bank 是 `loop: true`（本模式清单命中 4 条：魔王 S3、初雪 S1/S2、
//   寒檀 S2、青枳 S3），这些素材是技能持续期间的音场而不是一击 —— 魔王 S3 `p_skill_tpartclotmfld` 长 7.21 s、最响的
//   0.25 s 窗只有 −32.8 dB（同模式其它技能音 −17 dB），播一遍等于没有声音。官方在技能期间一直循环、技能结束才停。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioManager, unitSkillSfx } from '../../public/js/audio.js';
import { mediaUrl } from '../../public/js/media.js';
import { indexAudio, assetToPath } from '../../tools/assets/audio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8'));
const AUDIO_DATA = path.join(ROOT, '.cache', 'gamedata', 'excel', 'audio_data.json');

/** 这个 manifest 地址被请求过吗（/media/ 形式或 404 后的原始形式，见 test/ui/audio.test.js）。 */
const asked = (urls, raw) => urls.includes(mediaUrl(raw)) || urls.includes(raw);
const askedCount = (urls, raw) => urls.filter((u) => u === mediaUrl(raw) || u === raw).length;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/** 魔王（char_4134_cetsyr）：S1 一次性、S2 一次性、S3 官方 loop: true，默认装备 S3（index 2）。 */
const WANG = 'char_4134_cetsyr';
const WANG_S3 = manifest.audio.sfx.units[WANG].skills['2'];

// ---- fake Web Audio ---------------------------------------------------------------------------------------

function fakeWindow() {
  const rec = [];   // { loop, started, stopped }
  class Param { constructor() { this.value = 1; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } cancelScheduledValues() {} }
  class Node { connect() {} disconnect() {} }
  class Gain extends Node { constructor() { super(); this.gain = new Param(); } }
  class Src extends Node {
    constructor() { super(); this.playbackRate = new Param(); this._loop = false; this._r = { loop: false, started: 0, stopped: [] }; rec.push(this._r); }
    set loop(v) { this._loop = !!v; this._r.loop = !!v; }
    get loop() { return this._loop; }
    start() { this._r.started++; }
    stop(when) { this._r.stopped.push(when ?? null); }
  }
  class Ctx {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = new Node(); }
    createGain() { return new Gain(); }
    createBufferSource() { return new Src(); }
    decodeAudioData(ab, ok) { ok({ duration: 1.5 }); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  }
  return {
    rec,
    win: { AudioContext: Ctx, document: { hidden: false, addEventListener() {} }, addEventListener() {}, removeEventListener() {} },
  };
}

/** A manager with a fake context and a fetch stub that records every URL. */
function rig({ hold = new Map(), fail = new Set() } = {}) {
  const fw = fakeWindow();
  const urls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    urls.push(u);
    if (fail.has(u)) return { ok: false, status: 404 };
    const h = hold.get(u);
    if (h) { hold.delete(u); await h; }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
  a.install();
  a._unlock();
  // how many limited requests the crowd limiter refused, by reason
  const refused = { total: 0, unitKey: 0, other: 0 };
  const origTry = a.limiter.tryAcquire.bind(a.limiter);
  a.limiter.tryAcquire = (now, unitKey, url, o = {}) => {
    const ok = origTry(now, unitKey, url, o);
    if (!ok) { refused.total++; if (now - (a.limiter.lastByUnit.get(unitKey) ?? -1e9) < a.limiter.unitCooldownMs) refused.unitKey++; else refused.other++; }
    return ok;
  };
  // 每个**真的起播**的音（解码缓存让 URL 只请求一次，所以不能拿 fetch 次数当播放次数）：限流通过 = 这一发的
  // 单位键刚被记下时间。声音类型（voice/BGM）不同，只有走 _play 的那些算 SFX。
  const plays = [];
  const origPlay = a._play.bind(a);
  a._play = (url, o = {}) => {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    origPlay(url, o);
    const ok = !o.limited || (a.limiter.lastByUnit.get(o.unitKey) ?? -1e9) >= t0 - 1;
    plays.push({ url, key: o.unitKey ?? null, limited: !!o.limited, uncapped: !!o.uncapped, accepted: ok });
  };
  const started = (url) => plays.filter((p) => p.accepted && (url == null || p.url === url)).length;
  return { a, urls, rec: fw.rec, plays, started, refused, restore: () => { globalThis.fetch = origFetch; } };
}

// ---- 纯函数：装备技能的取音与循环标记 ---------------------------------------------------------------------

describe('unitSkillSfx: 技能音与它所在官方 bank 的循环标记', () => {
  test('按 skillIndex 取 `skills[index]`，标记跟那个索引走；没有该索引时用主技能音与主标记', () => {
    const u = { skill: '/s3.mp3', skills: { 0: '/s1.mp3', 1: '/s2.mp3', 2: '/s3.mp3' }, skillLoop: true, skillsLoop: { 2: true } };
    assert.deepEqual(unitSkillSfx(u, 0), { url: '/s1.mp3', loop: false });
    assert.deepEqual(unitSkillSfx(u, 1), { url: '/s2.mp3', loop: false });
    assert.deepEqual(unitSkillSfx(u, 2), { url: '/s3.mp3', loop: true });
    assert.deepEqual(unitSkillSfx(u, 7), { url: '/s3.mp3', loop: true }, '未知索引 ⇒ 主技能音');
    assert.deepEqual(unitSkillSfx(u, undefined), { url: '/s3.mp3', loop: true }, '没有 skillIndex ⇒ 主技能音');
    assert.deepEqual(unitSkillSfx({ skill: '/a.mp3', skillLoop: true }, 1), { url: '/a.mp3', loop: true }, '单一技能：skills 不存在');
    assert.deepEqual(unitSkillSfx({ skill: '/a.mp3' }, 1), { url: '/a.mp3', loop: false });
    assert.deepEqual(unitSkillSfx({ skills: { 1: '/b.mp3' }, skillsLoop: { 1: true } }, 1), { url: '/b.mp3', loop: true });
    assert.equal(unitSkillSfx({}, 0), null);
    assert.equal(unitSkillSfx(null, 0), null);
    assert.equal(unitSkillSfx({ skills: { 0: null } }, 0), null);
  });
});

// ---- 清单：循环标记与官方数据逐条一致 --------------------------------------------------------------------

describe('清单的循环标记来自官方 bank 的 loop', () => {
  test('每一条落在官方 loop: true bank 上的技能音都带标记，其它技能音一律不带', { skip: !existsSync(AUDIO_DATA) && 'no .cache/gamedata audio_data.json' }, () => {
    const audio = indexAudio(JSON.parse(readFileSync(AUDIO_DATA, 'utf8')));
    const loopPaths = new Set();
    const skillIds = new Set();
    for (const [skillId, banks] of audio.skillBanks) {
      const ss = banks.get('ON_SKILL_START');
      if (ss?.length && audio.loopOf(ss)) { skillIds.add(skillId); for (const p of ss) loopPaths.add(p); }
    }
    assert.ok(skillIds.size >= 3, `官方 ON_SKILL_START 里有 loop bank：${[...skillIds].join(', ')}`);
    const rel = (u) => String(u).replace(/^\/assets\/audio\/sfx\//, '');
    let looping = 0, checked = 0;
    const markedUnits = new Set();
    const markedPaths = new Set();
    for (const [id, u] of Object.entries(manifest.audio.sfx.units)) {
      const sounds = [];
      if (typeof u.skill === 'string') sounds.push([null, u.skill]);
      for (const [i, url] of Object.entries(u.skills ?? {})) sounds.push([i, url]);
      for (const [i, url] of sounds) {
        checked++;
        const expected = loopPaths.has(rel(url));
        const marked = i == null ? !!u.skillLoop : !!(u.skillsLoop && u.skillsLoop[i]);
        assert.equal(marked, expected, `${id} 技能音 ${i ?? 'primary'} ${rel(url)}：官方 loop=${expected}，清单标记=${marked}`);
        if (expected) {
          if (i == null) assert.ok(u.skillLoop, `${id} 的主技能音是循环音 ⇒ 主标记也要在`);
          looping++;
          markedUnits.add(id);
          markedPaths.add(rel(url));
        }
      }
    }
    assert.ok(checked >= 250, `检查了 ${checked} 条技能音（清单里的技能音全部过一遍）`);
    // 非空守卫：只比对计数会因两边同时为空而永远成立
    assert.ok(markedPaths.size >= 3, `命中的循环素材：${[...markedPaths].join(', ')}`);
    assert.ok(markedUnits.size >= 3, `带循环音的干员：${[...markedUnits].join(', ')}`);
    assert.ok(looping >= 4, `带标记的技能音条目：${looping}`);
    // 报告里的那一条：魔王默认 S3
    assert.equal(unitSkillSfx(manifest.audio.sfx.units[WANG], 2).loop, true, '魔王 S3 是循环音');
    assert.equal(unitSkillSfx(manifest.audio.sfx.units[WANG], 1).loop, false, '她的 S2 不是');
  });

  // 地灵 S2 流沙化那一类：官方 ON_SKILL_START bank 有音，但它的索引不是该干员的默认技能索引。上游的清单只写
  // 「两条以上」的技能音表，于是这条唯一的音整个丢掉（9 名干员），开技能就是无声的。
  test('官方有 ON_SKILL_START bank 的技能，清单里必须能取到音（不能因索引不是默认那条而丢）', { skip: !existsSync(AUDIO_DATA) && 'no .cache/gamedata audio_data.json' }, () => {
    const audio = indexAudio(JSON.parse(readFileSync(AUDIO_DATA, 'utf8')));
    const chess = JSON.parse(readFileSync(path.join(ROOT, 'data', 'chess.json'), 'utf8'));
    const byChar = new Map();
    for (const rec of Object.values(chess)) if (rec?.charId && !byChar.has(rec.charId)) byChar.set(rec.charId, rec);
    let checked = 0;
    const missing = [];
    for (const [id, u] of Object.entries(manifest.audio.sfx.units)) {
      const rec = byChar.get(id);
      if (!rec) continue;
      for (const s of rec.skills ?? []) {
        const ss = s?.skillId ? audio.skillBanks.get(s.skillId)?.get('ON_SKILL_START') : null;
        if (!ss?.length) continue;              // 官方没有这个技能的 ON_SKILL_START bank：本来就没有音
        checked++;
        // 客户端就是按这个索引取音的（DESIGN §16）
        if (!unitSkillSfx(u, s.index)) missing.push(`${rec.name ?? id} S${s.index + 1} ${s.name ?? ''} (${s.skillId})`);
      }
    }
    assert.ok(checked >= 20, `官方有技能音的技能条目：${checked}`);
    assert.deepEqual(missing, [], `这些技能的官方音没能到清单里：\n  ${missing.join('\n  ')}`);
  });
});

// ---- 部署音 ----------------------------------------------------------------------------------------------

describe('部署音：官方 ON_UNIT_BORN 的每次部署都响', () => {
  /** 魔王（有专属部署音）+ 9 名没有专属音的干员，一批部署事件。 */
  function tenPieceBatch() {
    const own = WANG;
    const plain = Object.entries(manifest.audio.sfx.units)
      .filter(([id, u]) => id.startsWith('char_') && !u.born).slice(0, 9).map(([id]) => id);
    const units = [own, ...plain].map((spine, i) => ({ id: i + 1, side: 'ally', kind: 'chess', spine }));
    return { units, ev: units.map((u) => ['deploy', u.id]) };
  }

  test('十人同批：十条部署音全部起播（通用音不再被同键冷却吃掉），批次按 60 ms 铺开', async () => {
    const { a, started, refused, restore } = rig();
    try {
      const { units, ev } = tenPieceBatch();
      const deploy = manifest.audio.sfx.battle.deploy;
      a.setFieldUnits(units);
      a.handleBattleEvents(ev);
      await tick(250);
      const early = started(deploy);
      assert.ok(early >= 1 && early < 9, `批次应当铺开（250 ms 时响起 ${early} 条，而不是一次全上）`);
      assert.equal(started(manifest.audio.sfx.units[WANG].born), 1, '魔王的专属部署音照旧响');
      await tick(700);
      assert.equal(started(deploy), 9, '另外九人各响一次通用部署音');
      assert.equal(started(manifest.audio.sfx.units[WANG].born), 1, '魔王的专属音只响一次（通用音与她无关）');
      assert.equal(refused.total, 0, '一次都没有被限流拒绝');
      // 官方 maxSoundAllowed 0：并发数可以超过 SfxLimiter 的 8
      assert.ok(a.limiter.active > a.limiter.maxVoices, `同批的十条都还在响（active ${a.limiter.active} > ${a.limiter.maxVoices}）`);
    } finally { restore(); }
  });

  test('同一干员在 160 ms 内重复部署不会响第二声，过了冷却再响', async () => {
    const { a, started, refused, restore } = rig();
    try {
      const { units } = tenPieceBatch();
      const deploy = manifest.audio.sfx.battle.deploy;
      a.setFieldUnits(units);
      a.handleBattleEvents([['deploy', 2], ['deploy', 2]]);
      await tick(120);
      assert.equal(started(deploy), 1, '同一单位的第二个事件被同键冷却挡下');
      assert.equal(refused.unitKey, 1);
      await tick(200);
      a.handleBattleEvents([['deploy', 2]]);
      await tick(60);
      assert.equal(started(deploy), 2, '冷却过后再部署会响');
    } finally { restore(); }
  });

  test('muted 时什么都不请求（部署音的绕过只对限流，不对静音）', async () => {
    const { a, urls, restore } = rig();
    try {
      const { units, ev } = tenPieceBatch();
      a.setFieldUnits(units);
      a.setVolumes({ muted: true });
      a.handleBattleEvents(ev);
      await tick(700);
      assert.equal(urls.length, 0);
    } finally { restore(); }
  });
});

// ---- 技能激活音 ------------------------------------------------------------------------------------------

describe('技能激活音：官方 loop: true 的技能音循环到技能结束', () => {
  test('魔王 S3：激活即循环，技能结束 / 阵亡 / 换场都停掉它', async () => {
    const { a, rec, restore } = rig();
    try {
      a.setFieldUnits([{ id: 1, side: 'ally', kind: 'chess', spine: WANG, skillIndex: 2 }]);
      a.handleBattleEvents([['skill', 1, 1]]);
      await tick(20);
      const loops = () => rec.filter((r) => r.loop && r.started);
      assert.equal(loops().length, 1, '一个循环节点，而不是一次性播放');
      assert.equal(a.loopNodes.has(1), true, '循环归这个单位管');

      a.handleBattleEvents([['skill', 1, 0]]);
      await tick(20);
      assert.equal(a.loopNodes.has(1), false, '技能结束即停');
      assert.ok(loops()[0].stopped.length >= 1, '并且真的 stop 了（带淡出）');
      assert.ok(loops()[0].stopped[0] > 0, '淡出到 0.15 s 后，不是硬切');

      // 再激活 ⇒ 阵亡也停
      a.handleBattleEvents([['skill', 1, 1]]);
      await tick(20);
      assert.equal(loops().length, 2, '再激活是新的循环（popOldest：旧的已被顶掉）');
      a.handleBattleEvents([['die', 1, 'killed']]);
      await tick(20);
      assert.equal(a.loopNodes.has(1), false, '阵亡停循环');
      assert.ok(loops()[1].stopped.length >= 1);

      // 再激活 ⇒ 换场也停
      a.handleBattleEvents([['skill', 1, 1]]);
      await tick(20);
      a.setFieldUnits([{ id: 9, side: 'ally', kind: 'chess', spine: WANG, skillIndex: 2 }]);
      await tick(20);
      assert.equal(a.loopNodes.size, 0, '新战场不带上一场的循环');
    } finally { restore(); }
  });

  test('非循环技能音仍是一次性；同一单位再激活时循环是重启而不是叠加', async () => {
    const { a, rec, started, restore } = rig();
    try {
      a.setFieldUnits([{ id: 1, side: 'ally', kind: 'chess', spine: WANG, skillIndex: 1 }]);   // S2：一次性
      const s2 = manifest.audio.sfx.units[WANG].skills['1'];
      a.handleBattleEvents([['skill', 1, 1]]);
      await tick(20);
      assert.equal(rec.filter((r) => r.loop).length, 0, 'S2 不是循环音');
      assert.equal(started(s2), 1, 'S2 播一次');
      assert.equal(a.loopNodes.size, 0);

      a.setFieldUnits([{ id: 1, side: 'ally', kind: 'chess', spine: WANG, skillIndex: 2 }]);   // S3：循环
      a.handleBattleEvents([['skill', 1, 1]]);
      await tick(20);
      assert.equal(a.loopNodes.size, 1);
      const first = a.loopNodes.get(1).src;
      a.handleBattleEvents([['skill', 1, 1]]);
      await tick(20);
      assert.equal(a.loopNodes.size, 1, 'popOldest：同一单位只有一个循环在响');
      assert.notEqual(a.loopNodes.get(1).src, first, '而且是新的那一个');
      assert.ok(rec.filter((r) => r.loop && r.stopped.length).length >= 1, '旧的被停掉');
    } finally { restore(); }
  });

  test('还在解码时技能就结束了：这个循环不得起播', async () => {
    const hold = new Map();
    const { a, rec, restore } = rig({ hold });
    try {
      let open;
      hold.set(mediaUrl(WANG_S3), new Promise((r) => { open = r; }));
      a.setFieldUnits([{ id: 1, side: 'ally', kind: 'chess', spine: WANG, skillIndex: 2 }]);
      a.handleBattleEvents([['skill', 1, 1]]);
      await tick(10);
      a.handleBattleEvents([['skill', 1, 0]]);    // 技能在解码期间结束
      open();
      await tick(30);
      assert.equal(rec.filter((r) => r.loop && r.started).length, 0, '解码完成后不许再起播');
      assert.equal(a.loopNodes.size, 0);
      assert.equal(a.loopWanted.size, 0, '取消的任务不留在表里');
    } finally { restore(); }
  });

  test('unit() 的返回值：有技能音即 true，循环与一次性都按各自的 bank 播', async () => {
    const { a, started, restore } = rig();
    try {
      const u = manifest.audio.sfx.units[WANG];
      assert.equal(a.unit(WANG, 'skill', 1, 1), true, 'S2 是一次性技能音');
      await tick(20);
      assert.equal(started(u.skills['1']), 1);
      assert.equal(a.loopNodes.size, 0);
      assert.equal(a.unit(WANG, 'skill', 2, 2), true, 'S3 是循环技能音');
      await tick(20);
      assert.equal(a.loopNodes.size, 1);
      assert.equal(a.loopNodes.get(2).src.loop, true);
      assert.equal(a.unit('char_nope', 'skill', 3, 0), false);
    } finally { restore(); }
  });
});
