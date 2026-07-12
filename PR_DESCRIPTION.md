# 用量查询功能 (Model Usage Query)

## 📋 功能概述

为模型中心添加用量查询功能，用户可以实时查看各大模型厂商的配额使用情况和余额信息。

---

## ✨ 新增功能

### 1. 用量查询支持 9 个主流厂商

- ✅ **Kimi** (月之暗面) - 支持每日/每月配额查询
- ✅ **智谱 AI** (GLM) - 支持配额百分比显示
- ✅ **MiniMax** - 支持用量查询
- ✅ **ZenMux** - 支持用量查询
- ✅ **DeepSeek** - 支持余额显示（CNY）
- ✅ **StepFun** (阶跃星辰) - 支持配额查询
- ✅ **SiliconFlow** (硅基流动) - 支持用量查询
- ✅ **OpenRouter** - 支持余额显示（USD/Credits）
- ✅ **Novita** - 支持用量查询

### 2. 双模式卡片视图

**配置模式**（原有功能）
- 显示模型配置信息
- [删除] 和 [编辑] 按钮
- 显示协议标签（OpenAI/Anthropic）
- 显示延迟信息

**用量模式**（新功能）
- 显示厂商 Logo
- [刷新] 按钮 - 单独刷新该模型用量
- 用量进度条（百分比显示）
- 余额显示（支持的厂商）
- 重置时间倒计时

### 3. 用量数据可视化

**进度条模式**（配额制厂商）
```
已使用 45.2% ──────────●───── 重置于 23小时后
```

**余额模式**（余额制厂商）
```
余额 ¥10.50 CNY
```

### 4. 智能刷新机制

- **全局刷新** - 点击顶部"刷新用量"按钮，刷新所有模型
- **单个刷新** - 点击卡片上的 [刷新] 按钮，只刷新当前模型
- **自动缓存** - 避免重复请求

---

## 🏗️ 技术实现

### 后端 (Rust)

#### 1. 新增模块：`usage_providers`

```
src-tauri/src/services/usage_providers/
├── mod.rs           # 统一入口和提供商检测
├── kimi.rs          # 月之暗面
├── zhipu.rs         # 智谱 AI
├── minimax.rs       # MiniMax
├── zenmux.rs        # ZenMux
├── deepseek.rs      # DeepSeek
├── stepfun.rs       # 阶跃星辰
├── siliconflow.rs   # 硅基流动
├── openrouter.rs    # OpenRouter
├── novita.rs        # Novita
└── volcengine.rs    # 火山引擎（暂不支持）
```

**核心结构：**
```rust
pub struct UsageQuota {
    pub percentage: f64,       // 0-100
    pub reset_at: i64,         // Unix timestamp (ms)
    pub label: Option<String>, // "Hourly", "Daily", "Monthly"
    pub balance: Option<f64>,  // 余额
    pub balance_unit: Option<String>, // "USD", "CNY"
}

pub struct ModelUsageData {
    pub quotas: Vec<UsageQuota>, // 1-3个配额条
    pub last_updated: Option<i64>,
}

pub struct UsageResult {
    pub success: bool,
    pub data: Option<ModelUsageData>,
    pub error: Option<String>,
}
```

#### 2. 新增命令：`query_model_usage`

```rust
#[tauri::command]
pub async fn query_model_usage(internal_id: String) -> Result<UsageResult, String>
```

- 根据 `internal_id` 查找模型配置
- 提取 `base_url` 和 `api_key`
- 自动检测厂商并调用对应的 provider
- 返回统一的 `UsageResult` 结构

#### 3. 厂商自动检测机制

```rust
fn detect_provider(base_url: &str) -> Option<Provider> {
    if kimi::KimiProvider.can_handle(&url) {
        return Some(Provider::Kimi(...));
    }
    if zhipu::ZhipuProvider.can_handle(&url) {
        return Some(Provider::Zhipu(...));
    }
    // ... 其他厂商
}
```

### 前端 (React + TypeScript)

#### 1. API 层扩展

**src/api/models.ts**
```typescript
export interface UsageQuota {
  percentage: number;
  resetAt: number;
  label?: string;
  balance?: number;
  balanceUnit?: string;
}

export interface ModelUsageData {
  quotas: UsageQuota[];
  lastUpdated?: number;
}

export async function queryModelUsage(internalId: string): Promise<UsageResult>
```

#### 2. ModelCard 组件增强

**新增 Props：**
- `viewMode: 'config' | 'usage'` - 视图模式
- `usageData?: ModelUsageData` - 用量数据
- `onRefresh?: () => void` - 刷新回调

**新增渲染逻辑：**
- 根据 `viewMode` 切换显示内容
- 用量模式显示进度条或余额
- 配置模式显示原有信息

#### 3. Context 状态管理

**新增状态：**
```typescript
const [viewMode, setViewMode] = useState<'config' | 'usage'>('config');
const [modelUsageData, setModelUsageData] = useState<Record<string, ModelUsageData>>({});
const [isRefreshingUsage, setIsRefreshingUsage] = useState(false);
```

**新增方法：**
- `refreshAllUsage()` - 刷新所有模型用量
- `refreshSingleUsage(modelId)` - 刷新单个模型用量

#### 4. UI 优化

- 顶部添加"配置/用量"切换标签
- 顶部添加"刷新用量"按钮（用量模式）
- 卡片上添加 [刷新] 按钮
- 用量进度条样式优化
- 倒计时显示优化

---

## 📝 代码变更统计

```
12 files changed, 423 insertions(+), 110 deletions(-)

Modified:
 - package-lock.json                        
 - src-tauri/Cargo.lock                     
 - src-tauri/Cargo.toml                     (+2 lines: hex, async-trait)
 - src-tauri/src/commands/model_commands.rs (+25 lines: query_model_usage)
 - src-tauri/src/lib.rs                     (+1 line: register command)
 - src-tauri/src/services/mod.rs            (+1 line: pub mod usage_providers)
 - src/api/models.ts                        (+21 lines: types + API)
 - src/components/cards/ModelCard.tsx       (+288 lines: dual mode)
 - src/i18n/en.ts                           (+4 lines)
 - src/i18n/zh-Hans.ts                      (+4 lines)
 - src/pages/ModelNexus/ModelNexus.tsx      (+152 lines: state + logic)
 - src/pages/ModelNexus/context.ts          (+29 lines: types)

Added:
 + src-tauri/src/services/usage_providers/  (11 files)
```

---

## 🧪 测试建议

### 手动测试清单

1. **切换视图模式**
   - [ ] 点击"配置"标签，确认显示配置模式
   - [ ] 点击"用量"标签，确认显示用量模式

2. **全局刷新**
   - [ ] 在用量模式点击"刷新用量"按钮
   - [ ] 确认所有支持的厂商卡片显示用量数据

3. **单个刷新**
   - [ ] 点击任意卡片的 [刷新] 按钮
   - [ ] 确认只刷新该卡片的用量数据

4. **用量显示**
   - [ ] 配额制厂商显示进度条 + 百分比
   - [ ] 余额制厂商显示余额 + 单位
   - [ ] 倒计时显示正确（X小时后 / X天后）

5. **错误处理**
   - [ ] API Key 无效时显示错误提示
   - [ ] 不支持的厂商显示友好提示
   - [ ] 网络错误时显示错误信息

---

## ⚠️ 已知限制

1. **火山引擎（Volcengine）暂不支持**
   - 原因：需要复杂的 AK/SK 签名认证
   - 当前行为：返回友好提示"请前往火山引擎控制台查看用量"
   - 未来改进：可参考 CodexBar 在设置中添加全局 AK/SK 配置

2. **用量数据不持久化**
   - 刷新页面后用量数据会清空
   - 需要重新点击刷新按钮

3. **缓存机制简单**
   - 当前只有内存缓存
   - 未实现自动定时刷新

---

## 🔮 未来改进方向

1. **数据持久化**
   - 将用量数据保存到本地缓存
   - 页面刷新后自动恢复

2. **自动刷新**
   - 添加定时自动刷新功能
   - 用户可配置刷新间隔

3. **火山引擎支持**
   - 在设置页面添加全局 AK/SK 配置
   - 实现火山引擎签名算法

4. **更多厂商支持**
   - 百度千帆
   - 阿里云通义
   - 腾讯混元
   - 其他中转服务

5. **用量统计**
   - 添加用量趋势图表
   - 用量预警功能
   - 成本分析

---

## 📚 参考资料

- 各厂商 API 文档
- CodexBar 项目：https://github.com/steipete/CodexBar
- Rust async-trait: https://docs.rs/async-trait
- Tauri Commands: https://tauri.app/v1/guides/features/command

---

## 👥 贡献者

- @edison7009 - 需求提出和测试
- @claude-opus-4.8 - 功能实现和文档

---

## 📄 License

MIT
