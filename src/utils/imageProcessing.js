/**
 * 裁掉 ImageData 的透明边距，返回裁剪后的 ImageData
 * 用于参考图预处理：去除透明 PNG 周围的大量空白
 */
export function trimTransparent(imageData, margin = 3) {
  const { data, width, height } = imageData
  let minX = width, minY = height, maxX = 0, maxY = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (minX > maxX || minY > maxY) return imageData

  const cropX = Math.max(0, minX - margin)
  const cropY = Math.max(0, minY - margin)
  const cropW = Math.min(width - cropX, maxX - minX + 1 + margin * 2)
  const cropH = Math.min(height - cropY, maxY - minY + 1 + margin * 2)

  const canvas = document.createElement('canvas')
  canvas.width = cropW
  canvas.height = cropH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = width
  srcCanvas.height = height
  srcCanvas.getContext('2d').putImageData(imageData, 0, 0)
  ctx.drawImage(srcCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
  return ctx.getImageData(0, 0, cropW, cropH)
}

/**
 * 加载图片为 HTMLImageElement
 * @param {string | Blob | File} source
 */
export function loadImage(source) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    if (source instanceof Blob) {
      img.src = URL.createObjectURL(source)
    } else {
      img.src = source
    }
  })
}

/**
 * 从 Image/Blob 创建 ImageData
 * @param {HTMLImageElement} img
 * @param {number} [maxWidth] 可选缩放上限
 * @param {string} [backgroundColor] 透明 PNG 合成底色（参考图需与游戏格子背景一致）
 */
export function imageToImageData(img, maxWidth, backgroundColor) {
  let { width, height } = img
  if (maxWidth && width > maxWidth) {
    height = Math.round((height * maxWidth) / width)
    width = maxWidth
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (backgroundColor) {
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(img, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

/**
 * 裁剪区域为 ImageData
 */
export function cropImageData(imageData, x, y, w, h) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.putImageData(imageData, -x, -y)
  return ctx.getImageData(0, 0, w, h)
}

/**
 * 用颜色遮罩替换指定颜色像素 —— 将图标区的背景色/纹路色/角标色
 * 替换为统一参考底色，使格子图标区与参考图"非图标区域"保持一致
 * @param {ImageData} imageData
 * @param {string[]} maskHexes - 要遮罩的颜色列表（如 ['#F4EEE0', '#EAD7B7', '#5E9F0F']）
 * @param {string} replacementHex - 替换目标颜色
 * @param {number} tolerance - 颜色容差
 * @returns {ImageData} 修改后的 ImageData（直接修改入参，同时返回引用）
 */
export function maskColors(imageData, maskHexes, replacementHex, tolerance = 45) {
  if (!maskHexes || maskHexes.length === 0) return imageData

  const targets = maskHexes.map(parseHex)
  const rep = parseHex(replacementHex)
  const pixels = imageData.data

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
    for (const t of targets) {
      if (colorDist(r, g, b, t) < tolerance) {
        pixels[i] = rep.r
        pixels[i + 1] = rep.g
        pixels[i + 2] = rep.b
        break
      }
    }
  }

  return imageData
}

function parseHex(hex) {
  const h = hex.replace('#', '')
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

function colorDist(r, g, b, c) {
  return Math.hypot(r - c.r, g - c.g, b - c.b)
}

/**
 * ImageData 转灰度 Float32Array（用于 NCC 模板匹配）
 */
export function imageDataToGrayArray(imageData) {
  const { data, width, height } = imageData
  const gray = new Float32Array(width * height)
  for (let i = 0; i < gray.length; i++) {
    const j = i * 4
    gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
  }
  return { data: gray, width, height }
}

/**
 * 灰度图缩放（用 canvas 双线性插值）
 * @returns {{ data: Float32Array, width: number, height: number }}
 */
export function resizeGrayArray(gray, newW, newH) {
  const canvas = document.createElement('canvas')
  canvas.width = gray.width
  canvas.height = gray.height
  const ctx = canvas.getContext('2d')
  const imgData = ctx.createImageData(gray.width, gray.height)
  for (let i = 0; i < gray.data.length; i++) {
    const j = i * 4
    const v = Math.round(gray.data[i])
    imgData.data[j] = imgData.data[j + 1] = imgData.data[j + 2] = v
    imgData.data[j + 3] = 255
  }
  ctx.putImageData(imgData, 0, 0)

  const resizedCanvas = document.createElement('canvas')
  resizedCanvas.width = newW
  resizedCanvas.height = newH
  const rctx = resizedCanvas.getContext('2d')
  rctx.drawImage(canvas, 0, 0, newW, newH)
  const resized = rctx.getImageData(0, 0, newW, newH)

  const result = new Float32Array(newW * newH)
  for (let i = 0; i < result.length; i++)
    result[i] = resized.data[i * 4]
  return { data: result, width: newW, height: newH }
}

/**
 * NCC 模板匹配得分（在目标图上滑动模板，返回最佳匹配分数）
 * 归一化互相关，范围 -1~1，1 为完全匹配
 */
export function nccTemplateScore(targetGray, tplGray) {
  const tw = tplGray.width, th = tplGray.height
  const tSize = tw * th
  if (tw > targetGray.width || th > targetGray.height) return -1

  // 预计算模板统计量
  let tSum = 0
  for (let i = 0; i < tSize; i++) tSum += tplGray.data[i]
  const tMean = tSum / tSize
  const tDiff = new Float32Array(tSize)
  let tNormSq = 0
  for (let i = 0; i < tSize; i++) {
    tDiff[i] = tplGray.data[i] - tMean
    tNormSq += tDiff[i] * tDiff[i]
  }
  const tNorm = Math.sqrt(tNormSq)
  if (tNorm < 1e-8) return 0

  const td = targetGray.data, tpd = tplGray.data
  const tW = targetGray.width

  let bestNCC = -1

  for (let y = 0; y <= targetGray.height - th; y++) {
    for (let x = 0; x <= targetGray.width - tw; x++) {
      // 计算目标 patch 均值
      let iSum = 0
      for (let ty = 0; ty < th; ty++) {
        const rowOff = (y + ty) * tW + x
        for (let tx = 0; tx < tw; tx++) iSum += td[rowOff + tx]
      }
      const iMean = iSum / tSize

      // 计算 NCC
      let num = 0, iNormSq = 0
      for (let ty = 0; ty < th; ty++) {
        const rowOff = (y + ty) * tW + x
        const tOff = ty * tw
        for (let tx = 0; tx < tw; tx++) {
          const iDiff = td[rowOff + tx] - iMean
          num += iDiff * tDiff[tOff + tx]
          iNormSq += iDiff * iDiff
        }
      }

      const ncc = num / (tNorm * Math.sqrt(iNormSq) + 1e-10)
      if (ncc > bestNCC) bestNCC = ncc
    }
  }

  return bestNCC
}

/**
 * 多尺度 NCC：尝试多个缩放比例，返回最佳得分
 */
export function multiScaleNCC(targetGray, tplGray, scales = [0.3, 0.4, 0.5]) {
  let bestScore = -1
  for (const s of scales) {
    const sw = Math.max(8, Math.round(tplGray.width * s))
    const sh = Math.max(8, Math.round(tplGray.height * s))
    if (sw > targetGray.width || sh > targetGray.height) continue
    const scaled = resizeGrayArray(tplGray, sw, sh)
    const score = nccTemplateScore(targetGray, scaled)
    if (score > bestScore) bestScore = score
  }
  return bestScore
}

/**
 * 四边洪水填充 —— 消除裁切区域边界噪点
 *
 * 背包格子是圆角矩形，矩形裁切边角可能包含格子间隙像素，
 * 二值化反转后变成黑块。从图像四边出发 flood-fill，
 * 把所有连通到边界的黑色像素洗白。真正的文字在中间，四周有白底隔离。
 *
 * @param {Uint8ClampedArray} pixels - RGBA 像素数据（原地修改）
 * @param {number} w - 宽度
 * @param {number} h - 高度
 */
function floodFillEdges(pixels, w, h) {
  const visited = new Uint8Array(w * h)
  const stack = []

  // 收集四边所有黑色像素作为种子
  // 顶边 & 底边
  for (let x = 0; x < w; x++) {
    if (pixels[x * 4] === 0 && !visited[x]) {
      visited[x] = 1; stack.push([x, 0])
    }
    const bi = (h - 1) * w + x
    if (pixels[bi * 4] === 0 && !visited[bi]) {
      visited[bi] = 1; stack.push([x, h - 1])
    }
  }
  // 左边 & 右边（跳过已处理的角）
  for (let y = 1; y < h - 1; y++) {
    const li = y * w
    if (pixels[li * 4] === 0 && !visited[li]) {
      visited[li] = 1; stack.push([0, y])
    }
    const ri = y * w + (w - 1)
    if (pixels[ri * 4] === 0 && !visited[ri]) {
      visited[ri] = 1; stack.push([w - 1, y])
    }
  }

  // 一次 BFS 统一填充
  while (stack.length > 0) {
    const [x, y] = stack.pop()
    const j = (y * w + x) * 4
    pixels[j] = pixels[j + 1] = pixels[j + 2] = 255

    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const ni = ny * w + nx
      if (visited[ni]) continue
      if (pixels[ni * 4] !== 0) continue
      visited[ni] = 1
      stack.push([nx, ny])
    }
  }
}

/**
 * 数量条 OCR 预处理：放大 + 二值化翻转 + 洪水填充 + 形态学平滑（黑字白底）
 *
 *  1. 放大到目标高度 96px
 *  2. 灰度 + 对比度拉伸 + 二值化反转
 *  3. 四边洪水填充：消除圆角格子边界噪点
 *  4. 形态学平滑：小半径模糊 + 重阈值化，消除锯齿、统一笔画粗细
 */
export function preprocessQuantityBar(imageData, options = {}) {
  const { srcW = imageData.width, srcH = imageData.height } = {
    srcW: imageData.width,
    srcH: imageData.height,
  }

  // ── 计算放大倍率 ──
  const TARGET_HEIGHT = options.targetHeight ?? 96
  const scale = Math.max(2, Math.ceil(TARGET_HEIGHT / srcH))
  const dstW = srcW * scale
  const dstH = srcH * scale

  // ── 第 1 步：双线性插值放大（平滑抗锯齿边缘）──
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = srcW
  srcCanvas.height = srcH
  const srcCtx = srcCanvas.getContext('2d')
  srcCtx.putImageData(imageData, 0, 0)

  const scaledCanvas = document.createElement('canvas')
  scaledCanvas.width = dstW
  scaledCanvas.height = dstH
  const scaledCtx = scaledCanvas.getContext('2d', { willReadFrequently: true })
  scaledCtx.drawImage(srcCanvas, 0, 0, dstW, dstH)

  // ── 第 2 步：灰度 + 固定阈值二值化反转（不做对比度拉伸）──
  // 固定阈值确保所有格子的二值化结果一致，避免低对比度格子笔画变细
  const scaledData = scaledCtx.getImageData(0, 0, dstW, dstH)
  const pixels = scaledData.data
  const threshold = options.binarizeThreshold ?? 110

  for (let i = 0; i < dstW * dstH; i++) {
    const j = i * 4
    const lum = 0.299 * pixels[j] + 0.587 * pixels[j + 1] + 0.114 * pixels[j + 2]
    // 原图文字亮(>threshold)、底暗 → 反转：亮→黑(0)，暗→白(255)
    const val = lum > threshold ? 0 : 255
    pixels[j] = pixels[j + 1] = pixels[j + 2] = val
    pixels[j + 3] = 255
  }

  // ── 第 3 步：四边洪水填充消除 ──
  floodFillEdges(pixels, dstW, dstH)

  // ── 第 4 步：形态学平滑（消除锯齿、统一笔画粗细）──
  // 小半径模糊 + 重阈值化 = 形态学闭操作
  // 填平锯齿、连接断笔、统一粗细
  scaledCtx.putImageData(scaledData, 0, 0)
  morphologicalSmooth(scaledCtx, dstW, dstH)

  return scaledCanvas
}

/**
 * 形态学平滑：canvas 模糊 + 重阈值化
 * 对二值化图像做小半径高斯模糊再以阈值 128 重二值化，
 * 效果等价于形态学闭操作（先膨胀后腐蚀），消除锯齿、统一笔画粗细
 */
function morphologicalSmooth(ctx, w, h) {
  // 小半径模糊（2.5px 消除锯齿、统一粗细）
  ctx.filter = 'blur(2.5px)'
  ctx.drawImage(ctx.canvas, 0, 0)
  ctx.filter = 'none'

  // 重阈值化
  const imgData = ctx.getImageData(0, 0, w, h)
  const px = imgData.data
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i] < 128 ? 0 : 255
    px[i] = px[i + 1] = px[i + 2] = v
  }
  ctx.putImageData(imgData, 0, 0)
}

/**
 * Blob/File 转 base64
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * base64 转 Blob
 */
export function base64ToBlob(base64) {
  const [header, data] = base64.split(',')
  const mime = header.match(/:(.*?);/)[1]
  const binary = atob(data)
  const arr = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
