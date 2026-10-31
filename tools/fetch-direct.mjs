/**
 * tools/fetch-direct.mjs —— 直连下载（开发用）
 * 用法：node tools/fetch-direct.mjs <url> <output>
 */
import fs from 'node:fs';
import path from 'node:path';

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error('用法：node tools/fetch-direct.mjs <url> <output>');
  process.exit(1);
}

const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) {
  console.error(`HTTP ${res.status} ${url}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, buf);
console.log(`${res.status} ${buf.length} bytes -> ${out}`);
