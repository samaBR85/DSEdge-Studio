// Bridge to the native shell (WKScriptMessageHandlerWithReply).
// When opened in a normal browser (no WebKit host) a simulator is used so the UI can be previewed.
"use strict";

const Native = (() => {
  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hid;
  const listeners = new Set();
  window.EdgeNative = { onEvent: (e) => listeners.forEach((fn) => fn(e)) };

  if (handler) {
    return {
      simulated: false,
      call: (cmd, args = {}) => handler.postMessage({ cmd, ...args }),
      on: (fn) => listeners.add(fn),
    };
  }

  // ---------------- simulator ----------------
  const SAMPLE = [[112,0,1,0,0,0,68,0,101,0,102,0,97,0,117,0,108,0,116,0,32,0,80,0,114,0,111,0,102,0,105,0,108,0,101,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[113,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[114,2,0,0,0,255,0,255,0,0,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,0,0,192,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,254,108,131,24,0,0,0,0],[115,0,1,0,0,0,83,0,104,0,111,0,111,0,116,0,101,0,114,0,32,0,83,0,69,0,78,0,83,0,32,0,65,0,76,0,76,0,65,0,78,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[116,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,18,151,214,171,148,1,74,136,186,170,50,240,237,147,218,3,3,0,41,38,94,194,255,255,4,0,0,76,50,140,102,0,0,0,0],[117,2,200,162,0,255,0,255,0,0,0,1,2,3,4,5,6,7,8,9,10,11,12,13,12,4,0,0,0,0,1,0,2,0,130,96,237,157,161,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,179,248,45,105,0,0,0,0],[118,0,1,0,0,0,77,0,75,0,87,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[119,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,145,37,127,239,119,101,57,69,172,145,152,55,247,221,134,83,3,3,0,41,38,94,194,255,255,4,0,0,76,50,140,102,0,0,0,0],[120,2,200,162,0,255,0,255,0,0,0,1,2,3,6,5,4,7,8,9,10,11,12,13,11,8,0,0,0,0,1,0,2,0,113,54,129,160,161,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,28,174,103,250,0,0,0,0],[121,0,1,0,0,0,68,0,69,0,65,0,84,0,72,0,32,0,83,0,84,0,82,0,65,0,78,0,68,0,73,0,78,0,71,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[122,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,44,119,198,155,26,74,52,65,138,26,158,123,125,57,6,77,3,3,0,40,38,93,194,255,255,4,0,0,76,50,140,102,0,0,0,0],[123,2,200,162,0,255,0,255,0,0,0,1,10,3,4,5,6,7,8,9,2,11,12,13,8,13,0,0,0,0,1,0,2,0,139,206,22,0,141,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,120,225,42,172,0,0,0,0]];
  let reports = SAMPLE.map((r) => r.slice());
  const store = {};
  const sim = {
    simulated: true,
    on: (fn) => listeners.add(fn),
    async call(cmd, a = {}) {
      await new Promise((r) => setTimeout(r, 60));
      switch (cmd) {
        case "status": return { type: "status", connected: true, transport: "USB", serial: "SIM" };
        case "readProfiles": return reports.map((r) => r.slice());
        case "loadFile": return store[a.name] || localStorage.getItem("sim-" + a.name) || "";
        case "saveFile": store[a.name] = a.text; try { localStorage.setItem("sim-" + a.name, a.text); } catch {} return true;
        case "rumble": case "resetYaw": case "log": case "output": case "gc": return true;
        case "exportJSON": console.log(a.text); return true;
        case "importJSON": return null;
        case "writeFeatures":
          for (const r of a.reports) {
            if (r[0] === 0x68) {
              const base = 0x70 + (r[1] - 1) * 3;
              const idx = reports.findIndex((x) => x[0] === base);
              reports[idx] = [base, 16, ...new Array(62).fill(0)];
              reports[idx + 1] = [base + 1, 1, ...new Array(62).fill(0)];
              reports[idx + 2] = [base + 2, 2, ...new Array(62).fill(0)];
            } else {
              const base = { 0x60: 0x73, 0x61: 0x76, 0x62: 0x79, 0x63: 0x70 }[r[0]];
              const copy = r.slice(); copy[0] = base + r[1]; copy.fill(0, 60);
              reports[reports.findIndex((x) => x[0] === copy[0])] = copy;
            }
          }
          return true;
      }
      throw new Error("sim: " + cmd);
    },
  };
  // fake input stream
  let t = 0;
  setInterval(() => {
    t += 0.05;
    const d = new Array(64).fill(0);
    d[0] = 1; d[1] = 128 + Math.round(Math.cos(t) * 90); d[2] = 128 + Math.round(Math.sin(t) * 90);
    d[3] = 128 + Math.round(Math.sin(t * 0.7) * 120); d[4] = 128; d[5] = Math.round((Math.sin(t) + 1) * 127); d[6] = Math.round((Math.cos(t * 1.3) + 1) * 127);
    d[8] = 8 | ((Math.floor(t) % 4 === 0) ? 0x20 : 0); d[53] = 0x27;
    const w16 = (o, v) => { v = Math.round(v) & 0xffff; d[o] = v & 255; d[o + 1] = v >> 8; };
    w16(16, Math.sin(t * 1.3) * 900); w16(18, Math.cos(t) * 600); w16(20, Math.sin(t * .7) * 300);
    w16(22, Math.sin(t * .8) * 2500); w16(24, 7600); w16(26, Math.cos(t * .6) * 3000);
    const tx = 960 + Math.cos(t) * 700, ty = 540 + Math.sin(t * 1.4) * 380;
    d[33] = 0x01; d[34] = tx & 255; d[35] = ((tx >> 8) & 0x0f) | ((ty & 0x0f) << 4); d[36] = ty >> 4;
    d[37] = Math.floor(t) % 3 === 0 ? 0x02 : 0x82; d[38] = 400 & 255; d[39] = (400 >> 8) | ((800 & 0x0f) << 4); d[40] = 800 >> 4;
    if (Math.floor(t * 2) % 5 === 0) d[10] |= 0x02;
    window.EdgeNative.onEvent({ type: "input", data: d });
  }, 50);
  setTimeout(() => window.EdgeNative.onEvent({ type: "status", connected: true, transport: "USB", serial: "SIM" }), 100);
  return sim;
})();
