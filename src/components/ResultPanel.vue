<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { BALL_ORDER, CATEGORY_ORDER } from '../utils/constants.js'

const props = defineProps({
  delta: { type: Object, default: null },
  beforeResult: { type: Object, default: null },
  afterResult: { type: Object, default: null },
})

const emit = defineEmits(['jump-screenshot'])
const showColumns = ref(window.innerWidth >= 900)
const mobile = ref(false)

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
const nameMinW = computed(() => mobile.value ? 55 : 100)
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
        <div v-for="row in categoryRows" :key="row.category" class="summary-card">
          <span class="label">{{ row.category }}</span>
          <span :class="['value', deltaClass(row.delta)]">{{ formatDelta(row.delta) }}</span>
        </div>
      </div>
    </div>

    <div class="summary-section">
      <h4>咕噜球{{ isSingle ? '统计' : '汇总' }}</h4>
      <div class="ball-grid">
        <div v-for="row in ballRows" :key="row.ball" class="ball-item">
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
            <el-table-column prop="name" label="物品名" :min-width="nameMinW" />
            <el-table-column v-if="showColumns || isSingle" prop="category" label="分类" :width="catW" align="center" />
            <el-table-column v-if="showColumns || isSingle" prop="ball" label="对应球" :min-width="ballMinW" />
            <template v-if="isSingle">
              <el-table-column label="数量" :width="qtyW" align="right">
                <template #default="{ row }">{{ row.before ?? row.after ?? 0 }}</template>
              </el-table-column>
            </template>
            <template v-else>
              <el-table-column prop="before" label="跑图前" :width="stageW" align="right" />
              <el-table-column prop="after" label="跑图后" :width="stageW" align="right" />
              <el-table-column label="增量" :width="stageW" align="right">
                <template #default="{ row }">
                  <span :class="deltaClass(row.delta)">{{ formatDelta(row.delta) }}</span>
                </template>
              </el-table-column>
            </template>
          </el-table>
        </div>
        <div class="table-scroll table-half">
          <el-table :data="rightItems" stripe border size="small">
            <el-table-column prop="name" label="物品名" :min-width="nameMinW" />
            <el-table-column v-if="showColumns || isSingle" prop="category" label="分类" :width="catW" align="center" />
            <el-table-column v-if="showColumns || isSingle" prop="ball" label="对应球" :min-width="ballMinW" />
            <template v-if="isSingle">
              <el-table-column label="数量" :width="qtyW" align="right">
                <template #default="{ row }">{{ row.before ?? row.after ?? 0 }}</template>
              </el-table-column>
            </template>
            <template v-else>
              <el-table-column prop="before" label="跑图前" :width="stageW" align="right" />
              <el-table-column prop="after" label="跑图后" :width="stageW" align="right" />
              <el-table-column label="增量" :width="stageW" align="right">
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
          <el-table-column prop="name" label="物品名" :min-width="nameMinW" />
          <el-table-column v-if="showColumns || isSingle" prop="category" label="分类" :width="catW" align="center" />
          <el-table-column v-if="showColumns || isSingle" prop="ball" label="对应球" :min-width="ballMinW" />
          <template v-if="isSingle">
            <el-table-column label="数量" :width="qtyW" align="right">
              <template #default="{ row }">{{ row.before ?? row.after ?? 0 }}</template>
            </el-table-column>
          </template>
          <template v-else>
            <el-table-column prop="before" label="跑图前" :width="stageW" align="right" />
            <el-table-column prop="after" label="跑图后" :width="stageW" align="right" />
            <el-table-column label="增量" :width="stageW" align="right">
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
  background: #ecf5ff;
  color: #409eff;
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
  color: #303133;
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
  background: #f5f7fa;
  border-radius: 8px;
  padding: 14px;
  text-align: center;
}

.summary-card .label {
  display: block;
  font-size: 13px;
  color: #606266;
  margin-bottom: 6px;
}

.summary-card .value {
  font-size: 22px;
  font-weight: bold;
}

.ball-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
}

.ball-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f5f7fa;
  border-radius: 6px;
  padding: 8px 10px;
}

.ball-name {
  font-size: 12px;
  color: #606266;
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
    padding: 10px 8px;
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
