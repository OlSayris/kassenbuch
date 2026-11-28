// Unit-Tests für js/data.js – ausführen mit: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../js/data.js");

const mk = (o) => ({ id: o.id || "x" + Math.random(), type: "out", amount: 1000, cat: "Wohnen", note: "", date: "2026-01-05",
  repeat: "none", end: null, skip: [], schemaVersion: 3, ...o });
const m = (iso) => D.monthIdx(iso + "-01");

test("parseAmount/parseSigned akzeptieren deutsches und englisches Format", () => {
  assert.equal(D.parseAmount("1.234,56"), 123456);
  assert.equal(D.parseAmount("12.5"), 1250);
  assert.ok(Number.isNaN(D.parseAmount("0")));
  assert.equal(D.parseSigned("-50,10"), -5010);
  assert.equal(D.parseSigned("0"), 0);
  assert.ok(Number.isNaN(D.parseSigned("-")));
});

test("Serie: monatlich, vierteljährlich, Ende und ausgelassene Monate", () => {
  const e = mk({ repeat: "monthly", end: "2026-06", skip: ["2026-03"] });
  assert.equal(D.countUntil(e, m("2026-12")), 5);            // Jan–Jun = 6, minus März
  assert.equal(D.occursIn(e, m("2026-03")), false);
  assert.equal(D.occursIn(e, m("2026-04")), true);
  assert.equal(D.occursIn(e, m("2026-07")), false);
  const q = mk({ repeat: "quarterly", date: "2026-02-28", skip: ["2026-03"] });  // Skip außerhalb des Takts zählt nicht
  assert.equal(D.countUntil(q, m("2026-12")), 4);
  assert.equal(D.occDay(mk({ date: "2026-01-31", repeat: "monthly" }), m("2026-02")), "2026-02-28");
});

test("Bearbeiten: nur diesen Monat / ab jetzt / alles", () => {
  const base = [mk({ id: "s", repeat: "monthly", amount: 90000, note: "Miete" })];
  const t = m("2026-04");
  const only = D.applyEdit(base, "s", t, { amount: 95000, date: "2026-04-05", repeat: "monthly" }, "this");
  assert.equal(only.length, 2);
  assert.deepEqual(only[0].skip, ["2026-04"]);
  assert.equal(only[1].repeat, "none");
  assert.equal(D.monthData(only, t).sumOut, 95000);
  assert.equal(D.monthData(only, m("2026-05")).sumOut, 90000);

  const fut = D.applyEdit(base, "s", t, { amount: 95000, date: "2026-04-05", repeat: "monthly" }, "future");
  assert.equal(fut[0].end, "2026-03");
  assert.equal(D.monthData(fut, m("2026-03")).sumOut, 90000);
  assert.equal(D.monthData(fut, m("2026-09")).sumOut, 95000);

  const inStart = D.applyEdit(base, "s", m("2026-01"), { amount: 1 }, "future");
  assert.equal(inStart.length, 1);                            // im Startmonat: direkt ändern
  assert.equal(base[0].amount, 90000);                        // Original unverändert (immutabel)
});

test("Löschen: nur diesen Monat / ab jetzt / ganz", () => {
  const base = [mk({ id: "s", repeat: "monthly" })];
  assert.deepEqual(D.deleteOcc(base, "s", m("2026-03"), "this")[0].skip, ["2026-03"]);
  assert.equal(D.deleteOcc(base, "s", m("2026-03"), "future")[0].end, "2026-02");
  assert.equal(D.deleteOcc(base, "s", m("2026-01"), "future").length, 0);
  assert.equal(D.deleteOcc(base, "s", m("2026-03"), "all").length, 0);
});

test("Kassenstand mit Anfangsbestand und tagesgenau", () => {
  const st = { opening: { amount: 100000, date: "2026-03-10" }, entries: [
    mk({ amount: 5000, date: "2026-03-09" }),                         // vor Stichtag → zählt nicht
    mk({ amount: 2000, date: "2026-03-10" }),                         // am Stichtag → zählt
    mk({ type: "in", amount: 300000, date: "2026-01-25", repeat: "monthly" }),   // Gehalt am 25.
  ] };
  assert.equal(D.balanceAt(st, "2026-03-09"), null);
  assert.equal(D.balanceAt(st, "2026-03-20"), 98000);
  assert.equal(D.balanceAt(st, "2026-03-25"), 398000);
  assert.equal(D.balanceAt({ ...st, opening: null }, "2026-01-31"), 300000);
});

test("Kontoabgleich bucht Differenz als Sonstiges", () => {
  const st = { opening: { amount: 10000, date: "2026-01-01" }, entries: [] };
  const plus = D.reconcileEntry(st, 12345, "2026-02-01");
  assert.equal(plus.type, "in"); assert.equal(plus.amount, 2345); assert.equal(plus.cat, "Sonstiges");
  assert.equal(plus.note, D.KONTOABGLEICH);
  assert.equal(D.reconcileEntry(st, 9000, "2026-02-01").type, "out");
  assert.equal(D.reconcileEntry(st, 10000, "2026-02-01"), null);
  const after = { ...st, entries: [plus] };
  assert.equal(D.balanceAt(after, "2026-02-01"), 12345);
});

test("Migration: 1.5.0-Export bleibt erhalten, neue Felder kommen dazu, Müll fliegt raus", () => {
  const old = { schemaVersion: 2, budget: 50000, entries: [
    { id: "a", type: "out", amount: 950, cat: "Wohnen", note: "", date: "2026-11-03", repeat: "monthly", end: null, schemaVersion: 2 },
    { id: "b", type: "bogus", amount: 1, cat: "X", date: "2026-01-01", repeat: "none", end: null, schemaVersion: 2 },
  ] };
  const st = D.migrate(old);
  assert.equal(st.entries.length, 1);
  assert.deepEqual(st.entries[0].skip, []);
  assert.equal(st.budget, 50000);
  assert.equal(st.opening, null);
  assert.ok(st.cats.out.some(([n]) => n === "Sonstiges"));
  assert.equal(st.lock, false);
  const round = D.migrate(JSON.parse(JSON.stringify({ ...st, opening: { amount: -500, date: "2026-01-01" },
    catBudgets: { Wohnen: 1000, Bad: -3 }, goals: [{ id: "g", name: "Urlaub", target: 150000, saved: 2000 }], lock: true })));
  assert.deepEqual(round.opening, { amount: -500, date: "2026-01-01" });
  assert.deepEqual(round.catBudgets, { Wohnen: 1000 });
  assert.equal(round.goals.length, 1);
  assert.equal(round.lock, true);
  assert.equal(D.migrate(null).entries.length, 0);
});

test("Kategorien umbenennen/löschen ziehen Buchungen und Budget mit", () => {
  const st = D.migrate({ entries: [mk({ cat: "Wohnen" }), mk({ type: "in", cat: "Gehalt" })], catBudgets: { Wohnen: 5000 } });
  const r = D.renameCat(st, "out", "Wohnen", "Miete & Co", "🏡");
  assert.equal(r.entries[0].cat, "Miete & Co");
  assert.equal(r.catBudgets["Miete & Co"], 5000);
  assert.equal(r.catBudgets.Wohnen, undefined);
  assert.ok(r.cats.out.some(([n, i]) => n === "Miete & Co" && i === "🏡"));
  assert.equal(D.renameCat(st, "out", "Wohnen", "Abos"), st);   // Name vergeben → keine Änderung
  const d = D.deleteCat(r, "out", "Miete & Co");
  assert.equal(d.entries[0].cat, "Sonstiges");
  assert.equal(d.entries[1].cat, "Gehalt");
  assert.equal(D.deleteCat(st, "out", "Sonstiges"), st);
});

test("Schnellbuchung: häufige Buchungen, ohne Kontoabgleich und Einzelstücke", () => {
  const e = [
    mk({ note: "Bäcker", amount: 340, cat: "Lebensmittel", date: "2026-11-20" }),
    mk({ note: "Bäcker", amount: 340, cat: "Lebensmittel", date: "2026-11-25" }),
    mk({ note: D.KONTOABGLEICH, amount: 1, cat: "Sonstiges", date: "2026-11-20" }),
    mk({ note: D.KONTOABGLEICH, amount: 1, cat: "Sonstiges", date: "2026-11-21" }),
    mk({ note: "Kino", amount: 1200, cat: "Freizeit", date: "2026-11-22" }),
  ];
  const q = D.quickSuggestions(e, "2026-11-28");
  assert.equal(q.length, 1);
  assert.equal(q[0].note, "Bäcker"); assert.equal(q[0].count, 2);
});

test("Suche über Zeitraum, Text, Typ und Kategorie inkl. Serien", () => {
  const e = [mk({ note: "Tanken Aral", cat: "Mobilität", amount: 6000, date: "2026-02-10" }),
             mk({ note: "Miete", repeat: "monthly", date: "2026-01-01" })];
  assert.equal(D.search(e, { q: "aral", from: "2026-01-01", to: "2026-12-31" }).length, 1);
  assert.equal(D.search(e, { cat: "Wohnen", from: "2026-01-01", to: "2026-03-31" }).length, 3);
  assert.equal(D.search(e, { from: "2026-02-11", to: "2026-02-28" }).length, 0);
  assert.equal(D.search(e, { type: "in", from: "2026-01-01", to: "2026-12-31" }).length, 0);
});

test("Review-Fixes: Tausenderpunkt, keine Exoten-Zahlen, Pflicht-ID, reservierte Namen", () => {
  assert.equal(D.parseSigned("1.500"), 150000);
  assert.equal(D.parseSigned("-2.345.678"), -234567800);
  assert.equal(D.parseSigned("12.50"), 1250);
  assert.ok(Number.isNaN(D.parseSigned("1e3")));
  assert.ok(Number.isNaN(D.parseSigned("0x10")));
  assert.equal(D.isValid(mk({ id: "" })), false);
  assert.equal(D.isValid(mk({ repeat: "toString" })), false);
  const st = D.migrate({ entries: [mk({ cat: "Wohnen" })], catBudgets: { __proto__x: 5, constructor: 100 } });
  assert.equal(Object.hasOwn(st.catBudgets, "constructor"), false);
  assert.equal(D.renameCat(st, "out", "Wohnen", "constructor"), st);
});

test("Review-Fixes: 'ab jetzt' übernimmt ausgelassene Folgemonate und überlappt nicht", () => {
  const base = [mk({ id: "s", repeat: "monthly", skip: ["2026-02", "2026-06"] })];
  const t = m("2026-04");
  const [old, neu] = D.applyEdit(base, "s", t, { amount: 2000, date: "2026-02-05" }, "future");
  assert.deepEqual(old.skip, ["2026-02"]);
  assert.deepEqual(neu.skip, ["2026-06"]);
  assert.equal(neu.date, "2026-04-05");                       // nicht vor Monat t
  const after = [old, neu];
  assert.equal(D.monthData(after, m("2026-06")).items.length, 0);
  assert.equal(D.monthData(after, m("2026-04")).sumOut, 2000);
  assert.equal(D.monthData(after, m("2026-03")).sumOut, 1000);
});

test("Weitere Konten: Migration behält gültige Konten, verwirft kaputte", () => {
  const st = D.migrate({ accounts: [
    { id: "a", name: "Sparbuch", icon: "🐷", balance: 250000, updated: "2026-11-01", prev: 240000 },
    { name: "Schulden", balance: -5000, updated: "2026-11-02" },
    { name: "", balance: 1, updated: "2026-11-02" },
    { name: "Kaputt", balance: 1.5, updated: "2026-11-02" },
  ] });
  assert.equal(st.accounts.length, 2);
  assert.deepEqual(st.accounts[0], { id: "a", name: "Sparbuch", icon: "🐷", balance: 250000, updated: "2026-11-01", prev: 240000 });
  assert.equal(st.accounts[1].prev, null);
  assert.equal(st.accounts[1].icon, "🏦");
  assert.deepEqual(D.migrate({}).accounts, []);
});

test("Halbjährlich: alle 6 Monate", () => {
  const e = mk({ repeat: "halfyearly", date: "2026-01-10" });
  assert.equal(D.countUntil(e, m("2026-12")), 2);
  assert.equal(D.occursIn(e, m("2026-07")), true);
  assert.equal(D.occursIn(e, m("2026-04")), false);
  assert.equal(D.isValid(e), true);
  assert.equal(D.REP_LABEL.halfyearly, "halbjährlich");
});

test("Sicherungen: Namen, Aufräumen, Beschriftung, Zählung", () => {
  assert.equal(D.backupName("2026-11-28"), "kassenbuch-2026-11-28.json");
  assert.equal(D.backupName("2026-11-28", "vor-1.5.7"), "kassenbuch-2026-11-28-vor-1.5.7.json");
  assert.equal(D.backupName("2026-11-28", "a/b c"), "kassenbuch-2026-11-28-abc.json");
  const names = ["kassenbuch-2026-11-20.json", "kassenbuch-2026-11-28.json", "kassenbuch-2026-11-25-vor-1.5.6.json", "anderes.txt"];
  assert.deepEqual(D.backupsToDelete(names, 2), ["kassenbuch-2026-11-20.json"]);
  assert.equal(D.backupLabel("kassenbuch-2026-11-25-vor-1.5.6.json"), "25.11.2026, vor Update von 1.5.6");
  assert.equal(D.backupLabel("kassenbuch-2026-11-28.json"), "28.11.2026, täglich");
  assert.equal(D.entryCount(JSON.stringify({ entries: [1, 2, 3] })), 3);
  assert.equal(D.entryCount("kaputt"), 0);
  assert.equal(D.entryCount(null), 0);
});
