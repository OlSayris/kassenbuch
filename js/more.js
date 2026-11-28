/* Kassenbuch – Suche, Mehr-Seite (Kontostand, Budget, Kategorien, Sparziele, Sperre, Daten), Updates, Start.
   Braucht js/data.js und js/ui.js. */
"use strict";
const REPO = "OlSayris/kassenbuch";
const LOCK_AFTER_MS = 30000;   // App-Sperre greift, wenn die App länger als 30 s im Hintergrund war

/* ================= Suche ================= */
function renderSearch() {
  $("#title").textContent = "Suche";
  if (!$("#sFrom").value) $("#sFrom").value = today().slice(0, 4) + "-01-01";
  if (!$("#sTo").value) $("#sTo").value = today();
  const names = [...new Set([...state.cats.out, ...state.cats.in].map(([n]) => n))];
  const sel = $("#sCat").value;
  $("#sCat").innerHTML = `<option value="">Alle Kategorien</option>`
    + names.map((n) => `<option value="${esc(n)}"${n === sel ? " selected" : ""}>${esc(n)}</option>`).join("");
  const from = $("#sFrom").value, to = $("#sTo").value;
  const res = from && to && from <= to
    ? search(state.entries, { q: $("#sQ").value, type: $("#sType").value, cat: $("#sCat").value, from, to }) : [];
  const total = (type) => res.filter((e) => e.type === type).reduce((s, e) => s + e.amount, 0);
  $("#sSum").innerHTML = `<div><span class="mut">${res.length} Treffer · Einnahmen</span><b class="in">${fmt(total("in"))}</b></div>`
    + `<div><span class="mut">Ausgaben</span><b>${fmt(total("out"))}</b></div>`;
  renderList($("#sList"), res.slice(0, 300), false);
}
["#sQ", "#sType", "#sCat", "#sFrom", "#sTo"].forEach((s) => $(s).addEventListener("input", renderSearch));
$("#sList").onclick = (e) => {          // Treffer antippen → Monat öffnen
  const li = e.target.closest("li[data-t]"); if (!li) return;
  cur = +li.dataset.t; switchView("month");
};

/* ================= Konten-Reiter: Kassenbuch-Kontostand (Rest in js/accounts.js) ================= */
function renderCashSection() {
  const bal = balanceAt(state, today());
  $("#todayBal").textContent = bal === null ? "Kassenstand heute: – (vor dem Stichtag des Anfangsbestands)"
    : `Kassenstand heute laut App: ${fmt(bal)}`;
  const o = state.opening;
  if (document.activeElement !== $("#openAmt")) $("#openAmt").value = o ? fmtIn(o.amount) : "";
  $("#openDate").value = o ? o.date : $("#openDate").value || today();
  $("#btnOpenDel").hidden = !o;
}

/* ================= Einstellungen (Zahnrad) ================= */
let catType = "out";
function renderSettings() {
  $("#title").textContent = "Einstellungen";
  if (document.activeElement !== $("#budgetIn")) $("#budgetIn").value = state.budget ? fmtIn(state.budget) : "";
  renderCatList();
  $("#lockToggle").checked = state.lock;
  $("#lockToggle").disabled = !PLUGINS.NativeBiometric;
  $("#lockHint").textContent = PLUGINS.NativeBiometric
    ? "Beim Öffnen und nach 30 s im Hintergrund wird nach Fingerabdruck oder Display-PIN gefragt. Die Daten selbst sind nicht verschlüsselt."
    : "Nur in der Android-App verfügbar.";
}

/* ---------- Kontoabgleich & Anfangsbestand ---------- */
$("#btnReconcile").onclick = async () => {
  const real = parseSigned($("#realBal").value);
  if (isNaN(real)) return shake($("#realBal"));
  if (!state.opening && !state.entries.length) {
    setState({ opening: { amount: real, date: today() } });
    $("#realBal").value = "";
    return toast("Als Anfangsbestand ab heute gespeichert");
  }
  if (!state.opening) {
    const how = await ask(`Es gibt noch keinen Anfangsbestand. Wie soll ${fmt(real)} verwendet werden?`,
      [["book", "Differenz als Kontoabgleich buchen"], ["open", "Als Anfangsbestand (heute) speichern"]]);
    if (!how) return;
    if (how === "open") { $("#realBal").value = ""; setState({ opening: { amount: real - todaysBookings(), date: today() } }); return toast("Anfangsbestand gespeichert"); }
  }
  if (balanceAt(state, today()) === null) return toast("Stichtag des Anfangsbestands liegt in der Zukunft – bitte zuerst korrigieren");
  const entry = reconcileEntry(state, real, today());
  if (!entry) return toast("Stimmt überein – keine Differenz");
  const label = entry.type === "in" ? "Einnahme" : "Ausgabe";
  if (!confirm(`Differenz ${entry.type === "in" ? "+" : "−"}${fmt(entry.amount)} als ${label} „${KONTOABGLEICH}“ (Sonstiges) buchen?`)) return;
  $("#realBal").value = "";
  setState({ entries: [...state.entries, entry] });
  toast(`Kontoabgleich gebucht: ${label} ${fmt(entry.amount)}`);
};
/** Saldo der heute schon gebuchten Beträge (damit ein Anfangsbestand „heute“ zum echten Kontostand passt) */
const todaysBookings = () => monthData(state.entries, monthIdx(today())).items
  .filter((e) => e.day === today()).reduce((s, e) => s + (e.type === "in" ? e.amount : -e.amount), 0);
$("#btnOpening").onclick = () => {
  const amount = parseSigned($("#openAmt").value), date = $("#openDate").value;
  if (isNaN(amount)) return shake($("#openAmt"));
  if (!date) return shake($("#openDate"));
  setState({ opening: { amount, date } });
  toast("Anfangsbestand gespeichert");
};
$("#btnOpenDel").onclick = () => { if (confirm("Anfangsbestand entfernen?")) setState({ opening: null }); };
$("#btnBudget").onclick = () => {
  const v = $("#budgetIn").value.trim(), cents = parseAmount(v);
  if (v && isNaN(cents)) return shake($("#budgetIn"));
  setState({ budget: v ? cents : 0 });
  toast(v ? "Budget gespeichert" : "Budget entfernt");
};

/* ---------- Kategorien ---------- */
function renderCatList() {
  $("#catList").innerHTML = state.cats[catType].map(([n, i], idx) => `<li data-i="${idx}"><span class="ico">${esc(i)}</span>`
    + `<div class="txt"><div>${esc(n)}</div></div><button class="ed" aria-label="Bearbeiten">✎</button>`
    + (n === "Sonstiges" ? "" : `<button class="del" aria-label="Löschen">✕</button>`) + `</li>`).join("");
}
$("#catSeg").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  catType = b.dataset.type; setSeg("#catSeg", "type", catType); renderCatList();
};
$("#catList").onclick = (e) => {
  const li = e.target.closest("li[data-i]"); if (!li) return;
  const [name, icon] = state.cats[catType][+li.dataset.i];
  if (e.target.closest(".del")) {
    if (!confirm(`Kategorie „${name}“ löschen?\nBestehende Buchungen werden zu „Sonstiges“.`)) return;
    return setState(deleteCat(state, catType, name));
  }
  if (!e.target.closest(".ed")) return;
  const newName = name === "Sonstiges" ? name : prompt("Name der Kategorie:", name);
  if (newName === null) return;
  const newIcon = prompt("Symbol (ein Emoji):", icon);
  if (newIcon === null) return;
  const next = renameCat(state, catType, name, newName, newIcon.trim().slice(0, 8));
  if (next === state) return toast("Name ungültig oder schon vergeben");
  setState(next);
};
$("#btnCatAdd").onclick = () => {
  const name = (prompt("Name der neuen Kategorie:") || "").trim().slice(0, 30);
  if (!name) return;
  if (state.cats[catType].some(([n]) => n === name)) return toast("Kategorie gibt es schon");
  const icon = ((prompt("Symbol (ein Emoji):", "🏷️") || "🏷️").trim() || "🏷️").slice(0, 8);
  const list = state.cats[catType], at = list.findIndex(([n]) => n === "Sonstiges");
  const next = [...list.slice(0, at), [name, icon], ...list.slice(at)];   // vor „Sonstiges“ einreihen
  setState({ cats: { ...state.cats, [catType]: next } });
};

/* ---------- Sparziele ---------- */
function renderGoals() {
  $("#goalList").innerHTML = state.goals.length ? state.goals.map((g, i) => {
    const p = Math.min(100, Math.max(0, (g.saved / g.target) * 100));
    return `<div class="goal" data-i="${i}"><div class="row"><b>${esc(g.name)}</b><span>${fmt(g.saved)} / ${fmt(g.target)}</span></div>`
      + `<div class="track"><div class="fill" style="width:${p}%"></div></div>`
      + `<div class="row"><span class="mut">${g.saved >= g.target ? "🎉 Ziel erreicht!" : "noch " + fmt(g.target - g.saved)}</span>`
      + `<span><button class="link" data-a="pay">± Betrag</button><button class="link" data-a="del">Löschen</button></span></div></div>`;
  }).join("") : `<p class="mut">Noch keine Sparziele.</p>`;
}
$("#goalList").onclick = (e) => {
  const b = e.target.closest("button[data-a]"); if (!b) return;
  const i = +b.closest(".goal").dataset.i, g = state.goals[i];
  if (b.dataset.a === "del") {
    if (confirm(`Sparziel „${g.name}“ löschen?`)) setState({ goals: state.goals.filter((_, k) => k !== i) });
    return;
  }
  const v = prompt(`Betrag für „${g.name}“ (z. B. 50 oder -20 zum Entnehmen):`);
  if (v === null) return;
  const c = parseSigned(v);
  if (isNaN(c) || !c) return toast("Ungültiger Betrag");
  setState({ goals: state.goals.map((x, k) => (k === i ? { ...x, saved: x.saved + c } : x)) });
};
$("#btnGoalAdd").onclick = () => {
  const name = (prompt("Wofür sparst du? (z. B. Urlaub)") || "").trim().slice(0, 30);
  if (!name) return;
  const target = parseAmount(prompt("Zielbetrag in €:") || "");
  if (isNaN(target)) return toast("Ungültiger Zielbetrag");
  setState({ goals: [...state.goals, { id: uid(), name, target, saved: 0 }] });
};

/* ---------- App-Sperre (Fingerabdruck / Display-PIN, nur Android-App) ---------- */
let verifying = false, hiddenAt = 0, ignoreVisUntil = 0;
const BIO = { reason: "Kassenbuch entsperren", title: "Kassenbuch", subtitle: "Fingerabdruck oder Display-PIN",
              negativeButtonText: "Abbrechen", useFallback: true, maxAttempts: 5 };
/** true = Identität bestätigt, false = nicht bestätigt (erneut versuchen).
    null = am Handy ist gar keine Displaysperre (PIN/Muster/Fingerabdruck) mehr eingerichtet. */
async function verify() {
  verifying = true;
  try {
    const a = await PLUGINS.NativeBiometric.isAvailable({ useFallback: true });
    if (!a.isAvailable && !a.deviceIsSecure) return null;   // nur dann – vorübergehende Biometrie-Sperren zählen nicht
    await PLUGINS.NativeBiometric.verifyIdentity(BIO);
    return true;
  } catch { return false; }
  finally { verifying = false; ignoreVisUntil = Date.now() + 1500; }   // Rückkehr aus dem System-Dialog ≠ „Hintergrund“
}
function showLock() {
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  $("#lock").hidden = false;
  unlock();
}
async function unlock() {
  if (verifying) return;
  const ok = await verify();
  if (ok === null) {   // kein Fingerabdruck/PIN mehr am Gerät: nicht aussperren, Sperre abschalten
    setState({ lock: false });
    toast("App-Sperre deaktiviert – am Handy ist keine Displaysperre eingerichtet");
  }
  if (ok !== false) $("#lock").hidden = true;
}
$("#btnUnlock").onclick = unlock;
$("#lockToggle").onchange = async (e) => {
  const want = e.target.checked;
  const ok = await verify();
  if (ok === null) { e.target.checked = false; return toast("Bitte zuerst am Handy Fingerabdruck oder Displaysperre einrichten"); }
  if (!ok) { e.target.checked = !want; return toast("Nicht bestätigt"); }
  setState({ lock: want });
  toast(want ? "App-Sperre aktiviert" : "App-Sperre deaktiviert");
};
document.addEventListener("visibilitychange", () => {
  if (!state.lock || !PLUGINS.NativeBiometric || verifying || Date.now() < ignoreVisUntil) return;
  if (document.visibilityState === "hidden") hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && $("#lock").hidden) showLock();
  if (document.visibilityState === "visible") hiddenAt = 0;
});

/* ---------- Export & Import ---------- */
$("#btnExport").onclick = async () => {
  const json = JSON.stringify({ schemaVersion: SCHEMA, ...state }, null, 2), name = `kassenbuch-${today()}.json`;
  if (PLUGINS.Filesystem && PLUGINS.Share) {   // App: über den Teilen-Dialog speichern/senden
    try {
      const r = await PLUGINS.Filesystem.writeFile({ path: name, data: json, directory: "CACHE", encoding: "utf8" });
      await PLUGINS.Share.share({ title: "Kassenbuch-Backup", url: r.uri });
    } catch (err) { if (!/cancel/i.test(String(err && err.message))) toast("Export fehlgeschlagen"); }
    return;
  }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([json], { type: "application/json" })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$("#btnImport").onclick = () => $("#file").click();
$("#file").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try {
    const raw = JSON.parse(await f.text()), data = migrate(raw);
    const total = Array.isArray(raw) ? raw.length : (raw && Array.isArray(raw.entries) ? raw.entries.length : 0);
    const dropped = total - data.entries.length;
    if (!confirm(`${data.entries.length} Buchungen importieren?` + (dropped ? `\nAchtung: ${dropped} fehlerhafte Einträge werden übersprungen.` : "")
      + `\nDie aktuellen ${state.entries.length} Buchungen werden ersetzt (vorher besser exportieren).`)) return;
    state = { ...data, lock: state.lock };   // Sperr-Einstellung des Geräts behalten
    save(); render(); toast("Import erfolgreich");
  } catch { toast("Datei konnte nicht gelesen werden"); }
};

/* ================= Updates ================= */
const APK_URL = `https://github.com/${REPO}/releases/latest/download/kassenbuch.apk`;
const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function checkApkUpdate(manual) {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const latest = String((await r.json()).tag_name || "").replace(/^v/, "");
    if (latest && newer(latest, window.APP_VERSION)) {
      $("#updText").textContent = `Neue Version ${latest} verfügbar`;
      $("#updBar").hidden = false;
    } else if (manual) toast(`Du hast die neueste Version (${window.APP_VERSION})`);
  } catch { if (manual) toast("Update-Prüfung nicht möglich – keine Verbindung?"); }
}
$("#updBtn").onclick = () => {   // Capacitor öffnet externe Links im System-Browser → APK laden → installieren
  toast("Download startet – danach die APK öffnen und „Aktualisieren“ tippen");
  setTimeout(() => { location.href = APK_URL; }, 600);
};
let swReg = null;
async function checkWebUpdate() {
  if (!swReg) return toast("Updates werden hier nicht unterstützt");
  try {
    await swReg.update();
    if (!swReg.installing && !swReg.waiting) toast("Du hast die neueste Version");
  } catch { toast("Update-Prüfung nicht möglich – keine Verbindung?"); }
}
$("#btnUpdate").onclick = () => (NATIVE ? checkApkUpdate(true) : checkWebUpdate());
function initUpdates() {
  if (NATIVE) {
    $("#version").textContent = "Version " + window.APP_VERSION;
    checkApkUpdate(false);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkApkUpdate(false); });
    return;
  }
  if (!("serviceWorker" in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;   // false beim allerersten Start
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {   // neue Version aktiv → einmal neu laden
    if (!hadController || reloading) return;
    reloading = true; sessionStorage.setItem("kb-updated", "1");
    // Nicht mitten in einer Eingabe neu laden: warten, bis kein Dialog mehr offen ist
    const tryReload = () => (document.querySelector("dialog[open]") ? setTimeout(tryReload, 1000) : location.reload());
    tryReload();
  });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
    swReg = reg;
    const check = () => reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
    check();
  }).catch(() => {});
  navigator.serviceWorker.ready.then((reg) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => {
      $("#version").textContent = "Version " + e.data;
      if (sessionStorage.getItem("kb-updated")) { sessionStorage.removeItem("kb-updated"); toast("App aktualisiert auf Version " + e.data); }
    };
    reg.active.postMessage("version", [ch.port2]);
  });
}

/* ================= Start ================= */
(() => {   // iOS-Icon: PNG aus Canvas (iOS nimmt kein SVG)
  const c = Object.assign(document.createElement("canvas"), { width: 180, height: 180 }), g = c.getContext("2d");
  g.fillStyle = "#0f766e"; g.fillRect(0, 0, 180, 180);
  g.fillStyle = "#fff"; g.font = "bold 110px Arial,sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("€", 90, 98);
  $("#touchIcon").href = c.toDataURL("image/png");
})();
(async () => {
  if (PLUGINS.Filesystem) await loadFromFile();   // erst Datei laden, dann Sperre prüfen, dann anzeigen
  if (state.lock && PLUGINS.NativeBiometric) showLock();
  render();
  initUpdates();
  if (!NATIVE && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
