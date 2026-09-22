# Imagen de producción de la web: build estático servido por nginx, con /api/ reescrito
# hacia la API (igual que el proxy de Vite en desarrollo, ver apps/web/vite.config.ts).
# Se construye desde la raíz del monorepo:
#   docker build -f apps/web/Dockerfile -t personal-calendar-web .

FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @calendar/web build

FROM nginx:alpine
COPY apps/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
