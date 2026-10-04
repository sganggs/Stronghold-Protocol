# Stronghold Protocol: Alliance · 卫戍协议：盟约

An **unofficial fan remake** of *Stronghold Protocol: Alliance* (卫戍协议：盟约), the seasonal auto-chess tower-defense mode of *Arknights*. It runs in the browser with nothing for players to install, solo or as 1–4 player online co-op.

![version](https://img.shields.io/badge/version-0.1.2-2ea44f)
![license](https://img.shields.io/badge/code%20license-GPL--3.0--or--later-blue)
![node](https://img.shields.io/badge/node-22%20%7C%2024-339933)

**English** · [简体中文](README.md)

> [!NOTE]
> This page is a translation of [README.md](README.md), which is the maintained original.
> The game itself (every menu, card and tooltip) is in **Simplified Chinese**: names and descriptions come from the official CN data, and an English interface is still under discussion. To help you find your way around, this page gives the on-screen Chinese label in parentheses next to the English term.

## Disclaimer

> [!IMPORTANT]
> - This project is an **unofficial fan work** made by players. It has **no connection** with Shanghai Hypergryph Network Technology Co., Ltd. (Hypergryph), Yostar or their affiliates, and is neither authorised nor endorsed by them.
> - The names, characters, art, music, sound effects, text, data and other material of *Arknights* and *Stronghold Protocol* belong to their respective rights holders. This material is **not covered** by the project's GPL-3.0 licence; the GPL covers only the code written for this project.
> - For study, exchange and personal non-commercial use only. **Any form of profit is strictly forbidden**, including but not limited to: selling the project or its bundles, paid downloads or paid distribution, paid servers or paid hosting on someone's behalf, monetisation through ads / tips / memberships, and any other commercial use.
> - The source repository contains no game art or audio (only data generated from the official data tables and a few game screenshots, which the GPL does not cover either). The all-in-one bundle under [Releases](../../releases/latest) ships the assets for players' convenience; downloading it means you accept this disclaimer. Do not use the assets outside this project or redistribute them on their own. The full terms are in [NOTICE.md](NOTICE.md).
> - Rights holders who believe this project infringes their rights can get in touch through an issue, and the content concerned will be **removed immediately**.
> - The project is provided "as is", **without warranty of any kind**. Use it at your own risk.

| Co-op room | Strategy draft | Prep phase (shop / bonds) |
|---|---|---|
| ![Room](docs/img/room.jpg) | ![Strategy draft](docs/img/band-draft.jpg) | ![Prep phase](docs/img/prep.jpg) |
| **Deploy direction wheel** | **Combat** | **Final Assault** |
| ![Direction wheel](docs/img/facing-wheel.jpg) | ![Combat](docs/img/combat.jpg) | ![Final Assault](docs/img/final-assault.jpg) |

## Contents

- [Disclaimer](#disclaimer) · [Overview](#overview) · [Features](#features)
- [Quick start](#quick-start): [bundle](#option-1-all-in-one-bundle-recommended) · [from source](#option-2-run-from-source) · [system requirements](#system-requirements) · [ports and configuration](#ports-and-configuration) · [LAN play](#playing-with-friends-lan)
- [Playing over the internet](#playing-over-the-internet) · [Controls](#controls) · [Documentation](#documentation) · [Development and testing](#development-and-testing) · [Project layout](#project-layout)
- [License](#license) · [Credits and data sources](#credits-and-data-sources) · [Contributing](#contributing)

## Overview

*Stronghold Protocol: Alliance* is auto-chess plus tower defense. In the prep phase (休整期) you recruit operators at the Dispatch Center (调度中心), arrange your formation and hand out equipment. In the combat phase your operators deploy automatically and hold off the enemies pouring out of the red gates, and every enemy that gets through costs objective HP (目标生命值). This project recreates the mode in the browser, with rules and numbers checked against the official data tables and PRTS wherever possible.

- **Solo** (独立模拟) and **co-op** (同盟模拟): 1–4 players **cooperating**, with no PvP. Empty seats can be filled with AI teammates.
- The server is a single Node.js program and **combat is simulated in each player's browser**, as in the official game. The server only handles the economy and the round flow, so a low-power mini PC is enough to host.
- The current version is 0.1.2, which fixes the issues reported on GitHub after 0.1.1; see [CHANGELOG.md](CHANGELOG.md) (Chinese). A few rules are still implemented by inference. If something differs from the official game, please report it in an issue.

## Features

- **A complete run**: confirm the match info → strategy draft (40 strategies) → 14 rounds → result titles. On 险境 difficulty and above, meeting the condition opens round 15, the Hidden Core (隐秘核心).
- **4 difficulties**: 标准 / 险境 / 绝境 / 终极 (easiest to hardest), each with separate solo and co-op parameters, all taken from the official data.
- **Prep phase**: recruit, refresh, freeze and upgrade the Dispatch Center; the bench (整备区) and the temporary bench (临时整备区); drag from the bench onto the board to deploy, and choose a facing with the **direction wheel**. In co-op the recruitment pool is shared.
- **Elite promotion**: three copies of the same operator merge automatically into an elite (精锐) and grant one free recruit a tier higher.
- **Operators and loadouts**: 112 recruitable operators (plus their elites) with their skills, talents and traits. Before a match you can choose which skill each operator carries (all 283 skills are implemented by hand) and which module each elite uses.
- **Bonds and layers**: 23 bonds (盟约), made up of 8 faction core bonds and the additional bonds. Layers last for the whole run, up to 999 per bond.
- **Equipment and tactical cards**: equipment and Arts (法术). Identical equipment merges, and certain combinations grant bond effects; equipment issued to an operator is locked onto that operator. Some rounds open with a 机变 card draft (equipment, funds, operators, layers, bounties and more).
- **Auto-combat**: skills fire automatically following the official "skill strategy" (技能策略). Blocking goes by contact radius, and when a blocker falls an operator in contact takes over. Elemental damage and elemental bursts. Summons are placed by hand. Pushes and pulls are computed from force and weight. Knocked-out operators stay where they fell and show a redeploy countdown.
- **Terrain and enemies**: terrain devices such as barricades, firing platforms, Originium-flow blowers, mire, exhaust grilles and the rising tide; airborne and low-hovering enemies, and bounty enemies.
- **Joint defense (联防)**: when one player leaks enemies and another fights a perfect battle, the perfect teammates bring their lineup over to help intercept the leaked enemies.
- **Final Assault (最终攻势) and Hidden Core (隐秘核心)**: two players share one battlefield and the whole team wears down a single leader HP bar. 10 enemy leaders, giant leaders with a hit area of about 5×3 tiles, and the official damage-cap rule (限伤).
- **Result titles**: 6 titles such as 卫戍之星, 不朽盟约 and 坚若磐石.
- **Reconnecting**: in co-op, reopening the page within 10 minutes of a disconnect puts you back in your seat. While you are gone your lineup keeps fighting automatically, or you can step away (暂离) and let the AI play for you. A solo run can be resumed within 24 hours in the same browser.
- **Interaction details**: when enemies leak, the objective HP in the top bar drops live (it is settled at the end of the round). Selecting, dragging and issuing equipment all go by the ground tile. Buying, upgrading and picking a 机变 card each take a second tap to confirm. With a single player, nothing but combat is timed.
- **Graphics and sound**: the real Spine chibi models, the official BGM and sound effects, emotes (6 sets × 6) and combat effects. The official 3D board is optional and needs textures extracted from a local game client.
- **Phones and desktops**: touch dragging, long-press for details, landscape recommended. Graphics quality can be lowered in the settings.

## Quick start

### Option 1: all-in-one bundle (recommended)

The bundle already contains the code, the runtime dependencies and all the art and audio (including the official 3D board textures). Unzip it and play; nothing else has to be downloaded.

1. **Install Node.js 22 or 24 (LTS)**
   - Windows: run `winget install OpenJS.NodeJS.LTS` in PowerShell, or download the installer from <https://nodejs.org/en/download>.
   - macOS: `brew install node@22`, or download the installer from the website.
   - Linux: your distribution's package manager, nvm or fnm.
2. **Download** the bundle (zip) of the latest version (v0.1.2) from the [Releases](../../releases/latest) page and extract it into a folder with a short path. On Windows, avoid directories synced by OneDrive.
3. **Start**
   - Windows: double-click **`scripts\start-windows.bat`**. If a "Security Warning" appears, click "Run". When Windows Firewall asks, tick "Private networks" and allow access.
   - macOS / Linux: run `./scripts/start.sh` (or `bash scripts/start.sh`) in the extracted folder.
4. The browser opens `http://localhost:3000` by itself. The LAN addresses listed in the window can be sent straight to friends on the same network. Closing the window (or pressing `Ctrl+C`) stops the server.

### Option 2: run from source

```bash
git clone https://github.com/sganggs/Stronghold-Protocol.git
cd Stronghold-Protocol
npm install        # install dependencies (postinstall copies pixi / preact / three into public/vendor)
npm run setup      # check the environment and download about 270 MB of art and audio from public mirrors (can be interrupted; running it again resumes)
npm start          # start the server: http://localhost:3000
```

You can also run the start script directly (`scripts\start-windows.bat` on Windows, `scripts/start.sh` on macOS / Linux). The first run installs the dependencies and downloads the assets, then starts the server and opens the browser.

- **Local client assets (optional)**: the official 3D board, some official interface icons (the frames of the chat button and the emote panel, the module type icons and so on) and the official models of two Originium slug variants (灼热 / 炽焰源石虫) have to be extracted from an *Arknights* PC client installed on your machine (the native Windows client, or CrossOver or PlayCover on macOS). When `npm run setup` detects a client it asks whether to extract; this needs Python 3.8+, and the dependencies go into `.venv-extract` inside the project, leaving your system untouched. Later you can extract again with `node tools/setup.mjs --local`, or point at the client with `--game "<…/StreamingAssets/AB/Windows>"`. Without a client the game runs as usual and swaps these for stand-ins: the 2D board, look-alike icons and tinted ordinary slugs. The emotes and the tutorial pages of the in-game guide (玩法说明) come from the public mirror with the rest of the assets and need no client. A server without a client (a Linux VPS, for example) can also copy `public/assets/local/` and `data/local-assets.json` out of the bundle of the **same version**; see "本地客户端素材" in [docs/DEPLOY.md](docs/DEPLOY.md).
- Asset downloads try GitHub first and fall back to the jsDelivr mirror when that fails.
- `npm run doctor` (that is, `node tools/doctor.mjs`) diagnoses an install at any time: Node version, whether the assets are complete, whether the port is taken, LAN addresses and the firewall.

### System requirements

| Item | Requirement |
|---|---|
| Host computer | Windows / macOS / Linux with Node.js 22 or 24 (LTS); about 400–500 MB of disk (assets, dependencies and the optional locally extracted textures); about 100 MB of free memory, plus a few MB per match |
| Players | A modern browser with WebGL (the latest Chrome / Edge / Firefox / Safari) on a computer, phone or tablet (landscape) |
| Network | The first time they enter the game, each player downloads a few tens of MB of assets from the host (cached by the browser afterwards); traffic during a match is small |

On a weak GPU you can lower the quality in the settings (设置), or append `?board=2d` (force the 2D board) or `?render=fallback` (a simplified view without WebGL) to the address.

### Ports and configuration

The server listens on **TCP 3000** by default. To change the port, pass `--port 3001` to the start script or set the `PORT` environment variable.

| Environment variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Listening port |
| `HOST` | `0.0.0.0` | Listening address (`127.0.0.1` = this machine only; use it behind a reverse proxy) |
| `SP_COMBAT` | `client` | `client`: each player's browser simulates its own battles (very low server load); `server`: the server simulates and streams them |
| `SP_VERIFY` | `off` | The server re-computes battle results reported by clients: `off` / `sample` (spot-checks about 1 in 8) / `all` (re-computes every one, at a higher CPU cost) |
| `TRUST_PROXY` | `auto` | Whether to trust forwarding headers such as `X-Forwarded-For`: `auto` trusts only proxies on this machine or the private network; `1` always; `0` never |
| `DEBUG` | empty | Any value turns on verbose logging |
| `SP_NO_BROWSER` | empty | `1` stops the start script from opening the browser |

How to set them: macOS / Linux `PORT=8080 npm start`; PowerShell `$env:PORT=8080; npm start`; cmd `set "PORT=8080" && npm start`. Health check: `GET /healthz`.

### Playing with friends (LAN)

1. Open the page → enter a nickname → **同盟模拟** (co-op) → create a room. The host picks the difficulty and can add or remove AI teammates.
2. Send your friends the 4-letter **room key** (同盟密钥), or the `http://<address>:3000/?room=KEY` link you get from "复制链接" (copy link).
3. The host starts once everyone has tapped "准备就绪" (ready).
4. Friends on the same Wi-Fi or router open one of the addresses listed in the start window (something like `http://192.168.x.x:3000`). When it will not open, the firewall is the usual cause: on Windows, allow "Private networks" in the prompt at first start, or run `npm run doctor` for the exact commands. Guest Wi-Fi often has "AP isolation" turned on, which also blocks the connection.

After a page refresh or a disconnect, reopening the page within 10 minutes (co-op) or 24 hours (solo) returns you to your seat. The server keeps rooms and matches in memory, so **restarting the server ends every match**.

## Playing over the internet

When your friends are not on the same local network, these are the common approaches; pick whichever fits your situation. This is only a short introduction. The tools and services named are examples: this project has no connection with them and does not recommend any of them, and their own documentation is the authority on installation, cost and terms of use. Deployment details (firewall, start at boot, reverse proxy and HTTPS, Docker) are in **[docs/DEPLOY.md](docs/DEPLOY.md)** (Chinese).

| Approach | How | Good for |
|---|---|---|
| **Direct, same LAN** | Send friends the LAN address shown in the start window | The same home, dorm or internet café |
| **Virtual LAN tools** | For example Tailscale, ZeroTier, EasyTier or Oray PgyVPN (蒲公英): the host and the friends all install the same tool and join the same network, and the friends open `http://<virtual IP>:3000` using the host's virtual IP | A fixed group of people you know; nothing is exposed to the public internet. Friends have to install a client too, some tools need an account, and across regions traffic may go through a relay and slow down |
| **Tunnels / NAT traversal** | Only the host runs a client and friends just open a URL. For example a self-hosted frp (needs a server with a public IP), Cloudflare's `cloudflared tunnel --url http://localhost:3000` (a temporary address that changes on every start; latency from mainland China can be high), or public tunnelling services in China such as SakuraFrp (usually require real-name registration, and mainland nodes serving web pages may require ICP filing) | Not wanting to touch the router, or having no public IP. On free lines with little bandwidth the first asset load is slower |
| **Cloud server / VPS** | Run the bundle on a VPS, or use the repository's `Dockerfile`; add HTTPS with Caddy or Nginx. Choose a region close to the players with good routing (for players in mainland China, watch the return route of overseas data centres, or evening latency can be very high; binding a domain to a mainland server requires ICP filing) | Hosting long-term, or players spread across regions |

Things that apply to all of them:

- The game is **one long-running Node.js process plus a WebSocket** (path `/ws`). Only one instance can run, and it has to be served from the root path of its domain. Serverless platforms such as Vercel and static hosts such as GitHub Pages do not work. A reverse proxy has to forward the WebSocket upgrade.
- The game has no accounts, so **anyone who knows the address can get in**. Send the address only to friends; do not publish it and do not set up a public lobby. This also lowers the copyright risk around the assets.
- With a public IPv4 address you can also forward a port on the router, but that exposes your home computer directly to the internet. Prefer the approaches above.

## Controls

| Action | How |
|---|---|
| Buy / upgrade the Dispatch Center / pick a 机变 card | Tap once to select, tap again to confirm (`D` upgrades) |
| Deploy / move an operator | Drag from the bench onto a board tile → the direction wheel appears → slide up / right / down / left to choose the facing, then release. Release in the centre or tap "✕ 点击取消" to cancel. While dragging, the model stays under the pointer or finger, and the tile under the pointer is where it lands |
| Change facing | Drag the operator back onto its own tile, then choose a direction |
| Sell / retreat / destroy equipment | Tap the unit's tile → the buttons at the bottom, "出售 +1" (sell) and "撤退" (retreat). You can also drag an operator from the board back to the bench to retreat it. Equipment and Arts on the bench can only be destroyed ("销毁"); issued equipment is locked onto its operator and returns to the bench when the operator is sold or merged into an elite |
| Equip | Drag the equipment onto the operator's tile (2 per operator; when full, a replace dialog opens and the replaced piece is destroyed). Drag an Art onto a tile and choose a direction |
| View details | Right-click or long-press a unit or card (stats are live values: green above the base value, red below) |
| Shortcuts | `R` refresh · `F` freeze · `D` upgrade · `Space` ready · `Esc` cancel / close |
| Direction wheel by keyboard | Arrow keys preview · `Enter` confirm · `Esc` cancel |
| Pause (solo) | During combat (Final Assault and Hidden Core included), tap "暂停" in the top bar or press `Space`; tap "继续作战" (or `Space`) to resume. Co-op battles cannot be paused |
| Emotes | "交流" at the bottom left; swipe left / right (or use the arrow keys) to change theme; 1 second cooldown |
| Spectate | After your own battle ends (or during prep), tap a teammate's avatar on the left → "前往查看" |

The full rules, numbers and tips are in **[docs/PLAYING.md](docs/PLAYING.md)** (Chinese); the game also has a guide (玩法说明) at the bottom left.

## Documentation

| Document | Contents |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | Release notes (Chinese): what each version fixed, and which reports turned out not to be problems |
| [docs/PLAYING.md](docs/PLAYING.md) | How to play (Chinese): flow, economy, recruiting and promotion, formation, joint defense, bonds, Final Assault, result titles |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Deployment guide (Chinese): hosting on Windows and starting at boot, firewall, virtual LANs and tunnels, reverse proxy and HTTPS, Docker, systemd, troubleshooting |
| [docs/WINDOWS.md](docs/WINDOWS.md) | Windows portable bundle (Chinese): how to build a "zero-install" package (`scripts/make-windows-bundle.mjs`), what goes into it, licensing notes |
| [docs/DESIGN.md](docs/DESIGN.md) | Architecture and contracts (English): tech stack, directory responsibilities, network protocol, rendering and UI, the rule revisions after each playtest |
| [docs/SIM.md](docs/SIM.md) | Battle simulation engine reference (English): hooks, the skill spec format, profession defaults |
| [docs/META.md](docs/META.md) | Match and economy engine (English): implementation details of the round flow, shop, joint defense and Final Assault |
| [docs/DATA.md](docs/DATA.md) | The game data generated from the official data tables (English) |
| [docs/ASSETS.md](docs/ASSETS.md) | Asset sources, directory layout and manifest (English) |
| [docs/BALANCE.md](docs/BALANCE.md) | Difficulty model and measurements (English) |
| [docs/research/](docs/research/00-INDEX.md) | Research notes on the official rules, data and interface |

## Development and testing

```bash
npm run dev                 # node --watch: restarts the server when server code changes
node --test                 # unit + integration tests (about 3,170; cases that need assets or a browser skip themselves)
SP_E2E=1 node --test test/ui/mock.e2e.test.js        # browser end-to-end tests; needs a local Chrome (CHROME_PATH sets its path)
SP_REAL_E2E=1 node --test test/ui/real.e2e.test.js   # needs Chrome and the downloaded assets
RENDER_E2E=1 node --test 'test/render/*.browser.test.js'   # rendering tests; some need the locally extracted board textures
```

- The game data is generated from the official data tables by `npm run build-data` (`tools/build-data.mjs`). Do not edit `data/*.json` by hand.
- GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs `npm ci`, `node --test` and a server smoke test on Ubuntu and Windows with Node 22 and 24.

## Project layout

| Path | Contents |
|---|---|
| `server/` | Node HTTP static server + WebSocket (`/ws`), lobby, match engine (`match/`), battle simulation (`sim/`, shared by the browser and the server) |
| `shared/` | Constants and the network protocol used by both sides |
| `public/` | Browser client (native ES modules; PixiJS + pixi-spine, the three.js 3D board, a Preact + htm UI) |
| `data/` | Game data generated from the official data tables, and the asset manifest `assets.json` |
| `tools/` | `setup.mjs` / `doctor.mjs`, the asset downloader `fetch-assets.mjs`, the data build, local extraction in `local-extract/` |
| `scripts/` | Start scripts (Windows / macOS / Linux), start at boot on Windows |
| `docs/` | Documentation and research |
| `test/` | `node:test` suites |

## License

- **Code**: the code written for this project is released under **GPL-3.0-or-later**; the full text is in [LICENSE](LICENSE). It comes with an additional permission under GPL section 7 that allows distributing it combined with the Spine Runtimes in pixi-spine (see [NOTICE.md](NOTICE.md)).
- **Game assets are outside the licence**: the art, music, sound effects, text, data and other material of *Arknights* belong to their rights holders and are not covered by the GPL. The limits on their use are in the [Disclaimer](#disclaimer) above and in [NOTICE.md](NOTICE.md).
- **Third-party components** follow their own licences: the libraries installed through npm (the bundle's `node_modules` carries each one's licence file), the algorithm of `tools/local-extract/aklz4.py` (BSD-3-Clause), the fonts and so on. The list and the licence texts are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Credits and data sources

- Game data: [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData).
- Asset sources: [yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource), [fexli/ArknightsResource](https://github.com/fexli/ArknightsResource), [isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models), [ArknightsAssets/ArknightsAssets2](https://github.com/ArknightsAssets/ArknightsAssets2). Fonts come from [TimWangZi/The-font-of-Arknights](https://github.com/TimWangZi/The-font-of-Arknights) and Google Fonts (Noto Sans SC). Details in [docs/ASSETS.md](docs/ASSETS.md).
- Rules reference: [PRTS, the Chinese Arknights wiki](https://prts.wiki/).
- LZ4AK unpacking: the algorithm of `tools/local-extract/aklz4.py` comes from [isHarryh/Ark-Unpacker](https://github.com/isHarryh/Ark-Unpacker) (BSD-3-Clause, via MooncellWiki/UnityPy). Unity assets are parsed with [UnityPy](https://github.com/K0lb3/UnityPy) (MIT).
- Libraries: [PixiJS](https://pixijs.com/) (MIT), [pixi-spine](https://github.com/pixijs/spine) (MIT; the Spine Runtime it contains is also subject to the [Spine Runtimes License](https://esotericsoftware.com/spine-runtimes-license)), [three.js](https://threejs.org/) (MIT), [Preact](https://preactjs.com/) + [htm](https://github.com/developit/htm) (MIT), [ws](https://github.com/websockets/ws) (MIT).

Thanks to the authors and maintainers of these projects, and to Hypergryph for the game.

## Contributing

Issues reporting bugs, differences from the official rules or suggestions are welcome, and so are pull requests:

- Run `node --test` before submitting and update the related documentation along with the change. Documentation is written in Simplified Chinese; code and comments are in English.
- Contributed code is released under GPL-3.0-or-later.
- Do not submit any game asset files (`public/assets/` and similar directories are already excluded by `.gitignore`).
- The project stays non-commercial: do not submit ads, payments, tipping or any other form of monetisation.
