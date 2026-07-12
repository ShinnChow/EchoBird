# 🎉 模型用量查询功能 - 完整实现

## ✅ 已完成

我们已经**完全实现** cc-switch 支持的所有用量查询厂商！

## 📊 支持的厂商列表

### Balance 类型（余额查询）- 5个

| # | 厂商 | 匹配规则 | 状态 |
|---|------|---------|------|
| 1 | **DeepSeek** | `api.deepseek.com` | ✅ |
| 2 | **StepFun** | `api.stepfun.ai` / `api.stepfun.com` | ✅ |
| 3 | **SiliconFlow** | `api.siliconflow.cn` / `api.siliconflow.com` | ✅ |
| 4 | **OpenRouter** | `openrouter.ai` | ✅ |
| 5 | **Novita AI** | `api.novita.ai` | ✅ |

### Token Plan 类型（套餐额度）- 5个

| # | 厂商 | 匹配规则 | 特性 | 状态 |
|---|------|---------|------|------|
| 1 | **Kimi For Coding** | `api.kimi.com/coding` | 5小时窗口 + 周限额 | ✅ |
| 2 | **智谱 GLM** | `bigmodel.cn` / `api.z.ai` | 多窗口限额 | ✅ |
| 3 | **火山引擎** | `volces.com/api/coding` | 当前会话 + 近1周 + 近1月 | ✅ |
| 4 | **MiniMax** | `api.minimaxi.com` / `api.minimax.io` | 多时间窗口 | ✅ |
| 5 | **ZenMux** | `zenmux` | 小时/日限额 | ✅ |

### 总计：10个厂商 🎯

---

## 📁 项目文件结构

```
后端 Rust (11个文件):
src-tauri/src/services/usage_providers/
├── mod.rs              # 主模块，定义 trait 和检测逻辑
├── deepseek.rs         # DeepSeek 实现
├── kimi.rs             # Kimi For Coding 实现
├── minimax.rs          # MiniMax 实现 (新增)
├── novita.rs           # Novita AI 实现 (新增)
├── openrouter.rs       # OpenRouter 实现
├── siliconflow.rs      # SiliconFlow 实现
├── stepfun.rs          # StepFun 实现
├── volcengine.rs       # 火山引擎 实现 (新增)
├── zenmux.rs           # ZenMux 实现 (新增)
└── zhipu.rs            # 智谱 GLM 实现

命令层:
├── src-tauri/src/commands/model_commands.rs  # 添加 query_model_usage
├── src-tauri/src/services/mod.rs             # 注册 usage_providers
└── src-tauri/src/lib.rs                      # 注册 command

前端 TypeScript (5个文件):
├── src/pages/ModelNexus/context.ts           # 类型定义
├── src/pages/ModelNexus/ModelNexus.tsx       # 主组件
├── src/components/cards/ModelCard.tsx        # 卡片组件
├── src/api/models.ts                         # API 调用
├── src/i18n/en.ts                            # 英文翻译
└── src/i18n/zh-Hans.ts                       # 中文翻译
```

---

## 🏗️ 架构特点

### 1. 模块化设计
- 每个厂商独立文件
- 统一 `UsageProvider` trait
- 便于维护和扩展

### 2. 自动检测
```rust
pub fn detect_provider(base_url: &str) -> Option<Box<dyn UsageProvider + Send + Sync>>
```
根据模型的 `base_url` 自动识别厂商，无需手动配置

### 3. 统一数据格式
```typescript
interface UsageQuota {
  percentage: number;    // 0-100 使用百分比
  resetAt: number;       // 重置时间（毫秒）
  label?: string;        // 标签（如 "5 Hours", "Weekly"）
}
```

### 4. 友好的错误处理
- 网络错误
- 认证失败
- API 错误
- 数据解析错误

---

## 🎨 用户体验

### 界面特性
1. **配置/用量 双模式**
   - 配置模式：显示模型信息
   - 用量模式：显示进度条

2. **实时倒计时**
   - 自动计算剩余时间
   - 每分钟更新显示
   - 格式：`5天12时20分钟后刷新`

3. **多进度条支持**
   - 支持 1-3 条进度条
   - 每条独立显示百分比和倒计时

4. **刷新按钮**
   - 一键刷新所有模型用量
   - 显示加载状态

---

## 🚀 使用方法

### 1. 添加支持的模型
在模型管理中添加任意一个支持的厂商：
- 填写 API Key
- 填写 Base URL（自动检测厂商）

### 2. 查看用量
- 切换到"用量"标签
- 点击"🔄 刷新用量"按钮
- 查看进度条和倒计时

### 3. 支持的场景
- ✅ 余额查询（DeepSeek、StepFun 等）
- ✅ Token Plan（Kimi、智谱、火山引擎等）
- ✅ 多时间窗口（5小时、日、周、月）

---

## 🔧 技术细节

### 后端 API 调用
```rust
#[tauri::command]
pub async fn query_model_usage(internal_id: String) -> Result<UsageResult, String>
```

### 前端 API 调用
```typescript
export async function queryModelUsage(internalId: string): Promise<UsageResult>
```

### 数据流
```
用户点击刷新 → 前端调用 API → 后端检测厂商 
→ 调用厂商 API → 解析数据 → 返回前端 → 显示进度条
```

---

## 📝 与 cc-switch 的对比

| 特性 | cc-switch | EchoBird | 说明 |
|------|-----------|----------|------|
| 支持厂商数 | 10个 | 10个 | ✅ 完全一致 |
| 架构设计 | 模块化 | 模块化 | ✅ 相同理念 |
| 自动检测 | ✅ | ✅ | URL 匹配 |
| 多窗口支持 | ✅ | ✅ | 1-3条进度条 |
| 倒计时显示 | ✅ | ✅ | 实时更新 |
| 国际化 | ✅ | ✅ | 中英文 |

---

## 🎯 下一步建议

### 1. 缓存机制
- 避免频繁查询
- 保存最近一次结果
- 设置过期时间

### 2. 自动刷新
- 定时自动查询
- 用户可配置间隔

### 3. 用量历史
- 记录历史数据
- 绘制趋势图表

### 4. 通知提醒
- 用量达到阈值时提醒
- 即将耗尽时预警

---

## ✨ 总结

我们已经**完全实现** cc-switch 支持的所有用量查询功能：

- ✅ **10个厂商** - 全部支持
- ✅ **模块化架构** - 易于扩展
- ✅ **自动检测** - 无需配置
- ✅ **友好界面** - 进度条 + 倒计时
- ✅ **国际化** - 中英文支持

**准备就绪，可以编译运行！** 🚀
