/**
 * tools/test-pdf-plan.mjs —— PDF 页计划的离线断言
 * 用法：node tools/test-pdf-plan.mjs
 */
import assert from 'node:assert/strict';
import { computeNet } from '../assets/js/geometry.js';
import '../assets/js/geometry-shapes.js';
import {
  computePageSize,
  computeA4Page,
  collectPages,
  collectLines,
  imageDpi,
  exportFileName,
  summarize,
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

check('精确 1:1 路径（保留）：页面 = 展开图 × 1.1，图形 1:1 居中', () => {
  const page = computePageSize(net);
  assert.equal(page.width, 2200);
  assert.ok(Math.abs(page.height - 770) < 1e-9);
  assert.equal(page.drawWidth, 2000);
  assert.equal(page.drawHeight, 700);
  assert.equal(page.scale, 1);
  assert.equal(page.layout, 'exact');
});

check('A4 横向：页面固定 297 × 210，四周留白 5%，展开图等比缩进可用区', () => {
  const page = computeA4Page(net);
  assert.equal(page.width, 297);
  assert.equal(page.height, 210);
  assert.ok(Math.abs(page.marginX - 14.85) < 1e-9);
  assert.ok(Math.abs(page.marginY - 10.5) < 1e-9);
  assert.ok(Math.abs(page.usableWidth - 267.3) < 1e-9);
  assert.equal(page.usableHeight, 189);
  assert.ok(Math.abs(page.scale - 267.3 / 2000) < 1e-12);
  assert.ok(Math.abs(page.drawWidth - 267.3) < 1e-9);
  assert.ok(page.drawHeight <= 189 + 1e-9);
  assert.ok(Math.abs(page.offsetX - page.marginX) < 1e-9);
  assert.ok(Math.abs(page.offsetY - page.marginY - (page.usableHeight - page.drawHeight) / 2) < 1e-9);
  assert.equal(page.layout, 'a4');
});

check('A4 横向：高瘦展开图受高度限制，不被拉伸', () => {
  const tall = { width: 500, height: 3000 };
  const page = computeA4Page(tall);
  assert.ok(Math.abs(page.scale - 189 / 3000) < 1e-12);
  assert.ok(Math.abs(page.drawWidth / page.drawHeight - 500 / 3000) < 1e-12);
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
  const pages = collectPages({ net, panels });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].elements.length, 2);

  const text = pages[0].elements.find((e) => e.type === 'text');
  assert.equal(text.ax, net.panels.front.x + 10);
  assert.equal(text.ay, net.panels.front.y + 20);

  const image = pages[0].elements.find((e) => e.type === 'image');
  assert.equal(image.ax, net.panels.back.x + 5);
  assert.equal(image.ay, net.panels.back.y + 5);
});

check('防尘摇盖不参与导出（面板集合只有 8 个可编辑面）', () => {
  const pages = collectPages({ net, panels });
  const keys = Object.keys(panels);
  assert.equal(keys.length, 8);
  assert.ok(!keys.includes('topRight'));
  assert.equal(collectLines(net).folds.length, 11);
  assert.equal(collectLines(net).cuts.length, 6);
});

check('元素不会跑到面板外（坐标已由编辑器夹住，再校验一次）', () => {
  for (const page of collectPages({ net, panels })) {
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
  assert.equal(name, 'cartonmark_rsc_600x400x300_A4_20261031.pdf');
});

check('summarize 统计正确', () => {
  const s = summarize({ net, panels });
  assert.equal(s.pages, 1);
  assert.equal(s.usedPanels, 2);
  assert.equal(s.elementCount, 2);
  assert.equal(s.imageCount, 1);
  assert.equal(s.pageSize.width, 297);
});

console.log('导出与文件命名');

check('线条参与页计划：绝对坐标 + 不占图片计数', () => {
  const linePanels = {
    front: {
      label: '前箱唛',
      elements: [{ id: 'l1', type: 'line', x: 100, y: 50, w: 270, h: 10, orientation: 'horizontal', color: '#000000' }],
    },
  };
  const pages = collectPages({ net, panels: linePanels });
  const line = pages[0].elements[0];
  assert.equal(line.ax, net.panels.front.x + 100);
  assert.equal(line.ay, net.panels.front.y + 50);
  assert.equal(line.w, 270);
  assert.equal(line.h, 10);

  const s = summarize({ net, panels: linePanels });
  assert.equal(s.elementCount, 1);
  assert.equal(s.imageCount, 0);
});

/* ── 天地盖两页导出 ─────────────────────────────── */

check('天地盖：两页都是 A4 横向，各自等比缩进可用区', () => {
  const lid = computeNet({ L: 600, W: 400, H: 300 }, 'tiandi').nets.lid;
  const base = computeNet({ L: 600, W: 400, H: 300 }, 'tiandi').nets.base;
  const a = computeA4Page(lid);
  const b = computeA4Page(base);
  assert.equal(a.width, 297);
  assert.equal(b.width, 297);
  assert.equal(a.height, 210);
  assert.equal(b.height, 210);
  // 两件都是受高度限制（189 / 高 更小）
  assert.ok(Math.abs(a.scale - 189 / 1000) < 1e-12);
  assert.ok(Math.abs(b.scale - 189 / 960) < 1e-12);
});

check('天地盖：两页各自加 5% 留白（1320×1100 / 1276×1056）', () => {
  const lid = computeNet({ L: 600, W: 400, H: 300 }, 'tiandi').nets.lid;
  const base = computeNet({ L: 600, W: 400, H: 300 }, 'tiandi').nets.base;
  const a = computePageSize(lid);
  const b = computePageSize(base);
  assert.equal(a.width, 1320);
  assert.equal(a.height, 1100);
  assert.equal(a.drawWidth, 1200);
  assert.equal(b.width, 1276);
  assert.equal(b.height, 1056);
  assert.equal(b.drawWidth, 1160);
});
check('天地盖：文件名带两件的高度（cartonmark_tiandi_600x400_300-290_日期.pdf）', () => {
  const name = exportFileName(
    { L: 600, W: 400, H: 300 },
    new Date(2026, 10, 1),
    'tiandi',
    '600x400_300-290',
  );
  assert.equal(name, 'cartonmark_tiandi_600x400_300-290_A4_20261101.pdf');
});

check('普通箱型的文件名不受影响', () => {
  assert.equal(exportFileName({ L: 600, W: 400, H: 300 }, new Date(2026, 10, 1)), 'cartonmark_rsc_600x400x300_A4_20261101.pdf');
});
console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败' : '，全部通过'}`);
