/**
 * tools/test-shape-switch.mjs —— 切箱型时尺寸 / 面板 / 撤销栈的隔离断言
 *
 * 回归的是用户 2026-11-01 报的问题：L 形箱改了尺寸，切到矩形箱后
 * W(前)/W(后)/H(前)/H(后) 还会漏过去。
 *
 * 这里测的是切换用到的三个纯件：
 *   dimsForShape()  按箱型取各自那份尺寸
 *   createPanels()  新箱型的面板一律是空的
 *   History.reset() 换箱型后撤销栈清空
 */
import assert from 'node:assert/strict';
import { computeNet } from '../assets/js/geometry.js';
import '../assets/js/geometry-shapes.js';
import { SHAPES, createPanels, dimsForShape, dimKeysFor, serializeDraft, parseDraft } from '../assets/js/project.js';
import { History } from '../assets/js/history.js';

const DEFAULTS = { L: 600, W: 400, H: 300, Hfront: 300, Hback: 450, Wfront: 250, Wback: 150 };

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

console.log('按箱型隔离尺寸');

const LSHAPE_SET = { L: 800, Wfront: 250, Wback: 150, Hfront: 300, Hback: 450 };

check('L 形设过尺寸后切矩形箱：拿到的是矩形箱自己的值，绝不出现 250/150/450', () => {
  const store = { lshape: { ...LSHAPE_SET } };
  const rsc = dimsForShape(store, 'rsc', DEFAULTS);
  assert.deepEqual(rsc, DEFAULTS);
  for (const key of dimKeysFor('rsc')) {
    assert.ok(![250, 150, 450, 800].includes(rsc[key]), `矩形箱的 ${key} 被 L 形的值污染了：${rsc[key]}`);
  }
});

check('切回 L 形：五个值原样还在', () => {
  const store = { lshape: { ...LSHAPE_SET } };
  const back = dimsForShape(store, 'lshape', DEFAULTS);
  for (const key of dimKeysFor('lshape')) {
    assert.equal(back[key], LSHAPE_SET[key], `L 形的 ${key} 丢了`);
  }
});

check('四种箱型两两切换，互不串味', () => {
  const store = {};
  const values = {
    rsc: { L: 700, W: 500, H: 200 },
    lshape: { L: 800, Wfront: 250, Wback: 150, Hfront: 300, Hback: 450 },
    bevel: { L: 900, W: 400, Hfront: 320, Hback: 460 },
    tiandi: { L: 610, W: 410, H: 310 },
  };
  for (const s of SHAPES) store[s.id] = { ...values[s.id] };
  for (const from of SHAPES) {
    for (const to of SHAPES) {
      const dims = dimsForShape(store, to.id, DEFAULTS);
      for (const key of dimKeysFor(to.id)) {
        assert.equal(dims[key], values[to.id][key] ?? DEFAULTS[key], `${from.id}→${to.id} 的 ${key} 不对`);
      }
    }
  }
});

check('从没设置过的箱型用默认示例值', () => {
  const dims = dimsForShape({}, 'tiandi', DEFAULTS);
  assert.deepEqual(dims, DEFAULTS);
});

check('切换过程中旧箱型的值被记下来（模拟 rememberDims）', () => {
  const store = {};
  let dims = { ...DEFAULTS };
  let shape = 'lshape';
  dims = { ...LSHAPE_SET };
  // 切走：先存旧箱型
  store[shape] = { ...dims };
  shape = 'rsc';
  dims = dimsForShape(store, shape, DEFAULTS);
  assert.equal(dims.L, DEFAULTS.L);
  // 切回
  store[shape] = { ...dims };
  shape = 'lshape';
  dims = dimsForShape(store, shape, DEFAULTS);
  for (const key of dimKeysFor('lshape')) assert.equal(dims[key], LSHAPE_SET[key]);
});

console.log('切箱型清空画布');

check('每个箱型的新面板都是空元素（没有任何跨箱型搬运）', () => {
  for (const s of SHAPES) {
    const net = computeNet(DEFAULTS, s.id, { piece: 'lid' });
    const panels = createPanels(net);
    assert.ok(Object.keys(panels).length > 0, s.id + ' 应该有可编辑面板');
    for (const [key, panel] of Object.entries(panels)) {
      assert.ok(Array.isArray(panel.elements) && panel.elements.length === 0, `${s.id} 的 ${key} 不是空的`);
    }
  }
});

console.log('切箱型不进撤销栈');

check('history.reset 之后不能撤销、不能重做', () => {
  const h = new History(60);
  const a = JSON.stringify({ dims: DEFAULTS, panels: { front: { elements: [{ id: 'x' }] } } });
  const b = JSON.stringify({ dims: DEFAULTS, panels: {} });
  h.reset(a);
  h.push(b);
  assert.ok(h.canUndo(), '有过编辑后应该能撤销');
  // 切箱型 = reset 到切换后的状态
  h.reset(b);
  assert.equal(h.canUndo(), false, '切完箱型不该能撤销回上一个箱型');
  assert.equal(h.canRedo(), false);
});

check('草稿里按箱型分开存，重新解析后每份都还在', () => {
  const dimsByShape = {
    rsc: { L: 700, W: 500, H: 200 },
    lshape: { ...LSHAPE_SET },
  };
  const payload = serializeDraft({
    dims: dimsByShape.lshape,
    dimsByShape,
    unit: 'mm',
    shape: 'lshape',
    panels: {},
  });
  assert.equal(payload.version, 5);
  const parsed = parseDraft(JSON.parse(JSON.stringify(payload)));
  assert.deepEqual(parsed.dims, LSHAPE_SET);
  assert.deepEqual(parsed.dimsByShape.rsc, dimsByShape.rsc);
  assert.deepEqual(parsed.dimsByShape.lshape, LSHAPE_SET);
});

check('老草稿（没有 dimsByShape）仍能解析', () => {
  const parsed = parseDraft({ version: 4, dims: { L: 600, W: 400, H: 300 }, shape: 'rsc', unit: 'mm', panels: {} });
  assert.ok(parsed);
  assert.deepEqual(parsed.dims, { L: 600, W: 400, H: 300 });
  assert.deepEqual(parsed.dimsByShape, {});
});

console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
