FROM node:24.19.0-bookworm-slim@sha256:65932751ed4073ed02f5c04e494e4b2572a891b7dbea0568a863dc80341bf848

ARG RUNNER_UID=10001
ARG RUNNER_GID=10001

RUN groupadd --gid ${RUNNER_GID} squad \
  && useradd --uid ${RUNNER_UID} --gid ${RUNNER_GID} \
    --create-home --shell /usr/sbin/nologin squad

WORKDIR /workspace

ENV CI=true \
  HOME=/tmp \
  NPM_CONFIG_CACHE=/tmp/.npm

USER squad:squad

CMD ["npm", "--version"]
