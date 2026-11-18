import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createCampusEngine } from './createCampusEngine.js'
import { createCapabilityControlDocument } from '../sandbox/capabilityControl.js'
import { createSceneAssetGeneratorRegistry } from '../world/campus/sceneAssetGeneratorRegistry.js'
import { createBuiltinSandboxModel, listBuiltinAssets } from '../sandbox/builtinAssetAdapter.js'
import { createPolylineRoadModel } from '../sandbox/proceduralRoadGenerator.js'
import { getRoadEndpoints, getRoadEdgeStations, getRoadStations, ROAD_CURVE_SUBDIVISIONS } from '../sandbox/roadEndpointMath.js'
import { isPolylineRoadModel } from '../sandbox/roadEndpointMath.js'
import { STATIC_BATCH_ROOT_NAME } from '../sandbox/staticModelBatcher.js'
import { CameraRig } from '../camera/CameraRig.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'

const testHarness = vi.hoisted(() => {
  function createEventTarget() {
    const listeners = new Map()
    const capturedPointers = new Set()
    const entriesFor = type => {
      if (!listeners.has(type)) listeners.set(type, [])
      return listeners.get(type)
    }
    return {
      addEventListener(type, handler, options) {
        if (typeof handler !== 'function') return
        const capture = Boolean(typeof options === 'object' ? options?.capture : options)
        const entries = entriesFor(type)
        if (!entries.some(entry => entry.handler === handler && entry.capture === capture)) {
          entries.push({ handler, capture })
        }
      },
      removeEventListener(type, handler, options) {
        const capture = Boolean(typeof options === 'object' ? options?.capture : options)
        const entries = listeners.get(type)
        if (!entries) return
        const index = entries.findIndex(entry => entry.handler === handler && entry.capture === capture)
        if (index >= 0) entries.splice(index, 1)
      },
      dispatchEvent(event) {
        const entries = [...(listeners.get(event.type) || [])]
        entries.sort((a, b) => Number(b.capture) - Number(a.capture))
        event.preventDefault = event.preventDefault || (() => { event.defaultPrevented = true })
        event.stopPropagation = event.stopPropagation || (() => { event.propagationStopped = true })
        event.stopImmediatePropagation = event.stopImmediatePropagation || (() => {
          event.immediatePropagationStopped = true
        })
        for (const entry of entries) {
          if (event.immediatePropagationStopped) break
          entry.handler(event)
        }
        return !event.defaultPrevented
      },
      listenerCount(type) {
        return listeners.get(type)?.length || 0
      },
      setPointerCapture(pointerId) { capturedPointers.add(pointerId) },
      releasePointerCapture(pointerId) { capturedPointers.delete(pointerId) },
      hasPointerCapture(pointerId) { return capturedPointers.has(pointerId) },
    }
  }
  return { createEventTarget }
})

vi.mock('three', async importOriginal => {
  const actual = await importOriginal()
  class TestWebGLRenderer {
    static active = null
    constructor() {
      TestWebGLRenderer.active = this
      this.domElement = {
        ...testHarness.createEventTarget(),
        width: 800,
        height: 600,
        clientWidth: 800,
        clientHeight: 600,
        style: {},
        isConnected: true,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        remove() {},
      }
      this.shadowMap = {}
      this.info = { render: {}, memory: {} }
    }
    getContext() { return { drawingBufferWidth: 800, drawingBufferHeight: 600 } }
    getPixelRatio() { return 1 }
    setPixelRatio() {}
    setSize(width, height) {
      this.domElement.width = width
      this.domElement.height = height
    }
    dispose() {}
  }
  return { ...actual, WebGLRenderer: TestWebGLRenderer }
})

vi.mock('../camera/CameraRig.js', async () => {
  const THREE = await vi.importActual('three')
  class TestCameraRig {
    static active = null
    constructor() {
      TestCameraRig.active = this
      this.camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.5, 3200)
      this.player = new THREE.Vector3()
      this.currentTarget = new THREE.Vector3()
      this.orbit = { target: new THREE.Vector3() }
      this.mode = 'overview'
      this.viewMode = '2.5d'
      this.overviewSpan = 190
      this.orbitInteractionEnabled = true
    }
    setMode(mode) { this.mode = mode }
    setOrbitInteractionEnabled(enabled) { this.orbitInteractionEnabled = enabled }
    setObstructionObjects() {}
    focusBounds(width, depth) { this.overviewSpan = Math.max(width, depth) }
    resize() {}
    updateFirstPersonDesired() {}
    updateThirdPersonDesired() {}
    dispose() { TestCameraRig.active = null }
  }
  return { CameraRig: TestCameraRig }
})

vi.mock('../controls/InputController.js', () => ({
  InputController: class TestInputController {
    constructor() { this.mode = 'overview'; this.keys = new Set() }
    setPlayerDimensions() {}
    setPhysicsRuntime() {}
    setFreeCameraMovementEnabled() {}
    exitPointerLock() {}
    attach() {}
    setMode(mode) { this.mode = mode }
    setMovementEnabled(enabled) { this.movementEnabled = enabled }
    dispose() {}
  },
}))

vi.mock('three/addons/controls/TransformControls.js', async () => {
  const THREE = await vi.importActual('three')
  class TestTransformControls {
    static active = null
    constructor(camera, domElement) {
      TestTransformControls.active = this
      this.camera = camera
      this.domElement = domElement
      this.helper = new THREE.Object3D()
      this.object = null
      this.mode = null
      this.modes = []
      this.attachments = []
      this.detachCount = 0
      // 忠实模拟 three r180 TransformControls：轴向可见性是布尔属性，
      // 旧版 showX()/hideX() 方法已移除（生产事故 TypeError 的根因）。
      this.showX = true
      this.showY = true
      this.showZ = true
      this.events = new Map()
      this.disposed = false
    }
    setMode(mode) {
      this.mode = mode
      this.modes.push(mode)
    }
    addEventListener(type, handler) {
      if (!this.events.has(type)) this.events.set(type, [])
      this.events.get(type).push(handler)
    }
    dispatchEvent(event) {
      for (const handler of this.events.get(event.type) || []) handler(event)
    }
    attach(object) {
      this.object = object
      this.attachments.push(object)
    }
    detach() {
      this.object = null
      this.detachCount += 1
    }
    getHelper() { return this.helper }
    dispose() { this.disposed = true }
  }
  return { TransformControls: TestTransformControls }
})

const registry = createSceneAssetGeneratorRegistry(THREE)
let engine = null
let onRoadEditChange = null

function getZhiyuanLighting(model) {
  const lights = []
  const tubes = []
  model.traverse(object => {
    if (object.name === 'zhiyuan-light') lights.push(object)
    if (object.name === 'zhiyuan-lamptube') tubes.push(object)
  })
  return { lights, tubes }
}

function createZhiyuanModel() {
  return createBuiltinSandboxModel(THREE, registry, {
    category: 'campus', objectType: 'zhiyuan-building',
  })
}

function createRoad(length) {
  return createBuiltinSandboxModel(THREE, null, {
    category: 'road',
    objectType: 'asphalt-road',
    parameters: { length },
  })
}

async function createCallbackEngine(callbacks) {
  const localEngine = createCampusEngine(
    { clientWidth: 800, clientHeight: 600, appendChild() {} },
    callbacks,
    { sceneType: 'blank-sandbox', worldBounds: { width: 120, depth: 60 } },
  )
  await localEngine.init()
  return localEngine
}

function createBatchableReplacement() {
  const root = new THREE.Group()
  const material = new THREE.MeshStandardMaterial()
  const first = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
  first.position.x = -1
  root.add(first)
  const second = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
  second.position.x = 1
  root.add(second)
  return root
}

function activeDomElement() {
  return TransformControls.active.domElement
}

function orientCameraTopDown() {
  const camera = CameraRig.active.camera
  camera.position.set(0, 100, 0)
  camera.up.set(0, 0, 1)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
}

function orientCameraHorizontal() {
  const camera = CameraRig.active.camera
  camera.position.set(0, 0, 100)
  camera.up.set(0, 1, 0)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
}

function projectToClient(point) {
  const camera = CameraRig.active.camera
  const projected = new THREE.Vector3(point.x, point.y ?? 0, point.z).project(camera)
  return {
    clientX: (projected.x + 1) * 400,
    clientY: (1 - projected.y) * 300,
  }
}

function pointerEvent(type, point, overrides = {}) {
  return {
    type,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    pointerId: 1,
    isPrimary: true,
    ...projectToClient(point),
    ...overrides,
  }
}

function dispatchPointer(type, point, overrides = {}) {
  return activeDomElement().dispatchEvent(pointerEvent(type, point, overrides))
}

function enterRoadEndpointMode(targetEngine = engine) {
  const spy = vi.spyOn(THREE.Scene.prototype, 'add')
  const ok = targetEngine.setSandboxTransformMode('road-endpoints')
  const added = spy.mock.calls.map(call => call[0])
  spy.mockRestore()
  return { ok, editor: added.filter(object => object?.name === '_sandboxRoadEditor').at(-1) || null }
}

function findEditorChild(editor, role) {
  let match = null
  editor.traverse(object => {
    if (object.userData.role === role) match = object
  })
  return match
}

function getEditorHandles(editor) {
  const handles = []
  editor.traverse(object => {
    if (object.userData.editorRole === 'road-edge-handle') handles.push(object)
  })
  return handles.sort((a, b) => (
    a.userData.stationIndex - b.userData.stationIndex
    || String(a.userData.side).localeCompare(String(b.userData.side))
  ))
}

function getEdgeHandle(editor, stationIndex, side) {
  return getEditorHandles(editor).find(handle => (
    handle.userData.stationIndex === stationIndex && handle.userData.side === side
  )) || null
}

function getCenterHandle(editor, stationIndex) {
  let match = null
  editor.traverse(object => {
    if (object.userData.editorRole === 'road-center-handle'
      && object.userData.stationIndex === stationIndex) match = object
  })
  return match
}

function geometryIds(root) {
  const ids = []
  root.traverse(object => {
    if (object.isMesh && object.geometry) ids.push(object.geometry.uuid)
  })
  return ids
}

function editPhases(spy) {
  return spy.mock.calls.map(call => call[0].phase)
}

beforeEach(async () => {
  vi.stubGlobal('window', {
    location: { search: '', hash: '' },
    devicePixelRatio: 1,
    ...testHarness.createEventTarget(),
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  onRoadEditChange = vi.fn()
  const container = { clientWidth: 800, clientHeight: 600, appendChild() {} }
  engine = createCampusEngine(container, { onSandboxRoadEditChange: onRoadEditChange }, {
    sceneType: 'blank-sandbox', worldBounds: { width: 120, depth: 60 },
  })
  await engine.init()
  orientCameraTopDown()
})

afterEach(() => {
  engine?.dispose()
  engine = null
  vi.unstubAllGlobals()
})

describe('共享程序化几何生命周期', () => {
  it('删除一个垃圾桶实例不会释放另一个实例仍引用的缓存几何', () => {
    const createBin = () => createBuiltinSandboxModel(THREE, registry, {
      category: 'facility', objectType: 'bin',
    })
    const firstId = engine.addSandboxModel(createBin())
    const secondId = engine.addSandboxModel(createBin())
    const second = engine.getSandboxModel(secondId)
    const sharedGeometries = new Set()
    second.traverse(object => {
      if (object.name === 'bin-body') sharedGeometries.add(object.geometry)
    })
    expect(sharedGeometries.size).toBeGreaterThan(0)
    const spies = [...sharedGeometries].map(geometry => vi.spyOn(geometry, 'dispose'))

    expect(engine.removeSandboxModel(firstId)).toBe(true)
    expect(spies.every(spy => spy.mock.calls.length === 0)).toBe(true)
  })
})

describe('天气模式引擎接线', () => {
  it('setWeatherMode 切换天气但不覆盖时间与风力', () => {
    engine.setEnvironment({ time: 20, wind: 0.7 })
    const rain = engine.setWeatherMode('rain')
    expect(rain.mode).toBe('rain')
    expect(rain.weather).toBe('rain')
    // 时间与风力保持调用前的值
    expect(rain.time).toBe(20)
    expect(rain.wind).toBe(0.7)
    expect(engine.getWeatherModeState()).toEqual({ mode: 'rain', intensity: 0.5 })
  })

  it('未知模式回退晴天且不抛错', () => {
    const result = engine.setWeatherMode('meteor-strike')
    expect(result.mode).toBe('clear')
    expect(engine.getWeatherModeState().mode).toBe('clear')
  })

  it('阴天/雨/雾携带光照联动系数，晴天强度控制阳光', () => {
    const clearLow = engine.setWeatherMode('clear', 0)
    expect(clearLow.sunScale).toBeCloseTo(0.85)
    expect(clearLow.hemiScale).toBe(1)
    const clearHigh = engine.setWeatherMode('clear', 1)
    expect(clearHigh.sunScale).toBeCloseTo(1.45)
    const overcast = engine.setWeatherMode('overcast')
    expect(overcast.sunScale).toBeLessThan(0.3)
    expect(overcast.hemiScale).toBeGreaterThan(1)
    const fog = engine.setWeatherMode('fog')
    expect(fog.sunScale).toBeLessThan(0.3)
    expect(fog.hemiScale).toBeGreaterThan(1.2)
  })

  it('下雨模式传入强度即自动下雨，强度回传并在状态中保留', () => {
    const rain = engine.setWeatherMode('rain', 1)
    expect(rain.mode).toBe('rain')
    expect(rain.weather).toBe('rain')
    expect(rain.intensity).toBe(1)
    expect(engine.getWeatherModeState()).toEqual({ mode: 'rain', intensity: 1 })

    const lightRain = engine.setWeatherMode('rain', 0.2)
    expect(lightRain.intensity).toBe(0.2)
  })

  it('下雪模式打开雪场，晴天关闭；云量随模式与强度变化', () => {
    engine.setWeatherMode('snow')
    expect(engine.getWeatherModeState().mode).toBe('snow')
    // 晴天强度 0 → 云量 4，强度 1 → 云量 10
    const clearLow = engine.setWeatherMode('clear', 0)
    expect(clearLow.cloudiness).toBe(4)
    const clearHigh = engine.setWeatherMode('clear', 1)
    expect(clearHigh.cloudiness).toBe(10)
  })
})

describe('玩家角色存档往返', () => {
  it('外部角色可序列化并在新引擎中恢复，默认角色序列化为 null', async () => {
    expect(engine.serializePlayerCharacter()).toBeNull()

    const model = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.4), new THREE.MeshBasicMaterial())
    body.name = 'player-body'
    model.add(body)
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), new THREE.MeshBasicMaterial())
    leg.name = 'player-left-leg'
    leg.position.set(-0.2, 0.35, 0)
    model.add(leg)

    const info = engine.setPlayerCharacterModel(model, [], { assetId: 'saved-player', prompt: '测试角色' })
    expect(info.hasExternalModel).toBe(true)
    const snapshot = engine.serializePlayerCharacter()
    expect(snapshot).toBeTruthy()
    expect(snapshot.assetId).toBe('saved-player')
    expect(snapshot.prompt).toBe('测试角色')

    const target = await createCallbackEngine({})
    try {
      const restored = target.restorePlayerCharacterFromSnapshot(snapshot)
      expect(restored?.assetId).toBe('saved-player')
      expect(restored?.hasExternalModel).toBe(true)
      expect(target.getPlayerCharacterInfo()?.assetId).toBe('saved-player')
      // 恢复后的角色仍按原始模型重建，不叠加已绑定的骨架部件
      expect(restored?.dimensions?.height).toBeGreaterThan(1)
    } finally {
      target.dispose()
    }
  })

  it('缺少角色的存档恢复时保持默认角色', async () => {
    expect(engine.serializePlayerCharacter()).toBeNull()
    expect(engine.restorePlayerCharacterFromSnapshot(null)).toBeNull()
    expect(engine.getPlayerCharacterInfo()?.assetId).toBe('builtin-placeholder')
  })

  it('人物预设可切换，并按目标身高微调', async () => {
    const info = engine.setPlayerCharacterPreset('female')
    expect(info?.hasExternalModel).toBe(true)
    expect(info?.assetId).toBe('preset:female')
    expect(info?.dimensions?.height).toBeCloseTo(1.8, 1)
    expect(engine.getPlayerCharacterPresetState()).toMatchObject({ presetId: 'female', gender: 'female' })

    const resized = engine.setPlayerCharacterHeight(1.6)
    expect(resized?.dimensions?.height).toBeCloseTo(1.6, 1)
    expect(engine.getPlayerCharacterPresetState()).toMatchObject({ presetId: 'female', targetHeight: 1.6 })

    // 身高夹取在 1.4–2.6
    const clamped = engine.setPlayerCharacterHeight(9)
    expect(clamped?.dimensions?.height).toBeCloseTo(2.6, 1)

    engine.restorePlayerCharacterFallback()
    expect(engine.getPlayerCharacterPresetState().presetId).toBeNull()
  })

  it('未知预设不生效', () => {
    expect(engine.setPlayerCharacterPreset('nope')).toBeNull()
    expect(engine.getPlayerCharacterInfo()?.assetId).toBe('builtin-placeholder')
  })

  it('性别切换只作用于内置人物预设，状态可查询', () => {
    expect(engine.setPlayerCharacterGender('female')).toBeNull()

    const info = engine.setPlayerCharacterPreset('female')
    expect(info?.hasExternalModel).toBe(true)
    expect(engine.getPlayerCharacterPresetState()).toMatchObject({ presetId: 'female', gender: 'female' })

    const male = engine.setPlayerCharacterGender('male')
    expect(male?.hasExternalModel).toBe(true)
    expect(engine.getPlayerCharacterPresetState()).toMatchObject({ presetId: 'female', gender: 'male' })

    engine.restorePlayerCharacterFallback()
    expect(engine.getPlayerCharacterPresetState().gender).toBe('male')
  })
})

describe('地块管理中的 + 单块扩建标记', () => {
  it('开启地块管理时初始单地块四邻各一个 +，关闭后移除', () => {
    expect(engine.getSandboxExpandMarkers()).toEqual([])
    expect(engine.setSandboxChunkManagement(true)).toBe(true)
    const markers = engine.getSandboxExpandMarkers()
    expect(markers).toHaveLength(4)
    expect(markers.map(marker => marker.chunk.x + ':' + marker.chunk.z).sort())
      .toEqual(['-1:0', '0:-1', '0:1', '1:0'])
    expect(markers.map(marker => marker.direction).sort()).toEqual(['east', 'north', 'south', 'west'])
    engine.setSandboxChunkManagement(false)
    expect(engine.getSandboxExpandMarkers()).toEqual([])
  })

  it('addSandboxWorldChunk 只添加单块，且新地块补齐自己的 + 标记', () => {
    engine.setSandboxChunkManagement(true)
    const before = engine.getSandboxWorldState()
    expect(before.chunks).toHaveLength(1)
    expect(engine.addSandboxWorldChunk(1, 0)).toBe(true)
    const after = engine.getSandboxWorldState()
    expect(after.chunks).toHaveLength(2)
    expect(after.chunks.some(chunk => chunk.x === 1 && chunk.z === 0)).toBe(true)
    // 两块地块共 6 个空缺邻接：(-1,0) (0,1) (0,-1) (2,0) (1,1) (1,-1)
    const markers = engine.getSandboxExpandMarkers()
    expect(markers).toHaveLength(6)
    const occupied = new Set(after.chunks.map(chunk => chunk.x + ':' + chunk.z))
    for (const marker of markers) {
      expect(occupied.has(marker.chunk.x + ':' + marker.chunk.z)).toBe(false)
    }
    engine.setSandboxChunkManagement(false)
  })

  it('不相邻的地块不能凭空添加', () => {
    expect(engine.addSandboxWorldChunk(5, 5)).toBe(false)
    expect(engine.getSandboxWorldState().chunks).toHaveLength(1)
  })
})

describe('沙盒选址预览环境绑定', () => {
  it('总开关已关闭时，新致远楼进入选址预览就保持灯光关闭', () => {
    engine.setEnvironment({ artificialLightingEnabled: false })
    const model = createZhiyuanModel()
    const { lights, tubes } = getZhiyuanLighting(model)

    expect(engine.beginSandboxModelPlacement(model)).toBe(true)
    expect(lights).toHaveLength(3)
    expect(tubes).toHaveLength(6)
    expect(lights.every(light => light.intensity === 0)).toBe(true)
    expect(tubes.every(tube => tube.visible === false)).toBe(true)
  })

  it('选址过程中切换总开关，当前预览模型同步更新', () => {
    const model = createZhiyuanModel()
    const { lights, tubes } = getZhiyuanLighting(model)
    expect(engine.beginSandboxModelPlacement(model)).toBe(true)

    engine.setEnvironment({ artificialLightingEnabled: false })
    expect(lights.every(light => light.intensity === 0)).toBe(true)
    expect(tubes.every(tube => tube.visible === false)).toBe(true)

    engine.setEnvironment({ artificialLightingEnabled: true })
    expect(lights.every(light => light.intensity === 1.6)).toBe(true)
    expect(tubes.every(tube => tube.visible === true)).toBe(true)
  })
})

describe('重新选址的占地形状', () => {
  it('折线道路的占地轮廓贴合道路形状，并按形状判定冲突', async () => {
    const onPlacementChange = vi.fn()
    const callbackEngine = await createCallbackEngine({ onSandboxPlacementChange: onPlacementChange })
    engine = callbackEngine
    orientCameraTopDown()
    try {
      callbackEngine.addSandboxModel(createBatchableReplacement(), { position: { x: 0, y: 0.5, z: 12 } })
      callbackEngine.beginSandboxRoadDrawing('asphalt-road')
      callbackEngine.addSandboxRoadDrawingPoint(0, 0)
      callbackEngine.addSandboxRoadDrawingPoint(16, 0)
      callbackEngine.addSandboxRoadDrawingPoint(16, 16)
      callbackEngine.finishSandboxRoadDrawing()
      const roadId = callbackEngine.getSandboxModels().at(-1).id

      const spy = vi.spyOn(THREE.Scene.prototype, 'add')
      expect(callbackEngine.beginSandboxModelPlacement(roadId)).toBe(true)
      const added = spy.mock.calls.map(call => call[0])
      spy.mockRestore()
      const footprint = added.find(object => object?.name === 'sandbox-placement-footprint')
      const outline = added.find(object => object?.name === 'sandbox-placement-footprint-outline')
      expect(footprint).toBeTruthy()
      expect(outline).toBeTruthy()

      orientCameraTopDown()
      dispatchPointer('pointermove', { x: 0, y: 0, z: 0 })
      // 不是矩形平面：填充带按道路分段成三角形，轮廓也不是四条边
      expect(footprint.geometry.attributes.position.count).toBeGreaterThan(6)
      expect(outline.geometry.attributes.position.count / 2).toBeGreaterThan(4)
      // 建筑在道路包围盒角落、但不在道路形状上 → 不冲突
      expect(onPlacementChange.mock.calls.at(-1)[0]).toMatchObject({ active: true, blocked: false })

      // 把道路挪到建筑上，形状真正穿过建筑 → 冲突
      dispatchPointer('pointermove', { x: 0, y: 0, z: 12 })
      expect(onPlacementChange.mock.calls.at(-1)[0]).toMatchObject({ blocked: true })
    } finally {
      callbackEngine.dispose()
      engine = null
    }
  })

  it('选中折线道路时选择轮廓贴合道路形状而不是包围盒', () => {
    engine.beginSandboxRoadDrawing('asphalt-road')
    engine.addSandboxRoadDrawingPoint(0, 0)
    engine.addSandboxRoadDrawingPoint(16, 0)
    engine.addSandboxRoadDrawingPoint(16, 16)
    engine.finishSandboxRoadDrawing()
    const roadId = engine.getSandboxModels().at(-1).id

    const spy = vi.spyOn(THREE.Scene.prototype, 'add')
    engine.selectSandboxModel(roadId)
    const added = spy.mock.calls.map(call => call[0])
    spy.mockRestore()
    const outline = added.find(object => object?.name === 'sandbox-selection-outline')
    expect(outline).toBeTruthy()
    expect(outline.geometry.attributes.position.count / 2).toBeGreaterThan(4)
  })
})

describe('占地区域编辑器', () => {
  it('直接给一个矩形区域，添加/删除断点可控（至少保留三个点）', () => {
    expect(engine.beginSandboxFootprintDrawing()).toBe(true)
    const state = engine.getSandboxFootprintDrawingState()
    expect(state).toMatchObject({ active: true, editing: true })
    expect(state.points).toHaveLength(4)
    const xs = state.points.map(point => point.x)
    const zs = state.points.map(point => point.z)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 5)
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(8, 5)

    expect(engine.addSandboxFootprintBreakpoint()).toBe(true)
    const withBreakpoint = engine.getSandboxFootprintDrawingState().points
    expect(withBreakpoint).toHaveLength(5)
    // 断点插在最长边的中点
    let expectedMidpoint = null
    let longest = -1
    for (let index = 0; index < state.points.length; index += 1) {
      const a = state.points[index]
      const b = state.points[(index + 1) % state.points.length]
      const length = Math.hypot(b.x - a.x, b.z - a.z)
      if (length > longest) {
        longest = length
        expectedMidpoint = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
      }
    }
    expect(withBreakpoint[1]).toEqual(expectedMidpoint)
    expect(engine.removeSandboxFootprintBreakpoint()).toBe(true)
    expect(engine.getSandboxFootprintDrawingState().points).toHaveLength(4)

    expect(engine.removeSandboxFootprintBreakpoint()).toBe(true) // 4 → 3
    expect(engine.removeSandboxFootprintBreakpoint()).toBe(false) // 三个点保底
  })

  it('拖顶点只改该点，拖中心整体平移', () => {
    const spy = vi.spyOn(THREE.Scene.prototype, 'add')
    engine.beginSandboxFootprintDrawing()
    const initialPoints = engine.getSandboxFootprintDrawingState().points.map(point => ({ ...point }))
    const preview = spy.mock.calls.map(call => call[0]).find(object => object?.name === 'sandbox-footprint-drawing')
    spy.mockRestore()
    expect(preview).toBeTruthy()

    const collectVertexHandles = () => {
      const handles = []
      preview.traverse(object => {
        if (object.userData?.footprintHandleRole === 'vertex') handles.push(object)
      })
      return handles.sort((a, b) => a.userData.index - b.userData.index)
    }
    const vertexHandles = collectVertexHandles()
    expect(vertexHandles).toHaveLength(4)
    const vertex = vertexHandles[1]
    const start = vertex.getWorldPosition(new THREE.Vector3())
    dispatchPointer('pointerdown', start)
    dispatchPointer('pointermove', { x: start.x + 2, y: 0, z: start.z + 3 })
    dispatchPointer('pointerup', { x: start.x + 2, y: 0, z: start.z + 3 })

    let region = engine.getSandboxFootprintDrawingState()
    expect(region.points[1].x).toBeCloseTo(start.x + 2, 1)
    expect(region.points[1].z).toBeCloseTo(start.z + 3, 1)
    expect(region.points[0]).toEqual(initialPoints[0])

    // 拖动顶点后手柄会重建，重新取中心手柄
    let centerHandle = null
    preview.traverse(object => {
      if (object.userData?.footprintHandleRole === 'center') centerHandle = object
    })
    expect(centerHandle).toBeTruthy()
    const centerStart = centerHandle.getWorldPosition(new THREE.Vector3())
    const before = region.points.map(point => ({ ...point }))
    dispatchPointer('pointerdown', centerStart)
    dispatchPointer('pointermove', { x: centerStart.x + 1.5, y: 0, z: centerStart.z + 1 })
    dispatchPointer('pointerup', { x: centerStart.x + 1.5, y: 0, z: centerStart.z + 1 })
    region = engine.getSandboxFootprintDrawingState()
    before.forEach((point, index) => {
      expect(region.points[index].x).toBeCloseTo(point.x + 1.5, 1)
      expect(region.points[index].z).toBeCloseTo(point.z + 1, 1)
    })
  })

  it('加断点后拖出凹口；轮廓自交时边界标红', () => {
    const spy = vi.spyOn(THREE.Scene.prototype, 'add')
    engine.beginSandboxFootprintDrawing()
    const preview = spy.mock.calls.map(call => call[0]).find(object => object?.name === 'sandbox-footprint-drawing')
    spy.mockRestore()
    engine.addSandboxFootprintBreakpoint()

    let handle = null
    preview.traverse(object => {
      if (object.userData?.footprintHandleRole === 'vertex' && object.userData.index === 1) handle = object
    })
    expect(handle).toBeTruthy()
    const start = handle.getWorldPosition(new THREE.Vector3())
    dispatchPointer('pointerdown', start)
    dispatchPointer('pointermove', { x: start.x, y: 0, z: start.z + 9 })
    dispatchPointer('pointerup', { x: start.x, y: 0, z: start.z + 9 })

    expect(engine.getSandboxFootprintDrawingState().points[1].z).toBeCloseTo(start.z + 9, 1)
    expect(preview.getObjectByName('footprint-boundary').material.color.getHexString()).toBe('e66b68')
  })

  it('点在区域内部拖动也能整体移动', () => {
    engine.beginSandboxFootprintDrawing()
    const before = engine.getSandboxFootprintDrawingState().points.map(point => ({ ...point }))
    const center = {
      x: before.reduce((sum, point) => sum + point.x, 0) / before.length,
      z: before.reduce((sum, point) => sum + point.z, 0) / before.length,
    }
    // 矩形中心偏 (2,1)，在区域内部且避开中心手柄与角点
    dispatchPointer('pointerdown', { x: center.x + 2, y: 0, z: center.z + 1 })
    dispatchPointer('pointermove', { x: center.x + 4, y: 0, z: center.z + 2 })
    dispatchPointer('pointerup', { x: center.x + 4, y: 0, z: center.z + 2 })
    const after = engine.getSandboxFootprintDrawingState().points
    before.forEach((point, index) => {
      expect(after[index].x).toBeCloseTo(point.x + 2, 1)
      expect(after[index].z).toBeCloseTo(point.z + 1, 1)
    })
  })

  it('清除区域会移除多边形预览与手柄', () => {
    const spy = vi.spyOn(THREE.Scene.prototype, 'add')
    engine.beginSandboxFootprintDrawing()
    const preview = spy.mock.calls.map(call => call[0]).find(object => object?.name === 'sandbox-footprint-drawing')
    spy.mockRestore()
    expect(engine.clearSandboxFootprintRegion()).toBe(true)
    expect(engine.getSandboxFootprintDrawingState()).toMatchObject({ active: false, points: [] })
    expect(preview.parent).toBeNull()
  })
})

describe('勾绘占地的摆放预览', () => {
  it('带勾绘多边形占地时，摆放预览按多边形生成并作为冲突探针', () => {
    const model = createBatchableReplacement()
    model.userData.sandboxFootprintPolygon = {
      mode: 'space',
      points: [
        { x: -5, z: -5 }, { x: 5, z: -5 }, { x: 5, z: 0 },
        { x: -2, z: 0 }, { x: -2, z: 5 }, { x: -5, z: 5 },
      ],
    }
    const spy = vi.spyOn(THREE.Scene.prototype, 'add')
    expect(engine.beginSandboxModelPlacement(model)).toBe(true)
    const added = spy.mock.calls.map(call => call[0])
    spy.mockRestore()
    const footprint = added.find(object => object?.name === 'sandbox-placement-footprint')
    const outline = added.find(object => object?.name === 'sandbox-placement-footprint-outline')
    expect(footprint).toBeTruthy()
    expect(outline).toBeTruthy()

    orientCameraTopDown()
    dispatchPointer('pointermove', { x: 0, y: 0, z: 0 })
    // L 形 6 个顶点 → 4 个三角形 → 12 个顶点；矩形平面只有 6 个
    expect(footprint.geometry.attributes.position.count).toBe(12)
    expect(outline.geometry.attributes.position.count / 2).toBe(6)
    footprint.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(footprint)
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(10, 1)
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(10, 1)
  })
})

describe('道路路口拼接面', () => {
  it('两条道路交叠时生成路口面，删掉其中一条后消失', () => {
    const spy = vi.spyOn(THREE.Scene.prototype, 'add')
    const firstId = engine.addSandboxModel(createRoad(20), { position: { x: 0, y: 0, z: 0 } })
    const group = spy.mock.calls.map(call => call[0]).find(object => object?.name === 'sandbox-road-junctions')
    spy.mockRestore()
    expect(firstId).toBeTruthy()
    expect(group).toBeTruthy()
    expect(group.children).toHaveLength(0)

    const secondId = engine.addSandboxModel(createPolylineRoadModel(THREE, {
      objectType: 'asphalt-road',
      width: 4,
      points: [{ x: 0, z: -10 }, { x: 0, z: 10 }],
    }), { position: { x: 0, y: 0, z: 0 } })

    expect(group.children.length).toBeGreaterThan(0)
    expect(group.children[0].name).toBe('road-junction-patch')
    expect(group.children[0].geometry.getAttribute('position').count).toBeGreaterThan(0)

    engine.removeSandboxModel(secondId)
    expect(group.children).toHaveLength(0)
    expect(engine.getSandboxModel(firstId)).toBeTruthy()
  })
})

describe('replaceSandboxModel 提交变换', () => {
  it('道路替换时在挂载、空间登记和合批前应用新 transform，并保留实例状态', async () => {
    const onModelsChange = vi.fn()
    const onModelSelected = vi.fn()
    const callbackEngine = await createCallbackEngine({
      onSandboxModelsChange: onModelsChange,
      onSandboxModelSelected: onModelSelected,
    })
    try {
      const id = callbackEngine.addSandboxModel(createRoad(12), {
        position: { x: 2, y: 0.04, z: 3 },
      })
      const current = callbackEngine.getSandboxModel(id)
      current.rotation.y = 0.7
      current.scale.set(1.1, 1.1, 1.1)
      current.userData.worldState = { roadState: 'keep' }
      current.userData.environmentOverrides = { 'lighting.artificial.enabled': false }

      const replacement = createRoad(30)
      const transform = {
        position: { x: 10, y: 0.04, z: -4 },
        rotation: { x: 0, y: Math.PI / 2, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      }
      expect(callbackEngine.replaceSandboxModel(id, replacement, {
        transform,
        name: '拉伸柏油路',
        userData: { editMarker: 'road-endpoint' },
      })).toBe(true)

      const replaced = callbackEngine.getSandboxModel(id)
      expect(replaced).toBe(replacement)
      expect(replaced.userData.sandboxModelId).toBe(id)
      expect(replaced.userData.isSandboxModel).toBe(true)
      expect(replaced.userData.editMarker).toBe('road-endpoint')
      expect(callbackEngine.getSandboxModelState(id)).toEqual({ roadState: 'keep' })
      expect(replaced.userData.environmentOverrides).toEqual({ 'lighting.artificial.enabled': false })
      expect(onModelsChange).toHaveBeenCalled()
      expect(onModelsChange.mock.calls.at(-1)[0]).toEqual([
        { id, name: '拉伸柏油路', spec: null },
      ])
      expect(onModelSelected.mock.calls.at(-1)[0]).toMatchObject({ id, name: '拉伸柏油路' })

      replaced.updateMatrixWorld(true)
      expect(replaced.getWorldPosition(new THREE.Vector3()).toArray())
        .toEqual([10, 0.04, -4])
      const euler = new THREE.Euler().setFromQuaternion(replaced.getWorldQuaternion(new THREE.Quaternion()))
      expect(euler.y).toBeCloseTo(Math.PI / 2, 6)
      expect(replaced.scale.toArray()).toEqual([1, 1, 1])
      const bounds = new THREE.Box3().setFromObject(replaced)
      expect(bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(6, 6)
      expect(bounds.getSize(new THREE.Vector3()).z).toBeCloseTo(30, 6)
    } finally {
      callbackEngine.dispose()
    }
  })

  it('未传 transform 时完整复制旧模型的 position、rotation 和 scale', async () => {
    const callbackEngine = await createCallbackEngine({})
    try {
      const id = callbackEngine.addSandboxModel(createRoad(12), {
        position: { x: -3, y: 0.08, z: 5 },
      })
      const current = callbackEngine.getSandboxModel(id)
      current.rotation.set(0.2, 0.9, -0.3)
      current.scale.set(1.25, 1.25, 1.25)

      const replacement = createRoad(18)
      expect(callbackEngine.replaceSandboxModel(id, replacement)).toBe(true)

      expect(replacement.position.toArray()).toEqual([-3, 0.08, 5])
      expect(replacement.rotation.toArray().slice(0, 3)).toEqual([0.2, 0.9, -0.3])
      expect(replacement.scale.toArray()).toEqual([1.25, 1.25, 1.25])
    } finally {
      callbackEngine.dispose()
    }
  })

  it('静态合批烘焙使用提交后的 transform，而不是旧根 transform', async () => {
    const callbackEngine = await createCallbackEngine({})
    try {
      const id = callbackEngine.addSandboxModel(createBatchableReplacement(), {
        position: { x: 1, y: 0, z: 1 },
      })
      const replacement = createBatchableReplacement()

      expect(callbackEngine.replaceSandboxModel(id, replacement, {
        transform: {
          position: { x: 5, y: 0, z: -2 },
          rotation: { x: 0, y: Math.PI / 2, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      })).toBe(true)

      expect(replacement.getObjectByName(STATIC_BATCH_ROOT_NAME)).toBeTruthy()
      replacement.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(replacement)
      const center = bounds.getCenter(new THREE.Vector3())
      const size = bounds.getSize(new THREE.Vector3())
      expect(center.toArray()).toEqual([5, 0, -2])
      expect(size.x).toBeCloseTo(1, 6)
      expect(size.z).toBeCloseTo(3, 6)
    } finally {
      callbackEngine.dispose()
    }
  })
})

describe('道路存档恢复', () => {
  it('合批后的道路与普通模型一起序列化后，可在新引擎中完整恢复而不触发整档回滚', async () => {
    const sourceEngine = await createCallbackEngine({})
    try {
      const normalId = sourceEngine.addSandboxModel(createBatchableReplacement(), {
        position: { x: -20, y: 0, z: 0 },
      })
      const roadId = sourceEngine.addSandboxModel(createRoad(12), {
        position: { x: 0, y: 0.04, z: 0 },
      })
      const snapshot = sourceEngine.getSandboxModels().map(({ id, name }) => ({
        id,
        name,
        object: sourceEngine.serializeSandboxModel(id),
      }))

      const restoreEngine = await createCallbackEngine({})
      const registeredIds = []
      try {
        for (const item of snapshot) {
          const model = new THREE.ObjectLoader().parse(item.object)
          model.name = item.name
          const registeredId = restoreEngine.addSandboxModel(model, {
            id: item.id,
            name: item.name,
            position: { x: model.position.x, y: model.position.y, z: model.position.z },
          })
          registeredIds.push(registeredId)
        }

        expect(restoreEngine.getSandboxModels().map(item => item.id).sort()).toEqual([normalId, roadId].sort())
        const restoredRoad = restoreEngine.getSandboxModel(roadId)
        expect(restoredRoad.userData.proceduralRoad).toMatchObject({ length: 12, width: 6 })
        expect(getRoadEndpoints(restoredRoad).map(point => [point.x, point.z])).toEqual([[-6, 0], [6, 0]])
      } catch (error) {
        registeredIds.forEach(id => restoreEngine.removeSandboxModel(id))
        throw error
      } finally {
        restoreEngine.dispose()
      }
    } finally {
      sourceEngine.dispose()
    }
  })
})

describe('内置素材存档恢复诊断', () => {
  it.each(listBuiltinAssets())('$category/$objectType 合批序列化后可在新引擎中恢复', async (item) => {
    const sourceEngine = await createCallbackEngine({})
    let sourceId = null
    try {
      const model = createBuiltinSandboxModel(THREE, registry, item)
      sourceId = sourceEngine.addSandboxModel(model, {
        position: { x: 0, y: 0, z: 0 },
      })
      const serialized = sourceEngine.serializeSandboxModel(sourceId)

      const restoreEngine = await createCallbackEngine({})
      try {
        const restored = new THREE.ObjectLoader().parse(serialized)
        const restoredId = restoreEngine.addSandboxModel(restored, {
          id: sourceId,
          name: item.label,
          position: { x: restored.position.x, y: restored.position.y, z: restored.position.z },
        })
        expect(restoreEngine.getSandboxModel(restoredId)).toBe(restored)
      } finally {
        restoreEngine.dispose()
      }
    } finally {
      sourceEngine.dispose()
    }
  })
})

describe('沙盒存档恢复分支诊断', () => {
  it('世界区块状态可在同规格新引擎中完整恢复', async () => {
    const source = await createCallbackEngine({})
    try {
      const state = source.getSandboxWorldState()
      expect(state).toBeTruthy()
      const target = await createCallbackEngine({})
      try {
        expect(target.restoreSandboxWorld(JSON.parse(JSON.stringify(state)))).toBe(true)
        const chunkKey = item => item.x + ':' + item.z
        expect(target.getSandboxWorldState().chunks.map(chunkKey).sort())
          .toEqual(state.chunks.map(chunkKey).sort())
      } finally {
        target.dispose()
      }
    } finally {
      source.dispose()
    }
  })

  it('区块尺寸不匹配的旧世界快照恢复返回 false，且不注册任何模型', async () => {
    const source = await createCallbackEngine({})
    try {
      const state = source.getSandboxWorldState()
      const stale = JSON.parse(JSON.stringify(state))
      stale.chunkSize = { width: stale.chunkSize.width + 10, depth: stale.chunkSize.depth }
      const target = await createCallbackEngine({})
      try {
        expect(target.restoreSandboxWorld(stale)).toBe(false)
        expect(target.getSandboxModels()).toEqual([])
      } finally {
        target.dispose()
      }
    } finally {
      source.dispose()
    }
  })

  it('空模型快照路径不抛错：引擎保持零模型列表', async () => {
    const target = await createCallbackEngine({})
    try {
      expect(target.getSandboxModels()).toEqual([])
    } finally {
      target.dispose()
    }
  })

  it('visible=false 模型经序列化与 ObjectLoader 恢复后仍在模型列表但保持不可见', async () => {
    const source = await createCallbackEngine({})
    try {
      const model = createBatchableReplacement()
      const id = source.addSandboxModel(model)
      model.visible = false
      const serialized = source.serializeSandboxModel(id)

      const target = await createCallbackEngine({})
      try {
        const restored = new THREE.ObjectLoader().parse(serialized)
        const restoredId = target.addSandboxModel(restored, { id })
        expect(target.getSandboxModel(restoredId)).toBe(restored)
        expect(restored.visible).toBe(false)
      } finally {
        target.dispose()
      }
    } finally {
      source.dispose()
    }
  })

  it('单个模型 add 抛错时引擎不自动回滚；Vue 层全量回滚后模型列表归零', async () => {
    const target = await createCallbackEngine({})
    try {
      const firstId = target.addSandboxModel(createBatchableReplacement())
      const duplicate = createBatchableReplacement()
      expect(() => target.addSandboxModel(duplicate, { id: firstId })).toThrow()
      // 引擎本身不做全有/全无回滚：第一个模型仍然存在
      expect(target.getSandboxModel(firstId)).toBeTruthy()
      // 模拟 restoreSandbox catch 分支对 registeredIds 的逐个移除
      expect(target.removeSandboxModel(firstId)).toBe(true)
      expect(target.getSandboxModels()).toEqual([])
    } finally {
      target.dispose()
    }
  })
})

describe('真实事故存档重放诊断（仅当 SDD 工作区存在 rescue-snapshot.json 时运行）', () => {
  const rescuePath = '.superpowers/sdd/2026-11-13-stretchable-road-assets-plan/rescue-snapshot.json'
  const hasRescue = existsSync(rescuePath)

  it.skipIf(!hasRescue)('按 Vue restoreSandbox 的精确顺序在 54x42 生产规格引擎中重放两条道路', async () => {
    const snapshot = JSON.parse(readFileSync(rescuePath, 'utf8'))
    const target = createCampusEngine(
      { clientWidth: 800, clientHeight: 600, appendChild() {} },
      {},
      { sceneType: 'blank-sandbox', worldBounds: { width: 54, depth: 42 } },
    )
    try {
      await target.init()
      const worldOk = target.restoreSandboxWorld(snapshot.world)
      expect(worldOk).toBe(true)

      const loader = new THREE.ObjectLoader()
      const registeredIds = []
      const failures = []
      for (const item of snapshot.models) {
        try {
          const model = loader.parse(item.object)
          model.name = item.name || model.name || '已保存模型'
          model.userData = {
            ...(model.userData || {}),
            proceduralModelCapabilityControlDocument: model.userData?.proceduralModelCapabilityControlDocument
              || createCapabilityControlDocument({ manifest: model.userData?.proceduralModelCapabilityManifest }),
          }
          const registeredId = target.addSandboxModel(model, {
            name: model.name,
            id: String(item.id),
            position: { x: model.position.x, y: model.position.y, z: model.position.z },
          })
          registeredIds.push(registeredId)
        } catch (error) {
          failures.push({ id: item.id, name: item.name, message: error?.message, stack: (error?.stack || '').split('\n').slice(0, 4).join(' | ') })
        }
      }
      expect(failures).toEqual([])
      expect(target.getSandboxModels().map(item => item.id).sort()).toEqual(snapshot.models.map(item => String(item.id)).sort())

      let meshCount = 0
      let hiddenMeshes = 0
      for (const item of snapshot.models) {
        const model = target.getSandboxModel(String(item.id))
        expect(model).toBeTruthy()
        expect(model.visible).not.toBe(false)
        model.traverse(object => {
          if (object.isMesh) {
            meshCount += 1
            if (!object.visible) hiddenMeshes += 1
          }
        })
      }
      expect(meshCount).toBeGreaterThan(0)
      expect(hiddenMeshes).toBe(0)
    } finally {
      target.dispose()
    }
  })

  it.skipIf(!hasRescue)('同存档在区块尺寸不符的 120x60 引擎中世界恢复返回 false（对应 Vue 整档中断分支）', async () => {
    const snapshot = JSON.parse(readFileSync(rescuePath, 'utf8'))
    const target = await createCallbackEngine({})
    try {
      expect(target.restoreSandboxWorld(snapshot.world)).toBe(false)
      expect(target.getSandboxModels()).toEqual([])
    } finally {
      target.dispose()
    }
  })
})

describe('11-07 道路前幸存快照恢复门控（仅当 recovered 目录存在该快照时运行）', () => {
  const recoveredPath = '.superpowers/sdd/2026-11-13-stretchable-road-assets-plan/recovered/http___localhost_5173__2026_11_07T17_22_18_756Z__1models__776076ec8efc.json'
  const hasRecovered = existsSync(recoveredPath)

  it.skipIf(!hasRecovered)('v3 快照按 restoreSandbox 精确顺序在 54x42 生产规格引擎中重放 SparklingLake 2', async () => {
    const snapshot = JSON.parse(readFileSync(recoveredPath, 'utf8'))
    expect(snapshot.version).toBe(3)
    expect(snapshot.models).toHaveLength(1)
    expect(snapshot.world).toBeUndefined()

    const target = createCampusEngine(
      { clientWidth: 800, clientHeight: 600, appendChild() {} },
      {},
      { sceneType: 'blank-sandbox', worldBounds: { width: 54, depth: 42 } },
    )
    try {
      await target.init()
      // v3 快照无 world 字段：Vue restoreSandbox 走 else 分支，仅同步当前世界状态。
      expect(snapshot.world).toBeUndefined()

      const loader = new THREE.ObjectLoader()
      const failures = []
      for (const item of snapshot.models) {
        try {
          const model = loader.parse(item.object)
          model.name = item.name || model.name || '已保存模型'
          model.userData = {
            ...(model.userData || {}),
            proceduralModelCapabilityControlDocument: model.userData?.proceduralModelCapabilityControlDocument
              || createCapabilityControlDocument({ manifest: model.userData?.proceduralModelCapabilityManifest }),
          }
          target.addSandboxModel(model, {
            name: model.name,
            id: String(item.id),
            position: { x: model.position.x, y: model.position.y, z: model.position.z },
          })
        } catch (error) {
          failures.push({ id: item.id, name: item.name, message: error?.message, stack: (error?.stack || '').split('\n').slice(0, 4).join(' | ') })
        }
      }
      expect(failures).toEqual([])
      expect(target.getSandboxModels().map(item => item.id)).toEqual(snapshot.models.map(item => String(item.id)))

      let meshCount = 0
      let hiddenMeshes = 0
      for (const item of snapshot.models) {
        const model = target.getSandboxModel(String(item.id))
        expect(model).toBeTruthy()
        expect(model.visible).not.toBe(false)
        expect(model.name).toBe('SparklingLake 2')
        model.traverse(object => {
          if (object.isMesh) {
            meshCount += 1
            if (!object.visible) hiddenMeshes += 1
          }
        })
      }
      expect(meshCount).toBeGreaterThan(0)
      expect(hiddenMeshes).toBe(0)
    } finally {
      target.dispose()
    }
  })
})

describe('多端点折线道路', () => {
  it('添加断点把直线道路一次升级为四个控制点，删除后回到直线', () => {
    const id = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    expect(isPolylineRoadModel(engine.getSandboxModel(id))).toBe(false)

    expect(engine.addSandboxRoadPoint(id)).toBe(true)
    const polyline = engine.getSandboxModel(id)
    expect(isPolylineRoadModel(polyline)).toBe(true)
    expect(polyline.userData.proceduralRoad.points).toHaveLength(4)

    expect(engine.removeSandboxRoadPoint(id)).toBe(true)
    expect(isPolylineRoadModel(engine.getSandboxModel(id))).toBe(true)
    expect(engine.removeSandboxRoadPoint(id)).toBe(true)
    const straight = engine.getSandboxModel(id)
    expect(straight.userData.proceduralRoad.version).toBe(1)
    expect(straight.userData.proceduralRoad.length).toBeGreaterThan(2)
  })

  it('边缘拖宽后的道路加断点保持路缘形状，不会跳回居中对称', () => {
    const road = createPolylineRoadModel(THREE, {
      objectType: 'asphalt-road',
      width: 9,
      points: [
        { lx: -6, lz: 3, rx: -6, rz: -3 },
        { lx: 6, lz: 6, rx: 6, rz: -3 },
      ],
    })
    const id = engine.addSandboxModel(road, { position: { x: 0, y: 0.04, z: 0 } })
    expect(engine.addSandboxRoadPoint(id)).toBe(true)
    const next = engine.getSandboxModel(id)
    expect(isPolylineRoadModel(next)).toBe(true)
    const points = next.userData.proceduralRoad.points
    expect(points).toHaveLength(4)
    // 内部断点按左右路缘分别插值：lz 依次为 4、5，右缘保持 -3
    expect(points[1].lz).toBeCloseTo(4, 5)
    expect(points[1].rx).toBeCloseTo(points[1].lx, 5)
    expect(points[2].lz).toBeCloseTo(5, 5)
    expect(points.every(point => Math.abs(point.rz + 3) < 1e-6)).toBe(true)
  })

  it('折线可继续添加断点，非道路模型不可添加', () => {
    const id = engine.addSandboxModel(createRoad(20), { position: { x: 0, y: 0.04, z: 0 } })
    expect(engine.addSandboxRoadPoint(id)).toBe(true)
    expect(engine.getSandboxModel(id).userData.proceduralRoad.points).toHaveLength(4)
    expect(engine.addSandboxRoadPoint(id)).toBe(true)
    expect(engine.getSandboxModel(id).userData.proceduralRoad.points).toHaveLength(5)

    const buildingId = engine.addSandboxModel(createZhiyuanModel())
    expect(engine.addSandboxRoadPoint(buildingId)).toBe(false)
    expect(engine.removeSandboxRoadPoint(buildingId)).toBe(false)
  })
})

describe('道路绘制模式', () => {
  it('点击生成端点并创建折线道路', () => {
    expect(engine.beginSandboxRoadDrawing('stone-path')).toBe(true)
    expect(engine.getSandboxRoadDrawingState()).toMatchObject({ active: true, objectType: 'stone-path' })
    engine.addSandboxRoadDrawingPoint(0, 0)
    engine.addSandboxRoadDrawingPoint(10, 0)
    engine.addSandboxRoadDrawingPoint(10, 10)
    const result = engine.finishSandboxRoadDrawing()
    expect(result.ok).toBe(true)
    const roads = engine.getSandboxModels()
    expect(roads).toHaveLength(1)
    const model = engine.getSandboxModel(roads[0].id)
    expect(isPolylineRoadModel(model)).toBe(true)
    expect(model.userData.proceduralRoad.points).toHaveLength(3)
    expect(engine.getSandboxRoadDrawingState().active).toBe(false)
  })

  it('新路端点接上已有道路时自动合并成一条', () => {
    engine.beginSandboxRoadDrawing('asphalt-road')
    engine.addSandboxRoadDrawingPoint(0, 0)
    engine.addSandboxRoadDrawingPoint(10, 0)
    engine.finishSandboxRoadDrawing()
    expect(engine.getSandboxModels()).toHaveLength(1)

    engine.beginSandboxRoadDrawing('asphalt-road')
    engine.addSandboxRoadDrawingPoint(10.4, 0.2)
    engine.addSandboxRoadDrawingPoint(10, 10)
    const result = engine.finishSandboxRoadDrawing()
    expect(result.ok).toBe(true)
    expect(engine.getSandboxModels()).toHaveLength(1)
    const model = engine.getSandboxModel(engine.getSandboxModels()[0].id)
    expect(model.userData.proceduralRoad.points).toHaveLength(3)
  })

  it('取消绘制不产生模型', () => {
    engine.beginSandboxRoadDrawing('concrete-road')
    engine.addSandboxRoadDrawingPoint(0, 0)
    engine.cancelSandboxRoadDrawing()
    expect(engine.getSandboxRoadDrawingState().active).toBe(false)
    expect(engine.getSandboxModels()).toHaveLength(0)
  })
})

describe('道路端点编辑器（边缘手柄）', () => {
  it('选中道路进入端点模式：直线道路给出四个边缘手柄，非道路不能进入', () => {
    expect(engine.setSandboxTransformMode('road-endpoints')).toBe(false)

    const buildingId = engine.addSandboxModel(createZhiyuanModel())
    expect(engine.setSandboxTransformMode('road-endpoints')).toBe(false)
    engine.selectSandboxModel(null)
    engine.removeSandboxModel(buildingId)

    const id = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    const road = engine.getSandboxModel(id)
    const detachCount = TransformControls.active.detachCount
    const { ok, editor } = enterRoadEndpointMode()

    expect(ok).toBe(true)
    expect(TransformControls.active.object).toBeNull()
    expect(TransformControls.active.detachCount).toBe(detachCount + 1)
    expect(CameraRig.active.orbitInteractionEnabled).toBe(false)
    expect(editor?.name).toBe('_sandboxRoadEditor')
    expect(editor.parent).toBe(road.parent)
    expect(road.children).not.toContain(editor)

    const handles = getEditorHandles(editor)
    expect(handles).toHaveLength(4)
    expect(handles.map(handle => handle.userData.stationIndex + ':' + handle.userData.side))
      .toEqual(['0:left', '0:right', '1:left', '1:right'])
    // 路长 12、宽 6、沿 +x：四个手柄落在 (±6, ±3) 的路缘
    for (const handle of handles) {
      const position = handle.getWorldPosition(new THREE.Vector3())
      expect(Math.abs(Math.abs(position.x) - 6)).toBeLessThan(0.01)
      expect(Math.abs(Math.abs(position.z) - 3)).toBeLessThan(0.01)
    }
    expect(findEditorChild(editor, 'road-edit-proxy')).toBeTruthy()
    expect(JSON.stringify(road.toJSON())).not.toContain('_sandboxRoadEditor')

    delete road.userData.proceduralRoad
    expect(engine.setSandboxTransformMode('road-endpoints')).toBe(false)
  })

  it('拖动边缘手柄：对面边缘固定，松手提交宽度与形状变化', async () => {
    const onRoadEditChange = vi.fn()
    const onModelsChange = vi.fn()
    const callbackEngine = await createCallbackEngine({
      onSandboxRoadEditChange: onRoadEditChange,
      onSandboxModelsChange: onModelsChange,
    })
    engine = callbackEngine
    orientCameraTopDown()
    try {
      const id = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
      const road = engine.getSandboxModel(id)
      const { editor } = enterRoadEndpointMode()
      const handle = getEdgeHandle(editor, 1, 'left').getWorldPosition(new THREE.Vector3())

      dispatchPointer('pointerdown', handle)
      expect(activeDomElement().hasPointerCapture(1)).toBe(true)
      expect(road.visible).toBe(false)
      dispatchPointer('pointermove', { x: 6, y: 0, z: 6 })

      const proxy = findEditorChild(editor, 'road-edit-proxy')
      proxy.updateMatrixWorld(true)
      // 预览是随控制点连续变形的路面带：x 仍跨 12，z 覆盖固定边 -3 到被拉动的 6
      const previewBounds = new THREE.Box3().setFromObject(proxy)
      expect(previewBounds.min.z).toBeCloseTo(-3, 1)
      expect(previewBounds.max.z).toBeCloseTo(6, 1)
      expect(previewBounds.max.x - previewBounds.min.x).toBeCloseTo(12, 1)
      expect(editPhases(onRoadEditChange)).toContain('dragging')

      dispatchPointer('pointerup', { x: 6, y: 0, z: 6 })
      expect(activeDomElement().hasPointerCapture(1)).toBe(false)
      expect(onRoadEditChange.mock.calls.map(call => call[0]).at(-1)).toMatchObject({ phase: 'committed', id })

      const replaced = engine.getSandboxModel(id)
      expect(replaced).not.toBe(road)
      expect(replaced.userData.proceduralRoad.width).toBeCloseTo(9, 1)
      // 对面边缘 (6,-3) 固定：控制点中心被拉到 (6, 1.5)
      const stations = getRoadStations(replaced)
      expect(stations[0].x).toBeCloseTo(-6, 1)
      expect(stations[1].x).toBeCloseTo(6, 1)
      expect(stations[1].z).toBeCloseTo(1.5, 1)
      expect(stations[1].hw).toBeCloseTo(4.5, 1)
      const freshEditor = enterRoadEndpointMode().editor
      expect(getEditorHandles(freshEditor)).toHaveLength(4)
    } finally {
      callbackEngine.dispose()
      engine = null
    }
  })

  it('拖动中心手柄整体移动控制截面，宽度保持不变', () => {
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    const road = engine.getSandboxModel(roadId)
    const { editor } = enterRoadEndpointMode()
    const center = getCenterHandle(editor, 1)
    expect(center).toBeTruthy()
    const start = center.getWorldPosition(new THREE.Vector3())
    expect(start.x).toBeCloseTo(6, 5)
    expect(start.z).toBeCloseTo(0, 5)

    dispatchPointer('pointerdown', start)
    dispatchPointer('pointermove', { x: 6, y: 0, z: 4 })
    dispatchPointer('pointerup', { x: 6, y: 0, z: 4 })

    const replaced = engine.getSandboxModel(roadId)
    expect(replaced).not.toBe(road)
    const edges = getRoadEdgeStations(replaced)
    expect(edges[0].left.z).toBeCloseTo(3, 5)
    expect(edges[0].right.z).toBeCloseTo(-3, 5)
    expect(edges[1].left.z).toBeCloseTo(7, 5)
    expect(edges[1].right.z).toBeCloseTo(1, 5)
    expect(getRoadStations(replaced)[1].hw).toBeCloseTo(3, 5)
  })

  it('开始加断点后点击道路上的位置，只插入一个断点在点击处', () => {
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    const { editor } = enterRoadEndpointMode()
    expect(engine.beginSandboxRoadBreakpointPick()).toBe(true)
    dispatchPointer('pointerdown', { x: 2, y: 0, z: 0 })

    const replaced = engine.getSandboxModel(roadId)
    const stations = getRoadStations(replaced)
    expect(stations).toHaveLength(3)
    expect(stations[1].x).toBeCloseTo(2, 0)
    expect(stations[1].hw).toBeCloseTo(3, 5)
    expect(editPhases(onRoadEditChange)).toContain('breakpoint-added')
    expect(editor.parent).toBeNull()
    const freshEditor = enterRoadEndpointMode().editor
    expect(freshEditor.parent).not.toBeNull()
  })

  it('折线道路的端点预览按曲线细分，与正式道路包围盒一致（所见即所得）', () => {
    engine.beginSandboxRoadDrawing('asphalt-road')
    engine.addSandboxRoadDrawingPoint(0, 0)
    engine.addSandboxRoadDrawingPoint(12, 0)
    engine.addSandboxRoadDrawingPoint(12, 12)
    engine.finishSandboxRoadDrawing()
    const roadId = engine.getSandboxModels()[0].id
    const road = engine.getSandboxModel(roadId)
    const roadBounds = new THREE.Box3().setFromObject(road)

    const { editor } = enterRoadEndpointMode()
    expect(getEditorHandles(editor)).toHaveLength(6)
    expect(findEditorChild(editor, 'road-edit-guides')).toBeTruthy()
    const proxy = findEditorChild(editor, 'road-edit-proxy')
    // 两段控制边，每段细分 ROAD_CURVE_SUBDIVISIONS 段，每段 6 个顶点
    expect(proxy.geometry.attributes.position.count / 6).toBe(2 * ROAD_CURVE_SUBDIVISIONS)
    proxy.updateMatrixWorld(true)
    const previewBounds = new THREE.Box3().setFromObject(proxy)
    expect(previewBounds.min.x).toBeCloseTo(roadBounds.min.x, 1)
    expect(previewBounds.max.x).toBeCloseTo(roadBounds.max.x, 1)
    expect(previewBounds.min.z).toBeCloseTo(roadBounds.min.z, 1)
    expect(previewBounds.max.z).toBeCloseTo(roadBounds.max.z, 1)
  })

  it('两点道路的拉伸提交保持预览形状，边缘点不按中心线重算', () => {
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    const { editor } = enterRoadEndpointMode()
    const handle = getEdgeHandle(editor, 1, 'left').getWorldPosition(new THREE.Vector3())

    dispatchPointer('pointerdown', handle)
    dispatchPointer('pointermove', { x: 6, y: 0, z: 6 })
    const proxy = findEditorChild(editor, 'road-edit-proxy')
    proxy.updateMatrixWorld(true)
    const previewBounds = new THREE.Box3().setFromObject(proxy).clone()
    dispatchPointer('pointerup', { x: 6, y: 0, z: 6 })

    const replaced = engine.getSandboxModel(roadId)
    const edges = getRoadEdgeStations(replaced)
    // 拖动过的左缘角点停在 (6,6)，对面边缘 (6,-3) 与起点两端保持不动
    expect(edges[1].left.x).toBeCloseTo(6, 5)
    expect(edges[1].left.z).toBeCloseTo(6, 5)
    expect(edges[1].right.x).toBeCloseTo(6, 5)
    expect(edges[1].right.z).toBeCloseTo(-3, 5)
    expect(edges[0].left.z).toBeCloseTo(3, 5)
    expect(edges[0].right.z).toBeCloseTo(-3, 5)
    // 提交后的包围盒与预览一致
    replaced.updateMatrixWorld(true)
    const committedBounds = new THREE.Box3().setFromObject(replaced)
    expect(committedBounds.min.z).toBeCloseTo(previewBounds.min.z, 1)
    expect(committedBounds.max.z).toBeCloseTo(previewBounds.max.z, 1)
  })

  it('附近有模型也允许拉伸：重叠不再阻止提交，松手后形状生效', () => {
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    engine.addSandboxModel(createBatchableReplacement(), { position: { x: 10, y: 0.5, z: 0 } })
    const road = engine.getSandboxModel(roadId)
    engine.selectSandboxModel(roadId)
    const { editor } = enterRoadEndpointMode()
    const handle = getEdgeHandle(editor, 1, 'left').getWorldPosition(new THREE.Vector3())

    dispatchPointer('pointerdown', handle)
    dispatchPointer('pointermove', { x: 10, y: 0, z: 8 })
    const proxy = findEditorChild(editor, 'road-edit-proxy')
    expect(proxy.material.color.getHexString()).toBe('8bd5a5')
    expect(editPhases(onRoadEditChange)).not.toContain('blocked')

    dispatchPointer('pointerup', { x: 10, y: 0, z: 8 })
    expect(editPhases(onRoadEditChange)).toContain('committed')
    const replaced = engine.getSandboxModel(roadId)
    expect(replaced).not.toBe(road)
    expect(replaced.userData.proceduralRoad.width).toBeGreaterThan(10)
    expect(replaced.visible).toBe(true)
    const freshEditor = enterRoadEndpointMode().editor
    expect(freshEditor.parent).not.toBeNull()
  })

  it('超出世界边界时拒绝提交', () => {
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    const { editor } = enterRoadEndpointMode()
    const handle = getEdgeHandle(editor, 1, 'left').getWorldPosition(new THREE.Vector3())

    dispatchPointer('pointerdown', handle)
    dispatchPointer('pointermove', { x: 400, y: 0, z: 0 })
    dispatchPointer('pointerup', { x: 400, y: 0, z: 0 })

    expect(editPhases(onRoadEditChange)).toContain('blocked')
    expect(editPhases(onRoadEditChange)).not.toContain('committed')
    expect(engine.getSandboxModel(roadId).userData.proceduralRoad.length).toBe(12)
    expect(editor.parent).not.toBeNull()
  })

  it('拖进已回收地块时返回 occupied 原因且不保存', () => {
    expect(engine.expandSandboxWorld('south', 2)).toBe(true)
    expect(engine.removeSandboxWorldChunk(0, 1).ok).toBe(true)
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    const { editor } = enterRoadEndpointMode()
    const handle = getEdgeHandle(editor, 1, 'left').getWorldPosition(new THREE.Vector3())

    dispatchPointer('pointerdown', handle)
    dispatchPointer('pointermove', { x: 6, y: 0, z: 80 })

    const blocked = onRoadEditChange.mock.calls.map(call => call[0]).find(payload => payload.phase === 'blocked')
    expect(blocked.reason).toBe('该位置包含已回收的地块')
    dispatchPointer('pointerup', { x: 6, y: 0, z: 80 })
    expect(engine.getSandboxModel(roadId).userData.proceduralRoad.width).toBe(6)
  })

  it('端面相接允许提交到另一条路', () => {
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    engine.addSandboxModel(createRoad(12), { position: { x: 24, y: 0.04, z: 0 } })
    engine.selectSandboxModel(roadId)
    const { editor } = enterRoadEndpointMode()
    const handle = getEdgeHandle(editor, 1, 'left').getWorldPosition(new THREE.Vector3())

    dispatchPointer('pointerdown', handle)
    dispatchPointer('pointermove', { x: 18, y: 0, z: 3 })
    dispatchPointer('pointerup', { x: 18, y: 0, z: 3 })

    expect(editPhases(onRoadEditChange)).toContain('committed')
    const stations = getRoadStations(engine.getSandboxModel(roadId))
    expect(stations).toHaveLength(2)
    expect(stations[1].x).toBeCloseTo(12, 1)
    expect(stations[1].hw).toBeGreaterThan(4)
    const freshEditor = enterRoadEndpointMode().editor
    expect(freshEditor.parent).not.toBeNull()
  })

  it.each(['escape', 'pointercancel', 'lostpointercapture'])('%s 取消拖动并恢复正式道路，不产生提交', (cancelType) => {
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    const road = engine.getSandboxModel(roadId)
    const { editor } = enterRoadEndpointMode()
    const proxy = findEditorChild(editor, 'road-edit-proxy')
    const handle = getEdgeHandle(editor, 1, 'left').getWorldPosition(new THREE.Vector3())

    dispatchPointer('pointerdown', handle)
    dispatchPointer('pointermove', { x: 6, y: 0, z: 8 })
    expect(activeDomElement().hasPointerCapture(1)).toBe(true)

    if (cancelType === 'escape') {
      globalThis.window.dispatchEvent({ type: 'keydown', key: 'Escape' })
    } else {
      dispatchPointer(cancelType, { x: 6, y: 0, z: 8 })
    }

    expect(road.visible).toBe(true)
    expect(road.userData.proceduralRoad.length).toBe(12)
    expect(road.userData.proceduralRoad.width).toBe(6)
    expect(activeDomElement().hasPointerCapture(1)).toBe(false)
    expect(proxy.visible).toBe(false)
    expect(editPhases(onRoadEditChange)).not.toContain('committed')
    expect(editPhases(onRoadEditChange)).toContain('cancelled')
    expect(editor.parent).not.toBeNull()
  })

  it('未拖动时 Escape 退出端点模式', () => {
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    const { editor } = enterRoadEndpointMode()
    expect(engine.getSandboxModel(roadId).visible).toBe(true)

    globalThis.window.dispatchEvent({ type: 'keydown', key: 'Escape' })

    expect(editor.parent).toBeNull()
    expect(engine.getSandboxModel(roadId).visible).toBe(true)
  })

  it('射线与地面无交点时保留最后一个有效预览，并可按该预览提交', () => {
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    const { editor } = enterRoadEndpointMode()
    const handle = getEdgeHandle(editor, 1, 'left').getWorldPosition(new THREE.Vector3())

    dispatchPointer('pointerdown', handle)
    dispatchPointer('pointermove', { x: 6, y: 0, z: 6 })
    const proxy = findEditorChild(editor, 'road-edit-proxy')
    proxy.updateMatrixWorld(true)
    const lastBounds = new THREE.Box3().setFromObject(proxy).clone()

    orientCameraHorizontal()
    dispatchPointer('pointermove', { x: 6, y: 0, z: 10 })
    proxy.updateMatrixWorld(true)
    expect(new THREE.Box3().setFromObject(proxy).equals(lastBounds)).toBe(true)
    expect(Number.isFinite(proxy.position.x)).toBe(true)

    orientCameraTopDown()
    dispatchPointer('pointerup', { x: 6, y: 0, z: 6 })
    expect(engine.getSandboxModel(roadId).userData.proceduralRoad.width).toBeCloseTo(9, 1)
  })

  it('模式切换、切换选中、删除和 dispose 清理编辑器监听器、手柄、代理和指针捕获', () => {
    const dom = activeDomElement()
    const pointerTypes = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']
    const baseline = Object.fromEntries(pointerTypes.map(type => [type, dom.listenerCount(type)]))
    const keyBaseline = globalThis.window.listenerCount('keydown')

    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    const first = enterRoadEndpointMode().editor
    expect(pointerTypes.every(type => dom.listenerCount(type) >= baseline[type] + 1)).toBe(true)
    expect(globalThis.window.listenerCount('keydown')).toBe(keyBaseline)

    const second = enterRoadEndpointMode().editor
    expect(first.parent).toBeNull()
    expect(second.parent).not.toBeNull()
    expect(second.parent.children.filter(object => object.name === '_sandboxRoadEditor')).toHaveLength(1)

    engine.selectSandboxModel(null)
    expect(second.parent).toBeNull()
    pointerTypes.forEach(type => expect(dom.listenerCount(type)).toBe(baseline[type]))
    expect(globalThis.window.listenerCount('keydown')).toBe(keyBaseline)

    const thirdEntry = enterRoadEndpointMode()
    expect(thirdEntry.ok).toBe(false)
    engine.selectSandboxModel(roadId)
    const third = enterRoadEndpointMode().editor
    const thirdHandle = getEdgeHandle(third, 1, 'left').getWorldPosition(new THREE.Vector3())
    dispatchPointer('pointerdown', thirdHandle)
    dispatchPointer('pointermove', { x: 6, y: 0, z: 8 })
    expect(dom.hasPointerCapture(1)).toBe(true)
    expect(engine.removeSandboxModel(roadId)).toBe(true)
    expect(dom.hasPointerCapture(1)).toBe(false)
    expect(third.parent).toBeNull()
    pointerTypes.forEach(type => expect(dom.listenerCount(type)).toBe(baseline[type]))

    const nextRoadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    expect(nextRoadId).toBeTruthy()
    const fourth = enterRoadEndpointMode().editor
    expect(fourth.parent).not.toBeNull()
    engine.dispose()
    engine = null
    expect(fourth.parent).toBeNull()
    pointerTypes.forEach(type => expect(dom.listenerCount(type)).toBe(0))
    expect(globalThis.window.listenerCount('keydown')).toBe(0)
  })
})

describe('道路通用 gizmo 轴限制', () => {
  it('道路拒绝 scale，translate 仅 XZ，rotate 仅 Y；普通模型恢复三轴', () => {
    engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })

    expect(engine.setSandboxTransformMode('scale')).toBe(false)
    expect(TransformControls.active.mode).not.toBe('scale')

    expect(engine.setSandboxTransformMode('translate')).toBe(true)
    expect(TransformControls.active.mode).toBe('translate')
    expect([TransformControls.active.showX, TransformControls.active.showY, TransformControls.active.showZ]).toEqual([true, false, true])

    expect(engine.setSandboxTransformMode('rotate')).toBe(true)
    expect(TransformControls.active.mode).toBe('rotate')
    expect([TransformControls.active.showX, TransformControls.active.showY, TransformControls.active.showZ]).toEqual([false, true, false])

    engine.setSandboxTransformMode('browse')
    expect([TransformControls.active.showX, TransformControls.active.showY, TransformControls.active.showZ]).toEqual([true, true, true])
    engine.selectSandboxModel(null)

    engine.addSandboxModel(createZhiyuanModel())
    engine.setSandboxTransformMode('translate')
    expect([TransformControls.active.showX, TransformControls.active.showY, TransformControls.active.showZ]).toEqual([true, true, true])
    engine.setSandboxTransformMode('rotate')
    expect([TransformControls.active.showX, TransformControls.active.showY, TransformControls.active.showZ]).toEqual([true, true, true])
    engine.setSandboxTransformMode('scale')
    expect(TransformControls.active.mode).toBe('scale')
    expect([TransformControls.active.showX, TransformControls.active.showY, TransformControls.active.showZ]).toEqual([true, true, true])
  })
})
