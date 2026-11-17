// DualSense Edge profile protocol (USB feature reports).
//
//  Read : feature reports 0x70..0x7B — 3 reports per slot, slot order △ □ ✕ ○
//  Write: feature reports 0x60 (□) 0x61 (✕) 0x62 (○) 0x63 (△) — 3 parts each
//  Clear: feature report 0x68, data[0] = 2 (□) | 3 (✕) | 4 (○)
//
// Profile JSON shape matches edge-config.com exports so libraries are interchangeable.
"use strict";

const Proto = (() => {
  const SELECTOR = Object.freeze({ NONE: 0, SQUARE: 0x60, CROSS: 0x61, CIRCLE: 0x62, TRIANGLE: 0x63 });
  const READ_BASE_TO_SELECTOR = { 0x70: 0x63, 0x73: 0x60, 0x76: 0x61, 0x79: 0x62 };
  const CLEAR_CODE = { 0x60: 2, 0x61: 3, 0x62: 4 };

  const SLOTS = [
    { selector: 0x63, key: "triangle", glyph: "△", name: "Triângulo", readOnly: true },
    { selector: 0x60, key: "square", glyph: "□", name: "Quadrado" },
    { selector: 0x61, key: "cross", glyph: "✕", name: "Xis" },
    { selector: 0x62, key: "circle", glyph: "○", name: "Círculo" },
  ];

  // Physical button index → name (button-mapping table has 16 entries).
  const BUTTONS = [
    "D-Pad ↑", "D-Pad →", "D-Pad ↓", "D-Pad ←",
    "Círculo", "Xis", "Quadrado", "Triângulo",
    "R1", "R2", "R3", "L1", "L2", "L3",
    "Paddle esquerdo", "Paddle direito",
  ];
  const BUTTON_GROUPS = [
    { label: "Gatilhos", slots: [12, 9] },
    { label: "Ombros", slots: [11, 8] },
    { label: "Botões de ação", slots: [7, 4, 5, 6] },
    { label: "Direcional", slots: [0, 1, 2, 3] },
    { label: "Clique dos analógicos", slots: [13, 10] },
    { label: "Botões traseiros", slots: [14, 15] },
  ];

  // Stick response-curve presets (PS5 "Joystick Sensitivity/Curve" types).
  // Each of the 6 curve bytes = initial + accumulated modifier for adjustment index 0..10.
  const STICK_PRESETS = [
    { id: 0, name: "Padrão", mod: 3, adj: [[128], [128], [196], [196], [225], [225]] },
    { id: 1, name: "Rápida", mod: 3, adj: [[38], [38], [122, -3], [139, [6, 5]], [255], [255]] },
    { id: 2, name: "Precisa", mod: 4, adj: [[70, 3], [57, [-3, -4]], [134, 3], [115, [-6, -7]], [196, 2], [177, [-7, -8]]] },
    { id: 3, name: "Estável", mod: 4, adj: [[62, -1], [62, -1], [120, -4], [129, [0, -1]], [197, [3, 2]], [179, [-5, -6]]] },
    { id: 4, name: "Digital", mod: 3, adj: [[38], [38], [38], [75, 18], [255], [255]] },
    { id: 5, name: "Dinâmica", mod: 3, adj: [[69, [3, 2]], [57, [-3, -4]], [183, [-4, -5]], [198, 3], [255], [255]] },
  ];

  function adjAt([initial, modifier], i) {
    if (modifier === undefined) return initial;
    let v = initial;
    if (Array.isArray(modifier)) for (let r = 0; r < i; r++) v += modifier[r % modifier.length];
    else v += i * modifier;
    return v;
  }
  function presetCurve(presetId, index) {
    const p = STICK_PRESETS[presetId] || STICK_PRESETS[0];
    const i = Math.max(0, Math.min(10, index | 0));
    return p.adj.map((a) => clamp8(adjAt(a, i)));
  }
  // Which adjustment index (0..10) produces this curve? (ignores the first point, which holds the dead zone)
  function detectIndex(presetId, curve) {
    for (let i = 0; i <= 10; i++) {
      const c = presetCurve(presetId, i);
      if (c.slice(2).join() === curve.slice(2).join()) return i;
    }
    return null;
  }
  function deadzoneOf(curve) {
    return curve[1] === 0 && curve[0] > 0 ? Math.round((curve[0] / 255) * 100) : 0;
  }
  function applyDeadzone(stick, pct) {
    const c = stick.curveValues.slice();
    if (pct > 0) {
      c[0] = Math.round((pct / 100) * 255);
      c[1] = 0;
    } else {
      const idx = detectIndex(stick.profileId, c) ?? 5;
      const base = presetCurve(stick.profileId, idx);
      c[0] = base[0];
      c[1] = base[1];
    }
    stick.curveValues = c;
  }

  const clamp8 = (v) => Math.max(0, Math.min(255, Math.round(v)));

  // ---- CRC32 (IEEE) ----
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

  function profileCrc(parts) {
    const r = new Uint8Array(170);
    r.set(parts[0].slice(2, 60), 0);
    r.set(parts[1].slice(2, 60), 58);
    r.set(parts[2].slice(2, 56), 116);
    return crc32(r);
  }

  // ---- helpers ----
  function randomId() {
    return Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)).join(",");
  }
  function makeStick(presetId = 0, index = 5) {
    const p = STICK_PRESETS[presetId];
    return { profileId: presetId, modifier: p.mod, curveValues: presetCurve(presetId, index) };
  }
  function newProfile(label = "Novo perfil") {
    return {
      id: randomId(),
      label,
      leftJoystick: makeStick(0, 5),
      rightJoystick: makeStick(0, 5),
      leftTrigger: { min: 0, max: 255 },
      rightTrigger: { min: 0, max: 255 },
      buttonMapping: { buttons: Array.from({ length: 16 }, (_, i) => i) },
      profileButtonSelector: 0,
      vibrationIntensity: 3,
      triggerEffectIntensity: 3,
    };
  }
  function clone(p) {
    return JSON.parse(JSON.stringify(p));
  }

  function decodeLabel(bytes) {
    // UTF-16LE, NUL terminated per region
    let s = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const cu = bytes[i] | (bytes[i + 1] << 8);
      if (cu === 0) break;
      s += String.fromCharCode(cu);
    }
    return s;
  }

  // parts: three 64-byte arrays as read from 0x70.. (byte 0 = report id)
  function parseSlot(parts) {
    const empty = parts[0][1] === 16;
    const selector = READ_BASE_TO_SELECTOR[parts[0][0]] ?? 0;
    const p = newProfile("");
    p.profileButtonSelector = selector;
    p.empty = empty;
    if (empty) {
      p.label = "";
      return p;
    }
    p.label = decodeLabel(parts[0].slice(6, 60)) + decodeLabel(parts[1].slice(2, 28));
    p.id = parts[1].slice(28, 44).join(",");
    const lId = parts[2][30], rId = parts[2][32];
    p.leftJoystick = { profileId: STICK_PRESETS[lId] ? lId : 0, modifier: parts[1][44], curveValues: parts[1].slice(47, 53) };
    p.rightJoystick = {
      profileId: STICK_PRESETS[rId] ? rId : 0,
      modifier: parts[1][53],
      curveValues: [...parts[1].slice(56, 60), ...parts[2].slice(2, 4)],
    };
    // An all-zero curve means "system default" (linear) — show it as the Default preset.
    for (const j of [p.leftJoystick, p.rightJoystick]) {
      if (j.curveValues.every((v) => v === 0)) { j.curveValues = presetCurve(j.profileId, 5); j.modifier = j.modifier || STICK_PRESETS[j.profileId].mod; }
    }
    p.leftTrigger = { min: parts[2][4], max: parts[2][5] };
    p.rightTrigger = { min: parts[2][6], max: parts[2][7] };
    p.buttonMapping = { buttons: parts[2].slice(10, 26) };
    // Keep the original bytes so fields we don't edit are written back untouched.
    p.raw = parts.map((a) => a.slice());
    return p;
  }

  function parseAll(reports) {
    const slots = [];
    for (let s = 0; s < 4; s++) slots.push(parseSlot(reports.slice(s * 3, s * 3 + 3)));
    return slots;
  }

  function encodeLabel(label) {
    const units = [];
    for (const ch of label) {
      const cp = ch.codePointAt(0);
      if (cp > 0xffff) continue; // skip emoji/astral chars
      units.push(cp);
    }
    return units.slice(0, 40);
  }

  // Build the 3 feature reports that write `profile` into slot `selector` (0x60..0x63).
  function encode(profile, selector) {
    if (![0x60, 0x61, 0x62, 0x63].includes(selector)) throw new Error("Slot inválido");
    const base = profile.raw && !profile.empty ? profile.raw : null;
    const t = [0, 1, 2].map((k) => {
      const a = new Uint8Array(64);
      if (base) a.set(base[k]);
      return a;
    });
    for (const a of t) a.fill(0, 60, 64);
    t[0][0] = t[1][0] = t[2][0] = selector;
    t[0][1] = 0; t[0][2] = 1;
    t[1][1] = 1;
    t[2][1] = 2;

    // label: 27 UTF-16 units in part0[6..59], 13 in part1[2..27]
    t[0].fill(0, 6, 60);
    t[1].fill(0, 2, 28);
    const units = encodeLabel(profile.label || "Perfil");
    units.forEach((u, i) => {
      if (i < 27) { t[0][6 + i * 2] = u & 0xff; t[0][7 + i * 2] = u >> 8; }
      else { const j = i - 27; t[1][2 + j * 2] = u & 0xff; t[1][3 + j * 2] = u >> 8; }
    });

    const id = String(profile.id || randomId()).split(",").map((n) => Number(n) & 0xff);
    t[1].set(id.slice(0, 16), 28);

    const L = profile.leftJoystick, R = profile.rightJoystick;
    t[2][30] = L.profileId;
    t[2][32] = R.profileId;
    t[1][44] = L.modifier ?? STICK_PRESETS[L.profileId].mod;
    t[1][53] = R.modifier ?? STICK_PRESETS[R.profileId].mod;
    const lc = L.curveValues.map(clamp8), rc = R.curveValues.map(clamp8);
    t[1].set(lc.slice(0, 6), 47);
    t[1].set(rc.slice(0, 4), 56);
    t[2][2] = rc[4];
    t[2][3] = rc[5];

    t[2][4] = clamp8(profile.leftTrigger.min);
    t[2][5] = clamp8(profile.leftTrigger.max);
    t[2][6] = clamp8(profile.rightTrigger.min);
    t[2][7] = clamp8(profile.rightTrigger.max);
    t[2].set(profile.buttonMapping.buttons.slice(0, 16).map((b) => b & 0xff), 10);

    // 48-bit little-endian timestamp (ms) — the PS5 stores the save time here.
    let ts = Date.now();
    for (let i = 0; i < 6; i++) { t[2][34 + i] = ts % 256; ts = Math.floor(ts / 256); }

    t[2].set(le32(profileCrc(t)), 56);

    // per-report CRC (seed byte 0xA3), little-endian in the last 4 bytes
    for (const a of t) a.set(le32(crc32(new Uint8Array([0xa3, ...a]))), 60);
    return t.map((a) => Array.from(a));
  }

  function clearReport(selector) {
    const a = new Array(64).fill(0);
    a[0] = 0x68;
    a[1] = CLEAR_CODE[selector];
    if (!a[1]) throw new Error("Este slot não pode ser limpo");
    return a;
  }

  const s16 = (d, o) => { const v = d[o] | (d[o + 1] << 8); return v & 0x8000 ? v - 0x10000 : v; };

  // USB input report 0x01 (byte 0 = report id)
  function parseInput(d) {
    const b0 = d[8], b1 = d[9], b2 = d[10], b3 = d[11];
    return {
      lx: d[1], ly: d[2], rx: d[3], ry: d[4], l2: d[5], r2: d[6],
      dpad: b0 & 0x0f,
      square: !!(b0 & 0x10), cross: !!(b0 & 0x20), circle: !!(b0 & 0x40), triangle: !!(b0 & 0x80),
      l1: !!(b1 & 0x01), r1: !!(b1 & 0x02), l2b: !!(b1 & 0x04), r2b: !!(b1 & 0x08),
      create: !!(b1 & 0x10), options: !!(b1 & 0x20), l3: !!(b1 & 0x40), r3: !!(b1 & 0x80),
      ps: !!(b2 & 0x01), touchpad: !!(b2 & 0x02), mute: !!(b2 & 0x04),
      fnL: !!(b2 & 0x10), fnR: !!(b2 & 0x20), paddleL: !!(b2 & 0x40), paddleR: !!(b2 & 0x80),
      // motion sensors (int16 LE): gyro pitch/yaw/roll, accelerometer x/y/z (~8192 = 1 g)
      gyro: [s16(d, 16), s16(d, 18), s16(d, 20)],
      accel: [s16(d, 22), s16(d, 24), s16(d, 26)],
      // touchpad: 2 contacts, bit7 of the first byte set = not touching; 1920×1080 grid
      touches: [33, 37].map((o) => ({
        active: !(d[o] & 0x80),
        id: d[o] & 0x7f,
        x: d[o + 1] | ((d[o + 2] & 0x0f) << 8),
        y: (d[o + 2] >> 4) | (d[o + 3] << 4),
      })),
      battery: Math.min((d[53] & 0x0f) * 10 + 5, 100),
      charging: (d[53] & 0xf0) === 0x10,
      full: (d[53] & 0xf0) === 0x20,
      raw: d,
    };
  }

  return {
    SELECTOR, SLOTS, BUTTONS, BUTTON_GROUPS, STICK_PRESETS,
    presetCurve, detectIndex, deadzoneOf, applyDeadzone,
    newProfile, clone, randomId, parseAll, encode, clearReport, parseInput, crc32,
  };
})();
