#!/usr/bin/env python3
"""Run the archived 0.4.0 theme producer (card.json) without touching current dev.

The files in this directory are the producer from archive branch
`feat/autochess-card-webgl` @ 0157ba29, kept isolated because current dev's
`autochess_themes.py` writes layout/prefabs only.  This runner writes to an
explicit temp output directory; it never writes public/assets or the current
extract.py output.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parent
# Legacy first: autochess_themes / card_prefab / shop_prefab / unity_deps are the archived 0.4.0 producer. Then the
# current extractor's directory for the modules it shares (ui_components.py, aklz4.py), so this runner works on its own.
for entry in (TOOLS, HERE):
    path = str(entry)
    if path in sys.path:
        sys.path.remove(path)
    sys.path.insert(0, path)  # HERE ends first: the archive's modules win over the current extractor's
import autochess_themes  # noqa: E402


def _game_data(raw):
    p = Path(raw)
    if p.name == 'Arknights_Data':
        return p
    child = p / 'Arknights_Data'
    if child.is_dir():
        return child
    for parent in p.parents:
        if parent.name == 'Arknights_Data':
            return parent
    raise SystemExit(f'not an Arknights_Data install: {raw}')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--game', required=True, help='install root or Arknights_Data')
    ap.add_argument('--themes', action='append', required=True,
                    help='AB root holding the theme / battle bundles (repeatable)')
    ap.add_argument('--out', required=True, help='temporary output root (writes out/themes/<id>)')
    ap.add_argument('--repo-root', default=str(Path.cwd()), help='repository with data/assets.json')
    ap.add_argument('--theme', default='ac_s_closur')
    args = ap.parse_args()
    game = _game_data(args.game)
    ab_root = game / 'StreamingAssets/AB/Windows'
    manifest = {}
    count = autochess_themes.export_themes(
        args.themes, Path(args.out), manifest, print, [args.theme], Path(args.repo_root), game_root=ab_root)
    print(f'legacy theme files: {count}; manifest groups={len(manifest)}')
    return 0 if count else 1


if __name__ == '__main__':
    sys.exit(main())
