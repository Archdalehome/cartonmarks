/**
 * tools/test-storage.mjs —— 草稿存储断言（sessionStorage 版）
 * 用法：node tools/test-storage.mjs
 *
 * 规则（2026-11-01 用户要求）：
 *  - 草稿放 sessionStorage：刷新还在
 *  - 关掉标签页/浏览器就没了：新会话读不到
 *  - 旧版 localStorage 草稿键与 IndexedDB 库会被清掉，不阴魂不散
 */
import assert from 'node:assert/strict';

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      console.error(`  ✗ ${name}\n    ${err.message}`);
      process.exitCode = 1;
    });
}

/* ── 假浏览器存储 ───────────────────────────────── */

function fakeStorage({ fail = false } = {}) {
  const map = new Map();
  return {
    _map: map,
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      if (fail) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
  };
}

let deletedDb = [];
globalThis.localStorage = fakeStorage();
globalThis.sessionStorage = fakeStorage();
globalThis.indexedDB = {
  deleteDatabase(name) {
    deletedDb.push(name);
    return { onsuccess: null, onerror: null };
  },
};

const { DRAFT_KEY, serializeDraft } = await import('../assets/js/project.js');
const { saveProject, loadProject } = await import('../assets/js/storage.js');

const payload = serializeDraft({
  dims: { L: 600, W: 400, H: 300 },
  unit: 'mm',
  shape: 'rsc',
  panels: { front: { elements: [{ id: 'e1', type: 'text', x: 10, y: 20, w: 100, h: 30, text: 'test' }] } },
});

console.log('草稿存储 · sessionStorage');

await check('保存后写在 sessionStorage，不在 localStorage', async () => {
  const where = await saveProject(payload);
  assert.equal(where, 'session');
  assert.ok(globalThis.sessionStorage.getItem(DRAFT_KEY), 'sessionStorage 应有草稿');
  assert.equal(globalThis.localStorage.getItem(DRAFT_KEY), null, 'localStorage 不应再写草稿');
});

await check('刷新（同一会话）能读回草稿，内容完整', async () => {
  const draft = await loadProject();
  assert.ok(draft, '应能读到草稿');
  assert.equal(draft.shape, 'rsc');
  assert.equal(draft.dims.L, 600);
  assert.equal(draft.panels.front.elements.length, 1);
  assert.equal(draft.panels.front.elements[0].text, 'test');
});

await check('关浏览器（新会话 = sessionStorage 清空）后读不到草稿', async () => {
  globalThis.sessionStorage.clear(); // 关标签页等价于会话存储清空
  const draft = await loadProject();
  assert.equal(draft, null);
});

await check('启动时清掉旧版 localStorage 草稿键与旧 IndexedDB 库', async () => {
  globalThis.localStorage.setItem(DRAFT_KEY, '{"old":true}');
  globalThis.localStorage.setItem(`${DRAFT_KEY}.idb`, '1');
  await loadProject(); // 触发一次性清理
  assert.equal(globalThis.localStorage.getItem(DRAFT_KEY), null, '旧草稿键应被删除');
  assert.equal(globalThis.localStorage.getItem(`${DRAFT_KEY}.idb`), null, '旧 IDB 标记应被删除');
  assert.ok(deletedDb.includes('cartonmark'), '旧 IndexedDB 库应被删除');
});

await check('sessionStorage 写满时返回 none，不抛异常', async () => {
  const original = globalThis.sessionStorage;
  const origError = console.error;
  console.error = () => {}; // 这条用例故意制造写满，别刷屏
  globalThis.sessionStorage = fakeStorage({ fail: true });
  try {
    const where = await saveProject(payload);
    assert.equal(where, 'none');
  } finally {
    globalThis.sessionStorage = original;
    console.error = origError;
  }
});

console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
