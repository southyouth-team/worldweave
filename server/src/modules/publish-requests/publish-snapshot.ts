import { createHash } from 'node:crypto';

/**
 * 发布快照哈希：忽略保存时间、选中模型和模型数组顺序，
 * 用于阻止“内容完全没变但反复提交”的发布申请。
 */
export function hashPublishSnapshot(snapshot: unknown): string {
  return createHash('sha256').update(canonicalSnapshotJson(snapshot)).digest('hex');
}

export function canonicalSnapshotJson(snapshot: unknown): string {
  const cloned = clone(snapshot);
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) return JSON.stringify(cloned ?? null);
  const record = cloned as Record<string, any>;
  delete record.savedAt;
  delete record.selectedModelId;
  delete record.publishedAt;
  if (Array.isArray(record.models)) {
    record.models = record.models
      .map((model: any) => sortKeys(model))
      .sort((a: any, b: any) => String(a?.id ?? '').localeCompare(String(b?.id ?? '')));
  }
  return JSON.stringify(sortKeys(record));
}

function clone(value: unknown): any {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function sortKeys(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, any> = {};
  for (const key of Object.keys(value).sort()) result[key] = sortKeys(value[key]);
  return result;
}
