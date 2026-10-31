/**
 * tools/test-units.mjs —— 尺寸输入防呆的断言
 * 用法：node tools/test-units.mjs
 */
import assert from 'node:assert/strict';
import { validateDim, toMm, fromMm, displayValue } from '../assets/js/units.js';

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

console.log('单位换算');

check('1 cm = 10 mm', () => assert.equal(toMm(1, 'cm'), 10));
check('600 mm 在 cm 下显示 60', () => assert.equal(displayValue(600, 'cm'), 60));
check('605 mm 在 cm 下显示 60.5', () => assert.equal(displayValue(605, 'cm'), 60.5));
check('fromMm 反向换算', () => assert.equal(fromMm(600, 'cm'), 60));

console.log('输入校验');

const cases = [
  { raw: '', unit: 'mm', ok: false, why: '空值' },
  { raw: '   ', unit: 'mm', ok: false, why: '空白' },
  { raw: 'abc', unit: 'mm', ok: false, why: '非数字' },
  { raw: '1e3', unit: 'mm', ok: false, why: '科学计数法拒绝' },
  { raw: '-5', unit: 'mm', ok: false, why: '负数' },
  { raw: '0', unit: 'mm', ok: false, why: '零' },
  { raw: '5', unit: 'mm', ok: false, why: '过小' },
  { raw: '9999', unit: 'mm', ok: false, why: '过大' },
  { raw: '600', unit: 'mm', ok: true, warn: false, why: '常规' },
  { raw: '60', unit: 'cm', ok: true, warn: false, why: '厘米常规' },
  { raw: '30', unit: 'mm', ok: true, warn: true, why: '偏小给提示' },
  { raw: '3500', unit: 'mm', ok: true, warn: true, why: '偏大给提示' },
];

for (const c of cases) {
  check(`${c.why}（"${c.raw}" ${c.unit}）`, () => {
    const r = validateDim(c.raw, c.unit, '长 L');
    assert.equal(r.ok, c.ok, `ok 期望 ${c.ok}`);
    if (c.ok) {
      assert.ok(r.mm > 0);
      assert.equal(Boolean(r.warn), Boolean(c.warn), 'warning 期望不符');
    } else {
      assert.ok(r.error && r.error.length > 0, '必须有错误提示');
    }
  });
}

check('厘米输入会换算成毫米再返回', () => {
  const r = validateDim('60', 'cm', '长 L');
  assert.equal(r.ok, true);
  assert.equal(r.mm, 600);
});

console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
