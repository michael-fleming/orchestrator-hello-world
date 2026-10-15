FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Patch OS packages shipped in the base image (e.g. zlib CVE-2026-85091,
# libssl3/libcrypto3 openssl advisories) and drop the bundled npm CLI, which
# the app does not need at runtime and which carries the vulnerable
# brace-expansion, pacote, sigstore, picomatch, ip-address and
# http-cache-semantics trees. This app has zero runtime dependencies.
RUN apk --no-cache upgrade \
 && rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /opt/yarn-* \
           /usr/local/bin/yarn \
           /usr/local/bin/yarnpkg \
           /root/.npm

COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public

# Stamp the image so /api/version shows exactly what is running.
ARG APP_VERSION
ARG GIT_SHA=unknown
ARG BUILD_TIME
ENV APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA} \
    BUILD_TIME=${BUILD_TIME}

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM
CMD ["node", "server.js"]

