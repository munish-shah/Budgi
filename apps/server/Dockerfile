# Build from the repo root:  docker build -f apps/server/Dockerfile -t budgi-relay .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci -w @budgi/server -w @budgi/core --ignore-scripts
COPY packages/core packages/core
COPY apps/server apps/server
RUN npm run build -w @budgi/server && npm prune --omit=dev -w @budgi/server

FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/data/budgi.db
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/package.json ./package.json
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
