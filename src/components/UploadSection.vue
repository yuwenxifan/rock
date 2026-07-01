<script setup>
import { ref, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { MAX_FILE_SIZE, ACCEPT_TYPES } from '../utils/constants.js'

const props = defineProps({
  title: { type: String, required: true },
  stage: { type: String, required: true },
  images: { type: Array, default: () => [] },
  activeIndex: { type: Number, default: 0 },
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
        <svg class="upload-icon-svg" viewBox="0 0 36 36" fill="none">
            <rect x="2" y="6" width="32" height="24" rx="3" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
            <circle cx="12" cy="16" r="3.5" stroke="currentColor" stroke-width="1.5" opacity="0.7"/>
            <path d="M2 25l8-8 6 5 5-5 11 9" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" opacity="0.4"/>
            <path d="M27 7l1 1.5 1.5 1-1.5 1-1 1.5-1-1.5-1.5-1 1.5-1z" fill="#e6a23c"/>
          </svg>
        <div>拖拽或点击上传截图</div>
        <div class="upload-hint">PNG / JPG，单张 ≤ 10MB，可多张</div>
      </div>
    </el-upload>

    <div v-if="images.length" class="thumb-list">
      <div
        v-for="(img, idx) in images"
        :key="idx"
        class="thumb-item"
        :class="{ active: idx === activeIndex }"
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
  color: #2c2c2c;
}

.upload-dragger {
  width: 100%;
}

.upload-dragger :deep(.el-upload-dragger) {
  padding: 16px 12px;
  border: 2px dashed #d0d7de;
  border-radius: 10px;
  transition: border-color 0.25s, background 0.25s;
  background: rgba(255,255,255,0.5);
}

.upload-dragger :deep(.el-upload-dragger):hover {
  border-color: #d4884a;
  background: rgba(255,255,255,0.8);
}

@media (max-width: 767px) {
  .upload-dragger :deep(.el-upload-dragger) {
    padding: 10px 8px;
  }

  .upload-inner {
    font-size: 12px;
  }

  .upload-icon-svg {
    width: 30px;
    height: 30px;
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

  .thumb-delete {
    top: -8px !important;
    right: -8px !important;
    width: 24px !important;
    height: 24px !important;
    min-height: 24px !important;
    font-size: 16px;
  }
}

.upload-inner {
  text-align: center;
  color: #606266;
  font-size: 13px;
}

.upload-icon-svg {
  width: 36px;
  height: 36px;
  margin-bottom: 4px;
  color: #909399;
  transition: color 0.25s;
}

.upload-dragger:hover .upload-icon-svg {
  color: #d4884a;
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
  transition: transform 0.2s;
}

.thumb-item.active {
  transform: translateY(-2px);
}

.thumb-item img {
  width: 80px;
  height: 48px;
  object-fit: cover;
  border-radius: 5px;
  border: 2px solid #dcdfe6;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.thumb-item:hover img {
  border-color: #d4884a;
}

.thumb-item.active img {
  border-color: #d4884a;
  box-shadow: 0 0 0 3px rgba(212, 136, 74, 0.25);
}

.thumb-label {
  display: block;
  font-size: 11px;
  text-align: center;
  margin-top: 2px;
  color: #606266;
  transition: color 0.2s, font-weight 0.2s;
}

.thumb-item.active .thumb-label {
  color: #d4884a;
  font-weight: 600;
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
