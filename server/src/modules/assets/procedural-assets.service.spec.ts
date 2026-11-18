import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetsService } from './assets.service';

async function listProceduralDir(directory: string): Promise<string[]> {
  try {
    return await readdir(join(directory, 'campus-visual-assets', 'procedural'));
  } catch {
    return [];
  }
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    name: '我的程序化模型',
    category: 'sandbox-model',
    objectType: '独立 3D 模型',
    sourceCode: 'export function createModel() { return new THREE.Group() }',
    manifest: { version: 1, capabilities: {} },
    parameters: [],
    parts: [],
    environmentBindings: [],
    ...overrides,
  };
}

describe('AssetsService procedural asset persistence', () => {
  let directory: string;
  let service: AssetsService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ncgxy-procedural-assets-'));
    const config = { get: (key: string, fallback?: string) => key === 'ASSET_STORAGE_DIR' ? directory : fallback };
    service = new AssetsService({ query: jest.fn() } as any, config as any);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('persists a procedural module on disk and registers a metadata-only manifest record', async () => {
    const result = await service.saveProceduralAsset('user-a', validInput());

    expect(result.assetId).toMatch(/^[a-f0-9-]{36}$/i);
    expect(result.format).toBe('procedural-module');
    expect(result.filePath).toMatch(/^procedural\/.+\.json$/);
    expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.createdBy).toBe('user-a');
    expect(result).not.toHaveProperty('sourceCode');

    const manifest = await service.getVisualAssetManifest();
    expect(manifest.proceduralAssets).toHaveLength(1);
    expect(manifest.proceduralAssets[0]).toMatchObject({
      assetId: result.assetId,
      name: '我的程序化模型',
      category: 'sandbox-model',
      objectType: '独立 3D 模型',
      format: 'procedural-module',
      createdBy: 'user-a',
    });
    expect(manifest.proceduralAssets[0]).not.toHaveProperty('sourceCode');

    const onDisk = JSON.parse(await readFile(join(directory, 'campus-visual-assets', result.filePath), 'utf8'));
    expect(onDisk.schemaVersion).toBe(1);
    expect(onDisk.sourceCode).toBe(validInput().sourceCode);
    expect(onDisk.assetId).toBe(result.assetId);
  });

  it('lists only the calling user records and never embeds source code', async () => {
    await service.saveProceduralAsset('user-a', validInput({ name: '甲的模型' }));
    await service.saveProceduralAsset('user-b', validInput({ name: '乙的模型' }));

    const rows = await service.listProceduralAssets('user-a');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('甲的模型');
    expect(rows[0]).not.toHaveProperty('sourceCode');
    expect(await service.listProceduralAssets('user-c')).toEqual([]);
  });

  it('normalizes missing or non-array companion fields to empty arrays', async () => {
    const saved = await service.saveProceduralAsset('user-a', validInput({
      parameters: null,
      parts: 'not-an-array',
      environmentBindings: undefined,
    }));

    const fetched = await service.getProceduralAsset('user-a', saved.assetId);
    expect(fetched.parameters).toEqual([]);
    expect(fetched.parts).toEqual([]);
    expect(fetched.environmentBindings).toEqual([]);
    expect(fetched.sourceCode).toBe(validInput().sourceCode);
  });

  it('stores the capability manifest object verbatim when it carries a version field', async () => {
    const manifest = { version: 1, capabilities: { spatial: { colliders: [] } } };
    const saved = await service.saveProceduralAsset('user-a', validInput({ manifest }));

    const fetched = await service.getProceduralAsset('user-a', saved.assetId);
    expect(fetched.manifest).toEqual(manifest);
  });

  it('leaves no procedural directory artifacts when manifest update fails (rollback)', async () => {
    jest.spyOn(service as any, 'writeVisualManifest').mockRejectedValueOnce(new Error('disk full'));

    await expect(service.saveProceduralAsset('user-a', validInput())).rejects.toThrow('disk full');

    const manifest = await service.getVisualAssetManifest();
    expect(manifest.proceduralAssets ?? []).toEqual([]);
    const proceduralDir = join(directory, 'campus-visual-assets', 'procedural');
    // mkdir may leave the empty directory behind; neither tmp nor final JSON may remain.
    await expect(readdir(proceduralDir)).resolves.toEqual([]);
  });

  it('fails with NotFound when the on-disk checksum no longer matches the manifest record', async () => {
    const saved = await service.saveProceduralAsset('user-a', validInput());
    const filePath = join(directory, 'campus-visual-assets', saved.filePath);
    const original = await readFile(filePath, 'utf8');
    await writeFile(filePath, original.replace('createModel', 'tamperedModel'));

    await expect(service.getProceduralAsset('user-a', saved.assetId))
      .rejects.toThrow('校验失败');
  });

  it('forbids cross-user read, rename and delete while keeping the owner record intact', async () => {
    const saved = await service.saveProceduralAsset('user-a', validInput());

    await expect(service.getProceduralAsset('user-b', saved.assetId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.renameProceduralAsset('user-b', saved.assetId, '抢注名字')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteProceduralAsset('user-b', saved.assetId)).rejects.toBeInstanceOf(ForbiddenException);

    const rows = await service.listProceduralAssets('user-a');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('我的程序化模型');
  });

  it('returns NotFound for unknown or malformed asset ids', async () => {
    const saved = await service.saveProceduralAsset('user-a', validInput());

    await expect(service.getProceduralAsset('user-a', '00000000-0000-0000-0000-000000000000'))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getProceduralAsset('user-a', '../escape')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.renameProceduralAsset('user-a', saved.assetId + 'x', '新名字')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('renames the record without touching the stored source code and timestamps the update', async () => {
    const saved = await service.saveProceduralAsset('user-a', validInput());

    const renamed = await service.renameProceduralAsset('user-a', saved.assetId, '改名后的模型');

    expect(renamed.assetId).toBe(saved.assetId);
    expect(renamed.name).toBe('改名后的模型');
    expect(typeof renamed.updatedAt).toBe('string');
    const manifest = await service.getVisualAssetManifest();
    expect(manifest.proceduralAssets[0].name).toBe('改名后的模型');
    const fetched = await service.getProceduralAsset('user-a', saved.assetId);
    expect(fetched.sourceCode).toBe(validInput().sourceCode);
  });

  it('deletes record and disk file, then treats a second delete as idempotent no-op', async () => {
    const saved = await service.saveProceduralAsset('user-a', validInput());
    expect(await listProceduralDir(directory)).toHaveLength(1);

    const first = await service.deleteProceduralAsset('user-a', saved.assetId);
    expect(first).toEqual({ assetId: saved.assetId, deleted: true });
    expect(await listProceduralDir(directory)).toEqual([]);
    await expect(service.getProceduralAsset('user-a', saved.assetId)).rejects.toBeInstanceOf(NotFoundException);

    const second = await service.deleteProceduralAsset('user-a', saved.assetId);
    expect(second).toEqual({ assetId: saved.assetId, deleted: false });
  });

  it('rejects non-string, empty and oversized source code without writing files', async () => {
    const filesBefore = await listProceduralDir(directory);

    await expect(service.saveProceduralAsset('user-a', validInput({ sourceCode: 123 as unknown as string })))
      .rejects.toThrow('源码不能为空');
    await expect(service.saveProceduralAsset('user-a', validInput({ sourceCode: '   ' })))
      .rejects.toThrow('源码不能为空');
    await expect(service.saveProceduralAsset('user-a', validInput({ sourceCode: 'a'.repeat(120001) })))
      .rejects.toThrow('120 KB');
    expect(await listProceduralDir(directory)).toEqual(filesBefore);
  });

  it('rejects payloads whose serialized JSON exceeds 2 MB', async () => {
    const oversizedManifest = { version: 1, blob: 'x'.repeat(2 * 1024 * 1024) };

    await expect(service.saveProceduralAsset('user-a', validInput({ manifest: oversizedManifest })))
      .rejects.toThrow('2 MB');
    expect(await listProceduralDir(directory)).toEqual([]);
  });
});
