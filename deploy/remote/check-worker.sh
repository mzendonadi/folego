#!/usr/bin/env bash
# Verifica o worker em produção e roda o teste de fumaça da geração (só leitura + um caso de teste que se apaga sozinho).
# Uso: ssh ... "bash -s" < check-worker.sh   (o "< /dev/null" no exec impede que ele engula o resto deste roteiro)
cd ~/folego/deploy || exit 1
echo "== containers"
sudo docker compose ps --format 'table {{.Name}}\t{{.Status}}' 2>&1 | grep -v "unable to resolve host"
echo "== logs do worker"
sudo docker compose logs --tail 15 worker 2>&1 | grep -v "unable to resolve host"
echo "== fumaça da geração"
sudo docker compose exec -T api node scripts/smoke.ts < /dev/null 2>&1 | grep -v "unable to resolve host"
echo "== worker depois da fumaça"
sudo docker compose logs --tail 6 worker 2>&1 | grep -v "unable to resolve host"
