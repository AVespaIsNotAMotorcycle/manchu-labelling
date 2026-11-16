# Builds the API and the web server for production. See deploy/README.md.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages ./packages
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY server ./server
COPY client ./client
RUN npm run typecheck && npm run build -w client

# The API runs its TypeScript directly, as in development.
FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY server/src ./server/src
USER node
EXPOSE 3001
CMD ["node", "server/src/index.ts"]

# Caddy serves the client and passes /api to the API, with HTTPS certificates from Let's Encrypt.
FROM caddy:2.10 AS web
COPY --from=build /app/client/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
