# 沙盒模型管理与内置素材库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把程序化内置素材接进 MVP「模型管理」面板并补齐碰撞，同时新增服务端持久化的个人程序化模型资产库（手动入库、列表、重命名、删除、取出再放置）。

**Architecture:** 服务端在 AssetsService 既有存储骨架（manifest 串行写 + 磁盘 JSON + sha256 + 用户隔离）上并列新增 `proceduralAssets` 资产类型与 `/assets/procedural-assets` 路由组，服务端只存不执行源码。前端新建三个模块：fetch 客户端（`src/components/sandbox/`）、内置素材适配层（`src/three/sandbox/builtinAssetAdapter.js`，把生成器产物标注 componentId/collisionPolicy/碰撞清单并过真实分析器门禁）、面板纯逻辑模块；两条来源在 `engine.beginSandboxModelPlacement` 前汇合，后续放置/合批/快照全复用既有链路。

**Tech Stack:** NestJS + Jest（服务端，`server/` 下 `*.spec.ts`）；Vue 3 `<script setup>` + Three.js r180 + Vitest（前端，`*.test.js`）；无新依赖。

**Spec:** `docs/superpowers/specs/2026-11-12-sandbox-asset-library-design.md`（rev.2，已批准）

## Global Constraints

- UI 文案与报错消息一律中文；代码标识符英文。
- 源码硬上限 `120000` 字符（与 `executeProceduralModel.js` 的 `MAX_SOURCE_LENGTH` 一致）；单资产落盘 JSON ≤ `2 * 1024 * 1024` 字节；`name` 截断 ≤160 字符；**不做任何顶点/面数/尺寸预算限制**。
- 服务端永不执行 `sourceCode`，只做形状与大小校验；执行只发生在浏览器 module Worker。
- 所有新路由挂 `DevIdentityGuard`；该 guard 在 `NODE_ENV=production` 拒绝请求是既有约束，资产库继承，不另造认证。
- 内置素材只接 5 类：`vegetation` / `structure` / `facility` / `decoration` / `sports`；`road` / `water` / `terrain` 适配层显式报错；统一 `stylized` 默认调色板，不暴露风格切换。
- 不修改 `src/three/world/campus/sceneAssetGeneratorRegistry.js`（它还服务模板工坊页面）；所有包装在新适配模块完成。
- 可见 Mesh 不自动成为碰撞体；适配产物必须 `analyzeModelCollisionCompleteness(root).status === 'complete'`（零 error 零 warning）才允许进入选址，Vue 层与 AI 模型同一道门禁。
- 严格 TDD：先写失败测试并亲见 RED（失败原因必须是功能缺失而非语法错误），再最小实现到 GREEN；前端 `npx vitest run <file>`，服务端 `cd server && npx jest <spec>`。
- 不引入新 npm 依赖（项目无 @vue/test-utils）：Vue 面板可测逻辑抽到纯函数模块单测，模板接线靠 `npm run build` + Task 5 浏览器清单验证。
- 提交/推送只在用户当次明确授权后执行；提交信息末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。工作区既有的两个 `package-lock.json`、`server/uploads/`、Trace 文件删除不属于本特性，禁止纳入提交。
- 不迁移 localStorage 快照机制；删除库存记录不得影响已落位实例（实例不持有库存引用）。
- `1.PY` 永不修改；`server/uploads/` 内容视为不可信数据。

## Review Focus

规格没有逐字写出、但最容易咬人的五个失效模式，每条钉到所属任务的验证：

1. **服务端离线/未启动时打开沙盒**：资产库列表加载失败必须被捕获为空列表 + 中文提示，不得阻断引擎初始化与其他面板。归属 Task 4；靠 onMounted 加载函数的 catch 分支 + Task 5 浏览器清单③（停掉 server 复测）兜底，无单测（不挂载 Vue）。
2. **旧 localStorage 快照恢复的 AI 模型没有 `proceduralModelSource`**：入库按钮必须禁用并说明，而不是点击后抛错。归属 Task 4；`assetLibraryUi.canArchiveSandboxModel` 的纯函数测试钉死。
3. **删除库存记录后旧实例仍在且可交互**：放置走 Worker 重建独立实例、实例只存自己的 userData。归属 Task 4；架构上由「取出即 executeProceduralModel 新建对象」保证，Task 5 浏览器清单④人工验证。
4. **生成器目录未来新增类别或漏配碰撞规则**：适配层必须显式 throw，而不是静默产出无碰撞模型。归属 Task 3；`road/road` 抛错测试 + 全目录 13 条目逐条过分析器的循环测试钉死（重复 componentId 在分析器里是 error，同名 Mesh 编号漏洞会立刻让该测试变红）。
5. **同名多实例 Mesh（bridge-baluster、bench-seat、road-marking 式重复命名）**：componentId 序号必须唯一、box 尺寸必须为正数。归属 Task 3；同上循环测试中 bridge/bench 若编号重复或尺寸非法，分析器 status 立即变 `invalid`。

---

### Task 1: 服务端程序化模型资产持久化

**Files:**
- Modify: `server/src/modules/assets/assets.service.ts`（新增 5 个方法 + `proceduralAssets` 归一化；不动现有方法）
- Create: `server/src/modules/assets/procedural-assets.controller.ts`
- Modify: `server/src/modules/assets/assets.module.ts`（controllers 数组加一项）
- Test: `server/src/modules/assets/procedural-assets.service.spec.ts`

**Interfaces:**
- Consumes: `AssetsService` 既有私有件——`readVisualManifest()` / `writeVisualManifest()` / `enqueueVisualManifestUpdate()` / `visualManifestPath`；构造签名 `new AssetsService(dataSource, config)`，测试沿用 `{ query: jest.fn() }` + mkdtemp 临时目录（见 `visual-assets.service.spec.ts:9-18`）。
- Produces（Task 2/4 依赖这些 HTTP 契约，形状不得改名）:
  - 路由组 `assets/procedural-assets`，全部 `@UseGuards(DevIdentityGuard)`，`req.user.id` 为用户身份。
  - `POST /` 入参 `{ name, category, objectType, sourceCode, manifest, parameters?, parts?, environmentBindings? }`；返回 manifest 记录（不含 sourceCode 字段）。
  - `GET /` 返回当前用户记录数组（元数据，无源码正文）。
  - `GET /:assetId` 返回 `{ ...record, sourceCode, manifest, parameters, parts, environmentBindings }`。
  - `PUT /:assetId` 入参 `{ name }`；返回更新后的记录。
  - `DELETE /:assetId` 返回 `{ assetId, deleted: boolean }`，记录不存在时幂等返回 `deleted: false`，不抛。
  - manifest 记录形状：`{ assetId, name, category, objectType, format: 'procedural-module', filePath: 'procedural/<assetId>.json', checksumSha256, sizeBytes, createdBy, createdAt, updatedAt }`。
  - 落盘文件形状：`{ schemaVersion: 1, assetId, name, category, objectType, sourceCode, manifest, parameters, parts, environmentBindings, createdAt, updatedAt }`，目录 `<storageDir>/campus-visual-assets/procedural/`，tmp 文件 `flag: 'wx'` + rename 原子写。
  - Service 方法名：`saveProceduralAsset(userId, input)` / `listProceduralAssets(userId)` / `getProceduralAsset(userId, assetId)` / `renameProceduralAsset(userId, assetId, name)` / `deleteProceduralAsset(userId, assetId)`。

- [ ] **Step 1: 写失败测试——入库成功路径 + 列表不含源码 + 字段归一化**

新建 spec（mkdtemp/rm 骨架照抄 `visual-assets.service.spec.ts:9-18`），第一批 it：
- `saveProceduralAsset` 成功后：返回记录含 `format: 'procedural-module'`、`filePath` 以 `procedural/` 开头、`checksumSha256` 为 64 位 hex、`createdBy` 等于入参 userId；`getVisualAssetManifest().proceduralAssets` 长度为 1 且记录不含 `sourceCode` 键。
- `listProceduralAssets` 只返回 `createdBy === userId` 的记录（先存 user-a 再用 user-b 查，断言空数组），且每条记录无 `sourceCode` 键。
- 入参 `parameters/parts/environmentBindings` 传 `null`/非数组时，落盘 JSON 中被归一化为 `[]`（用 `getProceduralAsset` 读回断言）。
- `manifest` 入参为 `{ version: 1, capabilities: {} }` 时原样落盘读回。

- [ ] **Step 2: 跑测试确认 RED**

Run: `cd server && npx jest procedural-assets.service.spec`
Expected: FAIL，`service.saveProceduralAsset is not a function`（方法不存在）。

- [ ] **Step 3: 实现 `saveProceduralAsset` 与 `listProceduralAssets`**

在 `assets.service.ts` 实现，模式逐行对齐 `saveObjectSculptAsset`（assets.service.ts:230-277）：校验 → `randomUUID()` → mkdir → tmp+rename 写文件 → `enqueueVisualManifestUpdate` 推记录，队列回调里先 `manifest.proceduralAssets = Array.isArray(manifest.proceduralAssets) ? manifest.proceduralAssets : []` 归一化（自审 A）；写清单失败 catch 里 `rm(absolutePath, { force: true })` 回滚。校验规则：`userId` 非空；`sourceCode` 必须是非空 string 且 `.length <= 120000`，否则 `BadRequestException`（中文消息）；`name` 取 `String(input.name || '未命名程序化模型').trim().slice(0, 160)`，空串回退默认名；`category`/`objectType` 为非空 string 各 slice 80/120；`manifest` 必须是对象且带 `version` 字段；整体 `JSON.stringify(payload)` 字节数 > 2MB 抛 BadRequestException。`listProceduralAssets` 读 manifest 后按 `createdBy` 过滤，map 时显式挑记录字段返回（不整对象透传，保证不带源码）。

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `cd server && npx jest procedural-assets.service.spec`
Expected: 第一批 4 个 it 全 PASS。

- [ ] **Step 5: 写失败测试——单读/校验和/越权/重命名/删除/上限**

新增 it：
- `getProceduralAsset`  happy path 返回源码与四个数组字段；把磁盘文件改坏一个字符后调用，reject 抛 NotFound（消息含「校验失败」）。
- 越权：user-a 入库、user-b 单读 → `ForbiddenException`；user-b 重命名 → Forbidden；user-b 删除 → Forbidden，且 manifest 记录仍在。
- 不存在的 UUID 单读 → NotFound；不合 UUID 格式（`'../x'`）→ NotFound。
- `renameProceduralAsset` 改名后记录 `name` 更新、`updatedAt` 变化、磁盘文件仍可读且源码不变。
- `deleteProceduralAsset` 后：manifest 记录消失、磁盘文件不存在；对同一 id 再删一次不抛且返回 `{ deleted: false }`。
- 校验：`sourceCode` 传 `123`（非字符串）→ BadRequest；空串 → BadRequest；120001 字符字符串 → BadRequest 且磁盘无新增文件；构造接近 2MB 的合法 payload → BadRequest。
- 回滚（spec §5.1 点名项）：`jest.spyOn(service as any, 'writeVisualManifest').mockRejectedValueOnce(new Error('disk full'))` 后调 `saveProceduralAsset` → reject；断言 `procedural/` 目录下无 `.json` 文件、manifest 中 `proceduralAssets` 为空（tmp 与正式文件都不得残留）。

- [ ] **Step 6: 跑测试确认 RED**

Expected: FAIL，`getProceduralAsset is not a function` 等（对应方法缺失）。

- [ ] **Step 7: 实现 `getProceduralAsset` / `renameProceduralAsset` / `deleteProceduralAsset`**

单读对齐 `getObjectSculptAsset`（assets.service.ts:279-302）：UUID 正则 → 查记录 → 404 → `createdBy` 403 → `relative(root, absolutePath)` 路径穿越防护 → readFile + JSON.parse → sha256 不等抛 NotFound「校验失败」→ 返回记录展开 + 文件体内字段。重命名与删除都走 `enqueueVisualManifestUpdate`；删除先 `rm(file, { force: true })` 再在队列回调里 filter 记录（回调外抛错则文件与清单保持原状语义，靠队列串行）；幂等分支在查不到记录时直接 return `{ assetId, deleted: false }`，不触碰文件系统。

- [ ] **Step 8: 跑测试确认 GREEN**

Run: `cd server && npx jest procedural-assets.service.spec`
Expected: 本 spec 全部 it PASS。

- [ ] **Step 9: 写 controller 与模块注册**

新建 `procedural-assets.controller.ts`：`@ApiTags('campus-visual-assets')` + `@Controller('assets/procedural-assets')`，五个路由方法签名照抄 `visual-assets.controller.ts:23-35` 的 guard/Req/Param/Body 写法，逐个委派 service。修改 `assets.module.ts` controllers 数组追加 `ProceduralAssetsController`，providers 不动（复用 AssetsService 单例与既有 DevIdentityGuard）。

- [ ] **Step 10: 服务端全量验证**

Run: `cd server && npm test`
Expected: 全部 spec 通过（含既有 visual-assets spec，无回归）。
Run: `cd server && npm run build`
Expected: `nest build` exit 0（证明 controller 类型与模块注册正确）。

- [ ] **Step 11: 提交（仅在用户授权后）**

```bash
git add server/src/modules/assets/assets.service.ts server/src/modules/assets/procedural-assets.controller.ts server/src/modules/assets/assets.module.ts server/src/modules/assets/procedural-assets.service.spec.ts
git commit -m "feat(server): persist sandbox procedural model assets with ownership and checksums"
```

---

### Task 2: 前端资产库 API 客户端

**Files:**
- Create: `src/components/sandbox/proceduralAssetClient.js`
- Test: `src/components/sandbox/proceduralAssetClient.test.js`

**Interfaces:**
- Consumes: `API_BASE`（默认 `http://localhost:3001/api/v1`）与 dev 用户 id（Vue 层传入，模块自身不读 import.meta.env）；全局 `fetch`。
- Produces:
  - `export const MAX_PROCEDURAL_SOURCE_LENGTH = 120000`
  - `export function createProceduralAssetClient({ baseUrl, devUserId, fetchImpl })`：`fetchImpl` 缺省取 `globalThis.fetch`；返回对象五方法 `saveAsset(input)` / `listAssets()` / `getAsset(assetId)` / `renameAsset(assetId, name)` / `removeAsset(assetId)`。
  - 五方法均为 async；非 2xx 响应读取 `body.message` 后抛 `Error`，无 message 时用各方法内置中文兜底（如「资产库加载失败：HTTP 500」）。
  - 每个请求头固定 `{ 'Content-Type': 'application/json', 'X-Dev-User-Id': devUserId }`（GET/DELETE 不带 Content-Type 以外的差异，保持统一即可）。
  - `saveAsset(input)` 在发请求前校验 `input.sourceCode` 为非空字符串且长度 ≤ 120000，超限抛 `RangeError('模型源码超过 120 KB，无法存入资产库')`，且不调用 fetchImpl。

- [ ] **Step 1: 写失败测试——请求契约与错误中文化**

mock 方式：`const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)`（teardown `vi.unstubAllGlobals()`），构造 `new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })` 作为返回值。it 覆盖：
- `listAssets` 调用 URL 等于 `${baseUrl}/assets/procedural-assets`、method GET、请求头含 `X-Dev-User-Id: 'u1'`，返回值直通 JSON body。
- `saveAsset({ name: 'a', sourceCode: 'x', ... })` 方法 POST、body 经 `JSON.parse` 后字段与入参一致。
- `getAsset('id-1')` GET `.../id-1`；`renameAsset` 为 PUT 且 body 只有 `{ name }`；`removeAsset` 为 DELETE。
- 500 响应带 `{ message: '服务器炸了' }` 时 reject Error 消息等于该 message；无 message 的 404 reject 消息含「HTTP 404」。
- 120001 字符源码调 `saveAsset`：reject RangeError 且 `fetchMock` 未被调用；空字符串同样 reject。

- [ ] **Step 2: 跑测试确认 RED**

Run: `npx vitest run src/components/sandbox/proceduralAssetClient.test.js`
Expected: FAIL，模块解析失败（`Cannot find module .../proceduralAssetClient.js`）。

- [ ] **Step 3: 实现 `createProceduralAssetClient`**

单文件纯工厂：内部 `request(path, options)` 收敛 URL 拼接、请求头、`response.ok` 判断与中文错误；五个方法各自一行委派 + 正确 HTTP method；`saveAsset` 入口先做长度校验。注意 `fetchImpl` 参数化，测试注入 mock，生产代码由 Vue 传 `globalThis.fetch`（或省略走缺省）。

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `npx vitest run src/components/sandbox/proceduralAssetClient.test.js`
Expected: 全部 it PASS，输出无 warning。

- [ ] **Step 5: 提交（仅在用户授权后）**

```bash
git add src/components/sandbox/proceduralAssetClient.js src/components/sandbox/proceduralAssetClient.test.js
git commit -m "feat(client): add procedural asset library API client with Chinese errors"
```

---

### Task 3: 内置素材适配层（含碰撞清单）

**Files:**
- Create: `src/three/sandbox/builtinAssetAdapter.js`
- Test: `src/three/sandbox/builtinAssetAdapter.test.js`

**Interfaces:**
- Consumes: `createSceneAssetGeneratorRegistry(THREE)`（只读消费，禁止修改该文件）；真实 `analyzeModelCollisionCompleteness`（`src/three/sandbox/modelCollisionAnalyzer.js`）；真实 three（`import * as THREE from 'three'`）。
- Produces:
  - `export const BUILTIN_CATEGORY_LABELS`：`{ vegetation: '植被', structure: '构筑物', facility: '设施', decoration: '装饰', sports: '运动' }`。
  - `export const BUILTIN_ASSET_LABELS`：key 为 `` `${category}:${objectType}` `` 的中文展示名映射，覆盖下列全部 13 条目。
  - `export const BUILTIN_ASSET_CATALOG`：frozen 数组，5 类共 13 个规范英文 objectType——vegetation: `tree`/`shrub`/`flower`；structure: `bridge`/`pergola`/`pavilion`；facility: `bench`/`lamp`/`bin`/`sign`；decoration: `rock`/`flowerbed`；sports: `basketball-hoop`。多语言别名一律不进目录（自审 C）。
  - `export function listBuiltinAssets()`：返回 `[{ category, objectType, label }]` 扁平数组，13 项，按 catalog 顺序。
  - `export function createBuiltinSandboxModel(THREE, registry, { category, objectType })`：返回带完整碰撞标注的 Group；不支持的类别/objectType（含 road/water/terrain）抛 `Error('内置素材适配层暂不支持该素材：<category>/<objectType>')`。
  - 适配产物根 userData：`assetName`（中文 label）、`proceduralModelSource: null`、`builtinAssetRef: { category, objectType }`，保留 registry 已写的 `sceneAsset`。
  - 每个 Mesh 的 userData：`componentId`（`` `${category}-${objectType}-${semantic}-${seq}` ``，semantic 取 mesh.name 去掉尾部 `-数字` 后的剩余部分，seq 为同 semantic 从 0 起的遍历序号）+ `collisionPolicy: 'required' | 'none'`。
  - `root.userData.proceduralModelCapabilityManifest = { version: 1, parameters: [], capabilities: { spatial: { colliders: [...] } } }`；required 部件一条 box 声明：`{ id: 'collider-' + componentId, targetPartId: componentId, shape: 'box', center: { x: 0, y: 0, z: 0 }, size: { x, y, z } }`，size 取该 Mesh **局部几何** `geometry.computeBoundingBox()` 后 `getSize` 的有限正数值（位移在 mesh.position 上，运行时用 part.matrixWorld 换算，见 modelSpatialRuntime.js:94-119）；none 部件不进 colliders。

碰撞规则表（规格 §4.3，常量集中在本模块单一来源）：

| 素材 | required 部件（按 semantic 前缀匹配） | none 部件 |
|------|--------------------------------|-----------|
| tree | trunk | crown、crown-highlight |
| shrub | 无（全部 none） | 全部 |
| flower | 无（全部 none） | 全部 |
| bench | seat、back、leg、armrest | — |
| lamp | pole、head | emitter |
| bin | body、lid | — |
| sign | post、board | — |
| bridge | deck、railing、baluster、pier | — |
| pergola / pavilion | post | roof、roof-cap |
| rock | 全部 | — |
| flowerbed | border | soil、其余花朵 |
| basketball-hoop | support | backboard、rim |

- [ ] **Step 1: 写失败测试——目录/标签/保护分支/代表物件结构**

it 列表：
- `listBuiltinAssets()` 长度 13；每个 category 内 objectType 唯一（别名去重断言：无中文 objectType、无重复键）；每项 label 是非空中文字符串且 `BUILTIN_ASSET_LABELS` 能按 `${category}:${objectType}` 取到。
- `createBuiltinSandboxModel(THREE, registry, { category: 'road', objectType: 'road' })` throw，消息含「暂不支持」；未知 objectType 同样 throw。
- tree 代表物件：trunk 部件 `collisionPolicy === 'required'` 且 manifest colliders 里存在 targetPartId 指向它的 box，size 三值均 >0；所有 crown 部件 policy 为 `'none'` 且无对应 collider；根 userData 三个字段齐全（assetName/`proceduralModelSource === null`/builtinAssetRef）。
- flower 与 shrub：分析器之外先断言所有部件 policy 均为 `'none'`、colliders 数组为空。
- basketball-hoop：support required、backboard/rim none。

- [ ] **Step 2: 跑测试确认 RED**

Run: `npx vitest run src/three/sandbox/builtinAssetAdapter.test.js`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现目录常量与 `createBuiltinSandboxModel` 主体**

同文件内：常量目录/标签 → 策略表（key 用 `${category}:${objectType}`，值为 `{ required: [semantic 前缀...], noneAll?: true }`，未命中前缀的防御默认 throw 而不是静默 none）→ 工厂函数：先查 catalog 白名单，再 `registry.generate({ category, objectType, visualStyle: 'stylized' })`；`root.traverse` 收集 `isMesh`，维护 `Map<semantic, number>` 发序号、挂 componentId 与 policy；对 required 部件 `geometry.boundingBox ?? geometry.computeBoundingBox()` 取 size 生成 box 声明；最后写根 userData 与 manifest。

- [ ] **Step 4: 跑测试确认 GREEN**

Run: 同 Step 2 命令。
Expected: 第一批 it 全 PASS。

- [ ] **Step 5: 写失败测试——真实分析器全量门禁（自审 B/E/F 的硬断言）**

新增两个 it：
- 对 `listBuiltinAssets()` 全部 13 条目循环调用工厂，每次对返回 root 调真实 `analyzeModelCollisionCompleteness`：断言 `status === 'complete'`、`issues` 长度为 0、`summary.componentCount` 等于树内带 componentId 的 Mesh 总数。
- 手工破坏断言（临时把某棵 tree 的 trunk policy 改成 undefined 仅存在于本测试内构造的对象上）确认分析器会报 `collision.policy.unclassified`——此 it 用一个裸 Group 模拟即可，目的是钉死「漏标 = 非 complete」这条门禁前提。

- [ ] **Step 6: 跑测试确认 RED 再实现到 GREEN**

先跑：若 13 条目里有任何一条因规则表漏配 semantic、同名编号重复或 box 尺寸非法而变红，记录失败条目，回到 Step 3 修策略表（这是预期会抓到问题的一步）；修到全绿为止，每次改动后重跑同一命令。
Expected 终态：本测试文件全部 it PASS。

- [ ] **Step 7: 沙盒目录回归**

Run: `npx vitest run src/three/sandbox/ src/three/world/`
Expected: 既有测试零回归（生成器注册表未改，其消费者测试应全绿）。

- [ ] **Step 8: 提交（仅在用户授权后）**

```bash
git add src/three/sandbox/builtinAssetAdapter.js src/three/sandbox/builtinAssetAdapter.test.js
git commit -m "feat(sandbox): adapt built-in procedural assets with complete collision declarations"
```

---

### Task 4: WorldSandboxMvp 面板接线（资产库两分区 + 入库 + 选址汇合）

**Files:**
- Create: `src/components/sandbox/assetLibraryUi.js`（纯逻辑，可单测）
- Test: `src/components/sandbox/assetLibraryUi.test.js`
- Modify: `src/components/WorldSandboxMvp.vue`（script imports/状态/处理函数 + 模板 model 模式空白态分支与选中态按钮）

**Interfaces:**
- Consumes: Task 2 的 `createProceduralAssetClient`；Task 3 的 `listBuiltinAssets` / `BUILTIN_CATEGORY_LABELS` / `createBuiltinSandboxModel`；`createSceneAssetGeneratorRegistry(THREE)`；既有 `executeProceduralModel(source, { timeoutMs: 60000 })`、`analyzeModelCollisionCompleteness`、`engine.beginSandboxModelPlacement(model)`（接受未挂场景的裸 Object3D，内部 scene.add 并进入 ghost 选址，createCampusEngine.js:1084-1126）、`handlePlacementChange` 既有 confirmed/cancelled 分支（不动）。
- Produces（纯模块，供 Vue 与测试共用）:
  - `canArchiveSandboxModel(model)`：`typeof model?.userData?.proceduralModelSource === 'string' && source.trim().length > 0`，否则 false。
  - `buildProceduralAssetPayload(model, name)`：从 userData 读取并返回 `{ name, category: 'sandbox-model', objectType: model.userData.proceduralModelConfig?.objectType || '独立 3D 模型', sourceCode, manifest: proceduralModelCapabilityManifest || { version: 1, capabilities: {} }, parameters: proceduralModelParameters || [], parts: proceduralModelParts || [], environmentBindings: proceduralModelEnvironmentBindings || [] }`；字段缺失时归一化，不抛。
  - `groupBuiltinAssetsByCategory(items)`：按 `BUILTIN_CATEGORY_LABELS` 顺序输出 `[{ category, label, items: [...] }]`，供模板 `v-for`。
- Vue 新增状态（ref）：`myAssets`（数组）、`assetLibraryBusy`（bool）、`renamingAssetId`（string|null）、`confirmDeleteAssetId`（string|null）；不引入 window.prompt/confirm，重命名用行内 input + 确认/取消按钮，删除用两步按钮（首次点击写入 confirmDeleteAssetId，第二次真正调用）。
- Vue 新增处理函数：`loadMyAssets()`（catch 后 `myAssets=[]` + message「资产库暂不可用」，Review Focus #1）、`placeBuiltinAsset(item)`、`placeLibraryAsset(item)`、`archiveSelectedModel()`、`confirmRenameAsset(item)`、`requestDeleteAsset(item)/confirmDeleteAsset(item)`。

- [ ] **Step 1: 写失败测试——纯逻辑模块**

it：
- `canArchiveSandboxModel`：带非空 source 的模型 true；source 为 null（内置素材）、空串、undefined（旧快照遗留）三种均 false。
- `buildProceduralAssetPayload`：完整 userData 时字段一一对应；userData 全缺时返回归一化空数组与默认 manifest，不抛；`sourceCode` 严格等于原 source。
- `groupBuiltinAssetsByCategory(listBuiltinAssets())`：5 个分组、顺序等于 `BUILTIN_CATEGORY_LABELS` 插入顺序、每组 items 非空且总数 13。

- [ ] **Step 2: 跑测试确认 RED**

Run: `npx vitest run src/components/sandbox/assetLibraryUi.test.js`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 `assetLibraryUi.js` 并跑到 GREEN**

三个纯函数 + 从 Task 3 模块 re-export 需要的标签常量（Vue 只从两个 sandbox 组件模块导入）。
Run: 同 Step 2 命令。Expected: 全 PASS。

- [ ] **Step 4: Vue script 接线——状态、客户端、加载与三个放置/入库处理函数**

在 WorldSandboxMvp.vue：
- imports 增加三个新模块 + `createSceneAssetGeneratorRegistry`；模块级懒建 registry（首次放置内置素材时 `createSceneAssetGeneratorRegistry(THREE)`，结果存闭包变量）。
- 构造 asset client：`createProceduralAssetClient({ baseUrl: API_BASE, devUserId: DEV_USER_ID })`。
- `loadMyAssets()`：busy 包裹，try `listAssets()` 写 `myAssets.value`，catch 置空 + 中文 message；onMounted 引擎 init 成功后调用一次（失败不影响 restored 流程）。
- `placeBuiltinAsset({ category, objectType })`：try 工厂建模型 → `analyzeModelCollisionCompleteness`，非 complete 时写 message 阻断（自审 F）→ `engine.beginSandboxModelPlacement(model)` 返回 false 时沿用既有「无法启动模型选址」文案。
- `placeLibraryAsset(item)`：busy → `getAsset(item.assetId)` → `executeProceduralModel(record.sourceCode, { timeoutMs: 60000 })` → 给重建实例补 `userData.proceduralModelSource = record.sourceCode`、`assetName = record.name`、`proceduralModelConfig.objectType = record.objectType`（保证再编辑/再入库可用，规格 §4.4 末段）→ 同一道分析器门禁 → 选址；catch 写中文 message。
- `archiveSelectedModel()`：`if (!canArchiveSandboxModel(selected)) return`；`buildProceduralAssetPayload(selected, selected.name || '未命名模型')`；`client.saveAsset(payload)` 成功后 message「已存入资产库」+ `loadMyAssets()` 刷新；失败 message 透传。
- 重命名/删除两组函数操作 client 后都 `loadMyAssets()` 刷新并复位对应 ref；删除成功 message 明确「库存记录已删除，场景内已放置的模型不受影响」。

- [ ] **Step 5: Vue 模板改造——空白态资产库视图与选中态入库按钮**

- 在 1449 行起的通用 else 分支内，把现有三个 `managementMode === 'model'` section（AI 建模 1466、模型列表与基础模型 1478、快捷操作 1526）重组为：模型模式空白态先渲染两个新 section——「内置素材」（`groupBuiltinAssetsByCategory` 分组，每组可折叠用 details/summary，条目按钮文案为 label，点击 `placeBuiltinAsset`）与「我的模型」（每行名称 + 分类 + 重命名/删除按钮 + 点击主体 `placeLibraryAsset`；空数组显示「还没有存档模型，选中场景里的 AI 模型即可存入」；busy/错误文案位）；保留现有 AI 建模输入 section 作为创建入口；快捷操作 section 维持原样。
- 选中态模板（1411 分支）主操作行追加「存入资产库」按钮：`:disabled="!canArchiveSandboxModel(selected)"`，disabled 时 title「内置素材或旧版本地模型没有可入库的源码」，点击 `archiveSelectedModel`。
- 所有新文案中文；沿用现有 class（`world-mvp__list` / `world-mvp__tools` / `world-mvp__message`），不新增样式体系。

- [ ] **Step 6: 构建与前端全量回归**

Run: `npm run build`
Expected: vite build exit 0（证明 SFC 模板与 script 接线无编译错误；chunk 体积警告为既有 rapier 基线）。
Run: `npm test`
Expected: 全量 vitest 通过数 = 旧基线 + 本计划新增测试数；失败名单严格等于既有 9 个基线红测试（PhysicsRuntime 1 / InputController 5 / CharacterMotor 1 / PlayerCharacterRuntime 2），零新增。

- [ ] **Step 7: 提交（仅在用户授权后）**

```bash
git add src/components/sandbox/assetLibraryUi.js src/components/sandbox/assetLibraryUi.test.js src/components/WorldSandboxMvp.vue
git commit -m "feat(sandbox): wire built-in asset library and model archiving into MVP panel"
```

---

### Task 5: 全量回归与浏览器人工验收（无产品代码）

**Files:** 无新增；验收证据记入 `.superpowers/sdd/2026-11-12-sandbox-asset-library/progress.md`。

- [ ] **Step 1: 双端测试与构建终验**

Run: `npm test`（前端，基线 9 红外零新增）；`cd server && npm test`（全绿）；`npm run build` 与 `cd server && npm run build` 均 exit 0。逐条读数写入 ledger。

- [ ] **Step 2: 浏览器人工清单（规格 §5.3，需用户配合，dev 服务器 localhost:5174 + server:3001）**

1. 五类内置素材各放一个代表物件（tree/shrub/bench/bridge/flowerbed/basketball-hoop），玩家走动验证：树干/椅身/桥面立柱/花坛边框/篮球架支柱挡人，树冠/灌木花卉/亭顶/篮板/花坛内部不挡。
2. 素材落位后缩放/旋转/保存/刷新页面，恢复正常、碰撞仍在。
3. AI 模型点「存入资产库」→ 刷新页面 → 「我的模型」出现该条 → 取出重新放置 → 两个实例独立（删一个另一个不受影响）；停掉 server 再打开页面，沙盒正常初始化、资产区显示不可用提示而非白屏（Review Focus #1）。
4. 删除库存记录后，先前放置的实例仍在且可交互/可再编辑。
5. 库存取出的模型发起 AI 编辑（modify 链路）成功，证明 source 回填正确。
6. 任一选址过程按 Esc/取消，场景无残骸、无孤儿 ghost。
7. 旧快照模型（无 source）入库按钮禁用且有说明文案（Review Focus #2）。

- [ ] **Step 3: 终审与收尾**

按 executing-plans 流程对整个分支做一次 fresh-context whole-branch review（review 范围 = 本计划四个任务的提交）；Critical/Important 一轮修复 pass（每条先写 RED 测试再改），Minor 入 ledger 不擅自动手；终审干净后再由用户决定合并/推送时机。
