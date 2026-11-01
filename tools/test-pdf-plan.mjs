/**
 * tools/test-pdf-plan.mjs —— PDF 页计划的离线断言
 * 用法：node tools/test-pdf-plan.mjs
 */
import assert from 'node:assert/strict';
import { computeNet } from '../assets/js/geometry.js';
import '../assets/js/geometry-shapes.js';
import {
  computePageSize,
  collectPages,
  collectLines,
  imageDpi,
  exportFileName,
  summarize,
  planTiles,
  PDF_MAX_MM,
} from '../assets/js/pdf-plan.js';

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

const panels = {
  front: {
    label: '前箱唛',
    elements: [{ id: 't1', type: 'text', x: 10, y: 20, w: 100, h: 30, fontSize: 20, text: '小心轻放' }],
  },
  back: {
    label: '后箱唛',
    elements: [{ id: 'i1', type: 'image', x: 5, y: 5, w: 50, h: 40, src: 'data:image/png;base64,AAAA' }],
  },
  right: { label: '右侧箱唛', elements: [] },
  left: { label: '左侧箱唛', elements: [] },
  topFront: { label: '前顶箱唛', elements: [] },
  topBack: { label: '后顶箱唛', elements: [] },
  bottomFront: { label: '前底箱唛', elements: [] },
  bottomBack: { label: '后底箱唛', elements: [] },
};

console.log('页面尺寸');

check('2000 × 700 mm 的箱子页面就是 2000 × 700 mm', () => {
  const page = computePageSize(net);
  assert.equal(page.width, 2000);
  assert.equal(page.height, 700);
  assert.equal(page.scale, 1);
  assert.equal(page.scaled, false);
});

check('超过 PDF 页面上限时等比缩到 5080 mm 以内', () => {
  const big = computeNet({ L: 1500, W: 1200, H: 800 }); // 宽 5400
  const page = computePageSize(big);
  assert.ok(page.scaled);
  assert.ok(Math.abs(Math.max(page.width, page.height) - PDF_MAX_MM) < 1e-6);
  // 比例保持
  assert.ok(Math.abs(page.width / page.height - big.width / big.height) < 1e-9);
});

console.log('页计划');

check('整张模式：只有 1 页，元素按面板偏移换算成绝对坐标', () => {
  const pages = collectPages({ net, panels, mode: 'sheet' });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].elements.length, 2);

  const text = pages[0].elements.find((e) => e.type === 'text');
  assert.equal(text.ax, net.panels.front.x + 10);
  assert.equal(text.ay, net.panels.front.y + 20);

  const image = pages[0].elements.find((e) => e.type === 'image');
  assert.equal(image.ax, net.panels.back.x + 5);
  assert.equal(image.ay, net.panels.back.y + 5);
});

check('每面一页模式：只给有内容的面出页', () => {
  const pages = collectPages({ net, panels, mode: 'panel' });
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map((p) => p.panelKey).sort(), ['back', 'front']);
  for (const page of pages) {
    assert.equal(page.elements.length, 1);
  }
});

check('防尘摇盖不参与导出（面板集合只有 8 个可编辑面）', () => {
  const pages = collectPages({ net, panels, mode: 'sheet' });
  const keys = Object.keys(panels);
  assert.equal(keys.length, 8);
  assert.ok(!keys.includes('topRight'));
  assert.equal(collectLines(net).folds.length, 11);
  assert.equal(collectLines(net).cuts.length, 6);
});

check('元素不会跑到面板外（坐标已由编辑器夹住，再校验一次）', () => {
  for (const page of collectPages({ net, panels, mode: 'sheet' })) {
    for (const el of page.elements) {
      assert.ok(el.ax >= 0 && el.ay >= 0);
      assert.ok(el.ax + el.w <= net.width + 1e-6);
      assert.ok(el.ay + el.h <= net.height + 1e-6);
    }
  }
});

console.log('图片 dpi 与文件名');

check('图片 dpi = 像素宽 / 打印宽度（英寸）', () => {
  // 1000px 打印宽度 254mm（10 英寸）→ 100 dpi
  assert.ok(Math.abs(imageDpi({ w: 254 }, 1000) - 100) < 1e-9);
  // 600px 打印宽度 50.8mm（2 英寸）→ 300 dpi
  assert.ok(Math.abs(imageDpi({ w: 50.8 }, 600) - 300) < 1e-9);
});

check('文件名带日期与尺寸', () => {
  const name = exportFileName(dims, new Date(2026, 9, 31));
  assert.equal(name, 'cartonmark_600x400x300_20261031.pdf');
});

check('summarize 统计正确', () => {
  const s = summarize({ net, panels, mode: 'sheet' });
  assert.equal(s.pages, 1);
  assert.equal(s.usedPanels, 2);
  assert.equal(s.elementCount, 2);
  assert.equal(s.imageCount, 1);
  assert.equal(s.pageSize.width, 2000);
});

console.log('A3/A4 拼版');

check('2000×700 用 A3：横放 420×297，可用 404×281，5 列 × 3 行 = 15 块', () => {
  const plan = planTiles(net, 'a3');
  assert.equal(plan.pageWidth, 420);
  assert.equal(plan.pageHeight, 297);
  assert.equal(plan.cols, 5);
  assert.equal(plan.rows, 3);
  assert.equal(plan.tiles.length, 15);
});

check('拼版 1:1：所有块拼起来正好盖满展开图，且不超出可用区域', () => {
  const plan = planTiles(net, 'a3');
  const maxX = Math.max(...plan.tiles.map((t) => t.x + t.w));
  const maxY = Math.max(...plan.tiles.map((t) => t.y + t.h));
  assert.ok(Math.abs(maxX - net.width) < 1e-6, `maxX=${maxX}`);
  assert.ok(Math.abs(maxY - net.height) < 1e-6, `maxY=${maxY}`);
  for (const tile of plan.tiles) {
    assert.ok(tile.w <= plan.usableW + 1e-9);
    assert.ok(tile.h <= plan.usableH + 1e-9);
    assert.ok(tile.w > 0 && tile.h > 0);
  }
});

check('四角块的「接边」方向正确', () => {
  const plan = planTiles(net, 'a3');
  const first = plan.tiles[0];
  const last = plan.tiles[plan.tiles.length - 1];
  assert.equal(first.hasLeft, false);
  assert.equal(first.hasTop, false);
  assert.equal(first.hasRight, true);
  assert.equal(first.hasBottom, true);
  assert.equal(last.hasLeft, true);
  assert.equal(last.hasTop, true);
  assert.equal(last.hasRight, false);
  assert.equal(last.hasBottom, false);
});

check('A4 拼版块数更多，且纸张名正确', () => {
  const a4 = planTiles(net, 'a4');
  assert.ok(a4.tiles.length > planTiles(net, 'a3').tiles.length);
  assert.equal(a4.paperName, 'A4');
});

check('summarize 支持拼版模式', () => {
  const s = summarize({ net, panels, mode: 'tile', tilePaper: 'a3' });
  assert.equal(s.pages, 15);
  assert.equal(s.pageSize.width, 420);
  assert.ok(s.tilePlan && s.tilePlan.tiles.length === 15);
});

console.log('线条元素');

check('线条参与页计划：绝对坐标 + 不占图片计数', () => {
  const linePanels = {
    front: {
      label: '前箱唛',
      elements: [{ id: 'l1', type: 'line', x: 100, y: 50, w: 270, h: 10, orientation: 'horizontal', color: '#000000' }],
    },
  };
  const pages = collectPages({ net, panels: linePanels, mode: 'sheet' });
  const line = pages[0].elements[0];
  assert.equal(line.ax, net.panels.front.x + 100);
  assert.equal(line.ay, net.panels.front.y + 50);
  assert.equal(line.w, 270);
  assert.equal(line.h, 10);

  const s = summarize({ net, panels: linePanels, mode: 'sheet' });
  assert.equal(s.elementCount, 1);
  assert.equal(s.imageCount, 0);
});

/* ── 天地盖两页导出 ─────────────────────────────── */

check('天地盖：两件各出 1 页，页面就是各自展开图尺寸（1200×1000 / 1160×960）', () => {
  const lid = computeNet({ L: 600, W: 400, H: 300 }, 'tiandi').nets.lid;
  const base = computeNet({ L: 600, W: 400, H: 300 }, 'tiandi').nets.base;
  assert.deepEqual(computePageSize(lid), { width: 1200, height: 1000, scale: 1, scaled: false, limit: PDF_MAX_MM });
  assert.deepEqual(computePageSize(base), { width: 1160, height: 960, scale: 1, scaled: false, limit: PDF_MAX_MM });
});

check('天地盖：拼版两块分开编号，块号各自从 1 开始', () => {
  const lid = computeNet({ L: 600, W: 400, H: 300 }, 'tiandi').nets.lid;
  const base = computeNet({ L: 600, W: 400, H: 300 }, 'tiandi').nets.base;
  const a = planTiles(lid, 'a4');
  const b = planTiles(base, 'a4');
  assert.ok(a.tiles.length > 1, 'A4 放不下 1200×1000，应该切块');
  assert.equal(a.tiles[0].index, 1);
  assert.equal(b.tiles[0].index, 1, '地盖的块号要重新从 1 开始，不能接着天盖编号');
  assert.equal(a.tiles[a.tiles.length - 1].total, a.tiles.length);
  assert.equal(b.tiles[b.tiles.length - 1].total, b.tiles.length);
});

check('天地盖：文件名带两件的高度（cartonmark_tiandi_600x400_300-290_日期.pdf）', () => {
  const name = exportFileName(
    { L: 600, W: 400, H: 300 },
    new Date(2026, 10, 1),
    'tiandi_600x400_300-290',
  );
  assert.equal(name, 'cartonmark_tiandi_600x400_300-290_20261101.pdf');
});

check('普通箱型的文件名不受影响', () => {
  assert.equal(exportFileName({ L: 600, W: 400, H: 300 }, new Date(2026, 10, 1)), 'cartonmark_600x400x300_20261101.pdf');
});
console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
