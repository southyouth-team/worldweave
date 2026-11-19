export const WORLD_LOCK_KEY = '__world__';
export const DEFAULT_CHUNK_WIDTH = 54;
export const DEFAULT_CHUNK_DEPTH = 42;
export const MAX_CHUNK_LOCKS = 2500;
const CHUNK_KEY_PATTERN = /^(?:-?\d+:-?\d+|__world__)$/;

export interface SnapshotModel {
  id: string;
  name?: string;
  object?: Record<string, any>;
  [key: string]: any;
}

export interface WorkspaceSnapshot {
  version?: number;
  world?: Record<string, any>;
  environment?: Record<string, any>;
  models?: SnapshotModel[];
  [key: string]: any;
}

export interface SnapshotDiff {
  chunks: string[];
  modelChanges: {
    added: string[];
    removed: string[];
    modified: string[];
  };
  worldChanged: boolean;
  environmentChanged: boolean;
}

export interface PublishedModelViolation {
  modelId: string;
  name: string;
  reason: 'deleted' | 'modified';
}

function chunkSize(world: Record<string, any> | undefined) {
  return {
    width: Math.max(1, Number(world?.chunkSize?.width) || DEFAULT_CHUNK_WIDTH),
    depth: Math.max(1, Number(world?.chunkSize?.depth) || DEFAULT_CHUNK_DEPTH),
  };
}

function readPosition(model: SnapshotModel): { x: number; z: number } {
  // Three.js Object3D.toJSON() 把根节点包装在 object.object 中；兼容直接传根节点的情况。
  const position = model?.object?.object?.position ?? model?.object?.position;
  if (Array.isArray(position)) {
    return { x: Number(position[0]) || 0, z: Number(position[2]) || 0 };
  }
  return { x: Number(position?.x) || 0, z: Number(position?.z) || 0 };
}

/** TypeORM 对部分 DELETE/UPDATE ... RETURNING 返回 [rows, affected]，统一取出行数组。 */
export function normalizeReturningRows(result: unknown): Array<Record<string, any>> {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
    return result[0] as Array<Record<string, any>>;
  }
  return Array.isArray(result) ? (result as Array<Record<string, any>>) : [];
}

export function modelChunkKey(model: SnapshotModel, world?: Record<string, any>): string {
  const size = chunkSize(world);
  const { x, z } = readPosition(model);
  const chunkX = Math.floor((x + size.width / 2) / size.width);
  const chunkZ = Math.floor((z + size.depth / 2) / size.depth);
  return chunkX + ':' + chunkZ;
}

/**
 * 校验并规范化锁 / 保存涉及的地块。`__world__` 代表世界结构、环境等全局字段。
 * 不允许静默去重，避免客户端误以为多个请求都生效。
 */
export function normalizeChunkKeys(input: unknown): string[] {
  if (!Array.isArray(input) || !input.length) {
    throw new Error('至少需要一个地块');
  }
  if (input.length > MAX_CHUNK_LOCKS) {
    throw new Error('一次最多处理 ' + MAX_CHUNK_LOCKS + ' 个地块');
  }
  const keys = input.map((value) => {
    if (typeof value !== 'string' || !CHUNK_KEY_PATTERN.test(value)) {
      throw new Error('地块标识无效：' + String(value));
    }
    return value;
  });
  if (new Set(keys).size !== keys.length) {
    throw new Error('地块标识不能重复');
  }
  return keys.slice().sort();
}

function modelMap(snapshot: WorkspaceSnapshot | null | undefined): Map<string, SnapshotModel> {
  const map = new Map<string, SnapshotModel>();
  for (const model of snapshot?.models || []) {
    if (!model || model.id === undefined || model.id === null) continue;
    map.set(String(model.id), model);
  }
  return map;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

// capability control 文档由客户端从 manifest 派生，旧快照可能没有；比较时忽略，避免把载入时的补全当成成员修改。
function comparableModel(value: any): any {
  if (Array.isArray(value)) return value.map(comparableModel);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'proceduralModelCapabilityControlDocument') continue;
    const cleaned = comparableModel(item);
    if (key === 'userData' && cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned) && !Object.keys(cleaned).length) {
      continue;
    }
    result[key] = cleaned;
  }
  return result;
}

function modelChanged(before: SnapshotModel, after: SnapshotModel): boolean {
  return stableJson(before) !== stableJson(after);
}

function hasKeyDeep(value: any, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasKeyDeep(item, key));
  if (!value || typeof value !== 'object') return false;
  for (const [entryKey, item] of Object.entries(value)) {
    if (entryKey === key) return true;
    if (hasKeyDeep(item, key)) return true;
  }
  return false;
}

function publishedModelChanged(before: SnapshotModel, after: SnapshotModel): boolean {
  // 只有发布快照本身没有派生文档时才忽略客户端补全；已发布的控制文档变化仍算修改。
  if (hasKeyDeep(before, 'proceduralModelCapabilityControlDocument')) {
    return stableJson(before) !== stableJson(after);
  }
  return stableJson(comparableModel(before)) !== stableJson(comparableModel(after));
}

export function diffSnapshotChunks(
  previous: WorkspaceSnapshot | null | undefined,
  next: WorkspaceSnapshot,
): SnapshotDiff {
  const world = next.world || previous?.world;
  const beforeModels = modelMap(previous);
  const afterModels = modelMap(next);
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  const chunks = new Set<string>();

  for (const [id, model] of afterModels) {
    const before = beforeModels.get(id);
    if (!before) {
      added.push(id);
      chunks.add(modelChunkKey(model, world));
      continue;
    }
    if (!modelChanged(before, model)) continue;
    modified.push(id);
    chunks.add(modelChunkKey(before, world));
    chunks.add(modelChunkKey(model, world));
  }
  for (const [id, model] of beforeModels) {
    if (afterModels.has(id)) continue;
    removed.push(id);
    chunks.add(modelChunkKey(model, world));
  }

  const worldChanged = stableJson(previous?.world) !== stableJson(next?.world);
  const environmentChanged = stableJson(previous?.environment) !== stableJson(next?.environment);
  if (worldChanged || environmentChanged) chunks.add(WORLD_LOCK_KEY);

  return {
    chunks: Array.from(chunks).sort(),
    modelChanges: { added, removed, modified },
    worldChanged,
    environmentChanged,
  };
}

function clone<T>(value: T): T {
  return value === undefined || value === null ? value : JSON.parse(JSON.stringify(value));
}

/**
 * 只把本次改动地块的模型替换进服务端快照，其他地块保留服务端最新内容。
 * 全局字段只有持有 `__world__` 锁时才允许覆盖。
 */
export function mergeSnapshotChunks(
  current: WorkspaceSnapshot | null | undefined,
  incoming: WorkspaceSnapshot,
  changedChunks: string[],
  options: { worldChanged?: boolean; environmentChanged?: boolean } = {},
): WorkspaceSnapshot & { models: SnapshotModel[] } {
  if (!current) return clone(incoming) as WorkspaceSnapshot & { models: SnapshotModel[] };
  const changed = new Set(changedChunks);
  const world = incoming.world || current.world;
  const modelKeys = changedChunks.filter((key) => key !== WORLD_LOCK_KEY);
  const modelKeySet = new Set(modelKeys);
  const merged: WorkspaceSnapshot = clone(current) || {};

  const preserved = (current.models || []).filter(
    (model) => !modelKeySet.has(modelChunkKey(model, world)),
  );
  const replaced = (incoming.models || []).filter(
    (model) => modelKeySet.has(modelChunkKey(model, world)),
  );
  merged.models = [...preserved.map((model) => clone(model)), ...replaced.map((model) => clone(model))];

  if (changed.has(WORLD_LOCK_KEY)) {
    if (options.worldChanged !== false && incoming.world !== undefined) {
      merged.world = clone(incoming.world);
    }
    if (options.environmentChanged !== false && incoming.environment !== undefined) {
      merged.environment = clone(incoming.environment);
    }
    if (incoming.version !== undefined) merged.version = incoming.version;
  }
  deletedFields(incoming, current, merged, changed);
  return merged as WorkspaceSnapshot & { models: SnapshotModel[] };
}

/** 允许删除可选的全局字段（例如环境字段），但只在地块锁包含世界键时。 */
function deletedFields(
  incoming: WorkspaceSnapshot,
  current: WorkspaceSnapshot,
  merged: WorkspaceSnapshot,
  changed: Set<string>,
) {
  if (!changed.has(WORLD_LOCK_KEY)) return;
  for (const key of Object.keys(current)) {
    if (key === 'models' || key === 'world' || key === 'environment' || key === 'version') continue;
    if (!(key in incoming)) delete merged[key];
  }
}

export function findDuplicateModelIds(snapshot: WorkspaceSnapshot | null | undefined): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const model of snapshot?.models || []) {
    if (model?.id === undefined || model?.id === null) continue;
    const id = String(model.id);
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return Array.from(duplicates).sort();
}

export function findPublishedModelViolations(
  published: WorkspaceSnapshot | null | undefined,
  incoming: WorkspaceSnapshot,
): PublishedModelViolation[] {
  const publishedModels = published?.models || [];
  if (!publishedModels.length) return [];
  const incomingModels = modelMap(incoming);
  const violations: PublishedModelViolation[] = [];
  for (const model of publishedModels) {
    const id = String(model.id);
    const next = incomingModels.get(id);
    if (!next) {
      violations.push({ modelId: id, name: String(model.name || id), reason: 'deleted' });
    } else if (publishedModelChanged(model, next)) {
      violations.push({ modelId: id, name: String(model.name || id), reason: 'modified' });
    }
  }
  return violations;
}

export function snapshotModelCount(snapshot: WorkspaceSnapshot | null | undefined): number {
  return Array.isArray(snapshot?.models) ? snapshot.models.length : 0;
}
