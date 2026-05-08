# Build context = repo root (см. .github/workflows/deploy-dashboard.yml).
# Это нужно потому что @prisma/client живёт в корневом package.json
# (см. dashboard/next.config.ts → turbopack.root: '..'), а dashboard/postinstall
# вызывает `prisma generate --schema ../prisma/schema.prisma`.

FROM node:20-alpine AS deps
WORKDIR /app

# 1. Корневые deps + сгенерированный @prisma/client.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate

# 2. Dashboard deps. postinstall = `prisma generate --schema ../prisma/schema.prisma`,
#    сработает корректно, т.к. /app/prisma уже на месте.
COPY dashboard/package*.json ./dashboard/
WORKDIR /app/dashboard
RUN npm ci

# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY --from=deps /app/dashboard/node_modules ./dashboard/node_modules
COPY dashboard/ ./dashboard/

WORKDIR /app/dashboard
# DATABASE_URL нужен только для типов при сборке, реальное значение — в runtime env
ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}
RUN npm run build

# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Next.js standalone с turbopack.root='..' собирает структуру с корневым уровнем:
#   /app/dashboard/server.js, /app/node_modules/, /app/prisma/
COPY --from=builder /app/dashboard/.next/standalone ./
COPY --from=builder /app/dashboard/.next/static ./dashboard/.next/static
COPY --from=builder /app/dashboard/public ./dashboard/public

EXPOSE 3000
CMD ["node", "dashboard/server.js"]
