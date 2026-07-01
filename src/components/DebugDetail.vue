<script setup>
import { ref, onMounted } from 'vue'

const BASE = import.meta.env.BASE_URL

const props = defineProps({
  beforeResult: { type: Object, default: null },
  afterResult: { type: Object, default: null },
})

const enabled = ref(false)

onMounted(() => {
  try { enabled.value = localStorage.getItem('rock_debug') === '1' } catch { /* ignore */ }
})

// ── 收集所有有 OCR 预处理图像的格子 ──
function getOcrCells(result) {
  const debug = result?.screenshotDebug
  if (!debug) return []
  const cells = []
  for (const info of debug) {
    for (const cell of (info.cells || [])) {
      if (cell.ocrImageDataUrl) cells.push({ ...cell, screenshotIndex: info.index })
    }
  }
  return cells
}

// ── 按截图+行分组 OCR 格子（用于 6 列背包布局）──
function groupOcrByRow(result) {
  const cells = getOcrCells(result)
  const byScreenshot = new Map()
  for (const c of cells) {
    const key = c.screenshotIndex
    if (!byScreenshot.has(key)) byScreenshot.set(key, [])
    byScreenshot.get(key).push(c)
  }
  const groups = []
  for (const [si, list] of byScreenshot) {
    const byRow = new Map()
    for (const c of list) {
      const rk = c.row
      if (!byRow.has(rk)) byRow.set(rk, [])
      byRow.get(rk).push(c)
    }
    const rows = []
    for (const [ri, rowCells] of byRow) {
      rowCells.sort((a, b) => a.col - b.col)
      rows.push({ rowIndex: ri, cells: rowCells })
    }
    rows.sort((a, b) => a.rowIndex - b.rowIndex)
    groups.push({ screenshotIndex: si, rows })
  }
  groups.sort((a, b) => a.screenshotIndex - b.screenshotIndex)
  return groups
}

// ── 收集有 OCR 调试信息的格子 ──
function getOcrDebugCells(result) {
  const debug = result?.screenshotDebug
  if (!debug) return []
  const cells = []
  for (const info of debug) {
    for (const cell of (info.cells || [])) {
      if (cell.ocrDebug) cells.push({ ...cell, screenshotIndex: info.index })
    }
  }
  return cells
}

// ── 收集有遮罩预览的格子 ──
function getMaskCells(result) {
  const debug = result?.screenshotDebug
  if (!debug) return []
  const cells = []
  for (const info of debug) {
    for (const cell of (info.cells || [])) {
      if (cell.maskPreview) cells.push({ ...cell, screenshotIndex: info.index })
    }
  }
  return cells
}

// ── 找出图像的垂直黑像素范围 ──
function findVerticalBounds(img) {
  try {
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const id = ctx.getImageData(0, 0, img.width, img.height)
    let top = img.height, bottom = 0
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (id.data[(y * img.width + x) * 4] < 128) { top = y; break }
      }
      if (top < img.height) break
    }
    for (let y = img.height - 1; y >= 0; y--) {
      for (let x = 0; x < img.width; x++) {
        if (id.data[(y * img.width + x) * 4] < 128) { bottom = y + 1; break }
      }
      if (bottom > 0) break
    }
    if (top >= bottom) return { top: 0, bottom: img.height }
    const m = Math.max(1, Math.round((bottom - top) * 0.1))
    return { top: Math.max(0, top - m), bottom: Math.min(img.height, bottom + m) }
  } catch {
    return { top: 0, bottom: img.height }
  }
}

const TPL_DISPLAY_H = 50
function drawCharCanvas(canvas, cell, charIdx) {
  if (!canvas || !cell.ocrImageDataUrl || !cell.ocrDebug?.segments) return
  const seg = cell.ocrDebug.segments[charIdx]
  if (!seg) return
  const img = new Image()
  img.onload = () => {
    const bounds = findVerticalBounds(img)
    const cropH = bounds.bottom - bounds.top
    if (cropH <= 0) return
    const scale = TPL_DISPLAY_H / cropH
    const ctx = canvas.getContext('2d')
    canvas.width = Math.round(seg.w * scale)
    canvas.height = TPL_DISPLAY_H
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, seg.x, bounds.top, seg.w, cropH, 0, 0, canvas.width, canvas.height)
  }
  img.src = cell.ocrImageDataUrl
}

function drawSegmentOverlay(canvas, cell) {
  if (!canvas || !cell.ocrImageDataUrl || !cell.ocrDebug?.segments) return
  const img = new Image()
  img.onload = () => {
    const bounds = findVerticalBounds(img)
    const cropH = bounds.bottom - bounds.top
    if (cropH <= 0) return
    const scale = 2
    const ctx = canvas.getContext('2d')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(cropH * scale)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, 0, bounds.top, img.width, cropH, 0, 0, canvas.width, canvas.height)
    const segs = cell.ocrDebug.segments
    ctx.strokeStyle = 'rgba(255,0,0,0.6)'
    ctx.lineWidth = 2
    ctx.setLineDash([4, 2])
    for (const seg of segs) {
      const sx = seg.x * scale
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, canvas.height); ctx.stroke()
      ctx.beginPath(); ctx.moveTo((seg.x + seg.w) * scale, 0); ctx.lineTo((seg.x + seg.w) * scale, canvas.height); ctx.stroke()
    }
    ctx.setLineDash([])
    const results = cell.ocrDebug.results || []
    ctx.textAlign = 'center'
    for (let i = 0; i < Math.min(results.length, segs.length); i++) {
      const midX = (segs[i].x + segs[i].w / 2) * scale
      const r = results[i]
      ctx.fillStyle = r.score > 0.7 ? '#1a7a1a' : r.score > 0.5 ? '#b8860b' : '#c00'
      ctx.font = 'bold 14px monospace'
      ctx.fillText(r.ch, midX, Math.max(14, canvas.height - 4))
    }
    ctx.textAlign = 'start'
  }
  img.src = cell.ocrImageDataUrl
}
</script>

<template>
  <div v-if="enabled" class="debug-detail">
    <template v-for="(result, stage) in [{ label: '跑图前', data: beforeResult }, { label: '跑图后', data: afterResult }]" :key="stage">
      <template v-if="result.data?.screenshotDebug?.length">
        <div class="stage-section">
          <h3>{{ result.label }}</h3>

          <!-- OCR 预处理图像 -->
          <details v-if="getOcrCells(result.data).length" class="ocr-gallery debug-section" open>
            <summary class="debug-section-title">OCR 预处理图像（放大 + 二值化翻转后，OCR实际使用的）</summary>
            <div v-for="group in groupOcrByRow(result.data)" :key="'ss-' + group.screenshotIndex" class="ocr-screenshot-block">
              <div class="ocr-ss-label">截图 {{ group.screenshotIndex + 1 }}</div>
              <div v-for="row in group.rows" :key="'r-' + group.screenshotIndex + '-' + row.rowIndex" class="ocr-row-block">
                <div class="ocr-row-label">行 {{ row.rowIndex }}</div>
                <div class="ocr-grid">
                  <div
                    v-for="cell in row.cells"
                    :key="`${cell.screenshotIndex}-${cell.row}-${cell.col}`"
                    class="ocr-cell"
                    :class="{ 'ocr-success': cell.status === 'success', 'ocr-failed': cell.status === 'failed' }"
                  >
                    <img :src="cell.ocrImageDataUrl" class="ocr-img" />
                    <div class="ocr-label">
                      <span v-if="cell.itemName" class="ocr-name">{{ cell.itemName }}</span>
                      <span v-else class="ocr-name ocr-unknown">?</span>
                      <span class="ocr-result">x{{ cell.quantity ?? '?' }}</span>
                      <span class="ocr-conf">({{ cell.ocrConfidence }}%)</span>
                    </div>
                    <div class="ocr-col">col {{ cell.col }}</div>
                  </div>
                </div>
              </div>
            </div>
          </details>

          <!-- 遮罩预览 -->
          <details v-if="getMaskCells(result.data).length" class="mask-gallery debug-section" open>
            <summary class="debug-section-title">遮罩预览 — 图标区颜色遮罩 + contain 128×128</summary>
            <div class="mask-grid">
              <div
                v-for="cell in getMaskCells(result.data)"
                :key="'mask-' + cell.screenshotIndex + '-' + cell.row + '-' + cell.col"
                class="mask-cell"
                :class="{ 'mask-success': cell.status === 'success', 'mask-failed': cell.status === 'failed', 'mask-ignored': cell.status === 'ignored' }"
              >
                <img :src="cell.maskPreview" class="mask-img" />
                <div class="mask-label">{{ cell.itemName || '未匹配' }} [{{ cell.row }},{{ cell.col }}]</div>
              </div>
            </div>
          </details>

          <!-- 模板匹配详情 -->
          <details v-if="getOcrDebugCells(result.data).length" class="match-debug debug-section" open>
            <summary class="debug-section-title">模板匹配详情 — 逐字符对比（红框=选中模板，分数=Jaccard重叠率）</summary>
            <div
              v-for="cell in getOcrDebugCells(result.data)"
              :key="'dbg-' + cell.screenshotIndex + '-' + cell.row + '-' + cell.col"
              class="match-cell"
            >
              <div class="match-header">
                <strong>{{ cell.itemName || '?' }}</strong>
                识别: x{{ cell.quantity ?? '?' }}
                [{{ cell.row }},{{ cell.col }}]
                <span v-if="cell.ocrDebug" class="match-method">({{ cell.ocrDebug.charCount }}字符)</span>
              </div>
              <div class="match-row">
                <div class="match-label">预处理</div>
                <canvas :ref="(el) => { if (el) drawSegmentOverlay(el, cell) }" class="match-seg-img" />
              </div>
              <div
                v-for="(r, ci) in (cell.ocrDebug?.results || [])"
                :key="'chr-' + ci"
                class="match-row"
              >
                <div class="match-label">#{{ ci }} → {{ r.ch }} <span class="match-score">({{ (r.score * 100).toFixed(0) }}%)</span></div>
                <div class="match-chars">
                  <canvas :ref="(el) => { if (el && cell.ocrImageDataUrl) drawCharCanvas(el, cell, ci) }" class="match-char-img" />
                  <span class="match-arrow">→</span>
                  <img :src="BASE + 'config/chars/' + r.ch + '.png'" class="match-tpl-img match-best" style="height:50px;width:auto" />
                </div>
              </div>
            </div>
          </details>
        </div>
      </template>
    </template>

    <div v-if="!beforeResult?.screenshotDebug?.length && !afterResult?.screenshotDebug?.length" class="empty-hint">
      暂无调试数据
    </div>
  </div>
</template>

<style scoped>
.debug-detail {
  margin-top: 16px;
}

.stage-section {
  margin-bottom: 24px;
}

.stage-section h3 {
  margin: 0 0 14px;
  font-size: 16px;
  color: #303133;
}

.empty-hint {
  color: #909399;
  font-size: 14px;
  text-align: center;
  padding: 24px;
}

/* ═══════ 折叠面板 ═══════ */
.debug-section {
  margin-bottom: 16px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  overflow: hidden;
}
.debug-section[open] {
  border-color: #d0d7de;
}
.debug-section-title {
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 600;
  color: #2c2c2c;
  cursor: pointer;
  background: #f5f7fa;
  user-select: none;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background 0.15s;
}
.debug-section-title::-webkit-details-marker {
  display: none;
}
.debug-section-title::before {
  content: '▸';
  display: inline-block;
  font-size: 10px;
  transition: transform 0.2s;
  color: #909399;
}
.debug-section[open] > .debug-section-title::before {
  transform: rotate(90deg);
}
.debug-section-title:hover {
  background: #ebeef5;
}
.debug-section > :not(summary) {
  padding: 0 16px;
}
.debug-section > :not(summary):last-child {
  padding-bottom: 16px;
}

/* ═══════ OCR 预处理图像画廊 ═══════ */
.ocr-gallery {
  margin-bottom: 20px;
}

.ocr-gallery h4 {
  margin: 0 0 14px 0;
  font-size: 15px;
  color: #303133;
}

.ocr-screenshot-block {
  margin-bottom: 14px;
}

.ocr-ss-label {
  font-size: 13px;
  font-weight: 600;
  color: #409eff;
  margin-bottom: 8px;
  padding-left: 2px;
}

.ocr-row-block {
  margin-bottom: 6px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.ocr-row-label {
  font-size: 10px;
  color: #909399;
  margin-bottom: 3px;
  padding-left: 2px;
}

.ocr-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(80px, 1fr));
  gap: 4px;
  min-width: 520px;
}

.ocr-cell {
  border: 1.5px solid #dcdfe6;
  border-radius: 4px;
  padding: 4px;
  background: #fafafa;
  text-align: center;
}

.ocr-cell.ocr-success { border-color: #67c23a; }
.ocr-cell.ocr-failed { border-color: #f56c6c; }

.ocr-img {
  display: block;
  image-rendering: pixelated;
  height: 30px;
  width: auto;
  margin: 0 auto;
}

.ocr-label {
  margin-top: 2px;
  display: flex;
  gap: 3px;
  font-size: 9px;
  color: #606266;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  line-height: 1.2;
}

.ocr-name { color: #303133; font-weight: 500; }
.ocr-unknown { color: #c0c4cc; }
.ocr-result { font-weight: 600; font-size: 9px; }
.ocr-conf { color: #909399; font-size: 8px; }
.ocr-col {
  font-size: 8px;
  color: #c0c4cc;
  margin-top: 1px;
}

/* ═══════ 遮罩预览画廊 ═══════ */
.mask-gallery {
  margin-bottom: 20px;
}

.mask-gallery h4 {
  margin: 0 0 14px 0;
  font-size: 15px;
  color: #303133;
}

.mask-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.mask-cell {
  border: 2px solid #dcdfe6;
  border-radius: 6px;
  padding: 6px;
  background: #fafafa;
  text-align: center;
}

.mask-cell.mask-success { border-color: #67c23a; }
.mask-cell.mask-failed { border-color: #f56c6c; }
.mask-cell.mask-ignored { border-color: #c0c4cc; }

.mask-img {
  display: block;
  image-rendering: auto;
  height: 80px;
  width: auto;
}

.mask-label {
  margin-top: 4px;
  font-size: 11px;
  color: #606266;
}

/* ═══════ 模板匹配详情 ═══════ */
.match-debug h4 {
  margin: 0 0 14px 0;
  font-size: 15px;
  color: #303133;
}

.match-cell {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 16px;
  background: #fafafa;
}

.match-header {
  font-size: 13px;
  color: #303133;
  margin-bottom: 10px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.match-method { color: #909399; font-size: 12px; }

.match-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.match-label {
  font-size: 12px;
  color: #606266;
  min-width: 120px;
  text-align: right;
  flex-shrink: 0;
}

.match-score { color: #909399; font-size: 11px; }

.match-chars {
  display: flex;
  align-items: center;
  gap: 6px;
}

.match-char-img {
  display: block;
  image-rendering: pixelated;
  height: 50px;
  width: auto;
}

.match-seg-img {
  display: block;
  image-rendering: pixelated;
  max-width: 100%;
  height: auto;
}

.match-arrow { font-size: 16px; color: #909399; }

.match-tpl-img {
  display: block;
  image-rendering: pixelated;
  height: 50px;
  width: auto;
}

.match-best {
  border: 2px solid #67c23a;
  border-radius: 3px;
}
</style>
