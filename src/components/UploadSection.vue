<script setup>
import { ref, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { MAX_FILE_SIZE, ACCEPT_TYPES } from '../utils/constants.js'

const props = defineProps({
  title: { type: String, required: true },
  stage: { type: String, required: true },
  images: { type: Array, default: () => [] },
})

const emit = defineEmits(['add', 'remove', 'select'])

const uploadRef = ref(null)
const urlCache = new Map()

function getUrl(file) {
  if (!urlCache.has(file)) {
    urlCache.set(file, URL.createObjectURL(file))
  }
  return urlCache.get(file)
}

onUnmounted(() => {
  urlCache.forEach((url) => URL.revokeObjectURL(url))
  urlCache.clear()
})

function validateFile(file) {
  if (!ACCEPT_TYPES.includes(file.type)) {
    ElMessage.error('仅支持 PNG / JPG 格式')
    return false
  }
  if (file.size > MAX_FILE_SIZE) {
    ElMessage.error('单张图片不能超过 10MB')
    return false
  }
  return true
}

function handleChange(uploadFile) {
  const file = uploadFile.raw
  if (!file || !validateFile(file)) return
  emit('add', [file])
  uploadRef.value?.clearFiles()
}

function handleRemove(index) {
  emit('remove', index)
}

function handleSelect(index) {
  emit('select', index)
}

</script>

<template>
  <div class="upload-section">
    <h3>{{ title }}</h3>
    <el-upload
      ref="uploadRef"
      drag
      :auto-upload="false"
      :show-file-list="false"
      accept=".png,.jpg,.jpeg"
      multiple
      :on-change="handleChange"
      class="upload-dragger"
    >
      <div class="upload-inner">
        <div class="upload-icon">📷</div>
        <div>拖拽或点击上传截图</div>
        <div class="upload-hint">PNG / JPG，单张 ≤ 10MB，可多张</div>
      </div>
    </el-upload>

    <div v-if="images.length" class="thumb-list">
      <div
        v-for="(img, idx) in images"
        :key="idx"
        class="thumb-item"
        @click="handleSelect(idx)"
      >
        <img :src="getUrl(img)" :alt="`截图${idx + 1}`" />
        <span class="thumb-label">截图 {{ idx + 1 }}</span>
        <el-button
          type="danger"
          size="small"
          circle
          class="thumb-delete"
          @click.stop="handleRemove(idx)"
        >
          ×
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.upload-section {
  flex: 1;
  min-width: 260px;
}

.upload-section h3 {
  margin: 0 0 8px;
  font-size: 15px;
  color: #303133;
}

.upload-dragger {
  width: 100%;
}

.upload-dragger :deep(.el-upload-dragger) {
  padding: 16px 12px;
}

@media (max-width: 767px) {
  .upload-dragger :deep(.el-upload-dragger) {
    padding: 10px 8px;
  }

  .upload-inner {
    font-size: 12px;
  }

  .upload-icon {
    font-size: 22px;
    margin-bottom: 2px;
  }

  .upload-hint {
    font-size: 10px;
  }

  .thumb-item {
    width: 64px;
  }

  .thumb-item img {
    width: 64px;
    height: 38px;
  }
}

.upload-inner {
  text-align: center;
  color: #606266;
  font-size: 13px;
}

.upload-icon {
  font-size: 28px;
  margin-bottom: 4px;
}

.upload-hint {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
}

.thumb-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.thumb-item {
  position: relative;
  width: 80px;
  cursor: pointer;
}

.thumb-item img {
  width: 80px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  border: 2px solid #dcdfe6;
}

.thumb-item:hover img {
  border-color: #409eff;
}

.thumb-label {
  display: block;
  font-size: 11px;
  text-align: center;
  margin-top: 2px;
  color: #606266;
}

.thumb-delete {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px !important;
  height: 20px !important;
  min-height: 20px !important;
  padding: 0 !important;
  font-size: 14px;
}
</style>
