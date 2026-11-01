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
let meCalls = 0; // CM_MOCK_EXPIRE=1 时用来数 /api/me 调用次数

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

  // CM_MOCK_EXPIRE=1：模拟「会话到期」——/api/me 只第一次正常，之后 401；
  // 模板接口也一律 401，用来测「点我的模板 → 401 → 顶栏落回游客态」这条路径
  if (process.env.CM_MOCK_EXPIRE === '1' && urlPath.startsWith('/api/templates')) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'unauthorized', message: 'mock: 会话已过期' }));
    return;
  }

  // 本地自测用假模板数据（CM_MOCK_SUB=1 时生效，不参与线上部署）
  if (process.env.CM_MOCK_SUB === '1' && urlPath.startsWith('/api/templates')) {
    const send = (status, body) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(body === null ? '' : JSON.stringify(body));
    };
    // 分享接口的假实现：给 nobody@nowhere.com 返回用户不存在，其余成功
    if (/^\/api\/templates\/[^/]+\/share$/.test(urlPath) && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
      });
      req.on('end', () => {
        let email = '';
        try {
          email = String(JSON.parse(raw).email || '').trim().toLowerCase();
        } catch {
          email = '';
        }
        if (email === 'nobody@nowhere.com') {
          send(404, { error: 'user_not_found', message: '该用户不存在' });
          return;
        }
        if (email === 'dev@local') {
          send(400, { error: 'user_is_self', message: '不能分享给自己' });
          return;
        }
        send(200, { shareId: 'sh_mock', toEmail: email });
      });
      return;
    }
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

  // CM_MOCK_EXPIRED_SUB=1：订阅已过期——/api/me 返回过去的时间，模板接口 403 not_subscribed
  if (process.env.CM_MOCK_EXPIRED_SUB === '1' && urlPath.startsWith('/api/templates')) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'not_subscribed', message: 'mock: 订阅已过期' }));
    return;
  }

  // 本地自测用假「收到的分享」：一条矩形箱模板（可直接载入）+ 一条 L 形模板（未订阅会被 403）
  if (process.env.CM_MOCK_SUB === '1' && urlPath.startsWith('/api/shared')) {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body === null ? '' : JSON.stringify(body));
    };
    if (urlPath === '/api/shared') {
      send(200, {
        items: [
          { shareId: 'sh_rsc', fromEmail: 'chief@b.com', name: '矩形箱模板（分享）', shape: 'rsc', sharedAt: '2026-10-31T08:00:00.000Z' },
          { shareId: 'sh_lshape', fromEmail: 'chief@b.com', name: 'L 形模板（分享）', shape: 'lshape', sharedAt: '2026-10-31T09:00:00.000Z' },
        ],
        total: 2,
        limit: 100,
        notice: '',
      });
      return;
    }
    if (urlPath === '/api/shared/sh_rsc') {
      send(200, { name: '矩形箱模板（分享）', shape: 'rsc', fromEmail: 'chief@b.com', data: { shape: 'rsc', dims: { L: 600, W: 400, H: 300 }, panels: {} } });
      return;
    }
    if (urlPath === '/api/shared/sh_lshape') {
      // 订阅过就放行，否则按后端契约返回 403 shape_locked
      send(403, { error: 'shape_locked', message: '这个模板是L 形箱专属，需要订阅后才能使用', shape: 'lshape' });
      return;
    }
    if (req.method === 'DELETE') {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    send(404, { error: 'share_not_found', message: 'mock: 分享不存在' });
    return;
  }

  if (process.env.CM_MOCK_SUB === '1' && urlPath === '/api/me') {
    // CM_MOCK_EXPIRE=1：第一次正常返回，之后一律 401，用来模拟「会话到期」
    if (process.env.CM_MOCK_EXPIRE === '1') {
      meCalls += 1;
      if (meCalls > 1) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'unauthorized', message: 'mock: 会话已过期' }));
        return;
      }
    }
    const expired = process.env.CM_MOCK_EXPIRED_SUB === '1';
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(
      JSON.stringify({
        user: { email: 'dev@local', isAdmin: true },
        subExpiresAt: new Date(Date.now() + (expired ? -86400e3 : 365 * 86400e3)).toISOString(),
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
