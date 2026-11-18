<template>
  <div ref="container" class="snapshot-preview">
    <div class="snapshot-toolbar">
      <button type="button" @click="setView('iso')">斜视</button>
      <button type="button" @click="setView('top')">俯视</button>
      <button type="button" @click="fitCurrentView">适应</button>
    </div>
    <div class="snapshot-hint">拖动旋转 · 滚轮缩放 · 右键平移 · 点击模型查看位置</div>
    <div v-if="empty" class="snapshot-empty">这份快照没有可渲染的模型</div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { applyTextPlates } from '../three/sandbox/textPlateRuntime.js'

const props = defineProps({
  snapshot: { type: Object, default: null },
})
const emit = defineEmits(['ready', 'select'])

const container = ref(null)
const empty = ref(false)
let renderer = null
let scene = null
let camera = null
let controls = null
let raycaster = null
let contentGroup = null
let selectionHelper = null
let resizeObserver = null
let frameId = 0
let modelRecords = []
let pointerStart = null
let disposed = false

function disposeObject(object) {
  object.traverse(child => {
    if (child.geometry) child.geometry.dispose?.()
    const materials = Array.isArray(child.material) ? child.material : (child.material ? [child.material] : [])
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && value.isTexture) value.dispose?.()
      }
      material.dispose?.()
    }
  })
}

function createLabel(text) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = 'rgba(11, 32, 25, 0.78)'
  const radius = 26
  ctx.beginPath()
  ctx.roundRect(8, 18, 496, 92, radius)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,.28)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = '#f2efe3'
  ctx.font = '600 34px "Noto Sans SC", "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const label = String(text || '模型')
  ctx.fillText(label.length > 16 ? label.slice(0, 15) + '…' : label, 256, 66)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
  sprite.scale.set(7.2, 1.8, 1)
  return sprite
}

function computeWorldBounds(snapshot) {
  const world = snapshot?.world
  if (world?.bounds && Number.isFinite(Number(world.bounds.minX))) {
    return {
      minX: Number(world.bounds.minX),
      maxX: Number(world.bounds.maxX),
      minZ: Number(world.bounds.minZ),
      maxZ: Number(world.bounds.maxZ),
    }
  }
  const width = Number(world?.chunkSize?.width) || 54
  const depth = Number(world?.chunkSize?.depth) || 42
  const chunks = Array.isArray(world?.chunks) && world.chunks.length ? world.chunks : [{ x: 0, z: 0 }]
  const xs = chunks.map(chunk => Number(chunk.x) || 0)
  const zs = chunks.map(chunk => Number(chunk.z) || 0)
  return {
    minX: Math.min(...xs) * width - width / 2,
    maxX: Math.max(...xs) * width + width / 2,
    minZ: Math.min(...zs) * depth - depth / 2,
    maxZ: Math.max(...zs) * depth + depth / 2,
  }
}

function clearContent() {
  if (selectionHelper && scene) {
    scene.remove(selectionHelper)
    selectionHelper.geometry?.dispose?.()
    selectionHelper.material?.dispose?.()
    selectionHelper = null
  }
  if (!contentGroup) return
  scene.remove(contentGroup)
  disposeObject(contentGroup)
  contentGroup = null
  modelRecords = []
}

function loadSnapshot(snapshot) {
  if (!scene) return
  clearContent()
  empty.value = false
  contentGroup = new THREE.Group()
  contentGroup.name = 'snapshot-preview-content'
  scene.add(contentGroup)
  if (!snapshot) {
    empty.value = true
    return
  }

  const world = snapshot.world || {}
  const worldBounds = computeWorldBounds(snapshot)
  const worldSpan = Math.max(worldBounds.maxX - worldBounds.minX, worldBounds.maxZ - worldBounds.minZ, 20)
  const labelWidth = Math.max(6, Math.min(22, worldSpan * 0.12))
  const chunkWidth = Number(world.chunkSize?.width) || 54
  const chunkDepth = Number(world.chunkSize?.depth) || 42
  const chunks = Array.isArray(world.chunks) && world.chunks.length ? world.chunks : [{ x: 0, z: 0 }]
  const groundMaterial = new THREE.MeshStandardMaterial({ color: '#c9d6c3', roughness: 0.96, metalness: 0 })
  const borderMaterial = new THREE.LineBasicMaterial({ color: '#7e9586', transparent: true, opacity: 0.45 })
  for (const chunk of chunks) {
    const x = (Number(chunk.x) || 0) * chunkWidth
    const z = (Number(chunk.z) || 0) * chunkDepth
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(chunkWidth, chunkDepth), groundMaterial)
    ground.rotation.x = -Math.PI / 2
    ground.position.set(x, 0, z)
    ground.receiveShadow = true
    contentGroup.add(ground)
    const border = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(chunkWidth, chunkDepth)), borderMaterial)
    border.rotation.x = -Math.PI / 2
    border.position.set(x, 0.03, z)
    contentGroup.add(border)
  }

  const loader = new THREE.ObjectLoader()
  const models = Array.isArray(snapshot.models) ? snapshot.models : []
  for (const item of models) {
    if (!item?.object) continue
    try {
      const model = loader.parse(item.object)
      model.name = item.name || model.name || '模型'
      model.userData.previewModelId = String(item.id)
      applyTextPlates(THREE, model)
      model.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true
          child.receiveShadow = true
        }
      })
      contentGroup.add(model)
      const box = new THREE.Box3().setFromObject(model)
      const label = createLabel(model.name)
      if (label) {
        label.scale.set(labelWidth, labelWidth * 0.25, 1)
        label.position.set((box.min.x + box.max.x) / 2, Math.max(2, box.max.y + 1.6), (box.min.z + box.max.z) / 2)
        contentGroup.add(label)
      }
      modelRecords.push({
        id: String(item.id),
        name: model.name,
        object: model,
        position: { x: model.position.x, y: model.position.y, z: model.position.z },
      })
    } catch (error) {
      console.warn('[SnapshotPreview] 模型渲染失败', item?.id, error)
    }
  }

  empty.value = modelRecords.length === 0
  emit('ready', {
    models: modelRecords.map(record => ({
      id: record.id,
      name: record.name,
      position: { ...record.position },
    })),
    world: {
      chunks: chunks.length,
      chunkWidth,
      chunkDepth,
      bounds: computeWorldBounds(snapshot),
    },
  })
  fitCurrentView()
}

function boundsForView() {
  const bounds = computeWorldBounds(props.snapshot)
  const box = new THREE.Box3(
    new THREE.Vector3(bounds.minX, 0, bounds.minZ),
    new THREE.Vector3(bounds.maxX, 0, bounds.maxZ),
  )
  for (const record of modelRecords) {
    box.expandByObject(record.object)
  }
  return box
}

function frameBox(box, mode = 'iso') {
  if (!camera || !controls) return
  const center = new THREE.Vector3()
  box.getCenter(center)
  const size = Math.max(box.getSize(new THREE.Vector3()).x, box.getSize(new THREE.Vector3()).z, 18)
  const distance = size * 0.82
  if (mode === 'top') {
    camera.position.set(center.x, size * 1.65, center.z + 0.01)
  } else {
    camera.position.set(center.x + distance, size * 0.95, center.z + distance)
  }
  camera.near = Math.max(0.1, size / 500)
  camera.far = size * 12
  camera.updateProjectionMatrix()
  controls.target.set(center.x, Math.max(0, center.y), center.z)
  controls.minDistance = Math.max(4, size * 0.15)
  controls.maxDistance = size * 5
  controls.update()
}

function fitCurrentView() {
  if (!camera || !controls) return
  frameBox(boundsForView(), 'iso')
}

function setView(mode) {
  if (!camera || !controls) return
  const box = boundsForView()
  frameBox(box, mode === 'top' ? 'top' : 'iso')
}

function selectRecord(record) {
  if (!scene) return
  if (selectionHelper) {
    scene.remove(selectionHelper)
    selectionHelper.geometry?.dispose?.()
    selectionHelper.material?.dispose?.()
    selectionHelper = null
  }
  if (!record) return
  selectionHelper = new THREE.BoxHelper(record.object, 0x2fbf94)
  scene.add(selectionHelper)
  emit('select', {
    id: record.id,
    name: record.name,
    position: { ...record.position },
  })
}

function focusModel(id) {
  const record = modelRecords.find(item => item.id === String(id))
  if (!record) return
  selectRecord(record)
  const box = new THREE.Box3().setFromObject(record.object)
  frameBox(box, 'iso')
}

defineExpose({ focusModel, setView, fitCurrentView })

function onPointerDown(event) {
  pointerStart = { x: event.clientX, y: event.clientY }
}

function onPointerUp(event) {
  if (!pointerStart || !renderer || !camera) return
  const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y)
  pointerStart = null
  if (moved > 5) return
  const rect = renderer.domElement.getBoundingClientRect()
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects(modelRecords.map(record => record.object), true)
  if (!hits.length) {
    selectRecord(null)
    return
  }
  let target = hits[0].object
  while (target && !target.userData.previewModelId && target.parent) target = target.parent
  if (target?.userData.previewModelId) {
    selectRecord(modelRecords.find(record => record.id === target.userData.previewModelId) || null)
  }
}

function resize() {
  if (!renderer || !camera || !container.value) return
  const width = container.value.clientWidth
  const height = container.value.clientHeight
  if (!width || !height) return
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

function animate() {
  if (disposed) return
  frameId = requestAnimationFrame(animate)
  controls?.update()
  if (selectionHelper) selectionHelper.update()
  renderer?.render(scene, camera)
}

onMounted(() => {
  if (!container.value) return
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 5000)
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  container.value.appendChild(renderer.domElement)
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointerup', onPointerUp)

  const hemisphere = new THREE.HemisphereLight('#ffffff', '#6f8474', 1.5)
  scene.add(hemisphere)
  const sun = new THREE.DirectionalLight('#fff2d8', 2.2)
  sun.position.set(80, 140, 60)
  scene.add(sun)
  const fill = new THREE.DirectionalLight('#d9f4ea', 0.6)
  fill.position.set(-60, 80, -40)
  scene.add(fill)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.screenSpacePanning = false
  controls.maxPolarAngle = Math.PI / 2 - 0.04

  raycaster = new THREE.Raycaster()
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container.value)
  resize()
  loadSnapshot(props.snapshot)
  animate()
})

watch(() => props.snapshot, snapshot => {
  loadSnapshot(snapshot)
})

onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(frameId)
  resizeObserver?.disconnect()
  resizeObserver = null
  if (renderer) {
    renderer.domElement.removeEventListener('pointerdown', onPointerDown)
    renderer.domElement.removeEventListener('pointerup', onPointerUp)
  }
  clearContent()
  controls?.dispose()
  controls = null
  if (scene) disposeObject(scene)
  renderer?.dispose()
  renderer?.domElement?.remove()
  renderer = null
  scene = null
  camera = null
})
</script>

<style scoped>
.snapshot-preview {
  position: relative;
  width: 100%;
  height: min(52vh, 520px);
  min-height: 300px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(255, 255, 255, 0.7), transparent 60%),
    linear-gradient(160deg, #dfeae3, #c9d9d0 60%, #d9e6df);
}
.snapshot-preview :deep(canvas) { display: block; width: 100%; height: 100%; }
.snapshot-toolbar { position: absolute; z-index: 2; top: 10px; left: 10px; display: flex; gap: 6px; }
.snapshot-toolbar button {
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.66);
  color: #0f2e26;
  font: inherit;
  font-size: 10px;
  cursor: pointer;
  backdrop-filter: blur(8px);
}
.snapshot-toolbar button:hover { background: rgba(255, 255, 255, 0.9); }
.snapshot-hint {
  position: absolute;
  z-index: 2;
  left: 10px;
  bottom: 10px;
  padding: 5px 9px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.55);
  color: #3f5a4e;
  font-size: 9px;
  pointer-events: none;
}
.snapshot-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #5d7a6c;
  font-size: 11px;
  pointer-events: none;
}
</style>
