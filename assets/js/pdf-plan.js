/**
 * pdf-plan.js —— PDF 导出的纯计算（不含 jsPDF / DOM，方便离线断言）
 *
 * 导出只有一种方式：整张展开图一页。
 * 页面尺寸 = 展开图尺寸 × (1 + 2 × 5%)，图形仍按 1:1 真实毫米绘制、居中放在页面里，
 * 所以四周各留 5% 空白，用户按「实际大小」打印出来尺寸依然准确。
 * PDF 1.7 单页上限 14400 pt ≈ 5080 mm，超过就把整页等比缩到上限并提示。
 */

export const PDF_MAX_MM = 5080;
export const MIN_DPI = 150;

/** 页面四周留白（占页面边长的比例，每边 5%） */
export const PAGE_PADDING_RATIO = 0.05;

/** A4 横向（毫米）——当前 UI 默认用它 */
export const A4_LANDSCAPE = { width: 297, height: 210 };

/**
 * 精确 1:1 打印用的页面：展开图 × (1 + 2×5%)，图形 1:1 居中。
 * 目前 UI 不再调用（导出走 A4 横向等比缩放），**保留供将来恢复精确打印**：
 * exportPdf 传 layout: 'exact' 即可，测试也还在。
 * @param {{width:number,height:number}} net
 */
export function computePageSize(net) {
  const factor = 1 + PAGE_PADDING_RATIO * 2;
  const longest = Math.max(net.width, net.height) * factor;
  const scale = longest > PDF_MAX_MM ? PDF_MAX_MM / longest : 1;
  const drawWidth = net.width * scale;
  const drawHeight = net.height * scale;
  return {
    width: net.width * factor * scale,
    height: net.height * factor * scale,
    drawWidth,
    drawHeight,
    offsetX: (net.width * factor * scale - drawWidth) / 2,
    offsetY: (net.height * factor * scale - drawHeight) / 2,
    scale,
    scaled: scale < 1,
    limit: PDF_MAX_MM,
    padding: PAGE_PADDING_RATIO,
    layout: 'exact',
  };
}

/**
 * A4 横向：页面固定 297 × 210，四周留 5%（左右各 14.85、上下各 10.5），
 * 展开图等比缩到可用区里居中，不裁切、不拉伸。
 * @param {{width:number,height:number}} net
 */
export function computeA4Page(net, paper = A4_LANDSCAPE) {
  const marginX = paper.width * PAGE_PADDING_RATIO;
  const marginY = paper.height * PAGE_PADDING_RATIO;
  const usableWidth = paper.width - marginX * 2;
  const usableHeight = paper.height - marginY * 2;
  const scale = Math.min(usableWidth / net.width, usableHeight / net.height);
  const drawWidth = net.width * scale;
  const drawHeight = net.height * scale;
  return {
    width: paper.width,
    height: paper.height,
    marginX,
    marginY,
    usableWidth,
    usableHeight,
    drawWidth,
    drawHeight,
    offsetX: marginX + (usableWidth - drawWidth) / 2,
    offsetY: marginY + (usableHeight - drawHeight) / 2,
    scale,
    scaled: scale < 1,
    padding: PAGE_PADDING_RATIO,
    layout: 'a4',
  };
}

/** 把某个面板里的元素换算成整张展开图的绝对毫米坐标 */
export function absoluteElements(net, panels, panelKey) {
  const geo = net.panels[panelKey];
  if (!geo) return [];
  return panels[panelKey].elements.map((el) => ({
    ...el,
    ax: geo.x + el.x,
    ay: geo.y + el.y,
  }));
}

/** 生成页计划：整张展开图一页（导出只有这一种方式） */
export function collectPages({ net, panels }) {
  const keys = Object.keys(panels).filter((k) => panels[k] && Array.isArray(panels[k].elements));
  const all = [];
  for (const key of keys) all.push(...absoluteElements(net, panels, key));
  return [{ panelKey: null, label: '整张展开图', elements: all }];
}

/** 裁切线 / 开槽线 / 折叠线（毫米坐标） */
export function collectLines(net) {
  return {
    outline: net.outline,
    cuts: net.cuts,
    folds: net.folds,
  };
}

/** 图片的有效打印分辨率（dpi）：像素宽 / 打印宽度（英寸） */
export function imageDpi(element, pixelWidth) {
  const inches = element.w / 25.4;
  return inches > 0 ? pixelWidth / inches : 0;
}

/**
 * 文件名/元信息里的尺寸串：矩形箱 L×W×H；有高差的箱型带上「前-后」两个高度。
 * 注意 state.dims 里始终躺着 Hfront/Hback（默认值），所以必须按箱型判断，
 * 否则矩形箱会被写成 600x400x300-450。
 */
export function dimsTag(dims, shape = 'rsc') {
  const r = (v) => Math.round(Number(v));
  if ((shape === 'bevel' || shape === 'lshape') && dims.Hfront != null) {
    const W = dims.W ?? Number(dims.Wfront) + Number(dims.Wback);
    return `${r(dims.L)}x${r(W)}x${r(dims.Hfront)}-${r(dims.Hback)}`;
  }
  return `${r(dims.L)}x${r(dims.W)}x${r(dims.H)}`;
}

/**
 * 文件名：cartonmark_<箱型>_<尺寸>_A4_<日期>.pdf
 *   矩形箱 cartonmark_rsc_600x400x300_A4_20261101.pdf
 *   天地盖 cartonmark_tiandi_600x400_300-290_A4_20261101.pdf
 */
export function exportFileName(dims, now = new Date(), shape = 'rsc', sizeTag = '') {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const size = sizeTag || dimsTag(dims, shape);
  return `cartonmark_${shape}_${size}_A4_${stamp}.pdf`;
}

/** 汇总导出前的信息，供弹层展示 */
export function summarize({ net, panels }) {
  const page = computeA4Page(net);
  const keys = Object.keys(panels);
  const usedPanels = keys.filter((k) => panels[k].elements.length);
  const elementCount = keys.reduce((n, k) => n + panels[k].elements.length, 0);
  const imageCount = keys.reduce(
    (n, k) => n + panels[k].elements.filter((e) => e.type === 'image').length,
    0,
  );
  return {
    pageSize: page,
    pages: elementCount ? 1 : 0,
    usedPanels: usedPanels.length,
    elementCount,
    imageCount,
  };
}