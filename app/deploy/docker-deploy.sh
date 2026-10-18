#!/usr/bin/env bash
# Deploy / update the Taskflow Todo app as a Docker container on the EC2 host.
# Called by the CI pipeline over SSH, with the Docker Hub access token on stdin:
#   printf '%s' "$TOKEN" | ssh <host> "sudo IMAGE=<user>/todo-app:<tag> REGISTRY_USER=<user> bash docker-deploy.sh"
# REGISTRY_USER is optional; omit it (and stdin) for a public Docker Hub repo.
set -euo pipefail

: "${IMAGE:?IMAGE is required}"
REGISTRY_USER="${REGISTRY_USER:-}"
CONTAINER=todo-app
VOLUME=todo-data
HOST_PORT="${HOST_PORT:-80}"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing docker..."
  if command -v dnf >/dev/null 2>&1; then dnf install -y docker
  elif command -v yum >/dev/null 2>&1; then amazon-linux-extras install -y docker || yum install -y docker
  elif command -v apt-get >/dev/null 2>&1; then apt-get update -y && apt-get install -y docker.io
  else echo "Could not install docker: unknown package manager" >&2; exit 1
  fi
fi
systemctl enable --now docker

# The systemd (non-Docker) install from install.sh would hold port 80
if systemctl is-active --quiet todo-app 2>/dev/null; then
  echo "Stopping legacy systemd todo-app service..."
  systemctl disable --now todo-app
fi

if [[ -n "$REGISTRY_USER" ]]; then
  docker login --username "$REGISTRY_USER" --password-stdin
fi
docker pull "$IMAGE"
if [[ -n "$REGISTRY_USER" ]]; then
  docker logout >/dev/null
fi

PREVIOUS_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)"

start() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run -d \
    --name "$CONTAINER" \
    --restart unless-stopped \
    -p "$HOST_PORT:8080" \
    -v "$VOLUME:/data" \
    "$1"
}

healthy() {
  for _ in $(seq 1 15); do
    curl -fsS "http://127.0.0.1:$HOST_PORT/healthz" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

start "$IMAGE"
if healthy; then
  echo "✅ $IMAGE is running on port $HOST_PORT"
  docker image prune -af >/dev/null
  exit 0
fi

echo "❌ Health check failed for $IMAGE" >&2
docker logs --tail 50 "$CONTAINER" >&2 || true
if [[ -n "$PREVIOUS_IMAGE" && "$PREVIOUS_IMAGE" != "$IMAGE" ]]; then
  echo "Rolling back to $PREVIOUS_IMAGE" >&2
  start "$PREVIOUS_IMAGE"
  healthy && echo "Rollback succeeded" >&2 || echo "Rollback also failed" >&2
fi
exit 1
