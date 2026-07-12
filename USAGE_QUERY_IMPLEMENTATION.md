# 模型用量查询功能实现文档

## 概述

基于竞争对手 cc-switch 的架构，我们实现了模型用量查询功能，支持多个主流 AI 模型提供商的配额和余额查询。

## 架构设计

### 1. 厂商目录结构

采用**模块化厂商目录**架构，每个厂商独立实现，便于维护和扩展：

```
src-tauri/src/services/usage_providers/
├── mod.rs           # 主模块，定义 trait 和入口函数
├── deepseek.rs      # DeepSeek 实现
├── kimi.rs          # Kimi For Coding 实现
├── minimax.rs       # MiniMax 实现
├── novita.rs        # Novita AI 实现
├── openrouter.rs    # OpenRouter 实现
├── siliconflow.rs   # SiliconFlow 实现
├── stepfun.rs       # StepFun 实现
├── volcengine.rs    # 火山引擎 实现
├── zenmux.rs        # ZenMux 实现
└── zhipu.rs         # 智谱 GLM 实现
```

### 2. 核心类型定义

```rust
/// 单个用量配额（进度条）
pub struct UsageQuota {
    pub percentage: f64,      // 0-100
    pub reset_at: i64,        // Unix 时间戳（毫秒）
    pub label: Option<String>, // 标签（如 "5 Hours", "Weekly"）
}

/// 模型用量数据
pub struct ModelUsageData {
    pub quotas: Vec<UsageQuota>,  // 1-3 个配额条
    pub last_updated: Option<i64>,
}

/// 查询结果
pub struct UsageResult {
    pub success: bool,
    pub data: Option<ModelUsageData>,
    pub error: Option<String>,
}
```

### 3. Provider Trait

每个厂商实现统一的 `UsageProvider` trait：

```rust
#[async_trait::async_trait]
pub trait UsageProvider {
    async fn query_usage(&self, api_key: &str, base_url: &str) -> Result<UsageResult, String>;
    fn can_handle(&self, base_url: &str) -> bool;
    fn name(&self) -> &'static str;
}
```

## 支持的厂商

### 余额查询类型（Balance）

| 厂商 | 匹配规则 | API 端点 | 返回数据 |
|------|---------|----------|---------|
| **DeepSeek** | `api.deepseek.com` | `GET /user/balance` | 余额信息 |
| **StepFun** | `api.stepfun.ai`<br>`api.stepfun.com` | `GET /v1/accounts` | 账户余额 |
| **SiliconFlow** | `api.siliconflow.cn`<br>`api.siliconflow.com` | `GET /v1/user/info` | 总余额 |
| **OpenRouter** | `openrouter.ai` | `GET /api/v1/credits` | 信用额度 |
| **Novita AI** | `api.novita.ai` | `GET /v3/user/balance` | 可用余额 |

### Token Plan 类型（套餐额度）

| 厂商 | 匹配规则 | API 端点 | 返回数据 |
|------|---------|----------|---------|
| **Kimi For Coding** | `api.kimi.com/coding` | `GET /coding/v1/usages` | 5小时窗口 + 周限额 |
| **智谱 GLM** | `bigmodel.cn`<br>`api.z.ai` | `GET /api/paas/v4/usage` | 多窗口限额 |
| **火山引擎** | `volces.com/api/coding` | `GET /api/coding/[v3]/usage` | 当前会话 + 近1周 + 近1月 |
| **MiniMax** | `api.minimaxi.com`<br>`api.minimax.io` | `GET /v1/usage` | 多时间窗口 |
| **ZenMux** | `zenmux` | `GET /usage` | 小时/日限额 |

## 前端实现

### 1. UI 变化

#### 顶部操作栏
- 添加"配置/用量"标签切换
- 配置模式：显示 "🎯 测速" 按钮
- 用量模式：显示 "🔄 刷新用量" 按钮

#### 模型卡片
- **配置模式**：显示 Model ID、Source、Latency、Protocol
- **用量模式**：显示 1-3 条进度条
  - 每条显示：百分比 + 重置倒计时
  - 实时倒计时更新（每分钟刷新）

### 2. 状态管理

```typescript
// Context 新增状态
viewMode: 'config' | 'usage'           // 视图模式
modelUsageData: Record<string, ModelUsageData>  // 用量数据
isRefreshingUsage: boolean              // 刷新状态

// 新增函数
refreshAllUsage(): Promise<void>        // 刷新所有模型用量
```

### 3. API 调用

```typescript
// 前端 API
export async function queryModelUsage(internalId: string): Promise<UsageResult>

// 后端 Tauri Command
#[tauri::command]
pub async fn query_model_usage(internal_id: String) -> Result<UsageResult, String>
```

## 使用流程

1. 用户在模型管理页面点击"用量"标签
2. 点击"🔄 刷新用量"按钮
3. 前端调用 `refreshAllUsage()`
4. 对每个模型调用 `api.queryModelUsage(internal_id)`
5. 后端根据 `base_url` 自动检测厂商
6. 调用对应厂商的 Provider 实现
7. 返回用量数据，前端展示进度条

## 扩展新厂商

只需 3 步：

### 1. 创建新的 Provider 文件

```rust
// src-tauri/src/services/usage_providers/newfirm.rs
pub struct NewFirmProvider;

#[async_trait::async_trait]
impl UsageProvider for NewFirmProvider {
    async fn query_usage(&self, api_key: &str, _base_url: &str) -> Result<UsageResult, String> {
        // 实现 API 调用
    }
    
    fn can_handle(&self, base_url: &str) -> bool {
        base_url.contains("newfirm.com")
    }
    
    fn name(&self) -> &'static str {
        "NewFirm"
    }
}
```

### 2. 在 mod.rs 中注册

```rust
pub mod newfirm;

pub fn detect_provider(base_url: &str) -> Option<Box<dyn UsageProvider + Send + Sync>> {
    // ...
    Box::new(newfirm::NewFirmProvider),
    // ...
}
```

### 3. 完成！

无需修改其他代码，新厂商自动生效。

## 国际化

已添加的翻译键：

```typescript
// 英文
'model.config': 'Config'
'model.usage': 'Usage'
'model.noUsageData': 'No usage data available'
'btn.refreshUsage': 'Refresh Usage'

// 简体中文
'model.config': '配置'
'model.usage': '用量'
'model.noUsageData': '暂无用量数据'
'btn.refreshUsage': '刷新用量'
```

## 注意事项

1. **API Key 安全**：使用模型配置中的加密 API Key
2. **错误处理**：网络失败、认证失败等情况都有友好提示
3. **倒计时更新**：用量模式下每分钟自动更新显示
4. **百分比计算**：
   - Token Plan 类型：根据 used/limit 计算
   - Balance 类型：假设总额度计算（可配置）

## 文件清单

### 后端文件
- `src-tauri/src/services/usage_providers/mod.rs` - 主模块
- `src-tauri/src/services/usage_providers/deepseek.rs` - DeepSeek
- `src-tauri/src/services/usage_providers/kimi.rs` - Kimi
- `src-tauri/src/services/usage_providers/openrouter.rs` - OpenRouter
- `src-tauri/src/services/usage_providers/siliconflow.rs` - SiliconFlow
- `src-tauri/src/services/usage_providers/stepfun.rs` - StepFun
- `src-tauri/src/services/usage_providers/zhipu.rs` - Zhipu
- `src-tauri/src/commands/model_commands.rs` - 添加 command
- `src-tauri/src/services/mod.rs` - 注册模块
- `src-tauri/src/lib.rs` - 注册 command

### 前端文件
- `src/pages/ModelNexus/context.ts` - 类型定义和 Context
- `src/pages/ModelNexus/ModelNexus.tsx` - Provider 和组件
- `src/components/cards/ModelCard.tsx` - 卡片组件
- `src/api/models.ts` - API 定义
- `src/i18n/en.ts` - 英文翻译
- `src/i18n/zh-Hans.ts` - 中文翻译

## 后续优化建议

1. **缓存机制**：添加用量数据缓存，避免频繁请求
2. **自动刷新**：支持定时自动刷新用量
3. **更多厂商**：继续添加 MiniMax、Novita AI、火山方舟等
4. **更精准的百分比**：允许用户配置总额度
5. **历史记录**：记录用量历史，绘制趋势图
