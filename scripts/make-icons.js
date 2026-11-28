// Erzeugt alle App-Icons aus assets/icon-source.webp (blaues, abgerundetes Quadrat auf hellem Grund).
// Ausgabe: assets/icon-only.png, icon-foreground.png, icon-background.png (für @capacitor/assets)
//          icons/icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png (Web/PWA)
// Aufruf: node scripts/make-icons.js && npx @capacitor/assets generate --android
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const SRC = path.join(root, "assets/icon-source.webp");
const BOX = { left: 170, top: 169, width: 915, height: 882 };   // blaues Quadrat im Quellbild
const RADIUS = 190;
const SIZE = 1024;
const BG_FROM = "#3a9cfb", BG_TO = "#0036a3";                  // Verlauf wie im Original

// inset > 0 schneidet den hellen, weichgezeichneten Rand des Quadrats mit ab (sonst bleibt eine Linie stehen)
const roundedMask = (w, h, r, inset = 0) => Buffer.from(`<svg width="${w}" height="${h}"><rect x="${inset}" y="${inset}" `
  + `width="${w - 2 * inset}" height="${h - 2 * inset}" rx="${r - inset}" ry="${r - inset}" fill="#fff"/></svg>`);
const gradient = (s) => Buffer.from(`<svg width="${s}" height="${s}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="${BG_FROM}"/><stop offset="1" stop-color="${BG_TO}"/></linearGradient></defs>
  <rect width="${s}" height="${s}" fill="url(#g)"/></svg>`);

/** Blaues Quadrat mit transparenten Ecken */
async function roundedSquare(inset = 0) {
  return sharp(SRC).extract(BOX).ensureAlpha()
    .composite([{ input: roundedMask(BOX.width, BOX.height, RADIUS, inset), blend: "dest-in" }]).png().toBuffer();
}

/** Notizblock + Münzen freistellen: Füllung vom Rand aus über den blauen Verlauf (stoppt an den dunklen Umrissen) */
async function extractContent(squarePng) {
  const { data, info } = await sharp(squarePng).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info, C = 4;
  const at = (x, y) => (y * W + x) * C;
  const isBg = (i) => data[i + 3] < 128 || (data[i + 2] > 110 && data[i + 2] - data[i] > 70);   // transparent oder kräftiges Blau
  const close = (i, j) => Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]) < 60;
  const seen = new Uint8Array(W * H), stack = [];
  for (let x = 0; x < W; x++) stack.push([x, 0], [x, H - 1]);
  for (let y = 0; y < H; y++) stack.push([0, y], [W - 1, y]);
  while (stack.length) {
    const [x, y] = stack.pop(), k = y * W + x;
    if (seen[k]) continue;
    seen[k] = 1;
    const i = at(x, y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx]) continue;
      const j = at(nx, ny);
      if (isBg(j) && (data[i + 3] < 128 || close(i, j))) stack.push([nx, ny]);
    }
  }
  for (let k = 0; k < W * H; k++) if (seen[k]) data[k * C + 3] = 0;
  return sharp(data, { raw: { width: W, height: H, channels: C } }).png().toBuffer();
}

/** Inhalt so skalieren, dass er im sichtbaren Kreis eines adaptiven Icons liegt (≈ 62 % Durchmesser) */
async function centered(contentPng, canvas, diameterRatio) {
  const trimmed = await sharp(contentPng).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info, diag = Math.hypot(width, height);
  const scale = (canvas * diameterRatio) / diag;
  const w = Math.round(width * scale), h = Math.round(height * scale);
  const img = await sharp(trimmed.data).resize(w, h).toBuffer();
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: img, left: Math.round((canvas - w) / 2), top: Math.round((canvas - h) / 2) }]).png().toBuffer();
}

(async () => {
  fs.mkdirSync(path.join(root, "icons"), { recursive: true });
  const square = await roundedSquare();
  const content = await extractContent(await roundedSquare(28));
  // Android: @capacitor/assets setzt Vorder-/Hintergrund mit 16,7 % Inset ein → sichtbares Fenster = ganzes Bild,
  // runde Maske = Kreis über die volle Breite. Inhalt darf daher fast die ganze Fläche nutzen (Diagonale 92 %).
  const fg = await centered(content, SIZE, 0.92);
  const bg = await sharp(gradient(SIZE)).png().toBuffer();
  // Web „maskable“: sichere Zone ist ein Kreis mit 80 % Durchmesser → Diagonale 75 %
  const full = await sharp(bg).composite([{ input: await centered(content, SIZE, 0.75) }]).png().toBuffer();
  const legacy = await sharp(square).resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

  await sharp(legacy).toFile(path.join(root, "assets/icon-only.png"));
  await sharp(fg).toFile(path.join(root, "assets/icon-foreground.png"));
  await sharp(bg).toFile(path.join(root, "assets/icon-background.png"));
  await sharp(legacy).resize(192, 192).toFile(path.join(root, "icons/icon-192.png"));
  await sharp(legacy).resize(512, 512).toFile(path.join(root, "icons/icon-512.png"));
  await sharp(full).resize(512, 512).toFile(path.join(root, "icons/maskable-512.png"));
  await sharp(full).resize(180, 180).flatten({ background: BG_FROM }).toFile(path.join(root, "icons/apple-touch-icon.png"));
  console.log("Icons erzeugt");
})();
