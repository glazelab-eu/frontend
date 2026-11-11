# syntax=docker/dockerfile:1

FROM docker.io/library/node:22-alpine AS frontend-build
WORKDIR /build/frontend
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . ./
# The footer's version label; the build context has no git history to read a commit from, so without it the label is a hash of the sources.
ARG GLAZELAB_BUILD=
ENV GLAZELAB_BUILD=$GLAZELAB_BUILD
# The photo-suggestion model is not in git: the build takes models/vision/model.onnx from the context when it matches the pin,
# else downloads it from this URL and checks it (scripts/vision-model-file.ts); without either the build stops.
ARG GLAZELAB_VISION_MODEL_URL=
ENV GLAZELAB_VISION_MODEL_URL=$GLAZELAB_VISION_MODEL_URL
# Packaging only builds: the format check, type check and tests belong to ./build.sh and `npm run build`.
RUN npx vite build

FROM docker.io/library/nginx:stable-alpine AS frontend
# NGINX_ENTRYPOINT_LOCAL_RESOLVERS makes the entrypoint export /etc/resolv.conf's nameservers for the template.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=frontend-build /build/frontend/dist/ /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --spider http://127.0.0.1/healthz || exit 1
