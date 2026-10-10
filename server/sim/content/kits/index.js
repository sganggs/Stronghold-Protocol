// server/sim/content/kits/index.js — the operator kit registry (DESIGN §7, docs/SIM.md §7.2): baseChessId →
// (bb, chess, def) => Kit. One file per kit in ops/ (README.md: what a kit file holds, naming, registration, tests).
//
// KIT_FILES lists every kit file, grouped by tier — the former kits/tier1.js … tier6.js, each group in that file's
// order — so the merged registry keeps the key order it always had (content/index.js resolves kits by id; the tier
// shims, tools/kit-coverage.mjs and the golden corpus see the same registry as before). A new kit file is appended to
// its tier's group.
// Each file is loaded with a guarded dynamic import, so this runs unchanged in the browser (/sim/, no Node-only
// module, no directory listing): a file that fails to load (syntax error, throwing top-level code, missing file) is
// logged and skipped — its chess falls back to the generic kit — instead of breaking the server or the page.
//
// 补位 stand-in kits (DATA.md §18): STANDIN_KIT_FILES lists `ops/standin-<codename>.js`, one per stand-in character
// (codename = its charId without `char_<n>_`: `standin-acguad.js` = Sharp, char_609_acguad); each registers exactly one
// key, that charId. A stand-in keeps the ids of the chess it replaces, so content/index.js kitOf finds its kit by
// `def.charId` only, never by the chess id (the replaced operator's kit). STANDIN_KITS is merged into KITS after every
// tier group: the chess keys keep their order, and `char_…` keys never meet `chess_char_…` ones.
//
// 自选 operator kits (DATA.md §18, README.md "How to add an operator (自选)"): OPERATOR_KIT_FILES lists
// `ops/op-<codename>.js`, one per owned-6★ pick of data/backups.json `diy.ownedPool` (codename = its charId without
// `char_<n>_`: `op-siege.js` = 推进之王, char_112_siege), each registering exactly that charId and writing every skill under
// `skills`. A 自选 piece keeps its DIY slot's ids, so kitOf finds its kit by `def.charId` — a prototype pick runs its
// stand-in kit, a 4★ reserve the generic kit (GENERIC_KIT_CHARS). OPERATOR_KITS is merged after the stand-ins.
// KITTED_CHARS = every character a 自选 pick may field with a faithful kit; an operator outside it is not offered
// (shared/diy.js diyPool / validateDiyPicks `kitted`).

export const KIT_FILES = Object.freeze([
  // tier 1
  ['chess_char_1_01-inside.js', 'chess_char_1_02-yak.js', 'chess_char_1_03-leizi.js', 'chess_char_1_04-udflow.js',
    'chess_char_1_05-vigna.js', 'chess_char_1_06-vendla.js', 'chess_char_1_07-prove.js', 'chess_char_1_08-texas.js',
    'chess_char_1_09-caper.js', 'chess_char_1_10-sunbr.js', 'chess_char_1_11-skgoat.js', 'chess_char_1_12-estell.js',
    'chess_char_1_13-podego.js', 'chess_char_1_14-greyy.js', 'chess_char_1_16-tinman.js', 'chess_char_1_17-indigo.js',
    'chess_char_1_18-utage.js', 'chess_char_1_19-wildmn.js', 'chess_char_1_20-liskam.js'],
  // tier 2
  ['chess_char_2_01-excu.js', 'chess_char_2_02-silent.js', 'chess_char_2_03-slchan.js', 'chess_char_2_04-grabds.js',
    'chess_char_2_05-harold.js', 'chess_char_2_06-papyrs.js', 'chess_char_2_07-ghost.js', 'chess_char_2_08-bubble.js',
    'chess_char_2_09-humus.js', 'chess_char_2_10-rockr.js', 'chess_char_2_11-kazema.js', 'chess_char_2_12-gravel.js',
    'chess_char_2_13-tippi.js', 'chess_char_2_14-flower.js', 'chess_char_2_15-akkord.js', 'chess_char_2_16-whitew.js',
    'chess_char_2_17-branch.js', 'chess_char_2_18-ashlok.js', 'chess_char_2_19-tinman.js'],
  // tier 3
  ['chess_char_3_01-angel.js', 'chess_char_3_02-ayer.js', 'chess_char_3_03-swire.js', 'chess_char_3_04-swire2.js',
    'chess_char_3_05-skadi.js', 'chess_char_3_06-philae.js', 'chess_char_3_07-forcer.js', 'chess_char_3_08-mint.js',
    'chess_char_3_09-haini.js', 'chess_char_3_10-pinecn.js', 'chess_char_3_11-snhunt.js', 'chess_char_3_12-blemsh.js',
    'chess_char_3_13-malist.js', 'chess_char_3_14-slbell.js', 'chess_char_3_15-vodfox.js', 'chess_char_3_16-snakek.js',
    'chess_char_3_17-shotst.js', 'chess_char_3_18-vulpis.js', 'chess_char_3_19-vigil.js', 'chess_char_3_20-kjera.js',
    'chess_char_3_21-archet.js'],
  // tier 4
  ['chess_char_4_01-rmixer.js', 'chess_char_4_02-mostma.js', 'chess_char_4_03-kjera.js', 'chess_char_4_04-ines.js',
    'chess_char_4_05-beewax.js', 'chess_char_4_06-kroos2.js', 'chess_char_4_07-bpipe.js', 'chess_char_4_08-rosesa.js',
    'chess_char_4_09-mizuki.js', 'chess_char_4_10-aroma.js', 'chess_char_4_11-cathy.js', 'chess_char_4_12-glady.js',
    'chess_char_4_13-gnosis.js', 'chess_char_4_14-lionhd.js', 'chess_char_4_15-reckpr.js', 'chess_char_4_16-texas2.js',
    'chess_char_4_17-hsguma.js', 'chess_char_4_18-mudrok.js', 'chess_char_4_19-flamtl.js', 'chess_char_4_20-fartth.js',
    'chess_char_4_21-plosis.js', 'chess_char_4_22-svrash.js', 'chess_char_4_23-gvial2.js', 'chess_char_4_24-billro.js',
    'chess_char_4_25-cetsyr.js', 'chess_char_4_26-bldsk.js'],
  // tier 5
  ['chess_char_5_01-excu2.js', 'chess_char_5_02-titi.js', 'chess_char_5_03-blaze2.js', 'chess_char_5_04-bldsk.js',
    'chess_char_5_05-ulpia.js', 'chess_char_5_06-etlchi.js', 'chess_char_5_07-surtr.js', 'chess_char_5_08-horn.js',
    'chess_char_5_09-cetsyr.js', 'chess_char_5_10-lisa.js', 'chess_char_5_11-demkni.js', 'chess_char_5_12-dusk.js',
    'chess_char_5_13-ghost2.js', 'chess_char_5_14-svash2.js', 'chess_char_5_15-thorn2.js', 'chess_char_5_16-plosis.js',
    'chess_char_5_17-f12yin.js', 'chess_char_5_18-gvial2.js', 'chess_char_5_19-mlynar.js', 'chess_char_5_20-aglina.js',
    'chess_char_5_21-sntlla.js', 'chess_char_5_22-nymph.js', 'chess_char_5_23-reckpr.js'],
  // tier 6 (and 盟约·辅助干员 chess_char_1_15, a hidden tier-1 chess always registered with the tier-6 kits)
  ['chess_char_1_15-pithst.js', 'chess_char_6_01-lemuen.js', 'chess_char_6_02-sbell2.js', 'chess_char_6_03-yu.js',
    'chess_char_6_04-skadi2.js', 'chess_char_6_05-pasngr.js', 'chess_char_6_06-pepe.js', 'chess_char_6_07-siege2.js',
    'chess_char_6_08-reed2.js', 'chess_char_6_09-cello.js', 'chess_char_6_10-nymph.js', 'chess_char_6_11-mlyss.js',
    'chess_char_6_12-rosmon.js', 'chess_char_6_13-angel2.js', 'chess_char_6_14-lumen.js', 'chess_char_6_15-qiubai.js',
    'chess_char_6_16-halo2.js', 'chess_char_6_17-nearl2.js', 'chess_char_6_18-whitw2.js', 'chess_char_6_19-blkkgt.js',
    'chess_char_6_20-agoat2.js'],
].map((group) => Object.freeze(group)));

/**
 * The 补位 stand-in kit files (`ops/standin-<codename>.js`, registry key = the stand-in's charId; a new file is appended).
 * A stand-in without a file fights with the generic kit (content/generic.js) plus its unconditional stat talents
 * (genericTalents) — the eight 预备干员 need no file.
 */
export const STANDIN_KIT_FILES = Object.freeze(['standin-acguad.js', 'standin-sharp2.js', 'standin-acspec.js', 'standin-acmedc.js', 'standin-acfend.js', 'standin-acpion.js', 'standin-acnipe.js', 'standin-accast.js', 'standin-acsupo.js']);

/**
 * The 自选 operator kit files (`ops/op-<codename>.js`, registry key = the operator's charId, an owned-6★ pick of
 * data/backups.json; a new file is appended). An operator without a file is not offered as a 自选 pick (KITTED_CHARS).
 */
export const OPERATOR_KIT_FILES = Object.freeze([
  'op-siege.js',
  'op-chen.js',
  'op-irene.js',
  'op-helage.js',
  'op-shining.js',
  'op-cgbird.js',
  'op-saga.js',
  'op-amgoat.js',
  'op-cerber.js',
  'op-heyak.js',
  'op-poca.js',
  'op-typhon.js',
  'op-narant.js',
  'op-logos.js',
  'op-mantra.js',
  'op-veen.js',
  'op-zuole.js',
  'op-chyue.js',
  'op-huang.js',
  'op-shwaz.js',
  'op-bgsnow.js',
  'op-ifrit.js',
  'op-aphris.js',
  'op-lin.js',
  'op-nian.js',
  'op-hsgma2.js',
  'op-thumpy.js',
  'op-zumama.js',
  'op-judge.js',
  'op-shu.js',
  'op-pallas.js',
  'op-lessng.js',
  'op-demetr.js',
  'op-cqbw.js',
  'op-phenxi.js',
  'op-wisdel.js',
  'op-thorns.js',
  'op-chen3.js',
  'op-leizi2.js',
  'op-vvana.js',
  'op-headb2.js',
  'op-hodrer.js',
  'op-chen2.js',
  'op-ray.js',
  'op-ascln.js',
  'op-jesca2.js',
  'op-mcnist.js',
  'op-kalts.js',
  'op-sleach.js',
  'op-closur.js',
  'op-gdglow.js',
  'op-haak.js',
  'op-phatom.js',
  'op-crosly.js',
  'op-lmlee.js',
  'op-weedy.js',
  'op-wang.js',
  'op-doroth.js',
  'op-aglna2.js',
  'op-ebnhlz.js',
  'op-mgllan.js',
  'op-ling.js',
  'op-radian.js',
  'op-slent2.js',
  'op-haruka.js',
  'op-phatm2.js',
  'op-ironmn.js',
  'op-nasti.js',
  'op-necras.js',
  'op-kalts2.js',
  'op-monstr.js',
  'op-clemnt.js',
]);

/**
 * The 预备干员 whose every skill the generic kit covers exactly (冲锋号令, 攻击力 / 防御力 / 治疗强化, 战术咏唱, 一击即退 —
 * test/content/standin.test.js): fielded with no kit file, as 补位 stand-ins and as tier-5 自选 picks.
 */
export const GENERIC_KIT_CHARS = Object.freeze(['char_600_cpione', 'char_601_cguard', 'char_602_cdfend', 'char_603_csnipe',
  'char_604_ccast', 'char_605_cmedic', 'char_606_csuppo', 'char_607_cspec']);

async function loadKitFile(file) {
  try {
    return await import(`./ops/${file}`);
  } catch (e) {
    console.error(`[content] failed to load kits/ops/${file}: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
    return {};
  }
}

const MODULES = await Promise.all(KIT_FILES.map((group) => Promise.all(group.map(loadKitFile))));
const STANDIN_MODULES = await Promise.all(STANDIN_KIT_FILES.map(loadKitFile));
const OPERATOR_MODULES = await Promise.all(OPERATOR_KIT_FILES.map(loadKitFile));
const registryOf = (m) => (m && m.default && typeof m.default === 'object' ? m.default : {});

/** The registry of each tier group (index 0 = tier 1): baseChessId → kit builder, in KIT_FILES order. */
export const TIER_KITS = Object.freeze(MODULES.map((group) => Object.assign({}, ...group.map(registryOf))));

/** The 补位 stand-in kits: stand-in charId → kit builder, in STANDIN_KIT_FILES order. */
export const STANDIN_KITS = Object.freeze(Object.assign({}, ...STANDIN_MODULES.map(registryOf)));

/** The 自选 operator kits: owned-6★ charId → kit builder, in OPERATOR_KIT_FILES order. */
export const OPERATOR_KITS = Object.freeze(Object.assign({}, ...OPERATOR_MODULES.map(registryOf)));

/**
 * The merged kit registry: baseChessId → (bb, chess, def) => Kit, tier 1 … tier 6, then the stand-ins' charIds, then
 * the 自选 operators' charIds.
 */
export const KITS = Object.freeze(Object.assign({}, ...TIER_KITS, STANDIN_KITS, OPERATOR_KITS));

/**
 * Every character a 自选 pick may field with a faithful kit: the 预备干员 (GENERIC_KIT_CHARS), the stand-ins with a kit
 * file and the operators of OPERATOR_KIT_FILES whose file loaded. The `kitted` option of shared/diy.js diyPool /
 * validateDiyPicks.
 */
export const KITTED_CHARS = Object.freeze([...new Set([...GENERIC_KIT_CHARS, ...Object.keys(STANDIN_KITS), ...Object.keys(OPERATOR_KITS)])]);
