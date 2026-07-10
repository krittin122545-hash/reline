#!/usr/bin/env sh
set -eu

IMAGE_NAME="kikonet0122545/reline"
VERSION="1.0.1"

docker login
docker build -t "${IMAGE_NAME}:${VERSION}" .
docker push "${IMAGE_NAME}:${VERSION}"
