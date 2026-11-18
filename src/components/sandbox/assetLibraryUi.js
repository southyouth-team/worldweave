// 资产库面板纯逻辑：入库资格判断、入库载荷构建、内置素材分组。
// Vue 组件只从 components/sandbox 下的模块取用沙盒能力，这里统一 re-export。
import {
  BUILTIN_CATEGORY_LABELS,
  createBuiltinSandboxModel,
  listBuiltinAssets,
} from '../../three/sandbox/builtinAssetAdapter.js'
import { isStretchableRoadModel } from '../../three/sandbox/roadEndpointMath.js'

export {
  BUILTIN_CATEGORY_LABELS,
  createBuiltinSandboxModel,
  isStretchableRoadModel,
  listBuiltinAssets,
}

export function canArchiveSandboxModel(model) {
  const source = model?.userData?.proceduralModelSource
  return typeof source === 'string' && source.trim().length > 0
}

// 选择态面板的两个按钮资格必须在每个选择边界同源派生，
// 避免 editable / canArchive 两个布尔在不同回调里各自维护而漏刷新。
export function getSelectedModelState(model) {
  const source = model?.userData?.proceduralModelSource
  return {
    editable: Boolean(source),
    canArchive: canArchiveSandboxModel(model),
  }
}

export function createRoadEditPersistence({ save, sync } = {}) {
  return function persistRoadEdit(payload) {
    if (payload?.phase !== 'committed') return null
    sync?.()
    return Boolean(save?.())
  }
}

export function buildProceduralAssetPayload(model, name) {
  const userData = model?.userData || {}
  return {
    name,
    category: 'sandbox-model',
    objectType: userData.proceduralModelConfig?.objectType || '独立 3D 模型',
    sourceCode: userData.proceduralModelSource,
    manifest: userData.proceduralModelCapabilityManifest || { version: 1, capabilities: {} },
    parameters: Array.isArray(userData.proceduralModelParameters) ? userData.proceduralModelParameters : [],
    parts: Array.isArray(userData.proceduralModelParts) ? userData.proceduralModelParts : [],
    environmentBindings: Array.isArray(userData.proceduralModelEnvironmentBindings)
      ? userData.proceduralModelEnvironmentBindings
      : [],
  }
}

export function groupBuiltinAssetsByCategory(items) {
  return Object.entries(BUILTIN_CATEGORY_LABELS).map(([category, label]) => ({
    category,
    label,
    items: (Array.isArray(items) ? items : []).filter(item => item.category === category),
  }))
}
