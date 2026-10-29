//! Ephemeral, view-scoped request display. Never feeds the durable statistics ledger.
use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const LEASE: Duration = Duration::from_secs(3);
const MAX_ROWS: usize = 64;
const MAX_TEXT: usize = 240;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Segment {
    pub text: String,
    pub protected_text: Option<String>,
    pub kind: Option<u8>,
}

#[derive(Default)]
struct Feed {
    viewer: Option<(String, String, Instant)>,
    rows: VecDeque<Vec<Segment>>,
}

impl Feed {
    fn expire(&mut self) {
        if self.viewer.as_ref().is_some_and(|v| v.2.elapsed() >= LEASE) {
            self.viewer = None;
            self.rows.clear();
        }
    }

    fn poll(&mut self, session: &str, group: &str) -> Vec<Vec<Segment>> {
        self.expire();
        if !self
            .viewer
            .as_ref()
            .is_some_and(|v| v.0 == session && v.1 == group)
        {
            self.rows.clear();
        }
        self.viewer = Some((session.into(), group.into(), Instant::now()));
        self.rows.drain(..).collect()
    }

    fn publish(&mut self, session: &str, group: &str, rows: Vec<Vec<Segment>>) {
        self.expire();
        if self
            .viewer
            .as_ref()
            .is_some_and(|v| v.0 == session && v.1 == group)
        {
            self.rows.extend(rows.into_iter().take(MAX_ROWS));
            while self.rows.len() > MAX_ROWS {
                self.rows.pop_front();
            }
        }
    }
}

fn feed() -> &'static Mutex<Feed> {
    static FEED: OnceLock<Mutex<Feed>> = OnceLock::new();
    FEED.get_or_init(Mutex::default)
}

pub(crate) fn poll(session: &str, group: &str) -> Vec<Vec<Segment>> {
    feed()
        .lock()
        .map(|mut f| f.poll(session, group))
        .unwrap_or_default()
}

pub(crate) fn stop(session: &str) {
    if let Ok(mut f) = feed().lock() {
        if f.viewer.as_ref().is_some_and(|v| v.0 == session) {
            f.viewer = None;
            f.rows.clear();
        }
    }
}

pub(super) fn ticket(group: &str) -> Option<String> {
    let mut f = feed().lock().ok()?;
    f.expire();
    f.viewer
        .as_ref()
        .filter(|v| v.1 == group)
        .map(|v| v.0.clone())
}

pub(super) fn capture(
    session: &str,
    group: &str,
    body: &Value,
    segments: impl Fn(&str) -> Vec<Segment>,
) {
    if ticket(group).as_deref() != Some(session) {
        return;
    }
    let mut rows = Vec::new();
    fn visit(
        value: &Value,
        rows: &mut Vec<Vec<Segment>>,
        segments: &impl Fn(&str) -> Vec<Segment>,
    ) {
        if rows.len() >= MAX_ROWS {
            return;
        }
        match value {
            Value::String(text) if !text.starts_with("data:") => {
                for line in text.lines().take(MAX_ROWS - rows.len()) {
                    let mut rest = line;
                    while !rest.is_empty() && rows.len() < MAX_ROWS {
                        let mut end = rest
                            .char_indices()
                            .nth(MAX_TEXT)
                            .map_or(rest.len(), |(i, _)| i);
                        // Keep actual replacement tokens intact across visual line breaks.
                        let lookahead: String = rest.chars().take(MAX_TEXT + 64).collect();
                        for (start, _) in lookahead.match_indices("{{SECRET_") {
                            if start < end {
                                if let Some(close) = lookahead[start..].find("}}") {
                                    end = end.max(start + close + 2);
                                }
                            }
                        }
                        let text = &rest[..end];
                        if !text.trim().is_empty() {
                            rows.push(segments(text));
                        }
                        rest = &rest[end..];
                    }
                }
            }
            Value::Array(values) => {
                for value in values {
                    if rows.len() >= MAX_ROWS {
                        break;
                    }
                    visit(value, rows, segments);
                }
            }
            Value::Object(values) => {
                for (key, value) in values {
                    if rows.len() >= MAX_ROWS {
                        break;
                    }
                    if !matches!(
                        key.as_str(),
                        "data" | "image_url" | "url" | "signature" | "tools" | "functions"
                    ) {
                        visit(value, rows, segments);
                    }
                }
            }
            _ => {}
        }
    }
    visit(body, &mut rows, &segments);
    if let Ok(mut f) = feed().lock() {
        f.publish(session, group, rows);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row() -> Vec<Segment> {
        vec![Segment {
            text: "fixture".into(),
            protected_text: None,
            kind: None,
        }]
    }
    #[test]
    fn opt_in_group_isolation_stop_and_expiry() {
        let mut f = Feed::default();
        f.publish("a", "one", vec![row()]);
        assert!(f.rows.is_empty());
        f.poll("a", "one");
        f.publish("a", "two", vec![row()]);
        assert!(f.rows.is_empty());
        f.publish("a", "one", vec![row()]);
        assert_eq!(f.poll("a", "one").len(), 1);
        f.poll("b", "two");
        f.publish("a", "one", vec![row()]);
        assert!(f.rows.is_empty());
        f.publish("b", "two", vec![row(); 100]);
        assert_eq!(f.rows.len(), MAX_ROWS);
        f.viewer.as_mut().unwrap().2 = Instant::now() - LEASE;
        f.expire();
        assert!(f.viewer.is_none());
        assert!(f.rows.is_empty());
    }
}
