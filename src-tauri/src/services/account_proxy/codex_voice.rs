use axum::{
    body::Bytes,
    http::{header, HeaderMap, HeaderValue, StatusCode},
};
use reqwest::multipart::{Form, Part};
use serde_json::Value;
use std::time::Duration;

use super::ProxyError;

const ENDPOINT: &str = "https://chatgpt.com/backend-api";

#[cfg(test)]
mod tests;

pub(crate) async fn transcribe(
    client: &reqwest::Client,
    credentials: &Value,
    audio: &Bytes,
    filename: &str,
    mime: &str,
) -> Result<String, ProxyError> {
    let endpoint = ENDPOINT;
    #[cfg(test)]
    let endpoint = credentials["_voice_test_endpoint"]
        .as_str()
        .unwrap_or(endpoint);
    let part = Part::stream_with_length(audio.clone(), audio.len() as u64)
        .file_name(filename.to_owned())
        .mime_str(mime)
        .map_err(|_| ProxyError::new(StatusCode::BAD_REQUEST, "Invalid audio content type"))?;
    let response = client
        .post(format!("{endpoint}/transcribe"))
        .headers(auth_headers(credentials)?)
        .multipart(Form::new().part("file", part))
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(request_error)?;
    if !response.status().is_success() {
        let mut error = ProxyError::new(response.status(), "Codex speech request failed");
        error.retry_after = response.headers().get(header::RETRY_AFTER).cloned();
        return Err(error);
    }
    let result: Value = response.json().await.map_err(request_error)?;
    result["text"].as_str().map(str::to_owned).ok_or_else(|| {
        ProxyError::new(StatusCode::BAD_GATEWAY, "Codex speech response has no text")
    })
}

fn auth_headers(credentials: &Value) -> Result<HeaderMap, ProxyError> {
    let invalid = || ProxyError::new(StatusCode::UNAUTHORIZED, "Codex login required");
    let token = credentials["accessToken"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(invalid)?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| invalid())?,
    );
    headers.insert("originator", HeaderValue::from_static("codex_cli_rs"));
    headers.insert("version", HeaderValue::from_static("0.159.0"));
    headers.insert(
        header::USER_AGENT,
        HeaderValue::from_static("codex_cli_rs/0.159.0 (EchoBird)"),
    );
    if let Some(account_id) = credentials["accountId"]
        .as_str()
        .filter(|id| !id.is_empty())
    {
        headers.insert(
            "chatgpt-account-id",
            HeaderValue::from_str(account_id).map_err(|_| invalid())?,
        );
    }
    Ok(headers)
}

fn request_error(error: reqwest::Error) -> ProxyError {
    if error.is_timeout() {
        ProxyError::new(
            StatusCode::GATEWAY_TIMEOUT,
            "Codex speech request timed out",
        )
    } else {
        ProxyError::new(StatusCode::BAD_GATEWAY, "Codex speech request failed")
    }
}
