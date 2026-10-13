# Distroless runtime: no package manager and no bundled npm toolchain, which
# removes the vulnerable packages reported by the image scan (npm's bundled
# brace-expansion, pacote, sigstore, picomatch, ip-address,
# http-cache-semantics) and the outdated Alpine system libraries (zlib,
# libssl3/libcrypto3). The app has zero runtime dependencies, so nothing is
# installed at build time.
FROM gcr.io/distroless/nodejs22-debian12:nonroot

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

# Exec form: the distroless image has no shell.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

STOPSIGNAL SIGTERM
# The distroless entrypoint is already /nodejs/bin/node.
CMD ["server.js"]

