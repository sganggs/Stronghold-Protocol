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
 * Official pool limits and per-file playback parameters (excel/audio_data.json soundFXBanks).
 * Keep the bank id: unrelated banks may use the same file, and aliases share their target's pool.
 * [ASSUMED] Sparse/custom banks default to the legacy cap 2, no takeover, pitch 1 and no delay.
 */
export function bankPool(bank) {
  const sounds = {};
  for (const s of bank.sounds || []) {
    const path = assetToPath(s?.asset);
    if (!path || sounds[path]) continue;
    sounds[path] = { minPitch: s.minPitch ?? 1, maxPitch: s.maxPitch ?? 1, delay: s.delay ?? 0 };
  }
  return { id: bank.name, maxSoundAllowed: bank.maxSoundAllowed ?? 2, popOldest: bank.popOldest ?? false, sounds };
}

/**
 * Index an audio_data.json object.
 * @param {any} audioData parsed excel/audio_data.json
 * @returns {{ bank: (name:string)=>string[], bgm: (name:string)=>({intro:string|null, loop:string}|null),
 *   unitBanks: Map<string, Map<string, string[]>>, skillBanks: Map<string, Map<string,string[]>>,
 *   mixOf: (paths: string[]|null|undefined) => ({ p?: number, vol?: number }|null),
 *   poolOf: (paths: string[]|null|undefined) => (ReturnType<typeof bankPool>|null) }}
 */
export function indexAudio(audioData) {
  const banks = new Map();
  const mixes = new WeakMap(); // a bank's path list (the very array every lookup hands out) → bankMix
  const pools = new WeakMap();
  for (const b of Array.isArray(audioData?.soundFXBanks) ? audioData.soundFXBanks : []) {
    if (!b || typeof b.name !== 'string') continue;
    const paths = (Array.isArray(b.sounds) ? b.sounds : []).map((s) => assetToPath(s?.asset)).filter(Boolean);
    if (!banks.has(b.name)) banks.set(b.name, []);
    const list = banks.get(b.name);
    for (const p of paths) if (!list.includes(p)) list.push(p);
    if (list.length && !mixes.has(list)) { const m = bankMix(b.sounds, list[0]); if (m) mixes.set(list, m); }
    if (list.length && !pools.has(list)) pools.set(list, bankPool(b));
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
  const poolOf = (paths) => (paths && typeof paths === 'object' && pools.get(paths)) || null;
  return { bank, bgm, unitBanks, skillBanks, mixOf, poolOf };
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
 * The skill mode of a sound file: 'd' / 'h' / 's' for 技能1 / 2 / 3, null for a normal-mode (`_n`) file. The mode letter
 * is the official naming of a skill's own sounds — it holds for the whole chain of a skill (原声: `p_skill_lzxqlkl_s`
 * 技能3发动, `p_atk_lzxqlkl_s` 技能3的攻击, `p_imp_…_s` 技能3命中): 司霆惊蛰's three skills have the activation sounds
 * `_d` / `_h` / `_s` and the matching attack banks `p_atk_lzxqlkl_d1` / `_h` / `_s`, and every operator whose activation
 * sounds name a mode agrees with its slot (§ pickModeAttacks).
 */
export function skillModeLetter(path) {
  const m = SKILL_MODE_FILE.exec(typeof path === 'string' ? path : '');
  return m ? m[1].toLowerCase() : null;
}

/** [ASSUMED] Slot fallback for operators without a named activation sound; DESIGN §28.17. */
export const SLOT_MODE_LETTER = Object.freeze({ 0: 'd', 1: 'h', 2: 's' });

/**
 * The per-skill-mode bank of one unit, by mode letter: `{ d?: string[], h?: string[], s?: string[] }`.
 *
 * Why a second table: `pickUnitSfx` builds the operator's NORMAL attack / impact, and for that it refuses every
 * skill-mode file (`_d` / `_h` / `_s`) — 银灰's S3 swing is not his normal attack. An operator whose library is all
 * skill modes has therefore no normal bank at all: 司霆惊蛰's attack banks are `ON_ABILITY_ON…attack.1.2.1`
 * (`p_atk_lzxqlkl_d1`, 技能1), `…attack.4` (`_h2` / `_h`, 技能2) and `…attack.7` (`_s`, 技能3) — she never has a plain
 * bank, because (解放者) she only attacks while a skill runs. The official client plays that mode's own files during the
 * skill, so the manifest needs them per skill index (plan.mjs writes `sfx.units[id].attacks` / `hits` = the mode's
 * attack / impact sound, public/js/audio.js plays them while that skill is active).
 *
 * `events` picks which banks count: the attack is cast / held (`ON_ABILITY_START` preferred over `ON_ABILITY_ON`, the
 * order pickUnitSfx prefers), the impact is the hit (`ON_ABILITY_HIT`). Among equals the plain ability wins over a
 * numbered variant, then the numeric order. 赤刃明霄陈 S3 (the official banks, `attack.3`):
 * `ON_ABILITY_START` → `p_atk_hljdswd_s` (the swing: different from her normal `p_atk_hljdswd_n`),
 * `ON_ABILITY_HIT` → `p_imp_hljdswd_s` (the slash's impact: different from `p_imp_hljdswd_n`).
 * @param {Map<string,string[]>|undefined} banks unit bank table (from indexAudio().unitBanks)
 * @param {string[]} events official event prefixes to read
 * @returns {{ d?: string[], h?: string[], s?: string[] }}
 */
export function pickModeBanks(banks, events) {
  const cands = new Map(); // letter → [{ rank, rest, paths }]
  if (!banks || !banks.size) return {};
  for (const [name, paths] of banks) {
    const ev = events.find((e) => name.startsWith(e + '.'));
    if (!ev || !Array.isArray(paths) || !paths.length) continue;
    const ability = name.slice(ev.length + 1).split('.')[0];
    if (!/attack|combat/i.test(ability)) continue;
    const letter = skillModeLetter(paths[0]);
    if (!letter || paths.some((p) => skillModeLetter(p) !== letter)) continue;
    const rest = name.slice(ev.length + 1 + ability.length);
    const numbered = rest ? 1 : 0;                    // 'attack.1.2.1' / 'attack.4' vs the plain 'attack'
    const rank = `${events.indexOf(ev)}${numbered}`;
    if (!cands.has(letter)) cands.set(letter, []);
    cands.get(letter).push({ rank, rest, paths });
  }
  const out = {};
  for (const [letter, list] of cands) {
    list.sort((a, b) => (a.rank !== b.rank ? (a.rank < b.rank ? -1 : 1) : abilityOrder(a.rest, b.rest)));
    out[letter] = list[0].paths;
  }
  return out;
}

/** The per-skill-mode ATTACK bank of one unit (the swing / cast while that skill runs) — see pickModeBanks. */
export const pickModeAttacks = (banks) => pickModeBanks(banks, ['ON_ABILITY_START', 'ON_ABILITY_ON']);

/**
 * The per-skill-mode IMPACT bank of one unit (the hit sound while that skill runs): 赤刃明霄陈's S3 slashes hit with
 * `p_imp_hljdswd_s`, not her normal `p_imp_hljdswd_n`. A mode without an `ON_ABILITY_HIT` bank keeps the unit's normal
 * impact (司霆惊蛰's S3 has none: only its 技能2 swings `_h` and impacts `_h`).
 */
export const pickModeHits = (banks) => pickModeBanks(banks, ['ON_ABILITY_HIT']);

/** The planned skill id is that skill's own number (`skchr_…_2` → index 1). A `skcom_` substitute is not. */
function ownsSkillNumber(skillId, index) {
  return typeof skillId === 'string' && !/^skcom_/i.test(skillId) && skillId.endsWith(`_${index + 1}`);
}

/**
 * Skill indexes a mode name names, when no skill switches to that mode.
 * `S1-2` / `S2-3` is the inclusive range; `S2+`, `S1_Landing`, `Sk3_Zero` name the first number.
 * `Default`, `Stand`, `Empty`, `T2`, `Changed` name none. [ASSUMED] The grammar is the names in the local fx index.
 * @param {string} name
 * @param {{index:number, skillId?:string|null}[]} skills
 * @param {Set<number>} explicit skill indexes that already switch to a mode
 */
function skillIndicesFromModeName(name, skills, explicit) {
  const s = String(name || '');
  const range = /^(?:sk|s)(\d+)\s*-\s*(\d+)/i.exec(s);
  const idxs = [];
  if (range) {
    const a = Number(range[1]) - 1;
    const b = Number(range[2]) - 1;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) idxs.push(i);
  } else {
    const one = /^(?:sk|s)(\d+)/i.exec(s);
    if (one) idxs.push(Number(one[1]) - 1);
  }
  return idxs.filter((i) => {
    const row = skills.find((k) => k.index === i);
    return row && !explicit.has(i) && ownsSkillNumber(row.skillId, i);
  });
}

/**
 * A phase of a skill mode (`S3_Resapwn`, `S2Respawn`, `S2+`, `S1_Landing`), not a range (`S2-3`) and not the
 * skill's closing clip (`S3_End`). [ASSUMED] Only the name marks it; the client has no per-phase playback.
 * @param {string} name
 * @returns {{index:number, end:boolean}|null}
 */
function phaseOfModeName(name) {
  const m = /^(?:sk|s)(\d+)(?!\s*-\s*\d\b)(.+)$/i.exec(String(name || '').trim());
  if (!m) return null;
  return { index: Number(m[1]) - 1, end: /end/i.test(m[2]) };
}

/**
 * Per-skill attack / impact banks.
 *
 * The filename letter is not the skill slot. 玛恩纳's S2 swing is `p_imp_loyalsword_d` and his S3 swing is
 * `p_imp_loyalsword_h` (official banks `attack.2` / `attack.3`); the letter fallback therefore played `_d` during S1,
 * `_h` during S2, and nothing during S3 (#679). The first number of an attack/combat key is the mode index in that
 * operator's own mode list (`attack` and `attack.0` are mode 0; `attack.1.2.1` stays on mode 1). It is not
 * skill N−1: 银灰's `attack.2` is his S3 mode, and 司霆惊蛰's banks are dotted.
 *
 * `modes` null (no local fx index, or an operator it does not list) keeps the old letter fallback exactly:
 * the activation sound's letter, else {@link SLOT_MODE_LETTER}.
 *
 * [ASSUMED] One bank per skill: the same rank as {@link pickModeBanks} (START before ON, plain before numbered,
 * then abilityOrder). A mode with several variants plays the first of that rank. `skills[].mode` (the mode
 * the skill switches to) wins over the mode's name, except a mode named exactly `S<n>` or `Sk<n>` that no skill
 * switches to: that uniform bank is skill n's, in place of a differently named link. The fx extract records the
 * link; nothing in the tables says the unlinked name is the swing that plays. 麦哲伦's three skills link to
 * `S1_Default` (no `_d/_h/_s` bank) while unclaimed `S1`/`S2`/`S3` each carry `p_atk_icecamera_h` and
 * `p_imp_icecamera_h`. 白铁 S2 links to `S1` while unclaimed `S2` carries `p_atk_elecdrill_h`. 归溟幽灵鲨 S1 links
 * to `Empty` while unclaimed `S1` carries `p_atk_sharpsaw_d` and `p_imp_sharpsaw_d`. A mode another skill already
 * links is not taken (水月 S3 owns the mode named S2). Any other name is used only when no skill switches to that
 * mode, and only onto a skill that itself switches to nothing and whose id is that skill number. A phase name fills
 * a skill whose own mode has no d/h/s bank; a name ending in End does not (that clip is not the attack). A skill
 * that does switch stays quiet rather than borrow a numbered mode's letter — except an unsuffixed bank, which is
 * not numbered to a skill mode, and except the exact `S<n>` case above. A record whose letter is a plain `_n` file
 * stays out of the skill table, except a numbered mode bank that plays a file the unit's normal attack (the bare
 * ability bank, or a numbered default `attack.0`) never does — 宴's S2 impact `p_imp_darksword_n` beside her normal
 * `p_imp_sword_n` is that mode's sound, while 银灰's S3 swing `p_atk_silver_n` (no plain swing bank to compare with)
 * still stays out. Judged per kind (swing / impact); without the local fx mode links nothing is assigned, as before.
 * Such a plain bank only fills a skill no lettered bank fills, and only for the skill's own mode, never as a phase
 * fill (PR #848 review, DESIGN §35.38).
 *
 * @param {Map<string,string[]>|undefined} banks unit bank table (indexAudio().unitBanks)
 * @param {{index:number, skillId?:string|null, mode?:number|null, start?:string|null}[]} skills planned skills
 * @param {{name?:string}[]|null} [modes] the operator's mode list, in order; null keeps the letter fallback
 * @param {Map<string, number|null>|null} [allLinks] every skill on the unit (including ones the plan does not ship)
 *   → the mode index it switches to. A mode such a skill claims is not given to another slot by name or by letter.
 * @returns {{attacks: Record<string, string[]>, hits: Record<string, string[]>}}
 */
export function assignSkillModeSfx(banks, skills, modes = null, allLinks = null) {
  const list = Array.isArray(skills) ? skills : [];
  const explicit = new Set();
  const reserved = new Set();
  if (Array.isArray(modes)) {
    for (const s of list) {
      if (Number.isInteger(s.mode) && s.mode >= 0 && s.mode < modes.length) explicit.add(s.index);
    }
    if (allLinks && typeof allLinks.values === 'function') {
      for (const mode of allLinks.values()) {
        if (Number.isInteger(mode) && mode >= 0 && mode < modes.length) reserved.add(mode);
      }
    }
    for (const s of list) if (explicit.has(s.index)) reserved.add(s.mode);
  }
  const owners = (modeIndex) => {
    if (!Array.isArray(modes) || !Number.isInteger(modeIndex) || modeIndex < 0 || modeIndex >= modes.length) return [];
    if (reserved.has(modeIndex)) return list.filter((s) => s.mode === modeIndex).map((s) => s.index);
    return skillIndicesFromModeName(modes[modeIndex]?.name, list, explicit);
  };
  const collect = (events) => {
    const found = [];
    if (!banks || !banks.size) return found;
    // The unit's normal-mode files of this kind: the bare ability banks (attack / combat) and a numbered default
    // (attack.0). They only tell a mode's own plain `_n` sound from the normal attack's same-suffix file.
    const normalFiles = new Set();
    for (const [name, paths] of banks) {
      const ev = events.find((e) => name.startsWith(e + '.'));
      if (!ev || !Array.isArray(paths) || !paths.length) continue;
      const ability = name.slice(ev.length + 1).split('.')[0];
      if (!/attack|combat/i.test(ability)) continue;
      const rest = name.slice(ev.length + 1 + ability.length);
      // mode 0's sub-abilities count too (仇白's `combat.0.1` stab plays in her S2 mode as well)
      if (rest === '' || /^\.0(?:\.\d+)*$/.test(rest)) for (const p of paths) normalFiles.add(p);
    }
    for (const [name, paths] of banks) {
      const ev = events.find((e) => name.startsWith(e + '.'));
      if (!ev || !Array.isArray(paths) || !paths.length) continue;
      const ability = name.slice(ev.length + 1).split('.')[0];
      if (!/attack|combat/i.test(ability)) continue;
      const rest = name.slice(ev.length + 1 + ability.length);
      const letter = skillModeLetter(paths[0]);
      const uniform = !!letter && paths.every((p) => skillModeLetter(p) === letter);
      const numbered = rest ? 1 : 0;
      const rank = `${events.indexOf(ev)}${numbered}`;
      let modeIndex = null;
      if (!rest) modeIndex = 0;
      else {
        const seg = rest.slice(1).split('.')[0];
        if (/^\d+$/.test(seg)) modeIndex = Number(seg);
      }
      // A numbered mode bank of plain `_n` files is that mode's sound when it plays a file the unit's normal attack
      // never does: 宴's S2 impact `p_imp_darksword_n` beside her normal `p_imp_sword_n`, 银灰's S2/S3 `p_imp_sword_n`
      // beside the Combat `p_imp_spear_n`. Judged per kind, so his S3 swing (no plain swing bank to compare with) stays
      // out, and the client's normal-attack gate is untouched.
      // Every file plain: a mixed bank (a plain first file, a lettered later one) stays skipped, as ASSETS.md says.
      const ownPlain = !uniform && paths.every((p) => !skillModeLetter(p)) && Number.isInteger(modeIndex) && modeIndex > 0
        && normalFiles.size > 0 && paths.some((p) => !normalFiles.has(p));
      if (!uniform && !ownPlain) continue;
      found.push({ rank, rest, paths, letter, modeIndex, bare: rest === '', plain: ownPlain });
    }
    return found;
  };
  // A lettered bank beats a plain one for the same skill: a plain mode bank only fills a skill no `_d` / `_h` / `_s`
  // bank does (假日威龙陈's START `p_atk_watergun_d_cast` never displaces her ON `p_atk_watergun_d`, PR #848 review).
  const best = (cands) => cands.slice().sort((a, b) => (a.plain !== b.plain ? (a.plain ? 1 : -1)
    : a.rank !== b.rank ? (a.rank < b.rank ? -1 : 1) : abilityOrder(a.rest, b.rest)))[0];
  const assignKind = (events) => {
    const bySkill = new Map();
    const phase = new Map();
    const unclaimed = [];
    for (const c of collect(events)) {
      const own = owners(c.modeIndex);
      if (own.length) {
        for (const i of own) {
          if (!bySkill.has(i)) bySkill.set(i, []);
          bySkill.get(i).push(c);
        }
        continue;
      }
      const reservedEmpty = Number.isInteger(c.modeIndex) && c.modeIndex >= 0 && c.modeIndex < (modes?.length || 0) && reserved.has(c.modeIndex);
      if (reservedEmpty) continue;
      const ph = Array.isArray(modes) && Number.isInteger(c.modeIndex) && c.modeIndex >= 0 && c.modeIndex < modes.length
        ? phaseOfModeName(modes[c.modeIndex]?.name) : null;
      if (ph && !ph.end) {
        // a plain bank speaks only for its own linked mode, never as a phase fill (乌尔比安's S3_Respawn_A swing is not
        // her S3 mode's sound, which is the normal `_n` file)
        if (c.plain) continue;
        if (!phase.has(ph.index)) phase.set(ph.index, []);
        phase.get(ph.index).push(c);
      } else unclaimed.push(c);
    }
    const chosen = new Map();
    const take = (i, cands) => { if (!chosen.has(i)) chosen.set(i, best(cands).paths); };
    for (const [i, cands] of bySkill) take(i, cands);
    // [ASSUMED] Exact `S<n>` / `Sk<n>` that nobody links: skill n plays it instead of a differently named link.
    // Reserved modes stay with the skill that links to them (水月 S3 owns the mode named S2).
    const namedSkill = new Map();
    const namedUsed = new Set();
    if (Array.isArray(modes)) {
      for (const c of unclaimed) {
        if (!Number.isInteger(c.modeIndex) || c.modeIndex < 0 || c.modeIndex >= modes.length) continue;
        if (reserved.has(c.modeIndex)) continue;
        const raw = String(modes[c.modeIndex]?.name || '').trim();
        const named = /^(?:sk|s)(\d+)$/i.exec(raw);
        if (!named) continue;
        const i = Number(named[1]) - 1;
        const row = list.find((s) => s.index === i);
        if (!row || !ownsSkillNumber(row.skillId, i)) continue;
        if (!namedSkill.has(i)) namedSkill.set(i, []);
        namedSkill.get(i).push(c);
        namedUsed.add(c);
      }
    }
    for (const [i, cands] of namedSkill) chosen.set(i, best(cands).paths);
    for (const [i, cands] of phase) {
      const row = list.find((s) => s.index === i);
      if (!row || chosen.has(i) || !explicit.has(i) || !ownsSkillNumber(row.skillId, i)) continue;
      take(i, cands);
    }
    const byLetter = new Map();
    for (const c of unclaimed) {
      if (namedUsed.has(c) || !c.letter) continue;   // a letterless (plain `_n`) bank belongs to a mode, never a fallback slot
      if (!byLetter.has(c.letter)) byLetter.set(c.letter, []);
      byLetter.get(c.letter).push(c);
    }
    const letterBest = {};
    const bareBest = {};
    for (const [letter, cands] of byLetter) {
      letterBest[letter] = best(cands);
      const bares = cands.filter((c) => c.bare);
      if (bares.length) bareBest[letter] = best(bares);
    }
    for (const s of list) {
      if (chosen.has(s.index)) continue;
      const letter = skillModeLetter(s.start) ?? SLOT_MODE_LETTER[s.index];
      const bank = letter ? (explicit.has(s.index) ? bareBest[letter] : letterBest[letter]) : null;
      if (bank) chosen.set(s.index, bank.paths);
    }
    // Same key order as the old slot loop: the plan's skill order, not bank order.
    const out = {};
    for (const s of list) if (chosen.has(s.index) && !Object.prototype.hasOwnProperty.call(out, String(s.index))) out[String(s.index)] = chosen.get(s.index);
    return out;
  };
  return {
    attacks: assignKind(['ON_ABILITY_START', 'ON_ABILITY_ON']),
    hits: assignKind(['ON_ABILITY_HIT']),
  };
}

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
  // operators: the plain ability of either event before any numbered variant, then the default mode's banks (attack.0,
  // attack.0.1 …) before any other number — firstMatching orders by depth, so 弑君者's S3 `attack.3` (p_imp_asndgrsmk) and S2
  // `attack.4` (p_atk_asndgrbm) outranked her normal `attack.0.1` / `attack.0.2` (p_*_asndgr_n) and rang on every normal
  // attack; 望 / 莱伊 / 灰毫 kept a skill's START swing over their mode-0 ON swing (the #848 merge review, DESIGN §35.38;
  // assignSkillModeSfx already counts every mode 0 bank as the normal attack)
  const mode0 = (event) => {
    if (!opts.operator) return null;
    const keys = [...banks.keys()].filter((k) => new RegExp(`^${event}\\.(attack|combat)\\.0(\\.\\d+)*$`).test(k)).sort(abilityOrder);
    for (const k of keys) if (banks.get(k)?.length && ok(banks.get(k))) return banks.get(k);
    return null;
  };
  const plain = opts.operator ? exact('ON_ABILITY_START') ?? exact('ON_ABILITY_ON') : null;
  const attack = plain ?? mode0('ON_ABILITY_START') ?? mode0('ON_ABILITY_ON')
    ?? firstMatching(banks, 'ON_ABILITY_START', ['attack', 'combat'], ok)
    ?? firstMatching(banks, 'ON_ABILITY_ON', ['attack', 'combat'], ok)
    ?? own(proj.born) ?? attackLike('ON_ABILITY_START') ?? attackLike('ON_ABILITY_ON');
  const hit = mode0('ON_ABILITY_HIT') ?? firstMatching(banks, 'ON_ABILITY_HIT', ['attack', 'combat'], ok) ?? own(proj.hit) ?? attackLike('ON_ABILITY_HIT');
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
/** Folder of the operators' own-language dubs (意大利语 / 俄文 / 西班牙语 / 中文-方言 …) under sound_beta_2. */
export const VOICE_CUSTOM_DIR = 'voice_custom';

/**
 * The own-language dub of each operator that has one: charword `voiceLangDict` entries whose language is of
 * `groupType` CUSTOM in `voiceLangTypeDict` (collab voices, LINKAGE, are not). The dub's folder under
 * VOICE_CUSTOM_DIR is its word key in lower case (`char_102_texas_ITA` → `char_102_texas_ita`; some dubs, e.g.
 * char_196_sunbr's 俄文, keep the base word key), holding the same `cn_nnn.mp3` file names as the base dubs.
 * @param {any} charword parsed excel/charword_table.json
 * @returns {Map<string, {dir:string, type:string}>} charId → its folder under VOICE_CUSTOM_DIR and the official
 *   voiceLangType (ITA / GER / RUS / FRE / SPA / CN_TOPOLECT …); the first CUSTOM dub when there are several
 */
export function nativeVoiceDirs(charword) {
  const types = charword?.voiceLangTypeDict;
  const out = new Map();
  if (!types || typeof types !== 'object') return out;
  for (const [charId, rec] of Object.entries(charword?.voiceLangDict || {})) {
    for (const [type, e] of Object.entries(rec?.dict || {})) {
      if (types[type]?.groupType !== 'CUSTOM' || out.has(charId)) continue;
      const wk = typeof e?.wordkey === 'string' ? e.wordkey : '';
      if (/^[a-z0-9_]+$/i.test(wk)) out.set(charId, { dir: wk.toLowerCase(), type });
    }
  }
  return out;
}

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
