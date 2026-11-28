/* Kassenbuch – Reiter „Konten“: weitere Konten (Sparbuch, Tagesgeld, Depot …) mit manuell gepflegtem Stand,
   Kassenbuch als erstes Konto (Abgleich/Anfangsbestand), Gesamtvermögen und Sparziele. Braucht js/data.js und js/ui.js. */
"use strict";

const fmtDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("de-DE", { dateStyle: "medium" });

function renderAccounts() {
  $("#title").textContent = "Konten";
  const cash = balanceAt(state, today());
  const other = state.accounts.reduce((s, x) => s + x.balance, 0);
  setMoney("#aTotal", (cash || 0) + other);
  // 1. Zeile: das Kassenbuch selbst (Stand aus den Buchungen), danach die weiteren Konten
  const o = state.opening;
  const cashRow = `<li class="tap" data-k="cash"><span class="ico">📒</span><div class="txt"><div>Kassenbuch</div>`
    + `<div class="mut">${o ? "aus deinen Buchungen · ab " + fmtDate(o.date) : "aus deinen Buchungen · antippen zum Abgleichen"}</div></div>`
    + `<span class="amt ${cash !== null && cash < 0 ? "neg" : ""}">${cash === null ? "–" : fmt(cash)}</span></li>`;
  $("#accList").innerHTML = cashRow + state.accounts.map((x, i) => {
    const diff = x.prev === null ? null : x.balance - x.prev;
    const change = diff ? ` · <span class="${diff < 0 ? "neg" : "in"}">${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))}</span>` : "";
    return `<li class="tap" data-i="${i}"><span class="ico">${esc(x.icon)}</span>`
      + `<div class="txt"><div>${esc(x.name)}</div><div class="mut">Stand vom ${fmtDate(x.updated)}${change}</div></div>`
      + `<span class="amt ${x.balance < 0 ? "neg" : ""}">${fmt(x.balance)}</span></li>`;
  }).join("");
  renderGoals();
}

/* ---------- Kassenbuch: Kontoabgleich & Anfangsbestand (per Tipp auf die Kassenbuch-Zeile) ---------- */
async function cashMenu() {
  const o = state.opening, bal = balanceAt(state, today());
  const opts = [["rec", "Mit echtem Kontostand abgleichen"], ["open", o ? "Anfangsbestand ändern" : "Anfangsbestand festlegen"]];
  if (o) opts.push(["odel", "Anfangsbestand entfernen"]);
  const what = await ask(`Kassenbuch heute: ${bal === null ? "–" : fmt(bal)}`, opts);
  if (what === "rec") return reconcile();
  if (what === "open") return editOpening();
  if (what === "odel" && confirm("Anfangsbestand entfernen?")) setState({ opening: null });
}
/** Saldo der heute schon gebuchten Beträge (damit ein Anfangsbestand „heute“ zum echten Kontostand passt) */
const todaysBookings = () => monthData(state.entries, monthIdx(today())).items
  .filter((e) => e.day === today()).reduce((s, e) => s + (e.type === "in" ? e.amount : -e.amount), 0);
async function reconcile() {
  const r = await inputBox("Kontostand abgleichen", [{ label: "Echter Kontostand heute in €", value: "", mode: "decimal" }]);
  if (!r) return;
  const real = parseSigned(r[0]);
  if (isNaN(real)) return toast("Ungültiger Betrag");
  if (!state.opening && !state.entries.length) {
    setState({ opening: { amount: real, date: today() } });
    return toast("Als Anfangsbestand ab heute gespeichert");
  }
  if (!state.opening) {
    const how = await ask(`Noch kein Anfangsbestand. Wie soll ${fmt(real)} verwendet werden?`,
      [["open", "Als Anfangsbestand (heute) speichern"], ["book", "Differenz als Buchung „Kontoabgleich“"]]);
    if (!how) return;
    if (how === "open") { setState({ opening: { amount: real - todaysBookings(), date: today() } }); return toast("Anfangsbestand gespeichert"); }
  }
  if (balanceAt(state, today()) === null) return toast("Stichtag des Anfangsbestands liegt in der Zukunft – bitte zuerst ändern");
  const entry = reconcileEntry(state, real, today());
  if (!entry) return toast("Stimmt überein – keine Differenz");
  const label = entry.type === "in" ? "Einnahme" : "Ausgabe";
  if (!confirm(`Differenz ${entry.type === "in" ? "+" : "−"}${fmt(entry.amount)} als ${label} „${KONTOABGLEICH}“ (Sonstiges) buchen?`)) return;
  setState({ entries: [...state.entries, entry] });
  toast(`Kontoabgleich gebucht: ${label} ${fmt(entry.amount)}`);
}
async function editOpening() {
  const o = state.opening;
  const r = await inputBox("Anfangsbestand", [{ label: "Betrag in €", value: o ? fmtIn(o.amount) : "", mode: "decimal" },
    { label: "Stichtag (Stand zu Beginn des Tages)", value: o ? o.date : today(), type: "date" }]);
  if (!r) return;
  const amount = parseSigned(r[0]);
  if (isNaN(amount)) return toast("Ungültiger Betrag");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r[1])) return toast("Bitte ein Datum wählen");
  setState({ opening: { amount, date: r[1] } });
  toast("Anfangsbestand gespeichert");
}

const setAccounts = (accounts) => setState({ accounts });


/** Neuer Stand für Konto i – bisheriger Stand steht schon im Feld */
async function updateBalance(i) {
  const a = state.accounts[i];
  const r = await inputBox(`Neuer Stand: ${a.name}`, [{ label: "Aktueller Stand in €", value: fmtIn(a.balance), mode: "decimal" }]);
  if (!r) return;
  const balance = parseSigned(r[0]);
  if (isNaN(balance)) return toast("Ungültiger Betrag");
  if (balance === a.balance) return toast("Stand unverändert");
  setAccounts(state.accounts.map((x, k) => (k === i ? { ...x, prev: x.balance, balance, updated: today() } : x)));
  toast(`${a.name}: ${fmt(balance)} gespeichert`);
}

// Konto antippen → Auswahl (hält die Zeilen auch auf 360-px-Bildschirmen schmal genug für lange Namen)
$("#accList").onclick = async (e) => {
  if (e.target.closest("li[data-k=cash]")) return cashMenu();
  const li = e.target.closest("li[data-i]"); if (!li) return;
  const i = +li.dataset.i, a = state.accounts[i];
  const what = await ask(`${a.name}: ${fmt(a.balance)}`,
    [["bal", "Neuen Stand eintragen"], ["ren", "Umbenennen / Symbol ändern"], ["del", "Konto löschen"]]);
  if (what === "bal") return updateBalance(i);
  if (what === "del") {
    if (confirm(`Konto „${a.name}“ löschen?`)) setAccounts(state.accounts.filter((_, k) => k !== i));
    return;
  }
  if (what !== "ren") return;
  const r = await inputBox("Konto bearbeiten", [{ label: "Name", value: a.name }, { label: "Symbol (Emoji)", value: a.icon }]);
  if (!r) return;
  const name = r[0].slice(0, 30);
  if (!name) return toast("Name darf nicht leer sein");
  setAccounts(state.accounts.map((x, k) => (k === i ? { ...x, name, icon: r[1].slice(0, 8) || x.icon } : x)));
};

$("#btnAccAdd").onclick = async () => {
  const r = await inputBox("Neues Konto", [{ label: "Name (z. B. Sparbuch)", value: "" },
    { label: "Aktueller Stand in €", value: "", mode: "decimal" }, { label: "Symbol (Emoji)", value: "🏦" }]);
  if (!r) return;
  const name = r[0].slice(0, 30), balance = parseSigned(r[1]), icon = (r[2] || "🏦").slice(0, 8);
  if (!name) return toast("Name darf nicht leer sein");
  if (isNaN(balance)) return toast("Ungültiger Betrag");
  setAccounts([...state.accounts, { id: uid(), name, icon, balance, updated: today(), prev: null }]);
  toast(`Konto „${name}“ angelegt`);
};
