#!/usr/bin/env bash
# Set up a fresh Ubuntu 24.04 VPS for Market Jury. Safe to run again (for example to
# update Bun or the service files): it never touches the database or the environment
# file once they exist.
#
# Run as root on the server:  bash provision.sh
# What it does, and the steps that follow it, are in deploy/README.md.
set -euo pipefail

BUN_VERSION="${BUN_VERSION:-1.3.14}"   # keep in step with .bun-version (used by the deploy workflow)
APP_USER=marketjury       # runs the app; owns the database
DEPLOY_USER=deploy        # GitHub Actions logs in as this user to ship releases
ROOT=/srv/market-jury     # releases/, current -> releases/<id>, data/
ENV_DIR=/etc/market-jury
ENV_FILE="$ENV_DIR/env"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Run this as root: sudo bash provision.sh"; exit 1; }
# shellcheck source=/dev/null
. /etc/os-release
[[ "${VERSION_ID:-}" == "24.04" ]] || echo "Warning: this script is written for Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}."

# Password logins are switched off below, so make sure a key login already works.
if [[ ! -s /root/.ssh/authorized_keys ]]; then
  echo "Root has no SSH key in /root/.ssh/authorized_keys. Add your key in hPanel first,"
  echo "otherwise switching off password logins would lock you out. Nothing was changed."
  exit 1
fi

say "Updating the system and installing basics"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl unzip sqlite3 ufw unattended-upgrades

say "Clock: UTC, kept in sync (login codes depend on it)"
timedatectl set-timezone UTC
timedatectl set-ntp true

say "Automatic security updates (reboot if needed at 03:30 UTC, outside trading steps)"
cat > /etc/apt/apt.conf.d/52market-jury-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
EOF
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

say "SSH: keys only"
cat > /etc/ssh/sshd_config.d/10-market-jury.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t
systemctl reload ssh

say "Firewall: only SSH comes in (the website arrives through Cloudflare Tunnel)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

say "Bun $BUN_VERSION"
if [[ "$(/usr/local/bin/bun --version 2>/dev/null || true)" != "$BUN_VERSION" ]]; then
  case "$(uname -m)" in
    x86_64) asset=bun-linux-x64 ;;
    aarch64) asset=bun-linux-aarch64 ;;
    *) echo "No Bun build for $(uname -m)"; exit 1 ;;
  esac
  tmp=$(mktemp -d)
  base="https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION"
  curl -fsSL -o "$tmp/$asset.zip" "$base/$asset.zip"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt"
  (cd "$tmp" && grep " $asset.zip\$" SHASUMS256.txt | sha256sum -c -)
  unzip -q "$tmp/$asset.zip" -d "$tmp"
  install -m 755 "$tmp/$asset/bun" /usr/local/bin/bun
  rm -rf "$tmp"
fi
bun --version

say "cloudflared (Cloudflare Tunnel)"
if ! command -v cloudflared >/dev/null; then
  install -d -m 755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -q
  apt-get install -yq cloudflared
fi

say "Users and folders"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin "$APP_USER"
id -u "$DEPLOY_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$DEPLOY_USER"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ROOT" "$ROOT/releases"
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$ROOT/data"
install -d -m 750 -o root -g "$APP_USER" "$ENV_DIR"

if [[ ! -e "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<EOF
# Market Jury settings and secrets. Readable only by root and the app.
# Edit with: sudo nano $ENV_FILE   then: sudo systemctl restart market-jury
PORT=3000
DATABASE_PATH=$ROOT/data/market-jury.sqlite
CLIENT_DIR=dist

# Nightly backups to Cloudflare R2 (see deploy/README.md)
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_ENDPOINT=
S3_BUCKET=

# Alpaca market data for the Floor Runner (see deploy/README.md)
ALPACA_KEY_ID=
ALPACA_SECRET_KEY=
EOF
fi
chown root:"$APP_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

say "Deploy login for GitHub Actions"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
keys="/home/$DEPLOY_USER/.ssh/authorized_keys"
new_key=""
if [[ ! -s "$keys" ]]; then
  new_key=/root/github-actions-deploy-key
  rm -f "$new_key" "$new_key.pub"
  ssh-keygen -q -t ed25519 -N '' -C github-actions-deploy -f "$new_key"
  # restrict: no shell tricks (port forwarding, agent, terminal); commands still run.
  echo "restrict $(cat "$new_key.pub")" > "$keys"
  rm -f "$new_key.pub"
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "$keys"
chmod 600 "$keys"

# The deploy user may restart the app and nothing else as root.
cat > /etc/sudoers.d/market-jury-deploy <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart market-jury.service
EOF
chmod 440 /etc/sudoers.d/market-jury-deploy
visudo -cf /etc/sudoers.d/market-jury-deploy

say "Services: the app and its nightly backup"
cat > /etc/systemd/system/market-jury.service <<EOF
[Unit]
Description=Market Jury
After=network-online.target
Wants=network-online.target
ConditionPathExists=$ROOT/current/server/index.js

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$ROOT/current
EnvironmentFile=$ENV_FILE
ExecStart=/usr/local/bin/bun server/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$ROOT/data
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/market-jury-backup.service <<EOF
[Unit]
Description=Market Jury nightly backup to Cloudflare R2
ConditionPathExists=$ROOT/current/scripts/backup.js

[Service]
Type=oneshot
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$ROOT/current
EnvironmentFile=$ENV_FILE
ExecStart=/usr/local/bin/bun scripts/backup.js
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$ROOT/data
EOF

# 02:00 UTC (04:00 in South Africa): after the evening decisions, before the 03:30 reboot window.
cat > /etc/systemd/system/market-jury-backup.timer <<'EOF'
[Unit]
Description=Nightly Market Jury backup

[Timer]
OnCalendar=*-*-* 02:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

# Run a command in the app's environment, as the app user, e.g.  mj run trade-master:setup
cat > /usr/local/bin/mj <<EOF
#!/bin/sh
set -e
set -a; . $ENV_FILE; set +a
cd $ROOT/current
exec runuser -u $APP_USER -- /usr/local/bin/bun "\$@"
EOF
chmod 755 /usr/local/bin/mj

systemctl daemon-reload
systemctl enable market-jury.service market-jury-backup.timer
systemctl start market-jury-backup.timer

say "Done"
ip=$(hostname -I | awk '{print $1}')
cat <<EOF
The server is ready for its first deploy. Next steps (details in deploy/README.md):

1. Cloudflare Tunnel: create a tunnel in the Cloudflare dashboard, then run the
   "cloudflared service install ..." command it shows, here on the server.
   Point the public hostname at http://localhost:3000.

2. GitHub Actions secrets (repo Settings > Secrets and variables > Actions):
   VPS_HOST         $ip
   VPS_KNOWN_HOSTS  $ip $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)
EOF
if [[ -n "$new_key" ]]; then
  cat <<EOF
   VPS_SSH_KEY      the whole private key printed by:  cat $new_key
                    (then delete it from the server:  rm $new_key)
EOF
else
  echo "   VPS_SSH_KEY      already set up earlier (the deploy key was not changed)"
fi
cat <<EOF

3. R2 backups: fill in the S3_ lines in $ENV_FILE (sudo nano $ENV_FILE).
EOF
