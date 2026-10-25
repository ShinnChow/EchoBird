use axum::{
    body::Bytes,
    http::{header, HeaderMap, HeaderValue, StatusCode, Version},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use bytes::{Buf, BytesMut};
use http_body_util::BodyExt;
use serde_json::Value;
use std::{io, time::Duration};
use tokio::{
    sync::{mpsc, oneshot},
    time::Instant,
};

use super::ProxyError;

const PATH: &str = "/aiserver.v1.AiService/StreamStt";
const CHUNK_BYTES: usize = 640;
const FINAL_WAIT: Duration = Duration::from_secs(5);
pub(super) const MAX_MESSAGE: usize = 4 * 1024 * 1024;

pub(crate) async fn transcribe(
    client: &reqwest::Client,
    credentials: &Value,
    audio: &Bytes,
    _filename: &str,
    mime: &str,
) -> Result<String, ProxyError> {
    let pcm = validated_pcm(audio, mime)?;
    tokio::time::timeout(
        super::voice::media_timeout(pcm.len()),
        recognize(client, credentials, pcm),
    )
    .await
    .map_err(|_| timed_out())?
}

pub(crate) fn validate_audio(audio: &Bytes, mime: &str) -> Result<(), ProxyError> {
    validated_pcm(audio, mime).map(|_| ())
}

fn validated_pcm<'a>(audio: &'a [u8], mime: &str) -> Result<&'a [u8], ProxyError> {
    if !mime.eq_ignore_ascii_case("audio/wav") && !mime.eq_ignore_ascii_case("audio/x-wav") {
        return Err(invalid_audio());
    }
    super::claude_voice::pcm(audio).map_err(|_| invalid_audio())
}

async fn recognize(
    client: &reqwest::Client,
    credentials: &Value,
    pcm: &[u8],
) -> Result<String, ProxyError> {
    let (tx, rx) = mpsc::channel::<Result<Bytes, io::Error>>(2);
    let (input_sent, input_seen) = oneshot::channel();
    let body =
        futures_util::stream::unfold((rx, Some(input_sent)), |(mut rx, mut done)| async move {
            match rx.recv().await {
                Some(chunk) => Some((chunk, (rx, done))),
                None => {
                    if let Some(done) = done.take() {
                        let _ = done.send(());
                    }
                    None
                }
            }
        });
    let mut request_headers = headers(credentials, false)?;
    request_headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/connect+proto"),
    );
    let request = client
        .post(format!("{}{PATH}", endpoint(credentials)))
        .version(Version::HTTP_2)
        .headers(request_headers)
        .timeout(super::voice::media_timeout(pcm.len()))
        .body(reqwest::Body::wrap_stream(body))
        .send();
    let upload = async move {
        // Empty native config omits language: automatic language detection.
        tx.send(Ok(framed(field(1, &[]))))
            .await
            .map_err(|_| failed())?;
        let start = Instant::now();
        let mut sent = 0;
        for chunk in pcm.chunks(CHUNK_BYTES) {
            sent += chunk.len();
            tokio::time::sleep_until(
                start + Duration::from_micros(sent as u64 * 1_000_000 / 32_000),
            )
            .await;
            tx.send(Ok(framed(field(2, &field(1, chunk)))))
                .await
                .map_err(|_| failed())?;
        }
        tx.send(Ok(framed(vec![0x1a, 0x02, 0x08, 0x01])))
            .await
            .map_err(|_| failed())?;
        drop(tx);
        input_seen.await.map_err(|_| failed())?;
        Ok::<_, ProxyError>(())
    };
    tokio::pin!(upload);
    tokio::pin!(request);
    // Start sending before waiting for response headers; some servers wait for audio.
    let mut sent = false;
    let response = tokio::select! {
        biased;
        result = &mut request => result.map_err(request_error)?,
        result = &mut upload => {
            result?;
            sent = true;
            request.await.map_err(request_error)?
        }
    };
    if !response.status().is_success() {
        return Err(http_error(response.status(), response.headers()));
    }
    if response.version() != Version::HTTP_2
        || !content_type(response.headers(), "application/connect+proto")
    {
        return Err(failed());
    }
    let response: axum::http::Response<reqwest::Body> = response.into();
    let retry_after = response.headers().get(header::RETRY_AFTER).cloned();
    let mut reader = Reader {
        body: response.into_body(),
        pending: BytesMut::new(),
        ended: false,
        retry_after,
    };
    let finish = tokio::time::sleep(FINAL_WAIT);
    tokio::pin!(finish);
    let mut last_partial = String::new();
    let mut final_text = None;
    loop {
        tokio::select! {
            biased;
            result = &mut upload, if !sent => {
                result?;
                sent = true;
                finish.as_mut().reset(Instant::now() + FINAL_WAIT);
            }
            message = reader.next() => {
                match message? {
                    Some(message) => {
                        let mut text = "";
                        let mut is_final = false;
                        let mut kind = 0;
                        for (number, value) in fields(&message)? {
                            match (number, value) {
                                (1, WireValue::Bytes(value)) => text = std::str::from_utf8(value).map_err(|_| failed())?,
                                (2, WireValue::Number(value)) => is_final = value != 0,
                                (3, WireValue::Number(value)) => kind = value,
                                _ => {}
                            }
                        }
                        if kind == 3 || (!matches!(kind, 1..=3) && is_final) {
                            final_text = Some(text.to_string());
                        } else {
                            last_partial = text.to_string();
                        }
                    }
                    None if sent => return nonempty(final_text.as_deref().unwrap_or(&last_partial)),
                    None => return Err(failed()),
                }
            }
            // A final may be followed by a Connect error; drain it before returning.
            // Native's final wait also bounds servers that leave the stream open.
            _ = &mut finish, if sent => {
                if !reader.pending.is_empty() {
                    return Err(timed_out());
                }
                return nonempty(final_text.as_deref().unwrap_or(&last_partial));
            }
        }
    }
}

struct Reader {
    body: reqwest::Body,
    pending: BytesMut,
    ended: bool,
    retry_after: Option<HeaderValue>,
}

impl Reader {
    async fn next(&mut self) -> Result<Option<Bytes>, ProxyError> {
        loop {
            if self.ended {
                return Ok(None);
            }
            if self.pending.len() >= 5 {
                let flags = self.pending[0];
                let length = u32::from_be_bytes(self.pending[1..5].try_into().unwrap()) as usize;
                if !matches!(flags, 0 | 2) || length > MAX_MESSAGE {
                    return Err(failed());
                }
                if self.pending.len() >= length + 5 {
                    self.pending.advance(5);
                    let data = self.pending.split_to(length).freeze();
                    if flags == 0 {
                        return Ok(Some(data));
                    }
                    let end: Value = serde_json::from_slice(&data).map_err(|_| failed())?;
                    if !end.is_object() {
                        return Err(failed());
                    }
                    if !end["error"].is_null() {
                        let mut error =
                            connect_error(end["error"]["code"].as_str().unwrap_or("unknown"));
                        error.retry_after = end["metadata"]["retry-after"]
                            .as_array()
                            .and_then(|values| values.first())
                            .and_then(Value::as_str)
                            .and_then(|value| HeaderValue::from_str(value).ok())
                            .or_else(|| self.retry_after.clone());
                        return Err(error);
                    }
                    if !self.pending.is_empty() {
                        return Err(failed());
                    }
                    self.ended = true;
                    return Ok(None);
                }
            }
            match self.body.frame().await {
                Some(Ok(frame)) => match frame.into_data() {
                    Ok(data) => {
                        self.pending.extend_from_slice(&data);
                        if self.pending.len() > MAX_MESSAGE + 5 {
                            return Err(failed());
                        }
                    }
                    Err(frame) => {
                        if let Ok(trailers) = frame.into_trailers() {
                            if let Some(status) = trailers.get("grpc-status") {
                                if status != "0" {
                                    return Err(connect_error(
                                        match status.to_str().unwrap_or("") {
                                            "16" => "unauthenticated",
                                            "8" => "resource_exhausted",
                                            _ => "unknown",
                                        },
                                    ));
                                }
                            }
                        }
                    }
                },
                Some(Err(_)) | None => return Err(failed()),
            }
        }
    }
}

pub(super) fn endpoint(_credentials: &Value) -> &str {
    #[cfg(test)]
    if let Some(endpoint) = _credentials["_voice_test_endpoint"].as_str() {
        return endpoint;
    }
    "https://api2.cursor.sh"
}

pub(super) fn headers(credentials: &Value, bot: bool) -> Result<HeaderMap, ProxyError> {
    let token = credentials["accessToken"]
        .as_str()
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(login_required)?;
    let mut result = HeaderMap::new();
    result.insert(
        header::AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| login_required())?,
    );
    // Protocol compatibility versions from the inspected official artifacts; not
    // a claim about a locally installed app, and no installation is required.
    let version = if bot { "0.75.8" } else { "3.27.12" };
    result.insert("connect-protocol-version", HeaderValue::from_static("1"));
    result.insert("x-cursor-client-version", HeaderValue::from_static(version));
    result.insert(
        "x-cursor-client-type",
        HeaderValue::from_static(if bot { "sand" } else { "ide" }),
    );
    result.insert("x-ghost-mode", HeaderValue::from_static("true"));
    if !bot {
        result.insert("x-cursor-streaming", HeaderValue::from_static("true"));
    }
    let os = match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    };
    result.insert(
        "x-cursor-client-os",
        HeaderValue::from_str(os).map_err(|_| failed())?,
    );
    result.insert(
        "x-request-id",
        HeaderValue::from_str(&uuid::Uuid::new_v4().to_string()).map_err(|_| failed())?,
    );
    if let Some(team) = credentials["teamId"]
        .as_u64()
        .filter(|value| *value > 0 && *value <= 9_007_199_254_740_991)
    {
        result.insert(
            "x-cursor-team-id",
            HeaderValue::from_str(&team.to_string()).map_err(|_| login_required())?,
        );
    }
    if let Some(machine) = credentials["machineId"]
        .as_str()
        .filter(|value| !value.is_empty())
    {
        let checksum = checksum(
            machine,
            (chrono::Utc::now().timestamp_millis() / 1_000_000) as u32,
        );
        result.insert(
            "x-cursor-checksum",
            HeaderValue::from_str(&checksum).map_err(|_| login_required())?,
        );
    }
    if bot {
        result.insert("x-sand-box-namespace", HeaderValue::from_static("prod"));
        result.insert(
            "x-cursor-client-source",
            HeaderValue::from_static("sand-desktop"),
        );
        let platform = match os {
            "darwin" => "(Macintosh; Intel Mac OS X 10_15_7)".to_string(),
            "win32" => "(Windows NT 10.0; Win64; x64)".to_string(),
            "linux" => "(X11; Linux x86_64)".to_string(),
            other => format!("(compatible; {other})"),
        };
        let agent = format!("Mozilla/5.0 {platform} AppleWebKit/537.36 (KHTML, like Gecko) Sand/{version} Safari/537.36");
        result.insert(
            header::USER_AGENT,
            HeaderValue::from_str(&agent).map_err(|_| failed())?,
        );
    }
    Ok(result)
}

fn checksum(machine: &str, time: u32) -> String {
    // JavaScript bit shifts wrap modulo 32: >>40 is >>8, >>32 is >>0.
    let mut bytes = [
        (time >> 8) as u8,
        time as u8,
        (time >> 24) as u8,
        (time >> 16) as u8,
        (time >> 8) as u8,
        time as u8,
    ];
    let mut previous = 165;
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = (*byte ^ previous).wrapping_add(index as u8);
        previous = *byte;
    }
    format!("{}{machine}", URL_SAFE_NO_PAD.encode(bytes))
}

pub(super) fn content_type(headers: &HeaderMap, expected: &str) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(';')
                .next()
                .is_some_and(|value| value.trim().eq_ignore_ascii_case(expected))
        })
}

pub(super) fn field(number: u32, data: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(data.len() + 10);
    for mut value in [u64::from(number) << 3 | 2, data.len() as u64] {
        while value >= 128 {
            bytes.push(value as u8 | 128);
            value >>= 7;
        }
        bytes.push(value as u8);
    }
    bytes.extend_from_slice(data);
    bytes
}

fn framed(message: Vec<u8>) -> Bytes {
    let mut result = vec![0];
    result.extend_from_slice(&(message.len() as u32).to_be_bytes());
    result.extend(message);
    result.into()
}

pub(super) enum WireValue<'a> {
    Number(u64),
    Bytes(&'a [u8]),
    Other,
}

pub(super) fn fields(mut bytes: &[u8]) -> Result<Vec<(u32, WireValue<'_>)>, ProxyError> {
    fn varint(bytes: &mut &[u8]) -> Result<u64, ProxyError> {
        let mut value = 0;
        for shift in (0..=63).step_by(7) {
            let (&byte, rest) = bytes.split_first().ok_or_else(failed)?;
            *bytes = rest;
            if shift == 63 && byte > 1 {
                return Err(failed());
            }
            value |= u64::from(byte & 127) << shift;
            if byte < 128 {
                return Ok(value);
            }
        }
        Err(failed())
    }
    let mut result = Vec::new();
    while !bytes.is_empty() {
        let tag = varint(&mut bytes)?;
        let number = u32::try_from(tag >> 3).map_err(|_| failed())?;
        if number == 0 || number > 0x1fff_ffff {
            return Err(failed());
        }
        let length = match tag & 7 {
            0 => {
                result.push((number, WireValue::Number(varint(&mut bytes)?)));
                continue;
            }
            1 => 8,
            2 => usize::try_from(varint(&mut bytes)?).map_err(|_| failed())?,
            5 => 4,
            _ => return Err(failed()),
        };
        let data = bytes.get(..length).ok_or_else(failed)?;
        result.push((
            number,
            if tag & 7 == 2 {
                WireValue::Bytes(data)
            } else {
                WireValue::Other
            },
        ));
        bytes = &bytes[length..];
    }
    Ok(result)
}

pub(super) fn http_error(status: StatusCode, headers: &HeaderMap) -> ProxyError {
    let mut error = ProxyError::new(status, "Cursor-family speech request failed");
    error.retry_after = headers.get(header::RETRY_AFTER).cloned();
    error
}

fn connect_error(code: &str) -> ProxyError {
    ProxyError::new(
        match code {
            "unauthenticated" => StatusCode::UNAUTHORIZED,
            "permission_denied" => StatusCode::FORBIDDEN,
            "resource_exhausted" => StatusCode::TOO_MANY_REQUESTS,
            "deadline_exceeded" => StatusCode::GATEWAY_TIMEOUT,
            "unavailable" => StatusCode::SERVICE_UNAVAILABLE,
            _ => StatusCode::BAD_GATEWAY,
        },
        "Cursor speech service failed",
    )
}

pub(super) fn nonempty(text: &str) -> Result<String, ProxyError> {
    let text = text.trim();
    if text.is_empty() {
        Err(failed())
    } else {
        Ok(text.into())
    }
}

fn invalid_audio() -> ProxyError {
    ProxyError::new(
        StatusCode::BAD_REQUEST,
        "Cursor speech requires 16 kHz mono PCM16 WAV audio",
    )
}
fn login_required() -> ProxyError {
    ProxyError::new(
        StatusCode::UNAUTHORIZED,
        "Cursor-family speech login required",
    )
}
pub(super) fn failed() -> ProxyError {
    ProxyError::new(
        StatusCode::BAD_GATEWAY,
        "Cursor-family speech recognition failed",
    )
}
pub(super) fn timed_out() -> ProxyError {
    ProxyError::new(
        StatusCode::GATEWAY_TIMEOUT,
        "Cursor-family speech recognition timed out",
    )
}
pub(super) fn request_error(error: reqwest::Error) -> ProxyError {
    if error.is_timeout() {
        timed_out()
    } else {
        failed()
    }
}

#[cfg(test)]
mod tests;
