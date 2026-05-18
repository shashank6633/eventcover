#!/usr/bin/env bash
#
# bootstrap.sh — first-time setup for the EventCover Wallet VM.
#
# Run ONCE on a fresh Ubuntu 24.04 GCE VM after first SSH-in.
# Idempotent: safe to re-run.
#
# What it does:
#   1. Updates apt + installs build tools (needed for native better-sqlite3 compile)
#   2. Installs Node 20 LTS from NodeSource
#   3. Installs pm2 globally
#   4. Installs Caddy (HTTPS reverse proxy with auto Let's Encrypt)
#   5. Creates /srv/eventcover (app dir) and /var/eventcover/data (SQLite dir)
#   6. Generates an SSH deploy key + prints the public key to add to GitHub
#
# Usage:  chmod +x bootstrap.sh && ./bootstrap.sh

set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Don't run as root. The script uses sudo where needed."
  exit 1
fi

echo
echo "==> 1/6  apt update + prerequisites"
sudo apt-get update
sudo apt-get install -y \
  curl ca-certificates gnupg \
  build-essential python3 git \
  debian-keyring debian-archive-keyring apt-transport-https

echo
echo "==> 2/6  Node 20 LTS"
if ! command -v node &>/dev/null || ! node --version | grep -q '^v20'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "    node $(node --version), npm $(npm --version)"

echo
echo "==> 3/6  pm2"
sudo npm install -g pm2 --silent
echo "    pm2 $(pm2 --version)"

echo
echo "==> 4/6  Caddy"
if ! command -v caddy &>/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y caddy
fi
echo "    caddy $(caddy version | head -1)"

echo
echo "==> 5/6  Directories"
sudo mkdir -p /srv/eventcover /var/eventcover/data /var/log/caddy
sudo chown -R "$USER:$USER" /srv/eventcover /var/eventcover
echo "    /srv/eventcover and /var/eventcover/data ready"

echo
echo "==> 6/6  GitHub deploy key"
if [[ ! -f ~/.ssh/id_ed25519_github ]]; then
  ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_github -N "" -C "eventcover-vm@$(hostname)"
fi
mkdir -p ~/.ssh && chmod 700 ~/.ssh
if ! grep -q 'Host github.com' ~/.ssh/config 2>/dev/null; then
  cat >> ~/.ssh/config <<EOF
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_github
  IdentitiesOnly yes
EOF
  chmod 600 ~/.ssh/config
fi

cat <<'BANNER'

===========================================================================
  Bootstrap complete!
===========================================================================

NEXT STEP — add this SSH key as a DEPLOY KEY on your GitHub repo:

  1. Open: https://github.com/shashank6633/eventcover-wallet/settings/keys
  2. Click "Add deploy key"
  3. Title:  eventcover-prod
  4. Key:    paste the block between the dashed lines below
  5. Leave "Allow write access" UNCHECKED
  6. Click "Add key"

BANNER

echo "-------------------- COPY FROM HERE --------------------"
cat ~/.ssh/id_ed25519_github.pub
echo "--------------------- COPY TO HERE ---------------------"
echo
echo "AFTER adding the deploy key, run:    ./launch.sh"
echo
