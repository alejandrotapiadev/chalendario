# Imagen de producción de la API. Se construye desde la raíz del monorepo:
#   docker build -f apps/api/Dockerfile -t personal-calendar-api .
#
# No hay paso de compilación propio: la API corre el TypeScript de src/ directamente (Node
# lo admite de forma nativa desde la versión fijada en engines, ver package.json), igual que
# en desarrollo (apps/api/package.json: "start"). Por eso esta imagen instala el monorepo
# entero (incluidas las dependencias de desarrollo, que incluyen node-pg-migrate) en vez de
# compilar un artefacto aparte.
FROM node:24-alpine
WORKDIR /repo

RUN corepack enable

# Capa de dependencias cacheada: solo se reinstala si cambian los manifiestos.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Aplica las migraciones pendientes y arranca; ver docs para las variables de entorno
# necesarias (DATABASE_URL, etc.) y docs/decisions para REGISTRATION_OPEN/trustProxy.
CMD ["sh", "-c", "pnpm migrate:up && pnpm --filter @calendar/api start"]
