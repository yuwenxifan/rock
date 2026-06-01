/**
 * OCR 识别模块
 *
 * 方案：投影分割 + 真实字符模板逐像素比对
 *  1. 预处理（放大 + 二值化反转 + 四边洪水填充）
 *  2. 垂直投影分割字符
 *  3. 每个切片与 11 个模板逐个像素比对，取最高匹配率
 */

import {
  preprocessQuantityBar,
  imageDataToGrayArray,
} from '../utils/imageProcessing.js'

const CHAR_SET = 'x0123456789'

// ═══════════════ 模板加载 ═══════════════

let realTemplates = null
let templatesLoading = false

function loadTemplateImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, img.width, img.height)
      const { data: gray, width, height } = imageDataToGrayArray(imageData)
      for (let i = 0; i < gray.length; i++) gray[i] = gray[i] < 128 ? 0 : 255
      resolve({ data: gray, width, height })
    }
    img.onerror = () => reject(new Error(`加载失败: ${url}`))
    img.src = url
  })
}

async function loadRealTemplates() {
  if (realTemplates) return realTemplates
  if (templatesLoading) {
    while (templatesLoading) await new Promise(r => setTimeout(r, 50))
    return realTemplates
  }
  templatesLoading = true
  try {
    const map = new Map()
    for (const ch of CHAR_SET) {
      const tpl = await loadTemplateImage(`/config/chars/${ch}.png`)
      map.set(ch, tpl)
    }
    realTemplates = map
  } catch (e) {
    realTemplates = null
  } finally {
    templatesLoading = false
  }
  return realTemplates
}
loadRealTemplates()

// ═══════════════ 合成模板（回退） ═══════════════

let cachedSynthetic = null

function renderChar(ch, h) {
  const w = Math.round(h * 0.7)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#000000'
  ctx.font = `bold ${Math.round(h * 0.85)}px Arial, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(ch, w / 2, h / 2)
  const imgData = ctx.getImageData(0, 0, w, h)
  const { data: gray, width, height } = imageDataToGrayArray(imgData)
  for (let i = 0; i < gray.length; i++) gray[i] = gray[i] < 128 ? 0 : 255
  return { data: gray, width, height }
}

function getSyntheticTemplates(h) {
  if (cachedSynthetic && cachedSynthetic.h === h) return cachedSynthetic.tpls
  const tpls = {}
  for (const ch of CHAR_SET) tpls[ch] = renderChar(ch, h)
  cachedSynthetic = { h, tpls }
  return tpls
}

// ═══════════════ 空洞计数 ═══════════════

/**
 * 计算二值化图像中白色空洞的数量（被黑像素包围的白像素连通区域）
 * 0,6,8,9 各有不同数量的空洞，可作为强特征
 */
function countHoles(gray) {
  const { data, width: w, height: h } = gray
  // 从四条边 flood-fill 白色背景，剩下的白色就是空洞
  const visited = new Uint8Array(w * h)
  const stack = []

  // 从四边白色像素开始 flood-fill
  for (let x = 0; x < w; x++) {
    if (data[x] !== 0 && !visited[x]) { visited[x] = 1; stack.push(x, 0) }
    const bi = (h - 1) * w + x
    if (data[bi] !== 0 && !visited[bi]) { visited[bi] = 1; stack.push(x, h - 1) }
  }
  for (let y = 1; y < h - 1; y++) {
    if (data[y * w] !== 0 && !visited[y * w]) { visited[y * w] = 1; stack.push(0, y) }
    const ri = y * w + w - 1
    if (data[ri] !== 0 && !visited[ri]) { visited[ri] = 1; stack.push(w - 1, y) }
  }

  // DFS flood-fill (iterative with manual stack)
  let si = 0
  while (si < stack.length) {
    const x = stack[si++], y = stack[si++]
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const ni = ny * w + nx
      if (visited[ni] || data[ni] === 0) continue
      visited[ni] = 1
      stack.push(nx, ny)
    }
  }

  // 未被访问的白色像素 = 空洞
  let holes = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (data[i] !== 0 && !visited[i]) {
        holes++
        // Flood-fill 这个洞
        const hs = [[x, y]]
        visited[i] = 1
        while (hs.length) {
          const [hx, hy] = hs.pop()
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = hx + dx, ny = hy + dy
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            const ni = ny * w + nx
            if (visited[ni] || data[ni] === 0) continue
            visited[ni] = 1
            hs.push([nx, ny])
          }
        }
      }
    }
  }

  return holes
}

// ═══════════════ 垂直紧裁剪 ═══════════════

/**
 * 找到灰度图中黑色像素的垂直范围，去掉上下白边
 */
function tightCropVertical(gray) {
  const { data, width: w, height: h } = gray
  let topY = h, bottomY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x] === 0) { topY = Math.min(topY, y); bottomY = Math.max(bottomY, y); break }
    }
  }
  if (topY > bottomY) return gray
  // 加 1px 边距
  const m = 1
  const cropY = Math.max(0, topY - m)
  const cropH = Math.min(h - cropY, bottomY - topY + 1 + m * 2)
  const cropped = new Float32Array(w * cropH)
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < w; x++) {
      cropped[y * w + x] = data[(cropY + y) * w + x]
    }
  }
  return { data: cropped, width: w, height: cropH }
}

// ═══════════════ 快速像素比对 ═══════════════

/**
 * 将模板缩放到指定高度（保持宽高比，纯数学缩放）
 */
function resizeTemplate(tpl, targetH) {
  const scale = targetH / tpl.height
  const tw = Math.round(tpl.width * scale)
  const th = targetH
  const data = new Float32Array(tw * th)
  for (let y = 0; y < th; y++) {
    const sy = Math.min(tpl.height - 1, Math.floor(y / scale))
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(tpl.width - 1, Math.floor(x / scale))
      data[y * tw + x] = tpl.data[sy * tpl.width + sx]
    }
  }
  return { data, width: tw, height: th }
}

/**
 * 模板在目标图上水平滑动，找最佳匹配率
 * 垂直方向居中（字符已在切片中垂直居中）
 * @returns {number} 0~1
 */
function slideMatch(target, tpl) {
  if (tpl.width > target.width || tpl.height > target.height) return 0

  const dy = Math.floor((target.height - tpl.height) / 2)
  const maxDx = target.width - tpl.width
  let bestScore = 0

  for (let dx = 0; dx <= maxDx; dx++) {
    let match = 0, total = 0
    for (let ty = 0; ty < tpl.height; ty++) {
      const tRow = ty * tpl.width
      const tgRow = (dy + ty) * target.width
      for (let tx = 0; tx < tpl.width; tx++) {
        const tv = tpl.data[tRow + tx]
        const tgv = target.data[tgRow + dx + tx]
        if (tv === 0 || tgv === 0) {
          total++
          if (tv === tgv) match++
        }
      }
    }
    if (total > 0) {
      const score = match / total
      if (score > bestScore) bestScore = score
    }
  }

  return bestScore
}

/**
 * 计算空洞中心垂直位置（用于区分 0/6/9）
 * @returns {number} 0~1，空洞中心偏上接近 0，偏下接近 1；无空洞返回 -1
 */
function holeCenterY(gray) {
  const { data, width: w, height: h } = gray
  const visited = new Uint8Array(w * h), stack = []
  // Flood fill background from edges
  for (let x = 0; x < w; x++) {
    if (data[x] !== 0 && !visited[x]) { visited[x] = 1; stack.push(x, 0) }
    const bi = (h-1)*w + x
    if (data[bi] !== 0 && !visited[bi]) { visited[bi] = 1; stack.push(x, h-1) }
  }
  for (let y = 1; y < h-1; y++) {
    if (data[y*w] !== 0 && !visited[y*w]) { visited[y*w] = 1; stack.push(0, y) }
    if (data[y*w+w-1] !== 0 && !visited[y*w+w-1]) { visited[y*w+w-1] = 1; stack.push(w-1, y) }
  }
  let si = 0
  while (si < stack.length) {
    const x = stack[si++], y = stack[si++]
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = x+dx, ny = y+dy
      if (nx<0||ny<0||nx>=w||ny>=h) continue
      const ni = ny*w + nx
      if (visited[ni] || data[ni] === 0) continue
      visited[ni] = 1; stack.push(nx, ny)
    }
  }
  // Find holes and compute their center
  let holeSumY = 0, holeCount = 0
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      const i = y*w + x
      if (data[i] !== 0 && !visited[i]) {
        const hs = [[x, y]]; visited[i] = 1
        let sy = 0, sn = 0
        while (hs.length) {
          const [hx, hy] = hs.pop(); sy += hy; sn++
          for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nx = hx+dx, ny = hy+dy
            if (nx<0||ny<0||nx>=w||ny>=h) continue
            const ni = ny*w + nx
            if (visited[ni] || data[ni] === 0) continue
            visited[ni] = 1; hs.push([nx, ny])
          }
        }
        holeSumY += sy / sn; holeCount++
      }
    }
  }
  return holeCount > 0 ? (holeSumY / holeCount) / h : -1
}

/**
 * 找到最佳匹配字符
 * 1. 空洞数过滤 → 2. 空洞位置（0/6/9）→ 3. Jaccard 匹配
 */
function matchBestChar(charGray, templates, whitelist) {
  const tw = charGray.width, th = charGray.height
  const targetHoles = countHoles(charGray)
  const targetHoleY = targetHoles === 1 ? holeCenterY(charGray) : -1

  let bestCh = '?'
  let bestScore = -1

  for (const [ch, tpl] of Object.entries(templates)) {
    if (!whitelist.includes(ch)) continue

    // 缓存模板特征
    const tplHoles = tpl.holes ?? (tpl.holes = countHoles(tpl))
    const tplHoleY = tplHoles === 1 ? (tpl.holeY ?? (tpl.holeY = holeCenterY(tpl))) : -1

    const scale = Math.min(th / tpl.height, tw / tpl.width)
    const scaledTpl = resizeTemplate(tpl, Math.round(tpl.height * scale))
    let score = slideMatch(charGray, scaledTpl)

    // 空洞数不匹配 → 软性扣分（笔画过细可能导致空洞消失，不硬跳）
    if (targetHoles !== tplHoles) {
      score *= 0.6  // 扣 40%
    }

    // 对于单空洞字符（0/6/9），用空洞位置调整分数
    if (targetHoles === 1 && tplHoles === 1 && targetHoleY >= 0 && tplHoleY >= 0) {
      const holeYDiff = Math.abs(targetHoleY - tplHoleY)
      const penalty = Math.min(0.8, holeYDiff * 3)
      score *= (1 - penalty)
    }

    if (score > bestScore) { bestScore = score; bestCh = ch }
  }

  return { ch: bestCh, score: bestScore }
}

// ═══════════════ 投影分割 ═══════════════

function verticalProjection(pixels, w, h) {
  const proj = new Uint32Array(w)
  for (let x = 0; x < w; x++) {
    let c = 0
    for (let y = 0; y < h; y++) if (pixels[(y * w + x) * 4] === 0) c++
    proj[x] = c
  }
  return proj
}

function segmentCharacters(canvas) {
  const ctx = canvas.getContext('2d')
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = imgData.data; const w = canvas.width; const h = canvas.height

  // 双重投影：全高 + 下半部分
  // 下半部分的黑像素必须完全为 0 才判定为真间隙
  // 避免 '0' '8' 等字符顶部空洞被误判为分割点
  const bottomStart = Math.floor(h * 0.4)
  const projFull = new Uint32Array(w)
  const projBottom = new Uint32Array(w)
  for (let x = 0; x < w; x++) {
    let cFull = 0, cBottom = 0
    for (let y = 0; y < h; y++) {
      if (pixels[(y * w + x) * 4] === 0) {
        cFull++
        if (y >= bottomStart) cBottom++
      }
    }
    projFull[x] = cFull
    projBottom[x] = cBottom
  }

  const thresh = Math.max(1, h * 0.08)
  const regions = []
  let inR = false, start = 0
  for (let x = 0; x < w; x++) {
    // 真间隙 = 全高投影低 且 下半部分没有黑像素
    const isGap = projFull[x] < thresh && projBottom[x] === 0
    if (!isGap && !inR) { inR = true; start = x }
    else if (isGap && inR) { inR = false; regions.push({ x: start, w: x - start }) }
  }
  if (inR) regions.push({ x: start, w: w - start })

  // 合并过近区域
  const merged = []
  for (const r of regions) {
    if (merged.length && r.x - (merged[merged.length - 1].x + merged[merged.length - 1].w) < 2) {
      merged[merged.length - 1].w = r.x + r.w - merged[merged.length - 1].x
    } else merged.push(r)
  }

  return merged.map(r => {
    let bc = 0
    for (let x = r.x; x < r.x + r.w; x++)
      for (let y = 0; y < h; y++)
        if (pixels[(y * w + x) * 4] === 0) bc++
    const density = bc / (r.w * h)
    return { ...r, density, isNoise: r.w < 4 || density < 0.005 || density > 0.95 }
  })
}

// ═══════════════ 主入口 ═══════════════

const OCR_DEBUG_ENABLED = (() => {
  try { return localStorage.getItem('rock_debug') === '1' } catch { return false }
})()

export function recognizeQuantity(quantityRegion) {
  const canvas = preprocessQuantityBar(quantityRegion)
  const ocrImageDataUrl = OCR_DEBUG_ENABLED ? canvas.toDataURL('image/png') : null

  const chars = segmentCharacters(canvas)
  const validChars = chars.filter(c => !c.isNoise)
  if (validChars.length === 0) return { quantity: null, rawText: '', confidence: 0, ocrImageDataUrl }

  // 获取模板（真实 > 合成）
  const tplH = Math.round(canvas.height * 0.8)
  let templates
  if (realTemplates && realTemplates.size === 11) {
    templates = Object.fromEntries(realTemplates)
  } else {
    templates = getSyntheticTemplates(tplH)
  }

  const ctx = canvas.getContext('2d')
  const results = []
  let totalScore = 0

  for (let i = 0; i < validChars.length; i++) {
    const { x: cx, w: cw } = validChars[i]

    // 提取字符区域，垂直紧裁剪去掉上下白边
    const charImgData = ctx.getImageData(cx, 0, cw, canvas.height)
    let cg = imageDataToGrayArray(charImgData)
    for (let j = 0; j < cg.data.length; j++) cg.data[j] = cg.data[j] < 128 ? 0 : 255
    cg = tightCropVertical(cg)  // 去掉上下白边

    const whitelist = i === 0 ? 'x' : '0123456789'
    const result = matchBestChar(cg, templates, whitelist)
    results.push({ index: i, ...result })
    totalScore += result.score
  }

  // 业务规则：x 后第一位不能是 0，重匹配排除 0
  if (results.length >= 2 && results[1].ch === '0') {
    const { x: cx, w: cw } = validChars[1]
    const charImgData = ctx.getImageData(cx, 0, cw, canvas.height)
    const cg = imageDataToGrayArray(charImgData)
    for (let j = 0; j < cg.data.length; j++) cg.data[j] = cg.data[j] < 128 ? 0 : 255
    const retry = matchBestChar(cg, templates, '123456789')
    if (retry.score > 0) {
      results[1] = { index: 1, ...retry }
    }
  }

  const allChars = results.map(r => r.ch).join('')

  const match = allChars.match(/x(\d+)/i)
  const quantity = match ? parseInt(match[1], 10) : null
  const confidence = results.length > 0 ? Math.round(totalScore / results.length * 100) : 0

  return { quantity, rawText: allChars, confidence, ocrImageDataUrl, _debug: OCR_DEBUG_ENABLED ? { results, charCount: validChars.length, segments: validChars.map(c => ({ x: c.x, w: c.w })) } : null }
}