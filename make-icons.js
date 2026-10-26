// Generates icons/icon-{16,32,48,128}.png (red) and icons/icon-off-*.png (grey, used when paused)
// Usage: node make-icons.js

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZES = [16, 32, 48, 128];
const SAMPLES = 4; // 4x4 supersampling for smooth edges

const THEMES = {
  icon: { top: [235, 72, 72], bottom: [190, 30, 45] },
  "icon-off": { top: [160, 160, 160], bottom: [110, 110, 110] },
};

// Shield shape in 0..1 coordinates
function inShield(x, y) {
  if (y < 0.06 || y > 0.96) return false;
  const dx = Math.abs(x - 0.5);
  if (y <= 0.52) {
    // Slightly curved top edge
    const top = 0.06 + 0.06 * (dx / 0.42) ** 2;
    return dx <= 0.42 && y >= top;
  }
  const t = (y - 0.52) / 0.44;
  return dx <= 0.42 * Math.sqrt(1 - t * t);
}

// White "no" sign: ring + diagonal slash
function inSymbol(x, y) {
  const cx = 0.5, cy = 0.47, r = 0.22, w = 0.075;
  const dx = x - cx, dy = y - cy;
  const d = Math.hypot(dx, dy);
  if (d <= r && d >= r - w) return true;
  // Slash from top-left to bottom-right, inside the ring
  const slash = Math.abs(dx - dy) / Math.SQRT2;
  return d < r && slash <= w / 2;
}

function render(size, theme) {
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxX = 0; pxX < size; pxX++) {
      let shield = 0, symbol = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (pxX + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (inShield(x, y)) {
            shield++;
            if (inSymbol(x, y)) symbol++;
          }
        }
      }
      const n = SAMPLES * SAMPLES;
      const alpha = shield / n;
      const white = shield ? symbol / shield : 0;
      const g = py / (size - 1);
      const i = (py * size + pxX) * 4;
      for (let c = 0; c < 3; c++) {
        const base = theme.top[c] + (theme.bottom[c] - theme.top[c]) * g;
        px[i + c] = Math.round(base + (255 - base) * white);
      }
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

// ---------- Minimal PNG encoder ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
  for (const size of SIZES) {
    const file = path.join(outDir, `${name}-${size}.png`);
    fs.writeFileSync(file, encodePng(size, render(size, theme)));
    console.log(`Wrote ${path.relative(__dirname, file)}`);
  }
}
