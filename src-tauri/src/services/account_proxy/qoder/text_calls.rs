use super::super::ProxyError;
use serde_json::{json, Map, Value};

pub(super) enum Part {
    Text(String),
    Call(String, Value),
}

#[derive(Default)]
pub(super) struct TextCalls {
    pending: String,
    quote: usize,
}

const STARTS: [&str; 6] = [
    "<tool_call>",
    "<function=",
    "<function_calls>",
    "<antml:function_calls>",
    "<invoke ",
    "<antml:invoke ",
];

fn invalid() -> ProxyError {
    ProxyError::upstream("Invalid or incomplete Qoder text tool call")
}

impl TextCalls {
    pub(super) fn feed(
        &mut self,
        text: &str,
        tools: &Value,
        finish: bool,
    ) -> Result<Vec<Part>, ProxyError> {
        self.pending.push_str(text);
        let mut out = vec![];
        let mut plain = String::new();
        while !self.pending.is_empty() {
            if self.pending.starts_with('`') {
                let ticks = self.pending.bytes().take_while(|b| *b == b'`').count();
                if ticks == self.pending.len() && !finish {
                    break;
                }
                if self.quote == 0 {
                    self.quote = ticks;
                } else if self.quote == ticks {
                    self.quote = 0;
                }
                plain.push_str(&self.pending[..ticks]);
                self.pending.drain(..ticks);
                continue;
            }
            if self.quote == 0 && self.pending.starts_with('<') {
                let wrapped = self.pending.starts_with("<tool_call>");
                if (wrapped || tools.as_array().is_some_and(|tools| !tools.is_empty()))
                    && STARTS.iter().any(|start| {
                        start.starts_with(&self.pending) || self.pending.starts_with(start)
                    })
                {
                    let Some((consumed, calls)) = parse(&self.pending, tools, finish)? else {
                        if finish {
                            if STARTS.iter().any(|start| self.pending.starts_with(start)) {
                                return Err(invalid());
                            }
                            plain.push_str(&self.pending);
                            self.pending.clear();
                        }
                        break;
                    };
                    if let Some(calls) = calls {
                        if !plain.is_empty() {
                            out.push(Part::Text(std::mem::take(&mut plain)));
                        }
                        out.extend(calls.into_iter().map(|(name, args)| Part::Call(name, args)));
                        self.pending.drain(..consumed);
                        continue;
                    }
                    // Preserve an undeclared bare call as ordinary text in its entirety.
                    plain.push_str(&self.pending[..consumed]);
                    self.pending.drain(..consumed);
                    continue;
                }
            }
            let end = self
                .pending
                .char_indices()
                .skip(1)
                .find(|(_, ch)| *ch == '`' || (self.quote == 0 && *ch == '<'))
                .map(|(index, _)| index)
                .unwrap_or(self.pending.len());
            plain.push_str(&self.pending[..end]);
            self.pending.drain(..end);
        }
        if !plain.is_empty() {
            out.push(Part::Text(plain));
        }
        Ok(out)
    }
}

type Calls = Vec<(String, Value)>;

// None waits for another chunk; Some with no calls preserves a literal example.
fn parse(
    text: &str,
    tools: &Value,
    finish: bool,
) -> Result<Option<(usize, Option<Calls>)>, ProxyError> {
    let Some(start) = STARTS.iter().find(|start| text.starts_with(**start)) else {
        return Ok(None);
    };
    let close = match *start {
        "<tool_call>" => "</tool_call>",
        "<function=" => "</function>",
        "<function_calls>" => "</function_calls>",
        "<antml:function_calls>" => "</antml:function_calls>",
        "<invoke " => "</invoke>",
        _ => "</antml:invoke>",
    };
    let Some(end) = text.find(close) else {
        if finish && only_unknown(text, tools) {
            return Ok(Some((text.len(), None)));
        }
        return Ok(None);
    };
    let consumed = end + close.len();
    let block = &text[..consumed];
    if *start != "<tool_call>" && only_unknown(block, tools) {
        return Ok(Some((consumed, None)));
    }
    let mut calls = vec![];
    if *start == "<tool_call>" {
        let body = text[start.len()..end].trim();
        if let Ok(value) = serde_json::from_str::<Value>(body) {
            let name = value["name"]
                .as_str()
                .filter(|name| !name.is_empty())
                .ok_or_else(invalid)?;
            let args = value
                .get("arguments")
                .filter(|args| args.is_object())
                .ok_or_else(invalid)?;
            calls.push((name.into(), args.clone()));
        } else {
            calls.push(xml_call(body, tools)?);
        }
    } else if start.ends_with("function_calls>") {
        let mut body = text[start.len()..end].trim();
        while !body.is_empty() {
            let close = if body.starts_with("<antml:invoke ") {
                "</antml:invoke>"
            } else {
                "</invoke>"
            };
            let end = body.find(close).ok_or_else(invalid)? + close.len();
            calls.push(xml_call(&body[..end], tools)?);
            body = body[end..].trim();
        }
        if calls.is_empty() {
            return Err(invalid());
        }
    } else {
        calls.push(xml_call(block, tools)?);
    }
    if *start != "<tool_call>" && calls.iter().any(|(name, _)| tool(tools, name).is_none()) {
        return Ok(Some((consumed, None)));
    }
    Ok(Some((consumed, Some(calls))))
}

fn tool<'a>(tools: &'a Value, name: &str) -> Option<&'a Value> {
    tools
        .as_array()?
        .iter()
        .find(|tool| tool["function"]["name"] == name)
        .map(|tool| &tool["function"]["parameters"])
}

fn attribute(tag: &str) -> Result<&str, ProxyError> {
    let value = tag
        .trim()
        .strip_prefix("name")
        .and_then(|value| value.trim_start().strip_prefix('='))
        .ok_or_else(invalid)?
        .trim_start();
    let quote = value
        .chars()
        .next()
        .filter(|ch| matches!(ch, '\'' | '"'))
        .ok_or_else(invalid)?;
    value[1..]
        .split_once(quote)
        .map(|(name, _)| name)
        .ok_or_else(invalid)
}

fn call_name(head: &str) -> Option<&str> {
    head.strip_prefix("<function=")
        .map(str::trim)
        .or_else(|| {
            head.strip_prefix("<invoke ")
                .and_then(|tag| attribute(tag).ok())
        })
        .or_else(|| {
            head.strip_prefix("<antml:invoke ")
                .and_then(|tag| attribute(tag).ok())
        })
}

fn only_unknown(text: &str, tools: &Value) -> bool {
    let mut names = text
        .split('>')
        .filter_map(|part| call_name(&part[part.rfind('<')?..]));
    names.next().is_some_and(|name| tool(tools, name).is_none())
        && names.all(|name| tool(tools, name).is_none())
}

fn xml_call(text: &str, tools: &Value) -> Result<(String, Value), ProxyError> {
    let (head, rest) = text.split_once('>').ok_or_else(invalid)?;
    let (name, close, parameter, parameter_close) =
        if let Some(name) = head.strip_prefix("<function=") {
            (name.trim(), "</function>", "<parameter=", "</parameter>")
        } else if let Some(tag) = head.strip_prefix("<invoke ") {
            (attribute(tag)?, "</invoke>", "<parameter ", "</parameter>")
        } else if let Some(tag) = head.strip_prefix("<antml:invoke ") {
            (
                attribute(tag)?,
                "</antml:invoke>",
                "<antml:parameter ",
                "</antml:parameter>",
            )
        } else {
            return Err(invalid());
        };
    if name.is_empty() {
        return Err(invalid());
    }
    if tool(tools, name).is_none() {
        return Ok((name.into(), json!({})));
    }
    let mut body = rest.strip_suffix(close).ok_or_else(invalid)?.trim();
    let mut args = Map::new();
    while !body.is_empty() {
        let (head, rest) = body
            .strip_prefix(parameter)
            .ok_or_else(invalid)?
            .split_once('>')
            .ok_or_else(invalid)?;
        let key = if parameter == "<parameter=" {
            head.trim()
        } else {
            attribute(head)?
        };
        let (text, rest) = rest.split_once(parameter_close).ok_or_else(invalid)?;
        if key.is_empty() || args.contains_key(key) {
            return Err(invalid());
        }
        let value = text
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&amp;", "&");
        let schema = tool(tools, name);
        let string = schema.is_some_and(|schema| {
            let mut parent = schema;
            for _ in 0..64 {
                let Some(target) = parent["$ref"]
                    .as_str()
                    .and_then(|reference| reference.strip_prefix('#'))
                    .and_then(|pointer| schema.pointer(pointer))
                else {
                    break;
                };
                parent = target;
            }
            let mut field = &parent["properties"][key];
            for _ in 0..64 {
                if field["type"] == "string" {
                    return true;
                }
                let Some(target) = field["$ref"]
                    .as_str()
                    .and_then(|reference| reference.strip_prefix('#'))
                    .and_then(|pointer| schema.pointer(pointer))
                else {
                    break;
                };
                field = target;
            }
            false
        });
        args.insert(
            key.into(),
            if string {
                json!(value)
            } else {
                serde_json::from_str(value.trim()).unwrap_or(json!(value.trim()))
            },
        );
        body = rest.trim();
    }
    Ok((name.into(), Value::Object(args)))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tools() -> Value {
        json!([{"function":{"name":"read","parameters":{"properties":{"path":{"type":"string"}}}}}])
    }
    #[test]
    fn calls_survive_every_boundary_and_keep_string_whitespace() {
        for source in [
            "<function=read><parameter=path> [1, 2] </parameter></function>",
            "<function_calls><invoke name=\"read\"><parameter name=\"path\"> [1, 2] </parameter></invoke></function_calls>",
            "<antml:invoke name='read'><antml:parameter name='path'> [1, 2] </antml:parameter></antml:invoke>",
        ] {
            for boundary in 0..=source.len() {
                let mut parser = TextCalls::default();
                let mut parts = parser.feed(&source[..boundary], &tools(), false).unwrap();
                parts.extend(parser.feed(&source[boundary..], &tools(), true).unwrap());
                assert_eq!(parts.len(), 1);
                assert!(matches!(&parts[0], Part::Call(name, args) if name == "read" && args["path"] == " [1, 2] "));
            }
        }
    }
    #[test]
    fn quoted_or_undeclared_calls_and_ordinary_angle_suffix_remain_text() {
        for source in [
            "comparison <",
            "partial <fun",
            "`<function=read></function>`",
            "```\n<tool_call>{\"name\":\"read\",\"arguments\":{}}</tool_call>\n```",
            "<function=other></function>",
            "<function=other>example with arbitrary contents</function>",
            "<function=other>unfinished example",
            "<function_calls><invoke name=\"other\">unfinished example",
        ] {
            let mut parser = TextCalls::default();
            let mut text = String::new();
            for ch in source.chars() {
                for part in parser.feed(&ch.to_string(), &tools(), false).unwrap() {
                    match part {
                        Part::Text(value) => text.push_str(&value),
                        Part::Call(_, _) => panic!("executed literal example"),
                    }
                }
            }
            for part in parser.feed("", &tools(), true).unwrap() {
                match part {
                    Part::Text(value) => text.push_str(&value),
                    Part::Call(_, _) => panic!("executed literal example"),
                }
            }
            assert_eq!(text, source);
        }
    }

    #[test]
    fn grouped_calls_keep_declared_types_and_reject_duplicate_or_truncated_parameters() {
        let request = json!([{"function":{"name":"read","parameters":{"$ref":"#/$defs/Args","$defs":{"Args":{"properties":{"path":{"$ref":"#/$defs/Text"},"count":{"type":"integer"}}},"Text":{"type":"string"}}}}}]);
        let source = "<function_calls><invoke name=\"read\"><parameter name=\"path\">123</parameter><parameter name=\"count\">2</parameter></invoke><invoke name=\"read\"><parameter name=\"path\">&lt;x&gt;&amp;</parameter></invoke></function_calls>";
        let mut parser = TextCalls::default();
        let parts = parser.feed(source, &request, true).unwrap();
        assert_eq!(parts.len(), 2);
        assert!(
            matches!(&parts[0], Part::Call(_, args) if args["path"] == "123" && args["count"] == 2)
        );
        assert!(matches!(&parts[1], Part::Call(_, args) if args["path"] == "<x>&"));
        for source in [
            "<function=read><parameter=path>a</parameter><parameter=path>b</parameter></function>",
            "<function=read><parameter=path>a",
            "<function_calls><invoke name=\"read\"></invoke>",
        ] {
            assert!(TextCalls::default().feed(source, &request, true).is_err());
        }
    }
}
