/* Sandes · message effects (confetti, rangoli, hearts, marigold petals)
 *
 * When someone sends a message "with an effect", everyone who has that chat open sees it
 * play over the chat. Drawn on one canvas above the chat pane; nothing is stored.
 */
(() => {
  "use strict";

  const chatEl = document.getElementById("chat");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.createElement("canvas");
  canvas.className = "fx-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let parts = [], rangolis = [], raf = 0, last = 0, W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  addEventListener("resize", resize);
  resize();

  const area = () => {
    const r = chatEl.getBoundingClientRect();
    return r.width ? r : { left: 0, top: 0, width: W, height: H, right: W, bottom: H };
  };

  const CONFETTI = ["#b3303a", "#1b2a47", "#2f5d8a", "#f59e0b", "#2e6b5a", "#ec4899", "#fbbf24", "#7a3e6c"];
  const MARIGOLD = ["#f97316", "#fb923c", "#f59e0b", "#fbbf24", "#ea580c"];

  function confetti(scale) {
    const a = area();
    const n = Math.round((reduce ? 50 : 170) * scale);
    for (let i = 0; i < n; i++) {
      parts.push({
        kind: "paper", x: rand(a.left, a.right), y: a.top - rand(0, a.height * 0.5),
        vx: rand(-60, 60), vy: rand(80, 220), g: 120, rot: rand(0, 6), vr: rand(-8, 8),
        w: rand(6, 11), h: rand(3, 6), color: pick(CONFETTI), life: rand(2.6, 4), age: 0, floor: a.bottom,
      });
    }
  }

  function petals(scale) {
    const a = area();
    const n = Math.round((reduce ? 30 : 110) * scale);
    for (let i = 0; i < n; i++) {
      parts.push({
        kind: "petal", x: rand(a.left, a.right), y: a.top - rand(0, a.height * 0.6),
        vx: rand(-30, 30), vy: rand(50, 120), g: 30, rot: rand(0, 6), vr: rand(-3, 3), sway: rand(0, 6),
        w: rand(5, 9), h: rand(9, 14), color: pick(MARIGOLD), life: rand(3.5, 5.5), age: 0, floor: a.bottom,
      });
    }
  }

  function hearts(scale) {
    const a = area();
    const n = Math.round((reduce ? 12 : 36) * scale);
    for (let i = 0; i < n; i++) {
      parts.push({
        kind: "heart", x: rand(a.left + a.width * 0.1, a.right - a.width * 0.1), y: a.bottom + rand(0, 160),
        vx: 0, vy: -rand(90, 170), g: 0, sway: rand(0, 6), s: rand(10, 22),
        color: pick(["#e11d48", "#f43f5e", "#ec4899", "#b3303a", "#fb7185"]), life: rand(2.8, 4), age: 0, top: a.top,
      });
    }
  }

  // A rangoli that blooms in the middle of the chat: rings of petals and dots, then fades
  function rangoli(scale) {
    const a = area();
    const size = Math.min(a.width, a.height) * 0.36 * scale;
    rangolis.push({
      x: a.left + a.width / 2, y: a.top + a.height / 2, size, age: 0, life: reduce ? 1.6 : 3.4,
      folds: pick([8, 10, 12]), spin: rand(-0.25, 0.25),
      colors: [pick(["#db2777", "#be185d", "#c026d3"]), pick(["#f97316", "#f59e0b"]), pick(["#0d9488", "#16a34a"]), "#fbbf24", "#2563eb"],
    });
  }

  function heartPath(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s * 0.5, y - s * 0.2, x - s * 0.5, y + s * 0.15);
    ctx.bezierCurveTo(x - s * 0.5, y + s * 0.5, x, y + s * 0.7, x, y + s * 0.9);
    ctx.bezierCurveTo(x, y + s * 0.7, x + s * 0.5, y + s * 0.5, x + s * 0.5, y + s * 0.15);
    ctx.bezierCurveTo(x + s * 0.5, y - s * 0.2, x, y, x, y + s * 0.3);
    ctx.closePath();
  }

  function drawRangoli(r) {
    const k = r.age / r.life;
    const grow = Math.min(1, k / 0.45);
    const ease = 1 - Math.pow(1 - grow, 3);
    const alpha = k < 0.75 ? 1 : Math.max(0, 1 - (k - 0.75) / 0.25);
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.spin * r.age);
    ctx.globalAlpha = alpha * 0.92;
    const S = r.size;
    const rings = [
      { at: 0.25, len: 0.22, wide: 0.1, c: r.colors[0] },
      { at: 0.5, len: 0.26, wide: 0.12, c: r.colors[1] },
      { at: 0.78, len: 0.22, wide: 0.1, c: r.colors[2] },
    ];
    rings.forEach((ring, ri) => {
      const show = Math.max(0, Math.min(1, ease * 3 - ri)); // rings appear one after another
      if (!show) return;
      const n = r.folds * (ri + 1);
      ctx.fillStyle = ring.c;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        ctx.save();
        ctx.rotate(ang);
        ctx.translate(0, -S * ring.at * show);
        ctx.beginPath();
        ctx.ellipse(0, 0, S * ring.wide * show * 0.5, S * ring.len * show * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // dotted circle between rings
      ctx.fillStyle = r.colors[3];
      const dots = r.folds * 4;
      for (let i = 0; i < dots; i++) {
        const ang = (i / dots) * Math.PI * 2;
        const rr = S * (ring.at + ring.len * 0.65) * show;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * rr, Math.sin(ang) * rr, Math.max(1.5, S * 0.012), 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // centre flower
    ctx.fillStyle = r.colors[4];
    ctx.beginPath();
    ctx.arc(0, 0, S * 0.1 * ease, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = r.colors[3];
    ctx.beginPath();
    ctx.arc(0, 0, S * 0.05 * ease, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function frame(t) {
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    parts = parts.filter((p) => (p.age += dt) < p.life);
    for (const p of parts) {
      const fade = p.age > p.life - 0.6 ? Math.max(0, (p.life - p.age) / 0.6) : 1;
      ctx.globalAlpha = fade;
      if (p.kind === "heart") {
        p.y += p.vy * dt;
        p.x += Math.sin(p.age * 3 + p.sway) * 30 * dt;
        ctx.fillStyle = p.color;
        heartPath(p.x, p.y, p.s);
        ctx.fill();
        continue;
      }
      p.vy += p.g * dt;
      p.vx *= 1 - 0.8 * dt;
      p.x += p.vx * dt + (p.sway != null ? Math.sin(p.age * 2.4 + p.sway) * 40 * dt : 0);
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.y > p.floor + 20) { p.age = p.life; continue; }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.kind === "petal") {
        ctx.scale(1, Math.cos(p.rot * 1.3));
        ctx.beginPath();
        ctx.ellipse(0, 0, p.w / 2, p.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.scale(1, Math.cos(p.rot * 1.7));
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    rangolis = rangolis.filter((r) => (r.age += dt) < r.life);
    for (const r of rangolis) drawRangoli(r);
    if (parts.length || rangolis.length) raf = requestAnimationFrame(frame);
    else { raf = 0; ctx.clearRect(0, 0, W, H); }
  }

  function play(name, scale = 1) {
    if (document.hidden) return;
    resize();
    if (name === "confetti") confetti(scale);
    else if (name === "petals") petals(scale);
    else if (name === "hearts") hearts(scale);
    else if (name === "rangoli") rangoli(scale);
    else return;
    if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
  }

  window.sandesEffects = {
    play: (name) => play(name, 1),
    // a small taste when you pick an effect
    preview: (name) => play(name, 0.35),
  };
})();
