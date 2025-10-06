# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY game/package.json ./
RUN npm install

FROM base AS builder
ENV NODE_ENV=production
ARG NEXT_PUBLIC_BROKER_WS_URL="ws://localhost:43127/ws"
ARG NEXT_PUBLIC_BROKER_HTTP_URL="http://localhost:43127"
ENV NEXT_PUBLIC_BROKER_WS_URL=$NEXT_PUBLIC_BROKER_WS_URL
ENV NEXT_PUBLIC_BROKER_HTTP_URL=$NEXT_PUBLIC_BROKER_HTTP_URL
COPY --from=deps /app/node_modules ./node_modules
COPY game .
RUN npm run build
RUN npm prune --omit=dev

FROM base AS runner
ENV NODE_ENV=production
ARG NEXT_PUBLIC_BROKER_WS_URL="ws://localhost:43127/ws"
ARG NEXT_PUBLIC_BROKER_HTTP_URL="http://localhost:43127"
ENV NEXT_PUBLIC_BROKER_WS_URL=$NEXT_PUBLIC_BROKER_WS_URL
ENV NEXT_PUBLIC_BROKER_HTTP_URL=$NEXT_PUBLIC_BROKER_HTTP_URL
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY game/package.json ./package.json
COPY game/next.config.js ./next.config.js
EXPOSE 3000
CMD ["npm", "run", "start"]
