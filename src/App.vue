<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { Warning } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
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

watch(() => store.hasResults, async (val) => {
  if (val) {
    await nextTick()
    setTimeout(() => {
      document.querySelector('.result-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 300)
  }
})

async function handleReset() {
  try {
    await ElMessageBox.confirm('确定要重置吗？所有上传和分析结果将被清空。', '确认重置', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await store.reset()
  } catch {
    // cancelled
  }
}

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
const stepLabels = ['加载配置', '分割格子', '图像比对', 'OCR 识别', '校验', '计算']
const currentStepIndex = computed(() => {
  const idx = stepLabels.indexOf(store.progressStep)
  if (idx < 0) return 0
  if (idx === 0) return 0   // 加载配置
  if (idx === 1) return 1   // 分割格子
  if (idx === 2) return 2   // 图像比对 → 图像识别
  if (idx === 3) return 3   // OCR 识别
  return 4                   // 校验/计算 → 校验计算
})

const lowConfDialog = ref(false)
const warnDialog = ref(false)
</script>

<template>
  <div class="app">
    <header class="header">
      <h1>洛克王国<span class="debug-trigger" @click="onWorldClick">世界</span> · 背包截图采集统计</h1>
    </header>

    <section class="upload-row">
      <UploadSection
        title="跑图前"
        stage="before"
        :images="store.beforeImages"
        :active-index="activeBeforeIndex"
        @add="(files) => handleAdd('before', files)"
        @remove="(idx) => handleRemove('before', idx)"
        @select="(idx) => handleSelect('before', idx)"
      />
      <UploadSection
        title="跑图后"
        stage="after"
        :images="store.afterImages"
        :active-index="activeAfterIndex"
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
      <el-button size="large" :disabled="store.analyzing" @click="handleReset" plain>
        重置
      </el-button>
    </section>

    <section v-if="store.analyzing" class="progress-section">
      <el-steps :active="currentStepIndex" align-center finish-status="success">
        <el-step title="加载配置" />
        <el-step title="分割格子" />
        <el-step title="图像识别" />
        <el-step title="OCR 识别" />
        <el-step title="校验计算" />
      </el-steps>
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

    <div v-if="!store.hasResults && !store.analyzing && !store.errors.length" class="empty-state">
      <div class="empty-state-inner">
        <svg class="empty-icon" viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="28" stroke="#d0d7de" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.6"/>
          <path d="M22 28s2-6 10-6 10 6 10 6" stroke="#c0c4cc" stroke-width="2" stroke-linecap="round"/>
          <circle cx="26" cy="38" r="3" fill="#e8e5df"/>
          <circle cx="38" cy="38" r="3" fill="#e8e5df"/>
          <path d="M28 43c2 3 6 3 8 0" stroke="#c0c4cc" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M44 20l2 .5.5 2-.5 2-2 .5-2-.5-.5-2 .5-2z" fill="#d4884a" opacity="0.5"/>
          <path d="M18 16l1 .3.3 1-.3 1-1 .3-1-.3-.3-1 .3-1z" fill="#e6a23c" opacity="0.4"/>
        </svg>
        <p class="empty-title">准备开始分析</p>
        <p class="empty-desc">上传跑图前和/或跑图后的背包截图，点击「开始分析」查看统计结果。仅上传一个阶段时自动进入仅统计模式。</p>
      </div>
    </div>

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
  font-family: 'Noto Serif SC', 'STSong', 'SimSun', 'Songti SC', serif;
  background: #faf8f5;
  color: #2c2c2c;
  background-image:
    radial-gradient(circle at 20% 50%, rgba(212, 136, 74, 0.03) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(230, 162, 60, 0.02) 0%, transparent 50%),
    radial-gradient(circle at 50% 80%, rgba(212, 136, 74, 0.02) 0%, transparent 50%);
}

#app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 16px 40px;
  --el-color-primary: #d4884a;
  --el-color-primary-light-3: #dd9e65;
  --el-color-primary-light-5: #e6b585;
  --el-color-primary-light-7: #efcda8;
  --el-color-primary-light-8: #f3d9be;
  --el-color-primary-light-9: #f8e8d7;
  --el-color-primary-dark-2: #c07a3e;
}

/* ═══════════════════════════════════════════
   Element Plus 全局主题覆盖
   ═══════════════════════════════════════════ */

/* ── 按钮 ── */
.el-button {
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.2s;
}
.el-button--default {
  border-color: #d0d7de;
  color: #606266;
}
.el-button--default:hover,
.el-button--default:focus {
  border-color: #d4884a;
  color: #d4884a;
  background: #fdf3e8;
}
.el-button--default:active {
  border-color: #c07a3e;
  color: #c07a3e;
}
.el-button--default.is-disabled,
.el-button--default:disabled {
  color: #c0c4cc;
  background: #f5f7fa;
  border-color: #e4e7ed;
}
.el-button--primary {
  --el-button-bg-color: #d4884a;
  --el-button-border-color: #d4884a;
  --el-button-text-color: #fff;
  --el-button-hover-bg-color: #e09a5e;
  --el-button-hover-border-color: #e09a5e;
  --el-button-hover-text-color: #fff;
  --el-button-active-bg-color: #c07a3e;
  --el-button-active-border-color: #c07a3e;
  --el-button-active-text-color: #fff;
  --el-button-disabled-bg-color: #eac097;
  --el-button-disabled-border-color: #eac097;
  --el-button-disabled-text-color: #fff;
  --el-button-focus-bg-color: #d4884a;
  --el-button-focus-border-color: #d4884a;
}
.el-button--danger {
  --el-button-bg-color: #f56c6c;
  --el-button-border-color: #f56c6c;
  --el-button-hover-bg-color: #f78989;
  --el-button-hover-border-color: #f78989;
  --el-button-active-bg-color: #e04545;
  --el-button-active-border-color: #e04545;
  --el-button-disabled-bg-color: #fab6b6;
  --el-button-disabled-border-color: #fab6b6;
}

/* ── Tab ── */
.el-tabs__item {
  font-size: 14px;
  color: #909399;
  transition: color 0.2s;
}
.el-tabs__item:hover {
  color: #d4884a;
}
.el-tabs__item.is-active {
  color: #d4884a;
  font-weight: 600;
}
.el-tabs__item.is-disabled {
  color: #c0c4cc;
}
.el-tabs__active-bar {
  background: linear-gradient(90deg, #d4884a, #e6a23c);
  height: 3px;
  border-radius: 2px;
}
.el-tabs__nav-wrap::after {
  background: #e8e5df;
  height: 1px;
}

/* ── 表格 ── */
.el-table {
  --el-table-border-color: #e8e5df;
  --el-table-header-bg-color: #f5f2ec;
  --el-table-tr-bg-color: #fff;
  --el-table-row-hover-bg-color: #fdf5eb;
  border-radius: 8px;
  overflow: hidden;
}
.el-table th.el-table__cell {
  background: #f5f2ec;
  color: #5d5d5d;
  font-weight: 600;
  font-size: 13px;
  border-bottom: 2px solid #e0dbd0;
  padding-top: 6px;
  padding-bottom: 6px;
}
.el-table td.el-table__cell {
  border-bottom-color: #eee9e0;
}

/* 去掉纵向边框，只保留横向 */
.el-table--border,
.el-table--group {
  border-left: none;
  border-right: none;
}
.el-table--border .el-table__cell,
.el-table__inner-wrapper .el-table__cell {
  border-right: none;
}
.el-table--border .el-table__body-wrapper {
  border-left: none;
  border-right: none;
}
.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell {
  background: #faf9f6;
}

/* ── 进度条 ── */
.el-progress-bar__outer {
  border-radius: 10px;
  background: #e8e5df;
}
.el-progress-bar__inner {
  border-radius: 10px;
  background: linear-gradient(90deg, #d4884a, #c07a3e);
}

/* ── 弹窗 ── */
.el-dialog {
  border-radius: 14px;
  --el-dialog-box-shadow: 0 8px 40px rgba(0,0,0,0.1);
}
@media (max-width: 600px) {
  .el-dialog {
    width: 92% !important;
  }
}
.el-dialog__header {
  padding: 20px 24px 14px;
  border-bottom: 1px solid #f0ece5;
  margin-right: 0;
}
.el-dialog__headerbtn {
  top: 20px;
  right: 24px;
}
.el-dialog__body {
  padding: 20px 24px;
}
.el-dialog__footer {
  padding: 14px 24px 20px;
}

/* ── Alert ── */
.el-alert {
  border-radius: 8px;
  border: none;
}
.el-alert--error {
  background: #fef0f0;
}
.el-alert--warning {
  background: #fdf6ec;
}
.el-alert--info {
  background: #f5f7fa;
}

/* ── Switch ── */
.el-switch.is-checked .el-switch__core {
  --el-switch-on-color: #d4884a;
  border-color: #d4884a;
}

/* ── 上传拖拽区（全局兜底）── */
.el-upload-dragger {
  border-radius: 10px;
}

/* ── 滑块 ── */
.el-slider__bar {
  background: #d4884a;
}
.el-slider__button {
  border-color: #d4884a;
}

/* ── 链接 ── */
.el-link.el-link--primary {
  --el-link-text-color: #d4884a;
  --el-link-hover-text-color: #e09a5e;
  --el-link-active-text-color: #c07a3e;
  --el-link-disabled-text-color: #eac097;
}

/* ── 输入框 / 选择框聚焦 ── */
.el-input .el-input__wrapper {
  --el-input-focus-border-color: #d4884a;
  --el-input-hover-border-color: #c0c4cc;
  transition: box-shadow 0.2s;
}
.el-input.is-focus .el-input__wrapper {
  box-shadow: 0 0 0 1px #d4884a inset;
}
.el-select .el-input.is-focus .el-input__wrapper {
  box-shadow: 0 0 0 1px #d4884a inset;
}
.el-input-number .el-input__wrapper {
  --el-input-focus-border-color: #d4884a;
}

/* ── 复选框 / 单选框 ── */
.el-checkbox__input.is-checked .el-checkbox__inner {
  --el-checkbox-checked-bg-color: #d4884a;
  --el-checkbox-checked-border-color: #d4884a;
}
.el-checkbox__input.is-checked + .el-checkbox__label {
  color: #d4884a;
}
.el-radio__input.is-checked .el-radio__inner {
  --el-radio-checked-bg-color: #d4884a;
  --el-radio-checked-border-color: #d4884a;
}

/* ── 分页 ── */
.el-pagination .el-pager li.is-active {
  --el-pagination-active-bg-color: #d4884a;
  --el-pagination-active-border-color: #d4884a;
}

/* ── 步骤条 ── */
.el-step__title.is-process {
  color: #d4884a;
  font-weight: 600;
}
.el-step__title.is-finish {
  color: #c07a3e;
}
.el-step__head.is-finish .el-step__icon {
  background: #d4884a;
  border-color: #d4884a;
}
.el-step__head.is-process .el-step__icon {
  border-color: #d4884a;
  color: #d4884a;
}

/* ── 下拉菜单 ── */
.el-dropdown-menu__item:not(.is-disabled):hover {
  color: #d4884a;
  background: #fdf3e8;
}
.el-select-dropdown__item.is-selected {
  color: #d4884a;
}
.el-select-dropdown__item:not(.is-disabled):hover {
  background: #fdf3e8;
}
</style>

<style scoped>
.header {
  text-align: center;
  margin-bottom: 24px;
  padding-bottom: 20px;
  position: relative;
}

.header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 70%;
  max-width: 420px;
  height: 1px;
  background: linear-gradient(90deg, transparent, #d4884a 15%, #e6a23c 85%, transparent);
}

.header h1 {
  margin: 0 0 6px;
  font-size: 22px;
  font-family: 'ZCOOL XiaoWei', 'STKaiti', 'KaiTi', serif;
  letter-spacing: 2px;
}

.debug-trigger {
  cursor: default;
  user-select: none;
}

.upload-row {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 16px;
}

.upload-row :deep(.upload-section) {
  background: rgba(255,255,255,0.65);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid #ebeef5;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.upload-row :deep(.upload-section):hover {
  border-color: #e0dbd0;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}

@media (min-width: 768px) {
  .upload-row {
    flex-direction: row;
  }
}

@media (max-width: 767px) {
  .upload-row :deep(.upload-section) {
    padding: 12px;
  }
}

.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}

.actions :deep(.el-button--primary) {
  box-shadow: 0 2px 12px rgba(212, 136, 74, 0.25);
  transition: box-shadow 0.3s, transform 0.2s;
}

.actions :deep(.el-button--primary):hover {
  box-shadow: 0 4px 20px rgba(212, 136, 74, 0.4);
}

.actions :deep(.el-button--primary):active {
  transform: scale(0.97);
}

.progress-section {
  margin-bottom: 20px;
  padding: 0 4px;
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
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
  background: #fdf6ec;
  border: 1px solid #faecd8;
  transition: background 0.2s, box-shadow 0.2s;
}

.warn-tag:hover {
  background: #faecd8;
  box-shadow: 0 1px 6px rgba(230, 162, 60, 0.15);
}

.warn-tag--low {
  color: #909399;
  background: #f5f7fa;
  border-color: #e4e7ed;
}

.warn-tag--low:hover {
  background: #e9ecef;
  box-shadow: 0 1px 6px rgba(144, 147, 153, 0.12);
}

.result-tabs {
  margin-top: 4px;
}

.result-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}

.result-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background: #e8e5df;
}

.result-tabs :deep(.el-tabs__item) {
  font-size: 14px;
  font-weight: 600;
}

.result-tabs :deep(.el-tabs__item.is-active) {
  color: #d4884a;
}

.empty-tab {
  color: #909399;
  font-size: 14px;
  padding: 24px;
  text-align: center;
}

.empty-state {
  margin-top: 24px;
  padding: 48px 20px;
  text-align: center;
  background: rgba(255,255,255,0.6);
  border-radius: 14px;
  border: 1px dashed #d0d7de;
}

.empty-state-inner {
  max-width: 360px;
  margin: 0 auto;
}

.empty-icon {
  width: 72px;
  height: 72px;
  margin-bottom: 16px;
}

.empty-title {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 600;
  color: #2c2c2c;
  font-family: 'ZCOOL XiaoWei', 'STKaiti', 'KaiTi', serif;
  letter-spacing: 1px;
}

.empty-desc {
  margin: 0;
  font-size: 13px;
  color: #909399;
  line-height: 1.6;
}

@media (max-width: 767px) {
  .empty-state {
    padding: 32px 16px;
  }

  .empty-icon {
    width: 56px;
    height: 56px;
  }

  .empty-title {
    font-size: 15px;
  }

  .empty-desc {
    font-size: 12px;
  }
}

@media (max-width: 767px) {
  .header h1 {
    font-size: 17px;
  }

  .result-tabs :deep(.el-tabs__item) {
    padding: 0 12px;
    font-size: 13px;
  }
}
</style>
