import { MigrationInterface, QueryRunner } from 'typeorm';

/** 发布快照内容哈希：阻止没有实际改动的重复提交。 */
export class AddPublishSnapshotHash1763400000000 implements MigrationInterface {
  name = 'AddPublishSnapshotHash1763400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE publish_request ADD COLUMN IF NOT EXISTS snapshot_hash CHAR(64)',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_publish_request_hash_status ON publish_request(snapshot_hash, status)',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_publish_request_requester_hash ON publish_request(requester_id, snapshot_hash, created_at DESC)',
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_publish_request_pending_hash
       ON publish_request(snapshot_hash)
       WHERE status = 'pending' AND snapshot_hash IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS uq_publish_request_pending_hash');
    await queryRunner.query('DROP INDEX IF EXISTS idx_publish_request_requester_hash');
    await queryRunner.query('DROP INDEX IF EXISTS idx_publish_request_hash_status');
    await queryRunner.query('ALTER TABLE publish_request DROP COLUMN IF EXISTS snapshot_hash');
  }
}
