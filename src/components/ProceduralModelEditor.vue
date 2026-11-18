<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  createModelAnimationRuntime,
  createSandboxEnvironmentSnapshot,
} from '../three/engine/modelAnimationRuntime.js'
import {
  cloneSandboxObjectResources,
  disposeSandboxObjectResources,
} from '../three/engine/sandboxModelLifecycle.js'
import { getPartTextSpec, updateTextPlate } from '../three/sandbox/textPlateRuntime.js'

const PREVIEW_MODEL_ID = 'preview'

const props = defineProps({
  model: { type: Object, default: null },
  environment: { type: Object, default: () => ({}) },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  canUndo: { type: Boolean, default: false },
  mode: { type: String, default: 'edit' },
  progress: { type: Array, default: () => [] },
  messages: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'edit', 'parameter-change', 'part-select', 'capability-change', 'undo', 'save'])
const canvasHost = ref(null)
const instruction = ref('')
const selectedPartId = ref('')
const selectedPartName = ref('整体模型')
const parameterValues = ref({})
const previewParts = ref([])
const parameters = ref([])
// 调整时附带的参考图片（支持粘贴/选择），随本次编辑请求发送，不写入模型存档
const composerImage = ref('')
const composerImageName = ref('')
const composerImageError = ref('')
const composerImageInput = ref(null)
const MAX_EDIT_IMAGE_BYTES = 8 * 1024 * 1024

const activeProgress = computed(() => [...props.progress].reverse().find(item => item?.status === 'active') || null)
const progressDone = computed(() => props.progress.filter(item => item?.status === 'done').length)
const capabilityManifest = computed(() => props.model?.userData?.proceduralModelCapabilityManifest || {})
const visualQualityReport = computed(() => props.model?.userData?.proceduralModelVisualQuality || null)
const capabilityControl = computed(() => props.model?.userData?.proceduralModelCapabilityControlDocument || {})
const previewAnimationError = ref('')
const visualAnimationTargets = computed(() => {
  const animations = capabilityManifest.value.capabilities?.visual?.animations
  return Array.isArray(animations) ? animations.filter(item => item?.targetPartId) : []
})
const hasAnimationExport = computed(() => {
  const source = props.model?.userData?.proceduralModelSource
  return typeof source === 'string' && source.includes('createModelAnimation')
})
const visualRuntimeLabel = computed(() => {
  if (!visualAnimationTargets.value.length) return '尚未声明动画目标'
  return hasAnimationExport.value
    ? '自定义动画 Runtime 驱动：预览与主场景共用同一契约'
    : '已声明动画目标，但源码未导出 createModelAnimation，模型保持静态'
})
function capabilityRuntimeState(id) {
  if (id === 'spatial') return '部分支持'
  if (id === 'visual') {
    if (!visualAnimationTargets.value.length) return '未接入'
    return hasAnimationExport.value ? 'Runtime 驱动' : '待补充'
  }
  return '未接入'
}
const capabilityNamespaces = computed(() => {
  const capabilities = capabilityManifest.value.capabilities || {}
  return Object.entries(capabilities).map(([id, value]) => {
    if (id === 'spatial') return { id, runtime: '部分接入：box collider 阻挡', value }
    if (id === 'visual') return { id, runtime: visualRuntimeLabel.value, value }
    return { id, runtime: '尚未接入 Runtime', value }
  })
})
const spatialColliders = computed(() => {
  const colliders = capabilityManifest.value.capabilities?.spatial?.colliders
  if (!Array.isArray(colliders)) return []
  const partIds = new Set()
  props.model?.traverse?.(object => {
    if (object.userData?.componentId != null) partIds.add(String(object.userData.componentId))
  })
  return colliders.filter(item => item && typeof item.targetPartId === 'string')
    .filter(item => !selectedPartId.value || item.targetPartId === selectedPartId.value)
    .map(item => {
      const capabilityId = 'spatial.collider.' + String(item.id || item.targetPartId) + '.blocksMovement'
      const override = (capabilityControl.value.overrides || []).find(record => record?.capabilityId === capabilityId && String(record.scope?.targetId || '') === item.targetPartId && record.scope?.targetType === 'part')
      return {
        ...item,
        capabilityId,
        blocksMovement: override?.value?.blocksMovement ?? item.blocksMovement !== false,
        source: override ? '用户覆盖' : '模型定义',
        runtimeSupported: item.shape === 'box' && item.enabled !== false && partIds.has(item.targetPartId),
        runtimeReason: item.shape !== 'box' ? 'Runtime 未支持该形状' : (item.enabled === false ? '模型定义已禁用' : (!partIds.has(item.targetPartId) ? '目标部件不存在' : 'Runtime 已接入')),
      }
    })
})
function updateColliderBlocking(collider, value) {
  emit('capability-change', { capabilityId: collider.capabilityId, targetPartId: collider.targetPartId, blocksMovement: Boolean(value) })
}
function syncModelMetadata(model = props.model) {
  const userData = model?.userData || {}
  previewParts.value = Array.isArray(userData.proceduralModelParts) ? [...userData.proceduralModelParts] : []
  parameters.value = Array.isArray(userData.proceduralModelParameters) ? [...userData.proceduralModelParameters] : []
  parameterValues.value = { ...(userData.proceduralModelParameterValues || {}) }
}

let renderer = null
let scene = null
let camera = null
let controls = null
let previewRoot = null
let previewAnimationRuntime = null
let resizeObserver = null
let raycaster = null
let selectionHelper = null
let highlightedMeshes = []
const SELECTION_COLOR = 0x6fce9f

function clearSelectionHighlight() {
  if (selectionHelper) {
    scene?.remove(selectionHelper)
    selectionHelper.geometry?.dispose?.()
    selectionHelper.material?.dispose?.()
    selectionHelper = null
  }
  // 逐个还原被替换的材质并释放临时克隆，绝不修改共享材质
  for (const record of highlightedMeshes) {
    record.mesh.material = record.original
    for (const clone of record.clones) clone?.dispose?.()
  }
  highlightedMeshes = []
}

function highlightMaterial(material, dimRest) {
  if (!material?.clone) return { material, clone: null }
  const clone = material.clone()
  if (dimRest) {
    clone.transparent = true
    clone.opacity = Math.min(Number.isFinite(clone.opacity) ? clone.opacity : 1, 0.32)
    clone.depthWrite = false
  } else if (clone.emissive) {
    clone.emissive.setHex(SELECTION_COLOR)
    clone.emissiveIntensity = 0.32
  } else {
    return { material, clone: null }
  }
  clone.needsUpdate = true
  return { material: clone, clone }
}

function replaceMeshMaterial(mesh, dimRest) {
  const original = mesh.material
  if (Array.isArray(original)) {
    const results = original.map(material => highlightMaterial(material, dimRest))
    const clones = results.map(result => result.clone).filter(Boolean)
    if (!clones.length) return
    mesh.material = results.map(result => result.material)
    highlightedMeshes.push({ mesh, original, clones })
    return
  }
  const result = highlightMaterial(original, dimRest)
  if (!result.clone) return
  mesh.material = result.material
  highlightedMeshes.push({ mesh, original, clones: [result.clone] })
}

function applySelectionHighlight() {
  clearSelectionHighlight()
  if (!scene || !previewRoot || !selectedPartId.value) return
  let target = null
  previewRoot.traverse(object => {
    if (!target && String(object.userData?.componentId || '') === selectedPartId.value) target = object
  })
  if (!target) return
  // 选中的部件加发光；其余部件整体压暗，形成精确的对比高亮
  const selectedMeshes = new Set()
  target.traverse(object => { if (object.isMesh) selectedMeshes.add(object) })
  previewRoot.traverse(object => {
    if (!object.isMesh || !object.material) return
    replaceMeshMaterial(object, !selectedMeshes.has(object))
  })
  selectionHelper = new THREE.BoxHelper(target, SELECTION_COLOR)
  selectionHelper.material.depthTest = false
  selectionHelper.material.transparent = true
  selectionHelper.material.opacity = 0.6
  selectionHelper.renderOrder = 999
  scene.add(selectionHelper)
}
let pointer = new THREE.Vector2()
let frame = 0
let clockStartMs = 0
let lastFrameMs = 0

function reportPreviewAnimationError(error, detail) {
  const phase = detail?.phase || 'animation'
  previewAnimationError.value = `预览动画错误（${phase}）：${error?.message || error || '未知错误'}`
  console.warn('[ProceduralModelPreviewAnimation]', detail, error)
}

function syncPreview() {
  if (!scene) return
  // 先清理高亮，避免继续引用即将被释放的旧预览对象
  clearSelectionHighlight()
  previewAnimationRuntime?.remove(PREVIEW_MODEL_ID)
  if (previewRoot) {
    scene.remove(previewRoot)
    disposeSandboxObjectResources(previewRoot)
    previewRoot = null
  }
  previewAnimationError.value = ''
  if (!props.model) {
    render()
    return
  }
  // 资源隔离克隆：动画对 geometry/material/texture 的修改与释放都不能回写主场景模型。
  previewRoot = cloneSandboxObjectResources(props.model)
  previewRoot.userData.sandboxModelId = PREVIEW_MODEL_ID
  previewRoot.position.set(0, 0, 0)
  previewRoot.rotation.set(0, 0, 0)
  previewRoot.scale.set(1, 1, 1)
  scene.add(previewRoot)
  const box = new THREE.Box3().setFromObject(previewRoot)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  previewRoot.position.sub(center)
  const maxSize = Math.max(size.x, size.y, size.z, 1)
  camera.position.set(maxSize * 1.8, maxSize * 1.35, maxSize * 1.8)
  camera.near = Math.max(0.01, maxSize / 1000)
  camera.far = maxSize * 100
  camera.updateProjectionMatrix()
  controls.target.set(0, 0, 0)
  controls.update()
  syncModelMetadata(props.model)
  // 重建预览后尽量保留当前选中的部件并重新高亮
  const previousPartId = selectedPartId.value
  selectedPartId.value = ''
  selectedPartName.value = '整体模型'
  previewAnimationRuntime?.register(
    PREVIEW_MODEL_ID,
    previewRoot,
    createSandboxEnvironmentSnapshot(props.environment),
  )
  if (previousPartId) {
    let part = null
    previewRoot.traverse(object => {
      if (!part && String(object.userData?.componentId || '') === previousPartId) part = object
    })
    if (part) {
      selectedPartId.value = previousPartId
      selectedPartName.value = part.name || previousPartId
      applySelectionHighlight()
    }
  }
  render()
}
function resize() {
  if (!renderer || !canvasHost.value) return
  const width = Math.max(1, canvasHost.value.clientWidth)
  const height = Math.max(1, canvasHost.value.clientHeight)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  render()
}
function render() {
  if (!renderer || !scene || !camera) return
  controls?.update()
  selectionHelper?.update()
  renderer.render(scene, camera)
}
function animate(now) {
  const timestamp = Number.isFinite(now) ? now : performance.now()
  if (!clockStartMs) {
    clockStartMs = timestamp
    lastFrameMs = timestamp
  }
  const elapsed = (timestamp - clockStartMs) / 1000
  const delta = (timestamp - lastFrameMs) / 1000
  lastFrameMs = timestamp
  previewAnimationRuntime?.update(
    elapsed,
    delta,
    createSandboxEnvironmentSnapshot(props.environment),
  )
  render()
  frame = requestAnimationFrame(animate)
}
function selectPart(event) {
  if (!renderer || !previewRoot) return
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  const hit = raycaster.intersectObject(previewRoot, true)[0]
  if (!hit) {
    selectedPartId.value = ''
    selectedPartName.value = '整体模型'
    emit('part-select', '')
    return
  }
  let part = hit.object
  while (part && part !== previewRoot && !part.userData?.componentId) part = part.parent
  selectedPartId.value = part && part !== previewRoot ? String(part.userData.componentId) : ''
  selectedPartName.value = part && part !== previewRoot ? (part.name || selectedPartId.value) : '整体模型'
  applySelectionHighlight()
  emit('part-select', selectedPartId.value)
}
function updateParameter(parameter, value) {
  parameterValues.value = { ...parameterValues.value, [parameter.id]: value }
  emit('parameter-change', { id: parameter.id, value, values: parameterValues.value })
}
const selectedPartTextSpec = computed(() => {
  if (!props.model || !selectedPartId.value) return null
  return getPartTextSpec(props.model, selectedPartId.value)
})
function updatePartText(value) {
  if (!props.model || !selectedPartId.value) return
  const text = String(value || '').slice(0, 200)
  if (!text.trim()) return
  updateTextPlate(THREE, props.model, selectedPartId.value, { text })
  syncPreview()
}
function clearPartSelection() {
  selectedPartId.value = ''
  selectedPartName.value = '整体模型'
  clearSelectionHighlight()
  emit('part-select', '')
}
function readComposerImage(file) {
  if (!file) return
  if (!String(file.type || '').startsWith('image/')) {
    composerImageError.value = '只支持图片文件'
    return
  }
  if (file.size > MAX_EDIT_IMAGE_BYTES) {
    composerImageError.value = '图片超过 8MB，请压缩后再试'
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    composerImage.value = typeof reader.result === 'string' ? reader.result : ''
    composerImageName.value = file.name || '粘贴的图片'
    composerImageError.value = ''
  }
  reader.onerror = () => { composerImageError.value = '图片读取失败' }
  reader.readAsDataURL(file)
}
function extractImageFromHtml(html) {
  if (!html) return ''
  const match = String(html).match(/<img[^>]+src=["'](data:image\/[^"']+)["']/i)
  return match ? match[1] : ''
}
function onComposerPaste(event) {
  const clipboard = event.clipboardData
  if (!clipboard) return
  const files = Array.from(clipboard.files || []).filter(file => String(file.type || '').startsWith('image/'))
  let file = files[0] || null
  if (!file) {
    const item = Array.from(clipboard.items || []).find(entry => String(entry.type || '').startsWith('image/'))
    file = item?.getAsFile?.() || null
  }
  if (!file) {
    // 从网页复制的图片常常只在 text/html 里带 data: 图片
    const dataUrl = extractImageFromHtml(clipboard.getData?.('text/html'))
      || (String(clipboard.getData?.('text/plain') || '').startsWith('data:image/') ? clipboard.getData('text/plain') : '')
    if (dataUrl) {
      event.preventDefault?.()
      composerImage.value = dataUrl
      composerImageName.value = '粘贴的图片'
      composerImageError.value = ''
    }
    return
  }
  event.preventDefault?.()
  readComposerImage(file)
}
function onComposerDrop(event) {
  const file = Array.from(event.dataTransfer?.files || []).find(entry => String(entry.type || '').startsWith('image/'))
  if (!file) return
  event.preventDefault?.()
  readComposerImage(file)
}
function onComposerImageChange(event) {
  const file = event?.target?.files?.[0]
  if (file) readComposerImage(file)
  if (event?.target) event.target.value = ''
}
function clearComposerImage() {
  composerImage.value = ''
  composerImageName.value = ''
  composerImageError.value = ''
}
function submitEdit() {
  const text = instruction.value.trim()
  if ((!text && !composerImage.value) || props.busy) return
  emit('edit', {
    instruction: text || '参考这张图片调整模型',
    selectedPartId: selectedPartId.value,
    selectedPartName: selectedPartId.value ? selectedPartName.value : '',
    parameterValues: parameterValues.value,
    referenceImageDataUrl: composerImage.value || undefined,
  })
  instruction.value = ''
  clearComposerImage()
}
// 视觉质检用的占地叠层：在模型底面画出勾绘的占地多边形（青色），
// 只用于顶部截图，让视觉模型能对照判断模型底面是否贴合占地区域。
function buildFootprintOverlay() {
  const points = props.model?.userData?.sandboxFootprintPolygon?.points
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

function disposeFootprintOverlay(overlay) {
  overlay.traverse(object => {
    object.geometry?.dispose?.()
    object.material?.dispose?.()
  })
}

async function captureVisualViews() {
  if (!renderer || !previewRoot || !camera || !controls) throw new Error('模型预览尚未完成渲染，无法采集视觉质检截图')
  const originalPosition = camera.position.clone()
  const originalUp = camera.up.clone()
  const originalAspect = camera.aspect
  const originalTarget = controls.target.clone()
  const distance = Math.max(2, camera.position.distanceTo(controls.target))
  const directions = [
    { label: 'front', direction: new THREE.Vector3(0, 0.15, 1), up: new THREE.Vector3(0, 1, 0) },
    { label: 'side', direction: new THREE.Vector3(1, 0.15, 0), up: new THREE.Vector3(0, 1, 0) },
    { label: 'top', direction: new THREE.Vector3(0, 1, 0.001), up: new THREE.Vector3(0, 0, -1) },
    { label: 'isometric', direction: new THREE.Vector3(1, 0.75, 1), up: new THREE.Vector3(0, 1, 0) },
  ]
  const screenshots = []
  try {
    for (const view of directions) {
      controls.target.copy(originalTarget)
      camera.up.copy(view.up)
      camera.position.copy(originalTarget).add(view.direction.normalize().multiplyScalar(distance))
      camera.aspect = 4 / 3
      camera.lookAt(originalTarget)
      camera.updateProjectionMatrix()
      const width = 512
      const height = 384
      const target = new THREE.WebGLRenderTarget(width, height, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
      })
      target.texture.colorSpace = THREE.SRGBColorSpace
      const previousTarget = renderer.getRenderTarget()
      const pixels = new Uint8Array(width * height * 4)
      const footprintOverlay = view.label === 'top' ? buildFootprintOverlay() : null
      if (footprintOverlay) previewRoot.add(footprintOverlay)
      // 质检截图不带上选择高亮框，避免干扰视觉模型判断
      const helperWasVisible = selectionHelper ? selectionHelper.visible : false
      if (selectionHelper) selectionHelper.visible = false
      try {
        renderer.setRenderTarget(target)
        renderer.setViewport(0, 0, width, height)
        renderer.render(scene, camera)
        renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
      } finally {
        renderer.setRenderTarget(previousTarget)
        target.dispose()
        if (selectionHelper) selectionHelper.visible = helperWasVisible
        if (footprintOverlay) {
          previewRoot.remove(footprintOverlay)
          disposeFootprintOverlay(footprintOverlay)
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建视觉质检截图画布')
      const image = context.createImageData(width, height)
      for (let row = 0; row < height; row += 1) {
        const sourceStart = (height - row - 1) * width * 4
        image.data.set(pixels.subarray(sourceStart, sourceStart + width * 4), row * width * 4)
      }
      context.putImageData(image, 0, 0)
      screenshots.push({
        label: footprintOverlay ? view.label + '-footprint' : view.label,
        imageDataUrl: canvas.toDataURL('image/jpeg', 0.68),
      })
    }
  } finally {
    camera.up.copy(originalUp)
    camera.aspect = originalAspect
    camera.position.copy(originalPosition)
    controls.target.copy(originalTarget)
    camera.lookAt(originalTarget)
    controls.update()
    render()
  }
  return screenshots
}
defineExpose({ captureVisualViews })
watch(selectedPartId, () => {
  // 部件列表按钮等非射线选择路径也需要同步高亮
  applySelectionHighlight()
})
watch(() => props.model, (model) => {
  syncModelMetadata(model)
  syncPreview()
}, { flush: 'post' })
onMounted(() => {
  scene = new THREE.Scene()
  scene.background = new THREE.Color('#17242b')
  camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000)
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  canvasHost.value.appendChild(renderer.domElement)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x52616b, 2.1))
  const key = new THREE.DirectionalLight(0xffffff, 2.4)
  key.position.set(8, 12, 10)
  key.castShadow = true
  scene.add(key)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  raycaster = new THREE.Raycaster()
  renderer.domElement.addEventListener('click', selectPart)
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvasHost.value)
  previewAnimationRuntime = createModelAnimationRuntime({ onError: reportPreviewAnimationError })
  syncPreview()
  resize()
  frame = requestAnimationFrame(animate)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  clearSelectionHighlight()
  resizeObserver?.disconnect()
  renderer?.domElement?.removeEventListener('click', selectPart)
  controls?.dispose()
  previewAnimationRuntime?.remove(PREVIEW_MODEL_ID)
  previewAnimationRuntime?.dispose()
  previewAnimationRuntime = null
  if (previewRoot) {
    scene?.remove(previewRoot)
    disposeSandboxObjectResources(previewRoot)
    previewRoot = null
  }
  renderer?.dispose()
  renderer?.domElement?.remove()
})
</script>

<template>
  <div class="model-editor" role="dialog" aria-modal="true" aria-label="AI 模型编辑器" @paste="onComposerPaste">
    <header class="model-editor__header">
      <div><strong>{{ mode === 'create' ? (model ? '模型生成与编辑工作台' : '正在创建模型') : mode === 'character' ? 'AI 角色编辑工作台' : '模型编辑工作台' }}</strong><span>{{ model?.name || (mode === 'character' ? '调整完成后保存应用到玩家' : (mode === 'create' ? '生成完成后可继续调整参数与结构' : '程序化模型')) }}</span></div>
      <div class="model-editor__header-actions"><button :disabled="busy || !canUndo" @click="emit('undo')">撤销上一步</button><button :disabled="busy" @click="emit('close')">关闭</button></div>
    </header>
    <div class="model-editor__body">
      <section class="model-editor__left">
        <div class="model-editor__preview">
          <div ref="canvasHost" class="model-editor__canvas"></div>
          <div v-if="!model" class="model-editor__preview-empty" :class="{ 'is-loading': busy }">
            <div v-if="busy" class="model-editor__loading-rings" aria-hidden="true">
              <span class="model-editor__loading-ring"></span>
              <span class="model-editor__loading-ring"></span>
              <span class="model-editor__loading-ring"></span>
              <span class="model-editor__loading-core"></span>
            </div>
            <strong>{{ busy ? (activeProgress?.label || '正在生成模型') : '模型预览' }}</strong>
            <span>{{ busy ? (activeProgress?.detail || 'AI 正在构建完整 Three.js 模型…') : '模型生成完成后将在这里显示' }}</span>
          </div>
          <div v-else class="model-editor__preview-hint">单击模型部件进行选择 · 拖动旋转 · 滚轮缩放</div>
          <div v-if="model" class="model-editor__part-chip">当前范围：{{ selectedPartName }}</div>
        </div>
        <div v-if="model" class="model-editor__info">
          <div class="model-editor__info-block">
            <div class="model-editor__section-title"><h3>组件结构</h3><span>{{ previewParts.length }} 个部件</span></div>
            <div class="model-editor__parts">
              <button :class="{ active: !selectedPartId }" @click="selectedPartId = ''; selectedPartName = '整体模型'; emit('part-select', '')">整体模型</button>
              <button v-for="part in previewParts" :key="part.id" :class="{ active: selectedPartId === part.id }" @click="selectedPartId = part.id; selectedPartName = part.name || part.id; emit('part-select', part.id)">{{ part.name || part.id }}</button>
            </div>
            <label v-if="selectedPartTextSpec" class="model-editor__field">
              <span>文字内容<small>宿主用中文字体渲染，保存后写入模型</small></span>
              <input type="text" :value="selectedPartTextSpec.text" @change="updatePartText($event.target.value)">
            </label>
          </div>
          <div class="model-editor__info-block">
            <div class="model-editor__section-title"><h3>模型结构参数</h3><span>由 AI 动态声明</span></div>
            <p v-if="!parameters.length" class="model-editor__empty">当前模型还没有可调参数。通过右侧对话要求 AI 新增控制参数。</p>
            <label v-for="parameter in parameters" :key="parameter.id" class="model-editor__field">
              <span>{{ parameter.label || parameter.id }}<small v-if="parameter.description">{{ parameter.description }}</small></span>
              <input v-if="parameter.type === 'color'" type="color" :value="parameterValues[parameter.id] ?? parameter.default ?? '#ffffff'" @input="updateParameter(parameter, $event.target.value)">
              <input v-else-if="parameter.type === 'number'" type="number" :value="parameterValues[parameter.id] ?? parameter.default ?? 0" :min="parameter.min" :max="parameter.max" :step="parameter.step || 'any'" @change="updateParameter(parameter, Number($event.target.value))">
              <input v-else-if="parameter.type === 'boolean'" type="checkbox" :checked="Boolean(parameterValues[parameter.id] ?? parameter.default)" @change="updateParameter(parameter, $event.target.checked)">
              <select v-else-if="parameter.type === 'select'" :value="parameterValues[parameter.id] ?? parameter.default" @change="updateParameter(parameter, $event.target.value)">
                <option v-for="option in (parameter.options || [])" :key="String(option.value ?? option)" :value="option.value ?? option">{{ option.label ?? option }}</option>
              </select>
              <input v-else type="text" :value="parameterValues[parameter.id] ?? parameter.default ?? ''" @change="updateParameter(parameter, $event.target.value)">
            </label>
          </div>
          <div class="model-editor__info-block">
            <div class="model-editor__section-title"><h3>模型能力</h3><span>AI 自动推断 · 可随时调整</span></div>
            <p v-if="!capabilityNamespaces.length" class="model-editor__empty">模型尚未声明能力。AI 可在后续建模或对话编辑中补充。</p>
            <div v-for="item in capabilityNamespaces" :key="item.id" class="model-editor__capability-row">
              <div><strong>{{ item.id }}</strong><small>{{ item.runtime }}</small></div>
              <span class="model-editor__runtime-state">{{ capabilityRuntimeState(item.id) }}</span>
            </div>
            <div class="model-editor__capability-controls">
              <h4>{{ selectedPartId ? '当前部件的空间控制' : '模型空间控制' }}</h4>
              <p v-if="!spatialColliders.length" class="model-editor__empty">当前范围没有可控制的 box 碰撞体。选择模型部件可查看其能力。</p>
              <label v-for="collider in spatialColliders" :key="collider.capabilityId" class="model-editor__capability-control">
                <span><strong>{{ previewParts.find(part => part.id === collider.targetPartId)?.name || collider.targetPartId }}</strong><small>{{ collider.id || '空间碰撞体' }} · {{ collider.source }} · {{ collider.runtimeReason }}</small></span>
                <span class="model-editor__toggle">
                  <input type="checkbox" :checked="collider.blocksMovement" :disabled="!collider.runtimeSupported || busy" @change="updateColliderBlocking(collider, $event.target.checked)">
                  <span>阻挡玩家移动</span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </section>
      <section class="model-editor__chat-panel">
        <div class="model-editor__messages">
          <article
            v-for="message in messages"
            :key="message.id"
            class="model-msg"
            :class="['model-msg--' + message.role, message.type ? 'model-msg--' + message.type : '']"
          >
            <template v-if="message.type === 'visual-qc'">
              <div class="model-msg__head">
                <strong>{{ message.stageLabel || (message.round === 0 ? '视觉质检' : '复检 · 第 ' + message.round + ' 轮') }}</strong>
                <span :class="message.report?.passed ? 'is-passed' : 'is-warning'">{{ message.report?.passed ? '通过' : '未通过' }} · {{ message.report?.score }}/100</span>
              </div>
              <p v-if="message.report?.summary">{{ message.report.summary }}</p>
              <ul v-if="message.report?.issues?.length">
                <li v-for="(issue, index) in message.report.issues" :key="index">
                  <strong>{{ issue.severity === 'critical' ? '严重' : issue.severity === 'major' ? '主要' : '轻微' }}</strong>
                  <span>{{ issue.issue }}</span>
                </li>
              </ul>
            </template>
            <template v-else>
              <p>{{ message.text }}</p>
              <div v-if="message.referenceImage || message.footprint || message.selectedPartId" class="model-msg__tags">
                <span v-if="message.referenceImage">含参考图</span>
                <span v-if="message.footprint">占地 · {{ message.footprint.mode === 'space' ? '空间占据' : '占地区域' }}</span>
                <span v-if="message.selectedPartId">@{{ message.selectedPartName || message.selectedPartId }}</span>
              </div>
            </template>
          </article>
          <article v-if="busy" class="model-msg model-msg--assistant model-msg--progress">
            <div class="model-msg__head">
              <strong>{{ activeProgress?.label || (mode === 'create' ? 'AI 正在生成模型…' : 'AI 正在修改模型…') }}</strong>
              <span v-if="activeProgress">{{ progressDone }}/{{ progress.length }}</span>
            </div>
            <p v-if="activeProgress?.detail">{{ activeProgress.detail }}</p>
            <ol v-if="activeProgress" class="model-editor__progress">
              <li v-for="(item, index) in progress" :key="item.stage || index" :class="item.status">
                <span class="model-editor__progress-mark">{{ item.status === 'done' ? '✓' : item.status === 'failed' ? '!' : '•' }}</span>
                <span><strong>{{ item.label }}</strong><small>{{ item.detail || (item.status === 'active' ? '正在处理…' : item.status === 'done' ? '已完成' : item.status === 'failed' ? '执行失败' : '等待执行') }}</small></span>
              </li>
            </ol>
          </article>
          <p v-if="error" class="model-editor__error">{{ error }}</p>
          <p v-if="previewAnimationError" class="model-editor__error">{{ previewAnimationError }}</p>
        </div>
        <div class="model-editor__composer" @dragover.prevent @drop="onComposerDrop">
          <div v-if="selectedPartId" class="model-editor__target-chip" title="本次调整只针对该部件">
            <span class="model-editor__target-at">@</span>
            <span>{{ selectedPartName }}</span>
            <button type="button" @click="clearPartSelection" aria-label="取消部件选择">×</button>
          </div>
          <div v-if="composerImage" class="model-editor__image-chip">
            <img :src="composerImage" alt="调整参考图">
            <span>{{ composerImageName || '参考图' }}</span>
            <button type="button" @click="clearComposerImage" aria-label="移除参考图">×</button>
          </div>
          <p v-if="composerImageError" class="model-editor__error">{{ composerImageError }}</p>
          <textarea
            v-model="instruction"
            rows="3"
            :placeholder="selectedPartId
              ? `针对「${selectedPartName}」调整，例如：按照参考图把这个部件改成这种材质。`
              : '继续对话调整，例如：按照参考图把入口改成这个样子；也可以直接粘贴图片。'"
            @keydown.ctrl.enter="submitEdit"
          ></textarea>
          <div class="model-editor__composer-bar">
            <span class="model-editor__composer-tip">Ctrl + Enter 发送{{ selectedPartId ? ' · 已锁定部件微调' : '' }} · 可粘贴/拖入图片</span>
            <span class="model-editor__composer-actions">
              <input ref="composerImageInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onComposerImageChange">
              <button type="button" class="model-editor__upload-button" @click="composerImageInput?.click()">上传图片</button>
              <button class="primary" :disabled="busy || !model || (!instruction.trim() && !composerImage)" @click="submitEdit">{{ busy ? 'AI 正在处理…' : '发送调整' }}</button>
            </span>
          </div>
        </div>
      </section>
    </div>
    <footer v-if="model" class="model-editor__footer">
      <span>{{ mode === 'character' ? '保存后将当前角色应用到玩家并单独存档' : (mode === 'create' ? '确认后将模型实例加入当前沙盒' : '保存后将当前模型修改写入沙盒存档') }}</span>
      <button class="primary" :disabled="busy" @click="emit('save')">{{ mode === 'character' ? '应用到玩家' : (mode === 'create' ? '保存并加入沙盒' : '保存修改') }}</button>
    </footer>
  </div>
</template>

<style scoped>
.model-editor {
  --me-pine-950: #0b2019;
  --me-pine-900: #102a22;
  --me-pine-800: #16382c;
  --me-pine-700: #1f4a3a;
  --me-chalk: #f2efe3;
  --me-cream: #e8ddc3;
  --me-sage: #a9b8a6;
  --me-sage-dim: #7e9586;
  --me-brick: #c2553c;
  --me-brick-deep: #a34531;
  --me-line: rgba(242, 239, 227, 0.16);
  position: fixed;
  z-index: 20;
  inset: 3vh 3vw;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--me-chalk);
  background: var(--me-pine-950);
  border: 1px solid var(--me-line);
  border-top: 4px solid var(--me-brick);
  border-radius: 2px;
  box-shadow: 0 28px 90px rgba(5, 17, 12, 0.5);
  font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
}
.model-editor__header-actions { display: flex; gap: 7px; }
.model-editor__header { height: 62px; flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid var(--me-line); }
.model-editor__header strong, .model-editor__header span { display: block; }
.model-editor__header strong { font-family: 'Noto Serif SC', 'Songti SC', serif; font-size: 15px; font-weight: 700; letter-spacing: 0.6px; }
.model-editor__header span { margin-top: 3px; color: var(--me-sage); font-size: 10px; }
.model-editor button { padding: 8px 10px; border: 1px solid var(--me-line); border-radius: 2px; color: var(--me-chalk); background: transparent; cursor: pointer; font: inherit; font-size: 11px; transition: background 0.16s ease, border-color 0.16s ease; }
.model-editor button:hover { border-color: rgba(242, 239, 227, 0.34); background: rgba(242, 239, 227, 0.07); }
.model-editor button:focus-visible, .model-editor textarea:focus-visible, .model-editor input:focus-visible, .model-editor select:focus-visible { outline: 2px solid var(--me-cream); outline-offset: 2px; }
.model-editor button.active { border-color: var(--me-brick); color: #f8e9e4; background: rgba(194, 85, 60, 0.2); }
.model-editor button:disabled { opacity: 0.45; cursor: not-allowed; }
.model-editor__body { min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr); }
.model-editor__preview { position: relative; min-height: 0; background: var(--me-pine-900); border-right: 1px solid var(--me-line); }
.model-editor__canvas { position: absolute; inset: 0; }
.model-editor__canvas :deep(canvas) { width: 100%; height: 100%; display: block; }
.model-editor__preview-hint, .model-editor__part-chip { position: absolute; left: 14px; padding: 8px 10px; border: 1px solid var(--me-line); border-radius: 2px; background: var(--me-pine-900); font-size: 10px; color: var(--me-sage); }
.model-editor__preview-hint { bottom: 14px; }
.model-editor__part-chip { top: 14px; }
.model-editor__controls { min-height: 0; overflow: auto; padding: 16px; }
.model-editor__generation { min-height: 0; overflow: auto; padding: 24px; }
.model-editor__generation > p { color: var(--me-sage); font-size: 11px; line-height: 1.6; }
.model-editor__progress { display: grid; gap: 0; margin: 22px 0; padding: 0; list-style: none; }
.model-editor__progress li { display: flex; gap: 12px; padding: 13px 0; border-bottom: 1px solid var(--me-line); color: var(--me-sage-dim); }
.model-editor__progress li.active { color: var(--me-chalk); }
.model-editor__progress li.done { color: var(--me-sage); }
.model-editor__progress li.failed { color: #ffaaa1; }
.model-editor__progress-mark { display: grid; place-items: center; width: 22px; height: 22px; flex: none; border: 1px solid currentColor; border-radius: 50%; font-size: 11px; }
.model-editor__progress strong, .model-editor__progress small { display: block; }
.model-editor__progress strong { font-size: 12px; }
.model-editor__progress small { margin-top: 5px; color: var(--me-sage-dim); font-size: 10px; }
.model-editor__preview-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; box-sizing: border-box; color: var(--me-sage); text-align: center; background: var(--me-pine-900); pointer-events: none; }
.model-editor__preview-empty strong { position: relative; z-index: 1; margin: 0; font-family: 'Noto Serif SC', 'Songti SC', serif; font-size: 17px; }
.model-editor__preview-empty > span { position: relative; z-index: 1; max-width: 340px; color: var(--me-sage-dim); font-size: 10px; line-height: 1.6; }
.model-editor__preview-empty.is-loading { background: var(--me-pine-900); }
.model-editor__loading-rings { position: relative; flex: none; width: 184px; height: 184px; margin: 0 0 2px; }
.model-editor__loading-rings::before { content: ''; position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; border-radius: 50%; background: radial-gradient(circle, rgba(232, 221, 195, 0.28) 0%, rgba(194, 85, 60, 0.18) 38%, transparent 72%); filter: blur(5px); transform: translate(-50%, -50%); animation: model-editor-halo 1.8s ease-in-out infinite; }
.model-editor__loading-ring { display: block; position: absolute; left: 50%; top: 50%; width: 28px; height: 28px; padding: 0; margin: 0; box-sizing: border-box; border: 1.5px solid rgba(232, 221, 195, 0.9); border-radius: 50%; background: transparent; box-shadow: 0 0 9px rgba(194, 85, 60, 0.45), inset 0 0 8px rgba(194, 85, 60, 0.14); transform: translate(-50%, -50%) scale(0.05); transform-origin: center; animation: model-editor-ripple 2.7s cubic-bezier(0.15, 0.55, 0.35, 1) infinite; }
.model-editor__loading-ring:nth-child(1) { animation-delay: -1.8s; }
.model-editor__loading-ring:nth-child(2) { animation-delay: -0.9s; }
.model-editor__loading-ring:nth-child(3) { animation-delay: 0s; }
.model-editor__loading-core { position: absolute; left: 50%; top: 50%; width: 9px; height: 9px; margin: 0; border-radius: 50%; background: var(--me-cream); box-shadow: 0 0 10px 4px rgba(232, 221, 195, 0.5), 0 0 30px 12px rgba(194, 85, 60, 0.24); transform: translate(-50%, -50%); animation: model-editor-core-pulse 1.8s ease-in-out infinite; }
@keyframes model-editor-ripple {
  0% { transform: translate(-50%, -50%) scale(0.05); opacity: 0.95; }
  65% { opacity: 0.32; }
  100% { transform: translate(-50%, -50%) scale(5.8); opacity: 0; }
}
@keyframes model-editor-halo {
  0%, 100% { opacity: 0.55; transform: translate(-50%, -50%) scale(0.82); }
  50% { opacity: 1; transform: translate(-50%, -50%) scale(1.35); }
}
@keyframes model-editor-core-pulse {
  0%, 100% { transform: translate(-50%, -50%) scale(0.86); opacity: 0.78; }
  50% { transform: translate(-50%, -50%) scale(1.12); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .model-editor__loading-ring, .model-editor__loading-core { animation: none; }
  .model-editor__loading-ring { transform: translate(-50%, -50%) scale(3.8); opacity: 0.3; }
}
.model-editor__footer { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 18px; border-top: 1px solid var(--me-line); color: var(--me-sage); font-size: 10px; }
.model-editor__footer .primary { border-color: var(--me-brick); color: #fff7ee; background: var(--me-brick); font-weight: 600; }
.model-editor__scope { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.model-editor__scope span, .model-editor__section-title span { color: var(--me-sage-dim); font-size: 10px; }
.model-editor__chat, .model-editor__parameters, .model-editor__parts, .model-editor__capabilities { padding: 13px 0; border-top: 1px solid var(--me-line); }
.model-editor h3 { margin: 0 0 10px; font-family: 'Noto Serif SC', 'Songti SC', serif; font-size: 14px; font-weight: 700; letter-spacing: 0.4px; color: var(--me-chalk); }
.model-editor__chat textarea, .model-editor__field input:not([type=checkbox]), .model-editor__field select { width: 100%; box-sizing: border-box; padding: 9px; border: 1px solid var(--me-line); border-radius: 2px; outline: none; color: var(--me-chalk); background: var(--me-pine-900); font: inherit; font-size: 11px; }
.model-editor__chat textarea { resize: vertical; line-height: 1.5; }
.model-editor__chat .primary { width: 100%; margin-top: 8px; border-color: var(--me-brick); color: #fff7ee; background: var(--me-brick); font-weight: 600; }
.model-editor__error { color: #ffaaa1; font-size: 10px; }
.model-editor__empty { color: var(--me-sage-dim); font-size: 11px; line-height: 1.6; }
.model-editor__section-title { display: flex; align-items: center; justify-content: space-between; }
.model-editor__field { display: grid; grid-template-columns: 1fr minmax(110px, 0.8fr); align-items: center; gap: 12px; margin: 10px 0; color: var(--me-sage); font-size: 11px; }
.model-editor__field small { display: block; margin-top: 4px; color: var(--me-sage-dim); font-size: 9px; }
.model-editor__field input[type=color] { width: 100%; height: 34px; border: 0; background: transparent; }
.model-editor__visual-quality { padding: 13px 0; border-top: 1px solid var(--me-line); }
.model-editor__visual-quality p, .model-editor__visual-quality li { color: var(--me-sage); font-size: 10px; line-height: 1.6; }
.model-editor__visual-quality ul { margin: 8px 0 0; padding-left: 18px; }
.model-editor__visual-quality li { margin: 5px 0; }
.model-editor__visual-quality .is-passed { color: #a5c9b1; font-size: 10px; }
.model-editor__visual-quality .is-warning { color: #f0bd7d; font-size: 10px; }
.model-editor__capability-row, .model-editor__capability-control { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--me-line); color: var(--me-sage); font-size: 11px; }
.model-editor__capability-row strong, .model-editor__capability-control strong { display: block; font-size: 11px; color: var(--me-chalk); }
.model-editor__capability-row small, .model-editor__capability-control small { display: block; margin-top: 4px; color: var(--me-sage-dim); font-size: 9px; }
.model-editor__runtime-state { flex: none; color: var(--me-cream); font-size: 9px; }
.model-editor__capability-controls { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--me-line); }
.model-editor__capability-controls h4 { margin: 0 0 7px; font-size: 11px; color: var(--me-chalk); }
.model-editor__toggle { display: flex; align-items: center; gap: 6px; flex: none; font-size: 10px; }
.model-editor__toggle input { accent-color: var(--me-brick); }
.model-editor__parts { display: flex; flex-wrap: wrap; gap: 6px; }
.model-editor__parts h3 { width: 100%; }
@media (max-width: 760px) {
  .model-editor { inset: 1vh 1vw; }
  .model-editor__body { grid-template-columns: 1fr; grid-template-rows: minmax(220px, 0.8fr) minmax(280px, 1fr); }
  .model-editor__preview { border-right: 0; border-bottom: 1px solid var(--me-line); }
}
/* 对话式 AI 建模工作台：左侧预览 + 组件结构，右侧对话记录 */
.model-editor__body { grid-template-columns: minmax(0, 1.1fr) minmax(360px, 0.9fr); }
.model-editor__left { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-right: 1px solid var(--me-line); }
.model-editor__left .model-editor__preview { flex: 1; min-height: 0; border-right: 0; }
.model-editor__info { flex: none; max-height: 46%; overflow: auto; padding: 14px 16px; border-top: 1px solid var(--me-line); display: grid; gap: 18px; }
.model-editor__info-block { display: grid; gap: 10px; min-width: 0; }
.model-editor__chat-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--me-pine-900); }
.model-editor__messages { flex: 1; min-height: 0; overflow: auto; padding: 16px; display: grid; gap: 10px; align-content: start; }
.model-msg { max-width: 92%; min-width: 0; padding: 10px 12px; border-radius: 2px; background: var(--me-pine-800); border: 1px solid var(--me-line); color: var(--me-chalk); font-size: 12px; line-height: 1.6; }
.model-msg p { margin: 0; white-space: pre-wrap; word-break: break-word; }
.model-msg--user { justify-self: end; background: var(--me-pine-700); border-color: rgba(232, 221, 195, 0.24); }
.model-msg--stage { justify-self: center; max-width: 100%; padding: 2px 0; background: transparent; border: none; color: var(--me-sage-dim); font-size: 11px; text-align: center; }
.model-msg--visual-qc { justify-self: start; background: var(--me-pine-800); border-color: var(--me-line); border-left: 3px solid #9fc8ad; }
.model-msg--repair { justify-self: start; background: rgba(74, 62, 38, 0.45); border-color: rgba(224, 178, 95, 0.35); color: #f0e3c8; border-left: 3px solid #e0b25f; }
.model-msg__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
.model-msg__head strong { font-size: 12px; }
.model-msg__head span { font-size: 10px; color: var(--me-sage-dim); font-variant-numeric: tabular-nums; }
.model-msg .is-passed { color: #9fc8ad; }
.model-msg .is-warning { color: #e0b25f; }
.model-msg ul { margin: 6px 0 0; padding-left: 16px; display: grid; gap: 4px; }
.model-msg li strong { margin-right: 6px; }
.model-msg__tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.model-msg__tags span { font-size: 10px; padding: 1px 7px; border-radius: 2px; border: 1px solid var(--me-line); color: var(--me-sage); }
.model-editor__messages .model-editor__progress { margin: 8px 0 0; }
.model-editor__composer { flex: none; border-top: 1px solid var(--me-line); padding: 12px 14px; display: grid; gap: 8px; }
.model-editor__composer textarea { width: 100%; resize: vertical; min-height: 64px; padding: 10px; border-radius: 2px; border: 1px solid var(--me-line); background: var(--me-pine-950); color: var(--me-chalk); font: inherit; font-size: 12px; }
.model-editor__composer textarea:focus { outline: 2px solid var(--me-cream); outline-offset: 1px; }
.model-editor__composer-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.model-editor__composer-tip { color: var(--me-sage-dim); font-size: 10px; }
.model-editor__target-chip {
  display: inline-flex; align-items: center; gap: 6px; justify-self: start;
  padding: 3px 8px 3px 10px; border-radius: 2px;
  background: rgba(194, 85, 60, 0.16); border: 1px solid rgba(194, 85, 60, 0.5);
  color: #f5d9d1; font-size: 11px; max-width: 100%;
}
.model-editor__target-chip span:nth-child(2) {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.model-editor__target-at { font-weight: 700; color: #e08a6f; }
.model-editor__target-chip button {
  padding: 0 4px; border: 0; background: transparent; color: #f5d9d1; cursor: pointer; font-size: 13px; line-height: 1;
}
.model-editor__target-chip button:hover { color: #ffffff; }
.model-editor__image-chip {
  display: inline-flex; align-items: center; gap: 8px; justify-self: start; max-width: 100%;
  padding: 4px 8px 4px 4px; border-radius: 2px;
  background: var(--me-pine-800); border: 1px solid var(--me-line);
  color: var(--me-sage); font-size: 11px;
}
.model-editor__image-chip img { width: 34px; height: 34px; object-fit: cover; border-radius: 2px; display: block; }
.model-editor__image-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.model-editor__image-chip button {
  padding: 0 4px; border: 0; background: transparent; color: var(--me-sage); cursor: pointer; font-size: 13px; line-height: 1;
}
.model-editor__image-chip button:hover { color: #ffffff; }
.model-editor__composer-actions { display: flex; align-items: center; gap: 8px; }
.model-editor__upload-button { border-color: rgba(194, 85, 60, 0.5); color: #f5d9d1; }
.model-editor__upload-button:hover { border-color: var(--me-brick); color: #fff7ee; }
@media (max-width: 900px) {
  .model-editor__body { grid-template-columns: 1fr; grid-template-rows: minmax(240px, 44vh) minmax(0, 1fr); }
  .model-editor__left { border-right: 0; border-bottom: 1px solid var(--me-line); }
  .model-editor__info { max-height: 38%; }
  .model-editor { inset: 2vh 2vw; }
}
/* Liquid glass 主题：浅色磨砂玻璃 + 薄荷青强调色 */
.model-editor {
  --me-chalk: #0f2e26;
  --me-cream: #0b3d32;
  --me-sage: #3f5a4e;
  --me-sage-dim: #5d7a6c;
  --me-brick: #1f9d78;
  --me-brick-deep: #187a5d;
  --me-line: rgba(15, 46, 38, 0.14);
  --me-pine-950: transparent;
  --me-pine-900: rgba(255, 255, 255, 0.26);
  --me-pine-800: rgba(255, 255, 255, 0.4);
  --me-pine-700: rgba(255, 255, 255, 0.52);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.5));
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-top: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 24px;
  backdrop-filter: blur(36px) saturate(1.8);
  -webkit-backdrop-filter: blur(36px) saturate(1.8);
  box-shadow: 0 40px 120px rgba(24, 64, 48, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.95);
  color: var(--me-chalk);
}
.model-editor__header { background: rgba(255, 255, 255, 0.2); border-bottom: 1px solid rgba(15, 46, 38, 0.1); border-radius: 24px 24px 0 0; }
.model-editor__header strong { font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif; font-size: 15px; }
.model-editor__header span { color: var(--me-sage); }
.model-editor button { border-radius: 12px; background: rgba(255, 255, 255, 0.36); border-color: rgba(15, 46, 38, 0.16); color: var(--me-chalk); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.model-editor button:hover { background: rgba(255, 255, 255, 0.6); border-color: rgba(15, 46, 38, 0.24); }
.model-editor button.active { border-color: rgba(31, 157, 120, 0.4); background: rgba(127, 240, 200, 0.3); color: #0b3d32; }
.model-editor__preview { background: linear-gradient(160deg, rgba(236, 248, 242, 0.55), rgba(213, 232, 223, 0.35)); border-right-color: rgba(15, 46, 38, 0.1); }
.model-editor__preview-hint,
.model-editor__part-chip { background: rgba(255, 255, 255, 0.5); border-color: rgba(255, 255, 255, 0.7); border-radius: 12px; color: var(--me-sage); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
.model-editor__preview-empty { background: transparent; color: var(--me-sage); }
.model-editor__preview-empty strong { font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif; font-size: 16px; }
.model-editor__preview-empty > span { color: var(--me-sage-dim); }
.model-editor__preview-empty.is-loading { background: transparent; }
.model-editor__loading-ring { border-color: rgba(35, 169, 127, 0.7); box-shadow: 0 0 9px rgba(63, 214, 164, 0.4), inset 0 0 8px rgba(63, 214, 164, 0.14); }
.model-editor__loading-core { background: #0f8a67; box-shadow: 0 0 10px 4px rgba(63, 214, 164, 0.4), 0 0 30px 12px rgba(63, 214, 164, 0.18); }
.model-editor__footer { background: rgba(255, 255, 255, 0.16); border-top-color: rgba(15, 46, 38, 0.1); border-radius: 0 0 24px 24px; color: var(--me-sage); }
.model-editor__footer .primary,
.model-editor__chat .primary { border-color: transparent; background: linear-gradient(135deg, #7ff0c8, #6fd8e6); color: #073b2e; box-shadow: 0 10px 22px rgba(63, 214, 164, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.55); }
.model-editor__chat textarea,
.model-editor__field input:not([type=checkbox]),
.model-editor__field select,
.model-editor__composer textarea { background: rgba(255, 255, 255, 0.46); border-color: rgba(255, 255, 255, 0.7); border-radius: 12px; color: var(--me-chalk); }
.model-editor__composer { border-top-color: rgba(15, 46, 38, 0.1); background: rgba(255, 255, 255, 0.12); border-radius: 0 0 24px 0; }
.model-editor__chat-panel { background: transparent; }
.model-editor__messages { background: transparent; }
.model-msg { background: rgba(255, 255, 255, 0.44); border-color: rgba(255, 255, 255, 0.7); border-radius: 12px; color: var(--me-chalk); box-shadow: 0 6px 18px rgba(24, 64, 48, 0.06); }
.model-msg--user { background: rgba(127, 240, 200, 0.28); border-color: rgba(31, 157, 120, 0.3); }
.model-msg--stage { background: transparent; border: none; color: var(--me-sage-dim); box-shadow: none; }
.model-msg--visual-qc { background: rgba(255, 255, 255, 0.5); border-color: rgba(255, 255, 255, 0.75); border-left: 3px solid #35c99b; }
.model-msg--repair { background: rgba(255, 240, 205, 0.55); border-color: rgba(224, 178, 95, 0.45); border-left: 3px solid #e0b25f; color: #5a4420; }
.model-msg__head span { color: var(--me-sage-dim); }
.model-msg__tags span { border-color: rgba(15, 46, 38, 0.16); border-radius: 9px; color: var(--me-sage); }
.model-editor__target-chip { border-radius: 12px; background: rgba(127, 240, 200, 0.3); border-color: rgba(31, 157, 120, 0.35); color: #0b3d32; }
.model-editor__target-at { color: #0f8a67; }
.model-editor__target-chip button { color: #0b3d32; }
.model-editor__image-chip { border-radius: 12px; background: rgba(255, 255, 255, 0.4); border-color: rgba(255, 255, 255, 0.7); color: var(--me-sage); }
.model-editor__image-chip img { border-radius: 9px; }
.model-editor__upload-button { border-color: rgba(31, 157, 120, 0.4); color: #0b3d32; }
.model-editor__upload-button:hover { border-color: #1f9d78; color: #073b2e; }
.model-editor h3 { font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif; font-size: 13px; font-weight: 700; }
.model-editor__info { border-top-color: rgba(15, 46, 38, 0.1); }
.model-editor__left { border-right-color: rgba(15, 46, 38, 0.1); }
.model-editor__visual-quality { border-top-color: rgba(15, 46, 38, 0.1); }
.model-editor__chat,
.model-editor__parameters,
.model-editor__parts,
.model-editor__capabilities { border-top-color: rgba(15, 46, 38, 0.1); }
.model-editor__progress li { border-bottom-color: rgba(15, 46, 38, 0.1); }
.model-editor__messages,
.model-editor__info,
.model-editor__controls,
.model-editor__generation { scrollbar-width: thin; scrollbar-color: rgba(15, 46, 38, 0.28) transparent; }
.model-editor__messages::-webkit-scrollbar,
.model-editor__info::-webkit-scrollbar,
.model-editor__controls::-webkit-scrollbar,
.model-editor__generation::-webkit-scrollbar { width: 8px; height: 8px; }
.model-editor__messages::-webkit-scrollbar-thumb,
.model-editor__info::-webkit-scrollbar-thumb,
.model-editor__controls::-webkit-scrollbar-thumb,
.model-editor__generation::-webkit-scrollbar-thumb { background: rgba(15, 46, 38, 0.28); border-radius: 0; }
@media (max-width: 900px) {
  .model-editor { inset: 10px 8px; border-radius: 20px; }
}
</style>
