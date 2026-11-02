FROM node:22-slim

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@11.22.0

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Rewrites are fixed at build time, so the backend address must be known here.
# Default: a Railway service named "backend" reached over the private network.
ARG API_ORIGIN=http://backend.railway.internal:8000
ENV API_ORIGIN=${API_ORIGIN}
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "pnpm exec next start --hostname 0.0.0.0 --port ${PORT:-3000}"]
