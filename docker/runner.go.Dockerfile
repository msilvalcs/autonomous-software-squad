ARG BASE_IMAGE=autonomous-squad-runner:local
FROM ${BASE_IMAGE}

USER root

RUN apt-get update \
  && apt-get install --yes --no-install-recommends golang-go \
  && rm -rf /var/lib/apt/lists/*

USER squad:squad

CMD ["go", "version"]
