/**
 * tools/test-units.mjs —— 尺寸输入防呆的断言
 * 用法：node tools/test-units.mjs
 */
import assert from 'node:assert/strict';
import { validateDim, toMm, fromMm, displayValue, unitSuffix, fmtLength, withUnit } from '../assets/js/units.js';

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

console.log('英寸');

check('1 in = 25.4 mm', () => assert.equal(toMm(1, 'in'), 25.4));
check('24 in = 609.6 mm', () => assert.ok(Math.abs(toMm(24, 'in') - 609.6) < 1e-9));
check('600 mm 在英寸下显示 23.62', () => assert.equal(displayValue(600, 'in'), 23.62));
check('英寸后缀是 in', () => assert.equal(unitSuffix('in'), 'in'));

check('输入 24 in 校验通过并换算成 609.6 mm', () => {
  const r = validateDim('24', 'in', '长 L');
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.mm - 609.6) < 1e-9);
});

check('英寸下同样有最小值/最大值保护', () => {
  assert.equal(validateDim('0.5', 'in', '长 L').ok, false);
  assert.equal(validateDim('200', 'in', '长 L').ok, false);
});

console.log('单位来回切换不改变数据（mm → cm → in → mm）');

/** 模拟页面切换单位：把状态里的毫米值按新单位写进输入框，再按新单位读回来 */
function roundTrip(mm, units) {
  let value = mm;
  for (const unit of units) {
    const shown = displayValue(value, unit);
    const parsed = validateDim(String(shown), unit, '长 L');
    assert.equal(parsed.ok, true, `${unit} 下 ${shown} 应能通过校验`);
    value = parsed.mm;
  }
  return value;
}

check('600 mm 经过 cm / in 来回后仍是 600 mm', () => {
  const back = roundTrip(600, ['cm', 'in', 'mm']);
  assert.ok(Math.abs(back - 600) < 1e-6, `实际 ${back}`);
});

check('397 mm 经过 in / cm / mm 后仍是 397 mm', () => {
  const back = roundTrip(397, ['in', 'cm', 'mm']);
  assert.ok(Math.abs(back - 397) < 1e-6, `实际 ${back}`);
});

check('切单位后展开图总尺寸不变（斜形箱 600×397）', async () => {
  const { computeNet } = await import('../assets/js/geometry.js');
  await import('../assets/js/geometry-shapes.js');
  const dims = { L: 600, W: 397, Hfront: 500, Hback: 650 };
  const before = computeNet(dims, 'bevel');
  const after = computeNet(
    {
      L: roundTrip(600, ['cm', 'in', 'mm']),
      W: roundTrip(397, ['in', 'mm']),
      Hfront: roundTrip(500, ['cm', 'mm']),
      Hback: roundTrip(650, ['in', 'cm', 'mm']),
    },
    'bevel',
  );
  assert.equal(after.width, before.width, '总宽不能因为换单位而变');
  assert.ok(Math.abs(after.height - before.height) < 1e-6, '总高不能因为换单位而变');
});

console.log('图上标注的单位换算');

check('毫米取整不带小数，厘米/英寸保留 2 位', () => {
  assert.equal(fmtLength(600, 'mm'), '600');
  assert.equal(fmtLength(427.2, 'cm'), '42.72');
  assert.equal(fmtLength(427.2, 'in'), '16.82');
  assert.equal(fmtLength(2000, 'cm'), '200.00');
});

check('派生尺寸同样换算（斜长 427.2、顶盖 550）', () => {
  assert.equal(withUnit(427.2, 'cm'), '42.72 cm');
  assert.equal(withUnit(550, 'in'), '21.65 in');
  assert.equal(withUnit(863.6, 'mm'), '864 mm');
});

check('切到英寸再切回毫米，标注数值一字不差', () => {
  const values = [600, 397, 427.2, 550, 863.6, 1050, 1994];
  const before = values.map((v) => fmtLength(v, 'mm'));
  // 标注每次都由毫米现算，不允许拿中间显示值二次换算
  for (const v of values) {
    fmtLength(v, 'in');
    fmtLength(v, 'cm');
  }
  const after = values.map((v) => fmtLength(v, 'mm'));
  assert.deepEqual(after, before);
});

console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);