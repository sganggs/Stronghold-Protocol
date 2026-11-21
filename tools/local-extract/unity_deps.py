"""Cross-file PPtr resolution for the official UI bundles (CAB index + injecting dependency files).

A prefab bundle does not carry the objects its pointers name. A `PPtr` with `m_FileID == 0` points inside the
SerializedFile that owns it; `m_FileID == n > 0` indexes that file's `externals[n-1]`, whose path ends in
`CAB-<32 hex>` (`Library/unity default resources` are Unity built-ins and are never in a bundle). UnityPy's
`PPtr.deref()` resolves an external by looking the lower-cased CAB name up in the owning BundleFile's `files`
dict, so resolution means two steps:

1. **CAB → bundle.** The CAB name is not searchable in a bundle's bytes (its data blocks are compressed), so the
   only way is to read every bundle's BlocksInfo — the header plus the nodes/block table, never the asset data.
   `index_bundles()` does exactly that and caches the result, because a full scan of an install takes minutes.
   Hot-update copies win over the shipped ones, and a merged mirror loses to both: the newest file is what the
   client loads.
2. **Inject.** Load the dependency bundle, hand its SerializedFile to the *owning* bundle's `files` dict under the
   lower-cased CAB name, and repeat for the dependency's own externals (a material in one bundle, its texture in
   another). `attach()` returns the unresolved externals so a caller can report them instead of guessing.

After injection `env.objects` also walks the dependency files. Anything that means "this bundle's own objects"
must read `serialized_file.objects` instead; the prefab tree is one of those.
"""

import json
import os
import re
import struct
from pathlib import Path

CACHE_VERSION = 1
CACHE_NAME = 'ab-cab-index.json'
# Roots are scanned in this priority order: a hot-updated bundle wins over the shipped copy of the same CAB.
PRIORITY = ('persistentdata', 'ab\\windows\\', 'ab/windows/')
SKIP_DIRS = frozenset({'.git', 'node_modules'})
MAX_DEPTH = 4


def cache_path(repo_root):
    """The index cache: .cache/ is this repository's ignored local scratch directory."""
    override = os.environ.get('SP_AB_CAB_INDEX')
    if override:
        return Path(override)
    return Path(repo_root) / '.cache' / CACHE_NAME


def deps_disabled():
    """SP_NO_AB_DEPS=1 turns dependency resolution off: names of foreign objects are then absent, not wrong."""
    value = (os.environ.get('SP_NO_AB_DEPS') or '').strip().lower()
    return value not in ('', '0', 'false', 'no', 'off')


def _cstr(buf, pos):
    end = buf.index(b'\x00', pos)
    return buf[pos:end].decode('utf-8', 'replace'), end + 1


def _decompress(blob, size, flags):
    """BlocksInfo decompression: the same map UnityPy uses, which aklz4() extends with LZ4AK."""
    from UnityPy.enums.BundleFile import CompressionFlags
    from UnityPy.helpers import CompressionHelper

    return CompressionHelper.DECOMPRESSION_MAP[CompressionFlags(flags & 0x3F)](blob, size)


def _needs_align(version, engine):
    if version >= 7:
        return True
    numbers = tuple(int(x) for x in re.findall(r'\d+', engine)[:3])
    return len(numbers) > 2 and numbers[0] == 2019 and numbers >= (2019, 4, 15)


def bundle_cabs(path):
    """CAB names a UnityFS bundle holds, or None when the file is not a readable bundle.

    Reads the header and the BlocksInfo only (node names + the block table): no asset data is decompressed, so a
    scan over an install is I/O-bound.
    """
    with open(path, 'rb') as handle:
        head = handle.read(4096)
    if head[:7] != b'UnityFS':
        return None
    pos = 8
    version = struct.unpack_from('>I', head, pos)[0]
    pos += 4
    _player, pos = _cstr(head, pos)
    engine, pos = _cstr(head, pos)
    _total, compressed, uncompressed, flags = struct.unpack_from('>qIII', head, pos)
    pos += 20
    if _needs_align(version, engine):
        pos = (pos + 15) & ~15
    with open(path, 'rb') as handle:
        if flags & 0x80:
            handle.seek(os.path.getsize(path) - compressed)
        else:
            handle.seek(pos)
        blob = handle.read(compressed)
    if len(blob) != compressed or not compressed:
        return None
    info = _decompress(blob, uncompressed, flags)
    cursor = 16
    blocks = struct.unpack_from('>i', info, cursor)[0]
    cursor += 4 + 10 * blocks
    count = struct.unpack_from('>i', info, cursor)[0]
    cursor += 4
    if not 0 <= count < 100000:
        return None
    names = []
    for _ in range(count):
        cursor += 20
        name, cursor = _cstr(info, cursor)
        if name.startswith('CAB-'):
            names.append(name)
    return names


def _walk_bundles(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in SKIP_DIRS]
        for filename in filenames:
            if filename.endswith(('.idx', '.json', '.txt', '.hash')):
                continue
            yield Path(dirpath) / filename


def _rank(path):
    low = str(path).replace('/', '\\').lower()
    for index, token in enumerate(PRIORITY):
        if token in low:
            return index
    return len(PRIORITY)


def index_bundles(roots, cache=None, log=print, force=False):
    """CAB name → bundle path, from a cached scan of `roots` (absolute directories or single bundle files)."""
    wanted = [str(Path(root).resolve()) for root in roots]
    cache = Path(cache) if cache is not None else None
    if cache is not None and not force:
        cached = _read_cache(cache)
        if cached is not None and cached.get('roots') == wanted:
            log(f'cab index: {len(cached["cabs"])} bundles cached in {cache}')
            return cached['cabs']
    found = {}
    scanned = 0
    for root in wanted:
        path = Path(root)
        files = [path] if path.is_file() else list(_walk_bundles(path))
        for file in files:
            scanned += 1
            try:
                names = bundle_cabs(file)
            except Exception:  # noqa: BLE001  a damaged or unusual file is not an error for the index
                continue
            if not names:
                continue
            for name in names:
                found.setdefault(name, []).append(str(file))
    best = {}
    for name, paths in found.items():
        best[name] = sorted(paths, key=lambda one: (_rank(one), one))[0]
    if cache is not None:
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps({'version': CACHE_VERSION, 'roots': wanted, 'cabs': best},
                                        ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        except OSError as err:
            log(f'warn cab index: cannot write {cache} ({err})')
    log(f'cab index: scanned {scanned} files, {len(best)} bundles -> {cache if cache is not None else "memory"}')
    return best


def _read_cache(cache):
    try:
        doc = json.loads(Path(cache).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or doc.get('version') != CACHE_VERSION or not isinstance(doc.get('cabs'), dict):
        return None
    return doc


def cab_of(external_path):
    """`archive:/CAB-<hex>/CAB-<hex>` → `CAB-<hex>`; Unity built-ins → None."""
    text = str(external_path or '')
    if text.startswith('archive:/'):
        text = text[len('archive:/'):]
    if text.startswith('assets/'):
        text = text[len('assets/'):]
    name = text.rsplit('/', 1)[-1]
    return name if name.startswith('CAB-') else None


def own_serialized_file(env):
    """The SerializedFile this env's bundle holds (the theme bundles hold exactly one)."""
    for bundle_file in (getattr(env, 'files', None) or {}).values():
        for entry in (getattr(bundle_file, 'files', None) or {}).values():
            if hasattr(entry, 'objects'):
                return bundle_file, entry
    return None, None


class Deps:
    """Loads a bundle and grafts its external dependencies onto it, so PPtr.deref() reaches across files."""

    def __init__(self, index, log=print):
        self.index = index or {}
        self.log = log
        self._envs = {}
        self._threads = {}
        self.unresolved = []

    def load(self, path, depth=0, chain=(), attach=True):
        """(env, bundle_file, serialized_file) for a bundle, its own externals grafted in.

        `attach=False` returns the bundle before injection, which is how a caller captures the bundle's own
        container paths before dependency objects join `env.container`.
        """
        path = str(Path(path).resolve())
        if path in self._envs:
            return self._envs[path]
        import aklz4  # noqa: F401
        import UnityPy

        env = UnityPy.load(path)
        bundle_file, serialized = own_serialized_file(env)
        self._envs[path] = (env, bundle_file, serialized)
        if attach and bundle_file is not None and serialized is not None and depth < MAX_DEPTH:
            self._attach(bundle_file, serialized, os.path.basename(path), depth, chain + (path,))
        return self._envs[path]

    def _attach(self, bundle_file, serialized, label, depth, chain):
        for position, external in enumerate(serialized.externals):
            cab = cab_of(external.path)
            if cab is None:
                continue
            if any(str(key).lower() == cab.lower() for key in bundle_file.files):
                continue
            target = self.index.get(cab)
            if not target or Path(target).resolve() in chain:
                self._note('no bundle carries this CAB', label, position + 1, cab, external.path)
                continue
            try:
                _env, _bundle, serialized_dep = self.load(target, depth + 1, chain)
            except Exception as err:  # noqa: BLE001
                self._note(f'load failed: {err}', label, position + 1, cab, external.path)
                continue
            if serialized_dep is None:
                self._note('bundle holds no SerializedFile', label, position + 1, cab, external.path)
                continue
            bundle_file.files[cab.lower()] = serialized_dep
            bundle_file.files[(cab + '.ress').lower()] = serialized_dep

    def _note(self, reason, label, file_id, cab, path):
        entry = {'bundle': label, 'fileId': file_id, 'cab': cab, 'path': path, 'reason': reason}
        if entry not in self.unresolved:
            self.unresolved.append(entry)

    def attach(self, env):
        """Graft the externals of an already-loaded env. Returns the bundle's own SerializedFile."""
        bundle_file, serialized = own_serialized_file(env)
        if bundle_file is not None and serialized is not None:
            label = None
            for path, cached in self._envs.items():
                if cached[0] is env:
                    label = os.path.basename(path)
                    break
            self._attach(bundle_file, serialized, label or '?', 0, ())
        return serialized
