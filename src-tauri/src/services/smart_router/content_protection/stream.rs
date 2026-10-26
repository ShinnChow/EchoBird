use super::{protocol_field, signed_block, SharedEngine, PREFIX};
use axum::body::{Body, Bytes};
use axum::http::{header, StatusCode};
use axum::response::Response;
use futures_util::StreamExt;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::io;

const LIMIT: usize = 64 * 1024 * 1024;
const EVENT_LIMIT: usize = 1024 * 1024;

fn error() -> io::Error {
    io::Error::other("Sensitive information response processing failed")
}

pub(super) async fn restore(engine: SharedEngine, response: Response) -> Response {
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let streaming = content_type.starts_with("text/event-stream");
    let json = content_type.starts_with("application/json") || content_type.contains("+json");
    if !streaming && !json {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    parts.headers.remove(header::CONTENT_LENGTH);
    parts.headers.remove(header::ETAG);
    let body = if streaming {
        let input = body.into_data_stream();
        let state = (input, Events::new(engine), VecDeque::new(), false);
        Body::from_stream(futures_util::stream::try_unfold(
            state,
            |(mut input, mut events, mut ready, mut done)| async move {
                loop {
                    if let Some(bytes) = ready.pop_front() {
                        return Ok(Some((bytes, (input, events, ready, done))));
                    }
                    if done {
                        return Ok(None);
                    }
                    match input.next().await {
                        Some(Ok(bytes)) => ready.extend(events.push(&bytes)?),
                        Some(Err(_)) => return Err(error()),
                        None => {
                            ready.extend(events.finish()?);
                            done = true;
                        }
                    }
                }
            },
        ))
    } else {
        match axum::body::to_bytes(body, LIMIT)
            .await
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        {
            Some(mut value) => {
                if restore_value(&engine, &mut value).is_err() {
                    return processing_error();
                }
                Body::from(serde_json::to_vec(&value).expect("response JSON"))
            }
            None => return processing_error(),
        }
    };
    Response::from_parts(parts, body)
}

fn processing_error() -> Response {
    Response::builder().status(StatusCode::BAD_GATEWAY)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"error":{"type":"content_protection_error","message":"Sensitive information response processing failed"}}"#)).unwrap()
}

fn argument_field(key: &str, kind: &str) -> bool {
    matches!(key, "arguments" | "partial_json") || key == "delta" && kind.contains("arguments")
}

pub(super) fn restore_value(engine: &SharedEngine, value: &mut Value) -> Result<(), io::Error> {
    let store = engine.lock().map_err(|_| error())?;
    fields(
        value,
        &mut Vec::new(),
        "",
        false,
        &mut |_, text, _, escaped| {
            *text = store.restore(text, escaped);
        },
    );
    Ok(())
}

fn fields(
    value: &mut Value,
    path: &mut Vec<String>,
    kind: &str,
    business: bool,
    visit: &mut impl FnMut(&[String], &mut String, bool, bool),
) {
    match value {
        Value::Object(_) if !business && signed_block(value) => {}
        Value::Object(_) => {
            let kind = value["type"].as_str().unwrap_or(kind).to_owned();
            for (key, value) in value.as_object_mut().unwrap() {
                if !business && protocol_field(key) {
                    continue;
                }
                path.push(key.clone());
                if let Value::String(text) = value {
                    let delta = matches!(
                        key.as_str(),
                        "content"
                            | "reasoning_content"
                            | "reasoning"
                            | "text"
                            | "arguments"
                            | "partial_json"
                            | "input"
                            | "delta"
                    );
                    visit(path, text, delta, argument_field(key, &kind));
                } else {
                    fields(
                        value,
                        path,
                        &kind,
                        business || key == "input" && kind == "tool_use",
                        visit,
                    );
                }
                path.pop();
            }
        }
        Value::Array(values) => {
            for (index, value) in values.iter_mut().enumerate() {
                path.push(index.to_string());
                fields(value, path, kind, business, visit);
                path.pop();
            }
        }
        _ => {}
    }
}

struct Frame {
    id: u64,
    raw: Vec<u8>,
    headers: Vec<String>,
    value: Value,
    modified: bool,
}

impl Frame {
    fn parse(id: u64, raw: Vec<u8>) -> Result<Self, Vec<u8>> {
        let Ok(text) = std::str::from_utf8(&raw) else {
            return Err(raw);
        };
        let mut data = Vec::new();
        let mut headers = Vec::new();
        for line in text.lines() {
            if let Some(value) = line.strip_prefix("data:") {
                data.push(value.strip_prefix(' ').unwrap_or(value));
            } else if !line.is_empty() {
                headers.push(line.into());
            }
        }
        let Ok(value) = serde_json::from_str::<Value>(&data.join("\n")) else {
            return Err(raw);
        };
        Ok(Self {
            id,
            raw,
            headers,
            value,
            modified: false,
        })
    }

    fn bytes(self) -> Bytes {
        if !self.modified {
            return self.raw.into();
        }
        let mut text = self.headers.join("\n");
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str("data: ");
        text.push_str(&serde_json::to_string(&self.value).expect("event JSON"));
        text.push_str("\n\n");
        text.into()
    }
}

struct Pending {
    id: u64,
    path: Vec<String>,
    escaped: bool,
}

pub(super) struct Events {
    engine: SharedEngine,
    buffer: Vec<u8>,
    frames: VecDeque<Frame>,
    pending: HashMap<String, Pending>,
    next_id: u64,
    held_bytes: usize,
}

impl Events {
    pub(super) fn new(engine: SharedEngine) -> Self {
        Self {
            engine,
            buffer: Vec::new(),
            frames: VecDeque::new(),
            pending: HashMap::new(),
            next_id: 0,
            held_bytes: 0,
        }
    }

    pub(super) fn push(&mut self, bytes: &[u8]) -> Result<Vec<Bytes>, io::Error> {
        self.buffer.extend_from_slice(bytes);
        let mut output = Vec::new();
        loop {
            let blank = if self.buffer.starts_with(b"\r\n") {
                2
            } else if self.buffer.starts_with(b"\n") {
                1
            } else {
                0
            };
            if blank > 0 {
                output.push(self.buffer.drain(..blank).collect::<Vec<_>>().into());
                continue;
            }
            let lf = self
                .buffer
                .windows(2)
                .position(|part| part == b"\n\n")
                .map(|i| (i, 2));
            let crlf = self
                .buffer
                .windows(4)
                .position(|part| part == b"\r\n\r\n")
                .map(|i| (i, 4));
            let Some((end, delimiter)) = [lf, crlf].into_iter().flatten().min_by_key(|(i, _)| *i)
            else {
                if self.buffer.starts_with(b":") {
                    if let Some(end) = self.buffer.iter().position(|byte| *byte == b'\n') {
                        output.push(self.buffer.drain(..=end).collect::<Vec<_>>().into());
                        continue;
                    }
                }
                break;
            };
            if end + delimiter > EVENT_LIMIT {
                return Err(error());
            }
            let raw = self.buffer.drain(..end + delimiter).collect();
            output.extend(self.event(raw)?);
        }
        if self.buffer.len() > EVENT_LIMIT || self.held_bytes > EVENT_LIMIT {
            return Err(error());
        }
        Ok(output)
    }

    fn event(&mut self, raw: Vec<u8>) -> Result<Vec<Bytes>, io::Error> {
        self.next_id += 1;
        let mut frame = match Frame::parse(self.next_id, raw) {
            Ok(frame) => frame,
            Err(raw) => {
                if raw.starts_with(b":") {
                    return Ok(vec![raw.into()]);
                }
                let mut output = self.flush()?;
                output.push(raw.into());
                return Ok(output);
            }
        };
        let kind = frame.value["type"].as_str().unwrap_or_default();
        let is_delta = kind.ends_with("delta")
            || kind == "content_block_delta"
            || frame.value.get("choices").is_some();
        let terminal = matches!(
            kind,
            "message_stop" | "response.completed" | "response.failed" | "response.incomplete"
        );
        let mut output = if terminal { self.flush()? } else { Vec::new() };
        if !is_delta {
            let before = frame.value.clone();
            restore_value(&self.engine, &mut frame.value)?;
            frame.modified = before != frame.value;
        } else {
            let context = frame.value.clone();
            let store = self.engine.lock().map_err(|_| error())?;
            fields(
                &mut frame.value,
                &mut Vec::new(),
                "",
                false,
                &mut |path, text, delta, escaped| {
                    if !delta {
                        return;
                    }
                    let channel = channel(&context, path);
                    if let Some(pending) = self.pending.get(&channel) {
                        if let Some(previous) =
                            self.frames.iter_mut().find(|frame| frame.id == pending.id)
                        {
                            let value = at(&mut previous.value, &pending.path)
                                .as_str()
                                .unwrap_or_default()
                                .to_owned()
                                + text;
                            *text = String::new();
                            previous.modified = true;
                            frame.modified = true;
                            if partial_tail(&value) {
                                *at(&mut previous.value, &pending.path) = Value::String(value);
                            } else {
                                *at(&mut previous.value, &pending.path) =
                                    Value::String(store.restore(&value, escaped));
                                self.pending.remove(&channel);
                            }
                        }
                    } else if partial_tail(text) {
                        self.pending.insert(
                            channel,
                            Pending {
                                id: frame.id,
                                path: path.to_vec(),
                                escaped,
                            },
                        );
                    } else {
                        let restored = store.restore(text, escaped);
                        frame.modified |= restored != *text;
                        *text = restored;
                    }
                },
            );
        }
        self.held_bytes += frame.raw.len();
        self.frames.push_back(frame);
        while self
            .frames
            .front()
            .is_some_and(|frame| !self.pending.values().any(|pending| pending.id == frame.id))
        {
            let frame = self.frames.pop_front().unwrap();
            self.held_bytes = self.held_bytes.saturating_sub(frame.raw.len());
            output.push(frame.bytes());
        }
        Ok(output)
    }

    fn flush(&mut self) -> Result<Vec<Bytes>, io::Error> {
        let store = self.engine.lock().map_err(|_| error())?;
        for (_, pending) in self.pending.drain() {
            if let Some(frame) = self.frames.iter_mut().find(|frame| frame.id == pending.id) {
                let value = at(&mut frame.value, &pending.path);
                if let Some(text) = value.as_str() {
                    *value = Value::String(store.restore(text, pending.escaped));
                }
                frame.modified = true;
            }
        }
        self.held_bytes = 0;
        Ok(self.frames.drain(..).map(Frame::bytes).collect())
    }

    pub(super) fn finish(&mut self) -> Result<Vec<Bytes>, io::Error> {
        let mut output = self.flush()?;
        if !self.buffer.is_empty() {
            let raw = std::mem::take(&mut self.buffer);
            output.extend(self.event(raw)?);
            output.extend(self.flush()?);
        }
        Ok(output)
    }
}

fn at<'a>(mut value: &'a mut Value, path: &[String]) -> &'a mut Value {
    for key in path {
        value = if value.is_array() {
            &mut value[key.parse::<usize>().unwrap()]
        } else {
            &mut value[key]
        };
    }
    value
}

fn channel(value: &Value, path: &[String]) -> String {
    let mut channel = format!(
        "{}:{}:{}:{}:{}",
        value["type"],
        value["item_id"],
        value["output_index"],
        value["content_index"],
        value["index"]
    );
    let mut current = value;
    for key in path {
        if let Some(array) = current.as_array() {
            current = &array[key.parse::<usize>().unwrap()];
            channel.push_str(&format!("[{}]", current["index"].as_u64().unwrap_or(0)));
        } else {
            current = &current[key];
            channel.push('.');
            channel.push_str(key);
        }
    }
    channel
}

fn partial_tail(text: &str) -> bool {
    let start = text.len().saturating_sub(PREFIX.len() + 34);
    text.as_bytes()[start..]
        .iter()
        .enumerate()
        .any(|(offset, byte)| {
            if *byte != b'{' {
                return false;
            }
            let tail = &text.as_bytes()[start + offset..];
            PREFIX.as_bytes().starts_with(tail)
                || tail.starts_with(PREFIX.as_bytes())
                    && tail.len() < PREFIX.len() + 34
                    && tail[PREFIX.len()..]
                        .iter()
                        .all(|byte| byte.is_ascii_hexdigit() || *byte == b'}')
        })
}
