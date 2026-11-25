# Etapa 1: Construcción del frontend React y dependencias de producción
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

RUN npm ci

COPY frontend ./frontend
COPY backend ./backend

RUN npm run build && npm prune --omit=dev

# Etapa 2: Imagen final mínima con usuario no root (glibc compatible con argon2)
FROM node:22-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system appgroup && useradd --system --gid appgroup --no-create-home appuser

COPY --from=builder --chown=appuser:appgroup /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/backend ./backend
COPY --from=builder --chown=appuser:appgroup /app/frontend/dist ./frontend/dist

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "backend/src/server.js"]
