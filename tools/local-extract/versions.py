"""Missing art in the union of official versions. Stage first, publish only absent files.

The existing extractor decodes the local client; fetch-assets --offline --add-only builds the web manifest.
No network and no default-art replacement. Full illustrations/outfits remain cosmetic-plugin assets, as today.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path


def publish(source, target):
    target = Path(target)
    if target.exists():
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation also protects an asset another worktree just supplied.
    try:
        with target.open('xb') as dst, Path(source).open('rb') as src:
            shutil.copyfileobj(src, dst)
    except FileExistsError:
        return False
    return True


def export_audio(ab_root, stage, destination, jobs, log):
    """AudioClip samples are decoded by UnityPy and encoded as the MP3s the existing web plan names."""
    import UnityPy
    if not jobs:
        return 0
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        log(f'skip audio ({len(jobs)} missing files): ffmpeg is not installed')
        return 0
    by_bundle, found, count = {}, set(), 0
    for job in jobs:
        by_bundle.setdefault(job['bundle'], {})[job['clip'].lower()] = job
    # Combat sounds are grouped into enmy_snd_* / player packs, not one bundle per sound. Match exact container paths.
    packed = {job['source'].lower().rsplit('.', 1)[0]: job for job in jobs if job['path'].startswith('audio/sfx/')
              and not (ab_root / job['bundle']).is_file()}
    for bundle in sorted((ab_root / 'audio').rglob('*.ab')) if packed else []:
        rel = bundle.relative_to(ab_root).as_posix()
        if '/voice' in rel or '/music/' in rel:
            continue
        try:
            env = UnityPy.load(str(bundle))
            for name in env.container:
                job = packed.pop(name.lower().rsplit('.', 1)[0], None)
                if job:
                    by_bundle.setdefault(rel, {})[job['clip'].lower()] = job
        except Exception as err:
            log(f'warn audio index {rel}: {err}')
        if not packed:
            break
    for rel, wanted in sorted(by_bundle.items()):
        if not (ab_root / rel).is_file():
            continue
        try:
            env = UnityPy.load(str(ab_root / rel))
            for obj in env.objects:
                if obj.type.name != 'AudioClip':
                    continue
                clip = obj.read()
                job = wanted.get(clip.m_Name.lower())
                if not job or job['path'] in found:
                    continue
                samples = clip.samples
                if len(samples) != 1:
                    log(f'skip audio {rel}/{clip.m_Name}: expected one sample, got {len(samples)}')
                    continue
                src = stage / 'audio.mp3'
                # [ASSUMED] MP3 quality 4 is the local encoding choice, not an official client bitrate.
                subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', 'pipe:0',
                                '-codec:a', 'libmp3lame', '-q:a', '4', str(src)],
                               input=next(iter(samples.values())), check=True, timeout=60)
                count += publish(src, destination / job['path'])
                found.add(job['path'])
        except Exception as err:
            log(f'warn audio {rel}: {err}')
    log(f'audio: {count} files added, {len(jobs) - len(found)} unavailable in this client')
    return count


def export(ab_root, out_root, groups, log, root):
    import aklz4  # noqa: F401
    import UnityPy
    import operators
    from extract import export_enemy_spines, export_token_spines

    root, out_root, ab_root = Path(root), Path(out_root), Path(ab_root)
    jobs = json.loads(subprocess.check_output(['node', str(root / 'tools/assets/versions.mjs'), str(root)], timeout=30))
    count = 0
    with tempfile.TemporaryDirectory(prefix='sp-version-art-') as tmp:
        stage, staged_groups = Path(tmp), {}
        chars, _ = operators.export(ab_root, stage, staged_groups, log, jobs['operators'])
        for cid, char in chars.items():
            for slot in ('avatar', 'avatarE2', 'portrait', 'portraitE2'):
                if char.get(slot):
                    src = stage / char[slot].removeprefix('/assets/local/')
                    kind = 'avatar' if slot.startswith('avatar') else 'portrait'
                    count += publish(src, out_root.parent / 'char' / kind / src.name)
            for face, model in char.get('spine', {}).items():
                for url in [model['skel'], model['atlas']] + model['textures']:
                    src = stage / url.removeprefix('/assets/local/')
                    count += publish(src, out_root.parent / 'spine/op' / cid / face / src.name)
        staged_groups = {}
        export_enemy_spines(ab_root, stage, staged_groups, log, jobs['enemies'])
        export_token_spines(ab_root, stage, staged_groups, log, jobs['tokens'])
        for group, files in staged_groups.items():
            for name in files:
                count += publish(stage / group / name, out_root / group / name)
            groups[group] = files
        # A bundle can hold many requested sprites; decode it only once.
        by_bundle = {}
        for job in jobs['sprites']:
            for pattern in job['bundles']:
                # Literal Unity bundle names contain brackets (not glob character classes).
                paths = ab_root.glob(pattern) if '*' in pattern else [ab_root / pattern]
                for bundle in paths:
                    if bundle.is_file():
                        by_bundle.setdefault(bundle, {})[job['name']] = job
        found = set()
        for bundle, wanted in sorted(by_bundle.items()):
            env = UnityPy.load(str(bundle))
            for obj in env.objects:
                if obj.type.name != 'Sprite':
                    continue
                sprite = obj.read()
                job = wanted.get(sprite.m_Name)
                if not job or job['path'] in found:
                    continue
                src = stage / 'sprite.png'
                sprite.image.save(src)
                count += publish(src, out_root.parent / job['path'])
                found.add(job['path'])
                log(f'{bundle.relative_to(ab_root)}: {sprite.m_Name} -> {job["path"]}')
        for job in jobs['sprites']:
            if job['path'] not in found:
                log(f'skip (not found) sprite {job["name"]}')
        count += export_audio(ab_root, stage, out_root.parent, jobs['audio'], log)
    return count
