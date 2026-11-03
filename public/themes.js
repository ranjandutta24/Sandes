/* Sandes · festival themes (chosen by an admin in Settings)
 *
 * Sets body[data-theme] for the decorations in themes.css, adds a greeting under the logo,
 * and runs a light background animation behind the messages: diya embers for Diwali,
 * drifting colour for Holi, falling shiuli flowers for Durga Puja, snow for Christmas.
 * Anyone can switch the animation off for themselves by clicking the greeting.
 */
(() => {
  "use strict";

  const THEMES = {
    diwali: { greet: "Shubh Deepavali 🪔", count: 22 },
    holi: { greet: "Happy Holi 🎨", count: 12 },
    durga_puja: { greet: "Shubho Pujo 🌺", count: 16 },
    christmas: { greet: "Merry Christmas 🎄", count: 70 },
  };

  const chatEl = document.getElementById("chat");
  const brand = document.querySelector(".brand");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motionKey = "sandes.themeMotion";

  const greet = document.createElement("button");
  greet.type = "button";
  greet.className = "theme-greet";
  greet.hidden = true;
  brand.append(greet);

  const garland = document.createElement("div");
  garland.className = "theme-garland";
  garland.setAttribute("aria-hidden", "true");
  chatEl.querySelector(".chat-head").append(garland);

  const canvas = document.createElement("canvas");
  canvas.className = "theme-canvas";
  canvas.setAttribute("aria-hidden", "true");
  chatEl.prepend(canvas);
  const ctx = canvas.getContext("2d");

  let theme = "none";
  let parts = [];
  let raf = 0, last = 0, W = 0, H = 0, dpr = 1;

  const motionOn = () => !reduce && localStorage.getItem(motionKey) !== "off";
  const rand = (a, b) => a + Math.random() * (b - a);

  function resize() {
    const r = chatEl.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  new ResizeObserver(resize).observe(chatEl);

  function spawn(initial) {
    const p = { x: rand(0, W), y: initial ? rand(0, H) : 0, t: rand(0, Math.PI * 2) };
    switch (theme) {
      case "diwali": // warm embers rising from the bottom
        p.y = initial ? rand(0, H) : H + 10;
        Object.assign(p, { vy: -rand(10, 28), vx: rand(-6, 6), r: rand(1.4, 3.2), life: rand(6, 12), age: 0, hue: rand(28, 48) });
        break;
      case "holi": // big soft colour clouds drifting sideways
        Object.assign(p, { vx: rand(-8, 8), vy: rand(-4, 4), r: rand(40, 110), color: ["255,61,127", "255,184,0", "46,213,115", "30,144,255", "165,94,234"][Math.floor(rand(0, 5))], life: rand(9, 16), age: initial ? rand(0, 8) : 0 });
        if (!initial) p.y = rand(0, H);
        break;
      case "durga_puja": // shiuli flowers drifting down
        p.y = initial ? rand(0, H) : -12;
        Object.assign(p, { vy: rand(14, 26), vx: rand(-8, 8), r: rand(5, 8), spin: rand(-1, 1), a: rand(0, 6) });
        break;
      case "christmas":
        p.y = initial ? rand(0, H) : -6;
        Object.assign(p, { vy: rand(18, 42), vx: rand(-6, 6), r: rand(1.2, 3.2) });
        break;
    }
    return p;
  }

  function shiuli(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.strokeStyle = "rgba(190,150,120,0.35)";
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.ellipse(0, -p.r * 0.75, p.r * 0.32, p.r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.arc(0, 0, p.r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    if (document.hidden) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.t += dt;
      p.x += (p.vx || 0) * dt + Math.sin(p.t) * 0.15;
      p.y += (p.vy || 0) * dt;
      if (p.spin) p.a += p.spin * dt;
      if (p.life) p.age += dt;
      let gone = p.y > H + 20 || p.y < -30 || p.x < -150 || p.x > W + 150;
      if (p.life && p.age > p.life) gone = true;
      if (gone) { parts[i] = spawn(false); continue; }
      switch (theme) {
        case "diwali": {
          const k = p.age / p.life, a = Math.sin(Math.PI * k) * 0.9;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
          g.addColorStop(0, `hsla(${p.hue},100%,70%,${a})`);
          g.addColorStop(0.3, `hsla(${p.hue},100%,55%,${a * 0.35})`);
          g.addColorStop(1, `hsla(${p.hue},100%,50%,0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 5, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "holi": {
          const k = p.age / p.life, a = Math.sin(Math.PI * Math.min(1, k)) * 0.16;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          g.addColorStop(0, `rgba(${p.color},${a})`);
          g.addColorStop(1, `rgba(${p.color},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "durga_puja":
          shiuli(p);
          break;
        case "christmas":
          ctx.fillStyle = "rgba(255,255,255,0.95)";
          ctx.strokeStyle = "rgba(110,140,185,0.35)";
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
      }
    }
  }

  function startMotion() {
    cancelAnimationFrame(raf);
    raf = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts = [];
    if (theme === "none" || !motionOn()) return;
    resize();
    parts = Array.from({ length: THEMES[theme].count }, () => spawn(true));
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function set(next) {
    next = THEMES[next] ? next : "none";
    if (next === theme) return;
    theme = next;
    if (theme === "none") delete document.body.dataset.theme;
    else document.body.dataset.theme = theme;
    greet.hidden = theme === "none";
    if (theme !== "none") {
      greet.textContent = THEMES[theme].greet;
      greet.title = motionOn() ? "Click to pause the festive animation" : "Click to play the festive animation";
    }
    startMotion();
  }

  greet.onclick = () => {
    if (reduce) return;
    localStorage.setItem(motionKey, motionOn() ? "off" : "on");
    greet.title = motionOn() ? "Click to pause the festive animation" : "Click to play the festive animation";
    startMotion();
    window.sandesChat?.toast(motionOn() ? "Festive animation on" : "Festive animation paused");
  };

  window.sandesThemes = { set };
  if (window.sandesSettings) set(window.sandesSettings.festival_theme);
})();
