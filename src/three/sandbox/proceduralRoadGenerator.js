import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ROAD_OBJECT_TYPES, clampRoadLength } from './roadEndpointMath.js'

export const ROAD_DEFINITIONS = Object.freeze([
  Object.freeze({ objectType: 'asphalt-road', label: '柏油路', defaultLength: 24, width: 6 }),
  Object.freeze({ objectType: 'concrete-road', label: '水泥路', defaultLength: 20, width: 4 }),
  Object.freeze({ objectType: 'brick-walkway', label: '砖石人行道', defaultLength: 16, width: 2.4 }),
  Object.freeze({ objectType: 'stone-path', label: '石板步道', defaultLength: 12, width: 2 }),
])

const DEFINITION_BY_TYPE = Object.freeze(Object.fromEntries(
  ROAD_DEFINITIONS.map(definition => [definition.objectType, definition]),
))

function standardMaterial(color, roughness) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })
}

function createMergedMesh(THREE, name, material, boxes, roadFeature) {
  const geometries = boxes.map(box => {
    const geometry = new THREE.BoxGeometry(box.size.x, box.size.y, box.size.z)
    geometry.translate(box.position.x, box.position.y, box.position.z)
    return geometry.toNonIndexed()
  })
  const geometry = geometries.length ? mergeGeometries(geometries, false) : new THREE.BufferGeometry()
  for (const part of geometries) part.dispose()
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.userData.proceduralShape = `road-${name}`

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.roadFeature = Object.freeze({ ...roadFeature })
  return mesh
}

function addBase(root, THREE, name, material, length, width, topY, thickness) {
  const source = new THREE.BoxGeometry(length, thickness, width)
  source.translate(0, topY - thickness / 2, 0)
  const geometry = source.toNonIndexed()
  source.dispose()
  geometry.computeBoundingBox()
  geometry.userData.proceduralShape = `road-${name}`
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.roadFeature = Object.freeze({ length, width, topY, thickness })
  root.add(mesh)
  return mesh
}

function centerGrid(length, spacing) {
  const max = Math.floor((length / 2) / spacing)
  const centers = []
  for (let index = -max; index <= max; index += 1) centers.push(index * spacing)
  return centers
}

function createAsphaltRoad(THREE, root, { length, width }, materials) {
  addBase(root, THREE, 'asphalt-surface', materials.surface, length, width, 0.08, 0.08)

  const edgeBoxes = [-1, 1].map(side => ({
    size: { x: length - 0.4, y: 0.012, z: 0.12 },
    position: { x: 0, y: 0.086, z: side * (width / 2 - 0.28) },
  }))
  root.add(createMergedMesh(THREE, 'asphalt-edge-line', materials.edge, edgeBoxes, {
    unitDepth: 0.12,
    count: 2,
  }))

  const yellowBoxes = [-1, 1].map(side => ({
    size: { x: Math.max(0, length - 0.8), y: 0.012, z: 0.08 },
    position: { x: 0, y: 0.087, z: side * 0.07 },
  })).filter(box => box.size.x > 0)
  root.add(createMergedMesh(THREE, 'asphalt-center-yellow', materials.yellow, yellowBoxes, {
    unitDepth: 0.08,
    gap: 0.06,
    count: yellowBoxes.length,
  }))
}

function createConcreteRoad(THREE, root, { length, width }, materials) {
  addBase(root, THREE, 'concrete-slab', materials.surface, length, width, 0.075, 0.075)
  const borderBoxes = [-1, 1].map(side => ({
    size: { x: length, y: 0.018, z: 0.16 },
    position: { x: 0, y: 0.084, z: side * (width / 2 - 0.08) },
  }))
  root.add(createMergedMesh(THREE, 'concrete-border', materials.border, borderBoxes, {
    unitDepth: 0.16,
    count: 2,
  }))

  const seamCenters = centerGrid(length, 4).filter(center => Math.abs(center) + 0.0175 <= length / 2)
  const seamBoxes = seamCenters.map(center => ({
    size: { x: 0.035, y: 0.012, z: width - 0.24 },
    position: { x: center, y: 0.084, z: 0 },
  }))
  root.add(createMergedMesh(THREE, 'concrete-expansion-seam', materials.seam, seamBoxes, {
    spacing: 4,
    unitLength: 0.035,
    unitDepth: 4,
    count: seamBoxes.length,
  }))
}

function gridBoxes(length, width, unitLength, unitDepth, gap, offsetRow = false, minSpan = 0.15) {
  const pitchX = unitLength + gap
  const pitchZ = unitDepth + gap
  const rowCenters = []
  for (let z = -width / 2 + unitDepth / 2; z + unitDepth / 2 <= width / 2 + 1e-9; z += pitchZ) {
    rowCenters.push(z)
  }
  const boxes = []
  rowCenters.forEach((z, rowIndex) => {
    const offset = offsetRow && rowIndex % 2 === 1 ? pitchX / 2 : 0
    for (let x = -length / 2 + unitLength / 2 + offset; x + unitLength / 2 <= length / 2 + 1e-9; x += pitchX) {
      const end = x + unitLength / 2
      const start = x - unitLength / 2
      if (start >= -length / 2 - 1e-9 && end <= length / 2 + 1e-9) {
        boxes.push({
          size: { x: unitLength, y: 0.05, z: unitDepth },
          position: { x, y: 0.065, z },
        })
      }
    }
  })
  return boxes.filter(box => box.size.x >= minSpan)
}

function createBrickWalkway(THREE, root, { length, width }, materials) {
  addBase(root, THREE, 'brick-base', materials.base, length, width, 0.028, 0.028)
  const borderBoxes = [-1, 1].map(side => ({
    size: { x: length, y: 0.025, z: 0.1 },
    position: { x: 0, y: 0.042, z: side * (width / 2 - 0.05) },
  }))
  root.add(createMergedMesh(THREE, 'brick-border', materials.border, borderBoxes, {
    unitDepth: 0.1,
    count: 2,
  }))

  const variants = [
    { suffix: 'a', material: materials.brickA, offsetRow: false },
    { suffix: 'b', material: materials.brickB, offsetRow: true },
  ]
  for (const variant of variants) {
    const boxes = gridBoxes(length, width - 0.24, 0.6, 0.3, 0.02, variant.offsetRow)
    root.add(createMergedMesh(THREE, `brick-paver-${variant.suffix}`, variant.material, boxes, {
      unitLength: 0.6,
      unitDepth: 0.3,
      gap: 0.02,
      staggered: variant.offsetRow,
      count: boxes.length,
    }))
  }
}

function stoneBoxes(length, width, offset) {
  const pitch = 1.24
  const boxes = []
  for (let x = -length / 2 + 0.6 + offset; x + 0.6 <= length / 2 + 1e-9; x += pitch) {
    if (x - 0.6 >= -length / 2 - 1e-9) {
      boxes.push({
        size: { x: 1.2, y: 0.05, z: width - 0.2 },
        position: { x, y: 0.05, z: 0 },
      })
    }
  }
  return boxes
}

function createStonePath(THREE, root, { length, width }, materials) {
  addBase(root, THREE, 'stone-joint-base', materials.base, length, width, 0.025, 0.025)
  const variants = [
    { suffix: 'a', material: materials.slabA, offset: 0 },
    { suffix: 'b', material: materials.slabB, offset: 0.62 },
  ]
  for (const variant of variants) {
    const boxes = stoneBoxes(length, width, variant.offset)
    root.add(createMergedMesh(THREE, `stone-slab-${variant.suffix}`, variant.material, boxes, {
      unitLength: 1.2,
      unitDepth: width - 0.2,
      gap: 0.04,
      count: boxes.length,
    }))
  }
}

export function createProceduralRoadModel(THREE, { objectType, length, width } = {}) {
  const definition = DEFINITION_BY_TYPE[objectType]
  if (!definition || !ROAD_OBJECT_TYPES.includes(objectType)) {
    throw new Error(`未知道路类型：${String(objectType)}`)
  }
  const effectiveLength = length === undefined ? definition.defaultLength : clampRoadLength(length)
  const effectiveWidth = width ?? definition.width
  if (typeof effectiveWidth !== 'number' || !Number.isFinite(effectiveWidth) || effectiveWidth <= 0) {
    throw new TypeError('道路宽度必须是正数')
  }

  const root = new THREE.Group()
  root.name = `${objectType}-root`
  const materials = {
    'asphalt-road': {
      surface: standardMaterial('#303438', 0.94),
      edge: standardMaterial('#e8e6dc', 0.72),
      yellow: standardMaterial('#d6a72b', 0.76),
    },
    'concrete-road': {
      surface: standardMaterial('#b9bbb6', 0.88),
      border: standardMaterial('#9f9f98', 0.9),
      seam: standardMaterial('#777a76', 0.92),
    },
    'brick-walkway': {
      base: standardMaterial('#6c5b50', 0.9),
      border: standardMaterial('#8d7765', 0.88),
      brickA: standardMaterial('#a15f4d', 0.86),
      brickB: standardMaterial('#945746', 0.88),
    },
    'stone-path': {
      base: standardMaterial('#5f625d', 0.9),
      slabA: standardMaterial('#9da09a', 0.87),
      slabB: standardMaterial('#92968f', 0.89),
    },
  }[objectType]

  if (objectType === 'asphalt-road') createAsphaltRoad(THREE, root, { length: effectiveLength, width: effectiveWidth }, materials)
  if (objectType === 'concrete-road') createConcreteRoad(THREE, root, { length: effectiveLength, width: effectiveWidth }, materials)
  if (objectType === 'brick-walkway') createBrickWalkway(THREE, root, { length: effectiveLength, width: effectiveWidth }, materials)
  if (objectType === 'stone-path') createStonePath(THREE, root, { length: effectiveLength, width: effectiveWidth }, materials)

  root.userData.assetName = definition.label
  root.userData.builtinAssetRef = { category: 'road', objectType }
  root.userData.proceduralRoad = {
    version: 1,
    objectType,
    length: effectiveLength,
    width: effectiveWidth,
  }
  return root
}
