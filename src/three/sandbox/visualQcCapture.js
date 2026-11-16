// 离屏多视角截图：给不经过模型预览编辑器的生成结果（例如玩家角色）
// 提供与模型编辑器一致的视觉质检输入。
// 注意：只临时借用模型对象做渲染，结束后恢复其父节点与本地变换，不修改模型本身。

const VIEWS = Object.freeze([
  { label: 'front', direction: [0, 0.15, 1], up: [0, 1, 0] },
  { label: 'side', direction: [1, 0.15, 0], up: [0, 1, 0] },
  { label: 'top', direction: [0, 1, 0.001], up: [0, 0, -1] },
  { label: 'isometric', direction: [1, 0.75, 1], up: [0, 1, 0] },
])

// 顶部截图叠加占地轮廓（青色），只作为“大致底面范围”的参考。
function buildFootprintOverlay(THREE, model) {
  const points = model?.userData?.sandboxFootprintPolygon?.points
  if (!Array.isArray(points) || points.length < 3) return null
  const group = new THREE.Group()
  group.name = 'visual-qc-footprint-overlay'
  const y = 0.02
  const positions = []
  for (let index = 1; index < points.length; index += 1) {
    positions.push(points[index - 1].x, y, points[index - 1].z, points[index].x, y, points[index].z)
  }
  const last = points[points.length - 1]
  positions.push(last.x, y, last.z, points[0].x, y, points[0].z)
  const lineGeometry = new THREE.BufferGeometry()
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const line = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({
    color: '#38e8ff', depthTest: false, transparent: true, opacity: 0.95,
  }))
  line.renderOrder = 100
  group.add(line)
  const contour = points.map(point => new THREE.Vector2(point.x, point.z))
  const faces = THREE.ShapeUtils.triangulateShape(contour, [])
  const fillPositions = []
  for (const face of faces) {
    for (const index of face) fillPositions.push(points[index].x, y - 0.005, points[index].z)
  }
  if (fillPositions.length) {
    const fillGeometry = new THREE.BufferGeometry()
    fillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fillPositions, 3))
    const fill = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({
      color: '#38e8ff', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide,
    }))
    fill.renderOrder = 99
    group.add(fill)
  }
  return group
}

function disposeOverlay(overlay) {
  overlay.traverse(object => {
    object.geometry?.dispose?.()
    object.material?.dispose?.()
  })
}

export async function captureModelViews(THREE, model, { width = 512, height = 384 } = {}) {
  if (!model?.isObject3D) throw new Error('缺少可渲染的模型')
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#17242b')
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.01, 1000)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(width, height)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = false
  renderer.domElement.style?.setProperty?.('display', 'none')
  scene.add(new THREE.HemisphereLight(0xffffff, 0x52616b, 2.1))
  const key = new THREE.DirectionalLight(0xffffff, 2.4)
  key.position.set(8, 12, 10)
  scene.add(key)

  const parent = model.parent
  const originalPosition = model.position.clone()
  const originalRotation = model.rotation.clone()
  const originalScale = model.scale.clone()
  scene.add(model)
  model.position.set(0, 0, 0)
  model.rotation.set(0, 0, 0)
  model.scale.set(1, 1, 1)
  try {
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    if (box.isEmpty()) throw new Error('模型没有可见几何，无法截图')
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxSize = Math.max(size.x, size.y, size.z, 0.1)
    const distance = maxSize * 1.9
    const screenshots = []
    for (const view of VIEWS) {
      camera.up.set(view.up[0], view.up[1], view.up[2])
      camera.position.copy(center).add(
        new THREE.Vector3(view.direction[0], view.direction[1], view.direction[2])
          .normalize()
          .multiplyScalar(distance),
      )
      camera.lookAt(center)
      camera.updateProjectionMatrix()
      const overlay = view.label === 'top' ? buildFootprintOverlay(THREE, model) : null
      if (overlay) model.add(overlay)
      try {
        renderer.render(scene, camera)
        screenshots.push({
          label: overlay ? view.label + '-footprint' : view.label,
          imageDataUrl: renderer.domElement.toDataURL('image/jpeg', 0.68),
        })
      } finally {
        if (overlay) {
          model.remove(overlay)
          disposeOverlay(overlay)
        }
      }
    }
    return screenshots
  } finally {
    scene.remove(model)
    model.position.copy(originalPosition)
    model.rotation.copy(originalRotation)
    model.scale.copy(originalScale)
    if (parent) parent.add(model)
    renderer.dispose()
    renderer.domElement?.remove?.()
  }
}
