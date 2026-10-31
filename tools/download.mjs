/**
 * tools/download.mjs —— 走 SOCKS5 下载文件（仅本地开发用，不参与线上）
 *
 * 用法：node tools/download.mjs <url> <output-path>
 */
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

const target = new URL(process.argv[2]);
const outPath = path.resolve(process.argv[3]);
const proxy = new URL(process.env.CM_PROXY || 'socks5h://127.0.0.1:10808');
const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));

function socksConnect(host, destPort) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(Number(proxy.port), proxy.hostname);
    let stage = 'greeting';
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 'greeting') {
        if (buf.length < 2) return;
        if (buf[1] !== 0) return reject(new Error('SOCKS5 认证方式不被接受'));
        buf = buf.subarray(2);
        const hostBuf = Buffer.from(host, 'utf8');
        sock.write(Buffer.concat([
          Buffer.from([5, 1, 0, 3, hostBuf.length]),
          hostBuf,
          Buffer.from([destPort >> 8, destPort & 0xff]),
        ]));
        stage = 'connect';
        return;
      }
      if (stage === 'connect') {
        if (buf.length < 10) return;
        if (buf[1] !== 0) return reject(new Error(`SOCKS5 连接失败，代码 ${buf[1]}`));
        sock.off('data', onData);
        stage = 'done';
        resolve(sock);
      }
    };
    sock.on('data', onData);
    sock.on('error', reject);
    sock.on('connect', () => sock.write(Buffer.from([5, 1, 0])));
  });
}

const raw = await socksConnect(target.hostname, port);
let stream = raw;
if (target.protocol === 'https:') {
  stream = tls.connect({ socket: raw, servername: target.hostname });
  await new Promise((res, rej) => {
    stream.once('secureConnect', res);
    stream.once('error', rej);
  });
}

stream.write(
  `GET ${target.pathname}${target.search} HTTP/1.1\r\n` +
    `Host: ${target.hostname}\r\n` +
    'User-Agent: cartonmark-dev\r\n' +
    'Accept: */*\r\n' +
    'Connection: close\r\n\r\n',
);

const chunks = [];
for await (const chunk of stream) chunks.push(chunk);
const res = Buffer.concat(chunks);

const sep = res.indexOf('\r\n\r\n');
if (sep < 0) throw new Error('HTTP 响应格式异常');
const header = res.subarray(0, sep).toString('latin1');
const status = Number((header.match(/^HTTP\/1\.[01] (\d+)/) || [])[1]);
if (status !== 200) throw new Error(`HTTP ${status}: ${header.split('\r\n')[0]}`);

let body = res.subarray(sep + 4);
if (/transfer-encoding:\s*chunked/i.test(header)) {
  const parts = [];
  let offset = 0;
  while (offset < body.length) {
    const lineEnd = body.indexOf('\r\n', offset);
    if (lineEnd < 0) break;
    const size = parseInt(body.subarray(offset, lineEnd).toString('latin1'), 16);
    if (!Number.isFinite(size) || size === 0) break;
    parts.push(body.subarray(lineEnd + 2, lineEnd + 2 + size));
    offset = lineEnd + 2 + size + 2;
  }
  body = Buffer.concat(parts);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, body);
console.log(`${status} ${body.length} bytes -> ${outPath}`);
