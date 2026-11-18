<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import * as THREE from 'three'
import { createCampusEngine } from '../three/engine/createCampusEngine.js'
import { executeProceduralModel } from '../three/sandbox/executeProceduralModel.js'
import { createCapabilityControlDocument } from '../three/sandbox/capabilityControl.js'
import { resolveProceduralModelParts } from '../three/sandbox/modelCapabilityManifest.js'
import { analyzeModelCollisionCompleteness } from '../three/sandbox/modelCollisionAnalyzer.js'
import { createSceneAssetGeneratorRegistry } from '../three/world/campus/sceneAssetGeneratorRegistry.js'
import { createProceduralAssetClient } from './sandbox/proceduralAssetClient.js'
import {
  buildProceduralAssetPayload,
  canArchiveSandboxModel,
  createBuiltinSandboxModel,
  createRoadEditPersistence,
  getSelectedModelState,
  groupBuiltinAssetsByCategory,
  listBuiltinAssets,
} from './sandbox/assetLibraryUi.js'
import ProceduralModelEditor from './ProceduralModelEditor.vue'
import BrandLogo from './BrandLogo.vue'
import { siteSettings } from '../site/siteSettings.js'
import { currentUser, isAdmin, loadCurrentUser, logout } from '../auth/authStore.js'
import { WEATHER_MODES } from '../three/engine/weatherRuntime.js'
import { analyzeHumanoidModel, buildHumanoidRetryPrompt } from '../three/sandbox/humanoidValidation.js'
import { captureModelViews } from '../three/sandbox/visualQcCapture.js'
import { buildComparisonSheet } from '../three/sandbox/comparisonSheet.js'
import { listMyPublishRequests, submitPublishRequest } from '../publish/publishRequests.js'
import { applyTextPlates, getPartTextSpec, updateTextPlate } from '../three/sandbox/textPlateRuntime.js'
import { PLAYER_PRESETS } from '../three/characters/playerPresets.js'
import { isAnyStretchableRoadModel, isPolylineRoadModel } from '../three/sandbox/roadEndpointMath.js'
import { localizePolygon, polygonBounds } from '../three/sandbox/footprintPolygon.js'
import { buildFootprintPromptSuffix } from './sandbox/footprintPrompt.js'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID || 'map-editor-local'
const viewport = ref(null)
const proceduralModelEditorRef = ref(null)
const selectedName = ref('')
const selectedEditable = ref(false)
const selectedCanArchive = ref(false)
const selectedIsRoad = ref(false)
const selectedIsPolylineRoad = ref(false)
const precisionModeActive = ref(false)
const objects = ref([])
const command = ref('')
const aiPrompt = ref('')
const referenceImageDataUrl = ref('')
const referenceImageName = ref('')
const aiBusy = ref(false)
// 生成模型前在地块上勾绘的占地：none / area（底面贴合）/ space（空间占据）
const footprintRegionMode = ref('none')
const footprintPoints = ref([])
const footprintSelfIntersecting = ref(false)
const footprintSizeLabel = computed(() => {
  if (footprintPoints.value.length < 3) return ''
  const bounds = polygonBounds(footprintPoints.value)
  return `${bounds.width.toFixed(1)} × ${bounds.depth.toFixed(1)} m`
})
const characterPrompt = ref('一名完整的现代风格 3D 游戏角色，人体比例自然，包含头部、躯干、双臂、双腿、手掌和鞋子，适合第三人称视角观察')
const characterBusy = ref(false)
// Three.js Object3D must remain raw; deep Vue proxies violate Three.js property invariants.
const editingModel = shallowRef(null)
const editorOpen = ref(false)
const editorMode = ref('edit')
const isDraftModel = ref(false)
const generationProgress = ref([])
const editBusy = ref(false)
const editError = ref('')
// AI 建模对话记录：跟着模型的 userData 走，随沙盒存档保存
const modelChatMessages = ref([])
const editHistory = ref([])
const message = ref('正在初始化空白沙盒…')
const playerWaterState = ref(null)
const showPhysicsDiagnostics = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('debug') === 'physics'
const physicsDiagnostics = ref(null)
let physicsDiagnosticsTimer = null
const saveStatus = ref('尚未保存')
const worldState = ref(null)
const selectedChunkKey = ref('')
const selectedChunkKeys = ref([])
const reclaimFeedback = ref(null)
const selectedChunks = computed(() => (worldState.value?.chunks || []).filter(item => selectedChunkKeys.value.includes(item.x + ':' + item.z)))
const managementMode = ref('sandbox')
const sandboxViewMode = ref('free')
function selectSandboxViewMode(mode) {
  if (!['free', '2.5d', '3d'].includes(mode)) return
  if (engine?.setViewMode?.(mode) === false) return
  sandboxViewMode.value = mode
}

async function handleLogout() {
  await logout()
  window.location.assign('/login')
}
const STORAGE_KEY = 'world-sandbox-mvp:workspace:v1'
// 人物模型独立存档：与沙盒场景分开，可单独保存/恢复/删除，不随沙盒一起被覆盖。
const PLAYER_STORAGE_KEY = 'world-sandbox-mvp:player-character:v1'
const time = ref(14)
const timeEnabled = ref(true)
const weather = ref('clear')
const weatherEnabled = ref(true)
const weatherModes = WEATHER_MODES
// 天气强度（0–100）：晴天=阳光强度、多云=云量、阴天=暗度、下雨=雨量、下雪=雪量、大雾=浓度
const weatherIntensity = ref(50)
const weatherIntensityLabel = computed(
  () => WEATHER_MODES[weather.value]?.intensityLabel || '强度',
)
// 天气模式只切换天气本身（降水/云/雪/雾/光照修正），不改时间与风力。
// 下雨模式进入即自动下雨，强度滑杆控制雨量。
function applyWeatherMode() {
  engine?.setWeatherMode?.(weather.value, Number(weatherIntensity.value) / 100)
  message.value = '天气模式已切换为「' + (WEATHER_MODES[weather.value]?.label || weather.value) + '」'
}
const wind = ref(20)
const windEnabled = ref(true)
let sandboxWindDirection = { x: 1, z: 0 }
const artificialLightingEnabled = ref(true)
const transformMode = ref('translate')
const placement = ref({ active: false, stage: '', level: 0, hasTarget: false, candidateLocked: false, instruction: '' })
const objectTypes = [
  { id: 'box', label: '立方体' }, { id: 'sphere', label: '球体' },
  { id: 'cylinder', label: '圆柱体' }, { id: 'cone', label: '圆锥体' },
  { id: 'torus', label: '环形体' },
]
let engine = null
let selected = null
let disposed = false
const objectsById = new Map()

// 资产库：服务端持久化的「我的模型」+ 前端程序化生成的内置素材
const assetClient = createProceduralAssetClient({ baseUrl: API_BASE, devUserId: DEV_USER_ID })
let builtinAssetRegistry = null
const builtinAssetGroups = groupBuiltinAssetsByCategory(listBuiltinAssets())
const myAssets = ref([])
const assetLibraryBusy = ref(false)
const renamingAssetId = ref(null)
const renamingAssetName = ref('')
const confirmDeleteAssetId = ref(null)

function getBuiltinAssetRegistry() {
  if (!builtinAssetRegistry) builtinAssetRegistry = createSceneAssetGeneratorRegistry(THREE)
  return builtinAssetRegistry
}

function syncObjects() {
  objects.value = engine?.getSandboxModels?.() || []
  selectedName.value = selected?.name || ''
  const selectionState = getSelectedModelState(selected)
  selectedEditable.value = selectionState.editable
  selectedCanArchive.value = selectionState.canArchive
  selectedIsRoad.value = isAnyStretchableRoadModel(selected)
  selectedIsPolylineRoad.value = isPolylineRoadModel(selected)
}
function handleModelSelected(payload) {
  selected = payload?.id ? engine?.getSandboxModel?.(payload.id) || null : null
  selectedName.value = selected?.name || ''
  // 视口单击与列表点选只走本回调、不触发 syncObjects，两个选择态布尔必须在这里同源刷新
  const selectionState = getSelectedModelState(selected)
  selectedEditable.value = selectionState.editable
  selectedCanArchive.value = selectionState.canArchive
  selectedIsRoad.value = isAnyStretchableRoadModel(selected)
  selectedIsPolylineRoad.value = isPolylineRoadModel(selected)
  precisionModeActive.value = false
}
function registerModel(root, name, position = null) {
  root.name = name || root.name || '模型'
  const id = engine.addSandboxModel(root, { name: root.name, position })
  objectsById.set(id, root)
  selected = root
  syncObjects()
  message.value = '已添加建模组：' + root.name
  return root
}
function addModel(type) {
  const geometries = {
    box: () => new THREE.BoxGeometry(2, 2, 2),
    sphere: () => new THREE.SphereGeometry(1.15, 32, 24),
    cylinder: () => new THREE.CylinderGeometry(1, 1, 2, 32),
    cone: () => new THREE.ConeGeometry(1.1, 2.2, 32),
    torus: () => new THREE.TorusKnotGeometry(0.8, 0.28, 100, 16),
  }
  const mesh = new THREE.Mesh((geometries[type] || geometries.box)(), new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(Math.random(), 0.42, 0.56), roughness: 0.68,
  }))
  mesh.name = objectTypes.find(item => item.id === type)?.label || '模型'
  mesh.position.y = type === 'torus' ? 1.4 : 1
  const group = new THREE.Group()
  group.add(mesh)
  registerModel(group, mesh.name + ' ' + (objects.value.length + 1))
}
function addLightSwitchDemo() {
  const player = engine?.getPlayerPosition?.() || { x: 0, z: 14 }
  const lamp = new THREE.Group()
  lamp.name = '演示灯具'
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.42, 0.28, 20),
    new THREE.MeshStandardMaterial({ color: '#343b42', metalness: 0.65, roughness: 0.35 }),
  )
  base.position.y = 0.14
  lamp.add(base)
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 1.5, 12),
    new THREE.MeshStandardMaterial({ color: '#69747b', metalness: 0.7, roughness: 0.3 }),
  )
  stem.position.y = 0.95
  lamp.add(stem)
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 20, 16),
    new THREE.MeshStandardMaterial({
      color: '#fff0b5',
      emissive: '#ffd36a',
      emissiveIntensity: 1.4,
      roughness: 0.25,
    }),
  )
  bulb.position.y = 1.9
  bulb.userData.componentId = 'demo-light-bulb'
  bulb.userData.stateBinding = { key: 'enabled', property: 'emissiveIntensity', enabledValue: 1.4, disabledValue: 0 }
  lamp.add(bulb)
  const pointLight = new THREE.PointLight('#ffd98a', 2.2, 11, 1.8)
  pointLight.position.set(0, 1.9, 0)
  pointLight.castShadow = true
  pointLight.userData.componentId = 'demo-point-light'
  pointLight.userData.stateBinding = { key: 'enabled', property: 'intensity', enabledValue: 2.2, disabledValue: 0 }
  lamp.add(pointLight)
  lamp.userData.worldState = { enabled: true }
  const lampPosition = { x: player.x + 5, y: 0, z: player.z + 2 }
  const lampRoot = registerModel(lamp, '演示灯具', lampPosition)

  const switchRoot = new THREE.Group()
  switchRoot.name = '墙壁开关'
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 1.05, 0.12),
    new THREE.MeshStandardMaterial({ color: '#e7e5dc', roughness: 0.55 }),
  )
  plate.position.y = 1.2
  plate.userData.componentId = 'wall-switch-plate'
  switchRoot.add(plate)
  const button = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.38, 0.1),
    new THREE.MeshStandardMaterial({ color: '#b7c6c0', roughness: 0.35 }),
  )
  button.position.set(0, 1.2, 0.11)
  button.userData.componentId = 'wall-switch-button'
  button.userData.displayName = '墙壁开关'
  button.userData.interactionConfig = {
    action: 'toggle',
    targetId: lampRoot.userData.sandboxModelId,
    stateKey: 'enabled',
    radius: 4.8,
    prompt: '靠近墙壁开关，按 E 切换演示灯具',
    openMessage: '演示灯具已开启',
    closeMessage: '演示灯具已关闭',
  }
  switchRoot.add(button)
  switchRoot.userData.interactionMessage = '你按下了墙壁开关'
  const switchPosition = { x: player.x + 2, y: 0, z: player.z + 2 }
  registerModel(switchRoot, '墙壁开关', switchPosition)
  message.value = '已创建灯具与墙壁开关演示。靠近开关按 E，验证灯具亮灭。'
  saveStatus.value = '未保存演示场景'
}

function handleSandboxModelInteract(payload) {
  const result = engine?.applySandboxModelInteraction?.(payload || {})
  if (!result?.ok) {
    const errors = {
      'target-part-not-found': '交互目标部件不存在，无法执行动作',
      'interior-entry-point-not-found': '内部入口部件不存在，无法进入',
      'interior-entry-point-not-declared': '模型没有声明这个内部入口',
      'interior-entry-point-blocked': '内部入口位置被碰撞体占据，请调整入口点或墙体碰撞声明',
      'already-inside-model': '当前已经处于一个模型的内部空间',
      'not-inside-target-model': '当前不在这个模型内部，无法从此处退出',
      'interior-source-mismatch': '进入和退出动作必须由当前模型自身触发',
      'player-teleport-failed': '人物位置切换失败',
    }
    message.value = errors[result?.reason] || '当前模型未声明可执行的交互动作'
    return
  }
  const config = payload?.config || {}
  if (result.statePatch) {
    const enabled = Boolean(result.state?.[result.stateKey])
    const defaultOn = result.stateKey === 'doorOpen' ? '门已打开' : '状态已开启'
    const defaultOff = result.stateKey === 'doorOpen' ? '门已关闭' : '状态已关闭'
    message.value = enabled ? (config.openMessage || defaultOn) : (config.closeMessage || defaultOff)
  } else if (result.action === 'enter') {
    message.value = '已进入模型内部空间'
  } else if (result.action === 'exit') {
    message.value = '已返回进入前的位置'
  } else {
    message.value = config.successMessage || ('已执行 ' + result.action + ' 动作')
  }
  if (result.action !== 'enter' && result.action !== 'exit') {
    saveStatus.value = '状态已变更，记得保存'
  }
}

function selectModel(item) {
  const id = item?.id || item?.userData?.sandboxModelId
  if (id) engine?.selectSandboxModel(id)
}
function setMode(mode) {
  const accepted = engine?.setSandboxTransformMode?.(mode)
  if (engine && accepted === false) return
  transformMode.value = mode
  precisionModeActive.value = mode !== 'browse'
}
function beginMoveSelected() {
  if (!selected) return
  precisionModeActive.value = false
  engine?.setSandboxTransformMode('browse')
  const started = engine?.beginSandboxModelPlacement(selected.userData.sandboxModelId)
  if (started) message.value = '已进入全局选址。移动鼠标预览占地范围，点击地面锁定候选位置。'
}
function confirmPlacement() {
  if (!engine?.confirmSandboxModelPlacement?.()) {
    message.value = placement.value.blocked
      ? `当前位置与“${placement.value.blockerName || '已有物体'}”重叠，不能落地。请重新选择位置。`
      : '请先点击沙盒地面锁定一个可用候选位置，再确认落地。'
  }
}
function unlockPlacementCandidate() {
  engine?.unlockSandboxPlacementCandidate?.()
}
function cancelPlacement() {
  engine?.cancelSandboxModelPlacement?.()
}
function handlePlacementChange(payload) {
  placement.value = payload || { active: false }
  if (payload?.confirmed && payload.id) {
    const model = engine?.getSandboxModel(payload.id)
    if (model) {
      objectsById.set(payload.id, model)
      selected = model
    }
    syncObjects()
    setMode('translate')
    const saved = saveSandbox()
    message.value = saved ? '模型已完成落位并保存；可继续旋转、高度和缩放微调。' : '模型已完成落位，但存档失败，请检查存储空间后重试。'
    saveStatus.value = saved ? '已保存' : '存档失败'
  } else if (payload?.cancelled) {
    syncObjects()
    message.value = payload.existing ? '已取消移动，模型恢复原位置。' : '已取消新模型放置。'
  } else if (payload?.active) {
    message.value = payload.instruction || '正在进行分层选址。'
  }
}
function deleteSelected() {
  if (!selected) return
  const id = selected.userData.sandboxModelId
  const removed = engine?.removeSandboxModel(id)
  if (!removed) return
  objectsById.delete(id)
  selected = null
  selectedIsRoad.value = false
  selectedIsPolylineRoad.value = false
  precisionModeActive.value = false
  syncObjects()
  message.value = '已删除模型组'
}

// ---- 生成模型前划定占地：矩形起步，拖角点/加断点改形状（和道路端点编辑同一套手感） ----
function handleFootprintDrawingChange(payload) {
  footprintPoints.value = Array.isArray(payload?.points) ? payload.points : []
  footprintSelfIntersecting.value = payload?.selfIntersecting === true
}

function startFootprintDrawing() {
  if (footprintRegionMode.value === 'none') {
    footprintRegionMode.value = 'area'
  }
  if (engine?.beginSandboxFootprintDrawing?.()) {
    footprintPoints.value = engine.getSandboxFootprintDrawingState?.().points || []
    message.value = '已创建矩形占地：拖黄色角点改形状，拖蓝色中心整体移动；「添加断点」可拖出凹凸'
  } else {
    message.value = '无法创建占地：请先关闭选址或精细调整'
  }
}

function addFootprintBreakpoint() {
  if (engine?.addSandboxFootprintBreakpoint?.()) {
    message.value = '已在最长边上加断点：拖动新出现的黄色点做出凹凸'
  }
}

function removeFootprintBreakpoint() {
  if (engine?.removeSandboxFootprintBreakpoint?.()) {
    message.value = '已删除最近的断点'
  } else {
    message.value = '至少保留三个点，不能再删'
  }
}

function clearFootprint() {
  engine?.clearSandboxFootprintRegion?.()
  footprintPoints.value = []
  footprintSelfIntersecting.value = false
}

// ---- 道路断点：点击道路上的位置加一个断点；中心手柄整段平移，角手柄调宽度 ----
function addSelectedRoadPoint() {
  const id = selected?.userData?.sandboxModelId
  if (!id) return
  if (engine?.beginSandboxRoadBreakpointPick?.()) {
    message.value = '点击道路上要加断点的位置（一次只加一个点）；Esc 取消'
    return
  }
  // 不在端点模式时退回自动插入（最长段中点）
  const ok = engine?.addSandboxRoadPoint?.(id)
  if (ok) {
    selected = engine.getSandboxModel(id)
    selectedIsPolylineRoad.value = isPolylineRoadModel(selected)
    message.value = '已添加断点：拖动任意控制点调整道路形状'
    saveSandbox()
    syncObjects()
  } else {
    message.value = '添加断点失败'
  }
}

function removeSelectedRoadPoint() {
  const id = selected?.userData?.sandboxModelId
  if (!id) return
  const ok = engine?.removeSandboxRoadPoint?.(id)
  if (ok) {
    selected = engine.getSandboxModel(id)
    selectedIsPolylineRoad.value = isPolylineRoadModel(selected)
    message.value = '已删除最后一个断点'
    saveSandbox()
    syncObjects()
  } else {
    message.value = '删除断点失败'
  }
}
function duplicateSelected() {
  if (!selected) return
  const newId = engine?.duplicateSandboxModel(selected.userData.sandboxModelId)
  if (newId) {
    const copy = engine.getSandboxModel(newId)
    if (copy) { objectsById.set(newId, copy); selected = copy; engine.selectSandboxModel(newId) }
    syncObjects()
    message.value = '已复制模型组'
  }
}
function onReferenceImageChange(event) {
  const file = event.target.files?.[0]
  referenceImageDataUrl.value = ''
  referenceImageName.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    message.value = '参考图仅支持 PNG、JPG 或 WebP'
    event.target.value = ''
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    message.value = '参考图不能超过 10 MB'
    event.target.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    referenceImageDataUrl.value = String(reader.result || '')
    referenceImageName.value = file.name
    message.value = '参考图已就绪，可以开始生成'
  }
  reader.onerror = () => { message.value = '参考图读取失败' }
  reader.readAsDataURL(file)
}
function updateGenerationProgress(event) {
  const next = [...generationProgress.value]
  const index = next.findIndex(item => item.stage === event.stage)
  for (let i = 0; i < next.length; i++) {
    if (next[i].status === 'active') next[i] = { ...next[i], status: 'done' }
  }
  const entry = {
    stage: event.stage,
    label: event.label || event.stage,
    detail: event.detail || '',
    status: event.status || 'active',
  }
  if (index >= 0) next[index] = entry
  else next.push(entry)
  generationProgress.value = next
}

async function runModelVisualQualityControl(originalPrompt, options = {}) {
  updateGenerationProgress({
    stage: 'visual-inspection',
    label: 'AI 多视角视觉质量检测',
    detail: '正在从 Three.js 实际预览采集正面、侧面、顶部和等轴视图',
    status: 'active',
  })
  try {
    await nextTick()
    const screenshots = await proceduralModelEditorRef.value?.captureVisualViews?.()
    if (!Array.isArray(screenshots) || screenshots.length < 3) {
      throw new Error('无法从模型预览采集足够的多视角截图')
    }
    // 复检基线：修改前那一版的截图。首次质检没有基线，才把用户参考图当目标。
    let baselineScreenshots = Array.isArray(options?.baselineScreenshots) && options.baselineScreenshots.length
      ? options.baselineScreenshots.map(shot => ({ ...shot }))
      : null
    let includeReferenceImage = options?.includeReferenceImage !== false && !baselineScreenshots
    // 编辑请求可携带临时参考图（粘贴/选择），优先于创建时的参考图
    const reviewReferenceImage = options?.referenceImageDataUrl || referenceImageDataUrl.value || ''
    // 单张对比表评审：参考图 + 多个渲染视角合成一张带标签的图；画布不可用时退回多张截图
    const buildReviewPayload = async () => {
      try {
        const sheet = await buildComparisonSheet(screenshots, {
          referenceImageDataUrl: includeReferenceImage ? reviewReferenceImage : '',
          title: includeReferenceImage ? '视觉质检：参考图 + 渲染视角' : '视觉质检：渲染视角',
        })
        if (sheet) return { screenshots: [{ label: 'comparison-sheet', imageDataUrl: sheet }], reference: undefined }
      } catch {
        // 退回多张截图
      }
      return {
        screenshots,
        reference: includeReferenceImage ? (reviewReferenceImage || undefined) : undefined,
      }
    }
    const buildBaselinePayload = async () => {
      if (!baselineScreenshots) return undefined
      try {
        const sheet = await buildComparisonSheet(baselineScreenshots, { title: '修改前基线' })
        if (sheet) return [{ label: 'baseline-comparison-sheet', imageDataUrl: sheet }]
      } catch {
        // 退回原基线截图
      }
      return baselineScreenshots
    }
    let latestReport = null
    for (let round = 0; round <= 2; round += 1) {
      const current = editingModel.value
      if (!current) throw new Error('视觉质检时模型实例已丢失')
      updateGenerationProgress({
        stage: 'visual-inspection',
        label: round === 0 ? 'AI 视觉质量检测' : `第 ${round} 轮修正后复检`,
        detail: `正在分析 ${screenshots.length} 个实际渲染视角${baselineScreenshots ? '，并与修改前的基线对比' : ''}`,
        status: 'active',
      })
      const reviewPayload = await buildReviewPayload()
      const baselinePayload = await buildBaselinePayload()
      const inspectResponse = await fetch(API_BASE + '/assets/ai-image/inspect-procedural-object', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
        body: JSON.stringify({
          prompt: originalPrompt,
          objectType: current.userData.proceduralModelConfig?.objectType || '独立 3D 模型',
          referenceImageDataUrl: reviewPayload.reference,
          screenshots: reviewPayload.screenshots,
          geometryDiagnostics: current.userData.proceduralModelGeometryDiagnostics || null,
          footprint: current.userData.sandboxFootprintPolygon
            ? {
                mode: current.userData.sandboxFootprintPolygon.mode,
                points: current.userData.sandboxFootprintPolygon.points,
              }
            : undefined,
          baselineScreenshots: baselinePayload,
        }),
      })
      const inspectBody = await inspectResponse.json().catch(() => ({}))
      if (!inspectResponse.ok) throw new Error(inspectBody.message || 'AI 视觉质量检测失败：HTTP ' + inspectResponse.status)
      latestReport = inspectBody.data || inspectBody.result || inspectBody
      current.userData.proceduralModelVisualQuality = latestReport
      appendModelChat('assistant', '', { type: 'visual-qc', round, report: latestReport })
      if (latestReport.passed === true) {
        updateGenerationProgress({
          stage: 'visual-inspection',
          label: '视觉质量检测通过',
          detail: `评分 ${latestReport.score}/100：${latestReport.summary || '未发现需要自动修复的主要视觉问题'}`,
          status: 'done',
        })
        return latestReport
      }
      const actionable = (latestReport.issues || []).filter(item =>
        ['critical', 'major'].includes(item.severity) && item.repairInstruction,
      )
      if (round === 2 || !actionable.length) {
        updateGenerationProgress({
          stage: 'visual-inspection',
          label: '视觉质检未通过，保留人工调整',
          detail: latestReport.summary || '检测到问题，但没有可安全自动执行的明确修复建议',
          status: 'failed',
        })
        return latestReport
      }
      updateGenerationProgress({
        stage: 'visual-repair',
        label: `自动定向修正（${round + 1}/2）`,
        detail: actionable.map(item => item.issue).join('；').slice(0, 500),
        status: 'active',
      })
      appendModelChat('assistant', `自动修正（第 ${round + 1} 轮）：` + actionable.map(item => item.issue).join('；').slice(0, 500), { type: 'repair', round: round + 1 })
      const instruction = [
        '这是自动视觉质检后的定向修复。请根据以下可观察问题做最小必要修改，不要整体重建模型，不要修改无关部件，保留模型身份、现有稳定 componentId、参数、能力声明和交互结构。',
        ...actionable.map((item, index) => `${index + 1}. [${item.componentId || '整体模型'}] ${item.issue}。修复要求：${item.repairInstruction}`),
      ].join('\n')
      const repairResponse = await fetch(API_BASE + '/assets/ai-image/modify-procedural-object', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
        body: JSON.stringify({
          source: current.userData.proceduralModelSource,
          parameters: current.userData.proceduralModelParameters || [],
          parameterValues: current.userData.proceduralModelParameterValues || {},
          parts: current.userData.proceduralModelParts || [],
          environmentBindings: current.userData.proceduralModelEnvironmentBindings || [],
          modelCapabilityManifest: current.userData.proceduralModelCapabilityManifest || null,
          geometryDiagnostics: current.userData.proceduralModelGeometryDiagnostics || null,
          selectedPartId: '',
          instruction,
          objectType: current.userData.proceduralModelConfig?.objectType || '独立 3D 模型',
        }),
      })
      const repairBody = await repairResponse.json().catch(() => ({}))
      if (!repairResponse.ok) throw new Error(repairBody.message || 'AI 自动修正失败：HTTP ' + repairResponse.status)
      const result = repairBody.data || repairBody.result || repairBody
      await replaceEditedModel(
        result.generatedCode,
        current.userData.proceduralModelParameterValues || {},
        result.parameters || result.modelParameters || current.userData.proceduralModelParameters || [],
        result.parts || result.modelParts || current.userData.proceduralModelParts || [],
        'AI 视觉质检自动修正完成',
        true,
        result.environmentBindings,
        result.modelCapabilityManifest,
      )
      if (editingModel.value) editingModel.value.userData.proceduralModelVisualQuality = latestReport
      await nextTick()
      const refreshed = await proceduralModelEditorRef.value?.captureVisualViews?.()
      if (!Array.isArray(refreshed) || refreshed.length < 3) throw new Error('自动修正后无法重新采集视觉截图')
      // 下一轮复检以“修正前”的这一版截图为基线，并且不再依赖用户参考图
      baselineScreenshots = screenshots.map(shot => ({ ...shot }))
      includeReferenceImage = false
      screenshots.splice(0, screenshots.length, ...refreshed)
    }
    if (editingModel.value && latestReport) editingModel.value.userData.proceduralModelVisualQuality = latestReport
    return latestReport
  } catch (error) {
    updateGenerationProgress({
      stage: 'visual-inspection',
      label: '视觉质检未完成',
      detail: error?.message || '视觉检测服务异常',
      status: 'failed',
    })
    appendModelChat('assistant', '视觉质检未完成：' + (error?.message || '视觉检测服务异常'), { type: 'stage' })
    return null
  }
}

async function runModelCollisionQualityControl() {
  for (let round = 0; round <= 1; round += 1) {
    const current = editingModel.value
    if (!current) throw new Error('碰撞检查时模型实例已丢失')
    const report = analyzeModelCollisionCompleteness(current)
    current.userData.proceduralModelCollisionAnalysis = report
    if (report.status === 'complete') {
      updateGenerationProgress({
        stage: 'collision-inspection',
        label: '模型碰撞完整性检查通过',
        detail: `检查 ${report.summary.componentCount} 个部件，绑定 ${report.summary.boundColliderCount} 个有效碰撞声明`,
        status: 'done',
      })
      return true
    }
    updateGenerationProgress({
      stage: round === 0 ? 'collision-inspection' : 'collision-reinspection',
      label: round === 0 ? '检查模型碰撞完整性' : '复检模型碰撞声明',
      detail: `发现 ${report.summary.blockingIssueCount} 项阻断问题、${report.summary.reviewIssueCount} 项待复核问题`,
      status: 'active',
    })
    if (round === 1) {
      updateGenerationProgress({
        stage: 'collision-inspection',
        label: '碰撞完整性未通过',
        detail: '自动修复后仍存在未解决的碰撞声明问题；模型暂不允许加入沙盒',
        status: 'failed',
      })
      return false
    }
    const response = await fetch(API_BASE + '/assets/ai-image/repair-procedural-collisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
      body: JSON.stringify({
        source: current.userData.proceduralModelSource,
        parameters: current.userData.proceduralModelParameters || [],
        parameterValues: current.userData.proceduralModelParameterValues || {},
        parts: current.userData.proceduralModelParts || [],
        modelCapabilityManifest: current.userData.proceduralModelCapabilityManifest || null,
        collisionReport: report,
        objectType: current.userData.proceduralModelConfig?.objectType || '独立 3D 模型',
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.message || 'AI 碰撞声明自动补齐失败：HTTP ' + response.status)
    const result = payload.data || payload.result || payload
    if (!result?.generatedCode) throw new Error('AI 碰撞修复没有返回完整模型源码')
    await replaceEditedModel(
      result.generatedCode,
      current.userData.proceduralModelParameterValues || {},
      result.parameters || result.modelParameters || current.userData.proceduralModelParameters || [],
      result.parts || result.modelParts || current.userData.proceduralModelParts || [],
      'AI 已根据碰撞诊断补齐模型声明',
      false,
      result.environmentBindings,
      result.modelCapabilityManifest,
    )
  }
  return false
}

// ---- 分阶段生成（借鉴 img2threejs）：体块 → 结构 → 材质，每阶段一次视觉门禁 ----
const stagedGenerationEnabled = ref(true)
const STAGED_MODEL_OBJECT_TYPE = '独立 3D 模型'

async function requestProceduralModel({ prompt, objectType, imageDataUrl, stage }) {
  const response = await fetch(API_BASE + '/assets/ai-image/generate-procedural-object-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
    body: JSON.stringify({
      prompt,
      objectType,
      visualStyle: 'stylized',
      imageDataUrl: imageDataUrl || undefined,
      stage: stage || undefined,
    }),
  })
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || '模型生成失败：HTTP ' + response.status)
  }
  let buffer = ''
  let result = null
  let completed = false
  const decoder = new TextDecoder()
  const processEvent = event => {
    if (!event || typeof event.type !== 'string') return
    if (event.type === 'stage') {
      updateGenerationProgress({
        stage: event.stage,
        label: event.label || event.stage,
        detail: event.detail || '',
        status: event.status || 'active',
      })
    } else if (event.type === 'single') {
      result = event.result
    } else if (event.type === 'error') {
      throw new Error(event.message || '模型生成失败')
    } else if (event.type === 'complete') {
      completed = true
    }
  }
  const reader = response.body.getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) processEvent(JSON.parse(line))
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) processEvent(JSON.parse(buffer.trim()))
  if (!completed || !result?.generatedCode) throw new Error('模型生成事件流提前结束，未收到完整模型源码')
  return result
}

async function requestProceduralModification({ source, instruction, objectType, parameters = [], parameterValues = {}, parts = [], environmentBindings = [], modelCapabilityManifest = null, referenceImageDataUrl = '' }) {
  const response = await fetch(API_BASE + '/assets/ai-image/modify-procedural-object', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
    body: JSON.stringify({
      source,
      parameters,
      parameterValues,
      parts,
      environmentBindings,
      modelCapabilityManifest,
      geometryDiagnostics: null,
      selectedPartId: '',
      instruction,
      objectType,
      referenceImageDataUrl: referenceImageDataUrl || undefined,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || 'AI 修改失败：HTTP ' + response.status)
  const result = body.data || body.result || body
  if (!result?.generatedCode) throw new Error('AI 修改没有返回完整源码')
  return result
}

async function inspectStagedModel({ model, stageLabel, stageRubric, originalPrompt, footprint }) {
  const screenshots = await captureModelViews(THREE, model)
  let reviewScreenshots = screenshots
  try {
    const sheet = await buildComparisonSheet(screenshots, {
      referenceImageDataUrl: referenceImageDataUrl.value || '',
      title: '阶段质检：' + stageLabel,
    })
    if (sheet) reviewScreenshots = [{ label: 'comparison-sheet', imageDataUrl: sheet }]
  } catch {
    // 退回多张截图
  }
  const response = await fetch(API_BASE + '/assets/ai-image/inspect-procedural-object', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
    body: JSON.stringify({
      prompt: '【阶段：' + stageLabel + '】' + stageRubric + String.fromCharCode(10) + '原始需求：' + (originalPrompt || ''),
      objectType: STAGED_MODEL_OBJECT_TYPE,
      screenshots: reviewScreenshots,
      footprint: footprint || undefined,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || '阶段视觉质检失败：HTTP ' + response.status)
  return { report: body.data || body.result || body, screenshots }
}

async function repairStagedModel({ source, report, stageLabel, objectType, extraInstruction }) {
  const actionable = (report?.issues || []).filter(item =>
    ['critical', 'major'].includes(item.severity) && item.repairInstruction,
  )
  if (!actionable.length && !extraInstruction) return null
  const instruction = [
    '这是' + stageLabel + '阶段的视觉质检定向修复。只做最小必要修改，不要整体重建模型，不要修改无关部件，保持现有部件 id 与结构。',
    ...actionable.map((item, index) => `${index + 1}. [${item.componentId || '整体模型'}] ${item.issue}。修复要求：${item.repairInstruction}`),
    extraInstruction ? ('补充硬性修复要求：' + extraInstruction) : '',
  ].filter(Boolean).join(String.fromCharCode(10))
  const result = await requestProceduralModification({ source, instruction, objectType })
  return result.generatedCode
}

// 确定性几何门禁：拦“零厚度平面充当建筑”这类视觉质检已经多次发现的问题
function describeGeometryProblem(model) {
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  if (![size.x, size.y, size.z].every(Number.isFinite) || size.lengthSq() === 0) {
    return '模型没有可见几何'
  }
  const horizontal = [size.x, size.z].filter(value => value > 0)
  if (horizontal.length < 2) return '模型缺少水平方向的体量'
  const minHorizontal = Math.min(...horizontal)
  const maxHorizontal = Math.max(...horizontal)
  if (minHorizontal < 0.3 || minHorizontal / maxHorizontal < 0.08) {
    return `模型平面进深过薄（${minHorizontal.toFixed(2)} m），是零厚度平面而不是有体量的建筑；必须用闭合实体体块，保证两个水平方向都有足够进深，禁止用薄板或单面充当墙体`
  }
  return null
}

// 从需求里提取需要渲染的文字（引号内文字或“XX楼/院/馆/门”这类命名）
function extractRequestedText(prompt) {
  const found = new Set()
  const quoted = prompt.match(/[「『“"']([^「」『』“”"']{1,20})[」』”"']/g) || []
  for (const item of quoted) found.add(item.replace(/^[「『“"']|[」』”"']$/g, ''))
  const named = prompt.match(/[一-龥]{2,8}(?=楼|院|馆|门|堂|阁|塔|校)/g) || []
  for (const item of named) found.add(item)
  return [...found].filter(Boolean).slice(0, 5)
}

async function runStagedModelGeneration({ prompt, generationPrompt, objectType, useFootprint, footprintLocal }) {
  const footprint = useFootprint ? { mode: footprintRegionMode.value, points: footprintLocal.points.map(point => ({ ...point })) } : undefined
  const requestedTexts = extractRequestedText(prompt)
  const attachFootprint = model => {
    if (footprint) model.userData.sandboxFootprintPolygon = { mode: footprint.mode, points: footprint.points.map(point => ({ ...point })) }
  }
  let stageIndex = 0
  const reviewStage = async (model, label, rubric) => {
    try {
      updateGenerationProgress({ stage: 'stage-review', label: label + '：视觉质检', detail: '采集 4 视角并送视觉模型', status: 'active' })
      const { report } = await inspectStagedModel({ model, stageLabel: label, stageRubric: rubric, originalPrompt: prompt, footprint })
      appendModelChat('assistant', '', { type: 'visual-qc', round: stageIndex, report, stageLabel: label })
      updateGenerationProgress({
        stage: 'stage-review',
        label: label + '：视觉质检' + (report?.passed ? '通过' : '未通过'),
        detail: `评分 ${report?.score}/100${report?.summary ? '：' + report.summary : ''}`.slice(0, 400),
        status: report?.passed ? 'done' : 'failed',
      })
      return report
    } catch (error) {
      updateGenerationProgress({
        stage: 'stage-review',
        label: label + '：视觉质检未完成',
        detail: (error?.message || '视觉质检服务异常').slice(0, 300),
        status: 'failed',
      })
      appendModelChat('assistant', label + '视觉质检未完成：' + (error?.message || '服务异常'), { type: 'stage' })
      return null
    }
  }

  // 阶段 1/3：体块
  updateGenerationProgress({ stage: 'blockout', label: '阶段 1/3：生成体块', detail: '只生成体块与占地，先过视觉门禁', status: 'active' })
  const blockout = await requestProceduralModel({
    prompt: generationPrompt,
    objectType,
    imageDataUrl: referenceImageDataUrl.value || undefined,
    stage: 'blockout',
  })
  let source = blockout.generatedCode
  const draftSpec = blockout.draftSpec || null
  let model = await executeProceduralModel(source, { timeoutMs: 60000 })
  attachFootprint(model)
  if (draftSpec) {
    appendModelChat('assistant', `结构规划：${draftSpec.parts?.length || 0} 个部件，尺寸 ${draftSpec.dimensions?.width}×${draftSpec.dimensions?.height}×${draftSpec.dimensions?.depth} m`, { type: 'stage' })
  }
  // 确定性几何门禁：零厚度平面直接触发定向修复，不再只靠视觉模型判断
  const geometryProblem = describeGeometryProblem(model)
  if (geometryProblem) {
    updateGenerationProgress({ stage: 'blockout', label: '体块几何门禁未通过', detail: geometryProblem.slice(0, 200), status: 'failed' })
    appendModelChat('assistant', '体块几何门禁未通过：' + geometryProblem, { type: 'stage' })
    const repaired = await repairStagedModel({
      source,
      report: null,
      stageLabel: '体块',
      objectType,
      extraInstruction: geometryProblem + '。体块必须是闭合实体（Box/ExtrudeGeometry 等），两个水平方向都要有真实尺寸。',
    })
    if (repaired) {
      source = repaired
      model = await executeProceduralModel(source, { timeoutMs: 60000 })
      attachFootprint(model)
    }
  }
  let report = await reviewStage(model, '体块', '评估体块轮廓、比例、占地是否与描述一致；忽略材质细节和线脚。')
  if (report?.passed !== true) {
    const repaired = await repairStagedModel({ source, report, stageLabel: '体块', objectType })
    if (repaired) {
      source = repaired
      model = await executeProceduralModel(source, { timeoutMs: 60000 })
      attachFootprint(model)
      report = await reviewStage(model, '体块复检', '评估体块轮廓、比例、占地是否与描述一致；忽略材质细节和线脚。')
    }
  }

  // 阶段 2/3：结构
  stageIndex = 1
  updateGenerationProgress({ stage: 'structure', label: '阶段 2/3：补充结构', detail: '保持体块不变，补齐墙体、窗带、屋顶和入口', status: 'active' })
  const partList = draftSpec?.parts?.length
    ? draftSpec.parts.map(part => part.id + '(' + part.role + ')').join('、')
    : '墙体、横向窗带、屋顶女儿墙、入口雨棚与台阶'
  const textInstruction = requestedTexts.length
    ? '需求中的文字 ' + requestedTexts.map(text => `「${text}」`).join('、')
      + ' 必须出现在入口标牌上：在标牌部件设置 userData.textSpec（text 为对应中文），禁止自己画字形或 Canvas 文字。'
    : ''
  const structureResult = await requestProceduralModification({
    source,
    objectType,
    instruction: '在保持体块尺寸、位置和部件 id 不变的前提下补充结构细节。按结构规划实现：' + partList
      + '。不要修改材质颜色和表面细节，不要新增规划之外的部件，不要改变整体占地。' + textInstruction,
  })
  source = structureResult.generatedCode
  model = await executeProceduralModel(source, { timeoutMs: 60000 })
  attachFootprint(model)
  report = await reviewStage(model, '结构', '评估结构细节是否补齐（墙体、窗带、屋顶、入口等）；忽略材质颜色。')
  if (report?.passed !== true) {
    const repaired = await repairStagedModel({ source, report, stageLabel: '结构', objectType })
    if (repaired) {
      source = repaired
      model = await executeProceduralModel(source, { timeoutMs: 60000 })
      attachFootprint(model)
      report = await reviewStage(model, '结构复检', '评估结构细节是否补齐（墙体、窗带、屋顶、入口等）；忽略材质颜色。')
    }
  }

  // 阶段 3/3：材质与收尾
  stageIndex = 2
  updateGenerationProgress({ stage: 'material', label: '阶段 3/3：材质与收尾', detail: '保持几何不变，应用材质与表面细节', status: 'active' })
  const materialList = draftSpec?.materials?.length ? draftSpec.materials.map(material => material.name).join('、') : ''
  const materialResult = await requestProceduralModification({
    source,
    objectType,
    instruction: '在保持几何结构不变的前提下应用材质与表面细节' + (materialList ? '（材质清单：' + materialList + '）' : '')
      + '：颜色、粗糙度、线条、污渍等。不要改结构，不要新增规划之外的部件。'
      + (requestedTexts.length ? '确认入口标牌 ' + requestedTexts.map(text => `「${text}」`).join('、') + ' 通过 userData.textSpec 声明，文字内容不能丢失。' : ''),
  })
  source = materialResult.generatedCode
  model = await executeProceduralModel(source, { timeoutMs: 60000 })
  attachFootprint(model)
  report = await reviewStage(model, '材质', '评估最终外观（材质、颜色、表面细节），并检查穿模、悬空、断开的部件。')
  if (report?.passed !== true) {
    const repaired = await repairStagedModel({ source, report, stageLabel: '材质', objectType })
    if (repaired) {
      source = repaired
      model = await executeProceduralModel(source, { timeoutMs: 60000 })
      attachFootprint(model)
      report = await reviewStage(model, '最终复检', '评估最终外观（材质、颜色、表面细节），并检查穿模、悬空、断开的部件。')
    }
  }

  return { model, source, draftSpec, report }
}

async function generateAiModelStaged({ prompt, generationPrompt, objectType, useFootprint, footprintLocal }) {
  aiBusy.value = true
  editorOpen.value = true
  editorMode.value = 'create'
  isDraftModel.value = true
  editingModel.value = null
  editHistory.value = []
  editError.value = ''
  modelChatMessages.value = []
  appendModelChat('user', prompt || '（使用参考图生成模型）', {
    referenceImage: Boolean(referenceImageDataUrl.value),
    footprint: useFootprint ? { mode: footprintRegionMode.value, points: footprintLocal.points.map(point => ({ ...point })) } : null,
  })
  generationProgress.value = [{
    stage: 'staged',
    label: '分阶段生成：体块 → 结构 → 材质',
    detail: '每个阶段生成后会做一次视觉质检，不通过则自动修正一次',
    status: 'active',
  }]
  message.value = '正在分阶段生成模型（体块 → 结构 → 材质），耗时会比单次生成长…'
  try {
    const staged = await runStagedModelGeneration({ prompt, generationPrompt, objectType, useFootprint, footprintLocal })
    const group = staged.model
    group.userData.proceduralModelParameterValues = modelParameterDefaults(group.userData.proceduralModelParameters || [])
    group.userData.proceduralModelParts = Array.isArray(group.userData.proceduralModelParts) ? group.userData.proceduralModelParts : []
    group.userData.proceduralModelEnvironmentBindings = Array.isArray(group.userData.proceduralModelEnvironmentBindings)
      ? group.userData.proceduralModelEnvironmentBindings : []
    group.userData.proceduralModelCapabilityManifest = group.userData.proceduralModelCapabilityManifest
      && typeof group.userData.proceduralModelCapabilityManifest === 'object'
      ? group.userData.proceduralModelCapabilityManifest
      : { version: 1, parameters: group.userData.proceduralModelParameters, capabilities: {} }
    group.userData.proceduralModelConfig = {
      protocol: 'threejs-procedural-v1',
      generator: 'img2threejs-procedural-staged',
      objectType,
      visualStyle: 'stylized',
      prompt,
      generatedAt: new Date().toISOString(),
      staged: true,
      footprint: useFootprint ? { mode: footprintRegionMode.value, points: footprintLocal.points.map(point => ({ ...point })) } : null,
    }
    group.userData.proceduralModelSource = staged.source
    group.name = group.userData.assetName || 'AI 程序化模型'
    if (staged.draftSpec) group.userData.proceduralModelDraftSpec = staged.draftSpec
    if (staged.report) group.userData.proceduralModelVisualQuality = staged.report
    if (useFootprint) {
      group.userData.sandboxFootprintPolygon = {
        mode: footprintRegionMode.value,
        points: footprintLocal.points.map(point => ({ ...point })),
      }
    }
    editingModel.value = group
    persistModelChatHistory(group)
    const collisionReady = await runModelCollisionQualityControl()
    if (!collisionReady) throw new Error('模型碰撞完整性检查未通过，已阻止模型进入沙盒；请继续修复未解决部件。')
    generationProgress.value = generationProgress.value.map(item => (
      item.status === 'active' || item.status === 'failed' ? { ...item, status: item.status === 'failed' ? item.status : 'done' } : item
    ))
    generationProgress.value.push({
      stage: 'preview-ready',
      label: '模型预览已就绪',
      detail: '分阶段生成与质检完成；可以继续对话调整或保存加入沙盒',
      status: 'done',
    })
    message.value = '分阶段生成完成（体块 → 结构 → 材质，每阶段已过视觉质检），可继续对话调整或保存。'
    appendModelChat('assistant', '模型预览已就绪，可以继续对话调整，或保存后加入沙盒。', { type: 'stage' })
  } catch (error) {
    const next = [...generationProgress.value]
    const activeIndex = next.findIndex(item => item.status === 'active')
    if (activeIndex >= 0) next[activeIndex] = { ...next[activeIndex], status: 'failed', detail: error?.message || '未知错误' }
    else next.push({ stage: 'failed', label: '分阶段生成失败', detail: error?.message || '未知错误', status: 'failed' })
    generationProgress.value = next
    editError.value = error?.message || '未知错误'
    message.value = 'AI 分阶段建模失败：' + editError.value
    appendModelChat('assistant', '分阶段生成失败：' + editError.value, { type: 'stage' })
  } finally {
    aiBusy.value = false
  }
}

async function generateAiModel() {
  const prompt = aiPrompt.value.trim()
  if ((!prompt && !referenceImageDataUrl.value) || aiBusy.value) return
  const footprintMode = footprintRegionMode.value
  const useFootprint = footprintMode !== 'none' && footprintPoints.value.length >= 3
  if (useFootprint && footprintSelfIntersecting.value) {
    message.value = '占地区域轮廓有交叉（红色边），请先拖动黄色顶点调整或重画'
    return
  }
  const footprintLocal = useFootprint ? localizePolygon(footprintPoints.value) : null
  const generationPrompt = useFootprint
    ? prompt + buildFootprintPromptSuffix(footprintMode, footprintLocal.points)
    : prompt
  if (stagedGenerationEnabled.value) {
    await generateAiModelStaged({
      prompt,
      generationPrompt,
      objectType: STAGED_MODEL_OBJECT_TYPE,
      useFootprint,
      footprintLocal,
    })
    return
  }

  aiBusy.value = true
  editorOpen.value = true
  editorMode.value = 'create'
  isDraftModel.value = true
  editingModel.value = null
  editHistory.value = []
  editError.value = ''
  modelChatMessages.value = []
  appendModelChat('user', prompt || '（使用参考图生成模型）', {
    referenceImage: Boolean(referenceImageDataUrl.value),
    footprint: useFootprint ? { mode: footprintMode, points: footprintLocal.points.map(point => ({ ...point })) } : null,
  })
  generationProgress.value = [{
    stage: 'request',
    label: '提交完整模型生成请求',
    detail: '描述与参考图将直接用于一次性生成完整 Three.js 模型',
    status: 'active',
  }]
  message.value = '正在生成完整 Three.js 模型…'

  try {
    const response = await fetch(API_BASE + '/assets/ai-image/generate-procedural-object-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
      body: JSON.stringify({
        prompt: generationPrompt,
        objectType: '独立 3D 模型',
        visualStyle: 'stylized',
        imageDataUrl: referenceImageDataUrl.value || undefined,
      }),
    })
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.message || '模型生成失败：HTTP ' + response.status)
    }

    let buffer = ''
    let result = null
    let completed = false
    const decoder = new TextDecoder()
    const processEvent = async event => {
      if (!event || typeof event.type !== 'string') return
      if (event.type === 'stage') {
        updateGenerationProgress({
          stage: event.stage,
          label: event.label || event.stage,
          detail: event.detail || '',
          status: event.status || 'active',
        })
        return
      }
      if (event.type === 'single') {
        result = event.result
        return
      }
      if (event.type === 'error') {
        throw new Error(event.message || '模型生成失败')
      }
      if (event.type === 'complete') {
        completed = true
      }
    }

    const reader = response.body.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) await processEvent(JSON.parse(line))
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) await processEvent(JSON.parse(buffer.trim()))
    if (!completed || !result?.generatedCode) {
      throw new Error('模型生成事件流提前结束，未收到完整模型源码')
    }

    updateGenerationProgress({
      stage: 'worker-start',
      label: '构建完整 3D 模型',
      detail: 'AI 已返回完整模型源码，正在隔离 Worker 中创建 Three.js 对象',
    })
    const group = await executeProceduralModel(result.generatedCode, {
      timeoutMs: 60000,
      onProgress: updateGenerationProgress,
    })
    group.userData.proceduralModelParameterValues = modelParameterDefaults(group.userData.proceduralModelParameters || [])
    group.userData.proceduralModelConfig = {
      protocol: 'threejs-procedural-v1',
      generator: result.generationMethod || 'img2threejs-procedural',
      objectType: result.objectType || '独立 3D 模型',
      visualStyle: result.visualStyle || 'stylized',
      prompt,
      hasReferenceImage: Boolean(referenceImageDataUrl.value),
      generatedAt: result.generatedAt || new Date().toISOString(),
      generationMetrics: result.generationMetrics || null,
      footprint: useFootprint
        ? { mode: footprintMode, points: footprintLocal.points.map(point => ({ x: point.x, z: point.z })) }
        : null,
    }
    group.userData.proceduralModelSource = result.generatedCode
    if (useFootprint) {
      group.userData.sandboxFootprintPolygon = {
        mode: footprintMode,
        points: footprintLocal.points.map(point => ({ x: point.x, z: point.z })),
      }
    }
    group.userData.interactionRadius = Number(group.userData.interactionRadius) || 4.5
    editingModel.value = group
    persistModelChatHistory(group)
    if (result.draftSpec) {
      group.userData.proceduralModelDraftSpec = result.draftSpec
      const draftDimensions = result.draftSpec.dimensions || {}
      appendModelChat('assistant', `结构规划：${result.draftSpec.parts?.length || 0} 个部件，尺寸 ${draftDimensions.width}×${draftDimensions.height}×${draftDimensions.depth} m`, { type: 'stage' })
    }
    appendModelChat('assistant', '模型源码已构建完成，开始碰撞检查与视觉质检。', { type: 'stage' })

    const model = editingModel.value
    if (!model) throw new Error('构建完成但没有可预览的模型')
    model.userData.proceduralModelParameterValues = modelParameterDefaults(model.userData.proceduralModelParameters || [])
    model.userData.proceduralModelParts = Array.isArray(model.userData.proceduralModelParts)
      ? model.userData.proceduralModelParts : []
    model.userData.proceduralModelEnvironmentBindings = Array.isArray(model.userData.proceduralModelEnvironmentBindings)
      ? model.userData.proceduralModelEnvironmentBindings : []
    model.userData.proceduralModelCapabilityManifest = model.userData.proceduralModelCapabilityManifest
      && typeof model.userData.proceduralModelCapabilityManifest === 'object'
      ? model.userData.proceduralModelCapabilityManifest
      : { version: 1, parameters: model.userData.proceduralModelParameters, capabilities: {} }
    model.name = model.userData.assetName || result.objectType || 'AI 程序化模型'
    const collisionReady = await runModelCollisionQualityControl()
    if (!collisionReady) throw new Error('模型碰撞完整性检查未通过，已阻止模型进入沙盒；请继续修复未解决部件。')
    await runModelVisualQualityControl(prompt)
    generationProgress.value = generationProgress.value.map(item => item.stage === 'visual-inspection' || item.stage === 'visual-repair'
      ? item
      : ({ ...item, status: 'done' }))
    generationProgress.value.push({
      stage: 'preview-ready',
      label: '模型预览已就绪',
      detail: '完整模型已构建；可以继续调整参数或通过 AI 对话编辑，保存后才会加入沙盒',
      status: 'done',
    })
    message.value = useFootprint
      ? '模型生成完成，已带上勾绘占地约束；保存后在场景里按这块区域落位。'
      : '模型生成完成，可继续调整参数或通过 AI 对话编辑；保存后才会加入沙盒。'
    appendModelChat('assistant', '模型预览已就绪，可以继续对话调整，或保存后加入沙盒。', { type: 'stage' })
  } catch (error) {
    const next = [...generationProgress.value]
    const activeIndex = next.findIndex(item => item.status === 'active')
    if (activeIndex >= 0) next[activeIndex] = { ...next[activeIndex], status: 'failed', detail: error?.message || '未知错误' }
    else next.push({ stage: 'failed', label: '模型生成失败', detail: error?.message || '未知错误', status: 'failed' })
    generationProgress.value = next
    editError.value = error?.message || '未知错误'
    message.value = 'AI 程序化建模失败：' + editError.value
  } finally {
    aiBusy.value = false
  }
}


const HUMANOID_PROMPT_SUFFIX = '。必须生成一个标准人形角色（humanoid）：头部、脖子、躯干、左右上臂与前臂、双手、左右大腿与小腿、双脚齐全；比例约 7 头身，肩宽约身高 1/4，双脚落在 y=0 基准面，正面朝向 +Z。各身体部位请使用独立命名的子网格或子分组：head、torso、left-arm、right-arm、left-leg、right-leg、left-foot、right-foot（命名用于绑定行走/跳跃动作）。使用 Three.js 几何体与材质，颜色分明，避免全黑或全反射材质；不要生成地面、底座、场景、文字或相机。'

// 请求一次角色生成源码；流式事件与原有实现保持一致。
async function requestGeneratedCharacterCode(promptText) {
  const response = await fetch(API_BASE + '/assets/ai-image/generate-procedural-object-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
    body: JSON.stringify({
      prompt: promptText,
      objectType: '第三人称玩家角色',
      visualStyle: 'stylized',
    }),
  })
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || 'AI 角色生成失败：HTTP ' + response.status)
  }
  let buffer = ''
  let result = null
  let completed = false
  const decoder = new TextDecoder()
  const processEvent = event => {
    if (!event || typeof event.type !== 'string') return
    if (event.type === 'single') result = event.result
    else if (event.type === 'error') throw new Error(event.message || 'AI 角色生成失败')
    else if (event.type === 'complete') completed = true
  }
  const reader = response.body.getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) processEvent(JSON.parse(line))
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) processEvent(JSON.parse(buffer.trim()))
  if (!completed || !result?.generatedCode) throw new Error('AI 角色生成事件流提前结束，未收到完整模型源码')
  return result.generatedCode
}

async function generateAiPlayerCharacter() {
  const prompt = characterPrompt.value.trim()
  if (!prompt || characterBusy.value) return
  if (!engine?.setPlayerCharacterModel) {
    message.value = '当前场景不支持角色替换'
    return
  }
  characterBusy.value = true
  message.value = '正在通过 AI 生成角色模型…'
  // 立刻打开角色编辑工作台：生成进度直接显示在对话/进度卡里
  editorOpen.value = true
  editorMode.value = 'character'
  isDraftModel.value = false
  editingModel.value = null
  editHistory.value = []
  editError.value = ''
  modelChatMessages.value = []
  generationProgress.value = [{
    stage: 'character',
    label: '正在生成角色模型',
    detail: 'AI 正在生成完整的人形角色源码',
    status: 'active',
  }]
  appendModelChat('user', prompt, { type: 'stage' })
  try {
    let model = null
    let analysis = null
    let characterSource = ''
    // 最多两次：首轮失败后把具体失败指标作为纠正提示再生成一次。
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        message.value = '生成结果不像人形（' + analysis.reasons.join('；') + '），正在自动重试…'
        updateGenerationProgress({
          stage: 'character-retry',
          label: `人形检查未通过，自动重试（${attempt + 1}/2）`,
          detail: analysis.reasons.join('；').slice(0, 300),
          status: 'active',
        })
      }
      const promptText = attempt === 0
        ? prompt + HUMANOID_PROMPT_SUFFIX
        : prompt + HUMANOID_PROMPT_SUFFIX + buildHumanoidRetryPrompt(analysis)
      message.value = '正在请求 AI 生成角色源码…'
      updateGenerationProgress({ stage: 'character-request', label: '请求角色生成', detail: '提交角色描述与人形约束', status: 'active' })
      const generatedCode = await requestGeneratedCharacterCode(promptText)
      message.value = 'AI 已返回模型源码，正在隔离 Worker 中构建…'
      updateGenerationProgress({ stage: 'character-build', label: '构建角色模型', detail: '隔离 Worker 中执行生成源码', status: 'active' })
      model = await executeProceduralModel(generatedCode, { timeoutMs: 60000 })
      characterSource = generatedCode
      updateGenerationProgress({ stage: 'character-humanoid', label: '人形检查', detail: '检查头/躯干/四肢比例与完整性', status: 'active' })
      analysis = analyzeHumanoidModel(THREE, model)
      if (analysis.humanoid) break
    }
    if (!analysis?.humanoid) {
      const reason = '两次生成的结果都不像人形（' + (analysis?.reasons?.join('；') || '未知原因') + '），已取消应用。请换一种描述再试，例如“一个站立的人形角色，身高约 2 米，穿蓝色上衣”。'
      message.value = reason
      editError.value = reason
      generationProgress.value = generationProgress.value.map(item => item.status === 'active'
        ? { ...item, status: 'failed' } : item)
      appendModelChat('assistant', reason, { type: 'stage' })
      return
    }
    generationProgress.value = generationProgress.value.map(item => item.status === 'active' ? { ...item, status: 'done' } : item)
    appendModelChat('assistant', '人形检查通过。可在左侧预览、右侧对话继续调整；保存后应用到玩家。', { type: 'stage' })
    // 角色也进入和模型一样的编辑工作台：先建好可编辑草稿，再做视觉质检（含自动修正）
    model.name = 'AI 玩家角色'
    model.userData.proceduralModelSource = characterSource
    model.userData.proceduralModelConfig = {
      protocol: 'threejs-procedural-v1',
      generator: 'img2threejs-procedural-character',
      objectType: '第三人称玩家角色',
      visualStyle: 'stylized',
      prompt,
      generatedAt: new Date().toISOString(),
    }
    model.userData.proceduralModelParameterValues = modelParameterDefaults(model.userData.proceduralModelParameters || [])
    model.userData.proceduralModelParts = Array.isArray(model.userData.proceduralModelParts) ? model.userData.proceduralModelParts : []
    model.userData.proceduralModelEnvironmentBindings = Array.isArray(model.userData.proceduralModelEnvironmentBindings)
      ? model.userData.proceduralModelEnvironmentBindings : []
    model.userData.proceduralModelCapabilityManifest = model.userData.proceduralModelCapabilityManifest
      && typeof model.userData.proceduralModelCapabilityManifest === 'object'
      ? model.userData.proceduralModelCapabilityManifest
      : { version: 1, parameters: model.userData.proceduralModelParameters, capabilities: {} }
    editingModel.value = model
    isDraftModel.value = true
    await nextTick()
    message.value = 'AI 角色已生成，正在做视觉质检…'
    const characterReport = await runModelVisualQualityControl(prompt, { includeReferenceImage: false })
    const finalAnalysis = analyzeHumanoidModel(THREE, editingModel.value || model)
    if (!finalAnalysis.humanoid) {
      appendModelChat('assistant', '视觉修正后的人形检查未通过：' + (finalAnalysis.reasons?.join('；') || '未知原因'), { type: 'stage' })
      message.value = '角色已生成，但视觉修正后不像人形；请继续对话调整，或关闭放弃。'
    } else {
      message.value = characterReport?.passed === true
        ? 'AI 角色已生成并通过人形与视觉检查；可在编辑页继续调整，保存后应用到玩家。'
        : 'AI 角色已生成并通过人形检查；视觉质检仍有提示，可在编辑页继续调整，保存后应用到玩家。'
    }
  } catch (error) {
    message.value = 'AI 角色生成失败：' + (error?.message || '未知错误')
    editError.value = message.value
    generationProgress.value = generationProgress.value.map(item => item.status === 'active'
      ? { ...item, status: 'failed' } : item)
    appendModelChat('assistant', message.value, { type: 'stage' })
  } finally {
    characterBusy.value = false
  }
}

async function importPlayerCharacter(event) {
  const file = event?.target?.files?.[0]
  if (!file || characterBusy.value) return
  if (!/\.glb$/i.test(file.name)) {
    message.value = '当前仅支持单文件 GLB 导入；含外部依赖的 glTF 暂不支持'
    event.target.value = ''
    return
  }
  characterBusy.value = true
  const objectUrl = URL.createObjectURL(file)
  try {
    const info = await engine.loadPlayerCharacter(objectUrl, { assetId: 'glb:' + file.name, source: 'glb' })
    savePlayerCharacterToStorage({ silent: true })
    message.value = `GLB 角色已加载：高度 ${info.dimensions?.height?.toFixed(2) || '—'}，碰撞半径 ${info.dimensions?.colliderRadius?.toFixed(2) || '—'}。已单独保存人物模型，刷新后自动恢复。`
  } catch (error) {
    message.value = 'GLB 角色导入失败：' + (error?.message || '未知错误')
  } finally {
    URL.revokeObjectURL(objectUrl)
    characterBusy.value = false
    event.target.value = ''
  }
}


function handleCapabilityChange(payload) {
  const model = editingModel.value
  if (!model || !payload?.capabilityId || !payload?.targetPartId) return
  const document = model.userData.proceduralModelCapabilityControlDocument
    || createCapabilityControlDocument({ manifest: model.userData.proceduralModelCapabilityManifest })
  const scope = { targetType: 'part', targetId: String(payload.targetPartId) }
  const overrides = [...(document.overrides || [])]
  const index = overrides.findIndex(record =>
    record?.capabilityId === payload.capabilityId &&
    record.scope?.targetType === scope.targetType &&
    String(record.scope?.targetId || '') === scope.targetId)
  const nextOverride = {
    capabilityId: payload.capabilityId,
    scope,
    action: 'set',
    value: { blocksMovement: Boolean(payload.blocksMovement) },
    updatedAt: new Date().toISOString(),
  }
  if (index >= 0) overrides[index] = nextOverride
  else overrides.push(nextOverride)
  model.userData.proceduralModelCapabilityControlDocument = {
    ...document,
    overrides,
  }
  const updated = isDraftModel.value ? true : engine?.refreshSandboxModelSpatial?.(model)
  message.value = payload.blocksMovement
    ? '已启用该部件的玩家移动阻挡'
    : '已关闭该部件的玩家移动阻挡'
  if (updated === undefined) message.value += '（碰撞 Runtime 刷新接口不可用）'
  saveStatus.value = '能力已调整，记得保存沙盒'
}

function loadModelChatHistory(model) {
  const history = Array.isArray(model?.userData?.proceduralModelChatHistory)
    ? model.userData.proceduralModelChatHistory : []
  modelChatMessages.value = history.map(item => ({ ...item }))
}

function persistModelChatHistory(model = editingModel.value) {
  if (!model) return
  model.userData.proceduralModelChatHistory = modelChatMessages.value.map(item => ({ ...item }))
}

function appendModelChat(role, text, meta = {}) {
  const entry = {
    id: 'msg_' + Date.now().toString(36) + '_' + modelChatMessages.value.length,
    role,
    text,
    at: new Date().toISOString(),
    ...meta,
  }
  modelChatMessages.value = [...modelChatMessages.value, entry]
  if (modelChatMessages.value.length > 200) {
    modelChatMessages.value = modelChatMessages.value.slice(-200)
  }
  persistModelChatHistory()
}

function openModelEditor(payload) {
  const model = payload?.id ? engine?.getSandboxModel(payload.id) : selected
  if (!model?.userData?.proceduralModelSource) {
    message.value = '该模型没有可编辑的 AI 程序化源码'
    return
  }
  editingModel.value = model
  loadModelChatHistory(model)
  if (!modelChatMessages.value.length) {
    appendModelChat('assistant', '已打开模型编辑，可以继续对话调整，或修改左侧参数与组件结构。', { type: 'stage' })
  }
  editorOpen.value = true
  editorMode.value = 'edit'
  isDraftModel.value = false
  editHistory.value = []
  editError.value = ''
}

function closeModelEditor() {
  const wasCharacter = editorMode.value === 'character'
  editorOpen.value = false
  editingModel.value = null
  if (wasCharacter) {
    isDraftModel.value = false
    message.value = '已关闭角色编辑，未应用到玩家'
    return
  }
  if (isDraftModel.value) {
    isDraftModel.value = false
    message.value = '已取消创建，模型未加入沙盒'
  }
}

function saveEditorModel() {
  const model = editingModel.value
  if (!model) return
  // 角色草稿：保存即应用到玩家角色并单独存档
  if (editorMode.value === 'character') {
    const analysis = analyzeHumanoidModel(THREE, model)
    if (!analysis.humanoid) {
      message.value = '角色当前不像人形（' + (analysis.reasons?.join('；') || '未知原因') + '），已阻止应用。请继续对话调整。'
      return
    }
    const info = engine.setPlayerCharacterModel(model, [], {
      assetId: 'ai-character-' + Date.now().toString(36),
      targetHeight: 2.25,
      source: 'ai-procedural',
      prompt: model.userData.proceduralModelConfig?.prompt || characterPrompt.value,
    })
    savePlayerCharacterToStorage({ silent: true })
    editorOpen.value = false
    editingModel.value = null
    isDraftModel.value = false
    message.value = `AI 角色已应用到玩家：高度 ${info.dimensions?.height?.toFixed(2) || '—'}，碰撞半径 ${info.dimensions?.colliderRadius?.toFixed(2) || '—'}。已单独保存人物模型，刷新后自动恢复。`
    return
  }
  if (isDraftModel.value) {
    const collisionReport = analyzeModelCollisionCompleteness(model)
    model.userData.proceduralModelCollisionAnalysis = collisionReport
    if (collisionReport.status !== 'complete') {
      message.value = '碰撞完整性检查未通过，模型不能加入沙盒。请先补齐 required 部件的 Collider，并明确所有部件的 collisionPolicy。'
      return
    }
  }
  const wasDraft = isDraftModel.value
  if (wasDraft) {
    const name = model.userData?.assetName || model.name || 'AI 程序化模型'
    model.name = name + ' ' + (objects.value.length + 1)
    const started = engine?.beginSandboxModelPlacement?.(model)
    if (!started) {
      message.value = '无法启动模型选址，请确认当前处于室外沙盒且模型未被挂载。'
      return
    }
    isDraftModel.value = false
    aiPrompt.value = ''
    referenceImageDataUrl.value = ''
    referenceImageName.value = ''
    editorOpen.value = false
    editingModel.value = null
    message.value = '模型已生成，尚未加入存档。请从沙盒全貌逐级选择区域并确认落位。'
    return
  }
  const persisted = saveSandbox()
  if (!persisted) {
    message.value = wasDraft
      ? '模型已加入当前沙盒，但存档失败；请检查存储空间后重试保存'
      : '模型修改已应用到当前沙盒，但存档失败；请检查存储空间后重试保存'
    return
  }
  editorOpen.value = false
  editingModel.value = null
  message.value = wasDraft ? '模型已加入沙盒并保存存档' : '模型修改已保存到沙盒存档'
}
function modelParameterDefaults(definitions, existing = {}) {
  const values = { ...(existing || {}) }
  for (const item of definitions || []) {
    if (item?.id && values[item.id] === undefined && item.default !== undefined) values[item.id] = item.default
  }
  return values
}
async function replaceEditedModel(source, values, definitions, parts, summary = '模型已更新', recordHistory = true, environmentBindings = null, modelCapabilityManifest = null, capabilityControlDocument = null) {
  const current = editingModel.value
  if (!current) throw new Error('当前没有正在编辑的模型')
  const id = current.userData.sandboxModelId
  const previousCapabilityControlDocument = capabilityControlDocument
    || current.userData.proceduralModelCapabilityControlDocument || null
  let replacement = await executeProceduralModel(source, {
    timeoutMs: 60000,
    parameters: values,
    capabilityControlDocument: previousCapabilityControlDocument,
  })
  const moduleDefinitions = Array.isArray(replacement.userData?.proceduralModelParameters) ? replacement.userData.proceduralModelParameters : []
  const moduleParts = Array.isArray(replacement.userData?.proceduralModelParts) ? replacement.userData.proceduralModelParts : []
  const moduleEnvironmentBindings = Array.isArray(replacement.userData?.proceduralModelEnvironmentBindings)
    ? replacement.userData.proceduralModelEnvironmentBindings : []
  const moduleCapabilityManifest = replacement.userData?.proceduralModelCapabilityManifest
    && typeof replacement.userData.proceduralModelCapabilityManifest === 'object'
    ? replacement.userData.proceduralModelCapabilityManifest : null
  // Prefer the manifest exported by the exact source that Worker just executed.
  // The API envelope may contain a compatibility fallback to the previous manifest.
  const hasModuleManifest = replacement.userData.proceduralModelCapabilityManifestSource === 'module'
  const resolvedCapabilityManifest = hasModuleManifest
    ? moduleCapabilityManifest
    : (modelCapabilityManifest && typeof modelCapabilityManifest === 'object'
      ? modelCapabilityManifest
      : (current.userData.proceduralModelCapabilityManifest || moduleCapabilityManifest || null))
  const manifestCapabilities = resolvedCapabilityManifest?.capabilities && typeof resolvedCapabilityManifest.capabilities === 'object'
    ? resolvedCapabilityManifest.capabilities : {}
  const resolvedDefinitions = Array.isArray(resolvedCapabilityManifest?.parameters)
    ? resolvedCapabilityManifest.parameters
    : (Array.isArray(definitions) && definitions.length ? definitions : moduleDefinitions)
  const resolvedParts = resolveProceduralModelParts({
    moduleParts,
    modulePartsSource: replacement.userData.proceduralModelPartsSource,
    responseParts: parts,
    currentParts: current.userData.proceduralModelParts,
  })
  const resolvedEnvironmentBindings = Array.isArray(manifestCapabilities.environmentBindings)
    ? manifestCapabilities.environmentBindings
    : (Array.isArray(environmentBindings)
      ? environmentBindings
      : (moduleEnvironmentBindings.length ? moduleEnvironmentBindings : (current.userData.proceduralModelEnvironmentBindings || [])))
  const finalCapabilityManifest = resolvedCapabilityManifest || {
    version: 1,
    parameters: resolvedDefinitions,
    capabilities: resolvedEnvironmentBindings.length ? { environmentBindings: resolvedEnvironmentBindings } : {},
  }
  const resolvedValues = modelParameterDefaults(resolvedDefinitions, values)
  if (JSON.stringify(resolvedValues) !== JSON.stringify(values || {})) {
    replacement = await executeProceduralModel(source, {
      timeoutMs: 60000,
      parameters: resolvedValues,
      capabilityControlDocument: previousCapabilityControlDocument,
    })
  }
  replacement.userData = {
    ...(replacement.userData || {}),
    proceduralModelSource: source,
    proceduralModelParameters: resolvedDefinitions,
    proceduralModelParts: resolvedParts,
    proceduralModelEnvironmentBindings: resolvedEnvironmentBindings,
    proceduralModelCapabilityManifest: finalCapabilityManifest,
    proceduralModelCapabilityControlDocument: replacement.userData.proceduralModelCapabilityControlDocument
      || createCapabilityControlDocument({ manifest: finalCapabilityManifest, previousDocument: previousCapabilityControlDocument }),
    proceduralModelParameterValues: resolvedValues,
    worldState: { ...(current.userData.worldState || {}) },
    environmentOverrides: { ...(current.userData.environmentOverrides || {}) },
    proceduralModelConfig: { ...(current.userData.proceduralModelConfig || {}), updatedAt: new Date().toISOString() },
    interactionRadius: Number(current.userData.interactionRadius) || 4.5,
    proceduralModelChatHistory: modelChatMessages.value.map(item => ({ ...item })),
    sandboxFootprintPolygon: current.userData.sandboxFootprintPolygon || replacement.userData.sandboxFootprintPolygon || null,
    proceduralModelDraftSpec: current.userData.proceduralModelDraftSpec || replacement.userData.proceduralModelDraftSpec || null,
  }
  replacement.name = current.name
  if (isDraftModel.value) {
    replacement.position.copy(current.position)
    replacement.quaternion.copy(current.quaternion)
    replacement.scale.copy(current.scale)
    replacement.updateMatrixWorld(true)
  } else if (!engine.replaceSandboxModel(id, replacement, { name: current.name })) {
    throw new Error('模型替换失败，原模型已保留')
  }
  if (recordHistory) {
    editHistory.value.push({
      source: current.userData.proceduralModelSource,
      values: { ...(current.userData.proceduralModelParameterValues || {}) },
      definitions: current.userData.proceduralModelParameters || [],
      parts: current.userData.proceduralModelParts || [],
      environmentBindings: current.userData.proceduralModelEnvironmentBindings || [],
      modelCapabilityManifest: current.userData.proceduralModelCapabilityManifest || null,
      capabilityControlDocument: current.userData.proceduralModelCapabilityControlDocument || null,
    })
    if (editHistory.value.length > 10) editHistory.value.shift()
  }
  if (id) {
    objectsById.set(id, replacement)
    selected = replacement
  }
  editingModel.value = replacement
  syncObjects()
  message.value = summary
}
async function handleModelEdit(payload) {
  const current = editingModel.value
  if (!current || editBusy.value) return
  const source = current.userData.proceduralModelSource
  const values = { ...(current.userData.proceduralModelParameterValues || {}), ...(payload?.parameterValues || {}) }
  editBusy.value = true
  editError.value = ''
  appendModelChat('user', payload?.instruction || '（参数调整）', {
    selectedPartId: payload?.selectedPartId || '',
    selectedPartName: payload?.selectedPartName || '',
    referenceImage: Boolean(payload?.referenceImageDataUrl),
  })
  // 修改前的截图作为复检基线：判断“问题是否修好、有没有引入新问题”
  let baselineScreenshots = null
  try {
    baselineScreenshots = await proceduralModelEditorRef.value?.captureVisualViews?.()
  } catch {
    baselineScreenshots = null
  }
  try {
    const response = await fetch(API_BASE + '/assets/ai-image/modify-procedural-object', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
      body: JSON.stringify({
        source,
        parameters: current.userData.proceduralModelParameters || [],
        parameterValues: values,
        parts: current.userData.proceduralModelParts || [],
        environmentBindings: current.userData.proceduralModelEnvironmentBindings || [],
        modelCapabilityManifest: current.userData.proceduralModelCapabilityManifest || null,
        geometryDiagnostics: current.userData.proceduralModelGeometryDiagnostics || null,
        selectedPartId: payload?.selectedPartId || '',
        instruction: payload?.instruction || '',
        objectType: current.userData.proceduralModelConfig?.objectType || '独立 3D 模型',
        referenceImageDataUrl: payload?.referenceImageDataUrl || undefined,
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.message || 'AI 模型编辑失败：HTTP ' + response.status)
    const result = body.data || body.result || body
    const definitions = Array.isArray(result.parameters) ? result.parameters : (Array.isArray(result.modelParameters) ? result.modelParameters : [])
    const parts = Array.isArray(result.parts) ? result.parts : (Array.isArray(result.modelParts) ? result.modelParts : [])
    await replaceEditedModel(result.generatedCode, values, definitions, parts, result.changeSummary || 'AI 已完成模型调整', true, result.environmentBindings, result.modelCapabilityManifest)
    appendModelChat('assistant', result.changeSummary || 'AI 已完成模型调整', { type: 'edit-result' })
    // 所有 AI 修改后的模型都做一次视觉质检；复检以修改前的截图为基线
    await runModelVisualQualityControl(
      current.userData.proceduralModelConfig?.prompt || payload?.instruction || '',
      { baselineScreenshots, referenceImageDataUrl: payload?.referenceImageDataUrl || '' },
    )
  } catch (error) {
    editError.value = error?.message || '模型调整失败'
    appendModelChat('assistant', '调整失败：' + editError.value, { type: 'stage' })
  } finally {
    editBusy.value = false
  }
}

async function undoModelEdit() {
  const snapshot = editHistory.value.pop()
  if (!snapshot || !editingModel.value || editBusy.value) return
  editBusy.value = true
  editError.value = ''
  try {
    await replaceEditedModel(snapshot.source, snapshot.values, snapshot.definitions, snapshot.parts, '已恢复上一版本', false, snapshot.environmentBindings, snapshot.modelCapabilityManifest, snapshot.capabilityControlDocument)
  } catch (error) {
    editHistory.value.push(snapshot)
    editError.value = error?.message || '恢复失败'
  } finally {
    editBusy.value = false
  }
}

async function handleParameterChange(payload) {
  const current = editingModel.value
  if (!current || editBusy.value || !payload?.id) return
  const values = { ...(current.userData.proceduralModelParameterValues || {}), [payload.id]: payload.value }
  editBusy.value = true
  editError.value = ''
  try {
    await replaceEditedModel(
      current.userData.proceduralModelSource,
      values,
      current.userData.proceduralModelParameters || [],
      current.userData.proceduralModelParts || [],
      '参数已更新',
    )
  } catch (error) {
    editError.value = error?.message || '参数更新失败'
  } finally {
    editBusy.value = false
  }
}

function expandWorld(direction) {
  if (!engine) return false
  const expanded = engine.expandSandboxWorld(direction, 1)
  if (!expanded) {
    message.value = '世界扩建失败，请检查当前沙盒状态'
    return false
  }
  worldState.value = engine.getSandboxWorldState()
  const bounds = worldState.value?.bounds
  message.value = bounds
    ? `世界已扩建：${(bounds.maxX - bounds.minX).toFixed(0)} × ${(bounds.maxZ - bounds.minZ).toFixed(0)}，原有模型坐标保持不变。`
    : '世界已扩建，原有模型坐标保持不变。'
  saveStatus.value = '有未保存的世界变更'
  return true
}

async function loadMyAssets() {
  assetLibraryBusy.value = true
  try {
    myAssets.value = await assetClient.listAssets()
  } catch (error) {
    // 服务端离线不阻断沙盒主流程：面板显示空库存 + 不可用提示
    myAssets.value = []
    message.value = '资产库暂不可用：' + (error?.message || '未知错误')
  } finally {
    assetLibraryBusy.value = false
  }
}

function ensurePlacementAvailable(actionLabel) {
  if (placement.value.active) {
    message.value = '当前已有模型正在选址，请先确认落地或取消后再' + actionLabel
    return false
  }
  return true
}

function placeBuiltinAsset(item) {
  if (!ensurePlacementAvailable('取出素材')) return
  try {
    const model = createBuiltinSandboxModel(THREE, getBuiltinAssetRegistry(), item)
    const report = analyzeModelCollisionCompleteness(model)
    if (report.status !== 'complete') {
      message.value = '内置素材碰撞声明不完整，已阻止放置，请补全适配规则后再试。'
      return
    }
    const started = engine?.beginSandboxModelPlacement?.(model)
    if (!started) {
      message.value = '无法启动模型选址，请确认当前处于室外沙盒且模型未被挂载。'
      return
    }
    message.value = `已取出内置素材「${item.label}」，点击地面锁定候选位置后确认落地。`
  } catch (error) {
    message.value = '内置素材取出失败：' + (error?.message || '未知错误')
  }
}

async function placeLibraryAsset(item) {
  if (!ensurePlacementAvailable('取出模型') || assetLibraryBusy.value) return
  assetLibraryBusy.value = true
  try {
    const record = await assetClient.getAsset(item.assetId)
    const model = await executeProceduralModel(record.sourceCode, { timeoutMs: 60000 })
    // 库存重建实例补回身份字段，保证再编辑/再入库链路与现场生成的 AI 模型一致
    model.userData.proceduralModelSource = record.sourceCode
    model.userData.assetName = record.name
    model.userData.proceduralModelConfig = {
      ...(model.userData.proceduralModelConfig || {}),
      objectType: record.objectType,
    }
    const report = analyzeModelCollisionCompleteness(model)
    if (report.status !== 'complete') {
      message.value = '存档模型的碰撞声明不完整，已阻止放置，请在模型编辑器中补全后再试。'
      return
    }
    const started = engine?.beginSandboxModelPlacement?.(model)
    if (!started) {
      message.value = '无法启动模型选址，请确认当前处于室外沙盒且模型未被挂载。'
      return
    }
    message.value = `已取出存档模型「${record.name}」，点击地面锁定候选位置后确认落地。`
  } catch (error) {
    message.value = '存档模型取出失败：' + (error?.message || '未知错误')
  } finally {
    assetLibraryBusy.value = false
  }
}

async function archiveSelectedModel() {
  if (!selected || assetLibraryBusy.value) return
  if (!canArchiveSandboxModel(selected)) {
    message.value = '内置素材或旧版本地模型没有可入库的源码，无法存入资产库。'
    return
  }
  assetLibraryBusy.value = true
  try {
    const payload = buildProceduralAssetPayload(selected, selected.name || '未命名模型')
    await assetClient.saveAsset(payload)
    message.value = '已存入资产库'
    await loadMyAssets()
  } catch (error) {
    message.value = '资产入库失败：' + (error?.message || '未知错误')
  } finally {
    assetLibraryBusy.value = false
  }
}

function startRenameAsset(item) {
  renamingAssetId.value = item.assetId
  renamingAssetName.value = item.name || ''
  confirmDeleteAssetId.value = null
}

function cancelRenameAsset() {
  renamingAssetId.value = null
  renamingAssetName.value = ''
}

async function confirmRenameAsset(item) {
  const name = renamingAssetName.value.trim()
  if (!name) {
    message.value = '模型名称不能为空'
    return
  }
  assetLibraryBusy.value = true
  try {
    await assetClient.renameAsset(item.assetId, name)
    renamingAssetId.value = null
    renamingAssetName.value = ''
    await loadMyAssets()
  } catch (error) {
    message.value = '资产重命名失败：' + (error?.message || '未知错误')
  } finally {
    assetLibraryBusy.value = false
  }
}

function requestDeleteAsset(item) {
  confirmDeleteAssetId.value = item.assetId
  renamingAssetId.value = null
}

function cancelDeleteAsset() {
  confirmDeleteAssetId.value = null
}

async function confirmDeleteAsset(item) {
  assetLibraryBusy.value = true
  try {
    await assetClient.removeAsset(item.assetId)
    confirmDeleteAssetId.value = null
    message.value = '库存记录已删除，场景内已放置的模型不受影响'
    await loadMyAssets()
  } catch (error) {
    message.value = '资产删除失败：' + (error?.message || '未知错误')
  } finally {
    assetLibraryBusy.value = false
  }
}

function setManagementMode(mode) {
  const nextMode = mode === 'chunks'
    ? 'chunks'
    : mode === 'model'
      ? 'model'
      : mode === 'environment'
        ? 'environment'
        : 'sandbox'
  if (managementMode.value === 'chunks' && nextMode !== 'chunks') {
    engine?.setSandboxChunkManagement?.(false)
    selectedChunkKeys.value = []
    selectedChunkKey.value = ''
    reclaimFeedback.value = null
  }
  managementMode.value = nextMode
  if (nextMode === 'chunks') engine?.setSandboxChunkManagement?.(true)
}

function toggleChunkManagement() {
  setManagementMode(managementMode.value === 'chunks' ? 'sandbox' : 'chunks')
}

function handleSandboxChunkSelectionChange(payload) {
  const chunks = Array.isArray(payload?.chunks) ? payload.chunks : []
  selectedChunkKeys.value = chunks.map(item => item.x + ':' + item.z)
  if (payload?.primary) selectedChunkKey.value = payload.primary.x + ':' + payload.primary.z
  else selectedChunkKey.value = selectedChunkKeys.value[selectedChunkKeys.value.length - 1] || ''
  reclaimFeedback.value = null
}

function removeSelectedWorldChunks() {
  if (!engine || placement.value.active || !selectedChunks.value.length) return false
  reclaimFeedback.value = null
  const targets = [...selectedChunks.value]
  const failures = []
  let removed = 0
  for (const chunk of targets) {
    const result = engine.removeSandboxWorldChunk(chunk.x, chunk.z)
    if (result?.ok) {
      removed += 1
      worldState.value = result.world || engine.getSandboxWorldState()
    } else {
      const reasonMessages = {
        'origin-anchor': '世界锚点受保护',
        'chunk-not-found': '地块已不存在',
        'occupied': '仍有玩家、模型或碰撞对象占用',
        'cannot-remove-chunk': '至少需要保留一个地块',
        'invalid-chunk': '地块坐标无效',
      }
      failures.push({ chunk, reason: reasonMessages[result?.reason] || '系统拒绝回收', blockers: [...new Set(result?.blockers || [])] })
    }
  }
  const remainingKeys = new Set((worldState.value?.chunks || []).map(chunk => chunk.x + ':' + chunk.z))
  selectedChunkKeys.value = selectedChunkKeys.value.filter(key => remainingKeys.has(key))
  selectedChunkKey.value = selectedChunkKeys.value[selectedChunkKeys.value.length - 1] || ''
  engine.setSandboxChunkSelection(selectedChunks.value)
  if (removed) saveStatus.value = '有未保存的世界变更'
  if (failures.length) {
    reclaimFeedback.value = {
      type: removed ? 'warning' : 'error',
      title: removed ? '部分地块已回收' : '地块回收失败',
      message: `已回收 ${removed} 块，${failures.length} 块未回收。被占用或受保护的地块已保留。`,
      blockers: failures.flatMap(item => [
        `地块（${item.chunk.x}, ${item.chunk.z}）：${item.reason}`,
        ...item.blockers.map(blocker => `  · ${blocker}`),
      ]),
    }
  } else {
    reclaimFeedback.value = {
      type: 'success',
      title: '批量回收完成',
      message: `已成功回收 ${removed} 块地块，其他地块的位置没有变化。`,
      blockers: [],
    }
  }
  message.value = reclaimFeedback.value.message
  return failures.length === 0
}

function buildSandboxSnapshot() {
  if (!engine) return null
  const models = engine.getSandboxModels().flatMap(({ id, name }) => {
    const model = engine.getSandboxModel(id)
    const object = engine.serializeSandboxModel?.(id) ?? model?.toJSON?.()
    return model && object ? [{ id, name: model.name || name, object }] : []
  })
  return {
    version: 4,
    world: engine.getSandboxWorldState(),
    savedAt: new Date().toISOString(),
    environment: {
      time: Number(time.value),
      timeEnabled: timeEnabled.value,
      weather: weather.value,
      weatherIntensity: Number(weatherIntensity.value),
      weatherEnabled: weatherEnabled.value,
      // rainEnabled 是旧存档的遗留字段，仅为向下兼容保留写入
      rainEnabled: weather.value === 'rain',
      wind: Number(wind.value),
      windEnabled: windEnabled.value,
      windDirection: { ...sandboxWindDirection },
      artificialLightingEnabled: artificialLightingEnabled.value,
    },
    selectedModelId: selected?.userData?.sandboxModelId || null,
    models,
  }
}

function saveSandbox() {
  if (!engine) return false
  try {
    const snapshot = buildSandboxSnapshot()
    if (!snapshot) return false
    const serialized = JSON.stringify(snapshot)
    localStorage.setItem(STORAGE_KEY, serialized)
    saveStatus.value = '已保存 · ' + new Date(snapshot.savedAt).toLocaleTimeString()
    message.value = '沙盒已保存，刷新页面后会自动恢复'
    return true
  } catch (error) {
    const reason = error?.name === 'QuotaExceededError' ? '浏览器本地存储空间不足' : (error?.message || '未知错误')
    saveStatus.value = '保存失败'
    message.value = '沙盒保存失败：' + reason
    return false
  }
}

// 发布申请：成员只能提交冻结快照，管理员审核通过后才会写入首页。
const publishNote = ref('')
const publishSubmitting = ref(false)
const publishStatus = ref('')
const myPublishRequests = ref([])
const latestPublishRequest = computed(() => myPublishRequests.value[0] || null)

async function loadMyPublishRequests() {
  try {
    myPublishRequests.value = await listMyPublishRequests()
  } catch {
    // 未登录或后端不可用时保持空列表，不阻塞编辑器
  }
}

function publishStatusLabel(status) {
  return { pending: '待审核', approved: '已发布', rejected: '已驳回', stale: '已过期' }[status] || status
}

async function submitSandboxPublishRequest() {
  const snapshot = buildSandboxSnapshot()
  if (!snapshot) {
    publishStatus.value = '提交失败：沙盒尚未就绪'
    return
  }
  publishSubmitting.value = true
  publishStatus.value = ''
  try {
    const thumbnailDataUrl = engine?.captureSandboxThumbnail?.(720) || null
    await submitPublishRequest({
      snapshot,
      note: publishNote.value.trim(),
      thumbnailDataUrl,
    })
    publishNote.value = ''
    publishStatus.value = '已提交发布申请，等待管理员审核。'
    message.value = publishStatus.value
    await loadMyPublishRequests()
  } catch (error) {
    publishStatus.value = '提交发布申请失败：' + (error?.message || '未知错误')
  } finally {
    publishSubmitting.value = false
  }
}

const persistRoadEdit = createRoadEditPersistence({ save: saveSandbox, sync: syncObjects })

// ---- 人物模型独立存档 ----
const PLAYER_CHARACTER_SAVE_LIMIT = 2_000_000
// 两个内置人物：默认角色（男）/（女），选择即切换。
const playerPresetOptions = computed(() => Object.entries(PLAYER_PRESETS).map(([presetId, preset]) => ({
  value: `preset:${presetId}`,
  label: preset.label,
})))
const characterSelection = ref('preset:male')
const hasSavedCharacter = ref(false)

function refreshSavedCharacterFlag() {
  try {
    hasSavedCharacter.value = Boolean(localStorage.getItem(PLAYER_STORAGE_KEY))
  } catch {
    hasSavedCharacter.value = false
  }
}

function applyCharacterSelection() {
  const selection = characterSelection.value
  if (selection === 'saved') {
    if (restorePlayerCharacterFromStorage()) characterSelection.value = 'saved'
    return
  }
  // 形如 preset:<presetId>，性别由预设自身携带
  const parts = selection.split(':')
  if (parts[0] === 'preset' && parts[1]) {
    const presetId = parts[1]
    const info = engine?.setPlayerCharacterPreset?.(presetId)
    const preset = PLAYER_PRESETS[presetId]
    if (info && preset) message.value = '已切换人物：' + preset.label
  }
}

function savePlayerCharacterToStorage({ silent = false } = {}) {
  try {
    const character = engine?.serializePlayerCharacter?.() || null
    if (!character) {
      if (!silent) message.value = '当前是默认角色，没有可保存的人物模型'
      return false
    }
    const payload = { ...character, savedAt: new Date().toISOString() }
    if (JSON.stringify(payload).length > PLAYER_CHARACTER_SAVE_LIMIT) {
      message.value = '人物模型过大（超过 2MB），无法保存到浏览器存储'
      return false
    }
    localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(payload))
    hasSavedCharacter.value = true
    if (!silent) message.value = '人物模型已单独保存，刷新后自动恢复'
    return true
  } catch (error) {
    const reason = error?.name === 'QuotaExceededError' ? '浏览器本地存储空间不足' : (error?.message || '未知错误')
    message.value = '人物模型保存失败：' + reason
    return false
  }
}

function restorePlayerCharacterFromStorage({ silent = false } = {}) {
  try {
    const raw = localStorage.getItem(PLAYER_STORAGE_KEY)
    if (!raw) return false
    const payload = JSON.parse(raw)
    const info = engine?.restorePlayerCharacterFromSnapshot?.(payload)
    if (!info) return false
    hasSavedCharacter.value = true
    characterSelection.value = 'saved'
    if (!silent) message.value = '已恢复上次保存的人物模型'
    return true
  } catch (error) {
    console.warn('[WorldSandbox] 人物存档恢复失败', error)
    if (!silent) message.value = '人物模型恢复失败：' + (error?.message || '存档可能已损坏')
    return false
  }
}

function clearSavedPlayerCharacter() {
  try {
    localStorage.removeItem(PLAYER_STORAGE_KEY)
    hasSavedCharacter.value = false
    if (characterSelection.value === 'saved') characterSelection.value = 'preset:male'
    message.value = '已删除人物存档；当前角色不受影响'
  } catch (error) {
    message.value = '删除人物存档失败：' + (error?.message || '未知错误')
  }
}

function handleSandboxRoadEditChange(payload) {
  if (payload?.phase === 'breakpoint-pick') {
    message.value = '点击道路上要加断点的位置（一次只加一个点）；Esc 取消'
    return
  }
  if (payload?.phase === 'breakpoint-cancelled') {
    message.value = '已取消添加断点'
    return
  }
  if (payload?.phase === 'breakpoint-added') {
    const id = payload?.id || selected?.userData?.sandboxModelId
    selected = (id ? engine.getSandboxModel?.(id) : null) || selected
    selectedIsPolylineRoad.value = isPolylineRoadModel(selected)
    syncObjects()
    saveSandbox()
    message.value = '已在该位置添加断点：拖它拐弯，或拖蓝色中心手柄整段平移'
    return
  }
  if (payload?.phase === 'breakpoint-failed') {
    message.value = payload.reason || '添加断点失败'
    return
  }
  if (payload?.phase === 'blocked') {
    message.value = `道路调整未生效：${payload.reason || '当前位置存在冲突'}`
    return
  }
  if (payload?.phase === 'cancelled') {
    message.value = '已取消道路拉伸，道路保持原长度和朝向。'
    return
  }
  if (payload?.phase !== 'committed') return
  const saved = persistRoadEdit(payload)
  message.value = saved
    ? '道路端点已调整并保存。'
    : '道路端点已调整，但存档失败，请检查存储空间后重试。'
}

async function restoreSandbox() {
  let snapshot
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    snapshot = JSON.parse(raw)
    if (![1, 2, 3, 4].includes(snapshot?.version) || !Array.isArray(snapshot.models)) throw new Error('保存文件版本不兼容')
    if (snapshot.world) {
      const restoredWorld = engine.restoreSandboxWorld(snapshot.world)
      if (!restoredWorld) throw new Error('世界区块存档无效或与当前区块规格不兼容')
      worldState.value = engine.getSandboxWorldState()
    } else {
      worldState.value = engine.getSandboxWorldState()
    }
    const loader = new THREE.ObjectLoader()
    const restoredModels = snapshot.models
      .filter(item => item?.object && item?.id)
      .map(item => {
        const model = loader.parse(item.object)
        model.name = item.name || model.name || '已保存模型'
        applyTextPlates(THREE, model)
        model.userData = {
          ...(model.userData || {}),
          proceduralModelCapabilityControlDocument: model.userData?.proceduralModelCapabilityControlDocument
            || createCapabilityControlDocument({ manifest: model.userData?.proceduralModelCapabilityManifest }),
        }
        return { id: String(item.id), model }
      })
    const registeredIds = []
    try {
      for (const { id, model } of restoredModels) {
        // ObjectLoader 已从存档恢复完整 Transform；显式传回原位置，避免 addSandboxModel 的新模型默认落点覆盖存档坐标。
        const registeredId = engine.addSandboxModel(model, {
          name: model.name,
          id,
          position: { x: model.position.x, y: model.position.y, z: model.position.z },
        })
        registeredIds.push(registeredId)
        objectsById.set(registeredId, model)
      }
    } catch (error) {
      for (const id of registeredIds) {
        engine.removeSandboxModel(id)
        objectsById.delete(id)
      }
      throw error
    }
    if (snapshot.environment) {
      time.value = Number.isFinite(Number(snapshot.environment.time)) ? Number(snapshot.environment.time) : 14
      timeEnabled.value = snapshot.environment.timeEnabled !== false
      // 老存档只有 clear/rain；新模式（多云/阴/雪/雾）按已注册模式恢复，未知回退晴天
      const storedWeather = String(snapshot.environment.weather || 'clear')
      weather.value = Object.prototype.hasOwnProperty.call(WEATHER_MODES, storedWeather) ? storedWeather : 'clear'
      weatherEnabled.value = snapshot.environment.weatherEnabled !== false
      weatherIntensity.value = Number.isFinite(Number(snapshot.environment.weatherIntensity))
        ? Math.min(100, Math.max(0, Number(snapshot.environment.weatherIntensity)))
        : 50
      wind.value = Number.isFinite(Number(snapshot.environment.wind)) ? Number(snapshot.environment.wind) : 20
      windEnabled.value = snapshot.environment.windEnabled !== false
      sandboxWindDirection = {
        x: Number(snapshot.environment.windDirection?.x),
        z: Number(snapshot.environment.windDirection?.z),
      }
      artificialLightingEnabled.value = snapshot.environment.artificialLightingEnabled !== false
      updateEnvironment()
      engine?.setWeatherMode?.(weather.value, Number(weatherIntensity.value) / 100)
    }
    if (snapshot.selectedModelId && objectsById.has(snapshot.selectedModelId)) {
      selected = objectsById.get(snapshot.selectedModelId)
      engine.selectSandboxModel(snapshot.selectedModelId)
    }
    syncObjects()
    saveStatus.value = snapshot.savedAt ? '上次保存 · ' + new Date(snapshot.savedAt).toLocaleString() : '已恢复本地场景'
    message.value = '已恢复上次保存的沙盒场景，共 ' + objectsById.size + ' 个模型'
    return true
  } catch (error) {
    saveStatus.value = '恢复失败'
    message.value = '本地沙盒恢复失败：' + (error?.message || '保存数据可能已损坏')
    return false
  }
}

function buildRawEnvironment() {
  // MVP 环境开关由世界配置持有；这里仅把有效值适配到现有 Three.js Runtime。
  // 关闭时间系统时保留当前小时，关闭天气/降雨时不创建雨效，关闭风力时风速归零。
  // 主场景与编辑器预览共用这一份 raw 配置，由各自 Runtime 归一化，避免两套天气状态。
  return {
    time: Number(time.value),
    // 雨天由天气模式决定（进入下雨模式即自动下雨，不再有独立降雨开关）
    weather: weatherEnabled.value && weather.value === 'rain' ? 'rain' : 'clear',
    wind: windEnabled.value ? Number(wind.value) / 100 : 0,
    windDirection: { ...sandboxWindDirection },
    artificialLightingEnabled: artificialLightingEnabled.value,
  }
}
function updateEnvironment() {
  if (!engine) return
  const nextEnvironment = engine.setEnvironment(buildRawEnvironment())
  if (nextEnvironment?.windDirection) sandboxWindDirection = { ...nextEnvironment.windDirection }
  // setEnvironment 会按时间重算光照；随后重新应用天气模式与强度，
  // 避免拖动时间滑杆后天气光照/云雪雾被重置回默认。
  engine.setWeatherMode?.(
    weatherEnabled.value ? weather.value : 'clear',
    Number(weatherIntensity.value) / 100,
  )
}
const previewEnvironment = computed(() => buildRawEnvironment())
function executeTask() {
  const text = command.value.trim()
  if (!text) return
  if (/创建.*(立方体|方块|cube)/i.test(text)) addModel('box')
  else if (/创建.*(球体|球|sphere)/i.test(text)) addModel('sphere')
  else if (/创建.*(圆柱|cylinder)/i.test(text)) addModel('cylinder')
  else if (/创建.*(圆锥|cone)/i.test(text)) addModel('cone')
  else if (/创建.*(环形|torus)/i.test(text)) addModel('torus')
  else if (/雨|rain/i.test(text)) { weather.value = 'rain'; updateEnvironment(); message.value = '环境已切换为雨天' }
  else if (/晴天|放晴|clear/i.test(text)) { weather.value = 'clear'; updateEnvironment(); message.value = '环境已切换为晴天' }
  else if (/(时间|time)[^0-9]*(\d{1,2})/i.test(text)) {
    if (!timeEnabled.value) {
      message.value = '时间系统已关闭，请先启用后再调整时间'
    } else {
      const hour = Number(text.match(/(?:时间|time)[^0-9]*(\d{1,2})/i)[1])
      time.value = Math.min(24, Math.max(0, hour))
      updateEnvironment()
      message.value = '时间已调整为 ' + time.value + ':00'
    }
  } else if (/删除|delete/i.test(text)) deleteSelected()
  else if (/复制|duplicate/i.test(text)) duplicateSelected()
  else if (/移动|move/i.test(text)) {
    const match = text.match(/(-?\d+(?:\.\d+)?)[,，\s]+(-?\d+(?:\.\d+)?)[,，\s]+(-?\d+(?:\.\d+)?)/)
    if (!selected) message.value = '请先选择一个模型'
    else if (!match) message.value = '移动指令格式：移动 2,0,3'
    else {
      engine?.setSandboxModelTransform(selected.userData.sandboxModelId, {
        position: { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) },
      })
      message.value = '模型已移动到指定坐标'
    }
  } else if (/旋转|rotate/i.test(text)) {
    const degrees = Number((text.match(/-?\d+(?:\.\d+)?/) || [0])[0])
    if (!selected) message.value = '请先选择一个模型'
    else {
      engine?.setSandboxModelTransform(selected.userData.sandboxModelId, {
        rotation: { y: selected.rotation.y + THREE.MathUtils.degToRad(degrees) },
      })
      message.value = '模型已旋转 ' + degrees + '°'
    }
  } else message.value = '试试：创建球体、移动 2,0,3、旋转 45、切换雨天、时间 18 点、复制、删除。'
  command.value = ''
  syncObjects()
}
onMounted(async () => {
  disposed = false
  // 确保拿到当前会话用户；未登录时由 App.vue 路由守卫跳转登录页。
  if (!currentUser.value) await loadCurrentUser()
  loadMyPublishRequests()
  try {
    engine = createCampusEngine(viewport.value, {
      onReady: () => { worldState.value = engine?.getSandboxWorldState?.() || null; message.value = '空白沙盒已就绪，可生成模型并放置到场景中。' },
      onError: error => { message.value = '沙盒初始化失败：' + (error?.message || '未知错误') },
      onSandboxModelsChange: list => { objects.value = list },
      onSandboxWorldChange: state => { worldState.value = state },
      onSandboxChunkSelectionChange: handleSandboxChunkSelectionChange,
      onSandboxPlacementChange: handlePlacementChange,
      onSandboxModelSelected: handleModelSelected,
      onSandboxInteractionPromptChange: payload => {
        if (payload?.visible) message.value = payload.text
        else if (message.value.startsWith('靠近 ')) message.value = '使用 WASD 或方向键移动人物，靠近模型按 E 交互。'
      },
      onSandboxModelInteract: handleSandboxModelInteract,
      onSandboxRoadEditChange: handleSandboxRoadEditChange,
      onSandboxFootprintDrawingChange: handleFootprintDrawingChange,
      onPlayerWaterStateChange: state => { playerWaterState.value = state ? { ...state } : null },
    }, {
      // MVP 使用独立空白沙盒：只创建地面与世界边界，不加载任何写死的校园内容。
      sceneType: 'blank-sandbox',
      isometricRpg: true,
      viewMode: '3d',
      worldBounds: { width: 54, depth: 42 },
    })
    await engine.init()
    if (disposed) return
    if (showPhysicsDiagnostics) {
      const refreshDiagnostics = () => {
        physicsDiagnostics.value = engine?.getPhysicsDiagnostics?.() || null
      }
      refreshDiagnostics()
      physicsDiagnosticsTimer = window.setInterval(refreshDiagnostics, 150)
    }
    engine.setMode('overview')
    engine.setViewMode('free')
    engine.setSandboxTransformMode(transformMode.value)
    const restored = await restoreSandbox()
    if (!restored) {
      updateEnvironment()
      syncObjects()
    }
    // 人物模型独立存档：无论沙盒是否恢复成功都尝试还原上次保存的角色。
    refreshSavedCharacterFlag()
    const restoredCharacter = restorePlayerCharacterFromStorage({ silent: true })
    // 没有人物存档时默认男性角色
    if (!restoredCharacter) {
      characterSelection.value = 'preset:male'
      engine?.setPlayerCharacterPreset?.('male')
    }
    // 资产库加载失败只提示不阻断，loadMyAssets 内部已兜底
    loadMyAssets()
  } catch (error) {
    message.value = '沙盒初始化失败：' + (error?.message || '未知错误')
  }
})
onBeforeUnmount(() => {
  disposed = true
  if (physicsDiagnosticsTimer !== null) window.clearInterval(physicsDiagnosticsTimer)
  physicsDiagnosticsTimer = null
  engine?.dispose()
  engine = null
  objectsById.clear()
  selected = null
})
</script>

<template>
  <main class="world-mvp">
    <div ref="viewport" class="world-mvp__viewport"></div>
    <aside v-if="showPhysicsDiagnostics && physicsDiagnostics" class="world-mvp__physics-debug">
      <strong>物理诊断（debug=physics）</strong>
      <span>输入：{{ physicsDiagnostics.movement.requested ? '持续按下' : '无' }} · 按键 {{ physicsDiagnostics.movement.keys.join(', ') || '—' }}</span>
      <span>期望速度：{{ JSON.stringify(physicsDiagnostics.movement.commandedVelocity) }}</span>
      <span>实际速度：{{ JSON.stringify(physicsDiagnostics.movement.actualVelocity) }}</span>
      <span>物理步数：{{ physicsDiagnostics.movement.physicsStepCount }} · 累积器 {{ Number(physicsDiagnostics.accumulator).toFixed(4) }}s</span>
      <span>刚体位置：{{ JSON.stringify(physicsDiagnostics.movement.physicsPosition) }}</span>
      <span>相机角色位置：{{ JSON.stringify(physicsDiagnostics.movement.position) }}</span>
    </aside>
    <div v-if="playerWaterState" class="world-mvp__water-status">
      <strong>涉水状态</strong>
      <span>水深 {{ playerWaterState.depth.toFixed(2) }} m</span>
      <span>水面高度 {{ playerWaterState.surfaceHeight.toFixed(2) }} m</span>
      <span>角色浸入 {{ playerWaterState.immersionDepth.toFixed(2) }} m</span>
      <span>浸入比例 {{ Math.round(playerWaterState.characterImmersionRatio * 100) }}%</span>
    </div>
    <header class="world-mvp__header">
      <div class="world-mvp__brand">
        <BrandLogo class="world-mvp__mark" />
        <div><strong>{{ siteSettings.sandboxBrandName }}</strong><span>{{ siteSettings.sandboxBrandSubtitle }}</span></div>
      </div>
      <div class="world-mvp__header-actions"><div class="world-mvp__view-switch" role="group" aria-label="沙盒视角"><button :class="{ active: sandboxViewMode === 'free' }" @click="selectSandboxViewMode('free')">自由视角</button><button :class="{ active: sandboxViewMode === '2.5d' }" @click="selectSandboxViewMode('2.5d')">2.5D</button><button :class="{ active: sandboxViewMode === '3d' }" @click="selectSandboxViewMode('3d')">3D</button></div><button :class="{ active: managementMode === 'sandbox' }" @click="setManagementMode('sandbox')">世界空间</button><button :class="{ active: managementMode === 'environment' }" @click="setManagementMode('environment')">环境管理</button><button :class="{ active: managementMode === 'chunks' }" @click="toggleChunkManagement">{{ managementMode === 'chunks' ? '退出地块管理' : '地块管理' }}</button><button :class="{ active: managementMode === 'model' }" @click="setManagementMode('model')">模型管理</button><span class="world-mvp__save-status">{{ saveStatus }}</span><button class="world-mvp__save-button" :disabled="placement.active" @click="saveSandbox">保存沙盒</button><a v-if="isAdmin" href="/admin?view=settings">站点设置</a><a v-if="isAdmin" href="/admin">成员管理</a><a v-if="currentUser" href="/">返回首页</a><a v-if="currentUser" href="/change-password">{{ currentUser.displayName || currentUser.username }}</a><a href="/" @click.prevent="handleLogout">退出登录</a></div>
    </header>

    <section v-if="managementMode === 'chunks' && !placement.active" class="world-mvp__chunk-manager">
      <div class="world-mvp__chunk-manager-head">
        <div><b>地块管理已开启</b><span>直接点击沙盒地面选择地块；Ctrl / Shift / Cmd 点击可多选。场景模型保持显示。</span></div>
        <div class="world-mvp__chunk-manager-actions">
          <span>已选 {{ selectedChunks.length }} / {{ worldState?.chunks?.length || 0 }}</span>
          <button @click="selectedChunkKeys = []; selectedChunkKey = ''; engine?.setSandboxChunkSelection?.([])">清空</button>
          <button class="danger" :disabled="!selectedChunks.length" @click="removeSelectedWorldChunks">回收选中</button>
          <button @click="toggleChunkManagement">完成</button>
        </div>
      </div>
      <div v-if="selectedChunks.length" class="world-mvp__chunk-manager-selected">
        <b>当前选择</b>
        <span v-for="chunk in selectedChunks.slice(0, 8)" :key="chunk.x + ':' + chunk.z">({{ chunk.x }}, {{ chunk.z }}){{ chunk.x === 0 && chunk.z === 0 ? ' · 锚点' : '' }}</span>
        <small v-if="selectedChunks.length > 8">另有 {{ selectedChunks.length - 8 }} 块已选</small>
      </div>
      <div class="world-mvp__chunk-manager-expand">
        <div class="world-mvp__chunk-manager-size">
          <span>当前世界尺寸</span>
          <strong>{{ worldState?.bounds ? (worldState.bounds.maxX - worldState.bounds.minX).toFixed(0) + ' × ' + (worldState.bounds.maxZ - worldState.bounds.minZ).toFixed(0) : '54 × 42' }}</strong>
        </div>
        <div class="world-mvp__chunk-manager-expand-actions">
          <span>点击地块边缘的 + 即可朝该方向扩建（只增加空间，不移动已有模型）</span>
        </div>
      </div>
      <div v-if="reclaimFeedback" class="world-mvp__reclaim-feedback" :class="reclaimFeedback.type" role="status" aria-live="polite">
        <b>{{ reclaimFeedback.title }}</b><p>{{ reclaimFeedback.message }}</p>
        <ul v-if="reclaimFeedback.blockers.length"><li v-for="(blocker, index) in reclaimFeedback.blockers" :key="index">{{ blocker }}</li></ul>
      </div>
    </section>
    <aside v-if="managementMode !== 'chunks'" class="world-mvp__panel">
      <template v-if="placement.active">
        <section class="world-mvp__operation-panel">
          <h2>重新选址 · 全局视图</h2>
          <strong class="world-mvp__operation-name">{{ placement.modelName || selectedName || '当前模型' }}</strong>
          <p class="world-mvp__message">沙盒保持全景视野。移动鼠标查看模型占地；绿色表示可放置，红色表示与已有模型或碰撞区域重叠。点击地面只锁定候选位置，不会落地或保存。</p>
          <div v-if="placement.footprint" class="world-mvp__footprint-info">
            <span>最大水平占地范围</span>
            <strong>{{ placement.footprint.width.toFixed(2) }} × {{ placement.footprint.depth.toFixed(2) }}</strong>
            <small>世界单位 · 模型包围盒水平投影</small>
          </div>
          <div v-if="placement.target && placement.candidateLocked" class="world-mvp__footprint-info">
            <span>候选位置</span>
            <strong>X {{ placement.target.x.toFixed(2) }} / Z {{ placement.target.z.toFixed(2) }}</strong>
          </div>
          <p class="world-mvp__placement-status" :class="{ 'is-blocked': placement.blocked }">{{ placement.blocked ? `位置冲突：与“${placement.blockerName || '已有物体'}”重叠，禁止落地。` : placement.candidateLocked ? '候选位置已锁定且无冲突，可以确认落地。' : '尚未锁定位置，请在沙盒地面点击目标位置。' }}</p>
          <div class="world-mvp__tools world-mvp__placement-actions">
            <button :disabled="!placement.candidateLocked || placement.blocked" @click="confirmPlacement">确认落地</button>
            <button :disabled="!placement.candidateLocked" @click="unlockPlacementCandidate">重新选择</button>
            <button @click="cancelPlacement">取消</button>
          </div>
          <div class="world-mvp__placement-expand">
            <span>空间不足？直接扩建世界</span>
            <div class="world-mvp__expand-grid">
              <span></span><button @click="expandWorld('north')">北</button><span></span>
              <button @click="expandWorld('west')">西</button><span class="world-mvp__world-center">扩建</span><button @click="expandWorld('east')">东</button>
              <span></span><button @click="expandWorld('south')">南</button><span></span>
            </div>
          </div>
        </section>
      </template>
      <template v-else-if="managementMode === 'model' && selectedName">
        <section class="world-mvp__operation-panel">
          <h2>{{ precisionModeActive ? '精细调整' : '模型管理' }}</h2>
          <div class="world-mvp__list"><button v-for="item in objects" :key="item.id" :class="{ active: selectedName === item.name }" @click="selectModel(item)">{{ item.name }}</button></div>
          <strong class="world-mvp__operation-name">{{ selectedName }}</strong>
          <template v-if="precisionModeActive && transformMode === 'road-endpoints'">
            <p class="world-mvp__message">蓝色中心手柄拖动整段截面（两侧路缘一起走，宽度不变）适合拐弯/挪段；黄色角手柄只调这一侧路缘的宽度。「添加断点」后点击道路上要加点的位置，一次只加一个断点，拖它就能拉出弧度。</p>
            <div class="world-mvp__tools world-mvp__transform-actions">
              <button @click="addSelectedRoadPoint">添加断点</button>
              <button :disabled="!selectedIsPolylineRoad" @click="removeSelectedRoadPoint">删除断点</button>
              <button @click="setMode('browse')">完成</button>
            </div>
          </template>
          <template v-else-if="precisionModeActive">
            <p class="world-mvp__message">当前仅操作这个模型。拖动坐标轴调整对象，镜头输入已锁定。</p>
            <div class="world-mvp__tools world-mvp__transform-actions">
              <button :class="{ active: transformMode === 'translate' }" @click="setMode('translate')">位置</button>
              <button :class="{ active: transformMode === 'rotate' }" @click="setMode('rotate')">旋转</button>
              <button v-if="!selectedIsRoad" :class="{ active: transformMode === 'scale' }" @click="setMode('scale')">缩放</button>
              <button @click="setMode('browse')">完成调整</button>
            </div>
          </template>
          <template v-else>
            <p class="world-mvp__message">当前面板只管理这个模型，不显示其他场景工具。</p>
            <div class="world-mvp__tools world-mvp__primary-actions">
              <button @click="beginMoveSelected">重新选址</button>
              <button @click="setMode('translate')">精细调整</button>
              <button :disabled="!selectedIsRoad" @click="setMode('road-endpoints')">道路端点</button>
              <button :disabled="!selectedEditable" @click="openModelEditor()">编辑模型</button>
              <button
                :disabled="!selectedCanArchive || assetLibraryBusy"
                :title="selectedCanArchive ? '把这个 AI 模型存入服务端资产库' : '内置素材或旧版本地模型没有可入库的源码'"
                @click="archiveSelectedModel"
              >{{ assetLibraryBusy ? '处理中…' : '存入资产库' }}</button>
            </div>
            <div class="world-mvp__tools world-mvp__secondary-actions">
              <button @click="duplicateSelected">复制</button>
              <button @click="deleteSelected">删除</button>
            </div>
          </template>
          <section>
            <h2>创建新模型</h2>
            <div class="world-mvp__command">
              <input v-model="aiPrompt" placeholder="描述要创建的新模型" @keydown.enter="generateAiModel">
              <button :disabled="aiBusy || (!aiPrompt.trim() && !referenceImageDataUrl)" @click="generateAiModel">{{ aiBusy ? '生成中' : '生成' }}</button>
            </div>
            <div class="world-mvp__command" style="margin-top:7px">
              <input type="file" accept="image/png,image/jpeg,image/webp" @change="onReferenceImageChange">
            </div>
            <label class="world-mvp__toggle" style="margin-top:7px"><input v-model="stagedGenerationEnabled" type="checkbox"><span>分阶段生成（体块 → 结构 → 材质，更准但更慢）</span></label>
            <div class="world-mvp__command" style="margin-top:7px">
              <select v-model="footprintRegionMode">
                <option value="none">不限定占地</option>
                <option value="area">占地区域（底面贴合轮廓）</option>
                <option value="space">空间占据（划定占用范围）</option>
              </select>
            </div>
            <div class="world-mvp__tools world-mvp__secondary-actions" style="margin-top:7px">
              <button v-if="!footprintPoints.length" @click="startFootprintDrawing">创建占地区域</button>
              <template v-else>
                <button @click="startFootprintDrawing">重新创建</button>
                <button @click="addFootprintBreakpoint">添加断点</button>
                <button @click="removeFootprintBreakpoint">删除断点</button>
                <button @click="clearFootprint">清除区域</button>
              </template>
            </div>
            <small v-if="footprintPoints.length" class="world-mvp__message">
              已创建占地区域（{{ footprintPoints.length }} 个点）：拖黄色角点改形状，拖蓝色中心整体移动
              <template v-if="footprintSizeLabel">（约 {{ footprintSizeLabel }}）</template>
            </small>
            <small v-if="footprintSelfIntersecting" class="world-mvp__message">轮廓有交叉（红色边），请拖动顶点调整或清除重画</small>
          </section>
        </section>
      </template>
      <template v-else>
        <section v-if="managementMode === 'environment'">
          <h2>环境</h2>
          <label class="world-mvp__toggle"><input v-model="timeEnabled" type="checkbox" @change="updateEnvironment"><span>时间系统</span><b>{{ timeEnabled ? '开启' : '关闭' }}</b></label>
          <label class="world-mvp__field"><span>当前时间 <b>{{ String(Math.floor(time)).padStart(2, '0') }}:{{ String(Math.round((time % 1) * 60)).padStart(2, '0') }}</b></span>
            <input v-model.number="time" type="range" min="0" max="24" step="0.25" :disabled="!timeEnabled" @input="updateEnvironment">
          </label>
          <label class="world-mvp__toggle"><input v-model="weatherEnabled" type="checkbox" @change="updateEnvironment"><span>天气总开关</span><b>{{ weatherEnabled ? '开启' : '关闭' }}</b></label>
          <label class="world-mvp__field"><span>天气模式</span>
            <select v-model="weather" :disabled="!weatherEnabled" @change="applyWeatherMode">
              <option v-for="(mode, key) in weatherModes" :key="key" :value="key">{{ mode.label }}</option>
            </select>
          </label>
          <label class="world-mvp__field"><span>{{ weatherIntensityLabel }} <b>{{ weatherIntensity }}%</b></span>
            <input v-model.number="weatherIntensity" type="range" min="0" max="100" step="5" :disabled="!weatherEnabled" @input="applyWeatherMode">
          </label>
          <label class="world-mvp__toggle"><input v-model="artificialLightingEnabled" type="checkbox" @change="updateEnvironment"><span>人工灯光总开关</span><b>{{ artificialLightingEnabled ? '开启' : '关闭' }}</b></label>
          <label class="world-mvp__toggle"><input v-model="windEnabled" type="checkbox" @change="updateEnvironment"><span>风力系统</span><b>{{ windEnabled ? '开启' : '关闭' }}</b></label>
          <label class="world-mvp__field"><span>风速 <b>{{ wind }}%</b></span>
            <input v-model.number="wind" type="range" min="0" max="100" step="5" :disabled="!windEnabled" @input="updateEnvironment">
          </label>
        </section>
        <section v-if="managementMode === 'sandbox'" class="world-mvp__world-panel">
          <h2>世界空间</h2>
          <div class="world-mvp__world-size">
            <span>当前世界尺寸</span>
            <strong>{{ worldState?.bounds ? (worldState.bounds.maxX - worldState.bounds.minX).toFixed(0) + ' × ' + (worldState.bounds.maxZ - worldState.bounds.minZ).toFixed(0) : '54 × 42' }}</strong>
          </div>
          <div class="world-mvp__world-size">
            <span>地块数量</span>
            <strong>{{ worldState?.chunks?.length || 1 }} 块</strong>
          </div>
          <textarea v-model="publishNote" class="world-mvp__publish-note" rows="2" maxlength="1000" placeholder="给管理员说明这次发布的内容（可选）"></textarea>
          <button class="world-mvp__publish-submit" :disabled="publishSubmitting" @click="submitSandboxPublishRequest">{{ publishSubmitting ? '提交中…' : '申请发布到首页' }}</button>
          <p v-if="publishStatus" class="world-mvp__message">{{ publishStatus }}</p>
          <div v-if="latestPublishRequest" class="world-mvp__publish-state">
            最近一次申请：{{ publishStatusLabel(latestPublishRequest.status) }}
            <span v-if="latestPublishRequest.createdAt"> · {{ new Date(latestPublishRequest.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</span>
            <span v-if="latestPublishRequest.reviewNote"> · {{ latestPublishRequest.reviewNote }}</span>
          </div>
          <p class="world-mvp__message">提交后由管理员审核；通过后首页才会切换到这份冻结版本。成员的编辑不会直接影响首页。</p>
        </section>
        <section v-if="managementMode === 'model'">
          <h2>内置素材</h2>
          <p class="world-mvp__message">即点即试：点击素材进入场景选址，确认落地后才会加入沙盒。</p>
          <details v-for="group in builtinAssetGroups" :key="group.category" open>
            <summary>{{ group.label }}（{{ group.items.length }}）</summary>
            <div class="world-mvp__model-grid">
              <button
                v-for="item in group.items"
                :key="group.category + ':' + item.objectType"
                :disabled="placement.active || assetLibraryBusy"
                @click="placeBuiltinAsset(item)"
              >
                {{ item.label }}
                <small v-if="item.note" class="world-mvp__model-note">{{ item.note }}</small>
              </button>
            </div>
          </details>
        </section>
        <section v-if="managementMode === 'model'">
          <h2>我的模型</h2>
          <p v-if="assetLibraryBusy" class="world-mvp__message">资产库加载中…</p>
          <p v-else-if="!myAssets.length" class="world-mvp__message">还没有存档模型，选中场景里的 AI 模型即可存入。</p>
          <div v-else class="world-mvp__list">
            <div v-for="item in myAssets" :key="item.assetId">
              <div v-if="renamingAssetId === item.assetId" class="world-mvp__command">
                <input
                  v-model="renamingAssetName"
                  placeholder="模型名称"
                  @keydown.enter="confirmRenameAsset(item)"
                  @keydown.esc="cancelRenameAsset"
                >
                <button :disabled="assetLibraryBusy" @click="confirmRenameAsset(item)">确认</button>
                <button :disabled="assetLibraryBusy" @click="cancelRenameAsset">取消</button>
              </div>
              <div v-else class="world-mvp__tools">
                <button :disabled="placement.active || assetLibraryBusy" @click="placeLibraryAsset(item)">
                  {{ item.name }}（{{ item.objectType }}）
                </button>
                <button :disabled="assetLibraryBusy" @click="startRenameAsset(item)">重命名</button>
                <button
                  v-if="confirmDeleteAssetId !== item.assetId"
                  :disabled="assetLibraryBusy"
                  @click="requestDeleteAsset(item)"
                >删除</button>
                <template v-else>
                  <button class="danger" :disabled="assetLibraryBusy" @click="confirmDeleteAsset(item)">确认删除</button>
                  <button :disabled="assetLibraryBusy" @click="cancelDeleteAsset">取消</button>
                </template>
              </div>
            </div>
          </div>
          <p class="world-mvp__message">删除库存记录不会影响场景里已经放置的模型。</p>
        </section>
        <section v-if="managementMode === 'model'">
          <h2>AI 建模</h2>
          <div class="world-mvp__command">
            <input v-model="aiPrompt" placeholder="描述模型，例如：一栋带玻璃幕墙的现代图书馆" @keydown.enter="generateAiModel">
            <button :disabled="aiBusy || (!aiPrompt.trim() && !referenceImageDataUrl)" @click="generateAiModel">{{ aiBusy ? '生成中' : '生成' }}</button>
          </div>
          <div class="world-mvp__command" style="margin-top:7px">
            <input type="file" accept="image/png,image/jpeg,image/webp" @change="onReferenceImageChange">
          </div>
          <p v-if="referenceImageName" class="world-mvp__message">参考图：{{ referenceImageName }}</p>
          <p class="world-mvp__message">AI 返回 Three.js 源码，在隔离环境构建后直接加入 RPG 场景；不经过 GLB。</p>
        </section>
        <section v-if="managementMode === 'model'">
          <h2>模型列表与基础模型</h2>
          <div class="world-mvp__model-grid">
            <button v-for="item in objectTypes" :key="item.id" @click="addModel(item.id)">＋ {{ item.label }}</button>
          </div>
          <button class="world-mvp__demo-button" @click="addLightSwitchDemo">创建开关灯交互演示</button>
          <div class="world-mvp__list">
            <button v-for="item in objects" :key="item.id" :class="{ active: selectedName === item.name }" @click="selectModel(item)">{{ item.name }}</button>
          </div>
        </section>
        <section v-if="managementMode === 'sandbox'">
          <h2>场景信息</h2>
          <p class="world-mvp__message">空白沙盒世界：地面区块、环境与模型都来自当前沙盒，不再加载校园底图。</p>
        </section>

        <section v-if="managementMode === 'sandbox'">
          <h2>玩家角色</h2>
          <label class="world-mvp__field"><span>人物选择</span>
            <select v-model="characterSelection" :disabled="characterBusy" @change="applyCharacterSelection">
              <option v-for="option in playerPresetOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              <option v-if="hasSavedCharacter" value="saved">已保存的人物</option>
            </select>
          </label>
          <div class="world-mvp__command">
            <input v-model="characterPrompt" :disabled="characterBusy" placeholder="描述要生成的玩家角色" @keydown.enter="generateAiPlayerCharacter">
            <button :disabled="characterBusy || !characterPrompt.trim()" @click="generateAiPlayerCharacter">{{ characterBusy ? '生成中' : 'AI 生成角色' }}</button>
          </div>
          <div class="world-mvp__command" style="margin-top:7px">
            <input type="file" accept=".glb,model/gltf-binary" :disabled="characterBusy" @change="importPlayerCharacter">
          </div>
          <div class="world-mvp__tools">
            <button :disabled="characterBusy" @click="savePlayerCharacterToStorage()">保存人物</button>
            <button :disabled="characterBusy" @click="restorePlayerCharacterFromStorage()">恢复已保存人物</button>
            <button :disabled="characterBusy" @click="engine?.restorePlayerCharacterFallback?.()">恢复默认角色</button>
            <button :disabled="characterBusy" @click="clearSavedPlayerCharacter">删除人物存档</button>
          </div>
          <p class="world-mvp__message">人物模型单独存档：保存/恢复/删除不影响沙盒场景；生成或导入的角色会自动保存。</p>
        </section>
        <section v-if="managementMode === 'model'">
          <h2>快捷操作</h2>
          <div class="world-mvp__command">
            <input v-model="command" placeholder="输入任务，例如：创建球体" @keydown.enter="executeTask">
            <button @click="executeTask">执行</button>
          </div>
          <p class="world-mvp__message">{{ message }}</p>
          <div class="world-mvp__examples">
            <button @click="command = '创建球体'; executeTask()">创建球体</button>
            <button @click="command = '移动 2,0,3'; executeTask()">移动模型</button>
            <button @click="command = '切换雨天'; executeTask()">切换雨天</button>
            <button @click="command = '触发交互'; executeTask()">触发交互</button>
          </div>
        </section>
      </template>
    </aside>
    <ProceduralModelEditor
      ref="proceduralModelEditorRef"
      v-if="editorOpen"
      :model="editingModel"
      :environment="previewEnvironment"
      :mode="editorMode"
      :progress="generationProgress"
      :messages="modelChatMessages"
      :busy="aiBusy || editBusy || characterBusy"
      :error="editError"
      :can-undo="editHistory.length > 0"
      @undo="undoModelEdit"
      @close="closeModelEditor"
      @save="saveEditorModel"
      @edit="handleModelEdit"
      @parameter-change="handleParameterChange"
      @capability-change="handleCapabilityChange"
    />
    <footer class="world-mvp__help">WASD / 方向键移动角色 · 沙盒默认仅保留空白地面 · 重新选址会检测已有模型占地冲突</footer>
  </main>
</template>

<style scoped>
.world-mvp {
  --ws-pine-950: #0b2019;
  --ws-pine-900: #102a22;
  --ws-pine-800: #16382c;
  --ws-pine-700: #1f4a3a;
  --ws-chalk: #f2efe3;
  --ws-cream: #e8ddc3;
  --ws-sage: #a9b8a6;
  --ws-sage-dim: #7e9586;
  --ws-brick: #c2553c;
  --ws-brick-deep: #a34531;
  --ws-line: rgba(242, 239, 227, 0.16);
  position: relative;
  width: 100%;
  height: 100vh;
  min-height: 600px;
  overflow: hidden;
  color: var(--ws-chalk);
  background: var(--ws-pine-950);
  font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
}
.world-mvp__viewport { position: absolute; inset: 0; }
.world-mvp__physics-debug { position: absolute; z-index: 4; left: 18px; top: 82px; display: flex; flex-direction: column; gap: 4px; max-width: min(520px, calc(100vw - 36px)); padding: 10px 12px; border: 1px solid rgba(194, 85, 60, 0.5); border-radius: 2px; color: #f6ead9; background: rgba(35, 25, 16, 0.92); font: 11px/1.45 ui-monospace, monospace; overflow-wrap: anywhere; pointer-events: none; }
.world-mvp__physics-debug strong { color: #ffc27d; }
.world-mvp__water-status { position: absolute; z-index: 3; left: 18px; bottom: 22px; display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 1px solid rgba(142, 215, 232, 0.4); border-radius: 2px; color: #d8f4fa; background: rgba(9, 32, 42, 0.9); font-size: 11px; pointer-events: none; }
.world-mvp__water-status strong { color: #8ed7e8; }
.world-mvp__viewport :deep(canvas) { display: block; width: 100%; height: 100%; }
.world-mvp__header { position: absolute; z-index: 2; top: 0; left: 0; right: 0; height: 65px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; border-top: 3px solid var(--ws-brick); border-bottom: 1px solid var(--ws-line); background: var(--ws-pine-950); }
.world-mvp__brand { display: flex; align-items: center; gap: 10px; }
.world-mvp__mark { width: 30px; height: 30px; flex: none; }
.world-mvp__brand strong, .world-mvp__brand span { display: block; }
.world-mvp__brand strong { font-family: 'Noto Serif SC', 'Songti SC', serif; font-size: 15px; font-weight: 700; letter-spacing: 1px; }
.world-mvp__brand span { margin-top: 3px; color: var(--ws-sage); font-size: 10.5px; letter-spacing: 0.3px; }
.world-mvp__header-actions { display: flex; align-items: center; gap: 9px; }
.world-mvp__view-switch { display: flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid var(--ws-line); border-radius: 2px; background: var(--ws-pine-900); }
.world-mvp__view-switch button { padding: 6px 8px; border-color: transparent; white-space: nowrap; }
.world-mvp__view-switch button.active { border-color: var(--ws-brick); color: #fff7ee; background: var(--ws-brick); }
.world-mvp__chunk-manager { position: absolute; z-index: 4; top: 79px; right: 14px; width: min(420px, calc(100vw - 28px)); max-height: 42vh; overflow: auto; padding: 12px; border: 1px solid var(--ws-line); border-radius: 2px; background: var(--ws-pine-900); }
.world-mvp__chunk-manager-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.world-mvp__chunk-manager-head > div:first-child { display: grid; gap: 4px; }
.world-mvp__chunk-manager-head b { color: var(--ws-chalk); font-size: 12px; }
.world-mvp__chunk-manager-head span { color: var(--ws-sage); font-size: 10px; line-height: 1.5; }
.world-mvp__chunk-manager-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.world-mvp__chunk-manager-actions > span { color: var(--ws-cream); font-size: 10px; }
.world-mvp__chunk-manager-actions .danger { border-color: rgba(230, 139, 126, 0.5); color: #ffc1b6; }
.world-mvp__chunk-manager-actions .danger:disabled { opacity: 0.35; }
.world-mvp__chunk-manager-selected { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--ws-line); color: var(--ws-sage); font-size: 10px; }
.world-mvp__chunk-manager-selected b { color: var(--ws-chalk); }
.world-mvp__chunk-manager-selected span { padding: 3px 6px; border: 1px solid var(--ws-line); border-radius: 2px; background: rgba(242, 239, 227, 0.05); }
.world-mvp__chunk-manager-selected small { color: var(--ws-sage-dim); }
.world-mvp__chunk-manager-expand { margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--ws-line); display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.world-mvp__chunk-manager-size { display: flex; align-items: baseline; gap: 6px; color: var(--ws-sage); font-size: 10px; }
.world-mvp__chunk-manager-size strong { color: var(--ws-cream); font-size: 12px; font-variant-numeric: tabular-nums; }
.world-mvp__chunk-manager-expand-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.world-mvp__chunk-manager-expand-actions span { color: var(--ws-sage-dim); font-size: 10px; }
.world-mvp__open-chunk-manager { width: 100%; margin-top: 12px; padding: 13px !important; border-color: var(--ws-line) !important; text-align: left; color: var(--ws-chalk) !important; background: transparent !important; }
.world-mvp__open-chunk-manager span { display: block; margin-top: 5px; color: var(--ws-sage-dim); font-size: 10px; }
.world-mvp__map-toolbar { display: flex; align-items: center; justify-content: space-between; margin: 9px 0 6px; color: var(--ws-sage-dim); font-size: 10px; }
.world-mvp__map-toolbar div { display: flex; gap: 5px; }
.world-mvp__map-toolbar button { width: 27px; height: 25px; padding: 0; font-size: 15px; }
.world-mvp__chunk-map-viewport { max-width: 100%; max-height: 260px; overflow: auto; border: 1px solid var(--ws-line); border-radius: 2px; background: var(--ws-pine-950); }
.world-mvp__chunk-map { display: block; max-width: none; }
.world-mvp__chunk-map-item { cursor: pointer; }
.world-mvp__chunk-map-item rect { fill: #3f5a4c; fill-opacity: 0.88; stroke: rgba(232, 221, 195, 0.32); stroke-width: 1.3; transition: fill 0.15s, stroke 0.15s; }
.world-mvp__chunk-map-item:hover rect { fill: #54725f; }
.world-mvp__chunk-map-item.active rect { fill: var(--ws-brick); stroke: var(--ws-cream); stroke-width: 2.5; }
.world-mvp__chunk-map-item.anchor rect { fill: var(--ws-pine-700); stroke: var(--ws-sage); stroke-dasharray: 3 2; }
.world-mvp__chunk-map-item text { fill: var(--ws-chalk); font-size: 10px; pointer-events: none; }
.world-mvp__selected-chunk { display: flex; flex-direction: column; gap: 4px; margin-top: 9px; padding: 9px; border-radius: 2px; background: rgba(242, 239, 227, 0.05); color: var(--ws-chalk); font-size: 10px; }
.world-mvp__selected-chunk div { display: flex; justify-content: space-between; gap: 8px; }
.world-mvp__selected-chunk small { color: var(--ws-sage); }
.world-mvp .world-mvp__reclaim-button { width: 100%; margin-top: 8px; border-color: rgba(230, 139, 126, 0.4); color: #efb0a6; }
.world-mvp__reclaim-feedback { margin-top: 9px; padding: 10px; border: 1px solid var(--ws-line); border-radius: 2px; font-size: 10px; line-height: 1.5; }
.world-mvp__reclaim-feedback.error { border-color: rgba(230, 139, 126, 0.45); background: rgba(130, 47, 42, 0.16); color: #ffd1c9; }
.world-mvp__reclaim-feedback.success { border-color: rgba(130, 190, 145, 0.4); background: rgba(53, 103, 68, 0.16); color: #c8ebd0; }
.world-mvp__reclaim-feedback p { margin: 5px 0; }
.world-mvp__reclaim-feedback ul { margin: 5px 0 0; padding-left: 17px; color: #f4c4bb; }
.world-mvp__save-status { color: var(--ws-sage-dim); font-size: 10px; }
.world-mvp .world-mvp__save-button { border-color: var(--ws-brick); color: #fff7ee; background: var(--ws-brick); font-weight: 600; }
.world-mvp a, .world-mvp button { border: 1px solid var(--ws-line); border-radius: 2px; padding: 8px 10px; color: var(--ws-chalk); background: transparent; text-decoration: none; cursor: pointer; font: inherit; font-size: 11px; transition: background 0.16s ease, border-color 0.16s ease; }
.world-mvp button:hover, .world-mvp a:hover { border-color: rgba(242, 239, 227, 0.34); background: rgba(242, 239, 227, 0.07); }
.world-mvp button:disabled { opacity: 0.35; cursor: not-allowed; }
.world-mvp button:focus-visible, .world-mvp a:focus-visible, .world-mvp input:focus-visible, .world-mvp select:focus-visible { outline: 2px solid var(--ws-cream); outline-offset: 2px; }
.world-mvp__placement-status.is-blocked { color: #ff918b; }
.world-mvp__panel { position: absolute; z-index: 2; top: 81px; left: 14px; bottom: 48px; width: 290px; overflow: auto; padding: 0 14px 14px; border: 1px solid var(--ws-line); border-radius: 2px; background: var(--ws-pine-800); }
.world-mvp__panel section { padding: 15px 0; border-bottom: 1px solid var(--ws-line); }
.world-mvp__world-size { display: flex; align-items: center; justify-content: space-between; margin: 8px 0; padding: 9px; border: 1px solid var(--ws-line); border-radius: 2px; background: rgba(242, 239, 227, 0.04); }
.world-mvp__world-size span, .world-mvp__world-note { color: var(--ws-sage); font-size: 10px; }
.world-mvp__world-size strong { color: var(--ws-cream); font-size: 13px; font-variant-numeric: tabular-nums; }
.world-mvp__expand-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; align-items: center; }
.world-mvp__expand-grid button { padding: 8px 3px; font-size: 10px; }
.world-mvp__world-center { text-align: center; color: var(--ws-cream); font-size: 10px; }
.world-mvp__world-note { display: block; margin-top: 8px; line-height: 1.5; }
.world-mvp__panel h2 { margin: 0 0 12px; font-family: 'Noto Serif SC', 'Songti SC', serif; font-size: 14px; font-weight: 700; letter-spacing: 0.6px; color: var(--ws-chalk); }
.world-mvp__model-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.world-mvp__model-note { display: block; margin-top: 4px; color: var(--ws-sage-dim); font-size: 9px; line-height: 1.45; }
.world-mvp .world-mvp__demo-button { width: 100%; margin-top: 7px; border-color: var(--ws-line); color: var(--ws-cream); }
.world-mvp__selected-context { margin-top: 10px; padding: 10px; border: 1px solid var(--ws-line); border-radius: 2px; background: rgba(242, 239, 227, 0.04); }
.world-mvp__selected-heading span, .world-mvp__selected-heading strong { display: block; }
.world-mvp__selected-heading span { color: var(--ws-sage-dim); font-size: 10px; }
.world-mvp__selected-heading strong { margin-top: 5px; color: var(--ws-chalk); font-size: 12px; overflow-wrap: anywhere; }
.world-mvp__selected-context .world-mvp__message { min-height: 0; margin: 7px 0; }
.world-mvp__primary-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.world-mvp__primary-actions button:last-child { grid-column: 1 / -1; }
.world-mvp__transform-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.world-mvp__secondary-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.world-mvp__empty-selection { margin: 10px 0 0; padding: 10px; border: 1px dashed var(--ws-line); border-radius: 2px; color: var(--ws-sage-dim); font-size: 10px; line-height: 1.6; }
.world-mvp__tools { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 8px; }
.world-mvp__operation-panel { min-height: 100%; }
.world-mvp__operation-name { display: block; margin: 5px 0 10px; color: var(--ws-chalk); font-size: 13px; overflow-wrap: anywhere; }
.world-mvp__operation-panel .world-mvp__message { margin: 8px 0 12px; line-height: 1.65; }
.world-mvp__footprint-info { display: grid; gap: 5px; margin: 12px 0; padding: 10px; border: 1px solid var(--ws-line); border-radius: 2px; background: rgba(242, 239, 227, 0.04); }
.world-mvp__footprint-info span { color: var(--ws-sage); font-size: 10px; }
.world-mvp__footprint-info strong { color: var(--ws-cream); font-size: 14px; font-variant-numeric: tabular-nums; }
.world-mvp__footprint-info small { color: var(--ws-sage-dim); font-size: 9px; }
.world-mvp__placement-status { margin: 12px 0; color: var(--ws-cream); font-size: 10px; line-height: 1.6; }
.world-mvp__placement-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.world-mvp__placement-expand { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--ws-line); }
.world-mvp__placement-expand > span { display: block; margin-bottom: 8px; color: var(--ws-sage); font-size: 10px; }
.world-mvp__placement-expand .world-mvp__expand-grid button { padding: 6px 3px; }
.world-mvp__placement-actions button:first-child { grid-column: 1 / -1; border-color: var(--ws-brick); color: #fff7ee; background: var(--ws-brick); font-weight: 600; }
.world-mvp__placement-actions button:disabled { color: var(--ws-chalk); background: transparent; }
.world-mvp__placement { margin-top: 9px; padding: 10px; border: 1px solid var(--ws-line); border-radius: 2px; background: rgba(242, 239, 227, 0.04); }
.world-mvp__placement strong { display: block; color: var(--ws-cream); font-size: 11px; }
.world-mvp__placement p { margin: 7px 0; color: var(--ws-sage); font-size: 10px; line-height: 1.55; }
.world-mvp__placement .world-mvp__tools { grid-template-columns: repeat(2, 1fr); }
.world-mvp button.active { border-color: var(--ws-brick); color: #f8e9e4; background: rgba(194, 85, 60, 0.2); }
.world-mvp__list { display: grid; gap: 4px; max-height: 100px; overflow: auto; margin-top: 8px; }
.world-mvp__list button { text-align: left; }
.world-mvp__field { display: grid; gap: 8px; margin: 12px 0; color: var(--ws-sage); font-size: 11px; }
.world-mvp__field span { display: flex; justify-content: space-between; }
.world-mvp__field b { color: var(--ws-chalk); }
.world-mvp__toggle { display: flex; align-items: center; gap: 8px; margin: 10px 0; color: var(--ws-sage); font-size: 11px; }
.world-mvp__toggle input { accent-color: var(--ws-brick); }
.world-mvp__toggle b { margin-left: auto; color: var(--ws-chalk); font-size: 10px; font-weight: 500; }
.world-mvp__field input[type=range] { width: 100%; accent-color: var(--ws-brick); }
.world-mvp select { padding: 8px; border: 1px solid var(--ws-line); border-radius: 2px; color: var(--ws-chalk); background: var(--ws-pine-900); font: inherit; font-size: 11px; }
.world-mvp input[type=file] { width: 100%; padding: 6px; border: 1px solid var(--ws-line); border-radius: 2px; color: var(--ws-sage); background: var(--ws-pine-900); font-size: 10px; }
.world-mvp input[type=file]::file-selector-button { margin-right: 8px; padding: 5px 8px; border: 1px solid var(--ws-line); border-radius: 2px; color: var(--ws-chalk); background: transparent; cursor: pointer; font: inherit; font-size: 10px; }
.world-mvp__panel, .world-mvp__chunk-manager, .world-mvp__list, .world-mvp__chunk-map-viewport { scrollbar-width: thin; scrollbar-color: var(--ws-pine-700) transparent; }
.world-mvp__panel::-webkit-scrollbar, .world-mvp__chunk-manager::-webkit-scrollbar, .world-mvp__list::-webkit-scrollbar, .world-mvp__chunk-map-viewport::-webkit-scrollbar { width: 8px; height: 8px; }
.world-mvp__panel::-webkit-scrollbar-thumb, .world-mvp__chunk-manager::-webkit-scrollbar-thumb, .world-mvp__list::-webkit-scrollbar-thumb, .world-mvp__chunk-map-viewport::-webkit-scrollbar-thumb { background: var(--ws-pine-700); border-radius: 0; }
.world-mvp__panel::-webkit-scrollbar-track, .world-mvp__chunk-manager::-webkit-scrollbar-track, .world-mvp__list::-webkit-scrollbar-track, .world-mvp__chunk-map-viewport::-webkit-scrollbar-track { background: transparent; }
.world-mvp__command { display: flex; gap: 6px; }
.world-mvp__command input { min-width: 0; flex: 1; padding: 9px; border: 1px solid var(--ws-line); border-radius: 2px; outline: none; color: var(--ws-chalk); background: var(--ws-pine-900); font: inherit; font-size: 11px; }
.world-mvp__command button { border-color: var(--ws-brick); color: #fff7ee; background: var(--ws-brick); font-weight: 600; }
.world-mvp__message { min-height: 34px; color: var(--ws-sage); font-size: 10px; line-height: 1.6; }
.world-mvp__examples { display: flex; flex-wrap: wrap; gap: 5px; }
.world-mvp__examples button { padding: 5px 7px; font-size: 9px; }
.world-mvp__help { position: absolute; right: 14px; bottom: 12px; padding: 8px 11px; border: 1px solid var(--ws-line); border-radius: 2px; color: var(--ws-sage); background: var(--ws-pine-900); font-size: 10px; }
@media (max-width: 680px) {
  .world-mvp__header { height: 57px; padding: 0 10px; }
  .world-mvp__header-actions { gap: 5px; overflow-x: auto; }
  .world-mvp__view-switch button { padding: 5px 6px; font-size: 9px; }
  .world-mvp__panel { top: auto; left: 8px; right: 8px; bottom: 8px; width: auto; max-height: 52vh; padding: 0 12px 10px; }
  .world-mvp__help { display: none; }
  .world-mvp__chunk-manager { top: 65px; right: 8px; width: calc(100vw - 16px); max-height: 45vh; padding: 10px; }
  .world-mvp__chunk-manager-actions { gap: 5px; }
  .world-mvp__chunk-manager-actions button { padding: 7px 8px; font-size: 10px; }
}
/* Liquid glass 主题：浅色磨砂玻璃 + 薄荷青强调色 */
.world-mvp {
  --ws-chalk: #0f2e26;
  --ws-cream: #0b3d32;
  --ws-sage: #3f5a4e;
  --ws-sage-dim: #5d7a6c;
  --ws-brick: #1f9d78;
  --ws-brick-deep: #187a5d;
  --ws-line: rgba(15, 46, 38, 0.14);
  --ws-pine-950: transparent;
  --ws-pine-900: rgba(255, 255, 255, 0.3);
  --ws-pine-800: rgba(255, 255, 255, 0.46);
  --ws-pine-700: rgba(255, 255, 255, 0.6);
  background: transparent;
  color: var(--ws-chalk);
}
.world-mvp__header {
  top: 14px;
  left: 14px;
  right: 14px;
  height: 60px;
  padding: 0 14px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.24));
  backdrop-filter: blur(26px) saturate(1.7);
  -webkit-backdrop-filter: blur(26px) saturate(1.7);
  box-shadow: 0 24px 60px rgba(24, 64, 48, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.92);
}
.world-mvp__brand strong { font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif; font-size: 14.5px; font-weight: 700; letter-spacing: 0.4px; color: var(--ws-chalk); }
.world-mvp__brand span { color: var(--ws-sage); }
.world-mvp__panel,
.world-mvp__chunk-manager {
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.54), rgba(255, 255, 255, 0.26));
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 20px;
  backdrop-filter: blur(28px) saturate(1.8);
  -webkit-backdrop-filter: blur(28px) saturate(1.8);
  box-shadow: 0 24px 60px rgba(24, 64, 48, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.92);
  color: var(--ws-chalk);
}
.world-mvp__panel { top: 88px; bottom: 20px; }
.world-mvp__chunk-manager { top: 86px; }
.world-mvp__panel h2 { font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.3px; color: var(--ws-chalk); }
.world-mvp a,
.world-mvp button {
  border: 1px solid rgba(15, 46, 38, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.36);
  color: var(--ws-chalk);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.world-mvp a:hover,
.world-mvp button:hover { border-color: rgba(15, 46, 38, 0.24); background: rgba(255, 255, 255, 0.6); }
.world-mvp button.active { border-color: rgba(31, 157, 120, 0.4); background: rgba(127, 240, 200, 0.3); color: #0b3d32; }
.world-mvp__view-switch { border-color: rgba(255, 255, 255, 0.65); border-radius: 14px; background: rgba(255, 255, 255, 0.24); }
.world-mvp__view-switch button { background: transparent; border-color: transparent; border-radius: 11px; }
.world-mvp__view-switch button.active { border-color: transparent; background: linear-gradient(135deg, #7ff0c8, #6fd8e6); color: #073b2e; box-shadow: 0 8px 18px rgba(63, 214, 164, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.5); }
.world-mvp .world-mvp__save-button { border-color: transparent; background: linear-gradient(135deg, #7ff0c8, #6fd8e6); color: #073b2e; font-weight: 700; box-shadow: 0 10px 22px rgba(63, 214, 164, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.55); }
.world-mvp .world-mvp__save-button:hover { background: linear-gradient(135deg, #93f7d4, #82e4ef); }
.world-mvp select,
.world-mvp__command input {
  background: rgba(255, 255, 255, 0.34);
  border: 1px solid rgba(255, 255, 255, 0.65);
  border-radius: 12px;
  color: var(--ws-chalk);
}
.world-mvp input[type=file] { background: rgba(255, 255, 255, 0.3); border: 1px solid rgba(255, 255, 255, 0.65); border-radius: 12px; color: var(--ws-sage); }
.world-mvp input[type=file]::file-selector-button { border: 1px solid rgba(15, 46, 38, 0.16); border-radius: 9px; color: var(--ws-chalk); background: rgba(255, 255, 255, 0.45); }
.world-mvp__world-size,
.world-mvp__selected-context,
.world-mvp__footprint-info,
.world-mvp__placement,
.world-mvp__chunk-manager-selected span {
  background: rgba(255, 255, 255, 0.26);
  border-color: rgba(255, 255, 255, 0.6);
  border-radius: 12px;
}
.world-mvp__chunk-manager-selected span { border-radius: 9px; }
.world-mvp__publish-note { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid rgba(255, 255, 255, 0.65); border-radius: 12px; background: rgba(255, 255, 255, 0.34); color: var(--ws-chalk); font: inherit; font-size: 11px; resize: vertical; }
.world-mvp__publish-note:focus { outline: 2px solid rgba(31, 157, 120, 0.35); border-color: rgba(31, 157, 120, 0.4); }
.world-mvp__publish-submit { width: 100%; margin-top: 7px; }
.world-mvp__publish-state { margin-top: 7px; color: var(--ws-sage); font-size: 10px; line-height: 1.6; }
.world-mvp__chunk-map-viewport { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.6); border-radius: 12px; }
.world-mvp__chunk-map-item rect { fill: rgba(15, 46, 38, 0.35); stroke: rgba(255, 255, 255, 0.7); }
.world-mvp__chunk-map-item:hover rect { fill: rgba(15, 46, 38, 0.5); }
.world-mvp__chunk-map-item.active rect { fill: #35c99b; stroke: #ffffff; }
.world-mvp__chunk-map-item.anchor rect { fill: rgba(15, 46, 38, 0.22); stroke: rgba(15, 46, 38, 0.55); }
.world-mvp__chunk-map-item text { fill: #0f2e26; }
.world-mvp__help { background: rgba(255, 255, 255, 0.38); border-color: rgba(255, 255, 255, 0.65); border-radius: 12px; color: var(--ws-sage); }
.world-mvp__toggle input,
.world-mvp__field input[type=range] { accent-color: #1f9d78; }
.world-mvp__placement-actions button:first-child,
.world-mvp__command button { border-color: transparent; background: linear-gradient(135deg, #7ff0c8, #6fd8e6); color: #073b2e; font-weight: 700; }
.world-mvp__reclaim-feedback { border-radius: 12px; }
.world-mvp__physics-debug { border-radius: 12px; }
.world-mvp__water-status { border-radius: 12px; }
.world-mvp__panel,
.world-mvp__chunk-manager,
.world-mvp__list,
.world-mvp__chunk-map-viewport { scrollbar-width: thin; scrollbar-color: rgba(15, 46, 38, 0.28) transparent; }
.world-mvp__panel::-webkit-scrollbar-thumb,
.world-mvp__chunk-manager::-webkit-scrollbar-thumb,
.world-mvp__list::-webkit-scrollbar-thumb,
.world-mvp__chunk-map-viewport::-webkit-scrollbar-thumb { background: rgba(15, 46, 38, 0.28); }
@media (max-width: 680px) {
  .world-mvp__header { top: 8px; left: 8px; right: 8px; height: 56px; padding: 0 10px; border-radius: 16px; }
  .world-mvp__panel { top: auto; bottom: 8px; border-radius: 18px; }
  .world-mvp__chunk-manager { top: 72px; border-radius: 18px; }
}
</style>
