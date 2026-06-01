import { DB_NAME, DB_VERSION, STORE_IMAGES, STORAGE_KEY } from '../utils/constants.js'
import { blobToBase64, base64ToBlob } from '../utils/imageProcessing.js'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'id' })
      }
    }
  })
}

/**
 * @param {'before'|'after'} stage
 * @param {number} index
 * @param {Blob} blob
 */
export async function saveImageBlob(stage, index, blob) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite')
    tx.objectStore(STORE_IMAGES).put({
      id: `${stage}_${index}`,
      stage,
      index,
      blob,
      updatedAt: Date.now(),
    })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadAllImageBlobs() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly')
    const req = tx.objectStore(STORE_IMAGES).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

export async function clearImageBlobs() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite')
    tx.objectStore(STORE_IMAGES).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function deleteImageBlob(stage, index) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite')
    tx.objectStore(STORE_IMAGES).delete(`${stage}_${index}`)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearState() {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * 将 File 列表持久化到 IndexedDB，返回可序列化的元数据
 */
export async function persistStageImages(stage, files) {
  const meta = []
  for (let i = 0; i < files.length; i++) {
    await saveImageBlob(stage, i, files[i])
    meta.push({
      index: i,
      name: files[i].name,
      type: files[i].type,
      size: files[i].size,
    })
  }
  return meta
}

/**
 * 从 IndexedDB 恢复 File 列表
 */
export async function restoreStageImages(stage, meta) {
  const all = await loadAllImageBlobs()
  const files = []
  for (const m of meta || []) {
    const record = all.find((r) => r.stage === stage && r.index === m.index)
    if (record?.blob) {
      files.push(new File([record.blob], m.name, { type: m.type }))
    }
  }
  return files
}

export { blobToBase64, base64ToBlob }
