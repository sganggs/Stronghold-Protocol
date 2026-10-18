// shared/plugins/rules.js — the four gameplay rule switches a content / script / trusted plugin may declare
// (DESIGN §34.15). One table is the only source of the names, options and the Chinese phrases the room shows.
// No Node API: the manifest, the content set, the match, the battle sim and the client all import it.
//
// An absent `rules` key is not a declaration. Vanilla and every existing plugin stay byte-identical.
// A declared switch, even when it names the default option, enters the content set and its hash.
// Defaults are never filled in for a switch the plugin did not write.
//
// [ASSUMED] An empty `rules: {}` is accepted and treated as absent.
// [ASSUMED] A Forge pack that names the same switch twice keeps the first option. A later different option is
// skipped with a reason (our importer does not reject the whole pack; Forge's own loader would).
// A second 变形同构体 on one operator is refused; [ASSUMED] the refusal code is BAD_TARGET.
// [ASSUMED] Under morphPairing plus, a replaceUid that is missing or names the morph replaces the leftmost
// occupying item. The official policy object is a frozen singleton whose numbers match today's equip code.
// [ASSUMED] unequip treats only the visible temporary window (TEMP_SIZE) as free. A hidden overflow slot is not
// a place an unequip may use, and the action never calls stow (stow would append instead of returning HAND_FULL).

import { problem } from './dataUtils.js';
import { N_ } from '../i18n.js';

/** @typedef {'shopBias'|'prepLoadout'|'morphPairing'|'unequip'} RuleName */

/**
 * Closed switches. `options[0]` is the default (today's behaviour). `phrase` is the Chinese line shown for a
 * non-default option (the client translates it). Declaration order is the order of the room's rule line.
 */
export const RULE_SWITCHES = Object.freeze({
  shopBias: Object.freeze({
    options: Object.freeze(['official', 'bondBias']),
    phrase: Object.freeze({ bondBias: N_('商店装备偏向已激活盟约') }),
  }),
  prepLoadout: Object.freeze({
    options: Object.freeze(['locked', 'prep']),
    phrase: Object.freeze({ prep: N_('休整期可调整技能与模组') }),
  }),
  morphPairing: Object.freeze({
    options: Object.freeze(['official', 'plus']),
    phrase: Object.freeze({ plus: N_('变形同构体不占格，仅配对最左盟约装备') }),
  }),
  unequip: Object.freeze({
    options: Object.freeze(['official', 'allow']),
    phrase: Object.freeze({ allow: N_('可以卸下装备') }),
  }),
});

/** Switch names in display and composition order. */
export const RULE_NAMES = Object.freeze(/** @type {readonly RuleName[]} */ (Object.keys(RULE_SWITCHES)));

/** [ASSUMED] Other gameplay classes inherit content rules under their normal gates; cosmetic/lang/ui cannot. */
export const GAMEPLAY_RULE_CLASSES = Object.freeze(['content', 'script', 'trusted']);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** @param {string} name @param {unknown} option */
function isOption(name, option) {
  const spec = own(RULE_SWITCHES, name) ? RULE_SWITCHES[name] : null;
  return !!spec && typeof option === 'string' && spec.options.includes(option);
}

/**
 * The option in force. An absent rules object, an absent switch, or an unknown value is the default.
 * @param {Record<string, string>|null|undefined} rules
 * @param {string} name
 * @returns {string}
 */
export function ruleOption(rules, name) {
  const spec = own(RULE_SWITCHES, name) ? RULE_SWITCHES[name] : null;
  if (!spec) return '';
  const v = isObj(rules) ? rules[name] : undefined;
  return typeof v === 'string' && spec.options.includes(v) ? v : spec.options[0];
}

/**
 * Chinese phrases of the non-default options, in switch order. The client wraps each in t() and joins them.
 * @param {Record<string, string>|null|undefined} rules
 * @returns {string[]}
 */
export function rulePhrases(rules) {
  const out = [];
  for (const name of RULE_NAMES) {
    const option = ruleOption(rules, name);
    const phrase = RULE_SWITCHES[name].phrase[option];
    if (phrase) out.push(phrase);
  }
  return out;
}

/**
 * Read a manifest's `rules`. Loud PLUGIN_RULES on a bad shape, an unknown switch or option, or a class that
 * may not declare rules. Returns the declared switches only, or undefined when the key is absent or empty.
 * @param {unknown} raw
 * @param {{ problem: (code: string, text: string, extra?: object) => void }} list
 * @param {string} cls
 * @returns {Record<string, string>|undefined}
 */
export function readDeclaredRules(raw, list, cls) {
  if (raw === undefined) return undefined;
  const bad = (message) => {
    list.problem('PLUGIN_RULES', message, { at: ['rules'] });
    return undefined;
  };
  if (!isObj(raw)) return bad('"rules" is not an object');
  if (!GAMEPLAY_RULE_CLASSES.includes(cls)) return bad(`"rules" belongs to a gameplay plugin, not a ${cls} one`);
  for (const name of Object.keys(raw)) {
    if (!own(RULE_SWITCHES, name)) return bad(`unknown rule switch ${JSON.stringify(String(name).slice(0, 40))}`);
    if (!isOption(name, raw[name])) return bad(`"${name}" must be one of ${RULE_SWITCHES[name].options.join(', ')}`);
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of RULE_NAMES) if (own(raw, name)) out[name] = raw[name];
  return Object.keys(out).length ? out : undefined;
}

/**
 * Forge `behaviour: [{ switch, option? }]` → our `rules`. An omitted option declares that switch's default
 * (WORKSHOP §1.22–§1.23); explicit invalid values are still skipped. Unknown switches/options get a reason.
 * Does not throw and does not reject the pack. null / undefined → no rules.
 * @param {unknown} raw
 * @returns {{ rules: Record<string, string>|null, skipped: { path: string, zh: string, en: string }[] }}
 */
export function readForgeBehaviour(raw) {
  if (raw == null) return { rules: null, skipped: [] };
  /** @type {{ path: string, zh: string, en: string }[]} */
  const skipped = [];
  if (!Array.isArray(raw)) {
    skipped.push({
      path: 'pack.json:behaviour',
      zh: 'behaviour 不是列表，没有导入。', // i18n-ignore: forge import report, already bilingual
      en: 'behaviour is not a list, so it was not imported.',
    });
    return { rules: null, skipped };
  }
  /** @type {Record<string, string>} */
  const rules = {};
  raw.forEach((entry, i) => {
    const at = `pack.json:behaviour[${i}]`;
    if (!isObj(entry)) {
      skipped.push({ path: at, zh: '这条行为声明不是对象，跳过。', en: 'This behaviour entry is not an object, so it was skipped.' }); // i18n-ignore: forge import report, already bilingual
      return;
    }
    const name = entry.switch;
    if (typeof name !== 'string' || !own(RULE_SWITCHES, name)) {
      const shown = String(name ?? '').slice(0, 40);
      skipped.push({
        path: at,
        zh: `不认识的开关「${shown}」，跳过。`, // i18n-ignore: forge import report, already bilingual
        en: `Unknown switch "${shown}", skipped.`,
      });
      return;
    }
    const option = own(entry, 'option') ? entry.option : RULE_SWITCHES[name].options[0];
    if (!isOption(name, option)) {
      const shown = String(option ?? '').slice(0, 40);
      skipped.push({
        path: at,
        zh: `开关「${name}」没有选项「${shown}」，跳过。`, // i18n-ignore: forge import report, already bilingual
        en: `Switch "${name}" has no option "${shown}", skipped.`,
      });
      return;
    }
    if (own(rules, name)) {
      // [ASSUMED] the first declaration wins. A repeated different option is reported and dropped.
      if (rules[name] !== option) {
        skipped.push({
          path: at,
          zh: `开关「${name}」重复且选项不同，保留先写的「${rules[name]}」。`, // i18n-ignore: forge import report, already bilingual
          en: `Switch "${name}" is repeated with a different option; the first ("${rules[name]}") is kept.`,
        });
      }
      return;
    }
    rules[name] = option;
  });
  return { rules: Object.keys(rules).length ? rules : null, skipped };
}

/**
 * Compose declared rules in load order. The same option twice is fine (the first plugin id is kept).
 * Two different options of one switch are PLUGIN_RULE_CONFLICT, naming both plugin ids and the switch.
 * @param {Array<{ id?: string, rules?: Record<string, string>|null|undefined }>|null|undefined} entries
 * @returns {{ problems: { code: string, path: string, message: string }[], rules: Record<string, string>|null }}
 */
export function composeRules(entries) {
  /** @type {{ code: string, path: string, message: string }[]} */
  const problems = [];
  /** @type {Record<string, string>} */
  const rules = {};
  /** @type {Record<string, string>} */
  const owners = {};
  for (const e of entries || []) {
    const declared = e?.rules;
    if (!isObj(declared)) continue;
    for (const name of RULE_NAMES) {
      if (!own(declared, name) || !isOption(name, declared[name])) continue;
      const option = declared[name];
      if (!own(rules, name)) {
        rules[name] = option;
        owners[name] = String(e.id || '');
        continue;
      }
      if (rules[name] !== option) {
        problems.push(problem('PLUGIN_RULE_CONFLICT', name, `${owners[name]} and ${e.id} set ${name} to different options`));
      }
    }
  }
  return { problems, rules: problems.length || !Object.keys(rules).length ? null : rules };
}

/**
 * Bonds a 变形同构体 pairing grants.
 * official: fewer than two items grants nothing; a canGiveBond item must be present; every other item's
 * giveBondId grants (when bondOk says the bond exists — the client passes a bondOk that always accepts).
 * plus: one item is enough, a canGiveBond item must still be present, and only the leftmost giveBondId grants.
 * @param {Array<string|{id?: string}>|null|undefined} items
 * @param {(id: string) => any} getItem
 * @param {{ mode?: string, bondOk?: (id: string) => boolean }} [opts]
 * @returns {string[]}
 */
export function grantedBondsByMorph(items, getItem, { mode = 'official', bondOk = () => true } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (mode !== 'plus' && list.length < 2) return [];
  const recs = [];
  for (const it of list) {
    const id = typeof it === 'string' ? it : it && it.id;
    if (typeof id !== 'string') continue;
    const rec = getItem(id);
    if (rec && typeof rec === 'object') recs.push(rec);
  }
  if (!recs.some((r) => r.canGiveBond)) return [];
  const out = [];
  for (const r of recs) {
    if (r.canGiveBond) continue;
    const id = r.giveBondId;
    if (typeof id === 'string' && id && bondOk(id) && !out.includes(id)) {
      out.push(id);
      if (mode === 'plus') break;
    }
  }
  return out;
}

/**
 * Official equip-slot arithmetic, frozen and shared. slotsUsed is items.length, slotCap is equipPerChess,
 * occupies and accepts are always true, and a missing replaceUid (or one that is not equipped) is index 0.
 * Callers must use this object on the official path so the comparison and the splice index stay today's numbers.
 */
export const OFFICIAL_SLOT_POLICY = Object.freeze({
  slotsUsed(items) {
    return Array.isArray(items) ? items.length : 0;
  },
  slotCap(equipPerChess) {
    return equipPerChess;
  },
  occupies() {
    return true;
  },
  accepts() {
    return true;
  },
  replacedIndex(items, replaceUid) {
    if (!Array.isArray(items) || replaceUid == null) return 0;
    const i = items.findIndex((x) => x && x.uid === replaceUid);
    return i >= 0 ? i : 0;
  },
});

const isMorphRec = (rec, isMorph) => {
  if (!rec) return false;
  if (typeof rec === 'object' && rec.canGiveBond) return true;
  return !!isMorph(rec);
};

/**
 * Slot policy for morphPairing. Anything other than 'plus' returns the official singleton itself.
 * plus: a morph (canGiveBond) does not occupy a slot, a second morph is refused, and a real item that
 * does not fit replaces the leftmost occupying item (never the morph).
 * @param {string|null|undefined} mode
 * @param {(item: any) => boolean} [isMorph] true when an equipped piece (not a record) is a morph
 */
export function morphSlotPolicy(mode, isMorph = () => false) {
  if (mode !== 'plus') return OFFICIAL_SLOT_POLICY;
  const morph = (it) => isMorphRec(it, isMorph);
  return {
    slotsUsed(items) {
      const list = Array.isArray(items) ? items : [];
      let n = 0;
      for (const it of list) if (!morph(it)) n++;
      return n;
    },
    slotCap(equipPerChess) {
      return equipPerChess;
    },
    occupies(rec) {
      return !morph(rec);
    },
    accepts(items, rec) {
      if (!morph(rec)) return true;
      const list = Array.isArray(items) ? items : [];
      for (const it of list) if (morph(it)) return false;
      return true;
    },
    replacedIndex(items, replaceUid) {
      const list = Array.isArray(items) ? items : [];
      let first = -1;
      for (let i = 0; i < list.length; i++) {
        if (morph(list[i])) continue;
        if (first < 0) first = i;
        if (replaceUid != null && list[i] && list[i].uid === replaceUid) return i;
      }
      return first >= 0 ? first : 0;
    },
  };
}

/** Battle / spec field. Omitted unless the room's morphPairing is plus, so an official spec grows no key. */
export function morphBattleOpt(rules) {
  return ruleOption(rules, 'morphPairing') === 'plus' ? { morphPairing: 'plus' } : {};
}
