#!/usr/bin/env bash
# Download public inference fixtures and verify their pinned content hashes.
set -euo pipefail

destination="${1:?usage: bash scripts/prepare-whisper-test-fixtures.sh OUTPUT_DIRECTORY}"
mkdir -p "$destination"
curl --fail --location --retry 3 \
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin' \
  --output "$destination/ggml-tiny.en-q5_1.bin"
curl --fail --location --retry 3 \
  'https://raw.githubusercontent.com/ggml-org/whisper.cpp/a8d002cfd879315632a579e73f0148d06959de36/samples/jfk.wav' \
  --output "$destination/jfk.wav"
(
  cd "$destination"
  printf '%s\n' \
    'c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b  ggml-tiny.en-q5_1.bin' \
    '59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e  jfk.wav' \
    | shasum -a 256 --check
)
