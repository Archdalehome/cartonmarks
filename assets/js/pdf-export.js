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

import { normalizeRotation, rotatePoint, contentOrigin } from './elements.js';
import {
  computeA4Page,
  computePageSize,
  collectPages,
  collectLines,
  imageDpi,
  exportFileName,
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

/** 线条 = 实心矩形，按元素颜色填充；旋转时把四个角转过去再画多边形 */
function drawLine(doc, element, dx, dy, scale) {
  const [r, g, b] = hexToRgb(element.color);
  doc.setFillColor(r, g, b);
  doc.setDrawColor(r, g, b);

  const rot = normalizeRotation(element.rotation);
  const box = contentOrigin(element, 0, 0); // 毫米，左上角相对外接框
  const left = dx + box.x * scale;
  const top = dy + box.y * scale;
  const w = box.w * scale;
  const h = box.h * scale;

  if (!rot) {
    doc.rect(left, top, w, h, 'F');
    return;
  }

  const cx = dx + (element.w * scale) / 2;
  const cy = dy + (element.h * scale) / 2;
  const corners = [
    [left, top],
    [left + w, top],
    [left + w, top + h],
    [left, top + h],
  ].map(([x, y]) => rotatePoint(x, y, cx, cy, rot));

  doc.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i += 1) doc.lineTo(corners[i].x, corners[i].y);
  doc.fill();
}

function imageFormat(src) {
  if (/^data:image\/png/i.test(src)) return 'PNG';
  if (/^data:image\/jpe?g/i.test(src)) return 'JPEG';
  return 'PNG';
}

/**
 * 图片旋转：把位图按 90/180/270 预转（像素置换，不损失质量），
 * 再按元素外接框贴进 PDF —— 比依赖 jsPDF 的旋转参数可靠。
 */
async function rotatedImageSrc(src, rot) {
  if (!rot) return src;
  const img = await new Promise((resolve, reject) => {
    const node = new Image();
    node.onload = () => resolve(node);
    node.onerror = () => reject(new Error('图片解码失败'));
    node.src = src;
  });
  const swap = rot % 180 === 90;
  const w = swap ? img.naturalHeight : img.naturalWidth;
  const h = swap ? img.naturalWidth : img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return canvas.toDataURL('image/png');
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

/**
 * 把字形路径写进 PDF。tf 是可选的点变换（旋转用）：所有坐标先过它再落笔，
 * 这样转 90/180/270 时是「路径真的转了」，不是靠 jsPDF 的文字角度。
 */
function pathToDoc(doc, path, tf = null) {
  const T = (x, y) => (tf ? tf(x, y) : { x, y });
  let cx = 0;
  let cy = 0;
  for (const cmd of path.commands) {
    if (cmd.type === 'M') {
      const p = T(cmd.x, cmd.y);
      doc.moveTo(p.x, p.y);
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'L') {
      const p = T(cmd.x, cmd.y);
      doc.lineTo(p.x, p.y);
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'C') {
      const p1 = T(cmd.x1, cmd.y1);
      const p2 = T(cmd.x2, cmd.y2);
      const p = T(cmd.x, cmd.y);
      doc.curveTo(p1.x, p1.y, p2.x, p2.y, p.x, p.y);
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'Q') {
      // 二次贝塞尔转三次
      const c1x = cx + (2 / 3) * (cmd.x1 - cx);
      const c1y = cy + (2 / 3) * (cmd.y1 - cy);
      const c2x = cmd.x + (2 / 3) * (cmd.x1 - cmd.x);
      const c2y = cmd.y + (2 / 3) * (cmd.y1 - cmd.y);
      const p1 = T(c1x, c1y);
      const p2 = T(c2x, c2y);
      const p = T(cmd.x, cmd.y);
      doc.curveTo(p1.x, p1.y, p2.x, p2.y, p.x, p.y);
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'Z') {
      // PDF 的 fill 会自动闭合子路径，这里不用显式 close
    }
  }
}

function drawText(doc, font, element, dx, dy, scale) {
  const rot = normalizeRotation(element.rotation);
  // 内容框在屏幕外接框里居中；旋转 90/270 时内容框的宽高与 w/h 互换
  const box = contentOrigin(element, 0, 0);
  const boxW = box.w * scale;
  const left = dx + box.x * scale;
  const top = dy + box.y * scale;
  const centerX = dx + (element.w * scale) / 2;
  const centerY = dy + (element.h * scale) / 2;
  const tf = rot ? (px, py) => rotatePoint(px, py, centerX, centerY, rot) : null;

  const size = Math.max(1, element.fontSize) * scale;
  const lines = wrapText(font, element.text, size, boxW);
  const ascent = font.ascender / font.unitsPerEm;
  const descent = -font.descender / font.unitsPerEm;
  const lead = (LINE_HEIGHT - (ascent + descent)) / 2 + ascent;

  doc.setFillColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);

  lines.forEach((line, index) => {
    if (!line) return;
    const width = font.getAdvanceWidth(line, size);
    let x = left;
    if (element.align === 'center') x = left + (boxW - width) / 2;
    else if (element.align === 'right') x = left + boxW - width;

    const baseline = top + (lead + index * LINE_HEIGHT) * size;
    const path = font.getPath(line, x, baseline, size);

    pathToDoc(doc, path, tf);
    doc.fill();

    if (element.bold) {
      doc.setLineWidth(Math.max(0.05, size * 0.03));
      doc.setLineJoin(1);
      pathToDoc(doc, font.getPath(line, x, baseline, size), tf);
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
 * 导出 PDF：整张展开图一页，页面 = 展开图 × 1.1（四周各留 5%），图形 1:1 居中。
 * 天地盖这类两件套传 sheets，每件各出一页。
 *
 * @param {object} opts
 * @param {object} opts.net       computeNet 结果（毫米）
 * @param {object} opts.panels    state.panels（可编辑面内容）
 * @param {{L:number,W:number,H:number}} opts.dims
 * @param {{net:object,panels:object,label:string}[]} [opts.sheets] 多件套各页
 * @param {string} [opts.fileName]
 * @param {boolean} [opts.download]
 * @param {boolean} [opts.compress]
 */
export async function exportPdf({ net, panels, dims, fileName, download = true, compress = true, sheets = null, layout = 'a4' }) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF 未加载');
  const { jsPDF } = window.jspdf;

  // 单件箱型 = 一页；天地盖这类两件套 = 每件一页，按顺序拼进同一个 PDF
  const jobs = (Array.isArray(sheets) && sheets.length ? sheets : [{ net, panels, label: '' }]).map((s) => ({
    net: s.net,
    panels: s.panels || {},
    label: s.label || '',
  }));

  const elementCount = jobs.reduce(
    (n, job) => n + Object.values(job.panels).reduce((m, p) => m + ((p.elements && p.elements.length) || 0), 0),
    0,
  );
  if (!elementCount) throw new Error('还没有任何箱唛内容，先加一点文字或图片');

  const font = await loadFont();
  const warnings = [];
  const lowDpi = [];
  const name = fileName || exportFileName(dims);

  let doc = null;
  let pageCount = 0;
  let firstPage = null;
  let firstNet = null;
  const pageSizes = [];

  for (const job of jobs) {
    // 默认 A4 横向等比缩放；layout: 'exact' 是保留的精确 1:1 打印路径（含 5% 留白）
    const page = layout === 'exact' ? computePageSize(job.net) : computeA4Page(job.net);
    const orientation = page.width >= page.height ? 'landscape' : 'portrait';
    const pages = collectPages({ net: job.net, panels: job.panels });
    const lines = collectLines(job.net);
    const who = job.label ? `${job.label}：` : '';

    if (page.scaled) {
      warnings.push(
        `${who}展开图 ${Math.round(job.net.width)} × ${Math.round(job.net.height)} mm 加 5% 留白后超过 PDF 单页上限 ${page.limit} mm，已等比缩到 ${(page.scale * 100).toFixed(1)}%，打印时请按同比例放大`,
      );
    }

    if (!doc) {
      doc = new jsPDF({
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
        subject: `Unfolded net ${Math.round(job.net.width)}x${Math.round(job.net.height)} mm at 1:1`,
        creator: 'Carton Mark',
        author: 'Carton Mark',
        keywords: `carton mark, ${dimsTag(dims)} mm, 1:1, ${Math.round(job.net.width)}x${Math.round(job.net.height)} mm`,
      });
      firstPage = page;
      firstNet = job.net;
      pageCount = 1;
    } else {
      doc.addPage([page.width, page.height], orientation);
      pageCount += 1;
    }
    pageSizes.push({ label: job.label, width: page.width, height: page.height, pages: 1 });

    // 图形按 page.scale 画，落在 page.offsetX/offsetY（A4：可用区居中；exact：1:1 居中带 5% 留白）
    const drawScale = page.scale;
    const drawDx = page.offsetX;
    const drawDy = page.offsetY;

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
            // 有旋转就先把位图转好再贴，落在元素外接框里
            const rot = normalizeRotation(element.rotation);
            const src = await rotatedImageSrc(element.src, rot);
            doc.addImage(src, imageFormat(src), dx, dy, element.w * drawScale, element.h * drawScale);
          } catch (err) {
            console.warn('图片解码失败，导出时跳过', err);
            warnings.push('有一张图片解码失败，已跳过');
          }
        }
      }
    }

    // 每件只有一页：这一件没内容也要出页（打印店按页数对位），只画轮廓
    await drawScene(pages[0].elements);
    if (job.label) drawSheetNote(doc, font, job);
  }

  if (lowDpi.length) {
    warnings.push(`以下图片分辨率低于 ${MIN_DPI} dpi，印刷可能发虚：${lowDpi.join('；')}`);
  }

  const blob = doc.output('blob');
  if (download) downloadBlob(blob, name);

  return {
    blob,
    fileName: name,
    pageCount,
    pageSize: { width: firstPage.width, height: firstPage.height },
    net: firstNet,
    scale: firstPage.scale,
    pageSizes,
    warnings,
  };
}

/**
 * 整页模式下标清这是哪一件（天盖 / 地盖）。
 * 画在页面左上角：十字展开图这个角落是空的，落在裁切线外面，不会印到纸箱上。
 */
function drawSheetNote(doc, font, job) {
  const text = `${job.label} · 展开 ${Math.round(job.net.width)} × ${Math.round(job.net.height)} mm · 1:1 · Carton Mark`;
  const size = 4;
  drawText(doc, font, { text, w: 300, h: size * 2, fontSize: size, align: 'left', bold: false }, 4, 4, 1);
}