#!/usr/bin/env bash
# Serves the stage map harness on http://127.0.0.1:${PORT:-5199}/stage-map-harness.html until Ctrl+C,
# then takes the two files out of packages/stage-pwa again.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
app=$here/../../packages/stage-pwa
cp "$here/stageMapHarness.tsx" "$app/src/stageMapHarness.tsx"
cp "$here/stage-map-harness.html" "$app/stage-map-harness.html"
trap 'rm -f "$app/src/stageMapHarness.tsx" "$app/stage-map-harness.html"' EXIT
cd "$app"
npx vite --port "${PORT:-5199}" --strictPort --host 127.0.0.1
