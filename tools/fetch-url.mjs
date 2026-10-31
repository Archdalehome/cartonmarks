/**
 * tools/fetch-url.mjs —— 走 SOCKS5 抓取一个 URL 并输出响应（仅本地自测用）
 *
 * 本机 curl / PowerShell 在受限环境里拿不到 TLS 凭据，
 * 这里用 node 自带的 net + tls 手写最简单的 SOCKS5 CONNECT，够抓线上页面做部署校验。
 *
 * 用法：node tools/fetch-url.mjs https://cartonmarks.pages.dev/ [socks5h://127.0.0.1:10808]
 */
import net from 'node:net';
import tls from 'node:tls';
import { URL } from 'node:url';

const target = new URL(process.argv[2] || 'https://cartonmarks.pages.dev/');
const proxy = new URL(process.argv[3] || 'socks5h://127.0.0.1:10808');
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
        const req = Buffer.concat([
          Buffer.from([5, 1, 0, 3, hostBuf.length]),
          hostBuf,
          Buffer.from([destPort >> 8, destPort & 0xff]),
        ]);
        stage = 'connect';
        sock.write(req);
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

function readAll(socket) {
  return new Promise((resolve, reject) => {
    let out = '';
    socket.setEncoding('utf8');
    socket.on('data', (d) => {
      out += d;
    });
    socket.on('end', () => resolve(out));
    socket.on('close', () => resolve(out));
    socket.on('error', reject);
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
    'User-Agent: cartonmark-deploy-check\r\n' +
    'Accept: */*\r\n' +
    'Connection: close\r\n\r\n',
);

const text = await readAll(stream);
process.stdout.write(text);
