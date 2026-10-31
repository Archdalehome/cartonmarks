/**
 * tools/render-text-sample.mjs —— 用 PDF 导出同一套字形路径生成 SVG 样张
 * 用途：肉眼核对中文字形、基线、折行是否正常（开发自测，不参与线上）
 *
 * 用法：node tools/render-text-sample.mjs
 * 输出：.tmp/text-sample.svg
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { wrapText } from '../assets/js/pdf-export.js';

const ctx = { console };
ctx.globalThis = ctx;
ctx.self = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('vendor/opentype.min.js', 'utf8'), ctx);
const opentype = ctx.opentype;

const buf = fs.readFileSync('vendor/fonts/carton-sans.ttf');
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const LINE_HEIGHT = 1.22;
const ascent = font.ascender / font.unitsPerEm;
const descent = -font.descender / font.unitsPerEm;
const lead = (LINE_HEIGHT - (ascent + descent)) / 2 + ascent;

function pathD(path) {
  let d = '';
  for (const cmd of path.commands) {
    if (cmd.type === 'M') d += `M${cmd.x.toFixed(2)} ${cmd.y.toFixed(2)}`;
    else if (cmd.type === 'L') d += `L${cmd.x.toFixed(2)} ${cmd.y.toFixed(2)}`;
    else if (cmd.type === 'C') d += `C${cmd.x1.toFixed(2)} ${cmd.y1.toFixed(2)} ${cmd.x2.toFixed(2)} ${cmd.y2.toFixed(2)} ${cmd.x.toFixed(2)} ${cmd.y.toFixed(2)}`;
    else if (cmd.type === 'Q') d += `Q${cmd.x1.toFixed(2)} ${cmd.y1.toFixed(2)} ${cmd.x.toFixed(2)} ${cmd.y.toFixed(2)}`;
    else if (cmd.type === 'Z') d += 'Z';
  }
  return d;
}

const samples = [
  { text: '小心轻放', size: 64, y: 90 },
  { text: 'MADE IN CHINA', size: 32, y: 170 },
  { text: '600 × 400 × 300 mm', size: 28, y: 220 },
  { text: '防潮防湿 向上 易碎 请勿倒置', size: 26, y: 270 },
  { text: '型号：CM-600 数量：20 只', size: 24, y: 310 },
];

let out = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="380" viewBox="0 0 960 380">';
out += '<rect width="960" height="380" fill="#fff"/>';
out += '<g fill="#0f172a" stroke="none">';

for (const s of samples) {
  const lines = wrapText(font, s.text, s.size, 860);
  lines.forEach((line, i) => {
    const path = font.getPath(line, 40, s.y + i * s.size * LINE_HEIGHT, s.size);
    out += `<path d="${pathD(path)}"/>`;
  });
}

out += '</g></svg>';
fs.mkdirSync('.tmp', { recursive: true });
fs.writeFileSync('.tmp/text-sample.svg', out);
console.log('wrote .tmp/text-sample.svg', out.length, 'bytes');
