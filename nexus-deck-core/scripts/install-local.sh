#!/bin/sh
# Builds a release binary into ~/.local/bin (replacing any older one), then
# restarts the core the planned way so running terminals pick up the new build.
set -eu
cd "$(dirname "$0")/.."
nice -n 10 cargo build --release
bin="${NX_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$bin"
if [ "$(uname -s)" = Darwin ]; then
  app="target/release/Herdr Core.app"
  rm -rf "$app"
  sh scripts/mac-bundle target/release/nexus-core "$app"
  bash scripts/mac-sign "$app"
  "$app/Contents/MacOS/nexus-core" --nx-install-bundle "$app/Contents/MacOS/nexus-core" "$bin/nexus-core"
else
  install -m 755 target/release/nexus-core "$bin/nexus-core.new"
  mv -f "$bin/nexus-core.new" "$bin/nexus-core"
fi
[ -e "$bin/hc" ] || [ -L "$bin/hc" ] || ln -s nexus-core "$bin/hc"
"$bin/nexus-core" server restart
