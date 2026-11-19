<script setup>
import { computed, defineAsyncComponent, onMounted, onBeforeUnmount, ref } from 'vue'
import * as THREE from 'three'
import { createCampusEngine } from './three/engine/createCampusEngine.js'
import { loadGlobalPublishedSnapshot, HOMEPAGE_SNAPSHOT_KEY } from './components/sandbox/homepageSnapshot.js'
import { applyTextPlates } from './three/sandbox/textPlateRuntime.js'
import { WEATHER_MODES } from './three/engine/weatherRuntime.js'
import BrandLogo from './components/BrandLogo.vue'
import { applyDocumentBranding, loadSiteSettings, siteSettings } from './site/siteSettings.js'
import { PROJECT } from './site/projectInfo.js'
import { currentUser, isAdmin, loadCurrentUser, logout } from './auth/authStore.js'
const CampusPlanEditor = defineAsyncComponent(() => import('./editor/CampusPlanEditor.vue'))
const IndoorFloorPlanEditor = defineAsyncComponent(() => import('./components/IndoorFloorPlanEditor.vue'))
const BuildingTemplateWorkshop = defineAsyncComponent(() => import('./components/BuildingTemplateWorkshop.vue'))
const AssetTemplateLab = defineAsyncComponent(() => import('./components/AssetTemplateLab.vue'))
const WorldSandboxMvp = defineAsyncComponent(() => import('./components/WorldSandboxMvp.vue'))
const AuthLoginPage = defineAsyncComponent(() => import('./components/AuthLoginPage.vue'))
const AuthJoinPage = defineAsyncComponent(() => import('./components/AuthJoinPage.vue'))
const AuthChangePasswordPage = defineAsyncComponent(() => import('./components/AuthChangePasswordPage.vue'))
const AdminConsolePage = defineAsyncComponent(() => import('./components/AdminConsolePage.vue'))
const currentRoute = window.location.pathname.replace(/\/+$/, '')
const isAssetTemplateLabRoute = currentRoute === '/asset-template-lab'
const isAssetWorkshopRoute = currentRoute === '/asset-workshop'
const isSandboxRoute = currentRoute === '/sandbox' || currentRoute === '/world-sandbox-mvp'
const isLoginRoute = currentRoute === '/login'
const isJoinRoute = currentRoute === '/join'
const isChangePasswordRoute = currentRoute === '/change-password'
const isAdminRoute = currentRoute === '/admin'
const isAuthPageRoute = isLoginRoute || isJoinRoute || isChangePasswordRoute
// 不同入口共用同一个 index.html，标题和描述随当前页面与站点设置切换。
applyDocumentBranding()
const BuildingFootprintEditor = defineAsyncComponent(() => import('./components/BuildingFootprintEditor.vue'))
import { loadCampusSceneData } from './three/scene/loadCampusSceneData.js'
import { createSceneDocument } from './three/scene/sceneDocument.js'
import { CAMPUS_BUILDING_FOOTPRINTS } from './data/campus/campusLayout.js'
import { expandIndoorBuilding } from './three/indoor/indoorBuildingDefinitions.js'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID || 'map-editor-local'

// 站点品牌配置：先按默认值渲染，再异步读取后端（失败则读本地缓存）并应用标题、meta 与 favicon。
loadSiteSettings({ apiBase: API_BASE }).catch(error => console.warn('[SiteSettings] 读取站点配置失败', error))

// 路由级访问控制：沙盒需要登录；改密页需要先登录。
loadCurrentUser().then(user => {
  const next = encodeURIComponent(currentRoute + window.location.search)
  if (isSandboxRoute && !user) window.location.replace('/login?next=' + next)
  if (isChangePasswordRoute && !user) window.location.replace('/login?next=' + next)
})

const viewport = ref(null)
const appShell = ref(null)
const isMobile = ref(false)
const isPortrait = ref(false)
const activeMode = ref('overview')
const loading = ref(true)
const errorMessage = ref('')
const engineReady = ref(false)
const indoorPrototypeActive = ref(false)
const indoorFloor = ref(1)
const indoorFloors = ref([1])
const indoorBuildingName = ref('室内空间样板')
const nearIndoorStairs = ref(false)
const nearIndoorRoom = ref(null)
const activeIndoorRoom = ref(null)
const indoorPrompt = ref(null)
const initialUrlParams = new URLSearchParams(window.location.search)
const requestedBuildingId = initialUrlParams.get('buildingId')
const selectedBuildingId = ref(CAMPUS_BUILDING_FOOTPRINTS.some(item => item.id === requestedBuildingId) ? requestedBuildingId : (CAMPUS_BUILDING_FOOTPRINTS[0]?.id || ''))
const indoorFloorCount = ref(3)
const indoorEntryBusy = ref(false)
const indoorEditorOpen = ref(false)
const indoorDefinition = ref(null)
const indoorEditorMessage = ref('')
const indoorLayoutRevision = ref(0)
const indoorLayoutSaving = ref(false)
const indoorLayoutVersions = ref([])
const indoorHistoryOpen = ref(false)
const activeEditableFloor = computed(() => indoorDefinition.value?.floors?.find(floor => floor.level === indoorFloor.value) || null)
const indoorBuildingId = computed(() => indoorDefinition.value?.id || selectedBuildingId.value)
const initialView = new URLSearchParams(window.location.search).get('view')
// 旧的地图编辑器路由已废弃：编辑统一走 /world-sandbox-mvp
if (window.location.pathname.replace(/\/+$/, '') === '/editor' || initialView === 'editor') {
  window.location.replace('/world-sandbox-mvp')
}
const isEditorRoute = false
const isCampusExplorer = !isEditorRoute
const showEditor = ref(isEditorRoute)
const editorViewMode = ref('2d')
const viewMode = ref('2.5d')
const selectedObject = ref(null)
const sceneDocument = ref(null)
const sceneRevision = ref(0)
const sceneSource = ref(null)
const sceneSaving = ref(false)
const sceneSaveMessage = ref('')
const selectedSceneObject = computed(() => sceneDocument.value?.objects?.find((item) => item.id === selectedObject.value?.sceneObjectId) || null)
const campusPlanDocument = ref(null)

let engine

const modes = computed(() => [
  { id: 'overview', label: '总览', hint: '全景地图' },
  { id: 'thirdPerson', label: '跟随', hint: '跟随角色' },
  ...(viewMode.value === '3d' ? [{ id: 'firstPerson', label: '第一人称', hint: '沉浸漫游' }] : []),
])

function adjacentIndoorFloor(direction) {
  const levels = [...indoorFloors.value].sort((a, b) => a - b)
  const index = levels.indexOf(indoorFloor.value)
  return levels[index + direction]
}

function openSelectedBuildingInCampus() {
  if (!selectedBuildingId.value) return
  // 室内建筑入口只传递建筑 ID；校园探索始终使用统一的 campus 场景，不再依赖旧 showcase 查询参数。
  const url = new URL(window.location.href)
  url.searchParams.delete('view')
  url.searchParams.set('buildingId', selectedBuildingId.value)
  url.searchParams.delete('returnX')
  url.searchParams.delete('returnY')
  window.location.assign(url)
}

async function enterSelectedBuilding() {
  if (!selectedBuildingId.value || indoorEntryBusy.value || !engine) return
  indoorEntryBusy.value = true
  try {
    const buildingId = selectedBuildingId.value
    const building = CAMPUS_BUILDING_FOOTPRINTS.find(item => item.id === buildingId)
    const cacheKey = 'ncgxy-indoor-layout:' + buildingId + ':v1'
    const stored = localStorage.getItem(cacheKey)
    let saved = stored ? JSON.parse(stored) : null
    indoorLayoutRevision.value = 0
    if (sceneDocument.value?.campusId && sceneDocument.value?.mapId && sceneSource.value === 'postgis') {
      try {
        const response = await fetch(API_BASE + '/campuses/' + sceneDocument.value.campusId + '/maps/' + sceneDocument.value.mapId + '/scene/indoor-buildings/' + encodeURIComponent(buildingId), { headers: { 'X-Dev-User-Id': DEV_USER_ID } })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.message || '读取室内布局失败：HTTP ' + response.status)
        indoorLayoutRevision.value = Number(payload.revision || 0)
        if (payload.definition) saved = payload.definition
      } catch (error) {
        indoorEditorMessage.value = '服务端读取失败，已回退本地缓存：' + (error.message || '网络异常')
      }
    }
    const opened = engine.enterIndoorBuilding(buildingId, { name: building?.label || buildingId, floors: indoorFloorCount.value, floorsData: saved?.floors, floorHeight: saved?.floorHeight })
    if (opened) {
      indoorDefinition.value = engine.getIndoorBuildingDefinition()
      if (saved) indoorDefinition.value = { ...indoorDefinition.value, ...saved, id: buildingId }
      indoorDefinition.value.exterior ||= { roofStyle: 'flat' }
      engine.updateIndoorBuildingDefinition(indoorDefinition.value)
      indoorEditorOpen.value = false
      indoorEditorMessage.value = indoorLayoutRevision.value > 0 ? '已加载服务端布局 · 版本 ' + indoorLayoutRevision.value : saved ? '已加载本地缓存布局' : '已根据校园建筑占地生成初始模板'
    }
    if (!opened) errorMessage.value = '未能定位该建筑模型，请先加载校园真实底图场景'
  } catch (error) {
    errorMessage.value = error?.message || '室内空间生成失败'
  } finally {
    indoorEntryBusy.value = false
  }
}

function ensureIndoorDefinition() {
  if (indoorDefinition.value) return indoorDefinition.value
  indoorDefinition.value = engine?.getIndoorBuildingDefinition?.() || null
  return indoorDefinition.value
}

function expandCurrentBuilding(side) {
  if (!indoorDefinition.value) return
  try {
    indoorDefinition.value = expandIndoorBuilding(indoorDefinition.value, { side, amount: 2 })
    engine?.updateIndoorBuildingDefinition(indoorDefinition.value)
    indoorEditorMessage.value = '占地边界已向' + ({ north: '北', south: '南', east: '东', west: '西' }[side]) + '侧扩建 2 个场景单位；请检查布局后保存'
    indoorFloors.value = indoorDefinition.value.floors.map(floor => floor.level).sort((a,b) => a-b)
  } catch (error) {
    indoorEditorMessage.value = error?.message || '建筑扩建失败'
  }
}

function updateBuildingHeight() {
  const definition = indoorDefinition.value
  if (!definition) return
  definition.floorHeight = Math.max(2.8, Math.min(6, Number(definition.floorHeight) || 3.6))
  definition.floors.forEach(floor => { floor.wallHeight = definition.floorHeight - 0.45 })
  refreshIndoorLayout()
}

function refreshIndoorLayout() {
  try { engine?.updateIndoorBuildingDefinition(indoorDefinition.value); indoorFloors.value = indoorDefinition.value.floors.map(floor => floor.level).sort((a,b) => a-b); indoorEditorMessage.value = '建筑几何与室内布局已同步，记得保存' }
  catch (error) { indoorEditorMessage.value = error?.message || '布局校验失败' }
}

function addIndoorRoom() {
  const floor = activeEditableFloor.value; if (!floor) return
  const index = floor.rooms.length + 1
  floor.rooms.push({ id: indoorDefinition.value.id + '-' + floor.level + '-room-' + Date.now(), name: '新空间 ' + index, x: 0, z: -floor.depth / 2 + 4, width: Math.min(5, floor.width - 2), depth: Math.min(4, floor.depth / 2), doorWall: 'south', doorWidth: 1.2, furniture: [] })
  refreshIndoorLayout()
}

function removeIndoorRoom(roomId) { const floor = activeEditableFloor.value; if (!floor) return; floor.rooms = floor.rooms.filter(room => room.id !== roomId); refreshIndoorLayout() }

function addIndoorFloor() {
  const definition = indoorDefinition.value; if (!definition || definition.floors.length >= 30) return
  const level = Math.max(...definition.floors.map(floor => floor.level)) + 1; const source = definition.floors[0]
  const next = JSON.parse(JSON.stringify(source)); next.level = level; next.doors = []; next.rooms = next.rooms.map((room,index) => ({ ...room, id: definition.id + '-' + level + '-room-' + (index+1), name: room.name.replace(/\\d+/g, String(level)) }))
  definition.floors.push(next); indoorFloors.value = definition.floors.map(floor => floor.level).sort((a,b) => a-b); engine?.updateIndoorBuildingDefinition(definition); engine?.switchIndoorFloor(level)
}

function removeIndoorFloor() {
  const definition = indoorDefinition.value; if (!definition || definition.floors.length <= 1) return
  definition.floors = definition.floors.filter(floor => floor.level !== indoorFloor.value); indoorFloors.value = definition.floors.map(floor => floor.level).sort((a,b) => a-b)
  engine?.updateIndoorBuildingDefinition(definition); engine?.switchIndoorFloor(indoorFloors.value[0])
}

async function saveIndoorLayout() {
  if (!indoorDefinition.value || indoorLayoutSaving.value) return
  const definition = JSON.parse(JSON.stringify(indoorDefinition.value))
  const cacheKey = 'ncgxy-indoor-layout:' + definition.id + ':v1'
  indoorLayoutSaving.value = true
  try {
    if (sceneDocument.value?.campusId && sceneDocument.value?.mapId && sceneSource.value === 'postgis') {
      const response = await fetch(API_BASE + '/campuses/' + sceneDocument.value.campusId + '/maps/' + sceneDocument.value.mapId + '/scene/indoor-buildings/' + encodeURIComponent(definition.id), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID }, body: JSON.stringify({ revision: indoorLayoutRevision.value, definition }) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 409) throw new Error('版本冲突：服务端当前版本为 ' + (payload.currentRevision ?? '未知') + '，请重新加载后再保存')
        throw new Error(payload.message || '保存失败：HTTP ' + response.status)
      }
      indoorLayoutRevision.value = Number(payload.revision || indoorLayoutRevision.value + 1)
      localStorage.setItem(cacheKey, JSON.stringify(payload.definition || definition))
      indoorEditorMessage.value = '已保存到服务器 · 版本 ' + indoorLayoutRevision.value
    } else {
      localStorage.setItem(cacheKey, JSON.stringify(definition))
      indoorEditorMessage.value = '当前未连接正式地图服务，已保存到本地浏览器'
    }
  } catch (error) {
    indoorEditorMessage.value = error?.message || '保存失败'
  } finally {
    indoorLayoutSaving.value = false
  }
}

async function loadIndoorLayoutVersions() {
  if (!sceneDocument.value?.campusId || !sceneDocument.value?.mapId || sceneSource.value !== 'postgis' || !indoorDefinition.value) {
    indoorEditorMessage.value = '历史版本需要连接正式地图服务'
    return
  }
  try {
    const path = API_BASE + '/campuses/' + sceneDocument.value.campusId + '/maps/' + sceneDocument.value.mapId + '/scene/indoor-buildings/' + encodeURIComponent(indoorDefinition.value.id) + '/versions'
    const response = await fetch(path, { headers: { 'X-Dev-User-Id': DEV_USER_ID } })
    const payload = await response.json().catch(() => [])
    if (!response.ok) throw new Error(payload.message || '读取历史版本失败')
    indoorLayoutVersions.value = Array.isArray(payload) ? payload : []
    indoorHistoryOpen.value = true
  } catch (error) {
    indoorEditorMessage.value = error?.message || '读取历史版本失败'
  }
}

async function restoreIndoorLayoutVersion(revision) {
  if (!indoorDefinition.value || indoorLayoutSaving.value) return
  try {
    const path = API_BASE + '/campuses/' + sceneDocument.value.campusId + '/maps/' + sceneDocument.value.mapId + '/scene/indoor-buildings/' + encodeURIComponent(indoorDefinition.value.id) + '/versions/' + revision
    const response = await fetch(path, { headers: { 'X-Dev-User-Id': DEV_USER_ID } })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.definition) throw new Error(payload.message || '历史版本读取失败')
    indoorDefinition.value = payload.definition
    engine?.updateIndoorBuildingDefinition(indoorDefinition.value)
    indoorFloors.value = indoorDefinition.value.floors.map(floor => floor.level).sort((a,b) => a-b)
    indoorEditorMessage.value = '已载入历史版本，正在以新版本号保存…'
    await saveIndoorLayout()
    await loadIndoorLayoutVersions()
  } catch (error) {
    indoorEditorMessage.value = error?.message || '历史版本恢复失败'
  }
}

function switchIndoorFloor(direction) {
  const target = adjacentIndoorFloor(direction)
  if (target !== undefined) engine?.switchIndoorFloor(target)
}

async function switchMode(mode) {
  if (mode === 'firstPerson' && viewMode.value !== '3d') return
  activeMode.value = mode
  engine?.setMode(mode)
  if (isMobile.value && mode !== 'overview') {
    try {
      if (!document.fullscreenElement && appShell.value?.requestFullscreen) await appShell.value.requestFullscreen()
    } catch { /* 全屏被拒绝时继续普通网页模式 */ }
    try { await screen.orientation?.lock?.('landscape') } catch { /* 部分移动浏览器不支持网页锁定方向 */ }
  } else if (mode === 'overview') {
    try { screen.orientation?.unlock?.() } catch { /* 忽略不支持的环境 */ }
    if (document.fullscreenElement) { try { await document.exitFullscreen() } catch { /* 忽略 */ } }
  }
}

async function loadSceneData() {
  const headers = { 'X-Dev-User-Id': DEV_USER_ID }
  const get = async (path) => {
    const response = await fetch(`${API_BASE}${path}`, { headers })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.message || `地图服务请求失败：HTTP ${response.status}`)
    return payload
  }
  const campuses = await get('/campuses')
  const campus = campuses.find((item) => item.slug === 'ncgxy')
  if (!campus) throw new Error('地图服务中尚未初始化南昌工学院校园')
  const maps = await get(`/campuses/${campus.id}/maps`)
  const map = maps.find((item) => item.slug === 'main') || maps[0]
  if (!map) throw new Error('当前校园尚未创建地图')
  const loaded = await loadCampusSceneData({ campusId: campus.id, map, userId: DEV_USER_ID })
  sceneRevision.value = loaded.revision
  sceneSource.value = loaded.source
  sceneDocument.value = loaded.document || createSceneDocument({ campusId: String(campus.id), mapId: String(map.id), name: `${campus.name} · ${map.name}` })
  sceneDocument.value.campusId = String(campus.id)
  sceneDocument.value.mapId = String(map.id)
  if (!loaded.document) sceneDocument.value.objects = loaded.objects.map((item) => item.sceneObject)
  return loaded
}

async function saveSceneProperties() {
  if (!sceneDocument.value || sceneSource.value !== 'postgis' || !selectedSceneObject.value) return
  sceneSaving.value = true
  sceneSaveMessage.value = ''
  try {
    const response = await fetch(`${API_BASE}/campuses/${sceneDocument.value.campusId}/maps/${sceneDocument.value.mapId}/scene`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID },
      body: JSON.stringify({ revision: sceneRevision.value, document: sceneDocument.value }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      if (response.status === 409) throw new Error('场景版本冲突：其他编辑已先行保存，请重新加载场景后再修改')
      throw new Error(payload.message || `保存失败：HTTP ${response.status}`)
    }
    sceneRevision.value = Number(payload.revision ?? payload.document?.revision ?? sceneRevision.value + 1)
    sceneDocument.value = payload.document || { ...sceneDocument.value, revision: sceneRevision.value }
    engine?.updateSceneObject(selectedSceneObject.value)
    sceneSaveMessage.value = '三维属性已保存'
  } catch (error) {
    sceneSaveMessage.value = error.message || '保存失败'
  } finally {
    sceneSaving.value = false
  }
}

function setMoveKey(key, pressed) { engine?.setVirtualKey(key, pressed) }
function updateViewportState() {
  isMobile.value = window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 760
  isPortrait.value = window.innerHeight > window.innerWidth
}

function onExplorerHotkey(event) {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.target
  if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))) return
  if (event.key.toLowerCase() !== 'v' || viewMode.value !== '3d' || activeMode.value === 'overview') return
  event.preventDefault()
  switchMode(activeMode.value === 'firstPerson' ? 'thirdPerson' : 'firstPerson')
}

async function handleLogout() {
  await logout()
  window.location.assign('/login')
}

function focusCampus() {
  engine?.resetView()
}

function openAssetWorkshop() {
  window.location.assign('/asset-workshop')
}

// 首页的「编辑世界」入口：统一进入世界沙盒（旧地图编辑器已废弃）。
function openSandboxEditor() {
  window.location.assign('/world-sandbox-mvp')
}

// 首页基本信息：发布世界的模型数、地块数与发布时间。
const publishedInfo = ref(null)
const helpOpen = ref(false)

function formatPublishedAt(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function openBuildingFromPixelMap(payload) {
  const buildingId = payload?.buildingId
  if (!(campusPlanDocument.value?.buildings || CAMPUS_BUILDING_FOOTPRINTS).some(item => item.id === buildingId)) return
  const url = new URL(window.location.href)
  url.searchParams.set('view', 'showcase')
  url.searchParams.set('buildingId', buildingId)
  if (Number.isFinite(payload?.playerPosition?.x) && Number.isFinite(payload?.playerPosition?.y)) {
    url.searchParams.set('returnX', String(payload.playerPosition.x))
    url.searchParams.set('returnY', String(payload.playerPosition.y))
  }
  window.location.assign(url)
}

function openEditor() {
  showEditor.value = true
  editorViewMode.value = '2d'
  const url = new URL(window.location.href)
  url.pathname = '/editor'
  url.searchParams.delete('view')
  window.history.pushState({}, '', url)
}

function switchViewMode(mode) {
  if (!['2.5d', '3d'].includes(mode)) return
  // 从 3D 第一人称切回 2.5D 时，先回到角色跟随，避免 2.5D 继续保留透视第一人称。
  if (mode === '2.5d' && activeMode.value === 'firstPerson') {
    activeMode.value = 'thirdPerson'
    engine?.setMode('thirdPerson')
  }
  viewMode.value = mode
  engine?.setViewMode(mode)
}

function switchEditorView(mode, document) {
  editorViewMode.value = mode
  if (mode === '3d') {
    activeMode.value = 'overview'
    viewMode.value = '3d'
    // 先挂载编辑器预览并标记预览态，再切换相机；避免为编辑器预览额外加载整套基础校园 GLB。
    engine?.previewCampusPlan(document)
    engine?.setViewMode('3d')
  } else engine?.clearRpgPreview()
}

async function closeEditor() {
  // 编辑器在 emit close 前已完成最终保存；整页重载可同步刷新空间文档、模板清单、渲染网格与碰撞数据。
  const url = new URL(window.location.href)
  url.pathname = '/'
  url.searchParams.delete('view')
  url.searchParams.delete('buildingId')
  url.searchParams.delete('returnX')
  url.searchParams.delete('returnY')
  window.location.replace(url.toString())
}

function toggleHelp() {
  helpOpen.value = !helpOpen.value
}

async function loadHomepagePlanDocument() {
  try {
    const headers = { 'X-Dev-User-Id': DEV_USER_ID }
    const request = async (path) => {
      const response = await fetch(`${API_BASE}${path}`, { headers })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || `地图服务请求失败：HTTP ${response.status}`)
      return payload
    }
    const campuses = await request('/campuses')
    const campus = campuses.find((item) => item.slug === 'ncgxy')
    if (!campus) return
    const maps = await request(`/campuses/${campus.id}/maps`)
    const map = maps.find((item) => item.slug === 'main') || maps[0]
    if (!map) return
    // 编辑器持久化依赖这两个服务端标识；即使编辑文档尚不存在，也必须先初始化 ID。
    // 否则 CampusPlanEditor 会一直处于 documentLoaded=false，自动保存监听和手动保存都会被禁用。
    sceneDocument.value = {
      ...(sceneDocument.value || {}),
      campusId: String(campus.id),
      mapId: String(map.id),
    }
    const saved = await request(`/campuses/${campus.id}/maps/${map.id}/scene/plan`)
    if (saved.document?.coordinateSystem === 'campus-plan-pixel') campusPlanDocument.value = saved.document
  } catch (error) {
    console.warn('[CampusPlan] 首页未能读取编辑器文档，暂用基础空间数据：', error.message)
  }
}

async function handleBrowserNavigation() {
  const route = window.location.pathname.replace(/\/+$/, '') || '/'
  const queryView = new URLSearchParams(window.location.search).get('view')
  // 旧地图编辑器已废弃，浏览历史回到 /editor 时同样转到世界沙盒
  if (route === '/editor' || queryView === 'editor') {
    window.location.replace('/world-sandbox-mvp')
    return
  }

  if (showEditor.value) await loadHomepagePlanDocument()
  engine?.exitIndoorPrototype()
  engine?.clearRpgPreview()
  showEditor.value = false
  editorViewMode.value = '2d'
  activeMode.value = 'overview'
  viewMode.value = '2.5d'
  engine?.setViewMode('2.5d')
  engine?.setMode('overview')
}

// 首页环境：沿用沙盒发布的环境参数（时间、天气、风力、人工照明）
function applyPublishedSandboxEnvironment(snapshot) {
  if (!engine || !snapshot?.environment) return
  const environment = snapshot.environment
  const weather = String(environment.weather || 'clear')
  const intensity = Number(environment.weatherIntensity)
  const wind = Number(environment.wind)
  engine.setEnvironment?.({
    time: Number.isFinite(Number(environment.time)) ? Number(environment.time) : 14,
    weather: environment.weatherEnabled !== false && weather === 'rain' ? 'rain' : 'clear',
    wind: environment.windEnabled === false ? 0 : (Number.isFinite(wind) ? Math.min(1, Math.max(0, wind / 100)) : 0.2),
    windDirection: environment.windDirection,
    artificialLightingEnabled: environment.artificialLightingEnabled !== false,
  })
  const weatherMode = Object.prototype.hasOwnProperty.call(WEATHER_MODES, weather) ? weather : 'clear'
  engine.setWeatherMode?.(weatherMode, Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity / 100)) : 0.5)
}

// 首页发布数据：把沙盒发布快照里的模型恢复到首页场景（只换内容，不动首页交互与相机）
function restorePublishedSandboxModels(snapshot) {
  if (!engine || !Array.isArray(snapshot?.models)) return 0
  const loader = new THREE.ObjectLoader()
  let restored = 0
  for (const item of snapshot.models) {
    try {
      if (!item?.object) continue
      const model = loader.parse(item.object)
      model.name = item.name || model.name || '已发布模型'
      applyTextPlates(THREE, model)
      engine.addSandboxModel(model, {
        name: model.name,
        id: item.id ? String(item.id) : undefined,
        position: { x: model.position.x, y: model.position.y, z: model.position.z },
      })
      restored += 1
    } catch (error) {
      console.warn('[HomepageSnapshot] 恢复发布模型失败', item?.id, error)
    }
  }
  engine.selectSandboxModel?.(null)
  return restored
}

onMounted(async () => {
  // 登录 / 申请 / 改密 / 管理后台不渲染首页视口，不能初始化首页 3D 引擎。
  if (isSandboxRoute || isAssetWorkshopRoute || isAssetTemplateLabRoute || isAuthPageRoute || isAdminRoute) return
  if (!viewport.value) return
  updateViewportState()
  window.addEventListener('resize', updateViewportState)
  window.addEventListener('orientationchange', updateViewportState)
  window.addEventListener('keydown', onExplorerHotkey)
  window.addEventListener('popstate', handleBrowserNavigation)
  window.addEventListener('storage', onHomepagePublishStorage)
  try {
    // 首页 3D 内容全部来自 MVP 发布：世界区块、环境参数与模型都从发布快照恢复；
    // 没有发布数据时使用 MVP 默认空白世界，不再加载任何旧校园内容。
    const publishedSnapshot = await loadGlobalPublishedSnapshot({ apiBase: API_BASE })
    const publishedWorld = publishedSnapshot?.world || null
    const worldBounds = {
      width: Number(publishedWorld?.chunkSize?.width) > 0 ? Number(publishedWorld.chunkSize.width) : 54,
      depth: Number(publishedWorld?.chunkSize?.depth) > 0 ? Number(publishedWorld.chunkSize.depth) : 42,
    }
    engine = createCampusEngine(viewport.value, {
      onObjectSelected: (object) => { selectedObject.value = object },
      onIndoorPromptChange: (state) => { indoorPrompt.value = state?.visible ? state : null },
      onIndoorStateChange: (state) => {
        indoorPrototypeActive.value = Boolean(state.active)
        if (state.active) {
          indoorFloor.value = state.floor
          indoorFloors.value = state.floors || [state.floor]
          indoorBuildingName.value = state.buildingName || '教学楼'
          if (indoorDefinition.value) indoorDefinition.value.floors = indoorDefinition.value.floors.filter(floor => state.floors.includes(floor.level))
          nearIndoorStairs.value = Boolean(state.nearStairs)
          nearIndoorRoom.value = state.nearRoom || null
          activeIndoorRoom.value = state.activeRoom || null
          if (state.activeRoom) indoorPrompt.value = { visible: true, text: '按 E 返回走廊' }
          else if (state.nearRoom) indoorPrompt.value = { visible: true, text: `按 E 进入 ${state.nearRoom.roomName}` }
          else if (state.nearStairs) indoorPrompt.value = { visible: true, text: '按 E 沿楼梯上下楼' }
          else indoorPrompt.value = null
        } else {
          indoorFloor.value = 1; indoorFloors.value = [1]; nearIndoorStairs.value = false
          indoorEditorOpen.value = false
          nearIndoorRoom.value = null; activeIndoorRoom.value = null; indoorPrompt.value = null
        }
      },
      onReady: () => {
        loading.value = false
        engineReady.value = true
      },
      onError: (error) => {
        errorMessage.value = error?.message || '三维场景初始化失败'
        loading.value = false
      },
    }, { sceneType: 'blank-sandbox', isometricRpg: true, viewMode: viewMode.value, worldBounds })
    await engine.init()
    if (publishedWorld) {
      const restoredWorld = engine.restoreSandboxWorld?.(publishedWorld)
      if (!restoredWorld) console.warn('[HomepageSnapshot] 世界区块恢复失败，保留默认区块')
    }
    if (publishedSnapshot) {
      const restored = restorePublishedSandboxModels(publishedSnapshot)
      console.info('[HomepageSnapshot] 首页已加载发布内容，模型数：' + restored)
      applyPublishedSandboxEnvironment(publishedSnapshot)
      publishedInfo.value = {
        chunks: Array.isArray(publishedWorld?.chunks) ? publishedWorld.chunks.length : 1,
        models: restored,
        publishedAtText: formatPublishedAt(publishedSnapshot.publishedAt || publishedSnapshot.savedAt),
      }
    }
    // 发布世界尺寸可能与默认区块不同，恢复后按实际世界范围重新取景。
    engine.setMode(activeMode.value)
    if (requestedBuildingId && CAMPUS_BUILDING_FOOTPRINTS.some(item => item.id === requestedBuildingId)) await enterSelectedBuilding()
  } catch (error) {
    errorMessage.value = error?.message || '三维场景初始化失败'
    loading.value = false
  }
})

// 另一个标签页发布/清除首页数据时，自动重新加载以渲染最新内容
function onHomepagePublishStorage(event) {
  if (event?.key && event.key !== HOMEPAGE_SNAPSHOT_KEY) return
  window.location.reload()
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewportState)
  window.removeEventListener('orientationchange', updateViewportState)
  window.removeEventListener('keydown', onExplorerHotkey)
  window.removeEventListener('popstate', handleBrowserNavigation)
  window.removeEventListener('storage', onHomepagePublishStorage)
  engine?.dispose()
})
</script>

<template>
  <AuthLoginPage v-if="isLoginRoute" />
  <AuthJoinPage v-else-if="isJoinRoute" />
  <AuthChangePasswordPage v-else-if="isChangePasswordRoute" />
  <AdminConsolePage v-else-if="isAdminRoute" />
  <BuildingTemplateWorkshop v-else-if="isAssetWorkshopRoute" />
  <WorldSandboxMvp v-else-if="isSandboxRoute" />
  <AssetTemplateLab v-else-if="isAssetTemplateLabRoute" />
  <main v-else ref="appShell" :class="['app-shell', { 'is-overview': activeMode === 'overview', 'is-mobile': isMobile, 'is-rpg-sample': isCampusExplorer } ]">
    <div ref="viewport" class="scene-viewport" :style="{ display: showEditor && editorViewMode === '2d' ? 'none' : 'block' }"></div>
    <CampusPlanEditor v-if="showEditor && editorViewMode === '2d'" :campus-id="sceneDocument?.campusId" :map-id="sceneDocument?.mapId" :api-base="API_BASE" :dev-user-id="DEV_USER_ID" @preview="switchEditorView('3d', $event)" @templates-loaded="engine?.setBuildingTemplates($event)" @close="closeEditor" />

    <template v-if="!showEditor || editorViewMode === '3d'">
    <header class="topbar">
      <div class="brand-lockup">
        <BrandLogo class="brand-mark" />
        <div>
          <div class="brand-title">{{ siteSettings.brandName }}</div>
          <div class="brand-subtitle">{{ siteSettings.brandSubtitle }}</div>
        </div>
      </div>
      <div class="showcase-actions">
        <!-- 管理员：成员管理、发布审核与站点设置，不提供模型编辑入口 -->
        <template v-if="isAdmin">
          <a class="showcase-back admin-entry" href="/admin">成员管理</a>
          <a class="showcase-back settings-entry" href="/admin?view=settings" aria-label="站点设置" title="站点设置">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3 5h9M16 5h1M3 10h3M10 10h7M3 15h11M18 15h-1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              <circle cx="14" cy="5" r="1.8" fill="currentColor" />
              <circle cx="7" cy="10" r="1.8" fill="currentColor" />
              <circle cx="16" cy="15" r="1.8" fill="currentColor" />
            </svg>
          </a>
          <a class="showcase-back account-entry" href="/admin" :title="currentUser.username">
            {{ currentUser.displayName || currentUser.username }}
          </a>
          <button class="showcase-back logout-entry" @click="handleLogout">退出</button>
        </template>
        <!-- 团队成员：沙盒编辑与素材工具 -->
        <template v-else-if="currentUser">
          <button class="showcase-back asset-workshop-entry" @click="openAssetWorkshop">AI 素材工坊</button>
          <button class="showcase-back sandbox-editor-entry" @click="openSandboxEditor">编辑世界</button>
          <a class="showcase-back account-entry" href="/change-password" :title="currentUser.username">
            {{ currentUser.displayName || currentUser.username }}
          </a>
          <button class="showcase-back logout-entry" @click="handleLogout">退出</button>
        </template>
        <!-- 未登录访客：只保留申请加入与登录，不显示任何编辑入口 -->
        <template v-else>
          <a class="showcase-back login-entry" href="/login">登录</a>
          <a class="showcase-back sandbox-editor-entry join-entry" href="/join">申请加入团队</a>
        </template>
        <a class="showcase-back github-star-entry" :href="PROJECT.repoUrl" target="_blank" rel="noreferrer" :title="'在 GitHub 上 Star ' + PROJECT.name">
          <span class="github-star-icon" aria-hidden="true">★</span>
          <span class="github-star-label">Star</span>
        </a>
      </div>
    </header>

    <footer class="world-dock">
      <section class="dock-info">
        <span class="dock-state"><span class="status-dot"></span>{{ publishedInfo ? '已发布世界' : '尚未发布' }}</span>
        <strong class="dock-title">{{ publishedInfo ? '三维世界' : '空白世界' }}</strong>
        <span v-if="publishedInfo" class="dock-meta">
          {{ publishedInfo.chunks }} 个地块，{{ publishedInfo.models }} 个模型<template v-if="publishedInfo.publishedAtText"> · 更新于 {{ publishedInfo.publishedAtText }}</template>
        </span>
        <a v-else-if="!currentUser" class="dock-link" href="/join">申请加入团队，发布你的世界</a>
        <button v-else-if="currentUser.role !== 'admin'" class="dock-link" @click="openSandboxEditor">进入编辑世界，发布你的世界</button>
      </section>
      <div class="dock-controls">
        <div class="dock-group-wrap">
          <span class="dock-group-label">视图</span>
          <nav class="mode-switcher view-mode-switcher" aria-label="展示模式切换">
            <button :class="['mode-button', { active: viewMode === '2.5d' }]" @click="switchViewMode('2.5d')">
              <span class="mode-label">2.5D</span>
            </button>
            <button :class="['mode-button', { active: viewMode === '3d' }]" @click="switchViewMode('3d')">
              <span class="mode-label">3D</span>
            </button>
          </nav>
        </div>
        <div class="dock-group-wrap">
          <span class="dock-group-label">镜头</span>
          <nav class="mode-switcher camera-mode-switcher" aria-label="相机控制模式">
            <button
              v-for="mode in modes"
              :key="mode.id"
              :class="['mode-button', { active: activeMode === mode.id }]"
              @click="switchMode(mode.id)"
            >
              <span class="mode-label">{{ mode.label }}</span>
            </button>
          </nav>
        </div>
        <div class="dock-actions">
          <button class="dock-icon-button dock-help" aria-label="操作说明" @click="toggleHelp">?</button>
          <button class="dock-icon-button dock-reset" aria-label="重置视角" @click="focusCampus">重置</button>
        </div>
      </div>
    </footer>

    <div v-if="isMobile && activeMode !== 'overview'" class="mobile-controls" aria-label="触屏移动控制">
      <div class="virtual-pad">
        <button class="virtual-key key-up" aria-label="向前移动" @pointerdown.prevent="setMoveKey('w', true)" @pointerup="setMoveKey('w', false)" @pointercancel="setMoveKey('w', false)" @pointerleave="setMoveKey('w', false)">▲</button>
        <button class="virtual-key key-left" aria-label="向左移动" @pointerdown.prevent="setMoveKey('a', true)" @pointerup="setMoveKey('a', false)" @pointercancel="setMoveKey('a', false)" @pointerleave="setMoveKey('a', false)">◀</button>
        <button class="virtual-key key-down" aria-label="向后移动" @pointerdown.prevent="setMoveKey('s', true)" @pointerup="setMoveKey('s', false)" @pointercancel="setMoveKey('s', false)" @pointerleave="setMoveKey('s', false)">▼</button>
        <button class="virtual-key key-right" aria-label="向右移动" @pointerdown.prevent="setMoveKey('d', true)" @pointerup="setMoveKey('d', false)" @pointercancel="setMoveKey('d', false)" @pointerleave="setMoveKey('d', false)">▶</button>
      </div>
      <button class="virtual-key sprint-key" aria-label="加速移动" @pointerdown.prevent="setMoveKey('shift', true)" @pointerup="setMoveKey('shift', false)" @pointercancel="setMoveKey('shift', false)" @pointerleave="setMoveKey('shift', false)">加速</button>
      <div v-if="viewMode === '3d'" class="look-hint">滑动右侧区域转动视角</div>
    </div>

    <div v-if="isMobile && activeMode !== 'overview' && isPortrait" class="rotate-device-hint">
      <div class="rotate-icon">↻</div>
      <strong>请将手机横向放置</strong>
      <span>横屏可获得完整世界视野与操作空间</span>
    </div>

    <aside class="control-card" :class="{ 'is-open': helpOpen }">
      <div class="control-heading">
        <span>操作</span>
        <button class="help-toggle" aria-label="关闭操作说明" @click="toggleHelp">×</button>
      </div>
      <div class="help-panel is-visible">
        <template v-if="activeMode === 'overview'">
          <template v-if="viewMode === '2.5d'">
            <div class="control-row"><kbd>鼠标左键 / 右键拖动</kbd><span>平移地图，不会旋转</span></div>
            <div class="control-row"><kbd>滚轮</kbd><span>放大 / 缩小世界</span></div>
            <div v-if="isMobile" class="control-row"><kbd>单指拖动</kbd><span>平移地图</span></div>
            <div v-if="isMobile" class="control-row"><kbd>双指操作</kbd><span>缩放 / 平移地图</span></div>
          </template>
          <template v-else>
            <div class="control-row"><kbd>鼠标左键拖动</kbd><span>旋转观察角度</span></div>
            <div class="control-row"><kbd>鼠标右键 / 中键拖动</kbd><span>平移观察位置</span></div>
            <div class="control-row"><kbd>滚轮</kbd><span>拉近 / 拉远视野</span></div>
            <div v-if="isMobile" class="control-row"><kbd>单指拖动</kbd><span>旋转观察角度</span></div>
            <div v-if="isMobile" class="control-row"><kbd>双指操作</kbd><span>缩放 / 平移视野</span></div>
          </template>
          <div class="control-row"><kbd>重置视角</kbd><span>回到初始构图</span></div>
        </template>
        <template v-else-if="activeMode === 'thirdPerson'">
          <div class="control-row"><kbd>W A S D</kbd><span>控制角色移动</span></div>
          <div class="control-row"><kbd>拖动</kbd><span>{{ viewMode === '2.5d' ? '固定斜俯视，不可旋转' : '调整观察角度' }}</span></div>
          <div v-if="viewMode === '3d'" class="control-row"><kbd>V</kbd><span>切换第一/第三人称</span></div>
          <div class="control-row"><kbd>滚轮</kbd><span>调整跟随距离</span></div>
        </template>
        <template v-else>
          <div class="control-row"><kbd>W A S D</kbd><span>前后左右移动</span></div>
          <div class="control-row"><kbd>鼠标</kbd><span>控制视线方向</span></div>
          <div class="control-row"><kbd>Shift</kbd><span>加速移动</span></div>
          <div class="control-row"><kbd>V</kbd><span>切换第一/第三人称</span></div>
          <div class="control-row"><kbd>Esc</kbd><span>退出鼠标控制</span></div>
        </template>
      </div>
      <div class="control-foot">方向以当前镜头朝向为基准</div>
    </aside>

    <div v-if="indoorPrototypeActive" class="indoor-floor-hud"><strong>{{ indoorBuildingName }}</strong><span>{{ indoorFloor }} 楼 · 共 {{ indoorFloors.length }} 层</span><small>靠近楼梯后按 E 上楼或下楼</small><button @click="closeEditor">返回世界</button></div>
    <aside v-if="indoorPrototypeActive && indoorEditorOpen" class="indoor-layout-editor">
      <header><strong>室内空间编辑器</strong><small>建筑 {{ indoorBuildingId }} · {{ indoorFloor }}F</small></header>
      <div class="indoor-editor-actions"><button @click="addIndoorFloor">＋ 增加楼层</button><button :disabled="indoorFloors.length <= 1" @click="removeIndoorFloor">删除当前层</button><button @click="addIndoorRoom">＋ 添加房间</button></div>
      <section class="indoor-footprint-tools">
        <strong>建筑外观与层高</strong>
        <div class="indoor-room-fields">
          <label>层高（米）<input v-model.number="indoorDefinition.floorHeight" type="number" min="2.8" max="6" step="0.1" @change="updateBuildingHeight"></label>
          <label>屋顶样式
            <select v-model="indoorDefinition.exterior.roofStyle" @change="refreshIndoorLayout">
              <option value="flat">现代平屋顶</option>
              <option value="glass">玻璃屋顶</option>
              <option value="pitched">双坡屋顶（规则轮廓）</option>
            </select>
          </label>
        </div>
        <small>当前建筑 {{ indoorDefinition.floors.length }} 层 · 总高度约 {{ (indoorDefinition.floorHeight * indoorDefinition.floors.length).toFixed(1) }} 米；复杂轮廓的双坡顶会安全回退为平顶</small>
      </section>
      <section class="indoor-footprint-tools">
        <strong>建筑占地扩建</strong>
        <small>按校园底图建筑轮廓为基准；每次向指定方向扩展 2 个场景单位</small>
        <div class="indoor-expansion-buttons">
          <button @click="expandCurrentBuilding('north')">北侧＋</button>
          <button @click="expandCurrentBuilding('south')">南侧＋</button>
          <button @click="expandCurrentBuilding('west')">西侧＋</button>
          <button @click="expandCurrentBuilding('east')">东侧＋</button>
        </div>
        <small v-if="indoorDefinition?.footprintSize">当前占地：{{ indoorDefinition.footprintSize.width.toFixed(1) }} × {{ indoorDefinition.footprintSize.depth.toFixed(1) }}</small>
      </section>
      <BuildingFootprintEditor :definition="indoorDefinition" @change="refreshIndoorLayout" />
      <IndoorFloorPlanEditor :floor="activeEditableFloor" @change="refreshIndoorLayout" />
      <div class="indoor-room-list"><section v-for="room in activeEditableFloor?.rooms || []" :key="room.id" class="indoor-room-item">
        <div class="indoor-room-title"><input v-model="room.name" aria-label="房间名称" @change="refreshIndoorLayout"><button @click="removeIndoorRoom(room.id)">删除</button></div>
        <div class="indoor-room-fields"><label>X<input v-model.number="room.x" type="number" step="0.5" @change="refreshIndoorLayout"></label><label>Z<input v-model.number="room.z" type="number" step="0.5" @change="refreshIndoorLayout"></label><label>宽<input v-model.number="room.width" type="number" min="2" step="0.5" @change="refreshIndoorLayout"></label><label>深<input v-model.number="room.depth" type="number" min="2" step="0.5" @change="refreshIndoorLayout"></label></div>
      </section></div><div class="indoor-layout-actions"><button class="indoor-save-layout" :disabled="indoorLayoutSaving" @click="saveIndoorLayout">{{ indoorLayoutSaving ? "保存中…" : "保存室内布局" }}</button><button class="indoor-history-button" @click="loadIndoorLayoutVersions">历史版本</button></div><div v-if="indoorHistoryOpen" class="indoor-history-list"><div v-if="!indoorLayoutVersions.length">暂无历史版本</div><div v-for="version in indoorLayoutVersions" :key="version.revision" class="indoor-history-item"><span>版本 {{ version.revision }} · {{ new Date(version.created_at).toLocaleString() }}</span><button :disabled="indoorLayoutSaving || Number(version.revision) === indoorLayoutRevision" @click="restoreIndoorLayoutVersion(version.revision)">恢复</button></div></div><p>{{ indoorEditorMessage }}</p>
    </aside>
    <div v-if="indoorPrompt" class="indoor-interaction-prompt">{{ indoorPrompt.text }}</div>
    <div v-if="loading" class="loading-screen">
      <div class="loader"></div>
      <div>正在加载世界</div>
      <span>INITIALIZING SCENE</span>
    </div>
    <aside v-if="selectedObject && !showEditor" style="position:absolute;right:24px;top:110px;z-index:12;min-width:190px;padding:14px 16px;background:rgba(255,255,255,.94);border:1px solid #d7ded7;border-radius:6px;color:#34443b;box-shadow:0 8px 24px rgba(30,50,40,.12)">
      <div style="font-size:10px;letter-spacing:1px;color:#7a887e">{{ selectedObject.interaction ? '已选中室内交互对象' : '已选中对象' }}</div>
      <strong style="display:block;margin-top:8px;font-size:13px">{{ selectedObject.name }}</strong>
      <div style="margin-top:7px;font-size:10px;color:#6d7b71">类型：{{ selectedObject.objectType || '未分类' }}</div>
      <template v-if="selectedObject.interaction">
        <div style="margin-top:7px;font-size:10px;color:#6d7b71">所属房间：{{ selectedObject.interaction.roomName }}</div>
        <div style="margin-top:4px;font-size:10px;color:#6d7b71">对象 ID：{{ selectedObject.interaction.id }}</div>
        <div style="margin-top:4px;font-size:10px;color:#6d7b71">交互类型：{{ selectedObject.interaction.interactionType }} · {{ selectedObject.interaction.action }}</div>
        <div style="margin-top:4px;font-size:10px;color:#315f49">操作提示：{{ selectedObject.interaction.operationHint }}</div>
        <p style="margin:9px 0 0;font-size:11px;line-height:1.6;color:#526257">{{ selectedObject.interaction.description }}</p>
      </template>
      <div v-else style="margin-top:4px;font-size:10px;color:#6d7b71">对象 ID：{{ selectedObject.featureId || selectedObject.buildingId || selectedObject.name }}</div>
      <template v-if="selectedSceneObject?.type === 'building'">
        <label style="display:block;margin-top:12px;font-size:10px;color:#6d7b71">建筑楼层</label>
        <input v-model.number="selectedSceneObject.properties.floors" type="number" min="1" max="200" step="1" @change="engine?.updateSceneObject(selectedSceneObject)" style="width:100%;margin-top:5px;padding:6px;border:1px solid #d7ded7;border-radius:4px">
        <label style="display:block;margin-top:9px;font-size:10px;color:#6d7b71">层高（场景单位）</label>
        <input v-model.number="selectedSceneObject.properties.floorHeight" type="number" min="0.1" max="30" step="0.1" @change="engine?.updateSceneObject(selectedSceneObject)" style="width:100%;margin-top:5px;padding:6px;border:1px solid #d7ded7;border-radius:4px">
        <button :disabled="sceneSaving || sceneSource !== 'postgis'" style="width:100%;margin-top:10px;padding:7px 9px;border:1px solid #315f49;background:#315f49;color:white;border-radius:4px;font-size:10px;cursor:pointer" @click="saveSceneProperties">{{ sceneSaving ? '保存中…' : '保存三维属性' }}</button>
        <div v-if="sceneSaveMessage" style="margin-top:7px;font-size:10px;color:#9a6037">{{ sceneSaveMessage }}</div>
      </template>
      <div v-else-if="!selectedObject.interaction" style="margin-top:9px;font-size:10px;color:#7a887e">该类型暂不支持三维属性编辑</div>
      <button style="margin-top:10px;padding:5px 9px;border:1px solid #d7ded7;background:#fff;border-radius:4px;font-size:10px;cursor:pointer" @click="engine?.clearSelection()">取消选择</button>
    </aside>
    <div v-if="errorMessage" class="error-toast">{{ errorMessage }}</div>
    <div v-if="activeMode === 'firstPerson' && engineReady" class="first-person-hint">
      点击场景进入沉浸漫游 · 按 Esc 释放鼠标
    </div>
    </template>
  </main>
</template>
