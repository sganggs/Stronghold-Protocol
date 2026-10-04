# Aldus imprint of the browser client

Everything that makes this project deployable on [Aldus](https://aldus.vikala.io) lives in this folder. Aldus serves
static files only: one imprint, at `https://stronghold.apps.vikala.io/`, built from the same sources the Node server
serves.

**This repository is a fork.** No file outside `aldus/` is moved or changed for the deployment, so updates from the
original project merge as before. The usual Aldus layout (`frontend/` and `backend/`) is deliberately not used here.

Status: the page is live as a trial (section "Live"). The socket backend in `worker/` is deployed on the same host.
The art is in a bucket (section "The art").

| File | What |
|---|---|
| `imprint.json` | The imprint: its name, the storage that keeps its builds, the build command, the outside hosts the page may load from. |
| `build.mjs` | Assembles `dist/` from `public/`, `data/`, `shared/` and `server/sim/`. Its header comment is the reference. |
| `build.test.js` | The build's tests. `node --test` at the repository root runs them too. |
| `package.json` | The one dependency of the build: `@pixi/unsafe-eval`, pinned to the PixiJS version. |
| `sync-art.sh` | Copies the downloaded art, audio and fonts to the bucket that the page reads them from. |
| `WS-EVENTS.md` | What the client and the game server send each other during a game, with measured sizes: the map for the socket backend. |
| `WS-STATE.md` | For each client message: the state that changes in the backend, how a Durable Object would keep it, and the answer (`send()` or `broadcast()`). |
| `worker/` | The socket backend, a prototype: a Rust Cloudflare Worker with one Durable Object that runs the original match engine. Its own `README.md` has the build, the tests and the limits. |
| `i18n/` | The second language of the page: an English catalog for the interface text, a runtime that changes the text on the page, and a tool that shows the coverage. English is the default. |
| `dist/` | The output (git-ignored). |

## Build and check

```bash
npm install                    # at the repository root: the client libraries (public/vendor)
npm install --prefix aldus     # the PixiJS patch
node aldus/build.mjs           # → aldus/dist, about 180 files and 11 MB
aldus -C aldus -e production check
node --test aldus/build.test.js
```

`aldus check` reports one warning, IMP-22 on `vendor/pixi.min.js`. It is expected: PixiJS still contains the
`new Function` calls, and the patch below keeps the page from reaching them.

## What the build does

The Node server answers the client's URLs from five places. The build lays the same URLs out as one folder:

| URL | From |
|---|---|
| `/` | `public/`, without `dev/`, `assets/` and `fonts/` |
| `/data/` | `data/*.json` |
| `/shared/` | `shared/` |
| `/sim/` | `server/sim/**/*.js`, without the Node-only `nodeData.js` |
| `/data.js` | the shim string `server/index.js` exports |

These things are done to the copy, never to the sources:

1. **Inline event handlers.** An imprint's Content-Security-Policy refuses them. `public/index.html` has two; each
   becomes a data attribute plus a listener in one inline script, which the entry page may carry.
2. **PixiJS.** PixiJS 7 builds its uniform uploads with `new Function`, which the policy refuses, so the renderer
   would throw on its first shader. PixiJS's own patch for such pages is appended to the copy of
   `vendor/pixi.min.js`.
3. **`robots.txt`** refuses crawlers, because the project asks that an address goes to friends only.
4. **The interface text.** The entry page loads the i18n layer of `i18n/` before the game.
5. **The art.** Section "The art" has the four changes that point the page at the bucket.

## When the original project changes

Merge as usual, then build. The build stops, with the reason, when a change needs a decision here:

| The build says | Do |
|---|---|
| inline event handlers this build does not know | Add the handler to `KNOWN_HANDLERS` and `HANDLER_SCRIPT` in `build.mjs`. |
| PixiJS is X but … pins `@pixi/unsafe-eval` Y | Set the same version in `package.json`, then `npm install --prefix aldus`. PixiJS 8 needs no patch. |
| `server/index.js` no longer exports `DATA_SHIM_JS` | Read how `/data.js` is served now, and write that file in `build.mjs`. |
| the build breaks the imprint contract | A limit is passed (1,000 files, 100 MB, 25 MB a file), or a file has no extension. |
| `validSpine` no longer checks the Spine address the way this build knows | Read `validSpine` in `public/js/assets.js`. Change `SPINE_CHECK` in `build.mjs`. Make sure that a model at the asset origin loads. |
| `data/assets.json` has no `/assets/…` address, or no `fonts.faces` | Read how the manifest names its files now, and change `withAssetOrigin` or `fontsCss`. |
| `public/index.html` has an `<img>` of its own | Give that `<img>` the attribute `crossorigin` in the copy: `CORS_IMG_SCRIPT` covers only the images that a script makes. |

A new top-level folder the server starts to serve is not noticed by the build: compare `createStaticHandler` in
`server/index.js` with the table above after a large update.

## The art

The art, the audio and the fonts of the game are not in the imprint. `public/assets` is 4,014 files and 282 MB. An
imprint holds 1,000 files and 100 MB. The files are in a bucket, and the page reads them from its public address:

- **The bucket:** the R2 bucket `stronghold-protocol`.
- **The public address:** `https://assets.apps.vikala.io`. It is `ASSET_ORIGIN` in `build.mjs` and one of the
  `csp.hosts` of `imprint.json`.
- **CORS:** the bucket allows `GET` from `https://stronghold.apps.vikala.io`. The renderer reads the images and the
  Spine files with CORS.

A key of the bucket is an address of the manifest (`data/assets.json`) without its first slash:
`assets/char/avatar/<id>.png`, `fonts/bender-regular.woff2`.

To fill the bucket, or to update it after a new version of the game data:

```bash
node tools/fetch-assets.mjs              # the download into public/assets and public/fonts (git-ignored)
aldus/sync-art.sh <credentials file>     # the copy to the bucket; the header of the script has the format of the file
git checkout -- data/assets.json         # only if the download changed nothing but `stats.bytes`
```

The credentials file has an S3 key of the bucket. Keep it out of the repository, with mode 600.

The build makes four changes for the art:

1. **The manifest.** The client takes each address of the art and the audio from `data/assets.json`. The copy of the
   manifest has `ASSET_ORIGIN` in front of each `/assets/…` address.
2. **The Spine check.** `validSpine` in `public/js/assets.js` takes a Spine model only when its address is a path of
   the page. Without a change, each unit stays an avatar. The copy of that file also takes an address at
   `ASSET_ORIGIN`.
3. **The images of the interface.** One inline script makes each `<img>` ask with CORS. The bucket answers a request
   that has no `Origin` without the CORS header, and Chrome keeps that answer. The renderer then gets no access to an
   image that the interface showed before.
4. **The fonts.** `fonts/fonts.css` is written from `fonts.faces` of the manifest, with each font file at
   `ASSET_ORIGIN`.

The art of a local game client (`public/assets/local`) is not in the bucket.

## Not here yet

- **The storage of the socket backend.** `worker/` keeps its state in the memory only. A restart of its Durable
  Object stops each room.
- **The limits of the socket backend.** `worker/` has no rate limit. Its `README.md` has the list.
- **The new interface text of version 0.1.3.** 22 strings have no English translation. `node aldus/i18n/extract.mjs
  --missing` shows them.

## Deploy

The steps that change a live system follow the `aldus-heron-deploy-env` skill, with `aldus -C aldus -e production`
for the CLI and `--frontend aldus` for its `preflight.py`. A later deploy of the page is one command:

```bash
aldus -C aldus -e production deploy --build -m "what changed"
```

## Live

- **The page:** `https://stronghold.apps.vikala.io/`, a trial deploy. First deploy `01M444V165ZW1ZERBRA7N2PFX6`,
  on 2026-10-04.
- **The storage:** `stronghold` in Mouseion holds the builds, under `builds/<deploy>/`. It is shared, read and
  write, with the account of the app, `stronghold-imprint@vikala.io`.
- **The secrets:** `mouseion-token`. The imprint has no blocks, so it has no Heron key.
- **The deploy that is live:** `01M448CH8MCN97QXJ1GGV9Z4HN`, on 2026-10-04. Its source is version 0.1.3 of the
  original project. It has the i18n layer (English is the default locale) and the art from the bucket.
- **The socket backend:** the Worker `stronghold-ws` of `aldus/worker`, with the route
  `stronghold.apps.vikala.io/ws`. Version `ee0b194f-4465-4d84-b173-2d37f007f159`, deployed on 2026-10-04. Its engine
  and its lobby are version 0.1.3. Its state is in the memory only.
- **The page and the Worker must come from the same commit.** The browser and the Worker each run the simulation.
  Deploy the two together.
- **The art:** the bucket `stronghold-protocol` holds 4,021 files (282 MB), copied on 2026-10-04. Each address of the
  manifest is in the bucket.
- **Checked in a browser on 2026-10-04:** a solo match plays to the battle of round 2. The Spine models, the images,
  the sounds and the fonts come from the bucket, with no refused request. No script of the game breaks the policy.
  One script that is not part of the game is refused: the analytics beacon that Cloudflare adds to pages of this zone.
- **Checked with the conformance test on 2026-10-04:** the live Worker gives the same frames as the Node server of
  version 0.1.3 for the 78 steps of the script.
- `preflight.py` shows one item as missing, `backend/heron.json`. This is correct: the imprint has no blocks.
