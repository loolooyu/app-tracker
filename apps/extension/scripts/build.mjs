// Build the unpacked extension into apps/extension/dist (load that folder in chrome://extensions).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const dist = root + 'dist/';
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist + 'icons', { recursive: true });

const common = { bundle: true, minify: true, sourcemap: false, target: 'chrome116', logLevel: 'info', legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"' } };
await build({ ...common, entryPoints: [root + 'src/background.ts'], outfile: dist + 'background.js', format: 'esm' });
// The capture script is injected with chrome.scripting.executeScript, so it must be a classic script.
await build({ ...common, entryPoints: [root + 'src/capture.ts'], outfile: dist + 'capture.js', format: 'iife' });
await build({ ...common, entryPoints: [root + 'src/sidepanel/main.tsx'], outfile: dist + 'sidepanel.js', format: 'esm', jsx: 'automatic' });

copyFileSync(root + 'src/manifest.json', dist + 'manifest.json');
copyFileSync(root + 'src/sidepanel/sidepanel.html', dist + 'sidepanel.html');
copyFileSync(root + 'src/sidepanel/sidepanel.css', dist + 'sidepanel.css');

// Icons: a blue rounded square with a white page and blue text lines, rendered to PNG here
// so the repository needs no binary assets.
function png(size) {
  const px = Buffer.alloc(size * size * 4);
  const blue = [37, 99, 235], white = [255, 255, 255], light = [191, 211, 245];
  const r = size * 0.22;
  const inRounded = (x, y, x0, y0, x1, y1, rad) => {
    const cx = Math.min(Math.max(x, x0 + rad), x1 - rad);
    const cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const fx = x + 0.5, fy = y + 0.5;
      if (!inRounded(fx, fy, 0, 0, size, size, r)) continue;
      let c = blue;
      const p0x = size * 0.27, p1x = size * 0.73, p0y = size * 0.2, p1y = size * 0.8;
      if (inRounded(fx, fy, p0x, p0y, p1x, p1y, size * 0.06)) {
        c = white;
        const lines = [0.36, 0.48, 0.6];
        for (const [k, ly] of lines.entries()) {
          const w = k === 2 ? 0.5 : 0.62;
          if (Math.abs(fy - size * ly) <= Math.max(0.6, size * 0.03) && fx >= size * 0.34 && fx <= size * (0.34 + w * 0.6)) c = light;
        }
      }
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [16, 32, 48, 128]) writeFileSync(dist + `icons/icon${s}.png`, png(s));
console.log('Extension built at', dist);
