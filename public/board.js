/* Sandes · shared drawing board
 *
 * One board per conversation. Everyone in the chat who opens it sees the same drawing,
 * live: other people's cursors and the shape they're in the middle of drawing show up as
 * they draw. Shapes are saved on the server (board_items), so the board is still there
 * after a reload. While anyone in a chat has the board open, crackers are off there.
 *
 * Coordinates are on a fixed 1600 x 1000 board, so the layout is identical on every
 * screen; each person can zoom and pan their own view.
 * Uses globals from index.html: `socket`, `activeId`, `me`, `conversations`, `inkFor`.
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

  const ICONS = {
    pen: '<path d="M3.5 20.5 7 19.6 19.2 7.4a1.9 1.9 0 0 0 0-2.6 1.9 1.9 0 0 0-2.6 0L4.4 17z"/><path d="m15.2 6.2 2.6 2.6"/>',
    line: '<path d="M5 19 19 5"/>',
    arrow: '<path d="M5 19 19 5"/><path d="M10 5h9v9"/>',
    rect: '<rect x="3.5" y="6" width="17" height="12" rx="2"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6.5"/>',
    text: '<path d="M5 7V4.5h14V7"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>',
    eraser: '<path d="M8.5 19.5H20"/><path d="m5.3 14.3 8.4-8.4a2 2 0 0 1 2.8 0l2.6 2.6a2 2 0 0 1 0 2.8L12 18.4H9.4z"/><path d="m9.5 10.1 5.4 5.4"/>',
    hand: '<path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5.5"/><path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 11.5V6a1.5 1.5 0 0 1 3 0v8c0 4-2.6 7-6.6 7-3 0-4.7-1.6-5.9-4.3L3.3 13a1.5 1.5 0 0 1 2.6-1.4L8 14.5"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
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
    ["pen", "Pen", "P"], ["line", "Line", "L"], ["arrow", "Arrow", "A"], ["rect", "Box", "R"],
    ["ellipse", "Circle", "O"], ["text", "Text", "T"], ["eraser", "Eraser", "E"], ["hand", "Move the view", "H"],
  ];

  const rand = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const now = () => performance.now();
  const colorFor = (name) => (typeof inkFor === "function" ? inkFor(name || "") : "#2f5d8a");
  const myName = () => (typeof me !== "undefined" && me ? me.username : "");

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
  chatHead.append(headBtn);

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
    b.onclick = () => setTool(id);
    toolBtns[id] = b;
    toolGroup.append(b);
  }

  const colorGroup = mk("div", "bd-group");
  const colorBtns = COLORS.map(([c, name]) => {
    const b = mk("button", "bd-swatch", { type: "button", title: name });
    b.setAttribute("aria-label", name);
    b.style.setProperty("--sw", c);
    b.onclick = () => { style.c = c; syncBar(); };
    colorGroup.append(b);
    return [c, b];
  });

  const widthGroup = mk("div", "bd-group");
  const widthBtns = WIDTHS.map(([w, name]) => {
    const b = mk("button", "bd-btn bd-width", { type: "button", title: `${name} line / ${name.toLowerCase()} text` });
    b.setAttribute("aria-label", name);
    b.append(mk("i", "", { style: `width:${w + 3}px;height:${w + 3}px` }));
    b.onclick = () => { style.w = w; syncBar(); };
    widthGroup.append(b);
    return [w, b];
  });
  const fillBtn = iconBtn("fill", "Fill boxes and circles");
  fillBtn.onclick = () => { style.f = !style.f; syncBar(); };
  widthGroup.append(fillBtn);

  const actGroup = mk("div", "bd-group");
  const undoBtn = iconBtn("undo", "Undo your last shape (Ctrl+Z)");
  const clearBtn = iconBtn("trash", "Clear the board for everyone");
  const sendBtn = iconBtn("send", "Send a picture of the board to the chat");
  actGroup.append(undoBtn, clearBtn, sendBtn);

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
  const zLabel = mk("button", "bd-zlabel", { type: "button", title: "Fit the board" });
  const zIn = iconBtn("plus", "Zoom in");
  const zFit = iconBtn("fit", "Fit the board");
  zoomBar.append(zOut, zLabel, zIn, zFit);
  const toast = mk("div", "bd-toast", { role: "status" });
  toast.hidden = true;
  const ticker = mk("div", "bd-ticker");
  ticker.hidden = true;
  const loading = mk("div", "bd-loading", { textContent: "Opening the board…" });
  stage.append(canvas, textBox, zoomBar, toast, ticker, loading);

  panel.append(bar, stage);
  chatEl.append(panel);

  /* =====================================================================
   * State
   * ===================================================================== */
  let conv = null;                 // conversation id the board is open for (null = closed)
  let items = new Map();           // id -> item, in drawing order
  let mine = [];                   // ids I drew, for undo
  let tool = "pen";
  const style = { c: COLORS[0][0], w: 4, f: false };
  let draft = null;                // what I'm drawing right now
  let sentLen = 0;                 // how much of my pen draft the others have
  let lastLive = 0;
  const remote = new Map();        // socket id -> { by, x, y, t, draft }
  const presence = {};             // conversation id -> [usernames on the board]
  let view = { s: 1, ox: 0, oy: 0 };
  let fitted = true;               // follow the panel size until the user zooms/pans
  let sw = 0, sh = 0, dpr = 1;
  let me_ptr = null;               // my pointer in screen px (for the eraser ring)
  let textAt = null;               // world point of the text being typed
  let spaceDown = false;

  /* ---------- view ---------- */
  const fitScale = () => Math.min(sw / W, sh / H) * 0.95;
  function fit() {
    const s = fitScale();
    view = { s, ox: (sw - W * s) / 2, oy: (sh - H * s) / 2 };
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
    if (textAt) placeTextBox();
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

  const FONT = (size) => `600 ${size}px Figtree, system-ui, sans-serif`;

  function textBox_(c, it) {
    const size = textSize(it.w);
    c.font = FONT(size);
    const lines = it.s.split("\n");
    const lh = size * 1.25;
    let mw = 0;
    for (const l of lines) mw = Math.max(mw, c.measureText(l).width);
    return { size, lines, lh, bb: [it.p[0], it.p[1], mw, lines.length * lh] };
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
        const r = Math.min(10, w / 4, h / 4);
        c.beginPath();
        if (c.roundRect) c.roundRect(x, y, w, h, r);
        else c.rect(x, y, w, h);
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
        const t = textBox_(c, it);
        it._bb = t.bb;
        c.textBaseline = "top";
        t.lines.forEach((l, i) => c.fillText(l, p[0], p[1] + i * t.lh + t.size * 0.08));
        break;
      }
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
    for (const it of items.values()) drawItem(ctx, it);
    ctx.globalAlpha = 0.75;
    for (const r of remote.values()) if (r.draft && r.draft.p.length >= 2) drawItem(ctx, r.draft);
    ctx.globalAlpha = 1;
    if (draft) drawItem(ctx, draft);
    ctx.restore();

    // screen-space overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let fading = false;
    for (const r of remote.values()) {
      if (r.x == null) continue;
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
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x + 10, y + 12, tw + 14, 19, 10);
      else ctx.rect(x + 10, y + 12, tw + 14, 19);
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
   * Hit testing (eraser)
   * ===================================================================== */
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l = dx * dx + dy * dy;
    const k = l ? clamp(((px - x1) * dx + (py - y1) * dy) / l, 0, 1) : 0;
    return Math.hypot(px - (x1 + k * dx), py - (y1 + k * dy));
  }

  function hits(it, x, y, r) {
    const p = it.p, rr = r + it.w / 2;
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
        if (it.f && x >= bx && x <= bx + w && y >= by && y <= by + h) return true;
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
      case "text": {
        const bb = it._bb || textBox_(ctx, it).bb;
        return x >= bb[0] - r && x <= bb[0] + bb[2] + r && y >= bb[1] - r && y <= bb[1] + bb[3] + r;
      }
    }
    return false;
  }

  function eraseAt(x, y) {
    const r = 12 / view.s;
    const gone = [];
    for (const it of items.values()) if (hits(it, x, y, r)) gone.push(it.id);
    if (!gone.length) return;
    removeLocal(gone);
    socket.emit("board:remove", { conversationId: conv, ids: gone });
  }

  function removeLocal(ids) {
    for (const id of ids) items.delete(id);
    const set = new Set(ids);
    mine = mine.filter((id) => !set.has(id));
    invalidate();
  }

  /* =====================================================================
   * Saving + live updates
   * ===================================================================== */
  function commit(it) {
    const { o, ...item } = it;
    item.by = myName();
    items.set(item.id, item);
    mine.push(item.id);
    invalidate();
    const { by, _bb, ...wire } = item;
    socket.emit("board:add", { conversationId: conv, item: wire }, (res) => {
      if (res && res.ok) return;
      removeLocal([item.id]);
      showToast(res && res.full ? "The board is full. Clear some of it first." : "That shape wasn't saved. Try again.");
    });
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
        d = { id: draft.id, t: draft.t, c: draft.c, w: draft.w, f: draft.f, p: draft.p };
      }
    }
    socket.emit("board:live", { conversationId: conv, x, y, d });
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
    socket.emit("board:live", { conversationId: conv, x: null, y: null, d: false });
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

  canvas.addEventListener("pointerdown", (e) => {
    if (conv == null) return;
    e.preventDefault();
    if (textAt) commitText();
    canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = localXY(e);

    if (e.pointerType === "touch") {
      pointers.set(e.pointerId, [sx, sy]);
      if (pointers.size === 2) {
        // second finger: stop drawing, start pinch-zoom
        cancelDraft();
        erasing = false;
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
    if (tool === "eraser") {
      erasing = true;
      eraseAt(wx0, wy0);
      return;
    }
    if (tool === "text") return; // placed on pointerup, so a tap works on touch screens
    draft = { id: rand(), t: tool, c: style.c, w: style.w, p: tool === "pen" ? [wx, wy] : [wx, wy, wx, wy] };
    if (tool === "rect" || tool === "ellipse") draft.f = style.f;
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
    if (erasing) eraseAt(wx0, wy0);
    if (draft) {
      const wx = clamp(wx0, 0, W), wy = clamp(wy0, 0, H);
      const p = draft.p;
      if (draft.t === "pen") {
        // a pointer can fire lots of tiny moves; keep a point every ~1.5 screen px
        const lx = p[p.length - 2], ly = p[p.length - 1];
        if (Math.hypot(wx - lx, wy - ly) * view.s >= 1.5 && p.length < 7998) p.push(Math.round(wx * 10) / 10, Math.round(wy * 10) / 10);
      } else {
        const [ex, ey] = e.shiftKey ? constrain(p[0], p[1], wx, wy, draft.t) : [wx, wy];
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
    erasing = false;
    if (e.type === "pointercancel") return cancelDraft();

    const [sx, sy] = localXY(e);
    if (tool === "text" && !draft && e.button === 0) {
      const [wx, wy] = toWorld(sx, sy);
      if (wx >= 0 && wx <= W && wy >= 0 && wy <= H) openText(wx, wy);
      return;
    }
    if (!draft) return;
    const d = draft;
    draft = null;
    const p = d.p;
    const big = d.t === "pen" || Math.hypot(p[2] - p[0], p[3] - p[1]) * view.s >= 4;
    if (!big) {
      socket.emit("board:live", { conversationId: conv, x: null, y: null, d: false });
      return invalidate();
    }
    // finish sending the stroke so the others' preview is complete until the real one lands
    commit(d);
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", (e) => {
    me_ptr = null;
    if (conv != null && !draft && e.pointerType === "mouse") {
      socket.emit("board:live", { conversationId: conv, x: null, y: null });
      invalidate();
    }
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

  /* ---------- text ---------- */
  function placeTextBox() {
    const [x, y] = toScreen(textAt[0], textAt[1]);
    const size = textSize(style.w) * view.s;
    Object.assign(textBox.style, {
      left: `${x - 4}px`, top: `${y - 3}px`, fontSize: `${size}px`, color: style.c,
    });
    autosize();
  }
  function autosize() {
    textBox.style.height = "auto";
    textBox.style.height = textBox.scrollHeight + "px";
    const size = textSize(style.w) * view.s;
    ctx.font = FONT(size);
    const longest = Math.max(...(textBox.value || textBox.placeholder).split("\n").map((l) => ctx.measureText(l).width));
    textBox.style.width = `${Math.min(sw - parseFloat(textBox.style.left) - 8, longest + size + 16)}px`;
  }
  function openText(wx, wy) {
    textAt = [wx, wy];
    textBox.value = "";
    textBox.hidden = false;
    placeTextBox();
    textBox.focus();
  }
  function commitText() {
    if (!textAt) return;
    const s = textBox.value.replace(/\s+$/, "");
    const at = textAt;
    textAt = null;
    textBox.hidden = true;
    if (s.trim()) commit({ id: rand(), t: "text", c: style.c, w: style.w, p: [Math.round(at[0]), Math.round(at[1])], s: s.slice(0, 1000) });
  }
  textBox.addEventListener("input", autosize);
  textBox.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); }
    else if (e.key === "Escape") { textAt = null; textBox.hidden = true; }
  });
  textBox.addEventListener("blur", () => commitText());

  /* =====================================================================
   * Toolbar
   * ===================================================================== */
  function setTool(t) {
    if (textAt) commitText();
    tool = t;
    canvas.dataset.tool = t;
    syncBar();
    invalidate();
  }

  function syncBar() {
    for (const [id, b] of Object.entries(toolBtns)) b.setAttribute("aria-pressed", String(id === tool));
    for (const [c, b] of colorBtns) b.setAttribute("aria-pressed", String(c === style.c));
    for (const [w, b] of widthBtns) b.setAttribute("aria-pressed", String(w === style.w));
    fillBtn.setAttribute("aria-pressed", String(style.f));
    if (textAt) placeTextBox();
  }

  undoBtn.onclick = undo;
  function undo() {
    while (mine.length) {
      const id = mine.pop();
      if (!items.has(id)) continue;
      items.delete(id);
      socket.emit("board:remove", { conversationId: conv, ids: [id] });
      invalidate();
      return;
    }
    showToast("Nothing of yours to undo");
  }

  clearBtn.onclick = () => {
    if (!items.size) return;
    if (!confirm("Clear the board for everyone in this chat?")) return;
    items.clear();
    mine = [];
    socket.emit("board:clear", { conversationId: conv });
    invalidate();
  };

  sendBtn.onclick = async () => {
    if (!items.size) return showToast("Draw something first");
    const id = conv;
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const c = out.getContext("2d");
    c.fillStyle = "#fbfcfd";
    c.fillRect(0, 0, W, H);
    for (const it of items.values()) drawItem(c, it);
    const blob = await new Promise((r) => out.toBlob(r, "image/png"));
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const fd = new FormData();
    fd.append("message", "Board snapshot");
    fd.append("files", blob, `board-${stamp}.png`);
    sendBtn.disabled = true;
    showToast("Sending to the chat…", 0);
    try {
      const r = await fetch(`/api/conversations/${id}/messages`, { method: "POST", body: fd });
      showToast(r.ok ? "Sent to the chat" : "Couldn't send it. Try again.");
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
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); return undo(); }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " ") { spaceDown = true; canvas.classList.add("grab"); e.preventDefault(); return; }
    if (e.key === "Escape" && draft) return cancelDraft();
    const hit = TOOLS.find(([, , k]) => k.toLowerCase() === e.key.toLowerCase());
    if (hit) setTool(hit[0]);
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

  function syncHead() {
    const viewers = (activeId != null && presence[activeId]) || [];
    const others = viewers.filter((n) => n !== myName());
    headLive.hidden = !viewers.length;
    headLive.textContent = viewers.length ? `${viewers.length} on it` : "";
    headBtn.classList.toggle("is-live", viewers.length > 0);
    headBtn.setAttribute("aria-pressed", String(conv != null));
    headBtn.hidden = activeId == null;
    if (conv != null) renderPeople(viewers);
    // crackers are off in this chat while anyone has the board open
    window.sandesCrackers?.setBlocked(conv != null || viewers.length > 0);
    if (conv != null || !others.length) invite.hidden = true;
  }

  function open() {
    if (activeId == null || conv != null) return;
    conv = activeId;
    items = new Map();
    mine = [];
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
      items = new Map(res.items.map((it) => [it.id, it]));
      mine = mine.filter((k) => items.has(k));
      presence[id] = res.viewers;
      syncHead();
      invalidate();
    });
  }

  function close() {
    if (conv == null) return;
    if (textAt) commitText();
    cancelDraft();
    socket.emit("board:leave", { conversationId: conv });
    conv = null;
    panel.hidden = true;
    remote.clear();
    items = new Map();
    pointers.clear();
    pinch = pan = null;
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

  socket.on("board:presence", ({ conversationId, viewers }) => {
    const before = presence[conversationId] || [];
    presence[conversationId] = viewers;
    if (conversationId !== activeId) return;
    const joinedNow = viewers.filter((n) => !before.includes(n) && n !== myName());
    if (conv == null && joinedNow.length) {
      inviteText.textContent = `${joinedNow[0]} opened the board`;
      invite.hidden = false;
    }
    syncHead();
  });

  socket.on("board:add", ({ conversationId, item }) => {
    if (conversationId !== conv) return;
    items.set(item.id, item);
    for (const r of remote.values()) if (r.draft && r.draft.id === item.id) r.draft = null;
    invalidate();
  });

  socket.on("board:remove", ({ conversationId, ids }) => {
    if (conversationId !== conv) return;
    removeLocal(ids);
  });

  socket.on("board:clear", ({ conversationId, by }) => {
    if (conversationId !== conv) return;
    items.clear();
    mine = [];
    for (const r of remote.values()) r.draft = null;
    showToast(`${by} cleared the board`);
    invalidate();
  });

  socket.on("board:live", (m) => {
    if (m.conversationId !== conv) return;
    if (m.gone) { remote.delete(m.sid); return invalidate(); }
    let r = remote.get(m.sid);
    if (!r) remote.set(m.sid, (r = { by: m.by, x: null, y: null, t: 0, draft: null }));
    if (m.x != null) { r.x = m.x; r.y = m.y; r.t = now(); }
    else r.x = null;
    const d = m.d;
    if (d === false) r.draft = null;
    else if (d) {
      if (d.t === "pen" && r.draft && r.draft.id === d.id) {
        r.draft.p.length = Math.min(r.draft.p.length, d.o);
        r.draft.p.push(...d.p);
      } else {
        r.draft = { id: d.id, t: d.t, c: d.c, w: d.w, f: d.f, p: d.p.slice() };
      }
    }
    invalidate();
  });

  // New chat messages while the board covers the feed: show them briefly on the board
  let tickerTimer = 0;
  socket.on("message", (m) => {
    if (conv == null || m.conversation_id !== conv || m.sender_id === (typeof me !== "undefined" && me ? me.id : -1)) return;
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
    // index.html calls this whenever the open conversation changes (null = none)
    switchTo(id) {
      if (conv != null && conv !== id) close();
      invite.hidden = true;
      refreshStatus(id);
    },
  };
})();
