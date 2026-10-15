#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then root="$(cygpath -m "$root")"; fi
docker info >/dev/null
for version in 1.1.0 1.2.0; do
  echo "=== Pi $version ==="
  MSYS_NO_PATHCONV=1 docker run --rm \
    --mount "type=bind,src=$root,dst=/src,readonly" \
    -e PI_OFFLINE=1 -e "PI_TEST_VERSION=$version" \
    node:24.21.0-bookworm-slim bash -euc '
      cp -R /src /tmp/check
      cd /tmp/check
      # Keep Pi packages on the same release instead of resolving their caret ranges.
      for package in pi-agent-core pi-ai pi-codemode pi-mcp pi-tui pi-telemetry chord; do
        npm pkg set "overrides.@earendil-works/$package=$PI_TEST_VERSION"
      done
      npm install --ignore-scripts --no-package-lock --no-save --no-audit --no-fund \
        "@earendil-works/pi-coding-agent@$PI_TEST_VERSION" typescript@5.9.3 @types/node@24.10.1
      npm test
      ./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --module NodeNext --target ES2022 --types node index.ts
    '
done
