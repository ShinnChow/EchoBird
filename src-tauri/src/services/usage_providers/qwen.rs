//! Qwen / Aliyun Bailian (Model Studio) coding-plan usage provider.
//!
//! Queries the Coding Plan quota via the Aliyun console data-gateway RPC
//! `queryCodingPlanInstanceInfoV2`. Aliyun publishes no official programmatic
//! quota API, so this mirrors the reverse-engineered console endpoint used
//! by cli-pulse-desktop and CodexBar (reference implementations).
//!
//! Auth reuses the inference DashScope API key (Bearer + `x-api-key` +
//! `X-DashScope-API-Key`) — unlike Volcengine, no separate AK/SK and no
//! Sig V4 signing are needed, and no per-model credential store. Up to
//! three quota windows are returned (5-hour / weekly / monthly), matching
//! the shape the UI already renders for Volcengine.
//!
//! Region routing: the bundled Qwen directory entry points at the
//! cn-beijing token-plan host, so CN is tried first; Intl is the fallback.
//! Two commodity-code variants exist in the wild (`broadscope-bailian` and
//! `sfm_codingplan_public`); both are tried so we cover either account
//! shape without extra config.
//!
//! Known limitation: some China-mainland accounts return `ConsoleNeedLogin`
//! even with a valid API key (the console endpoint then requires a browser
//! cookie session, which we do not replicate). In that case we degrade to
//! "no usage data" rather than fabricating zeros — same best-effort stance
//! as the Volcengine provider.

use super::{now_millis, ModelUsageData, UsageProvider, UsageQuota, UsageResult};
use serde_json::{json, Value};
use std::time::Duration;

const HOST_CN: &str = "https://bailian.console.aliyun.com";
const HOST_INTL: &str = "https://modelstudio.console.alibabacloud.com";
const COMMODITY_CN: &str = "broadscope-bailian";
const COMMODITY_INTL: &str = "broadscope-bailian-intl";
// Alternate commodity codes seen in some accounts (the `sfm_codingplan_*`
// form). Tried only if the primary codes yield no quota.
const COMMODITY_CN_ALT: &str = "sfm_codingplan_public_cn";
const COMMODITY_INTL_ALT: &str = "sfm_codingplan_public_intl";
const API_PATH: &str = "/data/api.json?action=zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2&product=broadscope-bailian&api=queryCodingPlanInstanceInfoV2";
const TIMEOUT: Duration = Duration::from_secs(15);

/// Ordered (host, commodity) attempts. CN first (matches the bundled
/// directory host), Intl fallback; alternate commodity codes last so the
/// primary shape wins when both would answer.
const ATTEMPTS: [(&str, &str); 4] = [
    (HOST_CN, COMMODITY_CN),
    (HOST_INTL, COMMODITY_INTL),
    (HOST_CN, COMMODITY_CN_ALT),
    (HOST_INTL, COMMODITY_INTL_ALT),
];

pub struct QwenProvider;

#[async_trait::async_trait]
impl UsageProvider for QwenProvider {
    async fn query_usage(&self, api_key: &str, _base_url: &str) -> Result<UsageResult, String> {
        let client = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .build()
            .map_err(|e| format!("Network error: {}", e))?;

        let mut last_err: Option<String> = None;
        for (host, commodity) in ATTEMPTS {
            match fetch_and_parse(&client, api_key, host, commodity).await {
                Ok(Some(data)) => {
                    return Ok(UsageResult {
                        success: true,
                        data: Some(data),
                        error: None,
                    });
                }
                Ok(None) => {
                    // Well-formed response with no usable quota — try the
                    // next (host, commodity) combination.
                    last_err = Some("No coding plan quota data".to_string());
                }
                Err(e) => {
                    // Auth-class errors are account-wide — short-circuit
                    // instead of burning every combination with bad/expired
                    // credentials. Mirrors the Volcengine provider.
                    if is_auth_error(&e) {
                        return Ok(UsageResult {
                            success: false,
                            data: None,
                            error: Some(e),
                        });
                    }
                    last_err = Some(e);
                }
            }
        }

        Ok(UsageResult {
            success: false,
            data: None,
            error: last_err,
        })
    }

    fn can_handle(&self, base_url: &str) -> bool {
        base_url.contains("maas.aliyuncs.com")
            || base_url.contains("dashscope.aliyuncs.com")
            || base_url.contains("bailian")
    }

    fn name(&self) -> &'static str {
        "Qwen"
    }
}

async fn fetch_and_parse(
    client: &reqwest::Client,
    api_key: &str,
    host: &str,
    commodity: &str,
) -> Result<Option<ModelUsageData>, String> {
    let body = json!({
        "queryCodingPlanInstanceInfoRequest": { "commodityCode": commodity }
    });
    let resp = client
        .post(format!("{host}{API_PATH}"))
        .header("Authorization", format!("Bearer {api_key}"))
        .header("x-api-key", api_key)
        .header("X-DashScope-API-Key", api_key)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(format!("Authentication failed (HTTP {})", status));
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API error (HTTP {}): {}", status, body));
    }

    let value: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    parse_quota(&value)
}

/// Parse `codingPlanInstanceInfos[].codingPlanQuotaInfo` into up to three
/// `UsageQuota` windows. `Ok(None)` means a well-formed response carrying
/// no usable quota (caller tries the next combination); `Err` means an
/// auth or structural error.
fn parse_quota(value: &Value) -> Result<Option<ModelUsageData>, String> {
    // Top-level error envelope.
    let top_code = value.get("code").and_then(|v| v.as_str()).unwrap_or("");
    if !top_code.is_empty() && top_code != "200" {
        if top_code == "401" || top_code == "403" {
            return Err("Authentication failed (API code 401/403)".to_string());
        }
        let msg = value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or(top_code);
        if msg.to_lowercase().contains("login") {
            // Console-session required (some CN accounts even with a valid
            // API key). Not an auth-class error — Intl/alt may still work,
            // so surface as a non-auth Err and let the sweep continue.
            return Err("ConsoleNeedLogin".to_string());
        }
        return Err(format!("API error: {}", msg));
    }

    // Console-internal `ret[]` carries auth signals (No Authority / NeedLogin).
    if let Some(ret) = value.pointer("/data/DataV2/ret").and_then(|v| v.as_array()) {
        let joined: String = ret
            .iter()
            .filter_map(|v| v.as_str())
            .collect::<Vec<_>>()
            .join(";");
        let lower = joined.to_lowercase();
        if lower.contains("no authority")
            || lower.contains("needlogin")
            || lower.contains("10032390")
        {
            return Err("Authentication failed (No Authority / NeedLogin)".to_string());
        }
    }

    // codingPlanInstanceInfos lives at /data/... (cli-pulse shape) or nested
    // deeper under /data/DataV2/data/data/... (ceiling shape). Try both.
    let instances = value
        .pointer("/data/codingPlanInstanceInfos")
        .and_then(|v| v.as_array())
        .or_else(|| {
            value
                .pointer("/data/DataV2/data/data/codingPlanInstanceInfos")
                .and_then(|v| v.as_array())
        });
    let instances = match instances {
        Some(a) if !a.is_empty() => a,
        _ => return Ok(None),
    };

    // Prefer a VALID instance; fall back to the first (ceiling behavior).
    let instance = instances
        .iter()
        .find(|i| i.get("status").and_then(|s| s.as_str()) == Some("VALID"))
        .or_else(|| instances.first())
        .unwrap();

    let quota = instance.get("codingPlanQuotaInfo").unwrap_or(&Value::Null);

    let five_h = window(
        quota,
        "per5HourUsedQuota",
        "per5HourTotalQuota",
        "per5HourQuotaNextRefreshTime",
    )
    .or_else(|| {
        window(
            quota,
            "perFiveHourUsedQuota",
            "perFiveHourTotalQuota",
            "perFiveHourQuotaNextRefreshTime",
        )
    });
    let weekly = window(
        quota,
        "perWeekUsedQuota",
        "perWeekTotalQuota",
        "perWeekQuotaNextRefreshTime",
    );
    let monthly = window(
        quota,
        "perBillMonthUsedQuota",
        "perBillMonthTotalQuota",
        "perBillMonthQuotaNextRefreshTime",
    )
    .or_else(|| {
        window(
            quota,
            "perMonthUsedQuota",
            "perMonthTotalQuota",
            "perMonthQuotaNextRefreshTime",
        )
    });

    let mut quotas: Vec<UsageQuota> = Vec::new();
    if let Some(q) = five_h {
        quotas.push(q);
    }
    if let Some(q) = weekly {
        quotas.push(q);
    }
    if let Some(q) = monthly {
        quotas.push(q);
    }

    if quotas.is_empty() {
        return Ok(None);
    }

    Ok(Some(ModelUsageData {
        quotas,
        last_updated: Some(now_millis()),
    }))
}

/// Build one `UsageQuota` window. `None` when `total` is absent or
/// non-positive (a window with no quota counter is not worth rendering);
/// `used` defaults to 0 when missing.
fn window(quota: &Value, used_key: &str, total_key: &str, reset_key: &str) -> Option<UsageQuota> {
    let total = num(quota, total_key)?;
    if total <= 0.0 {
        return None;
    }
    let used = num(quota, used_key).unwrap_or(0.0);
    let percentage = (used / total * 100.0).clamp(0.0, 100.0);
    let reset_at = quota.get(reset_key).and_then(parse_reset_ms).unwrap_or(0);
    Some(UsageQuota {
        percentage,
        reset_at,
        balance: None,
        balance_unit: None,
    })
}

/// Tolerant numeric read (JSON int, float, or numeric string).
fn num(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| {
        x.as_f64()
            .or_else(|| x.as_str().and_then(|s| s.parse().ok()))
    })
}

/// Parse a reset timestamp into Unix milliseconds. Accepts ms-epoch
/// (>1e12), second-epoch (>1e9), RFC3339/ISO8601 strings, and
/// `yyyy-MM-dd HH:mm(:ss)` / bare `yyyy-MM-dd` strings.
fn parse_reset_ms(v: &Value) -> Option<i64> {
    if let Some(n) = v.as_i64() {
        if n > 1_000_000_000_000 {
            return Some(n); // ms epoch
        }
        if n > 1_000_000_000 {
            return Some(n * 1000); // second epoch
        }
        return Some(n); // already ms-scale
    }
    let s = v.as_str()?;
    parse_str_to_ms(s)
}

fn parse_str_to_ms(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    // RFC3339 / ISO8601 (e.g. "2026-07-07T15:00:00Z")
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.timestamp_millis());
    }
    // "yyyy-MM-dd HH:mm:ss" or "yyyy-MM-dd HH:mm" (naive, UTC interpretation)
    for fmt in &["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(s, fmt) {
            return Some(ndt.and_utc().timestamp_millis());
        }
    }
    // Bare date "yyyy-MM-dd"
    if let Ok(nd) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(nd.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis());
    }
    None
}

/// Auth-class errors short-circuit the (host, commodity) sweep. Only
/// explicit credential failures qualify — `ConsoleNeedLogin` does not,
/// since an alternate region may still answer.
fn is_auth_error(e: &str) -> bool {
    let l = e.to_lowercase();
    l.contains("authentication failed") || l.contains("no authority")
}

#[cfg(test)]
mod tests {
    use super::*;

    // cli-pulse shape: top-level data.codingPlanInstanceInfos, ISO reset times.
    const CLI_PULSE: &str = r#"{"data":{"codingPlanInstanceInfos":[{
        "planName":"Coding Plan Pro",
        "status":"VALID",
        "codingPlanQuotaInfo":{
            "per5HourUsedQuota":30,"per5HourTotalQuota":100,
            "per5HourQuotaNextRefreshTime":"2026-07-07T15:00:00Z",
            "perWeekUsedQuota":200,"perWeekTotalQuota":1000,
            "perWeekQuotaNextRefreshTime":"2026-07-13T00:00:00Z",
            "perBillMonthUsedQuota":500,"perBillMonthTotalQuota":5000,
            "perBillMonthQuotaNextRefreshTime":"2026-08-01T00:00:00Z"
        }
    }]}}"#;

    // ceiling shape: nested under data.DataV2.data.data, ms-epoch resets.
    const CEILING: &str = r#"{"code":"200","data":{"DataV2":{"data":{"data":{
        "codingPlanInstanceInfos":[{
            "instanceName":"Coding Plan Pro",
            "status":"VALID",
            "codingPlanQuotaInfo":{
                "per5HourUsedQuota":0,"per5HourTotalQuota":6000,
                "per5HourQuotaNextRefreshTime":1780731422000,
                "perWeekUsedQuota":2019,"perWeekTotalQuota":45000,
                "perWeekQuotaNextRefreshTime":1780848000000,
                "perBillMonthUsedQuota":25,"perBillMonthTotalQuota":90000,
                "perBillMonthQuotaNextRefreshTime":1783267200000
            }
        }]
    }}}}}"#;

    #[test]
    fn parses_cli_pulse_shape_with_three_windows() {
        let v: Value = serde_json::from_str(CLI_PULSE).unwrap();
        let data = parse_quota(&v).unwrap().unwrap();
        assert_eq!(data.quotas.len(), 3);
        assert!((data.quotas[0].percentage - 30.0).abs() < 0.01);
        assert!(data.quotas[0].reset_at > 1_700_000_000_000); // ISO parsed to ms
        assert!((data.quotas[1].percentage - 20.0).abs() < 0.01);
        assert!((data.quotas[2].percentage - 10.0).abs() < 0.01);
    }

    #[test]
    fn parses_ceiling_shape_with_ms_epoch_resets() {
        let v: Value = serde_json::from_str(CEILING).unwrap();
        let data = parse_quota(&v).unwrap().unwrap();
        assert_eq!(data.quotas.len(), 3);
        assert!((data.quotas[0].percentage - 0.0).abs() < 0.01);
        assert_eq!(data.quotas[0].reset_at, 1780731422000);
    }

    #[test]
    fn prefers_valid_instance_over_first() {
        let v = json!({"data":{"codingPlanInstanceInfos":[
            {"status":"EXPIRED","codingPlanQuotaInfo":{"per5HourUsedQuota":100,"per5HourTotalQuota":100}},
            {"status":"VALID","codingPlanQuotaInfo":{"per5HourUsedQuota":0,"per5HourTotalQuota":6000}}
        ]}});
        let data = parse_quota(&v).unwrap().unwrap();
        assert!((data.quotas[0].percentage - 0.0).abs() < 0.01);
    }

    #[test]
    fn missing_quota_info_yields_none() {
        let v = json!({"data":{"codingPlanInstanceInfos":[{}]}});
        assert!(parse_quota(&v).unwrap().is_none());
    }

    #[test]
    fn needlogin_in_ret_array_is_error() {
        let v =
            json!({"code":"200","data":{"DataV2":{"ret":["10032390::No Authority"],"data":{}}}});
        assert!(matches!(parse_quota(&v), Err(_)));
    }

    #[test]
    fn top_level_401_is_error() {
        let v = json!({"code":"401","message":"Unauthorized"});
        assert!(matches!(parse_quota(&v), Err(_)));
    }

    #[test]
    fn consolenneedlogin_is_not_auth_error() {
        // Must NOT short-circuit the sweep — Intl/alt may still answer.
        assert!(!is_auth_error("ConsoleNeedLogin"));
        assert!(is_auth_error("Authentication failed (HTTP 401)"));
    }

    #[test]
    fn reset_ms_parses_iso_rfc3339() {
        let ms = parse_str_to_ms("2026-07-07T15:00:00Z").unwrap();
        assert!(ms > 1_700_000_000_000);
    }

    #[test]
    fn reset_ms_parses_naive_datetime() {
        let ms = parse_str_to_ms("2026-08-01 00:00:00").unwrap();
        assert!(ms > 1_700_000_000_000);
    }

    #[test]
    fn can_handle_matches_qwen_hosts() {
        let p = QwenProvider;
        assert!(p.can_handle("token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"));
        assert!(p.can_handle("https://dashscope.aliyuncs.com"));
        assert!(!p.can_handle("https://api.deepseek.com"));
    }
}
