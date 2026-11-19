function clone(value) {
  return value === undefined || value === null ? value : JSON.parse(JSON.stringify(value))
}

function modelMap(snapshot) {
  const map = new Map()
  for (const model of snapshot?.models || []) {
    if (model?.id === undefined || model?.id === null) continue
    map.set(String(model.id), model)
  }
  return map
}

function rootNode(model) {
  return model?.object?.object || model?.object || {}
}

function vector(value) {
  if (Array.isArray(value)) {
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0]
  }
  return [Number(value?.x) || 0, Number(value?.y) || 0, Number(value?.z) || 0]
}

export function modelTransform(model) {
  const root = rootNode(model)
  return {
    position: vector(root.position),
    rotation: vector(root.rotation),
    scale: vector(root.scale || [1, 1, 1]),
  }
}

function formatVector(value) {
  return value.map(item => Number(item).toFixed(2).replace(/\.00$/, '')).join(', ')
}

function sameVector(a, b) {
  return a.every((value, index) => Math.abs(value - b[index]) < 0.0001)
}

function hasKeyDeep(value, key) {
  if (Array.isArray(value)) return value.some(item => hasKeyDeep(item, key))
  if (!value || typeof value !== 'object') return false
  for (const [entryKey, item] of Object.entries(value)) {
    if (entryKey === key) return true
    if (hasKeyDeep(item, key)) return true
  }
  return false
}

function comparableModel(value) {
  if (Array.isArray(value)) return value.map(comparableModel)
  if (!value || typeof value !== 'object') return value
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'proceduralModelCapabilityControlDocument') continue
    const cleaned = comparableModel(item)
    if (key === 'userData' && cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned) && !Object.keys(cleaned).length) continue
    result[key] = cleaned
  }
  return result
}

function comparableForDiff(model, reference) {
  const copy = clone(model)
  const root = copy?.object?.object
  if (root && typeof root === 'object') {
    // matrix/quaternion 是 position/rotation 的派生值，序列化精度差异不应算成员修改。
    delete root.matrix
    delete root.quaternion
  }
  return reference && hasKeyDeep(reference, 'proceduralModelCapabilityControlDocument')
    ? copy
    : comparableModel(copy)
}

function modelsDiffer(before, after) {
  return JSON.stringify(comparableForDiff(before, before)) !== JSON.stringify(comparableForDiff(after, before))
}

function contentSignature(model, reference) {
  const copy = clone(model?.object || {})
  const root = copy?.object ? copy.object : copy
  if (root && typeof root === 'object') {
    for (const key of ['position', 'rotation', 'scale', 'quaternion', 'matrix', 'name']) delete root[key]
  }
  return JSON.stringify(
    reference && hasKeyDeep(reference, 'proceduralModelCapabilityControlDocument')
      ? copy
      : comparableModel(copy),
  )
}

function changeList(before, after) {
  const changes = []
  if (String(before?.name || '') !== String(after?.name || '')) {
    changes.push({ field: '名称', before: before?.name || '', after: after?.name || '' })
  }
  const beforeTransform = modelTransform(before)
  const afterTransform = modelTransform(after)
  for (const [field, key] of [['位置', 'position'], ['旋转', 'rotation'], ['缩放', 'scale']]) {
    if (!sameVector(beforeTransform[key], afterTransform[key])) {
      changes.push({
        field,
        before: formatVector(beforeTransform[key]),
        after: formatVector(afterTransform[key]),
      })
    }
  }
  if (contentSignature(before, before) !== contentSignature(after, before)) {
    changes.push({ field: '模型内容', before: '原有几何/材质', after: '几何或材质有变化' })
  }
  return changes
}

export function diffSnapshotModels(baseSnapshot, nextSnapshot) {
  const beforeModels = modelMap(baseSnapshot)
  const afterModels = modelMap(nextSnapshot)
  const added = []
  const modified = []
  const deleted = []
  let unchanged = 0

  for (const [id, model] of afterModels) {
    const before = beforeModels.get(id)
    if (!before) {
      added.push({ id, name: model.name || id, kind: 'added', before: null, after: model, changes: [] })
      continue
    }
    if (!modelsDiffer(before, model)) {
      unchanged += 1
      continue
    }
    modified.push({
      id,
      name: model.name || before.name || id,
      kind: 'modified',
      before,
      after: model,
      changes: changeList(before, model),
    })
  }

  for (const [id, model] of beforeModels) {
    if (afterModels.has(id)) continue
    deleted.push({
      id,
      name: model.name || id,
      kind: 'deleted',
      before: model,
      after: null,
      changes: [{ field: '状态', before: '已存在', after: '已从提交版本删除' }],
    })
  }

  const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN')
  added.sort(byName)
  modified.sort(byName)
  deleted.sort(byName)

  return {
    added,
    modified,
    deleted,
    unchanged,
    summary: {
      added: added.length,
      modified: modified.length,
      deleted: deleted.length,
      unchanged,
    },
  }
}

export function singleModelSnapshot(snapshot, model) {
  if (!snapshot || !model) return null
  return {
    ...snapshot,
    selectedModelId: model.id,
    models: [clone(model)],
  }
}
