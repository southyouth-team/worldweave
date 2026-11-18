import { MigrationInterface, QueryRunner } from 'typeorm';

/** 成员提交发布申请，管理员审核通过后写入全局首页发布快照。 */
export class CreatePublishRequests1763100000000 implements MigrationInterface {
  name = 'CreatePublishRequests1763100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS publish_request (
        id UUID PRIMARY KEY,
        requester_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        note VARCHAR(1000) NOT NULL DEFAULT '',
        model_count INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        snapshot_bytes INTEGER NOT NULL DEFAULT 0,
        snapshot_file VARCHAR(200) NOT NULL,
        thumbnail_data_url TEXT,
        review_note VARCHAR(1000),
        reviewed_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT ck_publish_request_status CHECK (status IN ('pending','approved','rejected','stale'))
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_publish_request_status ON publish_request(status, created_at DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_publish_request_requester ON publish_request(requester_id, created_at DESC)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS publish_request');
  }
}
