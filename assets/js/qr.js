/**
 * qr.js —— 用本地二维码库把微信支付串画成真二维码
 * 依赖 vendor/qrcode.js（qrcode-generator，MIT），不联网、不引 CDN。
 */

export function drawQr(canvas, text, { size = 220, margin = 4 } = {}) {
  if (!canvas) throw new Error('没有二维码画布');
  if (typeof window.qrcode !== 'function') throw new Error('二维码库未加载');

  const qr = window.qrcode(0, 'M');
  qr.addData(String(text));
  qr.make();

  const count = qr.getModuleCount();
  const cell = size / (count + margin * 2);

  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';

  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!qr.isDark(row, col)) continue;
      ctx.fillRect(
        Math.floor((col + margin) * cell),
        Math.floor((row + margin) * cell),
        Math.ceil(cell),
        Math.ceil(cell),
      );
    }
  }

  return { count, size };
}
