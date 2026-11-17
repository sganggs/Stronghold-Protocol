#!/usr/bin/env python3
"""Local-only extraction of the few Unity Font assets the autochess theme reads.

The repository is not a font distributor: this writes under `public/assets/local/fonts/`
(ignored by git), never `public/fonts/`, and never edits the distributed `fonts.css` or
`THIRD-PARTY-NOTICES.md`.  Callers must treat a missing file as "use the original/system
font": this module never raises for a missing source and never overwrites a file whose
bytes differ from the pinned SHA-256.

Sources (CN client):
  - NotoSansHans-Medium      -> Arknights_Data/sharedassets1.assets
  - SourceHanSansCN-Heavy    -> Arknights_Data/sharedassets3.assets
  - SourceHanSansCN-Bold     -> Arknights_Data/StreamingAssets/AB/Windows/anon/efde...bin
                               (premain/arts/ui/common/fonts/sourcehansanscn-bold.ab; OTF)
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

# Keep this table small and explicit; a name outside it is never written.
FONT_SPECS = (
    {
        'name': 'SourceHanSansCN-Bold',
        'file': 'SourceHanSansCN-Bold.otf',
        'ext': 'otf',
        'family': 'SourceHanSansCN-Bold',
        'weight': 700,
        'bytes': 8608184,
        'sha256': '97e5eff6dd208ccb814726458c8c7ab4b59327c62b9ee8df3440e7e835209ab9',
        'anon': 'StreamingAssets/AB/Windows/anon/efde504013a78a96671e2f4bb736ac48.bin',
        'path_id': -4708693146538353618,
    },
    {
        'name': 'SourceHanSansCN-Heavy',
        'file': 'SourceHanSansCN-Heavy.otf',
        'ext': 'otf',
        'family': 'SourceHanSansCN-Heavy',
        'weight': 900,
        'bytes': 2566652,
        'sha256': '47e67e10ae78bf377b3791a3cde21af237069f263113c8376f5c410cea044288',
    },
    {
        'name': 'NotoSansHans-Medium',
        'file': 'NotoSansHans-Medium.ttf',
        'ext': 'ttf',
        'family': 'NotoSansHans-Medium',
        'weight': 500,
        'bytes': 8389940,
        'sha256': '25033438cfa41f1873d4902b8555956557b765117756bcef96406e023e49578c',
    },
)


def _as_bytes(raw):
    """UnityPy Font.m_FontData: bytes, dict(Array/m_Data/data), or list[int]."""
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray, memoryview)):
        return bytes(raw)
    if isinstance(raw, dict):
        for key in ('Array', 'm_Data', 'data', 'bytes', 'value'):
            if key in raw and raw[key] is not None:
                return _as_bytes(raw[key])
        return None
    if isinstance(raw, (list, tuple)):
        try:
            return bytes(int(v) for v in raw)
        except (TypeError, ValueError):
            return None
    try:
        return bytes(raw)
    except (TypeError, ValueError):
        return None


def _sfnt_ok(data):
    if not data or len(data) < 12:
        return False
    return data[:4] in (b'\x00\x01\x00\x00', b'OTTO', b'true', b'ttcf')


def locate_game_data(raw, ab_root=None):
    """Find Arknights_Data from --game (install/Arknights_Data) or the resolved AB root."""
    for candidate in (raw, ab_root):
        if not candidate:
            continue
        p = Path(candidate)
        try:
            p = p.resolve()
        except OSError:
            pass
        if p.name == 'Arknights_Data' and p.is_dir():
            return p
        child = p / 'Arknights_Data'
        if child.is_dir():
            return child
        for parent in p.parents:
            if parent.name == 'Arknights_Data' and parent.is_dir():
                return parent
    return None


def _read_fonts(game_data):
    """name -> (bytes, file, path_id); built-in *.assets plus registered anon/*.bin bundles."""
    import aklz4  # noqa: F401  registers LZ4AK
    import UnityPy

    sources = [p for p in sorted(Path(game_data).glob('*.assets'))]
    # Bold lives in a hash-named anon bundle, not in a *.ab: use the registered carrier,
    # not a blind Font-name/size scan.
    anon = {s['anon']: s['name'] for s in FONT_SPECS if s.get('anon')}
    for rel, name in anon.items():
        src = Path(game_data) / rel
        if src.is_file():
            sources.append(src)
        else:
            print(f'warn: font source missing {rel} ({name}); fallback stays active', file=sys.stderr)
    found = {}
    for src in sources:
        try:
            env = UnityPy.load(str(src))
        except Exception as exc:  # a broken source must not block the others
            print(f'warn: font source {src.name}: {type(exc).__name__}: {exc}', file=sys.stderr)
            continue
        for obj in env.objects:
            if obj.type.name != 'Font':
                continue
            try:
                data_obj = obj.read()
                name = str(getattr(data_obj, 'm_Name', '') or '')
                raw = _as_bytes(getattr(data_obj, 'm_FontData', None))
            except Exception as exc:
                print(f'warn: font object {src.name}/{obj.path_id}: {type(exc).__name__}: {exc}', file=sys.stderr)
                continue
            if name in {s['name'] for s in FONT_SPECS} and raw:
                found.setdefault(name, (raw, str(src), obj.path_id))
    return found


def export_fonts(game_root, out_root, manifest, log=print, only=None):
    """Extract pinned fonts to <out_root>/fonts and add an optional local manifest group.

    Existing files are compared by SHA-256 and left alone when equal.  A byte mismatch is
    reported and never overwritten.  Returns the number of files written (0 on all skips).
    """
    game_data = locate_game_data(game_root)
    if game_data is None:
        log('skip fonts: no Arknights_Data directory (local font fallback stays active)')
        return 0
    found = _read_fonts(game_data)
    wanted = {s['name'] for s in FONT_SPECS}
    if only:
        wanted &= {s['name'] for s in FONT_SPECS if s['name'] in only}
    out_dir = Path(out_root) / 'fonts'
    out_dir.mkdir(parents=True, exist_ok=True)
    group = {}
    written = 0
    for spec in FONT_SPECS:
        if spec['name'] not in wanted:
            continue
        target = out_dir / spec['file']
        source = found.get(spec['name'])
        target_sha = ''
        target_bytes = 0
        if target.is_file():
            target_bytes = target.stat().st_size
            target_sha = hashlib.sha256(target.read_bytes()).hexdigest()
        if source is None:
            # Missing source: never guess, never touch an existing local file.
            log(f'skip font {spec["name"]}: source not found; no write, caller falls back')
            continue
        raw, src_file, path_id = source
        if not _sfnt_ok(raw):
            log(f'skip font {spec["name"]}: source is not sfnt ({src_file}/{path_id}, {len(raw)} B)')
            continue
        source_sha = hashlib.sha256(raw).hexdigest()
        if len(raw) != spec['bytes'] or source_sha != spec['sha256']:
            log(f'conflict font {spec["name"]}: source {len(raw)} B {source_sha[:12]} != pinned')
            continue
        if target.is_file():
            if target_bytes == spec['bytes'] and target_sha == spec['sha256']:
                log(f'keep font {spec["name"]}: local bytes already match ({target_bytes} B)')
            else:
                log(f'conflict font {spec["name"]}: local {target_bytes} B {target_sha[:12]} != pinned; not overwritten')
                continue
        else:
            target.write_bytes(raw)
            written += 1
            log(f'write font {spec["name"]}: {target} ({len(raw)} B)')
        group[spec['name']] = {
            'path': f'/assets/local/fonts/{spec["file"]}',
            'bytes': spec['bytes'],
            'sha256': spec['sha256'],
            'family': spec['family'],
            'weight': spec['weight'],
            'kind': 'Font',
        }
    if group:
        manifest.setdefault('fonts', {}).update(group)
    return written
