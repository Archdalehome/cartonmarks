/**
 * pdf-plan.js —— PDF 导出的纯计算（不含 jsPDF / DOM，方便离线断言）
 *
 * 页面尺寸 = 展开图真实毫米 (2L + 2W) × (H + W)，1:1。
 * PDF 1.7 单页上限 14400 pt ≈ 5080 mm，超出的箱子只能等比缩到上限并提示。
 */

export const PDF_MAX_MM = 5080;
export const MIN_DPI = 150;

/** A4 / A3 纸张（毫米，竖放） */
export const PAPER_SIZES = {
  a4: { id: 'a4', name: 'A4', width: 210, height: 297 },
  a3: { id: 'a3', name: 'A3', width: 297, height: 420 },
};

/** 拼版时四周留白（放裁切标记和「接哪边」提示） */
export const TILE_MARGIN_MM = 8;

export const EXPORT_MODES = {
  sheet: '整张展开图（一页，1:1）',
  panel: '每个有内容的面各一页',
  tile: 'A3/A4 拼版（1:1，多张拼接）',
};

/**
 * 把展开图按纸张切成若干块，1:1 不缩放。
 * 每块给出：覆盖的展开图区域、纸张上的落点、以及上下左右是否有邻块。
 */
export function planTiles(net, paperId = 'a3') {
  const paper = PAPER_SIZES[paperId] || PAPER_SIZES.a3;
  // 让纸张朝向尽量贴合展开图
  const portrait = { w: paper.width, h: paper.height };
  const landscape = { w: paper.height, h: paper.width };
  const useLandscape = net.width / net.height > portrait.w / portrait.h;
  const page = useLandscape ? landscape : portrait;

  const usableW = page.w - TILE_MARGIN_MM * 2;
  const usableH = page.h - TILE_MARGIN_MM * 2;
  const cols = Math.max(1, Math.ceil(net.width / usableW));
  const rows = Math.max(1, Math.ceil(net.height / usableH));

  const tiles = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * usableW;
      const y = row * usableH;
      tiles.push({
        row,
        col,
        index: row * cols + col + 1,
        total: rows * cols,
        // 这一块覆盖的展开图区域（毫米）
        x,
        y,
        w: Math.min(usableW, net.width - x),
        h: Math.min(usableH, net.height - y),
        // 纸面落点
        px: TILE_MARGIN_MM,
        py: TILE_MARGIN_MM,
        hasLeft: col > 0,
        hasRight: col < cols - 1,
        hasTop: row > 0,
        hasBottom: row < rows - 1,
        rows,
        cols,
      });
    }
  }

  return {
    paper: paper.id,
    paperName: paper.name,
    pageWidth: page.w,
    pageHeight: page.h,
    usableW,
    usableH,
    margin: TILE_MARGIN_MM,
    rows,
    cols,
    tiles,
  };
}

/**
 * @param {{width:number,height:number}} net
 * @returns {{width:number,height:number,scale:number,scaled:boolean,limit:number}}
 */
export function computePageSize(net) {
  const longest = Math.max(net.width, net.height);
  const scale = longest > PDF_MAX_MM ? PDF_MAX_MM / longest : 1;
  return {
    width: net.width * scale,
    height: net.height * scale,
    scale,
    scaled: scale < 1,
    limit: PDF_MAX_MM,
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

/**
 * 生成页计划。
 * - sheet：一页，画所有有内容的面
 * - panel：每个有内容的面一页，只画该面的元素
 */
export function collectPages({ net, panels, mode = 'sheet' }) {
  const keys = Object.keys(panels).filter((k) => panels[k] && Array.isArray(panels[k].elements));
  const withContent = keys.filter((k) => panels[k].elements.length > 0);

  if (mode === 'panel') {
    return withContent.map((key) => ({
      panelKey: key,
      label: panels[key].label,
      elements: absoluteElements(net, panels, key),
    }));
  }

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

/** 文件名/元信息里的尺寸串：RSC 是 L×W×H，有高差的箱型带上前后高度 */
export function dimsTag(dims) {
  const r = (v) => Math.round(Number(v));
  if (dims.Hfront != null) {
    const W = dims.W ?? Number(dims.Wfront) + Number(dims.Wback);
    return `${r(dims.L)}x${r(W)}x${r(dims.Hfront)}-${r(dims.Hback)}`;
  }
  return `${r(dims.L)}x${r(dims.W)}x${r(dims.H)}`;
}

/**
 * 文件名：cartonmark_600x400x300_20261101.pdf
 * 多件套（天地盖）传 tag，把两件的高度都带上：
 *   cartonmark_tiandi_600x400_300-290_20261101.pdf
 */
export function exportFileName(dims, now = new Date(), tag = '') {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const body = tag ? `${tag}` : dimsTag(dims);
  return `cartonmark_${body}_${stamp}.pdf`;
}

/** 汇总导出前的信息，供弹层展示 */
export function summarize({ net, panels, mode = 'sheet', tilePaper = 'a3' }) {
  const tilePlan = mode === 'tile' ? planTiles(net, tilePaper) : null;
  const page = tilePlan ? { width: tilePlan.pageWidth, height: tilePlan.pageHeight } : computePageSize(net);
  const pages = mode === 'tile' ? [] : collectPages({ net, panels, mode });
  const keys = Object.keys(panels);
  const usedPanels = keys.filter((k) => panels[k].elements.length);
  const elementCount = keys.reduce((n, k) => n + panels[k].elements.length, 0);
  const imageCount = keys.reduce(
    (n, k) => n + panels[k].elements.filter((e) => e.type === 'image').length,
    0,
  );
  return {
    pageSize: page,
    pages: tilePlan ? tilePlan.tiles.length : pages.length,
    tilePlan,
    usedPanels: usedPanels.length,
    elementCount,
    imageCount,
  };
}
