"use strict";

// ---------- sample data (your real MKW profile) ----------
const MAP = { cir: "sq", sq: "cir", PL: "L1", PR: "R1" };
const SLOTS = [
  { g: "tri", name: "Default Profile", sub: "Perfil do sistema", lock: true, color: "#3fd0b6" },
  { g: "sq", name: "Shooter SENS ALLAN", sub: "Rápida / Precisa · 2 remap.", color: "#f07ad1" },
  { g: "crs", name: "MKW", sub: "Rápida / Precisa · 4 remap.", active: true, sel: true, color: "#6aa8ff" },
  { g: "cir", name: "DEATH STRANDING", sub: "Rápida / Precisa · 4 remap.", color: "#ff5a6e" },
];
const G = (t, s = 22, o) => glyphSvg(t, s, o);
const note = (n, x, y, txt, w) => `<div class="note" data-n="${n}" style="left:${x}px;top:${y}px;${w ? `max-width:${w}px` : ""}">${txt}</div>`;
const win = `<div class="win"><i></i><i></i><i></i></div>`;
const TABS = ["Botões", "Analógicos", "Gatilhos", "Presets", "Monitor"];
const remapHL = (color) => Object.fromEntries(Object.keys(MAP).map((k) => [k, color]));

// =====================================================================
// OPTION A — controller in the centre with callouts
// =====================================================================
function railA(active = "Botões") {
  return `
  <div class="f-col" style="width:92px;background:var(--bg2);border-right:1px solid var(--line);align-items:center;padding:52px 0 16px;gap:10px">
    <div class="cap" style="font-size:9px;margin-bottom:2px">SLOTS</div>
    ${SLOTS.map((s) => `
      <div style="position:relative;width:68px;padding:10px 0 8px;border-radius:14px;text-align:center;${s.sel ? "background:var(--acs);box-shadow:0 0 0 1.5px var(--ac) inset" : ""}">
        ${s.active ? `<span style="position:absolute;top:6px;right:8px;width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 8px var(--ok)"></span>` : ""}
        <div style="display:flex;justify-content:center;gap:3px;align-items:center">${G("fn", 15)}${G(s.g, 26)}</div>
        <div style="font-size:10px;margin-top:6px;color:${s.sel ? "var(--tx)" : "var(--tx3)"};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 4px">${s.lock ? "Padrão 🔒" : s.name}</div>
      </div>`).join("")}
    <div style="flex:1"></div>
    <div style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:var(--panel);border:1px solid var(--line);font-size:18px">📚</div>
    <div class="dim" style="font-size:10px">Biblioteca</div>
  </div>`;
}
function topA(active) {
  return `
  <div class="f-row" style="height:68px;align-items:center;padding:0 22px;gap:16px;border-bottom:1px solid var(--line)">
    <div class="f-col" style="width:250px">
      <div style="font-size:19px;font-weight:750;letter-spacing:-.01em">MKW <span class="dim" style="font-size:13px">✎</span></div>
      <div class="dim" style="font-size:11.5px;display:flex;gap:6px;align-items:center">${G("fn", 13)}${G("crs", 13)} slot ativo no controle</div>
    </div>
    <div style="flex:1;display:flex;justify-content:center"><div class="seg">${TABS.map((t) => `<div class="${t === active ? "on" : ""}">${t}</div>`).join("")}</div></div>
    <div class="pill">🔋 100%</div><div class="pill"><span class="dot"></span>USB</div>
  </div>`;
}
function footA(changes = 3) {
  return `
  <div class="f-row" style="position:absolute;left:0;right:0;bottom:0;height:64px;align-items:center;padding:0 22px;gap:10px;border-top:1px solid var(--line);background:var(--bg2)">
    <span class="pill" style="color:var(--warn);border-color:rgba(245,184,74,.35)">● ${changes} alterações não gravadas</span>
    <div style="flex:1"></div>
    <div class="btn ghost">Descartar</div><div class="btn">Salvar na biblioteca</div>
    <div class="btn pri">Gravar em ${G("fn", 14, { fg: "#fff", border: "rgba(255,255,255,.5)", bg: "transparent" })}${G("crs", 16, { mono: true, fg: "#fff", border: "rgba(255,255,255,.5)", bg: "transparent" })}</div>
  </div>`;
}
function A_buttons() {
  const ox = 320, oy = 150, k = 640 / 600;
  const L = ["L2", "L1", "up", "right", "down", "left", "L3", "PL"], R = ["R2", "R1", "tri", "cir", "crs", "sq", "R3", "PR"];
  const y0 = 120, step = 58;
  let chips = "", lines = "";
  const chip = (id, x, y, side) => {
    const m = MAP[id], sel = id === "PL";
    const target = m ? `${G(BTN[m].g, 18)}<span style="font-weight:650">${BTN[m].name}</span>` : `<span class="dim">Padrão</span>`;
    return `<div style="position:absolute;left:${x}px;top:${y}px;width:200px;height:46px;border-radius:12px;display:flex;align-items:center;gap:8px;padding:0 10px;
      background:${m ? "var(--panel2)" : "var(--panel)"};border:1px solid ${sel ? "var(--ac)" : m ? "rgba(79,140,255,.45)" : "var(--line)"};${sel ? "box-shadow:0 0 0 3px var(--acs)" : ""};flex-direction:${side === "r" ? "row-reverse" : "row"}">
      ${G(BTN[id].g, 24)}<span class="dim" style="font-size:14px">${side === "r" ? "←" : "→"}</span>
      <div style="display:flex;align-items:center;gap:6px;font-size:12.5px;${side === "r" ? "flex-direction:row-reverse" : ""}">${target}</div></div>`;
  };
  L.forEach((id, i) => {
    const y = y0 + i * step, [ax, ay] = ANCHOR[id];
    chips += chip(id, 108, y, "l");
    const tx = ox + ax * k, ty = oy + ay * k;
    lines += `<path d="M308,${y + 23} H${Math.min(tx - 20, 330)} L${tx},${ty}" fill="none" stroke="${MAP[id] ? "var(--ac)" : "var(--line2)"}" stroke-width="${MAP[id] ? 1.6 : 1}"/><circle cx="${tx}" cy="${ty}" r="3" fill="${MAP[id] ? "var(--ac)" : "var(--line2)"}"/>`;
  });
  R.forEach((id, i) => {
    const y = y0 + i * step, [ax, ay] = ANCHOR[id];
    chips += chip(id, 972, y, "r");
    const tx = ox + ax * k, ty = oy + ay * k;
    lines += `<path d="M972,${y + 23} H${Math.max(tx + 20, 950)} L${tx},${ty}" fill="none" stroke="${MAP[id] ? "var(--ac)" : "var(--line2)"}" stroke-width="${MAP[id] ? 1.6 : 1}"/><circle cx="${tx}" cy="${ty}" r="3" fill="${MAP[id] ? "var(--ac)" : "var(--line2)"}"/>`;
  });
  const targets = ["L2", "R2", "L1", "R1", "up", "right", "down", "left", "tri", "cir", "crs", "sq", "L3", "R3", "none"];
  const pop = `<div class="card" style="position:absolute;left:318px;top:424px;width:300px;padding:14px;box-shadow:0 20px 50px rgba(0,0,0,.6);border-color:var(--line2);z-index:3">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">${G("PL", 22)}<b>Paddle esquerdo</b><span class="dim" style="margin-left:auto;font-size:11px">aperte um botão no controle p/ escolher</span></div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px">${targets.map((t) => `<div class="glyph-tile ${t === "L1" ? "on" : ""}" style="padding:7px 2px">${G(BTN[t].g, 20)}<span style="font-size:9.5px;white-space:nowrap">${BTN[t].name.replace("Direcional ", "")}</span></div>`).join("")}</div></div>`;
  return `${railA()}<div style="position:absolute;left:92px;top:0;right:0;bottom:0">${topA("Botões")}
    <div style="position:absolute;left:-92px;top:0;width:1280px;height:800px">
      <div style="position:absolute;left:${ox}px;top:${oy}px;width:640px;height:427px">${controllerSvg({ hl: remapHL("#4f8cff"), body: "#1a1f2c", edge: "#283044", detail: "#0f121b", line: "#36405a" })}</div>
      <svg style="position:absolute;inset:0" width="1280" height="800">${lines}</svg>
      ${chips}${pop}
      <div style="position:absolute;left:520px;top:600px;width:240px;text-align:center" class="dim">Clique em uma parte do controle ou em um rótulo para remapear</div>
    </div>${footA()}</div>
    ${note(1, 650, 96, "Controle grande no centro: as linhas ligam cada botão à função dele. Os remapeados acendem em azul.")}
    ${note(2, 628, 470, "Ao clicar num botão abre um seletor com ícones. Também dá para apertar o botão no controle para escolher.", 220)}`;
}

// =====================================================================
// OPTION B — refined sidebar + cards + preview controller
// =====================================================================
function sideB() {
  return `
  <div class="f-col" style="width:280px;background:var(--bg2);border-right:1px solid var(--line);padding:50px 14px 14px;gap:6px">
    <div style="display:flex;align-items:center;gap:10px;margin:0 6px 14px"><div style="width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--ac),#3a6bff);display:grid;place-items:center;font-weight:800;color:#001018">E</div><b style="font-size:15px">Edge Studio</b></div>
    <div class="cap" style="margin:4px 8px 6px">Slots no controle</div>
    ${SLOTS.map((s) => `<div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;${s.sel ? "background:var(--panel2);box-shadow:0 0 0 1px var(--line2) inset" : ""}">
      <span style="width:7px;height:7px;border-radius:50%;background:${s.active ? "var(--ok)" : "var(--line2)"}"></span>
      <span style="display:inline-flex;gap:3px;align-items:center;padding:3px 6px;border-radius:8px;border:1px solid var(--line2)">${G("fn", 14)}${G(s.g, 18)}</span>
      <div style="min-width:0;flex:1"><div style="font-weight:650;${s.lock ? "font-style:italic;color:var(--tx3)" : ""};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.name}</div><div class="dim" style="font-size:11px">${s.sub}</div></div>
      ${s.lock ? `<span class="dim">🔒</span>` : s.sel ? `<span class="dim" style="font-size:16px">⋯</span>` : ""}</div>`).join("")}
    <div style="height:1px;background:var(--line);margin:12px 6px"></div>
    <div class="cap" style="margin:0 8px 6px;display:flex;justify-content:space-between">Biblioteca <span>＋ ⇩ ⇧</span></div>
    <div style="margin:0 6px 8px;height:32px;border-radius:9px;border:1px solid var(--line);display:flex;align-items:center;padding:0 10px" class="dim">🔍 Buscar perfis</div>
    ${["Warzone — Ranked", "Gran Turismo", "Elden Ring"].map((n, i) => `<div style="display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:10px"><span style="width:28px;height:28px;border-radius:8px;background:var(--panel2);display:grid;place-items:center">${G(["crs", "R2", "tri"][i], 16)}</span><div><div style="font-weight:600">${n}</div><div class="dim" style="font-size:11px">${["Precisa · gatilho curto", "Dinâmica · 2 remap.", "Padrão · paddles"][i]}</div></div></div>`).join("")}
  </div>`;
}
function headB(active) {
  return `<div style="padding:30px 32px 0">
      <div style="display:flex;align-items:center;gap:12px"><div style="font-size:26px;font-weight:750;letter-spacing:-.02em">MKW</div><span class="pill">${G("fn", 12)}${G("crs", 12)} ativo</span><div style="flex:1"></div><div class="pill">🔋 100%</div><div class="pill"><span class="dot"></span>DualSense Edge · USB</div></div>
      <div class="uline" style="margin-top:18px">${["Botões", "Analógicos", "Gatilhos", "Presets", "Monitor ao vivo"].map((t) => `<div class="${t === active ? "on" : ""}">${t}</div>`).join("")}</div></div>`;
}
function footB() {
  return `<div class="f-row" style="position:absolute;left:0;right:0;bottom:0;height:66px;align-items:center;padding:0 32px;gap:10px;border-top:1px solid var(--line)">
    <span style="color:var(--ok)">✓</span><span class="muted">Salvo automaticamente na biblioteca</span><div style="flex:1"></div>
    <div class="btn">↺ Restaurar</div><div class="btn pri">⟳ Gravar no controle ▾</div></div>`;
}
function B_buttons() {
  const groups = [
    ["Gatilhos e ombros", ["L2", "R2", "L1", "R1"]], ["Botões de ação", ["tri", "cir", "crs", "sq"]],
    ["Direcional", ["up", "right", "down", "left"]], ["Analógicos e traseiros", ["L3", "R3", "PL", "PR"]],
  ];
  const row = (id) => {
    const m = MAP[id];
    return `<div style="display:flex;align-items:center;gap:10px;height:${m ? 54 : 44}px;padding:0 12px;border-radius:10px;border:1px solid ${id === "PL" ? "var(--ac)" : "var(--line)"};background:var(--panel)">
      ${G(BTN[id].g, 22)}<div style="flex:1"><div style="font-weight:600">${BTN[id].name}</div>${m ? `<div style="display:flex;align-items:center;gap:5px;color:var(--ac2);font-size:12px;font-weight:650">${G(BTN[m].g, 14)}${BTN[m].name}</div>` : ""}</div><span class="dim">›</span></div>`;
  };
  return `${sideB()}<div style="position:absolute;left:280px;top:0;right:0;bottom:0">${headB("Botões")}
    <div style="display:flex;gap:22px;padding:20px 32px">
      <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:18px 16px;align-content:start">
        ${groups.map(([t, ids]) => `<div><div class="cap" style="margin-bottom:8px">${t}</div><div style="display:flex;flex-direction:column;gap:7px">${ids.map(row).join("")}</div></div>`).join("")}
      </div>
      <div style="width:340px;display:flex;flex-direction:column;gap:14px">
        <div class="card" style="padding:16px">
          <div class="cap" style="margin-bottom:6px">Pré-visualização</div>
          <div style="height:200px">${controllerSvg({ hl: { ...remapHL("#1fc8ef"), crs: "#2fd08a" }, body: "#16191f", edge: "#232831", detail: "#0d0f13", line: "#2d333e", light: "#1fc8ef" })}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><span class="chip" style="border-color:var(--ac);color:var(--ac2)">● 4 remapeados</span><span class="chip" style="border-color:rgba(47,208,138,.5);color:var(--ok)">● pressionado agora</span></div>
        </div>
        <div class="card" style="padding:14px">
          <div class="cap" style="margin-bottom:10px">Entrada ao vivo</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${["L2", "R2", "L1", "R1", "up", "right", "down", "left", "tri", "cir", "crs", "sq", "L3", "R3", "PL", "PR"].map((t) => G(BTN[t].g, 24, t === "crs" ? { bg: "rgba(47,208,138,.25)", border: "#2fd08a" } : {})).join("")}</div>
        </div>
      </div>
    </div>${footB()}</div>
    ${note(1, 330, 640, "Parecido com a referência, mas com prévia do controle ao lado: passar o mouse num cartão acende o botão no desenho.", 250)}`;
}

// =====================================================================
// OPTION C — slot cards on top + inspector driven by clicking the controller
// =====================================================================
function topC() {
  return `<div style="display:flex;gap:12px;padding:46px 22px 14px;align-items:stretch">
    ${SLOTS.map((s) => `<div style="flex:1;border-radius:16px;padding:12px 14px;background:${s.sel ? `linear-gradient(135deg, ${s.color}33, transparent 60%), var(--panel2)` : "var(--panel)"};border:1px solid ${s.sel ? s.color : "var(--line)"};position:relative;overflow:hidden">
      <div style="position:absolute;left:0;top:0;bottom:0;width:4px;background:${s.color};opacity:${s.sel ? 1 : .5}"></div>
      <div style="display:flex;align-items:center;gap:6px">${G("fn", 14)}${G(s.g, 22)}<span style="flex:1"></span>${s.active ? `<span class="chip" style="border-color:rgba(47,208,138,.5);color:var(--ok);padding:2px 8px;font-size:10.5px">ATIVO</span>` : ""}${s.lock ? `<span class="dim">🔒</span>` : ""}</div>
      <div style="font-weight:700;margin-top:8px;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${s.lock ? "color:var(--tx3);font-style:italic" : ""}">${s.name}</div>
      <div class="dim" style="font-size:11px">${s.sub}</div></div>`).join("")}
    <div style="width:130px;border-radius:16px;border:1px dashed var(--line2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px" class="dim"><span style="font-size:20px">📚</span><span style="font-size:11.5px;font-weight:600">Biblioteca (6)</span></div>
  </div>`;
}
function C_buttons() {
  const hot = (id, x, y, n) => `<div style="position:absolute;left:${x}px;top:${y}px;width:22px;height:22px;border-radius:50%;background:#9b8cff;color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center;box-shadow:0 0 0 4px rgba(155,140,255,.25)">${n}</div>`;
  const W = 300, H = 180;
  const curve = [[76, 50], [140, 102], [200, 162]];
  const presetMini = (name, pts, on) => `<div class="glyph-tile ${on ? "on" : ""}" style="padding:8px 4px 6px"><svg width="56" height="34"><path d="${curvePath(pts, 56, 34)}" fill="none" stroke="${on ? "var(--ac2)" : "var(--tx3)"}" stroke-width="2"/></svg>${name}</div>`;
  return `${topC()}
  <div style="display:flex;gap:16px;padding:0 22px">
    <div class="card" style="flex:1;height:560px;position:relative;background:radial-gradient(ellipse at 50% 45%, #22232c, var(--panel) 70%)">
      <div style="position:absolute;left:18px;top:14px;display:flex;gap:8px"><div class="seg"><div class="on">Editar</div><div>Ao vivo</div><div>Presets</div></div></div>
      <div style="position:absolute;left:18px;top:14px;right:18px;display:flex;justify-content:flex-end;gap:8px"><div class="pill">🔋 100%</div><div class="pill"><span class="dot"></span>USB</div></div>
      <div style="position:absolute;left:60px;top:80px;width:660px;height:440px">${controllerSvg({ hl: { cir: "#9b8cff", sq: "#9b8cff", PL: "#9b8cff", PR: "#9b8cff", R3: "#ffffff" }, body: "#24252d", edge: "#30323c", detail: "#17181d", line: "#41434f", light: "#9b8cff" })}</div>
      ${hot("cir", 600, 238, 1)}${hot("sq", 506, 238, 2)}${hot("PL", 92, 470, 3)}${hot("PR", 676, 470, 4)}
      <div style="position:absolute;left:0;right:0;bottom:16px;text-align:center" class="dim">Clique em qualquer parte do controle · ● = alterado neste perfil</div>
    </div>
    <div class="card" style="width:400px;height:560px;padding:18px;display:flex;flex-direction:column;gap:16px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px"><div style="width:40px;height:40px;border-radius:12px;background:var(--acs);display:grid;place-items:center">${G("R3", 26)}</div><div><div class="dim" style="font-size:11px">Selecionado</div><div style="font-size:17px;font-weight:750">Analógico direito</div></div></div>
      <div><div class="cap" style="margin-bottom:8px">Curva de resposta</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
          ${presetMini("Padrão", [[128, 128], [196, 196], [225, 225]])}${presetMini("Rápida", [[38, 38], [92, 194], [255, 255]])}${presetMini("Precisa", [[76, 50], [140, 102], [200, 162]], true)}
          ${presetMini("Estável", [[57, 57], [100, 126], [207, 154]])}${presetMini("Digital", [[38, 38], [38, 165], [255, 255]])}${presetMini("Dinâmica", [[81, 32], [158, 213], [255, 255]])}
        </div></div>
      <div style="display:flex;gap:14px;align-items:center">
        <svg width="${150}" height="${120}" style="background:var(--bg2);border-radius:12px;border:1px solid var(--line)"><path d="${curvePath(curve, 150, 120)}" fill="none" stroke="var(--ac)" stroke-width="2.5"/>${curve.map(([x, y]) => `<circle cx="${(x / 255) * 150}" cy="${120 - (y / 255) * 120}" r="5" fill="var(--bg)" stroke="var(--ac2)" stroke-width="2"/>`).join("")}<circle cx="96" cy="62" r="4" fill="#f5b84a"/></svg>
        <div style="flex:1;display:flex;flex-direction:column;gap:14px">
          <div><div class="kv">Intensidade <b>2</b></div><div class="slider"><i style="width:20%"></i><b style="left:20%"></b></div></div>
          <div><div class="kv">Zona morta <b>4%</b></div><div class="slider"><i style="width:10%"></i><b style="left:10%"></b></div></div>
        </div></div>
      <div><div class="cap" style="margin-bottom:8px">Clique do analógico</div>
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--bg2)">${G("R3", 22)}<span class="dim">→</span>${G("R3", 22)}<b>R3</b><span class="dim" style="margin-left:auto">alterar ›</span></div></div>
      <div style="flex:1"></div>
      <div style="display:flex;gap:8px"><div class="btn" style="flex:1">Salvar</div><div class="btn pri" style="flex:1.4">Gravar em ${G("crs", 16, { mono: true, fg: "#fff", bg: "transparent", border: "rgba(255,255,255,.5)" })}</div></div>
    </div>
  </div>
  ${note(1, 420, 704, "Slots como cartões grandes, cada um com sua cor. A cor do slot acompanha o editor.", 230)}
  ${note(2, 760, 704, "Tudo se edita clicando no controle. O painel à direita muda conforme a parte escolhida: botão, analógico ou gatilho.", 250)}`;
}

// =====================================================================
// PRESETS (shared layout, themed by option)
// =====================================================================
const PRESETS = [
  { cat: "FPS competitivo", name: "Mira Precisa", d: "Curva lenta no centro para microajustes, rápida nas bordas.", L: [[76, 50], [140, 102], [200, 162]], R: [[76, 50], [140, 102], [200, 162]], t: [0, 255], tags: ["Analógicos", "Precisa"] },
  { cat: "FPS competitivo", name: "Gatilho Instantâneo", d: "L2/R2 disparam com 15% de curso. Ideal para armas semiautomáticas.", L: [[38, 38], [92, 194], [255, 255]], R: [[38, 38], [92, 194], [255, 255]], t: [0, 40], tags: ["Gatilho curto", "Rápida"], hot: true },
  { cat: "FPS competitivo", name: "Paddles: Pular e Agachar", d: "Paddle esquerdo = ✕ e direito = ○. Mantém o polegar no analógico.", L: [[128, 128], [196, 196], [225, 225]], R: [[128, 128], [196, 196], [225, 225]], t: [0, 255], tags: ["Paddles"], map: ["crs", "cir"] },
  { cat: "Battle Royale", name: "Resposta Linear", d: "Zona morta mínima e curva 1:1, para quem quer entrada pura.", L: [[10, 0], [128, 128], [255, 255]], R: [[10, 0], [128, 128], [255, 255]], t: [0, 255], tags: ["Linear", "Zona morta 4%"] },
  { cat: "Corrida", name: "Aceleração Suave", d: "R2 com curso completo e zona morta de 8% para controle fino do acelerador.", L: [[81, 32], [158, 213], [255, 255]], R: [[128, 128], [196, 196], [225, 225]], t: [20, 255], tags: ["Gatilhos", "Dinâmica"] },
  { cat: "Luta", name: "Direcional Digital", d: "Analógico esquerdo vira direcional digital, com paddles nos botões de ombro.", L: [[38, 38], [38, 165], [255, 255]], R: [[128, 128], [196, 196], [225, 225]], t: [0, 255], tags: ["Digital", "Paddles"], map: ["L1", "R1"] },
];
const CATS = ["Todos", "FPS competitivo", "Battle Royale", "Corrida", "Luta", "Esportes", "Acessibilidade", "Meus presets"];
function presetsBody(t) {
  const card = (p) => `<div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px;${p.hot ? "border-color:var(--ac);box-shadow:0 0 0 3px var(--acs)" : ""}">
    <div style="display:flex;align-items:center;gap:8px"><b style="font-size:15px">${p.name}</b>${p.hot ? `<span class="chip on" style="padding:2px 8px;font-size:10.5px">POPULAR</span>` : ""}<span class="dim" style="margin-left:auto;font-size:11px">${p.cat}</span></div>
    <div class="muted" style="font-size:12.5px;min-height:36px;margin-top:-4px">${p.d}</div>
    <div style="display:flex;gap:10px;align-items:center">
      ${["L", "R"].map((s) => `<div style="flex:1;background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:6px 8px"><div class="dim" style="font-size:10px;font-weight:700">${s === "L" ? "ANALÓG. ESQ." : "ANALÓG. DIR."}</div><svg width="100%" height="40" viewBox="0 0 100 40" preserveAspectRatio="none"><path d="${curvePath(p[s], 100, 40)}" fill="none" stroke="var(--ac)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></div>`).join("")}
      <div style="width:84px;background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:6px 8px"><div class="dim" style="font-size:10px;font-weight:700">L2 / R2</div>
        ${[0, 1].map(() => `<div style="height:6px;border-radius:3px;background:var(--line2);margin-top:9px;position:relative"><i style="position:absolute;left:${(p.t[0] / 255) * 100}%;width:${((p.t[1] - p.t[0]) / 255) * 100}%;top:0;bottom:0;background:var(--ac);border-radius:3px"></i></div>`).join("")}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-height:24px">${p.tags.map((x) => `<span class="chip" style="padding:2px 8px;font-size:11px">${x}</span>`).join("")}${p.map ? `<span class="chip" style="padding:2px 8px;font-size:11px">${G("PL", 14)}→${G(p.map[0], 14)} ${G("PR", 14)}→${G(p.map[1], 14)}</span>` : ""}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--line);padding-top:10px"><div class="btn ghost" style="height:30px;padding:0 10px">Prévia</div><div class="btn ${p.hot ? "pri" : ""}" style="height:30px;padding:0 14px">Aplicar</div></div></div>`;
  return `<div style="display:flex;gap:20px;padding:20px ${t === "A" ? 22 : 32}px">
    <div style="width:170px;display:flex;flex-direction:column;gap:2px">${CATS.map((c, i) => `<div style="padding:8px 12px;border-radius:9px;font-weight:600;${i === 0 ? "background:var(--panel2);color:var(--tx)" : "color:var(--tx2)"}">${c}</div>`).join("")}</div>
    <div style="flex:1;display:flex;flex-direction:column;gap:14px">
      <div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:14px;background:linear-gradient(90deg,var(--acs),transparent 60%),var(--panel)">
        <div style="width:44px;height:44px;border-radius:12px;border:1px solid var(--ac);display:grid;place-items:center;font-size:20px">🎲</div>
        <div><b>Preset aleatório</b><div class="muted" style="font-size:12.5px">Sorteia um preset e mostra a prévia antes de aplicar</div></div>
        <div style="flex:1"></div><div class="btn">Sortear</div>
        <div style="width:1px;height:30px;background:var(--line)"></div>
        <div class="btn ghost">＋ Criar preset a partir do perfil atual</div></div>
      <div style="display:grid;grid-template-columns:repeat(${t === "A" ? 3 : 2},1fr);gap:14px">${PRESETS.slice(0, t === "A" ? 6 : 4).map(card).join("")}</div>
    </div></div>`;
}
function presets(t) {
  if (t === "A") return `${railA()}<div style="position:absolute;left:92px;top:0;right:0;bottom:0">${topA("Presets")}${presetsBody(t)}${footA(0)}</div>
    ${note(1, 120, 420, "“Aplicar” mexe só no rascunho. Nada vai para o controle até você clicar em Gravar.", 160)}`;
  if (t === "B") return `${sideB()}<div style="position:absolute;left:280px;top:0;right:0;bottom:0">${headB("Presets")}${presetsBody(t)}${footB()}</div>
    ${note(1, 300, 430, "Cada cartão mostra as curvas e a faixa dos gatilhos antes de aplicar.", 160)}`;
  return `${topC()}<div style="padding:0 22px"><div class="card" style="height:560px;overflow:hidden"><div style="padding:14px 18px 0;display:flex"><div class="seg"><div>Editar</div><div>Ao vivo</div><div class="on">Presets</div></div></div>${presetsBody("C")}</div></div>`;
}

// =====================================================================
// MONITOR (gyro + touchpad), themed by option
// =====================================================================
function monitorBody(t) {
  const spark = (color, seed, amp) => {
    let d = "";
    for (let i = 0; i <= 60; i++) { const y = 22 + Math.sin(i / 5 + seed) * amp * Math.cos(i / 13 + seed * 2) + Math.sin(i * 1.7 + seed) * 2; d += `${i ? "L" : "M"}${i * 4},${y.toFixed(1)}`; }
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"/>`;
  };
  const tp = (x, y) => [(x / 1920) * 100, (y / 1080) * 100];
  const f1 = tp(1220, 380), f2 = tp(520, 720);
  const touchDots = `<circle cx="${214 + (1220 / 1920) * 172}" cy="${80 + (380 / 1080) * 104}" r="8" fill="#f5b84a" opacity=".9"/><circle cx="${214 + (520 / 1920) * 172}" cy="${80 + (720 / 1080) * 104}" r="8" fill="#ff8a5c" opacity=".9"/>`;
  const ac = t === "B" ? "#1fc8ef" : t === "C" ? "#9b8cff" : "#4f8cff";
  return `<div style="display:grid;grid-template-columns:1.25fr 1fr 1fr;grid-template-rows:auto auto;gap:14px;padding:18px ${t === "A" ? 22 : t === "C" ? 0 : 32}px">
    <div class="card" style="grid-row:span 2;padding:16px;display:flex;flex-direction:column">
      <div class="cap">Controle</div>
      <div style="height:290px;margin-top:6px">${controllerSvg({ hl: { crs: "#2fd08a", R2: "#2fd08a", touch: "#f5b84a" }, ls: [-0.6, 0.3], rs: [0.5, -0.5], touchDots, body: "#1b1f28", edge: "#29303d", detail: "#10131a", line: "#363f50", light: ac })}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px">
        ${[["L2", 12], ["R2", 86]].map(([n, v]) => `<div><div class="kv">${G(n, 18)}<b>${v}%</b></div><div class="slider" style="height:8px"><i style="width:${v}%;background:${v > 50 ? "#2fd08a" : "var(--ac)"}"></i></div></div>`).join("")}
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:14px">${["L1", "R1", "up", "right", "down", "left", "tri", "cir", "crs", "sq", "L3", "R3", "PL", "PR", "fn", "ps", "opt", "create"].map((x) => G(x, 26, x === "crs" ? { bg: "rgba(47,208,138,.3)", border: "#2fd08a" } : {})).join("")}</div>
    </div>
    <div class="card" style="padding:16px">
      <div style="display:flex;align-items:center"><div class="cap">Giroscópio e acelerômetro</div><span class="dim" style="margin-left:auto;font-size:11px">⟲ recalibrar</span></div>
      <div style="display:flex;gap:14px;align-items:center;margin-top:10px">
        <div style="width:118px;height:96px;perspective:300px;display:grid;place-items:center;background:var(--bg2);border:1px solid var(--line);border-radius:12px">
          <div style="width:92px;height:62px;transform:rotateX(38deg) rotateY(-22deg) rotateZ(-8deg);transform-style:preserve-3d">${controllerSvg({ body: "#2a3140", edge: "#3a4458", detail: "#1a1f2a", line: "#556079", light: ac })}</div></div>
        <div style="flex:1;display:grid;grid-template-columns:1fr;gap:6px;font-variant-numeric:tabular-nums">
          ${[["Inclinação", "+38°", "#ff6b8a"], ["Rotação", "−22°", "#2fd08a"], ["Giro", "−8°", "#6aa8ff"]].map(([n, v, c]) => `<div style="display:flex;justify-content:space-between"><span class="muted"><span style="color:${c}">●</span> ${n}</span><b>${v}</b></div>`).join("")}
        </div></div>
      <svg width="100%" height="46" viewBox="0 0 240 44" preserveAspectRatio="none" style="margin-top:10px;background:var(--bg2);border-radius:8px">${spark("#ff6b8a", 0, 12)}${spark("#2fd08a", 2, 8)}${spark("#6aa8ff", 4, 5)}</svg>
      <div class="dim" style="font-size:11px;margin-top:6px;display:flex;justify-content:space-between"><span>gyro X 142 · Y −88 · Z 17 °/s</span><span>accel 0.02 · 0.61 · 0.79 g</span></div>
    </div>
    <div class="card" style="padding:16px">
      <div style="display:flex;align-items:center"><div class="cap">Touchpad</div><span class="chip" style="margin-left:auto;padding:2px 8px;font-size:10.5px;border-color:#f5b84a;color:#f5b84a">● CLIQUE</span></div>
      <div style="position:relative;margin-top:10px;height:118px;border-radius:14px;background:linear-gradient(180deg,var(--panel2),var(--bg2));border:2px solid #f5b84a;box-shadow:0 0 0 4px rgba(245,184,74,.12) inset;overflow:hidden">
        <div style="position:absolute;left:50%;top:0;bottom:0;border-left:1px dashed var(--line2)"></div>
        <svg style="position:absolute;inset:0" width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M40,70 Q52,52 63.5,35" stroke="#f5b84a" stroke-width="1.2" fill="none" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" opacity=".6"/></svg>
        <div style="position:absolute;left:${f1[0]}%;top:${f1[1]}%;width:26px;height:26px;margin:-13px;border-radius:50%;background:rgba(245,184,74,.85);box-shadow:0 0 0 6px rgba(245,184,74,.2);color:#2a1d00;font-weight:800;font-size:11px;display:grid;place-items:center">1</div>
        <div style="position:absolute;left:${f2[0]}%;top:${f2[1]}%;width:26px;height:26px;margin:-13px;border-radius:50%;background:rgba(255,138,92,.85);box-shadow:0 0 0 6px rgba(255,138,92,.2);color:#2a1000;font-weight:800;font-size:11px;display:grid;place-items:center">2</div>
      </div>
      <div class="dim" style="font-size:11px;margin-top:8px;display:flex;justify-content:space-between;font-variant-numeric:tabular-nums"><span><b style="color:#f5b84a">●1</b> x 1220 · y 380</span><span><b style="color:#ff8a5c">●2</b> x 520 · y 720</span><span>lado: direito</span></div>
    </div>
    <div class="card" style="padding:16px;grid-column:span 2;display:flex;gap:18px;align-items:center">
      ${[["Esquerdo", -0.6, 0.3, "L3"], ["Direito", 0.5, -0.5, "R3"]].map(([n, x, y, g]) => `<div style="display:flex;gap:12px;align-items:center;flex:1">
        <div style="width:86px;height:86px;border-radius:50%;border:1px solid var(--line2);background:var(--bg2);position:relative">
          <div style="position:absolute;inset:30%;border-radius:50%;border:1px dashed var(--line2)"></div>
          <div style="position:absolute;left:${50 + x * 40}%;top:${50 + y * 40}%;width:14px;height:14px;margin:-7px;border-radius:50%;background:#f5b84a;box-shadow:0 0 10px #f5b84a"></div></div>
        <div style="font-variant-numeric:tabular-nums"><div style="display:flex;gap:6px;align-items:center">${G(g, 18)}<b>${n}</b></div><div class="dim" style="font-size:12px">X ${Math.round(128 + x * 127)} · Y ${Math.round(128 + y * 127)}</div><div class="dim" style="font-size:12px">intensidade ${Math.round(Math.hypot(x, y) * 100)}%</div></div></div>`).join("")}
      <div style="width:1px;align-self:stretch;background:var(--line)"></div>
      <div style="display:flex;flex-direction:column;gap:6px"><div class="btn" style="height:30px">Vibrar fraco</div><div class="btn" style="height:30px">Vibrar forte</div></div>
    </div>
  </div>`;
}
function monitor(t) {
  const y = t === "C" ? 712 : 640;
  const notes = note(1, t === "B" ? 700 : 600, y, "Giroscópio: o controle em 3D acompanha a inclinação, com gráfico dos 3 eixos.", 240) +
    note(2, t === "B" ? 980 : 900, y, "Touchpad: até 2 dedos com posição e rastro. A borda acende quando o touchpad é clicado.", 260);
  if (t === "A") return `${railA()}<div style="position:absolute;left:92px;top:0;right:0;bottom:0">${topA("Monitor")}${monitorBody(t)}</div>${notes}`;
  if (t === "B") return `${sideB()}<div style="position:absolute;left:280px;top:0;right:0;bottom:0">${headB("Monitor ao vivo")}${monitorBody(t)}</div>${notes}`;
  return `${topC()}<div style="padding:0 22px"><div class="card" style="height:560px;overflow:hidden;padding:0 18px"><div style="padding:14px 0 0;display:flex"><div class="seg"><div>Editar</div><div class="on">Ao vivo</div><div>Presets</div></div></div>${monitorBody("C")}</div></div>${notes}`;
}

// =====================================================================
const OPTIONS = {
  A: { t: "Opção A — Arena", s: "Controle no centro, com rótulos", d: "O controle é o centro da tela, com linhas ligando cada botão à função dele (como na sua 4ª referência). Os slots ficam numa barra fina à esquerda e as abas no topo. Mostra mais informação de uma vez só e tem visual de app de jogo.", screens: [["Botões", A_buttons], ["Presets", () => presets("A")], ["Monitor ao vivo", () => monitor("A")]] },
  B: { t: "Opção B — Studio", s: "Evolução da referência", d: "Fica mais perto do edge-config: barra lateral com slots e biblioteca, abas sublinhadas e cartões com ícones PlayStation. Ganha uma prévia do controle ao lado, que acende o botão em foco. É a opção mais familiar e organizada.", screens: [["Botões", B_buttons], ["Presets", () => presets("B")], ["Monitor ao vivo", () => monitor("B")]] },
  C: { t: "Opção C — Console", s: "Clique no controle para editar", d: "Os slots viram cartões grandes no topo, cada um com sua cor, no estilo de perfis de console. Tudo se edita clicando direto no controle, e um painel à direita mostra só as opções da parte escolhida. É a mais intuitiva para quem não conhece os termos.", screens: [["Botões / Analógicos (painel contextual)", C_buttons], ["Presets", () => presets("C")], ["Monitor ao vivo", () => monitor("C")]] },
};

let current = "A";
function render() {
  const o = OPTIONS[current];
  document.getElementById("switch").innerHTML = Object.entries(OPTIONS).map(([k, v]) => `<button class="${k === current ? "on" : ""}" data-k="${k}"><b>${v.t}</b><span>${v.s}</span></button>`).join("");
  document.getElementById("desc").textContent = o.d;
  document.getElementById("frames").innerHTML = o.screens.map(([title, fn], i) => `
    <div class="frame-title"><b>${i + 1}. ${title}</b><span>${current} · 1280 × 800</span></div>
    <div class="stage"><div class="frame" data-t="${current}">${win}${fn()}</div></div>`).join("");
  document.querySelectorAll("#switch button").forEach((b) => (b.onclick = () => { current = b.dataset.k; render(); fit(); }));
  fit();
}
function fit() {
  document.querySelectorAll(".stage").forEach((st) => {
    const sc = st.clientWidth / 1280;
    st.style.height = 800 * sc + "px";
    st.firstElementChild.style.transform = `scale(${sc})`;
  });
}
window.addEventListener("resize", fit);
const q = new URLSearchParams(location.search).get("opt");
if (q && OPTIONS[q]) current = q;
render();
