# syntax=docker/dockerfile:1

FROM node:22-alpine3.23 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build \
    && mkdir -p /runtime-data/visual /runtime-data/log

FROM node:22-alpine3.23 AS dependencies

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine3.23 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /runtime-data ./backend/data
COPY --chown=node:node backend/server.mjs ./backend/server.mjs
COPY --chown=node:node backend/src ./backend/src

USER node

EXPOSE 8787

CMD ["node", "backend/server.mjs"]
