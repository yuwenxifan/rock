/**
 * 同阶段校验：
 * - 同一截图内同物品多次匹配 → 取置信度最高的，输出警告
 * - 不同截图同物品数量不一致 → 阻断报错
 *
 * @param {Array<{ screenshotIndex: number, itemName: string, quantity: number, row: number, col: number, histDistance?: number }>} recognized
 * @returns {{ totals: Record<string, number>, errors: string[], warnings: string[], conflictDetails: object[] }}
 */
export function validateStage(recognized, stageLabel = '') {
  const byItem = new Map()
  const warnings = []
  const errors = []
  const conflictDetails = []
  const discarded = []

  for (const entry of recognized) {
    if (!entry.itemName || entry.quantity == null) continue
    if (!byItem.has(entry.itemName)) {
      byItem.set(entry.itemName, [])
    }
    byItem.get(entry.itemName).push(entry)
  }

  const totals = {}

  for (const [itemName, entries] of byItem) {
    // ── 同截图内去重：每个截图只保留置信度最高的那条 ──
    const byScreenshot = new Map()
    for (const e of entries) {
      if (!byScreenshot.has(e.screenshotIndex)) {
        byScreenshot.set(e.screenshotIndex, [])
      }
      byScreenshot.get(e.screenshotIndex).push(e)
    }

    const deduped = []
    for (const [si, group] of byScreenshot) {
      if (group.length > 1) {
        // 取 histDistance 最小的（最相似），无 histDistance 时取第一条
        group.sort((a, b) => (a.histDistance ?? 1) - (b.histDistance ?? 1))
        const kept = group[0]
        const dropped = group.slice(1)
        for (const d of dropped) {
          discarded.push({ screenshotIndex: si, row: d.row, col: d.col, itemName })
        }
        const discardedInfo = dropped
          .map((d) => `[${d.row},${d.col}]`)
          .join('、')
        warnings.push(
          `[${stageLabel}] 物品「${itemName}」在截图${si + 1}中重复匹配（保留[${kept.row},${kept.col}]，丢弃 ${discardedInfo}）`,
        )
        deduped.push(kept)
      } else {
        deduped.push(group[0])
      }
    }

    // ── 跨截图数量一致性检查 ──
    const quantities = [...new Set(deduped.map((e) => e.quantity))]

    if (quantities.length > 1) {
      const detail = {
        itemName,
        entries: deduped.map((e) => ({
          screenshotIndex: e.screenshotIndex,
          quantity: e.quantity,
          row: e.row,
          col: e.col,
        })),
      }
      conflictDetails.push(detail)

      const parts = deduped
        .map((e) => `截图${e.screenshotIndex + 1}：${e.quantity}`)
        .join('；')

      errors.push(
        `物品「${itemName}」在同一阶段内数量不一致（${parts}）。同一阶段内同一物品数量不一致，请检查截图是否为同一背包状态。`,
      )
      continue
    }

    totals[itemName] = quantities[0]
  }

  return { totals, errors, warnings, conflictDetails, discarded }
}

/**
 * 计算增量结果
 */
export function computeDelta(beforeTotals, afterTotals, items) {
  const itemDeltas = items.map((item) => {
    const before = beforeTotals[item.name] ?? 0
    const after = afterTotals[item.name] ?? 0
    return {
      name: item.name,
      category: item.category,
      ball: item.ball,
      before,
      after,
      delta: after - before,
    }
  })

  const categorySummary = {}
  for (const d of itemDeltas) {
    categorySummary[d.category] = (categorySummary[d.category] ?? 0) + d.delta
  }

  const ballSummary = {}
  for (const d of itemDeltas) {
    ballSummary[d.ball] = (ballSummary[d.ball] ?? 0) + d.delta
  }

  return { itemDeltas, categorySummary, ballSummary }
}
