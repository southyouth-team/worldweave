import {
  areRoadPointsValid,
  getRoadEdgeHandles,
  getRoadEdgeStations,
  isAnyStretchableRoadModel,
  pointsTotalLength,
  smoothRoadEdgeStations,
  solveRoadEdgeDrag,
  translateRoadStation,
} from '../sandbox/roadEndpointMath.js'

const EDITOR_ROOT_NAME = '_sandboxRoadEditor'
const LEGAL_COLOR = '#8bd5a5'
const BLOCKED_COLOR = '#e66b68'
const GUIDE_COLOR = '#e8f5ec'
const HANDLE_PICK_RADIUS_PX = 10

function disposeObject(object) {
  object.traverse?.(item => {
    item.geometry?.dispose?.()
    if (Array.isArray(item.material)) item.material.forEach(material => material?.dispose?.())
    else item.material?.dispose?.()
  })
}

function stationSeparation(station) {
  return Math.hypot(station.right.x - station.left.x, station.right.z - station.left.z)
}

function edgeStationsToPoints(stations) {
  return stations.map(station => ({
    lx: station.left.x,
    lz: station.left.z,
    rx: station.right.x,
    rz: station.right.z,
  }))
}

// 用边缘点构建连续路面带（与 v4 道路生成同一套拓扑），用于实时预览。
function buildRibbonGeometry(THREE, stations, y) {
  const positions = []
  const push = (point) => positions.push(point.x, y, point.z)
  const quad = (a, b, c, d) => {
    push(a); push(b); push(c)
    push(a); push(c); push(d)
  }
  for (let index = 1; index < stations.length; index += 1) {
    quad(
      stations[index - 1].left,
      stations[index - 1].right,
      stations[index].right,
      stations[index].left,
    )
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

// 路缘引导线：沿平滑后的左右路缘描边，并在每个控制点画横连线，
// 端点模式下始终可见 —— 手柄落在描边上，看起来是一整条连起来的路。
function buildGuideGeometry(THREE, stations, y) {
  const outline = smoothRoadEdgeStations(stations)
  const positions = []
  const line = (a, b) => positions.push(a.x, y, a.z, b.x, y, b.z)
  for (let index = 1; index < outline.length; index += 1) {
    line(outline[index - 1].left, outline[index].left)
    line(outline[index - 1].right, outline[index].right)
  }
  for (let index = 0; index < stations.length; index += 1) {
    line(stations[index].left, stations[index].right)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

export function createSandboxRoadEditor(THREE, deps) {
  const {
    scene,
    domElement,
    camera,
    getGroundPoint,
    getPlacementConflict,
    getWorldBounds,
    commitRoadEdit,
    insertBreakpointAt,
    onChange,
    requestFrame = () => {},
  } = deps

  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const handleWorld = new THREE.Vector3()
  let model = null
  let editorRoot = null
  let handles = []
  let centerHandles = []
  let proxy = null
  let guides = null
  let drag = null
  let lastSolution = null
  let breakpointPick = false

  function currentWidth() {
    return Math.max(...getRoadEdgeStations(model).map(stationSeparation))
  }

  function currentLength() {
    return pointsTotalLength(edgeStationsToPoints(getRoadEdgeStations(model)))
  }

  // 道路顶面世界高度：预览带、引导线和手柄都要压在路面上方，避免被路面挡住。
  function roadSurfaceTopY() {
    if (!model) return 0
    const box = new THREE.Box3().setFromObject(model)
    return Number.isFinite(box.max.y) ? box.max.y : model.position.y
  }

  function setProxyColor(reason) {
    proxy?.material?.color?.set(reason ? BLOCKED_COLOR : LEGAL_COLOR)
  }

  function emit(phase, payload) {
    onChange?.({
      phase,
      id: model?.userData?.sandboxModelId ?? null,
      length: payload?.length ?? null,
      width: payload?.width ?? null,
      active: Boolean(payload?.active),
      reason: payload?.reason ?? null,
    })
  }

  function disposeEditorObject() {
    if (!editorRoot) return
    editorRoot.parent?.remove(editorRoot)
    disposeObject(editorRoot)
    editorRoot = null
    handles = []
    centerHandles = []
    proxy = null
    guides = null
  }

  function removeListeners() {
    if (!domElement) return
    domElement.removeEventListener('pointerdown', onPointerDown, true)
    domElement.removeEventListener('pointermove', onPointerMove, true)
    domElement.removeEventListener('pointerup', onPointerUp, true)
    domElement.removeEventListener('pointercancel', onPointerCancel, true)
    domElement.removeEventListener('lostpointercapture', onPointerCancel, true)
  }

  // 拾取兜底：射线偶尔会从圆柱手柄正中间穿过导致漏检（浮点精度），
  // 这里按屏幕距离再找一次最近的同类手柄，顺带让“点在手柄附近”也能抓住。
  function projectedHandleAt(event, candidates) {
    if (!candidates.length || !domElement) return null
    const rect = domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    let best = null
    let bestDistance = Infinity
    for (const handle of candidates) {
      handle.getWorldPosition(handleWorld).project(camera)
      const x = ((handleWorld.x + 1) / 2) * rect.width
      const y = ((1 - handleWorld.y) / 2) * rect.height
      const distance = Math.hypot(x - pointerX, y - pointerY)
      if (distance < bestDistance) {
        bestDistance = distance
        best = handle
      }
    }
    return bestDistance <= HANDLE_PICK_RADIUS_PX ? best : null
  }

  function updatePreview(stations) {
    if (!proxy) return
    const topY = roadSurfaceTopY()
    // 预览按与正式道路相同的曲线取样，拖断点时看到的就是最终弧度
    const outline = smoothRoadEdgeStations(stations)
    const oldGeometry = proxy.geometry
    proxy.geometry = buildRibbonGeometry(THREE, outline, topY + 0.02)
    oldGeometry?.dispose?.()
    proxy.visible = true
    const oldGuide = guides.geometry
    guides.geometry = buildGuideGeometry(THREE, stations, topY + 0.05)
    oldGuide?.dispose?.()
    guides.visible = true
    editorRoot.updateWorldMatrix(true, true)
  }

  function refreshHandlesAndProxy() {
    if (!model || !editorRoot) return
    model.updateMatrixWorld(true)
    const handleY = roadSurfaceTopY() + 0.1
    const edgeHandles = getRoadEdgeHandles(model)
    handles.forEach((handle, index) => {
      const edge = edgeHandles[index]
      if (!edge) return
      handle.position.set(edge.x, handleY, edge.z)
    })
    const stations = getRoadEdgeStations(model)
    centerHandles.forEach((handle, index) => {
      const station = stations[index]
      if (!station) return
      handle.position.set(
        (station.left.x + station.right.x) / 2,
        handleY,
        (station.left.z + station.right.z) / 2,
      )
    })
    updatePreview(stations)
    proxy.visible = false
    editorRoot.updateWorldMatrix(true, true)
  }

  function attach(nextModel) {
    if (!isAnyStretchableRoadModel(nextModel)) return false
    detach()
    model = nextModel
    editorRoot = new THREE.Group()
    editorRoot.name = EDITOR_ROOT_NAME

    const stationCount = getRoadEdgeStations(nextModel).length
    const handleGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 20)
    handles = []
    for (let stationIndex = 0; stationIndex < stationCount; stationIndex += 1) {
      for (const side of ['left', 'right']) {
        const handle = new THREE.Mesh(handleGeometry.clone(), new THREE.MeshBasicMaterial({ color: '#f0d98a' }))
        handle.name = `road-edge-handle-${stationIndex}-${side}`
        handle.userData.stationIndex = stationIndex
        handle.userData.side = side
        handle.userData.editorRole = 'road-edge-handle'
        editorRoot.add(handle)
        handles.push(handle)
      }
    }
    handleGeometry.dispose()
    // 中心手柄：一次拖动整个截面（左右缘一起走），宽度不变，用于快速拐弯/挪段。
    // 做得比角手柄小，且拾取时角手柄优先，避免拖角时误抓中心。
    const centerGeometry = new THREE.CylinderGeometry(0.32, 0.32, 0.26, 20)
    centerHandles = []
    for (let stationIndex = 0; stationIndex < stationCount; stationIndex += 1) {
      const handle = new THREE.Mesh(centerGeometry.clone(), new THREE.MeshBasicMaterial({ color: '#9ad0ff' }))
      handle.name = `road-center-handle-${stationIndex}`
      handle.userData.stationIndex = stationIndex
      handle.userData.editorRole = 'road-center-handle'
      editorRoot.add(handle)
      centerHandles.push(handle)
    }
    centerGeometry.dispose()

    proxy = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: LEGAL_COLOR,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    proxy.name = 'road-edit-proxy'
    proxy.userData.role = 'road-edit-proxy'
    proxy.visible = false
    proxy.renderOrder = 10
    editorRoot.add(proxy)

    guides = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: GUIDE_COLOR, transparent: true, opacity: 0.9 }),
    )
    guides.name = 'road-edit-guides'
    guides.userData.role = 'road-edit-guides'
    guides.renderOrder = 11
    editorRoot.add(guides)

    scene.add(editorRoot)
    domElement.addEventListener('pointerdown', onPointerDown, true)
    domElement.addEventListener('pointermove', onPointerMove, true)
    domElement.addEventListener('pointerup', onPointerUp, true)
    domElement.addEventListener('pointercancel', onPointerCancel, true)
    domElement.addEventListener('lostpointercapture', onPointerCancel, true)
    refreshHandlesAndProxy()
    requestFrame()
    return true
  }

  function detach() {
    if (drag) cancelDrag()
    breakpointPick = false
    removeListeners()
    releaseCapture()
    if (model) model.visible = true
    disposeEditorObject()
    model = null
    drag = null
    lastSolution = null
    requestFrame()
  }

  function isAttached() {
    return Boolean(editorRoot && model)
  }

  function getModelId() {
    return model?.userData?.sandboxModelId ?? null
  }

  function releaseCapture() {
    if (!drag || !domElement?.hasPointerCapture?.(drag.pointerId)) return
    domElement.releasePointerCapture(drag.pointerId)
  }

  function candidateBounds() {
    return new THREE.Box3().setFromObject(proxy)
  }

  function outsideWorldReason(bounds) {
    const world = getWorldBounds()
    const minX = world.centerX - world.width / 2
    const maxX = world.centerX + world.width / 2
    const minZ = world.centerZ - world.depth / 2
    const maxZ = world.centerZ + world.depth / 2
    const epsilon = 0.01
    if (bounds.min.x < minX - epsilon || bounds.max.x > maxX + epsilon
      || bounds.min.z < minZ - epsilon || bounds.max.z > maxZ + epsilon) {
      return '超出可建造世界边界'
    }
    return null
  }

  function evaluate(points) {
    const stations = points.map(point => ({
      left: { x: point.lx, z: point.lz },
      right: { x: point.rx, z: point.rz },
    }))
    updatePreview(stations)
    const bounds = candidateBounds()
    // 预览是零厚度的路面带，检查冲突时补一点垂直厚度，才能和同样贴地的其他道路判重。
    const conflictBounds = bounds.clone()
    conflictBounds.min.y -= 0.06
    conflictBounds.max.y += 0.06
    const reason = outsideWorldReason(bounds)
      || (areRoadPointsValid(points) ? null : '相邻控制点距离过近（至少 1m）')
      || getPlacementConflict(conflictBounds, { model, id: model.userData.sandboxModelId })
    setProxyColor(reason)
    const width = Math.max(...stations.map(stationSeparation))
    return { points, width, length: pointsTotalLength(points), bounds, reason }
  }

  function onPointerDown(event) {
    if (!isAttached() || drag || event.button !== 0) return
    const rect = domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(ndc, camera)
    // 角手柄优先：两者画面重叠时优先拖单侧边缘，避免误抓中心手柄连带另一侧。
    let hit = raycaster.intersectObjects(handles, false)[0]
    if (!hit) hit = raycaster.intersectObjects(centerHandles, false)[0]
    let pickedHandle = hit?.object || null
    if (!pickedHandle) {
      // 角手柄排在前面，距离相同时仍优先角手柄
      pickedHandle = projectedHandleAt(event, [...handles, ...centerHandles])
    }
    if (!pickedHandle) {
      // 加断点拾取：点击路面，在点击位置插入一个控制点
      if (breakpointPick) {
        const roadHit = raycaster.intersectObject(model, true)[0]
        if (roadHit) {
          event.preventDefault?.()
          event.stopImmediatePropagation?.()
          breakpointPick = false
          const added = insertBreakpointAt?.(getModelId(), { x: roadHit.point.x, z: roadHit.point.z })
          emit(added ? 'breakpoint-added' : 'breakpoint-failed', {
            active: false,
            reason: added ? null : '该位置无法添加断点，请避开已有控制点或换一段路',
          })
          requestFrame()
        }
      }
      return
    }
    const isCenterHandle = pickedHandle.userData.editorRole === 'road-center-handle'
    event.preventDefault?.()
    event.stopImmediatePropagation?.()
    domElement.setPointerCapture(event.pointerId)
    model.visible = false
    const stations = getRoadEdgeStations(model)
    if (isCenterHandle) {
      const ground = getGroundPoint(event)
      drag = {
        pointerId: event.pointerId,
        kind: 'center',
        stationIndex: pickedHandle.userData.stationIndex,
        startPointer: ground ? { x: ground.x, z: ground.z } : { x: 0, z: 0 },
        baseStations: stations.map(station => ({
          left: { x: station.left.x, z: station.left.z },
          right: { x: station.right.x, z: station.right.z },
        })),
      }
      lastSolution = {
        points: edgeStationsToPoints(stations),
        width: Math.max(...stations.map(stationSeparation)),
        length: pointsTotalLength(edgeStationsToPoints(stations)),
        movingEdge: null,
        reason: null,
      }
    } else {
      drag = {
        pointerId: event.pointerId,
        kind: 'edge',
        stationIndex: pickedHandle.userData.stationIndex,
        side: pickedHandle.userData.side,
      }
      const edgeHandles = getRoadEdgeHandles(model)
      const moving = edgeHandles.find(edge => edge.stationIndex === drag.stationIndex && edge.side === drag.side)
      lastSolution = {
        points: edgeStationsToPoints(stations),
        width: Math.max(...stations.map(stationSeparation)),
        length: pointsTotalLength(edgeStationsToPoints(stations)),
        movingEdge: moving ? { x: moving.x, z: moving.z } : null,
        reason: null,
      }
    }
    updatePreview(stations)
    setProxyColor(null)
    emit('dragging', { length: lastSolution.length, width: lastSolution.width, active: true, reason: null })
    requestFrame()
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return
    event.preventDefault?.()
    event.stopImmediatePropagation?.()
    const point = getGroundPoint(event)
    if (!point) return
    if (drag.kind === 'center') {
      const moved = translateRoadStation(drag.baseStations, drag.stationIndex, {
        x: point.x - drag.startPointer.x,
        z: point.z - drag.startPointer.z,
      })
      lastSolution = evaluate(edgeStationsToPoints(moved))
      lastSolution.movingEdge = null
      emit(lastSolution.reason ? 'blocked' : 'dragging', {
        length: lastSolution.length,
        width: lastSolution.width,
        active: true,
        reason: lastSolution.reason,
      })
      requestFrame()
      return
    }
    const solved = solveRoadEdgeDrag({
      edgeStations: getRoadEdgeStations(model),
      stationIndex: drag.stationIndex,
      side: drag.side,
      pointer: { x: point.x, z: point.z },
    })
    lastSolution = evaluate(solved.points)
    lastSolution.movingEdge = solved.movingEdge
    emit(lastSolution.reason ? 'blocked' : 'dragging', {
      length: lastSolution.length,
      width: lastSolution.width,
      active: true,
      reason: lastSolution.reason,
    })
    requestFrame()
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return
    event.preventDefault?.()
    event.stopImmediatePropagation?.()
    const solution = lastSolution
    const pointerId = drag.pointerId
    drag = null
    if (domElement.hasPointerCapture?.(pointerId)) domElement.releasePointerCapture(pointerId)
    if (!solution) return
    if (solution.reason) {
      model.visible = true
      proxy.visible = false
      refreshHandlesAndProxy()
      emit('blocked', { length: currentLength(), width: currentWidth(), active: false, reason: solution.reason })
      requestFrame()
      return
    }
    const result = commitRoadEdit(model, solution)
    if (!result?.ok || !result.replacement) {
      model.visible = true
      proxy.visible = false
      refreshHandlesAndProxy()
      emit('blocked', {
        length: currentLength(),
        width: currentWidth(),
        active: false,
        reason: result?.reason || '道路提交失败',
      })
      return
    }
    const committedLength = solution.length
    const committedWidth = solution.width
    attach(result.replacement)
    emit('committed', { length: committedLength, width: committedWidth, active: false, reason: null })
    requestFrame()
  }

  function cancelDrag() {
    if (!drag) return false
    const pointerId = drag.pointerId
    drag = null
    if (domElement?.hasPointerCapture?.(pointerId)) domElement.releasePointerCapture(pointerId)
    model.visible = true
    proxy.visible = false
    lastSolution = null
    refreshHandlesAndProxy()
    emit('cancelled', { length: currentLength(), width: currentWidth(), active: false, reason: null })
    requestFrame()
    return true
  }

  function onPointerCancel(event) {
    if (!drag || event.pointerId !== drag.pointerId) return
    event.preventDefault?.()
    event.stopImmediatePropagation?.()
    cancelDrag()
  }

  function handleEscape() {
    if (!isAttached()) return false
    if (breakpointPick) {
      breakpointPick = false
      emit('breakpoint-cancelled', { active: false, reason: null })
      requestFrame()
      return true
    }
    if (drag) return cancelDrag()
    detach()
    return true
  }

  // 加断点拾取：下一次点击路面时在该位置插入一个控制点。
  function beginBreakpointPick() {
    if (!isAttached()) return false
    breakpointPick = true
    emit('breakpoint-pick', { active: false, reason: null })
    requestFrame()
    return true
  }

  function cancelBreakpointPick() {
    if (!breakpointPick) return false
    breakpointPick = false
    emit('breakpoint-cancelled', { active: false, reason: null })
    requestFrame()
    return true
  }

  function isBreakpointPicking() {
    return breakpointPick
  }

  function isDragging() {
    return Boolean(drag)
  }

  function dispose() {
    removeListeners()
    releaseCapture()
    disposeEditorObject()
    model = null
    drag = null
    lastSolution = null
    breakpointPick = false
  }

  return {
    attach,
    detach,
    isAttached,
    getModelId,
    pointerDown: onPointerDown,
    pointerMove: onPointerMove,
    pointerUp: onPointerUp,
    cancelDrag,
    handleEscape,
    beginBreakpointPick,
    cancelBreakpointPick,
    isBreakpointPicking,
    dispose,
    isDragging,
  }
}
