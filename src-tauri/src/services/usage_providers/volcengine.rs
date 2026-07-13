//! Volcengine (火山方舟) usage provider
//!
//! 火山引擎的用量查询需要控制台 AK/SK 认证和签名算法，
//! 不同于其他厂商的简单 Bearer Token 方式，暂不支持。

use super::{UsageProvider, UsageResult};

pub struct VolcengineProvider;

#[async_trait::async_trait]
impl UsageProvider for VolcengineProvider {
    async fn query_usage(&self, _api_key: &str, _base_url: &str) -> Result<UsageResult, String> {
        // 火山引擎的用量查询需要：
        // 1. 调用控制台 API (open.volcengineapi.com)，不是推理 API
        // 2. 使用 AK/SK 认证 + 火山引擎签名 V4 算法
        // 3. 调用 GetCodingPlanUsage 或 GetAFPUsage 接口
        //
        // 这与其他厂商完全不同，需要单独实现。暂时返回友好提示。
        Ok(UsageResult {
            success: false,
            data: None,
            error: Some(
                "火山引擎用量查询需要控制台 AK/SK 认证，暂不支持。请前往火山引擎控制台查看用量。"
                    .to_string(),
            ),
        })
    }

    fn can_handle(&self, base_url: &str) -> bool {
        base_url.contains("volces.com") || base_url.contains("volcengine.com")
    }

    fn name(&self) -> &'static str {
        "Volcengine"
    }
}
