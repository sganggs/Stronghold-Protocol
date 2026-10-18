// Group keys and the fx catalog fields this version's extractor writes.
// Source of truth: tools/local-extract/extract.py expected_local_groups() and fx.py,
// printed by `python3 tools/local-extract/extract.py --print-jobs` (no game client).
// test/setup-local-freshness.test.js fails when this copy drifts.
// DESIGN §34.3
//
// [ASSUMED] A full extract (no --only) writes exactly these local-assets group keys. A client
// that is missing one bundle still lacks that key, and setup asks for --local again. Extra
// keys left by an earlier --only merge are not stale. There is no canonical file count: it
// depends on the client. fx is opt-in (--only fx) and is not one of these keys.
export const EXPECTED_LOCAL_GROUPS = Object.freeze([
  "emoticon/basic",
  "emoticon/basic_2",
  "emoticon/foolamiya",
  "emoticon/fooldoctor",
  "emoticon/foolwisdel",
  "emoticon/slug",
  "guide",
  "map/autochess",
  "map/autochesssand",
  "map/common",
  "map/fx",
  "map/water",
  "mesh/map_autochess_bkg",
  "mesh/s_background_common",
  "mesh/s_common_box_01",
  "mesh/s_wind_device",
  "mesh/trap_110",
  "module",
  "projectiles",
  "scene/act1autochess_m01",
  "scene/act1autochess_m02",
  "scene/act1autochess_m03",
  "scene/act1autochess_m04",
  "scene/act1autochess_m05",
  "scene/act1autochess_m06",
  "scene/act1autochess_m07",
  "scene/act2autochess_m01",
  "scene/act2autochess_m02",
  "scene/act2autochess_m03",
  "scene/act2autochess_m04",
  "scene/tex",
  "spine/enemy/enemy_1305_mhslim",
  "spine/enemy/enemy_1305_mhslim_2",
  "spine/token/token_10002_kalts_mon3tr",
  "spine/token/token_10003_cgbird_bird",
  "spine/token/token_10005_mgllan_drone1",
  "spine/token/token_10005_mgllan_drone2",
  "spine/token/token_10005_mgllan_drone3",
  "spine/token/token_10007_phatom_twin",
  "spine/token/token_10008_cqbw_box",
  "spine/token/token_10009_weedy_cannon",
  "spine/token/token_10020_ling_soul1",
  "spine/token/token_10020_ling_soul2",
  "spine/token/token_10020_ling_soul3",
  "spine/token/token_10024_ebnhlz_rcube",
  "spine/token/token_10025_doroth_recttp",
  "spine/token/token_10026_bgsnow_subbow",
  "spine/token/token_10027_ironmn_pile1",
  "spine/token/token_10027_ironmn_pile2",
  "spine/token/token_10027_ironmn_pile3",
  "spine/token/token_10029_slent2_protrb",
  "spine/token/token_10031_swire2_gdtrap",
  "spine/token/token_10032_jesca2_jckshd",
  "spine/token/token_10034_ray_sndbst",
  "spine/token/token_10035_wisdel_wward",
  "spine/token/token_10041_cathy_catsld",
  "spine/token/token_10043_necras_skeltn",
  "spine/token/token_10050_monstr_prosts",
  "spine/token/token_10051_radian_tower1",
  "spine/token/token_10052_radian_tower2",
  "spine/token/token_10053_radian_tower3",
  "spine/token/token_10054_phatm2_encdool",
  "spine/token/token_10057_svash2_eagle1",
  "spine/token/token_10057_svash2_eagle2",
  "spine/token/token_10057_svash2_eagle3",
  "spine/token/token_10059_nasti_nstdef",
  "spine/token/token_10060_nasti_nstchr",
  "spine/token/token_10061_nasti_nstbld",
  "spine/token/token_10064_wang_stone1",
  "spine/token/token_10066_closur_ourbase",
  "spine/token/token_10068_kalts2_mtship",
  "spine/token/token_10069_mcnist_mcgraf",
  "spine/token/token_10070_aphris_pc",
  "ui/battle",
  "ui/common",
  "ui/outer",
]);

// Manifest `scene` record version (kind Scene on each scene/<stageId> group). scene.json's mesh version stays 1.
// An extracted record whose version is not this one is stale: setup asks once (DESIGN §34.12).
// 4 removes exact redundant scene renderers (#684); older extracts still contain the source duplicates.
// [ASSUMED] A group with no kind:Scene record is not a version problem (the group-key check still applies).
export const EXPECTED_SCENE = Object.freeze({
  version: 4,
});

export const EXPECTED_FX = Object.freeze({
  groups: Object.freeze(["fx", "fx/prefabs", "fx/tex", "fx/mesh"]),
  manifestVersion: 1,
  formatVersion: 1,
  indexVersion: 3,
  meshVersion: 2,
});
