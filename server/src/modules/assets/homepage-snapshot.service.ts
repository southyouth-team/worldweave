import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;

/**
 * 「发布到首页」的服务端持久化：每个用户一份首页快照（沙盒模型 JSON），
 * 只存储不执行。首页启动时读取这份数据作为内容来源。
 */
@Injectable()
export class HomepageSnapshotService {
  private readonly logger = new Logger(HomepageSnapshotService.name);
  private readonly root: string;

  constructor(private readonly config: ConfigService) {
    this.root = resolve(this.config.get<string>('ASSET_STORAGE_DIR', './uploads'), 'homepage-snapshots');
  }

  private fileFor(userId: string): string {
    const safe = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'anonymous';
    return resolve(this.root, safe + '.json');
  }

  async save(userId: string, snapshotInput: unknown): Promise<{ ok: true; models: number; publishedAt: string; sizeBytes: number }> {
    const snapshot = snapshotInput && typeof snapshotInput === 'object' && !Array.isArray(snapshotInput)
      ? snapshotInput as Record<string, any> : null;
    if (!snapshot || !Array.isArray(snapshot.models)) {
      throw new BadRequestException('首页快照缺少 models 数组');
    }
    const publishedAt = new Date().toISOString();
    const payload = JSON.stringify({ ...snapshot, publishedAt });
    const sizeBytes = Buffer.byteLength(payload, 'utf8');
    if (sizeBytes > MAX_SNAPSHOT_BYTES) throw new BadRequestException('首页快照超过 25 MB');
    const file = this.fileFor(userId);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, payload, 'utf8');
    this.logger.log('首页快照已保存：' + userId + '，模型 ' + snapshot.models.length + ' 个，' + sizeBytes + ' bytes');
    return { ok: true, models: snapshot.models.length, publishedAt, sizeBytes };
  }

  async load(userId: string): Promise<{ snapshot: Record<string, any> | null }> {
    try {
      const raw = await readFile(this.fileFor(userId), 'utf8');
      const data = JSON.parse(raw);
      return { snapshot: data && Array.isArray(data.models) ? data : null };
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { snapshot: null };
      this.logger.warn('读取首页快照失败：' + (error?.message || error));
      return { snapshot: null };
    }
  }

  async clear(userId: string): Promise<{ ok: true }> {
    await rm(this.fileFor(userId), { force: true });
    return { ok: true };
  }
}
