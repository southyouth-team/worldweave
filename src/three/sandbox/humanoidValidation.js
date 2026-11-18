/**
 * 生成角色的人形自检：判断 AI 返回的模型是否像一具站立的人形角色。
 *
 * 背景：仅靠提示词无法保证 LLM 返回人形（曾多次返回"三个球拼在一起"）。
 * 这里用几何启发式做客观判断，失败时由调用方触发一次带纠正提示的重试。
 *
 * 判据（全部通过才算人形）：
 * 1. 网格数量 ≥ 5（头/躯干/两臂/两腿分开建至少如此）
 * 2. 高宽比 ≥ 1.6（站立体型；球堆接近 1）
 * 3. 至少识别到 3 类命名肢体（head/leg/arm 模式），或存在明显的下半身部件群
 */
const LIMB_PATTERNS = {
  head: /head|skull|neck|face/i,
  leg: /leg|thigh|shin|foot|feet/i,
  arm: /arm|forearm|hand|shoulder/i,
  torso: /torso|body|chest|hip|pelvis/i,
}

export function analyzeHumanoidModel(THREE, model) {
  const metrics = {
    meshCount: 0,
    width: 0,
    height: 0,
    depth: 0,
    heightRatio: 0,
    limbKinds: [],
    lowerBodyMeshes: 0,
  }
  if (!model?.isObject3D) return { humanoid: false, reasons: ['模型为空'], metrics }

  const meshes = []
  model.traverse(object => { if (object.isMesh) meshes.push(object) })
  metrics.meshCount = meshes.length

  model.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(model)
  if (bounds.isEmpty()) return { humanoid: false, reasons: ['模型没有有效尺寸'], metrics }
  const size = bounds.getSize(new THREE.Vector3())
  metrics.width = size.x
  metrics.height = size.y
  metrics.depth = size.z
  const footprint = Math.max(size.x, size.z, 0.001)
  metrics.heightRatio = size.y / footprint

  const limbKinds = new Set()
  model.traverse(object => {
    if (!object.name) return
    for (const [kind, pattern] of Object.entries(LIMB_PATTERNS)) {
      if (pattern.test(object.name)) limbKinds.add(kind)
    }
  })
  metrics.limbKinds = [...limbKinds]

  // 下半身部件：部件中心落在总高度下 35% 区间的网格数量
  const lowerBandTop = bounds.min.y + size.y * 0.35
  const center = new THREE.Vector3()
  for (const mesh of meshes) {
    const meshBounds = new THREE.Box3().setFromObject(mesh)
    if (meshBounds.isEmpty()) continue
    meshBounds.getCenter(center)
    if (center.y <= lowerBandTop) metrics.lowerBodyMeshes += 1
  }

  const reasons = []
  if (metrics.meshCount < 5) reasons.push(`网格数量过少（${metrics.meshCount} < 5）`)
  if (metrics.heightRatio < 1.6) reasons.push(`高宽比不足（${metrics.heightRatio.toFixed(2)} < 1.6）`)
  // 仅"头+躯干"不算人形：命名肢体至少 3 类，或有明显的下半身部件群。
  if (metrics.limbKinds.length < 3 && metrics.lowerBodyMeshes < 2) {
    reasons.push('没有可识别的头/腿/臂部件，且下半身部件不足')
  }
  return { humanoid: reasons.length === 0, reasons, metrics }
}

// 生成失败后的纠正提示：把具体失败指标塞回给模型，要求重建人形。
export function buildHumanoidRetryPrompt(failure) {
  const detail = failure?.reasons?.length ? failure.reasons.join('；') : '结果不像人形'
  return `\n\n【重要纠正】上一次生成结果不符合人形要求：${detail}。这次必须重建：一个站立的人形角色，身高约为宽度的 3 倍以上；头部、躯干、左臂、右臂、左腿、右腿必须是彼此分离的独立网格，不能用一个球或几个球代替身体；双脚落在 y=0，正面朝向 +Z。`
}
