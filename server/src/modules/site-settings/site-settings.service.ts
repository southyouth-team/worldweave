import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  DEFAULT_SITE_SETTINGS,
  MAX_LOGO_BYTES,
  SITE_SETTING_TEXT_LIMITS,
  SiteSettings,
} from './site-settings.defaults';

const LOGO_DATA_URL_PATTERN = /^data:image\/(svg\+xml|png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const REQUIRED_TEXT_FIELDS = new Set(['brandName', 'homepageTitle', 'sandboxTitle']);

/**
 * 站点品牌配置（名称、标题、SEO、logo）是全局数据，不属于某个用户。
 * 服务端只存 JSON，不执行其中的任何内容；写入接口由 DevIdentityGuard 保护。
 */
@Injectable()
export class SiteSettingsService {
  private readonly logger = new Logger(SiteSettingsService.name);
  private readonly file: string;

  constructor(private readonly config: ConfigService) {
    this.file = resolve(
      this.config.get<string>('ASSET_STORAGE_DIR', './uploads'),
      'site-settings',
      'site.json',
    );
  }

  async load(): Promise<{ settings: SiteSettings; updatedAt: string | null }> {
    try {
      const raw = await readFile(this.file, 'utf8');
      const data = JSON.parse(raw);
      const saved = data && typeof data === 'object' && data.settings ? data.settings : data;
      return {
        settings: this.normalize(saved),
        updatedAt: data && typeof data.updatedAt === 'string' ? data.updatedAt : null,
      };
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return { settings: { ...DEFAULT_SITE_SETTINGS }, updatedAt: null };
      }
      this.logger.warn('读取站点配置失败：' + (error?.message || error));
      return { settings: { ...DEFAULT_SITE_SETTINGS }, updatedAt: null };
    }
  }

  async save(input: unknown): Promise<{ ok: true; settings: SiteSettings; updatedAt: string }> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('站点配置必须是对象');
    }
    const current = await this.load();
    const settings = this.normalize({ ...current.settings, ...(input as Record<string, unknown>) });
    const updatedAt = new Date().toISOString();
    const payload = JSON.stringify({ settings, updatedAt });
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, payload, 'utf8');
    this.logger.log('站点配置已保存，' + Buffer.byteLength(payload, 'utf8') + ' bytes');
    return { ok: true, settings, updatedAt };
  }

  async reset(): Promise<{ ok: true; settings: SiteSettings; updatedAt: null }> {
    await rm(this.file, { force: true });
    this.logger.log('站点配置已重置为默认值');
    return { ok: true, settings: { ...DEFAULT_SITE_SETTINGS }, updatedAt: null };
  }

  private normalize(input: unknown): SiteSettings {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ...DEFAULT_SITE_SETTINGS };
    }
    const source = input as Record<string, unknown>;
    const result: SiteSettings = { ...DEFAULT_SITE_SETTINGS };
    for (const [field, limit] of Object.entries(SITE_SETTING_TEXT_LIMITS) as Array<
      [keyof typeof SITE_SETTING_TEXT_LIMITS, number]
    >) {
      const value = source[field];
      if (value === undefined) continue;
      if (typeof value !== 'string') throw new BadRequestException(field + ' 必须是字符串');
      const trimmed = value.trim();
      if (REQUIRED_TEXT_FIELDS.has(field) && !trimmed) {
        throw new BadRequestException(field + ' 不能为空');
      }
      if (trimmed.length > limit) throw new BadRequestException(field + ' 超过 ' + limit + ' 个字符');
      result[field] = trimmed;
    }
    if (source.themeColor !== undefined) {
      if (typeof source.themeColor !== 'string' || !HEX_COLOR_PATTERN.test(source.themeColor)) {
        throw new BadRequestException('themeColor 必须是 #RRGGBB 格式');
      }
      result.themeColor = source.themeColor;
    }
    if (source.logoDataUrl !== undefined) {
      result.logoDataUrl = this.validateLogo(source.logoDataUrl);
    }
    return result;
  }

  private validateLogo(value: unknown): string | null {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !LOGO_DATA_URL_PATTERN.test(value)) {
      throw new BadRequestException('logo 必须是 SVG/PNG/JPEG/WebP 的 data URL');
    }
    const base64 = value.slice(value.indexOf(',') + 1).replace(/\s+/g, '');
    const bytes = Buffer.from(base64, 'base64').length;
    if (bytes > MAX_LOGO_BYTES) {
      throw new BadRequestException('logo 不能超过 512 KB');
    }
    return value;
  }
}
