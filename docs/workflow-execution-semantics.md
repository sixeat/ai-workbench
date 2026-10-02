# 工作流执行语义规格

结论：这份文档把「画布上的图怎么变成一次执行」的全部规则固定下来。它是**实现无关的规格**，不是某份代码的说明——任何前端（重写版、第三方、服务端）按这份规格实现，都会得到一致的执行结果。

**为什么需要它**：当前这些语义只存在于 `src/engine/` 的实现里。前端一旦重写，实现者会按自己的理解重新发明一遍，结果是"单节点能跑、整条流水线跑出不一样的东西"。这份文档的作用就是在实现被替换之前，把语义**从实现里剥离出来**。

**适用范围**：编辑期的客户端执行 + 未来的服务端权威执行，两者必须共用本规格。

## 5 分钟版

| 概念 | 一句话规则 |
| --- | --- |
| 端口数据 | 每个端口的载荷是**带 `type` 字段的信封对象**（`ImageAsset` / `ShotList` / `PromptValue`…），不是裸值 |
| 连线 | 边携带 `sourceKey` / `targetKey`；缺省时用哨兵值 `__main_output` / `__main_input` 触发推断 |
| 取值 | 上游 `outputs[sourceKey]`，取不到则按固定优先级回退 |
| 连多个 | 同一输入端口收到多条边时，按输入端口名决定**覆盖**还是**收集成数组** |
| 执行顺序 | Kahn 拓扑排序，**同层顺序不保证稳定** |
| 失败处理 | 任一节点失败即**中断整批**，不继续后续节点 |
| 复用 | 仅当 `status='completed'` 且**指纹完全一致**且未强制时才复用 |
| 指纹 | `stableStringify({type, config, inputs, context.modelContext})`，键名递归排序 |
| 校验 | 先校验输入、再校验配置，**都通过后才做指纹复用判断** |
| 异步任务 | 节点可返回带 `status` 的任务对象；处于 pending 状态时节点状态是 `running` 而非 `completed` |

---

## 一、值类型系统

### 1.1 端口类型（`PortType`）

端口本身有 11 种类型，用于**连线时的兼容性判断**：

`string` · `number` · `image` · `video` · `text` · `script` · `shotList` · `prompt` · `parameter` · `asset` · `any`

### 1.2 载荷信封（关键约定）

**端口上流动的不是裸字符串或数字，而是带 `type` 判别字段的对象。** 这是整个规格里最容易实现错的一点——如果新实现往端口上放裸值，下游所有的类型判断都会静默失效。

| 值类型 | 判别字段与必需结构 |
| --- | --- |
| `TextValue` | `{ type:'text', text:string }` |
| `PromptValue` | `{ type:'prompt', prompt:string, negativePrompt?:string, style?:string }` |
| `ParameterValue` | `{ type:'parameter', key:string, value:string\|number\|boolean, label?:string }` |
| `ImageAsset` | `{ type:'image', id:string, url:string, fileName:string, createdAt:string, ...可选 }` |
| `VideoAsset` | `{ type:'video', id:string, url:string, createdAt:string, status?:... }` |
| `ScriptValue` | `{ type:'script', text:string, title?:string, scenes?:string[] }` |
| `ShotList` | `{ type:'shotList', items:Shot[] }` |
| `Shot` | `{ id, index, title, description, visualPrompt?, negativePrompt?, camera?, duration?, image?, error? }` |

标量（`string` / `number` / `boolean`）和 `WorkflowValue[]` 数组也是合法载荷。

### 1.3 类型守卫（按 `type` 字段判别）

判别函数必须**同时检查 `type` 字段和该类型的关键字段**，不能只看 `type`：

- `isImageAsset` = `type === 'image'` **且** `typeof url === 'string'`
- `isVideoAsset` = `type === 'video'` **且** `typeof url === 'string'`
- `isScriptValue` = `type === 'script'` **且** `typeof text === 'string'`
- `isShotList` = `type === 'shotList'` **且** `Array.isArray(items)`
- `isPromptValue` = `type === 'prompt'` **且** `typeof prompt === 'string'`
- `isParameterValue` = `type === 'parameter'` **且** `typeof key === 'string'`

### 1.4 文本提取规则（`toText`）

任何值都能被降级成文本，**降级顺序必须一致**，否则提示词拼接结果会不同：

| 输入 | 输出 |
| --- | --- |
| `null` / `undefined` | `''` |
| `string` | 原样 |
| `number` / `boolean` | `String(value)` |
| `PromptValue` | `.prompt` |
| `ScriptValue` | `.text` |
| `ImageAsset` | `.url` |
| `ParameterValue` | `String(.value ?? '')` |
| `ShotList` | 逐镜拼接：`` `${index}. ${title}\n${visualPrompt ?? description}` ``，镜间用 `\n\n` |
| 数组 | 逐项降级、过滤空串、用 `\n\n` 连接 |
| 其他对象 | `JSON.stringify(value, null, 2)` |

### 1.5 参数读取规则（`getParameter`）

参数节点（`seedParam` / `countParam` 等）的值可能以三种形态到达，读取顺序固定：

1. `inputs[key]` 是 `ParameterValue` → 取 `.value`
2. `inputs[key]` 是**非空**的 `string` / `number` / `boolean` → 直接用它
3. 遍历 `inputs` 的所有值，找 `ParameterValue` 且 `.key === key` → 取 `.value`
4. 都没有 → 返回调用方传入的 `fallback`

---

## 二、边与连接

### 2.1 边携带的字段

```
{ id, source, target, sourceHandle?, targetHandle?, data?: { sourceKey?, targetKey? } }
```

`data.sourceKey` / `data.targetKey` 是**主数据源**，`sourceHandle` / `targetHandle` 是 UI 层句柄，两者都可能缺省。

### 2.2 哨兵值

```
MAIN_OUTPUT = '__main_output'
MAIN_INPUT  = '__main_input'
```

用户拖拽产生的连线通常只带 handle，此时 handle 的值就是哨兵，表示"用推断结果"。

### 2.3 连线时的目标输入推断（创建边时）

`inferTargetInputKey(sourceNode, targetNode, sourceKey, edges)` 按**固定优先级**决定接哪个输入端口：

| 优先级 | 条件 | 结果 |
| --- | --- | --- |
| 1 | 目标节点有 `connection.roundRobinInputs` | 在候选列表中取**第一个未被占用**的；全占用则取**最后一个** |
| 2 | 目标节点有 `connection.targetBySource[sourceKey]` | 用该映射值 |
| 3 | 目标节点有 `connection.imageInput` 且 `sourceKeys` 含 `sourceKey` | 已有边占用 `singleInput` 或 `multipleInput` → 用 `multipleInput`，否则用 `singleInput` |
| 4 | 按端口类型匹配（见下） | 取**第一个类型兼容**的输入端口 |
| 5 | 兜底 | `connection.defaultInput`，再兜底 `'content'` |

**"已被占用"的判定**：目标节点上已有边的 `targetKey || targetHandle` 集合。

### 2.4 端口类型兼容表

用于优先级 4，以及连线合法性校验：

| 源类型 | 允许连到的目标类型 |
| --- | --- |
| `any`（任一侧） | 任意（`any` 是双向通配） |
| 同类型 | 同类型 |
| `text` ↔ `string` | 互相兼容 |
| `prompt` | `text`、`any` |
| `script` | `text`、`any` |
| `shotList` | `any`、`asset` |
| `image` | `asset`、`any` |
| `parameter` | `any`、`parameter` |

**表以外的组合不兼容。**

### 2.5 执行时的取值规则

执行节点前，遍历所有 `edge.target === nodeId` 的边（**按 edges 数组顺序**）：

```
rawSourceKey = data.sourceKey || sourceHandle || MAIN_OUTPUT
sourceKey    = (rawSourceKey === MAIN_OUTPUT) ? 源节点主输出 : rawSourceKey
targetKey    = data.targetKey || targetHandle || MAIN_INPUT
value        = 源节点.outputs[sourceKey] ?? 源节点主输出（回退，见 2.6）
inputKey     = (targetKey === MAIN_INPUT) ? 推断目标输入(2.3) : targetKey
```

### 2.6 主输出回退链

当 `outputs[sourceKey]` 取不到时，按以下**固定顺序**找第一个非 `undefined` 且非 `null` 的键；全都没有则返回 `outputs` 的第一个值：

`negativePrompt` → `style` → `size` → `quality` → `seed` → `count` → `strength` → `shotParams` → `shotList` → `image` → `images` → `prompt` → `script` → `text` → `video` → `task` → `merged` → `url` → `content`

**主输出的定义**：节点 `connection.primaryOutput`，否则 `outputs[0].id`，否则 `'content'`。

### 2.7 多条边进入同一输入端口

**行为由输入端口名决定**，不是由值决定：

| 输入端口名 | 行为 |
| --- | --- |
| `prompt` | **收集成数组** |
| `image`、`images`、`referenceImage`、`referenceImages` | **收集成数组** |
| 值本身是 `ImageAsset` | **收集成数组** |
| 值是数组且含 `ImageAsset` | **收集成数组** |
| 其他 | **后者覆盖前者**（第一条保留，后续同名的被丢弃） |

> 注意这条的实现细节：首条边直接赋值；已存在时若当前值已是数组则追加；否则判断是否该收集——**该收集则变成 `[旧值, 新值]`，不该收集则新值直接覆盖**。

---

## 三、节点类型全表

共 22 种。`hidden` 表示**仅用于兼容旧工作流**，新建时不应出现在节点面板里。

### 3.1 输入节点（无输入端口）

| 类型 | 输出端口 | 配置字段（默认值） |
| --- | --- | --- |
| `textInput` | `text`(text) | `content`(textarea, `""`) |
| `imageInput` | `image`(image), `url`(string) | `url`(text, `""`), `prompt`(textarea, `""`) |
| `multiImageInput` **hidden** | `images`(asset) | `urls`(textarea, 每行一个 URL) |

### 3.2 参数节点（无输入端口，输出 `parameter` 信封）

| 类型 | 输出端口 | 配置字段（默认值） |
| --- | --- | --- |
| `promptParam` | `prompt`(prompt) | `prompt`(textarea, `""`) |
| `negativePromptParam` | `negativePrompt`(parameter) | `negativePrompt`(textarea, `""`) |
| `styleParam` | `style`(parameter) | `style`(select, `cinematic`) |
| `sizeParam` | `size`(parameter) | `size`(select, `1024x1024`) |
| `qualityParam` | `quality`(parameter) | `quality`(select, `auto`) |
| `seedParam` | `seed`(parameter) | `seed`(number, `0`) |
| `countParam` | `count`(parameter) | `count`(number, `1`) |
| `referenceStrengthParam` | `strength`(parameter) | `strength`(number, `0.65`) |
| `shotParam` | `shotParams`(parameter) | `camera`(text, `medium shot, slow dolly in`), `lighting`(text, `soft cinematic lighting`), `character`(text, `""`) |

> **参数节点是"覆盖"语义**：连线后覆盖生成节点自身的同名配置。`promptParam` 的描述明确写了"连线后会覆盖生成节点内部 Prompt"。

### 3.3 文本类节点

| 类型 | 输入端口 | 输出端口 | connection 规则 |
| --- | --- | --- | --- |
| `textModel` | `prompt`(text,**必填**), `system`(text) | `text`(text), `reasoning`(text) | `defaultInput: prompt` |
| `script` | `prompt`(text,**必填**), `outline`(text) | `script`(script), `text`(text) | `defaultInput: prompt` |
| `shotSplit` | `script`(any,**必填**) | `shotList`(shotList), `text`(text) | `defaultInput: script` |
| `promptOptimize` | `content`(any,**必填**), `style`(parameter), `shotParams`(parameter) | `prompt`(prompt), `shotList`(shotList), `text`(text) | `defaultInput: content`；`targetBySource: {style→style, shotParams→shotParams}` |

配置字段：

- `textModel`：`instanceId`(select) · `model`(select, `gpt-4o`) · `temperature`(number, **必填**, `0.7`) · `maxTokens`(number, **必填**, `2000`)
- `script`：`modelSource`(select, `inherit`) · `instanceId` · `model`(`gpt-4o`) · `scenes`(number, `5`) · `characters`(number, `3`) · `style`(text, `电影感`)
- `shotSplit`：`modelSource`(`inherit`) · `instanceId` · `model`(`gpt-4o`) · `count`(number, `5`) · `defaultDuration`(number, `4`) · `temperature`(`0.5`) · `maxTokens`(`2500`)
- `promptOptimize`：`modelSource`(`inherit`) · `instanceId` · `model`(`gpt-4o`) · `prefix`(textarea, `high quality, detailed, cinematic composition`) · `negativePrompt`(textarea, `low quality, blurry, distorted`) · `temperature`(`0.6`) · `maxTokens`(`2500`)

`modelSource` 的 5 个取值：`inherit`（继承上游）/ `globalDefault` / `platform` / `manual` / `localOnly`。

### 3.4 图片节点

**`imageGen` — 图片生成**（统一支持文生图 / 图生图 / 多参考图 / 分镜批量生图）

- 输入：`prompt`(any,**必填**) · `referenceImage`(image) · `referenceImages`(asset) · `negativePrompt` · `style` · `size` · `quality` · `seed` · `count` · `strength`（后 7 个均为 `parameter`）
- 输出：`image`(image) · `images`(asset) · `shotList`(shotList) · `url`(string)
- connection：`defaultInput: prompt`；`targetBySource: {negativePrompt→negativePrompt, style→style, size→size, quality→quality, seed→seed, count→count, strength→strength, images→referenceImages}`；`imageInput: {sourceKeys:['image'], singleInput:'referenceImage', multipleInput:'referenceImages'}`
- 配置：`instanceId`(**必填**) · `model`(**必填**, `gpt-image-1`) · `prompt` · `negativePrompt` · `style`(`none`) · `size`(`1024x1024`) · `quality`(`auto`) · `n`(number,`1`) · `seed`(number,`0`) · `strength`(number,`0.65`) · `promptExtend`(bool,`false`) · `enableSequential`(bool,`false`) · `thinkingMode`(bool,`false`) · `watermark`(bool,`false`) · `responseFormat`(`b64_json`)

**`imageToImage` — 图生图**（**hidden 别名节点**）

- 输入：`image`(image,**必填**) · `prompt`(any) · `strength`(parameter)
- 输出：`image`, `url`
- **语义：不是独立实现，而是委托给 `imageGen`。** 具体做法：
  1. 取参考图（`inputs.image` 或 `config.imageUrl`），取不到直接返回 `{image:null, url:'', error:'图生图需要参考图片'}`
  2. 拼接提示词：`prompt` + 换行 + `` `Use the reference image as visual guidance. Reference strength: ${strength}.` ``
  3. 以 `n: 1`、`referenceImage` 注入后调用 `imageGen`

### 3.5 视频节点

**`videoGen` — 视频生成**（统一支持文生 / 图生 / 多图生 / 分镜生视频）

- 输入：`prompt`(any) · `image`(image) · `images`(any) · `duration`(parameter) · `style`(parameter)
- 输出：`video`(video) · `task`(asset) · `text`(text)
- connection：`defaultInput: prompt`；`targetBySource: {images→images, shotList→images, duration→duration, style→style}`；`imageInput: {sourceKeys:['image'], singleInput:'image', multipleInput:'images'}`
- 配置：`instanceId`(**必填**) · `model`(**必填**, `doubao-seedance-2-0-mini-260615`) · `mode`(select, `auto`) · `prompt` · `duration`(number,`5`) · `aspectRatio`(`16:9`) · `resolution`(`720P`) · `motion`(text, `slow cinematic camera movement`) · `referenceVideoUrl`(text) · `referenceAudioUrl`(text) · `generateAudio`(bool,`false`) · `promptExtend`(bool,**`true`**) · `seed`(number,`0`) · `negativePrompt` · `watermark`(bool,`false`)
- `mode` 取值：`auto` / `text-to-video` / `image-to-video` / `images-to-video` / `shotlist-to-video`

**`multiImageVideo` — 多图生视频**（**hidden 别名节点**）

- 输入：`images`(any,**必填**) · `prompt`(text)
- 输出：`video`, `task`
- **语义：委托给 `videoGen`**，并强制 `mode = config.mode || 'images-to-video'`；输入归一化为 `inputs.images ?? inputs.shotList ?? inputs.image`

### 3.6 输出与工具节点

| 类型 | 输入 | 输出 | connection | 配置 |
| --- | --- | --- | --- | --- |
| `preview` | `content`(any,**必填**) | `content`(any) | `defaultInput: content` | `showRaw`(bool,`false`) |
| `merge` | `a`(any), `b`(any) | `merged`(text) | `defaultInput: a`；`roundRobinInputs: ['a','b']` | `separator`(text,`\n\n`), `prefix`(text,`""`), `suffix`(text,`""`) |

`merge` 的输出为：`` `${prefix}${toText(a)}${separator}${toText(b)}${suffix}` ``

---

## 四、执行引擎

### 4.1 执行入口的四种范围

| 入口 | 参与节点 | 默认是否强制 |
| --- | --- | --- |
| 运行全部 | 所有节点 | 否 |
| 运行单个节点 | 该节点 | **是**（`force: true`） |
| 运行到此节点 | 该节点 **+ 全部递归上游** | 否 |
| 运行选区 | 选中节点 **+ 各自全部递归上游** | 否 |

### 4.2 执行顺序

1. 从全图取出参与节点，**只保留两端都在参与集内的边**
2. 对参与子图做 Kahn 拓扑排序（不断取出入度为 0 的节点）
3. **若排序结果长度 ≠ 参与节点数 → 判定存在循环依赖，报错「工作流中存在循环依赖，无法执行。」并整体中止**
4. 按序执行；每步前上报 `progress = round(i / 总数 * 100)`
5. 全部完成后上报 `progress = 100` 与 `complete`

> **同层节点的执行顺序不保证稳定**：Kahn 实现用 `queue.shift()` 且入队顺序取决于 `nodes` 数组顺序。依赖"同层按画布顺序执行"的实现会与当前行为不一致。

### 4.3 失败处理：中断整批

**任一节点执行失败（`ok === false`）即跳出循环，后续节点不再执行**，但已完成的节点结果保留。

失败的两个来源：
- 输入校验不通过
- 配置校验不通过
- 执行器返回的 `outputs.error` 为真值

### 4.4 单个节点的执行步骤（顺序不可调换）

```
1. 取值 inputs（按 §2.5）
2. 构造 context（modelContext 见 §4.7、upstreamTaskIds）
3. 输入校验 validateNodeInputs  → 失败：status='error', outputs={error}，结束
4. 配置校验 validateNodeConfig  → 失败：status='error', outputs={error}，结束
5. 计算指纹 fingerprint
6. 若 !force && status==='completed' && 已存指纹 === fingerprint
   → 复用：不执行、不改数据、只发一条「复用已完成节点」日志，结束
7. 发出 status='running' 补丁 + 「开始执行节点」日志
8. 调用执行器，计时
9. 判定结果状态（见 §4.6）
10. 发出最终补丁（status / inputs / outputs / error / executionTime / executionFingerprint / lastRun）
```

**第 3、4 步在第 6 步之前**——这意味着**即使节点可以被复用，校验不通过仍会报错**。复制这个顺序很重要。

### 4.5 执行指纹与复用

指纹的构成（`stableStringify` 对键名**递归排序**，因此与属性书写顺序无关）：

```
{
  type:    节点类型,
  config:  节点完整配置,
  inputs:  本次实际输入,
  context: { modelContext: { instanceId, apiKeyModelId, platformModelId, model, sourceNodeId } | null }
}
```

**指纹不包含**：节点 id、位置、label、上游节点的其他字段、`upstreamTaskIds`。

**复用的三个必要条件**（缺一不可）：
1. `options.force` 为假
2. `node.data.status === 'completed'`
3. `node.data.executionFingerprint === 本次算出的 fingerprint`

**复用的效果**：不调用执行器、不产生新任务、不扣费，节点数据完全不变。

**注意副作用**：指纹里的 `inputs` 是**上游当前输出**。上游产出变了（例如换了种子重新生图），下游指纹自动变化，从而自动重跑——这是"改一个参数只重跑受影响的下游"的实现机制。

### 4.6 执行结果状态判定

```
hasError              = Boolean(outputs.error)
hasPendingOutputTask  = !hasError && 输出中递归存在 pending 状态的任务对象
runStatus = hasError ? 'error' : hasPendingOutputTask ? 'running' : 'completed'
```

**`pending` 任务状态集合**（大小写不敏感）：

`queued` · `submitted` · `waiting_upstream` · `processing` · `running`

**任务对象的识别规则**（递归遍历输出寻找）：
- 必须有 `typeof id === 'string'`
- 且满足以下**任一**：有 `kind` / `nodeType` / `input` / `output` / `upstream` 字段，或 `type === 'videoTask'`，或 `status ∈ pending ∪ {succeeded, failed, cancelled}`
- **排除**：`type` 为 `image` / `video` / `asset` 的对象（那是产物，不是任务）

> 这条规则决定了视频节点提交后的节点状态是 `running` 而不是 `completed`，前端据此显示"等待上游完成"并继续轮询。

### 4.7 模型上下文传播（`modelContext`）

这是**一条独立的旁路传播链**，与端口数据流平行：

1. 文本类节点（`textModel` / `script` / `shotSplit` / `promptOptimize`）执行后，输出里带 `modelContext`（含 `instanceId` / `apiKeyModelId` / `platformModelId` / `model` / `sourceNodeId` / `sourceNodeType` / `sourceNodeLabel`）
2. 下游执行时，`getUpstreamModelContext` **按边顺序找第一个**带有效 `modelContext` 的直接上游
3. 该上下文进入 `ExecutionContext.modelContext`，供 `modelSource: 'inherit'` 使用
4. **它同时进入执行指纹** → 上游换模型会让下游自动重跑

**`modelSourceUsed`**：文本类节点的输出里带此字段，记录本次实际用了哪个来源（`inherit` / `platform` / `manual` / …），用于诊断。它**不进入指纹**。

### 4.8 未被端口声明但实际存在的输出字段

以下字段不在节点注册表的 `outputs` 里，但执行器会返回，**下游或引擎确实会消费**。新实现必须一并产出，否则会出现难查的问题：

| 节点 | 额外字段 | 谁消费 |
| --- | --- | --- |
| `textModel` / `script` / `shotSplit` / `promptOptimize` | `task` | 任务历史、产物归集 |
| 同上 | `modelContext` | **引擎**（§4.7），影响下游模型继承与指纹 |
| 同上 | `modelSourceUsed` | 诊断展示 |
| `shotSplit` / `promptOptimize` | `rawText` | 模型返回 JSON 解析失败时展示原文 |
| `shotSplit` / `promptOptimize` | `warning` | 解析失败兜底提示 |
| `shotSplit` / `promptOptimize` | `mode` | 标记 `json` / `fallback` 路径 |
| `imageGen` | `task` / `tasks` / `text` | 任务历史、多任务批量 |
| `videoGen` | `error`（失败分支） | 节点错误展示 |

---

## 五、校验规格

### 5.1 输入校验（`validateNodeInputs`）

- 取节点 schema；**无 schema 视为通过**
- 只校验**实际存在的输入键**，缺失的必填输入**不在此处报错**
- 某键不在 schema 的 `inputs` 里 → 跳过（不报错）
- 值类型不匹配 → 报错：`` `输入 ${label}(${key}) 需要 ${type} 类型` ``

**值 → 端口类型的匹配规则**（注意这里比连线兼容表更宽松）：

| 端口类型 | 接受的值 |
| --- | --- |
| `any` 或值为 `null`/`undefined` | 任意 |
| `string` | 字符串，或任何"文本类"值 |
| `number` | 数字，或能 `Number()` 转换的非 NaN 值 |
| `text` | 文本类值 |
| `prompt` | `PromptValue` 或文本类值 |
| `script` | `ScriptValue` 或文本类值 |
| `shotList` | **仅** `ShotList` |
| `image` | `ImageAsset` 或非空字符串 |
| `video` | `VideoAsset` 或非空字符串 |
| `parameter` | `ParameterValue` 或标量 |
| `asset` | `ImageAsset` / `VideoAsset` / `ShotList` / 字符串 |

"文本类"= `string` / `number` / `boolean` / `PromptValue` / `ScriptValue` / `ShotList`。
数组：**逐项校验**，且当目标类型是 `asset` 时数组直接被接受。

### 5.2 配置校验（`validateNodeConfig`）

- 空值（`undefined` / `null` / `''`）**替换为 `defaultValue`** 后再校验
- `instanceId` 特例：若 `platformModelId` 或 `apiKeyModelId` 非空，**跳过** `instanceId` 的必填校验
- 必填且为空 → `` `配置 ${label}(${key}) 为必填` ``
- 类型不符 → `` `配置 ${label}(${key}) 需要 ${type} 类型` ``
- 数字越界（`min` / `max`，来自模型能力）→ `` `配置 ${label}(${key}) 不能小于/大于 ${n}` ``

**模型能力会动态改写字段约束**（`applyCapabilitiesToConfigField`）：

| 节点 | 字段 | 被能力改写的部分 |
| --- | --- | --- |
| `imageGen` / `imageToImage` | `n` | `min=1`, `max=image.maxImages` |
| `videoGen` / `multiImageVideo` | `duration` | `min=video.durationMin`, `max=video.durationMax` |
| 同上 | `resolution` | `options = video.resolutions` |
| 同上 | `aspectRatio` | `options = video.ratios` |
| 同上 | `mode` | `options = ['auto', ...video.modes]`（带中文标签） |
| `imageGen` / `imageToImage` | `size` | `options = image.sizeAliases \|\| image.sizes` |

**因此：切换模型后必须重新取能力并重新校验配置**，否则会放行超出模型限制的参数。

---

## 六、新实现必须守住的不变量

以下每条被违反都会导致**静默错误**——不报错、但结果不对：

1. **端口载荷必须是带 `type` 的信封对象**，不能是裸值。
2. **取值必须有主输出回退链**（§2.6），且顺序一致。
3. **执行前先校验输入和配置，再做指纹复用判断**（顺序不可swap）。
4. **指纹必须包含 `config` + `inputs` + `context.modelContext` 三部分**；漏掉 `inputs` 会导致上游变化后下游不重跑（用户会看到旧图）。
5. **指纹序列化必须对键名排序**，否则属性顺序变化会造成无意义的重跑。
6. **"多条边进同一输入"的行为由输入端口名决定**（§2.7），不是由值决定。
7. **pending 任务状态集合与任务识别规则必须一致**（§4.6），否则视频节点会被过早判定为 `completed`。
8. **`modelContext` 必须随输出传播**，否则 `modelSource: 'inherit'` 失效、模型继承静默退化为默认模型。
9. **`hasError` 判定只看 `outputs.error` 是否为真值**；执行器返回 `{error: '...'}` 就必须算失败。
10. **循环依赖必须中止整批**，不能部分执行。

## 七、已知的不一致（记录在案，新实现需明确取舍）

这些是现有实现的实际状态，**不是建议照抄**，但新实现若与它们不同，需要有意识地决定：

| 项 | 现状 |
| --- | --- |
| 节点注册表 22 种 vs 执行器注册表 19 种 | `textInput` / `merge` / `preview` 不在 `executors` 映射里，由引擎内的 `switch` 分支处理。**新增节点时必须知道该往哪边加** |
| `imageToImage` / `multiImageVideo` | 有完整注册表定义（含端口、配置），但实现是纯委托别名。它们的配置字段（如 `multiImageVideo.model` 默认 `seedance-video`）在委托后会被 `videoGen` 的同名配置使用 |
| 注册表 `outputs` 与执行器实际返回 | 执行器返回的字段多于注册表声明（§4.8），例如 `imageGen` 不声明 `task`/`tasks`/`text` |
| 主输出回退链的触发 | 仅在 `outputs[sourceKey]` 为 `undefined`/`null` 时触发；空字符串**不会**触发回退 |
| 同层执行顺序 | 不保证稳定（§4.2） |
