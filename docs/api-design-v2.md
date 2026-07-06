# API 配置系统设计方案 v2

## 核心概念

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Provider   │────▶│  Instance    │────▶│  Node 执行   │
│  (提供商模板) │     │  (具体实例)   │     │  (节点选择)  │
└─────────────┘     └──────────────┘     └──────────────┘
```

### Provider（模板）
- 预定义请求格式、认证方式、端点路径
- 用户只需选择模板，无需理解技术细节
- 可扩展：内置模板 + 自定义模板

### Instance（实例）
- 一个具体的 API Key + 配置
- 同一 Provider 可创建多个实例（多账号、多中转站）
- 节点执行时选择"用哪个实例"

---

## 数据结构

### Provider 模板

```typescript
interface ProviderTemplate {
  id: string;
  name: string;
  description: string;
  category: 'text' | 'image' | 'video' | 'multi';
  authType: 'bearer' | 'apiKey' | 'custom';
  defaultBaseUrl: string;
  endpoints: {
    chat?: string;
    image?: string;
    video?: string;
    models?: string;
  };
  headers?: Record<string, string>;
  requestFormat: 'openai' | 'anthropic' | 'custom';
  supportedNodes: NodeType[];
}
```

### Instance 实例

```typescript
interface ApiInstance {
  id: string;
  name: string;
  providerId: string;
  apiKey: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
  models: string[];
  modelFetchMode: 'auto' | 'manual';
  isEnabled: boolean;
}
```

---

## 预定义 Provider 模板

| 模板 | ID | 能力 | 认证 | 默认 Base URL | 格式 |
|------|-----|------|------|---------------|------|
| **OpenAI 兼容** | `openai-compatible` | 文本+图片 | Bearer | - | openai |
| **Anthropic** | `anthropic` | 文本 | x-api-key | api.anthropic.com | anthropic |
| **Seedance** | `seedance` | 视频 | Bearer | - | custom |
| **Stability AI** | `stability` | 图片 | Bearer | api.stability.ai | custom |
| **SiliconFlow** | `siliconflow` | 文本+图片 | Bearer | api.siliconflow.cn | openai |
| **Moonshot** | `moonshot` | 文本 | Bearer | api.moonshot.cn | openai |
| **完全自定义** | `custom` | 任意 | 任意 | - | custom |

---

## 界面设计

### API 管理面板（两栏布局）

左侧：Instance 列表（搜索 + 卡片列表 + 添加按钮）
右侧：实例详情表单（基本信息 + 认证 + 模型列表 + 操作按钮）

### 节点配置

选择 Instance → 选择 Model → 配置参数

---

## 实现计划

1. 更新 `types/api.ts` - 新类型定义
2. 创建 `data/providerRegistry.ts` - Provider 模板注册表
3. 重写 `stores/apiStore.ts` - 支持 Instance 的 Store
4. 重写 `components/panels/ApiManagerPanel.tsx` - 两栏布局面板
5. 更新 `engine/apiClients/` - 通用 API 客户端
6. 更新节点执行器 - 适配新架构
