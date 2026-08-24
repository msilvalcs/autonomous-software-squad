ARG BASE_IMAGE=autonomous-squad-runner:local
FROM ${BASE_IMAGE}

USER root

RUN apt-get update \
  && apt-get install --yes --no-install-recommends python3 python3-pytest \
  && rm -rf /var/lib/apt/lists/*

USER squad:squad

CMD ["python3", "--version"]
