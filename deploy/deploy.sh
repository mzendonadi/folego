#!/usr/bin/env bash
# =============================================================================
# Publica o Fôlego neste servidor SEM root: só usa "sudo docker". NÃO TESTADO ainda em servidor real.
# Rode DENTRO da pasta do projeto já enviada:   bash deploy/deploy.sh
# É idempotente: pode rodar de novo para publicar uma nova versão. Não mexe em SSH, firewall nem no sistema.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$ROOT/deploy"
DOMAIN="folego.online"
D="sudo docker"

[ -f "$ROOT/apps/web/index.html" ] || { echo "Rode de dentro da pasta do projeto (não achei apps/web)."; exit 1; }
[ -s "$ROOT/apps/web/dist/index.html" ] || { echo "Falta apps/web/dist. Rode 'npm run build' em apps/web ANTES de empacotar."; exit 1; }
$D compose version >/dev/null 2>&1 || { echo "Docker Compose indisponível via sudo docker."; exit 1; }

echo "==> 1/6 Segredos (só cria se ainda não existir)"
if [ ! -f "$DEPLOY/.env" ]; then
  umask 077
  cat > "$DEPLOY/.env" <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_SECRET=$(openssl rand -base64 48 | tr -d '\n')
# Pagamento de MENTIRA até o Asaas ser configurado (veja deploy/env.example). Nenhum Pix é real.
PAYMENT_PROVIDER=fake
ALLOW_FAKE_GATEWAY_IN_PRODUCTION=1
WEBHOOK_SECRET=$(openssl rand -hex 24)
EOF
  echo "    criado deploy/.env (permissão 600). Guarde uma cópia fora do servidor; NÃO a envie para lugar nenhum."
else
  echo "    já existe, mantido."
fi
chmod 600 "$DEPLOY/.env"

echo "==> 2/6 Certificado de origem"
mkdir -p "$DEPLOY/certs"
if [ ! -s "$DEPLOY/certs/origin.pem" ] || [ ! -s "$DEPLOY/certs/origin.key" ]; then
  echo "    gerando certificado AUTOASSINADO (serve para o modo SSL/TLS 'Full' do Cloudflare)."
  echo "    Para 'Full (strict)', substitua deploy/certs/origin.pem e origin.key por um Origin CA do Cloudflare."
  $D run --rm --user "$(id -u):$(id -g)" -v "$DEPLOY/certs:/out" alpine/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout /out/origin.key -out /out/origin.pem -subj "/CN=$DOMAIN" \
    -addext "subjectAltName=DNS:$DOMAIN,DNS:www.$DOMAIN"
  chmod 600 "$DEPLOY/certs/origin.key"
fi

echo "==> 3/6 Faixas de IP do Cloudflare (só elas podem falar com o Nginx)"
mkdir -p "$DEPLOY/nginx"
{
  echo "# gerado por deploy.sh a partir de https://www.cloudflare.com/ips-v4 e ips-v6"
  echo "geo \$realip_remote_addr \$from_cloudflare {"
  echo "  default 0;"
  echo "  127.0.0.1 1;"
  echo "  172.16.0.0/12 1;   # ponte do Docker: só o próprio servidor origina conexões daqui (testes locais)"
  for ip in $(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4) $(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6); do echo "  $ip 1;"; done
  echo "}"
  for ip in $(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4) $(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6); do echo "set_real_ip_from $ip;"; done
  echo "real_ip_header CF-Connecting-IP;"
} > "$DEPLOY/nginx/cloudflare-ips.conf"
[ "$(grep -c '/' "$DEPLOY/nginx/cloudflare-ips.conf")" -ge 10 ] || { echo "Não consegui baixar as faixas do Cloudflare."; exit 1; }

echo "==> 4/6 Site estático"
mkdir -p "$DEPLOY/site"
# NUNCA apagar a pasta em si: o container do Nginx está preso a ela (bind mount) e passaria a ver tudo vazio (403).
find "$DEPLOY/site" -mindepth 1 -delete
tar -C "$ROOT/apps/web/dist" -cf - . | tar -C "$DEPLOY/site" -xf -
printf "export const API_BASE = '/api';\nexport const DEV = false;\n" > "$DEPLOY/site/assets/config.js"
chmod -R a+rX "$DEPLOY/site"

echo "==> 5/6 Banco, API e Nginx (Docker Compose)"
( cd "$DEPLOY" && $D compose up -d --build )
# Configuração e faixas do Cloudflare são arquivos montados: quando o conteúdo do arquivo muda (não só a
# imagem), "nginx -s reload" às vezes NÃO enxerga a mudança nesse servidor (o processo continua com a
# configuração antiga mesmo relendo com sucesso, por algum motivo do bind mount aqui). Recriar o container
# resolve sempre; como ele não tem estado (só serve os arquivos montados), recriar é seguro e rápido.
( cd "$DEPLOY" && $D compose up -d --force-recreate web )

echo "==> 6/6 Verificação"
ok=0
for i in $(seq 1 20); do
  code="$(curl -ks --max-time 5 -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" || true)"
  if [ "$code" = "200" ]; then ok=1; break; fi
  sleep 3
done
if [ "$ok" -ne 1 ]; then
  echo "    A verificação local não deu 200 a tempo. Últimos logs:"
  ( cd "$DEPLOY" && $D compose logs --tail=40 api web )
  exit 1
fi
echo "    /api/health = 200"
home="$(curl -ks --max-time 8 -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" || true)"
[ "$home" = "200" ] || { echo "    ERRO: a página inicial respondeu $home (esperado 200). Verifique deploy/site e o Nginx."; exit 1; }
echo "    / (página inicial) = 200"
curl -ks --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health"; echo
echo "    cabeçalho CSP presente: $(curl -ksI --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" | grep -ci '^content-security-policy')"
( cd "$DEPLOY" && $D compose ps )
echo
echo "Pronto. Teste de outra máquina: https://$DOMAIN"
