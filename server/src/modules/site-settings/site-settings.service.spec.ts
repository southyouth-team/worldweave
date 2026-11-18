import { BadRequestException } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SITE_SETTINGS } from './site-settings.defaults';
import { SiteSettingsService } from './site-settings.service';

describe('SiteSettingsService', () => {
  let directory: string;
  let service: SiteSettingsService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ncgxy-site-settings-'));
    const config = { get: (key: string, fallback?: string) => key === 'ASSET_STORAGE_DIR' ? directory : fallback };
    service = new SiteSettingsService(config as any);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('在没有保存过配置时返回默认值', async () => {
    await expect(service.load()).resolves.toMatchObject({
      settings: { brandName: 'Worldweave' },
      updatedAt: null,
    });
  });

  it('保存后读取合并后的全局配置', async () => {
    const saved = await service.save({
      brandName: '测试大学',
      homepageTitle: '测试大学 · 三维校园',
      themeColor: '#123456',
    });
    expect(saved.settings).toMatchObject({
      brandName: '测试大学',
      homepageTitle: '测试大学 · 三维校园',
      themeColor: '#123456',
      sandboxTitle: DEFAULT_SITE_SETTINGS.sandboxTitle,
    });
    expect(typeof saved.updatedAt).toBe('string');

    const loaded = await service.load();
    expect(loaded.settings.brandName).toBe('测试大学');
    expect(loaded.updatedAt).toBe(saved.updatedAt);
  });

  it('拒绝非法颜色、空标题和过大的 logo', async () => {
    await expect(service.save({ themeColor: 'red' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save({ brandName: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save({ logoDataUrl: 'https://example.com/logo.png' })).rejects.toBeInstanceOf(BadRequestException);
    const bigLogo = 'data:image/png;base64,' + Buffer.alloc(513 * 1024).toString('base64');
    await expect(service.save({ logoDataUrl: bigLogo })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('接受合法 logo 并支持重置', async () => {
    const smallLogo = 'data:image/png;base64,' + Buffer.from('logo').toString('base64');
    const saved = await service.save({ logoDataUrl: smallLogo });
    expect(saved.settings.logoDataUrl).toBe(smallLogo);

    const reset = await service.reset();
    expect(reset.settings).toMatchObject({ brandName: DEFAULT_SITE_SETTINGS.brandName });
    await expect(service.load()).resolves.toMatchObject({ updatedAt: null });
  });
});
