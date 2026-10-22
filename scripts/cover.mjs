// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a dark home-cinema gradient,
// a video processor in its rack on the left (front display, blue status
// light) and a widescreen image with HDR highlights on the right, linked by
// a signal path. Plain Node (zlib), no dependency. Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
/** Antialiased coverage of a signed distance (negative inside). */
const inside = (distance) => Math.min(1, Math.max(0, 0.5 - distance));

/** Signed distance to a rounded rectangle centred on (cx, cy). */
function roundRect(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - halfW + radius;
  const qy = Math.abs(y - cy) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

const DARK = [6, 8, 14];
const NIGHT = [20, 22, 46];
const BODY = [26, 27, 32];
const BODY_LIGHT = [58, 60, 70];
const PANEL = [10, 11, 14];
const DISPLAY = [20, 60, 110];
const LED = [70, 150, 255];
const PATH = [90, 140, 255];
const FRAME = [36, 36, 44];
const SKY_TOP = [255, 150, 70];
const SKY_LOW = [40, 30, 90];
const SUN = [255, 246, 220];

const BOX = { cx: 200, cy: 300, w: 150, h: 40 };
const SCR = { cx: 590, cy: 250, w: 170, h: 72 };

function pixel(x, y) {
  let color = mix(DARK, NIGHT, (x / WIDTH) * 0.6 + (1 - y / HEIGHT) * 0.4);
  // The signal path, from the processor to the screen.
  if (x > BOX.cx + BOX.w && x < SCR.cx - SCR.w) {
    const t = (x - BOX.cx - BOX.w) / (SCR.cx - SCR.w - BOX.cx - BOX.w);
    const py = BOX.cy + (SCR.cy - BOX.cy) * (3 * t * t - 2 * t * t * t);
    const glow = Math.max(0, 1 - Math.abs(y - py) / 6);
    color = mix(color, PATH, glow * 0.85);
  }
  // The screen: a frame, then a sunset with an HDR highlight.
  color = mix(color, FRAME, inside(roundRect(x, y, SCR.cx, SCR.cy, SCR.w + 8, SCR.h + 8, 4)));
  const image = roundRect(x, y, SCR.cx, SCR.cy, SCR.w, SCR.h, 2);
  if (image < 1) {
    const v = (y - (SCR.cy - SCR.h)) / (2 * SCR.h);
    let sky = mix(SKY_TOP, SKY_LOW, v);
    const sun = Math.hypot(x - (SCR.cx + 40), y - (SCR.cy + 6));
    sky = mix(sky, SUN, Math.max(0, 1 - sun / 46) ** 1.5);
    const hill = SCR.cy + 30 + 14 * Math.sin((x - SCR.cx) / 38);
    sky = mix(sky, [18, 14, 30], inside(hill - y));
    color = mix(color, sky, inside(image));
  }
  // Floor shadow under the processor.
  const shadow = Math.hypot((x - BOX.cx) / 190, (y - 352) / 10);
  color = mix(color, [0, 0, 0], (1 - shadow) * 0.8);
  // The processor: body lit from above, front display, status light, vents.
  const body = roundRect(x, y, BOX.cx, BOX.cy, BOX.w, BOX.h, 8);
  color = mix(color, mix(BODY_LIGHT, BODY, (y - BOX.cy + BOX.h) / (2 * BOX.h)), inside(body));
  color = mix(color, PANEL, inside(roundRect(x, y, BOX.cx - 40, BOX.cy, 54, 16, 3)));
  const lit = roundRect(x, y, BOX.cx - 40, BOX.cy, 50, 12, 2);
  color = mix(color, mix(DISPLAY, LED, 0.25 + 0.25 * Math.sin(x / 7)), inside(lit));
  for (let i = 0; i < 5; i += 1) {
    color = mix(color, PANEL, inside(roundRect(x, y, 260 + i * 16, BOX.cy, 3, 18, 2)));
  }
  color = mix(color, LED, inside(Math.hypot(x - 76, y - BOX.cy) - 5));
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);
