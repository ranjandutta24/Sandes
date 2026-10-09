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
  const SKY_HOLES = [-18, -11, -4, 4, 11, 18];

  // Same id -> same numbers on every screen (rocket height, colours, snake shape...)
  function seeded(id) {
    let a = parseInt(String(id).slice(0, 8), 16) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

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
    kalipotka: {
      name: "Kali potka", blurb: "Small, very loud", fuseMs: 1100,
      vb: [-18, -46, 38, 50], tip: [15, -41],
      art: `
        <ellipse cx="0" cy="0" rx="15" ry="3" fill="#1b2a47" opacity=".18"/>
        <path d="M-12 -3 C -14 -10, -14 -20, -10 -25 C -6 -29, 6 -29, 10 -25 C 14 -20, 14 -10, 12 -3 Q 0 1 -12 -3 Z" fill="url(#ck-char)"/>
        <path d="M-12.5 -19 Q0 -16 12.5 -19 L12.8 -12 Q0 -9 -12.8 -12 Z" fill="#c8323a"/>
        <path d="M-13 -8 Q0 -4 13 -8 M-13.5 -15.5 Q0 -12 13.5 -15.5 M-12 -22 Q0 -19 12 -22" fill="none" stroke="#8a7a66" stroke-width=".9" opacity=".7"/>
        <path d="M-9 -26 C -5 -31, -2 -29, 0 -33 C 2 -29, 5 -31, 9 -26 Z" fill="#3a332e"/>
        <circle cx="-5" cy="-20" r="4" fill="#fff" opacity=".12"/>
        <path class="fuse" d="M15 -41 C 10 -39, 4 -37, 1 -32"/>`,
    },
    rosun: {
      name: "Rosun bomb", blurb: "Throw it, it bursts", thrown: true,
      vb: [-20, -46, 40, 50], tip: [0, -44],
      art: `
        <ellipse cx="0" cy="0" rx="14" ry="3" fill="#1b2a47" opacity=".16"/>
        <path d="M0 -2 C -15 -2, -18 -16, -11 -25 C -7 -30, -3 -31, -1 -36 L1 -36 C 3 -31, 7 -30, 11 -25 C 18 -16, 15 -2, 0 -2 Z" fill="url(#ck-garlic)"/>
        <path d="M-1 -33 C -9 -26, -11 -12, -6 -3 M1 -33 C 9 -26, 11 -12, 6 -3 M0 -34 C -2 -22, -2 -12, 0 -2" fill="none" stroke="#c9bba1" stroke-width="1.1"/>
        <path d="M-3 -36 C -6 -40, -5 -43, -2 -44 C -1 -41, 1 -41, 2 -44 C 5 -43, 6 -40, 3 -36 Z" fill="#e9e1d1" stroke="#c9bba1" stroke-width=".8"/>
        <path d="M-4 -35.5 Q0 -33.5 4 -35.5" stroke="#c8323a" stroke-width="1.6" fill="none"/>
        <path d="M-8 -20 C -8 -14, -6 -9, -4 -6" stroke="#fff" stroke-opacity=".6" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    },
    dodoma: {
      name: "Dodoma", blurb: "Bangs twice, up high", fuseMs: 1600,
      vb: [-20, -72, 44, 76], tip: [21, -22],
      art: `
        <ellipse cx="0" cy="0" rx="17" ry="3.4" fill="#1b2a47" opacity=".18"/>
        <rect x="-12" y="-64" width="24" height="62" rx="3" fill="url(#ck-twine-l)"/>
        <path d="M-12 -56 h24 M-12 -26 h24 M-12 -18 h24 M-12 -10 h24 M-12 -60 h24" stroke="#6e4c22" stroke-width="1.1" opacity=".55"/>
        <rect x="-12" y="-48" width="24" height="16" fill="#c8323a"/>
        <rect x="-12" y="-48" width="24" height="2.2" fill="#f3c654"/>
        <rect x="-12" y="-34.2" width="24" height="2.2" fill="#f3c654"/>
        <ellipse cx="0" cy="-64" rx="12" ry="3" fill="#8a6634"/>
        <rect x="-9" y="-62" width="4" height="58" fill="#fff" opacity=".14"/>
        <path class="fuse" d="M21 -22 C 18 -17, 15 -13, 12 -10"/>`,
    },
    skyshot: {
      name: "Sky shot", blurb: "Eight shells up", fuseMs: 1400,
      vb: [-38, -46, 66, 50], tip: [-35, -20],
      art: `
        <ellipse cx="0" cy="0" rx="27" ry="3.5" fill="#1b2a47" opacity=".18"/>
        <rect x="-24" y="-35" width="48" height="34" rx="2" fill="url(#ck-red)"/>
        <rect x="-24" y="-41" width="48" height="7" rx="2" fill="#6e151c"/>
        <g fill="#1d0b0b">${SKY_HOLES.map((x) => `<circle cx="${x}" cy="-37.5" r="2.3"/>`).join("")}</g>
        <rect x="-24" y="-31" width="48" height="2.4" fill="url(#ck-gold)"/>
        <rect x="-24" y="-7" width="48" height="2.4" fill="url(#ck-gold)"/>
        <text x="0" y="-15" text-anchor="middle" font-family="sans-serif" font-size="8" font-weight="700" letter-spacing=".6" fill="#f3c654">SKY SHOT</text>
        <g fill="#f8d77a"><circle cx="-17" cy="-24" r="1.3"/><circle cx="-6" cy="-25" r="1"/><circle cx="7" cy="-24" r="1.3"/><circle cx="17" cy="-25" r="1"/></g>
        <path class="fuse" d="M-35 -20 C -31 -17, -28 -15, -24 -14"/>`,
    },
    udan: {
      name: "Udan chakri", blurb: "Spins and flies", fuseMs: 1200,
      vb: [-30, -28, 60, 32], tip: [21, -25],
      art: `
        <ellipse cx="0" cy="0" rx="22" ry="3" fill="#1b2a47" opacity=".16"/>
        <g class="spin">
          <path d="M-5 -13 L-27 -18 L-28 -12 L-5 -8 Z" fill="url(#ck-gold)"/>
          <path d="M5 -13 L27 -8 L28 -14 L5 -17 Z" fill="url(#ck-gold)"/>
          <rect x="-6" y="-18" width="12" height="13" rx="2" fill="url(#ck-red)"/>
          <rect x="-6" y="-13.5" width="12" height="2.2" fill="#2f9a5a"/>
        </g>
        <path class="fuse" d="M21 -25 C 16 -23, 10 -20, 6 -16"/>`,
    },
    phuljhuri: {
      name: "Phuljhuri", blurb: "Light it, wave it", held: true,
      lightHint: "Now touch the tip with the dhoop kathi",
      vb: [-16, -114, 32, 118], tip: [0, -108],
      art: `
        <ellipse cx="0" cy="0" rx="13" ry="3" fill="#1b2a47" opacity=".16"/>
        <g class="wand-art">
          <line x1="0" y1="-6" x2="0" y2="-108" stroke="#a3a6ab" stroke-width="1.6" stroke-linecap="round"/>
          <line x1="0" y1="-106" x2="0" y2="-40" stroke="#6d6a66" stroke-width="5" stroke-linecap="round"/>
          <line x1="0" y1="-105" x2="0" y2="-41" stroke="#a29d94" stroke-width="5" stroke-dasharray="1 3" opacity=".55"/>
        </g>
        <path d="M-12 -1 C -10 -9, -5 -12, 0 -12 C 5 -12, 10 -9, 12 -1 Q 0 2 -12 -1 Z" fill="url(#ck-clay)"/>`,
    },
    mashal: {
      name: "Rang mashal", blurb: "Coloured flare", fuseMs: 1100,
      vb: [-16, -100, 32, 104], tip: [7, -97],
      art: `
        <ellipse cx="0" cy="0" rx="14" ry="3" fill="#1b2a47" opacity=".16"/>
        <line x1="0" y1="-4" x2="0" y2="-58" stroke="#c9a46a" stroke-width="3" stroke-linecap="round"/>
        <path d="M-11 -1 C -8 -8, -4 -10, 0 -10 C 4 -10, 8 -8, 11 -1 Q 0 2 -11 -1 Z" fill="#c9a777"/>
        <g class="tube">
          <rect x="-6" y="-90" width="12" height="36" rx="1.5" fill="url(#ck-green)"/>
          <rect x="-6" y="-60" width="12" height="3" fill="url(#ck-gold)"/>
          <rect x="-6" y="-79" width="12" height="3" fill="url(#ck-gold)"/>
          <rect x="-4" y="-88" width="2.2" height="32" fill="#fff" opacity=".18"/>
        </g>
        <path class="fuse" d="M7 -97 C 5 -95, 2 -93, 0 -90"/>`,
    },
    saap: {
      name: "Saap", blurb: "Ash snake grows", quiet: true, fuseMs: 700,
      lightHint: "Now touch the tablet with the dhoop kathi",
      vb: [-18, -18, 36, 22], tip: [0, -12],
      art: `
        <ellipse cx="0" cy="0" rx="14" ry="3" fill="#1b2a47" opacity=".16"/>
        <path d="M-8 -3 L-8 -10 A8 2.6 0 0 1 8 -10 L8 -3 A8 2.6 0 0 1 -8 -3 Z" fill="url(#ck-char)"/>
        <ellipse cx="0" cy="-10" rx="8" ry="2.6" fill="#57504a"/>
        <g class="snake"></g>`,
      tileVb: [-26, -46, 52, 50],
      tileArt: `
        <ellipse cx="0" cy="0" rx="14" ry="3" fill="#1b2a47" opacity=".16"/>
        <path d="M-8 -3 L-8 -10 A8 2.6 0 0 1 8 -10 L8 -3 A8 2.6 0 0 1 -8 -3 Z" fill="url(#ck-char)"/>
        <path d="M0 -11 C 0 -24, -14 -30, -18 -20 C -21 -11, -9 -6, -4 -15 C 1 -24, 14 -30, 17 -40" fill="none" stroke="#2c2724" stroke-width="6.5" stroke-linecap="round"/>
        <path d="M0 -11 C 0 -24, -14 -30, -18 -20 C -21 -11, -9 -6, -4 -15 C 1 -24, 14 -30, 17 -40" fill="none" stroke="#6a6058" stroke-width="5" stroke-linecap="round" stroke-dasharray="1.2 3" opacity=".8"/>`,
    },
  };

  // Order in the tray
  const TRAY = ["kalipotka", "bomb", "rosun", "dodoma", "ladi", "rocket", "skyshot", "udan", "anar", "chakri", "phuljhuri", "mashal", "saap"];
  const WAND_MS = 7000; // how long a phuljhuri burns in your hand

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
    <linearGradient id="ck-char" x1="0" x2="1"><stop offset="0" stop-color="#1d1b1a"/><stop offset=".45" stop-color="#4f4843"/><stop offset="1" stop-color="#211e1c"/></linearGradient>
    <radialGradient id="ck-garlic" cx="40%" cy="40%" r="70%"><stop offset="0" stop-color="#fffaf0"/><stop offset=".6" stop-color="#efe6d4"/><stop offset="1" stop-color="#cdbfa4"/></radialGradient>
    <linearGradient id="ck-twine-l" x1="0" x2="1"><stop offset="0" stop-color="#7a5a2e"/><stop offset=".45" stop-color="#e0c18a"/><stop offset="1" stop-color="#8a6634"/></linearGradient>
    <radialGradient id="ck-ember-g"><stop offset="0" stop-color="#fff3c4"/><stop offset=".35" stop-color="#ff9a2e" stop-opacity=".85"/><stop offset="1" stop-color="#ff5a00" stop-opacity="0"/></radialGradient>
    <clipPath id="ck-ball"><circle cx="0" cy="-30" r="27"/></clipPath>
    <clipPath id="ck-cone"><path d="M-23 -2 C -20 -20, -10 -42, -4 -52 L 4 -52 C 10 -42, 20 -20, 23 -2 Q 0 3 -23 -2 Z"/></clipPath>
  </defs>`;
  document.body.append(defs);

  function artSvg(kind, forTile = false) {
    const k = KINDS[kind];
    const vb = (forTile && k.tileVb) || k.vb;
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", vb.join(" "));
    s.setAttribute("width", vb[2]);
    s.setAttribute("height", vb[3]);
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = (forTile && k.tileArt) || k.art; // static artwork authored above, no user data
    return s;
  }

  // The phuljhuri in your hand. (0,0) is the burning point; the handle runs along +x.
  function wandSvg() {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "-6 -10 166 20");
    s.setAttribute("width", "166");
    s.setAttribute("height", "20");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = `
      <line class="burnt" x1="0" y1="0" x2="0" y2="0" stroke="#4a3f3a" stroke-width="1.4" stroke-linecap="round"/>
      <line class="coat" x1="0" y1="0" x2="100" y2="0" stroke="#6d6a66" stroke-width="5" stroke-linecap="round"/>
      <line class="coat" x1="0" y1="0" x2="100" y2="0" stroke="#a29d94" stroke-width="5" stroke-dasharray="1 3" opacity=".55"/>
      <line x1="100" y1="0" x2="156" y2="0" stroke="#a9abb0" stroke-width="1.6" stroke-linecap="round"/>
      <circle class="hot" cx="0" cy="0" r="3.2" fill="#fff4cf"/>`;
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

    function hiss(dur, { freq = 4000, q = 0.8, gain = 0.25, attack = 0.08, release = 0.4, delay = 0, lfo = 0, lfoDepth = 0, sweep = 0 } = {}) {
      if (!ready()) return;
      const t = ac.currentTime + delay;
      const bp = filt("bandpass", freq, q);
      if (sweep) {
        bp.frequency.setValueAtTime(freq, t);
        bp.frequency.exponentialRampToValueAtTime(sweep, t + dur);
      }
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
      whirr(dur, sweep = 0) {
        hiss(dur, { freq: 2600, q: 2.2, gain: 0.3, attack: 0.3, release: 0.5, lfo: 22, lfoDepth: 1200, sweep });
        crackle(dur, Math.round(dur * 14));
      },
      // sharp, ear-splitting crack (kali potka, rosun bomb)
      crack(size = 1, delay = 0) {
        bang(size * 0.9, delay);
        if (!ready()) return;
        const t = ac.currentTime + delay;
        const g = ac.createGain();
        env(g, t, Math.min(1.4, 1.1 * size), 0.001, 0.07);
        noise(t, 0.12).connect(filt("highpass", 1800)).connect(g).connect(out);
      },
      // the dull "thoomp" of a shell leaving its tube
      thump(delay = 0) {
        if (!ready()) return;
        const t = ac.currentTime + delay;
        const o = ac.createOscillator();
        o.frequency.setValueAtTime(130, t);
        o.frequency.exponentialRampToValueAtTime(48, t + 0.14);
        const og = ac.createGain();
        env(og, t, 0.7, 0.004, 0.16);
        o.connect(og).connect(out);
        o.start(t);
        o.stop(t + 0.3);
        const g = ac.createGain();
        env(g, t, 0.45, 0.002, 0.12);
        noise(t, 0.2).connect(filt("lowpass", 900)).connect(g).connect(out);
      },
      fizz(dur) {
        hiss(dur, { freq: 1400, q: 0.5, gain: 0.08, attack: 0.3, release: 0.8 });
        crackle(dur, Math.round(dur * 5));
      },
      sparkler(dur) {
        hiss(dur, { freq: 7500, q: 0.5, gain: 0.1, attack: 0.1, release: 0.3 });
        crackle(dur, Math.round(dur * 60));
      },
      flare(dur) {
        hiss(dur, { freq: 1700, q: 0.4, gain: 0.24, attack: 0.3, release: 0.8 });
        hiss(dur, { freq: 420, q: 0.6, gain: 0.14, attack: 0.4, release: 0.8 });
        crackle(dur, Math.round(dur * 9));
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
  const CHAR_PAPER = ["#2a2522", "#3d3632", "#c8323a", "#5a4a3a", "#1d1a18"];
  const GRAVEL = ["#f1ece2", "#e4dccd", "#8d8a85", "#6f6b66", "#b9b4ab"];

  // Coloured light and smoke for the rang mashal
  const tinted = new Map();
  function tintGlow(rgb) {
    const key = "g" + rgb;
    if (!tinted.has(key)) tinted.set(key, sprite(128, [[0, "rgba(255,255,255,1)"], [0.14, `rgba(${rgb},.95)`], [0.5, `rgba(${rgb},.32)`], [1, `rgba(${rgb},0)`]]));
    return tinted.get(key);
  }
  function tintSmoke(rgb) {
    const key = "s" + rgb;
    if (!tinted.has(key)) tinted.set(key, sprite(96, [[0, `rgba(${rgb},.7)`], [0.5, `rgba(${rgb},.32)`], [1, `rgba(${rgb},0)`]]));
    return tinted.get(key);
  }

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
  const flash = (x, y, r, life, img) => flashes.push({ x, y, r, life, age: 0, img });
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

  function smoke(x, y, n, { size = [24, 44], life = [2, 3.5], alpha = 0.5, spread = 24, grow = 1.4, rise = [10, 40], img } = {}) {
    for (let i = 0; i < n; i++) {
      spawn({ type: "smoke", x: x + rand(-spread, spread), y: y + rand(-spread / 2, spread / 2), vx: rand(-25, 25), vy: -rand(...rise), g: -4, drag: 0.9, life: rand(...life), size: rand(...size), alpha, grow, img });
    }
  }

  function paper(x, y, n, { speed = [120, 420], life = [1.6, 2.6], colors = PAPER, size = [2.5, 5] } = {}) {
    n = Math.round(n * DENSITY);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rand(-1.35, 1.35), sp = rand(...speed);
      spawn({ type: "paper", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 620, drag: 1.8, life: rand(...life), size: rand(...size), color: pick(colors), rot: rand(0, 6), vr: rand(-14, 14) });
    }
  }

  // A burn mark left on the floor for a few seconds
  function scorch(x, y, r) {
    const s = mk("div", "ck-scorch");
    Object.assign(s.style, { width: 2 * r + "px", height: r * 0.7 + "px", transform: `translate(${x - r}px, ${y - r * 0.35}px)` });
    layer.prepend(s);
    fade(s, 3500, 1500);
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
        ctx.drawImage(p.img || SMOKE, p.x - r, p.y - r, r * 2, r * 2);
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
      ctx.drawImage(f.img || GLOW, f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
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
    const c = { id, kind, k: KINDS[kind], nx, ny, node, svg, by, fuse: svg.querySelector(".fuse"), mine: !!mine, lit: false, stick: null };
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
    if (c.k.held) return startHeld(c);
    c.lit = true;
    clearTimeout(c.expire);
    c.svg.querySelector(".tip-dot")?.remove();
    if (c.stick) { dropStick(c.stick, 450); c.stick = null; }
    const fuse = c.fuse; // saap has no fuse: it smoulders where you touched it
    const len = fuse ? fuse.getTotalLength() : 0;
    if (fuse) {
      fuse.style.strokeDasharray = `${len} ${len}`;
      Sound.fuse(c.k.fuseMs / 1000);
    }
    if (!c.k.quiet) night(c.k.fuseMs + 900);
    addEmitter({
      until: now() + c.k.fuseMs,
      tick(t, dt) {
        const p = clamp((t - this.start) / c.k.fuseMs, 0, 1);
        let x, y;
        if (fuse) {
          fuse.style.strokeDashoffset = String(-len * p);
          const pt = fuse.getPointAtLength(len * p);
          [x, y] = at(c, pt.x, pt.y);
        } else {
          [x, y] = at(c, ...c.k.tip);
        }
        flash(x, y, rand(10, 17), 0.07);
        const n = Math.max(1, Math.round((fuse ? 120 : 40) * dt * DENSITY));
        for (let i = 0; i < n; i++) {
          spawn({ type: "spark", x, y, vx: rand(-90, 90), vy: rand(-140, 30), g: 380, drag: 2.5, life: rand(0.15, 0.4), size: rand(0.8, 1.5), color: pick(GOLD) });
        }
        if (Math.random() < dt * 5) smoke(x, y - 4, 1, { size: [5, 9], life: [1, 1.6], alpha: 0.35, spread: 2, grow: 2.2, rise: [20, 35] });
      },
      done() {
        if (fuse) fuse.style.visibility = "hidden";
        crackers.delete(c.id);
        EFFECTS[c.kind](c);
      },
    });
  }

  /* ---------- phuljhuri: once lit it follows the hand that lit it ---------- */
  function startHeld(c) {
    c.lit = true;
    clearTimeout(c.expire);
    c.svg.querySelector(".tip-dot")?.remove();
    const s = c.stick;
    const [x0, y0] = s && !Number.isNaN(s.x) ? [s.x, s.y] : at(c, ...c.k.tip);
    if (s) { emitters.delete(s.smoke); s.node.remove(); c.stick = null; }
    c.svg.querySelector(".wand-art").style.visibility = "hidden";
    fade(c.node, 900, 600); // the empty clay holder

    const node = mk("div", "ck-wand");
    const svg = wandSvg();
    node.append(svg);
    if (!c.mine && c.by) node.append(Object.assign(mk("span", "ck-who"), { textContent: c.by }));
    top.append(node);
    const coats = svg.querySelectorAll(".coat"), burnt = svg.querySelector(".burnt"), hot = svg.querySelector(".hot");
    const w = (c.wand = { x: x0, y: y0, tx: x0, ty: y0 });
    c.holding = true;
    Sound.sparkler(WAND_MS / 1000);
    night(WAND_MS + 700);
    let lx = x0, ly = y0;

    addEmitter({
      until: now() + WAND_MS,
      tick(t, dt) {
        const p = (t - this.start) / WAND_MS, b = p * 94;
        if (!c.mine) { // smooth out the network updates
          const k = 1 - Math.exp(-dt * 16);
          w.x += (w.tx - w.x) * k;
          w.y += (w.ty - w.y) * k;
        }
        node.style.transform = `translate(${w.x}px, ${w.y}px)`;
        svg.style.transform = `rotate(38deg) translateX(${-b}px)`;
        coats.forEach((l) => l.setAttribute("x1", b));
        burnt.setAttribute("x2", b);
        hot.setAttribute("cx", b);

        const I = p > 0.92 ? (1 - p) / 0.08 : Math.min(1, p / 0.04);
        // light trail, so you can write in the air
        const steps = Math.min(24, Math.ceil(Math.hypot(w.x - lx, w.y - ly) / 3));
        for (let i = 1; i <= steps; i++) {
          // tiny downward drift: canvas skips zero-length strokes, and a real trail sags a little
          spawn({ type: "spark", x: lx + ((w.x - lx) * i) / steps, y: ly + ((w.y - ly) * i) / steps, vy: rand(3, 8), g: 6, life: 1.1 * I + 0.05, size: 2.6, color: Math.random() < 0.5 ? "255,236,190" : "255,200,120" });
        }
        lx = w.x;
        ly = w.y;
        const n = Math.round(330 * dt * DENSITY * I);
        for (let i = 0; i < n; i++) {
          const a = rand(0, Math.PI * 2), sp = rand(60, 290);
          spawn({ type: "spark", x: w.x, y: w.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 140, drag: 3.5, life: rand(0.06, 0.22), size: rand(0.7, 1.5), color: Math.random() < 0.7 ? WHITE[0] : pick(GOLD) });
        }
        // the little branching "stars" a sparkler throws off
        if (Math.random() < dt * 40 * I) {
          const a = rand(0, Math.PI * 2), r = rand(14, 42);
          burst(w.x + Math.cos(a) * r, w.y + Math.sin(a) * r, 6, { speed: [40, 130], g: 60, drag: 4, life: [0.05, 0.14], size: [0.6, 1.1], colors: WHITE });
        }
        flash(w.x, w.y, (34 + rand(0, 14)) * I + 6, 0.05);
        if (Math.random() < dt * 4) smoke(w.x, w.y, 1, { size: [6, 10], life: [1.2, 1.8], alpha: 0.25, spread: 2, grow: 2.4, rise: [20, 34] });
      },
      done() {
        c.holding = false;
        crackers.delete(c.id);
        hot.remove();
        fade(node, 250, 600);
        if (mode && mode.cracker === c) endMode();
      },
    });
  }

  const EFFECTS = {
    bomb(c) {
      const [x, y] = at(c, 0, -30);
      scorch(...at(c, 0, 0), 44);
      c.node.remove();
      bigBang(x, y);
    },

    kalipotka(c) {
      const [x, y] = at(c, 0, -14);
      scorch(...at(c, 0, 0), 30);
      c.node.remove();
      Sound.crack(1.3);
      night(1800);
      flash(x, y, 240, 0.32);
      flash(x, y, 80, 0.5);
      rings.push({ x, y, r0: 10, r1: 260, life: 0.42, age: 0 });
      burst(x, y, 130, { speed: [320, 900], g: 260, drag: 4, life: [0.15, 0.5], size: [1.2, 2.4], colors: [...WHITE, ...GOLD] });
      paper(x, y, 46, { speed: [160, 520], colors: CHAR_PAPER });
      smoke(x, y, 16, { size: [24, 44], life: [2.2, 3.4], alpha: 0.6, spread: 16, grow: 1.6, rise: [10, 40] });
      shake(11, 420);
    },

    dodoma(c) {
      const R = seeded(c.id), b = feedBox();
      const [gx, gy] = at(c, 0, -8);
      scorch(...at(c, 0, 0), 32);
      c.node.remove();
      // first bang on the ground kicks the charge into the air...
      Sound.bang(0.9);
      flash(gx, gy, 150, 0.3);
      burst(gx, gy, 60, { speed: [150, 420], g: 400, drag: 3, life: [0.2, 0.5], colors: GOLD });
      smoke(gx, gy, 12, { size: [20, 40], life: [2, 3.2], alpha: 0.5, spread: 20, rise: [5, 25] });
      shake(6, 260);
      const sx = gx, sy = gy - 30;
      const tx = clamp(sx + (R() - 0.5) * 120, b.x + 60, b.x + b.w - 60);
      const ty = b.y + b.h * (0.12 + R() * 0.18);
      const dur = 480;
      night(dur + 3000);
      addEmitter({
        until: now() + dur,
        tick(t, dt) {
          const p = (t - this.start) / dur, e = 1 - Math.pow(1 - p, 2);
          const x = sx + (tx - sx) * e, y = sy + (ty - sy) * e;
          flash(x, y, 16, 0.05);
          const n = Math.round(220 * dt * DENSITY) + 1;
          for (let i = 0; i < n; i++) {
            spawn({ type: "spark", x: x + rand(-2, 2), y, vx: rand(-40, 40), vy: rand(40, 160), g: 200, drag: 2.5, life: rand(0.2, 0.5), size: rand(1, 1.8), color: pick(["255,150,60", "255,206,110"]) });
          }
        },
        // ...and the second, bigger one goes off up there
        done: () => bigBang(tx, ty, 1.6, false),
      });
    },

    rocket(c) {
      const R = seeded(c.id);
      c.svg.querySelector(".rocket-body").style.visibility = "hidden";
      fade(c.node, 2600);
      const [sx, sy] = at(c, -6.5, -80);
      const b = feedBox();
      const tx = clamp(sx + (R() - 0.5) * 160, b.x + 60, b.x + b.w - 60);
      const ty = b.y + b.h * (0.1 + R() * 0.12);
      const pal = PALETTES[Math.floor(R() * PALETTES.length)];
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
        done: () => shellBurst(tx, ty, pal, 1),
      });
    },

    skyshot(c) {
      const R = seeded(c.id), b = feedBox();
      const shots = 8, gap = 420, cx = c.px;
      night(shots * gap + 3800);
      for (let i = 0; i < shots; i++) {
        const hx = SKY_HOLES[(i * 5) % 6];
        const last = i === shots - 1;
        const tx = clamp(cx + (R() - 0.5) * b.w * 0.6, b.x + 70, b.x + b.w - 70);
        const ty = b.y + b.h * (0.08 + R() * 0.24);
        const pal = PALETTES[Math.floor(R() * PALETTES.length)];
        const style = !last && R() < 0.3 ? "willow" : "peony";
        later(i * gap + Math.floor(R() * 120), () => {
          const [sx, sy] = at(c, hx, -40);
          Sound.thump();
          flash(sx, sy, 40, 0.12);
          smoke(sx, sy, 2, { size: [8, 14], life: [1.2, 2], alpha: 0.4, spread: 3, rise: [30, 60] });
          const dur = 620;
          addEmitter({
            until: now() + dur,
            tick(t, dt) {
              const p = (t - this.start) / dur, e = 1 - Math.pow(1 - p, 2);
              const x = sx + (tx - sx) * e, y = sy + (ty - sy) * e;
              const n = Math.round(150 * dt * DENSITY) + 1;
              for (let k = 0; k < n; k++) {
                spawn({ type: "spark", x: x + rand(-1, 1), y, vx: rand(-25, 25), vy: rand(20, 110), g: 140, drag: 2.2, life: rand(0.2, 0.5), size: rand(0.9, 1.6), color: pick(GOLD), flicker: 0.4 });
              }
            },
            done: () => shellBurst(tx, ty, pal, last ? 1.25 : 0.8, style),
          });
        });
      }
      later(shots * gap + 900, () => {
        smoke(...at(c, 0, -40), 6, { size: [16, 28], life: [2, 3], alpha: 0.4, spread: 18 });
        fade(c.node, 1200, 900);
      });
    },

    udan(c) {
      const R = seeded(c.id), b = feedBox();
      const [x0, y0] = at(c, 0, -11);
      const spinMs = 700, flyMs = 2000, dur = spinMs + flyMs;
      const height = b.h * (0.35 + R() * 0.25), drift = (R() - 0.5) * 160, wob = 20 + R() * 20;
      const pal = [["120,255,150", "255,226,150"], ["255,110,220", "255,226,150"], ["110,170,255", "255,248,230"]][Math.floor(R() * 3)];
      c.svg.querySelector("ellipse").style.visibility = "hidden";
      const spin = c.svg.querySelector(".spin");
      Object.assign(spin.style, { transformBox: "fill-box", transformOrigin: "center" });
      Sound.whirr(dur / 1000, 5200);
      night(dur + 1500);
      let ang = 0;
      addEmitter({
        x: x0, y: y0,
        until: now() + dur,
        tick(t, dt) {
          const el = t - this.start;
          const f = el < spinMs ? 0 : (el - spinMs) / flyMs, e = 1 - Math.pow(1 - f, 1.7);
          ang += (14 + 30 * Math.min(1, el / spinMs)) * dt;
          const x = x0 + drift * e + Math.sin(el / 140) * wob * e, y = y0 - height * e;
          setNodePos(c.node, "udan", x, y + 11);
          spin.style.transform = `scaleX(${Math.cos(ang * 0.5).toFixed(3)})`;
          const n = Math.round(300 * dt * DENSITY);
          for (let i = 0; i < n; i++) {
            const a = ang + (i % 2) * Math.PI + rand(-0.2, 0.2), sp = rand(120, 260);
            spawn({ type: "spark", x: x + Math.cos(a) * 22, y: y + Math.sin(a) * 4, vx: -Math.sin(a) * sp, vy: rand(20, 120), g: 260, drag: 2.4, life: rand(0.25, 0.55), size: rand(1, 1.8), color: pick(pal) });
          }
          flash(x, y, 30 + rand(0, 8), 0.05);
          this.x = x;
          this.y = y;
        },
        done() {
          c.node.remove();
          Sound.pop(1.4);
          flash(this.x, this.y, 120, 0.25);
          burst(this.x, this.y, 70, { speed: [120, 380], g: 150, drag: 2, life: [0.4, 0.9], colors: [...pal, WHITE[0]], flicker: 0.4 });
          smoke(this.x, this.y, 4, { size: [14, 24], life: [1.8, 2.6], alpha: 0.3, spread: 8 });
        },
      });
    },

    mashal(c) {
      const R = seeded(c.id);
      const col = ["255,70,80", "80,255,130", "255,90,210"][Math.floor(R() * 3)];
      const glow = tintGlow(col), haze = tintSmoke(col);
      const tube = c.svg.querySelector(".tube");
      const dur = 5200;
      Sound.flare(dur / 1000);
      night(dur + 1800);
      addEmitter({
        until: now() + dur,
        tick(t, dt) {
          const p = (t - this.start) / dur, s = 1 - 0.85 * p;
          tube.setAttribute("transform", `translate(0 -54) scale(1 ${s.toFixed(3)}) translate(0 54)`);
          const [x, y] = at(c, 0, -54 - 36 * s);
          const I = p < 0.06 ? p / 0.06 : p > 0.9 ? (1 - p) / 0.1 : 1;
          flash(x, y, (230 + rand(-25, 25)) * I + 20, 0.07, glow);
          flash(x, y - 3, 14 + rand(0, 6), 0.05);
          const n = Math.round(70 * dt * DENSITY * I);
          for (let i = 0; i < n; i++) {
            spawn({ type: "spark", x: x + rand(-3, 3), y, vx: rand(-60, 60), vy: rand(-90, 10), g: 500, drag: 1.5, life: rand(0.3, 0.7), size: rand(1, 1.8), color: Math.random() < 0.6 ? col : WHITE[0] });
          }
          if (Math.random() < dt * 14 * I) smoke(x, y - 8, 1, { size: [16, 30], life: [2.2, 3.4], alpha: 0.42, spread: 6, grow: 1.8, rise: [40, 80], img: haze });
        },
        done() {
          fade(c.node, 200, 900);
          smoke(...at(c, 0, -60), 4, { size: [16, 28], life: [2, 3], alpha: 0.35, spread: 8, img: haze });
        },
      });
    },

    saap(c) {
      const R = seeded(c.id);
      // the snake's shape is decided up front, then it grows along it
      const pts = [[0, -11]];
      let x = 0, y = -11, h = -Math.PI / 2 + (R() - 0.5) * 0.5, dir = R() < 0.5 ? -1 : 1;
      const ph = R() * 6;
      for (let i = 0; i < 170; i++) {
        const rise = i < 22;
        if (!rise && R() < 0.012) dir = -dir;
        h += rise ? (R() - 0.5) * 0.08 : dir * (0.028 + 0.03 * Math.sin(i / 14 + ph));
        x += Math.cos(h) * 2;
        y += Math.sin(h) * 2;
        if (y > -5 && Math.sin(h) > 0) h = -h;          // can't go into the floor
        if (y < -150 && Math.sin(h) < 0) h = -h;        // or too high
        if (Math.abs(x) > 110 && Math.cos(h) * x > 0) h = Math.PI - h;
        pts.push([+x.toFixed(1), +y.toFixed(1)]);
      }
      const g = c.svg.querySelector(".snake");
      g.innerHTML = `
        <path fill="none" stroke="#2c2724" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
        <path fill="none" stroke="#6a6058" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1.2 3.4" opacity=".75"/>
        <path fill="none" stroke="#9a8f84" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".45" transform="translate(-1.5 -2)"/>`;
      const paths = g.querySelectorAll("path");
      const dur = 6500;
      Sound.fizz(dur / 1000);
      addEmitter({
        until: now() + dur,
        tick(t, dt) {
          const p = (t - this.start) / dur, e = 1 - Math.pow(1 - p, 1.6);
          const n = Math.max(2, Math.round(e * (pts.length - 1)) + 1);
          const d = "M" + pts.slice(0, n).map((q) => q.join(" ")).join(" L");
          paths.forEach((el) => el.setAttribute("d", d));
          const [bx, by] = at(c, 0, -10);
          if (Math.random() < dt * 10) flash(bx + rand(-3, 3), by, rand(8, 14), 0.12);
          if (Math.random() < dt * 9) {
            const q = pts[Math.floor(Math.random() * Math.min(n, 30))];
            smoke(...at(c, q[0], q[1]), 1, { size: [6, 12], life: [1.4, 2.2], alpha: 0.32, spread: 3, grow: 2.4, rise: [18, 34] });
          }
        },
        done() { fade(c.node, 3500, 1200); },
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
      let ang = 0, x = x0, vx = (seeded(c.id)() * 2 - 1) * 28;
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

  // The big ground-shaker (sutli bomb, and the second half of a dodoma)
  function bigBang(x, y, size = 1.7, ground = true) {
    Sound.bang(size);
    night(2600);
    flash(x, y, 340, 0.5);
    flash(x, y, 130, 0.9);
    rings.push({ x, y, r0: 20, r1: 420, life: 0.65, age: 0 });
    burst(x, y, 190, { speed: [300, 950], g: 300, drag: 3.2, life: [0.35, 0.9], size: [1.4, 2.8], colors: [...GOLD, ...WHITE] });
    burst(x, y, 70, { speed: [80, 300], g: 420, drag: 1.6, life: [0.9, 1.7], size: [1.6, 2.6], colors: ["255,150,60", "255,110,40"], flicker: 0.5 });
    paper(x, y, 60, { speed: ground ? [160, 560] : [60, 360], life: ground ? [1.6, 2.6] : [2.2, 3.4] });
    smoke(x, y, 24, { size: [30, 58], life: [2.6, 4.2], alpha: 0.55, spread: 26, grow: 1.7, rise: [10, 50] });
    shake(16, 650);
  }

  /* ---------- rosun bomb: thrown from the bottom of the chat, bursts where it lands ---------- */
  function throwIt(kind, nx, ny) {
    const b = feedBox();
    const [tx, ty] = fromNorm(nx, ny);
    const sx = b.x + b.w * 0.5 + (nx - 0.5) * b.w * 0.35, sy = b.y + b.h + 24;
    const dist = Math.hypot(tx - sx, ty - sy);
    const dur = clamp(380 + dist * 0.55, 420, 900), arc = 90 + dist * 0.3;
    const { node, svg } = makeNode(kind, "ck");
    svg.querySelector("ellipse").style.display = "none";
    svg.style.transformOrigin = "50% 60%";
    layer.append(node);
    const spinDir = tx < sx ? -1 : 1;
    addEmitter({
      until: now() + dur,
      tick(t) {
        const p = (t - this.start) / dur;
        setNodePos(node, kind, sx + (tx - sx) * p, sy + (ty - sy) * p - arc * 4 * p * (1 - p) + 20);
        svg.style.transform = `rotate(${(spinDir * p * 620).toFixed(1)}deg)`;
      },
      done() {
        node.remove();
        rosunBlast(tx, ty);
      },
    });
  }

  function rosunBlast(x, y) {
    Sound.crack(1.05);
    night(1200);
    flash(x, y, 170, 0.22);
    flash(x, y, 50, 0.35);
    rings.push({ x, y, r0: 6, r1: 150, life: 0.3, age: 0 });
    burst(x, y, 80, { speed: [260, 780], g: 300, drag: 4.5, life: [0.1, 0.32], size: [1, 2], colors: [...WHITE, ...GOLD] });
    paper(x, y, 28, { speed: [120, 420], colors: GRAVEL, size: [1.6, 3.4] });
    smoke(x, y, 8, { size: [16, 30], life: [1.6, 2.6], alpha: 0.45, spread: 10 });
    scorch(x, y + 4, 24);
    shake(7, 240);
  }

  // An aerial shell: peony (coloured ring) or willow (drooping gold)
  function shellBurst(x, y, pal, s = 1, style = "peony") {
    Sound.bang(0.5 + 0.35 * s);
    Sound.crackle(1.2 * s, Math.round(60 * s), 0.7);
    flash(x, y, 240 * s, 0.4);
    flash(x, y, 70 * s, 0.6);
    if (style === "willow") {
      burst(x, y, Math.round(150 * s), { speed: [150 * s, 210 * s], ring: true, g: 150, drag: 1.1, life: [1.8, 2.6], size: [1.3, 2.1], colors: GOLD, flicker: 0.5 });
    } else {
      burst(x, y, Math.round(170 * s), { speed: [230 * s, 290 * s], ring: true, g: 75, drag: 1.3, life: [1.3, 2], size: [1.6, 2.5], colors: [pal[0], pal[0], pal[1]], flicker: 0.35 });
      burst(x, y, Math.round(70 * s), { speed: [40, 150 * s], g: 70, drag: 1.4, life: [0.9, 1.5], size: [1.4, 2.2], colors: [pal[1], WHITE[0]] });
    }
    smoke(x, y, Math.round(6 * s), { size: [40, 70], life: [2.5, 3.5], alpha: 0.22, spread: 60 * s });
    if (s < 1) return;
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
    layoutOverlay();
    capture.hidden = false;
    if (KINDS[kind].thrown) {
      mode = { step: "throw", kind, ghost, lastThrow: 0, timeout: setTimeout(cancelMode, 60000) };
      showHint(`${coarse ? "Tap" : "Click"} where to throw the ${KINDS[kind].name}. Throw as many as you like`);
      return;
    }
    mode = { step: "place", kind, ghost };
    showHint(`${coarse ? "Tap" : "Click"} in the chat to set down the ${KINDS[kind].name}`);
  }

  function throwAt(x, y) {
    const t = now();
    if (t - mode.lastThrow < 350) return;
    mode.lastThrow = t;
    clearTimeout(mode.timeout);
    mode.timeout = setTimeout(cancelMode, 60000);
    const b = feedBox();
    const [nx, ny] = toNorm(clamp(x, b.x + 20, b.x + b.w - 20), clamp(y, b.y + 20, b.y + b.h - 20));
    socket.emit("cracker:throw", { conversationId: activeId, id: newId(), kind: mode.kind, x: nx, y: ny });
    throwIt(mode.kind, nx, ny);
    // the next one is "in your hand" a moment later
    mode.ghost.style.opacity = "0";
    later(350, () => { if (mode && mode.ghost) mode.ghost.style.opacity = ""; });
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
    showHint(c.k.lightHint || "Now touch the fuse with the dhoop kathi");
    // Show the stick where the pointer is, but never light on the same click that placed it
    // (small crackers like saap have the fuse right next to where you click). The stick
    // starts off to the side so the first move doesn't sweep across the fuse either.
    const [x, y] = localPoint(e);
    const touch = e.pointerType === "touch";
    const [fx, fy] = at(c, ...c.k.tip);
    let sx = x, sy = touch ? y - 44 : y;
    if (Math.hypot(sx - fx, sy - fy) < 40) { sx = fx + 46; sy = fy - 30; }
    placeStick(c.stick, sx, sy);
  }

  function onPointer(e, down) {
    if (!mode) return;
    const [x, y] = localPoint(e);
    if (mode.step === "throw") {
      setNodePos(mode.ghost, mode.kind, x, y + 20);
      mode.ghost.style.visibility = "visible";
      if (down) throwAt(x, y);
      return;
    }
    if (mode.step === "hold") {
      const c = mode.cracker, touch = e.pointerType === "touch";
      if (!c.wand) return;
      c.wand.x = x;
      c.wand.y = touch ? y - 44 : y;
      const t = now();
      if (t - mode.lastSent > 40) {
        mode.lastSent = t;
        const [nx, ny] = toNorm(c.wand.x, c.wand.y);
        socket.emit("cracker:stick", { id: c.id, x: nx, y: ny });
      }
      return;
    }
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
      if (c.k.held) {
        // keep the pointer: the lit phuljhuri now follows it
        clearTimeout(mode.timeout);
        mode = { step: "hold", kind: c.kind, cracker: c, lastSent: 0, timeout: setTimeout(endMode, WAND_MS + 500) };
        ignite(c);
        showHint("It's lit! Wave it around, you can write in the air");
        return;
      }
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
  for (const kind of TRAY) {
    const k = KINDS[kind];
    const art = mk("span", "ck-tile-art");
    art.append(artSvg(kind, true));
    const tile = Object.assign(mk("button", "ck-tile"), { type: "button", title: `${k.name}: ${k.blurb}`, onclick: () => startPlacing(kind) });
    tile.append(art, Object.assign(mk("span", "n"), { textContent: k.name }), Object.assign(mk("span", "b"), { textContent: k.blurb }));
    grid.append(tile);
  }

  const head = mk("div", "ck-tray-head");
  head.append(Object.assign(document.createElement("h3"), { textContent: "Diwali crackers" }), soundBtn);
  tray.append(
    head,
    grid,
    Object.assign(mk("p", "ck-tray-foot"), {
      textContent: "Set one down in the chat, then touch the fuse with the dhoop kathi. Rosun bombs you just throw. Everyone in this chat sees and hears it.",
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

  crackerBtn.addEventListener("click", () => (crackerBtn.disabled ? null : tray.hidden ? openTray() : closeTray()));
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
  let blocked = false; // board open in this chat

  socket.on("cracker:place", (d) => {
    if (blocked || !d || d.conversationId !== activeId || document.hidden || crackers.has(d.id) || !KINDS[d.kind]) return;
    addCracker({ id: d.id, kind: d.kind, nx: d.x, ny: d.y, by: d.by });
  });

  socket.on("cracker:throw", (d) => {
    if (blocked || !d || d.conversationId !== activeId || document.hidden || !KINDS[d.kind] || !KINDS[d.kind].thrown) return;
    throwIt(d.kind, d.x, d.y);
  });

  socket.on("cracker:stick", (d) => {
    const c = d && crackers.get(d.id);
    if (!c || c.mine) return;
    if (c.holding) { [c.wand.tx, c.wand.ty] = fromNorm(d.x, d.y); return; }
    if (c.lit) return;
    if (!c.stick) c.stick = makeStick(d.by);
    c.stickN = [d.x, d.y];
    placeStick(c.stick, ...fromNorm(d.x, d.y));
  });

  socket.on("cracker:ignite", (d) => {
    const c = d && crackers.get(d.id);
    if (!c) return;
    if (document.hidden || blocked) return removeCracker(c);
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
    // The shared board is open in this chat: no crackers until everyone closes it
    setBlocked(on) {
      on = !!on;
      if (on === blocked) return;
      blocked = on;
      if (on) this.reset();
      crackerBtn.disabled = on;
      crackerBtn.title = on ? "Crackers are off while the board is open" : "Diwali crackers";
    },
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
