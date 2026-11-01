/**
 * tools/test-views.mjs —— 用 DOM 垫片把绘制代码真跑一遍
 * 检查：12 个区域、中文标签、尺寸标注、等轴测棱线、无运行时报错。
 * 用法：node tools/test-views.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installDom, makeHost } from './dom-shim.mjs';

installDom();

const { computeNet, registerShapeGeometry } = await import('../assets/js/geometry.js');
const { renderNet } = await import('../assets/js/net-view.js');
const { renderIso, hullLeftX, angleBetween, axisDeviation, pointInPoly, firstFaceHit } = await import(
  '../assets/js/iso-view.js'
);

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
check('12 个区域分组', () => assert.equal(groups.length, 12));
check('只有 8 个可点击（4 箱身面 + 4 主摇盖），防尘摇盖不可点', () => {
  const clickable = groups.filter((g) => g.attrs.role === 'button');
  assert.equal(clickable.length, 8);
  const locked = groups.filter((g) => g.classList.contains('is-locked'));
  assert.equal(locked.length, 4);
  assert.equal(clickable.filter((g) => g.attrs['data-slot'] === 'minor').length, 0);
});
check('区域 data-key 齐全', () => {
  const keys = groups.map((g) => g.attrs['data-panel']).sort();
  assert.deepEqual(keys, [
    'back', 'bottomBack', 'bottomFront', 'bottomLeft', 'bottomRight',
    'front', 'left', 'right', 'topBack', 'topFront', 'topLeft', 'topRight',
  ]);
});
check('主摇盖 / 防尘摇盖分组标记正确', () => {
  const slotOf = (key) => groups.find((g) => g.attrs['data-panel'] === key).attrs['data-slot'];
  assert.equal(slotOf('front'), 'body');
  assert.equal(slotOf('topFront'), 'major');
  assert.equal(slotOf('topRight'), 'minor');
  assert.equal(slotOf('bottomLeft'), 'minor');
});
check('12 个中文标签都在图上', () => {
  const labels = [
    '前箱唛', '右侧箱唛', '后箱唛', '左侧箱唛',
    '前顶箱唛', '右顶箱唛', '后顶箱唛', '左顶箱唛',
    '前底箱唛', '右底箱唛', '后底箱唛', '左底箱唛',
  ];
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
check('面板尺寸标注正确（600×300 / 400×300 / 600×200 / 400×200）', () => {
  assert.ok(texts.includes('600 × 300'), '缺少箱身面尺寸');
  assert.ok(texts.includes('400 × 300'), '缺少侧面尺寸');
  assert.ok(texts.includes('600 × 200'), '缺少主摇盖尺寸');
  assert.ok(texts.includes('400 × 200'), '缺少防尘摇盖尺寸');
});
check('裁切轮廓 1 条、折叠线 11 条、开槽线 6 条', () => {
  assert.equal(svg.filter((n) => n.attrs.class === 'net-outline').length, 1);
  assert.equal(svg.filter((n) => n.attrs.class === 'net-fold').length, 11);
  assert.equal(svg.filter((n) => n.attrs.class === 'net-cut').length, 6);
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

check('面板像素宽高比 = 真实毫米比例（前面板 2:1，主摇盖 3:1，防尘摇盖 2:1）', () => {
  const edge = (key) => groups.find((g) => g.attrs['data-panel'] === key)
    .children.find((c) => c.attrs.class === 'panel-edge');
  const front = edge('front');
  const major = edge('topFront');
  const minor = edge('topRight');
  const right = edge('right');

  // 像素坐标有四舍五入，比例按容差比，不要求严格相等
  const ratio = (n) => Number(n.attrs.width) / Number(n.attrs.height);
  assert.ok(Math.abs(ratio(front) - 2) < 1e-6, '前面板 600:300 = 2');
  assert.ok(Math.abs(ratio(major) - 3) < 1e-6, '主摇盖 600:200 = 3');
  assert.ok(Math.abs(ratio(minor) - 2) < 1e-6, '防尘摇盖 400:200 = 2');
  assert.ok(Math.abs(Number(right.attrs.width) / Number(right.attrs.height) - 4 / 3) < 1e-9);
});

check('整张展开图的像素宽高比 = 2000:700', () => {
  const edge = (key) => groups.find((g) => g.attrs['data-panel'] === key)
    .children.find((c) => c.attrs.class === 'panel-edge');
  const widthMarks = ['front', 'right', 'back', 'left']
    .map((k) => Number(edge(k).attrs.width)).reduce((a, b) => a + b, 0);
  const heightMarks = ['topFront', 'front', 'bottomFront']
    .map((k) => Number(edge(k).attrs.height)).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(widthMarks / heightMarks - 2000 / 700) < 1e-6);
});

check('点击防尘摇盖不会触发选择回调', () => {
  const minor = groups.find((g) => g.attrs['data-panel'] === 'topRight');
  const before = selected.length;
  minor.dispatch('click');
  assert.equal(selected.length, before);
  assert.equal(minor.attrs.tabindex, undefined);
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
  assert.equal(root2.filter((n) => n.attrs['data-panel']).length, 12);
});

console.log('箱型扩展点');

registerShapeGeometry('fake-render', (dims, id) => ({
  shape: id,
  width: 500,
  height: 300,
  bodyTop: 0,
  bodyBottom: 200,
  panels: {
    pa: { label: 'A 面', kind: 'body', slot: 'body', editable: true, x: 0, y: 0, w: 300, h: 200 },
    pb: { label: 'B 面', kind: 'body', slot: 'body', editable: true, x: 300, y: 0, w: 200, h: 100 },
    waste: { label: '废料区', kind: 'minor', slot: 'minor', editable: false, x: 0, y: 200, w: 300, h: 100 },
  },
  outline: [[0, 0], [500, 0], [500, 300], [0, 300]],
  folds: [],
  cuts: [],
  dims,
}));

check('renderNet 完全按几何面板渲染（假箱型 2 个可编辑面 + 1 个不可编辑区）', () => {
  const fakeNet = computeNet(dims, 'fake-render');
  const host3 = makeHost(600);
  renderNet(host3, fakeNet, { onSelect: () => {} });
  const svg3 = host3.children[0];
  const gs = svg3.filter((n) => n.attrs['data-panel']);
  assert.equal(gs.length, 3);
  assert.equal(gs.filter((g) => g.attrs.role === 'button').length, 2);
  assert.equal(gs.filter((g) => g.classList.contains('is-locked')).length, 1);
  assert.ok(gs.some((g) => g.attrs['data-panel'] === 'pa'));
  assert.ok(gs.some((g) => g.attrs['data-panel'] === 'pb'));
});

console.log('标注不重叠（三种箱型）');

const { computeIsoShape } = await import('../assets/js/geometry-shapes.js');

const labelCases = [
  ['rsc', { L: 600, W: 400, H: 300 }],
  ['bevel', { L: 600, W: 400, Hfront: 300, Hback: 450 }],
  ['lshape', { L: 600, Hfront: 300, Hback: 450, Wfront: 250, Wback: 150 }],
];

function boxesIntersect(a, b) {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width - 0.5 &&
    Math.abs(a.y - b.y) * 2 < a.height + b.height - 0.5
  );
}

check('任意两个标注文字的包围盒不相交', () => {
  for (const [name, d] of labelCases) {
    const iso = name === 'rsc' ? d : computeIsoShape(d, name);
    const root = renderIso(makeHost(420), iso);
    const labels = root.__dimLabels || [];
    assert.ok(labels.length >= 3, name + ' 至少要有 3 个标注');
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        assert.ok(
          !boxesIntersect(labels[i], labels[j]),
          `${name} 的标注「${labels[i].text}」与「${labels[j].text}」重叠`,
        );
      }
    }
  }
});

check('L 形箱六个标注齐全（L / W / H(前) / H(后) / W(前) / W(后)）', () => {
  const d = { L: 600, Hfront: 300, Hback: 450, Wfront: 250, Wback: 150 };
  const root = renderIso(makeHost(420), computeIsoShape(d, 'lshape'));
  const texts = (root.__dimLabels || []).map((l) => l.text).join(' ');
  for (const key of ['L ', 'W ', 'H(前)', 'H(后)', 'W(前)', 'W(后)']) {
    assert.ok(texts.includes(key), '缺少标注 ' + key + '，实际：' + texts);
  }
});

check('尺寸线平行于被标的那条棱（夹角 < 1°）', () => {
  for (const [name, d] of labelCases) {
    const iso = name === 'rsc' ? d : computeIsoShape(d, name);
    const root = renderIso(makeHost(420), iso);
    const list = root.__dims || [];
    assert.ok(list.length >= 3, name + ' 至少 3 条尺寸线，实际 ' + list.length);
    for (const item of list) {
      const edge = { x: item.edge.b.x - item.edge.a.x, y: item.edge.b.y - item.edge.a.y };
      const dim = { x: item.line.b.x - item.line.a.x, y: item.line.b.y - item.line.a.y };
      const deg = angleBetween(edge, dim);
      assert.ok(deg < 1, `${name} 的 ${item.key} 尺寸线与棱差 ${deg.toFixed(2)}°`);
    }
  }
});

check('延长线只走等轴测的三个轴向（偏差 < 1°），不会一律水平', () => {
  for (const [name, d] of labelCases) {
    const iso = name === 'rsc' ? d : computeIsoShape(d, name);
    const root = renderIso(makeHost(420), iso);
    const ext = root.__extLines || [];
    for (const e of ext) {
      const deg = axisDeviation(e.x2 - e.x1, e.y2 - e.y1);
      assert.ok(deg < 1, `${name} 的延长线与等轴测轴差 ${deg.toFixed(2)}°（${e.x1},${e.y1}→${e.x2},${e.y2}）`);
    }
  }
});

check('延长线不压在可见面上（三种箱型）', () => {
  for (const [name, d] of labelCases) {
    const iso = name === 'rsc' ? d : computeIsoShape(d, name);
    const root = renderIso(makeHost(420), iso);
    const ext = root.__extLines || [];
    const faces = root.__faces || [];
    for (const e of ext) {
      const p = { x: e.x1, y: e.y1 };
      const q = { x: e.x2, y: e.y2 };
      assert.ok(!faces.some((poly) => pointInPoly(p, poly)), `${name} 的延长线端点落在可见面上`);
      assert.ok(!faces.some((poly) => pointInPoly(q, poly)), `${name} 的延长线末端落在可见面上`);
      const hit = firstFaceHit(p, q, faces);
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      assert.ok(
        hit === null || len * hit > len - 3.5,
        `${name} 的延长线穿进可见面（${(len * (hit || 1)).toFixed(1)}/${len.toFixed(1)}px）`,
      );
    }
  }
});

check('各种宽度下所有图元都在画布内（标注不被裁掉）', () => {
  for (const width of [340, 420, 560, 760]) {
    for (const [name, d] of labelCases) {
      const iso = name === 'rsc' ? d : computeIsoShape(d, name);
      const root = renderIso(makeHost(width), iso);
      const W = Number(root.attrs.width);
      const H = Number(root.attrs.height);
      const inside = (x, y, what) => {
        assert.ok(
          x >= -1 && x <= W + 1 && y >= -1 && y <= H + 1,
          `${name} @${width}px 的${what}跑出画布（${x.toFixed(1)}, ${y.toFixed(1)} / ${W}×${H}）`,
        );
      };
      for (const el of root.walk()) {
        const a = el.attrs;
        if (a.x1 !== undefined) inside(Number(a.x1), Number(a.y1), '线段起点');
        if (a.x2 !== undefined) inside(Number(a.x2), Number(a.y2), '线段终点');
      }
      for (const label of root.__dimLabels || []) {
        const halfW = label.width / 2;
        const halfH = label.height / 2;
        inside(label.x - halfW, label.y - halfH, `标注「${label.text}」的左上角`);
        inside(label.x + halfW, label.y + halfH, `标注「${label.text}」的右下角`);
      }
    }
  }
});


console.log('版本标签只给管理员');

check('首页 HTML 里没有写死的版本标签（匿名访问拿到的 HTML 不含它）', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('stageTag'), 'index.html 里不该有 stageTag 节点');
  assert.ok(!html.includes('M9 · 模板保存与调用'), 'index.html 里不该写死版本号');
});

check('版本标签由 app.js 按 /api/me 的 isAdmin 动态插入', () => {
  const src = fs.readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
  assert.ok(/function renderStageTag\(/.test(src), 'app.js 应有 renderStageTag');
  assert.ok(/isAdmin === true/.test(src), '应按 isAdmin 判断');
  assert.ok(/renderStageTag\(acc\)/.test(src), 'onAccountChanged 里要调用');
  assert.ok(/createElement\('span'\)/.test(src), '标签应动态创建，不能用 display:none');
});

console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
