# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node backend/server.mjs ./backend/server.mjs

RUN mkdir -p /app/backend/data/visual \
    && chown -R node:node /app

USER node

EXPOSE 8787

CMD ["node", "backend/server.mjs"]
