FROM node:22-alpine

# Patch OS packages shipped in the base image (zlib CVE-2026-85091, openssl/
# libcrypto3/libssl3 CVE-2026-54873, CVE-2026-84782, CVE-2026-84784,
# CVE-2026-72897) and drop the bundled npm CLI. This app has zero runtime
# dependencies and never installs anything at runtime, so removing npm also
# removes its vendored tree (brace-expansion, pacote, sigstore, picomatch,
# ip-address, http-cache-semantics) from the image entirely.
RUN apk --no-cache upgrade \
 && rm -rf /usr/local/lib/node_modules/npm \
          /usr/local/bin/npm \
          /usr/local/bin/npx \
          /opt/yarn-* \
          /usr/local/bin/yarn \
          /usr/local/bin/yarnpkg \
          /root/.npm \
 && rm -rf /var/cache/apk/*

ENV NODE_ENV=production
WORKDIR /app

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

