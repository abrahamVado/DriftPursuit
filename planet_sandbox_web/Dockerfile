# syntax=docker/dockerfile:1

# -------- deps --------
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ libc6-compat

# install with the project's chosen lockfile (prefer npm here)
COPY planet_sandbox_web/package.json \
     planet_sandbox_web/package-lock.json* \
     planet_sandbox_web/pnpm-lock.yaml* \
     planet_sandbox_web/yarn.lock* ./

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
COPY planet_sandbox_web/ .

# bring in the sibling library *inside* /app so TS can resolve deps via /app/node_modules
COPY typescript-client ./typescript-client
# //1.- Ensure the public directory exists so later COPY commands succeed even when the project has no public assets yet.
RUN mkdir -p public
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

# //1.- Normalise the standalone output so the container can boot regardless of whether Next.js nests the server entrypoint inside a project folder (common in monorepos).
# //2.- Connect the standalone server back to the shared static and public assets so runtime lookups resolve correctly.
RUN set -eux; \
    if [ ! -f server.js ]; then \
      entry_path="$(find . -maxdepth 3 -path '*/server.js' -print -quit)"; \
      if [ -z "$entry_path" ]; then \
        echo "Failed to locate the Next.js standalone server entrypoint" >&2; \
        exit 1; \
      fi; \
      ln -sf "$entry_path" server.js; \
      entry_dir="$(dirname "$entry_path")"; \
      if [ -d .next/static ]; then \
        mkdir -p "$entry_dir/.next"; \
        rm -rf "$entry_dir/.next/static"; \
        ln -s /app/.next/static "$entry_dir/.next/static"; \
      fi; \
      if [ -d public ] && [ ! -e "$entry_dir/public" ]; then \
        ln -s /app/public "$entry_dir/public"; \
      fi; \
    fi

USER node
EXPOSE 3000
CMD ["node", "server.js"]
