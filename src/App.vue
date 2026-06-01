<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAnalysisStore } from './stores/analysis.js'
import UploadSection from './components/UploadSection.vue'
import ResultPanel from './components/ResultPanel.vue'
import DebugOverlay from './components/DebugOverlay.vue'
import DebugDetail from './components/DebugDetail.vue'

const store = useAnalysisStore()
const activeBeforeIndex = ref(0)
const activeAfterIndex = ref(0)
const activeTab = ref('result')

const showDebugTab = computed(() => {
  try { return localStorage.getItem('rock_debug') === '1' } catch { return false }
})

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
</script>

<template>
  <div class="app">
    <header class="header">
      <h1>洛克王国世界 · 背包截图采集统计</h1>
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

    <section v-if="store.warnings.length" class="alerts">
      <el-alert
        v-for="(warn, i) in store.warnings"
        :key="'w' + i"
        :title="warn"
        type="warning"
        show-icon
        :closable="false"
        style="margin-bottom: 8px"
      />
    </section>

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
