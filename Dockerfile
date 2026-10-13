# Alpine runtime pinned to a patched Node release (22.23.2), which fixes the
# Node CVEs reported by the image scan (CVE-2026-21710, CVE-2026-48617,
# CVE-2026-48937, CVE-2026-56846, CVE-2026-56848). Alpine's musl and openssl
# packages replace the Debian libc6 / libssl3 / libstdc++6 packages that the
# distroless base carried with unfixed advisories (CVE-2026-5450,
# CVE-2026-34182, CVE-2026-75803, CVE-2026-31789, CVE-2026-95619, ...).
# npm and its bundled dependencies are deleted from the image: the app has zero
# runtime dependencies, so nothing is installed at build time.
FROM node:22.23.2-alpine

# Pick up any Alpine security updates published after the base image was cut,
# then drop the bundled package managers so their dependency trees are not part
# of the shipped image.
RUN apk --no-cache upgrade \
 && rm -rf /usr/local/lib/node_modules \
           /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg \
           /opt/yarn-* \
           /usr/local/share/.cache \
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

USER 65532:65532
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

STOPSIGNAL SIGTERM
ENTRYPOINT ["node"]
CMD ["server.js"]

