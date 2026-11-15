# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Multi-stage build of the Solde server (apps/server) with the web app
# (apps/web): build the web app, build the server, then copy both into a
# distroless, non-root runtime image.
#
# Base images are pinned by tag and digest, so a release image is built from
# exactly what was reviewed; Renovate proposes updates (renovate.json). Keep
# the Rust version in step with rust-toolchain.toml.

# 1. Web app: static files in /src/apps/web/dist.
FROM node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS web
WORKDIR /src
# Corepack installs the pnpm version pinned by `packageManager`.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @solde/web
COPY apps/web apps/web
RUN pnpm --dir apps/web build

# 2. Server binary.
FROM rust:1.97.1-slim-trixie@sha256:8e8cf8f7fd54a2d23d5a743b3a03f56e26b6c774276c33fa0595111704ebb15c AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked --bin solde-server \
    && cp target/release/solde-server /solde-server \
    && mkdir -p /rootfs/data

# 3. Runtime. Distroless, non-root (uid/gid 65532), no shell.
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2 AS runtime
LABEL org.opencontainers.image.title="solde" \
      org.opencontainers.image.description="Self-hosted household finance server" \
      org.opencontainers.image.source="https://github.com/Jivadio/solde" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
COPY --from=build /solde-server /usr/local/bin/solde-server
# The server reads these files into memory at startup (SOLDE_WEB_DIR).
COPY --from=web /src/apps/web/dist /usr/share/solde/web
# Writable data directory for the SQLite variant (named volumes copy this
# ownership on first use).
COPY --from=build --chown=65532:65532 /rootfs/data /data
USER nonroot:nonroot
ENV SOLDE_LISTEN_ADDR=0.0.0.0:8080 \
    SOLDE_WEB_DIR=/usr/share/solde/web
EXPOSE 8080
# No shell or curl here: the binary probes its own /healthz (on the port of
# SOLDE_LISTEN_ADDR, loading no key and no database) and exits 0 or 1.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=2s --retries=3 \
    CMD ["/usr/local/bin/solde-server", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/solde-server"]
