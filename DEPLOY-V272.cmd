@echo off
setlocal
set FUNCTIONS_DISCOVERY_TIMEOUT=60
echo Publicando Firestore, Functions e Hosting com timeout de descoberta de 60 segundos...
firebase deploy --only firestore:rules,functions,hosting
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" (
  echo.
  echo O deploy falhou. Confira as linhas acima.
  pause
  exit /b %EXIT_CODE%
)
echo.
echo Deploy concluido com sucesso.
pause
