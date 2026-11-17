// Internationalisation.
//
// The source language is Brazilian Portuguese: every user-visible string is written in Portuguese and
// wrapped in T("…"). The Portuguese text is the key; web/i18n/<code>.js add the translations with
// I18N.add(code, { "texto em português": "translation", … }). Placeholders use {name}: T("Slot {g}", { g }).
//
// Language choice: the saved choice (native: NSUserDefaults "lang", injected as window.EdgeLang.saved;
// browser: localStorage) and, if none, the first supported system language (window.EdgeLang.system or
// navigator.languages). Unsupported systems fall back to English. The language is fixed for the page's
// lifetime, so module constants may call T() at load; changing it reloads the page.
"use strict";

const I18N = (() => {
  const LANGS = [
    { code: "pt", name: "Português", locale: "pt-BR" },
    { code: "en", name: "English", locale: "en-US" },
    { code: "es", name: "Español", locale: "es-ES" },
    { code: "fr", name: "Français", locale: "fr-FR" },
    { code: "de", name: "Deutsch", locale: "de-DE" },
    { code: "it", name: "Italiano", locale: "it-IT" },
    { code: "ru", name: "Русский", locale: "ru-RU" },
    { code: "zh", name: "简体中文", locale: "zh-CN" },
    { code: "ja", name: "日本語", locale: "ja-JP" },
  ];
  const FALLBACK = "en";
  const dicts = {};
  const injected = window.EdgeLang || {};

  const norm = (tag) => {
    const c = String(tag || "").toLowerCase().split(/[-_]/)[0];
    return LANGS.some((l) => l.code === c) ? c : null;
  };
  function savedChoice() {
    if (injected.saved !== undefined) return norm(injected.saved);
    try { return norm(localStorage.getItem("edge-lang")); } catch { return null; }
  }
  function systemLang() {
    const list = injected.system || navigator.languages || [navigator.language];
    for (const t of list) { const c = norm(t); if (c) return c; }
    return FALLBACK;
  }

  const saved = savedChoice();
  const lang = saved || systemLang();
  const info = LANGS.find((l) => l.code === lang);

  function T(s, vars) {
    let out = (lang !== "pt" && dicts[lang] && dicts[lang][s]) || s;
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return out;
  }

  // Static HTML: data-i18n (text), data-i18n-html (inner HTML), data-i18n-title, data-i18n-ph (placeholder).
  function applyDom(root = document) {
    document.documentElement.lang = info.locale;
    root.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = T(el.dataset.i18n || el.textContent.trim())));
    root.querySelectorAll("[data-i18n-html]").forEach((el) => (el.innerHTML = T(el.dataset.i18nHtml || el.innerHTML.trim())));
    root.querySelectorAll("[data-i18n-title]").forEach((el) => (el.title = T(el.dataset.i18nTitle || el.title)));
    root.querySelectorAll("[data-i18n-ph]").forEach((el) => (el.placeholder = T(el.dataset.i18nPh || el.placeholder)));
  }

  // ---- language picker (top-right button + menu) ----
  let beforeChange = async () => true;
  async function choose(code) {
    if ((code || null) === saved) return;
    if (!(await beforeChange())) return;
    try { localStorage.setItem("edge-lang", code || ""); } catch {}
    const h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hid;
    if (h) { try { await h.postMessage({ cmd: "setLang", lang: code || "" }); } catch {} }
    location.reload();
  }
  function mountPicker(btn) {
    btn.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg><span>${lang.toUpperCase()}</span>`;
    btn.title = T("Idioma");
    const menu = document.createElement("div");
    menu.className = "lang-menu hidden";
    const item = (code, label, on) =>
      `<button data-code="${code}" class="${on ? "on" : ""}"><span>${label}</span>${on ? "<b>✓</b>" : ""}</button>`;
    menu.innerHTML =
      item("", `${T("Idioma do sistema")} <i>${LANGS.find((l) => l.code === systemLang()).name}</i>`, !saved) +
      `<div class="lang-sep"></div>` +
      LANGS.map((l) => item(l.code, l.name, saved === l.code)).join("");
    document.body.appendChild(menu);
    const close = () => menu.classList.add("hidden");
    btn.onclick = (e) => {
      e.stopPropagation();
      if (!menu.classList.contains("hidden")) return close();
      const r = btn.getBoundingClientRect();
      menu.style.top = `${r.bottom + 6}px`;
      menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
      menu.classList.remove("hidden");
    };
    menu.onclick = (e) => {
      const b = e.target.closest("button[data-code]");
      if (!b) return;
      close();
      choose(b.dataset.code || null);
    };
    document.addEventListener("click", (e) => { if (!menu.contains(e.target)) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }

  return {
    LANGS, lang, locale: info.locale, T, applyDom, mountPicker,
    add: (code, dict) => { dicts[code] = Object.assign(dicts[code] || {}, dict); },
    set beforeChange(fn) { beforeChange = fn; },
  };
})();

const T = I18N.T;
