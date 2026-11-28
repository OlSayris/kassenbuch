/* Kassenbuch – Reiter „Budget“: Gesamtbudget und Monatsbudget je Ausgaben-Kategorie planen,
   mit Verbrauch im aktuellen Monat. Braucht js/data.js und js/ui.js. */
"use strict";

/** Balken + Text „120 € von 400 € · noch 280 €“ (gelb ab 80 %, rot bei Überschreitung) */
function budgetBar(spent, budget) {
  if (!budget) return `<span class="mut">${spent ? `${fmt(spent)} ausgegeben` : ""}</span>`;
  const rest = budget - spent, cls = rest < 0 ? "over" : spent >= budget * 0.8 ? "warn" : "";
  return `<div class="${cls}"><div class="track"><div class="fill" style="width:${Math.min(100, (spent / budget) * 100)}%"></div></div>`
    + `<span class="mut">${fmt(spent)} von ${fmt(budget)} · `
    + `<span class="${rest < 0 ? "neg" : ""}">${rest < 0 ? "überschritten um " + fmt(-rest) : "noch " + fmt(rest)}</span></span></div>`;
}

function renderBudgetView() {
  const t = monthIdx(today()), spentBy = catTotals(monthData(state.entries, t).items);
  const spentAll = Object.values(spentBy).reduce((s, v) => s + v, 0);
  $("#title").textContent = "Budget";
  $("#bTotalUse").textContent = monthLabel(t);
  if (document.activeElement !== $("#budgetIn")) $("#budgetIn").value = state.budget ? fmtIn(state.budget) : "";
  $("#bTotalBar").innerHTML = budgetBar(spentAll, state.budget);
  const planned = state.cats.out.reduce((s, [n]) => s + (state.catBudgets[n] || 0), 0);
  $("#bSum").textContent = planned ? `Summe der Kategorie-Budgets: ${fmt(planned)}`
    + (state.budget && planned > state.budget ? ` – mehr als das Gesamtbudget!` : "") : "";
  // Eingabefelder nicht neu aufbauen, während eines davon bearbeitet wird (sonst springt die Tastatur weg)
  if ($("#bList").contains(document.activeElement)) return;
  $("#bList").innerHTML = state.cats.out.map(([n, i], idx) => {
    const b = state.catBudgets[n] || 0;
    return `<div class="bitem"><div class="brow"><span>${esc(i)} ${esc(n)}</span>`
      + `<input data-i="${idx}" inputmode="decimal" placeholder="–" value="${b ? fmtIn(b) : ""}" aria-label="Budget ${esc(n)}"></div>`
      + budgetBar(spentBy[n] || 0, b) + `</div>`;
  }).join("");
}

/** Wert aus einem Budgetfeld übernehmen: leer = kein Budget, ungültig = rütteln */
function readBudget(input) {
  const v = input.value.trim(), cents = parseAmount(v);
  if (v && isNaN(cents)) { shake(input); return undefined; }
  return v ? cents : 0;
}
$("#budgetIn").addEventListener("change", (e) => {
  const v = readBudget(e.target);
  if (v === undefined) return;
  e.target.blur();
  setState({ budget: v });
  toast(v ? `Gesamtbudget ${fmt(v)} gespeichert` : "Gesamtbudget entfernt");
});
$("#bList").addEventListener("change", (e) => {
  const input = e.target.closest("input[data-i]"); if (!input) return;
  const v = readBudget(input);
  if (v === undefined) return;
  const name = state.cats.out[+input.dataset.i][0], catBudgets = { ...state.catBudgets };
  if (v) catBudgets[name] = v; else delete catBudgets[name];
  input.blur();
  setState({ catBudgets });
  toast(v ? `Budget „${name}“: ${fmt(v)}` : `Budget „${name}“ entfernt`);
});
// Enter auf der Zahlentastatur = übernehmen
$("#budgetView").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") e.target.blur(); });
