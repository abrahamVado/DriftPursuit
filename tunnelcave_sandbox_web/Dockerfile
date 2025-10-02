# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN if [ -f package-lock.json ]; then \
        npm ci; \
    elif [ -f pnpm-lock.yaml ]; then \
        corepack enable pnpm \
        && pnpm install --frozen-lockfile; \
    elif [ -f yarn.lock ]; then \
        corepack enable yarn \
        && yarn install --frozen-lockfile; \
    else \
        npm install; \
    fi

FROM node:20-alpine AS builder
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
        npm ci --omit=dev; \
    else \
        npm install --omit=dev; \
    fi \
    && npm cache clean --force
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
