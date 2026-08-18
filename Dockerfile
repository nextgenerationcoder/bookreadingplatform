# Builds the Vite client and installs server deps (including compiling the
# native better-sqlite3 addon), then ships a slim runtime image that just
# runs the server, which also serves the built client as static files.

FROM node:20-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY server/ server/
COPY client/ client/
RUN npm run build --workspace client

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server/src/index.js"]
