(() => {
  "use strict";

  const API = "/api/todos";
  const RING_LENGTH = 2 * Math.PI * 52;

  const $ = (sel) => document.querySelector(sel);
  const els = {
    form: $("#todo-form"),
    input: $("#todo-input"),
    due: $("#todo-due"),
    list: $("#todo-list"),
    template: $("#todo-template"),
    empty: $("#empty"),
    emptyTitle: $("#empty-title"),
    emptyText: $("#empty-text"),
    search: $("#search"),
    filters: document.querySelectorAll(".filter"),
    clear: $("#clear-completed"),
    footerCount: $("#footer-count"),
    progressBar: $("#progress-bar"),
    progressText: $("#progress-text"),
    toast: $("#toast"),
    theme: $("#theme-toggle"),
    stats: {
      total: $("#stat-total"),
      active: $("#stat-active"),
      done: $("#stat-done"),
      overdue: $("#stat-overdue"),
    },
  };

  const state = { todos: [], filter: "all", query: "" };

  // ---------- API ----------
  async function request(url, options = {}) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  const api = {
    list: () => request(API),
    create: (todo) => request(API, { method: "POST", body: JSON.stringify(todo) }),
    update: (id, patch) => request(`${API}/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    remove: (id) => request(`${API}/${id}`, { method: "DELETE" }),
    clearCompleted: () => request(`${API}?completed=true`, { method: "DELETE" }),
  };

  // ---------- helpers ----------
  function todayISO() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function dueInfo(due, completed) {
    if (!due) return null;
    const today = todayISO();
    const date = new Date(`${due}T00:00:00`);
    const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (completed) return { text: `📅 ${label}`, cls: "" };
    if (due < today) return { text: `⚠️ Overdue · ${label}`, cls: "overdue" };
    if (due === today) return { text: "⏰ Due today", cls: "today" };
    return { text: `📅 ${label}`, cls: "" };
  }

  let toastTimer;
  function toast(message, isError = false) {
    els.toast.textContent = message;
    els.toast.classList.toggle("error", isError);
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2400);
  }

  function sortTodos(todos) {
    const rank = { high: 0, medium: 1, low: 2 };
    return [...todos].sort(
      (a, b) =>
        Number(a.completed) - Number(b.completed) ||
        rank[a.priority] - rank[b.priority] ||
        b.id - a.id
    );
  }

  // ---------- rendering ----------
  function renderTodo(todo) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.dataset.id = todo.id;
    node.dataset.priority = todo.priority;
    node.classList.toggle("completed", todo.completed);

    const checkbox = node.querySelector("input[type=checkbox]");
    checkbox.checked = todo.completed;
    checkbox.setAttribute("aria-label", `Mark "${todo.title}" as ${todo.completed ? "active" : "done"}`);

    node.querySelector(".todo-title").textContent = todo.title;

    const chip = node.querySelector(".chip.priority");
    chip.textContent = todo.priority;
    chip.classList.add(todo.priority);

    const dueEl = node.querySelector(".due");
    const info = dueInfo(todo.due_date, todo.completed);
    if (info) {
      dueEl.textContent = info.text;
      if (info.cls) dueEl.classList.add(info.cls);
    } else {
      dueEl.remove();
    }
    return node;
  }

  function render() {
    const q = state.query.trim().toLowerCase();
    const visible = sortTodos(state.todos).filter((t) => {
      if (state.filter === "active" && t.completed) return false;
      if (state.filter === "completed" && !t.completed) return false;
      return !q || t.title.toLowerCase().includes(q);
    });

    els.list.replaceChildren(...visible.map(renderTodo));

    const total = state.todos.length;
    const done = state.todos.filter((t) => t.completed).length;
    const active = total - done;
    const today = todayISO();
    const overdue = state.todos.filter((t) => !t.completed && t.due_date && t.due_date < today).length;

    els.stats.total.textContent = total;
    els.stats.active.textContent = active;
    els.stats.done.textContent = done;
    els.stats.overdue.textContent = overdue;

    const pct = total ? Math.round((done / total) * 100) : 0;
    els.progressBar.style.strokeDashoffset = RING_LENGTH * (1 - pct / 100);
    els.progressText.textContent = `${pct}%`;

    els.footerCount.textContent = `${active} task${active === 1 ? "" : "s"} left`;
    els.clear.hidden = done === 0;

    els.empty.hidden = visible.length > 0;
    if (!visible.length) {
      if (q) {
        els.emptyTitle.textContent = "No matches";
        els.emptyText.textContent = `Nothing found for "${state.query.trim()}".`;
      } else if (state.filter === "completed") {
        els.emptyTitle.textContent = "Nothing completed yet";
        els.emptyText.textContent = "Check off a task and it will show up here.";
      } else if (state.filter === "active" && total) {
        els.emptyTitle.textContent = "You're all caught up! 🎉";
        els.emptyText.textContent = "Every task is done. Time for a break.";
      } else {
        els.emptyTitle.textContent = "All clear!";
        els.emptyText.textContent = "Add your first task above to get started.";
      }
    }
  }

  function replaceTodo(updated) {
    state.todos = state.todos.map((t) => (t.id === updated.id ? updated : t));
  }

  // ---------- actions ----------
  async function load() {
    try {
      state.todos = await api.list();
      render();
    } catch (err) {
      toast(`Could not load tasks: ${err.message}`, true);
    }
  }

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = els.input.value.trim();
    if (!title) return;
    const priority = els.form.querySelector("input[name=priority]:checked").value;
    const due_date = els.due.value || null;
    try {
      const created = await api.create({ title, priority, due_date });
      state.todos.push(created);
      els.input.value = "";
      els.due.value = "";
      render();
      els.input.focus();
    } catch (err) {
      toast(err.message, true);
    }
  });

  els.list.addEventListener("change", async (e) => {
    if (e.target.type !== "checkbox") return;
    const id = Number(e.target.closest(".todo").dataset.id);
    try {
      const updated = await api.update(id, { completed: e.target.checked });
      replaceTodo(updated);
      render();
      if (updated.completed) toast("Nice work! ✨");
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(err.message, true);
    }
  });

  els.list.addEventListener("click", async (e) => {
    const btn = e.target.closest(".delete");
    if (!btn) return;
    const item = btn.closest(".todo");
    const id = Number(item.dataset.id);
    try {
      await api.remove(id);
      item.classList.add("removing");
      // Timer rather than animationend so it still fires under prefers-reduced-motion.
      setTimeout(() => {
        state.todos = state.todos.filter((t) => t.id !== id);
        render();
      }, 280);
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Inline edit: double-click a title, Enter saves, Escape cancels.
  els.list.addEventListener("dblclick", (e) => {
    const titleEl = e.target.closest(".todo-title");
    if (!titleEl) return;
    const id = Number(titleEl.closest(".todo").dataset.id);
    const original = titleEl.textContent;
    titleEl.contentEditable = "true";
    titleEl.focus();
    document.getSelection().selectAllChildren(titleEl);

    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      titleEl.contentEditable = "false";
      const title = titleEl.textContent.trim();
      if (!save || !title || title === original) {
        titleEl.textContent = original;
        return;
      }
      try {
        replaceTodo(await api.update(id, { title }));
        render();
      } catch (err) {
        titleEl.textContent = original;
        toast(err.message, true);
      }
    };

    titleEl.addEventListener("keydown", function onKey(ev) {
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") { finish(false); }
      if (done) titleEl.removeEventListener("keydown", onKey);
    });
    titleEl.addEventListener("blur", () => finish(true), { once: true });
  });

  els.filters.forEach((btn) =>
    btn.addEventListener("click", () => {
      els.filters.forEach((b) => b.classList.toggle("active", b === btn));
      state.filter = btn.dataset.filter;
      render();
    })
  );

  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    render();
  });

  els.clear.addEventListener("click", async () => {
    try {
      const { deleted } = await api.clearCompleted();
      state.todos = state.todos.filter((t) => !t.completed);
      render();
      toast(`Cleared ${deleted} completed task${deleted === 1 ? "" : "s"}`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------- theme & header ----------
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }
  applyTheme(
    localStorage.getItem("theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
  els.theme.addEventListener("click", () =>
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark")
  );

  const now = new Date();
  $("#today").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const hour = now.getHours();
  $("#greeting").textContent =
    hour < 12 ? "Good morning — let's get things done." :
    hour < 18 ? "Good afternoon — keep the momentum going." :
    "Good evening — wrap up the day strong.";

  els.progressBar.style.strokeDasharray = RING_LENGTH;
  load();
})();
