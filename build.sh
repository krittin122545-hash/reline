#!/usr/bin/env sh
set -eu

IMAGE_NAME="kikonet0122545/reline"
VERSION="1.0.9"

docker login
docker buildx build \
  --platform linux/amd64 \
  --tag "${IMAGE_NAME}:${VERSION}" \
  --push \
  .
