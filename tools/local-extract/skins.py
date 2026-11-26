"""Official outfits (时装) and the operator picture gallery (图库) from the local client: opt-in jobs of extract.py.

Ported from GitHub PR #776 by @xcdoge to the maintainer's review of 2026-10-23 (DESIGN §37.331, round 84). Both run
only when an --only prefix names them (a plain extraction leaves them out), read the client through extract.py's
client_bundles (a Windows client's hot update over its packaged bundles) and the LZ4AK decoder aklz4.py registers,
and write nothing to data/local-assets.json: what they write is no art the game loads by itself.

Both write under extract.py's --out when it is given, else under out/local-extract/ (DEFAULT_OUT: a folder git ignores
that the server neither serves nor hashes, unlike public/assets/), and stage their files in a hidden folder beside the
destination (one volume: the finished files are renamed into place, never copied out of a RAM-backed /tmp).

--only skins[/<charId>] → <out>/skins/local-skins/, the source folder of a cosmetic plugin (docs/PLUGINS.md §9,
  docs/SKINS.md), and local-skins-2 … when one plugin cannot hold them all (512 MB / 5000 files / 2000 folders: the
  outfits of this installation's operators are about 0.7 GB): plugin.json, its overlay skins.json with
  chars[<charId>].skins[<skinId>] = { name, group, avatar, portrait, illust, spine? } from the official skin_table.json
  charSkins (--skin-table), tokens[<tokenId>].skins[<owner skinId>] = { name, group, avatar?, spine? } for the summons
  their owners' outfits dress (the same table's charSkins[*].tokenSkinMap; a summon says nothing, so its skins carry no
  voice), and the files under <charId>/<outfit>/ and <tokenId>/<summon outfit>/:
    avatar.png, portrait.png   the spritepack Sprites named by avatarId / portraitId (ui_char_avatar_*, char_portrait_*)
    illust.webp                the Sprite of the outfit's 立绘 prefab (arts/characters/<charId>/<illustId>.prefab of
                               skinpack/<charId>.ab), padded back to its rect; WebP quality 90 (PNG without WebP)
    front.* / back.*           battleSkin.skinOrPrefabId's battle prefab (battle/prefabs/skins/character/…): the Spine
                               renderers named Front / Back (one named Spine is the front of a one-sided model), written
                               by extract.write_spine: straight pages (merge_alpha), atlas without `pma` (#668), and
                               plugin-safe file names with the atlas's page lines rewritten to them
  A summon's outfit is the prefab of the summon's own pack, skinpack/<tokenId>.ab, named by tokenSkinMap
  `tokenSkinId` (its models are taken by SkeletonDataAsset, never by skeleton name, and its `illust_` prefabs are
  skipped), its avatar.png the 180×180 Sprite of ui_char_avatar_* named `tokenSkinId` when the client has one —
  otherwise the record has no avatar and the client falls back to the summon's own (docs/SKINS.md). Its name and series
  are the owner outfit's displaySkin.
  An outfit whose battleSkin keeps the operator's own model (DefaultSkin) gets pictures only: the picker's
  「仅更换头像与立绘」 (SKINS.md B6). A plain `--only skins` takes the operators of the installation's data/assets.json
  and their summons (`--only skins/<charId>` names any operator, and the summons its outfits dress); then
  `node tools/plugin.mjs pack` writes each part's lock. --limit N samples the outfits only: the summons kept are those
  of the N sampled outfits. Copy the part folders into plugins/ to use them; the files are official art and never belong
  in git or a release.
--only library[/<kind>] → <out>/library/<kind>/ and library/index.json: every 立绘 (opillust: the illust_* prefabs of
  chararts/ and skinpack/), 半身像 (opportrait: char_portrait_*) and 头像 (opavatar: ui_char_avatar_*) of the client,
  each kind deduplicated by its own official names.
"""
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

SUB = 'skins'
LIB_SUB = 'library'
DEFAULT_OUT = 'out/local-extract'  # relative to the checkout, when extract.py gets no --out
STAGE_PREFIX = '.staging-'
LIB_KINDS = ('opillust', 'opportrait', 'opavatar')
LIB_INDEX = 'index.json'
FORMAT = 1
AVATARS = 'spritepack/ui_char_avatar_*.ab'
PORTRAITS = 'spritepack/char_portrait_*.ab'
ILLUST_PACKS = ('chararts/*.ab', 'skinpack/*.ab')
SKIN_PACK = 'skinpack/{}.ab'  # an outfit's or a summon's pack: a token id already starts with `token_`
PREFAB_EXT = '.prefab'
DEFAULT_MODEL = 'DefaultSkin'
PLUGIN_FILE = 'plugin.json'
# The overlay is a file of the plugin, not inline in plugin.json: the manifest reader takes every inline `assets` text
# ending like `.ext` for a file path (shared/plugins/manifest.js inlineAssetFiles), and official outfit names do
# (日晒 SS.SP, 温差 RT.RX07, the series i.t); the overlay reader of a file reads `name` / `group` as text.
ASSETS_FILE = 'skins.json'
LOCK_FILE = 'plugin.lock.json'
PART = 'local-skins'
PART_NAME = re.compile(r'^local-skins(?:-([2-9]|[1-9][0-9]+))?$')
# The cosmetic plugin's ceilings: shared/plugins/manifest.js PLUGIN_CLASSES.cosmetic.bytes and PLUGIN_LIMITS.files,
# server/plugins/registry.js WALK_LIMITS.dirs, docs/PLUGINS.md §9's 64 skins per record and 1–64 characters of a name
# (test/local-extract/skins.test.js keeps them equal). RESERVE leaves room for plugin.json, skins.json and the lock.
PLUGIN_BYTES = 512 * 1024 * 1024
PLUGIN_FILES = 5000
PLUGIN_DIRS = 2000
SKINS_PER_RECORD = 64
TEXT_MAX = 64
RESERVE = {'bytes': 16 * 1024 * 1024, 'files': 8, 'dirs': 1}
# [ASSUMED] 立绘 are 2048² / 2560² canvases (5.8 MB as PNG, 0.95 MB like this; measured on char_003_kalts@boc#6): the
# guide pages' lossy quality 90 (extract.py GUIDE_WEBP_OPTIONS), the alpha lossless.
ILLUST_WEBP = {'quality': 90, 'method': 4, 'alpha_quality': 100}
SAFE = re.compile(r'[^A-Za-z0-9._-]+')
# an outfit folder of a record: <charId>/<outfit>, plugin-safe names that never start with `.` (no `..`, no stage)
RECORD_DIR = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$')
ILLUST_PREFAB = re.compile(r'/arts/characters/[^/]+/(illust_[^/]+)\.prefab$', re.I)


# ------------------------------------------------------------------------------------------- plan (no UnityPy)
def plugin_safe(name):
    """A file or folder name a plugin may hold (docs/PLUGINS.md §5: letters, digits, `.` `_` `-`): every other run of
    characters (`@` `#` `+` …) becomes `_`."""
    return SAFE.sub('_', str(name or '')).strip('._-')[:96] or 'unnamed'


def unique(name, taken):
    """`name`, else `name_2`, `name_3` … when another source already took it in this folder (compared without case: one
    file on Windows and macOS); the result is added to `taken`. Two outfits or pictures never write one file."""
    cand, n = name, 1
    while cand.lower() in taken:
        n += 1
        cand = f'{name}_{n}'
    taken.add(cand.lower())
    return cand


def owner_of(rec):
    """The operator an outfit dresses: its template (阿米娅's patch forms, e.g. char_1037_amiya3) or else its charId."""
    return rec.get('tmplId') or rec.get('charId')


def model_of(rec):
    """battleSkin.skinOrPrefabId: the battle prefab of the outfit, or None when it keeps the operator's own model."""
    pid = (rec.get('battleSkin') or {}).get('skinOrPrefabId')
    return None if not pid or pid == DEFAULT_MODEL else str(pid)


def _text(value, fallback=''):
    s = ' '.join(str(value or '').split())
    return (s or fallback)[:TEXT_MAX]


def _sort_key(rec):
    # [ASSUMED] displaySkin.sortId is the official order of an operator's outfits; the id breaks ties
    ds = rec.get('displaySkin') or {}
    sid = ds.get('sortId')
    return (sid if isinstance(sid, (int, float)) else 1e9, rec.get('skinId') or '')


def table_owners(table):
    """Every operator with an alternative outfit in skin_table (sorted)."""
    rows = ((table or {}).get('charSkins') or {}).items()
    return sorted({owner_of(r) for k, r in rows if '@' in k and isinstance(r, dict) and owner_of(r)})


def plan(table, owners=None):
    """skin_table.json → the outfit jobs: every alternative outfit (a skin id with `@`; the default outfits #1 / #2 and
    the patch forms' defaults such as char_1037_amiya3#2 are the operator's own art) of the operators in `owners` (all
    with None), at most SKINS_PER_RECORD per operator, sorted by operator and then official order. A job is
    {skinId, char, dir, name, group, avatar, portrait, illust, model}; `dir` is <charId>/<plugin-safe part after `@`>,
    unique per operator."""
    wanted = None if owners is None else set(owners)
    by_owner = {}
    for sid, rec in ((table or {}).get('charSkins') or {}).items():
        if '@' not in sid or not isinstance(rec, dict):
            continue
        cid = owner_of(rec)
        if not cid or (wanted is not None and cid not in wanted):
            continue
        by_owner.setdefault(cid, []).append({**rec, 'skinId': sid})
    jobs = []
    for cid in sorted(by_owner):
        taken = set()
        for rec in sorted(by_owner[cid], key=_sort_key)[:SKINS_PER_RECORD]:
            sid, ds = rec['skinId'], rec.get('displaySkin') or {}
            jobs.append({'skinId': sid, 'char': cid, 'dir': f'{cid}/{unique(plugin_safe(sid.split("@", 1)[1]), taken)}',
                         # [ASSUMED] an outfit without a skinName is named by its id (a record needs a 1–64 name)
                         'name': _text(ds.get('skinName'), sid), 'group': _text(ds.get('skinGroupName')),
                         'avatar': rec.get('avatarId') or None, 'portrait': rec.get('portraitId') or None,
                         'illust': rec.get('illustId') or None, 'model': model_of(rec)})
    return jobs


def token_plan(table, owners=None, log=None):
    """skin_table.json → the summon (token) outfit jobs: every `charSkins[*].tokenSkinMap` entry ([{tokenId,
    tokenSkinId}]) of the outfits of the operators in `owners` (all with None), indexed by its owner outfit. A job is
    {tokenId, char (= tokenId), skinId (= the owner outfit's id), tokenSkinId, dir, name, group}: `dir` is
    <tokenId>/<plugin-safe tokenSkinId>, unique per summon; `name` / `group` are the OWNER outfit's displaySkin (a
    summon has no name of its own), and one summon takes at most SKINS_PER_RECORD outfits in the official order — more
    are dropped with a warning naming the summon and its total (`log`), never silently (docs/PLUGINS.md §9).
    `char` / `skinId` are the fields plan gives its jobs, so keep_dirs, record_dir and the part placement treat a summon
    outfit like an operator outfit; `tokenSkinId` is what the bundle's prefab and the 180×180 avatar are named."""
    wanted = None if owners is None else set(owners)
    by_token = {}
    for sid, rec in ((table or {}).get('charSkins') or {}).items():
        if not isinstance(rec, dict):
            continue
        cid = owner_of(rec)
        if wanted is not None and (not cid or cid not in wanted):
            continue
        ds = rec.get('displaySkin') or {}
        for entry in rec.get('tokenSkinMap') or []:
            if not isinstance(entry, dict):
                continue
            token_id, token_skin = entry.get('tokenId'), entry.get('tokenSkinId')
            if not token_id or not token_skin:
                continue
            by_token.setdefault(token_id, []).append({
                'tokenId': token_id, 'tokenSkinId': token_skin, 'ownerSkinId': sid,
                'sort': _sort_key({**rec, 'skinId': sid}),
                # [ASSUMED] an owner outfit without a skinName is named by its id, as an outfit without one is (plan)
                'name': _text(ds.get('skinName'), sid), 'group': _text(ds.get('skinGroupName'))})
    jobs = []
    for token_id in sorted(by_token):
        entries = sorted(by_token[token_id], key=lambda e: e['sort'])
        if len(entries) > SKINS_PER_RECORD:
            if log is not None:
                log(f'warn: {token_id} is dressed by {len(entries)} owner outfits; one summon record takes '
                    f'{SKINS_PER_RECORD} (docs/PLUGINS.md §9) — the official order keeps the first {SKINS_PER_RECORD}')
            entries = entries[:SKINS_PER_RECORD]
        taken = set()
        for entry in entries:
            jobs.append({'tokenId': token_id, 'char': token_id, 'skinId': entry['ownerSkinId'],
                         'tokenSkinId': entry['tokenSkinId'],
                         'dir': f'{token_id}/{unique(plugin_safe(entry["tokenSkinId"]), taken)}',
                         'name': entry['name'], 'group': entry['group']})
    return jobs


def record(job, files):
    """The plugin's skin record of a job from the files it wrote (paths inside the plugin folder): name and group, the
    pictures that exist, and the model when its front exists. None when nothing wearable was written."""
    rec = {'name': job['name'], 'group': job['group']}
    for slot in ('avatar', 'portrait', 'illust'):
        if files.get(slot):
            rec[slot] = files[slot]
    spine = {face: files[face] for face in ('front', 'back') if files.get(face)}
    if spine.get('front'):
        rec['spine'] = spine
    return rec if len(rec) > 2 else None


def app_range(version):
    """The app range of the release that wrote the folder: >=<major>.<minor>.0 <<major>.<minor+1>.0."""
    m = re.match(r'^(\d+)\.(\d+)\.', str(version or ''))
    if not m:
        return '*'
    major, minor = int(m.group(1)), int(m.group(2))
    return f'>={major}.{minor}.0 <{major}.{minor + 1}.0'


def part_folder(n):
    """The folder (= plugin id) of part n of the outfits: local-skins, local-skins-2, local-skins-3 …"""
    return PART if n == 1 else f'{PART}-{n}'


def part_number(name):
    """The part number of a folder name of part_folder, else None."""
    m = PART_NAME.match(str(name))
    return int(m.group(1) or 1) if m else None


def overlay(chars, tokens=None):
    """The asset overlay of a part (ASSETS_FILE): chars[<charId>].skins[<skinId>] = record, and
    tokens[<tokenId>].skins[<owner skin id>] = record; a side a part has nothing for is left out."""
    doc = {}
    if chars:
        doc['chars'] = {cid: {'skins': chars[cid]} for cid in sorted(chars)}
    if tokens:
        doc['tokens'] = {tid: {'skins': tokens[tid]} for tid in sorted(tokens)}
    return doc


def manifest(chars, installed, version, part=1, tokens=None, installed_tokens=()):
    """plugin.json of a part: a personal cosmetic plugin whose overlay is ASSETS_FILE, `assets.override` for operators
    and summons the installation's data/assets.json has and `assets.add` for the others (docs/PLUGINS.md §9). `tokens`
    are the part's summon records (<tokenId> → {<owner skin id>: record}), `installed_tokens` the summons of
    data/assets.json."""
    have = set(installed or ())
    have_tokens = set(installed_tokens or ())
    tokens = tokens or {}
    perms = []
    if any(cid in have for cid in chars) or any(tid in have_tokens for tid in tokens):
        perms.append('assets.override')
    if any(cid not in have for cid in chars) or any(tid not in have_tokens for tid in tokens):
        perms.append('assets.add')
    return {
        'manifest': 2,
        'name': {'zh': '本机提取的时装' + (f'（第 {part} 部分）' if part > 1 else ''),
                 'en': 'Outfits from the local client' + (f' (part {part})' if part > 1 else '')},
        'description': {
            'zh': '由 tools/local-extract/extract.py --only skins 从本机官方客户端提取的时装：立绘、半身像、头像和战斗模型。',
            'en': 'Outfits extracted from this machine\'s official client by tools/local-extract/extract.py --only skins: '
                  'illustrations, portraits, avatars and battle models.'},
        'version': '1.0.0',
        'app': app_range(version),
        'api': 1,
        'class': 'cosmetic',
        'scope': ['personal'],
        'authors': ['tools/local-extract'],
        'credits': 'Official art (c) Hypergryph, extracted from the local client; for private, non-commercial fan use only.',
        'license': 'Official game art (c) Hypergryph: private use on this server only, never redistribute',
        'permissions': perms,
        'assets': ASSETS_FILE,
    }


def merge(old_chars, new_chars, alive):
    """Records after a run: the new ones, and the old ones this run did not replace for which `alive(record)` finds a
    file (a partial run, or an outfit this run skipped, keeps what an earlier run extracted)."""
    out = {}
    for cid in sorted(set(old_chars) | set(new_chars)):
        skins = dict(new_chars.get(cid) or {})
        for k, v in (old_chars.get(cid) or {}).items():
            if k not in skins and alive(v):
                skins[k] = v
        if skins:
            out[cid] = skins
    return out


def tree_size(path):
    """(bytes, files, folders) of a folder tree; zeros when it is absent."""
    b = f = d = 0
    p = Path(path)
    if not p.is_dir():
        return 0, 0, 0
    for x in p.rglob('*'):
        if x.is_dir():
            d += 1
        elif x.is_file():
            b += x.stat().st_size
            f += 1
    return b, f, d


class Budget:
    """The plugin folder's running size against the cosmetic ceilings: an outfit that would take the folder past one is
    not added. Sizes are (bytes, files, folders); a folder's own entry counts as one folder."""

    def __init__(self, dest):
        b, f, d = tree_size(dest)
        for own in (PLUGIN_FILE, ASSETS_FILE, LOCK_FILE):  # RESERVE stands for them, also when an earlier run wrote them
            if (Path(dest) / own).is_file():
                b, f = b - (Path(dest) / own).stat().st_size, f - 1
        self.size = [b + RESERVE['bytes'], f + RESERVE['files'], d + RESERVE['dirs']]

    def take(self, new, old=(0, 0, 0)):
        """Replace a folder of size `old` (zeros when absent) with one of size `new`; False when it does not fit."""
        after = [self.size[i] - old[i] + new[i] for i in range(3)]
        if after[0] > PLUGIN_BYTES or after[1] > PLUGIN_FILES or after[2] > PLUGIN_DIRS:
            return False
        self.size = after
        return True


def folder_size(path):
    """tree_size of a folder plus the folder itself (zeros when it is absent)."""
    b, f, d = tree_size(path)
    return (b, f, d + 1) if Path(path).is_dir() else (0, 0, 0)


# ------------------------------------------------------------------------------------------- the client's pictures
def _local(objects, pptr):
    return objects.get(pptr.get('m_PathID')) if pptr and pptr.get('m_PathID') and not pptr.get('m_FileID') else None


def prefab_image(root, objects, depth=0):
    """The first UI Image of a prefab, depth first: (Sprite object, alpha Texture2D object or None) — the alpha is the
    _AlphaTex of the Image's own material, where the operators' default 立绘 keep theirs —, or (None, None)."""
    children = []
    for c in root.get('m_Component') or []:
        o = _local(objects, c.get('component'))
        if o is None:
            continue
        try:
            kind = o.type.name
            tt = o.read_typetree()
        except Exception:  # a script without a readable type tree is no Image
            continue
        if kind == 'MonoBehaviour' and _local(objects, tt.get('m_Sprite')) is not None:
            alpha = None
            mat = _local(objects, tt.get('m_Material'))
            if mat is not None:
                texs = dict(mat.read_typetree().get('m_SavedProperties', {}).get('m_TexEnvs') or [])
                alpha = _local(objects, (texs.get('_AlphaTex') or {}).get('m_Texture'))
            return _local(objects, tt['m_Sprite']), alpha
        if kind in ('RectTransform', 'Transform'):
            children = tt.get('m_Children') or []
    if depth >= 8:
        return None, None
    for ch in children:
        t = _local(objects, ch)
        g = _local(objects, t.read_typetree().get('m_GameObject')) if t is not None else None
        if g is not None:
            hit = prefab_image(g.read_typetree(), objects, depth + 1)
            if hit[0] is not None:
                return hit
    return None, None


def illust_raster(sprite, alpha=None):
    """The 立绘 of an Image: with a material alpha texture, the texture with that alpha merged in (extract.merge_alpha)
    cut to the Sprite's rect; else the Sprite's own image padded back to its rect (autochess_themes._sprite_raster)."""
    if alpha is None:
        from autochess_themes import _sprite_raster
        return _sprite_raster(sprite)
    from extract import merge_alpha
    full = merge_alpha(sprite.m_RD.texture.read().image, alpha.read().image)
    r = sprite.m_Rect
    top = full.height - float(r.y) - float(r.height)
    return full.crop((int(round(r.x)), int(round(top)), int(round(float(r.x) + float(r.width))), int(round(top + float(r.height)))))


def webp_ok():
    try:
        from PIL import features
        return bool(features.check('webp'))
    except Exception:
        return False


def save_picture(img, folder, stem, illust):
    """A picture → <folder>/<stem>.png, or .webp for a 立绘 (ILLUST_WEBP) when Pillow writes WebP; the file name."""
    folder.mkdir(parents=True, exist_ok=True)
    if illust and webp_ok():
        img.save(folder / f'{stem}.webp', 'WEBP', **ILLUST_WEBP)
        return f'{stem}.webp'
    img.save(folder / f'{stem}.png', 'PNG')
    return f'{stem}.png'


def _sprite_name(obj):
    try:
        return obj.peek_name()
    except Exception:
        return obj.read().m_Name


def _sprites(ab_root, glob, log):
    """(bundle name, Sprite object) of every Sprite of the bundles a glob names, a bundle at a time."""
    import UnityPy
    for bundle in sorted(Path(ab_root).glob(glob)):
        try:
            env = UnityPy.load(str(bundle))
        except Exception as err:
            log(f'warn {bundle.name}: {err}')
            continue
        for obj in env.objects:
            if obj.type.name == 'Sprite':
                yield bundle.name, obj


# ------------------------------------------------------------------------------------------- --only skins
def _face_namer(face):
    names = {}

    def rename(kind, official):
        if kind == 'skel':
            return face
        if official not in names:
            names[official] = face if not names else f'{face}_{len(names) + 1}'
        return names[official]
    return rename


def _faces(objects, nodes, job, stage, log):
    """The Front / Back models of a prefab's Spine renderers (prefab_spine_nodes) into <stage>/<dir>/: {front: Spine,
    back?: Spine} (paths relative to the plugin). The front is the renderer named Front, else one named Spine (a
    one-sided model), else the first active one (pick_spine_node); a Back is written only beside a Front, as an operator's
    own model draws one facing up. The files are _face_namer's: front.skel / front.atlas / front.png (front_2.png …),
    the same for back. The log name is a summon outfit's tokenSkinId, else the outfit's skin id."""
    from extract import pick_spine_node, write_spine
    front = pick_spine_node([n for n in nodes if n[0] in ('Front', 'Spine')])
    back = next((n for n in nodes if n[0] == 'Back' and n[1]), None) or next((n for n in nodes if n[0] == 'Back'), None)
    name = job.get('tokenSkinId') or job['skinId']
    out = {}
    for face, node in (('front', front), ('back', back if front and front[0] == 'Front' else None)):
        sda = _local(objects, node[2]) if node else None
        if sda is None:
            continue
        files = {}
        n = write_spine(objects, sda.read_typetree(), job['dir'], name, stage, files, log, rename=_face_namer(face))
        if not n:
            continue
        got = files.get(job['dir'], {})
        out[face] = {'skel': f'{job["dir"]}/{face}.skel', 'atlas': f'{job["dir"]}/{face}.atlas',
                     'textures': [f'{job["dir"]}/{k}' for k in sorted(got) if k.endswith('.png')]}
    return out


def _model(env, objects, job, stage, log):
    """The outfit's Front / Back into <stage>/<dir>/: {front: Spine, back?: Spine} (paths relative to the plugin)."""
    from extract import prefab_spine_nodes
    want = '/' + job['model'].lower() + PREFAB_EXT
    ref = next((v for k, v in sorted(env.container.items())
                if 'battle/prefabs/skins/' in k.lower() and k.lower().endswith(want)), None)
    if ref is None:
        log(f'skip (no battle prefab {job["model"]}) {job["skinId"]}')
        return {}
    return _faces(objects, prefab_spine_nodes(ref.read_typetree(), objects), job, stage, log)


def _illust(env, objects, job, stage, log):
    want = '/' + job['illust'].lower() + PREFAB_EXT
    ref = next((v for k, v in sorted(env.container.items())
                if 'arts/characters/' in k.lower() and k.lower().endswith(want)), None)
    if ref is None:
        return None
    sprite, alpha = prefab_image(ref.read_typetree(), objects)
    if sprite is None:
        return None
    name = save_picture(illust_raster(sprite.read(), alpha), Path(stage) / job['dir'], 'illust', True)
    return f'{job["dir"]}/{name}'


def read_parts(dest, log, key='chars'):
    """{part number: {<id>: {<record key>: record}}} of the plugin parts an earlier run left in <dest> (skins/), one
    overlay table: `chars` (<charId> → skins) by default, or `tokens` (<tokenId> → skins); the two key spaces are read
    apart because an owner skin id may be an operator outfit's id too."""
    parts = {}
    if not Path(dest).is_dir():
        return parts
    for d in sorted(Path(dest).iterdir()):
        n = part_number(d.name) if d.is_dir() else None
        if n is None or not (d / PLUGIN_FILE).is_file():
            continue
        try:
            doc = json.loads((d / PLUGIN_FILE).read_text(encoding='utf-8')).get('assets')
            if isinstance(doc, str):
                doc = json.loads((d / doc).read_text(encoding='utf-8'))
            parts[n] = {cid: dict(rec.get('skins') or {})
                        for cid, rec in ((doc or {}).get(key) or {}).items() if isinstance(rec, dict)}
        except (OSError, ValueError, AttributeError) as err:
            log(f'warn {d / PLUGIN_FILE}: unreadable ({err}); its outfits are extracted again when asked')
            parts[n] = {}
    return parts


def record_dir(rec):
    """The folder a record's files are in (<charId>/<outfit>, or <tokenId>/<summon outfit>: two plugin-safe parts), or
    None."""
    paths = [rec.get(s) for s in ('avatar', 'portrait', 'illust')]
    paths += [m.get('skel') for m in (rec.get('spine') or {}).values() if isinstance(m, dict)]
    dirs = {p.rsplit('/', 1)[0] for p in paths if isinstance(p, str) and '/' in p}
    d = dirs.pop() if len(dirs) == 1 else None
    return d if d and RECORD_DIR.match(d) else None


def keep_dirs(jobs, parts):
    """The jobs with the folders of an earlier run kept: an outfit whose record (in any part) has its files in one
    folder of its operator keeps that folder, so a re-run never renames one. Two outfits of one plugin-safe name
    (`a#1`, `a+1`) would otherwise swap `a_1` / `a_1_2` when the official order changes or a new outfit of the name
    comes first, and the second move would delete the folder the first had just filled. Every other job keeps plan's
    folder, or `_2` … of it while an earlier run's outfit (also one this run leaves alone) or another job holds it.
    A summon outfit is a job of the same shape (char = its tokenId, skinId = the owner outfit's id) against the
    `tokens` table of read_parts: its own key space, since an owner skin id may be an operator outfit's id too, and two
    summons may be dressed by one owner outfit — an earlier run's folder is looked up by (owner, skin id)."""
    old = {}
    for table in parts.values():
        for owner, recs in table.items():  # the owner is the folder's first part: <charId> or <tokenId>
            for sid, rec in recs.items():
                d = record_dir(rec) if isinstance(rec, dict) else None
                if d:
                    old.setdefault((owner, sid), d)
    held = {d.lower() for d in old.values()}
    taken, out = set(), []
    for job in jobs:
        d = old.get((job['char'], job['skinId']))
        if d and d.split('/', 1)[0] == job['char'] and d.lower() not in taken:
            taken.add(d.lower())
            out.append(dict(job, dir=d))
        else:
            out.append(None)
    for i, job in enumerate(jobs):
        if out[i] is not None:
            continue
        base = job['dir'].split('/', 1)[1]
        cand, n = base, 1
        while f'{job["char"]}/{cand}'.lower() in held or f'{job["char"]}/{cand}'.lower() in taken:
            n += 1
            cand = f'{base}_{n}'
        taken.add(f'{job["char"]}/{cand}'.lower())
        out[i] = dict(job, dir=f'{job["char"]}/{cand}')
    return out


def _stage(dest, kind):
    """A new stage folder inside <dest> (the destination's volume), after removing the stages an interrupted run left."""
    dest.mkdir(parents=True, exist_ok=True)
    for old in dest.glob(f'{STAGE_PREFIX}{kind}-*'):
        if old.is_dir():
            shutil.rmtree(old, ignore_errors=True)
    return Path(tempfile.mkdtemp(prefix=f'{STAGE_PREFIX}{kind}-', dir=str(dest)))


def _drop_if_empty(path):
    try:
        Path(path).rmdir()
    except OSError:
        pass


def _alive(folder):
    def alive(rec):
        paths = [rec.get(s) for s in ('avatar', 'portrait', 'illust')]
        paths += [m.get('skel') for m in (rec.get('spine') or {}).values() if isinstance(m, dict)]
        return any(isinstance(p, str) and (Path(folder) / p).is_file() for p in paths)
    return alive


def _remove(folder, rel):
    """Delete an outfit's (or a summon outfit's) folder of a part, and its owner folder when that is left empty."""
    if not rel:
        return
    shutil.rmtree(Path(folder) / rel, ignore_errors=True)
    try:
        (Path(folder) / rel).parent.rmdir()
    except OSError:
        pass


def export(ab_root, out_root, log, jobs, installed=(), version='', limit=0, pack_root=None,
           tokens=(), installed_tokens=()):
    """The outfit jobs (plan) and the summon outfit jobs (token_plan) → the plugin parts in <out_root>/skins/, merged
    into what an earlier run left there; returns the number of files written. An outfit or a summon outfit stays in its
    part while that part keeps inside the cosmetic ceilings, else it goes to the first part with room, else to a new part
    (local-skins-2 …): 345 outfits of this installation's operators are about 0.7 GB, more than one cosmetic plugin
    holds, and the summons' outfits are ~10 % of that again — the operators' outfits take the parts first, a summon
    outfit fills what is left. A record keeps the folder an earlier run gave it (keep_dirs), in its own key space
    (`chars` / `tokens`: an owner skin id may be an operator outfit's id too). Files are staged in
    <out_root>/skins/.staging-skins-* and renamed into their parts once every picture and model is extracted.
    `installed` / `installed_tokens` are the operators and summons of the installation's data/assets.json (the
    permissions), `pack_root` the installation `node tools/plugin.mjs pack` checks a written part against (None: no
    pack). `limit` keeps the first N outfit jobs and the summon outfits of those outfits only — a summon wears what its
    owner wears, so a sample of outfits needs no count of its own (docs/SKINS.md)."""
    import aklz4  # noqa: F401 (the LZ4AK decoder for the one flag it registers, as every other job)
    import UnityPy
    from extract import prefab_spine_nodes

    dest = Path(out_root) / SUB
    jobs = list(jobs)
    tokens = list(tokens)
    # every summon outfit this run was handed: one --limit leaves out is no "not in tokenSkinMap" below
    known = {job['tokenSkinId'].casefold() for job in tokens}
    if limit:
        jobs = jobs[:limit]
        chosen = {job['skinId'] for job in jobs}
        tokens = [job for job in tokens if job['skinId'] in chosen]
    if not jobs and not tokens:
        log('skins: no outfit to extract')
        return 0
    parts = {'chars': read_parts(dest, log), 'tokens': read_parts(dest, log, 'tokens')}
    jobs = keep_dirs(jobs, parts['chars'])
    tokens = keep_dirs(tokens, parts['tokens'])
    stage = _stage(dest, SUB)
    written, new = {}, {'chars': {}, 'tokens': {}}
    placed, gone = {'chars': {}, 'tokens': {}}, {'chars': {}, 'tokens': {}}
    try:
        files = {}
        for job in jobs:
            files[('chars', job['char'], job['skinId'])] = {}
        for job in tokens:  # one token's job per owner outfit, and two summons may share that outfit
            files[('tokens', job['char'], job['skinId'])] = {}
        for slot, glob in (('avatar', AVATARS), ('portrait', PORTRAITS)):
            wanted = {}
            for container, group in (('chars', jobs), ('tokens', tokens)):
                for job in group:
                    # a summon outfit's avatar is the Sprite named after its tokenSkinId; it has no portrait of ours
                    name = job['tokenSkinId'] if slot == 'avatar' and container == 'tokens' else job.get(slot)
                    if name:
                        wanted.setdefault(name, []).append((container, job))
            for bundle, obj in _sprites(ab_root, glob, log):
                if not wanted:
                    break
                try:
                    name = _sprite_name(obj)
                    if name not in wanted:
                        continue
                    img = obj.read().image
                    for container, job in wanted.pop(name):
                        fname = save_picture(img, stage / job['dir'], slot, False)
                        files[(container, job['char'], job['skinId'])][slot] = f'{job["dir"]}/{fname}'
                except Exception as err:  # one unreadable sprite must not hide the later ones of the bundle
                    log(f'warn {bundle} sprite: {err}')
            for name in sorted(wanted):
                log(f'skip (not found) {slot} {name}')
        by_owner = {}
        for job in jobs:
            by_owner.setdefault(job['char'], []).append(job)
        for cid in sorted(by_owner):
            bundle = Path(ab_root) / SKIN_PACK.format(cid)
            env = objects = None
            if bundle.is_file():
                try:
                    env = UnityPy.load(str(bundle))
                    objects = {o.path_id: o for o in env.objects}
                except Exception as err:
                    log(f'warn {bundle.name}: {err}')
            else:
                log(f'skip (not in this client) {SKIN_PACK.format(cid)}')
            for job in by_owner[cid]:
                got = files[('chars', job['char'], job['skinId'])]
                if env is not None:
                    try:
                        if job['illust']:
                            got['illust'] = _illust(env, objects, job, stage, log)
                        if job['model']:
                            got.update(_model(env, objects, job, stage, log))
                    except Exception as err:
                        log(f'warn {job["skinId"]}: {err}')
                if job['model'] and not got.get('front'):
                    # [ASSUMED] an outfit with an official model the client lacks is left out, not worn as pictures only
                    log(f'skip (model not extracted) {job["skinId"]}')
                    continue
                rec = record(job, got)
                if rec is None:
                    log(f'skip (nothing found) {job["skinId"]}')
                    continue
                new['chars'][(job['char'], job['skinId'])] = rec
        # a summon's own pack, skinpack/<tokenId>.ab: its container prefabs are named by tokenSkinMap `tokenSkinId`
        by_token = {}
        for job in tokens:
            by_token.setdefault(job['tokenId'], []).append(job)
        for tid in sorted(by_token):
            bundle = Path(ab_root) / SKIN_PACK.format(tid)
            if not bundle.is_file():
                log(f'skip (not in this client) {SKIN_PACK.format(tid)}')
                continue
            try:
                env = UnityPy.load(str(bundle))
                objects = {o.path_id: o for o in env.objects}
                prefabs = [(k, v, k.rsplit('/', 1)[1][:-len(PREFAB_EXT)]) for k, v in sorted(env.container.items())
                           if k.lower().endswith(PREFAB_EXT)]
            except Exception as err:
                log(f'warn {bundle.name}: {err}')
                continue
            by_skin = {}
            for job in by_token[tid]:
                by_skin.setdefault(job['tokenSkinId'].casefold(), []).append(job)
            for key, ref, stem in prefabs:
                if stem.casefold().startswith('illust_'):
                    continue  # a summon outfit's 立绘 prefab, not a model
                group = by_skin.get(stem.casefold())
                if not group:
                    # a prefab the official tokenSkinMap gives no owner outfit of this summon in this run; one this run
                    # leaves out (--limit) is not a map miss
                    if stem.casefold() not in known:
                        log(f'skip (not in tokenSkinMap) {bundle.name}: {key.rsplit("/", 1)[-1]}')
                    continue
                try:
                    nodes = prefab_spine_nodes(ref.read_typetree(), objects)
                except Exception as err:
                    log(f'warn {bundle.name}: {err}')
                    continue
                for job in group:
                    try:
                        files[('tokens', job['char'], job['skinId'])].update(_faces(objects, nodes, job, stage, log))
                    except Exception as err:
                        log(f'warn {job["tokenSkinId"]}: {err}')
            for job in by_token[tid]:
                got = files[('tokens', job['char'], job['skinId'])]
                if not got.get('front'):
                    # Two official tokens are marker units with no model by design: one pins an enemy to a tile, the
                    # other is the marker a skill leaves on the original tile after moving and jumping back. Their
                    # prefab has no SkeletonData, so the skip is expected rather than a missing extraction.
                    log(f'skip (model not extracted) {job["tokenSkinId"]}')
                    continue
                rec = record(job, got)
                if rec is None:
                    log(f'skip (nothing found) {job["tokenSkinId"]}')
                    continue
                new['tokens'][(job['char'], job['skinId'])] = rec
        # move each finished outfit into a part that stays inside the cosmetic ceilings; the operators' outfits first,
        # then the summons' into what room their parts have left (one Budget per part for both)
        budgets = {n: Budget(dest / part_folder(n)) for n in set(parts['chars']) | set(parts['tokens'])}
        home = {c: {(owner, sid): (n, rec) for n, table in parts[c].items() for owner, recs in table.items()
                    for sid, rec in recs.items()} for c in ('chars', 'tokens')}
        for container, group in (('chars', jobs), ('tokens', tokens)):
            for job in group:
                sid = job['skinId']
                rec = new[container].get((job['char'], sid))
                if rec is None:
                    continue
                size = folder_size(stage / job['dir'])
                was, old_rec = home[container].get((job['char'], sid), (None, None))
                old_dir = record_dir(old_rec) if old_rec else None
                spare = max(list(budgets) + [0]) + 1
                target = None
                for n in ([was] if was else []) + [k for k in sorted(budgets) if k != was] + [spare]:
                    folder = dest / part_folder(n)
                    budget = budgets.get(n) or Budget(folder)
                    dst = folder / job['dir']
                    need = (size[0], size[1], size[2] + (0 if dst.parent.is_dir() else 1))
                    if budget.take(need, folder_size(folder / old_dir) if n == was and old_dir else (0, 0, 0)):
                        budgets[n], target = budget, n
                        break
                if target is None:
                    log(f'skip (larger than a cosmetic plugin: {PLUGIN_BYTES >> 20} MB / {PLUGIN_FILES} files) {sid}')
                    continue
                folder = dest / part_folder(target)
                if was:
                    gone[container].setdefault(was, set()).add((job['char'], sid))
                    if was != target:
                        budgets[was].take((0, 0, 0), folder_size(dest / part_folder(was) / old_dir) if old_dir else (0, 0, 0))
                    _remove(dest / part_folder(was), old_dir)
                _remove(folder, job['dir'])
                (folder / job['dir']).parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(stage / job['dir']), str(folder / job['dir']))
                placed[container].setdefault(target, {}).setdefault(job['char'], {})[sid] = rec
                written[(container, job['char'], sid)] = size[1]
                # a summon outfit is logged by its tokenSkinId, as _faces and the skip lines name it; an outfit by its
                # skin id
                log(f'{job.get("tokenSkinId") or sid} {job["name"]} -> {SUB}/{part_folder(target)}/{job["dir"]} '
                    f'({size[1]} files{", pictures only" if "spine" not in rec else ""})')
    finally:
        shutil.rmtree(stage, ignore_errors=True)
        _drop_if_empty(dest)
    if not written:
        log('skins: nothing extracted')
        return 0
    count = sum(written.values())
    finished = []
    for n in sorted({k for c in ('chars', 'tokens') for k in set(placed[c]) | set(gone[c])}):
        folder = dest / part_folder(n)
        tables = {}
        for container in ('chars', 'tokens'):
            kept = {cid: {sid: r for sid, r in recs.items() if (cid, sid) not in gone[container].get(n, ())}
                    for cid, recs in parts[container].get(n, {}).items()}
            tables[container] = merge(kept, placed[container].get(n, {}), _alive(folder))
        if not tables['chars'] and not tables['tokens']:  # every record of this part moved to another one
            shutil.rmtree(folder, ignore_errors=True)
            log(f'skins: {part_folder(n)} emptied and removed')
            continue
        (folder / ASSETS_FILE).write_text(json.dumps(overlay(tables['chars'], tables['tokens']), ensure_ascii=False,
                                                     indent=1) + '\n', encoding='utf-8')
        (folder / PLUGIN_FILE).write_text(json.dumps(manifest(tables['chars'], installed, version, n, tables['tokens'],
                                                             installed_tokens), ensure_ascii=False, indent=1) + '\n',
                                          encoding='utf-8')
        count += 2
        finished.append(folder)
        log(f'skins: {part_folder(n)} holds {sum(len(v) for v in tables["chars"].values())} outfits and '
            f'{sum(len(v) for v in tables["tokens"].values())} summon outfits')
    # every part's plugin.json and skins.json are written before the first pack: a pack that fails leaves no part
    # without its manifest
    for folder in finished if pack_root is not None else ():
        pack(folder, pack_root, log)
    log(f'skins: {len(written)} outfits and summon outfits extracted -> {dest}; copy its part folders into plugins/ to '
        'use them')
    return count


def pack(folder, root, log):
    """`node tools/plugin.mjs pack <folder>`: the lock (files' hashes, every model's clip data) and the plugin check.
    Never raises: a pack that did not run or failed is a warning with the command to run by hand."""
    tool = Path(__file__).resolve().parents[2] / 'tools' / 'plugin.mjs'
    try:
        r = subprocess.run(['node', str(tool), 'pack', str(folder), '--root', str(root)], capture_output=True,
                           timeout=900)
    except (OSError, ValueError, subprocess.SubprocessError) as err:
        log(f'warn: plugin pack did not run ({err}); run node tools/plugin.mjs pack {folder}')
        return False
    # node writes UTF-8 to a pipe on every OS. Not the locale's code page (text=True): cp936 on a Chinese Windows fails
    # on a folder path such as D:\卫戍协议\… in "wrote plugin.lock.json" and on the check's Chinese findings
    out = (r.stdout + r.stderr).decode('utf-8', 'replace')
    for line in out.splitlines()[-12:]:
        log(f'  pack: {line}')
    if r.returncode:
        log(f'warn: plugin pack exited {r.returncode}; fix and run node tools/plugin.mjs pack {folder}')
    return r.returncode == 0


# ------------------------------------------------------------------------------------------- --only library
def export_library(ab_root, out_root, log, kinds, limit=0):
    """The gallery kinds → <out_root>/library/<kind>/ (each kind replaced as a whole once it wrote a picture; its own
    set of official names, so a name is written once per kind) and library/index.json
    { format, kinds: { <kind>: { <official name>: { path, w, h } } } }; returns the number of pictures."""
    import aklz4  # noqa: F401
    import UnityPy

    dest = Path(out_root) / LIB_SUB
    index = {'format': FORMAT, 'kinds': {}}
    if (dest / LIB_INDEX).is_file():
        try:
            prev = json.loads((dest / LIB_INDEX).read_text(encoding='utf-8'))
            index['kinds'] = {k: v for k, v in (prev.get('kinds') or {}).items() if k in LIB_KINDS}
        except (OSError, ValueError) as err:
            log(f'warn {dest / LIB_INDEX}: unreadable ({err})')
    total = 0
    for kind in kinds:
        stage = _stage(dest, kind)
        seen, taken, entries = set(), set(), {}

        def put(name, img, illust, stage=stage, seen=seen, taken=taken, entries=entries, kind=kind):
            seen.add(name)
            fname = save_picture(img, stage, unique(plugin_safe(name), taken), illust)
            entries[name] = {'path': f'{kind}/{fname}', 'w': img.width, 'h': img.height}

        try:
            if kind == 'opillust':
                for glob in ILLUST_PACKS:
                    for bundle in sorted(Path(ab_root).glob(glob)):
                        if limit and len(entries) >= limit:
                            break
                        try:
                            env = UnityPy.load(str(bundle))
                            objects = {o.path_id: o for o in env.objects}
                            refs = sorted(env.container.items())
                        except Exception as err:
                            log(f'warn {bundle.name}: {err}')
                            continue
                        for key, ref in refs:
                            m = ILLUST_PREFAB.search(key)
                            if not m or m.group(1) in seen or (limit and len(entries) >= limit):
                                continue
                            try:
                                sprite, alpha = prefab_image(ref.read_typetree(), objects)
                                if sprite is not None:
                                    put(m.group(1), illust_raster(sprite.read(), alpha), True)
                            except Exception as err:
                                log(f'warn {bundle.name} {m.group(1)}: {err}')
            else:
                # [ASSUMED] the gallery's 头像 are every Sprite of ui_char_avatar_*: summons and NPCs too, not only the
                # operators (the 半身像 likewise every Sprite of char_portrait_*)
                for bundle, obj in _sprites(ab_root, PORTRAITS if kind == 'opportrait' else AVATARS, log):
                    if limit and len(entries) >= limit:
                        break
                    try:
                        name = _sprite_name(obj)
                        if name and name not in seen:
                            put(name, obj.read().image, False)
                    except Exception as err:
                        log(f'warn {bundle} sprite: {err}')
            if entries:
                if (dest / kind).exists():
                    shutil.rmtree(dest / kind)
                dest.mkdir(parents=True, exist_ok=True)
                shutil.move(str(stage), str(dest / kind))
                index['kinds'][kind] = dict(sorted(entries.items()))
                total += len(entries)
            log(f'library/{kind}: {len(entries)} pictures')
        finally:
            shutil.rmtree(stage, ignore_errors=True)
    _drop_if_empty(dest)
    if total:
        index['kinds'] = dict(sorted(index['kinds'].items()))
        (dest / LIB_INDEX).write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    return total
