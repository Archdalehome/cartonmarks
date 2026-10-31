/**
 * closure-check.mjs —— 箱型闭合测试（M8）
 *
 * 验收标准（Chief 2026-10-31 定）：把展开图按折线折起来，顶面、底面两个开口
 * 必须被摇盖/面板的投影完全盖住 —— 不重叠、不留缝。
 *
 * 算法不靠目测：
 *  1. 只按箱子尺寸推出顶面的三维剖面路径（前上沿 → 后上沿），写成若干段
 *     { 展开长度, 前进的深度增量 }：
 *        斜形箱：一段，长 √(W²+ΔH²)，前进 W
 *        L 形箱：三段，W(前) 走 W(前)；竖壁 |ΔH| 深度不前进；W(后) 走 W(后)
 *  2. 顶上必须是**一整片**单摇盖：从前面板往上找，只能找到一片，长度必须
 *     等于整条路径的长度
 *  3. 这一片内部的折线位置，必须正好落在各段的分界处（距根部 = 前几段长度之和）
 *  4. 底面：两片主摇盖长度之和 = W，另有两片侧面防尘摇盖；顶部不许再有防尘摇盖
 *
 * 这样「两片各 W/2 的顶盖」（合计 W，够不到斜面/台阶）会当场被判不合格。
 */

/** 顶面剖面：从前面板顶边走到后面板顶边 */
export function topProfile(shape, dims) {
  const Hf = Number(dims.Hfront ?? dims.H);
  const Hb = Number(dims.Hback ?? dims.H);
  if (shape === 'bevel') {
    const W = Number(dims.W);
    return [{ len: Math.hypot(W, Hb - Hf), depth: W }];
  }
  if (shape === 'lshape') {
    const Wf = Number(dims.Wfront);
    const Wb = Number(dims.Wback);
    return [
      { len: Wf, depth: Wf },
      { len: Math.abs(Hb - Hf), depth: 0 },
      { len: Wb, depth: Wb },
    ];
  }
  throw new Error(`闭合测试暂不支持箱型：${shape}`);
}

export function boxDepth(shape, dims) {
  return shape === 'lshape'
    ? Number(dims.Wfront) + Number(dims.Wback)
    : Number(dims.W);
}

const EPS = 0.01;

const overlapX = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-9;

/** 贴在某个箱身面上边缘（y 更小）往上的摇盖 */
export function lidAbove(net, key = 'front') {
  const body = net.panels[key];
  if (!body) return [];
  return Object.entries(net.panels).filter(
    ([k, p]) =>
      k !== key &&
      p.editable &&
      Math.abs(p.y + p.h - body.y) < 1e-6 &&
      overlapX(p, body),
  );
}

/** 贴在箱身面下边缘的摇盖 */
function lidsBelow(net, key) {
  if (!net.panels[key]) return [];
  const start = net.panels[key];
  return Object.entries(net.panels).filter(
    ([k, p]) =>
      k !== key &&
      p.editable &&
      Math.abs(p.y - (start.y + start.h)) < 1e-6 &&
      overlapX(p, start),
  );
}

/** 顶盖内部的水平折线，距根部（下边）的距离 */
export function innerFolds(net, lid) {
  const root = lid.y + lid.h;
  return (net.folds || [])
    .filter(
      (f) =>
        Math.abs(f.y1 - f.y2) < 1e-9 &&
        f.y1 > lid.y + 1e-9 &&
        f.y1 < root - 1e-9 &&
        Math.min(f.x1, f.x2) >= lid.x - 1e-9 &&
        Math.max(f.x1, f.x2) <= lid.x + lid.w + 1e-9,
    )
    .map((f) => root - f.y1)
    .sort((a, b) => a - b);
}

/**
 * @returns {{ok:boolean, errors:string[], top:{len:number, profileLen:number, folds:number[], wantFolds:number[]}, bottom:{sum:number, want:number, dust:number}}}
 */
export function checkClosure(net, shape, dims) {
  const errors = [];
  const profile = topProfile(shape, dims);
  const profileLen = profile.reduce((a, p) => a + p.len, 0);
  const W = boxDepth(shape, dims);

  const frontLids = lidAbove(net, 'front');
  const backLids = lidAbove(net, 'back');
  const result = {
    ok: false,
    errors,
    top: { len: 0, profileLen, folds: [], wantFolds: [], pieces: frontLids.length + backLids.length },
    bottom: { sum: 0, want: W, dust: 0 },
  };

  if (shape === 'bevel') {
    // 斜形箱：前后各一片对开摇盖，两片合计 = 斜面实长
    if (frontLids.length !== 1 || backLids.length !== 1) {
      errors.push(
        `斜形箱顶部应是两片对开摇盖（前后各一），实际 ${frontLids.length} + ${backLids.length} 片`,
      );
      return result;
    }
    const sum = frontLids[0][1].h + backLids[0][1].h;
    result.top.len = sum;
    if (Math.abs(sum - profileLen) > EPS) {
      errors.push(
        `两片顶摇盖合计 ${sum.toFixed(2)} ≠ 斜面实长 ${profileLen.toFixed(2)}（盖不满或盖过头）`,
      );
    }
    for (const [k, p] of [...frontLids, ...backLids]) {
      if (Math.abs(p.h - profileLen / 2) > EPS) {
        errors.push(`顶摇盖 ${k} 深 ${p.h.toFixed(2)} ≠ 斜长一半 ${(profileLen / 2).toFixed(2)}`);
      }
      if (Math.abs(p.w - Number(dims.L)) > EPS) {
        errors.push(`顶摇盖 ${k} 宽 ${p.w.toFixed(2)} ≠ L ${Number(dims.L).toFixed(2)}`);
      }
    }
  } else {
    if (frontLids.length !== 1 || backLids.length !== 0) {
      errors.push(
        `L 形箱顶部应是 1 片整摇盖，实际 ${frontLids.length} + ${backLids.length} 片`,
      );
      return result;
    }
  }

  if (shape !== 'bevel') {
    const lids = frontLids;
    const lid = lids[0][1];
    result.top.len = lid.h;
    if (Math.abs(lid.h - profileLen) > EPS) {
      errors.push(
        `顶盖展开长度 ${lid.h.toFixed(2)} ≠ 剖面实长 ${profileLen.toFixed(2)}（盖不满或盖过头）`,
      );
    }
  if (Math.abs(lid.w - Number(dims.L)) > EPS) {
    errors.push(`顶盖宽度 ${lid.w.toFixed(2)} ≠ L ${Number(dims.L).toFixed(2)}`);
  }

  // 片内折线必须落在各段分界
  const wantFolds = [];
  let acc = 0;
  for (let i = 0; i < profile.length - 1; i += 1) {
    acc += profile[i].len;
    wantFolds.push(acc);
  }
  const folds = innerFolds(net, lid);
  result.top.folds = folds;
  result.top.wantFolds = wantFolds;
  if (folds.length !== wantFolds.length) {
    errors.push(`顶盖内折线 ${folds.length} 条，应为 ${wantFolds.length} 条`);
  } else {
    folds.forEach((f, i) => {
      if (Math.abs(f - wantFolds[i]) > EPS) {
        errors.push(`第 ${i + 1} 条折线距根部 ${f.toFixed(2)} ≠ ${wantFolds[i].toFixed(2)}`);
      }
    });
  }
  }

  // 深度：各段前进量之和应等于箱深（分段内不能回退）
  const depthSum = profile.reduce((a, p) => a + p.depth, 0);
  if (Math.abs(depthSum - W) > EPS) {
    errors.push(`剖面前进深度 ${depthSum.toFixed(2)} ≠ 箱深 ${W.toFixed(2)}`);
  }

  // 底面：两片主摇盖 + 两片侧面防尘摇盖
  const bottom = [...lidsBelow(net, 'front'), ...lidsBelow(net, 'back')];
  const sum = bottom.reduce((a, b) => a + b[1].h, 0);
  result.bottom.sum = sum;
  if (bottom.length !== 2) errors.push(`底主摇盖应有 2 片，实际 ${bottom.length} 片`);
  if (Math.abs(sum - W) > EPS) {
    errors.push(`底主摇盖总长 ${sum.toFixed(2)} ≠ 箱深 ${W.toFixed(2)}（有缝或重叠）`);
  }
  for (const [k, p] of bottom) {
    if (Math.abs(p.h - W / 2) > EPS) {
      errors.push(`底主摇盖 ${k} 深 ${p.h.toFixed(2)} ≠ W/2 = ${(W / 2).toFixed(2)}`);
    }
  }

  const dust = Object.entries(net.panels).filter(([, p]) => p.kind === 'minor');
  result.bottom.dust = dust.length;
  if (dust.length !== 2) errors.push(`侧面防尘摇盖应有 2 片，实际 ${dust.length} 片`);
  for (const [k, p] of dust) {
    if (p.editable) errors.push(`防尘摇盖 ${k} 不该可编辑`);
    if (Math.abs(p.h - W / 2) > EPS) {
      errors.push(`防尘摇盖 ${k} 深 ${p.h.toFixed(2)} ≠ W/2 = ${(W / 2).toFixed(2)}`);
    }
  }

  // 顶部不许有防尘摇盖
  const topDust = Object.entries(net.panels).filter(
    ([, p]) => p.kind === 'minor' && p.y + p.h <= net.panels.front.y + 1e-9,
  );
  if (topDust.length > 0) {
    errors.push(`顶部不应有防尘摇盖，却有 ${topDust.map(([k]) => k).join('、')}`);
  }

  result.ok = errors.length === 0;
  return result;
}
