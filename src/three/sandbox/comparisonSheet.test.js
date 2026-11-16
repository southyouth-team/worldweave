import { describe, expect, it } from 'vitest'
import { buildComparisonSheet, comparisonSheetLayout } from './comparisonSheet.js'

describe('视觉质检对比表', () => {
  it('按两列网格排列参考图和视角，尺寸包含标题与标签条', () => {
    const layout = comparisonSheetLayout(5, { columns: 2, cellWidth: 512, cellHeight: 384 })
    expect(layout.cols).toBe(2)
    expect(layout.rows).toBe(3)
    expect(layout.width).toBe(12 * 2 + 2 * 512 + 8)
    expect(layout.height).toBe(12 * 2 + 36 + 3 * (384 + 22) + 2 * 8)
    expect(layout.cells).toHaveLength(5)
    expect(layout.cells[0]).toMatchObject({ x: 12, y: 48 })
    expect(layout.cells[1]).toMatchObject({ x: 12 + 512 + 8, y: 48 })
    const last = layout.cells[4]
    expect(last.x).toBe(12)
    expect(last.y).toBe(48 + 2 * (384 + 22 + 8))
  })

  it('单张图片时只占一列，列数不会超过图片数', () => {
    const layout = comparisonSheetLayout(1, { columns: 2 })
    expect(layout.cols).toBe(1)
    expect(layout.rows).toBe(1)
    expect(layout.cells[0]).toMatchObject({ x: 12, y: 48 })
  })

  it('没有画布环境时返回空字符串（调用方可退回多张截图）', async () => {
    expect(typeof document).toBe('undefined')
    const sheet = await buildComparisonSheet([{ label: 'front', imageDataUrl: 'data:image/png;base64,AAAA' }])
    expect(sheet).toBe('')
  })
})
