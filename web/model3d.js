// Small dependency-free 3D renderer for a DualSense Edge model (Canvas 2D, flat shading, painter's sort).
// Model space: X → right, Y → forward (towards the triggers), Z → up (out of the top face). Units ≈ 10 cm.
"use strict";

const Controller3D = (() => {
  const BODY = "M150,72 C200,62 250,66 300,66 C350,66 400,62 450,72 C505,84 532,112 546,164 L584,300 C598,352 566,388 530,378 C500,370 482,344 462,310 C448,288 432,280 404,280 L196,280 C168,280 152,288 138,310 C118,344 100,370 70,378 C34,388 2,352 16,300 L54,164 C68,112 95,84 150,72 Z";
  const sv = (px, py) => [(px - 300) / 100, (220 - py) / 100];
  const TOP = 0.2;

  // ---------- vector helpers ----------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const centroid = (pts) => { const c = [0, 0, 0]; for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } return c.map((v) => v / pts.length); };
  function newell(pts) {
    const n = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return norm(n);
  }
  const shadeHex = (hex, k) => {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((n >> 16) & 255) * k), g = Math.min(255, ((n >> 8) & 255) * k), b = Math.min(255, (n & 255) * k);
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  };

  // ---------- outline sampling ----------
  let OUTLINE = null;
  function outline() {
    if (OUTLINE) return OUTLINE;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", BODY);
    svg.append(p);
    document.body.append(svg);
    const L = p.getTotalLength(), N = 110, pts = [];
    for (let i = 0; i < N; i++) { const q = p.getPointAtLength((i / N) * L); pts.push(sv(q.x, q.y)); }
    svg.remove();
    let area = 0;
    for (let i = 0; i < N; i++) { const a = pts[i], b = pts[(i + 1) % N]; area += a[0] * b[1] - b[0] * a[1]; }
    if (area < 0) pts.reverse();               // counter-clockwise seen from above
    OUTLINE = pts;
    return pts;
  }

  // ---------- primitive builders (faces carry an outward hint) ----------
  function prism(poly2, z0, z1, color, opt = {}) {
    // vertical prism over a CCW 2D polygon
    const faces = [];
    const top = poly2.map(([x, y]) => [x, y, z1]), bot = poly2.map(([x, y]) => [x, y, z0]);
    const c = centroid(top);
    faces.push({ pts: top, color: opt.top || color, hint: [0, 0, 1], part: opt.part, cap: true });
    if (!opt.noBottom) faces.push({ pts: bot.slice().reverse(), color: opt.side || color, hint: [0, 0, -1], part: opt.part });
    for (let i = 0; i < poly2.length; i++) {
      const j = (i + 1) % poly2.length;
      const q = [bot[i], bot[j], top[j], top[i]];
      faces.push({ pts: q, color: opt.side || color, hint: sub(centroid(q), [c[0], c[1], centroid(q)[2]]), part: opt.part });
    }
    return faces;
  }
  const circle = (cx, cy, r, n = 18) => Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * 2 * Math.PI) * r, cy + Math.sin((i / n) * 2 * Math.PI) * r]);
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  function roundRect(x0, y0, x1, y1, r, n = 5) {
    const pts = [];
    const corners = [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]];
    for (const [cx, cy, a0] of corners) for (let i = 0; i <= n; i++) { const a = ((a0 + (90 * i) / n) * Math.PI) / 180; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return pts;
  }
  const decal = (poly2, z, color, part) => ({ pts: poly2.map(([x, y]) => [x, y, z]), color, hint: [0, 0, 1], part, flat: true });
  const line = (pts3, color, width, part) => ({ line: true, pts: pts3, color, width, part, hint: [0, 0, 1] });

  // ---------- static mesh ----------
  const COL = { body: "#2a3242", top: "#2f3849", under: "#1d232e", dark: "#151a23", pad: "#344055", btn: "#202736", trig: "#232a38" };
  let STATIC = null;
  function buildStatic() {
    if (STATIC) return STATIC;
    const o = outline();
    const cx = o.reduce((s, p) => s + p[0], 0) / o.length, cy = o.reduce((s, p) => s + p[1], 0) / o.length;
    const zb = (y) => -0.26 - Math.max(0, Math.min(1.2, -y - 0.35)) * 0.32;   // grips hang lower
    const ring = (s, zf) => o.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s, zf(y)]);
    const rings = [ring(0.965, () => TOP), ring(1, () => 0.09), ring(0.99, (y) => zb(y) * 0.55), ring(0.93, zb)];
    const faces = [];
    for (let r = 0; r < rings.length - 1; r++) {
      const A = rings[r], B = rings[r + 1];
      for (let i = 0; i < o.length; i++) {
        const j = (i + 1) % o.length;
        const q = [B[i], B[j], A[j], A[i]];
        const qc = centroid(q);
        faces.push({ pts: q, color: r === 0 ? COL.top : r === 1 ? COL.body : COL.under, hint: [qc[0] - cx, qc[1] - cy, r === 0 ? 0.6 : r === 2 ? -0.6 : 0], body: true });
      }
    }
    faces.push({ pts: rings[0], color: COL.top, hint: [0, 0, 1], body: true, topFace: true });
    faces.push({ pts: rings[3].slice().reverse(), color: COL.under, hint: [0, 0, -1], body: true, bottomFace: true });

    const det = [];
    // touchpad
    const [tx0, ty1] = sv(214, 80), [tx1, ty0] = sv(386, 184);
    det.push(...prism(roundRect(tx0, ty0, tx1, ty1, 0.17), TOP, TOP + 0.025, COL.pad, { part: "touch", noBottom: true }));
    // wells
    const [dx, dy] = sv(130, 168), [fx, fy] = sv(470, 168);
    det.push(decal(circle(dx, dy, 0.52, 28), TOP + 0.002, COL.dark), decal(circle(fx, fy, 0.55, 28), TOP + 0.002, COL.dark));
    // d-pad (4 arms)
    const arm = 0.12, len = 0.37, gap = 0.07;
    det.push(...prism(rect(dx - arm, dy + gap, dx + arm, dy + len), TOP, TOP + 0.055, COL.btn, { part: "up", noBottom: true }));
    det.push(...prism(rect(dx - arm, dy - len, dx + arm, dy - gap), TOP, TOP + 0.055, COL.btn, { part: "down", noBottom: true }));
    det.push(...prism(rect(dx - len, dy - arm, dx - gap, dy + arm), TOP, TOP + 0.055, COL.btn, { part: "left", noBottom: true }));
    det.push(...prism(rect(dx + gap, dy - arm, dx + len, dy + arm), TOP, TOP + 0.055, COL.btn, { part: "right", noBottom: true }));
    // face buttons + glyph decals
    const FB = { tri: sv(470, 132), cir: sv(506, 168), crs: sv(470, 204), sq: sv(434, 168) };
    for (const [id, [x, y]] of Object.entries(FB)) {
      det.push(...prism(circle(x, y, 0.15, 16), TOP, TOP + 0.06, COL.btn, { part: id, noBottom: true }));
      const z = TOP + 0.062, k = 0.075, c = GLYPH_COLORS[id];
      if (id === "tri") det.push(line([[x, y + k], [x + k * .9, y - k * .6], [x - k * .9, y - k * .6], [x, y + k]].map((p) => [...p, z]), c, 2, id));
      if (id === "cir") det.push(line(circle(x, y, k * .85, 14).concat([[x + k * .85, y]]).map((p) => [...p, z]), c, 2, id));
      if (id === "sq") det.push(line([[x - k * .7, y - k * .7], [x + k * .7, y - k * .7], [x + k * .7, y + k * .7], [x - k * .7, y + k * .7], [x - k * .7, y - k * .7]].map((p) => [...p, z]), c, 2, id));
      if (id === "crs") { det.push(line([[x - k * .7, y - k * .7, z], [x + k * .7, y + k * .7, z]], c, 2, id), line([[x + k * .7, y - k * .7, z], [x - k * .7, y + k * .7, z]], c, 2, id)); }
    }
    // stick wells
    for (const px of [214, 386]) { const [x, y] = sv(px, 240); det.push(decal(circle(x, y, 0.42, 26), TOP + 0.002, COL.dark)); }
    // PS, mute, create, options, fn
    const [psx, psy] = sv(300, 228);
    det.push(...prism(circle(psx, psy, 0.12, 14), TOP, TOP + 0.03, COL.btn, { part: "ps", noBottom: true }));
    det.push(...prism(roundRect(-0.1, -0.36, 0.1, -0.29, 0.03, 2), TOP, TOP + 0.02, COL.btn, { part: "mute", noBottom: true }));
    for (const [px, part] of [[192, "create"], [408, "opt"]]) { const [x, y] = sv(px, 108); det.push(...prism(roundRect(x - 0.06, y - 0.12, x + 0.06, y + 0.12, 0.05, 2), TOP, TOP + 0.03, COL.btn, { part, noBottom: true })); }
    for (const [x, part] of [[-0.47, "fnl"], [0.47, "fnr"]]) det.push(...prism(roundRect(x - 0.13, -0.56, x + 0.13, -0.46, 0.04, 2), TOP, TOP + 0.02, COL.btn, { part, noBottom: true }));
    // light bar
    const lb = []; for (let i = 0; i <= 16; i++) { const t = i / 16; lb.push([-0.86 + 1.72 * t, 0.33 - Math.sin(t * Math.PI) * 0.06, TOP + 0.004]); }
    det.push(line(lb, "#4f8cff", 3, "light"));

    // paddles under the grips (L1/L2/R1/R2 are built per frame in shoulders())
    const outer = [];
    for (const s of [-1, 1]) {
      const P = s < 0 ? "PL" : "PR";
      const p0 = s < 0 ? -2.3 : 1.92, p1 = s < 0 ? -1.92 : 2.3;
      outer.push(...prism(roundRect(p0, -1.4, p1, -0.82, 0.12, 3), zb(-1.1) - 0.07, zb(-1.1) + 0.02, COL.btn, { part: P }).map((f) => ({ ...f, grp: P })));
    }
    STATIC = { faces: faces.concat(outer), det };
    return STATIC;
  }

  // y of the body's front edge at a given x (outline, top half)
  function frontY(x) {
    const o = outline();
    let best = -Infinity;
    for (let i = 0; i < o.length; i++) {
      const a = o[i], b = o[(i + 1) % o.length];
      if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
      const t = (x - a[0]) / (b[0] - a[0]), y = a[1] + (b[1] - a[1]) * t;
      if (y > best) best = y;
    }
    return best;
  }
  // extrude a closed (y,z) profile along x, the profile following the front edge
  function extrude(x0, x1, profile, color, part, n = 9) {
    const grp = part;
    let area = 0;
    for (let i = 0; i < profile.length; i++) { const a = profile[i], b = profile[(i + 1) % profile.length]; area += a[0] * b[1] - b[0] * a[1]; }
    const pr = area < 0 ? profile.slice().reverse() : profile;   // CCW in (y,z)
    const secs = [];
    for (let k = 0; k <= n; k++) { const x = x0 + ((x1 - x0) * k) / n, fy = frontY(x); secs.push(pr.map(([dy, z]) => [x, fy + dy, z])); }
    const faces = [];
    for (let k = 0; k < n; k++) {
      const A = secs[k], B = secs[k + 1];
      for (let i = 0; i < pr.length; i++) {
        const j = (i + 1) % pr.length;
        const ey = pr[j][0] - pr[i][0], ez = pr[j][1] - pr[i][1];
        faces.push({ pts: [A[i], A[j], B[j], B[i]], color, hint: [0, ez, -ey], part, grp });
      }
    }
    faces.push({ pts: secs[0].slice().reverse(), color, hint: [-1, 0, 0], part, grp });
    faces.push({ pts: secs[n], color, hint: [1, 0, 0], part, grp });
    return faces;
  }
  // L1/R1 bumpers on the front edge, L2/R2 curved triggers hanging below them (rotate when pulled)
  function shoulders(l2, r2) {
    const out = [];
    const bumper = [[-0.08, 0.15], [0.06, 0.15], [0.1, 0.12], [0.11, 0.07], [0.08, 0.025], [-0.08, 0.025]];
    for (const [s, v] of [[-1, l2], [1, r2]]) {
      const a = s < 0 ? -1.95 : 0.85, b = s < 0 ? -0.85 : 1.95;
      out.push(...extrude(a, b, bumper, COL.trig, s < 0 ? "L1" : "R1"));
      // trigger blade: arc around (yc, zc), outer radius R, thickness T, pivoting at its top end
      const yc = -0.04, zc = -0.21, R = 0.26, T = 0.075, th0 = 68, th1 = -105, N = 12;
      const pull = (Math.max(0, Math.min(1, v || 0))) * 28 * Math.PI / 180;
      const hy = yc + R * Math.cos(th0 * Math.PI / 180), hz = zc + R * Math.sin(th0 * Math.PI / 180);
      const rot = ([y, z]) => { const dy = y - hy, dz = z - hz, c = Math.cos(-pull), sn = Math.sin(-pull); return [hy + dy * c - dz * sn, hz + dy * sn + dz * c]; };
      const outerArc = [], innerArc = [];
      for (let i = 0; i <= N; i++) {
        const t = ((th0 + ((th1 - th0) * i) / N) * Math.PI) / 180;
        outerArc.push(rot([yc + R * Math.cos(t), zc + R * Math.sin(t)]));
        innerArc.push(rot([yc + (R - T) * Math.cos(t), zc + (R - T) * Math.sin(t)]));
      }
      const blade = outerArc.concat(innerArc.reverse());
      const ta = s < 0 ? -1.82 : 0.98, tb = s < 0 ? -0.98 : 1.82;
      out.push(...extrude(ta, tb, blade, COL.trig, s < 0 ? "L2" : "R2"));
    }
    return out;
  }

  function sticks(ls, rs) {
    const out = [];
    for (const [px, v, part] of [[214, ls, "L3"], [386, rs, "R3"]]) {
      const [x, y] = sv(px, 240);
      const ox = x + v[0] * 0.14, oy = y - v[1] * 0.14;
      out.push(...prism(circle((x + ox) / 2, (y + oy) / 2, 0.11, 12), TOP, TOP + 0.15, COL.dark, { part, noBottom: true }));
      out.push(...prism(circle(ox, oy, 0.27, 22), TOP + 0.15, TOP + 0.22, COL.btn, { part, top: "#262e3e" }));
      out.push(line(circle(ox, oy, 0.19, 20).concat([[ox + 0.19, oy]]).map((p) => [...p, TOP + 0.222]), "#3a4458", 1.2, part));
    }
    return out;
  }

  // ---------- math ----------
  function rotation(pitch, roll, yaw) {
    // R = Rz(yaw) · Rx(pitch) · Ry(roll)   (degrees)
    const [a, b, c] = [pitch, roll, yaw].map((d) => (d * Math.PI) / 180);
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
    const Rx = [[1, 0, 0], [0, ca, -sa], [0, sa, ca]], Ry = [[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]], Rz = [[cc, -sc, 0], [sc, cc, 0], [0, 0, 1]];
    const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
    return mul(Rz, mul(Rx, Ry));
  }
  const apply = (M, p) => [M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2], M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2], M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2]];

  class Controller3D {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext("2d");
      this.pose = { pitch: 0, roll: 0, yaw: 0 };
      this.ls = [0, 0]; this.rs = [0, 0]; this.l2 = 0; this.r2 = 0;
      this.hl = {};
      this.light = norm([-0.35, -0.55, 0.85]);
      buildStatic();
    }
    set(o) { Object.assign(this, o); }
    render() {
      const cv = this.cv, dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // camera: behind the player, looking down at ~32°
      const e = (32 * Math.PI) / 180, D = 9.5;
      const C = [0, -Math.cos(e) * D, Math.sin(e) * D];
      const f = [0, Math.cos(e), -Math.sin(e)], u = [0, Math.sin(e), Math.cos(e)];
      const F = Math.min(W * 1.2, H * 1.95);
      const proj = (p) => { const r = sub(p, C); const z = dot(r, f); return [W / 2 + (r[0] * F) / z, H / 2 - (dot(r, u) * F) / z, z]; };

      // ground shadow
      ctx.save();
      const g = ctx.createRadialGradient(W / 2, H * 0.78, 4, W / 2, H * 0.78, W * 0.42);
      g.addColorStop(0, "rgba(0,0,0,.45)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(W / 2, H * 0.8, W * 0.42, H * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      const M = rotation(this.pose.pitch, this.pose.roll, this.pose.yaw);
      const S = buildStatic();
      const prep = (face) => {
        const pts = face.pts.map((p) => apply(M, p));
        const c = centroid(pts);
        let n = face.line ? apply(M, [0, 0, 1]) : newell(pts);
        if (!face.line) { const h = apply(M, face.hint); if (dot(n, h) < 0) n = n.map((v) => -v); }
        const visible = dot(n, sub(C, c)) > 0;
        const sp = pts.map(proj);
        const depth = sp.reduce((s, p) => s + p[2], 0) / sp.length;
        return { face, sp, n, visible, depth };
      };
      const draw = (it) => {
        const { face, sp, n } = it;
        const color = this.hl[face.part] || face.color;
        ctx.beginPath();
        sp.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (face.line) { ctx.strokeStyle = color; ctx.lineWidth = face.width; ctx.lineJoin = "round"; ctx.stroke(); return; }
        ctx.closePath();
        const k = face.flat ? 1 : 0.5 + 0.75 * Math.max(0, dot(n, this.light));
        ctx.fillStyle = shadeHex(color, k);
        ctx.fill();
        ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.stroke();   // hide hairline seams
      };

      // painter by groups (body shell, each shoulder piece, each paddle), then faces inside each group
      const all = S.faces.concat(shoulders(this.l2, this.r2)).map(prep);
      const groups = new Map();
      for (const it of all) { const k = it.face.grp || "body"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
      const bodyDepth = proj(apply(M, [0, 0.2, 0]))[2];
      const order = [...groups.entries()].map(([k, items]) => ({ items: items.filter((x) => x.visible), depth: k === "body" ? bodyDepth : items.reduce((s, x) => s + x.depth, 0) / items.length }));
      order.sort((a, b) => b.depth - a.depth);
      const topVisible = all.some((x) => x.face.topFace && x.visible);
      for (const g of order) { g.items.sort((a, b) => b.depth - a.depth); for (const it of g.items) draw(it); }
      if (topVisible) {
        const det = S.det.concat(sticks(this.ls, this.rs)).map(prep).filter((x) => x.face.line || x.face.flat || x.visible);
        // decals first, then raised parts by depth
        det.sort((a, b) => (a.face.flat === b.face.flat ? b.depth - a.depth : a.face.flat ? -1 : 1));
        for (const it of det) { if (it.face.line) { /* drawn with depth below */ } }
        const lines = det.filter((x) => x.face.line), solids = det.filter((x) => !x.face.line);
        for (const it of solids) draw(it);
        for (const it of lines) draw(it);
      }
    }
  }
  return Controller3D;
})();
