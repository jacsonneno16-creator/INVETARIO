#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: $0 /caminho/para/captura.har" >&2
  exit 2
fi

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

node --check public/js/analista/90-bi-recebimento-service.js
node --check public/js/analista/91-logistica-recebimento.js
node --check public/js/analista/93-recebimento-operacao.js
node --check public/js/analista/98-recebimento-retornos-indicadores.js
node --check public/js/analista/105-recebimento-patio-tempo-real.js
node --check functions/index.js

node --test functions/test/*.test.js
node --test public/tests/performance-leituras-etapa31.test.js
node --test public/tests/analista-produtos-busca-unica.test.js
node --test --test-name-pattern="nunca fica pendurado|timeout do cache" public/tests/analista-recebimento-patio-tempo-real.test.js

mkdir -p evidencias
node scripts/auditoria-performance-etapa32.js "$1" evidencias/AUDITORIA-CARGA-ETAPA-32.json
