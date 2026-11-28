// Minimaler statischer Server für lokale Tests: node scripts/serve.js [port]
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const port = +process.argv[2] || 8137;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".webp": "image/webp" };

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  if (url.endsWith("/")) url += "index.html";
  const file = path.join(root, path.normalize(url));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }   // kein Zugriff außerhalb des Projekts
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(port, "127.0.0.1", () => console.log(`http://localhost:${port}`));
