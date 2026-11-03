/* Sandes · shared drawing board
 *
 * One board per conversation, with pages. Everyone in the chat who opens it sees the same
 * drawing, live: other people's cursors and the shape they're drawing show up as they draw.
 * Shapes are saved on the server (board_items), so the board is still there after a reload.
 * While anyone in a chat has the board open, crackers are off there.
 *
 * Tools: select (move, resize, edit text), pen, line, arrow, box, circle, text, sticky note,
 * ready-made diagram shapes (database, server, user...), eraser, and moving the view.
 * Undo / redo cover your own changes.
 *
 * Coordinates are on a fixed 1600 x 1000 page, so the layout is identical on every screen;
 * each person can zoom and pan their own view.
 * Uses globals from chat.js: `socket`, `activeId`, `me`, `inkFor`.
 */
(() => {
  "use strict";

  const W = 1600, H = 1000;
  const NS = "http://www.w3.org/2000/svg";
  const chatEl = document.getElementById("chat");
  const chatHead = chatEl.querySelector(".chat-head");

  const COLORS = [
    ["#1b2a47", "Ink"], ["#b3303a", "Postal red"], ["#2f5d8a", "Blue"],
    ["#2e6b5a", "Green"], ["#c27a12", "Amber"], ["#7a3e6c", "Plum"],
  ];
  const WIDTHS = [[2, "Thin"], [4, "Medium"], [8, "Thick"]];
  const textSize = (w) => (w <= 2 ? 22 : w <= 4 ? 30 : 44);
  const STICKY_TEXT = 20;

  const ICONS = {
    select: '<path d="M5 3.5 19 11l-6.2 1.6L10 19z"/>',
    pen: '<path d="M3.5 20.5 7 19.6 19.2 7.4a1.9 1.9 0 0 0 0-2.6 1.9 1.9 0 0 0-2.6 0L4.4 17z"/><path d="m15.2 6.2 2.6 2.6"/>',
    line: '<path d="M5 19 19 5"/>',
    arrow: '<path d="M5 19 19 5"/><path d="M10 5h9v9"/>',
    rect: '<rect x="3.5" y="6" width="17" height="12" rx="2"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6.5"/>',
    text: '<path d="M5 7V4.5h14V7"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>',
    sticky: '<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/>',
    shapes: '<ellipse cx="7.5" cy="6" rx="4" ry="1.8"/><path d="M3.5 6v5c0 1 1.8 1.8 4 1.8s4-.8 4-1.8V6"/><rect x="13.5" y="3.5" width="7" height="9" rx="1.5"/><path d="M15.5 6.5h3M15.5 9.5h3"/><circle cx="12" cy="16" r="2"/><path d="M8 21c.6-2 2-3 4-3s3.4 1 4 3"/>',
    eraser: '<path d="M8.5 19.5H20"/><path d="m5.3 14.3 8.4-8.4a2 2 0 0 1 2.8 0l2.6 2.6a2 2 0 0 1 0 2.8L12 18.4H9.4z"/><path d="m9.5 10.1 5.4 5.4"/>',
    hand: '<path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5.5"/><path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 11.5V6a1.5 1.5 0 0 1 3 0v8c0 4-2.6 7-6.6 7-3 0-4.7-1.6-5.9-4.3L3.3 13a1.5 1.5 0 0 1 2.6-1.4L8 14.5"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="m6 7 1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    board: '<rect x="3" y="3.5" width="18" height="13" rx="2"/><path d="M8 21h8M12 16.5V21"/><path d="m7 12.5 3-3 2.5 2 4-4"/>',
    fill: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 13.5 13.5 5H18a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2z" fill="currentColor" stroke="none" opacity=".35"/>',
    minus: '<path d="M6 12h12"/>',
    plus: '<path d="M6 12h12M12 6v12"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  };

  const TOOLS = [
    ["select", "Select, move and resize", "V"], ["pen", "Pen", "P"], ["line", "Line", "L"], ["arrow", "Arrow", "A"],
    ["rect", "Box", "R"], ["ellipse", "Circle", "O"], ["text", "Text", "T"], ["sticky", "Sticky note", "S"],
    ["shapes", "Diagram shapes", "K"], ["eraser", "Eraser", "E"], ["hand", "Move the view", "H"],
  ];

  // Ready-made diagram shapes: [kind, label, default width, default height]
  const SHAPES = [
    ["db", "Database", 110, 120], ["server", "Server", 110, 130], ["user", "User", 90, 110],
    ["cloud", "Cloud", 160, 100], ["diamond", "Decision", 140, 110], ["doc", "Document", 100, 125],
    ["laptop", "Laptop", 150, 100], ["phone", "Phone", 70, 120], ["queue", "Queue", 160, 70], ["lock", "Security", 90, 110],
  ];
  const shapeInfo = (k) => SHAPES.find((s) => s[0] === k) || SHAPES[0];

  const rand = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const now = () => performance.now();
  const colorFor = (name) => (typeof inkFor === "function" ? inkFor(name || "") : "#2f5d8a");
  const myName = () => (typeof me !== "undefined" && me ? me.username : "");
  const round1 = (v) => Math.round(v * 10) / 10;

  // pale version of a colour, for sticky notes and filled shapes
  function pastel(hex, k = 0.78) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(c + (255 - c) * k);
    return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
  }
  const STICKY_FILL = { "#1b2a47": "#fff3a3", "#b3303a": "#ffd9dc", "#2f5d8a": "#d6e8fb", "#2e6b5a": "#d5f2e3", "#c27a12": "#ffe3bf", "#7a3e6c": "#f0dcf0" };
  const stickyFill = (c) => STICKY_FILL[c] || pastel(c, 0.8);

  function icon(name) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.9");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = ICONS[name];
    return s;
  }

  function mk(tag, cls, props = {}) {
    const n = Object.assign(document.createElement(tag), props);
    if (cls) n.className = cls;
    return n;
  }

  function iconBtn(name, label, cls = "bd-btn") {
    const b = mk("button", cls, { type: "button", title: label });
    b.setAttribute("aria-label", label);
    b.append(icon(name));
    return b;
  }

  /* =====================================================================
   * DOM
   * ===================================================================== */

  // Header button: "Board", with a live count when people are on it
  const headBtn = mk("button", "board-btn", { type: "button", title: "Shared drawing board" });
  headBtn.setAttribute("aria-pressed", "false");
  const headLive = mk("span", "board-live");
  headLive.hidden = true;
  headBtn.append(icon("board"), mk("span", "lbl", { textContent: "Board" }), headLive);
  (document.getElementById("headTools") || chatHead).append(headBtn);

  // Someone else opened the board
  const invite = mk("div", "bd-invite");
  invite.hidden = true;
  const inviteText = mk("span");
  const inviteOpen = mk("button", "bd-invite-open", { type: "button", textContent: "Open board" });
  const inviteX = iconBtn("close", "Dismiss", "bd-invite-x");
  invite.append(icon("board"), inviteText, inviteOpen, inviteX);
  chatEl.append(invite);

  const panel = mk("section", "board");
  panel.hidden = true;
  panel.setAttribute("aria-label", "Shared drawing board");

  const bar = mk("div", "bd-bar");
  const toolGroup = mk("div", "bd-group");
  toolGroup.setAttribute("role", "toolbar");
  toolGroup.setAttribute("aria-label", "Drawing tools");
  const toolBtns = {};
  for (const [id, label, key] of TOOLS) {
    const b = iconBtn(id, `${label} (${key})`);
    b.dataset.tool = id;
    b.onclick = () => (id === "shapes" ? openShapePicker() : setTool(id));
    toolBtns[id] = b;
    toolGroup.append(b);
  }

  const colorGroup = mk("div", "bd-group");
  const colorBtns = COLORS.map(([c, name]) => {
    const b = mk("button", "bd-swatch", { type: "button", title: name });
    b.setAttribute("aria-label", name);
    b.style.setProperty("--sw", c);
    b.onclick = () => { style.c = c; syncBar(); restyleSelected({ c }); };
    colorGroup.append(b);
    return [c, b];
  });

  const widthGroup = mk("div", "bd-group");
  const widthBtns = WIDTHS.map(([w, name]) => {
    const b = mk("button", "bd-btn bd-width", { type: "button", title: `${name} line / ${name.toLowerCase()} text` });
    b.setAttribute("aria-label", name);
    b.append(mk("i", "", { style: `width:${w + 3}px;height:${w + 3}px` }));
    b.onclick = () => { style.w = w; syncBar(); restyleSelected({ w }); };
    widthGroup.append(b);
    return [w, b];
  });
  const fillBtn = iconBtn("fill", "Fill boxes, circles and shapes");
  fillBtn.onclick = () => { style.f = !style.f; syncBar(); restyleSelected({ f: style.f }); };
  widthGroup.append(fillBtn);

  const actGroup = mk("div", "bd-group");
  const undoBtn = iconBtn("undo", "Undo (Ctrl+Z)");
  const redoBtn = iconBtn("redo", "Redo (Ctrl+Y)");
  const clearBtn = iconBtn("trash", "Clear this page for everyone");
  const sendBtn = iconBtn("send", "Send a picture of this page to the chat");
  actGroup.append(undoBtn, redoBtn, clearBtn, sendBtn);

  const people = mk("div", "bd-people");
  const closeBtn = iconBtn("close", "Close the board", "bd-btn bd-close");
  bar.append(toolGroup, colorGroup, widthGroup, actGroup, people, closeBtn);

  const stage = mk("div", "bd-stage");
  const canvas = mk("canvas", "bd-canvas");
  canvas.setAttribute("aria-label", "Drawing area");
  const ctx = canvas.getContext("2d");
  const textBox = mk("textarea", "bd-textbox", { rows: 1, spellcheck: false, placeholder: "Type, Enter to place" });
  textBox.hidden = true;
  const zoomBar = mk("div", "bd-zoom");
  const zOut = iconBtn("minus", "Zoom out");
  const zLabel = mk("button", "bd-zlabel", { type: "button", title: "Fit the page" });
  const zIn = iconBtn("plus", "Zoom in");
  const zFit = iconBtn("fit", "Fit the page");
  zoomBar.append(zOut, zLabel, zIn, zFit);
  const pagesBar = mk("div", "bd-pages");
  const shapePop = mk("div", "bd-shapes");
  shapePop.hidden = true;
  const toast = mk("div", "bd-toast", { role: "status" });
  toast.hidden = true;
  const ticker = mk("div", "bd-ticker");
  ticker.hidden = true;
  const loading = mk("div", "bd-loading", { textContent: "Opening the board…" });
  stage.append(canvas, textBox, zoomBar, pagesBar, shapePop, toast, ticker, loading);

  panel.append(bar, stage);
  chatEl.append(panel);

  /* =====================================================================
   * State
   * ===================================================================== */
  let conv = null;                 // conversation id the board is open for (null = closed)
  let pages = [];                  // [{ id, name }]
  let page = null;                 // page id on screen
  let items = new Map();           // id -> item (all pages), in drawing order
  let history = [], future = [];   // your changes, for undo / redo
  let tool = "pen";
  let shapeKind = "db";
  const style = { c: COLORS[0][0], w: 4, f: false };
  let draft = null;                // what I'm drawing right now
  let sentLen = 0;                 // how much of my pen draft the others have
  let lastLive = 0;
  const remote = new Map();        // socket id -> { by, page, x, y, t, draft }
  const presence = {};             // conversation id -> [usernames on the board]
  let view = { s: 1, ox: 0, oy: 0 };
  let fitted = true;               // follow the panel size until the user zooms/pans
  let sw = 0, sh = 0, dpr = 1;
  let me_ptr = null;               // my pointer in screen px (for the eraser ring)
  let editor = null;               // { mode: "new", at } | { mode: "edit", id }
  let spaceDown = false;
  let selected = null;             // id of the selected item
  let drag = null;                 // { kind: "move" | "handle", ... }

  const onPage = (it) => it.page === page;
  const pageItems = () => [...items.values()].filter(onPage);

  /* ---------- view ---------- */
  const fitScale = () => Math.min(sw / W, sh / H) * 0.95;
  function fit() {
    const s = fitScale();
    view = { s, ox: (sw - W * s) / 2, oy: (sh - H * s) / 2 - 12 };
    fitted = true;
    syncZoom();
    invalidate();
  }
  function zoomAt(f, cx = sw / 2, cy = sh / 2) {
    const s = clamp(view.s * f, fitScale() * 0.5, 6);
    const k = s / view.s;
    view = { s, ox: cx - (cx - view.ox) * k, oy: cy - (cy - view.oy) * k };
    fitted = false;
    syncZoom();
    invalidate();
  }
  const toWorld = (x, y) => [(x - view.ox) / view.s, (y - view.oy) / view.s];
  const toScreen = (x, y) => [x * view.s + view.ox, y * view.s + view.oy];
  function syncZoom() {
    zLabel.textContent = `${Math.round((view.s / (fitScale() || 1)) * 100)}%`;
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    sw = r.width;
    sh = r.height;
    canvas.width = Math.round(sw * dpr);
    canvas.height = Math.round(sh * dpr);
    canvas.style.width = sw + "px";
    canvas.style.height = sh + "px";
    if (fitted) fit();
    else { syncZoom(); invalidate(); }
    if (editor) placeEditor();
  }
  new ResizeObserver(resize).observe(stage);

  /* =====================================================================
   * Drawing
   * ===================================================================== */
  function pathPen(c, p) {
    c.beginPath();
    c.moveTo(p[0], p[1]);
    if (p.length === 2) { c.lineTo(p[0] + 0.01, p[1]); return; }
    let i = 2;
    for (; i < p.length - 2; i += 2) {
      const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
      c.quadraticCurveTo(p[i], p[i + 1], mx, my);
    }
    c.lineTo(p[i], p[i + 1]);
  }

  function boxOf(p) {
    return [Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.abs(p[2] - p[0]), Math.abs(p[3] - p[1])];
  }

  function arrowHead(it) {
    const [x1, y1, x2, y2] = it.p;
    const a = Math.atan2(y2 - y1, x2 - x1);
    const len = Math.min(Math.hypot(x2 - x1, y2 - y1) * 0.6, 12 + it.w * 3);
    const spread = 0.42;
    return {
      a, len,
      pts: [x2, y2,
        x2 - len * Math.cos(a - spread), y2 - len * Math.sin(a - spread),
        x2 - len * Math.cos(a + spread), y2 - len * Math.sin(a + spread)],
    };
  }

  const FONT = (size, weight = 600) => `${weight} ${size}px Figtree, system-ui, sans-serif`;

  function textBox_(c, it) {
    const size = textSize(it.w);
    c.font = FONT(size);
    const lines = (it.s || "").split("\n");
    const lh = size * 1.25;
    let mw = 0;
    for (const l of lines) mw = Math.max(mw, c.measureText(l).width);
    return { size, lines, lh, bb: [it.p[0], it.p[1], Math.max(mw, 8), lines.length * lh] };
  }

  // word-wrap text to a width (for sticky notes and shape labels)
  function wrap(c, text, maxW) {
    const out = [];
    for (const para of (text || "").split("\n")) {
      let line = "";
      for (const word of para.split(/(\s+)/)) {
        const next = line + word;
        if (c.measureText(next).width > maxW && line.trim()) {
          out.push(line.trimEnd());
          line = word.trimStart();
          // a single very long word: hard-break it
          while (c.measureText(line).width > maxW && line.length > 1) {
            let k = line.length - 1;
            while (k > 1 && c.measureText(line.slice(0, k)).width > maxW) k--;
            out.push(line.slice(0, k));
            line = line.slice(k);
          }
        } else line = next;
      }
      out.push(line);
    }
    return out;
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r);
    else c.rect(x, y, w, h);
  }

  function shapeLabel(c, it, x, y, w, h) {
    if (!it.s) return;
    c.font = FONT(18);
    c.fillStyle = "#1b2a47";
    c.textAlign = "center";
    c.textBaseline = "top";
    const lines = wrap(c, it.s, Math.max(w + 60, 120));
    lines.slice(0, 4).forEach((l, i) => c.fillText(l, x + w / 2, y + h + 8 + i * 22));
    c.textAlign = "start";
  }

  // The diagram shapes, drawn inside their box
  function drawShape(c, it) {
    const [x, y, w, h] = boxOf(it.p);
    if (w < 2 || h < 2) return;
    const fill = it.f ? pastel(it.c, 0.82) : "#ffffff";
    c.lineWidth = Math.max(1.5, it.w * 0.75);
    c.strokeStyle = it.c;
    c.fillStyle = fill;
    const cx = x + w / 2;
    switch (it.k) {
      case "db": {
        const ry = Math.min(h * 0.14, w * 0.25);
        c.beginPath();
        c.moveTo(x, y + ry);
        c.lineTo(x, y + h - ry);
        c.ellipse(cx, y + h - ry, w / 2, ry, 0, Math.PI, 0, true);
        c.lineTo(x + w, y + ry);
        c.ellipse(cx, y + ry, w / 2, ry, 0, 0, Math.PI, true);
        c.closePath();
        c.fill();
        c.stroke();
        c.beginPath();
        c.ellipse(cx, y + ry, w / 2, ry, 0, 0, Math.PI * 2);
        c.stroke();
        c.beginPath();
        c.ellipse(cx, y + h * 0.4, w / 2, ry, 0, 0, Math.PI);
        c.stroke();
        break;
      }
      case "server": {
        roundRect(c, x, y, w, h, Math.min(10, w / 8));
        c.fill();
        c.stroke();
        const n = 3, gap = h / n;
        for (let i = 0; i < n; i++) {
          const yy = y + gap * i + gap / 2;
          if (i) { c.beginPath(); c.moveTo(x, y + gap * i); c.lineTo(x + w, y + gap * i); c.stroke(); }
          c.beginPath();
          c.moveTo(x + w * 0.14, yy);
          c.lineTo(x + w * 0.55, yy);
          c.stroke();
          c.save();
          c.fillStyle = i === 0 ? "#2fa36b" : it.c;
          c.beginPath();
          c.arc(x + w * 0.8, yy, Math.max(2.5, Math.min(w, gap) * 0.06), 0, Math.PI * 2);
          c.fill();
          c.restore();
        }
        break;
      }
      case "user": {
        const r = Math.min(w * 0.24, h * 0.22);
        c.beginPath();
        c.arc(cx, y + r + 2, r, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.beginPath();
        const top = y + r * 2 + h * 0.08;
        c.moveTo(x + w * 0.08, y + h);
        c.bezierCurveTo(x + w * 0.08, top + (y + h - top) * 0.15, x + w * 0.26, top, cx, top);
        c.bezierCurveTo(x + w * 0.74, top, x + w * 0.92, top + (y + h - top) * 0.15, x + w * 0.92, y + h);
        c.closePath();
        c.fill();
        c.stroke();
        break;
      }
      case "cloud": {
        c.beginPath();
        c.moveTo(x + w * 0.2, y + h * 0.9);
        c.bezierCurveTo(x - w * 0.05, y + h * 0.9, x - w * 0.04, y + h * 0.48, x + w * 0.18, y + h * 0.5);
        c.bezierCurveTo(x + w * 0.14, y + h * 0.12, x + w * 0.5, y + h * 0.02, x + w * 0.56, y + h * 0.3);
        c.bezierCurveTo(x + w * 0.66, y + h * 0.08, x + w * 0.96, y + h * 0.2, x + w * 0.86, y + h * 0.5);
        c.bezierCurveTo(x + w * 1.05, y + h * 0.55, x + w * 1.02, y + h * 0.92, x + w * 0.8, y + h * 0.9);
        c.closePath();
        c.fill();
        c.stroke();
        break;
      }
      case "diamond":
        c.beginPath();
        c.moveTo(cx, y);
        c.lineTo(x + w, y + h / 2);
        c.lineTo(cx, y + h);
        c.lineTo(x, y + h / 2);
        c.closePath();
        c.fill();
        c.stroke();
        break;
      case "doc": {
        const f = Math.min(w, h) * 0.22;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + w - f, y);
        c.lineTo(x + w, y + f);
        c.lineTo(x + w, y + h);
        c.lineTo(x, y + h);
        c.closePath();
        c.fill();
        c.stroke();
        c.beginPath();
        c.moveTo(x + w - f, y);
        c.lineTo(x + w - f, y + f);
        c.lineTo(x + w, y + f);
        c.stroke();
        for (let i = 0; i < 4; i++) {
          const yy = y + h * (0.38 + i * 0.14);
          c.beginPath();
          c.moveTo(x + w * 0.16, yy);
          c.lineTo(x + w * (i === 3 ? 0.55 : 0.84), yy);
          c.stroke();
        }
        break;
      }
      case "laptop": {
        roundRect(c, x + w * 0.12, y, w * 0.76, h * 0.72, 6);
        c.fill();
        c.stroke();
        roundRect(c, x + w * 0.18, y + h * 0.08, w * 0.64, h * 0.56, 3);
        c.save();
        c.fillStyle = pastel(it.c, 0.88);
        c.fill();
        c.restore();
        c.beginPath();
        c.moveTo(x + w * 0.04, y + h * 0.8);
        c.lineTo(x + w * 0.96, y + h * 0.8);
        c.lineTo(x + w, y + h);
        c.lineTo(x, y + h);
        c.closePath();
        c.fill();
        c.stroke();
        break;
      }
      case "phone": {
        roundRect(c, x, y, w, h, Math.min(w, h) * 0.16);
        c.fill();
        c.stroke();
        c.beginPath();
        c.moveTo(cx - w * 0.14, y + h * 0.07);
        c.lineTo(cx + w * 0.14, y + h * 0.07);
        c.stroke();
        c.beginPath();
        c.arc(cx, y + h * 0.9, Math.max(2.5, w * 0.06), 0, Math.PI * 2);
        c.stroke();
        break;
      }
      case "queue": {
        roundRect(c, x, y, w, h, Math.min(h / 2, 14));
        c.fill();
        c.stroke();
        const n = 4;
        for (let i = 1; i < n; i++) {
          const xx = x + (w / n) * i;
          c.beginPath();
          c.moveTo(xx, y + h * 0.18);
          c.lineTo(xx, y + h * 0.82);
          c.stroke();
        }
        break;
      }
      case "lock": {
        const bw = w * 0.84, bh = h * 0.52, bx = x + (w - bw) / 2, by = y + h - bh;
        c.beginPath();
        c.moveTo(x + w * 0.26, by);
        c.lineTo(x + w * 0.26, y + h * 0.28);
        c.arc(cx, y + h * 0.28, w * 0.24, Math.PI, 0);
        c.lineTo(x + w * 0.74, by);
        c.lineWidth = Math.max(2, it.w * 1.2);
        c.stroke();
        c.lineWidth = Math.max(1.5, it.w * 0.75);
        roundRect(c, bx, by, bw, bh, 8);
        c.fill();
        c.stroke();
        c.save();
        c.fillStyle = it.c;
        c.beginPath();
        c.arc(cx, by + bh * 0.42, Math.max(3, bw * 0.08), 0, Math.PI * 2);
        c.fill();
        c.fillRect(cx - Math.max(1.5, bw * 0.03), by + bh * 0.42, Math.max(3, bw * 0.06), bh * 0.3);
        c.restore();
        break;
      }
    }
    shapeLabel(c, it, x, y, w, h);
  }

  function drawSticky(c, it) {
    const [x, y, w, h] = boxOf(it.p);
    if (w < 4 || h < 4) return;
    const fold = Math.min(22, w * 0.18, h * 0.18);
    c.save();
    c.shadowColor = "rgba(27, 42, 71, 0.22)";
    c.shadowBlur = 14;
    c.shadowOffsetY = 5;
    c.fillStyle = stickyFill(it.c);
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + w, y);
    c.lineTo(x + w, y + h - fold);
    c.lineTo(x + w - fold, y + h);
    c.lineTo(x, y + h);
    c.closePath();
    c.fill();
    c.restore();
    c.fillStyle = "rgba(27, 42, 71, 0.10)";
    c.beginPath();
    c.moveTo(x + w, y + h - fold);
    c.lineTo(x + w - fold, y + h - fold);
    c.lineTo(x + w - fold, y + h);
    c.closePath();
    c.fill();
    // coloured strip along the top
    c.fillStyle = it.c;
    c.globalAlpha *= 0.85;
    c.fillRect(x, y, w, 5);
    c.globalAlpha /= 0.85;
    if (it.s) {
      c.font = FONT(STICKY_TEXT, 500);
      c.fillStyle = "#1b2a47";
      c.textBaseline = "top";
      const pad = 14;
      const lines = wrap(c, it.s, w - pad * 2);
      const lh = STICKY_TEXT * 1.3;
      const max = Math.max(1, Math.floor((h - pad * 2 - 4) / lh));
      lines.slice(0, max).forEach((l, i) => {
        const last = i === max - 1 && lines.length > max;
        c.fillText(last ? l.replace(/.{0,2}$/, "…") : l, x + pad, y + pad + 6 + i * lh);
      });
    }
  }

  function drawItem(c, it) {
    c.strokeStyle = it.c;
    c.fillStyle = it.c;
    c.lineWidth = it.w;
    c.lineCap = "round";
    c.lineJoin = "round";
    const p = it.p;
    switch (it.t) {
      case "pen":
        pathPen(c, p);
        c.stroke();
        break;
      case "line":
        c.beginPath();
        c.moveTo(p[0], p[1]);
        c.lineTo(p[2], p[3]);
        c.stroke();
        break;
      case "arrow": {
        const h = arrowHead(it);
        c.beginPath();
        c.moveTo(p[0], p[1]);
        // stop the shaft inside the head so the tip stays sharp
        c.lineTo(p[2] - Math.cos(h.a) * h.len * 0.6, p[3] - Math.sin(h.a) * h.len * 0.6);
        c.stroke();
        c.beginPath();
        c.moveTo(h.pts[0], h.pts[1]);
        c.lineTo(h.pts[2], h.pts[3]);
        c.lineTo(h.pts[4], h.pts[5]);
        c.closePath();
        c.lineWidth = Math.max(1, it.w * 0.6);
        c.fill();
        c.stroke();
        break;
      }
      case "rect": {
        const [x, y, w, h] = boxOf(p);
        roundRect(c, x, y, w, h, Math.min(10, w / 4, h / 4));
        if (it.f) { c.globalAlpha *= 0.14; c.fill(); c.globalAlpha /= 0.14; }
        c.stroke();
        break;
      }
      case "ellipse": {
        const [x, y, w, h] = boxOf(p);
        if (w < 0.5 && h < 0.5) break;
        c.beginPath();
        c.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 0.5), Math.max(h / 2, 0.5), 0, 0, Math.PI * 2);
        if (it.f) { c.globalAlpha *= 0.14; c.fill(); c.globalAlpha /= 0.14; }
        c.stroke();
        break;
      }
      case "text": {
        if (!it.s) break;
        const t = textBox_(c, it);
        it._bb = t.bb;
        c.textBaseline = "top";
        t.lines.forEach((l, i) => c.fillText(l, p[0], p[1] + i * t.lh + t.size * 0.08));
        break;
      }
      case "sticky":
        drawSticky(c, it);
        break;
      case "shape":
        drawShape(c, it);
        break;
    }
  }

  function drawGrid(c) {
    const step = view.s * 40 >= 9 ? 40 : 80;
    c.fillStyle = "rgba(27, 42, 71, 0.13)";
    const r = 1.4 / view.s;
    for (let x = step; x < W; x += step) {
      for (let y = step; y < H; y += step) c.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  let raf = 0;
  function invalidate() {
    if (!raf && conv != null) raf = requestAnimationFrame(draw);
  }

  function draw() {
    raf = 0;
    if (conv == null || !sw) return;
    const t = now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#dbe4ed";
    ctx.fillRect(0, 0, sw, sh);

    ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.ox, dpr * view.oy);
    // the sheet of paper
    ctx.save();
    ctx.shadowColor = "rgba(27, 42, 71, 0.18)";
    ctx.shadowBlur = 24 * view.s * dpr;
    ctx.shadowOffsetY = 6 * view.s * dpr;
    ctx.fillStyle = "#fbfcfd";
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    drawGrid(ctx);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    for (const it of items.values()) {
      if (!onPage(it)) continue;
      if (editor && editor.mode === "edit" && editor.id === it.id && it.t === "text") continue;
      drawItem(ctx, it);
    }
    ctx.globalAlpha = 0.75;
    for (const r of remote.values()) if (r.page === page && r.draft && r.draft.p.length >= 2) drawItem(ctx, r.draft);
    ctx.globalAlpha = 1;
    if (draft) drawItem(ctx, draft);
    ctx.restore();

    // selection box + handles (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sel = selected && items.get(selected);
    if (sel && onPage(sel)) drawSelection(sel);

    let fading = false;
    for (const r of remote.values()) {
      if (r.x == null || r.page !== page) continue;
      const age = (t - r.t) / 1000;
      const a = age < 4 ? 1 : Math.max(0, 1 - (age - 4) / 1.5);
      if (a <= 0) continue;
      fading = true;
      const [x, y] = toScreen(r.x, r.y);
      const col = colorFor(r.by);
      ctx.globalAlpha = a;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 3.5, y + 13);
      ctx.lineTo(x + 6.5, y + 8.5);
      ctx.lineTo(x + 12, y + 8);
      ctx.closePath();
      ctx.fill();
      ctx.font = "600 11px Figtree, system-ui, sans-serif";
      const tw = ctx.measureText(r.by).width;
      roundRect(ctx, x + 10, y + 12, tw + 14, 19, 10);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(r.by, x + 17, y + 22);
    }
    ctx.globalAlpha = 1;
    if (tool === "eraser" && me_ptr) {
      ctx.strokeStyle = "rgba(27, 42, 71, 0.55)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(me_ptr[0], me_ptr[1], 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (fading) raf = requestAnimationFrame(draw); // keep fading idle cursors out
  }

  /* =====================================================================
   * Geometry: bounds, hit testing, handles
   * ===================================================================== */
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l = dx * dx + dy * dy;
    const k = l ? clamp(((px - x1) * dx + (py - y1) * dy) / l, 0, 1) : 0;
    return Math.hypot(px - (x1 + k * dx), py - (y1 + k * dy));
  }

  /** [x, y, w, h] of an item in board units */
  function bounds(it) {
    const p = it.p;
    if (it.t === "text") return it._bb || textBox_(ctx, it).bb;
    if (it.t === "pen") {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        x1 = Math.min(x1, p[i]); x2 = Math.max(x2, p[i]);
        y1 = Math.min(y1, p[i + 1]); y2 = Math.max(y2, p[i + 1]);
      }
      return [x1, y1, x2 - x1, y2 - y1];
    }
    return boxOf(p);
  }

  function labelBounds(it) {
    const b = boxOf(it.p);
    if (!it.s) return b;
    ctx.font = FONT(18);
    const lines = Math.min(4, wrap(ctx, it.s, Math.max(b[2] + 60, 120)).length);
    return [b[0] - 30, b[1], b[2] + 60, b[3] + 10 + lines * 22];
  }

  function hits(it, x, y, r) {
    const p = it.p, rr = r + it.w / 2;
    const inBox = ([bx, by, bw, bh], pad = 0) => x >= bx - pad && x <= bx + bw + pad && y >= by - pad && y <= by + bh + pad;
    switch (it.t) {
      case "pen":
        if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= rr;
        for (let i = 0; i < p.length - 2; i += 2) if (segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= rr) return true;
        return false;
      case "line":
      case "arrow":
        return segDist(x, y, p[0], p[1], p[2], p[3]) <= rr;
      case "rect": {
        const [bx, by, w, h] = boxOf(p);
        if (it.f && inBox([bx, by, w, h])) return true;
        return (
          segDist(x, y, bx, by, bx + w, by) <= rr || segDist(x, y, bx + w, by, bx + w, by + h) <= rr ||
          segDist(x, y, bx + w, by + h, bx, by + h) <= rr || segDist(x, y, bx, by + h, bx, by) <= rr
        );
      }
      case "ellipse": {
        const [bx, by, w, h] = boxOf(p);
        const cx = bx + w / 2, cy = by + h / 2, rx = Math.max(w / 2, 0.5), ry = Math.max(h / 2, 0.5);
        if (it.f && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) return true;
        let px = cx + rx, py = cy;
        for (let i = 1; i <= 48; i++) {
          const a = (i / 48) * Math.PI * 2, nx = cx + rx * Math.cos(a), ny = cy + ry * Math.sin(a);
          if (segDist(x, y, px, py, nx, ny) <= rr) return true;
          px = nx;
          py = ny;
        }
        return false;
      }
      case "text":
        return inBox(bounds(it), r);
      case "sticky":
        return inBox(boxOf(p), r);
      case "shape":
        return inBox(labelBounds(it), r);
    }
    return false;
  }

  /** the topmost item under a point on this page */
  function itemAt(x, y, r) {
    const list = pageItems();
    for (let i = list.length - 1; i >= 0; i--) if (hits(list[i], x, y, r)) return list[i];
    return null;
  }

  const resizable = (it) => it.t !== "text";
  const isEndpoints = (it) => it.t === "line" || it.t === "arrow";

  /** handle positions in screen px: [{ id, x, y }] */
  function handles(it) {
    if (!resizable(it)) return [];
    if (isEndpoints(it)) {
      const [ax, ay] = toScreen(it.p[0], it.p[1]), [bx, by] = toScreen(it.p[2], it.p[3]);
      return [{ id: "a", x: ax, y: ay }, { id: "b", x: bx, y: by }];
    }
    const [x, y, w, h] = bounds(it);
    const [x1, y1] = toScreen(x, y), [x2, y2] = toScreen(x + w, y + h);
    return [{ id: "nw", x: x1, y: y1 }, { id: "ne", x: x2, y: y1 }, { id: "se", x: x2, y: y2 }, { id: "sw", x: x1, y: y2 }];
  }

  function drawSelection(it) {
    const b = it.t === "shape" ? labelBounds(it) : bounds(it);
    const pad = 6;
    const [x1, y1] = toScreen(b[0], b[1]), [x2, y2] = toScreen(b[0] + b[2], b[1] + b[3]);
    ctx.strokeStyle = "#2f5d8a";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    if (!isEndpoints(it)) ctx.strokeRect(x1 - pad, y1 - pad, x2 - x1 + pad * 2, y2 - y1 + pad * 2);
    ctx.setLineDash([]);
    for (const h of handles(it)) {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#2f5d8a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(h.x - 5, h.y - 5, 10, 10);
      ctx.fill();
      ctx.stroke();
    }
  }

  function handleAt(sx, sy) {
    const it = selected && items.get(selected);
    if (!it || !onPage(it)) return null;
    const touch = 12;
    return handles(it).find((h) => Math.abs(h.x - sx) <= touch && Math.abs(h.y - sy) <= touch) || null;
  }

  // apply a move / resize to a copy of the item as it was when the drag started
  function moved(orig, dx, dy) {
    const p = orig.p.map((v, i) => round1(v + (i % 2 ? dy : dx)));
    return { ...orig, p };
  }

  function resized(orig, handle, wx, wy, keepRatio) {
    if (isEndpoints(orig)) {
      const p = orig.p.slice();
      if (handle === "a") { p[0] = round1(wx); p[1] = round1(wy); }
      else { p[2] = round1(wx); p[3] = round1(wy); }
      return { ...orig, p };
    }
    const [x, y, w, h] = bounds(orig);
    let x1 = x, y1 = y, x2 = x + w, y2 = y + h;
    if (handle.includes("w")) x1 = wx; else x2 = wx;
    if (handle.includes("n")) y1 = wy; else y2 = wy;
    const min = orig.t === "pen" ? 4 : 16;
    if (Math.abs(x2 - x1) < min) { if (handle.includes("w")) x1 = x2 - min; else x2 = x1 + min; }
    if (Math.abs(y2 - y1) < min) { if (handle.includes("n")) y1 = y2 - min; else y2 = y1 + min; }
    if (keepRatio && w && h) {
      const k = Math.max(Math.abs(x2 - x1) / w, Math.abs(y2 - y1) / h);
      if (handle.includes("w")) x1 = x2 - w * k; else x2 = x1 + w * k;
      if (handle.includes("n")) y1 = y2 - h * k; else y2 = y1 + h * k;
    }
    if (orig.t === "pen") {
      // scale every point from the old box into the new one
      const sx = w ? (x2 - x1) / w : 1, sy = h ? (y2 - y1) / h : 1;
      const p = orig.p.map((v, i) => round1(i % 2 ? y1 + (v - y) * sy : x1 + (v - x) * sx));
      return { ...orig, p };
    }
    return { ...orig, p: [round1(Math.min(x1, x2)), round1(Math.min(y1, y2)), round1(Math.max(x1, x2)), round1(Math.max(y1, y2))] };
  }

  /* =====================================================================
   * Saving + live updates + history
   * ===================================================================== */
  const wire = (it) => {
    const { by, _bb, o, ...rest } = it;
    return rest;
  };

  function saveNew(it, record = true) {
    it.by = myName();
    it.page = it.page || page;
    items.set(it.id, it);
    if (record) { history.push({ t: "add", item: { ...it } }); future = []; }
    invalidate();
    socket.emit("board:add", { conversationId: conv, item: wire(it) }, (res) => {
      if (res && res.ok) return;
      items.delete(it.id);
      if (selected === it.id) selected = null;
      invalidate();
      showToast(res && res.full ? "The board is full. Clear some of it first." : "That shape wasn't saved. Try again.");
    });
  }

  let lastUpdate = 0, pendingUpdate = null;
  function saveUpdate(it, throttle = false) {
    items.set(it.id, it);
    invalidate();
    if (throttle && now() - lastUpdate < 90) {
      pendingUpdate = it;
      return;
    }
    lastUpdate = now();
    pendingUpdate = null;
    socket.emit("board:update", { conversationId: conv, item: wire(it) });
  }

  function removeItems(ids, record = true) {
    const gone = ids.map((id) => items.get(id)).filter(Boolean);
    if (!gone.length) return;
    for (const it of gone) items.delete(it.id);
    if (gone.some((it) => it.id === selected)) selected = null;
    if (record) { history.push({ t: "remove", items: gone.map((it) => ({ ...it })) }); future = []; }
    invalidate();
    socket.emit("board:remove", { conversationId: conv, ids: gone.map((it) => it.id) });
  }

  function recordUpdate(before, after) {
    if (JSON.stringify(before.p) === JSON.stringify(after.p) && before.s === after.s && before.c === after.c && before.w === after.w && before.f === after.f) return;
    history.push({ t: "update", before: { ...before }, after: { ...after } });
    future = [];
  }

  function undo() {
    const h = history.pop();
    if (!h) return showToast("Nothing to undo");
    if (h.t === "add") removeItems([h.item.id], false);
    else if (h.t === "remove") for (const it of h.items) saveNew({ ...it }, false);
    else if (h.t === "update") {
      if (items.has(h.before.id)) saveUpdate({ ...h.before });
      else return undo(); // someone else deleted it meanwhile
    }
    future.push(h);
  }

  function redo() {
    const h = future.pop();
    if (!h) return showToast("Nothing to redo");
    if (h.t === "add") saveNew({ ...h.item }, false);
    else if (h.t === "remove") removeItems(h.items.map((it) => it.id), false);
    else if (h.t === "update" && items.has(h.after.id)) saveUpdate({ ...h.after });
    history.push(h);
  }

  function sendLive(x, y, force = false) {
    const t = now();
    if (!force && t - lastLive < 40) return;
    lastLive = t;
    let d;
    if (draft) {
      if (draft.t === "pen") {
        if (draft.p.length > sentLen) {
          const from = Math.max(0, sentLen - 2); // overlap one point so the stroke joins up
          d = { id: draft.id, t: "pen", c: draft.c, w: draft.w, o: from, p: draft.p.slice(from) };
          sentLen = draft.p.length;
        }
      } else {
        d = { id: draft.id, t: draft.t, c: draft.c, w: draft.w, f: draft.f, k: draft.k, p: draft.p };
      }
    }
    socket.emit("board:live", { conversationId: conv, page, x, y, d });
  }

  // colour / width / fill buttons also restyle the selected shape
  function restyleSelected(change) {
    const it = selected && items.get(selected);
    if (!it || tool !== "select") return;
    const next = { ...it, ...change };
    if (next.t !== "rect" && next.t !== "ellipse" && next.t !== "shape") delete next.f;
    recordUpdate(it, next);
    saveUpdate(next);
  }

  /* =====================================================================
   * Pointer input
   * ===================================================================== */
  const pointers = new Map(); // touch pointers, for pinch zoom
  let pinch = null;
  let pan = null;
  let erasing = false;

  function localXY(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function cancelDraft() {
    if (!draft) return;
    draft = null;
    socket.emit("board:live", { conversationId: conv, page, x: null, y: null, d: false });
    invalidate();
  }

  function constrain(x1, y1, x2, y2, t) {
    if (t === "line" || t === "arrow") {
      const a = Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 4)) * (Math.PI / 4);
      const l = Math.hypot(x2 - x1, y2 - y1);
      return [x1 + Math.cos(a) * l, y1 + Math.sin(a) * l];
    }
    const s = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    return [x1 + Math.sign(x2 - x1 || 1) * s, y1 + Math.sign(y2 - y1 || 1) * s];
  }

  let lastTap = { t: 0, id: null };

  canvas.addEventListener("pointerdown", (e) => {
    if (conv == null || page == null) return;
    e.preventDefault();
    closeShapePicker();
    if (editor) commitEditor();
    canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = localXY(e);

    if (e.pointerType === "touch") {
      pointers.set(e.pointerId, [sx, sy]);
      if (pointers.size === 2) {
        // second finger: stop drawing, start pinch-zoom
        cancelDraft();
        erasing = false;
        drag = null;
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, view: { ...view } };
        return;
      }
      if (pointers.size > 2) return;
    }

    if (tool === "hand" || spaceDown || e.button === 1) {
      pan = { x: sx, y: sy, ox: view.ox, oy: view.oy };
      canvas.classList.add("panning");
      return;
    }
    if (e.button !== 0) return;

    const [wx0, wy0] = toWorld(sx, sy);
    const wx = clamp(wx0, 0, W), wy = clamp(wy0, 0, H);
    const r = (e.pointerType === "touch" ? 14 : 8) / view.s;

    if (tool === "select") {
      const h = handleAt(sx, sy);
      if (h) {
        const it = items.get(selected);
        drag = { kind: "handle", handle: h.id, orig: { ...it, p: it.p.slice() } };
        return;
      }
      const it = itemAt(wx0, wy0, r);
      selected = it ? it.id : null;
      invalidate();
      if (!it) return;
      // double-tap / double-click: edit its text
      const t = now();
      if (lastTap.id === it.id && t - lastTap.t < 400 && (it.t === "text" || it.t === "sticky" || it.t === "shape")) {
        lastTap = { t: 0, id: null };
        return editItem(it);
      }
      lastTap = { t, id: it.id };
      drag = { kind: "move", x: wx0, y: wy0, orig: { ...it, p: it.p.slice() } };
      return;
    }
    if (tool === "eraser") {
      erasing = true;
      eraseAt(wx0, wy0);
      return;
    }
    if (tool === "text") {
      // tapping existing text edits it
      const it = itemAt(wx0, wy0, r);
      if (it && it.t === "text") { drag = { kind: "noop" }; return editItem(it); }
      return; // new text is placed on pointerup, so a tap works on touch screens
    }
    draft = { id: rand(), t: tool, c: style.c, w: style.w, page, p: tool === "pen" ? [wx, wy] : [wx, wy, wx, wy] };
    if (tool === "rect" || tool === "ellipse" || tool === "shape") draft.f = style.f;
    if (tool === "shape") draft.k = shapeKind;
    sentLen = 0;
    sendLive(wx, wy, true);
    invalidate();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (conv == null) return;
    const [sx, sy] = localXY(e);
    me_ptr = e.pointerType === "mouse" ? [sx, sy] : null;

    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [sx, sy]);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      const s = clamp(pinch.view.s * (d / pinch.d), fitScale() * 0.5, 6);
      const k = s / pinch.view.s;
      view = { s, ox: cx - (pinch.cx - pinch.view.ox) * k, oy: cy - (pinch.cy - pinch.view.oy) * k };
      fitted = false;
      syncZoom();
      invalidate();
      return;
    }
    if (pan) {
      view.ox = pan.ox + (sx - pan.x);
      view.oy = pan.oy + (sy - pan.y);
      fitted = false;
      invalidate();
      return;
    }

    const [wx0, wy0] = toWorld(sx, sy);
    if (drag && drag.kind === "move") {
      saveUpdate(moved(drag.orig, wx0 - drag.x, wy0 - drag.y), true);
      sendLive(wx0, wy0);
      return;
    }
    if (drag && drag.kind === "handle") {
      saveUpdate(resized(drag.orig, drag.handle, wx0, wy0, e.shiftKey), true);
      sendLive(wx0, wy0);
      return;
    }
    if (tool === "select" && !drag && e.pointerType === "mouse") {
      const h = handleAt(sx, sy);
      canvas.style.cursor = h ? (isEndpoints(items.get(selected)) ? "crosshair" : h.id === "nw" || h.id === "se" ? "nwse-resize" : "nesw-resize")
        : itemAt(wx0, wy0, 8 / view.s) ? "move" : "";
    }
    if (erasing) eraseAt(wx0, wy0);
    if (draft) {
      const wx = clamp(wx0, 0, W), wy = clamp(wy0, 0, H);
      const p = draft.p;
      if (draft.t === "pen") {
        // a pointer can fire lots of tiny moves; keep a point every ~1.5 screen px
        const lx = p[p.length - 2], ly = p[p.length - 1];
        if (Math.hypot(wx - lx, wy - ly) * view.s >= 1.5 && p.length < 7998) p.push(round1(wx), round1(wy));
      } else {
        const square = e.shiftKey || (draft.t === "shape" && !e.altKey && false);
        const [ex, ey] = square ? constrain(p[0], p[1], wx, wy, draft.t) : [wx, wy];
        p[2] = clamp(ex, 0, W);
        p[3] = clamp(ey, 0, H);
      }
      invalidate();
    } else if (tool === "eraser") invalidate();
    sendLive(wx0, wy0);
  });

  function endPointer(e) {
    if (conv == null) return;
    if (pointers.has(e.pointerId)) {
      pointers.delete(e.pointerId);
      if (pinch) {
        if (pointers.size < 2) pinch = null;
        return;
      }
    }
    if (pan) {
      pan = null;
      canvas.classList.remove("panning");
      return;
    }
    if (drag) {
      const d = drag;
      drag = null;
      if (d.kind === "move" || d.kind === "handle") {
        const now_ = items.get(d.orig.id);
        if (pendingUpdate) saveUpdate(pendingUpdate);
        if (now_) {
          // always send the final position
          socket.emit("board:update", { conversationId: conv, item: wire(now_) });
          recordUpdate(d.orig, now_);
        }
      }
      return;
    }
    erasing = false;
    if (e.type === "pointercancel") return cancelDraft();

    const [sx, sy] = localXY(e);
    if (tool === "text" && !draft && e.button === 0) {
      const [wx, wy] = toWorld(sx, sy);
      if (wx >= 0 && wx <= W && wy >= 0 && wy <= H) openNewText(wx, wy);
      return;
    }
    if (!draft) return;
    const d = draft;
    draft = null;
    const p = d.p;
    const dragged = Math.hypot(p[2] - p[0], p[3] - p[1]) * view.s >= 8;
    if (d.t === "sticky" || d.t === "shape") {
      // a click places one at its normal size; a drag sets the size
      if (!dragged) {
        const [w, h] = d.t === "sticky" ? [200, 160] : shapeInfo(d.k).slice(2);
        const x = clamp(p[0] - w / 2, 0, W - w), y = clamp(p[1] - h / 2, 0, H - h);
        d.p = [round1(x), round1(y), round1(x + w), round1(y + h)];
      } else {
        const [x, y, w, h] = boxOf(p);
        d.p = [round1(x), round1(y), round1(x + Math.max(w, 30)), round1(y + Math.max(h, 30))];
      }
      socket.emit("board:live", { conversationId: conv, page, x: null, y: null, d: false });
      saveNew(d);
      if (d.t === "sticky") {
        // type straight away
        setTool("select");
        selected = d.id;
        editItem(d);
      }
      return;
    }
    const big = d.t === "pen" || dragged;
    if (!big) {
      socket.emit("board:live", { conversationId: conv, page, x: null, y: null, d: false });
      return invalidate();
    }
    saveNew(d);
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", (e) => {
    me_ptr = null;
    if (conv != null && !draft && !drag && e.pointerType === "mouse") {
      socket.emit("board:live", { conversationId: conv, page, x: null, y: null });
      invalidate();
    }
  });
  canvas.addEventListener("dblclick", (e) => {
    if (tool !== "select" && tool !== "text") return;
    const [sx, sy] = localXY(e);
    const [wx, wy] = toWorld(sx, sy);
    const it = itemAt(wx, wy, 8 / view.s);
    if (it && (it.t === "text" || it.t === "sticky" || it.t === "shape") && !(editor && editor.id === it.id)) editItem(it);
  });

  canvas.addEventListener("wheel", (e) => {
    if (conv == null) return;
    e.preventDefault();
    const [sx, sy] = localXY(e);
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), sx, sy);
    else {
      view.ox -= e.deltaX;
      view.oy -= e.deltaY;
      fitted = false;
      invalidate();
    }
  }, { passive: false });

  function eraseAt(x, y) {
    const r = 12 / view.s;
    const gone = pageItems().filter((it) => hits(it, x, y, r)).map((it) => it.id);
    if (gone.length) removeItems(gone);
  }

  /* ---------- text: new text, and editing text / sticky / shape labels ---------- */
  function placeEditor() {
    if (!editor) return;
    const it = editor.mode === "edit" ? items.get(editor.id) : null;
    if (editor.mode === "edit" && !it) return closeEditor();
    let x, y, width = null, size, color = style.c, wrapText = false;
    if (!it || it.t === "text") {
      const at = it ? it.p : editor.at;
      [x, y] = toScreen(at[0], at[1]);
      size = textSize(it ? it.w : style.w) * view.s;
      color = it ? it.c : style.c;
    } else if (it.t === "sticky") {
      const [bx, by, bw] = boxOf(it.p);
      [x, y] = toScreen(bx + 10, by + 14);
      width = (bw - 20) * view.s;
      size = STICKY_TEXT * view.s;
      color = "#1b2a47";
      wrapText = true;
    } else {
      const [bx, by, bw, bh] = boxOf(it.p);
      [x, y] = toScreen(bx - 30, by + bh + 4);
      width = (bw + 60) * view.s;
      size = 18 * view.s;
      color = "#1b2a47";
      wrapText = true;
    }
    textBox.classList.toggle("wrap", wrapText);
    Object.assign(textBox.style, { left: `${x - 4}px`, top: `${y - 3}px`, fontSize: `${size}px`, color, width: width ? `${width}px` : "" });
    autosize(width == null);
  }

  function autosize(fitWidth = true) {
    textBox.style.height = "auto";
    textBox.style.height = textBox.scrollHeight + "px";
    if (!fitWidth) return;
    const size = parseFloat(textBox.style.fontSize) || 16;
    ctx.font = FONT(size);
    const longest = Math.max(...(textBox.value || textBox.placeholder).split("\n").map((l) => ctx.measureText(l).width));
    textBox.style.width = `${Math.min(sw - parseFloat(textBox.style.left) - 8, longest + size + 16)}px`;
  }

  function openNewText(wx, wy) {
    editor = { mode: "new", at: [wx, wy] };
    textBox.value = "";
    textBox.placeholder = "Type, Enter to place";
    textBox.hidden = false;
    placeEditor();
    textBox.focus();
  }

  function editItem(it) {
    editor = { mode: "edit", id: it.id, before: { ...it, p: it.p.slice() } };
    textBox.value = it.s || "";
    textBox.placeholder = it.t === "sticky" ? "Write a note" : it.t === "shape" ? "Label (optional)" : "Text";
    textBox.hidden = false;
    selected = it.id;
    placeEditor();
    invalidate();
    textBox.focus();
    textBox.select();
  }

  function closeEditor() {
    editor = null;
    textBox.hidden = true;
    textBox.classList.remove("wrap");
    invalidate();
  }

  function commitEditor() {
    if (!editor) return;
    const ed = editor;
    const s = textBox.value.replace(/\s+$/, "").slice(0, 1000);
    closeEditor();
    if (ed.mode === "new") {
      if (s.trim()) saveNew({ id: rand(), t: "text", c: style.c, w: style.w, page, p: [Math.round(ed.at[0]), Math.round(ed.at[1])], s });
      return;
    }
    const it = items.get(ed.id);
    if (!it) return;
    if (it.t === "text" && !s.trim()) return removeItems([it.id]);
    if ((it.s || "") === s) return;
    const next = { ...it, s };
    if (!s) delete next.s;
    recordUpdate(ed.before, next);
    saveUpdate(next);
  }

  textBox.addEventListener("input", () => {
    const wrapped = textBox.classList.contains("wrap");
    autosize(!wrapped);
  });
  textBox.addEventListener("keydown", (e) => {
    e.stopPropagation();
    const multiline = editor && editor.mode === "edit" && items.get(editor.id)?.t === "sticky";
    if (e.key === "Enter" && !e.shiftKey && !multiline) { e.preventDefault(); commitEditor(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEditor(); }
    else if (e.key === "Escape") { e.preventDefault(); commitEditor(); }
  });
  textBox.addEventListener("blur", () => commitEditor());

  /* ---------- shape library ---------- */
  function openShapePicker() {
    shapePop.replaceChildren(
      mk("div", "bd-shapes-title", { textContent: "Diagram shapes" }),
      ...SHAPES.map(([k, label]) => {
        const b = mk("button", "bd-shape" + (k === shapeKind && tool === "shape" ? " on" : ""), { type: "button", title: `${label}: click the page to place it, or drag to size it` });
        const cv = mk("canvas");
        cv.width = 96;
        cv.height = 72;
        const c = cv.getContext("2d");
        c.scale(2, 2);
        const [, , w, h] = shapeInfo(k);
        const s = Math.min(40 / w, 26 / h);
        const bw = w * s, bh = h * s;
        drawShape(c, { t: "shape", k, c: style.c, w: 2.4, f: style.f, p: [24 - bw / 2, 16 - bh / 2, 24 + bw / 2, 16 + bh / 2] });
        b.append(cv, mk("span", "", { textContent: label }));
        b.onclick = () => { shapeKind = k; setTool("shape"); closeShapePicker(); };
        return b;
      }),
    );
    shapePop.hidden = false;
  }
  function closeShapePicker() { shapePop.hidden = true; }

  /* ---------- pages ---------- */
  function renderPages() {
    pagesBar.replaceChildren(
      ...pages.map((pg, i) => {
        const b = mk("button", "bd-page" + (pg.id === page ? " on" : ""), { type: "button", textContent: pg.name, title: pg.id === page ? "Double-click to rename" : `Go to ${pg.name}` });
        b.onclick = () => goPage(pg.id);
        b.ondblclick = () => renamePage(pg);
        if (pg.id === page && pages.length > 1) {
          const x = mk("span", "bd-page-x", { textContent: "×", title: "Delete this page" });
          x.onclick = (e) => { e.stopPropagation(); deletePage(pg); };
          b.append(x);
        }
        b.dataset.n = i + 1;
        return b;
      }),
      Object.assign(iconBtn("plus", "Add a page", "bd-page-add"), { onclick: addPage }),
    );
  }

  function goPage(id) {
    if (id === page) return;
    if (editor) commitEditor();
    cancelDraft();
    page = id;
    selected = null;
    renderPages();
    invalidate();
    socket.emit("board:live", { conversationId: conv, page, x: null, y: null, d: false });
  }

  function addPage() {
    socket.emit("board:page:add", { conversationId: conv }, (res) => {
      if (!res || !res.ok) return showToast((res && res.message) || "Couldn't add a page");
      if (!pages.some((p) => p.id === res.page.id)) pages.push(res.page);
      goPage(res.page.id);
    });
  }

  function renamePage(pg) {
    const name = prompt("Page name", pg.name);
    if (!name || !name.trim() || name.trim() === pg.name) return;
    socket.emit("board:page:rename", { conversationId: conv, page: pg.id, name: name.trim() });
  }

  function deletePage(pg) {
    const n = [...items.values()].filter((it) => it.page === pg.id).length;
    if (!confirm(n ? `Delete “${pg.name}” and its ${n} ${n === 1 ? "shape" : "shapes"} for everyone?` : `Delete “${pg.name}”?`)) return;
    socket.emit("board:page:delete", { conversationId: conv, page: pg.id }, (res) => {
      if (!res || !res.ok) showToast((res && res.message) || "Couldn't delete the page");
    });
  }

  /* =====================================================================
   * Toolbar
   * ===================================================================== */
  function setTool(t) {
    if (editor) commitEditor();
    tool = t;
    canvas.dataset.tool = t;
    canvas.style.cursor = "";
    if (t !== "select") selected = null;
    syncBar();
    invalidate();
  }

  function syncBar() {
    for (const [id, b] of Object.entries(toolBtns)) b.setAttribute("aria-pressed", String(id === tool || (id === "shapes" && tool === "shape")));
    for (const [c, b] of colorBtns) b.setAttribute("aria-pressed", String(c === style.c));
    for (const [w, b] of widthBtns) b.setAttribute("aria-pressed", String(w === style.w));
    fillBtn.setAttribute("aria-pressed", String(style.f));
    if (editor) placeEditor();
  }

  undoBtn.onclick = undo;
  redoBtn.onclick = redo;

  clearBtn.onclick = () => {
    const mine = pageItems();
    if (!mine.length) return;
    if (!confirm("Clear this page for everyone in this chat?")) return;
    for (const it of mine) items.delete(it.id);
    selected = null;
    history = history.filter((h) => !(h.item && h.item.page === page));
    socket.emit("board:clear", { conversationId: conv, page });
    invalidate();
  };

  sendBtn.onclick = async () => {
    const list = pageItems();
    if (!list.length) return showToast("Draw something first");
    const id = conv;
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const c = out.getContext("2d");
    c.fillStyle = "#fbfcfd";
    c.fillRect(0, 0, W, H);
    for (const it of list) drawItem(c, it);
    const blob = await new Promise((r) => out.toBlob(r, "image/png"));
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const pg = pages.find((p) => p.id === page);
    const fd = new FormData();
    fd.append("message", pages.length > 1 && pg ? `Board snapshot: ${pg.name}` : "Board snapshot");
    fd.append("files", blob, `board-${stamp}.png`);
    sendBtn.disabled = true;
    showToast("Sending to the chat…", 0);
    try {
      const r = await fetch(`/api/conversations/${id}/messages`, { method: "POST", body: fd });
      let msg = "Couldn't send it. Try again.";
      if (!r.ok) { try { msg = (await r.json()).message || msg; } catch {} }
      showToast(r.ok ? "Sent to the chat" : msg);
    } catch {
      showToast("Couldn't send it. Try again.");
    } finally {
      sendBtn.disabled = false;
    }
  };

  zIn.onclick = () => zoomAt(1.25);
  zOut.onclick = () => zoomAt(0.8);
  zFit.onclick = zLabel.onclick = fit;
  closeBtn.onclick = () => close();

  document.addEventListener("keydown", (e) => {
    if (conv == null) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (document.querySelector("dialog[open]")) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); return redo(); }
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); return undo(); }
    if ((e.ctrlKey || e.metaKey) && k === "d" && selected && items.get(selected)) {
      // duplicate
      e.preventDefault();
      const it = items.get(selected);
      const copy = moved({ ...it, id: rand() }, 24, 24);
      saveNew(copy);
      selected = copy.id;
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); return removeItems([selected]); }
    if (e.key === "Enter" && selected && items.get(selected)) {
      const it = items.get(selected);
      if (it.t === "text" || it.t === "sticky" || it.t === "shape") { e.preventDefault(); return editItem(it); }
    }
    if (e.key === " ") { spaceDown = true; canvas.classList.add("grab"); e.preventDefault(); return; }
    if (e.key === "Escape") {
      if (!shapePop.hidden) return closeShapePicker();
      if (draft) return cancelDraft();
      if (selected) { selected = null; return invalidate(); }
    }
    const hit = TOOLS.find(([, , key]) => key.toLowerCase() === k);
    if (hit) hit[0] === "shapes" ? openShapePicker() : setTool(hit[0]);
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === " ") { spaceDown = false; canvas.classList.remove("grab"); }
  });

  let toastTimer = 0;
  function showToast(msg, ms = 2600) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => (toast.hidden = true), ms);
  }

  /* =====================================================================
   * Open / close / presence
   * ===================================================================== */
  function renderPeople(viewers) {
    people.replaceChildren(
      ...viewers.slice(0, 5).map((n) => {
        const a = mk("span", "bd-avatar", { textContent: (n[0] || "?").toUpperCase(), title: n === myName() ? `${n} (you)` : n });
        a.style.background = colorFor(n);
        return a;
      }),
    );
    if (viewers.length > 5) people.append(mk("span", "bd-more", { textContent: `+${viewers.length - 5}` }));
  }

  let enabled = true; // admin setting

  function syncHead() {
    const viewers = (activeId != null && presence[activeId]) || [];
    const others = viewers.filter((n) => n !== myName());
    headLive.hidden = !viewers.length;
    headLive.textContent = viewers.length ? `${viewers.length} on it` : "";
    headBtn.classList.toggle("is-live", viewers.length > 0);
    headBtn.setAttribute("aria-pressed", String(conv != null));
    headBtn.hidden = activeId == null || !enabled;
    if (conv != null) renderPeople(viewers);
    // crackers are off in this chat while anyone has the board open
    window.sandesCrackers?.setBlocked(conv != null || viewers.length > 0);
    if (conv != null || !others.length) invite.hidden = true;
  }

  function open() {
    if (activeId == null || conv != null || !enabled) return;
    conv = activeId;
    items = new Map();
    pages = [];
    page = null;
    history = [];
    future = [];
    selected = null;
    remote.clear();
    panel.hidden = false;
    invite.hidden = true;
    loading.hidden = false;
    ticker.hidden = true;
    fitted = true;
    syncHead();
    resize();
    join();
  }

  function join() {
    const id = conv;
    socket.emit("board:join", { conversationId: id }, (res) => {
      if (conv !== id) return; // closed or switched meanwhile
      loading.hidden = true;
      if (!res || res.error) {
        showToast((res && res.error) || "Couldn't open the board.");
        return;
      }
      pages = res.pages;
      if (!pages.some((p) => p.id === page)) page = pages[0].id;
      items = new Map(res.items.map((it) => [it.id, it]));
      presence[id] = res.viewers;
      renderPages();
      syncHead();
      invalidate();
    });
  }

  function close() {
    if (conv == null) return;
    if (editor) commitEditor();
    cancelDraft();
    closeShapePicker();
    socket.emit("board:leave", { conversationId: conv });
    conv = null;
    panel.hidden = true;
    remote.clear();
    items = new Map();
    pointers.clear();
    pinch = pan = drag = null;
    selected = null;
    syncHead();
  }

  headBtn.onclick = () => (conv == null ? open() : close());
  inviteOpen.onclick = () => open();
  inviteX.onclick = () => (invite.hidden = true);

  function refreshStatus(id) {
    if (id == null) return syncHead();
    socket.emit("board:status", { conversationId: id }, (res) => {
      presence[id] = (res && res.viewers) || [];
      if (id === activeId) syncHead();
    });
  }

  // Short note in the chat pane (the board itself may be closed)
  function showInfo(msg) {
    inviteText.textContent = msg;
    inviteOpen.hidden = true;
    invite.hidden = false;
    setTimeout(() => { invite.hidden = true; inviteOpen.hidden = false; }, 4000);
  }

  // The admin turned the board off while it was open
  socket.on("board:closed", ({ conversationId }) => {
    if (conversationId !== conv) return;
    close();
    showInfo("The admin turned the board off");
  });

  socket.on("board:presence", ({ conversationId, viewers }) => {
    const before = presence[conversationId] || [];
    presence[conversationId] = viewers;
    if (conversationId !== activeId) return;
    const joinedNow = viewers.filter((n) => !before.includes(n) && n !== myName());
    if (conv == null && enabled && joinedNow.length) {
      inviteText.textContent = `${joinedNow[0]} opened the board`;
      invite.hidden = false;
    }
    syncHead();
  });

  socket.on("board:pages", ({ conversationId, pages: list }) => {
    if (conversationId !== conv) return;
    pages = list;
    const ids = new Set(list.map((p) => p.id));
    for (const it of [...items.values()]) if (!ids.has(it.page)) items.delete(it.id);
    if (!ids.has(page)) { page = list[0].id; selected = null; showToast("That page was deleted"); }
    renderPages();
    invalidate();
  });

  socket.on("board:add", ({ conversationId, item }) => {
    if (conversationId !== conv) return;
    items.set(item.id, item);
    for (const r of remote.values()) if (r.draft && r.draft.id === item.id) r.draft = null;
    invalidate();
  });

  socket.on("board:update", ({ conversationId, item }) => {
    if (conversationId !== conv) return;
    // don't yank a shape out from under your own drag
    if (drag && drag.orig && drag.orig.id === item.id) return;
    items.set(item.id, item);
    if (editor && editor.id === item.id) placeEditor();
    invalidate();
  });

  socket.on("board:remove", ({ conversationId, ids }) => {
    if (conversationId !== conv) return;
    for (const id of ids) items.delete(id);
    if (ids.includes(selected)) selected = null;
    if (editor && ids.includes(editor.id)) closeEditor();
    invalidate();
  });

  socket.on("board:clear", ({ conversationId, page: pg, by }) => {
    if (conversationId !== conv) return;
    for (const it of [...items.values()]) if (it.page === pg) items.delete(it.id);
    for (const r of remote.values()) if (r.page === pg) r.draft = null;
    if (selected && !items.has(selected)) selected = null;
    if (pg === page) showToast(`${by} cleared this page`);
    invalidate();
  });

  socket.on("board:live", (m) => {
    if (m.conversationId !== conv) return;
    if (m.gone) { remote.delete(m.sid); return invalidate(); }
    let r = remote.get(m.sid);
    if (!r) remote.set(m.sid, (r = { by: m.by, page: m.page, x: null, y: null, t: 0, draft: null }));
    if (r.page !== m.page) r.draft = null;
    r.page = m.page;
    if (m.x != null) { r.x = m.x; r.y = m.y; r.t = now(); }
    else r.x = null;
    const d = m.d;
    if (d === false) r.draft = null;
    else if (d) {
      if (d.t === "pen" && r.draft && r.draft.id === d.id) {
        r.draft.p.length = Math.min(r.draft.p.length, d.o);
        r.draft.p.push(...d.p);
      } else {
        r.draft = { id: d.id, t: d.t, c: d.c, w: d.w, f: d.f, k: d.k, p: d.p.slice() };
      }
    }
    invalidate();
  });

  // New chat messages while the board covers the feed: show them briefly on the board
  let tickerTimer = 0;
  socket.on("message", (m) => {
    if (conv == null || m.conversation_id !== conv || m.kind === "system" || m.sender_id === (typeof me !== "undefined" && me ? me.id : -1)) return;
    const text = m.message || ((m.attachments || []).length ? "sent an attachment" : "");
    ticker.replaceChildren(Object.assign(mk("b"), { textContent: m.sender + " " }), document.createTextNode(text));
    ticker.hidden = false;
    clearTimeout(tickerTimer);
    tickerTimer = setTimeout(() => (ticker.hidden = true), 6000);
  });

  socket.on("connect", () => {
    if (conv != null) {
      loading.hidden = false;
      join();
    } else refreshStatus(activeId);
  });

  document.fonts?.ready.then(invalidate);
  setTool("pen");
  headBtn.hidden = true;

  window.sandesBoard = {
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) close();
      syncHead();
    },
    // chat.js calls this whenever the open conversation changes (null = none)
    switchTo(id) {
      if (conv != null && conv !== id) close();
      invite.hidden = true;
      refreshStatus(id);
    },
  };
  if (window.sandesSettings) window.sandesBoard.setEnabled(window.sandesSettings.board_enabled);
})();
