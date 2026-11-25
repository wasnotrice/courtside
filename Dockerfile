# syntax=docker/dockerfile:1.7
#
# One image: Phoenix serves the API, the socket and the web app, and Litestream
# streams the SQLite database to object storage. Built by `fly deploy` (see
# docs/deploy.md). Versions are pinned; bump them together and deliberately.

ARG ELIXIR_VERSION=1.20.2
ARG OTP_VERSION=29.0.2
ARG DEBIAN_VERSION=bookworm-20260623-slim
ARG NODE_VERSION=22.23.3
ARG LITESTREAM_VERSION=0.5.18

# --- The web app: a static SvelteKit build --------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# The API is the page's own address. The organization is the web build's default
# until device tokens carry it.
RUN npm run build

# --- The Elixir release -----------------------------------------------------------
FROM hexpm/elixir:${ELIXIR_VERSION}-erlang-${OTP_VERSION}-debian-${DEBIAN_VERSION} AS release
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential git \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV MIX_ENV=prod
RUN mix local.hex --force && mix local.rebar --force

# Dependencies first, so they're cached until mix.lock changes.
COPY server/mix.exs server/mix.lock ./
RUN mix deps.get --only prod
RUN mkdir config
COPY server/config/config.exs server/config/prod.exs config/
RUN mix deps.compile

COPY server/priv priv
COPY server/lib lib
COPY --from=web /web/build priv/static
# Plug.Static serves the .gz copies to browsers that accept them.
RUN find priv/static -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \
  -o -name '*.json' -o -name '*.svg' -o -name '*.txt' \) -exec gzip -9 -k {} +
RUN mix compile

COPY server/config/runtime.exs config/
COPY server/rel rel
RUN mix release

# --- The running image ------------------------------------------------------------
FROM debian:${DEBIAN_VERSION}
ARG LITESTREAM_VERSION
RUN apt-get update \
  && apt-get install -y --no-install-recommends libstdc++6 openssl libncurses6 locales ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8 LANGUAGE=en_US:en LC_ALL=en_US.UTF-8

# Litestream, checked against the release's published checksum.
ADD --checksum=sha256:d3687b9fd0f2e9426bbd3da828429ff3f1dfc5c9b74d54fdf028e4ee510e7dea \
  https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.tar.gz \
  /tmp/litestream.tar.gz
RUN tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz litestream && rm /tmp/litestream.tar.gz

WORKDIR /app
COPY --from=release /app/_build/prod/rel/courtside ./
ENV HOME=/app MIX_ENV=prod

# Runs as root: the database lives on a Fly volume, which is mounted owned by root.
CMD ["/app/bin/entrypoint"]
