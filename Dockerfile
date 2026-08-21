# Builds the Vite client and installs server deps (including compiling the
# native better-sqlite3 addon), then ships a slim runtime image that just
# runs the server, which also serves the built client as static files.
#
# Both stages use a Debian-based image (not Alpine/musl): Piper TTS's
# onnxruntime dependency only ships glibc wheels on PyPI, and a native addon
# compiled against musl in the build stage wouldn't load in an Alpine runtime
# stage anyway - keeping both stages on the same glibc base avoids both
# problems at once.

FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY server/ server/
COPY client/ client/
RUN npm run build --workspace client

FROM node:20-bookworm-slim
WORKDIR /app

# python3/pip for Piper TTS (server/src/tts.js spawns it as a child process).
# The piper-tts package itself installs from PyPI at build time; the voice
# model files (from Hugging Face) are downloaded lazily on first use into the
# persisted data volume - see server/src/tts.js - so a flaky/blocked Hugging
# Face connection at build time can't break the image build.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && rm -rf /var/lib/apt/lists/* \
  && pip install --break-system-packages --no-cache-dir piper-tts

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server/src/index.js"]
