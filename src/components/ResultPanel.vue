<script setup>
import { computed, ref, reactive, onMounted, onUnmounted } from 'vue'
import { BALL_ORDER, BALL_COLORS, CATEGORY_ORDER } from '../utils/constants.js'

const BASE = import.meta.env.BASE_URL

const props = defineProps({
  delta: { type: Object, default: null },
  beforeResult: { type: Object, default: null },
  afterResult: { type: Object, default: null },
})

const emit = defineEmits(['jump-screenshot'])
const showColumns = ref(window.innerWidth >= 900)
const mobile = ref(false)

const imgFailed = reactive({})
function onImgError(name) {
  imgFailed[name] = true
}

function onResize() {
  mobile.value = window.innerWidth < 768
}

onMounted(() => {
  onResize()
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
})

// 移动端列宽：压缩固定宽度列，避免横向滚动条
const nameMinW = computed(() => mobile.value ? 70 : 115)
const catW = computed(() => mobile.value ? 45 : 70)
const ballMinW = computed(() => mobile.value ? 60 : 90)
const qtyW = computed(() => mobile.value ? 55 : 100)
const stageW = computed(() => mobile.value ? 60 : 80)

const isSingle = computed(() => props.delta?.single ?? false)

const halfLen = computed(() => {
  if (!props.delta) return 0
  return Math.ceil(props.delta.itemDeltas.length / 2)
})

const leftItems = computed(() => {
  if (!props.delta) return []
  return props.delta.itemDeltas.slice(0, halfLen.value)
})

const rightItems = computed(() => {
  if (!props.delta) return []
  return props.delta.itemDeltas.slice(halfLen.value)
})
const categoryRows = computed(() => {
  if (!props.delta) return []
  return CATEGORY_ORDER.map((cat) => ({
    category: cat,
    delta: props.delta.categorySummary[cat] ?? 0,
  }))
})

const ballRows = computed(() => {
  if (!props.delta) return []
  return BALL_ORDER.filter((ball) => isSingle.value ? (props.delta.ballSummary[ball] ?? 0) > 0 : true).map((ball) => ({
    ball,
    delta: props.delta.ballSummary[ball] ?? 0,
    color: BALL_COLORS[ball] || '#909399',
  }))
})

const stageLabel = computed(() => {
  if (!isSingle.value) return null
  return props.beforeResult?.totals ? '跑图前' : '跑图后'
})

const conflicts = computed(() => {
  const list = []
  for (const r of [props.beforeResult, props.afterResult]) {
    if (r?.conflictDetails) list.push(...r.conflictDetails)
  }
  return list
})

function formatDelta(val) {
  if (val == null) return '-'
  if (val > 0) return `+${val}`
  return String(val)
}

function deltaClass(val) {
  if (val == null) return 'zero'
  if (val > 0) return 'positive'
  if (val < 0) return 'negative'
  return 'zero'
}

function jumpToScreenshot(stage, index) {
  emit('jump-screenshot', { stage, index })
}

</script>

<template>
  <div v-if="delta" class="result-panel">
    <div v-if="isSingle" class="stage-badge">{{ stageLabel }} · 仅统计模式</div>

    <div class="summary-section">
      <h4>花 / 矿{{ isSingle ? '统计' : '分类汇总' }}</h4>
      <div class="summary-cards">
        <div v-for="row in categoryRows" :key="row.category" class="summary-card" :class="'card-' + deltaClass(row.delta)">
          <span class="label">{{ row.category }}</span>
          <span :class="['value', deltaClass(row.delta)]">{{ formatDelta(row.delta) }}</span>
        </div>
      </div>
    </div>

    <div class="summary-section">
      <h4>咕噜球{{ isSingle ? '统计' : '汇总' }}</h4>
      <div class="ball-grid">
        <div v-for="row in ballRows" :key="row.ball" class="ball-item">
          <img
            v-if="!imgFailed[row.ball]"
            :src="BASE + 'config/images/ball/' + row.ball + '.png'"
            class="ball-img"
            @error="onImgError(row.ball)"
          />
          <span v-else class="ball-dot" :style="{ background: row.color }"></span>
          <span class="ball-name">{{ row.ball }}</span>
          <span :class="['ball-value', deltaClass(row.delta)]">{{ formatDelta(row.delta) }}</span>
        </div>
      </div>
    </div>

    <div class="summary-section">
      <div class="section-header">
        <h4>物品明细</h4>
        <el-switch v-if="!isSingle" v-model="showColumns" size="small" active-text="显示分类" />
      </div>
      <!-- 宽屏双栏 -->
      <div class="table-split wide-only">
        <div class="table-scroll table-half">
          <el-table :data="leftItems" stripe border size="small">
            <el-table-column label="物品名" :min-width="nameMinW">
              <template #default="{ row }">
                <span class="item-name-cell">
                  <img
                    :src="BASE + 'config/images/' + row.name + '.png'"
                    class="item-icon"
                    @error="(e) => e.target.style.display = 'none'"
                  />
                  {{ row.name }}
                </span>
              </template>
            </el-table-column>
            <el-table-column v-if="showColumns || isSingle" prop="category" label="分类" :min-width="catW" align="center" />
            <el-table-column v-if="showColumns || isSingle" prop="ball" label="对应球" :min-width="ballMinW" />
            <template v-if="isSingle">
              <el-table-column label="数量" :min-width="qtyW" align="right">
                <template #default="{ row }">{{ row.before ?? row.after ?? 0 }}</template>
              </el-table-column>
            </template>
            <template v-else>
              <el-table-column prop="before" label="跑图前" :min-width="stageW" align="right" />
              <el-table-column prop="after" label="跑图后" :min-width="stageW" align="right" />
              <el-table-column label="增量" :min-width="stageW" align="right">
                <template #default="{ row }">
                  <span :class="deltaClass(row.delta)">{{ formatDelta(row.delta) }}</span>
                </template>
              </el-table-column>
            </template>
          </el-table>
        </div>
        <div class="table-scroll table-half">
          <el-table :data="rightItems" stripe border size="small">
            <el-table-column label="物品名" :min-width="nameMinW">
              <template #default="{ row }">
                <span class="item-name-cell">
                  <img
                    :src="BASE + 'config/images/' + row.name + '.png'"
                    class="item-icon"
                    @error="(e) => e.target.style.display = 'none'"
                  />
                  {{ row.name }}
                </span>
              </template>
            </el-table-column>
            <el-table-column v-if="showColumns || isSingle" prop="category" label="分类" :min-width="catW" align="center" />
            <el-table-column v-if="showColumns || isSingle" prop="ball" label="对应球" :min-width="ballMinW" />
            <template v-if="isSingle">
              <el-table-column label="数量" :min-width="qtyW" align="right">
                <template #default="{ row }">{{ row.before ?? row.after ?? 0 }}</template>
              </el-table-column>
            </template>
            <template v-else>
              <el-table-column prop="before" label="跑图前" :min-width="stageW" align="right" />
              <el-table-column prop="after" label="跑图后" :min-width="stageW" align="right" />
              <el-table-column label="增量" :min-width="stageW" align="right">
                <template #default="{ row }">
                  <span :class="deltaClass(row.delta)">{{ formatDelta(row.delta) }}</span>
                </template>
              </el-table-column>
            </template>
          </el-table>
        </div>
      </div>
      <!-- 窄屏单栏 -->
      <div class="table-scroll narrow-only">
        <el-table :data="delta.itemDeltas" stripe border size="small">
          <el-table-column label="物品名" :min-width="nameMinW">
            <template #default="{ row }">
              <span class="item-name-cell">
                <img
                  :src="BASE + 'config/images/' + row.name + '.png'"
                  class="item-icon"
                  @error="(e) => e.target.style.display = 'none'"
                />
                {{ row.name }}
              </span>
            </template>
          </el-table-column>
          <el-table-column v-if="showColumns || isSingle" prop="category" label="分类" :min-width="catW" align="center" />
          <el-table-column v-if="showColumns || isSingle" prop="ball" label="对应球" :min-width="ballMinW" />
          <template v-if="isSingle">
            <el-table-column label="数量" :min-width="qtyW" align="right">
              <template #default="{ row }">{{ row.before ?? row.after ?? 0 }}</template>
            </el-table-column>
          </template>
          <template v-else>
            <el-table-column prop="before" label="跑图前" :min-width="stageW" align="right" />
            <el-table-column prop="after" label="跑图后" :min-width="stageW" align="right" />
            <el-table-column label="增量" :min-width="stageW" align="right">
              <template #default="{ row }">
                <span :class="deltaClass(row.delta)">{{ formatDelta(row.delta) }}</span>
              </template>
            </el-table-column>
          </template>
        </el-table>
      </div>
    </div>
  </div>

  <div v-if="conflicts.length" class="conflict-section">
    <h4>校验冲突详情</h4>
    <div v-for="(c, i) in conflicts" :key="i" class="conflict-item">
      <strong>{{ c.itemName }}</strong>
      <div v-for="e in c.entries" :key="e.screenshotIndex" class="conflict-entry">
        <el-link type="primary" @click="jumpToScreenshot('before', e.screenshotIndex)">
          截图 {{ e.screenshotIndex + 1 }}：数量 {{ e.quantity }}
        </el-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.result-panel h3 {
  margin: 0 0 14px;
  font-size: 17px;
}

.stage-badge {
  display: inline-block;
  background: #fdf3e8;
  color: #d4884a;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 4px;
  margin-bottom: 14px;
}

.summary-section {
  margin-bottom: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.section-header h4 {
  margin: 0;
  font-size: 14px;
  color: #303133;
}

.summary-section h4 {
  margin: 0 0 10px;
  font-size: 14px;
  color: #2c2c2c;
  font-weight: 600;
}

/* ── 表格微调 ── */
.summary-section :deep(.el-table) {
  border-radius: 8px;
  overflow: hidden;
}

.summary-section :deep(.el-table th.el-table__cell) {
  font-size: 12px;
  padding-top: 6px;
  padding-bottom: 6px;
}

.summary-section :deep(.el-table .cell) {
  padding: 8px 10px;
  font-variant-numeric: tabular-nums;
}

.summary-section :deep(.el-table__cell[align="right"] .cell),
.summary-section :deep(.el-table__cell.is-right .cell) {
  font-weight: 600;
}

.item-name-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.item-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  flex-shrink: 0;
  transform: scale(1.4);
  transform-origin: center;
  image-rendering: auto;
}

.table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.table-split {
  display: flex;
  gap: 16px;
}

.table-half {
  flex: 1;
  min-width: 0;
}

.wide-only {
  display: flex;
}

.narrow-only {
  display: none;
}

@media (max-width: 899px) {
  .wide-only {
    display: none;
  }

  .narrow-only {
    display: block;
  }
}

.summary-cards {
  display: flex;
  gap: 12px;
}

.summary-card {
  flex: 1;
  background: #fff;
  border-radius: 10px;
  padding: 16px 14px;
  text-align: center;
  border: 1px solid #ebeef5;
  transition: background 0.3s, border-color 0.3s, box-shadow 0.3s;
}

.summary-card.card-positive {
  background: #f0f9eb;
  border-color: #c2e7b0;
}

.summary-card.card-negative {
  background: #fef0f0;
  border-color: #fbc4c4;
}

.summary-card.card-zero {
  background: #f5f7fa;
  border-color: #e4e7ed;
}

.summary-card .label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #5d5d5d;
  margin-bottom: 6px;
}

.summary-card .value {
  font-size: 22px;
  font-weight: bold;
}

.summary-card.card-positive .value { color: #5aaf2a; }
.summary-card.card-negative .value { color: #e04545; }

.ball-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}

.ball-item {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #fff;
  border-radius: 8px;
  padding: 6px 10px 6px 30px;
  border: 1px solid #ebeef5;
  transition: box-shadow 0.2s;
  position: relative;
  overflow: visible;
  margin-left: 10px;
}

.ball-item:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.ball-dot {
  position: absolute;
  left: -10px;
  top: 50%;
  transform: translateY(-50%);
  width: 38px;
  height: 38px;
  border-radius: 50%;
}

.ball-img {
  position: absolute;
  left: -12px;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  object-fit: contain;
  image-rendering: auto;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,0.25));
}

.ball-name {
  font-size: 12px;
  color: #606266;
  flex: 1;
  white-space: nowrap;
  font-weight: 600;
}

.ball-value {
  font-weight: bold;
  font-size: 14px;
}

.conflict-section {
  margin-top: 16px;
  padding: 12px;
  background: #fef0f0;
  border-radius: 8px;
}

.conflict-section h4 {
  margin: 0 0 8px;
  color: #f56c6c;
}

.conflict-item {
  margin-bottom: 8px;
}

.conflict-entry {
  font-size: 13px;
  margin-left: 12px;
}

.positive {
  color: #67c23a;
}

.negative {
  color: #f56c6c;
}

.zero {
  color: #909399;
}

/* 移动端 */
@media (max-width: 767px) {
  .summary-section :deep(.el-table) {
    font-size: 12px;
  }

  .summary-section :deep(.el-table .cell) {
    padding: 6px 8px;
  }

  .summary-card {
    padding: 12px 8px;
  }

  .summary-card .label {
    font-size: 12px;
  }

  .summary-card .value {
    font-size: 18px;
  }

  .ball-grid {
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  }

  .section-header h4 {
    font-size: 13px;
  }
}
</style>
