/**
 * 图像匹配 — 直方图交叉比对
 *
 * 双通道交叉验证，防止未配置物品被误识别：
 *   A. RGB 颜色直方图交集（64 bins）  — 颜色分布
 *   B. 边缘方向直方图交集（36 bins）  — 形状轮廓
 *
 * 匹配条件：加权得分达标 AND 与第二名的置信度差距达标 → 才接受
 *
 * 流程：
 * 1. 颜色遮罩（全局替换格子背景、纹理、角标色）
 * 2. 裁剪 5% 内边距 → contain 缩放至 128×128
 * 3. 计算加权得分（0.55 × 颜色 + 0.45 × 边缘）+ 置信度差距
 * 4. 双重过滤通过 → 匹配；任一不通过 → 视为未配置物品
 */

import { loadConfig, getImageUrl } from '../utils/config.js'
import { loadImage, imageToImageData, maskColors } from '../utils/imageProcessing.js'

let refCache = null

// ═══════════════════════════════════════════════════════════════
// 参考图加载（仅 screen/ 目录）
// ═══════════════════════════════════════════════════════════════

export async function loadReferenceHashes() {
  if (refCache) return refCache

  const config = await loadConfig()
  const settings = config.settings
  const refs = []

  for (const item of config.items) {
    const screenRef = await loadScreenRef(item.image, settings)
    if (screenRef) {
      refs.push({ name: item.name, ...screenRef, item })
    } else {
      console.warn(`[useImageMatch] 未找到截图参考图: ${item.name}`)
    }
  }

  refCache = refs
  return refs
}

async function loadScreenRef(imageName, settings) {
  const baseName = imageName.replace(/\.(png|jpg|jpeg)$/i, '')
  const extensions = ['.png', '.jpg', '.jpeg']

  for (const ext of extensions) {
    try {
      const url = getImageUrl('screen/' + baseName + ext)
      const img = await loadImage(url)
      const imageData = imageToImageData(img)
      return extractFeatures(imageData, settings)
    } catch { /* try next */ }
  }
  return null
}

// ═══════════════════════════════════════════════════════════════
// 特征提取
// ═══════════════════════════════════════════════════════════════

/**
 * 从 ImageData 提取全部特征：颜色 + 边缘直方图
 */
function extractFeatures(imageData, settings) {
  return processSquaredIcon(imageData, settings)
}

/**
 * 统一预处理管线：128×128 → 裁剪 5% → 遮罩 → contain 64×64 → 特征
 * 参考图和格子图标共用此函数
 */
function processSquaredIcon(imageData, settings) {
  const { data, width: imgW, height: imgH } = imageData

  // 裁剪 5% 内边距
  const cropMargin = Math.round(Math.min(imgW, imgH) * 0.05)
  const iconLeft = cropMargin
  const iconRight = imgW - cropMargin
  const iconTop = cropMargin
  const iconBottom = imgH - cropMargin
  const iw = iconRight - iconLeft
  const ih = iconBottom - iconTop

  if (iw <= 0 || ih <= 0) return null

  // 提取像素
  const pixels = new Uint8Array(iw * ih * 4)
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const si = ((iconTop + y) * imgW + (iconLeft + x)) * 4
      const di = (y * iw + x) * 4
      pixels[di] = data[si]
      pixels[di + 1] = data[si + 1]
      pixels[di + 2] = data[si + 2]
      pixels[di + 3] = 255
    }
  }

  // 颜色遮罩 — 全局替换背景色/纹理色/角标色
  const maskColorsList = [
    settings.cellBackgroundColor,
    settings.cellBackgroundColorAlt,
    settings.cellTextureColor,
    settings.cornerMarkerColor,
  ].filter(Boolean)
  const repHex = settings.refBackgroundColor || '#F3EDDF'

  if (maskColorsList.length > 0) {
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = iw
    tempCanvas.height = ih
    const tempCtx = tempCanvas.getContext('2d')
    const tempId = tempCtx.createImageData(iw, ih)
    tempId.data.set(pixels)
    maskColors(tempId, maskColorsList, repHex, settings.cellColorTolerance ?? 45)
    pixels.set(tempId.data)
  }

  // contain 缩放到 128×128
  const resized = resizeToCanvas(pixels, iw, ih, 128, 128, repHex)

  return {
    colorHist: buildColorHistogram(resized.data, 128 * 128, 64),
    edgeHist: buildEdgeHistogram(resized.data, 128, 128, 36),
  }
}

/**
 * 渲染遮罩预览：对图标区执行完整遮罩+预处理，输出可视化的 data URL
 * 展示实际参与直方图计算的图像轮廓
 */
export function renderMaskPreview(iconImageData, settings) {
  // 遮罩
  const maskColorsList = [
    settings.cellBackgroundColor,
    settings.cellBackgroundColorAlt,
    settings.cellTextureColor,
    settings.cornerMarkerColor,
  ].filter(Boolean)
  // 预览使用中灰填充，让图标轮廓清晰可见
  const previewBg = '#808080'
  const colorTol = settings.cellColorTolerance ?? 45

  const masked = maskColorsList.length > 0
    ? maskColors(iconImageData, maskColorsList, previewBg, colorTol)
    : iconImageData

  // contain 到 128×128
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = masked.width
  srcCanvas.height = masked.height
  srcCanvas.getContext('2d').putImageData(masked, 0, 0)

  const outCanvas = document.createElement('canvas')
  outCanvas.width = 128
  outCanvas.height = 128
  const octx = outCanvas.getContext('2d')
  octx.fillStyle = previewBg
  octx.fillRect(0, 0, 128, 128)
  const scale = Math.min(128 / masked.width, 128 / masked.height)
  const dw = Math.round(masked.width * scale)
  const dh = Math.round(masked.height * scale)
  const dx = Math.floor((128 - dw) / 2)
  const dy = Math.floor((128 - dh) / 2)
  octx.drawImage(srcCanvas, dx, dy, dw, dh)

  // 放大 3 倍以便观察
  const big = document.createElement('canvas')
  big.width = 384
  big.height = 384
  const bctx = big.getContext('2d')
  bctx.imageSmoothingEnabled = false
  bctx.drawImage(outCanvas, 0, 0, 384, 384)

  return big.toDataURL('image/png')
}

/**
 * 预处理格子图标：遮罩 → 模拟提取脚本的 128×128 contain → 与参考图走相同管线
 */
function preprocessCellIcon(iconImageData, settings) {
  const maskColorsList = [
    settings.cellBackgroundColor,
    settings.cellBackgroundColorAlt,
    settings.cellTextureColor,
    settings.cornerMarkerColor,
  ].filter(Boolean)
  const replacementColor = settings.refBackgroundColor || '#F3EDDF'
  const colorTol = settings.cellColorTolerance ?? 45

  const masked = maskColorsList.length > 0
    ? maskColors(iconImageData, maskColorsList, replacementColor, colorTol)
    : iconImageData

  // ── 模拟提取脚本：contain 到 128×128 正方形（与 screen/ 目录下参考图完全一致）──
  const EXTRACT_SIZE = 128
  const extCanvas = document.createElement('canvas')
  extCanvas.width = EXTRACT_SIZE
  extCanvas.height = EXTRACT_SIZE
  const extCtx = extCanvas.getContext('2d', { willReadFrequently: true })
  extCtx.fillStyle = replacementColor
  extCtx.fillRect(0, 0, EXTRACT_SIZE, EXTRACT_SIZE)
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = masked.width
  srcCanvas.height = masked.height
  srcCanvas.getContext('2d').putImageData(masked, 0, 0)
  const scale128 = Math.min(EXTRACT_SIZE / masked.width, EXTRACT_SIZE / masked.height)
  const dw128 = Math.round(masked.width * scale128)
  const dh128 = Math.round(masked.height * scale128)
  const dx128 = Math.floor((EXTRACT_SIZE - dw128) / 2)
  const dy128 = Math.floor((EXTRACT_SIZE - dh128) / 2)
  extCtx.drawImage(srcCanvas, dx128, dy128, dw128, dh128)
  const squared = extCtx.getImageData(0, 0, EXTRACT_SIZE, EXTRACT_SIZE)

  // ── 接下来与参考图走完全相同的管线 ──
  return processSquaredIcon(squared, settings)
}

// ═══════════════════════════════════════════════════════════════
// 匹配
// ═══════════════════════════════════════════════════════════════

export function matchCellIcon(iconImageData, refHashes, settings = {}) {
  // ── 预处理 ──
  const cell = preprocessCellIcon(iconImageData, settings)

  // ── 阈值 ──
  // 基于实际测试数据调优：
  //   已知正确匹配: histScore 0.856-0.935, gap 0.049-0.086
  //   未知物品误匹配: histScore 0.814-0.855, gap 0.001-0.021
  const histStrong = settings.screenStrongThreshold ?? 0.86
  const confidenceGap = settings.screenConfidenceGap ?? 0.03

  // ── 计算每个参考的得分 ──
  const candidates = []

  for (const ref of refHashes) {
    if (!ref.colorHist || !ref.edgeHist) continue

    const colorScore = histIntersect3(cell.colorHist, ref.colorHist)
    const edgeScore = histIntersect1(cell.edgeHist, ref.edgeHist)
    const histScore = 0.55 * colorScore + 0.45 * edgeScore

    candidates.push({
      name: ref.name,
      histScore,
      distance: Math.round((1 - histScore) * 1000) / 1000,
      item: ref.item,
    })
  }

  // 按 histScore 降序排列
  candidates.sort((a, b) => b.histScore - a.histScore)

  // ── 决策：histScore + gap 双重过滤 ──
  let match = null
  let distance = null
  let ambiguous = false

  if (candidates.length > 0) {
    const best = candidates[0]
    const second = candidates.length > 1 ? candidates[1] : null
    const gap = second ? best.histScore - second.histScore : 1.0

    if (best.histScore >= histStrong && gap >= confidenceGap) {
      match = best.name
      distance = best.distance
      ambiguous = second && gap < 0.03
      if (ambiguous && second) {
        console.warn(
          `[图像识别] 低置信度 (gap过小): "${best.name}" hist=${best.histScore.toFixed(3)} gap=${gap.toFixed(3)}`,
          `| 2nd: ${second.name}(${second.histScore.toFixed(3)})`,
        )
      }
    } else if (best.histScore >= 0.80) {
      console.warn(
        `[图像识别] 拒识 (低于阈值): "${best.name}" hist=${best.histScore.toFixed(3)} gap=${gap.toFixed(3)}`,
        `| 需 hist≥${histStrong} gap≥${confidenceGap}`,
        `| 2nd: ${second ? second.name + '(' + second.histScore.toFixed(3) + ')' : 'none'}`,
      )
    }
  }

  return {
    match,
    candidates: candidates.map(c => ({
      name: c.name,
      distance: c.distance,
    })),
    distance,
    ambiguous,
    // 调试信息
    _debug: candidates.length > 0 ? {
      best: candidates[0].name,
      histScore: Math.round(candidates[0].histScore * 1000) / 1000,
      gap: candidates.length > 1 ? Math.round((candidates[0].histScore - candidates[1].histScore) * 1000) / 1000 : 1,
    } : null,
  }
}

// ═══════════════════════════════════════════════════════════════
// 直方图工具
// ═══════════════════════════════════════════════════════════════

function buildColorHistogram(pixels, count, bins) {
  const hR = new Float32Array(bins)
  const hG = new Float32Array(bins)
  const hB = new Float32Array(bins)
  const binW = 256 / bins

  for (let i = 0; i < count; i++) {
    const j = i * 4
    hR[Math.min(bins - 1, Math.floor(pixels[j] / binW))]++
    hG[Math.min(bins - 1, Math.floor(pixels[j + 1] / binW))]++
    hB[Math.min(bins - 1, Math.floor(pixels[j + 2] / binW))]++
  }

  for (let i = 0; i < bins; i++) {
    hR[i] /= count; hG[i] /= count; hB[i] /= count
  }

  return [hR, hG, hB]
}

function buildEdgeHistogram(pixels, w, h, orientationBins) {
  const gray = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const j = i * 4
    gray[i] = 0.299 * pixels[j] + 0.587 * pixels[j + 1] + 0.114 * pixels[j + 2]
  }

  const hist = new Float32Array(orientationBins)
  const binWidth = Math.PI / orientationBins
  let totalMagnitude = 0

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx = -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)]
               - 2 * gray[y * w + (x - 1)] + 2 * gray[y * w + (x + 1)]
               - gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)]

      const gy = -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)]
               + gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)]

      const magnitude = Math.sqrt(gx * gx + gy * gy)
      if (magnitude < 5) continue

      let orientation = Math.atan2(gy, gx)
      if (orientation < 0) orientation += Math.PI

      const bin = Math.min(orientationBins - 1, Math.floor(orientation / binWidth))
      hist[bin] += magnitude
      totalMagnitude += magnitude
    }
  }

  if (totalMagnitude > 0) {
    for (let i = 0; i < orientationBins; i++) hist[i] /= totalMagnitude
  }

  return hist
}

function histIntersect3(h1, h2) {
  let inter = 0
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < h1[c].length; i++) {
      inter += Math.min(h1[c][i], h2[c][i])
    }
  }
  return inter / 3
}

function histIntersect1(h1, h2) {
  let inter = 0
  for (let i = 0; i < h1.length; i++) inter += Math.min(h1[i], h2[i])
  return inter
}

// ═══════════════════════════════════════════════════════════════
// 内部工具
// ═══════════════════════════════════════════════════════════════

function parseHex(hex) {
  const h = hex.replace('#', '')
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

function resizeToCanvas(pixels, srcW, srcH, dstW, dstH, bgHex) {
  const canvas = document.createElement('canvas')
  canvas.width = dstW
  canvas.height = dstH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  const bg = parseHex(bgHex)
  ctx.fillStyle = `rgb(${bg.r},${bg.g},${bg.b})`
  ctx.fillRect(0, 0, dstW, dstH)

  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = srcW
  srcCanvas.height = srcH
  const srcCtx = srcCanvas.getContext('2d')
  const imgData = srcCtx.createImageData(srcW, srcH)
  imgData.data.set(pixels)
  srcCtx.putImageData(imgData, 0, 0)

  // 保持宽高比，居中绘制
  const scale = Math.min(dstW / srcW, dstH / srcH)
  const dw = Math.round(srcW * scale)
  const dh = Math.round(srcH * scale)
  const dx = Math.floor((dstW - dw) / 2)
  const dy = Math.floor((dstH - dh) / 2)
  ctx.drawImage(srcCanvas, dx, dy, dw, dh)
  return ctx.getImageData(0, 0, dstW, dstH)
}

export function clearReferenceCache() {
  refCache = null
}
