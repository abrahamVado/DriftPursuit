# syntax=docker/dockerfile:1

# -------- deps --------
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ libc6-compat

# install with the project's chosen lockfile (prefer npm here)
COPY tunnelcave_sandbox_web/package.json \
     tunnelcave_sandbox_web/package-lock.json* \
     tunnelcave_sandbox_web/pnpm-lock.yaml* \
     tunnelcave_sandbox_web/yarn.lock* ./

RUN if [ -f package-lock.json ]; then \
      npm ci; \
    elif [ -f pnpm-lock.yaml ]; then \
      corepack enable pnpm && pnpm install --frozen-lockfile; \
    elif [ -f yarn.lock ]; then \
      corepack enable yarn && yarn install --frozen-lockfile; \
    else \
      npm install; \
    fi

# -------- build --------
FROM node:20-alpine AS builder
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules

# app source first
COPY tunnelcave_sandbox_web/ .

# bring in the sibling library *inside* /app so TS can resolve deps via /app/node_modules
COPY typescript-client ./typescript-client
RUN npm run build

# -------- run (standalone) --------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat

# Use Next's standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
