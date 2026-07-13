//! Sub2Api usage provider
//!
//! Sub2Api is the backend used by many AI relay/proxy sites (e.g. cc-vibe.com).
//! GET {base}/v1/usage with Bearer api-key returns:
//! { planName, unit, usage: { total: { actual_cost, requests, ... }, today: {...} } }
//!
//! This is a fallback provider (can_handle always true) - it sits last in
//! detect_provider so official providers (DeepSeek/Kimi/...) match first.
//! Any unmatched base_url (relay/proxy) is tried against /v1/usage; if the
//! site runs sub2api it returns 200, otherwise 404 and we report not-supported.

use super::{now_millis, parse_f64, ModelUsageData, UsageProvider, UsageQuota, UsageResult};
use reqwest;
use std::time::Duration;

pub struct Sub2ApiProvider;

/// Build the /v1/usage endpoint from a base_url.
/// cc-vibe.com/v1 (OpenAI) or cc-vibe.com (Anthropic) both -> https://cc-vibe.com/v1/usage
fn build_usage_url(base_url: &str) -> String {
    if let Ok(u) = url::Url::parse(base_url) {
        if let Some(host) = u.host_str() {
            return format!("{}://{}/v1/usage", u.scheme(), host);
        }
    }
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{}/usage", trimmed)
    } else {
        format!("{}/v1/usage", trimmed)
    }
}

/// Extract the first number from a plan name (e.g. "日卡 每日200刀" -> 200).
fn parse_plan_limit(plan_name: &str) -> f64 {
    let mut num = String::new();
    let mut started = false;
    for c in plan_name.chars() {
        if c.is_ascii_digit() || (c == '.' && started) {
            num.push(c);
            started = true;
        } else if started {
            break;
        }
    }
    num.parse().unwrap_or(0.0)
}

#[async_trait::async_trait]
impl UsageProvider for Sub2ApiProvider {
    async fn query_usage(&self, api_key: &str, base_url: &str) -> Result<UsageResult, String> {
        let usage_url = build_usage_url(base_url);
        let client = reqwest::Client::new();
        let resp = client
            .get(&usage_url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Accept", "application/json")
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Ok(UsageResult {
                success: false,
                data: None,
                error: Some(format!("Authentication failed (HTTP {})", status)),
            });
        }
        if !status.is_success() {
            // Not a sub2api endpoint (404 etc) - silently report no data.
            return Ok(UsageResult {
                success: false,
                data: None,
                error: Some(format!("Not a sub2api endpoint (HTTP {})", status)),
            });
        }

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let total = body.get("usage").and_then(|u| u.get("total"));
        let actual_cost = total
            .and_then(|u| u.get("actual_cost"))
            .and_then(parse_f64)
            .unwrap_or(0.0);
        let plan_name = body
            .get("planName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let unit = body
            .get("unit")
            .and_then(|v| v.as_str())
            .unwrap_or("USD")
            .to_string();
        let plan_limit = parse_plan_limit(&plan_name);
        let percentage = if plan_limit > 0.0 {
            (actual_cost / plan_limit * 100.0).clamp(0.0, 100.0)
        } else {
            0.0
        };
        // Label as "$used / $limit" so the card shows e.g. "$200.40 / $200.00".
        let label = if plan_limit > 0.0 {
            Some(format!("${:.2} / ${:.2}", actual_cost, plan_limit))
        } else {
            Some(plan_name.clone())
        };
        // Approximate reset from plan name (日/周/月). sub2api returns no reset time.
        let reset_at = if plan_name.contains('月') {
            now_millis() + 30 * 24 * 60 * 60 * 1000
        } else if plan_name.contains('周') {
            now_millis() + 7 * 24 * 60 * 60 * 1000
        } else {
            now_millis() + 24 * 60 * 60 * 1000 // 日卡 or unknown -> 24h
        };
        // unit is unused now (label carries the $ figure).
        let _ = unit;

        Ok(UsageResult {
            success: true,
            data: Some(ModelUsageData {
                quotas: vec![UsageQuota {
                    percentage,
                    reset_at,
                    label,
                    balance: None,
                    balance_unit: None,
                }],
                last_updated: Some(now_millis()),
            }),
            error: None,
        })
    }

    fn can_handle(&self, _base_url: &str) -> bool {
        // Fallback: try any base_url not matched by official providers above.
        true
    }

    fn name(&self) -> &'static str {
        "Sub2Api"
    }
}
