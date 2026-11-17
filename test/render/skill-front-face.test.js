// test/render/skill-front-face.test.js — 开技能转正面。[ASSUMED] 在【背面骨架没有自己的技能动作】时把正面
// 模型转过来播技能：德克萨斯 S2 剑雨、缄默德克萨斯这类干员的背面骨架根本没有 Skill clip，导出器只能把 skill 记成
// via:'attack'（tools/assets/anim-roles.mjs:31），于是背面开技能只是挥一下普攻。反过来，灰烬的背面骨架只有
// Skill_Loop_Up / Skill_Idle_Up、excu 的背面有 Skill_Up_*，官方给「朝上」编了专属技能动作 —— 所以这条只对「背面演不出
// 这支技能动作」的干员生效，其余照旧在背面播。渲染改动：render/units.js _wantsBack / _skillFacesFront / _skillFaceDur /
// setSkill / update 的 _faceHold。脚手架同 issue25-downback.test.js（fake PIXI + 真清单 + 真 assets 助手）。
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { spineEntry, hasBackSpine } from '../../public/js/assets.js';
import { UF } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const M = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
const TEXAS = 'char_102_texas';        // 背面没有 Skill clip，正面有（剑雨）
const TEXAS_ALT = 'char_1028_texas2';  // S1 是攻击三连、S2 / S3 有自己的 Skill clip
const CHEN = 'char_010_chen';          // 背面有自己的 Skill clip
const ASHLOK = 'char_431_ashlok';      // 背面只有 Skill_Loop_Up / Skill_Idle_Up
const EXCU = 'char_279_excu';          // 背面有 Skill_Up_Begin/Loop/End

let fake, UnitView;
before(async () => {
  fake = installFakePixi();
  ({ UnitView } = await import('../../public/js/render/units.js'));
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { await tick(); await tick(); };
const cam = () => presetCamera('normal', { width: 1280, height: 720 });
let clockT = 0;
const frames = (v, n, dt = 1 / 60) => { for (let i = 0; i < n; i++) { clockT += dt; v.update(dt, cam(), clockT); } };

function store() {
  const refs = new Map();
  return {
    refs,
    picture: () => null,
    image: async () => null,
    hasBack: (id, skin) => hasBackSpine(M, id, skin),
    spineEntry: (id, o) => spineEntry(M, id, o),
    spine: {
      acquire: async (e) => { refs.set(e.skel, (refs.get(e.skel) || 0) + 1); return { animations: Object.keys(e.animations || {}).map((name) => ({ name })) }; },
      release: (e) => { refs.set(e.skel, (refs.get(e.skel) || 0) - 1); },
    },
  };
}

async function op(id, dir, s = store(), extra = {}) {
  const v = new UnitView(fakeViewCtx(fake.P, { assets: s, cam }), { id: 5, side: 'ally', kind: 'chess', defId: id, spine: id, tier: 1, x: 5, y: 10, maxHp: 1000, dir, ...extra });
  await settle();
  frames(v, 5);
  return v;
}
const front = (id) => M.chars[id].spine.front;
const back = (id) => M.chars[id].spine.back;
/** sync() 的顺序：先落 flags，再在标志变化时 setSkill。 */
function cast(v, on) {
  if (on) v.flags |= UF.SKILL; else v.flags &= ~UF.SKILL;
  v.setSkill(on);
}

describe('清单里的证据（data/assets.json）', () => {
  test('背面没有技能动作的干员（技能走攻击），正面有', () => {
    assert.equal(back(TEXAS).anims.skill.via, 'attack');
    assert.equal(back(TEXAS).anims.skills['1'].via, 'attack');
    assert.equal(front(TEXAS).anims.skill.loop, 'Skill');
    assert.ok(Number.isFinite(front(TEXAS).animations.Skill), '剑雨那支 clip 的时长');
    for (const n of Object.keys(back(TEXAS).animations)) assert.doesNotMatch(n, /^Skill/, '背面骨架里没有 Skill clip');
  });

  test('背面有自己的技能动作的干员：朝上专属的 _Up 变体', () => {
    assert.equal(back(CHEN).anims.skill.via, undefined);
    assert.equal(back(CHEN).anims.skill.loop, 'Skill');
    assert.equal(back(ASHLOK).anims.skill.loop, 'Skill_Loop_Up');
    assert.ok(Object.hasOwn(back(ASHLOK).animations, 'Skill_Loop_Up'));
    assert.ok(Object.hasOwn(back(EXCU).animations, 'Skill_Up_Loop'));
  });
});

describe('开技能转正面', () => {
  test('德克萨斯（背面没技能动作）朝上开 S2：转正面播 Skill，剑雨播完再转回背面', async () => {
    const v = await op(TEXAS, 'UP');
    assert.equal(v._wantsBack(), true);
    assert.equal(v.actor.entry, back(TEXAS), '站着：背面模型');
    const n0 = v.actor;
    cast(v, true);
    assert.equal(v._wantsBack(), false, '技能开着 ⇒ 要正面');
    assert.equal(v.actor, n0, 'update 之前不换');
    frames(v, 1);
    await settle();
    assert.equal(v.actor.entry, front(TEXAS), '正面模型接管');
    assert.equal(v.actor.current, 'Skill', '播的是正面的 Skill（剑雨）');
    assert.equal(v.swapT, 1, '原地换模型（没有 fallback 菱形）');
    // 技能标志 0.5 s 就落，但剑雨那支 clip 有 2.17 s：正面要留到它播完
    cast(v, false);
    assert.equal(v._wantsBack(), false, '标志落下时 clip 还在播');
    assert.ok(v._faceHold > 1, `${v._faceHold}s 还留着`);
    frames(v, 140);                                      // ≈2.3 s
    await settle();
    assert.equal(v._wantsBack(), true);
    assert.equal(v.actor.entry, back(TEXAS), '播完转回背面');
    v.destroy();
    await settle();
  });

  test('背面有自己的技能动作的干员不转正面（陈 / 灰烬 / excu）', async () => {
    for (const id of [CHEN, ASHLOK, EXCU]) {
      const v = await op(id, 'UP');
      assert.equal(v._wantsBack(), true, id);
      const a = v.actor;
      cast(v, true);
      assert.equal(v._wantsBack(), true, `${id}：技能在背面自己播`);
      frames(v, 2);
      await settle();
      assert.equal(v.actor, a, `${id}：没有换模型`);
      const sk = back(id).anims.skill;
      assert.ok([sk.begin, sk.loop, sk.idle].filter(Boolean).includes(v.actor.current), `${id}: ${v.actor.current}`);
      v.destroy();
      await settle();
    }
  });

  test('朝右开技能照旧用正面（本来就没有背面模型）', async () => {
    const s = store();
    const v = await op(TEXAS, 'RIGHT', s);
    cast(v, true);
    assert.equal(v._wantsBack(), false);
    frames(v, 1);
    await settle();
    assert.equal(v.actor.entry, front(TEXAS));
    v.destroy();
    await settle();
  });

  test('技能动作本来就是攻击三连的（异格德克萨斯 S1）不转：正面也没得播', async () => {
    const v = await op(TEXAS_ALT, 'UP', store(), { skillIndex: 0 });
    assert.equal(back(TEXAS_ALT).anims.skills['0'].via, 'attack');
    assert.equal(front(TEXAS_ALT).anims.skills['0'].via, 'attack');
    cast(v, true);
    assert.equal(v._wantsBack(), true);
    v.destroy();
    await settle();
    // S2 有 Skill_2_Loop：这一支要转正面（不过异格的背面也有 Skill_2，所以仍然不转 —— 只在背面演不出时才转）
    const v2 = await op(TEXAS_ALT, 'UP', store(), { skillIndex: 1 });
    assert.equal(back(TEXAS_ALT).anims.skills['1'].via, undefined);
    cast(v2, true);
    assert.equal(v2._wantsBack(), true);
    v2.destroy();
    await settle();
  });

  test('正面模型加载慢、技能标志已经落下：正面仍然要进技能姿态（不是只转个身）', async () => {
    const s = store();
    let open = true;
    const real = s.spine.acquire;
    s.spine.acquire = async (e) => { while (!open) await tick(); return real(e); };
    const v = await op(TEXAS, 'UP', s);
    assert.equal(v.actor.entry, back(TEXAS));
    open = false;
    cast(v, true);                                       // 开技能：请求正面模型（加载卡住）
    frames(v, 1);
    cast(v, false);                                      // SKILL 标志 0.5 s 后落下，模型还没到
    open = true;
    for (let i = 0; i < 20; i++) await tick();
    assert.equal(v.actor.entry, front(TEXAS), '正面模型到了');
    assert.equal(v.actor.current, 'Skill', '正面播的是剑雨，不是站桩');
    v.destroy();
    await settle();
  });

  test('技能开着时倒下：照旧走「背面没 Die ⇒ 正面」那条，不打架', async () => {
    const v = await op(TEXAS, 'UP');
    cast(v, true);
    frames(v, 1);
    await settle();
    assert.equal(v.actor.entry, front(TEXAS));
    v.die();
    frames(v, 2);
    await settle();
    assert.equal(v.actor.entry, front(TEXAS), '倒下用正面（背面没有 Die clip）');
    assert.equal(v.actor.current, 'Die');
    v.destroy();
    await settle();
  });
});


test('pausing animation time preserves the front-only skill window', async () => {
  const v = await op(TEXAS, 'UP');
  cast(v, true);
  frames(v, 1);
  await settle();
  cast(v, false);
  const hold = v._faceHold;
  assert.ok(hold > 0);
  v.ctx.animRate = () => 0;
  frames(v, 180);
  assert.equal(v._faceHold, hold);
  assert.equal(v._wantsBack(), false);
  v.destroy();
  await settle();
});
