#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
if [[ "${1:-start}" == "check" ]]; then
  pnpm exec vitest run apps/web/quick-entry-lab/parser.test.ts apps/web/quick-entry-lab/parser.fifty.test.ts apps/web/quick-entry-lab/parser.unusual.test.ts apps/web/quick-entry-lab/parser.start-first.test.ts apps/web/quick-entry-lab/parser.hundred.test.ts
  pnpm --filter @utm/web exec tsc -p quick-entry-lab/tsconfig.json --pretty false
  pnpm --filter @utm/web exec vite build --config quick-entry-lab/vite.config.ts
  git diff --check
elif [[ "${1:-start}" == "browser" ]]; then
  pnpm exec playwright test --config apps/web/quick-entry-lab/playwright.config.ts
elif [[ "${1:-start}" == "start" ]]; then
  pnpm --filter @utm/web exec vite build --config quick-entry-lab/vite.config.ts
  exec pnpm --filter @utm/web exec vite preview --config quick-entry-lab/vite.config.ts --host 127.0.0.1 --port 4187 --strictPort
else
  echo 'Usage: bash apps/web/quick-entry-lab/run.sh [start|check|browser]'
  exit 1
fi
