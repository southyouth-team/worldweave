import { hashPublishSnapshot } from './publish-snapshot';

function snapshot(overrides: Record<string, any> = {}) {
  return {
    version: 4,
    savedAt: '2026-11-19T10:00:00.000Z',
    selectedModelId: 'a',
    world: { version: 1, chunkSize: { width: 54, depth: 42 }, chunks: [{ x: 0, z: 0 }] },
    environment: { time: 12, weather: 'clear' },
    models: [
      { id: 'a', name: 'A', object: { object: { position: [0, 0, 0] } } },
      { id: 'b', name: 'B', object: { object: { position: [60, 0, 0] } } },
    ],
    ...overrides,
  };
}

describe('publish snapshot hash', () => {
  it('ignores save time, selected model and model order', () => {
    const first = snapshot();
    const second = snapshot({
      savedAt: '2026-11-19T11:00:00.000Z',
      selectedModelId: 'b',
      models: [first.models[1], first.models[0]],
    });
    expect(hashPublishSnapshot(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPublishSnapshot(first)).toBe(hashPublishSnapshot(second));
  });

  it('changes when world, environment or a model changes', () => {
    const base = hashPublishSnapshot(snapshot());
    expect(hashPublishSnapshot(snapshot({ environment: { time: 13, weather: 'clear' } }))).not.toBe(base);
    expect(hashPublishSnapshot(snapshot({ world: { ...snapshot().world, chunks: [{ x: 0, z: 0 }, { x: 1, z: 0 }] } }))).not.toBe(base);
    const changed = snapshot();
    changed.models[0].name = 'A2';
    expect(hashPublishSnapshot(changed)).not.toBe(base);
  });
});
