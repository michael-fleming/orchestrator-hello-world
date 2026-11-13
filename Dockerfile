FROM node:22-alpine

# Patch OS packages from the base image (addresses CVE-2026-4738 in zlib) and
# drop the bundled npm/yarn CLIs, which the app does not need at runtime. This
# removes npm's own dependency tree from the shipped image, clearing the
# brace-expansion (GHSA-rgw5-rvv9-x895, GHSA-mh99-v99m-4gvg, GHSA-qhr7-859c-m2p7,
# GHSA-6j4f-fj2g-mc7p, GHSA-3jxr-9vmj-r5cp), ip-address (GHSA-mwp4-54f8-5fhr),
# picomatch (GHSA-c2c7-rcm5-vvqj), pacote (GHSA-w4pp-8pjf-rmxw) and sigstore
# (GHSA-52v5-jr5w-gjxr) findings.
RUN apk --no-cache upgrade \
 && rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/corepack \
           /opt/yarn-* \
           /usr/local/bin/yarn \
           /usr/local/bin/yarnpkg \
           /root/.npm

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

