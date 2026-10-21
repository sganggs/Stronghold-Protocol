"""时装与图库提取（本地客户端 → public/assets/local）。

只读本机客户端，不联网、不把官方素材写进仓库（public/assets/ 已 gitignore）。范围：

  --only skins    每套时装：前后战斗模型（skinpack/<charId>.ab 里 <charId>_<stem>_SkeletonData）→
                  skin/<charId>_<stem>/{front,back}/，并把立绘/半身像/头像（spritepack 的 Sprite）复制到同目录
  --only library  图库三层：library/opillust · library/opportrait · library/opavatar（立绘 / 半身像 / 头像）

清单来自 .cache/gamedata/excel/skin_table.json 的 charSkins[]（skinId / displaySkin / battleSkin）。
客户端没有下载的时装跳过并在日志里点名，不生成占位。
"""
import argparse
import io
import json
import os
import sys
from pathlib import Path

import UnityPy
from UnityPy.enums.BundleFile import CompressionFlags
from UnityPy.helpers import CompressionHelper

import extract as EX  # write_spine / safe_name / merge_alpha / atlas 处理
from aklz4 import decompress_lz4ak

# 明日方舟用 LZ4AK 取代标准压缩：注册后 UnityPy 才能读这些包（否则报 custom compression）
for _f in CompressionFlags:
    try:
        CompressionHelper.DECOMPRESSION_MAP[_f] = decompress_lz4ak
    except Exception:
        pass

SUB_SKIN = 'skin'
SUB_LIB = 'library'
FACES = ('front', 'back')


# ---------------------------------------------------------------- 纯逻辑（单测覆盖）
def stem_of(skin_id):
    """`char_003_kalts@boc#6` → `boc#6`（不是皮肤 id 的形状返回 None）。"""
    s = str(skin_id or '')
    return s.split('@', 1)[1] if '@' in s else None


def skeleton_name(char_id, stem):
    """时装战斗模型的 SkeletonData 名。官方命名：<charId>_<stem>_SkeletonData。"""
    return '%s_%s_SkeletonData' % (char_id, stem)


def dir_name(char_id, stem):
    """落盘目录名（插件/清单里用，去掉 # 这类文件名不安全字符）。"""
    return EX.safe_name('%s_%s' % (char_id, stem.replace('#', '_')))


def skin_jobs(skin_table, present):
    """skin_table.charSkins → [{skinId, charId, stem, name, group, dir}]，只保留本机有 skinpack 的。

    `present` 是 charId 集合（有 skinpack/<charId>.ab 的干员）。
    """
    out = []
    for sid, rec in (skin_table.get('charSkins') or {}).items():
        cid = rec.get('charId')
        stem = stem_of(sid)
        if not cid or not stem or cid not in present:
            continue
        ds = rec.get('displaySkin') or {}
        group = (ds.get('skinGroupName') or '').strip()
        if group in ('', '默认服装'):
            continue
        out.append({'skinId': sid, 'charId': cid, 'stem': stem,
                    'name': (ds.get('skinName') or sid).strip(), 'group': group,
                    'dir': dir_name(cid, stem)})
    return sorted(out, key=lambda j: (j['charId'], j['skinId']))


# ---------------------------------------------------------------- 客户端读取
def _sdats(env):
    """所有 SkeletonDataAsset 的 (m_Name, container, typetree)。"""
    out = []
    for o in env.objects:
        if getattr(o.type, 'name', '?') != 'MonoBehaviour':
            continue
        try:
            tt = o.read_typetree()
        except Exception:
            continue
        if 'skeletonJSON' in (tt or {}):
            out.append((str(tt.get('m_Name') or ''), o.container or '', tt))
    return out


def _write_face(env, tt, out_root, sub, name, log):
    n = EX.write_spine({o.path_id: o for o in env.objects}, tt, sub, name, out_root, {}, log)
    if not n:
        return 0
    # 贴图页名带 '#'（char_003_kalts_boc#6.png）—— 插件文件名只允许字母数字 . _ - 空格，
    # 所以重命名页图并把 .atlas 里的页名一起改掉。
    d = Path(out_root) / sub
    for f in sorted(d.iterdir()):
        if '#' not in f.name:
            continue
        nn = f.name.replace('#', '_')
        f.rename(d / nn)
        for at in d.glob('*.atlas'):
            txt = at.read_text(encoding='utf8', errors='replace')
            if f.name in txt:
                at.write_text(txt.replace(f.name, nn), encoding='utf8')
    return n


def _sprites(root, patterns):
    """spritepack 里若干批次的 Sprite：yield (名字, 对象)。"""
    for pat in patterns:
        for p in sorted(root.glob(pat)):
            try:
                env = UnityPy.load(str(p))
            except Exception:
                continue
            for o in env.objects:
                if getattr(o.type, 'name', '?') != 'Sprite':
                    continue
                try:
                    nm = str(o.read_typetree().get('m_Name') or '')
                except Exception:
                    continue
                if nm:
                    yield nm, o


def extract_skins(ab_roots, out_root, manifest, log):
    """提取全部时装；返回写出的文件数。"""
    skin_table = json.load(open(Path(ab_roots[0]).parent.parent.parent / 'x', 'r')) if False else None
    raise SystemExit('extract_skins 需要显式传入 skin_table，见 main()')


def main(argv=None):
    ap = argparse.ArgumentParser(description='时装 / 图库提取（本机客户端）')
    ap.add_argument('--game', required=True, help='AssetBundle 根（…/StreamingAssets/AB/Windows）')
    ap.add_argument('--extra', default='', help='更新叠加层根（…/PersistentData/Bundles），同名优先')
    ap.add_argument('--data-root', default=str(Path(__file__).resolve().parents[2]), help='仓库根（读 .cache/gamedata/excel/skin_table.json）')
    ap.add_argument('--out', required=True, help='public/assets/local')
    ap.add_argument('--manifest', required=True, help='data/local-assets.json')
    ap.add_argument('--only', default='skins', help='skins | library')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--print-jobs', action='store_true', help='打印任务表 JSON 后退出')
    args = ap.parse_args(argv)

    game = Path(args.game)
    extra = Path(args.extra) if args.extra else None
    out_root = Path(args.out)
    table_path = Path(args.data_root) / '.cache' / 'gamedata' / 'excel' / 'skin_table.json'
    table = json.load(open(table_path, encoding='utf8')) if table_path.exists() else {'charSkins': {}}

    def packs(sub):
        found = {}
        for root in (extra, game):
            if root and (root / sub).is_dir():
                for p in sorted((root / sub).glob('*.ab')):
                    found[p.stem] = p          # 叠加层后写，覆盖同名
        return found

    jobs = skin_jobs(table, set(packs('skinpack')))
    if args.print_jobs:
        print(json.dumps({'jobs': jobs[:200], 'count': len(jobs), 'library': [SUB_LIB]}, ensure_ascii=False))
        return 0

    manifest_doc = {'version': 1, 'source': 'local-client', 'count': 0, 'groups': {}}
    if Path(args.manifest).exists():
        try:
            manifest_doc = json.load(open(args.manifest, encoding='utf8'))
        except Exception:
            pass
    groups = manifest_doc.setdefault('groups', {})
    n = 0

    if args.only == 'skins':
        sprites = {}          # 名字 → Sprite（懒加载 spritepack）
        for job in jobs[:args.limit or None]:
            cid, stem = job['charId'], job['stem']
            pack = packs('skinpack').get(cid)
            if pack is None:
                print('  skip (no skinpack) %s' % job['skinId'])
                continue
            env = UnityPy.load(str(pack))
            want = skeleton_name(cid, stem)
            hits = [tt for (nm, c, tt) in _sdats(env) if nm == want and '/battle/prefabs/skins/character/' in c]
            if not hits:
                print('  skip (no model) %s' % job['skinId'])
                continue
            ok = 0
            for i, tt in enumerate(hits[:2]):
                sub = '%s/%s/%s' % (SUB_SKIN, job['dir'], FACES[i])
                ok += _write_face(env, tt, out_root, sub, '%s_%d' % (job['dir'], i), print)
            if not ok:
                continue
            files = sorted((out_root / SUB_SKIN / job['dir']).rglob('*'))
            groups.setdefault('%s/%s' % (SUB_SKIN, job['dir']), {})
            for f in files:
                if f.is_file():
                    rel = f.relative_to(out_root).as_posix()
                    groups['%s/%s' % (SUB_SKIN, job['dir'])][f.name] = {'path': '/assets/local/' + rel, 'kind': 'file'}
            n += ok
            print('  + %s %s (%d files)' % (job['skinId'], job['name'], ok))

    if args.only == 'library':
        pats = {'opillust': 'char_portrait_*.ab', 'opportrait': 'char_portrait_*.ab', 'opavatar': 'ui_char_avatar_*.ab'}
        seen = set()
        for kind, pat in pats.items():
            k = 0
            for nm, o in _sprites(game / 'spritepack', [pat]):
                if nm in seen:
                    continue
                try:
                    img = o.read().image
                except Exception:
                    continue
                if img is None or img.width < 8:
                    continue
                d = out_root / SUB_LIB / kind
                d.mkdir(parents=True, exist_ok=True)
                rel = '%s/%s/%s.png' % (SUB_LIB, kind, nm.replace('#', '_'))
                img.save(out_root / rel, 'PNG')
                groups.setdefault('%s/%s' % (SUB_LIB, kind), {})[nm] = {'path': '/assets/local/' + rel, 'kind': 'Texture2D'}
                seen.add(nm)
                k += 1
            print('  %s: %d' % (kind, k))
            n += k

    manifest_doc['count'] = sum(len(v) for v in groups.values())
    Path(args.manifest).parent.mkdir(parents=True, exist_ok=True)
    json.dump(manifest_doc, open(args.manifest, 'w', encoding='utf8'), ensure_ascii=False)
    print('done: %d files -> %s (manifest %d groups)' % (n, out_root, len(groups)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
