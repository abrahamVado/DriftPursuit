# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

#1.- Install dependencies using the npm lockfile when available.
COPY planet_sandbox_web/package.json planet_sandbox_web/package-lock.json* ./
RUN npm ci

#2.- Copy the application source and shared client library into the build context.
COPY planet_sandbox_web/ ./
COPY typescript-client ./typescript-client

#3.- Produce the static Vite build artefacts.
RUN npm run build

FROM nginx:1.25-alpine AS runner
WORKDIR /usr/share/nginx/html

#1.- Copy the compiled assets into the nginx document root.
COPY --from=builder /app/dist ./

#2.- Expose the default HTTP port for the static site.
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
