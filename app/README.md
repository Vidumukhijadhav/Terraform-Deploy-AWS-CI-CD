# Taskflow — Todo App

A lightweight todo app with a glassmorphism UI, light and dark themes, priorities, due dates, search, filters, and a progress ring.

- **Backend:** Python 3 standard library only (`http.server` + `sqlite3`). There is nothing to `pip install`.
- **Frontend:** Vanilla HTML/CSS/JS served by the same process.
- **Storage:** SQLite file (default `/var/lib/todo-app/todos.db` when installed as a service).

```
app/
├── server.py                 # HTTP server + JSON API
├── static/                   # index.html, style.css, app.js
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

## API

| Method | Path                          | Body / notes                                      |
|--------|-------------------------------|---------------------------------------------------|
| GET    | `/api/todos`                  | List all todos                                    |
| POST   | `/api/todos`                  | `{ "title", "priority"?, "due_date"? }`           |
| PATCH  | `/api/todos/:id`              | Any of `title`, `completed`, `priority`, `due_date` |
| DELETE | `/api/todos/:id`              | Delete one                                        |
| DELETE | `/api/todos?completed=true`   | Clear all completed                               |
| GET    | `/healthz`                    | Health check (for ALB target groups)              |

`priority` is one of `low | medium | high`. `due_date` is `YYYY-MM-DD` or `null`.
