// Writes the PNG app icons (192 and 512 px) with no dependencies:
// a white square, a dark frame and a block letter "M", matching public/icon.svg.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function icono(size) {
  const u = size / 64; // draw in the same 64-unit grid as the SVG
  const oscuro = (x, y) => {
    const gx = x / u;
    const gy = y / u;
    const marco = gx >= 4 && gx <= 60 && gy >= 4 && gy <= 60 && !(gx > 8 && gx < 56 && gy > 8 && gy < 56);
    const patas = gy >= 18 && gy <= 46 && ((gx >= 15.5 && gx <= 20.5) || (gx >= 43.5 && gx <= 48.5));
    // Diagonals of the "M" from (18,18) to (32,34) and (46,18) to (32,34).
    const t = (gy - 18) / 16;
    const diag = t >= 0 && t <= 1 && (Math.abs(gx - (18 + 14 * t)) <= 2.8 || Math.abs(gx - (46 - 14 * t)) <= 2.8);
    return marco || patas || diag;
  };
  const filas = [];
  for (let y = 0; y < size; y++) {
    const fila = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const v = oscuro(x + 0.5, y + 0.5) ? 0x22 : 0xff;
      fila.fill(v, 1 + x * 3, 4 + x * 3);
    }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(filas))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), icono(size));
  console.log(`public/icon-${size}.png`);
}
