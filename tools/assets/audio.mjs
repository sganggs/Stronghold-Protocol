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
 *   mixOf: (paths: string[]|null|undefined) => ({ p?: number, vol?: number }|null) }}
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
  return { bank, bgm, unitBanks, skillBanks, mixOf };
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
