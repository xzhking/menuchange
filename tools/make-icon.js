'use strict';

/**
 * node tools/make-icon.js
 * 生成 icon.png（128×128，纯 Node，无第三方依赖）。
 * 图案：蓝色圆角方块 + 白色向上箭头 + 底部一条横线（"顶到菜单最上面"）。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const BG = [31, 111, 235]; // #1f6feb
const FG = [255, 255, 255];

// ---------------------------------------------------------------- CRC32 / PNG

let TABLE = null;
function crcTable() {
  if (TABLE) return TABLE;
  TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    TABLE[n] = c;
  }
  return TABLE;
}
function crc32(buf) {
  const t = crcTable();
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// ---------------------------------------------------------------- 形状判定

const R = 26;
function inRoundedSquare(x, y) {
  const cx = Math.min(Math.max(x, R), SIZE - R);
  const cy = Math.min(Math.max(y, R), SIZE - R);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= R * R + 0.001 || (x >= R && x <= SIZE - R) || (y >= R && y <= SIZE - R);
}
function edge(px, py, ax, ay, bx, by) {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = edge(px, py, ax, ay, bx, by);
  const d2 = edge(px, py, bx, by, cx, cy);
  const d3 = edge(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}
function inBox(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}
/** 前景图案：向上箭头（三角 + 箭杆）+ 底部横线 */
function inForeground(x, y) {
  if (inTriangle(x, y, 64, 24, 34, 62, 94, 62)) return true; // 箭头
  if (inBox(x, y, 53, 56, 75, 96)) return true;             // 箭杆
  if (inBox(x, y, 30, 104, 98, 112)) return true;           // 底横线
  return false;
}

// ---------------------------------------------------------------- 渲染（3×3 超采样）

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
let p = 0;
for (let y = 0; y < SIZE; y++) {
  raw[p++] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    let bgHits = 0;
    let fgHits = 0;
    for (let sy = 0; sy < 3; sy++) {
      for (let sx = 0; sx < 3; sx++) {
        const px = x + (sx + 0.5) / 3;
        const py = y + (sy + 0.5) / 3;
        if (!inRoundedSquare(px, py)) continue;
        bgHits++;
        if (inForeground(px, py)) fgHits++;
      }
    }
    const total = 9;
    const a = Math.round((bgHits / total) * 255);
    const f = fgHits / total;
    const [r0, g0, b0] = BG;
    const [r1, g1, b1] = FG;
    raw[p++] = Math.round(r0 + (r1 - r0) * f);
    raw[p++] = Math.round(g0 + (g1 - g0) * f);
    raw[p++] = Math.round(b0 + (b1 - b0) * f);
    raw[p++] = a;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(path.resolve(__dirname, '..'), 'icon.png');
fs.writeFileSync(out, png);
console.log(`icon.png 已生成：${out}（${png.length} 字节，${SIZE}×${SIZE}）`);
