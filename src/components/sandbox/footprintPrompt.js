// 把勾绘的占地多边形转成生成提示里的约束文字。
// points 为以模型中心为原点、Y=0 为地面的局部坐标（米）。

export function buildFootprintPromptSuffix(mode, points) {
  if (!Array.isArray(points) || points.length < 3) return ''
  if (mode !== 'area' && mode !== 'space') return ''
  const list = points
    .map(point => `(${point.x.toFixed(2)}, ${point.z.toFixed(2)})`)
    .join('、')
  if (mode === 'area') {
    return `。模型的底面必须贴合给定的占地区域多边形：轮廓顶点（以模型中心为原点，X/Z 单位米，Y=0 为地面）依次为 ${list}。主体立在 y=0 平面上，底面沿这条轮廓走，不要明显超出该轮廓，也不要把轮廓缩得太小。`
  }
  return `。模型应放置在给定的空间区域多边形内：区域顶点（以模型中心为原点，X/Z 单位米）依次为 ${list}。模型可以不满铺这块区域，但任何部分都不要超出该区域。`
}
