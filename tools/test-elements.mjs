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

console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
