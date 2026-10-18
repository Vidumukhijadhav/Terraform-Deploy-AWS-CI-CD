#!/usr/bin/env python3
"""Zero-dependency Todo app server (Python 3.8+ standard library only).

Serves the static frontend and a small JSON API backed by SQLite.
Users sign up / log in with a username and password; each user only sees
their own todos. Sessions are random tokens in an HttpOnly cookie.

Environment variables:
  HOST           bind address                        (default 0.0.0.0)
  PORT           listen port                         (default 8080)
  DB_PATH        SQLite file path                    (default ./data/todos.db)
  COOKIE_SECURE  set to 1 when served over HTTPS     (default 0)
"""

import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))
DB_PATH = Path(os.environ.get("DB_PATH", BASE_DIR / "data" / "todos.db"))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"

MAX_BODY = 16 * 1024
MAX_TITLE = 200
PRIORITIES = ("low", "medium", "high")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TODO_PATH_RE = re.compile(r"^/api/todos/(\d+)$")

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
MIN_PASSWORD = 8
MAX_PASSWORD = 128
PBKDF2_ITERATIONS = 260_000
COOKIE_NAME = "session"
SESSION_TTL = timedelta(days=7)

# Login throttling: at most LOGIN_MAX_FAILURES failed attempts per client IP per window.
LOGIN_MAX_FAILURES = 10
LOGIN_WINDOW_SECONDS = 15 * 60

_db_lock = threading.Lock()
_login_failures = {}
_login_lock = threading.Lock()


def now_iso(delta=timedelta(0)):
    return (datetime.now(timezone.utc) + delta).isoformat(timespec="seconds")


# ---------- passwords & sessions ----------
def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    try:
        _, iterations, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
    except ValueError:
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


# Compared against when the username does not exist, so response time doesn't reveal which usernames are taken.
_DUMMY_HASH = hash_password(secrets.token_hex(16))


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(conn, user_id):
    """Store a new session and return the raw token (only its hash is kept in the DB)."""
    token = secrets.token_urlsafe(32)
    conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now_iso(),))
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (token_hash(token), user_id, now_iso(SESSION_TTL)),
    )
    return token


def session_cookie(token, max_age=int(SESSION_TTL.total_seconds())):
    cookie = f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"
    return cookie + "; Secure" if COOKIE_SECURE else cookie


def login_blocked(ip):
    cutoff = time.monotonic() - LOGIN_WINDOW_SECONDS
    with _login_lock:
        recent = [t for t in _login_failures.get(ip, []) if t > cutoff]
        if recent:
            _login_failures[ip] = recent
        else:
            _login_failures.pop(ip, None)
        return len(recent) >= LOGIN_MAX_FAILURES


def record_login_failure(ip):
    with _login_lock:
        _login_failures.setdefault(ip, []).append(time.monotonic())


@contextmanager
def get_db():
    """Yield a connection that commits on success, rolls back on error, and always closes."""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
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
            CREATE TABLE IF NOT EXISTS users (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                username       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
                password_hash  TEXT    NOT NULL,
                created_at     TEXT    NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash  TEXT    PRIMARY KEY,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at  TEXT    NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS todos (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT    NOT NULL,
                completed   INTEGER NOT NULL DEFAULT 0,
                priority    TEXT    NOT NULL DEFAULT 'medium',
                due_date    TEXT,
                created_at  TEXT    NOT NULL,
                updated_at  TEXT    NOT NULL,
                user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        # Databases created before accounts existed have no user_id column; those todos stay unowned.
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(todos)")}
        if "user_id" not in columns:
            conn.execute("ALTER TABLE todos ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id)")


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


def validate_credentials(data, signup):
    if not isinstance(data, dict):
        raise ValidationError("Body must be a JSON object")
    username = data.get("username")
    password = data.get("password")
    if not isinstance(username, str) or not isinstance(password, str) or not username.strip() or not password:
        raise ValidationError("Username and password are required")
    username = username.strip()
    if signup:
        if not USERNAME_RE.match(username):
            raise ValidationError("Username must be 3-32 characters: letters, numbers, . _ -")
        if len(password) < MIN_PASSWORD:
            raise ValidationError(f"Password must be at least {MIN_PASSWORD} characters")
    if len(password) > MAX_PASSWORD:
        raise ValidationError(f"Password must be at most {MAX_PASSWORD} characters")
    return username, password


class Handler(BaseHTTPRequestHandler):
    server_version = "TodoApp/2.0"

    # ---------- helpers ----------
    def _security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:",
        )

    def _json(self, status, payload=None, cookie=None):
        body = b"" if payload is None else json.dumps(payload).encode()
        self.send_response(status)
        self._security_headers()
        if payload is not None:
            self.send_header("Content-Type", "application/json")
        if cookie:
            self.send_header("Set-Cookie", cookie)
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

    def _session_token(self):
        try:
            morsel = SimpleCookie(self.headers.get("Cookie") or "").get(COOKIE_NAME)
        except CookieError:
            return None
        return morsel.value if morsel else None

    def _current_user(self):
        """Return the logged-in user row, or None."""
        token = self._session_token()
        if not token:
            return None
        with get_db() as conn:
            return conn.execute(
                "SELECT users.id, users.username FROM sessions "
                "JOIN users ON users.id = sessions.user_id "
                "WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
                (token_hash(token), now_iso()),
            ).fetchone()

    def _require_user(self):
        user = self._current_user()
        if user is None:
            self._error(HTTPStatus.UNAUTHORIZED, "Please log in")
        return user

    # ---------- auth routes ----------
    def _signup(self):
        try:
            username, password = validate_credentials(self._read_json(), signup=True)
        except ValidationError as e:
            return self._error(HTTPStatus.BAD_REQUEST, str(e))
        password_hash = hash_password(password)
        try:
            with _db_lock, get_db() as conn:
                cur = conn.execute(
                    "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                    (username, password_hash, now_iso()),
                )
                token = create_session(conn, cur.lastrowid)
        except sqlite3.IntegrityError:
            return self._error(HTTPStatus.CONFLICT, "That username is already taken")
        return self._json(HTTPStatus.CREATED, {"user": {"username": username}}, cookie=session_cookie(token))

    def _login(self):
        ip = self.client_address[0]
        if login_blocked(ip):
            return self._error(HTTPStatus.TOO_MANY_REQUESTS, "Too many failed attempts. Try again in a few minutes.")
        try:
            username, password = validate_credentials(self._read_json(), signup=False)
        except ValidationError as e:
            return self._error(HTTPStatus.BAD_REQUEST, str(e))
        with get_db() as conn:
            user = conn.execute(
                "SELECT id, username, password_hash FROM users WHERE username = ?", (username,)
            ).fetchone()
        if not verify_password(password, user["password_hash"] if user else _DUMMY_HASH) or not user:
            record_login_failure(ip)
            return self._error(HTTPStatus.UNAUTHORIZED, "Wrong username or password")
        with _db_lock, get_db() as conn:
            token = create_session(conn, user["id"])
        return self._json(HTTPStatus.OK, {"user": {"username": user["username"]}}, cookie=session_cookie(token))

    def _logout(self):
        token = self._session_token()
        if token:
            with _db_lock, get_db() as conn:
                conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))
        return self._json(HTTPStatus.OK, {"ok": True}, cookie=session_cookie("", max_age=0))

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
        if url.path == "/api/auth/me":
            user = self._require_user()
            if user:
                self._json(HTTPStatus.OK, {"user": {"username": user["username"]}})
            return
        if url.path == "/api/todos":
            user = self._require_user()
            if not user:
                return
            with get_db() as conn:
                rows = conn.execute(
                    "SELECT * FROM todos WHERE user_id = ? ORDER BY completed ASC, "
                    "CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, "
                    "id DESC",
                    (user["id"],),
                ).fetchall()
            return self._json(HTTPStatus.OK, [row_to_dict(r) for r in rows])
        if url.path.startswith("/api/"):
            return self._error(HTTPStatus.NOT_FOUND, "Not found")
        return self._serve_static(url.path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/auth/signup":
            return self._signup()
        if path == "/api/auth/login":
            return self._login()
        if path == "/api/auth/logout":
            return self._logout()
        if path != "/api/todos":
            return self._error(HTTPStatus.NOT_FOUND, "Not found")
        user = self._require_user()
        if not user:
            return
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
                "INSERT INTO todos (title, completed, priority, due_date, created_at, updated_at, user_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (fields["title"], fields["completed"], fields["priority"], fields["due_date"], ts, ts, user["id"]),
            )
            row = conn.execute("SELECT * FROM todos WHERE id = ?", (cur.lastrowid,)).fetchone()
        return self._json(HTTPStatus.CREATED, row_to_dict(row))

    def do_PATCH(self):
        m = TODO_PATH_RE.match(urlparse(self.path).path)
        if not m:
            return self._error(HTTPStatus.NOT_FOUND, "Not found")
        user = self._require_user()
        if not user:
            return
        try:
            fields = validate_fields(self._read_json(), partial=True)
        except ValidationError as e:
            return self._error(HTTPStatus.BAD_REQUEST, str(e))
        fields["updated_at"] = now_iso()
        # Column names come from validate_fields' fixed whitelist, never from user input.
        assignments = ", ".join(f"{col} = ?" for col in fields)
        with _db_lock, get_db() as conn:
            cur = conn.execute(
                f"UPDATE todos SET {assignments} WHERE id = ? AND user_id = ?",
                (*fields.values(), int(m.group(1)), user["id"]),
            )
            if cur.rowcount == 0:
                return self._error(HTTPStatus.NOT_FOUND, "Todo not found")
            row = conn.execute("SELECT * FROM todos WHERE id = ?", (int(m.group(1)),)).fetchone()
        return self._json(HTTPStatus.OK, row_to_dict(row))

    def do_DELETE(self):
        url = urlparse(self.path)
        m = TODO_PATH_RE.match(url.path)
        if url.path != "/api/todos" and not m:
            return self._error(HTTPStatus.NOT_FOUND, "Not found")
        user = self._require_user()
        if not user:
            return
        if url.path == "/api/todos":
            # Only bulk-delete completed todos; never wipe everything by accident.
            if parse_qs(url.query).get("completed") != ["true"]:
                return self._error(HTTPStatus.BAD_REQUEST, "Use ?completed=true to clear completed todos")
            with _db_lock, get_db() as conn:
                cur = conn.execute("DELETE FROM todos WHERE completed = 1 AND user_id = ?", (user["id"],))
            return self._json(HTTPStatus.OK, {"deleted": cur.rowcount})
        with _db_lock, get_db() as conn:
            cur = conn.execute("DELETE FROM todos WHERE id = ? AND user_id = ?", (int(m.group(1)), user["id"]))
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
