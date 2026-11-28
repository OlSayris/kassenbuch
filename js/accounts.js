/* Kassenbuch – Reiter „Konten“: weitere Konten (Sparbuch, Tagesgeld, Depot …) mit manuell gepflegtem Stand,
   Gesamtvermögen, Kassenbuch-Kontostand und Sparziele. Braucht js/data.js und js/ui.js. */
"use strict";

const fmtDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("de-DE", { dateStyle: "medium" });

function renderAccounts() {
  $("#title").textContent = "Konten";
  const cash = balanceAt(state, today());
  const other = state.accounts.reduce((s, a) => s + a.balance, 0);
  setMoney("#aCash", cash);
  setMoney("#aOther", other);
  setMoney("#aTotal", (cash || 0) + other);
  $("#accList").innerHTML = state.accounts.length ? state.accounts.map((a, i) => {
    const diff = a.prev === null ? null : a.balance - a.prev;
    const change = diff ? ` · <span class="${diff < 0 ? "neg" : "in"}">${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))}</span>` : "";
    return `<li class="tap" data-i="${i}"><span class="ico">${esc(a.icon)}</span>`
      + `<div class="txt"><div>${esc(a.name)}</div><div class="mut">Stand vom ${fmtDate(a.updated)}${change}</div></div>`
      + `<span class="amt ${a.balance < 0 ? "neg" : ""}">${fmt(a.balance)}</span></li>`;
  }).join("") : `<li class="mut">Noch keine weiteren Konten.</li>`;
  renderCashSection();
  renderGoals();
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
