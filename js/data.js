/* Kassenbuch – Daten & Rechenlogik (ohne DOM, auch in Node testbar).
   Alle Beträge in Cent (Integer). Monate als fortlaufende Zahl: Jahr*12 + Monat(0–11). */
"use strict";

const SCHEMA = 3;
const KONTOABGLEICH = "Kontoabgleich";
const STEP = { none: 0, monthly: 1, quarterly: 3, yearly: 12 };   // Abstand in Monaten
const REP_LABEL = { monthly: "monatlich", quarterly: "vierteljährlich", yearly: "jährlich" };
const DEFAULT_CATS = {
  out: [["Wohnen", "🏠"], ["Lebensmittel", "🛒"], ["Mobilität", "🚗"], ["Freizeit", "🎉"], ["Abos", "📺"],
        ["Versicherung", "🛡️"], ["Sonstiges", "📦"]],
  in: [["Gehalt", "💼"], ["Rente", "🧓"], ["Nebenjob", "🧰"], ["Erstattung", "↩️"], ["Geschenk", "🎁"], ["Sonstiges", "💶"]],
};

/* ---------- Hilfsfunktionen ---------- */
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const monthIdx = (iso) => +iso.slice(0, 4) * 12 + (+iso.slice(5, 7) - 1);
const ymOf = (t) => `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
/** ISO-Datum für Monat t und Tag (auf Monatsende begrenzt) */
const toIso = (t, day) => {
  const y = Math.floor(t / 12), m = t % 12, last = new Date(y, m + 1, 0).getDate();
  return `${ymOf(t)}-${String(Math.min(day, last)).padStart(2, "0")}`;
};
const lastDay = (t) => toIso(t, 31);
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "12,5" | "1.234,56" | "12.50" → Cent (> 0) oder NaN */
function parseAmount(str) {
  const v = parseSigned(str);
  return v > 0 ? v : NaN;
}
/** Wie parseAmount, erlaubt aber 0 und negative Werte (Kontostand) */
function parseSigned(str) {
  let s = String(str).trim().replace(/[€\s]/g, "").replace(/^−/, "-");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");   // "1.500" = 1500 € (Tausenderpunkt)
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;                               // kein "1e3", "0x10", "-"
  return Math.round(Number(s) * 100);
}

/* ---------- Migration & Validierung ---------- */
/** Bringt einen Datensatz beliebiger Schema-Version auf die aktuelle Version. */
function migrateEntry(e) {
  let r = { ...e };
  if (!r.schemaVersion || r.schemaVersion < 2) {   // v1: nur Ausgaben, Betrag in Euro, einmalig
    r = { id: r.id || uid(), type: "out", amount: Math.round(Number(r.amount) * 100), cat: r.cat || "Sonstiges",
          note: r.note || "", date: r.date || today(), repeat: "none", end: null, schemaVersion: 2 };
  }
  if (r.schemaVersion < 3) r = { ...r, skip: [], schemaVersion: 3 };   // v3: ausgelassene Monate einer Serie
  return r;
}
const isValid = (e) => !!e && typeof e.id === "string" && e.id.length > 0 && (e.type === "in" || e.type === "out")
  && Number.isInteger(e.amount) && e.amount > 0
  && typeof e.cat === "string" && e.cat.length > 0 && ISO_DATE.test(e.date) && Object.hasOwn(STEP, e.repeat)
  && (e.end === null || /^\d{4}-\d{2}$/.test(e.end))
  && Array.isArray(e.skip) && e.skip.every((m) => /^\d{4}-\d{2}$/.test(m));

// Namen wie "constructor" oder "__proto__" würden als Objekt-Schlüssel Ärger machen → leer = ungültig
const cleanName = (s) => { const n = String(s || "").trim().slice(0, 30); return n in Object.prototype ? "" : n; };
function migrateCats(raw) {
  const ok = (list) => Array.isArray(list) && list.every((c) => Array.isArray(c) && cleanName(c[0]) && typeof c[1] === "string");
  const pick = (type) => {
    const list = raw && ok(raw[type]) ? raw[type].map(([n, i]) => [cleanName(n), String(i).slice(0, 8) || "•"]) : DEFAULT_CATS[type];
    return list.some(([n]) => n === "Sonstiges") ? list : [...list, DEFAULT_CATS[type].find(([n]) => n === "Sonstiges")];
  };
  return { out: pick("out"), in: pick("in") };
}
const posInt = (v) => (Number.isInteger(v) && v > 0 ? v : 0);

/** Komplette Daten (beliebige frühere Version) → aktueller Stand. Unbekanntes wird verworfen. */
function migrate(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const list = Array.isArray(raw) ? raw : (Array.isArray(r.entries) ? r.entries : []);
  const opening = r.opening && Number.isInteger(r.opening.amount) && ISO_DATE.test(r.opening.date)
    ? { amount: r.opening.amount, date: r.opening.date } : null;
  const catBudgets = {};
  if (r.catBudgets && typeof r.catBudgets === "object") {
    for (const [k, v] of Object.entries(r.catBudgets)) if (posInt(v) && cleanName(k)) catBudgets[cleanName(k)] = v;
  }
  const goals = (Array.isArray(r.goals) ? r.goals : [])
    .filter((g) => g && cleanName(g.name) && posInt(g.target) && Number.isInteger(g.saved))
    .map((g) => ({ id: String(g.id || uid()), name: cleanName(g.name), target: g.target, saved: g.saved }));
  return {
    entries: list.map(migrateEntry).filter(isValid),
    budget: posInt(r.budget),
    opening, catBudgets, goals,
    cats: migrateCats(r.cats),
    lock: r.lock === true,
  };
}

/* ---------- Wiederkehrende Buchungen ---------- */
const endIdx = (e) => (e.end ? monthIdx(e.end + "-01") : Infinity);
/** Fällt die Serie (ohne Ausnahmen) im Monat m an? */
const onSchedule = (e, m) => {
  const s = monthIdx(e.date);
  if (e.repeat === "none") return m === s;
  return m >= s && m <= endIdx(e) && (m - s) % STEP[e.repeat] === 0;
};
/** Anzahl Vorkommen von Start bis einschließlich Monat t (ausgelassene Monate abgezogen) */
function countUntil(e, t) {
  const s = monthIdx(e.date);
  if (e.repeat === "none") return s <= t ? 1 : 0;
  const last = Math.min(t, endIdx(e));
  if (last < s) return 0;
  const base = Math.floor((last - s) / STEP[e.repeat]) + 1;
  const skipped = e.skip.filter((ym) => { const m = monthIdx(ym + "-01"); return m <= last && onSchedule(e, m); }).length;
  return base - skipped;
}
const occursIn = (e, t) => onSchedule(e, t) && !e.skip.includes(ymOf(t));
const occDay = (e, t) => toIso(t, +e.date.slice(8));
const signed = (e) => (e.type === "in" ? e.amount : -e.amount);
/** Vorkommen mit Datum ≤ iso */
const countUntilDate = (e, iso) => {
  const t = monthIdx(iso);
  return countUntil(e, t - 1) + (occursIn(e, t) && occDay(e, t) <= iso ? 1 : 0);
};

/** Alle Vorkommen im Monat t (neueste zuerst) mit Summen */
function monthData(entries, t) {
  const items = entries.filter((e) => occursIn(e, t)).map((e) => ({ ...e, day: occDay(e, t), t }))
    .sort((a, b) => b.day.localeCompare(a.day));
  const total = (type) => items.filter((e) => e.type === type).reduce((s, e) => s + e.amount, 0);
  return { t, items, sumIn: total("in"), sumOut: total("out") };
}
/** Ausgaben je Kategorie */
const catTotals = (items) => items.filter((e) => e.type === "out")
  .reduce((acc, e) => ({ ...acc, [e.cat]: (acc[e.cat] || 0) + e.amount }), {});

/* ---------- Kassenstand ---------- */
/** Kassenstand am Ende des Tages iso. Mit Anfangsbestand: Bestand zu Beginn des Stichtags + alle
    Buchungen ab Stichtag. Vor dem Stichtag → null (unbekannt). Ohne Anfangsbestand: Summe ab 0. */
function balanceAt(st, iso) {
  const o = st.opening;
  if (o && iso < o.date) return null;
  const before = o ? addDays(o.date, -1) : null;
  return st.entries.reduce((s, e) => s + signed(e) * (countUntilDate(e, iso) - (before ? countUntilDate(e, before) : 0)),
    o ? o.amount : 0);
}
/** Kontoabgleich: Differenz echter Kontostand − App-Kassenstand heute → Buchung (oder null bei 0) */
function reconcileEntry(st, realCents, isoToday) {
  const diff = realCents - (balanceAt(st, isoToday) || 0);
  if (!diff) return null;
  return { id: uid(), type: diff > 0 ? "in" : "out", amount: Math.abs(diff), cat: "Sonstiges", note: KONTOABGLEICH,
           date: isoToday, repeat: "none", end: null, skip: [], schemaVersion: SCHEMA };
}

/* ---------- Bearbeiten & Löschen von Serien ---------- */
/** scope: "all" = ganze Buchung/Serie, "this" = nur Monat t, "future" = ab Monat t.
    patch = neue Werte {type, amount, cat, note, date, repeat}. Gibt neue Eintragsliste zurück. */
function applyEdit(entries, id, t, patch, scope) {
  const e = entries.find((x) => x.id === id);
  if (!e) return entries;
  const isStart = monthIdx(e.date) === t;
  if (e.repeat === "none" || scope === "all" || (scope === "future" && isStart)) {
    return entries.map((x) => (x.id === id ? { ...x, ...patch } : x));
  }
  const one = { ...e, ...patch, id: uid(), skip: [], end: null };
  if (scope === "this") {
    return [...entries.map((x) => (x.id === id ? { ...x, skip: [...x.skip, ymOf(t)] } : x)), { ...one, repeat: "none" }];
  }
  // future: neue Serie frühestens ab Monat t (keine Überschneidung), schon ausgelassene Folgemonate bleiben ausgelassen
  const date = monthIdx(one.date) < t ? toIso(t, +one.date.slice(8)) : one.date;
  const skip = e.skip.filter((ym) => ym >= ymOf(t));
  return [...entries.map((x) => (x.id === id ? { ...x, end: ymOf(t - 1), skip: x.skip.filter((ym) => ym < ymOf(t)) } : x)),
    { ...one, date, skip, end: e.end }];
}
function deleteOcc(entries, id, t, scope) {
  const e = entries.find((x) => x.id === id);
  if (!e) return entries;
  if (e.repeat === "none" || scope === "all" || (scope === "future" && monthIdx(e.date) === t)) {
    return entries.filter((x) => x.id !== id);
  }
  if (scope === "this") return entries.map((x) => (x.id === id ? { ...x, skip: [...x.skip, ymOf(t)] } : x));
  return entries.map((x) => (x.id === id ? { ...x, end: ymOf(t - 1) } : x));
}

/* ---------- Schnellbuchung ---------- */
/** Häufige einmalige Buchungen der letzten 120 Tage (mind. 2×), ohne Kontoabgleich */
function quickSuggestions(entries, isoToday, n = 6) {
  const since = addDays(isoToday, -120), groups = {};
  entries.filter((e) => e.repeat === "none" && e.note !== KONTOABGLEICH && e.date >= since && e.date <= isoToday)
    .forEach((e) => {
      const k = [e.type, e.cat, e.note, e.amount].join("|");
      const g = groups[k] || { type: e.type, cat: e.cat, note: e.note, amount: e.amount, count: 0, last: "" };
      groups[k] = { ...g, count: g.count + 1, last: e.date > g.last ? e.date : g.last };
    });
  return Object.values(groups).filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).slice(0, n);
}

/* ---------- Suche ---------- */
/** Alle Vorkommen zwischen from und to (ISO, inkl.), gefiltert nach Text, Typ und Kategorie */
function search(entries, { q = "", type = "", cat = "", from, to }) {
  const needle = q.trim().toLowerCase(), out = [];
  const t0 = monthIdx(from), t1 = Math.min(monthIdx(to), t0 + 12 * 20);   // höchstens 20 Jahre
  for (let t = t1; t >= t0; t--) {
    monthData(entries, t).items.forEach((e) => {
      if (e.day < from || e.day > to || (type && e.type !== type) || (cat && e.cat !== cat)) return;
      if (needle && !`${e.note} ${e.cat}`.toLowerCase().includes(needle)) return;
      out.push(e);
    });
  }
  return out;
}

/* ---------- Kategorien ---------- */
/** Umbenennen (und Symbol ändern): Buchungen und Budget ziehen mit */
function renameCat(st, type, oldName, newName, icon) {
  const name = cleanName(newName);
  if (!name || (name !== oldName && st.cats[type].some(([n]) => n === name))) return st;
  const cats = { ...st.cats, [type]: st.cats[type].map(([n, i]) => (n === oldName ? [name, icon || i] : [n, i])) };
  const entries = st.entries.map((e) => (e.type === type && e.cat === oldName ? { ...e, cat: name } : e));
  const catBudgets = { ...st.catBudgets };
  if (type === "out" && Object.hasOwn(catBudgets, oldName)) { catBudgets[name] = catBudgets[oldName]; if (name !== oldName) delete catBudgets[oldName]; }
  return { ...st, cats, entries, catBudgets };
}
/** Löschen: Buchungen wandern nach „Sonstiges“ (das selbst nicht löschbar ist) */
function deleteCat(st, type, name) {
  if (name === "Sonstiges") return st;
  const catBudgets = { ...st.catBudgets };
  if (type === "out") delete catBudgets[name];
  return { ...st, catBudgets,
    cats: { ...st.cats, [type]: st.cats[type].filter(([n]) => n !== name) },
    entries: st.entries.map((e) => (e.type === type && e.cat === name ? { ...e, cat: "Sonstiges" } : e)) };
}

if (typeof module !== "undefined") {
  module.exports = { SCHEMA, KONTOABGLEICH, STEP, DEFAULT_CATS, monthIdx, ymOf, toIso, lastDay, addDays, parseAmount,
    parseSigned, migrate, migrateEntry, isValid, countUntil, occursIn, occDay, monthData, catTotals, balanceAt,
    reconcileEntry, applyEdit, deleteOcc, quickSuggestions, search, renameCat, deleteCat };
}
