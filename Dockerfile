FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1.3.14-slim
WORKDIR /app
ENV NODE_ENV=production
ARG SERVICE=coupon-service
ENV SERVICE=${SERVICE}
COPY --from=build --chown=bun:bun /app /app
USER bun
CMD ["sh", "-c", "exec bun services/$SERVICE/dist/index.js"]
