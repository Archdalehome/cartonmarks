/**
 * tools/test-geometry.mjs —— 几何换算的离线断言
 * 用法：node tools/test-geometry.mjs
 *
 * 红线：内部一律真实毫米。600×400×300 的箱子必须得到 2000×700 的展开图，
 * 12 个区域：4 箱身面 + 4 主摇盖（L×W/2）+ 4 防尘摇盖（W×W/2）。
 */
import assert from 'node:assert/strict';
import { computeNet, computeIso, registerShapeGeometry, listShapeGeometries } from '../assets/js/geometry.js';
import { createPanels } from '../assets/js/project.js';
import '../assets/js/geometry-shapes.js';
import { computeIsoShape } from '../assets/js/geometry-shapes.js';
import { checkClosure, innerFolds } from './closure-check.mjs';

let passed = 0;

function assertPanel(net, key, x, y, w, h, kind) {
  const p = net.panels[key];
  assert.ok(p, '缺少面板 ' + key);
  assert.equal(p.x, x);
  assert.equal(p.y, y);
  assert.equal(p.w, w);
  assert.equal(p.h, h);
  assert.equal(p.kind, kind);
  assert.ok(typeof p.label === 'string' && p.label.length > 0, key + ' 缺少中文标签');
  assert.equal(p.editable, kind !== 'minor', key + ' 可编辑标记不对');
}

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
  const kinds = Object.values(net.panels).map((p) => p.kind);
  assert.equal(kinds.filter((k) => k === 'body').length, 4);
  assert.equal(kinds.filter((k) => k === 'major').length, 4);
  assert.equal(kinds.filter((k) => k === 'minor').length, 4);
});

check('每个区域都带 kind 分类', () => {
  for (const [key, p] of Object.entries(net.panels)) {
    assert.ok(['body', 'major', 'minor'].includes(p.kind), `${key} 缺少 kind`);
  }
});

check('箱身四面：前 600×300 / 右 400×300 / 后 600×300 / 左 400×300', () => {
  assertPanel(net, 'front', 0, 200, 600, 300, 'body');
  assertPanel(net, 'right', 600, 200, 400, 300, 'body');
  assertPanel(net, 'back', 1000, 200, 600, 300, 'body');
  assertPanel(net, 'left', 1600, 200, 400, 300, 'body');
});

check('4 片主摇盖 = L × W/2 = 600 × 200（挂在前/后箱身面）', () => {
  assertPanel(net, 'topFront', 0, 0, 600, 200, 'major');
  assertPanel(net, 'topBack', 1000, 0, 600, 200, 'major');
  assertPanel(net, 'bottomFront', 0, 500, 600, 200, 'major');
  assertPanel(net, 'bottomBack', 1000, 500, 600, 200, 'major');
});

check('4 片防尘摇盖 = W × W/2 = 400 × 200（挂在左/右箱身面）', () => {
  assertPanel(net, 'topRight', 600, 0, 400, 200, 'minor');
  assertPanel(net, 'topLeft', 1600, 0, 400, 200, 'minor');
  assertPanel(net, 'bottomRight', 600, 500, 400, 200, 'minor');
  assertPanel(net, 'bottomLeft', 1600, 500, 400, 200, 'minor');
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

console.log('箱型扩展点');

registerShapeGeometry('fake-l', (dims, id) => ({
  shape: id,
  shapeName: '假 L 形箱（测试用）',
  width: 500,
  height: 300,
  bodyTop: 0,
  bodyBottom: 200,
  panels: {
    panelA: { label: 'A 面', kind: 'body', slot: 'body', editable: true, x: 0, y: 0, w: 300, h: 200 },
    panelB: { label: 'B 面', kind: 'body', slot: 'body', editable: true, x: 300, y: 0, w: 200, h: 100 },
    waste: { label: '废料区', kind: 'minor', slot: 'minor', editable: false, x: 0, y: 200, w: 300, h: 100 },
  },
  outline: [[0, 0], [500, 0], [500, 300], [0, 300]],
  folds: [],
  cuts: [],
  dims,
}));

check('假箱型能注册并被 computeNet 调用', () => {
  const n = computeNet({ L: 10, W: 10, H: 10 }, 'fake-l');
  assert.equal(n.shape, 'fake-l');
  assert.deepEqual(Object.keys(n.panels), ['panelA', 'panelB', 'waste']);
  assert.equal(n.width, 500);
});

check('面板槽位由几何生成：只有 editable 面进 createPanels', () => {
  const n = computeNet({ L: 10, W: 10, H: 10 }, 'fake-l');
  const panels = createPanels(n);
  assert.deepEqual(Object.keys(panels).sort(), ['panelA', 'panelB']);
  assert.equal(panels.panelA.label, 'A 面');
});

check('未注册的箱型会明确报错', () => {
  assert.throws(() => computeNet({ L: 1, W: 1, H: 1 }, 'nope'), /未注册/);
});

check('RSC 已在几何注册表里', () => assert.ok(listShapeGeometries().includes('rsc')));

console.log('M8 斜形箱 / L 形箱');

const bevelDims = { L: 600, W: 400, Hfront: 300, Hback: 450 };
const lshapeDims = { L: 600, Hfront: 300, Hback: 450, Wfront: 250, Wback: 150 };
const bevel = computeNet(bevelDims, 'bevel');
const lshape = computeNet(lshapeDims, 'lshape');
const SLOPE = Math.hypot(400, 150); // 427.2002
const HALF = SLOPE / 2; // 213.6

check('斜形箱：顶部两片对开摇盖 600×213.6，两片合计 = 斜长 427.2', () => {
  assert.equal(bevel.width, 2000);
  assert.equal(bevel.panels.topFront.w, 600);
  assert.equal(bevel.panels.topBack.w, 600);
  assert.ok(Math.abs(bevel.panels.topFront.h - HALF) < 1e-9);
  assert.ok(Math.abs(bevel.panels.topBack.h - HALF) < 1e-9);
  assert.ok(Math.abs(bevel.panels.topFront.h + bevel.panels.topBack.h - SLOPE) < 1e-9);
});

check('斜形箱：总高 = 底盖 200 + max(H前,H后) 450 + 半片 213.6 = 863.6', () => {
  assert.ok(Math.abs(bevel.height - (200 + 450 + HALF)) < 1e-9);
  assert.equal(Object.keys(bevel.panels).length, 10);
  assert.equal(Object.values(bevel.panels).filter((p) => p.editable).length, 8);
});

check('斜形箱：顶部没有防尘摇盖，防尘摇盖只有底面两片', () => {
  const topDust = Object.entries(bevel.panels).filter(
    ([, p]) => p.kind === 'minor' && p.y + p.h <= bevel.panels.front.y + 1e-9,
  );
  assert.equal(topDust.length, 0);
  assert.equal(Object.values(bevel.panels).filter((p) => p.kind === 'minor').length, 2);
});

check('斜形箱：W 只认 W 输入，不被残留的 W(前)/W(后) 干扰', () => {
  const n = computeNet({ L: 600, W: 397, Wfront: 250, Wback: 150, Hfront: 500, Hback: 650 }, 'bevel');
  assert.equal(n.dims.W, 397);
  assert.equal(n.width, 2 * 600 + 2 * 397);
});

check('斜形箱：左右侧面是四点梯形，前边 300、后边 450', () => {
  const r = bevel.panels.right;
  assert.equal(r.points.length, 4);
  assert.equal(r.w, 400);
  assert.equal(r.h, 450);
  assert.equal(r.points[0][1], bevel.height - 200, '侧面底边落在下摇盖折线');
  const frontTop = bevel.panels.front.y;
  assert.equal(r.points[3][1], frontTop, '靠前上角在前箱身面顶边');
  assert.equal(r.points[2][1], frontTop - 150, '靠后上角高出 150');
});

check('L 形箱：顶部一整片 600×550，总高 = 300 + 550 + 200 = 1050', () => {
  assert.equal(lshape.width, 2000);
  assert.equal(lshape.height, 1050);
  assert.equal(lshape.panels.topLid.w, 600);
  assert.equal(lshape.panels.topLid.h, 550);
  assert.equal(lshape.panels.topLid.y, 0);
  assert.equal(lshape.panels.front.y, 550, '前面板顶边 = 顶盖根部 = 550');
});

check('L 形箱：顶盖内两条折线距根部 250 和 400', () => {
  const lid = lshape.panels.topLid;
  const inner = innerFolds(lshape, lid);
  assert.deepEqual(inner, [250, 400]);
});

check('L 形箱：W 由 W(前)+W(后) 派生 = 400，传入的 W 被忽略', () => {
  assert.equal(lshape.dims.W, 400);
  const withLie = computeNet({ ...lshapeDims, W: 9999 }, 'lshape');
  assert.equal(withLie.width, 2000);
  assert.equal(withLie.height, 1050);
});

check('L 形箱：台阶落在右侧面距前边 W(前)=250 处', () => {
  const r = lshape.panels.right;
  assert.equal(r.points.length, 6, '右侧面应是 6 点台阶多边形');
  assert.equal(r.points[3][0], 850, '台阶竖线 x = L + W(前) = 850');
  assert.equal(r.points[2][1], 400, '后段顶边在 450 高处');
  assert.equal(r.points[4][1], 550, '前段顶边在 300 高处');
});

check('L 形箱：任一段宽度为 0 或负数直接报错', () => {
  for (const bad of [
    { Wfront: 0, Wback: 150 },
    { Wfront: 250, Wback: 0 },
    { Wfront: -10, Wback: 150 },
  ]) {
    assert.throws(
      () => computeNet({ L: 600, Hfront: 300, Hback: 450, ...bad }, 'lshape'),
      /W\(前\) 和 W\(后\) 都大于 0/,
    );
  }
});

check('底面：2 片主摇盖各 W/2 + 2 片侧面防尘摇盖（不可编辑、不进 PDF）', () => {
  for (const net of [bevel, lshape]) {
    const dust = Object.values(net.panels).filter((p) => p.kind === 'minor');
    assert.equal(dust.length, 2);
    for (const p of dust) assert.equal(p.editable, false);
    const main = Object.entries(net.panels).filter(
      ([k, p]) => p.kind === 'major' && k.startsWith('bottom'),
    );
    assert.equal(main.length, 2);
    for (const [, p] of main) assert.equal(p.h, 200);
    const editable = Object.keys(createPanels(net)).length;
    assert.equal(editable, Object.keys(net.panels).length - 2);
  }
});

console.log('闭合测试（折起来要盖满、不重叠）');

check('斜形箱闭合：两片顶摇盖合计 = 斜面实长 427.2，每片一半', () => {
  const r = checkClosure(bevel, 'bevel', bevelDims);
  assert.ok(r.ok, r.errors.join('；'));
  assert.equal(r.top.pieces, 2);
  assert.ok(Math.abs(r.top.len - SLOPE) < 1e-9);
  assert.ok(Math.abs(r.bottom.sum - 400) < 1e-9);
  assert.equal(r.bottom.dust, 2);
});

check('L 形箱闭合：整片顶盖 550，两条折线落段界，深度 250+0+150', () => {
  const r = checkClosure(lshape, 'lshape', lshapeDims);
  assert.ok(r.ok, r.errors.join('；'));
  assert.deepEqual(r.top.folds, [250, 400]);
  assert.ok(Math.abs(r.bottom.sum - 400) < 1e-9);
});

check('闭合测试能抓出「斜形箱只有一片顶盖」（回归：一片 427.2 ≠ 两片各半）', () => {
  const oneLid = {
    panels: {
      front: { editable: true, x: 0, y: 600, w: 600, h: 300 },
      topLid: { editable: true, x: 0, y: 172.8, w: 600, h: 427.2 },
      back: { editable: true, x: 1000, y: 450, w: 600, h: 450 },
      bottomFront: { editable: true, x: 0, y: 900, w: 600, h: 200 },
      bottomBack: { editable: true, x: 1000, y: 900, w: 600, h: 200 },
      dustA: { editable: false, kind: 'minor', x: 600, y: 900, w: 400, h: 200 },
      dustB: { editable: false, kind: 'minor', x: 1600, y: 900, w: 400, h: 200 },
    },
    folds: [],
  };
  const r = checkClosure(oneLid, 'bevel', bevelDims);
  assert.equal(r.ok, false, '单片顶盖必须被判不合格');
  assert.ok(r.errors.some((e) => e.includes('两片')), r.errors.join('；'));
});

check('闭合测试能抓出「L 形少一块竖壁」（回归：顶盖只有 400 长）', () => {
  const noRiser = {
    panels: {
      front: { editable: true, x: 0, y: 550, w: 600, h: 300 },
      topLid: { editable: true, x: 0, y: 150, w: 600, h: 400 },
      bottomFront: { editable: true, x: 0, y: 850, w: 600, h: 200 },
      bottomBack: { editable: true, x: 1000, y: 850, w: 600, h: 200 },
      dustA: { editable: false, kind: 'minor', x: 600, y: 850, w: 400, h: 200 },
      dustB: { editable: false, kind: 'minor', x: 1600, y: 850, w: 400, h: 200 },
    },
    folds: [{ x1: 0, y1: 300, x2: 600, y2: 300 }],
  };
  const r = checkClosure(noRiser, 'lshape', lshapeDims);
  assert.equal(r.ok, false, '少竖壁必须被判不合格');
  assert.ok(r.errors.some((e) => e.includes('盖不满')), r.errors.join('；'));
});

check('前后高度任意组合都闭合（H后 < H前 也成立）', () => {
  for (const d of [
    { L: 500, W: 300, Hfront: 400, Hback: 200 },
    { L: 300, W: 200, Hfront: 100, Hback: 600 },
    { L: 1200, W: 700, Hfront: 250, Hback: 250 },
  ]) {
    const n = computeNet(d, 'bevel');
    assert.equal(n.width, 2 * d.L + 2 * d.W);
    const r = checkClosure(n, 'bevel', d);
    assert.ok(r.ok, r.errors.join('；'));
  }
  for (const d of [
    { L: 500, Hfront: 400, Hback: 200, Wfront: 200, Wback: 150 },
    { L: 300, Hfront: 100, Hback: 600, Wfront: 120, Wback: 180 },
  ]) {
    const n = computeNet(d, 'lshape');
    const r = checkClosure(n, 'lshape', d);
    assert.ok(r.ok, r.errors.join('；'));
  }
});

console.log('等轴测可见性（不写死虚线数量）');

const edgeById = (iso, a, b) =>
  iso.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

check('L 形箱：台阶竖棱、顶面交线在等轴测里是实线', () => {
  const iso = computeIsoShape(lshapeDims, 'lshape');
  // 远端竖壁竖棱（剖面点 3→4 在 X=0 那一侧）
  assert.equal(edgeById(iso, 'a3', 'a4')?.hidden, false, '远端竖壁竖棱应为实线');
  // 后段顶面与后箱面的交线（沿长度方向，剖面点 4）
  assert.equal(edgeById(iso, 'a4', 'b4')?.hidden, false, '后段顶面交线应为实线');
  // 台阶两顶面的分界（沿长度方向，剖面点 3）
  assert.equal(edgeById(iso, 'a3', 'b3')?.hidden, false, '台阶顶面分界应为实线');
  // 远端后段顶棱
  assert.equal(edgeById(iso, 'a4', 'a5')?.hidden, false, '远端顶棱应为实线');
});

check('L 形箱：只有真正被挡住的底棱/背棱走虚线', () => {
  const iso = computeIsoShape(lshapeDims, 'lshape');
  assert.equal(edgeById(iso, 'a0', 'a1')?.hidden, true, '底面远棱应被挡住');
  assert.equal(edgeById(iso, 'a5', 'a0')?.hidden, true, '远端背面竖棱应被挡住');
  // 用户 2026-11-01 指出的那条：台阶内侧靠远端的水平底棱（底/背两面都朝里）
  assert.equal(edgeById(iso, 'a0', 'b0')?.hidden, true, '靠远端的底部水平棱应为虚线');
  assert.equal(iso.edges.filter((e) => e.hidden).length, 3);
});

check('斜形箱：斜顶远端棱实线，背面底棱与背竖棱虚线', () => {
  const iso = computeIsoShape(bevelDims, 'bevel');
  assert.equal(edgeById(iso, 'a2', 'a3')?.hidden, false, '斜顶远端棱应为实线');
  // 用户 2026-11-01：背面那条底棱（底面与后箱面相交、靠远侧水平那条）要虚线
  assert.equal(edgeById(iso, 'a0', 'a1')?.hidden, true, '远端底面横棱应为虚线');
  assert.equal(edgeById(iso, 'a0', 'b0')?.hidden, true, '背面底棱应为虚线');
  assert.equal(edgeById(iso, 'a3', 'a0')?.hidden, true, '远端背面竖棱应被挡住');
  assert.equal(iso.edges.filter((e) => e.hidden).length, 3);
});

check('矩形箱仍按老规则：恰好 3 条背棱虚线', () => {
  const iso = computeIso({ L: 600, W: 400, H: 300 });
  assert.equal(iso.edges.filter((e) => e.hidden).length, 3);
});

check('通用规则：所有箱型，凡相邻两面都不可见者必虚线，否则必实线', () => {
  const cases = [
    ['rsc', computeIso({ L: 600, W: 400, H: 300 })],
    ['bevel', computeIsoShape(bevelDims, 'bevel')],
    ['lshape', computeIsoShape(lshapeDims, 'lshape')],
  ];
  for (const [name, iso] of cases) {
    assert.ok(iso.faceVisibility, name + ' 必须暴露面可见性');
    assert.ok(iso.edges.every((e) => Array.isArray(e.adjacent)), name + ' 每条棱都要记相邻面');
    for (const e of iso.edges) {
      const expected = !e.adjacent.some((id) => iso.faceVisibility[id] === true);
      assert.equal(
        e.hidden,
        expected,
        `${name} 的棱 ${e.a}-${e.b}（相邻 ${e.adjacent.join('+')}）可见性判定不一致`,
      );
    }
  }
});

check('斜形箱：左底棱、背面底棱、左背竖棱都是虚线', () => {
  const iso = computeIsoShape({ L: 1000, W: 1000, Hfront: 500, Hback: 1000 }, 'bevel');
  assert.equal(edgeById(iso, 'a0', 'a1')?.hidden, true, '左底棱');
  assert.equal(edgeById(iso, 'a0', 'b0')?.hidden, true, '背面底棱');
  assert.equal(edgeById(iso, 'a3', 'a0')?.hidden, true, '左背竖棱');
  for (const [a, b] of [['b0', 'b1'], ['b1', 'b2'], ['b2', 'b3'], ['b3', 'b0'], ['a1', 'b1']]) {
    assert.equal(edgeById(iso, a, b)?.hidden, false, `${a}-${b} 应实线`);
  }
});


/* ── 天地盖（两件套） ─────────────────────────────── */

const TD = { L: 600, W: 400, H: 300 };

check('天地盖：一次返回两张图，天盖 (L+2H)×(W+2H)、地盖用派生尺寸', () => {
  const net = computeNet(TD, 'tiandi');
  assert.equal(net.pieces.length, 2);
  assert.deepEqual(net.pieces.map((p) => p.id), ['lid', 'base']);
  assert.deepEqual(net.pieces.map((p) => p.label), ['天盖', '地盖']);
  assert.equal(net.nets.lid.width, 600 + 2 * 300);
  assert.equal(net.nets.lid.height, 400 + 2 * 300);
  assert.equal(net.nets.base.width, 580 + 2 * 290);
  assert.equal(net.nets.base.height, 380 + 2 * 290);
  // 两张图各自的总尺寸不同，缩放要各算各的
  assert.notEqual(net.nets.lid.width, net.nets.base.width);
});

check('天地盖：地盖派生尺寸 长宽各 −20、高 −10', () => {
  const net = computeNet(TD, 'tiandi');
  assert.deepEqual(net.nets.base.dims, { L: 580, W: 380, H: 290 });
  assert.deepEqual(net.derived.lid, { L: 600, W: 400, H: 300 });
  assert.deepEqual(net.derived.base, { L: 580, W: 380, H: 290 });
});

check('天地盖：两件都是 5 个区域，可编辑面合计 6 个', () => {
  const net = computeNet(TD, 'tiandi');
  const lid = net.nets.lid;
  const base = net.nets.base;
  assert.equal(Object.keys(lid.panels).length, 5);
  assert.equal(Object.keys(base.panels).length, 5);
  const lidEditable = Object.values(lid.panels).filter((p) => p.editable);
  const baseEditable = Object.values(base.panels).filter((p) => p.editable);
  assert.equal(lidEditable.length, 5);
  assert.equal(baseEditable.length, 1);
  assert.equal(lidEditable.length + baseEditable.length, 6);
  // 地盖只印「反」这一面
  assert.equal(baseEditable[0].label, '地盖反箱唛');
  assert.deepEqual(
    lidEditable.map((p) => p.label).sort(),
    ['天盖左箱唛', '天盖底箱唛', '天盖右箱唛', '天盖正箱唛', '天盖顶箱唛'].sort(),
  );
});

check('天地盖：翻边深 = H，顶（底）面 = L × W，位置是十字布局', () => {
  const net = computeNet(TD, 'tiandi').nets.lid;
  const H = 300;
  const top = net.panels.lidTop;
  assert.deepEqual([top.x, top.y, top.w, top.h], [H, H, 600, 400]);
  assert.deepEqual(
    [net.panels.lidFront.x, net.panels.lidFront.y, net.panels.lidFront.w, net.panels.lidFront.h],
    [300, 700, 600, 300],
  );
  assert.deepEqual([net.panels.lidBack.x, net.panels.lidBack.y, net.panels.lidBack.w, net.panels.lidBack.h], [300, 0, 600, 300]);
  assert.deepEqual([net.panels.lidLeft.x, net.panels.lidLeft.y, net.panels.lidLeft.w, net.panels.lidLeft.h], [0, 300, 300, 400]);
  assert.deepEqual([net.panels.lidRight.x, net.panels.lidRight.y, net.panels.lidRight.w, net.panels.lidRight.h], [900, 300, 300, 400]);
});

check('天地盖：两条折线在左/右翻边根部，外轮廓 12 个点', () => {
  const net = computeNet(TD, 'tiandi').nets.lid;
  assert.equal(net.folds.length, 4);
  assert.equal(net.outline.length, 12);
  assert.equal(net.cuts.length, 0);
});

check('天地盖：两张图同屏，面板 key 带件名不撞名（6 个可编辑面）', () => {
  const net = computeNet(TD, 'tiandi');
  const keys = Object.keys(net.panels).filter((k) => net.panels[k].editable);
  assert.equal(keys.length, 6);
  assert.deepEqual(keys.sort(), ['baseTop', 'lidBack', 'lidFront', 'lidLeft', 'lidRight', 'lidTop']);
  const panels = createPanels(net);
  assert.equal(Object.keys(panels).length, 6);
  // 两件的面板几何互不相同（各自属于自己那张图）
  assert.notEqual(net.panels.lidTop.w, net.panels.baseTop.w);
});
console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
