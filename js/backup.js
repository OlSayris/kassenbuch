/* Kassenbuch – Laden beim Start und automatische Sicherungen, damit bei Updates nie Daten verloren gehen.
   - Vor einem Versionswechsel werden die Rohdaten gesichert, BEVOR die neue Version sie umwandelt.
   - Täglich eine Sicherung; die neuesten BACKUP_KEEP bleiben.
   - Fehlt die Daten-Datei, wird automatisch die neueste Sicherung mit Buchungen wiederhergestellt.
   Android-App: Ordner „backups“ im App-Datenordner. Web: localStorage. Braucht js/data.js und js/ui.js. */
"use strict";

const BACKUP_KEEP = 10, WEB_BACKUP_KEY = "kassenbuch-backups", VERSION_KEY = "kb-version";
const FS = PLUGINS.Filesystem;
const webBackups = () => { try { return JSON.parse(localStorage.getItem(WEB_BACKUP_KEY) || "{}"); } catch { return {}; } };

const Backups = FS ? {
  async list() {
    try {
      const r = await FS.readdir({ path: "backups", directory: "DATA" });
      return r.files.map((f) => (typeof f === "string" ? f : f.name)).filter((n) => n.endsWith(".json")).sort().reverse();
    } catch { return []; }   // Ordner gibt es noch nicht
  },
  async read(name) { return (await FS.readFile({ path: `backups/${name}`, directory: "DATA", encoding: "utf8" })).data; },
  async write(name, raw) { await FS.writeFile({ path: `backups/${name}`, data: raw, directory: "DATA", encoding: "utf8", recursive: true }); },
  async remove(name) { await FS.deleteFile({ path: `backups/${name}`, directory: "DATA" }); },
} : {
  async list() { return Object.keys(webBackups()).sort().reverse(); },
  async read(name) { return webBackups()[name]; },
  async write(name, raw) { localStorage.setItem(WEB_BACKUP_KEY, JSON.stringify({ ...webBackups(), [name]: raw })); },
  async remove(name) { const b = webBackups(); delete b[name]; localStorage.setItem(WEB_BACKUP_KEY, JSON.stringify(b)); },
};

/** Rohdaten als Sicherung ablegen und alte Sicherungen aufräumen. Fehler hier dürfen den Start nie blockieren. */
async function backup(raw, tag) {
  try {
    await Backups.write(backupName(today(), tag), raw);
    for (const n of backupsToDelete(await Backups.list(), BACKUP_KEEP)) await Backups.remove(n).catch(() => {});
  } catch { /* Sicherung fehlgeschlagen – Daten-Datei bleibt unangetastet */ }
}
const currentJson = () => JSON.stringify({ schemaVersion: SCHEMA, ...state });

/** Rohdaten lesen: { raw, missing }. raw = null, wenn nicht vorhanden oder unlesbar (dann fileBroken). */
async function readRaw() {
  if (!FS) { const raw = localStorage.getItem(KEY); return { raw, missing: raw === null }; }
  try {
    return { raw: (await FS.readFile({ path: DATA_FILE, directory: "DATA", encoding: "utf8" })).data, missing: false };
  } catch (err) {
    if (/not exist|no such|not found/i.test(String(err && err.message))) return { raw: null, missing: true };
    fileBroken = true;   // vorhanden, aber nicht lesbar → niemals überschreiben
    toast("Daten-Datei nicht lesbar – bitte App neu starten. Es wurde nichts überschrieben.");
    return { raw: null, missing: false };
  }
}

/** Neueste Sicherung mit Buchungen zurückholen (nur wenn die Daten-Datei fehlt) */
async function restoreNewestBackup() {
  for (const name of await Backups.list()) {
    const raw = await Backups.read(name).catch(() => null);
    if (raw && entryCount(raw) > 0) {
      state = migrate(JSON.parse(raw));
      save();
      toast(`Daten aus der Sicherung vom ${backupLabel(name)} wiederhergestellt`);
      return true;
    }
  }
  return false;
}

/** Start: Daten laden, vorher sichern, bei fehlender Datei wiederherstellen */
async function startupLoad() {
  const { raw, missing } = await readRaw();
  if (fileBroken) return;
  const version = window.APP_VERSION || "web";
  const rawCount = raw ? entryCount(raw) : 0;
  if (rawCount > 0) {
    const prev = localStorage.getItem(VERSION_KEY);
    if (prev && prev !== version) await backup(raw, `vor-${prev}`);              // vor dem Update-Umwandeln sichern
    const todayPrefix = backupName(today()).slice(0, -".json".length);
    if (!(await Backups.list()).some((n) => n.startsWith(todayPrefix))) await backup(raw);   // tägliche Sicherung
  }
  if (FS && raw) {
    try { state = migrate(JSON.parse(raw)); }
    catch { fileBroken = true; toast("Daten-Datei beschädigt – unter ⚙ „Sicherung wiederherstellen“ wählen. Es wurde nichts überschrieben."); return; }
  } else if (missing) {
    // Keine Daten-Datei: zuerst localStorage (ältere Versionen), sonst neueste Sicherung
    if (state.entries.length) save();
    else await restoreNewestBackup();
  }
  if (rawCount > state.entries.length) {
    await backup(raw, "unlesbar");
    toast(`${rawCount - state.entries.length} Einträge konnten nicht gelesen werden – die Originaldaten sind gesichert.`);
  }
  try { localStorage.setItem(VERSION_KEY, version); } catch { /* nicht kritisch */ }
}

/* ---------- Einstellungen: Sicherung wiederherstellen ---------- */
$("#btnRestore").onclick = async () => {
  const names = await Backups.list();
  if (!names.length) return toast("Noch keine Sicherung vorhanden – sie entsteht automatisch beim nächsten Start");
  const pick = await ask("Welche Sicherung wiederherstellen?", names.slice(0, 8).map((n) => [n, backupLabel(n)]));
  if (!pick) return;
  let data;
  try { data = migrate(JSON.parse(await Backups.read(pick))); } catch { return toast("Diese Sicherung ist nicht lesbar"); }
  if (!confirm(`${data.entries.length} Buchungen aus der Sicherung „${backupLabel(pick)}“ übernehmen?\nDer aktuelle Stand wird vorher ebenfalls gesichert.`)) return;
  await backup(currentJson(), "vor-wiederherstellung");
  fileBroken = false;   // bewusste Wiederherstellung darf die Datei neu schreiben
  state = { ...data, lock: state.lock };
  save(); render();
  toast("Sicherung wiederhergestellt");
};
