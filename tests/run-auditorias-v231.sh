#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
find public/js -name '*.js' -print0 | xargs -0 -n1 node --check
node --check functions/index.js
node tests/test-auditorias-v231.js
node tests/test-address-state.js
node tests/test-address-state-v202.js
node tests/test-address-columns-v203.js
node tests/test-address-columns-v204.js
