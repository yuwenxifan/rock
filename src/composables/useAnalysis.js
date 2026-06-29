import { loadConfig, clearConfigCache } from '../utils/config.js'
import { loadImage, imageToImageData } from '../utils/imageProcessing.js'
import { detectGridCells, extractCellRegions } from './useGridDetection.js'
import { loadReferenceHashes, clearReferenceCache, matchCellIcon, renderMaskPreview } from './useImageMatch.js'
import { recognizeQuantity } from './useOcr.js'
import { validateStage, computeDelta } from './useValidation.js'

/**
 * 分析单张截图
 */
async function analyzeScreenshot(file, screenshotIndex, refHashes, settings, items, stageLabel = '') {
  const img = await loadImage(file)
  const imageData = imageToImageData(img)
  const { cells, skipped } = detectGridCells(imageData, settings)

  const cellResults = []

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    const { iconRegion, quantityRegion } = extractCellRegions(imageData, cell, settings)
    const matchResult = matchCellIcon(iconRegion, refHashes, settings)
    const maskPreview = renderMaskPreview(iconRegion, settings)

    if (!matchResult.match) {
      // 即使匹配失败也跑 OCR，并保留候选列表供后续兜底填充
      const { quantity, rawText, confidence, ocrImageDataUrl, _debug } = await recognizeQuantity(quantityRegion)
      cellResults.push({
        screenshotIndex,
        row: cell.row,
        col: cell.col,
        rect: { x: cell.x, y: cell.y, width: cell.width, height: cell.height },
        itemName: null,
        quantity,
        ocrConfidence: confidence,
        ocrImageDataUrl,
        ocrDebug: _debug || null,
        warnings: [],
        skipped: false,
        hasMarker: cell.hasMarker,
        maskPreview,
        _candidates: matchResult.candidates,
        status: 'ignored',
      })
      continue
    }

    const { quantity, rawText, confidence, ocrImageDataUrl, _debug } = await recognizeQuantity(quantityRegion)
    const warnings = []

    if (matchResult.ambiguous) {
      const topN = matchResult.candidates.slice(0, 5)
        .map((c) => `${c.name}(${c.distance})`)
        .join('、')
      const more = matchResult.candidates.length > 5 ? `…等${matchResult.candidates.length}个` : ''
      warnings.push(
        `[${stageLabel}] 截图${screenshotIndex + 1} 格子[${cell.row},${cell.col}] 低置信度(${matchResult.match})：${topN}${more}`,
      )
    }

    if (quantity == null) {
      warnings.push(
        `[${stageLabel}] 截图${screenshotIndex + 1} 格子[${cell.row},${cell.col}] OCR 失败，原始文本：「${rawText || '空'}」, 置信度=${confidence}%`,
      )
    }

    cellResults.push({
      screenshotIndex,
      row: cell.row,
      col: cell.col,
      rect: { x: cell.x, y: cell.y, width: cell.width, height: cell.height },
      itemName: matchResult.match,
      quantity,
      ocrConfidence: confidence,
      ocrImageDataUrl,
      ocrDebug: _debug || null,
      histDistance: matchResult.distance,
      warnings,
      skipped: false,
      hasMarker: cell.hasMarker,
      maskPreview,
      status: quantity != null ? 'success' : 'failed',
    })
  }


  for (const s of skipped) {
    cellResults.push({
      screenshotIndex,
      row: s.row ?? -1,
      col: s.col ?? -1,
      rect: s.rect,
      itemName: null,
      quantity: null,
      warnings: [],
      skipped: true,
      skipReason: s.reason,
      status: 'skipped',
    })
  }

  // ── 兜底填充：相邻格均识别成功 → 该格也应纳入统计 ──
  fillGapCells(cellResults, screenshotIndex, stageLabel)

  return { cellResults, imageData, imageUrl: img.src, width: img.width, height: img.height }
}

/**
 * 兜底填充：如果 ignored 格子的左右相邻格均识别成功，
 * 则选取置信度最高且未被同截图其他格子使用的候选物品补入。
 */
function fillGapCells(cellResults, screenshotIndex, stageLabel) {
  const cellMap = new Map()
  for (const c of cellResults) {
    if (!c.skipped && c.row >= 0 && c.col >= 0) {
      cellMap.set(`${c.row},${c.col}`, c)
    }
  }

  const usedItems = new Set(
    cellResults.filter((c) => c.itemName && c.status === 'success').map((c) => c.itemName),
  )

  for (const cell of cellResults) {
    if (cell.status !== 'ignored' || cell.skipped) continue
    const candidates = cell._candidates
    if (!candidates || candidates.length === 0) continue

    const left = cellMap.get(`${cell.row},${cell.col - 1}`)
    const right = cellMap.get(`${cell.row},${cell.col + 1}`)
    if (!left || !right) continue
    if (left.status !== 'success' || right.status !== 'success') continue

    // 选置信度最高且未被同截图其他格子使用的物品
    const best = candidates.find((c) => !usedItems.has(c.name))
    if (!best) continue

    cell.itemName = best.name
    cell.histDistance = best.distance
    cell.status = cell.quantity != null ? 'success' : 'failed'
    usedItems.add(best.name)

    cell.warnings.push(
      `[${stageLabel}] 截图${screenshotIndex + 1} 格子[${cell.row},${cell.col}] 兜底补充：相邻格均识别成功，补入「${best.name}」`,
    )
  }
}

/**
 * 分析一个阶段（跑图前/后）
 */
export async function analyzeStage(files, onProgress, stageLabel = '') {
  const config = await loadConfig()
  const { items, settings } = config
  const refHashes = await loadReferenceHashes()

  const allCells = []
  const screenshotDebug = []
  const stageWarnings = []
  const recognized = []

  let processedCells = 0
  let totalCellsEstimate = files.length * 12

  for (let i = 0; i < files.length; i++) {
    const result = await analyzeScreenshot(files[i], i, refHashes, settings, items, stageLabel)
    allCells.push(...result.cellResults)
    screenshotDebug.push({
      index: i,
      imageUrl: result.imageUrl,
      width: result.width,
      height: result.height,
      cells: result.cellResults,
    })

    for (const cell of result.cellResults) {
      if (cell.warnings?.length) stageWarnings.push(...cell.warnings)
      if (cell.itemName && cell.quantity != null && !cell.skipped) {
        recognized.push({
          screenshotIndex: cell.screenshotIndex,
          itemName: cell.itemName,
          quantity: cell.quantity,
          row: cell.row,
          col: cell.col,
          histDistance: cell.histDistance,
        })
      }
    }

    processedCells += result.cellResults.length
    onProgress?.(Math.min(90, (processedCells / totalCellsEstimate) * 90))
  }

  const gridCells = allCells.filter((c) => !c.skipped && c.row >= 0)
  const validRecognized = recognized.filter((r) => r.itemName && r.quantity != null)

  if (gridCells.length === 0) {
    return {
      cells: allCells,
      totals: {},
      errors: [`[${stageLabel}] 未检测到有效格子，请确认截图为横屏背包材料分类页`],
      warnings: stageWarnings,
      screenshotDebug,
      blocked: true,
    }
  }

  const { totals, errors, warnings, conflictDetails, discarded } = validateStage(validRecognized, stageLabel)

  // 清除被 dedup 丢弃的 cell，避免 canvas 上仍显示两个识别结果
  for (const d of discarded) {
    const ss = screenshotDebug.find((s) => s.index === d.screenshotIndex)
    if (!ss) continue
    const cell = ss.cells.find((c) => c.row === d.row && c.col === d.col)
    if (cell) {
      cell.itemName = null
      cell.quantity = null
      cell.status = 'ignored'
    }
  }
  stageWarnings.push(...warnings)

  return {
    cells: allCells,
    totals,
    errors,
    warnings: stageWarnings,
    conflictDetails,
    screenshotDebug,
    blocked: errors.length > 0,
  }
}

/**
 * 完整分析流水线
 */
export async function runFullAnalysis(beforeFiles, afterFiles, onProgress) {
  clearReferenceCache()
  clearConfigCache()
  const config = await loadConfig()
  const { items } = config

  const hasBefore = beforeFiles.length > 0
  const hasAfter = afterFiles.length > 0
  const single = !hasBefore || !hasAfter

  onProgress?.('config', 5)

  let beforeResult = null
  let afterResult = null

  if (hasBefore) {
    onProgress?.('segment', 10)
    beforeResult = await analyzeStage(beforeFiles, (p) =>
      onProgress?.('match', 10 + p * (single ? 0.75 : 0.35)),
      '跑图前',
    )
  }

  if (hasAfter) {
    const base = single ? 10 : 50
    onProgress?.('ocr', base)
    afterResult = await analyzeStage(afterFiles, (p) =>
      onProgress?.('ocr', base + p * (single ? 0.75 : 0.35)),
      '跑图后',
    )
  }

  onProgress?.('validate', 88)

  const allErrors = []
  if (beforeResult?.blocked) allErrors.push(...beforeResult.errors)
  if (afterResult?.blocked) allErrors.push(...afterResult.errors)

  if (allErrors.length > 0) {
    onProgress?.('validate', 95)
    return {
      beforeResult,
      afterResult,
      delta: null,
      errors: allErrors,
      warnings: [...(beforeResult?.warnings || []), ...(afterResult?.warnings || [])],
      blocked: true,
    }
  }

  onProgress?.('compute', 95)
  const delta = computeDelta(
    beforeResult?.totals || null,
    afterResult?.totals || null,
    items,
  )

  onProgress?.('compute', 100)

  return {
    beforeResult,
    afterResult,
    delta,
    errors: [],
    warnings: [...(beforeResult?.warnings || []), ...(afterResult?.warnings || [])],
    blocked: false,
  }
}
