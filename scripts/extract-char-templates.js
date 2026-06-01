/**
 * 从 screen.png + ground truth 提取字符模板
 *
 * 用法: node scripts/extract-char-templates.js
 * 输出: public/config/chars/{x,0,1,2,3,4,5,6,7,8,9}.png
 */

import sharp from 'sharp'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SCREENSHOT = join(ROOT, 'screen.png')
const CONFIG_PATH = join(ROOT, 'public/config/items.json')
const OUT_DIR = join(ROOT, 'public/config/chars')

// Ground truth (用户提供)
const GROUND_TRUTH = [
  [746, 1224, 1100, 1440, 250, 946],
  [431, 518, 554, 704, 242, 918],
]

// ═══════════ 工具函数 ═══════════
function parseHex(hex) { const h = hex.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) } }
function colorDist(r, g, b, c) { return Math.hypot(r - c.r, g - c.g, b - c.b) }
function getRgb(data, w, x, y) { const h = data.length / (w * 4); if (x < 0 || y < 0 || x >= w || y >= h) return { r: 0, g: 0, b: 0 }; const i = (y * w + x) * 4; return { r: data[i], g: data[i + 1], b: data[i + 2] } }
function isColorPixel(data, w, x, y, c, tol) { const h = data.length / (w * 4); if (x < 0 || y < 0 || x >= w || y >= h) return false; const { r, g, b } = getRgb(data, w, x, y); return colorDist(r, g, b, c) < tol }
function median(arr) { const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

// ═══════════ 网格检测 ═══════════
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

// ═══════════ 主流程 ═══════════
async function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  const settings = config.settings
  const { searchRegion, cornerMarkerColor, markerColorTolerance, minMarkerClusterSize, gridColumns } = settings

  console.log('📷 加载 screen.png...')
  const { data, info } = await sharp(SCREENSHOT).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  console.log(`   尺寸: ${width}×${height}`)

  // 网格检测
  const sx = Math.floor(width * searchRegion.left), sy = Math.floor(height * searchRegion.top)
  const ex = Math.floor(width * searchRegion.right), ey = Math.floor(height * searchRegion.bottom)
  const markerColor = parseHex(cornerMarkerColor || '#5E9F0F')
  const anchors = findMarkerAnchors(data, width, height, sx, sy, ex, ey, markerColor, markerColorTolerance, minMarkerClusterSize)
  console.log(`   角标: ${anchors.length} 个`)

  const rows = []; for (const a of anchors) { let placed = false; for (const row of rows) { if (Math.abs(row[0].minY - a.minY) < 40) { row.push(a); placed = true; break } } if (!placed) rows.push([a]) }
  rows.forEach(r => r.sort((a, b) => a.minX - b.minX)); rows.sort((a, b) => a[0].minY - b[0].minY)
  const validRows = rows.filter(r => r.length >= 3)

  const spacings = []; for (const row of validRows) { const xs = row.map(a => a.minX).sort((a, b) => a - b); for (let i = 1; i < xs.length; i++) { const s = xs[i] - xs[i - 1]; if (s > 30 && s < 350) spacings.push(s) } }
  const colSpacing = median(spacings)
  const allAnchors = validRows.flat(); const minX = Math.min(...allAnchors.map(a => a.minX)), minY = Math.min(...allAnchors.map(a => a.minY))
  const leftmost = allAnchors.filter(a => Math.abs(a.minX - minX) < colSpacing * 0.5)
  const originX = leftmost.length > 0 ? Math.round(leftmost.reduce((s, a) => s + a.minX, 0) / leftmost.length) : minX
  const originY = minY
  const cellSize = Math.round(colSpacing * 0.92)

  console.log(`   网格: ${validRows.length}行, cellSize=${cellSize}px\n`)

  // 确保输出目录存在
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  // ═══════════ 逐格提取字符 ═══════════
  /** @type {Map<string, Array<{buf: Buffer, w: number, h: number}>>} */
  const charSamples = new Map()
  for (const ch of 'x0123456789') charSamples.set(ch, [])

  const actualRows = Math.min(validRows.length, GROUND_TRUTH.length)

  for (let rowIdx = 0; rowIdx < actualRows; rowIdx++) {
    const cellY = originY + rowIdx * (validRows[1] ? validRows[1][0].minY - validRows[0][0].minY : colSpacing)
    // 用行内平均 Y
    const avgRowY = validRows[rowIdx].reduce((s, a) => s + a.minY, 0) / validRows[rowIdx].length
    const groundRow = GROUND_TRUTH[rowIdx]

    for (let col = 0; col < Math.min(gridColumns, groundRow.length); col++) {
      const cellX = originX + col * colSpacing
      const qtyLeft = Math.round(cellX + cellSize * 0.08)
      const qtyRight = Math.round(cellX + cellSize * 0.92)
      // 收紧纵向裁剪，只取文字行（避免下方深色背景被反转成大块黑色）
      const qtyTop = Math.round(avgRowY + cellSize * 0.81)
      const qtyBottom = Math.round(avgRowY + cellSize * 0.89)
      const qtyW = qtyRight - qtyLeft
      const qtyH = qtyBottom - qtyTop
      if (qtyW <= 0 || qtyH <= 0) continue

      const expected = 'x' + groundRow[col]
      const charCount = expected.length  // e.g. "x746" = 4

      // 上采样（与浏览器预处理一致）
      const TARGET_H = 64
      const scale = Math.max(2, Math.ceil(TARGET_H / qtyH))
      const dstW = qtyW * scale
      const dstH = qtyH * scale

      // 提取 + 放大 + 二值化
      const region = await sharp(SCREENSHOT)
        .extract({ left: qtyLeft, top: qtyTop, width: qtyW, height: qtyH })
        .ensureAlpha()
        .resize(dstW, dstH, { kernel: 'mitchell' })
        .raw().toBuffer({ resolveWithObject: true })

      const rp = region.data, rw = region.info.width, rh = region.info.height

      // 灰度 + 对比度拉伸 + 二值化反转
      const bin = new Uint8Array(rw * rh)
      const gray = new Float32Array(rw * rh)
      let minL = 255, maxL = 0
      for (let i = 0; i < rw * rh; i++) {
        const j = i * 4, lum = 0.299 * rp[j] + 0.587 * rp[j + 1] + 0.114 * rp[j + 2]
        gray[i] = lum; if (lum < minL) minL = lum; if (lum > maxL) maxL = lum
      }
      const range = maxL - minL || 1
      for (let i = 0; i < rw * rh; i++) {
        bin[i] = ((gray[i] - minL) / range) * 255 > 128 ? 0 : 255
      }

      // 找到文字的包围盒（跳过边缘大块黑色背景）
      // 只用中间 60% 的列来找文字上下边界（避免边角噪点干扰）
      const colStart = Math.floor(rw * 0.2)
      const colEnd = Math.floor(rw * 0.8)
      let topEdge = rh, bottomEdge = 0
      for (let y = 0; y < rh; y++) {
        let hasBlack = false
        for (let x = colStart; x < colEnd; x++) { if (bin[y * rw + x] === 0) { hasBlack = true; break } }
        if (hasBlack) { topEdge = Math.min(topEdge, y); bottomEdge = Math.max(bottomEdge, y) }
      }
      if (topEdge > bottomEdge) { console.log(`    ⚠️ [${rowIdx + 1},${col + 1}] 未找到文字`); continue }

      // 收紧一点边距
      const marginV = Math.max(1, Math.round((bottomEdge - topEdge) * 0.15))
      const textTop = Math.max(0, topEdge - marginV)
      const textBottom = Math.min(rh, bottomEdge + marginV)
      const textH = textBottom - textTop

      // 用已知字符数等分宽度来分割
      const charW = Math.floor(rw / charCount)

      for (let i = 0; i < charCount; i++) {
        const cx = i * charW
        const cw = (i === charCount - 1) ? rw - cx : charW
        const ch = expected[i]

        // 在文字行范围内收紧左右边界
        let leftEdge = cx, rightEdge = cx + cw
        for (let x = cx; x < cx + cw; x++) {
          let hasBlack = false
          for (let y = textTop; y < textBottom; y++) { if (bin[y * rw + x] === 0) { hasBlack = true; break } }
          if (hasBlack) { leftEdge = x; break }
        }
        for (let x = cx + cw - 1; x >= cx; x--) {
          let hasBlack = false
          for (let y = textTop; y < textBottom; y++) { if (bin[y * rw + x] === 0) { hasBlack = true; break } }
          if (hasBlack) { rightEdge = x + 1; break }
        }

        const extW = rightEdge - leftEdge
        if (extW < 3) { console.log(`    ⚠️ [${rowIdx + 1},${col + 1}] "${ch}" 太窄 (${extW}px)，跳过`); continue }

        // 添加边距
        const margin = Math.max(2, Math.round(textH * 0.2))
        const outW = extW + margin * 2
        const outH = textH + margin * 2

        // 生成输出 PNG（黑字白底）
        const outBuf = Buffer.alloc(outW * outH * 4)
        outBuf.fill(255)  // 白色背景
        for (let y = textTop; y < textBottom; y++) {
          for (let x = leftEdge; x < rightEdge; x++) {
            const sx = x - leftEdge + margin
            const sy = y - textTop + margin
            if (bin[y * rw + x] === 0) {
              const idx = (sy * outW + sx) * 4
              outBuf[idx] = outBuf[idx + 1] = outBuf[idx + 2] = 0  // 黑色
              outBuf[idx + 3] = 255
            }
          }
        }

        const pngBuf = await sharp(outBuf, { raw: { width: outW, height: outH, channels: 4 } }).png().toBuffer()
        charSamples.get(ch).push({ buf: pngBuf, w: outW, h: outH })
      }
    }
  }

  // ═══════════ 保存每个字符的最佳样本 ═══════════
  console.log('')
  for (const [ch, samples] of charSamples) {
    if (samples.length === 0) { console.log(`  ❌ "${ch}" 无样本`); continue }

    // 取黑像素密度中等的那个（避免太粗或太细的极端样本）
    const densities = samples.map(s => {
      let bc = 0
      // 粗略估计黑像素
      return { sample: s, w: s.w, h: s.h }
    })
    // 选尺寸最接近中位数的样本
    const sorted = [...densities].sort((a, b) => (a.w * a.h) - (b.w * b.h))
    const best = sorted[Math.floor(sorted.length / 2)]

    const outPath = join(OUT_DIR, `${ch}.png`)
    writeFileSync(outPath, best.sample.buf)
    console.log(`  ✅ "${ch}": ${samples.length} 样本 → 保存 ${best.w}×${best.h}`)
  }

  console.log(`\n📦 模板已保存到 ${OUT_DIR}/`)
}

main().catch(err => { console.error(err); process.exit(1) })
