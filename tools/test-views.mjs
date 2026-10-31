/**
 * tools/test-views.mjs —— 用 DOM 垫片把绘制代码真跑一遍
 * 检查：8 个面板、中文标签、尺寸标注、等轴测棱线、无运行时报错。
 * 用法：node tools/test-views.mjs
 */
import assert from 'node:assert/strict';
import { installDom, makeHost } from './dom-shim.mjs';

installDom();

const { computeNet } = await import('../assets/js/geometry.js');
const { renderNet } = await import('../assets/js/net-view.js');
const { renderIso } = await import('../assets/js/iso-view.js');

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
const host = makeHost(760);
const selected = [];
const api = renderNet(host, net, { selected: null, onSelect: (k) => selected.push(k) });

const svg = host.children[0];
const groups = svg.filter((n) => n.tagName === 'g' && n.attrs['data-panel']);
const texts = svg.filter((n) => n.tagName === 'text').map((n) => n.textContent);

console.log('展开图渲染');

check('生成 SVG 且宽度等于容器内容宽度', () => {
  assert.ok(svg, '没有生成 svg');
  assert.equal(svg.attrs.width, '760');
});
check('8 个面板分组', () => assert.equal(groups.length, 8));
check('面板 data-key 齐全', () => {
  const keys = groups.map((g) => g.attrs['data-panel']).sort();
  assert.deepEqual(keys, [
    'back', 'bottomBack', 'bottomFront', 'front', 'left', 'right', 'topBack', 'topFront',
  ]);
});
check('8 个中文标签都在图上', () => {
  const labels = ['前箱唛', '右侧箱唛', '后箱唛', '左侧箱唛', '前顶箱唛', '后顶箱唛', '前底箱唛', '后底箱唛'];
  for (const label of labels) assert.ok(texts.includes(label), `缺少标签：${label}`);
});
check('标注展开总尺寸 2,000 / 700', () => {
  assert.ok(texts.includes('2,000 mm'), '缺少总宽标注');
  assert.ok(texts.includes('700 mm'), '缺少总高标注');
});
check('标注 L / W / H', () => {
  assert.ok(texts.includes('L 600'));
  assert.ok(texts.includes('W 400'));
  assert.ok(texts.includes('H 300'));
});
check('面板尺寸标注正确（600 × 300 / 400 × 300 / 600 × 200）', () => {
  assert.ok(texts.includes('600 × 300'), '缺少前面板尺寸');
  assert.ok(texts.includes('400 × 300'), '缺少侧面尺寸');
  assert.ok(texts.includes('600 × 200'), '缺少摇盖尺寸');
});
check('裁切轮廓与折叠线都画了', () => {
  assert.ok(svg.filter((n) => n.attrs.class === 'net-outline').length === 1);
  assert.equal(svg.filter((n) => n.attrs.class === 'net-fold').length, net.folds.length);
});
check('点击面板能回调 key', () => {
  const front = groups.find((g) => g.attrs['data-panel'] === 'front');
  assert.equal(front.attrs.role, 'button');
  front.dispatch('click');
  assert.deepEqual(selected, ['front']);
});
check('select() 只高亮一个面板', () => {
  api.select('right');
  const on = groups.filter((g) => g.classList.contains('is-selected'));
  assert.equal(on.length, 1);
  assert.equal(on[0].attrs['data-panel'], 'right');
  api.select(null);
  assert.equal(groups.filter((g) => g.classList.contains('is-selected')).length, 0);
});

check('面板像素宽高比 = 真实毫米比例（前面板 2:1，摇盖 3:1，侧面 4:3）', () => {
  const edge = (key) => groups.find((g) => g.attrs['data-panel'] === key)
    .children.find((c) => c.attrs.class === 'panel-edge');
  const front = edge('front');
  const flap = edge('topFront');
  const right = edge('right');

  assert.equal(Number(front.attrs.width) / Number(front.attrs.height), 2); // 600:300
  assert.equal(Number(flap.attrs.width) / Number(flap.attrs.height), 3); // 600:200
  assert.ok(Math.abs(Number(right.attrs.width) / Number(right.attrs.height) - 4 / 3) < 1e-9);
});

check('整张展开图的像素宽高比 = 2000:700', () => {
  const edge = (key) => groups.find((g) => g.attrs['data-panel'] === key)
    .children.find((c) => c.attrs.class === 'panel-edge');
  const xs = ['front', 'right', 'back', 'left'].map((k) => edge(k));
  const widthMarks = Number(edge('front').attrs.width) + Number(edge('right').attrs.width)
    + Number(edge('back').attrs.width) + Number(edge('left').attrs.width);
  const heightMarks = Number(edge('topFront').attrs.height) + Number(edge('front').attrs.height)
    + Number(edge('bottomFront').attrs.height);
  assert.ok(Math.abs(widthMarks / heightMarks - 2000 / 700) < 1e-6);
  assert.ok(xs.length === 4);
});

console.log('等轴测渲染');

const isoHost = makeHost(420);
const isoRoot = renderIso(isoHost, dims);
const isoTexts = isoRoot.filter((n) => n.tagName === 'text').map((n) => n.textContent);

check('生成 SVG', () => assert.ok(isoRoot));
check('12 条棱线', () => {
  assert.equal(isoRoot.filter((n) => (n.attrs.class || '').startsWith('iso-edge')).length, 12);
});
check('3 条被遮挡的背棱用虚线', () => {
  const hidden = isoRoot.filter((n) => (n.attrs.class || '').includes('is-hidden'));
  assert.equal(hidden.length, 3);
});
check('三个可见面有填充', () => {
  assert.equal(isoRoot.filter((n) => n.attrs.class === 'iso-fill').length, 3);
});
check('标注 L / W / H', () => {
  assert.ok(isoTexts.includes('L 600'));
  assert.ok(isoTexts.includes('W 400'));
  assert.ok(isoTexts.includes('H 300'));
});

console.log('响应式');

check('容器变窄时 SVG 宽度同步变化', () => {
  const narrow = makeHost(360);
  renderNet(narrow, net, { onSelect: () => {} });
  const root2 = narrow.children[0];
  assert.equal(root2.attrs.width, '360');
  // 窄容器下仍必须有 8 个面板
  assert.equal(root2.filter((n) => n.attrs['data-panel']).length, 8);
});

console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
