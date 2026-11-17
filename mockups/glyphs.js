// Shared drawing helpers for the mockups: PlayStation-style button glyphs + a DualSense Edge illustration.
"use strict";

const C = { tri: "#3fd0b6", cir: "#ff5a6e", crs: "#6aa8ff", sq: "#f07ad1" };

// glyph(type, cx, cy, size, opts) → SVG markup centred on (cx, cy)
function glyph(type, cx, cy, s = 22, o = {}) {
  const r = s / 2, sw = Math.max(1.6, s / 11);
  const fg = o.fg || "currentColor", bg = o.bg || "rgba(255,255,255,.06)", br = o.border || "rgba(255,255,255,.14)";
  const ring = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${bg}" stroke="${br}" stroke-width="1"/>`;
  const box = (txt, w = s * 1.25) =>
    `<rect x="${cx - w / 2}" y="${cy - r * 0.8}" width="${w}" height="${s * 0.8}" rx="${s * 0.22}" fill="${bg}" stroke="${br}"/>` +
    `<text x="${cx}" y="${cy + s * 0.15}" text-anchor="middle" font-size="${s * 0.42}" font-weight="700" fill="${fg}" font-family="-apple-system,sans-serif">${txt}</text>`;
  const k = r * 0.48;
  switch (type) {
    case "tri": return ring + `<polygon points="${cx},${cy - k} ${cx + k * 0.95},${cy + k * 0.62} ${cx - k * 0.95},${cy + k * 0.62}" fill="none" stroke="${o.mono ? fg : C.tri}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    case "cir": return ring + `<circle cx="${cx}" cy="${cy}" r="${k * 0.82}" fill="none" stroke="${o.mono ? fg : C.cir}" stroke-width="${sw}"/>`;
    case "crs": return ring + `<path d="M${cx - k * .72},${cy - k * .72}L${cx + k * .72},${cy + k * .72}M${cx + k * .72},${cy - k * .72}L${cx - k * .72},${cy + k * .72}" stroke="${o.mono ? fg : C.crs}" stroke-width="${sw}" stroke-linecap="round"/>`;
    case "sq": return ring + `<rect x="${cx - k * .7}" y="${cy - k * .7}" width="${k * 1.4}" height="${k * 1.4}" rx="1.5" fill="none" stroke="${o.mono ? fg : C.sq}" stroke-width="${sw}"/>`;
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
    case "ps": return ring + `<text x="${cx}" y="${cy + s * .16}" text-anchor="middle" font-size="${s * .42}" font-weight="800" fill="${fg}" font-family="-apple-system,sans-serif">PS</text>`;
    case "touch": return box("▭", s * 1.3);
    case "fn": return box("Fn", s * 1.1);
    case "none": return ring + `<path d="M${cx - k * .7},${cy + k * .7}L${cx + k * .7},${cy - k * .7}" stroke="${fg}" stroke-width="${sw}" opacity=".5"/>`;
  }
  return ring;
}
const glyphSvg = (type, s = 22, o = {}) =>
  `<svg width="${type.length === 2 && /[LRP]/.test(type[0]) ? s * 1.4 : s}" height="${s}" viewBox="${-(type.length === 2 && /[LRP]/.test(type[0]) ? s * .2 : 0)} 0 ${type.length === 2 && /[LRP]/.test(type[0]) ? s * 1.4 : s} ${s}" style="display:inline-block;vertical-align:middle;overflow:visible">${glyph(type, s / 2, s / 2, s, o)}</svg>`;

const BTN = {
  L2: { name: "L2", g: "L2" }, R2: { name: "R2", g: "R2" }, L1: { name: "L1", g: "L1" }, R1: { name: "R1", g: "R1" },
  up: { name: "Direcional ↑", g: "up" }, right: { name: "Direcional →", g: "right" }, down: { name: "Direcional ↓", g: "down" }, left: { name: "Direcional ←", g: "left" },
  tri: { name: "Triângulo", g: "tri" }, cir: { name: "Círculo", g: "cir" }, crs: { name: "Xis", g: "crs" }, sq: { name: "Quadrado", g: "sq" },
  L3: { name: "L3", g: "L3" }, R3: { name: "R3", g: "R3" }, PL: { name: "Paddle esquerdo", g: "PL" }, PR: { name: "Paddle direito", g: "PR" },
  none: { name: "Sem função", g: "none" },
};

// DualSense Edge, top view. viewBox 0 0 600 400. `hl` = {partId: color}
function controllerSvg(o = {}) {
  const hl = o.hl || {};
  const body = o.body || "#1b2029", edge = o.edge || "#2c3442", detail = o.detail || "#11151c", line = o.line || "#3a4455";
  const glow = (id, base) => (hl[id] ? `fill="${hl[id]}" fill-opacity=".9"` : `fill="${base}"`);
  const st = (id) => (hl[id] ? `stroke="${hl[id]}" stroke-width="2.5"` : `stroke="${line}" stroke-width="1.2"`);
  const face = (id, x, y, t) => `<g>${hl[id] ? `<circle cx="${x}" cy="${y}" r="20" fill="${hl[id]}" opacity=".25"/>` : ""}${glyph(t, x, y, 28, { bg: detail, border: hl[id] || line })}</g>`;
  return `<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;overflow:visible">
  <defs>
    <linearGradient id="bodyG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${body}" stop-opacity="1"/><stop offset="1" stop-color="${detail}"/></linearGradient>
    <radialGradient id="padG" cx=".5" cy=".3" r=".8"><stop offset="0" stop-color="${edge}"/><stop offset="1" stop-color="${body}"/></radialGradient>
  </defs>
  <!-- triggers / shoulders -->
  <path id="L2" d="M118,52 C126,30 150,22 186,22 C206,22 214,30 214,42 L214,58 L118,64 Z" ${glow("L2", edge)} ${st("L2")}/>
  <path id="R2" d="M482,52 C474,30 450,22 414,22 C394,22 386,30 386,42 L386,58 L482,64 Z" ${glow("R2", edge)} ${st("R2")}/>
  <path id="L1" d="M104,78 C112,62 140,56 178,56 L222,56 L222,74 L104,86 Z" ${glow("L1", body)} ${st("L1")}/>
  <path id="R1" d="M496,78 C488,62 460,56 422,56 L378,56 L378,74 L496,86 Z" ${glow("R1", body)} ${st("R1")}/>
  <!-- back paddles (ghosted, behind grips) -->
  <path id="PL" d="M70,300 C62,330 70,352 92,356 L104,300 Z" ${hl.PL ? `fill="${hl.PL}" fill-opacity=".85"` : `fill="${edge}" fill-opacity=".5"`} stroke="${hl.PL || line}" stroke-dasharray="${hl.PL ? "0" : "4 3"}"/>
  <path id="PR" d="M530,300 C538,330 530,352 508,356 L496,300 Z" ${hl.PR ? `fill="${hl.PR}" fill-opacity=".85"` : `fill="${edge}" fill-opacity=".5"`} stroke="${hl.PR || line}" stroke-dasharray="${hl.PR ? "0" : "4 3"}"/>
  <!-- body -->
  <path d="M150,72 C200,62 250,66 300,66 C350,66 400,62 450,72 C505,84 532,112 546,164 L584,300 C598,352 566,388 530,378 C500,370 482,344 462,310 C448,288 432,280 404,280 L196,280 C168,280 152,288 138,310 C118,344 100,370 70,378 C34,388 2,352 16,300 L54,164 C68,112 95,84 150,72 Z" fill="url(#bodyG)" stroke="${line}" stroke-width="1.5"/>
  <path d="M168,84 C220,76 380,76 432,84" fill="none" stroke="${edge}" stroke-width="2" opacity=".7"/>
  <!-- touchpad -->
  <rect id="touch" x="214" y="80" width="172" height="104" rx="18" fill="url(#padG)" ${st("touch")}/>
  ${o.touchDots || ""}
  <!-- light bar -->
  <path d="M214,186 Q300,196 386,186" fill="none" stroke="${o.light || "#3d8bff"}" stroke-width="3" stroke-linecap="round" opacity=".85"/>
  <!-- create / options -->
  <rect id="create" x="186" y="96" width="12" height="24" rx="6" ${glow("create", detail)} ${st("create")}/>
  <rect id="opt" x="402" y="96" width="12" height="24" rx="6" ${glow("opt", detail)} ${st("opt")}/>
  <!-- d-pad -->
  <circle cx="130" cy="168" r="50" fill="${detail}" opacity=".55"/>
  <path id="up" d="M118,132 h24 v20 l-12,12 l-12,-12 z" ${glow("up", edge)} ${st("up")}/>
  <path id="down" d="M118,204 h24 v-20 l-12,-12 l-12,12 z" ${glow("down", edge)} ${st("down")}/>
  <path id="left" d="M94,156 v24 h20 l12,-12 l-12,-12 z" ${glow("left", edge)} ${st("left")}/>
  <path id="right" d="M166,156 v24 h-20 l-12,-12 l12,-12 z" ${glow("right", edge)} ${st("right")}/>
  <!-- face buttons -->
  <circle cx="470" cy="168" r="54" fill="${detail}" opacity=".55"/>
  ${face("tri", 470, 132, "tri")}${face("cir", 506, 168, "cir")}${face("crs", 470, 204, "crs")}${face("sq", 434, 168, "sq")}
  <!-- sticks -->
  <g id="L3"><circle cx="214" cy="240" r="40" fill="${detail}" ${st("L3")}/><circle id="lstick" cx="${214 + (o.ls ? o.ls[0] * 14 : 0)}" cy="${240 + (o.ls ? o.ls[1] * 14 : 0)}" r="26" fill="${edge}" stroke="${line}"/><circle cx="${214 + (o.ls ? o.ls[0] * 14 : 0)}" cy="${240 + (o.ls ? o.ls[1] * 14 : 0)}" r="18" fill="none" stroke="${line}" stroke-dasharray="2 3"/></g>
  <g id="R3"><circle cx="386" cy="240" r="40" fill="${detail}" ${st("R3")}/><circle cx="${386 + (o.rs ? o.rs[0] * 14 : 0)}" cy="${240 + (o.rs ? o.rs[1] * 14 : 0)}" r="26" fill="${edge}" stroke="${line}"/><circle cx="${386 + (o.rs ? o.rs[0] * 14 : 0)}" cy="${240 + (o.rs ? o.rs[1] * 14 : 0)}" r="18" fill="none" stroke="${line}" stroke-dasharray="2 3"/></g>
  <!-- ps / mute / fn -->
  <circle id="ps" cx="300" cy="228" r="13" ${glow("ps", detail)} ${st("ps")}/>
  <text x="300" y="232" text-anchor="middle" font-size="10" font-weight="800" fill="${line}" font-family="-apple-system,sans-serif">PS</text>
  <rect id="mute" x="290" y="250" width="20" height="7" rx="3.5" fill="${detail}" stroke="${line}"/>
  <rect id="fnl" x="240" y="290" width="26" height="10" rx="5" ${glow("fnl", detail)} ${st("fnl")}/>
  <rect id="fnr" x="334" y="290" width="26" height="10" rx="5" ${glow("fnr", detail)} ${st("fnr")}/>
</svg>`;
}

// anchor points of each part (viewBox coords), used for callout lines
const ANCHOR = {
  L2: [160, 34], R2: [440, 34], L1: [150, 66], R1: [450, 66],
  up: [130, 140], left: [100, 168], right: [160, 168], down: [130, 196],
  tri: [470, 132], cir: [506, 168], crs: [470, 204], sq: [434, 168],
  L3: [214, 240], R3: [386, 240], PL: [84, 330], PR: [516, 330],
};

// tiny curve preview path for presets / cards
function curvePath(pts, w, h) {
  const all = [[0, 0], ...pts, [255, 255]];
  return all.map(([x, y], i) => `${i ? "L" : "M"}${(x / 255) * w},${h - (y / 255) * h}`).join(" ");
}
