//! Observe reported usage without changing or retaining the forwarded response.
use axum::{body::Body, http::header, response::Response};
use http_body_util::BodyExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_EVENT_BYTES: usize = 256 * 1024;
const MAX_JSON_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Default, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub reported_responses: u64,
}
impl TokenUsage {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    pub fn add(&mut self, other: &Self) {
        self.input_tokens = self.input_tokens.saturating_add(other.input_tokens);
        self.output_tokens = self.output_tokens.saturating_add(other.output_tokens);
        self.total_tokens = self.total_tokens.saturating_add(other.total_tokens);
        self.reported_responses = self
            .reported_responses
            .saturating_add(other.reported_responses);
    }
}

struct Parser {
    sse: bool,
    bytes: Vec<u8>,
    overflow: bool,
    blank_line: bool,
    usage: TokenUsage,
}
impl Parser {
    fn new(sse: bool) -> Self {
        Self {
            sse,
            bytes: Vec::new(),
            overflow: false,
            blank_line: true,
            usage: TokenUsage::default(),
        }
    }
    fn value(&mut self, value: &Value) {
        let usage = value
            .get("usage")
            .or_else(|| value.get("response").and_then(|value| value.get("usage")))
            .or_else(|| value.get("message").and_then(|value| value.get("usage")));
        let Some(usage) = usage.filter(|value| value.is_object()) else {
            return;
        };
        let input = usage
            .get("prompt_tokens")
            .or_else(|| usage.get("input_tokens"))
            .and_then(Value::as_u64);
        let output = usage
            .get("completion_tokens")
            .or_else(|| usage.get("output_tokens"))
            .and_then(Value::as_u64);
        let total = usage.get("total_tokens").and_then(Value::as_u64);
        if input.is_none() && output.is_none() && total.is_none() {
            return;
        }
        let cache = if usage.get("prompt_tokens").is_none() {
            usage
                .get("cache_read_input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                .saturating_add(
                    usage
                        .get("cache_creation_input_tokens")
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                )
        } else {
            0
        };
        self.usage.input_tokens = self
            .usage
            .input_tokens
            .max(input.unwrap_or(0).saturating_add(cache));
        self.usage.output_tokens = self.usage.output_tokens.max(output.unwrap_or(0));
        self.usage.total_tokens = self.usage.total_tokens.max(total.unwrap_or(0)).max(
            self.usage
                .input_tokens
                .saturating_add(self.usage.output_tokens),
        );
        self.usage.reported_responses = 1;
    }
    fn event(&mut self) {
        if !self.overflow {
            if let Ok(text) = std::str::from_utf8(&self.bytes) {
                let data = text
                    .lines()
                    .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
                    .collect::<Vec<_>>()
                    .join("\n");
                if let Ok(value) = serde_json::from_str(&data) {
                    self.value(&value);
                }
            }
        }
        self.bytes.clear();
        self.overflow = false;
    }
    fn push(&mut self, bytes: &[u8]) {
        if !self.sse {
            if !self.overflow && self.bytes.len().saturating_add(bytes.len()) <= MAX_JSON_BYTES {
                self.bytes.extend_from_slice(bytes);
            } else {
                self.bytes.clear();
                self.overflow = true;
            }
            return;
        }
        for &byte in bytes {
            if !self.overflow {
                if self.bytes.len() < MAX_EVENT_BYTES {
                    self.bytes.push(byte);
                } else {
                    self.bytes.clear();
                    self.overflow = true;
                }
            }
            if byte == b'\n' {
                if self.blank_line {
                    self.event();
                }
                self.blank_line = true;
            } else if byte != b'\r' {
                self.blank_line = false;
            }
        }
    }
    fn finish(&mut self) -> Option<TokenUsage> {
        if self.sse {
            self.event();
        } else if !self.overflow {
            if let Ok(value) = serde_json::from_slice(&self.bytes) {
                self.value(&value);
            }
        }
        (self.usage.reported_responses > 0).then(|| self.usage.clone())
    }
}

struct Meter<F: FnOnce(TokenUsage)> {
    parser: Parser,
    record: Option<F>,
}
impl<F: FnOnce(TokenUsage)> Drop for Meter<F> {
    fn drop(&mut self) {
        if let (Some(usage), Some(record)) = (self.parser.finish(), self.record.take()) {
            record(usage);
        }
    }
}

pub fn observe(response: Response, record: impl FnOnce(TokenUsage) + Send + 'static) -> Response {
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let sse = content_type.starts_with("text/event-stream");
    if !response.status().is_success() || (!sse && !content_type.starts_with("application/json")) {
        return response;
    }
    let mut meter = Meter {
        parser: Parser::new(sse),
        record: Some(record),
    };
    let (parts, body) = response.into_parts();
    let body = body.map_frame(move |frame| {
        if let Some(bytes) = frame.data_ref() {
            meter.parser.push(bytes);
        }
        frame
    });
    Response::from_parts(parts, Body::new(body))
}

#[cfg(test)]
#[path = "usage_tests.rs"]
mod tests;
