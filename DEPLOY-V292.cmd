@echo off
setlocal
cd /d "%~dp0"
echo Projeto Firebase: daterrinha-inventario
echo Publicando Firestore, Functions e Hosting...
firebase use daterrinha-inventario
if errorlevel 1 goto :erro
firebase deploy --only firestore:rules,functions,hosting
if errorlevel 1 goto :erro
echo.
echo Deploy concluido com sucesso.
pause
exit /b 0
:erro
echo.
echo O deploy falhou. Confira a mensagem acima.
pause
exit /b 1
