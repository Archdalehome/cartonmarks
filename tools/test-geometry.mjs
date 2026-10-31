/**
 * tools/test-geometry.mjs —— 几何换算的离线断言
 * 用法：node tools/test-geometry.mjs
 *
 * 红线：内部一律真实毫米。600×400×300 的箱子必须得到 2000×700 的展开图，
 * 12 个区域：4 箱身面 + 4 主摇盖（L×W/2）+ 4 防尘摇盖（W×W/2）。
 */
import assert from 'node:assert/strict';
import { computeNet } from '../assets/js/geometry.js';

let passed = 0;

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
  assert.equal(net.groups.body.length, 4);
  assert.equal(net.groups.major.length, 4);
  assert.equal(net.groups.minor.length, 4);
});

check('每个区域都带 kind 分类', () => {
  for (const [key, p] of Object.entries(net.panels)) {
    assert.ok(['body', 'major', 'minor'].includes(p.kind), `${key} 缺少 kind`);
  }
});

check('箱身四面：前 600×300 / 右 400×300 / 后 600×300 / 左 400×300', () => {
  assert.deepEqual(net.panels.front, { x: 0, y: 200, w: 600, h: 300, kind: 'body' });
  assert.deepEqual(net.panels.right, { x: 600, y: 200, w: 400, h: 300, kind: 'body' });
  assert.deepEqual(net.panels.back, { x: 1000, y: 200, w: 600, h: 300, kind: 'body' });
  assert.deepEqual(net.panels.left, { x: 1600, y: 200, w: 400, h: 300, kind: 'body' });
});

check('4 片主摇盖 = L × W/2 = 600 × 200（挂在前/后箱身面）', () => {
  assert.deepEqual(net.panels.topFront, { x: 0, y: 0, w: 600, h: 200, kind: 'major' });
  assert.deepEqual(net.panels.topBack, { x: 1000, y: 0, w: 600, h: 200, kind: 'major' });
  assert.deepEqual(net.panels.bottomFront, { x: 0, y: 500, w: 600, h: 200, kind: 'major' });
  assert.deepEqual(net.panels.bottomBack, { x: 1000, y: 500, w: 600, h: 200, kind: 'major' });
});

check('4 片防尘摇盖 = W × W/2 = 400 × 200（挂在左/右箱身面）', () => {
  assert.deepEqual(net.panels.topRight, { x: 600, y: 0, w: 400, h: 200, kind: 'minor' });
  assert.deepEqual(net.panels.topLeft, { x: 1600, y: 0, w: 400, h: 200, kind: 'minor' });
  assert.deepEqual(net.panels.bottomRight, { x: 600, y: 500, w: 400, h: 200, kind: 'minor' });
  assert.deepEqual(net.panels.bottomLeft, { x: 1600, y: 500, w: 400, h: 200, kind: 'minor' });
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

console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
