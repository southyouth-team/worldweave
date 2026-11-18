/**
 * Player visual assets are mounted under a stable character anchor.
 * The anchor remains owned by CameraRig/InputController; this runtime only
 * manages the rendered model and its animation state.
 */
export class PlayerCharacterRuntime {
  constructor(THREE, anchor) {
    if (!THREE || !anchor?.isObject3D) throw new TypeError('角色运行时需要 THREE 和有效的角色根节点')
    this.THREE = THREE
    this.anchor = anchor
    this.fallbackUpdater = anchor.userData?.updateAnimation || null
    this.fallbackVisual = new THREE.Group()
    this.fallbackVisual.name = 'player-character-fallback'
    const preserved = []
    for (const child of [...anchor.children]) {
      if (child.name === 'avatar-ground-marker' || child.name === 'player-contact-shadow') preserved.push(child)
      else this.fallbackVisual.add(child)
    }
    anchor.add(this.fallbackVisual)
    this.activeVisual = this.fallbackVisual
    this.mixer = null
    this.actions = new Map()
    this.activeAction = null
    this.assetId = 'builtin-placeholder'
    this.dimensions = { width: 0.5, height: 1.7, depth: 0.3, eyeHeight: 1.7, colliderRadius: 0.35 }
    this.animationState = 'idle'
    this.animationOverride = null
    this.smoothedGaitRate = 1
    this.lastAnimationSeconds = null
    this.disposed = false
    anchor.userData.updateAnimation = (moving, seconds, dx, dz, running, gaitRate, airborne) => this.updateAnimation(moving, seconds, dx, dz, running, gaitRate, airborne)
  }

  setModel(model, animations = [], metadata = {}) {
    if (this.disposed) throw new Error('角色运行时已释放')
    if (!model?.isObject3D || model === this.anchor || model.parent) {
      throw new TypeError('角色模型必须是未挂载的 THREE.Object3D')
    }
    // 在分段骨架接管模型之前保存原始模型快照，保证存档恢复拿到的是未改动的完整模型。
    let sourceSnapshot = null
    try {
      sourceSnapshot = model.toJSON()
    } catch {
      sourceSnapshot = null
    }
    model.updateMatrixWorld(true)
    const bounds = new this.THREE.Box3().setFromObject(model)
    const size = bounds.getSize(new this.THREE.Vector3())
    if (bounds.isEmpty() || !Number.isFinite(size.y) || size.y <= 0.001) {
      throw new TypeError('角色模型缺少有效的三维尺寸')
    }

    const targetHeight = Math.max(0.5, Math.min(5, Number(metadata.targetHeight) || 2.25))
    const scale = targetHeight / size.y
    const wrapper = new this.THREE.Group()
    wrapper.name = 'player-character-asset'
    wrapper.userData.assetId = String(metadata.assetId || metadata.sourceUrl || 'external-glb')
    wrapper.scale.setScalar(scale)
    wrapper.position.set(
      -((bounds.min.x + bounds.max.x) / 2) * scale,
      -bounds.min.y * scale,
      -((bounds.min.z + bounds.max.z) / 2) * scale,
    )
    // 外部角色模型遵循世界统一的真实投影/接收规则，不继承来源文件中可能关闭的阴影标记。
    model.traverse(object => {
      if (!object.isMesh) return
      object.castShadow = true
      object.receiveShadow = true
    })
    wrapper.add(model)
    wrapper.updateMatrixWorld(true)
    const normalizedWidth = size.x * scale
    const normalizedDepth = size.z * scale
    this.dimensions = {
      width: normalizedWidth,
      height: size.y * scale,
      depth: normalizedDepth,
      eyeHeight: Math.max(0.8, Math.min(2.8, size.y * scale * 0.76)),
      colliderRadius: Math.max(0.24, Math.min(0.62, Math.max(normalizedWidth, normalizedDepth) * 0.28)),
    }

    this.clearMixer()
    if (this.activeVisual !== this.fallbackVisual) {
      this.anchor.remove(this.activeVisual)
      this.disposeObject(this.activeVisual)
    } else {
      this.fallbackVisual.visible = false
    }
    this.activeVisual = wrapper
    this.anchor.add(wrapper)
    this.assetId = wrapper.userData.assetId
    this.actions.clear()
    this.mixer = Array.isArray(animations) && animations.length
      ? new this.THREE.AnimationMixer(model)
      : null
    for (const clip of animations || []) {
      if (!clip?.name || !this.mixer) continue
      const key = clip.name.toLowerCase()
      if (/idle|stand|wait/.test(key)) this.actions.set('idle', this.mixer.clipAction(clip))
      else if (/walk|move/.test(key)) this.actions.set('walk', this.mixer.clipAction(clip))
      else if (/run|sprint/.test(key)) this.actions.set('run', this.mixer.clipAction(clip))
    }
    if (this.mixer && Array.isArray(animations) && animations.length && !this.actions.has('idle')) {
      const firstClip = (animations || []).find(clip => clip?.name)
      if (firstClip) this.actions.set('idle', this.mixer.clipAction(firstClip))
    }
    this.animationState = 'idle'
    this.animationOverride = null
    this.proceduralRig = this.mixer ? null : this.buildProceduralRig(wrapper)
    this.baseWrapperPosition = wrapper.position.clone()
    this.baseWrapperRotation = wrapper.rotation.clone()
    this.gaitPhase = 0
    this.sourceSnapshot = sourceSnapshot
    this.characterMetadata = { ...metadata }
    this.playState('idle')
    return this.getInfo()
  }

  // 导出可存档的角色数据：原始模型 JSON + 关键元数据。默认角色返回 null。
  serialize() {
    if (this.disposed || this.activeVisual === this.fallbackVisual || !this.sourceSnapshot) return null
    return {
      assetId: this.assetId,
      targetHeight: this.dimensions?.height || undefined,
      prompt: this.characterMetadata?.prompt || null,
      source: this.characterMetadata?.source || 'external',
      object: this.sourceSnapshot,
    }
  }

  // 没有动画片段的生成角色：复用默认角色的程序化关节驱动。
  // 先按命名识别肢体；识别不到时，按部件空间位置把它们绑定到默认角色的
  // 髋/肩/头关节上（分段骨架），让没有骨架的模型也能抬腿摆臂。
  buildProceduralRig(wrapper) {
    const patterns = {
      leftLeg: /left.*(leg|thigh|shin|foot)|(^|[-_ ])l(leg|thigh|foot)/i,
      rightLeg: /right.*(leg|thigh|shin|foot)|(^|[-_ ])r(leg|thigh|foot)/i,
      leftArm: /left.*(arm|forearm|hand|shoulder)|(^|[-_ ])l(arm|hand)/i,
      rightArm: /right.*(arm|forearm|hand|shoulder)|(^|[-_ ])r(arm|hand)/i,
      head: /head|skull|neck/i,
    }
    const limbs = {}
    wrapper.traverse(object => {
      if (!object.name) return
      for (const [key, pattern] of Object.entries(patterns)) {
        if (!limbs[key] && pattern.test(object.name)) {
          limbs[key] = {
            object,
            rotation: object.rotation.clone(),
          }
        }
      }
    })
    if (Object.keys(limbs).length > 0) return { limbs, hasLimbs: true }
    return this.buildSegmentedRig(wrapper)
  }

  // 分段骨架：按部件中心点的高度/左右位置，把模型部件分配到默认关节。
  // 头 >82% 身高；腿 <45% 身高；手臂为中层两侧；其余归躯干。
  buildSegmentedRig(wrapper) {
    const meshes = []
    wrapper.traverse(object => { if (object.isMesh) meshes.push(object) })
    if (meshes.length < 2) return { limbs: {}, hasLimbs: false }

    wrapper.updateMatrixWorld(true)
    const totalWorld = new this.THREE.Box3().setFromObject(wrapper)
    // 关节位置必须放在 wrapper 局部坐标系里（rigRoot 与 wrapper 同帧），不能直接用世界坐标。
    const total = {
      min: wrapper.worldToLocal(totalWorld.min.clone()),
      max: wrapper.worldToLocal(totalWorld.max.clone()),
    }
    const height = total.max.y - total.min.y
    const width = total.max.x - total.min.x
    if (!(height > 0.01)) return { limbs: {}, hasLimbs: false }

    const rigRoot = new this.THREE.Group()
    rigRoot.name = 'player-segmented-rig'
    wrapper.add(rigRoot)
    const makeJoint = (name, x, y) => {
      const joint = new this.THREE.Group()
      joint.name = name
      joint.position.set(x, y, 0)
      rigRoot.add(joint)
      return joint
    }
    const hipY = total.min.y + height * 0.46
    const shoulderY = total.min.y + height * 0.72
    const headY = total.min.y + height * 0.88
    const legOffset = Math.max(0.08, width * 0.18)
    const armOffset = Math.max(0.16, width * 0.32)
    const joints = {
      leftLeg: makeJoint('player-left-leg', -legOffset, hipY),
      rightLeg: makeJoint('player-right-leg', legOffset, hipY),
      leftArm: makeJoint('player-left-arm', -armOffset, shoulderY),
      rightArm: makeJoint('player-right-arm', armOffset, shoulderY),
      head: makeJoint('player-head', 0, headY),
      body: makeJoint('player-body', 0, 0),
    }

    const center = new this.THREE.Vector3()
    for (const mesh of meshes) {
      const bounds = new this.THREE.Box3().setFromObject(mesh)
      bounds.getCenter(center)
      wrapper.worldToLocal(center)
      const x = center.x
      const y = center.y
      let target = joints.body
      if (y > total.min.y + height * 0.82) target = joints.head
      else if (y < total.min.y + height * 0.45) target = x < 0 ? joints.leftLeg : joints.rightLeg
      else if (Math.abs(x) > width * 0.28) target = x < 0 ? joints.leftArm : joints.rightArm
      target.attach(mesh)
    }
    const limbs = {}
    for (const key of ['leftLeg', 'rightLeg', 'leftArm', 'rightArm', 'head']) {
      limbs[key] = { object: joints[key], rotation: joints[key].rotation.clone() }
    }
    return { limbs, hasLimbs: true, segmented: true }
  }

  resetProceduralPose() {
    if (!this.proceduralRig) return
    for (const limb of Object.values(this.proceduralRig.limbs)) {
      limb.object.rotation.copy(limb.rotation)
    }
    if (this.baseWrapperRotation) this.activeVisual.rotation.copy(this.baseWrapperRotation)
  }

  applyProceduralGait(moving, seconds, running, airborne, frameDelta = 0) {
    if (!this.proceduralRig || !this.activeVisual) return
    const strideLength = running ? 5.5 : 3.2
    const nominalSpeed = running ? 18 : 9
    if (moving && !airborne) {
      const cycle = (nominalSpeed / strideLength) * Math.PI * 2
      this.gaitPhase += frameDelta * cycle * this.smoothedGaitRate
    }
    const stride = moving && !airborne ? Math.sin(this.gaitPhase) : 0
    const bob = airborne
      ? 0.02
      : moving
        ? Math.abs(Math.sin(this.gaitPhase * 2)) * 0.045
        : Math.sin(seconds * 2.2) * 0.008
    if (this.baseWrapperPosition) this.activeVisual.position.y = this.baseWrapperPosition.y + bob

    const limbs = this.proceduralRig.limbs
    const applyRotation = (key, x, z = 0) => {
      const limb = limbs[key]
      if (!limb) return
      limb.object.rotation.set(limb.rotation.x + x, limb.rotation.y, limb.rotation.z + z)
    }
    if (airborne) {
      // 跳跃姿态：双腿收拢、双臂上举，复用默认角色的跳起语义
      applyRotation('leftLeg', 0.35)
      applyRotation('rightLeg', -0.35)
      applyRotation('leftArm', -1.0)
      applyRotation('rightArm', -1.0)
      applyRotation('head', 0, 0)
    } else {
      applyRotation('leftLeg', stride * 0.48)
      applyRotation('rightLeg', -stride * 0.48)
      applyRotation('leftArm', -stride * 0.38)
      applyRotation('rightArm', stride * 0.38)
      applyRotation('head', 0, moving ? Math.sin(this.gaitPhase) * 0.025 : Math.sin(seconds * 1.6) * 0.012)
    }
    if (!this.proceduralRig.hasLimbs && this.baseWrapperRotation) {
      // 没有可识别肢体的整体模型：用整体俯仰/侧摆表达走跳，避免完全静止
      this.activeVisual.rotation.x = this.baseWrapperRotation.x + (airborne ? -0.08 : moving ? 0.05 : 0)
      this.activeVisual.rotation.z = this.baseWrapperRotation.z + (moving && !airborne ? Math.sin(this.gaitPhase) * 0.04 : 0)
    }
  }

  playState(state) {
    const next = this.actions.get(state) || (state === 'run' ? this.actions.get('walk') : null)
      || (state !== 'idle' ? this.actions.get('idle') : null)
      || this.actions.values().next().value
    if (!next || next === this.activeAction) return Boolean(next)
    // 输入驱动的移动/跳跃动画即时切换，不做淡入延迟。
    next.reset().play()
    if (this.activeAction && this.activeAction !== next) this.activeAction.stop()
    this.activeAction = next
    return true
  }

  setAnimationState(state) {
    if (state === null || state === 'auto') {
      this.animationOverride = null
      return true
    }
    const normalized = ['idle', 'walk', 'run'].includes(String(state)) ? String(state) : null
    if (!normalized) return false
    this.animationOverride = normalized
    this.animationState = normalized
    if (this.activeVisual !== this.fallbackVisual) this.playState(normalized)
    return true
  }

  updateAnimation(moving, seconds, dx = 0, dz = 0, running = false, gaitRate = 1, airborne = false) {
    if (this.disposed) return
    if (Math.hypot(dx, dz) > 0.0005) this.anchor.rotation.y = Math.atan2(dx, dz)
    const targetGaitRate = Math.max(0.35, Math.min(1.5, Number(gaitRate) || 1))
    const animationDelta = this.lastAnimationSeconds === null
      ? 0
      : Math.max(0, Math.min(0.1, Number(seconds) - this.lastAnimationSeconds))
    this.lastAnimationSeconds = Number.isFinite(Number(seconds)) ? Number(seconds) : this.lastAnimationSeconds
    // Rapier publishes actualVelocity once per fixed step, while animation is evaluated per render frame.
    // Filter that sampled signal in the presentation layer so fixed-step quantization does not become visible gait-speed jitter.
    const blend = animationDelta > 0 ? 1 - Math.exp(-animationDelta / 0.09) : 1
    this.smoothedGaitRate += (targetGaitRate - this.smoothedGaitRate) * blend
    if (this.activeVisual === this.fallbackVisual) {
      this.fallbackUpdater?.call(this.anchor, Boolean(moving), seconds, dx, dz, this.smoothedGaitRate, Boolean(running))
      return
    }
    const state = this.animationOverride || (moving ? (running ? 'run' : 'walk') : 'idle')
    if (state !== this.animationState || !this.activeAction) this.animationState = state
    this.playState(state)
    if (this.activeAction && moving && !this.animationOverride) {
      this.activeAction.timeScale = this.smoothedGaitRate
    } else if (this.activeAction && state === 'idle') {
      this.activeAction.timeScale = 1
    }
    if (!this.mixer) this.applyProceduralGait(Boolean(moving), Number(seconds) || 0, Boolean(running), Boolean(airborne), animationDelta)
  }

  update(deltaSeconds) {
    this.mixer?.update(Math.max(0, Math.min(Number(deltaSeconds) || 0, 0.1)))
  }

  getInfo() {
    return {
      assetId: this.assetId,
      hasExternalModel: this.activeVisual !== this.fallbackVisual,
      dimensions: { ...this.dimensions },
      animations: [...this.actions.keys()],
      animationState: this.animationState,
    }
  }

  clearMixer() {
    if (this.mixer) {
      this.mixer.stopAllAction()
      this.mixer.uncacheRoot(this.mixer.getRoot())
    }
    this.mixer = null
    this.activeAction = null
    this.actions.clear()
  }

  disposeObject(root) {
    root?.traverse?.(object => {
      object.geometry?.dispose?.()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        if (!material) continue
        for (const value of Object.values(material)) {
          if (value?.isTexture) value.dispose()
        }
        material.dispose?.()
      }
    })
  }

  restoreFallback() {
    if (this.disposed) return false
    this.clearMixer()
    if (this.activeVisual !== this.fallbackVisual) {
      this.anchor.remove(this.activeVisual)
      this.disposeObject(this.activeVisual)
      this.activeVisual = this.fallbackVisual
      this.fallbackVisual.visible = true
    }
    // 清空程序化骨架状态，避免切回默认角色后仍引用已释放的关节或偏移。
    this.proceduralRig = null
    this.baseWrapperPosition = null
    this.baseWrapperRotation = null
    this.gaitPhase = 0
    this.sourceSnapshot = null
    this.characterMetadata = null
    this.assetId = 'builtin-placeholder'
    this.dimensions = { width: 0.5, height: 1.7, depth: 0.3, eyeHeight: 1.7, colliderRadius: 0.35 }
    this.animationState = 'idle'
    this.animationOverride = null
    return true
  }

  dispose() {
    if (this.disposed) return
    this.clearMixer()
    if (this.activeVisual !== this.fallbackVisual) {
      this.anchor.remove(this.activeVisual)
      this.disposeObject(this.activeVisual)
    }
    this.disposed = true
  }
}
