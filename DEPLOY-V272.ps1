$ErrorActionPreference = 'Stop'
$env:FUNCTIONS_DISCOVERY_TIMEOUT = '60'
Write-Host 'Publicando Firestore, Functions e Hosting com timeout de descoberta de 60 segundos...'
firebase deploy --only firestore:rules,functions,hosting
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'Deploy concluido com sucesso.'
