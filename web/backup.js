// Backup & history: full backup of the controller slots to a file, and an automatic copy of a slot
// before every write / clear so it can be undone.
// Depends on app.js globals ($, $$, G, esc, state, call, toast, confirmDialog, slotOf, SLOT_GLYPH, ORDER,
// Proto, normalize, strip, readProfiles, renderAll, saveLibrary, uniqueName).
"use strict";

const Backup = (() => {
  const MAX = 60;
  const WRITABLE = [0x60, 0x61, 0x62];
  const SLOT_NAME = { 0x63: "△", 0x60: "□", 0x61: "✕", 0x62: "○" };
  let history = [];
  let open = false;

  const snapshot = (p) => (p && !p.empty ? strip(p) : null);
  const save = () => call("saveFile", { name: "history", text: JSON.stringify(history) }).catch(() => {});

  async function load() {
    try { const t = await call("loadFile", { name: "history" }); history = t ? JSON.parse(t) : []; } catch { history = []; }
    if (!Array.isArray(history)) history = [];
  }

  // keep a copy of what is in the slot right now, before it gets replaced
  async function record(sel, reason) {
    const cur = slotOf(sel);
    if (!state.slots || !cur) return;
    const snap = snapshot(cur);
    const last = history[0];
    // don't stack identical copies of the same slot
    if (last && last.selector === sel && JSON.stringify(last.profile) === JSON.stringify(snap)) return;
    history.unshift({ id: Proto.randomId(), at: Date.now(), selector: sel, reason, profile: snap });
    history = history.slice(0, MAX);
    await save();
    if (open) render();
  }

  // write a profile (or clear the slot when profile is null), recording the current content first
  async function putSlot(sel, profile, reason) {
    const cur = slotOf(sel);
    if (!profile && (!cur || cur.empty)) return;                                          // already empty
    if (profile && cur && !cur.empty && JSON.stringify(strip(cur)) === JSON.stringify(profile)) return;   // already identical
    await record(sel, reason);
    if (profile) await call("writeFeatures", { reports: Proto.encode(normalize(Proto.clone(profile)), sel) });
    else if (!slotOf(sel)?.empty) await call("writeFeatures", { reports: [Proto.clearReport(sel)] });
  }

  // ---------------------------------------------------------------- full backup
  async function exportAll() {
    if (!state.status.connected) return toast(T("Conecte o controle pelo cabo USB para fazer o backup."), "err");
    try {
      state.slots = Proto.parseAll(await call("readProfiles"));
      const slots = {};
      for (const sel of ORDER) slots[SLOT_GLYPH[sel]] = snapshot(slotOf(sel));
      const doc = { format: "dualsense-edge-studio-backup", version: 1, createdAt: new Date().toISOString(), slots };
      const d = new Date(), pad = (n) => String(n).padStart(2, "0");
      const ok = await call("exportJSON", { text: JSON.stringify(doc, null, 2), filename: `edge-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json` });
      if (ok) toast(T("Backup dos 4 slots salvo"), "ok");
    } catch (e) { toast(T("Falha no backup: {err}", { err: e.message }), "err"); }
  }

  async function restoreFile() {
    if (!state.status.connected) return toast(T("Conecte o controle pelo cabo USB para restaurar."), "err");
    let doc;
    try {
      const txt = await call("importJSON");
      if (!txt) return;
      doc = JSON.parse(txt);
      if (doc?.format !== "dualsense-edge-studio-backup" || !doc.slots) throw new Error(T("este arquivo não é um backup do DualSense Edge Studio"));
    } catch (e) { return toast(T("Não foi possível abrir: {err}", { err: e.message }), "err"); }
    const plan = WRITABLE.map((sel) => ({ sel, p: doc.slots[SLOT_GLYPH[sel]] || null }));
    const when = doc.createdAt ? new Date(doc.createdAt).toLocaleString(I18N.locale) : T("data desconhecida");
    const lines = plan.map(({ sel, p }) => `FN + ${SLOT_NAME[sel]}: ${p ? `“${p.label}”` : T("vazio (o slot será limpo)")}`).join(" · ");
    const ok = await confirmDialog(T("Restaurar este backup?"), T("Backup de {when}. {lines}. O slot △ (padrão) não pode ser gravado e fica como está. O conteúdo atual de cada slot vai para o histórico, então dá para desfazer.", { when, lines }), T("Restaurar"));
    if (!ok) return;
    try {
      state.busy = true;
      for (const { sel, p } of plan) await putSlot(sel, p, T("antes de restaurar um backup"));
      call("rumble", { strength: 90, ms: 180 }).catch(() => {});
      await readProfiles(true);
      toast(T("Backup restaurado no controle"), "ok");
    } catch (e) { toast(T("Falha ao restaurar: {err}", { err: e.message }), "err"); }
    state.busy = false;
    renderAll();
  }

  // ---------------------------------------------------------------- history actions
  async function restoreEntry(id) {
    const h = history.find((x) => x.id === id);
    if (!h) return;
    if (!state.status.connected) return toast(T("Conecte o controle pelo cabo USB."), "err");
    if (!WRITABLE.includes(h.selector)) return toast(T("O slot △ não pode ser gravado."), "err");
    const now = slotOf(h.selector);
    const replacing = now && !now.empty;
    const body = h.profile
      ? (replacing
        ? T("“{name}” volta para o slot, no lugar de “{cur}”. O conteúdo atual também vai para o histórico.", { name: h.profile.label, cur: now.label })
        : T("“{name}” volta para o slot. O conteúdo atual também vai para o histórico.", { name: h.profile.label }))
      : (replacing
        ? T("O slot volta a ficar vazio, no lugar de “{cur}”. O conteúdo atual também vai para o histórico.", { cur: now.label })
        : T("O slot volta a ficar vazio. O conteúdo atual também vai para o histórico."));
    const ok = await confirmDialog(T("Desfazer no slot FN + {g}?", { g: SLOT_NAME[h.selector] }), body, T("Restaurar"));
    if (!ok) return;
    try {
      await putSlot(h.selector, h.profile, T("antes de desfazer"));
      call("rumble", { strength: 90, ms: 180 }).catch(() => {});
      await readProfiles(true);
      toast(T("Slot restaurado"), "ok");
    } catch (e) { toast(T("Falha ao restaurar: {err}", { err: e.message }), "err"); }
    renderAll();
  }
  async function toLibrary(id) {
    const h = history.find((x) => x.id === id);
    if (!h?.profile) return;
    const p = normalize(Proto.clone(h.profile));
    p.id = Proto.randomId();
    p.label = uniqueName(h.profile.label || T("Perfil"));
    state.library.unshift(p);
    await saveLibrary();
    renderAll();
    toast(T("“{name}” salvo na biblioteca", { name: p.label }), "ok");
  }
  async function clearHistory() {
    if (!history.length) return;
    if (!(await confirmDialog(T("Apagar o histórico?"), T("As cópias guardadas antes de cada gravação serão apagadas. Os slots do controle e a biblioteca não mudam."), T("Apagar"), true))) return;
    history = []; await save(); render();
  }

  // ---------------------------------------------------------------- UI
  const ago = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return T("agora");
    if (s < 3600) return T("há {n} min", { n: Math.round(s / 60) });
    if (s < 86400) return T("há {n} h", { n: Math.round(s / 3600) });
    return new Date(t).toLocaleDateString(I18N.locale, { day: "2-digit", month: "short" }) + " " + new Date(t).toLocaleTimeString(I18N.locale, { hour: "2-digit", minute: "2-digit" });
  };
  function render() {
    const box = $("#bdrawer");
    box.classList.toggle("hidden", !open);
    $("#rail-backup")?.classList.toggle("on", open);
    if (!open) return;
    const list = history.map((h) => `
      <div class="hist-item" data-id="${esc(h.id)}">
        <div class="ico">${G(SLOT_GLYPH[h.selector], 18)}</div>
        <div class="tx"><b>${h.profile ? esc(h.profile.label || T("Sem nome")) : `<i>${T("slot vazio")}</i>`}</b><span>${esc(ago(h.at))} · ${esc(h.reason)}</span></div>
        ${WRITABLE.includes(h.selector) ? `<button class="icon-btn" data-act="undo" title="${T("Voltar este conteúdo para o slot FN + {g}", { g: SLOT_NAME[h.selector] })}"><svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/></svg></button>` : ""}
        ${h.profile ? `<button class="icon-btn" data-act="lib" title="${T("Salvar uma cópia na biblioteca")}"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>` : ""}
      </div>`).join("");
    $("#hist-list").innerHTML = list || `<div class="lib-empty">${T("Ainda vazio. Sempre que você gravar, limpar ou restaurar um slot, o conteúdo anterior aparece aqui para poder ser desfeito.")}</div>`;
    $("#hist-count").textContent = history.length ? `${history.length}` : "";
    $$("#hist-list .hist-item").forEach((el) => {
      el.onclick = (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "undo") restoreEntry(el.dataset.id);
        if (act === "lib") toLibrary(el.dataset.id);
      };
    });
  }
  function toggle(v) { open = v ?? !open; if (open && state.drawer) { state.drawer = false; renderDrawer(); renderRail(); } render(); setTimeout(fitStage, 0); }
  function close() { if (open) toggle(false); }
  function wire() {
    $("#rail-backup").onclick = () => toggle();
    $("#bdrawer-close").onclick = () => toggle(false);
    $("#bk-export").onclick = exportAll;
    $("#bk-restore").onclick = restoreFile;
    $("#hist-clear").onclick = clearHistory;
  }

  return { load, record, wire, toggle, close, isOpen: () => open, render, entries: () => history };
})();
