#!/usr/bin/env bash
# Mescla chaves novas no deploy/.env do servidor SEM imprimir nenhum valor.
# Uso: bash deploy/ops/mesclar-env.sh <arquivo-com-linhas-NOME=valor> <deploy/.env>
# - Cada NOME do arquivo novo substitui a linha antiga do mesmo nome (ou é acrescentado ao fim).
# - Se o arquivo novo traz PAYMENT_PROVIDER=asaas, as linhas do pagamento de mentira saem do .env.
# - Antes de mexer, guarda uma cópia (permissão 600) ao lado do .env. Nada é apagado de forma irreversível.
set -euo pipefail
NOVO="${1:?arquivo novo}"
ALVO="${2:?arquivo .env}"
[ -s "$NOVO" ] || { echo "mesclar-env: nada a mesclar"; exit 0; }
[ -f "$ALVO" ] || { echo "mesclar-env: $ALVO não existe"; exit 1; }

umask 077
COPIA="${ALVO}.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$ALVO" "$COPIA"
# Guarda só as 5 cópias mais recentes.
ls -1t "${ALVO}".bak-* 2>/dev/null | tail -n +6 | while read -r velho; do rm -f -- "$velho"; done

declare -A NOVAS=()
ORDEM=()
while IFS= read -r linha || [ -n "$linha" ]; do
  [[ "$linha" =~ ^[A-Z][A-Z0-9_]*= ]] || continue
  chave="${linha%%=*}"
  NOVAS["$chave"]="${linha#*=}"
  ORDEM+=("$chave")
done < "$NOVO"

REMOVER=()
if [ "${NOVAS[PAYMENT_PROVIDER]:-}" = "asaas" ]; then
  REMOVER=(ALLOW_FAKE_GATEWAY_IN_PRODUCTION)
fi

TMP="$(mktemp "${ALVO}.XXXXXX")"
while IFS= read -r linha || [ -n "$linha" ]; do
  chave="${linha%%=*}"
  pular=0
  if [[ "$linha" =~ ^[A-Z][A-Z0-9_]*= ]]; then
    [ -n "${NOVAS[$chave]+x}" ] && pular=1
    for r in "${REMOVER[@]:-}"; do [ "$chave" = "$r" ] && pular=1; done
  fi
  [ "$pular" = 1 ] || printf '%s\n' "$linha" >> "$TMP"
done < "$ALVO"
for chave in "${ORDEM[@]}"; do
  printf '%s=%s\n' "$chave" "${NOVAS[$chave]}" >> "$TMP"
done
chmod 600 "$TMP"
mv -f "$TMP" "$ALVO"
echo "mesclar-env: ${#ORDEM[@]} chave(s) gravadas (nomes: ${ORDEM[*]}). Cópia anterior guardada."
