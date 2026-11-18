# 南昌工学院校园地标内置素材实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 内置素材库新增「校园地标」分类，交付南工东大门、致远楼（一楼可进、3 间教室、灯光接总开关）、天工体育场三件真实比例素材。

**Architecture:** 新独立生成器模块（纯函数返回 THREE.Group，全部 Mesh 命名），适配层对 `campus` 类别绕开只读注册表直接调用，复用既有 componentId 标注/碰撞规则表/分析器门禁；致远楼额外产出 surfaces/traversability 清单段供通行验证，灯光接线复用路灯已验证的环境绑定契约。面板只加分类与 note 展示，放置/存档链路零改动。

**Tech Stack:** Three.js r180、vitest 2.1.9（直连 `node node_modules/vitest/vitest.mjs`）、@dimforge/rapier3d-compat（通行测试）、Vue 3 面板。

**Spec:** docs/superpowers/specs/2026-11-12-ncgxy-campus-landmarks-design.md (rev.2)

## Global Constraints

- `src/three/world/campus/sceneAssetGeneratorRegistry.js` 只读，任何任务不得修改。
- 测试/构建用直连二进制（D 盘 ENOSPC 绕行）：`node node_modules/vitest/vitest.mjs run …`、`node node_modules/vite/bin/vite.js build`。
- 禁止 window.prompt/confirm/alert；面向用户文案一律中文。
- 提交步骤全部待用户当次授权，无授权只改不提交；排除 `package-lock.json`、`server/package-lock.json`、`server/uploads/`、Trace 文件删除。
- 全量基线：9 个既有红测试（PlayerCharacterRuntime 2、CharacterMotor 1、InputController 5、PhysicsRuntime 1）为唯一允许失败。
- 尺寸均为米制估算值，代码注释标注「估算」；新三件包络容差 ±15%。

## Review Focus

1. 未扩地世界放置 186×100m 操场 → 用户须事先在卡片看到提示（Task 2 note 测试钉死）。
2. 无 2D canvas 的 Node/Worker 环境生成校门 → 显式降级无字黑匾而非抛错（Task 1 双路径测试）。
3. 玩家尝试穿入未开放两翼/二楼 → 实心阻挡（Task 3 反向通行用例钉死）。
4. 总开关已关闭时新放置致远楼 → 首次应用绑定即为关灯，而非先亮后关（Task 4 测试）。
5. 存档/刷新后教室灯光与碰撞存活 → toJSON→ObjectLoader 往返后绑定与清单仍生效（Task 4 往返测试）。

---

### Task 1: 适配层 campus 通道 + 南工东大门 + 面板分类/note

**Files:**
- Create: `src/three/world/campus/ncgxyLandmarkGenerators.js`
- Modify: `src/three/sandbox/builtinAssetAdapter.js`
- Modify: `src/components/sandbox/assetLibraryUi.js`（仅 note 透传如需）
- Modify: `src/components/WorldSandboxMvp.vue`（内置素材卡片 note 渲染）
- Test: `src/three/sandbox/builtinAssetAdapter.test.js`、`src/components/sandbox/assetLibraryUi.test.js`

**Interfaces:**
- Produces（后续任务共用）:
  - `createEastGate(THREE, dimensions, options?)` → Group；`options.document` 仅供测试注入假 2D 上下文。
  - 适配层 campus 分派表 `CAMPUS_GENERATORS = { 'east-gate': createEastGate, … }`（Task 2/3 往表里加行）。
  - 目录条目形状 `{ category, objectType, label, note? }`；`listBuiltinAssets()` 透传 `note`。
- Consumes: 既有 `createBuiltinSandboxModel(THREE, registry, {category, objectType})` 签名不变。

- [ ] **Step 1: 写失败测试**（adapter.test.js）
  - 目录用例更新：6 类 14 件，`BUILTIN_CATEGORY_LABELS` 末位为 `campus: '校园地标'`，`campus:east-gate` label「南工东大门」。
  - 新 describe「南工东大门」：①门墩 `gate-pier` required 且有 box 声明；屋顶 `gate-roof-*`、匾额 `gate-plaque`、门楣 `gate-lintel` 均 none；②包络 w[30.6,41.4] h[11.05,14.95] d[6.8,9.2]（加入 REALISTIC_ENVELOPES）；③拱门净空：以原点附近 |x|<3.5、0.2<y<5.5、|z|<4.5 构造 THREE.Box3，断言所有 required 碰撞目标部件的世界 AABB 均不与该盒相交；④无 PointLight、无环境绑定；⑤分析器 it.each 自动覆盖。
  - 匾额双路径：默认（Node 无 document）生成不抛错、匾额为无字黑匾（材质无 map）；注入 `options.document` 假实现（createElement 返回 `{ width, height, getContext: () => 假2D上下文, … }`）时 `createEastGate` 直接使用带 map 的 CanvasTexture（断言材质.map 存在且其 image 为假 canvas）。假 2D 上下文只需提供生成器实际调用的方法桩（fillRect/fillText/measureText 等），测试断言 fillText 被以「南昌工学院」调用。
- [ ] **Step 2: 跑 `node node_modules/vitest/vitest.mjs run src/three/sandbox/builtinAssetAdapter.test.js`** — Expected: 新用例 RED（campus 未支持抛「暂不支持」/createEastGate 未导出），旧用例除目录计数外全绿。
- [ ] **Step 3: 实现**
  - `ncgxyLandmarkGenerators.js`：`createEastGate`——4 门墩（中央拱门净宽 8m、净高 6m，两侧小门洞）、三重檐棕红瓦顶（中高两低对称）、黑底匾额（36×13×8m 总包络内）；所有 Mesh 命名（`gate-pier`/`gate-roof-center`/`gate-roof-wing`/`gate-plaque`/`gate-lintel`，重复部件 `-N` 尾号由既有 deriveSemantic 处理）；根 `userData.sceneAsset = { category:'campus', objectType:'east-gate' }`。匾额文字：`options.document ?? globalThis.document` 有 2D 能力时 CanvasTexture 写金色「南昌工学院」，否则纯色黑匾，显式守卫不抛错。
  - 适配层：`BUILTIN_CATEGORY_LABELS` 加 `campus:'校园地标'`；目录加 east-gate；`BUILTIN_ASSET_DIMENSIONS['campus:east-gate'] = {width:36,height:13,depth:8}`；`COLLISION_RULES['campus:east-gate'] = { required:['pier'], none:['roof','plaque','lintel'] }`；`category==='campus'` 时走 `CAMPUS_GENERATORS[objectType](THREE, dimensions)` 绕开 registry，其后标注/碰撞/manifest 流程完全复用。
- [ ] **Step 4: 跑同一命令** — Expected: 全绿（含分析器 14 件 complete）。
- [ ] **Step 5: UI note 与分组**
  - assetLibraryUi.test.js：分组用例更新为 6 组且 campus 组在末位；新增「note 透传」用例（listBuiltinAssets 含 note 的条目原样带出，无 note 条目为 undefined）。WorldSandboxMvp.vue 内置素材按钮下方加 `v-if="item.note"` 小字（此步 east-gate 尚无 note，只验证透传与模板不炸）。
  - 先跑 ui 测试看 RED/GREEN 再改模板；模板改动以 `node node_modules/vite/bin/vite.js build` exit 0 验证。
- [ ] **Step 6: 回归** — `node node_modules/vitest/vitest.mjs run src/three/sandbox/ src/three/world/ src/components/sandbox/` 全绿。
- [ ] **Step 7: Commit（待用户授权）** — `feat(mvp): add campus landmark channel and Nanchang east gate asset` + Co-Authored-By 行。

### Task 2: 天工体育场

**Files:**
- Modify: `src/three/world/campus/ncgxyLandmarkGenerators.js`
- Modify: `src/three/sandbox/builtinAssetAdapter.js`（分派表/目录/尺寸/规则各加一行）
- Test: `src/three/sandbox/builtinAssetAdapter.test.js`

**Interfaces:**
- Consumes: Task 1 的 `CAMPUS_GENERATORS` 分派表与 note 透传。
- Produces: `createSportsField(THREE, dimensions)` → Group；目录 note：「真实 400m 操场，占地约 186×100 米，需先扩地再放置」。

- [ ] **Step 1: 写失败测试**——新 describe「天工体育场」：①包络 w[158.1,213.9] h[10.2,13.8] d[85,115]（入 REALISTIC_ENVELOPES）；②跑道外沿：取 `sports-track` 部件世界 AABB，尺寸 ≈176×92（±2m），厚度 ≤0.2m；③球场 `sports-pitch` AABB 105×68（±0.5m）；④可行走区无阻挡：`sports-track`、`sports-lane-line`、`sports-pitch`、`sports-pitch-line`、`sports-flag`、`sports-stand-roof` 全 none；`sports-goalpost`、`sports-stand-step`、`sports-flagpole` required 且有 box；⑤无 PointLight 无绑定（既有护栏用例自动覆盖）；⑥目录 15 件且 sports-field 携带上述 note 原文。
- [ ] **Step 2: 跑 adapter 测试** — Expected: RED（createSportsField 未导出/目录缺条目）。
- [ ] **Step 3: 实现 `createSportsField`**——stadium 形跑道用 THREE.Shape（两直道+两 absarc 半圆）挖洞成环，8 条分道线为窄环带，红色塑胶贴地薄片（厚 0.05m）；内场 105×68 绿茵 + 白线 + 中圈 + 双球门（框柱 required）；一侧 8 排阶梯看台 + 立柱 + 顶棚 + 中央主席台；12m 旗杆 + 红旗（最高点=旗杆）。全部 Mesh 命名（`sports-track`/`sports-lane-line`/`sports-pitch`/`sports-pitch-line`/`sports-goalpost`/`sports-stand-step`/`sports-stand-roof`/`sports-flagpole`/`sports-flag`）。适配层规则 `{ required:['goalpost','stand-step','flagpole'], none:['track','lane-line','pitch','pitch-line','stand-roof','flag'] }`，尺寸 `{width:186,height:12,depth:100}`，note 按 Produces 原文。
- [ ] **Step 4: 跑 adapter 测试** — Expected: 全绿（分析器 15 件 complete）。
- [ ] **Step 5: 回归 + build** — sandbox/world/components 测试全绿；`node node_modules/vite/bin/vite.js build` exit 0。
- [ ] **Step 6: Commit（待授权）** — `feat(mvp): add Tiangong sports field builtin asset`。

### Task 3: 致远楼（外观 + 一楼教室 + 通行验证）

**Files:**
- Modify: `src/three/world/campus/ncgxyLandmarkGenerators.js`
- Modify: `src/three/sandbox/builtinAssetAdapter.js`
- Test: `src/three/sandbox/builtinAssetAdapter.test.js`（新增 describe 可用 `@dimforge/rapier3d-compat`，参照 modelTraversalTester.test.js 的 beforeAll RAPIER.init()）

**Interfaces:**
- Produces: `createZhiyuanBuilding(THREE, dimensions)` → Group；适配层新增 `buildZhiyuanSpatialExtras(taggedPartsByName)` → `{ surfaces, traversability }` 合并进 manifest `capabilities.spatial`；目录 note：「一楼可进入，含 3 间教室，灯光受人工灯光总开关控制」。
- 关键部件名（Task 4 依赖）：灯管 `zhiyuan-lamptube`；地板 `zhiyuan-floor`；路由锚点空 Group `zhiyuan-route-main`、`zhiyuan-route-classroom`。

- [ ] **Step 1: 写失败测试**——新 describe「致远楼」：
  - 包络 w[68,92] h[17.85,24.15] d[13.6,18.4]；目录 16 件 + note 原文。
  - 部件：`zhiyuan-wing`（红砖端翼）、`zhiyuan-colonnade`（柱廊）、`zhiyuan-desk`、`zhiyuan-chair`、`zhiyuan-podium` 均 required；`zhiyuan-glass-canopy`、`zhiyuan-blackboard`、`zhiyuan-window-glass`、`zhiyuan-lamptube`、`zhiyuan-floor` 均 none。每教室 12 桌 12 椅（全楼 36/36），讲台 3，黑板 3。
  - 正向通行（真实 RAPIER）：manifest 含 surfaces（地板 walkable）与两条 passages——主入口 `(0,0.1,10.5)→(0,0.1,2.2)`、教室 `(-4.5,0.1,2.2)→(-4.5,0.1,-2.5)`；`testModelTraversalRoutes(THREE, RAPIER, root, { maxDuration: 10, speed: 2 })` 两路由 `status:'passed'` 且 `certifiedWalkable === true`。
  - 反向通行（Review Focus #3）：第三条测试专用 passage（在测试内往 manifest 追加，不进产物）从未开放翼外侧穿向走廊 `(27,0.1,2.2)→(10,0.1,2.2)`，断言该路由 `status:'failed'`、`reason:'blocked-or-stuck'`，且此用例 `certifiedWalkable === false`。
- [ ] **Step 2: 跑 adapter 测试** — Expected: RED（createZhiyuanBuilding 未导出）。
- [ ] **Step 3: 实现 `createZhiyuanBuilding`**——80×16m、5 层 21m：一层开放段 x∈[-18,+18]（净高 3.6m），外墙按主入口 3m 宽/2.6m 高门洞与窗洞分块；走廊净宽 2.4m（z∈[+1,+3.4]），3 教室各 9×7m（z∈[-6,+1]，中心 x=-13.5/-4.5/+4.5，门洞 1.2m 朝走廊）；两翼一层 + 二至五层整体实心；红砖端翼、白色柱廊、深色窗带、玻璃顶中庭雨棚；地板顶面 y=0（室内外同标高）；每教室 3 排×4 列课桌椅 + 讲台 + 黑板 + 2 根 `zhiyuan-lamptube`（本任务不含 PointLight）；全部 Mesh 命名，路由锚点空 Group 命名如 Interfaces。**路由锚点不是 Mesh，适配层 traverse 不会标注它**：生成器直接为其赋固定 `userData.componentId`（`campus-zhiyuan-building-zhiyuan-route-main` / `…-classroom`）与 `collisionPolicy:'none'`（分析器遍历一切带 componentId 对象，漏标会报 unclassified）；`buildZhiyuanSpatialExtras` 的 passages targetPartId 用这两个固定 id。适配层规则 `{ required:['wing','colonnade','wall','partition','solid','upper','desk','chair','podium'], none:['glass-canopy','blackboard','window-glass','lamptube','floor','route','canopy'] }`（以实际语义名为准，双命中冲突时调整语义名而非放宽防御）；`buildZhiyuanSpatialExtras` 按部件名查 componentId 生成 surfaces（floor，shape mesh、supportsStanding/walkable true）与两条 passages（坐标同上，targetPartId 为路由锚点 id）。
- [ ] **Step 4: 跑 adapter 测试** — Expected: 全绿（分析器 16 件 complete；正/反向通行符合断言）。
- [ ] **Step 5: 回归** — sandbox/world/components 全绿；build exit 0。
- [ ] **Step 6: Commit（待授权）** — `feat(mvp): add Zhiyuan teaching building with enterable classrooms`。

### Task 4: 致远楼教室灯光接总开关 + 持久化往返

**Files:**
- Modify: `src/three/world/campus/ncgxyLandmarkGenerators.js`（加 PointLight）
- Modify: `src/three/sandbox/builtinAssetAdapter.js`（`attachZhiyuanEnvironmentLighting`）
- Test: `src/three/sandbox/builtinAssetAdapter.test.js`

**Interfaces:**
- Consumes: Task 3 的 `zhiyuan-lamptube` 部件与既有路灯接线契约（`lighting.artificial.enabled` / intensity / visible / defaultValue）。
- Produces: 每教室 1 个 PointLight（`zhiyuan-light`，共 3 个，标注 none）+ 9 条环境绑定（3 intensity + 6 visible）。

- [ ] **Step 1: 写失败测试**——①3 个 PointLight 均带 componentId、collisionPolicy 'none'、castShadow false，位置在教室内（y≈3.1，x 分别 ∈ 三教室区间）；②绑定结构：3 条 intensity（enabledValue>0、disabledValue 0、defaultValue true，target=各灯 id）+ 6 条 visible（target=各灯管 id）；③驱动真实 `applyEnvironmentBindings`：false → 全灯 intensity 0 且 6 灯管全隐藏；true → 恢复；④Review Focus #4：新构造模型**首次**即以 `{'lighting.artificial.enabled': false}` 应用 → 直接全灭（不依赖先亮后关）；⑤Review Focus #5：`root.toJSON()` → `new THREE.ObjectLoader().parse(...)` 往返后，绑定数组与 manifest colliders 保留，灯光为 PointLight，false 应用仍全灭；⑥既有「非路灯无灯无绑定」护栏例外清单更新为 lamp + zhiyuan-building（east-gate/sports-field 仍被断言无灯）。
- [ ] **Step 2: 跑 adapter 测试** — Expected: RED（无 PointLight/绑定）。
- [ ] **Step 3: 实现**——生成器每教室加 1 个 `new THREE.PointLight('#f4f8ff', 1.6, 9, 1.8)`（居中 y=3.1，castShadow=false，name `zhiyuan-light`，不打标签）；适配层 `attachZhiyuanEnvironmentLighting(THREE, root, { category, objectType, semanticSeq })` 仿路灯：为每灯按 `…-zhiyuan-light-N` 赋 componentId 与 none，产出 intensity 绑定（enabledValue 1.6）+ 每灯管 visible 绑定，defaultValue 全 true。
- [ ] **Step 4: 跑 adapter 测试** — Expected: 全绿。
- [ ] **Step 5: 全量终验** — `node node_modules/vitest/vitest.mjs run`：仅 9 基线红，逐个核对名单；`node node_modules/vite/bin/vite.js build` exit 0。
- [ ] **Step 6: Commit（待授权）** — `feat(mvp): wire classroom lights to artificial lighting master switch`。

### Task 5: 终验与终审

- [ ] **Step 1: 新鲜双端终验**——client 全量 + build；server 不受影响不重复（如涉及再跑）。
- [ ] **Step 2: 组装等价工作区审阅包**（无提交区间可用时沿用上次手工包方式），派 fresh-context 最 capable 模型审阅者，附 spec/plan/Review Focus 原文与 ledger Ruling 指针；按 Critical/Important 一轮修复（每个修复 RED→GREEN + 全量）、Minor 记 ledger。
- [ ] **Step 3: 人工浏览器清单（交用户实测，不代判视觉）**：
  1. 面板出现「校园地标」3 件，操场卡片显示扩地提示；
  2. 放置东大门：三重檐轮廓、匾额「南昌工学院」金字、中央拱门可走进穿过、门墩撞停；
  3. 扩地后放置操场：红色跑道/绿茵场可跑动、看台与旗杆撞停、比例与 1.7m 角色协调；
  4. 放置致远楼：红砖端翼/柱廊/玻璃中庭可辨；主入口走进走廊、进入教室；桌椅讲台挡人、黑板穿模不挡；
  5. 未开放两翼与二楼实心不可穿；
  6. 人工灯光总开关关→3 间教室灯灭灯管熄，开→恢复；关灯状态下新放置致远楼直接是灭的；
  7. 存档刷新后：三件外观/碰撞/灯光状态保持；
  8. 旧 13 件素材与既有功能无回归（抽查树/路灯/长椅放置）。
- [ ] **Step 4: ledger 收尾**——Ruling/minor(deferred) 全量汇总进最终消息；提交与推送均按用户当次授权。
