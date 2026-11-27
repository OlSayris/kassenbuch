// Kopiert die Web-App nach www/ (für Capacitor) und setzt die Versionsnummer aus sw.js ein.
// sw.js bleibt die einzige Quelle der Version – für PWA und APK.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "www");
const version = (fs.readFileSync(path.join(root, "sw.js"), "utf8").match(/VERSION\s*=\s*"([^"]+)"/) || [])[1];
if (!version) throw new Error("VERSION in sw.js nicht gefunden");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
const html = fs.readFileSync(path.join(root, "index.html"), "utf8")
  .replace('window.APP_VERSION = "";', `window.APP_VERSION = "${version}";`);
fs.writeFileSync(path.join(out, "index.html"), html);
fs.copyFileSync(path.join(root, "manifest.json"), path.join(out, "manifest.json"));
console.log(`www/ gebaut, Version ${version}`);
