/**
 * tools/test-elements.mjs —— 元素工厂与边界规则
 * 用法：node tools/test-elements.mjs
 */
import assert from 'node:assert/strict';
import {
  createLineElement,
  createTextElement,
  clampElement,
  elementLabel,
  elementKindLabel,
  deepCopyElement,
  rotateElement,
  normalizeRotation,
  contentBox,
  contentOrigin,
  rotatePoint,
} from '../assets/js/elements.js';

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

console.log('线条元素');

check('横线默认：长度 = 面板宽 × 45%（600 → 270），粗细 10 mm，黑色，居中', () => {
  const el = createLineElement(600, 300);
  assert.equal(el.type, 'line');
  assert.equal(el.orientation, 'horizontal');
  assert.equal(el.w, 270);
  assert.equal(el.h, 10);
  assert.equal(el.color, '#000000');
  assert.equal(el.x, (600 - 270) / 2);
  assert.equal(el.y, (300 - 10) / 2);
});

check('竖线默认：长度 = 面板高 × 45%（300 → 135），粗细 10 mm', () => {
  const el = createLineElement(600, 300, { orientation: 'vertical' });
  assert.equal(el.orientation, 'vertical');
  assert.equal(el.w, 10);
  assert.equal(el.h, 135);
  assert.equal(el.x, (600 - 10) / 2);
  assert.equal(el.y, (300 - 135) / 2);
});

check('粗细可指定，越界会被夹到 0.5–50 mm', () => {
  assert.equal(createLineElement(600, 300, { thickness: 5 }).h, 5);
  assert.equal(createLineElement(600, 300, { thickness: 0.1 }).h, 0.5);
  assert.equal(createLineElement(600, 300, { thickness: 999 }).h, 50);
});

check('颜色必须是合法 #rrggbb，否则回退黑色', () => {
  assert.equal(createLineElement(600, 300, { color: '#ff0000' }).color, '#ff0000');
  assert.equal(createLineElement(600, 300, { color: 'red' }).color, '#000000');
});

check('线条允许 0.5 mm 细线，不会被文本的最小 3 mm 卡住', () => {
  const el = createLineElement(600, 300, { thickness: 2 });
  assert.equal(el.h, 2);
  el.h = 0.2;
  clampElement(el, 600, 300);
  assert.equal(el.h, 0.5);
});

check('线条坐标/尺寸越界会被夹回面板', () => {
  const el = createLineElement(600, 300);
  el.x = 999;
  el.y = -20;
  clampElement(el, 600, 300);
  assert.ok(el.x + el.w <= 600 + 1e-9);
  assert.ok(el.y >= 0);
});

check('标签：横线/竖线带粗细', () => {
  const h = createLineElement(600, 300, { thickness: 12 });
  const v = createLineElement(600, 300, { orientation: 'vertical', thickness: 8 });
  assert.equal(elementKindLabel(h), '线条');
  assert.equal(elementLabel(h), '横线 · 12 mm');
  assert.equal(elementLabel(v), '竖线 · 8 mm');
});

check('深拷贝换新 id，尺寸与颜色不变', () => {
  const el = createLineElement(600, 300, { color: '#123456' });
  const copy = deepCopyElement(el);
  assert.notEqual(copy.id, el.id);
  assert.equal(copy.color, '#123456');
  assert.equal(copy.w, el.w);
  assert.equal(copy.h, el.h);
});

check('文字元素默认仍在面板内', () => {
  const t = createTextElement(600, 300, { text: '小心轻放', fontSize: 30 });
  assert.equal(t.type, 'text');
  assert.ok(t.x >= 0 && t.y >= 0);
  assert.ok(t.x + t.w <= 600 + 1e-9);
  assert.ok(t.y + t.h <= 300 + 1e-9);
});

console.log('旋转 90°');

check('顺时针转四次回到 0°，且每次都换回原尺寸', () => {
  const el = createTextElement(600, 300, { text: '旋转测试', fontSize: 20 });
  const w0 = el.w;
  const h0 = el.h;
  for (let i = 0; i < 4; i += 1) rotateElement(el, 1, 600, 300);
  assert.equal(normalizeRotation(el.rotation), 0);
  assert.ok(Math.abs(el.w - w0) < 1e-9 && Math.abs(el.h - h0) < 1e-9, '转 4 次尺寸要回到原样');
});

check('转 90° 后外接框 W/H 互换，中心不动', () => {
  const el = createTextElement(600, 300, { text: '小心轻放', fontSize: 20 });
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const w0 = el.w;
  const h0 = el.h;
  rotateElement(el, 1, 600, 300);
  assert.equal(el.rotation, 90);
  assert.ok(Math.abs(el.w - h0) < 1e-9, 'W 应变成原来的 H');
  assert.ok(Math.abs(el.h - w0) < 1e-9, 'H 应变成原来的 W');
  assert.ok(Math.abs(el.x + el.w / 2 - cx) < 1e-9, 'X 中心不动');
  assert.ok(Math.abs(el.y + el.h / 2 - cy) < 1e-9, 'Y 中心不动');
});

check('逆时针与顺时针各转一次，角度抵消回 0°，尺寸也回原样', () => {
  const el = createLineElement(600, 300);
  const w0 = el.w;
  const h0 = el.h;
  rotateElement(el, 1, 600, 300);
  rotateElement(el, -1, 600, 300);
  assert.equal(el.rotation, 0);
  assert.ok(Math.abs(el.w - w0) < 1e-9 && Math.abs(el.h - h0) < 1e-9);
});

check('贴边元素转 90° 后仍被夹在面板内', () => {
  const el = createTextElement(600, 300, { text: '边角', fontSize: 20 });
  el.x = 0;
  el.y = 0;
  el.w = 200;
  el.h = 40;
  rotateElement(el, 1, 600, 300);
  assert.ok(el.w <= 600 && el.h <= 300, '尺寸不超面板');
  assert.ok(el.x >= 0 && el.x + el.w <= 600 + 1e-9, 'X 在面板内');
  assert.ok(el.y >= 0 && el.y + el.h <= 300 + 1e-9, 'Y 在面板内');
  assert.equal(el.rotation, 90);
});

check('内容框：转 90/270 时与外接框互换，180 时不变', () => {
  const el = createTextElement(600, 300, { text: 'A', fontSize: 20 });
  el.w = 200;
  el.h = 40;
  el.rotation = 0;
  assert.deepEqual(contentBox(el), { w: 200, h: 40 });
  el.rotation = 90;
  assert.deepEqual(contentBox(el), { w: 40, h: 200 });
  el.rotation = 180;
  assert.deepEqual(contentBox(el), { w: 200, h: 40 });
  el.rotation = 270;
  assert.deepEqual(contentBox(el), { w: 40, h: 200 });
});

check('内容框绕中心转过去正好铺满外接框（PDF 落位就靠这个）', () => {
  for (const rot of [0, 90, 180, 270]) {
    const el = { x: 10, y: 20, w: rot % 180 === 90 ? 40 : 200, h: rot % 180 === 90 ? 200 : 40, rotation: rot };
    const box = contentOrigin(el, 0, 0);
    const cx = el.w / 2;
    const cy = el.h / 2;
    const corners = [
      [box.x, box.y],
      [box.x + box.w, box.y],
      [box.x + box.w, box.y + box.h],
      [box.x, box.y + box.h],
    ].map(([x, y]) => rotatePoint(x, y, cx, cy, rot));
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    assert.ok(Math.abs(Math.min(...xs) - 0) < 1e-9, `${rot}° 左边应贴 0`);
    assert.ok(Math.abs(Math.max(...xs) - el.w) < 1e-9, `${rot}° 右边应贴外接框宽`);
    assert.ok(Math.abs(Math.min(...ys) - 0) < 1e-9, `${rot}° 上边应贴 0`);
    assert.ok(Math.abs(Math.max(...ys) - el.h) < 1e-9, `${rot}° 下边应贴外接框高`);
  }
});
check('旧数据没有 rotation 字段时按 0 处理，非法角度被归一到 90 的倍数', () => {
  const el = createTextElement(600, 300, { text: '旧数据' });
  delete el.rotation;
  clampElement(el, 600, 300);
  assert.equal(el.rotation, 0);
  assert.equal(normalizeRotation(undefined), 0);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(37), 0);
});

check('旋转后再深拷贝（复制到另一面），角度和尺寸都跟着走', () => {
  const el = createTextElement(600, 300, { text: '复制我', fontSize: 20 });
  rotateElement(el, 1, 600, 300);
  const copy = deepCopyElement(el);
  assert.equal(copy.rotation, 90);
  assert.equal(copy.w, el.w);
  assert.equal(copy.h, el.h);
  assert.notEqual(copy.id, el.id);
});

check('rotatePoint：绕中心顺时针 90°，(右,中) 转到 (中,下)', () => {
  const p = rotatePoint(100, 50, 50, 50, 90);
  assert.ok(Math.abs(p.x - 50) < 1e-9 && Math.abs(p.y - 100) < 1e-9);
});
console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
