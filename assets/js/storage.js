/**
 * storage.js —— 草稿存储与图片压缩
 *
 * localStorage 只有 5MB 左右，图片一多就会爆；
 * 写不进去时自动改存 IndexedDB（容量大得多），并在 localStorage 里留一个标记。
 */

import { DRAFT_KEY, parseDraft } from './project.js';

const IDB_FLAG = `${DRAFT_KEY}.idb`;
const DB_NAME = 'cartonmark';
const DB_VERSION = 1;
const STORE = 'drafts';
const IDB_KEY = 'project';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
  });
  return dbPromise;
}

async function idbPut(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, IDB_KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB 写入失败'));
  });
}

async function idbGet() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('IndexedDB 读取失败'));
  });
}

/**
 * 保存草稿：优先 localStorage；写满自动落 IndexedDB。
 * @returns {Promise<'local'|'idb'|'none'>}
 */
export async function saveProject(payload) {
  const json = JSON.stringify(payload);
  try {
    localStorage.setItem(DRAFT_KEY, json);
    try {
      localStorage.removeItem(IDB_FLAG);
    } catch {
      /* ignore */
    }
    return 'local';
  } catch {
    try {
      await idbPut(payload);
      try {
        localStorage.setItem(IDB_FLAG, '1');
      } catch {
        /* ignore */
      }
      return 'idb';
    } catch (err) {
      console.error('草稿写入 IndexedDB 也失败了，本次改动没保存', err);
      return 'none';
    }
  }
}

/** 读取草稿：先看标记，决定从 IndexedDB 还是 localStorage 读 */
export async function loadProject() {
  let fromIdb = false;
  try {
    fromIdb = localStorage.getItem(IDB_FLAG) === '1';
  } catch {
    fromIdb = false;
  }

  if (fromIdb) {
    try {
      const data = await idbGet();
      const parsed = parseDraft(data);
      if (parsed) return parsed;
    } catch (err) {
      console.warn('IndexedDB 读取失败，回落到 localStorage', err);
    }
  }

  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return parseDraft(JSON.parse(raw));
  } catch (err) {
    console.warn('localStorage 草稿读取失败', err);
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
