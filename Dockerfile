# syntax=docker/dockerfile:1
# 卫戍协议：盟约 · production image (server + static client). Docs: docs/DEPLOY.md「Docker」.
#
# Code: GPL-3.0-or-later (LICENSE). Game art/audio is © Hypergryph / Yostar, not covered by the GPL, non-commercial use
# only (NOTICE.md), and never part of the repository. Two ways to get it into a container:
#   A) download it while building (~250 MB, needs internet during the build):
#        docker build -t stronghold-protocol --build-arg FETCH_ASSETS=1 .
#   B) build without it and mount the host's copy (prepared with `node tools/setup.mjs` on the host):
#        docker build -t stronghold-protocol .
#        docker run -d --name stronghold -p 3000:3000 --restart unless-stopped \
#          -v "$PWD/public/assets:/app/public/assets:ro" stronghold-protocol
#      (public/fonts, data/assets.json and data/local-assets.json are copied from the build context when present)
# Without any art the game still runs with placeholder visuals.
#
# Run:  docker run -d --name stronghold -p 3000:3000 --restart unless-stopped stronghold-protocol
# Env:  PORT (3000), HOST (0.0.0.0 = IPv4 only; set :: for one dual-stack socket, IPv6 + IPv4), SP_COMBAT (client|server),
#       SP_VERIFY (off|sample|all), TRUST_PROXY (auto|1|0), DEBUG

ARG NODE_IMAGE=node:22-alpine

# ---- 1. production dependencies (cached while package*.json are unchanged) -------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the postinstall (tools/vendor.mjs) runs in the next stage, once the sources are there
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

# ---- 2. vendor libs + optional art download ---------------------------------------------------------
FROM deps AS build
ARG FETCH_ASSETS=0
COPY shared ./shared
COPY server ./server
COPY tools ./tools
COPY data ./data
COPY public ./public
COPY docs/research ./docs/research
RUN node tools/vendor.mjs \
 && if [ "$FETCH_ASSETS" = "1" ]; then \
      node tools/fetch-assets.mjs || echo "WARNING: art download incomplete; the image falls back to placeholder art"; \
    fi \
 && rm -rf .cache

# ---- 3. runtime ---------------------------------------------------------------------------------------
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/server ./server
COPY --from=build /app/data ./data
COPY --from=build /app/public ./public
# research tables: read by server/sim/nodeData.js as a fallback
COPY --from=build /app/docs/research ./docs/research

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "server/index.js"]
