// 取 GitHub 远端 main 的提交与文件树，写到 .tmp/remote-tree.json（只读）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
const files = {};
for (const e of tree.tree) if (e.type === 'blob') files[e.path] = e.sha;

const out = {
  ref: ref.object.sha,
  parents: commit.parents.map((p) => p.sha),
  message: commit.message,
  tree: commit.tree.sha,
  files,
};
fs.writeFileSync(path.join(REPO_DIR, '.tmp', 'remote-tree.json'), JSON.stringify(out, null, 2));
console.log('remote', out.ref.slice(0, 7), 'files', Object.keys(files).length);
