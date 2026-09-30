#!/usr/bin/env bash
# Levantamento SOMENTE LEITURA do servidor. Executado por: ssh ... "bash -s" < inventory.sh
echo "== quem"; whoami; hostname
echo "== so"; . /etc/os-release; echo "$PRETTY_NAME"; uname -r
echo "== cpu/ram"; nproc; free -h | head -2
echo "== disco"; df -h / | tail -1
echo "== hugepages"; grep -E "HugePages_(Total|Free)|Hugepagesize" /proc/meminfo
echo "== docker"; docker --version 2>&1; docker compose version 2>&1
echo "== sudo permitido"; sudo -n -l 2>&1 | tail -8
echo "== containers"; sudo -n docker ps -a --format "{{.Names}} {{.Status}}" 2>&1 | head
echo "== portas em escuta"; ss -ltn | awk 'NR==1 || /:(80|443|22022|3000|5432) /'
echo "== home"; echo "$HOME"; ls -la "$HOME" | head -12
echo "== /srv"; ls -la /srv 2>&1 | head -5
echo "== openssl/curl"; command -v openssl curl tar 2>&1
