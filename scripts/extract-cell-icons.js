/**
 * 从背包截图中提取所有格子的图标区域
 *
 * 移植 useGridDetection.js 的绿色角标检测算法到 Node.js
 *
 * 用法: node scripts/extract-cell-icons.js [截图路径]
 * 默认: node scripts/extract-cell-icons.js screen.png
 */

import sharp from 'sharp'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// 加载配置
const configPath = join(ROOT, 'public/config/items.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const settings = config.settings

// 输出目录
const OUT_DIR = join(ROOT, 'public/config/images/screen')
const CONTACT_SHEET_DIR = join(ROOT, 'public/config/images/screen/_contact_sheet')

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(CONTACT_SHEET_DIR, { recursive: true })

// ═══════════════════════════════════════════════════════════════
// 颜色工具（与 useGridDetection.js 保持一致）
// ═══════════════════════════════════════════════════════════════

function parseHex(hex) {
  const h = hex.replace('#', '')
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

function colorDist(r, g, b, c) {
  return Math.hypot(r - c.r, g - c.g, b - c.b)
}

function getRgb(data, width, x, y) {
  const imgH = data.length / (width * 4)
  if (x < 0 || y < 0 || x >= width || y >= imgH) return { r: 0, g: 0, b: 0 }
  const i = (y * width + x) * 4
  return { r: data[i], g: data[i + 1], b: data[i + 2] }
}

function isColorPixel(data, width, x, y, color, tol) {
  const imgH = data.length / (width * 4)
  if (x < 0 || y < 0 || x >= width || y >= imgH) return false
  const { r, g, b } = getRgb(data, width, x, y)
  return colorDist(r, g, b, color) < tol
}

function isCellBgPixel(data, width, x, y, cellColors, tol) {
  return cellColors.some((c) => isColorPixel(data, width, x, y, c, tol))
}

// ═══════════════════════════════════════════════════════════════
// 第一步：绿色角标检测（flood fill 连通区域）
// ═══════════════════════════════════════════════════════════════

function findMarkerAnchors(data, width, height, sx, sy, ex, ey, markerColor, tol, minSize) {
  const visited = new Uint8Array(width * height)
  const clusters = []

  for (let y = sy; y < ey; y += 1) {
    for (let x = sx; x < ex; x += 1) {
      const idx = y * width + x
      if (visited[idx] || !isColorPixel(data, width, x, y, markerColor, tol)) continue

      const stack = [[x, y]]
      let minX = x, minY = y, maxX = x, maxY = y, count = 0

      while (stack.length) {
        const [cx, cy] = stack.pop()
        const ci = cy * width + cx
        if (cx < sx || cy < sy || cx >= ex || cy >= ey) continue
        if (visited[ci] || !isColorPixel(data, width, cx, cy, markerColor, tol)) continue
        visited[ci] = 1
        count++
        minX = Math.min(minX, cx)
        minY = Math.min(minY, cy)
        maxX = Math.max(maxX, cx)
        maxY = Math.max(maxY, cy)
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
      }

      const cw = maxX - minX
      const ch = maxY - minY

      // 过滤：大小适中且像素数足够
      if (count >= minSize && cw <= 55 && ch <= 55 && cw >= 8 && ch >= 8) {
        clusters.push({ minX, minY, maxX, maxY, count, w: cw, h: ch })
      }
    }
  }

  // 去重：按像素数降序，附近重复的只保留最大的
  clusters.sort((a, b) => b.count - a.count)
  const kept = []
  for (const c of clusters) {
    if (kept.some((k) => {
      const dx = k.minX - c.minX
      const dy = k.minY - c.minY
      return Math.abs(dx) < 40 && Math.abs(dy) < 40
    })) continue
    kept.push(c)
  }

  kept.sort((a, b) => a.minY - b.minY || a.minX - b.minX)
  return kept
}

// ═══════════════════════════════════════════════════════════════
// 第二步：行分组 + 过滤
// ═══════════════════════════════════════════════════════════════

function clusterAnchorsByRow(anchors) {
  if (anchors.length === 0) return []

  const sorted = [...anchors].sort((a, b) => a.minY - b.minY)
  const rows = []

  for (const a of sorted) {
    let placed = false
    for (const row of rows) {
      const rowAvgY = row.reduce((s, r) => s + r.minY, 0) / row.length
      if (Math.abs(rowAvgY - a.minY) < 40) {
        row.push(a)
        placed = true
        break
      }
    }
    if (!placed) rows.push([a])
  }

  rows.forEach((r) => r.sort((a, b) => a.minX - b.minX))
  rows.sort((a, b) => a[0].minY - b[0].minY)

  return rows
}

function filterValidRows(rowGroups, gridColumns) {
  return rowGroups
    .map((row, idx) => ({
      row,
      rowIndex: idx,
      count: row.length,
      avgY: row.reduce((s, a) => s + a.minY, 0) / row.length,
    }))
    .filter((r) => r.count >= Math.max(3, Math.floor(gridColumns * 0.5)))
    .sort((a, b) => a.avgY - b.avgY)
    .map((r, idx) => ({ ...r, rowIndex: idx }))
}

// ═══════════════════════════════════════════════════════════════
// 第三步：间距计算
// ═══════════════════════════════════════════════════════════════

function median(values) {
  const arr = values.filter((v) => v != null && !Number.isNaN(v))
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function computeRobustColSpacing(validRows) {
  const allSpacings = []

  for (const row of validRows) {
    const xs = row.row.map((a) => a.minX).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) {
      const s = xs[i] - xs[i - 1]
      if (s > 30 && s < 350) {
        allSpacings.push(s)
      }
    }
  }

  if (allSpacings.length === 0) return 100

  const sorted = allSpacings.sort((a, b) => a - b)
  const minS = sorted[0]
  const maxS = sorted[sorted.length - 1]

  const bucketSize = 5
  const numBuckets = Math.ceil((maxS - minS) / bucketSize) + 1
  const buckets = new Array(numBuckets).fill(0)

  for (const s of allSpacings) {
    const b = Math.floor((s - minS) / bucketSize)
    buckets[b]++
  }

  let bestBucket = 0
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i] > buckets[bestBucket]) bestBucket = i
  }

  const bucketStart = minS + bestBucket * bucketSize
  const bucketEnd = bucketStart + bucketSize
  const valuesInBucket = allSpacings.filter((s) => s >= bucketStart && s < bucketEnd)
  const avg = valuesInBucket.length > 0
    ? valuesInBucket.reduce((s, v) => s + v, 0) / valuesInBucket.length
    : median(sorted)

  return avg > 0 ? avg : median(sorted)
}

function computeRobustRowSpacing(validRows, colSpacing) {
  if (validRows.length < 2) return colSpacing

  const spacings = []
  for (let i = 1; i < validRows.length; i++) {
    const s = validRows[i].avgY - validRows[i - 1].avgY
    if (s > colSpacing * 0.5 && s < colSpacing * 2) {
      spacings.push(s)
    }
  }

  return spacings.length > 0 ? median(spacings) : colSpacing
}

// ═══════════════════════════════════════════════════════════════
// 第四步：用颜色精调格子边界
// ═══════════════════════════════════════════════════════════════

function findCellRightEdge(data, width, ax, ay, colSpacing, cellColors, tol) {
  const searchStart = ax + Math.round(colSpacing * 0.65)
  const searchEnd = ax + Math.round(colSpacing * 1.15)

  const sampleTop = ay + Math.round(colSpacing * 0.15)
  const sampleBottom = ay + Math.round(colSpacing * 0.40)

  const ratios = []
  for (let x = searchStart; x <= searchEnd; x++) {
    let cellPixels = 0
    let totalPixels = 0
    for (let y = sampleTop; y <= sampleBottom; y += 2) {
      if (isCellBgPixel(data, width, x, y, cellColors, tol)) cellPixels++
      totalPixels++
    }
    ratios.push({ x, ratio: totalPixels > 0 ? cellPixels / totalPixels : 0 })
  }

  if (ratios.length === 0) return ax + Math.round(colSpacing)

  const maxRatio = Math.max(...ratios.map((r) => r.ratio))
  const dropThreshold = maxRatio * 0.4

  for (let i = 1; i < ratios.length; i++) {
    if (ratios[i - 1].ratio >= dropThreshold && ratios[i].ratio < dropThreshold) {
      return ratios[i - 1].x
    }
  }

  return ax + Math.round(colSpacing) - 1
}

function findQuantityBarBottom(data, width, leftEdge, rightEdge, ay, colSpacing, qtyColor, tol) {
  const searchTop = ay + Math.round(colSpacing * 0.55)
  const searchBottom = ay + Math.round(colSpacing * 1.25)

  const x0 = leftEdge + Math.round((rightEdge - leftEdge) * 0.04)
  const x1 = rightEdge - Math.round((rightEdge - leftEdge) * 0.04)

  let inBar = false
  let barBottom = -1
  let currentRunStart = -1
  let longestRun = 0
  let bestBarBottom = -1

  for (let y = searchTop; y <= searchBottom; y++) {
    let barPixels = 0
    let totalPixels = 0

    for (let x = x0; x <= x1; x++) {
      if (isColorPixel(data, width, x, y, qtyColor, tol)) barPixels++
      totalPixels++
    }

    const ratio = totalPixels > 0 ? barPixels / totalPixels : 0

    if (ratio >= 0.25) {
      if (!inBar) {
        currentRunStart = y
        inBar = true
      }
      barBottom = y
    } else if (inBar) {
      const runLength = barBottom - currentRunStart
      if (runLength > longestRun) {
        longestRun = runLength
        bestBarBottom = barBottom
      }
      inBar = false
    }
  }

  if (inBar) {
    const runLength = barBottom - currentRunStart
    if (runLength > longestRun) {
      bestBarBottom = barBottom
    }
  }

  return bestBarBottom > 0 ? bestBarBottom : null
}

function buildPreciseTemplate(data, width, height, validRows, colSpacing, rowSpacing, cellColors, cellTol, qtyColor, qtyTol) {
  const measuredWidths = []
  const sampleRows = validRows.slice(0, Math.min(validRows.length, 3))

  for (const row of sampleRows) {
    const sampleAnchors = row.row.slice(0, Math.min(row.row.length, 4))
    for (const anchor of sampleAnchors) {
      const rightEdge = findCellRightEdge(
        data, width, anchor.minX, anchor.minY, colSpacing, cellColors, cellTol,
      )
      const cellW = rightEdge - anchor.minX + 1
      if (cellW >= colSpacing * 0.65 && cellW <= colSpacing) {
        measuredWidths.push(cellW)
      }
    }
  }

  let cellSize
  if (measuredWidths.length >= 2) {
    cellSize = Math.round(median(measuredWidths))
  } else {
    cellSize = Math.round(colSpacing * 0.92)
  }

  return {
    width: cellSize,
    height: cellSize,
    colSpacing,
    measuredWidths: measuredWidths.length,
  }
}

// ═══════════════════════════════════════════════════════════════
// 第五步：生成所有格子
// ═══════════════════════════════════════════════════════════════

function computeGridOrigin(validRows, template, colSpacing, gridColumns) {
  const allAnchors = validRows.flatMap((r) => r.row)
  const minX = Math.min(...allAnchors.map((a) => a.minX))
  const minY = Math.min(...allAnchors.map((a) => a.minY))

  const leftmostAnchors = allAnchors
    .filter((a) => Math.abs(a.minX - minX) < colSpacing * 0.5)

  const alignedX = leftmostAnchors.length > 0
    ? Math.round(leftmostAnchors.reduce((s, a) => s + a.minX, 0) / leftmostAnchors.length)
    : minX

  return { x: alignedX, y: minY }
}

function isCompleteCell(rect, imgW, imgH, margin) {
  return (
    rect.x >= margin &&
    rect.y >= margin &&
    rect.x + rect.width <= imgW - margin &&
    rect.y + rect.height <= imgH - margin
  )
}

function validateCellHasBar(data, width, rect, qtyColor, tol) {
  const x0 = rect.x + Math.round(rect.width * 0.04)
  const x1 = rect.x + Math.round(rect.width * 0.96)
  const searchTop = rect.y + Math.round(rect.height * 0.55)
  const searchBottom = rect.y + Math.round(rect.height * 1.25)

  for (let y = searchTop; y < searchBottom; y++) {
    let bar = 0
    let n = 0
    for (let x = x0; x < x1; x++) {
      if (isColorPixel(data, width, x, y, qtyColor, tol)) bar++
      n++
    }
    if (n > 0 && bar / n >= 0.25) return true
  }
  return false
}

function detectGridCells(data, width, height, settings) {
  const {
    searchRegion,
    gridColumns,
    edgeMarginRatio,
    cornerMarkerColor = '#5E9F0F',
    quantityBarBackgroundColor = '#272727',
    cellBackgroundColor = '#F3EDDD',
    cellBackgroundColorAlt = '#F3EDDF',
    markerColorTolerance = 50,
    quantityBarColorTolerance = 45,
    cellColorTolerance = 45,
    minMarkerClusterSize = 100,
  } = settings

  const markerColor = parseHex(cornerMarkerColor)
  const qtyBarColor = parseHex(quantityBarBackgroundColor)
  const cellColors = [parseHex(cellBackgroundColor), parseHex(cellBackgroundColorAlt)]
  const margin = Math.min(width, height) * (edgeMarginRatio || 0.02)

  const sx = Math.floor(width * searchRegion.left)
  const sy = Math.floor(height * searchRegion.top)
  const ex = Math.floor(width * searchRegion.right)
  const ey = Math.floor(height * searchRegion.bottom)

  console.log(`  搜索区域: (${sx},${sy}) → (${ex},${ey}), 尺寸 ${ex - sx}x${ey - sy}`)

  // 第一步：扫描绿色角标
  const anchors = findMarkerAnchors(
    data, width, height, sx, sy, ex, ey,
    markerColor, markerColorTolerance, minMarkerClusterSize,
  )
  console.log(`  检测到 ${anchors.length} 个绿色角标`)

  if (anchors.length < 2) {
    console.log('  ⚠ 角标不足，无法构建网格')
    return { cells: [], skipped: [] }
  }

  // 第二步：分析网格结构
  const rowGroups = clusterAnchorsByRow(anchors)
  console.log(`  行分组: ${rowGroups.length} 行`)

  const validRows = filterValidRows(rowGroups, gridColumns)
  console.log(`  有效行: ${validRows.length} 行`)

  if (validRows.length === 0) {
    console.log('  ⚠ 无有效行')
    return { cells: [], skipped: [] }
  }

  const colSpacing = computeRobustColSpacing(validRows)
  console.log(`  列间距: ${colSpacing.toFixed(1)}px`)

  const rowSpacing = computeRobustRowSpacing(validRows, colSpacing)
  console.log(`  行间距: ${rowSpacing.toFixed(1)}px`)

  // 第三步：精调边界
  const template = buildPreciseTemplate(
    data, width, height, validRows, colSpacing, rowSpacing,
    cellColors, cellColorTolerance, qtyBarColor, quantityBarColorTolerance,
  )
  console.log(`  格子模板: ${template.width}x${template.height}px`)

  if (!template || template.width <= 0 || template.height <= 0) {
    console.log('  ⚠ 无法构建模板')
    return { cells: [], skipped: [] }
  }

  // 第四步：生成格子
  const gridOrigin = computeGridOrigin(validRows, template, colSpacing, gridColumns)
  const cells = []
  const skipped = []

  for (const rowGroup of validRows) {
    const rowY = gridOrigin.y + rowGroup.rowIndex * rowSpacing

    for (let col = 0; col < gridColumns; col++) {
      const x = gridOrigin.x + col * colSpacing
      const y = rowY

      const rect = {
        x: Math.round(x),
        y: Math.round(y),
        width: template.width,
        height: template.height,
      }

      if (!isCompleteCell(rect, width, height, margin)) {
        skipped.push({ rect, reason: '格子不完整或被裁切', row: rowGroup.rowIndex, col })
        continue
      }

      const hasBar = validateCellHasBar(data, width, rect, qtyBarColor, quantityBarColorTolerance)

      if (!hasBar) {
        skipped.push({ rect, reason: '未检测到数量条（空位或非物品格）', row: rowGroup.rowIndex, col })
        continue
      }

      cells.push({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        row: rowGroup.rowIndex,
        col,
        cx: rect.x + rect.width / 2,
        cy: rect.y + rect.height / 2,
      })
    }
  }

  return { cells, skipped, anchors, template, gridOrigin, colSpacing, rowSpacing }
}

// ═══════════════════════════════════════════════════════════════
// 图标区域提取（与 extractCellRegions 一致）
// ═══════════════════════════════════════════════════════════════

function getIconRegion(cell) {
  const { x, y, width, height } = cell

  // 与 extractCellRegions 保持完全一致
  const qtyTop = Math.round(y + height * 0.78)
  const iconTop = Math.round(y + height * 0.06)
  const iconBottom = Math.max(iconTop + 4, qtyTop - 2)
  const iconLeft = Math.round(x + width * 0.08)
  const iconRight = Math.round(x + width * 0.92)

  return {
    left: iconLeft,
    top: iconTop,
    width: iconRight - iconLeft,
    height: iconBottom - iconTop,
  }
}

// ═══════════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════════

async function main() {
  const imgPath = process.argv[2] || join(ROOT, 'screen.png')
  console.log(`\n📷 加载截图: ${imgPath}`)

  const img = sharp(imgPath)
  const metadata = await img.metadata()
  console.log(`   尺寸: ${metadata.width}x${metadata.height}, 格式: ${metadata.format}`)

  // 确保 RGBA 输出，与浏览器 ImageData 格式一致
  const { data, info } = await img
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height } = info
  console.log(`   通道数: ${info.channels}, 数据大小: ${(data.length / 1024 / 1024).toFixed(1)}MB`)

  // 运行格子检测
  console.log(`\n🔍 检测背包格子...`)
  const { cells, skipped, anchors, template, gridOrigin, colSpacing, rowSpacing } =
    detectGridCells(data, width, height, settings)

  console.log(`\n📊 检测结果:`)
  console.log(`   完整格子: ${cells.length}`)
  console.log(`   跳过: ${skipped.length}`)
  console.log(`   角标总数: ${anchors.length}`)

  if (cells.length === 0) {
    console.log('\n❌ 未检测到任何格子，退出')
    // 打印 skipped 信息帮助调试
    if (skipped.length > 0) {
      console.log('\n跳过的格子:')
      for (const s of skipped.slice(0, 10)) {
        console.log(`  行${s.row}列${s.col}: ${s.reason} @ (${s.rect.x},${s.rect.y})`)
      }
    }
    return
  }

  // 打印格子列表
  console.log(`\n📋 检测到的格子:`)
  const cellGrid = {}
  for (const cell of cells) {
    if (!cellGrid[cell.row]) cellGrid[cell.row] = {}
    cellGrid[cell.row][cell.col] = cell
  }
  for (const row of Object.keys(cellGrid).sort((a, b) => a - b)) {
    const cols = []
    for (let c = 0; c < 6; c++) {
      cols.push(cellGrid[row][c] ? `[r${row}c${c}]` : `[ 空  ]`)
    }
    console.log(`  行${row}: ${cols.join(' ')}`)
  }

  // ═══════════════════════════════════════════════════════════
  // 提取并保存图标
  // ═══════════════════════════════════════════════════════════

  const ICON_SIZE = 128 // 统一输出尺寸

  console.log(`\n💾 提取图标 (统一 ${ICON_SIZE}x${ICON_SIZE})...`)

  const bgColor = settings.cellBackgroundColor || '#F3EDDD'
  const bg = parseHex(bgColor)

  const extractedInfo = []

  for (const cell of cells) {
    const region = getIconRegion(cell)
    const filename = `r${cell.row}_c${cell.col}.png`
    const filepath = join(OUT_DIR, filename)

    const extractLeft = Math.max(0, region.left)
    const extractTop = Math.max(0, region.top)
    const extractW = Math.max(1, region.width)
    const extractH = Math.max(1, region.height)

    // 边界安全检查
    if (extractLeft + extractW > width || extractTop + extractH > height) {
      console.log(`  ⚠ ${filename}: 提取区域超出图片边界 (${extractLeft}+${extractW}=${extractLeft+extractW} > ${width} 或 ${extractTop}+${extractH}=${extractTop+extractH} > ${height})`)
      continue
    }

    try {
      // 每次创建新的 sharp 实例，避免复用问题
      await sharp(imgPath)
        .extract({
          left: extractLeft,
          top: extractTop,
          width: extractW,
          height: extractH,
        })
        .resize(ICON_SIZE, ICON_SIZE, {
          fit: 'contain',
          background: { r: bg.r, g: bg.g, b: bg.b },
        })
        .png()
        .toFile(filepath)

      const size = (await sharp(filepath).metadata()).size
      console.log(`  ✅ ${filename} (提取区域: ${extractW}x${extractH}px, 输出: ${(size / 1024).toFixed(1)}KB)`)
      extractedInfo.push({ cell, filename, region, size })
    } catch (err) {
      console.log(`  ❌ ${filename}: ${err.message} (区域: ${extractLeft},${extractTop} ${extractW}x${extractH})`)
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 生成拼接预览图（contact sheet）
  // ═══════════════════════════════════════════════════════════

  console.log(`\n🖼 生成拼接预览图...`)

  try {
    // 按行列排列
    const maxRow = Math.max(...cells.map((c) => c.row))
    const maxCol = 5 // 0-indexed, 6 columns

    const sheetWidth = (maxCol + 1) * (ICON_SIZE + 8) + 8
    const sheetHeight = (maxRow + 1) * (ICON_SIZE + 28) + 8

    const composites = []
    for (const cell of cells) {
      const filename = `r${cell.row}_c${cell.col}.png`
      composites.push({
        input: join(OUT_DIR, filename),
        top: 8 + cell.row * (ICON_SIZE + 28) + 20,
        left: 8 + cell.col * (ICON_SIZE + 8),
      })
    }

    // 添加标签
    const svgLabels = []
    for (const cell of cells) {
      svgLabels.push(
        `<text x="${8 + cell.col * (ICON_SIZE + 8) + ICON_SIZE / 2}" y="${8 + cell.row * (ICON_SIZE + 28) + 14}" text-anchor="middle" font-size="11" fill="#555" font-family="sans-serif">r${cell.row}c${cell.col}</text>`
      )
    }

    const labelSvg = Buffer.from(
      `<svg width="${sheetWidth}" height="${sheetHeight}">${svgLabels.join('')}</svg>`
    )

    await sharp({
      create: {
        width: sheetWidth,
        height: sheetHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([...composites, { input: labelSvg, top: 0, left: 0 }])
      .png()
      .toFile(join(CONTACT_SHEET_DIR, 'all_icons.png'))

    console.log(`  ✅ 预览图: ${join(CONTACT_SHEET_DIR, 'all_icons.png')}`)
    console.log(`     尺寸: ${sheetWidth}x${sheetHeight}px`)
  } catch (err) {
    console.log(`  ⚠ 预览图生成失败: ${err.message}`)
  }

  // ═══════════════════════════════════════════════════════════
  // 输出汇总
  // ═══════════════════════════════════════════════════════════

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`📦 提取完成!`)
  console.log(`   输出目录: ${OUT_DIR}`)
  console.log(`   提取图标: ${extractedInfo.length} 个`)
  console.log(`   跳过格子: ${skipped.length} 个`)
  console.log(`\n💡 下一步: 将图标文件重命名为对应物品名（如 向阳花.png）`)
  console.log(`   参考拼接预览图 ${CONTACT_SHEET_DIR}/all_icons.png 来识别每个图标`)
  console.log(`${'═'.repeat(60)}\n`)
}

main().catch((err) => {
  console.error('脚本执行失败:', err)
  process.exit(1)
})
