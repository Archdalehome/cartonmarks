/**
 * tools/test-geometry.mjs —— 几何换算的离线断言
 * 用法：node tools/test-geometry.mjs
 *
 * 红线：内部一律真实毫米。600×400×300 的箱子必须得到 2000×700 的展开图，
 * 12 个区域：4 箱身面 + 4 主摇盖（L×W/2）+ 4 防尘摇盖（W×W/2）。
 */
import assert from 'node:assert/strict';
import { computeNet, registerShapeGeometry, listShapeGeometries } from '../assets/js/geometry.js';
import { createPanels } from '../assets/js/project.js';

let passed = 0;

function assertPanel(net, key, x, y, w, h, kind) {
  const p = net.panels[key];
  assert.ok(p, '缺少面板 ' + key);
  assert.equal(p.x, x);
  assert.equal(p.y, y);
  assert.equal(p.w, w);
  assert.equal(p.h, h);
  assert.equal(p.kind, kind);
  assert.ok(typeof p.label === 'string' && p.label.length > 0, key + ' 缺少中文标签');
  assert.equal(p.editable, kind !== 'minor', key + ' 可编辑标记不对');
}

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

const dims = { L: 600, W: 400, H: 300 };
const net = computeNet(dims);

console.log('RSC 600 × 400 × 300');

check('展开图总宽 = 2L + 2W = 2000', () => assert.equal(net.width, 2000));
check('展开图总高 = H + W = 700', () => assert.equal(net.height, 700));
check('摇盖深度 = W / 2 = 200', () => assert.equal(net.flap, 200));
check('区域数量 = 12（4 箱身 + 4 主摇盖 + 4 防尘摇盖）', () => {
  assert.equal(Object.keys(net.panels).length, 12);
  const kinds = Object.values(net.panels).map((p) => p.kind);
  assert.equal(kinds.filter((k) => k === 'body').length, 4);
  assert.equal(kinds.filter((k) => k === 'major').length, 4);
  assert.equal(kinds.filter((k) => k === 'minor').length, 4);
});

check('每个区域都带 kind 分类', () => {
  for (const [key, p] of Object.entries(net.panels)) {
    assert.ok(['body', 'major', 'minor'].includes(p.kind), `${key} 缺少 kind`);
  }
});

check('箱身四面：前 600×300 / 右 400×300 / 后 600×300 / 左 400×300', () => {
  assertPanel(net, 'front', 0, 200, 600, 300, 'body');
  assertPanel(net, 'right', 600, 200, 400, 300, 'body');
  assertPanel(net, 'back', 1000, 200, 600, 300, 'body');
  assertPanel(net, 'left', 1600, 200, 400, 300, 'body');
});

check('4 片主摇盖 = L × W/2 = 600 × 200（挂在前/后箱身面）', () => {
  assertPanel(net, 'topFront', 0, 0, 600, 200, 'major');
  assertPanel(net, 'topBack', 1000, 0, 600, 200, 'major');
  assertPanel(net, 'bottomFront', 0, 500, 600, 200, 'major');
  assertPanel(net, 'bottomBack', 1000, 500, 600, 200, 'major');
});

check('4 片防尘摇盖 = W × W/2 = 400 × 200（挂在左/右箱身面）', () => {
  assertPanel(net, 'topRight', 600, 0, 400, 200, 'minor');
  assertPanel(net, 'topLeft', 1600, 0, 400, 200, 'minor');
  assertPanel(net, 'bottomRight', 600, 500, 400, 200, 'minor');
  assertPanel(net, 'bottomLeft', 1600, 500, 400, 200, 'minor');
});

check('上排四片摇盖严丝合缝拼满整行', () => {
  const row = ['topFront', 'topRight', 'topBack', 'topLeft'].map((k) => net.panels[k]);
  let x = 0;
  for (const p of row) {
    assert.equal(p.x, x);
    assert.equal(p.y, 0);
    assert.equal(p.h, 200);
    x += p.w;
  }
  assert.equal(x, 2000);
});

check('下排四片摇盖同样拼满整行', () => {
  const row = ['bottomFront', 'bottomRight', 'bottomBack', 'bottomLeft'].map((k) => net.panels[k]);
  let x = 0;
  for (const p of row) {
    assert.equal(p.x, x);
    assert.equal(p.y, 500);
    x += p.w;
  }
  assert.equal(x, 2000);
});

check('两片主摇盖对开正好盖住顶面 L × W', () => {
  // 前顶 + 后顶：各 600 × 200，合起来 600 × 400
  assert.equal(net.panels.topFront.w, 600);
  assert.equal(net.panels.topFront.h + net.panels.topBack.h, 400);
  // 防尘摇盖盖住侧面开口上方的 W × W/2
  assert.equal(net.panels.topRight.w, 400);
  assert.equal(net.panels.topRight.h, 200);
});

check('裁切外轮廓就是整个矩形刀模', () => {
  assert.deepEqual(net.outline, [[0, 0], [2000, 0], [2000, 700], [0, 700]]);
});

check('折叠线 11 条（8 条摇盖折线 + 3 条箱身折线）', () => {
  assert.equal(net.folds.length, 11);
});

check('开槽切断线 6 条（上下摇盖带各 3 条）', () => {
  assert.equal(net.cuts.length, 6);
  for (const c of net.cuts) {
    assert.equal(c.x1, c.x2);
    assert.ok(
      (c.y1 === 0 && c.y2 === 200) || (c.y1 === 500 && c.y2 === 700),
      `开槽位置不对：${JSON.stringify(c)}`,
    );
  }
});

check('任意尺寸都保持 2L+2W × (H+W)，摇盖深 = W/2', () => {
  for (const d of [
    { L: 300, W: 200, H: 150 },
    { L: 1200, W: 800, H: 600 },
    { L: 200, W: 1000, H: 50 },
  ]) {
    const n = computeNet(d);
    assert.equal(n.width, 2 * d.L + 2 * d.W);
    assert.equal(n.height, d.H + d.W);
    assert.equal(n.flap, d.W / 2);
    assert.equal(Object.keys(n.panels).length, 12);
    assert.equal(n.panels.topFront.w, d.L);
    assert.equal(n.panels.topRight.w, d.W);
  }
});

console.log('箱型扩展点');

registerShapeGeometry('fake-l', (dims, id) => ({
  shape: id,
  shapeName: '假 L 形箱（测试用）',
  width: 500,
  height: 300,
  bodyTop: 0,
  bodyBottom: 200,
  panels: {
    panelA: { label: 'A 面', kind: 'body', slot: 'body', editable: true, x: 0, y: 0, w: 300, h: 200 },
    panelB: { label: 'B 面', kind: 'body', slot: 'body', editable: true, x: 300, y: 0, w: 200, h: 100 },
    waste: { label: '废料区', kind: 'minor', slot: 'minor', editable: false, x: 0, y: 200, w: 300, h: 100 },
  },
  outline: [[0, 0], [500, 0], [500, 300], [0, 300]],
  folds: [],
  cuts: [],
  dims,
}));

check('假箱型能注册并被 computeNet 调用', () => {
  const n = computeNet({ L: 10, W: 10, H: 10 }, 'fake-l');
  assert.equal(n.shape, 'fake-l');
  assert.deepEqual(Object.keys(n.panels), ['panelA', 'panelB', 'waste']);
  assert.equal(n.width, 500);
});

check('面板槽位由几何生成：只有 editable 面进 createPanels', () => {
  const n = computeNet({ L: 10, W: 10, H: 10 }, 'fake-l');
  const panels = createPanels(n);
  assert.deepEqual(Object.keys(panels).sort(), ['panelA', 'panelB']);
  assert.equal(panels.panelA.label, 'A 面');
});

check('未注册的箱型会明确报错', () => {
  assert.throws(() => computeNet({ L: 1, W: 1, H: 1 }, 'nope'), /未注册/);
});

check('RSC 已在几何注册表里', () => assert.ok(listShapeGeometries().includes('rsc')));

console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
