/**
 * 从 screen.png 提取前两行数量条区域，预处理后保存
 * 用法: node scripts/extract-qty-regions.js
 * 输出: public/config/qty-cells/ 下按行列命名的 PNG 文件
 */

import sharp from 'sharp'
import { readFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SCREENSHOT = join(ROOT, 'screen.png')
const CONFIG_PATH = join(ROOT, 'public/config/items.json')
const OUT_DIR = join(ROOT, 'public/config/qty-cells')

const GROUND_TRUTH = [
  ['x746', 'x1224', 'x1100', 'x1440', 'x250', 'x946'],
  ['x431', 'x518', 'x554', 'x704', 'x242', 'x918'],
]

// ═══════════ 工具函数 ═══════════
function parseHex(hex) { const h = hex.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) } }
function colorDist(r, g, b, c) { return Math.hypot(r - c.r, g - c.g, b - c.b) }
function getRgb(data, w, x, y) { const h = data.length / (w * 4); if (x < 0 || y < 0 || x >= w || y >= h) return { r: 0, g: 0, b: 0 }; const i = (y * w + x) * 4; return { r: data[i], g: data[i + 1], b: data[i + 2] } }
function isColorPixel(data, w, x, y, c, tol) { const h = data.length / (w * 4); if (x < 0 || y < 0 || x >= w || y >= h) return false; const { r, g, b } = getRgb(data, w, x, y); return colorDist(r, g, b, c) < tol }
function median(arr) { const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

function findMarkerAnchors(data, w, h, sx, sy, ex, ey, markerColor, tol, minSize) {
  const visited = new Uint8Array(w * h); const clusters = []
  for (let y = sy; y < ey; y++) for (let x = sx; x < ex; x++) {
    const idx = y * w + x
    if (visited[idx] || !isColorPixel(data, w, x, y, markerColor, tol)) continue
    const stack = [[x, y]]; let minX = x, minY = y, maxX = x, maxY = y, count = 0
    while (stack.length) {
      const [cx, cy] = stack.pop(); const ci = cy * w + cx
      if (cx < sx || cy < sy || cx >= ex || cy >= ey || visited[ci] || !isColorPixel(data, w, cx, cy, markerColor, tol)) continue
      visited[ci] = 1; count++; minX = Math.min(minX, cx); minY = Math.min(minY, cy); maxX = Math.max(maxX, cx); maxY = Math.max(maxY, cy)
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
    }
    if (count >= minSize && maxX - minX <= 55 && maxY - minY <= 55 && maxX - minX >= 8 && maxY - minY >= 8) clusters.push({ minX, minY, maxX, maxY, count })
  }
  clusters.sort((a, b) => b.count - a.count)
  const kept = []
  for (const c of clusters) { if (kept.some(k => Math.abs(k.minX - c.minX) < 40 && Math.abs(k.minY - c.minY) < 40)) continue; kept.push(c) }
  kept.sort((a, b) => a.minY - b.minY || a.minX - b.minX); return kept
}

async function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  const settings = config.settings
  const { searchRegion, cornerMarkerColor, markerColorTolerance, minMarkerClusterSize, gridColumns } = settings

  console.log('📷 加载 screen.png...')
  const { data, info } = await sharp(SCREENSHOT).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info

  const sx = Math.floor(width * searchRegion.left), sy = Math.floor(height * searchRegion.top)
  const ex = Math.floor(width * searchRegion.right), ey = Math.floor(height * searchRegion.bottom)
  const markerColor = parseHex(cornerMarkerColor || '#5E9F0F')
  const anchors = findMarkerAnchors(data, width, height, sx, sy, ex, ey, markerColor, markerColorTolerance, minMarkerClusterSize)

  const rows = []; for (const a of anchors) { let placed = false; for (const row of rows) { if (Math.abs(row[0].minY - a.minY) < 40) { row.push(a); placed = true; break } } if (!placed) rows.push([a]) }
  rows.forEach(r => r.sort((a, b) => a.minX - b.minX)); rows.sort((a, b) => a[0].minY - b[0].minY)
  const validRows = rows.filter(r => r.length >= 3)

  const spacings = []; for (const row of validRows) { const xs = row.map(a => a.minX).sort((a, b) => a - b); for (let i = 1; i < xs.length; i++) { const s = xs[i] - xs[i - 1]; if (s > 30 && s < 350) spacings.push(s) } }
  const colSpacing = median(spacings)
  const allAnchors = validRows.flat(); const minX = Math.min(...allAnchors.map(a => a.minX))
  const leftmost = allAnchors.filter(a => Math.abs(a.minX - minX) < colSpacing * 0.5)
  const originX = leftmost.length > 0 ? Math.round(leftmost.reduce((s, a) => s + a.minX, 0) / leftmost.length) : minX
  const cellSize = Math.round(colSpacing * 0.92)

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  console.log(`网格: ${validRows.length}行, cellSize=${cellSize}px\n`)

  for (let rowIdx = 0; rowIdx < 2; rowIdx++) {
    const avgRowY = validRows[rowIdx].reduce((s, a) => s + a.minY, 0) / validRows[rowIdx].length
    const groundRow = GROUND_TRUTH[rowIdx]

    for (let col = 0; col < 6; col++) {
      const cellX = originX + col * colSpacing
      const qtyLeft = Math.round(cellX + cellSize * 0.08)
      const qtyRight = Math.round(cellX + cellSize * 0.92)
      const qtyTop = Math.round(avgRowY + cellSize * 0.70)
      const qtyBottom = Math.round(avgRowY + cellSize * 0.91)
      const qtyW = qtyRight - qtyLeft
      const qtyH = qtyBottom - qtyTop

      // 提取 + 放大 + 二值化反转
      const TARGET_H = 64
      const scale = Math.max(2, Math.ceil(TARGET_H / qtyH))
      const dstW = qtyW * scale
      const dstH = qtyH * scale

      const region = await sharp(SCREENSHOT)
        .extract({ left: qtyLeft, top: qtyTop, width: qtyW, height: qtyH })
        .ensureAlpha()
        .resize(dstW, dstH, { kernel: 'mitchell' })
        .raw().toBuffer({ resolveWithObject: true })

      const rp = region.data, rw = region.info.width, rh = region.info.height

      // 灰度 + 二值化反转（固定阈值，不做对比度拉伸避免噪声放大）
      const BIN_THRESHOLD = 100  // 原图文字亮度 >100 即为文字像素
      const pixels = Buffer.alloc(rw * rh * 4)
      for (let i = 0; i < rw * rh; i++) {
        const j = i * 4
        const lum = 0.299 * rp[j] + 0.587 * rp[j + 1] + 0.114 * rp[j + 2]
        const val = lum > BIN_THRESHOLD ? 0 : 255
        pixels[j] = pixels[j + 1] = pixels[j + 2] = val
        pixels[j + 3] = 255
      }

      const label = groundRow[col]
      const filename = `r${rowIdx + 1}c${col + 1}_${label}.png`
      const outPath = join(OUT_DIR, filename)

      await sharp(pixels, { raw: { width: rw, height: rh, channels: 4 } }).png().toFile(outPath)
      console.log(`  ✅ ${filename} (${rw}×${rh})`)
    }
  }

  console.log(`\n📦 已保存到 ${OUT_DIR}/`)
  console.log('   请用图片编辑器打开，截取每个数字并命名为 0.png ~ 9.png, x.png')
  console.log('   放到 public/config/chars/ 目录下覆盖现有文件')
}

main().catch(err => { console.error(err); process.exit(1) })
