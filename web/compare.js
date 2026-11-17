// Compare two profiles side by side (open profile, controller slots, library, history copies)
// and copy parts of B into the open profile.
// Depends on app.js globals ($, $$, G, esc, state, slotOf, ORDER, SLOT_GLYPH, Proto, normalize, strip, changed,
// renderAll, curvePts, toast) and controller.js (PHYS, curvePath), backup.js (Backup).
"use strict";

const Compare = (() => {
  const SLOT_NAME = { 0x63: "△", 0x60: "□", 0x61: "✕", 0x62: "○" };
  const c = { open: false, a: null, b: null, onlyDiff: true };

  // ---------------------------------------------------------------- sources
  function sources() {
    const out = [];
    if (state.draft) out.push({ key: "draft", group: "Aberto agora", label: `Perfil aberto · ${state.draft.label || "Sem nome"}` });
    if (state.slots) for (const sel of ORDER) {
      const p = slotOf(sel);
      if (p && !p.empty) out.push({ key: `slot:${sel}`, group: "Controle", label: `FN + ${SLOT_NAME[sel]} · ${p.label || "Sem nome"}` });
    }
    for (const p of state.library) out.push({ key: `lib:${p.id}`, group: "Biblioteca", label: p.label || "Sem nome" });
    for (const h of Backup.entries()) if (h.profile) {
      const d = new Date(h.at);
      out.push({ key: `hist:${h.id}`, group: "Histórico", label: `${h.profile.label || "Sem nome"} · FN + ${SLOT_NAME[h.selector]} · ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` });
    }
    return out;
  }
  function profileOf(key) {
    if (!key) return null;
    if (key === "draft") return state.draft;   // live object: copies go straight into it
    const [kind, id] = key.split(/:(.*)/s);
    let p = null;
    if (kind === "slot") p = slotOf(Number(id));
    if (kind === "lib") p = state.library.find((x) => x.id === id);
    if (kind === "hist") p = Backup.entries().find((x) => x.id === id)?.profile;
    return p && !p.empty ? normalize(strip(p)) : null;
  }
  function defaults() {
    const list = sources();
    const keys = list.map((s) => s.key);
    if (!keys.includes(c.a)) c.a = keys[0] || null;
    if (!keys.includes(c.b) || c.b === c.a) {
      // the open slot vs its version on the controller is the most useful default
      const sel = state.selected?.kind === "slot" ? `slot:${state.selected.selector}` : null;
      c.b = (sel && sel !== c.a && keys.includes(sel)) ? sel : keys.find((k) => k !== c.a) || null;
    }
  }

  // ---------------------------------------------------------------- helpers
  const stickInfo = (j) => {
    const pr = Proto.STICK_PRESETS[j.profileId];
    const fixed = pr.adj.every((a) => a.length === 1);
    const idx = Proto.detectIndex(j.profileId, j.curveValues);
    return { name: pr.name, intensity: fixed ? "—" : idx == null ? "personalizada" : String(idx), dz: Proto.deadzoneOf(j.curveValues) + "%" };
  };
  const sameStick = (x, y) => x.profileId === y.profileId && JSON.stringify(x.curveValues) === JSON.stringify(y.curveValues);
  const sameTrig = (x, y) => x.min === y.min && x.max === y.max;
  const mapLabel = (i, t) => {
    if (t === i) return `<span class="dim">${i >= 14 ? "Sem função" : "Padrão"}</span>`;
    return `${G(PHYS[t]?.g || "none", 16)} ${esc(PHYS[t]?.name || "Código " + t)}`;
  };
  function diffs(A, B) {
    const btn = A.buttonMapping.buttons.map((t, i) => (t !== B.buttonMapping.buttons[i] ? i : -1)).filter((i) => i >= 0);
    return {
      left: !sameStick(A.leftJoystick, B.leftJoystick), right: !sameStick(A.rightJoystick, B.rightJoystick),
      l2: !sameTrig(A.leftTrigger, B.leftTrigger), r2: !sameTrig(A.rightTrigger, B.rightTrigger), btn,
    };
  }

  // ---------------------------------------------------------------- render
  function render() {
    const box = $("#cmp");
    box.classList.toggle("hidden", !c.open);
    if (!c.open) return;
    defaults();
    const list = sources();
    const opts = (sel) => {
      const groups = [...new Set(list.map((s) => s.group))];
      return groups.map((g) => `<optgroup label="${esc(g)}">${list.filter((s) => s.group === g).map((s) => `<option value="${esc(s.key)}" ${s.key === sel ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</optgroup>`).join("");
    };
    const A = profileOf(c.a), B = profileOf(c.b);
    // copying goes into A: the open profile, or a slot / library profile (opened in the editor on first copy)
    const canCopy = !!B && (c.a === "draft" || c.a.startsWith("slot:") || c.a.startsWith("lib:"));
    let body = "";
    if (!A || !B) body = `<div class="cmp-empty">Escolha dois perfis para comparar.</div>`;
    else {
      const d = diffs(A, B);
      const total = [d.left, d.right, d.l2, d.r2].filter(Boolean).length + d.btn.length;
      const copyBtn = (what, label = "Copiar B → A") => (canCopy ? `<button class="btn sm" data-copy="${what}">${label}</button>` : "");
      const chip = (on, txt) => `<span class="cmp-chip ${on ? "diff" : "same"}">${on ? "≠" : "="} ${txt}</span>`;

      const stickCol = (key, side) => {
        const ja = A[key], jb = B[key], ia = stickInfo(ja), ib = stickInfo(jb), diff = !sameStick(ja, jb);
        const row = (n, va, vb) => `<tr class="${va !== vb ? "d" : ""}"><td>${n}</td><td>${esc(va)}</td><td>${esc(vb)}</td></tr>`;
        return `<div class="cmp-card ${diff ? "has-diff" : ""}">
          <div class="cmp-card-h">${G(side === "left" ? "L3" : "R3", 20)}<b>Analógico ${side === "left" ? "esquerdo" : "direito"}</b>${chip(diff, diff ? "diferente" : "igual")}<span class="sp"></span>${diff ? copyBtn(side) : ""}</div>
          <div class="cmp-stick"><svg viewBox="0 0 160 160" class="cmp-curve">
              <path d="M0,160 L160,0" class="diag"/><path d="${curvePath(curvePts(jb), 160, 160)}" class="cb"/><path d="${curvePath(curvePts(ja), 160, 160)}" class="ca"/></svg>
            <table class="cmp-t"><thead><tr><th></th><th><i class="ka"></i>A</th><th><i class="kb"></i>B</th></tr></thead><tbody>
              ${row("Curva", ia.name, ib.name)}${row("Intensidade", ia.intensity, ib.intensity)}${row("Zona morta", ia.dz, ib.dz)}</tbody></table></div></div>`;
      };
      const trigRow = (key, name, diff) => {
        const ta = A[key], tb = B[key];
        const bar = (t, cls) => `<div class="cmp-tb"><i class="${cls}" style="left:${(t.min / 255) * 100}%;width:${((t.max - t.min) / 255) * 100}%"></i></div>`;
        return `<div class="cmp-trig ${diff ? "d" : ""}"><div class="cmp-trig-n">${G(name, 18)}<b>${name}</b></div>
          <div class="cmp-trig-bars">${bar(ta, "ka")}${bar(tb, "kb")}</div>
          <div class="cmp-trig-v"><span><i class="ka"></i>${ta.min}–${ta.max}</span><span><i class="kb"></i>${tb.min}–${tb.max}</span></div>
          <div class="cmp-trig-a">${diff ? copyBtn(key === "leftTrigger" ? "l2" : "r2") : chip(false, "igual")}</div></div>`;
      };
      const rows = A.buttonMapping.buttons.map((ta, i) => ({ i, ta, tb: B.buttonMapping.buttons[i] })).filter((r) => !c.onlyDiff || r.ta !== r.tb);

      body = `
        <div class="cmp-sum"><b>${total ? `${total} diferença${total > 1 ? "s" : ""}` : "Os dois perfis são iguais"}</b>
          ${chip(d.left, "analógico esq.")}${chip(d.right, "analógico dir.")}${chip(d.l2 || d.r2, "gatilhos")}${chip(d.btn.length > 0, d.btn.length ? `${d.btn.length} botão(ões)` : "botões")}
          <span class="sp"></span>${canCopy && total ? `<button class="btn sm pri" data-copy="all">Copiar tudo de B → A</button>` : ""}</div>
        <div class="cmp-hint">${canCopy ? (c.a === "draft" ? "As cópias vão para o perfil aberto. Nada é gravado no controle até você clicar em “Gravar em”." : "Ao copiar, A é aberto no editor e recebe a parte de B. Nada é gravado no controle até você clicar em “Gravar em”.") : "Uma cópia do histórico não pode ser editada. Escolha em A um slot, um perfil da biblioteca ou o perfil aberto."}</div>
        <div class="cmp-grid">${stickCol("leftJoystick", "left")}${stickCol("rightJoystick", "right")}</div>
        <div class="cmp-card"><div class="cmp-card-h">${G("R2", 20)}<b>Gatilhos</b><span class="dim small">faixa útil</span></div>
          ${trigRow("leftTrigger", "L2", d.l2)}${trigRow("rightTrigger", "R2", d.r2)}</div>
        <div class="cmp-card"><div class="cmp-card-h">${G("crs", 20)}<b>Botões</b>${chip(d.btn.length > 0, d.btn.length ? `${d.btn.length} diferente(s)` : "iguais")}
            <span class="sp"></span><span class="toggle ${c.onlyDiff ? "on" : ""}" id="cmp-only"><i></i>Só diferenças</span>${d.btn.length ? copyBtn("buttons", "Copiar todos B → A") : ""}</div>
          ${rows.length ? `<table class="cmp-bt"><thead><tr><th>Botão</th><th><i class="ka"></i>A</th><th><i class="kb"></i>B</th><th></th></tr></thead><tbody>
            ${rows.map((r) => `<tr class="${r.ta !== r.tb ? "d" : ""}"><td>${G(PHYS[r.i].g, 18)} ${esc(PHYS[r.i].name)}</td><td>${mapLabel(r.i, r.ta)}</td><td>${mapLabel(r.i, r.tb)}</td><td>${r.ta !== r.tb && canCopy ? `<button class="btn sm ghost" data-copy="btn:${r.i}">Copiar B → A</button>` : ""}</td></tr>`).join("")}</tbody></table>`
          : `<div class="dim small" style="padding:6px 2px">Nenhum botão remapeado de forma diferente.</div>`}</div>`;
    }
    box.innerHTML = `<div class="cmp-win">
      <div class="cmp-head"><div><b>Comparar perfis</b><div class="dim small">A diferença aparece destacada. Use “Copiar B → A” para levar uma parte de B para A, ou ⇄ para inverter os lados.</div></div>
        <button class="icon-btn" id="cmp-close" title="Fechar (Esc)">✕</button></div>
      <div class="cmp-pick">
        <label class="cmp-sel"><span class="tag ka">A</span><select id="cmp-a">${opts(c.a)}</select></label>
        <button class="icon-btn" id="cmp-swap" title="Trocar A e B">⇄</button>
        <label class="cmp-sel"><span class="tag kb">B</span><select id="cmp-b">${opts(c.b)}</select></label>
      </div>
      <div class="cmp-body">${body}</div></div>`;

    $("#cmp-close").onclick = () => toggle(false);
    $("#cmp-a").onchange = (e) => { c.a = e.target.value; render(); };
    $("#cmp-b").onchange = (e) => { c.b = e.target.value; render(); };
    $("#cmp-swap").onclick = () => { [c.a, c.b] = [c.b, c.a]; render(); };
    const only = $("#cmp-only"); if (only) only.onclick = () => { c.onlyDiff = !c.onlyDiff; render(); };
    $$("[data-copy]", box).forEach((b) => (b.onclick = () => copy(b.dataset.copy, B)));
    box.onclick = (e) => { if (e.target === box) toggle(false); };
  }

  async function copy(what, B) {
    if (!B) return;
    if (c.a !== "draft") {
      // open A in the editor first (asks before discarding unsaved changes)
      if (!(await guard())) return;
      const [kind, id] = c.a.split(/:(.*)/s);
      if (kind === "slot") openSlot(Number(id)); else openLib(id);
      c.a = "draft";
    }
    const D = state.draft;
    if (!D) return;
    const cl = (x) => JSON.parse(JSON.stringify(x));
    if (what === "left" || what === "all") D.leftJoystick = cl(B.leftJoystick);
    if (what === "right" || what === "all") D.rightJoystick = cl(B.rightJoystick);
    if (what === "l2" || what === "all") D.leftTrigger = cl(B.leftTrigger);
    if (what === "r2" || what === "all") D.rightTrigger = cl(B.rightTrigger);
    if (what === "buttons" || what === "all") D.buttonMapping = cl(B.buttonMapping);
    if (what.startsWith("btn:")) { const i = Number(what.slice(4)); D.buttonMapping.buttons[i] = B.buttonMapping.buttons[i]; }
    changed();
    render();
    toast(`Copiado para “${D.label || "perfil"}” (ainda não gravado no controle)`, "ok");
  }

  function toggle(v) {
    c.open = v ?? !c.open;
    render();
    if (!c.open) renderAll();      // refresh the editor with anything copied
  }
  return { toggle, render, isOpen: () => c.open };
})();
