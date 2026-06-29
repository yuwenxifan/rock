/**
 * 格子分割 — 基于颜色标记的背包格检测
 *
 * 四步法：
 * 1. 扫描所有绿色三角 (#5C9F11) 确定格子位置和大致间距
 * 2. 构建网格模板（列间距直方图 → 格子尺寸）
 * 3. 生成格子矩形，检测数量条 (#272727) 验证有效格子
 * 4. 用背包底色 (#F3EDDD) 精调右边界和下边界，排除半透明间隙
 */

export function detectGridCells(imageData, settings) {
  const { width, height, data } = imageData
  const {
    searchRegion,
    gridColumns,
    edgeMarginRatio,
    cornerMarkerColor = '#5C9F11',
    quantityBarBackgroundColor = '#272727',
    cellBackgroundColor = '#F4EEE0',
    cellBackgroundColorAlt = '#F3EDDF',
    markerColorTolerance = 50,
    quantityBarColorTolerance = 45,
    cellColorTolerance = 45,
    minMarkerClusterSize = 100,
  } = settings

  const markerColor = parseHex(cornerMarkerColor)
  const qtyBarColor = parseHex(quantityBarBackgroundColor)
  const cellColors = [parseHex(cellBackgroundColor), parseHex(cellBackgroundColorAlt)]
  const margin = Math.min(width, height) * edgeMarginRatio

  const sx = Math.floor(width * searchRegion.left)
  const sy = Math.floor(height * searchRegion.top)
  const ex = Math.floor(width * searchRegion.right)
  const ey = Math.floor(height * searchRegion.bottom)

  // ── 第一步：扫描所有绿色三角 ──
  const anchors = findMarkerAnchors(
    data, width, height, sx, sy, ex, ey,
    markerColor, markerColorTolerance, minMarkerClusterSize,
  )

  if (anchors.length < 2) {
    return { cells: [], skipped: [], anchors: [], searchRegion: { sx, sy, ex, ey } }
  }

  // ── 第二步：分析网格结构（行分组 + 间距）──
  const rowGroups = clusterAnchorsByRow(anchors)
  const validRows = filterValidRows(rowGroups, gridColumns)

  if (validRows.length === 0) {
    return { cells: [], skipped: [], anchors, searchRegion: { sx, sy, ex, ey } }
  }

  const colSpacing = computeRobustColSpacing(validRows)
  const rowSpacing = computeRobustRowSpacing(validRows, colSpacing)

  // ── 第三步：用颜色精调格子边界 ──
  const template = buildPreciseTemplate(
    data, width, height, validRows, colSpacing, rowSpacing,
    cellColors, cellColorTolerance, qtyBarColor, quantityBarColorTolerance,
  )

  if (!template || template.width <= 0 || template.height <= 0) {
    return { cells: [], skipped: [], anchors, searchRegion: { sx, sy, ex, ey } }
  }

  // ── 第四步：生成所有格子 ──
  const gridOrigin = computeGridOrigin(validRows, template, colSpacing, gridColumns)
  const cells = []
  const skipped = []

  // 收集需要生成格子的行：原始有效行 + 上下各扩展一行
  const rowToOrigIdx = new Map()
  rowGroups.forEach((row, i) => rowToOrigIdx.set(row, i))
  const keptIndices = validRows.map(r => rowToOrigIdx.get(r.row)).filter(i => i != null).sort((a, b) => a - b)

  /** @type {Array<{ row: Array, rowIndex: number }>} */
  const rowsToGenerate = validRows.map(r => ({ row: r.row, rowIndex: r.rowIndex }))
  if (keptIndices.length > 0) {
    const minI = keptIndices[0]
    const maxI = keptIndices[keptIndices.length - 1]

    // 上方相邻行
    if (minI > 0 && rowGroups[minI - 1].length >= 1) {
      rowsToGenerate.push({ row: rowGroups[minI - 1], rowIndex: -1 })
    }
    // 下方相邻行
    if (maxI < rowGroups.length - 1 && rowGroups[maxI + 1].length >= 1) {
      rowsToGenerate.push({ row: rowGroups[maxI + 1], rowIndex: validRows.length })
    }
  }

  for (const { row, rowIndex } of rowsToGenerate) {
    const rowY = gridOrigin.y + rowIndex * rowSpacing

    for (let col = 0; col < gridColumns; col++) {
      const x = gridOrigin.x + col * colSpacing
      const y = rowY

      const rect = { x: Math.round(x), y: Math.round(y), width: template.width, height: template.height }

      if (!isCompleteCell(rect, width, height, margin)) {
        skipped.push({ rect, reason: '格子不完整或被裁切', row: rowIndex, col })
        continue
      }

      // 验证该位置确实有背包格（检查数量条）
      const hasBar = validateCellHasBar(
        data, width, rect, qtyBarColor, quantityBarColorTolerance,
      )

      if (!hasBar) {
        skipped.push({ rect, reason: '未检测到数量条（可能为空位或非物品格）', row: rowIndex, col })
        continue
      }

      cells.push({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        row: rowIndex,
        col,
        cx: rect.x + rect.width / 2,
        cy: rect.y + rect.height / 2,
        hasMarker: true,
      })
    }
  }

  return {
    cells,
    skipped,
    anchors,
    template,
    grid: { origin: gridOrigin, colSpacing, rowSpacing },
    searchRegion: { sx, sy, ex, ey },
  }
}

// ─── 颜色工具 ───────────────────────────────────────────────

export function parseHex(hex) {
  const h = hex.replace('#', '')
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

function colorDist(r, g, b, c) {
  return Math.hypot(r - c.r, g - c.g, b - c.b)
}

function getRgb(data, width, x, y) {
  if (x < 0 || y < 0 || x >= width) return { r: 0, g: 0, b: 0 }
  const imgH = data.length / (width * 4)
  if (y >= imgH) return { r: 0, g: 0, b: 0 }
  const i = (y * width + x) * 4
  return { r: data[i], g: data[i + 1], b: data[i + 2] }
}

export function isColorPixel(data, width, x, y, color, tol) {
  if (x < 0 || y < 0 || x >= width) return false
  const imgH = data.length / (width * 4)
  if (y >= imgH) return false
  const { r, g, b } = getRgb(data, width, x, y)
  return colorDist(r, g, b, color) < tol
}

function isCellBgPixel(data, width, x, y, cellColors, tol) {
  return cellColors.some((c) => isColorPixel(data, width, x, y, c, tol))
}

// ─── 第一步：绿色三角检测 ──────────────────────────────────

export function findMarkerAnchors(data, width, imgH, sx, sy, ex, ey, markerColor, tol, minSize) {
  const visited = new Uint8Array(width * imgH)
  const clusters = []

  // 跳步扫描加速（每 2 像素采样）
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

  // 按像素数降序去重：保留最大的，去掉附近的重复标记
  clusters.sort((a, b) => b.count - a.count)
  const kept = []
  for (const c of clusters) {
    if (kept.some((k) => {
      const dx = k.minX - c.minX
      const dy = k.minY - c.minY
      // 同一格子内的三角只保留一个
      return Math.abs(dx) < 40 && Math.abs(dy) < 40
    })) continue
    kept.push(c)
  }

  kept.sort((a, b) => a.minY - b.minY || a.minX - b.minX)
  return kept
}

// ─── 第二步：行分组 ──────────────────────────────────────────

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

/**
 * 过滤出有效行：至少有 half 列以上的标记
 */
function filterValidRows(rowGroups, gridColumns) {
  return rowGroups
    .map((row, idx) => ({ row, rowIndex: idx, count: row.length, avgY: row.reduce((s, a) => s + a.minY, 0) / row.length }))
    .filter((r) => r.count >= Math.max(3, Math.floor(gridColumns * 0.5)))
    .sort((a, b) => a.avgY - b.avgY)
    .map((r, idx) => ({ ...r, rowIndex: idx }))
}

/**
 * 鲁棒的列间距计算：使用直方图众数
 */
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

  // 使用直方图找最常见的间距区间
  const sorted = allSpacings.sort((a, b) => a - b)
  const minS = sorted[0]
  const maxS = sorted[sorted.length - 1]

  // 以 5 像素为桶建立直方图
  const bucketSize = 5
  const numBuckets = Math.ceil((maxS - minS) / bucketSize) + 1
  const buckets = new Array(numBuckets).fill(0)

  for (const s of allSpacings) {
    const b = Math.floor((s - minS) / bucketSize)
    buckets[b]++
  }

  // 找到最大的桶
  let bestBucket = 0
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i] > buckets[bestBucket]) bestBucket = i
  }

  // 取该桶内所有值的平均
  const bucketStart = minS + bestBucket * bucketSize
  const bucketEnd = bucketStart + bucketSize
  const valuesInBucket = allSpacings.filter((s) => s >= bucketStart && s < bucketEnd)
  const avg = valuesInBucket.reduce((s, v) => s + v, 0) / valuesInBucket.length

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

// ─── 第三步：用颜色精调格子边界 ──────────────────────────────

/**
 * 构建格子模板
 *
 * 核心逻辑：
 * - 绿三角标记在每格左上角，相邻三角间距 = 格子视觉宽度 + 间隙宽度
 * - 抽样测量实际格子视觉宽度（用 #F3EDDD 右边界扫描），取中位数
 * - 所有格子尺寸统一、间隙等宽，模板只计算一次
 * - 用 #272727 数量条验证格子高度是否合理
 */
function buildPreciseTemplate(data, width, height, validRows, colSpacing, rowSpacing, cellColors, cellTol, qtyColor, qtyTol) {
  // ── 测量实际格子视觉宽度（从绿三角到 #F3EDDD 右边界）──
  const measuredWidths = []
  const sampleRows = validRows.slice(0, Math.min(validRows.length, 3))

  for (const row of sampleRows) {
    // 每行取前几个格子（避开可能的边缘异常）
    const sampleAnchors = row.row.slice(0, Math.min(row.row.length, 4))
    for (const anchor of sampleAnchors) {
      const rightEdge = findCellRightEdge(
        data, width, anchor.minX, anchor.minY, colSpacing, cellColors, cellTol,
      )
      const cellW = rightEdge - anchor.minX + 1
      // 合理范围：colSpacing 的 65%~100%（小于 colSpacing 说明有间隙）
      if (cellW >= colSpacing * 0.65 && cellW <= colSpacing) {
        measuredWidths.push(cellW)
      }
    }
  }

  let cellSize
  if (measuredWidths.length >= 2) {
    cellSize = Math.round(median(measuredWidths))
  } else {
    // 回退：假设间隙约占 8%，格子占 92%
    cellSize = Math.round(colSpacing * 0.92)
  }

  // ── 用数量条验证格子高度 ──
  let barCheckOk = 0
  let barCheckTotal = 0

  for (const row of validRows.slice(0, Math.min(validRows.length, 4))) {
    if (row.row.length === 0) continue
    const anchor = row.row[0]
    barCheckTotal++

    const barBottom = findQuantityBarBottom(
      data, width, anchor.minX, anchor.minX + cellSize - 1,
      anchor.minY, colSpacing, qtyColor, qtyTol,
    )
    if (barBottom != null) {
      const measuredH = barBottom - anchor.minY + 1
      // 高度应在 cellSize 附近 (±25%)
      if (measuredH >= cellSize * 0.75 && measuredH <= cellSize * 1.15) {
        barCheckOk++
      }
    }
  }

  return {
    width: cellSize,
    height: cellSize,
    colSpacing,
    measuredWidths: measuredWidths.length,
    samples: barCheckTotal,
    barChecksPassed: barCheckOk,
  }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

/**
 * 从三角位置向右扫描，找到 #F4EEE0 背景色的右边界
 *
 * 扫描策略：
 * - 以绿三角间距 colSpacing 为参考，在这个范围内找 #F4EEE0 → #272727 的过渡
 * - 寻找 cell 背景色占比急剧下降的位置（即格子间隙的起点）
 * - 搜索范围限制在 colSpacing * 1.15 内，避免扫到相邻格子
 */
function findCellRightEdge(data, width, ax, ay, colSpacing, cellColors, tol) {
  const searchStart = ax + Math.round(colSpacing * 0.65)
  const searchEnd = ax + Math.round(colSpacing * 1.15)

  // 在图标区域中部采样（避开边缘阴影和圆角）
  const sampleTop = ay + Math.round(colSpacing * 0.15)
  const sampleBottom = ay + Math.round(colSpacing * 0.40)

  // 计算每列的 cell 背景色占比
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

  // 找最大下降点：ratio 从高位跌落到低位的位置即为右边界
  const maxRatio = Math.max(...ratios.map((r) => r.ratio))
  const dropThreshold = maxRatio * 0.4

  let rightEdge = ax + Math.round(colSpacing * 0.85)
  let foundDrop = false

  for (let i = 1; i < ratios.length; i++) {
    if (ratios[i - 1].ratio >= dropThreshold && ratios[i].ratio < dropThreshold) {
      rightEdge = ratios[i - 1].x
      foundDrop = true
      break
    }
  }

  // 没找到明显跌落 → 格子可能延伸到 colSpacing 边界，或该列是最后一列
  // 用 colSpacing 作为宽度（绿三角间距 = 格子宽度）
  if (!foundDrop) {
    rightEdge = ax + Math.round(colSpacing) - 1
  }

  return Math.min(rightEdge, ax + Math.round(colSpacing * 1.12))
}

/**
 * 在格子底部扫描 #272727 数量条，返回条的底边 y 坐标
 * 在 colSpacing 宽度内逐行扫描，找最深色条的最底部
 */
function findQuantityBarBottom(data, width, leftEdge, rightEdge, ay, colSpacing, qtyColor, tol) {
  const searchTop = ay + Math.round(colSpacing * 0.55)
  const searchBottom = ay + Math.round(colSpacing * 1.25)

  const x0 = leftEdge + Math.round((rightEdge - leftEdge) * 0.04)
  const x1 = rightEdge - Math.round((rightEdge - leftEdge) * 0.04)

  // 找最长的连续深色横条
  let inBar = false
  let barTop = -1
  let barBottom = -1
  let bestBarBottom = -1
  let longestRun = 0
  let currentRunStart = -1

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
        barTop = y
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

  // 处理最后的连续段
  if (inBar) {
    const runLength = barBottom - currentRunStart
    if (runLength > longestRun) {
      bestBarBottom = barBottom
    }
  }

  return bestBarBottom > 0 ? bestBarBottom : null
}

// 旧接口兼容
export function findQuantityBar(data, width, left, top, cellW, colSpacing, qtyColor, tol) {
  const w = cellW || colSpacing
  const searchTop = top + Math.floor(colSpacing * 0.55)
  const searchBottom = top + Math.floor(colSpacing * 1.25)
  const x0 = left + Math.floor(w * 0.04)
  const x1 = left + Math.floor(w * 0.96)

  const runs = []
  let runStart = null
  let runMaxRatio = 0

  for (let y = searchTop; y < searchBottom; y++) {
    let bar = 0
    let n = 0
    for (let x = x0; x < x1; x++) {
      if (isColorPixel(data, width, x, y, qtyColor, tol)) bar++
      n++
    }
    const ratio = n ? bar / n : 0

    if (ratio >= 0.25) {
      if (runStart == null) runStart = y
      runMaxRatio = Math.max(runMaxRatio, ratio)
    } else if (runStart != null) {
      runs.push({ top: runStart, bottom: y, length: y - runStart, confidence: runMaxRatio })
      runStart = null
      runMaxRatio = 0
    }
  }

  if (runStart != null) {
    runs.push({ top: runStart, bottom: searchBottom, length: searchBottom - runStart, confidence: runMaxRatio })
  }

  if (!runs.length) return null
  runs.sort((a, b) => b.length - a.length || b.top - a.top)
  return runs[0]
}

// ─── 第四步：生成格子 ────────────────────────────────────────

function computeGridOrigin(validRows, template, colSpacing, gridColumns) {
  // 找到最左边列的 X 坐标（对齐到网格）
  const allAnchors = validRows.flatMap((r) => r.row)
  const minX = Math.min(...allAnchors.map((a) => a.minX))
  const minY = Math.min(...allAnchors.map((a) => a.minY))

  // 对齐：确保 col 0 对应最左列的标记
  const leftmostAnchors = allAnchors
    .filter((a) => Math.abs(a.minX - minX) < colSpacing * 0.5)

  const alignedX = leftmostAnchors.length > 0
    ? Math.round(leftmostAnchors.reduce((s, a) => s + a.minX, 0) / leftmostAnchors.length)
    : minX

  return { x: alignedX, y: minY }
}

function validateCellHasBar(data, width, rect, qtyColor, tol) {
  const result = findQuantityBar(data, width, rect.x, rect.y, rect.width, rect.width, qtyColor, tol)
  return result != null
}

// ─── 通用工具 ────────────────────────────────────────────────

function isCompleteCell(rect, imgW, imgH, margin) {
  return (
    rect.x >= margin &&
    rect.y >= margin &&
    rect.x + rect.width <= imgW - margin &&
    rect.y + rect.height <= imgH - margin
  )
}

function median(values) {
  const arr = values.filter((v) => v != null && !Number.isNaN(v))
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// ─── 导出：提取格子内的图标区和数量条 ──────────────────────

export function extractCellRegions(imageData, cell, _settings = {}) {
  const { x, y, width, height } = cell

  // 数量条区域：固定在格子底部，宽度 = 格子宽，高度约占格子 22%
  const qtyTop = Math.round(y + height * 0.78)
  const qtyBottom = Math.round(y + height * 0.99)
  const qtyLeft = x
  const qtyRight = x + width

  // 图标区域：格子上部，左右各留 8% 边距避开圆角，下边界紧贴数量条上方
  const iconTop = Math.round(y + height * 0.06)
  const iconBottom = Math.max(iconTop + 4, qtyTop - 2)
  const iconLeft = Math.round(x + width * 0.08)
  const iconRight = Math.round(x + width * 0.92)

  return {
    iconRegion: cropRegion(imageData, iconLeft, iconTop, iconRight - iconLeft, iconBottom - iconTop),
    quantityRegion: cropRegion(imageData, qtyLeft, qtyTop, qtyRight - qtyLeft, qtyBottom - qtyTop),
    iconRect: { x: iconLeft, y: iconTop, width: iconRight - iconLeft, height: iconBottom - iconTop },
    qtyRect: { x: qtyLeft, y: qtyTop, width: qtyRight - qtyLeft, height: qtyBottom - qtyTop },
  }
}

function cropRegion(imageData, x, y, w, h) {
  w = Math.max(1, w)
  h = Math.max(1, h)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const src = document.createElement('canvas')
  src.width = imageData.width
  src.height = imageData.height
  src.getContext('2d').putImageData(imageData, 0, 0)
  ctx.drawImage(src, x, y, w, h, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}
