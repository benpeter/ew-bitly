import { qrcode } from './vendor/qrcode.js';

const MARGIN = 4;

export function qrMatrix(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (__, c) => qr.isDark(r, c)));
}

export function qrSvg(text) {
  const m = qrMatrix(text);
  const size = m.length + MARGIN * 2;
  const d = m.flatMap((row, r) => row.map((dark, c) => (dark ? `M${c + MARGIN} ${r + MARGIN}h1v1h-1z` : ''))).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`
    + `<rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}

export function qrPng(text, px = 1024) {
  const m = qrMatrix(text);
  const size = m.length + MARGIN * 2;
  const scale = Math.ceil(px / size);
  const canvas = document.createElement('canvas');
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  m.forEach((row, r) => row.forEach((dark, c) => {
    if (dark) ctx.fillRect((c + MARGIN) * scale, (r + MARGIN) * scale, scale, scale);
  }));
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png'))), 'image/png');
  });
}
