/**
 * tools/test-geometry.mjs —— 几何换算的离线断言
 * 用法：node tools/test-geometry.mjs
 *
 * 红线：内部一律真实毫米。600×400×300 的箱子必须得到 2000×700 的展开图。
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

const net = computeNet({ L: 600, W: 400, H: 300 });

console.log('RSC 600 × 400 × 300');

check('展开图总宽 = 2L + 2W = 2000', () => assert.equal(net.width, 2000));
check('展开图总高 = H + W = 700', () => assert.equal(net.height, 700));
check('摇盖高度 = W / 2 = 200', () => assert.equal(net.flap, 200));
check('面板数量 = 8', () => assert.equal(Object.keys(net.panels).length, 8));

check('前面板 600 × 300 @ (0, 200)', () => {
  assert.deepEqual(net.panels.front, { x: 0, y: 200, w: 600, h: 300 });
});
check('右侧面板 400 × 300 @ (600, 200)', () => {
  assert.deepEqual(net.panels.right, { x: 600, y: 200, w: 400, h: 300 });
});
check('后面板 600 × 300 @ (1000, 200)', () => {
  assert.deepEqual(net.panels.back, { x: 1000, y: 200, w: 600, h: 300 });
});
check('左侧面板 400 × 300 @ (1600, 200)', () => {
  assert.deepEqual(net.panels.left, { x: 1600, y: 200, w: 400, h: 300 });
});
check('前顶摇盖 600 × 200 @ (0, 0)', () => {
  assert.deepEqual(net.panels.topFront, { x: 0, y: 0, w: 600, h: 200 });
});
check('后顶摇盖 600 × 200 @ (1000, 0)', () => {
  assert.deepEqual(net.panels.topBack, { x: 1000, y: 0, w: 600, h: 200 });
});
check('前底摇盖 600 × 200 @ (0, 500)', () => {
  assert.deepEqual(net.panels.bottomFront, { x: 0, y: 500, w: 600, h: 200 });
});
check('后底摇盖 600 × 200 @ (1000, 500)', () => {
  assert.deepEqual(net.panels.bottomBack, { x: 1000, y: 500, w: 600, h: 200 });
});

check('四个箱身面横向排满、互不重叠', () => {
  const body = ['front', 'right', 'back', 'left'].map((k) => net.panels[k]);
  let x = 0;
  for (const p of body) {
    assert.equal(p.x, x, '箱身面必须首尾相接');
    assert.equal(p.y, 200);
    assert.equal(p.h, 300);
    x += p.w;
  }
  assert.equal(x, 2000);
});

check('摇盖两两对开，正好拼成顶面 / 底面', () => {
  // 顶面：前顶 + 后顶，各 600 × 200，合起来 600 × 400 = L × W
  assert.equal(net.panels.topFront.w, 600);
  assert.equal(net.panels.topFront.h + net.panels.topBack.h, 400);
  assert.equal(net.panels.bottomFront.h + net.panels.bottomBack.h, 400);
});

check('折叠线条数 = 7（4 摇盖折线 + 3 箱身折线）', () => assert.equal(net.folds.length, 7));

check('裁切轮廓闭合且全部落在展开图范围内', () => {
  assert.ok(net.outline.length >= 12);
  for (const [x, y] of net.outline) {
    assert.ok(x >= 0 && x <= net.width, `x=${x} 越界`);
    assert.ok(y >= 0 && y <= net.height, `y=${y} 越界`);
  }
  const last = net.outline[net.outline.length - 1];
  const first = net.outline[0];
  assert.equal(last[0] === 0 && last[1] === net.height && first[0] === 0 && first[1] === 0, true);
});

check('任意尺寸都保持 2L+2W × (H+W)', () => {
  for (const d of [
    { L: 300, W: 200, H: 150 },
    { L: 1200, W: 800, H: 600 },
    { L: 200, W: 1000, H: 50 },
  ]) {
    const n = computeNet(d);
    assert.equal(n.width, 2 * d.L + 2 * d.W);
    assert.equal(n.height, d.H + d.W);
    assert.equal(n.flap, d.W / 2);
  }
});

console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
