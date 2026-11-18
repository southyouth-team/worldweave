# 沙盒模型管理与内置素材库设计文档

日期：2026-11-12
状态：待审批（rev.2，已并入建造者自审结论）
分支：mvp

> 审查记录：原计划派 fresh-context 审查员，因模型配额 429 中断，改由作者按 builder-check 清单自审（弱于独立审查）。文档全部承重论断已对照真实代码逐条验证；自审发现的 6 处缺口已并入 rev.2，见 §4.2/§4.3/§5.2 标注。

## 1. 背景与意图

MVP 沙盒页面（WorldSandboxMvp）目前往场景里加东西只有一条路：调 AI 生成。用户希望：

1. 不依赖 AI 也能快速搭建——把项目已有的程序化内置素材接进 MVP 的"模型管理"面板；
2. AI 生成过的好模型能存档复用——形成一个个人资产库，新建模型或让 AI 再建模时可以拿库存当基础；
3. 资产库不能只活在浏览器本地（清缓存即丢失、无法跨设备），需要服务端持久化。

### 1.1 现状证据（调研结论）

- **内置素材已存在但与 MVP 断链**：`sceneAssetGeneratorRegistry.js` 提供 8 大类几十种参数化程序化素材（植被/构筑物/设施/装饰/运动/道路/水体/地形），自带 10 套风格调色板，但消费者只有两个独立路由页面（BuildingTemplateWorkshop、AssetTemplateLab，各有独立预览场景），MVP 沙盒无任何入口。
- **MVP 存档全在浏览器**：`WorldSandboxMvp.vue` 的 `saveSandbox()` 把整个场景序列化进 localStorage 单键 `world-sandbox-mvp:workspace:v1`，覆盖式保存，受浏览器约 5MB 配额限制（代码已有 QuotaExceededError 分支）。
- **服务端资产 API 已存在但格式不兼容**：`POST/GET /assets/visual-assets/objects` 只收 ObjectModelSpec 3.0 结构化组件树（300 组件、2MB 上限、`validateObjectModelSpecV3` 强校验）；AI 模型是 JS 源码模块，AI 再编辑链路（modify-procedural-object）必须吃源码，不能转成组件树格式。
- **AI 源码已随实例留存**：生成流程在 `group.userData.proceduralModelSource` 上保存了完整源码（WorldSandboxMvp.vue:608），`Object3D.toJSON()` 会将其带入 localStorage 快照。场景内任何 AI 实例都具备入库的全部数据，无需新增源码留存机制。
- **可复用的现成链路**：Worker 隔离构建 `executeProceduralModel()`、选址放置 `engine.beginSandboxModelPlacement()`（含占地预览、冲突检测、扩建入口）、碰撞质量门禁 `runModelCollisionQualityControl()`、静态合批 `batchStaticModel()`。
- **内置素材无碰撞**：生成器产物只挂 `userData.sceneAsset`，没有 componentId、collisionPolicy 和能力清单，直接进沙盒玩家会穿模。引擎原则是"可见 Mesh 不自动成为碰撞体"。

## 2. 目标与非目标

### 2.1 目标

1. MVP"模型管理"面板成为资产库入口，含两个分区：
   - **内置素材**：前端程序化生成，零服务端存储，即点即试；
   - **我的模型**：当前用户手动入库的 AI 模型，服务端持久化，跨设备可用。
2. 内置素材进场景即具备正确的碰撞表现（该挡的挡、装饰不挡），走通现有模型放置、变换、合批、保存全链路。
3. 场景内 AI 模型可一键"存入资产库"；资产库中的模型可反复取出放置为独立实例，也可作为 AI 再编辑的源码基础。
4. 资产库支持列出、重命名、删除；删除库存不影响已落位的场景实例。

### 2.2 非目标（本期不做）

- **不做缩略图渲染管线**：预览采用"即点即试"的场景内选址模式，不建离屏渲染器与截图存储。
- **不做沙盒级全局风格规定**：多风格体系暂缓；内置素材统一用 stylized 默认调色板，不暴露风格切换。
- **不做任何顶点/面数/尺寸预算限制**：项目开源，不以预算门槛拒绝模型。
- **不接道路/水体/地形三类场地级素材**：它们是大面积平面、放置语义与独立物件不同（贴地、多边形边界），本期资产库只接 5 类独立物件（植被/设施/构筑物/装饰/运动）。
- **不做资产公开审核流与跨用户分享**：库存按用户私有，不接 visual-assets 既有的审核入库流程。
- **不迁移 localStorage 场景快照**：场景快照机制保持现状；资产库是与之并存的模板库，不是替代品。
- **不做素材尺寸/参数面板**：素材以生成器默认尺寸进入选址，落位后用现有"精细调整→缩放"工具调整。

## 3. 关键决策（用户已拍板）

| # | 决策 | 选择 |
|---|------|------|
| D1 | 资产库存储位置 | 服务端持久化，复用现有存储骨架（用户隔离、manifest 索引、磁盘 JSON、校验和），新增程序化模型资产类型 |
| D2 | AI 模型入库时机 | 手动入库，场景模型操作区提供"存入资产库"按钮；生成即留在场景，不自动入库 |
| D3 | 素材预览方式 | 即点即试：点击素材进入现有选址模式，真实光照/尺寸/占地反馈，确认落地、Esc 取消 |
| D4 | 内置素材碰撞 | 本期补齐碰撞声明，一次做对，不接受纯视觉穿模 |
| D5 | 预算限制 | 不做 |
| D6 | 多风格 | 本期不做沙盒级风格规定，素材统一 stylized |

### 3.1 设计者裁决（my call，可被审批推翻）

- **C1 场地级三类素材延后**：道路/水体/地形不进本期资产库，理由见 2.2。
- **C2 碰撞适配放在独立适配层**：不改 `sceneAssetGeneratorRegistry` 本身（它还服务模板工坊页面），新建适配模块把生成器产物包装成带 componentId 与能力清单的沙盒模型。
- **C3 素材放置后可调缩放但不改生成参数**：避免在 MVP 面板暴露生成器的数十个 geometry 参数；缩放工具已能满足绝大多数尺寸诉求。
- **C4 库存记录格式与 Worker 限制对齐**：源码上限 120KB（与 `MAX_SOURCE_LENGTH` 一致），超限在前端入库前就拒绝并提示。
- **C5 资产库面板取代"未选中模型"时的空白态**：现在模型管理模式只有选中模型后才有内容；改造后未选中时显示资产库两个分区，选中时保持现有操作区并新增入库按钮。

## 4. 架构设计

### 4.1 总览

```
模型管理面板
├── 内置素材区（目录从 SCENE_ASSET_GENERATOR_CATALOG 派生，中文分类名）
│     点击 → 生成器生成 → 内置素材适配层（补 componentId/collisionPolicy/manifest）
│              → beginSandboxModelPlacement（现有选址流程）
└── 我的模型区（GET /assets/procedural-assets）
      点击 → 取源码 → executeProceduralModel（现有 Worker 链）
               → beginSandboxModelPlacement
场景模型操作区
└── 新增「存入资产库」按钮 → 读 userData.proceduralModelSource
      → POST /assets/procedural-assets
```

两条来源在选址流程之前汇合为同一种"待放置沙盒模型"，后续落地、变换、合批、localStorage 快照完全复用既有链路。

### 4.2 服务端：程序化模型资产

新增 controller（或在 VisualAssetsController 上并列新路由组），路径 `/assets/procedural-assets`，全部走 DevIdentityGuard：

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | `/assets/procedural-assets` | 入库：name、category、objectType、sourceCode、manifest、parameters、parts、environmentBindings |
| GET | `/assets/procedural-assets` | 列出当前用户全部记录（不含源码正文，只返回元数据，减小载荷） |
| GET | `/assets/procedural-assets/:id` | 取单条完整记录（含源码），放置时调用 |
| PUT | `/assets/procedural-assets/:id` | 重命名（唯一可编辑字段） |
| DELETE | `/assets/procedural-assets/:id` | 删除记录与磁盘文件 |

存储实现复用 AssetsService 的既有骨架：

- 文件：`<storageDir>/campus-visual-assets/procedural/<assetId>.json`，临时文件 + rename 原子写入；
- 索引：在现有 visual manifest 中新增 `proceduralAssets` 数组，记录 `{ assetId, name, category, objectType, format: 'procedural-module', filePath, checksumSha256, sizeBytes, createdBy, createdAt, updatedAt }`，沿用 `enqueueVisualManifestUpdate` 串行写；
- 读取校验 sha256，并强制 `createdBy === req.user.id`，路径穿越防护沿用现有 relativePath 检查。
- 【自审 A】存量 manifest 没有 `proceduralAssets` 字段：`readVisualManifest` 只校验 assets/bindings 两数组、不拒绝额外字段，默认骨架里也已有先例的 `objects` 数组；新代码在写路径上做 `manifest.proceduralAssets = Array.isArray(...) ? ... : []` 归一化，无需数据迁移。
- 【自审 D】新路由统一挂 DevIdentityGuard，与现有 visual-assets 路由一致；该守卫在 `NODE_ENV=production` 直接拒绝请求是既有约束，资产库继承同一限制，文档化而不另造认证。
- controller 注册进现有 `assets.module.ts`，不新建模块。

入库校验（新 service 方法，jest 覆盖）：

1. `sourceCode` 为非空字符串且 ≤ 120KB；
2. `name` 截断/兜底规则与现有资产一致（≤160 字符）；
3. `manifest` 为对象、带 version 字段；`parameters/parts/environmentBindings` 若非数组则归一化为空数组；
4. 整体 JSON ≤ 2MB（与现有结构化资产上限一致）；
5. **服务端不执行源码**：执行只发生在浏览器 Worker，服务端只做形状与大小校验。

### 4.3 前端：内置素材适配层

新建 `src/three/sandbox/builtinAssetAdapter.js`（纯函数模块，可单测）：

```
createBuiltinSandboxModel(THREE, registry, { category, objectType })
  → registry.generate(...) 得到原始 group
  → 遍历部件挂 userData.componentId（稳定 id：`<category>-<objectType>-<语义名>-<序号>`）
  → 按类别规则标注 collisionPolicy 并构造
    userData.proceduralModelCapabilityManifest（spatial.colliders，box 形状）
  → 根 userData 补 assetName、proceduralModelSource=null（内置素材无源码）、
    builtinAssetRef = { category, objectType }（快照恢复后仍可识别出身）
```

【自审 B，硬约束】适配产物必须通过现有 `analyzeModelCollisionCompleteness` 且 `status === 'complete'`——该分析器对每个带 componentId 的对象强制要求 collisionPolicy 显式为 required/none（漏标是 warning，而 Vue 门禁拒绝非 complete），required 部件必须绑定有效 box，componentId 重复是 error。因此：

- 【自审 E】直接在生成器产出的命名 Mesh 上挂 componentId（不重写层级、不包 wrapper group）；生成器里存在同名 Mesh（如 bridge-baluster 多个、road-marking 多个），id 一律带遍历序号保证唯一，碰撞盒 center/size 用该 Mesh 局部空间（生成器几何都以原点为中心、位移在 mesh.position 上，box 取几何尺寸、center 为 0 即可）；
- 每个被打标部件同时落 collisionPolicy，不允许出现未分类部件；不参与碰撞的装饰 Mesh 标 none 且不进 colliders；
- 适配模块单测直接调用真实 `analyzeModelCollisionCompleteness` 断言 5 类代表物件全部 complete，而不是只断言 manifest 形状。

碰撞规则（box 尺寸从生成器的 dimensions 输入与已知部件比例推导，常量集中在适配模块单一来源）：

| 类别 | 碰撞表现 |
|------|----------|
| 植被-乔木 | 树干 box 挡人；树冠不挡 |
| 植被-灌木/花卉 | 不挡（collisionPolicy: none） |
| 设施（长椅/路灯/垃圾桶/指示牌） | 主体 box 挡人 |
| 构筑物（桥/亭子/廊架） | 立柱与桥面按部件 box 挡人 |
| 装饰（景观石/花坛） | 景观石整体 box；花坛边框 box、内部可穿 |
| 运动（篮球架） | 支柱 box 挡人，篮板不挡 |

适配产物直接喂给现有 `beginSandboxModelPlacement`；落位后 `refreshSandboxModelSpatial` 按 manifest 注册碰撞，与 AI 模型同一条物理链路。静态合批按现有保护规则自动跳过带碰撞/清单引用的部件。

### 4.4 前端：面板与资产库客户端

- 新建 `src/components/sandbox/` 下的资产库 API 客户端模块（fetch 封装、错误消息中文化、DEB_USER_ID 头与现有调用一致），便于 vitest mock 单测。
- WorldSandboxMvp 面板改造：
  - 【自审 C】生成器目录里同一物件有多语言别名（tree/乔木/香樟树/树木/大树 指向同一 handler），面板直接平铺会出现 5 个重复条目。处置：面板只列规范英文 objectType，中文展示名由适配模块导出的单一标签映射提供，别名不进 UI；
  - 模型管理模式、未选中模型时：显示资产库视图——内置素材（可折叠分类，条目为中文名称按钮）+ 我的模型（列表，每条带名称、分类、删除/重命名操作）；
  - 【自审 F】内置素材点击后、进入选址前，Vue 层同样跑一次 `analyzeModelCollisionCompleteness` 并要求 complete，与 AI 模型的 `runModelCollisionQualityControl` 门禁对齐，防止适配层漏标时穿模上线；
  - 选中模型时：现有操作区不动，主操作行新增"存入资产库"按钮（仅 AI 模型可用，即 `proceduralModelSource` 存在时显示；内置素材按钮置灰并提示"内置素材无需入库"）；
  - 入库成功后 toast 提示并刷新"我的模型"列表；源码缺失（旧快照恢复的遗留模型）时按钮禁用并说明。
- AI 再编辑复用：现有编辑面板的 modify 链路本就以当前实例 source 为输入；库存模型取出放置后同样带 source，行为一致，无需新链路。

### 4.5 存档与实例的关系

- 场景快照（localStorage）继续保存完整 Object3D（含 manifest、source、builtinAssetRef），**实例不依赖库存存活**：删除任何库存记录，已落位实例照常加载与交互。
- "我的模型"是模板库：每次放置都经 Worker 重新构建出独立实例，实例之间无共享资源、互不影响（与现有 duplicate 语义一致）。

## 5. 测试策略（严格 TDD，先 RED 后 GREEN）

### 5.1 服务端（jest，新 spec 文件）

- 入库成功路径、字段归一化、120KB/2MB 上限、非字符串源码拒绝；
- 列表只返回元数据不含源码；单读校验和失败→404；越权读取他人资产→403；
- 重命名、删除后清单与文件一致；重复删除幂等；
- manifest 写失败时临时文件回滚（沿用现有模式验证）。

### 5.2 前端（vitest）

- `builtinAssetAdapter`：5 类素材各取代表物件，断言 componentId 稳定且唯一、collisionPolicy 与 manifest colliders 形状正确、花卉/灌木无碰撞、根 userData 字段齐全；**每个代表物件过真实 `analyzeModelCollisionCompleteness` 且 status==='complete'（零 warning 零 error）**；未覆盖类别显式报错的保护分支同样测试；
- 资产库客户端：请求路径/方法/载荷/错误中文化；
- 面板状态：未选中显示资产库、选中显示操作区、入库按钮启用条件（source 有无）、入库后列表刷新；目录别名去重后每个规范 objectType 恰好一个条目。

### 5.3 回归与人工验收

- 既有引擎/相机/沙盒测试全量回归，基线 9 个红测试之外零新增；
- `npm run build` 通过；
- 浏览器人工清单：① 五类内置素材各放一个，玩家碰撞符合上表；② 素材落位后缩放/旋转/保存/刷新恢复正常；③ AI 模型入库→刷新页面→从库存重新放置→实例独立；④ 删除库存后旧实例仍在；⑤ 库存模型发起 AI 编辑成功；⑥ Esc 取消选址不留残骸。

## 6. 风险与缓解

1. **localStorage 配额压力**：库存走服务端不增加快照体积，但实例 userData 带源码的现状不变（本就如此）。缓解：入库大源码前的 120KB 校验同时保护了快照体积；快照配额问题属于既有技术债，不在本期扩大。
2. **内置素材碰撞盒与视觉不齐**：程序化部件比例变化时 box 可能偏大/偏小。缓解：尺寸只从生成器输入与固定比例常量推导、集中可测；人工清单逐项验证；碰撞盒宁可略保守。
3. **服务端 manifest 并发写**：沿用既有 `enqueueVisualManifestUpdate` 串行队列，不新造机制。
4. **内置素材快照恢复后的身份**：恢复走 ObjectLoader 不经过适配层，builtinAssetRef 仅作标记；碰撞由恢复的 manifest 重建，与 AI 模型恢复路径一致，已被现有机制覆盖。
5. **生成器未来加类别**：适配层对未覆盖类别显式报错而非静默无碰撞，防止新素材穿模上线。
