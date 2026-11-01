// 比对本地 HEAD 与 GitHub 远端 main 的树内容（只读，不推送）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_DIR = 'C:\\Users\\Chen\\DeepSeek Bot\\cartonmarks';
const OWNER = 'Archdalehome';
const REPO = 'cartonmarks';

const creds = fs.readFileSync(path.join(os.homedir(), '.git-credentials'), 'utf8').trim().split(/\r?\n/);
let token = null;
for (const line of creds) {
  const m = line.match(/^https:\/\/([^@\/]+)@github\.com\/?$/i);
  if (!m) continue;
  const u = m[1];
  const u2 = u.includes(':') ? u : 'x-access-token:' + u;
  if (u2.split(':')[0] === '146316889') token = u2.split(':').slice(1).join(':');
}
if (!token) throw new Error('no owner token');

const api = async (p) => {
  const r = await fetch('https://api.github.com' + p, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'cartonmarks-check',
    },
  });
  if (!r.ok) throw new Error(`${p} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/main`);
const commit = await api(`/repos/${OWNER}/${REPO}/git/commits/${ref.object.sha}`);
const tree = await api(`/repos/${OWNER}/${REPO}/git/trees/${commit.tree.sha}?recursive=1`);
const remote = new Map();
for (const e of tree.tree) if (e.type === 'blob') remote.set(e.path, e.sha);

const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_DIR, encoding: 'utf8' }).trim();
const localRaw = execFileSync('git', ['ls-tree', '-r', 'HEAD'], { cwd: REPO_DIR, encoding: 'utf8' });
const local = new Map();
for (const line of localRaw.split(/\r?\n/)) {
  const m = line.match(/^\d+ blob ([0-9a-f]{40})\t(.+)$/);
  if (m) local.set(m[2], m[1]);
}

const onlyRemote = [...remote.keys()].filter((k) => !local.has(k));
const onlyLocal = [...local.keys()].filter((k) => !remote.has(k));
const differ = [...remote.keys()].filter((k) => local.has(k) && local.get(k) !== remote.get(k));

console.log('remote main :', ref.object.sha, '(parent:', commit.parents.map((p) => p.sha.slice(0, 7)).join(',') || 'none', ')');
console.log('local  HEAD :', head);
console.log('files: remote', remote.size, '/ local', local.size);
console.log('only on remote:', onlyRemote.length ? onlyRemote.join(', ') : '无');
console.log('only local   :', onlyLocal.length ? onlyLocal.join(', ') : '无');
console.log('content diff :', differ.length ? differ.join(', ') : '无（内容一致）');
