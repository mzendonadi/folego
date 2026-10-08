#!/usr/bin/env bash
# Instala o certificado Origin CA do Cloudflare (para o modo SSL/TLS "Full (strict)").
# Entrada: /tmp/origin.pem.new e /tmp/origin.key.new (o workflow Operações envia, a partir de segredos do GitHub).
# Seguro: confere se certificado e chave formam um par, guarda o certificado antigo, troca, recria o nginx e TESTA; se o teste
# falhar, devolve o certificado antigo sozinho. Nada é impresso (nem chave, nem certificado).
set -euo pipefail
cd "$(dirname "$0")/.."
NEW_PEM=/tmp/origin.pem.new
NEW_KEY=/tmp/origin.key.new
trap 'shred -u "$NEW_PEM" "$NEW_KEY" 2>/dev/null || rm -f "$NEW_PEM" "$NEW_KEY"' EXIT
[ -s "$NEW_PEM" ] && [ -s "$NEW_KEY" ] || { echo "ERRO: certificado ou chave nao chegaram."; exit 1; }
chmod 600 "$NEW_KEY"
D="sudo docker"
mod() { $D run --rm -v /tmp:/t alpine/openssl "$1" -noout -modulus -in "/t/$2" 2>/dev/null | md5sum | cut -d' ' -f1; }
[ "$(mod x509 origin.pem.new)" = "$(mod rsa origin.key.new)" ] || { echo "ERRO: o certificado nao corresponde a chave. Nada foi alterado."; exit 1; }
$D run --rm -v /tmp:/t alpine/openssl x509 -noout -subject -issuer -enddate -in /t/origin.pem.new 2>/dev/null | sed -e 's/^/    /'

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p certs/anteriores
cp -p certs/origin.pem "certs/anteriores/origin.pem.$STAMP"
cp -p certs/origin.key "certs/anteriores/origin.key.$STAMP"
chmod 600 "certs/anteriores/origin.key.$STAMP"
cp "$NEW_PEM" certs/origin.pem
cp "$NEW_KEY" certs/origin.key
chmod 644 certs/origin.pem
chmod 600 certs/origin.key
$D compose up -d --force-recreate web >/dev/null 2>&1

ok=0
for i in 1 2 3 4 5 6 7 8; do
  sleep 3
  code="$(curl -ks --max-time 8 -o /dev/null -w '%{http_code}' --resolve folego.online:443:127.0.0.1 https://folego.online/api/health || true)"
  issuer="$(curl -vks --max-time 8 -o /dev/null --resolve folego.online:443:127.0.0.1 https://folego.online/ 2>&1 | grep -i 'issuer:' | head -1 || true)"
  if [ "$code" = "200" ] && echo "$issuer" | grep -qi "CloudFlare Origin"; then ok=1; break; fi
done
if [ "$ok" = 1 ]; then
  echo "OK: nginx servindo o certificado Origin CA (saude 200). Pode ligar o modo Full (strict) no Cloudflare."
else
  echo "FALHOU o teste: devolvendo o certificado anterior."
  cp -p "certs/anteriores/origin.pem.$STAMP" certs/origin.pem
  cp -p "certs/anteriores/origin.key.$STAMP" certs/origin.key
  $D compose up -d --force-recreate web >/dev/null 2>&1
  exit 1
fi
