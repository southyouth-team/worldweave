import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createCampusEngine } from './createCampusEngine.js'
import { createCapabilityControlDocument } from '../sandbox/capabilityControl.js'
import { createSceneAssetGeneratorRegistry } from '../world/campus/sceneAssetGeneratorRegistry.js'
import { createBuiltinSandboxModel, listBuiltinAssets } from '../sandbox/builtinAssetAdapter.js'
import { getRoadEndpoints } from '../sandbox/roadEndpointMath.js'
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
    if (Number.isInteger(object.userData.endpointIndex)) handles.push(object)
  })
  return handles.sort((a, b) => a.userData.endpointIndex - b.userData.endpointIndex)
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

describe('道路端点编辑器', () => {
  it('仅选中的有效道路可进入，并在两个世界端点生成编辑器手柄', () => {
    expect(engine.setSandboxTransformMode('road-endpoints')).toBe(false)

    const buildingId = engine.addSandboxModel(createZhiyuanModel())
    expect(engine.setSandboxTransformMode('road-endpoints')).toBe(false)
    engine.selectSandboxModel(null)
    engine.removeSandboxModel(buildingId)

    const id = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    const road = engine.getSandboxModel(id)
    const expectedEndpoints = getRoadEndpoints(road)
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
    expect(handles.map(handle => handle.userData.endpointIndex)).toEqual([0, 1])
    handles.forEach((handle, index) => {
      expect(handle.getWorldPosition(new THREE.Vector3()).toArray())
        .toEqual([expectedEndpoints[index].x, expectedEndpoints[index].y, expectedEndpoints[index].z])
    })
    expect(JSON.stringify(road.toJSON())).not.toContain('_sandboxRoadEditor')

    delete road.userData.proceduralRoad
    expect(engine.setSandboxTransformMode('road-endpoints')).toBe(false)
  })

  it('拖动手柄时固定端和正式道路不变，合法松手只提交一次并重建为正确长度、中心和朝向', async () => {
    const onRoadEditChange = vi.fn()
    const onModelsChange = vi.fn()
    const onModelSelected = vi.fn()
    const callbackEngine = await createCallbackEngine({
      onSandboxRoadEditChange: onRoadEditChange,
      onSandboxModelsChange: onModelsChange,
      onSandboxModelSelected: onModelSelected,
    })
    engine = callbackEngine
    orientCameraTopDown()
    try {
      const id = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
      const road = engine.getSandboxModel(id)
      const originalTransform = {
        position: road.position.toArray(),
        rotation: road.rotation.toArray().slice(0, 3),
        scale: road.scale.toArray(),
      }
      const originalGeometries = geometryIds(road)
      const { editor } = enterRoadEndpointMode()
      const handles = getEditorHandles(editor)
      const fixedEnd = handles[0].getWorldPosition(new THREE.Vector3())
      const selectionCalls = onModelSelected.mock.calls.length

      dispatchPointer('pointerdown', { x: 6, y: 0.1, z: 0 })
      expect(activeDomElement().hasPointerCapture(1)).toBe(true)
      expect(onModelSelected.mock.calls.length).toBe(selectionCalls)
      dispatchPointer('pointermove', { x: 20, y: 0, z: 0 })

      expect(road.visible).toBe(false)
      expect(road.position.toArray()).toEqual(originalTransform.position)
      expect(road.rotation.toArray().slice(0, 3)).toEqual(originalTransform.rotation)
      expect(road.scale.toArray()).toEqual(originalTransform.scale)
      expect(geometryIds(road)).toEqual(originalGeometries)
      expect(handles[0].getWorldPosition(new THREE.Vector3()).toArray())
        .toEqual([fixedEnd.x, fixedEnd.y, fixedEnd.z])

      const proxy = findEditorChild(editor, 'road-edit-proxy')
      proxy.updateMatrixWorld(true)
      const previewBounds = new THREE.Box3().setFromObject(proxy)
      expect(previewBounds.getSize(new THREE.Vector3()).x).toBeCloseTo(26, 5)
      expect(previewBounds.getSize(new THREE.Vector3()).z).toBeCloseTo(6, 5)
      expect(previewBounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(7, 5)
      expect(editPhases(onRoadEditChange)).toContain('dragging')
      expect(onRoadEditChange.mock.calls.map(call => call[0]).filter(payload => payload.phase === 'dragging').at(-1))
        .toMatchObject({ id, length: 26, active: true, reason: null })

      dispatchPointer('pointerup', { x: 20, y: 0, z: 0 })
      expect(activeDomElement().hasPointerCapture(1)).toBe(false)
      // 添加模型触发一次；合法道路提交只应再触发一次 replace 对应的模型列表回调。
      expect(onModelsChange.mock.calls.length).toBe(2)
      expect(onRoadEditChange.mock.calls.map(call => call[0]).at(-1)).toMatchObject({
        phase: 'committed', id, length: 26, active: false, reason: null,
      })

      const replaced = engine.getSandboxModel(id)
      expect(replaced).not.toBe(road)
      expect(road.parent).toBeNull()
      expect(replaced.userData.proceduralRoad).toMatchObject({ length: 26, width: 6 })
      expect(replaced.position.toArray()).toEqual([7, 0.04, 0])
      expect(replaced.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0])
      expect(replaced.scale.toArray()).toEqual([1, 1, 1])
      replaced.updateMatrixWorld(true)
      const endpoints = getRoadEndpoints(replaced)
      expect(endpoints[0].toArray()).toEqual([-6, 0.04, 0])
      expect(endpoints[1].toArray()).toEqual([20, 0.04, 0])

      const sceneGeometries = new Set()
      editor.parent.traverse(object => {
        if (object.isMesh && object.geometry) sceneGeometries.add(object.geometry.uuid)
      })
      expect(originalGeometries.every(geometryId => !sceneGeometries.has(geometryId))).toBe(true)
      expect(JSON.stringify(engine.serializeSandboxModel(id))).not.toContain('_sandboxRoadEditor')
      expect(editor.parent).not.toBeNull()
      expect(getEditorHandles(editor).map(handle => handle.userData.endpointIndex)).toEqual([0, 1])
    } finally {
      callbackEngine.dispose()
      engine = null
    }
  })

  it('与其他模型重叠时代理标红，松手不会替换正式道路', () => {
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    engine.addSandboxModel(createBatchableReplacement(), { position: { x: 10, y: 0.5, z: 0 } })
    const road = engine.getSandboxModel(roadId)
    engine.selectSandboxModel(roadId)
    const { editor } = enterRoadEndpointMode()

    dispatchPointer('pointerdown', { x: 6, y: 0.1, z: 0 })
    dispatchPointer('pointermove', { x: 20, y: 0, z: 0 })
    const proxy = findEditorChild(editor, 'road-edit-proxy')
    const blocked = onRoadEditChange.mock.calls.map(call => call[0]).find(payload => payload.phase === 'blocked')

    expect(blocked).toMatchObject({ id: roadId, active: true })
    expect(blocked.reason).toBeTruthy()
    expect(proxy.material.color.getHexString()).toBe('e66b68')

    dispatchPointer('pointerup', { x: 20, y: 0, z: 0 })
    expect(engine.getSandboxModel(roadId)).toBe(road)
    expect(road.visible).toBe(true)
    expect(road.userData.proceduralRoad.length).toBe(12)
    expect(editPhases(onRoadEditChange)).not.toContain('committed')
    expect(editor.parent).not.toBeNull()
  })

  it('超出世界边界或覆盖已回收区块时拒绝提交', () => {
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    const { editor } = enterRoadEndpointMode()

    dispatchPointer('pointerdown', { x: 6, y: 0.1, z: 0 })
    dispatchPointer('pointermove', { x: 100, y: 0, z: 0 })
    dispatchPointer('pointerup', { x: 100, y: 0, z: 0 })

    expect(editPhases(onRoadEditChange)).toContain('blocked')
    expect(editPhases(onRoadEditChange)).not.toContain('committed')
    expect(engine.getSandboxModel(roadId).userData.proceduralRoad.length).toBe(12)
    expect(editor.parent).not.toBeNull()
  })

  it('长路跨越已回收的内部区块时返回 occupied 原因且不保存', () => {
    expect(engine.expandSandboxWorld('east', 2)).toBe(true)
    expect(engine.removeSandboxWorldChunk(1, 0).ok).toBe(true)
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    const { editor } = enterRoadEndpointMode()

    dispatchPointer('pointerdown', { x: 6, y: 0.1, z: 0 })
    dispatchPointer('pointermove', { x: 100, y: 0, z: 0 })

    const blocked = onRoadEditChange.mock.calls.map(call => call[0]).find(payload => payload.phase === 'blocked')
    expect(blocked.reason).toBe('该位置包含已回收的地块')
    dispatchPointer('pointerup', { x: 100, y: 0, z: 0 })
    expect(engine.getSandboxModel(roadId).userData.proceduralRoad.length).toBe(12)
    expect(editor.parent).not.toBeNull()
  })

  it('端面相接允许，面积搭接和斜向保守 AABB 重叠均拒绝', () => {
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    engine.addSandboxModel(createRoad(12), { position: { x: 24, y: 0.04, z: 0 } })
    engine.selectSandboxModel(roadId)
    let entry = enterRoadEndpointMode()
    dispatchPointer('pointerdown', { x: 6, y: 0.1, z: 0 })
    dispatchPointer('pointermove', { x: 18, y: 0, z: 0 })
    dispatchPointer('pointerup', { x: 18, y: 0, z: 0 })
    expect(engine.getSandboxModel(roadId).userData.proceduralRoad.length).toBe(24)
    expect(entry.editor.parent).not.toBeNull()
    engine.setSandboxTransformMode('browse')

    engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 10 } })
    engine.selectSandboxModel(roadId)
    entry = enterRoadEndpointMode()
    dispatchPointer('pointerdown', { x: -6, y: 0.1, z: 0 })
    dispatchPointer('pointermove', { x: 0, y: 0, z: 20 })
    dispatchPointer('pointerup', { x: 0, y: 0, z: 20 })
    expect(engine.getSandboxModel(roadId).userData.proceduralRoad.length).toBe(24)
    expect(entry.editor.parent).not.toBeNull()
    engine.setSandboxTransformMode('browse')

    const diagonalId = engine.addSandboxModel(createRoad(12), { position: { x: 26, y: 0.04, z: 6 } })
    const diagonal = engine.getSandboxModel(diagonalId)
    diagonal.rotation.y = Math.PI / 4
    diagonal.updateMatrixWorld(true)
    engine.selectSandboxModel(roadId)
    entry = enterRoadEndpointMode()
    dispatchPointer('pointerdown', { x: 18, y: 0.1, z: 0 })
    dispatchPointer('pointermove', { x: 20, y: 0, z: 0 })
    dispatchPointer('pointerup', { x: 20, y: 0, z: 0 })
    expect(engine.getSandboxModel(roadId).userData.proceduralRoad.length).toBe(24)
    expect(entry.editor.parent).not.toBeNull()
  })

  it.each(['escape', 'pointercancel', 'lostpointercapture'])('%s 取消拖动并恢复正式道路，不产生提交', (cancelType) => {
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })
    const road = engine.getSandboxModel(roadId)
    const { editor } = enterRoadEndpointMode()
    const proxy = findEditorChild(editor, 'road-edit-proxy')

    dispatchPointer('pointerdown', { x: 6, y: 0.1, z: 0 })
    dispatchPointer('pointermove', { x: 20, y: 0, z: 0 })
    expect(activeDomElement().hasPointerCapture(1)).toBe(true)

    if (cancelType === 'escape') {
      globalThis.window.dispatchEvent({ type: 'keydown', key: 'Escape' })
    } else {
      dispatchPointer(cancelType, { x: 20, y: 0, z: 0 })
    }

    expect(road.visible).toBe(true)
    expect(road.userData.proceduralRoad.length).toBe(12)
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
    dispatchPointer('pointerdown', { x: 6, y: 0.1, z: 0 })
    dispatchPointer('pointermove', { x: 20, y: 0, z: 0 })
    const proxy = findEditorChild(editor, 'road-edit-proxy')
    proxy.updateMatrixWorld(true)
    const lastBounds = new THREE.Box3().setFromObject(proxy).clone()

    orientCameraHorizontal()
    dispatchPointer('pointermove', { x: 25, y: 0, z: 0 })
    proxy.updateMatrixWorld(true)
    expect(new THREE.Box3().setFromObject(proxy).equals(lastBounds)).toBe(true)
    expect(Number.isFinite(proxy.position.x)).toBe(true)

    orientCameraTopDown()
    dispatchPointer('pointerup', { x: 20, y: 0, z: 0 })
    expect(engine.getSandboxModel(roadId).userData.proceduralRoad.length).toBe(26)
  })

  it('道路通用 gizmo 拒绝 scale，translate 仅 XZ，rotate 仅 Y；普通模型恢复三轴', () => {
    const roadId = engine.addSandboxModel(createRoad(12), { position: { x: 0, y: 0.04, z: 0 } })

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

    const buildingId = engine.addSandboxModel(createZhiyuanModel())
    expect(engine.getSandboxModel(buildingId)).toBeTruthy()
    engine.setSandboxTransformMode('translate')
    expect([TransformControls.active.showX, TransformControls.active.showY, TransformControls.active.showZ]).toEqual([true, true, true])
    engine.setSandboxTransformMode('rotate')
    expect([TransformControls.active.showX, TransformControls.active.showY, TransformControls.active.showZ]).toEqual([true, true, true])
    engine.setSandboxTransformMode('scale')
    expect(TransformControls.active.mode).toBe('scale')
    expect([TransformControls.active.showX, TransformControls.active.showY, TransformControls.active.showZ]).toEqual([true, true, true])
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
    dispatchPointer('pointerdown', { x: 6, y: 0.1, z: 0 })
    dispatchPointer('pointermove', { x: 20, y: 0, z: 0 })
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
