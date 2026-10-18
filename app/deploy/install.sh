#!/usr/bin/env bash
# Install / update the Taskflow Todo app as a systemd service.
# Run on the EC2 instance from inside the app/ directory:  sudo ./deploy/install.sh
set -euo pipefail

APP_DIR=/opt/todo-app
DATA_DIR=/var/lib/todo-app
SERVICE=todo-app
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (sudo $0)" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Installing python3..."
  if command -v dnf >/dev/null 2>&1; then dnf install -y python3
  elif command -v yum >/dev/null 2>&1; then yum install -y python3
  elif command -v apt-get >/dev/null 2>&1; then apt-get update -y && apt-get install -y python3
  else echo "Could not install python3: unknown package manager" >&2; exit 1
  fi
fi

if ! id todoapp >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin todoapp
fi

install -d -o root -g root -m 755 "$APP_DIR" "$APP_DIR/static"
install -d -o todoapp -g todoapp -m 750 "$DATA_DIR"
install -m 644 "$SRC_DIR/server.py" "$APP_DIR/server.py"
install -m 644 "$SRC_DIR"/static/* "$APP_DIR/static/"
install -m 644 "$SRC_DIR/deploy/todo-app.service" "/etc/systemd/system/$SERVICE.service"

systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"

sleep 1
if curl -fsS http://127.0.0.1/healthz >/dev/null; then
  echo "✅ Todo app is running on port 80"
else
  echo "⚠️  Service started but health check failed. Check: journalctl -u $SERVICE -e" >&2
  exit 1
fi
