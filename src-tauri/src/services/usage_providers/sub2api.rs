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
use chrono::TimeZone;
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

/// Parse an RFC-3339 timestamp (e.g. "2026-07-17T17:27:45+08:00") to unix ms.
fn parse_iso_ms(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

/// Daily quota resets at next midnight in CC Vibe's timezone (CST, +08:00).
/// Uses `daily_usage[0].date` when available; falls back to now+24h.
fn daily_reset_ms(body: &serde_json::Value) -> i64 {
    let cst = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
    let today = body
        .get("daily_usage")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|d| d.get("date"))
        .and_then(|v| v.as_str())
        .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    match today {
        Some(d) => {
            let next = d + chrono::Duration::days(1);
            match cst
                .from_local_datetime(&next.and_hms_opt(0, 0, 0).unwrap())
                .single()
            {
                Some(dt) => dt.timestamp_millis(),
                None => now_millis() + 24 * 60 * 60 * 1000,
            }
        }
        None => now_millis() + 24 * 60 * 60 * 1000,
    }
}

/// Build one quota bar per enforced limit found in the `subscription` object
/// (daily/weekly/monthly). sub2api populates only the limits a plan enforces,
/// so a 天卡 yields 1 bar (daily) and a 月卡 yields 3 (daily+weekly+monthly).
/// Returns None when there is no subscription or no usable limit, so the
/// caller can fall back to the plan-name heuristic.
fn parse_subscription_quotas(body: &serde_json::Value) -> Option<Vec<UsageQuota>> {
    let sub = body.get("subscription")?;
    let mut quotas: Vec<UsageQuota> = Vec::new();
    let week_ms = 7 * 24 * 60 * 60 * 1000;
    let month_ms = 30 * 24 * 60 * 60 * 1000;
    let pct = |usage: f64, limit: f64| (usage / limit * 100.0).clamp(0.0, 100.0);

    if let Some(limit) = sub.get("daily_limit_usd").and_then(parse_f64) {
        if limit > 0.0 {
            let usage = sub.get("daily_usage_usd").and_then(parse_f64).unwrap_or(0.0);
            quotas.push(UsageQuota {
                percentage: pct(usage, limit),
                reset_at: daily_reset_ms(body),
                label: None,
                balance: None,
                balance_unit: None,
            });
        }
    }

    if let Some(limit) = sub.get("weekly_limit_usd").and_then(parse_f64) {
        if limit > 0.0 {
            let usage = sub.get("weekly_usage_usd").and_then(parse_f64).unwrap_or(0.0);
            let reset = sub
                .get("weekly_window_start")
                .and_then(|v| v.as_str())
                .and_then(parse_iso_ms)
                .map(|ms| ms + week_ms)
                .unwrap_or_else(|| now_millis() + week_ms);
            quotas.push(UsageQuota {
                percentage: pct(usage, limit),
                reset_at: reset,
                label: None,
                balance: None,
                balance_unit: None,
            });
        }
    }

    if let Some(limit) = sub.get("monthly_limit_usd").and_then(parse_f64) {
        if limit > 0.0 {
            let usage = sub
                .get("monthly_usage_usd")
                .and_then(parse_f64)
                .unwrap_or(0.0);
            let reset = sub
                .get("expires_at")
                .and_then(|v| v.as_str())
                .and_then(parse_iso_ms)
                .unwrap_or_else(|| now_millis() + month_ms);
            quotas.push(UsageQuota {
                percentage: pct(usage, limit),
                reset_at: reset,
                label: None,
                balance: None,
                balance_unit: None,
            });
        }
    }

    if quotas.is_empty() {
        None
    } else {
        Some(quotas)
    }
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

        // Prefer the structured `subscription` object: it carries explicit
        // per-window limits (daily/weekly/monthly), so we render one bar per
        // enforced limit (天卡=daily only, 月卡=daily+weekly+monthly).
        if let Some(quotas) = parse_subscription_quotas(&body) {
            return Ok(UsageResult {
                success: true,
                data: Some(ModelUsageData {
                    quotas,
                    last_updated: Some(now_millis()),
                }),
                error: None,
            });
        }

        // Fallback (older/non-standard sub2api): single bar from total cost vs
        // the limit parsed out of the plan name.
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
        let plan_limit = parse_plan_limit(&plan_name);
        let percentage = if plan_limit > 0.0 {
            (actual_cost / plan_limit * 100.0).clamp(0.0, 100.0)
        } else {
            0.0
        };
        // Reset window from plan name (日/周/月). sub2api returns no reset time.
        let reset_at = if plan_name.contains('月') {
            now_millis() + 30 * 24 * 60 * 60 * 1000
        } else if plan_name.contains('周') {
            now_millis() + 7 * 24 * 60 * 60 * 1000
        } else {
            now_millis() + 24 * 60 * 60 * 1000
        };

        Ok(UsageResult {
            success: true,
            data: Some(ModelUsageData {
                quotas: vec![UsageQuota {
                    percentage,
                    reset_at,
                    label: None,
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn monthly_card_yields_three_bars() {
        let body = json!({
            "planName": "月卡 每日200刀",
            "unit": "USD",
            "subscription": {
                "daily_limit_usd": 200, "daily_usage_usd": 96.12,
                "weekly_limit_usd": 1400, "weekly_usage_usd": 96.12,
                "monthly_limit_usd": 6000, "monthly_usage_usd": 96.12,
                "weekly_window_start": "2026-07-14T00:00:00+08:00",
                "expires_at": "2026-07-17T17:27:45+08:00"
            },
            "daily_usage": [{ "date": "2026-07-14" }],
            "usage": { "total": { "actual_cost": 96.12 } }
        });
        let quotas = parse_subscription_quotas(&body).expect("subscription present");
        assert_eq!(quotas.len(), 3);
        assert!(quotas[0].label.is_none());
        assert!((quotas[0].percentage - 48.06).abs() < 0.1);
        assert!(quotas[1].label.is_none());
        assert!((quotas[1].percentage - 6.87).abs() < 0.1);
        assert!(quotas[2].label.is_none());
        assert!((quotas[2].percentage - 1.60).abs() < 0.1);
    }

    #[test]
    fn day_card_yields_one_bar_when_only_daily_limit() {
        let body = json!({
            "planName": "天卡 每日200刀",
            "subscription": {
                "daily_limit_usd": 200, "daily_usage_usd": 50.0
            },
            "daily_usage": [{ "date": "2026-07-14" }]
        });
        let quotas = parse_subscription_quotas(&body).expect("subscription present");
        assert_eq!(quotas.len(), 1);
        assert!(quotas[0].label.is_none());
        assert!((quotas[0].percentage - 25.0).abs() < 0.01);
    }

    #[test]
    fn zero_or_absent_limits_are_skipped() {
        let body = json!({
            "subscription": {
                "daily_limit_usd": 200, "daily_usage_usd": 10.0,
                "weekly_limit_usd": 0, "monthly_limit_usd": 0
            },
            "daily_usage": [{ "date": "2026-07-14" }]
        });
        let quotas = parse_subscription_quotas(&body).expect("subscription present");
        assert_eq!(quotas.len(), 1);
    }

    #[test]
    fn no_subscription_falls_back_to_none() {
        let body = json!({
            "planName": "X",
            "usage": { "total": { "actual_cost": 10.0 } }
        });
        assert!(parse_subscription_quotas(&body).is_none());
    }
}
