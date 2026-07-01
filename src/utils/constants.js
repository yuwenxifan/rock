export const BALL_ORDER = [
  '普通球',
  '光合球',
  '网兜球',
  '调温球',
  '淘沙球',
  '绝缘球',
  '美妙球',
  '好战球',
  '暗星球',
  '变幻球',
]

export const BALL_COLORS = {
  '普通球': '#8b9cb0',
  '光合球': '#67c23a',
  '网兜球': '#e6a23c',
  '调温球': '#f56c6c',
  '淘沙球': '#c77d33',
  '绝缘球': '#c9b540',
  '美妙球': '#e88eb0',
  '好战球': '#e85d3a',
  '暗星球': '#7b5ea7',
  '变幻球': '#409eff',
}

export const CATEGORY_ORDER = ['花', '矿']

export const MAX_FILE_SIZE = 10 * 1024 * 1024
export const ACCEPT_TYPES = ['image/png', 'image/jpeg', 'image/jpg']

export const ANALYSIS_STEPS = [
  { key: 'config', label: '加载配置' },
  { key: 'segment', label: '分割格子' },
  { key: 'match', label: '图像比对' },
  { key: 'ocr', label: 'OCR 识别' },
  { key: 'validate', label: '校验' },
  { key: 'compute', label: '计算' },
]

export const DB_NAME = 'roke-inventory-db'
export const DB_VERSION = 1
export const STORE_IMAGES = 'images'
export const STORAGE_KEY = 'roke-inventory-state'
