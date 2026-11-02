#!/bin/bash
# ╔══════════════════════════════════════════════════════════╗
# ║          NVM Panel - Automated Setup Script              ║
# ║          https://github.com/adityazdomainzz-code/NVM     ║
# ╚══════════════════════════════════════════════════════════╝
# Supported: Ubuntu 20.04+, Debian 11+
# Run as root: bash setup.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

PANEL_DIR="/opt/nvm-panel"
PANEL_PORT=6767
SERVICE_NAME="nvm-panel"
REPO_URL="https://github.com/adityazdomainzz-code/NVM"

print_banner() {
  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ███╗   ██╗██╗   ██╗███╗   ███╗    ██████╗  █████╗ ███╗   ██╗███████╗██╗     "
  echo "  ████╗  ██║██║   ██║████╗ ████║    ██╔══██╗██╔══██╗████╗  ██║██╔════╝██║     "
  echo "  ██╔██╗ ██║██║   ██║██╔████╔██║    ██████╔╝███████║██╔██╗ ██║█████╗  ██║     "
  echo "  ██║╚██╗██║╚██╗ ██╔╝██║╚██╔╝██║    ██╔═══╝ ██╔══██║██║╚██╗██║██╔══╝  ██║     "
  echo "  ██║ ╚████║ ╚████╔╝ ██║ ╚═╝ ██║    ██║     ██║  ██║██║ ╚████║███████╗███████╗"
  echo "  ╚═╝  ╚═══╝  ╚═══╝  ╚═╝     ╚═╝    ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝"
  echo -e "${RESET}"
  echo -e "  ${BLUE}VM Management Panel Installer${RESET}"
  echo -e "  ${YELLOW}Port: ${PANEL_PORT}  |  Dir: ${PANEL_DIR}${RESET}"
  echo ""
}

log()  { echo -e "${GREEN}[✔]${RESET} $1"; }
info() { echo -e "${BLUE}[→]${RESET} $1"; }
warn() { echo -e "${YELLOW}[!]${RESET} $1"; }
fail() { echo -e "${RED}[✘]${RESET} $1"; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}══ $1 ══${RESET}"; }

# ── Root check ──────────────────────────────────────────────
print_banner
[ "$(id -u)" != "0" ] && fail "Please run as root: sudo bash setup.sh"

# ── Detect OS ───────────────────────────────────────────────
step "Detecting OS"
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
  VER=$VERSION_ID
  info "Detected: $PRETTY_NAME"
else
  fail "Cannot detect OS. Supported: Ubuntu 20.04+, Debian 11+"
fi

# ── Update system ────────────────────────────────────────────
step "Updating system packages"
apt-get update -qq
apt-get upgrade -y -qq
log "System updated"

# ── Install dependencies ─────────────────────────────────────
step "Installing dependencies"
apt-get install -y -qq curl git wget unzip build-essential python3 \
  lxc lxc-utils lxc-templates libpam-cgfs cgroupfs-mount uidmap \
  openssh-client openssh-server qemu-kvm libvirt-daemon-system \
  libvirt-clients bridge-utils virtinst 2>/dev/null || \
  apt-get install -y -qq curl git wget unzip build-essential python3 \
  openssh-client openssh-server
log "Dependencies installed"

# ── Install Node.js 20 ───────────────────────────────────────
step "Installing Node.js 20"
if ! command -v node &>/dev/null || [[ "$(node -v 2>/dev/null)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs
  log "Node.js $(node -v) installed"
else
  log "Node.js $(node -v) already present"
fi

# ── Clone / copy panel ───────────────────────────────────────
step "Setting up NVM Panel"
if [ -d "$PANEL_DIR" ]; then
  warn "Panel directory exists — backing up to ${PANEL_DIR}.bak"
  mv "$PANEL_DIR" "${PANEL_DIR}.bak.$(date +%s)"
fi

# If git repo is available, clone it; otherwise copy from current dir
if git ls-remote "$REPO_URL" &>/dev/null; then
  info "Cloning from GitHub..."
  git clone "$REPO_URL" /tmp/nvm-repo 2>/dev/null || true
  if [ -d /tmp/nvm-repo/nvm-panel ]; then
    cp -r /tmp/nvm-repo/nvm-panel "$PANEL_DIR"
    rm -rf /tmp/nvm-repo
  else
    mkdir -p "$PANEL_DIR"
    cp -r /tmp/nvm-repo/. "$PANEL_DIR/" 2>/dev/null || true
    rm -rf /tmp/nvm-repo
  fi
else
  warn "GitHub repo not accessible — installing from local files"
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -d "$SCRIPT_DIR/nvm-panel" ]; then
    cp -r "$SCRIPT_DIR/nvm-panel" "$PANEL_DIR"
  else
    fail "Neither GitHub repo nor local nvm-panel/ directory found."
  fi
fi

log "Panel files placed at $PANEL_DIR"

# ── Install npm packages ─────────────────────────────────────
step "Installing Node.js dependencies"
cd "$PANEL_DIR"
npm install --production --loglevel=error
log "npm install complete"

# ── Create data & uploads dirs ───────────────────────────────
step "Creating directories"
mkdir -p "$PANEL_DIR/data"
mkdir -p "$PANEL_DIR/public/uploads"
chmod 755 "$PANEL_DIR/public/uploads"
log "Directories created"

# ── Create systemd service ───────────────────────────────────
step "Creating systemd service"
cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=NVM Panel - VM Management Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${PANEL_DIR}
ExecStart=/usr/bin/node ${PANEL_DIR}/src/app.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=${PANEL_PORT}
StandardOutput=journal
StandardError=journal
SyslogIdentifier=nvm-panel

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
log "Systemd service created and enabled"

# ── Open firewall port ───────────────────────────────────────
step "Configuring firewall"
if command -v ufw &>/dev/null; then
  ufw allow "$PANEL_PORT"/tcp >/dev/null 2>&1 && log "UFW: port $PANEL_PORT allowed"
fi
if command -v firewall-cmd &>/dev/null; then
  firewall-cmd --permanent --add-port="$PANEL_PORT"/tcp >/dev/null 2>&1
  firewall-cmd --reload >/dev/null 2>&1
  log "firewalld: port $PANEL_PORT allowed"
fi

# ── Start service ────────────────────────────────────────────
step "Starting NVM Panel"
systemctl start "$SERVICE_NAME"
sleep 3

if systemctl is-active --quiet "$SERVICE_NAME"; then
  log "NVM Panel is running!"
else
  warn "Service may not have started. Check: journalctl -u $SERVICE_NAME -n 50"
fi

# ── Get server IP ────────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}')

# ── Done ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║           NVM Panel Setup Complete!                  ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Panel URL:${RESET}   ${CYAN}http://${SERVER_IP}:${PANEL_PORT}${RESET}"
echo -e "  ${BOLD}Username:${RESET}    ${YELLOW}admin${RESET}"
echo -e "  ${BOLD}Password:${RESET}    ${YELLOW}admin123${RESET}"
echo ""
echo -e "  ${BOLD}Service commands:${RESET}"
echo -e "  ${BLUE}systemctl status ${SERVICE_NAME}${RESET}"
echo -e "  ${BLUE}systemctl restart ${SERVICE_NAME}${RESET}"
echo -e "  ${BLUE}journalctl -u ${SERVICE_NAME} -f${RESET}"
echo ""
echo -e "  ${RED}⚠  Change the admin password immediately after login!${RESET}"
echo ""
