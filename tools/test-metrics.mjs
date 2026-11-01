/**
 * tools/test-metrics.mjs —— 轮廓图下方三项指标的断言
 * 用法：node tools/test-metrics.mjs
 */
import assert from 'node:assert/strict';
import { computeMetrics, fmt2 } from '../assets/js/metrics.js';

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

console.log('轮廓图指标（CBM / 英寸，固定 2 位）');

check('矩形箱 600×400×300：最大 0.07、实际 0.07、周长 80 in（英寸向上取整）', () => {
  const m = computeMetrics({ L: 600, W: 400, H: 300 }, 'rsc');
  assert.equal(m.maxCbm, 0.07);
  assert.equal(m.realCbm, 0.07);
  // 23.62→24、15.75→16、11.81→12 → (12+16)×2+24 = 80
  assert.equal(m.perimeterIn, 80);
  assert.equal(fmt2(m.maxCbm), '0.07');
});

check('斜形箱 600/400/300/450：最大 0.11、实际 0.09、周长 92 in', () => {
  const m = computeMetrics({ L: 600, W: 400, Hfront: 300, Hback: 450 }, 'bevel');
  assert.equal(m.maxCbm, 0.11);
  assert.equal(m.realCbm, 0.09);
  // 三边按 L / W / H(后)：24 / 16 / 18 → (16+18)×2+24 = 92
  assert.equal(m.perimeterIn, 92);
});

check('L 形箱 600/250/150/300/450：最大 0.11、实际 0.09、周长 92 in', () => {
  const m = computeMetrics(
    { L: 600, Wfront: 250, Wback: 150, Hfront: 300, Hback: 450 },
    'lshape',
  );
  assert.equal(m.maxCbm, 0.11);
  // 600 × (250×300 + 150×450) = 600 × 142500 = 85 500 000 mm³ = 0.0855 → 0.09
  assert.equal(m.realCbm, 0.09);
  assert.equal(m.perimeterIn, 92);
});

check('实际体积按真实立体算，比外接体积小（斜形 0.09 < 0.11）', () => {
  const m = computeMetrics({ L: 600, W: 400, Hfront: 300, Hback: 450 }, 'bevel');
  assert.ok(m.realCbm < m.maxCbm);
  const l = computeMetrics({ L: 600, Wfront: 250, Wback: 150, Hfront: 300, Hback: 450 }, 'lshape');
  assert.ok(l.realCbm < l.maxCbm);
});

check('周长排序取「最小 + 次长）× 2 + 最长」：换顺序不影响结果', () => {
  const a = computeMetrics({ L: 600, W: 400, H: 300 }, 'rsc');
  const b = computeMetrics({ L: 300, W: 600, H: 400 }, 'rsc');
  assert.equal(a.perimeterIn, b.perimeterIn);
});

check('尺寸非法/缺失时三项都是 null（界面显示「—」）', () => {
  for (const dims of [
    { L: 600, W: 400 },
    { L: 0, W: 400, H: 300 },
    { L: -1, W: 400, H: 300 },
    { L: 600, W: 400, Hfront: 300 },
  ]) {
    const m = computeMetrics(dims, dims.Hfront ? 'bevel' : 'rsc');
    assert.equal(m.maxCbm, null, JSON.stringify(dims));
    assert.equal(m.realCbm, null);
    assert.equal(m.perimeterIn, null);
    assert.equal(fmt2(m.maxCbm), '—');
  }
});

check('四舍五入到 2 位，不出现浮点尾巴', () => {
  assert.equal(fmt2(0.0855), '0.09');
  assert.equal(fmt2(0.072), '0.07');
  assert.equal(fmt2(78.74015748031496), '78.74');
  assert.equal(fmt2(80), '80.00');
  assert.equal(fmt2(0.1), '0.10');
});

console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
