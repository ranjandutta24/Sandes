/* Sandes · Diwali crackers
 *
 * Pick a cracker, set it down in the chat, then touch its fuse with the dhoop kathi
 * (the glowing incense stick that replaces your cursor). Everyone who has the same
 * conversation open sees the cracker, your stick and the blast, and hears it.
 *
 * Live socket events only; nothing is stored. Sound is synthesised with Web Audio.
 * Uses globals from index.html: `socket`, `activeId`.
 */
(() => {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const chatEl = document.getElementById("chat");
  const feedEl = document.getElementById("feed");
  const composerInner = document.querySelector(".composer-inner");
  const crackerBtn = document.getElementById("crackerBtn");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const DENSITY = reduceMotion ? 0.5 : 1;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const now = () => performance.now();
  const newId = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

  /* =====================================================================
   * Artwork. Every cracker is drawn with (0,0) where it sits on the ground;
   * `tip` is the free end of the fuse. 1 SVG unit = 1 CSS pixel.
   * ===================================================================== */
  const LADI_POPS = Array.from({ length: 12 }, (_, i) => [-56 + i * 10.2, -4]);

  const KINDS = {
    bomb: {
      name: "Sutli bomb", blurb: "One big bang", fuseMs: 1900,
      vb: [-36, -84, 72, 88], tip: [15, -79],
      art: `
        <ellipse cx="0" cy="0" rx="26" ry="4" fill="#1b2a47" opacity=".18"/>
        <circle cx="0" cy="-30" r="27" fill="url(#ck-twine)"/>
        <g clip-path="url(#ck-ball)" fill="none" stroke="#6e4c22" stroke-width="1.3" opacity=".75">
          <path d="M-30 -50 Q0 -32 30 -50 M-30 -42 Q0 -24 30 -42 M-30 -34 Q0 -16 30 -34 M-30 -26 Q0 -8 30 -26 M-30 -18 Q0 0 30 -18 M-30 -10 Q0 8 30 -10"/>
          <path d="M-22 -62 Q-6 -30 -22 2 M-12 -62 Q4 -30 -12 2 M-2 -62 Q14 -30 -2 2 M8 -62 Q24 -30 8 2" opacity=".55"/>
        </g>
        <rect x="-13" y="-37" width="26" height="13" rx="2" fill="#c8323a" stroke="#f3c654" stroke-width="1.2"/>
        <path d="M-7 -30.5 h14" stroke="#f3c654" stroke-width="1.4" stroke-dasharray="2 2"/>
        <circle cx="-10" cy="-44" r="7" fill="#fff" opacity=".2"/>
        <path class="fuse" d="M15 -79 C 10 -72, 3 -66, 0 -57"/>`,
    },
    rocket: {
      name: "Rocket", blurb: "Up and burst", fuseMs: 1300,
      vb: [-26, -128, 48, 132], tip: [-16, -58],
      art: `
        <ellipse cx="0" cy="0" rx="16" ry="3" fill="#1b2a47" opacity=".16"/>
        <g class="rocket-body">
          <line x1="0" y1="-106" x2="0" y2="-12" stroke="#c9a46a" stroke-width="2.2" stroke-linecap="round"/>
          <rect x="-12" y="-108" width="11" height="40" rx="1.5" fill="url(#ck-red)"/>
          <rect x="-12" y="-100" width="11" height="3" fill="url(#ck-gold)"/>
          <rect x="-12" y="-79" width="11" height="3" fill="url(#ck-gold)"/>
          <path d="M-12.5 -108 L-6.5 -124 L-0.5 -108 Z" fill="url(#ck-gold)"/>
          <path class="fuse" d="M-16 -58 C -12 -61, -8.5 -64, -6.5 -68"/>
        </g>
        <path d="M-3.5 -48 L-3.5 -38 C -3.5 -32, -14 -30, -14 -22 L-14 -2 Q-14 0 -12 0 L12 0 Q14 0 14 -2 L14 -22 C 14 -30, 3.5 -32, 3.5 -38 L3.5 -48 Z"
              fill="url(#ck-glass)" stroke="#3c7a55" stroke-opacity=".55" stroke-width="1"/>
        <rect x="-4.6" y="-50" width="9.2" height="3" rx="1" fill="#3c7a55" opacity=".65"/>
        <path d="M-9 -24 L-9 -5" stroke="#fff" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"/>`,
    },
    anar: {
      name: "Anar", blurb: "Golden fountain", fuseMs: 1300,
      vb: [-30, -70, 60, 74], tip: [7, -66],
      art: `
        <ellipse cx="0" cy="0" rx="25" ry="4" fill="#1b2a47" opacity=".18"/>
        <path d="M-23 -2 C -20 -20, -10 -42, -4 -52 L 4 -52 C 10 -42, 20 -20, 23 -2 Q 0 3 -23 -2 Z" fill="url(#ck-clay)"/>
        <g clip-path="url(#ck-cone)">
          <path d="M-30 -17 Q0 -11 30 -17 L30 -8 Q0 -2 -30 -8 Z" fill="url(#ck-green)"/>
          <path d="M-30 -38 Q0 -33 30 -38 L30 -31 Q0 -26 -30 -31 Z" fill="url(#ck-red)"/>
          <g fill="#f8d77a"><circle cx="-9" cy="-23" r="1.4"/><circle cx="0" cy="-21.5" r="1.4"/><circle cx="9" cy="-23" r="1.4"/><circle cx="-4" cy="-44" r="1"/><circle cx="4" cy="-44" r="1"/></g>
          <path d="M-13 -28 C -10 -37, -7 -44, -3 -50" stroke="#fff" stroke-opacity=".25" stroke-width="3" fill="none" stroke-linecap="round"/>
        </g>
        <ellipse cx="0" cy="-52" rx="4.5" ry="1.6" fill="#6b3712"/>
        <path class="fuse" d="M7 -66 C 4 -62, 1 -58, 0 -53"/>`,
    },
    chakri: {
      name: "Chakri", blurb: "Spinning wheel", fuseMs: 1300,
      vb: [-30, -26, 72, 30], tip: [38, -17],
      art: `
        <ellipse cx="0" cy="-1" rx="27" ry="4" fill="#1b2a47" opacity=".16"/>
        <path d="M-25 -12 L-25 -8 A25 10 0 0 0 25 -8 L25 -12 Z" fill="#7d1820"/>
        <ellipse cx="0" cy="-12" rx="25" ry="10" fill="url(#ck-red)"/>
        <ellipse cx="0" cy="-12" rx="20" ry="8" fill="none" stroke="#2f9a5a" stroke-width="3"/>
        <ellipse cx="0" cy="-12" rx="14" ry="5.6" fill="none" stroke="#f3c654" stroke-width="3"/>
        <ellipse cx="0" cy="-12" rx="8" ry="3.2" fill="none" stroke="#2f9a5a" stroke-width="2.6"/>
        <ellipse cx="0" cy="-12" rx="3" ry="1.3" fill="#f6e7c1"/>
        <path class="fuse" d="M38 -17 C 33 -15, 29 -13, 24 -12"/>`,
    },
    ladi: {
      name: "Ladi", blurb: "Chain of pops", fuseMs: 900,
      vb: [-74, -26, 150, 30], tip: [-70, -20],
      art: `
        <path d="M-62 -10 C -40 -13, -20 -7, 0 -10 S 40 -13, 62 -10" fill="none" stroke="#e2cf98" stroke-width="1.5"/>
        ${LADI_POPS.map(([x], i) => `
          <g class="pop" transform="translate(${x} -10) rotate(${i % 2 ? 22 : -22})">
            <rect x="-2.7" y="0" width="5.4" height="13" rx="1.2" fill="url(#ck-red)"/>
            <rect x="-2.7" y="3" width="5.4" height="1.6" fill="#f3c654"/>
          </g>`).join("")}
        <path class="fuse" d="M-70 -20 C -68 -15, -65 -12, -62 -10"/>`,
    },
  };

  // One shared set of gradients (kept out of display:none so every browser renders them)
  const defs = document.createElementNS(NS, "svg");
  defs.setAttribute("width", "0");
  defs.setAttribute("height", "0");
  defs.setAttribute("aria-hidden", "true");
  defs.style.position = "absolute";
  defs.innerHTML = `<defs>
    <radialGradient id="ck-twine" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#e6c891"/><stop offset=".6" stop-color="#b38b52"/><stop offset="1" stop-color="#7a5a2e"/></radialGradient>
    <linearGradient id="ck-red" x1="0" x2="1"><stop offset="0" stop-color="#7d1820"/><stop offset=".45" stop-color="#d63c41"/><stop offset="1" stop-color="#8d1f26"/></linearGradient>
    <linearGradient id="ck-gold" x1="0" x2="1"><stop offset="0" stop-color="#9a6a12"/><stop offset=".5" stop-color="#f3c654"/><stop offset="1" stop-color="#a8751a"/></linearGradient>
    <linearGradient id="ck-clay" x1="0" x2="1"><stop offset="0" stop-color="#8a4a1c"/><stop offset=".45" stop-color="#dd8f41"/><stop offset="1" stop-color="#934f1f"/></linearGradient>
    <linearGradient id="ck-green" x1="0" x2="1"><stop offset="0" stop-color="#14522f"/><stop offset=".5" stop-color="#2f9a5a"/><stop offset="1" stop-color="#17583a"/></linearGradient>
    <linearGradient id="ck-glass" x1="0" x2="1"><stop offset="0" stop-color="#5f9f78" stop-opacity=".55"/><stop offset=".35" stop-color="#cfe9d8" stop-opacity=".5"/><stop offset="1" stop-color="#3c7a55" stop-opacity=".6"/></linearGradient>
    <radialGradient id="ck-ember-g"><stop offset="0" stop-color="#fff3c4"/><stop offset=".35" stop-color="#ff9a2e" stop-opacity=".85"/><stop offset="1" stop-color="#ff5a00" stop-opacity="0"/></radialGradient>
    <clipPath id="ck-ball"><circle cx="0" cy="-30" r="27"/></clipPath>
    <clipPath id="ck-cone"><path d="M-23 -2 C -20 -20, -10 -42, -4 -52 L 4 -52 C 10 -42, 20 -20, 23 -2 Q 0 3 -23 -2 Z"/></clipPath>
  </defs>`;
  document.body.append(defs);

  function artSvg(kind) {
    const k = KINDS[kind];
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", k.vb.join(" "));
    s.setAttribute("width", k.vb[2]);
    s.setAttribute("height", k.vb[3]);
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = k.art; // static artwork authored above, no user data
    return s;
  }

  function stickSvg() {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "-12 -12 174 24");
    s.setAttribute("width", "174");
    s.setAttribute("height", "24");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = `
      <circle class="halo" cx="0" cy="0" r="12" fill="url(#ck-ember-g)"/>
      <line x1="5" y1="0" x2="112" y2="0" stroke="#4a2618" stroke-width="5" stroke-linecap="round"/>
      <line x1="7" y1="-1.3" x2="110" y2="-1.3" stroke="#7a4430" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>
      <line x1="112" y1="0" x2="160" y2="0" stroke="#d8b679" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="2" y1="0" x2="6.5" y2="0" stroke="#a49c92" stroke-width="5" stroke-linecap="round"/>
      <circle class="ember" cx="0" cy="0" r="2.9" fill="#ffb347"/>`;
    return s;
  }

  /* =====================================================================
   * Sound: synthesised bangs, hiss, whistle and crackle (no audio files)
   * ===================================================================== */
  const Sound = (() => {
    let ac = null, out = null, noiseBuf = null;
    let muted = localStorage.getItem("sandes.crackerSound") === "off";

    function init() {
      if (ac) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.3;
      out = ac.createGain();
      out.gain.value = 0.9;
      out.connect(comp).connect(ac.destination);
      const len = ac.sampleRate * 2;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return ac;
    }

    // Browsers only allow audio after the user has interacted with the page
    const unlock = () => { if (init() && ac.state === "suspended") ac.resume(); };
    ["pointerdown", "keydown", "touchstart"].forEach((t) => addEventListener(t, unlock, { passive: true }));

    const ready = () => !muted && ac && ac.state === "running";

    function noise(t, dur) {
      const s = ac.createBufferSource();
      s.buffer = noiseBuf;
      s.loop = true;
      s.start(t, Math.random() * 1.9);
      s.stop(t + dur + 0.05);
      return s;
    }

    function filt(type, f, q = 0.7) {
      const b = ac.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    }

    function env(g, t, peak, attack, decay) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    function shaper(k) {
      const ws = ac.createWaveShaper();
      const n = 1024, c = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
      ws.curve = c;
      return ws;
    }

    function bang(size = 1, delay = 0) {
      if (!ready()) return;
      const t = ac.currentTime + delay;
      // the crack
      const n = noise(t, 0.3 + size * 1.2);
      const lp = filt("lowpass", 9000);
      lp.frequency.setValueAtTime(9000, t);
      lp.frequency.exponentialRampToValueAtTime(260, t + 0.1 + 0.3 * size);
      const g = ac.createGain();
      env(g, t, Math.min(1.3, 0.9 * size + 0.2), 0.002, 0.15 + 0.55 * size);
      n.connect(lp).connect(g).connect(out);
      // the thump
      const o = ac.createOscillator();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(36, t + 0.12 + 0.3 * size);
      const og = ac.createGain();
      env(og, t, Math.min(1.2, 0.8 * size + 0.15), 0.004, 0.2 + 0.6 * size);
      (size > 1.2 ? o.connect(shaper(6)) : o).connect(og).connect(out);
      o.start(t);
      o.stop(t + 0.5 + size);
      // rolling rumble for big ones
      if (size > 1) {
        const r = noise(t, 2.4 * size);
        const rg = ac.createGain();
        env(rg, t, 0.55, 0.02, 1.6 * size);
        r.connect(filt("lowpass", 170)).connect(rg).connect(out);
      }
    }

    function pop(size = 1, delay = 0) {
      if (!ready()) return;
      const t = ac.currentTime + delay;
      const n = noise(t, 0.2);
      const lp = filt("lowpass", 7000);
      lp.frequency.setValueAtTime(7000, t);
      lp.frequency.exponentialRampToValueAtTime(700, t + 0.09);
      const g = ac.createGain();
      env(g, t, 0.75 * size, 0.001, 0.09 + 0.05 * size);
      n.connect(lp).connect(g).connect(out);
      const o = ac.createOscillator();
      o.frequency.setValueAtTime(260 * rand(0.85, 1.2), t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.1);
      const og = ac.createGain();
      env(og, t, 0.5 * size, 0.002, 0.12);
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + 0.25);
    }

    function crackle(dur, count, delay = 0) {
      if (!ready()) return;
      const t0 = ac.currentTime + delay;
      for (let i = 0; i < count; i++) {
        const t = t0 + Math.random() * dur;
        const g = ac.createGain();
        env(g, t, rand(0.12, 0.42), 0.001, rand(0.01, 0.045));
        noise(t, 0.06).connect(filt("highpass", rand(1500, 4500))).connect(g).connect(out);
      }
    }

    function hiss(dur, { freq = 4000, q = 0.8, gain = 0.25, attack = 0.08, release = 0.4, delay = 0, lfo = 0, lfoDepth = 0 } = {}) {
      if (!ready()) return;
      const t = ac.currentTime + delay;
      const bp = filt("bandpass", freq, q);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + attack);
      g.gain.setValueAtTime(gain, t + Math.max(attack, dur));
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack, dur) + release);
      if (lfo) {
        const l = ac.createOscillator();
        l.frequency.value = lfo;
        const lg = ac.createGain();
        lg.gain.value = lfoDepth;
        l.connect(lg).connect(bp.frequency);
        l.start(t);
        l.stop(t + dur + release);
      }
      noise(t, dur + release).connect(bp).connect(g).connect(out);
    }

    return {
      unlock,
      bang,
      pop,
      crackle,
      fuse(dur) {
        hiss(dur, { freq: 6000, q: 0.9, gain: 0.1, attack: 0.03, release: 0.08 });
        crackle(dur, Math.round(dur * 16));
      },
      whistle(dur) {
        if (!ready()) return;
        const t = ac.currentTime;
        const o = ac.createOscillator();
        o.type = "triangle";
        o.frequency.setValueAtTime(700, t);
        o.frequency.exponentialRampToValueAtTime(2500, t + dur);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + dur + 0.05);
        hiss(dur, { freq: 2600, q: 0.6, gain: 0.2, attack: 0.02, release: 0.1 });
      },
      fountain(dur) {
        hiss(dur, { freq: 3200, q: 0.5, gain: 0.3, attack: 0.25, release: 0.6 });
        hiss(dur, { freq: 900, q: 0.7, gain: 0.16, attack: 0.3, release: 0.6 });
        crackle(dur, Math.round(dur * 24));
      },
      whirr(dur) {
        hiss(dur, { freq: 2600, q: 2.2, gain: 0.3, attack: 0.3, release: 0.5, lfo: 22, lfoDepth: 1200 });
        crackle(dur, Math.round(dur * 14));
      },
      get muted() { return muted; },
      setMuted(m) {
        muted = m;
        localStorage.setItem("sandes.crackerSound", m ? "off" : "on");
      },
    };
  })();

  /* =====================================================================
   * Layers & particle engine (canvas)
   * ===================================================================== */
  const mk = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });
  const layer = mk("div", "ck-layer");       // the crackers
  const canvas = mk("canvas", "ck-canvas");  // night sky + sparks
  const top = mk("div", "ck-top");           // sticks, ghost
  const capture = mk("div", "ck-capture");   // takes the pointer while placing / lighting
  const hint = mk("div", "ck-hint");
  capture.hidden = hint.hidden = true;
  chatEl.append(layer, canvas, top, capture, hint);

  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;

  function sprite(size, stops) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
  }
  const GLOW = sprite(128, [[0, "rgba(255,250,235,1)"], [0.18, "rgba(255,214,140,.9)"], [0.45, "rgba(255,140,40,.35)"], [1, "rgba(255,90,0,0)"]]);
  const SMOKE = sprite(96, [[0, "rgba(188,190,198,.9)"], [0.5, "rgba(172,174,184,.45)"], [1, "rgba(160,162,172,0)"]]);

  const GOLD = ["255,206,110", "255,226,150", "255,178,70"];
  const WHITE = ["255,248,230"];
  const PALETTES = [
    ["255,82,82", "255,170,120"], ["110,255,150", "210,255,200"], ["110,170,255", "220,235,255"],
    ["255,110,220", "255,200,240"], ["255,210,90", "255,250,220"], ["190,120,255", "240,210,255"],
  ];
  const PAPER = ["#c8323a", "#e04a4f", "#9a2a2a", "#d9b77a", "#f3c654"];

  const P = [];
  const flashes = [];
  const rings = [];
  const emitters = new Set();
  const MAXP = reduceMotion ? 1500 : 3500;
  const NIGHT = 0.62;
  let nightUntil = 0, dim = 0, running = false, lastT = 0;

  function spawn(o) {
    if (P.length < MAXP) P.push(Object.assign({ age: 0, g: 0, drag: 0, vx: 0, vy: 0, size: 2, life: 1, flicker: 0, rot: 0, vr: 0, grow: 1, alpha: 1 }, o));
  }
  const flash = (x, y, r, life) => flashes.push({ x, y, r, life, age: 0 });
  const night = (ms) => { nightUntil = Math.max(nightUntil, now() + ms); kick(); };

  function addEmitter(e) {
    e.start = e.at || now();
    emitters.add(e);
    kick();
    return e;
  }
  const later = (ms, done) => addEmitter({ at: now() + ms, until: now() + ms, done });

  function burst(x, y, n, { speed = [100, 300], g = 200, drag = 2, life = [0.4, 0.9], size = [1.2, 2.2], colors = GOLD, flicker = 0, ring = false } = {}) {
    n = Math.round(n * DENSITY);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = ring ? speed[1] * rand(0.88, 1) : rand(speed[0], speed[1]);
      spawn({ type: "spark", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g, drag, life: rand(...life), size: rand(...size), color: pick(colors), flicker });
    }
  }

  function smoke(x, y, n, { size = [24, 44], life = [2, 3.5], alpha = 0.5, spread = 24, grow = 1.4, rise = [10, 40] } = {}) {
    for (let i = 0; i < n; i++) {
      spawn({ type: "smoke", x: x + rand(-spread, spread), y: y + rand(-spread / 2, spread / 2), vx: rand(-25, 25), vy: -rand(...rise), g: -4, drag: 0.9, life: rand(...life), size: rand(...size), alpha, grow });
    }
  }

  function paper(x, y, n, { speed = [120, 420], life = [1.6, 2.6] } = {}) {
    n = Math.round(n * DENSITY);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rand(-1.35, 1.35), sp = rand(...speed);
      spawn({ type: "paper", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 620, drag: 1.8, life: rand(...life), size: rand(2.5, 5), color: pick(PAPER), rot: rand(0, 6), vr: rand(-14, 14) });
    }
  }

  function shake(px, ms) {
    if (reduceMotion) return;
    const kf = [];
    for (let i = 0; i <= 10; i++) {
      const m = px * (1 - i / 10);
      kf.push({ transform: i === 10 ? "none" : `translate(${rand(-m, m).toFixed(1)}px, ${rand(-m, m).toFixed(1)}px)` });
    }
    chatEl.animate(kf, { duration: ms });
  }

  function fade(node, delay = 0, dur = 600) {
    node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, delay, fill: "forwards" }).onfinish = () => node.remove();
  }

  function kick() {
    if (running) return;
    running = true;
    lastT = now();
    requestAnimationFrame(frame);
  }

  function frame(t) {
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
    lastT = t;

    for (const e of [...emitters]) {
      if (!emitters.has(e)) continue;
      if (e.at && t < e.at) continue;
      if (t >= e.until) { emitters.delete(e); e.done && e.done(); continue; }
      e.tick && e.tick(t, dt);
    }

    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.age += dt;
      if (p.age >= p.life) { P[i] = P[P.length - 1]; P.pop(); continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (const list of [flashes, rings]) {
      for (let i = list.length - 1; i >= 0; i--) if ((list[i].age += dt) >= list[i].life) list.splice(i, 1);
    }

    const target = t < nightUntil ? NIGHT : 0;
    dim += (target - dim) * (1 - Math.exp(-dt * (target > dim ? 5 : 2.2)));
    draw();

    if (emitters.size || P.length || flashes.length || rings.length || dim > 0.004 || t < nightUntil) {
      requestAnimationFrame(frame);
    } else {
      running = false;
      dim = 0;
      ctx.clearRect(0, 0, W, H);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (dim > 0.004) {
      ctx.fillStyle = `rgba(8,12,30,${dim.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }

    // smoke + paper bits (normal blending)
    for (const p of P) {
      const k = p.age / p.life;
      if (p.type === "smoke") {
        const r = p.size * (1 + k * p.grow);
        ctx.globalAlpha = p.alpha * (1 - k) * Math.min(1, k / 0.08);
        ctx.drawImage(SMOKE, p.x - r, p.y - r, r * 2, r * 2);
      } else if (p.type === "paper") {
        ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.rot * 1.7));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;

    // light: additive once it's dark enough to glow
    ctx.globalCompositeOperation = dim > 0.25 ? "lighter" : "source-over";
    for (const f of flashes) {
      const k = f.age / f.life;
      ctx.globalAlpha = (1 - k) * (1 - k);
      ctx.drawImage(GLOW, f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    }
    ctx.globalAlpha = 1;
    for (const r of rings) {
      const k = r.age / r.life, e = 1 - Math.pow(1 - k, 3);
      ctx.strokeStyle = `rgba(255,236,200,${((1 - k) * 0.55).toFixed(3)})`;
      ctx.lineWidth = 2 + 12 * (1 - k);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineCap = "round";
    for (const p of P) {
      if (p.type !== "spark") continue;
      const k = p.age / p.life;
      if (p.flicker && k > 1 - p.flicker && Math.random() < 0.45) continue;
      ctx.strokeStyle = `rgba(${p.color},${(1 - k * k).toFixed(3)})`;
      ctx.lineWidth = p.size * (1 - k * 0.5);
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /* =====================================================================
   * Geometry: positions are shared as fractions of the message area so
   * they land in the same spot on every screen size.
   * ===================================================================== */
  function feedBox() {
    const c = chatEl.getBoundingClientRect(), f = feedEl.getBoundingClientRect();
    return { x: f.left - c.left, y: f.top - c.top, w: f.width, h: f.height };
  }
  const toNorm = (px, py) => { const b = feedBox(); return [(px - b.x) / b.w, (py - b.y) / b.h]; };
  const fromNorm = (nx, ny) => { const b = feedBox(); return [b.x + nx * b.w, b.y + ny * b.h]; };
  const localPoint = (e) => { const c = chatEl.getBoundingClientRect(); return [e.clientX - c.left, e.clientY - c.top]; };

  function clampBase(kind, px, py) {
    const [vx, vy, vw] = KINDS[kind].vb, b = feedBox();
    return [clamp(px, b.x - vx + 6, b.x + b.w - (vx + vw) - 6), clamp(py, b.y - vy + 8, b.y + b.h - 8)];
  }

  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function setNodePos(node, kind, px, py) {
    const [vx, vy] = KINDS[kind].vb;
    node.style.transform = `translate(${px + vx}px, ${py + vy}px)`;
  }

  function resize() {
    const r = chatEl.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const c of crackers.values()) {
      position(c);
      if (c.stick && c.stickN) placeStick(c.stick, ...fromNorm(...c.stickN));
    }
    layoutOverlay();
  }

  function layoutOverlay() {
    const b = feedBox();
    Object.assign(capture.style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });
    hint.style.top = b.y + 12 + "px";
  }

  /* =====================================================================
   * Crackers & sticks
   * ===================================================================== */
  const crackers = new Map();

  function makeNode(kind, cls) {
    const node = mk("div", cls);
    const svg = artSvg(kind);
    node.append(svg);
    return { node, svg };
  }

  function position(c) {
    [c.px, c.py] = fromNorm(c.nx, c.ny);
    setNodePos(c.node, c.kind, c.px, c.py);
  }

  const at = (c, lx, ly) => [c.px + lx, c.py + ly];

  function addCracker({ id, kind, nx, ny, by, mine }) {
    const { node, svg } = makeNode(kind, "ck");
    if (by) node.append(Object.assign(mk("span", "ck-by"), { textContent: by }));
    layer.append(node);
    const c = { id, kind, k: KINDS[kind], nx, ny, node, svg, fuse: svg.querySelector(".fuse"), mine: !!mine, lit: false, stick: null };
    crackers.set(id, c);
    position(c);
    svg.animate([{ transform: "translateY(-14px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260, easing: "cubic-bezier(.2,.9,.3,1.3)" });
    if (!mine) c.expire = setTimeout(() => removeCracker(c), 90000); // owner vanished without telling us
    return c;
  }

  function removeCracker(c) {
    crackers.delete(c.id);
    clearTimeout(c.expire);
    if (c.stick) { dropStick(c.stick, 0); c.stick = null; }
    fade(c.node, 0, 250);
  }

  function makeStick(label) {
    const node = mk("div", "ck-stick");
    node.append(stickSvg());
    if (label) node.append(Object.assign(mk("span", "ck-who"), { textContent: label }));
    node.style.visibility = "hidden";
    top.append(node);
    const s = { node, x: NaN, y: NaN };
    // a thin wisp of incense smoke from the tip
    s.smoke = addEmitter({
      until: Infinity,
      tick(t, dt) {
        if (Number.isNaN(s.x) || Math.random() > dt * 9) return;
        spawn({ type: "smoke", x: s.x + rand(-1, 1), y: s.y - 2, vx: rand(-8, 8), vy: rand(-34, -22), g: -6, drag: 0.4, life: rand(1.3, 2), size: rand(3, 5), alpha: 0.28, grow: 2.6 });
      },
    });
    return s;
  }

  function placeStick(s, x, y) {
    s.x = x;
    s.y = y;
    s.node.style.visibility = "visible";
    s.node.style.transform = `translate(${x}px, ${y}px)`;
  }

  function dropStick(s, delay) {
    emitters.delete(s.smoke);
    fade(s.node, delay, 350);
  }

  /* =====================================================================
   * Lighting the fuse, then the effect for each kind
   * ===================================================================== */
  function ignite(c) {
    if (c.lit) return;
    c.lit = true;
    clearTimeout(c.expire);
    c.svg.querySelector(".tip-dot")?.remove();
    if (c.stick) { dropStick(c.stick, 450); c.stick = null; }
    const len = c.fuse.getTotalLength();
    c.fuse.style.strokeDasharray = `${len} ${len}`;
    Sound.fuse(c.k.fuseMs / 1000);
    night(c.k.fuseMs + 900);
    addEmitter({
      until: now() + c.k.fuseMs,
      tick(t, dt) {
        const p = clamp((t - this.start) / c.k.fuseMs, 0, 1);
        c.fuse.style.strokeDashoffset = String(-len * p);
        const pt = c.fuse.getPointAtLength(len * p);
        const [x, y] = at(c, pt.x, pt.y);
        flash(x, y, rand(10, 17), 0.07);
        const n = Math.max(1, Math.round(120 * dt * DENSITY));
        for (let i = 0; i < n; i++) {
          spawn({ type: "spark", x, y, vx: rand(-90, 90), vy: rand(-140, 30), g: 380, drag: 2.5, life: rand(0.15, 0.4), size: rand(0.8, 1.5), color: pick(GOLD) });
        }
        if (Math.random() < dt * 5) smoke(x, y - 4, 1, { size: [5, 9], life: [1, 1.6], alpha: 0.35, spread: 2, grow: 2.2, rise: [20, 35] });
      },
      done() {
        c.fuse.style.visibility = "hidden";
        crackers.delete(c.id);
        EFFECTS[c.kind](c);
      },
    });
  }

  const EFFECTS = {
    bomb(c) {
      const [x, y] = at(c, 0, -30);
      c.node.remove();
      Sound.bang(1.7);
      night(2600);
      flash(x, y, 340, 0.5);
      flash(x, y, 130, 0.9);
      rings.push({ x, y, r0: 20, r1: 420, life: 0.65, age: 0 });
      burst(x, y, 190, { speed: [300, 950], g: 300, drag: 3.2, life: [0.35, 0.9], size: [1.4, 2.8], colors: [...GOLD, ...WHITE] });
      burst(x, y, 70, { speed: [80, 300], g: 420, drag: 1.6, life: [0.9, 1.7], size: [1.6, 2.6], colors: ["255,150,60", "255,110,40"], flicker: 0.5 });
      paper(x, y, 60, { speed: [160, 560] });
      smoke(x, y, 24, { size: [30, 58], life: [2.6, 4.2], alpha: 0.55, spread: 26, grow: 1.7, rise: [10, 50] });
      shake(16, 650);
    },

    rocket(c) {
      c.svg.querySelector(".rocket-body").style.visibility = "hidden";
      fade(c.node, 2600);
      const [sx, sy] = at(c, -6.5, -80);
      const b = feedBox();
      const tx = clamp(sx + rand(-80, 80), b.x + 60, b.x + b.w - 60);
      const ty = b.y + b.h * rand(0.1, 0.22);
      const dur = 900;
      Sound.whistle(dur / 1000);
      night(dur + 3400);
      smoke(sx, sy + 24, 4, { size: [10, 18], life: [1.2, 2], alpha: 0.45, spread: 6 });
      addEmitter({
        until: now() + dur,
        tick(t, dt) {
          const p = (t - this.start) / dur, e = 1 - Math.pow(1 - p, 2.2);
          const x = sx + (tx - sx) * e + Math.sin(p * 9) * 3, y = sy + (ty - sy) * e;
          flash(x, y, 18, 0.06);
          const n = Math.round(260 * dt * DENSITY) + 1;
          for (let i = 0; i < n; i++) {
            spawn({ type: "spark", x: x + rand(-1.5, 1.5), y: y + rand(0, 4), vx: rand(-35, 35), vy: rand(30, 150), g: 160, drag: 2.2, life: rand(0.25, 0.7), size: rand(1, 1.9), color: pick(GOLD), flicker: 0.4 });
          }
        },
        done: () => rocketBurst(tx, ty),
      });
    },

    anar(c) {
      const [x, y] = at(c, 0, -54);
      const dur = 4300;
      c.node.classList.add("burning");
      Sound.fountain(dur / 1000);
      night(dur + 1600);
      addEmitter({
        until: now() + dur,
        tick(t, dt) {
          const p = (t - this.start) / dur;
          const I = p < 0.1 ? p / 0.1 : p > 0.82 ? Math.max(0, (1 - p) / 0.18) : 0.92 + 0.08 * Math.sin(t / 90);
          const n = Math.round(560 * dt * I * DENSITY);
          for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + rand(-0.3, 0.3), sp = rand(320, 610) * (0.5 + 0.5 * I), r = Math.random();
            spawn({
              type: "spark", x: x + rand(-2, 2), y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 560, drag: 0.6,
              life: rand(0.8, 1.45), size: rand(1, 2),
              color: r < 0.7 ? pick(GOLD) : r < 0.9 ? WHITE[0] : pick(["120,255,150", "255,100,100"]),
              flicker: r > 0.9 ? 0.6 : 0.25,
            });
          }
          flash(x, y - 4, 40 + 22 * I + rand(0, 8), 0.06);
          if (Math.random() < dt * 7) smoke(x, y - 20, 1, { size: [14, 24], life: [1.8, 2.6], alpha: 0.3, spread: 8, rise: [30, 60] });
        },
        done() {
          c.node.classList.remove("burning");
          fade(c.node, 300, 900);
          smoke(x, y, 5, { size: [16, 28], life: [2, 3], alpha: 0.4, spread: 10 });
        },
      });
    },

    chakri(c) {
      const [x0, y0] = at(c, 0, -12);
      c.node.style.visibility = "hidden";
      const dur = 4200;
      Sound.whirr(dur / 1000);
      night(dur + 1400);
      const b = feedBox();
      let ang = 0, x = x0, vx = rand(-1, 1) * 28;
      addEmitter({
        x: x0,
        until: now() + dur,
        tick(t, dt) {
          const p = (t - this.start) / dur;
          const ramp = Math.min(1, p * 3) * (p > 0.85 ? (1 - p) / 0.15 : 1);
          ang += (6 + 30 * ramp) * dt;
          x += vx * dt;
          if (x < b.x + 40 || x > b.x + b.w - 40) { vx = -vx; x = clamp(x, b.x + 40, b.x + b.w - 40); }
          const y = y0 + Math.sin(t / 70) * 1.2;
          const cols = [["255,90,90", "255,206,110"], ["120,255,150", "255,226,150"], ["255,226,150", "255,248,230"]][Math.floor(p * 6) % 3];
          const n = Math.round(380 * dt * DENSITY * (0.4 + 0.6 * ramp));
          for (let i = 0; i < n; i++) {
            const a = ang + (i % 2) * Math.PI + rand(-0.15, 0.15), rx = Math.cos(a), ry = Math.sin(a), sp = rand(160, 300);
            spawn({ type: "spark", x: x + rx * 20, y: y + ry * 8.4, vx: -ry * sp + rx * 40, vy: rx * 0.42 * sp - rand(10, 60), g: 300, drag: 2.4, life: rand(0.25, 0.55), size: rand(1, 1.9), color: pick(cols) });
          }
          flash(x, y, 34 + rand(0, 10), 0.05);
          this.x = x;
        },
        done() {
          c.node.remove();
          smoke(this.x, y0, 6, { size: [14, 26], life: [2, 3], alpha: 0.4, spread: 14 });
        },
      });
    },

    ladi(c) {
      const nodes = c.svg.querySelectorAll(".pop");
      night(LADI_POPS.length * 190 + 2600);
      let i = 0;
      const next = () => {
        if (i >= LADI_POPS.length) return fade(c.node, 0, 500);
        nodes[i].style.visibility = "hidden";
        const [x, y] = at(c, ...LADI_POPS[i]);
        const last = i === LADI_POPS.length - 1;
        if (last) Sound.bang(0.8); else Sound.pop(rand(0.8, 1.25));
        flash(x, y, last ? 130 : rand(55, 75), last ? 0.3 : 0.16);
        burst(x, y, last ? 70 : 30, { speed: [140, last ? 600 : 420], g: 320, drag: 3, life: [0.18, 0.5], size: [1.1, 2], colors: [...GOLD, ...WHITE] });
        paper(x, y, last ? 20 : 9, { speed: [90, 300], life: [1.2, 2] });
        smoke(x, y, 2, { size: [14, 26], life: [1.6, 2.6], alpha: 0.4, spread: 6 });
        shake(last ? 7 : 3, last ? 220 : 110);
        i++;
        later(rand(110, 240), next);
      };
      next();
    },
  };

  function rocketBurst(x, y) {
    const pal = pick(PALETTES);
    Sound.bang(0.85);
    Sound.crackle(1.3, 70, 0.75);
    flash(x, y, 240, 0.4);
    flash(x, y, 70, 0.6);
    burst(x, y, 170, { speed: [230, 290], ring: true, g: 75, drag: 1.3, life: [1.3, 2], size: [1.6, 2.5], colors: [pal[0], pal[0], pal[1]], flicker: 0.35 });
    burst(x, y, 70, { speed: [40, 150], g: 70, drag: 1.4, life: [0.9, 1.5], size: [1.4, 2.2], colors: [pal[1], WHITE[0]] });
    smoke(x, y, 6, { size: [40, 70], life: [2.5, 3.5], alpha: 0.22, spread: 60 });
    // glitter twinkles as it fades
    later(800, () =>
      addEmitter({
        until: now() + 700,
        tick(t, dt) {
          const n = Math.round(170 * dt * DENSITY);
          for (let i = 0; i < n; i++) {
            const a = rand(0, Math.PI * 2), r = rand(40, 195);
            spawn({ type: "spark", x: x + Math.cos(a) * r, y: y + Math.sin(a) * r + 40, g: 20, drag: 1, life: rand(0.08, 0.2), size: rand(1.4, 2.4), color: WHITE[0] });
          }
        },
      }),
    );
  }

  /* =====================================================================
   * Your turn: tray -> place -> light
   * ===================================================================== */
  let mode = null; // { step: "place" | "light", kind, ghost?, cracker?, lastSent, timeout }

  function showHint(text) {
    const cancel = Object.assign(document.createElement("button"), { type: "button", textContent: "Cancel", onclick: cancelMode });
    hint.replaceChildren(Object.assign(document.createElement("span"), { textContent: text }), cancel);
    hint.hidden = false;
  }

  function startPlacing(kind) {
    if (!activeId) return;
    cancelMode();
    closeTray();
    Sound.unlock();
    const { node: ghost } = makeNode(kind, "ck ghost");
    ghost.style.visibility = "hidden";
    top.append(ghost);
    mode = { step: "place", kind, ghost };
    layoutOverlay();
    capture.hidden = false;
    showHint(`${coarse ? "Tap" : "Click"} in the chat to set down the ${KINDS[kind].name}`);
  }

  function place(px, py, e) {
    const kind = mode.kind;
    mode.ghost.remove();
    const [nx, ny] = toNorm(px, py);
    const c = addCracker({ id: newId(), kind, nx, ny, mine: true });

    // pulsing ring at the end of the fuse so you know where to aim
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("class", "tip-dot");
    dot.setAttribute("cx", c.k.tip[0]);
    dot.setAttribute("cy", c.k.tip[1]);
    dot.setAttribute("r", "7");
    c.svg.append(dot);

    c.stick = makeStick(null);
    mode = { step: "light", kind, cracker: c, lastSent: 0, timeout: setTimeout(cancelMode, 60000) };
    socket.emit("cracker:place", { conversationId: activeId, id: c.id, kind, x: nx, y: ny });
    showHint("Now touch the fuse with the dhoop kathi");
    onPointer(e, false);
  }

  function onPointer(e, down) {
    if (!mode) return;
    const [x, y] = localPoint(e);
    if (mode.step === "place") {
      const [bx, by] = clampBase(mode.kind, x, y);
      if (down) return place(bx, by, e);
      setNodePos(mode.ghost, mode.kind, bx, by);
      mode.ghost.style.visibility = "visible";
      return;
    }
    // Lighting: the glowing tip follows the pointer (lifted above a finger so it stays visible)
    const touch = e.pointerType === "touch";
    const tx = x, ty = touch ? y - 44 : y;
    const c = mode.cracker, s = c.stick;
    const [ax, ay] = Number.isNaN(s.x) ? [tx, ty] : [s.x, s.y];
    placeStick(s, tx, ty);

    const t = now();
    if (t - mode.lastSent > 40) {
      mode.lastSent = t;
      const [nx, ny] = toNorm(tx, ty);
      socket.emit("cracker:stick", { id: c.id, x: nx, y: ny });
    }

    const [fx, fy] = at(c, ...c.k.tip);
    if (segDist(fx, fy, ax, ay, tx, ty) <= (touch ? 26 : 16)) {
      const [nx, ny] = toNorm(tx, ty);
      socket.emit("cracker:stick", { id: c.id, x: nx, y: ny });
      socket.emit("cracker:ignite", { id: c.id });
      endMode();
      ignite(c);
    }
  }

  capture.addEventListener("pointermove", (e) => onPointer(e, false));
  capture.addEventListener("pointerdown", (e) => { e.preventDefault(); onPointer(e, true); });
  capture.addEventListener("pointerleave", () => { if (mode && mode.ghost) mode.ghost.style.visibility = "hidden"; });

  function endMode() {
    if (!mode) return;
    clearTimeout(mode.timeout);
    if (mode.ghost) mode.ghost.remove();
    capture.hidden = true;
    hint.hidden = true;
    mode = null;
  }

  function cancelMode() {
    if (!mode) return;
    const c = mode.cracker;
    if (c && !c.lit) {
      socket.emit("cracker:remove", { id: c.id });
      removeCracker(c);
    }
    endMode();
  }

  /* ---------- tray ---------- */
  const tray = mk("div", "ck-tray");
  tray.hidden = true;
  tray.setAttribute("role", "dialog");
  tray.setAttribute("aria-label", "Diwali crackers");

  const soundBtn = Object.assign(mk("button", "ck-sound"), { type: "button" });
  const syncSound = () => {
    soundBtn.textContent = Sound.muted ? "Sound off" : "Sound on";
    soundBtn.setAttribute("aria-pressed", String(!Sound.muted));
  };
  soundBtn.onclick = () => { Sound.setMuted(!Sound.muted); syncSound(); };
  syncSound();

  const grid = mk("div", "ck-grid");
  for (const [kind, k] of Object.entries(KINDS)) {
    const art = mk("span", "ck-tile-art");
    art.append(artSvg(kind));
    const tile = Object.assign(mk("button", "ck-tile"), { type: "button", onclick: () => startPlacing(kind) });
    tile.append(art, Object.assign(mk("span", "n"), { textContent: k.name }), Object.assign(mk("span", "b"), { textContent: k.blurb }));
    grid.append(tile);
  }

  const head = mk("div", "ck-tray-head");
  head.append(Object.assign(document.createElement("h3"), { textContent: "Diwali crackers" }), soundBtn);
  tray.append(
    head,
    grid,
    Object.assign(mk("p", "ck-tray-foot"), {
      textContent: "Set one down in the chat, then touch the fuse with the dhoop kathi. Everyone in this chat sees and hears it.",
    }),
  );
  composerInner.append(tray);

  function openTray() {
    tray.hidden = false;
    crackerBtn.setAttribute("aria-expanded", "true");
    tray.querySelector(".ck-tile").focus();
  }
  function closeTray() {
    tray.hidden = true;
    crackerBtn.setAttribute("aria-expanded", "false");
  }

  crackerBtn.addEventListener("click", () => (tray.hidden ? openTray() : closeTray()));
  document.addEventListener("pointerdown", (e) => {
    if (!tray.hidden && !tray.contains(e.target) && !crackerBtn.contains(e.target)) closeTray();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!tray.hidden) { closeTray(); crackerBtn.focus(); }
    else if (mode) cancelMode();
  });

  /* =====================================================================
   * Everyone else's crackers
   * ===================================================================== */
  socket.on("cracker:place", (d) => {
    if (!d || d.conversationId !== activeId || document.hidden || crackers.has(d.id) || !KINDS[d.kind]) return;
    addCracker({ id: d.id, kind: d.kind, nx: d.x, ny: d.y, by: d.by });
  });

  socket.on("cracker:stick", (d) => {
    const c = d && crackers.get(d.id);
    if (!c || c.lit || c.mine) return;
    if (!c.stick) c.stick = makeStick(d.by);
    c.stickN = [d.x, d.y];
    placeStick(c.stick, ...fromNorm(d.x, d.y));
  });

  socket.on("cracker:ignite", (d) => {
    const c = d && crackers.get(d.id);
    if (!c) return;
    if (document.hidden) return removeCracker(c);
    ignite(c);
  });

  socket.on("cracker:remove", (d) => {
    const c = d && crackers.get(d.id);
    if (c && !c.lit) removeCracker(c);
  });

  /* ---------- housekeeping ---------- */
  new ResizeObserver(resize).observe(chatEl);
  resize();

  window.sandesCrackers = {
    // Called when you switch conversations: drop everything on screen
    reset() {
      cancelMode();
      closeTray();
      for (const c of crackers.values()) clearTimeout(c.expire);
      crackers.clear();
      emitters.clear();
      P.length = flashes.length = rings.length = 0;
      nightUntil = 0;
      dim = 0;
      layer.replaceChildren();
      top.replaceChildren();
      ctx.clearRect(0, 0, W, H);
    },
  };
})();
