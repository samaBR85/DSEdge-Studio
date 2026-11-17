// Diagnostics tab: stick drift, stick circularity, real trigger range and report rate.
// Depends on app.js globals ($, $$, G, esc, state, toast, changed, Proto).
"use strict";

const Diag = (() => {
  const BINS = 72;                         // circularity: 5° per bin
  const R = 127.5;                         // stick half-range
  const d = {
    drift: { L: null, R: null },           // last measurement per stick
    measuring: null,                       // { until, samples: { L: [], R: [] } }
    circ: { L: new Float32Array(BINS), R: new Float32Array(BINS) },
    trig: { l2: { lo: 255, hi: 0 }, r2: { lo: 255, hi: 0 } },
    rateHist: [],                          // hz samples (one per second)
    lastRateAt: 0,
    simRate: { n: 0, t0: 0, last: 0, sum: 0, sq: 0, max: 0, out: null },
  };

  const pct = (v) => (v / R) * 100;
  const fmt = (v, n = 1) => (Number.isFinite(v) ? v.toLocaleString(I18N.locale, { minimumFractionDigits: n, maximumFractionDigits: n, useGrouping: false }) : "—");

  // ------------------------------------------------------------ build
  function build() {
    const box = $("#diag");
    if (box.dataset.built) return;
    box.dataset.built = "1";
    const stickHead = (s) => `${G(s + "3", 20)}<b>${s === "L" ? T("Esquerdo") : T("Direito")}</b>`;
    box.innerHTML = `<div class="dg">
      <div class="card dg-wide">
        <div class="dg-head"><div><h4>${T("Sobre o controle")}</h4><div class="muted small">${T("Informações que o próprio controle informa pelo USB.")}</div></div>
          <button class="btn sm ghost" id="dg-info-copy">${T("Copiar")}</button></div>
        <div class="dg-info" id="dg-info"><span class="dim small">${T("Lendo…")}</span></div>
      </div>

      <div class="card dg-wide">
        <div class="dg-head"><div><h4>${T("Drift dos analógicos")}</h4><div class="muted small">${T("Solte os dois analógicos, deixe o controle parado e clique em medir. Em 3 segundos o app vê o quanto eles “vazam” sem ninguém tocar e sugere a menor zona morta segura.")}</div></div>
          <button class="btn pri" id="dg-measure">${T("Medir drift")}</button></div>
        <div class="dg-drift">${["L", "R"].map((s) => `
          <div class="dg-drift-one" data-s="${s}">
            <div class="dg-zoom"><canvas data-zoom="${s}"></canvas><span class="dg-zoom-cap">${T("zoom ±25%")}</span></div>
            <div class="dg-drift-info">
              <div class="dg-title">${stickHead(s)}<span class="verdict" data-verdict="${s}">${T("sem medição")}</span></div>
              <div class="dg-stats">
                <div><span class="cap">${T("Centro X")}</span><b data-cx="${s}">—</b></div>
                <div><span class="cap">${T("Centro Y")}</span><b data-cy="${s}">—</b></div>
                <div><span class="cap">${T("Maior desvio")}</span><b data-max="${s}">—</b></div>
                <div><span class="cap">${T("Ruído")}</span><b data-noise="${s}">—</b></div>
              </div>
              <div class="dg-sug" data-sug="${s}"></div>
            </div>
          </div>`).join("")}
        </div>
      </div>

      <div class="card dg-wide">
        <div class="dg-head"><div><h4>${T("Circularidade")}</h4><div class="muted small">${T("Gire cada analógico devagar, encostado na borda, 2 ou 3 voltas. O contorno mostra até onde ele chega em cada direção, comparado ao círculo ideal.")}</div></div>
          <button class="btn" id="dg-circ-reset">${T("Reiniciar")}</button></div>
        <div class="dg-circ">${["L", "R"].map((s) => `
          <div class="dg-circ-one">
            <canvas data-circ="${s}"></canvas>
            <div class="dg-circ-info">
              <div class="dg-title">${stickHead(s)}</div>
              <div class="dg-stats col">
                <div><span class="cap">${T("Cobertura")}</span><b data-cov="${s}">0%</b></div>
                <div><span class="cap">${T("Erro médio")}</span><b data-err="${s}">—</b></div>
                <div><span class="cap">${T("Alcance mín. / máx.")}</span><b data-rng="${s}">—</b></div>
              </div>
              <div class="dg-note" data-cnote="${s}">${T("Gire o analógico para começar.")}</div>
            </div>
          </div>`).join("")}
        </div>
      </div>

      <div class="card">
        <div class="dg-head"><div><h4>${T("Faixa real dos gatilhos")}</h4><div class="muted small">${T("Aperte L2 e R2 até o fim e solte. O app guarda o menor valor em repouso e o maior alcançado.")}</div></div>
          <button class="btn sm" id="dg-trig-reset">${T("Reiniciar")}</button></div>
        ${["l2", "r2"].map((k) => `
          <div class="dg-trig" data-t="${k}">
            <div class="bar-h">${G(k.toUpperCase(), 18)}<span class="dim small" data-tinfo="${k}">${T("aperte o gatilho")}</span></div>
            <div class="dg-tbar"><div class="dg-trange" data-trange="${k}"></div><i data-tlive="${k}"></i></div>
            <div class="dg-tfoot"><span data-tverdict="${k}" class="dim small"></span><button class="btn sm ghost hidden" data-tapply="${k}">${T("Usar no perfil")}</button></div>
          </div>`).join("")}
      </div>

      <div class="card">
        <div class="dg-head"><div><h4>${T("Taxa de atualização")}</h4><div class="muted small">${T("Quantos reports por segundo chegam pelo cabo USB e o quão regulares eles são.")}</div></div></div>
        <div class="dg-rate">
          <div class="dg-hz"><b id="dg-hz">—</b><span>Hz</span></div>
          <div class="dg-stats col">
            <div><span class="cap">${T("Intervalo médio")}</span><b id="dg-mean">—</b></div>
            <div><span class="cap">${T("Oscilação (desvio)")}</span><b id="dg-jit">—</b></div>
            <div><span class="cap">${T("Maior intervalo")}</span><b id="dg-max">—</b></div>
          </div>
        </div>
        <svg class="spark" id="dg-spark" viewBox="0 0 240 50" preserveAspectRatio="none"><path fill="none" stroke="var(--ac)" stroke-width="1.5"/></svg>
        <div class="sens-meta"><span>${T("últimos 60 s")}</span><span id="dg-rate-note"></span></div>
      </div>
    </div>`;

    $("#dg-measure").onclick = startDrift;
    $("#dg-info-copy").onclick = () => {
      const txt = $$("#dg-info > div").map((x) => `${$(".cap", x).textContent}: ${$("b", x).textContent}`).join("\n");
      navigator.clipboard.writeText(txt).then(() => toast(T("Informações copiadas"), "ok"), () => toast(T("Não foi possível copiar"), "err"));
    };
    loadInfo();
    $("#dg-circ-reset").onclick = () => { d.circ.L.fill(0); d.circ.R.fill(0); paintCirc(); };
    $("#dg-trig-reset").onclick = () => { d.trig = { l2: { lo: 255, hi: 0 }, r2: { lo: 255, hi: 0 } }; paintTrig(); };
    $$("[data-tapply]", box).forEach((b) => (b.onclick = () => applyTrig(b.dataset.tapply)));
    for (const s of ["L", "R"]) renderSug(s);
  }

  // ------------------------------------------------------------ controller info
  // feature 0x20: firmware build date/time (ASCII), hardware version @24, firmware version @28, update version @44
  // feature 0x09: controller Bluetooth address @1..6 (little endian)
  let info = null;
  async function loadInfo(force = false) {
    const el = $("#dg-info");
    if (!el) return;
    if (!state.status.connected) { el.innerHTML = `<span class="dim small">${T("Conecte o controle pelo cabo USB.")}</span>`; return; }
    if (!info || force) {
      try {
        if (Native.simulated) throw new Error("sim");
        const f = await call("readFeature", { id: 0x20 }), p = await call("readFeature", { id: 0x09 });
        const ascii = (a, b) => String.fromCharCode(...f.slice(a, b)).trim();
        const le32 = (o) => (f[o] | (f[o + 1] << 8) | (f[o + 2] << 16) | (f[o + 3] << 24)) >>> 0;
        const hex = (v, n = 8) => "0x" + v.toString(16).toUpperCase().padStart(n, "0");
        const mon = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
        const [m, d, y] = ascii(1, 12).split(/\s+/);
        const date = mon[m] != null ? new Date(Number(y), mon[m], Number(d)).toLocaleDateString(I18N.locale, { day: "2-digit", month: "long", year: "numeric" }) : ascii(1, 12);
        const upd = f[44] | (f[45] << 8);
        info = {
          [T("Modelo")]: "DualSense Edge (CFI-ZCP1)",
          [T("Firmware")]: `${(upd >> 8).toString(16).padStart(2, "0")}.${(upd & 255).toString(16).padStart(2, "0")}`,
          [T("Compilação do firmware")]: `${date}, ${ascii(12, 20)}`,
          [T("Versão interna do firmware")]: hex(le32(28)),
          [T("Versão do hardware")]: hex(le32(24)),
          [T("Endereço Bluetooth")]: p.slice(1, 7).reverse().map((x) => x.toString(16).padStart(2, "0").toUpperCase()).join(":"),
        };
      } catch (e) {
        info = Native.simulated ? { [T("Modelo")]: T("DualSense Edge (simulado)"), [T("Firmware")]: "—", [T("Compilação do firmware")]: "—", [T("Versão interna do firmware")]: "—", [T("Versão do hardware")]: "—", [T("Endereço Bluetooth")]: "—" } : null;
        if (!info) { el.innerHTML = `<span class="warn-tx small">${T("Não foi possível ler: {err}", { err: esc(e.message) })}</span>`; return; }
      }
    }
    const extra = { [T("Conexão")]: `USB${d.rate?.hz ? ` · ${Math.round(d.rate.hz)} Hz` : ""}` };
    const i = state.input;
    if (i) { const p = i.full ? 100 : i.battery; extra[T("Bateria")] = i.charging ? T("{p}% · carregando", { p }) : i.full ? T("{p}% · carga completa", { p }) : `${p}%`; }
    el.innerHTML = Object.entries({ ...info, ...extra }).map(([k, v]) => `<div><span class="cap">${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
  }
  const resetInfo = () => { info = null; };

  // ------------------------------------------------------------ drift
  function startDrift() {
    if (!state.input) return toast(T("Conecte o controle pelo cabo USB para medir."), "err");
    d.measuring = { until: performance.now() + 3000, samples: { L: [], R: [] } };
    for (const s of ["L", "R"]) { d.drift[s] = null; $(`[data-verdict="${s}"]`).textContent = T("medindo…"); $(`[data-verdict="${s}"]`).className = "verdict"; renderSug(s); }
    tickMeasure();
  }
  function tickMeasure() {
    const m = d.measuring;
    if (!m) return;
    const left = Math.max(0, m.until - performance.now());
    $("#dg-measure").textContent = left > 0 ? T("Medindo… {n} s", { n: Math.ceil(left / 1000) }) : T("Medir drift");
    $("#dg-measure").disabled = left > 0;
    if (left > 0) return void setTimeout(tickMeasure, 200);
    d.measuring = null;
    for (const s of ["L", "R"]) d.drift[s] = analyse(m.samples[s]);
    for (const s of ["L", "R"]) renderSug(s);
  }
  function analyse(samples) {
    if (samples.length < 5) return null;
    let sx = 0, sy = 0, max = 0;
    for (const [x, y] of samples) { sx += x; sy += y; max = Math.max(max, Math.hypot(x, y)); }
    const cx = sx / samples.length, cy = sy / samples.length;
    let v = 0;
    for (const [x, y] of samples) v += (x - cx) ** 2 + (y - cy) ** 2;
    const noise = Math.sqrt(v / samples.length);
    const maxPct = pct(max);
    // smallest dead zone (in the controller's 0–100% scale) that hides the measured drift, with a small margin
    const sug = maxPct < 2 ? 0 : Math.min(40, Math.ceil(maxPct + 2));
    return { cx: pct(cx), cy: pct(-cy), max: maxPct, noise: pct(noise), sug, n: samples.length };
  }
  function renderSug(s) {
    const r = d.drift[s], el = $(`[data-sug="${s}"]`);
    if (!el) return;
    if (!r) { el.innerHTML = ""; return; }
    $(`[data-cx="${s}"]`).textContent = `${fmt(r.cx)}%`;
    $(`[data-cy="${s}"]`).textContent = `${fmt(r.cy)}%`;
    $(`[data-max="${s}"]`).textContent = `${fmt(r.max)}%`;
    $(`[data-noise="${s}"]`).textContent = `${fmt(r.noise)}%`;
    const v = $(`[data-verdict="${s}"]`);
    const lvl = r.max < 3 ? ["ok", T("sem drift")] : r.max < 8 ? ["warn", T("drift leve")] : ["bad", T("drift alto")];
    v.className = `verdict ${lvl[0]}`; v.textContent = lvl[1];
    const key = s === "L" ? "leftJoystick" : "rightJoystick";
    const cur = state.draft ? Proto.deadzoneOf(state.draft[key].curveValues) : null;
    if (r.max > 25) {
      v.className = "verdict warn"; v.textContent = T("medição inválida");
      el.innerHTML = `<span class="warn-tx">${T("O analógico se mexeu durante a medição. Solte-o e meça de novo sem tocar no controle.")}</span>`;
      return;
    }
    let txt;
    if (r.sug === 0) txt = cur ? T("Não precisa de zona morta (o perfil usa {cur}%).", { cur }) : T("Não precisa de zona morta.");
    else if (cur == null) txt = T("Zona morta sugerida: <b>{sug}%</b>.", { sug: r.sug });
    else if (cur >= r.sug) txt = T("Zona morta sugerida: <b>{sug}%</b> · no perfil: {cur}% — já cobre o drift.", { sug: r.sug, cur });
    else txt = T("Zona morta sugerida: <b>{sug}%</b> · no perfil: {cur}%.", { sug: r.sug, cur });
    const canApply = state.draft && r.sug > 0 && cur < r.sug;
    el.innerHTML = `<span>${txt}</span>${canApply ? `<button class="btn sm" data-apply="${s}">${T("Aplicar {sug}% no perfil", { sug: r.sug })}</button>` : ""}${!state.draft && r.sug > 0 ? `<span class="dim small">${T("Abra um perfil para aplicar.")}</span>` : ""}`;
    const b = $(`[data-apply="${s}"]`, el);
    if (b) b.onclick = () => {
      Proto.applyDeadzone(state.draft[key], r.sug);
      changed();
      toast(s === "L" ? T("Zona morta de {sug}% aplicada no analógico esquerdo (ainda não gravada no controle).", { sug: r.sug }) : T("Zona morta de {sug}% aplicada no analógico direito (ainda não gravada no controle).", { sug: r.sug }), "ok");
      renderSug(s);
    };
  }

  // ------------------------------------------------------------ trigger range
  function applyTrig(k) {
    if (!state.draft) return toast(T("Abra um perfil para aplicar."), "err");
    const t = d.trig[k];
    const min = t.lo > 2 ? Math.min(250, t.lo + 3) : 0, max = t.hi < 252 ? Math.max(min + 10, t.hi - 3) : 255;
    state.draft[k === "l2" ? "leftTrigger" : "rightTrigger"] = { min, max };
    changed();
    toast(T("Faixa de {trig} ajustada para {min}–{max} (ainda não gravada no controle).", { trig: k.toUpperCase(), min, max }), "ok");
  }
  function paintTrig(i) {
    for (const k of ["l2", "r2"]) {
      const t = d.trig[k], live = i ? i[k] : 0;
      $(`[data-tlive="${k}"]`).style.left = `${(live / 255) * 100}%`;
      const seen = t.hi >= t.lo;
      const rg = $(`[data-trange="${k}"]`);
      rg.style.left = seen ? `${(t.lo / 255) * 100}%` : "0"; rg.style.width = seen ? `${((t.hi - t.lo) / 255) * 100}%` : "0";
      $(`[data-tinfo="${k}"]`).textContent = seen ? T("repouso {lo} · máximo {hi} · agora {live}", { lo: t.lo, hi: t.hi, live }) : T("aperte o gatilho");
      const v = $(`[data-tverdict="${k}"]`), ap = $(`[data-tapply="${k}"]`);
      let msg = "", bad = false;
      if (seen && t.hi > 40) {
        if (t.lo > 2) { msg = T("Não volta a zero em repouso ({lo}). Uma zona morta inicial evita toques fantasmas.", { lo: t.lo }); bad = true; }
        else if (t.hi < 252) { msg = T("Não chega ao fim (máximo {hi} de 255). Encurtar a faixa garante 100%.", { hi: t.hi }); bad = true; }
        else msg = T("Faixa completa: 0 a 255.");
      }
      v.textContent = msg; v.className = `small ${bad ? "warn-tx" : "dim"}`;
      ap.classList.toggle("hidden", !bad || !state.draft);
    }
  }

  // ------------------------------------------------------------ canvas helpers
  function prepCanvas(cv) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return [ctx, W, H];
  }
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function paintZoom(s, x, y) {
    const cv = $(`[data-zoom="${s}"]`);
    if (!cv) return;
    const [ctx, W, H] = prepCanvas(cv);
    const cx = W / 2, cy = H / 2, k = (W / 2) / 0.25;    // ±25% of the stick range across the box
    ctx.strokeStyle = css("--line2"); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
    for (const r of [0.05, 0.1, 0.2]) { ctx.beginPath(); ctx.arc(cx, cy, r * k, 0, Math.PI * 2); ctx.setLineDash([3, 4]); ctx.stroke(); }
    ctx.setLineDash([]);
    // suggested / current dead zone
    const r = d.drift[s];
    const key = s === "L" ? "leftJoystick" : "rightJoystick";
    const cur = state.draft ? Proto.deadzoneOf(state.draft[key].curveValues) : 0;
    if (cur) { ctx.fillStyle = "rgba(79,140,255,.10)"; ctx.beginPath(); ctx.arc(cx, cy, (cur / 100) * k, 0, Math.PI * 2); ctx.fill(); }
    if (r?.sug) { ctx.strokeStyle = css("--warn"); ctx.beginPath(); ctx.arc(cx, cy, (r.sug / 100) * k, 0, Math.PI * 2); ctx.stroke(); }
    // measured samples
    const m = d.measuring?.samples[s];
    ctx.fillStyle = "rgba(245,184,74,.55)";
    for (const [sx, sy] of m || []) { ctx.fillRect(cx + (sx / R) * k - 1, cy + (sy / R) * k - 1, 2, 2); }
    // live dot (clamped to the box)
    const px = Math.max(4, Math.min(W - 4, cx + (x / R) * k)), py = Math.max(4, Math.min(H - 4, cy + (y / R) * k));
    ctx.fillStyle = css("--ok"); ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
  }

  function circStats(b) {
    let n = 0, err = 0, lo = Infinity, hi = 0;
    for (const v of b) if (v > 0.2) { n++; err += Math.abs(v - 1); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return { cov: n / BINS, err: n ? (err / n) * 100 : NaN, lo, hi };
  }
  function paintCirc(i) {
    for (const s of ["L", "R"]) {
      const cv = $(`[data-circ="${s}"]`);
      if (!cv) continue;
      const [ctx, W, H] = prepCanvas(cv);
      const cx = W / 2, cy = H / 2, k = Math.min(W, H) / 2 / 1.12;
      ctx.strokeStyle = css("--line2"); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy - k * 1.1); ctx.lineTo(cx, cy + k * 1.1); ctx.moveTo(cx - k * 1.1, cy); ctx.lineTo(cx + k * 1.1, cy); ctx.stroke();
      ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(cx, cy, k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      const b = d.circ[s];
      // contour: segments between neighbouring filled bins (filled shape once the whole circle is covered)
      const pt = (j) => { const a = (j + 0.5) / BINS * Math.PI * 2, v = b[j]; return [cx + Math.cos(a) * v * k, cy - Math.sin(a) * v * k]; };
      const full = b.every((v) => v >= 0.2);
      ctx.strokeStyle = css("--ac"); ctx.lineWidth = 2; ctx.lineJoin = "round";
      if (full) {
        ctx.beginPath(); for (let j = 0; j < BINS; j++) { const [px, py] = pt(j); j ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.closePath(); ctx.fillStyle = "rgba(79,140,255,.14)"; ctx.fill(); ctx.stroke();
      } else {
        ctx.beginPath();
        for (let j = 0; j < BINS; j++) { const n = (j + 1) % BINS; if (b[j] >= 0.2 && b[n] >= 0.2) { const [x0, y0] = pt(j), [x1, y1] = pt(n); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); } }
        ctx.stroke();
      }
      // per-bin dots that are clearly off the circle
      for (let j = 0; j < BINS; j++) {
        const v = b[j]; if (v < 0.2) continue;
        if (Math.abs(v - 1) < 0.06) continue;
        const a = (j + 0.5) / BINS * Math.PI * 2;
        ctx.fillStyle = v < 1 ? css("--bad") : css("--warn");
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * v * k, cy - Math.sin(a) * v * k, 2.5, 0, Math.PI * 2); ctx.fill();
      }
      if (i) {
        const [x, y] = s === "L" ? [i.lx - 128, i.ly - 128] : [i.rx - 128, i.ry - 128];
        ctx.fillStyle = css("--ok"); ctx.beginPath(); ctx.arc(cx + (x / R) * k, cy + (y / R) * k, 5, 0, Math.PI * 2); ctx.fill();
      }
      const st = circStats(b);
      $(`[data-cov="${s}"]`).textContent = `${Math.round(st.cov * 100)}%`;
      const ready = st.cov >= 0.9;
      $(`[data-err="${s}"]`).textContent = ready ? `${fmt(st.err)}%` : "—";
      $(`[data-rng="${s}"]`).textContent = st.hi ? `${Math.round(st.lo * 100)}% / ${Math.round(st.hi * 100)}%` : "—";
      const note = $(`[data-cnote="${s}"]`);
      if (!st.hi) note.textContent = T("Gire o analógico para começar.");
      else if (!ready) note.textContent = T("Continue girando até cobrir todas as direções.");
      else if (st.lo < 0.94) note.innerHTML = `<span class="warn-tx">${T("Em algumas direções ele não chega ao máximo ({p}%). Pode ser desgaste ou sujeira.", { p: Math.round(st.lo * 100) })}</span>`;
      else if (st.err < 6) note.innerHTML = `<span class="ok-tx">${T("Bom: o analógico alcança a borda em todas as direções.")}</span>`;
      else note.innerHTML = `<span class="warn-tx">${T("Contorno irregular. Normal em controles com o aro quadrado; acima de 10% vale observar.")}</span>`;
    }
  }

  // ------------------------------------------------------------ rate
  function paintRate(rate) {
    if (!rate || !rate.hz) return;
    $("#dg-hz").textContent = Math.round(rate.hz);
    $("#dg-mean").textContent = `${fmt(rate.mean, 2)} ms`;
    $("#dg-jit").textContent = `${fmt(rate.jitter, 2)} ms`;
    $("#dg-max").textContent = `${fmt(rate.max, 1)} ms`;
    const p = $("#dg-spark path");
    const h = d.rateHist, top = Math.max(300, ...h) * 1.1;
    p.setAttribute("d", h.map((v, j) => `${j ? "L" : "M"}${(j / 59) * 240},${50 - (v / top) * 48}`).join(""));
    $("#dg-rate-note").textContent = rate.sim ? T("simulado (estimado no navegador)") : rate.hz > 900 ? "≈ 1000 Hz" : rate.hz > 220 ? T("≈ 250 Hz (padrão do USB)") : T("abaixo do esperado");
  }
  function simRate() {
    // browser simulator has no native stats: estimate from event timing
    const r = d.simRate, now = performance.now();
    if (r.last) { const dt = now - r.last; r.n++; r.sum += dt; r.sq += dt * dt; r.max = Math.max(r.max, dt); }
    r.last = now;
    if (!r.t0) r.t0 = now;
    if (now - r.t0 >= 1000) {
      const mean = r.sum / r.n;
      r.out = { hz: (r.n * 1000) / (now - r.t0), mean, jitter: Math.sqrt(Math.max(0, r.sq / r.n - mean * mean)), max: r.max, sim: true };
      Object.assign(r, { n: 0, t0: now, sum: 0, sq: 0, max: 0 });
    }
    return r.out;
  }

  // ------------------------------------------------------------ input
  // called for every input event (even when the tab is hidden, so measurements keep going)
  function feed(i, rate) {
    const L = [i.lx - 128, i.ly - 128], Rr = [i.rx - 128, i.ry - 128];
    if (d.measuring) { d.measuring.samples.L.push(L); d.measuring.samples.R.push(Rr); }
    for (const [s, [x, y]] of [["L", L], ["R", Rr]]) {
      const m = Math.hypot(x, y) / R;
      if (m < 0.5) continue;
      let a = Math.atan2(-y, x); if (a < 0) a += Math.PI * 2;
      const j = Math.min(BINS - 1, Math.floor((a / (Math.PI * 2)) * BINS));
      if (m > d.circ[s][j]) d.circ[s][j] = m;
    }
    for (const k of ["l2", "r2"]) { const t = d.trig[k]; t.lo = Math.min(t.lo, i[k]); t.hi = Math.max(t.hi, i[k]); }
    const r = rate && rate.hz ? rate : Native.simulated ? simRate() : null;
    const now = performance.now();
    if (r && now - d.lastRateAt >= 1000) { d.lastRateAt = now; d.rateHist.push(r.hz); if (d.rateHist.length > 60) d.rateHist.shift(); }
    d.rate = r;
  }
  function paint(i) {
    if (!$("#diag").dataset.built) return;
    paintZoom("L", i.lx - 128, i.ly - 128);
    paintZoom("R", i.rx - 128, i.ry - 128);
    paintCirc(i);
    paintTrig(i);
    paintRate(d.rate);
  }
  // re-render text that depends on the open profile
  function refresh() { if ($("#diag").dataset.built) { for (const s of ["L", "R"]) renderSug(s); paintTrig(state.input); loadInfo(); } }

  return { build, feed, paint, refresh, resetInfo };
})();
