#!/usr/bin/env bash
# aldus/sync-art.sh — copy the downloaded art, audio and fonts to the bucket that the imprint reads them from.
#
#   node tools/fetch-assets.mjs          the download into public/assets and public/fonts (git-ignored)
#   aldus/sync-art.sh <credentials>      this script
#
# <credentials> is a file of mode 600 with these lines (an S3 key of the bucket; never an argument, never in git):
#
#   AWS_ACCESS_KEY_ID=…
#   AWS_SECRET_ACCESS_KEY=…
#   R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
#   R2_BUCKET=<bucket>
#
# The keys in the bucket are the addresses of the manifest (data/assets.json) without the first slash:
# public/assets/char/avatar/x.png → assets/char/avatar/x.png, public/fonts/fonts.css → fonts/fonts.css. So the public
# address of the bucket is the origin that aldus/build.mjs puts in front of each address (ASSET_ORIGIN there).
#
# A file that is in the bucket and not on this machine stays in the bucket: the script never deletes. The art of a
# local game client (public/assets/local) is not copied: the build has no manifest for it.
set -euo pipefail

creds="${1:?usage: aldus/sync-art.sh <credentials file>}"
[ "$(stat -c %a "$creds")" = "600" ] || { echo "✖ $creds must have mode 600" >&2; exit 2; }
root="$(cd "$(dirname "$0")/.." && pwd)"
[ -d "$root/public/assets" ] || { echo "✖ public/assets is missing: run node tools/fetch-assets.mjs" >&2; exit 2; }

set -a
# shellcheck disable=SC1090
. "$creds"
set +a
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
# R2 does not take the checksums that a new aws CLI adds to each request
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

# one day, as server/index.js answers for /assets and /fonts (LONG_CACHE)
cache="public, max-age=86400"
sync() { aws s3 sync "$@" --endpoint-url "$R2_ENDPOINT" --cache-control "$cache" --only-show-errors; }

# the aws CLI knows no type for the two Spine formats, so each gets its type by name
sync "$root/public/assets" "s3://$R2_BUCKET/assets" --exclude "local/*" --exclude "*.atlas" --exclude "*.skel"
sync "$root/public/assets" "s3://$R2_BUCKET/assets" --exclude "*" --include "*.atlas" --exclude "local/*" --content-type "text/plain; charset=utf-8"
sync "$root/public/assets" "s3://$R2_BUCKET/assets" --exclude "*" --include "*.skel" --exclude "local/*" --content-type "application/octet-stream"
[ -d "$root/public/fonts" ] && sync "$root/public/fonts" "s3://$R2_BUCKET/fonts"

aws s3 ls "s3://$R2_BUCKET/" --recursive --summarize --endpoint-url "$R2_ENDPOINT" | tail -2
