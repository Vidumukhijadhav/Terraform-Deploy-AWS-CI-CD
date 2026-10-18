# Taskflow Todo App — Python standard library only, no pip dependencies.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8080 \
    DB_PATH=/data/todos.db

# Run as an unprivileged user
RUN groupadd --system todoapp \
 && useradd --system --gid todoapp --no-create-home --shell /usr/sbin/nologin todoapp \
 && mkdir -p /data \
 && chown todoapp:todoapp /data

WORKDIR /app
COPY server.py ./
COPY static/ ./static/

USER todoapp

# SQLite database lives here; mount a volume to persist todos
VOLUME ["/data"]

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/healthz', timeout=2)" || exit 1

CMD ["python", "server.py"]
