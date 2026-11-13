import {
  getRoadEndpoints,
  isStretchableRoadModel,
  solveRoadEndpointDrag,
} from '../sandbox/roadEndpointMath.js'

const EDITOR_ROOT_NAME = '_sandboxRoadEditor'
const LEGAL_COLOR = '#8bd5a5'
const BLOCKED_COLOR = '#e66b68'
const AXIS_SNAP_EPSILON = 1e-6
const LENGTH_PRECISION = 1000

function normalizeRoadSolution(solution, fixedEnd) {
  let dx = solution.direction.x
  let dz = solution.direction.z
  if (Math.abs(dx) > 1 - AXIS_SNAP_EPSILON) {
    dx = Math.sign(dx) || 1
    dz = 0
  } else if (Math.abs(dz) > 1 - AXIS_SNAP_EPSILON) {
    dx = 0
    dz = Math.sign(dz) || 1
  }
  const length = Math.round(solution.length * LENGTH_PRECISION) / LENGTH_PRECISION
  const movingEnd = {
    x: fixedEnd.x + dx * length,
    y: fixedEnd.y,
    z: fixedEnd.z + dz * length,
  }
  const rotationY = Math.atan2(-dz, dx) || 0
  return {
    ...solution,
    length,
    direction: { x: dx, z: dz },
    movingEnd,
    position: {
      x: fixedEnd.x + dx * length / 2,
      y: fixedEnd.y,
      z: fixedEnd.z + dz * length / 2,
    },
    rotation: { x: 0, y: rotationY, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  }
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
    onChange,
    requestFrame = () => {},
  } = deps

  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  let model = null
  let editorRoot = null
  let handles = []
  let proxy = null
  let drag = null
  let lastSolution = null

  function emit(phase, payload) {
    onChange?.({
      phase,
      id: model?.userData?.sandboxModelId ?? null,
      length: payload?.length ?? model?.userData?.proceduralRoad?.length ?? null,
      active: Boolean(payload?.active),
      reason: payload?.reason ?? null,
    })
  }

  function disposeEditorObject() {
    if (!editorRoot) return
    editorRoot.parent?.remove(editorRoot)
    editorRoot.traverse(object => {
      object.geometry?.dispose?.()
      if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.())
      else object.material?.dispose?.()
    })
    editorRoot = null
    handles = []
    proxy = null
  }

  function removeListeners() {
    if (!domElement) return
    domElement.removeEventListener('pointerdown', onPointerDown, true)
    domElement.removeEventListener('pointermove', onPointerMove, true)
    domElement.removeEventListener('pointerup', onPointerUp, true)
    domElement.removeEventListener('pointercancel', onPointerCancel, true)
    domElement.removeEventListener('lostpointercapture', onPointerCancel, true)
  }

  function refreshHandlesAndProxy() {
    if (!model || !editorRoot) return
    model.updateMatrixWorld(true)
    const endpoints = getRoadEndpoints(model)
    handles.forEach((handle, index) => {
      handle.position.copy(endpoints[index])
    })
    const road = model.userData.proceduralRoad
    proxy.visible = false
    proxy.position.set(model.position.x, model.position.y + 0.02, model.position.z)
    proxy.quaternion.copy(model.quaternion)
    proxy.scale.set(road.length, 1, road.width)
    editorRoot.updateWorldMatrix(true, true)
  }

  function attach(nextModel) {
    if (!isStretchableRoadModel(nextModel)) return false
    detach()
    model = nextModel
    editorRoot = new THREE.Group()
    editorRoot.name = EDITOR_ROOT_NAME

    const handleGeometry = new THREE.CylinderGeometry(0.45, 0.45, 0.34, 24)
    const handleMaterial = new THREE.MeshBasicMaterial({ color: '#f0d98a' })
    handles = [0, 1].map((endpointIndex) => {
      const handle = new THREE.Mesh(handleGeometry.clone(), handleMaterial.clone())
      handle.name = `road-endpoint-handle-${endpointIndex}`
      handle.userData.endpointIndex = endpointIndex
      handle.userData.editorRole = 'road-endpoint-handle'
      editorRoot.add(handle)
      return handle
    })
    handleGeometry.dispose()

    proxy = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.04, 1),
      new THREE.MeshBasicMaterial({
        color: LEGAL_COLOR,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
      }),
    )
    proxy.name = 'road-edit-proxy'
    proxy.userData.role = 'road-edit-proxy'
    proxy.visible = false
    proxy.renderOrder = 10
    editorRoot.add(proxy)

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

  function setProxyFromSolution(solution) {
    proxy.visible = true
    proxy.position.set(solution.position.x, solution.position.y + 0.02, solution.position.z)
    proxy.rotation.set(solution.rotation.x, solution.rotation.y, solution.rotation.z)
    proxy.scale.set(solution.length, 1, model.userData.proceduralRoad.width)
    handles[drag.endpointIndex].position.set(
      solution.movingEnd.x,
      solution.movingEnd.y,
      solution.movingEnd.z,
    )
    editorRoot.updateWorldMatrix(true, true)
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

  function evaluateSolution(solution) {
    setProxyFromSolution(solution)
    const bounds = candidateBounds()
    const reason = outsideWorldReason(bounds)
      || getPlacementConflict(bounds, { model, id: model.userData.sandboxModelId })
    proxy.material.color.set(reason ? BLOCKED_COLOR : LEGAL_COLOR)
    return { ...solution, reason, bounds }
  }

  function currentFallbackDirection() {
    const endpoints = getRoadEndpoints(model)
    return {
      x: endpoints[1].x - endpoints[0].x,
      z: endpoints[1].z - endpoints[0].z,
    }
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
    const hit = raycaster.intersectObjects(handles, false)[0]
    if (!hit) return
    event.preventDefault?.()
    event.stopImmediatePropagation?.()
    domElement.setPointerCapture(event.pointerId)
    const endpoints = getRoadEndpoints(model)
    const endpointIndex = hit.object.userData.endpointIndex
    drag = { pointerId: event.pointerId, endpointIndex }
    model.visible = false
    const road = model.userData.proceduralRoad
    lastSolution = {
      length: road.length,
      position: { x: model.position.x, y: model.position.y, z: model.position.z },
      rotation: { x: model.rotation.x, y: model.rotation.y, z: model.rotation.z },
      scale: { x: 1, y: 1, z: 1 },
      movingEnd: endpoints[endpointIndex],
      reason: null,
    }
    setProxyFromSolution(lastSolution)
    proxy.material.color.set(LEGAL_COLOR)
    emit('dragging', { length: lastSolution.length, active: true, reason: null })
    requestFrame()
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return
    event.preventDefault?.()
    event.stopImmediatePropagation?.()
    const point = getGroundPoint(event)
    if (!point) return
    const endpoints = getRoadEndpoints(model)
    const fixedEnd = endpoints[1 - drag.endpointIndex]
    const solved = solveRoadEndpointDrag({
      fixedEnd,
      pointer: point,
      fallbackDirection: currentFallbackDirection(),
      rootY: model.position.y,
    })
    const solution = normalizeRoadSolution(solved, fixedEnd)
    lastSolution = evaluateSolution(solution)
    emit(lastSolution.reason ? 'blocked' : 'dragging', {
      length: lastSolution.length,
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
      emit('blocked', { length: model.userData.proceduralRoad.length, active: false, reason: solution.reason })
      requestFrame()
      return
    }
    const result = commitRoadEdit(model, solution)
    if (!result?.ok || !result.replacement) {
      model.visible = true
      proxy.visible = false
      refreshHandlesAndProxy()
      emit('blocked', {
        length: model.userData.proceduralRoad.length,
        active: false,
        reason: result?.reason || '道路提交失败',
      })
      return
    }
    const committedLength = solution.length
    model = result.replacement
    refreshHandlesAndProxy()
    emit('committed', { length: committedLength, active: false, reason: null })
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
    emit('cancelled', {
      length: model.userData.proceduralRoad.length,
      active: false,
      reason: null,
    })
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
    if (drag) return cancelDrag()
    detach()
    return true
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
    dispose,
    isDragging,
  }
}
