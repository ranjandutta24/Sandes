/* Sandesh · chat client
 *
 * Sidebar (groups, channels, direct chats, search), the message feed (replies, edits,
 * deletes, reactions, polls, read receipts, mentions), the composer, presence + typing,
 * pins, group management and notifications.
 *
 * Other scripts use these globals: `socket`, `activeId`, `me`, `conversations`, `inkFor`,
 * and window.sandesChat (see the end of this file).
 */
"use strict";

const MAX_FILES = 20; // no size limit (LAN)
const PAGE = 200;     // messages per page (matches the server)
const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "🎉", "👏", "✅"];
const EFFECTS = [
  ["confetti", "Confetti", "🎊"],
  ["rangoli", "Rangoli", "🪷"],
  ["hearts", "Hearts", "💗"],
  ["petals", "Marigold petals", "🌼"],
];

const $ = (id) => document.getElementById(id);
const appEl = $("app"), chatEl = $("chat"), feed = $("feed"), list = $("messages");
const input = $("msg"), sendBtn = $("send"), statusEl = $("status");
const fileInput = $("fileInput"), pendingEl = $("pending");

/* =====================================================================
 * Small helpers
 * ===================================================================== */
const inks = ["#2f5d8a", "#7a3e6c", "#2e6b5a", "#8a5a1f", "#4b4f9c", "#9a3b3b", "#3d6e7e", "#6b5b2e"];
const inkFor = (name = "") => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return inks[h % inks.length];
};

const fmtSize = (b) =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => k != null && k !== false && n.append(k));
  return n;
};

const SVGNS = "http://www.w3.org/2000/svg";
const ICONS = {
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>',
  reply: '<path d="M10 8 5 12.5 10 17"/><path d="M5 12.5h9a5 5 0 0 1 5 5V19"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="m6 7 1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  pin: '<path d="M9 4h6l-1 6 4 3v2H6v-2l4-3z"/><path d="M12 15v6"/>',
  task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  poll: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  sparkle: '<path d="M12 3c.7 4.2 1.8 5.3 6 6-4.2.7-5.3 1.8-6 6-.7-4.2-1.8-5.3-6-6 4.2-.7 5.3-1.8 6-6z"/><path d="M19 15c.3 1.7.8 2.2 2.5 2.5-1.7.3-2.2.8-2.5 2.5-.3-1.7-.8-2.2-2.5-2.5 1.7-.3 2.2-.8 2.5-2.5z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
  hash: '<path d="M5 9h15M4 15h15M10 4 8 20M16 4l-2 16"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  attach: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  board: '<rect x="3" y="3.5" width="18" height="13" rx="2"/><path d="M8 21h8M12 16.5V21"/><path d="m7 12.5 3-3 2.5 2 4-4"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
  door: '<path d="M14 4h5v16h-5"/><path d="M10 8 6 12l4 4M6 12h10"/>',
  crown: '<path d="m4 8 4 4 4-7 4 7 4-4-2 11H6z"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>',
};

function ic(name) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.9");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONS[name] || "";
  return s;
}

const iconBtn = (name, label, cls = "ibtn", onclick) => {
  const b = el("button", { type: "button", className: cls, title: label, onclick });
  b.setAttribute("aria-label", label);
  b.append(ic(name));
  return b;
};

const svgUse = (id, cls) => {
  const s = document.createElementNS(SVGNS, "svg");
  if (cls) s.setAttribute("class", cls);
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("fill", "currentColor");
  const u = document.createElementNS(SVGNS, "use");
  u.setAttribute("href", "#" + id);
  s.append(u);
  return s;
};

// Initials on the person's colour, with their picture on top if they have one
const userAvatar = (name, image, cls = "") => {
  const a = el("div", { className: ("avatar " + cls).trim() }, (name || "?")[0].toUpperCase());
  a.style.background = inkFor(name);
  if (image) {
    const img = el("img", { src: image, alt: "" });
    img.onerror = () => img.remove();
    a.append(img);
  }
  return a;
};

// Avatar with a green "online" dot that follows presence updates
const withDot = (avatar, userId) => {
  const dot = el("span", { className: "dot" + (isOnline(userId) ? " on" : "") });
  dot.dataset.presence = userId;
  return el("span", { className: "avw" }, avatar, dot);
};

const avatarFor = (c, cls = "") => {
  if (c.type === "direct") return withDot(userAvatar(c.name, c.image, cls), c.other_user_id);
  if (c.slug === "main" && !c.image) return el("div", { className: ("avatar room " + cls).trim() }, svgUse("dove"));
  const a = userAvatar(c.name, c.image, ("group " + cls).trim());
  if (!c.image) a.replaceChildren(c.is_public ? "#" : (c.name || "?")[0].toUpperCase());
  return a;
};

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const clock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const shortTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? clock(iso)
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

const dayLabel = (d) => {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === new Date().toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};

function lastSeenText(iso) {
  if (!iso) return "Offline";
  const d = new Date(iso), mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return "Last seen just now";
  if (mins < 60) return `Last seen ${mins} min ago`;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === new Date().toDateString()) return `Last seen today at ${clock(iso)}`;
  if (d.toDateString() === y.toDateString()) return `Last seen yesterday at ${clock(iso)}`;
  return `Last seen ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  if (r.status === 401) location.href = "/login";
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data.message || "Something went wrong. Try again.");
  return data;
}

// Socket call with an answer; rejects with the server's message
const ask = (event, data) =>
  new Promise((resolve, reject) =>
    socket.timeout(15000).emit(event, data, (err, res) => {
      if (err) return reject(new Error("The server didn't answer. Check the connection."));
      if (res && res.ok === false) return reject(new Error(res.message || "That didn't work. Try again."));
      resolve(res || {});
    }),
  );

// Copy that also works on plain http (the clipboard API needs https)
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const t = el("textarea", { value: text });
  t.style.cssText = "position:fixed;opacity:0";
  document.body.append(t);
  t.select();
  document.execCommand("copy");
  t.remove();
  return Promise.resolve();
}

let toastTimer = 0;
function toast(msg, bad = false) {
  if (window.sandesUI) return window.sandesUI.toast(msg, bad ? { bad: true } : {});
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("bad", bad);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3000);
}

/* =====================================================================
 * State
 * ===================================================================== */
let me = null;
let settings = {};
let conversations = [];
let activeId = null;
const directory = new Map(); // user id -> { id, username, image, online, last_seen, status }
const blankState = () => ({ reads: new Map(), pins: [], members: [], open_tasks: 0, can_manage: false, member: true });
let state = blankState();     // extra info about the open chat
let loaded = [];              // messages of the open chat, oldest first
const byId = new Map();       // message id -> message
const rows = new Map();       // message id -> row element
let hasOlder = false, loadingOlder = false;
let unreadMarker = null;      // first unread message id when the chat was opened
let replyTo = null, editingId = null, pendingEffect = null;
let pendingFiles = [];
const typingIn = new Map();   // conversation id -> Map(user id -> { name, until })
const lastReadSent = new Map();
const notified = new Set();
let pinIndex = 0;

const conv = (id) => conversations.find((c) => c.id === id);
const activeConv = () => conv(activeId);
const isOnline = (id) => !!(directory.get(id) && directory.get(id).online);
const nameOf = (id) => (directory.get(id) && directory.get(id).username) || "Someone";

/* =====================================================================
 * Sidebar
 * ===================================================================== */
function typingNames(id) {
  const m = typingIn.get(id);
  if (!m) return [];
  const t = Date.now();
  return [...m.values()].filter((x) => x.until > t).map((x) => x.name);
}

function typingText(id, short = false) {
  const n = typingNames(id);
  if (!n.length) return "";
  const c = conv(id);
  if (short && c && c.type === "direct") return "typing…";
  if (n.length === 1) return `${n[0]} is typing…`;
  if (n.length === 2) return `${n[0]} and ${n[1]} are typing…`;
  return "Several people are typing…";
}

function previewFor(c) {
  if (c.last_deleted) return "Message deleted";
  const who = c.last_sender && c.last_kind !== "system"
    ? (me && c.last_sender === me.username ? "You: " : c.type === "room" ? `${c.last_sender}: ` : "")
    : "";
  if (c.last_kind === "poll") return `${who}📊 ${c.last_message || "Poll"}`;
  if (c.last_message) return who + c.last_message;
  if (c.last_has_attachments) return `${who}📎 Attachment`;
  return c.type === "direct" ? "Say hello" : "No messages yet";
}

function sortConversations() {
  const t = (c) => new Date(c.last_activity).getTime();
  conversations.sort((a, b) => (a.slug === "main" ? -1 : b.slug === "main" ? 1 : t(b) - t(a)));
}

function renderSidebar() {
  const rooms = $("rooms"), directs = $("directs");
  rooms.replaceChildren();
  directs.replaceChildren();
  sortConversations();
  for (const c of conversations) {
    const typing = typingText(c.id, true);
    const badge = c.unread || c.mentioned
      ? el("span", { className: "badge" + (c.mentioned ? " at" : "") }, c.mentioned ? (c.unread ? `@ ${c.unread}` : "@") : String(c.unread > 99 ? "99+" : c.unread))
      : null;
    if (badge) badge.setAttribute("aria-label", `${c.unread} unread${c.mentioned ? ", you were mentioned" : ""}`);
    const btn = el(
      "button",
      { className: "convo" + (c.unread ? " unread" : ""), type: "button", onclick: () => openConversation(c.id) },
      avatarFor(c),
      el("span", { className: "meta" },
        el("span", { className: "name" },
          c.type === "room" && c.slug !== "main" ? el("span", { className: "kind" }, ic(c.is_public ? "hash" : "lock")) : null,
          c.name),
        el("span", { className: "preview" + (typing ? " typing" : "") }, typing || previewFor(c))),
      el("span", { className: "side" }, el("span", { className: "when" }, shortTime(c.last_activity)), badge),
    );
    if (c.id === activeId) btn.setAttribute("aria-current", "true");
    (c.type === "room" ? rooms : directs).append(btn);
  }
  if (!directs.children.length) {
    directs.append(el("p", { className: "hint" }, "Private chats appear here. Use New to message someone."));
  }
  const total = conversations.reduce((n, c) => n + (c.unread || 0), 0);
  document.title = total ? `(${total}) Sandesh` : "Sandesh";
}

async function loadConversations() {
  conversations = await api("GET", "/api/conversations");
  renderSidebar();
}

async function loadDirectory() {
  const people = await api("GET", "/api/directory");
  directory.clear();
  for (const p of people) directory.set(p.id, p);
}

/* =====================================================================
 * Message rendering
 * ===================================================================== */
const TOKEN = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])|@([\p{L}\p{N}._-]{2,40})/gu;
const usernames = () => new Set([...directory.values()].map((u) => u.username.toLowerCase()));

/** Text with clickable links and highlighted @mentions (never HTML) */
function richText(text) {
  const out = [];
  const known = usernames();
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      out.push(el("a", { href: m[1], target: "_blank", rel: "noopener noreferrer", className: "link" }, m[1]));
    } else {
      const name = m[2].toLowerCase();
      if (name === "all" || known.has(name)) {
        const mine = me && (name === me.username.toLowerCase() || name === "all");
        out.push(el("span", { className: "mention" + (mine ? " me" : "") }, m[0]));
      } else out.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const mentionsMe = (m) => {
  if (!me || !m.message || m.sender_id === me.id) return false;
  const t = m.message.toLowerCase();
  return new RegExp(`(^|[^\\p{L}\\p{N}._-])@(${me.username.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|all)(?![\\p{L}\\p{N}._-])`, "u").test(t);
};

function renderAttachment(a) {
  if (/^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(a.mime_type)) {
    const img = el("img", { src: a.url, alt: a.file_name, loading: "lazy" });
    const link = el("a", { className: "shot", href: a.url, target: "_blank", rel: "noopener", title: a.file_name }, img);
    img.onerror = () => link.replaceWith(fileCard(a));
    return link;
  }
  if (/^video\//.test(a.mime_type)) {
    return el("video", { className: "vid", src: a.url, controls: true, preload: "metadata" });
  }
  if (/^audio\//.test(a.mime_type)) {
    return el("audio", { className: "aud", src: a.url, controls: true, preload: "metadata" });
  }
  return fileCard(a);
}

function fileCard(a) {
  return el("a", { className: "file", href: a.url + "?download=1", title: `Download ${a.file_name}` },
    svgUse("doc"),
    el("span", {}, el("span", { className: "fname" }, a.file_name), el("span", { className: "fsize" }, fmtSize(Number(a.size_bytes)))));
}

function quoteView(r) {
  const text = r.deleted ? "Message deleted" : r.kind === "poll" ? `📊 ${r.message || "Poll"}` : r.message || (r.has_attachments ? "📎 Attachment" : "");
  const q = el("button", { type: "button", className: "quote", title: "Show the original message", onclick: () => jumpTo(r.id) },
    el("span", { className: "qn" }, r.sender || "Someone"),
    el("span", { className: "qt" }, text));
  q.style.setProperty("--qc", inkFor(r.sender || ""));
  return q;
}

function stampFor(m, mine) {
  const parts = [];
  if (m.edited_at && !m.deleted_at) parts.push(el("span", { className: "edited", title: `Edited ${new Date(m.edited_at).toLocaleString()}` }, "edited"));
  parts.push(el("time", { dateTime: new Date(m.timestamp).toISOString(), title: new Date(m.timestamp).toLocaleString() }, clock(m.timestamp)));
  if (mine && !m.deleted_at) {
    const t = el("span", { className: "ticks", title: "Sent" });
    t.append(ic("check"), ic("check"));
    parts.push(t);
  }
  return el("span", { className: "stamp" }, parts);
}

function pollView(m) {
  const p = m.poll;
  const votes = p.votes || [];
  const voters = new Set(votes.map((v) => v.user_id)).size;
  const minePicks = new Set(votes.filter((v) => v.user_id === me.id).map((v) => v.option));
  const counts = p.options.map((_, i) => votes.filter((v) => v.option === i).length);
  const top = Math.max(1, ...counts);
  const box = el("div", { className: "poll" + (p.closed ? " closed" : "") });
  box.append(el("div", { className: "poll-q" }, el("span", { className: "poll-tag" }, ic("poll"), "Poll"), p.question));
  p.options.forEach((opt, i) => {
    const who = votes.filter((v) => v.option === i).map((v) => nameOf(v.user_id));
    const b = el("button", {
      type: "button",
      className: "poll-opt" + (minePicks.has(i) ? " picked" : "") + (counts[i] === top && counts[i] > 0 ? " lead" : ""),
      disabled: p.closed || !state.member,
      title: who.length ? who.join(", ") : "No votes yet",
      onclick: () => {
        const next = new Set(minePicks);
        if (p.multi) next.has(i) ? next.delete(i) : next.add(i);
        else if (next.has(i)) next.clear();
        else { next.clear(); next.add(i); }
        ask("poll:vote", { messageId: m.id, options: [...next] }).catch((e) => toast(e.message, true));
      },
    });
    b.style.setProperty("--pct", `${voters ? Math.round((counts[i] / voters) * 100) : 0}%`);
    b.append(
      el("span", { className: "poll-bar" }),
      el("span", { className: "poll-mark" }, minePicks.has(i) ? ic("check") : null),
      el("span", { className: "poll-label" }, opt),
      el("span", { className: "poll-count" }, String(counts[i])),
    );
    box.append(b);
  });
  const foot = el("div", { className: "poll-foot" },
    `${voters} ${voters === 1 ? "vote" : "votes"} · ${p.closed ? "Closed" : p.multi ? "Pick one or more" : "Pick one"}`);
  if (!p.closed && (m.sender_id === me.id || me.role === "admin")) {
    foot.append(el("button", {
      type: "button", className: "linkbtn", textContent: "Close poll",
      onclick: () => ask("poll:close", { messageId: m.id }).catch((e) => toast(e.message, true)),
    }));
  }
  box.append(foot);
  return box;
}

function reactionsView(m) {
  if (!m.reactions || !m.reactions.length) return null;
  const wrap = el("div", { className: "reacts" });
  for (const r of m.reactions) {
    const mine = r.users.includes(me.id);
    const b = el("button", {
      type: "button", className: "rx" + (mine ? " mine" : ""),
      title: r.users.map((u) => (u === me.id ? "You" : nameOf(u))).join(", "),
      onclick: () => react(m, r.emoji),
    }, el("span", { className: "e" }, r.emoji), el("span", { className: "n" }, String(r.users.length)));
    wrap.append(b);
  }
  return wrap;
}

function buildRow(m, prev, fresh) {
  const c = conv(m.conversation_id);
  if (m.kind === "system") {
    const s = el("div", { className: "sysmsg" }, el("span", {}, m.message, el("time", {}, " · " + clock(m.timestamp))));
    s.dataset.id = m.id;
    return s;
  }
  const mine = !!me && m.sender_id === me.id;
  const cont = !!prev && prev.kind !== "system" && prev.sender_id === m.sender_id && sameDay(prev.timestamp, m.timestamp) &&
    new Date(m.timestamp) - new Date(prev.timestamp) < 10 * 60 * 1000;
  const room = c && c.type === "room";
  const sender = m.sender || "User";

  const row = el("div", { className: "msg" });
  row.dataset.id = m.id;
  if (mine) row.classList.add("mine");
  if (cont) row.classList.add("cont");
  if (fresh) row.classList.add("fresh");
  if (m.deleted_at) row.classList.add("deleted");
  if (mentionsMe(m)) row.classList.add("mentions-me");

  if (room && !mine) {
    row.classList.add("has-av");
    if (!cont) {
      const av = userAvatar(sender, m.sender_image, "sm mav");
      if (m.sender_id) av.dataset.uid = m.sender_id;
      row.append(av);
    }
  }

  const from = el("div", { className: "from" }, sender);
  from.style.color = inkFor(sender);
  if (m.sender_id) from.dataset.uid = m.sender_id;

  const bubble = el("div", { className: "bubble" });
  if (m.deleted_at) {
    bubble.append(el("div", { className: "text gone" }, ic("ban"), mine ? "You deleted this message" : "This message was deleted",
      el("span", { className: "stamp-space", ariaHidden: "true" }, clock(m.timestamp)), stampFor(m, false)));
  } else {
    if (m.reply_to) bubble.append(quoteView(m.reply_to));
    if (m.attachments && m.attachments.length) bubble.append(el("div", { className: "files" }, m.attachments.map(renderAttachment)));
    // a message sent with an effect gets a footer: [effect chip ........ time]
    const fx = m.effect && EFFECTS.find((e) => e[0] === m.effect);
    const fxTag = fx
      ? el("button", { type: "button", className: "fx-tag", title: "Play the effect again", onclick: () => window.sandesEffects?.play(m.effect) },
          el("span", { className: "fx-e" }, fx[2]), fx[1])
      : null;
    if (m.kind === "poll" && m.poll) {
      bubble.classList.add("has-poll");
      bubble.append(pollView(m), el("div", { className: "poll-stamp" + (fxTag ? " with-fx" : "") }, fxTag, stampFor(m, mine)));
    } else if (m.message && !fxTag) {
      const space = el("span", { className: "stamp-space" + (mine ? " mine" : "") + (m.edited_at ? " ed" : ""), ariaHidden: "true" }, clock(m.timestamp));
      bubble.append(el("div", { className: "text" }, richText(m.message), space, stampFor(m, mine)));
    } else if (m.message) {
      bubble.append(el("div", { className: "text" }, richText(m.message)), el("div", { className: "msg-foot" }, fxTag, stampFor(m, mine)));
    } else {
      bubble.append(el("div", { className: "solo-stamp" + (fxTag ? " with-fx" : "") }, fxTag, stampFor(m, mine)));
    }
  }

  const wrap = el("div", { className: "mwrap" }, bubble);
  if (!m.deleted_at) {
    const acts = el("div", { className: "acts" },
      state.member ? iconBtn("smile", "React", "act", (e) => openReactPicker(m, e.currentTarget)) : null,
      state.member ? iconBtn("reply", "Reply", "act", () => startReply(m)) : null,
      iconBtn("more", "More", "act", (e) => openMenu(m, e.currentTarget)));
    wrap.append(acts);
    // touch: press and hold the bubble for the menu
    let hold = 0;
    bubble.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      hold = setTimeout(() => { hold = 0; openMenu(m, bubble, true); }, 480);
    });
    const cancel = () => { if (hold) clearTimeout(hold); hold = 0; };
    bubble.addEventListener("pointerup", cancel);
    bubble.addEventListener("pointercancel", cancel);
    bubble.addEventListener("pointermove", (e) => { if (e.pointerType === "touch" && Math.abs(e.movementY) > 4) cancel(); });
    bubble.addEventListener("contextmenu", (e) => { if (e.pointerType === "touch" || matchMedia("(pointer: coarse)").matches) e.preventDefault(); });
  }

  row.append(from, wrap);
  const rx = reactionsView(m);
  if (rx) row.append(rx);
  row.append(el("div", { className: "seen", hidden: true }));
  return row;
}

function emptyNote() {
  const c = activeConv();
  if (!c) return null;
  return el("p", { className: "empty" },
    c.type === "direct" ? `This is the start of your private chat with ${c.name}.`
      : c.slug === "main" ? "No messages yet. Write the first one below."
      : `This is the start of ${c.name}. Say hello!`);
}

function appendRow(m, prev, fresh) {
  if (!prev || !sameDay(prev.timestamp, m.timestamp)) list.append(el("div", { className: "day" }, dayLabel(new Date(m.timestamp))));
  if (unreadMarker && m.id === unreadMarker) list.append(el("div", { className: "new-divider", id: "newDivider" }, "New messages"));
  const row = buildRow(m, prev, fresh);
  list.append(row);
  rows.set(m.id, row);
}

function renderAll() {
  list.replaceChildren();
  rows.clear();
  byId.clear();
  if (hasOlder) list.append(el("div", { className: "older" }, "Scroll up for older messages"));
  if (!loaded.length) list.append(emptyNote());
  let prev = null;
  for (const m of loaded) {
    byId.set(m.id, m);
    appendRow(m, prev, false);
    prev = m;
  }
  updateReceipts();
}

/** Re-draw one message in place (after an edit, reaction, vote...) */
function refreshRow(id) {
  const row = rows.get(id);
  const i = loaded.findIndex((x) => x.id === id);
  if (!row || i < 0) return;
  const next = buildRow(loaded[i], loaded[i - 1] || null, false);
  row.replaceWith(next);
  rows.set(id, next);
  updateReceipts();
}

function addMessage(m) {
  const empty = list.querySelector(".empty");
  if (empty) empty.remove();
  const prev = loaded[loaded.length - 1] || null;
  loaded.push(m);
  byId.set(m.id, m);
  appendRow(m, prev, true);
  updateReceipts();
}

/* ---------- read receipts ---------- */
function updateReceipts() {
  const c = activeConv();
  if (!c || !me) return;
  const others = [...state.reads].filter(([uid]) => uid !== me.id);
  let lastMine = null;
  for (const m of loaded) if (m.sender_id === me.id && m.kind !== "system" && !m.deleted_at) lastMine = m;
  const lastAny = loaded[loaded.length - 1];
  for (const [id, row] of rows) {
    const m = byId.get(id);
    if (!m || m.sender_id !== me.id || m.kind === "system") continue;
    const readers = others.filter(([, r]) => r >= id).map(([uid]) => uid);
    const ticks = row.querySelector(".ticks");
    if (ticks) {
      ticks.classList.toggle("read", readers.length > 0);
      ticks.title = readers.length
        ? (c.type === "direct" ? "Seen" : `Seen by ${readers.map(nameOf).join(", ")}`)
        : "Sent";
    }
    const seen = row.querySelector(".seen");
    if (!seen) continue;
    // "Seen by …" only under your latest message, when it's also the newest in the chat
    const show = lastMine && id === lastMine.id && lastAny && lastAny.id === id && readers.length > 0;
    seen.hidden = !show;
    if (show) {
      seen.textContent = c.type === "direct" ? "Seen" : readers.length <= 3
        ? `Seen by ${readers.map(nameOf).join(", ")}`
        : `Seen by ${readers.length}`;
      seen.title = readers.map(nameOf).join(", ");
    }
  }
}

/* =====================================================================
 * Opening a chat
 * ===================================================================== */
let stick = true;
const nearBottom = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
const scrollDown = () => { feed.scrollTop = feed.scrollHeight; stick = true; syncToLatest(); };

async function fetchState(id) {
  const st = await api("GET", `/api/conversations/${id}/state`);
  if (activeId !== id) return;
  state = {
    reads: new Map(st.reads.map((r) => [r.user_id, r.last_read_id])),
    pins: st.pins, members: st.members, open_tasks: st.open_tasks,
    can_manage: st.can_manage, member: st.member, my_role: st.my_role,
  };
  window.sandesPanels?.setOpenTasks(st.open_tasks);
}

async function openConversation(id, { focus = null } = {}) {
  const c = conv(id);
  if (!c) return;
  const same = activeId === id;
  if (same && focus) return jumpTo(focus);
  if (!same) {
    window.sandesCrackers?.reset();
    typingStop();
    cancelCompose();
    closePop();
  }
  activeId = id;
  window.sandesCalendar?.close();
  window.sandesCalendar?.switchTo(id);
  window.sandesBoard?.switchTo(id);
  window.sandesPanels?.switchTo(id);
  appEl.classList.add("in-chat");
  chatEl.classList.toggle("direct", c.type === "direct");
  pinIndex = 0;
  renderHeader();
  renderSidebar();
  syncComposer();
  closeSearch();

  const hadUnread = c.unread > 0;
  const lastRead = c.last_read_id || 0;
  list.replaceChildren(el("p", { className: "loading-msgs" }, "Loading…"));
  try {
    const [msgs] = await Promise.all([
      api("GET", `/api/conversations/${id}/messages${focus ? `?from=${focus}` : ""}`),
      fetchState(id),
    ]);
    if (activeId !== id) return;
    loaded = msgs;
    hasOlder = focus ? true : msgs.length >= PAGE;
    const firstUnread = hadUnread ? msgs.find((m) => m.id > lastRead && m.sender_id !== me.id && m.kind !== "system") : null;
    unreadMarker = firstUnread ? firstUnread.id : null;
    renderAll();
    renderPins();
    renderHeader();
    syncComposer();
  } catch (err) {
    if (activeId !== id) return;
    list.replaceChildren(el("p", { className: "empty" }, err.message));
    return;
  }

  if (focus) jumpTo(focus);
  else if (unreadMarker && $("newDivider")) {
    $("newDivider").scrollIntoView({ block: "start" });
    stick = nearBottom();
  } else scrollDown();

  c.unread = 0;
  c.mentioned = false;
  renderSidebar();
  markReadSoon();
  if (matchMedia("(min-width: 761px)").matches) input.focus();
}

function leaveConversationView() {
  window.sandesCrackers?.reset();
  typingStop();
  cancelCompose();
  appEl.classList.remove("in-chat");
  activeId = null;
  window.sandesBoard?.switchTo(null);
  window.sandesPanels?.switchTo(null);
  window.sandesCalendar?.switchTo(null);
  renderSidebar();
}

$("back").onclick = leaveConversationView;

// Log out only after a yes
document.querySelector(".logout").addEventListener("click", async (e) => {
  e.preventDefault();
  const ok = await sandesUI.confirm("Log out of Sandesh?", {
    ok: "Log out", danger: true, icon: "⏻",
    sub: "You'll need your username (or user ID) and password to sign in again.",
  });
  if (ok) location.href = "/logout";
});

/** Scroll to a message (loading it first if it's not on screen) and flash it */
async function jumpTo(mid) {
  let row = rows.get(mid);
  if (!row && activeId) {
    try {
      const id = activeId;
      const msgs = await api("GET", `/api/conversations/${id}/messages?from=${mid}`);
      if (activeId !== id) return;
      loaded = msgs;
      hasOlder = true;
      unreadMarker = null;
      renderAll();
      row = rows.get(mid);
    } catch {}
  }
  if (!row) return toast("That message isn't available any more", true);
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.classList.remove("flash");
  void row.offsetWidth;
  row.classList.add("flash");
  setTimeout(() => { stick = nearBottom(); syncToLatest(); }, 400);
}

async function loadOlder() {
  if (loadingOlder || !hasOlder || !loaded.length || !activeId) return;
  loadingOlder = true;
  const id = activeId;
  try {
    const older = await api("GET", `/api/conversations/${id}/messages?before=${loaded[0].id}`);
    if (activeId !== id) return;
    hasOlder = older.length >= PAGE;
    const keep = feed.scrollHeight - feed.scrollTop;
    loaded = older.concat(loaded);
    renderAll();
    feed.scrollTop = feed.scrollHeight - keep;
  } catch {} finally {
    loadingOlder = false;
  }
}

// Keep the view pinned to the newest message unless the user scrolled up to read
feed.addEventListener("scroll", () => {
  stick = nearBottom();
  if (feed.scrollTop < 200) loadOlder();
  syncToLatest();
  if (stick) markReadSoon();
});
new ResizeObserver(() => stick && (feed.scrollTop = feed.scrollHeight)).observe(list);

let newWhileUp = 0;
function syncToLatest() {
  const b = $("toLatest");
  if (stick) newWhileUp = 0;
  b.hidden = stick || !activeId;
  b.querySelector(".n").textContent = newWhileUp ? String(newWhileUp) : "";
}
$("toLatest").onclick = () => {
  const last = loaded[loaded.length - 1];
  if (hasOlder && unreadMarker == null && last) scrollDown();
  else scrollDown();
};

/* ---------- marking as read ---------- */
let readTimer = 0;
function markReadSoon() {
  clearTimeout(readTimer);
  readTimer = setTimeout(() => {
    if (!activeId || document.hidden || !stick) return;
    const last = loaded[loaded.length - 1];
    if (!last || (lastReadSent.get(activeId) || 0) >= last.id) return;
    lastReadSent.set(activeId, last.id);
    socket.emit("read", { conversationId: activeId, messageId: last.id });
    const c = activeConv();
    if (c) { c.unread = 0; c.mentioned = false; c.last_read_id = last.id; renderSidebar(); }
  }, 350);
}
document.addEventListener("visibilitychange", markReadSoon);
window.addEventListener("focus", markReadSoon);

/* =====================================================================
 * Header: title, presence / typing line, tools
 * ===================================================================== */
function renderHeader() {
  const c = activeConv();
  if (!c) return;
  $("chatTitle").textContent = c.name;
  $("chatAvatar").replaceChildren(avatarFor(c));
  const sub = $("chatSub");
  const typing = typingText(c.id);
  sub.classList.toggle("typing", !!typing);
  sub.classList.toggle("online", !typing && c.type === "direct" && isOnline(c.other_user_id));
  if (typing) sub.textContent = typing;
  else if (c.type === "direct") {
    const u = directory.get(c.other_user_id);
    sub.textContent = u && u.status !== "active" ? "Account turned off" : isOnline(c.other_user_id) ? "Online" : lastSeenText(u && u.last_seen);
  } else {
    const members = state.members || [];
    const online = members.filter((m) => isOnline(m.id)).length;
    const kind = c.slug === "main" ? "Everyone" : c.is_public ? "Public channel" : "Private group";
    const count = c.slug === "main" ? "" : ` · ${members.length || c.member_count} ${(members.length || c.member_count) === 1 ? "member" : "members"}`;
    sub.textContent = `${kind}${count}${online ? ` · ${online} online` : ""}`;
  }
}
$("headMain").onclick = () => activeId && openInfo();
$("headMain").onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && activeId) { e.preventDefault(); openInfo(); } };

// typing lines expire on their own
setInterval(() => {
  let changed = false;
  const t = Date.now();
  for (const [cid, m] of typingIn) {
    for (const [uid, x] of m) if (x.until <= t) { m.delete(uid); changed = true; }
    if (!m.size) typingIn.delete(cid);
  }
  if (changed) { renderSidebar(); renderHeader(); }
}, 1000);

// refresh "last seen 5 min ago" now and then
setInterval(() => { if (activeConv() && activeConv().type === "direct") renderHeader(); }, 30000);

/* =====================================================================
 * Pins bar
 * ===================================================================== */
function pinText(p) {
  const t = p.kind === "poll" ? `📊 ${p.message || "Poll"}` : p.message || (p.has_attachments ? "📎 Attachment" : "");
  return `${p.sender}: ${t}`;
}

function renderPins() {
  const bar = $("pinBar");
  const pins = state.pins || [];
  chatEl.classList.toggle("has-pins", pins.length > 0);
  bar.hidden = !pins.length;
  if (!pins.length) return;
  if (pinIndex >= pins.length) pinIndex = 0;
  const p = pins[pinIndex];
  bar.replaceChildren(
    el("button", {
      type: "button", className: "pin-main", title: pins.length > 1 ? "Show this message (click again for the next pin)" : "Show this message",
      onclick: () => {
        jumpTo(p.message_id);
        if (pins.length > 1) { pinIndex = (pinIndex + 1) % pins.length; renderPins(); }
      },
    },
      el("span", { className: "pin-ic" }, ic("pin")),
      el("span", { className: "pin-txt" },
        el("span", { className: "pin-h" }, pins.length > 1 ? `Pinned · ${pinIndex + 1} of ${pins.length}` : "Pinned"),
        el("span", { className: "pin-b" }, pinText(p)))),
    iconBtn("down", "All pinned messages", "ibtn", (e) => openPinList(e.currentTarget)),
  );
}

function openPinList(anchor) {
  const box = el("div", { className: "pop-list" }, el("div", { className: "pop-title" }, "Pinned messages"));
  for (const p of state.pins) {
    box.append(el("div", { className: "pin-row" },
      el("button", { type: "button", className: "pin-go", onclick: () => { closePop(); jumpTo(p.message_id); } },
        el("span", { className: "pin-b" }, pinText(p)),
        el("small", {}, `Pinned by ${p.pinned_by || "someone"} · ${shortTime(p.pinned_at)}`)),
      state.member ? iconBtn("close", "Unpin", "ibtn", () => { closePop(); setPin(p.message_id, false); }) : null));
  }
  showPop(anchor, box);
}

const setPin = (messageId, on) =>
  ask("pin", { messageId, on }).then(() => toast(on ? "Pinned to the top of the chat" : "Unpinned")).catch((e) => toast(e.message, true));

/* =====================================================================
 * Popovers (menus, pickers)
 * ===================================================================== */
const pop = el("div", { className: "pop", hidden: true });
pop.setAttribute("role", "menu");
document.body.append(pop);
let popAnchor = null;

function showPop(anchor, content, { above = false } = {}) {
  pop.replaceChildren(content);
  pop.hidden = false;
  popAnchor = anchor;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), innerWidth - pw - 8);
  let y = above || r.bottom + ph + 8 > innerHeight ? r.top - ph - 6 : r.bottom + 6;
  if (y < 8) y = 8;
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;
  const first = pop.querySelector("button, input");
  if (first && matchMedia("(pointer: fine)").matches) first.focus({ preventScroll: true });
}

function closePop() {
  pop.hidden = true;
  pop.replaceChildren();
  popAnchor = null;
}

document.addEventListener("pointerdown", (e) => {
  if (!pop.hidden && !pop.contains(e.target) && !(popAnchor && popAnchor.contains(e.target))) closePop();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) closePop(); });
feed.addEventListener("scroll", () => { if (!pop.hidden && popAnchor && feed.contains(popAnchor)) closePop(); });

function emojiRow(m) {
  const row = el("div", { className: "emoji-row" });
  for (const e of REACTIONS) {
    const mine = (m.reactions || []).some((r) => r.emoji === e && r.users.includes(me.id));
    row.append(el("button", { type: "button", className: "emo" + (mine ? " mine" : ""), title: e, onclick: () => { closePop(); react(m, e); } }, e));
  }
  return row;
}

function openReactPicker(m, anchor) {
  showPop(anchor, emojiRow(m), { above: true });
}

const react = (m, emoji) => ask("react", { messageId: m.id, emoji }).catch((e) => toast(e.message, true));

function menuItem(icon, label, fn, cls = "") {
  return el("button", { type: "button", className: "mi " + cls, onclick: () => { closePop(); fn(); } }, ic(icon), label);
}

function openMenu(m, anchor, touch = false) {
  if (m.deleted_at) return;
  const mine = m.sender_id === me.id;
  const pinned = (state.pins || []).some((p) => p.message_id === m.id);
  const box = el("div", { className: "menu" });
  if (touch && state.member) box.append(emojiRow(m));
  if (state.member) box.append(menuItem("reply", "Reply", () => startReply(m)));
  if (m.message) box.append(menuItem("copy", "Copy text", () => copyText(m.message).then(() => toast("Copied"))));
  if (mine && m.kind === "text") box.append(menuItem("edit", "Edit", () => startEdit(m)));
  if (state.member) box.append(menuItem("pin", pinned ? "Unpin" : "Pin to top", () => setPin(m.id, !pinned)));
  if (state.member && m.message && window.sandesPanels) {
    box.append(menuItem("task", "Add to tasks", () => window.sandesPanels.addTask(m.message, m.id)));
  }
  if (mine || state.can_manage) {
    box.append(menuItem("trash", "Delete", async () => {
      if (!(await sandesUI.confirm("Delete this message for everyone?", { ok: "Delete", danger: true, sub: "It's replaced with “This message was deleted”." }))) return;
      ask("message:delete", { id: m.id }).catch((e) => toast(e.message, true));
    }, "danger"));
  }
  showPop(anchor, box);
}

/* =====================================================================
 * Composer: reply / edit / effects / mentions / typing
 * ===================================================================== */
function composeBar(kind, title, text) {
  const bar = $("composeBar");
  bar.hidden = false;
  bar.className = "compose-bar " + kind;
  bar.replaceChildren(
    el("span", { className: "cb-ic" }, ic(kind === "edit" ? "edit" : kind === "effect" ? "sparkle" : "reply")),
    el("span", { className: "cb-txt" }, el("b", {}, title), text ? el("span", {}, text) : null),
    iconBtn("close", "Cancel", "ibtn", () => (kind === "effect" ? setEffect(null) : cancelCompose())),
  );
}

function syncComposeBar() {
  if (editingId) {
    const m = byId.get(editingId);
    return composeBar("edit", "Editing message", m && m.message);
  }
  if (replyTo) {
    const m = byId.get(replyTo);
    const t = m ? (m.kind === "poll" ? `📊 ${m.message}` : m.message || "📎 Attachment") : "";
    return composeBar("reply", `Replying to ${m ? m.sender : "a message"}`, t);
  }
  if (pendingEffect) {
    const fx = EFFECTS.find((e) => e[0] === pendingEffect);
    return composeBar("effect", `Sends with ${fx[1].toLowerCase()} ${fx[2]}`, "Everyone in the chat sees it");
  }
  $("composeBar").hidden = true;
}

function startReply(m) {
  editingId = null;
  replyTo = m.id;
  syncComposeBar();
  input.focus();
}

function startEdit(m) {
  replyTo = null;
  editingId = m.id;
  input.value = m.message || "";
  autosize();
  syncComposeBar();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function cancelCompose() {
  if (editingId) { input.value = ""; autosize(); }
  editingId = null;
  replyTo = null;
  syncComposeBar();
}

function setEffect(name) {
  pendingEffect = name;
  syncComposeBar();
  input.focus();
}

function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
}

let typingSentAt = 0, typingConv = null;
function typingPing() {
  if (!activeId) return;
  if (!input.value.trim() || editingId) return typingStop();
  const t = Date.now();
  if (typingConv !== activeId || t - typingSentAt > 2500) {
    if (typingConv && typingConv !== activeId) typingStop();
    socket.emit("typing", { conversationId: activeId, on: true });
    typingSentAt = t;
    typingConv = activeId;
  }
}
function typingStop() {
  if (!typingConv) return;
  socket.emit("typing", { conversationId: typingConv, on: false });
  typingConv = null;
  typingSentAt = 0;
}
input.addEventListener("blur", () => setTimeout(typingStop, 300));

/* ---------- @mention suggestions ---------- */
const mbox = $("mentionBox");
let mentionList = [], mentionPick = 0, mentionAt = -1;

function mentionCandidates(q) {
  const c = activeConv();
  if (!c) return [];
  let people = c.type === "direct"
    ? [directory.get(c.other_user_id)].filter(Boolean)
    : (state.members || []);
  people = people.filter((p) => p.id !== me.id && p.username.toLowerCase().includes(q));
  people.sort((a, b) => (b.username.toLowerCase().startsWith(q) ? 1 : 0) - (a.username.toLowerCase().startsWith(q) ? 1 : 0));
  const out = people.slice(0, 6).map((p) => ({ name: p.username, image: p.image, id: p.id }));
  if (c.type !== "direct" && "all".startsWith(q)) out.push({ name: "all", all: true });
  return out;
}

function mentionCheck() {
  const pos = input.selectionStart;
  const before = input.value.slice(0, pos);
  const mt = before.match(/(^|\s)@([\p{L}\p{N}._-]{0,40})$/u);
  if (!mt) return hideMentions();
  mentionAt = pos - mt[2].length - 1;
  mentionList = mentionCandidates(mt[2].toLowerCase());
  if (!mentionList.length) return hideMentions();
  mentionPick = Math.min(mentionPick, mentionList.length - 1);
  renderMentions();
}

function renderMentions() {
  mbox.hidden = false;
  mbox.replaceChildren(...mentionList.map((p, i) => {
    const b = el("button", {
      type: "button", className: "mopt" + (i === mentionPick ? " on" : ""),
      onmousedown: (e) => { e.preventDefault(); pickMention(i); },
    },
      p.all ? el("span", { className: "avatar sm all" }, "@") : userAvatar(p.name, p.image, "sm"),
      el("span", {}, p.all ? "all" : p.name),
      p.all ? el("small", {}, "everyone in this chat") : null);
    return b;
  }));
}

function hideMentions() {
  mbox.hidden = true;
  mentionList = [];
  mentionPick = 0;
}

function pickMention(i) {
  const p = mentionList[i];
  if (!p) return;
  const pos = input.selectionStart;
  input.value = input.value.slice(0, mentionAt) + "@" + p.name + " " + input.value.slice(pos);
  const caret = mentionAt + p.name.length + 2;
  input.setSelectionRange(caret, caret);
  hideMentions();
  autosize();
  input.focus();
}

input.addEventListener("input", () => {
  autosize();
  typingPing();
  mentionCheck();
});
input.addEventListener("click", mentionCheck);

input.addEventListener("keydown", (e) => {
  if (!mbox.hidden) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      mentionPick = (mentionPick + (e.key === "ArrowDown" ? 1 : mentionList.length - 1)) % mentionList.length;
      return renderMentions();
    }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); return pickMention(mentionPick); }
    if (e.key === "Escape") { e.preventDefault(); return hideMentions(); }
  }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("composer").requestSubmit();
    return;
  }
  if (e.key === "Escape" && (replyTo || editingId || pendingEffect)) {
    e.preventDefault();
    if (pendingEffect && !replyTo && !editingId) setEffect(null);
    else cancelCompose();
    return;
  }
  // ↑ in an empty box edits your last message
  if (e.key === "ArrowUp" && !input.value && !editingId) {
    const last = [...loaded].reverse().find((m) => m.sender_id === me.id && m.kind === "text" && !m.deleted_at && m.message);
    if (last) { e.preventDefault(); startEdit(last); }
  }
});

/* ---------- + menu and effects ---------- */
function openPlusMenu(anchor) {
  const box = el("div", { className: "menu" });
  if (settings.attachments_enabled !== false) box.append(menuItem("attach", "Attach files", () => fileInput.click(), "only-mobile"));
  box.append(menuItem("poll", "Create a poll", openPollDialog));
  if (window.sandesCalendar) {
    const m = menuItem("bell", "Schedule an event", () => window.sandesCalendar.newEvent(activeId));
    m.querySelector("svg").innerHTML = '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>';
    box.append(m);
  }
  if (window.sandesPanels) {
    box.append(menuItem("task", "Add a task", () => window.sandesPanels.openTasks(true)));
    box.append(menuItem("notes", "Open shared notes", () => window.sandesPanels.openNotes()));
  }
  if (settings.message_effects_enabled !== false) box.append(menuItem("sparkle", "Send with an effect", () => openEffectPicker(anchor)));
  showPop(anchor, box, { above: true });
}

function openEffectPicker(anchor) {
  const box = el("div", { className: "fx-pick" }, el("div", { className: "pop-title" }, "Send with an effect"));
  for (const [id, label, emoji] of EFFECTS) {
    box.append(el("button", {
      type: "button", className: "fx-opt" + (pendingEffect === id ? " on" : ""),
      onclick: () => { closePop(); setEffect(pendingEffect === id ? null : id); window.sandesEffects?.preview(id); },
    }, el("span", { className: "fx-e" }, emoji), label));
  }
  showPop(anchor, box, { above: true });
}

$("plusBtn").onclick = (e) => openPlusMenu(e.currentTarget);
$("fxBtn").onclick = (e) => openEffectPicker(e.currentTarget);

/* ---------- attachments ---------- */
function addFiles(files) {
  statusEl.textContent = "";
  if (settings.attachments_enabled === false) { statusEl.textContent = "Sending files is turned off by the admin."; return; }
  for (const f of files) {
    if (pendingFiles.length >= MAX_FILES) { statusEl.textContent = `You can attach up to ${MAX_FILES} files at once.`; break; }
    pendingFiles.push(f);
  }
  renderPending();
}

function renderPending() {
  pendingEl.replaceChildren(
    ...pendingFiles.map((f, i) =>
      el("span", { className: "chip" },
        el("span", {}, f.name),
        el("small", {}, fmtSize(f.size)),
        el("button", { type: "button", ariaLabel: `Remove ${f.name}`, onclick: () => { pendingFiles.splice(i, 1); renderPending(); } }, "×"))),
  );
}

fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ""; };

let dragDepth = 0;
chatEl.addEventListener("dragenter", (e) => { if (e.dataTransfer.types.includes("Files")) { dragDepth++; chatEl.classList.add("dragging"); } });
chatEl.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; chatEl.classList.remove("dragging"); } });
chatEl.addEventListener("dragover", (e) => e.preventDefault());
chatEl.addEventListener("drop", (e) => {
  e.preventDefault(); dragDepth = 0; chatEl.classList.remove("dragging");
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});
input.addEventListener("paste", (e) => { if (e.clipboardData.files.length) addFiles(e.clipboardData.files); });

/* ---------- send ---------- */
$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activeId) return;
  hideMentions();
  const text = input.value.trim();
  statusEl.textContent = "";

  if (editingId) {
    const id = editingId;
    try {
      await ask("message:edit", { id, message: text });
      editingId = null;
      input.value = "";
      autosize();
      syncComposeBar();
    } catch (err) {
      statusEl.textContent = err.message;
    }
    return;
  }

  if (!text && !pendingFiles.length) return;
  if (text.length > 4000) { statusEl.textContent = "That message is too long (4000 characters max)."; return; }
  typingStop();
  $("newDivider")?.remove();
  unreadMarker = null;
  const reply = replyTo, effect = pendingEffect;

  if (!pendingFiles.length) {
    socket.emit("chat message", { conversationId: activeId, message: text, replyTo: reply, effect });
    input.value = "";
    autosize();
    replyTo = null;
    pendingEffect = null;
    syncComposeBar();
    if (effect) window.sandesEffects?.play(effect);
    scrollDown();
    return;
  }

  const fd = new FormData();
  fd.append("message", text);
  if (reply) fd.append("replyTo", reply);
  if (effect) fd.append("effect", effect);
  pendingFiles.forEach((f) => fd.append("files", f));
  sendBtn.disabled = true;
  statusEl.style.color = "var(--slate)";
  statusEl.textContent = pendingFiles.length === 1 ? "Sending 1 file…" : `Sending ${pendingFiles.length} files…`;
  try {
    const label = statusEl.textContent.replace("…", "");
    const id = activeId;
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/conversations/${id}/messages`);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) statusEl.textContent = `${label}… ${Math.floor((ev.loaded / ev.total) * 100)}%`;
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let msg = "Message not sent. Try again.";
        try { msg = JSON.parse(xhr.responseText).message || msg; } catch {}
        reject(new Error(msg));
      };
      xhr.onerror = () => reject(new Error("Upload failed. Check the connection and try again."));
      xhr.send(fd);
    });
    input.value = "";
    autosize();
    pendingFiles = [];
    replyTo = null;
    pendingEffect = null;
    syncComposeBar();
    renderPending();
    statusEl.textContent = "";
    if (effect) window.sandesEffects?.play(effect);
  } catch (err) {
    statusEl.style.color = "";
    statusEl.textContent = err.message;
  } finally {
    statusEl.style.color = "";
    syncComposer();
    input.focus();
  }
});

// Read-only when: direct messages are off, or a public channel you haven't joined
function syncComposer() {
  const c = activeConv();
  const dmOff = !!c && c.type === "direct" && settings.direct_messages_enabled === false;
  const notMember = !!c && state.member === false;
  const joinBar = $("joinBar");
  joinBar.hidden = !notMember;
  $("composer").hidden = notMember;
  input.disabled = dmOff;
  input.placeholder = dmOff ? "Direct messages are turned off by the admin" : "Write a message";
  sendBtn.disabled = dmOff || !socket.connected;
  $("fxBtn").hidden = settings.message_effects_enabled === false;
}

$("joinBtn").onclick = async () => {
  try {
    await api("POST", `/api/groups/${activeId}/join`);
    await loadConversations();
    await openConversation(activeId);
  } catch (err) {
    toast(err.message, true);
  }
};

/* =====================================================================
 * Search
 * ===================================================================== */
const searchBox = $("search");
let searchTimer = 0, searchSeq = 0;

function closeSearch() {
  if (!searchBox.value && $("results").hidden) return;
  searchBox.value = "";
  $("results").hidden = true;
  $("lists").hidden = false;
  $("searchClear").hidden = true;
}

searchBox.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = searchBox.value.trim();
  $("searchClear").hidden = !searchBox.value;
  if (!q) {
    $("results").hidden = true;
    $("lists").hidden = false;
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 250);
});
searchBox.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSearch(); searchBox.blur(); } });
$("searchClear").onclick = () => { closeSearch(); searchBox.focus(); };

function snippetNodes(s) {
  // the server marks matches with ⟦ ⟧
  const out = [];
  s.split(/(⟦[^⟧]*⟧)/).forEach((part) => {
    if (part.startsWith("⟦") && part.endsWith("⟧")) out.push(el("mark", {}, part.slice(1, -1)));
    else if (part) out.push(part);
  });
  return out;
}

async function runSearch(q) {
  const seq = ++searchSeq;
  const box = $("results");
  box.hidden = false;
  $("lists").hidden = true;
  box.replaceChildren(el("p", { className: "hint" }, "Searching…"));
  try {
    const res = await api("GET", `/api/search?q=${encodeURIComponent(q)}`);
    if (seq !== searchSeq) return;
    if (!res.length) {
      box.replaceChildren(el("p", { className: "hint" }, `No messages match “${q}”.`));
      return;
    }
    box.replaceChildren(
      el("div", { className: "list-head" }, el("span", {}, `${res.length}${res.length >= 60 ? "+" : ""} ${res.length === 1 ? "result" : "results"}`)),
      ...res.map((r) =>
        el("button", {
          type: "button", className: "result",
          onclick: async () => {
            if (!conv(r.conversation_id)) await loadConversations();
            openConversation(r.conversation_id, { focus: r.id });
          },
        },
          userAvatar(r.sender, r.sender_image, "sm"),
          el("span", { className: "r-body" },
            el("span", { className: "r-head" },
              el("b", {}, r.sender),
              el("span", { className: "r-where" }, r.conversation_type === "direct" ? ` · with ${r.conversation_name}` : ` · ${r.conversation_name}`),
              el("time", {}, shortTime(r.created_at))),
            el("span", { className: "r-snip" }, snippetNodes(r.snippet || ""))))),
    );
  } catch (err) {
    if (seq === searchSeq) box.replaceChildren(el("p", { className: "hint" }, err.message));
  }
}

// Ctrl/Cmd + K jumps to search
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (appEl.classList.contains("in-chat") && matchMedia("(max-width: 760px)").matches) leaveConversationView();
    searchBox.focus();
    searchBox.select();
  }
});

/* =====================================================================
 * Dialogs: polls, groups, channels, chat info
 * ===================================================================== */
function modal(title, body, { wide = false } = {}) {
  const d = el("dialog", { className: "mdl" + (wide ? " wide" : "") });
  const close = iconBtn("close", "Close", "x", () => d.close());
  d.append(el("div", { className: "dlg-head" }, el("h2", {}, title), close), el("div", { className: "mdl-body" }, body));
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

const field = (label, control, hint) =>
  el("label", { className: "fld" }, el("span", { className: "fl" }, label), control, hint ? el("span", { className: "fh" }, hint) : null);

function openPollDialog() {
  if (!activeId) return;
  const q = el("input", { type: "text", maxLength: 300, placeholder: "Lunch at 1 or 2?", required: true });
  const opts = el("div", { className: "poll-opts" });
  const addOpt = (v = "") => {
    if (opts.children.length >= 10) return;
    const i = el("input", { type: "text", maxLength: 100, value: v, placeholder: `Option ${opts.children.length + 1}` });
    const row = el("div", { className: "po-row" }, i, iconBtn("close", "Remove option", "ibtn", () => { if (opts.children.length > 2) row.remove(); }));
    opts.append(row);
    return i;
  };
  addOpt();
  addOpt();
  const multi = el("input", { type: "checkbox" });
  const err = el("p", { className: "err" });
  const form = el("form", { className: "mform" },
    field("Question", q),
    el("div", { className: "fld" }, el("span", { className: "fl" }, "Options"), opts,
      el("button", { type: "button", className: "linkbtn", textContent: "+ Add an option", onclick: () => addOpt()?.focus() })),
    el("label", { className: "chk" }, multi, "People can pick more than one"),
    err,
    el("div", { className: "dlg-foot" }, el("button", { type: "submit", className: "pill-btn solid" }, "Create poll")));
  const d = modal("New poll", form);
  q.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = "";
    try {
      await ask("poll:create", {
        conversationId: activeId, question: q.value,
        options: [...opts.querySelectorAll("input")].map((i) => i.value).filter((v) => v.trim()),
        multi: multi.checked,
      });
      d.close();
      scrollDown();
    } catch (ex) {
      err.textContent = ex.message;
    }
  };
}

/** Pick people from the directory (checkbox list with search) */
function peoplePicker(exclude = new Set()) {
  const chosen = new Set();
  const search = el("input", { type: "search", placeholder: "Search people" });
  const listEl = el("div", { className: "pick-list" });
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const people = [...directory.values()]
      .filter((p) => p.status === "active" && p.id !== me.id && !exclude.has(p.id) && p.username.toLowerCase().includes(q))
      .sort((a, b) => a.username.localeCompare(b.username));
    listEl.replaceChildren(...(people.length ? people.map((p) => {
      const cb = el("input", { type: "checkbox", checked: chosen.has(p.id), onchange: () => (cb.checked ? chosen.add(p.id) : chosen.delete(p.id)) });
      return el("label", { className: "pick" }, cb, withDot(userAvatar(p.username, p.image, "sm"), p.id), el("span", {}, p.username));
    }) : [el("p", { className: "hint" }, "No one to add.")]));
  };
  search.oninput = render;
  render();
  return { node: el("div", { className: "picker" }, search, listEl), chosen };
}

function openNewGroup() {
  const name = el("input", { type: "text", maxLength: 60, placeholder: "Design team", required: true });
  const desc = el("textarea", { rows: 2, maxLength: 300, placeholder: "What's it for? (optional)" });
  const priv = el("input", { type: "radio", name: "gtype", value: "private", checked: true });
  const pub = el("input", { type: "radio", name: "gtype", value: "public" });
  const picker = peoplePicker();
  const err = el("p", { className: "err" });
  const form = el("form", { className: "mform" },
    field("Name", name),
    field("Description", desc),
    el("div", { className: "fld" }, el("span", { className: "fl" }, "Type"),
      el("label", { className: "radio" }, priv, el("span", {}, el("b", {}, ic("lock"), "Private group"), el("small", {}, "Only the people you add can see it."))),
      el("label", { className: "radio" }, pub, el("span", {}, el("b", {}, ic("hash"), "Public channel"), el("small", {}, "Anyone can find it with Browse and join.")))),
    el("div", { className: "fld" }, el("span", { className: "fl" }, "Add people"), picker.node),
    err,
    el("div", { className: "dlg-foot" }, el("button", { type: "submit", className: "pill-btn solid" }, "Create")));
  const d = modal("New group or channel", form, { wide: true });
  name.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = "";
    try {
      const c = await api("POST", "/api/groups", {
        name: name.value, description: desc.value, is_public: pub.checked, members: [...picker.chosen],
      });
      d.close();
      await loadConversations();
      openConversation(c.id);
    } catch (ex) {
      err.textContent = ex.message;
    }
  };
}

async function openBrowse() {
  const box = el("div", { className: "browse" }, el("p", { className: "hint" }, "Loading…"));
  const d = modal("Browse channels", box, { wide: true });
  const render = async () => {
    const chans = await api("GET", "/api/groups/browse");
    box.replaceChildren(...(chans.length ? chans.map((c) =>
      el("div", { className: "chan" },
        avatarFor({ ...c, type: "room", is_public: true }),
        el("div", { className: "chan-b" },
          el("b", {}, c.name),
          el("small", {}, `${c.member_count} ${c.member_count === 1 ? "member" : "members"}${c.description ? " · " + c.description : ""}`)),
        el("button", {
          type: "button", className: "pill-btn" + (c.joined ? "" : " solid"), textContent: c.joined ? "Open" : "Join",
          onclick: async () => {
            try {
              if (!c.joined) await api("POST", `/api/groups/${c.id}/join`);
              d.close();
              await loadConversations();
              openConversation(c.id);
            } catch (ex) { toast(ex.message, true); }
          },
        })))
      : [el("p", { className: "hint" }, "No public channels yet. Create one with New.")]));
  };
  render().catch((e) => box.replaceChildren(el("p", { className: "hint" }, e.message)));
}

$("newGroup").onclick = openNewGroup;
$("browseBtn").onclick = openBrowse;

async function openInfo() {
  const c = activeConv();
  if (!c) return;
  if (c.type === "direct") return openPersonInfo(c);
  let g;
  try { g = await api("GET", `/api/groups/${c.id}`); } catch (e) { return toast(e.message, true); }
  const body = el("div", { className: "info" });
  const d = modal(c.slug === "main" ? "Main room" : g.is_public ? "Channel info" : "Group info", body, { wide: true });
  const render = async () => {
    g = await api("GET", `/api/groups/${c.id}`);
    body.replaceChildren(groupInfoView(g, d, render));
  };
  body.replaceChildren(groupInfoView(g, d, render));
}

function groupInfoView(g, d, rerender) {
  const box = el("div", {});
  const cc = { ...activeConv(), name: g.name, image: g.image, is_public: g.is_public };
  const pic = el("div", { className: "info-pic" }, avatarFor(cc, "xl"));
  if (g.can_manage) {
    const file = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true });
    file.onchange = async () => {
      const f = file.files[0];
      file.value = "";
      if (!f) return;
      try {
        const blob = await squarePicture(f);
        const fd = new FormData();
        fd.append("image", blob, "group.webp");
        await api("POST", `/api/groups/${g.id}/image`, fd);
        rerender();
      } catch (e) { toast(e.message, true); }
    };
    pic.append(el("div", { className: "pic-btns" },
      el("label", { className: "pill-btn" }, "Change picture", file),
      g.image ? el("button", { type: "button", className: "pill-btn", textContent: "Remove", onclick: async () => { await api("DELETE", `/api/groups/${g.id}/image`); rerender(); } }) : null));
  }
  box.append(pic);

  if (g.can_manage) {
    const name = el("input", { type: "text", value: g.name, maxLength: 60 });
    const desc = el("textarea", { rows: 2, maxLength: 300, value: g.description || "", placeholder: "Description (optional)" });
    const pub = el("input", { type: "checkbox", checked: g.is_public });
    const msg = el("p", { className: "fh" });
    const form = el("form", { className: "mform" },
      field("Name", name), field("Description", desc),
      g.slug === "main" ? null : el("label", { className: "chk" }, pub, "Public channel (anyone can find and join it)"),
      msg,
      el("div", { className: "dlg-foot" }, el("button", { type: "submit", className: "pill-btn solid" }, "Save")));
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api("PATCH", `/api/groups/${g.id}`, { name: name.value, description: desc.value, ...(g.slug === "main" ? {} : { is_public: pub.checked }) });
        msg.textContent = "Saved";
        await loadConversations();
        renderHeader();
      } catch (ex) { msg.textContent = ex.message; }
    };
    box.append(form);
  } else {
    box.append(el("div", { className: "info-text" },
      el("h3", {}, g.name),
      g.description ? el("p", {}, g.description) : null,
      el("p", { className: "fh" }, g.slug === "main" ? "Everyone is in the main room." : g.is_public ? "Public channel" : "Private group")));
  }

  if (g.slug !== "main") {
    const head = el("div", { className: "mem-head" }, el("h3", {}, `${g.members.length} ${g.members.length === 1 ? "member" : "members"}`));
    if (g.can_manage || (g.is_public && g.member)) {
      head.append(el("button", {
        type: "button", className: "pill-btn", textContent: "+ Add people",
        onclick: () => {
          const picker = peoplePicker(new Set(g.members.map((m) => m.id)));
          const err = el("p", { className: "err" });
          const form = el("form", { className: "mform" }, picker.node, err,
            el("div", { className: "dlg-foot" }, el("button", { type: "submit", className: "pill-btn solid" }, "Add")));
          const dd = modal("Add people", form);
          form.onsubmit = async (e) => {
            e.preventDefault();
            try {
              await api("POST", `/api/groups/${g.id}/members`, { user_ids: [...picker.chosen] });
              dd.close();
              rerender();
            } catch (ex) { err.textContent = ex.message; }
          };
        },
      }));
    }
    box.append(head);
    const ml = el("div", { className: "mem-list" });
    for (const m of g.members) {
      const actions = el("span", { className: "mem-acts" });
      if (g.can_manage && m.id !== me.id) {
        actions.append(
          el("button", {
            type: "button", className: "linkbtn", textContent: m.role === "owner" ? "Remove owner" : "Make owner",
            onclick: async () => {
              try { await api("PATCH", `/api/groups/${g.id}/members/${m.id}`, { role: m.role === "owner" ? "member" : "owner" }); rerender(); }
              catch (e) { toast(e.message, true); }
            },
          }),
          el("button", {
            type: "button", className: "linkbtn danger", textContent: "Remove",
            onclick: async () => {
              if (!(await sandesUI.confirm(`Remove ${m.username} from ${g.name}?`, { ok: "Remove", danger: true }))) return;
              try { await api("DELETE", `/api/groups/${g.id}/members/${m.id}`); rerender(); }
              catch (e) { toast(e.message, true); }
            },
          }));
      }
      ml.append(el("div", { className: "mem" },
        withDot(userAvatar(m.username, m.image, "sm"), m.id),
        el("span", { className: "mem-n" }, m.username, m.id === me.id ? el("small", {}, " (you)") : null),
        m.role === "owner" ? el("span", { className: "role-tag" }, ic("crown"), "Owner") : null,
        actions));
    }
    box.append(ml);

    const foot = el("div", { className: "info-foot" });
    if (g.member) {
      foot.append(el("button", {
        type: "button", className: "pill-btn", onclick: async () => {
          if (!(await sandesUI.confirm(`Leave ${g.name}?`, { ok: "Leave", danger: true, sub: g.is_public ? "You can join again from Browse." : "Someone will need to add you back." }))) return;
          try {
            await api("DELETE", `/api/groups/${g.id}/members/${me.id}`);
            d.close();
          } catch (e) { toast(e.message, true); }
        },
      }, ic("door"), "Leave"));
    }
    if (g.can_manage) {
      foot.append(el("button", {
        type: "button", className: "pill-btn danger", onclick: async () => {
          if (!(await sandesUI.confirm(`Delete ${g.name} for everyone?`, { ok: "Delete group", danger: true, sub: "All its messages and files go too. This can't be undone." }))) return;
          try {
            await api("DELETE", `/api/groups/${g.id}`);
            d.close();
          } catch (e) { toast(e.message, true); }
        },
      }, ic("trash"), "Delete"));
    }
    box.append(foot);
  }
  return box;
}

function openPersonInfo(c) {
  const u = directory.get(c.other_user_id) || { username: c.name };
  const body = el("div", { className: "info person" },
    el("div", { className: "info-pic" }, withDot(userAvatar(u.username, u.image, "xl"), c.other_user_id)),
    el("div", { className: "info-text" },
      el("h3", {}, u.username),
      el("p", { className: "fh" }, isOnline(c.other_user_id) ? "Online now" : lastSeenText(u.last_seen)),
      u.role === "admin" ? el("p", { className: "fh" }, "Admin") : null));
  modal("Contact", body);
}

// shared with the profile dialog
async function squarePicture(file, size = 256) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn't a picture this browser can read"));
      i.src = url;
    });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    cv.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    return await new Promise((resolve) => cv.toBlob(resolve, "image/webp", 0.9));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- new direct chat ---------- */
const dlg = $("peopleDlg");
function renderPeople() {
  const q = $("peopleSearch").value.trim().toLowerCase();
  const shown = [...directory.values()]
    .filter((p) => p.status === "active" && p.id !== me.id && p.username.toLowerCase().includes(q))
    .sort((a, b) => a.username.localeCompare(b.username));
  $("people").replaceChildren(
    ...(shown.length
      ? shown.map((p) =>
          el("button", { className: "person", type: "button", onclick: () => startDirect(p.id) },
            withDot(userAvatar(p.username, p.image), p.id),
            el("span", { className: "pn" }, p.username, el("small", {}, isOnline(p.id) ? "Online" : lastSeenText(p.last_seen)))))
      : [el("p", { className: "hint" }, directory.size > 1 ? "No one matches that name." : "No other users yet. An admin can add people from the Admin page.")]),
  );
}

$("newChat").onclick = async () => {
  await loadDirectory().catch(() => {});
  $("peopleSearch").value = "";
  renderPeople();
  dlg.showModal();
  $("peopleSearch").focus();
};
$("peopleSearch").oninput = renderPeople;
$("closeDlg").onclick = () => dlg.close();
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

async function startDirect(userId) {
  try {
    const c = await api("POST", "/api/conversations/direct", { userId });
    dlg.close();
    await loadConversations();
    openConversation(c.id);
  } catch (e) {
    toast(e.message, true);
  }
}

/* =====================================================================
 * Notifications: sound, desktop pop-ups, tab title
 * ===================================================================== */
const Notify = {
  get mode() { return localStorage.getItem("sandes.notify") || "important"; },
  set mode(v) { localStorage.setItem("sandes.notify", v); },
  get sound() { return localStorage.getItem("sandes.notifySound") !== "off"; },
  set sound(v) { localStorage.setItem("sandes.notifySound", v ? "on" : "off"); },
  ctx: null,
  ding() {
    if (!this.sound) return;
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const t = this.ctx.currentTime;
      [[880, 0], [1320, 0.11]].forEach(([f, d]) => {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.35);
        o.connect(g).connect(this.ctx.destination);
        o.start(t + d);
        o.stop(t + d + 0.4);
      });
    } catch {}
  },
  canPopup: () => "Notification" in window && window.isSecureContext,
  popup(title, body, convId) {
    if (!this.canPopup() || Notification.permission !== "granted") return;
    try {
      const n = new Notification(title, { body, icon: "/dove.png", tag: `sandes-${convId}` });
      n.onclick = () => { window.focus(); openConversation(convId); n.close(); };
    } catch {}
  },
};
// browsers only allow sound after the first click/tap
document.addEventListener("pointerdown", () => {
  if (!Notify.ctx && Notify.sound) {
    try { Notify.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
}, { once: true });

function messageSummary(m) {
  if (m.kind === "poll") return `📊 ${m.message}`;
  return m.message || ((m.attachments || []).length ? "📎 Sent an attachment" : "");
}

function maybeNotify(m, c, mention) {
  if (!me || m.sender_id === me.id || m.kind === "system" || notified.has(m.id)) return;
  notified.add(m.id);
  const important = c.type === "direct" || mention;
  if (Notify.mode === "off" || (Notify.mode === "important" && !important)) return;
  const looking = !document.hidden && document.hasFocus() && activeId === c.id;
  if (looking) return;
  Notify.ding();
  if (document.hidden || !document.hasFocus()) {
    const title = c.type === "direct" ? m.sender : `${m.sender} in ${c.name}`;
    Notify.popup(mention ? `${title} mentioned you` : title, messageSummary(m), c.id);
  }
}

$("bellBtn").onclick = (e) => {
  const box = el("div", { className: "notif" }, el("div", { className: "pop-title" }, "Notifications"));
  const opt = (value, label, small) => {
    const r = el("input", { type: "radio", name: "nmode", value, checked: Notify.mode === value, onchange: () => (Notify.mode = value) });
    return el("label", { className: "radio" }, r, el("span", {}, el("b", {}, label), small ? el("small", {}, small) : null));
  };
  box.append(
    opt("all", "All new messages"),
    opt("important", "Direct messages and @mentions", "Recommended for busy rooms"),
    opt("off", "Nothing"),
    el("label", { className: "chk" }, el("input", { type: "checkbox", checked: Notify.sound, onchange: (ev) => { Notify.sound = ev.target.checked; if (ev.target.checked) Notify.ding(); } }), "Play a sound"),
  );
  if (!Notify.canPopup()) {
    box.append(el("p", { className: "fh" }, "Desktop pop-ups need Sandesh opened over https (or on this computer as localhost). The sound and the unread count in the tab still work."));
  } else if (Notification.permission === "default") {
    box.append(el("button", {
      type: "button", className: "pill-btn solid", textContent: "Allow desktop pop-ups",
      onclick: async () => { await Notification.requestPermission(); closePop(); toast(Notification.permission === "granted" ? "Desktop pop-ups are on" : "Pop-ups weren't allowed"); },
    }));
  } else if (Notification.permission === "denied") {
    box.append(el("p", { className: "fh" }, "Pop-ups are blocked for this site. Allow them in the browser's site settings."));
  } else {
    box.append(el("p", { className: "fh" }, "Desktop pop-ups are on while Sandesh is in the background."));
  }
  showPop(e.currentTarget, box, { above: true });
};

/* =====================================================================
 * Realtime
 * ===================================================================== */
const socket = io();

socket.on("message", async (m) => {
  let c = conv(m.conversation_id);
  if (!c) {
    await loadConversations().catch(() => {});
    c = conv(m.conversation_id);
    if (!c) return;
  }
  c.last_message = m.message;
  c.last_kind = m.kind;
  c.last_deleted = false;
  c.last_has_attachments = (m.attachments || []).length > 0;
  c.last_sender = m.sender;
  c.last_activity = m.timestamp;
  const t = typingIn.get(c.id);
  if (t) t.delete(m.sender_id);

  const mine = m.sender_id === me?.id;
  const mention = mentionsMe(m);
  if (m.conversation_id === activeId) {
    const wasStuck = stick;
    addMessage(m);
    if (wasStuck || mine) scrollDown();
    else if (!mine && m.kind !== "system") { newWhileUp++; syncToLatest(); }
    if (m.effect && !mine && !document.hidden) window.sandesEffects?.play(m.effect);
    markReadSoon();
    renderHeader();
  }
  const seenNow = m.conversation_id === activeId && !document.hidden && stick;
  if (!mine && m.kind !== "system" && !seenNow) {
    c.unread = (c.unread || 0) + 1;
    if (mention) c.mentioned = true;
  }
  maybeNotify(m, c, mention);
  renderSidebar();
});

socket.on("message:update", (m) => {
  const c = conv(m.conversation_id);
  if (c && loaded.length && m.conversation_id === activeId && loaded[loaded.length - 1].id === m.id) {
    c.last_message = m.message;
    c.last_deleted = !!m.deleted_at;
    renderSidebar();
  }
  if (m.conversation_id !== activeId) return;
  const i = loaded.findIndex((x) => x.id === m.id);
  if (i < 0) return;
  loaded[i] = m;
  byId.set(m.id, m);
  refreshRow(m.id);
  // quotes of this message elsewhere in the chat
  for (const x of loaded) if (x.reply_to && x.reply_to.id === m.id) {
    x.reply_to = { ...x.reply_to, message: m.message, deleted: !!m.deleted_at };
    refreshRow(x.id);
  }
  if (editingId === m.id && m.deleted_at) cancelCompose();
  if (replyTo === m.id && m.deleted_at) { replyTo = null; syncComposeBar(); }
  if ((state.pins || []).some((p) => p.message_id === m.id)) fetchState(activeId).then(renderPins).catch(() => {});
});

socket.on("reactions", ({ conversationId, messageId, reactions }) => {
  if (conversationId !== activeId) return;
  const m = byId.get(messageId);
  if (!m) return;
  m.reactions = reactions;
  refreshRow(messageId);
});

socket.on("poll", ({ conversationId, messageId, poll }) => {
  if (conversationId !== activeId) return;
  const m = byId.get(messageId);
  if (!m) return;
  m.poll = poll;
  refreshRow(messageId);
});

socket.on("pins", ({ conversationId, pins }) => {
  if (conversationId !== activeId) return;
  state.pins = pins;
  renderPins();
});

socket.on("read", ({ conversationId, userId, lastReadId }) => {
  if (userId === me?.id) {
    // read in another tab
    const c = conv(conversationId);
    if (c && lastReadId >= (c.last_read_id || 0)) {
      c.last_read_id = lastReadId;
      c.unread = 0;
      c.mentioned = false;
      renderSidebar();
    }
  }
  if (conversationId !== activeId) return;
  state.reads.set(userId, Math.max(state.reads.get(userId) || 0, lastReadId));
  updateReceipts();
});

socket.on("typing", ({ conversationId, userId, username, on }) => {
  if (!typingIn.has(conversationId)) typingIn.set(conversationId, new Map());
  const m = typingIn.get(conversationId);
  if (on) m.set(userId, { name: username, until: Date.now() + 4500 });
  else m.delete(userId);
  renderSidebar();
  if (conversationId === activeId) renderHeader();
});

socket.on("presence", ({ id, online, last_seen }) => {
  const u = directory.get(id);
  if (u) {
    u.online = online;
    if (last_seen) u.last_seen = last_seen;
  } else loadDirectory().catch(() => {});
  document.querySelectorAll(`.dot[data-presence="${id}"]`).forEach((d) => d.classList.toggle("on", online));
  if (activeConv()) renderHeader();
});

socket.on("mention", ({ conversationId, message }) => {
  const c = conv(conversationId);
  if (!c) return;
  if (conversationId !== activeId || document.hidden) { c.mentioned = true; renderSidebar(); }
  maybeNotify(message, c, true);
});

socket.on("task:assigned", ({ conversationId, title, by }) => {
  const c = conv(conversationId);
  toast(`${by} gave you a task${c ? ` in ${c.name}` : ""}: ${title}`);
  if (document.hidden && Notify.mode !== "off") {
    Notify.ding();
    Notify.popup(`New task from ${by}`, title, conversationId);
  }
});

socket.on("conversations:changed", async () => {
  await loadConversations().catch(() => {});
  if (activeId && !conv(activeId)) {
    toast("You're no longer in that chat");
    return goMain();
  }
  if (activeId) {
    await fetchState(activeId).catch(() => {});
    renderHeader();
    renderPins();
    syncComposer();
  }
});

socket.on("conversation:removed", async ({ id }) => {
  conversations = conversations.filter((c) => c.id !== id);
  renderSidebar();
  if (activeId === id) {
    toast("That group was closed or you were removed from it");
    goMain();
  }
});

function goMain() {
  const main = conversations.find((c) => c.slug === "main");
  if (main && matchMedia("(min-width: 761px)").matches) openConversation(main.id);
  else leaveConversationView();
}

socket.on("connect", () => {
  statusEl.textContent = "";
  syncComposer();
  // catch up on anything missed while disconnected
  if (me) {
    loadDirectory().then(() => activeConv() && renderHeader()).catch(() => {});
    loadConversations().catch(() => {});
  }
});
socket.on("disconnect", () => { statusEl.textContent = "Connection lost. Reconnecting…"; syncComposer(); });
socket.on("connect_error", (err) => {
  if (err && err.message === "Account turned off") return (location.href = "/login?error=inactive");
  statusEl.textContent = "Can't reach the server. Retrying…";
});
socket.on("error", (e) => { statusEl.textContent = typeof e === "string" ? e : "Message not sent. Try again."; });

/* ---------- account + settings ---------- */
socket.on("settings", applySettings);
socket.on("account:disabled", () => (location.href = "/login?error=inactive"));
socket.on("profile", (p) => { me = { ...me, ...p }; renderMe(); syncProfile(); });
socket.on("user:updated", async (u) => {
  const d = directory.get(u.id);
  if (d) { d.username = u.username; d.image = u.image; }
  if (me && u.id === me.id) { me.username = u.username; me.image = u.image; renderMe(); }
  document.querySelectorAll(`.from[data-uid="${u.id}"]`).forEach((n) => (n.textContent = u.username));
  document.querySelectorAll(`.mav[data-uid="${u.id}"]`).forEach((n) => {
    const av = userAvatar(u.username, u.image, "sm mav");
    av.dataset.uid = u.id;
    n.replaceWith(av);
  });
  await loadConversations().catch(() => {});
  if (activeConv()) renderHeader();
});

function applySettings(s) {
  settings = window.sandesSettings = s;
  window.sandesCrackers?.setEnabled(s.crackers_enabled);
  window.sandesBoard?.setEnabled(s.board_enabled);
  window.sandesThemes?.set(s.festival_theme);
  $("attachBtn").hidden = !s.attachments_enabled;
  if (!s.attachments_enabled && pendingFiles.length) { pendingFiles = []; renderPending(); }
  $("newChat").hidden = !s.direct_messages_enabled;
  $("newGroup").hidden = !s.users_can_create_groups && me && me.role !== "admin";
  if (!s.message_effects_enabled && pendingEffect) setEffect(null);
  syncComposer();
  syncProfile();
}

function renderMe() {
  if (!me) return;
  $("me").textContent = me.username;
  $("meAvatar").replaceChildren(userAvatar(me.username, me.image, "sm"));
  $("meSub").textContent = me.role === "admin" ? "Admin" : "Profile";
  $("adminLink").hidden = me.role !== "admin";
}

/* =====================================================================
 * Profile dialog
 * ===================================================================== */
const pdlg = $("profileDlg");
const say = (id, text, kind = "") => { const n = $(id); n.textContent = text; n.className = "pf-msg " + kind; };

function syncProfile() {
  if (!me) return;
  const admin = me.role === "admin";
  const canName = admin || settings.users_can_change_username !== false;
  const canPic = admin || settings.users_can_change_picture !== false;
  $("pfAvatar").replaceChildren(userAvatar(me.username, me.image, "lg"));
  $("pfName").textContent = me.username;
  $("pfUid").textContent = me.user_id || "";
  $("pfRole").textContent = admin ? "Admin" : "Member";
  $("pfPassUser").value = me.username;
  $("pfUsername").disabled = $("pfNameSave").disabled = !canName;
  $("pfNameNote").textContent = canName
    ? "You can sign in with your username or your user ID."
    : "Changing usernames is turned off by the admin.";
  $("pfPick").hidden = !canPic;
  $("pfRemove").hidden = !canPic || !me.image;
  if (!canPic) say("pfPicMsg", "Changing pictures is turned off by the admin.");
  else if ($("pfPicMsg").textContent.includes("turned off")) say("pfPicMsg", "");
}

$("meBtn").onclick = () => {
  ["pfPicMsg", "pfNameMsg", "pfPassMsg"].forEach((id) => say(id, ""));
  $("pfPassForm").reset();
  $("pfUsername").value = me.username;
  syncProfile();
  pdlg.showModal();
};
$("closeProfile").onclick = () => pdlg.close();
pdlg.addEventListener("click", (e) => { if (e.target === pdlg) pdlg.close(); });

$("pfFile").onchange = async () => {
  const file = $("pfFile").files[0];
  $("pfFile").value = "";
  if (!file) return;
  say("pfPicMsg", "Uploading…");
  try {
    const blob = await squarePicture(file);
    const fd = new FormData();
    fd.append("image", blob, blob.type === "image/webp" ? "avatar.webp" : "avatar.png");
    me = { ...me, ...(await api("POST", "/api/profile/image", fd)) };
    renderMe();
    syncProfile();
    say("pfPicMsg", "Picture updated", "ok");
  } catch (err) {
    say("pfPicMsg", err.message, "err");
  }
};

$("pfRemove").onclick = async () => {
  try {
    me = { ...me, ...(await api("DELETE", "/api/profile/image")) };
    renderMe();
    syncProfile();
    say("pfPicMsg", "Picture removed", "ok");
  } catch (err) {
    say("pfPicMsg", err.message, "err");
  }
};

$("pfNameForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("pfUsername").value.trim();
  if (username === me.username) return say("pfNameMsg", "That's already your username");
  try {
    me = { ...me, ...(await api("PUT", "/api/profile/username", { username })) };
    renderMe();
    syncProfile();
    say("pfNameMsg", "Username changed. Use it the next time you sign in.", "ok");
  } catch (err) {
    say("pfNameMsg", err.message, "err");
  }
});

$("pfPassForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("pfNew").value !== $("pfNew2").value) return say("pfPassMsg", "The two new passwords don't match", "err");
  try {
    await api("PUT", "/api/profile/password", { current: $("pfCur").value, password: $("pfNew").value });
    $("pfPassForm").reset();
    say("pfPassMsg", "Password changed", "ok");
  } catch (err) {
    say("pfPassMsg", err.message, "err");
  }
});

/* =====================================================================
 * For the other scripts (panels, board, effects)
 * ===================================================================== */
window.sandesChat = {
  activeConversation: activeConv,
  members: () => {
    const c = activeConv();
    if (c && c.type === "direct") return [directory.get(me.id), directory.get(c.other_user_id)].filter(Boolean);
    return state.members || [];
  },
  canWrite: () => state.member !== false,
  api,
  jumpTo,
  toast,
  ask,
  me: () => me,
  nameOf,
  userAvatar,
  ic,
  iconBtn,
  el,
};

/* =====================================================================
 * Boot (runs after every script on the page has loaded)
 * ===================================================================== */
window.addEventListener("DOMContentLoaded", async () => {
  const r = await fetch("/me");
  if (!r.ok) return (location.href = "/login");
  const { settings: s, ...profile } = await r.json();
  me = profile;
  renderMe();
  await Promise.all([loadDirectory(), loadConversations()]);
  applySettings(s);
  window.sandesCalendar?.start();
  const main = conversations.find((c) => c.slug === "main") || conversations[0];
  if (main && matchMedia("(min-width: 761px)").matches) openConversation(main.id);
});
