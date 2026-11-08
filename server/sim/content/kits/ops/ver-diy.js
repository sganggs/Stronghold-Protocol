// server/sim/content/kits/ops/ver-diy.js — 自选 picks whose only hand-written kit is a tier kit
// (第一期's 24, 银灰 / 空弦 / 卡涅利安 / 伺夜 again in 第二期上半, and 规程·序列Ⅰ's 10). Each charId borrows that tier
// kit (shared/borrow.js, DESIGN §35.22.9). Shop chess of the same operator still resolve to the tier key. 妮芙 uses
// only the tier-5 file (chess_char_5_22): the tier-6 file is the same operator's other shop row, not a second skill
// author. 百炼嘉维尔 lists both rows: S2 is the tier-5 spec, S3 the tier-4 `.skill`, S1 the tier-4 alt entry.
// 规程's 10 each have one tier file, and it authors all three skills (the shop skill on `.skill`, the other two under
// `skills`). None of those skills falls back to the generic spec.

import { borrowTierKits } from '../shared/borrow.js';
import hsguma from './chess_char_4_17-hsguma.js';
import svrash from './chess_char_4_22-svrash.js';
import mostma from './chess_char_4_02-mostma.js';
import cello from './chess_char_6_09-cello.js';
import aglina from './chess_char_5_20-aglina.js';
import archet from './chess_char_3_21-archet.js';
import rosmon from './chess_char_6_12-rosmon.js';
import flamtl from './chess_char_4_19-flamtl.js';
import blemsh from './chess_char_3_12-blemsh.js';
import billro from './chess_char_4_24-billro.js';
import vigil from './chess_char_3_19-vigil.js';
import fartth from './chess_char_4_20-fartth.js';
import nearl2 from './chess_char_6_17-nearl2.js';
import reed2 from './chess_char_6_08-reed2.js';
import gvial2t4 from './chess_char_4_23-gvial2.js';
import gvial2t5 from './chess_char_5_18-gvial2.js';
import whitw2 from './chess_char_6_18-whitw2.js';
import svash2 from './chess_char_5_14-svash2.js';
import sbell2 from './chess_char_6_02-sbell2.js';
import halo2 from './chess_char_6_16-halo2.js';
import dusk from './chess_char_5_12-dusk.js';
import etlchi from './chess_char_5_06-etlchi.js';
import horn from './chess_char_5_08-horn.js';
import mlynar from './chess_char_5_19-mlynar.js';
import qiubai from './chess_char_6_15-qiubai.js';
import nymph from './chess_char_5_22-nymph.js';
import angel from './chess_char_3_01-angel.js';
import bpipe from './chess_char_4_07-bpipe.js';
import mudrok from './chess_char_4_18-mudrok.js';
import texas2 from './chess_char_4_16-texas2.js';
import excu2 from './chess_char_5_01-excu2.js';
import swire2 from './chess_char_3_04-swire2.js';
import angel2 from './chess_char_6_13-angel2.js';
import titi from './chess_char_5_02-titi.js';
import ines from './chess_char_4_04-ines.js';
import rmixer from './chess_char_4_01-rmixer.js';

function part(mod, key, skillId, tier) {
  const builder = mod[key];
  if (typeof builder !== 'function') throw new Error(`ver-diy: ${key} is not a kit builder`);
  return { builder, skillId, tier };
}

const borrow = (mod, key, skillId, tier) => borrowTierKits([part(mod, key, skillId, tier)]);

export default {
  char_136_hsguma: borrow(hsguma, 'chess_char_4_17_a', 'skchr_hsguma_2', 4), // 星熊
  char_172_svrash: borrow(svrash, 'chess_char_4_22_a', 'skchr_svrash_3', 4), // 银灰
  char_213_mostma: borrow(mostma, 'chess_char_4_02_a', 'skchr_mostma_3', 4), // 莫斯提马
  char_245_cello: borrow(cello, 'chess_char_6_09_a', 'skchr_cello_1', 6), // 塑心
  char_291_aglina: borrow(aglina, 'chess_char_5_20_a', 'skchr_aglina_3', 5), // 安洁莉娜
  char_332_archet: borrow(archet, 'chess_char_3_21_a', 'skchr_archet_3', 3), // 空弦
  char_391_rosmon: borrow(rosmon, 'chess_char_6_12_a', 'skchr_rosmon_2', 6), // 迷迭香
  char_420_flamtl: borrow(flamtl, 'chess_char_4_19_a', 'skchr_flamtl_3', 4), // 焰尾
  char_423_blemsh: borrow(blemsh, 'chess_char_3_12_a', 'skchr_blemsh_3', 3), // 瑕光
  char_426_billro: borrow(billro, 'chess_char_4_24_a', 'skchr_billro_2', 4), // 卡涅利安
  char_427_vigil: borrow(vigil, 'chess_char_3_19_a', 'skchr_vigil_3', 3), // 伺夜
  char_430_fartth: borrow(fartth, 'chess_char_4_20_a', 'skchr_fartth_3', 4), // 远牙
  char_1014_nearl2: borrow(nearl2, 'chess_char_6_17_a', 'skchr_nearl2_3', 6), // 耀骑士临光
  char_1020_reed2: borrow(reed2, 'chess_char_6_08_a', 'skchr_reed2_3', 6), // 焰影苇草
  char_1026_gvial2: borrowTierKits([ // 百炼嘉维尔: tier 4 authors S1 and S3, tier 5 authors S2
    part(gvial2t4, 'chess_char_4_23_a', 'skchr_gvial2_3', 4),
    part(gvial2t5, 'chess_char_5_18_a', 'skchr_gvial2_2', 5),
  ]),
  char_1038_whitw2: borrow(whitw2, 'chess_char_6_18_a', 'skchr_whitw2_3', 6), // 荒芜拉普兰德
  char_1045_svash2: borrow(svash2, 'chess_char_5_14_a', 'skchr_svash2_2', 5), // 凛御银灰
  char_1046_sbell2: borrow(sbell2, 'chess_char_6_02_a', 'skchr_sbell2_3', 6), // 圣聆初雪
  char_1047_halo2: borrow(halo2, 'chess_char_6_16_a', 'skchr_halo2_3', 6), // 溯光星源
  char_2015_dusk: borrow(dusk, 'chess_char_5_12_a', 'skchr_dusk_1', 5), // 夕
  char_4010_etlchi: borrow(etlchi, 'chess_char_5_06_a', 'skchr_etlchi_3', 5), // 隐德来希
  char_4039_horn: borrow(horn, 'chess_char_5_08_a', 'skchr_horn_3', 5), // 号角
  char_4064_mlynar: borrow(mlynar, 'chess_char_5_19_a', 'skchr_mlynar_3', 5), // 玛恩纳
  char_4082_qiubai: borrow(qiubai, 'chess_char_6_15_a', 'skchr_qiubai_3', 6), // 仇白
  char_4146_nymph: borrow(nymph, 'chess_char_5_22_a', 'skchr_nymph_2', 5), // 妮芙 (tier 5 only)
  // 规程·序列Ⅰ owned-6★. `.skill` is the shop skill; the other two are that file's `skills` entry. No generic fallback.
  char_103_angel: borrow(angel, 'chess_char_3_01_a', 'skchr_angel_3', 3), // 能天使: S3 .skill; S1 S2 skills
  char_222_bpipe: borrow(bpipe, 'chess_char_4_07_a', 'skchr_bpipe_2', 4), // 风笛: S2 .skill; S1 skcom_quickattack[3], S3 skills
  char_311_mudrok: borrow(mudrok, 'chess_char_4_18_a', 'skchr_mudrok_2', 4), // 泥岩: S2 .skill; S1 skcom_def_up[3], S3 skills
  char_1028_texas2: borrow(texas2, 'chess_char_4_16_a', 'skchr_texas2_3', 4), // 缄默德克萨斯: S3 .skill; S1 S2 skills
  char_1032_excu2: borrow(excu2, 'chess_char_5_01_a', 'skchr_excu2_2', 5), // 圣约送葬人: S2 .skill; S1 S3 skills
  char_1033_swire2: borrow(swire2, 'chess_char_3_04_a', 'skchr_swire2_2', 3), // 琳琅诗怀雅: S2 .skill; S1 S3 skills
  char_1041_angel2: borrow(angel2, 'chess_char_6_13_a', 'skchr_angel2_2', 6), // 新约能天使: S2 .skill; S1 S3 skills
  char_4056_titi: borrow(titi, 'chess_char_5_02_a', 'skchr_titi_3', 5), // 缇缇: S3 .skill; S1 S2 skills
  char_4087_ines: borrow(ines, 'chess_char_4_04_a', 'skchr_ines_2', 4), // 伊内丝: S2 .skill; S1 S3 skills
  char_4194_rmixer: borrow(rmixer, 'chess_char_4_01_a', 'skchr_rmixer_3', 4), // 信仰搅拌机: S3 .skill; S1 S2 skills
};
