// public/studio/js/labels.js — the words the studio page shows for the server's data (server/studio/targets.js,
// server/studio/templates/): target kinds, templates, slot fields, voice lines, sounds and tracks. Every text goes
// through t() — the language packs translate it (public/i18n/<code>.json; node tools/i18n.mjs check).

import { t, N_ } from '../../../shared/i18n.js';

/** Target kinds (TARGET_KINDS). */
export const KIND_LABELS = Object.freeze({
  operator: N_('干员'), token: N_('召唤物'), enemy: N_('敌人'), item: N_('道具'), bond: N_('盟约'), band: N_('策略'), ui: N_('界面图'),
  music: N_('音乐'), sound: N_('音效'),
});

/** Templates (server/studio/templates/): title, one line on what it does. */
export const TEMPLATE_LABELS = Object.freeze({
  bond: { title: N_('新盟约'), line: N_('选择成员、门槛、图标与准备及战斗效果。') },
  item: { title: N_('新道具'), line: N_('借用官方效果，填写价格与普通精锐配对。') },
  trait: { title: N_('干员特质'), line: N_('编辑战斗与准备钩子，明确选择是否替换官方特质。') },
  offers: { title: N_('交互窗口'), line: N_('填写选项池、时机、刷新次数与奖励。') },
  rules: { title: N_('规则开关'), line: N_('选择商店、备战调配、变形同构体和卸装规则。') },
  theme: { title: N_('主题变量'), line: N_('调整颜色、时长与缓动，在工作台实时预览。') },
  notices: { title: N_('插件公告'), line: N_('填写公告、日期与翻译，预览纯文本弹窗。') },
  fx: { title: N_('干员特效'), line: N_('借用官方特效或上传序列帧，在 2D / 3D 试播。') },
  skins: { title: N_('干员时装'), line: N_('添加时装名称、系列、图片及正背面模型。') },
  numbers: { title: N_('改数值'), line: N_('按官方名字选目标，修改属性与黑板数值。') },
  operator: { title: N_('新干员'), line: N_('填写属性，选择技能来源，自动生成普通与精锐卡。') },
  dsl: { title: N_('DSL 技能 / 天赋'), line: N_('用下拉选项组合触发器、条件与动作。') },
  meta: { title: N_('备战效果'), line: N_('用 DSL 改变资金、盟约层数或获得道具。') },
  mode: { title: N_('新模式'), line: N_('基于原版模式调整经济与时长。') },
  ui: { title: N_('界面小组件'), line: N_('选择插槽和标题，在沙箱中预览演示数据。') },
  script: { title: N_('脚本插件'), line: N_('生成 SDK 骨架与测试，再用编辑器编写代码。') },
  art: { title: N_('换头像 / 立绘 / 图标'), line: N_('替换干员的头像和立绘，或敌人、召唤物、道具、盟约、策略、界面上的图片。') },
  spine: { title: N_('换 Spine 模型'), line: N_('替换干员、召唤物或敌人在战场上的动画模型（Spine 3.8）。') },
  voice: { title: N_('换语音'), line: N_('替换干员在战斗中说的每一句话（中文和日文配音）。') },
  audio: { title: N_('换音乐 / 音效'), line: N_('替换背景音乐、界面和战斗音效，或某个单位的攻击、受击、技能声音。') },
});

/** Slot fields (a template's slots `field`). */
const FIELD_LABELS = Object.freeze({
  avatar: N_('头像'), avatarE2: N_('精英二头像'), portrait: N_('立绘'), portraitE2: N_('精英二立绘'), icon: N_('图标'),
  front: N_('正面模型'), back: N_('背面模型'), spine: N_('模型'), track: N_('音乐（循环 + 可选前奏）'), sound: N_('音效'),
  attack: N_('攻击'), hit: N_('受击'), skill: N_('技能'), die: N_('倒下'), born: N_('出场'),
});

/** Voice lines (audio.voice slots: public/js/audio.js). */
const VOICE_LABELS = Object.freeze({
  start: N_('行动出发'), faceEnemy: N_('行动开始'), select: N_('选中干员'), place: N_('部署'), skill1: N_('作战中 1'), skill2: N_('作战中 2'),
  skill3: N_('作战中 3'), skill4: N_('作战中 4'), resultFour: N_('结算 · 四星'), resultThree: N_('结算 · 三星'), resultTwo: N_('结算 · 二星'),
  resultLose: N_('结算 · 失败'), squad: N_('编入队伍'), squadFirst: N_('任命队长'), gacha: N_('干员报到'),
});

/** BGM tracks (audio.bgm keys). */
const MUSIC_LABELS = Object.freeze({ lobby: N_('大厅音乐'), prep: N_('准备阶段音乐'), combat: N_('战斗音乐'), unite: N_('联防音乐'), boss: N_('最终攻势音乐') });

/** A target kind's label. @param {string} kind */
export const kindLabel = (kind) => t(KIND_LABELS[kind] || kind);

/** A template's title. @param {string} id */
export const templateTitle = (id) => (TEMPLATE_LABELS[id] ? t(TEMPLATE_LABELS[id].title) : id);

/** A template's line. @param {string} id */
export const templateLine = (id) => (TEMPLATE_LABELS[id] ? t(TEMPLATE_LABELS[id].line) : '');

/**
 * The label of a slot (`field` of a template's slot: 'avatar', 'voice.select', 'voiceJp.skill1' …).
 * @param {{ field: string }} slot
 */
export function slotLabel(slot) {
  const f = String(slot?.field || '');
  const m = /^(voice|voiceJp)\.(.+)$/.exec(f);
  if (m) {
    const line = VOICE_LABELS[m[2]] ? t(VOICE_LABELS[m[2]]) : m[2];
    return m[1] === 'voiceJp' ? t('{line}（日文）', { line }) : line;
  }
  return FIELD_LABELS[f] ? t(FIELD_LABELS[f]) : f;
}

/**
 * How a target is named in the page: an operator, enemy … by its official name (the game's data), a track by what it
 * plays, a sound by its group and key, an interface picture by its key.
 * @param {{ kind: string, key: string, name: string, group?: string }} target
 */
export function targetName(target) {
  if (!target) return '';
  if (target.kind === 'music') return target.group === 'bossBgm' ? t('首领音乐 {key}', { key: target.key }) : MUSIC_LABELS[target.key] ? t(MUSIC_LABELS[target.key]) : target.key;
  if (target.kind === 'sound') return target.group === 'battle' ? t('战斗音效 {key}', { key: target.key }) : t('界面音效 {key}', { key: target.key });
  return target.name || target.key;
}

/** Bytes as KB / MB. @param {number} n */
export const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(0, n / 1024).toFixed(1)} KB`);
