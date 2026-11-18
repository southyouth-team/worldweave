# Worldweave · 织界

**源码公开的 AI 三维世界沙盒。**
Worldweave 把地块化 2.5D / 3D 世界编辑、AI 程序化模型生成、发布审核和团队协作放在同一个工作台里。校园只是内置示例场景——它同样可以用于园区、展场、乐园或任何等距世界。

> Source-available AI-assisted isometric world sandbox. Campus is a demo, not a limit.

> 本项目使用 **CC BY-NC-SA 4.0**：允许非商业使用、修改和分发，要求署名并以相同协议共享；禁止商业用途。它不是 OSI 认证的开源许可证。

## 功能

- **双视图世界**：2.5D 等距与 3D 透视，总览、角色跟随、第一人称。
- **地块化世界**：区块扩建/回收、边界与占地轮廓；道路绘制、拉伸、断点拐弯与路口自然过渡。
- **AI 模型**：spec-first 分阶段生成（blockout → structure → material）、多视角视觉质检、自动修复、部件级选择与编辑。
- **发布审核**：成员提交冻结的沙盒快照 → 管理员用 3D 视图预览模型和位置 → 通过后首页切换版本，旧的待审申请自动标记过期。
- **账号与角色**：管理员 / 团队成员；加入申请、审核建号、启停用、重置密码、首次登录强制改密。
- **站点设置**：品牌、标题、SEO、logo、主题色、浏览器预览；后台内嵌，无需跳转。
- **液态玻璃 UI**：桌面与移动端适配。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3、Vite、Three.js、Rapier |
| 后端 | NestJS、TypeORM、PostgreSQL / PostGIS |
| AI | 通过环境变量接入兼容 OpenAI 风格的图像/视觉模型服务 |

## 快速开始

### 环境要求

- Node.js 20.19+（推荐 24 LTS）
- npm 10+
- PostgreSQL 16+，PostGIS 3.4+
- 可选：用于 AI 生成的图像/视觉模型服务

### 前端

```bash
npm install
npm run dev
```

打开 `http://localhost:5173/`。

### 后端

```bash
cd server
cp .env.example .env
# 修改 .env 中的数据库连接
npm install
npm run db:migrate
npm run start:dev
```

后端默认监听 `http://localhost:3001`，API 前缀 `/api/v1`，开发环境 Swagger 在 `/api/docs`。

开发环境首次启动会自动创建管理员 `admin / Admin@12345`，并强制首次登录改密。**生产环境必须设置 `ADMIN_USERNAME` / `ADMIN_PASSWORD`。**

### 主要入口

| 地址 | 说明 |
| --- | --- |
| `/` | 首页：只渲染管理员审核通过的世界版本 |
| `/world-sandbox-mvp` | 世界沙盒编辑器（需登录） |
| `/admin` | 管理后台：加入申请、发布审核、成员、站点设置 |
| `/join` | 申请加入团队 |
| `/login` | 登录 |

## 环境变量

关键配置（完整见 `server/.env.example`）：

| 变量 | 说明 |
| --- | --- |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | PostgreSQL 连接 |
| `CORS_ORIGIN` | 允许的前端来源，多个用逗号分隔 |
| `ASSET_STORAGE_DIR` | 上传/快照持久化目录，生产环境请挂载持久卷 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_DISPLAY_NAME` | 初始管理员（生产必填） |
| `AUTH_ALLOW_DEV_HEADER` | 是否允许开发用 `X-Dev-User-Id` 兼容层，生产建议 `false` |
| `IMAGE_API_KEY` / `IMAGE_API_BASE_URL` / `IMAGE_MODEL` | AI 图像/模型生成服务 |
| `VISION_API_KEY` / `VISION_API_BASE_URL` | 视觉质检服务（未单独配置时复用图像配置） |

前端可用 `VITE_API_BASE_URL` 指定后端地址。

## 项目结构

```
src/                 Vue 前端（首页、沙盒编辑器、管理后台、AI 工作台）
server/              NestJS 后端（账号、资产、发布、站点设置、数据库迁移）
public/              静态资源、manifest、favicon
docs/                架构、数据契约与历史规划文档
```

## 当前协作边界

已经具备：账号/角色、加入申请审批、成员管理、发布申请与 3D 审核、站点设置。

仍在路线图中：**共享世界 + 区块锁/在线状态**、已发布模型对普通成员的服务端只读强制、审计日志、WebSocket 实时协作。当前成员的编辑保存在各自浏览器，发布审核提交的是提交时冻结的快照。

## 安全部署

- `NODE_ENV=production`
- 设置强 `ADMIN_PASSWORD`，首次登录立即改密
- `AUTH_ALLOW_DEV_HEADER=false`，关闭开发身份兼容层
- 严格配置 `CORS_ORIGIN`，使用 HTTPS
- `ASSET_STORAGE_DIR` 使用持久化磁盘并限制访问
- 不要提交 `.env`、数据库导出或含个人信息的校园数据
- 详见 [SECURITY.md](SECURITY.md)

## 测试

```bash
npm test
cd server && npm test
```

## 示例数据与商标

南昌工学院相关的名称、校徽、平面图、扫描数据和演示模型仅用于展示与技术验证，**本项目不是学校官方项目**。代码许可证不授予这些商标、校名或数据的使用权；使用真实校园数据前请先取得授权，并在发布内容中注明来源。

## 路线图

- 服务端共享工作区 + 区块锁（租约/心跳/管理员强制解锁）+ 在线成员状态
- 已发布实体对普通成员只读的服务端强制与审计日志
- 发布快照的只读沙盒预览与版本对比
- 学校统一身份认证（CAS / OAuth2 / OIDC）
- AI 生成队列、成本限额与更细的接口限流

## 贡献

欢迎提交 Issue 和 Pull Request。请先跑通前后端测试，不要提交密钥、`.env`、上传快照或未授权的校园数据。较大的改动建议先开 Issue 讨论方案。

## 许可证

[Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](LICENSE) © 2026 Worldweave contributors

- 允许：非商业使用、修改、分发；必须署名，衍生作品需以相同协议共享。
- 禁止：任何商业用途；商业使用需要单独获得授权。
- 本项目属于 **source-available / 源码公开**，不是 OSI 认证的开源项目。
- Creative Commons 不建议将 CC 许可用于软件；本项目选择它是因为“禁止商用”优先。依赖库仍遵循各自许可证。
- 示例校园数据、校名与校徽不在授权范围内。

许可证全文：<https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode>
