/**
 * metrics.js —— 轮廓图下方的三个固定口径指标
 *
 * 单位固定、不跟顶部单位切换走：
 *  - 最大体积：外接长方体的体积，CBM（立方米），2 位小数
 *  - 实际体积：按真实立体算，CBM，2 位小数
 *  - 周长：（最小边 + 次长边）× 2 + 最长边，固定用英寸，2 位小数
 *
 * 内部一律先按毫米算，最后才换算成 CBM / 英寸；尺寸非法时返回 null，由界面显示「—」。
 */

const MM3_PER_CBM = 1e9; // 1 m³ = 1e9 mm³
const MM_PER_INCH = 25.4;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** 四舍五入到 2 位（避免 0.08550000001 这类尾数） */
export function round2(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

/** 展示用：固定 2 位，null 显示「—」 */
export function fmt2(v) {
  return v == null ? '—' : round2(v).toFixed(2);
}

/**
 * @param {{L?:number,W?:number,H?:number,Hfront?:number,Hback?:number,Wfront?:number,Wback?:number}} dims
 * @param {'rsc'|'lshape'|'bevel'} shape
 * @returns {{maxCbm:number|null, realCbm:number|null, perimeterIn:number|null, sides:{L:number,W:number,H:number}|null}}
 */
export function computeMetrics(dims, shape = 'rsc') {
  const L = num(dims && dims.L);

  // 三边（非矩形箱的 H 用 H(后)，W 用 W(前)+W(后)）
  let W;
  let H;
  if (shape === 'lshape') {
    W = num(Number(dims.Wfront) + Number(dims.Wback));
    H = num(dims.Hback);
  } else if (shape === 'bevel') {
    W = num(dims.W);
    H = num(dims.Hback);
  } else {
    W = num(dims.W);
    H = num(dims.H);
  }

  if (!L || !W || !H) {
    return { maxCbm: null, realCbm: null, perimeterIn: null, sides: null };
  }

  const Hf = num(dims.Hfront);
  const Hb = num(dims.Hback);
  const Hmax = shape === 'rsc' ? H : Math.max(Hf || 0, Hb || 0) || H;

  const maxCbm = round2((L * W * Hmax) / MM3_PER_CBM);

  let realMm3 = null;
  if (shape === 'rsc') {
    realMm3 = L * W * H;
  } else if (shape === 'bevel') {
    // 梯形棱柱：截面积 = W × (H前 + H后) / 2
    realMm3 = (L * W * (Hf + Hb)) / 2;
  } else {
    // L 形：两级台阶，按深度分段乘各自高度
    const wf = num(dims.Wfront);
    const wb = num(dims.Wback);
    realMm3 = L * (wf * Hf + wb * Hb);
  }
  const realCbm = realMm3 == null ? null : round2(realMm3 / MM3_PER_CBM);

  // 周长：三条边各自换算成英寸并向上取整，再（最小 + 次长）× 2 + 最长 → 结果一定是整数英寸
  const toInchCeil = (mm) => Math.ceil(mm / MM_PER_INCH);
  const [s1, s2, s3] = [L, W, H].sort((a, b) => a - b).map(toInchCeil);
  const perimeterIn = (s1 + s2) * 2 + s3;

  return {
    maxCbm,
    realCbm,
    perimeterIn,
    sides: { L, W, H },
  };
}
