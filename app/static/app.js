(() => {
  "use strict";

  const API = "/api/todos";
  const AUTH = "/api/auth";
  const RING_LENGTH = 2 * Math.PI * 52;
  const QUOTES = window.TASKFLOW_QUOTES || [];
  const CHEERS = window.TASKFLOW_CHEERS || ["Nice work! ✨"];
  const PRIORITY_EMOJI = { low: "🌱", medium: "⚡", high: "🔥" };
  const CONFETTI = ["🎉", "✨", "⭐", "💖", "🌟", "🎊", "💫"];

  const $ = (sel) => document.querySelector(sel);
  const els = {
    app: $("#app"),
    auth: $("#auth"),
    authForm: $("#auth-form"),
    authTabs: document.querySelectorAll(".auth-tabs .filter"),
    authUsername: $("#auth-username"),
    authPassword: $("#auth-password"),
    authConfirm: $("#auth-confirm"),
    confirmField: $("#confirm-field"),
    authHint: $("#auth-hint"),
    authError: $("#auth-error"),
    authSubmit: $("#auth-submit"),
    authSubtitle: $("#auth-subtitle"),
    authQuote: $("#auth-quote"),
    logout: $("#logout"),
    quoteText: $("#quote-text"),
    quoteAuthor: $("#quote-author"),
    newQuote: $("#new-quote"),
    mascotTemplate: $("#mascot-template"),
    appMascot: $("#app-mascot"),
    confetti: $("#confetti"),
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

  const state = { todos: [], filter: "all", query: "", user: null, authMode: "login", quoteIndex: -1 };

  // ---------- API ----------
  async function request(url, options = {}) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.startsWith(AUTH)) showAuth("Your session expired. Please log in again.");
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  const authApi = {
    me: () => request(`${AUTH}/me`),
    login: (creds) => request(`${AUTH}/login`, { method: "POST", body: JSON.stringify(creds) }),
    signup: (creds) => request(`${AUTH}/signup`, { method: "POST", body: JSON.stringify(creds) }),
    logout: () => request(`${AUTH}/logout`, { method: "POST" }),
  };

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

  // ---------- mascot, quotes & confetti ----------
  document.querySelectorAll(".mascot-slot").forEach((slot) =>
    slot.appendChild(els.mascotTemplate.content.firstElementChild.cloneNode(true))
  );

  let mascotTimer;
  // Play a one-off mood animation ("cheer", "oops"), then fall back to the resting mood.
  function mascotReact(slot, mood) {
    slot.dataset.mood = mood;
    clearTimeout(mascotTimer);
    mascotTimer = setTimeout(() => setRestingMood(slot), 1400);
  }

  function setRestingMood(slot) {
    if (slot === els.appMascot) {
      const total = state.todos.length;
      const allDone = total > 0 && state.todos.every((t) => t.completed);
      slot.dataset.mood = allDone ? "party" : "wave";
    } else {
      slot.dataset.mood = "wave";
    }
  }

  function quoteOfTheDay() {
    const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
    return day % QUOTES.length;
  }

  function showQuote(index) {
    if (!QUOTES.length) return;
    state.quoteIndex = index;
    const q = QUOTES[index];
    els.quoteText.textContent = `“${q.text}”`;
    els.quoteAuthor.textContent = `— ${q.author}`;
    els.quoteText.parentElement.classList.remove("pop");
    void els.quoteText.offsetWidth; // restart the pop animation
    els.quoteText.parentElement.classList.add("pop");
  }

  function randomQuoteIndex() {
    if (QUOTES.length < 2) return 0;
    let i;
    do { i = Math.floor(Math.random() * QUOTES.length); } while (i === state.quoteIndex);
    return i;
  }

  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function burstConfetti(fromEl) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = fromEl.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    // scene3d.js (Three.js) sets window.taskflow3d when WebGL works; otherwise use emoji confetti.
    if (window.taskflow3d) return window.taskflow3d.burst(x, y);
    for (let i = 0; i < 14; i++) {
      const bit = document.createElement("span");
      bit.className = "confetti";
      bit.textContent = pick(CONFETTI);
      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 90;
      bit.style.left = `${x}px`;
      bit.style.top = `${y}px`;
      bit.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      bit.style.setProperty("--dy", `${Math.sin(angle) * dist - 40}px`);
      bit.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
      els.confetti.appendChild(bit);
      setTimeout(() => bit.remove(), 1100);
    }
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
    chip.textContent = `${PRIORITY_EMOJI[todo.priority]} ${todo.priority}`;
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
    window.taskflow3d?.setProgress(pct);

    els.footerCount.textContent = active
      ? `${active} task${active === 1 ? "" : "s"} left 💪`
      : total ? "Everything done! 🏆" : "No tasks yet 🌱";
    if (els.appMascot.dataset.mood !== "cheer") setRestingMood(els.appMascot);
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
      const checkmark = e.target.nextElementSibling;
      replaceTodo(updated);
      if (updated.completed) {
        burstConfetti(checkmark);
        mascotReact(els.appMascot, "cheer");
        if (state.todos.every((t) => t.completed)) {
          window.taskflow3d?.celebrate();
          toast("Everything done! You're a legend 🏆🎉");
        } else {
          toast(pick(CHEERS));
        }
      }
      render();
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

  // ---------- auth ----------
  function setAuthMode(mode) {
    state.authMode = mode;
    const signup = mode === "signup";
    els.authTabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
    els.confirmField.hidden = !signup;
    els.authConfirm.required = signup;
    els.authHint.hidden = !signup;
    els.authPassword.autocomplete = signup ? "new-password" : "current-password";
    els.authSubmit.textContent = signup ? "Create account 🎉" : "Log in 🚀";
    els.authSubtitle.textContent = signup
      ? "Create an account and start crushing your goals ✨"
      : "Welcome back! Log in to see your tasks 👋";
    els.authError.textContent = "";
  }

  function showAuth(message = "") {
    state.user = null;
    state.todos = [];
    els.app.hidden = true;
    els.auth.hidden = false;
    els.authPassword.value = "";
    els.authConfirm.value = "";
    els.authError.textContent = message;
    if (QUOTES.length) {
      const q = QUOTES[randomQuoteIndex()];
      els.authQuote.textContent = `“${q.text}” — ${q.author}`;
    }
    els.authUsername.focus();
  }

  function enterApp(user) {
    state.user = user;
    els.auth.hidden = true;
    els.app.hidden = false;
    updateGreeting();
    showQuote(quoteOfTheDay());
    load();
  }

  els.authTabs.forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.mode)));

  els.authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = els.authUsername.value.trim();
    const password = els.authPassword.value;
    const signup = state.authMode === "signup";
    const authMascot = els.auth.querySelector(".mascot-slot");
    const fail = (msg) => {
      els.authError.textContent = msg;
      mascotReact(authMascot, "oops");
    };
    if (!username || !password) return fail("Please enter a username and password 🙂");
    if (signup && password !== els.authConfirm.value) return fail("Passwords don't match 🙈");

    els.authSubmit.disabled = true;
    try {
      const { user } = await (signup ? authApi.signup : authApi.login)({ username, password });
      els.authForm.reset();
      if (signup) toast(`Welcome aboard, ${user.username}! 🎉`);
      enterApp(user);
    } catch (err) {
      fail(err.message);
    } finally {
      els.authSubmit.disabled = false;
    }
  });

  els.logout.addEventListener("click", async () => {
    try {
      await authApi.logout();
    } catch {
      // The cookie is cleared server-side on success; either way, return to the login screen.
    }
    setAuthMode("login");
    showAuth();
    toast("See you soon! 👋");
  });

  els.newQuote.addEventListener("click", () => {
    showQuote(randomQuoteIndex());
    mascotReact(els.appMascot, "cheer");
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

  function updateGreeting() {
    const now = new Date();
    $("#today").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const hour = now.getHours();
    const name = state.user ? `, ${state.user.username}` : "";
    $("#greeting").textContent =
      hour < 12 ? `Good morning${name} ☀️ Let's get things done.` :
      hour < 18 ? `Good afternoon${name} 🌤️ Keep the momentum going.` :
      `Good evening${name} 🌙 Wrap up the day strong.`;
  }

  els.progressBar.style.strokeDasharray = RING_LENGTH;
  authApi.me().then(({ user }) => enterApp(user), () => showAuth());
})();
