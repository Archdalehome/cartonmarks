/**
 * pdf-export.js —— 生成 1:1 箱唛 PDF
 *
 * 依赖（全部本地化在 vendor/）：
 *   jspdf.umd.min.js  —— 页面与线段、图片嵌入
 *   opentype.min.js   —— 解析中文字体，把文字转成矢量路径
 *   fonts/carton-sans.ttf —— Noto Sans SC 子集（GB2312 + ASCII + 常用符号）
 *
 * 只有矢量的文字路径、图片、裁切/折叠线；尺寸线、辅助线、选中框一律不导出。
 */

import {
  computePageSize,
  collectPages,
  collectLines,
  imageDpi,
  exportFileName,
  planTiles,
  MIN_DPI,
  dimsTag,
} from './pdf-plan.js';

const LINE_HEIGHT = 1.22;
const CUT_WIDTH_MM = 0.3;
const FOLD_WIDTH_MM = 0.2;

let fontPromise = null;
const imageCache = new Map();

/* ── 字体 ───────────────────────────────────────── */

export function loadFont() {
  if (!fontPromise) {
    fontPromise = fetch('vendor/fonts/carton-sans.ttf')
      .then((res) => {
        if (!res.ok) throw new Error(`字体加载失败（HTTP ${res.status}）`);
        return res.arrayBuffer();
      })
      .then((buffer) => {
        if (!window.opentype) throw new Error('opentype.js 未加载');
        return window.opentype.parse(buffer);
      })
      .catch((err) => {
        fontPromise = null;
        throw err;
      });
  }
  return fontPromise;
}

/* ── 图片 ───────────────────────────────────────── */

function measureImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '#000000'));
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 线条 = 实心矩形，按元素颜色填充 */
function drawLine(doc, element, dx, dy, scale) {
  const [r, g, b] = hexToRgb(element.color);
  doc.setFillColor(r, g, b);
  doc.setDrawColor(r, g, b);
  doc.rect(dx, dy, element.w * scale, element.h * scale, 'F');
}

function imageFormat(src) {
  if (/^data:image\/png/i.test(src)) return 'PNG';
  if (/^data:image\/jpe?g/i.test(src)) return 'JPEG';
  return 'PNG';
}

/* ── 文字 ───────────────────────────────────────── */

/**
 * 按元素宽度贪心折行；优先在空格处断，中日韩字符逐字断。
 */
export function wrapText(font, text, size, maxWidth) {
  const paragraphs = String(text ?? '').split('\n');
  const lines = [];

  for (const para of paragraphs) {
    if (para === '') {
      lines.push('');
      continue;
    }
    let line = '';
    let lastSpace = -1;

    for (const ch of para) {
      const test = line + ch;
      if (line && font.getAdvanceWidth(test, size) > maxWidth) {
        if (/[A-Za-z0-9]/.test(ch) && lastSpace > 0) {
          lines.push(line.slice(0, lastSpace));
          line = line.slice(lastSpace + 1) + ch;
          lastSpace = line.lastIndexOf(' ');
          continue;
        }
        lines.push(line);
        line = ch;
        lastSpace = -1;
      } else {
        line = test;
        if (ch === ' ') lastSpace = line.length - 1;
      }
    }
    lines.push(line);
  }
  return lines;
}

function pathToDoc(doc, path) {
  let cx = 0;
  let cy = 0;
  for (const cmd of path.commands) {
    if (cmd.type === 'M') {
      doc.moveTo(cmd.x, cmd.y);
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'L') {
      doc.lineTo(cmd.x, cmd.y);
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'C') {
      doc.curveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'Q') {
      // 二次贝塞尔转三次
      const c1x = cx + (2 / 3) * (cmd.x1 - cx);
      const c1y = cy + (2 / 3) * (cmd.y1 - cy);
      const c2x = cmd.x + (2 / 3) * (cmd.x1 - cmd.x);
      const c2y = cmd.y + (2 / 3) * (cmd.y1 - cmd.y);
      doc.curveTo(c1x, c1y, c2x, c2y, cmd.x, cmd.y);
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'Z') {
      // PDF 的 fill 会自动闭合子路径，这里不用显式 close
    }
  }
}

function drawText(doc, font, element, dx, dy, scale) {
  const size = Math.max(1, element.fontSize) * scale;
  const lines = wrapText(font, element.text, size, element.w * scale);
  const ascent = font.ascender / font.unitsPerEm;
  const descent = -font.descender / font.unitsPerEm;
  const lead = (LINE_HEIGHT - (ascent + descent)) / 2 + ascent;

  doc.setFillColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);

  lines.forEach((line, index) => {
    if (!line) return;
    const width = font.getAdvanceWidth(line, size);
    let x = dx;
    if (element.align === 'center') x = dx + (element.w * scale - width) / 2;
    else if (element.align === 'right') x = dx + element.w * scale - width;

    const baseline = dy + (lead + index * LINE_HEIGHT) * size;
    const path = font.getPath(line, x, baseline, size);

    pathToDoc(doc, path);
    doc.fill();

    if (element.bold) {
      doc.setLineWidth(Math.max(0.05, size * 0.03));
      doc.setLineJoin(1);
      pathToDoc(doc, font.getPath(line, x, baseline, size));
      doc.stroke();
    }
  });
}

/* ── 线 ─────────────────────────────────────────── */

function strokeOutline(doc, outline, cuts, scale, dx = 0, dy = 0) {
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(CUT_WIDTH_MM);
  doc.setLineDashPattern([], 0);

  const pts = outline.map(([x, y]) => [x * scale + dx, y * scale + dy]);
  doc.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i += 1) doc.lineTo(pts[i][0], pts[i][1]);
  doc.lineTo(pts[0][0], pts[0][1]);
  doc.stroke();

  // 开槽（切断线）
  if (doc.setLineDashPattern) doc.setLineDashPattern([], 0);
  for (const cut of cuts) {
    doc.moveTo(cut.x1 * scale + dx, cut.y1 * scale + dy);
    doc.lineTo(cut.x2 * scale + dx, cut.y2 * scale + dy);
  }
  doc.stroke();
}

function strokeFolds(doc, folds, scale, dx = 0, dy = 0) {
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(FOLD_WIDTH_MM);
  if (doc.setLineDashPattern) doc.setLineDashPattern([2, 1.5], 0);
  for (const f of folds) {
    doc.moveTo(f.x1 * scale + dx, f.y1 * scale + dy);
    doc.lineTo(f.x2 * scale + dx, f.y2 * scale + dy);
  }
  doc.stroke();
  if (doc.setLineDashPattern) doc.setLineDashPattern([], 0);
}

/* ── 导出 ───────────────────────────────────────── */

/** 导出前预览：列出所有图片的实际像素与有效 dpi */
export async function imageReport(net, panels) {
  const rows = [];
  for (const key of Object.keys(panels)) {
    for (const element of panels[key].elements) {
      if (element.type !== 'image' || !element.src) continue;
      try {
        const info = await measureImage(element.src);
        rows.push({
          panelKey: key,
          panelLabel: panels[key].label,
          width: element.w,
          height: element.h,
          px: info.width,
          dpi: imageDpi(element, info.width),
        });
      } catch (err) {
        console.warn('图片尺寸读不出来，按 0 dpi 记录', err);
        rows.push({ panelKey: key, panelLabel: panels[key].label, width: element.w, height: element.h, px: 0, dpi: 0, error: true });
      }
    }
  }
  return rows;
}

function downloadBlob(blob, fileName) {  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * @param {object} opts
 * @param {object} opts.net       computeNet 结果（毫米）
 * @param {object} opts.panels    state.panels（可编辑面内容）
 * @param {{L:number,W:number,H:number}} opts.dims
 * @param {'sheet'|'panel'|'tile'} [opts.mode]
 * @param {'a3'|'a4'} [opts.tilePaper] 拼版纸张
 * @param {string} [opts.fileName]
 * @param {boolean} [opts.download]
 * @param {boolean} [opts.compress]
 */
export async function exportPdf({ net, panels, dims, mode = 'sheet', tilePaper = 'a3', fileName, download = true, compress = true }) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF 未加载');
  const { jsPDF } = window.jspdf;

  const tilePlan = mode === 'tile' ? planTiles(net, tilePaper) : null;
  const page = tilePlan
    ? { width: tilePlan.pageWidth, height: tilePlan.pageHeight, scale: 1, scaled: false }
    : computePageSize(net);
  const pages = tilePlan ? [] : collectPages({ net, panels, mode });

  const hasContent = Object.values(panels).some((p) => p.elements && p.elements.length);
  if (!hasContent) throw new Error('还没有任何箱唛内容，先加一点文字或图片');

  const font = await loadFont();
  const lines = collectLines(net);
  const warnings = [];

  if (page.scaled) {
    warnings.push(
      `展开图 ${Math.round(net.width)} × ${Math.round(net.height)} mm 超过 PDF 单页上限 ${page.limit} mm，已等比缩到 ${(page.scale * 100).toFixed(1)}%，打印时请按同比例放大`,
    );
  }
  if (tilePlan && tilePlan.tiles.length > 36) {
    warnings.push(`拼版共 ${tilePlan.tiles.length} 块，拼接会比较费工，确认尺寸是否输入过大`);
  }

  const orientation = page.width >= page.height ? 'landscape' : 'portrait';
  const doc = new jsPDF({
    unit: 'mm',
    format: [page.width, page.height],
    orientation,
    compress,
    putOnlyUsedFonts: true,
  });

  const pdfW = doc.internal.pageSize.getWidth();
  const pdfH = doc.internal.pageSize.getHeight();
  if (Math.abs(pdfW - page.width) > 0.5 || Math.abs(pdfH - page.height) > 0.5) {
    warnings.push(`页面尺寸校正：期望 ${page.width} × ${page.height} mm，实际 ${pdfW} × ${pdfH} mm`);
  }

  // 元信息用 ASCII，避免部分阅读器把中文元数据弄乱
  doc.setProperties({
    title: `Carton Mark artwork ${dimsTag(dims)} mm`,
    subject: `Unfolded net ${Math.round(net.width)}x${Math.round(net.height)} mm at 1:1`,
    creator: 'Carton Mark',
    author: 'Carton Mark',
    keywords: `carton mark, ${dimsTag(dims)} mm, 1:1, ${Math.round(net.width)}x${Math.round(net.height)} mm`,
  });

  const lowDpi = [];
  const name = fileName || exportFileName(dims);
  const allElements = collectPages({ net, panels, mode: 'sheet' })[0].elements;

  let drawScale = page.scale;
  let drawDx = 0;
  let drawDy = 0;

  async function drawScene(elements) {
    strokeOutline(doc, lines.outline, lines.cuts, drawScale, drawDx, drawDy);
    strokeFolds(doc, lines.folds, drawScale, drawDx, drawDy);

    for (const element of elements) {
      const dx = element.ax * drawScale + drawDx;
      const dy = element.ay * drawScale + drawDy;
      if (element.type === 'text') {
        drawText(doc, font, element, dx, dy, drawScale);
      } else if (element.type === 'line') {
        drawLine(doc, element, dx, dy, drawScale);
      } else if (element.type === 'image' && element.src) {
        try {
          const info = await measureImage(element.src);
          const dpi = imageDpi({ w: element.w }, info.width);
          if (dpi < MIN_DPI) {
            lowDpi.push(`${Math.round(dpi)} dpi（${Math.round(element.w)} × ${Math.round(element.h)} mm）`);
          }
          doc.addImage(element.src, imageFormat(element.src), dx, dy, element.w * drawScale, element.h * drawScale);
        } catch (err) {
          console.warn('图片解码失败，导出时跳过', err);
          warnings.push('有一张图片解码失败，已跳过');
        }
      }
    }
  }

  if (tilePlan) {
    for (const tile of tilePlan.tiles) {
      if (tile.index > 1) doc.addPage([page.width, page.height], orientation);

      doc.saveGraphicsState();
      doc.rect(tile.px, tile.py, tile.w, tile.h);
      doc.clip();
      doc.discardPath();

      drawScale = 1;
      drawDx = -tile.x + tile.px;
      drawDy = -tile.y + tile.py;
      await drawScene(allElements);

      doc.restoreGraphicsState();
      drawCropMarks(doc, tile);
      drawTileLabels(doc, font, tile, tilePlan);
    }
  } else {
    for (let i = 0; i < pages.length; i += 1) {
      if (i > 0) doc.addPage([page.width, page.height], orientation);
      drawScale = page.scale;
      drawDx = 0;
      drawDy = 0;
      await drawScene(pages[i].elements);
    }
  }

  if (lowDpi.length) {
    warnings.push(`以下图片分辨率低于 ${MIN_DPI} dpi，印刷可能发虚：${lowDpi.join('；')}`);
  }

  const blob = doc.output('blob');
  if (download) downloadBlob(blob, name);

  return {
    blob,
    fileName: name,
    pageCount: tilePlan ? tilePlan.tiles.length : pages.length,
    pageSize: { width: page.width, height: page.height },
    scale: page.scale,
    tilePlan,
    warnings,
  };
}

/** 拼版：裁切角标（画在留白里，拼接后按角标裁切/对齐） */
function drawCropMarks(doc, tile) {
  const len = 4;
  const x0 = tile.px;
  const y0 = tile.py;
  const x1 = tile.px + tile.w;
  const y1 = tile.py + tile.h;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([], 0);
  const segs = [
    [x0 - len, y0, x0 - 1, y0],
    [x0, y0 - len, x0, y0 - 1],
    [x1 + 1, y0, x1 + len, y0],
    [x1, y0 - len, x1, y0 - 1],
    [x0 - len, y1, x0 - 1, y1],
    [x0, y1 + 1, x0, y1 + len],
    [x1 + 1, y1, x1 + len, y1],
    [x1, y1 + 1, x1, y1 + len],
  ];
  for (const [ax, ay, bx, by] of segs) {
    doc.moveTo(ax, ay);
    doc.lineTo(bx, by);
  }
  doc.stroke();
}

/** 拼版：块号、「接哪边」、100% 打印提示 */
function drawTileLabels(doc, font, tile, plan) {
  const m = plan.margin;
  const size = 2.6;
  const top = `第 ${tile.index}/${tile.total} 块 · 第 ${tile.row + 1} 行 第 ${tile.col + 1} 列`;
  const edges = [
    tile.hasLeft ? '左' : '',
    tile.hasRight ? '右' : '',
    tile.hasTop ? '上' : '',
    tile.hasBottom ? '下' : '',
  ].filter(Boolean).join('/');
  const bottom = `接边：${edges || '无'} · 按 100% 实际大小打印 · Carton Mark`;

  drawText(doc, font, { text: top, w: 400, h: size * 2, fontSize: size, align: 'left', bold: false }, tile.px, m - size * 1.9, 1);
  drawText(doc, font, { text: bottom, w: 500, h: size * 2, fontSize: size, align: 'left', bold: false }, tile.px, tile.py + tile.h + 0.8, 1);
}