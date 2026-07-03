#!/bin/bash
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo bash setup-linux.sh"
  exit 1
fi

echo "Installing coTURN..."
apt-get update -qq
apt-get install -y -qq coturn

echo "Configuring coTURN..."
cp turnserver.conf /etc/turnserver.conf

echo "Enabling coTURN service..."
if [ -f /etc/default/coturn ]; then
  sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
fi

echo "Starting coTURN..."
systemctl restart coturn
systemctl enable coturn

echo ""
echo "=== coTURN is running ==="
echo "Port:     3478 (TCP+UDP)"
echo "Username: echoza"
echo "Password: echoza123"
echo ""
echo "Next: Open port 3478 TCP/UDP in your firewall:"
echo "  sudo ufw allow 3478/tcp"
echo "  sudo ufw allow 3478/udp"
echo ""
echo "Then update TURN_URL in your server/.env and render.yaml"
echo "with this server's public IP: $(curl -s ifconfig.me 2>/dev/null || echo '<your-public-ip>')"
