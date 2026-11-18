import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { HomepageSnapshotService } from '../assets/homepage-snapshot.service';
import { CreatePublishRequestDto } from './dto/publish-request.dto';

const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 480 * 1024;
const PUBLISHED_SNAPSHOT_USER = '__published__';
const THUMBNAIL_PATTERN = /^data:image\/(jpeg|png);base64,[a-z0-9+/=\s]+$/i;

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'stale';

function toPublic(row: Record<string, any>, { includeThumbnail = false } = {}): Record<string, any> {
  return {
    id: String(row.id),
    status: String(row.status),
    note: String(row.note || ''),
    modelCount: Number(row.model_count || 0),
    chunkCount: Number(row.chunk_count || 0),
    snapshotBytes: Number(row.snapshot_bytes || 0),
    requester: row.requester_username
      ? { username: String(row.requester_username), displayName: String(row.requester_display_name || row.requester_username) }
      : undefined,
    reviewNote: row.review_note || '',
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    ...(includeThumbnail ? { thumbnailDataUrl: row.thumbnail_data_url || null } : {}),
  };
}

/**
 * 成员提交发布申请 → 管理员审核 → 写入全局首页发布快照。
 * 每次申请保存一份冻结 JSON，审核通过时首页使用的就是这份快照。
 */
@Injectable()
export class PublishRequestsService {
  private readonly logger = new Logger(PublishRequestsService.name);
  private readonly root: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly homepage: HomepageSnapshotService,
  ) {
    this.root = resolve(this.config.get<string>('ASSET_STORAGE_DIR', './uploads'), 'publish-requests');
  }

  async create(requesterId: string, dto: CreatePublishRequestDto) {
    const snapshot = dto.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray((snapshot as any).models)) {
      throw new BadRequestException('发布快照缺少 models 数组');
    }
    const payload = JSON.stringify(snapshot);
    const sizeBytes = Buffer.byteLength(payload, 'utf8');
    if (sizeBytes > MAX_SNAPSHOT_BYTES) throw new BadRequestException('发布快照超过 25 MB');
    const thumbnail = this.validateThumbnail(dto.thumbnailDataUrl);
    const id = randomUUID();
    const file = resolve(this.root, id + '.json');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, payload, 'utf8');
    try {
      const rows = await this.dataSource.query(
        `INSERT INTO publish_request
           (id, requester_id, note, model_count, chunk_count, snapshot_bytes, snapshot_file, thumbnail_data_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, status, note, model_count, chunk_count, snapshot_bytes, created_at`,
        [
          id,
          requesterId,
          String(dto.note || '').trim(),
          Array.isArray((snapshot as any).models) ? (snapshot as any).models.length : 0,
          Array.isArray((snapshot as any).world?.chunks) ? (snapshot as any).world.chunks.length : 0,
          sizeBytes,
          id + '.json',
          thumbnail,
        ],
      );
      return { ok: true, request: toPublic(rows[0]) };
    } catch (error) {
      await rm(file, { force: true });
      throw error;
    }
  }

  async listMine(userId: string) {
    const rows = await this.dataSource.query(
      `SELECT id, status, note, model_count, chunk_count, snapshot_bytes,
              review_note, reviewed_at, published_at, created_at
       FROM publish_request
       WHERE requester_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId],
    );
    return rows.map((row: Record<string, any>) => toPublic(row));
  }

  async listForAdmin(statusInput = 'pending') {
    const status = ['pending', 'approved', 'rejected', 'stale', 'all'].includes(statusInput)
      ? statusInput
      : 'pending';
    const where = status === 'all' ? '' : 'WHERE r.status = $1';
    const params = status === 'all' ? [] : [status];
    const rows = await this.dataSource.query(
      `SELECT r.id, r.status, r.note, r.model_count, r.chunk_count, r.snapshot_bytes,
              r.thumbnail_data_url, r.review_note, r.reviewed_at, r.published_at, r.created_at,
              u.username AS requester_username, u.display_name AS requester_display_name
       FROM publish_request r
       JOIN app_user u ON u.id = r.requester_id
       ${where}
       ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.created_at DESC
       LIMIT 100`,
      params,
    );
    return rows.map((row: Record<string, any>) => toPublic(row, { includeThumbnail: true }));
  }

  async getSnapshot(id: string, userId: string, role: string) {
    const rows = await this.dataSource.query(
      'SELECT requester_id, snapshot_file FROM publish_request WHERE id = $1 LIMIT 1',
      [id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('发布申请不存在');
    if (role !== 'admin' && String(row.requester_id) !== String(userId)) {
      throw new ForbiddenException('无权查看其他成员的发布快照');
    }
    try {
      return JSON.parse(await readFile(resolve(this.root, String(row.snapshot_file)), 'utf8'));
    } catch (error: any) {
      if (error?.code === 'ENOENT') throw new NotFoundException('发布快照文件不存在');
      throw new BadRequestException('发布快照无法读取');
    }
  }

  async approve(id: string, adminId: string) {
    const rows = await this.dataSource.query(
      'SELECT id, status, snapshot_file FROM publish_request WHERE id = $1 LIMIT 1',
      [id],
    );
    const request = rows[0];
    if (!request) throw new NotFoundException('发布申请不存在');
    if (request.status !== 'pending') throw new ConflictException('该发布申请已经处理过');
    let snapshot: Record<string, any>;
    try {
      snapshot = JSON.parse(await readFile(resolve(this.root, String(request.snapshot_file)), 'utf8'));
    } catch {
      throw new NotFoundException('发布快照文件不存在，无法发布');
    }
    if (!snapshot || !Array.isArray(snapshot.models)) {
      throw new BadRequestException('发布快照格式无效');
    }
    const saved = await this.homepage.save(PUBLISHED_SNAPSHOT_USER, snapshot);
    const stale = await this.dataSource.query(
      `UPDATE publish_request
       SET status = 'stale', reviewed_by = $2, reviewed_at = now(),
           review_note = '已有更新的版本发布到首页，请基于最新版本重新提交'
       WHERE id <> $1 AND status = 'pending'
       RETURNING id`,
      [id, adminId],
    );
    await this.dataSource.query(
      `UPDATE publish_request
       SET status = 'approved', reviewed_by = $2, reviewed_at = now(), published_at = now()
       WHERE id = $1`,
      [id, adminId],
    );
    this.logger.log('发布申请已通过并写入首页：' + id + '，' + saved.models + ' 个模型，冲销旧申请 ' + stale.length + ' 条');
    return {
      ok: true,
      models: saved.models,
      publishedAt: saved.publishedAt,
      staleRequests: stale.length,
    };
  }

  async reject(id: string, adminId: string, note = '') {
    const rows = await this.dataSource.query(
      'SELECT id, status FROM publish_request WHERE id = $1 LIMIT 1',
      [id],
    );
    const request = rows[0];
    if (!request) throw new NotFoundException('发布申请不存在');
    if (request.status !== 'pending') throw new ConflictException('该发布申请已经处理过');
    await this.dataSource.query(
      `UPDATE publish_request
       SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3
       WHERE id = $1`,
      [id, adminId, String(note || '').trim() || null],
    );
    return { ok: true };
  }

  async loadPublished() {
    const { snapshot } = await this.homepage.load(PUBLISHED_SNAPSHOT_USER);
    return {
      snapshot,
      publishedAt: snapshot?.publishedAt || null,
    };
  }

  private validateThumbnail(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !THUMBNAIL_PATTERN.test(value)) {
      throw new BadRequestException('缩略图必须是 JPEG/PNG 的 data URL');
    }
    const base64 = value.slice(value.indexOf(',') + 1).replace(/\s+/g, '');
    if (Buffer.from(base64, 'base64').length > MAX_THUMBNAIL_BYTES) {
      throw new BadRequestException('缩略图不能超过 480 KB');
    }
    return value;
  }
}
