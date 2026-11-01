/**
 * storage.js —— 草稿存储与图片压缩
 *
 * 草稿放 sessionStorage：刷新还在，关掉标签页 / 浏览器就没了（用户 2026-11-01 要求）。
 * 早期版本把草稿放 localStorage（图片太大时还落过 IndexedDB），启动时会把那些旧键和旧库清掉，
 * 避免老数据阴魂不散。
 */

import { DRAFT_KEY, parseDraft } from './project.js';

const LEGACY_IDB_FLAG = `${DRAFT_KEY}.idb`;
const LEGACY_DB_NAME = 'cartonmark';

function purgeLegacyDbOnce() {
  if (dbPurged) return;
  dbPurged = true;
  try {
    if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase(LEGACY_DB_NAME);
  } catch (err) {
    console.warn('清理旧 IndexedDB 草稿失败', err);
  }
}

/** 清掉旧版 localStorage 草稿键（每次启动都清，防止老数据回来） */
function purgeLegacyDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(LEGACY_IDB_FLAG);
  } catch (err) {
    console.warn('清理旧 localStorage 草稿失败', err);
  }
}

let dbPurged = false;

/**
 * 保存草稿到 sessionStorage。
 * @returns {Promise<'session'|'none'>}
 */
export async function saveProject(payload) {
  purgeLegacyDraft();
  purgeLegacyDbOnce();
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    return 'session';
  } catch (err) {
    console.error('草稿写入 sessionStorage 失败（可能是图片太大），本次改动没保存', err);
    return 'none';
  }
}

/** 读取草稿：只认 sessionStorage，新标签页/重开浏览器是空的 */
export async function loadProject() {
  purgeLegacyDraft();
  purgeLegacyDbOnce();
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) return parseDraft(JSON.parse(raw));
  } catch (err) {
    console.warn('sessionStorage 草稿读取失败', err);
  }
  return null;
}

/**
 * 读图 → 降采样 → 重新编码成 dataURL。
 * 默认长边 1500px、JPEG 0.85；仍超 1.5MB 时继续降采样，最多 3 次。
 */
export function compressImage(file, { maxSide = 1500, quality = 0.85, maxBytes = 1_500_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('没有选择文件'));
      return;
    }
    if (!/^image\//i.test(file.type)) {
      reject(new Error('请选择图片文件（PNG / JPG / WebP / GIF / SVG）'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败，请重试'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片格式不支持或文件已损坏'));
      img.onload = () => {
        try {
          const scaleTo = (side, q, format) => {
            const ratio = Math.min(1, side / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
            const w = Math.max(1, Math.round((img.naturalWidth || 1) * ratio));
            const h = Math.max(1, Math.round((img.naturalHeight || 1) * ratio));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            return { dataUrl: canvas.toDataURL(format, q), width: w, height: h };
          };

          const keepPng = /^image\/(png|svg\+xml)$/i.test(file.type);
          let res = scaleTo(maxSide, quality, keepPng ? 'image/png' : 'image/jpeg');
          let round = 0;
          while (res.dataUrl.length > maxBytes && round < 3) {
            round += 1;
            res = scaleTo(maxSide * 0.7 ** round, Math.max(0.5, quality - 0.1 * round), 'image/jpeg');
          }
          resolve({
            dataUrl: res.dataUrl,
            width: res.width,
            height: res.height,
            bytes: res.dataUrl.length,
          });
        } catch (err) {
          reject(new Error(`图片处理失败：${err.message}`));
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
