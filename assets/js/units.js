/**
 * units.js —— 单位与尺寸校验
 * 内部一律使用毫米（mm）。显示层按当前单位换算，绝不把显示值写进数据。
 */

export const UNIT_FACTORS = { mm: 1, cm: 10, in: 25.4 };

/** 硬边界：超出即视为输入错误，不绘制 */
export const MIN_MM = 20;
export const MAX_MM = 4000;
/** 软边界：能画，但提示用户确认（常见纸箱范围） */
export const SOFT_MIN_MM = 50;
export const SOFT_MAX_MM = 3000;

export function toMm(value, unit) {
  return value * (UNIT_FACTORS[unit] || 1);
}

export function fromMm(mm, unit) {
  return mm / (UNIT_FACTORS[unit] || 1);
}

/** 显示用数值：mm 取整，cm / 英寸保留两位小数 */
export function displayValue(mm, unit) {
  if (unit === 'cm' || unit === 'in') return Math.round(fromMm(mm, unit) * 100) / 100;
  return Math.round(mm);
}

export function unitSuffix(unit) {
  if (unit === 'cm') return 'cm';
  if (unit === 'in') return 'in';
  return 'mm';
}

/**
 * 校验单个尺寸输入。
 * @param {string|number} raw 用户原始输入
 * @param {'mm'|'cm'|'in'} unit
 * @param {string} name 中文名，用于提示
 * @returns {{ok:boolean, mm?:number, error?:string, warn?:string}}
 */
export function validateDim(raw, unit, name) {
  const text = String(raw ?? '').trim();
  if (text === '') return { ok: false, error: `请输入${name}` };
  if (!/^-?\d*\.?\d+$/.test(text)) return { ok: false, error: '只能填数字' };

  const num = Number(text);
  if (!Number.isFinite(num)) return { ok: false, error: '只能填数字' };

  const mm = toMm(num, unit);
  if (mm <= 0) return { ok: false, error: '必须大于 0' };
  if (mm < MIN_MM) return { ok: false, error: `不能小于 ${MIN_MM} mm` };
  if (mm > MAX_MM) return { ok: false, error: `不能大于 ${MAX_MM} mm` };

  let warn = '';
  if (mm < SOFT_MIN_MM || mm > SOFT_MAX_MM) {
    warn = `${name} = ${Math.round(mm)} mm 超出常见纸箱范围（${SOFT_MIN_MM}–${SOFT_MAX_MM} mm），请确认`;
  }
  return { ok: true, mm, warn };
}

/** 数值格式化：2000 → "2,000" */
export function fmt(n, digits = 0) {
  return Number(n).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
