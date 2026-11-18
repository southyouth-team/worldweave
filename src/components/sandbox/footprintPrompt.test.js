import { describe, expect, it } from 'vitest'
import { buildFootprintPromptSuffix } from './footprintPrompt.js'

const square = [
  { x: -2, z: -2 },
  { x: 2, z: -2 },
  { x: 2, z: 2 },
  { x: -2, z: 2 },
]

describe('生成提示里的占地约束', () => {
  it('占地区域模式要求底面贴合多边形轮廓', () => {
    const suffix = buildFootprintPromptSuffix('area', square)
    expect(suffix).toContain('占地区域')
    expect(suffix).toContain('底面')
    expect(suffix).toContain('(-2.00, -2.00)')
    expect(suffix).toContain('(2.00, 2.00)')
  })

  it('空间占据模式只要求不超出区域，允许不满铺', () => {
    const suffix = buildFootprintPromptSuffix('space', square)
    expect(suffix).toContain('空间区域')
    expect(suffix).toContain('不满铺')
    expect(suffix).not.toContain('必须贴合')
  })

  it('未选择模式或点数不足时返回空字符串', () => {
    expect(buildFootprintPromptSuffix('none', square)).toBe('')
    expect(buildFootprintPromptSuffix('area', [{ x: 0, z: 0 }])).toBe('')
    expect(buildFootprintPromptSuffix('space', null)).toBe('')
  })
})
