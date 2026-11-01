/**
 * tools/test-templates-ui.mjs —— 「我的模板」列表（自己的 + 收到的合并）行为检查
 *
 * 只测纯前端逻辑，用极简 DOM 垫片 + 假 fetch：
 *  - 自己的在前、收到的在后，各自按时间倒序
 *  - 收到的卡片带「来自 xxx · 箱型 · 分享于 MM-DD」和「分享」角标，且没有「分享」按钮
 *  - 头部计数分开：我的 N 个 · 收到 M 个（我的上限 50）
 *  - 未订阅：自己的列表锁住但不弹订阅层，收到的照常显示
 *  - 载入 L 形分享（未订阅）→ 后端 403 shape_locked → 关弹层 + 回调弹出订阅提示
 */

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}`);
  }
};

/* ── 极简 DOM：只满足 templates-ui.js 用到的接口 ── */
class FakeEl {
  constructor(id) {
    this.id = id;
    this.listeners = new Map();
    this.open = false;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.classList = { toggle() {} };
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  dispatch(type, ev = {}) {
    return Promise.all((this.listeners.get(type) || []).map((fn) => fn(ev)));
  }
  setAttribute() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  focus() {}
}

const IDS = [
  'templatesDialog',
  'tplList',
  'tplStatus',
  'tplCloseBtn',
  'tplShareDialog',
  'tplShareForm',
  'tplShareTitle',
  'tplShareEmail',
  'tplShareError',
  'tplShareCancelBtn',
  'tplShareCloseBtn',
  'tplNameDialog',
  'tplNameForm',
  'tplNameInput',
  'tplNameError',
  'tplNameCancelBtn',
  'tplNameCloseBtn',
];
const nodes = {};
for (const id of IDS) nodes[id] = new FakeEl(id);
globalThis.document = { getElementById: (id) => nodes[id] || null };
globalThis.window = { confirm: () => true };

/* ── 假后端：按 URL 返回，可在用例之间改 ── */
const routes = new Map();
const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
globalThis.fetch = async (url) => {
  const hit = routes.get(url);
  if (!hit) throw new Error(`没准备的接口：${url}`);
  return jsonRes(hit.status, hit.body);
};

const { createTemplatesUI } = await import('../assets/js/templates-ui.js');

const calls = { onLoad: [], toast: [], onError: [], onShapeLocked: [], onSubscribe: [] };
const ui = createTemplatesUI({
  onLoad: (data, name) => {
    calls.onLoad.push({ data, name });
    return true;
  },
  getTemplateData: () => ({}),
  toast: (m) => calls.toast.push(m),
  onError: (e) => calls.onError.push(e),
  onShapeLocked: (shape, message) => calls.onShapeLocked.push({ shape, message }),
  onSubscribe: () => calls.onSubscribe.push(true),
});

const settle = () => new Promise((r) => setTimeout(r, 25));
const list = nodes.tplList;
const status = nodes.tplStatus;
const dialog = nodes.templatesDialog;
const reset = () => {
  for (const k of Object.keys(calls)) calls[k].length = 0;
  list.innerHTML = '';
  status.textContent = '';
  routes.clear();
};

/* ── 用例 1：已订阅，两个列表合并 ── */
console.log('我的模板：自己的 + 收到的合并成一个列表');
reset();
routes.set('/api/templates', {
  status: 200,
  body: {
    items: [
      { id: 't_old', name: '旧模板', updatedAt: '2026-10-29T10:00:00.000Z' },
      { id: 't_new', name: '新模板', updatedAt: '2026-11-01T10:00:00.000Z' },
    ],
  },
});
routes.set('/api/shared', {
  status: 200,
  body: {
    items: [
      { shareId: 'sh_old', fromEmail: 'a@b.com', name: '早收到的', shape: 'rsc', sharedAt: '2026-10-30T09:00:00.000Z' },
      { shareId: 'sh_new', fromEmail: 'c@d.com', name: '晚收到的', shape: 'lshape', sharedAt: '2026-10-31T09:00:00.000Z' },
    ],
    notice: '',
  },
});
await ui.open();
const html = list.innerHTML;
ok(dialog.open === true, '打开弹层');
ok(status.textContent === '我的 2 个 · 收到 2 个（我的上限 50）', `头部计数分开：${status.textContent}`);
ok(html.indexOf('新模板') < html.indexOf('旧模板'), '自己的按更新时间倒序');
ok(html.indexOf('收到的分享') > html.indexOf('旧模板'), '分隔行在两组之间');
ok(html.indexOf('晚收到的') < html.indexOf('早收到的'), '收到的按分享时间倒序');
ok(html.includes('来自 c@d.com') && html.includes('L 形箱') && html.includes('分享于 10-31'), '收到的卡片带来源 / 箱型 / 分享日期');
ok((html.match(/data-act="share"/g) || []).length === 2, '只有自己的两张有「分享」按钮（收到的不能转发）');
ok(html.includes('tpl-badge') && html.includes('data-kind="shared"'), '收到的卡片有角标和 shared 标记');
ok(!html.includes('id="tplTabs"'), '页签控件已移除');

/* ── 用例 2：点「分享」只对自己那行有效 ── */
reset();
await ui.open();
const fakeBtn = (act, id, kind) => {
  const row = { dataset: { id, kind } };
  const btn = { dataset: { act }, closest: (sel) => (sel === '.tpl-item' ? row : null) };
  return { target: { closest: (sel) => (sel === 'button[data-act]' ? btn : null) } };
};
await list.dispatch('click', fakeBtn('share', 't_new', 'mine'));
ok(nodes.tplShareDialog.open === true, '自己的行点「分享」弹出分享框');
nodes.tplShareDialog.close();

/* ── 用例 3：载入收到的矩形箱模板 ── */
reset();
await ui.open();
routes.set('/api/shared/sh_old', {
  status: 200,
  body: { name: '早收到的', shape: 'rsc', fromEmail: 'a@b.com', data: { shape: 'rsc', dims: { L: 600, W: 400, H: 300 }, panels: {} } },
});
await list.dispatch('click', fakeBtn('load', 'sh_old', 'shared'));
await settle();
ok(calls.onLoad.length === 1 && calls.onLoad[0].name === '早收到的', '载入收到的分享：拿到数据和名字');
ok(dialog.open === false, '载入成功后关弹层');
ok(calls.toast.some((m) => m.includes('已载入分享的模板')), '提示「已载入分享的模板」');

/* ── 用例 4：未订阅 —— 自己的锁住，收到的照旧，且不弹订阅层 ── */
reset();
routes.set('/api/templates', { status: 403, body: { error: 'not_subscribed', message: '这是订阅功能，请先订阅' } });
routes.set('/api/shared', {
  status: 200,
  body: {
    items: [{ shareId: 'sh_rsc', fromEmail: 'a@b.com', name: '收到的矩形箱', shape: 'rsc', sharedAt: '2026-10-31T09:00:00.000Z' }],
    notice: '',
  },
});
await ui.open();
const html4 = list.innerHTML;
ok(status.textContent === '我的 0 个 · 收到 1 个（我的上限 50） · 保存模板需订阅', `未订阅时计数 + 说明：${status.textContent}`);
ok(html4.includes('自己的模板需要订阅'), '自己的模板块给出锁定说明');
ok(html4.includes('收到的矩形箱') && html4.includes('来自 a@b.com'), '收到的分享照常列出');
ok(calls.onError.length === 0, '未订阅只是锁自己的列表，不弹订阅层');
ok(calls.onShapeLocked.length === 0, '没动到箱型，不弹订阅层');
ok(html4.includes('data-act="subscribe"') && html4.includes('去订阅'), '锁定说明里有「去订阅」按钮');
await list.dispatch('click', {
  target: { closest: (sel) => (sel === 'button[data-act]' ? { dataset: { act: 'subscribe' }, closest: () => null } : null) },
});
ok(calls.onSubscribe.length === 1, '点「去订阅」调到订阅入口');

/* ── 用例 4b：未订阅且一条分享都没有 → 空列表也给「去订阅」 ── */
reset();
routes.set('/api/templates', { status: 403, body: { error: 'not_subscribed', message: '这是订阅功能，请先订阅' } });
routes.set('/api/shared', { status: 200, body: { items: [], notice: '' } });
await ui.open();
ok(list.innerHTML.includes('data-act="subscribe"'), '一条都没有时也给「去订阅」入口');
ok(status.textContent === '我的 0 个 · 收到 0 个（我的上限 50） · 保存模板需订阅', `空列表计数：${status.textContent}`);

/* ── 用例 5：未订阅载入 L 形分享 → 403 shape_locked ── */
reset();
routes.set('/api/templates', { status: 403, body: { error: 'not_subscribed', message: '这是订阅功能，请先订阅' } });
routes.set('/api/shared', {
  status: 200,
  body: {
    items: [{ shareId: 'sh_l', fromEmail: 'a@b.com', name: 'L 形模板', shape: 'lshape', sharedAt: '2026-10-31T09:00:00.000Z' }],
    notice: '',
  },
});
routes.set('/api/shared/sh_l', { status: 403, body: { error: 'shape_locked', message: '这个模板是L 形箱专属', shape: 'lshape' } });
await ui.open();
await list.dispatch('click', fakeBtn('load', 'sh_l', 'shared'));
await settle();
ok(calls.onLoad.length === 0, '箱型被锁时不载入内容');
ok(dialog.open === false, '关掉模板弹层再弹订阅');
ok(calls.onShapeLocked.length === 1 && calls.onShapeLocked[0].shape === 'lshape', '回调带上是哪个箱型');
ok(
  calls.onShapeLocked[0] && calls.onShapeLocked[0].message.includes('L 形箱'),
  `提示文案点名箱型：${calls.onShapeLocked[0] && calls.onShapeLocked[0].message}`,
);

/* ── 用例 6：删除收到的分享 ── */
reset();
routes.set('/api/templates', { status: 200, body: { items: [] } });
routes.set('/api/shared', {
  status: 200,
  body: { items: [{ shareId: 'sh_x', fromEmail: 'a@b.com', name: '待删', shape: 'rsc', sharedAt: '2026-10-31T09:00:00.000Z' }], notice: '' },
});
await ui.open();
routes.set('/api/shared/sh_x', { status: 204, body: null });
await list.dispatch('click', fakeBtn('del', 'sh_x', 'shared'));
await settle();
ok(!list.innerHTML.includes('待删'), '删除后该行从列表消失');
ok(status.textContent.startsWith('已移除分享'), `删除后状态行：${status.textContent}`);

/* ── 用例 7：退出登录时 reset 清空 ── */
reset();
routes.set('/api/templates', { status: 200, body: { items: [{ id: 't1', name: '甲', updatedAt: '2026-11-01T00:00:00.000Z' }] } });
routes.set('/api/shared', { status: 200, body: { items: [], notice: '' } });
await ui.open();
ui.reset('登录已失效，模板列表已清空。');
ok(list.innerHTML.includes('登录已失效'), 'reset 后只留说明（旧模板名不残留）');
ok(!list.innerHTML.includes('甲'), '旧数据被清掉');
ok(dialog.open === false, 'reset 会关弹层');

console.log(`\n${pass} 项通过${fail ? `，${fail} 项失败` : '，全部通过'}`);
process.exit(fail ? 1 : 0);
