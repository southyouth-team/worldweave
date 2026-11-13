# Stretchable Road Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在内置素材库新增四种真实比例直路，并允许拖动两端在 2–120m 内改变长度和水平朝向。

**Architecture:** 独立道路生成器经现有 builtin adapter 完成碰撞标注和持久化；纯函数负责端点数学，独立 road editor 只维护轻量代理和手柄，pointerup 通过一次带新 Transform 的 `replaceSandboxModel` 生成正式道路并恢复合批。Vue 面板只增加模式入口和 committed 后保存接线。

**Tech Stack:** JavaScript、Three.js、Vue 3、Rapier、Vitest、Vite；不新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-13-stretchable-road-assets-design.md`

## Global Constraints

- 仅新增 `road:asphalt-road`、`road:concrete-road`、`road:brick-walkway`、`road:stone-path`；默认分别为 24×6、20×4、16×2.4、12×2m。
- 长度 2–120m、固定宽度、局部长轴 X；正式根 scale=(1,1,1)，rotation 只含 Y；不做弯道、坡道、宽度拖拽、自动交叉口或地形贴合。
- 所有正式道路部件均为 none，colliders 为空，不声明悬空支撑；世界地面承担通行。
- `sceneAssetGeneratorRegistry.js` 只读；禁止 `window.prompt/confirm/alert`；不引入网络模型或运行时网络依赖。
- pointermove 只更新编辑代理；pointerup 合法时只 replace/合批/保存一次；手柄和代理不进入模型 JSON。
- 禁止交叉和面积搭接，允许端面相接，沿用保守 AABB；道路跨已回收区块或世界外时拒绝提交。
- 单件 120m 少于 50,000 三角，Mesh 数不随长度线性增长；不得按任意长度建立无界模块级几何/材质缓存。
- 严格 TDD；直接使用 `node node_modules/vitest/vitest.mjs run …` 与 `node node_modules/vite/bin/vite.js build`，不用 npm/npx。
- 仅允许既有 9 个 PlayerCharacterRuntime/CharacterMotor/InputController/PhysicsRuntime 基线红；未做浏览器实测不得声称视觉/手感通过。
- 所有 commit 步骤等待用户当次明确授权；不自动 push、不启动 dev server；排除 package-lock×2、server/uploads/ 和 Trace 删除。

## Review Focus

- 拖拽中 `pointercancel` 或丢失 pointer capture：应恢复原道路、释放捕获和代理，不能卡在隐藏/锁定状态（Task 4 测试）。
- 相机射线与地面平行或指针无有效地面交点：保留最后有效预览，不产生 NaN 或误提交（Task 4 测试）。
- 损坏存档中的非有限/越界 `proceduralRoad`：端点模式拒绝进入，正式模型仍可查看和删除（Task 1、Task 4 测试）。
- committed 后 localStorage 保存失败：返回失败并显示既有存档错误，不回滚已替换道路；非 committed 绝不写存档（Task 5 测试）。
- 反复进入/退出、切换选中及引擎 dispose：不得累积 DOM 监听、手柄、代理或编辑器 GPU 资源（Task 4 测试）。

---

### Task 1: 道路参数校验与端点数学

**Files:**
- Create: `src/three/sandbox/roadEndpointMath.js`
- Test: `src/three/sandbox/roadEndpointMath.test.js`

**Interfaces:**
- Produces: `ROAD_LENGTH_LIMITS={min:2,max:120}`、`ROAD_OBJECT_TYPES`、`clampRoadLength(length)`、`isStretchableRoadModel(root)`、`getRoadEndpoints(root): [THREE.Vector3,THREE.Vector3]`、`solveRoadEndpointDrag({fixedEnd,pointer,fallbackDirection,rootY})`。

- [ ] **Step 1: 写失败测试**

覆盖：2/120m 边界与钳制、非有限输入抛错；四种 objectType 的有效根识别及损坏 version/length/width/ref 拒绝；根中心 `(10,0.04,-2)`、Y 旋转 `Math.PI/2`、长度 12 时端点由 matrixWorld 正确计算。对固定端 `(4,-3)`、指针 `(9,2)` 断言长度 `sqrt(50)`、中心 `(6.5,rootY,-0.5)`、移动端 `(9,rootY,2)`、`rotation.y=atan2(-2,5)`；零向量沿用 fallback 并取 2m，超长取 120m，所有输出有限且 scale 为单位值。

- [ ] **Step 2: 观察 RED**

Run: `node node_modules/vitest/vitest.mjs run src/three/sandbox/roadEndpointMath.test.js`
Expected: 模块不存在或导出缺失导致失败。

- [ ] **Step 3: 实现纯端点数学**

`solveRoadEndpointDrag` 返回 `{ length, direction, movingEnd, position, rotation:{x:0,y,z:0}, scale:{x:1,y:1,z:1} }`；只使用 XZ 计算方向，`rootY` 原样保留。`getRoadEndpoints` 对局部 `±length/2 X` 应用根 matrixWorld。

- [ ] **Step 4: GREEN**

Run: 同 Step 2。
Expected: 全部通过。

- [ ] **Step 5: 提交（等待用户当次授权）**

未获授权不执行；不得夹带排除文件。

### Task 2: 四种道路生成、adapter 接入与持久化/通行

**Files:**
- Create: `src/three/sandbox/proceduralRoadGenerator.js`
- Create: `src/three/sandbox/proceduralRoadGenerator.test.js`
- Modify: `src/three/sandbox/builtinAssetAdapter.js`
- Modify: `src/three/sandbox/builtinAssetAdapter.test.js`
- Modify: `src/three/sandbox/builtinAssetRealism.js`（road 不进入按长度圆角缓存）
- Modify: `src/components/sandbox/assetLibraryUi.test.js`（目录计数）

**Interfaces:**
- Consumes: Task 1 的长度钳制和 objectType 常量。
- Produces: `ROAD_DEFINITIONS`、`createProceduralRoadModel(THREE,{objectType,length,width})`；`createBuiltinSandboxModel(THREE,registry,{category,objectType,parameters:{length}})` 支持 road，road/campus 直发分支允许 registry=null。

- [ ] **Step 1: 写失败测试**

更新目录期望为 **7 类 20 件**，road 在 campus 后，旧 16 件键保持不变；未知 category/objectType 仍抛错。对四种道路在 2、默认、非整数、120m 下断言 `proceduralRoad`、X/Z 包络、有限坐标、固定标线/接缝/砖石尺寸、末端不越界、默认与 120m Mesh 数相同、120m 三角小于 50,000。真实 adapter 断言 componentId 唯一、全部 none、colliders=[]、无 surfaces，并通过 `analyzeModelCollisionCompleteness`。

为每种道路增加 `toJSON→ObjectLoader` 包络/Mesh 数/参数往返及再次求解端点测试；用 test-only 地面、surface 和 passage 注入跑真实 Rapier，从 `x=-length/2-1` 沿 X 到 `+length/2+1`，四种均 passed，测试辅助节点不进入原生产根。

- [ ] **Step 2: 观察 RED**

Run: `node node_modules/vitest/vitest.mjs run src/three/sandbox/proceduralRoadGenerator.test.js src/three/sandbox/builtinAssetAdapter.test.js src/components/sandbox/assetLibraryUi.test.js`
Expected: 道路目录/生成器缺失，目录旧计数断言按预期变化；不得靠跳过旧断言转绿。

- [ ] **Step 3: 实现生成器与 adapter**

每种根只拥有少量材质并在根内复用，不建模块级材质缓存。沥青双黄线/白边线固定宽度；水泥缝 4m；砖约 0.6×0.3m 错缝；石板约 1.2m。重复盒体按材质 merge 为标准 BufferGeometry，末段裁切，Mesh 数固定。road 跳过通用 `bevelBoxMeshes`，避免任意长度进入 roundedBoxCache；保留材料平滑与既有 16 件路径。

在目录加入固定尺寸 `{width:默认长度,depth:固定宽度}`，adapter 仅用 `parameters.length ?? dimensions.width` 覆盖长度；四条 road 规则均为 `noneAll`。

- [ ] **Step 4: GREEN 与相关回归**

Run: `node node_modules/vitest/vitest.mjs run src/three/sandbox/ src/components/sandbox/ src/three/engine/worldStateRuntime.test.js`
Expected: 全部通过，Rapier 四路线通过。

- [ ] **Step 5: 提交（等待用户当次授权）**

未获授权不执行。

### Task 3: replaceSandboxModel 提交变换

**Files:**
- Modify: `src/three/engine/createCampusEngine.js:1402-1445`
- Test: `src/three/engine/createCampusEngine.test.js`

**Interfaces:**
- Produces: `replaceSandboxModel(id,replacement,{ transform?:{position,rotation,scale}, ...metadata })`；未传 transform 完全保留旧行为。

- [ ] **Step 1: 写失败测试**

添加道路后以旧位置为对照，用不同长度 replacement 和新 `{position:(10,0.04,-4),rotation.y=Math.PI/2,scale:(1,1,1)}` 替换；在 `onSandboxModelsChange` 回调及返回后断言新根 matrixWorld/Transform 已是新值、id/worldState/environmentOverrides/选中状态保留且已合批。另测未传 transform 仍复制旧 Transform。

- [ ] **Step 2: 观察 RED**

Run: `node node_modules/vitest/vitest.mjs run src/three/engine/createCampusEngine.test.js`
Expected: 新 transform 被旧根 Transform 覆盖而失败。

- [ ] **Step 3: 实现可选 transform**

在 parent.add、空间登记、环境绑定和合批前，以 `metadata.transform ?? current` 应用 position/rotation/scale；不增加道路专用第二次 transform 修补。

- [ ] **Step 4: GREEN**

Run: 同 Step 2，再跑 `src/three/sandbox/staticModelBatcher.test.js`。
Expected: 全部通过。

- [ ] **Step 5: 提交（等待用户当次授权）**

未获授权不执行。

### Task 4: 道路端点编辑器与真实引擎交互

**Files:**
- Create: `src/three/engine/sandboxRoadEditor.js`
- Modify: `src/three/engine/createCampusEngine.js`
- Test: `src/three/engine/createCampusEngine.test.js`

**Interfaces:**
- Consumes: Task 1 数学、Task 2 road adapter（road 重建传 registry=null）、Task 3 replace transform。
- Produces: `createSandboxRoadEditor(THREE,deps)`，返回 `attach(model)`、`detach()`、`pointerDown/Move/Up(event)`、`cancelDrag()`、`handleEscape()`、`dispose()`、`isDragging()`；引擎支持 `setSandboxTransformMode('road-endpoints')` 和 `onSandboxRoadEditChange`。

- [ ] **Step 1: 扩展测试 harness 并写失败测试**

让 mock DOM 保存/分发监听、支持 pointer capture 和 stopImmediatePropagation；mock CameraRig 提供可投影地面的相机，mock TransformControls 记录 object/轴向。用相机投影手柄和地面目标得到 client 坐标，通过真实 DOM handler 驱动。

覆盖：仅有效道路可进入；两手柄来自根参数；拖动时另一端不动、原根和合批不变且仅代理更新；合法 pointerup 只 replace 一次并发一个 committed，新根长度/中心/朝向正确、无旧合批残影、序列化不含 `_sandboxRoadEditor`。Escape、blocked、pointercancel/lostpointercapture 恢复原根且不保存；无地面交点保持最后有效值。冲突覆盖其他模型、道路交叉/面积搭接、端面相接、斜向 AABB、世界外/已回收区块；跨现存区块长路成功且相交区块回收返回 occupied。道路 scale 拒绝，translate 隐藏 Y，rotate 仅显示 Y。反复模式切换、切换选中及 dispose 后监听/手柄/代理不残留。

- [ ] **Step 2: 观察 RED**

Run: `node node_modules/vitest/vitest.mjs run src/three/engine/createCampusEngine.test.js`
Expected: road-endpoints 不受支持、编辑器不存在；旧测试仍通过。

- [ ] **Step 3: 实现独立 editor 与引擎接线**

editor 根命名 `_sandboxRoadEditor`，直接挂 scene；手柄记录 endpointIndex，拖动根使用一个可缩放扁平代理。editor 独占几何/材质并幂等清理。只有手柄命中才捕获并拦截通用选择；move/up/cancel 只处理当前 drag。提交经真实 adapter 与一次 replace，blocked 不替换；通知 phase 为 dragging/committed/cancelled/blocked 并携带 id、length、active、reason。

引擎在通用 pointer listener 前接 road handler，Escape 优先取消道路拖拽；选择、模式、删除、dispose 清理 editor。候选冲突封装现有 `getSandboxPlacementConflict` 并显式检查世界边界；通用 gizmo 对道路禁用 scale、translate 仅 XZ、rotate 仅 Y，切回普通模型恢复三轴。

- [ ] **Step 4: GREEN 与相关回归**

Run: `node node_modules/vitest/vitest.mjs run src/three/engine/createCampusEngine.test.js src/three/sandbox/ src/components/sandbox/`
Expected: 全部通过；测试日志无未处理异常。

- [ ] **Step 5: 提交（等待用户当次授权）**

未获授权不执行。

### Task 5: 模型面板入口与 committed 持久化

**Files:**
- Modify: `src/components/sandbox/assetLibraryUi.js`
- Modify: `src/components/sandbox/assetLibraryUi.test.js`
- Modify: `src/components/WorldSandboxMvp.vue`

**Interfaces:**
- Consumes: Task 4 的模式和通知。
- Produces: `isStretchableRoadModel` re-export、`createRoadEditPersistence({save,sync})(payload)`；committed 才 sync+save 并返回布尔，其余 phase 返回 null。

- [ ] **Step 1: 写失败测试**

验证道路选择资格与损坏参数拒绝；dragging/blocked/cancelled 不调用 save/sync，单个 committed 各调用一次，保存失败返回 false且不移除正式模型。目录分组保持 7 类 20 件，road 在末位。

- [ ] **Step 2: 观察 RED**

Run: `node node_modules/vitest/vitest.mjs run src/components/sandbox/assetLibraryUi.test.js`
Expected: UI helper 导出缺失。

- [ ] **Step 3: 接线和实现**

选中道路显示“道路端点”；road-endpoints 面板显示拖动/Escape 提示和完成按钮；普通 scale 按钮不对道路显示。`setMode` 仅在引擎接受后更新 Vue 状态。`onSandboxRoadEditChange` 显示 blocked/cancelled/committed 提示，只由 persistence helper 在 committed 后调用现有 saveSandbox 一次，并沿用成功/失败 saveStatus；不得在每个 dragging 通知写 localStorage。

- [ ] **Step 4: GREEN 与构建检查**

Run: `node node_modules/vitest/vitest.mjs run src/components/sandbox/ src/three/engine/createCampusEngine.test.js && node node_modules/vite/bin/vite.js build`
Expected: 测试通过，build exit 0。

- [ ] **Step 5: 提交（等待用户当次授权）**

未获授权不执行。

### Task 6: 全量终验、fresh-context 终审与人工清单

**Files:**
- Modify: 本计划 SDD ledger（git ignored）
- Test: 全量前端测试与生产构建

- [ ] **Step 1: 全量验证**

Run: `node node_modules/vitest/vitest.mjs run`，随后 `node node_modules/vite/bin/vite.js build`、`git diff --check`、`git diff --exit-code -- src/three/world/campus/sceneAssetGeneratorRegistry.js`。
Expected: 除既有 9 个基线红外无新增失败；build exit 0；registry 无 diff。

- [ ] **Step 2: fresh-context 全分支终审**

提供 spec、plan、实际未提交 diff、Review Focus 和 ledger Rulings。按用户影响重新分级；Critical/Important 只做一轮 RED→GREEN 修复并跑相关及全量回归，Minor 记 deferred，不做第二轮 reviewer。

- [ ] **Step 3: 汇报与人工验收清单**

列出四种道路实际几何、拖拽/冲突/存档行为、测试与构建证据、全部 Rulings 和 deferred minors。人工项至少包括：四种道路近看铺装与标线、任意方向两端拖拽、最短/最长手感、斜向保守冲突提示、端点相接、跨区块与回收、取消/保存重载、批量道路帧率和长帧。明确未启动 dev server、未做视觉实测、未提交未推送（除非另行授权）。

- [ ] **Step 4: 提交（等待用户当次授权）**

未获授权不执行；ledger 保留到获得提交授权后。
