<script setup>
import { ref, computed, onMounted } from 'vue'
import { Warning } from '@element-plus/icons-vue'
import { useAnalysisStore } from './stores/analysis.js'
import UploadSection from './components/UploadSection.vue'
import ResultPanel from './components/ResultPanel.vue'
import DebugOverlay from './components/DebugOverlay.vue'
import DebugDetail from './components/DebugDetail.vue'

const store = useAnalysisStore()
const activeBeforeIndex = ref(0)
const activeAfterIndex = ref(0)
const activeTab = ref('result')

const debugEnabled = ref(false)
try { debugEnabled.value = localStorage.getItem('rock_debug') === '1' } catch {}

const showDebugTab = computed(() => debugEnabled.value)

const debugClicks = ref(0)
let debugClickTimer = null

function onWorldClick() {
  debugClicks.value++
  clearTimeout(debugClickTimer)
  if (debugClicks.value >= 15) {
    debugEnabled.value = !debugEnabled.value
    try { localStorage.setItem('rock_debug', debugEnabled.value ? '1' : '0') } catch {}
    debugClicks.value = 0
  } else {
    debugClickTimer = setTimeout(() => { debugClicks.value = 0 }, 2000)
  }
}

onMounted(async () => {
  await store.restoreFromStorage()
})

async function handleAdd(stage, files) {
  await store.addImages(stage, files)
}

async function handleRemove(stage, index) {
  await store.removeImage(stage, index)
}

function handleSelect(stage, index) {
  if (stage === 'before') activeBeforeIndex.value = index
  else activeAfterIndex.value = index
}

function jumpToAnnotation(stage, index) {
  handleSelect(stage, index)
  activeTab.value = 'annotate'
}

const generalWarnings = computed(() =>
  store.warnings.filter((w) => !w.includes('低置信度')),
)
const lowConfWarnings = computed(() =>
  store.warnings.filter((w) => w.includes('低置信度')),
)
const lowConfDialog = ref(false)
const warnDialog = ref(false)
</script>

<template>
  <div class="app">
    <header class="header">
      <h1>洛克王国<span class="debug-trigger" @click="onWorldClick">世界</span> · 背包截图采集统计</h1>
      <p class="subtitle">上传跑图前/后背包截图，自动识别材料增量</p>
    </header>

    <section class="upload-row">
      <UploadSection
        title="跑图前"
        stage="before"
        :images="store.beforeImages"
        @add="(files) => handleAdd('before', files)"
        @remove="(idx) => handleRemove('before', idx)"
        @select="(idx) => handleSelect('before', idx)"
      />
      <UploadSection
        title="跑图后"
        stage="after"
        :images="store.afterImages"
        @add="(files) => handleAdd('after', files)"
        @remove="(idx) => handleRemove('after', idx)"
        @select="(idx) => handleSelect('after', idx)"
      />
    </section>

    <section class="actions">
      <el-button
        type="primary"
        size="large"
        :disabled="!store.canAnalyze"
        :loading="store.analyzing"
        @click="store.startAnalysis()"
      >
        开始分析
      </el-button>
      <el-button size="large" :disabled="store.analyzing" @click="store.reset()">
        重置
      </el-button>
    </section>

    <section v-if="store.analyzing" class="progress-section">
      <div class="progress-label">{{ store.progressStep || '分析中...' }}</div>
      <el-progress :percentage="store.progressPercent" :stroke-width="16" striped striped-flow />
    </section>

    <section v-if="!store.persistenceOk" class="alerts">
      <el-alert
        title="浏览器存储空间不足，截图仅保存在内存中，刷新页面后需重新上传"
        type="info"
        show-icon
        :closable="false"
        style="margin-bottom: 8px"
      />
    </section>

    <section v-if="store.errors.length" class="alerts">
      <el-alert
        v-for="(err, i) in store.errors"
        :key="'e' + i"
        :title="err"
        type="error"
        show-icon
        :closable="false"
        style="margin-bottom: 8px"
      />
    </section>

    <div v-if="generalWarnings.length || lowConfWarnings.length" class="warn-bar">
      <span v-if="generalWarnings.length" class="warn-tag" @click="warnDialog = true">
        <el-icon :size="14"><Warning /></el-icon>
        <span>{{ generalWarnings.length }} 条提醒</span>
      </span>
      <span v-if="lowConfWarnings.length" class="warn-tag warn-tag--low" @click="lowConfDialog = true">
        <el-icon :size="14"><Warning /></el-icon>
        <span>{{ lowConfWarnings.length }} 条低置信度</span>
      </span>
    </div>

    <el-dialog v-model="warnDialog" title="提醒明细" width="560px" :close-on-click-modal="false">
      <el-alert
        v-for="(w, i) in generalWarnings"
        :key="'gw' + i"
        :title="w"
        type="warning"
        show-icon
        :closable="false"
        style="margin-bottom: 8px"
      />
    </el-dialog>

    <el-dialog v-model="lowConfDialog" title="低置信度匹配提醒" width="560px" :close-on-click-modal="false">
      <el-alert
        v-for="(w, i) in lowConfWarnings"
        :key="'lc' + i"
        :title="w"
        type="warning"
        show-icon
        :closable="false"
        style="margin-bottom: 8px"
      />
    </el-dialog>

    <el-tabs v-if="store.beforeResult || store.afterResult" v-model="activeTab" class="result-tabs">
      <el-tab-pane label="统计结果" name="result">
        <ResultPanel
          v-if="store.hasResults"
          :delta="store.delta"
          :before-result="store.beforeResult"
          :after-result="store.afterResult"
          @jump-screenshot="({ stage, index }) => jumpToAnnotation(stage, index)"
        />
        <div v-else-if="store.errors.length" class="empty-tab">
          分析出错，详见上方错误信息
        </div>
      </el-tab-pane>

      <el-tab-pane label="截图标注" name="annotate">
        <DebugOverlay
          stage="before"
          :result="store.beforeResult"
          :images="store.beforeImages"
          :active-index="activeBeforeIndex"
          @edit-cell="({ stage, screenshotIndex, row, col, itemName, quantity }) => store.editCellResult(stage, screenshotIndex, row, col, itemName, quantity)"
          @exclude-cell="({ stage, screenshotIndex, row, col }) => store.excludeCellResult(stage, screenshotIndex, row, col)"
        />
        <DebugOverlay
          stage="after"
          :result="store.afterResult"
          :images="store.afterImages"
          :active-index="activeAfterIndex"
          @edit-cell="({ stage, screenshotIndex, row, col, itemName, quantity }) => store.editCellResult(stage, screenshotIndex, row, col, itemName, quantity)"
          @exclude-cell="({ stage, screenshotIndex, row, col }) => store.excludeCellResult(stage, screenshotIndex, row, col)"
        />
      </el-tab-pane>

      <el-tab-pane v-if="showDebugTab" label="调试详情" name="debug">
        <DebugDetail
          :before-result="store.beforeResult"
          :after-result="store.afterResult"
        />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: #f0f2f5;
  color: #303133;
}

#app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 16px 40px;
}
</style>

<style scoped>
.header {
  text-align: center;
  margin-bottom: 20px;
}

.header h1 {
  margin: 0 0 4px;
  font-size: 20px;
}

.debug-trigger {
  cursor: default;
  user-select: none;
}

.subtitle {
  margin: 0;
  color: #909399;
  font-size: 13px;
}

.upload-row {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 16px;
}

@media (min-width: 768px) {
  .upload-row {
    flex-direction: row;
  }
}

.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}

.progress-section {
  margin-bottom: 16px;
}

.progress-label {
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
}

.alerts {
  margin-bottom: 12px;
}

.warn-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.warn-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #e6a23c;
  cursor: pointer;
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 12px;
  background: #fdf6ec;
  border: 1px solid #faecd8;
}

.warn-tag:hover {
  background: #faecd8;
}

.warn-tag--low {
  color: #909399;
  background: #f5f7fa;
  border-color: #e4e7ed;
}

.warn-tag--low:hover {
  background: #e9ecef;
}

.result-tabs {
  margin-top: 4px;
}

.result-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}

.result-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
}

.empty-tab {
  color: #909399;
  font-size: 14px;
  padding: 24px;
  text-align: center;
}

@media (max-width: 767px) {
  .header h1 {
    font-size: 17px;
  }

  .subtitle {
    font-size: 12px;
  }

  .result-tabs :deep(.el-tabs__item) {
    padding: 0 12px;
    font-size: 13px;
  }
}
</style>
