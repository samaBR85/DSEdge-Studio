"use strict";

// ============================================================ helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const G = (t, s = 22, o) => glyphSvg(t, s, o);
const SLOT_GLYPH = { 0x63: "tri", 0x60: "sq", 0x61: "crs", 0x62: "cir" };
const ORDER = [0x63, 0x60, 0x61, 0x62];
const COLORS = { body: "#1a1f2c", edge: "#283044", detail: "#0f121b", line: "#36405a" };

const state = {
  status: { connected: false },
  slots: null,          // parsed controller profiles (order △ □ ✕ ○)
  library: [],
  selected: null,       // {kind:"slot", selector} | {kind:"lib", id}
  original: null,
  draft: null,
  activeSelector: null,
  input: null, yaw: 0,
  tab: "buttons",
  picker: null,         // physical index being remapped
  drawer: false,
  presetCat: "Todos",
  trigLink: false,
  invert: {},           // per-axis inversion of the 3D view {pitch, roll, yaw}
  busy: false,
};

function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), kind === "err" ? 6000 : 3200);
}
function confirmDialog(title, body, okText = "Confirmar", danger = false) {
  return new Promise((resolve) => {
    $("#modal-title").textContent = title;
    $("#modal-body").textContent = body;
    const ok = $("#modal-ok");
    ok.textContent = okText;
    ok.className = "btn " + (danger ? "danger" : "pri");
    $("#modal").classList.remove("hidden");
    const done = (v) => { $("#modal").classList.add("hidden"); ok.onclick = $("#modal-cancel").onclick = null; resolve(v); };
    ok.onclick = () => done(true);
    $("#modal-cancel").onclick = () => done(false);
  });
}
const call = async (cmd, args) => {
  try { return await Native.call(cmd, args); } catch (e) { throw new Error(e?.message || String(e)); }
};
const diag = (text) => { if (!Native.simulated) Native.call("log", { text: String(text) }).catch(() => {}); };
window.addEventListener("error", (e) => diag(`JS error: ${e.message} @${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => diag(`JS rejection: ${e.reason?.message || e.reason}`));

const slotOf = (sel) => state.slots?.find((p) => p.profileButtonSelector === sel);
const strip = (p) => { const c = Proto.clone(p); delete c.raw; delete c.empty; delete c.profileButtonSelector; return c; };
const isLib = () => state.selected?.kind === "lib";
const isDirty = () => !!state.draft && !isLib() && JSON.stringify(strip(state.draft)) !== JSON.stringify(strip(state.original));
function changeCount() {
  if (!state.draft || !state.original) return 0;
  const a = state.draft, b = state.original;
  let n = a.buttonMapping.buttons.filter((v, i) => v !== b.buttonMapping.buttons[i]).length;
  for (const k of ["leftJoystick", "rightJoystick", "leftTrigger", "rightTrigger"]) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) n++;
  if (a.label !== b.label) n++;
  return n;
}
function summary(p) {
  const nm = (j) => Proto.STICK_PRESETS[j?.profileId]?.name ?? "?";
  const remaps = (p.buttonMapping?.buttons || []).filter((b, i) => b !== i).length;
  return `${nm(p.leftJoystick)} / ${nm(p.rightJoystick)}${remaps ? ` · ${remaps} remap.` : ""}`;
}

// ============================================================ persistence
async function loadLibrary() {
  try { const t = await call("loadFile", { name: "library" }); state.library = t ? JSON.parse(t).map(normalize) : []; } catch { state.library = []; }
  try { const s = await call("loadFile", { name: "state" }); if (s) { const o = JSON.parse(s); state.activeSelector = o.activeSelector ?? null; state.invert = o.invert || {}; state.hwSaved = o.hw || null; } } catch {}
}
const saveLibrary = () => call("saveFile", { name: "library", text: JSON.stringify(state.library.map((p) => { const c = Proto.clone(p); delete c.empty; return c; }), null, 2) });
const saveState = () => call("saveFile", { name: "state", text: JSON.stringify({ activeSelector: state.activeSelector, invert: state.invert, hw: typeof HW !== "undefined" ? HW.saved() : state.hwSaved }) });
let autosaveT = null;
function autosaveLib() {
  if (!isLib()) return;
  clearTimeout(autosaveT);
  autosaveT = setTimeout(async () => {
    const i = state.library.findIndex((p) => p.id === state.selected.id);
    if (i < 0) return;
    state.library[i] = Proto.clone(state.draft);
    await saveLibrary().catch((e) => toast("Falha ao salvar: " + e.message, "err"));
    renderDrawer();
  }, 350);
}

function normalize(p) {
  const out = Object.assign(Proto.newProfile(p.label || "Perfil"), p);
  for (const k of ["leftJoystick", "rightJoystick"]) {
    const j = out[k] || {};
    const pid = Proto.STICK_PRESETS[j.profileId] ? j.profileId : 0;
    let cv = Array.isArray(j.curveValues) && j.curveValues.length === 6 ? j.curveValues.slice() : null;
    if (!cv || cv.every((v) => v === 0)) cv = Proto.presetCurve(pid, 5);
    out[k] = { profileId: pid, modifier: j.modifier ?? Proto.STICK_PRESETS[pid].mod, curveValues: cv };
  }
  if (!out.buttonMapping?.buttons || out.buttonMapping.buttons.length !== 16) out.buttonMapping = { buttons: Array.from({ length: 16 }, (_, i) => i) };
  out.leftTrigger = out.leftTrigger || { min: 0, max: 255 };
  out.rightTrigger = out.rightTrigger || { min: 0, max: 255 };
  return out;
}

// ============================================================ controller I/O
async function readProfiles(silent = true) {
  if (!state.status.connected) return;
  try {
    state.slots = Proto.parseAll(await call("readProfiles"));
    diag(`slots: ${state.slots.map((p) => (p.empty ? "<vazio>" : p.label)).join(" | ")}`);
    if (state.selected?.kind === "slot" && !isDirty()) openSlot(state.selected.selector, true);
    renderChrome();
    if (!silent) toast("Perfis lidos do controle", "ok");
  } catch (e) { toast("Não foi possível ler os perfis: " + e.message, "err"); }
}

async function writeToSlot(sel) {
  if (!state.status.connected) return toast("Conecte o controle pelo cabo USB para gravar.", "err");
  if (!state.draft) return;
  const g = SLOT_GLYPH[sel];
  const cur = slotOf(sel);
  const same = state.selected?.kind === "slot" && state.selected.selector === sel;
  if (cur && !cur.empty && !same) {
    const ok = await confirmDialog(`Substituir o slot FN + ${{ sq: "□", crs: "✕", cir: "○" }[g]}?`,
      `“${cur.label}” será substituído por “${state.draft.label || "Perfil"}”. Se quiser guardá-lo, salve-o na biblioteca antes.`, "Substituir");
    if (!ok) return;
  }
  state.busy = true; renderFoot();
  try {
    await Backup.record(sel, `antes de gravar “${state.draft.label || "Perfil"}”`);
    await call("writeFeatures", { reports: Proto.encode(state.draft, sel) });
    call("rumble", { strength: 90, ms: 180 }).catch(() => {});
    state.slots = Proto.parseAll(await call("readProfiles"));
    const w = slotOf(sel);
    const ok = w && !w.empty && w.label === (state.draft.label || "Perfil").slice(0, 40);
    if (isLib()) { state.original = Proto.clone(state.draft); }
    else openSlot(sel, true);
    toast(ok ? `“${state.draft.label}” gravado no controle` : "Gravado, mas a releitura não confere — clique em recarregar.", ok ? "ok" : "err");
  } catch (e) { toast("Falha ao gravar: " + e.message, "err"); }
  state.busy = false;
  renderAll();
}

async function clearSlot(sel) {
  const p = slotOf(sel);
  if (!(await confirmDialog("Limpar este slot do controle?", `“${p?.label || ""}” será apagado do controle. Perfis da biblioteca não são afetados.`, "Limpar slot", true))) return;
  try {
    await Backup.record(sel, "antes de limpar o slot");
    await call("writeFeatures", { reports: [Proto.clearReport(sel)] });
    await new Promise((r) => setTimeout(r, 150));
    state.slots = Proto.parseAll(await call("readProfiles"));
    if (state.selected?.kind === "slot" && state.selected.selector === sel) goHome();
    toast("Slot limpo", "ok");
  } catch (e) { toast("Falha ao limpar: " + e.message, "err"); }
  renderAll();
}

// ============================================================ selection
async function guard() {
  if (!isDirty()) return true;
  return confirmDialog("Descartar alterações?", "As alterações deste slot ainda não foram gravadas no controle.", "Descartar", true);
}
async function trySelect(fn) { if (await guard()) fn(); }

function openSlot(sel, keep = false) {
  const p = slotOf(sel);
  if (!p) return;
  state.selected = { kind: "slot", selector: sel };
  if (p.empty) {
    state.original = Proto.newProfile(`Perfil ${{ 0x60: "Quadrado", 0x61: "Xis", 0x62: "Círculo" }[sel] || ""}`.trim());
    state.original.profileButtonSelector = sel;
  } else state.original = Proto.clone(p);
  state.draft = Proto.clone(state.original);
  state.picker = null;
  if (!keep && state.tab === "monitor") state.tab = "buttons";
  renderAll();
}
function openLib(id) {
  const p = state.library.find((x) => x.id === id);
  if (!p) return;
  state.selected = { kind: "lib", id };
  state.original = normalize(Proto.clone(p));
  state.draft = Proto.clone(state.original);
  state.picker = null;
  if (state.tab === "monitor") state.tab = "buttons";
  renderAll();
}
function goHome() { state.selected = state.draft = state.original = null; state.picker = null; renderAll(); }

async function newProfile(base) {
  if (!(await guard())) return;
  const p = base ? Proto.clone(base) : Proto.newProfile(uniqueName("Novo perfil"));
  p.id = Proto.randomId();
  delete p.raw; delete p.empty;
  p.profileButtonSelector = 0;
  state.library.unshift(p);
  await saveLibrary();
  state.drawer = false;
  openLib(p.id);
  state.tab = "buttons";
  renderAll();
  setTimeout(() => { $("#name").focus(); $("#name").select(); }, 30);
  toast("Perfil criado na biblioteca. Grave no controle quando quiser.", "ok");
}
function uniqueName(base) {
  const names = new Set(state.library.map((p) => p.label));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}
function changed() {
  autosaveLib();
  renderFoot();
  renderRail();
}

// ============================================================ chrome render
let lastMenuInfo = null;
function syncMenuInfo() {
  const p = state.activeSelector != null ? slotOf(state.activeSelector) : null;
  const txt = p && state.status.connected ? `${p.empty ? "vazio" : p.label || "Sem nome"} (FN + ${{ 0x63: "△", 0x60: "□", 0x61: "✕", 0x62: "○" }[state.activeSelector]})` : "";
  if (txt === lastMenuInfo) return;
  lastMenuInfo = txt;
  if (!Native.simulated) Native.call("menuInfo", { profile: txt }).catch(() => {});
}
function renderRail() {
  syncMenuInfo();
  $("#rail-slots").innerHTML = ORDER.map((sel) => {
    const p = slotOf(sel);
    const isSel = state.selected?.kind === "slot" && state.selected.selector === sel;
    const nm = !state.slots ? "—" : sel === 0x63 ? "Padrão 🔒" : p?.empty ? "Vazio" : p?.label || "Sem nome";
    return `<button class="rslot ${isSel ? "sel" : ""} ${!state.slots ? "off" : ""} ${p?.empty ? "empty" : ""}" data-sel="${sel}" title="${esc(p?.label || "")}">
      ${state.activeSelector === sel && state.slots ? `<span class="act" title="Perfil ativo"></span>` : ""}
      <div class="keys">${G("fn", 15)}${G(SLOT_GLYPH[sel], 26)}</div><div class="nm">${esc(nm)}</div></button>`;
  }).join("");
  $$("#rail-slots .rslot").forEach((b) => (b.onclick = () => trySelect(() => openSlot(Number(b.dataset.sel)))));
  $("#rail-lib").classList.toggle("on", state.drawer);
  $("#lib-count").textContent = state.library.length;
}

function renderDrawer() {
  $("#drawer").classList.toggle("hidden", !state.drawer);
  if (!state.drawer) return;
  const q = $("#lib-search").value.trim().toLowerCase();
  const items = state.library.filter((p) => !q || (p.label || "").toLowerCase().includes(q));
  const list = $("#lib-list");
  if (!state.library.length) { list.innerHTML = `<div class="lib-empty">Nenhum perfil ainda. Crie um novo — ele fica salvo aqui e pode ser gravado no controle depois.</div>`; return; }
  list.innerHTML = items.map((p) => {
    const remaps = p.buttonMapping.buttons.filter((b, i) => b !== i).length;
    return `<div class="lib-item ${isLib() && state.selected.id === p.id ? "sel" : ""}" data-id="${esc(p.id)}">
      <div class="ico">${G(remaps ? "PL" : "R3", 18)}</div>
      <div class="tx"><b>${esc(p.label || "Sem nome")}</b><span>${esc(summary(p))}</span></div>
      <button class="icon-btn" data-act="dup" title="Duplicar"><svg viewBox="0 0 24 24"><path d="M8 8h12v12H8zM4 16V4h12"/></svg></button>
      <button class="icon-btn" data-act="del" title="Excluir"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button></div>`;
  }).join("") || `<div class="lib-empty">Nada encontrado.</div>`;
  $$("#lib-list .lib-item").forEach((el) => {
    el.onclick = (e) => {
      const id = el.dataset.id, act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "dup") { e.stopPropagation(); return duplicateLib(id); }
      if (act === "del") { e.stopPropagation(); return deleteLib(id); }
      trySelect(() => openLib(id));
    };
  });
}

function renderTop() {
  const d = state.draft;
  const name = $("#name");
  name.disabled = !d;
  if (document.activeElement !== name) name.value = d ? d.label : "";
  name.placeholder = d ? "Nome do perfil" : "DualSense Edge Studio";
  let src = "";
  if (d && state.selected.kind === "slot") {
    const sel = state.selected.selector, p = slotOf(sel);
    src = `${G("fn", 13)}${G(SLOT_GLYPH[sel], 14)} <span>slot do controle${p?.empty ? " (vazio)" : ""}${state.activeSelector === sel ? " · ativo" : ""}${sel === 0x63 ? " · somente leitura" : ""}</span>`;
    if (sel !== 0x63 && !p?.empty) src += ` · <a href="#" id="clear-slot" style="color:var(--bad)">limpar slot</a>`;
  } else if (d) {
    src = `<span>📚 Biblioteca do app</span>`;
  } else src = `<span>Selecione um slot ou crie um perfil</span>`;
  $("#source").innerHTML = src;
  const cs = $("#clear-slot");
  if (cs) cs.onclick = (e) => { e.preventDefault(); clearSlot(state.selected.selector); };
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));

  const st = state.status;
  const conn = $("#conn");
  conn.className = "pill " + (st.connected ? "on" : st.bluetoothOnly ? "warn" : "");
  $("#conn-text").textContent = st.connected ? `USB${Native.simulated ? " (simulado)" : ""}` : st.bluetoothOnly ? "Bluetooth — use o cabo" : "Desconectado";
  $("#btn-refresh").disabled = !st.connected;
}

function renderBattery() {
  const i = state.input, el = $("#battery");
  if (!i || !state.status.connected) return el.classList.add("hidden");
  el.classList.remove("hidden");
  const key = `${i.battery}|${i.charging}|${i.full}`;
  if (el.dataset.k === key) return;
  el.dataset.k = key;
  el.innerHTML = `<span class="bat"><i style="width:${i.battery}%;${i.battery <= 20 ? "background:var(--bad)" : ""}"></i></span>${i.charging ? "⚡ " : ""}${i.full ? "100%" : i.battery + "%"}`;
}

function renderFoot() {
  const d = state.draft;
  $("#foot").classList.toggle("hidden", !d);
  if (!d) return;
  const st = $("#foot-status");
  if (isLib()) {
    st.className = "foot-status ok";
    st.textContent = `✓ Salvo na biblioteca${state.status.connected ? "" : " · conecte o controle por USB para gravar"}`;
  } else if (isDirty()) {
    st.className = "foot-status warn";
    const n = changeCount();
    st.textContent = `● ${n} ${n === 1 ? "alteração não gravada" : "alterações não gravadas"} no controle`;
  } else {
    st.className = "foot-status";
    st.textContent = "Igual ao que está no controle";
  }
  $("#btn-revert").classList.toggle("hidden", !isDirty());
  $("#btn-save").textContent = isLib() ? "Duplicar" : "Salvar na biblioteca";
  const canWrite = state.status.connected && !state.busy;
  $("#write-group").classList.toggle("disabled", !canWrite);
  const cur = state.selected.kind === "slot" ? state.selected.selector : null;
  $$(".slot-w").forEach((b) => {
    const sel = Number(b.dataset.sel), isCur = sel === cur;
    b.disabled = !canWrite;
    b.classList.toggle("cur", isCur);
    b.innerHTML = G(SLOT_GLYPH[sel], 20, { mono: true, fg: isCur ? "#1a2b55" : "#fff", bg: "transparent", border: "transparent" });
  });
}

const LIVE_TABS = ["monitor", "hw", "diag"];
function renderHome() {
  const show = !state.draft && !LIVE_TABS.includes(state.tab);
  $("#home").classList.toggle("hidden", !show);
  if (!show) return;
  $("#home-ctrl").innerHTML = controllerSvg({ ...COLORS, hl: state.slots ? {} : {} });
  const hs = $("#home-slots");
  hs.innerHTML = state.slots ? ORDER.map((sel) => {
    const p = slotOf(sel);
    return `<button class="home-slot" data-sel="${sel}">${G("fn", 13)}${G(SLOT_GLYPH[sel], 20)} ${esc(sel === 0x63 ? "Padrão" : p?.empty ? "Vazio" : p?.label)}</button>`;
  }).join("") : `<span class="dim">${state.status.bluetoothOnly ? "Controle conectado por Bluetooth — ligue o cabo USB para ler e gravar perfis." : "Controle não conectado — você ainda pode criar perfis na biblioteca."}</span>`;
  $$(".home-slot").forEach((b) => (b.onclick = () => openSlot(Number(b.dataset.sel))));
}

function renderAll() {
  renderRail();
  renderDrawer();
  renderTop();
  renderFoot();
  renderHome();
  $$(".view").forEach((v) => v.classList.toggle("hidden", v.dataset.view !== state.tab));
  if (state.tab === "monitor") buildMonitor();
  if (state.tab === "diag") { Diag.build(); Diag.refresh(); }
  if (state.tab === "hw") HW.build();
  if (!state.draft) return;
  if (state.tab === "buttons") renderButtons();
  if (state.tab === "sticks") renderSticks();
  if (state.tab === "triggers") renderTriggers();
  if (state.tab === "presets") renderPresets();
}
const renderChrome = () => { renderRail(); renderTop(); renderFoot(); renderHome(); renderDrawer(); };

// ============================================================ BUTTONS (controller + callouts)
const LEFT = ["L2", "L1", "up", "right", "down", "left", "L3", "PL"];
const RIGHT = ["R2", "R1", "tri", "cir", "crs", "sq", "R3", "PR"];
const ST = { w: 1188, h: 600, cx: 294, cy: 64, chipW: 214, lx: 20, rx: 954, y0: 14, step: 64 };
let lastPressedKey = "";

function pressedSet(i, digitalOnly = false) {
  const out = new Set();
  const thr = digitalOnly ? 999 : 40;
  if (!i) return out;
  const d = i.dpad;
  if ([0, 1, 7].includes(d)) out.add(0);
  if ([1, 2, 3].includes(d)) out.add(1);
  if ([3, 4, 5].includes(d)) out.add(2);
  if ([5, 6, 7].includes(d)) out.add(3);
  if (i.circle) out.add(4); if (i.cross) out.add(5); if (i.square) out.add(6); if (i.triangle) out.add(7);
  if (i.r1) out.add(8); if (i.r2b || i.r2 > thr) out.add(9); if (i.r3) out.add(10);
  if (i.l1) out.add(11); if (i.l2b || i.l2 > thr) out.add(12); if (i.l3) out.add(13);
  if (i.paddleL) out.add(14); if (i.paddleR) out.add(15);
  return out;
}

function renderButtons() {
  const stage = $("#map-stage");
  const b = state.draft.buttonMapping.buttons;
  const pressed = pressedSet(state.input);
  lastPressedKey = [...pressed].join(",");
  const hl = {};
  b.forEach((v, i) => { if (v !== i) hl[INDEX_TO_PART[i]] = "#4f8cff"; });
  if (state.picker != null) hl[INDEX_TO_PART[state.picker]] = "#7aa8ff";
  pressed.forEach((i) => (hl[INDEX_TO_PART[i]] = "#2fd08a"));

  let lines = "", chips = "";
  const chip = (part, side, row) => {
    const idx = PART_TO_INDEX[part], tgt = b[idx], mapped = tgt !== idx;
    const y = ST.y0 + row * ST.step, x = side === "l" ? ST.lx : ST.rx;
    const [ax, ay] = ANCHOR[part];
    const tx = ST.cx + ax, ty = ST.cy + ay;
    const col = mapped ? "var(--ac)" : "var(--line2)";
    lines += side === "l"
      ? `<path d="M${x + ST.chipW},${y + 24} H${Math.min(tx - 24, 316)} L${tx},${ty}" fill="none" stroke="${col}" stroke-width="${mapped ? 1.6 : 1}"/>`
      : `<path d="M${x},${y + 24} H${Math.max(tx + 24, 872)} L${tx},${ty}" fill="none" stroke="${col}" stroke-width="${mapped ? 1.6 : 1}"/>`;
    lines += `<circle cx="${tx}" cy="${ty}" r="3" fill="${col}"/>`;
    const isPaddleNone = idx >= 14 && tgt === idx;
    const target = !mapped ? `<span class="dim">${isPaddleNone ? "Sem função" : "Padrão"}</span>` : `${G(PHYS[tgt]?.g || "none", 18)}<b>${esc(PHYS[tgt]?.name || "Código " + tgt)}</b>`;
    chips += `<button class="callout ${side === "r" ? "r" : ""} ${mapped ? "mapped" : ""} ${state.picker === idx ? "sel" : ""} ${pressed.has(idx) ? "pressed" : ""}" data-idx="${idx}" style="left:${x}px;top:${y}px" title="${esc(PHYS[idx].name)}">
      ${G(PHYS[idx].g, 24)}<span class="arrow">${side === "r" ? "←" : "→"}</span><span class="tgt">${target}</span></button>`;
  };
  LEFT.forEach((p, i) => chip(p, "l", i));
  RIGHT.forEach((p, i) => chip(p, "r", i));

  let picker = "";
  if (state.picker != null) {
    const idx = state.picker, isLeft = LEFT.includes(INDEX_TO_PART[idx]);
    const row = (isLeft ? LEFT : RIGHT).indexOf(INDEX_TO_PART[idx]);
    const PW = 372;
    const top = Math.max(0, Math.min(ST.h - 300, ST.y0 + row * ST.step - 40));
    const left = isLeft ? ST.lx + ST.chipW + 12 : ST.rx - PW - 12;
    const tile = (t, label) => `<button class="tile ${b[idx] === t ? "on" : ""} ${t === idx ? "def" : ""}" data-t="${t}">${G(PHYS[t].g, 20)}<span>${esc(label || PHYS[t].short)}</span></button>`;
    const groups = [
      ["Ação", [7, 6, 5, 4]],                 // △ □ ✕ ○
      ["Ombros", [11, 12, 13, 8, 9, 10]],     // L1 L2 L3 R1 R2 R3
      ["Direcional", [0, 2, 3, 1]],           // ↑ ↓ ← →
    ];
    const none = `<button class="tile ${b[idx] === idx ? "on" : ""}" data-t="${idx}">${G("none", 20)}<span>Sem função</span></button>`;
    const rows = groups.map(([cap, ts], gi) => {
      const cells = ts.map((t) => tile(t));
      if (idx >= 14 && gi === groups.length - 1) cells.push(none);   // paddles can also be disabled
      return `<div class="pk-cap">${cap}</div><div class="pk-row" style="grid-template-columns:repeat(${cells.length},1fr)">${cells.join("")}</div>`;
    }).join("");
    picker = `<div class="picker ${performance.now() - pickerOpenedAt < 120 ? "anim" : ""}" style="left:${left}px;top:${top}px;width:${PW}px">
      <div class="picker-head">${G(PHYS[idx].g, 22)}<b>${esc(PHYS[idx].name)}</b><span class="dim">ou aperte o botão desejado no controle</span></div>
      ${rows}</div>`;
  }

  stage.innerHTML = `<div class="ctrl-box">${controllerSvg({ ...COLORS, hl })}</div>
    <svg class="lines" width="${ST.w}" height="${ST.h}">${lines}</svg>${chips}${picker}
    <div class="stage-hint">Clique num botão do desenho ou num rótulo para mudar a função</div>
    <div class="stage-actions">
      <button class="btn sm ghost" id="swap-xo">${G("crs", 16)} ⇄ ${G("cir", 16)} Trocar ✕ e ○</button>
      <button class="btn sm ghost" id="reset-map">Restaurar padrão</button>
    </div>`;

  $$(".callout", stage).forEach((c) => (c.onclick = (e) => { e.stopPropagation(); togglePicker(Number(c.dataset.idx)); }));
  $$(".tile", stage).forEach((t) => (t.onclick = (e) => { e.stopPropagation(); assign(state.picker, Number(t.dataset.t)); }));
  $(".picker", stage)?.addEventListener("click", (e) => e.stopPropagation());
  fitPicker(stage);
  $(".ctrl-box", stage).onclick = (e) => {
    e.stopPropagation();
    const part = e.target.closest("[data-part]")?.dataset.part;
    if (part in PART_TO_INDEX) togglePicker(PART_TO_INDEX[part]);
    else if (part) toast("Esse botão não pode ser remapeado no perfil do controle.");
  };
  $("#swap-xo").onclick = () => { [b[4], b[5]] = [b[5], b[4]]; changed(); renderButtons(); };
  $("#reset-map").onclick = () => { state.draft.buttonMapping.buttons = Array.from({ length: 16 }, (_, i) => i); state.picker = null; changed(); renderButtons(); };
  fitStage();
}
// keep the picker inside the visible area (the stage is scaled to fit, so convert screen px → stage px)
function fitPicker(stage) {
  const pk = $(".picker", stage), wrap = stage.parentElement;
  if (!pk || !wrap) return;
  const sr = stage.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), pr = pk.getBoundingClientRect();
  const k = sr.height / stage.offsetHeight || 1, m = 10;
  let dy = 0;
  if (pr.bottom > wr.bottom - m) dy = (wr.bottom - m - pr.bottom) / k;
  if (pr.top + dy * k < wr.top + m) dy = (wr.top + m - pr.top) / k;
  if (dy) pk.style.top = `${parseFloat(pk.style.top) + dy}px`;
}
let pickerOpenedAt = 0;
function togglePicker(idx) { state.picker = state.picker === idx ? null : idx; pickerOpenedAt = performance.now(); renderButtons(); }
function assign(idx, t) {
  if (idx == null) return;
  state.draft.buttonMapping.buttons[idx] = t;
  state.picker = null;
  changed();
  renderButtons();
}
function fitStage() {
  const wrap = $(".stage-wrap"), st = $("#map-stage");
  if (!wrap || !st) return;
  const sc = Math.min(wrap.clientWidth / ST.w, wrap.clientHeight / ST.h, 1.2);
  st.style.transform = `scale(${sc})`;
}
window.addEventListener("resize", fitStage);

// ============================================================ STICKS
function renderSticks() {
  const box = $("#sticks");
  box.innerHTML = `<div class="card" id="stick-left"></div><div class="card" id="stick-right"></div>`;
  renderStick("left");
  renderStick("right");
}
function setRangeFill(r) { r.style.setProperty("--p", `${((r.value - r.min) / (r.max - r.min)) * 100}%`); }
function renderStick(side) {
  const card = $(`#stick-${side}`);
  const key = side === "left" ? "leftJoystick" : "rightJoystick";
  const other = side === "left" ? "rightJoystick" : "leftJoystick";
  const j = state.draft[key];
  const idx = Proto.detectIndex(j.profileId, j.curveValues);
  const dz = Proto.deadzoneOf(j.curveValues);
  const fixed = Proto.STICK_PRESETS[j.profileId].adj.every((a) => a.length === 1);
  card.innerHTML = `
    <h4>${G(side === "left" ? "L3" : "R3", 22)} Analógico ${side === "left" ? "esquerdo" : "direito"}<span class="sub"><button class="btn sm ghost" data-copy>Copiar para o ${side === "left" ? "direito" : "esquerdo"}</button></span></h4>
    <div class="preset-row">${Proto.STICK_PRESETS.map((p) => `<button class="chip ${p.id === j.profileId ? "on" : ""}" data-p="${p.id}">${p.name}</button>`).join("")}</div>
    <div class="stick-body"><div class="curve-host"></div>
      <div class="controls">
        <div class="field"><label>Intensidade da curva <b data-iv>${fixed ? "—" : idx == null ? "personalizada" : idx}</b></label><input type="range" min="0" max="10" value="${fixed ? 5 : idx ?? 5}" data-int ${fixed ? "disabled" : ""}><div class="help">${fixed ? "Esta curva não tem ajuste de intensidade." : "0 = mais suave · 10 = mais agressiva"}</div></div>
        <div class="field"><label>Zona morta <b data-dv>${dz}%</b></label><input type="range" min="0" max="40" value="${dz}" data-dz><div class="help">Quanto o analógico precisa se mover antes de responder.</div></div>
        <div class="field"><label>Pontos da curva (entrada → saída)</label><div class="raw-grid" data-raw></div></div>
        <div class="live-pad"><div class="joy"><i></i></div><span>Mova o analógico: o ponto amarelo mostra a resposta na curva.</span></div>
      </div></div>`;
  const intIn = $("[data-int]", card), dzIn = $("[data-dz]", card), iv = $("[data-iv]", card), dv = $("[data-dv]", card);
  [intIn, dzIn].forEach(setRangeFill);
  $$("[data-p]", card).forEach((c) => (c.onclick = () => {
    const keep = Proto.deadzoneOf(j.curveValues), p = Proto.STICK_PRESETS[Number(c.dataset.p)];
    j.profileId = p.id; j.modifier = p.mod; j.curveValues = Proto.presetCurve(p.id, 5);
    if (keep) Proto.applyDeadzone(j, keep);
    changed(); renderStick(side);
  }));
  $("[data-copy]", card).onclick = () => { state.draft[other] = Proto.clone(j); changed(); renderSticks(); toast("Configuração copiada para o outro analógico"); };
  intIn.oninput = () => {
    const keep = Proto.deadzoneOf(j.curveValues);
    j.curveValues = Proto.presetCurve(j.profileId, Number(intIn.value));
    if (keep) Proto.applyDeadzone(j, keep);
    iv.textContent = intIn.value; setRangeFill(intIn); draw(); syncRaw(); changed();
  };
  dzIn.oninput = () => { Proto.applyDeadzone(j, Number(dzIn.value)); dv.textContent = dzIn.value + "%"; setRangeFill(dzIn); draw(); syncRaw(); changed(); };

  const raw = $("[data-raw]", card);
  const inputs = j.curveValues.map((v, i) => {
    const inp = document.createElement("input");
    inp.className = "num"; inp.type = "number"; inp.min = 0; inp.max = 255; inp.value = v;
    inp.onchange = () => { j.curveValues[i] = Math.max(0, Math.min(255, Number(inp.value) || 0)); draw(); meta(); changed(); };
    return inp;
  });
  for (let k = 0; k < 3; k++) {
    const pair = document.createElement("div");
    pair.className = "raw-pair";
    pair.innerHTML = `<span>P${k + 1}</span>`;
    pair.append(inputs[k * 2], inputs[k * 2 + 1]);
    raw.append(pair);
  }
  const syncRaw = () => inputs.forEach((inp, i) => (inp.value = j.curveValues[i]));
  const meta = () => {
    const ix = Proto.detectIndex(j.profileId, j.curveValues);
    iv.textContent = fixed ? "—" : ix == null ? "personalizada" : ix;
    if (ix != null) { intIn.value = ix; setRangeFill(intIn); }
    const d = Proto.deadzoneOf(j.curveValues);
    dzIn.value = d; dv.textContent = d + "%"; setRangeFill(dzIn);
  };

  const W = 240, pad = 12, S = W - pad * 2;
  const X = (v) => pad + (v / 255) * S, Y = (v) => W - pad - (v / 255) * S;
  const NS = "http://www.w3.org/2000/svg";
  const mk = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = mk("svg", { class: "curve", viewBox: `0 0 ${W} ${W}` });
  for (let i = 1; i < 4; i++) {
    svg.append(mk("line", { class: "gl", x1: X(i * 63.75), y1: Y(0), x2: X(i * 63.75), y2: Y(255) }));
    svg.append(mk("line", { class: "gl", x1: X(0), y1: Y(i * 63.75), x2: X(255), y2: Y(i * 63.75) }));
  }
  svg.append(mk("line", { class: "diag", x1: X(0), y1: Y(0), x2: X(255), y2: Y(255) }));
  const dzR = mk("rect", { class: "dz", x: X(0), y: Y(255), height: S, width: 0 });
  const area = mk("path", { class: "area" }), path = mk("polyline", { class: "path" });
  const liveL = mk("line", { class: "live-line" }), liveD = mk("circle", { class: "live", r: 4.5 });
  svg.append(dzR, area, path, liveL, liveD);
  const handles = [0, 1, 2].map((k) => {
    const c = mk("circle", { class: "handle", r: 6.5 });
    c.addEventListener("pointerdown", (e) => {
      e.preventDefault(); c.setPointerCapture(e.pointerId); c.classList.add("drag");
      const move = (ev) => {
        const r = svg.getBoundingClientRect(), sx = W / r.width;
        const vx = (((ev.clientX - r.left) * sx - pad) / S) * 255, vy = ((W - pad - (ev.clientY - r.top) * sx) / S) * 255;
        const lo = k === 0 ? 0 : j.curveValues[(k - 1) * 2] + 1, hi = k === 2 ? 255 : j.curveValues[(k + 1) * 2] - 1;
        j.curveValues[k * 2] = Math.round(Math.max(lo, Math.min(hi, vx)));
        j.curveValues[k * 2 + 1] = Math.round(Math.max(0, Math.min(255, vy)));
        draw(); syncRaw(); meta(); changed();
      };
      const up = () => { c.classList.remove("drag"); c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", up); };
      c.addEventListener("pointermove", move); c.addEventListener("pointerup", up);
    });
    svg.append(c);
    return c;
  });
  const pts = () => { const c = j.curveValues; return [[0, 0], [c[0], c[1]], [c[2], c[3]], [c[4], c[5]], [255, 255]]; };
  function draw() {
    const p = pts();
    path.setAttribute("points", p.map(([x, y]) => `${X(x)},${Y(y)}`).join(" "));
    area.setAttribute("d", `M${X(0)},${Y(0)} ` + p.map(([x, y]) => `L${X(x)},${Y(y)}`).join(" ") + ` L${X(255)},${Y(0)} Z`);
    dzR.setAttribute("width", Math.max(0, X(j.curveValues[1] === 0 ? j.curveValues[0] : 0) - X(0)));
    handles.forEach((h, k) => { h.setAttribute("cx", X(j.curveValues[k * 2])); h.setAttribute("cy", Y(j.curveValues[k * 2 + 1])); });
  }
  card._live = (mag, x, y) => {
    const p = pts(); let out = 255;
    for (let i = 1; i < p.length; i++) { const [x0, y0] = p[i - 1], [x1, y1] = p[i]; if (mag <= x1) { out = x1 === x0 ? y1 : y0 + ((mag - x0) / (x1 - x0)) * (y1 - y0); break; } }
    liveD.setAttribute("cx", X(mag)); liveD.setAttribute("cy", Y(out));
    liveL.setAttribute("x1", X(mag)); liveL.setAttribute("x2", X(mag)); liveL.setAttribute("y1", Y(0)); liveL.setAttribute("y2", Y(out));
    const dot = $(".joy i", card); dot.style.left = (x / 255) * 100 + "%"; dot.style.top = (y / 255) * 100 + "%";
  };
  draw();
  $(".curve-host", card).append(svg);
}

// ============================================================ TRIGGERS
function renderTriggers() {
  const box = $("#triggers");
  box.innerHTML = `<div class="trig-top"><span class="muted">Defina a faixa útil de cada gatilho. Ele só responde a partir do início e chega a 100% no fim da faixa.</span>
      <span class="toggle ${state.trigLink ? "on" : ""}" id="trig-link"><i></i>Mesma configuração para L2 e R2</span></div>
    <div class="grid2"><div class="card" id="trig-left"></div><div class="card" id="trig-right"></div></div>`;
  $("#trig-link").onclick = () => {
    state.trigLink = !state.trigLink;
    if (state.trigLink) { state.draft.rightTrigger = { ...state.draft.leftTrigger }; changed(); }
    renderTriggers();
  };
  renderTrigger("left"); renderTrigger("right");
}
function renderTrigger(side) {
  const card = $(`#trig-${side}`);
  const k = side === "left" ? "leftTrigger" : "rightTrigger", ok = side === "left" ? "rightTrigger" : "leftTrigger";
  const t = state.draft[k];
  const pct = (v) => Math.round((v / 255) * 100);
  card.innerHTML = `<h4>${G(side === "left" ? "L2" : "R2", 22)} Gatilho ${side === "left" ? "L2" : "R2"}<span class="sub">faixa útil</span></h4>
    <div class="trig-vis"><div class="trig-live"></div><div class="trig-range"></div></div>
    <div class="trig-scale"><span>0</span><span>255</span></div>
    <div class="trig-nums"><div class="trig-num"><span class="cap">De</span><b data-a></b><div class="dim small" data-ap></div></div><span class="dim">→</span><div class="trig-num"><span class="cap">Até</span><b data-b></b><div class="dim small" data-bp></div></div></div>
    <div class="controls">
      <div class="field"><label>Início (zona morta)</label><input type="range" min="0" max="255" data-min></div>
      <div class="field"><label>Fim (gatilho curto)</label><input type="range" min="0" max="255" data-max></div></div>
    <div class="trig-out" data-out>Aperte o gatilho para testar.</div>
    <div class="chips">${[["Completo", 0, 255], ["Gatilho curto", 0, 90], ["Disparo rápido", 0, 30], ["Zona morta 10%", 25, 255]].map(([n, a, b]) => `<button class="chip" data-pr="${a},${b}">${n}</button>`).join("")}</div>`;
  const minI = $("[data-min]", card), maxI = $("[data-max]", card), range = $(".trig-range", card);
  const sync = () => {
    range.style.left = (t.min / 255) * 100 + "%"; range.style.width = ((t.max - t.min) / 255) * 100 + "%";
    $("[data-a]", card).textContent = t.min; $("[data-b]", card).textContent = t.max;
    $("[data-ap]", card).textContent = pct(t.min) + "%"; $("[data-bp]", card).textContent = pct(t.max) + "%";
    minI.value = t.min; maxI.value = t.max; setRangeFill(minI); setRangeFill(maxI);
  };
  const link = () => { if (state.trigLink) { state.draft[ok] = { ...t }; const o = $(`#trig-${side === "left" ? "right" : "left"}`); o._sync?.(state.draft[ok]); } };
  minI.oninput = () => { t.min = Math.min(Number(minI.value), t.max - 1); sync(); link(); changed(); };
  maxI.oninput = () => { t.max = Math.max(Number(maxI.value), t.min + 1); sync(); link(); changed(); };
  $$("[data-pr]", card).forEach((c) => (c.onclick = () => { const [a, b] = c.dataset.pr.split(",").map(Number); t.min = a; t.max = b; sync(); link(); changed(); }));
  card._sync = (nt) => { Object.assign(t, nt); state.draft[k] = t; sync(); };
  card._live = (v) => {
    $(".trig-live", card).style.width = (v / 255) * 100 + "%";
    const eff = v <= t.min ? 0 : v >= t.max ? 100 : Math.round(((v - t.min) / (t.max - t.min)) * 100);
    $("[data-out]", card).innerHTML = `Pressão física <b>${pct(v)}%</b> → saída <b>${eff}%</b>`;
  };
  sync();
}

// ============================================================ PRESETS
function renderPresets() {
  const box = $("#presets");
  const cats = ["Todos", ...new Set(PRESETS.map((p) => p.cat)), "Meus perfis"];
  const count = (c) => (c === "Todos" ? PRESETS.length : c === "Meus perfis" ? state.library.length : PRESETS.filter((p) => p.cat === c).length);
  const mine = state.library.filter((p) => !(isLib() && p.id === state.selected.id)).map((p) => ({
    cat: "Meus perfis", name: p.label || "Sem nome", d: summary(p), mine: p,
    left: null, right: null, tags: ["Biblioteca"],
  }));
  const list = state.presetCat === "Todos" ? PRESETS : state.presetCat === "Meus perfis" ? mine : PRESETS.filter((p) => p.cat === state.presetCat);
  const viz = (pr) => {
    const lc = pr.mine ? curvePts(pr.mine.leftJoystick) : presetPreviewCurve(pr.left);
    const rc = pr.mine ? curvePts(pr.mine.rightJoystick) : presetPreviewCurve(pr.right);
    const l2 = pr.mine ? [pr.mine.leftTrigger.min, pr.mine.leftTrigger.max] : pr.l2 || [0, 255];
    const r2 = pr.mine ? [pr.mine.rightTrigger.min, pr.mine.rightTrigger.max] : pr.r2 || [0, 255];
    const cv = (pts, keep) => `<svg width="100%" height="40" viewBox="0 0 100 40" preserveAspectRatio="none"><path d="${curvePath(pts, 100, 40)}" fill="none" stroke="${keep ? "var(--line2)" : "var(--ac)"}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
    const tb = (r, keep) => `<div class="tb"><i style="left:${(r[0] / 255) * 100}%;width:${((r[1] - r[0]) / 255) * 100}%;${keep ? "background:var(--line2)" : ""}"></i></div>`;
    return `<div class="pviz"><div><div class="cap">Analóg. esq.</div>${cv(lc, !pr.mine && !pr.left)}</div><div><div class="cap">Analóg. dir.</div>${cv(rc, !pr.mine && !pr.right)}</div>
      <div style="flex:.8"><div class="cap">L2 / R2</div>${tb(l2, !pr.mine && !pr.l2)}${tb(r2, !pr.mine && !pr.r2)}</div></div>`;
  };
  const mapChips = (pr) => pr.map ? Object.entries(pr.map).map(([k, v]) => `<span class="chip">${G(PHYS[k].g, 14)}→${G(PHYS[v].g, 14)}</span>`).join("") : "";
  box.innerHTML = `<div class="cats">${cats.map((c) => `<button class="cat ${c === state.presetCat ? "on" : ""}" data-c="${esc(c)}">${esc(c)}<span>${count(c)}</span></button>`).join("")}</div>
    <div class="preset-main">
      <div class="card roll"><div class="dice">🎲</div><div><b>Preset aleatório</b><div class="muted small">Sorteia um preset e aplica no rascunho — nada vai pro controle até você gravar</div></div><div class="spacer"></div>
        <button class="btn" id="roll">Sortear</button></div>
      <div class="pgrid">${list.map((pr, i) => `<div class="card pcard ${pr.hot ? "hot" : ""}" data-i="${i}">
          <div class="ph"><b>${esc(pr.name)}</b>${pr.hot ? `<span class="badge-hot">POPULAR</span>` : ""}<span class="dim">${esc(pr.cat)}</span></div>
          <div class="pd">${esc(pr.d)}</div>${viz(pr)}
          <div class="ptags">${pr.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}${mapChips(pr)}</div>
          <div class="pact"><button class="btn sm ${pr.hot ? "pri" : ""}" data-apply="${i}">Aplicar</button></div></div>`).join("") || `<div class="dim">Nenhum perfil na biblioteca ainda.</div>`}</div>
    </div>`;
  $$(".cat", box).forEach((c) => (c.onclick = () => { state.presetCat = c.dataset.c; renderPresets(); }));
  $$("[data-apply]", box).forEach((b) => (b.onclick = () => applyAny(list[Number(b.dataset.apply)], b.closest(".pcard"))));
  $("#roll").onclick = () => {
    state.presetCat = "Todos"; renderPresets();
    const i = Math.floor(Math.random() * PRESETS.length);
    const card = $(`.pcard[data-i="${i}"]`, box);
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    applyAny(PRESETS[i], card);
  };
}
function curvePts(j) { const c = j.curveValues; return [[c[0], c[1]], [c[2], c[3]], [c[4], c[5]]]; }
function applyAny(pr, card) {
  if (pr.mine) {
    const m = pr.mine;
    for (const k of ["leftJoystick", "rightJoystick", "leftTrigger", "rightTrigger", "buttonMapping"]) state.draft[k] = Proto.clone(m[k]);
  } else applyPreset(state.draft, pr);
  changed();
  card?.classList.add("flash");
  setTimeout(() => card?.classList.remove("flash"), 900);
  toast(`“${pr.name}” aplicado${isLib() ? "" : " — grave no controle para valer"}`, "ok");
}

// ============================================================ MONITOR
const hist = { g: [[], [], []] };
const trails = [[], []];
function buildMonitor() {
  const box = $("#monitor");
  if (box.dataset.built) return;
  box.dataset.built = "1";
  const keys = ["L1", "R1", "L2", "R2", "up", "right", "down", "left", "tri", "cir", "crs", "sq", "L3", "R3", "PL", "PR", "fn", "ps", "opt", "create", "touch", "mute"];
  box.innerHTML = `<div class="mon">
    <div class="card ctrl-card"><div class="cap">Controle</div><div class="ctrl-live" id="m-ctrl"></div>
      <div class="bars2">${["L2", "R2"].map((n) => `<div><div class="bar-h">${G(n, 18)}<b id="m-${n}v">0%</b></div><div class="track"><i id="m-${n}"></i></div></div>`).join("")}</div>
      <div class="btn-grid">${keys.map((k) => `<span data-k="${k}">${G(k, 26)}</span>`).join("")}</div></div>
    <div class="card gyro-card"><div style="display:flex;align-items:center"><div class="cap">Giroscópio e acelerômetro</div><button class="btn sm ghost" id="m-cal" style="margin-left:auto" title="Zera a rotação (o giroscópio acumula pequenos desvios)">⟲ Recentralizar</button></div>
      <div class="gyro-stage"><canvas id="m-3d"></canvas></div>
      <div class="gyro-vals3">
        <div><span class="muted"><span style="color:#ff6b8a">●</span> Inclinação</span><b id="m-pitch">0°</b><button class="inv" data-inv="pitch" title="Inverter eixo">⇅</button></div>
        <div><span class="muted"><span style="color:#6aa8ff">●</span> Giro lateral</span><b id="m-roll">0°</b><button class="inv" data-inv="roll" title="Inverter eixo">⇄</button></div>
        <div><span class="muted"><span style="color:#2fd08a">●</span> Rotação</span><b id="m-yaw">0°</b><button class="inv" data-inv="yaw" title="Inverter eixo">↻</button></div>
      </div>
      <svg class="spark" viewBox="0 0 240 50" preserveAspectRatio="none"><path id="m-s0" fill="none" stroke="#ff6b8a" stroke-width="1.5"/><path id="m-s1" fill="none" stroke="#2fd08a" stroke-width="1.5"/><path id="m-s2" fill="none" stroke="#6aa8ff" stroke-width="1.5"/></svg>
      <div class="sens-meta"><span id="m-gyro">gyro —</span><span id="m-acc">accel —</span></div></div>
    <div class="card"><div style="display:flex;align-items:center"><div class="cap">Touchpad</div><span class="click-pill" id="m-click">CLIQUE</span></div>
      <div class="tpad" id="m-tpad"><svg viewBox="0 0 1920 1080" preserveAspectRatio="none"><polyline id="m-t0" fill="none" stroke="#f5b84a" stroke-width="8" opacity=".5"/><polyline id="m-t1" fill="none" stroke="#ff8a5c" stroke-width="8" opacity=".5"/></svg>
        <div class="finger f1 hidden" id="m-f0">1</div><div class="finger f2 hidden" id="m-f1">2</div></div>
      <div class="sens-meta"><span id="m-tp0">●1 —</span><span id="m-tp1">●2 —</span><span id="m-side">sem toque</span></div></div>
    <div class="card wide"><div class="sticks-row">
      ${["L", "R"].map((s) => `<div class="one"><div class="joy" id="m-j${s}"><i></i></div><div><div style="display:flex;gap:6px;align-items:center">${G(s + "3", 18)}<b>${s === "L" ? "Esquerdo" : "Direito"}</b></div><div class="dim small" id="m-j${s}v">—</div></div></div>`).join("")}
      <div class="vsep"></div><div style="display:flex;flex-direction:column;gap:6px"><button class="btn sm" id="m-rw">Vibrar fraco</button><button class="btn sm" id="m-rs">Vibrar forte</button></div></div></div>
    <div class="card" style="grid-column:1 / -1"><div class="cap" style="margin-bottom:6px">Report bruto (USB 0x01)</div><div class="rawhex" id="m-raw">—</div></div>
  </div>`;
  $("#m-cal").onclick = () => { call("resetYaw").catch(() => {}); state.yawOffset = state.yaw; };
  model3d = new Controller3D($("#m-3d"));
  const syncInv = () => $$("#monitor .inv").forEach((b) => b.classList.toggle("on", !!state.invert[b.dataset.inv]));
  $$("#monitor .inv").forEach((b) => (b.onclick = () => { state.invert[b.dataset.inv] = !state.invert[b.dataset.inv]; syncInv(); saveState().catch(() => {}); }));
  syncInv();
  $("#m-rw").onclick = () => call("rumble", { strength: 60, ms: 300 }).catch((e) => toast(e.message, "err"));
  $("#m-rs").onclick = () => call("rumble", { strength: 255, ms: 400 }).catch((e) => toast(e.message, "err"));
}
let lastCtrlPaint = 0;
let model3d = null;
function paintMonitor(i) {
  const now = performance.now();
  const pressed = pressedSet(i);
  const hl = {};
  pressed.forEach((x) => (hl[INDEX_TO_PART[x]] = "#2fd08a"));
  if (i.touchpad) hl.touch = "#f5b84a";
  if (i.ps) hl.ps = "#2fd08a"; if (i.options) hl.opt = "#2fd08a"; if (i.create) hl.create = "#2fd08a";
  if (i.fnL) hl.fnl = "#2fd08a"; if (i.fnR) hl.fnr = "#2fd08a"; if (i.mute) hl.mute = "#2fd08a";
  const touches = i.touches.filter((t) => t.active).map((t) => ({ x: t.x / 1920, y: t.y / 1080 }));
  if (now - lastCtrlPaint > 33) {
    lastCtrlPaint = now;
    const n = (v) => (v - 128) / 128;
    $("#m-ctrl").innerHTML = controllerSvg({ ...COLORS, hl, ls: [n(i.lx), n(i.ly)], rs: [n(i.rx), n(i.ry)], touches });
  }
  for (const [k, v] of [["L2", i.l2], ["R2", i.r2]]) {
    const el = $(`#m-${k}`); el.style.width = (v / 255) * 100 + "%"; el.classList.toggle("hi", v > 128);
    $(`#m-${k}v`).textContent = Math.round((v / 255) * 100) + "%";
  }
  const on = { L1: i.l1, R1: i.r1, L2: i.l2b || i.l2 > 40, R2: i.r2b || i.r2 > 40, up: pressed.has(0), right: pressed.has(1), down: pressed.has(2), left: pressed.has(3),
    tri: i.triangle, cir: i.circle, crs: i.cross, sq: i.square, L3: i.l3, R3: i.r3, PL: i.paddleL, PR: i.paddleR, fn: i.fnL || i.fnR, ps: i.ps, opt: i.options, create: i.create, touch: i.touchpad, mute: i.mute };
  $$("#monitor .btn-grid [data-k]").forEach((s) => s.firstElementChild.classList.toggle("on", !!on[s.dataset.k]));

  // motion — pitch/roll from gravity (accelerometer, smoothed), yaw from the integrated gyro
  const [ax, ay, az] = i.accel;
  const sgn = (k) => (state.invert[k] ? -1 : 1);
  const rawPitch = (Math.atan2(az, ay) * 180) / Math.PI, rawRoll = (Math.atan2(-ax, ay) * 180) / Math.PI;
  const tgt = { pitch: -rawPitch * sgn("pitch"), roll: rawRoll * sgn("roll"), yaw: ((state.yaw || 0) - (state.yawOffset || 0)) * sgn("yaw") };
  const P = (state.pose ||= { ...tgt });
  for (const k of ["pitch", "roll"]) P[k] += (tgt[k] - P[k]) * 0.35;
  P.yaw = tgt.yaw;
  const deg = (v) => { const r = Math.round(v); return `${r > 0 ? "+" : ""}${r === 0 ? 0 : r}°`; };
  $("#m-pitch").textContent = deg(P.pitch);
  $("#m-roll").textContent = deg(P.roll);
  $("#m-yaw").textContent = deg((((P.yaw % 360) + 540) % 360) - 180);
  if (model3d) {
    const n = (v) => (v - 128) / 128;
    model3d.set({ pose: { pitch: P.pitch, roll: P.roll, yaw: P.yaw }, ls: [n(i.lx), n(i.ly)], rs: [n(i.rx), n(i.ry)], l2: (i.l2 || 0) / 255, r2: (i.r2 || 0) / 255, hl });
    model3d.render();
  }
  const dps = i.gyro.map((g) => g / 16.4);
  dps.forEach((v, k) => { hist.g[k].push(v); if (hist.g[k].length > 120) hist.g[k].shift(); });
  hist.g.forEach((arr, k) => $(`#m-s${k}`).setAttribute("d", arr.map((v, x) => `${x ? "L" : "M"}${x * 2},${(25 - Math.max(-24, Math.min(24, v / 12))).toFixed(1)}`).join(" ")));
  $("#m-gyro").textContent = `gyro ${dps.map((v) => Math.round(v) || 0).join(" · ")} °/s`;
  $("#m-acc").textContent = `accel ${i.accel.map((v) => (v / 8192).toFixed(2)).join(" · ")} g`;

  // touchpad
  $("#m-tpad").classList.toggle("click", i.touchpad);
  $("#m-click").classList.toggle("on", i.touchpad);
  i.touches.forEach((t, k) => {
    const f = $(`#m-f${k}`);
    if (t.active) {
      f.classList.remove("hidden");
      f.style.left = (t.x / 1920) * 100 + "%"; f.style.top = (t.y / 1080) * 100 + "%";
      trails[k].push(`${t.x},${t.y}`); if (trails[k].length > 30) trails[k].shift();
      $(`#m-tp${k}`).textContent = `●${k + 1} x ${t.x} · y ${t.y}`;
    } else {
      f.classList.add("hidden"); trails[k] = [];
      $(`#m-tp${k}`).textContent = `●${k + 1} —`;
    }
    $(`#m-t${k}`).setAttribute("points", trails[k].join(" "));
  });
  const act = i.touches.filter((t) => t.active);
  $("#m-side").textContent = !act.length ? "sem toque" : act.length === 2 ? "2 dedos" : act[0].x < 960 ? "lado esquerdo" : "lado direito";

  // sticks
  for (const [s, x, y, c] of [["L", i.lx, i.ly, i.l3], ["R", i.rx, i.ry, i.r3]]) {
    const j = $(`#m-j${s}`); j.classList.toggle("click", c);
    const dot = j.firstElementChild; dot.style.left = (x / 255) * 100 + "%"; dot.style.top = (y / 255) * 100 + "%";
    $(`#m-j${s}v`).textContent = `X ${x} · Y ${y} · intensidade ${Math.min(100, Math.round(Math.hypot(x - 128, y - 128) / 1.28))}%`;
  }
  $("#m-raw").textContent = i.raw.map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

// ============================================================ live input
let rafPending = false;
function onInput(data, yaw, rate) {
  const i = Proto.parseInput(data);
  Diag.feed(i, rate);
  const prev = state.input;
  state.input = i;
  if (typeof yaw === "number") state.yaw = yaw;
  // FN + face → active slot
  if ((i.fnL || i.fnR)) {
    const sel = i.triangle ? 0x63 : i.square ? 0x60 : i.cross ? 0x61 : i.circle ? 0x62 : null;
    if (sel != null && sel !== state.activeSelector) { state.activeSelector = sel; saveState().catch(() => {}); renderRail(); renderTop(); }
  }
  // "press the button on the controller" while the picker is open
  if (state.picker != null && state.tab === "buttons" && prev && !(i.fnL || i.fnR) && performance.now() - pickerOpenedAt > 350) {
    const now = pressedSet(i, true), before = pressedSet(prev, true);
    for (const x of now) if (!before.has(x) && x <= 13) { assign(state.picker, x); break; }
  }
  if (!rafPending) { rafPending = true; requestAnimationFrame(paintLive); }
}
function paintLive() {
  rafPending = false;
  const i = state.input;
  if (!i) return;
  renderBattery();
  if (state.tab === "monitor") return paintMonitor(i);
  if (state.tab === "diag") return Diag.paint(i);
  if (state.tab === "hw") return HW.paint(i);
  if (!state.draft) return;
  if (state.tab === "buttons") {
    const key = [...pressedSet(i)].join(",");
    if (key !== lastPressedKey) renderButtons();
  } else if (state.tab === "sticks") {
    const mag = (x, y) => Math.min(255, Math.hypot(x - 128, y - 128) * 2);
    $("#stick-left")?._live?.(mag(i.lx, i.ly), i.lx, i.ly);
    $("#stick-right")?._live?.(mag(i.rx, i.ry), i.rx, i.ry);
  } else if (state.tab === "triggers") {
    $("#trig-left")?._live?.(i.l2);
    $("#trig-right")?._live?.(i.r2);
  }
}

// ============================================================ library actions
async function duplicateLib(id) {
  const p = state.library.find((x) => x.id === id);
  const c = Proto.clone(p);
  c.id = Proto.randomId();
  c.label = uniqueName(((p.label || "Perfil") + " (cópia)").slice(0, 40));
  state.library.unshift(c);
  await saveLibrary();
  renderDrawer(); renderRail();
}
async function deleteLib(id) {
  const p = state.library.find((x) => x.id === id);
  if (!(await confirmDialog("Excluir da biblioteca?", `“${p.label}” será removido da biblioteca. O que já está gravado no controle não muda.`, "Excluir", true))) return;
  state.library = state.library.filter((x) => x.id !== id);
  await saveLibrary();
  if (isLib() && state.selected.id === id) goHome(); else { renderDrawer(); renderRail(); }
}
async function saveCurrentToLibrary() {
  if (isLib()) return newProfile({ ...state.draft, label: uniqueName((state.draft.label + " (cópia)").slice(0, 40)) });
  const d = Proto.clone(state.draft);
  d.label = d.label || "Perfil";
  const ex = state.library.findIndex((p) => p.id === d.id);
  if (ex >= 0) {
    if (await confirmDialog("Atualizar perfil da biblioteca?", `“${state.library[ex].label}” já está na biblioteca. Substituir pela versão atual?`, "Substituir")) state.library[ex] = d;
    else { d.id = Proto.randomId(); d.label = uniqueName(d.label); state.library.unshift(d); }
  } else state.library.unshift(d);
  await saveLibrary();
  renderDrawer(); renderRail();
  toast(`“${d.label}” salvo na biblioteca`, "ok");
}
async function exportLib() {
  if (!state.library.length) return toast("A biblioteca está vazia", "err");
  const ok = await call("exportJSON", { text: JSON.stringify(state.library, null, 2), filename: `edge-profiles-${new Date().toISOString().slice(0, 10)}.json` });
  if (ok) toast(`${state.library.length} perfil(is) exportado(s)`, "ok");
}
async function importLib() {
  try {
    const txt = await call("importJSON");
    if (!txt) return;
    const arr = JSON.parse(txt);
    if (!Array.isArray(arr)) throw new Error("formato inválido");
    let n = 0;
    for (const r of arr) { if (!r?.id || r.label == null || state.library.some((p) => p.id === r.id)) continue; state.library.push(normalize(r)); n++; }
    await saveLibrary();
    renderDrawer(); renderRail();
    toast(`${n} perfil(is) importado(s)`, "ok");
  } catch (e) { toast("Importação falhou: " + e.message, "err"); }
}

// ============================================================ wiring
function wire() {
  $("#rail-new").onclick = () => newProfile();
  $("#home-new").onclick = () => newProfile();
  $("#drawer-new").onclick = () => newProfile();
  const toggleDrawer = (v) => { state.drawer = v ?? !state.drawer; if (state.drawer) Backup.close(); renderDrawer(); renderRail(); setTimeout(fitStage, 0); };
  $("#rail-lib").onclick = () => toggleDrawer();
  $("#home-lib").onclick = () => toggleDrawer(true);
  $("#drawer-close").onclick = () => toggleDrawer(false);
  $("#lib-search").oninput = renderDrawer;
  $("#lib-import").onclick = importLib;
  $("#lib-export").onclick = exportLib;
  $("#btn-compare").onclick = () => Compare.toggle(true);
  $("#btn-refresh").onclick = () => trySelect(() => readProfiles(false));
  $("#btn-save").onclick = saveCurrentToLibrary;
  $("#btn-revert").onclick = () => { state.draft = Proto.clone(state.original); state.picker = null; renderAll(); };
  $$(".slot-w").forEach((b) => (b.onclick = () => writeToSlot(Number(b.dataset.sel))));
  $("#name").oninput = (e) => { if (!state.draft) return; state.draft.label = e.target.value.slice(0, 40); changed(); };
  $$("#tabs button").forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; state.picker = null; renderAll(); }));
  document.addEventListener("click", () => { if (state.picker != null) { state.picker = null; renderButtons(); } });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("#modal").classList.contains("hidden")) return $("#modal-cancel").click();
      if (Compare.isOpen()) return Compare.toggle(false);
      if (state.picker != null) { state.picker = null; return renderButtons(); }
      if (state.drawer) toggleDrawer(false);
      Backup.close();
    }
    if (e.metaKey && e.key.toLowerCase() === "n") { e.preventDefault(); newProfile(); }
    if (e.metaKey && e.key.toLowerCase() === "s") { e.preventDefault(); if (state.draft) saveCurrentToLibrary(); }
    if (e.metaKey && /^[1-7]$/.test(e.key)) { e.preventDefault(); state.tab = ["buttons", "sticks", "triggers", "presets", "monitor", "hw", "diag"][Number(e.key) - 1]; state.picker = null; renderAll(); }
  });

  Native.on((evt) => {
    if (evt.type === "input") return onInput(evt.data, evt.yaw, evt.rate);
    if (evt.type !== "input") diag(`event ${JSON.stringify(evt)}`);
    if (evt.type === "status") {
      const was = state.status.connected;
      state.status = evt;
      if (evt.connected && !was) { HW.onConnect(); Diag.resetInfo(); if (!Native.simulated) toast("DualSense Edge conectado", "ok"); readProfiles(true); }
      if (!evt.connected && was) {
        state.slots = null; state.input = null;
        if (state.selected?.kind === "slot" && !isDirty()) goHome();
        toast("Controle desconectado", "err");
      }
      renderAll();
    } else if (evt.type === "error") toast(evt.message, "err");
  });
}

(async function main() {
  wire();
  Backup.wire();
  await loadLibrary();
  await Backup.load();
  HW.load(state.hwSaved);
  try { state.status = await call("status"); } catch {}
  renderAll();
  if (state.status.connected) readProfiles(true);
})();
