import * as THREE from 'three'
import { polygonBounds } from './footprintPolygon.js'

const MIN_SCALE = 0.05
const MAX_SCALE = 20

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

// 把生成出来的模型对齐到已勾绘的占地轮廓（当地坐标，重心在原点，Y=0 为地面）。
// area：底面外接框贴满轮廓；space：等比缩小到轮廓范围内，但不放大。
// 两种模式都会把模型底面压到 y=0，并把水平中心移到轮廓重心。
export function fitModelToFootprint(model, points, mode = 'area') {
  if (!model?.isObject3D || !Array.isArray(points) || points.length < 3) return null
  if (mode !== 'area' && mode !== 'space') return null
  const bounds = polygonBounds(points)
  if (!(bounds.width > 0) || !(bounds.depth > 0)) return null

  model.updateWorldMatrix(true, true)
  const before = new THREE.Box3().setFromObject(model)
  if (before.isEmpty()) return null
  const size = before.getSize(new THREE.Vector3())
  if (!(size.x > 0) || !(size.z > 0)) return null

  let scaleX = 1
  let scaleZ = 1
  if (mode === 'area') {
    scaleX = clamp(bounds.width / size.x, MIN_SCALE, MAX_SCALE)
    scaleZ = clamp(bounds.depth / size.z, MIN_SCALE, MAX_SCALE)
  } else {
    const uniform = Math.min(
      1,
      bounds.width / size.x,
      bounds.depth / size.z,
    )
    scaleX = scaleZ = clamp(uniform, MIN_SCALE, 1)
  }

  model.scale.x *= scaleX
  model.scale.z *= scaleZ
  model.updateWorldMatrix(true, true)

  const after = new THREE.Box3().setFromObject(model)
  const center = after.getCenter(new THREE.Vector3())
  model.position.x -= center.x
  model.position.z -= center.z
  model.position.y -= after.min.y
  model.updateWorldMatrix(true, true)

  return {
    mode,
    scaleX,
    scaleZ,
    width: bounds.width,
    depth: bounds.depth,
  }
}
