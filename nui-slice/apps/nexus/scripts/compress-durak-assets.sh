#!/usr/bin/env bash
set -euo pipefail
# Optional helper only — never run automatically. Requires cwebp/magick.
# Converts the heavy durak face/agent webp back to optimized output.

if command -v cwebp >/dev/null 2>&1; then
  for f in "$@"; do
    echo "would convert: $f"
  done
else
  echo "no cwebp/magick available on this machine" >&2
  exit 0
fi