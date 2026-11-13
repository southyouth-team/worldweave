# 可拉扯常规道路素材设计（2026-11-13）

## 1. 意图与已确认范围

用户要在现有内置模型库中补充常规道路，并能“控制拉扯”。已确认第一批只有四种独立素材：

| objectType | 中文名称 | 默认长度 × 宽度 | 主要识别特征 |
|---|---|---:|---|
| `asphalt-road` | 柏油路 | 24 × 6m | 深灰沥青、双黄中心线、白色边线 |
| `concrete-road` | 水泥路 | 20 × 4m | 浅灰混凝土、横向伸缩缝、两侧收窄边 |
| `brick-walkway` | 砖石人行道 | 16 × 2.4m | 错缝砖块、砖色轻微变化、收边 |
| `stone-path` | 石板步道 | 12 × 2m | 大石板、规则接缝、轻微色差 |

四种都是直路。选中后拖动两端手柄，可改变长度和水平朝向。第一批不做弯道、坡道、宽度拖拽、自动交叉口、地形贴合、车辆或交通模拟。

沿用真实比例程序化低模，不下载模型，不引入运行时网络依赖。既有 16 件素材及其尺寸、碰撞、灯光、持久化接口不变。

## 2. 目录与使用体验

1. 新增内置分类 `road`，中文标签“常规道路”，四件素材加入现有 `BUILTIN_ASSET_CATALOG`；目录 UI 继续按分类自动分组，不新增四个硬编码按钮。
2. 用户从模型管理选择道路，沿用现有点击放置流程。道路默认按上表尺寸落地；整体水平移动、绕 Y 旋转、复制、删除和保存继续可用。
3. 选中道路后，模型管理面板显示“道路端点”按钮，调用 `engine.setSandboxTransformMode('road-endpoints')`。该模式只接受带有效 `proceduralRoad` 的已选中道路；进入后 detach 通用 TransformControls，显示两个编辑器手柄并锁定镜头 orbit 输入。
4. 手柄位于道路两个端的中心，由根参数与根变换计算。手柄和预览属于引擎编辑器层，不是模型子节点，不进入模型 JSON、碰撞清单、交互索引或静态合批。
5. 拖动手柄时捕获指针，另一个端点保持世界 XZ 坐标不动。指针通过现有 `getSandboxGroundPoint()` 的地面平面投影取得 XZ；射线与地面无交点时保留最后有效预览，不写入 NaN。
6. 拖动期间只显示一个编辑器专有的扁平路面代理和端点手柄：按道路类型使用基础色，显示中心、长度、水平朝向和可用/冲突状态。原正式道路暂时隐藏但保持原参数、原 Transform 和原合批不变。代理允许用 `scale` 改变显示长度；禁止结构拉伸的约束针对正式道路，不针对这个无细节的编辑代理。
7. 代理不调用 adapter、不登记 Rapier/碰撞/支撑面、不合批，也不在每次 `pointermove` 新建正式道路几何或材质。每次移动只更新已有代理的 position、quaternion、scale 和冲突颜色，并请求渲染。
8. 松开后，如果候选合法，按最终长度经真实 adapter 生成一次正式道路，再通过一次 `replaceSandboxModel()` 提交并恢复合批。成功后保持同一实例 id、选中状态、`worldState` 和环境覆盖，端点模式继续可用；UI 收到 committed 通知后调用现有 `saveSandbox()` 一次。
9. 冲突或超出有效地块时代理显示红色；松开不替换、不保存，保持端点编辑状态并显示原因。Escape 取消本次拖动并恢复原道路可见性；未拖动时 Escape 退出端点模式。切换选中、离开模式、替换/删除模型及引擎 dispose 前，都必须先清理未提交代理、手柄和指针捕获。
10. 保存并重新加载后，道路外观、长度和端点位置一致，且可再次进入端点编辑。

## 3. 参数、端点数学和变换契约

每件正式道路根节点保存 plain data：

```js
root.userData.proceduralRoad = {
  version: 1,
  objectType: 'asphalt-road' | 'concrete-road' | 'brick-walkway' | 'stone-path',
  length: Number,
  width: Number,
}
```

- 道路局部长轴为 X、宽度沿 Z，上表面水平；长度范围 **2–120m**，宽度为目录固定值。
- 根位置是有效两端点的中点，根 scale 固定为 `(1,1,1)`，根旋转只表达绕 Y 的水平朝向。端点编辑保留原根 Y 高度，不用地面射线把道路贴到起伏地形。
- 两个局部端点为 `(-length/2, 0, 0)` 与 `(length/2, 0, 0)`，通过根 `matrixWorld` 得到手柄位置；编辑器不得从合批 Mesh 反推端点。
- 设固定端为 F、地面投影指针为 P，`delta = P - F` 只取 XZ。原始距离非零时方向为 `normalize(delta)`；距离为零时沿用拖动前方向。有效长度 `L = clamp(delta.length(), 2, 120)`，有效移动端 `M = F + direction * L`。
- 新根中心为 `(F+M)/2`，朝向为 `rotation.y = atan2(-delta.z, delta.x)`，其余旋转分量为 0。达到最小/最大长度时，手柄停在有效移动端而不是继续跟到钳制范围外；不得产生负长度、NaN 或负几何。
- 正式道路不得用 `root.scale` 做结构拉伸。长度变化时按参数重建路面与重复细节，保证标线宽度、砖块/石板尺寸和接缝宽度不被拉伸。重复细节按真实间距增减，末段裁切且不越出端面。
- 道路在通用精细调整中禁用 scale；平移只显示 X/Z 轴，旋转只显示 Y 轴。引擎模式入口也拒绝道路 scale，避免 UI 绕过。端点模式每次进入都读取最新根 Transform，因此整体移动/旋转后的手柄仍正确。

### 提交时的 Transform 顺序

现有 `replaceSandboxModel()` 总是复制旧根 Transform，若先替换再改中心，会在旧中心短暂登记空间并重联合批。此次给它增加可选的 `metadata.transform = { position, rotation, scale }`：

- 未传时完整保留现有复制旧 Transform 的行为，其他模型不回归。
- 传入时，在 `parent.add(replacement)`、空间登记、环境绑定和 `batchStaticModel()` 之前就应用新 Transform。
- 道路提交只调用一次 replace，不再随后用第二次 transform 更新修补中心；旧根在替换完成后按现有所有权规则 dispose。
- 重新生成道路仍走 `createBuiltinSandboxModel()`，在其选项中增加仅供 road 使用的 `parameters.length`；目录默认尺寸不变，编辑长度只覆盖本次实例生成参数。

## 4. 独立生成器、几何与性能

- `sceneAssetGeneratorRegistry.js` 继续只读。新增独立 `createProceduralRoadModel(THREE, { objectType, length, width })`，由 `createBuiltinSandboxModel` 对 `category === 'road'` 直接分派，与 campus 独立生成器一样绕开通用 registry，但不绕过后处理、componentId、碰撞完整性和清单链路。
- 四种道路共用参数校验和重复分段工具，分别生成路面、标线或铺装。所有新增 Mesh 有稳定语义名称；adapter 对四种 road 使用 `noneAll`，不得出现未分类部件。
- 柏油路中心双黄线与边缘白线保持固定线宽，长度随路面增减；不得把短线整体拉成长线。
- 水泥路伸缩缝按 4m 标准间距布置并裁切末段；砖石人行道采用约 0.6 × 0.3m 错缝砖；石板步道采用约 1.2m 分段大板。
- 重复砖石按少量共享材质合并为少量标准 `BufferGeometry`，不能每块砖一个 Mesh/材质；色差只使用少量共享材质。单件 Mesh 数有界，不随长度线性增加。
- 单件 120m 道路不超过 **50,000 三角**；路面低厚度、边缘只做小尺度收口，不使用密集倒角。道路参数化生成不使用会无限增长的“按长度缓存几何”Map。
- 修改过顶点的自定义几何烘焙为 ObjectLoader 支持的标准 BufferGeometry。存档至少包含根 Transform、`proceduralRoad`、`builtinAssetRef` 和可恢复几何。

## 5. 碰撞、通行、合批与资源生命周期

- 第一版是既有校园地面上的道路表层，不承担桥梁或高架路功能。
- 正式道路所有部件 `collisionPolicy: 'none'`，`spatial.colliders` 为空；不声明道路自身为悬空支撑面，不新增会勾住角色的薄台阶或凸起碰撞。角色继续使用世界地面。
- 正式生成仍通过 `analyzeModelCollisionCompleteness`。Rapier 验收使用 test-only 世界地面、surface 和 passage 注入，证明角色能从地面进入、沿路行走并离开；这些测试辅助声明不进入生产模型。
- 已放置道路被静态合批后，端点编辑只读取根参数，不能假设原路面 Mesh 仍存在。拖动代理和手柄永不交给 `batchStaticModel`；提交的新根只合批一次，旧根和旧合批 Mesh 被移除，不留旧长度残影或旧射线目标。
- 代理、手柄使用编辑器独占的几何/材质，在提交、取消、切换选中、离开模式及 dispose 时释放；正式道路共享资源继续遵守缓存所有权，不能释放其他实例仍引用的几何。

## 6. 占地冲突、道路搭接与跨区块规则

- 初次放置继续走现有冲突检测。端点提交复用 `getSandboxPlacementConflict(candidateBounds, { model: current, id })`，候选 bounds 来自当前方向的轻量代理；检测时排除原道路自身。
- 第一版禁止道路与其他模型的有效 Box3 面积重叠，也禁止道路之间交叉或面积搭接；共面重叠不被允许，因此不依赖逐实例高度偏移或 polygonOffset 掩盖 z-fighting。仅端面相接、没有正面积重叠的道路可以连接。
- 这里明确沿用现有 **保守 Box3/AABB** 规则：斜向道路即使实际矩形未相交，只要包围盒正面积重叠也可能被判冲突。它是本批为避免自动交叉口和复杂道路布尔运算而接受的限制，不能宣称支持任意斜向邻近布置。
- 候选道路 Box3 覆盖的每个世界区块必须仍存在，且道路不能越出当前可建造世界边界。长路跨多个已存在区块可以提交；经过已回收空洞或世界外时标红并拒绝，不能保存一条之后被地面截断的路。
- 既有区块回收逻辑继续用道路世界 Box3 判定占用：道路 Box3 与待回收区块相交就阻止回收，不自动裁断或删除道路。保守包围盒可能多拦住一个角落区块，但优先保证不会回收道路实际经过的地面。
- 无效松开只保留预览和提示；原道路仍是当前存档中的正式版本。成功替换后重新计算选择框、射线目标与区块占用。

## 7. 持久化与 UI 通知

- 顶层本地快照继续使用 version 4 `{ id, name, object }`；`proceduralRoad` 随根 userData 和几何进入 `model.toJSON()`，无需升级顶层快照版本。
- ObjectLoader 恢复的是已生成几何和参数，不在读取存档时隐式重跑生成器。再次编辑时由 `builtinAssetRef + proceduralRoad + parameters.length` 经同一 adapter 重建。
- 新增轻量 `onSandboxRoadEditChange` 通知，至少区分 `dragging`、`committed`、`cancelled`、`blocked`，携带实例 id 和有效长度；`WorldSandboxMvp.vue` 只在 committed 后保存一次，其余状态用于提示，不在每个 pointermove 写 localStorage。
- 保存失败沿用现有 UI 错误提示，不回滚已经成功替换的道路；取消和冲突不得伪报已保存。
- 禁止 `window.prompt/confirm/alert`。

## 8. 验收测试

1. 目录新增且仅新增四种道路及一个“常规道路”分类，中文标签、默认尺寸和旧 16 件目录不回归；只读 registry 无 diff。
2. 四种道路经真实 adapter 生成，碰撞完整、componentId 唯一，所有道路部件均为 none，正式清单没有道路悬空支撑声明。
3. 对每种道路分别测试 2m、默认长度、非整数长度和 120m：包络正确，标线和铺装间距不随长度拉伸，末端细节不越界，Mesh 数有界且 120m 少于 50,000 三角。
4. 纯端点数学覆盖固定另一端、任意水平方向、零向量回退、2m/120m 钳制、取消恢复；中心、Y-only rotation、单位 scale 和有效移动端均正确，不产生 NaN。
5. 真实引擎交互覆盖进入模式、指针捕获、拖动时代理更新而原根/合批不变、松开只 replace 一次、committed 只保存一次、Escape 与冲突松开不修改正式模型；手柄/代理不进入 `serializeSandboxModel()`，退出和 dispose 无残留监听器或编辑器资源。
6. `replaceSandboxModel` 新 transform 选项在空间登记与合批前生效；未传选项的旧行为回归通过。成功替换保留实例 id、worldState、环境覆盖和选中状态，无旧长度合批残影。
7. 道路通用 scale 被拒绝，平移/旋转轴向限制有效；整体移动或旋转后重新计算出的端点正确。
8. 四种道路分别做 `toJSON → ObjectLoader` 往返：世界包络、根 Transform、`proceduralRoad` 和 Mesh 数一致，恢复后还能再次计算端点并编辑。
9. 冲突测试覆盖道路与其他模型、道路之间交叉/面积搭接、端面相接、斜向 AABB 保守拒绝、已回收地块和世界外候选；长路跨现存区块可提交，相交区块回收被阻止。
10. 真实 Rapier 角色沿四种道路从测试地面进入、通过并离开，结果为 passed；测试辅助地面/路线不进入生产存档。
11. 旧 16 件相关回归通过；全量测试除既有 9 个基线红外无新增失败；Vite 生产构建成功。
12. 没有浏览器实测前不得声称视觉或手感验收成功。

## 9. 实现者决定（未视作用户逐项要求）

- 默认尺寸、2–120m 限制、固定宽度、具体标线和砖石尺寸由实现者按校园比例选择。
- 第一版使用贴地 none 碰撞，优先保证走动不卡，不将道路当作可悬空搭建的结构件。
- 拖动时采用可伸缩的单一扁平代理，而不是每次 pointermove 重建正式几何；松手才生成细节、替换和合批。
- 第一版不允许道路交叉/面积搭接，并沿用保守 AABB 冲突规则；端面相接可用，自动交叉口留待后续独立需求。
- 新增 `road-endpoints` 模式、可选 replace transform 和道路编辑通知，不引入新的 UI/TransformControls 依赖或大型编辑器框架。
- 本次仍不自动启动 dev server，不自动提交或推送；等待用户当次明确授权。
