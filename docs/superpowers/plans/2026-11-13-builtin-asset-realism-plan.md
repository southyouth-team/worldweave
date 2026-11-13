# 内置素材真实感升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 6 类 16 件内置素材从直角方块升级为有曲面、圆角和近人尺度细节的真实比例程序化低模。

**Architecture:** 保持只读注册表和 campus 独立生成器不变，在适配层标注碰撞前插入视觉后处理。共享几何工具负责圆角与圆柱；旧素材和校园素材分别在专用模块中增加细节，所有产物仍走既有碰撞、灯光和序列化链路。

**Tech Stack:** Three.js、Vitest、既有 Rapier traversal probe、Vite。

**Spec:** `docs/superpowers/specs/2026-11-13-builtin-asset-realism-design.md`

## Global Constraints

- 覆盖现有 16 件；不改目录、尺寸配置、放置交互，不引外部模型或运行时网络依赖。
- `sceneAssetGeneratorRegistry.js` 只读；在 componentId/碰撞生成前调用 `refineBuiltinAssetVisuals(THREE, root, { category, objectType })`。
- 保留原 Mesh 名称、根 userData、灯光绑定目标、门洞、家具摆位；视觉圆柱不缩小原 box 碰撞规则。
- 校园三件默认实例合计三角面 <40,000；所有新增 Mesh 必须通过既有碰撞分类。
- 严格 TDD，先观察正确原因 RED；无浏览器实测不得声称视觉验收成功。
- 使用直连 `node node_modules/vitest/vitest.mjs run …` 与 `node node_modules/vite/bin/vite.js build`；不启动 dev server。
- 只允许既有 9 个基线红；不修改 `1.PY`，不把排除项带入提交。
- 每个提交步骤都需用户当次明确授权；无授权只改不提交、不推送。

## Review Focus

- 超薄盒体倒角后退化：Task 1 对 16 件所有几何断言有限、正尺寸包围盒。
- 新细节未分类：Task 1/2/3 跑真实适配器及 `analyzeModelCollisionCompleteness`，不能只测后处理函数。
- 替换原灯管/发光片导致绑定悬空：Task 3 跑现有灯光开关与 ObjectLoader 往返，并检查绑定目标仍可解析。
- 圆角与瓦垄导致三角面膨胀：Task 3 固定统计校园三件合计 <40,000。
- 外观变化破坏门洞/通道：Task 3 重跑尺寸包络、东大门净空和致远楼 Rapier 正反向路线。

---

### Task 1: 共享几何、适配层接入与植被

**Files:**
- Create: `src/three/world/proceduralGeometry.js`
- Create: `src/three/sandbox/builtinAssetRealism.js`
- Modify: `src/three/sandbox/builtinAssetAdapter.js`
- Test: `src/three/sandbox/builtinAssetRealism.test.js`

**Interfaces:**
- Produces: `bevelBoxMeshes(THREE, root, options?)`、`replaceBoxWithCylinder(THREE, mesh, options?)`、`createCylinderBetween(THREE, start, end, radius, material, name, radialSegments?)`、`refineBuiltinAssetVisuals(THREE, root, ref)`。
- Consumes: 原 registry/campus 生成器返回的未标注 Group；Task 2/3 在同一入口扩展细节。

- [ ] **Step 1: 写失败测试**

在 `builtinAssetRealism.test.js` 通过 `createBuiltinSandboxModel` 对 `BUILTIN_ASSET_CATALOG` 逐件断言：不存在 `geometry.type==='BoxGeometry'`；每个 Mesh 的局部包围盒三轴有限且大于 0。乔木另断言至少 5 个 `vegetation-crown-branch`、树干圆柱 radialSegments≥12、树冠顶点数大于原 Ico detail 1；灌木使用细分球面，花卉至少有花瓣 `flower-bloom-petal`。

- [ ] **Step 2: 观察 RED**

Run: `node node_modules/vitest/vitest.mjs run src/three/sandbox/builtinAssetRealism.test.js`
Expected: 因 BoxGeometry 仍存在、分支/花瓣不存在而失败，不是导入或断言拼写错误。

- [ ] **Step 3: 最小实现**

实现共享几何工具与后处理入口，在 adapter 标注前调用。通用阶段平滑材质并圆角剩余实体盒；植被阶段替换细分冠形、添加共享几何的分支与花瓣。新名称只使用 `crown`、`trunk` 或 noneAll 可覆盖的语义。

- [ ] **Step 4: GREEN 与回归**

Run: `node node_modules/vitest/vitest.mjs run src/three/sandbox/builtinAssetRealism.test.js src/three/sandbox/builtinAssetAdapter.test.js src/components/sandbox/assetLibraryUi.test.js`
Expected: 全部通过；若旧断言暴露真实回归，先定位根因，不放宽碰撞/尺寸断言。

- [ ] **Step 5: 提交（等待用户当次授权）**

拟提交本步骤四个实现/测试文件；未获授权不得执行。

### Task 2: 旧构筑物、设施、装饰与运动设施

**Files:**
- Modify: `src/three/sandbox/builtinAssetRealism.js`
- Modify: `src/three/world/proceduralGeometry.js`（仅确有共享算法需要时）
- Test: `src/three/sandbox/builtinAssetRealism.test.js`

**Interfaces:**
- Consumes: Task 1 的共享几何工具与已接入的后处理入口。
- Produces: spec §3.3 的固定细节名称：`pavilion-roof-slat`、`bench-seat-slat`、`bench-back-slat`、`lamp-pole-base`、`sign-board-frame`、`flowerbed-flower-stem`、`basketball-rim-net`。

- [ ] **Step 1: 写失败测试**

逐件断言：桥栏杆为圆柱；廊架至少 6 块屋顶板条；凉亭屋顶为非 Box 坡面；长椅 4 座板/3 背板；路灯有底座且灯罩为 Lathe/Cylinder；垃圾桶桶身为圆柱；指示牌有双立柱与边框；景观石细分且非对称；花坛有花茎；篮球架至少 8 条网绳且支撑为圆柱。继续断言尺寸、碰撞完整性和路灯绑定。

- [ ] **Step 2: 观察 RED**

Run: `node node_modules/vitest/vitest.mjs run src/three/sandbox/builtinAssetRealism.test.js`
Expected: 新细节断言失败，既有 Task 1 断言仍通过。

- [ ] **Step 3: 实现十件旧素材细节**

在原 Mesh 上换几何或添加已命名细节；长椅板条、花坛花茎和网绳共享几何。不得删除 `lamp-emitter`、`basketball-rim` 等既有测试/绑定目标。

- [ ] **Step 4: GREEN 与相关回归**

Run: `node node_modules/vitest/vitest.mjs run src/three/sandbox/ src/components/sandbox/ src/three/engine/worldStateRuntime.test.js`
Expected: 全部通过。

- [ ] **Step 5: 提交（等待用户当次授权）**

未获授权不得执行。

### Task 3: 三件校园地标曲面与立面细节

**Files:**
- Create: `src/three/sandbox/campusAssetRealism.js`
- Modify: `src/three/sandbox/builtinAssetRealism.js`
- Modify: `src/three/sandbox/builtinAssetAdapter.js`（仅新增 `goal-net`、`stand-seat` none 规则）
- Test: `src/three/sandbox/campusAssetRealism.test.js`

**Interfaces:**
- Consumes: Task 1 工具和后处理入口。
- Produces: `refineCampusAssetVisuals(THREE, root, { objectType })`；新增 `gate-roof-tile`、`gate-lintel-arch`、`gate-pier-base`、`sports-goal-net`、`sports-stand-seat`、`zhiyuan-window-glass-mullion` 等 spec 语义。

- [ ] **Step 1: 写失败测试**

东大门：三个屋顶为非 Box 曲面、有瓦垄和拱券，原门洞净空/包络不变。操场：圆管球门、至少 8 条网绳、看台座椅、非 Box 弧形顶棚、波浪旗面。致远楼：窗带 mullion、入口门框、带靠背椅子；真实 Rapier 正反向路线和 3 灯 9 绑定不回归。统计三件合计 index/position 三角数 <40,000，并做 toJSON→ObjectLoader 后绑定目标解析检查。

- [ ] **Step 2: 观察 RED**

Run: `node node_modules/vitest/vitest.mjs run src/three/sandbox/campusAssetRealism.test.js`
Expected: 曲面/细节断言失败；既有路线仍作为修复后的保护证据。

- [ ] **Step 3: 实现校园细节**

按原屋顶局部包围盒替换曲面，保留 Mesh 名称和位置；拱券、瓦垄、座椅、窗框共享几何。先保证尺寸与路线，再在三角预算内调密度。

- [ ] **Step 4: GREEN 与相关回归**

Run: `node node_modules/vitest/vitest.mjs run src/three/sandbox/ src/three/engine/createCampusEngine.test.js src/components/sandbox/`
Expected: 全部通过；校园三角总量实测 <40,000。

- [ ] **Step 5: 提交（等待用户当次授权）**

未获授权不得执行。

### Task 4: 全量终验与 fresh-context 终审

**Files:**
- Modify: 本计划 ledger（git-ignored SDD 工作区）
- Test: 全量前端测试与生产构建

- [ ] **Step 1: 全量测试并逐名审计红名单**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: 总通过数较 781 基线随新增测试增长，失败仍仅为 PlayerCharacterRuntime 2、CharacterMotor 1、InputController 5、PhysicsRuntime 1；任何新红都先修复。

- [ ] **Step 2: 构建与差异检查**

Run: `node node_modules/vite/bin/vite.js build`，再 `git diff --check`、确认 registry 无 diff。
Expected: build exit 0，仅既有 chunk 警告；无 whitespace 错误。

- [ ] **Step 3: fresh-context 全分支终审**

提供 spec、plan、本特性 diff、Review Focus 和 ledger rulings。Critical/Important 只做一轮 TDD 修复；Minor 记 deferred，不顺手扩改。

- [ ] **Step 4: 汇报**

列出实际几何变化、测试/构建证据、rulings、deferred minors 和浏览器视觉验收清单；明确未启动 dev server、未做视觉实测、未提交未推送（除非用户另行授权）。

- [ ] **Step 5: 提交（等待用户当次授权）**

未获授权不得执行，不删除仍需保留的 SDD ledger。
