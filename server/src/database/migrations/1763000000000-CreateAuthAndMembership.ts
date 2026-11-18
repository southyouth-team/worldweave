import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 账号体系：管理员/团队成员、服务端会话、加入申请。
 * 现有业务表的 created_by/user_id 仍是 VARCHAR，不强制外键，避免历史开发数据迁移失败。
 */
export class CreateAuthAndMembership1763000000000 implements MigrationInterface {
  name = 'CreateAuthAndMembership1763000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app_user (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(64) NOT NULL,
        display_name VARCHAR(120) NOT NULL,
        password_hash TEXT NOT NULL,
        role VARCHAR(16) NOT NULL DEFAULT 'member',
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        must_change_password BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at TIMESTAMPTZ,
        CONSTRAINT ck_app_user_role CHECK (role IN ('admin','member')),
        CONSTRAINT ck_app_user_status CHECK (status IN ('active','disabled'))
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_app_user_username_lower ON app_user (lower(username))',
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_session (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        user_agent VARCHAR(300),
        ip VARCHAR(64)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_auth_session_user ON auth_session(user_id)',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_auth_session_expires ON auth_session(expires_at)',
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS join_application (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(120) NOT NULL,
        contact VARCHAR(200) NOT NULL,
        desired_username VARCHAR(64) NOT NULL,
        reason VARCHAR(1000) NOT NULL DEFAULT '',
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        review_note VARCHAR(500),
        reviewed_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT ck_join_application_status CHECK (status IN ('pending','approved','rejected'))
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_join_application_status ON join_application(status, created_at DESC)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS join_application');
    await queryRunner.query('DROP TABLE IF EXISTS auth_session');
    await queryRunner.query('DROP TABLE IF EXISTS app_user');
  }
}
