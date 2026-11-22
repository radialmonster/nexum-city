# syntax=docker/dockerfile:1

# ---- build: install everything, build the client and the server ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/theme/package.json packages/theme/
COPY packages/sim/package.json packages/sim/
COPY packages/contracts/package.json packages/contracts/
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
RUN npm ci
COPY . .
RUN npm run build

# ---- deps: production dependencies of the server only ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/theme/package.json packages/theme/
COPY packages/sim/package.json packages/sim/
COPY packages/contracts/package.json packages/contracts/
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
RUN npm ci --omit=dev --workspace @nexum/server --ignore-scripts && npm cache clean --force

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY apps/server/package.json apps/server/
# The server's workspace dependencies are symlinks in node_modules; ship their built output.
COPY packages/sim/package.json packages/sim/
COPY packages/contracts/package.json packages/contracts/
COPY --from=build /app/packages/sim/dist packages/sim/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/client/dist apps/client/dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/server/dist/main.js"]
