<script setup>
import { ref, watch, onMounted, nextTick, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { extractCellRegions } from '../composables/useGridDetection.js'
import { loadConfig } from '../utils/config.js'

const props = defineProps({
  stage: { type: String, required: true },
  result: { type: Object, default: null },
  images: { type: Array, default: () => [] },
  activeIndex: { type: Number, default: 0 },
})

const emit = defineEmits(['edit-cell', 'exclude-cell'])

const canvasRefs = ref([])
const zoom = ref(window.innerWidth < 768 ? 0.5 : 1)
const urlCache = new Map()
const gridSettings = ref(null)
const itemOptions = ref([])

// Edit dialog
const editDialog = ref(false)
const editingCell = ref(null)
const editName = ref('')
const editQuantity = ref(null)

onMounted(async () => {
  try {
    const cfg = await loadConfig()
    gridSettings.value = cfg.settings
    itemOptions.value = cfg.items.map((i) => i.name)
  } catch {
    gridSettings.value = {}
  }
})

function getImageUrl(file) {
  if (!urlCache.has(file)) urlCache.set(file, URL.createObjectURL(file))
  return urlCache.get(file)
}

function getCellColor(cell) {
  if (cell.skipped) return '#909399'
  if (cell.status === 'success') return '#67c23a'
  if (cell.status === 'failed') return '#f56c6c'
  return '#c0c4cc'
}

// 当前裁剪映射（供点击检测使用）
const cropInfo = ref({ cropX: 0, cropY: 0, scale: 1 })

function drawOverlay(canvas, img, cells, imageData, imgW, imgH) {
  if (!canvas || !img) return

  const region = gridSettings.value?.searchRegion
  const cropX = region ? Math.floor(imgW * region.left) : 0
  const cropY = region ? Math.floor(imgH * region.top) : 0
  const cropW = region ? Math.floor(imgW * (region.right - region.left)) : imgW
  const cropH = region ? Math.floor(imgH * (region.bottom - region.top)) : imgH

  const displayW = Math.min(cropW * zoom.value, 2400)
  const scale = displayW / cropW
  cropInfo.value = { cropX, cropY, scale }

  canvas.width = displayW
  canvas.height = cropH * scale
  canvas.style.width = `${canvas.width}px`
  canvas.style.height = `${canvas.height}px`

  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height)

  for (const cell of cells || []) {
    const { rect } = cell
    if (!rect) continue

    const x = (rect.x - cropX) * scale
    const y = (rect.y - cropY) * scale
    const w = rect.width * scale
    const h = rect.height * scale

    if (x + w < 0 || y + h < 0 || x > canvas.width || y > canvas.height) continue

    ctx.strokeStyle = getCellColor(cell)
    ctx.lineWidth = Math.max(1.5, scale)
    ctx.strokeRect(x, y, w, h)

    if (imageData && !cell.skipped && cell.row >= 0) {
      const { iconRect, qtyRect } = extractCellRegions(imageData, rect, gridSettings.value || {})

      ctx.setLineDash([4, 3])
      ctx.strokeStyle = '#409eff'
      ctx.lineWidth = 1.5
      ctx.strokeRect(
        (iconRect.x - cropX) * scale, (iconRect.y - cropY) * scale,
        iconRect.width * scale, iconRect.height * scale,
      )
      ctx.strokeStyle = '#e6a23c'
      ctx.strokeRect(
        (qtyRect.x - cropX) * scale, (qtyRect.y - cropY) * scale,
        qtyRect.width * scale, qtyRect.height * scale,
      )
      ctx.setLineDash([])
    }

    if (cell.hasMarker && rect) {
      ctx.fillStyle = '#5D9F11'
      ctx.fillRect((rect.x - cropX) * scale, (rect.y - cropY) * scale, 6 * scale, 6 * scale)
    }

    const fontSize = Math.max(12, Math.round(13 * scale))
    ctx.font = `bold ${fontSize}px sans-serif`

    if (cell.skipped) {
      ctx.fillStyle = '#909399'
      ctx.fillText(cell.skipReason || '跳过', x + 3, y + fontSize + 2)
    } else if (cell.itemName) {
      const label = cell.quantity != null ? `${cell.itemName} x${cell.quantity}` : cell.itemName
      const textWidth = ctx.measureText(label).width
      ctx.fillStyle = 'rgba(0,0,0,0.65)'
      ctx.fillRect(x + 2, y + 2, Math.min(w - 4, textWidth + 8), fontSize + 4)
      ctx.fillStyle = getCellColor(cell)
      ctx.fillText(label, x + 4, y + 2 + fontSize)
    }
  }

}

async function renderAll() {
  await nextTick()
  const debug = props.result?.screenshotDebug
  if (!debug) return

  for (let i = 0; i < debug.length; i++) {
    const info = debug[i]
    const file = props.images[info.index]
    const canvas = canvasRefs.value[i]
    if (!file || !canvas) continue

    const img = new Image()
    img.onload = () => {
      const off = document.createElement('canvas')
      off.width = info.width
      off.height = info.height
      off.getContext('2d').drawImage(img, 0, 0)
      const imageData = off.getContext('2d').getImageData(0, 0, info.width, info.height)
      drawOverlay(canvas, img, info.cells, imageData, info.width, info.height)
    }
    img.src = getImageUrl(file)
  }
}

watch([() => props.result, () => props.activeIndex, zoom], () => renderAll())
onMounted(renderAll)

function setCanvasRef(el, idx) {
  if (el) canvasRefs.value[idx] = el
}

// ── 点击检测 ──
function onCanvasClick(event, screenshotIndex) {
  const canvas = event.target
  const rect = canvas.getBoundingClientRect()
  const clickX = (event.clientX - rect.left) * (canvas.width / rect.width)
  const clickY = (event.clientY - rect.top) * (canvas.height / rect.height)

  // 逆向映射到原图坐标
  const { cropX, cropY, scale } = cropInfo.value
  const imgX = clickX / scale + cropX
  const imgY = clickY / scale + cropY

  // 查找被点击的格子
  const debug = props.result?.screenshotDebug
  if (!debug) return
  const info = debug[screenshotIndex]
  if (!info) return

  for (const cell of (info.cells || [])) {
    if (cell.skipped || !cell.rect) continue
    const r = cell.rect
    if (imgX >= r.x && imgX <= r.x + r.width && imgY >= r.y && imgY <= r.y + r.height) {
      openEditDialog(cell, info.index)
      return
    }
  }
}

function openEditDialog(cell, screenshotIndex) {
  editingCell.value = { ...cell, screenshotIndex }
  editName.value = cell.itemName || ''
  editQuantity.value = cell.quantity
  editDialog.value = true
}

function saveEdit() {
  if (!editingCell.value) return
  const name = editName.value.trim() || null
  const qty = editQuantity.value != null ? Number(editQuantity.value) : null

  if (name && qty != null && !Number.isNaN(qty) && qty >= 0) {
    emit('edit-cell', {
      stage: props.stage,
      screenshotIndex: editingCell.value.screenshotIndex,
      row: editingCell.value.row,
      col: editingCell.value.col,
      itemName: name,
      quantity: qty,
    })
    editDialog.value = false
    ElMessage.success('已手动修正')
  } else {
    ElMessage.warning('请填写有效的物品名称和数量')
  }
}

function excludeCell() {
  if (!editingCell.value) return
  emit('exclude-cell', {
    stage: props.stage,
    screenshotIndex: editingCell.value.screenshotIndex,
    row: editingCell.value.row,
    col: editingCell.value.col,
  })
  editDialog.value = false
  ElMessage.success('已排除')
}
</script>

<template>
  <div v-if="result?.screenshotDebug?.length" class="annotate-overlay">
    <div class="annotate-header">
      <h4>截图标注 — {{ stage === 'before' ? '跑图前' : '跑图后' }} <span class="hint">（点击格子可手动修正）</span></h4>
      <div class="zoom-control">
        <span>缩放</span>
        <el-slider v-model="zoom" :min="0.5" :max="2" :step="0.25" :show-tooltip="true" style="width: 160px" />
      </div>
    </div>
    <div class="legend">
      <span class="legend-item"><i class="dot green" />成功识别</span>
      <span class="legend-item"><i class="dot gray" />跳过</span>
      <span class="legend-item"><i class="dot red" />识别失败</span>
      <span class="legend-item"><i class="dot light" />未收录/忽略</span>
      <span class="legend-item"><i class="dot blue" />图标区</span>
      <span class="legend-item"><i class="dot orange" />数量条</span>
      <span class="legend-item"><i class="dot marker" />角标</span>
    </div>
    <div class="canvas-scroll">
      <div
        v-for="(info, idx) in result.screenshotDebug"
        :key="idx"
        class="canvas-wrap"
        :class="{ active: idx === activeIndex }"
      >
        <div class="canvas-title">截图 {{ info.index + 1 }}（{{ info.width }}×{{ info.height }}）</div>
        <canvas
          :ref="(el) => setCanvasRef(el, idx)"
          class="annotate-canvas"
          @click="(e) => onCanvasClick(e, idx)"
        />
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="editDialog" title="手动修正" width="360px" :close-on-click-modal="false"
      destroy-on-close @closed="editingCell = null">
      <div class="edit-form">
        <div class="edit-field">
          <label>物品名称</label>
          <div class="edit-name-row">
            <el-select v-model="editName" filterable allow-create placeholder="选择或输入" style="flex:1">
              <el-option v-for="name in itemOptions" :key="name" :label="name" :value="name" />
            </el-select>
            <el-button type="danger" plain @click="excludeCell">排除</el-button>
          </div>
        </div>
        <div class="edit-field">
          <label>数量</label>
          <el-input-number v-model="editQuantity" :min="0" :max="99999" style="width: 100%" />
        </div>
      </div>
      <template #footer>
        <el-button @click="editDialog = false">取消</el-button>
        <el-button type="primary" @click="saveEdit">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.annotate-overlay {
  margin-top: 12px;
}

.annotate-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.annotate-header h4 {
  margin: 0;
  font-size: 14px;
}

.annotate-header .hint {
  font-size: 12px;
  color: #909399;
  font-weight: normal;
}

.zoom-control {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #606266;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 11px;
  color: #606266;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 3px;
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.dot.green { background: #67c23a; }
.dot.gray { background: #909399; }
.dot.red { background: #f56c6c; }
.dot.light { background: #c0c4cc; }
.dot.blue { background: #409eff; }
.dot.orange { background: #e6a23c; }
.dot.marker { background: #5D9F11; }

.canvas-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  max-width: 100%;
  padding-bottom: 8px;
  -webkit-overflow-scrolling: touch;
}

.canvas-wrap {
  display: inline-block;
  border: 2px solid transparent;
  border-radius: 6px;
  padding: 3px;
  margin-bottom: 8px;
}

.canvas-wrap.active {
  border-color: #409eff;
}

.canvas-title {
  font-size: 12px;
  color: #606266;
  margin-bottom: 4px;
  font-weight: 500;
}

.annotate-canvas {
  display: block;
  image-rendering: auto;
  cursor: pointer;
}

.edit-field {
  margin-bottom: 16px;
}

.edit-field label {
  display: block;
  font-size: 13px;
  color: #303133;
  margin-bottom: 6px;
}

.edit-name-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* 加速弹窗动画 */
:deep(.dialog-fade-enter-active),
:deep(.dialog-fade-leave-active) {
  transition-duration: 0.12s !important;
}
:deep(.el-fade-in-linear-enter-active),
:deep(.el-fade-in-linear-leave-active) {
  transition-duration: 0.12s !important;
}

@media (max-width: 767px) {
  .annotate-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .zoom-control {
    width: 100%;
  }

  .legend {
    gap: 6px;
    font-size: 10px;
  }
}
</style>
