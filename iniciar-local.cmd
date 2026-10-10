@echo off
rem Ambiente LOCAL de testes do Folego (esta maquina). Pagamento simulado, e-mail no console, dados de exemplo.
rem Uso: duplo clique, ou:  iniciar-local.cmd        (sobe a API + site em http://localhost:3000)
rem        iniciar-local.cmd seed   (popula dados de exemplo; rode com a API ligada, em outra janela)
rem        iniciar-local.cmd zerar  (apaga os dados locais e comeca do zero)
setlocal
cd /d "%~dp0"
if /i "%1"=="seed" (
  node apps\api\scripts\seed-local.mjs http://localhost:3000
  goto :eof
)
if /i "%1"=="zerar" (
  if exist ".local-data" rmdir /s /q ".local-data"
  echo Dados locais apagados. Inicie de novo e rode "iniciar-local.cmd seed".
  goto :eof
)
if not exist "apps\api\node_modules" (
  echo Instalando dependencias da API...
  pushd apps\api & call npm ci & popd
)
if not exist "apps\web\node_modules" (
  echo Instalando dependencias do site...
  pushd apps\web & call npm ci & popd
)
rem Sempre gera o site: antes so gerava se a pasta nao existisse, e a landing local ficava para tras da versao publicada.
echo Gerando o pacote do site...
pushd apps\web & call npm run build & popd
set NODE_ENV=development
set EXPOSE_DEV_CODES=1
set RATE_LIMITS=relaxed
set SUBSCRIPTIONS_ENABLED=1
set LEADS_ENABLED=1
set ADMIN_EMAILS=dono@folego.local
set PGLITE_DIR=%~dp0.local-data
set PORT=3000
set HOST=127.0.0.1
echo.
echo Folego local:  http://localhost:3000   ^|  Backoffice: http://localhost:3000/gestao/  (e-mail dono@folego.local; o codigo aparece neste console)
echo Pagamento SIMULADO (nenhum Pix/cartao e real). Ctrl+C para parar.
echo.
node apps\api\src\server.ts
