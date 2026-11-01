/**
 * tools/serve.mjs —— 本地静态服务器（仅开发/自测用，不参与线上部署）
 * 用法：node tools/serve.mjs [port]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.join(ROOT, urlPath);

  // 本地自测用假模板数据（CM_MOCK_SUB=1 时生效，不参与线上部署）
  if (process.env.CM_MOCK_SUB === '1' && urlPath.startsWith('/api/templates')) {
    const send = (status, body) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(body === null ? '' : JSON.stringify(body));
    };
    const list = [
      { id: 't_mock_1', name: 'L 形柜体箱（示例）', updatedAt: '2026-10-31T07:20:00.000Z' },
      { id: 't_mock_2', name: '斜形汽配箱', updatedAt: '2026-10-30T12:05:00.000Z' },
    ];
    if (urlPath === '/api/templates' && req.method === 'GET') {
      send(200, { items: list });
      return;
    }
    if (urlPath === '/api/templates' && req.method === 'POST') {
      send(201, { id: 't_mock_new' });
      return;
    }
    if (urlPath.startsWith('/api/templates/') && req.method === 'GET') {
      send(200, {
        id: 't_mock_1',
        name: 'L 形柜体箱（示例）',
        updatedAt: '2026-10-31T07:20:00.000Z',
        data: {
          version: 1,
          shape: 'lshape',
          unit: 'mm',
          dims: { L: 600, Hfront: 300, Hback: 450, Wfront: 250, Wback: 150 },
          panels: { front: { elements: [] }, topLid: { elements: [] } },
        },
      });
      return;
    }
    if (urlPath.startsWith('/api/templates/') && req.method === 'DELETE') {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    send(404, { error: 'not_found', message: 'mock: 未实现的模板接口' });
    return;
  }

  if (process.env.CM_MOCK_SUB === '1' && urlPath.startsWith('/api/admin/')) {
    const send = (status, body) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(body === null ? '' : JSON.stringify(body));
    };
    if (urlPath === '/api/admin/users' && req.method === 'GET') {
      send(200, {
        items: [
          {
            id: 'u_mock_admin',
            email: 'admin@support.qafield.com',
            createdAt: '2026-10-01T00:00:00.000Z',
            subExpiresAt: '2027-10-31T00:00:00.000Z',
            isAdmin: true,
          },
          {
            id: 'u_mock_alice',
            email: 'alice@example.com',
            createdAt: '2026-10-20T09:12:00.000Z',
            subExpiresAt: null,
            isAdmin: false,
          },
          {
            id: 'u_mock_bob',
            email: 'bob@example.com',
            createdAt: '2026-10-28T15:40:00.000Z',
            subExpiresAt: '2026-11-25T00:00:00.000Z',
            isAdmin: false,
          },
        ],
        nextCursor: null,
      });
      return;
    }
    if (urlPath.endsWith('/sub') && req.method === 'POST') {
      send(200, { id: 'u_mock_alice', email: 'alice@example.com', subExpiresAt: new Date(Date.now() + 30 * 86400e3).toISOString(), changedDays: 30 });
      return;
    }
    if (req.method === 'DELETE') {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    send(404, { error: 'not_found', message: 'mock: 未实现的接口' });
    return;
  }

  if (process.env.CM_MOCK_SUB === '1' && urlPath === '/api/me') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(
      JSON.stringify({
        user: { email: 'dev@local', isAdmin: true },
        subExpiresAt: new Date(Date.now() + 365 * 86400e3).toISOString(),
      }),
    );
    return;
  }

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (urlPath === '/' || urlPath === '') filePath = path.join(ROOT, 'index.html');

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.readFile(filePath, (e, data) => {
      if (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Carton Mark dev server → http://127.0.0.1:${PORT}/`);
});
