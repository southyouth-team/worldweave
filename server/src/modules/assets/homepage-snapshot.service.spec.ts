import { BadRequestException } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HomepageSnapshotService } from './homepage-snapshot.service';

describe('HomepageSnapshotService', () => {
  let directory: string;
  let service: HomepageSnapshotService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ncgxy-homepage-snapshot-'));
    const config = { get: (key: string, fallback?: string) => key === 'ASSET_STORAGE_DIR' ? directory : fallback };
    service = new HomepageSnapshotService(config as any);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('saves a published snapshot per user and loads it back', async () => {
    const snapshot = { version: 4, models: [{ id: 'a', name: 'A', object: { metadata: {} } }], world: null };
    const saved = await service.save('user-a', snapshot);
    expect(saved).toMatchObject({ ok: true, models: 1 });
    expect(typeof saved.publishedAt).toBe('string');

    const loaded = await service.load('user-a');
    expect(loaded.snapshot).toMatchObject({ version: 4 });
    expect(loaded.snapshot && Array.isArray(loaded.snapshot.models)).toBe(true);

    const otherUser = await service.load('user-b');
    expect(otherUser.snapshot).toBeNull();
  });

  it('rejects invalid snapshots and clears published data', async () => {
    await expect(service.save('user-a', null)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save('user-a', { models: 'bad' })).rejects.toBeInstanceOf(BadRequestException);

    await service.save('user-a', { version: 4, models: [] });
    await service.clear('user-a');
    expect((await service.load('user-a')).snapshot).toBeNull();
  });
});
