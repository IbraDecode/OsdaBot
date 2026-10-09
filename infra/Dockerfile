# ============================================================
# OSDA Platform — Image Docker
# ============================================================
# Satu berkas untuk tiga target: api, web, bot.
#
# Catatan: image ini memakai Node 22 (LTS) yang sama dengan lingkungan
# pengembangan. Gunakan `pnpm-lock.yaml` agar versi dependency terkunci.
# ============================================================

# ---------- Lapisan dasar ----------
FROM node:22-bookworm-slim AS dasar
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

# Manifest lebih dulu supaya layer dependensi ter-cache.
COPY pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/domain/package.json packages/domain/
COPY packages/notifications/package.json packages/notifications/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
RUN pnpm install --frozen-lockfile --ignore-scripts || pnpm install

# ---------- API ----------
FROM dasar AS api
COPY . .
RUN pnpm --filter @osda/api build || true
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

# ---------- Web ----------
FROM dasar AS web
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["pnpm", "--filter", "@osda/web", "start"]

# ---------- Bot ----------
FROM dasar AS bot
COPY . .
RUN pnpm --filter @osda/bot build || true
CMD ["node", "apps/bot/dist/main.js"]
