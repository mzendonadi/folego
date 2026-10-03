#!/usr/bin/env bash
# Endurecimento do servidor. Precisa de ROOT (o usuário de deploy não tem). Rode UMA vez, como root:
#   bash endurecer-servidor.sh SIM
# Faz: atualizações automáticas de segurança, fail2ban para o SSH, SSH só por chave (sem root, sem senha) e firewall (ufw)
# com SSH + 80 + 443. Reversível (cópia do sshd_config). NÃO mexe nos containers.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode como root."; exit 1; }
[ "${1:-}" = "SIM" ] || { echo "Confirme com: bash $0 SIM"; exit 1; }
SSH_PORT="${SSH_PORT:-22022}"
DEPLOY_USER="${DEPLOY_USER:-codhubs}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y unattended-upgrades fail2ban ufw
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades

cat > /etc/fail2ban/jail.d/folego-sshd.conf <<EOT
[sshd]
enabled = true
port = $SSH_PORT
maxretry = 4
findtime = 10m
bantime = 1h
EOT
systemctl enable --now fail2ban

# SSH: só desliga a senha se o usuário de deploy JÁ tem chave (senão você se trancaria para fora).
KEYS="/home/$DEPLOY_USER/.ssh/authorized_keys"
if [ -s "$KEYS" ]; then
  cp -a /etc/ssh/sshd_config "/etc/ssh/sshd_config.bak.$(date +%s)"
  mkdir -p /etc/ssh/sshd_config.d
  printf 'PermitRootLogin no\nPasswordAuthentication no\nMaxAuthTries 3\n' > /etc/ssh/sshd_config.d/99-folego.conf
  sshd -t && { systemctl reload ssh 2>/dev/null || systemctl reload sshd; }
else
  echo "AVISO: $KEYS vazio; SSH por senha foi MANTIDO para você não perder o acesso."
fi

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT"/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "Pronto. Confira o acesso SSH em OUTRA janela antes de fechar esta."
