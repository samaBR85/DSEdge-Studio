// Hardware tab: light bar, player LEDs, mute LED, the two rumble motors and adaptive trigger effects.
// Everything goes through USB output report 0x02 and is live only (the controller does not store it).
// Depends on app.js globals ($, $$, G, state, toast, call, saveState, setRangeFill).
"use strict";

const HW = (() => {
  // ---------------------------------------------------------------- output report 0x02 (USB) layout
  // [1] flags0: 0x01 rumble, 0x02 haptics select, 0x04 right trigger, 0x08 left trigger
  // [2] flags1: 0x01 mute LED, 0x02 power-save control, 0x04 light bar, 0x08 release LEDs, 0x10 player LEDs, 0x40 motor power
  // [3] right motor (weak/fast)  [4] left motor (strong/slow)  [9] mute LED 0 off · 1 on · 2 pulse
  // [10] power-save bits (0 = touch, motion, haptics and audio all awake)
  // [11..21] right trigger effect  [22..32] left trigger effect
  // [37] motor power reduction (high nibble rumble, low nibble triggers; 0 = full power) — enabled by flags1 0x40
  // [39] flags2: 0x02 light-bar setup  [42] light-bar setup (2 = fade out the default blue)
  // [43] player LED brightness 0 high · 1 mid · 2 low  [44] player LEDs (bits 0–4)  [45..47] R G B
  const blank = () => { const b = new Array(48).fill(0); b[0] = 0x02; return b; };
  const send = (b) => call("output", { bytes: b });
  // make sure the trigger and rumble motors are awake and at full power (the system may leave them reduced)
  const fullPower = (b) => { b[2] |= 0x02 | 0x40; b[10] = 0; b[37] = 0; return b; };

  const PLAYER = { 1: 0x04, 2: 0x0a, 3: 0x15, 4: 0x1b };
  const SWATCHES = ["#2f6bff", "#00c2ff", "#2fd08a", "#b6ff3b", "#ffd23f", "#ff8a3d", "#ff3d5a", "#ff4fd8", "#9b5cff", "#ffffff"];
  const s = {
    color: "#2f6bff", bright: 100, player: 1, mute: 0,
    motorL: 160, motorR: 160,
    trig: { l2: { mode: "off", pos: 3, end: 6, force: 6, amp: 5, freq: 30 }, r2: { mode: "off", pos: 3, end: 6, force: 6, amp: 5, freq: 30 } },
  };
  let built = false, stopT = null;

  function load(saved) {
    if (!saved) return;
    for (const k of ["color", "bright", "player", "mute", "motorL", "motorR"]) if (saved[k] != null) s[k] = saved[k];
    for (const t of ["l2", "r2"]) if (saved.trig?.[t]) Object.assign(s.trig[t], saved.trig[t]);
  }
  const saved = () => JSON.parse(JSON.stringify(s));
  let saveT = null;
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => saveState().catch(() => {}), 400); };

  // ---------------------------------------------------------------- report builders
  const rgb = () => { const n = parseInt(s.color.slice(1), 16), k = (s.bright / 100) ** 2.2; return [((n >> 16) & 255) * k, ((n >> 8) & 255) * k, (n & 255) * k].map(Math.round); };
  let lightsInit = false;
  async function sendLights() {
    if (!lightsInit) {           // first time: stop the default blue animation so our colour sticks
      const b = blank(); b[39] = 0x02; b[42] = 0x02;
      await send(b); lightsInit = true;
    }
    const b = blank();
    b[2] = 0x01 | 0x04 | 0x10;
    b[9] = s.mute; b[44] = (PLAYER[s.player] || 0) | 0x20;   // 0x20: switch LEDs instantly
    [b[45], b[46], b[47]] = rgb();
    return send(b);
  }
  function rumble(l, r) { const b = fullPower(blank()); b[1] = 0x01 | 0x02; b[3] = r; b[4] = l; return send(b); }

  // Adaptive trigger effects (11 bytes). Zones are the 10 positions of the trigger travel (0 = rest, 9 = fully pressed);
  // strength / amplitude are 1–8.
  function effect(t) {
    const e = new Array(11).fill(0);
    const zonesFrom = (pos, val) => { let active = 0, packed = 0; for (let i = pos; i < 10; i++) { active |= 1 << i; packed += ((val - 1) & 7) * 2 ** (3 * i); } return [active, packed]; };
    const le32 = (v, o) => { for (let k = 0; k < 4; k++) e[o + k] = Math.floor(v / 2 ** (8 * k)) & 255; };
    if (t.mode === "feedback") {            // continuous resistance from a point
      const [a, p] = zonesFrom(t.pos, t.force); e[0] = 0x21; e[1] = a & 255; e[2] = a >> 8; le32(p, 3);
    } else if (t.mode === "weapon") {       // resistance between two points, then a "click" when it breaks
      const start = Math.max(2, Math.min(7, t.pos)), end = Math.max(start + 1, Math.min(8, t.end));
      const z = (1 << start) | (1 << end); e[0] = 0x25; e[1] = z & 255; e[2] = z >> 8; e[3] = t.force - 1;
    } else if (t.mode === "vibration") {    // trigger buzzes from a point on
      const [a, p] = zonesFrom(t.pos, t.amp); e[0] = 0x26; e[1] = a & 255; e[2] = a >> 8; le32(p, 3); e[9] = t.freq;
    } else e[0] = 0x05;                     // off
    return e;
  }
  function sendTriggers() {
    const b = fullPower(blank());
    b[1] = 0x04 | 0x08;
    effect(s.trig.r2).forEach((v, i) => (b[11 + i] = v));
    effect(s.trig.l2).forEach((v, i) => (b[22 + i] = v));
    return send(b);
  }
  async function resetAll() {
    clearTimeout(stopT);
    const b = blank();
    b[1] = 0x01 | 0x02 | 0x04 | 0x08; b[11] = 0x05; b[22] = 0x05;   // motors 0, both triggers off
    b[2] = 0x01;                                                      // mute LED off
    await send(b);
  }

  // debounce live sends while dragging sliders
  const timers = {};
  const soon = (k, fn) => { clearTimeout(timers[k]); timers[k] = setTimeout(() => fn().catch((e) => toast(e.message, "err")), 40); };
  const need = () => { if (!state.status.connected) { toast(T("Conecte o controle pelo cabo USB."), "err"); return false; } return true; };

  // ---------------------------------------------------------------- UI
  const rng = (attr, min, max, val, step = 1) => `<input type="range" ${attr} min="${min}" max="${max}" step="${step}" value="${val}">`;
  function build() {
    const box = $("#hw");
    if (built) return sync();
    built = true;
    box.innerHTML = `<div class="hw">
      <div class="hw-note">${G("ps", 16)} ${T("Estes ajustes valem só enquanto o controle está ligado ao Mac. Eles não ficam salvos nos perfis do controle e somem ao desconectar.")}
        <button class="btn sm ghost" id="hw-reset">${T("Restaurar padrão")}</button></div>

      <div class="card">
        <h4>${T("Barra de luz")}</h4>
        <div class="hw-lightbar"><i id="hw-glow"></i></div>
        <div class="hw-sw">${SWATCHES.map((c) => `<button class="sw" data-c="${c}" style="--c:${c}" title="${c}"></button>`).join("")}
          <label class="sw custom" title="${T("Outra cor")}"><input type="color" id="hw-color"></label></div>
        <div class="field"><label>${T("Brilho")} <b id="hw-bv"></b></label>${rng('id="hw-bright"', 0, 100, s.bright)}</div>
        <div class="hw-row">
          <div><div class="cap">${T("LEDs de jogador")}</div>
            <div class="hw-leds" id="hw-leds">${[0, 1, 2, 3, 4].map((i) => `<span data-led="${i}"></span>`).join("")}</div>
            <div class="chips">${[1, 2, 3, 4].map((p) => `<button class="chip" data-pl="${p}">${T("Jogador {n}", { n: p })}</button>`).join("")}<button class="chip" data-pl="0">${T("Apagados")}</button></div></div>
          <div>
            <div class="cap">${T("Luz do botão mute")}</div>
            <div class="chips">${[[T("Apagada"), 0], [T("Acesa"), 1], [T("Piscando"), 2]].map(([n, v]) => `<button class="chip" data-mu="${v}">${n}</button>`).join("")}</div></div>
        </div>
      </div>

      <div class="card">
        <h4>${T("Vibração")}</h4>
        <div class="muted small" style="margin-bottom:12px">${T("O motor esquerdo é o forte e grave; o direito é o fraco e agudo.")}</div>
        <div class="hw-motors">
          ${[["L", T("Esquerdo"), T("forte")], ["R", T("Direito"), T("fraco")]].map(([k, n, d]) => `
          <div class="hw-motor"><div class="field"><label>${n} <span class="dim">· ${d}</span><b data-mv="${k}"></b></label>${rng(`data-m="${k}"`, 0, 255, s["motor" + k])}</div>
            <div class="hw-meter"><i data-mm="${k}"></i></div></div>`).join("")}
        </div>
        <div class="chips" style="margin-top:12px">
          <button class="btn sm" data-rb="both">${T("Testar os dois (1 s)")}</button>
          <button class="btn sm ghost" data-rb="L">${T("Só esquerdo")}</button>
          <button class="btn sm ghost" data-rb="R">${T("Só direito")}</button>
          <button class="btn sm ghost" data-rb="hold" title="${T("Vibra enquanto o botão estiver pressionado")}">${T("Segurar para vibrar")}</button>
          <button class="btn sm ghost" data-rb="stop">${T("Parar")}</button>
        </div>
      </div>

      <div class="card hw-wide">
        <h4>${T("Gatilhos adaptativos")}</h4>
        <div class="muted small" style="margin-bottom:12px">${T("Escolha um efeito e aperte o gatilho para sentir. As posições vão de 0 (solto) a 9 (apertado até o fim). Se a linha “controle confirma” mostra o efeito ativo mas você não sente nada, desconecte e reconecte o cabo USB com o app aberto: o controle às vezes só libera a força dos gatilhos depois de uma reconexão.")}</div>
        <div class="hw-trigs">${["l2", "r2"].map((k) => `<div class="hw-trig" data-t="${k}"></div>`).join("")}</div>
      </div>
    </div>`;

    $("#hw-reset").onclick = async () => { if (!need()) return; await resetAll().catch((e) => toast(e.message, "err")); s.trig.l2.mode = s.trig.r2.mode = "off"; s.mute = 0; persist(); sync(); toast(T("Luzes, vibração e gatilhos voltaram ao padrão."), "ok"); };
    $$(".sw[data-c]", box).forEach((b) => (b.onclick = () => { s.color = b.dataset.c; lightsChanged(); }));
    $("#hw-color").oninput = (e) => { s.color = e.target.value; lightsChanged(); };
    $("#hw-bright").oninput = (e) => { s.bright = Number(e.target.value); lightsChanged(); };
    $$("[data-pl]", box).forEach((b) => (b.onclick = () => { s.player = Number(b.dataset.pl); lightsChanged(); }));
    $$("[data-mu]", box).forEach((b) => (b.onclick = () => { s.mute = Number(b.dataset.mu); lightsChanged(); }));

    $$("[data-m]", box).forEach((r) => (r.oninput = () => { s["motor" + r.dataset.m] = Number(r.value); sync(); persist(); }));
    const pulse = (l, r, ms) => { if (!need()) return; clearTimeout(stopT); rumble(l, r).catch((e) => toast(e.message, "err")); meters(l, r); stopT = setTimeout(stop, ms); };
    const stop = () => { clearTimeout(stopT); meters(0, 0); if (state.status.connected) rumble(0, 0).catch(() => {}); };
    $$("[data-rb]", box).forEach((b) => {
      const k = b.dataset.rb;
      if (k === "hold") {
        let holding = false;
        b.onmousedown = () => { if (!need()) return; holding = true; clearTimeout(stopT); rumble(s.motorL, s.motorR).catch((e) => toast(e.message, "err")); meters(s.motorL, s.motorR); };
        b.onmouseup = b.onmouseleave = () => { if (holding) { holding = false; stop(); } };
      } else if (k === "stop") b.onclick = stop;
      else b.onclick = () => pulse(k === "R" ? 0 : s.motorL, k === "L" ? 0 : s.motorR, 1000);
    });

    for (const k of ["l2", "r2"]) buildTrig(k);
    sync();
  }

  const MODES = [["off", T("Desligado")], ["feedback", T("Resistência")], ["weapon", T("Ponto de tiro")], ["vibration", T("Vibração")]];
  const HELP = {
    off: T("Sem efeito: o gatilho fica leve como sempre."),
    feedback: T("O gatilho fica duro a partir da posição de início, como puxar um arco ou frear."),
    weapon: T("Resiste entre o início e o fim e então “quebra”, como o gatilho de uma arma."),
    vibration: T("O gatilho vibra a partir da posição de início, como uma metralhadora ou motor."),
  };
  function buildTrig(k) {
    const el = $(`.hw-trig[data-t="${k}"]`), t = s.trig[k];
    const f = (name, label, min, max, help) => `<div class="field"><label>${label} <b data-v="${name}"></b></label>${rng(`data-p="${name}"`, min, max, t[name])}${help ? `<div class="help">${help}</div>` : ""}</div>`;
    el.innerHTML = `<div class="hw-trig-head">${G(k.toUpperCase(), 22)}<b>${k === "l2" ? T("Gatilho L2") : T("Gatilho R2")}</b><span class="dim small" data-tv>${T("solto")}</span></div>
      <div class="hw-tbar"><div class="hw-tzone" data-zone></div><i data-tlive></i><div class="hw-tticks">${Array.from({ length: 10 }, (_, i) => `<span>${i}</span>`).join("")}</div></div>
      <div class="chips hw-modes">${MODES.map(([m, n]) => `<button class="chip" data-mode="${m}">${n}</button>`).join("")}</div>
      <div class="help" data-help></div>
      <div class="hw-tact" data-tact></div>
      <div class="hw-params">
        <div data-for="feedback vibration">${f("pos", T("Início"), 0, 9)}</div>
        <div data-for="weapon">${f("pos", T("Início"), 2, 7)}</div>
        <div data-for="weapon">${f("end", T("Fim (onde quebra)"), 3, 8)}</div>
        <div data-for="feedback weapon">${f("force", T("Força"), 1, 8)}</div>
        <div data-for="vibration">${f("amp", T("Intensidade"), 1, 8)}</div>
        <div data-for="vibration">${f("freq", T("Frequência"), 1, 120, T("Vibrações por segundo (Hz)"))}</div>
      </div>`;
    $$("[data-mode]", el).forEach((b) => (b.onclick = () => { if (!need()) return; t.mode = b.dataset.mode; trigChanged(); }));
    $$("[data-p]", el).forEach((r) => (r.oninput = () => {
      const p = r.dataset.p; t[p] = Number(r.value);
      if (p === "pos" && t.mode === "weapon" && t.end <= t.pos) t.end = t.pos + 1;
      if (p === "end" && t.end <= t.pos) t.pos = Math.max(2, t.end - 1);
      trigChanged();
    }));
  }

  function lightsChanged() { sync(); persist(); if (state.status.connected) soon("lights", sendLights); }
  function trigChanged() { sync(); persist(); if (state.status.connected) soon("trig", sendTriggers); }
  function meters(l, r) { const a = $('[data-mm="L"]'), b = $('[data-mm="R"]'); if (a) a.style.width = (l / 255) * 100 + "%"; if (b) b.style.width = (r / 255) * 100 + "%"; }

  function sync() {
    if (!built) return;
    const box = $("#hw");
    const [r, g, b] = rgb();
    $("#hw-glow").style.background = `rgb(${r},${g},${b})`; $("#hw-glow").style.boxShadow = `0 0 26px 4px rgba(${r},${g},${b},.55)`;
    $("#hw-color").value = s.color; $("#hw-bv").textContent = s.bright + "%";
    $("#hw-bright").value = s.bright; setRangeFill($("#hw-bright"));
    $$(".sw[data-c]", box).forEach((x) => x.classList.toggle("on", x.dataset.c.toLowerCase() === s.color.toLowerCase()));
    const mask = PLAYER[s.player] || 0;
    $$("[data-led]", box).forEach((x) => x.classList.toggle("on", !!((mask >> Number(x.dataset.led)) & 1)));
    $$("[data-pl]", box).forEach((x) => x.classList.toggle("on", Number(x.dataset.pl) === s.player));
    $$("[data-mu]", box).forEach((x) => x.classList.toggle("on", Number(x.dataset.mu) === s.mute));
    for (const k of ["L", "R"]) { const rr = $(`[data-m="${k}"]`); rr.value = s["motor" + k]; setRangeFill(rr); $(`[data-mv="${k}"]`).textContent = Math.round((s["motor" + k] / 255) * 100) + "%"; }
    for (const k of ["l2", "r2"]) {
      const el = $(`.hw-trig[data-t="${k}"]`), t = s.trig[k];
      $$("[data-mode]", el).forEach((x) => x.classList.toggle("on", x.dataset.mode === t.mode));
      $("[data-help]", el).textContent = HELP[t.mode];
      $$("[data-for]", el).forEach((x) => x.classList.toggle("hidden", !x.dataset.for.split(" ").includes(t.mode)));
      $$("[data-p]", el).forEach((x) => { x.value = t[x.dataset.p]; setRangeFill(x); });
      $$("[data-v]", el).forEach((x) => (x.textContent = x.dataset.v === "freq" ? `${t.freq} Hz` : t[x.dataset.v]));
      const zone = $("[data-zone]", el);
      if (t.mode === "off") zone.style.width = "0";
      else { const a = t.pos / 10, z = t.mode === "weapon" ? (t.end + 1) / 10 : 1; zone.style.left = a * 100 + "%"; zone.style.width = (z - a) * 100 + "%"; }
      zone.className = `hw-tzone ${t.mode}`;
    }
  }

  function paint(i) {
    if (!built) return;
    for (const k of ["l2", "r2"]) {
      const el = $(`.hw-trig[data-t="${k}"]`);
      $("[data-tlive]", el).style.left = (i[k] / 255) * 100 + "%";
      const eff = (i.raw[48] >> (k === "r2" ? 4 : 0)) & 0x0f;
      $("[data-tact]", el).textContent = eff ? T("controle confirma: {effect} ativo", { effect: ["", T("resistência"), T("ponto de tiro"), T("vibração")][eff] || T("efeito {n}", { n: eff }) }) : T("controle: nenhum efeito ativo");
      $("[data-tv]", el).textContent = i[k] ? T("posição {pos} · {p}%", { pos: Math.min(9, Math.floor((i[k] / 256) * 10)), p: Math.round((i[k] / 255) * 100) }) : T("solto");
    }
  }
  // on (re)connect, re-apply what the user had chosen this session
  function onConnect() { lightsInit = false; }

  return { build, paint, load, saved, onConnect, effect };
})();
