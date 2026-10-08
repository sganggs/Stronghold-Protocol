// Audio bank resolution from the official excel/audio_data.json.
//
// - Unit combat SFX banks are named `battle.<EVENT>.<unitId>[.<ability>[.<n>…]]`
//   (e.g. battle.ON_ABILITY_START.char_102_texas.attack); skill banks are
//   `battle.ON_SKILL_START.<skillId>`. pickUnitSfx() turns them into the roles the
//   client plays: attack (swing/cast), hit (impact), skill (activation), die, born.
// - BGM banks (`battle.ON_GAME_READY.<event>`, `sys.ON_ACTIVITY_LOADED.<act>`)
//   carry an optional intro and a loop.
// - UI SFX: autochess banks (ui./battle.ON_ACT1AUTOCHESS_*) mapped to event
//   names used by public/js/audio.js, plus a few generic UI sounds where the
//   autochess mode has no dedicated bank (buy/refresh/error/pick/drop).
// Every sound is addressed by its path under sound_beta_2 (lower-case, .mp3).
// - A bank's mix (bankMix, community report #30): the official banks weigh their sounds, and an empty asset is a chance
//   of silence (猎狗 / 深池侦察犬 bark on 20 of 100 attacks), and give each sound a volume; `indexAudio().mixOf(paths)`
//   returns { p?, vol? } of the bank a picked path list came from (plan.mjs writes it as sfx.units[id].mix).

const PREFIX_RE = /^audio\/sound_beta_2\//i;

/**
 * Convert an audio_data asset id to its lower-case path under sound_beta_2.
 * @param {string} asset e.g. 'Audio/Sound_Beta_2/Player/p_atk/p_atk_sword_n'
 * @returns {string|null} e.g. 'player/p_atk/p_atk_sword_n.mp3'
 */
export function assetToPath(asset) {
  if (typeof asset !== 'string' || !asset) return null;
  const p = asset.replace(PREFIX_RE, '').replace(/\\/g, '/').toLowerCase();
  if (!p || p.includes('..')) return null;
  return p.endsWith('.mp3') ? p : p + '.mp3';
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * The official play chance and volume of a bank, for the file the client plays (`path`, the first of its list):
 * `p` = the weight of the sounds that have a file over all the weights (an empty asset is a chance of silence),
 * `vol` = that file's volume (the mean of minVolume / maxVolume). Only what differs from 1 is returned; null when
 * neither does (the default: every attack plays its sound at the base gain).
 * @param {Array<{ asset?: string, weight?: number, minVolume?: number, maxVolume?: number }>} sounds
 * @param {string} path the played file (assetToPath form)
 * @returns {{ p?: number, vol?: number } | null}
 */
export function bankMix(sounds, path) {
  let total = 0, real = 0, vol = 1, found = false;
  for (const s of Array.isArray(sounds) ? sounds : []) {
    const w = Number(s && s.weight);
    const wt = Number.isFinite(w) && w > 0 ? w : 0;
    total += wt;
    const p = assetToPath(s && s.asset);
    if (!p) continue;
    real += wt;
    if (!found && p === path) {
      found = true;
      const lo = Number(s.minVolume), hi = Number(s.maxVolume);
      if (Number.isFinite(lo) && Number.isFinite(hi) && lo >= 0 && hi >= 0) vol = round3((lo + hi) / 2);
    }
  }
  const out = {};
  if (total > 0 && real < total) out.p = round3(real / total);
  if (vol !== 1) out.vol = vol;
  return Object.keys(out).length ? out : null;
}

/**
 * Index an audio_data.json object.
 * @param {any} audioData parsed excel/audio_data.json
 * @returns {{ bank: (name:string)=>string[], bgm: (name:string)=>({intro:string|null, loop:string}|null),
 *   unitBanks: Map<string, Map<string, string[]>>, skillBanks: Map<string, Map<string,string[]>>,
 *   mixOf: (paths: string[]|null|undefined) => ({ p?: number, vol?: number }|null),
 *   bankLoop: (name:string)=>boolean, ctrlFor: (bankName:string)=>({name:string,target:string,stop:boolean,fade:number|null}|null) }}
 */
export function indexAudio(audioData) {
  const banks = new Map();
  const mixes = new WeakMap(); // a bank's path list (the very array every lookup hands out) → bankMix
  for (const b of Array.isArray(audioData?.soundFXBanks) ? audioData.soundFXBanks : []) {
    if (!b || typeof b.name !== 'string') continue;
    const paths = (Array.isArray(b.sounds) ? b.sounds : []).map((s) => assetToPath(s?.asset)).filter(Boolean);
    if (!banks.has(b.name)) banks.set(b.name, []);
    const list = banks.get(b.name);
    for (const p of paths) if (!list.includes(p)) list.push(p);
    if (list.length && !mixes.has(list)) { const m = bankMix(b.sounds, list[0]); if (m) mixes.set(list, m); }
  }
  const alias = audioData?.bankAlias && typeof audioData.bankAlias === 'object' ? audioData.bankAlias : {};
  const bank = (name, depth = 0) => {
    if (banks.has(name) && banks.get(name).length) return banks.get(name);
    if (depth < 4 && typeof alias[name] === 'string') return bank(alias[name], depth + 1);
    return [];
  };
  // The banks the official data plays as a sustained sound (`loop: true`): a skill's 持续段 is one of these, and it is
  // stopped by a ctrl bank (below) rather than by a sound of its own (SKILL_SFX_BANKS, docs/ASSETS.md).
  const loops = new Set((Array.isArray(audioData?.soundFXBanks) ? audioData.soundFXBanks : [])
    .filter((b) => b && typeof b.name === 'string' && b.loop === true).map((b) => b.name));
  const bankLoop = (name, depth = 0) => loops.has(name) || (depth < 4 && typeof alias[name] === 'string' ? bankLoop(alias[name], depth + 1) : false);
  // Ctrl banks (soundFXCtrlBanks): what the official client does when a sustained sound ends — `{ targetBank, ctrlStop,
  // ctrlStopFadetime }`, i.e. STOP the bank it names (with that fade) instead of playing a file. 315 of them, every one
  // with `ctrlStop: true`; `battle.ON_SKILL_FINISH.<skillId>` is the most common (46). It is the official answer to
  // "what does this skill's end sound like when it has no end sound": the end IS the stop of its loop.
  const ctrl = [];
  for (const c of Array.isArray(audioData?.soundFXCtrlBanks) ? audioData.soundFXCtrlBanks : []) {
    if (!c || typeof c.name !== 'string' || typeof c.targetBank !== 'string') continue;
    const fade = Number(c.ctrlStopFadetime);
    ctrl.push({ name: c.name, target: c.targetBank, stop: c.ctrlStop === true, fade: Number.isFinite(fade) && fade >= 0 ? fade : null });
  }
  /** The ctrl bank that STOPS `bankName` (the official end of the sound that bank plays), or null. */
  const ctrlFor = (bankName) => ctrl.find((c) => c.stop && c.target === bankName) ?? null;
  const bgmBanks = new Map();
  for (const b of Array.isArray(audioData?.bgmBanks) ? audioData.bgmBanks : []) {
    if (b && typeof b.name === 'string' && typeof b.loop === 'string') {
      bgmBanks.set(b.name, { intro: assetToPath(b.intro), loop: assetToPath(b.loop) });
    }
  }
  const bgm = (name, depth = 0) => {
    if (bgmBanks.has(name)) return bgmBanks.get(name);
    if (depth < 4 && typeof alias[name] === 'string') return bgm(alias[name], depth + 1);
    return null;
  };
  // Per-unit and per-skill bank tables.
  const unitBanks = new Map();
  const skillBanks = new Map();
  const addUnit = (name, paths) => {
    const parts = name.split('.');
    if (parts.length < 3 || parts[0] !== 'battle') return;
    if (/^ON_SKILL_(START|FINISH|SPECIAL_POINT)$/.test(parts[1])) {
      const skillId = parts.slice(2).join('.');
      if (!skillBanks.has(skillId)) skillBanks.set(skillId, new Map());
      skillBanks.get(skillId).set(parts[1], paths);
      return;
    }
    const unit = parts[2];
    if (!/^(char|enemy|token|trap)_/.test(unit)) return;
    const key = parts[1] + (parts.length > 3 ? '.' + parts.slice(3).join('.') : '');
    if (!unitBanks.has(unit)) unitBanks.set(unit, new Map());
    unitBanks.get(unit).set(key, paths);
  };
  for (const [name, paths] of banks) if (paths.length) addUnit(name, paths);
  for (const name of Object.keys(alias)) if (!banks.has(name)) { const p = bank(name); if (p.length) addUnit(name, p); }
  const mixOf = (paths) => (paths && typeof paths === 'object' && mixes.get(paths)) || null;
  return { bank, bgm, unitBanks, skillBanks, mixOf, bankLoop, ctrlFor };
}

/** Sort key for ability sub-keys: plain first, then numeric suffixes ascending. */
function abilityOrder(a, b) {
  const na = a.split('.').length; const nb = b.split('.').length;
  if (na !== nb) return na - nb;
  return a.localeCompare(b, 'en', { numeric: true });
}

function firstMatching(banks, event, abilities, ok = () => true) {
  const keys = [...banks.keys()].filter((k) => k.startsWith(event + '.'));
  for (const ab of abilities) {
    const exact = `${event}.${ab}`;
    if (banks.get(exact)?.length && ok(banks.get(exact))) return banks.get(exact);
    const numbered = keys.filter((k) => k.startsWith(exact + '.')).sort(abilityOrder);
    for (const k of numbered) if (banks.get(k)?.length && ok(banks.get(k))) return banks.get(k);
  }
  return null;
}

/** Official operator sound files of a skill mode end in `_d` / `_h` / `_s` (+ digits); the normal attack's in `_n`. */
const SKILL_MODE_FILE = /_(d|h|s)\d*\.mp3$/i;
/** A bank of an operator's normal attack: none of its files belongs to a skill mode. */
export const normalModeBank = (paths) => Array.isArray(paths) && paths.length > 0 && !paths.some((p) => SKILL_MODE_FILE.test(p));

/**
 * Pick role → candidate sound paths for one unit.
 * @param {Map<string,string[]>|undefined} banks unit bank table (from indexAudio().unitBanks)
 * @returns {{ attack?: string[], hit?: string[], die?: string[], born?: string[] }}
 */
export function pickUnitSfx(banks, opts = {}) {
  const out = {};
  const proj = opts.projectile || {};
  if ((!banks || !banks.size) && !proj.born?.length && !proj.hit?.length) return out;
  banks = banks || new Map();
  // operators (user playtest #4 item 6): numbered ability variants (attack.1, attack.2 …) are usually the attacks of a
  // skill mode, whose files end in _d / _h / _s — never the normal attack's (纯烬艾雅法拉's S3 impact rang on every hit);
  // a ranged operator's normal attack / impact is its own projectile's bank (projectile_chr_<name>)
  const ok = opts.operator ? normalModeBank : () => true;
  // Looser pass: abilities whose name mentions attack/combat (PowerAttack, StunCombat, CrossAttack…).
  // Other abilities (skills, talents 'T.*', mode switches) are not normal attacks.
  const attackLike = (event) => {
    const keys = [...banks.keys()]
      .filter((k) => k.startsWith(event + '.') && /attack|combat/i.test(k.slice(event.length + 1).split('.')[0]))
      .sort(abilityOrder);
    for (const k of keys) if (banks.get(k)?.length && ok(banks.get(k))) return banks.get(k);
    return null;
  };
  const exact = (event) => ['attack', 'combat'].map((ab) => banks.get(`${event}.${ab}`)).find((p) => p?.length && ok(p)) ?? null;
  const own = (p) => (p?.length && ok(p) ? p : null);
  // operators whose default mode is the unsuffixed ability (a plain attack / combat bank of any event): every numbered
  // variant (attack.1, attack.2 …) is then a skill mode's ability, whatever its file name — 银灰's attack.2 swing
  // p_atk_silver_n is his S3 mode's (charpack modes Default / S2 / S3), his normal attack is the Default mode's Combat (impact
  // ON_ABILITY_HIT.combat p_imp_spear_n, no swing bank): community report of 2026-10-06 (item 54) 「银灰的普通攻击的音效错误
  // 的使用了3技能期间的攻击音效」. Only the plain banks then, or the operator's own projectile banks; newer operators number
  // their default mode too (attack.0 …) and keep the rule below
  if (opts.operator && ['ON_ABILITY_START', 'ON_ABILITY_ON', 'ON_ABILITY_HIT'].some((e) => exact(e))) {
    const swing = exact('ON_ABILITY_START') ?? exact('ON_ABILITY_ON') ?? own(proj.born);
    const impact = exact('ON_ABILITY_HIT') ?? own(proj.hit);
    if (swing) out.attack = swing;
    if (impact) out.hit = impact;
    if (banks.get('ON_UNIT_DEAD')?.length) out.die = banks.get('ON_UNIT_DEAD');
    if (banks.get('ON_UNIT_BORN')?.length) out.born = banks.get('ON_UNIT_BORN');
    return out;
  }
  // operators: the plain ability of either event before any numbered variant
  const plain = opts.operator ? exact('ON_ABILITY_START') ?? exact('ON_ABILITY_ON') : null;
  const attack = plain
    ?? firstMatching(banks, 'ON_ABILITY_START', ['attack', 'combat'], ok)
    ?? firstMatching(banks, 'ON_ABILITY_ON', ['attack', 'combat'], ok)
    ?? own(proj.born) ?? attackLike('ON_ABILITY_START') ?? attackLike('ON_ABILITY_ON');
  const hit = firstMatching(banks, 'ON_ABILITY_HIT', ['attack', 'combat'], ok) ?? own(proj.hit) ?? attackLike('ON_ABILITY_HIT');
  if (attack) out.attack = attack;
  if (hit) out.hit = hit;
  if (banks.get('ON_UNIT_DEAD')?.length) out.die = banks.get('ON_UNIT_DEAD');
  if (banks.get('ON_UNIT_BORN')?.length) out.born = banks.get('ON_UNIT_BORN');
  return out;
}

/**
 * PER-SKILL battle sounds (`audio.sfx.units[id].skillSfx`, docs/ASSETS.md "按技能细分的音效"): the skills whose own
 * sounds the manifest carries, one entry per SKILL ID — role → the official bank names to read, in order, exactly like
 * UI_SFX / BATTLE_SFX name the bank they take their sound from.
 *
 * Why a table and not a rule: a unit's manifest roles are per UNIT (`attack`, `hit`, `die`, `born`) while the official
 * banks are per SKILL — 伊内丝's three skills each have an impact of their own (`projectile_chr_ines_s1` / `_s2` / `_s3`,
 * three different files) and the client plays the unit's ONE `hit` for every damage it can attribute to her. Those
 * banks are also named after the PROJECTILE (`ON_PROJECTILE_HIT.projectile_chr_…`) or the ABILITY
 * (`ON_CUSTOM_TRIGGER.…`, `ON_ABILITY_START.skchr_…`, `ON_SKILL_FINISH.…`), so nothing in a unit's own bank table
 * (unitBanks) can name them: this table is where that research lives, and a skill it does not name contributes nothing
 * (every other operator's entry is written exactly as before this section existed).
 *
 * Roles (SKILL_SFX_ROLES), each resolved to ONE file (`audio.bank(name)[0]`, the first bank of the role the official
 * index carries — the manifest plays one sound per role, not a draw):
 *   born    the skill note's / projectile's launch (`ON_PROJECTILE_BORN.projectile_…`). NOT read by the client today: a
 *           projected unit's launch belongs to the projectile path (DESIGN §17.3 draws a projectile per kind and the
 *           manifest carries no sound for one yet), and wiring it into `unit()` would replace the skill's ACTIVATION cue
 *           with the note's launch sound. Listed for completeness, nothing planned.
 *   hit     the skill's own impact (`ON_PROJECTILE_HIT.projectile_…_s<n>`, or `ON_CUSTOM_TRIGGER.…_s<n>_hit` for a skill
 *           that fires through an ability trigger). THIS is what the section exists for: without it every skill of a unit
 *           plays its ordinary `hit` (伊内丝: p_imp_insasn_n_2 for S1, S2 and S3 alike).
 *   finish  the skill's end cue (`ON_SKILL_FINISH.<skillId>`, a one-shot file of its own). A skill the official data
 *           ends by STOPPING a loop has no finish file — see `loop`.
 *   loop    a bank the official data plays as a sustained sound (`battle.ON_BUFF_START.…[loop]`, or the skill's own
 *           `ON_SKILL_START` / `ON_ABILITY_START` bank when the DATA marks it `loop: true`): played while the skill runs
 *           and stopped when it ends. `skillSfx` accepts a `loop` only when the official index backs it twice — the bank
 *           carries `loop: true` AND some `soundFXCtrlBanks` entry names it as its `targetBank` with `ctrlStop: true`.
 *           That pair IS the official end of a sustained skill: the stop (after `ctrlStopFadetime`), never a file
 *           (public/js/audio.js stopLoop). 煌's S3 is the worked example: the ctrl bank
 *           `battle.ON_SKILL_FINISH.skchr_huang_3 = { targetBank: 'battle.ON_ABILITY_START.skchr_huang_3',
 *           ctrlStop: true, ctrlStopFadetime: 0.2 }` stops `p_skill_chainsawulmextension_1_loop`, while her activation
 *           cue is the matching `…_intro`: intro once, then the tail loops until the skill ends.
 */
export const SKILL_SFX_BANKS = Object.freeze({
  // 伊内丝 (char_4087_ines): three skills, three impacts (S1 `_d`, S2 `_h_2`, S3 `_s_2`) — none of them her ordinary
  // `hit` (projectile_chr_ines_normal → p_imp_insasn_n_2), which is what all three skills play today.
  skchr_ines_1: Object.freeze({
    hit: Object.freeze(['battle.ON_PROJECTILE_HIT.projectile_chr_ines_s1']),
  }),
  skchr_ines_2: Object.freeze({
    hit: Object.freeze(['battle.ON_PROJECTILE_HIT.projectile_chr_ines_s2']),
  }),
  skchr_ines_3: Object.freeze({
    hit: Object.freeze(['battle.ON_PROJECTILE_HIT.projectile_chr_ines_s3']),
  }),
  // 煌 (char_017_huang S3): the loop bank of her sustained section, plus the ctrl bank that stops it — and no
  // ON_SKILL_FINISH file of its own, because the official end of that skill IS the stop of this loop.
  skchr_huang_3: Object.freeze({
    loop: Object.freeze(['battle.ON_ABILITY_START.skchr_huang_3']),
  }),
  // 娜仁图亚 (char_4138_narant S1): a skill with an end CUE of its own (`battle.ON_SKILL_FINISH.skchr_narant_1`, the
  // shared b_char_boostclose) and no loop — the other half of the same official convention.
  skchr_narant_1: Object.freeze({
    finish: Object.freeze(['battle.ON_SKILL_FINISH.skchr_narant_1']),
  }),
});

/** The roles SKILL_SFX_BANKS may carry, in the order the plan writes them into the manifest. */
export const SKILL_SFX_ROLES = Object.freeze(['born', 'hit', 'finish', 'loop']);

/**
 * The per-skill sounds of one skill (SKILL_SFX_BANKS) as role → ONE sound path, or null when the table does not name
 * that skill / the official data carries none of its banks.
 * @param {{ bank: (name:string)=>string[], bankLoop?: (name:string)=>boolean, ctrlFor?: (bankName:string)=>any }} audio
 *   from indexAudio()
 * @param {string} skillId e.g. 'skchr_ines_1'
 * @returns {Record<string, string>|null}
 */
export function skillSfx(audio, skillId) {
  const roles = SKILL_SFX_BANKS[skillId];
  if (!roles || !audio) return null;
  /** @type {Record<string, string>} */
  const out = {};
  for (const role of SKILL_SFX_ROLES) {
    const names = roles[role];
    if (!names?.length) continue;
    for (const name of names) {
      const p = audio.bank(name)[0];
      if (!p) continue;   // a bank the official index does not carry: the role's next name gets its turn
      // A loop needs BOTH official halves (see the table): the bank is a sustained sound, and a ctrl bank stops it. A
      // one-shot sample played on `loop: true` would ring forever, and a sound the official data never stops has no end
      // semantics to hand the client — either way the role is left out and the skill keeps the sound it has today.
      if (role === 'loop' && !(audio.bankLoop?.(name) && audio.ctrlFor?.(name)?.stop)) continue;
      out[role] = p;
      break;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * UI / battle-flow SFX map: name → { bank } or { path } (path under sound_beta_2).
 * Bank names are the official act1autochess banks (shared by act2autochess).
 */
export const UI_SFX = Object.freeze({
  click: { path: 'general/g_ui/g_ui_btn_h.mp3' },
  back: { path: 'general/g_ui/g_ui_btn_u.mp3' },
  confirm: { path: 'general/g_ui/g_ui_confirm_h.mp3' },
  tab: { path: 'general/g_ui/g_ui_tabswitch.mp3' },
  pick: { path: 'general/g_ui/g_ui_pick.mp3' },
  drop: { path: 'general/g_ui/g_ui_unpick.mp3' },
  error: { path: 'general/g_ui/g_ui_scwarning.mp3' },
  buy: { bank: 'battle.ON_ACT1AUTOCHESS_MAGIC_PLACE_HAND' },
  sell: { bank: 'ui.ON_ACT1AUTOCHESS_GETMONEY' },
  income: { bank: 'ui.ON_ACT1AUTOCHESS_GETMONEY' },
  refresh: { path: 'general/g_ui/g_ui_rtargetrefresh.mp3' },
  freeze: { bank: 'ui.ON_ACT1AUTOCHESS_SHOP_LOCK' },
  levelup: { bank: 'ui.ON_ACT1AUTOCHESS_SHOP_UPGRADE' },
  merge: { bank: 'battle.ON_ACT1AUTOCHESS_CHAR_BONUS' },
  equip: { bank: 'battle.ON_ACT1AUTOCHESS_EQUIP_DONE' },
  itemMerge: { bank: 'battle.ON_ACT1AUTOCHESS_EQUIP_BONUS' },
  bondUp: { bank: 'battle.ON_ACT1AUTOCHESS_ADD_BOND' },
  artPlace: { bank: 'battle.ON_ACT1AUTOCHESS_MAGIC_PLACE_BATTLE' },
  ready: { bank: 'ui.ON_ACT1AUTOCHESS_PLAYER_READY' },
  timer: { bank: 'ui.ON_ACT1AUTOCHESS_COUNTDOWN' },
  draft: { bank: 'ui.ON_ACT1AUTOCHESS_STRATEGY' },
  yourTurn: { bank: 'ui.ON_ACT1AUTOCHESS_YOURTURN' },
  yourTurnCircle: { bank: 'ui.ON_ACT1AUTOCHESS_YOURTURN_CIRCLE' },
  target: { bank: 'ui.ON_ACT1AUTOCHESS_TARGET' },
  broadcast: { bank: 'ui.ON_ACT1AUTOCHESS_BROADCASTHINT' },
  danger: { bank: 'battle.ON_ACT1AUTOCHESS_ENTER_DANGER' },
  emote: { bank: 'ui.ON_ACT1AUTOCHESS_EMOJIDIALOGUE' },
  roundStart: { bank: 'ui.ON_ACT1AUTOCHESS_ROUNDSTART' },
  rest: { bank: 'ui.ON_ACT1AUTOCHESS_REST' },
  battleStart: { bank: 'ui.ON_ACT1AUTOCHESS_BATTLESTART' },
  battleStartBoss: { bank: 'ui.ON_ACT1AUTOCHESS_BATTLESTART_BOSS' },
  bossRoundTeam: { bank: 'ui.ON_ACT1AUTOCHESS_BOSSROUND_TEAM' },
  bossRoundSingle: { bank: 'ui.ON_ACT1AUTOCHESS_BOSSROUND_SINGLE' },
  bossRoundSecret: { bank: 'ui.ON_ACT1AUTOCHESS_BOSSROUND_SECRET' },
  killBoss: { bank: 'ui.ON_ACT1AUTOCHESS_KILLBOSS' },
  killBossAll: { bank: 'ui.ON_ACT1AUTOCHESS_KILLBOSS_ALL' },
  killBossNormal: { bank: 'ui.ON_ACT1AUTOCHESS_KILLBOSS_NORMAL' },
  defenceStart: { bank: 'ui.ON_ACT1AUTOCHESS_DEFENCE_START' },
  defenceUnite: { bank: 'ui.ON_ACT1AUTOCHESS_DEFENCE_UNITE' },
  battleOverReduce: { bank: 'ui.ON_ACT1AUTOCHESS_BATTLEOVER_REDUCE' },
  battleOverNoReduce: { bank: 'ui.ON_ACT1AUTOCHESS_BATTLEOVER_NOREDUCE' },
  battleOverNormal: { bank: 'ui.ON_ACT1AUTOCHESS_BATTLEOVER_NORMAL' },
  goFirst: { bank: 'ui.ON_ACT1AUTOCHESS_GOFIRST' },
  disconnect: { bank: 'ui.ON_ACT1AUTOCHESS_DISCONNECT' },
  settlementSucceed: { bank: 'ui.ON_ACT1AUTOCHESS_SETTLEMENT_SUCCEED' },
  settlementFail: { bank: 'ui.ON_ACT1AUTOCHESS_SETTLEMENT_FAIL' },
  settlementTeam: { bank: 'ui.ON_ACT1AUTOCHESS_SETTLEMENT_TEAM' },
  settlementBossSign: { bank: 'ui.ON_ACT1AUTOCHESS_SETTLEMENT_BOSSSIGN' },
  goodEvaluation: { bank: 'ui.ON_ACT1AUTOCHESS_GOODEVALUATION' },
  load: { bank: 'ui.ON_ACT1AUTOCHESS_LOAD' },
  start: { bank: 'ui.ON_ACT1AUTOCHESS_START' },
  matchSucceed: { bank: 'ui.ON_ACT1AUTOCHESS_MATCH_SUCCEED' },
  matchFail: { bank: 'ui.ON_ACT1AUTOCHESS_MATCH_FAIL' },
  matchCancel: { bank: 'ui.ON_ACT1AUTOCHESS_MATCH_CANCEL' },
  joinRoom: { bank: 'ui.ON_ACT1AUTOCHESS_PLAYER_JOINROOM' },
});

/** In-battle generic SFX: name → { bank } or { path }. */
export const BATTLE_SFX = Object.freeze({
  deploy: { path: 'battle/b_char/b_char_set.mp3' },
  tokenDeploy: { path: 'battle/b_char/b_char_tokenset.mp3' },
  charDie: { path: 'battle/b_char/b_char_dead.mp3' },
  enemyDie: { path: 'battle/b_enemy/b_enemy_dead_n.mp3' },
  enemyDieHeavy: { path: 'battle/b_enemy/b_enemy_dead_h.mp3' },
  enemyHit: { path: 'enemy/e_imp/e_imp_general_w.mp3' },
  heal: { bank: 'battle.ON_MODIFIER_HEAL' },
  // 漏怪: an enemy reached the exit. This is the ORIGINAL Arknights stage cue (`battle.ON_ENEMY_REACHED_EXIT` ->
  // `Battle/b_ui/b_ui_alarmenter`), not an autochess one — the mode itself has no bank named for an escape (all 13,948
  // SFX banks of audio_data.json searched). The official treats it as a one-shot alarm: `maxSoundAllowed: 1` with
  // `popOldest: true` on the `Battle_UI_Important` mixer, so a new escape replaces the one still playing.
  leak: { bank: 'battle.ON_ENEMY_REACHED_EXIT' },
  win: { path: 'battle/b_ui/b_ui_win.mp3' },
  lose: { path: 'battle/b_ui/b_ui_lose.mp3' },
  killCoin: { bank: 'battle.ON_CUSTOM_TRIGGER.autochess_kill_gain_coin' },
});

/**
 * Resolve a { bank } / { path } spec to candidate sound paths.
 * @param {{bank?:string, path?:string}} spec
 * @param {(name:string)=>string[]} bank bank lookup from indexAudio()
 * @returns {string[]}
 */
export function resolveSpec(spec, bank) {
  if (spec?.path) return [spec.path];
  if (spec?.bank) return bank(spec.bank);
  return [];
}

// ---- operator battle voice (excel/charword_table.json) -------------------------------------------------
//
// Every playable operator has official battle lines (行动出发 / 行动开始 / 选中干员 / 部署 / 作战中 / 编入队伍 /
// 任命队长 / 结算 / 干员报到) in `voice_cn/<charId>/cn_<n>.mp3` — JP: `voice/`, EN: `voice_en/`, KR: `voice_kr/`,
// the same file names in every dump, only the folder differs. charword_table.json's `placeType` says when the game
// plays each line; its `voiceAsset` is the path under the dump.

/** Voice dump folder per language (under sound_beta_2). */
export const VOICE_DIRS = Object.freeze({ cn: 'voice_cn', jp: 'voice', en: 'voice_en', kr: 'voice_kr' });

/** Official `placeType` → the manifest's voice slot (public/js/audio.js VOICE_PRIORITY / VOICE_COOLDOWN_MS). */
export const VOICE_SLOTS = Object.freeze({
  BATTLE_START: 'start',            // 行动出发: 开战
  BATTLE_FACE_ENEMY: 'faceEnemy',   // 行动开始: 首次接敌
  BATTLE_SELECT: 'select',          // 选中干员1/2
  BATTLE_PLACE: 'place',            // 部署1/2
  BATTLE_SKILL_1: 'skill1',         // 作战中1-4: the equipped skill's own slot
  BATTLE_SKILL_2: 'skill2',
  BATTLE_SKILL_3: 'skill3',
  BATTLE_SKILL_4: 'skill4',
  SQUAD: 'squad',                   // 编入队伍
  SQUAD_FIRST: 'squadFirst',        // 任命队长
  FOUR_STAR: 'resultFour',          // 完成高难行动
  THREE_STAR: 'resultThree',        // 3星结束行动 (完美作战)
  TWO_STAR: 'resultTwo',            // 非3星结束行动
  LOSE: 'resultLose',               // 行动失败
  GACHA: 'gacha',                   // 干员报到
});

/**
 * The slots the client can actually request — the only ones `public/js/audio.js` ever asks for: 行动出发 start, 首次接敌
 * faceEnemy, 作战中1-4 skillN, 部署 place (a running battle's deploy events), the settlement lines resultFour /
 * resultThree / resultTwo / resultLose (public/js/screens/game.js onResult) and 选中干员 select (the detail panel opening
 * on an operator the player tapped, in every phase since 0.2.2).
 * `buildPlan` plans these by default; `--voice-all` widens it to every slot of VOICE_SLOTS.
 */
export const VOICE_BATTLE_SLOTS = Object.freeze(['start', 'faceEnemy', 'select', 'place',
  'skill1', 'skill2', 'skill3', 'skill4', 'resultFour', 'resultThree', 'resultTwo', 'resultLose']);

/**
 * Slots no battle plays: the lines the official client uses in its own 养成 / 编队 UI (干员报到 gacha, 编入队伍 squad,
 * 任命队长 squadFirst). `test/docs-consistency.test.js` proves the client never asks for one, so planning them only
 * makes every `npm run assets` download 360 files (19.3 MB, CN dub) that no player will ever hear — they are left out
 * unless `--voice-all` is passed. 部署 `place` and 选中干员 `select` deliberately stay in: the official client groups
 * them with the prep lines, but the client does play them (the deploy events; a tap on an operator).
 */
export const VOICE_PREP_SLOTS = Object.freeze(['gacha', 'squad', 'squadFirst']);

/**
 * Index charword_table.json into per-character voice slots, in voiceIndex order (one slot may have several lines).
 * Only the base word key (`wordKey === charId`) is used: the dump has no folder for a skin variant's word key
 * (`char_x_ita`, `char_x_epoque#28`, …) — those files simply do not exist upstream.
 * @param {any} charword parsed excel/charword_table.json
 * @param {string} [lang] voiceId prefix — the zh_CN table carries the `CN_*` lines; the other dubs share the numbering
 * @param {Iterable<string>|null} [only] slot names to keep; null/omitted keeps every slot (VOICE_BATTLE_SLOTS is what
 *   the plan uses by default, so a battle's own lines are planned and the prep-only ones are not)
 * @returns {Map<string, Record<string, string[]>>} charId → slot → voiceAsset ('char_263_skadi/CN_023')
 */
export function indexVoice(charword, lang = 'CN', only = null) {
  const keep = only ? new Set(only) : null;
  const out = new Map();
  const words = charword?.charWords;
  if (!words || typeof words !== 'object') return out;
  /** @type {Map<string, Map<string, Map<string, {index:number, asset:string}>>>} */
  const seen = new Map();
  for (const e of Object.values(words)) {
    if (!e || typeof e !== 'object') continue;
    const charId = e.charId, slot = VOICE_SLOTS[e.placeType], vid = e.voiceId;
    if (!charId || !slot || (keep && !keep.has(slot)) || typeof vid !== 'string' || !vid.startsWith(`${lang}_`)) continue;
    if (e.wordKey !== charId) continue;
    if (typeof e.voiceAsset !== 'string' || !e.voiceAsset) continue;
    if (!seen.has(charId)) seen.set(charId, new Map());
    const slots = seen.get(charId);
    if (!slots.has(slot)) slots.set(slot, new Map());
    // the same line can be listed twice (an operator's 升变 / alt records): keep its lowest voiceIndex, once
    const m = slots.get(slot);
    const index = Number.isFinite(e.voiceIndex) ? e.voiceIndex : 0;
    const prev = m.get(vid);
    if (!prev || index < prev.index) m.set(vid, { index, asset: e.voiceAsset });
  }
  for (const [charId, slots] of seen) {
    const rec = {};
    for (const [slot, m] of slots) rec[slot] = [...m.values()].sort((a, b) => a.index - b.index).map((x) => x.asset);
    out.set(charId, rec);
  }
  return out;
}
