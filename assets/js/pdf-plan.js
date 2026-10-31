/**
 * pdf-plan.js —— PDF 导出的纯计算（不含 jsPDF / DOM，方便离线断言）
 *
 * 页面尺寸 = 展开图真实毫米 (2L + 2W) × (H + W)，1:1。
 * PDF 1.7 单页上限 14400 pt ≈ 5080 mm，超出的箱子只能等比缩到上限并提示。
 */

export const PDF_MAX_MM = 5080;
export const MIN_DPI = 150;

export const EXPORT_MODES = {
  sheet: '整张展开图（一页）',
  panel: '每个有内容的面各一页',
};

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

export function exportFileName(dims, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `cartonmark_${Math.round(dims.L)}x${Math.round(dims.W)}x${Math.round(dims.H)}_${stamp}.pdf`;
}

/** 汇总导出前的信息，供弹层展示 */
export function summarize({ net, panels, mode = 'sheet' }) {
  const page = computePageSize(net);
  const pages = collectPages({ net, panels, mode });
  const keys = Object.keys(panels);
  const usedPanels = keys.filter((k) => panels[k].elements.length);
  const elementCount = keys.reduce((n, k) => n + panels[k].elements.length, 0);
  const imageCount = keys.reduce(
    (n, k) => n + panels[k].elements.filter((e) => e.type === 'image').length,
    0,
  );
  return {
    pageSize: page,
    pages: pages.length,
    usedPanels: usedPanels.length,
    elementCount,
    imageCount,
  };
}
