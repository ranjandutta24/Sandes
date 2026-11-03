/* Sandesh · Tasks + shared Notes (side panels in the chat)
 *
 * Tasks: a to-do list per chat. Tick things off, assign them to someone, or turn a message
 * into a task from its menu. Everyone in the chat sees changes live.
 *
 * Notes: one shared document per chat that everyone edits at the same time. Each change is
 * sent as "replace from..to with text"; the server shifts changes made at the same moment
 * over each other (operational transform) so everyone ends up with the same text.
 *
 * Uses globals from chat.js: `socket`, `activeId`, and window.sandesChat.
 */
(() => {
  "use strict";

  const chat = window.sandesChat;
  const { el, ic, iconBtn, toast, ask } = chat;
  const chatEl = document.getElementById("chat");
  const tools = document.getElementById("headTools");

  /* ---------- header buttons ---------- */
  const toolBtn = (icon, label) => {
    const b = el("button", { type: "button", className: "tool-btn", title: label });
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", "false");
    b.append(ic(icon), el("span", { className: "lbl" }, label));
    return b;
  };
  const tasksBtn = toolBtn("task", "Tasks");
  const tasksCount = el("span", { className: "tool-count", hidden: true });
  tasksBtn.append(tasksCount);
  const notesBtn = toolBtn("notes", "Notes");
  tools.prepend(tasksBtn, notesBtn);

  /* ---------- panel shell ---------- */
  const panel = el("aside", { className: "side-panel", hidden: true });
  panel.setAttribute("aria-label", "Chat tools");
  const title = el("h3", {});
  const headExtra = el("div", { className: "sp-extra" });
  const closeBtn = iconBtn("close", "Close", "ibtn", () => close());
  const body = el("div", { className: "sp-body" });
  panel.append(el("div", { className: "sp-head" }, title, headExtra, closeBtn), body);
  chatEl.append(panel);

  let open = null; // "tasks" | "notes" | null
  let conv = null; // conversation the panel shows

  function show(kind) {
    if (activeId == null) return;
    if (open && open !== kind) close();
    open = kind;
    conv = activeId;
    panel.hidden = false;
    panel.dataset.kind = kind;
    tasksBtn.setAttribute("aria-pressed", String(kind === "tasks"));
    notesBtn.setAttribute("aria-pressed", String(kind === "notes"));
    if (kind === "tasks") renderTasksShell();
    else openNotes();
  }

  function close() {
    if (!open) return;
    if (open === "notes") closeNotes();
    open = null;
    conv = null;
    panel.hidden = true;
    tasksBtn.setAttribute("aria-pressed", "false");
    notesBtn.setAttribute("aria-pressed", "false");
  }

  tasksBtn.onclick = () => (open === "tasks" ? close() : show("tasks"));
  notesBtn.onclick = () => (open === "notes" ? close() : show("notes"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open && panel.contains(document.activeElement) && !document.querySelector("dialog[open]")) close();
  });

  /* =====================================================================
   * Tasks
   * ===================================================================== */
  let tasks = [];
  let taskFilter = "open";
  let fromMessage = null; // message id the next task is made from
  const taskInput = el("input", { type: "text", maxLength: 500, placeholder: "Add a task…" });
  const assignSel = el("select", { title: "Assign to" });
  const listEl = el("div", { className: "task-list" });
  const filterEl = el("div", { className: "seg" });
  const fromNote = el("div", { className: "from-note", hidden: true });

  function setOpenTasks(n) {
    tasksCount.hidden = !n;
    tasksCount.textContent = n > 99 ? "99+" : String(n || "");
  }

  function fillAssignees() {
    const keep = assignSel.value;
    assignSel.replaceChildren(el("option", { value: "" }, "Anyone"),
      ...chat.members().map((m) => el("option", { value: m.id }, m.id === chat.me().id ? `${m.username} (me)` : m.username)));
    assignSel.value = keep;
  }

  function renderTasksShell() {
    title.textContent = "Tasks";
    headExtra.replaceChildren();
    fillAssignees();
    const form = el("form", { className: "task-add" }, taskInput, assignSel,
      el("button", { type: "submit", className: "pill-btn solid" }, "Add"));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const t = taskInput.value.trim();
      if (!t) return taskInput.focus();
      try {
        await ask("task:add", { conversationId: conv, title: t, assigneeId: Number(assignSel.value) || null, messageId: fromMessage });
        taskInput.value = "";
        fromMessage = null;
        fromNote.hidden = true;
        taskInput.focus();
      } catch (err) {
        toast(err.message, true);
      }
    };
    body.replaceChildren(form, fromNote, filterEl, listEl);
    form.hidden = !chat.canWrite();
    renderTasks();
    loadTasks();
  }

  async function loadTasks() {
    const id = conv;
    try {
      const res = await ask("tasks:list", { conversationId: id });
      if (conv !== id) return;
      tasks = res.tasks || [];
      renderTasks();
    } catch (err) {
      listEl.replaceChildren(el("p", { className: "hint" }, err.message));
    }
  }

  function renderTasks() {
    const openN = tasks.filter((t) => !t.done).length;
    const doneN = tasks.length - openN;
    setOpenTasks(openN);
    filterEl.replaceChildren(
      ...[["open", `To do · ${openN}`], ["done", `Done · ${doneN}`], ["mine", "Mine"]].map(([k, label]) => {
        const b = el("button", { type: "button", textContent: label, onclick: () => { taskFilter = k; renderTasks(); } });
        b.setAttribute("aria-pressed", String(taskFilter === k));
        return b;
      }),
    );
    const meId = chat.me().id;
    const shown = tasks.filter((t) =>
      taskFilter === "open" ? !t.done : taskFilter === "done" ? t.done : t.assignee_id === meId && !t.done);
    if (!shown.length) {
      listEl.replaceChildren(el("p", { className: "hint" },
        taskFilter === "done" ? "Nothing ticked off yet." : taskFilter === "mine" ? "Nothing assigned to you here." : "Nothing to do. Add a task above, or use “Add to tasks” on any message."));
      return;
    }
    listEl.replaceChildren(...shown.map(taskRow));
  }

  function taskRow(t) {
    const cb = el("input", { type: "checkbox", checked: t.done, disabled: !chat.canWrite() });
    cb.setAttribute("aria-label", t.done ? "Mark as not done" : "Mark as done");
    cb.onchange = () => ask("task:update", { id: t.id, done: cb.checked }).catch((e) => { cb.checked = !cb.checked; toast(e.message, true); });
    const titleEl = el("span", { className: "t-title" }, t.title);
    // double-click (or the pencil) to rename
    const rename = () => {
      if (!chat.canWrite()) return;
      const i = el("input", { type: "text", value: t.title, maxLength: 500, className: "t-edit" });
      titleEl.replaceWith(i);
      i.focus();
      i.select();
      const done = async (save) => {
        if (save && i.value.trim() && i.value.trim() !== t.title) {
          try { await ask("task:update", { id: t.id, title: i.value }); } catch (e) { toast(e.message, true); }
        }
        renderTasks();
      };
      i.onkeydown = (e) => { if (e.key === "Enter") done(true); else if (e.key === "Escape") { e.stopPropagation(); done(false); } };
      i.onblur = () => done(true);
    };
    titleEl.ondblclick = rename;

    const who = el("select", { className: "t-who", title: "Assigned to", disabled: !chat.canWrite() });
    who.append(el("option", { value: "" }, "Anyone"),
      ...chat.members().map((m) => el("option", { value: m.id, selected: m.id === t.assignee_id }, m.username)));
    if (t.assignee_id && !chat.members().some((m) => m.id === t.assignee_id)) {
      who.append(el("option", { value: t.assignee_id, selected: true }, t.assignee || "someone"));
    }
    who.onchange = () => ask("task:update", { id: t.id, assigneeId: Number(who.value) || null }).catch((e) => toast(e.message, true));

    const meta = el("span", { className: "t-meta" },
      t.done ? `Done by ${t.done_by_name || "someone"}` : `Added by ${t.created_by_name || "someone"}`,
      t.message_id ? el("button", { type: "button", className: "linkbtn", textContent: "See message", onclick: () => chat.jumpTo(t.message_id) }) : null);

    return el("div", { className: "task" + (t.done ? " done" : "") },
      el("label", { className: "t-check" }, cb),
      el("div", { className: "t-main" }, titleEl, el("div", { className: "t-row" }, who, meta)),
      el("div", { className: "t-acts" },
        chat.canWrite() ? iconBtn("edit", "Rename", "ibtn", rename) : null,
        chat.canWrite() ? iconBtn("trash", "Delete task", "ibtn", async () => {
          if (!(await sandesUI.confirm(`Delete the task “${t.title.length > 60 ? t.title.slice(0, 60) + "…" : t.title}”?`, { ok: "Delete", danger: true }))) return;
          ask("task:delete", { id: t.id }).catch((e) => toast(e.message, true));
        }) : null));
  }

  socket.on("tasks", ({ conversationId, tasks: list }) => {
    if (conversationId !== activeId) return;
    tasks = list;
    if (open === "tasks" && conv === conversationId) renderTasks();
    else setOpenTasks(list.filter((t) => !t.done).length);
  });

  /* =====================================================================
   * Notes (live shared text)
   * ===================================================================== */
  const ta = el("textarea", { className: "notes-text", spellcheck: true, placeholder: "Shared notes for this chat: agendas, decisions, links, the Wi-Fi password… Everyone here can edit, live." });
  const noteStatus = el("div", { className: "notes-status" });
  const editorsEl = el("div", { className: "editors" });
  let doc = null; // { conv, server, version, pending, writable }

  function transform(a, b, aIsLater) {
    // identical to noteTransform in features.js
    const bLen = b.text.length;
    if (b.from === b.to) {
      const q = b.from;
      const map = (p, isStart) => {
        if (p < q) return p;
        if (p > q) return p + bLen;
        if (a.from === a.to) return aIsLater ? p + bLen : p;
        return isStart ? p + bLen : p;
      };
      const from = map(a.from, true);
      return { from, to: Math.max(from, map(a.to, false)), text: a.text };
    }
    const sameRange = a.from === b.from && a.to === b.to;
    const insertAtEdge = a.from === a.to && (a.from === b.from || a.from === b.to);
    if (b.from <= a.from && a.to <= b.to && !insertAtEdge && !(sameRange && aIsLater)) {
      const p = b.from + bLen;
      return { from: p, to: p, text: "" };
    }
    const delta = bLen - (b.to - b.from);
    const map = (p, isStart) => (p <= b.from ? p : p >= b.to ? p + delta : isStart ? b.from + bLen : b.from);
    const from = map(a.from, true);
    return { from, to: Math.max(from, map(a.to, false)), text: a.text };
  }

  const applyOp = (t, o) => t.slice(0, o.from) + o.text + t.slice(o.to);

  function diff(a, b) {
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let e = 0;
    while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
    return { from: s, to: a.length - e, text: b.slice(s, b.length - e) };
  }

  const when = (iso) => {
    if (!iso) return "";
    const mins = Math.round((Date.now() - new Date(iso)) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  };

  function setStatus(text) { noteStatus.textContent = text; }

  function openNotes() {
    title.textContent = "Notes";
    headExtra.replaceChildren(editorsEl);
    body.replaceChildren(ta, noteStatus);
    ta.value = "";
    ta.disabled = true;
    setStatus("Opening…");
    const id = conv;
    socket.emit("notes:open", { conversationId: id }, (res) => {
      if (conv !== id || open !== "notes") return;
      if (!res || !res.ok) return setStatus((res && res.message) || "Couldn't open the notes.");
      doc = { conv: id, server: res.body, version: res.version, pending: null, writable: res.writable };
      ta.value = res.body;
      ta.disabled = false;
      ta.readOnly = !res.writable;
      setStatus(res.updated_by ? `Last edited by ${res.updated_by} ${when(res.updated_at)}` : res.writable ? "Nothing here yet. Start typing." : "Join the chat to edit these notes.");
      if (matchMedia("(pointer: fine)").matches) ta.focus();
    });
  }

  function closeNotes() {
    if (doc) flush(true);
    if (conv != null) socket.emit("notes:close", { conversationId: conv });
    doc = null;
    editorsEl.replaceChildren();
  }

  let flushTimer = 0;
  ta.addEventListener("input", () => {
    if (!doc || !doc.writable) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 120);
    setStatus("Saving…");
  });

  function flush() {
    if (!doc || doc.pending || ta.value === doc.server) return;
    const op = diff(doc.server, ta.value);
    const d = doc;
    d.pending = op;
    socket.emit("notes:op", { conversationId: d.conv, base: d.version, op }, (res) => {
      if (doc !== d) return;
      if (res && res.ok) {
        d.server = applyOp(d.server, d.pending);
        d.version = res.version;
        d.pending = null;
        if (ta.value !== d.server) flush();
        else setStatus("Saved");
        return;
      }
      d.pending = null;
      if (res && res.resync) {
        // fell too far behind: take the server's text, then re-apply what's on screen
        d.server = res.body;
        d.version = res.version;
        flush();
        return;
      }
      setStatus((res && res.message) || "Couldn't save that change. Keep typing to try again.");
    });
  }

  socket.on("notes:op", ({ conversationId, version, op, by }) => {
    if (!doc || conversationId !== doc.conv) return;
    if (version !== doc.version + 1) {
      // missed something (e.g. reconnect): reload the document
      return reopen();
    }
    const before = doc.server;
    const base = doc.pending ? applyOp(before, doc.pending) : before;
    const buffer = diff(base, ta.value);
    let o = op;
    if (doc.pending) o = transform(o, doc.pending, false);
    o = transform(o, buffer, false);
    if (doc.pending) doc.pending = transform(doc.pending, op, true);
    doc.server = applyOp(before, op);
    doc.version = version;
    // apply to the screen, keeping your cursor where it was
    const s = ta.selectionStart, e = ta.selectionEnd, focused = document.activeElement === ta;
    const delta = o.text.length - (o.to - o.from);
    const mapCaret = (p) => (p <= o.from ? p : p >= o.to ? p + delta : o.from + o.text.length);
    const top = ta.scrollTop;
    ta.value = applyOp(ta.value, o);
    if (focused) ta.setSelectionRange(mapCaret(s), mapCaret(e));
    ta.scrollTop = top;
    setStatus(`${by} is editing…`);
  });

  function reopen() {
    if (open !== "notes") return;
    const keep = ta.value;
    socket.emit("notes:open", { conversationId: conv }, (res) => {
      if (!res || !res.ok || open !== "notes") return;
      doc = { conv, server: res.body, version: res.version, pending: null, writable: res.writable };
      // keep anything typed that the server never got
      ta.value = keep;
      if (keep !== res.body) flush();
    });
  }

  socket.on("notes:editors", ({ conversationId, editors }) => {
    if (!doc || conversationId !== doc.conv) return;
    editorsEl.replaceChildren(...editors.slice(0, 5).map((n) => {
      const a = chat.userAvatar(n, null, "sm");
      a.title = n === chat.me().username ? `${n} (you)` : `${n} has the notes open`;
      return a;
    }));
  });

  socket.on("connect", () => { if (open === "notes" && doc) reopen(); });

  /* =====================================================================
   * Public
   * ===================================================================== */
  window.sandesPanels = {
    switchTo(id) {
      if (open && conv !== id) close();
      tasks = [];
      setOpenTasks(0);
      tasksBtn.hidden = notesBtn.hidden = id == null;
    },
    setOpenTasks,
    openTasks(focus) {
      if (open !== "tasks") show("tasks");
      if (focus) setTimeout(() => taskInput.focus(), 50);
    },
    openNotes() {
      if (open !== "notes") show("notes");
    },
    addTask(text, messageId) {
      if (open !== "tasks") show("tasks");
      taskInput.value = text.replace(/\s+/g, " ").trim().slice(0, 500);
      fromMessage = messageId || null;
      fromNote.hidden = !messageId;
      fromNote.textContent = "Made from a message. Edit it if you like, then Add.";
      setTimeout(() => { taskInput.focus(); taskInput.select(); }, 50);
    },
  };
  tasksBtn.hidden = notesBtn.hidden = true;
})();
