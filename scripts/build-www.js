// Kopiert die Web-App nach www/ (für Capacitor) und setzt die Versionsnummer aus sw.js ein.
// sw.js bleibt die einzige Quelle der Version – für PWA und APK.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "www");
const FILES = ["index.html", "manifest.json", "js/data.js", "js/ui.js", "js/accounts.js", "js/budget.js", "js/more.js"];
const PLACEHOLDER = 'window.APP_VERSION = "";';

const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const version = (sw.match(/VERSION\s*=\s*"([^"]+)"/) || [])[1];
if (!version) throw new Error("VERSION in sw.js nicht gefunden");
// Jede App-Datei muss auch im Service-Worker-Cache stehen, sonst ist die PWA offline kaputt
for (const f of FILES) if (!sw.includes(`"./${f}"`)) throw new Error(`sw.js FILES fehlt: ./${f}`);

fs.rmSync(out, { recursive: true, force: true });
for (const f of FILES) {
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  fs.copyFileSync(path.join(root, f), path.join(out, f));
}
const uiPath = path.join(out, "js/ui.js");
const ui = fs.readFileSync(uiPath, "utf8");
if (!ui.includes(PLACEHOLDER)) throw new Error("Platzhalter für APP_VERSION in js/ui.js nicht gefunden");
fs.writeFileSync(uiPath, ui.replace(PLACEHOLDER, `window.APP_VERSION = "${version}";`));
console.log(`www/ gebaut, Version ${version}`);
