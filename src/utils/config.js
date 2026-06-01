import { BALL_ORDER, CATEGORY_ORDER } from './constants.js'

/**
 * @typedef {Object} ItemConfig
 * @property {string} name
 * @property {string} image
 * @property {'花'|'矿'} category
 * @property {string} ball
 */

/**
 * @typedef {Object} AppSettings
 * @property {number} aspectRatioMin
 * @property {number} aspectRatioMax
 * @property {number} edgeMarginRatio
 * @property {number} gridColumns
 * @property {{ left: number, right: number, top: number, bottom: number }} searchRegion
 */

let cachedConfig = null

export function clearConfigCache() {
  cachedConfig = null
}

/** @returns {Promise<{ items: ItemConfig[], settings: AppSettings }>} */
export async function loadConfig(force = false) {
  if (cachedConfig && !force) return cachedConfig
  const res = await fetch('/config/items.json')
  if (!res.ok) throw new Error('无法加载物品配置')
  cachedConfig = await res.json()
  return cachedConfig
}

export function getImageUrl(filename) {
  return `/config/images/${filename}`
}

export { BALL_ORDER, CATEGORY_ORDER }
