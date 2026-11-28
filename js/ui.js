/* Kassenbuch – Speicher, Monats-/Gesamtansicht, Erfassen & Bearbeiten. Braucht js/data.js. */
"use strict";
const $ = (s) => document.querySelector(s);
const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmt = (c) => eur.format(c / 100);
const fmtIn = (c) => (c / 100).toFixed(2).replace(".", ",");          // für Eingabefelder
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const monthLabel = (t) => new Date(Math.floor(t / 12), t % 12, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
const cmpHtml = (p) => (p === null ? "" : ` <small class="${p > 0 ? "up" : "down"}">${p > 0 ? "+" : ""}${p} %</small>`);

// Android-App (Capacitor)? Dann Datei-Speicher, APK-Updates, App-Sperre – sonst Web/PWA mit Service Worker.
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const PLUGINS = (NATIVE && window.Capacitor.Plugins) || {};
window.APP_VERSION = "";   // wird beim APK-Build durch scripts/build-www.js gesetzt
const KEY = "kassenbuch", DATA_FILE = "kassenbuch.json";

/* ================= Speichern & Laden ================= */
// localStorage der WebView wird verzögert geschrieben → in der App zusätzlich eine Datei (maßgeblich).
let state = (() => { try { return migrate(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { return migrate({}); } })();
let writeChain = Promise.resolve();
let fileBroken = false;   // Datei vorhanden, aber nicht lesbar → niemals überschreiben
function save() {
  const json = JSON.stringify({ schemaVersion: SCHEMA, ...state });
  let ok = true;
  try { localStorage.setItem(KEY, json); } catch { ok = false; }
  if (PLUGINS.Filesystem && !fileBroken) {
    writeChain = writeChain
      .then(() => PLUGINS.Filesystem.writeFile({ path: DATA_FILE, data: json, directory: "DATA", encoding: "utf8" }))
      .catch(() => toast("Speichern fehlgeschlagen!"));
  } else if (!ok) toast("Speichern fehlgeschlagen – Speicher voll?");
}
async function loadFromFile() {
  let raw;
  try {
    raw = (await PLUGINS.Filesystem.readFile({ path: DATA_FILE, directory: "DATA", encoding: "utf8" })).data;
  } catch (err) {
    if (/not exist|no such|not found/i.test(String(err && err.message))) {
      if (state.entries.length) save();   // noch keine Datei: localStorage-Daten übernehmen
      return;
    }
    fileBroken = true;
    return toast("Daten-Datei nicht lesbar – bitte App neu starten. Es wurde nichts überschrieben.");
  }
  try { state = migrate(JSON.parse(raw)); }
  catch { fileBroken = true; toast("Daten-Datei beschädigt – bitte Backup importieren. Es wurde nichts überschrieben."); }
}
const setState = (patch) => { state = { ...state, ...patch }; save(); render(); };

let cur = monthIdx(today());        // angezeigter Monat
let view = "month";                 // month | year | search | more
let form = { type: "out", repeat: "none", edit: null };
const catIcon = (type, name) => ((state.cats[type] || []).find(([n]) => n === name) || [])[1] || "•";

/* ================= Hinweise & Auswahl-Dialog ================= */
let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}
/** Zeigt eine Frage mit Auswahlknöpfen. options: [[wert, text], …] → Promise<wert | null> */
function ask(text, options) {
  return new Promise((resolve) => {
    const d = $("#ask");
    let result = null;
    $("#askText").textContent = text;
    $("#askBtns").innerHTML = options.map(([, label], i) => `<button data-i="${i}">${esc(label)}</button>`).join("")
      + `<button data-i="-1">Abbrechen</button>`;
    $("#askBtns").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      result = +b.dataset.i >= 0 ? options[+b.dataset.i][0] : null; d.close();
    };
    d.onclose = () => resolve(result);
    d.showModal();
  });
}
/** Eingabedialog mit vorausgefüllten Feldern (ersetzt prompt(), das in der Android-App keinen Vorgabewert zeigt).
    fields: [{label, value, mode}] (mode = inputmode, z. B. "decimal") → Promise<string[] | null> */
function inputBox(title, fields) {
  return new Promise((resolve) => {
    const d = $("#inp");
    let result = null;
    $("#inpTitle").textContent = title;
    $("#inpFields").innerHTML = fields.map((f) => `<label class="mut">${esc(f.label)}<input value="${esc(f.value ?? "")}"`
      + `${f.mode ? ` inputmode="${f.mode}"` : ""}${f.type ? ` type="${f.type}"` : ""} autocomplete="off"></label>`).join("");
    $("#inpForm").onsubmit = (e) => { e.preventDefault(); result = [...d.querySelectorAll("input")].map((x) => x.value.trim()); d.close(); };
    $("#inpCancel").onclick = () => d.close();
    d.onclose = () => resolve(result);
    d.showModal();
    const first = d.querySelector("input");
    if (first) { first.focus(); first.select(); }
  });
}
const shake = (el) => { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); el.focus(); };
function setSeg(sel, attr, value) {
  document.querySelectorAll(`${sel} button`).forEach((b) => b.classList.toggle("on", b.dataset[attr] === value));
}
function setMoney(sel, cents) {
  const el = $(sel);
  el.textContent = cents === null ? "–" : fmt(cents);
  el.classList.toggle("neg", cents !== null && cents < 0);
}

/* ================= Gesamt-Render ================= */
function render() {
  ["month", "year", "search", "budget", "accounts", "settings"].forEach((v) => { $(`#${v}View`).hidden = view !== v; });
  const nav = view === "month" || view === "year";
  $("#prev").hidden = !nav; $("#next").hidden = !nav;
  $("#fab").hidden = view !== "month" && view !== "year";
  $("#gear").classList.toggle("on", view === "settings");
  $("#searchBtn").classList.toggle("on", view === "search");
  setSeg("#tabbar", "view", view);
  if (view === "month") renderMonth();
  else if (view === "year") renderYear();
  else if (view === "search") renderSearch();
  else if (view === "budget") renderBudgetView();
  else if (view === "accounts") renderAccounts();
  else renderSettings();
}

/* ================= Monatsansicht ================= */
function renderMonth() {
  const md = monthData(state.entries, cur), prev = monthData(state.entries, cur - 1);
  $("#title").textContent = monthLabel(cur);
  $("#sumIn").textContent = fmt(md.sumIn);
  $("#sumOut").textContent = fmt(md.sumOut);
  $("#cmpOut").innerHTML = prev.sumOut ? "vs. Vormonat" + cmpHtml(pct(md.sumOut, prev.sumOut)) : "";
  setMoney("#saldo", md.sumIn - md.sumOut);
  renderBudget(md.sumOut);
  renderCatBars($("#cats"), catTotals(md.items), catTotals(prev.items), true, "Ausgaben nach Kategorie · Tippen = Budget planen");
  renderList($("#list"), md.items, true);
}
function renderBudget(sumOut) {
  const b = state.budget, el = $("#budget");
  if (!b) { el.innerHTML = ""; return; }
  const rest = b - sumOut;
  el.className = "cat" + (rest < 0 ? " over" : sumOut >= b * 0.8 ? " warn" : "");
  el.innerHTML = `<div class="row"><span>Budget ${fmt(b)}</span><span class="${rest < 0 ? "neg" : ""}">`
    + `${rest < 0 ? "überschritten um " + fmt(-rest) : "übrig " + fmt(rest)}</span></div>`
    + `<div class="track"><div class="fill" style="width:${Math.min(100, (sumOut / b) * 100)}%"></div></div>`;
}
/** Kategorie-Balken mit Vergleich zur Vorperiode; withBudget: Budget je Kategorie anzeigen und per Tipp setzen */
function renderCatBars(el, totals, prevTotals, withBudget, title) {
  const budgets = withBudget ? state.catBudgets : {};
  const names = [...new Set([...Object.keys(totals), ...Object.keys(budgets)])]
    .sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
  const max = Math.max(1, ...names.map((n) => totals[n] || 0));
  el.hidden = !names.length;
  el.innerHTML = `<div class="mut">${title}</div>` + names.map((c, i) => {
    const v = totals[c] || 0, b = budgets[c] || 0, ratio = b ? v / b : v / max;
    const cls = b && v > b ? " over" : b && v >= b * 0.8 ? " warn" : "";
    const right = b ? `${fmt(v)} / ${fmt(b)}` : fmt(v);
    return `<button class="cat${cls}" data-i="${i}"><div class="row"><span>${esc(catIcon("out", c))} ${esc(c)}</span>`
      + `<span>${right}${v ? cmpHtml(pct(v, prevTotals[c] || 0)) : ""}</span></div>`
      + `<div class="track"><div class="fill" style="width:${Math.min(100, ratio * 100)}%"></div></div></button>`;
  }).join("");
  // Tippen auf eine Kategorie → Reiter „Budget“
  el.onclick = withBudget ? (e) => { if (e.target.closest("button[data-i]")) switchView("budget"); } : null;
}
/** Buchungsliste. editable (Monat): Tippen = bearbeiten/löschen; sonst (Suche): Tippen = zum Monat springen */
function renderList(el, items, editable) {
  el.innerHTML = items.length ? items.map((e) => {
    const rep = e.repeat !== "none" ? ` · ↻ ${REP_LABEL[e.repeat]}` : "";
    const date = new Date(e.day).toLocaleDateString("de-DE", editable ? { day: "2-digit", month: "2-digit" } : { dateStyle: "medium" });
    return `<li class="tap" data-id="${esc(e.id)}" data-t="${e.t}"><span class="ico">${esc(catIcon(e.type, e.cat))}</span>`
      + `<div class="txt"><div>${esc(e.note || e.cat)}</div><div class="mut">${date} · ${esc(e.cat)}${rep}</div></div>`
      + `<span class="amt ${e.type === "in" ? "in" : ""}">${e.type === "in" ? "+" : "−"}${fmt(e.amount)}</span></li>`;
  }).join("") : editable
    ? `<li class="empty">Noch keine Buchungen in diesem Monat.<br>Tippe unten rechts auf <b>+</b>, um eine Ausgabe oder Einnahme zu erfassen.</li>`
    : `<li class="empty">Keine Treffer.</li>`;
}
$("#list").addEventListener("click", (ev) => {
  const li = ev.target.closest("li[data-id]"); if (!li) return;
  openSheet({ id: li.dataset.id, t: +li.dataset.t });
});
/** Löschen aus dem Bearbeiten-Dialog; bei Serien wählen: nur dieser Monat / ab jetzt / alle */
async function deleteEditing() {
  const { id, t } = form.edit, e = state.entries.find((x) => x.id === id);
  if (!e) return $("#sheet").close();
  const name = `„${e.note || e.cat}“ (${fmt(e.amount)})`;
  let scope = "all";
  if (e.repeat === "none") { if (!confirm(`${name} wirklich löschen?`)) return; }
  else {
    scope = await ask(`Wiederkehrende Buchung ${name} löschen:`,
      [["this", "Nur in diesem Monat"], ["future", "Ab diesem Monat"], ["all", "Ganze Serie (auch frühere Monate)"]]);
    if (!scope) return;
  }
  $("#sheet").close();
  setState({ entries: deleteOcc(state.entries, id, t, scope) });
  toast("Gelöscht");
}
$("#btnDelete").onclick = deleteEditing;

/* ================= Gesamtübersicht ================= */
function renderYear() {
  const y = Math.floor(cur / 12), now = monthIdx(today());
  const months = Array.from({ length: 12 }, (_, m) => monthData(state.entries, y * 12 + m));
  const prevYear = Array.from({ length: 12 }, (_, m) => monthData(state.entries, (y - 1) * 12 + m));
  const sum = (arr, k) => arr.reduce((s, m) => s + m[k], 0);
  const yIn = sum(months, "sumIn"), yOut = sum(months, "sumOut"), pOut = sum(prevYear, "sumOut");
  $("#title").textContent = "Jahr " + y;
  $("#yIn").textContent = fmt(yIn);
  $("#yOut").textContent = fmt(yOut);
  $("#yCmp").innerHTML = pOut ? "vs. Vorjahr" + cmpHtml(pct(yOut, pOut)) : "";
  setMoney("#ySaldo", yIn - yOut);
  const short = (m) => new Date(y, m.t % 12, 1).toLocaleDateString("de-DE", { month: "short" });
  // Diagramm: Einnahmen/Ausgaben je Monat als Balkenpaar (Tippen öffnet den Monat)
  const max = Math.max(1, ...months.flatMap((m) => [m.sumIn, m.sumOut]));
  $("#chart").innerHTML = months.map((m) => `<button class="col${m.t === now ? " now" : ""}" data-t="${m.t}" `
    + `title="${short(m)}: Ein ${eur0.format(m.sumIn / 100)} · Aus ${eur0.format(m.sumOut / 100)}">`
    + `<i class="ci" style="height:${(m.sumIn / max) * 100}%"></i><i class="co" style="height:${(m.sumOut / max) * 100}%"></i></button>`).join("");
  $("#axis").innerHTML = months.map((m) => `<span>${short(m).slice(0, 1)}</span>`).join("");
  $("#yMonths").innerHTML = `<div class="yrow mut"><span></span><span>Ein</span><span>Aus</span><span>Übrig</span></div>`
    + months.map((m) => {
      const s = m.sumIn - m.sumOut;
      return `<button class="yrow${m.t === now ? " now" : ""}" data-t="${m.t}"><span>${short(m)}</span>`
        + `<span class="in">${eur0.format(m.sumIn / 100)}</span><span>${eur0.format(m.sumOut / 100)}</span>`
        + `<span class="${s < 0 ? "neg" : ""}">${eur0.format(s / 100)}</span></button>`;
    }).join("");
  renderCatBars($("#yCats"), catTotals(months.flatMap((m) => m.items)), catTotals(prevYear.flatMap((m) => m.items)),
    false, `Ausgaben ${y} nach Kategorie (vs. Vorjahr)`);
  renderFixed(now);
}
$("#chart").onclick = (e) => { const b = e.target.closest("button[data-t]"); if (b) { cur = +b.dataset.t; switchView("month"); } };
$("#yMonths").onclick = (e) => {
  const b = e.target.closest("button[data-t]"); if (!b) return;
  cur = +b.dataset.t; switchView("month");
};
/** Aktive wiederkehrende Zahlungen, umgerechnet auf einen Monatsdurchschnitt */
function renderFixed(now) {
  const act = state.entries.filter((e) => e.repeat !== "none" && (!e.end || monthIdx(e.end + "-01") >= now));
  $("#fixed").hidden = !act.length;
  const perMonth = (e) => Math.round(e.amount / STEP[e.repeat]);
  const total = (type) => act.filter((e) => e.type === type).reduce((s, e) => s + perMonth(e), 0);
  const fIn = total("in"), fOut = total("out");
  $("#fixed").innerHTML = `<div class="mut">Wiederkehrende Zahlungen · Ø pro Monat</div>`
    + `<div class="grid" style="margin:8px 0"><div><span class="mut">Fix rein</span><b class="in">${fmt(fIn)}</b></div>`
    + `<div><span class="mut">Fix raus</span><b>${fmt(fOut)}</b></div>`
    + `<div><span class="mut">Bleibt frei</span><b class="${fIn - fOut < 0 ? "neg" : ""}">${fmt(fIn - fOut)}</b></div></div><ul>`
    + [...act].sort((a, b) => perMonth(b) - perMonth(a)).map((e) =>
      `<li><span class="ico">${esc(catIcon(e.type, e.cat))}</span><div class="txt"><div>${esc(e.note || e.cat)}</div>`
      + `<div class="mut">${REP_LABEL[e.repeat]} seit ${e.date.slice(5, 7)}/${e.date.slice(0, 4)}`
      + `${e.end ? " bis " + e.end.slice(5) + "/" + e.end.slice(0, 4) : ""}</div></div>`
      + `<span class="amt ${e.type === "in" ? "in" : ""}">${e.type === "in" ? "+" : "−"}${fmt(e.amount)}</span></li>`).join("")
    + `</ul>`;
}

/* ================= Navigation: untere Leiste, Lupe, Zahnrad, Zurück-Taste ================= */
function switchView(v) { view = v; window.scrollTo(0, 0); render(); }
$("#tabbar").onclick = (e) => { const b = e.target.closest("button"); if (b) switchView(b.dataset.view); };
let lastView = "month";   // Lupe/Zahnrad: öffnen, erneut tippen = zurück zur vorherigen Ansicht
const toggleView = (v) => { if (view === v) switchView(lastView); else { if (view !== "search" && view !== "settings") lastView = view; switchView(v); } };
$("#gear").onclick = () => toggleView("settings");
$("#searchBtn").onclick = () => toggleView("search");
/** Android-Zurück-Taste: oberster Dialog zu → Lupe/Zahnrad zurück → zur Monatsansicht → App beenden.
    Gibt false zurück, wenn nichts mehr zu schließen ist. */
function handleBack() {
  const open = [...document.querySelectorAll("dialog[open]")].pop();   // im DOM zuletzt = oben
  if (open) { open.close(); return true; }
  if (!$("#lock").hidden) return false;
  if (view === "search" || view === "settings") { switchView(lastView); return true; }
  if (view !== "month") { switchView("month"); return true; }
  return false;
}
if (PLUGINS.App) PLUGINS.App.addListener("backButton", () => { if (!handleBack()) PLUGINS.App.exitApp(); });
const go = (d) => { if (view !== "month" && view !== "year") return; cur += view === "year" ? d * 12 : d; render(); };
$("#prev").onclick = () => go(-1);
$("#next").onclick = () => go(1);
let touch = null;
$("#main").addEventListener("touchstart", (e) => { touch = e.touches[0]; }, { passive: true });
$("#main").addEventListener("touchend", (e) => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.clientX, dy = e.changedTouches[0].clientY - touch.clientY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  touch = null;
});

/* ================= Erfassen & Bearbeiten ================= */
function renderTiles(selected) {
  $("#tiles").innerHTML = state.cats[form.type].map(([n, i], idx) =>
    `<button data-i="${idx}" class="${n === selected ? "sel" : ""}"><span>${esc(i)}</span>${esc(n)}</button>`).join("");
}
/** edit = {id, t} zum Bearbeiten, sonst neue Buchung. Bearbeitungsstatus wird bei jedem Öffnen neu gesetzt. */
function openSheet(edit) {
  const e = edit && state.entries.find((x) => x.id === edit.id);
  form = e ? { type: e.type, repeat: e.repeat, edit } : { type: "out", repeat: "none", edit: null };
  setSeg("#typeSeg", "type", form.type); setSeg("#repSeg", "rep", form.repeat);
  renderTiles(e ? e.cat : null);
  $("#sheetTitle").textContent = e ? "Buchung bearbeiten" : "Neue Buchung";
  $("#amount").value = e ? fmtIn(e.amount) : "";
  $("#note").value = e ? e.note : "";
  $("#date").value = e ? occDay(e, edit.t) : (monthIdx(today()) === cur ? today() : toIso(cur, 1));
  form = { ...form, shownDate: $("#date").value };   // um zu erkennen, ob das Datum geändert wurde
  renderQuick(!e);
  $("#opts").open = false;                 // Datum, Notiz, Wiederholung eingeklappt; Zusammenfassung zeigt den Stand
  updateOptsSummary();
  $("#btnDelete").hidden = !e;
  $("#tileHint").textContent = e ? "Kategorie antippen – Änderung wird gespeichert" : "Kategorie antippen – wird sofort gespeichert";
  $("#sheet").showModal();
  if (!e) $("#amount").focus();
}
/** „Weitere Angaben“ zeigt eingeklappt, was gerade eingestellt ist – z. B. „Heute · einmalig“ */
function updateOptsSummary() {
  const d = $("#date").value, note = $("#note").value.trim();
  const day = !d || d === today() ? "Heute" : new Date(d + "T12:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const rep = form.repeat === "none" ? "einmalig" : REP_LABEL[form.repeat];
  $("#optsSum").textContent = `${day} · ${rep}${note ? " · " + note : ""}  (ändern)`;
}
["#date", "#note"].forEach((s) => $(s).addEventListener("input", updateOptsSummary));
function renderQuick(show) {
  const list = show ? quickSuggestions(state.entries, today()) : [];
  $("#quick").innerHTML = list.map((q, i) => `<button data-i="${i}">${esc(catIcon(q.type, q.cat))} ${esc(q.note || q.cat)} `
    + `${q.type === "in" ? "+" : ""}${fmt(q.amount)}</button>`).join("");
  $("#quick").onclick = (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    const q = list[+b.dataset.i];
    addEntry({ type: q.type, amount: q.amount, cat: q.cat, note: q.note, date: $("#date").value || today(), repeat: "none" });
  };
}
function addEntry(p) {
  const entry = { id: uid(), ...p, end: null, skip: [], schemaVersion: SCHEMA };
  cur = monthIdx(p.date);
  $("#sheet").close();
  setState({ entries: [...state.entries, entry] });
  toast(`${p.type === "in" ? "Einnahme" : "Ausgabe"} ${fmt(p.amount)} gespeichert`);
}
$("#fab").onclick = () => openSheet(null);
$("#sheet").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$("#typeSeg").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  form = { ...form, type: b.dataset.type }; setSeg("#typeSeg", "type", form.type); renderTiles(null);
};
$("#repSeg").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  form = { ...form, repeat: b.dataset.rep }; setSeg("#repSeg", "rep", form.repeat); updateOptsSummary();
};
$("#tiles").onclick = async (ev) => {
  const b = ev.target.closest("button[data-i]"); if (!b) return;
  const amount = parseAmount($("#amount").value), date = $("#date").value || today();
  if (isNaN(amount)) return shake($("#amount"));
  const patch = { type: form.type, amount, cat: state.cats[form.type][+b.dataset.i][0], note: $("#note").value.trim(), date, repeat: form.repeat };
  if (!form.edit) return addEntry(patch);
  const { id, t } = form.edit, e = state.entries.find((x) => x.id === id);
  if (!e) return $("#sheet").close();
  let scope = "all";
  if (e.repeat !== "none") {
    scope = await ask("Änderung übernehmen für:", [["this", "Nur diesen Monat"], ["future", "Ab diesem Monat"], ["all", "Alle Monate (ganze Serie)"]]);
    if (!scope) return;
  }
  // Serie: Startmonat bleibt; Tag nur übernehmen, wenn das Datum wirklich geändert wurde
  // (sonst würde z. B. der 28.02. einer „31.“-Serie alle Monate auf den 28. setzen)
  const day = date === form.shownDate ? e.date.slice(8) : date.slice(8);
  const p = e.repeat === "none" || scope === "this" ? patch
    : { ...patch, date: (scope === "all" ? e.date.slice(0, 8) : (date === form.shownDate ? ymOf(t) + "-" : date.slice(0, 8))) + day };
  $("#sheet").close();
  cur = monthIdx(scope === "all" ? (e.repeat === "none" ? date : occDay({ ...e, ...p }, t)) : date);
  setState({ entries: applyEdit(state.entries, id, t, p, scope) });
  toast("Änderung gespeichert");
};
