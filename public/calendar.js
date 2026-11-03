/* Sandesh · calendar
 *
 * A month calendar of events from every chat you're in, plus personal ones only you see.
 * Click a day to see its events, double-click (or "+") to add one. Events can repeat
 * (daily, weekly, monthly, yearly), have a reminder, and people can answer going / maybe / no.
 * Adding an event to a chat also posts a short note in that chat.
 *
 * Uses globals from chat.js: `socket`, `activeId`, `conversations`, `Notify`, and window.sandesChat.
 */
(() => {
  "use strict";

  const chat = window.sandesChat;
  const { el, ic, iconBtn, toast } = chat;
  const chatEl = document.getElementById("chat");
  const appEl = document.getElementById("app");

  const COLORS = [
    ["#2f5d8a", "Blue"], ["#b3303a", "Red"], ["#2e6b5a", "Green"], ["#c27a12", "Amber"],
    ["#7a3e6c", "Plum"], ["#1b2a47", "Ink"], ["#0f766e", "Teal"], ["#db2777", "Pink"],
  ];
  const REPEATS = [["none", "Doesn't repeat"], ["daily", "Every day"], ["weekly", "Every week"], ["monthly", "Every month"], ["yearly", "Every year"]];
  const REMINDERS = [["", "No reminder"], ["0", "At the start"], ["5", "5 minutes before"], ["10", "10 minutes before"], ["15", "15 minutes before"], ["30", "30 minutes before"], ["60", "1 hour before"], ["1440", "1 day before"]];
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const CAL_ICON = '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h2M14 14h2M8 17h2"/>';
  const calIcon = () => {
    const s = ic("plus");
    s.innerHTML = CAL_ICON;
    return s;
  };

  /* ---------- dates (all local, as "YYYY-MM-DD") ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const today = () => ymd(new Date());
  const fmtTime = (t) => {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };
  const fmtDay = (s, opts = { weekday: "long", day: "numeric", month: "long" }) => parse(s).toLocaleDateString(undefined, opts);
  const whenText = (ev, day) => {
    const multi = ev.end_date && ev.end_date !== ev.event_date;
    if (!ev.start_time) return multi ? `All day · ${fmtDay(ev.event_date, { day: "numeric", month: "short" })} – ${fmtDay(ev.end_date, { day: "numeric", month: "short" })}` : "All day";
    const t = ev.end_time ? `${fmtTime(ev.start_time)} – ${fmtTime(ev.end_time)}` : fmtTime(ev.start_time);
    return multi && day ? `${t} · until ${fmtDay(ev.end_date, { day: "numeric", month: "short" })}` : t;
  };
  const tint = (hex, k) => {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(c + (255 - c) * k);
    return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
  };

  /** Every day (in [from, to]) an event appears on, including repeats and multi-day spans */
  function occurrences(ev, from, to) {
    const span = ev.end_date ? Math.max(0, daysBetween(ev.event_date, ev.end_date)) : 0;
    const out = [];
    const pushSpan = (startStr) => {
      for (let i = 0; i <= span; i++) {
        const d = ymd(addDays(parse(startStr), i));
        if (d >= from && d <= to) out.push({ ev, date: d, start: startStr, first: i === 0 });
      }
    };
    if (ev.repeat === "none") { pushSpan(ev.event_date); return out; }
    const base = parse(ev.event_date);
    let guard = 0;
    for (let k = 0; guard < 5000; k++, guard++) {
      let d;
      if (ev.repeat === "daily") d = addDays(base, k);
      else if (ev.repeat === "weekly") d = addDays(base, k * 7);
      else if (ev.repeat === "monthly") {
        d = new Date(base.getFullYear(), base.getMonth() + k, base.getDate());
        if (d.getDate() !== base.getDate()) continue; // no 31st this month
      } else {
        d = new Date(base.getFullYear() + k, base.getMonth(), base.getDate());
        if (d.getMonth() !== base.getMonth()) continue; // 29 Feb in a normal year
      }
      const s = ymd(d);
      if (s > to) break;
      if (ymd(addDays(d, span)) >= from) pushSpan(s);
    }
    return out;
  }

  /* =====================================================================
   * DOM
   * ===================================================================== */
  // sidebar entry, under the search box
  const navBtn = el("button", { type: "button", className: "cal-nav", title: "Calendar" });
  const navDay = el("span", { className: "cal-nav-day" });
  const navCount = el("span", { className: "cal-nav-count", hidden: true });
  navBtn.append(navDay, el("span", { className: "cal-nav-txt" }, el("b", {}, "Calendar"), el("small", { className: "cal-nav-sub" }, "")), navCount);
  document.querySelector(".side-search").after(navBtn);

  // header button inside a chat
  const headBtn = el("button", { type: "button", className: "tool-btn", title: "Calendar for this chat" });
  headBtn.setAttribute("aria-label", "Calendar");
  headBtn.append(calIcon(), el("span", { className: "lbl" }, "Calendar"));
  const tools = document.getElementById("headTools");
  tools.insertBefore(headBtn, tools.querySelector(".board-btn"));
  headBtn.hidden = true;

  const view = el("section", { className: "cal", hidden: true });
  view.setAttribute("aria-label", "Calendar");
  const monthTitle = el("h2", { className: "cal-month" });
  const filterSel = el("select", { className: "cal-filter", title: "Show events from" });
  const newBtn = el("button", { type: "button", className: "pill-btn solid cal-new" }, ic("plus"), "New event");
  const grid = el("div", { className: "cal-grid" });
  const side = el("aside", { className: "cal-side" });
  view.append(
    el("header", { className: "cal-head" },
      el("button", { type: "button", className: "cal-back", title: "Back", onclick: () => close() }, ic("down")),
      el("div", { className: "cal-title" }, monthTitle),
      el("div", { className: "cal-navs" },
        iconBtn("down", "Previous month", "ibtn cal-prev", () => shiftMonth(-1)),
        el("button", { type: "button", className: "pill-btn cal-today", textContent: "Today", onclick: () => { cursor = startOfMonth(new Date()); selected = today(); render(); } }),
        iconBtn("down", "Next month", "ibtn cal-next", () => shiftMonth(1))),
      el("span", { className: "cal-spacer" }),
      filterSel,
      newBtn,
      iconBtn("close", "Close the calendar", "ibtn cal-x", () => close())),
    el("div", { className: "cal-body" },
      el("div", { className: "cal-main" }, el("div", { className: "cal-week" }, WEEKDAYS.map((d, i) => el("span", { className: i >= 5 ? "we" : "" }, d))), grid),
      side),
  );
  chatEl.append(view);

  /* =====================================================================
   * State
   * ===================================================================== */
  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  let cursor = startOfMonth(new Date());
  let selected = today();
  let filter = "all";         // "all" | "me" | conversation id
  let events = [];            // loaded for the visible range
  let range = null;           // [from, to] of what's loaded
  let isOpen = false;
  let wasInChat = false;
  let upcoming = [];          // next 14 days, for the sidebar badge + reminders

  const gridRange = () => {
    const first = cursor;
    const lead = (first.getDay() + 6) % 7; // Monday first
    const start = addDays(first, -lead);
    return [ymd(start), ymd(addDays(start, 41))];
  };

  const visible = (ev) => filter === "all" || (filter === "me" ? !ev.conversation_id : ev.conversation_id === Number(filter));

  function dayMap(list, from, to) {
    const map = new Map();
    for (const ev of list) {
      if (!visible(ev)) continue;
      for (const o of occurrences(ev, from, to)) {
        if (!map.has(o.date)) map.set(o.date, []);
        map.get(o.date).push(o);
      }
    }
    for (const arr of map.values()) arr.sort((a, b) => (a.ev.start_time || "").localeCompare(b.ev.start_time || "") || a.ev.title.localeCompare(b.ev.title));
    return map;
  }

  async function load() {
    const [from, to] = gridRange();
    try {
      events = await chat.api("GET", `/api/events?from=${from}&to=${to}`);
      range = [from, to];
    } catch (e) {
      toast(e.message, true);
    }
    render();
  }

  async function loadUpcoming() {
    const from = today(), to = ymd(addDays(new Date(), 14));
    try {
      upcoming = await chat.api("GET", `/api/events?from=${from}&to=${to}`);
    } catch { upcoming = []; }
    syncNav();
  }

  function syncNav() {
    const t = today();
    navDay.replaceChildren(el("small", {}, new Date().toLocaleDateString(undefined, { month: "short" })), el("b", {}, String(new Date().getDate())));
    const todays = upcoming.flatMap((ev) => occurrences(ev, t, t));
    navCount.hidden = !todays.length;
    navCount.textContent = String(todays.length);
    const next = upcoming.flatMap((ev) => occurrences(ev, t, ymd(addDays(new Date(), 14))))
      .filter((o) => o.date > t || !o.ev.start_time || o.ev.start_time >= new Date().toTimeString().slice(0, 5))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.ev.start_time || "").localeCompare(b.ev.start_time || ""))[0];
    navBtn.querySelector(".cal-nav-sub").textContent = next
      ? `${next.date === t ? "Today" : fmtDay(next.date, { weekday: "short", day: "numeric", month: "short" })}${next.ev.start_time ? " " + fmtTime(next.ev.start_time) : ""} · ${next.ev.title}`
      : "Nothing coming up";
    navBtn.setAttribute("aria-pressed", String(isOpen));
  }

  /* =====================================================================
   * Rendering
   * ===================================================================== */
  function fillFilter() {
    const keep = filter;
    filterSel.replaceChildren(
      el("option", { value: "all" }, "All my calendars"),
      el("option", { value: "me" }, "Only me (personal)"),
      ...conversations.map((c) => el("option", { value: String(c.id) }, c.type === "direct" ? `With ${c.name}` : c.name)),
    );
    filterSel.value = [...filterSel.options].some((o) => o.value === String(keep)) ? String(keep) : "all";
    filter = filterSel.value;
  }
  filterSel.onchange = () => { filter = filterSel.value; render(); };

  function chip(o) {
    const ev = o.ev;
    const b = el("button", {
      type: "button", className: "cal-chip" + (ev.start_time ? "" : " allday"),
      title: `${ev.title} · ${whenText(ev, o.date)}${ev.conversation_name ? " · " + ev.conversation_name : ""}`,
      onclick: (e) => { e.stopPropagation(); openEvent(ev, o.date); },
    },
      ev.start_time && o.first ? el("span", { className: "t" }, fmtTime(ev.start_time).replace(/\s?([AP]M)/i, (m, x) => x[0].toLowerCase())) : null,
      el("span", { className: "n" }, ev.title));
    b.style.setProperty("--ec", ev.color);
    b.style.setProperty("--eb", tint(ev.color, 0.84));
    return b;
  }

  function render() {
    if (!isOpen) return;
    const [from, to] = gridRange();
    if (!range || range[0] !== from || range[1] !== to) return load();
    monthTitle.replaceChildren(
      el("span", { className: "m" }, cursor.toLocaleDateString(undefined, { month: "long" })),
      el("span", { className: "y" }, String(cursor.getFullYear())));
    const map = dayMap(events, from, to);
    const t = today();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(parse(from), i);
      const s = ymd(d);
      const list = map.get(s) || [];
      const cell = el("div", {
        className: "cal-day" + (d.getMonth() !== cursor.getMonth() ? " out" : "") + (s === t ? " today" : "") + (s === selected ? " sel" : "") + (i % 7 >= 5 ? " we" : ""),
        tabIndex: s === selected ? 0 : -1,
        onclick: () => { selected = s; render(); },
        ondblclick: () => openEditor(null, s),
        onkeydown: (e) => {
          const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
          if (moves[e.key]) {
            e.preventDefault();
            selected = ymd(addDays(parse(s), moves[e.key]));
            const sd = parse(selected);
            if (sd.getMonth() !== cursor.getMonth()) cursor = startOfMonth(sd);
            render();
            grid.querySelector(".cal-day.sel")?.focus();
          } else if (e.key === "Enter") openEditor(null, s);
        },
      });
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", `${fmtDay(s)}${list.length ? `, ${list.length} ${list.length === 1 ? "event" : "events"}` : ""}`);
      const add = el("button", { type: "button", className: "cal-add", title: `Add an event on ${fmtDay(s, { day: "numeric", month: "short" })}`, onclick: (e) => { e.stopPropagation(); openEditor(null, s); } }, ic("plus"));
      cell.append(el("div", { className: "cal-dhead" }, el("span", { className: "cal-num" }, String(d.getDate())), add));
      const shown = list.slice(0, 3);
      const chips = el("div", { className: "cal-chips" }, shown.map(chip));
      if (list.length > shown.length) chips.append(el("span", { className: "cal-more" }, `+${list.length - shown.length} more`));
      // dots for small screens
      const dots = el("div", { className: "cal-dots" }, list.slice(0, 4).map((o) => { const x = el("i", {}); x.style.background = o.ev.color; return x; }));
      cell.append(chips, dots);
      cells.push(cell);
    }
    grid.replaceChildren(...cells);
    renderSide(map);
    syncNav();
  }

  function eventCard(o, showDate = false) {
    const ev = o.ev;
    const mine = ev.created_by === chat.me().id;
    const going = (ev.rsvps || []).filter((r) => r.status === "yes").length;
    const card = el("button", { type: "button", className: "cal-card", onclick: () => openEvent(ev, o.date) },
      el("span", { className: "cal-card-bar" }),
      el("span", { className: "cal-card-b" },
        el("span", { className: "cal-card-when" }, showDate ? `${o.date === today() ? "Today" : fmtDay(o.date, { weekday: "short", day: "numeric", month: "short" })} · ${whenText(ev, o.date)}` : whenText(ev, o.date)),
        el("b", {}, ev.title),
        el("span", { className: "cal-card-meta" },
          ev.conversation_id ? el("span", { className: "tag" }, ev.conversation_type === "direct" ? `With ${ev.conversation_name}` : ev.conversation_name) : el("span", { className: "tag me" }, "Only me"),
          ev.repeat !== "none" ? el("span", {}, "↻ " + REPEATS.find((r) => r[0] === ev.repeat)[1].toLowerCase()) : null,
          ev.location ? el("span", {}, "📍 " + ev.location) : null,
          going ? el("span", {}, `${going} going`) : null,
          !mine && ev.created_by_name ? el("span", {}, `by ${ev.created_by_name}`) : null)));
    card.style.setProperty("--ec", ev.color);
    return card;
  }

  function renderSide(map) {
    const list = map.get(selected) || [];
    const t = today();
    const upcomingList = [];
    const from = t, to = ymd(addDays(new Date(), 30));
    for (const ev of events.concat(upcoming.filter((u) => !events.some((e) => e.id === u.id)))) {
      if (!visible(ev)) continue;
      for (const o of occurrences(ev, from, to)) if (o.first || o.date === from) upcomingList.push(o);
    }
    upcomingList.sort((a, b) => a.date.localeCompare(b.date) || (a.ev.start_time || "").localeCompare(b.ev.start_time || ""));
    const seen = new Set();
    const next = upcomingList.filter((o) => {
      const k = o.ev.id + o.date;
      if (seen.has(k)) return false;
      seen.add(k);
      return !(o.date === t && o.ev.start_time && (o.ev.end_time || o.ev.start_time) < new Date().toTimeString().slice(0, 5));
    }).slice(0, 8);

    side.replaceChildren(
      el("div", { className: "cal-side-day" },
        el("div", { className: "cal-side-date" },
          el("span", { className: "big" }, String(parse(selected).getDate())),
          el("span", {}, el("b", {}, parse(selected).toLocaleDateString(undefined, { weekday: "long" })), el("small", {}, parse(selected).toLocaleDateString(undefined, { month: "long", year: "numeric" })))),
        iconBtn("plus", "Add an event on this day", "ibtn", () => openEditor(null, selected))),
      list.length
        ? el("div", { className: "cal-list" }, list.map((o) => eventCard(o)))
        : el("button", { type: "button", className: "cal-empty", onclick: () => openEditor(null, selected) }, selected === t ? "Nothing today. " : "Nothing on this day. ", el("u", {}, "Add an event")),
      el("h3", { className: "cal-up" }, "Coming up"),
      next.length ? el("div", { className: "cal-list" }, next.map((o) => eventCard(o, true))) : el("p", { className: "hint" }, "Nothing in the next 30 days."),
    );
  }

  function shiftMonth(n) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);
    render();
  }

  /* =====================================================================
   * Event details + editor
   * ===================================================================== */
  function modal(title, body) {
    const d = el("dialog", { className: "mdl cal-mdl" });
    d.append(el("div", { className: "dlg-head" }, el("h2", {}, title), iconBtn("close", "Close", "x", () => d.close())), el("div", { className: "mdl-body" }, body));
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    d.addEventListener("close", () => d.remove());
    document.body.append(d);
    d.showModal();
    return d;
  }

  function canEdit(ev) {
    const me = chat.me();
    return ev.created_by === me.id || me.role === "admin";
  }

  function openEvent(ev, date) {
    const me = chat.me();
    const mineRsvp = (ev.rsvps || []).find((r) => r.user_id === me.id);
    const body = el("div", { className: "cal-detail" });
    body.style.setProperty("--ec", ev.color);
    const d = modal("Event", body);
    const rsvpRow = el("div", { className: "rsvp" });
    const renderRsvp = (e) => {
      const counts = { yes: [], maybe: [], no: [] };
      for (const r of e.rsvps || []) counts[r.status]?.push(chat.nameOf(r.user_id));
      const mine = (e.rsvps || []).find((r) => r.user_id === me.id);
      rsvpRow.replaceChildren(
        el("span", { className: "fl" }, "Going?"),
        ...[["yes", "Going"], ["maybe", "Maybe"], ["no", "Can't go"]].map(([k, label]) => {
          const b = el("button", {
            type: "button", className: "rsvp-btn" + (mine && mine.status === k ? " on " + k : ""),
            title: counts[k].length ? counts[k].join(", ") : "",
            onclick: async () => {
              try {
                const next = await chat.api("POST", `/api/events/${e.id}/rsvp`, { status: mine && mine.status === k ? "none" : k });
                renderRsvp(next);
              } catch (err) { toast(err.message, true); }
            },
          }, label, counts[k].length ? el("small", {}, String(counts[k].length)) : null);
          return b;
        }));
    };
    body.append(
      el("div", { className: "cal-detail-head" },
        el("span", { className: "dot" }),
        el("div", {},
          el("h3", {}, ev.title),
          el("p", {}, `${fmtDay(date || ev.event_date)} · ${whenText(ev, date)}`),
          ev.repeat !== "none" ? el("p", { className: "fh" }, `Repeats ${REPEATS.find((r) => r[0] === ev.repeat)[1].toLowerCase()}`) : null)),
      el("div", { className: "cal-detail-rows" },
        el("div", {}, ic(ev.conversation_id ? "users" : "lock"), ev.conversation_id ? (ev.conversation_type === "direct" ? `Shared with ${ev.conversation_name}` : `Shared in ${ev.conversation_name}`) : "Only you can see this"),
        ev.location ? el("div", {}, ic("pin"), ev.location) : null,
        ev.remind_minutes != null ? el("div", {}, ic("bell"), REMINDERS.find((r) => r[0] === String(ev.remind_minutes))?.[1] || `${ev.remind_minutes} minutes before`) : null,
        ev.description ? el("div", { className: "desc" }, ic("notes"), ev.description) : null,
        el("div", { className: "fh" }, `Added by ${ev.created_by === me.id ? "you" : ev.created_by_name || "someone"}`)),
      ev.conversation_id ? rsvpRow : null,
      el("div", { className: "dlg-foot" },
        ev.conversation_id ? el("button", {
          type: "button", className: "pill-btn", textContent: "Open chat",
          onclick: () => { d.close(); close(); window.openConversation?.(ev.conversation_id); },
        }) : null,
        canEdit(ev) ? el("button", {
          type: "button", className: "pill-btn danger", onclick: async () => {
            const ok = await sandesUI.confirm(`Delete “${ev.title}”?`, {
              ok: "Delete event", danger: true,
              sub: ev.repeat !== "none" ? "This removes every repeat of it." : ev.conversation_id ? "It goes from everyone's calendar." : null,
            });
            if (!ok) return;
            try { await chat.api("DELETE", `/api/events/${ev.id}`); d.close(); toast("Event deleted"); }
            catch (err) { toast(err.message, true); }
          },
        }, ic("trash"), "Delete") : null,
        canEdit(ev) ? el("button", { type: "button", className: "pill-btn solid", textContent: "Edit", onclick: () => { d.close(); openEditor(ev); } }) : null));
    if (ev.conversation_id) renderRsvp(ev);
    void mineRsvp;
  }

  function openEditor(ev, date) {
    const editing = !!ev;
    const e0 = ev || {
      title: "", event_date: date || selected || today(), end_date: null, start_time: "10:00", end_time: "11:00",
      repeat: "none", color: COLORS[0][0], remind_minutes: 10, location: "", description: "",
      conversation_id: filter !== "all" && filter !== "me" ? Number(filter) : (isOpen ? null : activeId),
    };
    const title = el("input", { type: "text", maxLength: 200, value: e0.title, placeholder: "Sprint review, Lunch, Rahul's birthday…", required: true });
    const day = el("input", { type: "date", value: e0.event_date, required: true });
    const endDay = el("input", { type: "date", value: e0.end_date || "" });
    const allDay = el("input", { type: "checkbox", checked: !e0.start_time });
    const start = el("input", { type: "time", value: e0.start_time || "10:00" });
    const end = el("input", { type: "time", value: e0.end_time || "" });
    const where = el("select", { disabled: editing });
    where.append(el("option", { value: "" }, "🔒 Only me (personal)"),
      ...conversations.map((c) => el("option", { value: String(c.id), selected: e0.conversation_id === c.id }, c.type === "direct" ? `👤 With ${c.name}` : `👥 ${c.name}`)));
    if (!e0.conversation_id) where.value = "";
    const repeat = el("select", {}, REPEATS.map(([v, l]) => el("option", { value: v, selected: e0.repeat === v }, l)));
    const remind = el("select", {}, REMINDERS.map(([v, l]) => el("option", { value: v, selected: String(e0.remind_minutes ?? "") === v }, l)));
    const loc = el("input", { type: "text", maxLength: 200, value: e0.location || "", placeholder: "Conference room, Google Meet link…" });
    const desc = el("textarea", { rows: 3, maxLength: 4000, value: e0.description || "", placeholder: "Agenda, notes (optional)" });
    let color = e0.color;
    const swatches = el("div", { className: "cal-swatches" }, COLORS.map(([c, n]) => {
      const b = el("button", { type: "button", className: "cal-sw" + (c === color ? " on" : ""), title: n, onclick: () => { color = c; swatches.querySelectorAll(".cal-sw").forEach((x) => x.classList.toggle("on", x === b)); } });
      b.style.setProperty("--sw", c);
      b.setAttribute("aria-label", n);
      return b;
    }));
    const timeRow = el("div", { className: "cal-row" }, el("label", { className: "fld" }, el("span", { className: "fl" }, "Starts"), start), el("label", { className: "fld" }, el("span", { className: "fl" }, "Ends"), end));
    // moving the start keeps the length of the event (and never leaves the end before the start)
    const mins = (t) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + m; };
    const hhmm = (v) => `${pad(Math.floor(v / 60) % 24)}:${pad(v % 60)}`;
    let length = e0.start_time && e0.end_time ? Math.max(15, mins(e0.end_time) - mins(e0.start_time)) : 60;
    start.addEventListener("change", () => {
      if (!start.value) return;
      const s0 = mins(start.value);
      if (!end.value || !endDay.value || endDay.value === day.value) end.value = hhmm(Math.min(s0 + length, 23 * 60 + 59));
    });
    end.addEventListener("change", () => { if (start.value && end.value && mins(end.value) > mins(start.value)) length = mins(end.value) - mins(start.value); });
    const syncAllDay = () => { timeRow.hidden = allDay.checked; };
    allDay.onchange = syncAllDay;
    syncAllDay();
    const err = el("p", { className: "err" });
    const lbl = (text, control, hint) => el("label", { className: "fld" }, el("span", { className: "fl" }, text), control, hint ? el("span", { className: "fh" }, hint) : null);

    const form = el("form", { className: "mform cal-form" },
      lbl("Title", title),
      el("div", { className: "cal-row" }, lbl("Date", day), lbl("Ends on", endDay, "For events over several days")),
      el("label", { className: "chk" }, allDay, "All day"),
      timeRow,
      el("div", { className: "cal-row" }, lbl("Repeat", repeat), lbl("Reminder", remind)),
      lbl("Calendar", where, editing ? "Events can't be moved to another chat." : "Shared events show for everyone in that chat, with a note in the chat."),
      lbl("Place", loc),
      lbl("Notes", desc),
      el("div", { className: "fld" }, el("span", { className: "fl" }, "Colour"), swatches),
      err,
      el("div", { className: "dlg-foot" }, el("button", { type: "submit", className: "pill-btn solid" }, editing ? "Save changes" : "Add to calendar")));
    const d = modal(editing ? "Edit event" : "New event", form);
    title.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      err.textContent = "";
      const body = {
        title: title.value, event_date: day.value, end_date: endDay.value || null,
        start_time: allDay.checked ? null : start.value || null, end_time: allDay.checked ? null : end.value || null,
        repeat: repeat.value, remind_minutes: remind.value === "" ? null : Number(remind.value),
        color, location: loc.value, description: desc.value,
      };
      if (!editing) body.conversation_id = where.value ? Number(where.value) : null;
      try {
        const saved = await chat.api(editing ? "PATCH" : "POST", editing ? `/api/events/${ev.id}` : "/api/events", body);
        d.close();
        selected = saved.event_date;
        cursor = startOfMonth(parse(saved.event_date));
        toast(editing ? "Event updated" : `Added “${saved.title}” on ${fmtDay(saved.event_date, { weekday: "short", day: "numeric", month: "short" })}`);
        refresh();
      } catch (ex) {
        err.textContent = ex.message;
      }
    };
  }

  /* =====================================================================
   * Open / close
   * ===================================================================== */
  function open({ conversation = null, date = null } = {}) {
    isOpen = true;
    wasInChat = appEl.classList.contains("in-chat");
    appEl.classList.add("in-chat");
    view.hidden = false;
    chatEl.classList.add("cal-open");
    fillFilter();
    if (conversation) { filter = String(conversation); filterSel.value = filter; }
    if (date) { selected = date; cursor = startOfMonth(parse(date)); }
    range = null;
    render();
    syncNav();
    setTimeout(() => grid.querySelector(".cal-day.sel")?.focus({ preventScroll: true }), 50);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    view.hidden = true;
    chatEl.classList.remove("cal-open");
    if (!wasInChat && activeId == null) appEl.classList.remove("in-chat");
    syncNav();
  }

  function refresh() {
    range = null;
    if (isOpen) load();
    loadUpcoming();
  }

  navBtn.onclick = () => (isOpen ? close() : open());
  headBtn.onclick = () => open({ conversation: activeId });
  newBtn.onclick = () => openEditor(null, selected);
  view.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.querySelector("dialog[open]")) { e.preventDefault(); close(); }
  });
  socket.on("events:changed", refresh);
  socket.on("connect", () => { if (chat.me()) refresh(); });

  /* =====================================================================
   * Reminders (checked every 20 s while Sandesh is open)
   * ===================================================================== */
  const remindedKey = "sandesh.reminded";
  const reminded = new Set(JSON.parse(localStorage.getItem(remindedKey) || "[]"));
  function checkReminders() {
    const now = new Date();
    const t = today();
    for (const ev of upcoming) {
      if (ev.remind_minutes == null) continue;
      for (const o of occurrences(ev, t, t)) {
        if (!o.first) continue;
        const [h, m] = (ev.start_time || "09:00").split(":").map(Number);
        const startsAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
        const at = new Date(startsAt - (ev.start_time ? ev.remind_minutes : 0) * 60000);
        const key = `${ev.id}:${o.date}`;
        if (reminded.has(key) || now < at || now - startsAt > 15 * 60000) continue;
        reminded.add(key);
        localStorage.setItem(remindedKey, JSON.stringify([...reminded].slice(-200)));
        const mins = Math.round((startsAt - now) / 60000);
        const when = !ev.start_time ? "today" : mins <= 0 ? "now" : `in ${mins} min`;
        toast(`📅 ${ev.title} starts ${when}${ev.location ? " · " + ev.location : ""}`);
        try {
          if (typeof Notify !== "undefined") {
            Notify.ding();
            if (document.hidden || !document.hasFocus()) Notify.popup(`📅 ${ev.title}`, `Starts ${when}${ev.location ? " · " + ev.location : ""}`, ev.conversation_id || activeId);
          }
        } catch {}
      }
    }
  }
  setInterval(checkReminders, 20000);
  setInterval(() => { syncNav(); if (today() !== navDay.dataset.d) { navDay.dataset.d = today(); loadUpcoming(); } }, 60000);

  window.sandesCalendar = {
    open, close, refresh,
    newEvent: (conversationId) => openEditor(null, today()) || null,
    switchTo(id) { headBtn.hidden = id == null; },
    start() { navDay.dataset.d = today(); loadUpcoming().then(checkReminders); },
  };
  syncNav();
})();
