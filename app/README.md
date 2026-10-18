# Taskflow — Todo App

A lightweight todo app with a glassmorphism UI, light and dark themes, priorities, due dates, search, filters, and a progress ring.

- **Accounts:** sign up and log in with a username and password. Each user only sees their own tasks.
- **3D (Three.js):** glossy floating shapes in the background that follow your mouse and scroll, a 3D Taski who turns to look at your cursor, 3D confetti when you finish a task (and a confetti storm when you finish them all), and cards that tilt in 3D on hover. Browsers without WebGL get the 2D version.
- **Motivation:** a quote of the day (with a 🔄 button for a new one), emoji everywhere, and **Taski**, an animated cartoon mascot that waves, cheers when you complete a task, and throws a party when everything is done 🎉.

- **Backend:** Python 3 standard library only (`http.server` + `sqlite3`). There is nothing to `pip install`.
- **Frontend:** Vanilla HTML/CSS/JS served by the same process. Three.js r186 is vendored (minified) in `static/vendor/three/` because the Content-Security-Policy only allows scripts from the app itself. There is no build step.
- **Storage:** SQLite file (default `/var/lib/todo-app/todos.db` when installed as a service).

```
app/
├── server.py                 # HTTP server + JSON API
├── static/                   # index.html, style.css, app.js, quotes.js
│   ├── scene3d.js            # Three.js scene: background, 3D mascot, confetti, card tilt
│   └── vendor/three/         # three.module.js + three.core.js (MIT, see VERSION)
└── deploy/
    ├── install.sh            # one-shot installer (systemd)
    └── todo-app.service      # systemd unit (runs as non-root on port 80)
```

## Run locally

```bash
cd app
python3 server.py            # http://localhost:8080
PORT=3000 python3 server.py  # custom port
```

## Deploy to EC2

1. Copy the app to the instance. The instance is in a private subnet, so go through a bastion or SSM:
   ```bash
   scp -r -i testme.pem app ec2-user@<host>:~/
   ```
2. Install and start it:
   ```bash
   ssh -i testme.pem ec2-user@<host>
   cd ~/app && sudo ./deploy/install.sh
   ```
3. Manage it:
   ```bash
   sudo systemctl status todo-app
   sudo journalctl -u todo-app -f
   ```

To update, copy the new files and re-run `install.sh`. Your data in `/var/lib/todo-app` is kept.

## Making it reachable

The current Terraform (`modules/compute`) only allows **SSH (22)** and places the instance in a **private subnet**. To open the app in a browser, you need one of:

- **Quick test:** an SSH tunnel through a bastion: `ssh -L 8080:<private-ip>:80 ...`, then open http://localhost:8080
- **Public instance:** put the instance in a public subnet and add an HTTP (80) ingress rule to the security group.
- **Recommended:** keep it private and put an Application Load Balancer in the public subnets that forwards to port 80.

## Accounts and security

- Passwords are hashed with PBKDF2-SHA256 (260k iterations, random salt). They are never stored in plain text.
- A login creates a random session token in an `HttpOnly`, `SameSite=Lax` cookie that lasts 7 days. The database only keeps a SHA-256 hash of the token.
- After 10 failed logins from one IP in 15 minutes, logins from that IP are refused for the rest of the window.
- Usernames are case-insensitive (`Alice` and `alice` are the same account).
- **HTTPS:** the app runs over plain HTTP on port 80 by default. If you put it behind HTTPS (for example an ALB with a certificate), set `COOKIE_SECURE=1` so the session cookie is only sent over HTTPS. Over plain HTTP, passwords travel unencrypted.
- **Upgrading:** todos created before accounts existed have no owner and are not shown to anyone.

## API

All `/api/todos` routes require a logged-in session and only touch the current user's todos. Otherwise they return `401`.

| Method | Path                          | Body / notes                                      |
|--------|-------------------------------|---------------------------------------------------|
| POST   | `/api/auth/signup`            | `{ "username", "password" }` → sets session cookie |
| POST   | `/api/auth/login`             | `{ "username", "password" }` → sets session cookie |
| POST   | `/api/auth/logout`            | Ends the session                                  |
| GET    | `/api/auth/me`                | `{ "user": { "username" } }` or `401`             |
| GET    | `/api/todos`                  | List your todos                                   |
| POST   | `/api/todos`                  | `{ "title", "priority"?, "due_date"? }`           |
| PATCH  | `/api/todos/:id`              | Any of `title`, `completed`, `priority`, `due_date` |
| DELETE | `/api/todos/:id`              | Delete one                                        |
| DELETE | `/api/todos?completed=true`   | Clear all completed                               |
| GET    | `/healthz`                    | Health check (for ALB target groups)              |

`priority` is one of `low | medium | high`. `due_date` is `YYYY-MM-DD` or `null`.
