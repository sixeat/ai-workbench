# AI Workbench 实施清单

结论：后续开发先稳住后端 SaaS 基座，再继续打磨模型适配、素材库和工作流体验。前端视觉可以等设计稿确定后重做，但接口、权限、任务和资产结构要先稳定。

## 5 分钟版

| 优先级 | 目标 | 当前判断 | 下一步 |
| --- | --- | --- | --- |
| P0 | 部署稳定性 | 已有任务队列、恢复、取消、日志、重试和队列健康基础 | 补跨文本、图片、视频的回归测试 |
| P1 | 前后端分离 | 已支持 `VITE_PROXY_URL`、CORS、Cookie、静态托管配置和 API-only 运行时测试 | 继续减少隐式同源假设 |
| P2 | SaaS 安全 | 已有登录、管理员、审计、限额和上传限制 | 补后台关键路由测试和会话管理细节 |
| P3 | 模型适配 | 已有能力表、模板和测试按钮 | 按厂商文档补更多模型限制 |
| P4 | 网关层 | 已有轻量内部 Gateway，集中 CORS、Session 鉴权、限流、请求日志、API 404 和错误响应 | 后续抽成独立 gateway 进程或反向代理层 |
| P5 | 前端 SaaS 化 | 已禁用服务器模式下的浏览器本地 Key 路径 | 后续按新设计稿重做信息架构 |
| P6 | 素材库与工作流 | 已有集合、任务入库、节点引用和版本 | 增强高频复用动作和节点运行记录 |

## 为什么这样排

服务器版本最怕两个问题：数据不可靠，权限不清楚。

所以先做 P0 到 P2。它们决定这个项目能不能放心给朋友多人使用。

模型能力和素材库会直接影响创作效率。所以 P3 到 P5 要持续迭代，但不要抢在后端基座前面大改视觉。

## P0：部署稳定性

| 项目 | 验收标准 | 证据 |
| --- | --- | --- |
| 后台任务队列 | 文本、图片、视频生成都先入库为 `queued` | `/api/chat`、`/api/images`、`/api/videos` 任务测试 |
| 任务恢复 | 服务重启后 `running` 不会永久卡住 | 队列恢复测试 |
| 任务取消 | 排队任务可取消，运行中任务可软取消 | 取消任务测试 |
| 任务日志 | 记录输入摘要、模型、耗时、错误、上游 task id | 任务详情和日志测试 |
| 统一重试 | 文本、图片、视频失败后能按原始输入重试 | 重试任务测试 |
| 队列并发配置 | 文本队列和生成队列可分别通过环境变量调整并发，默认保持 `2` | `requestConfigService` 和队列路由测试 |

## P1：前后端分离基线

| 项目 | 验收标准 | 证据 |
| --- | --- | --- |
| Cookie 配置 | 支持 `SameSite=None`、`Secure`、`Domain` | `requestConfigService` 测试、`appSplitDeployment` 登录 Cookie 测试和部署文档 |
| CORS 配置 | 明确 `WORKBENCH_CORS_ORIGIN=https://前端域名`，且只给允许的前端域名返回凭证头 | `deploymentCheck` 测试、`appSplitDeployment` CORS 测试和部署文档 |
| 前端 API 地址 | 生产构建依赖 `VITE_PROXY_URL`，分离部署不允许留空 | `apiProxy` 测试和 `deploymentCheck` 测试 |
| 静态托管策略 | 后端可只做 API，`/` 和 `/index.html` 不再由 API 服务托管 | `WORKBENCH_SERVE_STATIC=false` 检查和 `appSplitDeployment` API-only 测试 |
| 健康检查拆分 | `/api/health` 简洁，`/api/admin/health` 详细 | `healthRoutes` 测试和 `appSplitDeployment` 公开健康检查测试 |

## P2：SaaS 安全

| 项目 | 验收标准 | 下一步 |
| --- | --- | --- |
| 用户 API Key 配额 | 普通用户不能无限保存 Key | 扩展配额测试 |
| 管理员审计 | 创建用户、禁用用户、改 Key、改模型能力都有日志 | 继续补审计边界和前端检索体验 |
| Session 管理 | 可查看设备，可退出所有设备，可退出单设备，匿名请求不能访问或修改会话 | 后续补过期会话展示边界 |
| 注册风控 | 邮箱验证码按 email 和 IP 双维度限流，公开注册和找回密码验证码输错会锁定当前验证码 | 后续补前端错误次数提示 |
| 上传限制 | 限制单文件、总容量、每日上传量，超限前不落盘且按用户隔离 | 后续补前端容量提示 |

## P3：模型适配体系

| 项目 | 验收标准 | 下一步 |
| --- | --- | --- |
| 文本生成 service 化 | 路由只转发给 service | 保持路由轻量 |
| 模型能力 UI 联动 | 选择模型后显示时长、参考图、seed、负面词限制 | 补更多模型限制文档 |
| 能力模板导入 | 可从厂商文档手动维护 preset | 增加 Seedance、通义万相细分模板 |
| 错误标准化 | 厂商错误统一成可读分类 | 扩展 provider adapter 测试 |
| 模型测试按钮 | 保存 Key 时可测试文本、图片、视频能力 | 增加是否可能付费的检测说明 |

## P4：网关层

| 项目 | 验收标准 | 下一步 |
| --- | --- | --- |
| Gateway 入口 | CORS、请求体限制、安全头、Session、API 鉴权和限流由 `gatewayService` 集中注册 | 后续把 Express 内部 Gateway 替换成独立网关进程 |
| 路由映射 | `/api/auth/*`、`/api/tasks/*`、`/api/assets/*`、`/api/workflows/*`、`/api/models/*` 映射到未来服务边界 | 继续补转发策略和服务发现配置 |
| 可选路由转发 | 配置 `WORKBENCH_GATEWAY_*_URL` 后，匹配路由会先转发到内部服务；未配置时继续落回单体 routes | 后续按服务拆分顺序逐个启用内部上游 |
| 请求日志 | 可通过 `WORKBENCH_REQUEST_LOGS` 或 `WORKBENCH_GATEWAY_REQUEST_LOGS` 打开网关请求日志 | 后续接入持久化审计或外部日志系统 |
| 统一错误响应 | API 404 和网关层异常返回稳定 JSON，不暴露内部堆栈 | 后续把更多路由里的手写错误收敛到统一响应 |
| 网关测试 | 覆盖路由映射、上游地址解析、敏感头剥离、CORS、鉴权、限流、请求日志、404、转发和错误处理 | 后续补真实反向代理部署测试 |

## P5：前端 SaaS 化

| 项目 | 验收标准 | 下一步 |
| --- | --- | --- |
| 去掉本地 Key 路径 | 服务器模式只使用后端 Key 管理 | 持续检查 localStorage 回归 |
| 工作流保存后端优先 | IndexedDB 只做离线或本地 fallback；服务器模式网络失败直接报错 | 补更细的页面错误提示 |
| 登录态展示 | 顶部显示账号、角色、模式 | 后续按设计稿重做 |
| 管理后台分区 | 用户、邀请、API Key、模型能力、系统状态清晰分区 | 继续打磨批量操作和详情页 |
| 中文文案 | 无乱码，无中英文混乱 | 每次改文案后跑 `npm run check:mojibake` |

## P6：素材库与工作流体验

| 项目 | 验收标准 | 下一步 |
| --- | --- | --- |
| 素材集合模板 | 支持角色、场景、产品、参考图组 | 增加自定义模板字段 |
| 素材引用 | 图片输入节点可从素材库选择 | 增强筛选和预览 |
| 任务到素材 | 生成结果一键加入集合 | 支持批量角色归档 |
| 节点运行记录 | 节点显示最近任务和产物 | 补节点级复用入口 |
| 工作流版本 | 可保存、复制、回滚版本 | 增加版本差异说明 |

## 本轮已补

| 改动 | 作用 |
| --- | --- |
| 登录接口路由测试 | 覆盖登录成功、缺少凭据、错误密码、禁用用户和登出清 Cookie |
| Server Key 管理权限测试 | 普通用户不能创建、更新、删除或测试服务器托管 Key，防止越权改全局凭据 |
| 用户 Key 配额可见化 | `/api/api-keys` 返回个人 Key 配额，前端显示已用/上限/剩余额度，普通用户默认新增个人 Key |
| Key 权限文案收敛 | API 管理页统一为“后端 Key”，并区分个人 Key 和服务器共享 Key，非管理员不能在前端选择共享 Key |
| 邀请码审计日志测试 | 管理员创建和禁用邀请码都会写审计日志，但不会把一次性邀请码明文写进 metadata |
| 上传 MIME 和配额隔离测试 | 非图片 MIME 会在落盘前被拒绝，素材容量和每日上传配额只计算当前用户 |
| 上传配额落盘前拦截 | 单文件、总容量和每日上传超限都会在调用 `assetStorage.save` 前失败，避免服务器磁盘先被写满 |
| 每日上传范围校准 | 每日上传额度只统计 `providerId=upload` 的本地上传资产，不把同用户当天生成图和生成视频算入上传额度 |
| 图片队列端到端补齐 | `/api/images` 会先返回 `queued` 任务，再由 worker 调上游、保存资产、写入成功日志，和文本、视频队列测试形成闭环 |
| Worker 异常日志安全化 | worker 抛错时失败日志保留模型、耗时和上游 task id，但不写入原始异常里的 Key 或私有 URL |
| 取消优先日志语义 | 运行中任务被软取消后，即使 worker 随后抛错，也保持 `cancelled` 状态和取消日志 |
| 统一重试链路日志 | 文本、图片、视频重试日志同时保留旧的 `upstreamTaskId` 和完整 `upstreamTaskIds` |
| 统一重试分派服务化 | `/api/tasks/:id/retry` 通过独立 dispatcher 分派文本、图片、视频任务，避免文本重试逻辑藏在启动文件里 |
| 队列健康快照 | `/api/admin/health` 显示文本队列和生成队列的并发、活跃任务、积压数量和启停状态 |
| 后台队列状态展示 | 管理后台系统状态页展示队列名称、节点类型、活跃/排队数量和空闲、运行、积压、停止状态 |
| 队列并发配置化 | 文本队列和生成队列可通过 `WORKBENCH_TEXT_QUEUE_CONCURRENCY`、`WORKBENCH_GENERATION_QUEUE_CONCURRENCY` 分别调整 |
| 前后端分离 URL 防配反 | 部署检查会拒绝把 `WORKBENCH_CORS_ORIGIN` 配成后端 API 域名 |
| 前后端分离 URL 格式防错 | 部署检查会拒绝把 `VITE_PROXY_URL`、`WORKBENCH_CORS_ORIGIN`、`WORKBENCH_PUBLIC_BASE_URL` 写成带 `/api`、路径、query 或 hash 的地址 |
| 前后端分离运行时护栏 | `server/appSplitDeployment.test.cjs` 会验证 API-only 模式、公开健康检查最小化、CORS 凭证头和跨域登录 Cookie |
| 本地开发地址固定 | `npm run dev:web` 和 Vite dev server 默认监听 `127.0.0.1`，减少 `localhost`/IPv6/旧进程混用导致的登录页错位 |
| 管理员入口部署提醒 | 部署检查会在没有 bootstrap admin 或 `WORKBENCH_ADMIN_TOKEN` 时提醒确认已有管理员，避免首次部署后进不了后台 |
| 健康检查路由拆分 | `/api/health` 和 `/api/admin/health` 独立，公开接口不暴露路径 |
| 通用限流服务拆分 | 默认不信任 `X-Forwarded-For`，只在显式开启代理信任时使用代理 IP |
| 启动管理员初始化拆分 | 校验管理员邮箱和密码配置，避免半配置启动 |
| 安全响应头拆分 | 集中生成 CSP、Frame、Referrer 和权限策略 |
| Session 中间件拆分 | 集中解析登录 Cookie，清理过期或禁用用户 Session |
| API 鉴权中间件拆分 | 统一处理 `/api` 入口鉴权、登录态和访问 Token |
| 请求配置解析拆分 | 集中解析上传、限流、Cookie、注册、登录和队列配置 |
| 请求身份解析拆分 | 统一处理管理员校验和请求用户 ID 边界 |
| 模型能力前端校验增强 | 图片和视频节点会读取连线参数，提前提示数量、尺寸、时长、比例、分辨率、参考素材和不支持参数 |
| 视频能力服务端兜底 | 服务端视频能力过滤同时识别 `content` 和直接媒体字段，避免 `images`、参考视频、参考音频绕过模型限制 |
| 图片能力服务端兜底 | 图片生成会先把 `promptExtend`、`enableSequential`、`thinkingMode` 转成厂商字段，再按模型能力过滤和发送 |
| 图片节点智能改写联动 | 图片生成节点新增 `智能改写 Prompt` 开关，前端会按模型能力显示支持状态并阻止静默误用 |
| 模型能力完整加载 | 节点属性面板和节点徽章会分页拉取完整能力表，避免能力 preset 增多后只识别第一页 |
| 模型限制展示补齐 | 右侧属性面板会展示图片像素/宽高比，以及视频模式、帧率、频控、任务类型和媒体类型 |
| API Key 测试限制补齐 | 测试结果和能力模板预览会展示图片像素/宽高比、图片高级能力，以及视频模式、任务类型和媒体类型 |
| 参考素材上限声明 | 视频参考图、参考视频、参考音频会显示“最多 X”或“未声明上限”，避免把“支持”误读成无限制 |
| 模型能力表单补齐 | 图片像素/宽高比、视频模式、FPS、并发、RPM、任务类型和媒体类型都可在表单维护，不必只写 JSON |
| 宽高比输入友好化 | 模型能力表单的宽高比字段支持 `1:8`、`8:1` 和小数，便于照着厂商文档录入 |
| 能力模板预览完整化 | 模板预览不再截断前 12 项，避免视频任务类型和媒体类型等后置限制被隐藏 |
| 视频模式能力联动 | 视频节点生成模式会按 `video.modes` 收窄选项，并在自动识别出不支持模式时提前提示 |
| 视频模式服务端兜底 | 视频任务会把工作台模式传入后端能力过滤，不支持的 `video.modes` 会在调用厂商前失败 |
| 上游任务失败错误标准化 | 视频任务 HTTP 成功但上游状态失败时，会保存厂商 code、message、请求 ID、任务状态和内容安全分类 |
| 模型测试按钮语义增强 | 测试结果明确显示模型列表请求、极短文本实测、能力表判断、未请求，以及是否可能产生费用 |
| 模型能力审计收紧 | 保存模型能力时只记录 provider、modelPattern 和改动键名，拒绝数组等错误形状的 capabilities，避免审计日志存入完整能力配置 |
| 模型能力审计区分创建和更新 | 保存模型能力时记录 `operation=create/update`，更新时附带旧能力键名和新提交键名，但不写入完整 capabilities |
| 用户状态审计前后值 | 管理员启用或禁用用户时，审计日志记录 `previousIsEnabled` 和 `isEnabled`，便于追踪账号状态变化 |
| API Key 更新审计按真实变化记录 | 更新 Key 时只把真正变化的字段标为 changed，并记录 provider 与启用状态前后值，不记录明文 Key、密文 Key、名称或 Base URL |
| 嵌套厂商错误归一化 | 支持从 `output.error` 和 `data.error` 提取 code、message、param、requestId，让图片和视频任务历史能显示更准确的失败原因 |
| 字符串和大写错误字段归一化 | 支持 `data.error` 字符串、`ErrorCode`、`ErrorMessage`、`RequestId` 等厂商字段；4xx 可显示安全摘要，5xx 字符串载荷仍不写入任务错误 |
| 紧凑厂商错误码归类 | `InvalidApiKey`、`TooManyRequests`、`ModelNotFound`、`ServiceUnavailable` 这类驼峰错误码也会归入鉴权、限流、模型不存在和上游异常 |
| 任务历史错误提示细化 | 前端按鉴权、额度、内容安全、参数不兼容、限流等分类展示处理建议，搜索也能匹配这些建议 |
| 节点运行参数限制摘要 | 属性面板结合当前节点配置和连线输入，展示生成数量、参考图、尺寸、时长、比例、分辨率等本次运行参数是否接近或超过模型限制 |
| 任务产物提取统一化 | 任务历史统一从关联资产、图片输出、视频输出和 ShotList 中提取产物，支持一键加入素材集合 |
| 任务产物批量归档 | 任务历史可按已加载的筛选结果把多个任务产物去重后批量加入同一素材集合 |
| 节点运行记录稳定化 | 最近一次运行会记录 task 状态，并对图片、视频、ShotList 产物按 id/url 去重 |
| 任务历史日志摘要化 | `/api/tasks` 默认只返回任务摘要和资产，展开详情时再通过 `/api/tasks/:id` 加载完整日志，降低长期轮询负载 |
| API Key 和模型能力分页 | `/api/api-keys` 与 `/api/model-capabilities` 支持服务端分页、搜索和筛选，前端管理页可加载更多，避免多人服务器全量拉取 |
| 前端代理路径参数编码 | `apiProxy` 对 task、asset、collection、apiKey 等动态路径参数统一编码，减少分离部署和异常 ID 带来的路径歧义 |
| 生产 API 地址显式化 | `apiProxy` 解析结果会标记生产缺少 `VITE_PROXY_URL` 的错误；部署检查也会拒绝分离部署下空 API 地址 |
| 图片输入素材集合完整加载 | 图片输入节点打开素材库时会分页加载完整集合，节点产物入库查重也不再只看第一页集合 |
| 图片输入素材复用规则 | 图片输入节点从素材库或上传图片写入统一配置，保留用户手写 prompt，并记录 `assetId/url/fileName` 供后续节点复用 |
| 运行产物入库集合完整加载 | 右侧属性面板把节点最近产物加入素材集合时，也会分页加载完整集合 |
| 生成产物容量配额闭环 | 图片和视频生成结果保存前会检查用户素材总容量，超额任务会失败且不落盘、不入库 |
| 素材集合搜索增强 | 素材库集合搜索在服务端分页前支持分类中文名、建议角色、自定义角色和集合内素材角色/备注 |
| 登录态展示兜底 | 顶部账号状态在未登录但有部署模式时也会显示令牌访问/本地访问和服务器/本地模式 |
| Session 匿名边界测试 | `/api/auth/sessions`、`/api/auth/sessions/logout-all` 和单设备退出接口在未登录时返回 `401`，且不会误删已有会话 |
| 视频参考媒体数量限制 | 模型能力表新增参考视频和参考音频数量上限，前端展示/校验和服务端过滤都会生效 |
| 素材读取隔离测试 | `/api/assets/:id` 和旧 `/api/images/:id` 在跨用户访问时不会调用底层文件读取 |
| 工作流保存边界收紧 | 保存工作流时限制节点数、连线数和 metadata 大小，并按真实 nodes 数量计算 `nodeCount` |
| 邮箱注册和找回流程测试 | 覆盖公开注册、验证码验证、Session 创建、密码找回、未知账号隐藏和禁用账号拒绝 |
| 注册验证码双维限流测试 | `/api/auth/register/request` 会按规范化邮箱和来源 IP 分别限流，重复请求返回 `429` 和 `Retry-After` |
| 验证码错误次数锁定 | 注册和密码找回验证码连续输错达到 `WORKBENCH_EMAIL_CODE_MAX_VERIFY_ATTEMPTS` 后会消费当前验证码，正确码也不能再复用 |
| 登录页密码找回入口 | 前端登录页支持发送重置验证码、验证验证码、设置新密码，并在成功后刷新 Cookie 登录态 |
| 工作流本地副本提示 | 工作流管理页在后端网络失败并回退 IndexedDB 时，会标记本地副本并提示恢复连接后重新保存 |
| 服务器模式禁用 IndexedDB fallback | `App` 根据 `/api/auth/me` 同步部署模式；`workflowDb` 在 server 模式下不再把网络失败写入本地 IndexedDB |
| 模型能力保存边界收紧 | 管理员保存模型能力时限制 provider、model pattern 和 capabilities JSON 大小，异常输入不写库不审计 |
| 任务产物二次隔离 | 任务历史读取产物时按任务所属用户再次过滤资产，异常跨用户关联不会泄漏素材 |
| 素材集合输入边界 | 创建/更新素材集合和加入素材时限制名称、描述、metadata、角色和备注长度，异常输入不会写库 |
| 视频多模态任务可恢复输入 | 视频任务入库和重试会保留 `content`、`generate_audio` 和参考媒体字段，服务重启后 worker 只靠数据库输入也能继续提交上游 |
| 队列冷启动续跑 | worker 启动会从数据库捞取已有 `queued` 的文本、图片、视频任务，即使没有内存 payload 也能继续执行 |
| Running 恢复范围隔离 | 文本队列和生成队列启动时只恢复自己负责的 `node_type`，避免误把其他队列正在运行的任务标记为中断 |
| 取消排队任务防误执行 | 排队任务在 worker 调度前被取消后不会被 claim，也不会写入 started 或 succeeded 日志，避免取消后仍调用上游 |
| 路由层取消闭环 | `/api/images` 创建排队任务后立刻调用 `/api/tasks/:id/cancel`，worker 不会调用图片上游，也不会写入 started 或 succeeded 日志 |
| 取消请求日志上下文化 | `cancel_requested` 会记录取消前状态、节点类型、provider、模型、耗时和上游 task id，方便排查软取消任务 |
| 任务仓储边界 | `taskService`、`taskQueueService`、文本/图片/视频生成 service 和任务重试日志改走 `taskRepository`，支持后续替换 DB 或拆 worker-service |
| 资产仓储边界 | `assetRoutes`、`assetQuotaService`、图片/视频生成产物落库和健康检查资产计数改走 `assetRepository`，支持后续拆 asset-service |
| API Key 仓储边界 | `apiKeyRoutes` 和 `credentialService` 改走 `apiKeyRepository`，支持后续拆 model-service、auth-service 或替换 Key 存储 |
| 工作流仓储边界 | `workflowRoutes` 改走 `workflowRepository`，支持后续拆 workflow-service 或替换工作流存储 |
| 模型能力仓储边界 | `modelProxyRoutes` 和 `modelCapabilities` 改走 `modelCapabilityRepository`，支持后续拆 model-service |
| Auth 仓储边界 | `authRoutes`、`sessionMiddlewareService` 和启动管理员初始化改走 `authRepository`，支持后续拆 auth-service |
| Auth Session service 边界 | 登录、登出、会话列表和 Session 退出从 `authRoutes` 下沉到 `authSessionService`，路由只负责参数和响应 |
| Auth 邮箱流程 service 边界 | 注册验证码、注册确认、密码找回和验证码错误锁定从 `authRoutes` 下沉到 `authEmailFlowService`，可独立测试 |
| Auth 管理员用户 service 边界 | 用户列表、创建用户、修改密码、启停用户和用户审计日志从 `authRoutes` 下沉到 `authAdminUserService` |
| Auth 邀请码 service 边界 | 邀请码列表、创建、禁用、公开返回格式和审计日志从 `authRoutes` 下沉到 `authInvitationService` |
| 素材集合 service 边界 | 素材集合分页、创建/更新校验、批量加入/移除、排序和封面刷新从 `assetRoutes` 下沉到 `assetCollectionService` |
| 资产基础 service 边界 | 资产列表、上传 data URL 解析、MIME/配额校验、资产读取和本地打开位置从 `assetRoutes` 下沉到 `assetService` |
| 模型能力 service 边界 | 模型能力分页、provider/modelPattern 校验、capabilities 大小校验、基础能力合并和审计日志从 `modelProxyRoutes` 下沉到 `modelCapabilityService` |
| 模型列表 service 边界 | `/api/models` 的凭据解析、上游模型列表请求、模型条目清洗和上游错误返回从 `modelProxyRoutes` 下沉到 `modelListService` |
| 通用代理 service 边界 | `/api/proxy` 的 URL 必填校验、代理开关、白名单校验和请求转发从 `modelProxyRoutes` 下沉到 `genericProxyService` |
| 文本任务请求 service 边界 | `/api/chat`、`/api/claude`、同步文本入口和失败文本任务重试从 `modelProxyRoutes` 下沉到 `textTaskRequestService` |
| 生成任务请求 service 边界 | `/api/images`、`/api/videos`、同步生成入口、视频任务查询和失败生成任务重试从 `generationRoutes` 下沉到 `generationTaskRequestService` |
| API Key 管理 service 边界 | API Key 列表、个人 Key 配额、创建/更新/删除、测试调用和安全审计从 `apiKeyRoutes` 下沉到 `apiKeyManagementService` |
| 工作流 service 边界 | 工作流列表、保存校验、复制、删除、版本列表、版本详情、版本恢复和版本复制从 `workflowRoutes` 下沉到 `workflowService` |
| 路由层 repository 依赖清理 | routes 不再直接 require repositories，默认仓储依赖由 service 层持有，路由只注入上下文和返回响应 |
| 后端模块边界自动化护栏 | 新增 `backendModuleBoundary.test.cjs`，自动阻止 routes 直连 repositories/db、services 直连 db/routes、repositories 反向依赖上层、workers 直连 db/repositories/routes |
| App factory 启动边界 | `server/app.cjs` 负责组装 Express app 和路由，`server/index.cjs` 只负责监听端口和进程退出 |
| API-only 启动开关 | `WORKBENCH_START_WORKERS=false` 和 `npm run start:api` 可只启动 HTTP API，任务只入库为 `queued`，不会在 API 进程里消费 |
| Worker-only 启动入口 | `npm run start:worker` 启动无 HTTP 的 worker runtime，复用文本、图片和视频队列工厂消费数据库里的 `queued` 任务 |
| Worker 常驻轮询 | `WORKBENCH_TASK_QUEUE_POLL_INTERVAL_MS` 控制独立 worker 扫描数据库的间隔，避免 Worker 先启动后错过 API 新建任务 |
| 进程边界自动化护栏 | `processBoundary.test.cjs` 防止 API 入口直接加载 worker，防止 worker 入口反向依赖 HTTP app、routes 或 db 初始化 |
| Worker runtime 生命周期护栏 | `workerRuntime.test.cjs` 覆盖 start/stop 幂等，避免重复启动队列或重复停止造成进程退出异常 |
| API/Worker 双进程运行测试 | `splitProcessRuntime.test.cjs` 真实启动 `server/api.cjs` 和 `server/worker.cjs`，验证 API 返回 `taskId` 后 Worker 从共享 SQLite 完成文本、图片、视频任务 |
| 素材重复入库提示 | 任务历史和节点最近运行会识别当前集合已有产物，禁用重复入库按钮，并把批量归档范围收窄到未入库产物 |
| 万相 2.7 视频能力模板 | 内置 `wan2.7-t2v*` 和 `wan2.7-*-i2v*` 限制，展示时长、参考素材数量、音频/图片/视频格式、文件大小、输出格式和结果链接有效期 |
| Seedance 2.0 参考素材限制 | 内置 Seedance 2.0 的 4-15 秒、480P/720P、最多 9 图、3 视频、3 音频和 12 个参考素材总数限制，并在前后端同时校验 |

## 建议下一步

继续拆 P1 的 service 边界，优先扫剩余 routes 是否还有数据库访问、审计或任务组装逻辑。随后补 P2 的 API/Worker 部署验证，再补 P3 的厂商模型能力模板。

优先覆盖模型厂商错误分类、API Key 配额、素材上传限制、工作流版本权限和模型能力修改审计。
