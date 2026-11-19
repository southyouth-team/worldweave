import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { HomepageSnapshotService, PUBLISHED_HOMEPAGE_USER } from '../assets/homepage-snapshot.service';
import {
  findDuplicateModelIds,
  mergeSnapshotChunks,
  normalizeChunkKeys,
  normalizeReturningRows,
  snapshotModelCount,
  WORLD_LOCK_KEY,
  type WorkspaceSnapshot,
} from './collab.policy';
import {
  AcquireLocksDto,
  ForceUnlockDto,
  HeartbeatLocksDto,
  PresenceDto,
  ReleaseLocksDto,
  SaveWorkspaceDto,
} from './dto/collab.dto';
import { AuthUser } from '../auth/session.service';

const WORKSPACE_ID = 'default';
const DEFAULT_LEASE_SECONDS = 90;
const MAX_LEASE_SECONDS = 300;
const PRESENCE_TTL_SECONDS = 90;
const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;
const CHUNK_KEY_PATTERN = /^(?:-?\d+:-?\d+|__world__)$/;

interface WorkspaceRow {
  id: string;
  snapshot: WorkspaceSnapshot | null;
  revision: string | number;
  updated_at: Date | string | null;
}

interface StateRow {
  chunk_key: string;
  version: string | number;
  updated_at: Date | string | null;
  updated_by: string | null;
}

function iso(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function toNumber(value: unknown): number {
  return Number(value) || 0;
}

function leaseSeconds(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LEASE_SECONDS;
  return Math.min(MAX_LEASE_SECONDS, Math.max(15, Math.floor(parsed)));
}

function chunkOrNull(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !CHUNK_KEY_PATTERN.test(value)) {
    throw new BadRequestException('currentChunk 地块标识无效');
  }
  return value;
}

@Injectable()
export class CollabService {
  private readonly logger = new Logger(CollabService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly homepage: HomepageSnapshotService,
  ) {}

  async getWorkspace() {
    await this.ensureWorkspace();
    await this.sweep();
    const workspace = await this.readWorkspace();
    return this.buildState(workspace, true);
  }

  async getStatus() {
    await this.ensureWorkspace();
    await this.sweep();
    const workspace = await this.readWorkspace();
    return this.buildState(workspace, false);
  }

  async touchPresence(user: AuthUser, sessionId: string | null, dto: PresenceDto) {
    await this.ensureWorkspace();
    await this.sweep();
    await this.touchPresenceRow(this.dataSource.manager, user, sessionId, chunkOrNull(dto.currentChunk));
    return { ok: true, lastSeenAt: new Date().toISOString() };
  }

  async acquireLocks(user: AuthUser, sessionId: string | null, dto: AcquireLocksDto) {
    let keys: string[];
    try {
      keys = normalizeChunkKeys(dto.chunkKeys);
    } catch (error: any) {
      throw new BadRequestException(error?.message || '地块参数无效');
    }
    const lease = leaseSeconds(dto.leaseSeconds);
    const currentChunk = chunkOrNull(dto.currentChunk);
    await this.ensureWorkspace();

    try {
      await this.dataSource.transaction(async (manager) => {
        await this.sweep(manager);
        for (const key of keys) {
          const rows = normalizeReturningRows(await manager.query(
            `INSERT INTO collab_chunk_lock
               (workspace_id, chunk_key, user_id, session_id, lease_expires_at, acquired_at, heartbeat_at)
             VALUES ($1,$2,$3,$4, now() + ($5 * interval '1 second'), now(), now())
             ON CONFLICT (workspace_id, chunk_key) DO UPDATE
               SET user_id = EXCLUDED.user_id,
                   session_id = EXCLUDED.session_id,
                   lease_expires_at = EXCLUDED.lease_expires_at,
                   heartbeat_at = now()
             WHERE collab_chunk_lock.user_id = EXCLUDED.user_id
                OR collab_chunk_lock.lease_expires_at <= now()
             RETURNING chunk_key, lease_expires_at`,
            [WORKSPACE_ID, key, user.id, sessionId, lease],
          ));
          if (!rows.length) {
            const holders = await manager.query(
              `SELECT l.chunk_key, l.user_id, l.lease_expires_at,
                      u.username, u.display_name
               FROM collab_chunk_lock l
               JOIN app_user u ON u.id = l.user_id
               WHERE l.workspace_id = $1 AND l.chunk_key = $2`,
              [WORKSPACE_ID, key],
            );
            const holder = holders[0];
            throw new ConflictException({
              code: 'CHUNK_LOCKED',
              message: holder
                ? `地块 ${key} 正由 ${holder.display_name || holder.username} 编辑`
                : `地块 ${key} 正被其他成员编辑`,
              conflicts: holders.map((row: Record<string, any>) => ({
                chunkKey: String(row.chunk_key),
                userId: String(row.user_id),
                username: String(row.username || ''),
                displayName: String(row.display_name || row.username || ''),
                leaseExpiresAt: iso(row.lease_expires_at),
              })),
            });
          }
        }
        await this.touchPresenceRow(manager, user, sessionId, currentChunk || keys.find((key) => key !== WORLD_LOCK_KEY) || null);
        await this.logActivity(manager, user.id, 'lock', keys, { leaseSeconds: lease });
      });
    } catch (error: any) {
      if (error instanceof ConflictException) {
        await this.writeAudit(user.id, 'collab.lock_denied', 'workspace', WORKSPACE_ID, {
          chunks: keys,
          response: error.getResponse(),
        });
      }
      throw error;
    }

    const rows = await this.dataSource.query(
      `SELECT chunk_key, lease_expires_at FROM collab_chunk_lock
       WHERE workspace_id = $1 AND user_id = $2 AND chunk_key = ANY($3::text[])
       ORDER BY chunk_key`,
      [WORKSPACE_ID, user.id, keys],
    );
    return {
      ok: true,
      leaseSeconds: lease,
      locks: rows.map((row: Record<string, any>) => ({
        chunkKey: String(row.chunk_key),
        expiresAt: iso(row.lease_expires_at),
      })),
      chunkVersions: await this.readVersions(keys),
    };
  }

  async heartbeatLocks(user: AuthUser, sessionId: string | null, dto: HeartbeatLocksDto) {
    let keys: string[] | null = null;
    if (dto.chunkKeys !== undefined) {
      try {
        keys = normalizeChunkKeys(dto.chunkKeys);
      } catch (error: any) {
        throw new BadRequestException(error?.message || '地块参数无效');
      }
    }
    const lease = leaseSeconds(dto.leaseSeconds);
    const currentChunk = chunkOrNull(dto.currentChunk);
    await this.ensureWorkspace();

    const rows = await this.dataSource.transaction(async (manager) => {
      await this.sweep(manager);
      const params: any[] = [WORKSPACE_ID, user.id, lease];
      let sql = `UPDATE collab_chunk_lock
                 SET lease_expires_at = now() + ($3 * interval '1 second'), heartbeat_at = now()
                 WHERE workspace_id = $1 AND user_id = $2`;
      if (keys) {
        params.push(keys);
        sql += ` AND chunk_key = ANY($4::text[])`;
      }
      sql += ' RETURNING chunk_key, lease_expires_at';
      const updated = normalizeReturningRows(await manager.query(sql, params));
      await this.touchPresenceRow(manager, user, sessionId, currentChunk);
      return updated;
    });
    return {
      ok: true,
      leaseSeconds: lease,
      locks: rows.map((row: Record<string, any>) => ({
        chunkKey: String(row.chunk_key),
        expiresAt: iso(row.lease_expires_at),
      })),
    };
  }

  async releaseLocks(user: AuthUser, sessionId: string | null, dto: ReleaseLocksDto) {
    let keys: string[] | null = null;
    if (dto.chunkKeys !== undefined) {
      try {
        keys = normalizeChunkKeys(dto.chunkKeys);
      } catch (error: any) {
        throw new BadRequestException(error?.message || '地块参数无效');
      }
    }
    const currentChunk = chunkOrNull(dto.currentChunk);
    await this.ensureWorkspace();
    const rows = await this.dataSource.transaction(async (manager) => {
      const params: any[] = [WORKSPACE_ID, user.id];
      let sql = `DELETE FROM collab_chunk_lock WHERE workspace_id = $1 AND user_id = $2`;
      if (keys) {
        params.push(keys);
        sql += ` AND chunk_key = ANY($3::text[])`;
      }
      sql += ' RETURNING chunk_key';
      const removed = normalizeReturningRows(await manager.query(sql, params));
      await this.touchPresenceRow(manager, user, sessionId, currentChunk);
      if (removed.length) {
        await this.logActivity(manager, user.id, 'release', removed.map((row: any) => String(row.chunk_key)), {});
      }
      return removed;
    });
    return { ok: true, released: rows.length, chunkKeys: rows.map((row: any) => String(row.chunk_key)) };
  }

  async forceUnlock(admin: AuthUser, dto: ForceUnlockDto) {
    let keys: string[] | null = null;
    if (dto.chunkKeys !== undefined) {
      try {
        keys = normalizeChunkKeys(dto.chunkKeys);
      } catch (error: any) {
        throw new BadRequestException(error?.message || '地块参数无效');
      }
    }
    await this.ensureWorkspace();
    const rows = await this.dataSource.transaction(async (manager) => {
      const params: any[] = [WORKSPACE_ID];
      let sql = `DELETE FROM collab_chunk_lock WHERE workspace_id = $1`;
      if (keys) {
        params.push(keys);
        sql += ` AND chunk_key = ANY($2::text[])`;
      }
      sql += ' RETURNING chunk_key, user_id';
      const removed = normalizeReturningRows(await manager.query(sql, params));
      await this.writeAudit(
        admin.id,
        'collab.force_unlock',
        'workspace',
        WORKSPACE_ID,
        { chunks: removed.map((row: any) => String(row.chunk_key)), holders: removed.map((row: any) => String(row.user_id)) },
        manager,
      );
      await this.logActivity(manager, admin.id, 'force-unlock', removed.map((row: any) => String(row.chunk_key)), {});
      return removed;
    });
    return { ok: true, released: rows.length, chunkKeys: rows.map((row: any) => String(row.chunk_key)) };
  }

  async saveWorkspace(user: AuthUser, dto: SaveWorkspaceDto) {
    const snapshot = dto.snapshot as WorkspaceSnapshot;
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.models)) {
      throw new BadRequestException('共享世界快照缺少 models 数组');
    }
    let changedChunks: string[];
    try {
      changedChunks = normalizeChunkKeys(dto.changedChunks);
    } catch (error: any) {
      throw new BadRequestException(error?.message || 'changedChunks 无效');
    }
    const expectedVersions = dto.expectedVersions;
    if (!expectedVersions || typeof expectedVersions !== 'object' || Array.isArray(expectedVersions)) {
      throw new BadRequestException('expectedVersions 必须是对象');
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
    if (payloadBytes > MAX_SNAPSHOT_BYTES) throw new BadRequestException('共享世界快照超过 25 MB');

    await this.ensureWorkspace();

    const result = await this.dataSource.transaction(async (manager) => {
      await this.sweep(manager);
      const workspaceRows = await manager.query(
        'SELECT id, snapshot, revision, updated_at FROM collab_workspace WHERE id = $1 FOR UPDATE',
        [WORKSPACE_ID],
      );
      const workspace = workspaceRows[0] as WorkspaceRow;
      if (!workspace) throw new BadRequestException('共享工作区不存在');

      const lockRows = await manager.query(
        `SELECT chunk_key, user_id FROM collab_chunk_lock
         WHERE workspace_id = $1 AND chunk_key = ANY($2::text[]) AND lease_expires_at > now()`,
        [WORKSPACE_ID, changedChunks],
      );
      const held = new Map(lockRows.map((row: Record<string, any>) => [String(row.chunk_key), String(row.user_id)]));
      const missing = changedChunks.filter((key) => held.get(key) !== String(user.id));
      if (missing.length) {
        throw new ConflictException({
          code: 'CHUNK_NOT_LOCKED',
          message: '保存前必须锁定所有改动地块',
          chunkKeys: missing,
        });
      }

      const stateRows = await manager.query(
        `SELECT chunk_key, version FROM collab_chunk_state
         WHERE workspace_id = $1 AND chunk_key = ANY($2::text[]) FOR UPDATE`,
        [WORKSPACE_ID, changedChunks],
      );
      const versions = new Map<string, number>();
      for (const row of stateRows as Record<string, any>[]) {
        versions.set(String(row.chunk_key), toNumber(row.version));
      }
      const conflicts: Record<string, { expected: number; current: number }> = {};
      for (const key of changedChunks) {
        const expected = toNumber(expectedVersions[key]);
        const current = versions.get(key) || 0;
        if (expected !== current) conflicts[key] = { expected, current };
      }
      if (Object.keys(conflicts).length) {
        throw new ConflictException({
          code: 'VERSION_CONFLICT',
          message: '区块已被其他成员更新，请刷新共享世界后重做',
          revision: toNumber(workspace.revision),
          conflicts,
        });
      }

      const currentSnapshot = workspace.snapshot || null;
      const merged = mergeSnapshotChunks(currentSnapshot, snapshot, changedChunks);
      const duplicates = findDuplicateModelIds(merged);
      if (duplicates.length) {
        throw new ConflictException({
          code: 'MODEL_ID_CONFLICT',
          message: '合并后的模型 ID 重复，请刷新共享世界后重做',
          modelIds: duplicates,
        });
      }
      const revision = toNumber(workspace.revision) + 1;
      await manager.query(
        `UPDATE collab_workspace
         SET snapshot = $2::jsonb, revision = $3, updated_by = $4, updated_at = now()
         WHERE id = $1`,
        [WORKSPACE_ID, JSON.stringify(merged), revision, user.id],
      );
      for (const key of changedChunks) {
        await manager.query(
          `INSERT INTO collab_chunk_state (workspace_id, chunk_key, version, updated_by, updated_at)
           VALUES ($1,$2,1,$3,now())
           ON CONFLICT (workspace_id, chunk_key) DO UPDATE
             SET version = collab_chunk_state.version + 1,
                 updated_by = EXCLUDED.updated_by,
                 updated_at = now()`,
          [WORKSPACE_ID, key, user.id],
        );
      }
      await this.logActivity(manager, user.id, 'save', changedChunks, {
        revision,
        models: snapshotModelCount(snapshot),
        changed: changedChunks.length,
      });
      await this.writeAudit(
        user.id,
        'collab.save',
        'workspace',
        WORKSPACE_ID,
        { revision, chunkKeys: changedChunks, modelCount: snapshotModelCount(snapshot) },
        manager,
      );
      return { revision, chunkVersions: await this.readVersions(changedChunks, manager) };
    });

    return {
      ok: true,
      revision: result.revision,
      chunkVersions: result.chunkVersions,
      savedAt: new Date().toISOString(),
    };
  }

  private async ensureWorkspace() {
    await this.dataSource.query(
      `INSERT INTO collab_workspace (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
      [WORKSPACE_ID],
    );
    const rows = await this.dataSource.query(
      'SELECT id, snapshot, revision, updated_at FROM collab_workspace WHERE id = $1 LIMIT 1',
      [WORKSPACE_ID],
    );
    if (!rows[0]) return;
    if (rows[0].snapshot) return;
    const published = await this.homepage.load(PUBLISHED_HOMEPAGE_USER);
    if (!published.snapshot) return;
    await this.dataSource.query(
      `UPDATE collab_workspace
       SET snapshot = $2::jsonb, updated_at = now()
       WHERE id = $1 AND snapshot IS NULL`,
      [WORKSPACE_ID, JSON.stringify(published.snapshot)],
    );
  }

  private async readWorkspace(): Promise<WorkspaceRow | null> {
    const rows = await this.dataSource.query(
      'SELECT id, snapshot, revision, updated_at FROM collab_workspace WHERE id = $1 LIMIT 1',
      [WORKSPACE_ID],
    );
    return (rows[0] as WorkspaceRow) || null;
  }

  private async sweep(manager: EntityManager | DataSource['manager'] = this.dataSource.manager) {
    await manager.query('DELETE FROM collab_chunk_lock WHERE lease_expires_at <= now()');
    await manager.query(
      `DELETE FROM collab_presence WHERE last_seen_at < now() - ($1 * interval '1 second')`,
      [PRESENCE_TTL_SECONDS * 4],
    );
  }

  private async touchPresenceRow(
    manager: EntityManager | DataSource['manager'],
    user: AuthUser,
    sessionId: string | null,
    currentChunk: string | null,
  ) {
    if (!sessionId) return;
    await manager.query(
      `INSERT INTO collab_presence (workspace_id, session_id, user_id, current_chunk, last_seen_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (workspace_id, session_id) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             current_chunk = EXCLUDED.current_chunk,
             last_seen_at = now()`,
      [WORKSPACE_ID, sessionId, user.id, currentChunk],
    );
  }

  private async readVersions(keys: string[], manager: EntityManager | DataSource['manager'] = this.dataSource.manager) {
    if (!keys.length) return {};
    const rows = await manager.query(
      `SELECT chunk_key, version FROM collab_chunk_state
       WHERE workspace_id = $1 AND chunk_key = ANY($2::text[])`,
      [WORKSPACE_ID, keys],
    );
    const versions: Record<string, number> = {};
    for (const key of keys) versions[key] = 0;
    for (const row of rows) versions[String(row.chunk_key)] = toNumber(row.version);
    return versions;
  }

  private async buildState(workspace: WorkspaceRow | null, includeSnapshot: boolean) {
    const [states, locks, onlineRows, activityRows, published] = await Promise.all([
      this.dataSource.query(
        'SELECT chunk_key, version, updated_by, updated_at FROM collab_chunk_state WHERE workspace_id = $1',
        [WORKSPACE_ID],
      ) as Promise<StateRow[]>,
      this.dataSource.query(
        `SELECT l.chunk_key, l.user_id, l.lease_expires_at, l.heartbeat_at,
                u.username, u.display_name
         FROM collab_chunk_lock l
         JOIN app_user u ON u.id = l.user_id
         WHERE l.workspace_id = $1 AND l.lease_expires_at > now()
         ORDER BY l.chunk_key`,
        [WORKSPACE_ID],
      ),
      this.dataSource.query(
        `SELECT p.user_id, p.session_id, p.current_chunk, p.last_seen_at,
                u.username, u.display_name
         FROM collab_presence p
         JOIN app_user u ON u.id = p.user_id
         WHERE p.workspace_id = $1 AND p.last_seen_at > now() - ($2 * interval '1 second')
         ORDER BY p.last_seen_at DESC`,
        [WORKSPACE_ID, PRESENCE_TTL_SECONDS],
      ),
      this.dataSource.query(
        `SELECT a.id, a.user_id, a.action, a.chunk_keys, a.detail, a.created_at,
                u.username, u.display_name
         FROM collab_activity a
         LEFT JOIN app_user u ON u.id = a.user_id
         WHERE a.workspace_id = $1
         ORDER BY a.created_at DESC
         LIMIT 30`,
        [WORKSPACE_ID],
      ),
      this.homepage.load(PUBLISHED_HOMEPAGE_USER),
    ]);

    const chunkVersions: Record<string, number> = {};
    for (const state of states) chunkVersions[state.chunk_key] = toNumber(state.version);

    const onlineByUser = new Map<string, Record<string, any>>();
    for (const row of onlineRows as Record<string, any>[]) {
      const userId = String(row.user_id);
      if (onlineByUser.has(userId)) continue;
      onlineByUser.set(userId, {
        userId,
        username: String(row.username || ''),
        displayName: String(row.display_name || row.username || ''),
        currentChunk: row.current_chunk || null,
        lastSeenAt: iso(row.last_seen_at),
      });
    }

    const snapshot = workspace?.snapshot || null;
    return {
      workspace: {
        id: WORKSPACE_ID,
        revision: toNumber(workspace?.revision),
        updatedAt: iso(workspace?.updated_at),
        ...(includeSnapshot ? { snapshot } : {}),
      },
      states: (states as StateRow[]).map((state) => ({
        chunkKey: state.chunk_key,
        version: toNumber(state.version),
        updatedBy: state.updated_by,
        updatedAt: iso(state.updated_at),
      })),
      chunkVersions,
      locks: (locks as Record<string, any>[]).map((row) => ({
        chunkKey: String(row.chunk_key),
        userId: String(row.user_id),
        username: String(row.username || ''),
        displayName: String(row.display_name || row.username || ''),
        expiresAt: iso(row.lease_expires_at),
        heartbeatAt: iso(row.heartbeat_at),
      })),
      online: Array.from(onlineByUser.values()),
      activity: (activityRows as Record<string, any>[]).map((row) => ({
        id: String(row.id),
        action: String(row.action),
        chunkKeys: Array.isArray(row.chunk_keys) ? row.chunk_keys.map(String) : [],
        detail: row.detail || null,
        user: row.user_id
          ? { userId: String(row.user_id), username: String(row.username || ''), displayName: String(row.display_name || row.username || '') }
          : null,
        createdAt: iso(row.created_at),
      })),
      protectedModelIds: ((published.snapshot as WorkspaceSnapshot | null)?.models || [])
        .map((model) => String(model.id)),
      snapshotModelCount: snapshotModelCount(snapshot),
    };
  }

  private async logActivity(
    manager: EntityManager | DataSource['manager'],
    userId: string | null,
    action: string,
    chunkKeys: string[],
    detail: Record<string, any> = {},
  ) {
    await manager.query(
      `INSERT INTO collab_activity (workspace_id, user_id, action, chunk_keys, detail)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [WORKSPACE_ID, userId, action, chunkKeys, JSON.stringify(detail)],
    );
  }

  private async writeAudit(
    actorId: string | null,
    action: string,
    targetType: string,
    targetId: string | null,
    detail: Record<string, any>,
    manager: EntityManager | DataSource['manager'] = this.dataSource.manager,
  ) {
    try {
      await manager.query(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [actorId, action, targetType, targetId, JSON.stringify(detail)],
      );
    } catch (error: any) {
      this.logger.warn('写入审计日志失败：' + (error?.message || error));
    }
  }
}
