/**
 * Genera los PNG de íconos PWA desde los SVG fuente.
 *
 * Uso:
 *   node scripts/generate-pwa-icons.mjs
 *
 * Fuentes:
 *   public/icons/icon.svg         → icon-{72,96,128,144,152,192,384,512}.png
 *   public/icons/icon.svg         → apple-touch-icon.png (180)
 *   public/icons/icon-maskable.svg → icon-{192,512}-maskable.png
 *   public/icons/badge.svg         → badge-72.png
 *
 * Sharp usa libvips, muy rápido. Corre en <5s todos los tamaños.
 */

import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.resolve(__dirname, '../public/icons');

const TASKS = [
  // Regular icons (cualquier purpose).
  { src: 'icon.svg', size: 72,  out: 'icon-72.png' },
  { src: 'icon.svg', size: 96,  out: 'icon-96.png' },
  { src: 'icon.svg', size: 128, out: 'icon-128.png' },
  { src: 'icon.svg', size: 144, out: 'icon-144.png' },
  { src: 'icon.svg', size: 152, out: 'icon-152.png' },
  { src: 'icon.svg', size: 192, out: 'icon-192.png' },
  { src: 'icon.svg', size: 384, out: 'icon-384.png' },
  { src: 'icon.svg', size: 512, out: 'icon-512.png' },

  // Apple touch icon (sin rounded corners externos, iOS aplica máscara).
  { src: 'icon.svg', size: 180, out: 'apple-touch-icon.png' },

  // Maskable (safe zone interior del 80%).
  { src: 'icon-maskable.svg', size: 192, out: 'icon-192-maskable.png' },
  { src: 'icon-maskable.svg', size: 512, out: 'icon-512-maskable.png' },

  // Badge monocromo para Android status bar.
  { src: 'badge.svg', size: 72, out: 'badge-72.png' },

  // Favicon (PNG base, para head).
  { src: 'icon.svg', size: 32, out: 'favicon-32.png' },
  { src: 'icon.svg', size: 16, out: 'favicon-16.png' },
];

async function main() {
  if (!existsSync(ICONS_DIR)) {
    await mkdir(ICONS_DIR, { recursive: true });
  }

  console.log(`Generando ${TASKS.length} íconos...\n`);

  for (const task of TASKS) {
    const srcPath = path.join(ICONS_DIR, task.src);
    const outPath = path.join(ICONS_DIR, task.out);
    const svgBuffer = await readFile(srcPath);
    await sharp(svgBuffer, { density: 400 })
      .resize(task.size, task.size, { fit: 'contain', background: { r: 8, g: 9, b: 11, alpha: 1 } })
      .png({ compressionLevel: 9, quality: 92 })
      .toFile(outPath);
    console.log(`  ✓ ${task.out} (${task.size}×${task.size})`);
  }

  console.log(`\nListo. ${TASKS.length} íconos generados en public/icons/`);
}

main().catch((err) => {
  console.error('Error generando íconos:', err);
  process.exit(1);
});
