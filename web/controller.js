// PlayStation-style glyphs + DualSense Edge illustration (SVG strings).
"use strict";

const GLYPH_COLORS = { tri: "#3fd0b6", cir: "#ff5a6e", crs: "#6aa8ff", sq: "#f07ad1" };

// glyph markup centred on (cx, cy)
function glyph(type, cx, cy, s = 22, o = {}) {
  const r = s / 2, sw = Math.max(1.6, s / 11);
  const fg = o.fg || "currentColor", bg = o.bg || "rgba(255,255,255,.06)", br = o.border || "rgba(255,255,255,.16)";
  const ring = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${bg}" stroke="${br}" stroke-width="1"/>`;
  const box = (txt, w = s * 1.25) =>
    `<rect x="${cx - w / 2}" y="${cy - r * 0.8}" width="${w}" height="${s * 0.8}" rx="${s * 0.22}" fill="${bg}" stroke="${br}"/>` +
    `<text x="${cx}" y="${cy + s * 0.15}" text-anchor="middle" font-size="${s * 0.42}" font-weight="700" fill="${fg}" font-family="-apple-system,sans-serif">${txt}</text>`;
  const k = r * 0.48;
  const col = (t) => (o.mono ? fg : GLYPH_COLORS[t]);
  switch (type) {
    case "tri": return ring + `<polygon points="${cx},${cy - k} ${cx + k * 0.95},${cy + k * 0.62} ${cx - k * 0.95},${cy + k * 0.62}" fill="none" stroke="${col("tri")}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    case "cir": return ring + `<circle cx="${cx}" cy="${cy}" r="${k * 0.82}" fill="none" stroke="${col("cir")}" stroke-width="${sw}"/>`;
    case "crs": return ring + `<path d="M${cx - k * .72},${cy - k * .72}L${cx + k * .72},${cy + k * .72}M${cx + k * .72},${cy - k * .72}L${cx - k * .72},${cy + k * .72}" stroke="${col("crs")}" stroke-width="${sw}" stroke-linecap="round"/>`;
    case "sq": return ring + `<rect x="${cx - k * .7}" y="${cy - k * .7}" width="${k * 1.4}" height="${k * 1.4}" rx="1.5" fill="none" stroke="${col("sq")}" stroke-width="${sw}"/>`;
    case "up": case "down": case "left": case "right": {
      const rot = { up: 0, right: 90, down: 180, left: 270 }[type];
      return ring + `<path transform="rotate(${rot} ${cx} ${cy})" d="M${cx - k * .55},${cy + k * .35}L${cx},${cy - k * .45}L${cx + k * .55},${cy + k * .35}" fill="none" stroke="${fg}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    case "L1": case "R1": case "L2": case "R2": return box(type);
    case "L3": case "R3":
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${bg}" stroke="${br}"/><circle cx="${cx}" cy="${cy}" r="${r * .62}" fill="none" stroke="${br}"/>` +
        `<text x="${cx}" y="${cy + s * 0.15}" text-anchor="middle" font-size="${s * 0.38}" font-weight="700" fill="${fg}" font-family="-apple-system,sans-serif">${type}</text>`;
    case "PL": case "PR": return box(type === "PL" ? "◖P" : "P◗", s * 1.35);
    case "opt": return box("☰", s);
    case "create": return box("⇪", s);
    case "ps": return ring + `<text x="${cx}" y="${cy + s * .16}" text-anchor="middle" font-size="${s * .4}" font-weight="800" fill="${fg}" font-family="-apple-system,sans-serif">PS</text>`;
    case "touch": return box("▭", s * 1.3);
    case "mute": return box("🎙", s * 1.1);
    case "fn": return box("Fn", s * 1.1);
    case "none": return ring + `<path d="M${cx - k * .7},${cy + k * .7}L${cx + k * .7},${cy - k * .7}" stroke="${fg}" stroke-width="${sw}" opacity=".5"/>`;
  }
  return ring;
}
const WIDE = new Set(["L1", "R1", "L2", "R2", "PL", "PR", "opt", "create", "touch", "fn", "mute"]);
function glyphSvg(type, s = 22, o = {}) {
  const w = WIDE.has(type) ? s * 1.4 : s;
  return `<svg class="g" width="${w}" height="${s}" viewBox="${-(w - s) / 2} 0 ${w} ${s}">${glyph(type, s / 2, s / 2, s, o)}</svg>`;
}

// Physical button index (0..15, as in the profile mapping table) ↔ glyph / part / name
const PHYS = [
  { g: "up", name: T("Direcional ↑"), short: "↑" }, { g: "right", name: T("Direcional →"), short: "→" },
  { g: "down", name: T("Direcional ↓"), short: "↓" }, { g: "left", name: T("Direcional ←"), short: "←" },
  { g: "cir", name: T("Círculo"), short: T("Círculo") }, { g: "crs", name: T("Xis"), short: T("Xis") },
  { g: "sq", name: T("Quadrado"), short: T("Quadrado") }, { g: "tri", name: T("Triângulo"), short: T("Triângulo") },
  { g: "R1", name: "R1", short: "R1" }, { g: "R2", name: "R2", short: "R2" }, { g: "R3", name: "R3", short: "R3" },
  { g: "L1", name: "L1", short: "L1" }, { g: "L2", name: "L2", short: "L2" }, { g: "L3", name: "L3", short: "L3" },
  { g: "PL", name: T("Paddle esquerdo"), short: T("Paddle esq.") }, { g: "PR", name: T("Paddle direito"), short: T("Paddle dir.") },
];
const PART_TO_INDEX = { up: 0, right: 1, down: 2, left: 3, cir: 4, crs: 5, sq: 6, tri: 7, R1: 8, R2: 9, R3: 10, L1: 11, L2: 12, L3: 13, PL: 14, PR: 15 };
const INDEX_TO_PART = Object.fromEntries(Object.entries(PART_TO_INDEX).map(([k, v]) => [v, k]));

// anchor points (viewBox 600×400) used for callout lines
const ANCHOR = {
  L2: [160, 34], R2: [440, 34], L1: [150, 66], R1: [450, 66],
  up: [130, 140], left: [100, 168], right: [160, 168], down: [130, 196],
  tri: [470, 132], cir: [506, 168], crs: [470, 204], sq: [434, 168],
  L3: [214, 240], R3: [386, 240], PL: [84, 330], PR: [516, 330],
};

let _uid = 0;
// DualSense Edge, top view. viewBox 0 0 600 400.
// o.hl = {part: color}, o.ls/o.rs = [-1..1, -1..1], o.touches = [{x,y}] (0..1), o.light = colour
function controllerSvg(o = {}) {
  const u = ++_uid;
  const hl = o.hl || {};
  const body = o.body || "#1a1f2c", edge = o.edge || "#283044", detail = o.detail || "#0f121b", line = o.line || "#36405a";
  const glow = (id, base) => (hl[id] ? `fill="${hl[id]}" fill-opacity=".9"` : `fill="${base}"`);
  const st = (id) => (hl[id] ? `stroke="${hl[id]}" stroke-width="2.5"` : `stroke="${line}" stroke-width="1.2"`);
  const P = (id) => `data-part="${id}" class="part"`;
  const face = (id, x, y) => `<g ${P(id)}>${hl[id] ? `<circle cx="${x}" cy="${y}" r="21" fill="${hl[id]}" opacity=".28"/>` : ""}<circle cx="${x}" cy="${y}" r="17" fill="transparent"/>${glyph(id, x, y, 28, { bg: detail, border: hl[id] || line })}</g>`;
  const ls = o.ls || [0, 0], rs = o.rs || [0, 0];
  const touches = (o.touches || []).map((t, i) => `<circle cx="${214 + t.x * 172}" cy="${80 + t.y * 104}" r="8" fill="${i ? "#ff8a5c" : "#f5b84a"}" opacity=".95"/>`).join("");
  const stick = (id, cx, v) => `<g ${P(id)}><circle cx="${cx}" cy="240" r="40" fill="${detail}" ${st(id)}/>
      <circle cx="${cx + v[0] * 14}" cy="${240 + v[1] * 14}" r="26" fill="${edge}" stroke="${line}"/>
      <circle cx="${cx + v[0] * 14}" cy="${240 + v[1] * 14}" r="18" fill="none" stroke="${line}" stroke-dasharray="2 3"/></g>`;
  return `<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" class="ctrl">
  <defs>
    <linearGradient id="bodyG${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${body}"/><stop offset="1" stop-color="${detail}"/></linearGradient>
    <radialGradient id="padG${u}" cx=".5" cy=".3" r=".8"><stop offset="0" stop-color="${edge}"/><stop offset="1" stop-color="${body}"/></radialGradient>
  </defs>
  <path ${P("L2")} d="M118,52 C126,30 150,22 186,22 C206,22 214,30 214,42 L214,58 L118,64 Z" ${glow("L2", edge)} ${st("L2")}/>
  <path ${P("R2")} d="M482,52 C474,30 450,22 414,22 C394,22 386,30 386,42 L386,58 L482,64 Z" ${glow("R2", edge)} ${st("R2")}/>
  <path ${P("L1")} d="M104,78 C112,62 140,56 178,56 L222,56 L222,74 L104,86 Z" ${glow("L1", body)} ${st("L1")}/>
  <path ${P("R1")} d="M496,78 C488,62 460,56 422,56 L378,56 L378,74 L496,86 Z" ${glow("R1", body)} ${st("R1")}/>
  <path ${P("PL")} d="M70,300 C62,330 70,352 92,356 L104,300 Z" ${hl.PL ? `fill="${hl.PL}" fill-opacity=".85"` : `fill="${edge}" fill-opacity=".5"`} stroke="${hl.PL || line}" stroke-dasharray="${hl.PL ? "0" : "4 3"}"/>
  <path ${P("PR")} d="M530,300 C538,330 530,352 508,356 L496,300 Z" ${hl.PR ? `fill="${hl.PR}" fill-opacity=".85"` : `fill="${edge}" fill-opacity=".5"`} stroke="${hl.PR || line}" stroke-dasharray="${hl.PR ? "0" : "4 3"}"/>
  <path d="M150,72 C200,62 250,66 300,66 C350,66 400,62 450,72 C505,84 532,112 546,164 L584,300 C598,352 566,388 530,378 C500,370 482,344 462,310 C448,288 432,280 404,280 L196,280 C168,280 152,288 138,310 C118,344 100,370 70,378 C34,388 2,352 16,300 L54,164 C68,112 95,84 150,72 Z" fill="url(#bodyG${u})" stroke="${line}" stroke-width="1.5"/>
  <path d="M168,84 C220,76 380,76 432,84" fill="none" stroke="${edge}" stroke-width="2" opacity=".7"/>
  <rect ${P("touch")} x="214" y="80" width="172" height="104" rx="18" fill="url(#padG${u})" ${st("touch")}/>
  ${touches}
  <path d="M214,186 Q300,196 386,186" fill="none" stroke="${o.light || "#4f8cff"}" stroke-width="3" stroke-linecap="round" opacity=".85"/>
  <rect ${P("create")} x="186" y="96" width="12" height="24" rx="6" ${glow("create", detail)} ${st("create")}/>
  <rect ${P("opt")} x="402" y="96" width="12" height="24" rx="6" ${glow("opt", detail)} ${st("opt")}/>
  <circle cx="130" cy="168" r="50" fill="${detail}" opacity=".55"/>
  <path ${P("up")} d="M118,132 h24 v20 l-12,12 l-12,-12 z" ${glow("up", edge)} ${st("up")}/>
  <path ${P("down")} d="M118,204 h24 v-20 l-12,-12 l-12,12 z" ${glow("down", edge)} ${st("down")}/>
  <path ${P("left")} d="M94,156 v24 h20 l12,-12 l-12,-12 z" ${glow("left", edge)} ${st("left")}/>
  <path ${P("right")} d="M166,156 v24 h-20 l-12,-12 l12,-12 z" ${glow("right", edge)} ${st("right")}/>
  <circle cx="470" cy="168" r="54" fill="${detail}" opacity=".55"/>
  ${face("tri", 470, 132)}${face("cir", 506, 168)}${face("crs", 470, 204)}${face("sq", 434, 168)}
  ${stick("L3", 214, ls)}${stick("R3", 386, rs)}
  <circle ${P("ps")} cx="300" cy="228" r="13" ${glow("ps", detail)} ${st("ps")}/>
  <text x="300" y="232" text-anchor="middle" font-size="10" font-weight="800" fill="${line}" font-family="-apple-system,sans-serif" pointer-events="none">PS</text>
  <rect ${P("mute")} x="290" y="250" width="20" height="7" rx="3.5" ${glow("mute", detail)} ${st("mute")}/>
  <rect ${P("fnl")} x="240" y="290" width="26" height="10" rx="5" ${glow("fnl", detail)} ${st("fnl")}/>
  <rect ${P("fnr")} x="334" y="290" width="26" height="10" rx="5" ${glow("fnr", detail)} ${st("fnr")}/>
</svg>`;
}

function curvePath(pts, w, h) {
  const all = [[0, 0], ...pts, [255, 255]];
  return all.map(([x, y], i) => `${i ? "L" : "M"}${((x / 255) * w).toFixed(1)},${(h - (y / 255) * h).toFixed(1)}`).join(" ");
}
