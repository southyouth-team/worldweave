# Security Policy

## Supported versions

当前维护 `main` 分支。发布版本会在 GitHub Releases 中标注。

## Reporting a vulnerability

请通过 GitHub 的 **Security → Report a vulnerability**（Security Advisories）私下报告，不要开公开 Issue。

报告时请尽量包含：

- 受影响的接口、页面或版本
- 复现步骤与最小请求
- 影响范围（未授权访问、数据泄露、权限提升等）
- 可能的修复建议

## Deployment checklist

- `NODE_ENV=production`
- 设置强随机 `ADMIN_PASSWORD`，首次登录立即改密
- `AUTH_ALLOW_DEV_HEADER=false`，禁止 `X-Dev-User-Id` 兼容层
- 严格限制 `CORS_ORIGIN` 为实际前端域名
- 使用 HTTPS，反向代理设置安全响应头与请求体上限
- `ASSET_STORAGE_DIR` 使用持久化卷，并限制目录访问权限
- 数据库使用最小权限账号，定期备份
- 登录、加入申请与 AI 生成接口在反向代理层增加限流
- 不要把 `.env`、数据库导出、用户密码、上传快照或未授权的校园数据提交到仓库

## 已知边界

- 共享世界与区块锁仍在路线图中；当前发布审核基于成员提交时冻结的快照。
- AI 生成接口会产生外部服务费用，生产环境应配置预算、限额和更细的限流。
- 开发用 `X-Dev-User-Id` 兼容层仅用于本地联调；生产环境会被拒绝，请确保已关闭。
