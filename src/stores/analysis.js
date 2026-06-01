import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { runFullAnalysis } from '../composables/useAnalysis.js'
import { validateStage, computeDelta } from '../composables/useValidation.js'
import { loadConfig } from '../utils/config.js'
import {
  restoreStageImages,
  saveState,
  loadState,
  clearState,
  clearImageBlobs,
  deleteImageBlob,
  saveImageBlob,
} from '../composables/usePersistence.js'
import { ANALYSIS_STEPS } from '../utils/constants.js'

export const useAnalysisStore = defineStore('analysis', () => {
  const beforeImages = ref([])
  const afterImages = ref([])
  const beforeMeta = ref([])
  const afterMeta = ref([])

  const beforeResult = ref(null)
  const afterResult = ref(null)
  const delta = ref(null)
  const errors = ref([])
  const warnings = ref([])

  const analyzing = ref(false)
  const progressStep = ref('')
  const progressPercent = ref(0)

  const canAnalyze = computed(
    () => beforeImages.value.length > 0 && afterImages.value.length > 0 && !analyzing.value,
  )

  const hasResults = computed(() => delta.value != null && errors.value.length === 0)

  function setProgress(step, percent) {
    const stepInfo = ANALYSIS_STEPS.find((s) => s.key === step)
    progressStep.value = stepInfo?.label || step
    progressPercent.value = Math.round(percent)
  }

  async function addImages(stage, files) {
    const list = stage === 'before' ? beforeImages : afterImages
    const meta = stage === 'before' ? beforeMeta : afterMeta

    for (let i = 0; i < files.length; i++) {
      const idx = list.value.length
      list.value.push(files[i])
      await saveImageBlob(stage, idx, files[i])
      meta.value.push({
        index: idx,
        name: files[i].name,
        type: files[i].type,
        size: files[i].size,
      })
    }
    persistMeta()
  }

  async function removeImage(stage, index) {
    const list = stage === 'before' ? beforeImages : afterImages
    const meta = stage === 'before' ? beforeMeta : afterMeta

    await deleteImageBlob(stage, index)
    list.value.splice(index, 1)
    meta.value.splice(index, 1)

    for (let i = 0; i < list.value.length; i++) {
      await saveImageBlob(stage, i, list.value[i])
      meta.value[i] = {
        index: i,
        name: list.value[i].name,
        type: list.value[i].type,
        size: list.value[i].size,
      }
    }
    persistMeta()
  }

  async function startAnalysis() {
    if (!canAnalyze.value) return

    analyzing.value = true
    errors.value = []
    warnings.value = []
    beforeResult.value = null
    afterResult.value = null
    delta.value = null

    try {
      const result = await runFullAnalysis(
        beforeImages.value,
        afterImages.value,
        (step, percent) => setProgress(step, percent),
      )

      beforeResult.value = result.beforeResult
      afterResult.value = result.afterResult
      errors.value = result.errors
      warnings.value = result.warnings

      if (!result.blocked) {
        delta.value = result.delta
      }

      persistMeta()
    } catch (e) {
      errors.value = [e.message || '分析过程发生未知错误']
    } finally {
      analyzing.value = false
    }
  }

  async function reset() {
    beforeImages.value = []
    afterImages.value = []
    beforeMeta.value = []
    afterMeta.value = []
    beforeResult.value = null
    afterResult.value = null
    delta.value = null
    errors.value = []
    warnings.value = []
    progressStep.value = ''
    progressPercent.value = 0
    await clearImageBlobs()
    clearState()
  }

  function persistMeta() {
    saveState({
      beforeMeta: beforeMeta.value,
      afterMeta: afterMeta.value,
      delta: delta.value,
      errors: errors.value,
      warnings: warnings.value,
      beforeResult: serializeResult(beforeResult.value),
      afterResult: serializeResult(afterResult.value),
    })
  }

  function serializeResult(result) {
    if (!result) return null
    return {
      totals: result.totals,
      errors: result.errors,
      warnings: result.warnings,
      conflictDetails: result.conflictDetails,
      screenshotDebug: result.screenshotDebug?.map((s) => ({
        index: s.index,
        width: s.width,
        height: s.height,
        cells: s.cells,
      })),
    }
  }

  async function restoreFromStorage() {
    const state = loadState()
    if (!state) return

    beforeMeta.value = state.beforeMeta || []
    afterMeta.value = state.afterMeta || []
    delta.value = state.delta || null
    errors.value = state.errors || []
    warnings.value = state.warnings || []
    beforeResult.value = state.beforeResult || null
    afterResult.value = state.afterResult || null

    beforeImages.value = await restoreStageImages('before', beforeMeta.value)
    afterImages.value = await restoreStageImages('after', afterMeta.value)

    for (const img of [...beforeImages.value, ...afterImages.value]) {
      URL.createObjectURL(img)
    }
  }

  function getThumbnailUrl(file) {
    return URL.createObjectURL(file)
  }

  // ── 重新校验并更新结果 ──
  async function _revalidateResult(stage, result) {
    const recognized = []
    for (const ss of result.screenshotDebug) {
      for (const c of (ss.cells || [])) {
        if (c.itemName && c.quantity != null && !c.skipped) {
          recognized.push({
            screenshotIndex: c.screenshotIndex ?? ss.index,
            itemName: c.itemName,
            quantity: c.quantity,
            row: c.row,
            col: c.col,
            histDistance: c.histDistance,
          })
        }
      }
    }

    const { totals, errors, warnings, conflictDetails } = validateStage(recognized, stage === 'before' ? '跑图前' : '跑图后')
    result.totals = totals
    result.errors = errors
    result.warnings = [...(result.warnings?.filter((w) => !w.includes('重复匹配')) || []), ...warnings]
    result.conflictDetails = conflictDetails

    if (beforeResult.value?.totals && afterResult.value?.totals) {
      const config = await loadConfig()
      delta.value = computeDelta(beforeResult.value.totals, afterResult.value.totals, config.items)
    }

    const allWarnings = []
    if (beforeResult.value?.warnings) allWarnings.push(...beforeResult.value.warnings)
    if (afterResult.value?.warnings) allWarnings.push(...afterResult.value.warnings)
    warnings.value = allWarnings

    const allErrors = []
    if (beforeResult.value?.errors) allErrors.push(...beforeResult.value.errors)
    if (afterResult.value?.errors) allErrors.push(...afterResult.value.errors)
    errors.value = allErrors

    persistMeta()
  }

  // ── 手动编辑识别结果 ──
  async function editCellResult(stage, screenshotIndex, row, col, newName, newQuantity) {
    const result = stage === 'before' ? beforeResult.value : afterResult.value
    if (!result?.screenshotDebug) return

    const screenshot = result.screenshotDebug.find((s) => s.index === screenshotIndex)
    if (!screenshot) return

    const cell = screenshot.cells.find((c) => c.row === row && c.col === col)
    if (!cell) return

    cell.itemName = newName || null
    cell.quantity = newQuantity != null ? newQuantity : null
    cell.status = (newName && newQuantity != null) ? 'success' : 'failed'

    await _revalidateResult(stage, result)

    // 触发 canvas 重绘（修改嵌套属性不会触发 watch，需替换引用）
    if (stage === 'before') beforeResult.value = { ...beforeResult.value }
    else afterResult.value = { ...afterResult.value }
  }

  // ── 排除已识别物品 ──
  async function excludeCellResult(stage, screenshotIndex, row, col) {
    const result = stage === 'before' ? beforeResult.value : afterResult.value
    if (!result?.screenshotDebug) return

    const screenshot = result.screenshotDebug.find((s) => s.index === screenshotIndex)
    if (!screenshot) return

    const cell = screenshot.cells.find((c) => c.row === row && c.col === col)
    if (!cell) return

    cell.itemName = null
    cell.quantity = null
    cell.status = 'ignored'

    await _revalidateResult(stage, result)

    // 触发 canvas 重绘（修改嵌套属性不会触发 watch，需替换引用）
    if (stage === 'before') beforeResult.value = { ...beforeResult.value }
    else afterResult.value = { ...afterResult.value }
  }

  return {
    beforeImages,
    afterImages,
    beforeResult,
    afterResult,
    delta,
    errors,
    warnings,
    analyzing,
    progressStep,
    progressPercent,
    canAnalyze,
    hasResults,
    addImages,
    removeImage,
    startAnalysis,
    reset,
    restoreFromStorage,
    getThumbnailUrl,
    editCellResult,
    excludeCellResult,
  }
})
