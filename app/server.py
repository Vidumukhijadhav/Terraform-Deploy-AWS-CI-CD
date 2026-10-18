#!/usr/bin/env python3
"""Zero-dependency Todo app server (Python 3.8+ standard library only).

Serves the static frontend and a small JSON API backed by SQLite.

Environment variables:
  HOST     bind address        (default 0.0.0.0)
  PORT     listen port         (default 8080)
  DB_PATH  SQLite file path    (default ./data/todos.db)
"""

import json
import mimetypes
import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))
DB_PATH = Path(os.environ.get("DB_PATH", BASE_DIR / "data" / "todos.db"))

MAX_BODY = 16 * 1024
MAX_TITLE = 200
PRIORITIES = ("low", "medium", "high")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TODO_PATH_RE = re.compile(r"^/api/todos/(\d+)$")

_db_lock = threading.Lock()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def get_db():
    """Yield a connection that commits on success, rolls back on error, and always closes."""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS todos (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT    NOT NULL,
                completed   INTEGER NOT NULL DEFAULT 0,
                priority    TEXT    NOT NULL DEFAULT 'medium',
                due_date    TEXT,
                created_at  TEXT    NOT NULL,
                updated_at  TEXT    NOT NULL
            )
            """
        )


def row_to_dict(row):
    return {
        "id": row["id"],
        "title": row["title"],
        "completed": bool(row["completed"]),
        "priority": row["priority"],
        "due_date": row["due_date"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


class ValidationError(Exception):
    pass


def validate_fields(data, partial):
    """Return a dict of sanitized column -> value pairs."""
    if not isinstance(data, dict):
        raise ValidationError("Body must be a JSON object")
    out = {}

    if "title" in data or not partial:
        title = data.get("title")
        if not isinstance(title, str) or not title.strip():
            raise ValidationError("title is required")
        title = title.strip()
        if len(title) > MAX_TITLE:
            raise ValidationError(f"title must be at most {MAX_TITLE} characters")
        out["title"] = title

    if "completed" in data:
        if not isinstance(data["completed"], bool):
            raise ValidationError("completed must be a boolean")
        out["completed"] = int(data["completed"])

    if "priority" in data:
        if data["priority"] not in PRIORITIES:
            raise ValidationError(f"priority must be one of {', '.join(PRIORITIES)}")
        out["priority"] = data["priority"]

    if "due_date" in data:
        due = data["due_date"]
        if due in (None, ""):
            out["due_date"] = None
        elif isinstance(due, str) and DATE_RE.match(due):
            out["due_date"] = due
        else:
            raise ValidationError("due_date must be YYYY-MM-DD or null")

    if partial and not out:
        raise ValidationError("No valid fields to update")
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "TodoApp/1.0"

    # ---------- helpers ----------
    def _security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:",
        )

    def _json(self, status, payload=None):
        body = b"" if payload is None else json.dumps(payload).encode()
        self.send_response(status)
        self._security_headers()
        if payload is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _error(self, status, message):
        self._json(status, {"error": message})

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValidationError("Request body too large")
        raw = self.rfile.read(length) if length else b""
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            raise ValidationError("Invalid JSON")

    def _serve_static(self, path):
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        target = (STATIC_DIR / rel).resolve()
        if STATIC_DIR not in target.parents or not target.is_file():
            target = STATIC_DIR / "index.html"
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self._security_headers()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    # ---------- routes ----------
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/healthz":
            return self._json(HTTPStatus.OK, {"status": "ok"})
        if url.path == "/api/todos":
            with get_db() as conn:
                rows = conn.execute(
                    "SELECT * FROM todos ORDER BY completed ASC, "
                    "CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, "
                    "id DESC"
                ).fetchall()
            return self._json(HTTPStatus.OK, [row_to_dict(r) for r in rows])
        if url.path.startswith("/api/"):
            return self._error(HTTPStatus.NOT_FOUND, "Not found")
        return self._serve_static(url.path)

    def do_POST(self):
        if urlparse(self.path).path != "/api/todos":
            return self._error(HTTPStatus.NOT_FOUND, "Not found")
        try:
            fields = validate_fields(self._read_json(), partial=False)
        except ValidationError as e:
            return self._error(HTTPStatus.BAD_REQUEST, str(e))
        fields.setdefault("priority", "medium")
        fields.setdefault("completed", 0)
        fields.setdefault("due_date", None)
        ts = now_iso()
        with _db_lock, get_db() as conn:
            cur = conn.execute(
                "INSERT INTO todos (title, completed, priority, due_date, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (fields["title"], fields["completed"], fields["priority"], fields["due_date"], ts, ts),
            )
            row = conn.execute("SELECT * FROM todos WHERE id = ?", (cur.lastrowid,)).fetchone()
        return self._json(HTTPStatus.CREATED, row_to_dict(row))

    def do_PATCH(self):
        m = TODO_PATH_RE.match(urlparse(self.path).path)
        if not m:
            return self._error(HTTPStatus.NOT_FOUND, "Not found")
        try:
            fields = validate_fields(self._read_json(), partial=True)
        except ValidationError as e:
            return self._error(HTTPStatus.BAD_REQUEST, str(e))
        fields["updated_at"] = now_iso()
        # Column names come from validate_fields' fixed whitelist, never from user input.
        assignments = ", ".join(f"{col} = ?" for col in fields)
        with _db_lock, get_db() as conn:
            cur = conn.execute(
                f"UPDATE todos SET {assignments} WHERE id = ?",
                (*fields.values(), int(m.group(1))),
            )
            if cur.rowcount == 0:
                return self._error(HTTPStatus.NOT_FOUND, "Todo not found")
            row = conn.execute("SELECT * FROM todos WHERE id = ?", (int(m.group(1)),)).fetchone()
        return self._json(HTTPStatus.OK, row_to_dict(row))

    def do_DELETE(self):
        url = urlparse(self.path)
        if url.path == "/api/todos":
            # Only bulk-delete completed todos; never wipe everything by accident.
            if parse_qs(url.query).get("completed") != ["true"]:
                return self._error(HTTPStatus.BAD_REQUEST, "Use ?completed=true to clear completed todos")
            with _db_lock, get_db() as conn:
                cur = conn.execute("DELETE FROM todos WHERE completed = 1")
            return self._json(HTTPStatus.OK, {"deleted": cur.rowcount})
        m = TODO_PATH_RE.match(url.path)
        if not m:
            return self._error(HTTPStatus.NOT_FOUND, "Not found")
        with _db_lock, get_db() as conn:
            cur = conn.execute("DELETE FROM todos WHERE id = ?", (int(m.group(1)),))
        if cur.rowcount == 0:
            return self._error(HTTPStatus.NOT_FOUND, "Todo not found")
        return self._json(HTTPStatus.NO_CONTENT)

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}", flush=True)


def main():
    init_db()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Todo app listening on http://{HOST}:{PORT} (db: {DB_PATH})", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
