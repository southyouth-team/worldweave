// 单张对比表：把参考图和多个渲染视角拼成一张带标签的图，供视觉模型一次评审。
// 借鉴 img2threejs 的「one image per review」，避免多张截图分散注意力。

export function comparisonSheetLayout(cellCount, {
  columns = 2,
  cellWidth = 512,
  cellHeight = 384,
  gap = 8,
  padding = 12,
  headerHeight = 36,
  labelHeight = 22,
} = {}) {
  const total = Math.max(0, Math.floor(Number(cellCount) || 0))
  const cols = Math.max(1, Math.min(columns, Math.max(1, total)))
  const rows = Math.ceil(total / cols)
  const width = padding * 2 + cols * cellWidth + Math.max(0, cols - 1) * gap
  const height = padding * 2 + headerHeight + rows * (cellHeight + labelHeight) + Math.max(0, rows - 1) * gap
  const cells = []
  for (let index = 0; index < total; index += 1) {
    const row = Math.floor(index / cols)
    const col = index % cols
    cells.push({
      x: padding + col * (cellWidth + gap),
      y: padding + headerHeight + row * (cellHeight + labelHeight + gap),
      width: cellWidth,
      height: cellHeight,
    })
  }
  return { width, height, cols, rows, cells, labelHeight, headerHeight, padding, gap, cellWidth, cellHeight }
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = source
  })
}

/**
 * @param {Array<{label?: string, imageDataUrl: string}>} screenshots
 * @param {{referenceImageDataUrl?: string, title?: string, columns?: number}} options
 * @returns {Promise<string>} data URL；环境不支持画布或没有输入时返回空字符串
 */
export async function buildComparisonSheet(screenshots, {
  referenceImageDataUrl = '',
  title = '',
  columns = 2,
  cellWidth = 512,
  cellHeight = 384,
} = {}) {
  if (typeof document === 'undefined') return ''
  const entries = []
  if (referenceImageDataUrl) entries.push({ label: 'reference', imageDataUrl: referenceImageDataUrl })
  for (const shot of screenshots || []) {
    if (shot?.imageDataUrl) entries.push({ label: shot.label || 'view', imageDataUrl: shot.imageDataUrl })
  }
  if (!entries.length) return ''
  const layout = comparisonSheetLayout(entries.length, { columns, cellWidth, cellHeight })
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const context = canvas.getContext('2d')
  if (!context) return ''
  context.fillStyle = '#10181d'
  context.fillRect(0, 0, canvas.width, canvas.height)
  if (title) {
    context.fillStyle = '#dcebe4'
    context.font = '600 18px "Segoe UI", sans-serif'
    context.fillText(String(title), layout.padding, layout.padding + 24)
  }
  for (let index = 0; index < entries.length; index += 1) {
    const cell = layout.cells[index]
    const entry = entries[index]
    context.fillStyle = '#0b1216'
    context.fillRect(cell.x, cell.y, cell.width, cell.height + layout.labelHeight)
    context.fillStyle = '#9ad0ff'
    context.font = '12px Consolas, monospace'
    context.fillText(String(entry.label), cell.x + 8, cell.y + 15)
    try {
      const image = await loadImage(entry.imageDataUrl)
      const scale = Math.min(cell.width / image.width, cell.height / image.height)
      const drawWidth = image.width * scale
      const drawHeight = image.height * scale
      context.drawImage(
        image,
        cell.x + (cell.width - drawWidth) / 2,
        cell.y + layout.labelHeight + (cell.height - drawHeight) / 2,
        drawWidth,
        drawHeight,
      )
    } catch {
      context.fillStyle = '#e66b68'
      context.fillText('image failed to load', cell.x + 8, cell.y + layout.labelHeight + 24)
    }
  }
  return canvas.toDataURL('image/jpeg', 0.82)
}
