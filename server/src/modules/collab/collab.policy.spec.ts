import {
  diffSnapshotChunks,
  findDuplicateModelIds,
  findPublishedModelViolations,
  mergeSnapshotChunks,
  modelChunkKey,
  normalizeChunkKeys,
  normalizeReturningRows,
  type SnapshotModel,
} from './collab.policy';

function snapshot(models: SnapshotModel[], extra: Record<string, any> = {}) {
  return {
    version: 4,
    world: {
      version: 1,
      chunkSize: { width: 54, depth: 42 },
      chunks: [{ x: 0, z: 0 }],
    },
    environment: { time: 12, weather: 'clear' },
    models,
    ...extra,
  };
}

function model(id: string, x: number, z: number, name = id): SnapshotModel {
  return {
    id,
    name,
    object: {
      metadata: { version: 4.6 },
      object: { name, position: [x, 0, z] },
    },
  };
}

describe('collab policy', () => {
  it('maps model positions to ground chunk keys, including negative coordinates', () => {
    const world = { chunkSize: { width: 54, depth: 42 } };
    expect(modelChunkKey(model('a', 0, 0), world)).toBe('0:0');
    expect(modelChunkKey(model('b', 27.1, 0), world)).toBe('1:0');
    expect(modelChunkKey(model('c', -27.1, 0), world)).toBe('-1:0');
    expect(modelChunkKey(model('d', 0, -21.1), world)).toBe('0:-1');
  });

  it('rejects malformed chunk keys and keeps the world lock key', () => {
    expect(normalizeChunkKeys(['0:0', '__world__', '2:-3'])).toEqual(['0:0', '2:-3', '__world__']);
    expect(() => normalizeChunkKeys([])).toThrow();
    expect(() => normalizeChunkKeys(['0:0', '0:0'])).toThrow();
    expect(() => normalizeChunkKeys(['0:0 ', 'x:y'])).toThrow();
  });

  it('detects model additions, removals, edits, and global changes', () => {
    const before = snapshot([model('keep', 0, 0), model('move', 1, 1), model('edit', 30, 0)]);
    const after = snapshot(
      [model('keep', 0, 0), model('move', -30, 1), model('edit', 30, 0, 'renamed'), model('new', 60, 0)],
      { environment: { time: 18, weather: 'clear' } },
    );

    const diff = diffSnapshotChunks(before, after);
    expect(diff.chunks).toEqual(['-1:0', '0:0', '1:0', '__world__']);
    expect(diff.modelChanges.added).toEqual(['new']);
    expect(diff.modelChanges.removed).toEqual([]);
    expect(diff.modelChanges.modified.sort()).toEqual(['edit', 'move']);
    expect(diff.worldChanged).toBe(false);
    expect(diff.environmentChanged).toBe(true);
  });

  it('merges only the changed chunks into the server snapshot', () => {
    const current = snapshot([model('maple', 0, 0), model('pine', 60, 0)]);
    const incoming = snapshot([
      model('maple', 0, 0, 'maple-renamed'),
      model('pine', 60, 0),
      model('oak', 0, 10),
    ]);

    const merged = mergeSnapshotChunks(current, incoming, ['0:0']);
    expect(merged.models.map((item: any) => item.id)).toEqual(['pine', 'maple', 'oak']);
    expect(merged.models.find((item: any) => item.id === 'maple')!.name).toBe('maple-renamed');
    expect(merged.models.find((item: any) => item.id === 'oak')!.name).toBe('oak');

    const global = mergeSnapshotChunks(current, incoming, ['__world__'], {
      environmentChanged: true,
      worldChanged: true,
    });
    expect(global.environment?.time).toBe(incoming.environment.time);
    expect(global.models).toHaveLength(2);
  });

  it('detects duplicate model ids after a cross-chunk merge', () => {
    const current = snapshot([model('a', 0, 0), model('b', 60, 0)]);
    const incoming = snapshot([model('a', 60, 0), model('b', 60, 0)]);
    const merged = mergeSnapshotChunks(current, incoming, ['1:0']);
    expect(findDuplicateModelIds(merged)).toEqual(['a']);
  });

  it('unwraps TypeORM DELETE/UPDATE RETURNING results without losing rows', () => {
    expect(normalizeReturningRows([[{ chunk_key: '1:0' }], 1])).toEqual([{ chunk_key: '1:0' }]);
    expect(normalizeReturningRows([{ chunk_key: '1:0' }])).toEqual([{ chunk_key: '1:0' }]);
    expect(normalizeReturningRows(null)).toEqual([]);
  });

  it('ignores client-derived capability documents when comparing published models', () => {
    const published = snapshot([model('published-a', 0, 0)]);
    const base = model('published-a', 0, 0);
    const withDerived = snapshot([{
      ...base,
      object: {
        metadata: { version: 4.6 },
        object: {
          name: 'published-a',
          position: [0, 0, 0],
          userData: { proceduralModelCapabilityControlDocument: { version: 1, controls: [] } },
        },
      },
    }]);
    expect(findPublishedModelViolations(published, withDerived)).toEqual([]);

    const derivedModel: any = withDerived.models[0];
    const publishedWithDoc = snapshot([derivedModel]);
    const editedDoc = snapshot([{
      ...derivedModel,
      object: {
        ...derivedModel.object,
        object: {
          ...derivedModel.object.object,
          userData: { proceduralModelCapabilityControlDocument: { version: 2, controls: [{ id: 'changed' }] } },
        },
      },
    }]);
    expect(findPublishedModelViolations(publishedWithDoc, editedDoc)).toEqual([
      { modelId: 'published-a', name: 'published-a', reason: 'modified' },
    ]);
  });

  it('protects published models from deletion and modification by members', () => {
    const published = snapshot([model('published-a', 0, 0), model('published-b', 60, 0)]);
    const untouched = snapshot([model('published-a', 0, 0), model('published-b', 60, 0), model('new', 10, 10)]);
    expect(findPublishedModelViolations(published, untouched)).toEqual([]);

    const modified = snapshot([model('published-a', 0, 0, 'changed'), model('new', 10, 10)]);
    expect(findPublishedModelViolations(published, modified)).toEqual([
      { modelId: 'published-a', name: 'published-a', reason: 'modified' },
      { modelId: 'published-b', name: 'published-b', reason: 'deleted' },
    ]);
  });
});
